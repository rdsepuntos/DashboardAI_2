using System;
using System.Collections.Generic;
using System.Linq;
using DashboardAI.Domain.Entities;
using DashboardAI.Domain.Interfaces;

namespace DashboardAI.Infrastructure.DataSources
{
    /// <summary>
    /// In-memory registry of all SQL views and stored procedures available to the AI.
    /// Register all data sources at startup in DependencyInjection.cs.
    /// </summary>
    public class DataSourceRegistry : IDataSourceRegistry
    {
        private readonly Dictionary<string, DataSourceDefinition> _store
            = new Dictionary<string, DataSourceDefinition>(StringComparer.OrdinalIgnoreCase);

        public IReadOnlyList<DataSourceDefinition> GetAll()
            => _store.Values.ToList().AsReadOnly();

        public DataSourceDefinition GetByName(string name)
            => _store.TryGetValue(name, out var def) ? def : null;

        public void Register(DataSourceDefinition definition)
        {
            if (definition == null) throw new ArgumentNullException(nameof(definition));
            _store[definition.Name] = definition;
        }
    }
}
