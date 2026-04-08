using System;
using System.Collections.Generic;
using System.Data;
using System.Data.SqlClient;
using System.Linq;
using System.Threading.Tasks;
using Dapper;
using DashboardAI.Domain.Entities;
using DashboardAI.Domain.Interfaces;
using Newtonsoft.Json;

namespace DashboardAI.Infrastructure.Repositories
{
    public class DashboardRepository : IDashboardRepository
    {
        private readonly string _connectionString;

        public DashboardRepository(string connectionString)
            => _connectionString = connectionString ?? throw new ArgumentNullException(nameof(connectionString));

        public async Task<Dashboard> GetByIdAsync(Guid dashboardId)
        {
            using (var conn = new SqlConnection(_connectionString))
            {
                const string sql = @"
                    SELECT Id, Title, StoreId, UserId, OriginalPrompt, LayoutJson, CreatedAt, UpdatedAt
                    FROM   DashboardLayouts
                    WHERE  Id = @Id";

                var row = await conn.QueryFirstOrDefaultAsync<DashboardRow>(sql, new { Id = dashboardId });
                return row == null ? null : Deserialize(row);
            }
        }

        public async Task<Dashboard[]> GetByUserAsync(string userId, int storeId)
        {
            using (var conn = new SqlConnection(_connectionString))
            {
                const string sql = @"
                    SELECT Id, Title, StoreId, UserId, OriginalPrompt, LayoutJson, CreatedAt, UpdatedAt
                    FROM   DashboardLayouts
                    WHERE  UserId = @UserId AND StoreId = @StoreId
                    ORDER  BY UpdatedAt DESC";

                var rows = await conn.QueryAsync<DashboardRow>(sql, new { UserId = userId, StoreId = storeId });
                return rows.Select(Deserialize).ToArray();
            }
        }

        public async Task SaveAsync(Dashboard dashboard)
        {
            using (var conn = new SqlConnection(_connectionString))
            {
                var layout = new
                {
                    Widgets = dashboard.Widgets.Select(Application.Mappers.WidgetMapper.ToDto).ToList(),
                    Filters = dashboard.Filters.Select(Application.Mappers.FilterMapper.ToDto).ToList()
                };

                const string sql = @"
                    MERGE DashboardLayouts AS target
                    USING (SELECT @Id AS Id) AS source ON target.Id = source.Id
                    WHEN MATCHED THEN
                        UPDATE SET Title = @Title, LayoutJson = @LayoutJson, UpdatedAt = @UpdatedAt
                    WHEN NOT MATCHED THEN
                        INSERT (Id, Title, StoreId, UserId, OriginalPrompt, LayoutJson, CreatedAt, UpdatedAt)
                        VALUES (@Id, @Title, @StoreId, @UserId, @OriginalPrompt, @LayoutJson, @CreatedAt, @UpdatedAt);";

                await conn.ExecuteAsync(sql, new
                {
                    Id             = dashboard.Id,
                    Title          = dashboard.Title,
                    StoreId        = dashboard.StoreId,
                    UserId         = dashboard.UserId,
                    OriginalPrompt = dashboard.OriginalPrompt,
                    LayoutJson     = JsonConvert.SerializeObject(layout),
                    CreatedAt      = dashboard.CreatedAt,
                    UpdatedAt      = dashboard.UpdatedAt
                });
            }
        }

        public async Task DeleteAsync(Guid dashboardId)
        {
            using (var conn = new SqlConnection(_connectionString))
            {
                await conn.ExecuteAsync(
                    "DELETE FROM DashboardLayouts WHERE Id = @Id",
                    new { Id = dashboardId });
            }
        }

        // ─────────────────────────────────────────────────────────────────────
        private Dashboard Deserialize(DashboardRow row)
        {
            var layout = string.IsNullOrWhiteSpace(row.LayoutJson)
                ? new LayoutPayload()
                : JsonConvert.DeserializeObject<LayoutPayload>(row.LayoutJson);

            // Reconstruct via Application mapper (avoids duplicating mapping logic here)
            // We use the DTO path: deserialize → map to domain
            var dto = new Application.DTOs.DashboardDto
            {
                Id             = row.Id,
                Title          = row.Title,
                StoreId        = row.StoreId,
                UserId         = row.UserId,
                OriginalPrompt = row.OriginalPrompt,
                Widgets        = layout.Widgets ?? new List<Application.DTOs.WidgetDto>(),
                Filters        = layout.Filters ?? new List<Application.DTOs.FilterDto>()
            };

            return Application.Mappers.DashboardMapper.ToDomain(dto);
        }

        private class DashboardRow
        {
            public Guid Id { get; set; }
            public string Title { get; set; }
            public int StoreId { get; set; }
            public string UserId { get; set; }
            public string OriginalPrompt { get; set; }
            public string LayoutJson { get; set; }
            public DateTime CreatedAt { get; set; }
            public DateTime UpdatedAt { get; set; }
        }

        private class LayoutPayload
        {
            public List<Application.DTOs.WidgetDto> Widgets { get; set; }
            public List<Application.DTOs.FilterDto> Filters { get; set; }
        }
    }
}
