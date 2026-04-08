-- =============================================================================
--  DashboardAI — Full Database Setup
--  Run this script against Agtech_WHSMonitor in SSMS.
--  Safe to re-run: all statements are guarded with IF NOT EXISTS.
-- =============================================================================

USE Agtech_WHSMonitor;
GO

-- =============================================================================
--  1. DashboardLayouts  — stores saved dashboard layouts per user + store
-- =============================================================================
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'DashboardLayouts')
BEGIN
    CREATE TABLE dbo.DashboardLayouts
    (
        Id             UNIQUEIDENTIFIER  NOT NULL  DEFAULT NEWID()  PRIMARY KEY,
        Title          NVARCHAR(200)     NOT NULL,
        StoreId        INT               NOT NULL,
        UserId         NVARCHAR(100)     NOT NULL,
        OriginalPrompt NVARCHAR(MAX)     NULL,
        LayoutJson     NVARCHAR(MAX)     NOT NULL,
        CreatedAt      DATETIME2         NOT NULL  DEFAULT GETUTCDATE(),
        UpdatedAt      DATETIME2         NOT NULL  DEFAULT GETUTCDATE()
    );

    CREATE INDEX IX_DashboardLayouts_UserStore
        ON dbo.DashboardLayouts (UserId, StoreId);

    PRINT 'Created table: DashboardLayouts';
END
ELSE
    PRINT 'Already exists, skipped: DashboardLayouts';
GO

-- =============================================================================
--  2. DataSourceRegistry  — registers SQL views / SPs available to the AI
-- =============================================================================
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'DataSourceRegistry')
BEGIN
    CREATE TABLE dbo.DataSourceRegistry
    (
        Id              INT            NOT NULL IDENTITY(1,1)  PRIMARY KEY,
        Name            NVARCHAR(200)  NOT NULL,
        Description     NVARCHAR(MAX)  NOT NULL,
        Kind            NVARCHAR(20)   NOT NULL,   -- 'View' | 'StoredProcedure'
        ColumnsJson     NVARCHAR(MAX)  NOT NULL,   -- JSON array of column definitions
        SupportedParams NVARCHAR(500)  NULL,        -- comma-separated param names
        IsActive        BIT            NOT NULL DEFAULT 1,
        CreatedAt       DATETIME2      NOT NULL DEFAULT GETUTCDATE(),
        UpdatedAt       DATETIME2      NOT NULL DEFAULT GETUTCDATE()
    );

    CREATE UNIQUE INDEX UX_DataSourceRegistry_Name
        ON dbo.DataSourceRegistry (Name);

    PRINT 'Created table: DataSourceRegistry';
END
ELSE
    PRINT 'Already exists, skipped: DataSourceRegistry';
GO

-- =============================================================================
--  3. Seed DataSourceRegistry rows
-- =============================================================================

-- AID_HazardReport
IF NOT EXISTS (SELECT 1 FROM dbo.DataSourceRegistry WHERE Name = 'AID_HazardReport')
BEGIN
    INSERT INTO dbo.DataSourceRegistry (Name, Description, Kind, ColumnsJson, SupportedParams)
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
    PRINT 'Seeded: AID_HazardReport';
END
ELSE
    PRINT 'Already exists, skipped seed: AID_HazardReport';

-- AID_AuditAndInspection
IF NOT EXISTS (SELECT 1 FROM dbo.DataSourceRegistry WHERE Name = 'AID_AuditAndInspection')
BEGIN
    INSERT INTO dbo.DataSourceRegistry (Name, Description, Kind, ColumnsJson, SupportedParams)
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
    PRINT 'Seeded: AID_AuditAndInspection';
END
ELSE
    PRINT 'Already exists, skipped seed: AID_AuditAndInspection';
GO

PRINT '--- DashboardAI setup complete ---';
