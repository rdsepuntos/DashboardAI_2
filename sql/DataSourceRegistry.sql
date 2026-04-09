-- =============================================================================
--  DataSourceRegistry table
--  Stores all SQL views and stored procedures available to the AI.
--  Add a row here whenever you create a new view or SP — no code changes needed.
-- =============================================================================

CREATE TABLE DataSourceRegistry
(
    Id              INT            NOT NULL IDENTITY(1,1)  PRIMARY KEY,
    Name            NVARCHAR(200)  NOT NULL,
    Description     NVARCHAR(MAX)  NOT NULL,
    Kind            NVARCHAR(20)   NOT NULL,   -- 'View' | 'StoredProcedure'
    -- JSON array: [{"name":"ColName","dataType":"string|number|date","description":"..."}]
    ColumnsJson     NVARCHAR(MAX)  NOT NULL,
    -- Comma-separated list of supported WHERE params e.g. 'StoreID,StartDate,EndDate'
    SupportedParams NVARCHAR(500)  NULL,
    IsActive        BIT            NOT NULL DEFAULT 1,
    CreatedAt       DATETIME2      NOT NULL DEFAULT GETUTCDATE(),
    UpdatedAt       DATETIME2      NOT NULL DEFAULT GETUTCDATE()
);

CREATE UNIQUE INDEX UX_DataSourceRegistry_Name
    ON DataSourceRegistry (Name);

GO

-- =============================================================================
--  Seed: your registered views
--  Add one INSERT per view / SP you want the AI to be able to use.
-- =============================================================================

-- ── AID_HazardReport ─────────────────────────────────────────────────────────
INSERT INTO DataSourceRegistry (Name, Description, Kind, ColumnsJson, SupportedParams)
VALUES (
    'AID_HazardReport',
    'Hazard identification records per store — includes hazard type, source, risk description, location, responsible person, and org hierarchy',
    'View',
    '[
        {"name":"StoreID",           "dataType":"number", "description":"Store identifier"},
        {"name":"RegOthID",          "dataType":"number", "description":"Record identifier"},
        {"name":"InternalNo",        "dataType":"string", "description":"Internal reference number"},
        {"name":"RecordName",        "dataType":"string", "description":"Title / name of the hazard record"},
        {"name":"Status",            "dataType":"string", "description":"Current status of the record"},
        {"name":"StartDt",           "dataType":"date",   "description":"Start date of the record"},
        {"name":"Score",             "dataType":"number", "description":"Risk score"},
        {"name":"Type",              "dataType":"string", "description":"Record type description"},
        {"name":"SubType",           "dataType":"string", "description":"Record sub-type description"},
        {"name":"LocationType",      "dataType":"string", "description":"Type of location"},
        {"name":"Location",          "dataType":"string", "description":"Location name"},
        {"name":"Checklist",         "dataType":"string", "description":"Hazard assessment template / checklist name"},
        {"name":"CreatedDate",       "dataType":"string", "description":"Date the record was created (dd/MM/yyyy)"},
        {"name":"CreatedBy",         "dataType":"string", "description":"Name of user who created the record"},
        {"name":"PersonResponsible", "dataType":"string", "description":"Full name of the responsible person"},
        {"name":"HazardType",        "dataType":"string", "description":"Hazard type category"},
        {"name":"Hazard",            "dataType":"string", "description":"Hazard sub-type detail"},
        {"name":"HazardSource",      "dataType":"string", "description":"Description of the hazard source"},
        {"name":"RiskDescription",   "dataType":"string", "description":"Description of the risk"},
        {"name":"Division",          "dataType":"string", "description":"Division name"},
        {"name":"Department",        "dataType":"string", "description":"Department name"},
        {"name":"Programme",         "dataType":"string", "description":"Programme name"},
        {"name":"DepartmentFilter",  "dataType":"string", "description":"Division - Department concatenation for filtering"},
        {"name":"ProgrammeFilter",   "dataType":"string", "description":"Division - Department - Programme concatenation for filtering"},
        {"name":"ReportedBy",        "dataType":"string", "description":"Full name of the person who reported the hazard"},
        {"name":"HazardTemplateId",  "dataType":"number", "description":"Hazard template identifier"}
    ]',
    'StoreID,StartDate,EndDate'
);

