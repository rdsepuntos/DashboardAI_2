/**
 * Template Wizard Integration Library
 * 
 * Usage Option 1 - Direct configuration:
 * const wizard = new TemplateWizard('myContainerDiv', {
 *   apiBaseUrl: 'http://localhost:5000/api/template-builder',
 *   industry: 'Construction',
 *   companyName: 'ABC Construction',
 *   companyDomain: 'Construction & Building',
 *   moduleType: 'Incident',
 *   createdByID: 1,
 *   createdByName: 'John Doe',
 *   storeID: 100
 * });
 * 
 * Usage Option 2 - URL Query String (auto-parsed):
 * https://yoursite.com/wizard.html?industry=Construction&companyName=ABC%20Corp&companyDomain=Construction&moduleType=SWMS&createdByID=1&createdByName=John&storeID=100
 * 
 * const wizard = new TemplateWizard('myContainerDiv', {
 *   apiBaseUrl: 'http://localhost:5000/api/template-builder'
 * });
 * 
 * wizard.initialize();
 */

class TemplateWizard {
    constructor(containerId, config) {
		
        this.container = document.getElementById(containerId);
        if (!this.container) {
            throw new Error(`Container element with ID '${containerId}' not found`);
        }
        
        // Parse query string parameters
        const urlParams = this.parseQueryString();
        
        // Merge config with URL parameters (URL params take precedence)
        this.config = {
            apiBaseUrl: 'https://beta.whsmonitor.com.au/affinda/api/template-builder',
            industry: urlParams.industry || config.industry,
            companyName: urlParams.companyName || config.companyName,
            companyDomain: urlParams.companyDomain || config.companyDomain,
            moduleType: urlParams.moduleType || config.moduleType,
            createdByID: urlParams.createdByID || config.createdByID,
            createdByName: urlParams.createdByName || config.createdByName,
            storeID: urlParams.storeID || config.storeID || null,
		    templateTypeID: urlParams.templateTypeID || config.templateTypeID || null,
            autoFillFromAnzsic: config.autoFillFromAnzsic !== undefined ? config.autoFillFromAnzsic : true, // Enable by default
            anzsicDivision: urlParams.anzsicDivision || config.anzsicDivision || config.industry, // Use industry as division if not specified
            onSuccess: config.onSuccess || null,
            onError: config.onError || null
        };
        
        this.questions = [];
        this.answers = {};
        this.currentStep = 0;
        this.customPrompt = null;
        this.anzsicClassifications = [];
        this.complexityMode = 'simple';
    }
    
    /**
     * Parse query string parameters from the URL
     * @returns {Object} Object containing query parameters
     */
    parseQueryString() {
        const params = {};
        const queryString = window.location.search.substring(1);
        const pairs = queryString.split('&');
        
        pairs.forEach(pair => {
            const [key, value] = pair.split('=');
            if (key && value) {
                // Decode URI component and convert to appropriate type
                const decodedValue = decodeURIComponent(value);
                
                // Convert to number if it's createdByID or storeID
                if (key === 'createdByID' || key === 'storeID') {
                    params[key] = parseInt(decodedValue, 10);
                } else {
                    params[key] = decodedValue;
                }
            }
        });
        
        return params;
    }
    
    async initialize() {
        // Store instance globally for onclick access
        window.templateWizardInstance = this;
        
        // Show template name selection with register type dropdown
        await this.renderTemplateNameSelection();
    }
    
    async renderRegisterTypeSelection() {
        this.showLoading('Loading register types...');
        
        try {
            const response = await fetch(`https://arventa.com.au/affinda/api/register-types`);
            const result = await response.json();
            
            if (!response.ok || !result.success) {
                throw new Error(result.message || 'Failed to load register types');
            }
            
            const registerTypes = result.data || [];
            
            const html = `
                <div class="template-wizard">
                    <h4 class="mb-4">Select Register Type</h4>
                    <div class="row">
                        ${registerTypes.map(type => `
                            <div class="col-md-4 mb-3">
                                <div onclick="window.templateWizardInstance.selectRegisterType(${type.regTypeID}, ${type.templateTypeID}, '${this.escapeForAttribute(type.registerDesc)}', '${this.escapeForAttribute(type.moduleDescription)}')" 
                                     style="height:100px; cursor: pointer;" 
                                     class="card border shadow-sm w-100 register-type-card">
                                    <div class="card-body d-flex align-items-center">
                                        <div class="d-flex align-items-center w-100">
                                            <div class="mr-2">
                                                <div class="worker-icon-container p-1 px-2 rounded" 
                                                     style="height: 41px; background-color: #007bff !important;">
                                                    <span class="mb-0 m-0 h2 text-white icon-arventa ph-thin ph-file-text" 
                                                          style="position:relative;top: 1px"></span>
                                                </div>
                                            </div>
                                            <div style="margin-left: 10px;">
                                                <h4 style="font-size: 17px; font-weight: 550; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; margin: 0;" 
                                                    class="w-100">${type.registerDesc || 'Register'}</h4>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
            
            this.container.innerHTML = html;
            
        } catch (error) {
            this.showError('Error loading register types: ' + error.message);
            if (this.config.onError) {
                this.config.onError(error);
            }
        }
    }
    
    selectRegisterType(regTypeID, templateTypeID, registerDesc, moduleDescription) {
        // Store the selected register type
        this.selectedRegisterType = {
            regTypeID,
            templateTypeID,
            registerDesc,
            moduleDescription
        };
        
        // Update config with templateTypeID
        this.config.templateTypeID = templateTypeID;
        this.config.moduleType = registerDesc;
        
        // Proceed to template name selection
        this.renderTemplateNameSelection();
    }
    
    async renderTemplateNameSelection() {
        this.showLoading('Loading...');
        
        try {
            // Load register types based on selected module if any
            let registerTypes = [];
            if (this.selectedModule) {
                const registerTypesResponse = await fetch(`https://beta.whsmonitor.com.au/affinda/api/register-types/by-group/${this.selectedModule}`);
                const registerTypesResult = await registerTypesResponse.json();
                
                if (registerTypesResponse.ok && registerTypesResult.success) {
                    registerTypes = registerTypesResult.data || [];
                }
            }
            
            // Load template names if register type is already selected
            let templateNames = [];
            if (this.selectedRegisterType && this.selectedRegisterType.templateTypeID) {
                const response = await fetch(`https://beta.whsmonitor.com.au/affinda/api/template-names/${this.selectedRegisterType.templateTypeID}`);
                const result = await response.json();
                
                if (response.ok && result.success) {
                    templateNames = result.data || [];
                }
            }
            
            const html = `
                <div class="template-wizard">
                   
                    <div>
                        <div>
                            <div class="card border-0">
                                <div class="card-body p-4">
                                    <!-- Register Type and Activity Container -->
									
									<h5 class="pb-3" id="header" style="
    line-height:30px;
" id="header">Select the module and type of templates to create. Once selected, choose from the available activities to prepopulate the template. </h5>
                                    <div id="dropdownsContainer">
                                        <!-- Module Dropdown -->
                                        <div class="my-4 h5 d-none">
                                        1. Select Module
                                        </div>
                                        <div class="mb-4">
                                            <div class="position-relative">
                                                <small class="bg-white position-absolute" style="background-color: #fff !important; left:12px;top: -8px; font-size: 75%; color: #98A2B3; z-index: 2;">Module</small>
                                                <select 
                                                    id="moduleSelect" 
                                                    class="form-select border rounded p-3" style="background-color: white;">
                                                    <option value="">-- Select a module --</option>
                                                    <option value="INCIDENT">Incident</option>
                                                    <option value="PEOPLE">People</option>
                                                    <option value="RISKASSESSMENT">Risk</option>
													   <option value="ASSETV2">Assets</option>
                                                </select>
                                            </div>
                                        </div>
                                        
                                        <!-- Register Type Dropdown -->
                                        <div class="my-4 h5 d-none">
                                        2. Select Template Type
                                        </div>
                                        <div class="mb-4">
                                            <div class="position-relative">
                                                <small class="bg-white position-absolute" style="left:12px;top: -8px; font-size: 75%; color: #98A2B3; z-index: 2;">Template Type</small>
                                                <select 
                                                    id="registerTypeSelect" 
                                                    class="form-select border rounded p-3" style="background-color: white;"
                                                    ${!this.selectedModule ? 'disabled' : ''}>
                                                    <option value="">-- Select a register type --</option>
                                                    ${registerTypes.map(type => `
                                                        <option value="${type.regTypeID}" 
                                                            data-template-type-id="${type.templateTypeID}"
                                                            data-register-desc="${this.escapeForAttribute(type.registerDesc)}"
                                                            data-module-desc="${this.escapeForAttribute(type.moduleDescription)}"
                                                            ${this.selectedRegisterType && this.selectedRegisterType.regTypeID === type.regTypeID ? 'selected' : ''}>
                                                            ${type.registerDesc}
                                                        </option>
                                                    `).join('')}
                                                </select>
                                            </div>
                                        </div>
                                        
                                        <!-- Existing Templates Section -->
                                        <div id="existingTemplatesSection" style="display:none;" class="mb-4"></div>

                                        <!-- Template Name Dropdown -->
                                         <div class="my-4 h5 d-none">
                                        3. Select Activity
                                        </div>
                                        <div class="mb-4" id="templateSelectContainer">
                                            <div class="position-relative">
                                                <small class="bg-white position-absolute" style="left:12px;top: -8px; font-size: 75%; color: #98A2B3; z-index: 2;">Activity</small>
                                                <select 
                                                    id="templateSelect" 
                                                    class="form-select border rounded p-3" style="background-color: white;"
                                                    ${!this.selectedRegisterType ? 'disabled' : ''}>
                                                    <option value="">-- Select a template --</option>
                                                    ${templateNames.map(template => `
                                                        <option value="${template.hazardTemplateID}" data-name="${this.escapeForAttribute(template.templateName)}">
                                                            ${template.templateName}
                                                        </option>
                                                    `).join('')}
                                                </select>
                                            </div>
                                        </div>
                                        
                                        <!-- Next Button -->
                                        <div class="d-flex justify-content-end mt-3">
                                            <button 
                                                id="nextBtn" 
                                                class="btn btn-primary px-4"
                                                onclick="window.templateWizardInstance.handleNextClick()"
                                                disabled>
                                                Next <i class="bi bi-arrow-right ms-1"></i>
                                            </button>
                                        </div>
                                    </div>
                                    
                                    <!-- Sections (Hidden initially) -->
                                    <div id="sectionsContainer" style="display: none;">
                                        <button class="btn btn-link mb-3 p-0 d-none" onclick="window.templateWizardInstance.backToDropdowns()">
                                            <i class="bi bi-arrow-left"></i> Back
                                        </button>
                                        <div class="mb-4">
                                            
                                            
                                            <div class="chips-container p-3 bg-white border rounded position-relative" id="selected-sections">
                                                <small class="bg-white position-absolute" style="left:12px;top: -8px; font-size: 75%; color: #98A2B3;">Selected Sections</small>
                                            </div>
                                            
                                            <!-- Suggestions -->
                                            <div class="suggestions-section d-flex my-4">
                                                <div class="d-flex align-items-center mb-2">
                                                    <small class="text-muted" style="font-size: 13px; color: #98A2B3 !important">Suggestions</small>
                                                </div>
                                                <div class="suggestions-chips d-flex flex-wrap gap-2" id="suggestions-sections">
                                                </div>
                                            </div>
                                            
                                            <!-- Add Additional Sections -->
											<h5 class="mt-5 mb-4">If the list above doesn't cover your requirements, add a new section below</h5>
                                                   
                                            <div class="d-flex align-items-center gap-2">
                                                <div class="position-relative" style="flex: 1;">
													 <small class="bg-white position-absolute" style="left:12px;top: -8px; font-size: 75%; color: #98A2B3; z-index: 2;">Add additional sections</small>
                                                    <input 
                                                        type="text" 
                                                        id="newSectionInput" 
                                                        class="form-control border rounded" 
                                                        placeholder="Enter section name"
                                                        style="height: 50px !important; padding-left: 12px;"
                                                    />
                                                </div>
												
												<div>
                                                <button 
                                                    type="button" 
                                                    class="btn btn-primary" 
                                                    style="padding-left: 24px; padding-right: 24px;"
                                                    onclick="window.templateWizardInstance.addCustomSection()">
                                                    ADD
                                                </button>
												</div>
                                            </div>
                                        </div>
                                    </div>
                                    
                                    <!-- Continue Button -->
                                    <div class="d-flex justify-content-end" id="continueBtnContainer" style="display: none !important;">
                                        <div class="d-flex align-items-center gap-3 w-100">
                                            <div class="d-flex align-items-center gap-2">
                                                <small class="text-muted" style="font-size: 13px; color: #98A2B3 !important; white-space: nowrap;">Complexity</small>
                                                <button
                                                    type="button"
                                                    id="complexitySimpleBtn"
                                                    class="chip-btn active"
                                                    onclick="window.templateWizardInstance.setComplexityMode('simple')">
                                                    <span class="chip-text">Simple</span>
                                                </button>
                                                <button
                                                    type="button"
                                                    id="complexityComprehensiveBtn"
                                                    class="suggestion-chip"
                                                    onclick="window.templateWizardInstance.setComplexityMode('comprehensive')">
                                                    <span class="suggestion-text">Comprehensive</span>
                                                </button>
                                            </div>
                                            <div class="ms-auto">
                                                <button 
                                                    id="continueBtn" 
                                                    class="btn btn-primary px-4"
                                                    onclick="window.templateWizardInstance.handleGenerateFromWizard()"
                                                    disabled>
                                                    Generate Template <i class="bi bi-arrow-right ms-1"></i>
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            `;
            
            this.container.innerHTML = html;
            
            // Store template data for filtering
            this.templateNames = templateNames;
            this.registerTypes = registerTypes;
            
            // Initialize Select2 on module select
            $('#moduleSelect').select2({
                theme: 'bootstrap-5',
                placeholder: 'Select Module',
                allowClear: true,
                width: '100%'
            }).on('change', function() {
                window.templateWizardInstance.onModuleSelected();
            });
            
            // Initialize Select2 on register type select
            $('#registerTypeSelect').select2({
                theme: 'bootstrap-5',
                placeholder: 'Select Template Type',
                allowClear: true,
                width: '100%'
            }).on('change', function() {
                window.templateWizardInstance.onRegisterTypeSelected();
            });
            
            // Initialize Select2 on template select
            $('#templateSelect').select2({
                theme: 'bootstrap-5',
                placeholder: 'Select Activity',
                allowClear: true,
                width: '100%'
            }).on('change', function() {
                window.templateWizardInstance.onActivityDropdownChange();
            });
            
        } catch (error) {
            this.showError('Error loading templates: ' + error.message);
            if (this.config.onError) {
                this.config.onError(error);
            }
        }
    }
    
