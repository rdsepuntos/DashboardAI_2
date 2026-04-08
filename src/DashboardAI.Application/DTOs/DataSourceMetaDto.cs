using System.Collections.Generic;
using Newtonsoft.Json;

namespace DashboardAI.Application.DTOs
{
    /// <summary>
    /// Lightweight metadata about a data source sent to OpenAI in the system prompt.
    /// </summary>
    public class DataSourceMetaDto
    {
        [JsonProperty("name")]
        public string Name { get; set; }

        [JsonProperty("description")]
        public string Description { get; set; }

        [JsonProperty("kind")]
        public string Kind { get; set; }  // "View" | "StoredProcedure"

        [JsonProperty("columns")]
        public List<ColumnMetaDto> Columns { get; set; }

        [JsonProperty("supportedParams")]
        public List<string> SupportedParams { get; set; }
    }

    public class ColumnMetaDto
    {
        [JsonProperty("name")]
        public string Name { get; set; }

        [JsonProperty("dataType")]
        public string DataType { get; set; }  // "string" | "number" | "date"

        [JsonProperty("description")]
        public string Description { get; set; }
    }
}
