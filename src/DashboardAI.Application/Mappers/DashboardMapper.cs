using System;
using System.Collections.Generic;
using System.Linq;
using DashboardAI.Application.DTOs;
using DashboardAI.Domain.Entities;
using DashboardAI.Domain.ValueObjects;

namespace DashboardAI.Application.Mappers
{
    public static class DashboardMapper
    {
        public static DashboardDto ToDto(Dashboard d)
        {
            return new DashboardDto
            {
                Id             = d.Id,
                Title          = d.Title,
                StoreId        = d.StoreId,
                UserId         = d.UserId,
                OriginalPrompt = d.OriginalPrompt,
                CreatedAt      = d.CreatedAt,
                UpdatedAt      = d.UpdatedAt,
                Filters        = d.Filters.Select(FilterMapper.ToDto).ToList(),
                Widgets        = d.Widgets.Select(WidgetMapper.ToDto).ToList()
            };
        }

        public static Dashboard ToDomain(DashboardDto dto)
        {
            return new Dashboard(
                dto.Id,
                dto.Title,
                dto.StoreId,
                dto.UserId,
                dto.OriginalPrompt,
                dto.Widgets?.Select(WidgetMapper.ToDomain).ToList() ?? new List<Widget>(),
                dto.Filters?.Select(FilterMapper.ToDomain).ToList() ?? new List<Filter>()
            );
        }
    }

    public static class WidgetMapper
    {
        public static WidgetDto ToDto(Widget w)
        {
            return new WidgetDto
            {
                Id             = w.Id,
                Type           = w.Type.ToString().ToLower(),
                ChartType      = w.ChartType,
                Title          = w.Title,
                DataSource     = w.DataSource,
                AppliesFilters = w.AppliesFilters,
                Position       = new PositionDto { X = w.Position.X, Y = w.Position.Y, W = w.Position.W, H = w.Position.H },
                Config         = new Dictionary<string, string>(w.Config.ToDictionary())
            };
        }

        public static Widget ToDomain(WidgetDto dto)
        {
            if (!Enum.TryParse<WidgetType>(dto.Type, true, out var type))
                type = WidgetType.Chart;

            return new Widget(
                dto.Id,
                type,
                dto.Title,
                dto.DataSource,
                new WidgetPosition(dto.Position?.X ?? 0, dto.Position?.Y ?? 0, dto.Position?.W ?? 6, dto.Position?.H ?? 4),
                new WidgetConfig(dto.Config ?? new Dictionary<string, string>()),
                dto.ChartType,
                dto.AppliesFilters
            );
        }
    }

    public static class FilterMapper
    {
        public static FilterDto ToDto(Filter f)
        {
            return new FilterDto
            {
                Id            = f.Id,
                Type          = f.Type.ToString().ToLower(),
                Label         = f.Label,
                Param         = f.Param,
                OptionsSource = f.OptionsSource,
                ValueKey      = f.ValueKey,
                LabelKey      = f.LabelKey,
                IsLocked      = f.IsLocked,
                DefaultValue  = f.DefaultValue
            };
        }

        public static Filter ToDomain(FilterDto dto)
        {
            if (!Enum.TryParse<FilterType>(dto.Type, true, out var type))
                type = FilterType.Dropdown;

            return new Filter(
                dto.Id,
                type,
                dto.Label,
                dto.Param,
                dto.OptionsSource,
                dto.ValueKey,
                dto.LabelKey,
                dto.IsLocked,
                dto.DefaultValue
            );
        }
    }
}