    async onModuleSelected() {
        const select = document.getElementById('moduleSelect');
        const selectedValue = select.value;
        const registerTypeSelect = $('#registerTypeSelect');
        const templateSelect = $('#templateSelect');
        const continueBtn = document.getElementById('continueBtn');
        
        if (!selectedValue) {
            this.selectedModule = null;
            registerTypeSelect.val('').trigger('change');
            registerTypeSelect.prop('disabled', true);
            templateSelect.val('').trigger('change');
            templateSelect.prop('disabled', true);
            continueBtn.disabled = true;
            
            // Clear register type options
            registerTypeSelect.find('option').not(':first').remove();
            return;
        }
        
        // Store the selected module
        this.selectedModule = selectedValue;
        
        // Fetch register types for the selected module
        try {
            const response = await fetch(`https://beta.whsmonitor.com.au/affinda/api/register-types/by-group/${selectedValue}`);
            const result = await response.json();
            
            if (!response.ok || !result.success) {
                throw new Error(result.message || 'Failed to load register types');
            }
            
            const registerTypes = result.data || [];
            this.registerTypes = registerTypes;
            
            // Update register type dropdown options without re-rendering
            registerTypeSelect.find('option').not(':first').remove();
            registerTypes.forEach(type => {
                const option = new Option(type.registerDesc, type.regTypeID);
                option.setAttribute('data-template-type-id', type.templateTypeID);
                option.setAttribute('data-register-desc', type.registerDesc);
                option.setAttribute('data-module-desc', type.moduleDescription);
                registerTypeSelect.append(option);
            });
            
            // Enable register type dropdown and clear selection
            registerTypeSelect.prop('disabled', false);
            registerTypeSelect.val('').trigger('change');
            
            // Clear and disable template select
            templateSelect.val('').trigger('change');
            templateSelect.prop('disabled', true);

            // Clear existing templates section
            const existingSection = document.getElementById('existingTemplatesSection');
            if (existingSection) { existingSection.style.display = 'none'; existingSection.innerHTML = ''; }
            this.selectedExistingTemplate = null;
            // Restore Activity + Next button
            const actCont = document.getElementById('templateSelectContainer');
            const nextRow = document.querySelector('#dropdownsContainer .d-flex.justify-content-end');
            if (actCont) actCont.style.display = 'block';
            if (nextRow) nextRow.style.display = 'flex';
            
        } catch (error) {
            console.error('Error loading register types:', error);
            alert('Error loading register types: ' + error.message);
        }
    }
    
    backToDropdowns() {
        const dropdownsContainer = document.getElementById('dropdownsContainer');
        const sectionsContainer = document.getElementById('sectionsContainer');
        const continueBtn = document.getElementById('continueBtn');
        const continueBtnContainer = document.getElementById('continueBtnContainer');
        
        if (dropdownsContainer) dropdownsContainer.style.display = 'block';
        if (sectionsContainer) sectionsContainer.style.display = 'none';
        if (continueBtnContainer) continueBtnContainer.style.display = 'none';
        if (continueBtn) continueBtn.disabled = false;
		
		$('#header').html(`What kind of template would you like to create`)
    }
    
    async onRegisterTypeSelected() {
        const select = document.getElementById('registerTypeSelect');
        const selectedValue = select.value;
        const continueBtn = document.getElementById('continueBtn');
        const templateSelect = $('#templateSelect');
        
        if (!selectedValue) {
            this.selectedRegisterType = null;
            templateSelect.val('').trigger('change');
            templateSelect.prop('disabled', true);
            continueBtn.disabled = true;
            
            // Clear register type options
            templateSelect.find('option').not(':first, :nth-child(2)').remove(); // Keep first and '+ Create New'

            // Clear existing templates section
            const existingSection = document.getElementById('existingTemplatesSection');
            if (existingSection) { existingSection.style.display = 'none'; existingSection.innerHTML = ''; }
            this.selectedExistingTemplate = null;
            // Restore Activity + Next button
            const actCont2 = document.getElementById('templateSelectContainer');
            const nextRow2 = document.querySelector('#dropdownsContainer .d-flex.justify-content-end');
            if (actCont2) actCont2.style.display = 'block';
            if (nextRow2) nextRow2.style.display = 'flex';
            return;
        }
        
        const selectedOption = select.options[select.selectedIndex];
        
        // Store the selected register type
        this.selectedRegisterType = {
            regTypeID: parseInt(selectedValue),
            templateTypeID: parseInt(selectedOption.getAttribute('data-template-type-id')),
            registerDesc: selectedOption.getAttribute('data-register-desc'),
            moduleDescription: selectedOption.getAttribute('data-module-desc')
        };
        
        // Update config with templateTypeID
        this.config.templateTypeID = this.selectedRegisterType.templateTypeID;
        this.config.moduleType = this.selectedRegisterType.registerDesc;
        
        // Load templates for the selected register type
        try {
            const response = await fetch(`https://beta.whsmonitor.com.au/affinda/api/template-names/${this.selectedRegisterType.templateTypeID}`);
            const result = await response.json();
            
            if (!response.ok || !result.success) {
                throw new Error(result.message || 'Failed to load template names');
            }
            
            const templateNames = result.data || [];
            this.templateNames = templateNames;
            
            // Update template dropdown options without re-rendering
            templateSelect.find('option').not(':first, :nth-child(2)').remove(); // Keep first and '+ Create New'
            templateNames.forEach(template => {
                const option = new Option(template.templateName, template.hazardTemplateID);
                option.setAttribute('data-name', template.templateName);
                templateSelect.append(option);
            });
            
            // Enable template dropdown and clear selection
            templateSelect.prop('disabled', false);
            templateSelect.val('').trigger('change');

            // Load existing templates for this store + template type
            await this.loadExistingTemplates(
                this.selectedRegisterType.templateTypeID,
                this.selectedRegisterType.registerDesc
            );
            
        } catch (error) {
            console.error('Error loading templates:', error);
            alert('Error loading templates: ' + error.message);
        }
    }
    
