using System;
using System.Collections.Generic;
using System.Linq;
using DashboardAI.Application.DTOs;

namespace DashboardAI.Application.Mappers
{
    /// <summary>
    /// Applies a list of AI-generated chat commands to a DashboardDto,
    /// producing a new updated DashboardDto (immutable-style).
    /// </summary>
    public static class DashboardCommandApplier
    {
        public static DashboardDto Apply(DashboardDto dashboard, IEnumerable<ChatCommandDto> commands)
        {
            // Work on shallow clone lists so original is not mutated
            var widgets = dashboard.Widgets?.ToList() ?? new List<WidgetDto>();
            var filters = dashboard.Filters?.ToList() ?? new List<FilterDto>();
            string title = dashboard.Title;

            foreach (var cmd in commands)
            {
                switch (cmd.Action?.ToLower())
                {
                    case "add_widget":
                        if (cmd.Widget != null)
                        {
                            widgets.RemoveAll(w => w.Id == cmd.Widget.Id); // avoid duplicates
                            widgets.Add(cmd.Widget);
                        }
                        break;

                    case "update_widget":
                        if (cmd.Widget != null)
                        {
                            var idx = widgets.FindIndex(w => w.Id == cmd.Widget.Id);
                            if (idx >= 0) widgets[idx] = cmd.Widget;
                        }
                        break;

                    case "remove_widget":
                        widgets.RemoveAll(w => w.Id == cmd.TargetId);
                        break;

                    case "add_filter":
                        if (cmd.Filter != null)
                        {
                            filters.RemoveAll(f => f.Id == cmd.Filter.Id);
                            filters.Add(cmd.Filter);
                        }
                        break;

                    case "update_filter":
                        if (cmd.Filter != null)
                        {
                            var idx = filters.FindIndex(f => f.Id == cmd.Filter.Id);
                            if (idx >= 0) filters[idx] = cmd.Filter;
                        }
                        break;

                    case "remove_filter":
                        filters.RemoveAll(f => f.Id == cmd.TargetId);
                        break;

                    case "update_title":
                        if (!string.IsNullOrWhiteSpace(cmd.Title))
                            title = cmd.Title;
                        break;

                    // update_filter_value is handled client-side only (UI state, not persisted layout)
                }
            }

            // Ensure every non-locked filter is wired into each widget's AppliesFilters.
            // Chat commands (e.g. add_filter) don't set this, so without it a newly added
            // filter renders in the bar but never reaches the widget queries.
            EnsureAppliesFilters(widgets, filters);

            return new DashboardDto
            {
                Id             = dashboard.Id,
                Title          = title,
                StoreId        = dashboard.StoreId,
                UserId         = dashboard.UserId,
                OriginalPrompt = dashboard.OriginalPrompt,
                CreatedAt      = dashboard.CreatedAt,
                UpdatedAt      = DateTime.UtcNow,
                Widgets        = widgets,
                Filters        = filters
            };
        }

        private static void EnsureAppliesFilters(List<WidgetDto> widgets, List<FilterDto> filters)
        {
            var nonLocked = filters
                .Where(f => f != null && !f.IsLocked && !string.IsNullOrWhiteSpace(f.Id))
                .Select(f => f.Id)
                .ToList();
            if (nonLocked.Count == 0) return;

            var validIds = new HashSet<string>(
                filters.Where(f => f?.Id != null).Select(f => f.Id),
                StringComparer.OrdinalIgnoreCase);

            foreach (var w in widgets)
            {
                if (w.AppliesFilters == null)
                    w.AppliesFilters = new List<string>();

                // Drop references to filters that no longer exist (e.g. after remove_filter).
                w.AppliesFilters.RemoveAll(id => id != null && !validIds.Contains(id));

                foreach (var filterId in nonLocked)
                {
                    if (!w.AppliesFilters.Contains(filterId, StringComparer.OrdinalIgnoreCase))
                        w.AppliesFilters.Add(filterId);
                }
            }
        }
    }
}
