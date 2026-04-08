using System;
using System.Threading.Tasks;
using DashboardAI.Application.DTOs;
using DashboardAI.Application.UseCases.SendChatMessage;
using Microsoft.AspNetCore.Mvc;

namespace DashboardAI.API.Controllers
{
    [Route("api/chat")]
    [ApiController]
    public class ChatController : ControllerBase
    {
        private readonly SendChatMessageHandler _handler;

        public ChatController(SendChatMessageHandler handler)
            => _handler = handler ?? throw new ArgumentNullException(nameof(handler));

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
    }
}