    async loadExistingTemplates(templateTypeID, registerDesc) {
        const section = document.getElementById('existingTemplatesSection');
        if (!section) return;

        // Render tabs immediately — always visible once Template Type is selected
        // Start with a loading state in the existing tab panel
        section.innerHTML = `
            <ul class="nav nav-tabs mb-0" style="border-bottom: 2px solid #dee2e6;">
                <li class="nav-item">
                    <a class="nav-link active d-flex align-items-center gap-2" id="tabExisting" href="#" onclick="window.templateWizardInstance.switchExistingTab('existing'); return false;" style="font-size:14px;">
                        <i class="ph-thin ph-copy"></i> Use Existing Template
                        <span class="badge bg-secondary rounded-pill" id="existingCountBadge" style="font-size:11px;">...</span>
                    </a>
                </li>
                <li class="nav-item">
                    <a class="nav-link d-flex align-items-center gap-2" id="tabNew" href="#" onclick="window.templateWizardInstance.switchExistingTab('new'); return false;" style="font-size:14px;">
                        <i class="ph-thin ph-plus-circle"></i> Create New Template
                    </a>
                </li>
            </ul>
            <div id="existingTabPanel" class="border border-top-0 rounded-bottom p-3 bg-white">
                <p class="text-muted mb-0" style="font-size:13px;"><span class="spinner-border spinner-border-sm me-1"></span> Loading previously generated templates...</p>
            </div>
            <div id="newTabPanel" style="display:none;" class="border border-top-0 rounded-bottom p-3 bg-white">
                <p class="text-muted mb-0" style="font-size:13px;">Select an activity below to pre-populate your new template, or skip to start from scratch.</p>
            </div>`;

        section.style.display = 'block';

        // Hide Activity dropdown + Next button while on "Use Existing" tab
        const activityContainer = document.getElementById('templateSelectContainer');
        const nextBtnRow = document.querySelector('#dropdownsContainer .d-flex.justify-content-end');
        if (activityContainer) activityContainer.style.display = 'none';
        if (nextBtnRow) nextBtnRow.style.display = 'none';

        // Now fetch existing templates
        let templates = [];
        try {
            if (this.config.storeID && templateTypeID) {
                const response = await fetch(
                    `https://beta.whsmonitor.com.au/affinda/api/existing-templates?storeID=${this.config.storeID}&templateTypeID=${templateTypeID}`
                );
                const result = await response.json();
                if (response.ok && result.success) {
                    templates = result.data || [];
                }
            }
        } catch (e) {
            console.warn('[WIZARD] Could not load existing templates:', e);
        }

        // Update badge count
        const badge = document.getElementById('existingCountBadge');
        if (badge) {
            badge.textContent = templates.length;
            badge.className = templates.length > 0
                ? 'badge bg-primary rounded-pill'
                : 'badge bg-secondary rounded-pill';
        }

        // Build list body
        const listItems = templates.length > 0
            ? templates.map(t => {
                const createdDate = t.createdDate
                    ? new Date(t.createdDate).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
                    : '';
                const fieldCount = t.fieldCount || t.fields || '';
                return `
                    <tr id="existing_tpl_${t.templateID}">
                        <td class="align-middle">${this.escapeHtml(t.templateName)}</td>
                        <td class="align-middle text-center">${fieldCount}</td>
                        <td class="align-middle text-center" style="white-space:nowrap;color:#98A2B3;">${createdDate}</td>
                        <td class="align-middle text-center">
                            <button class="btn btn-primary btn-sm px-3"
                                onclick="window.templateWizardInstance.useExistingTemplate(${t.templateID}, '${this.escapeForAttribute(t.templateName)}')">
                                Use
                            </button>
                        </td>
                    </tr>`;
            }).join('')
            : `<tr><td colspan="4" class="text-center text-muted py-3" style="font-size:13px;">No previously generated templates found for this type.</td></tr>`;

        // Update the existing tab panel with results
        const existingTabPanel = document.getElementById('existingTabPanel');
        if (existingTabPanel) {
            existingTabPanel.innerHTML = `
                <p class="text-muted mb-3" style="font-size:13px;">Select a previously generated template to use. A full copy will be created for you to customise.</p>
                <div style="max-height:260px;overflow-y:auto;">
                    <table class="table table-hover mb-0" style="font-size:14px;">
                        <thead>
                            <tr style="color:#98A2B3;font-size:11px;font-weight:600;letter-spacing:.05em;">
                                <th class="border-0 pb-2">TEMPLATE NAME</th>
                                <th class="border-0 pb-2 text-center">FIELDS</th>
                                <th class="border-0 pb-2 text-center">CREATED</th>
                                <th class="border-0 pb-2 text-center">ACTION</th>
                            </tr>
                        </thead>
                        <tbody id="existingTemplateList">${listItems}</tbody>
                    </table>
                </div>`;
        }
    }

    switchExistingTab(tab) {
        const existingPanel = document.getElementById('existingTabPanel');
        const newPanel = document.getElementById('newTabPanel');
        const tabExisting = document.getElementById('tabExisting');
        const tabNew = document.getElementById('tabNew');
        const activityContainer = document.getElementById('templateSelectContainer');
        const nextBtnRow = document.querySelector('#dropdownsContainer .d-flex.justify-content-end');

        if (tab === 'existing') {
            existingPanel.style.display = 'block';
            newPanel.style.display = 'none';
            tabExisting.classList.add('active');
            tabNew.classList.remove('active');
            if (activityContainer) activityContainer.style.display = 'none';
            if (nextBtnRow) nextBtnRow.style.display = 'none';
        } else {
            existingPanel.style.display = 'none';
            newPanel.style.display = 'block';
            tabExisting.classList.remove('active');
            tabNew.classList.add('active');
            if (activityContainer) activityContainer.style.display = 'block';
            if (nextBtnRow) nextBtnRow.style.display = 'flex';
        }
    }

    useExistingTemplate(templateID, templateName) {
        const result = {
            success: true,
            existingTemplate: true,
            templateID: templateID,
            templateName: templateName,
            templateTypeID: this.config.templateTypeID,
            registerDesc: this.selectedRegisterType?.registerDesc,
            storeID: this.config.storeID
        };

        if (this.config.onSuccess) {
            this.config.onSuccess(result);
        }

        if (typeof parent !== 'undefined' && typeof parent.footerCompleted === 'function') {
            parent.footerCompleted();
        }
    }

    onActivityDropdownChange() {
        const selectedValue = $('#templateSelect').val();
        const nextBtn = document.getElementById('nextBtn');
        const continueBtn = document.getElementById('continueBtn');
        
        if (selectedValue) {
            if (nextBtn) nextBtn.disabled = false;
			parent.enableNext();
        } else {
            if (nextBtn) nextBtn.disabled = true;
            if (continueBtn) continueBtn.disabled = true;
			parent.disableNext();
        }
    }
    
    async handleNextClick() {
        const selectedValue = $('#templateSelect').val();
        const nextBtn = document.getElementById('nextBtn');
        
        if (!selectedValue) {
            return;
        }
        
        // Store original button content
        const originalContent = nextBtn.innerHTML;
        
        // Show loading in button
        nextBtn.disabled = true;
        nextBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Loading...';
        
        try {
            await this.onTemplateSelected();
        } catch (error) {
            // Restore button on error
            nextBtn.innerHTML = originalContent;
            nextBtn.disabled = false;
            throw error;
        }
    }
    
    async onTemplateSelected() {
        const selectedValue = $('#templateSelect').val();
        const continueBtn = document.getElementById('continueBtn');
        const continueBtnContainer = document.getElementById('continueBtnContainer');
        const sectionsContainer = document.getElementById('sectionsContainer');
        const dropdownsContainer = document.getElementById('dropdownsContainer');
        
        if (!selectedValue) {
            continueBtn.disabled = true;
            if (continueBtnContainer) continueBtnContainer.style.display = 'none';
            sectionsContainer.style.display = 'none';
            if (dropdownsContainer) dropdownsContainer.style.display = 'block';
            return;
        }
        
        if (selectedValue === 'new') {
            // Create new template - no sections
            this.selectedTemplate = {
                hazardTemplateID: null,
                templateName: 'Custom Template'
            };
            sectionsContainer.style.display = 'none';
            if (dropdownsContainer) dropdownsContainer.style.display = 'block';
            
            // Show and enable Generate button for new templates
            if (continueBtnContainer) continueBtnContainer.style.display = 'flex';
            continueBtn.disabled = false;
        } else {
            // Load sections for selected template
            const select = document.getElementById('templateSelect');
            const selectedOption = select.options[select.selectedIndex];
            this.selectedTemplate = {
                hazardTemplateID: parseInt(selectedValue),
                templateName: selectedOption.getAttribute('data-name')
            };
            
            await this.loadTemplateSections(parseInt(selectedValue));
            
            // Show and enable Generate button after sections are loaded
            if (continueBtnContainer) continueBtnContainer.style.display = 'flex';
            continueBtn.disabled = false;
        }
    }
    
