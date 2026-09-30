using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using DashboardAI.Application.DTOs;
using DashboardAI.Application.Mappers;
using DashboardAI.Domain.Interfaces;

namespace DashboardAI.Application.UseCases.GetDashboard
{
    public class GetDashboardRequest
    {
        public Guid DashboardId { get; set; }
        public string UserId { get; set; }
        public int StoreId { get; set; }
    }

    public class GetDashboardHandler
    {
        private readonly IDashboardRepository _repository;
        private readonly IDataSourceRegistry _registry;

        public GetDashboardHandler(IDashboardRepository repository, IDataSourceRegistry registry)
        {
            _repository = repository ?? throw new ArgumentNullException(nameof(repository));
            _registry   = registry   ?? throw new ArgumentNullException(nameof(registry));
        }

        public async Task<DashboardDto> HandleAsync(GetDashboardRequest request)
        {
            if (request == null) throw new ArgumentNullException(nameof(request));

            var dashboard = await _repository.GetByIdAsync(request.DashboardId);
            if (dashboard == null)
                throw new KeyNotFoundException($"Dashboard {request.DashboardId} not found.");

            var dto = DashboardMapper.ToDto(dashboard);
            // Backfill filters for every categorical column so the sidebar shows all
            // usable filter fields, even on dashboards created before this existed.
            DashboardFilterAugmenter.EnsureCategoricalFilters(dto, _registry);
            return dto;
        }

        // Returns every dashboard the user owns for a store — no dashboard id required.
        public async Task<List<DashboardDto>> HandleAllAsync(string userId, int storeId)
        {
            if (string.IsNullOrWhiteSpace(userId))
                throw new ArgumentException("UserId is required.", nameof(userId));

            var dashboards = await _repository.GetByUserAsync(userId, storeId);
            var result = new List<DashboardDto>();
            foreach (var dashboard in dashboards ?? Array.Empty<Domain.Entities.Dashboard>())
            {
                var dto = DashboardMapper.ToDto(dashboard);
                DashboardFilterAugmenter.EnsureCategoricalFilters(dto, _registry);
                result.Add(dto);
            }
            return result;
        }
    }
}
