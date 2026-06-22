using System;
using System.Collections.Generic;
using System.Diagnostics;
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

        private readonly HttpClient      _http;
        private readonly string          _apiKey;
        private readonly string          _generatePromptId;
        private readonly string          _generatePromptVersion;
        private readonly string          _chatPromptId;
        private readonly string          _chatPromptVersion;
        private readonly IAiUsageLogger  _usageLogger;

        public OpenAIService(
            HttpClient http,
            string apiKey,
            string generatePromptId,
            string generatePromptVersion,
            string chatPromptId,
            string chatPromptVersion,
            IAiUsageLogger usageLogger = null)
        {
            _http                  = http                  ?? throw new ArgumentNullException(nameof(http));
            _apiKey                = apiKey                ?? throw new ArgumentNullException(nameof(apiKey));
            _generatePromptId      = generatePromptId      ?? throw new ArgumentNullException(nameof(generatePromptId));
            _generatePromptVersion = generatePromptVersion ?? "4";
            _chatPromptId          = chatPromptId          ?? throw new ArgumentNullException(nameof(chatPromptId));
            _chatPromptVersion     = chatPromptVersion     ?? "6";
            _usageLogger           = usageLogger; // optional — null means "don't log"
        }

        // ─────────────────────────────────────────────────────────────────────
        //  Token pricing (USD per token).  Values mirror chat.js PRICING and
        //  are used to compute InputCostUsd / OutputCostUsd for AIUsageLog.
        //  Update here whenever OpenAI changes published pricing.
        // ─────────────────────────────────────────────────────────────────────
        private static readonly Dictionary<string, (decimal Input, decimal Output)> _pricing =
            new Dictionary<string, (decimal, decimal)>(StringComparer.OrdinalIgnoreCase)
        {
            ["gpt-4o"]        = (2.50m  / 1_000_000m, 10.00m / 1_000_000m),
            ["gpt-4o-mini"]   = (0.15m  / 1_000_000m, 0.60m  / 1_000_000m),
            ["gpt-4.1"]       = (2.00m  / 1_000_000m, 8.00m  / 1_000_000m),
            ["gpt-4.1-mini"]  = (0.40m  / 1_000_000m, 1.60m  / 1_000_000m),
            ["gpt-4.1-nano"]  = (0.10m  / 1_000_000m, 0.40m  / 1_000_000m),
            ["gpt-5"]              = (1.25m  / 1_000_000m, 10.00m / 1_000_000m),
            ["gpt-5-mini"]         = (0.25m  / 1_000_000m, 2.00m  / 1_000_000m),
            ["gpt-5-nano"]         = (0.05m  / 1_000_000m, 0.40m  / 1_000_000m),
            ["gpt-5.2-chat-latest"]= (1.25m  / 1_000_000m, 10.00m / 1_000_000m),
        };

        private static (decimal Input, decimal Output) GetPricing(string model)
        {
            if (string.IsNullOrWhiteSpace(model))
                return _pricing["gpt-4o"];
            if (_pricing.TryGetValue(model, out var exact))
                return exact;
            // Prefix match — handles versioned aliases like "gpt-4o-2024-08-06".
            // Iterate longest key first so "gpt-4o-mini" beats "gpt-4o".
            foreach (var kv in _pricing.OrderByDescending(k => k.Key.Length))
            {
                if (model.StartsWith(kv.Key, StringComparison.OrdinalIgnoreCase))
                    return kv.Value;
            }
            return _pricing["gpt-4o"];
        }

        /// <summary>
        /// Result of a low-level OpenAI HTTP call — content text plus the
        /// usage metadata we need to write an AIUsageLog row.
        /// </summary>
        private class OpenAICallResult
        {
            public string  Content          { get; set; }
            public string  Model            { get; set; }
            public int     PromptTokens     { get; set; }
            public int     CompletionTokens { get; set; }
            public decimal DurationSeconds  { get; set; }
        }

        /// <summary>
        /// Extracts model name and token usage from a parsed OpenAI response.
        /// Tolerant of both Responses API (input_tokens / output_tokens) and
        /// Chat Completions API (prompt_tokens / completion_tokens) shapes.
        /// </summary>
        private static (string Model, int Prompt, int Completion) ExtractUsage(JObject parsed)
        {
            var model = parsed?["model"]?.ToString() ?? "";
            var usage = parsed?["usage"];
            if (usage == null) return (model, 0, 0);

            int prompt =
                (int?)usage["prompt_tokens"]
             ?? (int?)usage["input_tokens"]
             ?? 0;

            int completion =
                (int?)usage["completion_tokens"]
             ?? (int?)usage["output_tokens"]
             ?? 0;

            return (model, prompt, completion);
        }

        /// <summary>
        /// Fire-and-forget-style usage logger.  Always swallows exceptions —
        /// AiUsageLogger itself catches; this extra try/catch guards against
        /// a null logger or unexpected programmer errors.
        /// </summary>
        private async Task LogUsageAsync(
            string operation, string endpoint,
            OpenAICallResult call,
            string userId, int storeId,
            int? charCount = null,
            string module = null,
            string action = null,
            string sessionId = null)
        {
            if (_usageLogger == null || call == null) return;
            try
            {
                var price = GetPricing(call.Model);
                await _usageLogger.LogAsync(new AiUsageLogEntry
                {
                    UserId           = userId,
                    StoreId          = storeId > 0 ? storeId : (int?)null,
                    Module           = NormalizeModule(module),
                    Action           = string.IsNullOrWhiteSpace(action) ? operation : action,
                    SessionId        = NormalizeSessionId(sessionId),
                    Operation        = operation,
                    Endpoint         = endpoint,
                    Model            = call.Model,
                    PromptTokens     = call.PromptTokens,
                    CompletionTokens = call.CompletionTokens,
                    InputCostUsd     = call.PromptTokens     * price.Input,
                    OutputCostUsd    = call.CompletionTokens * price.Output,
                    DurationSeconds  = call.DurationSeconds,
                    CharCount        = charCount,
                    Source           = "server"
                });
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"[OpenAIService] Usage log failed ({operation}): {ex.Message}");
            }
        }

        // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        //  Generate full dashboard from a prompt
        // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        public async Task<DashboardDto> GenerateDashboardAsync(
            string userPrompt,
            int storeId,
            string userId,
            IEnumerable<DataSourceMetaDto> availableDataSources,
            string currentDateIso,
            string module    = null,
            string sessionId = null)
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
            var call = await CallOpenAIResponsesAsync(_generatePromptId, _generatePromptVersion, variables);
            var raw  = call.Content;

            await LogUsageAsync(
                operation: "GenerateDashboard",
                endpoint:  "responses",
                call:      call,
                userId:    userId,
                storeId:   storeId,
                charCount: userPrompt?.Length);

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

            await LogUsageAsync(
                operation: "GenerateDashboard",
                endpoint:  "responses",
                call:      call,
                userId:    userId,
                storeId:   storeId,
                charCount: userPrompt?.Length,
                module:    ResolveModule(module, userPrompt, dto?.Title, dto?.OriginalPrompt, dto?.Widgets?.Select(w => w.DataSource)),
                action:    "Create Dashboard",
                sessionId: sessionId);

            return dto;
        }

        // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        //  Process a chat message and return delta commands
        // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        public async Task<IEnumerable<ChatCommandDto>> SendChatMessageAsync(
            string userMessage,
            DashboardDto currentDashboard,
            IEnumerable<DataSourceMetaDto> availableDataSources,
            string currentDateIso,
            string module    = null,
            string sessionId = null)
        {
            var variables = new Dictionary<string, string>
            {
                ["iso_date"]               = currentDateIso,
                ["current_dashboard_json"] = JsonConvert.SerializeObject(currentDashboard, Formatting.Indented),
                ["data_sources_json"]      = JsonConvert.SerializeObject(availableDataSources, Formatting.Indented),
                ["user_message"]           = userMessage
            };

            var call = await CallOpenAIResponsesAsync(_chatPromptId, _chatPromptVersion, variables);
            var raw  = call.Content;

            var commands = JsonConvert.DeserializeObject<List<ChatCommandDto>>(raw);

            await LogUsageAsync(
                operation: "ChatMessage",
                endpoint:  "responses",
                call:      call,
                userId:    currentDashboard?.UserId,
                storeId:   currentDashboard?.StoreId ?? 0,
                charCount: userMessage?.Length,
                module:    ResolveModule(module, userMessage, currentDashboard?.Title, currentDashboard?.OriginalPrompt, currentDashboard?.Widgets?.Select(w => w.DataSource)),
                action:    "Update Dashboard",
                sessionId: !string.IsNullOrWhiteSpace(sessionId) ? sessionId : currentDashboard?.Id.ToString());

            return commands ?? new List<ChatCommandDto>();
        }

        // ────────────────────────────────────────────────────────────────────────
        //  Generate AI insights / descriptions for each widget (chat/completions)
        // ────────────────────────────────────────────────────────────────────────
        public async Task<Dictionary<string, WidgetInsight>> DescribeWidgetsAsync(
            string dashboardTitle,
            IEnumerable<WidgetDescribeItem> widgets,
            string userId  = null,
            int    storeId = 0)
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

            var sw       = Stopwatch.StartNew();
            var response = await _http.SendAsync(req);
            var json     = await response.Content.ReadAsStringAsync();
            sw.Stop();

            if (!response.IsSuccessStatusCode)
                throw new HttpRequestException($"OpenAI error {(int)response.StatusCode}: {json}");

            var parsed  = JObject.Parse(json);
            var content = parsed["choices"]?[0]?["message"]?["content"]?.ToString();

            if (string.IsNullOrWhiteSpace(content))
                throw new InvalidOperationException($"OpenAI returned empty content. Raw: {json}");

            var (model, prompt, completion) = ExtractUsage(parsed);
            await LogUsageAsync(
                operation: "DescribeWidgets",
                endpoint:  "chat/completions",
                call:      new OpenAICallResult
                {
                    Content          = content,
                    Model            = model,
                    PromptTokens     = prompt,
                    CompletionTokens = completion,
                    DurationSeconds  = (decimal)sw.Elapsed.TotalSeconds
                },
                userId:    userId,
                storeId:   storeId,
                charCount: userMsg?.Length,
                module:    ResolveModule(null, dashboardTitle, dashboardTitle, null, null),
                action:    "Describe Widgets");

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
            Dictionary<string, string> activeFilters = null,
            string userId  = null,
            int    storeId = 0)
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
                "Return ONLY a JSON object with exactly four fields:\n" +
                "1. \"executiveSummary\": a 2-3 sentence professional WHS executive summary that references the dashboard title, " +
                "highlights key KPI values where present, and notes any notable trends or risk signals.\n" +
                "2. \"keyFindings\": an array of 3-5 concise plain-text bullet strings (no markdown, no dashes) " +
                "summarising the most important WHS observations across the whole dashboard.\n" +
                "3. \"recommendations\": an array of 3-5 concise plain-text strings (no markdown, no dashes) " +
                "representing specific actionable steps that management should take based on the dashboard data.\n" +
                "4. \"descriptions\": an object where each key is exactly the widget title and each value has:\n" +
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

            var sw       = Stopwatch.StartNew();
            var response = await _http.SendAsync(req);
            var json     = await response.Content.ReadAsStringAsync();
            sw.Stop();

            if (!response.IsSuccessStatusCode)
                throw new HttpRequestException($"OpenAI error {(int)response.StatusCode}: {json}");

            var parsed  = JObject.Parse(json);
            var content = parsed["choices"]?[0]?["message"]?["content"]?.ToString();

            if (string.IsNullOrWhiteSpace(content))
                throw new InvalidOperationException($"OpenAI returned empty content. Raw: {json}");

            var (model, promptTok, completionTok) = ExtractUsage(parsed);
            await LogUsageAsync(
                operation: "ReportInsights",
                endpoint:  "chat/completions",
                call:      new OpenAICallResult
                {
                    Content          = content,
                    Model            = model,
                    PromptTokens     = promptTok,
                    CompletionTokens = completionTok,
                    DurationSeconds  = (decimal)sw.Elapsed.TotalSeconds
                },
                userId:    userId,
                storeId:   storeId,
                charCount: userMsg?.Length,
                module:    ResolveModule(null, dashboardTitle, dashboardTitle, null, null),
                action:    "Generate Report Insights");

            var root = JObject.Parse(content);
            return new ReportInsightsResult
            {
                ExecutiveSummary = root["executiveSummary"]?.ToString() ?? "",
                KeyFindings      = root["keyFindings"]?.ToObject<List<string>>() ?? new List<string>(),
                Recommendations  = root["recommendations"]?.ToObject<List<string>>() ?? new List<string>(),
                Descriptions     = root["descriptions"]?.ToObject<Dictionary<string, WidgetInsight>>()
                                   ?? new Dictionary<string, WidgetInsight>()
            };
        }

        // ─────────────────────────────────────────────────────────────────────
        //  Hazard MCP query  (POST /api/chat/hazard)
        // ─────────────────────────────────────────────────────────────────────
        private const string ArventaBase     = "https://beta.whsmonitor.com.au/vws";
        private const string ArventaAdminKey = "2G2rFq95Kr7g8MQSWO3SE2kGbq9BJ748";

        // Cache resolved MCP URLs per store — they don't change between requests.
        private static readonly System.Collections.Concurrent.ConcurrentDictionary<int, string>
            _mcpUrlCache = new System.Collections.Concurrent.ConcurrentDictionary<int, string>();

        private async Task<string> ResolveMcpUrlAsync(int storeId)
        {
            if (_mcpUrlCache.TryGetValue(storeId, out var cached)) return cached;

            var payload = JsonConvert.SerializeObject(new { adminKey = ArventaAdminKey, storeId });
            var req     = new HttpRequestMessage(HttpMethod.Post, $"{ArventaBase}/auth/generate-key")
            {
                Content = new StringContent(payload, Encoding.UTF8, "application/json")
            };

            var res  = await _http.SendAsync(req);
            var json = await res.Content.ReadAsStringAsync();
            if (!res.IsSuccessStatusCode)
                throw new HttpRequestException($"Arventa MCP key resolution failed ({(int)res.StatusCode}): {json}");

            var data = JObject.Parse(json);
            var url  = data["url"]?.ToString();
            if (string.IsNullOrWhiteSpace(url))
                throw new InvalidOperationException("Arventa /auth/generate-key did not return a URL.");

            var fullUrl = $"{ArventaBase}{url}";
            _mcpUrlCache.TryAdd(storeId, fullUrl);
            return fullUrl;
        }

        public async Task<string> QueryHazardMcpAsync(string message, int storeId, string userId)
        {
            var mcpUrl = await ResolveMcpUrlAsync(storeId);

            var body = new
            {
                model        = "gpt-4o",
                input        = message,
                instructions = "You are a Workplace Health & Safety assistant. " +
                               "Use the available MCP tools to retrieve hazard report information. " +
                               "Be professional, concise, and clear. " +
                               "When listing reports, format them as a readable list with key fields such as " +
                               "report number, type, status, location, and date. " +
                               "For individual report details, present the full record in a structured layout.",
                tools = new[]
                {
                    new
                    {
                        type             = "mcp",
                        server_label     = "arventa-hazard",
                        server_url       = mcpUrl,
                        require_approval = "never"
                    }
                }
            };

            var request = new HttpRequestMessage(HttpMethod.Post, $"{BaseUrl}/responses")
            {
                Content = new StringContent(JsonConvert.SerializeObject(body), Encoding.UTF8, "application/json")
            };
            request.Headers.Add("Authorization", $"Bearer {_apiKey}");

            var sw       = Stopwatch.StartNew();
            var response = await _http.SendAsync(request);
            var json     = await response.Content.ReadAsStringAsync();
            sw.Stop();

            if (!response.IsSuccessStatusCode)
                throw new HttpRequestException($"OpenAI MCP error {(int)response.StatusCode}: {json}");

            var parsed    = JObject.Parse(json);
            var outputArr = parsed["output"] as JArray;
            var msgItem   = outputArr?.FirstOrDefault(o => o["type"]?.ToString() == "message");
            var content   = msgItem?["content"]?[0]?["text"]?.ToString();

            if (string.IsNullOrWhiteSpace(content))
                throw new InvalidOperationException($"OpenAI returned empty MCP response. Raw: {json}");

            var (mcpModel, mcpPrompt, mcpCompletion) = ExtractUsage(parsed);
            await LogUsageAsync(
                operation: "HazardMcp",
                endpoint:  "responses",
                call:      new OpenAICallResult
                {
                    Content          = content,
                    Model            = mcpModel,
                    PromptTokens     = mcpPrompt,
                    CompletionTokens = mcpCompletion,
                    DurationSeconds  = (decimal)sw.Elapsed.TotalSeconds
                },
                userId:    userId,
                storeId:   storeId,
                charCount: message?.Length,
                module:    "Hazard Report",
                action:    "Hazard Query",
                sessionId: null);

            return content.Trim();
        }

        // ─────────────────────────────────────────────────────────────────────
        //  OpenAI Responses API
        // ─────────────────────────────────────────────────────────────────────
        private async Task<OpenAICallResult> CallOpenAIResponsesAsync(
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

            var sw       = Stopwatch.StartNew();
            var response = await _http.SendAsync(request);
            var json     = await response.Content.ReadAsStringAsync();
            sw.Stop();

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

            var (model, prompt, completion) = ExtractUsage(parsed);

            return new OpenAICallResult
            {
                Content          = content.Trim(),
                Model            = model,
                PromptTokens     = prompt,
                CompletionTokens = completion,
                DurationSeconds  = (decimal)sw.Elapsed.TotalSeconds
            };
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

        private static string NormalizeModule(string module)
        {
            if (string.IsNullOrWhiteSpace(module)) return null;
            var lower = module.Trim().ToLowerInvariant();
            if (lower.Contains("rapid risk") || lower.Contains("rapidrisk")) return "RapidRisk";
            if (lower.Contains("hazard")) return "Hazard Report";
            if (lower.Contains("incident") || lower.Contains("injury") || lower.Contains("accident") || lower.Contains("near miss")) return "Incident";
            if (lower.Contains("inspection")) return "Inspection";
            if (lower.Contains("audit")) return "Audit";
            return module.Trim();
        }

        private static string NormalizeSessionId(string sessionId)
        {
            if (string.IsNullOrWhiteSpace(sessionId)) return null;
            return Guid.TryParse(sessionId, out var parsed) ? parsed.ToString() : null;
        }

        private static string ResolveModule(
            string explicitModule,
            string userText,
            string dashboardTitle,
            string originalPrompt,
            IEnumerable<string> dataSources)
        {
            var direct = NormalizeModule(explicitModule);
            if (!string.IsNullOrWhiteSpace(direct)) return direct;

            foreach (var dataSource in dataSources ?? Enumerable.Empty<string>())
            {
                var ds = dataSource ?? string.Empty;
                if (ds.IndexOf("RapidRisk", StringComparison.OrdinalIgnoreCase) >= 0) return "RapidRisk";
                if (ds.IndexOf("Hazard", StringComparison.OrdinalIgnoreCase) >= 0) return "Hazard Report";
                if (ds.IndexOf("Incident", StringComparison.OrdinalIgnoreCase) >= 0) return "Incident";
                if (ds.IndexOf("Inspection", StringComparison.OrdinalIgnoreCase) >= 0) return "Inspection";
                if (ds.IndexOf("Audit", StringComparison.OrdinalIgnoreCase) >= 0) return "Audit";
            }

            return NormalizeModule($"{dashboardTitle} {originalPrompt} {userText}");
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
