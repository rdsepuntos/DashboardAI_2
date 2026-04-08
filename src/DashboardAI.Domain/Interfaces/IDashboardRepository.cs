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
    }
}