-- ── AID_AuditAndInspection ───────────────────────────────────────────────────
INSERT INTO DataSourceRegistry (Name, Description, Kind, ColumnsJson, SupportedParams)
VALUES (
    'AID_AuditAndInspection',
    'Audit and inspection records per store — same structure as hazard report but filtered to audit/inspection record type (RegTypeID 21)',
    'View',
    '[
        {"name":"StoreID",           "dataType":"number", "description":"Store identifier"},
        {"name":"RegOthID",          "dataType":"number", "description":"Record identifier"},
        {"name":"InternalNo",        "dataType":"string", "description":"Internal reference number"},
        {"name":"RecordName",        "dataType":"string", "description":"Title / name of the audit or inspection record"},
        {"name":"Status",            "dataType":"string", "description":"Current status of the record"},
        {"name":"StartDt",           "dataType":"date",   "description":"Start date of the record"},
        {"name":"Score",             "dataType":"number", "description":"Audit / inspection score"},
        {"name":"Type",              "dataType":"string", "description":"Record type description"},
        {"name":"SubType",           "dataType":"string", "description":"Record sub-type description"},
        {"name":"LocationType",      "dataType":"string", "description":"Type of location"},
        {"name":"Location",          "dataType":"string", "description":"Location name"},
        {"name":"Checklist",         "dataType":"string", "description":"Audit / inspection checklist template name"},
        {"name":"CreatedDate",       "dataType":"string", "description":"Date the record was created (dd/MM/yyyy)"},
        {"name":"CreatedBy",         "dataType":"string", "description":"Name of user who created the record"},
        {"name":"PersonResponsible", "dataType":"string", "description":"Full name of the responsible person"},
        {"name":"HazardType",        "dataType":"string", "description":"Hazard type category"},
        {"name":"Hazard",            "dataType":"string", "description":"Hazard sub-type detail"},
        {"name":"HazardSource",      "dataType":"string", "description":"Description of the hazard source"},
        {"name":"RiskDescription",   "dataType":"string", "description":"Description of the risk"},
        {"name":"Division",          "dataType":"string", "description":"Division name"},
        {"name":"Department",        "dataType":"string", "description":"Department name"},
        {"name":"Programme",         "dataType":"string", "description":"Programme name"},
        {"name":"DepartmentFilter",  "dataType":"string", "description":"Division - Department concatenation for filtering"},
        {"name":"ProgrammeFilter",   "dataType":"string", "description":"Division - Department - Programme concatenation for filtering"},
        {"name":"ReportedBy",        "dataType":"string", "description":"Full name of the person who reported the record"},
        {"name":"HazardTemplateId",  "dataType":"number", "description":"Hazard template identifier"}
    ]',
    'StoreID,StartDate,EndDate'
);

-- ── AID_IncidentAssessor ─────────────────────────────────────────────────────
-- INSERT skipped — row already exists. Run the UPDATE below to sync columns.
UPDATE DataSourceRegistry
SET
    Description    = 'Incident assessor records per store — includes incident type, sub-type, location, responsible person, org hierarchy, and hazard details (RegTypeID 46)',
    ColumnsJson    = '[
        {"name":"StoreID",           "dataType":"number", "description":"Store identifier"},
        {"name":"RegOthID",          "dataType":"number", "description":"Record identifier"},
        {"name":"InternalNo",        "dataType":"string", "description":"Internal reference number"},
        {"name":"RecordName",        "dataType":"string", "description":"Title / name of the incident record"},
        {"name":"Status",            "dataType":"string", "description":"Current status of the record"},
        {"name":"StartDt",           "dataType":"date",   "description":"Start date of the record"},
        {"name":"Type",              "dataType":"string", "description":"Record type description"},
        {"name":"SubType",           "dataType":"string", "description":"Record sub-type description"},
        {"name":"LocationType",      "dataType":"string", "description":"Type of location"},
        {"name":"Location",          "dataType":"string", "description":"Location name"},
        {"name":"Checklist",         "dataType":"string", "description":"Assessment checklist template name"},
        {"name":"CreatedDate",       "dataType":"string", "description":"Date the record was created (dd/MM/yyyy)"},
        {"name":"CreatedBy",         "dataType":"string", "description":"Name of user who created the record"},
        {"name":"PersonResponsible", "dataType":"string", "description":"Full name of the responsible person"},
        {"name":"HazardType",        "dataType":"string", "description":"Hazard type category"},
        {"name":"Hazard",            "dataType":"string", "description":"Hazard sub-type detail"},
        {"name":"HazardSource",      "dataType":"string", "description":"Description of the hazard source"},
        {"name":"RiskDescription",   "dataType":"string", "description":"Description of the risk"},
        {"name":"Division",          "dataType":"string", "description":"Division name"},
        {"name":"Department",        "dataType":"string", "description":"Department name"},
        {"name":"Programme",         "dataType":"string", "description":"Programme name"},
        {"name":"DepartmentFilter",  "dataType":"string", "description":"Division - Department concatenation for filtering"},
        {"name":"ProgrammeFilter",   "dataType":"string", "description":"Division - Department - Programme concatenation for filtering"},
        {"name":"ReportedBy",        "dataType":"string", "description":"Full name of the person who reported the incident"},
        {"name":"HazardTemplateId",  "dataType":"number", "description":"Hazard template identifier"}
    ]',
    SupportedParams = 'StoreID,StartDate,EndDate',
    UpdatedAt       = GETUTCDATE()
WHERE Name = 'AID_IncidentAssessor';

-- ── ADD MORE VIEWS / SPs BELOW — no code changes needed ─────────────────────
-- INSERT INTO DataSourceRegistry (Name, Description, Kind, ColumnsJson, SupportedParams)
-- VALUES ('vw_MyNewView', 'Description here', 'View', '[{"name":"Col1","dataType":"string","description":"..."}]', 'StoreID');
