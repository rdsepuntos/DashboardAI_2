/**
 * chat-hazard-mcp.js
 *
 * Handles WHS hazard report queries by calling the OpenAI Responses API
 * with the Arventa MCP server (get_hazard_reports tool).
 *
 * Three response modes — OpenAI decides which to use:
 *   "chat"  → conversational answer about hazard reports
 *   "list"  → formatted list/table of matching hazard reports
 *   "view"  → full Hazard Report Card opened in a popup modal (printable)
 *
 * Trigger phrases for "view": "show report", "open report", "view report",
 *   "show me report [number]", "full report for", "details of report", etc.
 * Trigger phrases for "list": "list all", "show all", "how many", "all reports", etc.
 * Everything else hazard-related → "chat".
 *
 * Integration:
 *   - checkAndHandleHazardIntent(message) called via chat-router.js
 *   - Returns true  → handled (stop normal pipeline)
 *   - Returns false → not hazard-related, continue normal pipeline
 *
 * Load order (index.html):
 *   chat-chemical-mcp.js  →  chat-policy-mcp.js  →  chat-hazard-mcp.js  →  chat-router.js  →  chat.js
 */

// ---------------------------------------------------------------------------
// MCP server URL — reuses chemical module URL (same server)
// ---------------------------------------------------------------------------
const _HAZARD_ARVENTA_BASE      = 'https://beta.whsmonitor.com.au/vws';
const _HAZARD_ARVENTA_ADMIN_KEY = '2G2rFq95Kr7g8MQSWO3SE2kGbq9BJ748';

// Report card persistence — same 3-tier pattern as chemical and policy
const _HAZARD_REPORT_API = (() => {
    try { return CONFIG.apiUrl.replace('/chat-template', '/chat-report'); } catch { return 'https://beta.whsmonitor.com.au/affinda/api/chat-report'; }
})();

let _hazardModalCache  = {};   // in-memory: key → { html, title }
let _hazardMcpUrlCache = null;
let _hazardMcpInitProm = null;

// Conversation memory
let _hazardChatResponseId  = null;
let _hazardSessionReady    = false;
let _lastHazardMessage     = null;
let _hazardDispatchInFlight = false; // re-entrancy guard — prevents double loading bubbles

/** Called by exitHazardMode() to wipe conversation memory on session end. */
function resetHazardChatMemory() {
    _hazardChatResponseId   = null;
    _hazardSessionReady     = false;
    _hazardDispatchInFlight = false;
}

/**
 * Add a transient thinking bubble directly to the DOM — NOT via addMessage().
 * Keeps it out of state.displayMessages so it is never saved or replayed on history open.
 */
function _addHazardThinkingBubble(thinkingId, label) {
    const area = document.getElementById('messagesArea');
    if (!area) return;
    const div = document.createElement('div');
    div.className = 'message assistant';
    div.innerHTML =
        `<div class="message-icon"><i class="ph-thin ph-chats-circle"></i></div>` +
        `<div class="message-content"><span id="${thinkingId}">` +
        `<div class="typing-thinking-wrap">` +
        `<span class="thinking-text"><i class="ph-thin ph-warning-circle" style="margin-right:6px"></i>${label}</span>` +
        `<div class="typing-indicator"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div>` +
        `</div></span></div>`;
    area.appendChild(div);
    if (typeof scrollToBottom === 'function') scrollToBottom();
}

async function _ensureHazardMcpUrl() {
    // Share the URL already resolved by the chemical module if available
    if (typeof _ensureChemicalMcpUrl === 'function') {
        return _ensureChemicalMcpUrl();
    }

    if (_hazardMcpUrlCache) return _hazardMcpUrlCache;
    if (_hazardMcpInitProm) return _hazardMcpInitProm;

    _hazardMcpInitProm = (async () => {
        const storeId = (typeof CONFIG !== 'undefined' && CONFIG.storeId)
            ? CONFIG.storeId
            : (() => { try { return JSON.parse(localStorage.getItem('jmemberData') || '{}').StoreID || 0; } catch { return 0; } })();

        const res = await fetch(`${_HAZARD_ARVENTA_BASE}/auth/generate-key`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ adminKey: _HAZARD_ARVENTA_ADMIN_KEY, storeId })
        });

        if (!res.ok) throw new Error(`generate-key ${res.status}`);
        const data = await res.json();
        _hazardMcpUrlCache = `${_HAZARD_ARVENTA_BASE}${data.url}`;
        console.log('[HazardMCP] MCP URL resolved:', _hazardMcpUrlCache);
        return _hazardMcpUrlCache;
    })();

    return _hazardMcpInitProm;
}

/** Build the tools array with the resolved MCP URL. */
async function _getHazardTools() {
    const mcpUrl = await _ensureHazardMcpUrl();
    return [
        {
            type: 'mcp',
            server_label: 'arventa-hazard-assistant',
            server_url: mcpUrl,
            require_approval: 'never'
        }
    ];
}

// ---------------------------------------------------------------------------
// Main exported intent handler
// ---------------------------------------------------------------------------

/**
 * @param {string}  message      - Raw user input
 * @param {boolean} forceHazard  - true when hazard mode is already locked
 * @returns {Promise<boolean>} true if handled
 */
