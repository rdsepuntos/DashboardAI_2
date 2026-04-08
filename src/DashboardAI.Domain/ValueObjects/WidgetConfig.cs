using System.Collections.Generic;

namespace DashboardAI.Domain.ValueObjects
{
    /// <summary>
    /// Immutable rendering configuration for a widget.
    /// Keys are widget-type specific (xKey/yKey for charts, valueKey/format for KPIs, etc.)
    /// </summary>
    public class WidgetConfig
    {
        private readonly Dictionary<string, string> _values;

        public WidgetConfig() => _values = new Dictionary<string, string>();

        public WidgetConfig(Dictionary<string, string> values)
            => _values = values ?? new Dictionary<string, string>();

        public string Get(string key)
            => _values.TryGetValue(key, out var v) ? v : null;

        public bool Has(string key) => _values.ContainsKey(key);

        public IReadOnlyDictionary<string, string> ToDictionary()
            => _values;

        /// <summary>Returns a new WidgetConfig with the given key set.</summary>
        public WidgetConfig With(string key, string value)
        {
            var copy = new Dictionary<string, string>(_values) { [key] = value };
            return new WidgetConfig(copy);
        }
    }
}
