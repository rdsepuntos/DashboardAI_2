using System;
using System.Collections.Generic;
using System.Data;
using System.Data.SqlClient;
using System.Linq;
using System.Threading.Tasks;
using Dapper;
using DashboardAI.Domain.Entities;
using DashboardAI.Domain.Interfaces;

namespace DashboardAI.Infrastructure.Services
{
    public class WidgetDataService : IWidgetDataService
    {
        private readonly string _connectionString;
        private readonly IDataSourceRegistry _registry;

        public WidgetDataService(string connectionString, IDataSourceRegistry registry)
        {
            _connectionString = connectionString ?? throw new ArgumentNullException(nameof(connectionString));
            _registry         = registry         ?? throw new ArgumentNullException(nameof(registry));
        }

        // ── Full result ───────────────────────────────────────────────────────────

        public async Task<IEnumerable<IDictionary<string, object>>> QueryAsync(
            string dataSourceName,
            IDictionary<string, object> parameters)
        {
            var definition = _registry.GetByName(dataSourceName)
                ?? throw new InvalidOperationException($"Data source '{dataSourceName}' not found in registry.");

            using (var conn = new SqlConnection(_connectionString))
            {
                if (definition.Kind == DataSourceKind.StoredProcedure)
                {
                    var dynParams = BuildDynamicParameters(definition, parameters);
                    var rows = await conn.QueryAsync(
                        dataSourceName, dynParams,
                        commandType: CommandType.StoredProcedure);
                    return rows.Select(r => (IDictionary<string, object>)r).ToList();
                }
                else
                {
                    var (whereSql, dynParams) = BuildWhereClause(definition, parameters);
                    var sql = $"SELECT * FROM {dataSourceName}{whereSql}";
                    var rows = await conn.QueryAsync(sql, dynParams);
                    return rows.Select(r => (IDictionary<string, object>)r).ToList();
                }
            }
        }

        // ── Aggregated result (server-side GROUP BY) ─────────────────────────────

