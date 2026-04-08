using System.IO;
using Microsoft.AspNetCore.Mvc;

namespace DashboardAI.API.Controllers
{
    /// <summary>
    /// Serves the static HTML shell for the generator and dashboard pages.
    /// </summary>
    public class HomeController : Controller
    {
        // GET /
        [HttpGet("/")]
        public IActionResult Index() => PhysicalFile(
            System.IO.Path.Combine(Directory.GetCurrentDirectory(), "wwwroot", "index.html"),
            "text/html");

        // GET /dashboard/{id}
        // Serves the dashboard shell; JS bootstraps via the ID in the URL path.
        [HttpGet("/dashboard/{id}")]
        public IActionResult Dashboard(string id) => PhysicalFile(
            System.IO.Path.Combine(Directory.GetCurrentDirectory(), "wwwroot", "dashboard.html"),
            "text/html");
    }
}
