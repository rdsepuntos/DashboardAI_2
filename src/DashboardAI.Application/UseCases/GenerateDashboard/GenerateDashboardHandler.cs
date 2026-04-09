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

        public GenerateDashboardHandler(
            IOpenAIService aiService,
            IDashboardRepository repository,
            IDataSourceRegistry registry,
            IWidgetDataService widgetDataService)
        {
            _aiService          = aiService          ?? throw new ArgumentNullException(nameof(aiService));
            _repository         = repository         ?? throw new ArgumentNullException(nameof(repository));
            _registry           = registry           ?? throw new ArgumentNullException(nameof(registry));
            _widgetDataService  = widgetDataService  ?? throw new ArgumentNullException(nameof(widgetDataService));
        }

        public async Task<GenerateDashboardResponse> HandleAsync(GenerateDashboardRequest request)
        {
            if (request == null)       throw new ArgumentNullException(nameof(request));
            if (string.IsNullOrWhiteSpace(request.Prompt))  throw new ArgumentException("Prompt is required.");
            if (string.IsNullOrWhiteSpace(request.UserId))  throw new ArgumentException("UserId is required.");

            // Build data source metadata list for the AI prompt,
            // enriched with distinct known values — ONLY for low-cardinality categorical columns.
            // Free-text columns (RiskDescription, HazardSource, RecordName, etc.) are intentionally skipped.
            var storeParams = new Dictionary<string, object> { { "StoreId", request.StoreId } };
            var rawSources  = _registry.GetAll().ToList();
            var dataSources = new List<DataSourceMetaDto>();
            foreach (var src in rawSources)
            {
                var dto = DataSourceMapper.ToMetaDto(src);
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
                currentDate);

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
    }
}