async function checkAndHandleHazardIntent(message, forceHazard = false) {
    if (!CONFIG.openaiApiKey) return false;
    if (_hazardDispatchInFlight) return false;
    _hazardDispatchInFlight = true;

    // ── Pre-step: extract embedded intent signal from chip prompts ─────────
    // Chips prefix their prompts with [intent:list] etc. so we never need
    // to classify them — the intent is already known and reliable.
    let embeddedIntent = null;
    const intentPrefixMatch = message.match(/^\[intent:(list|view|chat)\]\s*/i);
    if (intentPrefixMatch) {
        embeddedIntent = intentPrefixMatch[1].toLowerCase();
        message = message.slice(intentPrefixMatch[0].length).trim();
    }
    _lastHazardMessage = message;

    // ── Step 1: Classify intent (skipped when embeddedIntent is present) ───
    // Returns: "no" | "chat" | "list" | "view"
    let intent = embeddedIntent;
    if (!embeddedIntent) try {
        const classifyRes = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            signal: AbortSignal.timeout(6000),
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${CONFIG.openaiApiKey}`
            },
            body: JSON.stringify({
                model: 'gpt-5.5',
                max_tokens: 10,
                temperature: 0,
                messages: [
                    {
                        role: 'system',
                        content: forceHazard
                            ? 'You classify user intent for a WHS hazard report assistant. Reply with exactly one word — "chat", "list", or "view".\n' +
                              '"view": user wants to open, show, display, or view the full details of ONE specific hazard report (e.g. "show me report 1234", "open report for warehouse incident").\n' +
                              '"list": user wants to see ALL hazard reports, a list, browse all reports, how many exist — phrases like "list all reports", "show all hazards", "how many hazards", "all incidents".\n' +
                              '"chat": everything else — questions about a specific hazard, trends, risk levels, corrective actions, status of reports.'
                            : 'You classify user intent. Reply with exactly one word — "no", "chat", "list", or "view".\n' +
                              '"no": (1) not related to WHS hazard reports/incidents/near-misses/inspections; OR (2) user wants to CREATE, START, SUBMIT, REPORT, or LOG a NEW hazard — e.g. "I want to report a hazard", "start a hazard report", "log an incident", "I saw a hazard", "I need to submit a hazard", "report a near miss". These go through the form pipeline — always return "no".\n' +
                              '"view": user wants to open, show, or view the full details of ONE specific EXISTING hazard report.\n' +
                              '"list": user wants to see ALL EXISTING hazard reports, a list, browse all hazards, how many exist, or wants a SUMMARY, OVERVIEW, or DASHBOARD of all hazard records.\n' +
                              '"chat": any other question about EXISTING hazard records — status, risk levels, corrective actions, trends, summaries of specific topics.'
                    },
                    { role: 'user', content: message }
                ]
            })
        });

        if (!classifyRes.ok) { if (!forceHazard) { _hazardDispatchInFlight = false; return false; } intent = 'chat'; }
        else {
            const classifyData = await classifyRes.json();
            if (typeof trackCost === 'function') trackCost('gpt-5.5', classifyData.usage);
            intent = classifyData.choices?.[0]?.message?.content?.trim().toLowerCase().replace(/[^a-z]/g, '');
        }
    } catch (err) {
        if (err.name === 'AbortError' || err.name === 'TimeoutError') {
            if (!forceHazard) { _hazardDispatchInFlight = false; return false; }
        } else {
            console.warn('[HazardIntent] classification failed:', err);
        }
        if (!forceHazard) { _hazardDispatchInFlight = false; return false; }
        intent = 'chat';
    }

    if (!embeddedIntent && !forceHazard && intent === 'no') { _hazardDispatchInFlight = false; return false; }
    if (intent !== 'chat' && intent !== 'list' && intent !== 'view') {
        if (!forceHazard) { _hazardDispatchInFlight = false; return false; }
        intent = 'chat';
    }

    // Hazard intent confirmed — activate hazard mode banner
    if (typeof enterHazardMode === 'function') enterHazardMode();
    await _ensureHazardSession(message);

    // ── Step 2: Show user bubble + thinking indicator ──────────────────────
    addMessage('user', message);
    state._initialMessageBubbleShown = true;

    const thinkingId    = 'haz-thinking-' + Date.now();
    const thinkingLabel = intent === 'view'
        ? 'Loading hazard report&hellip;'
        : intent === 'list'
        ? 'Fetching hazard reports&hellip;'
        : 'Looking up hazard information&hellip;';
    _addHazardThinkingBubble(thinkingId, thinkingLabel);

    try {
        if (intent === 'view') {
            await _runHazardView(message, thinkingId);
        } else if (intent === 'list') {
            await _runHazardList(message, thinkingId);
        } else {
            await _runHazardChat(message, thinkingId);
        }
    } finally {
        _hazardDispatchInFlight = false;
    }

    return true;
}

/**
 * Action-only dispatcher — called by chat-router.js when sub-intent is already known.
 */
async function _dispatchHazardAction(message, subIntent) {
    if (_hazardDispatchInFlight) return false;
    _hazardDispatchInFlight = true;
    _lastHazardMessage = message;

    if (typeof enterHazardMode === 'function') enterHazardMode();
    await _ensureHazardSession(message);

    addMessage('user', message);
    state._initialMessageBubbleShown = true;

    const thinkingId    = 'haz-thinking-' + Date.now();
    const thinkingLabel = subIntent === 'view'
        ? 'Loading hazard report&hellip;'
        : subIntent === 'list'
        ? 'Fetching hazard reports&hellip;'
        : 'Looking up hazard information&hellip;';
    _addHazardThinkingBubble(thinkingId, thinkingLabel);

    try {
        if (subIntent === 'view') {
            await _runHazardView(message, thinkingId);
        } else if (subIntent === 'list') {
            await _runHazardList(message, thinkingId);
        } else {
            await _runHazardChat(message, thinkingId);
        }
    } finally {
        _hazardDispatchInFlight = false;
    }

    return true;
}

// ---------------------------------------------------------------------------
// Fetch with auto-retry on timeout
// ---------------------------------------------------------------------------
async function _hazardFetchWithRetry(fetchFactory, thinkingId = null, maxAttempts = 3) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await fetchFactory();
        } catch (err) {
            const isTimeout = err.name === 'AbortError' || err.name === 'TimeoutError';
            if (isTimeout && attempt < maxAttempts) {
                const el  = thinkingId ? document.getElementById(thinkingId) : null;
                const txt = el?.querySelector('.thinking-text');
                if (txt) txt.innerHTML = `<i class="ph-thin ph-arrow-clockwise" style="margin-right:6px"></i>Retrying&nbsp;(${attempt + 1}/${maxAttempts})&hellip;`;
                await new Promise(r => setTimeout(r, 1500));
            } else {
                throw err;
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Chat mode — conversational hazard answer via MCP
// ---------------------------------------------------------------------------
async function _runHazardChat(message, thinkingId) {
    try {
        const res = await _hazardFetchWithRetry(async () => fetch('https://api.openai.com/v1/responses', {
            method: 'POST',
            signal: AbortSignal.timeout(60000),
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${CONFIG.openaiApiKey}`
            },
            body: JSON.stringify({
                model: 'gpt-5.5',
                instructions:
                    'You are a helpful WHS (Work Health & Safety) hazard report assistant. ' +
                    'Use the get_hazard_reports MCP tool to search and retrieve hazard reports for the store. ' +
                    'Answer the user\'s question clearly and concisely, referencing the actual reports found. ' +
                    'When listing reports, format them as a clean numbered list showing: Report ID, title/description, location, and status. ' +
                    'When summarising a report, highlight the hazard description, risk level, corrective actions, and current status. ' +
                    'Use plain conversational language — no JSON output. ' +
                    'Remember previous exchanges in this conversation for coherent follow-up answers. ' +
                    'If the user wants full details of a specific report, tell them to say "show me report [ID or title]".',
                input: [{ role: 'user', content: message }],
                ...(_hazardChatResponseId ? { previous_response_id: _hazardChatResponseId } : {}),
                tools: await _getHazardTools()
            })
        }), thinkingId);

        const thinkingEl = document.getElementById(thinkingId);
        if (thinkingEl) thinkingEl.closest('.message')?.remove();

        if (!res.ok) {
            const errBody = await res.text();
            console.error('[HazardChat] API error:', res.status, errBody);
            addMessage('assistant', 'Sorry, I could not retrieve hazard report information right now. Please try again.');
            return;
        }

        const data = await res.json();
        if (data.id) _hazardChatResponseId = data.id;

        let outputText = _extractHazardOutputText(data);
        if (!outputText) {
            outputText = 'I retrieved a response but could not extract the text. Please check the console.';
            console.warn('[HazardChat] Unexpected response shape:', data);
        }

        const html = (typeof marked !== 'undefined') ? marked.parse(outputText) : outputText.replace(/\n/g, '<br>');
        addMessage('assistant', html);
        scrollToBottom();
        if (typeof saveTranscript === 'function') saveTranscript();
        _showHazardContextualChips(message, 'chat', outputText);

    } catch (err) {
        const thinkingEl = document.getElementById(thinkingId);
        if (thinkingEl) thinkingEl.closest('.message')?.remove();
        if (err.name === 'AbortError' || err.name === 'TimeoutError') {
            addMessage('assistant',
                'This hazard lookup timed out after 3 attempts.<br>' +
                '<button class="btn btn-sm btn-outline-primary mt-2" onclick="checkAndHandleHazardIntent(_lastHazardMessage)">&#x21ba;&nbsp;Retry</button>'
            );
        } else {
            console.error('[HazardChat] fetch error:', err);
            addMessage('assistant', 'An error occurred. Please try again.');
        }
    }
}

