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
    logoSelector: 'img.navbar-brand, .navbar-brand img, .topbar-logo img, header img.logo, .site-logo img',

    // Report title — falls back to document.title
    reportTitle: null,   // e.g. 'WHS Incident Dashboard'  — null = use document.title

    // Organisation subtitle shown on the cover page
    reportSubtitle: 'Workplace Health & Safety',

    // ID given to the injected floating button (used to prevent double-injection)
    buttonId: 'legacyReportBtn',
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

    // Use DataTables API to get ALL rows (ignores current page)
    if (window.$ && $.fn && $.fn.dataTable && $.fn.dataTable.isDataTable(tableEl)) {
      try {
        const dt     = $(tableEl).DataTable();
        const dtData = dt.rows().data().toArray();
        rows = dtData.map(row => {
          return cols.map((_, i) => {
            const cell = Array.isArray(row) ? row[i] : Object.values(row)[i];
            // Strip any HTML tags the cell value may contain
            const tmp = document.createElement('div');
            tmp.innerHTML = String(cell ?? '');
            return tmp.textContent.trim();
          });
        });
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

  /** Dynamically load html2canvas from CDN if not already present, then resolve */
  function loadHtml2Canvas() {
    if (window.html2canvas) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
      s.onload  = resolve;
      s.onerror = () => reject(new Error('Failed to load html2canvas from CDN'));
      document.head.appendChild(s);
    });
  }

  // ── Core report generator ────────────────────────────────────────────────────
  async function generateReport() {

    // Disable the trigger button while working
    const triggerBtn = document.getElementById(CONFIG.buttonId);
    if (triggerBtn) triggerBtn.disabled = true;

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
      const b = document.getElementById('__lgcy_bar');  if (b) b.style.width = pct + '%';
    };

    try {
      const printDate  = new Date().toLocaleDateString('en-AU', { day: '2-digit', month: 'long', year: 'numeric' });
      const printTitle = CONFIG.reportTitle || document.title || 'WHS Dashboard Report';

      // ── Logo ──────────────────────────────────────────────────────────────────
      const logoEl   = document.querySelector(CONFIG.logoSelector);
      const logoSrc  = logoEl ? logoEl.src : '';
      const logoHtml = logoSrc
        ? `<img src="${logoSrc}" crossorigin="anonymous" style="max-height:24px;width:auto" />`
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
          gsY:      parseInt(el.getAttribute('data-gs-y')     || '0',  10),
          gsX:      parseInt(el.getAttribute('data-gs-x')     || '0',  10),
          gsW:      parseInt(el.getAttribute('data-gs-width') || '12', 10),
          title:    cleanTitle(el.querySelector('.dashboard-title')),
        }))
        // Sort top-to-bottom, then left-to-right (matches visual reading order)
        .sort((a, b) => a.gsY !== b.gsY ? a.gsY - b.gsY : a.gsX - b.gsX);

      // ── Split items: tables get their own pages, everything else → cards grid ──
      const tableItems = items.filter(i => i.gridtype === 'table');
      const cardItems  = items.filter(i => i.gridtype !== 'table');

      // ── Capture each non-table widget ─────────────────────────────────────────
      const ACCENT_COLORS = ['', 'teal', 'indigo', 'amber'];
      let cardsHtml = '';
      let chartIndex = 0;

      for (let i = 0; i < cardItems.length; i++) {
        const item = cardItems[i];
        setProg(`Capturing widget ${i + 1} of ${cardItems.length}…`, 10 + Math.round(((i + 1) / cardItems.length) * 75));

        // ── Section heading (quicklinks) → full-width banner ─────────────────────
        if (item.gridtype === 'quicklinks') {
          cardsHtml += `
            <div class="section-banner" style="grid-column:1/-1">
              <div class="section-banner-text">${esc(item.title)}</div>
            </div>`;
          continue;
        }

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
          const content   = item.el.querySelector('.grid-stack-item-content') || item.el;
          const titleEl   = content.querySelector('.dashboard-title');
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

        const cc       = ACCENT_COLORS[chartIndex % ACCENT_COLORS.length];
        const spanFull = item.gsW >= 10 ? ' style="grid-column:1/-1"' : '';

        if (img) {
          cardsHtml += `
            <div class="wc${cc ? ' ' + cc : ''}"${spanFull}>
              <div class="wc-head">
                <span class="wc-head-title">${esc(item.title) || 'Chart'}</span>
              </div>
              <div class="wc-body-bottom">
                <div class="wc-img"><img src="${img}" style="width:100%;display:block" /></div>
              </div>
            </div>`;
        } else {
          cardsHtml += `
            <div class="wc${cc ? ' ' + cc : ''}"${spanFull}>
              <div class="wc-head">
                <span class="wc-head-title">${esc(item.title) || 'Chart'}</span>
              </div>
              <div class="wc-body-bottom"
                   style="padding:20px;color:#6b7280;font-size:11px;text-align:center;background:#f9fafb">
                Chart could not be captured
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
            return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
        }
        return esc(s);
      };
      const badgeClass = v => {
        const s = String(v).toLowerCase();
        if (/\bopen\b|high|fail|\bdanger\b|critical|reject|not started/.test(s)) return 'red';
        if (/clos|done|complet|pass|resolv|approv/.test(s))                      return 'green';
        if (/review|pending|\bprogress\b|medium|warn/.test(s))                  return 'amber';
        return '';
      };

      let tablePagesHtml = '';
      for (const tItem of tableItems) {
        setProg(`Extracting table: ${tItem.title}…`, 87);
        const td = extractTableData(tItem);
        if (!td) continue;

        let bodyHtml;
        if (!td.rows.length) {
          bodyHtml = `<div style="padding:20px 28px;color:#6b7280;font-size:11px">No data available</div>`;
        } else {
          const headerCells = td.cols.map(c => `<th>${esc(c)}</th>`).join('');
          const bodyRows    = td.rows.map(row =>
            `<tr>${row.map((cell, ci) => {
              const val = fmtCell(cell);
              const bc  = ci < 3 ? badgeClass(cell) : '';   // only badge first few cols
              return `<td>${bc ? `<span class="badge ${bc}">${val}</span>` : val}</td>`;
            }).join('')}</tr>`
          ).join('');
          bodyHtml = `<div class="data-table-wrap"><table class="data-table">
            <thead><tr>${headerCells}</tr></thead>
            <tbody>${bodyRows}</tbody>
          </table></div>`;
        }

        tablePagesHtml += `<div class="page">
  <div class="run-header"><span class="rh-title">${esc(printTitle)}</span><span class="rh-date">${printDate}</span></div>
  <div class="table-banner">
    <span class="tit">&#128203; ${esc(td.title)}</span>
    ${td.rows.length ? `<span class="cnt">${td.rows.length} records &middot; ${printDate}</span>` : ''}
  </div>
  ${bodyHtml}
  <div class="page-footer">
    <span class="doc-title">${esc(printTitle)}</span>
    <span class="pg">Table</span>
  </div>
</div>`;
      }

      const chartCount   = cardItems.filter(i => i.gridtype !== 'quicklinks').length;
      const sectionCount = cardItems.filter(i => i.gridtype === 'quicklinks').length;

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
  --blue:#3B98F1;--blue-lt:#dbeafe;--blue-dk:#1e40af;
  --teal:#0d9488;--amber:#d97706;--indigo:#4f46e5;
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

/* ── Running header (print only) ───────────────────────── */
.run-header{
  display:none;align-items:center;justify-content:space-between;
  padding:6px 28px;background:#f8fafc;border-bottom:1px solid var(--border);flex-shrink:0
}
.run-header .rh-title{font-size:8px;font-weight:700;color:var(--blue);letter-spacing:.06em;text-transform:uppercase}
.run-header .rh-date{font-size:8px;color:var(--mid)}

/* ── Cards grid ─────────────────────────────────────────── */
.cards-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;padding:14px 28px 20px}
.wc{border-radius:6px;overflow:hidden;box-shadow:none;display:flex;flex-direction:column;background:#fff}
.wc-head{display:flex;flex-direction:column;padding:14px 16px 10px;border-bottom:none;flex-shrink:0;background:#fff;position:relative;padding-left:0px !important}
.wc-head-title{font-size:14px;color:#000;letter-spacing:.08em;text-transform:uppercase}
.wc-body-bottom{display:flex;flex-direction:column;flex:1}
.wc-body-bottom .wc-img{overflow:hidden}
.wc-body-bottom .wc-img img{display:block;width:100%}

/* ── Section banner (replaces quicklinks heading) ───────── */
.section-banner{
  background:var(--blue-dk);padding:12px 16px;
  margin-top:6px;border-radius:4px
}
.section-banner-text{font-size:10px;font-weight:700;color:#fff;
  text-transform:uppercase;letter-spacing:.07em}

/* ── Table page ─────────────────────────────────────────── */
.table-banner{background:var(--blue);padding:14px 28px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0}
.table-banner .tit{font-size:13px;font-weight:700;color:white;display:flex;align-items:center;gap:8px}
.table-banner .cnt{font-size:8.5px;color:rgba(255,255,255,.65);background:rgba(255,255,255,.15);padding:3px 10px;border-radius:8px}
.data-table-wrap{padding:0 28px 20px;overflow:hidden}
.data-table{width:100%;border-collapse:collapse;font-size:8px}
.data-table thead th{background:var(--blue);color:white;padding:6px 8px;text-align:left;font-weight:600;letter-spacing:.03em}
.data-table tbody tr:nth-child(even) td{background:#f9fafb}
.data-table tbody td{padding:5px 8px;color:var(--dark);border-bottom:1px solid var(--border)}
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
  .wc{page-break-inside:avoid;break-inside:avoid}
  .data-table thead th{print-color-adjust:exact;-webkit-print-color-adjust:exact}
  .table-banner{print-color-adjust:exact;-webkit-print-color-adjust:exact}
  .data-table tbody tr{page-break-inside:avoid;break-inside:avoid}
  .run-header{display:flex !important}
}
</style>
</head>
<body>

<div class="print-bar">
  <span class="print-bar-title">${esc(printTitle)} &mdash; ${printDate}</span>
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
        <div class="val">${chartCount}</div>
        <div class="lbl">Charts</div>
      </div>
      <div class="cover-meta-item">
        <div class="val">${sectionCount}</div>
        <div class="lbl">Sections</div>
      </div>
      <div class="cover-meta-item">
        <div class="val" style="font-size:14px;color:var(--indigo)">${printDate}</div>
        <div class="lbl">Report Date</div>
      </div>
    </div>
    <div class="cover-dots"><span></span><span></span><span></span></div>
  </div>
  <div class="page-footer">
    <span class="doc-title">${esc(printTitle)}</span>
    <span class="pg">Cover</span>
  </div>
</div>

<!-- ── Dashboard charts page ─────────────────────────────────────────── -->
<div class="page">
  <div class="run-header">
    <span class="rh-title">${esc(printTitle)}</span>
    <span class="rh-date">${printDate}</span>
  </div>
  <div class="cards-grid">
    ${cardsHtml}
  </div>
  <div class="page-footer">
    <span class="doc-title">${esc(printTitle)}</span>
    <span class="pg">1</span>
  </div>
</div>

${tablePagesHtml}

</body>
</html>`;

      // ── Open report in new tab using a Blob URL (avoids popup blockers) ────────
      setProg('Opening report…', 100);
      const blob = new Blob([html], { type: 'text/html' });
      const url  = URL.createObjectURL(blob);
      const win  = window.open(url, '_blank');
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
      const btn2 = document.getElementById(CONFIG.buttonId);
      if (btn2) btn2.disabled = false;
    }
  }

  // ── Inject floating trigger button ────────────────────────────────────────────
  function injectButton() {
    if (document.getElementById(CONFIG.buttonId)) return; // already present
    const btn = document.createElement('button');
    btn.id          = CONFIG.buttonId;
    btn.innerHTML   = '&#128247;&nbsp; Generate Report';
    btn.style.cssText = [
      'position:fixed;bottom:24px;right:24px;z-index:8000;',
      'background:#3B98F1;color:white;border:none;border-radius:8px;',
      'padding:10px 20px;font-size:13px;font-weight:600;cursor:pointer;',
      'box-shadow:0 4px 14px rgba(59,152,241,.5);',
      'font-family:Segoe UI,Arial,sans-serif;',
      'transition:opacity .2s',
    ].join('');
    btn.onmouseenter = () => { btn.style.opacity = '.85'; };
    btn.onmouseleave = () => { btn.style.opacity = '1'; };
    btn.onclick      = generateReport;
    document.body.appendChild(btn);
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
