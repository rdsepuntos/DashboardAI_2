using System;
using System.IO;
using System.Net;
using System.Net.Mail;
using System.Net.Mime;
using System.Threading.Tasks;
using DashboardAI.Application.Interfaces;
using Microsoft.Extensions.Configuration;

namespace DashboardAI.Infrastructure.Services
{
    public class EmailService : IEmailService
    {
        private readonly string _host;
        private readonly int    _port;
        private readonly string _from;
        private readonly bool   _enableSsl;
        private readonly bool   _useAuth;
        private readonly string _username;
        private readonly string _password;

        public EmailService(IConfiguration configuration)
        {
            _host      = configuration["Email:Host"]            ?? throw new ArgumentNullException("Email:Host");
            _port      = int.Parse(configuration["Email:Port"]  ?? "25");
            _from      = configuration["Email:From"]            ?? throw new ArgumentNullException("Email:From");
            _enableSsl = bool.Parse(configuration["Email:EnableSSL"]        ?? "false");
            _useAuth   = bool.Parse(configuration["Email:UseAuthentication"] ?? "false");
            _username  = configuration["Email:Username"] ?? string.Empty;
            _password  = configuration["Email:Password"] ?? string.Empty;
        }

        public async Task SendAsync(
            string toAddress,
            string toName,
            string subject,
            string htmlBody,
            string[] bccAddresses = null,
            byte[] attachmentData = null,
            string attachmentName = null)
        {
            using (var message = new MailMessage())
            {
                message.From       = new MailAddress(_from);
                message.To.Add(new MailAddress(toAddress, toName));
                message.Subject    = subject;
                message.Body       = htmlBody;
                message.IsBodyHtml = !string.IsNullOrWhiteSpace(htmlBody) && htmlBody.TrimStart().StartsWith("<");

                if (bccAddresses != null)
                {
                    foreach (var bcc in bccAddresses)
                    {
                        var trimmed = bcc.Trim();
                        if (!string.IsNullOrEmpty(trimmed))
                            message.Bcc.Add(new MailAddress(trimmed));
                    }
                }

                if (attachmentData != null && attachmentData.Length > 0)
                {
                    var fileName = string.IsNullOrWhiteSpace(attachmentName) ? "report.html" : attachmentName;
                    var stream   = new MemoryStream(attachmentData);
                    var att      = new Attachment(stream, fileName, "text/html");
                    att.ContentDisposition.Inline = false;
                    message.Attachments.Add(att);
                }

                using (var client = new SmtpClient(_host, _port))
                {
                    client.EnableSsl = _enableSsl;

                    if (_useAuth && !string.IsNullOrEmpty(_username))
                        client.Credentials = new NetworkCredential(_username, _password);
                    else
                        client.UseDefaultCredentials = false;

                    await client.SendMailAsync(message);
                }
            }
        }
    }
}