    async loadTemplateSections(hazardTemplateID) {
        const sectionsContainer = document.getElementById('sectionsContainer');
        const selectedContainer = document.getElementById('selected-sections');
        const suggestionsContainer = document.getElementById('suggestions-sections');
        const dropdownsContainer = document.getElementById('dropdownsContainer');
        
        try {
            // Fetch sections in background (don't switch pages yet)
            const response = await fetch(`https://beta.whsmonitor.com.au/affinda/api/hazard-template-sections/${hazardTemplateID}`);
            const result = await response.json();
            
            if (!response.ok || !result.success) {
                throw new Error(result.message || 'Failed to load sections');
            }
            
            let sections = result.data || [];
            
            // Check if we need to generate additional sections (only if < 10 sections)
            if (sections.length < 10) {
                console.log('[WIZARD] Template has less than 10 sections, generating additional sections...');
                try {
                    const generatedSections = await this.generateAdditionalSections();
                    if (generatedSections) {
                        sections = this.mergeSections(sections, generatedSections);
						parent.selectModuleDone();
						$('#header').html(`Update the relevant sections for your activity template by removing or adding from the suggested sections.`);
                    }
                } catch (genError) {
                    console.error('[WIZARD] Failed to generate additional sections:', genError);
                    // Continue with existing sections even if generation fails
                }
            }
            
            this.templateSections = sections;
            
            // Now that everything is loaded, prepare the HTML
            let selectedSectionsHtml = '';
            let suggestionSectionsHtml = '';
            
            if (sections.length === 0) {
                selectedSectionsHtml = '<small class="bg-white position-absolute" style="left:12px;top: -8px; font-size: 75%; color: #98A2B3;">Selected Sections</small><span class="text-muted">No sections found</span>';
            } else {
                // Top 4 sections go to selected
                const selectedSections = sections.slice(0, 4);
                const suggestionSections = sections.slice(4);
                
                // Render selected sections
                selectedSectionsHtml = `
                    <small class="bg-white position-absolute" style="left:12px;top: -8px; font-size: 75%; color: #98A2B3;">Selected Sections</small>
                    ${selectedSections.map((section, idx) => {
                        const formattedName = this.formatSectionName(section.sectionName);
                        return `
                        <button 
                            type="button"
                            class="chip-btn active" 
                            id="section_selected_${section.sectionID}" 
                            data-section-id="${section.sectionID}"
                            data-section-name="${this.escapeForAttribute(formattedName)}">
                            <span class="chip-text">${this.escapeHtml(formattedName)}</span>
                            <span class="chip-remove" onclick="window.templateWizardInstance.moveSectionToSuggestions('${section.sectionID}')">
                                <span class="ph-thin ph-x"></span>
                            </span>
                        </button>
                    `}).join('')}
                `;
                
                // Render suggestion sections
                if (suggestionSections.length > 0) {
                    suggestionSectionsHtml = suggestionSections.map((section, idx) => {
                        const formattedName = this.formatSectionName(section.sectionName);
                        return `
                        <button 
                            type="button"
                            class="suggestion-chip" 
                            id="section_suggestion_${section.sectionID}" 
                            data-section-id="${section.sectionID}"
                            data-section-name="${this.escapeForAttribute(formattedName)}">
                            <span class="suggestion-text">${this.escapeHtml(formattedName)}</span>
                            <span class="chip-remove" onclick="window.templateWizardInstance.moveSectionToSelected('${section.sectionID}')">
                                <span class="ph-thin ph-plus-circle"></span>
                            </span>
                        </button>
                    `}).join('');
                }
            }
            
            // Now switch to sections page and populate with loaded content
            if (dropdownsContainer) dropdownsContainer.style.display = 'none';
            sectionsContainer.style.display = 'block';
            selectedContainer.innerHTML = selectedSectionsHtml;
            if (suggestionSectionsHtml) {
                suggestionsContainer.innerHTML = suggestionSectionsHtml;
            } else {
                suggestionsContainer.innerHTML = '';
            }
            
        } catch (error) {
            selectedContainer.innerHTML = `<small class="bg-white position-absolute" style="left:12px;top: -8px; font-size: 75%; color: #98A2B3;">Selected Sections</small><span class="text-danger">Error loading sections: ${error.message}</span>`;
        }
    }
    
