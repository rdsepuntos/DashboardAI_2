using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using DashboardAI.Application.UseCases.GenerateDashboard;
using DashboardAI.Application.UseCases.GetDashboard;
using DashboardAI.Domain.Interfaces;
using Microsoft.AspNetCore.Mvc;
using Newtonsoft.Json;

namespace DashboardAI.API.Controllers
{
    [Route("api/dashboard")]
    [ApiController]
    public class DashboardController : ControllerBase
    {
        private readonly GenerateDashboardHandler _generateHandler;
        private readonly GetDashboardHandler      _getHandler;
        private readonly IDashboardRepository      _repository;

        public DashboardController(
            GenerateDashboardHandler generateHandler,
            GetDashboardHandler      getHandler,
            IDashboardRepository     repository)
        {
            _generateHandler = generateHandler ?? throw new ArgumentNullException(nameof(generateHandler));
            _getHandler      = getHandler      ?? throw new ArgumentNullException(nameof(getHandler));
            _repository      = repository      ?? throw new ArgumentNullException(nameof(repository));
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
                    redirectUrl = $"/dashboard/{result.DashboardId}?userId={Uri.EscapeDataString(request.UserId ?? string.Empty)}&storeId={request.StoreId}&sessionId={Uri.EscapeDataString(request.SessionId ?? string.Empty)}&module={Uri.EscapeDataString(request.Module ?? string.Empty)}",
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

        // ──────────────────────────────────────────────────────────────────────
        // GET /api/dashboard/{id}/filter-state?sessionId=...
        // Returns the applied filter values saved for this session, or {} if none.
        // ──────────────────────────────────────────────────────────────────────
        [HttpGet("{id:guid}/filter-state")]
        public async Task<IActionResult> GetFilterState(Guid id, [FromQuery] string sessionId)
        {
            try
            {
                var json = await _repository.GetFilterStateAsync(id, sessionId);
                return Content(string.IsNullOrWhiteSpace(json) ? "{}" : json, "application/json");
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { error = ex.Message });
            }
        }

        // ──────────────────────────────────────────────────────────────────────
        // PUT /api/dashboard/{id}/filter-state
        // Body: { "sessionId": "...", "storeId": 5, "filterState": { "f1": "value", ... } }
        // Upserts the applied filter values so they persist for the current session.
        // ──────────────────────────────────────────────────────────────────────
        [HttpPut("{id:guid}/filter-state")]
        public async Task<IActionResult> SaveFilterState(Guid id, [FromBody] SaveFilterStateRequest request)
        {
            if (request == null)
                return BadRequest(new { error = "Request body is required." });

            try
            {
                var json = request.FilterState == null
                    ? "{}"
                    : JsonConvert.SerializeObject(request.FilterState);

                await _repository.SaveFilterStateAsync(id, request.SessionId, request.StoreId, json);
                return Ok(new { saved = true });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { error = ex.Message });
            }
        }
    }

    public class SaveFilterStateRequest
    {
        public string SessionId { get; set; }
        public int StoreId { get; set; }
        public Dictionary<string, object> FilterState { get; set; }
    }
}
