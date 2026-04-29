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
                            const display = dt.cell(rowIdx, ci).render('display');
                            const tmp = document.createElement('div');
                            tmp.innerHTML = String(display ?? '');
                            return tmp.textContent.trim();
                        } catch (e) { return ''; }
                    })
                );
            } catch (dtErr) {
                console.warn('[LegacyReport] DataTables API failed, falling back to DOM rows', dtErr);
            }
        }

        // Fallback: only visible (current-page) DOM rows
        if (!rows.length) {
            rows = [...tableEl.querySelectorAll('tbody tr')].map(tr =>
                [...tr.querySelectorAll('td')].map(td => td.textContent.trim())
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
                const cc = ACCENT_COLORS[idx % ACCENT_COLORS.length];
                const kpiNote = aiMode ? getInsight(descriptions, item.title) : null;
                kpiStripHtml += `<div class="kpi-mini${cc ? ' ' + cc : ''}">
          <div class="kpi-mini-val">${val}</div>
          <div class="kpi-mini-lbl">${esc(item.title)}</div>
          ${kpiNote?.description ? `<div style="display: none !important;" class="d-none kpi-mini-note">${esc(kpiNote.description)}</div>` : ''}
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
            <div class="wc${cc ? ' ' + cc : ''}"${spanFull}>
              <div class="wc-head"><span class="wc-head-title">${esc(item.title) || 'Chart'}</span></div>
              <div class="wc-body-right">
                <div class="wc-img">${img ? imgTag : noCapture}</div>
                <div class="wc-aside"><p>${esc(insight.description)}</p></div>
              </div>
            </div>`;
                } else if (layout === 'left') {
                    cardsHtml += `
            <div class="wc${cc ? ' ' + cc : ''}"${spanFull}>
              <div class="wc-head"><span class="wc-head-title">${esc(item.title) || 'Chart'}</span></div>
              <div class="wc-body-left">
                <div class="wc-aside"><p>${esc(insight.description)}</p></div>
                <div class="wc-img">${img ? imgTag : noCapture}</div>
              </div>
            </div>`;
                } else if (layout === 'bottom') {
                    cardsHtml += `
            <div class="wc${cc ? ' ' + cc : ''}"${spanFull}>
              <div class="wc-head"><span class="wc-head-title">${esc(item.title) || 'Chart'}</span></div>
              <div class="wc-body-bottom">
                <div class="wc-img">${img ? imgTag : noCapture}</div>
                ${insight?.description ? `<div class="wc-note">${esc(insight.description)}</div>` : ''}
              </div>
            </div>`;
                } else {
                    // full — no text
                    cardsHtml += `
            <div class="wc${cc ? ' ' + cc : ''}"${spanFull}>
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
                        `<tr>${row.map((cell, ci) => {
                            const val = fmtCell(cell);
                            const bc = ci < 3 ? badgeClass(cell) : '';   // only badge first few cols
                            return `<td>${bc ? `<span class="badge ${bc}">${val}</span>` : val}</td>`;
                        }).join('')}</tr>`
                    ).join('');
                    bodyHtml = `<div class="data-table-wrap"><table class="data-table">
            <thead><tr>${headerCells}</tr></thead>
            <tbody>${bodyRows}</tbody>
          </table></div>`;
                }

                const tableInsight = aiMode ? getInsight(descriptions, tItem.title) : null;
                const tableNote = tableInsight && tableInsight.description
                    ? `<div class="table-insight"><div class="table-insight-text">${esc(tableInsight.description)}</div></div>`
                    : '';

                tablePagesHtml += `<div class="page">
  <div class="table-banner">
    <span class="tit">&#128203; ${esc(td.title)}</span>
    ${td.rows.length ? `<span class="cnt">${td.rows.length} records &middot; ${printDate}</span>` : ''}
  </div>
  ${tableNote}
  ${bodyHtml}
  <div class="page-footer">
    <span class="doc-title">${esc(printTitle)}</span>
    <span class="pg">Table</span>
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
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{background:#e8eaed;font-family:'Segoe UI',Arial,sans-serif;padding:32px 24px;display:flex;flex-direction:column;align-items:center;gap:40px}
:root{
  --blue:${brandColor};--blue-lt:${brandLt};--blue-dk:${brandDk};
  --teal:#0d9488;--amber:#d97706;--indigo:#4f46e5;--rose:#e11d48;
  --dark:#111827;--mid:#6b7280;--light:#f3f4f6;--border:#e5e7eb
}

/* ── A4 page shell ────────────────────────────────────── */
.page{
  width:595px;min-height:842px;background:#fff;
  box-shadow:0 2px 12px rgba(0,0,0,.18);
  border-radius:3px;position:relative;overflow:hidden;
  display:flex;flex-direction:column
}

/* ── Cover ─────────────────────────────────────────────── */
.cover-top{
  background:var(--blue);height:354px;
  display:flex;flex-direction:column;align-items:center;justify-content:flex-end;
  padding-bottom:28px;position:relative;overflow:hidden
}
.cover-top::before{content:'';position:absolute;width:320px;height:320px;border-radius:50%;
  border:50px solid rgba(255,255,255,.07);top:-80px;right:-80px}
.cover-top::after{content:'';position:absolute;width:180px;height:180px;border-radius:50%;
  border:30px solid rgba(255,255,255,.06);bottom:40px;left:-50px}
.cover-logo{background:white;border-radius:10px;padding:10px 20px;margin-bottom:24px;
  position:relative;z-index:1;font-size:15px;font-weight:700;color:var(--blue);
  letter-spacing:.02em;display:flex;align-items:center;gap:8px}
.cover-divider{width:50px;height:3px;background:rgba(255,255,255,.4);border-radius:2px;
  margin-bottom:16px;position:relative;z-index:1}
.cover-title{font-size:22px;font-weight:800;color:#fff;text-align:center;
  position:relative;z-index:1;padding:0 32px;line-height:1.25}
.cover-subtitle{font-size:11px;color:rgba(255,255,255,.65);text-transform:uppercase;
  letter-spacing:.12em;margin-top:8px;position:relative;z-index:1}
.cover-bottom{background:var(--blue-lt);flex:1;display:flex;flex-direction:column;
  align-items:center;justify-content:center;gap:12px;padding:32px}
.cover-meta-row{display:flex;gap:32px}
.cover-meta-item{text-align:center}
.cover-meta-item .val{font-size:22px;font-weight:700;color:var(--blue)}
.cover-meta-item .lbl{font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:var(--mid);margin-top:2px}
.cover-date{font-size:10px;color:var(--mid);margin-top:8px}
.cover-dots{display:flex;gap:8px;margin-top:6px}
.cover-dots span{width:6px;height:6px;border-radius:50%;background:var(--blue)}
.cover-dots span:not(:first-child){opacity:.35}
.cover-summary{font-size:9px;color:#374151;text-align:center;max-width:440px;line-height:1.75;background:rgba(255,255,255,.7);border-radius:6px;padding:10px 16px;margin-top:4px}

/* ── Cards grid ─────────────────────────────────────────── */
.cards-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;padding:14px 28px 20px}
.wc{border-radius:6px;overflow:hidden;box-shadow:none;display:flex;flex-direction:column;background:#fff}
.wc-head{display:flex;flex-direction:column;padding:14px 16px 10px;border-bottom:none;flex-shrink:0;background:#fff;position:relative;padding-left:0px !important}
.wc-head-title{font-size:14px;color:#000;letter-spacing:.08em;text-transform:uppercase}
.wc-body-bottom{display:flex;flex-direction:column;flex:1}
.wc-body-bottom .wc-img{overflow:hidden}
.wc-body-bottom .wc-img img{display:block;width:100%}
.wc-note{padding:10px 14px;background:#fafafa;border-top:1px solid var(--border);font-size:9px;color:#374151;line-height:1.8}
.wc-body-right{display:flex;flex-direction:row;flex:1}
.wc-body-right .wc-img{flex:1.6;overflow:hidden}
.wc-body-right .wc-img img{display:block;width:100%;height:100%;object-fit:cover}
.wc-body-left{display:flex;flex-direction:row;flex:1}
.wc-body-left .wc-img{flex:1.6;overflow:hidden}
.wc-body-left .wc-img img{display:block;width:100%;height:100%;object-fit:cover}
.wc-aside{flex:1;padding:14px 12px;display:flex;flex-direction:column;justify-content:center;background:#fafafa}
.wc-body-left .wc-aside{background:#fafafa}
.wc-aside p{font-size:9px;color:#374151;line-height:1.8;margin:0}

/* ── AI table insight callout ───────────────────────────── */
.table-insight{display:flex;align-items:flex-start;margin:14px 28px 0;padding:12px 14px;border:1px solid var(--border);border-left:3px solid var(--blue);border-radius:4px;background:#fafafa}
.table-insight-text{font-size:9px;color:#374151;line-height:1.75}

/* ── Section banner (replaces quicklinks heading) ───────── */
.section-banner{
  background:var(--blue-dk);padding:12px 16px;
  margin-top:6px;border-radius:4px
}
.section-banner-text{font-size:10px;font-weight:700;color:#fff;
  text-transform:uppercase;letter-spacing:.07em}

/* ── KPI mini strip ─────────────────────────────────────── */
.kpi-summary-row{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;padding:14px 28px 8px;flex-shrink:0}
.kpi-mini{background:var(--light);border-radius:6px;padding:10px 12px;border-left:3px solid var(--blue)}
.kpi-mini.teal{border-color:var(--teal)}.kpi-mini.indigo{border-color:#4f46e5}.kpi-mini.amber{border-color:#d97706}
.kpi-mini-val{font-size:18px;font-weight:800;color:var(--dark)}
.kpi-mini-lbl{font-size:8px;color:var(--mid);margin-top:2px;text-transform:uppercase;letter-spacing:.06em}
.kpi-mini-note{font-size:7.5px;color:var(--mid);line-height:1.5;margin-top:4px}

/* ── Key Findings page ──────────────────────────────────── */
.kf-hero{background:var(--blue);padding:28px 32px 24px;position:relative;overflow:hidden;flex-shrink:0}
.kf-hero::before{content:'';position:absolute;width:260px;height:260px;border-radius:50%;border:44px solid rgba(255,255,255,.07);top:-80px;right:-60px}
.kf-hero::after{content:'';position:absolute;width:140px;height:140px;border-radius:50%;border:24px solid rgba(255,255,255,.06);bottom:-30px;left:40px}
.kf-hero-eyebrow{font-size:8px;font-weight:700;color:rgba(255,255,255,.55);text-transform:uppercase;letter-spacing:.14em;margin-bottom:8px;position:relative;z-index:1}
.kf-hero-row{display:flex;align-items:flex-end;justify-content:space-between;position:relative;z-index:1}
.kf-hero-title{font-size:24px;font-weight:800;color:#fff;line-height:1.1;letter-spacing:-.01em}
.kf-hero-title span{display:block;font-size:10px;font-weight:400;color:rgba(255,255,255,.6);letter-spacing:.04em;margin-top:4px}
.kf-hero-badge{background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.25);border-radius:20px;padding:5px 14px;font-size:8.5px;color:rgba(255,255,255,.85);font-weight:600;letter-spacing:.04em;white-space:nowrap}
.kf-subhead{background:var(--blue-lt);border-bottom:1px solid #dbeafe;padding:9px 32px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0}
.kf-subhead-left{font-size:8.5px;color:var(--blue-dk);font-weight:600}
.kf-subhead-right{font-size:8px;color:var(--mid)}
.kf-grid{padding:14px 28px 0;display:grid;grid-template-columns:1fr 1fr;gap:10px;flex-shrink:0;align-content:start}
.kf-card{background:#fff;border:1px solid var(--border);border-radius:8px;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 1px 4px rgba(0,0,0,.05)}
.kf-card.full{grid-column:1 / -1}
.kf-card-accent{height:3px;background:var(--blue);flex-shrink:0}
.kf-card-accent.c-teal{background:var(--teal)}.kf-card-accent.c-indigo{background:var(--indigo)}.kf-card-accent.c-amber{background:var(--amber)}.kf-card-accent.c-rose{background:var(--rose)}
.kf-card-body{padding:10px 12px 12px;display:flex;gap:12px;align-items:flex-start;flex:1}
.kf-num{flex-shrink:0;font-size:24px;font-weight:900;line-height:1;color:var(--blue);opacity:.18;letter-spacing:-.02em;min-width:28px;margin-top:-2px}
.kf-num.c-teal{color:var(--teal)}.kf-num.c-indigo{color:var(--indigo)}.kf-num.c-amber{color:var(--amber)}.kf-num.c-rose{color:var(--rose)}
.kf-text{flex:1}
.kf-text p{font-size:9.5px;color:#374151;line-height:1.8;margin:0}
.kf-attribution{margin:0 28px 20px;padding:8px 14px;background:#f8fafc;border:1px solid var(--border);border-radius:6px;display:flex;align-items:center;gap:8px;flex-shrink:0}
.kf-attr-dot{width:6px;height:6px;border-radius:50%;background:var(--blue);flex-shrink:0}
.kf-attribution span{font-size:7.5px;color:var(--mid);letter-spacing:.02em}
.kf-attribution strong{color:var(--blue);font-weight:600}
/* ── Recommendations subhead (amber tint) ──────────────── */
.kf-rec-subhead{background:#fffbeb;border-top:1px solid #fde68a;border-bottom:1px solid #fde68a;padding:9px 32px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;margin-top:14px}
.kf-rec-subhead-left{font-size:8.5px;color:#92400e;font-weight:600}
.kf-rec-subhead-right{font-size:8px;color:var(--mid)}
/* ── Actions Required & Sign-Off page ───────────────────── */
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

/* ── Table page ─────────────────────────────────────────── */
.table-banner{background:var(--blue);padding:14px 28px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0}
.table-banner .tit{font-size:13px;font-weight:700;color:white;display:flex;align-items:center;gap:8px}
.table-banner .cnt{font-size:8.5px;color:rgba(255,255,255,.65);background:rgba(255,255,255,.15);padding:3px 10px;border-radius:8px}
.data-table-wrap{padding:16px 28px 20px;overflow:hidden}
.data-table{width:100%;border-collapse:collapse;font-size:8px}
.data-table thead th{background:var(--blue);color:white;padding:8px 12px;text-align:left;font-weight:600;letter-spacing:.03em}
.data-table tbody tr:nth-child(even) td{background:#f9fafb}
.data-table tbody td{padding:6px 12px;color:var(--dark);border-bottom:1px solid var(--border)}
.badge{display:inline-block;padding:1px 6px;border-radius:8px;font-size:7px;font-weight:600}
.badge.green{background:#d1fae5;color:#065f46}.badge.red{background:#fee2e2;color:#991b1b}.badge.amber{background:#fef3c7;color:#92400e}
/* ── Page footer ────────────────────────────────────────── */
.page-footer{
  margin-top:auto;padding:8px 28px;border-top:1px solid var(--border);
  display:flex;align-items:center;justify-content:space-between;flex-shrink:0
}
.page-footer .doc-title{font-size:7px;color:#9ca3af}
.page-footer .pg{font-size:7.5px;color:var(--mid)}

/* ── Sticky print bar (screen only) ─────────────────────── */
.print-bar{
  background:#1e293b;padding:10px 24px;
  display:flex;align-items:center;justify-content:space-between;
  width:100%;position:sticky;top:0;z-index:99
}
.print-bar-title{color:rgba(255,255,255,.65);font-size:12px}
.print-btn{
  background:#2563eb;color:white;border:none;border-radius:6px;
  padding:8px 20px;font-size:13px;font-weight:600;cursor:pointer;
  letter-spacing:.02em;font-family:inherit
}
.print-btn:hover{background:#1d4ed8}

/* ── Print media ─────────────────────────────────────────── */
@page{size:A4 portrait;margin:0}
@media print{
  body{background:white;padding:0;gap:0}
  .print-bar{display:none}
  .page{box-shadow:none;border-radius:0;page-break-after:always;break-after:page;width:100%;min-height:100vh}
  .page:last-child{page-break-after:avoid;break-after:avoid}
  .cover-top{height:42vh;print-color-adjust:exact;-webkit-print-color-adjust:exact}
  .cover-bottom{min-height:0;print-color-adjust:exact;-webkit-print-color-adjust:exact}
  .section-banner{print-color-adjust:exact;-webkit-print-color-adjust:exact}
  .kpi-mini{print-color-adjust:exact;-webkit-print-color-adjust:exact}
  .kpi-summary-row{page-break-inside:avoid;break-inside:avoid}
  .wc{page-break-inside:avoid;break-inside:avoid}
  .data-table thead th{print-color-adjust:exact;-webkit-print-color-adjust:exact}
  .table-banner{print-color-adjust:exact;-webkit-print-color-adjust:exact}
  .data-table tbody tr{page-break-inside:avoid;break-inside:avoid}
  .table-insight{page-break-inside:avoid;break-inside:avoid}
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
</head>
<body>

<div class="print-bar">
  <span class="print-bar-title">${esc(printTitle)} &mdash; ${printDate}${aiMode ? ' <span style="background:#7c3aed;color:white;padding:2px 8px;border-radius:10px;font-size:10px;margin-left:8px">AI Annotated</span>' : ''}</span>
  <button class="print-btn" onclick="window.print()">&#x1F5A8;&nbsp; Print / Save as PDF</button>
</div>

<!-- ── Cover page ─────────────────────────────────────────────────────── -->
<div class="page">
  <div class="cover-top">
    <div class="cover-logo">${logoHtml}</div>
    <div class="cover-divider"></div>
    <div class="cover-title">${esc(printTitle)}</div>
    <div class="cover-subtitle">${esc(CONFIG.reportSubtitle)}</div>
  </div>
  <div class="cover-bottom">
    <div class="cover-meta-row">
      <div class="cover-meta-item">
        <div class="val" style="font-size:14px;color:var(--indigo)">${printDate}</div>
        <div class="lbl">Report Date</div>
      </div>
    </div>
    ${executiveSummary ? `<div class="cover-summary">${esc(executiveSummary)}</div>` : ''}
    <div class="cover-dots"><span></span><span></span><span></span></div>
  </div>
  <div class="page-footer">
    <span class="doc-title">${esc(printTitle)}</span>
    <span class="pg">Cover</span>
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
      const KF_ACCENTS = ['', 'c-teal', 'c-rose', 'c-indigo', 'c-amber'];
      const ac     = KF_ACCENTS[idx % KF_ACCENTS.length];
      const isFull = idx === keyFindings.length - 1 && keyFindings.length % 2 !== 0;
      const num    = String(idx + 1).padStart(2, '0');
      return `<div class="kf-card${isFull ? ' full' : ''}">
      <div class="kf-card-accent${ac ? ' ' + ac : ''}"></div>
      <div class="kf-card-body">
        <div class="kf-num${ac ? ' ' + ac : ''}">${num}</div>
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
      const REC_ACCENTS = ['c-amber', 'c-rose', 'c-teal', 'c-indigo', ''];
      const ac     = REC_ACCENTS[idx % REC_ACCENTS.length];
      const isFull = idx === recommendations.length - 1 && recommendations.length % 2 !== 0;
      const num    = String(idx + 1).padStart(2, '0');
      return `<div class="kf-card${isFull ? ' full' : ''}">
      <div class="kf-card-accent${ac ? ' ' + ac : ''}"></div>
      <div class="kf-card-body">
        <div class="kf-num${ac ? ' ' + ac : ''}">${num}</div>
        <div class="kf-text"><p>${esc(r)}</p></div>
      </div>
    </div>`;
    }).join('')}
  </div>` : ''}
  <div class="page-footer">
    <span class="doc-title">${esc(printTitle)}</span>
    <span class="pg">Key Findings</span>
  </div>
</div>` : ''}

<!-- ── Dashboard charts page ─────────────────────────────────────────── -->
<div class="page">
  <div class="table-banner">
    <span class="tit">${esc(printTitle)}</span>
    <span class="cnt">${printDate}</span>
  </div>
  ${countItems.length ? `<div class="kpi-summary-row" style="grid-template-columns:repeat(${Math.min(countItems.length, 4)},1fr)">${kpiStripHtml}</div>` : ''}
  <div class="cards-grid">
    ${cardsHtml}
  </div>
  <div class="page-footer">
    <span class="doc-title">${esc(printTitle)}</span>
    <span class="pg">1</span>
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
    <div class="kf-section-header">&#x1F4DD; Actions Required</div>
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
    <div class="kf-section-header">&#x270D;&#xFE0F; Sign-Off</div>
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
    <span class="doc-title">${esc(printTitle)}</span>
    <span class="pg">Actions &amp; Sign-Off</span>
  </div>
</div>` : ''}

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