    async generateAdditionalSections() {
        console.log('[WIZARD] Calling section generator API...');
        
        try {
            const response = await fetch(`${this.config.apiBaseUrl}/sections/generate`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    industry: this.config.industry,
                    registerType: this.selectedRegisterType.registerDesc,
                    templateName: this.selectedTemplate.templateName
                })
            });
            
            const result = await response.json();
            
            if (!response.ok || !result.success) {
                console.error('[WIZARD] Section generation failed:', result.message);
                return null;
            }
            
            console.log('[WIZARD] Generated sections:', result);
            return {
                mandatory: result.mandatorySections || [],
                optional: result.optionalSections || []
            };
            
        } catch (error) {
            console.error('[WIZARD] Error calling section generator:', error);
            return null;
        }
    }
    
    mergeSections(existingSections, generatedSections) {
        console.log('[WIZARD] Merging sections...');
        console.log('[WIZARD] Existing sections count:', existingSections.length);
        console.log('[WIZARD] Generated mandatory:', generatedSections.mandatory.length);
        console.log('[WIZARD] Generated optional:', generatedSections.optional.length);
        
        const merged = [...existingSections];
        
        // Calculate how many sections we want in selected (top 4) and suggestions (next 5)
        const currentSelectedCount = Math.min(existingSections.length, 4);
        const currentSuggestionCount = Math.max(0, existingSections.length - 4);
        
        // Determine how many mandatory sections to add
        let mandatoryToAdd = 0;
        if (currentSelectedCount < 4) {
            mandatoryToAdd = Math.min(4 - currentSelectedCount, generatedSections.mandatory.length);
        }
        // If currentSelectedCount is 3, add only 1
        if (currentSelectedCount === 3) {
            mandatoryToAdd = Math.min(1, generatedSections.mandatory.length);
        }
        // If currentSelectedCount is already 4, don't add any
        if (currentSelectedCount >= 4) {
            mandatoryToAdd = 0;
        }
        
        // Determine how many optional sections to add
        let optionalToAdd = 0;
        if (currentSuggestionCount < 5) {
            optionalToAdd = Math.min(5 - currentSuggestionCount, generatedSections.optional.length);
        }
        // If currentSuggestionCount is 2, add 3
        if (currentSuggestionCount === 2) {
            optionalToAdd = Math.min(3, generatedSections.optional.length);
        }
        // If currentSuggestionCount is already 5 or more, don't add any
        if (currentSuggestionCount >= 5) {
            optionalToAdd = 0;
        }
        
        console.log('[WIZARD] Will add', mandatoryToAdd, 'mandatory and', optionalToAdd, 'optional sections');
        
        // Get existing section names (case-insensitive for comparison)
        const existingNames = existingSections.map(s => s.sectionName.toLowerCase().trim());
        
        // Add mandatory sections (these go to selected/top 4)
        let addedMandatory = 0;
        for (const sectionName of generatedSections.mandatory) {
            if (addedMandatory >= mandatoryToAdd) break;
            
            // Check if section already exists
            if (!existingNames.includes(sectionName.toLowerCase().trim())) {
                merged.splice(currentSelectedCount + addedMandatory, 0, {
                    sectionID: `gen_m_${Date.now()}_${addedMandatory}`,
                    sectionName: sectionName,
                    displayOrder: currentSelectedCount + addedMandatory + 1,
                    isGenerated: true
                });
                addedMandatory++;
                existingNames.push(sectionName.toLowerCase().trim());
            }
        }
        
        // Add optional sections (these go to suggestions/after top 4)
        let addedOptional = 0;
        const insertPosition = 4 + addedMandatory; // After selected sections and added mandatory
        
        for (const sectionName of generatedSections.optional) {
            if (addedOptional >= optionalToAdd) break;
            
            // Check if section already exists
            if (!existingNames.includes(sectionName.toLowerCase().trim())) {
                merged.splice(insertPosition + addedOptional, 0, {
                    sectionID: `gen_o_${Date.now()}_${addedOptional}`,
                    sectionName: sectionName,
                    displayOrder: insertPosition + addedOptional + 1,
                    isGenerated: true
                });
                addedOptional++;
                existingNames.push(sectionName.toLowerCase().trim());
            }
        }
        
        console.log('[WIZARD] Merged sections count:', merged.length);
        console.log('[WIZARD] Added:', addedMandatory, 'mandatory,', addedOptional, 'optional');
        
        return merged;
    }
    
    formatSectionName(name) {
        if (!name) return '';
        
        // Remove leading numbers with dots, parentheses, or hyphens
        // Matches patterns like: "1.", "1)", "1.)", "1 -", "1-", etc.
        let cleaned = name.replace(/^\d+[.)\-\s]+/, '').trim();
        
        // Convert to Pascal Case (capitalize first letter of each word)
        return cleaned
            .toLowerCase()
            .split(' ')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
    }
    
    moveSectionToSuggestions(sectionID) {
        const selectedBtn = document.getElementById(`section_selected_${sectionID}`);
        const suggestionsContainer = document.getElementById('suggestions-sections');
        
        if (!selectedBtn) return;
        
        const sectionName = selectedBtn.getAttribute('data-section-name');
        
        // Remove from selected
        selectedBtn.remove();
        
        // Add to suggestions
        const suggestionBtn = `
            <button 
                type="button"
                class="suggestion-chip" 
                id="section_suggestion_${sectionID}" 
                data-section-id="${sectionID}"
                data-section-name="${this.escapeForAttribute(sectionName)}">
                <span class="suggestion-text">${this.escapeHtml(sectionName)}</span>
                <span class="chip-remove" onclick="window.templateWizardInstance.moveSectionToSelected('${sectionID}')">
                    <span class="ph-thin ph-plus"></span>
                </span>
            </button>
        `;
        
        suggestionsContainer.insertAdjacentHTML('beforeend', suggestionBtn);
    }
    
    moveSectionToSelected(sectionID) {
        const suggestionBtn = document.getElementById(`section_suggestion_${sectionID}`);
        const selectedContainer = document.getElementById('selected-sections');
        
        if (!suggestionBtn) return;
        
        const sectionName = suggestionBtn.getAttribute('data-section-name');
        
        // Remove from suggestions
        suggestionBtn.remove();
        
        // Add to selected (before the label)
        const selectedBtn = `
            <button 
                type="button"
                class="chip-btn active" 
                id="section_selected_${sectionID}" 
                data-section-id="${sectionID}"
                data-section-name="${this.escapeForAttribute(sectionName)}">
                <span class="chip-text">${this.escapeHtml(sectionName)}</span>
                <span class="chip-remove" onclick="window.templateWizardInstance.moveSectionToSuggestions('${sectionID}')">
                    <span class="ph-thin ph-x"></span>
                </span>
            </button>
        `;
        
        selectedContainer.insertAdjacentHTML('beforeend', selectedBtn);
    }
    
    addCustomSection() {
        const input = document.getElementById('newSectionInput');
        const sectionName = input.value.trim();
        
        if (!sectionName) {
            alert('Please enter a section name');
            return;
        }
        
        // Check if section already exists in selected sections
        const selectedContainer = document.getElementById('selected-sections');
        const existingButtons = selectedContainer.querySelectorAll('button.chip-btn[data-section-name]');
        const existingSections = Array.from(existingButtons).map(btn => 
            btn.getAttribute('data-section-name').toLowerCase()
        );
        
        if (existingSections.includes(sectionName.toLowerCase())) {
            alert('This section already exists in selected sections');
            input.value = '';
            return;
        }
        
        // Generate unique ID for custom section
        const customSectionID = `custom_${Date.now()}`;
        
        // Add to selected sections
        const selectedBtn = `
            <button 
                type="button"
                class="chip-btn active" 
                id="section_selected_${customSectionID}" 
                data-section-id="${customSectionID}"
                data-section-name="${this.escapeForAttribute(sectionName)}">
                <span class="chip-text">${this.escapeHtml(sectionName)}</span>
                <span class="chip-remove" onclick="window.templateWizardInstance.moveSectionToSuggestions('${customSectionID}')">
                    <span class="ph-thin ph-x"></span>
                </span>
            </button>
        `;
        
        selectedContainer.insertAdjacentHTML('beforeend', selectedBtn);
        
        // Clear input
        input.value = '';
    }
    
    async handleGenerateFromWizard() {
        const continueBtn = document.getElementById('continueBtn');
        continueBtn.disabled = true;
        continueBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Generating Template...';
        
        // IMPORTANT: Collect selected sections BEFORE showLoading() destroys the DOM!
        const selectedSections = this.getSelectedSections();
        
        console.log('[WIZARD] handleGenerateFromWizard called');
        console.log('[WIZARD] Selected Template:', this.selectedTemplate);
        console.log('[WIZARD] Selected Register Type:', this.selectedRegisterType);
        console.log('[WIZARD] Selected Sections:', selectedSections);
        
        // Now show loading (this will replace the container HTML)
        this.showLoading('Initializing template generation...');
        
        try {
            const requestBody = {
                storeID: this.config.storeID,
                industry: this.config.industry,
                companyName: this.config.companyName,
                companyDomain: this.config.companyDomain,
                moduleType: this.config.moduleType,
                
                // Required for template creation
                createdByID: this.config.createdByID,
                createdByName: this.config.createdByName,
                templateTypeID: this.config.templateTypeID,
                
                // Include wizard selections
                registerTypeID: this.selectedRegisterType?.regTypeID,
                registerDescription: this.selectedRegisterType?.registerDesc,
                moduleDescription: this.selectedRegisterType?.moduleDescription,
                templateID: this.selectedTemplate?.hazardTemplateID,
                templateName: this.selectedTemplate?.templateName,
                selectedSections: selectedSections,
                complexityMode: this.complexityMode || 'simple'
            };
            
            console.log('[WIZARD] Request Body:', JSON.stringify(requestBody, null, 2));
            
            const response = await fetch(`${this.config.apiBaseUrl}/generate-multi-agent`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestBody)
            });
            
            const result = await response.json();
            
            if (!response.ok || !result.success) {
                throw new Error(result.message || 'Failed to generate template');
            }
            
            // Use status text from database and show progress bar
            const statusMessage = result.statusMessage || result.status || 'Template generation in progress...';
            
            this.showProgressBar(result.status, statusMessage);
            
            if (this.config.onSuccess) {
                this.config.onSuccess(result);
            }
            
            if (typeof parent !== 'undefined' && typeof parent.loadGenerateAI === 'function') {
                //parent.loadGenerateAI();
				parent.footerCompleted();
            }
            
            // Poll for status
            this.pollStatus(result.requestId);
            
        } catch (error) {
            console.error('[WIZARD] Error:', error);
            this.showError('Error: ' + error.message);
            continueBtn.disabled = false;
            continueBtn.innerHTML = 'Generate Template <i class="bi bi-arrow-right ms-1"></i>';
            
            if (this.config.onError) {
                this.config.onError(error);
            }
        }
    }
    
    setComplexityMode(mode) {
        this.complexityMode = mode;
        const simpleBtn = document.getElementById('complexitySimpleBtn');
        const comprehensiveBtn = document.getElementById('complexityComprehensiveBtn');
        if (!simpleBtn || !comprehensiveBtn) return;
        if (mode === 'simple') {
            simpleBtn.className = 'chip-btn active';
            simpleBtn.style.cssText = '';
            comprehensiveBtn.className = 'suggestion-chip';
            comprehensiveBtn.style.cssText = '';
        } else {
            comprehensiveBtn.className = 'chip-btn active';
            comprehensiveBtn.style.cssText = '';
            simpleBtn.className = 'suggestion-chip';
            simpleBtn.style.cssText = '';
        }
    }

    proceedToPrompt() {
        this.renderPromptScreen();
    }
    
    async selectTemplate(hazardTemplateID, templateName) {
        // Store the selected template
        this.selectedTemplate = {
            hazardTemplateID,
            templateName
        };
        
        if (hazardTemplateID) {
            // Load sections for the selected template
            await this.renderTemplateSections();
        } else {
            // Proceed to prompt screen for custom template
            this.renderPromptScreen();
        }
    }
    
    async renderTemplateSections() {
        this.showLoading('Loading template sections...');
        
        try {
            const response = await fetch(`${this.config.apiBaseUrl}/hazard-template-sections/${this.selectedTemplate.hazardTemplateID}`);
            const result = await response.json();
            
            if (!response.ok || !result.success) {
                throw new Error(result.message || 'Failed to load template sections');
            }
            
            const sections = result.data || [];
            
            const html = `
                <div class="template-wizard">
                    <button class="btn btn-link mb-3" onclick="window.templateWizardInstance.renderTemplateNameSelection()">
                        <i class="bi bi-arrow-left"></i> Back to templates
                    </button>
                    <h4 class="mb-4">Template Sections: ${this.selectedTemplate.templateName}</h4>
                    
                    ${sections.length > 0 ? `
                        <div class="alert alert-info">
                            <strong>This template contains ${sections.length} section(s):</strong>
                            <ul class="mb-0 mt-2">
                                ${sections.map(section => `
                                    <li>${section.sectionName} (Order: ${section.displayOrder})</li>
                                `).join('')}
                            </ul>
                        </div>
                    ` : '<p>No sections found for this template.</p>'}
                    
                    <div class="wizard-actions d-flex justify-content-end gap-2 mt-4">
                        <button class="btn btn-primary" onclick="window.templateWizardInstance.renderPromptScreen()">
                            Continue to Customize ?
                        </button>
                    </div>
                </div>
            `;
            
            this.container.innerHTML = html;
            
        } catch (error) {
            this.showError('Error loading template sections: ' + error.message);
            if (this.config.onError) {
                this.config.onError(error);
            }
        }
    }
    
    renderPromptScreen() {
        const html = `
            <div class="template-wizard bg-white p-4">
                <button class="btn btn-link mb-3" onclick="window.templateWizardInstance.renderTemplateNameSelection()">
                    <i class="bi bi-arrow-left"></i> Back to templates
                </button>
                
				 <p style="font-size: 1.25rem" class="mb-4">
								Tell us about the template you want to create. Describe the purpose, scope, and specific requirements for your template. 
                                The more detail you provide, the better the questions will be tailored to your needs.
								</p>
								
                <div class="border-0 mb-4">
                    <div class="card-body p-0">
                        <div class="mb-3">
                            <label for="templatePrompt" class="form-label fw-semibold">
                                What is the goal of this ${this.config.moduleType} template?
                            </label>
                            <textarea 
                                id="templatePrompt" 
                                class="form-control" 
                                rows="6" 
                                placeholder="Example: Create a comprehensive incident report template for workplace injuries that includes witness statements, injury details, and immediate actions taken. Should capture location, time, people involved, and contributing factors."></textarea>
                            <div class="form-text">
                                Describe the purpose, scope, and specific requirements for your template. 
                                The more detail you provide, the better the questions will be tailored to your needs.
                            </div>
                        </div>
                    </div>
                </div>
                
                <div class="wizard-actions d-flex justify-content-between gap-2">
                    <button onclick="backToModeSelection()" class="btn btn-secondary" >Back</button>
                    <button class="btn btn-primary" onclick="window.templateWizardInstance.generateQuestionsFromPrompt()">
                        Generate Questions ?
                    </button>
                </div>
            </div>
        `;
        
        this.container.innerHTML = html;
        
        // Store instance globally for onclick access
        window.templateWizardInstance = this;
    }
    
    async generateQuestionsFromPrompt() {
        const promptInput = document.getElementById('templatePrompt');
        const prompt = promptInput.value.trim();
        
        if (!prompt) {
            alert('Please describe your template goal before continuing.');
            promptInput.focus();
            return;
        }
        
        this.customPrompt = prompt;
        this.showLoading('Generating personalized wizard questions...');
        
        try {
            const response = await fetch(`${this.config.apiBaseUrl}/wizard/questions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    industry: this.config.industry,
                    companyName: this.config.companyName,
                    companyDomain: this.config.companyDomain,
                    moduleType: this.config.moduleType,
                    customPrompt: this.customPrompt
                })
            });
            
            const result = await response.json();
            
            if (!response.ok || !result.success) {
                throw new Error(result.message || 'Failed to load wizard questions');
            }
            
            this.questions = result.questions;
            this.renderWizard();
            
        } catch (error) {
            this.showError('Error loading wizard questions: ' + error.message);
            if (this.config.onError) {
                this.config.onError(error);
            }
        }
    }

    /**
     * Get ANZSIC industry classifications for a company
     * @param {string} companyName - The company name
     * @param {string} domain - The company domain/website (optional)
     * @param {string} division - The ANZSIC Division (e.g., "Division I - Transport, Postal and Warehousing")
     * @returns {Promise<Object>} Object containing success flag, message, and classifications array
     */
    async getAnzsicClassification(companyName, domain, division) {
        try {
            const anzsicApiUrl = this.config.apiBaseUrl.replace('/template-builder', '/anzsic');
            
            const response = await fetch(`${anzsicApiUrl}/classify`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    companyName: companyName,
                    domain: domain || '',
                    division: division
                })
            });
            
            const result = await response.json();
            
            if (!response.ok || !result.success) {
                throw new Error(result.message || 'Failed to get ANZSIC classification');
            }
            
            return result;
            
        } catch (error) {
            console.error('Error getting ANZSIC classification:', error);
            return {
                success: false,
                message: error.message,
                classifications: []
            };
        }
    }

    /**
     * Get ANZSIC classification and display results
     * Helper method that can be called with a callback to handle results
     * @param {string} companyName - The company name
     * @param {string} domain - The company domain/website (optional)
     * @param {string} division - The ANZSIC Division
     * @param {Function} callback - Optional callback function(result) to handle the response
     */
    async fetchAndDisplayAnzsic(companyName, domain, division, callback) {
        this.showLoading('Getting ANZSIC classifications...');
        
        const result = await this.getAnzsicClassification(companyName, domain, division);
        
        if (result.success && result.classifications.length > 0) {
            console.log('ANZSIC Classifications:', result.classifications);
            
            // Format the results for display
            let displayHtml = '<div class="anzsic-results"><h5>ANZSIC Classifications:</h5>';
            result.classifications.forEach((classification, index) => {
                displayHtml += `
                    <div class="classification-item mb-3 p-3 border rounded">
                        <div class="mb-2">
                            <strong>Classification ${index + 1}</strong>
                            <span class="badge bg-primary ms-2">Confidence: ${(classification.confidenceScore * 100).toFixed(0)}%</span>
                        </div>
                        <div><strong>Subdivision:</strong> ${classification.subdivision} (${classification.subdivisionCode})</div>
                        <div class="text-muted small">${classification.subdivisionDescription}</div>
                        <div class="mt-2"><strong>Group:</strong> ${classification.group} (${classification.groupCode})</div>
                        <div class="text-muted small">${classification.groupDescription}</div>
                        <div class="mt-2"><strong>Class:</strong> ${classification.class} (${classification.classCode})</div>
                        <div class="text-muted small">${classification.classDescription}</div>
                    </div>
                `;
            });
            displayHtml += '</div>';
            
            if (callback) {
                callback(result);
            }
            
            return result;
        } else {
            this.showError(result.message || 'No classifications found');
            return result;
        }
    }

    /**
     * Use ANZSIC classification to auto-fill prompt and generate questions
     * @param {string} companyName - The company name
     * @param {string} domain - The company domain/website (optional)
     * @param {string} division - The ANZSIC Division
     * @param {boolean} autoGenerate - If true, automatically generates questions after filling prompt (default: true)
     * @returns {Promise<Object>} The classification result
     */
    async autoFillFromAnzsic(companyName, domain, division, autoGenerate = true) {
        this.showLoading('Getting ANZSIC classifications to generate tailored template...');
        
        const result = await this.getAnzsicClassification(companyName, domain, division);
        
        if (result.success && result.classifications.length > 0) {
            // Store all classifications for suggestions
            this.anzsicClassifications = result.classifications;
            
            // Get the highest confidence classification
            const topClassification = result.classifications.reduce((prev, current) => 
                (current.confidenceScore > prev.confidenceScore) ? current : prev
            );
            
            // Generate a detailed prompt based on the classification
            const generatedPrompt = this.generatePromptFromClassification(topClassification);
            this.customPrompt = generatedPrompt;
            
            // Show loading message with classification info
            this.showLoading(`Generating questions for ${topClassification.class} (${topClassification.classCode})...`);
            
            // Automatically generate questions directly
            if (autoGenerate) {
                try {
                    const response = await fetch(`${this.config.apiBaseUrl}/wizard/questions`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            industry: this.config.industry,
                            companyName: this.config.companyName,
                            companyDomain: this.config.companyDomain,
                            moduleType: this.config.moduleType,
                            customPrompt: this.customPrompt
                        })
                    });
                    
                    const questionsResult = await response.json();
                    
                    if (!response.ok || !questionsResult.success) {
                        throw new Error(questionsResult.message || 'Failed to load wizard questions');
                    }
                    
                    this.questions = questionsResult.questions;
                    this.renderWizard();
                    
                } catch (error) {
                    this.showError('Error loading wizard questions: ' + error.message);
                    if (this.config.onError) {
                        this.config.onError(error);
                    }
                }
            }
            
            return result;
        } else {
            this.showError(result.message || 'Could not get ANZSIC classification. Please enter prompt manually.');
            this.renderPromptScreen();
            return result;
        }
    }

    /**
     * Generate a tailored prompt based on ANZSIC classification
     * @param {Object} classification - The ANZSIC classification object
     * @returns {string} Generated prompt text
     */
    getProgressFromStatus(status) {
        const statusMap = {
            'pending': { percent: 15, label: 'Initializing', stage: 1 },
            'research': { percent: 30, label: 'Research Agent analyzing company profile', stage: 2 },
            'structure': { percent: 50, label: 'Structure Agent designing template', stage: 3 },
            'questions': { percent: 80, label: 'Question Builder Agent creating fields', stage: 4 },
            'quality_assurance': { percent: 95, label: 'Quality Assurance validating template', stage: 5 },
            'completed': { percent: 100, label: 'Template generated successfully!', stage: 6 },
            'failed': { percent: 0, label: 'Generation failed', stage: 0 }
        };
        
        const statusLower = (status || 'pending').toLowerCase();
        return statusMap[statusLower] || statusMap['pending'];
    }
    
    getCustomMessageForStatus(status) {
        const statusLower = (status || '').toLowerCase();
        
        switch(statusLower) {
            case 'pending':
                return 'Generating...';
            case 'research':
                return 'Collating...';
            case 'structure':
                return 'Structuring...';
            case 'questions':
                return 'Applying Questions...';
            case 'quality_assurance':
                return 'Quality Checking...';
            case 'completed':
                return 'Completed';
            default:
                return '';
        }
    }
    
    showProgressBar(status, statusMessage) {
        const progress = this.getProgressFromStatus(status);
        
        // Check if progress bar already exists
        const existingProgressBar = document.getElementById('progressBarElement');
        
        if (existingProgressBar) {
            // Update existing progress bar with custom message
            const customMessage = this.getCustomMessageForStatus(status);
            existingProgressBar.setAttribute('data-message', customMessage);
            this.animateProgressBar(progress.percent, progress.stage);
            return;
        }
        
        // Get custom message based on status for new progress bar
        const message = this.getCustomMessageForStatus(status);
        
        // Create new progress bar HTML
        const html = `
            <div class="d-flex align-items-center justify-content-center" style="min-height: 60vh;">
                <div style="width: 100%;">
                    <div class="text-center d-none mb-4">
                        <img src="https://app.whsmonitor.com.au/icons8-setup.gif" alt="Loading" style="margin-bottom: 20px;">
                    </div>
                    
                    <!-- Progress Bar -->
                    <div class="mb-4">
                        <div class="progress" style="height: 30px; background-color: #e9ecef; position: relative;">
                            <div id="progressBarElement" 
                                 class="progress-bar bg-primary" 
                                 role="progressbar" 
                                 style="width: 0%; font-weight: 600; font-size: 14px;"
                                 aria-valuenow="0" 
                                 aria-valuemin="0" 
                                 aria-valuemax="100"
                                 data-message="${this.escapeHtml(message)}">
                            </div>
                            <span id="progressBarText" style="position: absolute; width: 100%; text-align: left; line-height: 30px; font-weight: 600; font-size: 14px; color: #f2f3f5; z-index: 2; left: 15px;">0%</span>
                        </div>
                    </div>
                    
                    <!-- Status Stages -->
                    <div class="d-none justify-content-between text-center small" id="statusStages">
                        <div class="flex-fill text-muted" data-stage="1">
                            <i class="bi bi-circle"></i><br>
                            <span style="font-size: 11px;">Initialize</span>
                        </div>
                        <div class="flex-fill text-muted" data-stage="2">
                            <i class="bi bi-circle"></i><br>
                            <span style="font-size: 11px;">Research</span>
                        </div>
                        <div class="flex-fill text-muted" data-stage="3">
                            <i class="bi bi-circle"></i><br>
                            <span style="font-size: 11px;">Structure</span>
                        </div>
                        <div class="flex-fill text-muted" data-stage="4">
                            <i class="bi bi-circle"></i><br>
                            <span style="font-size: 11px;">Questions</span>
                        </div>
                        <div class="flex-fill text-muted" data-stage="5">
                            <i class="bi bi-circle"></i><br>
                            <span style="font-size: 11px;">Quality</span>
                        </div>
                        <div class="flex-fill text-muted" data-stage="6">
                            <i class="bi bi-circle"></i><br>
                            <span style="font-size: 11px;">Complete</span>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        this.container.innerHTML = html;
        
        // Initialize progress tracking only if not already set
        if (typeof this.currentProgress !== 'number') {
            this.currentProgress = 0;
        }
        
        // Animate progress bar crawling effect
        this.animateProgressBar(progress.percent, progress.stage);
    }
    
    animateProgressBar(targetPercent, targetStage) {
        // Clear any existing animation interval
        if (this.progressInterval) {
            clearInterval(this.progressInterval);
            this.progressInterval = null;
        }
        
        // Initialize current progress if not set
        if (typeof this.currentProgress !== 'number') {
            this.currentProgress = 0;
        }
        
        const progressBar = document.getElementById('progressBarElement');
        
        if (!progressBar) return;
        
        const startPercent = this.currentProgress;
        
        console.log('[PROGRESS] Animating from', startPercent, 'to', targetPercent);
        
        if (startPercent >= targetPercent) {
            // No animation needed, already at or past target
            const message = progressBar.getAttribute('data-message') || '';
            const progressBarText = document.getElementById('progressBarText');
            progressBar.style.width = `${targetPercent}%`;
            if (progressBarText) {
                progressBarText.textContent = message ? `${targetPercent}% ${message}` : `${targetPercent}%`;
            }
            progressBar.setAttribute('aria-valuenow', targetPercent);
            this.currentProgress = targetPercent;
            this.updateStages(targetStage);
            return;
        }
        
        let currentPercent = startPercent;
        
        this.progressInterval = setInterval(() => {
            if (currentPercent >= targetPercent) {
                clearInterval(this.progressInterval);
                this.progressInterval = null;
                this.currentProgress = targetPercent;
                this.updateStages(targetStage);
                console.log('[PROGRESS] Animation complete at', targetPercent);
                return;
            }
            
            currentPercent++;
            if (currentPercent > targetPercent) currentPercent = targetPercent;
            
            const message = progressBar.getAttribute('data-message') || '';
            const progressBarText = document.getElementById('progressBarText');
            progressBar.style.width = `${currentPercent}%`;
            if (progressBarText) {
                progressBarText.textContent = message ? `${currentPercent}% ${message}` : `${currentPercent}%`;
            }
            progressBar.setAttribute('aria-valuenow', currentPercent);
            
            // Update stages as we progress
            const currentStage = this.getStageFromPercent(currentPercent);
            this.updateStages(currentStage);
            
        }, 30); // Update every 30ms for smooth crawling effect
    }
    
    getStageFromPercent(percent) {
        if (percent >= 100) return 6;
        if (percent >= 95) return 5;
        if (percent >= 80) return 4;
        if (percent >= 50) return 3;
        if (percent >= 30) return 2;
        if (percent >= 15) return 1;
        return 0;
    }
    
    updateStages(currentStage) {
        const stagesContainer = document.getElementById('statusStages');
        if (!stagesContainer) return;
        
        const stages = stagesContainer.querySelectorAll('[data-stage]');
        stages.forEach(stageElement => {
            const stageNumber = parseInt(stageElement.getAttribute('data-stage'));
            const icon = stageElement.querySelector('i');
            
            if (stageNumber <= currentStage) {
                stageElement.classList.remove('text-muted');
                if (stageNumber === 6 && currentStage === 6) {
                    stageElement.classList.add('text-success', 'fw-bold');
                } else {
                    stageElement.classList.add('text-primary', 'fw-bold');
                }
                icon.classList.remove('bi-circle');
                icon.classList.add('bi-check-circle-fill');
            } else {
                stageElement.classList.remove('text-primary', 'text-success', 'fw-bold');
                stageElement.classList.add('text-muted');
                icon.classList.remove('bi-check-circle-fill');
                icon.classList.add('bi-circle');
            }
        });
    }
    
    generatePromptFromClassification(classification) {
        const moduleType = this.config.moduleType || 'workplace safety';
        
        return `Create a comprehensive ${moduleType} template specifically for ${classification.class} (ANZSIC ${classification.classCode}).

Industry Context:
- Subdivision: ${classification.subdivision} - ${classification.subdivisionDescription}
- Group: ${classification.group} - ${classification.groupDescription}
- Specific Class: ${classification.class} - ${classification.classDescription}

Template Requirements:
- Address industry-specific risks and hazards common to ${classification.class}
- Include relevant compliance requirements and regulations for this industry sector
- Capture operational details specific to ${classification.groupDescription.toLowerCase()}
- Include fields for location, personnel involved, dates, and key activities
- Provide sections for risk assessment, control measures, and corrective actions
- Include any industry-specific documentation or certification requirements

The template should be practical, easy to use, and comprehensive enough to meet workplace health and safety standards for this specific industry classification.`;
    }
    
    renderWizard() {
        const currentQuestion = this.questions[this.currentStep];
        const totalSteps = this.questions.length;
        const progressPercent = ((this.currentStep) / totalSteps) * 100;
        
        const html = `
            <div class="template-wizard">
               
                <!-- Progress Bar -->
                <div class="wizard-progress mb-4 d-none">
                    <div class="progress d-none" style="height: 8px;">
                        <div class="progress-bar bg-primary progress-bar-striped progress-bar-animated" 
                             role="progressbar" 
                             style="width: ${progressPercent}%" 
                             aria-valuenow="${progressPercent}" 
                             aria-valuemin="0" 
                             aria-valuemax="100">
                        </div>
                    </div>
                    <div class="progress-text text-center mt-2 text-muted small fw-medium">
                        Step ${this.currentStep + 1} of ${totalSteps}
                    </div>
                </div>
                
                <!-- Steps Indicator -->
                <div class="wizard-steps mt-2 d-flex justify-content-between mb-4 px-3">
                    ${this.questions.map((q, idx) => `
                        <div class="step-indicator flex-fill text-center position-relative ${idx < this.currentStep ? 'completed' : ''} ${idx === this.currentStep ? 'active' : ''}">
                            <div class="step-number mx-auto">${idx < this.currentStep ? '?' : idx + 1}</div>
                        </div>
                    `).join('')}
                </div>
                
                <form id="wizardForm" class="wizard-form bg-light p-4 rounded">
                    ${this.renderQuestion(currentQuestion)}
                    
                    <div class="wizard-actions mt-4 d-flex justify-content-between gap-2">
                        ${this.currentStep > 0 ? `
                            <button type="button" id="prevBtn" class="btn btn-secondary px-4">
                                <i class="bi bi-arrow-left me-1"></i> Previous
                            </button>
                        ` : '<div></div>'}
                        
                        ${this.currentStep < totalSteps - 1 ? `
                            <button type="button" id="nextBtn" class="btn btn-primary d-none px-4">
                                Next <i class="bi bi-arrow-right ms-1"></i>
                            </button>
                        ` : `
                            <button type="button" id="generateBtn" class="btn btn-success d-none px-4">
                                <i class="bi bi-magic me-1"></i> Generate Template
                            </button>
                        `}
                    </div>
                </form>
                
                <div id="wizardStatus" class="wizard-status mt-3 rounded" style="display: none;"></div>
            </div>
        `;
        
        this.container.innerHTML = html;
        this.attachEventListeners();
		
		
    }
    
    renderQuestion(question) {
        const questionId = `question_${question.questionNumber}`;
        
        // Initialize question data structure if not exists
        if (!this.questionData) {
            this.questionData = {};
        }
        
        if (!this.questionData[questionId]) {
            this.questionData[questionId] = {
                selected: [...(question.choices || [])].filter(c => c !== 'Other'),
                suggestions: [...(question.suggestions || [])].filter(c => c !== 'Other')
            };
        }
        
        const currentData = this.questionData[questionId];
        
        // Render as chips (pill-shaped buttons) instead of checkboxes
        return `
            <div class="wizard-question">
                <label class="mb-2">${question.question}</label>
                <p class="question-help text-muted small mb-3">Select all options that apply to your needs</p>
               
                <div class="chips-container p-3 bg-white border rounded position-relative" id="selected-${questionId}">
                    <small class="bg-white position-absolute" style="left:12px;top: -8px; font-size: 75%; color: #98A2B3;">Selected</small>
                    ${currentData.selected.map((choice, idx) => `
                        <button 
                            type="button"
                            class="chip-btn active" 
                            id="${questionId}_selected_${idx}" 
                            data-question="${questionId}"
                            data-value="${this.escapeHtml(choice)}"
                            data-type="selected">
                            <span class="chip-text">${this.escapeHtml(choice)}</span>
                            <span class="chip-remove" onclick="window.templateWizardInstance.moveToSuggestions('${questionId}', '${this.escapeForAttribute(choice)}')">
                                <span class="ph-thin ph-x"></span>
                            </span>
                        </button>
                    `).join('')}
                </div>
                
                <!-- Suggestions -->
                <div class="suggestions-section d-flex my-4">
                    <div class="d-flex align-items-center mb-2">
                        <small class="text-muted" style="font-size: 13px; color: #98A2B3 !important">Suggestions:</small>
                    </div>
                    <div class="suggestions-chips d-flex flex-wrap gap-2" id="suggestions-${questionId}">
                        ${currentData.suggestions.map((suggestion, idx) => `
                            <button 
                                type="button"
                                class="suggestion-chip" 
                                id="${questionId}_suggestion_${idx}" 
                                data-question="${questionId}"
                                data-value="${this.escapeHtml(suggestion)}"
                                data-type="suggestion">
                                <span class="suggestion-text">${this.escapeHtml(suggestion)}</span>
                                <span class="chip-remove" onclick="window.templateWizardInstance.moveToSelected('${questionId}', '${this.escapeForAttribute(suggestion)}')">
                                    <span class="ph-thin ph-plus"></span>
                                </span>
                            </button>
                        `).join('')}
                    </div>
                </div>
                
                <!-- New Class Input -->
                <div class="new-class-section position-relative">
                   <small class="bg-white position-absolute" style="left:12px;top: -8px; font-size: 75%; color: #98A2B3;">New Class</small>
                 
                    <div class="d-flex align-items-center gap-2">
                        <input 
                            type="text" 
                            id="newClass_${questionId}" 
                            class="form-control" 
                            placeholder=""
                            style="flex: 1;"
                        />
                        <button 
                            type="button" 
                            class="btn btn-primary" 
                            onclick="window.templateWizardInstance.addNewClass('${questionId}')">
                            ADD
                        </button>
                    </div>
                </div>
            </div>
        `;
    }
    
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    escapeForAttribute(text) {
        return text.replace(/'/g, "\\'").replace(/"/g, '&quot;');
    }
    
    moveToSuggestions(questionId, value) {
        if (!this.questionData || !this.questionData[questionId]) return;
        
        const data = this.questionData[questionId];
        const index = data.selected.indexOf(value);
        
        if (index > -1) {
            // Remove from selected
            data.selected.splice(index, 1);
            
            // Add to suggestions if not already there
            if (!data.suggestions.includes(value)) {
                data.suggestions.push(value);
            }
            
            // Re-render the current question
            this.renderWizard();
        }
    }
    
    moveToSelected(questionId, value) {
        if (!this.questionData || !this.questionData[questionId]) return;
        
        const data = this.questionData[questionId];
        const index = data.suggestions.indexOf(value);
        
        if (index > -1) {
            // Remove from suggestions
            data.suggestions.splice(index, 1);
            
            // Add to selected if not already there
            if (!data.selected.includes(value)) {
                data.selected.push(value);
            }
            
            // Re-render the current question
            this.renderWizard();
        }
    }
    
    addNewClass(questionId) {
        const input = document.getElementById(`newClass_${questionId}`);
        const newClassName = input.value.trim();
        
        if (!newClassName) {
            alert('Please enter a class name');
            return;
        }
        
        if (!this.questionData || !this.questionData[questionId]) return;
        
        const data = this.questionData[questionId];
        
        // Check if already exists in selected or suggestions
        if (data.selected.includes(newClassName) || data.suggestions.includes(newClassName)) {
            alert('This item already exists');
            input.value = '';
            return;
        }
        
        // Add to selected items
        data.selected.push(newClassName);
        
        // Clear the input
        input.value = '';
        
        // Re-render the current question
        this.renderWizard();
    }
    
    attachEventListeners() {
        const nextBtn = document.getElementById('nextBtn');
        const prevBtn = document.getElementById('prevBtn');
        const generateBtn = document.getElementById('generateBtn');
        
        if (nextBtn) {
            nextBtn.addEventListener('click', () => this.handleNext());
        }
        
        if (prevBtn) {
            prevBtn.addEventListener('click', () => this.handlePrevious());
        }
        
        if (generateBtn) {
            generateBtn.addEventListener('click', () => this.handleGenerate());
        }
    }
    
    handleNext() {
        // Save current answer
        this.saveCurrentAnswer();
        
        // Move to next step
        this.currentStep++;
        this.renderWizard();
		
		
    }
    
    handlePrevious() {
        // Save current answer
        this.saveCurrentAnswer();
        
        // Move to previous step
        this.currentStep--;
        this.renderWizard();
        
        // Restore previous answer
        this.restoreCurrentAnswer();
    }
    
    saveCurrentAnswer() {
        const currentQuestion = this.questions[this.currentStep];
        const questionId = `question_${currentQuestion.questionNumber}`;
        
        // Get selected items from questionData
        if (this.questionData && this.questionData[questionId]) {
            const selectedValues = this.questionData[questionId].selected;
            this.answers[currentQuestion.question] = selectedValues.join(', ');
        }
    }
    
    restoreCurrentAnswer() {
        // Answer restoration is now handled by questionData persistence
        // No need to manually restore as the data is already in questionData
    }
    
    collectAnswers() {
        // Save current answer before collecting all
        this.saveCurrentAnswer();
        
        return this.answers;
    }
    
    getSelectedSections() {
        // Get all selected section chips from the DOM
        const selectedContainer = document.getElementById('selected-sections');
        if (!selectedContainer) {
            console.warn('[WIZARD] No selected-sections container found');
            return [];
        }
        
        console.log('[WIZARD] Selected container innerHTML:', selectedContainer.innerHTML);
        
        // Query only for button elements with data-section-name attribute
        const sectionButtons = selectedContainer.querySelectorAll('button.chip-btn[data-section-name]');
        const sections = [];
        
        console.log('[WIZARD] Found section buttons:', sectionButtons.length);
        console.log('[WIZARD] Buttons:', sectionButtons);
        
        sectionButtons.forEach(button => {
            const sectionName = button.getAttribute('data-section-name');
            console.log('[WIZARD] Button:', button, 'SectionName:', sectionName);
            if (sectionName) {
                sections.push(sectionName);
                console.log('[WIZARD] Adding section:', sectionName);
            }
        });
        
        console.log('[WIZARD] Total selected sections:', sections);
        return sections;
    }
    
    async handleGenerate() {
        const answers = this.collectAnswers();
        
        // Validate that at least some questions are answered
        const hasAnswers = Object.values(answers).some(a => a.trim() !== '');
        if (!hasAnswers) {
            alert('Please answer at least one question before generating the template.');
            return;
        }
        
        const generateBtn = document.getElementById('generateBtn');
        generateBtn.disabled = true;
        generateBtn.textContent = 'Generating Template...';
        
        this.showStatus('Generating your template using AI...', 'info');
        
        // Collect selected sections from the DOM
        const selectedSections = this.getSelectedSections();
        
        try {
            const response = await fetch(`${this.config.apiBaseUrl}/wizard`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    companyName: this.config.companyName,
                    companyDomain: this.config.companyDomain,
                    moduleType: this.config.moduleType,
                    wizardAnswers: answers,
                    createdByID: this.config.createdByID,
                    createdByName: this.config.createdByName,
                    storeID: this.config.storeID,
                    templateTypeID: this.config.templateTypeID,
                    
                    // Include wizard selections
                    registerTypeID: this.selectedRegisterType?.regTypeID,
                    registerDescription: this.selectedRegisterType?.registerDesc,
                    moduleDescription: this.selectedRegisterType?.moduleDescription,
                    templateID: this.selectedTemplate?.hazardTemplateID,
                    templateName: this.selectedTemplate?.templateName,
                    selectedSections: selectedSections
                })
            });
            
            const result = await response.json();
            
            if (!response.ok || !result.success) {
                throw new Error(result.message || 'Failed to generate template');
            }
            
            this.showStatus(
                `Template generation queued successfully!<br>
                Request ID: ${result.requestId}<br>
                Status: ${result.status}<br>
                <a href="${this.config.apiBaseUrl}/status/${result.requestId}" target="_blank">Check Status</a>`,
                'success'
            );
            
            if (this.config.onSuccess) {
                this.config.onSuccess(result);
            }
            parent.loadGenerateAI();
            // Poll for status
            this.pollStatus(result.requestId);
            
        } catch (error) {
            this.showStatus('Error: ' + error.message, 'error');
            generateBtn.disabled = false;
            generateBtn.textContent = 'Generate Template';
            
            if (this.config.onError) {
                this.config.onError(error);
            }
        }
    }
    
    async pollStatus(requestId) {
        const maxAttempts = 60; // 5 minutes (5 seconds interval)
        let attempts = 0;
        
        const poll = async () => {
            try {
                const response = await fetch(`${this.config.apiBaseUrl}/status/${requestId}`);
                
                // Check if response is ok (200-299)
                if (!response.ok) {
                    console.error(`[WIZARD] Status check failed: ${response.status} ${response.statusText}`);
                    
                    // If server error (500), retry
                    if (response.status >= 500) {
                        attempts++;
                        if (attempts < maxAttempts) {
                            console.log(`[WIZARD] Retrying status check (attempt ${attempts}/${maxAttempts})...`);
                            setTimeout(poll, 5000);
                        } else {
                            this.showStatus('Unable to check template status. Please refresh the page.', 'warning');
                        }
                        return;
                    }
                    
                    // For other errors, stop polling
                    this.showStatus(`Error checking status: ${response.statusText}`, 'error');
                    return;
                }
                
                const result = await response.json();
                
                console.log('[WIZARD] Status update:', result);
                
                // Update progress bar with current status
                const statusMessage = result.statusMessage || result.status;
                this.showProgressBar(result.status, statusMessage);
                
                if (result.status === 'completed') {
                    this.showStatus(
                        `Template generated successfully!<br>
                        Template ID: ${result.templateId}<br>
                        Template Name: ${result.templateName}<br>
                        Total Fields: ${result.totalFieldsGenerated}`,
                        'success'
                    );
					parent.document.location.href= result.errorMessage;

                    return;
                }
                
                if (result.status === 'failed') {
                    this.showStatus(`Template generation failed: ${result.errorMessage}`, 'error');
                    return;
                }
                
                attempts++;
                if (attempts < maxAttempts) {
                    setTimeout(poll, 5000); // Poll every 5 seconds
                } else {
                    this.showStatus('Template generation is taking longer than expected. Please check status manually.', 'warning');
                }
                
            } catch (error) {
                console.error('[WIZARD] Error polling status:', error);
                
                // Retry on network errors
                attempts++;
                if (attempts < maxAttempts) {
                    console.log(`[WIZARD] Retrying after error (attempt ${attempts}/${maxAttempts})...`);
                    setTimeout(poll, 5000);
                } else {
                    this.showStatus('Unable to check template status. Please refresh the page.', 'warning');
                }
            }
        };
        
        poll();
    }
    
    showLoading(message) {
        this.container.innerHTML = `
            <div class="text-center py-5">
                <div class="spinner-border text-primary" role="status" style="width: 3rem; height: 3rem;">
                    <span class="visually-hidden">Loading...</span>
                </div>
                <p class="mt-3 text-muted">${message}</p>
            </div>
        `;
    }
    
    showError(message) {
        this.container.innerHTML = `
            <div class="alert alert-danger" role="alert">
                <h4 class="alert-heading"><i class="bi bi-exclamation-triangle"></i> Error</h4>
                <p class="mb-0">${message}</p>
            </div>
        `;
    }
    
    showStatus(message, type) {
        const statusDiv = document.getElementById('wizardStatus');
        if (statusDiv) {
            statusDiv.style.display = 'block';
            
            // Map type to Bootstrap alert classes
            const alertClassMap = {
                'info': 'alert-info',
                'success': 'alert-success',
                'error': 'alert-danger',
                'warning': 'alert-warning'
            };
            
            const alertClass = alertClassMap[type] || 'alert-info';
            statusDiv.className = `alert ${alertClass}`;
            statusDiv.innerHTML = message;
        }
    }
}

