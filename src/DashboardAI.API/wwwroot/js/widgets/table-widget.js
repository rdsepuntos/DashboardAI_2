/**
 * TableWidget
 * Renders a sortable data grid with optional server-side pagination.
 * config keys: columns (comma-separated list of column names to show)
 *
 * render(el, data, config)               — static, all rows supplied
 * render(el, data, config, meta, fetch)  — paged; meta = { totalCount, page, pageSize, totalPages }
 *                                          fetch(page) re-fetches from the server
 */
const TableWidget = (() => {

  function render(el, data, config, meta, fetchFn) {
    config = config || {};
    el.innerHTML = '';

    if (!data || data.length === 0) {
      el.innerHTML = '<div class="widget-empty">No data</div>';
      return;
    }

    // Determine columns to display
    let columns;
    if (config.columns) {
      columns = config.columns.split(',').map(c => c.trim()).filter(Boolean);
    } else {
      columns = Object.keys(data[0]);
    }

    // ── Outer wrapper (flex column so footer sticks to bottom) ──────────────
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'display:flex;flex-direction:column;width:100%;height:100%;';

    // ── Scrollable table area ────────────────────────────────────────────────
    const scrollArea = document.createElement('div');
    scrollArea.style.cssText = 'flex:1;overflow:auto;';

    const table = document.createElement('table');
    table.className = 'widget-table';

    // Header
    const thead = document.createElement('thead');
    thead.innerHTML = '<tr>' + columns.map(c =>
      `<th data-col="${c}" style="cursor:pointer">${_formatHeader(c)} <span class="sort-icon">⇅</span></th>`
    ).join('') + '</tr>';
    table.appendChild(thead);

    // Body
    const tbody = document.createElement('tbody');
    _populateBody(tbody, data, columns);
    table.appendChild(tbody);

    // Client-side sort (within the current page)
    let _sortCol = null, _sortAsc = true;
    $(thead).on('click', 'th', function() {
      const col = this.dataset.col;
      if (_sortCol === col) _sortAsc = !_sortAsc;
      else { _sortCol = col; _sortAsc = true; }

      const sorted = [...data].sort((a, b) => {
        const va = a[col], vb = b[col];
        const na = parseFloat(va), nb = parseFloat(vb);
        const cmp = !isNaN(na) && !isNaN(nb) ? na - nb : String(va ?? '').localeCompare(String(vb ?? ''));
        return _sortAsc ? cmp : -cmp;
      });

      tbody.innerHTML = '';
      _populateBody(tbody, sorted, columns);
      $(thead).find('.sort-icon').text('⇅');
      $(this).find('.sort-icon').text(_sortAsc ? '↑' : '↓');
    });

    scrollArea.appendChild(table);
    wrapper.appendChild(scrollArea);

    // ── Pagination footer (only when meta supplied) ──────────────────────────
    if (meta && fetchFn && meta.totalPages > 1) {
      const footer = _buildPagination(meta, fetchFn);
      wrapper.appendChild(footer);
    } else if (meta && meta.totalCount > 0) {
      // Show row count info even on a single page
      const info = document.createElement('div');
      info.className = 'table-page-info';
      info.textContent = `${meta.totalCount.toLocaleString()} row${meta.totalCount !== 1 ? 's' : ''}`;
      wrapper.appendChild(info);
    }

    el.appendChild(wrapper);
  }

  // ── Pagination bar ─────────────────────────────────────────────────────────
  function _buildPagination(meta, fetchFn) {
    const { page, totalPages, totalCount, pageSize } = meta;
    const from = ((page - 1) * pageSize + 1).toLocaleString();
    const to   = Math.min(page * pageSize, totalCount).toLocaleString();
    const total = totalCount.toLocaleString();

    const footer = document.createElement('div');
    footer.className = 'table-pagination';

    // Generate page window (max 7 numbers shown)
    const pages = _pageWindow(page, totalPages);

    let btns = '';
    btns += `<button class="pg-btn" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>&#8592;</button>`;
    pages.forEach(p => {
      if (p === '…') {
        btns += `<span class="pg-ellipsis">…</span>`;
      } else {
        btns += `<button class="pg-btn ${p === page ? 'active' : ''}" data-page="${p}">${p}</button>`;
      }
    });
    btns += `<button class="pg-btn" data-page="${page + 1}" ${page >= totalPages ? 'disabled' : ''}>&#8594;</button>`;

    footer.innerHTML = `
      <span class="pg-info">${from}–${to} of ${total}</span>
      <div class="pg-buttons">${btns}</div>`;

    $(footer).on('click', '.pg-btn:not([disabled])', function() {
      const p = parseInt(this.dataset.page, 10);
      if (p >= 1 && p <= totalPages) fetchFn(p);
    });

    return footer;
  }

  function _pageWindow(current, total) {
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
    if (current <= 4)  return [1, 2, 3, 4, 5, '…', total];
    if (current >= total - 3) return [1, '…', total-4, total-3, total-2, total-1, total];
    return [1, '…', current - 1, current, current + 1, '…', total];
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  function _populateBody(tbody, data, columns) {
    data.forEach(row => {
      const tr = document.createElement('tr');
      tr.innerHTML = columns.map(c => `<td>${_formatCell(row[c])}</td>`).join('');
      tbody.appendChild(tr);
    });
  }

  function _formatHeader(col) {
    return col.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').trim();
  }

  function _formatCell(val) {
    if (val === null || val === undefined) return '—';
    const num = parseFloat(val);
    if (!isNaN(num) && String(val).trim() !== '') return num.toLocaleString();
    return String(val);
  }

  return { render };

})();