// ---------------------------------------------------------------------------
// List mode — Hazard Overview Dashboard (opens in modal with 4 tabs)
// ---------------------------------------------------------------------------
async function _runHazardList(message, thinkingId) {
    try {
        const res = await _hazardFetchWithRetry(async () => fetch('https://api.openai.com/v1/responses', {
            method: 'POST',
            signal: AbortSignal.timeout(60000),
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${CONFIG.openaiApiKey}`
            },
            body: JSON.stringify({
                model: 'gpt-5.5',
                instructions:
                    'You are a WHS hazard report analyst. Use get_hazard_reports to retrieve ALL hazard reports for this store (use maxRows:50 or no filters). ' +
                    'The MCP tool returns an ARRAY of objects, each shaped as: { header: { RegOthID, InternalNo, TitleDesc, IncidentDate, LocationName, ReportedByName, HazardType, DocState, ... }, controls: [ { ActionText, RegisterStatusID, AssignedTo, Deadline, ActionCompletedOn, ... } ] }. ' +
                    'Map header.InternalNo → report_id, header.TitleDesc → title, header.LocationName → location, header.ReportedByName → reported_by, header.IncidentDate → report_date, header.DocState → status. ' +
                    'Map each item in controls[] → corrective_actions[]: ActionText → text, use RegisterStatusID or status name → status, AssignedTo → assigned_to, Deadline → due_date, ActionCompletedOn → completed_date. ' +
                    'Infer risk_level (low/medium/high/critical) from hazard description context. ' +
                    'Return STRICT JSON only — no markdown, no explanations:\n' +
                    '{\n' +
                    '  "reports": [\n' +
                    '    {\n' +
                    '      "report_id": "HAZ-NNN",\n' +
                    '      "title": "string — hazard title or description",\n' +
                    '      "location": "string — site area",\n' +
                    '      "reported_by": "string — reporter full name",\n' +
                    '      "report_date": "DD Mon YYYY",\n' +
                    '      "month_year": "Mon YYYY",\n' +
                    '      "risk_level": "low|medium|high|critical (lowercase)",\n' +
                    '      "status": "string — current status (Open, In Progress, Closed, Draft …)",\n' +
                    '      "summary": "string — one sentence describing the hazard",\n' +
                    '      "corrective_actions": [{"text":"string","status":"Pending|Completed|Overdue","assigned_to":"string or null","due_date":"DD Mon YYYY or null","completed_date":"DD Mon YYYY or null"}]\n' +
                    '    }\n' +
                    '  ]\n' +
                    '}\n' +
                    'Use actual values from the MCP response. risk_level must be lowercase: low, medium, high, or critical. If controls[] is empty, set corrective_actions to [].',
                input: [{ role: 'user', content: message }],
                ...(_hazardChatResponseId ? { previous_response_id: _hazardChatResponseId } : {}),
                tools: await _getHazardTools()
            })
        }), thinkingId);

        const thinkingEl = document.getElementById(thinkingId);
        if (thinkingEl) thinkingEl.closest('.message')?.remove();

        if (!res.ok) {
            const errBody = await res.text();
            console.error('[HazardList] API error:', res.status, errBody);
            addMessage('assistant', 'Sorry, I could not load the hazard reports overview right now. Please try again.');
            return;
        }

        const data = await res.json();
        if (data.id) _hazardChatResponseId = data.id;

        // Parse structured JSON from response
        const rawText   = _extractHazardOutputText(data) || '';
        console.log('[HazardList] raw output:', rawText.slice(0, 500));
        const overviewData = _parseHazardJson(rawText);

        if (!overviewData || !Array.isArray(overviewData.reports)) {
            console.warn('[HazardList] could not parse reports array. Raw:', rawText.slice(0, 800));
            addMessage('assistant', 'I retrieved the reports but could not build the overview. Please try rephrasing your request.');
            return;
        }

        const count         = overviewData.reports.length;
        const overviewHtml  = _buildHazardOverviewHtml(overviewData);
        const overviewTitle = `Hazard Overview \u2014 ${count} Report${count !== 1 ? 's' : ''}`;

        const _hazIdx  = _saveHazardModal(overviewHtml, overviewTitle);

        const _he      = s => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const highCrit = overviewData.reports.filter(r => /^(high|critical)$/i.test(r.risk_level || '')).length;
        const openRep  = overviewData.reports.filter(r => /^open$/i.test(r.status || '')).length;
        const pendActs = overviewData.reports.reduce((s, r) => s + (Array.isArray(r.corrective_actions)
            ? r.corrective_actions.filter(a => !/^(completed|done|closed)$/i.test((typeof a === 'string' ? '' : a.status) || '')).length
            : 0), 0);
        addMessage('assistant',
            `I found <strong>${_he(String(count))} hazard report${count !== 1 ? 's' : ''}</strong> on record. ` +
            `${openRep > 0 ? `${_he(String(openRep))} ${openRep === 1 ? 'is' : 'are'} still open` : 'All reports are closed'}` +
            `${highCrit > 0 ? `, ${_he(String(highCrit))} rated high or critical risk` : ''}` +
            `${pendActs > 0 ? `, and ${_he(String(pendActs))} corrective action${pendActs !== 1 ? 's' : ''} pending` : ''}.` +
            `<br><br>Click below to open the full dashboard with charts and corrective actions:` +
            `<br><button class="btn btn-sm btn-outline-primary mt-2" onclick="_reopenHazardModal('${_hazIdx}')"><i class="ph-thin ph-arrow-square-out me-1"></i>Open Dashboard</button>`
        );
        scrollToBottom();
        if (typeof saveTranscript === 'function') saveTranscript();
        _showHazardContextualChips(message, 'list', '');

    } catch (err) {
        const thinkingEl = document.getElementById(thinkingId);
        if (thinkingEl) thinkingEl.closest('.message')?.remove();
        if (err.name === 'AbortError' || err.name === 'TimeoutError') {
            addMessage('assistant',
                'This request timed out after 3 attempts.<br>' +
                '<button class="btn btn-sm btn-outline-primary mt-2" onclick="checkAndHandleHazardIntent(_lastHazardMessage)">&#x21ba;&nbsp;Retry</button>'
            );
        } else {
            console.error('[HazardList] fetch error:', err);
            addMessage('assistant', 'An error occurred. Please try again.');
        }
    }
}

// ---------------------------------------------------------------------------
// View mode — full hazard report card in popup modal
// ---------------------------------------------------------------------------
let _lastHazardReportHtml  = '';
let _lastHazardReportTitle = '';

async function _runHazardView(message, thinkingId) {
    try {
        const res = await _hazardFetchWithRetry(async () => fetch('https://api.openai.com/v1/responses', {
            method: 'POST',
            signal: AbortSignal.timeout(60000),
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${CONFIG.openaiApiKey}`
            },
            body: JSON.stringify({
                model: 'gpt-5.5',
                instructions:
                    'You are a WHS hazard report analyst. Use get_hazard_reports with regOthId or search by titleDesc/locationName to retrieve the report. ' +
                    'The MCP tool returns an ARRAY of objects shaped as: { header: { RegOthID, InternalNo, TitleDesc, IncidentDate, LocationName, ReportedByName, HazardType, HazardSubType, DocState, IsDraft, ... }, controls: [ { ActionText, RegisterStatusID, AssignedTo, Deadline, ActionCompletedOn, ... } ], checklist: [ { SectionName, HazardDesc, HazardValue, StatementType } ] }. ' +
                    'Use the FIRST matching record. Map: header.TitleDesc → report_title, header.InternalNo → internal_no, header.LocationName → location, header.DocState or (header.IsDraft ? "Draft" : "Open") → status, header.IncidentDate → report_date, header.ReportedByName → reported_by, header.HazardType → hazard_type, header.RegOthID → reg_oth_id. ' +
                    'Map each item in controls[] → corrective_actions[]: ActionText → text, RegisterStatusID/status name → status (Pending/Completed/Overdue), AssignedTo → assigned_to, Deadline → due_date, ActionCompletedOn → completed_date. ' +
                    'Map checklist items → checklist[]: SectionName → section, HazardDesc → question, HazardValue → answer. ' +
                    'Infer risk_level (low/medium/high/critical) from hazard context. ' +
                    'Return STRICT JSON only — no markdown, no explanations:\n' +
                    '{\n' +
                    '  "report_title": "string",\n' +
                    '  "internal_no": "string",\n' +
                    '  "location": "string",\n' +
                    '  "status": "string",\n' +
                    '  "report_date": "string",\n' +
                    '  "reported_by": "string",\n' +
                    '  "hazard_type": "string",\n' +
                    '  "risk_level": "string",\n' +
                    '  "summary": "string (2–3 sentence plain-English summary of the hazard)",\n' +
                    '  "corrective_actions": [{"text":"string","status":"Pending|Completed|Overdue","assigned_to":"string or null","due_date":"DD Mon YYYY or null","completed_date":"DD Mon YYYY or null"}],\n' +
                    '  "checklist": [{"section": "string", "question": "string", "answer": "string"}],\n' +
                    '  "reg_oth_id": 0\n' +
                    '}\n' +
                    'Use actual values from the MCP response. Use null for missing fields. If controls[] is empty, set corrective_actions to [].',
                input: [{ role: 'user', content: message }],
                tools: await _getHazardTools()
            })
        }), thinkingId);

        const thinkingEl = document.getElementById(thinkingId);
        if (thinkingEl) thinkingEl.closest('.message')?.remove();

        if (!res.ok) {
            const errBody = await res.text();
            console.error('[HazardView] API error:', res.status, errBody);
            addMessage('assistant', 'Sorry, I could not load that hazard report. Please try again.');
            return;
        }

        const data = await res.json();

        // Extract JSON from the response
        const rawText = _extractHazardOutputText(data) || '';
        console.log('[HazardView] raw output:', rawText.slice(0, 500));
        const reportJson = _parseHazardJson(rawText);

        if (!reportJson) {
            addMessage('assistant', 'I found a response but could not parse the report details. Please try rephrasing your request.');
            return;
        }

        const cardHtml  = _buildHazardReportCard(reportJson);
        const cardTitle = reportJson.report_title || 'Hazard Report';
        _lastHazardReportHtml  = cardHtml;
        _lastHazardReportTitle = cardTitle;

        // Save → add reopen button (modal only opens when user clicks)
        const _hazIdx = _saveHazardModal(cardHtml, cardTitle);
        const _he = s => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        addMessage('assistant',
            `Here is the hazard report for <strong>${_he(cardTitle)}</strong>. ` +
            `Click below to open the full report card with details and corrective actions:` +
            `<br><button class="btn btn-sm btn-outline-primary mt-2" onclick="_reopenHazardModal('${_hazIdx}')"><i class="ph-thin ph-arrow-square-out me-1"></i>Open Report</button>`
        );
        scrollToBottom();
        if (typeof saveTranscript === 'function') saveTranscript();

    } catch (err) {
        const thinkingEl = document.getElementById(thinkingId);
        if (thinkingEl) thinkingEl.closest('.message')?.remove();
        if (err.name === 'AbortError' || err.name === 'TimeoutError') {
            addMessage('assistant',
                'This report lookup timed out after 3 attempts.<br>' +
                '<button class="btn btn-sm btn-outline-primary mt-2" onclick="checkAndHandleHazardIntent(_lastHazardMessage)">&#x21ba;&nbsp;Retry</button>'
            );
        } else {
            console.error('[HazardView] fetch error:', err);
            addMessage('assistant', 'An error occurred. Please try again.');
        }
    }
}