// Default styles to complement Bootstrap
const defaultStyles = `
<style id="template-wizard-custom-styles">
/* Custom styles to complement Bootstrap */
.template-wizard {
    margin: 0 auto;
}

.step-indicator:not(:last-child)::after {
    content: '';
    position: absolute;
    top: 15px;
    right: -50%;
    width: 100%;
    height: 2px;
    background-color: #dee2e6;
    z-index: 0;
}

.step-indicator.completed:not(:last-child)::after {
    background-color: #0d6efd;
}

.step-number {
    width: 30px;
    height: 30px;
    border-radius: 50%;
    background-color: #e9ecef;
    color: #6c757d;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-weight: bold;
    font-size: 14px;
    position: relative;
    z-index: 1;
    transition: all 0.3s ease;
}

.step-indicator.active .step-number {
    background-color: #0d6efd;
    color: white;
    transform: scale(1.2);
}

.step-indicator.completed .step-number {
    background-color: #198754;
    color: white;
}

.hover-bg:hover {
    background-color: #f8f9fa !important;
    border-color: #0d6efd !important;
}

/* Chip styles */
.chips-container {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
}

.chip-btn {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px 6px 16px;
    border-radius: 29px;
    border: none;
    background-color: #1e90ff;
    color: white;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s ease;
    white-space: nowrap;
    box-shadow: 0 1px 3px rgba(0,0,0,0.12);
}

.chip-text {
    flex: 1;
}

.chip-remove {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background-color: rgba(255, 255, 255, 0.25);
    font-size: 16px;
    font-weight: bold;
    line-height: 1;
    cursor: pointer;
    transition: background-color 0.2s ease;
}

.chip-btn:hover {
    background-color: #1873cc;
    box-shadow: 0 2px 6px rgba(0,0,0,0.15);
}

.chip-btn.active {
    background-color: #1e90ff;
    border-color: #1e90ff;
}

.chip-btn.active:hover {
    background-color: #1873cc;
}

.chip-remove:hover {
    background-color: rgba(255, 255, 255, 0.4);
}

/* Suggestion chips */
.suggestions-section {
    padding: 0;
}

.suggestions-chips {
    gap: 8px;
}

.suggestion-chip {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px 6px 16px;
    border-radius: 25px;
    border: 1px solid #1e90ff;
    background-color: white;
    color: #1e90ff;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s ease;
    white-space: nowrap;
    box-shadow: 0 1px 3px rgba(0,0,0,0.12);
    top: -4px;
    position: relative;
    margin-left: 11px;
}

.suggestion-text {
    flex: 1;
	color: #222!important;
}

.suggestion-chip .chip-remove {
    font-size:25px;
}

.suggestion-chip:hover {
    background-color: #f0f8ff;
    border-color: #1873cc;
    box-shadow: 0 2px 6px rgba(0,0,0,0.15);
}

.suggestion-chip .chip-remove:hover {
    background-color: rgba(30, 144, 255, 0.25);
}

/* Complexity mode toggle buttons */
#complexitySimpleBtn,
#complexityComprehensiveBtn {
    display: inline-flex;
    align-items: center;
    justify-content: flex-start;
    text-align: left;
    padding: 6px 16px;
    gap: 0;
    position: static !important;
    margin-left: 0 !important;
    top: 0 !important;
}

#complexitySimpleBtn .chip-text,
#complexityComprehensiveBtn .suggestion-text {
    flex: unset;
    text-align: left;
}
</style>
`;

// Auto-inject styles if not already present
if (typeof document !== 'undefined' && !document.getElementById('template-wizard-custom-styles')) {
    const styleElement = document.createElement('div');
    styleElement.innerHTML = defaultStyles;
    document.head.appendChild(styleElement.firstElementChild);
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = TemplateWizard;
}

