/**
 * GaugeWidget
 * Renders a half-doughnut gauge using Chart.js showing a scalar value within a min–max range.
 *
 * config keys:
 *   valueKey      — column to read (ignored when preAggregated; server returns __value)
 *   min           — minimum of the scale (default 0)
 *   max           — maximum of the scale (default 100)
 *   format        — "number" | "percent" | "currency"
 *   color         — fill colour for the value arc (default #3B98F1)
 *   prefix/suffix — optional string decoration on the displayed value
 *   label         — text shown below the value (fall back to widget title)
 */
const GaugeWidget = (() => {

  // Track Chart.js instances keyed by random canvas id so we can destroy on re-render
  const _instances = {};

  function render(el, data, config, title, preAggregated) {
    config = config || {};

    // ── Resolve scalar value ─────────────────────────────────────────────────
    let raw;
    if (preAggregated) {
      const rows = Array.isArray(data) ? data : (data ? [data] : []);
      raw = rows.length > 0 ? (rows[0].__value ?? null) : null;
    } else {
      const rows = Array.isArray(data) ? data : (data ? [data] : []);
      raw = rows.length > 0 ? (rows[0][config.valueKey] ?? null) : null;
    }

    if (raw === null || raw === undefined) {
      el.innerHTML = '<div class="widget-empty">No data</div>';
      return;
    }

    const min   = parseFloat(config.min  ?? 0);
    const max   = parseFloat(config.max  ?? 100);
    const value = Math.min(Math.max(parseFloat(raw) || 0, min), max);
    const pct   = max > min ? (value - min) / (max - min) : 0;
    const color = config.color || '#3B98F1';

    // ── Build DOM ─────────────────────────────────────────────────────────────
    const canvasId = 'gauge_' + Math.random().toString(36).slice(2);

    el.innerHTML = `
      <div style="position:relative;width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:8px 0;">
        <div style="position:relative;width:100%;max-width:200px;">
          <canvas id="${canvasId}" style="display:block;"></canvas>
        </div>
        <div style="margin-top:-12px;text-align:center;z-index:1;">
          <div style="font-size:1.8rem;font-weight:700;color:${color};line-height:1.1;">${_format(value, config.format, config.prefix, config.suffix)}</div>
          <div style="font-size:0.73rem;color:#6b7280;margin-top:3px;">${config.label || title || ''}</div>
          ${config.max !== undefined ? `<div style="font-size:0.68rem;color:#9ca3af;margin-top:1px;">max ${_format(max, config.format)}</div>` : ''}
        </div>
        <div style="display:flex;justify-content:space-between;width:100%;max-width:200px;padding:0 8px;margin-top:4px;">
          <span style="font-size:0.68rem;color:#9ca3af;">${_format(min, config.format)}</span>
          <span style="font-size:0.68rem;color:#9ca3af;">${_format(max, config.format)}</span>
        </div>
      </div>`;

    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    // Clean up any previous instance attached to this element
    const existingKey = el.dataset.gaugeKey;
    if (existingKey && _instances[existingKey]) {
      _instances[existingKey].destroy();
      delete _instances[existingKey];
    }
    el.dataset.gaugeKey = canvasId;

    _instances[canvasId] = new Chart(ctx, {
      type: 'doughnut',
      data: {
        datasets: [{
          data:            [pct, 1 - pct],
          backgroundColor: [color, '#e5e7eb'],
          borderWidth:     0,
          borderRadius:    [4, 0]
        }]
      },
      options: {
        responsive:          true,
        maintainAspectRatio: true,
        circumference:       180,
        rotation:            -90,
        cutout:              '72%',
        plugins: {
          legend:  { display: false },
          tooltip: { enabled: false }
        },
        animation: { animateRotate: true, duration: 700 }
      }
    });
  }

  function _format(val, fmt, prefix, suffix) {
    if (val === null || val === undefined) return '—';
    const num = parseFloat(val);
    if (isNaN(num)) return String(val);
    let s;
    if      (fmt === 'currency') s = '$' + Math.abs(num).toLocaleString('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    else if (fmt === 'percent')  s = num.toFixed(1) + '%';
    else                         s = num.toLocaleString('en-AU', { maximumFractionDigits: 1 });
    return (prefix || '') + s + (suffix || '');
  }

  return { render };

})();
