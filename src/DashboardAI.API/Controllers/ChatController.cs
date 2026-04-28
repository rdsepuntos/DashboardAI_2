using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using DashboardAI.Application.DTOs;
using DashboardAI.Application.Interfaces;
using DashboardAI.Application.UseCases.SendChatMessage;
using Microsoft.AspNetCore.Mvc;

namespace DashboardAI.API.Controllers
{
    public class DescribeWidgetsRequest
    {
        public string DashboardTitle { get; set; }
        public string UserId         { get; set; }
        public int    StoreId        { get; set; }
        public List<WidgetDescribeItem> Widgets { get; set; }
    }

    [Route("api/chat")]
    [ApiController]
    public class ChatController : ControllerBase
    {
        private readonly SendChatMessageHandler _handler;
        private readonly IOpenAIService         _aiService;

        public ChatController(SendChatMessageHandler handler, IOpenAIService aiService)
        {
            _handler   = handler   ?? throw new ArgumentNullException(nameof(handler));
            _aiService = aiService ?? throw new ArgumentNullException(nameof(aiService));
        }

        // ──────────────────────────────────────────────────────────────────────
        // POST /api/chat/message
        // Body: {
        //   "dashboardId": "...",
        //   "message": "Add a pie chart showing sales by region",
        //   "userId": "u123",
        //   "storeId": 5,
        //   "currentDashboard": { ...full current DashboardDto... }
        // }
        // Returns: { "commands": [...], "updatedDashboard": {...} }
        // ──────────────────────────────────────────────────────────────────────
        [HttpPost("message")]
        public async Task<IActionResult> Message([FromBody] SendChatMessageRequest request)
        {
            if (request == null || string.IsNullOrWhiteSpace(request.Message))
                return BadRequest(new { error = "Message is required." });

            if (request.CurrentDashboard == null)
                return BadRequest(new { error = "CurrentDashboard is required." });

            try
            {
                var result = await _handler.HandleAsync(request);
                return Ok(new
                {
                    commands         = result.Commands,
                    updatedDashboard = result.UpdatedDashboard
                });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { error = ex.Message });
            }
        }

        // ──────────────────────────────────────────────────────────────────────
        // POST /api/chat/describe
        // Body: { "dashboardTitle": "...", "userId": "...", "storeId": 1,
        //         "widgets": [{"title":"...","type":"...","chartType":"...","currentValue":"..."}] }
        // Returns: { "descriptions": { "Widget Title": "AI insight..." } }
        // ──────────────────────────────────────────────────────────────────────
        [HttpPost("describe")]
        public async Task<IActionResult> Describe([FromBody] DescribeWidgetsRequest request)
        {
            if (request?.Widgets == null || !request.Widgets.Any())
                return BadRequest(new { error = "Widgets list is required." });

            try
            {
                var descriptions = await _aiService.DescribeWidgetsAsync(
                    request.DashboardTitle ?? "Dashboard",
                    request.Widgets);
                return Ok(new { descriptions });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { error = ex.Message });
            }
        }
    }
}
