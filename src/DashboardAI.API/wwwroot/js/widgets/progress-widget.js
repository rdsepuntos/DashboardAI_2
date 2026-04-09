/**
 * ProgressWidget
 * Renders horizontal labelled progress bars — one per category — sorted by value descending.
 * Each bar is sized relative to the largest value (or config.maxValue if supplied).
 * A multi-colour palette is used so each category gets a distinct colour.
 *
 * config keys:
 *   xKey        — category / label column (groups rows on the axis)
 *   yKey        — numeric column to aggregate (omit for count)
 *   aggregation — count | sum | avg | max | min (default count)
 *   maxValue    — optional fixed denominator for bar widths (default = max value in data)
 *   showPercent — "true" | "false" — show "(xx%)" next to each value (default true)
 *   color       — overrides the palette for all bars (leave blank to use the rotating palette)
 */
const ProgressWidget = (() => {

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
      // Server returned { [xKey]: ..., __value: ... } rows
      const xKey = config.xKey
        || Object.keys(data[0]).find(k => k !== '__value' && k !== '__group')
        || Object.keys(data[0])[0];
      labels = data.map(r => String(r[xKey] ?? '(blank)'));
      values = data.map(r => parseFloat(r.__value) || 0);

    } else {
      const xKey        = config.xKey || Object.keys(data[0])[0];
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
        else if (aggregation === 'avg')   groups[key] += num;   // divide after
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

    const maxVal     = parseFloat(config.maxValue) || (Math.max(...values, 1));
    const showPct    = (config.showPercent || 'true') !== 'false';
    const singleColor = config.color || null;

    const rows = labels.map((lbl, i) => {
      const barColor = singleColor || PALETTE[i % PALETTE.length];
      const pct      = Math.min((values[i] / maxVal) * 100, 100);
      const display  = values[i].toLocaleString('en-AU', { maximumFractionDigits: 1 });

      return `
        <div style="margin-bottom:10px;">
          <div style="display:flex;justify-content:space-between;align-items:baseline;font-size:0.78rem;color:#374151;margin-bottom:3px;">
            <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:65%;padding-right:4px;" title="${lbl}">${lbl}</span>
            <span style="font-weight:600;white-space:nowrap;">${display}${showPct ? ` (${pct.toFixed(0)}%)` : ''}</span>
          </div>
          <div style="height:12px;background:#e5e7eb;border-radius:6px;overflow:hidden;">
            <div style="height:100%;width:${pct}%;background:${barColor};border-radius:6px;transition:width .5s ease;"></div>
          </div>
        </div>`;
    }).join('');

    el.innerHTML = `<div style="padding:6px 4px;height:100%;overflow-y:auto;">${rows}</div>`;
  }

  return { render };

})();
