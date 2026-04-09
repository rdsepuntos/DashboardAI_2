using System.Collections.Generic;

namespace DashboardAI.Domain.Entities
{
    /// <summary>
    /// Describes a server-side GROUP BY + aggregate operation to run against a view.
    /// When present, QueryAggregatedAsync is used instead of the full SELECT *.
    /// The result always contains a column named "__value" holding the aggregate result,
    /// plus the GroupBy column when GroupBy is specified.
    /// </summary>
    public class AggregationRequest
    {
        /// <summary>
        /// Column to GROUP BY.  Null/empty means compute a scalar (KPI use-case):
        ///   SELECT COUNT(*) / SUM(col) AS __value FROM view WHERE ...
        /// When set, produces:
        ///   SELECT [GroupBy], aggExpr AS __value FROM view WHERE ... GROUP BY [GroupBy]
        /// </summary>
        public string GroupBy { get; set; }

        /// <summary>
        /// Aggregate function: count | sum | avg | max | min (case-insensitive).
        /// "count" ignores AggregateColumn and emits COUNT(*).
        /// </summary>
        public string AggregateFunction { get; set; }

        /// <summary>
        /// Column to aggregate (required for sum/avg/max/min, ignored for count).
        /// Must be in the data source's registered column list.
        /// </summary>
        public string AggregateColumn { get; set; }

        /// <summary>
        /// Optional date bucketing applied to the GroupBy column before grouping.
        /// Allowed values: monthly | quarterly | yearly | financial_year.
        /// When set, the GROUP BY expression becomes a computed key (e.g. 'yyyy-MM')
        /// returned as __group, and the raw column is not exposed.
        /// </summary>
        public string DateGroup { get; set; }

        /// <summary>
        /// Second column to GROUP BY (heatmap use-case: GROUP BY [GroupBy], [GroupBy2]).
        /// When set, the result rows contain both GroupBy and GroupBy2 columns plus __value.
        /// </summary>
        public string GroupBy2 { get; set; }

        /// <summary>
        /// Optional exact-match column filters appended to the WHERE clause,
        /// e.g. { "Status": "Open" } → AND [Status] = @Status.
        /// Column names are validated against the registered column list.
        /// Used to honour widget config *Filter keys (statusFilter, typeFilter, etc.) server-side.
        /// </summary>
        public Dictionary<string, string> AdditionalFilters { get; set; }
    }
}
