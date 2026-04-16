// ===============================
// DIRECT FORM FIX - NO PAGE RELOAD
// Prevents all page reloads during form submission
// ===============================

console.log('[DIRECT FIX] 🚀 Loading direct form fix...');

// Prevent ALL form submissions from causing page reload
document.addEventListener('submit', function(e) {
    const form = e.target;
    if (form && form.id === 'project-form') {
        console.log('[DIRECT FIX] ⛔ Form submit intercepted - preventing reload');
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        return false;
    }
}, true); // Use capture phase to intercept FIRST

// Prevent button clicks from triggering form submission
document.addEventListener('click', function(e) {
    const button = e.target.closest('#save-project-button');
    if (button) {
        console.log('[DIRECT FIX] ⛔ Button click intercepted - preventing reload');
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        
        // Call the submission handler directly
        if (typeof window.handleProjectFormSubmit === 'function') {
            console.log('[DIRECT FIX] ✅ Calling handleProjectFormSubmit');
            window.handleProjectFormSubmit(e);
        } else {
            console.error('[DIRECT FIX] ❌ handleProjectFormSubmit not found!');
        }
        return false;
    }
}, true); // Use capture phase

console.log('[DIRECT FIX] ✅ Direct form fix loaded and active');
