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

-- ── AID_Actions ───────────────────────────────────────────────────────────────
INSERT INTO DataSourceRegistry (Name, Description, Kind, ColumnsJson, SupportedParams)
VALUES (
    'AID_Actions',
    'Corrective action controls across ALL WHS modules (hazard reports, audits, incidents, risk assessments, job procedures, policies) — each row is one action with its module type, status, priority, responsible person, deadline, and completion date. Use this data source when the user asks about actions, corrective actions, action status, overdue actions, action deadlines, action counts, or actions by module.',
    'View',
    '[
        {"name":"ControlID",          "dataType":"number", "description":"Unique action (control) identifier"},
        {"name":"StoreID",            "dataType":"number", "description":"Store identifier"},
        {"name":"RegOthID",           "dataType":"number", "description":"Parent record identifier"},
        {"name":"RegOthHazTempalteID","dataType":"number", "description":"Template question identifier when action was raised from a specific checklist question (NULL for record-level actions)"},
        {"name":"ModuleType",         "dataType":"string", "description":"WHS module the action belongs to: Hazard Report, Audit & Inspection, Incident, Risk Assessment, Job Procedure, Policy"},
        {"name":"ParentTitle",        "dataType":"string", "description":"Title of the parent WHS record this action is linked to"},
        {"name":"InternalNo",         "dataType":"string", "description":"Internal reference number of the parent record"},
        {"name":"TemplateQuestion",   "dataType":"string", "description":"The checklist question that triggered this action (NULL for record-level actions)"},
        {"name":"TemplateAnswer",     "dataType":"string", "description":"The answer value given for the question that triggered this action"},
        {"name":"Action",             "dataType":"string", "description":"Description of the corrective action to be taken"},
        {"name":"Category",           "dataType":"string", "description":"Action category"},
        {"name":"ActionStatus",       "dataType":"string", "description":"Current status of the action (e.g. Open, In Progress, Completed, Overdue)"},
        {"name":"Priority",           "dataType":"string", "description":"Priority level of the action (e.g. High, Medium, Low)"},
        {"name":"Responsible",        "dataType":"string", "description":"Name of the person responsible for completing the action"},
        {"name":"Deadline",           "dataType":"date",   "description":"Due date for the action (used for date range filtering)"},
        {"name":"DeadlineString",     "dataType":"string", "description":"Deadline as a formatted string (dd/MM/yyyy)"},
        {"name":"CompletedOn",        "dataType":"date",   "description":"Date the action was completed"},
        {"name":"StartDate",          "dataType":"date",   "description":"Start date of the action"},
        {"name":"Division",           "dataType":"string", "description":"Division name"},
        {"name":"Department",         "dataType":"string", "description":"Department name"},
        {"name":"Programme",          "dataType":"string", "description":"Programme name"},
        {"name":"LocationName",       "dataType":"string", "description":"Location name"},
        {"name":"LocationType",       "dataType":"string", "description":"Type of location"},
        {"name":"EstCost",            "dataType":"number", "description":"Estimated cost of the action"},
        {"name":"CreatedDt",          "dataType":"date",   "description":"Date the action was created"}
    ]',
    'StoreID,StartDate,EndDate,ActionStatus,Priority,Department,LocationName'
);
-- ── AID_TemplateList ─────────────────────────────────────────────────────────
INSERT INTO DataSourceRegistry (Name, Description, Kind, ColumnsJson, SupportedParams)
VALUES (
    'AID_TemplateList',
    'Master list of active (non-deleted, non-archived) WHS checklist/form templates available in a store. Use as an optionsSource for template-name dropdown filters. HazardTemplateID is the numeric key; TemplateName is the human-readable label.',
    'View',
    '[
        {"name":"HazardTemplateID", "dataType":"number", "description":"Unique template identifier"},
        {"name":"TemplateName",     "dataType":"string", "description":"Display name of the template"},
        {"name":"StoreID",          "dataType":"number", "description":"Store identifier"},
        {"name":"RegTypeID",        "dataType":"number", "description":"WHS module type identifier (foreign key)"},
        {"name":"ModuleType",       "dataType":"string", "description":"WHS module this template belongs to (human-readable)"},
        {"name":"TemplateNo",       "dataType":"string", "description":"Template reference number"},
        {"name":"VersionNo",        "dataType":"string", "description":"Template version number"}
    ]',
    'StoreID,ModuleType,RegTypeID'
);
-- ── AID_TemplateResponses ────────────────────────────────────────────────────
INSERT INTO DataSourceRegistry (Name, Description, Kind, ColumnsJson, SupportedParams)
VALUES (
    'AID_TemplateResponses',
    'Flattened template/checklist question-answer rows across ALL WHS modules — each row is one answered question for one record. Section groups questions into headings; Question is the label; Answer is the value given. Use this when the user asks about checklist responses, form answers, template findings, inspection question results, or audit question details.',
    'View',
    '[
        {"name":"RegOthHazTempalteID","dataType":"number", "description":"Unique identifier for this template question row — join to AID_Actions.RegOthHazTempalteID to see actions raised from this question"},
        {"name":"RegOthID",           "dataType":"number", "description":"Parent record identifier — join to module views on RegOthID"},
        {"name":"StoreID",            "dataType":"number", "description":"Store identifier"},
        {"name":"ModuleType",         "dataType":"string", "description":"WHS module: Hazard Report, Audit & Inspection, Incident, Risk Assessment, Job Procedure, Policy"},
        {"name":"RecordTitle",        "dataType":"string", "description":"Title of the parent WHS record"},
        {"name":"InternalNo",         "dataType":"string", "description":"Internal reference number of the parent record"},
        {"name":"Status",             "dataType":"string", "description":"Current status of the parent record (e.g. Open, Closed, In Progress)"},
        {"name":"StartDt",            "dataType":"date",   "description":"Start date of the parent record (use for date range filtering)"},
        {"name":"StartDtString",      "dataType":"string", "description":"Start date formatted as dd/MM/yyyy"},
        {"name":"Location",           "dataType":"string", "description":"Location name from the parent record"},
        {"name":"Programme",          "dataType":"string", "description":"Programme name from the parent record"},
        {"name":"Division",           "dataType":"string", "description":"Division name from the parent record"},
        {"name":"Department",         "dataType":"string", "description":"Department name from the parent record"},
        {"name":"CreatedDt",          "dataType":"date",   "description":"Date the parent record was created"},
        {"name":"CreatedDtString",    "dataType":"string", "description":"Created date formatted as dd/MM/yyyy"},
        {"name":"HazardTemplateID",   "dataType":"number", "description":"Template identifier — use templateNameFilter to filter by template name instead"},
        {"name":"TemplateName",       "dataType":"string", "description":"Name of the checklist/form template used for this record"},
        {"name":"Section",            "dataType":"string", "description":"Section/heading group the question belongs to (from HeadingDesc)"},
        {"name":"Question",           "dataType":"string", "description":"The question or item label (AlternativeName / HazardDesc)"},
        {"name":"Answer",             "dataType":"string", "description":"The answer or value recorded for this question (HazardValue)"},
        {"name":"SortOrder",          "dataType":"number", "description":"Display sort order of the question within its section"},
        {"name":"ItemNo",             "dataType":"string", "description":"Item number of the question"}
    ]',
    'StoreID,ModuleType,Status,Section,TemplateName,Location,Division,Department'
);

-- ── ADD MORE VIEWS / SPs BELOW — no code changes needed ─────────────────────
-- INSERT INTO DataSourceRegistry (Name, Description, Kind, ColumnsJson, SupportedParams)
-- VALUES ('vw_MyNewView', 'Description here', 'View', '[{"name":"Col1","dataType":"string","description":"..."}]', 'StoreID');
