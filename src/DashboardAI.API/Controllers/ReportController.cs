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
        public List<ReportWidgetItem>     Widgets       { get; set; }
        public Dictionary<string, string> ActiveFilters { get; set; }
    }

    public class SendReportEmailRequest
    {
        public int         StoreId       { get; set; }
        public int         UserId        { get; set; }
        public List<int>   UserIds       { get; set; } = new List<int>();
        public List<int>   DivisionIds   { get; set; } = new List<int>();
        public List<int>   DepartmentIds { get; set; } = new List<int>();
        public List<int>   RoleIds       { get; set; } = new List<int>();
        public string      Subject       { get; set; }
        public string      Message       { get; set; }
        public string      ReportHtml    { get; set; }
    }

    [Route("api/report")]
    [ApiController]
    public class ReportController : ControllerBase
    {
        private readonly IOpenAIService      _aiService;
        private readonly ISendReportService  _sendReportService;

        public ReportController(IOpenAIService aiService, ISendReportService sendReportService)
        {
            _aiService         = aiService         ?? throw new ArgumentNullException(nameof(aiService));
            _sendReportService = sendReportService ?? throw new ArgumentNullException(nameof(sendReportService));
        }

        // ──────────────────────────────────────────────────────────────────────
        // POST /api/report/insights
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
                    request.Widgets,
                    request.ActiveFilters);

                return Ok(new
                {
                    executiveSummary = result.ExecutiveSummary,
                    keyFindings      = result.KeyFindings ?? new List<string>(),
                    recommendations  = result.Recommendations ?? new List<string>(),
                    descriptions     = result.Descriptions
                });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { error = ex.Message });
            }
        }

        // ──────────────────────────────────────────────────────────────────────
        // POST /api/report/send-email
        // Body: {
        //   "storeId": 5, "userId": 123,
        //   "userIds": [1,2], "divisionIds": [], "departmentIds": [], "roleIds": [],
        //   "subject": "Monthly WHS Report",
        //   "message": "Please find the report attached.",
        //   "reportHtml": "<html>...</html>"
        // }
        // Returns: { "sent": 3, "recipients": ["a@b.com", ...] }
        // ──────────────────────────────────────────────────────────────────────
        [HttpPost("send-email")]
        public async Task<IActionResult> SendEmail([FromBody] SendReportEmailRequest request)
        {
            if (request == null)
                return BadRequest(new { error = "Request body is required." });

            var hasRecipients = (request.UserIds?.Count       > 0) ||
                                (request.DivisionIds?.Count   > 0) ||
                                (request.DepartmentIds?.Count > 0) ||
                                (request.RoleIds?.Count       > 0);

            if (!hasRecipients)
                return BadRequest(new { error = "At least one recipient (user, division, department, or role) is required." });

            try
            {
                var result = await _sendReportService.SendAsync(new SendReportRequest
                {
                    StoreId       = request.StoreId,
                    UserId        = request.UserId,
                    UserIds       = request.UserIds       ?? new List<int>(),
                    DivisionIds   = request.DivisionIds   ?? new List<int>(),
                    DepartmentIds = request.DepartmentIds ?? new List<int>(),
                    RoleIds       = request.RoleIds       ?? new List<int>(),
                    Subject       = request.Subject,
                    Message       = request.Message,
                    ReportHtml    = request.ReportHtml
                });

                return Ok(new { sent = result.Sent, recipients = result.Recipients });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { error = ex.Message });
            }
        }
    }
}

