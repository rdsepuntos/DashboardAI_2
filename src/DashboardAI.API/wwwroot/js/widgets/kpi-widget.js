/**
 * KpiWidget
 * Renders a single numeric KPI with optional format (currency / percent / number).
 * config keys: valueKey, aggregation, format, prefix, suffix, label
 *
 * Aggregation behaviour (applied across ALL rows, not just the first):
 *  aggregation="count"  — or valueKey="count" — shows total row count
 *  aggregation="sum"    — sums valueKey across all rows (default when valueKey set)
 *  aggregation="avg"    — averages valueKey across all rows
 *  aggregation="max"    — max of valueKey
 *  aggregation="min"    — min of valueKey
 *  (no aggregation)     — reads valueKey from the first row (pre-aggregated SP result)
 */
const KpiWidget = (() => {

  function render(el, data, config, title) {
    config = config || {};

    const rows        = Array.isArray(data) ? data : (data ? [data] : []);
    const aggregation = (config.aggregation || '').toLowerCase();
    const valueKey    = config.valueKey;

    let raw;

    // "count" — either explicit aggregation or the magic valueKey "count"
    if (aggregation === 'count' || valueKey === 'count') {
      raw = rows.length;

    } else if (aggregation === 'sum' || aggregation === 'avg' ||
               aggregation === 'max' || aggregation === 'min') {
      const key = valueKey || _firstNumericKey(rows[0]);
      if (!key) { el.innerHTML = '<div class="widget-empty">No data</div>'; return; }

      const nums = rows.map(r => parseFloat(r[key])).filter(n => !isNaN(n));
      if (nums.length === 0) { el.innerHTML = '<div class="widget-empty">No data</div>'; return; }

      if      (aggregation === 'sum') raw = nums.reduce((a, b) => a + b, 0);
      else if (aggregation === 'avg') raw = nums.reduce((a, b) => a + b, 0) / nums.length;
      else if (aggregation === 'max') raw = Math.max(...nums);
      else if (aggregation === 'min') raw = Math.min(...nums);

    } else {
      // No aggregation — read from first row (pre-aggregated query result)
      const row = rows[0];
      const key = valueKey || _firstNumericKey(row);
      raw = row && key ? row[key] : null;
    }

    if (raw === null || raw === undefined) {
      el.innerHTML = '<div class="widget-empty">No data</div>';
      return;
    }

    const formatted = _format(raw, config.format, config.prefix, config.suffix);
    const label = config.label || title || (valueKey !== 'count' ? valueKey : '') || '';
    const color = config.color || '';

    el.innerHTML = `
      <div class="kpi-card">
        <div class="kpi-value"${color ? ` style="color:${color}"` : ''}>${formatted}</div>
        ${label ? `<div class="kpi-label">${label}</div>` : ''}
      </div>`;
  }

  function _format(value, format, prefix, suffix) {
    prefix = prefix || '';
    suffix = suffix || '';
    const num = parseFloat(value);
    if (isNaN(num)) return `${prefix}${value}${suffix}`;

    switch ((format || '').toLowerCase()) {
      case 'currency':
        return `${prefix || '$'}${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${suffix}`;
      case 'percent':
        return `${prefix}${num.toFixed(1)}%${suffix}`;
      default:
        return `${prefix}${num.toLocaleString()}${suffix}`;
    }
  }

  function _firstNumericKey(row) {
    if (!row) return null;
    return Object.keys(row).find(k => typeof row[k] === 'number' || !isNaN(parseFloat(row[k])));
  }

  return { render };

})();
