-- =============================================================================
--  AID_TemplateResponses
--  Flattened template question-answer rows for ALL WHS modules.
--
--  Each row = one answered question for one record.
--    Section          — group heading (from ref_RAHazardTemplateHeading.HeadingDesc)
--    Question         — question label (AlternativeName from ref_RAHazardTemplatesDet, falls back to HazardDesc)
--    Answer           — response value  (RegisterOthHazardTemplates.HazardValue)
--
--  Join key to link back to parent records: RegOthID
--  Join key to link to actions raised from a question: RegOthHazTempalteID
--
--  Run in: Agtech_WHSMonitor
-- =============================================================================

CREATE OR ALTER VIEW dbo.AID_TemplateResponses AS
SELECT
    t.RegOthHazTempalteID,
    t.RegOthID,
    h.StoreID,
    h.RegTypeID,
    CASE h.RegTypeID
        WHEN 27 THEN 'Hazard Report'
        WHEN 21 THEN 'Audit & Inspection'
        WHEN 46 THEN 'Incident'
        WHEN 29 THEN 'Risk Assessment'
        WHEN 32 THEN 'Job Procedure'
        WHEN 16 THEN 'Policy'
        ELSE 'Other'
    END                                           AS ModuleType,
    h.TitleDesc                                   AS RecordTitle,
    h.InternalNo,
    sts.StatusDesc                                AS Status,
    h.StartDt,
    CONVERT(NVARCHAR(20), h.StartDt, 103)         AS StartDtString,
    h.LocationName                                AS Location,
    h.Programme,
    division.DivDeptName                          AS Division,
    department.DivDeptName                        AS Department,
    h.CreatedDt,
    CONVERT(NVARCHAR(20), h.CreatedDt, 103)       AS CreatedDtString,
    t.HazardTemplateID,
    tmpl.TemplateName,
    sec.HeadingDesc                               AS Section,
    COALESCE(c.AlternativeName, t.HazardDesc)     AS Question,
    t.HazardValue                                 AS Answer,
    t.SortOrder,
    t.ItemNo
FROM dbo.RegisterOthHazardTemplates AS t
INNER JOIN dbo.RegisterOthHdr AS h
    ON h.RegOthID = t.RegOthID
INNER JOIN dbo.ref_RAHazardTemplateHeading AS sec
    ON sec.HeadingID = t.HazardGroupID
LEFT JOIN dbo.ref_RAHazardTemplatesDet AS c
    ON c.HazardTemplateDetID = t.HazardTemplateDetID
LEFT JOIN dbo.ref_RAHazardTemplates AS tmpl
    ON tmpl.HazardTemplateID = t.HazardTemplateID
LEFT JOIN dbo.ref_RegisterStatus AS sts
    ON sts.RegStatusID = h.StatusID
   AND sts.RegTypeID   = h.RegTypeID
LEFT JOIN dbo.StoreDivisionDept AS division
    ON division.StoreDivDeptID = h.DivisionID
LEFT JOIN dbo.StoreDivisionDept AS department
    ON department.StoreDivDeptID = h.DepartmentID
WHERE ISNULL(h.Deleted, 0) = 0
  AND ISNULL(h.IsDraft,  0) = 0
  AND ISNULL(t.HazardValue, '') <> ''
GO