        public async Task<IEnumerable<IDictionary<string, object>>> QueryAggregatedAsync(
            string dataSourceName,
            IDictionary<string, object> parameters,
            AggregationRequest aggregation)
        {
            if (aggregation == null) throw new ArgumentNullException(nameof(aggregation));

            var definition = _registry.GetByName(dataSourceName)
                ?? throw new InvalidOperationException($"Data source '{dataSourceName}' not found in registry.");

            if (definition.Kind == DataSourceKind.StoredProcedure)
                throw new InvalidOperationException(
                    $"Server-side aggregation is not supported for stored procedures. Use QueryAsync instead.");

            // Security: validate groupBy and aggregateColumn against the registered column list
            var validColumns = definition.Columns != null
                ? new System.Collections.Generic.HashSet<string>(
                    definition.Columns.Select(c => c.Name),
                    StringComparer.OrdinalIgnoreCase)
                : new System.Collections.Generic.HashSet<string>(StringComparer.OrdinalIgnoreCase);

            if (!string.IsNullOrEmpty(aggregation.GroupBy) && !validColumns.Contains(aggregation.GroupBy))
                throw new InvalidOperationException(
                    $"Column '{aggregation.GroupBy}' is not registered for data source '{dataSourceName}'.");

            if (!string.IsNullOrEmpty(aggregation.AggregateColumn) && !validColumns.Contains(aggregation.AggregateColumn))
                throw new InvalidOperationException(
                    $"Column '{aggregation.AggregateColumn}' is not registered for data source '{dataSourceName}'.");

            // count_distinct requires an aggregateColumn
            if (string.Equals(aggregation.AggregateFunction, "count_distinct", StringComparison.OrdinalIgnoreCase)
                && string.IsNullOrEmpty(aggregation.AggregateColumn))
                throw new InvalidOperationException(
                    "count_distinct requires an aggregateColumn.");

            var (whereSql, dynParams) = BuildWhereClause(definition, parameters);

            // Append AdditionalFilters.
            // Each column is validated against the registered column list to prevent injection.
            // A value containing commas is treated as a multi-value list → generates [col] IN (...)
            // A single value generates [col] = @param
            if (aggregation.AdditionalFilters != null && aggregation.AdditionalFilters.Count > 0)
            {
                var extraConditions = new List<string>();
                foreach (var kv in aggregation.AdditionalFilters)
                {
                    if (string.IsNullOrEmpty(kv.Key) || kv.Value == null) continue;

                    if (!validColumns.Contains(kv.Key))
                        throw new InvalidOperationException(
                            $"Additional filter column '{kv.Key}' is not registered for data source '{dataSourceName}'.");

                    var values = kv.Value.Split(',').Select(v => v.Trim())
                                        .Where(v => v.Length > 0).ToList();

                    if (values.Count == 1)
                    {
                        var paramName = $"__af_{kv.Key}";
                        extraConditions.Add($"[{kv.Key}] = @{paramName}");
                        dynParams.Add(paramName, values[0]);
                    }
                    else if (values.Count > 1)
                    {
                        var inParams = new List<string>();
                        for (int i = 0; i < values.Count; i++)
                        {
                            var paramName = $"__af_{kv.Key}_{i}";
                            inParams.Add($"@{paramName}");
                            dynParams.Add(paramName, values[i]);
                        }
                        extraConditions.Add($"[{kv.Key}] IN ({string.Join(", ", inParams)})");
                    }
                }

                if (extraConditions.Any())
                    whereSql = (whereSql.Length > 0 ? whereSql + " AND " : " WHERE ")
                               + string.Join(" AND ", extraConditions);
            }

            var aggExpr = BuildAggregateExpression(aggregation.AggregateFunction, aggregation.AggregateColumn);

            string sql;
            if (!string.IsNullOrEmpty(aggregation.GroupBy))
            {
                // When DateGroup is set, bucket the date column into a sortable string key
                // returned as __group (e.g. '2025-01' for monthly).
                // Otherwise GROUP BY the raw column value.
                if (!string.IsNullOrEmpty(aggregation.DateGroup))
                {
                    var dateExpr = BuildDateGroupExpression(aggregation.GroupBy, aggregation.DateGroup);
                    sql = $"SELECT {dateExpr} AS __group, {aggExpr} AS __value"
                        + $" FROM {dataSourceName}{whereSql}"
                        + $" GROUP BY {dateExpr}"
                        + $" ORDER BY {dateExpr}";
                }
                else
                {
                    // Grouped: one row per group key
                    sql = $"SELECT [{aggregation.GroupBy}], {aggExpr} AS __value"
                        + $" FROM {dataSourceName}{whereSql}"
                        + $" GROUP BY [{aggregation.GroupBy}]"
                        + $" ORDER BY [{aggregation.GroupBy}]";
                }
            }
            else
            {
                // Scalar: single row with the aggregate value (for KPI widgets)
                sql = $"SELECT {aggExpr} AS __value FROM {dataSourceName}{whereSql}";
            }

            using (var conn = new SqlConnection(_connectionString))
            {
                var rows = await conn.QueryAsync(sql, dynParams);
                return rows.Select(r => (IDictionary<string, object>)r).ToList();
            }
        }

        // ── Paged result ──────────────────────────────────────────────────────────

