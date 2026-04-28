using System.Collections.Generic;
using System.Threading.Tasks;
using DashboardAI.Application.DTOs;

namespace DashboardAI.Application.Interfaces
{
    public class WidgetDescribeItem
    {
        public string Title        { get; set; }
        public string Type         { get; set; }
        public string ChartType    { get; set; }
        public string CurrentValue { get; set; }
    }

    /// <summary>
    /// A single widget insight returned by the AI — includes a description and a layout hint.
    /// </summary>
    public class WidgetInsight
    {
        /// <summary>1-2 sentence professional WHS insight.</summary>
        public string Description { get; set; }

        /// <summary>"side" = image-left / text-right; "full" = full-width stacked.</summary>
        public string Layout      { get; set; }
    }

    public interface IOpenAIService
    {
        /// <summary>
        /// Sends a generate-dashboard prompt to GPT and returns a fully formed DashboardDto.
        /// </summary>
        Task<DashboardDto> GenerateDashboardAsync(
            string userPrompt,
            int storeId,
            string userId,
            IEnumerable<DataSourceMetaDto> availableDataSources,
            string currentDateIso);

        /// <summary>
        /// Sends a chat message in the context of an existing dashboard.
        /// Returns one or more delta commands (add/update/remove widget or filter, update filter value).
        /// </summary>
        Task<IEnumerable<ChatCommandDto>> SendChatMessageAsync(
            string userMessage,
            DashboardDto currentDashboard,
            IEnumerable<DataSourceMetaDto> availableDataSources,
            string currentDateIso);

        /// <summary>
        /// Generates a professional insight and layout recommendation for each widget.
        /// Returns a dictionary mapping widget title to a WidgetInsight (description + layout hint).
        /// </summary>
        Task<Dictionary<string, WidgetInsight>> DescribeWidgetsAsync(
            string dashboardTitle,
            IEnumerable<WidgetDescribeItem> widgets);
    }
}
