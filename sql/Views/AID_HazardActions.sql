USE [Agtech_WHSMonitor]
GO

/****** Object:  View [dbo].[AID_HazardActions]    Script Date: 9/24/2026 1:48:34 PM ******/
SET ANSI_NULLS ON
GO

SET QUOTED_IDENTIFIER ON
GO


ALTER   VIEW [dbo].[AID_HazardActions] AS
SELECT
    c.ControlID,
    c.StoreID,
    c.ParentID                                          AS RegOthID,
    h.TitleDesc                                         AS HazardTitle,
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
    c.CreatedDt,
	d.StoreName SiteName
FROM dbo._ControlsTable AS c
INNER JOIN dbo.RegisterOthHdr AS h
    ON h.RegOthID = c.ParentID
INNER JOIN dbo.Store d on d.StoreID = h.StoreID
WHERE ISNULL(h.Deleted, 0) = 0
  AND ISNULL(h.IsDraft,  0) = 0
  AND h.RegTypeID = 27   -- Hazard Reports only
GO