// ---------------------------------------------------------------------------
// Hazard Report Card builder
// ---------------------------------------------------------------------------
function _buildHazardReportCard(r) {
    const esc = s => (s || '—').toString().replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

    const riskColour = {
        'low':      '#22c55e',
        'medium':   '#f59e0b',
        'high':     '#ef4444',
        'critical': '#7c3aed'
    }[( r.risk_level || '').toLowerCase()] || '#64748b';

    const actionsHtml = Array.isArray(r.corrective_actions) && r.corrective_actions.length
        ? r.corrective_actions.map(a => {
            if (typeof a === 'string') return `<li style="margin-bottom:4px">${esc(a)}</li>`;
            const isDone    = /^(completed|done|closed)$/i.test(a.status || '');
            const isOverdue = !isDone && a.due_date && new Date(a.due_date) < new Date();
            const stBg  = isDone ? '#dcfce7' : isOverdue ? '#fee2e2' : '#fef3c7';
            const stCol = isDone ? '#16a34a' : isOverdue ? '#dc2626' : '#d97706';
            const stTxt = isDone ? 'Completed' : isOverdue ? 'Overdue' : (a.status || 'Pending');
            return `<li style="list-style:none;margin-left:-18px;padding:9px 11px;border:1px solid #e2e8f0;border-radius:7px;margin-bottom:7px;background:#f8fafc;">` +
                `<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">` +
                `<span style="font-size:13px;color:#0f172a;">${esc(a.text || '')}</span>` +
                `<span style="background:${stBg};color:${stCol};font-size:9px;padding:2px 7px;border-radius:3px;white-space:nowrap;text-transform:uppercase;flex-shrink:0;">${esc(stTxt)}</span>` +
                `</div>` +
                (a.assigned_to ? `<div style="font-size:11px;color:#64748b;margin-top:4px;"><i class="ph-thin ph-user" style="margin-right:3px"></i>${esc(a.assigned_to)}</div>` : '') +
                (a.due_date ? `<div style="font-size:11px;color:${isOverdue ? '#dc2626' : '#64748b'};margin-top:2px;"><i class="ph-thin ph-calendar" style="margin-right:3px"></i>Due: ${esc(a.due_date)}</div>` : '') +
                (isDone && a.completed_date ? `<div style="font-size:11px;color:#16a34a;margin-top:2px;"><i class="ph-thin ph-check" style="margin-right:3px"></i>Completed: ${esc(a.completed_date)}</div>` : '') +
                `</li>`;
        }).join('')
        : '<li>No corrective actions recorded.</li>';

    const checklistHtml = Array.isArray(r.checklist) && r.checklist.length
        ? r.checklist.map(row =>
            `<tr>
               <td style="padding:5px 8px;border-bottom:1px solid #f1f5f9;color:#64748b;font-size:12px;">${esc(row.section)}</td>
               <td style="padding:5px 8px;border-bottom:1px solid #f1f5f9;font-size:12px;">${esc(row.question)}</td>
               <td style="padding:5px 8px;border-bottom:1px solid #f1f5f9;font-size:12px;">${esc(row.answer)}</td>
             </tr>`
          ).join('')
        : `<tr><td colspan="3" style="padding:8px;color:#94a3b8;font-size:12px;text-align:center;">No checklist data available.</td></tr>`;

    return `
<div class="haz-card" style="border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;font-family:'Segoe UI',Arial,sans-serif;max-width:680px;">
  <!-- Header -->
  <div style="background:linear-gradient(135deg,#1e3a5f,#2563eb);color:#fff;padding:18px 20px;">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">
      <div>
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;opacity:.75;margin-bottom:4px;">
          <i class="ph-thin ph-warning-circle" style="margin-right:4px"></i>Hazard Report
        </div>
        <div style="font-size:18px;line-height:1.3;">${esc(r.report_title)}</div>
        ${r.internal_no ? `<div style="font-size:12px;opacity:.8;margin-top:3px;">#${esc(r.internal_no)}</div>` : ''}
      </div>
      <span style="background:${riskColour};color:#fff;padding:4px 12px;border-radius:20px;font-size:11px;white-space:nowrap;align-self:flex-start;">
        ${esc(r.risk_level || 'Unknown')} Risk
      </span>
    </div>
  </div>

  <!-- Meta row -->
  <div style="display:flex;flex-wrap:wrap;gap:0;border-bottom:1px solid #e2e8f0;">
    ${_hazMetaCell('ph-map-pin',     'Location',    r.location)}
    ${_hazMetaCell('ph-calendar',    'Date',         r.report_date)}
    ${_hazMetaCell('ph-user',        'Reported By',  r.reported_by)}
    ${_hazMetaCell('ph-tag',         'Hazard Type',  r.hazard_type)}
    ${_hazMetaCell('ph-check-circle','Status',        r.status)}
  </div>

  <!-- Summary -->
  ${r.summary ? `
  <div style="padding:14px 20px;background:#f8fafc;border-bottom:1px solid #e2e8f0;">
    <div style="font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:#94a3b8;margin-bottom:5px;">Summary</div>
    <div style="font-size:13px;color:#374151;line-height:1.6;">${esc(r.summary)}</div>
  </div>` : ''}

  <!-- Corrective Actions -->
  <div style="padding:14px 20px;border-bottom:1px solid #e2e8f0;">
    <div style="font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:#94a3b8;margin-bottom:8px;">Corrective Actions</div>
    <ul style="margin:0;padding-left:18px;font-size:13px;color:#374151;line-height:1.8;">${actionsHtml}</ul>
  </div>

  <!-- Checklist -->
  ${Array.isArray(r.checklist) && r.checklist.length ? `
  <div style="padding:14px 20px 0;">
    <div style="font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:#94a3b8;margin-bottom:8px;">Report Details</div>
    <div style="overflow-x:auto;">
      <table style="width:100%;border-collapse:collapse;font-size:12px;">
        <thead>
          <tr style="background:#f1f5f9">
            <th style="padding:6px 8px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:#64748b;font-weight:600;border-bottom:2px solid #e2e8f0;">Section</th>
            <th style="padding:6px 8px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:#64748b;font-weight:600;border-bottom:2px solid #e2e8f0;">Question</th>
            <th style="padding:6px 8px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:#64748b;font-weight:600;border-bottom:2px solid #e2e8f0;">Answer</th>
          </tr>
        </thead>
        <tbody>${checklistHtml}</tbody>
      </table>
    </div>
  </div>` : ''}

  <!-- Footer actions -->
  <div style="padding:12px 20px;display:flex;gap:8px;flex-wrap:wrap;">
    <button class="btn btn-sm" style="background:#1e3a5f;color:#fff;border:none;border-radius:6px;padding:6px 14px;font-size:12px;cursor:pointer;"
      onclick="printHazardReport()">
      <i class="ph-thin ph-printer" style="margin-right:5px"></i>Print / PDF
    </button>
    <button class="btn btn-sm" style="background:#f1f5f9;color:#374151;border:1px solid #e2e8f0;border-radius:6px;padding:6px 14px;font-size:12px;cursor:pointer;"
      onclick="checkAndHandleHazardIntent('show all hazard reports')">
      <i class="ph-thin ph-list" style="margin-right:5px"></i>All Reports
    </button>
  </div>
</div>`;
}

function _hazMetaCell(icon, label, value) {
    const esc = s => (s || '—').toString().replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    return `<div style="padding:10px 16px;flex:1;min-width:140px;border-right:1px solid #e2e8f0;">
      <div style="font-size:10px;color:#94a3b8;margin-bottom:3px;"><i class="ph-thin ${icon}" style="margin-right:3px"></i>${label}</div>
      <div style="font-size:13px;font-weight:600;color:#1e293b;">${esc(value)}</div>
    </div>`;
}

function printHazardReport() {
    if (!_lastHazardReportHtml) return;
    const win = window.open('', '_blank', 'width=1000,height=800');
    win.document.write(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>WHS Hazard Report — ${(_lastHazardReportTitle || '').replace(/</g,'&lt;')}</title>
  <style>
    * { box-sizing:border-box; margin:0; padding:0; -webkit-print-color-adjust:exact!important; print-color-adjust:exact!important; }
    body { font-family:"Segoe UI",Arial,sans-serif; background:#fff; padding:20px; }
    @media print { @page { margin:10mm; size:A4 portrait; } }
    .haz-card { max-width:100%!important; border:none!important; }
  </style>
</head>
<body>
  ${_lastHazardReportHtml}
  <script>window.onload=function(){window.print();window.onafterprint=function(){window.close();};};<\/script>
</body>
</html>`);
    win.document.close();
}

// ---------------------------------------------------------------------------
// Overview Dashboard builder helpers
// ---------------------------------------------------------------------------
function _hovStat(num, label, sub, color) {
    const c = color || '#0f172a';
    return '<div style="background:#fff;padding:14px 16px;">' +
        `<div style="font-size:26px;line-height:1;color:${c}">${num}</div>` +
        `<div style="font-size:9px;text-transform:uppercase;letter-spacing:.4px;color:#94a3b8;margin-top:3px;">${label}</div>` +
        (sub ? `<div style="font-size:10px;margin-top:5px;color:${c}">${sub}</div>` : '') +
        '</div>';
}

function _hovCardHdr(icon, ciStyle, title, sub) {
    return '<div style="display:flex;align-items:center;gap:12px;padding:15px 20px;border-bottom:1px solid #e2e8f0;background:#f8fafc;">' +
        `<div style="width:36px;height:36px;border-radius:9px;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0;${ciStyle}"><i class="ph-thin ${icon}"></i></div>` +
        `<div><div style="font-size:14px;font-weight:800;color:#0f172a;">${title}</div><div style="font-size:11px;color:#64748b;margin-top:1px;">${sub}</div></div>` +
        '</div>';
}

function _hovActStat(num, label, color) {
    return `<div style="flex:1;background:#fff;padding:12px 16px;">` +
        `<div style="font-size:22px;line-height:1;color:${color || '#0f172a'}">${num}</div>` +
        `<div style="font-size:9px;text-transform:uppercase;letter-spacing:.4px;color:#94a3b8;margin-top:2px;">${label}</div>` +
        '</div>';
}

