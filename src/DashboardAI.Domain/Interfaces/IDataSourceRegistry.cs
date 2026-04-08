using System.Collections.Generic;
using System.Threading.Tasks;
using DashboardAI.Domain.Entities;

namespace DashboardAI.Domain.Interfaces
{
    public interface IDataSourceRegistry
    {
        IReadOnlyList<DataSourceDefinition> GetAll();
        DataSourceDefinition GetByName(string name);
        void Register(DataSourceDefinition definition);
    }
}
