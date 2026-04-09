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
    }
}
