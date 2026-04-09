using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using DashboardAI.Domain.Entities;
using DashboardAI.Domain.Interfaces;

namespace DashboardAI.Application.UseCases.QueryWidgetData
{
    public class QueryWidgetDataRequest
    {
        public string DataSource { get; set; }

        /// <summary>
        /// Raw parameters from the frontend filter state.
        /// StoreId is always injected/overridden server-side — never trusted from client.
        /// </summary>
        public Dictionary<string, object> Parameters { get; set; }

        /// <summary>Server-side locked StoreId (from user session)</summary>
        public int StoreId { get; set; }

        // ── Optional server-side aggregation ─────────────────────────────────
        // When AggregateFunction is set the query runs as a GROUP BY aggregate
        // instead of SELECT *, dramatically reducing data transfer for chart/KPI widgets.

        /// <summary>Column to GROUP BY. Null/empty = scalar result (KPI).</summary>
        public string GroupBy { get; set; }

        /// <summary>Aggregate function: count | sum | avg | max | min.</summary>
        public string AggregateFunction { get; set; }

        /// <summary>Column to aggregate (ignored for count).</summary>
        public string AggregateColumn { get; set; }
    }

    public class QueryPagedWidgetDataRequest
    {
        public string DataSource { get; set; }
        public Dictionary<string, object> Parameters { get; set; }
        public int StoreId { get; set; }
        public int Page { get; set; } = 1;
        public int PageSize { get; set; } = 50;
    }

    public class QueryWidgetDataHandler
    {
        private readonly IWidgetDataService _dataService;
        private readonly IDataSourceRegistry _registry;

        public QueryWidgetDataHandler(
            IWidgetDataService dataService,
            IDataSourceRegistry registry)
        {
            _dataService = dataService ?? throw new ArgumentNullException(nameof(dataService));
            _registry    = registry    ?? throw new ArgumentNullException(nameof(registry));
        }

        public async Task<IEnumerable<IDictionary<string, object>>> HandleAsync(QueryWidgetDataRequest request)
        {
            if (request == null) throw new ArgumentNullException(nameof(request));

            // Validate data source exists in registry (prevents arbitrary SQL injection)
            var definition = _registry.GetByName(request.DataSource);
            if (definition == null)
                throw new InvalidOperationException($"Data source '{request.DataSource}' is not registered.");

            // Use case-insensitive keys so "StoreId" from client matches "StoreID" in SupportedParams
            var safeParams = new Dictionary<string, object>(
                request.Parameters ?? new Dictionary<string, object>(),
                StringComparer.OrdinalIgnoreCase)
            {
                // Enforce server-side StoreId — always override what the client sends
                ["StoreId"] = request.StoreId
            };

            // If aggregation is requested, push the GROUP BY to the database.
            if (!string.IsNullOrWhiteSpace(request.AggregateFunction))
            {
                return await _dataService.QueryAggregatedAsync(
                    request.DataSource,
                    safeParams,
                    new Domain.Entities.AggregationRequest
                    {
                        GroupBy           = request.GroupBy,
                        AggregateFunction = request.AggregateFunction,
                        AggregateColumn   = request.AggregateColumn
                    });
            }

            return await _dataService.QueryAsync(request.DataSource, safeParams);
        }

        public async Task<PagedResult<IDictionary<string, object>>> HandlePagedAsync(QueryPagedWidgetDataRequest request)
        {
            if (request == null) throw new ArgumentNullException(nameof(request));

            var definition = _registry.GetByName(request.DataSource);
            if (definition == null)
                throw new InvalidOperationException($"Data source '{request.DataSource}' is not registered.");

            var safeParams = new Dictionary<string, object>(
                request.Parameters ?? new Dictionary<string, object>(),
                StringComparer.OrdinalIgnoreCase)
            {
                ["StoreId"] = request.StoreId
            };

            return await _dataService.QueryPagedAsync(
                request.DataSource, safeParams,
                request.Page > 0 ? request.Page : 1,
                request.PageSize > 0 ? request.PageSize : 50);
        }
    }
}
