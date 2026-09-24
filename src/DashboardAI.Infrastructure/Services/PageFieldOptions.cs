using System.Collections.Generic;

namespace DashboardAI.Infrastructure.Services
{
    /// <summary>
    /// Configuration for resolving per-account column captions via spPageFields.
    /// Bound from the "PageFields" section of appsettings.json.
    /// </summary>
    public class PageFieldOptions
    {
        /// <summary>Fully-qualified stored procedure name (3-part), e.g. Agtech_Usermgmt.dbo.spPageFields_New.</summary>
        public string ProcedureName { get; set; } = "Agtech_Usermgmt.dbo.spPageFields_New";

        /// <summary>Application name passed to the proc.</summary>
        public string ApplicationName { get; set; } = "WHSMONITOR";

        /// <summary>Default page id used when a mapping does not specify its own.</summary>
        public int DefaultParentPageId { get; set; }

        /// <summary>Default sub-page (user control) id used when a mapping does not specify its own.</summary>
        public int DefaultUCPageId { get; set; }

        /// <summary>Per data-source page-field mapping, keyed by DataSourceRegistry name.</summary>
        public Dictionary<string, PageFieldMapping> Mappings { get; set; }
            = new Dictionary<string, PageFieldMapping>();
    }

    /// <summary>Page-field resolution parameters for a single data source.</summary>
    public class PageFieldMapping
    {
        public int RegisterTypeId { get; set; }
        public int? ParentPageId { get; set; }
        public int? UCPageId { get; set; }
        public string RefKey { get; set; }
    }
}
