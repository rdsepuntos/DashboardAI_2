using System.Collections.Generic;
using Newtonsoft.Json;

namespace DashboardAI.Application.DTOs
{
    public class WidgetDto
    {
        [JsonProperty("id")]
        public string Id { get; set; }

        [JsonProperty("type")]
        public string Type { get; set; }  // "chart" | "table" | "kpi" | "map" | "markdown" | "gauge" | "stat" | "progress" | "donut" | "heatmap"

        [JsonProperty("chartType")]
        public string ChartType { get; set; }  // "bar" | "line" | "pie" | "area" (charts only)

        [JsonProperty("title")]
        public string Title { get; set; }

        [JsonProperty("dataSource")]
        public string DataSource { get; set; }

        [JsonProperty("position")]
        public PositionDto Position { get; set; }

        [JsonProperty("config")]
        public Dictionary<string, string> Config { get; set; } = new Dictionary<string, string>();

        [JsonProperty("appliesFilters")]
        public List<string> AppliesFilters { get; set; } = new List<string>();
    }

    public class PositionDto
    {
        [JsonProperty("x")]
        public int X { get; set; }

        [JsonProperty("y")]
        public int Y { get; set; }

        [JsonProperty("w")]
        public int W { get; set; }

        [JsonProperty("h")]
        public int H { get; set; }
    }
}
