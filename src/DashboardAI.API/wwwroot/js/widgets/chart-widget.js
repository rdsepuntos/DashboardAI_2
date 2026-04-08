/**
 * ChartWidget
 * Renders bar, line, pie, or area charts using Chart.js.
 * config keys: xKey, yKey, colorKey, aggregation (count|sum|avg|max|min)
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

    // ── Aggregate data ───────────────────────────────────────────────────────
    let labels, values;

    if (aggregation === 'none') {
      // Raw: one entry per row — only sensible for line/area over a date axis
      labels = data.map(r => String(r[xKey] ?? ''));
      values = data.map(r => parseFloat(r[yKey]) || 0);
    } else {
      // Group by xKey
      const groups = {};
      const counts = {};
      data.forEach(row => {
        const key = String(row[xKey] ?? '(blank)');
        const num = yKey ? (parseFloat(row[yKey]) || 0) : 1;
        if (!(key in groups)) { groups[key] = 0; counts[key] = 0; }
        counts[key]++;
        if      (aggregation === 'count')  groups[key]++;
        else if (aggregation === 'sum')    groups[key] += num;
        else if (aggregation === 'avg')    groups[key] += num;   // divide after
        else if (aggregation === 'max')    groups[key] = counts[key] === 1 ? num : Math.max(groups[key], num);
        else if (aggregation === 'min')    groups[key] = counts[key] === 1 ? num : Math.min(groups[key], num);
        else                               groups[key] += num;   // fallback = sum
      });

      // Sort descending by value for readability
      const sorted = Object.entries(groups)
        .map(([k, v]) => [k, aggregation === 'avg' ? v / counts[k] : v])
        .sort((a, b) => b[1] - a[1]);

      labels = sorted.map(([k]) => k);
      values = sorted.map(([, v]) => Math.round(v * 100) / 100);
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
            labels:  { color: '#e2e4f0', font: { size: 12 } }
          },
          tooltip: { mode: 'index', intersect: false }
        },
        scales: isPie ? {} : {
          x: {
            ticks: { color: '#7c7f99', font: { size: 11 } },
            grid:  { color: '#2a2d3e' }
          },
          y: {
            ticks: { color: '#7c7f99', font: { size: 11 } },
            grid:  { color: '#2a2d3e' }
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