        public async Task<PagedResult<IDictionary<string, object>>> QueryPagedAsync(
            string dataSourceName,
            IDictionary<string, object> parameters,
            int page,
            int pageSize)
        {
            var definition = _registry.GetByName(dataSourceName)
                ?? throw new InvalidOperationException($"Data source '{dataSourceName}' not found in registry.");

            page     = Math.Max(1, page);
            pageSize = Math.Clamp(pageSize, 1, 500);
            int offset = (page - 1) * pageSize;

            using (var conn = new SqlConnection(_connectionString))
            {
                if (definition.Kind == DataSourceKind.StoredProcedure)
                {
                    // SPs manage their own paging — pass page/pageSize as params if supported
                    var dynParams = BuildDynamicParameters(definition, parameters);
                    if (definition.SupportedParams?.Contains("Page",     StringComparer.OrdinalIgnoreCase) == true) dynParams.Add("Page",     page);
                    if (definition.SupportedParams?.Contains("PageSize", StringComparer.OrdinalIgnoreCase) == true) dynParams.Add("PageSize", pageSize);

                    var rows = await conn.QueryAsync(dataSourceName, dynParams,
                        commandType: CommandType.StoredProcedure);
                    var list = rows.Select(r => (IDictionary<string, object>)r).ToList();

                    return new PagedResult<IDictionary<string, object>>
                    {
                        Data       = list,
                        TotalCount = list.Count,   // SP doesn't return count — best effort
                        Page       = page,
                        PageSize   = pageSize
                    };
                }
                else
                {
                    var (whereSql, whereParams) = BuildWhereClause(definition, parameters);

                    var countSql = $"SELECT COUNT(*) FROM {dataSourceName}{whereSql}";
                    var dataSql  = $@"SELECT * FROM {dataSourceName}{whereSql}
ORDER BY (SELECT NULL)
OFFSET @_Offset ROWS FETCH NEXT @_PageSize ROWS ONLY";

                    // Clone params for paged query and add paging params
                    var pagedParams = new DynamicParameters(whereParams);
                    pagedParams.Add("_Offset",   offset);
                    pagedParams.Add("_PageSize", pageSize);

                    var totalCount = await conn.ExecuteScalarAsync<int>(countSql, whereParams);
                    var rows       = await conn.QueryAsync(dataSql, pagedParams);

                    return new PagedResult<IDictionary<string, object>>
                    {
                        Data       = rows.Select(r => (IDictionary<string, object>)r).ToList(),
                        TotalCount = totalCount,
                        Page       = page,
                        PageSize   = pageSize
                    };
                }
            }
        }

        // ── Distinct column values (for prompt enrichment) ────────────────────────

        public async Task<IEnumerable<string>> GetDistinctValuesAsync(
            string dataSourceName,
            string columnName,
            IDictionary<string, object> parameters)
        {
            var definition = _registry.GetByName(dataSourceName)
                ?? throw new InvalidOperationException($"Data source '{dataSourceName}' not found in registry.");

            // Only supported for views
            if (definition.Kind != DataSourceKind.View)
                return Enumerable.Empty<string>();

            // Validate the column exists in the definition
            var colExists = definition.Columns?.Any(c =>
                string.Equals(c.Name, columnName, StringComparison.OrdinalIgnoreCase)) == true;

            if (!colExists)
                return Enumerable.Empty<string>();

            using (var conn = new SqlConnection(_connectionString))
            {
                var (whereSql, dynParams) = BuildWhereClause(definition, parameters);
                var sql = $"SELECT DISTINCT [{columnName}] FROM {dataSourceName}{whereSql} " +
                          $"WHERE [{columnName}] IS NOT NULL ORDER BY [{columnName}]";

                // If BuildWhereClause already added a WHERE, we need AND instead
                if (!string.IsNullOrEmpty(whereSql))
                {
                    sql = $"SELECT DISTINCT [{columnName}] FROM {dataSourceName}{whereSql} " +
                          $"AND [{columnName}] IS NOT NULL ORDER BY [{columnName}]";
                }

                var results = await conn.QueryAsync<string>(sql, dynParams);
                return results ?? Enumerable.Empty<string>();
            }
        }

        // ─────────────────────────────────────────────────────────────────────────

        private DynamicParameters BuildDynamicParameters(
            DataSourceDefinition def,
            IDictionary<string, object> parameters)
        {
            var dynParams = new DynamicParameters();

            if (def.SupportedParams != null)
            {
                foreach (var param in def.SupportedParams)
                {
                    if (parameters.TryGetValue(param, out var value))
                        dynParams.Add(param, value);
                }
            }

            return dynParams;
        }

