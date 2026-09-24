using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Dapper;
using DashboardAI.Application.Interfaces;
using System.Data.SqlClient;

namespace DashboardAI.Infrastructure.Services
{
    public class SiteScopeService : ISiteScopeService
    {
        private readonly string _connectionString;

        public SiteScopeService(string connectionString)
            => _connectionString = connectionString ?? throw new ArgumentNullException(nameof(connectionString));

        public async Task<IReadOnlyList<int>> ResolveStoreIdsAsync(int storeId)
        {
            var sites = await ResolveSitesAsync(storeId);
            return sites.Select(site => site.StoreId).ToList().AsReadOnly();
        }

        public async Task<IReadOnlyList<SiteScopeItem>> ResolveSitesAsync(int storeId)
        {
            if (storeId <= 0) return Array.Empty<SiteScopeItem>();

            // Child sites of a multisite parent (via ParentMemberID or OmniParentID).
            // Requires the child member to have its own Store row.
            const string childSitesSql = @"
                SELECT StoreID AS StoreId, StoreName AS SiteName
                FROM
                (
                    SELECT childStore.StoreID, childStore.StoreName
                    FROM Agtech_Usermgmt.dbo.Members childMember
                    INNER JOIN Agtech_WHSMonitor.dbo.Store childStore
                        ON childStore.MemberID = childMember.MemberID
                    INNER JOIN Agtech_WHSMonitor.dbo.Store parentStore
                        ON parentStore.MemberID = childMember.ParentMemberID
                    WHERE childMember.ParentMemberID > 0
                      AND parentStore.StoreID = @StoreId

                    UNION

                    SELECT childStore.StoreID, childStore.StoreName
                    FROM Agtech_Usermgmt.dbo.Members childMember
                    INNER JOIN Agtech_WHSMonitor.dbo.Store childStore
                        ON childStore.MemberID = childMember.MemberID
                    INNER JOIN Agtech_WHSMonitor.dbo.Store omniParentStore
                        ON omniParentStore.MemberID = childMember.OmniParentID
                    WHERE childMember.OmniParentID > 0
                      AND omniParentStore.StoreID = @StoreId
                ) childStores
                ORDER BY StoreName, StoreID;";

            const string currentSiteSql = @"
                SELECT StoreID AS StoreId, StoreName AS SiteName
                FROM Agtech_WHSMonitor.dbo.Store
                WHERE StoreID = @StoreId;";

            using (var connection = new SqlConnection(_connectionString))
            {
                var childSites = (await connection.QueryAsync<SiteScopeItem>(
                    childSitesSql, new { StoreId = storeId })).ToList();

                // Multisite parent → return ONLY the child sites (exclude the parent's own store).
                if (childSites.Count > 0)
                    return childSites.GroupBy(s => s.StoreId).Select(g => g.First()).ToList().AsReadOnly();

                // Single site → scope to the store itself.
                var currentSite = (await connection.QueryAsync<SiteScopeItem>(
                    currentSiteSql, new { StoreId = storeId })).ToList();

                return currentSite.Count > 0
                    ? currentSite.AsReadOnly()
                    : new List<SiteScopeItem> { new SiteScopeItem { StoreId = storeId } }.AsReadOnly();
            }
        }
    }
}