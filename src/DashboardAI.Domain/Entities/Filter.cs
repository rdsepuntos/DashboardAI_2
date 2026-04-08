using System;

namespace DashboardAI.Domain.Entities
{
    public class Filter
    {
        public string Id { get; private set; }
        public FilterType Type { get; private set; }
        public string Label { get; private set; }

        /// <summary>SQL parameter name this filter maps to (e.g. "StartDate", "CategoryId")</summary>
        public string Param { get; private set; }

        /// <summary>Optional view/SP to populate dropdown options</summary>
        public string OptionsSource { get; private set; }
        public string ValueKey { get; private set; }
        public string LabelKey { get; private set; }

        /// <summary>Whether the value is locked server-side and hidden from the UI (e.g. StoreId)</summary>
        public bool IsLocked { get; private set; }
        public string DefaultValue { get; private set; }

        private Filter() { }

        public Filter(
            string id,
            FilterType type,
            string label,
            string param,
            string optionsSource = null,
            string valueKey = null,
            string labelKey = null,
            bool isLocked = false,
            string defaultValue = null)
        {
            Id            = id    ?? Guid.NewGuid().ToString("N").Substring(0, 8);
            Type          = type;
            Label         = label ?? throw new ArgumentNullException(nameof(label));
            Param         = param ?? throw new ArgumentNullException(nameof(param));
            OptionsSource = optionsSource;
            ValueKey      = valueKey;
            LabelKey      = labelKey;
            IsLocked      = isLocked;
            DefaultValue  = defaultValue;
        }
    }

    public enum FilterType
    {
        Dropdown,
        DateRange,
        DatePicker,
        Text,
        MultiSelect
    }
}
