using System;
using System.Threading.Tasks;
using DashboardAI.Application.Interfaces;
using Microsoft.AspNetCore.Mvc;

namespace DashboardAI.API.Controllers
{
    [Route("api/sites")]
    [ApiController]
    public class SitesController : ControllerBase
    {
        private readonly ISiteScopeService _siteScopeService;

        public SitesController(ISiteScopeService siteScopeService)
            => _siteScopeService = siteScopeService ?? throw new ArgumentNullException(nameof(siteScopeService));

        [HttpGet]
        public async Task<IActionResult> Get([FromQuery] int storeId)
        {
            if (storeId <= 0)
                return BadRequest(new { error = "StoreId is required." });

            var sites = await _siteScopeService.ResolveSitesAsync(storeId);
            return Ok(sites);
        }
    }
}