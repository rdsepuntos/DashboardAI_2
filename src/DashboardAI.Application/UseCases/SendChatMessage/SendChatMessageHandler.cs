using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using DashboardAI.Application.DTOs;
using DashboardAI.Application.Interfaces;
using DashboardAI.Application.Mappers;
using DashboardAI.Domain.Interfaces;
using DashboardAI.Domain.Entities;

namespace DashboardAI.Application.UseCases.SendChatMessage
{
    public class SendChatMessageRequest
    {
        public Guid DashboardId { get; set; }
        public string Message { get; set; }
        public string UserId { get; set; }
        public int StoreId { get; set; }
        /// <summary>Current full dashboard state sent from frontend (source of truth for mutations)</summary>
        public DashboardDto CurrentDashboard { get; set; }
    }

    public class SendChatMessageResponse
    {
        public IEnumerable<ChatCommandDto> Commands { get; set; }
        public DashboardDto UpdatedDashboard { get; set; }
    }

    public class SendChatMessageHandler
    {
        private readonly IOpenAIService _aiService;
        private readonly IDashboardRepository _repository;
        private readonly IDataSourceRegistry _registry;
        private readonly IWidgetDataService _widgetDataService;

        public SendChatMessageHandler(
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

        public async Task<SendChatMessageResponse> HandleAsync(SendChatMessageRequest request)
        {
            if (request == null)       throw new ArgumentNullException(nameof(request));
            if (string.IsNullOrWhiteSpace(request.Message)) throw new ArgumentException("Message is required.");
            if (request.CurrentDashboard == null)           throw new ArgumentException("CurrentDashboard is required.");

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
                            if (vals.Count > 0 && vals.Count <= 50)
                                col.KnownValues = vals;
                        }
                        catch { /* skip — column may not exist on live DB */ }
                    }
                }
                dataSources.Add(dto);
            }

            string currentDate = DateTime.UtcNow.ToString("yyyy-MM-dd");

            // Get delta commands from GPT-5.4
            var commands = (await _aiService.SendChatMessageAsync(
                request.Message,
                request.CurrentDashboard,
                dataSources,
                currentDate)).ToList();

            // Apply commands server-side to produce the updated dashboard state
            var updated = DashboardCommandApplier.Apply(request.CurrentDashboard, commands);

            // Persist updated state
            var domain = DashboardMapper.ToDomain(updated);
            await _repository.SaveAsync(domain);

            return new SendChatMessageResponse
            {
                Commands         = commands,
                UpdatedDashboard = updated
            };
        }

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
