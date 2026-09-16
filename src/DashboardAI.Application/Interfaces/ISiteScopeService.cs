using System.Collections.Generic;
using System.Threading.Tasks;

namespace DashboardAI.Application.Interfaces
{
    public class SiteScopeItem
    {
        public int StoreId { get; set; }
        public string SiteName { get; set; }
    }

    public interface ISiteScopeService
    {
        Task<IReadOnlyList<int>> ResolveStoreIdsAsync(int storeId);
        Task<IReadOnlyList<SiteScopeItem>> ResolveSitesAsync(int storeId);
    }
}