/** Build the full Hazard Overview Dashboard HTML — injected into the SDS modal. */
function _buildHazardOverviewHtml(data) {
    const esc     = s => (s || '—').toString().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const reports = Array.isArray(data.reports) ? data.reports : [];

    // ── KPI stats ────────────────────────────────────────────────────────
    const total          = reports.length;
    const openCount      = reports.filter(r => /^open$/i.test(r.status    || '')).length;
    const highCritCount  = reports.filter(r => /^(high|critical)$/i.test(r.risk_level || '')).length;
    const closedCount    = reports.filter(r => /^closed$/i.test(r.status  || '')).length;
    const inProgCount    = reports.filter(r => /^in.?progress$/i.test(r.status || '')).length;
    const pendingActions = reports
        .reduce((s, r) => {
            if (!Array.isArray(r.corrective_actions)) return s;
            return s + r.corrective_actions.filter(a => {
                const st = typeof a === 'string' ? r.status : (a.status || '');
                return !/^(completed|done|closed)$/i.test(st);
            }).length;
        }, 0);

    // ── Donut chart (r=38, C=238.76) ─────────────────────────────────────
    const riskOrder  = ['critical', 'high', 'medium', 'low'];
    const riskColors = { critical: '#7c3aed', high: '#ef4444', medium: '#f59e0b', low: '#22c55e' };
    const riskCounts = { critical: 0, high: 0, medium: 0, low: 0 };
    reports.forEach(r => {
        const rl = (r.risk_level || '').toLowerCase();
        if (riskCounts[rl] !== undefined) riskCounts[rl]++; else riskCounts.low++;
    });
    const DC = 238.76;
    let cumOff = 0;
    const donutSegs = riskOrder.map(l => {
        const n = riskCounts[l]; if (!n) return '';
        const len = (n / (total || 1)) * DC;
        const seg = `<circle cx="50" cy="50" r="38" fill="none" stroke="${riskColors[l]}" stroke-width="13" stroke-dasharray="${len.toFixed(1)} ${(DC - len).toFixed(1)}" stroke-dashoffset="${(-cumOff).toFixed(1)}" transform="rotate(-90 50 50)"/>`;
        cumOff += len; return seg;
    }).join('');

    // ── Status bars ───────────────────────────────────────────────────────
    const statusCounts = {};
    reports.forEach(r => { const s = (r.status || 'Unknown').trim(); statusCounts[s] = (statusCounts[s] || 0) + 1; });
    const maxSt  = Math.max(...Object.values(statusCounts), 1);
    const stDefs = [
        { pat: /^open$/i,         col: '#d97706', ico: 'ph-warning-circle' },
        { pat: /^in.?progress$/i, col: '#2563eb', ico: 'ph-arrows-clockwise' },
        { pat: /^pending/i,       col: '#7c3aed', ico: 'ph-hourglass' },
        { pat: /^closed$/i,       col: '#16a34a', ico: 'ph-check-circle' }
    ];
    const statusBarsHtml = Object.entries(statusCounts).sort(([, a], [, b]) => b - a).map(([st, cnt]) => {
        const d = stDefs.find(x => x.pat.test(st)) || { col: '#94a3b8', ico: 'ph-minus' };
        const w = Math.round(cnt / maxSt * 100);
        return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">` +
            `<div style="width:116px;font-size:12px;color:#475569;display:flex;align-items:center;gap:6px;flex-shrink:0;"><i class="ph-thin ${d.ico}" style="color:${d.col}"></i>${esc(st)}</div>` +
            `<div style="flex:1;height:10px;background:#f1f5f9;border-radius:5px;overflow:hidden;"><div style="width:${w}%;height:100%;background:${d.col};border-radius:5px;"></div></div>` +
            `<div style="width:22px;text-align:right;font-size:12px;font-weight:800;color:#0f172a;">${cnt}</div></div>`;
    }).join('');

    // ── Location bars ─────────────────────────────────────────────────────
    const locCounts  = {};
    reports.forEach(r => { const l = (r.location || 'Unknown').trim(); locCounts[l] = (locCounts[l] || 0) + 1; });
    const locEntries = Object.entries(locCounts).sort(([, a], [, b]) => b - a).slice(0, 8);
    const maxLoc     = Math.max(...locEntries.map(([, c]) => c), 1);
    const locCols    = ['#dc2626','#ef4444','#f97316','#f59e0b','#3b82f6','#8b5cf6','#06b6d4','#22c55e'];
    const locBarsHtml = locEntries.map(([loc, cnt], i) => {
        const w = Math.round(cnt / maxLoc * 100);
        return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">` +
            `<div style="width:116px;font-size:11px;color:#475569;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex-shrink:0;" title="${esc(loc)}">${esc(loc)}</div>` +
            `<div style="flex:1;height:22px;background:#f1f5f9;border-radius:5px;overflow:hidden;"><div style="width:${w}%;height:100%;background:${locCols[i % locCols.length]};border-radius:5px;display:flex;align-items:center;padding-left:10px;min-width:28px;"><span style="font-size:10px;color:#fff;">${cnt}</span></div></div>` +
            `<div style="width:20px;text-align:right;font-size:12px;font-weight:800;color:#0f172a;">${cnt}</div></div>`;
    }).join('');

    // ── Monthly trend ─────────────────────────────────────────────────────
    const monCounts  = {};
    reports.forEach(r => { const m = (r.month_year || '?').trim(); monCounts[m] = (monCounts[m] || 0) + 1; });
    const monOrder   = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const monEntries = Object.entries(monCounts).sort(([a], [b]) => {
        const [mA, yA] = a.split(' '), [mB, yB] = b.split(' ');
        const yD = parseInt(yA || 0) - parseInt(yB || 0); if (yD !== 0) return yD;
        return monOrder.indexOf(mA) - monOrder.indexOf(mB);
    });
    const maxMon    = Math.max(...monEntries.map(([, c]) => c), 1);
    const trendHtml = monEntries.map(([mon, cnt]) => {
        const h = Math.round(cnt / maxMon * 100);
        return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;height:100%;justify-content:flex-end;">` +
            `<div style="font-size:10px;font-weight:800;color:#475569;">${cnt}</div>` +
            `<div style="width:100%;height:${h}%;background:#3b82f6;border-radius:4px 4px 0 0;min-height:4px;"></div>` +
            `<div style="font-size:9px;color:#94a3b8;">${esc((mon || '?').split(' ')[0])}</div></div>`;
    }).join('');

    // ── All Reports table ────────────────────────────────────────────────
    const rb = rl => {
        const m = { critical: 'background:#7c3aed;color:#fff', high: 'background:#fee2e2;color:#991b1b;border:1px solid #fecaca', medium: 'background:#fef3c7;color:#92400e;border:1px solid #fde68a', low: 'background:#dcfce7;color:#166534;border:1px solid #bbf7d0' };
        const s = m[(rl || '').toLowerCase()] || 'background:#f1f5f9;color:#64748b';
        return `<span style="display:inline-flex;font-size:10px;padding:3px 9px;border-radius:5px;text-transform:uppercase;${s}">${esc(rl || '?')}</span>`;
    };
    const stChip = st => {
        const m = { open: 'background:#fef3c7;color:#92400e', closed: 'background:#dcfce7;color:#166534', 'in progress': 'background:#dbeafe;color:#1e40af' };
        const s = m[(st || '').toLowerCase()] || 'background:#ede9fe;color:#5b21b6';
        return `<span style="display:inline-flex;align-items:center;gap:5px;font-size:10px;padding:3px 9px;border-radius:20px;${s}"><span style="width:6px;height:6px;border-radius:50%;background:currentColor;"></span>${esc(st || '?')}</span>`;
    };
    const thS = 'text-align:left;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.4px;color:#94a3b8;padding:9px 14px;border-bottom:1px solid #e2e8f0;background:#f8fafc;white-space:nowrap;';
    const tableRows = [...reports]
        .sort((a, b) => new Date(b.report_date || 0) - new Date(a.report_date || 0))
        .map(r =>
            `<tr style="border-bottom:1px solid #f1f5f9;">` +
            `<td style="padding:10px 14px;vertical-align:middle;"><span style="font-size:11px;color:#1e3a8a;">${esc(r.report_id)}</span></td>` +
            `<td style="padding:10px 14px;vertical-align:middle;font-size:13px;font-weight:600;color:#0f172a;">${esc(r.title)}</td>` +
            `<td style="padding:10px 14px;vertical-align:middle;font-size:12px;color:#475569;">${esc(r.location)}</td>` +
            `<td style="padding:10px 14px;vertical-align:middle;font-size:12px;color:#475569;">${esc(r.reported_by)}</td>` +
            `<td style="padding:10px 14px;vertical-align:middle;font-size:12px;color:#475569;white-space:nowrap;">${esc(r.report_date)}</td>` +
            `<td style="padding:10px 14px;vertical-align:middle;">${rb(r.risk_level)}</td>` +
            `<td style="padding:10px 14px;vertical-align:middle;">${stChip(r.status)}</td></tr>`
        ).join('');

    // ── Risk score dial (r=50, 270°arc=235.6, start offset=-39.3) ────────
    const rScores  = { critical: 100, high: 75, medium: 50, low: 25 };
    const avgScore = total > 0
        ? Math.round(reports.reduce((s, r) => s + (rScores[(r.risk_level || '').toLowerCase()] || 25), 0) / total)
        : 0;
    const dialCol  = avgScore >= 75 ? '#ef4444' : avgScore >= 50 ? '#f59e0b' : '#22c55e';
    const dialLvl  = avgScore >= 75 ? 'HIGH Risk' : avgScore >= 50 ? 'MEDIUM Risk' : 'LOW Risk';
    const dialLvlS = avgScore >= 75 ? 'background:#fee2e2;color:#991b1b' : avgScore >= 50 ? 'background:#fef3c7;color:#92400e' : 'background:#dcfce7;color:#166534';
    const dialArc  = 235.6, dialC = 314.16;
    const dialFill = (avgScore / 100) * dialArc, dialGap = dialC - dialFill;

    // ── Top 4 risk reports ────────────────────────────────────────────────
    const rRank    = { critical: 4, high: 3, medium: 2, low: 1 };
    const topRisks = [...reports].sort((a, b) => {
        const rd = (rRank[(b.risk_level || '').toLowerCase()] || 0) - (rRank[(a.risk_level || '').toLowerCase()] || 0);
        return rd !== 0 ? rd : (/^open$/i.test(b.status || '') ? 1 : 0) - (/^open$/i.test(a.status || '') ? 1 : 0);
    }).slice(0, 4);
    const rankCols     = ['#dc2626','#f97316','#f59e0b','#94a3b8'];
    const topRisksHtml = topRisks.map((r, i) =>
        `<div style="display:flex;align-items:flex-start;gap:10px;padding:10px 14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;margin-bottom:8px;">` +
        `<div style="width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;background:${rankCols[i]};color:#fff;flex-shrink:0;">${i + 1}</div>` +
        `<div style="flex:1;"><div style="font-size:12px;color:#374151;">${esc(r.summary || r.title)}</div>` +
        `<div style="font-size:10px;font-weight:800;color:#1e3a8a;margin-top:3px;">${esc(r.report_id)} \u00b7 ${esc(r.location)} \u00b7 ${rb(r.risk_level)}</div></div></div>`
    ).join('');

    // ── Corrective actions tracker ────────────────────────────────────────
    const allActs = [];
    reports.forEach(r => {
        (Array.isArray(r.corrective_actions) ? r.corrective_actions : []).forEach(a => {
            if (typeof a === 'string') {
                allActs.push({ text: a, rid: r.report_id, risk: r.risk_level, status: r.status, assigned_to: '', due_date: '', completed_date: '' });
            } else {
                allActs.push({ text: a.text || '', rid: r.report_id, risk: r.risk_level, status: a.status || '', assigned_to: a.assigned_to || '', due_date: a.due_date || '', completed_date: a.completed_date || '' });
            }
        });
    });
    const _actDone    = a => /^(completed|done|closed)$/i.test(a.status || '');
    const _actOverdue = a => !_actDone(a) && a.due_date && new Date(a.due_date) < new Date();
    const totalActs = allActs.length;
    const pendActs  = allActs.filter(a => !_actDone(a)).length;
    const doneActs  = allActs.filter(a =>  _actDone(a)).length;
    const overActs  = allActs.filter(a =>  _actOverdue(a)).length;
    const pMap      = { critical: 'background:#7c3aed;color:#fff', high: 'background:#fee2e2;color:#991b1b', medium: 'background:#fef3c7;color:#92400e', low: 'background:#dcfce7;color:#166534' };
    const actsHtml  = allActs.length ? allActs.map(a => {
        const done    = _actDone(a);
        const overdue = _actOverdue(a);
        const hiRsk   = /^(critical|high)$/i.test(a.risk || '');
        const icn     = done ? 'ph-check' : overdue ? 'ph-alarm' : hiRsk ? 'ph-alarm' : 'ph-clock';
        const ibg     = done ? 'background:#dcfce7;color:#16a34a' : overdue ? 'background:#fee2e2;color:#dc2626' : hiRsk ? 'background:#fee2e2;color:#dc2626' : 'background:#fef3c7;color:#d97706';
        const stTxt   = done ? 'Completed' : overdue ? 'Overdue' : (a.status || 'Pending');
        const stCol   = done ? '#16a34a' : overdue ? '#dc2626' : '#d97706';
        const stBg    = done ? '#dcfce7' : overdue ? '#fee2e2' : '#fef3c7';
        const prio    = pMap[(a.risk || '').toLowerCase()] || '';
        return `<div style="display:flex;align-items:flex-start;gap:12px;padding:13px 18px;border-bottom:1px solid #f1f5f9;">` +
            `<div style="width:30px;height:30px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0;${ibg}"><i class="ph-thin ${icn}"></i></div>` +
            `<div style="flex:1;">` +
            `<div style="font-size:12px;font-weight:600;color:#0f172a;">${esc(a.text)}</div>` +
            `<div style="font-size:10px;color:#94a3b8;margin-top:2px;">${esc(a.rid)}` +
            (a.assigned_to ? ` \u00b7 <i class="ph-thin ph-user" style="margin-right:2px"></i>${esc(a.assigned_to)}` : '') +
            (a.due_date    ? ` \u00b7 <i class="ph-thin ph-calendar" style="margin-right:2px;${overdue ? 'color:#dc2626' : ''}"></i>${overdue ? '<span style="color:#dc2626">' : ''}Due: ${esc(a.due_date)}${overdue ? '</span>' : ''}` : '') +
            (done && a.completed_date ? ` \u00b7 <i class="ph-thin ph-check" style="margin-right:2px;color:#16a34a"></i><span style="color:#16a34a">Done: ${esc(a.completed_date)}</span>` : '') +
            `</div></div>` +
            `<div style="flex-shrink:0;text-align:right;">` +
            `<span style="font-size:9px;padding:2px 7px;border-radius:3px;text-transform:uppercase;background:${stBg};color:${stCol};">${esc(stTxt)}</span>` +
            `<div style="margin-top:4px;"><span style="font-size:9px;padding:2px 7px;border-radius:3px;text-transform:uppercase;${prio}">${esc(a.risk || '')}</span></div>` +
            `</div></div>`;
    }).join('') : `<div style="padding:22px;text-align:center;color:#94a3b8;font-size:13px;">No corrective actions recorded.</div>`;

    // ── Unique ID prevents conflicts if modal is reopened ────────────────
    const uid = 'hov' + Date.now();

    // ── Assemble full dashboard HTML ──────────────────────────────────────
    return `<div style="font-family:'Segoe UI',Arial,sans-serif;font-size:13px;color:#1e293b;line-height:1.5;">

<!-- KPI Stats -->
<div style="display:grid;grid-template-columns:repeat(6,1fr);gap:1px;background:#e2e8f0;border:1px solid #e2e8f0;border-radius:11px;overflow:hidden;margin-bottom:16px;box-shadow:0 1px 5px rgba(0,0,0,.05);">
${_hovStat(String(total),          'Total Reports',     '',                   '')}
${_hovStat(String(openCount),      'Open',              'Require action',     '#d97706')}
${_hovStat(String(highCritCount),  'High / Critical',   'Priority review',    '#dc2626')}
${_hovStat(String(closedCount),    'Closed',            'Resolved',           '#16a34a')}
${_hovStat(String(pendingActions), 'Actions Pending',   'Across all reports', '#d97706')}
${_hovStat(String(inProgCount),    'In Progress',       'Being addressed',    '#2563eb')}
</div>

<!-- Tabs -->
<div style="display:flex;gap:5px;background:#fff;padding:5px;border-radius:11px;border:1px solid #e2e8f0;margin-bottom:16px;">
<button onclick="hovTab('${uid}','summary',this)" class="${uid}_tab" style="flex:1;display:flex;align-items:center;justify-content:center;gap:7px;padding:9px 10px;border-radius:7px;border:none;background:#1e3a8a;color:#fff;font-family:inherit;font-size:11px;cursor:pointer;box-shadow:0 2px 8px rgba(30,58,138,.25);"><i class="ph-thin ph-squares-four"></i>Summary</button>
<button onclick="hovTab('${uid}','reports',this)" class="${uid}_tab" style="flex:1;display:flex;align-items:center;justify-content:center;gap:7px;padding:9px 10px;border-radius:7px;border:none;background:transparent;color:#94a3b8;font-family:inherit;font-size:11px;cursor:pointer;"><i class="ph-thin ph-clipboard-text"></i>All Reports <span style="font-size:9px;padding:1px 5px;border-radius:20px;background:#e2e8f0;color:#64748b;margin-left:2px;">${total}</span></button>
<button onclick="hovTab('${uid}','risk',this)" class="${uid}_tab" style="flex:1;display:flex;align-items:center;justify-content:center;gap:7px;padding:9px 10px;border-radius:7px;border:none;background:transparent;color:#94a3b8;font-family:inherit;font-size:11px;cursor:pointer;"><i class="ph-thin ph-gauge"></i>Risk Analysis</button>
<button onclick="hovTab('${uid}','actions',this)" class="${uid}_tab" style="flex:1;display:flex;align-items:center;justify-content:center;gap:7px;padding:9px 10px;border-radius:7px;border:none;background:transparent;color:#94a3b8;font-family:inherit;font-size:11px;cursor:pointer;"><i class="ph-thin ph-wrench"></i>Actions <span style="font-size:9px;padding:1px 5px;border-radius:20px;background:#e2e8f0;color:#64748b;margin-left:2px;">${totalActs}</span></button>
</div>

<!-- Panel: Summary -->
<div id="${uid}_panel_summary">
<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px;">
<div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;box-shadow:0 1px 5px rgba(0,0,0,.05);">
${_hovCardHdr('ph-chart-donut', 'background:#fee2e2;color:#dc2626', 'Risk Distribution', 'By risk level \u2014 ' + total + ' reports')}
<div style="padding:22px 20px;display:flex;align-items:center;gap:22px;">
<svg viewBox="0 0 100 100" width="140" height="140" style="flex-shrink:0">
<circle cx="50" cy="50" r="38" fill="none" stroke="#f1f5f9" stroke-width="13"/>
${total > 0 ? donutSegs : '<circle cx="50" cy="50" r="38" fill="none" stroke="#e2e8f0" stroke-width="13"/>'}
<text x="50" y="47" text-anchor="middle" font-size="18" font-weight="900" fill="#0f172a">${total}</text>
<text x="50" y="59" text-anchor="middle" font-size="8" fill="#94a3b8">Reports</text>
</svg>
<div style="flex:1">${riskOrder.map(l => riskCounts[l] > 0 ? `<div style="display:flex;align-items:center;gap:9px;margin-bottom:12px"><div style="width:11px;height:11px;border-radius:50%;background:${riskColors[l]};flex-shrink:0;"></div><div style="flex:1;font-size:12px;color:#475569;text-transform:capitalize;">${l}</div><div style="font-size:15px;color:#0f172a;">${riskCounts[l]}</div><div style="font-size:10px;color:#94a3b8;width:36px;text-align:right;">${Math.round(riskCounts[l] / total * 100)}%</div></div>` : '').join('')}</div>
</div>
</div>
<div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;box-shadow:0 1px 5px rgba(0,0,0,.05);">
${_hovCardHdr('ph-activity', 'background:#fef3c7;color:#d97706', 'Status Breakdown', 'Current resolution progress')}
<div style="padding:20px;">${statusBarsHtml || '<div style="color:#94a3b8;font-size:13px;">No status data.</div>'}</div>
</div>
</div>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px;">
<div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;box-shadow:0 1px 5px rgba(0,0,0,.05);">
${_hovCardHdr('ph-map-pin', 'background:#dbeafe;color:#1d4ed8', 'Reports by Location', 'Count per site area')}
<div style="padding:20px;">${locBarsHtml || '<div style="color:#94a3b8;font-size:13px;">No location data.</div>'}</div>
</div>
<div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;box-shadow:0 1px 5px rgba(0,0,0,.05);">
${_hovCardHdr('ph-trend-up', 'background:#ede9fe;color:#7c3aed', 'Monthly Trend', 'Reports lodged per month')}
<div style="padding:20px;">
<div style="display:flex;align-items:flex-end;gap:8px;height:90px;margin-bottom:10px;">${trendHtml || '<div style="color:#94a3b8;font-size:11px;align-self:center;">No date data.</div>'}</div>
<div style="border-top:1px solid #e2e8f0;padding-top:8px;font-size:10px;color:#94a3b8;text-align:center;">Reports lodged over time</div>
</div>
</div>
</div>
</div>

<!-- Panel: All Reports -->
<div id="${uid}_panel_reports" style="display:none;">
<div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;box-shadow:0 1px 5px rgba(0,0,0,.05);">
${_hovCardHdr('ph-clipboard-text', 'background:#dbeafe;color:#1d4ed8', 'All Hazard Reports', total + ' reports \u2014 newest first')}
<div style="overflow-x:auto;">
<table style="width:100%;border-collapse:collapse;">
<thead><tr><th style="${thS}">ID</th><th style="${thS}">Title</th><th style="${thS}">Location</th><th style="${thS}">Reported By</th><th style="${thS}">Date</th><th style="${thS}">Risk</th><th style="${thS}">Status</th></tr></thead>
<tbody>${tableRows}</tbody>
</table>
</div>
</div>
</div>

<!-- Panel: Risk Analysis -->
<div id="${uid}_panel_risk" style="display:none;">
<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">
<div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;box-shadow:0 1px 5px rgba(0,0,0,.05);">
${_hovCardHdr('ph-gauge', 'background:#fee2e2;color:#dc2626', 'Overall Risk Score', 'Aggregate across all ' + total + ' reports')}
<div style="display:flex;flex-wrap:wrap;">
<div style="width:200px;flex-shrink:0;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px 16px;border-right:1px solid #e2e8f0;">
<svg viewBox="0 0 130 130" width="130" height="130">
<circle cx="65" cy="65" r="50" fill="none" stroke="#e2e8f0" stroke-width="10" stroke-dasharray="235.6 78.5" stroke-dashoffset="-39.3"/>
<circle cx="65" cy="65" r="50" fill="none" stroke="${dialCol}" stroke-width="10" stroke-dasharray="${dialFill.toFixed(1)} ${dialGap.toFixed(1)}" stroke-dashoffset="-39.3" stroke-linecap="round"/>
<text x="65" y="61" text-anchor="middle" font-size="22" font-weight="900" fill="#0f172a">${avgScore}</text>
<text x="65" y="76" text-anchor="middle" font-size="10" fill="#94a3b8">/ 100</text>
</svg>
<span style="font-size:12px;font-weight:800;padding:5px 18px;border-radius:20px;${dialLvlS}">${dialLvl}</span>
<div style="font-size:10px;color:#94a3b8;text-align:center;max-width:160px;margin-top:8px;line-height:1.5;">Based on ${total} report${total !== 1 ? 's' : ''} across ${Object.keys(locCounts).length} location${Object.keys(locCounts).length !== 1 ? 's' : ''}.</div>
</div>
<div style="flex:1;padding:20px;min-width:220px;">
<div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.7px;color:#94a3b8;margin-bottom:12px;">Risk by Level</div>
${riskOrder.map(l => { const pct = total > 0 ? Math.round(riskCounts[l] / total * 100) : 0; if (!pct) return ''; return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;"><div style="width:75px;font-size:12px;color:#475569;text-transform:capitalize;flex-shrink:0;">${l}</div><div style="flex:1;height:9px;background:#f1f5f9;border-radius:4px;overflow:hidden;"><div style="width:${pct}%;height:100%;background:${riskColors[l]};border-radius:4px;"></div></div><div style="width:34px;text-align:right;font-size:11px;font-weight:800;color:#475569;">${pct}%</div></div>`; }).join('')}
</div>
</div>
</div>
<div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;box-shadow:0 1px 5px rgba(0,0,0,.05);">
${_hovCardHdr('ph-ranking', 'background:#fee2e2;color:#dc2626', 'Highest Risk Reports', 'Ranked by severity and status')}
<div style="padding:16px 18px;">${topRisksHtml || '<div style="color:#94a3b8;font-size:13px;">No reports available.</div>'}</div>
</div>
</div>
</div>

