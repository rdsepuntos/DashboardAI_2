CREATE OR ALTER VIEW dbo.AID_ControlActions AS

-- Plain corrective actions straight from _ControlsTable (no record-header join).
-- Use when you only need action attributes (status, priority, responsible, deadline,
-- department, cost) and do NOT need ModuleType / ParentTitle or draft/deleted filtering.
SELECT
    c.ControlID,
    c.StoreID,
    c.ParentID,
    c.RefType,
    c.Action,
    c.Category,
    c.CategoryID,
    c.Comment,
    c.ActionStatus,
    c.ActionStatus                                     AS Status,
    c.ActionStatusID,
    c.Priority,
    c.PriorityID,
    c.Responsible,
    c.ResponsibleID,
    -- Deadline first — used as the date range column for StartDate/EndDate filters
    c.Deadline,
    c.DeadlineString,
    c.StartDate,
    c.StartDateString,
    c.CompletedOn,
    c.CompletedOnString,
    c.Division,
    c.DivisionID,
    c.Department,
    c.DepartmentID,
    c.Programme,
    c.ProgrammeID,
    c.LocationName,
    c.LocationID,
    c.LocationType,
    c.LocationTypeID,
    c.EstCost,
    c.CreatedDt
FROM dbo._ControlsTable AS c
GO
