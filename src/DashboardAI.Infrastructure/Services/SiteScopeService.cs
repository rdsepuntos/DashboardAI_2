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

            const string sql = @"
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

                    UNION

                    -- Current store itself: only when it is NOT a multisite parent
                    -- (a multi-member's own StoreID must be excluded from its child scope)
                    SELECT currentStore.StoreID, currentStore.StoreName
                    FROM Agtech_WHSMonitor.dbo.Store currentStore
                    WHERE currentStore.StoreID = @StoreId
                      AND NOT EXISTS (
                          SELECT 1
                          FROM Agtech_Usermgmt.dbo.Members childMember
                          INNER JOIN Agtech_WHSMonitor.dbo.Store parentStore
                              ON parentStore.MemberID = childMember.ParentMemberID
                          WHERE childMember.ParentMemberID > 0
                            AND parentStore.StoreID = @StoreId
                      )
                      AND NOT EXISTS (
                          SELECT 1
                          FROM Agtech_Usermgmt.dbo.Members childMember
                          INNER JOIN Agtech_WHSMonitor.dbo.Store omniParentStore
                              ON omniParentStore.MemberID = childMember.OmniParentID
                          WHERE childMember.OmniParentID > 0
                            AND omniParentStore.StoreID = @StoreId
                      )
                ) scopedStores
                ORDER BY StoreName, StoreID;";

            using (var connection = new SqlConnection(_connectionString))
            {
                var sites = await connection.QueryAsync<SiteScopeItem>(sql, new { StoreId = storeId });
                return sites.GroupBy(site => site.StoreId).Select(group => group.First()).ToList().AsReadOnly();
            }
        }
    }
}