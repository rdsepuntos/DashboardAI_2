using System.Linq;
using DashboardAI.Application.DTOs;
using DashboardAI.Domain.Entities;

namespace DashboardAI.Application.Mappers
{
    public static class DataSourceMapper
    {
        public static DataSourceMetaDto ToMetaDto(DataSourceDefinition d)
        {
            return new DataSourceMetaDto
            {
                Name            = d.Name,
                Description     = d.Description,
                Kind            = d.Kind.ToString(),
                SupportedParams = d.SupportedParams?.ToList(),
                Columns         = d.Columns?.Select(c => new ColumnMetaDto
                {
                    Name        = c.Name,
                    DataType    = c.DataType,
                    Description = c.Description
                }).ToList()
            };
        }
    }
}
