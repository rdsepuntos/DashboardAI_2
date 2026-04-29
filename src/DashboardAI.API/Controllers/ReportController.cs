using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using DashboardAI.Application.Interfaces;
using Microsoft.AspNetCore.Mvc;

namespace DashboardAI.API.Controllers
{
    public class GenerateReportInsightsRequest
    {
        public string DashboardTitle { get; set; }
        public string UserId         { get; set; }
        public int    StoreId        { get; set; }
        public List<ReportWidgetItem> Widgets { get; set; }
    }

    [Route("api/report")]
    [ApiController]
    public class ReportController : ControllerBase
    {
        private readonly IOpenAIService _aiService;

        public ReportController(IOpenAIService aiService)
        {
            _aiService = aiService ?? throw new ArgumentNullException(nameof(aiService));
        }

        // ──────────────────────────────────────────────────────────────────────
        // POST /api/report/insights
        // Body: {
        //   "dashboardTitle": "WHS Incident Dashboard",
        //   "userId": "u123",
        //   "storeId": 5,
        //   "widgets": [
        //     { "title": "Open Incidents",    "type": "count",  "currentValue": "42" },
        //     { "title": "Incidents by Month","type": "linechart" },
        //     { "title": "Recent Incidents",  "type": "table",  "rowCount": 248,
        //       "columns": ["Date","Type","Status"],
        //       "sampleRows": [["29/04/2026","Slip/Fall","Open"]] }
        //   ]
        // }
        // Returns: {
        //   "executiveSummary": "...",
        //   "descriptions": { "Widget Title": { "description": "...", "layout": "right|left|bottom|full" } }
        // }
        // ──────────────────────────────────────────────────────────────────────
        [HttpPost("insights")]
        public async Task<IActionResult> Insights([FromBody] GenerateReportInsightsRequest request)
        {
            if (request?.Widgets == null || !request.Widgets.Any())
                return BadRequest(new { error = "Widgets list is required." });

            try
            {
                var result = await _aiService.GenerateReportInsightsAsync(
                    request.DashboardTitle ?? "Dashboard",
                    request.Widgets);

                return Ok(new
                {
                    executiveSummary = result.ExecutiveSummary,
                    descriptions     = result.Descriptions
                });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { error = ex.Message });
            }
        }
    }
}
