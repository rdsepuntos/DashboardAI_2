using System;
using System.Collections.Generic;
using Newtonsoft.Json;

namespace DashboardAI.Application.DTOs
{
    public class DashboardDto
    {
        [JsonProperty("id")]
        public Guid Id { get; set; }

        [JsonProperty("title")]
        public string Title { get; set; }

        [JsonProperty("storeId")]
        public int StoreId { get; set; }

        [JsonProperty("userId")]
        public string UserId { get; set; }

        [JsonProperty("originalPrompt")]
        public string OriginalPrompt { get; set; }

        [JsonProperty("filters")]
        public List<FilterDto> Filters { get; set; } = new List<FilterDto>();

        [JsonProperty("widgets")]
        public List<WidgetDto> Widgets { get; set; } = new List<WidgetDto>();

        [JsonProperty("createdAt")]
        public DateTime CreatedAt { get; set; }

        [JsonProperty("updatedAt")]
        public DateTime UpdatedAt { get; set; }
    }
}
