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
    }
}
