-- =============================================================================
--  Seed: your registered views
--  Safe to re-run at any time — truncates and re-inserts all rows.
--  Add one INSERT per view / SP you want the AI to be able to use.
-- =============================================================================

TRUNCATE TABLE DataSourceRegistry;

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
    'StoreID,StartDate,EndDate,Status,HazardType,Department,Location'
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
    'StoreID,StartDate,EndDate,Status,HazardType,Department,Location'
);

-- ── AID_IncidentAssessor ─────────────────────────────────────────────────────
INSERT INTO DataSourceRegistry (Name, Description, Kind, ColumnsJson, SupportedParams)
VALUES (
    'AID_IncidentAssessor',
    'Incident assessor records per store — includes incident type, sub-type, location, responsible person, org hierarchy, and hazard details (RegTypeID 46)',
    'View',
    '[
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
    'StoreID,StartDate,EndDate,Status,HazardType,Department,Location'
);

-- ── AID_RapidRiskAssessor ────────────────────────────────────────────────────
INSERT INTO DataSourceRegistry (Name, Description, Kind, ColumnsJson, SupportedParams)
VALUES (
    'AID_RapidRiskAssessor',
    'Rapid risk assessor records per store — includes risk type, sub-type, location, responsible person, org hierarchy, and hazard details (RegTypeID 29)',
    'View',
    '[
        {"name":"StoreID",           "dataType":"number", "description":"Store identifier"},
        {"name":"RegOthID",          "dataType":"number", "description":"Record identifier"},
        {"name":"InternalNo",        "dataType":"string", "description":"Internal reference number"},
        {"name":"RecordName",        "dataType":"string", "description":"Title / name of the rapid risk record"},
        {"name":"Status",            "dataType":"string", "description":"Current status of the record"},
        {"name":"StartDt",           "dataType":"date",   "description":"Start date of the record"},
        {"name":"Type",              "dataType":"string", "description":"Record type description"},
        {"name":"SubType",           "dataType":"string", "description":"Record sub-type description"},
        {"name":"LocationType",      "dataType":"string", "description":"Type of location"},
        {"name":"Location",          "dataType":"string", "description":"Location name"},
        {"name":"Checklist",         "dataType":"string", "description":"Risk assessment checklist template name"},
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
    'StoreID,StartDate,EndDate,Status,HazardType,Department,Location'
);

-- ── ADD MORE VIEWS / SPs BELOW — no code changes needed ─────────────────────
-- INSERT INTO DataSourceRegistry (Name, Description, Kind, ColumnsJson, SupportedParams)
-- VALUES ('vw_MyNewView', 'Description here', 'View', '[{"name":"Col1","dataType":"string","description":"..."}]', 'StoreID');
