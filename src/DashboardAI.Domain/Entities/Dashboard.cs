using System;
using System.Collections.Generic;

namespace DashboardAI.Domain.Entities
{
    public class Dashboard
    {
        public Guid Id { get; private set; }
        public string Title { get; private set; }
        public int StoreId { get; private set; }
        public string UserId { get; private set; }
        public string OriginalPrompt { get; private set; }
        public IReadOnlyList<Widget> Widgets => _widgets.AsReadOnly();
        public IReadOnlyList<Filter> Filters => _filters.AsReadOnly();
        public DateTime CreatedAt { get; private set; }
        public DateTime UpdatedAt { get; private set; }

        private readonly List<Widget> _widgets;
        private readonly List<Filter> _filters;

        private Dashboard() { }

        public Dashboard(Guid id, string title, int storeId, string userId,
                         string originalPrompt, List<Widget> widgets, List<Filter> filters)
        {
            Id             = id == Guid.Empty ? Guid.NewGuid() : id;
            Title          = title          ?? throw new ArgumentNullException(nameof(title));
            StoreId        = storeId;
            UserId         = userId         ?? throw new ArgumentNullException(nameof(userId));
            OriginalPrompt = originalPrompt ?? string.Empty;
            _widgets       = widgets        ?? new List<Widget>();
            _filters       = filters        ?? new List<Filter>();
            CreatedAt      = DateTime.UtcNow;
            UpdatedAt      = DateTime.UtcNow;
        }

        // Domain behaviour
        public void AddWidget(Widget widget)
        {
            if (widget == null) throw new ArgumentNullException(nameof(widget));
            _widgets.Add(widget);
            Touch();
        }

        public void RemoveWidget(string widgetId)
        {
            _widgets.RemoveAll(w => w.Id == widgetId);
            Touch();
        }

        public void UpdateWidget(Widget updated)
        {
            var index = _widgets.FindIndex(w => w.Id == updated.Id);
            if (index < 0) throw new InvalidOperationException($"Widget {updated.Id} not found.");
            _widgets[index] = updated;
            Touch();
        }

        public void AddFilter(Filter filter)
        {
            if (filter == null) throw new ArgumentNullException(nameof(filter));
            _filters.Add(filter);
            Touch();
        }

        public void RemoveFilter(string filterId)
        {
            _filters.RemoveAll(f => f.Id == filterId);
            Touch();
        }

        public void UpdateTitle(string title)
        {
            Title = title ?? throw new ArgumentNullException(nameof(title));
            Touch();
        }

        private void Touch() => UpdatedAt = DateTime.UtcNow;
    }
}
