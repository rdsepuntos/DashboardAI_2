/**
 * ChartWidget
 * Renders bar, line, pie, or area charts using Chart.js.
 * config keys: xKey, yKey, colorKey
 * widget.chartType: bar | line | pie | area
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
    const xKey      = config.xKey || _firstStringKey(data[0]);
    const yKey      = config.yKey || _firstNumericKey(data[0]);

    if (!data || data.length === 0) {
      el.innerHTML = '<div class="widget-empty">No data</div>';
      return;
    }

    // Destroy previous instance if any
    if (_instances[widget.id]) {
      _instances[widget.id].destroy();
      delete _instances[widget.id];
    }

    el.innerHTML = '<canvas style="width:100%;height:100%;"></canvas>';
    const canvas = el.querySelector('canvas');
    const ctx    = canvas.getContext('2d');

    const labels = data.map(r => r[xKey] ?? '');
    const values = data.map(r => parseFloat(r[yKey]) || 0);

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
