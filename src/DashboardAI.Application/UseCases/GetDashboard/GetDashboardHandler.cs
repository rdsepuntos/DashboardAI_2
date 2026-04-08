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

        public GetDashboardHandler(IDashboardRepository repository)
            => _repository = repository ?? throw new ArgumentNullException(nameof(repository));

        public async Task<DashboardDto> HandleAsync(GetDashboardRequest request)
        {
            if (request == null) throw new ArgumentNullException(nameof(request));

            var dashboard = await _repository.GetByIdAsync(request.DashboardId);
            if (dashboard == null)
                throw new KeyNotFoundException($"Dashboard {request.DashboardId} not found.");

            return DashboardMapper.ToDto(dashboard);
        }
    }
}
