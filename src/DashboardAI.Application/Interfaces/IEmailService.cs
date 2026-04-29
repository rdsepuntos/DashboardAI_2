using System.Threading.Tasks;

namespace DashboardAI.Application.Interfaces
{
    public interface IEmailService
    {
        Task SendAsync(
            string toAddress,
            string toName,
            string subject,
            string htmlBody,
            string[] bccAddresses = null,
            byte[] attachmentData = null,
            string attachmentName = null);
    }
}
