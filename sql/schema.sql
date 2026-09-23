-- =============================================================================
--  DashboardAI  –  Database Schema
--  SQL Server
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
--  Core table: persists dashboard layout JSON per user + store
-- ─────────────────────────────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'DashboardLayouts')
BEGIN
    CREATE TABLE dbo.DashboardLayouts
    (
        Id             UNIQUEIDENTIFIER  NOT NULL  DEFAULT NEWID()  PRIMARY KEY,
        Title          NVARCHAR(200)     NOT NULL,
        StoreId        INT               NOT NULL,
        UserId         NVARCHAR(100)     NOT NULL,
        OriginalPrompt NVARCHAR(MAX)     NULL,
        LayoutJson     NVARCHAR(MAX)     NOT NULL,   -- full widgets + filters JSON
        CreatedAt      DATETIME2         NOT NULL  DEFAULT GETUTCDATE(),
        UpdatedAt      DATETIME2         NOT NULL  DEFAULT GETUTCDATE()
    );

    CREATE INDEX IX_DashboardLayouts_UserStore
        ON dbo.DashboardLayouts (UserId, StoreId);

    PRINT 'Created table: DashboardLayouts';
END
ELSE
    PRINT 'Table already exists, skipped: DashboardLayouts';

-- ─────────────────────────────────────────────────────────────────────────────
--  Per-session applied filter values, persisted so filters survive within a session
-- ─────────────────────────────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'DashboardFilterState')
BEGIN
    CREATE TABLE dbo.DashboardFilterState
    (
        DashboardId     UNIQUEIDENTIFIER  NOT NULL,
        SessionId       NVARCHAR(100)     NOT NULL,
        StoreId         INT               NOT NULL,
        FilterStateJson NVARCHAR(MAX)     NOT NULL,   -- { filterId: value, ... }
        UpdatedAt       DATETIME2         NOT NULL  DEFAULT GETUTCDATE(),
        CONSTRAINT PK_DashboardFilterState PRIMARY KEY (DashboardId, SessionId)
    );

    PRINT 'Created table: DashboardFilterState';
END
ELSE
    PRINT 'Table already exists, skipped: DashboardFilterState';
