/**
 * KpiWidget
 * Renders a single numeric KPI with optional format (currency / percent / number).
 * config keys: valueKey, format, prefix, suffix, label
 */
const KpiWidget = (() => {

  function render(el, data, config) {
    config = config || {};

    const row      = Array.isArray(data) ? data[0] : data;
    const valueKey = config.valueKey || _firstNumericKey(row);
    const raw      = row && valueKey ? row[valueKey] : null;

    if (raw === null || raw === undefined) {
      el.innerHTML = '<div class="widget-empty">No data</div>';
      return;
    }

    const formatted = _format(raw, config.format, config.prefix, config.suffix);
    const label     = config.label || valueKey || '';

    el.innerHTML = `
      <div class="kpi-value">${formatted}</div>
      <div class="kpi-label">${label}</div>`;
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
