CREATE OR ALTER VIEW dbo.AID_Actions AS
SELECT
    c.ControlID,
    c.StoreID,
    c.ParentID                                          AS RegOthID,
    h.RegTypeID,
    CASE h.RegTypeID
        WHEN 27 THEN 'Hazard Report'
        WHEN 21 THEN 'Audit & Inspection'
        WHEN 46 THEN 'Incident'
        WHEN 29 THEN 'Risk Assessment'
        WHEN 32 THEN 'Job Procedure'
        WHEN 16 THEN 'Policy'
        ELSE 'Other'
    END                                                 AS ModuleType,
    h.TitleDesc                                         AS ParentTitle,
    h.InternalNo,
    c.Action,
    c.Category,
    c.ActionStatus,
    c.ActionStatusID,
    c.Priority,
    c.PriorityID,
    c.Responsible,
    c.ResponsibleID,
    -- Deadline first — used as the date range column for StartDate/EndDate filters
    c.Deadline,
    c.DeadlineString,
    c.CompletedOn,
    c.CompletedOnString,
    c.StartDate,
    c.StartDateString,
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
INNER JOIN dbo.RegisterOthHdr AS h
    ON h.RegOthID = c.ParentID
WHERE ISNULL(h.Deleted, 0) = 0
  AND ISNULL(h.IsDraft,  0) = 0
GO
