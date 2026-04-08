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
        private const string Model = "gpt-5.4";
        private const string ApiUrl = "https://api.openai.com/v1/chat/completions";

        private readonly HttpClient _http;
        private readonly string _apiKey;

        public OpenAIService(HttpClient http, string apiKey)
        {
            _http   = http   ?? throw new ArgumentNullException(nameof(http));
            _apiKey = apiKey ?? throw new ArgumentNullException(nameof(apiKey));
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
            string systemPrompt = BuildGenerateSystemPrompt(availableDataSources, currentDateIso);
            string userMessage  = $"StoreId: {storeId}\nUserId: {userId}\n\n{userPrompt}";

            var raw = await CallOpenAIAsync(systemPrompt, userMessage);
            var dto = JsonConvert.DeserializeObject<DashboardDto>(raw);

            // Ensure server-controlled fields
            dto.StoreId = storeId;
            dto.UserId  = userId;

            // Always inject locked StoreId filter
            EnsureLockedStoreFilter(dto, storeId);

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
            string systemPrompt = BuildChatSystemPrompt(availableDataSources, currentDateIso);
            string context      = $"CURRENT DASHBOARD STATE:\n{JsonConvert.SerializeObject(currentDashboard, Formatting.Indented)}\n\nUSER: {userMessage}";

            var raw      = await CallOpenAIAsync(systemPrompt, context);
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
        //  System prompts
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
