using System.Net.Http;
using DashboardAI.Application.Interfaces;
using DashboardAI.Application.UseCases.GenerateDashboard;
using DashboardAI.Application.UseCases.GetDashboard;
using DashboardAI.Application.UseCases.QueryWidgetData;
using DashboardAI.Application.UseCases.SendChatMessage;
using DashboardAI.Domain.Interfaces;
using DashboardAI.Infrastructure.DataSources;
using DashboardAI.Infrastructure.Repositories;
using DashboardAI.Infrastructure.Services;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace DashboardAI.Infrastructure
{
    public static class DependencyInjection
    {
        public static IServiceCollection AddInfrastructure(
            this IServiceCollection services,
            IConfiguration configuration)
        {
            var connString = configuration.GetConnectionString("DefaultConnection");
            var openAiKey  = configuration["OpenAI:ApiKey"];

            // ── Repositories ──────────────────────────────────────────────────
            services.AddScoped<IDashboardRepository>(_ => new DashboardRepository(connString));

            // ── Data Source Registry (singleton — loaded from SQL at startup) ─
            //  To add a new view or stored procedure, INSERT a row into the
            //  DataSourceRegistry SQL table — no code changes needed here.
            services.AddSingleton<IDataSourceRegistry>(sp =>
            {
                var registry = new DataSourceRegistry();
                SqlDataSourceRegistryLoader.LoadAsync(registry, connString)
                    .GetAwaiter()
                    .GetResult();
                return registry;
            });

            // ── Services ──────────────────────────────────────────────────────
            services.AddScoped<IWidgetDataService>(sp => new WidgetDataService(
                connString,
                sp.GetRequiredService<IDataSourceRegistry>()));

            services.AddSingleton<IOpenAIService>(_ => new OpenAIService(
                new HttpClient(),
                openAiKey));

            // ── Application Use Cases ─────────────────────────────────────────
            services.AddScoped<GenerateDashboardHandler>();
            services.AddScoped<SendChatMessageHandler>();
            services.AddScoped<GetDashboardHandler>();
            services.AddScoped<QueryWidgetDataHandler>();

            return services;
        }
    }
}
