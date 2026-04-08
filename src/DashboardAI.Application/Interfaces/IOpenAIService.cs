using System.Collections.Generic;
using System.Threading.Tasks;
using DashboardAI.Application.DTOs;

namespace DashboardAI.Application.Interfaces
{
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
    }
}
