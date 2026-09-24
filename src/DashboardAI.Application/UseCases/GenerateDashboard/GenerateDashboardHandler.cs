using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using DashboardAI.Application.DTOs;
using DashboardAI.Application.Interfaces;
using DashboardAI.Application.Mappers;
using DashboardAI.Domain.Interfaces;
using DashboardAI.Domain.Entities;
using Newtonsoft.Json;

namespace DashboardAI.Application.UseCases.GenerateDashboard
{
    public class GenerateDashboardRequest
    {
        public string Prompt { get; set; }
        public int StoreId { get; set; }
        public string UserId { get; set; }
        public string Module { get; set; }
        public string SessionId { get; set; }
    }

    public class GenerateDashboardResponse
    {
        public Guid DashboardId { get; set; }
        public DashboardDto Dashboard { get; set; }
    }

    public class GenerateDashboardHandler
    {
        private readonly IOpenAIService _aiService;
        private readonly IDashboardRepository _repository;
        private readonly IDataSourceRegistry _registry;
        private readonly IWidgetDataService _widgetDataService;
        private readonly ISiteScopeService _siteScopeService;
        private readonly IColumnCaptionService _captionService;

        public GenerateDashboardHandler(
            IOpenAIService aiService,
            IDashboardRepository repository,
            IDataSourceRegistry registry,
            IWidgetDataService widgetDataService,
            ISiteScopeService siteScopeService,
            IColumnCaptionService captionService)
        {
            _aiService          = aiService          ?? throw new ArgumentNullException(nameof(aiService));
            _repository         = repository         ?? throw new ArgumentNullException(nameof(repository));
            _registry           = registry           ?? throw new ArgumentNullException(nameof(registry));
            _widgetDataService  = widgetDataService  ?? throw new ArgumentNullException(nameof(widgetDataService));
            _siteScopeService   = siteScopeService   ?? throw new ArgumentNullException(nameof(siteScopeService));
            _captionService     = captionService     ?? throw new ArgumentNullException(nameof(captionService));
        }

        public async Task<GenerateDashboardResponse> HandleAsync(GenerateDashboardRequest request)
        {
            if (request == null)       throw new ArgumentNullException(nameof(request));
            if (string.IsNullOrWhiteSpace(request.Prompt))  throw new ArgumentException("Prompt is required.");
            if (string.IsNullOrWhiteSpace(request.UserId))  throw new ArgumentException("UserId is required.");

            if (string.IsNullOrWhiteSpace(request.SessionId))
                request.SessionId = Guid.NewGuid().ToString();

            if (string.IsNullOrWhiteSpace(request.Module))
                request.Module = InferModuleFromText(request.Prompt);

            // Build data source metadata list for the AI prompt,
            // enriched with distinct known values — ONLY for low-cardinality categorical columns.
            // Free-text columns (RiskDescription, HazardSource, RecordName, etc.) are intentionally skipped.
            var scopedStoreIds = await _siteScopeService.ResolveStoreIdsAsync(request.StoreId);
            var storeParams = new Dictionary<string, object>
            {
                { "StoreID", string.Join(",", scopedStoreIds) }
            };
            var rawSources  = _registry.GetAll().ToList();
            var dataSources = new List<DataSourceMetaDto>();
            foreach (var src in rawSources)
            {
                var dto = DataSourceMapper.ToMetaDto(src);
                await ApplyColumnCaptionsAsync(dto, request.StoreId);
                if (dto.Columns != null)
                {
                    foreach (var col in dto.Columns.Where(c =>
                        string.Equals(c.DataType, "string", StringComparison.OrdinalIgnoreCase)
                        && IsCategoricalColumn(c.Name)))
                    {
                        try
                        {
                            var vals = (await _widgetDataService.GetDistinctValuesAsync(
                                src.Name, col.Name, storeParams)).ToList();
                            Console.Error.WriteLine($"[Enrich] {src.Name}.{col.Name} => {vals.Count} values: [{string.Join(", ", vals.Take(10))}]");
                            if (vals.Count > 0 && vals.Count <= 50)
                                col.KnownValues = vals;

                            if (string.Equals(col.Name, "Status", StringComparison.OrdinalIgnoreCase))
                            {
                                var counts = await _widgetDataService.QueryAggregatedAsync(
                                    src.Name,
                                    storeParams,
                                    new AggregationRequest
                                    {
                                        GroupBy = col.Name,
                                        AggregateFunction = "count"
                                    });

                                col.StatusCounts = counts
                                    .Where(row => row.ContainsKey(col.Name) && row[ col.Name ] != null)
                                    .ToDictionary(
                                        row => row[col.Name].ToString(),
                                        row => row.ContainsKey("__value") && row["__value"] != null
                                            ? Convert.ToInt32(row["__value"])
                                            : 0,
                                        StringComparer.OrdinalIgnoreCase);
                            }
                        }
                        catch (Exception ex) { Console.Error.WriteLine($"[Enrich] FAILED {src.Name}.{col.Name}: {ex.Message}"); }
                    }
                }
                dataSources.Add(dto);
            }

            // DEBUG: log the Status column's knownValues for each source
            foreach (var ds in dataSources)
            {
                var statusCol = ds.Columns?.FirstOrDefault(c =>
                    string.Equals(c.Name, "Status", StringComparison.OrdinalIgnoreCase));
                Console.Error.WriteLine($"[Enrich] {ds.Name}.Status knownValues = [{string.Join(", ", statusCol?.KnownValues ?? new System.Collections.Generic.List<string>())}]");
            }

            string currentDate = DateTime.UtcNow.ToString("yyyy-MM-dd");

            // Ask GPT-5.4 to generate a complete dashboard layout
            var dashboardDto = await _aiService.GenerateDashboardAsync(
                request.Prompt,
                request.StoreId,
                request.UserId,
                dataSources,
                currentDate,
                request.Module,
                request.SessionId,
                scopedStoreIds.Count);

            // Multisite: surface the site on tables and add a "by Site" chart.
            ApplyMultiSiteEnhancements(dashboardDto, scopedStoreIds.Count > 1);

            // Add a filter for every categorical column in the chosen data sources.
            DashboardFilterAugmenter.EnsureCategoricalFilters(dashboardDto, _registry);

            // Map DTO → Domain entity and persist
            var dashboard = DashboardMapper.ToDomain(dashboardDto);
            await _repository.SaveAsync(dashboard);

            return new GenerateDashboardResponse
            {
                DashboardId = dashboard.Id,
                Dashboard   = dashboardDto
            };
        }

