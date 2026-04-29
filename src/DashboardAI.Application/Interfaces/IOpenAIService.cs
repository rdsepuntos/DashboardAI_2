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

    /// <summary>
    /// Richer widget descriptor for POST /api/report/insights.
    /// Includes table structure (columns + sample rows) so GPT can reason about actual content.
    /// </summary>
    public class ChartSeriesData
    {
        public string       SeriesName { get; set; }
        public List<string> Labels     { get; set; }  // x-axis labels (max 20)
        public List<string> Values     { get; set; }  // corresponding values (max 20)
    }

    public class ReportWidgetItem
    {
        public string                  Title        { get; set; }
        public string                  Type         { get; set; }  // count | linechart | bar | table | etc.
        public string                  CurrentValue { get; set; }  // populated for count widgets
        public int?                    RowCount     { get; set; }  // total rows for table widgets
        public List<string>            Columns      { get; set; }  // column headers for tables
        public List<List<string>>      SampleRows   { get; set; }  // first 5 rows for tables
        public List<ChartSeriesData>   SeriesData   { get; set; }  // ECharts series (max 3 series)
    }

    /// <summary>Full report insights returned by GenerateReportInsightsAsync.</summary>
    public class ReportInsightsResult
    {
        public string                            ExecutiveSummary { get; set; }
        public List<string>                      KeyFindings      { get; set; }  // 3-5 bullet points
        public Dictionary<string, WidgetInsight> Descriptions     { get; set; }
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

        /// <summary>
        /// Generates an executive summary and per-widget insights for a print report.
        /// Accepts richer data than DescribeWidgetsAsync — table columns, sample rows, count values.
        /// </summary>
        Task<ReportInsightsResult> GenerateReportInsightsAsync(
            string dashboardTitle,
            IEnumerable<ReportWidgetItem> widgets,
            Dictionary<string, string> activeFilters = null);
    }
}
