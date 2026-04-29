// Load member data from localStorage
const _jmember = (() => {
    try { return JSON.parse(localStorage.getItem('jmemberData') || '{}'); } catch(e) { return {}; }
})();

// Configuration
//  apiUrl: 'https://beta.whsmonitor.com.au/affinda/api/chat-template',
//  apiUrl: 'http://localhost:48110/api/chat-template',
const CONFIG = {
    apiUrl: 'https://beta.whsmonitor.com.au/affinda/api/chat-template',
    storeId: _jmember.StoreID || 5651,
    userId: _jmember.MemberID || 20707,
    firstName: _jmember.FirstName || 'User',
    userName: _jmember.UserName || 'User',
    elevenlabsApiKey: 'sk_7f1831767c31a0eb6a44da85883cdeede76ef428c30374c8',
    elevenlabsVoiceId: 'EXAVITQu4vr4xnSDxMaL', // Default voice (Sarah)
    openaiApiKey: 'REMOVED_OPENAI_KEY',
    googleMapsApiKey: 'AIzaSyDx17vZ4ZTrcYxxbRds4HDOv3x5vG5d7Nk', // Google Maps API key for location fields,
    // Known profile facts from localStorage — sent with every message so AI never asks for things it already knows
    userProfile: {
        FullName:      [_jmember.FirstName, _jmember.Surname].filter(Boolean).join(' ') || null,
        Organisation:  _jmember.Organisation || null,
        StoreName:     _jmember.StoreName    || null,
        Industry:      _jmember.IndustryList || null,
        Email:         _jmember.EmailAddress || null,
        CompanySize:   _jmember.CompanySize  || null,
        Domain:        _jmember.Domain       || null
    }
};

console.log('✅ chat.js loaded successfully - CONFIG:', CONFIG);
console.log('🔍 Checking for openHistoryForm function:', typeof openHistoryForm);

// Global click handler to log ALL button clicks
document.addEventListener('click', (e) => {
    if (e.target.tagName === 'BUTTON') {
        console.log('🖱️  BUTTON CLICKED:', {
            text: e.target.textContent,
            class: e.target.className,
            onclick: e.target.getAttribute('onclick')
        });
    }
});

// State
let state = {
    sessionStarted: false,
    regOthId: null,
    internalNo: '',
    templateName: '',
    moduleName: '',
    conversationHistory: [],
    displayMessages: [],          // every {role,content} shown in the DOM — source of truth for save/restore
    extractedFieldsMap: new Map(),
    completionPercentage: 0,
    initialMessage: '',
    awaitingTemplateSelection: false,
    availableTemplates: [],
    additionalTemplateChoices: [],
    currentFieldID: null,        // Current field being asked
    currentFieldType: null,      // e.g., "10013" for file upload
    currentFieldDynamicFilter: null, // DynamicFilterCondn JSON for 10020/10037 dataset fields
    currentSection: null,        // Current section/group being collected
    lastMapData: null,           // Last confirmed map data (for Yes/No confirmations)
    voiceMode: false,
    sttEngine: 'vad',  // 'webspeech' | 'vad'
    isListening: false,
    isSpeaking: false,
    isProcessing: false,
    useElevenLabs: false,
    lastAiMessage: '',
    speakingEl: null,
    pendingResponse: null,   // queued AI response waiting for thinking phrase to finish
    sessionCompleted: false, // true once the session has been formally completed
    sessionCost: { totalUSD: 0 }, // accumulated AI spend
    smartFillTriggered: false, // true once Smart Fill has run for this session
    _initialMessageBubbleShown: false, // true when dashboard-intent path already added the user bubble
    chatName: '',              // user-provided name for this session
    awaitingChatName: false,   // true while waiting for user to confirm/type chat name
    _pendingSessionData: null, // holds first startIntelligentSession response while naming
    _chatCreatedAt: null,      // ISO timestamp when session was named/started
    _replayMode: false,        // true when rendering a saved transcript (suppresses TTS/saving)
    _serverMarkedComplete: false, // true once API indicates no more questions (even if pct < 100)
    totalFieldCount: 0,        // askable fields count from server (dynamic, excludes headings/auto/unmet conditionals)
    answeredFieldCount: 0,     // answered askable fields count from server
    templateTypeId: null,      // TemplateTypeID from server — used to build correct Page= redirect URL
    regTypeId: null,           // RegTypeID (module ID) — used for header combo lookups
    pageId: null,              // PageId from TEMPLATE_TYPE_PAGE_MAP — drives GetDetailProperties
    _headerData: null,         // collected header field values {fieldControlId: {value, displayText}}
    _headerFields: null,       // header field schema from GetDetailProperties
    _hdrAiQuestions: {},       // AI-rephrased questions keyed by FieldControlID
    _collectingHeaderDetails: false, // true while header details wizard is active
    _headerDetailsReadyForChecklist: false, // true only when details flow has fully completed/been intentionally skipped
    _hdrLocTypeId: 4,          // currently selected location type (for location picker)
    _hdrLocTypeName: 'Location', // display name for selected loc type
    awaitingHeaderField: false, // true while waiting for user input during header collection
    _headerFieldCallback: null, // callback(value, displayText, isSkip) for current header field
    currentFieldRequired: true, // false when the next checklist field is optional (skip chip shown)
    lastSuggestedQuestions: [], // most recent suggestion pills shown for a field
    lastSuggestionFieldId: null, // fieldID associated with lastSuggestedQuestions
    chatConfirmedFieldIds: []  // field IDs explicitly answered by the user during THIS chat session
                               // (not pre-filled defaults from SP); passed to the server on every call
                               // so the AI knows which fields are truly answered vs need confirmation
};

// Voice APIs
let recognition = null;
let micVAD = null;           // @ricky0123/vad-web instance
let synthesis = window.speechSynthesis;
let finalTranscript = '';
let ttsGeneration = 0;       // incremented on every new TTS — stale callbacks self-abort

// OpenAI pricing (all calls — client-side and server-side)
const PRICING = {
    'gpt-4o':      { input: 2.50  / 1_000_000, output: 10.00 / 1_000_000 },
    'gpt-4o-mini': { input: 0.15  / 1_000_000, output: 0.60  / 1_000_000 },
    'whisper-1':   { perSecond: 0.006 / 60 }
};

function trackCost(model, usage) {
    if (!usage) return;
    const p = PRICING[model];
    if (!p || p.perSecond !== undefined) return;
    state.sessionCost.totalUSD += (usage.prompt_tokens || 0) * p.input
                                + (usage.completion_tokens || 0) * p.output;
    updateCostDisplay();
}

function trackServerCost(tokenUsageArray) {
    if (!Array.isArray(tokenUsageArray)) return;
    tokenUsageArray.forEach(u => {
        if (!u) return;
        const p = PRICING[u.model] || PRICING['gpt-4o'];
        if (!p || p.perSecond !== undefined) return;
        state.sessionCost.totalUSD += (u.promptTokens || 0) * p.input
                                    + (u.completionTokens || 0) * p.output;
    });
    updateCostDisplay();
}

function trackWhisper(durationSeconds) {
    state.sessionCost.totalUSD += durationSeconds * PRICING['whisper-1'].perSecond;
    updateCostDisplay();
}

function updateCostDisplay() {
    const el = document.getElementById('panelCost');
    if (el) el.textContent = `$${state.sessionCost.totalUSD.toFixed(4)}`;
}

// ═══════════════════════════════════════════════════════════
//  TRANSCRIPT & SIDEBAR
// ═══════════════════════════════════════════════════════════

function getTranscriptKey(regOthId) {
    return `whs_transcript_${CONFIG.userId}_${regOthId}`;
}

function getChatIndexKey() {
    return `whs_chat_index_${CONFIG.userId}`;
}

function getHeaderDetailsDoneKey(regOthId) {
    return `whs_header_done_${CONFIG.userId}_${regOthId}`;
}

function hasCompletedHeaderDetails(regOthId) {
    if (!regOthId) return false;
    return localStorage.getItem(getHeaderDetailsDoneKey(regOthId)) === '1';
}

function markHeaderDetailsCompleted(regOthId) {
    if (!regOthId) return;
    localStorage.setItem(getHeaderDetailsDoneKey(regOthId), '1');
}

/** Save the current conversation to localStorage AND to the database */
function saveTranscript() {
    if (!state.regOthId || state._replayMode) return;
    const transcript = {
        regOthId:            state.regOthId,
        regTypeId:           state.regTypeId || null,  // SAVE regTypeId to localStorage
        templateTypeId:      state.templateTypeId || null,
        pageId:              state.pageId || null,
        chatName:            state.chatName || state.templateName || 'Untitled Session',
        templateName:        state.templateName,
        internalNo:          state.internalNo,
        messages:            state.displayMessages.length > 0
                                 ? state.displayMessages
                                 : state.conversationHistory.map(m => ({ role: m.role, content: m.content })),
        createdAt:           state._chatCreatedAt || new Date().toISOString(),
        isComplete:          state.sessionCompleted,
        completionPercentage: state.completionPercentage || 0,
        totalFieldCount:     state.totalFieldCount || 0,
        answeredFieldCount:  state.answeredFieldCount || 0,
        isDashboard:         state._isDashboardSession || false,
        headerData:          state._headerData || null,
        headerDetailsCompleted: hasCompletedHeaderDetails(state.regOthId)
    };
    _updateSidebarItem(transcript);
    renderSidebarChats();
    // Fire-and-forget database save — skip for dashboard-only sessions (negative pseudo-ID)
    if (transcript.regOthId > 0) {
        _saveTranscriptToDb(transcript);
    }
}

// ── chatConfirmedFieldIds helpers ───────────────────────────────────────────
/** Load confirmed field IDs for a session from localStorage. */
function loadConfirmedFieldIds(regOthId) {
    try {
        const raw = localStorage.getItem(`chatConfirmedFieldIds_${regOthId}`);
        return raw ? JSON.parse(raw) : [];
    } catch { return []; }
}
/** Persist confirmed field IDs for a session to localStorage. */
function saveConfirmedFieldIds(regOthId, ids) {
    try {
        localStorage.setItem(`chatConfirmedFieldIds_${regOthId}`, JSON.stringify(ids));
    } catch { /* quota or private mode */ }
}
/** Add newly saved field IDs (from data.extractedFields) to the confirmed set and persist. */
function markFieldsConfirmed(extractedFields) {
    if (!state.regOthId || !extractedFields || extractedFields.length === 0) return;
    let changed = false;
    extractedFields.forEach(f => {
        const id = f.fieldID ?? f.fieldId;
        if (id && !state.chatConfirmedFieldIds.includes(id)) {
            state.chatConfirmedFieldIds.push(id);
            changed = true;
        }
    });
    if (changed) saveConfirmedFieldIds(state.regOthId, state.chatConfirmedFieldIds);
}

// ─────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────

/**
 * Save a transcript to the database (upsert via POST /api/chat-transcript).
 * Non-blocking — errors are logged but never thrown.
 */
async function _saveTranscriptToDb(transcript) {
    try {
        const answeredCount = transcript.answeredFieldCount > 0
            ? transcript.answeredFieldCount
            : transcript.totalFieldCount > 0
                ? Math.round((transcript.completionPercentage / 100) * transcript.totalFieldCount)
                : (state.filledFields ? state.filledFields.length : 0);

        await fetch(TRANSCRIPT_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                regOthID:             transcript.regOthId,
                userID:               CONFIG.userId,
                storeID:              CONFIG.storeId,
                chatName:             transcript.chatName,
                templateName:         transcript.templateName,
                internalNo:           transcript.internalNo,
                messagesJson:         JSON.stringify(transcript.messages),
                isComplete:           transcript.isComplete,
                completionPercentage: transcript.completionPercentage,
                totalFieldCount:      transcript.totalFieldCount,
                answeredFieldCount:   answeredCount,
                createdAt:            transcript.createdAt
            })
        });
    } catch(e) {
        console.warn('[Transcript] DB save failed:', e);
    }
}

/**
 * Load transcript index from the API and re-render sidebar.
 * Called once on page load so the sidebar reflects DB state.
 */
async function _loadSidebarFromDb() {
    try {
        const url = `${TRANSCRIPT_API_URL}?userId=${CONFIG.userId}&storeId=${CONFIG.storeId}`;
        const res = await fetch(url);
        if (!res.ok) return;
        const data = await res.json();
        if (!data.success || !data.transcripts) return;

        _sidebarItems = data.transcripts.map(t => ({
            regOthId:            t.regOthID,
            regTypeId:           t.regTypeID || t.regTypeId || t.RegTypeID || 0,
            chatName:            t.chatName,
            templateName:        t.templateName,
            internalNo:          t.internalNo,
            createdAt:           t.createdAt,
            isComplete:          t.isComplete,
            completionPercentage: t.completionPercentage,
            totalFieldCount:     t.totalFieldCount
        }));
        renderSidebarChats();
    } catch(e) {
        console.warn('[Transcript] _loadSidebarFromDb failed:', e);
    }
}

/**
 * Load a full transcript from the DB and update the localStorage cache.
 * Returns the transcript object { messages, completionPercentage, … }
 * or null on failure (caller should fall back to localStorage).
 */
async function _loadTranscriptFromDb(regOthId) {
    try {
        const url = `${TRANSCRIPT_API_URL}/${regOthId}?userId=${CONFIG.userId}&storeId=${CONFIG.storeId}`;
        const res = await fetch(url);
        if (!res.ok) return null;
        const data = await res.json();
        if (!data.success) return null;

        let messages = [];
        try { messages = JSON.parse(data.messagesJson || '[]'); } catch(e) {}

        const dbTemplateTypeId = Number(data.templateTypeID || data.TemplateTypeID || data.templateTypeId || 0) || null;
        const dbPageId = Number(data.pageId || data.PageId || data.pageID || data.PageID || 0) || null;

        const transcript = {
            regOthId:            data.regOthID,
            regTypeId:           data.regTypeID || data.regTypeId || data.RegTypeID || 0,
            templateTypeId:      dbTemplateTypeId || null,
            pageId:              dbPageId || null,
            chatName:            data.chatName,
            templateName:        data.templateName,
            internalNo:          data.internalNo,
            messages,
            createdAt:           data.createdAt,
            isComplete:          data.isComplete,
            completionPercentage: data.completionPercentage,
            totalFieldCount:     data.totalFieldCount,
            headerData:          null,
            headerDetailsCompleted: false
        };

        return transcript;
    } catch(e) {
        console.warn('[Transcript] _loadTranscriptFromDb failed:', e);
        return null;
    }
}

function _updateSidebarItem(transcript) {
    const entry = {
        regOthId:            transcript.regOthId,
        chatName:            transcript.chatName,
        templateName:        transcript.templateName,
        internalNo:          transcript.internalNo,
        createdAt:           transcript.createdAt,
        isComplete:          transcript.isComplete,
        completionPercentage: transcript.completionPercentage,
        isDashboard:         transcript.isDashboard || false
    };
    const i = _sidebarItems.findIndex(x => x.regOthId === transcript.regOthId);
    if (i >= 0) _sidebarItems[i] = entry;
    else _sidebarItems.unshift(entry);
}

function _markSessionCompleteLocally(regOthId) {
    if (!regOthId) return;

    const i = _sidebarItems.findIndex(x => String(x.regOthId) === String(regOthId));
    if (i >= 0) {
        _sidebarItems[i].isComplete = true;
        _sidebarItems[i].completionPercentage = Math.max(100, Number(_sidebarItems[i].completionPercentage || 0));
    }

    if (Array.isArray(_historyState.items) && _historyState.items.length > 0) {
        let changed = false;
        _historyState.items.forEach(item => {
            const itemId = item.regOthID || item.RegOthID;
            if (String(itemId) === String(regOthId)) {
                item.isInProgress = false;
                item.IsInProgress = false;
                changed = true;
            }
        });
        if (changed) renderHistoryItems(_historyState.items);
    }

    renderSidebarChats();
}

function loadChatIndex() {
    return _sidebarItems;
}

function loadTranscript(regOthId) {
    return null; // Always load from API via _loadTranscriptFromDb
}

/** Render sidebar chat list from localStorage index */
function renderSidebarChats(filterText = '') {
    const listEl = document.getElementById('sidebarChatsList');
    if (!listEl) return;

    let chats = loadChatIndex();
    if (filterText) {
        const q = filterText.toLowerCase();
        chats = chats.filter(c =>
            (c.chatName || '').toLowerCase().includes(q) ||
            (c.templateName || '').toLowerCase().includes(q)
        );
    }

    if (chats.length === 0) {
        listEl.innerHTML = '<div class="sidebar-empty">' + (filterText ? 'No matching chats' : 'No saved chats yet') + '</div>';
        return;
    }

    // Group by date bucket
    const today = _dateLabel(new Date());
    const yesterday = _dateLabel(new Date(Date.now() - 86400000));
    const groups = {};
    chats.forEach(chat => {
        const label = _chatDateGroup(chat.createdAt);
        if (!groups[label]) groups[label] = [];
        groups[label].push(chat);
    });

    let html = '';
    for (const [label, items] of Object.entries(groups)) {
        html += `<div class="sidebar-section-label">${label}</div>`;
        items.forEach(chat => {
            const isActive = String(chat.regOthId) === String(state.regOthId);
            const isCompletedChat = !!chat.isComplete || Number(chat.completionPercentage || 0) >= 100;
            const badgeClass = chat.isDashboard ? 'dashboard' : (isCompletedChat ? 'completed' : 'in-progress');
            const badgeText  = chat.isDashboard ? 'Dashboard' : (isCompletedChat ? 'Done' : 'In Progress');
            html += `
                <div class="sidebar-chat-item ${isActive ? 'active' : ''}"
                     onclick="openSavedChat(${chat.regOthId})" title="${escapeHtml(chat.chatName || chat.templateName || 'Untitled')}">
                    <div class="sidebar-chat-name">${escapeHtml(chat.chatName || chat.templateName || 'Untitled')}</div>
                    <div class="sidebar-chat-meta">
                        <span class="sidebar-chat-badge ${badgeClass}">${badgeText}</span>
                        <span>${_chatDateLabel(chat.createdAt)}</span>
                    </div>
                </div>`;
        });
    }
    listEl.innerHTML = html;
}

function filterSidebarChats(val) {
    renderSidebarChats(val);
}

function _dateLabel(d) {
    return d.toISOString().substring(0, 10);
}

function _chatDateGroup(dateStr) {
    if (!dateStr) return 'Earlier';
    const d = new Date(dateStr);
    const today = new Date();
    const diffDays = Math.floor((today - d) / 86400000);
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return 'This Week';
    if (diffDays < 30) return 'This Month';
    return 'Earlier';
}

function _chatDateLabel(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const diffDays = Math.floor((Date.now() - d) / 86400000);
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    return d.toLocaleDateString('en-AU', { day: '2-digit', month: 'short' });
}

/** Open a saved chat from the sidebar */
async function openSavedChat(regOthId) {
    const chats = loadChatIndex();
    const entry = chats.find(c => c.regOthId === regOthId);
    if (!entry) return;

    if (entry.isDashboard || regOthId < 0) {
        // Dashboard-only session — always read-only
        _loadReadOnlyTranscript(regOthId, entry);
    } else if (!entry.isComplete) {
        // Resume the in-progress session via backend
        await resumeSession(regOthId);
        // Ensure chatName is set from the local index entry (server doesn't store it)
        if (entry.chatName) {
            state.chatName = entry.chatName;
            // Re-render the link text now chatName is confirmed
            const linkTextEl = document.getElementById('chatInlineProgressLinkText');
            if (linkTextEl) linkTextEl.textContent = `View the ${entry.chatName}`;
        }
        state._chatCreatedAt = entry.createdAt;
    } else {
        // Load the full transcript as read-only
        _loadReadOnlyTranscript(regOthId, entry);
    }
    renderSidebarChats();
}

function _loadReadOnlyTranscript(regOthId, entry) {
    // Kick off DB load then render (async wrapper keeps caller-site simple)
    _loadReadOnlyTranscriptAsync(regOthId, entry);
}

async function _loadReadOnlyTranscriptAsync(regOthId, entry) {
    // Reset all mutable state without calling startNewSession (which clears localStorage)
    if (state.voiceMode) stopVoiceMode();

    state.sessionStarted   = true;
    state.sessionCompleted = true;
    state.regOthId         = regOthId;
    state.internalNo       = entry.internalNo || '';
    state.templateName     = entry.templateName || '';
    state.chatName         = entry.chatName || entry.templateName || '';
    state._chatCreatedAt   = entry.createdAt;
    state._replayMode      = true;
    state.conversationHistory = [];
    state.displayMessages = [];
    state.extractedFieldsMap.clear();
    state.completionPercentage = 0;
    state.awaitingChatName = false;
    state._pendingSessionData = null;
    state.awaitingTemplateSelection = false;
    state.awaitingHeaderField = false;
    state._headerFieldCallback = null;

    // Restore progress widget — try DB first, then localStorage
    const dbTranscript = await _loadTranscriptFromDb(regOthId);
    const savedTranscript = dbTranscript || loadTranscript(regOthId);
    // Restore regTypeId from saved transcript
    if (savedTranscript && savedTranscript.regTypeId) {
        state.regTypeId = savedTranscript.regTypeId;
        console.log('✅ Restored state.regTypeId from savedTranscript:', state.regTypeId);
    }
    if (savedTranscript && savedTranscript.totalFieldCount) state.totalFieldCount = savedTranscript.totalFieldCount;
    if (savedTranscript && savedTranscript.answeredFieldCount !== undefined) state.answeredFieldCount = savedTranscript.answeredFieldCount;
    const roPct = savedTranscript?.completionPercentage > 0 ? savedTranscript.completionPercentage : 100;
    const roWidget = document.getElementById('chatInlineProgress');
    if (roWidget) {
        state._replayMode = false; // temporarily lift so updateInlineChatProgress runs
        updateInlineChatProgress(roPct);
        state._replayMode = true;
    }

    // Reset UI
    document.getElementById('messagesArea').innerHTML = '';
    document.getElementById('messagesArea').classList.add('active');
    document.getElementById('chatInputArea').style.display = 'block';
    document.getElementById('emptyState').style.display = 'none';
    setChatInputState(true, 'This session is completed — read-only view.');

    // Show read-only banner
    const existing = document.getElementById('readonlyBanner');
    if (existing) existing.remove();
    const banner = document.createElement('div');
    banner.id = 'readonlyBanner';
    banner.className = 'readonly-banner';
    banner.innerHTML = `<i class="ph-thin ph-lock-simple"></i> Read-only — this session is completed.
        <button onclick="this.parentElement.remove()" style="margin-left:auto;background:none;border:none;cursor:pointer;color:inherit;font-size:16px;">×</button>`;
    document.querySelector('.main-content').insertBefore(banner, document.querySelector('.chat-container'));

    // Update topbar title
    setTopbarTitle(state.chatName || state.templateName || '');

    // Render transcript messages — use already-loaded transcript (DB or localStorage)
    const transcript = savedTranscript;
    if (transcript && transcript.messages && transcript.messages.length > 0) {
        transcript.messages.forEach(msg => addMessage(msg.role, msg.content));
    } else {
        addMessage('assistant', `This is a completed session: **${entry.chatName || entry.templateName}**`);
    }

    // For dashboard sessions: extract the URL and reopen it in the parent frame
    const isDash = entry.isDashboard || regOthId < 0;
    if (isDash && transcript && transcript.messages) {
        const dashMsg = transcript.messages.find(m =>
            m.role === 'assistant' && m.content && m.content.includes('dashboardv2'));
        if (dashMsg) {
            const match = dashMsg.content.match(/\((https?:\/\/[^)]+)\)/);
            if (match && typeof parent !== 'undefined' && parent.loadDashboardAI) {
                parent.loadDashboardAI(match[1]);
            }
        }
    }

    // Show bottom action buttons
    const messagesArea = document.getElementById('messagesArea');
    const closingDiv = document.createElement('div');
    closingDiv.className = 'message assistant';

    if (isDash) {
        // Dashboard session — offer to reopen dashboard or start new chat
        const dashMsg2 = transcript && transcript.messages
            ? transcript.messages.find(m => m.role === 'assistant' && m.content && m.content.includes('dashboardv2'))
            : null;
        const dashUrl = dashMsg2 ? (dashMsg2.content.match(/\((https?:\/\/[^)]+)\)/) || [])[1] : null;
        closingDiv.innerHTML = `
            <div class="message-icon"><i class="ph-thin ph-chart-bar" style="color:#6366f1"></i></div>
            <div class="message-content">
                <div style="font-weight:600;color:#6366f1;margin-bottom:8px;">Dashboard session</div>
                <div class="suggestions row g-2 mt-2">
                    ${dashUrl ? `<div class="col-12 col-sm-6"><button class="btn btn-primary w-100" onclick="if(parent.loadDashboardAI)parent.loadDashboardAI('${dashUrl}');else window.open('${dashUrl}','_blank')">
                        <i class="ph-thin ph-arrow-counter-clockwise" style="margin-right:4px"></i>Reopen Dashboard
                    </button></div>` : ''}
                    <div class="col-12 col-sm-6"><button class="btn btn-outline-primary w-100" onclick="newChatFromSidebar()">
                        <i class="ph-thin ph-plus" style="margin-right:4px"></i>New Chat
                    </button></div>
                </div>
            </div>`;
    } else {
        // Form session — offer to open form or start new chat
        const formUrl = buildChecklistUrl(regOthId, state.templateName, state.moduleName);
        closingDiv.innerHTML = `
            <div class="message-icon"><i class="ph-thin ph-check-circle" style="color:#10b981"></i></div>
            <div class="message-content">
                <div style="font-weight:600;color:#059669;margin-bottom:8px;">Session completed</div>
                <div class="suggestions row g-2 mt-2">
                    <div class="col-12 col-sm-6"><button class="btn btn-primary w-100" onclick="window.open('${formUrl}','_blank')">
                        <i class="ph-thin ph-arrow-square-out" style="margin-right:4px"></i>Open Form
                    </button></div>
                    <div class="col-12 col-sm-6"><button class="btn btn-outline-primary w-100" onclick="newChatFromSidebar()">
                        <i class="ph-thin ph-plus" style="margin-right:4px"></i>New Chat
                    </button></div>
                </div>
            </div>`;
    }
    messagesArea.appendChild(closingDiv);
    scrollToBottom();
    state._replayMode = false;
}

/** Toggle the left sidebar open/closed */
function toggleSidebar() {
    const sidebar = document.getElementById('leftSidebar');
    sidebar.classList.toggle('collapsed');
}

/** New chat button from sidebar */
function newChatFromSidebar() {
    // If there's an active session that isn't completed yet, confirm before wiping
    if (state.sessionStarted && !state.sessionCompleted && state.conversationHistory.length > 0) {
        const name = state.chatName || state.templateName || 'this session';
        const confirmed = confirm(`You have an active session "${name}" in progress.\n\nAre you sure you want to start a new chat? Your progress is saved and you can resume it from the sidebar.`);
        if (!confirmed) return;
    }
    startNewSession();
    renderSidebarChats();
}

// Detect user's date format (MM/dd/yyyy vs dd/MM/yyyy)
function getUserDateFormat() {
    try {
        // Test with March 1, 2026 (month=2 is March in JS Date, which is the 3rd month)
        const testDate = new Date(2026, 2, 1); // March 1, 2026
        const formatted = testDate.toLocaleDateString();
        
        // Check if "03" appears before "01" (MM/dd/yyyy) or after (dd/MM/yyyy)
        const index03 = formatted.indexOf('03');
        const index01 = formatted.indexOf('01');
        
        if (index03 < index01) {
            return 'MM/dd/yyyy'; // US format
        } else {
            return 'dd/MM/yyyy'; // AU/UK format
        }
    } catch {
        return 'dd/MM/yyyy'; // Default to AU/UK
    }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    setGreeting();
    initializeQuill();
    initVoiceRecognition();

    // Load sidebar chats from API
    _loadSidebarFromDb();

    // Restore AI Memory confidence preference
    const savedConfidence = localStorage.getItem('memoryConfidence');
    if (savedConfidence) {
        const sel = document.getElementById('memoryConfidence');
        if (sel) sel.value = savedConfidence;
    }

    // Restore Smart Fill toggle (default: enabled on first visit)
    const smartFillOn = localStorage.getItem('smartFill') !== 'false';
    const sfToggle = document.getElementById('smartFillToggle');
    if (sfToggle) {
        sfToggle.checked = smartFillOn;
        applySmartFillStyle(smartFillOn);
    }

    // Auto-resume if ?sessionId=XXXXX is in the URL
    const sessionIdParam = new URLSearchParams(window.location.search).get('sessionId');
    if (sessionIdParam && parseInt(sessionIdParam, 10) > 0) {
        resumeSession(parseInt(sessionIdParam, 10));
    }
});

function setGreeting() {
    const hour = new Date().getHours();
    let greeting = 'Good morning';

    if (hour >= 12 && hour < 17) {
        greeting = 'Good afternoon';
    } else if (hour >= 17) {
        greeting = 'Good evening';
    }

    document.getElementById('greeting').textContent = `${greeting}, ${CONFIG.firstName}`;
}

/**
 * Persist the user's AI memory confidence preference.
 * Called by the select#memoryConfidence onchange handler.
 */
function saveMemoryConfidence(value) {
    localStorage.setItem('memoryConfidence', value);
}

function saveSmartFill(enabled) {
    localStorage.setItem('smartFill', enabled ? 'true' : 'false');
    applySmartFillStyle(enabled);
}

/** Set the topbar title text and toggle the edit button visibility. */
function setTopbarTitle(name) {
    const titleEl = document.getElementById('mainTopbarTitle');
    const editBtn = document.getElementById('topbarEditBtn');
    if (titleEl) {
        titleEl.textContent = name || '';
        titleEl.contentEditable = name ? 'plaintext-only' : 'false';
    }
    if (editBtn) editBtn.style.display = name ? 'flex' : 'none';
}

/** Focus the topbar title span and select all text for easy replacement. */
function focusTopbarTitle() {
    const el = document.getElementById('mainTopbarTitle');
    if (!el) return;
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
}

/** Save the topbar title after inline editing (called on blur). */
function saveTopbarTitle() {
    const el = document.getElementById('mainTopbarTitle');
    if (!el) return;
    const newName = el.textContent.trim();
    if (!newName) {
        el.textContent = state.chatName || state.templateName || 'Untitled Session';
        return;
    }
    if (newName === state.chatName) return;
    state.chatName = newName;
    if (state.regOthId) {
        fetch(`${CONFIG.apiUrl}/update-title`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                regOthID: state.regOthId,
                storeID: CONFIG.storeId,
                title: newName,
                updatedByID: CONFIG.userId
            })
        }).catch(err => console.warn('Failed to update session title:', err));
    }
    saveTranscript();
    renderSidebarChats();
}

function applySmartFillStyle(enabled) {
    const slider = document.getElementById('smartFillSlider');
    const knob   = document.getElementById('smartFillKnob');
    if (!slider || !knob) return;
    slider.style.background = enabled ? '#6366f1' : '#d1d5db';
    knob.style.transform    = enabled ? 'translateX(18px)' : 'translateX(0)';
}

/** Returns true when Smart Fill mode is active (defaults to enabled on first visit) */
function isSmartFillEnabled() {
    return localStorage.getItem('smartFill') !== 'false';
}

function autoResizeTextarea() {
    // No-op: Quill handles its own height
}

function initializeQuill() {
    const toolbarOptions = [
        ['bold', 'italic'],
        [{ list: 'bullet' }, { list: 'ordered' }]
    ];

    const sendBinding = {
        key: 'Enter',
        shiftKey: false,
        handler: function() {
            sendMessage();
            return false; // false = don't let Quill add a newline
        }
    };

    window.quillMain = new Quill('#messageInput', {
        theme: 'bubble',
        placeholder: 'What do you need help with? (e.g., I saw a hazard in the warehouse...)',
        modules: {
            toolbar: toolbarOptions,
            keyboard: { bindings: { send: sendBinding } }
        }
    });

    window.quillChat = new Quill('#chatMessageInput', {
        theme: 'bubble',
        placeholder: 'Type your message...',
        modules: {
            toolbar: toolbarOptions,
            keyboard: { bindings: { send: sendBinding } }
        }
    });
}

function handleMic() {
    if (!state.voiceMode) {
        startVoiceMode();
    } else {
        stopVoiceMode();
    }
}

function getActiveInput() {
    const mainContainer = document.getElementById('messageInput');
    const activeQuill = (mainContainer && mainContainer.offsetParent !== null)
        ? window.quillMain
        : window.quillChat;
    return {
        get value() {
            if (!activeQuill) return '';
            // getText() returns plain text — HTML is stripped automatically
            return activeQuill.getText().trim();
        },
        get htmlValue() {
            if (!activeQuill) return '';
            return activeQuill.root.innerHTML;
        },
        set value(v) {
            if (!activeQuill) return;
            activeQuill.setText(v || '');
        },
        style: { height: '' }, // no-op — Quill auto-sizes
        focus() { if (activeQuill) activeQuill.focus(); }
    };
}

// Disable/enable the chat Quill editor and update its placeholder
function setChatInputState(disabled, placeholderText) {
    if (window.quillChat) {
        window.quillChat.enable(!disabled);
        const editor = document.querySelector('#chatMessageInput .ql-editor');
        if (editor) editor.dataset.placeholder = placeholderText || '';
    }
}

// Clear both Quill editors (used on new session)
function clearAllInputs() {
    if (window.quillChat) window.quillChat.setText('');
    if (window.quillMain) window.quillMain.setText('');
}

function initVoiceRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        console.error('Speech recognition not supported in this browser');
        return;
    }
    // Store constructor for re-use
    window._SpeechRecognition = SpeechRecognition;
}

function createRecognitionInstance() {
    const SpeechRecognition = window._SpeechRecognition;
    if (!SpeechRecognition) return null;

    const rec = new SpeechRecognition();
    rec.continuous = false;       // stops naturally after end-of-speech
    rec.interimResults = true;    // show live text while speaking
    rec.lang = 'en-AU';
    rec.maxAlternatives = 1;

    rec.onstart = () => {
        state.isListening = true;
        finalTranscript = '';
        updateVoiceUI();
        showVoiceStatus('Listening... (speak now)');
    };

    rec.onresult = (event) => {
        let interimTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
                finalTranscript += transcript;
            } else {
                interimTranscript = transcript;
            }
        }
        // Mirror live into the active input
        getActiveInput().value = (finalTranscript + interimTranscript).trim();
    };

    rec.onerror = (event) => {
        // Always reset listening state so onend can restart cleanly
        state.isListening = false;
        if (event.error === 'no-speech' || event.error === 'aborted') {
            return; // Expected — onend will restart
        }
        console.error('Speech recognition error:', event.error);
    };

    rec.onend = () => {
        state.isListening = false;
        updateVoiceUI();

        // Chrome bug: onend sometimes fires before the final onresult.
        // Fall back to whatever is visible in the input box.
        const capturedText = finalTranscript.trim() || getActiveInput().value.trim();

        if (capturedText) {
            // Ensure input has the text before sendMessage reads it
            getActiveInput().value = capturedText;
            finalTranscript = '';
            // Barge-in: if AI is speaking, cancel TTS and process the user's speech immediately
            if (state.isSpeaking) {
                synthesis.cancel();
                state.isSpeaking = false;
                updateVoiceUI();
            }
            sendMessage();
        } else if (state.voiceMode && !state.isSpeaking && !state.isProcessing) {
            // Silence / no speech — restart listening after short pause
            setTimeout(() => {
                if (state.voiceMode && !state.isSpeaking && !state.isProcessing) {
                    startListening();
                }
            }, 300);
        }
    };

    return rec;
}

async function startVoiceMode() {
    // Check for microphone permission first
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }
        });
        stream.getTracks().forEach(track => track.stop()); // Stop the stream, we just needed permission

        state.voiceMode = true;
        updateVoiceUI();
        showVoiceStatus('Voice mode activated - speak naturally');

        // Show TTS toggle
        document.getElementById('voiceControlsContainer').classList.add('show');

        // Start listening — VAD needs async init, Web Speech uses a timeout
        if (state.sttEngine === 'vad') {
            await initAndStartVAD();
        } else {
            setTimeout(() => startListening(), 500);
        }
    } catch (error) {
        console.error('Microphone permission denied:', error);
        alert('Please allow microphone access to use voice mode.\n\nTip: For the permission to persist, open this page through a local web server (http://localhost) instead of as a file.');
        return;
    }
}

function stopVoiceMode() {
    state.voiceMode = false;
    state.isListening = false;
    state.isSpeaking = false;

    if (state.sttEngine === 'vad') {
        if (micVAD) { try { micVAD.pause(); } catch(e) {} }
    } else {
        if (recognition) { try { recognition.abort(); } catch(e) {} }
    }

    // Stop any ongoing speech
    synthesis.cancel();

    // Hide TTS toggle
    document.getElementById('voiceControlsContainer').classList.remove('show');

    updateVoiceUI();
    hideVoiceStatus();
}

function startListening() {
    if (!state.voiceMode || state.isListening || state.isSpeaking || state.isProcessing) return;

    // VAD path — VAD stream is always open; just resume it
    if (state.sttEngine === 'vad') {
        if (micVAD) {
            micVAD.start();
            state.isListening = true;
            updateVoiceUI();
            showVoiceStatus('Listening...');
        }
        return;
    }

    // Web Speech API path
    if (!window._SpeechRecognition) return;

    // Create a fresh instance each time — prevents Chrome's stale-object bug
    recognition = createRecognitionInstance();
    if (!recognition) return;

    try {
        recognition.start();
    } catch (e) {
        console.error('Error starting recognition:', e);
        state.isListening = false;
    }
}

function playChime() {
    return new Promise(resolve => {
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            // Soft 3-note descending bell arpeggio — B5 → G5 → E5 (warm, friendly, not queue-like)
            [[987.77, 0], [783.99, 0.22], [659.25, 0.42]].forEach(([freq, offset]) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.type = 'triangle';  // warmer tone than sine
                osc.frequency.value = freq;
                gain.gain.setValueAtTime(0, ctx.currentTime + offset);
                gain.gain.linearRampToValueAtTime(0.15, ctx.currentTime + offset + 0.015);
                gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + offset + 0.55);
                osc.start(ctx.currentTime + offset);
                osc.stop(ctx.currentTime + offset + 0.55);
            });
            setTimeout(resolve, 1000);
        } catch(e) {
            resolve(); // AudioContext not available — skip
        }
    });
}

async function speakHandoff() {
    if (!state.voiceMode || state.isProcessing) {
        if (state.voiceMode && !state.isProcessing) startListening();
        return;
    }
    await playChime();
    if (state.voiceMode) startListening();
}

function speakPhrase(text) {
    // Speak a phrase — route through selected engine, then open mic (not speakHandoff)
    const gen = ++ttsGeneration; // capture generation for this TTS slot
    const onComplete = () => {
        if (gen !== ttsGeneration) return; // a newer TTS has taken over — do nothing
        state.isSpeaking = false;
        // If the API response arrived while we were speaking, play it now rather than opening the mic
        if (state.pendingResponse) {
            const pending = state.pendingResponse;
            state.pendingResponse = null;
            speakText(pending);
            return;
        }
        if (state.voiceMode) setTimeout(() => startListening(), 300);
    };

    // Silence VAD before audio plays — mic only reopens after beep via startListening()
    if (state.sttEngine === 'vad' && micVAD) {
        try { micVAD.pause(); } catch(e) {}
    }
    synthesis.cancel();
    state.isSpeaking = true;
    updateVoiceUI();

    if (state.useElevenLabs && CONFIG.elevenlabsApiKey) {
        speakWithElevenLabs(text, gen, onComplete);
    } else {
        speakWithBrowserPhrase(text, gen, onComplete);
    }
}

function speakWithBrowserPhrase(text, gen, onComplete) {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-AU';
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;

    const t = setTimeout(() => {
        if (gen !== ttsGeneration) return;
        synthesis.cancel();
        updateVoiceUI();
        onComplete?.();
    }, 8000);

    utterance.onend = () => {
        clearTimeout(t);
        if (gen !== ttsGeneration) return; // superseded by newer TTS
        updateVoiceUI();
        onComplete?.();
    };
    utterance.onerror = () => {
        clearTimeout(t);
        if (gen !== ttsGeneration) return; // cancelled by speakText() — ignore
        updateVoiceUI();
        onComplete?.();
    };

    synthesis.speak(utterance);
}

async function speakThinking(context, userMessage) {
    if (!state.voiceMode) return;

    const fallbacks = {
        first: ["One moment.", "Got it, just a second.", "On it.", "Sure thing.", "Right, give me a sec."],
        template: ["Got it, one moment.", "Sure thing.", "On it.", "Just a second.", "Right away."],
        chat: ["One moment.", "Got it.", "Sure thing.", "Just a sec.", "On it.", "Right, one moment."]
    };

    const list = fallbacks[context] || fallbacks.chat;
    const fallback = list[Math.floor(Math.random() * list.length)];

    if (!CONFIG.openaiApiKey) {
        speakPhrase(fallback);
        return;
    }

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000); // 3s max — must be fast

        const systemPrompt = `You are a voice assistant. The user just sent a message and you are about to look up the answer.
Reply with ONE very short filler phrase (2-5 words max) that you would say while processing — like "Got it.", "One moment.", "Sure thing.", "On it.", "Just a sec."
Do NOT start an answer. Do NOT repeat the user's question. No quotation marks. Just the brief filler phrase.`;

        const userContext = userMessage
            ? `The user said: "${userMessage.substring(0, 120)}"`
            : `Context: ${context}`;

        const res = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            signal: controller.signal,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${CONFIG.openaiApiKey}`
            },
            body: JSON.stringify({
                model: 'gpt-4o-mini',
                max_tokens: 25,
                temperature: 0.9,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userContext }
                ]
            })
        });

        clearTimeout(timeout);

        if (res.ok) {
            const data = await res.json();
            trackCost('gpt-4o-mini', data.usage);
            const phrase = data.choices?.[0]?.message?.content?.trim();
            if (phrase) {
                speakPhrase(phrase);
                return;
            }
        }
    } catch (e) {
        // Timeout or network error — fall through to fallback
    }

    speakPhrase(fallback);
}

function speakText(text) {
    if (!state.voiceMode) return;

    // If a thinking phrase is still playing, queue the response and let it finish naturally
    if (state.isSpeaking) {
        state.pendingResponse = text;
        return;
    }
    state.pendingResponse = null; // clear any stale queue

    const gen = ++ttsGeneration; // capture generation for this TTS slot
    const onComplete = () => {
        if (gen !== ttsGeneration) return;
        state.isSpeaking = false;
    };

    // Stop any active capture — prevents AI hearing itself
    if (state.sttEngine === 'vad') {
        if (micVAD) { try { micVAD.pause(); } catch(e) {} }
        state.isListening = false;
    } else {
        if (recognition) { try { recognition.abort(); } catch(e) {} }
    }

    // Cancel any ongoing speech (e.g. thinking phrase)
    synthesis.cancel();

    // Clear previous speaking highlight
    if (state.speakingEl) {
        state.speakingEl.classList.remove('speaking');
        state.speakingEl = null;
    }

    // Highlight + scroll to the message being spoken
    const messages = document.querySelectorAll('.message.assistant');
    const lastMsg = messages[messages.length - 1];
    if (lastMsg) {
        lastMsg.classList.add('speaking');
        state.speakingEl = lastMsg;
        lastMsg.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    state.isSpeaking = true;
    updateVoiceUI();
    showVoiceStatus('AI Speaking...');

    if (state.useElevenLabs && CONFIG.elevenlabsApiKey) {
        speakWithElevenLabs(text, gen, () => {
            if (state.speakingEl) { state.speakingEl.classList.remove('speaking'); state.speakingEl = null; }
            if (gen === ttsGeneration) speakHandoff();
        });
    } else {
        speakWithBrowser(text, gen, () => {
            if (state.speakingEl) { state.speakingEl.classList.remove('speaking'); state.speakingEl = null; }
            if (gen === ttsGeneration) speakHandoff();
        });
    }
}

function speakWithBrowser(text, gen, onComplete) {
    // Trim to 300 chars to avoid Chrome's long-text stall bug
    const maxChars = 300;
    const trimmedText = text.length > maxChars
        ? text.substring(0, text.lastIndexOf(' ', maxChars)) + '...'
        : text;

    const utterance = new SpeechSynthesisUtterance(trimmedText);
    utterance.lang = 'en-AU';
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;

    // Hard timeout: if onend never fires (Chrome stall), force-unlock after 15s
    const synthTimeout = setTimeout(() => {
        if (gen !== ttsGeneration) return;
        synthesis.cancel();
        state.isSpeaking = false;
        updateVoiceUI();
        if (state.voiceMode && !state.isProcessing) setTimeout(() => startListening(), 500);
    }, 15000);

    utterance.onend = () => {
        clearTimeout(synthTimeout);
        if (gen !== ttsGeneration) return;
        state.isSpeaking = false;
        updateVoiceUI();
        onComplete?.();
    };

    utterance.onerror = (event) => {
        clearTimeout(synthTimeout);
        if (gen !== ttsGeneration) return; // cancelled by a newer TTS — ignore
        if (event.error !== 'canceled' && event.error !== 'interrupted') {
            console.error('Speech synthesis error:', event.error);
        }
        state.isSpeaking = false;
        updateVoiceUI();
        onComplete?.();
    };

    synthesis.speak(utterance);
}

async function speakWithElevenLabs(text, gen, onComplete) {
    try {
        const controller = new AbortController();
        const fetchTimeout = setTimeout(() => controller.abort(), 10000); // 10s timeout

        const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${CONFIG.elevenlabsVoiceId}`, {
            method: 'POST',
            signal: controller.signal,
            headers: {
                'Accept': 'audio/mpeg',
                'Content-Type': 'application/json',
                'xi-api-key': CONFIG.elevenlabsApiKey
            },
            body: JSON.stringify({
                text: text,
                model_id: 'eleven_turbo_v2_5',
                voice_settings: {
                    stability: 0.5,
                    similarity_boost: 0.75
                }
            })
        });
        clearTimeout(fetchTimeout);

        if (response.status === 401 || response.status === 403) {
            const errData = await response.json().catch(() => ({}));
            console.warn('ElevenLabs permission error — switching to browser TTS:', errData?.detail?.message || response.status);
            state.useElevenLabs = false;
            document.getElementById('ttsSelect').value = 'browser';
            speakWithBrowser(text, onComplete);
            return;
        }

        if (!response.ok) {
            throw new Error(`ElevenLabs API error: ${response.status}`);
        }

        const audioBlob = await response.blob();
        const audioUrl = URL.createObjectURL(audioBlob);
        const audio = new Audio(audioUrl);

        audio.onended = () => {
            URL.revokeObjectURL(audioUrl);
            if (gen !== ttsGeneration) return;
            state.isSpeaking = false;
            updateVoiceUI();
            onComplete?.();
        };

        audio.onerror = (event) => {
            console.error('Audio playback error:', event);
            URL.revokeObjectURL(audioUrl);
            if (gen !== ttsGeneration) return;
            state.isSpeaking = false;
            updateVoiceUI();
            onComplete?.();
        };

        await audio.play();
    } catch (error) {
        console.error('ElevenLabs TTS error:', error);
        speakWithBrowser(text, gen, onComplete);
    }
}

function onSTTChange(value) {
    // Stop voice mode before switching engines
    if (state.voiceMode) stopVoiceMode();
    // Destroy existing VAD instance so it's recreated fresh on next activation
    if (micVAD) {
        try { micVAD.pause(); } catch(e) {}
        micVAD = null;
    }
    state.sttEngine = value;
}

async function initAndStartVAD() {
    if (!window.vad) {
        alert('VAD library failed to load. Check your internet connection or switch to Web Speech API.');
        stopVoiceMode();
        return;
    }
    // Reuse existing instance if available
    if (micVAD) {
        micVAD.start();
        state.isListening = true;
        updateVoiceUI();
        showVoiceStatus('Listening...');
        return;
    }
    try {
        showVoiceStatus('Initializing VAD model...');
        micVAD = await vad.MicVAD.new({
            onSpeechStart: () => {
                if (!state.isSpeaking) {
                    state.isListening = true;
                    updateVoiceUI();
                    showVoiceStatus('Listening...');
                }
            },
            onSpeechEnd: async (audio) => {
                if (!state.voiceMode || state.isSpeaking || state.isProcessing) return;
                // Immediately silence the mic — don't let VAD capture anything
                // (transcription, API response, TTS) until after the beep
                micVAD.pause();
                state.isListening = false;
                updateVoiceUI();
                showVoiceStatus('Transcribing...');
                const text = await transcribeWithWhisper(audio);
                if (text) {
                    getActiveInput().value = text;
                    if (state.isSpeaking) {
                        synthesis.cancel();
                        state.isSpeaking = false;
                        updateVoiceUI();
                    }
                    sendMessage();
                } else if (state.voiceMode && !state.isSpeaking && !state.isProcessing) {
                    // Empty transcription (silence) — just keep listening
                    state.isListening = true;
                    updateVoiceUI();
                    showVoiceStatus('Listening...');
                }
            },
            onnxWASMBasePath: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/',
            baseAssetPath: 'https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.29/dist/',
        });
        micVAD.start();
        state.isListening = true;
        updateVoiceUI();
        showVoiceStatus('Listening...');
    } catch (e) {
        console.error('VAD init error:', e);
        alert('Failed to initialize VAD: ' + e.message);
        stopVoiceMode();
    }
}

async function transcribeWithWhisper(audioFloat32) {
    try {
        // Track Whisper cost by audio duration (16 kHz mono)
        const durationSec = audioFloat32.length / 16000;
        trackWhisper(durationSec);
        const wavBlob = float32ToWav(audioFloat32);
        const formData = new FormData();
        formData.append('file', wavBlob, 'audio.wav');
        formData.append('model', 'whisper-1');
        formData.append('language', 'en');
        const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${CONFIG.openaiApiKey}` },
            body: formData
        });
        if (!response.ok) throw new Error(`Whisper API error: ${response.status}`);
        const data = await response.json();
        return data.text?.trim() || '';
    } catch (error) {
        console.error('Whisper transcription error:', error);
        return '';
    }
}

function float32ToWav(float32Array, sampleRate = 16000) {
    const buffer = new ArrayBuffer(44 + float32Array.length * 2);
    const view = new DataView(buffer);
    const writeString = (offset, str) => {
        for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    };
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + float32Array.length * 2, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);   // PCM format
    view.setUint16(22, 1, true);   // mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);  // 16-bit
    writeString(36, 'data');
    view.setUint32(40, float32Array.length * 2, true);
    let offset = 44;
    for (let i = 0; i < float32Array.length; i++) {
        const s = Math.max(-1, Math.min(1, float32Array[i]));
        view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
        offset += 2;
    }
    return new Blob([buffer], { type: 'audio/wav' });
}

function onTTSChange(value) {
    if (value.startsWith('el:')) {
        if (!CONFIG.elevenlabsApiKey) {
            alert('Please add your ElevenLabs API key in the CONFIG section.\n\nGet your API key at: https://elevenlabs.io');
            document.getElementById('ttsSelect').value = 'browser';
            state.useElevenLabs = false;
            return;
        }
        state.useElevenLabs = true;
        CONFIG.elevenlabsVoiceId = value.substring(3);
    } else {
        state.useElevenLabs = false;
    }
}

function updateVoiceUI() {
    const micBtn = document.querySelectorAll('.mic-btn');

    micBtn.forEach(btn => {
        btn.classList.remove('active', 'listening');

        if (state.voiceMode) {
            if (state.isSpeaking) {
                btn.classList.add('active');
            } else if (state.isListening) {
                btn.classList.add('listening');
            } else {
                btn.classList.add('active');
            }
        }
    });
}

function showVoiceStatus(message) {
    const statusDiv = document.getElementById('voiceStatus');
    const statusText = document.getElementById('voiceStatusText');

    statusText.textContent = message;
    statusDiv.classList.add('show');

    if (state.isListening) {
        statusDiv.classList.add('listening');
        statusDiv.classList.remove('speaking');
    } else if (state.isSpeaking) {
        statusDiv.classList.add('speaking');
        statusDiv.classList.remove('listening');
    } else {
        statusDiv.classList.remove('listening', 'speaking');
    }
}

function hideVoiceStatus() {
    const statusDiv = document.getElementById('voiceStatus');
    statusDiv.classList.remove('show', 'listening', 'speaking');
}

function getCurrentPageId() {
    try {
        return new URLSearchParams(window.location.search).get('Page') || '';
    } catch {
        return '';
    }
}

function appendCurrentPageId(url) {
    if (!url) return url;
    const pageId = getCurrentPageId();
    if (!pageId) return url;
    if (/[?&]Page=/i.test(url)) return url;
    return `${url}${url.includes('?') ? '&' : '?'}Page=${encodeURIComponent(pageId)}`;
}

// TemplateTypeID → PageId lookup table (from ref_TemplateTypes / page=data.csv)
// Only includes rows where PageId is known (non-null, non-zero)
const TEMPLATE_TYPE_PAGE_MAP = {
    121: 922, 122: 973, 128: 924, 129: 951, 130: 970, 131: 971, 132: 972,
    143: 987, 145: 989, 146: 990, 147: 991, 148: 992, 149: 993, 150: 994,
    614: 818, 1000: 974, 1001: 975,
    1300: 1499, 1301: 1009, 1304: 1201, 1305: 1202, 1306: 1012, 1307: 1014,
    1308: 871, 1309: 871, 1310: 871, 1311: 871, 1312: 871, 1313: 871,
    1314: 871, 1315: 871, 1316: 871, 1317: 871, 1318: 871, 1319: 871,
    1320: 871, 1321: 871, 1322: 871, 1323: 871, 1324: 871, 1325: 871,
    1326: 871, 1327: 871, 1328: 871, 1329: 871, 1330: 871, 1331: 871,
    1332: 871, 1333: 1054, 1334: 1060, 1335: 1061, 1337: 1064, 1338: 1066,
    1339: 728, 1340: 871, 1341: 870, 1342: 731, 1343: 732
};

function buildChecklistUrl(regOthId, templateName = '', moduleName = '') {
    if (!regOthId) return null;
    const haystack = ((templateName || '') + ' ' + (moduleName || '')).toLowerCase();
    const g = haystack.includes('incident') ? 'INCIDENT' : '';

    // Append Page= from lookup table (preferred) or current URL
    const pageId = state.templateTypeId && TEMPLATE_TYPE_PAGE_MAP[state.templateTypeId]
        ? TEMPLATE_TYPE_PAGE_MAP[state.templateTypeId]
        : getCurrentPageId();

    const isComplete = state.sessionCompleted || Number(state.completionPercentage || 0) >= 100;
    console.log('🏗️  buildChecklistUrl - state.regTypeId:', state.regTypeId, 'isComplete:', isComplete);
    let url = isComplete
        ? `https://beta.whsmonitor.com.au/App/Register/AddEditRegistOthV2.aspx?RegID=${encodeURIComponent(regOthId)}&gt=${encodeURIComponent(state.regTypeId || '')}`
        : `https://beta.whsmonitor.com.au/App/RiskAssessor/ChecklistV2.aspx?regothId=${regOthId}&IsEdit=1&g=${g}&isBeta=1`;

    if (pageId) url += `&Page=${encodeURIComponent(pageId)}`;
    console.log('🏗️  buildChecklistUrl - Final URL:', url);
    return url;
}

function buildCompleteUrl(regOthId, templateName = '', moduleName = '') {
    if (!regOthId) return null;
    const haystack = ((templateName || '') + ' ' + (moduleName || '')).toLowerCase();
    const g = haystack.includes('incident') ? 'INCIDENT' : '';

    let url = `https://beta.whsmonitor.com.au/App/RiskAssessor/Complete.aspx?rfid=${encodeURIComponent(regOthId)}&g=${encodeURIComponent(g)}`;

    const pageId = getCurrentPageId() || state.pageId ||
        (state.templateTypeId && TEMPLATE_TYPE_PAGE_MAP[state.templateTypeId]
            ? TEMPLATE_TYPE_PAGE_MAP[state.templateTypeId]
            : '');

    if (pageId) url += `&Page=${encodeURIComponent(pageId)}`;
    return url;
}

function getFormUrl() {
    const url = buildChecklistUrl(state.regOthId, state.templateName, state.moduleName);
    console.log('🔗 getFormUrl() called, state values:', { regOthId: state.regOthId, regTypeId: state.regTypeId, templateName: state.templateName });
    console.log('🔗 Generated URL:', url);
    return url;
}

async function registerOthHdrFinish() {
    if (!state.regOthId) return null;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
        const response = await fetch(`${ASMX_BASE_URL}/RegisterOthHdrFinish`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({
                data: {
                    RegOthId: state.regOthId,
                    CreatedById: CONFIG.userId,
                    CreatedByName: CONFIG.userProfile.FullName || CONFIG.userName || CONFIG.firstName
                }
            })
        });

        const text = await response.text();
        let result = null;

        try {
            result = text ? JSON.parse(text) : null;
        } catch {
            result = text;
        }

        if (!response.ok) {
            console.warn(`[Complete] RegisterOthHdrFinish failed (${response.status})`, result);
            return null;
        }

        return result?.d ?? result;
    } catch (error) {
        console.warn('[Complete] RegisterOthHdrFinish skipped:', error);
        return null;
    } finally {
        clearTimeout(timeout);
    }
}

/**
 * Uses OpenAI (gpt-4o-mini) to decide whether the user's message is asking
 * to view / open / see the form. If yes, opens the form URL in a new tab,
 * adds an AI reply, speaks it in voice mode, and returns true so the
 * normal chat pipeline is skipped.
 */
async function checkAndHandleFormIntent(message) {
    if (!state.regOthId || !CONFIG.openaiApiKey) return false;
    // Only run intent check on short, directive messages — never on form field answers or pastes
    if (message.length > 80) return false;

    try {
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), 4000);

        const res = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            signal: controller.signal,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${CONFIG.openaiApiKey}`
            },
            body: JSON.stringify({
                model: 'gpt-4o-mini',
                max_tokens: 5,
                temperature: 0,
                messages: [
                    {
                        role: 'system',
                        content: 'You are an intent classifier. Reply with ONLY "yes" or "no". ' +
                                 'Does the user EXPLICITLY ask to open, view, show, or navigate to a form or page? ' +
                                 'Only reply "yes" if the message contains a clear action verb like open/view/show/go to directed at a form. ' +
                                 'Answering a question, providing information, or mentioning a document title is NOT a form open request.'
                    },
                    { role: 'user', content: message }
                ]
            })
        });

        clearTimeout(t);

        if (res.ok) {
            const data = await res.json();
            trackCost('gpt-4o-mini', data.usage);
            const answer = data.choices?.[0]?.message?.content?.trim().toLowerCase();
            if (answer === 'yes') {
                const url = getFormUrl();
                addMessage('user', message);
                const reply = `Opening the form for you now. It will load in a new tab.`;
                addMessage('assistant', reply);
                if (state.voiceMode) speakText(reply);
                window.open(url, '_blank');
                return true;
            }
        }
    } catch (e) {
        // Timeout or network error — let the normal pipeline handle it
    }
    return false;
}

/**
 * Detects whether the user is asking for suggestions/options/help.
 * If yes AND no suggestion pills are currently visible, asks OpenAI to generate
 * 3-4 contextual suggestions based on the conversation, then shows them as pills.
 * Returns true if handled so sendMessage skips the normal chat pipeline.
 */
async function checkAndHandleSuggestionsIntent(message) {
    if (!state.sessionStarted || !CONFIG.openaiApiKey) return false;

    // Only trigger if there are no suggestion pills currently visible
    const pillsVisible = document.querySelectorAll('.suggestions').length > 0;
    if (pillsVisible) return false;

    try {
        // Step 1 — intent classification (fast, 4s max)
        const ctrl1 = new AbortController();
        const t1 = setTimeout(() => ctrl1.abort(), 4000);

        const intentRes = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            signal: ctrl1.signal,
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${CONFIG.openaiApiKey}` },
            body: JSON.stringify({
                model: 'gpt-4o-mini',
                max_tokens: 5,
                temperature: 0,
                messages: [
                    {
                        role: 'system',
                        content: 'You are an intent classifier. Reply ONLY "yes" or "no". ' +
                                 'Is the user asking for suggestions, options, ideas, examples, or help on what to say or do next?'
                    },
                    { role: 'user', content: message }
                ]
            })
        });
        clearTimeout(t1);

        if (!intentRes.ok) return false;
        const intentData = await intentRes.json();
        trackCost('gpt-4o-mini', intentData.usage);
        const isIntent = intentData.choices?.[0]?.message?.content?.trim().toLowerCase() === 'yes';
        if (!isIntent) return false;

        // Prefer current in-context options if available (better than generating generic AI suggestions)
        const reusableSuggestions = Array.isArray(state.lastSuggestedQuestions)
            ? state.lastSuggestedQuestions.filter(Boolean).slice(0, 8)
            : [];
        const sameFieldSuggestions = reusableSuggestions.length > 0
            && String(state.lastSuggestionFieldId || '') === String(state.currentFieldID || '');

        if (sameFieldSuggestions) {
            addMessage('user', message);
            addMessage('assistant', 'Here are the available options for this question:');
            addSuggestions(reusableSuggestions);
            if (state.voiceMode) speakText('Here are the available options for this question.');
            return true;
        }

        // Step 2 — generate contextual suggestions
        const recentHistory = state.conversationHistory.slice(-6)
            .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
            .join('\n');

        const knownFieldFacts = Array.from(state.extractedFieldsMap.values())
            .slice(-8)
            .map(f => `${f.fieldName || f.fieldID || 'Field'}: ${f.extractedValue || f.value || ''}`)
            .filter(Boolean)
            .join('; ') || 'none yet';

        const currentFieldContext = `Current field ID: ${state.currentFieldID || 'n/a'}; Type: ${state.currentFieldType || 'n/a'}; Required: ${state.currentFieldRequired === false ? 'no' : 'yes'}`;

        const profileContext = Object.entries(CONFIG.userProfile || {})
            .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '')
            .map(([k, v]) => `${k}: ${v}`)
            .join('; ') || 'none';

        const ctrl2 = new AbortController();
        const t2 = setTimeout(() => ctrl2.abort(), 6000);

        const suggRes = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            signal: ctrl2.signal,
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${CONFIG.openaiApiKey}` },
            body: JSON.stringify({
                model: 'gpt-4o-mini',
                max_tokens: 120,
                temperature: 0.7,
                messages: [
                    {
                        role: 'system',
                        content: `You are a helpful assistant for a workplace health & safety app. ` +
                                 `The user is filling in a form called "${state.templateName || 'WHS form'}". ` +
                                 `Use available context first (current field + known captured values) and avoid generic suggestions. ` +
                                 `If clear options are implied by context, suggest those options directly. ` +
                                 `Based on the conversation below, suggest 3 short, specific things the user could say or answer next. ` +
                                 `Return ONLY a JSON array of 3 strings, no explanation. Example: ["Yes, I was injured", "No injuries occurred", "I need more information"]`
                    },
                    {
                        role: 'user',
                        content: `Conversation:\n${recentHistory}\n\n${currentFieldContext}\nKnown captured fields: ${knownFieldFacts}\nUser profile: ${profileContext}`
                    }
                ]
            })
        });
        clearTimeout(t2);

        if (!suggRes.ok) return false;
        const suggData = await suggRes.json();
        trackCost('gpt-4o-mini', suggData.usage);
        const raw = suggData.choices?.[0]?.message?.content?.trim();

        let suggestions;
        try {
            suggestions = JSON.parse(raw);
        } catch(e) {
            const match = raw?.match(/\[.*\]/s);
            suggestions = match ? JSON.parse(match[0]) : null;
        }

        if (!Array.isArray(suggestions) || suggestions.length === 0) return false;

        // Show as an AI message with pills
        addMessage('user', message);
        addMessage('assistant', 'Here are some suggestions based on your current form context:');
        addSuggestions(suggestions);
        if (state.voiceMode) speakText('Here are some suggestions based on your current form context.');

        return true;
    } catch(e) {
        // Timeout or parse error — fall through to normal chat
    }
    return false;
}

/**
 * Uses OpenAI to decide if the user wants to create a dashboard or report.
 * If yes, calls the DashboardAI generate endpoint and shows a link to the result.
 * Returns true if handled so sendMessage can skip the normal pipeline.
 */
async function checkAndHandleDashboardIntent(message) {
    if (!CONFIG.openaiApiKey) return false;
    try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 5000);

        const intentRes = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            signal: ctrl.signal,
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${CONFIG.openaiApiKey}` },
            body: JSON.stringify({
                model: 'gpt-4o-mini',
                max_tokens: 5,
                temperature: 0,
                messages: [
                    {
                        role: 'system',
                        content: 'You are an intent classifier. Reply ONLY "yes" or "no". ' +
                                 'Is the user asking to create, build, generate, or show a dashboard, report, or analytics/data visualisation?'
                    },
                    { role: 'user', content: message }
                ]
            })
        });
        clearTimeout(t);

        if (!intentRes.ok) return false;
        const intentData = await intentRes.json();
        trackCost('gpt-4o-mini', intentData.usage);
        const answer = intentData.choices?.[0]?.message?.content?.trim().toLowerCase();
        if (answer !== 'yes') return false;

        // Show user message then a typing indicator
        addMessage('user', message);
        state._initialMessageBubbleShown = true;
        showTypingIndicator(message);

        const dashBase = 'https://beta.whsmonitor.com.au/dashboardv2';
        const genRes = await fetch(dashBase + '/api/dashboard/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                prompt:  message,
                storeId: CONFIG.storeId,
                userId:  String(CONFIG.userId)
            })
        });

        removeTypingIndicator();

        if (!genRes.ok) {
            // If no session exists yet, fall through to the normal template-chat flow
            // so the user's message still starts an intelligent session.
            if (!state.sessionStarted) {
                return false;
            }
            const err = await genRes.json().catch(() => ({}));
            addMessage('assistant', `Could not generate dashboard: ${err.error || 'Unknown error'}`);
            return true;
        }

        const result = await genRes.json();
        const url = dashBase + result.redirectUrl;

        // Add an assistant message so the exchange is saved in the transcript
        addMessage('assistant', `✅ Dashboard created! [Click here to view it](${url})`);

        // If no form session, create a pseudo-ID so this chat appears in the sidebar
        if (!state.regOthId) {
            state.regOthId     = -Date.now();  // negative = dashboard-only, never a real form ID
            state.chatName     = state.chatName || 'Dashboard';
            state.templateName = state.templateName || 'Dashboard';
            state._chatCreatedAt = state._chatCreatedAt || new Date().toISOString();
            state.sessionStarted = true;
        }
        // Mark as dashboard so sidebar shows the right badge and skips DB save
        state._isDashboardSession = true;
        saveTranscript();

        state._initialMessageBubbleShown = false; // reset so next message works correctly
        parent.loadDashboardAI(url);

        return true;
    } catch (err) {
        if (err.name === 'AbortError') return false;
        console.error('[DashboardIntent]', err);
        return false;
    }
}

async function sendMessage() {
    const activeInput = getActiveInput();
    const message = activeInput.value.trim();
    // Capture HTML before anything clears the editor — used for display only, plain text goes to API
    state._pendingUserHtml = activeInput.htmlValue;

    if (!message) return;

    // Mark as processing so voice loop doesn't restart during API call
    state.isProcessing = true;

    // ── Supplementary card handler — locks chat to supp card until cont/skip
    if (typeof state._suppChatHandler === 'function') {
        activeInput.value = '';
        activeInput.style.height = 'auto';
        if (state.voiceMode) finalTranscript = '';
        state.isProcessing = false;
        addMessage('user', message);
        scrollToBottom();
        await state._suppChatHandler(message);
        return;
    }

    // ── Capture chat/session name if we're waiting for it ──────────────────
    if (state.awaitingChatName) {
        activeInput.value = '';
        if (state.voiceMode) finalTranscript = '';
        state.isProcessing = false;
        await handleChatNameResponse(message);
        return;
    }

    // Hard lock: while header/details collection is active, do not allow
    // normal checklist send flow to run. Only the active header callback may consume input.
    if (state._collectingHeaderDetails && !(state.awaitingHeaderField && state._headerFieldCallback)) {
        activeInput.value = '';
        activeInput.style.height = 'auto';
        if (state.voiceMode) finalTranscript = '';
        state.isProcessing = false;
        addMessage('assistant', 'Let’s finish the details section first. Please answer the current details question.');
        scrollToBottom();
        return;
    }

    // ── Capture header field answer if we're waiting for it ──────────────
    if (state.awaitingHeaderField && state._headerFieldCallback) {
        activeInput.value = '';
        activeInput.style.height = 'auto';
        if (state.voiceMode) finalTranscript = '';
        document.querySelectorAll('.hf-opts button').forEach(b => b.disabled = true);
        state.awaitingHeaderField = false;
        const _hdrCb = state._headerFieldCallback;
        state._headerFieldCallback = null;
        state.isProcessing = false;
        addMessage('user', message);
        scrollToBottom();
        await _hdrCb(message, message, false);
        return;
    }

    // Check if awaiting template selection and try to match voice input
    if (state.awaitingTemplateSelection && state.availableTemplates.length > 0) {
        const matchedTemplate = matchVoiceToTemplate(message);
        if (matchedTemplate) {
            // Clear input first
            activeInput.value = '';
            activeInput.style.height = 'auto';
            if (state.voiceMode) {
                finalTranscript = '';
            }

            // Select the template
            await selectTemplate(
                matchedTemplate.templateID,
                matchedTemplate.templateName,
                matchedTemplate.estimatedFields || 0,
                matchedTemplate
            );
            state.isProcessing = false;
            return;
        }
    }

    // Hide empty state and show chat input
    document.getElementById('emptyState').style.display = 'none';
    document.getElementById('messagesArea').classList.add('active');
    document.getElementById('chatInputArea').style.display = 'block';

    // Check if the user is asking to open/view the form (only once a session exists)
    if (state.sessionStarted && state.regOthId) {
        const formHandled = await checkAndHandleFormIntent(message);
        if (formHandled) {
            activeInput.value = '';
            activeInput.style.height = 'auto';
            if (state.voiceMode) finalTranscript = '';
            state.isProcessing = false;
            return;
        }
    }

    if (isAwaitingCompletion()) {
        activeInput.value = '';
        activeInput.style.height = 'auto';
        if (state.voiceMode) finalTranscript = '';
        promptCompletion();
        state.isProcessing = false;
        return;
    }

    // Check if the user is asking for suggestions
    if (state.sessionStarted) {
        const suggestionsHandled = await checkAndHandleSuggestionsIntent(message);
        if (suggestionsHandled) {
            activeInput.value = '';
            activeInput.style.height = 'auto';
            if (state.voiceMode) finalTranscript = '';
            state.isProcessing = false;
            if (state.voiceMode && !state.isSpeaking && !state.isListening) {
                setTimeout(() => startListening(), 600);
            }
            return;
        }
    }

    // Check if the user wants to create a dashboard or report
    // Skip entirely once a real form session is in progress — never interrupt an active form
    const dashboardHandled = (state.sessionStarted && state.regOthId > 0)
        ? false
        : await checkAndHandleDashboardIntent(message);
    if (dashboardHandled) {
        activeInput.value = '';
        activeInput.style.height = 'auto';
        if (state.voiceMode) finalTranscript = '';
        state.isProcessing = false;
        if (state.voiceMode && !state.isSpeaking && !state.isListening) {
            setTimeout(() => startListening(), 600);
        }
        return;
    }

    // Check if this is the first message
    if (!state.sessionStarted) {
        await startIntelligentSession(message);
    } else {
        // Special handling for map fields — map must always be confirmed via the "Confirm Location"
        // button. Never auto-extract from the map state based on a typed "Yes"/"Confirm" message.
        if (state.currentFieldType === '10016' && 
            (message.toLowerCase() === 'yes' || message.toLowerCase() === 'confirm' || 
             message.toLowerCase() === 'correct' || message.toLowerCase() === "that's correct")) {
            
            if (state.lastMapData) {
                // User already clicked "Confirm Location" — send the stored confirmed data
                console.log('User confirmed map location via input, sending stored map data:', state.lastMapData);
                await sendChatMessage(state.lastMapData);
                state.lastMapData = null;
            } else {
                // Map still visible but not confirmed — require user to click "Confirm Location"
                await sendChatMessage(message);
            }
        } else if (state.currentFieldType === '10020' || state.currentFieldType === '10026') {
            // Dataset Dropdown (single) — {"Value":"0","Text":"user input"}
            const datasetJson = JSON.stringify({ Value: "0", Text: message });
            await sendChatMessage(datasetJson, message);
        } else if (state.currentFieldType === '10037') {
            // Dataset Multi-select — split comma-delimited input into arrays
            // e.g. "Vik Sathivail, Nick, David" → {"Value":[0,0,0],"Text":["Vik Sathivail","Nick","David"]}
            const items = message.split(',').map(s => s.trim()).filter(s => s.length > 0);
            const multiJson = JSON.stringify({
                Value: items.map(() => 0),
                Text: items
            });
            await sendChatMessage(multiJson, message);
        } else if (state.currentFieldType === '10023') {
            // Substatement list box — multi-select stored with tilde (~)
            const items = message.split(/[,;~]/).map(s => s.trim()).filter(s => s.length > 0);
            await sendChatMessage(items.join('~') || message, message);
        } else {
            await sendChatMessage(message);
        }
    }

    // Clear input
    activeInput.value = '';
    activeInput.style.height = 'auto';

    // Reset transcript if in voice mode
    if (state.voiceMode) {
        finalTranscript = '';
    }

    // Done processing - speakText will handle restarting the listener
    state.isProcessing = false;

    // Safety: if voice mode is on and TTS isn't running, restart listening now
    if (state.voiceMode && !state.isSpeaking && !state.isListening) {
        setTimeout(() => startListening(), 600);
    }
}

function matchVoiceToTemplate(spokenText) {
    const text = spokenText.toLowerCase().trim();

    // Number word mapping
    const numberWords = {
        'one': 1, 'first': 1, '1': 1,
        'two': 2, 'second': 2, '2': 2,
        'three': 3, 'third': 3, '3': 3,
        'four': 4, 'fourth': 4, '4': 4,
        'five': 5, 'fifth': 5, '5': 5
    };

    // Try to match by number
    for (const [word, num] of Object.entries(numberWords)) {
        if (text.includes(word)) {
            const index = num - 1;
            if (index >= 0 && index < state.availableTemplates.length) {
                console.log(`Matched template ${num}: ${state.availableTemplates[index].templateName}`);
                return state.availableTemplates[index];
            }
        }
    }

    // Try to match by template name (partial match)
    for (const template of state.availableTemplates) {
        const templateName = template.templateName.toLowerCase();
        const templateWords = templateName.split(' ');

        // Check if spoken text contains key words from template name
        let matchCount = 0;
        for (const word of templateWords) {
            if (word.length > 3 && text.includes(word)) {
                matchCount++;
            }
        }

        // If we matched at least 2 significant words, or the template name is in the text
        if (matchCount >= 2 || text.includes(templateName)) {
            console.log(`Matched template by name: ${template.templateName}`);
            return template;
        }
    }

    return null;
}

/**
 * Uses GPT-4o-mini to generate a short, descriptive session name based on
 * the user's initial message and the chosen template name.
 */
async function generateSessionName(initialMessage, templateName) {
    try {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${CONFIG.openaiApiKey}` },
            signal: AbortSignal.timeout(5000),
            body: JSON.stringify({
                model: 'gpt-4o-mini',
                max_tokens: 15,
                messages: [
                    {
                        role: 'system',
                        content: 'Generate a short, descriptive session name (max 6 words, no quotes) based on the user message and template. Be specific and concise.'
                    },
                    {
                        role: 'user',
                        content: `Template: ${templateName}\nUser message: ${initialMessage}\n\nSession name:`
                    }
                ]
            })
        });
        const data = await response.json();
        trackCost('gpt-4o-mini', data.usage);
        const name = (data.choices?.[0]?.message?.content || '').trim().replace(/^["']|["']$/g, '');
        return name || templateName || 'Untitled Session';
    } catch (e) {
        console.warn('[generateSessionName] Failed:', e);
        return templateName || 'Untitled Session';
    }
}

function rankTemplatesForIntent(templates, message) {
    if (!Array.isArray(templates) || templates.length === 0) return [];

    const lower = String(message || '').toLowerCase();
    const stopWords = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'need', 'raise', 'want', 'have', 'about', 'report']);
    const tokens = lower
        .split(/[^a-z0-9]+/)
        .filter(token => token && token.length > 2 && !stopWords.has(token));

    const intentGroups = [
        {
            trigger: /(incident|injury|accident|near\s*miss)/,
            positive: ['incident', 'injury', 'accident', 'near miss'],
            negative: ['audit', 'inspection', 'jsa', 'jsms']
        },
        {
            trigger: /(hazard|risk)/,
            positive: ['hazard', 'risk'],
            negative: ['audit']
        },
        {
            trigger: /(audit)/,
            positive: ['audit'],
            negative: ['incident', 'inspection']
        },
        {
            trigger: /(inspection|inspect)/,
            positive: ['inspection', 'inspect'],
            negative: ['incident', 'audit']
        },
        {
            trigger: /(contractor|jsa|jsms|safe work method|swms)/,
            positive: ['contractor', 'jsa', 'jsms', 'swms'],
            negative: ['incident']
        }
    ];

    return templates
        .map(template => {
            const searchText = `${template.templateName || ''} ${template.moduleName || ''}`.toLowerCase();
            let score = 0;

            for (const token of tokens) {
                if (searchText.includes(token)) score += 4;
            }

            intentGroups.forEach(group => {
                if (group.trigger.test(lower)) {
                    group.positive.forEach(term => {
                        if (searchText.includes(term)) score += 30;
                    });
                    group.negative.forEach(term => {
                        if (searchText.includes(term)) score -= 20;
                    });
                }
            });

            if (lower.includes('incident') && /^incident\b/.test(searchText)) score += 40;
            if (lower.includes('hazard') && /^hazard\b/.test(searchText)) score += 40;
            if (lower.includes('audit') && /^audit\b/.test(searchText)) score += 40;
            if (lower.includes('inspection') && /^inspection\b/.test(searchText)) score += 40;

            return { ...template, _rankScore: score };
        })
        .sort((a, b) => b._rankScore - a._rankScore || a.templateName.localeCompare(b.templateName));
}

function filterTemplatesForIntent(templates, message) {
    if (!Array.isArray(templates) || templates.length === 0) return [];

    const lower = String(message || '').toLowerCase();
    const filterGroups = [
        {
            trigger: /(incident|injury|accident|near\s*miss)/,
            terms: ['incident', 'injury', 'accident', 'near miss']
        },
        {
            trigger: /(hazard|risk)/,
            terms: ['hazard', 'risk']
        },
        {
            trigger: /(audit)/,
            terms: ['audit']
        },
        {
            trigger: /(inspection|inspect)/,
            terms: ['inspection', 'inspect']
        },
        {
            trigger: /(contractor|jsa|jsms|safe work method|swms)/,
            terms: ['contractor', 'jsa', 'jsms', 'safe work method', 'swms']
        }
    ];

    const matchedGroup = filterGroups.find(group => group.trigger.test(lower));
    if (!matchedGroup) return templates;

    const filtered = templates.filter(template => {
        const searchText = `${template.templateName || ''} ${template.moduleName || ''}`.toLowerCase();
        return matchedGroup.terms.some(term => searchText.includes(term));
    });

    return filtered.length > 0 ? filtered : templates;
}

async function promptManualTemplateSelection() {
    try {
        const response = await fetch(`${CONFIG.apiUrl}/templates?storeId=${CONFIG.storeId}`);
        const data = await response.json();

        const modules = data?.modules || data?.Modules || [];
        const allTemplates = modules.flatMap(module => {
            const templates = module?.templates || module?.Templates || [];
            return templates.map(template => ({
                templateID: template.templateID ?? template.TemplateID,
                templateName: template.templateName ?? template.TemplateName,
                estimatedFields: template.estimatedFields ?? template.EstimatedFields ?? 0,
                moduleID: template.moduleID ?? template.ModuleID ?? module.moduleID ?? module.ModuleID ?? 0,
                templateTypeID: template.templateTypeID ?? template.TemplateTypeID ?? null,
                moduleName: module.moduleName ?? module.ModuleName ?? ''
            })).filter(t => t.templateID && t.templateName);
        });

        if (!allTemplates.length) {
            addMessage('assistant', 'I could not load templates right now. Please try again.');
            return;
        }

        const filteredTemplates = filterTemplatesForIntent(allTemplates, state.initialMessage);
        const rankedTemplates = rankTemplatesForIntent(filteredTemplates, state.initialMessage);
        const topTemplates = rankedTemplates.slice(0, 8);
        const moreTemplates = rankedTemplates.slice(8);

        addMessage('assistant', 'Please choose which template you want to use. I\'ve put the most relevant ones first.');
        state.additionalTemplateChoices = moreTemplates;
        addTemplateList(topTemplates, moreTemplates);
        state.awaitingTemplateSelection = true;
    } catch (error) {
        console.warn('[TemplateSelection] Failed to load templates:', error);
        addMessage('assistant', 'I could not load templates right now. Please try again.');
    }
}

async function startIntelligentSession(initialMessage, selectedTemplateID = null) {
    // Store initial message
    if (!selectedTemplateID) {
        state.initialMessage = initialMessage;
        // Skip the bubble if the dashboard-intent path already rendered it
        if (!state._initialMessageBubbleShown) {
            addMessage('user', initialMessage);
        }
        state._initialMessageBubbleShown = false; // reset for next turn
    }

    // Show typing indicator
    showTypingIndicator(state.initialMessage);

    // Speak thinking phrase in voice mode (fire-and-forget — runs parallel to API call)
    speakThinking(selectedTemplateID ? 'template' : 'first', state.initialMessage);

    try {
        const requestBody = {
            storeID: CONFIG.storeId,
            createdByID: CONFIG.userId,
            createdByName: CONFIG.userName,
            initialMessage: state.initialMessage,
            currentDateTime: new Date().toISOString(),
            userTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            userDateFormat: getUserDateFormat(),
            userProfile: CONFIG.userProfile
        };

        if (selectedTemplateID) {
            requestBody.selectedTemplateID = selectedTemplateID;
        }

        const response = await fetch(`${CONFIG.apiUrl}/start-intelligent`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });

        const data = await response.json();
        removeTypingIndicator();

        if (data.success) {
            // Template selection
            if (data.needsTemplateSelection && data.templateChoices && data.templateChoices.length > 0) {
                trackServerCost(data.tokenUsage);
                addMessage('assistant', data.aiMessage);
                state.additionalTemplateChoices = data.additionalTemplateChoices || [];
                addTemplateList(data.templateChoices, state.additionalTemplateChoices);
                state.awaitingTemplateSelection = true;
                return;
            }

            // Session created
            state.sessionStarted = true;
            state.sessionCompleted = false;
            state._serverMarkedComplete = !!data.isComplete;
            state.awaitingTemplateSelection = false;
            state.regOthId = data.regOthID;
            state.internalNo = data.internalNo;
            state.templateName = data.templateName;
            state.moduleName = data.moduleName || '';
            console.log('📡 API Response data.regTypeID:', data.regTypeID, 'All data keys:', Object.keys(data));
            // Try all variations of RegTypeID property name
            state.regTypeId = Number(data.RegTypeID || data.regTypeID || data.regTypeId || 0);
            console.log('✅ Set state.regTypeId to:', state.regTypeId, '(from variations of RegTypeID property)');
            if (data.templateTypeID) state.templateTypeId = data.templateTypeID;
            state.pageId = (state.templateTypeId && TEMPLATE_TYPE_PAGE_MAP[state.templateTypeId])
                ? TEMPLATE_TYPE_PAGE_MAP[state.templateTypeId] : null;
            trackServerCost(data.tokenUsage);
            // Show the progress toggle button now that a session exists
            document.getElementById('progressToggle').style.display = 'flex';
            state.conversationHistory = [
                { role: 'user', content: state.initialMessage },
                { role: 'assistant', content: data.aiMessage }
            ];

            // Store current field info
            state.currentFieldID = data.currentFieldID;
            state.currentFieldType = data.currentFieldType;
            state.currentFieldRequired = data.isCurrentFieldRequired !== false;
            state.currentFieldDynamicFilter = data.currentFieldDynamicFilter || null;
            if (data.totalFields !== undefined && data.totalFields !== null) state.totalFieldCount = data.totalFields;
            if (data.answeredFields !== undefined && data.answeredFields !== null) state.answeredFieldCount = data.answeredFields;
            if (data.completionPercentage !== undefined) state.completionPercentage = data.completionPercentage;
            if (data.templateTypeID) state.templateTypeId = data.templateTypeID;

            // ── Auto-name this session silently, then proceed ────────────────
            state._pendingSessionData = data;
            const autoName = await generateSessionName(state.initialMessage, data.templateName);
            await handleChatNameResponse(autoName, true /* silent */);
            return;

        } else {
            addMessage('assistant', `${data.errorMessage || 'Failed to start session'}`);
        }
    } catch (error) {
        removeTypingIndicator();
        addMessage('assistant', `Error: ${error.message}`);
    }
}

async function sendChatMessage(message, displayText) {
    addMessage('user', displayText || message);

    // Add to conversation history
    state.conversationHistory.push({
        role: 'user',
        content: message
    });

    showTypingIndicator(message);

    // Speak thinking phrase in voice mode (fire-and-forget — runs parallel to API call)
    speakThinking('chat', message);

    try {
        const response = await fetch(`${CONFIG.apiUrl}/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                regOthID: state.regOthId,
                storeID: CONFIG.storeId,
                userMessage: message,
                userID: CONFIG.userId,
                conversationHistory: state.conversationHistory.slice(-10),
                fullConversationHistory: state.conversationHistory,
                currentDateTime: new Date().toISOString(),
                userTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                userDateFormat: getUserDateFormat(),
                memoryConfidence: localStorage.getItem('memoryConfidence') || 'medium',
                userProfile: CONFIG.userProfile,
                confirmedFieldIds: state.chatConfirmedFieldIds
            })
        });

        const data = await response.json();
        removeTypingIndicator();

        if (data.success) {
            trackServerCost(data.tokenUsage);

            // Store current field info
            state.currentFieldID = data.currentFieldID;
            state.currentFieldType = data.currentFieldType;
            state.currentFieldRequired = data.isCurrentFieldRequired !== false;
            state.currentFieldDynamicFilter = data.currentFieldDynamicFilter || null;
            
            // Clear lastMapData if we've moved away from map field
            if (state.currentFieldType !== '10016' && state.lastMapData) {
                console.log('Moved to new field type, clearing lastMapData');
                state.lastMapData = null;
            }

            // Helper: show the AI next-question message + next field UI
            // Called immediately when no photo prompt, or after photo prompt completes
            const showNextQuestionAndFieldUI = () => {
                // Show section divider when the form moves into a new section
                const incomingSection = data.currentSection || null;
                if (incomingSection && incomingSection !== state.currentSection) {
                    showSectionDivider(incomingSection, data.currentSubSection || null);
                }
                state.currentSection = incomingSection;

                addMessage('assistant', data.aiMessage);

                // Wrap cleanup and UI operations in setTimeout to prevent race condition
                setTimeout(() => {
                    console.log('[CLEANUP] Starting field UI cleanup for sendChatMessage');
                    console.log('[CLEANUP] Current field type:', state.currentFieldType);
                    
                    // Clean up previous field UI elements
                    const existingFileUpload = document.querySelector('.file-upload-container');
                    const existingMapContainer = document.querySelector('.map-container');
                    const existingDynamicData = document.querySelector('.dynamic-data-container');
                    
                    console.log('[CLEANUP] Found file upload container:', !!existingFileUpload);
                    console.log('[CLEANUP] Found map container:', !!existingMapContainer);
                    
                    if (state.currentFieldType !== '10013' && existingFileUpload) {
                        console.log('[CLEANUP] Removing file upload container');
                        existingFileUpload.remove();
                    }
                    if (state.currentFieldType !== '10016' && existingMapContainer) {
                        console.log('[CLEANUP] Removing map container');
                        existingMapContainer.remove();
                    }
                    if (state.currentFieldType !== '10020' && state.currentFieldType !== '10037' && existingDynamicData) {
                        existingDynamicData.remove();
                    }

                    // Show the next field's UI (file upload / dropdown / map / suggestions)
                    // Show file upload UI if current field is a file upload (Type Code 10013)
                    if (state.currentFieldType === '10013') {
                        console.log('[CLEANUP] Adding file upload UI');
                        addFileUploadUI();
                    }
                    // Show dynamic dropdown for dataset fields (10020 single / 10037 multi)
                    else if ((state.currentFieldType === '10020' || state.currentFieldType === '10026' || state.currentFieldType === '10037') && state.currentFieldDynamicFilter) {
                        addDynamicDataUI(state.currentFieldType, state.currentFieldDynamicFilter);
                    }
                    // Show map UI if current field is a map (Type Code 10016)
                    else if (state.currentFieldType === '10016') {
                        // Check if AI already extracted a location from the message
                        let initialLocation = null;
                        
                        console.log('Map field detected. Checking for location...');
                        console.log('Current field ID:', state.currentFieldID);
                        console.log('Extracted fields:', data.extractedFields);
                        console.log('AI message:', data.aiMessage);
                        console.log('User message:', message);
                        
                        if (data.extractedFields && data.extractedFields.length > 0) {
                            const mapField = data.extractedFields.find(f => f.fieldID === state.currentFieldID);
                            console.log('Found map field in extractedFields:', mapField);
                            if (mapField && mapField.extractedValue) {
                                try {
                                    const mapData = JSON.parse(mapField.extractedValue);
                                    initialLocation = mapData.Location || null;
                                    console.log('Parsed location from extractedValue:', initialLocation);
                                } catch (e) {
                                    // If not JSON, try to use the value as-is
                                    initialLocation = mapField.extractedValue;
                                    console.log('Using extractedValue as-is:', initialLocation);
                                }
                            }
                        }
                        
                        // If no location in extractedFields, try to extract from AI message (it often repeats the address)
                        if (!initialLocation && data.aiMessage) {
                            // Pattern to detect addresses in quotes or mentioned by AI
                            const addressPatterns = [
                                /"([^"]+(?:Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Lane|Ln|Boulevard|Blvd|Way|Place|Pl)[^"]+)"/i,
                                /address\s+"([^"]+)"/i,
                                /location\s+"([^"]+)"/i,
                                /(\d+\/\d+\s+[^,]+,\s*[^,]+(?:,\s*[A-Z]{2,4}(?:\s+\d+)?)?(?:,\s*[A-Za-z\s]+)?)/i, // Matches "3/9 McKay Lane, Turner ACT 2612, Australia"
                                /(\d+\s+[A-Za-z\s]+(?:Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Lane|Ln|Boulevard|Blvd|Way|Place|Pl)[^.!?,]*)/i
                            ];
                            
                            for (const pattern of addressPatterns) {
                                const match = data.aiMessage.match(pattern);
                                if (match && match[1]) {
                                    initialLocation = match[1].trim();
                                    console.log('Extracted location from AI message:', initialLocation);
                                    break;
                                }
                            }
                        }
                        
                        // If still no location, try to extract from user's message
                        if (!initialLocation && message) {
                            const locationPatterns = [
                                /(?:at|location:|address:)\s*([^.!?,]+)/i,
                                /(\d+\s+[A-Za-z\s]+(?:Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Lane|Ln|Boulevard|Blvd|Way|Place|Pl)[^.!?,]*)/i,
                                /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*,\s*[A-Z]{2,})/
                            ];
                            
                            for (const pattern of locationPatterns) {
                                const match = message.match(pattern);
                                if (match && match[1]) {
                                    initialLocation = match[1].trim();
                                    console.log('Extracted location from user message:', initialLocation);
                                    break;
                                }
                            }
                        }
                        
                        // Last resort: search conversation history for recent addresses
                        if (!initialLocation && state.conversationHistory && state.conversationHistory.length > 0) {
                            console.log('Searching conversation history for addresses...');
                            const addressPattern = /(\d+(?:\/\d+)?\s+[A-Za-z\s]+(?:Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Lane|Ln|Boulevard|Blvd|Way|Place|Pl)[^.!?,]*(?:,\s*[^.!?,]+)?)/i;
                            
                            // Search last 5 messages
                            for (let i = state.conversationHistory.length - 1; i >= Math.max(0, state.conversationHistory.length - 5); i--) {
                                const msg = state.conversationHistory[i];
                                if (msg.role === 'user' && msg.content) {
                                    const match = msg.content.match(addressPattern);
                                    if (match && match[1]) {
                                        initialLocation = match[1].trim();
                                        console.log('Found location in conversation history:', initialLocation);
                                        break;
                                    }
                                }
                            }
                        }
                        
                        console.log('Final initialLocation:', initialLocation);
                        addMapUI(initialLocation);
                    }

                    // Add suggestions (skip for map fields - use Confirm Location button instead)
                    if (data.nextSuggestedQuestions && data.nextSuggestedQuestions.length > 0 
                        && state.currentFieldType !== '10016') {
                        console.log('[CLEANUP] Adding suggestions');
                        addSuggestions(data.nextSuggestedQuestions);
                    }
                    addSkipChipIfOptional();

                    console.log('[CLEANUP] Field UI cleanup complete');
                }, 50); // 50ms delay to prevent race condition
            };

            setTimeout(() => {
                addSupplementaryPromptUI(
                    data.showPhotoFieldIds,
                    data.showCommentFieldIds,
                    data.showActionFieldIds,
                    data.showHazardInfo || null,
                    data.extractedFields,
                    data,
                    showNextQuestionAndFieldUI
                );
            }, 50);

            // Add to history
            state.conversationHistory.push({
                role: 'assistant',
                content: data.aiMessage
            });

            // Auto-save transcript to localStorage after every exchange
            saveTranscript();

            // Update extracted fields and track confirmed IDs so the server
            // knows which pre-filled defaults have now been explicitly answered.
            if (data.extractedFields && data.extractedFields.length > 0) {
                markFieldsConfirmed(data.extractedFields);
                data.extractedFields.forEach(field => {
                    state.extractedFieldsMap.set(field.fieldID, field);
                });
                showFieldsSummary(data.extractedFields);
                updateFieldsList();

                // Auto-refresh memory panel ~3s later (fire-and-forget runs server-side in background)
                scheduleMemoryRefresh();
            }

            // Handle edit field request — remove the field from confirmed set so it gets re-asked
            if (data.editFieldId) {
                state.chatConfirmedFieldIds = state.chatConfirmedFieldIds.filter(id => id !== data.editFieldId);
                state.extractedFieldsMap.delete(data.editFieldId);
                saveConfirmedFieldIds(state.regOthId, state.chatConfirmedFieldIds);
                updateFieldsList();
            }

            // Update progress
            if (data.completionPercentage !== undefined) {
                updateProgress(data.completionPercentage, data.totalFields, data.answeredFields);
                saveTranscript();
            }

            // End-of-form prompt (guarded): trigger from server flag, 100% progress, or AI completion wording.
            if (data.isComplete) state._serverMarkedComplete = true;
            setTimeout(() => { if (_shouldAutoPromptCompletion(data)) promptCompletion(); }, 600);

            updateDebugInfo();
        } else {
            if (!handleCompletedSessionRefusal(data.errorMessage)) {
                addMessage('assistant', ` ${data.errorMessage || 'Error'}`);
            }
        }
    } catch (error) {
        removeTypingIndicator();
        addMessage('assistant', ` Error: ${error.message}`);
    }
}

function _hasBlockingFieldUi() {
    const selector = '.dynamic-data-container, .file-upload-container, .photo-upload-container, .comment-input-container, .action-input-container, .map-container';
    const nodes = document.querySelectorAll(selector);
    return Array.from(nodes).some(el => {
        if (!el || !document.body.contains(el)) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        return el.offsetParent !== null;
    });
}

function _shouldAutoPromptCompletion(data) {
    if (state.sessionCompleted) return false;
    if (state._collectingHeaderDetails) return false;
    if ((Number(state.totalFieldCount || 0) === 0) && (Number(state.answeredFieldCount || 0) === 0)) return false;

    // Fire if the server explicitly says all fields are done (even if some were skipped)
    const aiSaysDone = typeof data?.aiMessage === 'string'
        && /(covered all the questions|you can now submit|ready to submit|reached the end of the form)/i.test(data.aiMessage);
    const serverDone = !!data?.isComplete || !!state._serverMarkedComplete || aiSaysDone;
    // Also fire if percentage hit 100 without an explicit isComplete flag
    const pctDone = Number(data?.completionPercentage ?? state.completionPercentage ?? 0) >= 100;
    if (!serverDone && !pctDone) return false;

    if (state.awaitingHeaderField || state._headerFieldCallback) return false;

    if (_hasBlockingFieldUi()) return false;

    return true;
}

function promptCompletion() {
    if (state.sessionCompleted) return;
    if (document.getElementById('completionPrompt')) return;
    const messagesArea = document.getElementById('messagesArea');

    const pct = Math.round(state.completionPercentage || 0);
    const answered = state.answeredFieldCount || 0;
    const total    = state.totalFieldCount || 0;
    const skipped  = total > 0 ? Math.max(0, total - answered) : 0;

    let bodyText;
    if (pct >= 100) {
        bodyText = `Great work — all fields have been answered! Ready to submit this ${state.templateName || 'record'}?`;
    } else if (skipped > 0) {
        bodyText = `Looks like we've reached the end of the form. ${answered} of ${total} fields answered${skipped > 0 ? ` (${skipped} skipped)` : ''}. You can fill in the skipped fields directly in the form later. Ready to submit now?`;
    } else {
        bodyText = `It looks like we've covered everything! Ready to submit this ${state.templateName || 'record'}?`;
    }

    const messageDiv = document.createElement('div');
    messageDiv.className = 'message assistant';
    messageDiv.id = 'completionPrompt';

    const icon = document.createElement('div');
    icon.className = 'message-icon';
    icon.innerHTML = '<i class="ph-thin ph-check-circle"></i>';

    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';

    const container = document.createElement('div');
    container.style.cssText = 'padding:16px;background:#fff;border-radius:8px;border:1px solid #e5e7eb;max-width:520px;box-sizing:border-box;margin-top:10px;';
    container.innerHTML = `
        <div style="margin-bottom:12px;font-size:14px;color:#374151;">${escapeHtml(bodyText)}</div>
        ${total > 0 ? `<div style="margin-bottom:14px;">
            <div style="display:flex;justify-content:space-between;font-size:12px;color:#6b7280;margin-bottom:4px;">
                <span>${answered} / ${total} fields answered</span><span>${pct}%</span>
            </div>
            <div style="background:#e5e7eb;border-radius:4px;height:6px;overflow:hidden;">
                <div style="background:#3B98F1;height:100%;width:${pct}%;border-radius:4px;transition:width .3s;"></div>
            </div>
            ${skipped > 0 ? `<div style="margin-top:6px;font-size:12px;color:#fd7e14;">${skipped} field${skipped > 1 ? 's' : ''} were skipped — you can complete them in the form.</div>` : ''}
        </div>` : ''}
        <div style="display:flex;gap:8px;">
            <button class="cmp-yes" style="padding:8px 18px;background:#3B98F1;color:white;border:none;border-radius:6px;cursor:pointer;font-weight:500;font-size:14px;">Submit now</button>
            <button class="cmp-no" style="padding:8px 14px;background:#6b7280;color:white;border:none;border-radius:6px;cursor:pointer;font-size:13px;">Not yet</button>
        </div>`;

    contentDiv.innerHTML = '';
    contentDiv.appendChild(container);
    messageDiv.appendChild(icon);
    messageDiv.appendChild(contentDiv);
    messagesArea.appendChild(messageDiv);
    scrollToBottom();

    container.querySelector('.cmp-yes').onclick = () => { messageDiv.remove(); completeSession(); };
    container.querySelector('.cmp-no').onclick  = () => messageDiv.remove();

    if (state.voiceMode) speakText(bodyText);
}

function isAwaitingCompletion() {
    if (state.sessionCompleted) return false;
    if (state._collectingHeaderDetails) return false;
    if ((Number(state.totalFieldCount || 0) === 0) && (Number(state.answeredFieldCount || 0) === 0)) return false;
    const pct = Number(state.completionPercentage || 0);
    if (pct < 100 && !state._serverMarkedComplete) return false;
    if (state.awaitingHeaderField || state._headerFieldCallback) return false;

    return !_hasBlockingFieldUi();
}

function isCompletedSessionMutationError(errorMessage) {
    const msg = String(errorMessage || '').toLowerCase();
    return msg.includes('cannot modify completed session')
        || msg.includes('session is completed')
        || msg.includes('already completed');
}

function handleCompletedSessionRefusal(errorMessage) {
    if (!isCompletedSessionMutationError(errorMessage)) return false;

    state.sessionCompleted = true;
    if (Number(state.completionPercentage || 0) < 100) {
        updateProgress(100, state.totalFieldCount, state.totalFieldCount || state.answeredFieldCount || 0);
    }

    setChatInputState(true, 'Session completed.');

    const completeBtn = document.getElementById('completeBtnPanel');
    if (completeBtn) {
        completeBtn.disabled = true;
        completeBtn.textContent = 'Session Completed';
    }

    if (!document.getElementById('completedSessionNotice')) {
        const messagesArea = document.getElementById('messagesArea');
        if (messagesArea) {
            const messageDiv = document.createElement('div');
            messageDiv.className = 'message assistant';
            messageDiv.id = 'completedSessionNotice';

            const icon = document.createElement('div');
            icon.className = 'message-icon';
            icon.innerHTML = '<i class="ph-thin ph-lock-simple"></i>';

            const contentDiv = document.createElement('div');
            contentDiv.className = 'message-content';
            contentDiv.textContent = 'This session is already completed, so chat is now read-only. You can continue in the form page if needed.';

            messageDiv.appendChild(icon);
            messageDiv.appendChild(contentDiv);
            messagesArea.appendChild(messageDiv);
            scrollToBottom();
        }
    }

    saveTranscript();
    _markSessionCompleteLocally(state.regOthId);
    return true;
}

// Strip font-size from inline styles so pasted content doesn't carry over font sizing
function stripFontSizes(html) {
    return html
        .replace(/font-size\s*:[^;"'}]+[;]?/gi, '')
        .replace(/(<[^>]+)\bsize\s*=\s*["'][^"']*["']/gi, '$1');
}

// Check if content is map JSON data
function isMapJSON(content) {
    if (!content || typeof content !== 'string') return false;
    try {
        const data = JSON.parse(content);
        return data && 
               typeof data.Latitude === 'number' && 
               typeof data.Longitude === 'number' && 
               typeof data.Location === 'string';
    } catch (e) {
        return false;
    }
}

// Format map JSON data as plain text
function formatMapJSON(jsonString) {
    try {
        const data = JSON.parse(jsonString);
        return escapeHtml(data.Location);
    } catch (e) {
        // Fallback to plain text if parsing fails
        return escapeHtml(jsonString);
    }
}

// Helper to escape HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function addMessage(role, content) {
    // Track every displayed message for save/restore (skip during replay)
    if (!state._replayMode) {
        state.displayMessages.push({ role, content });
    }

    const messagesArea = document.getElementById('messagesArea');

    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${role}`;

    const icon = document.createElement('div');
    icon.className = 'message-icon';
    if (role === 'user') {
        icon.textContent = CONFIG.userName.charAt(0).toUpperCase();
    } else {
        icon.innerHTML = '<i class="ph-thin ph-chats-circle"></i>';
    }

    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    if (role === 'user' && state._pendingUserHtml) {
        contentDiv.innerHTML = stripFontSizes(state._pendingUserHtml);
        state._pendingUserHtml = null;
    } else if (role === 'user' && isMapJSON(content)) {
        // Special formatting for map JSON data from user
        contentDiv.innerHTML = formatMapJSON(content);
    } else if (role === 'assistant' && typeof content === 'string' && /<(div|input|button|textarea)\b/i.test(content)) {
        contentDiv.innerHTML = content;
    } else if (role === 'assistant' && typeof marked !== 'undefined') {
        contentDiv.innerHTML = marked.parse(content);
    } else {
        contentDiv.textContent = content;
    }

    messageDiv.appendChild(icon);
    messageDiv.appendChild(contentDiv);

    messagesArea.appendChild(messageDiv);
    scrollToBottom();

    // If voice mode is active and this is an AI message, speak it
    if (state.voiceMode && role === 'assistant' && !state._replayMode) {
        state.lastAiMessage = content;
        speakText(content);
    }
}

function addAIMessage(content) {
    addMessage('assistant', content);
}

async function autoSelectTemplate(message, templates) {
    try {
        // Handle both camelCase (templateID) and PascalCase (TemplateID) from API
        const getId = t => t.templateID ?? t.TemplateID;
        const getName = t => t.templateName ?? t.TemplateName ?? '';
        const getDesc = t => t.templateDescription ?? t.TemplateDescription ?? '';
        const templateList = templates.map(t =>
            `- ID ${getId(t)}: ${getName(t)}${getDesc(t) ? ' — ' + getDesc(t) : ''}`
        ).join('\n');
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${CONFIG.openaiApiKey}` },
            signal: AbortSignal.timeout(5000),
            body: JSON.stringify({
                model: 'gpt-4o-mini',
                max_tokens: 10,
                messages: [
                    {
                        role: 'system',
                        content: 'You are a form template matcher. Given a user message and a list of templates, reply with ONLY the numeric templateID of the single best match. If you cannot confidently decide, reply with 0.'
                    },
                    {
                        role: 'user',
                        content: `User message:\n"${message}"\n\nAvailable templates:\n${templateList}\n\nReply with the templateID number only.`
                    }
                ]
            })
        });
        const data = await response.json();
        trackCost('gpt-4o-mini', data.usage);
        const raw = (data.choices?.[0]?.message?.content || '').trim();
        const parsed = parseInt(raw, 10);
        if (!isNaN(parsed) && parsed > 0) {
            const match = templates.find(t => getId(t) === parsed);
            if (match) {
                console.log(`[autoSelectTemplate] Auto-selected: ${getName(match)} (ID ${parsed})`);
                return parsed;
            }
        }
    } catch (e) {
        console.warn('[autoSelectTemplate] Failed:', e);
    }
    return null;
}

// Returns a Bootstrap column class based on item count and max text length.
// 1 item or very long text → lg-12; 2 items or medium text → lg-6; otherwise → lg-4
/** Builds a Material-style floating-label searchable dropdown */
function _makeFloatingSelect(labelText, placeholderText, options, onChange) {
    const wrap = document.createElement('div');
    wrap.className = 'chat-floating-select-wrap';

    const label = document.createElement('span');
    label.className = 'chat-floating-label';
    label.textContent = labelText;

    const inputWrap = document.createElement('div');
    inputWrap.style.cssText = 'position:relative;';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'chat-floating-input';
    input.placeholder = placeholderText;
    input.autocomplete = 'off';

    const dd = document.createElement('div');
    dd.className = 'chat-floating-dd';
    dd.style.display = 'none';

    let selectedValue = null;

    const renderList = (filter) => {
        const q = (filter || '').toLowerCase();
        const matches = q ? options.filter(o => o.text.toLowerCase().includes(q)) : options;
        if (!matches.length) {
            dd.innerHTML = '<div class="chat-floating-dd-empty">No results</div>';
        } else {
            dd.innerHTML = matches.map((o, i) =>
                `<div class="chat-floating-dd-item" data-idx="${i}" data-value="${escapeHtml(String(o.value))}">${escapeHtml(o.text)}</div>`
            ).join('');
            dd.querySelectorAll('.chat-floating-dd-item').forEach(el => {
                el.addEventListener('mousedown', e => {
                    e.preventDefault();
                    const opt = matches[parseInt(el.dataset.idx)];
                    input.value = opt.text;
                    selectedValue = opt.value;
                    dd.style.display = 'none';
                    input.blur();
                    onChange(opt.value, opt.text);
                });
            });
        }
        dd.style.display = 'block';
    };

    input.addEventListener('focus', () => renderList(input.value));
    input.addEventListener('input',  () => { selectedValue = null; renderList(input.value); });
    input.addEventListener('blur',   () => setTimeout(() => { dd.style.display = 'none'; }, 150));

    inputWrap.appendChild(input);
    inputWrap.appendChild(dd);
    wrap.appendChild(label);
    wrap.appendChild(inputWrap);
    return wrap;
}

function getSuggestionColClass(texts) {
    const count = texts.length;
    const maxLen = Math.max(...texts.map(t => (t || '').trim().length));
    if (count === 1 || maxLen > 28) return 'col-12 col-sm-12 col-md-12 col-lg-12';
    if (count === 2 || maxLen > 20) return 'col-12 col-sm-12 col-md-6 col-lg-6';
    return 'col-12 col-sm-12 col-md-4 col-lg-4';
}

function addTemplateList(templates, additionalTemplates) {
    // Store templates for voice recognition
    state.availableTemplates = templates;

    const messagesArea = document.getElementById('messagesArea');
    const lastMessage = messagesArea.lastElementChild;
    const allTemplates = [...templates, ...(additionalTemplates || [])];

    const wrapper = document.createElement('div');
    wrapper.className = 'suggestions';

    if (allTemplates.length > 3) {
        // Floating-label dropdown mode — all templates in one select
        state.availableTemplates = allTemplates;
        const floatingSelect = _makeFloatingSelect(
            'Template',
            'Select a template…',
            allTemplates.map(t => ({ value: String(t.templateID), text: t.templateName })),
            (value) => {
                const chosen = allTemplates.find(t => String(t.templateID) === value);
                if (chosen) selectTemplate(chosen.templateID, chosen.templateName, chosen.estimatedFields || 0, chosen);
            }
        );
        wrapper.appendChild(floatingSelect);
    } else {
        // Button mode — ≤ 3 templates
        wrapper.classList.add('row', 'g-2');
        const allTemplateNames = allTemplates.map(t => t.templateName);
        const colClass = getSuggestionColClass(allTemplateNames);

        templates.forEach((template) => {
            const col = document.createElement('div');
            col.className = colClass;
            const pill = document.createElement('button');
            pill.className = 'btn btn-primary w-100';
            pill.textContent = template.templateName;
            pill.onclick = () => selectTemplate(template.templateID, template.templateName, template.estimatedFields || 0, template);
            col.appendChild(pill);
            wrapper.appendChild(col);
        });

        if (additionalTemplates && additionalTemplates.length > 0) {
            const loadMoreCol = document.createElement('div');
            loadMoreCol.className = colClass;
            const loadMoreBtn = document.createElement('button');
            loadMoreBtn.className = 'btn btn-outline-primary w-100';
            loadMoreBtn.textContent = `Load more (${additionalTemplates.length})…`;
            loadMoreBtn.onclick = () => {
                loadMoreCol.remove();
                additionalTemplates.forEach((template) => {
                    const col = document.createElement('div');
                    col.className = colClass;
                    const pill = document.createElement('button');
                    pill.className = 'btn btn-primary w-100';
                    pill.textContent = template.templateName;
                    pill.onclick = () => selectTemplate(template.templateID, template.templateName, template.estimatedFields || 0, template);
                    col.appendChild(pill);
                    wrapper.appendChild(col);
                });
                state.availableTemplates = [...state.availableTemplates, ...additionalTemplates];
                state.additionalTemplateChoices = [];
                scrollToBottom();
            };
            loadMoreCol.appendChild(loadMoreBtn);
            wrapper.appendChild(loadMoreCol);
        }
    }

    lastMessage.querySelector('.message-content').appendChild(wrapper);
    scrollToBottom();
}

async function selectTemplate(templateID, displayText, estimatedFields = 0, templateMeta = null) {
    // Remove all suggestion pills
    document.querySelectorAll('.suggestions').forEach(el => el.remove());

    // Capture total field count for the selected template
    if (estimatedFields > 0) state.totalFieldCount = estimatedFields;

    // Ensure RegTypeID/TemplateTypeID are available before header-detail APIs run
    if (templateMeta) {
        const selectedRegTypeId = Number(templateMeta.moduleID || templateMeta.ModuleID || 0);
        if (selectedRegTypeId > 0) state.regTypeId = selectedRegTypeId;

        const selectedTemplateTypeId = Number(templateMeta.templateTypeID || templateMeta.TemplateTypeID || 0);
        if (selectedTemplateTypeId > 0) {
            state.templateTypeId = selectedTemplateTypeId;
            state.pageId = TEMPLATE_TYPE_PAGE_MAP[selectedTemplateTypeId] || state.pageId;
        }
    }

    // Add user's selection
    addMessage('user', displayText);

    // Call intelligent start with selected template
    await startIntelligentSession(state.initialMessage, templateID);
}

/**
 * Called when the user confirms / provides a name for the chat session.
 * Clears the naming UI, saves the name, then continues into SmartFill or field-by-field.
 */
async function handleChatNameResponse(name, silent = false) {
    document.querySelectorAll('.suggestions').forEach(el => el.remove());

    const data = state._pendingSessionData || {};
    state._pendingSessionData = null;

    const finalName = (name && name.trim()) ? name.trim() : (state.templateName || 'Untitled Session');
    state.chatName = finalName;
    state.awaitingChatName = false;
    state._chatCreatedAt = new Date().toISOString();

    if (!silent) {
        addMessage('user', name || finalName);
    }

    // Update topbar title
    setTopbarTitle(finalName);

    if (data.totalFields !== undefined && data.totalFields !== null) state.totalFieldCount = data.totalFields;
    if (data.answeredFields !== undefined && data.answeredFields !== null) state.answeredFieldCount = data.answeredFields;
    if (data.completionPercentage !== undefined) state.completionPercentage = data.completionPercentage;

    // Create transcript index entry immediately so the sidebar shows it
    saveTranscript();

    // Show the progress widget immediately using the server's smart counts
    if (data.completionPercentage !== undefined) {
        updateProgress(data.completionPercentage, data.totalFields, data.answeredFields);
    } else {
        updateInlineChatProgress(0);
    }

    // ── Persist the user-chosen title to the server (fire-and-forget) ─────────
    if (state.regOthId) {
        fetch(`${CONFIG.apiUrl}/update-title`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                regOthID: state.regOthId,
                storeID: CONFIG.storeId,
                title: finalName,
                updatedByID: CONFIG.userId
            })
        }).catch(err => console.warn('Failed to update session title:', err));
    }

    // ── Collect header record details first (if PageId known for this template type) ──────────
    const proceedWithQuestions = () => {

        // ── Smart Fill mode ──────────────────────────────────────────────────────
        if (isSmartFillEnabled()) {
            state.smartFillTriggered = true;
            showSmartFillTyping();
            setTimeout(() => runSmartFill(), 800);
            updateDebugInfo();
            return;
        }

        // ── Field-by-field mode ──────────────────────────────────────────────────

        // Helper: show the AI message + cleanup + next field UI
        const showNextQuestionAndFieldUI = () => {
        addMessage('assistant', data.aiMessage);

        setTimeout(() => {
            const existingFileUpload = document.querySelector('.file-upload-container');
            const existingMapContainer = document.querySelector('.map-container');
            const existingDynamicData = document.querySelector('.dynamic-data-container');

            if (state.currentFieldType !== '10013' && existingFileUpload) existingFileUpload.remove();
            if (state.currentFieldType !== '10016' && existingMapContainer) existingMapContainer.remove();
            if (state.currentFieldType !== '10020' && state.currentFieldType !== '10037' && existingDynamicData) existingDynamicData.remove();

            if (state.currentFieldType === '10013') {
                addFileUploadUI();
            } else if ((state.currentFieldType === '10020' || state.currentFieldType === '10026' || state.currentFieldType === '10037') && state.currentFieldDynamicFilter) {
                addDynamicDataUI(state.currentFieldType, state.currentFieldDynamicFilter);
            } else if (state.currentFieldType === '10016') {
                let initialLocation = null;
                if (data.extractedFields && data.extractedFields.length > 0) {
                    const mapField = data.extractedFields.find(f => f.fieldID === state.currentFieldID);
                    if (mapField && mapField.extractedValue) {
                        try {
                            const mapData = JSON.parse(mapField.extractedValue);
                            initialLocation = mapData.Location || null;
                        } catch (e) {
                            initialLocation = mapField.extractedValue;
                        }
                    }
                }
                if (!initialLocation && state.initialMessage) {
                    const locationPatterns = [
                        /(?:at|location:|address:)\s*([^.!?,]+)/i,
                        /(\d+\s+[A-Za-z\s]+(?:Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Lane|Ln|Boulevard|Blvd|Way|Place|Pl)[^.!?,]*)/i,
                        /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*,\s*[A-Z]{2,})/
                    ];
                    for (const pattern of locationPatterns) {
                        const match = state.initialMessage.match(pattern);
                        if (match && match[1]) { initialLocation = match[1].trim(); break; }
                    }
                }
                addMapUI(initialLocation);
            }

            if (data.nextSuggestedQuestions && data.nextSuggestedQuestions.length > 0
                && state.currentFieldType !== '10016') {
                addSuggestions(data.nextSuggestedQuestions);
            }
            addSkipChipIfOptional();
        }, 50);

        if (data.completionPercentage !== undefined) {
            updateProgress(data.completionPercentage, data.totalFields, data.answeredFields);
        }

        updateDebugInfo();
    };

    setTimeout(() => {
        addSupplementaryPromptUI(
            data.showPhotoFieldIds,
            data.showCommentFieldIds,
            data.showActionFieldIds,
            data.showHazardInfo || null,
            data.extractedFields,
            data,
            showNextQuestionAndFieldUI
        );
    }, 50);
    }; // end proceedWithQuestions

    const headerPageId = state.pageId || getCurrentPageId();
    if (headerPageId) {
        state.pageId = headerPageId;
        collectHeaderDetails(() => {
            if (!state._headerDetailsReadyForChecklist) return;
            if (state._collectingHeaderDetails || state.awaitingHeaderField) return;
            proceedWithQuestions();
        });
    } else {
        state._headerDetailsReadyForChecklist = true;
        proceedWithQuestions();
    }
}

const SKIP_CHIP_STYLE = ''; // kept for compat — classes applied via _skipChipButtonHtml

function _skipChipButtonHtml({ id = '', className = '', label = 'Skip (optional)', extraStyle = '', extraAttrs = '' } = {}) {
    const idAttr    = id        ? `id="${id}"`         : '';
    const extraCls  = className ? ` ${className}`       : '';
    // extraStyle ignored — Bootstrap handles it; extraAttrs still forwarded (e.g. onclick)
    return `<button ${idAttr} class="btn btn-outline-primary btn-sm${extraCls}" ${extraAttrs || ''}>${escapeHtml(label)}</button>`;
}

/**
 * Appends a "Skip (optional)" chip to the last assistant message when the
 * current checklist field is not required. Clicking it sends "skip this question"
 * through the normal chat pipeline so the server records __skipped__.
 */
function addSkipChipIfOptional() {
    if (state.currentFieldRequired !== false) return;
    const messagesArea = document.getElementById('messagesArea');
    const lastMessage  = messagesArea?.lastElementChild;
    if (!lastMessage) return;
    const content = lastMessage.querySelector('.message-content');
    if (!content) return;

    const chipDiv = document.createElement('div');
    chipDiv.className = 'checklist-skip-chip';
    chipDiv.style.cssText = 'margin-top:6px;';
    chipDiv.innerHTML = _skipChipButtonHtml({ className: 'checklist-skip-btn', label: 'Skip (optional)' });
    chipDiv.querySelector('button').onclick = () => _sendSkipMessage('Skip');
    content.appendChild(chipDiv);
    scrollToBottom();
}

async function _sendSkipMessage(displayText = 'Skip') {
    if (state._collectingHeaderDetails) {
        addMessage('assistant', 'Skip is unavailable while details are being completed. Please answer the current details question.');
        scrollToBottom();
        return;
    }

    if (!state.sessionStarted || !state.regOthId) return;
    document.querySelectorAll('.suggestions, .checklist-skip-chip').forEach(el => el.remove());
    await sendChatMessage('skip this question', displayText);
}

function addSuggestions(suggestions) {
    if (!suggestions || suggestions.length === 0) return;

    state.lastSuggestedQuestions = [...suggestions];
    state.lastSuggestionFieldId = state.currentFieldID;

    const messagesArea = document.getElementById('messagesArea');
    const lastMessage = messagesArea.lastElementChild;

    const wrapper = document.createElement('div');
    wrapper.className = 'suggestions';

    if (suggestions.length > 3) {
        // Floating-label dropdown mode
        const floatingSelect = _makeFloatingSelect(
            'Options',
            'Select an option…',
            suggestions.map(s => ({ value: s, text: s.replace(/[\[\]]/g, '') })),
            (value) => selectSuggestion(value)
        );
        wrapper.appendChild(floatingSelect);
    } else {
        // Button mode
        wrapper.classList.add('row', 'g-2');
        const colClass = getSuggestionColClass(suggestions.map(s => s.replace(/[\[\]]/g, '')));
        suggestions.forEach(suggestion => {
            const col = document.createElement('div');
            col.className = colClass;
            const pill = document.createElement('button');
            pill.className = 'btn btn-primary w-100';
            pill.textContent = suggestion.replace(/[\[\]]/g, '');
            pill.onclick = () => selectSuggestion(suggestion);
            col.appendChild(pill);
            wrapper.appendChild(col);
        });
    }

    lastMessage.querySelector('.message-content').appendChild(wrapper);
    scrollToBottom();
}

function selectSuggestion(suggestion) {
    // Remove all suggestions
    document.querySelectorAll('.suggestions').forEach(el => el.remove());

    // Special handling for map confirmation
    // If user clicks "Yes" for a map field, check if map is still visible and has data
    const cleanSuggestion = suggestion.replace(/[\[\]]/g, '').toLowerCase();
    if (state.currentFieldType === '10016' && 
        (cleanSuggestion === 'yes' || cleanSuggestion === 'confirm')) {
        
        // Map fields must always be confirmed via the "Confirm Location" button.
        // Only send stored map data if the user already explicitly clicked "Confirm Location".
        if (state.lastMapData) {
            console.log('User confirmed map location with "Yes", sending stored map data:', state.lastMapData);
            getActiveInput().value = state.lastMapData;
            sendMessage();
            state.lastMapData = null;
            return;
        }
        // Map not yet confirmed — fall through to send as normal text message
    }

    // Send as user message via the currently active input
    getActiveInput().value = suggestion;
    sendMessage();
}

// ── Dynamic Dataset Dropdown / Multi-select UI (10020 / 10037) ────────────
function addDynamicDataUI(fieldType, dynamicFilterJson) {
    const messagesArea = document.getElementById('messagesArea');
    const lastMessage = messagesArea.lastElementChild;
    if (!lastMessage) return;

    // Remove any existing dynamic data container
    const existing = document.querySelector('.dynamic-data-container');
    if (existing) existing.remove();

    // Parse the filter config
    let filterConfig;
    try {
        filterConfig = typeof dynamicFilterJson === 'string' ? JSON.parse(dynamicFilterJson) : dynamicFilterJson;
    } catch (e) {
        console.warn('[DynamicData] Failed to parse DynamicFilterCondn:', e);
        return;
    }
    if (!filterConfig || !filterConfig.fieldData) {
        console.warn('[DynamicData] Invalid filter config — missing fieldData');
        return;
    }

    const isMulti = fieldType === '10037';
    const currentFieldId = Number(state.currentFieldID || 0);
    const container = document.createElement('div');
    container.className = 'dynamic-data-container';
    container.style.cssText = 'margin-top: 12px; padding: 16px; background: #f8f9fa; border-radius: 8px; border: 1px solid #e5e7eb;';

    // Build the ASMX URL — derive base from CONFIG.apiUrl
    // CONFIG.apiUrl = https://beta.whsmonitor.com.au/affinda/api/chat-template
    // ASMX lives at  https://beta.whsmonitor.com.au/NetServices/POSTBusinessPlan.asmx/spGetDynamicDataV2
    const baseUrl = CONFIG.apiUrl.replace(/\/affinda\/api\/chat-template$/i, '');
    const asmxUrl = baseUrl + '/NetServices/POSTBusinessPlan.asmx/spGetDynamicDataV2';

    // Identify primary key field
    const primaryField = filterConfig.primaryDetails
        || filterConfig.fieldData.find(f => f.isPrimaryKey);

    container.innerHTML = `
        <div class="chat-floating-select-wrap" style="margin-top:0;">
            <span class="chat-floating-label">${isMulti ? 'Select options' : 'Select an option'}</span>
            <div style="position:relative;">
                <input type="text" id="dynamicDataSearch" class="chat-floating-input" autocomplete="off"
                       placeholder="Type to search...">
                <div id="dynamicDataDropdown" class="chat-floating-dd" style="display:none;"></div>
            </div>
        </div>
        ${isMulti ? '<div id="dynamicDataChips" style="margin-top: 8px; display: flex; flex-wrap: wrap; gap: 6px;"></div>' : ''}
        <div style="margin-top: 10px; display: flex; gap: 8px;">
            ${isMulti ? `<button id="dynamicDataSubmit" class="btn btn-primary btn-sm">Confirm Selection</button>` : ''}
            ${_skipChipButtonHtml({ id: 'dynamicDataSkip', label: 'Skip (optional)' })}
        </div>
    `;

    lastMessage.querySelector('.message-content').appendChild(container);
    scrollToBottom();

    // State for selections
    const selectedItems = []; // { id, text }
    let debounceTimer = null;
    let lastFetchedItems = []; // cached items from last fetch — indexed by data-idx

    const searchInput = document.getElementById('dynamicDataSearch');
    const dropdown = document.getElementById('dynamicDataDropdown');
    const chipsContainer = document.getElementById('dynamicDataChips');
    const submitBtn = document.getElementById('dynamicDataSubmit');
    const skipBtn = document.getElementById('dynamicDataSkip');

    // ── Fetch data from ASMX ─────────────────────────────────────────────
    async function fetchOptions(searchText) {
        try {
            const requestBody = {
                dynamicFilters: filterConfig,
                search: searchText || '',
                value: JSON.stringify(selectedItems.map(s => s.id)),
                type: '',
                RegOthHazardTempalteID: currentFieldId
            };

            const resp = await fetch(asmxUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody)
            });
            const json = await resp.json();
            let rawData = json.d || json;
            if (typeof rawData === 'string') {
                try {
                    rawData = JSON.parse(rawData);
                } catch {
                    rawData = [];
                }
            }

            // Transform using same logic as $.makeSelectData
            const items = [];
            if (Array.isArray(rawData)) {
                rawData.forEach(row => {
                    let id = null;
                    let textParts = [];
                    filterConfig.fieldData.forEach(fd => {
                        const val = row[fd.fieldName];
                        if (fd.isPrimaryKey || (primaryField && fd.fieldName === primaryField.fieldName)) {
                            id = val;
                        } else if (fd.display !== 'hide') {
                            textParts.push(val != null ? String(val) : '');
                        }
                    });
                    if (id != null) {
                        items.push({ id: id, text: textParts.join(' ').trim() });
                    }
                });
            }
            lastFetchedItems = items;
            return items;
        } catch (err) {
            console.warn('[DynamicData] ASMX fetch error:', err);
            lastFetchedItems = [];
            return [];
        }
    }

    // ── Build a unique key for a selection (id + text) ───────────────────
    function itemKey(item) { return String(item.id) + '|||' + String(item.text); }

    // ── Render dropdown items ────────────────────────────────────────────
    function renderDropdown(items) {
        if (!items || items.length === 0) {
            dropdown.innerHTML = '<div class="chat-floating-dd-empty">No results found</div>';
            dropdown.style.display = 'block';
            return;
        }
        const selectedKeys = new Set(selectedItems.map(s => itemKey(s)));
        dropdown.innerHTML = items.map((item, idx) => {
            const isSelected = selectedKeys.has(itemKey(item));
            return `<div class="chat-floating-dd-item${isSelected ? ' dd-item-selected' : ''} dynamic-option" data-idx="${idx}">${item.text}</div>`;
        }).join('');
        dropdown.style.display = 'block';
    }

    // ── Render chips (multi-select) ──────────────────────────────────────
    function renderChips() {
        if (!chipsContainer) return;
        chipsContainer.innerHTML = selectedItems.map((item, idx) =>
            `<span style="display:inline-flex; align-items:center; gap:4px; padding:4px 10px; background:#3B98F1; color:white; border-radius:16px; font-size:13px;">
                ${item.text}
                <span data-remove-idx="${idx}" style="cursor:pointer; font-weight:bold; margin-left:2px;" title="Remove">&times;</span>
            </span>`
        ).join('');

        // Bind remove clicks
        chipsContainer.querySelectorAll('[data-remove-idx]').forEach(el => {
            el.addEventListener('click', () => {
                const idx = parseInt(el.getAttribute('data-remove-idx'));
                selectedItems.splice(idx, 1);
                renderChips();
            });
        });
    }

    // ── Event: search input ──────────────────────────────────────────────
    searchInput.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(async () => {
            const text = searchInput.value.trim();
            if (text.length < 1) { dropdown.style.display = 'none'; return; }
            dropdown.innerHTML = '<div class="chat-floating-dd-empty">Searching...</div>';
            dropdown.style.display = 'block';
            const items = await fetchOptions(text);
            renderDropdown(items);
        }, 300);
    });

    // Show dropdown on focus with empty search (load initial data)
    searchInput.addEventListener('focus', async () => {
        if (dropdown.children.length === 0 || dropdown.style.display === 'none') {
            dropdown.innerHTML = '<div class="chat-floating-dd-empty">Loading...</div>';
            dropdown.style.display = 'block';
            const items = await fetchOptions('');
            renderDropdown(items);
        }
    });

    // ── Event: option click ──────────────────────────────────────────────
    dropdown.addEventListener('click', (e) => {
        e.stopPropagation(); // Prevent outside-click listener from closing the dropdown
        const option = e.target.closest('.dynamic-option');
        if (!option) return;

        const idx = parseInt(option.getAttribute('data-idx'));
        const item = lastFetchedItems[idx];
        if (!item) return;

        if (isMulti) {
            // Toggle selection using composite key (id + text) for uniqueness
            const key = itemKey(item);
            const existingIdx = selectedItems.findIndex(s => itemKey(s) === key);
            if (existingIdx >= 0) {
                selectedItems.splice(existingIdx, 1);
            } else {
                selectedItems.push({ id: item.id, text: item.text });
            }
            renderChips();
            // Re-render dropdown in-place to show check marks (no new fetch)
            renderDropdown(lastFetchedItems);
            searchInput.focus();
        } else {
            // Single select — submit immediately
            dropdown.style.display = 'none';
            const jsonAnswer = JSON.stringify({ Value: String(item.id), Text: item.text });
            container.remove();
            sendChatMessage(jsonAnswer, item.text);
        }
    });

    // ── Event: submit button (multi-select) ──────────────────────────────
    if (submitBtn) {
        submitBtn.addEventListener('click', () => {
            if (selectedItems.length === 0) {
                alert('Please select at least one option.');
                return;
            }
            const ids = selectedItems.map(s => s.id);
            const texts = selectedItems.map(s => s.text);
            const jsonAnswer = JSON.stringify({ Value: ids, Text: texts });
            const displayText = texts.join(', ');
            container.remove();
            sendChatMessage(jsonAnswer, displayText);
        });
    }

    // ── Event: skip button ───────────────────────────────────────────────
    skipBtn.addEventListener('click', () => {
        container.remove();
        _sendSkipMessage('Skip');
    });

    // ── Close dropdown on outside click ──────────────────────────────────
    document.addEventListener('click', function closeDynDrop(e) {
        if (!container.contains(e.target)) {
            dropdown.style.display = 'none';
        }
        // Clean up listener when container is removed
        if (!document.body.contains(container)) {
            document.removeEventListener('click', closeDynDrop);
        }
    });

    scrollToBottom();
}

function addFileUploadUI() {
    const messagesArea = document.getElementById('messagesArea');
    const lastMessage = messagesArea.lastElementChild;
    
    const fileUploadDiv = document.createElement('div');
    fileUploadDiv.className = 'file-upload-container';
    fileUploadDiv.style.cssText = 'margin-top: 12px; padding: 16px; background: #f8f9fa; border-radius: 8px; border: 2px dashed #e5e7eb;';
    
    fileUploadDiv.innerHTML = `
        <div style="display: flex; align-items: center; gap: 12px;">
            <input type="file" id="fileUploadInput" style="flex: 1; padding: 8px; border: 1px solid #e5e7eb; border-radius: 4px; background: white;">
            <button id="fileUploadButton" onclick="handleFileUpload()" style="padding: 8px 16px; background: #3B98F1; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: 500;">
                Upload
            </button>
        </div>
        <div id="fileUploadProgress" style="margin-top: 8px; display: none; color: #6b7280; font-size: 13px;"></div>
    `;
    
    lastMessage.querySelector('.message-content').appendChild(fileUploadDiv);
    scrollToBottom();
}

async function handleFileUpload() {
    const fileInput = document.getElementById('fileUploadInput');
    const progress = document.getElementById('fileUploadProgress');
    const uploadButton = document.getElementById('fileUploadButton');
    
    if (!fileInput.files || fileInput.files.length === 0) {
        alert('Please select a file first');
        return;
    }
    
    const file = fileInput.files[0];
    const formData = new FormData();
    formData.append('file', file);
    formData.append('regOthID', state.regOthId);
    formData.append('storeID', CONFIG.storeId);
    
    try {
        uploadButton.disabled = true;
        uploadButton.style.opacity = '0.6';
        uploadButton.style.cursor = 'not-allowed';
        progress.style.display = 'block';
        progress.textContent = 'Uploading...';
        
        const response = await fetch(`${CONFIG.apiUrl}/upload`, {
            method: 'POST',
            body: formData
        });
        
        const data = await response.json();
        
        if (data.success) {
            progress.textContent = `Uploaded: ${file.name}`;
            progress.style.color = '#198754';
            
            // Remove file upload UI
            const fileUploadContainer = document.querySelector('.file-upload-container');
            if (fileUploadContainer) {
                fileUploadContainer.remove();
            }
            
            // Auto-submit the file path as the answer (show friendly filename in chat, send path to API)
            await sendChatMessage(data.filePath, file.name);
        } else {
            progress.textContent = ` Upload failed: ${data.errorMessage || 'Unknown error'}`;
            progress.style.color = '#dc3545';
            uploadButton.disabled = false;
            uploadButton.style.opacity = '1';
            uploadButton.style.cursor = 'pointer';
        }
    } catch (error) {
        progress.textContent = ` Error: ${error.message}`;
        progress.style.color = '#dc3545';
        uploadButton.disabled = false;
        uploadButton.style.opacity = '1';
        uploadButton.style.cursor = 'pointer';
    }
}

// ── ShowPhoto prompt ─────────────────────────────────────────────────────────

/**
 * Shared accordion helper for Photo / Comment / Action prompts.
 * Renders a grey card with one row per field. Each row has an "Add" button that
 * expands the form inline, and a "Skip" link. Calls onComplete() when all rows
 * are resolved.
 *
 * @param {object[]} fields        - [{ id, name }]
 * @param {string}   iconClass     - Phosphor icon class e.g. 'ph-thin ph-camera'
 * @param {string}   heading       - Card heading text
 * @param {string}   addLabel      - Label for the expand button e.g. 'Add Photo'
 * @param {function} buildFormFn   - (fieldId, rowBodyEl, onRowDone) → void
 * @param {function} onComplete    - called when every row is resolved
 */
function _buildFieldAccordionCard(fields, iconClass, heading, addLabel, buildFormFn, onComplete) {
    if (!fields || !fields.length) { if (onComplete) onComplete(); return; }

    const messagesArea = document.getElementById('messagesArea');
    const msgDiv = document.createElement('div');
    msgDiv.className = 'message assistant';

    const iconEl = document.createElement('div');
    iconEl.className = 'message-icon';
    iconEl.innerHTML = `<i class="${iconClass}"></i>`;

    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';

    const card = document.createElement('div');
    card.style.cssText = 'padding:0;background:#f8f9fa;border-radius:8px;border:1px solid #e5e7eb;width:100%;max-width:520px;box-sizing:border-box;overflow:hidden;';

    // Header row
    const header = document.createElement('div');
    header.style.cssText = 'padding:12px 16px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#6b7280;font-weight:500;';
    header.textContent = heading;
    card.appendChild(header);

    let pending = fields.length;
    const checkDone = () => { if (--pending <= 0 && onComplete) onComplete(); };

    fields.forEach((f, idx) => {
        const isLast = idx === fields.length - 1;

        const rowWrap = document.createElement('div');
        rowWrap.style.cssText = `border-bottom:${isLast ? 'none' : '1px solid #e5e7eb'};`;

        // ── Row header (icon + name + buttons) ──────────────────────────────
        const rowHead = document.createElement('div');
        rowHead.style.cssText = 'display:flex;align-items:center;gap:10px;padding:12px 16px;';
        rowHead.innerHTML = `
            <i class="${iconClass}" style="color:#3B98F1;font-size:16px;flex-shrink:0;"></i>
            <span style="flex:1;font-size:14px;color:#374151;">${escapeHtml(f.name)}</span>
            <button class="acc-add-btn btn btn-primary btn-sm" style="white-space:nowrap;">${addLabel}</button>
            ${_skipChipButtonHtml({ className: 'acc-skip-btn', label: 'Skip (optional)' })}
        `;

        // ── Expandable form area ─────────────────────────────────────────────
        const rowBody = document.createElement('div');
        rowBody.style.cssText = 'display:none;padding:0 16px 14px;';

        rowWrap.appendChild(rowHead);
        rowWrap.appendChild(rowBody);
        card.appendChild(rowWrap);

        const addBtn  = rowHead.querySelector('.acc-add-btn');
        const skipBtn = rowHead.querySelector('.acc-skip-btn');

        const markDone = (label, color) => {
            addBtn.remove();
            skipBtn.remove();
            const badge = document.createElement('span');
            badge.style.cssText = `color:${color};font-size:13px;font-weight:500;`;
            badge.textContent = label;
            rowHead.appendChild(badge);
            checkDone();
        };

        addBtn.onclick = () => {
            addBtn.disabled = true;
            skipBtn.style.display = 'none';
            rowBody.style.display = 'block';
            scrollToBottom();
            buildFormFn(f.id, rowBody, (saved) => {
                rowBody.style.display = saved ? 'block' : 'none';
                markDone(saved ? 'Added' : '⊘ Skipped', saved ? '#198754' : '#6b7280');
            });
        };

        skipBtn.onclick = () => markDone('⊘ Skipped', '#6b7280');
    });

    // Footer skip-all link (only shown when >1 field)
    if (fields.length > 1) {
        const footer = document.createElement('div');
        footer.style.cssText = 'padding:10px 16px;border-top:1px solid #e5e7eb;text-align:right;';
        footer.innerHTML = _skipChipButtonHtml({ className: 'acc-skip-all-btn', label: 'Skip all', extraStyle: 'font-style:normal;' });
        footer.querySelector('button').onclick = () => {
            card.querySelectorAll('.acc-add-btn,.acc-skip-btn').forEach(b => b.click && b.dispatchEvent(new MouseEvent('click')));
        };
        card.appendChild(footer);
    }

    contentDiv.appendChild(card);
    msgDiv.appendChild(iconEl);
    msgDiv.appendChild(contentDiv);
    messagesArea.appendChild(msgDiv);
    scrollToBottom();
}

function addSupplementaryPromptUI(photoFieldIds, commentFieldIds, actionFieldIds, hazardInfo, extractedFields, responseData, onComplete) {
    const hasPhoto   = Array.isArray(photoFieldIds)   && photoFieldIds.length   > 0;
    const hasComment = Array.isArray(commentFieldIds) && commentFieldIds.length > 0;
    const hasAction  = Array.isArray(actionFieldIds)  && actionFieldIds.length  > 0;
    const hasHazard  = !!(hazardInfo && (hazardInfo.hazardTemplateDetId || hazardInfo.fieldId));
    if (!hasPhoto && !hasComment && !hasAction && !hasHazard) { if (onComplete) onComplete(); return; }

    const options = [];
    if (hasPhoto)   options.push({ key: 'photo',   label: 'Photo',   icon: 'ph-thin ph-camera' });
    if (hasComment) options.push({ key: 'comment', label: 'Comment', icon: 'ph-thin ph-chat-text' });
    if (hasAction)  options.push({ key: 'action',  label: 'Action',  icon: 'ph-thin ph-clipboard-text' });
    if (hasHazard)  options.push({ key: 'hazard',  label: 'Hazard',  icon: 'ph-thin ph-warning' });
    const availableKeys = options.map(function(o) { return o.key; });

    // ── DOM ───────────────────────────────────────────────────────────────────
    const messagesArea = document.getElementById('messagesArea');
    const msgDiv = document.createElement('div');
    msgDiv.className = 'message assistant';

    const iconEl = document.createElement('div');
    iconEl.className = 'message-icon';
    iconEl.innerHTML = '<i class="ph-thin ph-paperclip"></i>';

    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content message-add-ons';

    const card = document.createElement('div');
    card.style.cssText = 'padding:0;background:#f8f9fa;border-radius:8px;border:1px solid #e5e7eb;width:100%;max-width:520px;box-sizing:border-box;overflow:hidden;';

    const header = document.createElement('div');
    header.style.cssText = 'padding:12px 16px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#6b7280;font-weight:500;';
    header.textContent = 'Would you like to add anything else?';
    card.appendChild(header);

    const body = document.createElement('div');
    body.style.cssText = 'padding:12px 16px;';
    card.appendChild(body);

    // ── Chip strip ─────────────────────────────────────────────────────────────
    const chipWrap = document.createElement('div');
    chipWrap.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px;';
    body.appendChild(chipWrap);

    // AI hint bar
    const hint = document.createElement('div');
    hint.style.cssText = 'display:none;font-size:12px;color:#374151;margin-bottom:8px;padding:8px 10px;background:#f0f7ff;border-radius:6px;border:1px solid #dbeafe;line-height:1.5;';
    body.appendChild(hint);

    // Form area — one section visible at a time
    const rowBody = document.createElement('div');
    rowBody.style.cssText = 'display:none;padding:0 0 4px;';
    body.appendChild(rowBody);

    const footer = document.createElement('div');
    footer.style.cssText = 'padding:10px 16px;border-top:1px solid #e5e7eb;display:flex;justify-content:flex-end;gap:8px;';
    const skipBtn = document.createElement('button');
    skipBtn.className = 'supp-skip';
    skipBtn.style.cssText = 'padding:8px 16px;background:white;color:#6b7280;border:1px solid #d1d5db;border-radius:6px;cursor:pointer;font-size:13px;';
    skipBtn.textContent = 'Skip';
    const contBtn = document.createElement('button');
    contBtn.className = 'supp-continue';
    contBtn.style.cssText = 'padding:8px 16px;background:#3B98F1;color:white;border:none;border-radius:6px;cursor:pointer;font-size:13px;font-weight:500;';
    contBtn.textContent = 'Continue';
    footer.appendChild(skipBtn);
    footer.appendChild(contBtn);
    card.appendChild(footer);

    // ── State ─────────────────────────────────────────────────────────────────
    const doneMap  = {};
    const chipEls  = {};
    let   activeKey = null;
    let   _hazardSaveFromChat = null;

    // ── Helpers ───────────────────────────────────────────────────────────────
    const _setHint = function(html, show) {
        hint.style.display = (show === false) ? 'none' : 'block';
        if (html !== undefined) hint.innerHTML = html;
    };

    const _done = function() {
        _undockCard();
        state._suppChatHandler = null;
        const ed = document.querySelector('#chatMessageInput .ql-editor');
        if (ed) ed.dataset.placeholder = 'Type your message...';
        setChatInputState(false, 'Type your message...');
        if (onComplete) onComplete();
    };

    const _setChipStyle = function(key, isActive) {
        const btn = chipEls[key];
        if (!btn) return;
        if (doneMap[key]) {
            btn.style.background = '#e8f5ee'; btn.style.borderColor = '#198754'; btn.style.color = '#198754';
            return;
        }
        if (isActive) {
            btn.style.background = '#3B98F1'; btn.style.borderColor = '#3B98F1'; btn.style.color = 'white';
        } else {
            btn.style.background = 'white'; btn.style.borderColor = '#3B98F1'; btn.style.color = '#3B98F1';
        }
    };

    // Open (or re-use) a form in the shared rowBody container
    const _openFormInCard = function(key) {
        if (activeKey === key) return; // already shown
        Object.keys(chipEls).forEach(function(k) { _setChipStyle(k, k === key); });
        activeKey = key;
        rowBody.style.display = 'block';
        rowBody.innerHTML = '';
        if (key === 'photo') {
            _showPhotoFormInline(photoFieldIds[0], rowBody, function(saved) {
                if (saved) { doneMap.photo = true; _setChipStyle('photo', false); }
            });
        } else if (key === 'comment') {
            _showCommentFormInline(commentFieldIds[0], rowBody, function(saved) {
                if (saved) { doneMap.comment = true; _setChipStyle('comment', false); }
            });
        } else if (key === 'action') {
            _showActionFormInline(actionFieldIds[0], rowBody, responseData, function(saved) {
                if (saved) { doneMap.action = true; _setChipStyle('action', false); }
            });
        } else if (key === 'hazard') {
            _hazardSaveFromChat = _showHazardFormInline(hazardInfo, rowBody, function(saved) {
                if (saved) { doneMap.hazard = true; _setChipStyle('hazard', false); }
            });
        }
        scrollToBottom();
    };

    // ── Build chip buttons ────────────────────────────────────────────────────
    options.forEach(function(opt) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.style.cssText = 'padding:6px 14px;border-radius:20px;border:1px solid #3B98F1;background:white;color:#3B98F1;cursor:pointer;font-size:13px;display:inline-flex;align-items:center;gap:6px;';
        btn.innerHTML = '<i class="' + opt.icon + '" style="font-size:14px;"></i><span>' + opt.label + '</span>';
        chipEls[opt.key] = btn;
        chipWrap.appendChild(btn);
        btn.onclick = function() { _openFormInCard(opt.key); };
    });

    // ── AI intent detector ────────────────────────────────────────────────────
    const _detectIntent = async function(userText) {
        const cats = availableKeys.join(', ');
        const opts = availableKeys.concat(['none']).join(' | ');
        const sys = 'You are a WHS (Work Health & Safety) intake classifier.\nAvailable categories: ' + cats + '\n\nClassify the user message into EXACTLY ONE category:\n- photo:   user wants to attach/upload a photo, image, or picture\n- comment: user is adding a note, comment, or remark\n- action:  user describes a corrective action or task to be done\n- hazard:  user describes a hazard, risk, or unsafe condition\n\nRespond with ONLY one word: ' + opts;
        try {
            const res = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + CONFIG.openaiApiKey },
                body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'system', content: sys }, { role: 'user', content: userText }], temperature: 0, max_tokens: 10 })
            });
            const d = await res.json();
            if (d.usage) trackCost('gpt-4o-mini', d.usage);
            const content = ((d.choices || [{}])[0].message || {}).content || '';
            const word = content.trim().toLowerCase().split(/\W/)[0];
            return availableKeys.indexOf(word) !== -1 ? word : null;
        } catch (e) { return null; }
    };

    // ── Chat lock ─────────────────────────────────────────────────────────────
    const _installGeneralHandler = function() {
        const nonPhotoLabels = options.filter(function(o) { return o.key !== 'photo'; }).map(function(o) { return o.label.toLowerCase(); });
        const placeholder = nonPhotoLabels.length
            ? 'Describe a ' + nonPhotoLabels.join(', ') + ', or type "continue" / "skip"'
            : 'Type "continue" or "skip" to proceed';
        setChatInputState(false, placeholder);
        const ed = document.querySelector('#chatMessageInput .ql-editor');
        if (ed) ed.dataset.placeholder = placeholder;

        state._suppChatHandler = async function(userText) {
            _dockCard(); // move card to sticky footer on first send
            const lower = userText.trim().toLowerCase();
            if (lower === 'continue' || lower === 'done' || lower === 'next' || lower === 'proceed') { _done(); return; }
            if (lower === 'skip' || lower === 'no' || lower === 'no thanks' || lower === 'ignore' || lower === 'cancel') { _done(); return; }

            _setHint('\u23F3 <em style="color:#6b7280;">Detecting intent\u2026</em>');
            const key = await _detectIntent(userText);

            if (key === 'comment' && hasComment) {
                _openFormInCard('comment');
                _setHint('<span style="color:#10b981;font-weight:600;">\u2713 Comment detected</span> \u2014 saving\u2026');
                const ta = rowBody.querySelector('.commentTextarea');
                if (ta) { ta.value = userText; setTimeout(function() { const b = rowBody.querySelector('.commentSaveBtn'); if (b) b.click(); }, 80); }
                setTimeout(function() { _setHint('', false); }, 3500);

            } else if (key === 'action' && hasAction) {
                _openFormInCard('action');
                _setHint('\u23F3 <em style="color:#6b7280;">Extracting action details\u2026</em>');
                try {
                    const today = new Date().toISOString().split('T')[0];
                    const extractRes = await fetch('https://api.openai.com/v1/chat/completions', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + CONFIG.openaiApiKey },
                        body: JSON.stringify({
                            model: 'gpt-4o-mini',
                            messages: [{
                                role: 'system',
                                content: `You extract action details from a work health & safety message.\nReturn JSON with these fields:\n- actionText (string): the task/action to be performed\n- assignedTo (string|null): the person's name if mentioned, otherwise null\n- startDate (string|null): start date in YYYY-MM-DD if mentioned, otherwise null\n- deadline (string|null): deadline/due date in YYYY-MM-DD if mentioned, otherwise null\nToday is ${today}. Only include dates when explicitly stated.`
                            }, {
                                role: 'user', content: userText
                            }],
                            response_format: { type: 'json_object' },
                            temperature: 0, max_tokens: 150
                        })
                    });
                    const extractData = await extractRes.json();
                    if (extractData.usage) trackCost('gpt-4o-mini', extractData.usage);
                    const parsed = JSON.parse(((extractData.choices || [{}])[0].message || {}).content || '{}');

                    // Fill action text
                    const ta = rowBody.querySelector('.actionTextarea');
                    if (ta && parsed.actionText) ta.value = parsed.actionText;

                    // Fill dates if extracted
                    if (parsed.startDate) { const sd = rowBody.querySelector('.actionStartDate'); if (sd) sd.value = parsed.startDate; }
                    if (parsed.deadline)  { const dl = rowBody.querySelector('.actionDeadline');  if (dl) dl.value = parsed.deadline; }

                    // Search for assigned person
                    if (parsed.assignedTo) {
                        const searchInput = rowBody.querySelector('.actionAssignedToSearch');
                        const hiddenId    = rowBody.querySelector('.actionAssignedToId');
                        if (searchInput) searchInput.value = parsed.assignedTo;
                        try {
                            const _baseUrl = CONFIG.apiUrl.replace(/\/affinda\/api\/chat-template.*$/i, '');
                            const personResp = await fetch(_baseUrl + '/NetServices/POSTDynamicChecklist.asmx/GetAuditedLimit', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ data: { StoreID: CONFIG.storeId, LocType: 0, LocID: 0, MemberId: CONFIG.userId, Search: parsed.assignedTo } })
                            });
                            const personJson = await personResp.json();
                            const records = (personJson.d && personJson.d.recordList) ? personJson.d.recordList : [];
                            if (records.length > 0) {
                                if (hiddenId)    hiddenId.value    = records[0].IDNo;
                                if (searchInput) searchInput.value = records[0].RowDescription;
                                _setHint('<span style="color:#10b981;font-weight:600;">\u2713 Action ready</span> \u2014 assigned to <strong>' + escapeHtml(records[0].RowDescription) + '</strong>. Will save automatically.');
                            } else {
                                _setHint('<span style="color:#f59e0b;font-weight:600;">\u26A0 Worker \u201c' + escapeHtml(parsed.assignedTo) + '\u201d not found in the system.</span> Please select manually, or save without an assignee.');
                            }
                        } catch (_pe) {
                            _setHint('<span style="color:#10b981;font-weight:600;">\u2713 Action detected</span> \u2014 could not look up person.');
                        }
                    } else {
                        _setHint('<span style="color:#10b981;font-weight:600;">\u2713 Action detected</span> \u2014 form filled. Will save automatically.');
                    }

                    // Trigger debounced auto-save via input event
                    const ta2 = rowBody.querySelector('.actionTextarea');
                    if (ta2) ta2.dispatchEvent(new Event('input'));
                } catch (_ae) {
                    // Fallback: dump full text into textarea
                    const ta = rowBody.querySelector('.actionTextarea');
                    if (ta) { ta.value = userText; ta.dispatchEvent(new Event('input')); }
                    _setHint('<span style="color:#10b981;font-weight:600;">\u2713 Action detected</span>');
                }
                setTimeout(function() { _setHint('', false); }, 6000);

            } else if (key === 'hazard' && hasHazard) {
                _openFormInCard('hazard');
                _setHint('\u23F3 <em style="color:#6b7280;">Analysing &amp; saving hazard\u2026</em>');
                if (_hazardSaveFromChat) {
                    await _hazardSaveFromChat(userText, function(msg) { _setHint(msg); });
                    setTimeout(function() { _setHint('', false); }, 4000);
                }

            } else if (key === 'photo') {
                _openFormInCard('photo');
                _setHint('\uD83D\uDCF7 Photo section is now open \u2014 please select a photo to upload.');
            } else {
                const labels = options.map(function(o) { return '<strong>' + o.label + '</strong>'; }).join(', ');
                _setHint('<span style="color:#ef4444;">\u26A0 Couldn\'t identify.</span> Click a chip (' + labels + ') or type <em>skip</em> / <em>continue</em>.');
            }
        };
    };

    // ── Footer buttons ────────────────────────────────────────────────────────
    skipBtn.onclick = function() { _done(); };
    contBtn.onclick = function() { _done(); };

    // ── Sticky dock helper ────────────────────────────────────────────────────
    let _docked = false;
    const _dockCard = function() {
        if (_docked) return;
        _docked = true;
        // Create or reuse a dock container in the sticky footer
        let dock = document.getElementById('suppCardDock');
        if (!dock) {
            dock = document.createElement('div');
            dock.id = 'suppCardDock';
            dock.style.cssText = 'padding:6px 12px 0;';
            const stickyFooter = document.querySelector('.chat-sticky-footer');
            if (stickyFooter) stickyFooter.insertBefore(dock, stickyFooter.firstChild);
        }
        // Replace the full message bubble with a small "pinned" badge
        msgDiv.innerHTML = '';
        const badge = document.createElement('div');
        badge.className = 'message assistant';
        badge.style.cssText = 'opacity:0.6;';
        badge.innerHTML = '<div class="message-icon"><i class="ph-thin ph-paperclip"></i></div>' +
            '<div class="message-content"><span style="font-size:12px;color:#9ca3af;">&#128204; Add-ons pinned below</span></div>';
        msgDiv.replaceWith(badge);
        // Move the card into the dock
        dock.appendChild(card);
        scrollToBottom();
    };

    const _undockCard = function() {
        const dock = document.getElementById('suppCardDock');
        if (dock) dock.remove();
    };

    // ── Mount & install ───────────────────────────────────────────────────────
    contentDiv.appendChild(card);
    msgDiv.appendChild(iconEl);
    msgDiv.appendChild(contentDiv);
    messagesArea.appendChild(msgDiv);

    const autoLabels = options.filter(function(o) { return o.key !== 'photo'; }).map(function(o) { return '<strong>' + o.label.toLowerCase() + '</strong>'; });
    if (autoLabels.length) {
        _setHint('<span style="color:#3B98F1;font-weight:600;">Type below</span> \u2014 describe a ' + autoLabels.join(', ') + ' and I\'ll auto-fill &amp; save. Or click a chip above. Type <em>skip</em> / <em>continue</em> when done.');
    }
    _installGeneralHandler();
    scrollToBottom();
}
function addPhotoPromptUI(photoFieldIds, extractedFields, onComplete) {
    if (!photoFieldIds || !photoFieldIds.length) { if (onComplete) onComplete(); return; }
    const fields = photoFieldIds.map(id => {
        const f = extractedFields ? extractedFields.find(x => x.fieldID === id) : null;
        return { id, name: f ? stripHtml(f.fieldName || 'this field') : 'this field' };
    });
    _buildFieldAccordionCard(
        fields,
        'ph-thin ph-camera',
        'Would you like to attach a photo?',
        'Add Photo',
        (fieldId, rowBody, onRowDone) => {
            _showPhotoFormInline(fieldId, rowBody, onRowDone);
        },
        onComplete
    );
}

/**
 * Inline photo form rendered inside an accordion row body.
 */
function _showPhotoFormInline(fieldId, rowBody, onRowDone) {
    rowBody.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <input type="file" class="photoUploadInput" accept="image/*"
                style="flex:1;min-width:0;padding:8px;border:1px solid #e5e7eb;border-radius:6px;background:white;font-size:13px;">
            <button class="photoUploadBtn" style="padding:7px 16px;background:#3B98F1;color:white;border:none;border-radius:6px;cursor:pointer;font-weight:500;font-size:13px;">Upload</button>
        </div>
        <div class="photoUploadProgress" style="margin-top:8px;display:none;font-size:13px;"></div>
    `;
    const fileInput = rowBody.querySelector('.photoUploadInput');
    const uploadBtn = rowBody.querySelector('.photoUploadBtn');
    const progress  = rowBody.querySelector('.photoUploadProgress');

    uploadBtn.onclick = async () => {
        if (!fileInput.files || !fileInput.files.length) { alert('Please select a photo first'); return; }
        const file = fileInput.files[0];
        const formData = new FormData();
        formData.append('file', file);
        formData.append('regOthID', state.regOthId);
        formData.append('storeID', CONFIG.storeId);
        try {
            uploadBtn.disabled = true; uploadBtn.style.opacity = '0.6';
            progress.style.display = 'block'; progress.style.color = '#6b7280';
            progress.textContent = 'Uploading...';
            const uploadResp = await fetch(`${CONFIG.apiUrl}/upload`, { method: 'POST', body: formData });
            const uploadData = await uploadResp.json();
            if (!uploadData.success) throw new Error(uploadData.errorMessage || 'Upload failed');
            progress.textContent = 'Saving record...';
            const saveResp = await fetch(`${CONFIG.apiUrl}/save-field-photo`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    regOthID: state.regOthId, storeID: CONFIG.storeId, fieldID: fieldId,
                    fileName: file.name, fullFileName: uploadData.filePath,
                    updatedByID: CONFIG.userId, updatedByName: CONFIG.userProfile.FullName || CONFIG.userName
                })
            });
            const saveData = await saveResp.json();
            progress.textContent = saveData.success ? `${file.name}` : `Uploaded, save failed`;
            progress.style.color = saveData.success ? '#198754' : '#fd7e14';
            setTimeout(() => onRowDone(true), 1200);
        } catch (err) {
            progress.textContent = `${err.message}`; progress.style.color = '#dc3545';
            uploadBtn.disabled = false; uploadBtn.style.opacity = '1';
        }
    };
}

// ── ShowComment prompt ───────────────────────────────────────────────────────

function addCommentPromptUI(commentFieldIds, extractedFields, onComplete) {
    if (!commentFieldIds || !commentFieldIds.length) { if (onComplete) onComplete(); return; }
    const fields = commentFieldIds.map(id => {
        const f = extractedFields ? extractedFields.find(x => x.fieldID === id) : null;
        return { id, name: f ? stripHtml(f.fieldName || 'this field') : 'this field' };
    });
    _buildFieldAccordionCard(
        fields,
        'ph-thin ph-chat-text',
        'Would you like to add a comment?',
        'Add Comment',
        (fieldId, rowBody, onRowDone) => {
            _showCommentFormInline(fieldId, rowBody, onRowDone);
        },
        onComplete
    );
}

function _showCommentFormInline(fieldId, rowBody, onRowDone) {
    rowBody.innerHTML = `
        <textarea class="commentTextarea" rows="3" placeholder="Type your comment here..."
            style="width:100%;padding:10px;border:1px solid #e5e7eb;border-radius:6px;font-size:14px;resize:vertical;font-family:inherit;box-sizing:border-box;"></textarea>
        <button class="commentSaveBtn" style="display:none;"></button>
        <div class="commentSaveProgress" style="margin-top:6px;display:none;font-size:13px;"></div>
    `;
    const textarea = rowBody.querySelector('.commentTextarea');
    const saveBtn  = rowBody.querySelector('.commentSaveBtn');
    const progress = rowBody.querySelector('.commentSaveProgress');
    setTimeout(() => textarea.focus(), 80);

    let _saveTimer = null;
    let _lastSaved = '';

    const _doSave = async () => {
        const comment = textarea.value.trim();
        if (!comment || comment === _lastSaved) return;
        if (saveBtn.disabled) return;
        try {
            saveBtn.disabled = true;
            progress.style.display = 'block'; progress.style.color = '#6b7280';
            progress.textContent = 'Saving...';
            const resp = await fetch(`${CONFIG.apiUrl}/save-field-comment`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ regOthID: state.regOthId, storeID: CONFIG.storeId, fieldID: fieldId, comment, updatedByID: CONFIG.userId })
            });
            const data = await resp.json();
            if (!data.success) throw new Error(data.errorMessage || 'Save failed');
            _lastSaved = comment;
            progress.textContent = '\u2713 Saved'; progress.style.color = '#198754';
            setTimeout(() => { progress.style.display = 'none'; }, 2000);
            onRowDone(true);
        } catch (err) {
            progress.textContent = err.message; progress.style.color = '#dc3545';
        } finally {
            saveBtn.disabled = false;
        }
    };

    saveBtn.onclick = () => _doSave();
    textarea.addEventListener('input', () => { clearTimeout(_saveTimer); _saveTimer = setTimeout(_doSave, 1500); });
    textarea.addEventListener('blur',  () => { clearTimeout(_saveTimer); _doSave(); });
}

/**
 * Shows a textarea input for a comment. Saves via /save-field-comment. Calls onComplete() when done.
 */
function showCommentInputUI(fieldId, parentContentDiv, onComplete) {
    const commentDiv = document.createElement('div');
    commentDiv.className = 'comment-input-container';
    commentDiv.style.cssText = 'margin-top:10px;padding:14px;background:#f8f9fa;border-radius:8px;border:1px solid #e5e7eb;max-width:520px;box-sizing:border-box;';

    commentDiv.innerHTML = `
        <textarea class="commentTextarea" rows="3" placeholder="Type your comment here..."
            style="width:100%;padding:10px;border:1px solid #e5e7eb;border-radius:6px;font-size:14px;resize:vertical;font-family:inherit;box-sizing:border-box;"></textarea>
        <div style="display:flex;gap:8px;margin-top:10px;">
            <button class="commentSaveBtn" style="padding:8px 18px;background:#3B98F1;color:white;border:none;border-radius:6px;cursor:pointer;font-weight:500;font-size:14px;">Save Comment</button>
            ${_skipChipButtonHtml({ className: 'commentSkipBtn', label: 'Skip (optional)', extraStyle: 'padding:8px 14px;' })}
        </div>
        <div class="commentSaveProgress" style="margin-top:8px;display:none;color:#6b7280;font-size:13px;"></div>
    `;

    parentContentDiv.appendChild(commentDiv);
    scrollToBottom();

    const textarea = commentDiv.querySelector('.commentTextarea');
    const saveBtn = commentDiv.querySelector('.commentSaveBtn');
    const skipBtn = commentDiv.querySelector('.commentSkipBtn');
    const progress = commentDiv.querySelector('.commentSaveProgress');

    // Focus the textarea
    setTimeout(() => textarea.focus(), 100);

    skipBtn.onclick = () => {
        commentDiv.remove();
        parentContentDiv.innerHTML += ' <span style="color:#6b7280;font-size:13px;">(skipped)</span>';
        if (onComplete) onComplete();
    };

    saveBtn.onclick = async () => {
        const comment = textarea.value.trim();
        if (!comment) {
            alert('Please enter a comment or click Skip');
            return;
        }

        try {
            saveBtn.disabled = true;
            skipBtn.disabled = true;
            saveBtn.style.opacity = '0.6';
            skipBtn.style.opacity = '0.6';
            progress.style.display = 'block';
            progress.textContent = 'Saving comment...';

            const resp = await fetch(`${CONFIG.apiUrl}/save-field-comment`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    regOthID: state.regOthId,
                    storeID: CONFIG.storeId,
                    fieldID: fieldId,
                    comment: comment,
                    updatedByID: CONFIG.userId
                })
            });
            const data = await resp.json();

            if (data.success) {
                progress.textContent = `Comment saved`;
                progress.style.color = '#198754';
            } else {
                progress.textContent = `Save failed: ${data.errorMessage || 'Unknown'}`;
                progress.style.color = '#dc3545';
                saveBtn.disabled = false;
                skipBtn.disabled = false;
                saveBtn.style.opacity = '1';
                skipBtn.style.opacity = '1';
                return; // Let user retry
            }
        } catch (error) {
            progress.textContent = `Error: ${error.message}`;
            progress.style.color = '#dc3545';
            saveBtn.disabled = false;
            skipBtn.disabled = false;
            saveBtn.style.opacity = '1';
            skipBtn.style.opacity = '1';
            return; // Let user retry
        }

        // After success, wait briefly then continue
        setTimeout(() => {
            commentDiv.remove();
            if (onComplete) onComplete();
        }, 1000);
    };
}

// ── Action prompt (ShowAction) ────────────────────────────────────────────────

function addActionPromptUI(actionFieldIds, extractedFields, responseData, onComplete) {
    if (!actionFieldIds || !actionFieldIds.length) { if (onComplete) onComplete(); return; }
    const fields = actionFieldIds.map(id => {
        const f = extractedFields ? extractedFields.find(x => x.fieldID === id) : null;
        return { id, name: f ? stripHtml(f.fieldName || 'this field') : 'this field' };
    });
    _buildFieldAccordionCard(
        fields,
        'ph-thin ph-clipboard-text',
        'Would you like to add an action?',
        'Add Action',
        (fieldId, rowBody, onRowDone) => {
            _showActionFormInline(fieldId, rowBody, responseData, onRowDone);
        },
        onComplete
    );
}

// Show the 4-field action form: Action text, Assigned to, Start Date, Deadline
function _showActionFormInline(fieldId, rowBody, responseData, onRowDone) {
    const baseUrl = CONFIG.apiUrl.replace(/\/affinda\/api\/chat-template$/i, '');
    const auditedLimitUrl = baseUrl + '/NetServices/POSTDynamicChecklist.asmx/GetAuditedLimit';
    const today = new Date().toISOString().split('T')[0];

    rowBody.innerHTML = `
        <div style="margin-bottom:10px;">
            <label style="font-weight:600;font-size:13px;color:#333;display:block;margin-bottom:4px;">Action</label>
            <textarea class="actionTextarea" rows="3" placeholder="Describe the action to be implemented..."
                style="width:100%;padding:10px;border:1px solid #e5e7eb;border-radius:6px;font-size:14px;resize:vertical;font-family:inherit;box-sizing:border-box;"></textarea>
        </div>
        <div style="margin-bottom:10px;">
            <label style="font-weight:600;font-size:13px;color:#333;display:block;margin-bottom:4px;">Assigned to</label>
            <div style="position:relative;">
                <input type="text" class="actionAssignedToSearch" placeholder="Search person..."
                    style="width:100%;padding:10px;border:1px solid #e5e7eb;border-radius:6px;font-size:14px;box-sizing:border-box;" autocomplete="off">
                <input type="hidden" class="actionAssignedToId" value="">
                <div class="actionAssignedToDropdown" style="display:none;position:absolute;top:100%;left:0;right:0;max-height:200px;overflow-y:auto;background:white;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 6px 6px;z-index:1000;box-shadow:0 4px 12px rgba(0,0,0,0.1);"></div>
            </div>
        </div>
        <div style="display:flex;gap:12px;margin-bottom:10px;">
            <div style="flex:1;">
                <label style="font-weight:600;font-size:13px;color:#333;display:block;margin-bottom:4px;">Start Date</label>
                <input type="date" class="actionStartDate" value="${today}"
                    style="width:100%;padding:10px;border:1px solid #e5e7eb;border-radius:6px;font-size:14px;box-sizing:border-box;">
            </div>
            <div style="flex:1;">
                <label style="font-weight:600;font-size:13px;color:#333;display:block;margin-bottom:4px;">Deadline</label>
                <input type="date" class="actionDeadline" value="${today}"
                    style="width:100%;padding:10px;border:1px solid #e5e7eb;border-radius:6px;font-size:14px;box-sizing:border-box;">
            </div>
        </div>
        <button class="actionSaveBtn" style="display:none;"></button>
        <div class="actionSaveProgress" style="margin-top:8px;display:none;color:#6b7280;font-size:13px;"></div>
    `;

    scrollToBottom();

    const textarea = rowBody.querySelector('.actionTextarea');
    const searchInput = rowBody.querySelector('.actionAssignedToSearch');
    const hiddenId = rowBody.querySelector('.actionAssignedToId');
    const dropdown = rowBody.querySelector('.actionAssignedToDropdown');
    const startDateInput = rowBody.querySelector('.actionStartDate');
    const deadlineInput = rowBody.querySelector('.actionDeadline');
    const saveBtn = rowBody.querySelector('.actionSaveBtn');
    const progress = rowBody.querySelector('.actionSaveProgress');

    setTimeout(() => textarea.focus(), 100);

    // ── Assigned-to search dropdown (calls GetAuditedLimit ASMX) ──────────
    let searchTimeout = null;
    searchInput.addEventListener('input', () => {
        clearTimeout(searchTimeout);
        const term = searchInput.value.trim();
        if (term.length < 2) { dropdown.style.display = 'none'; return; }

        searchTimeout = setTimeout(async () => {
            try {
                const resp = await fetch(auditedLimitUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        data: {
                            StoreID: CONFIG.storeId,
                            LocType: 0,
                            LocID: 0,
                            MemberId: CONFIG.userId,
                            Search: term
                        }
                    })
                });
                const json = await resp.json();
                const records = json.d?.recordList || [];

                if (records.length === 0) {
                    dropdown.innerHTML = '<div style="padding:8px 10px; color:#6b7280; font-size:13px;">No results</div>';
                    dropdown.style.display = 'block';
                    return;
                }

                dropdown.innerHTML = records.map(r =>
                    `<div class="action-person-option" data-id="${r.IDNo}" data-name="${escapeHtml(r.RowDescription)}"
                          style="padding:8px 10px; cursor:pointer; font-size:14px; border-bottom:1px solid #f0f0f0;"
                          onmouseover="this.style.background='#e9ecef'" onmouseout="this.style.background='white'">
                        ${escapeHtml(r.RowDescription)}
                    </div>`
                ).join('');
                dropdown.style.display = 'block';

                dropdown.querySelectorAll('.action-person-option').forEach(opt => {
                    opt.addEventListener('click', () => {
                        hiddenId.value = opt.getAttribute('data-id');
                        searchInput.value = opt.getAttribute('data-name');
                        dropdown.style.display = 'none';
                    });
                });
            } catch (err) {
                console.warn('[Action] Assigned-to search error:', err);
                dropdown.style.display = 'none';
            }
        }, 300);
    });

    // Close dropdown on outside click
    document.addEventListener('click', function closeActionDropdown(e) {
        if (!rowBody.contains(e.target)) {
            dropdown.style.display = 'none';
            document.removeEventListener('click', closeActionDropdown);
        }
    });

    // ── Save action ───────────────────────────────────────────────────────
    let _actSaveTimer = null;
    let _actLastSaved = '';

    const _doSave = async () => {
        const actionText = textarea.value.trim();
        if (!actionText || actionText === _actLastSaved) return;
        if (saveBtn.disabled) return;
        try {
            saveBtn.disabled = true;
            progress.style.display = 'block';
            progress.textContent = 'Saving...'; progress.style.color = '#6b7280';

            const resp = await fetch(`${CONFIG.apiUrl}/save-field-action`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    regOthID: state.regOthId,
                    storeID: CONFIG.storeId,
                    regTypeID: responseData.regTypeID || 0,
                    fieldID: fieldId,
                    actionText: actionText,
                    startDate: startDateInput.value || today,
                    deadline: deadlineInput.value || today,
                    updatedByID: CONFIG.userId,
                    updatedByName: CONFIG.userProfile.FullName || CONFIG.userName,
                    actionImplementorID: parseInt(hiddenId.value) || 0,
                    actionImplementorName: searchInput.value.trim()
                })
            });
            const data = await resp.json();

            if (data.success) {
                _actLastSaved = actionText;
                progress.textContent = '\u2713 Saved'; progress.style.color = '#198754';
                setTimeout(() => { progress.style.display = 'none'; }, 2000);
                onRowDone(true);
            } else {
                progress.textContent = `Save failed: ${data.errorMessage || 'Unknown'}`;
                progress.style.color = '#dc3545';
                saveBtn.disabled = false;
            }
        } catch (error) {
            progress.textContent = `Error: ${error.message}`;
            progress.style.color = '#dc3545';
            saveBtn.disabled = false;
        }
    };

    saveBtn.onclick = () => _doSave();
    textarea.addEventListener('input', () => { clearTimeout(_actSaveTimer); _actSaveTimer = setTimeout(_doSave, 1800); });
    textarea.addEventListener('blur',  () => { clearTimeout(_actSaveTimer); _doSave(); });
    startDateInput.addEventListener('change', () => { clearTimeout(_actSaveTimer); _actSaveTimer = setTimeout(_doSave, 500); });
    deadlineInput.addEventListener('change',  () => { clearTimeout(_actSaveTimer); _actSaveTimer = setTimeout(_doSave, 500); });
}

// ── Hazard form inline ────────────────────────────────────────────────────────
/**
 * Inline hazard creation form (table in chat + right-side panel for adding).
 * hazardInfo: { hazardTemplateDetId, riskMatrixId, showAddRA, showAddControl, showAddCurrentRA, showAddResidualRA, showAddNewControl, fieldId }
 */
function _showHazardFormInline(hazardInfo, rowBody, onRowDone) {
    const _riskColorMap = { Low: '#198754', Medium: '#fd7e14', High: '#dc3545', Extreme: '#6f42c1' };

    function _getRatingColor(h) {
        if (h.RawBgColor && h.RawBgColor !== '') return h.RawBgColor;
        if (h.RawBGColor && h.RawBGColor !== '') return h.RawBGColor;
        return _riskColorMap[h.RawRiskRating] || _riskColorMap[h.RawCodeName] || '#6b7280';
    }

    const TAB_STYLE_ACTIVE   = 'padding:8px 16px;border:none;background:transparent;cursor:pointer;font-size:13px;font-weight:600;color:#3B98F1;border-bottom:2px solid #3B98F1;margin-bottom:-1px;';
    const TAB_STYLE_INACTIVE = 'padding:8px 16px;border:none;background:transparent;cursor:pointer;font-size:13px;font-weight:500;color:#6b7280;border-bottom:2px solid transparent;margin-bottom:-1px;';

    // ── ShowAdd* flags ─────────────────────────────────────────────────────
    const showRA         = !!(hazardInfo.showAddRA);
    const showCurRA      = !!(hazardInfo.showAddCurrentRA);
    const showResRA      = !!(hazardInfo.showAddResidualRA);
    const showControl    = !!(hazardInfo.showAddControl);
    const showNewControl = !!(hazardInfo.showAddNewControl);

    // ── Hazard list (module-level for action handlers) ───────────────────
    let existingHazardsList = [];

    function _ratingBadge(rating, color) {
        if (!rating) return '<span style="color:#9ca3af;">-</span>';
        return `<span style="font-size:11px;font-weight:600;color:white;background:${color || '#6b7280'};padding:2px 9px;border-radius:10px;">${escapeHtml(rating)}</span>`;
    }

    // ── Table helpers ──────────────────────────────────────────────────────
    const _matrixIconSvg = `<span class="icon-arventa icon-arventa-risk-matrix" style="pointer-events:none;"><span class="path1"></span><span class="path2"></span><span class="path3"></span><span class="path4"></span><span class="path5"></span><span class="path6"></span><span class="path7"></span><span class="path8"></span><span class="path9"></span></span>`;

    function _buildHazardCard(h, idx) {
        const rawCol = h.RawBgColor     || '';
        const curCol = h.CurrentBgColor || '';
        const resCol = h.ResBgColor     || '';
        const ctrlCount    = h.CurCtrlCount != null ? h.CurCtrlCount : (h.ControlMeasures    ? h.ControlMeasures.split('\n').filter(s => s.trim()).length    : 0);
        const newCtrlCount = h.NewCtrlCount != null ? h.NewCtrlCount : (h.NewControlMeasures ? h.NewControlMeasures.split('\n').filter(s => s.trim()).length : 0);
        const accentColor  = rawCol || '#d1d5db';

        function _ratingBtn(ratingName, ratingColor, type, label) {
            const pill = ratingName
                ? `<span style="font-size:10px;font-weight:700;color:white;background:${ratingColor||'#6b7280'};padding:1px 6px;border-radius:6px;margin-left:3px;vertical-align:middle;">${escapeHtml(ratingName)}</span>`
                : '';
            return `<button class="hz-rating-btn hz-act-btn" data-idx="${idx}" data-type="${type}" title="Set ${label}"
                style="display:inline-flex;align-items:center;gap:3px;padding:3px 7px;border:1px solid #e5e7eb;border-radius:6px;background:white;cursor:pointer;font-size:11px;color:#6b7280;white-space:nowrap;">${_matrixIconSvg}<span>${escapeHtml(label)}</span>${pill}</button>`;
        }
        function _ctrlBtn(count, type, label) {
            return `<button class="hz-ctrl-btn hz-act-btn" data-idx="${idx}" data-type="${type}" title="Add ${label}"
                style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border:1px solid #e5e7eb;border-radius:6px;background:white;cursor:pointer;font-size:11px;color:#6b7280;white-space:nowrap;">
                <i class="icon-arventa icon-arventa-risk-add" style="pointer-events:none;font-size:13px;"></i>
                <span>${escapeHtml(label)}</span>
                <span style="background:#198754;color:white;border-radius:8px;padding:0 5px;font-size:10px;font-weight:700;min-width:16px;text-align:center;">${count}</span>
            </button>`;
        }
        const hasRatingBtns = showRA || showCurRA || showResRA;

        // ── Inline controls section ──────────────────────────────────────
        const _ctrlArr = Array.isArray(h.ControlResponses) ? h.ControlResponses : [];
        const _curCtrls = _ctrlArr.filter(c => c.IsCurrentControl !== false);
        const _newCtrls = _ctrlArr.filter(c => c.IsCurrentControl === false);
        const _showCtrlSection = showControl || showNewControl || _curCtrls.length > 0 || _newCtrls.length > 0;

        function _ctrlItemRow(c) {
            const hierColor = { Elimination:'#7c3aed', Substitution:'#2563eb', Isolation:'#0891b2',
                Engineering:'#059669', Administrative:'#d97706', PPE:'#dc2626' };
            const hier   = c.ControlHeirarchy || c.ControlMeasureDesc || '';
            const desc   = c.ControlDescription || c.ControlText || '';
            const hColor = hierColor[hier] || '#6b7280';
            return `<div style="display:flex;gap:7px;align-items:flex-start;padding:5px 0;border-bottom:1px solid #f3f4f6;">
                <span style="flex-shrink:0;font-size:10px;font-weight:600;padding:1px 5px;border-radius:4px;background:${hColor}1a;color:${hColor};margin-top:1px;white-space:nowrap;">${escapeHtml(hier)}</span>
                <span style="font-size:12px;color:#374151;line-height:1.4;">${escapeHtml(desc)}</span>
            </div>`;
        }

        const _ctrlTotal = _curCtrls.length + _newCtrls.length;
        const _ctrlSummaryLabel = _ctrlTotal > 0
            ? `Controls &nbsp;<span style="font-size:10px;font-weight:400;color:#6b7280;">(${_curCtrls.length} current, ${_newCtrls.length} new)</span>`
            : `Controls`;
        const _ctrlSection = _showCtrlSection ? `
            <details style="margin-top:8px;border-top:1px solid #f3f4f6;padding-top:6px;">
                <summary style="cursor:pointer;font-size:11px;font-weight:600;color:#6b7280;list-style:none;display:flex;align-items:center;gap:5px;user-select:none;">
                    <span style="font-size:10px;">&#9654;</span> ${_ctrlSummaryLabel}
                </summary>
                <div style="margin-top:8px;display:flex;flex-direction:column;gap:8px;">
                    ${(showControl || _curCtrls.length > 0) ? `
                    <div>
                        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
                            <span style="font-size:11px;font-weight:700;color:#065f46;">Current Controls <span style="font-weight:400;color:#9ca3af;">(${_curCtrls.length})</span></span>
                            <button class="hz-ctrl-btn hz-act-btn" data-idx="${idx}" data-type="ctrl" style="padding:1px 8px;border:1px solid #d1fae5;border-radius:5px;background:#f0fdf4;color:#065f46;font-size:11px;cursor:pointer;">+ Add</button>
                        </div>
                        <div style="display:flex;flex-direction:column;">
                            ${_curCtrls.length ? _curCtrls.map(_ctrlItemRow).join('') : '<span style="font-size:11px;color:#9ca3af;padding:3px 0;display:block;">None recorded</span>'}
                        </div>
                    </div>` : ''}
                    ${(showControl || showNewControl || _newCtrls.length > 0) ? `
                    <div>
                        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
                            <span style="font-size:11px;font-weight:700;color:#1e40af;">&#8635; New Controls <span style="font-weight:400;color:#9ca3af;">(${_newCtrls.length})</span></span>
                            <button class="hz-ctrl-btn hz-act-btn" data-idx="${idx}" data-type="newctrl" style="padding:1px 8px;border:1px solid #dbeafe;border-radius:5px;background:#eff6ff;color:#1e40af;font-size:11px;cursor:pointer;">+ Add</button>
                        </div>
                        <div style="display:flex;flex-direction:column;">
                            ${_newCtrls.length ? _newCtrls.map(_ctrlItemRow).join('') : '<span style="font-size:11px;color:#9ca3af;padding:3px 0;display:block;">None recorded</span>'}
                        </div>
                    </div>` : ''}
                </div>
            </details>` : ''

        return `<div data-hz-idx="${idx}" style="background:white;border:1px solid #e5e7eb;border-radius:8px;padding:10px 12px;border-left:4px solid ${accentColor};">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
                <div style="flex:1;min-width:0;">
                    <div style="font-size:13px;font-weight:600;color:#111;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(h.HazardTypeDetails||'')}">${escapeHtml(h.HazardTypeDetails||'\u2013')}</div>
                    ${h.HazardType ? `<div style="font-size:11px;color:#9ca3af;margin-top:1px;">${escapeHtml(h.HazardType)}</div>` : ''}
                </div>
                <div style="display:flex;align-items:center;gap:2px;flex-shrink:0;">
                    ${rawCol && !showRA ? `<span style="font-size:10px;font-weight:700;color:white;background:${rawCol};padding:2px 7px;border-radius:8px;margin-right:4px;">${escapeHtml(h.RawRiskRating||'')}</span>` : ''}
                    <button class="hz-act-btn hz-edit-btn" data-idx="${idx}" title="Edit" style="background:none;border:none;cursor:pointer;font-size:15px;padding:2px 4px;color:#6b7280;"><i class="icon-arventa icon-arventa-risk-edit" style="pointer-events:none;"></i></button>
                    <button class="hz-act-btn hz-copy-btn" data-idx="${idx}" title="Copy" style="background:none;border:none;cursor:pointer;font-size:15px;padding:2px 4px;color:#6b7280;"><i class="icon-arventa icon-arventa-migrate_to_whs_monitor" style="pointer-events:none;"></i></button>
                    <button class="hz-act-btn hz-del-btn" data-idx="${idx}" title="Delete" style="background:none;border:none;cursor:pointer;font-size:15px;padding:2px 4px;color:#dc3545;"><i class="icon-arventa icon-arventa-risk-delete" style="pointer-events:none;"></i></button>
                </div>
            </div>
            ${h.RiskDescription ? `<div style="font-size:12px;color:#555;line-height:1.45;margin-top:6px;">${escapeHtml(h.RiskDescription)}</div>` : ''}
            ${hasRatingBtns ? `<div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:8px;">
                ${showRA  ? _ratingBtn(h.RawRiskRating,     rawCol, 'raw', 'Raw Rating') : ''}
                ${showCurRA ? _ratingBtn(h.CurrentRiskRating, curCol, 'cur', 'Cur Rating') : ''}
                ${showResRA ? _ratingBtn(h.ResRiskRating,     resCol, 'res', 'Res Rating') : ''}
            </div>` : ''}
            ${_ctrlSection}
        </div>`;
    }

    function _bindTableActions(cardList) {
        cardList.addEventListener('click', async e => {
            const btn = e.target.closest('.hz-act-btn');
            if (!btn) return;
            const idx = parseInt(btn.dataset.idx);
            const h   = existingHazardsList[idx];
            if (!h) return;

            if (btn.classList.contains('hz-ctrl-btn')) {
                const isCurrentCtrl = btn.dataset.type === 'ctrl';
                const _ctrlBaseUrl  = CONFIG.apiUrl.replace(/\/affinda\/api\/chat-template.*$/i, '');
                let selectedHierarchy = 'Elimination';
                const _hierOpts = ['Elimination','Substitution','Isolation','Engineering','Administrative','PPE'];

                const _extraFields = !isCurrentCtrl ? `
                    <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:4px;">
                        <div style="flex:1;min-width:120px;">
                            <label style="font-size:12px;font-weight:600;color:#374151;display:block;margin-bottom:4px;">Start Date</label>
                            <input id="hz-ctrl-startdate" type="date" style="width:100%;border:1px solid #d1d5db;border-radius:6px;padding:5px 8px;font-size:12px;box-sizing:border-box;">
                        </div>
                        <div style="flex:1;min-width:120px;">
                            <label style="font-size:12px;font-weight:600;color:#374151;display:block;margin-bottom:4px;">Deadline</label>
                            <input id="hz-ctrl-deadline" type="date" style="width:100%;border:1px solid #d1d5db;border-radius:6px;padding:5px 8px;font-size:12px;box-sizing:border-box;">
                        </div>
                        <div style="flex:1;min-width:120px;">
                            <label style="font-size:12px;font-weight:600;color:#374151;display:block;margin-bottom:4px;">Implemented By</label>
                            <input id="hz-ctrl-implementedby" type="text" placeholder="Name" style="width:100%;border:1px solid #d1d5db;border-radius:6px;padding:5px 8px;font-size:12px;box-sizing:border-box;">
                        </div>
                    </div>` : '';

                const _ctrlOverlay = document.createElement('div');
                _ctrlOverlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:9000;display:flex;align-items:flex-start;justify-content:flex-end;';
                // Build existing controls list
                const _existingCtrls = Array.isArray(h.ControlResponses)
                    ? h.ControlResponses.filter(c => !!c.IsCurrentControl === isCurrentCtrl)
                    : [];
                const _existingHtml = _existingCtrls.length
                    ? _existingCtrls.map(c => {
                        const _ph = { Elimination:'#7c3aed', Substitution:'#2563eb', Isolation:'#0891b2', Engineering:'#059669', Administrative:'#d97706', PPE:'#dc2626' };
                        const _h = c.ControlHeirarchy || c.ControlMeasureDesc || '';
                        const _d = c.ControlDescription || c.ControlText || '';
                        const _hc = _ph[_h] || '#6b7280';
                        return `<div style="display:flex;gap:8px;align-items:flex-start;padding:7px 0;border-bottom:1px solid #f3f4f6;">
                            <span style="flex-shrink:0;font-size:10px;font-weight:600;padding:1px 6px;border-radius:4px;background:${_hc}1a;color:${_hc};margin-top:1px;">${escapeHtml(_h)}</span>
                            <span style="font-size:12px;color:#374151;line-height:1.4;">${escapeHtml(_d)}</span>
                        </div>`;
                    }).join('')
                    : '<p style="font-size:12px;color:#9ca3af;margin:0;">None recorded yet.</p>';
                _ctrlOverlay.innerHTML = `
                    <div style="background:white;height:100%;width:480px;max-width:95vw;display:flex;flex-direction:column;box-shadow:-4px 0 20px rgba(0,0,0,0.2);">
                        <div style="padding:16px 20px;border-bottom:1px solid #e5e7eb;display:flex;align-items:center;justify-content:space-between;">
                            <span style="font-weight:700;font-size:15px;color:#111;">${isCurrentCtrl ? 'Current Controls' : 'New Controls'}</span>
                            <button class="hz-ctrl-close" style="background:none;border:none;font-size:22px;cursor:pointer;color:#6b7280;line-height:1;padding:2px 6px;">&times;</button>
                        </div>
                        <div style="flex:1;overflow-y:auto;padding:20px;">
                            <div style="margin-bottom:16px;">
                                <div style="font-size:12px;font-weight:600;color:#374151;margin-bottom:6px;">Existing ${isCurrentCtrl ? 'Current' : 'New'} Controls</div>
                                <div class="hz-ctrl-existing-list" style="border:1px solid #e5e7eb;border-radius:6px;padding:8px 12px;background:#fafafa;">${_existingHtml}</div>
                            </div>
                            <hr style="margin:0 0 16px;border:none;border-top:1px solid #e5e7eb;">
                            <div style="font-size:12px;font-weight:600;color:#374151;margin-bottom:12px;">Add ${isCurrentCtrl ? 'Current' : 'New'} Control</div>
                            <div style="margin-bottom:16px;">
                                <label style="font-size:12px;font-weight:600;color:#374151;display:block;margin-bottom:8px;">Hierarchy</label>
                                <div style="display:flex;flex-wrap:wrap;gap:6px;" id="hz-ctrl-hierarchy">
                                    ${_hierOpts.map(hh => `<button type="button" data-h="${hh}" class="hz-hier-btn" style="padding:5px 10px;border:1px solid #d1d5db;border-radius:6px;background:${hh==='Elimination'?'#1d4ed8':'white'};color:${hh==='Elimination'?'white':'#374151'};cursor:pointer;font-size:12px;">${hh}</button>`).join('')}
                                </div>
                            </div>
                            <div style="margin-bottom:14px;">
                                <label style="font-size:12px;font-weight:600;color:#374151;display:block;margin-bottom:4px;">Description <span style="color:#dc3545;font-size:10px;font-weight:400;">Required</span></label>
                                <textarea id="hz-ctrl-desc" rows="4" style="width:100%;border:1px solid #d1d5db;border-radius:6px;padding:8px;font-size:12px;resize:vertical;box-sizing:border-box;" placeholder="Enter control description..."></textarea>
                                <div id="hz-ctrl-desc-err" style="display:none;color:#dc3545;font-size:11px;margin-top:3px;">Description is required</div>
                            </div>
                            <div style="margin-bottom:14px;">
                                <label style="font-size:12px;font-weight:600;color:#374151;display:block;margin-bottom:4px;">Comments</label>
                                <textarea id="hz-ctrl-comment" rows="3" style="width:100%;border:1px solid #d1d5db;border-radius:6px;padding:8px;font-size:12px;resize:vertical;box-sizing:border-box;" placeholder="Optional comments..."></textarea>
                            </div>
                            ${_extraFields}
                        </div>
                        <div style="padding:14px 20px;border-top:1px solid #e5e7eb;display:flex;justify-content:flex-end;gap:10px;">
                            <button class="hz-ctrl-close" style="padding:7px 18px;border:1px solid #d1d5db;border-radius:6px;background:white;font-size:13px;cursor:pointer;color:#374151;">Close</button>
                            <button id="hz-ctrl-save" style="padding:7px 18px;border:none;border-radius:6px;background:#198754;color:white;font-size:13px;font-weight:600;cursor:pointer;">Save Control</button>
                        </div>
                    </div>`;
                document.body.appendChild(_ctrlOverlay);

                // Hierarchy toggle
                _ctrlOverlay.querySelector('#hz-ctrl-hierarchy').addEventListener('click', ev => {
                    const hBtn = ev.target.closest('.hz-hier-btn');
                    if (!hBtn) return;
                    selectedHierarchy = hBtn.dataset.h;
                    _ctrlOverlay.querySelectorAll('.hz-hier-btn').forEach(b => {
                        const active = b === hBtn;
                        b.style.background = active ? '#1d4ed8' : 'white';
                        b.style.color      = active ? 'white'   : '#374151';
                    });
                });
                // Close
                _ctrlOverlay.querySelectorAll('.hz-ctrl-close').forEach(c => c.addEventListener('click', () => _ctrlOverlay.remove()));
                _ctrlOverlay.addEventListener('click', ev => { if (ev.target === _ctrlOverlay) _ctrlOverlay.remove(); });

                // Save
                _ctrlOverlay.querySelector('#hz-ctrl-save').addEventListener('click', async () => {
                    const desc  = _ctrlOverlay.querySelector('#hz-ctrl-desc').value.trim();
                    const errEl = _ctrlOverlay.querySelector('#hz-ctrl-desc-err');
                    if (!desc) { errEl.style.display = 'block'; return; }
                    errEl.style.display = 'none';
                    const comment = (_ctrlOverlay.querySelector('#hz-ctrl-comment').value || '').trim();
                    const _sdEl   = _ctrlOverlay.querySelector('#hz-ctrl-startdate');
                    const _ddEl   = _ctrlOverlay.querySelector('#hz-ctrl-deadline');
                    const _ibEl   = _ctrlOverlay.querySelector('#hz-ctrl-implementedby');

                    const ctrlPayload = { obj: {
                        RegOthHazTplID:       h.RegOthHazTplID || 0,
                        RegOthHazTplControlID: 0,
                        RegOthID:             state.regOthId,
                        ControlHeirarchy:     selectedHierarchy,
                        ControlCategory:      '',
                        ControlComment:       comment,
                        ControlDescription:   desc,
                        HazardTemplateDetID:  hazardInfo.hazardTemplateDetId || 0,
                        HazardTemplateID:     hazardInfo.hazardTemplateId    || 0,
                        Action:               'CREATE',
                        ByName:               CONFIG.userProfile.FullName || CONFIG.userName || '',
                        Type:                 'adhoc',
                        IsCurrentControl:     isCurrentCtrl,
                        StartDate:            _sdEl ? (_sdEl.value || null) : null,
                        EndDate:              _ddEl ? (_ddEl.value || null) : null,
                        ControlImplementorID: _ibEl ? (_ibEl.value || null) : null,
                        PriorityID:           null,
                        ControlGroups:        '',
                        RelativeStartDate:    0,
                        RelativeDeadline:     0
                    }};

                    const saveBtn = _ctrlOverlay.querySelector('#hz-ctrl-save');
                    saveBtn.textContent = 'Saving…';
                    saveBtn.disabled = true;
                    try {
                        const resp = await fetch(_ctrlBaseUrl + '/NetServices/POSTDynamicChecklist.asmx/RegisterControlUpsert', {
                            method: 'POST', credentials: 'include',
                            headers: { 'Content-Type': 'application/json; charset=utf-8' },
                            body: JSON.stringify(ctrlPayload)
                        });
                        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                        if (!Array.isArray(h.ControlResponses)) h.ControlResponses = [];
                        h.ControlResponses.push({ IsCurrentControl: isCurrentCtrl, ControlHeirarchy: selectedHierarchy, ControlDescription: desc });
                        if (isCurrentCtrl) h.CurCtrlCount = (h.CurCtrlCount || 0) + 1;
                        else               h.NewCtrlCount = (h.NewCtrlCount || 0) + 1;
                        const _oldCard = cardList.querySelector(`[data-hz-idx="${idx}"]`);
                        if (_oldCard) _oldCard.outerHTML = _buildHazardCard(h, idx);
                        _bindTableActions(cardList); // rebind after innerHTML change
                        // Refresh the existing controls list in the open panel
                        const _existingBox = _ctrlOverlay.querySelector('.hz-ctrl-existing-list');
                        if (_existingBox) {
                            const _refreshedCtrls = h.ControlResponses.filter(c => !!c.IsCurrentControl === isCurrentCtrl);
                            const _hierColorMap = { Elimination:'#7c3aed', Substitution:'#2563eb', Isolation:'#0891b2', Engineering:'#059669', Administrative:'#d97706', PPE:'#dc2626' };
                            _existingBox.innerHTML = _refreshedCtrls.map(c => {
                                const _h = c.ControlHeirarchy || c.ControlMeasureDesc || '';
                                const _d = c.ControlDescription || c.ControlText || '';
                                const _hc = _hierColorMap[_h] || '#6b7280';
                                return `<div style="display:flex;gap:8px;align-items:flex-start;padding:7px 0;border-bottom:1px solid #f3f4f6;">
                                    <span style="flex-shrink:0;font-size:10px;font-weight:600;padding:1px 6px;border-radius:4px;background:${_hc}1a;color:${_hc};margin-top:1px;">${escapeHtml(_h)}</span>
                                    <span style="font-size:12px;color:#374151;line-height:1.4;">${escapeHtml(_d)}</span>
                                </div>`;
                            }).join('') || '<p style="font-size:12px;color:#9ca3af;margin:0;">None recorded yet.</p>';
                        }
                        // Reset form
                        _ctrlOverlay.querySelector('#hz-ctrl-desc').value = '';
                        _ctrlOverlay.querySelector('#hz-ctrl-comment').value = '';
                        saveBtn.textContent = 'Save Control';
                        saveBtn.disabled = false;
                    } catch (err) {
                        saveBtn.textContent = 'Save Control';
                        saveBtn.disabled = false;
                        alert(`Save failed: ${err.message}`);
                    }
                });
            } else if (btn.classList.contains('hz-rating-btn')) {
                // Inline matrix picker — load matrix data if needed, show popup, save on select
                const type = btn.dataset.type; // 'raw' | 'cur' | 'res'
                const _effectiveMatrixId = hazardInfo.riskMatrixId || 37;
                if (!matrixRawData.length) {
                    try {
                        const _whsBase2 = CONFIG.apiUrl.replace(/\/affinda\/api\/chat-template.*$/i, '');
                        const _mRes  = await fetch(`${_whsBase2}/NetServices/DynamicChecklist.asmx/GetRiskMatrix?matrixId=${encodeURIComponent(_effectiveMatrixId)}`, { credentials: 'include' });
                        const _mJson = await _mRes.json();
                        matrixRawData = (_mJson && _mJson.d) ? _mJson.d : (Array.isArray(_mJson) ? _mJson : []);
                        console.log('[Hazard] GetRiskMatrix (on click) returned', matrixRawData.length, 'items for matrixId', _effectiveMatrixId);
                    } catch (_me) { console.warn('[Hazard] GetRiskMatrix inline error:', _me); return; }
                }
                if (!matrixRawData.length) { console.warn('[Hazard] matrix data empty for matrixId', _effectiveMatrixId); return; }
                const _mByType       = t => matrixRawData.filter(d => d.CodeType === t);
                const _mConsequences = _mByType('CONSEQUENCE').sort((a, b) => (a.DisplayOrder||0)-(b.DisplayOrder||0));
                const _mLikelihoods  = _mByType('LIKELIHOOD').sort((a, b) => (a.DisplayOrder||0)-(b.DisplayOrder||0));
                const _mCells        = _mByType('RISKMATRIX');
                const _mRatings      = _mByType('RISKRATING');
                function _mGetRInfo(cn) { const r = _mRatings.find(x => x.CodeName===cn); return { id: r?(r.CodeId||r.CodeValue||0):0, color: r?(r.BgColor||'#6b7280'):'#6b7280' }; }
                if (!_mLikelihoods.length || !_mConsequences.length) return;
                const _mTitle = type==='raw' ? 'Raw Risk Rating' : type==='cur' ? 'Current Risk Rating' : 'Res Risk Rating';
                let _mTbl = `<table style="border-collapse:separate;border-spacing:3px;font-size:12px;"><tr><td style="padding:6px 10px;font-size:10px;font-weight:600;color:#9ca3af;text-align:right;">Likelihood &darr;</td>`;
                _mConsequences.forEach(c => { _mTbl += `<td style="padding:8px 6px;text-align:center;font-weight:700;font-size:11px;background:${c.BgColor||'#6b7280'};color:white;border-radius:6px;min-width:72px;letter-spacing:0.3px;">${escapeHtml(c.CodeName)}</td>`; });
                _mTbl += `</tr>`;
                _mLikelihoods.forEach(l => {
                    _mTbl += `<tr><td style="padding:6px 14px;font-weight:700;font-size:11px;background:${l.BgColor||'#6b7280'};color:white;border-radius:6px;text-align:right;white-space:nowrap;letter-spacing:0.3px;">${escapeHtml(l.CodeName)}</td>`;
                    _mConsequences.forEach(c => {
                        // parseInt() normalises string/number type mismatch — same as legacy code
                        const _liId2 = parseInt(l.CodeId) || parseInt(l.CodeValue) || 0;
                        const _coId2 = parseInt(c.CodeId) || parseInt(c.CodeValue) || 0;
                        const _cell  = _mCells.find(m => parseInt(m.LikelihoodId) === _liId2 && parseInt(m.ConsequenceId) === _coId2);
                        const _cn   = _cell ? (_cell.CodeName||'') : '';
                        const _ri   = _mGetRInfo(_cn);
                        _mTbl += `<td class="hz-inline-cell" data-lid="${l.CodeId||l.CodeValue}" data-cid="${c.CodeId||c.CodeValue}" data-rid="${_ri.id}" data-rname="${escapeHtml(_cn)}" data-rbg="${_ri.color}" style="padding:10px 8px;text-align:center;background:${_ri.color};color:white;border-radius:6px;cursor:pointer;font-size:11px;font-weight:700;transition:transform 0.12s,box-shadow 0.12s;box-shadow:0 1px 3px rgba(0,0,0,0.15);" title="${escapeHtml(l.CodeName)} &times; ${escapeHtml(c.CodeName)} = ${escapeHtml(_cn)}">${escapeHtml(_cn)}</td>`;
                    });
                    _mTbl += `</tr>`;
                });
                _mTbl += `</table>`;
                const _mOverlay = document.createElement('div');
                _mOverlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:9000;display:flex;align-items:stretch;justify-content:flex-end;backdrop-filter:blur(2px);';
                _mOverlay.innerHTML = `<style>@keyframes hz-slide-in2{from{transform:translateX(100%)}to{transform:translateX(0)}}.hz-inline-drawer{animation:hz-slide-in2 0.28s cubic-bezier(.4,0,.2,1) both}.hz-inline-cell:hover{transform:scale(1.1);box-shadow:0 4px 14px rgba(0,0,0,0.28)!important;z-index:1;position:relative;}.hz-inline-close:hover{background:#f3f4f6!important;color:#111!important;}</style><div class="hz-inline-drawer" style="background:white;width:auto;max-width:95vw;height:100%;display:flex;flex-direction:column;box-shadow:-8px 0 40px rgba(0,0,0,0.18);"><div style="display:flex;align-items:center;justify-content:space-between;padding:20px 24px 12px;border-bottom:1px solid #f3f4f6;flex-shrink:0;"><div><div style="font-weight:800;font-size:15px;color:#1f2937;letter-spacing:-0.2px;">${escapeHtml(_mTitle)}</div><div style="font-size:12px;color:#9ca3af;margin-top:3px;">Click a cell to set the rating.</div></div><button class="hz-inline-close" style="background:none;border:none;font-size:22px;cursor:pointer;color:#6b7280;line-height:1;padding:4px 8px;border-radius:6px;transition:background 0.15s,color 0.15s;margin-left:16px;">&times;</button></div><div style="flex:1;overflow:auto;padding:20px 24px;">${_mTbl}</div></div>`;
                document.body.appendChild(_mOverlay);
                _mOverlay.querySelector('.hz-inline-close').addEventListener('click', () => _mOverlay.remove());
                _mOverlay.addEventListener('click', ev => { if (ev.target === _mOverlay) _mOverlay.remove(); });
                _mOverlay.querySelectorAll('.hz-inline-cell').forEach(cell => {
                    cell.addEventListener('click', async () => {
                        _mOverlay.remove();
                        const rName = cell.dataset.rname; const rColor = cell.dataset.rbg;
                        const rId = parseInt(cell.dataset.rid)||0;
                        const lid = parseInt(cell.dataset.lid)||0; const cid = parseInt(cell.dataset.cid)||0;
                        if (type==='raw')      { h.RawRiskRating=rName; h.RawBgColor=rColor; h.RawRiskRatingID=rId; h.RawLikelihoodID=lid; h.RawConsequenceID=cid; }
                        else if (type==='cur') { h.CurrentRiskRating=rName; h.CurrentBgColor=rColor; }
                        else                   { h.ResRiskRating=rName; h.ResBgColor=rColor; }
                        const _oldCard = cardList.querySelector(`[data-hz-idx="${idx}"]`);
                        if (_oldCard) _oldCard.outerHTML = _buildHazardCard(h, idx);
                        try {
                            const _saveUrl2 = CONFIG.apiUrl.replace(/\/affinda\/api\/chat-template.*$/i, '') + '/NetServices/POSTDynamicChecklist.asmx/RegisterHazardUpsert';
                            await fetch(_saveUrl2, { method:'POST', credentials:'include', headers:{'Content-Type':'application/json; charset=utf-8'},
                                body: JSON.stringify({ obj: { RegOthHazTplID:h.RegOthHazTplID||0, RegOthID:state.regOthId, RiskDescription:h.RiskDescription||'',
                                    ExposureFreqID:h.RawExposureFreqID||0, ExposurePossibilityID:h.RawLikelihoodID||0, ImpactLevelID:h.RawConsequenceID||0,
                                    RiskRatingID:h.RawRiskRatingID||0, RegOthHazTPLChemID:0, HazardType:h.HazardType||'', HazardTypeDetails:h.HazardTypeDetails||'',
                                    HazardDescription:h.HazardSource||'', ControlMeasures:h.ControlMeasures||'', NewControlMeasures:h.NewControlMeasures||'',
                                    StoreID:CONFIG.storeId, ByName:CONFIG.userProfile.FullName||CONFIG.userName,
                                    HazardTemplateDetID:hazardInfo.hazardTemplateDetId||0, HazardTemplateID:hazardInfo.hazardTemplateId||0,
                                    Action:'UPDATE', RiskMatrixID:hazardInfo.riskMatrixId||0, RegOthHazTempalteID:hazardInfo.regOthHazTempalteId||0, IsFreeForm:true }}) });
                        } catch (_se) { console.warn('[Hazard] inline rating save:', _se); }
                    });
                });
            } else if (btn.classList.contains('hz-edit-btn')) {
                _openPanel('edit', h, idx);
            } else if (btn.classList.contains('hz-copy-btn')) {
                _openPanel('copy', h, null);
            } else if (btn.classList.contains('hz-del-btn')) {
                if (!confirm('Delete this hazard?')) return;
                try {
                    const _delUrl = CONFIG.apiUrl.replace(/\/affinda\/api\/chat-template.*$/i, '') +
                        '/NetServices/POSTDynamicChecklist.asmx/RegisterHazardUpsert';
                    const resp = await fetch(_delUrl, {
                        method: 'POST', credentials: 'include',
                        headers: { 'Content-Type': 'application/json; charset=utf-8' },
                        body: JSON.stringify({ obj: {
                            RegOthHazTplID: h.RegOthHazTplID || 0,
                            RegOthID:       state.regOthId,
                            Action:         'DELETE',
                            StoreID:        CONFIG.storeId,
                            ByName:         CONFIG.userProfile.FullName || CONFIG.userName
                        }})
                    });
                    if (resp.ok) {
                        // Parse ASMX body — HTTP 200 can still mean failure
                        let delOk = true;
                        try {
                            const dj = await resp.json();
                            if (dj && dj.d !== undefined) {
                                if (typeof dj.d === 'boolean') delOk = dj.d;
                                else if (typeof dj.d === 'object' && dj.d !== null) delOk = dj.d.Success !== false;
                            }
                        } catch (_) {}
                        if (!delOk) { alert('Delete failed — please try again.'); return; }
                        existingHazardsList.splice(idx, 1);
                        const card = cardList.querySelector(`[data-hz-idx="${idx}"]`);
                        if (card) card.remove();
                        // Reindex remaining cards
                        cardList.querySelectorAll('[data-hz-idx]').forEach((r, i) => {
                            r.setAttribute('data-hz-idx', i);
                            r.querySelectorAll('.hz-act-btn').forEach(b => b.dataset.idx = i);
                        });
                        const badge = rowBody.querySelector('.hazard-existing-count');
                        if (badge) badge.textContent = existingHazardsList.length;
                    } else {
                        alert(`Delete failed (HTTP ${resp.status})`);
                    }
                } catch(err) { console.error('[Hazard] delete error', err); alert(`Delete error: ${err.message}`); }
            }
        });
    }

    // ── Hazard table refresh helpers ─────────────────────────────────────────
    function _mapHazardRow(h) {
        // ControlResponses is the legacy per-item controls array from the API
        const ctrlArr = Array.isArray(h.ControlResponses) ? h.ControlResponses : [];
        const curCtrlCount = ctrlArr.filter(c => c.IsCurrentControl === true).length
            || (h.ControlMeasures ? h.ControlMeasures.split('\n').filter(s => s.trim()).length : 0);
        const newCtrlCount = ctrlArr.filter(c => c.IsCurrentControl === false).length
            || (h.NewControlMeasures ? h.NewControlMeasures.split('\n').filter(s => s.trim()).length : 0);
        // If server omits the raw rating name/colour, look it up from the risk matrix by ID so we
        // never accidentally display the generic/current RiskRating as if it were the raw one.
        const _ratingById = (id) => {
            if (!id || !matrixRawData.length) return { name: '', color: '' };
            const r = matrixRawData.find(d => d.CodeType === 'RISKRATING' &&
                (String(d.CodeId) === String(id) || String(d.CodeValue) === String(id)));
            return r ? { name: r.CodeName || '', color: r.BgColor || '' } : { name: '', color: '' };
        };
        const rawId     = h.RawRiskRatingID || 0;
        const rawLookup = (rawId && (!h.RawRiskRating || !h.RawBgColor)) ? _ratingById(rawId) : null;
        return {
            RegOthHazTplID:     h.RegOthHazTplID || 0,
            HazardTypeDetails:  h.HazardTypeDetails || h.HazardTypeDetail || h.SubHazardType || h.HazardSubType || h.HazardDetail || '',
            HazardType:         h.HazardType || h.HazardCategory || '',
            HazardSource:       h.HazardSource || h.HazardDescription || h.HazardDesc || '',
            RiskDescription:    h.RiskDescription || '',
            RawRiskRating:      h.RawRiskRating  || (rawLookup ? rawLookup.name  : '') || '',
            RawBgColor:         h.RawBgColor     || (rawLookup ? rawLookup.color : '') || '',
            CurrentRiskRating:  h.CurrentRiskRating || '',
            CurrentBgColor:     h.CurrentBgColor || '',
            ResRiskRating:      h.ResRiskRating || '',
            ResBgColor:         h.ResBgColor || '',
            ControlMeasures:    h.ControlMeasures || '',
            NewControlMeasures: h.NewControlMeasures || '',
            CurCtrlCount:       curCtrlCount,
            NewCtrlCount:       newCtrlCount,
            ControlResponses:   Array.isArray(h.ControlResponses) ? h.ControlResponses : [],
            RawLikelihoodID:    h.RawLikelihoodID || 0,
            RawConsequenceID:   h.RawConsequenceID || 0,
            RawExposureFreqID:  h.RawExposureFreqID || 0,
            RawRiskRatingID:    h.RawRiskRatingID || 0
        };
    }

    function _refreshHazardTable(hazards) {
        existingHazardsList = hazards;
        const section = rowBody.querySelector('.hazard-existing-section');
        if (!section) return;
        section.style.cssText = 'margin-bottom:14px;';
        section.innerHTML = `
            <div style="font-weight:600;font-size:13px;color:#333;margin-bottom:8px;">
                Existing Hazards
                <span class="hazard-existing-count" style="background:#e5e7eb;border-radius:10px;padding:1px 8px;font-size:11px;font-weight:500;margin-left:5px;">${hazards.length}</span>
            </div>
            <div class="hazard-existing-list" style="display:flex;flex-direction:column;gap:8px;">${hazards.map(_buildHazardCard).join('')}</div>`;
        const cardList = section.querySelector('.hazard-existing-list');
        if (cardList) _bindTableActions(cardList);
    }

    async function _reloadHazards() {
        try {
            const _whsBase = CONFIG.apiUrl.replace(/\/affinda\/api\/chat-template.*$/i, '');
            const url = `${_whsBase}/NetServices/DynamicChecklist.asmx/GetHazards` +
                `?hazardTemplateDetId=${encodeURIComponent(hazardInfo.hazardTemplateDetId || 0)}` +
                `&regOthId=${encodeURIComponent(state.regOthId || 0)}` +
                `&regOthHazTempalteID=${encodeURIComponent(hazardInfo.regOthHazTempalteId || 0)}`;
            const res  = await fetch(url, { credentials: 'include' });
            const json = await res.json();
            const arr  = (json && json.d) ? json.d : (Array.isArray(json) ? json : []);
            _refreshHazardTable(arr.map(_mapHazardRow));
        } catch (_e) { console.warn('[Hazard] reload error:', _e); }
    }

    // ── Register form builder ──────────────────────────────────────────────────
    function _buildRegisterForm(saveBtnLabel) {
        saveBtnLabel = saveBtnLabel || 'Save Hazard';
        const raBtnLabel = showRA ? '<span style="font-size:11px;color:#6b7280;">(click to set)</span>' : '';
        return `
            <div class="hz-ai-section" style="margin-bottom:14px;padding:14px;background:#f0f7ff;border-radius:8px;border:1px solid #bfdbfe;">
                <div style="font-weight:600;font-size:13px;color:#1d4ed8;margin-bottom:8px;">&#10024; AI Assist &mdash; describe the hazard</div>
                <textarea class="hz-ai-input" rows="3" placeholder="e.g. Cuts, crush injuries from manual harvesting or using equipment..."
                    style="width:100%;padding:10px;border:1px solid #bfdbfe;border-radius:6px;font-size:13px;resize:vertical;font-family:inherit;box-sizing:border-box;background:white;"></textarea>
                <div style="display:flex;gap:10px;margin-top:8px;align-items:center;">
                    <button class="hz-ai-fill-btn" type="button"
                        style="padding:7px 16px;background:#3B98F1;color:white;border:none;border-radius:6px;cursor:pointer;font-weight:600;font-size:13px;">&#10024; Fill with AI</button>
                    <span class="hz-ai-status" style="font-size:12px;color:#6b7280;display:none;"></span>
                </div>
            </div>
            <hr style="border:none;border-top:1px solid #e5e7eb;margin:0 0 14px 0;">
            <div style="margin-bottom:10px;">
                <label style="font-weight:600;font-size:13px;color:#333;display:block;margin-bottom:4px;">Hazard Type <span style="color:#dc3545;">*</span></label>
                <div style="position:relative;">
                    <input type="text" class="hazardType chat-floating-input" autocomplete="off" placeholder="Loading...">
                    <input type="hidden" class="hazardTypeValue">
                    <div class="hazardTypeDd chat-floating-dd" style="display:none;"></div>
                </div>
            </div>
            <div style="margin-bottom:10px;">
                <label style="font-weight:600;font-size:13px;color:#333;display:block;margin-bottom:4px;">Hazard <span style="color:#dc3545;">*</span></label>
                <div style="position:relative;">
                    <input type="text" class="hazardTypeDetails chat-floating-input" autocomplete="off" placeholder="Select Hazard Type first..." disabled>
                    <input type="hidden" class="hazardTypeDetailsValue">
                    <div class="hazardDetailsDd chat-floating-dd" style="display:none;"></div>
                </div>
            </div>
            <div style="margin-bottom:10px;">
                <label style="font-weight:600;font-size:13px;color:#333;display:block;margin-bottom:4px;">Hazard Source</label>
                <input type="text" class="hazardSource" placeholder="e.g. Equipment, Environment, People, Process..."
                    style="width:100%;padding:10px;border:1px solid #e5e7eb;border-radius:6px;font-size:14px;box-sizing:border-box;">
            </div>
            <div style="margin-bottom:10px;">
                <label style="font-weight:600;font-size:13px;color:#333;display:block;margin-bottom:4px;">Risk Description</label>
                <textarea class="hazardRiskDesc" rows="3" placeholder="Describe the risk associated with this hazard..."
                    style="width:100%;padding:10px;border:1px solid #e5e7eb;border-radius:6px;font-size:14px;resize:vertical;font-family:inherit;box-sizing:border-box;"></textarea>
            </div>
            ${showControl ? `
            <div style="margin-bottom:10px;">
                <label style="font-weight:600;font-size:13px;color:#333;display:block;margin-bottom:4px;">Control Measures</label>
                <textarea class="hazardControl" rows="2" placeholder="Describe control measures..."
                    style="width:100%;padding:10px;border:1px solid #e5e7eb;border-radius:6px;font-size:14px;resize:vertical;font-family:inherit;box-sizing:border-box;"></textarea>
            </div>` : ''}
            ${showCurRA ? `
            <div style="margin-bottom:12px;">
                <label style="font-weight:600;font-size:13px;color:#333;display:block;margin-bottom:6px;">Current Rating <span style="font-size:11px;color:#6b7280;">(click to set)</span></label>
                <button type="button" class="hz-cur-matrix-btn"
                    style="padding:8px 16px;font-size:13px;font-weight:600;color:white;background:#6b7280;border:none;border-radius:6px;cursor:pointer;min-width:130px;">
                    Select Current Rating
                </button>
                <input type="hidden" class="hazardCurRatingName" value="">
                <input type="hidden" class="hazardCurRatingColor" value="">
                <input type="hidden" class="hazardCurRatingId" value="">
            </div>` : ''}
            ${showNewControl ? `
            <div style="margin-bottom:10px;">
                <label style="font-weight:600;font-size:13px;color:#333;display:block;margin-bottom:4px;">New Controls</label>
                <textarea class="hazardNewControl" rows="2" placeholder="Describe any new controls..."
                    style="width:100%;padding:10px;border:1px solid #e5e7eb;border-radius:6px;font-size:14px;resize:vertical;font-family:inherit;box-sizing:border-box;"></textarea>
            </div>` : ''}
            ${showResRA ? `
            <div style="margin-bottom:12px;">
                <label style="font-weight:600;font-size:13px;color:#333;display:block;margin-bottom:6px;">Res Risk Rating <span style="font-size:11px;color:#6b7280;">(click to set)</span></label>
                <button type="button" class="hz-res-matrix-btn"
                    style="padding:8px 16px;font-size:13px;font-weight:600;color:white;background:#6b7280;border:none;border-radius:6px;cursor:pointer;min-width:130px;">
                    Select Res Rating
                </button>
                <input type="hidden" class="hazardResRatingName" value="">
                <input type="hidden" class="hazardResRatingColor" value="">
                <input type="hidden" class="hazardResRatingId" value="">
            </div>` : ''}
            ${showRA ? `
            <div style="margin-bottom:12px;">
                <label style="font-weight:600;font-size:13px;color:#333;display:block;margin-bottom:6px;">Risk Rating ${raBtnLabel}</label>
                <button type="button" class="hz-matrix-btn"
                    style="padding:8px 16px;font-size:13px;font-weight:600;color:white;background:#6b7280;border:none;border-radius:6px;cursor:pointer;min-width:130px;">
                    Select Risk Rating
                </button>
                <input type="hidden" class="hazardLikelihoodId" value="">
                <input type="hidden" class="hazardConsequenceId" value="">
                <input type="hidden" class="hazardExposureFreqId" value="">
                <input type="hidden" class="hazardRiskRatingId" value="">
                <input type="hidden" class="hazardRiskRatingName" value="">
                <input type="hidden" class="hazardRiskRatingColor" value="">
            </div>` : `
            <input type="hidden" class="hazardLikelihoodId" value="">
            <input type="hidden" class="hazardConsequenceId" value="">
            <input type="hidden" class="hazardExposureFreqId" value="">
            <input type="hidden" class="hazardRiskRatingId" value="">
            <input type="hidden" class="hazardRiskRatingName" value="">
            <input type="hidden" class="hazardRiskRatingColor" value="">`}
            <div style="display:flex;gap:8px;">
                <button class="hazardSaveBtn" style="padding:8px 18px;background:#3B98F1;color:white;border:none;border-radius:6px;cursor:pointer;font-weight:500;font-size:14px;">${saveBtnLabel}</button>
            </div>
            <div class="hazardSaveProgress" style="margin-top:8px;display:none;color:#6b7280;font-size:13px;"></div>`;
    }

    // ── Risk matrix button popup (generic) ─────────────────────────────────────
    // cfg: { btnSel, nameSel, colorSel, idSel, title }
    function _bindMatrixButton(matrixData, ctx, cfg) {
        cfg = cfg || { btnSel: '.hz-matrix-btn', nameSel: '.hazardRiskRatingName', colorSel: '.hazardRiskRatingColor', idSel: '.hazardRiskRatingId', title: 'Select Risk Rating' };
        const btn = ctx.querySelector(cfg.btnSel);
        if (!btn || !matrixData.length) return;

        const byType       = t => matrixData.filter(d => d.CodeType === t);
        const consequences = byType('CONSEQUENCE').sort((a, b) => (a.DisplayOrder || 0) - (b.DisplayOrder || 0));
        const likelihoods  = byType('LIKELIHOOD').sort((a, b) => (a.DisplayOrder || 0) - (b.DisplayOrder || 0));
        const cells        = byType('RISKMATRIX');
        const ratings      = byType('RISKRATING');

        // DEBUG: log matrix data shape so cell matching can be verified in console
        console.log('[Matrix] Setup - LIKELIHOOD[0]:', likelihoods[0] && JSON.stringify({CodeId:likelihoods[0].CodeId,CodeValue:likelihoods[0].CodeValue,n:likelihoods[0].CodeName}), 'RISKMATRIX[0]:', cells[0] && JSON.stringify({LId:cells[0].LikelihoodId,CId:cells[0].ConsequenceId,n:cells[0].CodeName}));

        function _getRInfo(codeName) {
            const r = ratings.find(x => x.CodeName === codeName);
            return { id: r ? (r.CodeId || r.CodeValue || 0) : 0, color: r ? (r.BgColor || '#6b7280') : '#6b7280' };
        }

        if (!likelihoods.length || !consequences.length) return;

        btn.addEventListener('click', () => {
            const overlay = document.createElement('div');
            overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:9000;display:flex;align-items:stretch;justify-content:flex-end;backdrop-filter:blur(2px);';

            let tbl = `<table style="border-collapse:separate;border-spacing:3px;font-size:12px;width:auto;">`;
            // corner cell + consequence header
            tbl += `<tr><td style="padding:6px 10px;font-size:10px;font-weight:600;color:#9ca3af;text-align:right;">Likelihood &darr;</td>`;
            consequences.forEach(c => {
                const bg = c.BgColor || '#6b7280';
                tbl += `<td style="padding:8px 6px;text-align:center;font-weight:700;font-size:11px;background:${bg};color:white;border-radius:6px;min-width:72px;letter-spacing:0.3px;">${escapeHtml(c.CodeName)}</td>`;
            });
            tbl += `</tr>`;
            likelihoods.forEach(l => {
                const lBg = l.BgColor || '#6b7280';
                tbl += `<tr><td style="padding:6px 14px;font-weight:700;font-size:11px;background:${lBg};color:white;border-radius:6px;text-align:right;white-space:nowrap;letter-spacing:0.3px;">${escapeHtml(l.CodeName)}</td>`;
                consequences.forEach(c => {
                    // Use parseInt() on both sides — matches legacy dynamic.checklist.v4.js approach
                    // which uses: n.LikelihoodId === parseInt(likelihood) — normalises string/number mismatch
                    const _liId    = parseInt(l.CodeId) || parseInt(l.CodeValue) || 0;
                    const _coId    = parseInt(c.CodeId) || parseInt(c.CodeValue) || 0;
                    const cell     = cells.find(m => parseInt(m.LikelihoodId) === _liId && parseInt(m.ConsequenceId) === _coId);
                    const cellName = cell ? (cell.CodeName || '') : '';
                    const rInfo    = _getRInfo(cellName);
                    tbl += `<td class="hz-matrix-cell"
                        data-lid="${l.CodeId || l.CodeValue}" data-cid="${c.CodeId || c.CodeValue}"
                        data-rid="${rInfo.id}" data-rname="${escapeHtml(cellName)}" data-rbg="${rInfo.color}"
                        style="padding:10px 8px;text-align:center;background:${rInfo.color};color:white;border-radius:6px;cursor:pointer;font-size:11px;font-weight:700;transition:transform 0.12s,box-shadow 0.12s;box-shadow:0 1px 3px rgba(0,0,0,0.15);"
                        title="${escapeHtml(l.CodeName)} &times; ${escapeHtml(c.CodeName)} = ${escapeHtml(cellName)}">${escapeHtml(cellName)}</td>`;
                });
                tbl += `</tr>`;
            });
            tbl += `</table>`;

            overlay.innerHTML = `
                <style>
                  @keyframes hz-slide-in { from { transform:translateX(100%); } to { transform:translateX(0); } }
                  .hz-matrix-drawer { animation: hz-slide-in 0.28s cubic-bezier(.4,0,.2,1) both; }
                  .hz-matrix-cell:hover { transform:scale(1.1); box-shadow:0 4px 14px rgba(0,0,0,0.28)!important; z-index:1; position:relative; }
                  .hz-matrix-close:hover { background:#f3f4f6!important; color:#111!important; }
                </style>
                <div class="hz-matrix-drawer" style="background:white;width:auto;max-width:95vw;height:100%;display:flex;flex-direction:column;box-shadow:-8px 0 40px rgba(0,0,0,0.18);">
                    <div style="display:flex;align-items:center;justify-content:space-between;padding:20px 24px 12px;border-bottom:1px solid #f3f4f6;flex-shrink:0;">
                        <div>
                            <div style="font-weight:800;font-size:15px;color:#1f2937;letter-spacing:-0.2px;">${escapeHtml(cfg.title)}</div>
                            <div style="font-size:12px;color:#9ca3af;margin-top:3px;">Click a cell to set the rating.</div>
                        </div>
                        <button class="hz-matrix-close" style="background:none;border:none;font-size:22px;cursor:pointer;color:#6b7280;line-height:1;padding:4px 8px;border-radius:6px;transition:background 0.15s,color 0.15s;margin-left:16px;">&times;</button>
                    </div>
                    <div style="flex:1;overflow:auto;padding:20px 24px;">
                        ${tbl}
                    </div>
                </div>`;

            document.body.appendChild(overlay);

            overlay.querySelector('.hz-matrix-close').addEventListener('click', () => overlay.remove());
            overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

            overlay.querySelectorAll('.hz-matrix-cell').forEach(cell => {
                cell.addEventListener('click', () => {
                    const rName  = cell.dataset.rname;
                    const rColor = cell.dataset.rbg;
                    if (cfg.nameSel)  ctx.querySelector(cfg.nameSel).value  = rName;
                    if (cfg.colorSel) ctx.querySelector(cfg.colorSel).value = rColor;
                    if (cfg.idSel)    ctx.querySelector(cfg.idSel).value    = cell.dataset.rid;
                    // Raw only: also store lid/cid
                    if (cfg.lidSel)   ctx.querySelector(cfg.lidSel).value   = cell.dataset.lid;
                    if (cfg.cidSel)   ctx.querySelector(cfg.cidSel).value   = cell.dataset.cid;
                    btn.textContent      = rName || cfg.title;
                    btn.style.background = rColor || '#6b7280';
                    overlay.remove();
                });
            });
        });
    }

    function _bindForm(ctx, mode, editHazard, editIdx) {
        mode = mode || 'add';
        const saveBtn  = ctx.querySelector('.hazardSaveBtn');
        const progress = ctx.querySelector('.hazardSaveProgress');

        saveBtn.onclick = async () => {
            const typeEl       = ctx.querySelector('.hazardType');
            const typeValEl    = ctx.querySelector('.hazardTypeValue');
            const detailsEl    = ctx.querySelector('.hazardTypeDetails');
            const detailsValEl = ctx.querySelector('.hazardTypeDetailsValue');
            const sourceEl     = ctx.querySelector('.hazardSource');
            const riskDescEl   = ctx.querySelector('.hazardRiskDesc');
            const controlEl    = ctx.querySelector('.hazardControl');
            const newControlEl = ctx.querySelector('.hazardNewControl');

            const hazardType        = (typeValEl    && typeValEl.value.trim())    ? typeValEl.value.trim()    : (typeEl    ? typeEl.value.trim()    : '');
            const hazardTypeDetails = (detailsValEl && detailsValEl.value.trim()) ? detailsValEl.value.trim() : (detailsEl ? detailsEl.value.trim() : '');

            if (!hazardType) {
                if (typeEl) { typeEl.style.borderColor = '#dc3545'; setTimeout(() => typeEl.style.borderColor = '#e5e7eb', 1500); }
                return;
            }
            if (!hazardTypeDetails) {
                if (detailsEl) { detailsEl.style.borderColor = '#dc3545'; setTimeout(() => detailsEl.style.borderColor = '#e5e7eb', 1500); }
                return;
            }

            try {
                saveBtn.disabled = true; saveBtn.style.opacity = '0.6';
                progress.style.display = 'block'; progress.textContent = 'Saving hazard...';

                const isEdit = (mode === 'edit');
                const _saveUrl = CONFIG.apiUrl.replace(/\/affinda\/api\/chat-template.*$/i, '') +
                    '/NetServices/POSTDynamicChecklist.asmx/RegisterHazardUpsert';
                const resp = await fetch(_saveUrl, {
                    method: 'POST', credentials: 'include',
                    headers: { 'Content-Type': 'application/json; charset=utf-8' },
                    body: JSON.stringify({ obj: {
                        RegOthHazTplID:        isEdit ? (editHazard.RegOthHazTplID || 0) : 0,
                        RegOthID:              state.regOthId,
                        RiskDescription:       riskDescEl ? riskDescEl.value.trim() : '',
                        ExposureFreqID:        parseInt(ctx.querySelector('.hazardExposureFreqId') ? ctx.querySelector('.hazardExposureFreqId').value : 0) || 0,
                        ExposurePossibilityID: parseInt(ctx.querySelector('.hazardLikelihoodId').value) || 0,
                        ImpactLevelID:         parseInt(ctx.querySelector('.hazardConsequenceId').value) || 0,
                        RiskRatingID:          parseInt(ctx.querySelector('.hazardRiskRatingId').value) || 0,
                        RegOthHazTPLChemID:    0,
                        HazardType:            hazardType,
                        HazardTypeDetails:     hazardTypeDetails,
                        HazardDescription:     sourceEl ? sourceEl.value.trim() : '',
                        ControlMeasures:       controlEl    ? controlEl.value.trim()    : '',
                        NewControlMeasures:    newControlEl ? newControlEl.value.trim() : '',
                        StoreID:               CONFIG.storeId,
                        ByName:                CONFIG.userProfile.FullName || CONFIG.userName,
                        HazardTemplateDetID:   hazardInfo.hazardTemplateDetId || 0,
                        HazardTemplateID:      hazardInfo.hazardTemplateId || 0,
                        Action:                isEdit ? 'UPDATE' : 'CREATE',
                        RiskMatrixID:          hazardInfo.riskMatrixId || 0,
                        RegOthHazTempalteID:   hazardInfo.regOthHazTempalteId || 0,
                        IsFreeForm:            true
                    }})
                });

                if (resp.ok) {
                    progress.textContent = isEdit ? 'Hazard updated' : 'Hazard saved'; progress.style.color = '#198754';
                    const cardList = rowBody.querySelector('.hazard-existing-list');
                    // Try to capture server-returned ID for newly created hazards
                    let serverReturnedId = 0;
                    if (!isEdit) {
                        try {
                            const rj = await resp.clone().json();
                            serverReturnedId = (rj && rj.d && rj.d.RegOthHazTplID) ? rj.d.RegOthHazTplID
                                            : (rj && rj.d && !isNaN(rj.d))           ? parseInt(rj.d) : 0;
                        } catch(_) {}
                    }
                    const ratingName  = (ctx.querySelector('.hazardRiskRatingName')  || {}).value || '';
                    const ratingColor = (ctx.querySelector('.hazardRiskRatingColor') || {}).value || '#6b7280';
                    const curRatingName  = (ctx.querySelector('.hazardCurRatingName')  || {}).value || (isEdit ? editHazard.CurrentRiskRating || '' : '');
                    const curRatingColor = (ctx.querySelector('.hazardCurRatingColor') || {}).value || (isEdit ? editHazard.CurrentBgColor    || '' : '');
                    const resRatingName  = (ctx.querySelector('.hazardResRatingName')  || {}).value || (isEdit ? editHazard.ResRiskRating     || '' : '');
                    const resRatingColor = (ctx.querySelector('.hazardResRatingColor') || {}).value || (isEdit ? editHazard.ResBgColor         || '' : '');
                    const newH = {
                        RegOthHazTplID:    isEdit ? (editHazard.RegOthHazTplID || 0) : (serverReturnedId || 0),
                        HazardTypeDetails: hazardTypeDetails,
                        HazardType:        hazardType,
                        HazardSource:      sourceEl ? sourceEl.value.trim() : '',
                        RiskDescription:   riskDescEl ? riskDescEl.value.trim() : '',
                        RawRiskRating:     ratingName,
                        RawBgColor:        ratingColor,
                        CurrentRiskRating: curRatingName,
                        CurrentBgColor:    curRatingColor,
                        ResRiskRating:     resRatingName,
                        ResBgColor:        resRatingColor,
                        ControlMeasures:   controlEl    ? controlEl.value.trim()    : '',
                        NewControlMeasures:newControlEl ? newControlEl.value.trim() : '',
                        RawLikelihoodID:   parseInt(ctx.querySelector('.hazardLikelihoodId').value) || 0,
                        RawConsequenceID:  parseInt(ctx.querySelector('.hazardConsequenceId').value) || 0,
                        RawExposureFreqID: parseInt((ctx.querySelector('.hazardExposureFreqId') || {}).value) || (isEdit ? (editHazard.RawExposureFreqID || 0) : 0),
                        RawRiskRatingID:   parseInt(ctx.querySelector('.hazardRiskRatingId').value) || 0
                    };
                    if (cardList) {
                        if (isEdit && editIdx != null) {
                            // Replace existing card
                            existingHazardsList[editIdx] = newH;
                            const oldCard = cardList.querySelector(`[data-hz-idx="${editIdx}"]`);
                            if (oldCard) oldCard.outerHTML = _buildHazardCard(newH, editIdx);
                        } else {
                            const newIdx = existingHazardsList.length;
                            existingHazardsList.push(newH);
                            cardList.insertAdjacentHTML('beforeend', _buildHazardCard(newH, newIdx));
                            // No _bindTableActions call — event delegation already on cardList
                        }
                        const countBadge = rowBody.querySelector('.hazard-existing-count');
                        if (countBadge) countBadge.textContent = existingHazardsList.length;
                    }
                    // Close panel — user clicks  Done button to finish the hazard section
                    setTimeout(() => { if (panelEl) { panelEl.remove(); panelEl = null; } }, 800);
                    return;
                } else {
                    progress.textContent = `Save failed (HTTP ${resp.status})`; progress.style.color = '#dc3545';
                    saveBtn.disabled = false; saveBtn.style.opacity = '1'; return;
                }
            } catch (err) {
                progress.textContent = `Error: ${err.message}`; progress.style.color = '#dc3545';
                saveBtn.disabled = false; saveBtn.style.opacity = '1'; return;
            }
        };
    }

    // ── Tab 2: Add from Site Risk Assessment ─────────────────────────────
    function _renderSRA(pane, allHazards) {
        let filteredHazards = allHazards.slice();
        let selectedIds     = new Set();
        let pageSize        = 10;
        let currentPage     = 1;
        let showSelected    = false;

        function _getDisplayList() {
            return showSelected ? filteredHazards.filter(h => selectedIds.has(h.RRRAID)) : filteredHazards;
        }

        function _renderTable() {
            const list       = _getDisplayList();
            const totalPages = Math.ceil(list.length / pageSize) || 1;
            const page       = list.slice((currentPage - 1) * pageSize, currentPage * pageSize);

            const selCount = pane.querySelector('.sra-sel-count');
            if (selCount) selCount.textContent = `${selectedIds.size} item(s) selected`;

            const addBtn = pane.querySelector('.sra-add-btn');
            if (addBtn) { addBtn.textContent = `Add ${selectedIds.size} Selected`; addBtn.disabled = selectedIds.size === 0; addBtn.style.opacity = selectedIds.size === 0 ? '0.5' : '1'; }

            const tbody = pane.querySelector('.sra-tbody');
            if (!tbody) return;
            tbody.innerHTML = page.map(h => {
                const checked  = selectedIds.has(h.RRRAID) ? 'checked' : '';
                const rawColor = h.RawBGColor || '#6b7280';
                const resColor = h.ResBGColor || '#6b7280';
                return `<tr data-id="${h.RRRAID}" style="border-bottom:1px solid #f0f0f0;">
                    <td style="padding:8px 6px;width:32px;"><input type="checkbox" class="sra-chk" data-id="${h.RRRAID}" ${checked} style="cursor:pointer;width:16px;height:16px;"></td>
                    <td style="padding:8px 6px;font-size:13px;color:#333;">${escapeHtml(h.HazardFullDesc || '')}</td>
                    <td style="padding:8px 6px;text-align:center;white-space:nowrap;">
                        ${h.RawCodeName ? `<span style="font-size:11px;font-weight:600;color:white;background:${rawColor};padding:2px 8px;border-radius:10px;">${escapeHtml(h.RawCodeName)}</span>` : '-'}
                    </td>
                    <td style="padding:8px 6px;text-align:center;white-space:nowrap;">
                        ${h.ResCodeName ? `<span style="font-size:11px;font-weight:600;color:white;background:${resColor};padding:2px 8px;border-radius:10px;">${escapeHtml(h.ResCodeName)}</span>` : '-'}
                    </td>
                </tr>`;
            }).join('');

            tbody.querySelectorAll('.sra-chk').forEach(chk => {
                chk.addEventListener('change', () => {
                    const id = parseInt(chk.dataset.id);
                    if (chk.checked) selectedIds.add(id); else selectedIds.delete(id);
                    _renderTable();
                });
            });

            const pageInfo = pane.querySelector('.sra-page-info');
            if (pageInfo) pageInfo.textContent = `${currentPage} of ${totalPages}`;
            const prevBtn = pane.querySelector('.sra-prev');
            const nextBtn = pane.querySelector('.sra-next');
            if (prevBtn) prevBtn.disabled = currentPage <= 1;
            if (nextBtn) nextBtn.disabled = currentPage >= totalPages;
        }

        pane.innerHTML = `
            <div style="margin-bottom:10px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                <span class="sra-sel-count" style="background:#e5e7eb;border-radius:10px;padding:3px 10px;font-size:12px;font-weight:500;color:#333;">0 item(s) selected</span>
                <button class="sra-unselect-btn" style="padding:4px 12px;border:1px solid #e5e7eb;background:white;border-radius:6px;cursor:pointer;font-size:12px;color:#6b7280;">Unselect all</button>
                <label style="display:flex;align-items:center;gap:5px;font-size:12px;color:#6b7280;cursor:pointer;">
                    <input type="checkbox" class="sra-show-selected"> Show selected
                </label>
                <button class="sra-add-btn" disabled style="margin-left:auto;padding:6px 16px;background:#3B98F1;color:white;border:none;border-radius:6px;cursor:pointer;font-weight:500;font-size:13px;opacity:0.5;">Add 0 Selected</button>
            </div>
            <input type="text" class="sra-search" placeholder="Search hazards..." autocomplete="off"
                style="width:100%;padding:8px 10px;border:1px solid #e5e7eb;border-radius:6px;font-size:13px;box-sizing:border-box;margin-bottom:10px;">
            <div style="overflow-x:auto;">
                <table style="width:100%;border-collapse:collapse;">
                    <thead>
                        <tr style="border-bottom:2px solid #e5e7eb;background:#f9fafb;">
                            <th style="padding:8px 6px;width:32px;"></th>
                            <th style="padding:8px 6px;font-size:12px;font-weight:600;color:#374151;text-align:left;">Hazard Details</th>
                            <th style="padding:8px 6px;font-size:12px;font-weight:600;color:#374151;text-align:center;white-space:nowrap;">Risk Rating</th>
                            <th style="padding:8px 6px;font-size:12px;font-weight:600;color:#374151;text-align:center;white-space:nowrap;">Res Risk Rating</th>
                        </tr>
                    </thead>
                    <tbody class="sra-tbody"></tbody>
                </table>
            </div>
            <div style="overflow-x:auto;display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:10px;">
                <span style="font-size:12px;color:#6b7280;">Show</span>
                <select class="sra-page-size" style="padding:4px 6px;border:1px solid #e5e7eb;border-radius:4px;font-size:12px;">
                    <option>10</option><option>25</option><option>50</option>
                </select>
                <span style="font-size:12px;color:#6b7280;">Rows</span>
                <button class="sra-prev" style="padding:4px 10px;border:1px solid #e5e7eb;background:white;border-radius:4px;cursor:pointer;font-size:12px;">Previous</button>
                <span class="sra-page-info" style="font-size:12px;color:#6b7280;">1 of 1</span>
                <button class="sra-next" style="padding:4px 10px;border:1px solid #e5e7eb;background:white;border-radius:4px;cursor:pointer;font-size:12px;">Next</button>
            </div>
            <div class="sra-save-progress" style="margin-top:8px;display:none;font-size:13px;color:#6b7280;"></div>`;

        _renderTable();

        pane.querySelector('.sra-search').addEventListener('input', e => {
            const term = e.target.value.trim().toLowerCase();
            filteredHazards = term ? allHazards.filter(h => (h.HazardFullDesc || '').toLowerCase().includes(term)) : allHazards.slice();
            currentPage = 1; _renderTable();
        });
        pane.querySelector('.sra-show-selected').addEventListener('change', e => { showSelected = e.target.checked; currentPage = 1; _renderTable(); });
        pane.querySelector('.sra-unselect-btn').addEventListener('click', () => { selectedIds.clear(); _renderTable(); });
        pane.querySelector('.sra-page-size').addEventListener('change', e => { pageSize = parseInt(e.target.value); currentPage = 1; _renderTable(); });
        pane.querySelector('.sra-prev').addEventListener('click', () => { if (currentPage > 1) { currentPage--; _renderTable(); } });
        pane.querySelector('.sra-next').addEventListener('click', () => {
            const total = Math.ceil(_getDisplayList().length / pageSize);
            if (currentPage < total) { currentPage++; _renderTable(); }
        });

        pane.querySelector('.sra-add-btn').addEventListener('click', async () => {
            if (!selectedIds.size) return;
            const addBtn = pane.querySelector('.sra-add-btn');
            const prog   = pane.querySelector('.sra-save-progress');
            addBtn.disabled = true; addBtn.style.opacity = '0.6';
            prog.style.display = 'block'; prog.textContent = 'Saving...'; prog.style.color = '#6b7280';
            try {
                const _whsBase = CONFIG.apiUrl.replace(/\/affinda\/api\/chat-template.*$/i, '');
                const resp = await fetch(`${_whsBase}/NetServices/PostDynamicChecklist.asmx/spChecklistCreateHazardsFromRegister`, {
                    method: 'POST', credentials: 'include',
                    headers: { 'Content-Type': 'application/json; charset=utf-8' },
                    body: JSON.stringify({ data: {
                        ListOfRRAID:         [...selectedIds],
                        RiskMatrixID:        hazardInfo.riskMatrixId || 0,
                        HazardTemplateDetID: hazardInfo.hazardTemplateDetId || 0,
                        RegOthHazTempalteID: hazardInfo.regOthHazTempalteId || 0,
                        RegOthID:            state.regOthId,
                        HazardTemplateID:    hazardInfo.hazardTemplateId || 0
                    }})
                });
                if (resp.ok) {
                    prog.textContent = `${selectedIds.size} hazard(s) added`; prog.style.color = '#198754';
                    setTimeout(async () => {
                        if (panelEl) { panelEl.remove(); panelEl = null; }
                        await _reloadHazards();
                        scrollToBottom();
                    }, 800);
                } else {
                    prog.textContent = `Save failed (HTTP ${resp.status})`; prog.style.color = '#dc3545';
                    addBtn.disabled = false; addBtn.style.opacity = '1';
                }
            } catch (err) {
                prog.textContent = `Error: ${err.message}`; prog.style.color = '#dc3545';
                addBtn.disabled = false; addBtn.style.opacity = '1';
            }
        });
    }

    async function _loadSRA(pane) {
        const _whsBase = CONFIG.apiUrl.replace(/\/affinda\/api\/chat-template.*$/i, '');
        try {
            pane.innerHTML = '<div style="color:#6b7280;font-size:13px;padding:12px 0;">Loading site risk assessments...</div>';
            const raRes  = await fetch(`${_whsBase}/NetServices/POSTDynamicChecklist.asmx/spGetRiskAssessmentFromRegisterByStoreID`, {
                method: 'POST', credentials: 'include',
                headers: { 'Content-Type': 'application/json; charset=utf-8' },
                body: JSON.stringify({ RiskMatrixID: hazardInfo.riskMatrixId || 0 })
            });
            const raJson = await raRes.json();
            const raList = (raJson && raJson.d) ? raJson.d : [];

            if (!raList.length) {
                pane.innerHTML = '<div style="color:#6b7280;font-size:13px;padding:12px 0;">No site risk assessments available.</div>';
                return;
            }

            const allRiskRegIDs = raList.map(r => r.RiskRegID).filter(Boolean);
            const hRes  = await fetch(`${_whsBase}/NetServices/PostDynamicChecklist.asmx/spGetRiskRegisterHazards`, {
                method: 'POST', credentials: 'include',
                headers: { 'Content-Type': 'application/json; charset=utf-8' },
                body: JSON.stringify({ data: {
                    ListOfRiskRegID:     allRiskRegIDs,
                    RiskMatrixID:        hazardInfo.riskMatrixId || 0,
                    HazardTemplateDetID: hazardInfo.hazardTemplateDetId || 0,
                    IsFromChecklist:     true
                }})
            });
            const hJson = await hRes.json();
            const allHazards = (hJson && hJson.d) ? hJson.d : [];

            if (!allHazards.length) {
                pane.innerHTML = '<div style="color:#6b7280;font-size:13px;padding:12px 0;">No hazards found in site risk assessments.</div>';
                return;
            }
            _renderSRA(pane, allHazards);
            scrollToBottom();
        } catch (e) {
            console.warn('[Hazard] SRA load error:', e);
            pane.innerHTML = '<div style="color:#dc3545;font-size:13px;padding:12px 0;">Failed to load site risk assessments.</div>';
        }
    }

    function _bindTabs(ctx) {
        let sraLoaded = false;
        ctx.querySelectorAll('.hz-tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                rowBody.querySelectorAll('.hz-tab-btn').forEach(b => { b.style.cssText = TAB_STYLE_INACTIVE; });
                btn.style.cssText = TAB_STYLE_ACTIVE;
                const tab = btn.dataset.tab;
                ctx.querySelectorAll('.hz-pane').forEach(p => p.style.display = 'none');
                const pane = ctx.querySelector(`#hz-pane-${tab}`);
                if (pane) pane.style.display = 'block';
                if (tab === 'sra' && !sraLoaded) { sraLoaded = true; _loadSRA(pane); }
            });
        });
    }

    // ── Panel state ───────────────────────────────────────────────────────
    let panelEl    = null;
    let dataReady  = false;
    let onDataReady = null;

    function _prefillForm(ctx, h) {
        const set = (sel, val) => { const el = ctx.querySelector(sel); if (el) el.value = val || ''; };
        set('.hazardType',             h.HazardType        || '');
        set('.hazardTypeValue',        h.HazardType        || '');
        set('.hazardTypeDetails',      h.HazardTypeDetails || '');
        set('.hazardTypeDetailsValue', h.HazardTypeDetails || '');
        const dtEl = ctx.querySelector('.hazardTypeDetails');
        if (dtEl) { dtEl.disabled = false; dtEl.style.background = 'white'; }
        set('.hazardSource',     h.HazardSource    || '');
        set('.hazardRiskDesc',   h.RiskDescription || '');
        set('.hazardControl',    h.ControlMeasures    || '');
        set('.hazardNewControl', h.NewControlMeasures || '');
        if (h.RawRiskRating) {
            const bgColor = h.RawBgColor || '#6b7280';
            set('.hazardRiskRatingName',  h.RawRiskRating);
            set('.hazardRiskRatingColor', bgColor);
            set('.hazardLikelihoodId',   h.RawLikelihoodID   || '');
            set('.hazardConsequenceId',  h.RawConsequenceID  || '');
            set('.hazardExposureFreqId', h.RawExposureFreqID || '');
            set('.hazardRiskRatingId',   h.RawRiskRatingID   || '');
            const matBtn = ctx.querySelector('.hz-matrix-btn');
            if (matBtn) { matBtn.textContent = h.RawRiskRating; matBtn.style.background = bgColor; }
        }
        if (h.CurrentRiskRating) {
            const bg = h.CurrentBgColor || '#6b7280';
            set('.hazardCurRatingName',  h.CurrentRiskRating);
            set('.hazardCurRatingColor', bg);
            const curBtn = ctx.querySelector('.hz-cur-matrix-btn');
            if (curBtn) { curBtn.textContent = h.CurrentRiskRating; curBtn.style.background = bg; }
        }
        if (h.ResRiskRating) {
            const bg = h.ResBgColor || '#6b7280';
            set('.hazardResRatingName',  h.ResRiskRating);
            set('.hazardResRatingColor', bg);
            const resBtn = ctx.querySelector('.hz-res-matrix-btn');
            if (resBtn) { resBtn.textContent = h.ResRiskRating; resBtn.style.background = bg; }
        }
    }

    async function _aiAssistFillHazard(ctx, userText) {
        const statusEl = ctx.querySelector('.hz-ai-status');
        const fillBtn  = ctx.querySelector('.hz-ai-fill-btn');
        const showStatus = (msg, color) => {
            statusEl.textContent = msg;
            statusEl.style.color = color || '#6b7280';
            statusEl.style.display = 'inline';
        };
        fillBtn.disabled = true;
        showStatus('Thinking…', '#3B98F1');

        const typeNames  = [...new Set(hazardTypes.map(h => h.HazardTypeDesc).filter(Boolean))];
        const typePairs  = [...new Set(allSubHazards.map(h => `${h.HazardType} > ${h.HazardTypeDetails}`).filter(Boolean))];
        const ratings    = [...new Set(matrixRawData.filter(d => d.CodeType === 'RISKRATING').sort((a,b)=>(a.DisplayOrder||0)-(b.DisplayOrder||0)).map(d => d.CodeName))];

        const systemPrompt =
`You are a WHS (Work Health & Safety) expert. Analyse the hazard description and return ONLY a valid JSON object — no markdown, no code fences, no explanation.
Fields required:
{
  "HazardType": "<one from the list>",
  "HazardTypeDetails": "<one from the list that belongs to that HazardType>",
  "HazardSource": "<brief source, e.g. Equipment, Manual handling, Environment>",
  "RiskDescription": "<clear 1-2 sentence risk description>",
  "RiskRating": "<one from the list>"
}
Available Hazard Types: ${typeNames.join(', ')}
Available Type > Detail pairs:
${typePairs.slice(0,100).join('\n')}
Available Risk Ratings (most severe first): ${ratings.join(', ')}
Always pick the closest match from the provided lists.`;

        try {
            const res = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${CONFIG.openaiApiKey}` },
                body: JSON.stringify({
                    model: 'gpt-4o-mini',
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user',   content: userText }
                    ],
                    temperature: 0.2,
                    max_tokens: 350
                })
            });
            const data = await res.json();
            if (data.usage) trackCost('gpt-4o-mini', data.usage);
            const raw     = (data.choices?.[0]?.message?.content || '').trim();
            const jsonStr = raw.replace(/^```(?:json)?\n?/,'').replace(/\n?```$/,'').trim();
            let parsed;
            try { parsed = JSON.parse(jsonStr); }
            catch(e) { showStatus('Could not parse AI response. Try again.', '#dc3545'); fillBtn.disabled=false; return; }

            const matchedRating = matrixRawData.find(d => d.CodeType==='RISKRATING' && d.CodeName===parsed.RiskRating);
            _prefillForm(ctx, {
                HazardType:        parsed.HazardType        || '',
                HazardTypeDetails: parsed.HazardTypeDetails || '',
                HazardSource:      parsed.HazardSource      || '',
                RiskDescription:   parsed.RiskDescription   || '',
                RawRiskRating:     parsed.RiskRating        || '',
                RawBgColor:        matchedRating ? (matchedRating.BgColor || '#6b7280') : '',
                RawRiskRatingID:   matchedRating ? (matchedRating.CodeId  || 0)        : 0
            });
            showStatus('\u2713 Done! Review and adjust if needed.', '#198754');
        } catch(e) {
            console.error('[AI Assist]', e);
            showStatus('Error contacting AI. Try again.', '#dc3545');
        }
        fillBtn.disabled = false;
    }

    function _bindDropdowns(ctx, hTypes, subHazards) {
        function _renderDd(ddEl, items, onSelect) {
            if (!items.length) {
                ddEl.innerHTML = '<div class="chat-floating-dd-empty">No results found</div>';
                ddEl.style.display = 'block'; return;
            }
            ddEl.innerHTML = items.map((txt, i) =>
                `<div class="chat-floating-dd-item" data-i="${i}">${escapeHtml(txt)}</div>`
            ).join('');
            ddEl.style.display = 'block';
            ddEl.querySelectorAll('.chat-floating-dd-item').forEach((el, i) => {
                el.addEventListener('mousedown', e => { e.preventDefault(); onSelect(items[i]); ddEl.style.display = 'none'; });
            });
        }

        const typeInput   = ctx.querySelector('.hazardType');
        const typeValEl   = ctx.querySelector('.hazardTypeValue');
        const typeDd      = ctx.querySelector('.hazardTypeDd');
        const detailInput = ctx.querySelector('.hazardTypeDetails');
        const detailValEl = ctx.querySelector('.hazardTypeDetailsValue');
        const detailDd    = ctx.querySelector('.hazardDetailsDd');

        if (typeInput && hTypes.length > 0) {
            typeInput.placeholder = 'Type to search...';
            typeInput.disabled = false;
            const allTypeNames = hTypes.map(h => h.HazardTypeDesc || '');
            typeInput.addEventListener('focus', () => {
                const term = typeInput.value.trim().toLowerCase();
                const filtered = term ? allTypeNames.filter(t => t.toLowerCase().includes(term)) : allTypeNames;
                _renderDd(typeDd, filtered, val => {
                    typeInput.value = val; typeValEl.value = val;
                    detailInput.value = ''; detailValEl.value = '';
                    detailInput.placeholder = 'Type to search...';
                    detailInput.disabled = false; detailInput.style.background = 'white';
                    detailDd.style.display = 'none';
                });
            });
            typeInput.addEventListener('input', () => {
                typeValEl.value = '';
                const term = typeInput.value.trim().toLowerCase();
                const filtered = term ? allTypeNames.filter(t => t.toLowerCase().includes(term)) : allTypeNames;
                _renderDd(typeDd, filtered, val => {
                    typeInput.value = val; typeValEl.value = val;
                    detailInput.value = ''; detailValEl.value = '';
                    detailInput.placeholder = 'Type to search...';
                    detailInput.disabled = false; detailInput.style.background = 'white';
                    detailDd.style.display = 'none';
                });
            });
            typeInput.addEventListener('blur', () => setTimeout(() => { typeDd.style.display = 'none'; }, 150));
        }

        if (detailInput && subHazards.length > 0) {
            function _getDetailNames() {
                const selType = typeValEl ? typeValEl.value.trim() : '';
                const src = selType ? subHazards.filter(h => h.HazardType === selType) : subHazards;
                return [...new Set(src.map(h => h.HazardTypeDetails || '').filter(Boolean))];
            }
            detailInput.addEventListener('focus', () => {
                if (detailInput.disabled) return;
                const term = detailInput.value.trim().toLowerCase();
                const names = _getDetailNames();
                const filtered = term ? names.filter(t => t.toLowerCase().includes(term)) : names;
                _renderDd(detailDd, filtered, val => { detailInput.value = val; detailValEl.value = val; });
            });
            detailInput.addEventListener('input', () => {
                if (detailInput.disabled) return;
                detailValEl.value = '';
                const term = detailInput.value.trim().toLowerCase();
                const names = _getDetailNames();
                const filtered = term ? names.filter(t => t.toLowerCase().includes(term)) : names;
                _renderDd(detailDd, filtered, val => { detailInput.value = val; detailValEl.value = val; });
            });
            detailInput.addEventListener('blur', () => setTimeout(() => { detailDd.style.display = 'none'; }, 150));
        }
    }

    function _openPanel(mode, editHazard, editIdx) {
        // mode: 'add' | 'edit' | 'copy'
        mode      = mode || 'add';
        if (panelEl) { panelEl.remove(); panelEl = null; }
        const title    = mode === 'edit' ? 'Edit Hazard' : mode === 'copy' ? 'Copy Hazard' : 'Add Hazard';
        const saveLbl  = mode === 'edit' ? 'Update Hazard' : 'Save Hazard';
        const overlay  = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.35);z-index:8000;';
        const showTabs = (mode === 'add');   // tabs only for new adds
        overlay.innerHTML = `
            <div class="hz-panel" style="position:absolute;right:0;top:0;height:100%;width:460px;background:white;box-shadow:-4px 0 24px rgba(0,0,0,0.18);display:flex;flex-direction:column;overflow:hidden;">
                <div style="padding:16px 20px;border-bottom:1px solid #e5e7eb;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;">
                    <span style="font-weight:700;font-size:15px;color:#111;">${title}</span>
                    <button class="hz-panel-close" style="background:none;border:none;font-size:22px;cursor:pointer;color:#6b7280;padding:0 5px;line-height:1;">&times;</button>
                </div>
                <div class="hz-panel-body" style="flex:1;overflow-y:auto;padding:16px;">
                    ${showTabs ? `<div style="display:flex;border-bottom:1px solid #e5e7eb;margin-bottom:14px;">
                        <button class="hz-tab-btn" data-tab="register" style="${TAB_STYLE_ACTIVE}">Add from Hazard Register</button>
                        <button class="hz-tab-btn" data-tab="sra"      style="${TAB_STYLE_INACTIVE}">Add from Site Risk Assessment</button>
                    </div>` : ''}
                    <div class="hz-pane" id="hz-pane-register">${_buildRegisterForm(saveLbl)}</div>
                    ${showTabs ? `<div class="hz-pane" id="hz-pane-sra" style="display:none;"></div>` : ''}
                </div>
            </div>`;
        document.body.appendChild(overlay);
        panelEl = overlay;
        const panelBody = overlay.querySelector('.hz-panel-body');
        overlay.querySelector('.hz-panel-close').addEventListener('click', () => { overlay.remove(); panelEl = null; });
        overlay.addEventListener('click', e => { if (e.target === overlay) { overlay.remove(); panelEl = null; } });
        _bindForm(panelBody, mode, editHazard, editIdx);
        if (showTabs) _bindTabs(panelBody);
        overlay.querySelector('.hz-ai-fill-btn').addEventListener('click', () => {
            const txt = (overlay.querySelector('.hz-ai-input').value || '').trim();
            if (!txt) { overlay.querySelector('.hz-ai-status').textContent = 'Please describe the hazard first.'; overlay.querySelector('.hz-ai-status').style.color='#dc3545'; overlay.querySelector('.hz-ai-status').style.display='inline'; return; }
            _aiAssistFillHazard(overlay.querySelector('#hz-pane-register') || panelBody, txt);
        });
        if (dataReady) {
            _bindMatrixButton(matrixRawData, panelBody, { btnSel: '.hz-matrix-btn',     nameSel: '.hazardRiskRatingName', colorSel: '.hazardRiskRatingColor', idSel: '.hazardRiskRatingId', lidSel: '.hazardLikelihoodId', cidSel: '.hazardConsequenceId', title: 'Select Risk Rating' });
            _bindMatrixButton(matrixRawData, panelBody, { btnSel: '.hz-cur-matrix-btn', nameSel: '.hazardCurRatingName',  colorSel: '.hazardCurRatingColor',  idSel: '.hazardCurRatingId',  title: 'Select Current Rating' });
            _bindMatrixButton(matrixRawData, panelBody, { btnSel: '.hz-res-matrix-btn', nameSel: '.hazardResRatingName',  colorSel: '.hazardResRatingColor',  idSel: '.hazardResRatingId',  title: 'Select Res Risk Rating' });
            _bindDropdowns(panelBody, hazardTypes, allSubHazards);
        } else {
            onDataReady = () => {
                _bindMatrixButton(matrixRawData, panelBody, { btnSel: '.hz-matrix-btn',     nameSel: '.hazardRiskRatingName', colorSel: '.hazardRiskRatingColor', idSel: '.hazardRiskRatingId', lidSel: '.hazardLikelihoodId', cidSel: '.hazardConsequenceId', title: 'Select Risk Rating' });
                _bindMatrixButton(matrixRawData, panelBody, { btnSel: '.hz-cur-matrix-btn', nameSel: '.hazardCurRatingName',  colorSel: '.hazardCurRatingColor',  idSel: '.hazardCurRatingId',  title: 'Select Current Rating' });
                _bindMatrixButton(matrixRawData, panelBody, { btnSel: '.hz-res-matrix-btn', nameSel: '.hazardResRatingName',  colorSel: '.hazardResRatingColor',  idSel: '.hazardResRatingId',  title: 'Select Res Risk Rating' });
                _bindDropdowns(panelBody, hazardTypes, allSubHazards);
            };
        }
        if (editHazard) _prefillForm(panelBody, editHazard);
    }

    // ── Initial render ────────────────────────────────────────────────────
    rowBody.innerHTML =
        `<div class="hazard-existing-section" style="color:#6b7280;font-size:13px;padding:4px 0 8px;">Loading existing hazards...</div>
        <div style="margin-top:10px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
            <button class="hz-add-btn" style="padding:8px 20px;background:#3B98F1;color:white;border:none;border-radius:6px;cursor:pointer;font-weight:600;font-size:14px;">+ Add Hazard</button>
        </div>`;
    scrollToBottom();
    rowBody.querySelector('.hz-add-btn').addEventListener('click', () => _openPanel('add', null, null));

    // ── Direct-save from chat text (no panel required) ───────────────────
    async function _saveFromChatText(userText, onStatus) {
        onStatus('<span style="color:#6b7280;">\u23F3 Analysing hazard\u2026</span>');
        // Poll until dropdown data is ready (max 6s)
        let waited = 0;
        while (!dataReady && waited < 6000) { await new Promise(r => setTimeout(r, 150)); waited += 150; }
        if (!dataReady) { onStatus('<span style="color:#dc3545;">\u26A0 Data not ready. Try again.</span>'); return; }

        const typeNames = [...new Set(hazardTypes.map(h => h.HazardTypeDesc).filter(Boolean))];
        const typePairs = [...new Set(allSubHazards.map(h => h.HazardType + ' > ' + h.HazardTypeDetails).filter(Boolean))];
        const ratings   = [...new Set(matrixRawData.filter(d => d.CodeType === 'RISKRATING').sort((a, b) => (a.DisplayOrder || 0) - (b.DisplayOrder || 0)).map(d => d.CodeName))];
        const systemPrompt =
            'You are a WHS (Work Health & Safety) expert. Analyse the hazard description and return ONLY a valid JSON object with no markdown or code fences.\n' +
            'Fields required:\n{\n' +
            '  "HazardType": "<one from the list>",\n' +
            '  "HazardTypeDetails": "<matching detail>",\n' +
            '  "HazardSource": "<brief source>",\n' +
            '  "RiskDescription": "<1-2 sentence description>",\n' +
            '  "RiskRating": "<one from the list>",\n' +
            '  "controls": [\n' +
            '    { "description": "<control measure text>", "hierarchy": "<one of: Elimination|Substitution|Isolation|Engineering|Administrative|PPE>", "isCurrentControl": <default true, only false if text explicitly says future e.g. will implement, plan to, need to add> }\n' +
            '  ]\n' +
            '}\n' +
            'The "controls" array should list any control measures mentioned or implied by the user. If none are mentioned, use an empty array.\n' +
            'For "isCurrentControl": DEFAULT to true (already in place). Only set false if the user clearly states the control is a future/planned action.\n' +
            'For "hierarchy": choose the most appropriate level from Elimination, Substitution, Isolation, Engineering, Administrative, PPE.\n' +
            'Available Hazard Types: ' + typeNames.join(', ') + '\n' +
            'Available Type > Detail pairs:\n' + typePairs.slice(0, 100).join('\n') + '\n' +
            'Available Risk Ratings (most severe first): ' + ratings.join(', ');

        let parsed;
        try {
            const res = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + CONFIG.openaiApiKey },
                body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userText }], temperature: 0.2, max_tokens: 500 })
            });
            const data = await res.json();
            if (data.usage) trackCost('gpt-4o-mini', data.usage);
            const raw = ((data.choices || [{}])[0].message || {}).content || '';
            const jsonStr = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
            parsed = JSON.parse(jsonStr);
        } catch (e) { onStatus('<span style="color:#dc3545;">\u26A0 AI error. Try again.</span>'); return; }

        onStatus('<span style="color:#6b7280;">\u23F3 Saving hazard\u2026</span>');
        const matchedRating = matrixRawData.find(d => d.CodeType === 'RISKRATING' && d.CodeName === parsed.RiskRating);
        const riskRatingId  = matchedRating ? (parseInt(matchedRating.CodeId) || 0) : 0;
        const bgColor       = matchedRating ? (matchedRating.BgColor || '#6b7280') : '#6b7280';
        const _saveBaseUrl  = CONFIG.apiUrl.replace(/\/affinda\/api\/chat-template.*$/i, '');
        const saveUrl       = _saveBaseUrl + '/NetServices/POSTDynamicChecklist.asmx/RegisterHazardUpsert';
        const controls      = Array.isArray(parsed.controls) ? parsed.controls.filter(c => c && c.description) : [];
        const _validHier    = ['Elimination','Substitution','Isolation','Engineering','Administrative','PPE'];
        try {
            const resp = await fetch(saveUrl, {
                method: 'POST', credentials: 'include',
                headers: { 'Content-Type': 'application/json; charset=utf-8' },
                body: JSON.stringify({ obj: {
                    RegOthHazTplID: 0, RegOthID: state.regOthId,
                    RiskDescription: parsed.RiskDescription || '',
                    ExposureFreqID: 0, ExposurePossibilityID: 0, ImpactLevelID: 0,
                    RiskRatingID: riskRatingId, RegOthHazTPLChemID: 0,
                    HazardType: parsed.HazardType || '', HazardTypeDetails: parsed.HazardTypeDetails || '',
                    HazardDescription: parsed.HazardSource || '',
                    ControlMeasures: '', NewControlMeasures: '',
                    StoreID: CONFIG.storeId, ByName: (CONFIG.userProfile && CONFIG.userProfile.FullName) || CONFIG.userName || '',
                    HazardTemplateDetID: hazardInfo.hazardTemplateDetId || 0,
                    HazardTemplateID: hazardInfo.hazardTemplateId || 0,
                    Action: 'CREATE', RiskMatrixID: hazardInfo.riskMatrixId || 0,
                    RegOthHazTempalteID: hazardInfo.regOthHazTempalteId || 0, IsFreeForm: true
                }})
            });
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            let serverReturnedId = 0;
            try {
                const rj = await resp.clone().json();
                console.log('[Hazard] RegisterHazardUpsert response:', JSON.stringify(rj));
                serverReturnedId = (rj && rj.d && rj.d.RegOthHazTplID) ? parseInt(rj.d.RegOthHazTplID)
                                 : (rj && rj.d && !isNaN(rj.d))         ? parseInt(rj.d) : 0;
                console.log('[Hazard] serverReturnedId:', serverReturnedId);
            } catch (_) {}

            const newH = {
                RegOthHazTplID: serverReturnedId,
                HazardType: parsed.HazardType || '', HazardTypeDetails: parsed.HazardTypeDetails || '',
                HazardSource: parsed.HazardSource || '', RiskDescription: parsed.RiskDescription || '',
                RawRiskRating: parsed.RiskRating || '', RawBgColor: bgColor, RawRiskRatingID: riskRatingId,
                ControlMeasures: '', NewControlMeasures: '',
                ControlResponses: [], CurCtrlCount: 0, NewCtrlCount: 0
            };

            // Save controls via RegisterControlUpsert
            if (controls.length) {
                if (!serverReturnedId) {
                    console.warn('[Hazard] serverReturnedId is 0 — controls cannot be linked to hazard. Check API response above.');
                    onStatus('<span style="color:#f59e0b;font-weight:600;">\u26A0 Hazard saved but controls skipped</span> \u2014 server did not return a hazard ID.');
                } else {
                    onStatus('<span style="color:#6b7280;">\u23F3 Saving ' + controls.length + ' control' + (controls.length > 1 ? 's' : '') + '\u2026</span>');
                    const ctrlUrl = _saveBaseUrl + '/NetServices/POSTDynamicChecklist.asmx/RegisterControlUpsert';
                    for (const ctrl of controls) {
                        const hier = _validHier.includes(ctrl.hierarchy) ? ctrl.hierarchy : 'Administrative';
                        const isCurrent = ctrl.isCurrentControl !== false; // default to current unless AI explicitly says false
                        try {
                            const ctrlResp = await fetch(ctrlUrl, {
                                method: 'POST', credentials: 'include',
                                headers: { 'Content-Type': 'application/json; charset=utf-8' },
                                body: JSON.stringify({ obj: {
                                    RegOthHazTplID: serverReturnedId,
                                    RegOthHazTplControlID: 0,
                                    RegOthID: state.regOthId,
                                    ControlHeirarchy: hier,
                                    ControlCategory: '',
                                    ControlComment: '',
                                    ControlDescription: ctrl.description,
                                    HazardTemplateDetID: hazardInfo.hazardTemplateDetId || 0,
                                    HazardTemplateID: hazardInfo.hazardTemplateId || 0,
                                    Action: 'CREATE',
                                    ByName: (CONFIG.userProfile && CONFIG.userProfile.FullName) || CONFIG.userName || '',
                                    Type: 'adhoc',
                                    IsCurrentControl: isCurrent,
                                    StartDate: null, EndDate: null, ControlImplementorID: null,
                                    PriorityID: null, ControlGroups: '',
                                    RelativeStartDate: 0, RelativeDeadline: 0
                                }})
                            });
                            const ctrlJson = await ctrlResp.json().catch(() => null);
                            console.log('[Hazard] RegisterControlUpsert response for "' + ctrl.description + '":', JSON.stringify(ctrlJson));
                            newH.ControlResponses.push({ IsCurrentControl: isCurrent, ControlHeirarchy: hier, ControlDescription: ctrl.description });
                            if (isCurrent) newH.CurCtrlCount++;
                            else           newH.NewCtrlCount++;
                        } catch (_ce) { console.warn('[Hazard] control save error:', _ce); }
                    }
                }
            }

            const newIdx = existingHazardsList.length;
            existingHazardsList.push(newH);
            const cardList = rowBody.querySelector('.hazard-existing-list');
            if (cardList) { cardList.insertAdjacentHTML('beforeend', _buildHazardCard(newH, newIdx)); _bindTableActions(cardList); }
            const countBadge = rowBody.querySelector('.hazard-existing-count');
            if (countBadge) countBadge.textContent = existingHazardsList.length;

            const ctrlSavedCount = newH.CurCtrlCount + newH.NewCtrlCount;
            const ctrlSummary = ctrlSavedCount > 0
                ? ' \u2014 <span style="color:#198754;">' + ctrlSavedCount + ' control' + (ctrlSavedCount > 1 ? 's' : '') + ' saved</span>'
                : '';
            onStatus('<span style="color:#10b981;font-weight:600;">\u2713 Hazard saved</span> \u2014 ' + escapeHtml(parsed.HazardType || '') + ': ' + escapeHtml(parsed.HazardTypeDetails || '') + ctrlSummary);

            // Reload from server so control counts are accurate
            if (ctrlSavedCount > 0) {
                await _reloadHazards();
            }
            scrollToBottom();
        } catch (err) { onStatus('<span style="color:#dc3545;">\u26A0 Save failed: ' + escapeHtml(err.message) + '</span>'); }
    }

    // Load dropdown data + existing hazards in the background
    let hazardTypes    = [];
    let allSubHazards  = [];
    let matrixRawData  = [];
    (async () => {
        const _whsBase = CONFIG.apiUrl.replace(/\/affinda\/api\/chat-template.*$/i, '');
        let existingHazards = [];

        await Promise.all([
            (async () => {
                try {
                    const _getUrl = `${_whsBase}/NetServices/DynamicChecklist.asmx/GetHazards` +
                        `?hazardTemplateDetId=${encodeURIComponent(hazardInfo.hazardTemplateDetId || 0)}` +
                        `&regOthId=${encodeURIComponent(state.regOthId || 0)}` +
                        `&regOthHazTempalteID=${encodeURIComponent(hazardInfo.regOthHazTempalteId || 0)}`;
                    const res  = await fetch(_getUrl, { credentials: 'include' });
                    const json = await res.json();
                    const arr  = (json && json.d) ? json.d : (Array.isArray(json) ? json : []);
                    existingHazards     = arr.map(_mapHazardRow);
                    existingHazardsList = existingHazards;
                } catch (_e) { console.warn('[Hazard] GetHazards error:', _e); }
            })(),
            (async () => {
                try {
                    const res  = await fetch(`${_whsBase}/NetServices/POSTDynamicChecklist.asmx/spChecklistGetHazardTypes`, {
                        method: 'POST', credentials: 'include',
                        headers: { 'Content-Type': 'application/json; charset=utf-8' },
                        body: '{}'
                    });
                    const json = await res.json();
                    hazardTypes = (json && json.d) ? json.d : [];
                    console.log('[Hazard] spChecklistGetHazardTypes returned', hazardTypes.length, 'items');
                } catch (_e) { console.warn('[Hazard] spChecklistGetHazardTypes error:', _e); }
            })(),
            (async () => {
                try {
                    const res  = await fetch(`${_whsBase}/NetServices/POSTDynamicChecklist.asmx/LoadHazards`, {
                        method: 'POST', credentials: 'include',
                        headers: { 'Content-Type': 'application/json; charset=utf-8' },
                        body: JSON.stringify({ data: { RefKey: 'HAZARDREPORT', RegisterTypeID: hazardInfo.regTypeId || 0 } })
                    });
                    const json = await res.json();
                    allSubHazards = (json && json.d) ? json.d : [];
                    console.log('[Hazard] LoadHazards returned', allSubHazards.length, 'items');
                } catch (_e) { console.warn('[Hazard] LoadHazards error:', _e); }
            })(),
            (async () => {
                try {
                    const _startupMatrixId = hazardInfo.riskMatrixId || 37;
                    const res  = await fetch(`${_whsBase}/NetServices/DynamicChecklist.asmx/GetRiskMatrix?matrixId=${encodeURIComponent(_startupMatrixId)}`, { credentials: 'include' });
                    const json = await res.json();
                    matrixRawData = (json && json.d) ? json.d : (Array.isArray(json) ? json : []);
                    console.log('[Hazard] GetRiskMatrix returned', matrixRawData.length, 'items for matrixId', _startupMatrixId);
                } catch (_e) { console.warn('[Hazard] GetRiskMatrix error:', _e); }
            })()
        ]);

        // Render the existing hazards table
        _refreshHazardTable(existingHazards);

        // Data is ready — wire up the panel if it was already opened
        dataReady = true;
        if (onDataReady) { onDataReady(); onDataReady = null; }

        scrollToBottom();
    })();
    return _saveFromChatText;
}


let mapInstance = null;
let mapMarker = null;
let mapGeocoder = null;

function loadGoogleMapsAPI() {
    return new Promise((resolve, reject) => {
        if (window.google && window.google.maps) {
            resolve();
            return;
        }
        
        // Load the Maps JavaScript API with Places library
        const script = document.createElement('script');
        script.src = `https://maps.googleapis.com/maps/api/js?key=${CONFIG.googleMapsApiKey}&libraries=places&v=weekly`;
        script.async = true;
        script.defer = true;
        script.onload = () => {
            console.log('Google Maps API loaded successfully');
            resolve();
        };
        script.onerror = (error) => {
            console.error('Failed to load Google Maps:', error);
            reject(new Error('Failed to load Google Maps'));
        };
        document.head.appendChild(script);
    });
}

async function addMapUI(initialLocation = null) {
    const messagesArea = document.getElementById('messagesArea');
    const lastMessage = messagesArea.lastElementChild;
    
    const mapContainer = document.createElement('div');
    mapContainer.className = 'map-container';
    mapContainer.style.cssText = 'margin-top: 12px; padding: 16px; background: #f8f9fa; border-radius: 8px;';
    
    mapContainer.innerHTML = `
        <div style="margin-bottom: 12px; position: relative;">
            <input type="text" id="mapSearchInput" placeholder="Search for a location..." 
                style="width: 100%; padding: 10px; border: 1px solid #e5e7eb; border-radius: 4px; font-size: 14px;">
        </div>
        <div id="googleMap" style="width: 100%; height: 400px; border-radius: 8px; border: 2px solid #e5e7eb;"></div>
        <div style="margin-top: 12px; display: flex; gap: 8px; align-items: center;">
            <div style="flex: 1; display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                <div>
                    <label style="display: block; font-size: 12px; color: #6b7280; margin-bottom: 4px;">Latitude</label>
                    <input type="text" id="mapLatitude" readonly 
                        style="width: 100%; padding: 6px; border: 1px solid #e5e7eb; border-radius: 4px; background: #e9ecef; font-size: 13px;">
                </div>
                <div>
                    <label style="display: block; font-size: 12px; color: #6b7280; margin-bottom: 4px;">Longitude</label>
                    <input type="text" id="mapLongitude" readonly 
                        style="width: 100%; padding: 6px; border: 1px solid #e5e7eb; border-radius: 4px; background: #e9ecef; font-size: 13px;">
                </div>
            </div>
           <button id="mapConfirmButton" onclick="handleMapConfirm()" style="padding: 8px 20px;background: #3B98F1;color: white;border: none;border-radius: 4px;cursor: pointer;font-weight: 500;white-space: nowrap;opacity: 1;margin-top: 21px;">
               Confirm Location
            </button>
        </div>
        <div id="mapLocationName" style="margin-top: 8px; font-size: 13px; color: #495057;"></div>
    `;
    
    lastMessage.querySelector('.message-content').appendChild(mapContainer);
    scrollToBottom();
    
    // Load Google Maps API and initialize
    try {
        await loadGoogleMapsAPI();
        initializeMap(initialLocation);
    } catch (error) {
        document.getElementById('googleMap').innerHTML = `
            <div style="height: 100%; display: flex; align-items: center; justify-content: center; color: #dc3545;">
                Failed to load Google Maps. Please refresh the page.
            </div>
        `;
    }
}

function initializeMap(initialLocation = null) {
    const mapElement = document.getElementById('googleMap');
    const autocompleteElement = document.getElementById('mapSearchInput');
    
    // Default center (Sydney, Australia)
    const defaultCenter = { lat: -33.8688, lng: 151.2093 };
    
    // Initialize map
    mapInstance = new google.maps.Map(mapElement, {
        center: defaultCenter,
        zoom: 13,
        mapTypeControl: true,
        streetViewControl: false,
        fullscreenControl: false
    });
    
    // Initialize geocoder
    mapGeocoder = new google.maps.Geocoder();
    
    // Initialize marker (using standard marker for compatibility)
    mapMarker = new google.maps.Marker({
        map: mapInstance,
        draggable: true,
        visible: false
    });
    
    // Initialize autocomplete service with Place Autocomplete
    if (autocompleteElement) {
        const autocompleteService = new google.maps.places.AutocompleteService();
        const placesService = new google.maps.places.PlacesService(mapInstance);
        let autocompleteResults = [];
        let selectedIndex = -1;
        
        // Create dropdown for suggestions
        const dropdown = document.createElement('div');
        dropdown.id = 'mapSearchDropdown';
        dropdown.style.cssText = 'position: absolute; top: 100%; left: 0; right: 0; background: white; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 4px 4px; max-height: 300px; overflow-y: auto; z-index: 1000; display: none; box-shadow: 0 4px 6px rgba(0,0,0,0.1);';
        autocompleteElement.parentElement.appendChild(dropdown);
        
        // Handle input changes
        let debounceTimer;
        autocompleteElement.addEventListener('input', () => {
            clearTimeout(debounceTimer);
            const query = autocompleteElement.value.trim();
            
            if (query.length < 2) {
                dropdown.style.display = 'none';
                return;
            }
            
            debounceTimer = setTimeout(() => {
                autocompleteService.getPlacePredictions(
                    { input: query },
                    (predictions, status) => {
                        if (status === google.maps.places.PlacesServiceStatus.OK && predictions) {
                            autocompleteResults = predictions;
                            displaySuggestions(predictions);
                        } else {
                            dropdown.style.display = 'none';
                        }
                    }
                );
            }, 300);
        });
        
        // Display suggestions
        function displaySuggestions(predictions) {
            dropdown.innerHTML = '';
            dropdown.style.display = 'block';
            
            predictions.forEach((prediction, index) => {
                const item = document.createElement('div');
                item.style.cssText = 'padding: 10px; cursor: pointer; border-bottom: 1px solid #f0f0f0;';
                item.textContent = prediction.description;
                
                item.addEventListener('mouseenter', () => {
                    item.style.background = '#f8f9fa';
                });
                
                item.addEventListener('mouseleave', () => {
                    item.style.background = 'white';
                });
                
                item.addEventListener('click', () => {
                    selectPlace(prediction.place_id, prediction.description);
                });
                
                dropdown.appendChild(item);
            });
        }
        
        // Select a place and get its details
        function selectPlace(placeId, description) {
            console.log('Place selected:', placeId, description);
            
            placesService.getDetails(
                { placeId: placeId, fields: ['geometry', 'name', 'formatted_address'] },
                (place, status) => {
                    if (status === google.maps.places.PlacesServiceStatus.OK && place.geometry) {
                        const location = place.geometry.location;
                        const locationName = place.name || place.formatted_address || description;
                        
                        console.log('Got place details:', location);
                        
                        placeMarker(location, locationName);
                        mapInstance.setCenter(location);
                        mapInstance.setZoom(17);
                        
                        autocompleteElement.value = '';
                        dropdown.style.display = 'none';
                    } else {
                        console.error('Place details request failed:', status);
                        alert('Failed to get location details. Please try again.');
                    }
                }
            );
        }
        
        // Hide dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!autocompleteElement.contains(e.target) && !dropdown.contains(e.target)) {
                dropdown.style.display = 'none';
            }
        });
    }
    
    // Handle map click to place marker
    mapInstance.addListener('click', (event) => {
        placeMarker(event.latLng);
    });
    
    // Handle marker drag
    mapMarker.addListener('dragend', (event) => {
        placeMarker(event.latLng);
    });
    
    // Try to get user's current location
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (position) => {
                const userLocation = {
                    lat: position.coords.latitude,
                    lng: position.coords.longitude
                };
                // Only center on user location if no initial location was provided
                if (!initialLocation) {
                    mapInstance.setCenter(userLocation);
                }
            },
            () => {
                // User denied or error - stay with default center
            }
        );
    }
    
    // Auto-populate and search if initial location was provided by AI
    if (initialLocation && autocompleteElement) {
        console.log('Auto-populating map with location:', initialLocation);
        
        // Set the search input value
        autocompleteElement.value = initialLocation;
        
        // Use Geocoding API to find the location
        const geocoder = new google.maps.Geocoder();
        geocoder.geocode({ address: initialLocation }, (results, status) => {
            if (status === 'OK' && results[0]) {
                const location = results[0].geometry.location;
                const locationName = results[0].formatted_address;
                
                console.log('Found location:', locationName, location);
                
                // Place marker and center map
                placeMarker(location, locationName);
                mapInstance.setCenter(location);
                mapInstance.setZoom(17);
                
                // Show a subtle notification
                const locationNameDiv = document.getElementById('mapLocationName');
                if (locationNameDiv) {
                    locationNameDiv.innerHTML = `<span style="color: #28a745;">${locationName}`;
                }
            } else {
                console.warn('Geocoding failed for:', initialLocation, status);
                // Keep the text in search box so user can manually search
            }
        });
    }
}

function placeMarker(location, locationName = null) {
    if (!mapMarker) return;
    mapMarker.setPosition(location);
    mapMarker.setVisible(true);
    
    // Add bounce animation to make the pin obvious
    mapMarker.setAnimation(google.maps.Animation.BOUNCE);
    setTimeout(() => {
        if (mapMarker) mapMarker.setAnimation(null);
    }, 1500);
    
    // Handle both LatLng object and plain {lat, lng} object
    const lat = typeof location.lat === 'function' ? location.lat() : location.lat;
    const lng = typeof location.lng === 'function' ? location.lng() : location.lng;
    
    document.getElementById('mapLatitude').value = lat.toFixed(7);
    document.getElementById('mapLongitude').value = lng.toFixed(7);
    
    // Enable confirm button  
    const confirmBtn = document.getElementById('mapConfirmButton');
    confirmBtn.disabled = false;
    confirmBtn.style.cursor = 'pointer';
    confirmBtn.style.opacity = '1';
    
    // Reverse geocode to get location name if not provided
    if (locationName) {
        document.getElementById('mapLocationName').textContent = `📍 ${locationName}`;
    } else {
        document.getElementById('mapLocationName').textContent = '🔍 Looking up address...';
        mapGeocoder.geocode({ location: { lat, lng } }, (results, status) => {
            if (status === 'OK' && results[0]) {
                document.getElementById('mapLocationName').textContent = `📍 ${results[0].formatted_address}`;
            } else {
                document.getElementById('mapLocationName').textContent = `📍 Location: ${lat.toFixed(6)}, ${lng.toFixed(6)}`;
            }
        });
    }
}

async function handleMapConfirm() {
    const lat = parseFloat(document.getElementById('mapLatitude').value);
    const lng = parseFloat(document.getElementById('mapLongitude').value);
    const locationText = document.getElementById('mapLocationName').textContent.replace('📍 ', '').replace('🔍 Looking up address...', 'Custom Location');
    
    if (isNaN(lat) || isNaN(lng)) {
        alert('Please select a location on the map first');
        return;
    }
    
    // Format as JSON
    const mapData = {
        Latitude: lat,
        Longitude: lng,
        Location: locationText
    };
    
    const mapDataString = JSON.stringify(mapData);
    
    // Store in state for potential Yes/No confirmation
    state.lastMapData = mapDataString;
    console.log('Stored map data for confirmation:', state.lastMapData);
    
    // Remove map UI
    const mapContainer = document.querySelector('.map-container');
    if (mapContainer) {
        mapContainer.remove();
    }
    
    // Reset map instances
    mapInstance = null;
    mapMarker = null;
    mapGeocoder = null;
    
    // Auto-submit the JSON as the answer
    await sendChatMessage(mapDataString);
}

function showFieldsSummary(fields) {
    // Saved chip disabled — not needed
}

function showSectionDivider(sectionName, subSectionName) {
    const messagesArea = document.getElementById('messagesArea');
    const label = subSectionName ? `${sectionName} › ${subSectionName}` : sectionName;

    const divider = document.createElement('div');
    divider.className = 'section-divider';
    divider.innerHTML = `<span>${label}</span>`;
    messagesArea.appendChild(divider);
}

function showSmartFillTyping() {
    const messagesArea = document.getElementById('messagesArea');
    const existing = document.getElementById('smartFillTyping');
    if (existing) existing.remove();

    const messageDiv = document.createElement('div');
    messageDiv.className = 'message assistant';
    messageDiv.id = 'smartFillTyping';

    const icon = document.createElement('div');
    icon.className = 'message-icon';
    icon.innerHTML = '<i class="ph-thin ph-magic-wand"></i>';

    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    contentDiv.style.cssText = 'display:flex;align-items:center;gap:10px;';
    contentDiv.innerHTML = '<span style="font-size:13px;color:#6b7280;">Smart Fill — analysing your message</span><div class="typing-indicator"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div>';

    messageDiv.appendChild(icon);
    messageDiv.appendChild(contentDiv);
    messagesArea.appendChild(messageDiv);
    scrollToBottom();
}

function removeSmartFillTyping() {
    const el = document.getElementById('smartFillTyping');
    if (el) el.remove();
}

/**
 * Generates a short, context-aware "thinking" phrase shown in the typing indicator.
 * Uses GPT-4o-mini for speed; falls back to a random phrase on timeout/error.
 */
async function generateThinkingText(userMessage) {
    const fallbacks = [
        'Looking into that for you...',
        'Thinking that through...',
        'On it, just a moment...',
        'Let me check that...',
        'Working on it...',
        'Processing your request...'
    ];
    const fallback = fallbacks[Math.floor(Math.random() * fallbacks.length)];

    if (!CONFIG.openaiApiKey || !userMessage) return fallback;

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 2500);

        const recentHistory = state.conversationHistory.slice(-4)
            .map(m => `${m.role === 'user' ? 'User' : 'AI'}: ${m.content.substring(0, 80)}`)
            .join('\n');

        const systemPrompt = `You are an AI assistant helping with workplace health & safety forms and compliance.
The user just sent a message and you are processing their request.
Generate ONE short, engaging "thinking" sentence (5-12 words) that reflects what you are about to do, based on what they said.
Good examples: "Looking into workplace safety requirements for you...", "Checking your incident report details...", "Reviewing the compliance checklist...", "Analysing your workplace hazard description...", "Let me find the right template for you..."
Rules: Match the context. End with "...". Do NOT answer the question. No quotation marks in output.`;

        const res = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            signal: controller.signal,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${CONFIG.openaiApiKey}`
            },
            body: JSON.stringify({
                model: 'gpt-4o-mini',
                max_tokens: 35,
                temperature: 0.85,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: `User said: "${userMessage.substring(0, 150)}"${recentHistory ? '\n\nRecent chat:\n' + recentHistory : ''}` }
                ]
            })
        });

        clearTimeout(timeout);

        if (res.ok) {
            const data = await res.json();
            trackCost('gpt-4o-mini', data.usage);
            const phrase = data.choices?.[0]?.message?.content?.trim();
            if (phrase) return phrase;
        }
    } catch (e) {
        // Timeout or network error — fall through to fallback
    }

    return fallback;
}

function showTypingIndicator(userMessage) {
    const messagesArea = document.getElementById('messagesArea');

    const messageDiv = document.createElement('div');
    messageDiv.className = 'message assistant';
    messageDiv.id = 'typingIndicator';

    const icon = document.createElement('div');
    icon.className = 'message-icon';
    icon.innerHTML = '<i class="ph-thin ph-chats-circle"></i>';

    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    contentDiv.innerHTML = '<div class="typing-indicator"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div>';

    messageDiv.appendChild(icon);
    messageDiv.appendChild(contentDiv);

    messagesArea.appendChild(messageDiv);
    scrollToBottom();

    // Asynchronously fetch a context-aware thinking phrase and inject it
    if (userMessage) {
        generateThinkingText(userMessage).then(text => {
            const indicator = document.getElementById('typingIndicator');
            if (!indicator) return; // already removed before response came back
            const content = indicator.querySelector('.message-content');
            if (content) {
                content.innerHTML =
                    '<div class="typing-thinking-wrap">' +
                    `<span class="thinking-text">${escapeHtml(text)}</span>` +
                    '<div class="typing-indicator"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div>' +
                    '</div>';
            }
        });
    }
}

function removeTypingIndicator() {
    const indicator = document.getElementById('typingIndicator');
    if (indicator) indicator.remove();
}

function updateProgress(percentage, totalFields, answeredFields) {
    state.completionPercentage = percentage;
    if (totalFields !== undefined && totalFields !== null) state.totalFieldCount = totalFields;
    if (answeredFields !== undefined && answeredFields !== null) state.answeredFieldCount = answeredFields;
    document.getElementById('progressBar').style.width = `${percentage}%`;
    document.getElementById('debugProgress').textContent = `${Math.round(percentage)}%`;

    // Update panel
    document.getElementById('panelProgressBar').style.width = `${percentage}%`;
    document.getElementById('panelProgressText').textContent = `${Math.round(percentage)}% complete`;

    // Enable complete button once session has meaningful progress (50%+)
    // 100% may never be reached if some fields are optional
    const completeBtn = document.getElementById('completeBtnPanel');
    if (percentage >= 50 && !state.sessionCompleted) {
        completeBtn.disabled = false;
    }

    if (percentage >= 100 && !state.sessionCompleted && !state._collectingHeaderDetails && Number(state.totalFieldCount || 0) > 0) {
        setChatInputState(true, 'All questions covered — complete the session to submit the form.');
        if (!document.getElementById('completionPrompt')) {
            setTimeout(() => {
                if (isAwaitingCompletion()) promptCompletion();
            }, 100);
        }
    } else if (!state.sessionCompleted) {
        setChatInputState(false, 'Type your message...');
    }

    // Update inline progress widget in the chat
    updateInlineChatProgress(percentage);
}

function updateInlineChatProgress(percentage) {
    if (state._replayMode) return;

    const widget = document.getElementById('chatInlineProgress');
    if (!widget) return;

    // Show it the first time
    widget.style.display = 'block';

    const pct = Math.round(percentage);
    const statusMessages = [
        [0,  1,   'Just getting started.'],
        [1,  25,  'Just getting started on the details.'],
        [25, 50,  'Making good progress.'],
        [50, 75,  'More than halfway through!'],
        [75, 100, 'Just adding some finishing touches.']
    ];
    let statusText = 'Working through the form.';
    for (const [lo, hi, msg] of statusMessages) {
        if (pct >= lo && pct < hi) { statusText = msg; break; }
    }
    if (pct >= 100) statusText = 'All details collected!';

    // Build "7/10 (70%) Complete" using server-sent askable counts
    // Server returns totalFields (askable only: excludes headings, auto-answer, unmet conditionals)
    // and answeredFields (answered askable). These are dynamic — they change as conditions are met.
    const answered = state.answeredFieldCount || 0;
    const total = (state.totalFieldCount > 0) ? state.totalFieldCount : null;
    const progressLabel = total
        ? `${answered}/${total} (${pct}%) Complete.`
        : `${pct}% Complete.`;

    document.getElementById('chatInlineProgressText').innerHTML =
        `<strong>${progressLabel}</strong> ${statusText}`;
    document.getElementById('chatInlineProgressFill').style.width = `${pct}%`;

    const formUrl = getFormUrl();
    const linkRow = document.getElementById('chatInlineProgressLink');
    if (formUrl) {
        const recordName = state.chatName || state.templateName || 'Record';
        document.getElementById('chatInlineProgressLinkText').textContent = `View the ${recordName}`;
        linkRow.style.display = 'inline-flex';
    } else {
        linkRow.style.display = 'none';
    }
}

function _openFormFromWidget() {
    const url = getFormUrl();
    if (url) window.open(url, '_blank');
}

function updateDebugInfo() {
    document.getElementById('debugSession').textContent = state.internalNo || state.regOthId || '-';
    document.getElementById('debugInfo').classList.add('show');

    // Update panel session info
    updateProgressPanel();
}

function toggleProgressPanel() {
    const panel = document.getElementById('progressPanel');
    panel.classList.toggle('show');
}

function updateProgressPanel() {
    // Update session info
    document.getElementById('panelTemplateName').textContent = state.templateName || '-';
    document.getElementById('panelSessionId').textContent = state.regOthId || '-';
    document.getElementById('panelInternalNo').textContent = state.internalNo || '-';

    // Update fields list
    updateFieldsList();
}

function updateFieldsList() {
    const fieldsList = document.getElementById('panelFieldsList');

    if (state.extractedFieldsMap.size === 0) {
        fieldsList.innerHTML = `
            <div style="color: #9ca3af; font-size: 13px; text-align: center; padding: 20px;">
                No fields extracted yet
            </div>
        `;
        return;
    }

    let html = '';
    state.extractedFieldsMap.forEach((field, fieldID) => {
        const fieldName = field.fieldName || fieldID;
        const fieldValue = field.extractedValue || field.value || '';
        const isFilled = fieldValue && fieldValue.trim() !== '';
        html += `
            <div class="extracted-field-item ${isFilled ? 'filled' : ''}">
                <div class="field-name-label">${fieldName}</div>
                <div class="field-value-text">${isFilled ? fieldValue : 'Pending...'}</div>
            </div>
        `;
    });

    fieldsList.innerHTML = html;
}

async function completeSession() {
    if (!state.regOthId) return;

    // Warn if not fully complete but allow them to proceed
    if (state.completionPercentage < 100) {
        const proceed = confirm(
            'Some fields are still missing. You can edit them directly in the form after completing.\n\nDo you want to complete the session now?'
        );
        if (!proceed) return;
    }

    try {
        const response = await fetch(`${CONFIG.apiUrl}/complete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                regOthID: state.regOthId,
                storeID: CONFIG.storeId,
                completedByID: CONFIG.userId
            })
        });

        const data = await response.json();

        const completeUrl = buildCompleteUrl(state.regOthId, state.templateName, state.moduleName);

        if (data.success) {
            await registerOthHdrFinish();
            state.sessionCompleted = true;
            saveTranscript(); // mark as complete in localStorage
            _markSessionCompleteLocally(state.regOthId);
            // Disable the chat input
            setChatInputState(true, 'Session completed.');
            // Disable the panel button
            const btn = document.getElementById('completeBtnPanel');
            btn.disabled = true;
            btn.textContent = 'Session Completed';
            if (completeUrl) {
                window.location.href = completeUrl;
                return;
            }
            await showCompletionUI(data.missingFields);
        } else {
            // Missing required fields — warn and show which ones
            const missing = data.missingFields?.length
                ? `\n\nMissing: ${data.missingFields.join(', ')}`
                : '';
            const proceed = true;

            if (!proceed) return;
            // Force-complete by calling again (backend may block — just show UI)
            await registerOthHdrFinish();
            state.sessionCompleted = true;
            saveTranscript();
            _markSessionCompleteLocally(state.regOthId);
            document.getElementById('completeBtnPanel').disabled = true;
            document.getElementById('completeBtnPanel').textContent = 'Session Completed';
            setChatInputState(true, 'Session completed.');
            if (completeUrl) {
                window.location.href = completeUrl;
                return;
            }
            await showCompletionUI(data.missingFields);
        }
    } catch (error) {
        console.error('Error completing session:', error);
        alert('Error completing session. Please try again.');
    }
}

async function showCompletionUI(missingFields) {
    // Ensure we have regTypeId before showing the button
    if (!state.regTypeId && state.regOthId) {
        try {
            console.log('⏳ regTypeId is missing, fetching from transcript API...');
            const transcriptUrl = `${TRANSCRIPT_API_URL}/${state.regOthId}?userId=${CONFIG.userId}&storeId=${CONFIG.storeId}`;
            const res = await fetch(transcriptUrl);
            if (res.ok) {
                const data = await res.json();
                if (data.regTypeID) {
                    state.regTypeId = data.regTypeID;
                    console.log('✅ Fetched and set state.regTypeId to:', state.regTypeId);
                }
            }
        } catch (e) {
            console.warn('Could not fetch regTypeId from transcript API:', e);
        }
    }

    const messagesArea = document.getElementById('messagesArea');

    const messageDiv = document.createElement('div');
    messageDiv.className = 'message assistant';

    const icon = document.createElement('div');
    icon.className = 'message-icon';
    icon.innerHTML = '<i class="ph-thin ph-chats-circle"></i>';

    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';

    let msg = ' Session completed! Thank you.';
    if (missingFields && missingFields.length > 0) {
        msg += ` You can edit the missing fields (${missingFields.join(', ')}) directly in the form.`;
    }
    contentDiv.textContent = msg;

    // Two action buttons
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'suggestions row g-2 mt-3';

    const openBtn = document.createElement('button');
    openBtn.className = 'btn btn-primary w-100';
    openBtn.innerHTML = '<i class="ph-thin ph-arrow-square-out" style="margin-right:4px"></i>Open Form';
    openBtn.onclick = () => { 
        console.log('🔵 Chat completion "Open Form" button clicked');
        const url = getFormUrl(); 
        console.log('📍 getFormUrl() returned:', url);
        if (url) {
            console.log('✅ Opening URL:', url);
            window.open(url, '_blank'); 
        } else {
            console.log('⚠️  getFormUrl() returned empty/null');
        }
    };

    const newBtn = document.createElement('button');
    newBtn.className = 'btn btn-outline-primary w-100';
    newBtn.innerHTML = '<i class="ph-thin ph-plus" style="margin-right:4px"></i>Start New';
    newBtn.onclick = () => startNewSession();

    const openCol = document.createElement('div');
    openCol.className = 'col-12 col-sm-6';
    openCol.appendChild(openBtn);

    const newCol = document.createElement('div');
    newCol.className = 'col-12 col-sm-6';
    newCol.appendChild(newBtn);

    actionsDiv.appendChild(openCol);
    actionsDiv.appendChild(newCol);
    contentDiv.appendChild(actionsDiv);

    messageDiv.appendChild(icon);
    messageDiv.appendChild(contentDiv);
    messagesArea.appendChild(messageDiv);
    scrollToBottom();

    if (state.voiceMode) speakText(msg);
}

function startNewSession() {
    // Stop voice mode cleanly before resetting
    if (state.voiceMode) stopVoiceMode();

    // Reset all state
    state.sessionStarted = false;
    state.sessionCompleted = false;
    state.smartFillTriggered = false;
    state.regOthId = null;
    state.internalNo = '';
    state.templateName = '';
    state.moduleName = '';
    state.conversationHistory = [];
    state.displayMessages = [];
    state.extractedFieldsMap = new Map();
    state.completionPercentage = 0;
    state.initialMessage = '';
    state.awaitingTemplateSelection = false;
    state.availableTemplates = [];
    state.additionalTemplateChoices = [];
    state.pendingResponse = null;
    state.sessionCost = { totalUSD: 0 };
    state.templateTypeId = null;
    state.regTypeId = null;
    state.pageId = null;
    state._headerData     = null;
    state._headerFields   = null;
    state._hdrAiQuestions = {};
    state._hdrLocTypeId   = null;
    state._hdrLocTypeName = null;
    state.chatName = '';
    state.awaitingChatName = false;
    state._pendingSessionData = null;
    state._chatCreatedAt = null;
    state._replayMode = false;
    state._serverMarkedComplete = false;
    state._isDashboardSession = false;
    state.awaitingHeaderField = false;
    state._headerFieldCallback = null;
    state.chatConfirmedFieldIds = []; // clear confirmed IDs — new session starts fresh
    updateCostDisplay();

    // Reset UI
    const messagesAreaEl = document.getElementById('messagesArea');
    messagesAreaEl.innerHTML = '';
    messagesAreaEl.classList.remove('active');
    document.getElementById('chatInputArea').style.display = 'none';
    document.getElementById('emptyState').style.display = '';
    setChatInputState(false, 'Type your message...');
    clearAllInputs();
    const existingWidget = document.getElementById('chatInlineProgress');
    if (existingWidget) existingWidget.style.display = 'none';
    state.totalFieldCount = 0;
    state.answeredFieldCount = 0;
    document.getElementById('progressBar').style.width = '0%';
    document.getElementById('panelProgressBar').style.width = '0%';
    document.getElementById('panelProgressText').textContent = '0% complete';
    document.getElementById('panelTemplateName').textContent = '-';
    document.getElementById('panelSessionId').textContent = '-';
    document.getElementById('panelInternalNo').textContent = '-';
    document.getElementById('panelFieldsList').innerHTML = '<div style="color:#9ca3af;font-size:13px;text-align:center;padding:20px;">No fields extracted yet</div>';
    const btn = document.getElementById('completeBtnPanel');
    btn.disabled = true;
    btn.textContent = 'Complete Session';
    document.getElementById('progressPanel').classList.remove('show');
    document.getElementById('debugInfo').classList.remove('show');
    document.getElementById('progressToggle').style.display = 'flex';

    // Clear topbar title and read-only banner
    setTopbarTitle('');
    const banner = document.getElementById('readonlyBanner');
    if (banner) banner.remove();

    // Re-render sidebar to deselect any active item
    renderSidebarChats();

    _historyState.loaded = false; // force refresh next time panel opens
}

function scrollToBottom() {
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
}

// ═══════════════════════════════════════════════════════════
//  SESSION HISTORY
// ═══════════════════════════════════════════════════════════

const _historyState = {
    loaded: false,
    page: 1,
    pageSize: 10,
    totalCount: 0,
    items: [],
    expandedId: null   // regOthId whose fields panel is open
};

const SESSION_HISTORY_URL  = CONFIG.apiUrl.replace('/chat-template', '/session-history');
const TRANSCRIPT_API_URL   = CONFIG.apiUrl.replace('/chat-template', '/chat-transcript');
const SMART_FILL_URL       = CONFIG.apiUrl.replace('/chat-template', '/smart-fill');

// In-memory cache of sidebar items — populated from API on load, updated locally on save.
let _sidebarItems = [];

// Base URL for the WHSMonitor ASMX web services (same host, session-cookie auth)
const ASMX_BASE_URL = (() => {
    try {
        const u = new URL(CONFIG.apiUrl);
        return `${u.protocol}//${u.host}/NetServices/POSTDynamicChecklist.asmx`;
    } catch { return '/NetServices/POSTDynamicChecklist.asmx'; }
})();

// Base URL for the session-free ASHX handlers (replaces GET-based ASMX calls)
const ASHX_BASE_URL = (() => {
    try {
        const u = new URL(CONFIG.apiUrl);
        return `${u.protocol}//${u.host}/App/NetServices`;
    } catch { return '/App/NetServices'; }
})();

// ═══════════════════════════════════════════════════════════
//  HEADER DETAILS COLLECTION
//  After naming a session, ask the "header" fields (Title, Date,
//  Location, Reported By, Division, Department, etc.) that come
//  from GetDetailProperties for the template's PageId.
// ═══════════════════════════════════════════════════════════

// Fields that are either auto-set or not supported in chat UI
const _HDR_SKIP_IDS = new Set([
    'wcIDTB',          // auto-number
    'wcCreatedBy',     // auto-set from session
    'wcDraft',         // auto
    'wcAttachUpld',    // file upload — not supported
    'wcLocationTB',    // auto-filled after location selection
    'wcTitleDesc',     // already collected as session name at chat start
    'wcTitleTB',       // alternate FieldControlID for title — same skip reason
]);

/**
 * Loads visible header fields for the current template's PageId via GetDetailProperties,
 * then walks the user through each field one at a time as inline cards.
 * Calls onComplete() when done (or immediately if no fields / no pageId).
 */
async function collectHeaderDetails(onComplete) {
    state._collectingHeaderDetails = true;
    state._headerDetailsReadyForChecklist = false;

    // Remove any stale checklist UI affordances while details flow is active.
    document.querySelectorAll('.suggestions, .checklist-skip-chip').forEach(el => el.remove());

    const transcriptPageId = state.regOthId ? (loadTranscript(state.regOthId)?.pageId || null) : null;
    const mappedPageId = (state.templateTypeId && TEMPLATE_TYPE_PAGE_MAP[state.templateTypeId])
        ? TEMPLATE_TYPE_PAGE_MAP[state.templateTypeId]
        : null;
    const pageId = state.pageId || mappedPageId || transcriptPageId || getCurrentPageId();
    if (!pageId) {
        console.warn('[Header] Skipping header questions: no PageId available.');
        state._collectingHeaderDetails = false;
        state._headerDetailsReadyForChecklist = true;
        onComplete();
        return;
    }
    state.pageId = pageId;

    try {
        let allFields = [];

        // Preferred source: GetDetailProperties.ashx
        const appName = 'WHSMONITOR';
        const detailPropsUrl = `${ASHX_BASE_URL}/GetDetailProperties.ashx?parentpage=${pageId}&ucpageid=${pageId}&memberId=${CONFIG.userId}&storeId=${CONFIG.storeId || 0}&applicationName=${encodeURIComponent(appName)}`;
        try {
            const detailResp = await fetch(detailPropsUrl, { method: 'GET', credentials: 'same-origin' });
            if (!detailResp.ok) throw new Error(`GetDetailProperties returned ${detailResp.status}`);
            const detailJson = await detailResp.json();
            allFields = (
                detailJson.d?.recordlist ||
                detailJson.d?.recordList ||
                detailJson.recordlist ||
                detailJson.recordList ||
                detailJson.data ||
                []
            );
        } catch (detailErr) {
            console.warn('[Header] GetDetailProperties failed, falling back to API:', detailErr);

            // Fallback: our API proxy
            const baseApi = CONFIG.apiUrl.replace(/\/chat-template.*$/, '');
            const proxyUrl = `${baseApi}/chat-template/header-fields?pageId=${pageId}&memberId=${CONFIG.userId}&regTypeId=${state.regTypeId || 0}&storeId=${CONFIG.storeId || 0}`;
            const resp = await fetch(proxyUrl, { method: 'GET', credentials: 'same-origin' });
            if (!resp.ok) throw new Error(`header-fields returned ${resp.status}`);
            const json = await resp.json();
            allFields = (json.d?.recordlist || json.d?.recordList || []);
        }

        const coreHeaderIds = new Set([
            'wcStartDtPkr', 'wcStartDtPkrFrom', 'wcStartDt',
            'wcLocationIDRadCombo', 'wcLocType', 'wcLocAddr', 'wcLocDet',
            'wcPersonRespCmb', 'wcDivisionCmb', 'wcDivision',
            'wcDepartmentCmb', 'wcDepartment', 'wcProgrammeCmb', 
            'wcRegRecTypeCombo', 'wcType',
            'wcRegRecSubTypeCombo', 'wcSubType',
            'wcCommTB', 'wcComm', 'wcReportsTo', 'wcProjectCombo',
            'wcContractorCompanyCMB', 'wcStatusCmb', 'wcSpecificLocTB', 
            'wcDescTB', 'wcStatusCombo'

        ]);
        const fields = allFields.filter(f => {
            const fieldId = String(f.FieldControlID || '');
            const caption = String(f.ColCaption || '');
            const isTitleField = /title/i.test(fieldId) || /title/i.test(caption);
            const isRequired = _isHeaderRequired(f);

            if (!f.ColVisible) return false;
            if (_HDR_SKIP_IDS.has(fieldId)) return false;
            if (isTitleField) return false;
            if (f.ControlType === 'Hidden' || f.ControlType === 'RadAsyncUpload') return false;

            // Ask only required fields (plus a small core set) on details stage.
            return isRequired || coreHeaderIds.has(fieldId);
        });

        if (!fields.length) {
            console.warn(`[Header] No visible header fields returned for PageId ${pageId}.`);
            state._collectingHeaderDetails = false;
            state._headerDetailsReadyForChecklist = true;
            onComplete();
            return;
        }

        const cachedHeaderData = state._headerData
            || (state.regOthId ? loadTranscript(state.regOthId)?.headerData : null)
            || {};

        state._headerData     = cachedHeaderData;
        state._headerFields   = fields;
        state._hdrAiQuestions = {};

        // Single batch AI call to rephrase all field labels into conversational questions
        const aiQ = await _loadAiHeaderQuestions(fields);
        if (aiQ) state._hdrAiQuestions = aiQ;

        const firstPendingIndex = _getNextPendingHeaderIndex(fields, 0);
        if (firstPendingIndex >= fields.length) {
            await _saveHeaderDetails(onComplete);
            return;
        }

        addMessage('assistant',
            aiQ?._intro ||
            `Before we start on the checklist, I just need a few quick details about this ${state.templateName || 'record'}.`
        );
        scrollToBottom();

        _askNextHeaderField(fields, firstPendingIndex, onComplete);
    } catch (err) {
        console.warn('[Header] Could not load field schema — skipping:', err);
        state._collectingHeaderDetails = false;
        state._headerDetailsReadyForChecklist = true;
        onComplete();
    }
}

function _askNextHeaderField(fields, index, onComplete) {
    const nextIndex = _getNextPendingHeaderIndex(fields, index);
    if (nextIndex >= fields.length) {
        _saveHeaderDetails(onComplete);
        return;
    }

    const currentField = fields[nextIndex];

    _showHeaderFieldCard(
        currentField,
        async (value, displayText) => {
            state._headerData[currentField.FieldControlID] = { value, displayText: displayText || value };
            saveTranscript();
            await _saveHeaderDetailsProgress();
            _askNextHeaderField(fields, nextIndex + 1, onComplete);
        },
        () => {
            // Hard guard: required header/details fields can never be skipped,
            // even if a nested control accidentally routes to onSkip.
            if (_isHeaderRequired(currentField)) {
                addMessage('assistant', "This detail is required, so we need to complete it before moving on.");
                scrollToBottom();
                return _askNextHeaderField(fields, nextIndex, onComplete);
            }

            _askNextHeaderField(fields, nextIndex + 1, onComplete);
        }
    );
}

/**
 * Single batch OpenAI call: convert all field labels into conversational questions.
 * Returns { _intro: '...', fieldControlId: 'question...', ... } or null on failure.
 */
async function _loadAiHeaderQuestions(fields) {
    if (!CONFIG.openaiApiKey || !fields.length) return null;
    const templateName = state.chatName || state.templateName || 'this record';
    const fieldList = fields.map(f => `${f.FieldControlID}|${f.ColCaption}|${f.ControlType}`).join('\n');
    try {
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${CONFIG.openaiApiKey}` },
            body: JSON.stringify({
                model: 'gpt-4o-mini',
                max_tokens: 600,
                temperature: 0.7,
                messages: [{
                    role: 'system',
                    content: `You are an AI assistant helping a worker fill in a "${templateName}" form via chat.\nConvert each field label into a short, warm, conversational question (max 10 words).\nAlso write a one-sentence friendly intro (key: "_intro") for starting the form section.\nReturn ONLY valid JSON: { "_intro": "...", "<FieldControlID>": "question...", ... }\nNo markdown or explanation.`
                }, {
                    role: 'user',
                    content: `Fields (id|label|type):\n${fieldList}`
                }]
            })
        });
        if (!res.ok) return null;
        const data = await res.json();
        trackCost('gpt-4o-mini', data.usage);
        const text = data.choices?.[0]?.message?.content?.trim();
        return text ? JSON.parse(text) : null;
    } catch (e) { console.warn('[Header] AI question rephrase failed:', e); return null; }
}

/** Parse a date from natural language or common formats. Returns Date or null. */
function _parseHdrDate(val) {
    const lower = (val || '').toLowerCase().trim();
    const today = new Date(); today.setHours(0, 0, 0, 0);

    // Simple keywords
    if (['today', 'now', "today's date", "today's"].includes(lower)) return today;
    if (lower === 'yesterday') { const d = new Date(today); d.setDate(d.getDate() - 1); return d; }
    if (lower === 'tomorrow')  { const d = new Date(today); d.setDate(d.getDate() + 1); return d; }

    // "N days/weeks/months ago" or "N days/weeks/months ago"
    const agoMatch = lower.match(/^(\d+)\s+(day|days|week|weeks|month|months)\s+ago$/);
    if (agoMatch) {
        const n = parseInt(agoMatch[1], 10);
        const unit = agoMatch[2];
        const d = new Date(today);
        if (unit.startsWith('day'))   d.setDate(d.getDate() - n);
        if (unit.startsWith('week'))  d.setDate(d.getDate() - n * 7);
        if (unit.startsWith('month')) d.setMonth(d.getMonth() - n);
        return d;
    }

    // "last week", "last month"
    if (lower === 'last week')  { const d = new Date(today); d.setDate(d.getDate() - 7); return d; }
    if (lower === 'last month') { const d = new Date(today); d.setMonth(d.getMonth() - 1); return d; }

    // dd/mm/yyyy or dd/mm/yy
    if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(val)) {
        const [dd, mm, yy] = val.split('/');
        const yyyy = yy.length === 2 ? '20' + yy : yy;
        const d = new Date(`${yyyy}-${mm.padStart(2,'0')}-${dd.padStart(2,'0')}`);
        return isNaN(d.getTime()) ? null : d;
    }
    // dd-mm-yyyy
    if (/^\d{1,2}-\d{1,2}-\d{2,4}$/.test(val)) {
        const [dd, mm, yy] = val.split('-');
        const yyyy = yy.length === 2 ? '20' + yy : yy;
        const d = new Date(`${yyyy}-${mm.padStart(2,'0')}-${dd.padStart(2,'0')}`);
        return isNaN(d.getTime()) ? null : d;
    }
    // Native parse (ISO, "21 Apr 2026", month names, etc.)
    const native = new Date(val);
    return isNaN(native.getTime()) ? null : native;
}

/**
 * _hdrPick — called from onclick in chip buttons rendered inside chat messages.
 * Resolves the current awaiting header field callback.
 */
function _hdrPick(value, displayText) {
    if (!state._headerFieldCallback) return;
    document.querySelectorAll('.hf-opts button').forEach(b => b.disabled = true);
    state.awaitingHeaderField = false;
    const cb = state._headerFieldCallback;
    state._headerFieldCallback = null;
    if (value === '__skip__') {
        addMessage('user', 'Skip');
        scrollToBottom();
        cb(null, null, true);
        return;
    }
    addMessage('user', displayText || value);
    scrollToBottom();
    cb(value, displayText || value, false);
}

/** Chip HTML helper — returns a Bootstrap col-wrapped btn */
function _hdrChip(value, label, extra, colClass) {
    const v = escapeHtml(String(value));
    const l = escapeHtml(String(label));
    const col = colClass || 'col-12 col-sm-12 col-md-4 col-lg-4';
    const isSkip = String(value) === '__skip__';
    const btnClass = isSkip ? 'btn btn-outline-primary w-100' : 'btn btn-primary w-100';
    return `<div class="${col}"><button class="hf-opt ${btnClass}" onclick="_hdrPick('${v}','${l}')" ${extra || ''}>${l}</button></div>`;
}

/** Set awaiting header field intercept */
function _awaitHdrText(cb) {
    state.awaitingHeaderField = true;
    state._headerFieldCallback = cb;
}

function _isHeaderRequired(field) {
    const required = field?.ColRequired;
    return required === true
    || required === 1
    || String(required).toLowerCase() === 'true'
    || String(required).toLowerCase() === '1'
    || String(required).toLowerCase() === 'yes'
    || String(required).toLowerCase() === 'y';
}

function _isSkipIntentText(value) {
    const text = String(value || '').trim().toLowerCase();
    if (!text) return false;

    const skipPhrases = new Set([
        'skip',
        'skip this',
        'skip for now',
        'later',
        'do later',
        'next',
        'next question',
        'move on',
        'pass',
        'leave blank',
        'leave it blank',
        'not now'
    ]);

    return skipPhrases.has(text);
}

function _containsSkipCueText(value) {
    const text = String(value || '').trim().toLowerCase();
    if (!text) return false;

    return /\b(skip|later|next|pass|move on|leave blank|leave it blank|not now|not applicable|n\/a)\b/i.test(text);
}

async function _analyzeHeaderSkipIntentWithAI(userInput, questionText, isRequired) {
    const text = String(userInput || '').trim();
    const deterministicSkip = _isSkipIntentText(text);
    const hasSkipCue = _containsSkipCueText(text);
    if (!text) {
        return { isSkipIntent: false, reply: '' };
    }

    // Normal answers should never be routed through skip classification.
    // Only analyze with AI when the text actually contains skip/defer language.
    if (!deterministicSkip && !hasSkipCue) {
        return { isSkipIntent: false, reply: '' };
    }

    if (!CONFIG.openaiApiKey) {
        return {
            isSkipIntent: deterministicSkip,
            reply: isRequired
                ? "I still need this required detail before we continue."
                : "No problem — we can skip this for now."
        };
    }

    try {
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${CONFIG.openaiApiKey}`
            },
            body: JSON.stringify({
                model: 'gpt-4o-mini',
                temperature: 0.2,
                max_tokens: 120,
                response_format: { type: 'json_object' },
                messages: [
                    {
                        role: 'system',
                        content:
`Classify whether the user wants to skip the current form field.
Return ONLY JSON with:
- isSkipIntent: boolean
- confidence: number
- reply: string

Rules:
- If user clearly means skip/defer/move on, set isSkipIntent=true.
- If uncertain, set isSkipIntent=false.
- If the user's text could reasonably be the actual answer to the field, set isSkipIntent=false.
- Never treat a normal field answer as skip intent.
- If isRequired=true and isSkipIntent=true, reply must politely say it cannot be skipped and ask for this same detail.
- If isRequired=false and isSkipIntent=true, reply should briefly acknowledge skipping.
- Keep reply natural and concise (one sentence).`
                    },
                    {
                        role: 'user',
                        content: JSON.stringify({
                            userInput: text,
                            fieldQuestion: questionText || '',
                            isRequired: !!isRequired
                        })
                    }
                ]
            })
        });

        if (!res.ok) {
            return {
                isSkipIntent: deterministicSkip,
                reply: isRequired
                    ? "I still need this required detail before we continue."
                    : "No problem — we can skip this for now."
            };
        }

        const data = await res.json();
        trackCost('gpt-4o-mini', data.usage);
        const raw = data?.choices?.[0]?.message?.content || '{}';

        let parsed = {};
        try { parsed = JSON.parse(raw); } catch { parsed = {}; }

        const aiConfidence = Number(parsed?.confidence || 0);
        const aiSkipIntent = parsed?.isSkipIntent === true && aiConfidence >= 0.9;
        const isSkipIntent = deterministicSkip || aiSkipIntent;
        return {
            isSkipIntent,
            reply: isSkipIntent ? String(parsed?.reply || '').trim() : ''
        };
    } catch {
        return {
            isSkipIntent: deterministicSkip,
            reply: isRequired
                ? "I still need this required detail before we continue."
                : "No problem — we can skip this for now."
        };
    }
}

function _normalizeHeaderFieldId(fid) {
    const id = String(fid || '');
    const map = {
        wcType: 'wcRegRecTypeCombo',
        wcSubType: 'wcRegRecSubTypeCombo',
        wcDivision: 'wcDivisionCmb',
        wcDepartment: 'wcDepartmentCmb',
        wcContractor: 'wcContractorCompanyCMB',
        wcLocType: 'wcLocationIDRadCombo',
        wcLocAddr: 'wcLocationTB',
        wcLocDet: 'wcSpecificLocTB',
        wcStartDt: 'wcStartDtPkr',
        wcComm: 'wcCommTB'
    };
    return map[id] || id;
}

function _getHeaderDataValue(...keys) {
    for (const key of keys) {
        const val = state._headerData?.[key]?.value;
        if (val !== undefined && val !== null && String(val) !== '') return val;
    }
    return null;
}

function _isHeaderValueMissing(field) {
    if (!field) return true;

    if (_isHeaderLocationField(field)) {
        const locationId = _getHeaderDataValue('wcLocationIDRadCombo', 'wcLocType');
        return locationId === null || locationId === undefined || String(locationId).trim() === '';
    }

    const fieldId = String(field.FieldControlID || '');
    const normalizedFieldId = _normalizeHeaderFieldId(fieldId);

    const directValue = state._headerData?.[fieldId]?.value;
    const normalizedValue = state._headerData?.[normalizedFieldId]?.value;
    const resolved = directValue !== undefined && directValue !== null ? directValue : normalizedValue;

    return resolved === undefined || resolved === null || String(resolved).trim() === '';
}

function _getFirstMissingRequiredHeaderIndex() {
    const fields = Array.isArray(state._headerFields) ? state._headerFields : [];
    for (let i = 0; i < fields.length; i++) {
        const field = fields[i];
        if (_isHeaderRequired(field) && _isHeaderValueMissing(field)) {
            return i;
        }
    }
    return -1;
}

function _getNextPendingHeaderIndex(fields, startIndex = 0) {
    const list = Array.isArray(fields) ? fields : [];
    for (let i = Math.max(0, Number(startIndex) || 0); i < list.length; i++) {
        if (_isHeaderValueMissing(list[i])) {
            return i;
        }
    }
    return list.length;
}

function _buildHeaderDetailsPayload(finalize = false) {
    const d   = state._headerData || {};
    const val = (id) => d[id]?.value || null;
    const int = (id) => {
        const v = val(id);
        return (v !== null && v !== undefined && String(v).trim() !== '' && parseInt(v, 10) > 0)
            ? parseInt(v, 10)
            : null;
    };

    const today = new Date().toISOString().split('T')[0];

    return {
        regOthID:       state.regOthId,
        storeID:        CONFIG.storeId,
        updatedByID:    CONFIG.userId,

        titleDesc:      val('wcTitleTB') || val('wcTitle') || (finalize ? (state.chatName || state.templateName || '') : null),
        startDt:        val('wcStartDtPkr') || val('wcStartDtPkrFrom') || val('wcStartDt') || null,
        endDt:          finalize ? today : null,

        locationTypeID: int('_locationTypeId') || int('wcLocType'),
        locationID:     int('wcLocationIDRadCombo'),
        locationName:   val('_locationName'),
        locationAddr:   val('wcLocationTB') || val('wcLocAddr'),
        locationDet:    val('wcSpecificLocTB') || val('wcLocDet'),

        responsibleID:  int('wcPersonRespCmb'),
        reportsToID:    int('wcReportsTo'),
        divisionID:     int('wcDivisionCmb') || int('wcDivision'),
        departmentID:   int('wcDepartmentCmb') || int('wcDepartment'),
        statusID:       int('wcStatusCombo'),

        othTypeID:      int('wcRegRecTypeCombo') || int('wcType'),
        othSubTypeID:   int('wcRegRecSubTypeCombo') || int('wcSubType'),
        projectID:      int('wcProjectCombo'),
        programme:      val('wcProgrammeCmb'),
        extDesc:        val('wcDescTB'),
        comments:       val('wcCommTB') || val('wcComm')
    };
}

async function _saveHeaderDetailsProgress({ finalize = false, announce = false } = {}) {
    if (!state.regOthId || !state._headerData) return false;

    try {
        const HEADER_DETAILS_URL = CONFIG.apiUrl.replace('/chat-template', '/chat-template/header-details');
        const resp = await fetch(HEADER_DETAILS_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(_buildHeaderDetailsPayload(finalize))
        });
        const result = await resp.json();
        if (!result.success) {
            console.warn('[Header] save returned:', result.message);
            return false;
        }

        if (finalize) {
            markHeaderDetailsCompleted(state.regOthId);
            saveTranscript();
        }

        if (announce) {
            addMessage('assistant', finalize
                ? 'Header details saved. Now let\'s complete the checklist.'
                : 'Saved that detail.');
        }

        return true;
    } catch (e) {
        console.warn('[Header] save error:', e);
        if (announce) {
            addMessage('assistant', finalize
                ? 'Could not save header details right now, but let\'s continue.'
                : 'I captured that detail, but couldn\'t save it yet.');
        }
        return false;
    }
}

function _isHeaderDateField(field) {
    const ct = String(field?.ControlType || '').toLowerCase();
    const fid = String(field?.FieldControlID || '');
    return ct === 'raddatetimepicker' || ['wcStartDtPkr', 'wcStartDtPkrFrom', 'wcStartDt'].includes(fid);
}

function _isHeaderLocationField(field) {
    const fid = String(field?.FieldControlID || '');
    return ['wcLocationIDRadCombo', 'wcLocType', 'wcLocAddr'].includes(fid);
}

function _isHeaderComboField(field) {
    const ct = String(field?.ControlType || '').toLowerCase();
    const fid = _normalizeHeaderFieldId(field?.FieldControlID || '');
    return ct.includes('combo') || ct.includes('dropdown') || [
        'wcLocationIDRadCombo',
        'wcPersonRespCmb',
        'wcReportsTo',
        'wcDivisionCmb',
        'wcDepartmentCmb',
        'wcRegRecTypeCombo',
        'wcRegRecSubTypeCombo',
        'wcProjectCombo',
        'wcProgrammeCmb',
        'wcStatusCombo',
        'wcContractorCompanyCMB'
    ].includes(fid);
}


function _hdrArmComboChatInput(msgId) {
    _awaitHdrText(async (val, display, isSkip) => {
        const ctx = window._hdrComboCtx;
        if (!ctx || ctx.msgId !== msgId) return;
        if (isSkip) {
            _hdrSkipCombo();
            return;
        }
        const input = document.getElementById(`${msgId}-input`);
        if (input) input.value = val || '';
        await _hdrRunComboSearch(msgId, val || '');
        if (window._hdrComboCtx && window._hdrComboCtx.msgId === msgId) {
            _hdrArmComboChatInput(msgId);
        }
    });
}

function _hdrRenderComboResults(msgId, results, emptyText) {
    const target = document.getElementById(`${msgId}-results`);
    if (!target) return;
    if (!results || !results.length) {
        target.innerHTML = `<div style="color:#9ca3af;font-size:12px;padding:4px 0;">${emptyText || 'No results found'}</div>`;
        return;
    }
    target.innerHTML = results.map(o =>
        `<button class="hf-opt" style="padding:6px 14px;border-radius:20px;border:1px solid #2d8eff;
            background:white;color:#2d8eff;cursor:pointer;font-size:13px;transition:all .15s;"
            onmouseover="this.style.background='#2d8eff';this.style.color='white'"
            onmouseout="this.style.background='white';this.style.color='#2d8eff'"
            onclick="_hdrChooseCombo(${JSON.stringify(String(o.id))}, ${JSON.stringify(String(o.text))})">${escapeHtml(String(o.text))}</button>`
    ).join(' ');
}

async function _hdrRunComboSearch(msgId, forcedQuery) {
    const ctx = window._hdrComboCtx;
    if (!ctx || ctx.msgId !== msgId) return;

    const input = document.getElementById(`${msgId}-input`);
    const query = (forcedQuery !== undefined ? forcedQuery : (input?.value || '')).trim();

    if (!ctx.preload && !query) {
        _hdrRenderComboResults(msgId, [], 'Type in the field above to search');
        return;
    }

    const results = await _fetchHeaderComboOptions(ctx.fid, query);
    ctx.results = results || [];

    if (!ctx.results.length) {
        _hdrRenderComboResults(msgId, [], `No matches found${query ? ` for "${escapeHtml(query)}"` : ''}`);
        return;
    }

    if (!ctx.preload && ctx.results.length === 1) {
        _hdrChooseCombo(String(ctx.results[0].id), ctx.results[0].text);
        return;
    }

    _hdrRenderComboResults(msgId, ctx.results.slice(0, 20), 'No results found');
}

function _hdrChooseCombo(value, text) {
    const ctx = window._hdrComboCtx;
    if (!ctx) return;
    document.querySelectorAll('.hf-opts button').forEach(b => b.disabled = true);
    const input = document.getElementById(`${ctx.msgId}-input`);
    const searchBtn = document.getElementById(`${ctx.msgId}-search`);
    const skipBtn = document.getElementById(`${ctx.msgId}-skip`);
    if (input) input.disabled = true;
    if (searchBtn) searchBtn.disabled = true;
    if (skipBtn) skipBtn.disabled = true;
    state.awaitingHeaderField = false;
    state._headerFieldCallback = null;
    addMessage('user', text || value);
    scrollToBottom();
    const onSave = ctx.onSave;
    window._hdrComboCtx = null;
    onSave(String(value), text || String(value));
}

function _hdrSkipCombo() {
    const ctx = window._hdrComboCtx;
    if (!ctx) return;
    state.awaitingHeaderField = false;
    state._headerFieldCallback = null;
    addMessage('user', 'Skip');
    scrollToBottom();
    const onSkip = ctx.onSkip;
    window._hdrComboCtx = null;
    onSkip();
}

/** Fetch combo options for a given field */
async function _fetchHeaderComboOptions(fid, query) {
    fid = _normalizeHeaderFieldId(fid);
    const q = (query || '').trim();
    try {
        if (fid === 'wcPersonRespCmb' || fid === 'wcReportsTo') {
            const locTypeId = state._headerData?.['_locationTypeId']?.value || 0;
            const locId     = _getHeaderDataValue('wcLocationIDRadCombo', 'wcLocType') || 0;
            const r = await fetch(`${ASMX_BASE_URL}/GetAuditedLimit`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ data: { StoreID: CONFIG.storeId, LocType: locTypeId, LocID: locId, MemberId: CONFIG.userId, Search: q } })
            });
            const j = await r.json();
            return (j.d?.recordList || j.d || []).map(x => ({ id: x.IDNo, text: x.RowDescription }));
        }
        if (fid === 'wcDivisionCmb') {
            const r = await fetch(`${ASHX_BASE_URL}/GetDivision.ashx?storeId=${CONFIG.storeId}&memberId=${CONFIG.userId}`);
            const j = await r.json();
            return (j.data || []).map(x => ({ id: x.IDNo, text: x.RowDescription }));
        }
        if (fid === 'wcDepartmentCmb') {
            const divId = _getHeaderDataValue('wcDivisionCmb', 'wcDivision') || 0;
            const r = await fetch(`${ASHX_BASE_URL}/GetDepartment.ashx?storeId=${CONFIG.storeId}&memberId=${CONFIG.userId}&parentId=${divId}`);
            const j = await r.json();
            return (j.data || []).map(x => ({ id: x.IDNo, text: x.RowDescription }));
        }
        if (fid === 'wcRegRecTypeCombo') {
            const r = await fetch(`${ASHX_BASE_URL}/GetRegisterRecTypes.ashx?storeId=${CONFIG.storeId}&regtype=${state.regTypeId}&memberId=${CONFIG.userId}`);
            const j = await r.json();
            return (j.data || []).map(x => ({ id: x.IDNo, text: x.RowDescription }));
        }
        if (fid === 'wcRegRecSubTypeCombo') {
            const typeId = _getHeaderDataValue('wcRegRecTypeCombo', 'wcType') || 0;
            const r = await fetch(`${ASHX_BASE_URL}/GetRegisterSubTypes.ashx?storeId=${CONFIG.storeId}&regtype=${state.regTypeId}&parent=${typeId}&memberId=${CONFIG.userId}`);
            const j = await r.json();
            return (j.data || []).map(x => ({ id: x.IDNo, text: x.RowDescription }));
        }
        if (fid === 'wcStatusCombo') {
            const r = await fetch(`${ASHX_BASE_URL}/GetStatus.ashx?regTypeId=${state.regTypeId}`);
            const j = await r.json();
            return (j.data || []).map(x => ({ id: x.IDNo, text: x.RowDescription }));
        }
        if (fid === 'wcProjectCombo') {
            const r = await fetch(`${ASHX_BASE_URL}/GetProjects.ashx?storeId=${CONFIG.storeId}&memberId=${CONFIG.userId}`);
            const j = await r.json();
            return (j.data || []).map(x => ({ id: x.Value, text: x.Text }));
        }
        if (fid === 'wcProgrammeCmb') {
            const deptId = _getHeaderDataValue('wcDepartmentCmb', 'wcDepartment') || 0;
            const r = await fetch(`${ASHX_BASE_URL}/GetProgrammes.ashx?storeId=${CONFIG.storeId}&memberId=${CONFIG.userId}&parentId=${deptId}`);
            const j = await r.json();
            return (j.data || []).map(x => ({ id: x.RowDescription, text: x.RowDescription }));
        }
        if (fid === 'wcContractorCompanyCMB') {
            const r = await fetch(`${ASHX_BASE_URL}/GetJSMSContractorList.ashx?storeId=${CONFIG.storeId}&memberId=${CONFIG.userId}`);
            const j = await r.json();
            return (j.data || []).map(x => ({ id: x.IDNo, text: x.RowDescription }));
        }
    } catch (e) { console.warn(`[Header] combo fetch error (${fid}):`, e); }
    return [];
}

/** Deterministic combo UI — uses the same search/dropdown/button design as the checklist. */
async function _showHeaderComboField(field, onSave, onSkip) {
    const rawFid   = field.FieldControlID;
    const fid      = _normalizeHeaderFieldId(rawFid);
    const label    = escapeHtml(field.ColCaption);
    const question = state._hdrAiQuestions?.[rawFid] || state._hdrAiQuestions?.[fid] || label;
    const req      = _isHeaderRequired(field);

    if (_isHeaderLocationField(field)) {
        await _showHeaderLocationField(onSave, onSkip, req);
        return;
    }

    // Preload fids: load all options on focus; search fids: debounce search on input
    const preloadFids = ['wcDivisionCmb','wcDepartmentCmb','wcRegRecTypeCombo',
                         'wcStatusCombo','wcProjectCombo','wcProgrammeCmb',
                         'wcRegRecSubTypeCombo','wcContractorCompanyCMB'];
    const isPreload = preloadFids.includes(fid);

    // Show the AI question as a plain assistant message first
    addMessage('assistant', question);
    scrollToBottom();

    // Append the checklist-style container directly into the last message bubble
    const messagesArea = document.getElementById('messagesArea');
    const lastMsg = messagesArea.lastElementChild;
    const msgContent = lastMsg?.querySelector('.message-content');
    if (!msgContent) { onSkip(); return; }

    const container = document.createElement('div');
    //container.style.cssText = 'margin-top:12px;padding:16px;background:#f8f9fa;border-radius:8px;border:1px solid #e5e7eb;width:100%;max-width:520px;box-sizing:border-box;';
    container.innerHTML = `
        <div class="chat-floating-select-wrap" style="margin-top:0;">
            <span class="chat-floating-label">Select an option</span>
            <div style="position:relative;">
                <input type="text" class="hdr-cmb-search chat-floating-input" autocomplete="off"
                       placeholder="Type to search...">
                <input type="hidden" class="hdr-cmb-value" value="">
                <div class="hdr-cmb-dd chat-floating-dd" style="display:none;"></div>
            </div>
        </div>
        <div style="margin-top:10px;display:flex;gap:8px;">
            <button class="hdr-cmb-confirm btn btn-primary">Confirm Selection</button>
            ${!req ? _skipChipButtonHtml({ className: 'hdr-cmb-skip', label: 'Skip (optional)' }) : ''}
        </div>
        <div class="hdr-cmb-err" style="display:none;color:#ef4444;font-size:12px;margin-top:6px;">Please choose a value from the list.</div>
    `;
    msgContent.appendChild(container);
    scrollToBottom();

    const searchEl  = container.querySelector('.hdr-cmb-search');
    const valueEl   = container.querySelector('.hdr-cmb-value');
    const ddEl      = container.querySelector('.hdr-cmb-dd');
    const confirmBtn= container.querySelector('.hdr-cmb-confirm');
    const skipBtn   = container.querySelector('.hdr-cmb-skip');
    const errEl     = container.querySelector('.hdr-cmb-err');
    let timer = null;
    let cachedItems = [];

    const disable = () => [searchEl, confirmBtn, skipBtn].forEach(x => { if (x) x.disabled = true; });

    const renderDropdown = (items) => {
        cachedItems = items || [];
        if (!cachedItems.length) {
            ddEl.innerHTML = '<div class="chat-floating-dd-empty">No results found</div>';
            ddEl.style.display = 'block';
            return;
        }
        ddEl.innerHTML = cachedItems.map((o, idx) =>
            `<div class="chat-floating-dd-item hdr-dd-item" data-idx="${idx}">${escapeHtml(String(o.text))}</div>`
        ).join('');
        ddEl.style.display = 'block';
        ddEl.querySelectorAll('.hdr-dd-item').forEach(el => {
            el.addEventListener('mousedown', (e) => {
                e.preventDefault();
                const item = cachedItems[parseInt(el.dataset.idx)];
                valueEl.value  = String(item.id);
                searchEl.value = String(item.text);
                ddEl.style.display = 'none';
                errEl.style.display = 'none';
            });
        });
    };

    // Preload: fetch all options on focus; search: debounce on input
    searchEl.addEventListener('focus', async () => {
        if (isPreload && ddEl.style.display === 'none') {
            ddEl.innerHTML = '<div class="chat-floating-dd-empty">Loading...</div>';
            ddEl.style.display = 'block';
            renderDropdown(await _fetchHeaderComboOptions(fid, ''));
        }
    });

    searchEl.addEventListener('input', () => {
        valueEl.value = '';
        clearTimeout(timer);
        const q = searchEl.value.trim();
        if (isPreload) {
            // Filter already-loaded items client-side
            const filtered = cachedItems.filter(o => String(o.text).toLowerCase().includes(q.toLowerCase()));
            renderDropdown(filtered.length ? filtered : cachedItems);
            return;
        }
        if (q.length < 2) { ddEl.style.display = 'none'; return; }
        ddEl.innerHTML = '<div class="chat-floating-dd-empty">Searching...</div>';
        ddEl.style.display = 'block';
        timer = setTimeout(async () => renderDropdown(await _fetchHeaderComboOptions(fid, q)), 300);
    });

    document.addEventListener('click', (e) => {
        if (!container.contains(e.target)) ddEl.style.display = 'none';
    }, { passive: true });

    if (skipBtn) skipBtn.onclick = () => { disable(); onSkip(); };

    confirmBtn.onclick = () => {
        if (!valueEl.value) { errEl.style.display = 'block'; return; }
        errEl.style.display = 'none';
        disable();
        onSave(String(valueEl.value), searchEl.value.trim());
    };

    setTimeout(() => searchEl.focus(), 60);
}

/** Called from location type chip onclick — updates the active location type in state */
function _hdrLocTypeSelect(id, name) {
    state._hdrLocTypeId   = id;
    state._hdrLocTypeName = name;
    // Update visual selection
    document.querySelectorAll('.hf-loc-type').forEach(b => {
        const active = b.dataset.id == id;
        b.style.borderColor = active ? '#2d8eff' : '#d1d5db';
        b.style.background  = active ? '#2d8eff' : 'white';
        b.style.color       = active ? 'white'   : '#374151';
    });
}

/** Deterministic location field: location type buttons + inline search field + Save. */
async function _showHeaderLocationField(onSave, onSkip, isRequired = false) {
    const question = state._hdrAiQuestions?.['wcLocationIDRadCombo'] || 'Where is this taking place?';
    const effectiveIsRequired = !!isRequired;
    const msgId = `hdr-loc-${Date.now()}`;
    let locTypes = [];

    try {
        const baseApi = CONFIG.apiUrl.replace(/\/chat-template.*$/, '');
        const r = await fetch(`${baseApi}/chat-template/location-types?storeId=${CONFIG.storeId}&memberId=${CONFIG.userId}`);
        const j = await r.json();
        locTypes = j.d?.recordlist || [];
    } catch (e) { console.warn('[Header] location types error:', e); }

    if (locTypes.length) {
        state._hdrLocTypeId = locTypes[0].id;
        state._hdrLocTypeName = locTypes[0].name;
        state._headerData['_locationTypeId'] = { value: locTypes[0].id, displayText: locTypes[0].name };
    }

    addMessage('assistant',
        `<div style="margin-bottom:8px;">${question}</div>
         <div id="${msgId}-types" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;">
             ${locTypes.map((t, i) => `<button type="button" class="hf-loc-type btn btn-sm ${i===0 ? 'btn-primary' : 'btn-outline-primary'}" data-id="${t.id}" data-name="${escapeHtml(t.name)}">${escapeHtml(t.name)}</button>`).join('')}
         </div>
         <div class="chat-floating-select-wrap" style="margin-top:0;">
             <span class="chat-floating-label">Location</span>
             <div style="position:relative;">
                 <input id="${msgId}-search" type="text" class="chat-floating-input" autocomplete="off" placeholder="Find a location...">
                 <input id="${msgId}-value" type="hidden" value="">
                 <div id="${msgId}-dd" class="chat-floating-dd" style="display:none;"></div>
             </div>
         </div>
         <div style="display:flex;gap:8px;margin-top:10px;">
             <button id="${msgId}-save" class="btn btn-primary">Save</button>
             ${!effectiveIsRequired ? _skipChipButtonHtml({ id: `${msgId}-skip`, label: 'Skip (optional)' }) : ''}
         </div>
         <div id="${msgId}-err" style="display:none;color:#ef4444;font-size:12px;margin-top:6px;">Please choose a location from the list.</div>`);
    scrollToBottom();

    const typesEl = document.getElementById(`${msgId}-types`);
    const searchEl = document.getElementById(`${msgId}-search`);
    const valueEl = document.getElementById(`${msgId}-value`);
    const ddEl = document.getElementById(`${msgId}-dd`);
    const saveBtn = document.getElementById(`${msgId}-save`);
    const skipBtn = document.getElementById(`${msgId}-skip`);
    const err = document.getElementById(`${msgId}-err`);
    let timer = null;
    let selected = null;

    const disable = () => [searchEl, saveBtn, skipBtn].forEach(x => { if (x) x.disabled = true; });
    const renderList = (items) => {
        if (!items.length) {
            ddEl.innerHTML = '<div class="chat-floating-dd-empty">No results</div>';
            ddEl.style.display = 'block';
            return;
        }
        ddEl.innerHTML = items.map(x =>
            `<div class="chat-floating-dd-item hf-loc-item" data-id="${escapeHtml(String(x.IDNo))}" data-name="${escapeHtml(x.RowDescription)}" data-address="${escapeHtml(x.Address || '')}">${escapeHtml(x.RowDescription)}</div>`
        ).join('');
        ddEl.style.display = 'block';
        ddEl.querySelectorAll('.hf-loc-item').forEach(item => {
            item.addEventListener('mousedown', (e) => {
                e.preventDefault();
                selected = {
                    id: item.dataset.id,
                    name: item.dataset.name,
                    address: item.dataset.address,
                    locTypeId: state._hdrLocTypeId
                };
                valueEl.value = selected.id;
                searchEl.value = selected.name;
                ddEl.style.display = 'none';
                err.style.display = 'none';
            });
        });
    };

    typesEl.querySelectorAll('.hf-loc-type').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            typesEl.querySelectorAll('.hf-loc-type').forEach(b => {
                b.classList.remove('btn-primary');
                b.classList.add('btn-outline-primary');
            });
            btn.classList.remove('btn-outline-primary');
            btn.classList.add('btn-primary');
            state._hdrLocTypeId = btn.dataset.id;
            state._hdrLocTypeName = btn.dataset.name;
            state._headerData['_locationTypeId'] = { value: btn.dataset.id, displayText: btn.dataset.name };
            selected = null;
            valueEl.value = '';
            searchEl.value = '';
            ddEl.style.display = 'none';
            searchEl.focus();
        });
    });

    searchEl.addEventListener('input', () => {
        selected = null;
        valueEl.value = '';
        clearTimeout(timer);
        const q = searchEl.value.trim();
        if (q.length < 2) {
            ddEl.style.display = 'none';
            return;
        }
        timer = setTimeout(async () => {
            try {
                const r = await fetch(`${ASMX_BASE_URL}/GetLocationTypeAddressListv2`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ locRequest: {
                        StoreID: CONFIG.storeId,
                        LocType: state._hdrLocTypeId,
                        MemberId: CONFIG.userId,
                        Condition: q,
                        TotalCount: 20
                    }})
                });
                const j = await r.json();
                renderList(j.d?.recordList || []);
            } catch (e) {
                console.warn('[Header] location search error:', e);
                ddEl.style.display = 'none';
            }
        }, 250);
    });

    document.addEventListener('click', (e) => {
        if (!searchEl.contains(e.target) && !ddEl.contains(e.target)) ddEl.style.display = 'none';
    }, { passive: true });

    const clearHeaderAwait = () => {
        state.awaitingHeaderField = false;
        state._headerFieldCallback = null;
    };

    if (skipBtn) skipBtn.onclick = () => {
        clearHeaderAwait();
        disable();
        onSkip();
    };

    saveBtn.onclick = () => {
        if (!selected || !valueEl.value) {
            err.style.display = 'block';
            return;
        }
        err.style.display = 'none';
        clearHeaderAwait();
        disable();
        _doSelectLocation(selected.id, selected.name, selected.address || '', selected.locTypeId, onSave);
    };

    const armTypedLocationInput = () => {
        _awaitHdrText(async (val, display, isSkip) => {
            const intent = await _analyzeHeaderSkipIntentWithAI(val, question, effectiveIsRequired);
            const typedSkipIntent = intent.isSkipIntent;

            if (isSkip || typedSkipIntent) {
                if (effectiveIsRequired) {
                    addMessage('assistant', intent.reply || "I still need this required location detail before we continue.");
                    scrollToBottom();
                    return armTypedLocationInput();
                }

                if (intent.reply) {
                    addMessage('assistant', intent.reply);
                    scrollToBottom();
                }

                clearHeaderAwait();
                disable();
                onSkip();
                return;
            }

            const typed = String(val || '').trim();
            if (!typed) {
                return armTypedLocationInput();
            }

            searchEl.value = typed;
            searchEl.dispatchEvent(new Event('input', { bubbles: true }));
            armTypedLocationInput();
        });
    };

    armTypedLocationInput();
    setTimeout(() => searchEl.focus(), 60);
}

/** Called from location result chip onclick */
function _hdrLocPick(id, name, address, locTypeId) {
    document.querySelectorAll('.hf-opts button').forEach(b => b.disabled = true);
    state.awaitingHeaderField = false;
    state._headerFieldCallback = null;
    addMessage('user', name);
    scrollToBottom();
    _doSelectLocation(id, name, address, locTypeId, window._hdrLocOnSave);
    window._hdrLocOnSave = null;
}

function _doSelectLocation(id, name, address, locTypeId, onSave) {
    state._headerData['wcLocationTB']    = { value: address,  displayText: address };
    state._headerData['_locationName']   = { value: name,     displayText: name };
    state._headerData['_locationTypeId'] = { value: locTypeId, displayText: '' };
    onSave(String(id), name);
}

/** Renders a single header field as a chat question with appropriate interaction */
async function _showHeaderFieldCard(field, onSave, onSkip) {
    const label    = escapeHtml(field.ColCaption);
    const question = state._hdrAiQuestions?.[field.FieldControlID] || label;
    const req      = _isHeaderRequired(field);
    const ct       = field.ControlType;

    if (_isHeaderDateField(field)) {
        const today     = new Date();
        const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
        const fmt        = d => d.toISOString().split('T')[0];
        const fmtDisplay = d => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
        const todayLabel     = 'Today — ' + fmtDisplay(today);
        const yesterdayLabel = 'Yesterday — ' + fmtDisplay(yesterday);
        const dateLabels = req ? [todayLabel, yesterdayLabel] : [todayLabel, yesterdayLabel, 'Skip (optional)'];
        const dateColClass = getSuggestionColClass(dateLabels);
        addMessage('assistant',
            `<div
                <div style="margin-bottom:8px;color:#374151;">${question}</div>
                <div class="hf-opts row g-2">
                    ${_hdrChip(fmt(today),     todayLabel, undefined, dateColClass)}
                    ${_hdrChip(fmt(yesterday), yesterdayLabel, undefined, dateColClass)}
                    ${req ? '' : _hdrChip('__skip__', 'Skip (optional)', undefined, dateColClass)}
                </div>
                <div style="color:#9ca3af;font-size:12px;margin-top:6px;">Or type a date (e.g. today, yesterday, 3 days ago, 21/04/2026)</div>
            </div>`);

        _awaitHdrText(async (val, display, isSkip) => {
            const intent = await _analyzeHeaderSkipIntentWithAI(val, question, req);
            const typedSkipIntent = intent.isSkipIntent;

            if (isSkip || typedSkipIntent) {
                if (req) {
                    addMessage('assistant', intent.reply || "I still need this required date before we continue.");
                    return _showHeaderFieldCard(field, onSave, onSkip);
                }

                if (intent.reply) addMessage('assistant', intent.reply);
                onSkip();
                return;
            }

            const d = _parseHdrDate(val);
            if (!d) {
                addMessage('assistant', `I couldn't understand that date. Try: "today", "yesterday", "3 days ago", "last week", or 21/04/2026:`);
                return _showHeaderFieldCard(field, onSave, onSkip);
            }
            onSave(d.toISOString().split('T')[0], display || val);
        });

    } else if (_isHeaderComboField(field)) {
        await _showHeaderComboField(field, onSave, onSkip);
        return;

    } else {
        // RadTextBox (or unknown) — ask question, user types in chat box
        addMessage('assistant',
            `<div>${question}</div>
             ${ !req ? `<div class="hf-opts row g-2 mt-1">${_hdrChip('__skip__','Skip (optional)', undefined, 'col-12 col-sm-12 col-md-12 col-lg-12')}</div>` : '' }`);

        _awaitHdrText(async (val, display, isSkip) => {
            const intent = await _analyzeHeaderSkipIntentWithAI(val, question, req);
            const typedSkipIntent = intent.isSkipIntent;

            if (isSkip || typedSkipIntent) {
                if (req) {
                    addMessage('assistant', intent.reply || "I still need this required detail before we continue.");
                    return _showHeaderFieldCard(field, onSave, onSkip);
                }

                if (intent.reply) addMessage('assistant', intent.reply);
                onSkip();
                return;
            }

            if (req && !val.trim()) {
                addMessage('assistant', `This field is required — please enter a value:`);
                return _showHeaderFieldCard(field, onSave, onSkip);
            }
            onSave(val.trim(), val.trim());
        });
    }
    scrollToBottom();
}

/**
 * Saves collected header data via DynamicChecklistUpdateHeaderStart ASMX.
 * Converts date format from yyyy-MM-dd → M/d/yyyy as expected by the SP.
 */
async function _saveHeaderDetails(onComplete) {
    if (!state.regOthId || !state._headerData) {
        state._collectingHeaderDetails = false;
        state._headerDetailsReadyForChecklist = true;
        onComplete();
        return;
    }

    // Hard gate: never continue to checklist while required header/details fields are missing.
    const firstMissingRequiredIndex = _getFirstMissingRequiredHeaderIndex();
    if (firstMissingRequiredIndex >= 0) {
        state._collectingHeaderDetails = true;
        state._headerDetailsReadyForChecklist = false;
        addMessage('assistant', 'We still need a required detail before moving on.');
        scrollToBottom();
        _askNextHeaderField(state._headerFields || [], firstMissingRequiredIndex, onComplete);
        return;
    }

    await _saveHeaderDetailsProgress({ finalize: true, announce: true });

    state._collectingHeaderDetails = false;
    state._headerDetailsReadyForChecklist = true;
    onComplete();
}

// ── Smart Fill ────────────────────────────────────────────────────────────────

/**
 * Calls POST /api/smart-fill with the current conversation history and shows
 * a confirmation card if the AI can propose values for any fields.
 * Triggered automatically after the first AI response when the toggle is ON.
 */
async function runSmartFill() {
    if (!state.regOthId || !isSmartFillEnabled()) return;

    try {
        const response = await fetch(SMART_FILL_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                regOthID:        state.regOthId,
                storeID:         CONFIG.storeId,
                userProfile:     CONFIG.userProfile,
                chatHistory:     state.conversationHistory,
                currentDateTime: new Date().toISOString(),
                userTimezone:    Intl.DateTimeFormat().resolvedOptions().timeZone,
                userDateFormat:  getUserDateFormat()
            })
        });

        const data = await response.json();
        if (!data.success) {
            removeSmartFillTyping();
            console.warn('[SmartFill] returned unsuccessful response:', data.message || data);

            if (handleCompletedSessionRefusal(data.message)) return;

            // Do not block checklist progression when Smart Fill is unavailable/fails.
            setTimeout(() => continueFromSmartFill(), 300);
            return;
        }

        if (data.proposals && data.proposals.length > 0) {
            showSmartFillCard(data.proposals);
        } else {
            removeSmartFillTyping();
            // No proposals found — proceed directly to asking the first question
            setTimeout(() => continueFromSmartFill(), 300);
        }
    } catch (err) {
        removeSmartFillTyping();
        console.warn('[SmartFill] API error:', err);

        // Fail open: continue checklist flow even if Smart Fill call fails.
        setTimeout(() => continueFromSmartFill(), 300);
    }
}

/**
 * Renders a confirmation card in the chat area listing all AI proposals.
 * Each proposal has a checkbox so the user can deselect any they don't want.
 */
function showSmartFillCard(proposals) {
    const messagesArea = document.getElementById('messagesArea');
    if (!messagesArea) return;

    // Remove the Smart Fill typing indicator
    removeSmartFillTyping();

    // Remove any existing smart-fill card
    const existing = document.getElementById('smartFillCard');
    if (existing) existing.remove();

    const card = document.createElement('div');
    card.id = 'smartFillCard';
    card.className = 'message assistant';
    card.style.cssText = 'align-items:flex-start;';

    const icon = document.createElement('div');
    icon.className = 'message-icon';
    icon.innerHTML = '<i class="ph-thin ph-magic-wand"></i>';

    const content = document.createElement('div');
    content.className = 'message-content';
    content.style.cssText = 'max-width:100%;';

    const confidenceColor = { high: '#059669', medium: '#d97706', low: '#9ca3af' };

    let rows = proposals.map((p, i) => `
        <label style="display:flex;align-items:flex-start;gap:10px;padding:8px 0;border-bottom:1px solid #f3f4f6;cursor:pointer;">
            <input type="checkbox" class="sf-check" data-index="${i}" checked
                style="margin-top:3px;width:15px;height:15px;accent-color:#2d8eff;flex-shrink:0;">
            <div style="flex:1;min-width:0;">
                <div style="font-weight:600;font-size:13px;color:#374151;">${escapeHtml(p.fieldName)}</div>
                <div style="font-size:13px;color:#111827;margin-top:2px;">${escapeHtml(p.proposedValue)}</div>
                ${p.reasoning ? `<div style="font-size:11px;color:#9ca3af;margin-top:2px;">${escapeHtml(p.reasoning)}</div>` : ''}
            </div>
            <span style="font-size:11px;color:${confidenceColor[p.confidence]||'#9ca3af'};flex-shrink:0;margin-top:3px;">${p.confidence}</span>
        </label>
    `).join('');

    content.innerHTML = `
        <div style="font-weight:600;margin-bottom:10px;color:#374151;">
            Smart Fill found ${proposals.length} value${proposals.length !== 1 ? 's' : ''} — confirm to save:
        </div>
        <div id="sfRows">${rows}</div>
        <div style="display:flex;gap:8px;margin-top:14px;">
            <button id="sfConfirmBtn" onclick="confirmSmartFill(${JSON.stringify(proposals).replace(/"/g, '&quot;')})"
                style="flex:1;padding:8px 14px;background:#2d8eff;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;">
                Confirm Selected
            </button>
            ${_skipChipButtonHtml({
                label: 'Skip',
                extraStyle: 'padding:8px 14px;font-style:normal;',
                extraAttrs: `onclick="document.getElementById('smartFillCard').remove(); continueFromSmartFill();"`
            })}
        </div>
    `;

    card.appendChild(icon);
    card.appendChild(content);
    messagesArea.appendChild(card);
    messagesArea.scrollTop = messagesArea.scrollHeight;

    // Store proposals on the card so confirmSmartFill can access them
    card._proposals = proposals;
}

/**
 * Saves the checked proposals via POST /api/smart-fill/confirm then removes the card.
 */
async function confirmSmartFill(proposals) {
    const card = document.getElementById('smartFillCard');
    const checks = card ? card.querySelectorAll('.sf-check') : [];

    // Show loading state on the confirm button
    const confirmBtn = document.getElementById('sfConfirmBtn');
    if (confirmBtn) {
        confirmBtn.disabled = true;
        confirmBtn.innerHTML = '<div class="typing-indicator" style="display:inline-flex;gap:3px;vertical-align:middle;"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div>';
        confirmBtn.style.cursor = 'not-allowed';
        confirmBtn.style.opacity = '0.8';
    }

    const confirmed = [];
    checks.forEach((cb, i) => {
        if (cb.checked && proposals[i]) {
            confirmed.push({ fieldID: proposals[i].fieldID, value: proposals[i].proposedValue });
        }
    });

    if (confirmed.length === 0) {
        if (card) card.remove();
        // Nothing confirmed — still need to ask the first question
        setTimeout(() => continueFromSmartFill(), 300);
        return;
    }

    try {
        const response = await fetch(`${SMART_FILL_URL}/confirm`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                regOthID:        state.regOthId,
                storeID:         CONFIG.storeId,
                userID:          CONFIG.userId,
                confirmedFields: confirmed
            })
        });

        const data = await response.json();

        if (data.success) {
            // Update local state so the panel reflects the new values
            confirmed.forEach(f => {
                state.extractedFieldsMap.set(String(f.fieldID), {
                    fieldID:        f.fieldID,
                    extractedValue: f.value
                });
            });
            // Mark smart-fill-confirmed fields so the server doesn't re-ask them
            markFieldsConfirmed(confirmed.map(f => ({ fieldID: f.fieldID })));
            updateFieldsList();

            if (card) card.remove();

            // Show a brief confirmation chip then continue with remaining fields
            addMessage('assistant', `${data.savedCount} field${data.savedCount !== 1 ? 's' : ''} saved by Smart Fill.`);
            setTimeout(() => continueFromSmartFill(), 600);
        } else {
            addMessage('assistant', `Smart Fill saved ${data.savedCount} fields but ${data.errors?.length || 0} failed.`);
            if (card) card.remove();
            setTimeout(() => continueFromSmartFill(), 600);
        }
    } catch (err) {
        // Restore button on error
        if (confirmBtn) {
            confirmBtn.disabled = false;
            confirmBtn.innerHTML = 'Confirm Selected';
            confirmBtn.style.cursor = 'pointer';
            confirmBtn.style.opacity = '1';
        }
        console.warn('[SmartFill] Confirm error:', err);
        addMessage('assistant', ' Smart Fill confirmation failed. Please try again.');
    }
}

/**
 * Silent continuation after Smart Fill — calls /chat without showing a user bubble.
 * Tells the AI to ask the next unanswered field.
 */
async function continueFromSmartFill() {
    const silentMessage = 'Please continue and ask me about the next field that still needs to be filled.';

    // Add to history so AI has context, but do NOT show in chat UI
    state.conversationHistory.push({ role: 'user', content: silentMessage });

    const _lastReal = [...state.conversationHistory].reverse().find(m => m.role === 'user' && m.content !== silentMessage)?.content || '';
    showTypingIndicator(_lastReal);

    try {
        const response = await fetch(`${CONFIG.apiUrl}/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                regOthID:               state.regOthId,
                storeID:                CONFIG.storeId,
                userMessage:            silentMessage,
                userID:                 CONFIG.userId,
                conversationHistory:    state.conversationHistory.slice(-10),
                fullConversationHistory: state.conversationHistory,
                currentDateTime:        new Date().toISOString(),
                userTimezone:           Intl.DateTimeFormat().resolvedOptions().timeZone,
                userDateFormat:         getUserDateFormat(),
                memoryConfidence:       localStorage.getItem('memoryConfidence') || 'medium',
                userProfile:            CONFIG.userProfile,
                confirmedFieldIds:      state.chatConfirmedFieldIds
            })
        });

        const data = await response.json();
        removeTypingIndicator();

        if (data.success) {
            state.conversationHistory.push({ role: 'assistant', content: data.aiMessage });
            trackServerCost(data.tokenUsage);

            state.currentFieldID   = data.currentFieldID;
            state.currentFieldType = data.currentFieldType;
            state.currentFieldRequired = data.isCurrentFieldRequired !== false;
            state.currentFieldDynamicFilter = data.currentFieldDynamicFilter || null;

            // Track any fields saved in this continuation call
            if (data.extractedFields && data.extractedFields.length > 0) {
                markFieldsConfirmed(data.extractedFields);
            }

            if (state.currentFieldType !== '10016' && state.lastMapData) {
                state.lastMapData = null;
            }

            // Helper: show the AI message + next field UI
            const showNextQuestionAndFieldUI = () => {
                addMessage('assistant', data.aiMessage);

                setTimeout(() => {
                    const existingFileUpload = document.querySelector('.file-upload-container');
                    const existingMapContainer = document.querySelector('.map-container');
                    const existingDynamicData = document.querySelector('.dynamic-data-container');

                    if (state.currentFieldType !== '10013' && existingFileUpload) existingFileUpload.remove();
                    if (state.currentFieldType !== '10016' && existingMapContainer) existingMapContainer.remove();
                    if (state.currentFieldType !== '10020' && state.currentFieldType !== '10037' && existingDynamicData) existingDynamicData.remove();

                    if (state.currentFieldType === '10013') {
                        addFileUploadUI();
                    } else if ((state.currentFieldType === '10020' || state.currentFieldType === '10026' || state.currentFieldType === '10037') && state.currentFieldDynamicFilter) {
                        addDynamicDataUI(state.currentFieldType, state.currentFieldDynamicFilter);
                    } else if (state.currentFieldType === '10016') {
                        addMapUI(null);
                    }

                    if (data.nextSuggestedQuestions && data.nextSuggestedQuestions.length > 0
                        && state.currentFieldType !== '10016') {
                        addSuggestions(data.nextSuggestedQuestions);
                    }
                    addSkipChipIfOptional();
                }, 50);
            };

            setTimeout(() => {
                addSupplementaryPromptUI(
                    data.showPhotoFieldIds,
                    data.showCommentFieldIds,
                    data.showActionFieldIds,
                    data.showHazardInfo || null,
                    data.extractedFields,
                    data,
                    showNextQuestionAndFieldUI
                );
            }, 50);

            if (data.completionPercentage !== undefined) {
                updateProgress(data.completionPercentage, data.totalFields, data.answeredFields);
            }
            if (data.isComplete) state._serverMarkedComplete = true;
            setTimeout(() => { if (_shouldAutoPromptCompletion(data)) promptCompletion(); }, 600);
            updateDebugInfo();
        } else {
            if (!handleCompletedSessionRefusal(data.errorMessage)) {
                addMessage('assistant', data.errorMessage || 'Unable to continue.');
            }
        }
    } catch (err) {
        removeTypingIndicator();
        console.warn('[SmartFill] Continue error:', err);
    }
}

// ── Tab switching ─────────────────────────────────────────────────────────────
function switchPanelTab(tab) {
    const progressContent = document.getElementById('panelProgressContent');
    const historyContent  = document.getElementById('panelHistoryContent');
    const memoryContent   = document.getElementById('panelMemoryContent');
    const tabProgress     = document.getElementById('tabProgress');
    const tabHistory      = document.getElementById('tabHistory');
    const tabMemory       = document.getElementById('tabMemory');

    // Hide all, deactivate all tabs
    if (progressContent) progressContent.style.display = 'none';
    if (historyContent)  historyContent.style.display  = 'none';
    if (memoryContent)   memoryContent.style.display   = 'none';
    if (tabProgress) tabProgress.classList.remove('active');
    if (tabHistory)  tabHistory.classList.remove('active');
    if (tabMemory)   tabMemory.classList.remove('active');

    if (tab === 'history') {
        if (historyContent) historyContent.style.display = 'block';
        if (tabHistory) tabHistory.classList.add('active');
        if (!_historyState.loaded) {
            loadSessionHistory(1);
        }
    } else if (tab === 'memory') {
        if (memoryContent) memoryContent.style.display = 'block';
        if (tabMemory) tabMemory.classList.add('active');
        loadMemoryPanel();
        loadSessionContextPanel();
        _memoryStale = false;
    } else {
        if (progressContent) progressContent.style.display = 'block';
        if (tabProgress) tabProgress.classList.add('active');
    }
}

// ── User Memory Panel ─────────────────────────────────────────
async function loadMemoryPanel() {
    const listEl = document.getElementById('memoryFactsList');
    if (!listEl) return;

    listEl.innerHTML = '<div style="color:#9ca3af;font-size:13px;text-align:center;padding:20px;">Loading...</div>';

    try {
        const url = `${CONFIG.apiUrl}/memory?userId=${CONFIG.userId}&storeId=${CONFIG.storeId}`;
        const response = await fetch(url);

        if (!response.ok) {
            const text = await response.text();
            listEl.innerHTML = `<div style="color:#ef4444;font-size:12px;padding:10px;">API error ${response.status}:<br><code>${escapeHtml(text.substring(0,200))}</code><br><br><a href="${CONFIG.apiUrl}/memory/debug?userId=${CONFIG.userId}&storeId=${CONFIG.storeId}" target="_blank" style="color:#3B98F1;">Open debug info ↗</a></div>`;
            return;
        }

        const data = await response.json();
        console.log('[Memory] API response:', data);

        if (!data.success) {
            listEl.innerHTML = `<div style="color:#ef4444;font-size:13px;padding:10px;">${escapeHtml(data.message || 'Failed to load memory.')}<br><br><a href="${CONFIG.apiUrl}/memory/debug?userId=${CONFIG.userId}&storeId=${CONFIG.storeId}" target="_blank" style="color:#3B98F1;font-size:12px;">Open debug info ↗</a></div>`;
            return;
        }

        renderMemoryFacts(data.facts || []);
    } catch (err) {
        console.error('[Memory] loadMemoryPanel error:', err);
        if (listEl) listEl.innerHTML = `<div style="color:#ef4444;font-size:12px;padding:10px;">Network error: ${escapeHtml(err.message)}<br><br><a href="${CONFIG.apiUrl}/memory/debug?userId=${CONFIG.userId}&storeId=${CONFIG.storeId}" target="_blank" style="color:#3B98F1;">Open debug info ↗</a></div>`;
    }
}

function renderMemoryFacts(facts) {
    const listEl = document.getElementById('memoryFactsList');
    if (!listEl) return;

    if (!facts || facts.length === 0) {
        listEl.innerHTML = `
            <div style="color:#9ca3af;font-size:13px;text-align:center;padding:24px 0;">
                <i class="ph-thin ph-brain" style="font-size:28px;display:block;margin-bottom:8px;opacity:0.4;"></i>
                No facts remembered yet.<br>
                <span style="font-size:11px;">Complete a session to start building memory.</span>
            </div>`;
        return;
    }

    listEl.innerHTML = facts.map(f => `
        <div class="memory-fact-item">
            <div class="memory-fact-body">
                <div class="memory-fact-label">${escapeHtml(f.label || f.key)}</div>
                <div class="memory-fact-value">${escapeHtml(f.value)}</div>
            </div>
            <button class="memory-fact-delete" title="Forget this fact"
                onclick="deleteMemoryFact('${escapeHtml(f.key)}')">
                <i class="ph-thin ph-trash"></i>
            </button>
        </div>`).join('');
}

async function deleteMemoryFact(key) {
    if (!confirm(`Forget "${key}"?`)) return;

    try {
        const response = await fetch(
            `${CONFIG.apiUrl}/memory/${encodeURIComponent(key)}?userId=${CONFIG.userId}&storeId=${CONFIG.storeId}`,
            { method: 'DELETE' }
        );
        const data = await response.json();
        if (data.success) {
            loadMemoryPanel();
        }
    } catch (err) {
        console.error('Delete memory fact failed:', err);
    }
}

let _memoryRefreshTimer = null;

/**
 * Schedule a memory panel refresh after a short delay.
 * Debounced so rapid field extractions don't cause multiple reloads.
 * The 3s delay gives the fire-and-forget server task time to finish.
 */
function scheduleMemoryRefresh() {
    clearTimeout(_memoryRefreshTimer);
    _memoryRefreshTimer = setTimeout(() => {
        const memoryContent = document.getElementById('panelMemoryContent');
        if (memoryContent && memoryContent.style.display !== 'none') {
            loadMemoryPanel();
            loadSessionContextPanel();
        }
        _memoryStale = true;
    }, 3000);
}

let _memoryStale = false;

// ─── Session Context (This Session) ─────────────────────────────────────────

async function loadSessionContextPanel() {
    const listEl = document.getElementById('sessionContextList');
    if (!listEl || !state.regOthId) return;

    try {
        const res  = await fetch(`${CONFIG.apiUrl}/session-context?sessionId=${state.regOthId}`);
        const data = await res.json();
        renderSessionContextFacts(data.facts || []);
    } catch (err) {
        console.error('[SessionContext] load error:', err);
    }
}

function renderSessionContextFacts(facts) {
    const listEl = document.getElementById('sessionContextList');
    if (!listEl) return;

    if (!facts || facts.length === 0) {
        listEl.innerHTML = `
            <div style="color:#9ca3af;font-size:13px;text-align:center;padding:14px 0;">
                <i class="ph-thin ph-chats" style="font-size:22px;display:block;margin-bottom:6px;opacity:0.4;"></i>
                No facts yet. Start chatting!
            </div>`;
        return;
    }

    listEl.innerHTML = facts.map(f => `
        <div class="memory-fact-item" id="scf-${escapeHtml(f.key)}">
            <div class="memory-fact-body" onclick="startEditSessionFact('${escapeHtml(f.key)}', this)" style="cursor:pointer;flex:1;" title="Click to edit">
                <div class="memory-fact-label">${escapeHtml(formatFactKey(f.key))}</div>
                <div class="memory-fact-value" id="scfval-${escapeHtml(f.key)}">${escapeHtml(f.value)}</div>
            </div>
            <button class="memory-fact-delete" title="Remove this fact"
                onclick="deleteSessionContextFact('${escapeHtml(f.key)}')">
                <i class="ph-thin ph-trash"></i>
            </button>
        </div>`).join('');
}

function formatFactKey(key) {
    return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function startEditSessionFact(key, bodyEl) {
    const valEl = document.getElementById(`scfval-${key}`);
    if (!valEl) return;
    const current = valEl.textContent;

    // Replace value div with inline input
    valEl.style.display = 'none';
    const input = document.createElement('input');
    input.type  = 'text';
    input.value = current;
    input.style.cssText = 'width:100%;border:1px solid #3B98F1;border-radius:4px;padding:3px 6px;font-size:12px;outline:none;';
    bodyEl.appendChild(input);
    input.focus();
    input.select();

    const save = async () => {
        const newVal = input.value.trim();
        input.remove();
        valEl.style.display = '';
        if (newVal && newVal !== current) {
            valEl.textContent = newVal;
            try {
                await fetch(`${CONFIG.apiUrl}/session-context`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sessionId: state.regOthId, key, value: newVal })
                });
            } catch (err) { console.error('[SessionContext] edit error:', err); }
        }
    };
    input.addEventListener('blur', save);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); if (e.key === 'Escape') { input.value = current; input.blur(); } });
}

async function deleteSessionContextFact(key) {
    if (!confirm(`Remove "${formatFactKey(key)}" from this session's memory?`)) return;
    try {
        await fetch(
            `${CONFIG.apiUrl}/session-context/${encodeURIComponent(key)}?sessionId=${state.regOthId}`,
            { method: 'DELETE' }
        );
        loadSessionContextPanel();
    } catch (err) { console.error('[SessionContext] delete error:', err); }
}

async function seedSampleMemory(btn) {
    btn.textContent = '...';
    btn.disabled = true;

    try {
        const response = await fetch(
            `${CONFIG.apiUrl}/memory/seed?userId=${CONFIG.userId}&storeId=${CONFIG.storeId}`,
            { method: 'POST' }
        );
        const data = await response.json();
        console.log('[Memory] Seed response:', data);
        if (data.success) {
            await loadMemoryPanel();
        } else {
            const listEl = document.getElementById('memoryFactsList');
            if (listEl) listEl.innerHTML = `<div style="color:#ef4444;font-size:12px;padding:10px;">Seed failed: ${escapeHtml(data.message || 'unknown error')}<br><br><a href="${CONFIG.apiUrl}/memory/debug?userId=${CONFIG.userId}&storeId=${CONFIG.storeId}" target="_blank" style="color:#3B98F1;">Open debug info ↗</a></div>`;
        }
    } catch (err) {
        console.error('[Memory] Seed error:', err);
        alert('Seed error: ' + err.message);
    } finally {
        btn.textContent = 'Sample';
        btn.disabled = false;
    }
}

// ── Load paginated list ──────────────────────────────────────
async function loadSessionHistory(page = 1) {
    const listEl    = document.getElementById('historyList');
    const loadingEl = document.getElementById('historyLoading');
    const emptyEl   = document.getElementById('historyEmpty');

    listEl.innerHTML = '';
    emptyEl.style.display = 'none';
    loadingEl.style.display = 'flex';

    try {
        const url = `${SESSION_HISTORY_URL}?userId=${CONFIG.userId}&storeId=${CONFIG.storeId}`
                  + `&pageSize=${_historyState.pageSize}&pageNumber=${page}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data = await res.json();
        _historyState.loaded     = true;
        _historyState.page       = page;
        _historyState.totalCount = data.totalCount || 0;
        _historyState.items      = data.sessions || [];

        renderHistoryItems(_historyState.items);

    } catch (err) {
        console.error('History load error:', err);
        listEl.innerHTML = `<div class="history-empty">Failed to load history. Please try again.</div>`;
    } finally {
        loadingEl.style.display = 'none';
    }
}

// ── Render cards ─────────────────────────────────────────────
function renderHistoryItems(items) {
    const listEl  = document.getElementById('historyList');
    const emptyEl = document.getElementById('historyEmpty');

    if (!items || items.length === 0) {
        emptyEl.style.display = 'block';
        return;
    }

    listEl.innerHTML = '';

    items.forEach(item => {
        const card = document.createElement('div');
        card.className = 'history-card';
        const id = item.regOthID || item.RegOthID;
        const isInProgress = item.isInProgress ?? item.IsInProgress;
        const createdDateValue = item.createdDate || item.CreatedDate;
        const templateName = item.templateName || item.TemplateName || 'Unnamed';
        const internalNo = item.internalNo || item.InternalNo || String(id);
        const savedFieldCount = item.savedFieldCount ?? item.SavedFieldCount ?? 0;
        const formUrl = item.formUrl || item.FormUrl || '';
        const itemRegTypeId = Number(item.regTypeID || item.regTypeId || item.RegTypeID || 0);
        card.dataset.regOthId = id;

        const badgeClass = isInProgress ? 'in-progress' : 'completed';
        const badgeText  = isInProgress ? 'In Progress' : 'Completed';

        const createdDate = createdDateValue
            ? new Date(createdDateValue).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })
            : '-';

        card.innerHTML = `
            <div class="history-card-top">
                <div class="history-template-name">${escapeHtml(templateName)}</div>
                <span class="history-badge ${badgeClass}">${badgeText}</span>
            </div>
            <div class="history-meta">
                <span>#${escapeHtml(internalNo)}</span>
                <span>${createdDate}</span>
                <span>${savedFieldCount} field${savedFieldCount !== 1 ? 's' : ''} saved</span>
            </div>
            <div class="history-actions">
                <button class="history-btn" onclick="openHistoryForm(${id}, '${escapeHtml(formUrl)}', ${itemRegTypeId})">Open Form</button>
                <button class="history-btn" onclick="toggleHistoryDetail(${id})">View Fields</button>
                ${isInProgress ? `<button class="history-btn primary" onclick="resumeSession(${id})">Resume</button>` : ''}
            </div>
            <div class="history-fields-panel" id="historyFields_${id}" style="display:none"></div>
        `;

        listEl.appendChild(card);
    });

    // Pagination
    const totalPages = Math.ceil(_historyState.totalCount / _historyState.pageSize);
    if (totalPages > 1) {
        const pager = document.createElement('div');
        pager.className = 'history-pagination';
        pager.innerHTML = `
            <button class="history-page-btn" onclick="loadSessionHistory(${_historyState.page - 1})" ${_historyState.page <= 1 ? 'disabled' : ''}>← Prev</button>
            <span style="font-size:12px;color:#6b7280;align-self:center;">Page ${_historyState.page} of ${totalPages}</span>
            <button class="history-page-btn" onclick="loadSessionHistory(${_historyState.page + 1})" ${_historyState.page >= totalPages ? 'disabled' : ''}>Next →</button>
        `;
        listEl.appendChild(pager);
    }
}

// ── Toggle field detail inline ───────────────────────────────
async function toggleHistoryDetail(regOthId) {
    const panelEl = document.getElementById(`historyFields_${regOthId}`);
    if (!panelEl) return;

    if (panelEl.style.display !== 'none') {
        panelEl.style.display = 'none';
        return;
    }

    panelEl.style.display = 'block';
    panelEl.innerHTML = '<div class="history-loading" style="padding:10px 0;"><div class="loading-spinner-sm"></div><span>Loading fields…</span></div>';

    try {
        const url = `${SESSION_HISTORY_URL}/${regOthId}?userId=${CONFIG.userId}&storeId=${CONFIG.storeId}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const detail = await res.json();
        const fields = detail.fields || [];

        if (fields.length === 0) {
            panelEl.innerHTML = '<div style="font-size:12px;color:#9ca3af;text-align:center;padding:8px 0;">No fields saved yet.</div>';
            return;
        }

        panelEl.innerHTML = fields.map(f => `
            <div class="history-field-row">
                <span class="history-field-name">${escapeHtml(f.fieldName || `Field ${f.fieldID}`)}</span>
                <span class="history-field-value">${escapeHtml(f.fieldValue || '-')}</span>
            </div>
        `).join('');

    } catch (err) {
        console.error('History detail error:', err);
        panelEl.innerHTML = '<div style="font-size:12px;color:#ef4444;text-align:center;padding:8px 0;">Failed to load fields.</div>';
    }
}

// ── Open form in new tab ─────────────────────────────────────
async function openHistoryForm(regOthId, formUrl, regTypeIdFromItem = 0) {
    console.log('🔵 openHistoryForm called with:', { regOthId, formUrl, regTypeIdFromItem });
    
    const decodedFormUrl = String(formUrl || '')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#039;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');
    
    console.log('📝 Decoded formUrl:', decodedFormUrl);

    const initialUrl = appendCurrentPageId(decodedFormUrl || buildChecklistUrl(regOthId, state.templateName, state.moduleName));
    console.log('🔗 Initial URL:', initialUrl);
    
    const newTab = window.open('about:blank', '_blank');

    const navigate = (url) => {
        console.log('✅ NAVIGATING TO:', url);
        if (newTab && !newTab.closed) {
            newTab.location.href = url;
        } else {
            window.open(url, '_blank');
        }
    };

    let urlObj;
    try {
        urlObj = new URL(initialUrl, window.location.origin);
    } catch {
        console.error('❌ Failed to parse URL:', initialUrl);
        navigate(initialUrl);
        return;
    }

    const existingGt = (urlObj.searchParams.get('gt') || '').trim();
    console.log('🔎 Existing gt in URL:', existingGt || '(empty)');
    if (existingGt && existingGt !== '0') {
        console.log('✅ URL already has gt, navigating with existing value');
        navigate(urlObj.toString());
        return;
    }

    const itemGt = Number(regTypeIdFromItem || 0);
    console.log('📌 itemGt from parameter:', itemGt);
    if (itemGt > 0) {
        urlObj.searchParams.set('gt', String(itemGt));
        console.log('✅ Set gt from itemGt, navigating:', urlObj.toString());
        navigate(urlObj.toString());
        return;
    }

    const stateGt = Number(state.regTypeId || 0);
    console.log('📌 stateGt from state:', stateGt);
    if (stateGt > 0) {
        urlObj.searchParams.set('gt', String(stateGt));
        console.log('✅ Set gt from stateGt, navigating:', urlObj.toString());
        navigate(urlObj.toString());
        return;
    }

    console.log('🔄 Attempting to fetch from transcript API...');
    try {
        const transcriptUrls = [
            `${TRANSCRIPT_API_URL}/${regOthId}?userId=${CONFIG.userId}&storeId=${CONFIG.storeId}`,
            `${window.location.origin}/affinda/api/chat-transcript/${regOthId}?userId=${CONFIG.userId}&storeId=${CONFIG.storeId}`
        ];
        
        console.log('📡 Transcript URLs to try:', transcriptUrls);

        for (const transcriptUrl of transcriptUrls) {
            console.log(`🌐 Fetching: ${transcriptUrl}`);
            const transcriptRes = await fetch(transcriptUrl);
            console.log(`📊 Response status: ${transcriptRes.status}`);
            if (!transcriptRes.ok) {
                console.log(`⏭️  Skipping failed response (${transcriptRes.status})`);
                continue;
            }

            const transcript = await transcriptRes.json();
            console.log('📦 Transcript response:', transcript);
            const transcriptGt = Number(transcript?.regTypeID || transcript?.regTypeId || transcript?.RegTypeID || 0);
            console.log('🔢 Extracted transcriptGt:', transcriptGt);
            if (transcriptGt > 0) {
                urlObj.searchParams.set('gt', String(transcriptGt));
                console.log('✅ Set gt from transcript, breaking loop');
                break;
            }
        }

        if (!(urlObj.searchParams.get('gt') || '').trim()) {
            console.log('⚠️  Still no gt, trying session-history fallback...');
            const detailUrl = `${SESSION_HISTORY_URL}/${regOthId}?userId=${CONFIG.userId}&storeId=${CONFIG.storeId}`;
            console.log(`🌐 Fetching session-history: ${detailUrl}`);
            const res = await fetch(detailUrl);
            console.log(`📊 Session-history response status: ${res.status}`);
            if (res.ok) {
                const detail = await res.json();
                console.log('📦 Session-history response:', detail);
                const detailGt = Number(detail?.regTypeID || detail?.regTypeId || detail?.RegTypeID || 0);
                console.log('🔢 Extracted detailGt from session-history:', detailGt);
                if (detailGt > 0) {
                    urlObj.searchParams.set('gt', String(detailGt));
                    console.log('✅ Set gt from session-history');
                }
            }
        }
    } catch (err) {
        console.error('❌ Error resolving regTypeID for history form URL:', err);
    }

    const finalUrl = urlObj.toString();
    const finalGt = urlObj.searchParams.get('gt') || '(BLANK!)';
    console.log('🎯 FINAL URL:', finalUrl);
    console.log('🎯 FINAL gt value:', finalGt);
    navigate(finalUrl);
}

// ── Resume session ───────────────────────────────────────────
async function resumeSession(regOthId) {
    try {
        const preResumeTranscript = loadTranscript(regOthId);
        const url = `${SESSION_HISTORY_URL}/${regOthId}?userId=${CONFIG.userId}&storeId=${CONFIG.storeId}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const detail = await res.json();

        // ── Restore state ────────────────────────────────────
        state.regOthId         = detail.regOthID || detail.RegOthID;
        state.regTypeId        = detail.regTypeID || detail.regTypeId || detail.RegTypeID || state.regTypeId || null;
        state.templateTypeId   = Number(detail.templateTypeID || detail.TemplateTypeID || detail.templateTypeId || preResumeTranscript?.templateTypeId || state.templateTypeId || 0) || null;
        state.pageId           = Number(detail.pageId || detail.PageId || detail.pageID || detail.PageID || preResumeTranscript?.pageId || state.pageId || 0) || null;
        state.internalNo       = detail.internalNo || detail.InternalNo || '';
        state.templateName     = detail.templateName || detail.TemplateName || '';
        state.chatName         = detail.chatName || detail.ChatName || detail.templateName || detail.TemplateName || '';
        state._replayMode      = false;
        state.sessionStarted   = true;
        const rawIsInProgress = detail?.isInProgress ?? detail?.IsInProgress;
        const rawIsComplete = detail?.isComplete ?? detail?.IsComplete ?? detail?.sessionCompleted ?? detail?.SessionCompleted;
        if (typeof rawIsInProgress === 'boolean') {
            state.sessionCompleted = !rawIsInProgress;
        } else if (typeof rawIsComplete === 'boolean') {
            state.sessionCompleted = rawIsComplete;
        } else {
            state.sessionCompleted = false;
        }
        // Restore confirmed field IDs from localStorage — these are fields the user
        // already answered in a prior session visit (not just SP defaults)
        state.chatConfirmedFieldIds = loadConfirmedFieldIds(detail.regOthID || detail.RegOthID);

        // Restore extracted fields map
        state.extractedFieldsMap.clear();
        const filledFields = (detail.fields || []).filter(f => f.fieldValue);
        filledFields.forEach(f => {
            state.extractedFieldsMap.set(String(f.fieldID), {
                fieldId:   f.fieldID,
                fieldName: f.fieldName || `Field ${f.fieldID}`,
                value:     f.fieldValue
            });
        });

        // Rebuild conversationHistory so the AI has full context
        const fieldsContext = filledFields.length
            ? filledFields.map(f => `${f.fieldName}: ${f.fieldValue}`).join('; ')
            : 'none yet';
        state.conversationHistory = [
            { role: 'user',      content: `I need to resume filling in the "${state.templateName}" form.` },
            { role: 'assistant', content: `Sure! Resuming your "${state.templateName}" session (ID: ${state.regOthId}). So far we have captured: ${fieldsContext}. Let\'s continue filling in the remaining fields.` }
        ];

        // ── Switch UI ────────────────────────────────────────
        switchPanelTab('progress');
        updateProgressPanel();

        // Restore progress widget — real % will arrive from autoResumeNext in 500ms
        const savedTranscript = loadTranscript(regOthId);
        // Only restore totalFieldCount if it's reliably from template selection (not just filled count)
        if (savedTranscript?.totalFieldCount && savedTranscript.totalFieldCount !== filledFields.length) {
            state.totalFieldCount = savedTranscript.totalFieldCount;
        } else {
            state.totalFieldCount = 0; // will be updated once autoResumeNext returns real data
        }
        updateInlineChatProgress(savedTranscript?.completionPercentage || 0);

        // Update topbar title
        setTopbarTitle(state.chatName || state.templateName || '');
        const banner = document.getElementById('readonlyBanner');
        if (banner) banner.remove();
        renderSidebarChats();

        // Ensure chat view is visible (same as when a new session starts)
        document.getElementById('emptyState').style.display = 'none';
        document.getElementById('messagesArea').classList.add('active');
        document.getElementById('chatInputArea').style.display = 'block';

        // ── Clear chat, replay saved history, then render resume card ──
        const messagesArea = document.getElementById('messagesArea');
        messagesArea.innerHTML = '';
        state.displayMessages = [];

        // Restore previous conversation from DB (preferred) or localStorage
        const dbTranscript = await _loadTranscriptFromDb(regOthId);
        const localTranscript = loadTranscript(regOthId);
        const savedTranscript2 = dbTranscript || localTranscript;
        if (savedTranscript2?.templateTypeId && !state.templateTypeId) {
            state.templateTypeId = Number(savedTranscript2.templateTypeId) || null;
        }
        if (savedTranscript2?.pageId && !state.pageId) {
            state.pageId = Number(savedTranscript2.pageId) || null;
        }
        if (!state.pageId && state.templateTypeId && TEMPLATE_TYPE_PAGE_MAP[state.templateTypeId]) {
            state.pageId = TEMPLATE_TYPE_PAGE_MAP[state.templateTypeId];
        }
        if (savedTranscript2 && savedTranscript2.messages && savedTranscript2.messages.length > 0) {
            // Replay into DOM without re-recording (set _replayMode temporarily)
            state._replayMode = true;
            savedTranscript2.messages.forEach(msg => addMessage(msg.role, msg.content));
            state._replayMode = false;
            // Seed displayMessages with the restored history so new messages append correctly
            state.displayMessages = savedTranscript2.messages.map(m => ({ role: m.role, content: m.content }));
        }

        const createdDate = detail.createdDate
            ? new Date(detail.createdDate).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })
            : '';

        // Build field rows HTML
        const fieldRowsHtml = filledFields.length
            ? filledFields.map(f => `
                <div class="resume-field-row">
                    <span class="resume-field-name">${escapeHtml(stripHtml(f.fieldName))}</span>
                    <span class="resume-field-value">${formatFieldValue(f.fieldValue)}</span>
                </div>`).join('')
            : '<div style="color:#9ca3af;font-size:12px;padding:4px 0;">No fields saved yet.</div>';

        // Inject the resume card as an assistant message
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message assistant';
        messageDiv.innerHTML = `
            <div class="message-icon"><i class="ph-thin ph-chats-circle"></i></div>
            <div class="message-content">
                <div class="resume-card">
                    <div class="resume-card-header">
                        <i class="ph-thin ph-arrow-counter-clockwise"></i>
                        <span>Session Resumed</span>
                    </div>
                    <div class="resume-card-title">${escapeHtml(state.templateName)}</div>
                    ${createdDate ? `<div class="resume-card-date">Started ${createdDate} &nbsp;·&nbsp; ID: ${state.regOthId}</div>` : ''}
                    <div class="resume-fields-label">${filledFields.length} field${filledFields.length !== 1 ? 's' : ''} already captured</div>
                    <div class="resume-fields-list">${fieldRowsHtml}</div>
                </div>
                <div class="resume-continue-msg">Let me check what's still needed…</div>
            </div>
        `;
        messagesArea.appendChild(messageDiv);
        scrollToBottom();

        // Ensure detail/header questions are completed first (required fields especially)
        // before continuing checklist questions on resume.
        const continueChecklist = () => setTimeout(() => {
            if (!state._headerDetailsReadyForChecklist) return;
            if (state._collectingHeaderDetails || state.awaitingHeaderField) return;
            autoResumeNext();
        }, 300);
        const shouldAskHeaderDetails = !hasCompletedHeaderDetails(state.regOthId);
        if (shouldAskHeaderDetails) {
            collectHeaderDetails(continueChecklist);
        } else {
            state._headerDetailsReadyForChecklist = true;
            continueChecklist();
        }

        // Close panel on mobile
        if (window.innerWidth < 768) {
            document.getElementById('progressPanel').classList.remove('show');
        }

    } catch (err) {
        console.error('Resume session error:', err);
        addMessage('assistant', 'Could not resume that session. Please try again.');
    }
}

/**
 * Silently fires "next" to the chat API after a session is resumed.
 * No user bubble is added — just shows the AI response + real progress %.
 */
async function autoResumeNext() {
    if (!state.regOthId) return;

    // Never progress checklist while header/details collection is active.
    if (state._collectingHeaderDetails) return;

    // Add to history so the AI has context
    state.conversationHistory.push({ role: 'user', content: 'next' });

    const _lastReal2 = [...state.conversationHistory].reverse().find(m => m.role === 'user' && m.content !== 'next')?.content || '';
    showTypingIndicator(_lastReal2);
    try {
        const response = await fetch(`${CONFIG.apiUrl}/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                regOthID: state.regOthId,
                storeID: CONFIG.storeId,
                userMessage: 'next',
                userID: CONFIG.userId,
                conversationHistory: state.conversationHistory.slice(-10),
                fullConversationHistory: state.conversationHistory,
                currentDateTime: new Date().toISOString(),
                userTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                userDateFormat: getUserDateFormat(),
                memoryConfidence: localStorage.getItem('memoryConfidence') || 'medium',
                userProfile: CONFIG.userProfile
            })
        });
        const data = await response.json();
        removeTypingIndicator();

        if (data.success) {
            trackServerCost(data.tokenUsage);
            state.currentFieldID   = data.currentFieldID;
            state.currentFieldType = data.currentFieldType;
            state.currentFieldRequired = data.isCurrentFieldRequired !== false;
            state.currentFieldDynamicFilter = data.currentFieldDynamicFilter || null;

            state.conversationHistory.push({ role: 'assistant', content: data.aiMessage });

            if (data.completionPercentage !== undefined) updateProgress(data.completionPercentage, data.totalFields, data.answeredFields);

            // Helper: show the AI message + field-specific UI
            const showNextQuestionAndFieldUI = () => {
                addMessage('assistant', data.aiMessage);

                setTimeout(() => {
                    const existingFileUpload = document.querySelector('.file-upload-container');
                    const existingMapContainer = document.querySelector('.map-container');
                    const existingDynamicData = document.querySelector('.dynamic-data-container');

                    if (state.currentFieldType !== '10013' && existingFileUpload) existingFileUpload.remove();
                    if (state.currentFieldType !== '10016' && existingMapContainer) existingMapContainer.remove();
                    if (state.currentFieldType !== '10020' && state.currentFieldType !== '10037' && existingDynamicData) existingDynamicData.remove();

                    if (state.currentFieldType === '10013') {
                        addFileUploadUI();
                    } else if ((state.currentFieldType === '10020' || state.currentFieldType === '10026' || state.currentFieldType === '10037') && state.currentFieldDynamicFilter) {
                        addDynamicDataUI(state.currentFieldType, state.currentFieldDynamicFilter);
                    } else if (state.currentFieldType === '10016') {
                        addMapUI(null);
                    }

                    if (data.nextSuggestedQuestions?.length && state.currentFieldType !== '10016') {
                        addSuggestions(data.nextSuggestedQuestions);
                    }
                    addSkipChipIfOptional();
                }, 50);
            };

            setTimeout(() => {
                addSupplementaryPromptUI(
                    data.showPhotoFieldIds,
                    data.showCommentFieldIds,
                    data.showActionFieldIds,
                    data.showHazardInfo || null,
                    data.extractedFields,
                    data,
                    showNextQuestionAndFieldUI
                );
            }, 50);

            if (data.isComplete) state._serverMarkedComplete = true;
            setTimeout(() => { if (_shouldAutoPromptCompletion(data)) promptCompletion(); }, 600);

            saveTranscript();
            updateDebugInfo();
        } else {
            if (!handleCompletedSessionRefusal(data.errorMessage)) {
                addMessage('assistant', data.errorMessage || 'Unable to get next question.');
            }
        }
    } catch (err) {
        removeTypingIndicator();
        addMessage('assistant', 'Error resuming session — please type "next" to continue.');
    }

    // Close panel on mobile
    if (window.innerWidth < 768) {
        document.getElementById('progressPanel').classList.remove('show');
    }
}

// ── Utility ──────────────────────────────────────────────────
/** Strip HTML tags and decode entities to plain text */
function stripHtml(str) {
    if (!str) return '';
    const tmp = document.createElement('div');
    tmp.innerHTML = str;
    return (tmp.textContent || tmp.innerText || '').trim();
}

/** Format a field value for display — unwrap JSON dataset answers to readable text, file paths to links */
function formatFieldValue(val) {
    if (!val) return '';
    // JSON dataset answers
    try {
        const obj = JSON.parse(val);
        if (obj && obj.Text !== undefined) {
            if (Array.isArray(obj.Text)) return escapeHtml(obj.Text.join(', '));
            return escapeHtml(String(obj.Text));
        }
    } catch (e) { /* not JSON — fall through */ }
    // File path — ~/App/Docs/... or similar
    const plain = stripHtml(val);
    if (/^~\/App\/Docs\//i.test(plain) || /\.(pdf|doc|docx|xls|xlsx|csv|txt|png|jpg|jpeg|gif|bmp|zip)$/i.test(plain)) {
        const href = plain.replace(/^~\//, '../../');
        const fileName = plain.split('/').pop();
        return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener" `
             + `style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;background:#3B98F1;color:#fff;`
             + `border-radius:4px;font-size:12px;text-decoration:none;font-weight:500;" `
             + `title="${escapeHtml(plain)}"><i class="ph-thin ph-file-arrow-down"></i>${escapeHtml(fileName)}</a>`;
    }
    return escapeHtml(plain);
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
