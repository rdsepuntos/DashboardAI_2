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
        /// Generates a 1-2 sentence professional insight for each widget.
        /// Returns a dictionary mapping widget title to description text.
        /// </summary>
        Task<Dictionary<string, string>> DescribeWidgetsAsync(
            string dashboardTitle,
            IEnumerable<WidgetDescribeItem> widgets);
    }
}
