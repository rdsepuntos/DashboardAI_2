using System;
using System.Collections.Generic;

namespace DashboardAI.Domain.Entities
{
    public class PagedResult<T>
    {
        public IEnumerable<T> Data       { get; set; }
        public int            TotalCount { get; set; }
        public int            Page       { get; set; }
        public int            PageSize   { get; set; }
        public int            TotalPages => PageSize > 0
            ? (int)Math.Ceiling((double)TotalCount / PageSize)
            : 0;
    }
}
