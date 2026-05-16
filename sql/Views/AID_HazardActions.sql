CREATE OR ALTER VIEW dbo.AID_Actions AS

-- ── Branch 1: Actions linked directly to the record header (ParentID = RegOthID) ──
SELECT
    c.ControlID,
    COALESCE(c.StoreID, h.StoreID)                      AS StoreID,
    h.RegOthID,
    NULL                                                AS RegOthHazTempalteID,
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
    NULL                                                AS TemplateQuestion,
    NULL                                                AS TemplateAnswer,
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

UNION ALL

-- ── Branch 2: Actions linked to a specific template question (ParentID = RegOthHazTempalteID) ──
SELECT
    c.ControlID,
    COALESCE(c.StoreID, h.StoreID)                      AS StoreID,
    h.RegOthID,
    t.RegOthHazTempalteID,
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
    t.HazardDesc                                        AS TemplateQuestion,
    t.HazardValue                                       AS TemplateAnswer,
    c.Action,
    c.Category,
    c.ActionStatus,
    c.ActionStatusID,
    c.Priority,
    c.PriorityID,
    c.Responsible,
    c.ResponsibleID,
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
INNER JOIN dbo.RegisterOthHazardTemplates AS t
    ON t.RegOthHazTempalteID = c.ParentID
INNER JOIN dbo.RegisterOthHdr AS h
    ON h.RegOthID = t.RegOthID
WHERE ISNULL(h.Deleted, 0) = 0
  AND ISNULL(h.IsDraft,  0) = 0
GO