<!-- Panel: Corrective Actions -->
<div id="${uid}_panel_actions" style="display:none;">
<div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;box-shadow:0 1px 5px rgba(0,0,0,.05);">
${_hovCardHdr('ph-wrench', 'background:#fef3c7;color:#d97706', 'Corrective Actions Tracker', 'All actions from all hazard reports')}
<div style="display:flex;gap:1px;background:#e2e8f0;border-bottom:1px solid #e2e8f0;">
${_hovActStat(String(totalActs), 'Total',     '')}
${_hovActStat(String(pendActs),  'Pending',   '#d97706')}
${_hovActStat(String(overActs),  'Overdue',   '#dc2626')}
${_hovActStat(String(doneActs),  'Completed', '#16a34a')}
</div>
${actsHtml}
</div>
</div>

</div>`;
}

// ---------------------------------------------------------------------------
// Extract output text from OpenAI Responses API response
// ---------------------------------------------------------------------------
/**
 * Robustly extract a JSON object or array from model output text.
 * Handles: markdown code fences, bare JSON object, bare JSON array
 * (array is auto-wrapped as { reports: [...] } for the list view).
 */
function _parseHazardJson(rawText) {
    if (!rawText) return null;
    // 1. Strip markdown code fences
    let txt = rawText.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim();
    // 2. Try to find a JSON object
    const objMatch = txt.match(/\{[\s\S]*\}/);
    if (objMatch) {
        try { return JSON.parse(objMatch[0]); } catch (_) {}
        // greedy match may have grabbed too much — try balanced extraction
        try {
            const start = txt.indexOf('{');
            let depth = 0, i = start;
            for (; i < txt.length; i++) {
                if (txt[i] === '{') depth++; else if (txt[i] === '}') { depth--; if (depth === 0) break; }
            }
            return JSON.parse(txt.slice(start, i + 1));
        } catch (_) {}
    }
    // 3. Try bare JSON array → wrap as { reports: [...] }
    const arrMatch = txt.match(/\[[\s\S]*\]/);
    if (arrMatch) {
        try {
            const arr = JSON.parse(arrMatch[0]);
            if (Array.isArray(arr)) return { reports: arr };
        } catch (_) {}
    }
    return null;
}

function _extractHazardOutputText(data) {
    if (!data || !Array.isArray(data.output)) return null;
    for (const item of data.output) {
        if (item.type === 'message' && Array.isArray(item.content)) {
            for (const c of item.content) {
                if (c.type === 'output_text' && c.text) return c.text;
                if (c.type === 'text' && c.text) return c.text;
            }
        }
    }
    return null;
}

// ---------------------------------------------------------------------------
// Contextual chips
// ---------------------------------------------------------------------------
let _hazardCtxChipsListenerOn = false;
function _ensureHazardCtxChipsListener() {
    if (_hazardCtxChipsListenerOn) return;
    _hazardCtxChipsListenerOn = true;
    document.addEventListener('click', e => {
        const btn = e.target.closest('.ctx-chip[data-prompt]');
        if (!btn) return;
        if (!state._hazardMode) return;
        e.preventDefault();
        e.stopPropagation();
        const prompt      = btn.dataset.prompt;
        const forcedIntent = btn.dataset.forcedIntent;
        if (prompt) {
            if (forcedIntent && typeof _dispatchHazardAction === 'function') {
                _dispatchHazardAction(prompt, forcedIntent);
            } else if (typeof checkAndHandleHazardIntent === 'function') {
                checkAndHandleHazardIntent(prompt);
            }
        }
    });
}

function _showHazardContextualChips(message, intent, assistantText) {
    _ensureHazardCtxChipsListener();
    const chips = _buildHazardContextualChips(message, intent, assistantText);
    if (!chips.length) return;
    const btnHtml = chips.map(c =>
        `<button class="ctx-chip btn btn-sm btn-primary mx-1 text-start" ` +
        `data-prompt="${c.prompt.replace(/"/g, '&quot;')}"` +
        (c.forcedIntent ? ` data-forced-intent="${c.forcedIntent}"` : '') +
        `><i class="ph-thin ${c.icon} me-1"></i>${c.label}</button>`
    ).join('');
    addMessage('assistant',
        `<div class="ctx-chips-wrap" style="margin-top:4px">` +
        `<div style="font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:#94a3b8;margin-bottom:6px">Quick actions</div>` +
        `<div class="d-flex flex-column gap-2">${btnHtml}</div>` +
        `</div>`
    );
    scrollToBottom();
}

