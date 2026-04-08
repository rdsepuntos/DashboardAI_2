using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using DashboardAI.Application.DTOs;
using DashboardAI.Application.Interfaces;
using DashboardAI.Application.Mappers;
using DashboardAI.Domain.Interfaces;

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

        public GenerateDashboardHandler(
            IOpenAIService aiService,
            IDashboardRepository repository,
            IDataSourceRegistry registry)
        {
            _aiService  = aiService  ?? throw new ArgumentNullException(nameof(aiService));
            _repository = repository ?? throw new ArgumentNullException(nameof(repository));
            _registry   = registry   ?? throw new ArgumentNullException(nameof(registry));
        }

        public async Task<GenerateDashboardResponse> HandleAsync(GenerateDashboardRequest request)
        {
            if (request == null)       throw new ArgumentNullException(nameof(request));
            if (string.IsNullOrWhiteSpace(request.Prompt))  throw new ArgumentException("Prompt is required.");
            if (string.IsNullOrWhiteSpace(request.UserId))  throw new ArgumentException("UserId is required.");

            // Build data source metadata list for the AI prompt
            var dataSources = _registry.GetAll()
                .Select(DataSourceMapper.ToMetaDto)
                .ToList();

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
    }
}
