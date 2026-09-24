using System;
using System.Collections.Generic;
using System.Linq;
using DashboardAI.Application.DTOs;
using DashboardAI.Domain.Interfaces;

namespace DashboardAI.Application.Mappers
{
    /// <summary>
    /// Ensures a dashboard exposes a filter for every categorical column present in
    /// its widgets' data sources, so the filter sidebar shows all usable filter
    /// fields — not just the ones the AI happened to create.
    /// </summary>
    public static class DashboardFilterAugmenter
    {
        // String columns that make sensible dropdown filters (low-cardinality categoricals).
        private static readonly HashSet<string> _categoricalColumns = new HashSet<string>(
            StringComparer.OrdinalIgnoreCase)
        {
            "Status", "Type", "SubType", "HazardType", "Hazard",
            "Department", "Division", "Location", "LocationType",
            "Programme", "Checklist", "CreatedBy", "PersonResponsible", "ReportedBy",
            "ActionStatus", "Priority", "Category", "Responsible", "LocationName", "ModuleType",
            "Section", "RecordTitle", "TemplateName"
        };

        public static void EnsureCategoricalFilters(DashboardDto dashboard, IDataSourceRegistry registry)
        {
            if (dashboard == null || registry == null) return;

            dashboard.Filters = dashboard.Filters ?? new List<FilterDto>();
            var widgets = dashboard.Widgets ?? new List<WidgetDto>();

            // Columns already covered by an existing filter (by param or valueKey).
            var covered = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var f in dashboard.Filters)
            {
                if (!string.IsNullOrWhiteSpace(f?.Param))    covered.Add(f.Param);
                if (!string.IsNullOrWhiteSpace(f?.ValueKey)) covered.Add(f.ValueKey);
            }
            var existingIds = new HashSet<string>(
                dashboard.Filters.Where(f => f?.Id != null).Select(f => f.Id),
                StringComparer.OrdinalIgnoreCase);

            // Distinct data sources actually used by widgets, in first-seen order.
            var dataSources = widgets
                .Select(w => w?.DataSource)
                .Where(ds => !string.IsNullOrWhiteSpace(ds))
                .Distinct(StringComparer.OrdinalIgnoreCase);

            var added = new List<FilterDto>();
            var hasDateRange = dashboard.Filters.Any(f =>
                string.Equals(f?.Type, "daterange", StringComparison.OrdinalIgnoreCase));

            foreach (var dsName in dataSources)
            {
                var def = registry.GetByName(dsName);
                if (def?.Columns == null) continue;

                foreach (var col in def.Columns)
                {
                    if (col?.Name == null) continue;

                    var isString = string.Equals(col.DataType, "string", StringComparison.OrdinalIgnoreCase);
                    if (isString && _categoricalColumns.Contains(col.Name) && !covered.Contains(col.Name))
                    {
                        var id = "f_" + col.Name.ToLowerInvariant();
                        if (existingIds.Contains(id)) continue;

                        added.Add(new FilterDto
                        {
                            Id            = id,
                            Type          = "dropdown",
                            Label         = Humanize(col.Name),
                            Param         = col.Name,
                            OptionsSource = dsName,
                            ValueKey      = col.Name,
                            LabelKey      = col.Name,
                            IsLocked      = false,
                            DefaultValue  = ""
                        });
                        covered.Add(col.Name);
                        existingIds.Add(id);
                    }

                    // Add a single date-range filter if the dashboard has none yet.
                    if (!hasDateRange
                        && string.Equals(col.DataType, "date", StringComparison.OrdinalIgnoreCase))
                    {
                        added.Add(new FilterDto
                        {
                            Id           = "f_daterange",
                            Type         = "daterange",
                            Label        = "Date Range",
                            Param        = "StartDate",
                            IsLocked     = false,
                            DefaultValue = ""
                        });
                        hasDateRange = true;
                    }
                }
            }

            if (added.Count == 0) return;

            dashboard.Filters.AddRange(added);

            // Wire the new (non-locked) filters into every widget so they actually apply.
            var newIds = added.Where(f => !f.IsLocked).Select(f => f.Id).ToList();
            foreach (var w in widgets)
            {
                if (w.AppliesFilters == null) w.AppliesFilters = new List<string>();
                foreach (var id in newIds)
                {
                    if (!w.AppliesFilters.Contains(id, StringComparer.OrdinalIgnoreCase))
                        w.AppliesFilters.Add(id);
                }
            }
        }

        private static string Humanize(string columnName)
        {
            if (string.IsNullOrWhiteSpace(columnName)) return columnName;
            // Insert a space before each interior capital: "PersonResponsible" -> "Person Responsible".
            var chars = new List<char>(columnName.Length + 4);
            for (int i = 0; i < columnName.Length; i++)
            {
                var c = columnName[i];
                if (i > 0 && char.IsUpper(c) && !char.IsUpper(columnName[i - 1]))
                    chars.Add(' ');
                chars.Add(c);
            }
            return new string(chars.ToArray());
        }
    }
}
