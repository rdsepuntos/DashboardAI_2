using System;
using System.Data.SqlClient;
using System.Threading.Tasks;
using Dapper;
using DashboardAI.Application.Interfaces;

namespace DashboardAI.Infrastructure.Repositories
{
    /// <summary>
    /// Writes a row to <c>Agtech_Usermgmt.dbo.AIUsageLog</c> for every
    /// OpenAI API call made by the server.  Uses a 3-part name so the
    /// existing DefaultConnection (Agtech_WHSMonitor) can reach the
    /// log table on the same SQL server.
    /// </summary>
    public class AiUsageLogger : IAiUsageLogger
    {
        private readonly string _connectionString;

        public AiUsageLogger(string connectionString)
            => _connectionString = connectionString ?? throw new ArgumentNullException(nameof(connectionString));

        public async Task LogAsync(AiUsageLogEntry entry)
        {
            if (entry == null) return;

            try
            {
                using (var conn = new SqlConnection(_connectionString))
                {
                    const string sql = @"
                        INSERT INTO Agtech_Usermgmt.dbo.AIUsageLog
                            (UserID, StoreID, RegOthID, TranscriptID,
                             Module, [Action], SessionID,
                             Operation, Endpoint, Model,
                             PromptTokens, CompletionTokens,
                             DurationSeconds, CharCount,
                             InputCostUsd, OutputCostUsd, Source, CreatedAt)
                        VALUES
                            (@UserId, @StoreId, @RegOthId, @TranscriptId,
                             @Module, @Action, @SessionId,
                             @Operation, @Endpoint, @Model,
                             @PromptTokens, @CompletionTokens,
                             @DurationSeconds, @CharCount,
                             @InputCostUsd, @OutputCostUsd, @Source, SYSUTCDATETIME());";

                    // AIUsageLog.UserID is INT — coerce string ids that aren't numeric to NULL.
                    int? userIdInt = null;
                    if (!string.IsNullOrWhiteSpace(entry.UserId)
                        && int.TryParse(entry.UserId, out var parsed))
                        userIdInt = parsed;

                    Guid? sessionGuid = null;
                    if (!string.IsNullOrWhiteSpace(entry.SessionId)
                        && Guid.TryParse(entry.SessionId, out var parsedGuid))
                        sessionGuid = parsedGuid;

                    await conn.ExecuteAsync(sql, new
                    {
                        UserId           = userIdInt,
                        StoreId          = entry.StoreId,
                        RegOthId         = entry.RegOthId,
                        TranscriptId     = entry.TranscriptId,
                        Module           = string.IsNullOrWhiteSpace(entry.Module) ? null : entry.Module,
                        Action           = string.IsNullOrWhiteSpace(entry.Action) ? null : entry.Action,
                        SessionId        = sessionGuid,
                        Operation        = entry.Operation ?? "",
                        Endpoint         = entry.Endpoint,
                        Model            = entry.Model ?? "",
                        PromptTokens     = entry.PromptTokens,
                        CompletionTokens = entry.CompletionTokens,
                        DurationSeconds  = entry.DurationSeconds,
                        CharCount        = entry.CharCount,
                        InputCostUsd     = entry.InputCostUsd,
                        OutputCostUsd    = entry.OutputCostUsd,
                        Source           = string.IsNullOrWhiteSpace(entry.Source) ? "server" : entry.Source
                    });
                }
            }
            catch (Exception ex)
            {
                // Never let logging failure break the AI call.
                Console.Error.WriteLine($"[AiUsageLogger] Failed to log usage: {ex.Message}");
            }
        }
    }
}
