using System;
using System.Collections.Generic;
using System.Linq;
using DashboardAI.Application.DTOs;
using DashboardAI.Domain.Interfaces;

namespace DashboardAI.Application.Mappers
{
    /// <summary>
    /// Hard rule: a "TemplateName" filter sourced from AID_TemplateList lists every template
    /// across ALL sites. On a normal register/module dashboard we force it into a site-scoped
    /// "Checklist" dropdown bound to the dashboard's own register view instead. Genuine template
    /// pivots (AID_TemplateResponses) keep the TemplateName picker.
    /// </summary>
    public static class TemplateFilterNormalizer
    {
        private const string TemplateListSource = "AID_TemplateList";
        private const string TemplateResponses  = "AID_TemplateResponses";
        private const string ChecklistColumn    = "Checklist";

        /// <summary>Rewrites template filters on a full dashboard DTO.</summary>
        public static void NormalizeDashboard(DashboardDto dashboard, IDataSourceRegistry registry)
        {
            if (dashboard?.Filters == null || dashboard.Filters.Count == 0) return;
            if (HasTemplatePivot(dashboard.Widgets)) return;

            var source = FindChecklistSource(dashboard.Widgets, registry);
            foreach (var f in dashboard.Filters)
                if (IsTemplateFilter(f)) RewriteToChecklist(f, source);

            DedupeChecklistFilters(dashboard);
        }

        /// <summary>
        /// Rewrites template filters carried in chat delta commands before they are applied,
        /// so both the returned commands and the persisted dashboard use Checklist.
        /// </summary>
        public static void NormalizeCommands(
            IEnumerable<ChatCommandDto> commands, DashboardDto currentDashboard, IDataSourceRegistry registry)
        {
            if (commands == null) return;

            var widgets = new List<WidgetDto>(currentDashboard?.Widgets ?? new List<WidgetDto>());
            foreach (var c in commands)
                if (c?.Widget != null) widgets.Add(c.Widget);

            if (HasTemplatePivot(widgets)) return;

            var source = FindChecklistSource(widgets, registry);
            foreach (var c in commands)
                if (c?.Filter != null && IsTemplateFilter(c.Filter))
                    RewriteToChecklist(c.Filter, source);
        }

        private static bool HasTemplatePivot(IEnumerable<WidgetDto> widgets) =>
            (widgets ?? Enumerable.Empty<WidgetDto>())
                .Any(w => string.Equals(w?.DataSource, TemplateResponses, StringComparison.OrdinalIgnoreCase));

        private static bool IsTemplateFilter(FilterDto f)
        {
            if (f == null) return false;
            return string.Equals(f.Param,         "TemplateName",     StringComparison.OrdinalIgnoreCase)
                || string.Equals(f.ValueKey,      "TemplateName",     StringComparison.OrdinalIgnoreCase)
                || string.Equals(f.OptionsSource, TemplateListSource, StringComparison.OrdinalIgnoreCase);
        }

        // First widget data source (other than AID_TemplateList) that exposes a Checklist column.
        private static string FindChecklistSource(IEnumerable<WidgetDto> widgets, IDataSourceRegistry registry)
        {
            foreach (var w in widgets ?? Enumerable.Empty<WidgetDto>())
            {
                var ds = w?.DataSource;
                if (string.IsNullOrWhiteSpace(ds)) continue;
                if (string.Equals(ds, TemplateListSource, StringComparison.OrdinalIgnoreCase)) continue;

                var def = registry?.GetByName(ds);
                if (def?.Columns != null &&
                    def.Columns.Any(c => string.Equals(c?.Name, ChecklistColumn, StringComparison.OrdinalIgnoreCase)))
                    return ds;
            }
            return null;
        }

        private static void RewriteToChecklist(FilterDto f, string source)
        {
            f.Type     = "dropdown";
            f.Label    = ChecklistColumn;
            f.Param    = ChecklistColumn;
            f.ValueKey = ChecklistColumn;
            f.LabelKey = ChecklistColumn;
            if (!string.IsNullOrWhiteSpace(source))
                f.OptionsSource = source;
            else if (string.Equals(f.OptionsSource, TemplateListSource, StringComparison.OrdinalIgnoreCase))
                f.OptionsSource = null; // never fall back to the all-sites template list
        }

        // Keep only the first Checklist filter; drop extras and unwire them from widgets.
        private static void DedupeChecklistFilters(DashboardDto dashboard)
        {
            var checklistFilters = dashboard.Filters
                .Where(f => f != null && !f.IsLocked
                    && string.Equals(f.Param, ChecklistColumn, StringComparison.OrdinalIgnoreCase))
                .ToList();
            if (checklistFilters.Count <= 1) return;

            var removeIds = checklistFilters.Skip(1).Select(f => f.Id)
                .Where(id => !string.IsNullOrWhiteSpace(id))
                .ToHashSet(StringComparer.OrdinalIgnoreCase);

            dashboard.Filters.RemoveAll(f => f != null && removeIds.Contains(f.Id));
            foreach (var w in dashboard.Widgets ?? Enumerable.Empty<WidgetDto>())
                w.AppliesFilters?.RemoveAll(id => removeIds.Contains(id));
        }
    }
}