function _buildHazardContextualChips(message, intent) {
    const chips = [];
    if (intent === 'chat') {
        chips.push({ icon: 'ph-list',           label: 'Show all hazard reports',  prompt: '[intent:list] show all hazard reports',         forcedIntent: 'list' });
        chips.push({ icon: 'ph-warning-circle', label: 'Show high risk reports',   prompt: '[intent:list] show high risk hazard reports',   forcedIntent: 'list' });
    } else if (intent === 'list') {
        chips.push({ icon: 'ph-warning-circle', label: 'Show high risk only',      prompt: '[intent:list] show only high risk hazard reports', forcedIntent: 'list' });
        chips.push({ icon: 'ph-check-circle',   label: 'Show open reports only',   prompt: '[intent:list] show only open hazard reports',   forcedIntent: 'list' });
    }
    return chips.slice(0, 2);
}

// ---------------------------------------------------------------------------
// Report card save / persist / reopen — mirrors chemical _saveModal pattern
// ---------------------------------------------------------------------------
function _saveHazardModal(html, title) {
    const key = 'hazmd_' + Date.now();
    _hazardModalCache[key] = { html, title: title || '' };
    // localStorage — works immediately, same browser
    try { localStorage.setItem(key, JSON.stringify({ html, title: title || '', ts: Date.now() })); _pruneHazardReportCache(); } catch {}
    // DB — cross-device (only active after backend is deployed)
    _persistHazardReport(key, html, title || '');
    return key;
}

