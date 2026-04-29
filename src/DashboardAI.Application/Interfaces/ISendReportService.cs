using System.Collections.Generic;
using System.Threading.Tasks;

namespace DashboardAI.Application.Interfaces
{
    public class SendReportRequest
    {
        public int         StoreId       { get; set; }
        public int         UserId        { get; set; }
        public List<int>   UserIds       { get; set; } = new List<int>();
        public List<int>   DivisionIds   { get; set; } = new List<int>();
        public List<int>   DepartmentIds { get; set; } = new List<int>();
        public List<int>   RoleIds       { get; set; } = new List<int>();
        public string      Subject       { get; set; }
        public string      Message       { get; set; }
        public string      ReportHtml    { get; set; }
    }

    public class SendReportResult
    {
        public int              Sent       { get; set; }
        public List<string>     Recipients { get; set; } = new List<string>();
    }

    public interface ISendReportService
    {
        Task<SendReportResult> SendAsync(SendReportRequest request);
    }
}
