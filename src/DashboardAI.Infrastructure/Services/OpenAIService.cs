using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.Threading.Tasks;
using DashboardAI.Application.DTOs;
using DashboardAI.Application.Interfaces;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace DashboardAI.Infrastructure.Services
{
    public class OpenAIService : IOpenAIService
    {
        private const string BaseUrl = "https://api.openai.com/v1";

        private readonly HttpClient _http;
        private readonly string _apiKey;
        private readonly string _generatePromptId;
        private readonly string _chatPromptId;

        public OpenAIService(
            HttpClient http,
            string apiKey,
            string generatePromptId,
            string chatPromptId)
        {
            _http             = http            ?? throw new ArgumentNullException(nameof(http));
            _apiKey           = apiKey          ?? throw new ArgumentNullException(nameof(apiKey));
            _generatePromptId = generatePromptId ?? throw new ArgumentNullException(nameof(generatePromptId));
            _chatPromptId     = chatPromptId     ?? throw new ArgumentNullException(nameof(chatPromptId));
        }

        // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        //  Generate full dashboard from a prompt
        // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        public async Task<DashboardDto> GenerateDashboardAsync(
            string userPrompt,
            int storeId,
            string userId,
            IEnumerable<DataSourceMetaDto> availableDataSources,
            string currentDateIso)
        {
            var dsList = availableDataSources.ToList();
            var variables = new Dictionary<string, string>
            {
                ["iso_date"]         = currentDateIso,
                ["store_id"]         = storeId.ToString(),
                ["user_id"]          = userId,
                ["data_sources_json"]= JsonConvert.SerializeObject(dsList, Formatting.Indented),
                ["user_request"]     = userPrompt,
                ["guid"]             = Guid.NewGuid().ToString(),
                ["dashboard_title"]  = "",
                ["datasource_name"]  = dsList.FirstOrDefault()?.Name ?? "",
                ["column_name"]      = dsList.FirstOrDefault()?.Columns?.FirstOrDefault()?.Name ?? ""
            };
            var raw = await CallOpenAIResponsesAsync(_generatePromptId, variables);

            var dto = JsonConvert.DeserializeObject<DashboardDto>(raw);

            // Ensure server-controlled fields
            dto.StoreId = storeId;
            dto.UserId  = userId;

            // Always inject locked StoreId filter
            EnsureLockedStoreFilter(dto, storeId);

            // Server-side fallbacks â€” fill in whatever GPT left empty
            InferMissingConfigs(dto, availableDataSources);
            InferMissingAppliesFilters(dto);

            return dto;
        }

        // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        //  Process a chat message and return delta commands
        // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        public async Task<IEnumerable<ChatCommandDto>> SendChatMessageAsync(
            string userMessage,
            DashboardDto currentDashboard,
            IEnumerable<DataSourceMetaDto> availableDataSources,
            string currentDateIso)
        {
            var variables = new Dictionary<string, string>
            {
                ["iso_date"]               = currentDateIso,
                ["current_dashboard_json"] = JsonConvert.SerializeObject(currentDashboard, Formatting.Indented),
                ["data_sources_json"]      = JsonConvert.SerializeObject(availableDataSources, Formatting.Indented),
                ["user_message"]           = userMessage
            };
            var raw = await CallOpenAIResponsesAsync(_chatPromptId, variables);

            var commands = JsonConvert.DeserializeObject<List<ChatCommandDto>>(raw);
            return commands ?? new List<ChatCommandDto>();
        }

        // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        //  OpenAI Responses API
        // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        private async Task<string> CallOpenAIResponsesAsync(
            string promptId,
            Dictionary<string, string> variables)
        {
            var body = new
            {
                prompt = new
                {
                    id        = promptId,
                    version   = "1",
                    variables = variables
                }
            };

            var request = new HttpRequestMessage(HttpMethod.Post, $"{BaseUrl}/responses")
            {
                Content = new StringContent(
                    JsonConvert.SerializeObject(body), Encoding.UTF8, "application/json")
            };
            request.Headers.Add("Authorization", $"Bearer {_apiKey}");

            var response = await _http.SendAsync(request);
            var json     = await response.Content.ReadAsStringAsync();

            if (!response.IsSuccessStatusCode)
                throw new HttpRequestException($"OpenAI Responses API error {(int)response.StatusCode}: {json}");

            var parsed  = JObject.Parse(json);
            // Responses API shape: output[0].content[0].text
            var content = parsed["output"]?[0]?["content"]?[0]?["text"]?.ToString();

            if (string.IsNullOrWhiteSpace(content))
                throw new InvalidOperationException("OpenAI Responses API returned empty content.");

            content = content.Trim();
            if (content.StartsWith("```json")) content = content.Substring(7);
            if (content.StartsWith("```"))     content = content.Substring(3);
            if (content.EndsWith("```"))       content = content.Substring(0, content.Length - 3);

            return content.Trim();
        }

        //  Server-side fallbacks
        // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

        private static readonly HashSet<string> _idColumns = new HashSet<string>(
            new[] { "InternalNo", "RegOthID", "StoreID", "StoreId", "HazardTemplateId" },
            StringComparer.OrdinalIgnoreCase);

        private void InferMissingConfigs(
            DashboardDto dto,
            IEnumerable<DataSourceMetaDto> dataSources)
        {
            var dsMap = dataSources.ToDictionary(
                d => d.Name, d => d, StringComparer.OrdinalIgnoreCase);

            foreach (var w in dto.Widgets ?? new List<WidgetDto>())
            {
                if (w.Config != null && w.Config.Count > 0) continue;
                if (w.Config == null) w.Config = new Dictionary<string, string>();

                if (!dsMap.TryGetValue(w.DataSource ?? "", out var ds)) continue;

                var title = (w.Title ?? "").ToLower();
                var cols  = ds.Columns ?? new List<ColumnMetaDto>();

                switch ((w.Type ?? "").ToLower())
                {
                    case "chart":
                        w.Config["xKey"] = InferXKey(title, cols);
                        if (title.Contains("avg") || title.Contains("average") || title.Contains("score"))
                        {
                            w.Config["aggregation"] = "avg";
                            var num = cols.FirstOrDefault(c =>
                                string.Equals(c.DataType, "number", StringComparison.OrdinalIgnoreCase) &&
                                !_idColumns.Contains(c.Name));
                            if (num != null) w.Config["yKey"] = num.Name;
                        }
                        else
                        {
                            w.Config["aggregation"] = "count";
                        }
                        break;

                    case "kpi":
                        if (title.Contains("score") || title.Contains("avg") || title.Contains("average"))
                        {
                            var sc = cols.FirstOrDefault(c =>
                                string.Equals(c.Name, "Score", StringComparison.OrdinalIgnoreCase));
                            w.Config["valueKey"]    = sc?.Name ?? "Score";
                            w.Config["aggregation"] = "avg";
                        }
                        else
                        {
                            w.Config["valueKey"] = "count";
                        }
                        w.Config["format"] = "number";
                        break;

                    case "table":
                        var tcols = cols
                            .Where(c => !_idColumns.Contains(c.Name))
                            .Take(8)
                            .Select(c => c.Name);
                        w.Config["columns"] = string.Join(",", tcols);
                        break;
                }
            }
        }

        private static string InferXKey(string title, List<ColumnMetaDto> cols)
        {
            // Ordered keyword â†’ preferred column name
            var hints = new[]
            {
                ("hazard type",    "HazardType"),
                ("by type",        "HazardType"),
                ("by status",      "Status"),
                ("by department",  "Department"),
                ("department",     "Department"),
                ("by location",    "Location"),
                ("location",       "Location"),
                ("by programme",   "Programme"),
                ("programme",      "Programme"),
                ("by program",     "Programme"),
                ("by person",      "PersonResponsible"),
                ("responsible",    "PersonResponsible"),
                ("over time",      "StartDt"),
                ("by date",        "StartDt"),
                ("trend",          "StartDt"),
                ("by sub",         "SubType"),
                ("sub-type",       "SubType"),
                ("subtype",        "SubType"),
                ("by division",    "Division"),
                ("division",       "Division"),
                ("by checklist",   "Checklist"),
                ("checklist",      "Checklist"),
                ("by hazard",      "Hazard"),
                ("status",         "Status"),
            };

            foreach (var (keyword, colName) in hints)
            {
                if (title.Contains(keyword))
                {
                    var match = cols.FirstOrDefault(c =>
                        string.Equals(c.Name, colName, StringComparison.OrdinalIgnoreCase));
                    if (match != null) return match.Name;
                }
            }

            // Fallback: first non-ID string column
            var fallback = cols.FirstOrDefault(c =>
                string.Equals(c.DataType, "string", StringComparison.OrdinalIgnoreCase) &&
                !_idColumns.Contains(c.Name));
            return fallback?.Name ?? cols.FirstOrDefault()?.Name ?? "Status";
        }

        private static void InferMissingAppliesFilters(DashboardDto dto)
        {
            var nonLocked = (dto.Filters ?? new List<FilterDto>())
                .Where(f => !f.IsLocked)
                .Select(f => f.Id)
                .ToList();

            if (!nonLocked.Any()) return;

            foreach (var w in dto.Widgets ?? new List<WidgetDto>())
            {
                if (w.AppliesFilters == null || w.AppliesFilters.Count == 0)
                    w.AppliesFilters = new List<string>(nonLocked);
            }
        }

        private static void EnsureLockedStoreFilter(DashboardDto dto, int storeId)
        {
            if (dto.Filters == null) dto.Filters = new List<FilterDto>();

            if (!dto.Filters.Any(f => f.IsLocked && f.Param == "StoreId"))
            {
                dto.Filters.Insert(0, new FilterDto
                {
                    Id           = "f_store",
                    Type         = "dropdown",
                    Label        = "Store",
                    Param        = "StoreId",
                    IsLocked     = true,
                    DefaultValue = storeId.ToString()
                });
            }
        }
    }
}
