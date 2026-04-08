using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using DashboardAI.Application.DTOs;
using DashboardAI.Application.Interfaces;
using DashboardAI.Application.Mappers;
using DashboardAI.Domain.Interfaces;

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

        public SendChatMessageHandler(
            IOpenAIService aiService,
            IDashboardRepository repository,
            IDataSourceRegistry registry)
        {
            _aiService  = aiService  ?? throw new ArgumentNullException(nameof(aiService));
            _repository = repository ?? throw new ArgumentNullException(nameof(repository));
            _registry   = registry   ?? throw new ArgumentNullException(nameof(registry));
        }

        public async Task<SendChatMessageResponse> HandleAsync(SendChatMessageRequest request)
        {
            if (request == null)       throw new ArgumentNullException(nameof(request));
            if (string.IsNullOrWhiteSpace(request.Message)) throw new ArgumentException("Message is required.");
            if (request.CurrentDashboard == null)           throw new ArgumentException("CurrentDashboard is required.");

            var dataSources = _registry.GetAll()
                .Select(DataSourceMapper.ToMetaDto)
                .ToList();

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
    }
}
