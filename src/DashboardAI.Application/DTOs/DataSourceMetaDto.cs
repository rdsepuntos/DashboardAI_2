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

        /// <summary>
        /// Account-specific display label resolved from spPageFields (PagesFieldMemberAccess
        /// overrides). Present only when the account renames this column. The AI should match
        /// the user's wording against this AND <see cref="Name"/>, but always emit Name in config.
        /// </summary>
        [JsonProperty("caption", NullValueHandling = NullValueHandling.Ignore)]
        public string Caption { get; set; }

        /// <summary>
        /// Populated at runtime for categorical columns (e.g. Status).
        /// Tells OpenAI exactly which values exist so it can use them in statusFilter.
        /// </summary>
        [JsonProperty("knownValues", NullValueHandling = NullValueHandling.Ignore)]
        public List<string> KnownValues { get; set; }

        [JsonProperty("statusCounts", NullValueHandling = NullValueHandling.Ignore)]
        public Dictionary<string, int> StatusCounts { get; set; }
    }
}
