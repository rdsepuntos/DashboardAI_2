using System.Collections.Generic;
using System.Threading.Tasks;

namespace DashboardAI.Domain.Interfaces
{
    /// <summary>
    /// Resolves per-account column display captions (field names) for a data source.
    /// Captions come from spPageFields, which applies the client account's
    /// PagesFieldMemberAccess overrides on top of the default PagesFieldNames.
    /// </summary>
    public interface IColumnCaptionService
    {
        /// <summary>
        /// Returns a map of raw SQL column name → account-specific display caption.
        /// The account is resolved from the store's owning member.
        /// Returns an empty map when the data source has no page-field mapping,
        /// the store cannot be resolved, or the lookup fails.
        /// </summary>
        Task<IReadOnlyDictionary<string, string>> GetCaptionsAsync(string dataSourceName, int storeId);
    }
}
