using System.Threading.Tasks;

namespace DashboardAI.Application.Interfaces
{
    /// <summary>
    /// Single OpenAI API call usage record (tokens + cost + duration) to persist
    /// in <c>Agtech_Usermgmt.dbo.AIUsageLog</c>.
    /// </summary>
    public class AiUsageLogEntry
    {
        public string   UserId           { get; set; }
        public int?     StoreId          { get; set; }
        public int?     RegOthId         { get; set; }
        public int?     TranscriptId     { get; set; }
        public string   Operation        { get; set; }
        public string   Endpoint         { get; set; }
        public string   Model            { get; set; }
        public int      PromptTokens     { get; set; }
        public int      CompletionTokens { get; set; }
        public decimal  InputCostUsd     { get; set; }
        public decimal  OutputCostUsd    { get; set; }
        public decimal? DurationSeconds  { get; set; }
        public int?     CharCount        { get; set; }
        public string   Source           { get; set; } = "server";
    }

    /// <summary>
    /// Persists AI usage entries.  Implementations MUST never throw —
    /// failure to log must not break the AI call itself.
    /// </summary>
    public interface IAiUsageLogger
    {
        Task LogAsync(AiUsageLogEntry entry);
    }
}