        /// <summary>
        /// Returns true for low-cardinality categorical columns that are useful for OpenAI
        /// to know distinct values of (e.g. Status, Type, Department).
        /// Excludes free-text narrative columns like RiskDescription, HazardSource, RecordName.
        /// </summary>
        private static readonly HashSet<string> _categoricalColumnNames = new HashSet<string>(
            StringComparer.OrdinalIgnoreCase)
        {
            "Status", "Type", "SubType", "HazardType", "Hazard",
            "Department", "Division", "Location", "LocationType",
            "Programme", "Checklist", "CreatedBy", "PersonResponsible", "ReportedBy"
        };

        private static bool IsCategoricalColumn(string name)
            => _categoricalColumnNames.Contains(name);

        private const string SiteColumnName = "SiteName";

        // When a store resolves to multiple sites, put the site on every table (sourced from a
        // SiteName-capable view) and add one "Records by Site" chart. For a single site the
        // column is redundant, so strip it back out.
        private void ApplyMultiSiteEnhancements(DashboardDto dashboard, bool isMultiSite)
        {
            if (dashboard?.Widgets == null || dashboard.Widgets.Count == 0) return;

            bool SourceHasSite(string dsName) =>
                !string.IsNullOrEmpty(dsName)
                && _registry.GetByName(dsName)?.Columns?.Any(c =>
                    string.Equals(c.Name, SiteColumnName, StringComparison.OrdinalIgnoreCase)) == true;

            bool IsTable(WidgetDto w) => string.Equals(w.Type, "table", StringComparison.OrdinalIgnoreCase);

            bool IsPivot(WidgetDto w) =>
                w.Config != null && w.Config.TryGetValue("pivot", out var p)
                && string.Equals(p, "true", StringComparison.OrdinalIgnoreCase);

            if (!isMultiSite)
            {
                foreach (var w in dashboard.Widgets.Where(w => IsTable(w) && w.Config != null))
                {
                    if (!w.Config.TryGetValue("columns", out var cols) || string.IsNullOrWhiteSpace(cols)) continue;
                    var kept = SplitColumns(cols)
                        .Where(c => !string.Equals(c, SiteColumnName, StringComparison.OrdinalIgnoreCase))
                        .ToList();
                    w.Config["columns"] = string.Join(",", kept);
                }
                return;
            }

            // Tables: prepend SiteName (skip pivot tables — their columns are generated dynamically).
            foreach (var w in dashboard.Widgets.Where(w => IsTable(w) && SourceHasSite(w.DataSource) && !IsPivot(w)))
            {
                w.Config = w.Config ?? new Dictionary<string, string>();
                var columns = w.Config.TryGetValue("columns", out var cols) && !string.IsNullOrWhiteSpace(cols)
                    ? SplitColumns(cols)
                    : new List<string>();
                columns = columns
                    .Where(c => !string.Equals(c, SiteColumnName, StringComparison.OrdinalIgnoreCase))
                    .ToList();
                columns.Insert(0, SiteColumnName);
                w.Config["columns"] = string.Join(",", columns);
            }

            // Site charts are left to the AI's discretion — it already sees the SiteName column
            // in the data source metadata and can group by it when the request calls for it.
        }

        private static List<string> SplitColumns(string csv)
            => csv.Split(',').Select(c => c.Trim()).Where(c => c.Length > 0).ToList();

        // Attaches account-specific display captions (from spPageFields) to columns so the
        // AI can match user wording like "ID" against the raw column name (e.g. InternalNo).
        private async Task ApplyColumnCaptionsAsync(DataSourceMetaDto dto, int storeId)
        {
            if (dto?.Columns == null || dto.Columns.Count == 0) return;
            try
            {
                var captions = await _captionService.GetCaptionsAsync(dto.Name, storeId);
                if (captions == null || captions.Count == 0) return;

                foreach (var col in dto.Columns)
                {
                    if (captions.TryGetValue(col.Name, out var caption)
                        && !string.IsNullOrWhiteSpace(caption)
                        && !string.Equals(caption, col.Name, StringComparison.OrdinalIgnoreCase))
                    {
                        col.Caption = caption;
                    }
                }
            }
            catch { /* captions are an enhancement — never fail generation over them */ }
        }

        private static string InferModuleFromText(string text)
        {
            var lower = (text ?? string.Empty).ToLowerInvariant();
            if (lower.Contains("rapid risk") || lower.Contains("rapidrisk")) return "RapidRisk";
            if (lower.Contains("hazard")) return "Hazard Report";
            if (lower.Contains("incident") || lower.Contains("injury") || lower.Contains("accident") || lower.Contains("near miss")) return "Incident";
            if (lower.Contains("inspection")) return "Inspection";
            if (lower.Contains("audit")) return "Audit";
            return null;
        }
    }
}
