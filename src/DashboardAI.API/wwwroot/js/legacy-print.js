/**
 * legacy-print.js
 *
 * Drop-in print/report script for the legacy WHS dashboard.
 *
 * HOW TO USE
 * ──────────
 * 1. Add this script tag to the legacy page (before </body>):
 *
 *      <script src="/js/legacy-print.js"></script>
 *
 * 2. That's it. A floating "Generate Report" button is injected automatically.
 *    Alternatively, call `window.legacyGenerateReport()` from any existing button:
 *
 *      <button onclick="legacyGenerateReport()">Print Report</button>
 *
 * CONFIGURATION
 * ─────────────
 * Edit the CONFIG object below to match the legacy page if selectors differ.
 */

(function () {
    'use strict';

    // ── Configuration ────────────────────────────────────────────────────────────
    const CONFIG = {
        // CSS selector for the GridStack container holding all dashboard-card items
        gridSelector: '#statement',

        // Candidates for the organisation logo — first matching <img> wins
        logoSelector: '#logo-cu, img.navbar-brand, .navbar-brand img, .topbar-logo img, header img.logo, .site-logo img',

        // Report title — falls back to document.title
        reportTitle: null,   // e.g. 'WHS Incident Dashboard'  — null = use document.title

        // Organisation subtitle shown on the cover page
        reportSubtitle: 'Workplace Health & Safety',

        // ID given to the injected floating button (used to prevent double-injection)
        buttonId: 'legacyReportBtn',

        // API endpoint for AI widget descriptions (mirrors /api/chat/describe in dashboard.html)
        aiApiUrl: 'https://beta.whsmonitor.com.au/dashboardv2/api/chat/describe',

        // Richer AI endpoint: executive summary + structured widget insights for print reports
        reportInsightsUrl: 'https://beta.whsmonitor.com.au/dashboardv2/api/report/insights',

        // CSS selector for active filter elements to send as context to the AI.
        // Empty string = URL query params only.
        filterSelector: '[data-filter],[dc-filter],select.filter-select,select[name*="filter"]',
    };

    // ── Helpers ──────────────────────────────────────────────────────────────────

    /** XSS-safe HTML escape */
    const esc = s =>
        String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    /** Strip HTML tags and collapse whitespace from a DOM element's content */
    function cleanTitle(el) {
        if (!el) return '';
        return el.textContent.replace(/\s+/g, ' ').trim();
    }

    /** Sanitize a datatable cell's raw HTML — keep inline styles/colours, strip interactive elements */
    function sanitizeCellHtml(html) {
        const d = document.createElement('div');
        d.innerHTML = String(html ?? '');
        d.querySelectorAll('script,button,input,select,textarea').forEach(e => e.remove());
        d.querySelectorAll('*').forEach(e => {
            [...e.attributes].forEach(a => { if (a.name.startsWith('on')) e.removeAttribute(a.name); });
            if (e.tagName === 'A') { e.removeAttribute('href'); e.removeAttribute('onclick'); }
        });
        return d.innerHTML.trim() || d.textContent.trim() || '-';
    }

    /**
     * Extract all rows from a legacy DataTable widget (bypasses pagination).
     * Returns { title, cols, rows, totalCount } or null if no table found.
     */
    function extractTableData(item) {
        const tableEl = item.el.querySelector('table.dataTable');
        if (!tableEl) return null;

        // Column names — prefer dc-colname attribute, fall back to text
        const cols = [...tableEl.querySelectorAll('thead th')]
            .filter(th => th.textContent.trim())   // skip hidden/empty cols
            .map(th => (th.getAttribute('dc-colname') || th.textContent).trim());

        let rows = [];

        // Use DataTables API to get ALL rows (ignores current page).
        // dt.cell().render('display') handles every DataTables data format:
        // plain arrays, keyed objects, and orthogonal data ({display:…,_:…}).
        if (window.$ && $.fn && $.fn.dataTable && $.fn.dataTable.isDataTable(tableEl)) {
            try {
                const dt = $(tableEl).DataTable();
                const rowIndexes = dt.rows().indexes().toArray();
                rows = rowIndexes.map(rowIdx =>
                    cols.map((_, ci) => {
                        try {
                            // Prefer the actual DOM node — captures colours/styles applied by
                            // createdCell / rowCallback that render('display') cannot see.
                            const node = dt.cell(rowIdx, ci).node();
                            if (node) return sanitizeCellHtml(node.innerHTML);
                            // Off-page rows have no DOM node; fall back to render('display').
                            const display = dt.cell(rowIdx, ci).render('display');
                            return sanitizeCellHtml(String(display ?? ''));
                        } catch (e) { return '-'; }
                    })
                );
            } catch (dtErr) {
                console.warn('[LegacyReport] DataTables API failed, falling back to DOM rows', dtErr);
            }
        }

        // Fallback: only visible (current-page) DOM rows
        if (!rows.length) {
            rows = [...tableEl.querySelectorAll('tbody tr')].map(tr =>
                [...tr.querySelectorAll('td')].map(td => sanitizeCellHtml(td.innerHTML))
            );
        }

        return { title: item.title, cols, rows, totalCount: rows.length };
    }

    /**
     * Extract the display value from a count widget.
     * Probes selectors in specificity order and reads only direct text nodes
     * to avoid accidentally capturing nested label/title text.
     */
    function extractCountValue(el) {
        const candidates = [
            el.querySelector('.progress-value .h2 > div'),    // ring: innermost value div (direct child)
            el.querySelector('.progress-value .h2'),           // ring: h2 wrapper fallback
            el.querySelector('.dashboard-count .rounded > div'), // nested-card variant (value inside .rounded div)
            el.querySelector('.dashboard-count > div'),         // large-number: direct child only
        ];
        for (const node of candidates) {
            if (!node) continue;
            // Read only direct text nodes — ignores text from nested elements (labels, titles, etc.)
            const direct = [...node.childNodes]
                .filter(n => n.nodeType === Node.TEXT_NODE)
                .map(n => n.textContent.trim())
                .join('').trim();
            if (direct && /\d/.test(direct)) return direct;
            // Secondary fallback: full textContent only when it looks purely numeric (digits, commas, spaces)
            const full = node.textContent.trim();
            if (full && /^[\d,. ]+$/.test(full)) return full.trim();
        }
        return '';
    }

    /** Dynamically load html2canvas from CDN if not already present, then resolve */
    function loadHtml2Canvas() {
        if (window.html2canvas) return Promise.resolve();
        return new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
            s.onload = resolve;
            s.onerror = () => reject(new Error('Failed to load html2canvas from CDN'));
            document.head.appendChild(s);
        });
    }

    /**
     * Fetch AI report insights from POST /api/report/insights.
     * Accepts richer widget data: table columns, sample rows, count values, ECharts series.
     * Includes active filter context and sessionStorage caching.
     * Returns { executiveSummary, keyFindings, descriptions } — graceful degradation on failure.
     */

    /**
     * Extract ECharts series data from a card widget (up to 3 series, 20 points each).
     * Returns [] if ECharts is unavailable or the widget has no chart instance.
     */
    function extractChartSeriesData(item) {
        const container = item.el.querySelector('[_echarts_instance_]');
        if (!container || !window.echarts) return [];
        try {
            const inst = window.echarts.getInstanceByDom(container);
            if (!inst) return [];
            const opt = inst.getOption();
            const xLabels = ((opt.xAxis || [])[0] || {}).data || [];
            return (opt.series || []).slice(0, 3).map(s => ({
                seriesName: s.name || '',
                labels: xLabels.slice(0, 20).map(String),
                values: (s.data || []).slice(0, 20).map(d =>
                    (d === null || d === undefined) ? '' :
                        typeof d === 'object' ? String(d.value ?? d[1] ?? '') : String(d)
                ),
            }));
        } catch (e) { return []; }
    }

    /**
     * Read active filter values from the page DOM and URL query params.
     * Uses CONFIG.filterSelector for DOM elements, falls back to URL search params.
     */
    function readActiveFilters() {
        const filters = {};
        if (CONFIG.filterSelector) {
            try {
                document.querySelectorAll(CONFIG.filterSelector).forEach(el => {
                    const name = el.getAttribute('data-filter') || el.getAttribute('dc-filter')
                        || el.getAttribute('name') || el.id || '';
                    if (!name) return;
                    const val = el.tagName === 'SELECT'
                        ? (el.selectedOptions[0]?.text || el.value || '')
                        : (el.value || '');
                    if (val && val.trim() && val.toLowerCase() !== 'all' && val !== '0')
                        filters[name.trim()] = val.trim();
                });
            } catch (e) { /* ignore */ }
        }
        try {
            new URLSearchParams(window.location.search).forEach((v, k) => {
                if (v && !filters[k]) filters[k] = v;
            });
        } catch (e) { /* ignore */ }
        return filters;
    }

    /** DJB2 hash — used for sessionStorage cache key */
    function _djb2(str) {
        let h = 5381;
        for (let i = 0; i < str.length; i++) h = ((h << 5) + h) ^ str.charCodeAt(i);
        return (h >>> 0).toString(36);
    }
    function _getCachedInsights(key) {
        try { const v = sessionStorage.getItem(key); return v ? JSON.parse(v) : null; } catch (e) { return null; }
    }
    function _setCachedInsights(key, data) {
        try { sessionStorage.setItem(key, JSON.stringify(data)); } catch (e) { /* quota */ }
    }

    async function fetchReportInsights(dashboardTitle, widgets, activeFilters) {
        const empty = { executiveSummary: '', keyFindings: [], recommendations: [], descriptions: {} };
        const cacheKey = 'lgcy_rpt_' + _djb2(
            dashboardTitle + '|' +
            widgets.map(w => `${w.title}:${w.currentValue || ''}:${w.rowCount || ''}:${(w.seriesData || []).length}`).join('|')
        );
        const cached = _getCachedInsights(cacheKey);
        if (cached) { console.log('[LegacyReport] Using cached AI insights'); return cached; }

        const userId = (window.SESSION && window.SESSION.userId) || '';
        const storeId = (window.SESSION && window.SESSION.storeId) || '';
        try {
            const res = await fetch(CONFIG.reportInsightsUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dashboardTitle, userId, storeId, widgets, activeFilters: activeFilters || {} }),
            });
            if (!res.ok) return empty;
            const data = await res.json();
            const result = {
                executiveSummary: data.executiveSummary || '',
                keyFindings: Array.isArray(data.keyFindings) ? data.keyFindings : [],
                recommendations: Array.isArray(data.recommendations) ? data.recommendations : [],
                descriptions: data.descriptions || {},
            };
            _setCachedInsights(cacheKey, result);
            return result;
        } catch (e) {
            console.warn('[LegacyReport] AI insights failed:', e);
            return empty;
        }
    }

    /**
     * Case-insensitive lookup in the descriptions dict returned by the AI.
     * Returns { description, layout } — never throws.
     */
    function getInsight(descriptions, title) {
        if (!title || !descriptions) return { description: '', layout: 'full' };
        let raw = descriptions[title];
        if (!raw) {
            const lower = title.toLowerCase();
            const k = Object.keys(descriptions).find(k => k.toLowerCase() === lower);
            raw = k ? descriptions[k] : null;
        }
        if (!raw) return { description: '', layout: 'full' };
        if (typeof raw === 'string') return { description: raw, layout: 'full' };
        return { description: raw.description || '', layout: raw.layout || 'full' };
    }

    // ── Core report generator ────────────────────────────────────────────────────
    async function generateReport(aiMode = false) {

        // Disable all trigger buttons while working
        const btnGroup = document.getElementById('legacyReportBtnGroup');
        const groupBtns = btnGroup ? [...btnGroup.querySelectorAll('button')] : [];
        groupBtns.forEach(b => { b.disabled = true; });

        // ── Progress overlay ────────────────────────────────────────────────────────
        const overlay = document.createElement('div');
        overlay.style.cssText = [
            'position:fixed;inset:0;background:rgba(15,23,42,.6);z-index:9999;',
            'display:flex;align-items:center;justify-content:center;',
            'font-family:Segoe UI,Arial,sans-serif;backdrop-filter:blur(3px)',
        ].join('');
        overlay.innerHTML = `
      <div style="background:#3B98F1;border-radius:12px;padding:30px 44px;text-align:center;
                  box-shadow:0 12px 40px rgba(0,0,0,.5);min-width:280px">
        <div style="color:#fff;font-size:15px;font-weight:700;letter-spacing:.03em;margin-bottom:6px">
          Preparing Report
        </div>
        <div id="__lgcy_prog" style="color:rgba(255,255,255,.72);font-size:11px;margin-bottom:16px">
          Preparing…
        </div>
        <div style="height:5px;background:rgba(255,255,255,.18);border-radius:3px;overflow:hidden">
          <div id="__lgcy_bar"
               style="height:100%;width:0%;background:#60a5fa;border-radius:3px;transition:width .35s ease">
          </div>
        </div>
      </div>`;
        document.body.appendChild(overlay);

        const setProg = (msg, pct) => {
            const m = document.getElementById('__lgcy_prog'); if (m) m.textContent = msg;
            const b = document.getElementById('__lgcy_bar'); if (b) b.style.width = pct + '%';
        };

        try {
            const printDate = new Date().toLocaleDateString('en-AU', { day: '2-digit', month: 'long', year: 'numeric' });
            const _md = (() => { try { return JSON.parse(localStorage.getItem('jmemberData') || '{}'); } catch(e) { return {}; } })();
            const preparedByName = [_md.FirstName, _md.Surname].filter(Boolean).join(' ') || '';
            // ── Send-report API context ────────────────────────────────────────────────
            const srStoreId = (window.SESSION && window.SESSION.storeId) || _md.StoreID || 0;
            const srUserId  = (window.SESSION && window.SESSION.userId)  || _md.MemberID || 0;
            let srAshxBase, srAsmxBase, srSendUrl;
            try {
                const _u = new URL(CONFIG.aiApiUrl);
                srAshxBase = `${_u.protocol}//${_u.host}/App/NetServices`;
                srAsmxBase = `${_u.protocol}//${_u.host}/NetServices/POSTDynamicChecklist.asmx`;
                srSendUrl  = `${_u.protocol}//${_u.host}${_u.pathname.replace(/\/api\/.*$/, '')}/api/report/send-email`;
            } catch (_) {
                srAshxBase = '/App/NetServices';
                srAsmxBase = '/NetServices/POSTDynamicChecklist.asmx';
                srSendUrl  = '/api/report/send-email';
            }
            var printTitle = CONFIG.reportTitle || document.title || 'WHS Dashboard Report';
            printTitle = $('#dashboardTitle span').html();
            // ── Brand colour — prefer __primaryColor.TertiaryColor, fall back to #navbar-left, then default blue ──
            const toHex = rgb => {
                if (!rgb) return null;
                // Already a hex value
                if (/^#[0-9a-f]{3,6}$/i.test(rgb.trim())) return rgb.trim();
                const m = rgb.match(/\d+/g);
                if (!m || m.length < 3) return null;
                return '#' + m.slice(0, 3).map(n => parseInt(n).toString(16).padStart(2, '0')).join('');
            };
            const palettColor = (window.__primaryColor && window.__primaryColor.TertiaryColor) || '';
            const navbarEl = document.querySelector('#navbar-left');
            const navbarBg = navbarEl ? getComputedStyle(navbarEl).backgroundColor : '';
            const brandColor = toHex(palettColor) || toHex(navbarBg) || '#3B98F1';
            const hexToRgb = h => { const v = parseInt(h.slice(1), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; };
            const [br, bg, bb] = hexToRgb(brandColor);
            const brandLt = `rgb(${Math.round(br * .15 + 255 * .85)},${Math.round(bg * .15 + 255 * .85)},${Math.round(bb * .15 + 255 * .85)})`;
            const brandDk = `rgb(${Math.round(br * .65)},${Math.round(bg * .65)},${Math.round(bb * .65)})`;

            // ── Logo ──────────────────────────────────────────────────────────────────
            const logoEl = document.querySelector(CONFIG.logoSelector);
            const logoSrc = logoEl ? logoEl.src : '';
            const logoHtml = logoSrc
                ? `<img src="${logoSrc}" crossorigin="anonymous" style="max-height:55px;width:auto" />`
                : esc(printTitle);

            // ── Load html2canvas (needed for count/CSS widgets and as ECharts fallback) ────
            setProg('Loading screenshot library…', 2);
            await loadHtml2Canvas();

            // ── Collect + sort grid items ──────────────────────────────────────────────
            setProg('Collecting widgets…', 5);

            const grid = document.querySelector(CONFIG.gridSelector);
            if (!grid) throw new Error(`Grid container "${CONFIG.gridSelector}" not found on this page.`);

            const items = [...grid.querySelectorAll('.grid-stack-item.dashboard-card')]
                // Keep only explicitly-visible items (data-visible="0" means hidden)
                .filter(el => el.getAttribute('data-visible') !== '0')
                // Map to a clean descriptor object
                .map(el => ({
                    el,
                    gridtype: (el.getAttribute('gridtype') || '').toLowerCase(),
                    gsY: parseInt(el.getAttribute('data-gs-y') || '0', 10),
                    gsX: parseInt(el.getAttribute('data-gs-x') || '0', 10),
                    gsW: parseInt(el.getAttribute('data-gs-width') || '12', 10),
                    title: cleanTitle(el.querySelector('.dashboard-title')),
                }))
                // Sort top-to-bottom, then left-to-right (matches visual reading order)
                .sort((a, b) => a.gsY !== b.gsY ? a.gsY - b.gsY : a.gsX - b.gsX);

            // ── Split items: counts → KPI strip, tables → own pages, rest → cards grid
            const tableItems = items.filter(i => i.gridtype === 'table');
            const countItems = items.filter(i => i.gridtype === 'count');
            const cardItems = items.filter(i => i.gridtype !== 'table' && i.gridtype !== 'count' && i.gridtype !== 'quicklinks');

            const ACCENT_COLORS = ['', 'teal', 'indigo', 'amber'];

            // ── Extract all table data early — used both for AI context and for rendering ─────
            const tableDataMap = new Map();
            for (const tItem of tableItems) {
                const td = extractTableData(tItem);
                if (td) tableDataMap.set(tItem.title, td);
            }

            // ── Fetch AI insights (aiMode only) ──────────────────────────────────
            let descriptions = {};
            let executiveSummary = '';
            let keyFindings = [];
            let recommendations = [];
            if (aiMode) {
                setProg('Generating AI insights…', 8);
                const activeFilters = readActiveFilters();
                const allForInsights = [
                    ...countItems.map(i => ({
                        title: i.title, type: 'count', currentValue: extractCountValue(i.el),
                    })),
                    ...cardItems.map(i => ({
                        title: i.title, type: i.gridtype, currentValue: '',
                        seriesData: extractChartSeriesData(i),
                    })),
                    ...tableItems.map(i => {
                        const td = tableDataMap.get(i.title);
                        return {
                            title: i.title, type: 'table', currentValue: '',
                            rowCount: td ? td.rows.length : null,
                            columns: td ? td.cols : [],
                            sampleRows: td ? td.rows.slice(0, 5) : [],
                        };
                    }),
                ];
                const insights = await fetchReportInsights(printTitle, allForInsights, activeFilters);
                descriptions = insights.descriptions;
                executiveSummary = insights.executiveSummary;
                keyFindings = insights.keyFindings || [];
                recommendations = insights.recommendations || [];
            }

            // ── Build KPI mini strip from count widgets ───────────────────────────────
            //    Design A: .progress-value .h2 > div  (circular ring variant)
            //    Design B: .dashboard-count > div     (large-number variant)
            let kpiStripHtml = '';
            countItems.forEach((item, idx) => {
                const val = esc(extractCountValue(item.el) || '—');
                const kpiNote = aiMode ? getInsight(descriptions, item.title) : null;
                kpiStripHtml += `<div class="kpi-card">
          <div class="metric-value">${val}</div>
          <div class="metric-label">${esc(item.title)}</div>
          ${kpiNote?.description ? `<div class="trend">${esc(kpiNote.description)}</div>` : ''}
        </div>`;
            });

            // ── Capture each non-table widget ─────────────────────────────────────────
            let cardsHtml = '';
            let chartIndex = 0;
            let lastSideLayout = 'left';

            for (let i = 0; i < cardItems.length; i++) {
                const item = cardItems[i];
                setProg(`Capturing widget ${i + 1} of ${cardItems.length}…`, 10 + Math.round(((i + 1) / cardItems.length) * 75));

                // ── Capture widget ────────────────────────────────────────────────────────
                //
                // ECharts widgets (linechart, bar, etc.) have a canvas we can read directly.
                // Count/KPI widgets are pure CSS — no canvas — so we use html2canvas instead.
                //
                const isECharts = item.el.querySelector('[_echarts_instance_]') !== null;

                let img = '';

                if (isECharts) {
                    // Try reading the ECharts canvas pixels directly (fast, lossless)
                    const graphContainer = item.el.querySelector('[_echarts_instance_]');
                    const canvas = graphContainer ? graphContainer.querySelector('canvas') : null;
                    if (canvas) {
                        try {
                            img = canvas.toDataURL('image/png');
                        } catch (canvasErr) {
                            console.warn('[LegacyReport] canvas.toDataURL failed for', item.title, canvasErr);
                        }
                    }
                }

                // For count/KPI widgets (pure CSS), or if ECharts canvas read failed,
                // screenshot the whole widget content div with html2canvas.
                // Hide the .dashboard-title header first — it's already rendered as card text above.
                if (!img) {
                    const content = item.el.querySelector('.grid-stack-item-content') || item.el;
                    const titleEl = content.querySelector('.dashboard-title');
                    if (titleEl) titleEl.style.display = 'none';
                    try {
                        const cap = await window.html2canvas(content, {
                            scale: 2, useCORS: true, allowTaint: true,
                            backgroundColor: '#ffffff', logging: false,
                        });
                        img = cap.toDataURL('image/png');
                    } catch (h2cErr) {
                        console.warn('[LegacyReport] html2canvas failed for', item.title, h2cErr);
                    } finally {
                        if (titleEl) titleEl.style.display = '';
                    }
                }

                const cc = ACCENT_COLORS[chartIndex % ACCENT_COLORS.length];
                const insight = aiMode ? getInsight(descriptions, item.title) : null;

                // Layout rules mirror dashboard.html:
                //   full-width widget  → bottom (text below chart)
                //   partial-width      → alternate right / left
                //   no AI / no desc    → full (chart only)
                let layout;
                if (!aiMode || !insight?.description) {
                    layout = 'full';
                } else if (item.gsW >= 10) {
                    layout = 'bottom';
                } else {
                    lastSideLayout = lastSideLayout === 'right' ? 'left' : 'right';
                    layout = lastSideLayout;
                }

                // Side layouts span the full grid width so both columns are used
                const spanFull = (item.gsW >= 10 || layout === 'right' || layout === 'left')
                    ? ' style="grid-column:1/-1"' : '';

                const imgTag = img ? `<img src="${img}" style="width:100%;display:block" />` : '';
                const noCapture = `<div style="padding:20px;color:#6b7280;font-size:11px;text-align:center;background:#f9fafb">Chart could not be captured</div>`;

                if (layout === 'right') {
                    cardsHtml += `
            <div class="wc wide"${spanFull}>
              <div class="wc-head"><span class="wc-head-title">${esc(item.title) || 'Chart'}</span></div>
              <div class="wc-body-right">
                <div class="wc-img">${img ? imgTag : noCapture}</div>
                <div class="insight-panel"><p>${esc(insight.description)}</p></div>
              </div>
            </div>`;
                } else if (layout === 'left') {
                    cardsHtml += `
            <div class="wc wide"${spanFull}>
              <div class="wc-head"><span class="wc-head-title">${esc(item.title) || 'Chart'}</span></div>
              <div class="wc-body-left">
                <div class="insight-panel"><p>${esc(insight.description)}</p></div>
                <div class="wc-img">${img ? imgTag : noCapture}</div>
              </div>
            </div>`;
                } else if (layout === 'bottom') {
                    cardsHtml += `
            <div class="wc${item.gsW >= 10 ? ' wide' : ''}"${spanFull}>
              <div class="wc-head"><span class="wc-head-title">${esc(item.title) || 'Chart'}</span></div>
              <div class="wc-body-bottom">
                <div class="wc-img">${img ? imgTag : noCapture}</div>
                ${insight?.description ? `<div class="wc-note"><span class="note-label">Insight</span>${esc(insight.description)}</div>` : ''}
              </div>
            </div>`;
                } else {
                    // full — no text
                    cardsHtml += `
            <div class="wc${item.gsW >= 10 ? ' wide' : ''}"${spanFull}>
              <div class="wc-head"><span class="wc-head-title">${esc(item.title) || 'Chart'}</span></div>
              <div class="wc-body-bottom">
                <div class="wc-img">${img ? imgTag : noCapture}</div>
              </div>
            </div>`;
                }

                chartIndex++;
            }

            // ── Build table pages (one page per DataTable widget) ─────────────────────
            const fmtCell = v => {
                if (v === null || v === undefined || v === '') return '-';
                const s = String(v).trim();
                // Format ISO dates as DD/MM/YYYY
                if (/^\d{4}-\d{2}-\d{2}([ T]|$)/.test(s)) {
                    const d = new Date(s);
                    if (!isNaN(d.getTime()))
                        return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
                }
                return esc(s);
            };
            const badgeClass = v => {
                const s = String(v).toLowerCase();
                if (/\bopen\b|high|fail|\bdanger\b|critical|reject|not started/.test(s)) return 'red';
                if (/clos|done|complet|pass|resolv|approv/.test(s)) return 'green';
                if (/review|pending|\bprogress\b|medium|warn/.test(s)) return 'amber';
                return '';
            };

            let tablePagesHtml = '';
            for (const tItem of tableItems) {
                setProg(`Rendering table: ${tItem.title}…`, 87);
                const td = tableDataMap.get(tItem.title);
                if (!td) continue;

                let bodyHtml;
                if (!td.rows.length) {
                    bodyHtml = `<div style="padding:20px 28px;color:#6b7280;font-size:11px">No data available</div>`;
                } else {
                    const headerCells = td.cols.map(c => `<th>${esc(c)}</th>`).join('');
                    const bodyRows = td.rows.map(row =>
                        `<tr>${row.map(cell => `<td>${cell}</td>`).join('')}</tr>`
                    ).join('');
                    bodyHtml = `<div class="data-table-wrap"><table class="data-table">
            <thead><tr>${headerCells}</tr></thead>
            <tbody>${bodyRows}</tbody>
          </table></div>`;
                }

                const tableInsight = aiMode ? getInsight(descriptions, tItem.title) : null;
                const tableNote = tableInsight && tableInsight.description
                    ? `<div class="table-insight">${esc(tableInsight.description)}</div>`
                    : '';

                tablePagesHtml += `<div class="page">
  <div class="table-banner">
    <span class="tit">&#128203; ${esc(td.title)}</span>
    ${td.rows.length ? `<span class="cnt">${td.rows.length} records &middot; ${printDate}</span>` : ''}
  </div>
  ${tableNote}
  ${bodyHtml}
  <div class="page-footer">
    <span style="display:inline-flex;align-items:center;gap:4px;white-space:nowrap;font-size:8px;color:#94a3b8;">Powered by <img src="https://whsmonitor.com.au/wp-content/themes/whs-monitor/assets/images/WHSLogo_Blue.png" alt="WHS Monitor" style="height:12px;width:auto;opacity:0.6;vertical-align:middle;position:relative;top:2px;"></span>
    <span>${esc(printTitle)}</span>
  </div>
</div>`;
            }

            const chartCount = cardItems.length;
            const sectionCount = 0;

            // ── Assemble full HTML document ────────────────────────────────────────────
            setProg('Building report…', 90);

            const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>${esc(printTitle)} — Report</title>
<script src="https://unpkg.com/@phosphor-icons/web@2.1.1"></script>
<style>
@import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;500;600;700;800&family=Poppins:wght@700;800&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  /* Dynamic brand colour */
  --blue:${brandColor};--blue-lt:${brandLt};--blue-dk:${brandDk};
  /* Semantic palette — mirrors dashboard.html */
  --primary:${brandColor};--secondary:#212950;--bg:#F8F7F5;--white:#FFFFFF;
  --text:#231F21;--muted:#6F7482;--line:#ECEEF2;--soft-blue:#EEF6FF;
  --success:#12A37F;--warning:#F59E0B;--danger:#E45E5E;--radius:10px;
  --shadow:0 10px 25px rgba(33,41,80,.06);
  /* Legacy accent colours */
  --teal:#0d9488;--amber:#d97706;--indigo:#4f46e5;--rose:#e11d48;
  --dark:#111827;--mid:#6b7280;--light:#f3f4f6;--border:#ECEEF2
}
body{min-height:100vh;background:var(--bg);font-family:'Nunito',Arial,sans-serif;color:var(--text);padding:32px 20px 56px;display:flex;flex-direction:column;align-items:center;gap:28px}
h1,h2,h3{font-family:'Nunito',sans-serif;font-weight:600;color:var(--secondary)}
p{line-height:1.65;color:var(--muted)}

/* ── Page shell ──────────────────────────────────────────── */
.page{width:min(960px,100%);min-height:1120px;background:var(--white);border:1px solid var(--line);border-radius:12px;box-shadow:var(--shadow);overflow:hidden;display:flex;flex-direction:column}

/* ── Cover ───────────────────────────────────────────────── */
.cover{padding:54px 56px 44px;background:#fff}
.brand-row{display:flex;align-items:center;justify-content:space-between;margin-bottom:90px}
.logo-mark{display:flex;align-items:center;gap:12px;font-weight:700;color:var(--secondary)}
.cover-chip{border:1px solid var(--line);border-radius:8px;padding:8px 14px;color:var(--secondary);font-weight:600;font-size:12px;background:white}
.cover-eyebrow{font-size:20px;text-transform:uppercase;letter-spacing:.18em;color:var(--primary);font-weight:700;margin-bottom:14px}
.cover-title{font-size:40px;line-height:1.05;max-width:600px;letter-spacing:-.05em;margin-bottom:18px;font-family:'Nunito',sans-serif;font-weight:600;color:var(--secondary)}
.cover-sub{font-size:17px;max-width:520px;color:var(--muted)}
.cover-meta-strip{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;padding:0 56px 56px;background:white}
.cover-meta-item{background:var(--bg);border-radius:10px;padding:22px 24px;border:1px solid #F0EFED;min-height:120px;display:flex;flex-direction:column;justify-content:space-between;text-align:center}
.cover-meta-val{font-family:'Nunito',sans-serif;font-size:34px;line-height:1;color:var(--secondary);font-weight:600;margin:auto 0}
.cover-meta-val.accent{color:var(--primary)}
.cover-meta-val.date{font-size:20px;letter-spacing:-.03em}
.cover-meta-lbl{font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;margin-top:auto}

/* ── Content area ────────────────────────────────────────── */
.content{padding:34px 40px 30px;display:flex;flex-direction:column;gap:24px;flex:1}
.section-header{display:flex;align-items:flex-end;justify-content:space-between;gap:18px;margin:4px 0 2px}
.section-kicker{font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:var(--primary);font-weight:700;margin-bottom:4px}
.section-title{font-size:25px;letter-spacing:-.03em}
.section-date{font-size:13px;color:var(--muted);font-weight:600}

/* ── KPI strip ───────────────────────────────────────────── */
.kpi-strip{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}
.kpi-card{background:var(--white);border:1px solid var(--line);border-radius:8px;padding:20px;position:relative;overflow:hidden}
.metric-value{font-size:34px;letter-spacing:-.05em;margin-bottom:4px;font-family:'Nunito',sans-serif;font-weight:600;color:var(--secondary)}
.metric-label{font-size:12px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.06em;min-height:32px}
.trend{margin-top:12px;font-size:12px;color:222 !important;}
.trend.down{color:var(--danger)}.trend.warn{color:var(--warning)}

/* ── Cards grid ──────────────────────────────────────────── */
.cards-grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}
.wc{background:var(--white);border:1px solid var(--line);border-radius:10px;overflow:hidden;display:flex;flex-direction:column;min-height:330px}
.wc.wide{grid-column:1/-1;min-height:300px}
.wc-head{padding:22px 24px 12px;display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
.wc-head-title{font-family:'Nunito',sans-serif;font-weight:600;color:var(--secondary);font-size:20px;line-height:1.2;letter-spacing:-.03em}
.wc-body-right,.wc-body-left{display:grid;grid-template-columns:1.55fr 1fr;gap:0;flex:1}
.wc-body-left{grid-template-columns:1fr 1.55fr}
.wc-body-left .wc-img{order:2}.wc-body-left .insight-panel{order:1}
.wc-body-bottom{display:flex;flex-direction:column;flex:1}
.wc-img{background:#fff;padding:14px 18px 20px;display:flex;align-items:center;justify-content:center}
.wc-img img{width:100%;display:block}
.insight-panel{background:#fff;padding:28px 26px;display:flex;align-items:center}
.insight-panel p{font-size:14px;color:#545A6B}
.wc-note{border-top:1px solid var(--line);background:var(--bg);padding:18px 22px;color:#545A6B;font-size:13px;line-height:1.6}
.note-label{display:block;color:var(--primary);text-transform:uppercase;letter-spacing:.1em;font-size:10px;font-weight:700;margin-bottom:6px}

/* ── AI table insight callout ────────────────────────────── */
.table-insight{margin:20px 24px;background:var(--bg);border-radius:8px;padding:18px 20px;color:#545A6B;font-size:14px;line-height:1.65;border-left:4px solid var(--primary)}

/* ── Table page ──────────────────────────────────────────── */
.table-banner{padding:24px 26px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--line);background:white}
.table-banner .tit{font-family:'Nunito',sans-serif;font-size:23px;color:var(--secondary);font-weight:600;letter-spacing:-.03em}
.cnt{background:#f1f5f9;color:#475569;border:1px solid var(--line);padding:5px 12px;border-radius:8px;font-size:11px;font-weight:600}
.data-table-wrap{padding:0 24px 26px;overflow-x:auto}
.data-table{width:100%;border-collapse:separate;border-spacing:0;font-size:13px}
.data-table th{padding:10px 14px;text-align:left;background:var(--bg);color:#6b7280;font-weight:600;font-size:10px;text-transform:uppercase;letter-spacing:.06em;border-bottom:2px solid var(--line)}
.data-table th:first-child{border-radius:4px 0 0 4px}
.data-table th:last-child{border-radius:0 4px 4px 0}
.data-table td{padding:14px;border-bottom:1px solid var(--line);color:#1a1d27}
.badge{display:inline-block;border-radius:8px;padding:5px 10px;font-size:11px;font-weight:700}
.badge.red{background:#FFF0F0;color:var(--danger)}
.badge.green{background:#EAF8F4;color:var(--success)}.badge.amber{background:#FFF7E8;color:var(--warning)}

/* ── Bootstrap colour utilities (for datatable cell classes) ─ */
.text-danger,.text-danger *{color:#dc3545!important}
.text-warning,.text-warning *{color:#ffc107!important}
.text-success,.text-success *{color:#198754!important}
.text-primary,.text-primary *{color:#0d6efd!important}
.text-info,.text-info *{color:#0dcaf0!important}
.text-muted,.text-muted *{color:#6c757d!important}
.text-secondary,.text-secondary *{color:#6c757d!important}
.text-dark,.text-dark *{color:#212529!important}
.text-white,.text-white *{color:#fff!important}
.bg-danger{background-color:#dc3545!important}
.bg-warning{background-color:#ffc107!important}
.bg-success{background-color:#198754!important}
.bg-primary{background-color:#0d6efd!important}
.bg-info{background-color:#0dcaf0!important}
.bg-secondary{background-color:#6c757d!important}
.bg-light{background-color:#f8f9fa!important}
.bg-dark{background-color:#212529!important}
.badge.bg-danger,.badge.text-bg-danger{background:#dc3545!important;color:#fff!important}
.badge.bg-warning,.badge.text-bg-warning{background:#ffc107!important;color:#000!important}
.badge.bg-success,.badge.text-bg-success{background:#198754!important;color:#fff!important}
.badge.bg-primary,.badge.text-bg-primary{background:#0d6efd!important;color:#fff!important}
.badge.bg-info,.badge.text-bg-info{background:#0dcaf0!important;color:#000!important}
.badge.bg-secondary,.badge.text-bg-secondary{background:#6c757d!important;color:#fff!important}
.badge.bg-light,.badge.text-bg-light{background:#f8f9fa!important;color:#000!important}
.badge.bg-dark,.badge.text-bg-dark{background:#212529!important;color:#fff!important}

/* ── Page footer ─────────────────────────────────────────── */
.page-footer{margin-top:auto;padding:18px 40px;border-top:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;color:var(--muted);font-size:12px;font-weight:700}
.brand{color:var(--secondary)}

/* ── Sticky print bar (screen only) ─────────────────────── */
.print-bar{width:min(960px,100%);background:var(--white);border:1px solid var(--line);box-shadow:0 6px 18px rgba(33,41,80,.05);border-radius:8px;padding:10px 12px 10px 20px;display:flex;align-items:center;justify-content:space-between;gap:16px;position:sticky;top:16px;z-index:20}
.print-bar-title{font-size:13px;color:var(--secondary);font-weight:600;display:flex;gap:10px;align-items:center}
.ai-badge{background:var(--soft-blue);color:var(--primary);font-size:11px;font-weight:600;padding:5px 10px;border-radius:8px}
.print-btn{border:0;background:var(--primary);color:white;border-radius:8px;padding:11px 18px;font-weight:600;font-family:'Nunito',Arial,sans-serif;cursor:pointer;box-shadow:0 8px 20px rgba(59,152,241,.25)}
.print-btn:hover{opacity:.88}
.send-btn{border:0;background:#16a34a;color:white;border-radius:8px;padding:11px 18px;font-weight:600;font-family:'Nunito',Arial,sans-serif;cursor:pointer;margin-right:8px}
.send-btn:hover{opacity:.88}

/* ── Phosphor icon alignment ──────────────────────────────── */
.ph{vertical-align:-0.125em;font-size:1em}
@keyframes sr-spin{to{transform:rotate(360deg)}}
.ph-spin{display:inline-block;animation:sr-spin .8s linear infinite}

/* ── Key Findings page ───────────────────────────────────── */
.kf-hero{background:white;border-bottom:2px solid var(--line);padding:28px 32px 24px;position:relative;overflow:hidden;flex-shrink:0}
.kf-hero-eyebrow{font-size:8px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.14em;margin-bottom:8px;position:relative;z-index:1}
.kf-hero-row{display:flex;align-items:flex-end;justify-content:space-between;position:relative;z-index:1}
.kf-hero-title{font-size:24px;font-weight:800;color:var(--secondary);line-height:1.1;letter-spacing:-.01em}
.kf-hero-title span{display:block;font-size:10px;font-weight:400;color:var(--muted);letter-spacing:.04em;margin-top:4px}
.kf-hero-badge{background:var(--soft-blue);border:1px solid var(--line);border-radius:20px;padding:5px 14px;font-size:8.5px;color:var(--primary);font-weight:600;letter-spacing:.04em;white-space:nowrap}
.kf-subhead{background:var(--bg);border-bottom:1px solid var(--line);padding:9px 32px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0}
.kf-subhead-left{font-size:13px;color:var(--secondary);font-weight:600}
.kf-subhead-right{font-size:11px;color:var(--muted)}
.kf-grid{padding:14px 28px 0;display:grid;grid-template-columns:1fr 1fr;gap:10px;flex-shrink:0;align-content:start}
.kf-card{background:#fff;border:1px solid var(--border);border-radius:8px;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 1px 4px rgba(0,0,0,.05)}
.kf-card.full{grid-column:1 / -1}
.kf-card-accent{height:3px;background:var(--blue);flex-shrink:0}
.kf-card-accent.c-teal{background:var(--teal)}.kf-card-accent.c-indigo{background:var(--indigo)}.kf-card-accent.c-amber{background:var(--amber)}.kf-card-accent.c-rose{background:var(--rose)}
.kf-card-body{padding:10px 12px 12px;display:flex;gap:12px;align-items:flex-start;flex:1}
.kf-num{flex-shrink:0;font-size:24px;font-weight:900;line-height:1;color:var(--blue);opacity:.18;letter-spacing:-.02em;min-width:28px;margin-top:-2px}
.kf-num.c-teal{color:var(--teal)}.kf-num.c-indigo{color:var(--indigo)}.kf-num.c-amber{color:var(--amber)}.kf-num.c-rose{color:var(--rose)}
.kf-text{flex:1}
.kf-text p{font-size:14px;color:#374151;line-height:1.8;margin:0}
.kf-attribution{margin:0 28px 20px;padding:8px 14px;background:#f8fafc;border:1px solid var(--border);border-radius:6px;display:flex;align-items:center;gap:8px;flex-shrink:0}
.kf-attr-dot{width:6px;height:6px;border-radius:50%;background:var(--blue);flex-shrink:0}
.kf-attribution span{font-size:7.5px;color:var(--mid);letter-spacing:.02em}
.kf-attribution strong{color:var(--blue);font-weight:600}
.kf-rec-subhead{background:var(--bg);border-top:1px solid var(--line);border-bottom:1px solid var(--line);padding:9px 32px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;margin-top:14px}
.kf-rec-subhead-left{font-size:13px;color:var(--secondary);font-weight:600}
.kf-rec-subhead-right{font-size:11px;color:var(--muted)}
.kf-section-header{font-size:8.5px;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:.1em;margin-bottom:6px;display:flex;align-items:center;gap:5px}
.kf-actions{margin:20px 28px 0;flex-shrink:0}
.kf-actions-table{width:100%;border-collapse:collapse;font-size:8px;color:#374151}
.kf-actions-table th{background:#f3f4f6;padding:5px 8px;text-align:left;font-weight:700;font-size:7.5px;text-transform:uppercase;letter-spacing:.07em;color:#6b7280;border:1px solid var(--border)}
.kf-actions-table td{padding:7px 8px;border:1px solid var(--border);height:20px}
.kf-actions-table tr:nth-child(even) td{background:#fafafa}
.kf-signoff{margin:24px 28px 0;flex-shrink:0}
.kf-signoff-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.kf-signoff-block{border:1px solid var(--border);border-radius:6px;overflow:hidden}
.kf-signoff-block-header{background:#f3f4f6;padding:5px 10px;font-size:7.5px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.07em;border-bottom:1px solid var(--border)}
.kf-signoff-fields{padding:8px 10px;display:flex;flex-direction:column;gap:7px}
.kf-signoff-field{display:flex;flex-direction:column;gap:1px}
.kf-signoff-field-label{font-size:7px;color:#9ca3af;text-transform:uppercase;letter-spacing:.08em}
.kf-signoff-field-value{font-size:8.5px;color:#111827;font-weight:500;padding-bottom:1px;border-bottom:1px solid #d1d5db;min-height:15px}
.kf-signoff-field-line{border-bottom:1px solid #d1d5db;min-height:15px}
.kf-signoff-field-line.sig{min-height:22px}

/* ── Send Report modal (screen only) ─────────────────────── */
.sr-backdrop{position:fixed;inset:0;background:rgba(15,23,42,.55);display:none;align-items:center;justify-content:center;padding:24px;z-index:1000}
.sr-backdrop.open{display:flex}
.sr-modal{background:#fff;border-radius:12px;width:100%;max-width:680px;box-shadow:0 24px 60px rgba(0,0,0,.25);display:flex;flex-direction:column;max-height:92vh;overflow:hidden;font-family:'Nunito',Arial,sans-serif}
.sr-hdr{background:#3B98F1;padding:20px 24px 18px;display:flex;align-items:flex-start;justify-content:space-between;flex-shrink:0}
.sr-hdr-left{display:flex;flex-direction:column;gap:4px}
.sr-eyebrow{font-size:9px;font-weight:700;color:rgba(255,255,255,.55);text-transform:uppercase;letter-spacing:.14em}
.sr-title{font-size:20px;font-weight:800;color:#fff;line-height:1.1}
.sr-close{background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.25);border-radius:6px;width:30px;height:30px;display:flex;align-items:center;justify-content:center;cursor:pointer;color:#fff;font-size:16px;flex-shrink:0;margin-top:2px}
.sr-close:hover{background:rgba(255,255,255,.25)}
.sr-pill{background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;margin:16px 24px 0;padding:10px 14px;display:flex;align-items:center;gap:10px;flex-shrink:0}
.sr-pill-icon{font-size:18px;flex-shrink:0}
.sr-pill-info{flex:1;min-width:0}
.sr-pill-name{font-size:11px;font-weight:700;color:#111827;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sr-pill-meta{font-size:9px;color:#6b7280;margin-top:1px}
.sr-body{flex:1;overflow-y:auto;padding:20px 24px;display:flex;flex-direction:column;gap:18px}
.sr-sec-lbl{font-size:10px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px}
.sr-tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}
.sr-tab{font-size:11px;font-weight:600;padding:5px 12px;border-radius:20px;border:1.5px solid #e5e7eb;color:#6b7280;cursor:pointer;transition:all .15s;background:#fff;user-select:none}
.sr-tab:hover{border-color:#3B98F1;color:#3B98F1}
.sr-tab.active{background:#3B98F1;color:#fff;border-color:#3B98F1}
.sr-tab .sr-tab-cnt{display:inline-block;background:rgba(255,255,255,.3);border-radius:8px;font-size:9px;padding:0 5px;margin-left:4px;font-weight:700}
.sr-tab:not(.active) .sr-tab-cnt{background:#f3f4f6;color:#6b7280}
.sr-panel{display:none}
.sr-panel.visible{display:block}
.sr-ms-wrap{border:1.5px solid #e5e7eb;border-radius:8px;overflow:hidden;background:#fff}
.sr-ms-wrap:focus-within{border-color:#3B98F1;box-shadow:0 0 0 3px rgba(59,152,241,.12)}
.sr-search-row{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid #e5e7eb;background:#fafafa}
.sr-search-row input{border:none;background:transparent;outline:none;font-size:11px;color:#111827;width:100%;font-family:inherit}
.sr-search-row input::placeholder{color:#9ca3af}
.sr-sel-all-row{display:flex;align-items:center;justify-content:space-between;padding:6px 12px;border-bottom:1px solid #e5e7eb;background:#f9fafb}
.sr-sel-all-btn{font-size:10px;color:#3B98F1;cursor:pointer;font-weight:600}
.sr-sel-all-btn:hover{text-decoration:underline}
.sr-sel-count{font-size:10px;color:#6b7280}
.sr-list{max-height:160px;overflow-y:auto}
.sr-item{display:flex;align-items:center;gap:10px;padding:8px 12px;cursor:pointer;transition:background .1s;user-select:none}
.sr-item:hover{background:#f9fafb}
.sr-item.selected{background:#eff6ff}
.sr-item-cb{width:15px;height:15px;border:1.5px solid #e5e7eb;border-radius:4px;flex-shrink:0;display:flex;align-items:center;justify-content:center;transition:all .15s}
.sr-item.selected .sr-item-cb{background:#3B98F1;border-color:#3B98F1}
.sr-item.selected .sr-item-cb::after{content:'✓';color:#fff;font-size:9px;font-weight:700}
.sr-item-label{font-size:11px;color:#111827;flex:1}
.sr-item-sub{font-size:9px;color:#6b7280}
.sr-item-av{width:22px;height:22px;border-radius:50%;background:#3B98F1;color:#fff;font-size:9px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.sr-item-av.t{background:#0d9488}.sr-item-av.a{background:#d97706}.sr-item-av.r{background:#e11d48}.sr-item-av.i{background:#4f46e5}
.sr-empty{padding:16px 12px;font-size:11px;color:#6b7280;text-align:center}
.sr-loading{padding:14px 12px;font-size:11px;color:#6b7280;text-align:center}
.sr-chips-wrap{display:flex;flex-wrap:wrap;gap:6px;min-height:22px;margin-top:10px}
.sr-chip{display:inline-flex;align-items:center;gap:5px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:20px;padding:3px 10px 3px 8px;font-size:10px;color:#2563eb;font-weight:600}
.sr-chip.div{background:#f0fdf4;border-color:#bbf7d0;color:#166534}
.sr-chip.dep{background:#fef3c7;border-color:#fde68a;color:#92400e}
.sr-chip.rol{background:#f5f3ff;border-color:#ddd6fe;color:#5b21b6}
.sr-chip-x{cursor:pointer;font-size:11px;opacity:.6;line-height:1}
.sr-chip-x:hover{opacity:1}
.sr-summary-row{display:flex;align-items:center;gap:6px;padding:8px 12px;background:#f8fafc;border:1px solid #e5e7eb;border-radius:8px;margin-top:8px}
.sr-summary-dot{width:7px;height:7px;border-radius:50%;background:#3B98F1;flex-shrink:0}
.sr-summary-text{font-size:10px;color:#6b7280;flex:1}
.sr-summary-count{font-size:11px;font-weight:700;color:#3B98F1}
.sr-field{display:flex;flex-direction:column;gap:5px}
.sr-field label{font-size:10px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.07em}
.sr-field input,.sr-field textarea{border:1.5px solid #e5e7eb;border-radius:8px;padding:9px 12px;font-size:12px;color:#111827;font-family:inherit;outline:none;transition:border .15s,box-shadow .15s;resize:none}
.sr-field input:focus,.sr-field textarea:focus{border-color:#3B98F1;box-shadow:0 0 0 3px rgba(59,152,241,.12)}
.sr-field textarea{min-height:72px}
.sr-ftr{padding:14px 24px;border-top:1px solid #e5e7eb;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;gap:12px;background:#fafafa}
.sr-ftr-note{font-size:9.5px;color:#6b7280;display:flex;align-items:center;gap:5px}
.sr-ftr-btns{display:flex;gap:8px}
.sr-btn-ghost{background:transparent;border:1.5px solid #e5e7eb;color:#6b7280;border-radius:8px;padding:9px 20px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit}
.sr-btn-ghost:hover{border-color:#9ca3af;color:#111827}
.sr-btn-primary{background:#3B98F1;color:#fff;box-shadow:0 2px 8px rgba(59,152,241,.35);border:none;border-radius:8px;padding:9px 20px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit}
.sr-btn-primary:hover{opacity:.88}
.sr-btn-primary:disabled{opacity:.5;cursor:not-allowed}
.sr-user-search-hint{font-size:10px;color:#6b7280;padding:6px 12px;background:#f9fafb;border-bottom:1px solid #e5e7eb;font-style:italic}

/* ── Print media ──────────────────────────────────────────── */
@page{size:A4 portrait;margin:0}
@media print{
  body{background:white;padding:0;gap:0}
  .print-bar{display:none}
  .sr-backdrop{display:none!important}
  .page{width:100%;min-height:100vh;border:0;border-radius:0;box-shadow:none;page-break-after:always;break-after:page}
  .page:last-child{page-break-after:avoid;break-after:avoid}
  .cover{print-color-adjust:exact;-webkit-print-color-adjust:exact}
  .data-table th{print-color-adjust:exact;-webkit-print-color-adjust:exact}
  .wc{page-break-inside:avoid;break-inside:avoid}
  .kpi-strip{page-break-inside:avoid;break-inside:avoid}
  .data-table tbody tr{page-break-inside:avoid;break-inside:avoid}
  .table-insight{page-break-inside:avoid;break-inside:avoid}
  .insight-panel{print-color-adjust:exact;-webkit-print-color-adjust:exact}
  .kf-hero{print-color-adjust:exact;-webkit-print-color-adjust:exact}
  .kf-card-accent{print-color-adjust:exact;-webkit-print-color-adjust:exact}
  .kf-num{print-color-adjust:exact;-webkit-print-color-adjust:exact}
  .kf-attr-dot{print-color-adjust:exact;-webkit-print-color-adjust:exact}
  .kf-card{page-break-inside:avoid;break-inside:avoid}
  .kf-rec-subhead{print-color-adjust:exact;-webkit-print-color-adjust:exact}
  .kf-actions-table th{print-color-adjust:exact;-webkit-print-color-adjust:exact}
  .kf-signoff-block-header{print-color-adjust:exact;-webkit-print-color-adjust:exact}
}
</style>
<script>
// ── Config (inlined at report-generation time) ────────────────
var SR_STORE_ID  = ${srStoreId || 0};
var SR_USER_ID   = ${srUserId  || 0};
var SR_ASHX_BASE = ${JSON.stringify(srAshxBase)};
var SR_ASMX_BASE = ${JSON.stringify(srAsmxBase)};
var SR_SEND_URL  = ${JSON.stringify(srSendUrl)};
// ── State ────────────────────────────────────────────────────
var srSel    = { users:{}, division:{}, department:{}, role:{} };
var srTotal  = { users:0, division:0, department:0, role:0 };
var srLoaded = { division:false, department:false };
var srSearchTimer = null;
// ── Wire backdrop click-outside after DOM ready ───────────────
document.addEventListener('DOMContentLoaded', function() {
  var bd = document.getElementById('sr-backdrop');
  if (bd) bd.addEventListener('click', function(e) { if (e.target === this) srClose(); });
});
// ── Open / Close ─────────────────────────────────────────────
function srOpen() {
  document.getElementById('sr-backdrop').classList.add('open');
  srLoadDivisions();
  srLoadDepartments();
}
function srClose() {
  document.getElementById('sr-backdrop').classList.remove('open');
}
// ── Tab switch ───────────────────────────────────────────────
function srTab(tab, el) {
  document.querySelectorAll('.sr-tab').forEach(function(t){ t.classList.remove('active'); });
  document.querySelectorAll('.sr-panel').forEach(function(p){ p.classList.remove('visible'); });
  el.classList.add('active');
  document.getElementById('sr-panel-'+tab).classList.add('visible');
}
// ── Load divisions ───────────────────────────────────────────
function srLoadDivisions() {
  if (srLoaded.division) return;
  srLoaded.division = true;
  fetch(SR_ASHX_BASE + '/GetDivision.ashx?storeId=' + SR_STORE_ID + '&memberId=' + SR_USER_ID)
    .then(function(r){ return r.json(); })
    .then(function(j){
      var items = (j.data || []);
      srTotal.division = items.length;
      var list = document.getElementById('sr-division-list');
      if (!items.length) { list.innerHTML = '<div class="sr-empty">No divisions found</div>'; srUpdateSelCount('division'); return; }
      list.innerHTML = items.map(function(x){
        return '<div class="sr-item" data-group="division" data-id="'+x.IDNo+'" data-label="'+srEsc(x.RowDescription)+'" onclick="srToggle(this,\\'division\\')" >'
          + '<div class="sr-item-cb"></div>'
          + '<div class="sr-item-label">'+srEsc(x.RowDescription)+'</div>'
          + '</div>';
      }).join('');
      srUpdateSelCount('division');
    })
    .catch(function(){ document.getElementById('sr-division-list').innerHTML = '<div class="sr-empty">Failed to load divisions</div>'; });
}
// ── Load departments ─────────────────────────────────────────
function srLoadDepartments() {
  if (srLoaded.department) return;
  srLoaded.department = true;
  fetch(SR_ASHX_BASE + '/GetDepartment.ashx?storeId=' + SR_STORE_ID + '&memberId=' + SR_USER_ID + '&parentId=0')
    .then(function(r){ return r.json(); })
    .then(function(j){
      var items = (j.data || []);
      srTotal.department = items.length;
      var list = document.getElementById('sr-department-list');
      if (!items.length) { list.innerHTML = '<div class="sr-empty">No departments found</div>'; srUpdateSelCount('department'); return; }
      list.innerHTML = items.map(function(x){
        return '<div class="sr-item" data-group="department" data-id="'+x.IDNo+'" data-label="'+srEsc(x.RowDescription)+'" onclick="srToggle(this,\\'department\\')">'  
          + '<div class="sr-item-cb"></div>'
          + '<div class="sr-item-label">'+srEsc(x.RowDescription)+'</div>'
          + '</div>'
      }).join('');
      srUpdateSelCount('department');
    })
    .catch(function(){ document.getElementById('sr-department-list').innerHTML = '<div class="sr-empty">Failed to load departments</div>'; });
}
// ── Search users / roles ──────────────────────────────────────
function srSearchUsers(query, tab) {
  tab = tab || 'users';
  var listId = tab === 'role' ? 'sr-role-list' : 'sr-users-list';
  clearTimeout(srSearchTimer);
  var q = (query || '').trim();
  if (q.length < 2) {
    document.getElementById(listId).innerHTML = '<div class="sr-empty">No results \u2014 type to search</div>';
    return;
  }
  document.getElementById(listId).innerHTML = '<div class="sr-loading">Searching&#8230;</div>';
  srSearchTimer = setTimeout(function(){
    fetch(SR_ASMX_BASE + '/GetAuditedLimit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: { StoreID: SR_STORE_ID, LocType: 0, LocID: 0, MemberId: SR_USER_ID, Search: q } })
    })
    .then(function(r){ return r.json(); })
    .then(function(j){
      var records = (j.d && j.d.recordList) ? j.d.recordList : [];
      var list = document.getElementById(listId);
      if (!records.length) { list.innerHTML = '<div class="sr-empty">No results found</div>'; return; }
      var colors = ['','t','a','r','i'];
      list.innerHTML = records.map(function(r, idx){
        var initials = (r.RowDescription || '?').split(' ').slice(0,2).map(function(w){ return w[0]||''; }).join('').toUpperCase();
        var col = colors[idx % colors.length];
        return '<div class="sr-item" data-group="'+tab+'" data-id="'+r.IDNo+'" data-label="'+srEsc(r.RowDescription)+'" onclick="srToggle(this,\\''+tab+'\\')"> '
          + '<div class="sr-item-cb"></div>'
          + '<div class="sr-item-av '+(col||'')+'">'+initials+'</div>'
          + '<div class="sr-item-label">'+srEsc(r.RowDescription)+'</div>'
          + '</div>';
      }).join('');
      Object.keys(srSel[tab]).forEach(function(id){
        var el = list.querySelector('[data-id="'+id+'"]');
        if (el) el.classList.add('selected');
      });
    })
    .catch(function(){ document.getElementById(listId).innerHTML = '<div class="sr-empty">Search failed</div>'; });
  }, 300);
}
// ── Toggle item ──────────────────────────────────────────────
function srToggle(el, group) {
  var id    = el.dataset.id;
  var label = el.dataset.label;
  if (el.classList.contains('selected')) {
    el.classList.remove('selected');
    delete srSel[group][id];
  } else {
    el.classList.add('selected');
    srSel[group][id] = label;
  }
  srUpdateUI(group);
}
// ── Select all ───────────────────────────────────────────────
function srSelectAll(listId, group) {
  var items = document.querySelectorAll('#'+listId+' .sr-item:not([style*="display:none"]):not([style*="display: none"])');
  var allSel = Array.prototype.every.call(items, function(i){ return i.classList.contains('selected'); });
  items.forEach(function(el){
    var id = el.dataset.id; var label = el.dataset.label;
    if (allSel) { el.classList.remove('selected'); delete srSel[group][id]; }
    else        { el.classList.add('selected');    srSel[group][id] = label; }
  });
  srUpdateUI(group);
}
// ── Filter ───────────────────────────────────────────────────
function srFilter(listId, query) {
  var q = query.toLowerCase();
  document.querySelectorAll('#'+listId+' .sr-item').forEach(function(el){
    el.style.display = el.dataset.label.toLowerCase().indexOf(q) >= 0 ? '' : 'none';
  });
}
// ── Update sel count ─────────────────────────────────────────
function srUpdateSelCount(group) {
  var el = document.getElementById('sr-selcount-'+group);
  if (!el) return;
  el.textContent = Object.keys(srSel[group]).length + ' of ' + srTotal[group] + ' selected';
}
// ── Update UI after selection change ─────────────────────────
function srUpdateUI(group) {
  var cnt = Object.keys(srSel[group]).length;
  document.getElementById('sr-cnt-'+group).textContent = cnt;
  srUpdateSelCount(group);
  srRenderChips();
  var total = Object.keys(srSel.users).length + Object.keys(srSel.division).length
            + Object.keys(srSel.department).length + Object.keys(srSel.role).length;
  document.getElementById('sr-total').textContent = total === 0 ? '0 selected' : total + ' recipient' + (total !== 1 ? 's' : '');
  document.getElementById('sr-send-btn').disabled = total === 0;
}
// ── Render chips ─────────────────────────────────────────────
function srRenderChips() {
  var wrap = document.getElementById('sr-chips-wrap');
  wrap.innerHTML = '';
  function addChip(group, id, label, cls) {
    var c = document.createElement('div');
    c.className = 'sr-chip ' + (cls || '');
    c.innerHTML = srEsc(label) + '<span class="sr-chip-x" onclick="srRemoveChip(\\''+group+'\\',\\''+id+'\\')" ><i class="ph ph-x"></i></span>';
    wrap.appendChild(c);
  }
  Object.keys(srSel.users).forEach(function(id){ addChip('users',id,srSel.users[id],''); });
  Object.keys(srSel.division).forEach(function(id){ addChip('division',id,srSel.division[id],'div'); });
  Object.keys(srSel.department).forEach(function(id){ addChip('department',id,srSel.department[id],'dep'); });
  Object.keys(srSel.role).forEach(function(id){ addChip('role',id,srSel.role[id],'rol'); });
}
// ── Remove chip ──────────────────────────────────────────────
function srRemoveChip(group, id) {
  delete srSel[group][id];
  var el = document.querySelector('[data-group="'+group+'"][data-id="'+id+'"]');
  if (el) el.classList.remove('selected');
  srUpdateUI(group);
}
// ── Send ─────────────────────────────────────────────────────
function srHandleSend() {
  var btn = document.getElementById('sr-send-btn');
  btn.disabled = true;
  btn.innerHTML = '<i class="ph ph-circle-notch ph-spin"></i>\u00a0 Sending\u2026';

  var payload = {
    storeId:       SR_STORE_ID,
    userId:        SR_USER_ID,
    userIds:       Object.keys(srSel.users).map(Number),
    divisionIds:   Object.keys(srSel.division).map(Number),
    departmentIds: Object.keys(srSel.department).map(Number),
    roleIds:       Object.keys(srSel.role).map(Number),
    subject:       document.getElementById('sr-subject').value,
    message:       document.getElementById('sr-message').value,
    reportHtml:    (function(){
      var clone = document.documentElement.cloneNode(true);
      // remove the send-email modal entirely
      var bd = clone.querySelector('#sr-backdrop'); if (bd) bd.parentNode.removeChild(bd);
      // remove only the Send Report button from the print bar (keep Save as PDF)
      var sb = clone.querySelector('.send-btn'); if (sb) sb.parentNode.removeChild(sb);
      return clone.outerHTML;
    })()
  };

  fetch(SR_SEND_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload)
  })
  .then(function(r) { return r.ok ? r.json() : r.json().then(function(e){ throw new Error(e.error || 'Send failed'); }); })
  .then(function(j) {
    btn.innerHTML = '<i class="ph ph-check"></i>\u00a0 Sent to ' + j.sent + ' recipient' + (j.sent === 1 ? '' : 's') + '!';
    btn.style.background = '#16a34a';
    setTimeout(function(){
      srClose();
      btn.innerHTML = '<i class="ph ph-paper-plane-tilt"></i>\u00a0 Send Report';
      btn.style.background = '';
      btn.disabled = false;
    }, 2000);
  })
  .catch(function(e) {
    btn.innerHTML = '<i class="ph ph-warning"></i>\u00a0 Error: ' + e.message;
    btn.style.background = '#dc2626';
    setTimeout(function(){
      btn.innerHTML = '<i class="ph ph-paper-plane-tilt"></i>\u00a0 Send Report';
      btn.style.background = '';
      btn.disabled = false;
    }, 3000);
  });
}
// ── HTML escape ──────────────────────────────────────────────
function srEsc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
<\/script>
</head>
<body>

<div class="print-bar">
  <span class="print-bar-title">${esc(printTitle)} &mdash; ${printDate}${aiMode ? ' <span class="ai-badge">AI Annotated</span>' : ''}</span>
  <div style="display:flex;align-items:center;gap:8px">
    <button class="send-btn" onclick="srOpen()"><i class="ph ph-paper-plane-tilt"></i>&nbsp; Send Report</button>
    <button class="print-btn" onclick="window.print()"><i class="ph ph-printer"></i>&nbsp; Save as PDF</button>
  </div>
</div>

<!-- ── Cover page ─────────────────────────────────────────────────────── -->
<div class="page">
  <div class="cover">
    <div class="brand-row">
      <div class="logo-mark">${logoHtml || esc(printTitle)}</div>
      <div class="cover-chip">WHS Monitor Report</div>
    </div>
    <div class="cover-eyebrow">${esc(_md.StoreName || 'Workplace Health &amp; Safety')}</div>
    <h1 class="cover-title">${esc(printTitle)}</h1>
    <p class="cover-sub">${esc(CONFIG.reportSubtitle) || `An executive-ready snapshot of your dashboard data${aiMode ? ', with AI-generated insights and analysis' : ''}.`}</p>
  </div>
  <div class="cover-meta-strip">
    <div class="cover-meta-item">
      <div class="cover-meta-val accent">${countItems.length + cardItems.length + tableItems.length}</div>
      <div class="cover-meta-lbl">Total Widgets</div>
    </div>
    <div class="cover-meta-item">
      <div class="cover-meta-val">${tableItems.length}</div>
      <div class="cover-meta-lbl">Data Tables</div>
    </div>
    <div class="cover-meta-item">
      <div class="cover-meta-val date">${printDate}</div>
      <div class="cover-meta-lbl">Report Date</div>
    </div>
  </div>
  <div class="page-footer">
    <span style="display:inline-flex;align-items:center;gap:4px;white-space:nowrap;font-size:8px;color:#94a3b8;">Powered by <img src="https://whsmonitor.com.au/wp-content/themes/whs-monitor/assets/images/WHSLogo_Blue.png" alt="WHS Monitor" style="height:12px;width:auto;opacity:0.6;vertical-align:middle;position:relative;top:2px;"></span>
    <span>Cover</span>
  </div>
</div>

${keyFindings.length ? `<div class="page">
  <div class="kf-hero">
    <div class="kf-hero-eyebrow">AI-Generated Report Insights</div>
    <div class="kf-hero-row">
      <div class="kf-hero-title">Key Findings<span>${esc(printTitle)}</span></div>
      <div class="kf-hero-badge">${keyFindings.length} observation${keyFindings.length !== 1 ? 's' : ''}</div>
    </div>
  </div>
  <div class="kf-subhead">
    <span class="kf-subhead-left">Critical observations across all dashboard widgets</span>
    <span class="kf-subhead-right">${printDate}</span>
  </div>
  <div class="kf-grid">
    ${keyFindings.map((f, idx) => {
      const isFull = idx === keyFindings.length - 1 && keyFindings.length % 2 !== 0;
      const num    = String(idx + 1).padStart(2, '0');
      return `<div class="kf-card${isFull ? ' full' : ''}">
      <div class="kf-card-body">
        <div class="kf-num">${num}</div>
        <div class="kf-text"><p>${esc(f)}</p></div>
      </div>
    </div>`;
    }).join('')}
  </div>
  ${recommendations.length ? `<div class="kf-rec-subhead">
    <span class="kf-rec-subhead-left">&#x1F4A1; Recommended Actions</span>
    <span class="kf-rec-subhead-right">${recommendations.length} recommendation${recommendations.length !== 1 ? 's' : ''}</span>
  </div>
  <div class="kf-grid" style="padding-top:12px">
    ${recommendations.map((r, idx) => {
      const isFull = idx === recommendations.length - 1 && recommendations.length % 2 !== 0;
      const num    = String(idx + 1).padStart(2, '0');
      return `<div class="kf-card rec${isFull ? ' full' : ''}">
      <div class="kf-card-body">
        <div class="kf-num">${num}</div>
        <div class="kf-text"><p>${esc(r)}</p></div>
      </div>
    </div>`;
    }).join('')}
  </div>` : ''}
  <div class="page-footer">
    <span style="display:inline-flex;align-items:center;gap:4px;white-space:nowrap;font-size:8px;color:#94a3b8;">Powered by <img src="https://whsmonitor.com.au/wp-content/themes/whs-monitor/assets/images/WHSLogo_Blue.png" alt="WHS Monitor" style="height:12px;width:auto;opacity:0.6;vertical-align:middle;position:relative;top:2px;"></span>
    <span>Key Findings</span>
  </div>
</div>` : ''}

<!-- ── Dashboard charts page ─────────────────────────────────────────── -->
<div class="page">
  <main class="content">
    <header class="section-header">
      <div>
        <div class="section-kicker">Dashboard Report</div>
        <h2 class="section-title">${esc(printTitle)}</h2>
      </div>
      <span class="section-date">${printDate}</span>
    </header>
    ${countItems.length ? `<div class="kpi-strip" style="grid-template-columns:repeat(${Math.min(countItems.length, 4)},1fr)">${kpiStripHtml}</div>` : ''}
    <div class="cards-grid">
      ${cardsHtml}
    </div>
  </main>
  <div class="page-footer">
    <span style="display:inline-flex;align-items:center;gap:4px;white-space:nowrap;font-size:8px;color:#94a3b8;">Powered by <img src="https://whsmonitor.com.au/wp-content/themes/whs-monitor/assets/images/WHSLogo_Blue.png" alt="WHS Monitor" style="height:12px;width:auto;opacity:0.6;vertical-align:middle;position:relative;top:2px;"></span>
    <span>1</span>
  </div>
</div>

${tablePagesHtml}

${keyFindings.length ? `<!-- ── Actions & Sign-Off page (last page) ───────────────────────────── -->
<div class="page">
  <div class="kf-hero" style="padding:20px 32px 18px">
    <div class="kf-hero-eyebrow">${esc(printTitle)}</div>
    <div class="kf-hero-row">
      <div class="kf-hero-title" style="font-size:20px">Actions &amp; Sign-Off<span>Review, accountability &amp; authorisation</span></div>
      <div class="kf-hero-badge">Confidential</div>
    </div>
  </div>
  <div class="kf-actions">
    <div class="kf-section-header">Actions Required</div>
    <table class="kf-actions-table">
      <thead><tr>
        <th style="width:40%">Action Item</th>
        <th style="width:25%">Responsible Officer</th>
        <th style="width:18%">Due Date</th>
        <th style="width:17%">Status</th>
      </tr></thead>
      <tbody>
        ${'<tr><td></td><td></td><td></td><td></td></tr>'.repeat(8)}
      </tbody>
    </table>
  </div>
  <div class="kf-signoff">
    <div class="kf-section-header">Sign-Off</div>
    <div class="kf-signoff-grid">
      <div class="kf-signoff-block">
        <div class="kf-signoff-block-header">Prepared By</div>
        <div class="kf-signoff-fields">
          <div class="kf-signoff-field">
            <span class="kf-signoff-field-label">Full Name</span>
            <div class="kf-signoff-field-value">${esc(preparedByName)}</div>
          </div>
          <div class="kf-signoff-field">
            <span class="kf-signoff-field-label">Title / Role</span>
            <div class="kf-signoff-field-line"></div>
          </div>
          <div class="kf-signoff-field">
            <span class="kf-signoff-field-label">Signature</span>
            <div class="kf-signoff-field-line sig"></div>
          </div>
          <div class="kf-signoff-field">
            <span class="kf-signoff-field-label">Date</span>
            <div class="kf-signoff-field-value">${printDate}</div>
          </div>
        </div>
      </div>
      <div class="kf-signoff-block">
        <div class="kf-signoff-block-header">Reviewed &amp; Approved By</div>
        <div class="kf-signoff-fields">
          <div class="kf-signoff-field">
            <span class="kf-signoff-field-label">Full Name</span>
            <div class="kf-signoff-field-line"></div>
          </div>
          <div class="kf-signoff-field">
            <span class="kf-signoff-field-label">Title / Role</span>
            <div class="kf-signoff-field-line"></div>
          </div>
          <div class="kf-signoff-field">
            <span class="kf-signoff-field-label">Signature</span>
            <div class="kf-signoff-field-line sig"></div>
          </div>
          <div class="kf-signoff-field">
            <span class="kf-signoff-field-label">Date</span>
            <div class="kf-signoff-field-line"></div>
          </div>
        </div>
      </div>
    </div>
  </div>
  <div class="page-footer">
    <span style="display:inline-flex;align-items:center;gap:4px;white-space:nowrap;font-size:8px;color:#94a3b8;">Powered by <img src="https://whsmonitor.com.au/wp-content/themes/whs-monitor/assets/images/WHSLogo_Blue.png" alt="WHS Monitor" style="height:12px;width:auto;opacity:0.6;vertical-align:middle;position:relative;top:2px;"></span>
    <span>Actions &amp; Sign-Off</span>
  </div>
</div>` : ''}}

<!-- ══════════════════════════════════════════════════════════════ -->
<!--  SEND REPORT MODAL                                            -->
<!-- ══════════════════════════════════════════════════════════════ -->
<div id="sr-backdrop" class="sr-backdrop" role="dialog" aria-modal="true" aria-labelledby="sr-title">
  <div class="sr-modal">
    <div class="sr-hdr">
      <div class="sr-hdr-left">
        <div class="sr-eyebrow">WHS Monitor</div>
        <div class="sr-title" id="sr-title"><i class="ph ph-paper-plane-tilt"></i>&nbsp; Send Report</div>
      </div>
      <div class="sr-close" onclick="srClose()" title="Close"><i class="ph ph-x"></i></div>
    </div>
    <div class="sr-pill">
      <div class="sr-pill-icon">&#128196;</div>
      <div class="sr-pill-info">
        <div class="sr-pill-name">${esc(printTitle)} &mdash; ${printDate}</div>
        <div class="sr-pill-meta">${aiMode ? 'AI-Annotated Report' : 'Dashboard Report'} &bull; Generated just now</div>
      </div>
      <div style="font-size:9px;color:#2563eb;background:#dbeafe;border-radius:10px;padding:2px 8px;font-weight:600;flex-shrink:0">HTML</div>
    </div>
    <div class="sr-body">
      <div>
        <div class="sr-sec-lbl">Send To</div>
        <div class="sr-tabs">
          <div class="sr-tab active" data-tab="users" onclick="srTab('users',this)">Users <span class="sr-tab-cnt" id="sr-cnt-users">0</span></div>
          <div class="sr-tab" data-tab="division" onclick="srTab('division',this)">Division <span class="sr-tab-cnt" id="sr-cnt-division">0</span></div>
          <div class="sr-tab" data-tab="department" onclick="srTab('department',this)">Department <span class="sr-tab-cnt" id="sr-cnt-department">0</span></div>
          <div class="sr-tab" data-tab="role" onclick="srTab('role',this)">Employee Role <span class="sr-tab-cnt" id="sr-cnt-role">0</span></div>
        </div>
        <!-- Users panel — search-as-you-type -->
        <div id="sr-panel-users" class="sr-panel visible">
          <div class="sr-ms-wrap">
            <div class="sr-search-row">
              <i class="ph ph-magnifying-glass" style="color:#6b7280;font-size:14px;flex-shrink:0"></i>
              <input type="text" id="sr-user-search" placeholder="Type a name to search users&#8230;" oninput="srSearchUsers(this.value)" autocomplete="off"/>
            </div>
            <div class="sr-user-search-hint">Start typing to search members by name</div>
            <div class="sr-list" id="sr-users-list"><div class="sr-empty">No results — type to search</div></div>
          </div>
        </div>
        <!-- Division panel -->
        <div id="sr-panel-division" class="sr-panel">
          <div class="sr-ms-wrap">
            <div class="sr-search-row">
              <i class="ph ph-magnifying-glass" style="color:#6b7280;font-size:14px;flex-shrink:0"></i>
              <input type="text" placeholder="Search divisions&#8230;" oninput="srFilter('sr-division-list',this.value)" autocomplete="off"/>
            </div>
            <div class="sr-sel-all-row">
              <span class="sr-sel-all-btn" onclick="srSelectAll('sr-division-list','division')">Select all</span>
              <span class="sr-sel-count" id="sr-selcount-division">Loading&#8230;</span>
            </div>
            <div class="sr-list" id="sr-division-list"><div class="sr-loading">Loading&#8230;</div></div>
          </div>
        </div>
        <!-- Department panel -->
        <div id="sr-panel-department" class="sr-panel">
          <div class="sr-ms-wrap">
            <div class="sr-search-row">
              <i class="ph ph-magnifying-glass" style="color:#6b7280;font-size:14px;flex-shrink:0"></i>
              <input type="text" placeholder="Search departments&#8230;" oninput="srFilter('sr-department-list',this.value)" autocomplete="off"/>
            </div>
            <div class="sr-sel-all-row">
              <span class="sr-sel-all-btn" onclick="srSelectAll('sr-department-list','department')">Select all</span>
              <span class="sr-sel-count" id="sr-selcount-department">Loading&#8230;</span>
            </div>
            <div class="sr-list" id="sr-department-list"><div class="sr-loading">Loading&#8230;</div></div>
          </div>
        </div>
        <!-- Employee Role panel -->
        <div id="sr-panel-role" class="sr-panel">
          <div class="sr-ms-wrap">
            <div class="sr-search-row">
              <i class="ph ph-magnifying-glass" style="color:#6b7280;font-size:14px;flex-shrink:0"></i>
              <input type="text" id="sr-role-search" placeholder="Type a name to search by role&#8230;" oninput="srSearchUsers(this.value,'role')" autocomplete="off"/>
            </div>
            <div class="sr-user-search-hint">Search members — select to add by employee role</div>
            <div class="sr-list" id="sr-role-list"><div class="sr-empty">No results — type to search</div></div>
          </div>
        </div>
        <!-- Chips -->
        <div id="sr-chips-wrap" class="sr-chips-wrap"></div>
        <div class="sr-summary-row">
          <div class="sr-summary-dot"></div>
          <span class="sr-summary-text">Total unique recipients</span>
          <span class="sr-summary-count" id="sr-total">0 selected</span>
        </div>
      </div>
      <div class="sr-field">
        <label>Email Subject</label>
        <input type="text" id="sr-subject" value="${esc(printTitle)} \u2014 ${printDate}"/>
      </div>
      <div class="sr-field">
        <label>Message (optional)</label>
        <textarea id="sr-message" placeholder="Add a personal message to accompany the report&#8230;"></textarea>
      </div>
    </div>
    <div class="sr-ftr">
      <div class="sr-ftr-note"><i class="ph ph-lock-simple"></i> Report will be sent as an HTML attachment</div>
      <div class="sr-ftr-btns">
        <button class="sr-btn-ghost" onclick="srClose()">Cancel</button>
        <button class="sr-btn-primary" id="sr-send-btn" disabled onclick="srHandleSend()"><i class="ph ph-paper-plane-tilt"></i>&nbsp; Send Report</button>
      </div>
    </div>
  </div>
</div>


</body>
</html>`;

            // ── Open report in a centred popup window ─────────────────────────────────
            setProg('Opening report…', 100);
            const blob = new Blob([html], { type: 'text/html' });
            const url = URL.createObjectURL(blob);
            const pw = Math.min(900, screen.availWidth - 40);
            const ph = Math.min(960, screen.availHeight - 40);
            const pl = Math.round((screen.availWidth - pw) / 2) + (screen.availLeft || 0);
            const pt = Math.round((screen.availHeight - ph) / 2) + (screen.availTop || 0);
            const win = window.open(url, 'legacyReport',
                `width=${pw},height=${ph},left=${pl},top=${pt},resizable=yes,scrollbars=yes,toolbar=no,menubar=no,location=no,status=no`
            );
            if (!win) {
                alert('Popup blocked — please allow popups for this page and try again.');
            }
            // Revoke the blob URL after 60 s — browser will have parsed it by then
            setTimeout(() => URL.revokeObjectURL(url), 60_000);

        } catch (err) {
            console.error('[LegacyReport]', err);
            alert('Report generation failed: ' + err.message);
        } finally {
            overlay.remove();
            const btnGroup2 = document.getElementById('legacyReportBtnGroup');
            if (btnGroup2) btnGroup2.querySelectorAll('button').forEach(b => { b.disabled = false; });
        }
    }

    // ── Inject floating trigger buttons ──────────────────────────────────────────
    function injectButton() {
        if (document.getElementById('legacyReportBtnGroup')) return; // already present

        const wrap = document.createElement('div');
        wrap.id = 'legacyReportBtnGroup';
        wrap.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:8000;display:flex;flex-direction:column;gap:8px;align-items:flex-end';

        // Standard report button
        const btn = document.createElement('button');
        btn.id = CONFIG.buttonId;
        btn.innerHTML = '&#128247;&nbsp; Generate Report';
        btn.style.cssText = [
            'background:#3B98F1;color:white;border:none;border-radius:8px;',
            'padding:10px 20px;font-size:13px;font-weight:600;cursor:pointer;',
            'box-shadow:0 4px 14px rgba(59,152,241,.5);',
            'font-family:Segoe UI,Arial,sans-serif;transition:opacity .2s',
        ].join('');
        btn.onmouseenter = () => { btn.style.opacity = '.85'; };
        btn.onmouseleave = () => { btn.style.opacity = '1'; };
        btn.onclick = () => generateReport(false);

        // AI-annotated report button
        const aiBtn = document.createElement('button');
        aiBtn.id = 'legacyAIReportBtn';
        aiBtn.innerHTML = '&#10024;&nbsp; AI Report';
        aiBtn.style.cssText = [
            'background:#7c3aed;color:white;border:none;border-radius:8px;',
            'padding:10px 20px;font-size:13px;font-weight:600;cursor:pointer;',
            'box-shadow:0 4px 14px rgba(124,58,237,.45);',
            'font-family:Segoe UI,Arial,sans-serif;transition:opacity .2s',
        ].join('');
        aiBtn.onmouseenter = () => { aiBtn.style.opacity = '.85'; };
        aiBtn.onmouseleave = () => { aiBtn.style.opacity = '1'; };
        aiBtn.onclick = () => generateReport(true);

        wrap.appendChild(aiBtn);
        wrap.appendChild(btn);
        document.body.appendChild(wrap);
    }

    // Expose globally so any existing button can call it
    window.legacyGenerateReport = generateReport;

    // Inject the floating button once the DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', injectButton);
    } else {
        injectButton();
    }

})();
