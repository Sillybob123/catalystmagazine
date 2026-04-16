// ===============================
// Proposal Edit Button Listeners - CRITICAL FIX
// VERSION 2 - UPDATED: Exported attachEditListeners to window
// ===============================

console.log('[EDIT BUTTONS] Script loading v2...');

function attachEditListeners() {
    console.log('[EDIT BUTTONS] Attaching listeners...');
    
    const editBtn = document.getElementById('edit-proposal-button');
    const saveBtn = document.getElementById('save-proposal-button');
    const cancelBtn = document.getElementById('cancel-proposal-button');
    
    if (!editBtn || !saveBtn || !cancelBtn) {
        console.warn('[EDIT BUTTONS] Buttons not found, retrying...');
        setTimeout(attachEditListeners, 200);
        return;
    }
    
    console.log('[EDIT BUTTONS] Buttons found!');
    
    // Edit button
    editBtn.onclick = function(e) {
        e.preventDefault();
        e.stopPropagation();
        console.log('[EDIT BUTTONS] Edit clicked!');
        if (typeof window.enableProposalEditing === 'function') {
            window.enableProposalEditing();
        } else {
            console.error('[EDIT BUTTONS] enableProposalEditing not found');
            alert('Edit function not loaded. Please refresh page.');
        }
    };
    
    // Save button
    saveBtn.onclick = function(e) {
        e.preventDefault();
        e.stopPropagation();
        console.log('[EDIT BUTTONS] Save clicked!');
        if (typeof window.handleSaveProposal === 'function') {
            window.handleSaveProposal();
        } else {
            console.error('[EDIT BUTTONS] handleSaveProposal not found');
        }
    };
    
    // Cancel button
    cancelBtn.onclick = function(e) {
        e.preventDefault();
        e.stopPropagation();
        console.log('[EDIT BUTTONS] Cancel clicked!');
        if (typeof window.disableProposalEditing === 'function') {
            window.disableProposalEditing({ revertToOriginal: true });
        } else {
            console.error('[EDIT BUTTONS] disableProposalEditing not found');
        }
    };
    
    console.log('[EDIT BUTTONS] ✅ All listeners attached!');
}

// Try immediately
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attachEditListeners);
} else {
    attachEditListeners();
}

// Also try after window load
window.addEventListener('load', function() {
    setTimeout(attachEditListeners, 1000);
    setTimeout(attachEditListeners, 2000);
    setTimeout(attachEditListeners, 3000);
});

// Export to window so it can be called after modal refresh
window.attachEditListeners = attachEditListeners;

console.log('[EDIT BUTTONS] Script loaded');
