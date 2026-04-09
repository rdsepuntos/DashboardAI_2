using Newtonsoft.Json;
using DashboardAI.Application.Converters;

namespace DashboardAI.Application.DTOs
{
    public class FilterDto
    {
        [JsonProperty("id")]
        public string Id { get; set; }

        [JsonProperty("type")]
        public string Type { get; set; }  // "dropdown" | "daterange" | "datepicker" | "text" | "multiselect"

        [JsonProperty("label")]
        public string Label { get; set; }

        [JsonProperty("param")]
        public string Param { get; set; }

        [JsonProperty("optionsSource")]
        public string OptionsSource { get; set; }

        [JsonProperty("valueKey")]
        public string ValueKey { get; set; }

        [JsonProperty("labelKey")]
        public string LabelKey { get; set; }

        /// <summary>Hidden from UI, injected server-side (e.g. StoreId)</summary>
        [JsonProperty("isLocked")]
        public bool IsLocked { get; set; }

        [JsonProperty("defaultValue")]
        [JsonConverter(typeof(ForgivingStringConverter))]
        public string DefaultValue { get; set; }
    }
}
