using System;
using System.Collections.Generic;
using DashboardAI.Domain.ValueObjects;

namespace DashboardAI.Domain.Entities
{
    public class Widget
    {
        public string Id { get; private set; }
        public WidgetType Type { get; private set; }
        public string ChartType { get; private set; }      // bar | line | pie | area (charts only)
        public string Title { get; private set; }
        public string DataSource { get; private set; }     // view/SP name
        public WidgetPosition Position { get; private set; }
        public WidgetConfig Config { get; private set; }
        public List<string> AppliesFilters { get; private set; } // filter IDs

        private Widget() { }

        public Widget(
            string id,
            WidgetType type,
            string title,
            string dataSource,
            WidgetPosition position,
            WidgetConfig config,
            string chartType = null,
            List<string> appliesFilters = null)
        {
            Id             = id          ?? Guid.NewGuid().ToString("N").Substring(0, 8);
            Type           = type;
            Title          = title       ?? throw new ArgumentNullException(nameof(title));
            DataSource     = dataSource  ?? throw new ArgumentNullException(nameof(dataSource));
            Position       = position    ?? throw new ArgumentNullException(nameof(position));
            Config         = config      ?? new WidgetConfig();
            ChartType      = chartType;
            AppliesFilters = appliesFilters ?? new List<string>();
        }

        public Widget WithPosition(WidgetPosition position)
            => new Widget(Id, Type, Title, DataSource, position, Config, ChartType, AppliesFilters);

        public Widget WithConfig(WidgetConfig config)
            => new Widget(Id, Type, Title, DataSource, Position, config, ChartType, AppliesFilters);
    }

    public enum WidgetType
    {
        Chart,
        Table,
        Kpi,
        Map,
        Markdown
    }
}
