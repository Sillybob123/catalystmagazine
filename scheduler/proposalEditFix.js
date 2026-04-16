// ===============================
// Proposal Edit Functionality - WORKING VERSION
// VERSION 3 - UPDATED: Added modal refresh after save
// ===============================

console.log('[PROPOSAL EDIT] Loading v3...');

let originalProposalText = '';

function enableProposalEditing() {
    console.log('[EDIT] Button clicked!');
    
    const proposalElement = document.getElementById('details-proposal');
    const editButton = document.getElementById('edit-proposal-button');
    const saveButton = document.getElementById('save-proposal-button');
    const cancelButton = document.getElementById('cancel-proposal-button');
    
    if (!proposalElement) {
        console.error('[EDIT] Proposal element not found');
        alert('Error: Proposal element not found');
        return;
    }
    
    originalProposalText = proposalElement.textContent;
    console.log('[EDIT] Original text:', originalProposalText.substring(0, 50));
    
    const textarea = document.createElement('textarea');
    textarea.id = 'proposal-edit-textarea';
    textarea.value = originalProposalText;
    textarea.rows = 8;
    textarea.style.cssText = 'width:100%;padding:12px;border:2px solid #3b82f6;border-radius:8px;font-size:14px;font-family:inherit;resize:vertical;min-height:150px;box-sizing:border-box;';
    
    proposalElement.replaceWith(textarea);
    
    if (editButton) editButton.style.display = 'none';
    if (saveButton) saveButton.style.display = 'inline-block';
    if (cancelButton) cancelButton.style.display = 'inline-block';
    
    textarea.focus();
    console.log('[EDIT] Edit mode enabled');
}

function disableProposalEditing(options = {}) {
    console.log('[EDIT] Disabling edit mode...');
    
    const textarea = document.getElementById('proposal-edit-textarea');
    const editButton = document.getElementById('edit-proposal-button');
    const saveButton = document.getElementById('save-proposal-button');
    const cancelButton = document.getElementById('cancel-proposal-button');
    
    if (!textarea) {
        console.log('[EDIT] Not in edit mode');
        return;
    }
    
    const textToDisplay = options.revertToOriginal ? originalProposalText : textarea.value;
    
    const paragraph = document.createElement('p');
    paragraph.id = 'details-proposal';
    paragraph.textContent = textToDisplay || 'No proposal provided.';
    
    textarea.replaceWith(paragraph);
    
    if (editButton) editButton.style.display = 'inline-block';
    if (saveButton) saveButton.style.display = 'none';
    if (cancelButton) cancelButton.style.display = 'none';
    
    console.log('[EDIT] Edit mode disabled');
}

async function handleSaveProposal() {
    console.log('[SAVE] Saving proposal...');
    
    const textarea = document.getElementById('proposal-edit-textarea');
    const saveButton = document.getElementById('save-proposal-button');
    
    if (!textarea) {
        alert('Error: Not in edit mode');
        return;
    }
    
    const newProposal = textarea.value.trim();
    
    if (newProposal.length < 10) {
        alert('Proposal must be at least 10 characters');
        return;
    }
    
    if (newProposal === originalProposalText) {
        alert('No changes to save');
        disableProposalEditing();
        return;
    }
    
    const projectId = window.currentlyViewedProjectId || currentlyViewedProjectId;
    
    if (!projectId) {
        alert('Error: No project ID');
        return;
    }
    
    const project = allProjects.find(p => p.id === projectId);
    if (!project) {
        alert('Error: Project not found');
        return;
    }
    
    const isAuthor = currentUser && currentUser.uid === project.authorId;
    const isAdmin = currentUserRole === 'admin';
    
    if (!isAuthor && !isAdmin) {
        alert('You can only edit your own proposals');
        return;
    }
    
    saveButton.disabled = true;
    saveButton.textContent = 'Saving...';
    textarea.disabled = true;
    
    try {
        await db.collection('projects').doc(projectId).update({
            proposal: newProposal,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            activity: firebase.firestore.FieldValue.arrayUnion({
                text: 'updated the proposal',
                authorName: currentUserName,
                timestamp: new Date()
            })
        });
        
        const projectIndex = allProjects.findIndex(p => p.id === projectId);
        if (projectIndex !== -1) {
            allProjects[projectIndex].proposal = newProposal;
        }

        alert('Proposal updated successfully!');
        disableProposalEditing();

        // Refresh the modal to show updated content
        if (projectIndex !== -1 && typeof refreshDetailsModal === 'function') {
            refreshDetailsModal(allProjects[projectIndex]);
        }
        
    } catch (error) {
        console.error('[SAVE] Error:', error);
        alert('Failed to save: ' + error.message);
        textarea.disabled = false;
    } finally {
        saveButton.disabled = false;
        saveButton.textContent = 'Save';
    }
}

window.enableProposalEditing = enableProposalEditing;
window.disableProposalEditing = disableProposalEditing;
window.handleSaveProposal = handleSaveProposal;

console.log('[PROPOSAL EDIT] Functions exported to window');
console.log('[PROPOSAL EDIT] enableProposalEditing available:', typeof window.enableProposalEditing);
