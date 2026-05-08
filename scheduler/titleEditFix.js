// ===============================
// Title Edit Functionality
// Mirrors the proposalEditFix.js pattern. Lets the author or any admin
// rename their project from the details modal. Title swaps to an inline
// <input>, Save/Cancel buttons appear in the modal header.
// ===============================

console.log('[TITLE EDIT] Loading v1...');

let originalTitleText = '';

function enableTitleEditing() {
    const titleEl = document.getElementById('details-title');
    const editBtn = document.getElementById('edit-title-button');
    const saveBtn = document.getElementById('save-title-button');
    const cancelBtn = document.getElementById('cancel-title-button');

    if (!titleEl) {
        console.error('[TITLE EDIT] Title element not found');
        return;
    }

    originalTitleText = titleEl.textContent.trim();

    const input = document.createElement('input');
    input.type = 'text';
    input.id = 'title-edit-input';
    input.value = originalTitleText;
    input.maxLength = 200;
    input.style.cssText = 'flex:1; min-width:0; padding:8px 12px; border:2px solid #3b82f6; border-radius:8px; font-size:20px; font-weight:600; font-family:inherit; box-sizing:border-box;';

    titleEl.replaceWith(input);

    if (editBtn) editBtn.style.display = 'none';
    if (saveBtn) saveBtn.style.display = 'inline-block';
    if (cancelBtn) cancelBtn.style.display = 'inline-block';

    input.focus();
    input.select();
}

function disableTitleEditing(options = {}) {
    const input = document.getElementById('title-edit-input');
    const editBtn = document.getElementById('edit-title-button');
    const saveBtn = document.getElementById('save-title-button');
    const cancelBtn = document.getElementById('cancel-title-button');

    if (!input) return;

    const text = options.revertToOriginal ? originalTitleText : input.value.trim();

    const h2 = document.createElement('h2');
    h2.id = 'details-title';
    h2.style.cssText = 'margin:0; flex:1; min-width:0; word-break:break-word;';
    h2.textContent = text || originalTitleText;

    input.replaceWith(h2);

    if (editBtn) editBtn.style.display = 'inline-block';
    if (saveBtn) saveBtn.style.display = 'none';
    if (cancelBtn) cancelBtn.style.display = 'none';
}

async function handleSaveTitle() {
    const input = document.getElementById('title-edit-input');
    const saveBtn = document.getElementById('save-title-button');

    if (!input) return;

    const newTitle = input.value.trim();

    if (newTitle.length < 3) {
        alert('Title must be at least 3 characters.');
        return;
    }

    if (newTitle === originalTitleText) {
        disableTitleEditing();
        return;
    }

    const projectId = window.currentlyViewedProjectId || (typeof currentlyViewedProjectId !== 'undefined' ? currentlyViewedProjectId : null);
    if (!projectId) {
        alert('Error: No project selected.');
        return;
    }

    const project = (typeof allProjects !== 'undefined' ? allProjects : []).find(p => p.id === projectId);
    if (!project) {
        alert('Error: Project not found.');
        return;
    }

    const isAuthor = currentUser && currentUser.uid === project.authorId;
    const isAdmin = currentUserRole === 'admin';
    if (!isAuthor && !isAdmin) {
        alert('You can only rename your own projects.');
        return;
    }

    saveBtn.disabled = true;
    const originalBtnText = saveBtn.textContent;
    saveBtn.textContent = 'Saving...';
    input.disabled = true;

    try {
        await db.collection('projects').doc(projectId).update({
            title: newTitle,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            activity: firebase.firestore.FieldValue.arrayUnion({
                text: `renamed the project from "${originalTitleText}" to "${newTitle}"`,
                authorName: currentUserName,
                timestamp: new Date()
            })
        });

        const idx = allProjects.findIndex(p => p.id === projectId);
        if (idx !== -1) allProjects[idx].title = newTitle;

        if (typeof showNotification === 'function') {
            showNotification('Title updated.', 'success');
        }

        disableTitleEditing();

        // Refresh the modal so any other title placements (e.g. status report) update too.
        if (idx !== -1 && typeof refreshDetailsModal === 'function') {
            refreshDetailsModal(allProjects[idx]);
        }
    } catch (err) {
        console.error('[TITLE EDIT] Save failed:', err);
        alert('Failed to save title: ' + (err && err.message ? err.message : err));
        input.disabled = false;
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = originalBtnText;
    }
}

function attachTitleEditListeners() {
    const editBtn = document.getElementById('edit-title-button');
    const saveBtn = document.getElementById('save-title-button');
    const cancelBtn = document.getElementById('cancel-title-button');

    if (!editBtn || !saveBtn || !cancelBtn) {
        // Wait for the modal HTML to be ready.
        setTimeout(attachTitleEditListeners, 200);
        return;
    }

    editBtn.onclick = function (e) {
        e.preventDefault();
        e.stopPropagation();
        enableTitleEditing();
    };
    saveBtn.onclick = function (e) {
        e.preventDefault();
        e.stopPropagation();
        handleSaveTitle();
    };
    cancelBtn.onclick = function (e) {
        e.preventDefault();
        e.stopPropagation();
        disableTitleEditing({ revertToOriginal: true });
    };
}

window.enableTitleEditing = enableTitleEditing;
window.disableTitleEditing = disableTitleEditing;
window.handleSaveTitle = handleSaveTitle;
window.attachTitleEditListeners = attachTitleEditListeners;

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attachTitleEditListeners);
} else {
    attachTitleEditListeners();
}
window.addEventListener('load', () => {
    setTimeout(attachTitleEditListeners, 1000);
    setTimeout(attachTitleEditListeners, 2500);
});

console.log('[TITLE EDIT] Loaded.');
