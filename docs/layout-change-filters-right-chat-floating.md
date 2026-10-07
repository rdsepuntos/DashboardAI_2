# Dashboard Layout Change — Filters Right, Chat Floating Bottom

## Goal
Rework the dashboard shell so it matches the new design:

- **Top bar (header) removed** — the dark app header with logo is dropped.
- **Title row** added at the top of the canvas: a pin icon, the dashboard
  **title** (editable via a pencil icon), and **Share / Print** action icons on the right.
- **Filters** move from the horizontal bar under the top bar to a **vertical panel docked on the right side** of the page.
- **Chat** moves from the right docked sidebar to a **floating input bar centred at the bottom** of the canvas.

## Current Layout (before)

```
┌─────────────────────────────────────────────┐
│ Top bar                                       │
├─────────────────────────────────────────────┤
│ Filter bar (horizontal)                       │
├──────────────────────────────┬──────────────┤
│ Canvas (widgets)             │ Chat sidebar  │
│                              │ (docked right)│
└──────────────────────────────┴──────────────┘
```

Files involved:
- [publish/wwwroot/dashboard.html](../publish/wwwroot/dashboard.html)
- [publish/wwwroot/css/dashboard.css](../publish/wwwroot/css/dashboard.css)
- [publish/wwwroot/js/chat.js](../publish/wwwroot/js/chat.js)
- [publish/wwwroot/js/dashboard-engine.js](../publish/wwwroot/js/dashboard-engine.js)

## Target Layout (after)

```
┌──────────────────────────────────────────────────┐
│ 📌 Site 1 Worker Dashboard ✎        [Share][Print] │  ← title row (no header)
├───────────────────────────────────┬──────────────┤
│ Canvas (widgets)                  │ FILTERS       │
│                                   │ (right panel) │
│                                   │  • Site       │
│      ┌───────────────────────┐    │  • Status     │
│      │  Floating chat bar    │    │  • Location   │
│      └───────────────────────┘    │  • Person     │
└───────────────────────────────────┴──────────────┘
```

### Header removed & title row (top)
- Remove the existing `.topbar` header (logo + chat toggle button).
- Add a lightweight **title row** at the top of the canvas area:
  - **Pin icon** on the far left.
  - **Dashboard title** text (`#dashboardTitle`), e.g. "Site 1 Worker Dashboard".
  - **Pencil / edit icon** next to the title to rename the dashboard inline.
  - **Share** and **Print** icon buttons on the far right (replacing the old
    `💬` chat toggle). Share = export/send link; Print = print / export the view.
- Light theme look per the mock: white background, dark title text, subtle icon buttons.

### Filter panel (right)
- Fixed-width vertical panel docked to the right edge (replaces the horizontal `#filterBar`).
- Header row: `FILTERS` title + `Clear All` action + collapse chevron.
- Each filter group stacked vertically with a label, optional search box, and
  checkbox/list options (Site, Status, Location, Person Responsible per the mock).
- Scrolls independently when the list is long.
- Collapsible: chevron collapses the panel to a narrow strip / icon.

### Floating chat (bottom)
- Detach the chat from the docked sidebar; render as a **floating pill** anchored
  bottom-centre over the canvas.
- Contains: short label ("Edit your dashboard data"), text input with placeholder
  (e.g. "Eg. Show Oct data only or Add table for attendance"), mic button, and a
  circular send button.
- Expands upward into a message/history popover when there is a conversation.
- Stays above widgets (`position: fixed` / high `z-index`), does not overlap the
  right filter panel.

## Implementation Notes

### HTML ([dashboard.html](../publish/wwwroot/dashboard.html))
1. Remove the `.topbar` header block (logo + chat toggle button).
2. Add a `.dash-titlebar` row at the top of `.canvas-area`: pin icon,
   `#dashboardTitle` text, edit (pencil) button, and `.title-actions` with
   Share and Print icon buttons.
3. Remove the horizontal `#filterBar` under the top bar.
4. In `.main-layout`, reorder so `canvas-area` is first and add a
   `.filter-panel` (`#filterBar`) **after** the canvas on the right.
5. Replace the `.chat-sidebar` aside with a `.chat-floating` container
   (floating bar + collapsible message panel).

### CSS ([dashboard.css](../publish/wwwroot/css/dashboard.css))
1. Remove `.topbar` styles; add `.dash-titlebar` (title text, edit pencil,
   `.title-actions` icon buttons for Share/Print) and `.btn-icon` light-theme look.
2. Delete / repurpose `.filter-bar` horizontal styles into a vertical
   `.filter-panel` (fixed width, `flex-direction: column`, right border).
3. Add `.filter-group`, `.filter-search`, `.filter-option` (checkbox rows).
4. Remove docked `.chat-sidebar` width behaviour; add `.chat-floating`
   (`position: fixed; bottom; left/transform` centring; pill shape; shadow).
4. Add a `.chat-panel` popover for the message history above the pill.
5. Update layout vars: drop `--filterbar-h`, add `--filter-w`.

### JS
- [dashboard-engine.js](../publish/wwwroot/js/dashboard-engine.js): update the
  filter renderer to build vertical groups into `.filter-panel` instead of the
  horizontal bar; wire `Clear All` and collapse toggle.
- [chat.js](../publish/wwwroot/js/chat.js): point the chat UI at the new floating
  elements; toggle the history popover on focus/submit instead of showing a
  docked sidebar.

## Acceptance Criteria
- [ ] Old dark `.topbar` header is removed.
- [ ] Title row shows pin icon, editable title (pencil), and Share/Print icons.
- [ ] Filters render as a vertical panel on the right with Site/Status/Location/Person groups.
- [ ] `Clear All` resets all filters; collapse chevron hides/shows the panel.
- [ ] Chat is a floating bottom-centre bar with input, mic, and send button.
- [ ] Submitting a message opens the history popover and applies dashboard changes.
- [ ] No horizontal filter bar remains; canvas uses the freed vertical space.
- [ ] Layout is responsive (panel/chat stack or collapse on narrow screens).
```