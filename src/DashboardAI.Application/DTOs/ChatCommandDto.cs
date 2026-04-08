using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace DashboardAI.Application.DTOs
{
    /// <summary>
    /// A single delta command returned by OpenAI during a chat interaction.
    /// The frontend interprets the action and mutates the live canvas accordingly.
    /// </summary>
    public class ChatCommandDto
    {
        /// <summary>
        /// Supported actions:
        ///   add_widget | update_widget | remove_widget
        ///   add_filter  | update_filter | remove_filter
        ///   update_filter_value   (user asked to change a date/dropdown value)
        ///   update_title
        /// </summary>
        [JsonProperty("action")]
        public string Action { get; set; }

        /// <summary>Widget payload for add_widget / update_widget</summary>
        [JsonProperty("widget")]
        public WidgetDto Widget { get; set; }

        /// <summary>Filter payload for add_filter / update_filter</summary>
        [JsonProperty("filter")]
        public FilterDto Filter { get; set; }

        /// <summary>Target id for remove_widget / remove_filter / update_filter_value</summary>
        [JsonProperty("targetId")]
        public string TargetId { get; set; }

        /// <summary>
        /// New value for update_filter_value.
        /// For daterange: { "StartDate": "2026-04-01", "EndDate": "2026-06-30" }
        /// For dropdown:  { "value": "5" }
        /// </summary>
        [JsonProperty("value")]
        public JObject Value { get; set; }

        /// <summary>New title for update_title</summary>
        [JsonProperty("title")]
        public string Title { get; set; }

        /// <summary>Human-readable explanation of what the AI did (shown in chat bubble)</summary>
        [JsonProperty("explanation")]
        public string Explanation { get; set; }
    }
}
