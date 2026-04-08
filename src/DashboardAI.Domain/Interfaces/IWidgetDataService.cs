using System.Collections.Generic;
using System.Threading.Tasks;
using DashboardAI.Domain.Entities;

namespace DashboardAI.Domain.Interfaces
{
    public interface IWidgetDataService
    {
        /// <summary>
        /// Executes a registered view or stored procedure and returns all rows as key-value dictionaries.
        /// All params are validated against the DataSourceDefinition before execution.
        /// </summary>
        Task<IEnumerable<IDictionary<string, object>>> QueryAsync(
            string dataSourceName,
            IDictionary<string, object> parameters);

        /// <summary>
        /// Same as QueryAsync but returns one page of results plus the total row count.
        /// </summary>
        Task<PagedResult<IDictionary<string, object>>> QueryPagedAsync(
            string dataSourceName,
            IDictionary<string, object> parameters,
            int page,
            int pageSize);
    }
}
