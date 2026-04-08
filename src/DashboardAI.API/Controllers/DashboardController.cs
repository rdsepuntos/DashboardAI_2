using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using DashboardAI.Application.UseCases.GenerateDashboard;
using DashboardAI.Application.UseCases.GetDashboard;
using Microsoft.AspNetCore.Mvc;

namespace DashboardAI.API.Controllers
{
    [Route("api/dashboard")]
    [ApiController]
    public class DashboardController : ControllerBase
    {
        private readonly GenerateDashboardHandler _generateHandler;
        private readonly GetDashboardHandler      _getHandler;

        public DashboardController(
            GenerateDashboardHandler generateHandler,
            GetDashboardHandler      getHandler)
        {
            _generateHandler = generateHandler ?? throw new ArgumentNullException(nameof(generateHandler));
            _getHandler      = getHandler      ?? throw new ArgumentNullException(nameof(getHandler));
        }

        // ──────────────────────────────────────────────────────────────────────
        // POST /api/dashboard/generate
        // Body: { "prompt": "...", "storeId": 5, "userId": "u123" }
        // Returns: { "dashboardId": "...", "redirectUrl": "/dashboard/{id}" }
        // ──────────────────────────────────────────────────────────────────────
        [HttpPost("generate")]
        public async Task<IActionResult> Generate([FromBody] GenerateDashboardRequest request)
        {
            if (request == null || string.IsNullOrWhiteSpace(request.Prompt))
                return BadRequest(new { error = "Prompt is required." });

            try
            {
                var result = await _generateHandler.HandleAsync(request);
                return Ok(new
                {
                    dashboardId = result.DashboardId,
                    redirectUrl = $"/dashboard/{result.DashboardId}?userId={Uri.EscapeDataString(request.UserId ?? string.Empty)}&storeId={request.StoreId}",
                    dashboard   = result.Dashboard
                });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { error = ex.Message });
            }
        }

        // ──────────────────────────────────────────────────────────────────────
        // GET /api/dashboard/{id}
        // ──────────────────────────────────────────────────────────────────────
        [HttpGet("{id:guid}")]
        public async Task<IActionResult> Get(Guid id, [FromQuery] string userId, [FromQuery] int storeId)
        {
            try
            {
                var result = await _getHandler.HandleAsync(new GetDashboardRequest
                {
                    DashboardId = id,
                    UserId      = userId,
                    StoreId     = storeId
                });
                return Ok(result);
            }
            catch (KeyNotFoundException)
            {
                return NotFound(new { error = $"Dashboard {id} not found." });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { error = ex.Message });
            }
        }
    }
}
