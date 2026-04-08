CREATE OR ALTER VIEW dbo.AID_HazardReport AS
SELECT
    A.StoreID,
    A.RegOthID,
    A.InternalNo,
    A.TitleDesc                                                                     AS RecordName,
    sts.StatusDesc                                                                  AS Status,
    A.StartDt,
    CASE WHEN ISNUMERIC(ISNULL(Score, '0')) = 1
         THEN CAST(Score AS numeric(12, 2)) ELSE 0.00 END                          AS Score,
    rt.RegRecDesc                                                                   AS Type,
    rst.SubTypeDesc                                                                 AS SubType,
    loctype.LocationTypeName                                                        AS LocationType,
    A.LocationName                                                                  AS Location,
    chk.TemplateName                                                                AS Checklist,
    CONVERT(NVARCHAR(256), A.CreatedDt, 103)                                       AS CreatedDate,
    A.CreatedByName                                                                 AS CreatedBy,
    presp.FirstName      + ' ' + presp.LastName                                    AS PersonResponsible,
    hazt.HazardTypeDesc                                                             AS HazardType,
    hazst.HazardTypeDetDesc                                                         AS Hazard,
    haz.HazardDesc                                                                  AS HazardSource,
    haz.RiskDescription,

    haz.RegOthHazTplHazID,
    division.DivDeptName                                                            AS Division,
    department.DivDeptName                                                          AS Department,
    A.Programme,

    ISNULL(division.DivDeptName, '')
        + CASE WHEN ISNULL(department.DivDeptName, '') <> '' THEN ' - ' ELSE ' ' END
        + ISNULL(department.DivDeptName, '')                                        AS DepartmentFilter,

    ISNULL(division.DivDeptName, '')
        + CASE WHEN ISNULL(department.DivDeptName, '') <> '' THEN ' - ' ELSE ' ' END
        + ISNULL(department.DivDeptName, '')
        + CASE WHEN ISNULL(A.Programme, '') <> '' THEN ' - ' ELSE ' ' END
        + ISNULL(A.Programme, '')                                                   AS ProgrammeFilter,

    A.CreatedByID,
    A.ReportedByID,
    A.ResponsibleID,
    A.DivisionID,
    A.DepartmentID,
    A.LocationTypeID,
    A.LocationID,
    reportedby.FirstName + ' ' + reportedby.LastName                               AS ReportedBy,
    A.HazardTemplateId

FROM dbo.RegisterOthHdr AS A

-- ── Org structure ──────────────────────────────────────────────────────────────
LEFT JOIN dbo.StoreDivisionDept                  AS division      ON A.DivisionID         = division.StoreDivDeptID
LEFT JOIN dbo.StoreDivisionDept                  AS department    ON A.DepartmentID        = department.StoreDivDeptID

-- ── Reference lookups (kept as subqueries per requirement) ────────────────────
LEFT JOIN (SELECT RegRecTypeID,   RegRecDesc   FROM dbo.ref_RegisterRecTypes)                    AS rt  ON A.OthTypeID    = rt.RegRecTypeID
LEFT JOIN (SELECT RegRecSubTypeID, SubTypeDesc  FROM dbo.ref_RegisterRecSubTypes)                AS rst ON A.OthSubTypeID = rst.RegRecSubTypeID
LEFT JOIN (SELECT RegStatusID,    StatusDesc   FROM dbo.ref_RegisterStatus WHERE RegTypeID = 50) AS sts ON A.StatusID     = sts.RegStatusID

-- ── Location / users ──────────────────────────────────────────────────────────
LEFT JOIN dbo.ref_LocationTypes                  AS loctype       ON A.LocationTypeID      = loctype.LocationTypeID
LEFT JOIN dbo.StoreUsers                         AS reportedby    ON A.ReportedByID        = reportedby.StoreUserID
LEFT JOIN dbo.StoreUsers                         AS presp         ON A.ResponsibleID       = presp.StoreUserID

-- ── Hazard template & detail ──────────────────────────────────────────────────
LEFT JOIN dbo.ref_RAHazardTemplates              AS chk           ON A.HazardTemplateId    = chk.HazardTemplateID
                                                                  AND A.StoreID            = chk.StoreID
LEFT JOIN dbo.RegisterOthHazardTemplateHazards   AS haz           ON A.RegOthID            = haz.RegOthID
LEFT JOIN dbo.ref_HazardTypes                    AS hazt          ON haz.HazardTypeID      = hazt.HazardTypeID
LEFT JOIN dbo.ref_HazardTypesDet                 AS hazst         ON haz.HazardTypeDetID   = hazst.HazardTypeDetID

WHERE ISNULL(A.Deleted,   0) = 0
  AND ISNULL(A.IsDraft,   0) = 0
  AND ISNULL(A.RegTypeID, 0) = 27
GO



