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
            var connString        = configuration.GetConnectionString("DefaultConnection");
            var openAiKey         = configuration["OpenAI:ApiKey"];
            var generatePromptId      = configuration["OpenAI:GeneratePromptId"];
            var generatePromptVersion = configuration["OpenAI:GeneratePromptVersion"] ?? "1";
            var chatPromptId          = configuration["OpenAI:ChatPromptId"];
            var chatPromptVersion     = configuration["OpenAI:ChatPromptVersion"] ?? "1";

            // ── Repositories ──────────────────────────────────────────────────
            services.AddScoped<IDashboardRepository>(_ => new DashboardRepository(connString));
            // AI usage logger — writes to Agtech_Usermgmt.dbo.AIUsageLog via 3-part name.
            services.AddSingleton<IAiUsageLogger>(_ => new AiUsageLogger(connString));
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
            services.AddScoped<ISiteScopeService>(_ => new SiteScopeService(connString));

            // Per-account column captions (field names) resolved via spPageFields.
            var pageFieldOptions = BindPageFieldOptions(configuration.GetSection("PageFields"));
            services.AddSingleton<IColumnCaptionService>(_ =>
                new ColumnCaptionService(connString, pageFieldOptions));

            services.AddSingleton<IOpenAIService>(sp => new OpenAIService(
                new HttpClient(),
                openAiKey,
                generatePromptId,
                generatePromptVersion,
                chatPromptId,
                chatPromptVersion,
                sp.GetRequiredService<IAiUsageLogger>()));

            services.AddScoped<IEmailService>(sp =>
                new EmailService(configuration));

            services.AddScoped<ISendReportService>(sp =>
                new SendReportService(
                    connString,
                    sp.GetRequiredService<IEmailService>(),
                    configuration));

            // ── Application Use Cases ─────────────────────────────────────────
            services.AddScoped<GenerateDashboardHandler>();
            services.AddScoped<SendChatMessageHandler>();
            services.AddScoped<GetDashboardHandler>();
            services.AddScoped<QueryWidgetDataHandler>();

            return services;
        }

        // Manual binding — the config Binder package is not referenced in this project.
        private static Services.PageFieldOptions BindPageFieldOptions(IConfigurationSection section)
        {
            var options = new Services.PageFieldOptions();
            if (section == null || !section.Exists()) return options;

            if (!string.IsNullOrWhiteSpace(section["ProcedureName"]))
                options.ProcedureName = section["ProcedureName"];
            if (!string.IsNullOrWhiteSpace(section["ApplicationName"]))
                options.ApplicationName = section["ApplicationName"];
            if (int.TryParse(section["DefaultParentPageId"], out var parentPageId))
                options.DefaultParentPageId = parentPageId;
            if (int.TryParse(section["DefaultUCPageId"], out var ucPageId))
                options.DefaultUCPageId = ucPageId;

            foreach (var map in section.GetSection("Mappings").GetChildren())
            {
                var mapping = new Services.PageFieldMapping();
                if (int.TryParse(map["RegisterTypeId"], out var regTypeId))
                    mapping.RegisterTypeId = regTypeId;
                if (int.TryParse(map["ParentPageId"], out var mapParent))
                    mapping.ParentPageId = mapParent;
                if (int.TryParse(map["UCPageId"], out var mapUc))
                    mapping.UCPageId = mapUc;
                mapping.RefKey = map["RefKey"];
                options.Mappings[map.Key] = mapping;
            }

            return options;
        }
    }
}
