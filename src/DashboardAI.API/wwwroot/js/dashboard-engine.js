/**
 * DashboardEngine
 * Loads a dashboard by ID, renders filters + widgets on a GridStack canvas,
 * and handles real-time filter changes that re-fetch widget data.
 */
const API_BASE = location.protocol === 'file:' ? 'http://localhost:56231' : 'https://beta.whsmonitor.com.au/dashboardv2';

const DashboardEngine = (() => {

  let _grid        = null;
  let _dashboard   = null;   // full DashboardDto
  let _filterState = {};     // { filterId: currentValue, ... }
  let _session     = {};

  // ── Init ────────────────────────────────────────────────────────────────────
  async function init(dashboardId, session) {
    _session = session;

    _grid = GridStack.init({
      column:      12,
      cellHeight:  80,
      margin:      10,
      resizable:   { handles: 'e,se,s,sw,w' },
      draggable:   { handle: '.widget-header' },
      animate:     true
    }, '#gridContainer');

    _grid.on('change', _onLayoutChange);

    try {
      const res  = await fetch(`${API_BASE}/api/dashboard/${dashboardId}?userId=${session.userId}&storeId=${session.storeId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      await render(data);
    } catch (err) {
      document.getElementById('dashboardTitle').textContent = 'Error loading dashboard';
      console.error('[DashboardEngine] Init error:', err);
    }

    // Toggle chat sidebar
    $('#toggleChatBtn').on('click', () => $('#chatSidebar').toggleClass('hidden'));
    $('#closeChatBtn').on('click',  () => $('#chatSidebar').addClass('hidden'));
  }

  // ── Render full dashboard ────────────────────────────────────────────────────
  async function render(dashboardDto) {
    _dashboard = dashboardDto;
    document.getElementById('dashboardTitle').textContent = dashboardDto.title || 'Dashboard';
    document.title = dashboardDto.title || 'DashboardAI';

    _buildFilterBar(dashboardDto.filters || []);
    _grid.removeAll();
    _renderWidgets(dashboardDto.widgets || []);
  }

  // ── Filter bar ───────────────────────────────────────────────────────────────
  function _buildFilterBar(filters) {
    const bar = document.getElementById('filterBar');
    bar.innerHTML = '';
    _filterState  = {};

    filters.forEach(f => {
      if (f.isLocked) {
        // Locked filters are invisible; their value comes from session
        _filterState[f.id] = _session.storeId;
        return;
      }

      const wrap = document.createElement('div');
      wrap.className = 'filter-item';

      if (f.type === 'daterange') {
        wrap.innerHTML = `
          <label>${f.label}</label>
          <input type="date" id="f_${f.id}_start" data-filter="${f.id}" data-key="StartDate" />
          <span style="color:var(--color-muted)">–</span>
          <input type="date" id="f_${f.id}_end"   data-filter="${f.id}" data-key="EndDate"   />`;

        _filterState[f.id] = {};
        if (f.defaultValue) {
          try {
            const dv = JSON.parse(f.defaultValue);
            wrap.querySelector('[data-key=StartDate]').value = dv.StartDate || '';
            wrap.querySelector('[data-key=EndDate]').value   = dv.EndDate   || '';
            _filterState[f.id] = dv;
          } catch(_) {}
        }

        $(wrap).find('input[type=date]').on('change', function() {
          const startEl = document.getElementById(`f_${f.id}_start`);
          const endEl   = document.getElementById(`f_${f.id}_end`);
          _filterState[f.id] = { StartDate: startEl.value, EndDate: endEl.value };
          _refreshWidgetsForFilter(f.id);
        });

      } else if (f.type === 'dropdown' || f.type === 'multiselect') {
        wrap.innerHTML = `<label>${f.label}</label><select id="f_${f.id}" data-filter="${f.id}"><option value="">All</option></select>`;
        _filterState[f.id] = '';

        if (f.optionsSource) {
          _loadDropdownOptions(f.id, f.optionsSource, f.valueKey, f.labelKey, f.defaultValue);
        }

        $(wrap).find('select').on('change', function() {
          _filterState[f.id] = this.value;
          _refreshWidgetsForFilter(f.id);
        });

      } else if (f.type === 'datepicker') {
        wrap.innerHTML = `<label>${f.label}</label><input type="date" id="f_${f.id}" data-filter="${f.id}" />`;
        _filterState[f.id] = f.defaultValue || '';

        $(wrap).find('input').on('change', function() {
          _filterState[f.id] = this.value;
          _refreshWidgetsForFilter(f.id);
        });

      } else {
        wrap.innerHTML = `<label>${f.label}</label><input type="text" id="f_${f.id}" data-filter="${f.id}" placeholder="Filter…" />`;
        _filterState[f.id] = f.defaultValue || '';

        $(wrap).find('input').on('input', _debounce(function() {
          _filterState[f.id] = this.value;
          _refreshWidgetsForFilter(f.id);
        }, 400));
      }

      bar.appendChild(wrap);
    });
  }

  async function _loadDropdownOptions(filterId, source, valueKey, labelKey, defaultValue) {
    try {
      const data = await _queryData(source, { StoreId: _session.storeId });
      const sel  = document.getElementById(`f_${filterId}`);
      if (!sel) return;

      data.forEach(row => {
        const opt = document.createElement('option');
        opt.value       = row[valueKey] || row[Object.keys(row)[0]];
        opt.textContent = row[labelKey] || row[Object.keys(row)[1]] || opt.value;
        sel.appendChild(opt);
      });

      if (defaultValue) {
        sel.value            = defaultValue;
        _filterState[filterId] = defaultValue;
      }
    } catch(err) {
      console.warn('[DashboardEngine] Failed to load filter options for', source, err);
    }
  }

  // ── Widget rendering ─────────────────────────────────────────────────────────
  function _renderWidgets(widgets) {
    widgets.forEach(w => {
      const el = _createWidgetElement(w);
      _grid.addWidget(el, {
        id: w.id, x: w.position?.x || 0, y: w.position?.y || 0,
        w:  w.position?.w || 6,          h: w.position?.h || 4
      });
      _loadWidgetData(w);
    });
  }

  function _createWidgetElement(widget) {
    const div = document.createElement('div');
    div.className    = 'grid-stack-item';
    div.dataset.id   = widget.id;
    div.dataset.type = widget.type;
    div.innerHTML = `
      <div class="grid-stack-item-content">
        <div class="widget-header">
          <h3>${widget.title || ''}</h3>
        </div>
        <div class="widget-body" id="wb_${widget.id}">
          <div class="widget-loading">Loading…</div>
        </div>
      </div>`;
    return div;
  }

  async function _loadWidgetData(widget, page) {
    const bodyEl = document.getElementById(`wb_${widget.id}`);
    if (!bodyEl) return;

    const params   = _buildWidgetParams(widget);
    const isTable  = (widget.type || '').toLowerCase() === 'table';
    const pageSize = (widget.config && widget.config.pageSize) ? parseInt(widget.config.pageSize) : 50;
    const curPage  = page || 1;

    bodyEl.innerHTML = '<div class="widget-loading">Loading…</div>';

    try {
      if (isTable) {
        const result = await _queryDataPaged(widget.dataSource, params, curPage, pageSize);
        const fetchFn = (p) => _loadWidgetData(widget, p);
        _renderWidgetContent(widget, bodyEl, result.data, result, fetchFn);
      } else {
        const data = await _queryData(widget.dataSource, params);
        _renderWidgetContent(widget, bodyEl, data);
      }
    } catch(err) {
      bodyEl.innerHTML = `<div class="widget-error">⚠ ${err.message}</div>`;
    }
  }

  function _buildWidgetParams(widget) {
    const params = { StoreId: _session.storeId };

    (widget.appliesFilters || []).forEach(fid => {
      const filter = (_dashboard.filters || []).find(f => f.id === fid);
      if (!filter) return;
      const val = _filterState[fid];

      if (filter.type === 'daterange' && val && typeof val === 'object') {
        if (val.StartDate) params['StartDate'] = val.StartDate;
        if (val.EndDate)   params['EndDate']   = val.EndDate;
      } else if (val) {
        params[filter.param] = val;
      }
    });

    return params;
  }

  function _renderWidgetContent(widget, bodyEl, data, meta, fetchFn) {
    bodyEl.innerHTML = '';

    switch ((widget.type || '').toLowerCase()) {
      case 'kpi':      KpiWidget.render(bodyEl, data, widget.config);              break;
      case 'chart':    ChartWidget.render(bodyEl, data, widget);                  break;
      case 'table':    TableWidget.render(bodyEl, data, widget.config, meta, fetchFn); break;
      case 'map':      MapWidget.render(bodyEl, data, widget.config);              break;
      case 'markdown': MarkdownWidget.render(bodyEl, widget.config);              break;
      default:
        bodyEl.innerHTML = `<div class="widget-empty">Unknown widget type: ${widget.type}</div>`;
    }
  }

  // ── Filter-driven refresh ─────────────────────────────────────────────────────
  function _refreshWidgetsForFilter(filterId) {
    (_dashboard.widgets || []).forEach(w => {
      if ((w.appliesFilters || []).includes(filterId)) {
        _loadWidgetData(w);
      }
    });
  }

  function refreshAllWidgets() {
    (_dashboard.widgets || []).forEach(w => _loadWidgetData(w));
  }

  // ── Apply commands from chat ──────────────────────────────────────────────────
  function applyCommands(commands, updatedDashboard) {
    commands.forEach(cmd => {
      switch (cmd.action) {
        case 'add_widget': {
          const el = _createWidgetElement(cmd.widget);
          _grid.addWidget(el, {
            id: cmd.widget.id,
            x:  cmd.widget.position?.x || 0,
            y:  cmd.widget.position?.y || 0,
            w:  cmd.widget.position?.w || 6,
            h:  cmd.widget.position?.h || 4
          });
          _loadWidgetData(cmd.widget);
          break;
        }
        case 'update_widget': {
          const existing = document.querySelector(`.grid-stack-item[data-id="${cmd.widget.id}"]`);
          if (existing) _grid.removeWidget(existing, true);
          const el = _createWidgetElement(cmd.widget);
          _grid.addWidget(el, {
            id: cmd.widget.id,
            x:  cmd.widget.position?.x || 0,
            y:  cmd.widget.position?.y || 0,
            w:  cmd.widget.position?.w || 6,
            h:  cmd.widget.position?.h || 4
          });
          setTimeout(() => _loadWidgetData(cmd.widget), 0);
          break;
        }
        case 'remove_widget': {
          const el = document.querySelector(`.grid-stack-item[data-id="${cmd.targetId}"]`);
          if (el) _grid.removeWidget(el);
          break;
        }
        case 'add_filter':
        case 'update_filter':
        case 'remove_filter': {
          // Re-render entire filter bar with updated dashboard
          _buildFilterBar(updatedDashboard.filters || []);
          break;
        }
        case 'update_filter_value': {
          _filterState[cmd.targetId] = cmd.value;
          // Update visible controls
          const f = (_dashboard.filters || []).find(f => f.id === cmd.targetId);
          if (f && f.type === 'daterange' && cmd.value) {
            const s = document.getElementById(`f_${cmd.targetId}_start`);
            const e = document.getElementById(`f_${cmd.targetId}_end`);
            if (s) s.value = cmd.value.StartDate || '';
            if (e) e.value = cmd.value.EndDate   || '';
          }
          _refreshWidgetsForFilter(cmd.targetId);
          break;
        }
        case 'update_title': {
          if (cmd.title) {
            document.getElementById('dashboardTitle').textContent = cmd.title;
            document.title = cmd.title;
          }
          break;
        }
      }
    });

    // Update internal state to the server-returned updated dashboard
    _dashboard = updatedDashboard;
  }

  // ── Data fetch ───────────────────────────────────────────────────────────────
  async function _queryData(dataSource, params) {
    const res  = await fetch(API_BASE + '/api/widget-data/query', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ dataSource, storeId: _session.storeId, parameters: params })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Query failed');
    return data;
  }
  async function _queryDataPaged(dataSource, params, page, pageSize) {
    const res  = await fetch(API_BASE + '/api/widget-data/query-paged', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        dataSource,
        storeId:    _session.storeId,
        page:       page     || 1,
        pageSize:   pageSize || 50,
        parameters: params
      })
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Query failed');
    return result;   // { data, totalCount, page, pageSize, totalPages }
  }
  // ── GridStack layout save ──────────────────────────────────────────────────────
  function _onLayoutChange(event, items) {
    if (!_dashboard || !items) return;
    items.forEach(item => {
      const widget = (_dashboard.widgets || []).find(w => w.id === item.id);
      if (widget) {
        widget.position = { x: item.x, y: item.y, w: item.w, h: item.h };
      }
    });
    // Persist layout changes silently
    _persistLayout();
  }

  function _persistLayout() {
    if (!_dashboard) return;
    fetch(API_BASE + '/api/chat/message', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        dashboardId:      _dashboard.id,
        message:          '__layout_sync__',
        userId:           _session.userId,
        storeId:          _session.storeId,
        currentDashboard: _dashboard
      })
    }).catch(() => {}); // fire-and-forget
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────
  function _debounce(fn, ms) {
    let t;
    return function(...args) { clearTimeout(t); t = setTimeout(() => fn.apply(this, args), ms); };
  }

  function getDashboard()   { return _dashboard; }
  function getSession()     { return _session; }

  return { init, render, applyCommands, refreshAllWidgets, getDashboard, getSession };

})();
