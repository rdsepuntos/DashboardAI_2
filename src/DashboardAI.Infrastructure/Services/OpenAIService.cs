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

Your job is to generate a complete dashboard layout as a JSON object matching this exact schema:
{{
  ""id"": ""<guid>"",
  ""title"": ""<dashboard title>"",
  ""storeId"": <number>,
  ""userId"": ""<string>"",
  ""originalPrompt"": ""<the user's prompt>"",
  ""filters"": [ ...FilterDto array... ],
  ""widgets"":  [ ...WidgetDto array... ]
}}

FILTER SCHEMA:
{{ ""id"": ""f1"", ""type"": ""dropdown|daterange|datepicker|text|multiselect"",
   ""label"": ""..."", ""param"": ""..."", ""optionsSource"": ""..."",
   ""valueKey"": ""..."", ""labelKey"": ""..."", ""isLocked"": false, ""defaultValue"": ""..."" }}

WIDGET SCHEMA:
{{ ""id"": ""w1"", ""type"": ""chart|table|kpi|map|markdown"",
   ""chartType"": ""bar|line|pie|area"", ""title"": ""..."",
   ""dataSource"": ""..."", ""appliesFilters"": [""f1""],
   ""position"": {{ ""x"": 0, ""y"": 0, ""w"": 6, ""h"": 4 }},
   ""config"": {{ ""xKey"": ""..."", ""yKey"": ""..."" }} }}

POSITION RULES:
- Grid is 12 columns wide.
- KPI cards: w=3, h=2. Charts: w=6, h=4. Tables: w=12, h=5. Maps: w=6, h=5.
- Arrange widgets so they don't overlap. Use y values to stack rows.

KPI CONFIG KEYS: valueKey, format (currency|number|percent), prefix, suffix
CHART CONFIG KEYS:
  xKey        — MUST be a column that represents the CATEGORY or GROUPING dimension.
                Examples: HazardType, Department, Status, SubType, Location, Programme.
                NEVER use ID columns (InternalNo, RegOthID, StoreID, HazardTemplateId) as xKey.
  yKey        — the numeric column to aggregate (Score, Count, etc.).
                Omit yKey when you want to COUNT records per group (see aggregation below).
  aggregation — how to roll-up rows that share the same xKey value:
                  "count" → count records per xKey group (use when yKey is omitted)
                  "sum"   → sum yKey values per group (default when yKey is set)
                  "avg"   → average yKey values per group
  For "Hazards By Type"       → xKey="HazardType",  aggregation="count"
  For "Hazards By Department" → xKey="Department",  aggregation="count"
  For "Reports By Status"     → xKey="Status",      aggregation="count"
  For "Reports Over Time"     → xKey="StartDt",     yKey=<omit>, aggregation="count", chartType="line"
  For score-based charts      → xKey=<category>,   yKey="Score", aggregation="avg"

TABLE CONFIG KEYS: columns (comma-separated list)
MAP CONFIG KEYS: latKey, lngKey, labelKey

AVAILABLE DATA SOURCES:
{dsJson}

IMPORTANT RULES:
- Only use data sources from the list above.
- Always add a locked StoreId filter: {{ ""id"": ""f_store"", ""type"": ""dropdown"", ""label"": ""Store"", ""param"": ""StoreId"", ""isLocked"": true }}.
- For every chart widget, always set xKey to a MEANINGFUL CATEGORY column — never an ID or reference number.
- Return ONLY valid JSON. No markdown, no explanation text.";
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
