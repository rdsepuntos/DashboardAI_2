using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using DashboardAI.Application.UseCases.QueryWidgetData;
using DashboardAI.Domain.Interfaces;
using Microsoft.AspNetCore.Mvc;
using Newtonsoft.Json;
using Newtonsoft.Json.Serialization;

namespace DashboardAI.API.Controllers
{
    [Route("api/widget-data")]
    [ApiController]
    public class WidgetDataController : ControllerBase
    {
        private readonly QueryWidgetDataHandler _handler;
        private readonly IDataSourceRegistry _registry;

        // Preserve original SQL column name casing — the global camelCase resolver
        // would turn "HazardType" into "hazardType", breaking widget config key lookups.
        private static readonly JsonSerializerSettings _rawCasingSettings = new JsonSerializerSettings
        {
            ContractResolver  = new DefaultContractResolver(),
            NullValueHandling = NullValueHandling.Ignore
        };

        private static readonly HashSet<string> _categoricalCols = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "Status", "Type", "SubType", "HazardType", "Hazard",
            "Department", "Division", "Location", "LocationType",
            "Programme", "Checklist", "CreatedBy", "PersonResponsible", "ReportedBy"
        };

        public WidgetDataController(QueryWidgetDataHandler handler, IDataSourceRegistry registry)
        {
            _handler  = handler  ?? throw new ArgumentNullException(nameof(handler));
            _registry = registry ?? throw new ArgumentNullException(nameof(registry));
        }

        // ──────────────────────────────────────────────────────────────────────
        // GET /api/widget-data/debug-enrichment?storeId=11017
        // Returns the enriched data_sources_json exactly as sent to OpenAI.
        // Useful for verifying knownValues are populated before debugging the prompt.
        // ──────────────────────────────────────────────────────────────────────
        [HttpGet("debug-enrichment")]
        public async Task<IActionResult> DebugEnrichment([FromQuery] int storeId)
        {
            var sources = _registry.GetAll().ToList();
            var result  = new List<object>();

            foreach (var src in sources)
            {
                var cols = new List<object>();
                foreach (var col in src.Columns ?? Enumerable.Empty<DashboardAI.Domain.Entities.ColumnDefinition>())
                {
                    List<string> knownValues = null;
                    if (string.Equals(col.DataType, "string", StringComparison.OrdinalIgnoreCase)
                        && _categoricalCols.Contains(col.Name))
                    {
                        try
                        {
                            var vals = (await _handler.GetDistinctValuesAsync(
                                src.Name, col.Name, storeId,
                                new Dictionary<string, object>())).ToList();
                            if (vals.Count > 0 && vals.Count <= 50)
                                knownValues = vals;
                        }
                        catch (Exception ex)
                        {
                            knownValues = new List<string> { $"ERROR: {ex.Message}" };
                        }
                    }
                    cols.Add(new { col.Name, col.DataType, knownValues });
                }
                result.Add(new { src.Name, columns = cols });
            }

            return new JsonResult(result, _rawCasingSettings);
        }

        // ──────────────────────────────────────────────────────────────────────
        // POST /api/widget-data/query
        // Returns all matching rows (use for charts, KPIs, maps).
        // ──────────────────────────────────────────────────────────────────────
        [HttpPost("query")]
        public async Task<IActionResult> Query([FromBody] WidgetDataRequest request)
        {
            if (request == null || string.IsNullOrWhiteSpace(request.DataSource))
                return BadRequest(new { error = "DataSource is required." });

            try
            {
                var data = await _handler.HandleAsync(new QueryWidgetDataRequest
                {
                    DataSource        = request.DataSource,
                    Parameters        = request.Parameters ?? new Dictionary<string, object>(),
                    StoreId           = request.StoreId,
                    GroupBy           = request.GroupBy,
                    AggregateFunction = request.AggregateFunction,
                    AggregateColumn   = request.AggregateColumn,
                    DateGroup         = request.DateGroup,
                    AdditionalFilters = request.AdditionalFilters
                });

                return new JsonResult(data, _rawCasingSettings);
            }
            catch (InvalidOperationException ex) { return BadRequest(new { error = ex.Message }); }
            catch (Exception ex)                 { return StatusCode(500, new { error = ex.Message }); }
        }

