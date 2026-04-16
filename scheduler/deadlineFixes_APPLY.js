// ===============================
// DEADLINE FIXING SCRIPT
// Add this to dashboardHelpers.js or include separately
// ===============================

const DEADLINE_FIX_ALREADY_APPLIED =
    typeof window !== 'undefined' && window.__deadlineHandlerV2Applied;

if (DEADLINE_FIX_ALREADY_APPLIED) {
    console.log('[DEADLINE FIXES] Enhanced deadline handler already active; skipping legacy overrides.');
} else {
(function() {
    /**
     * CRITICAL FIX: Proper deadline setting with debugging
     */
async function handleSetDeadlines() {
    console.log('[DEADLINES] Starting to set deadlines...');
    console.log('[DEADLINES] currentlyViewedProjectId:', typeof currentlyViewedProjectId !== 'undefined' ? currentlyViewedProjectId : 'undefined');
    console.log('[DEADLINES] window.currentlyViewedProjectId:', window.currentlyViewedProjectId);
    
    // Try to get the project ID from multiple sources
    let projectId = null;
    
    // Try window scope first (most reliable)
    if (window.currentlyViewedProjectId) {
        projectId = window.currentlyViewedProjectId;
        console.log('[DEADLINES] Got project ID from window.currentlyViewedProjectId:', projectId);
    }
    // Try current scope
    else if (typeof currentlyViewedProjectId !== 'undefined' && currentlyViewedProjectId) {
        projectId = currentlyViewedProjectId;
        console.log('[DEADLINES] Got project ID from currentlyViewedProjectId:', projectId);
    }
    // Try to find from modal element dataset
    else {
        const modal = document.getElementById('details-modal');
        if (modal && modal.dataset.projectId) {
            projectId = modal.dataset.projectId;
            console.log('[DEADLINES] Got project ID from modal dataset:', projectId);
        }
    }
    
    if (!projectId) {
        console.error('[DEADLINES] No project ID found');
        console.error('[DEADLINES] Available global variables:', Object.keys(window).filter(k => k.includes('project') || k.includes('Project')));
        showNotification('No project selected. Please try again.', 'error');
        return;
    }
    
    console.log('[DEADLINES] Using project ID:', projectId);
    
    const project = allProjects.find(p => p.id === projectId);
    if (!project) {
        console.error('[DEADLINES] Project not found:', projectId);
        showNotification('Project not found. Please refresh the page.', 'error');
        return;
    }
    
    console.log('[DEADLINES] Current project:', project);
    console.log('[DEADLINES] Existing deadlines:', project.deadlines);
    
    // Get existing deadlines to merge with new ones
    const existingDeadlines = project.deadlines || {};
    const newDeadlines = { ...existingDeadlines };
    
    // List of deadline fields to check
    const deadlineFields = [
        { key: 'contact', label: 'Contact Professor', inputId: 'deadline-contact' },
        { key: 'interview', label: 'Conduct Interview', inputId: 'deadline-interview' },
        { key: 'draft', label: 'Write Draft', inputId: 'deadline-draft' },
        { key: 'review', label: 'Editor Review', inputId: 'deadline-review' },
        { key: 'edits', label: 'Review Edits', inputId: 'deadline-edits' }
    ];
    
    let hasChanges = false;
    let updatedFields = [];
    const fieldValues = {};
    
    // Collect all deadline values from the form
    console.log('[DEADLINES] Reading deadline values from form...');
    deadlineFields.forEach(field => {
        const input = document.getElementById(field.inputId);
        if (input) {
            const value = input.value;
            fieldValues[field.key] = value;
            console.log(`[DEADLINES] ${field.label} (${field.key}): "${value}" (input found: ${!!input})`);
            
            // Only update if value exists and has changed
            if (value && value.trim() !== '') {
                if (newDeadlines[field.key] !== value) {
                    newDeadlines[field.key] = value;
                    hasChanges = true;
                    updatedFields.push(field.label);
                    console.log(`[DEADLINES] ✓ ${field.label} will be updated to: ${value}`);
                }
            }
        } else {
            console.error(`[DEADLINES] ✗ Input field not found: ${field.inputId}`);
        }
    });
    
    console.log('[DEADLINES] Summary:');
    console.log('  - Has changes:', hasChanges);
    console.log('  - Updated fields:', updatedFields);
    console.log('  - New deadlines object:', newDeadlines);
    
    // Validate that at least one deadline was set
    if (!hasChanges) {
        showNotification('No changes detected. Please set or update at least one deadline.', 'warning');
        console.log('[DEADLINES] No changes to save');
        return;
    }
    
    // Validate date logic (optional but helpful)
    const dateOrder = [];
    if (newDeadlines.contact) dateOrder.push({ name: 'Contact', date: new Date(newDeadlines.contact), key: 'contact' });
    if (newDeadlines.interview) dateOrder.push({ name: 'Interview', date: new Date(newDeadlines.interview), key: 'interview' });
    if (newDeadlines.draft) dateOrder.push({ name: 'Draft', date: new Date(newDeadlines.draft), key: 'draft' });
    if (newDeadlines.review) dateOrder.push({ name: 'Review', date: new Date(newDeadlines.review), key: 'review' });
    if (newDeadlines.edits) dateOrder.push({ name: 'Edits', date: new Date(newDeadlines.edits), key: 'edits' });
    if (newDeadlines.publication) dateOrder.push({ name: 'Publication', date: new Date(newDeadlines.publication), key: 'publication' });
    
    // Check for logical ordering and warn (but don't block)
    for (let i = 1; i < dateOrder.length; i++) {
        if (dateOrder[i].date < dateOrder[i-1].date) {
            console.warn(`[DEADLINES] Warning: ${dateOrder[i].name} (${dateOrder[i].date.toLocaleDateString()}) is before ${dateOrder[i-1].name} (${dateOrder[i-1].date.toLocaleDateString()})`);
            showNotification(
                `Note: ${dateOrder[i].name} deadline is before ${dateOrder[i-1].name} deadline. This may cause confusion.`,
                'warning'
            );
        }
    }
    
    try {
        console.log('[DEADLINES] Attempting to save to Firestore...');
        console.log('[DEADLINES] Project ID:', projectId);
        console.log('[DEADLINES] Saving deadlines:', newDeadlines);
        
        // Update Firestore
        await db.collection('projects').doc(projectId).update({
            deadlines: newDeadlines,
            activity: firebase.firestore.FieldValue.arrayUnion({
                text: `updated deadlines: ${updatedFields.join(', ')}`,
                authorName: currentUserName,
                timestamp: new Date()
            })
        });
        
        console.log('[DEADLINES] ✅ Successfully saved to Firestore!');
        showNotification(`Deadlines updated successfully! Updated: ${updatedFields.join(', ')}`, 'success');
        
        // Update local project object
        const projectIndex = allProjects.findIndex(p => p.id === projectId);
        if (projectIndex !== -1) {
            allProjects[projectIndex].deadlines = newDeadlines;
            console.log('[DEADLINES] Updated local project object');
        }
        
        // Update the currently viewed project ID to match
        if (!currentlyViewedProjectId) {
            currentlyViewedProjectId = projectId;
        }
        if (!window.currentlyViewedProjectId) {
            window.currentlyViewedProjectId = projectId;
        }
        
    } catch (error) {
        console.error('[DEADLINES] ❌ Failed to save deadlines:', error);
        console.error('[DEADLINES] Error code:', error.code);
        console.error('[DEADLINES] Error message:', error.message);
        console.error('[DEADLINES] Error stack:', error.stack);
        
        let errorMessage = 'Failed to update deadlines. ';
        if (error.code === 'permission-denied') {
            errorMessage += 'Permission denied. Check that you are an admin and Firestore rules allow updates.';
        } else if (error.code === 'not-found') {
            errorMessage += 'Project not found in database.';
        } else {
            errorMessage += 'Please try again or contact support.';
        }
        
        showNotification(errorMessage, 'error');
    }
}

/**
 * Enhanced renderDeadlines function with better debugging
 */
function renderDeadlines(project, isAuthor, isEditor, isAdmin) {
    console.log('[RENDER DEADLINES] Starting to render deadlines...');
    console.log('[RENDER DEADLINES] Project:', project.id);
    console.log('[RENDER DEADLINES] Is Admin:', isAdmin);
    console.log('[RENDER DEADLINES] Current deadlines:', project.deadlines);
    
    const deadlinesList = document.getElementById('details-deadlines-list');
    if (!deadlinesList) {
        console.error('[RENDER DEADLINES] deadlines list container not found!');
        return;
    }
    
    deadlinesList.innerHTML = '';
    const deadlines = project.deadlines || {};
    
    const deadlineFields = [
        { key: 'contact', label: 'Contact Professor' },
        { key: 'interview', label: 'Conduct Interview' },
        { key: 'draft', label: 'Write Draft' },
        { key: 'review', label: 'Editor Review' },
        { key: 'edits', label: 'Review Edits' }
    ];
    
    deadlineFields.forEach(field => {
        // Skip interview-related fields for Op-Eds
        if (project.type === 'Op-Ed' && (field.key === 'contact' || field.key === 'interview')) {
            console.log(`[RENDER DEADLINES] Skipping ${field.label} for Op-Ed project`);
            return;
        }
        
        const value = deadlines[field.key] || '';
        console.log(`[RENDER DEADLINES] Creating field: ${field.label} with value: "${value}"`);
        
        const deadlineItem = document.createElement('div');
        deadlineItem.className = 'deadline-item';
        deadlineItem.innerHTML = `
            <label for="deadline-${field.key}">${field.label}</label>
            <input 
                type="date" 
                id="deadline-${field.key}" 
                value="${value}" 
                ${!isAdmin ? 'disabled' : ''}
                data-deadline-field="${field.key}"
            >
        `;
        deadlinesList.appendChild(deadlineItem);
        
        console.log(`[RENDER DEADLINES] ✓ Created input field: deadline-${field.key}`);
    });
    
    // Show/hide the "Set Remaining Deadlines" button
    const setButton = document.getElementById('set-deadlines-button');
    if (setButton) {
        setButton.style.display = isAdmin ? 'block' : 'none';
        console.log('[RENDER DEADLINES] Set button visibility:', isAdmin ? 'visible' : 'hidden');
    } else {
        console.error('[RENDER DEADLINES] Set deadlines button not found!');
    }
    
    // Show/hide the "Request Deadline Change" button
    const requestButton = document.getElementById('request-deadline-change-button');
    if (requestButton) {
        const hasRequest = project.deadlineRequest || project.deadlineChangeRequest;
        const isPending = hasRequest && hasRequest.status === 'pending';
        requestButton.style.display = (isAuthor || isEditor) && !isPending ? 'inline-block' : 'none';
        console.log('[RENDER DEADLINES] Request button visibility:', (isAuthor || isEditor) && !isPending ? 'visible' : 'hidden');
    }
    
    console.log('[RENDER DEADLINES] ✅ Finished rendering deadlines');
}

    window.handleSetDeadlines = handleSetDeadlines;
    window.renderDeadlines = renderDeadlines;

console.log('[DEADLINE FIXES] Deadline fixes loaded successfully');
})();
}
