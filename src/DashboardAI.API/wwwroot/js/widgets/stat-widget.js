/**
 * StatWidget
 * Renders a KPI-style card with a delta/trend indicator vs a comparison value.
 *
 * config keys:
 *   valueKey      — column to aggregate (or "count"); ignored when preAggregated (uses __value)
 *   aggregation   — count | sum | avg | max | min (default count)
 *   prevValue     — hardcoded numeric comparison value (e.g. "142")
 *   deltaLabel    — contextual label for the delta (e.g. "vs last month")
 *   goodDirection — "up" or "down" — determines whether an increase is green or red (default "up")
 *   format        — "number" | "percent" | "currency"
 *   color         — colour for the primary value (default #3B98F1)
 *   prefix/suffix — optional decoration
 *   label         — text beneath the value (falls back to widget title)
 */
const StatWidget = (() => {

  function render(el, data, config, title, preAggregated) {
    config = config || {};

    // ── Resolve current value ────────────────────────────────────────────────
    let current = null;

    if (preAggregated) {
      const rows = Array.isArray(data) ? data : (data ? [data] : []);
      if (rows.length > 0) current = parseFloat(rows[0].__value ?? null);
    } else {
      const rows       = Array.isArray(data) ? data : (data ? [data] : []);
      const aggregation = (config.aggregation || 'count').toLowerCase();
      const valueKey    = config.valueKey;

      if (aggregation === 'count' || valueKey === 'count') {
        current = rows.length;
      } else if (rows.length > 0) {
        const nums = rows.map(r => parseFloat(r[valueKey]) || 0);
        if      (aggregation === 'sum') current = nums.reduce((a, b) => a + b, 0);
        else if (aggregation === 'avg') current = nums.reduce((a, b) => a + b, 0) / nums.length;
        else if (aggregation === 'max') current = Math.max(...nums);
        else if (aggregation === 'min') current = Math.min(...nums);
        else                            current = nums[0];
      }
    }

    const color    = config.color    || '#3B98F1';
    const goodDir  = (config.goodDirection || 'up').toLowerCase();
    const prevRaw  = config.prevValue !== undefined ? parseFloat(config.prevValue) : null;

    // ── Delta calculation ────────────────────────────────────────────────────
    let deltaHtml = '';
    if (current !== null && !isNaN(current) && prevRaw !== null && !isNaN(prevRaw) && prevRaw !== 0) {
      const delta     = current - prevRaw;
      const deltaPct  = (delta / Math.abs(prevRaw)) * 100;
      const isGood    = goodDir === 'up' ? delta >= 0 : delta <= 0;
      const arrow     = delta > 0 ? '↑' : delta < 0 ? '↓' : '→';
      const deltaCol  = delta === 0 ? '#6b7280' : (isGood ? '#22c55e' : '#ef4444');
      const sign      = delta > 0 ? '+' : '';
      const deltaLabel = config.deltaLabel ? `<span style="color:#9ca3af;margin-left:4px;">${config.deltaLabel}</span>` : '';

      deltaHtml = `
        <div style="display:flex;align-items:center;margin-top:8px;font-size:0.82rem;justify-content:center;flex-wrap:wrap;gap:4px;">
          <span style="color:${deltaCol};font-weight:600;">${arrow} ${sign}${_format(Math.abs(delta), config.format)} (${sign}${deltaPct.toFixed(1)}%)</span>
          ${deltaLabel}
        </div>`;
    } else if (prevRaw !== null && !isNaN(prevRaw)) {
      // Show prev value even if delta % can't be computed (prevRaw === 0)
      const deltaLabel = config.deltaLabel ? `<span style="color:#9ca3af;margin-left:4px;">${config.deltaLabel}</span>` : '';
      deltaHtml = `
        <div style="display:flex;align-items:center;margin-top:8px;font-size:0.82rem;justify-content:center;gap:4px;">
          <span style="color:#6b7280;">prev: ${_format(prevRaw, config.format)}</span>
          ${deltaLabel}
        </div>`;
    }

    const valueStr = (current !== null && !isNaN(current))
      ? _format(current, config.format, config.prefix, config.suffix)
      : '—';
    const labelStr = config.label || title || '';

    el.innerHTML = `
      <div class="kpi-card">
        <div class="kpi-value"${color ? ` style="color:${color}"` : ''}>${valueStr}</div>
        ${labelStr ? `<div class="kpi-label">${labelStr}</div>` : ''}
        ${deltaHtml}
      </div>`;
  }

  function _format(val, fmt, prefix, suffix) {
    if (val === null || val === undefined) return '—';
    const num = parseFloat(val);
    if (isNaN(num)) return String(val);
    let s;
    if      (fmt === 'currency') s = '$' + Math.abs(num).toLocaleString('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    else if (fmt === 'percent')  s = Math.abs(num).toFixed(1) + '%';
    else                         s = Math.abs(num).toLocaleString('en-AU', { maximumFractionDigits: 1 });
    return (prefix || '') + s + (suffix || '');
  }

  return { render };

})();