        // ──────────────────────────────────────────────────────────────────────
        // POST /api/widget-data/query-paged
        // Body: { "dataSource": "...", "storeId": 5, "page": 1, "pageSize": 50,
        //         "parameters": { "StartDate": "...", "EndDate": "..." } }
        // Returns: { data: [...], totalCount, page, pageSize, totalPages }
        // ──────────────────────────────────────────────────────────────────────
        [HttpPost("query-paged")]
        public async Task<IActionResult> QueryPaged([FromBody] WidgetDataPagedRequest request)
        {
            if (request == null || string.IsNullOrWhiteSpace(request.DataSource))
                return BadRequest(new { error = "DataSource is required." });

            try
            {
                var result = await _handler.HandlePagedAsync(new QueryPagedWidgetDataRequest
                {
                    DataSource = request.DataSource,
                    Parameters = request.Parameters ?? new Dictionary<string, object>(),
                    StoreId    = request.StoreId,
                    Page       = request.Page > 0   ? request.Page     : 1,
                    PageSize   = request.PageSize > 0 ? request.PageSize : 50
                });

                // Wrap with explicit lowercase property names so DefaultContractResolver
                // preserves them AND preserves original SQL column casing in the row data.
                var payload = new
                {
                    data       = result.Data,
                    totalCount = result.TotalCount,
                    page       = result.Page,
                    pageSize   = result.PageSize,
                    totalPages = result.TotalPages
                };
                return new JsonResult(payload, _rawCasingSettings);
            }
            catch (InvalidOperationException ex) { return BadRequest(new { error = ex.Message }); }
            catch (Exception ex)                 { return StatusCode(500, new { error = ex.Message }); }
        }

        // ──────────────────────────────────────────────────────────────────────
        // POST /api/widget-data/distinct
        // Returns sorted distinct non-null values for a single column (for dropdowns).
        // ──────────────────────────────────────────────────────────────────────
        [HttpPost("distinct")]
        public async Task<IActionResult> Distinct([FromBody] WidgetDataDistinctRequest request)
        {
            if (request == null || string.IsNullOrWhiteSpace(request.DataSource) || string.IsNullOrWhiteSpace(request.ColumnName))
                return BadRequest(new { error = "DataSource and ColumnName are required." });

            try
            {
                var values = await _handler.GetDistinctValuesAsync(
                    request.DataSource,
                    request.ColumnName,
                    request.StoreId,
                    request.Parameters ?? new Dictionary<string, object>());

                return new JsonResult(values, _rawCasingSettings);
            }
            catch (InvalidOperationException ex) { return BadRequest(new { error = ex.Message }); }
            catch (Exception ex)                 { return StatusCode(500, new { error = ex.Message }); }
        }
    }

    public class WidgetDataDistinctRequest
    {
        public string DataSource  { get; set; }
        public string ColumnName  { get; set; }
        public int    StoreId     { get; set; }
        public Dictionary<string, object> Parameters { get; set; }
    }

    public class WidgetDataRequest
    {
        public string DataSource { get; set; }
        public int StoreId { get; set; }
        public Dictionary<string, object> Parameters { get; set; }

        // ── Optional server-side aggregation ─────────────────────────────────
        // When AggregateFunction is set the server runs GROUP BY instead of SELECT *.
        // The aggregate result is returned in a column named "__value".

        /// <summary>Column to GROUP BY. Omit for scalar KPI results.</summary>
        public string GroupBy { get; set; }

        /// <summary>Aggregate function: count | sum | avg | max | min.</summary>
        public string AggregateFunction { get; set; }

        /// <summary>Column to aggregate (ignored for count).</summary>
        public string AggregateColumn { get; set; }

        /// <summary>Optional date bucketing: monthly | quarterly | yearly | financial_year.</summary>
        public string DateGroup { get; set; }

        /// <summary>Exact-match column filters for KPI *Filter config keys, e.g. { "Status": "Open" }.</summary>
        public Dictionary<string, string> AdditionalFilters { get; set; }
    }

    public class WidgetDataPagedRequest : WidgetDataRequest
    {
        public int Page     { get; set; } = 1;
        public int PageSize { get; set; } = 50;
    }
}
