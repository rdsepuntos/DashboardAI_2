using System;
using System.Collections.Generic;
using System.Data.SqlClient;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using Dapper;
using DashboardAI.Application.Interfaces;
using Microsoft.Extensions.Configuration;

namespace DashboardAI.Infrastructure.Services
{
    public class SendReportService : ISendReportService
    {
        private readonly string        _connectionString;
        private readonly IEmailService _emailService;
        private readonly string        _defaultSubject;
        private readonly string[]      _bccAddresses;

        public SendReportService(string connectionString, IEmailService emailService, IConfiguration configuration)
        {
            _connectionString = connectionString;
            _emailService     = emailService;
            _defaultSubject   = configuration["Email:Subject"] ?? "WHS Monitor Report";

            var bccRaw = configuration["Email:BCC"] ?? string.Empty;
            _bccAddresses = bccRaw.Split(new[] { ';', ',' }, StringSplitOptions.RemoveEmptyEntries)
                                  .Select(s => s.Trim())
                                  .Where(s => !string.IsNullOrEmpty(s))
                                  .ToArray();
        }

        public async Task<SendReportResult> SendAsync(SendReportRequest request)
        {
            var recipients = await ResolveRecipientsAsync(request);

            if (recipients.Count == 0)
                return new SendReportResult { Sent = 0, Recipients = new List<string>() };

            var subject        = string.IsNullOrWhiteSpace(request.Subject) ? _defaultSubject : request.Subject;
            var bodyHtml       = BuildMessageBody(request.Message);
            var attachmentData = string.IsNullOrWhiteSpace(request.ReportHtml)
                                    ? null
                                    : System.Text.Encoding.UTF8.GetBytes(request.ReportHtml);
            var attachmentName = SanitizeFilename(subject) + ".html";

            // Send to first recipient with BCC; send individually to all remaining
            // (avoids large To: list leakage — each person only sees themselves)
            var sentCount  = 0;
            var sentEmails = new List<string>();

            foreach (var r in recipients)
            {
                // Only send BCC on the first email to avoid duplicate BCC deliveries
                var bcc = sentCount == 0 ? _bccAddresses : null;
                await _emailService.SendAsync(
                    r.EmailAddress,
                    $"{r.FirstName} {r.LastName}".Trim(),
                    subject,
                    bodyHtml,
                    bcc,
                    attachmentData,
                    attachmentName);
                sentEmails.Add(r.EmailAddress);
                sentCount++;
            }

            return new SendReportResult { Sent = sentCount, Recipients = sentEmails };
        }

        // ── Recipient resolution ──────────────────────────────────────────────

        private async Task<List<RecipientRow>> ResolveRecipientsAsync(SendReportRequest request)
        {
            var seen = new HashSet<int>();
            var list = new List<RecipientRow>();

            using (var conn = new SqlConnection(_connectionString))
            {
                await conn.OpenAsync();

                if (request.UserIds?.Count > 0)
                    await AppendAsync(conn, list, seen, QueryUsers(request.UserIds));

                if (request.DivisionIds?.Count > 0)
                    await AppendAsync(conn, list, seen, QueryByDivision(request.DivisionIds));

                if (request.DepartmentIds?.Count > 0)
                    await AppendAsync(conn, list, seen, QueryByDepartment(request.DepartmentIds));

                if (request.RoleIds?.Count > 0)
                    await AppendAsync(conn, list, seen, QueryByRole(request.RoleIds));
            }

            return list;
        }

        private static async Task AppendAsync(
            SqlConnection conn,
            List<RecipientRow> list,
            HashSet<int> seen,
            (string sql, object param) query)
        {
            var rows = await conn.QueryAsync<RecipientRow>(query.sql, query.param);
            foreach (var r in rows)
            {
                if (!string.IsNullOrWhiteSpace(r.EmailAddress) && seen.Add(r.StoreUserID))
                    list.Add(r);
            }
        }

        // ── SQL helpers (parameterised — no injection risk) ───────────────────

        private static (string sql, object param) QueryUsers(List<int> ids) =>
        (
            @"SELECT StoreUserID, FirstName, LastName, EmailAddress
              FROM   StoreUsers
              WHERE  StoreUserID IN @Ids
                AND  ISNULL(deleted,0) = 0
                AND  active = 1",
            new { Ids = ids }
        );

        private static (string sql, object param) QueryByDivision(List<int> ids) =>
        (
            @"SELECT a.StoreUserID, a.FirstName, a.LastName, a.EmailAddress
              FROM   StoreUsers a
              JOIN   StoreUserDivisionDepartment b ON b.StoreUserID = a.StoreUserID
              WHERE  b.DivisionID IN @Ids
                AND  ISNULL(a.deleted,0) = 0
                AND  a.active = 1",
            new { Ids = ids }
        );

        private static (string sql, object param) QueryByDepartment(List<int> ids) =>
        (
            @"SELECT a.StoreUserID, a.FirstName, a.LastName, a.EmailAddress
              FROM   StoreUsers a
              JOIN   StoreUserDivisionDepartment b ON b.StoreUserID = a.StoreUserID
              WHERE  b.DepartmentID IN @Ids
                AND  ISNULL(a.deleted,0) = 0
                AND  a.active = 1",
            new { Ids = ids }
        );

        private static (string sql, object param) QueryByRole(List<int> ids) =>
        (
            @"SELECT a.StoreUserID, a.FirstName, a.LastName, a.EmailAddress
              FROM   StoreUsers a
              JOIN   StoreUserStoreUserType b ON b.StoreUserID = a.StoreUserID
              WHERE  b.StoreUserTypeID IN @Ids
                AND  ISNULL(a.deleted,0) = 0
                AND  a.active = 1",
            new { Ids = ids }
        );

        // ── Email body builder (message only — report goes as attachment) ─────

        private static string BuildMessageBody(string personalMessage)
        {
            if (string.IsNullOrWhiteSpace(personalMessage))
                return "Please find the WHS report attached.";

            var encoded = System.Net.WebUtility.HtmlEncode(personalMessage).Replace("\n", "<br>");
            return $"<div style=\"font-family:sans-serif;font-size:14px;\">{encoded}</div>";
        }

        private static string SanitizeFilename(string name)
        {
            if (string.IsNullOrWhiteSpace(name)) return "report";
            var safe = Regex.Replace(name, @"[\\/:*?""<>|]", "-").Trim();
            return safe.Length > 80 ? safe.Substring(0, 80) : safe;
        }

        // ── DTO ───────────────────────────────────────────────────────────────

        private class RecipientRow
        {
            public int    StoreUserID   { get; set; }
            public string FirstName     { get; set; }
            public string LastName      { get; set; }
            public string EmailAddress  { get; set; }
        }
    }
}
