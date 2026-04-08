using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using DashboardAI.Application.UseCases.QueryWidgetData;
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

        // Preserve original SQL column name casing — the global camelCase resolver
        // would turn "HazardType" into "hazardType", breaking widget config key lookups.
        private static readonly JsonSerializerSettings _rawCasingSettings = new JsonSerializerSettings
        {
            ContractResolver  = new DefaultContractResolver(),
            NullValueHandling = NullValueHandling.Ignore
        };

        public WidgetDataController(QueryWidgetDataHandler handler)
            => _handler = handler ?? throw new ArgumentNullException(nameof(handler));

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
                    DataSource = request.DataSource,
                    Parameters = request.Parameters ?? new Dictionary<string, object>(),
                    StoreId    = request.StoreId
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
    }

    public class WidgetDataRequest
    {
        public string DataSource { get; set; }
        public int StoreId { get; set; }
        public Dictionary<string, object> Parameters { get; set; }
    }

    public class WidgetDataPagedRequest : WidgetDataRequest
    {
        public int Page     { get; set; } = 1;
        public int PageSize { get; set; } = 50;
    }
}
