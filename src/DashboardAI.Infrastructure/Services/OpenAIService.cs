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

        // ─────────────────────────────────────────────────────────────────────
        //  Generate full dashboard from a prompt
        // ─────────────────────────────────────────────────────────────────────
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

            // Server-side fallbacks — fill in whatever GPT left empty
            InferMissingConfigs(dto, availableDataSources);
            InferMissingAppliesFilters(dto);

            return dto;
        }

        // ─────────────────────────────────────────────────────────────────────
        //  Process a chat message and return delta commands
        // ─────────────────────────────────────────────────────────────────────
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

        // ─────────────────────────────────────────────────────────────────────
        //  Core HTTP call
        // ─────────────────────────────────────────────────────────────────────
        private async Task<string> CallOpenAIAsync(string systemPrompt, string userMessage)
        {
            var body = new
            {
                model       = Model,
                temperature = 0.2,
                messages    = new[]
                {
                    new { role = "system", content = systemPrompt },
                    new { role = "user",   content = userMessage  }
                }
            };

            var request = new HttpRequestMessage(HttpMethod.Post, ApiUrl)
            {
                Content = new StringContent(
                    JsonConvert.SerializeObject(body),
                    Encoding.UTF8,
                    "application/json")
            };
            request.Headers.Add("Authorization", $"Bearer {_apiKey}");

            var response = await _http.SendAsync(request);
            var json     = await response.Content.ReadAsStringAsync();

            if (!response.IsSuccessStatusCode)
                throw new HttpRequestException($"OpenAI API error {(int)response.StatusCode}: {json}");

            var parsed  = JObject.Parse(json);
            var content = parsed["choices"]?[0]?["message"]?["content"]?.ToString();

            if (string.IsNullOrWhiteSpace(content))
                throw new InvalidOperationException("OpenAI returned an empty response.");

            // Strip markdown code fences if present
            content = content.Trim();
            if (content.StartsWith("```json")) content = content.Substring(7);
            if (content.StartsWith("```"))     content = content.Substring(3);
            if (content.EndsWith("```"))       content = content.Substring(0, content.Length - 3);

            return content.Trim();
        }

        // ─────────────────────────────────────────────────────────────────────
        //  OpenAI Assistants API  (used when AssistantId is configured)
        // ─────────────────────────────────────────────────────────────────────

        // ─────────────────────────────────────────────────────────────────────
        //  OpenAI Responses API  (stored prompt with variables)
        // ─────────────────────────────────────────────────────────────────────

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

        private HttpRequestMessage AssistantRequest(HttpMethod method, string endpoint, object body = null)
        {
            var req = new HttpRequestMessage(method, $"{BaseUrl}{endpoint}");
            req.Headers.Add("Authorization", $"Bearer {_apiKey}");
            req.Headers.Add("OpenAI-Beta", "assistants=v2");
            if (body != null)
                req.Content = new StringContent(
                    JsonConvert.SerializeObject(body), Encoding.UTF8, "application/json");
            return req;
        }

        private async Task<string> CallOpenAIAssistantAsync(string assistantId, string userMessage)
        {
            // 1. Create thread
            var threadResp = await _http.SendAsync(
                AssistantRequest(HttpMethod.Post, "/threads", new { }));
            var threadId = JObject.Parse(await threadResp.Content.ReadAsStringAsync())["id"].ToString();

            // 2. Add user message
            await _http.SendAsync(
                AssistantRequest(HttpMethod.Post, $"/threads/{threadId}/messages",
                    new { role = "user", content = userMessage }));

            // 3. Create run
            var runResp = await _http.SendAsync(
                AssistantRequest(HttpMethod.Post, $"/threads/{threadId}/runs",
                    new { assistant_id = assistantId, temperature = 0.2 }));
            var runId = JObject.Parse(await runResp.Content.ReadAsStringAsync())["id"].ToString();

            // 4. Poll until terminal state
            string status;
            const int maxPollAttempts = 60;
            int attempts = 0;
            do
            {
                await Task.Delay(1500);
                var poll     = await _http.SendAsync(AssistantRequest(HttpMethod.Get, $"/threads/{threadId}/runs/{runId}"));
                var pollJson = JObject.Parse(await poll.Content.ReadAsStringAsync());
                status = pollJson["status"]?.ToString();

                if (++attempts >= maxPollAttempts)
                    throw new TimeoutException("OpenAI Assistant run timed out after 90 seconds.");
            }
            while (status == "queued" || status == "in_progress");

            if (status != "completed")
                throw new InvalidOperationException($"Assistant run ended with status: {status}");

            // 5. Retrieve the assistant reply (latest message)
            var msgsResp = await _http.SendAsync(
                AssistantRequest(HttpMethod.Get, $"/threads/{threadId}/messages?limit=1&order=desc"));
            var msgsJson = JObject.Parse(await msgsResp.Content.ReadAsStringAsync());
            var content  = msgsJson["data"]?[0]?["content"]?[0]?["text"]?["value"]?.ToString();

            if (string.IsNullOrWhiteSpace(content))
                throw new InvalidOperationException("Assistant returned an empty response.");

            // Strip optional markdown fences
            content = content.Trim();
            if (content.StartsWith("```json")) content = content.Substring(7);
            if (content.StartsWith("```"))     content = content.Substring(3);
            if (content.EndsWith("```"))       content = content.Substring(0, content.Length - 3);

            return content.Trim();
        }

        // User messages bundling dynamic context for Assistants API calls
        private static string BuildGenerateUserMessage(
            IEnumerable<DataSourceMetaDto> dataSources,
            string currentDateIso,
            int storeId,
            string userId,
            string userPrompt)
        {
            var dsJson = JsonConvert.SerializeObject(dataSources, Formatting.Indented);
            return $"Today: {currentDateIso}\nStoreId: {storeId}\nUserId: {userId}\n\n" +
                   $"AVAILABLE DATA SOURCES:\n{dsJson}\n\n" +
                   $"USER REQUEST:\n{userPrompt}";
        }

        private static string BuildChatUserMessage(
            string userMessage,
            DashboardDto currentDashboard,
            IEnumerable<DataSourceMetaDto> dataSources,
            string currentDateIso)
        {
            var dsJson   = JsonConvert.SerializeObject(dataSources,       Formatting.Indented);
            var dashJson = JsonConvert.SerializeObject(currentDashboard,  Formatting.Indented);
            return $"Today: {currentDateIso}\n\n" +
                   $"CURRENT DASHBOARD:\n{dashJson}\n\n" +
                   $"AVAILABLE DATA SOURCES:\n{dsJson}\n\n" +
                   $"USER: {userMessage}";
        }

        // ─────────────────────────────────────────────────────────────────────
        //  System prompts  (fallback — used when no AssistantId is configured)
        // ─────────────────────────────────────────────────────────────────────
        private string BuildGenerateSystemPrompt(
            IEnumerable<DataSourceMetaDto> dataSources,
            string currentDateIso)
        {
            var dsJson = JsonConvert.SerializeObject(dataSources, Formatting.Indented);

            return $@"You are a dashboard builder AI. Today's date is {currentDateIso}.

Generate a complete dashboard JSON. Every widget MUST have a fully populated config object — never leave config empty.

=== OUTPUT SCHEMA ===
{{
  ""id"": ""<guid>"",
  ""title"": ""<dashboard title>"",
  ""storeId"": <number>,
  ""userId"": ""<string>"",
  ""originalPrompt"": ""<the user prompt>"",
  ""filters"": [ ...filter objects... ],
  ""widgets"": [ ...widget objects... ]
}}

=== STEP 1: DECIDE WIDGET TYPE FROM THE TITLE ===
Look at the widget title and pick type + chartType:
- Title contains ""by [Category]"" or ""per [Category]""  => type=chart, chartType=bar
- Title contains ""over time"" or ""trend""               => type=chart, chartType=line
- Title contains ""distribution"" or ""breakdown""        => type=chart, chartType=pie
- Title contains ""total"", ""count"", ""average"", ""avg"" (single number) => type=kpi
- Title contains ""detail"", ""list"", ""report""           => type=table
- Title contains ""map"" or ""location""                  => type=map

=== STEP 2: POPULATE config BASED ON TYPE ===

--- CHART: config MUST contain xKey + aggregation ---
Look at the title to pick xKey. Match the ""by [X]"" phrase to the column name in the data source:
  ""by Type""        => xKey = HazardType  (or the column whose name contains ""Type"")
  ""by Department""  => xKey = Department
  ""by Status""      => xKey = Status
  ""by Location""    => xKey = Location
  ""by Programme""   => xKey = Programme
  ""by Sub-Type""    => xKey = SubType
  ""over Time""      => xKey = StartDt   (or the date column)
  ""by Person""      => xKey = PersonResponsible

For aggregation:
  - Default to aggregation=""count"" (count records per group, do NOT set yKey)
  - Use aggregation=""avg"" + yKey=""Score"" only when title mentions ""score"" or ""risk""
  - Use aggregation=""sum"" + yKey when title mentions ""total [numeric column]""

WRONG:  ""config"": {{}}
RIGHT:  ""config"": {{ ""xKey"": ""HazardType"", ""aggregation"": ""count"" }}

WRONG:  ""config"": {{ ""xKey"": ""InternalNo"" }}
RIGHT:  ""config"": {{ ""xKey"": ""Status"", ""aggregation"": ""count"" }}

--- KPI: config MUST contain valueKey ---
Choose the column that measures the KPI:
  ""Total [records]""     => valueKey = first non-ID string or count column, format=""number""
  ""Average/Avg Score""   => valueKey = Score, format=""number""
  ""Open [records]""      => valueKey = Status (KPI widget will show count), format=""number""
  ""Unique [something]""  => valueKey = that column, format=""number""

WRONG:  ""config"": {{}}
RIGHT:  ""config"": {{ ""valueKey"": ""Score"", ""format"": ""number"" }}

--- TABLE: config MUST contain columns ---
List 5-8 of the most useful columns from the data source, comma-separated. Exclude raw ID columns.

WRONG:  ""config"": {{}}
RIGHT:  ""config"": {{ ""columns"": ""StartDt,Status,HazardType,Department,Location,PersonResponsible,Score"" }}

--- MAP: config MUST contain latKey + lngKey ---
WRONG:  ""config"": {{}}
RIGHT:  ""config"": {{ ""latKey"": ""Lat"", ""lngKey"": ""Lng"", ""labelKey"": ""Location"" }}

=== STEP 3: OTHER WIDGET FIELDS ===

FILTER SCHEMA:
{{ ""id"": ""f1"", ""type"": ""dropdown|daterange|datepicker|text"",
   ""label"": ""..."", ""param"": ""..."", ""optionsSource"": ""<dataSourceName>"",
   ""valueKey"": ""<columnName>"", ""labelKey"": ""<columnName>"",
   ""isLocked"": false, ""defaultValue"": """" }}

POSITION RULES (12-column grid, no overlaps):
- KPI:   w=3, h=2
- Chart: w=6, h=4
- Table: w=12, h=5
- Map:   w=6, h=5
- Place KPIs in row y=0, charts in y=2, tables at the bottom.

AVAILABLE DATA SOURCES (use ONLY these, pick column names from their columns list):
{dsJson}

=== FINAL RULES ===
1. Always include a locked StoreId filter: {{ ""id"": ""f_store"", ""type"": ""dropdown"", ""label"": ""Store"", ""param"": ""StoreId"", ""isLocked"": true, ""defaultValue"": """" }}
2. config is NEVER an empty object {{}} for chart, kpi, or table widgets.
3. xKey must ALWAYS be a column that exists in the data source columns list.
4. Never use ID columns (InternalNo, RegOthID, HazardTemplateId) as xKey or valueKey.
5. Return ONLY valid JSON, no markdown, no explanation.";
        }

        private string BuildChatSystemPrompt(
            IEnumerable<DataSourceMetaDto> dataSources,
            string currentDateIso)
        {
            var dsJson = JsonConvert.SerializeObject(dataSources, Formatting.Indented);

            return $@"You are a dashboard modification AI. Today's date is {currentDateIso}.

You will receive the current dashboard JSON state and a user message.
Return a JSON array of delta commands to apply. Each command has this shape:
{{ ""action"": ""..."", ""widget"": {{...}}, ""filter"": {{...}}, ""targetId"": ""..."", ""value"": {{}}, ""title"": ""..."", ""explanation"": ""..."" }}

SUPPORTED ACTIONS:
- add_widget        → provide full widget object in ""widget""
- update_widget     → provide full updated widget in ""widget"" (same id)
- remove_widget     → provide target widget id in ""targetId""
- add_filter        → provide full filter object in ""filter""
- update_filter     → provide full updated filter in ""filter"" (same id)
- remove_filter     → provide target filter id in ""targetId""
- update_filter_value → provide filterId in ""targetId"", resolved values in ""value""
                        For daterange: {{""StartDate"":""yyyy-MM-dd"",""EndDate"":""yyyy-MM-dd""}}
                        For dropdown:  {{""value"":""5""}}
- update_title      → provide new title in ""title""

NATURAL LANGUAGE DATE RESOLUTION:
- Always resolve relative expressions to absolute ISO dates using today ({currentDateIso}).
- ""this quarter"" = current calendar quarter start/end dates.
- ""last month""   = first/last day of the previous month.
- ""YTD""          = Jan 1 of current year to today.

AVAILABLE DATA SOURCES:
{dsJson}

RULES:
- Do NOT change the StoreId locked filter.
- Return ONLY a valid JSON array. No markdown, no extra text.
- Always include a human-readable ""explanation"" in each command.";
        }

        // ─────────────────────────────────────────────────────────────────────
        //  Server-side fallbacks
        // ─────────────────────────────────────────────────────────────────────

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
            // Ordered keyword → preferred column name
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