        /// <summary>
        /// Builds a SQL expression that buckets a date column into a sortable string key.
        /// All results are lexicographically sortable (no further sort expressions needed).
        ///   monthly        → CONVERT(char(7), [col], 120)      e.g. '2025-01'
        ///   quarterly      → CONCAT(YEAR([col]),'-Q',DATEPART(QUARTER,[col])) e.g. '2025-Q1'
        ///   yearly         → CAST(YEAR([col]) AS char(4))       e.g. '2025'
        ///   financial_year → CONCAT('FY', fyStartYear)          e.g. 'FY2024'
        /// </summary>
        private static string BuildDateGroupExpression(string column, string dateGroup)
        {
            var col = $"[{column}]";
            switch ((dateGroup ?? string.Empty).Trim().ToLowerInvariant())
            {
                case "monthly":
                    return $"CONVERT(char(7), {col}, 120)";

                case "quarterly":
                    return $"CONCAT(CAST(YEAR({col}) AS char(4)), '-Q', CAST(DATEPART(QUARTER, {col}) AS char(1)))";

                case "yearly":
                    return $"CAST(YEAR({col}) AS char(4))";

                case "financial_year":
                    // Australian FY: Jul–Jun.  Jul 2024–Jun 2025 = FY2024.
                    return $"CONCAT('FY', CAST(CASE WHEN MONTH({col}) >= 7 THEN YEAR({col}) ELSE YEAR({col}) - 1 END AS char(4)))";

                default:
                    // Unknown mode — fall back to ISO date string (no bucketing)
                    return $"CONVERT(char(10), {col}, 120)";
            }
        }

        /// <summary>
        /// Builds the SQL aggregate expression for a given function + column,
        /// e.g. "COUNT(*)", "SUM([SomeColumn])", "AVG([SomeColumn])".
        /// </summary>
        private static string BuildAggregateExpression(string function, string column)
        {
            if (string.IsNullOrWhiteSpace(function) ||
                string.Equals(function, "count", StringComparison.OrdinalIgnoreCase))
                return "COUNT(*)";

            // For non-count functions a column is required; fall back to COUNT(*) if missing
            if (string.IsNullOrWhiteSpace(column))
                return "COUNT(*)";

            var safeCol = $"[{column}]";
            switch (function.Trim().ToUpperInvariant())
            {
                case "SUM":           return $"SUM({safeCol})";
                case "AVG":           return $"AVG({safeCol})";
                case "MAX":           return $"MAX({safeCol})";
                case "MIN":           return $"MIN({safeCol})";
                case "COUNT_DISTINCT": return $"COUNT(DISTINCT {safeCol})";
                default:              return "COUNT(*)";
            }
        }

        /// <summary>
        /// Builds a " WHERE col = @param AND ..." SQL fragment + DynamicParameters for a view query.
        /// Returns an empty string + empty params when no conditions apply.
        /// </summary>
        private (string whereSql, DynamicParameters parameters) BuildWhereClause(
            DataSourceDefinition def,
            IDictionary<string, object> parameters)
        {
            var dynParams  = new DynamicParameters();
            var conditions = new List<string>();

            // Find the first date-typed column for date range mapping (falls back to "OrderDate")
            var dateColumn = def.Columns?.FirstOrDefault(c =>
                string.Equals(c.DataType, "date", StringComparison.OrdinalIgnoreCase))?.Name
                ?? "OrderDate";

            if (def.SupportedParams != null)
            {
                foreach (var param in def.SupportedParams)
                {
                    if (!parameters.TryGetValue(param, out var value) || value == null) continue;

                    // Skip falsy defaults (e.g. storeId=0 means "not set")
                    if (value is int intVal && intVal == 0) continue;
                    if (value is string strVal && string.IsNullOrWhiteSpace(strVal)) continue;

                    if (param.Equals("StartDate", StringComparison.OrdinalIgnoreCase))
                    {
                        conditions.Add($"{dateColumn} >= @StartDate");
                        dynParams.Add("StartDate", value);
                    }
                    else if (param.Equals("EndDate", StringComparison.OrdinalIgnoreCase))
                    {
                        conditions.Add($"{dateColumn} <= @EndDate");
                        dynParams.Add("EndDate", value);
                    }
                    else
                    {
                        // Direct column = param match (e.g. StoreID = @StoreID)
                        conditions.Add($"{param} = @{param}");
                        dynParams.Add(param, value);
                    }
                }
            }

            var whereSql = conditions.Any()
                ? " WHERE " + string.Join(" AND ", conditions)
                : string.Empty;

            return (whereSql, dynParams);
        }
    }
}
