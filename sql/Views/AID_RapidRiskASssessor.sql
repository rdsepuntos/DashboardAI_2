USE [Agtech_WHSMonitor]
GO

/****** Object:  View [dbo].[AID_IncidentAssessor]    Script Date: 4/9/2026 12:19:13 PM ******/
SET ANSI_NULLS ON
GO

SET QUOTED_IDENTIFIER ON
GO


CREATE VIEW [dbo].[AID_RapidRiskAssessor]
AS
SELECT        A.StoreID, A.RegOthID, A.InternalNo, A.TitleDesc AS RecordName, ISNULL(sts.StatusDesc, 'N/A') AS Status, A.StartDt, ISNULL(rt.RegRecDesc, 'N/A') AS Type, ISNULL(rst.SubTypeDesc, 'N/A') AS SubType, ISNULL(loctype.LocationTypeName, 'N/A') AS LocationType, ISNULL(A.LocationName, 'N/A') 
                         AS Location, ISNULL(chk.TemplateName, 'N/A') AS Checklist, CONVERT(NVARCHAR(256), A.CreatedDt, 103) AS CreatedDate, ISNULL(A.CreatedByName, 'N/A') AS CreatedBy, 
                         ISNULL(presp.FirstName + ' ' + presp.LastName, 'N/A') AS PersonResponsible, ISNULL(hazt.HazardTypeDesc, 'N/A') AS HazardType, ISNULL(hazst.HazardTypeDetDesc, 'N/A') AS Hazard, 
                         ISNULL(haz.HazardDesc, 'N/A') AS HazardSource, ISNULL(haz.RiskDescription, 'N/A') AS RiskDescription, haz.RegOthHazTplHazID, ISNULL(division.DivDeptName, 'N/A') AS Division, ISNULL(department.DivDeptName, 
                         'N/A') AS Department, ISNULL(A.Programme, 'N/A') AS Programme,
                         ISNULL(division.DivDeptName, '') + CASE WHEN ISNULL(department.DivDeptName, '') <> '' THEN ' - ' ELSE '' END + ISNULL(department.DivDeptName, '') AS DepartmentFilter,
                         ISNULL(division.DivDeptName, '') + CASE WHEN ISNULL(department.DivDeptName, '') <> '' THEN ' - ' ELSE '' END + ISNULL(department.DivDeptName, '') + CASE WHEN ISNULL(A.Programme, '') <> '' THEN ' - ' ELSE '' END + ISNULL(A.Programme, '') AS ProgrammeFilter,
                         A.CreatedByID, 
                         A.ReportedByID, A.ResponsibleID, A.DivisionID, A.DepartmentID, A.LocationTypeID, A.LocationID, ISNULL(reportedby.FirstName + ' ' + reportedby.LastName, 'N/A') AS ReportedBy, A.HazardTemplateId
FROM            dbo.RegisterOthHdr AS A LEFT OUTER JOIN
                         dbo.StoreDivisionDept AS division ON A.DivisionID = division.StoreDivDeptID LEFT OUTER JOIN
                         dbo.StoreDivisionDept AS department ON A.DepartmentID = department.StoreDivDeptID LEFT OUTER JOIN
                         dbo.ref_RegisterRecTypes AS rt ON A.OthTypeID = rt.RegRecTypeID LEFT OUTER JOIN
                         dbo.ref_RegisterRecSubTypes AS rst ON A.OthSubTypeID = rst.RegRecSubTypeID LEFT OUTER JOIN
                         dbo.ref_RegisterStatus AS sts ON A.StatusID = sts.RegStatusID AND sts.RegTypeID = 27 LEFT OUTER JOIN
                         dbo.ref_LocationTypes AS loctype ON A.LocationTypeID = loctype.LocationTypeID LEFT OUTER JOIN
                         dbo.StoreUsers AS reportedby ON A.ReportedByID = reportedby.StoreUserID LEFT OUTER JOIN
                         dbo.StoreUsers AS presp ON A.ResponsibleID = presp.StoreUserID LEFT OUTER JOIN
                         dbo.ref_RAHazardTemplates AS chk ON A.HazardTemplateId = chk.HazardTemplateID AND A.StoreID = chk.StoreID LEFT OUTER JOIN
                         dbo.RegisterOthHazardTemplateHazards AS haz ON A.RegOthID = haz.RegOthID LEFT OUTER JOIN
                         dbo.ref_HazardTypes AS hazt ON haz.HazardTypeID = hazt.HazardTypeID LEFT OUTER JOIN
                         dbo.ref_HazardTypesDet AS hazst ON haz.HazardTypeDetID = hazst.HazardTypeDetID
WHERE        (ISNULL(A.deleted, 0) = 0) AND (ISNULL(A.IsDraft, 0) = 0) AND (ISNULL(A.RegTypeID, 0) = 29)
GO




