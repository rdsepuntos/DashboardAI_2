using System.Collections.Generic;

namespace DashboardAI.Domain.Entities
{
    /// <summary>
    /// Represents a registered SQL View or Stored Procedure that the AI can reference
    /// when building dashboards. This is the metadata registry entry.
    /// </summary>
    public class DataSourceDefinition
    {
        public string Name { get; private set; }                   // e.g. "vw_SalesByCategory"
        public string Description { get; private set; }            // human-readable for AI prompt
        public DataSourceKind Kind { get; private set; }           // View | StoredProcedure
        public IReadOnlyList<ColumnDefinition> Columns { get; private set; }
        public IReadOnlyList<string> SupportedParams { get; private set; } // e.g. StoreId, StartDate

        public DataSourceDefinition(
            string name,
            string description,
            DataSourceKind kind,
            List<ColumnDefinition> columns,
            List<string> supportedParams)
        {
            Name            = name;
            Description     = description;
            Kind            = kind;
            Columns         = columns?.AsReadOnly();
            SupportedParams = supportedParams?.AsReadOnly();
        }
    }

    public class ColumnDefinition
    {
        public string Name { get; set; }
        public string DataType { get; set; }  // "string" | "number" | "date"
        public string Description { get; set; }
    }

    public enum DataSourceKind
    {
        View,
        StoredProcedure
    }
}
