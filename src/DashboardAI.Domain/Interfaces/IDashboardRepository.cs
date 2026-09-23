using System;
using System.Threading.Tasks;
using DashboardAI.Domain.Entities;

namespace DashboardAI.Domain.Interfaces
{
    public interface IDashboardRepository
    {
        Task<Dashboard> GetByIdAsync(Guid dashboardId);
        Task<Dashboard[]> GetByUserAsync(string userId, int storeId);
        Task SaveAsync(Dashboard dashboard);
        Task DeleteAsync(Guid dashboardId);

        /// <summary>Returns the saved filter-state JSON for a session on a dashboard, or null if none.</summary>
        Task<string> GetFilterStateAsync(Guid dashboardId, string sessionId);

        /// <summary>Upserts the applied filter-state JSON for a session on a dashboard.</summary>
        Task SaveFilterStateAsync(Guid dashboardId, string sessionId, int storeId, string filterStateJson);
    }
}
