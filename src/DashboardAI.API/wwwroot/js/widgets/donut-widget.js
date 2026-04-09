/**
 * DonutWidget
 * Renders a doughnut chart using Chart.js with a total count displayed in the centre hole.
 * Identical aggregation logic to ChartWidget pie, but always uses doughnut type.
 *
 * config keys:
 *   xKey        — label / category column
 *   yKey        — numeric column to aggregate (omit for count)
 *   aggregation — count | sum | avg | max | min (default count when yKey absent, sum otherwise)
 */
const DonutWidget = (() => {

  const _instances = {};

  const PALETTE = [
    '#3B98F1', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4',
    '#a855f7', '#ec4899', '#14b8a6', '#f97316', '#84cc16'
  ];

  function render(el, data, widget, preAggregated) {
    const config = widget.config || {};

    if (!data || data.length === 0) {
      el.innerHTML = '<div class="widget-empty">No data</div>';
      return;
    }

    let labels, values;

    if (preAggregated) {
      const xKey = config.xKey
        || Object.keys(data[0]).find(k => k !== '__value' && k !== '__group')
        || Object.keys(data[0])[0];
      labels = data.map(r => String(r[xKey] ?? '(blank)'));
      values = data.map(r => parseFloat(r.__value) || 0);

    } else {
      const xKey        = config.xKey
        || Object.keys(data[0]).find(k => typeof data[0][k] === 'string')
        || Object.keys(data[0])[0];
      const yKey        = config.yKey || null;
      const aggregation = (config.aggregation || (yKey ? 'sum' : 'count')).toLowerCase();
      const groups      = {};
      const counts      = {};

      data.forEach(row => {
        const key = String(row[xKey] ?? '(blank)');
        const num = yKey ? (parseFloat(row[yKey]) || 0) : 1;
        if (!(key in groups)) { groups[key] = 0; counts[key] = 0; }
        counts[key]++;
        if      (aggregation === 'count') groups[key]++;
        else if (aggregation === 'sum')   groups[key] += num;
        else if (aggregation === 'avg')   groups[key] += num;
        else if (aggregation === 'max')   groups[key] = counts[key] === 1 ? num : Math.max(groups[key], num);
        else if (aggregation === 'min')   groups[key] = counts[key] === 1 ? num : Math.min(groups[key], num);
        else                              groups[key]++;
      });

      const entries = Object.entries(groups)
        .map(([k, v]) => [k, aggregation === 'avg' ? v / counts[k] : v]);
      entries.sort((a, b) => b[1] - a[1]);
      labels = entries.map(([k])  => k);
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
    const total  = values.reduce((a, b) => a + b, 0);

    // Custom plugin to draw total label in the centre of the doughnut
    const centerTextPlugin = {
      id: `donutCenter_${widget.id}`,
      afterDraw(chart) {
        const { ctx: c, chartArea: { top, left, width, height } } = chart;
        const cx = left + width  / 2;
        const cy = top  + height / 2;
        c.save();
        c.textAlign    = 'center';
        c.textBaseline = 'middle';
        c.font         = 'bold 16px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        c.fillStyle    = '#1a1d27';
        c.fillText(total.toLocaleString('en-AU'), cx, cy - 9);
        c.font      = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        c.fillStyle = '#6b7280';
        c.fillText('total', cx, cy + 10);
        c.restore();
      }
    };

    _instances[widget.id] = new Chart(ctx, {
      type:    'doughnut',
      data:    { labels, datasets: [{ data: values, backgroundColor: PALETTE, borderColor: '#fff', borderWidth: 2 }] },
      options: {
        responsive:          true,
        maintainAspectRatio: false,
        cutout:              '60%',
        plugins: {
          legend: {
            display:  true,
            position: 'right',
            labels:   { color: '#374151', font: { size: 11 }, boxWidth: 12, padding: 10 }
          },
          tooltip: {
            callbacks: {
              label: ctx => {
                const pct = total ? ((ctx.parsed / total) * 100).toFixed(1) : 0;
                return ` ${ctx.label}: ${ctx.parsed.toLocaleString('en-AU')} (${pct}%)`;
              }
            }
          }
        },
        animation: { animateRotate: true, duration: 700 }
      },
      plugins: [centerTextPlugin]
    });
  }

  return { render };

})();