function _pruneHazardReportCache() {
    try {
        const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000; // 30 days
        Object.keys(localStorage).filter(k => k.startsWith('hazmd_')).forEach(k => {
            try { const d = JSON.parse(localStorage.getItem(k)); if (d.ts < cutoff) localStorage.removeItem(k); } catch { localStorage.removeItem(k); }
        });
    } catch {}
}

async function _persistHazardReport(key, html, title) {
    try {
        const userId  = CONFIG?.userId  || 0;
        const storeId = CONFIG?.storeId || 0;
        if (!userId || !storeId) return;
        await fetch(_HAZARD_REPORT_API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reportKey: key, userId, storeId, title, htmlContent: html })
        });
    } catch { /* non-critical */ }
}

async function _reopenHazardModal(key) {
    // 1. In-memory cache (same-tab, same load)
    let m = _hazardModalCache[key];
    if (m) { _openHazardInModal(m.html, m.title); return; }
    // 2. localStorage (same browser, any tab)
    try {
        const s = localStorage.getItem(key);
        if (s) { const d = JSON.parse(s); _hazardModalCache[key] = d; _openHazardInModal(d.html, d.title); return; }
    } catch {}
    // 3. DB fetch (cross-device, requires backend deploy)
    try {
        const userId  = CONFIG?.userId  || 0;
        const storeId = CONFIG?.storeId || 0;
        const res = await fetch(`${_HAZARD_REPORT_API}/${encodeURIComponent(key)}?userId=${userId}&storeId=${storeId}`);
        if (res.ok) {
            const data = await res.json();
            if (data.success && data.htmlContent) {
                _hazardModalCache[key] = { html: data.htmlContent, title: data.title || '' };
                _openHazardInModal(data.htmlContent, data.title || '');
                return;
            }
        }
    } catch { /* fall through */ }
    if (typeof addMessage === 'function') addMessage('assistant', '<i class="ph-thin ph-warning" style="color:#d97706;margin-right:6px"></i>This report is no longer available. Please regenerate it.');
}

/** Open a hazard report card in the shared SDS modal with a hazard-specific title. */
function _openHazardInModal(html, title) {
    _lastHazardReportHtml  = html;
    _lastHazardReportTitle = title || '';

    // Directly open the shared modal — does not depend on openSdsModal being loaded
    const modal = document.getElementById('sds-modal');
    const body  = document.getElementById('sdsModalBody');
    if (!modal || !body) { console.warn('[Hazard] #sds-modal not found in DOM'); return; }

    body.innerHTML = html;

    const titleEl = document.querySelector('.sds-modal-toolbar-title');
    if (titleEl) {
        const _he = s => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        titleEl.innerHTML = `<i class="ph-thin ph-warning-circle" style="margin-right:6px"></i>Hazard Report \u2014 ${_he(title || 'Report')}`;
    }

    const imgBtn = document.getElementById('sds-save-image-btn');
    if (imgBtn) imgBtn.style.display = 'none';

    modal.classList.remove('label-mode');
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
}

// ---------------------------------------------------------------------------
// Session persistence
// ---------------------------------------------------------------------------
async function _ensureHazardSession() {
    if (state.regOthId) return;
    if (_hazardSessionReady) return;
    _hazardSessionReady = true;

    try {
        const date     = new Date().toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' });
        const chatName = `Hazard Chat \u2014 ${date}`;

        state.regOthId            = 0;
        state._isDashboardSession = true;
        state.chatName            = chatName;
        state.templateName        = chatName;
        state._chatCreatedAt      = new Date().toISOString();
        state.sessionStarted      = true;

        const transcript = {
            regOthId: 0, chatName, templateName: chatName,
            internalNo: null, messages: [],
            createdAt: state._chatCreatedAt,
            isComplete: false, completionPercentage: 0,
            totalFieldCount: 0, answeredFieldCount: 0, isDashboard: true
        };

        const dbRes = await _saveTranscriptToDb(transcript);
        if (dbRes && dbRes.transcriptID > 0) {
            state.regOthId = -dbRes.transcriptID;
            if (typeof _updateSidebarItem === 'function') {
                _updateSidebarItem({ ...transcript, regOthId: state.regOthId });
                if (typeof renderSidebarChats === 'function') renderSidebarChats();
            }
        }
    } catch (e) {
        console.warn('[HazardSession] session create failed:', e);
    }
}

/** Resume a previously saved hazard session (called from openSavedChat in chat.js). */
async function _resumeHazardSession(regOthId, entry) {
    try {
        if (typeof stopVoiceMode === 'function' && state.voiceMode) stopVoiceMode();
        state.sessionStarted      = true;
        state.sessionCompleted    = false;
        state.regOthId            = regOthId;
        state._isDashboardSession = true;
        state.chatName            = entry.chatName || '';
        state.templateName        = entry.templateName || '';
        state._chatCreatedAt      = entry.createdAt;
        state._replayMode         = false;
        state.conversationHistory = [];
        state.displayMessages     = [];
        if (state.extractedFieldsMap) state.extractedFieldsMap.clear();

        const banner = document.getElementById('readonlyBanner');
        if (banner) banner.remove();
        if (typeof setChatInputState === 'function') setChatInputState(false);
        if (typeof setTopbarTitle   === 'function') setTopbarTitle(entry.chatName || '');

        document.getElementById('emptyState').style.display    = 'none';
        document.getElementById('messagesArea').classList.add('active');
        document.getElementById('chatInputArea').style.display = 'block';
        document.getElementById('messagesArea').innerHTML       = '';

        const dbTranscript = await _loadTranscriptFromDb(regOthId);
        if (dbTranscript && dbTranscript.messages && dbTranscript.messages.length > 0) {
            state._replayMode = true;
            dbTranscript.messages
                .filter(msg => !(msg.role === 'assistant' && typeof msg.content === 'string' && msg.content.includes('typing-thinking-wrap')))
                .forEach(msg => {
                    if (typeof addMessage === 'function') addMessage(msg.role, msg.content);
                });
            state._replayMode     = false;
            state.displayMessages = dbTranscript.messages
                .filter(msg => !(msg.role === 'assistant' && typeof msg.content === 'string' && msg.content.includes('typing-thinking-wrap')))
                .map(m => ({ role: m.role, content: m.content }));
        }

        _hazardSessionReady = true;
        if (typeof enterHazardMode    === 'function') enterHazardMode();
        if (typeof scrollToBottom     === 'function') scrollToBottom();
        if (typeof renderSidebarChats === 'function') renderSidebarChats();
    } catch (e) {
        console.warn('[HazardSession] resume failed:', e);
    }
}

// ---------------------------------------------------------------------------
// Global: tab switcher for Hazard Overview Dashboard
// Used by onclick="hovTab('uid','panel',this)" in dashboard HTML
// ---------------------------------------------------------------------------
if (typeof window !== 'undefined') {
    window.hovTab = function(uid, panel, btn) {
        ['summary', 'reports', 'risk', 'actions'].forEach(function(p) {
            var el = document.getElementById(uid + '_panel_' + p);
            if (el) el.style.display = (p === panel) ? 'block' : 'none';
        });
        document.querySelectorAll('.' + uid + '_tab').forEach(function(b) {
            b.style.background = 'transparent';
            b.style.color      = '#94a3b8';
            b.style.boxShadow  = 'none';
        });
        btn.style.background = '#1e3a8a';
        btn.style.color      = '#fff';
        btn.style.boxShadow  = '0 2px 8px rgba(30,58,138,.25)';
    };
}
