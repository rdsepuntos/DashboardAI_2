/**
 * HeatmapWidget
 * Renders a 2-D intensity grid (colour heat map) from raw row data.
 * Each cell shows the count of rows matching that (x, y) combination.
 * No external library required — uses pure CSS/HTML with inline colour interpolation.
 *
 * config keys:
 *   xKey        — column for x-axis (columns, e.g. day / month / team)
 *   yKey        — column for y-axis (rows, e.g. Status / HazardType)
 *   colorScale  — "heat" (white → amber-brown, default) | "cool" (white → blue)
 *
 * Data handling:
 *   preAggregated=true  — server returned { [xKey]: ..., [yKey]: ..., __value: N } rows
 *                         (preferred path — avoids SELECT *)
 *   preAggregated=false — raw rows are counted client-side (fallback only)
 */
const HeatmapWidget = (() => {

  // Colour ramp end-points for each scale
  const SCALES = {
    heat: { low: '#fff7ed', high: '#b45309' },
    cool: { low: '#eff6ff', high: '#1d4ed8' }
  };

  function render(el, data, config, preAggregated) {
    config = config || {};

    if (!data || data.length === 0) {
      el.innerHTML = '<div class="widget-empty">No data</div>';
      return;
    }

    const firstRow = data[0];
    const keys     = Object.keys(firstRow);
    const xKey     = config.xKey || keys[0];
    const yKey     = config.yKey || keys[1] || keys[0];
    const scale    = SCALES[(config.colorScale || 'heat').toLowerCase()] || SCALES.heat;

    // ── Aggregate into cells ─────────────────────────────────────────────────
    const xSet  = new Set();
    const ySet  = new Set();
    const cells = {};   // key: `${x}\x00${y}`

    if (preAggregated) {
      // Server returned one row per (xKey, yKey) pair: __value = COUNT(*)
      data.forEach(row => {
        const x = String(row[xKey] ?? '');
        const y = String(row[yKey] ?? '');
        xSet.add(x);
        ySet.add(y);
        cells[x + '\x00' + y] = parseFloat(row.__value) || 0;
      });
    } else {
      // Fallback: count raw rows client-side
      data.forEach(row => {
        const x = String(row[xKey] ?? '');
        const y = String(row[yKey] ?? '');
        xSet.add(x);
        ySet.add(y);
        const k = x + '\x00' + y;
        cells[k] = (cells[k] || 0) + 1;
      });
    }

    const xLabels = [...xSet].sort();
    const yLabels = [...ySet].sort();
    const allVals = Object.values(cells);
    const maxVal  = Math.max(...allVals, 1);

    // ── Build table HTML ─────────────────────────────────────────────────────
    const colW = Math.max(36, Math.min(72, Math.floor(480 / (xLabels.length + 1))));

    let html = `
      <div style="overflow:auto;height:100%;font-size:0.72rem;">
        <table style="border-collapse:separate;border-spacing:2px;width:100%;">
          <thead>
            <tr>
              <th style="padding:4px 8px;text-align:left;color:#6b7280;white-space:nowrap;min-width:80px;"></th>`;

    xLabels.forEach(x => {
      html += `
              <th style="padding:4px 4px;text-align:center;color:#6b7280;white-space:nowrap;
                         min-width:${colW}px;max-width:${colW}px;overflow:hidden;text-overflow:ellipsis;
                         font-weight:500;" title="${_esc(x)}">${_esc(_truncate(x, 10))}</th>`;
    });

    html += `</tr></thead><tbody>`;

    yLabels.forEach(y => {
      html += `<tr><td style="padding:4px 8px;color:#374151;white-space:nowrap;font-weight:500;
                              border-right:1px solid #e5e7eb;">${_esc(y)}</td>`;
      xLabels.forEach(x => {
        const val = cells[x + '\x00' + y] || 0;
        const t   = maxVal > 0 ? val / maxVal : 0;
        const bg  = _lerp(scale.low, scale.high, t);
        const fg  = t > 0.55 ? '#fff' : '#374151';
        const display = val > 0 ? String(Math.round(val * 10) / 10) : '';
        html += `
          <td style="padding:4px;text-align:center;background:${bg};color:${fg};
                     border-radius:4px;min-width:${colW}px;font-weight:${val > 0 ? '600' : '400'};"
              title="${_esc(y)} × ${_esc(x)}: ${val}">${display}</td>`;
      });
      html += `</tr>`;
    });

    html += `</tbody></table></div>`;
    el.innerHTML = html;
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  /** Linear interpolation between two hex colours, t in [0,1]. */
  function _lerp(from, to, t) {
    const f = _hex(from);
    const g = _hex(to);
    const r = Math.round(f[0] + (g[0] - f[0]) * t);
    const v = Math.round(f[1] + (g[1] - f[1]) * t);
    const b = Math.round(f[2] + (g[2] - f[2]) * t);
    return `rgb(${r},${v},${b})`;
  }

  function _hex(h) {
    const s = h.replace('#', '');
    return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
  }

  function _esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function _truncate(s, n) {
    const str = String(s ?? '');
    return str.length > n ? str.slice(0, n - 1) + '…' : str;
  }

  return { render };

})();
