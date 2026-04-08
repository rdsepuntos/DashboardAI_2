/**
 * MapWidget
 * Renders a Leaflet map with markers from data rows.
 * config keys: latKey, lngKey, labelKey
 */
const MapWidget = (() => {

  const _maps = {};

  function render(el, data, config) {
    config = config || {};

    const latKey   = config.latKey   || 'Lat';
    const lngKey   = config.lngKey   || 'Lng';
    const labelKey = config.labelKey || null;

    if (!data || data.length === 0) {
      el.innerHTML = '<div class="widget-empty">No location data</div>';
      return;
    }

    const mapId = 'map_' + Math.random().toString(36).slice(2);
    el.innerHTML = `<div id="${mapId}" style="width:100%;height:100%;min-height:200px;border-radius:8px;"></div>`;

    // Small delay to ensure DOM is mounted before Leaflet initialises
    setTimeout(() => {
      // Destroy previous instance if element was reused
      const existingKey = el.dataset.mapKey;
      if (existingKey && _maps[existingKey]) {
        _maps[existingKey].remove();
        delete _maps[existingKey];
      }
      el.dataset.mapKey = mapId;

      const validRows = data.filter(r =>
        r[latKey] != null && r[lngKey] != null &&
        !isNaN(parseFloat(r[latKey])) && !isNaN(parseFloat(r[lngKey])));

      if (validRows.length === 0) {
        el.innerHTML = '<div class="widget-empty">No valid coordinates</div>';
        return;
      }

      const map = L.map(mapId, { zoomControl: true });
      _maps[mapId] = map;

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
      }).addTo(map);

      const bounds = [];
      validRows.forEach(row => {
        const lat   = parseFloat(row[latKey]);
        const lng   = parseFloat(row[lngKey]);
        const label = labelKey ? String(row[labelKey]) : `(${lat.toFixed(4)}, ${lng.toFixed(4)})`;

        L.marker([lat, lng])
          .bindPopup(label)
          .addTo(map);

        bounds.push([lat, lng]);
      });

      map.fitBounds(bounds, { padding: [20, 20] });
    }, 50);
  }

  return { render };

})();
