/**
 * ChartWidget
 * Renders bar, line, pie, or area charts using Chart.js.
 * config keys: xKey, yKey, colorKey, aggregation (count|sum|avg|max|min)
 *              dateGroup (monthly|quarterly|yearly|financial_year) — groups date xKey into periods
 * widget.chartType: bar | line | pie | area
 *
 * Aggregation behaviour:
 *  - If aggregation=="count" (or yKey is absent/non-numeric): group rows by xKey and COUNT them.
 *  - If aggregation=="sum" (default when yKey is present): group rows by xKey and SUM yKey.
 *  - If aggregation=="avg|max|min": group and compute accordingly.
 *  - Raw row-per-row rendering only when aggregation=="none".
 */
const ChartWidget = (() => {

  // Track Chart.js instances so we can destroy before re-render
  const _instances = {};

  const PALETTE = [
    '#6366f1','#22c55e','#f59e0b','#ef4444','#06b6d4',
    '#a855f7','#ec4899','#14b8a6','#f97316','#84cc16'
  ];

  const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  function _formatDateLabel(val) {
    const s = String(val ?? '').trim();
    if (/^\d{4}-\d{2}-\d{2}([ T]|$)/.test(s)) {
      const d = new Date(s);
      if (!isNaN(d.getTime())) {
        const dd   = String(d.getDate()).padStart(2, '0');
        const mm   = String(d.getMonth() + 1).padStart(2, '0');
        const yyyy = d.getFullYear();
        return `${dd}/${mm}/${yyyy}`;
      }
    }
    return s;
  }

  // Returns { label, sortKey } for a date value given a dateGroup mode.
  // sortKey is a string that sorts correctly lexicographically.
  function _toDateGroupKey(val, dateGroup) {
    const s = String(val ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}([ T]|$)/.test(s)) return { label: s || '(blank)', sortKey: s };
    const d = new Date(s);
    if (isNaN(d.getTime())) return { label: s, sortKey: s };

    const yr  = d.getFullYear();
    const mon = d.getMonth(); // 0-based

    switch ((dateGroup || '').toLowerCase()) {
      case 'monthly': {
        const label   = `${MONTH_NAMES[mon]} ${yr}`;
        const sortKey = `${yr}-${String(mon + 1).padStart(2, '0')}`;
        return { label, sortKey };
      }
      case 'quarterly': {
        const q       = Math.floor(mon / 3) + 1;
        const label   = `Q${q} ${yr}`;
        const sortKey = `${yr}-Q${q}`;
        return { label, sortKey };
      }
      case 'yearly': {
        return { label: String(yr), sortKey: String(yr) };
      }
      case 'financial_year': {
        // Australian FY: Jul–Jun. Jul 2025–Jun 2026 = FY2025-26
        const fyStart = mon >= 6 ? yr : yr - 1;
        const label   = `FY${fyStart}-${String(fyStart + 1).slice(-2)}`;
        const sortKey = String(fyStart);
        return { label, sortKey };
      }
      default:
        return { label: _formatDateLabel(val), sortKey: s };
    }
  }

  function render(el, data, widget) {
    const config    = widget.config || {};
    const chartType = (widget.chartType || 'bar').toLowerCase();

    if (!data || data.length === 0) {
      el.innerHTML = '<div class="widget-empty">No data</div>';
      return;
    }

    const xKey        = config.xKey || _firstStringKey(data[0]);
    const yKey        = config.yKey || null;
    const aggregation = (config.aggregation || (yKey ? 'sum' : 'count')).toLowerCase();
    const dateGroup   = config.dateGroup || null;

    // ── Aggregate data ───────────────────────────────────────────────────────
    let labels, values;

    if (aggregation === 'none') {
      // Raw: one entry per row — only sensible for line/area over a date axis
      labels = data.map(r => _formatDateLabel(r[xKey]));
      values = data.map(r => parseFloat(r[yKey]) || 0);
    } else {
      // Group by xKey (with optional date bucketing)
      const groups   = {};
      const counts   = {};
      const sortKeys = {};
      data.forEach(row => {
        const { label, sortKey } = _toDateGroupKey(row[xKey], dateGroup);
        const key = label;
        const num = yKey ? (parseFloat(row[yKey]) || 0) : 1;
        if (!(key in groups)) { groups[key] = 0; counts[key] = 0; sortKeys[key] = sortKey; }
        counts[key]++;
        if      (aggregation === 'count')  groups[key]++;
        else if (aggregation === 'sum')    groups[key] += num;
        else if (aggregation === 'avg')    groups[key] += num;   // divide after
        else if (aggregation === 'max')    groups[key] = counts[key] === 1 ? num : Math.max(groups[key], num);
        else if (aggregation === 'min')    groups[key] = counts[key] === 1 ? num : Math.min(groups[key], num);
        else                               groups[key] += num;   // fallback = sum
      });

      const entries = Object.entries(groups)
        .map(([k, v]) => [k, aggregation === 'avg' ? v / counts[k] : v, sortKeys[k]]);

      // Sort chronologically when date grouping, else by value descending
      if (dateGroup) {
        entries.sort((a, b) => a[2].localeCompare(b[2]));
      } else {
        entries.sort((a, b) => b[1] - a[1]);
      }

      labels = entries.map(([k]) => k);
      values = entries.map(([, v]) => Math.round(v * 100) / 100);
    }

    // ── Destroy previous Chart.js instance ──────────────────────────────────
    if (_instances[widget.id]) {
      _instances[widget.id].destroy();
      delete _instances[widget.id];
    }

    el.innerHTML = '<canvas style="width:100%;height:100%;"></canvas>';
    const canvas = el.querySelector('canvas');
    const ctx    = canvas.getContext('2d');

    const isPie  = chartType === 'pie' || chartType === 'doughnut';
    const isArea = chartType === 'area';

    const dataset = {
      label:           widget.title || yKey,
      data:            values,
      backgroundColor: isPie ? PALETTE : (PALETTE[0] + '33'),
      borderColor:     isPie ? PALETTE : PALETTE[0],
      borderWidth:     isPie ? 1 : 2,
      fill:            isArea,
      tension:         0.4,
      pointRadius:     isArea || chartType === 'line' ? 3 : 0
    };

    _instances[widget.id] = new Chart(ctx, {
      type: isPie ? 'pie' : (isArea ? 'line' : chartType),
      data:    { labels, datasets: [dataset] },
      options: {
        responsive:          true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: isPie,
            labels:  { color: '#374151', font: { size: 12 } }
          },
          tooltip: { mode: 'index', intersect: false }
        },
        scales: isPie ? {} : {
          x: {
            ticks: { color: '#6b7280', font: { size: 11 } },
            grid:  { color: '#ced4da' }
          },
          y: {
            ticks: { color: '#6b7280', font: { size: 11 } },
            grid:  { color: '#ced4da' }
          }
        }
      }
    });
  }

  function _firstStringKey(row) {
    if (!row) return null;
    return Object.keys(row).find(k => typeof row[k] === 'string') || Object.keys(row)[0];
  }

  function _firstNumericKey(row) {
    if (!row) return null;
    return Object.keys(row).find(k => typeof row[k] === 'number' || !isNaN(parseFloat(row[k])));
  }

  return { render };

})();
