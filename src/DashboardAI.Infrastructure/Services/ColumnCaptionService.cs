using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Data;
using System.Data.SqlClient;
using System.Threading.Tasks;
using Dapper;
using DashboardAI.Domain.Interfaces;

namespace DashboardAI.Infrastructure.Services
{
    /// <summary>
    /// Resolves per-account column captions by executing spPageFields for the store's
    /// owning member. Results are cached per (member, data source) for the app lifetime.
    /// </summary>
    public class ColumnCaptionService : IColumnCaptionService
    {
        private static readonly IReadOnlyDictionary<string, string> Empty =
            new Dictionary<string, string>(0);

        private readonly string _connectionString;
        private readonly PageFieldOptions _options;
        private readonly ConcurrentDictionary<string, IReadOnlyDictionary<string, string>> _cache
            = new ConcurrentDictionary<string, IReadOnlyDictionary<string, string>>(StringComparer.OrdinalIgnoreCase);

        public ColumnCaptionService(string connectionString, PageFieldOptions options)
        {
            _connectionString = connectionString ?? throw new ArgumentNullException(nameof(connectionString));
            _options = options ?? throw new ArgumentNullException(nameof(options));
        }

        public async Task<IReadOnlyDictionary<string, string>> GetCaptionsAsync(string dataSourceName, int storeId)
        {
            if (string.IsNullOrWhiteSpace(dataSourceName) || storeId <= 0)
                return Empty;

            if (_options.Mappings == null ||
                !_options.Mappings.TryGetValue(dataSourceName, out var mapping) || mapping == null)
                return Empty;

            var parentPageId = mapping.ParentPageId ?? _options.DefaultParentPageId;
            var ucPageId     = mapping.UCPageId ?? _options.DefaultUCPageId;
            if (parentPageId <= 0 || ucPageId <= 0)
                return Empty;

            try
            {
                using (var conn = new SqlConnection(_connectionString))
                {
                    var memberId = await ResolveMemberIdAsync(conn, storeId);
                    if (memberId <= 0)
                        return Empty;

                    var cacheKey = memberId + "|" + dataSourceName;
                    if (_cache.TryGetValue(cacheKey, out var cached))
                        return cached;

                    var captions = await LoadCaptionsAsync(conn, mapping, parentPageId, ucPageId, memberId);
                    _cache[cacheKey] = captions;
                    return captions;
                }
            }
            catch (Exception ex)
            {
                // Captions are a display enhancement — never fail the data request over them.
                Console.Error.WriteLine($"[ColumnCaptions] '{dataSourceName}' store {storeId}: {ex.Message}");
                return Empty;
            }
        }

        private static async Task<int> ResolveMemberIdAsync(SqlConnection conn, int storeId)
        {
            const string sql =
                "SELECT TOP 1 MemberID FROM Agtech_WHSMonitor.dbo.Store WHERE StoreID = @StoreId";
            return await conn.ExecuteScalarAsync<int?>(sql, new { StoreId = storeId }) ?? 0;
        }

        public async Task<CaptionDiagnostics> GetDiagnosticsAsync(string dataSourceName, int storeId)
        {
            var diag = new CaptionDiagnostics
            {
                Procedure = _options.ProcedureName,
                Captions  = Empty
            };

            if (string.IsNullOrWhiteSpace(dataSourceName) || storeId <= 0)
            {
                diag.Error = "Missing dataSource or invalid storeId.";
                return diag;
            }

            if (_options.Mappings == null ||
                !_options.Mappings.TryGetValue(dataSourceName, out var mapping) || mapping == null)
            {
                diag.Error = $"No PageFields mapping configured for '{dataSourceName}'.";
                return diag;
            }

            diag.MappingFound   = true;
            diag.RegisterTypeId = mapping.RegisterTypeId;
            diag.ParentPageId   = mapping.ParentPageId ?? _options.DefaultParentPageId;
            diag.UCPageId       = mapping.UCPageId ?? _options.DefaultUCPageId;

            if (diag.ParentPageId <= 0 || diag.UCPageId <= 0)
            {
                diag.Error = "ParentPageId / UCPageId not configured.";
                return diag;
            }

            try
            {
                using (var conn = new SqlConnection(_connectionString))
                {
                    diag.MemberId = await ResolveMemberIdAsync(conn, storeId);
                    if (diag.MemberId <= 0)
                    {
                        diag.Error = $"No MemberID found for StoreID {storeId}.";
                        return diag;
                    }

                    var captions   = await LoadCaptionsAsync(conn, mapping, diag.ParentPageId, diag.UCPageId, diag.MemberId);
                    diag.Captions  = captions;
                    diag.RowCount  = captions.Count;
                    if (captions.Count == 0)
                        diag.Error = "Procedure executed but returned no ColName/ColCaption rows.";
                    return diag;
                }
            }
            catch (Exception ex)
            {
                diag.Error = ex.Message;
                return diag;
            }
        }

        private async Task<IReadOnlyDictionary<string, string>> LoadCaptionsAsync(
            SqlConnection conn, PageFieldMapping mapping, int parentPageId, int ucPageId, int memberId)
        {
            var p = new DynamicParameters();
            p.Add("@ParentPageID", parentPageId);
            p.Add("@UCPageID", ucPageId);
            p.Add("@MemberID", memberId);
            p.Add("@ApplicationName", _options.ApplicationName);
            p.Add("@RegisterTypeID", mapping.RegisterTypeId);
            p.Add("@RefKey", mapping.RefKey ?? string.Empty);
            p.Add("@IsVis", true);

            var rows = await conn.QueryAsync(
                _options.ProcedureName, p, commandType: CommandType.StoredProcedure);

            var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (var row in rows)
            {
                var dict = (IDictionary<string, object>)row;
                if (!dict.TryGetValue("ColName", out var colObj) || colObj == null) continue;

                var colName = colObj.ToString().Trim();
                if (colName.Length == 0 || result.ContainsKey(colName)) continue;

                dict.TryGetValue("ColCaption", out var capObj);
                var caption = capObj?.ToString().Trim();
                if (!string.IsNullOrEmpty(caption))
                    result[colName] = caption;
            }

            return result;
        }
    }
}
