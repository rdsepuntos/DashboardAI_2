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
        private readonly string _generatePromptVersion;
        private readonly string _chatPromptId;
        private readonly string _chatPromptVersion;

        public OpenAIService(
            HttpClient http,
            string apiKey,
            string generatePromptId,
            string generatePromptVersion,
            string chatPromptId,
            string chatPromptVersion)
        {
            _http                  = http                  ?? throw new ArgumentNullException(nameof(http));
            _apiKey                = apiKey                ?? throw new ArgumentNullException(nameof(apiKey));
            _generatePromptId      = generatePromptId      ?? throw new ArgumentNullException(nameof(generatePromptId));
            _generatePromptVersion = generatePromptVersion ?? "4";
            _chatPromptId          = chatPromptId          ?? throw new ArgumentNullException(nameof(chatPromptId));
            _chatPromptVersion     = chatPromptVersion     ?? "6";
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
                ["dashboard_title"]  = ""
            };
            var raw = await CallOpenAIResponsesAsync(_generatePromptId, _generatePromptVersion, variables);

            // Normalise flat x/y/w/h at widget root → nested "position" object,
            // in case GPT returns { "x":0,"y":0,"w":3,"h":2 } instead of
            // { "position":{"x":0,"y":0,"w":3,"h":2} }
            raw = NormalizeFlatPositionsInJson(raw);

            var dto = JsonConvert.DeserializeObject<DashboardDto>(raw,
                new FlatStringDictConverter());

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

            var raw = await CallOpenAIResponsesAsync(_chatPromptId, _chatPromptVersion, variables);

            var commands = JsonConvert.DeserializeObject<List<ChatCommandDto>>(raw);
            return commands ?? new List<ChatCommandDto>();
        }

        // ────────────────────────────────────────────────────────────────────────
        //  Generate AI insights / descriptions for each widget (chat/completions)
        // ────────────────────────────────────────────────────────────────────────
        public async Task<Dictionary<string, WidgetInsight>> DescribeWidgetsAsync(
            string dashboardTitle,
            IEnumerable<WidgetDescribeItem> widgets)
        {
            var list = widgets?.ToList() ?? new List<WidgetDescribeItem>();
            var widgetLines = string.Join("\n", list.Select((w, i) =>
                $"{i + 1}. [{w.Type}{(string.IsNullOrEmpty(w.ChartType) ? "" : "/" + w.ChartType)}] \"{w.Title}\"" +
                (string.IsNullOrWhiteSpace(w.CurrentValue) ? "" : $" — current value: {w.CurrentValue}")));

            var systemMsg = "You are a Workplace Health & Safety reporting analyst. Write concise, factual, professional insights suitable for printed WHS reports. Return ONLY valid JSON.";
            var userMsg   = $"Dashboard: \"{dashboardTitle}\"\n\n" +
                            "For each widget listed below, write a professional insight and recommend a print-report layout.\n\n" +
                            $"Widgets:\n{widgetLines}\n\n" +
                            "Return ONLY a JSON object where each key is exactly the widget title and each value is an object with two fields:\n" +
                            "- \"description\": a 1-2 sentence professional WHS insight explaining what the widget shows and any notable safety observations.\n" +
                            "- \"layout\": choose one of \"right\" (chart left, insight right — good for bar/line charts with clear trends), \"left\" (insight left, chart right — good for summary-first presentation), \"bottom\" (chart top, insight below — good for donut/gauge/smaller charts), or \"full\" (chart only, no insight — good for tables, KPIs, heatmaps, or widgets that need full width).";

            var body = new
            {
                model    = "gpt-4o-mini",
                messages = new object[]
                {
                    new { role = "system", content = systemMsg },
                    new { role = "user",   content = userMsg   }
                },
                response_format = new { type = "json_object" }
            };

            var req = new HttpRequestMessage(HttpMethod.Post, $"{BaseUrl}/chat/completions")
            {
                Content = new StringContent(JsonConvert.SerializeObject(body), Encoding.UTF8, "application/json")
            };
            req.Headers.Add("Authorization", $"Bearer {_apiKey}");

            var response = await _http.SendAsync(req);
            var json     = await response.Content.ReadAsStringAsync();

            if (!response.IsSuccessStatusCode)
                throw new HttpRequestException($"OpenAI error {(int)response.StatusCode}: {json}");

            var parsed  = JObject.Parse(json);
            var content = parsed["choices"]?[0]?["message"]?["content"]?.ToString();

            if (string.IsNullOrWhiteSpace(content))
                throw new InvalidOperationException($"OpenAI returned empty content. Raw: {json}");

            return JsonConvert.DeserializeObject<Dictionary<string, WidgetInsight>>(content)
                   ?? new Dictionary<string, WidgetInsight>();
        }

        // ────────────────────────────────────────────────────────────────────────
        //  POST /api/report/insights — executive summary + per-widget insights
        //  Accepts richer ReportWidgetItem descriptors (table columns, sample rows)
        // ────────────────────────────────────────────────────────────────────────
        public async Task<ReportInsightsResult> GenerateReportInsightsAsync(
            string dashboardTitle,
            IEnumerable<ReportWidgetItem> widgets,
            Dictionary<string, string> activeFilters = null)
        {
            var list = widgets?.ToList() ?? new List<ReportWidgetItem>();

            // Build a rich, human-readable widget listing for the prompt
            var sb = new StringBuilder();
            for (int i = 0; i < list.Count; i++)
            {
                var w = list[i];
                sb.Append($"{i + 1}. [{w.Type}] \"{w.Title}\"");
                if (!string.IsNullOrWhiteSpace(w.CurrentValue))
                    sb.Append($" — value: {w.CurrentValue}");
                if (w.RowCount.HasValue)
                    sb.Append($" — {w.RowCount} records");
                if (w.Columns != null && w.Columns.Count > 0)
                {
                    sb.Append($"\n   Columns: {string.Join(", ", w.Columns)}");
                    if (w.SampleRows != null && w.SampleRows.Count > 0)
                    {
                        sb.Append("\n   Sample rows:");
                        foreach (var row in w.SampleRows.Take(5))
                            sb.Append($"\n     - {string.Join(" | ", row)}");
                    }
                }
                if (w.SeriesData != null && w.SeriesData.Count > 0)
                {
                    foreach (var series in w.SeriesData.Take(3))
                    {
                        var sname = string.IsNullOrWhiteSpace(series.SeriesName) ? "Series" : series.SeriesName;
                        var pts   = (series.Labels ?? new List<string>())
                                    .Zip(series.Values ?? new List<string>(), (l, v) => $"{l}={v}")
                                    .Take(10);
                        sb.Append($"\n   {sname}: {string.Join(", ", pts)}");
                    }
                }
                sb.AppendLine();
            }

            // Active filter context sent to GPT as additional framing
            var filterContext = (activeFilters != null && activeFilters.Count > 0)
                ? "Active filters: " + string.Join(", ", activeFilters.Select(kv => $"{kv.Key}: {kv.Value}")) + "\n\n"
                : "";

            var systemMsg =
                "You are a Workplace Health & Safety reporting analyst. " +
                "Write concise, factual, professional insights suitable for printed WHS management reports. " +
                "Return ONLY valid JSON — no markdown, no code fences.";

            var userMsg =
                $"Dashboard: \"{dashboardTitle}\"\n\n" +
                filterContext +
                "Generate an executive summary, key findings, and individual widget insights for a professional printed WHS report.\n\n" +
                $"Widgets:\n{sb}\n" +
                "Return ONLY a JSON object with exactly three fields:\n" +
                "1. \"executiveSummary\": a 2-3 sentence professional WHS executive summary that references the dashboard title, " +
                "highlights key KPI values where present, and notes any notable trends or risk signals.\n" +
                "2. \"keyFindings\": an array of 3-5 concise plain-text bullet strings (no markdown, no dashes) " +
                "summarising the most important WHS observations across the whole dashboard.\n" +
                "3. \"descriptions\": an object where each key is exactly the widget title and each value has:\n" +
                "   - \"description\": a 1-2 sentence WHS insight explaining what the widget shows and any safety observation.\n" +
                "   - \"layout\": one of \"right\" (chart left, text right \u2014 bar/line trends), " +
                "\"left\" (text left, chart right \u2014 summary-first), " +
                "\"bottom\" (chart top, text below \u2014 donut/gauge), " +
                "or \"full\" (chart only \u2014 tables, KPIs, heatmaps).";

            var body = new
            {
                model    = "gpt-4o-mini",
                messages = new object[]
                {
                    new { role = "system", content = systemMsg },
                    new { role = "user",   content = userMsg   }
                },
                response_format = new { type = "json_object" }
            };

            var req = new HttpRequestMessage(HttpMethod.Post, $"{BaseUrl}/chat/completions")
            {
                Content = new StringContent(JsonConvert.SerializeObject(body), Encoding.UTF8, "application/json")
            };
            req.Headers.Add("Authorization", $"Bearer {_apiKey}");

            var response = await _http.SendAsync(req);
            var json     = await response.Content.ReadAsStringAsync();

            if (!response.IsSuccessStatusCode)
                throw new HttpRequestException($"OpenAI error {(int)response.StatusCode}: {json}");

            var parsed  = JObject.Parse(json);
            var content = parsed["choices"]?[0]?["message"]?["content"]?.ToString();

            if (string.IsNullOrWhiteSpace(content))
                throw new InvalidOperationException($"OpenAI returned empty content. Raw: {json}");

            var root = JObject.Parse(content);
            return new ReportInsightsResult
            {
                ExecutiveSummary = root["executiveSummary"]?.ToString() ?? "",
                KeyFindings      = root["keyFindings"]?.ToObject<List<string>>() ?? new List<string>(),
                Descriptions     = root["descriptions"]?.ToObject<Dictionary<string, WidgetInsight>>()
                                   ?? new Dictionary<string, WidgetInsight>()
            };
        }

        // ─────────────────────────────────────────────────────────────────────
        //  OpenAI Responses API
        // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        private async Task<string> CallOpenAIResponsesAsync(
            string promptId,
            string promptVersion,
            Dictionary<string, string> variables,
            string input = null)
        {
            object body;
            if (input != null)
            {
                body = new
                {
                    prompt = new
                    {
                        id        = promptId,
                        version   = promptVersion,
                        variables = variables
                    },
                    input
                };
            }
            else
            {
                body = new
                {
                    prompt = new
                    {
                        id        = promptId,
                        version   = promptVersion,
                        variables = variables
                    }
                };
            }

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

            // output[] may contain a reasoning block before the message block.
            // Find the first item with type == "message".
            var outputArray = parsed["output"] as JArray;
            var messageItem = outputArray?
                .FirstOrDefault(o => o["type"]?.ToString() == "message");
            var content = messageItem?["content"]?[0]?["text"]?.ToString();

            if (string.IsNullOrWhiteSpace(content))
                throw new InvalidOperationException(
                    $"OpenAI Responses API returned empty content. Raw response: {json}");

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

        // ─────────────────────────────────────────────────────────────────────
        //  Custom converter: Dictionary<string,string> that tolerates object/array values
        //  by serialising them back to their JSON string representation.
        // ─────────────────────────────────────────────────────────────────────
        // ─────────────────────────────────────────────────────────────────────
        //  If GPT returned flat x/y/w/h at widget root instead of a nested
        //  "position" object, promote them before deserialisation.
        // ─────────────────────────────────────────────────────────────────────
        private static string NormalizeFlatPositionsInJson(string raw)
        {
            try
            {
                var root = JObject.Parse(raw);
                var widgets = root["widgets"] as JArray;
                if (widgets == null) return raw;

                foreach (var w in widgets)
                {
                    // If a proper "position" object is already present, skip.
                    if (w["position"] is JObject pos &&
                        pos["w"] != null && (int)pos["w"] > 0)
                        continue;

                    // Read flat properties (default 0 if missing)
                    int x = w["x"] != null ? (int)w["x"] : 0;
                    int y = w["y"] != null ? (int)w["y"] : 0;
                    int wVal = w["w"] != null ? (int)w["w"] : 0;
                    int h = w["h"] != null ? (int)w["h"] : 0;

                    // Apply type-based defaults if still zero
                    var type = (w["type"]?.ToString() ?? "").ToLower();
                    if (wVal == 0) wVal = type == "kpi" ? 3 : type == "table" ? 12 : 6;
                    if (h == 0)    h    = type == "kpi" ? 2 : type == "table" ? 5  : 4;

                    // Write nested position and remove flat properties
                    ((JObject)w)["position"] = new JObject(
                        new JProperty("x", x),
                        new JProperty("y", y),
                        new JProperty("w", wVal),
                        new JProperty("h", h));

                    ((JObject)w).Remove("x");
                    ((JObject)w).Remove("y");
                    ((JObject)w).Remove("w");
                    ((JObject)w).Remove("h");
                }

                return root.ToString(Formatting.None);
            }
            catch
            {
                return raw; // If anything fails, return unchanged and let normal parsing handle it
            }
        }

        private class FlatStringDictConverter : JsonConverter
        {
            public override bool CanConvert(Type objectType)
                => objectType == typeof(Dictionary<string, string>);

            public override object ReadJson(JsonReader reader, Type objectType,
                object existingValue, JsonSerializer serializer)
            {
                if (reader.TokenType == JsonToken.Null) return null;

                var result = new Dictionary<string, string>();
                var jObj   = JObject.Load(reader);

                foreach (var prop in jObj.Properties())
                {
                    // If the value is a simple scalar, use its string representation.
                    // If it's an object or array, serialise it back to a JSON string.
                    var val = prop.Value;
                    result[prop.Name] = (val.Type == JTokenType.Object || val.Type == JTokenType.Array)
                        ? val.ToString(Formatting.None)
                        : val.Value<string>();
                }

                return result;
            }

            public override void WriteJson(JsonWriter writer, object value,
                JsonSerializer serializer)
                => serializer.Serialize(writer, value);
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
