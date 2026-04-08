using DashboardAI.Infrastructure;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Swashbuckle.AspNetCore.Swagger;

namespace DashboardAI.API
{
    public class Startup
    {
        public IConfiguration Configuration { get; }

        public Startup(IConfiguration configuration)
            => Configuration = configuration;

        public void ConfigureServices(IServiceCollection services)
        {
            services
                .AddMvc()
                .AddJsonOptions(opt =>
                {
                    opt.SerializerSettings.NullValueHandling    = Newtonsoft.Json.NullValueHandling.Ignore;
                    opt.SerializerSettings.DateFormatString     = "yyyy-MM-ddTHH:mm:ssZ";
                    opt.SerializerSettings.ContractResolver     =
                        new Newtonsoft.Json.Serialization.CamelCasePropertyNamesContractResolver();
                });

            services.AddCors(o => o.AddPolicy("AllowAll", b =>
                b.SetIsOriginAllowed(_ => true)
                 .AllowAnyMethod()
                 .AllowAnyHeader()
                 .AllowCredentials()));

            services.AddSwaggerGen(c =>
            {
                c.SwaggerDoc("v1", new Info
                {
                    Title       = "DashboardAI API",
                    Version     = "v1",
                    Description = "AI-powered dashboard builder — generate and manage dashboards via chat."
                });
            });

            services.AddInfrastructure(Configuration);
        }

        public void Configure(IApplicationBuilder app, IHostingEnvironment env)
        {
            // CORS must be first so the header is present even on error responses
            app.UseCors("AllowAll");

            if (env.IsDevelopment())
                app.UseDeveloperExceptionPage();

            app.UseSwagger();
            app.UseSwaggerUI(c =>
            {
                c.SwaggerEndpoint("/swagger/v1/swagger.json", "DashboardAI API v1");
                c.RoutePrefix = "swagger";
            });

            // Serve static frontend files from wwwroot
            app.UseStaticFiles();

            app.UseMvc();
        }
    }
}
