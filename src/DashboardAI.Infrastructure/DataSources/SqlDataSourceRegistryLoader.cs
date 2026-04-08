using System;
using System.Collections.Generic;
using System.Data.SqlClient;
using System.Linq;
using System.Threading.Tasks;
using Dapper;
using DashboardAI.Domain.Entities;
using DashboardAI.Domain.Interfaces;
using Newtonsoft.Json;

namespace DashboardAI.Infrastructure.DataSources
{
    /// <summary>
    /// Loads DataSourceDefinitions from the SQL <c>DataSourceRegistry</c> table
    /// and populates the in-memory <see cref="IDataSourceRegistry"/>.
    ///
    /// Run once at startup from <see cref="DependencyInjection"/>.
    /// To register a new view / stored-procedure just INSERT a row into
    /// <c>DataSourceRegistry</c> — no code changes required.
    /// </summary>
    public static class SqlDataSourceRegistryLoader
    {
        private const string Query = @"
            SELECT  Name,
                    Description,
                    Kind,
                    ColumnsJson,
                    SupportedParams
            FROM    DataSourceRegistry
            WHERE   IsActive = 1
            ORDER BY Name";

        public static async Task LoadAsync(IDataSourceRegistry registry, string connectionString)
        {
            if (string.IsNullOrWhiteSpace(connectionString))
                throw new ArgumentNullException(nameof(connectionString),
                    "Connection string is required to load the DataSourceRegistry from SQL.");

            try
            {
                using (var conn = new SqlConnection(connectionString))
                {
                    var rows = await conn.QueryAsync<DataSourceRow>(Query);

                    foreach (var row in rows)
                    {
                        try
                        {
                            var definition = MapRow(row);
                            registry.Register(definition);
                        }
                        catch (Exception ex)
                        {
                            Console.Error.WriteLine(
                                $"[DataSourceRegistry] Skipping row '{row.Name}': {ex.Message}");
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                // The DataSourceRegistry table may not exist yet — log and continue with empty registry.
                // Run sql/DataSourceRegistry.sql against your database to populate it.
                Console.Error.WriteLine(
                    $"[DataSourceRegistry] Could not load from SQL (is the table created?): {ex.Message}");
            }
        }

        // ─────────────────────────────────────────────────────────────────────
        private static DataSourceDefinition MapRow(DataSourceRow row)
        {
            var kind = string.Equals(row.Kind, "StoredProcedure", StringComparison.OrdinalIgnoreCase)
                ? DataSourceKind.StoredProcedure
                : DataSourceKind.View;

            var columns = DeserializeColumns(row.ColumnsJson, row.Name);

            var supportedParams = string.IsNullOrWhiteSpace(row.SupportedParams)
                ? new List<string>()
                : row.SupportedParams
                    .Split(new[] { ',' }, StringSplitOptions.RemoveEmptyEntries)
                    .Select(p => p.Trim())
                    .Where(p => p.Length > 0)
                    .ToList();

            return new DataSourceDefinition(
                name:            row.Name,
                description:     row.Description,
                kind:            kind,
                columns:         columns,
                supportedParams: supportedParams);
        }

        private static List<ColumnDefinition> DeserializeColumns(string json, string sourceName)
        {
            if (string.IsNullOrWhiteSpace(json))
                return new List<ColumnDefinition>();

            try
            {
                var raw = JsonConvert.DeserializeObject<List<ColumnDefinitionDto>>(json);
                return (raw ?? new List<ColumnDefinitionDto>())
                    .Select(c => new ColumnDefinition
                    {
                        Name        = c.Name        ?? string.Empty,
                        DataType    = c.DataType    ?? "string",
                        Description = c.Description ?? string.Empty
                    })
                    .ToList();
            }
            catch (JsonException ex)
            {
                throw new InvalidOperationException(
                    $"ColumnsJson for '{sourceName}' is not valid JSON: {ex.Message}", ex);
            }
        }

        // ─── private DTOs for Dapper mapping ─────────────────────────────────

        private class DataSourceRow
        {
            public string Name            { get; set; }
            public string Description     { get; set; }
            public string Kind            { get; set; }
            public string ColumnsJson     { get; set; }
            public string SupportedParams { get; set; }
        }

        private class ColumnDefinitionDto
        {
            [JsonProperty("name")]
            public string Name        { get; set; }

            [JsonProperty("dataType")]
            public string DataType    { get; set; }

            [JsonProperty("description")]
            public string Description { get; set; }
        }
    }
}
