-- =============================================================================
--  AID_TemplateList
--  Master list of active WHS templates available in a store.
--  Used as an optionsSource for dashboard filters so users can pick a template
--  by name. HazardTemplateID is the value; TemplateName is the label.
--
--  Run in: Agtech_WHSMonitor
-- =============================================================================

CREATE OR ALTER VIEW dbo.AID_TemplateList AS

SELECT
    t.HazardTemplateID,
    t.TemplateName,
    t.StoreID,
    b.RegisterTypeId RegTypeID,
    CASE b.RegisterTypeId
        WHEN 27 THEN 'Hazard Report'
        WHEN 21 THEN 'Audit & Inspection'
        WHEN 46 THEN 'Incident'
        WHEN 29 THEN 'Risk Assessment'
        WHEN 32 THEN 'Job Procedure'
        WHEN 16 THEN 'Policy'
        ELSE 'Other'
    END                             AS ModuleType,
    t.TemplateNo,
    t.VersionNo
FROM dbo.ref_RAHazardTemplates AS t
join ref_TemplateTypes as b on b.TemplateTypeID = t.TemplateTypeID
WHERE ISNULL(t.Deleted,    0) = 0
  AND ISNULL(t.IsArchived, 0) = 0
  AND ISNULL(t.IsHidden,   0) = 0
GO
