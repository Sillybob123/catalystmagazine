// ===============================
// Catalyst Tracker - COMPLETE FIXED Dashboard JS
// ===============================

// ---- Firebase Configuration ----
const firebaseConfig = {
    apiKey: "AIzaSyBT6urJvPCtuYQ1c2iH77QTDfzE3yGw-Xk",
    authDomain: "catalystmonday.firebaseapp.com",
    projectId: "catalystmonday",
    storageBucket: "catalystmonday.appspot.com",
    messagingSenderId: "394311851220",
    appId: "1:394311851220:web:86e4939b7d5a085b46d75d"
};

// Initialize Firebase with error handling
try {
    if (!firebase.apps.length) {
        firebase.initializeApp(firebaseConfig);
        console.log('[FIREBASE] Firebase initialized successfully');
    }
} catch (initError) {
    console.error("[FIREBASE] Firebase initialization failed:", initError);
    alert("Failed to connect to the database. Please refresh the page and try again.");
}

const auth = firebase.auth();
const db = firebase.firestore();
const DEFAULT_ZOOM_MEETING_URL = 'https://gwu-edu.zoom.us/j/97392237308';
const DEFAULT_MEETING_TIMEZONE = 'America/New_York';
const OWNER_EMAILS = ['bendoryair@gmail.com'];

let zoomMeetingUrl = DEFAULT_ZOOM_MEETING_URL;
let nextMeetingTime = null;
let nextMeetingTimezone = DEFAULT_MEETING_TIMEZONE;
let meetingCountdownInterval = null;
let meetingSettingsUnsubscribe = null;
let zoomElements = [];
const meetingSettingsDocRef = db.collection('settings').doc('meeting');

// Enable offline persistence for better reliability
db.enablePersistence({ synchronizeTabs: true })
    .catch(function(err) {
        if (err.code === 'failed-precondition') {
            console.warn('[FIREBASE] Persistence failed: Multiple tabs open');
        } else if (err.code === 'unimplemented') {
            console.warn('[FIREBASE] Persistence not available in this browser');
        }
    });

/**
 * Ensure realtime subscriptions are initialized after all scripts load.
 * Retries a few times because fixedSubscriptions.js loads after dashboard.js.
 */
function ensureSubscriptionsInitialized(attempt = 0) {
    const MAX_ATTEMPTS = 10;

    if (typeof window.initializeSubscriptions === 'function') {
        console.log('[INIT] Initializing realtime subscriptions');
        window.initializeSubscriptions();
        return;
    }

    if (attempt < MAX_ATTEMPTS) {
        const nextAttempt = attempt + 1;
        console.warn(`[INIT] Subscriptions not ready (attempt ${nextAttempt}/${MAX_ATTEMPTS}), retrying...`);
        setTimeout(() => ensureSubscriptionsInitialized(nextAttempt), 100);
        return;
    }

    console.error('[INIT] Failed to initialize subscriptions after multiple attempts');
    showNotification('Live updates failed to start. Please refresh the page.', 'error');
}

// ==================
//  Missing Helper Functions
// ==================

async function approveProposal(projectId) {
    if (!projectId) {
        console.error('[APPROVE] No project ID provided');
        showNotification('No project selected.', 'error');
        return;
    }

    if (currentUserRole !== 'admin') {
        console.error('[APPROVE] User is not admin:', currentUserRole);
        showNotification('Only admins can approve proposals.', 'error');
        return;
    }

    try {
        console.log('[APPROVE] Approving proposal:', projectId);
        await db.collection('projects').doc(projectId).update({
            proposalStatus: 'approved',
            'timeline.Topic Proposal Complete': true,
            activity: firebase.firestore.FieldValue.arrayUnion({
                text: 'approved the proposal',
                authorName: currentUserName,
                timestamp: new Date()
            })
        });

        showNotification('Proposal approved successfully!', 'success');
        console.log('[APPROVE] Proposal approved successfully');
    } catch (error) {
        console.error('[APPROVE ERROR] Failed to approve proposal:', error);
        let errorMessage = 'Failed to approve proposal. ';
        
        if (error.code === 'permission-denied') {
            errorMessage += 'You do not have permission to approve proposals.';
        } else {
            errorMessage += 'Please try again.';
        }
        
        showNotification(errorMessage, 'error');
    }
}

async function updateProposalStatus(status) {
    if (!currentlyViewedProjectId) {
        console.error('[UPDATE STATUS] No project ID provided');
        showNotification('No project selected.', 'error');
        return;
    }

    if (currentUserRole !== 'admin') {
        console.error('[UPDATE STATUS] User is not admin:', currentUserRole);
        showNotification('Only admins can update proposal status.', 'error');
        return;
    }

    try {
        console.log('[UPDATE STATUS] Updating proposal status to:', status, 'for project:', currentlyViewedProjectId);
        await db.collection('projects').doc(currentlyViewedProjectId).update({
            proposalStatus: status,
            activity: firebase.firestore.FieldValue.arrayUnion({
                text: `${status} the proposal`,
                authorName: currentUserName,
                timestamp: new Date()
            })
        });

        showNotification(`Proposal ${status} successfully!`, 'success');
        console.log('[UPDATE STATUS] Status updated successfully');
    } catch (error) {
        console.error(`[UPDATE STATUS ERROR] Failed to ${status} proposal:`, error);
        let errorMessage = `Failed to ${status} proposal. `;
        
        if (error.code === 'permission-denied') {
            errorMessage += 'You do not have permission to update proposal status.';
        } else {
            errorMessage += 'Please try again.';
        }
        
        showNotification(errorMessage, 'error');
    }
}

async function handleAddComment() {
    const commentInput = document.getElementById('comment-input');
    if (!commentInput || !currentlyViewedProjectId) return;

    const comment = commentInput.value.trim();
    if (!comment) {
        showNotification('Please enter a comment.', 'error');
        return;
    }

    try {
        await db.collection('projects').doc(currentlyViewedProjectId).update({
            activity: firebase.firestore.FieldValue.arrayUnion({
                text: `commented: "${comment}"`,
                authorName: currentUserName,
                timestamp: new Date()
            })
        });

        commentInput.value = '';
        showNotification('Comment added successfully!', 'success');
    } catch (error) {
        console.error('[ERROR] Failed to add comment:', error);
        showNotification('Failed to add comment. Please try again.', 'error');
    }
}

async function handleAssignEditor() {
    const editorDropdown = document.getElementById('editor-dropdown');
    if (!editorDropdown || !currentlyViewedProjectId) return;

    const editorId = editorDropdown.value;
    if (!editorId) {
        showNotification('Please select an editor.', 'error');
        return;
    }

    const editor = allEditors.find(e => e.id === editorId);
    if (!editor) return;

    // Get current project to check if we're reassigning
    const project = allProjects.find(p => p.id === currentlyViewedProjectId);
    const isReassignment = project && project.editorId;
    const previousEditorName = project ? project.editorName : null;

    try {
        await db.collection('projects').doc(currentlyViewedProjectId).update({
            editorId: editorId,
            editorName: editor.name,
            activity: firebase.firestore.FieldValue.arrayUnion({
                text: isReassignment 
                    ? `reassigned editor from ${previousEditorName} to ${editor.name}`
                    : `assigned ${editor.name} as editor`,
                authorName: currentUserName,
                timestamp: new Date()
            })
        });

        showNotification(
            isReassignment 
                ? `Editor reassigned to ${editor.name} successfully!` 
                : `Editor ${editor.name} assigned successfully!`, 
            'success'
        );
    } catch (error) {
        console.error('[ERROR] Failed to assign editor:', error);
        showNotification('Failed to assign editor. Please try again.', 'error');
    }
}

async function handleDeleteProject() {
    if (!currentlyViewedProjectId) {
        console.error('[DELETE] No project ID provided');
        showNotification('No project selected for deletion.', 'error');
        return;
    }

    const project = allProjects.find(p => p.id === currentlyViewedProjectId);
    if (!project) {
        console.error('[DELETE] Project not found:', currentlyViewedProjectId);
        showNotification('Project not found.', 'error');
        return;
    }

    const isAdmin = currentUserRole === 'admin';
    const isAuthor = currentUser.uid === project.authorId;

    console.log('[DELETE PROJECT] Permissions check:', {
        currentUserRole,
        isAdmin,
        isAuthor,
        projectAuthorId: project.authorId,
        currentUserId: currentUser.uid
    });

    if (!isAdmin && !isAuthor) {
        showNotification('You can only delete projects you created.', 'error');
        return;
    }

    const confirmMessage = `Are you sure you want to permanently delete "${project.title}"?\n\nThis action cannot be undone and will remove all associated data.`;
    
    if (confirm(confirmMessage)) {
        try {
            console.log('[DELETE] Deleting project:', currentlyViewedProjectId);
            await db.collection('projects').doc(currentlyViewedProjectId).delete();
            showNotification('Project deleted successfully!', 'success');
            console.log('[DELETE] Project deleted successfully');
            
            // Close modal after a short delay
            setTimeout(() => {
                closeAllModals();
            }, 500);
        } catch (error) {
            console.error('[DELETE ERROR] Failed to delete project:', error);
            let errorMessage = 'Failed to delete project. ';
            
            if (error.code === 'permission-denied') {
                errorMessage += 'You do not have permission to delete this project.';
            } else if (error.code === 'not-found') {
                errorMessage += 'Project not found.';
            } else {
                errorMessage += 'Please try again or contact support.';
            }
            
            showNotification(errorMessage, 'error');
        }
    }
}


// ---- App State ----
let currentUser = null, currentUserName = null, currentUserRole = null;
let allProjects = [], allEditors = [], allTasks = [], allUsers = [];
let currentlyViewedProjectId = null, currentlyViewedTaskId = null;
let currentView = 'interviews';
let meetingPrepGroups = [];
let meetingPrepUnsubscribe = null;
let meetingPrepEditId = null;
let prepBuilderState = {
    teamCount: 4,
    mode: 'random',
    workspaceTeams: [],
    benchIds: []
};
let prepManualAssignments = {};
let calendarDate = new Date();
const pendingEditorAlertedProjects = new Set();
let taskFormSubmitListenerAttached = false;
let modalCloseDelegationAttached = false;
let availabilityOverrides = {}; // Stores admin overrides for user availability
let availabilityOverridesUnsubscribe = null;
let availabilityOverridesInitPromise = null;
let availabilityOverridesLoaded = false;
let lastAvailabilityOverrideWrite = 0;
let availabilityOverlayEscHandler = null;
let availabilityPreviousOverflow = '';
const availabilityOverridesRef = db.collection('settings').doc('availabilityOverrides');

// ==================
//  Modal Management
// ==================

/**
 * Properly close all modals and reset their states
 * This function ensures clean transitions between modals
 */
function closeAllModals() {
    console.log('[MODAL CLOSE] Closing all modals and resetting states');
    
    // Get all modal elements
    const modals = [
        'project-modal',
        'task-modal',
        'details-modal',
        'task-details-modal',
        'report-modal'
    ];
    
    modals.forEach(modalId => {
        const modal = document.getElementById(modalId);
        if (modal) {
            // Force remove display and reset all styles
            modal.style.display = 'none';
            modal.style.opacity = '';
            modal.style.visibility = '';
            modal.style.transition = '';
            
            // Clear dataset to avoid stale project/task IDs
            if (modal.dataset.projectId) {
                delete modal.dataset.projectId;
            }
            if (modal.dataset.taskId) {
                delete modal.dataset.taskId;
            }
            
            // Remove any loading states
            modal.classList.remove('loading');
            
            console.log(`[MODAL CLOSE] Closed ${modalId}`);
        }
    });
    
    // Only clear currently viewed IDs if we're actually closing all modals
    // Don't clear if we're just transitioning between modals
    // The setTimeout in openDetailsModal will set the new ID before this takes effect
    setTimeout(() => {
        // Check if any modal is actually open after a brief delay
        const anyModalOpen = modals.some(modalId => {
            const modal = document.getElementById(modalId);
            return modal && modal.style.display === 'flex';
        });
        
        // Only clear IDs if no modals are open
        if (!anyModalOpen) {
            currentlyViewedProjectId = null;
            currentlyViewedTaskId = null;
            window.currentlyViewedProjectId = null;
            window.currentlyViewedTaskId = null;
            console.log('[MODAL CLOSE] Cleared all viewed IDs');
        } else {
            console.log('[MODAL CLOSE] Modal still open, keeping IDs');
        }
    }, 50);
    
    // Remove blur from background and restore scrolling
    document.body.style.overflow = '';
    document.body.style.filter = '';
    
    const appContainer = document.getElementById('app-container');
    if (appContainer) {
        appContainer.style.filter = '';
        appContainer.style.transition = '';
    }
    
    console.log('[MODAL CLOSE] All modals closed successfully, states reset');
}

// ==================
//  Utility Functions
// ==================

function stringToColor(str) {
    if (!str) return '#64748b';
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = hash % 360;
    return `hsl(${hue}, 65%, 50%)`;
}

function getUserDisplayName(user) {
    if (!user) return 'Team Member';

    if (typeof user === 'string' && user.trim()) {
        return user.trim();
    }

    const nameCandidates = [
        user.name,
        user.displayName,
        user.authorName,
        user.editorName
    ].filter(candidate => typeof candidate === 'string' && candidate.trim());

    if (nameCandidates.length > 0) {
        return nameCandidates[0].trim();
    }

    if (user.email && typeof user.email === 'string') {
        const localPart = user.email.split('@')[0];
        if (localPart) {
            return localPart;
        }
    }

    if (user.id) {
        return `Member ${String(user.id).slice(0, 4)}`;
    }

    return 'Team Member';
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function calculateProgress(timeline) {
    if (!timeline) return 0;
    const tasks = Object.values(timeline);
    if (tasks.length === 0) return 0;
    const completed = tasks.filter(t => t === true).length;
    return Math.round((completed / tasks.length) * 100);
}

function isUserAssignedToTask(task, userId) {
    if (!task || !userId) return false;

    if (task.assigneeIds && Array.isArray(task.assigneeIds)) {
        return task.assigneeIds.includes(userId);
    }

    return task.assigneeId === userId;
}

function getTaskAssigneeNames(task) {
    if (!task) return ['Not assigned'];

    if (task.assigneeNames && Array.isArray(task.assigneeNames) && task.assigneeNames.length > 0) {
        return task.assigneeNames;
    }

    if (task.assigneeName) {
        return [task.assigneeName];
    }

    return ['Not assigned'];
}

function isValidDate(dateString) {
    const regex = /^\d{4}-\d{2}-\d{2}$/;
    if (!regex.test(dateString)) return false;
    const date = new Date(dateString);
    return date instanceof Date && !isNaN(date);
}

function showNotification(message, type = 'info') {
    const container = document.getElementById('notification-container') || createNotificationContainer();

    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.innerHTML = `
        <div class="notification-content">
            <span class="notification-icon">${getNotificationIcon(type)}</span>
            <span class="notification-message">${escapeHtml(message)}</span>
        </div>
        <button class="notification-close" aria-label="Close">×</button>
    `;

    container.appendChild(notification);

    setTimeout(() => notification.classList.add('show'), 10);

    notification.querySelector('.notification-close').addEventListener('click', () => {
        removeNotification(notification);
    });

    setTimeout(() => removeNotification(notification), 5000);
}

function createNotificationContainer() {
    const container = document.createElement('div');
    container.id = 'notification-container';
    container.style.cssText = 'position: fixed; top: 20px; right: 20px; z-index: 10000; display: flex; flex-direction: column; gap: 10px;';
    document.body.appendChild(container);
    return container;
}

function getNotificationIcon(type) {
    const icons = {
        success: '✓',
        error: '✕',
        warning: '⚠',
        info: 'ℹ'
    };
    return icons[type] || icons.info;
}

function removeNotification(notification) {
    notification.classList.remove('show');
    setTimeout(() => {
        if (notification.parentNode) {
            notification.parentNode.removeChild(notification);
        }
    }, 300);
}

// ==================
//  Multi-Select State & Functions
// ==================
let selectedAssignees = [];
let filteredUsers = [];
let isDropdownOpen = false;

function initializeMultiSelect() {
    selectedAssignees = [];
    filteredUsers = [...allUsers];
    isDropdownOpen = false;

    renderSelectedAssignees();
    renderDropdownOptions();
    setupMultiSelectListeners();
}

function setupMultiSelectListeners() {
    const container = document.getElementById('multi-select-container');
    const searchInput = document.getElementById('assignee-search');
    const header = document.getElementById('multi-select-header');
    const indicator = document.getElementById('dropdown-indicator');

    if (!container || !searchInput || !header || !indicator) {
        console.error('[MULTI-SELECT] Required elements not found');
        return;
    }

    const newContainer = container.cloneNode(true);
    container.parentNode.replaceChild(newContainer, container);

    const freshContainer = document.getElementById('multi-select-container');
    const freshSearch = document.getElementById('assignee-search');
    const freshHeader = document.getElementById('multi-select-header');
    const freshIndicator = document.getElementById('dropdown-indicator');

    freshSearch.addEventListener('input', (e) => {
        const searchTerm = e.target.value.toLowerCase();
        filterUsers(searchTerm);
        if (!isDropdownOpen) openDropdown();
    });

    freshSearch.addEventListener('focus', () => {
        openDropdown();
    });

    freshSearch.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeDropdown();
            e.target.blur();
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (filteredUsers.length > 0) {
                const firstUnselected = filteredUsers.find(user =>
                    !selectedAssignees.some(selected => selected.id === user.id)
                );
                if (firstUnselected) {
                    toggleAssignee(firstUnselected.id);
                    e.target.value = '';
                    filterUsers('');
                }
            }
        } else if (e.key === 'Backspace' && e.target.value === '' && selectedAssignees.length > 0) {
            const lastAssignee = selectedAssignees[selectedAssignees.length - 1];
            removeAssignee(lastAssignee.id);
        }
    });

    freshHeader.addEventListener('click', (e) => {
        if (!e.target.closest('.remove-assignee') && !e.target.closest('.dropdown-indicator')) {
            freshSearch.focus();
            if (!isDropdownOpen) openDropdown();
        }
    });

    freshIndicator.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleDropdown();
        if (isDropdownOpen) freshSearch.focus();
    });

    const handleOutsideClick = (e) => {
        if (freshContainer && !freshContainer.contains(e.target)) {
            closeDropdown();
        }
    };

    document.removeEventListener('click', handleOutsideClick);
    document.addEventListener('click', handleOutsideClick);
}

function openDropdown() {
    isDropdownOpen = true;
    const container = document.getElementById('multi-select-container');
    const dropdown = document.getElementById('assignee-dropdown');

    if (container && dropdown) {
        container.classList.add('open');
        dropdown.classList.add('show');
    }
}

function closeDropdown() {
    isDropdownOpen = false;
    const container = document.getElementById('multi-select-container');
    const dropdown = document.getElementById('assignee-dropdown');

    if (container && dropdown) {
        container.classList.remove('open');
        dropdown.classList.remove('show');
    }
}

function toggleDropdown() {
    if (isDropdownOpen) {
        closeDropdown();
    } else {
        openDropdown();
    }
}

function filterUsers(searchTerm) {
    if (!searchTerm.trim()) {
        filteredUsers = [...allUsers];
    } else {
        filteredUsers = allUsers.filter(user =>
            user.name.toLowerCase().includes(searchTerm) ||
            (user.role && user.role.toLowerCase().includes(searchTerm)) ||
            (user.email && user.email.toLowerCase().includes(searchTerm))
        );
    }
    renderDropdownOptions();
}

function toggleAssignee(userId) {
    const user = allUsers.find(u => u.id === userId);
    if (!user) return;

    const existingIndex = selectedAssignees.findIndex(selected => selected.id === userId);

    if (existingIndex > -1) {
        selectedAssignees.splice(existingIndex, 1);
    } else {
        selectedAssignees.push(user);
    }

    renderSelectedAssignees();
    renderDropdownOptions();
    updateSelectionCounter();
}

function removeAssignee(userId) {
    selectedAssignees = selectedAssignees.filter(user => user.id !== userId);
    renderSelectedAssignees();
    renderDropdownOptions();
    updateSelectionCounter();
}

function renderSelectedAssignees() {
    const container = document.getElementById('selected-assignees');
    if (!container) return;

    if (selectedAssignees.length === 0) {
        container.innerHTML = '';
        return;
    }

    container.innerHTML = selectedAssignees.map(user => {
        const displayName = getUserDisplayName(user);
        const initials = displayName.charAt(0).toUpperCase();
        return `
            <div class="assignee-tag" data-user-id="${user.id}">
                <div class="assignee-avatar" style="background-color: ${stringToColor(displayName)}">
                    ${initials}
                </div>
                <span>${escapeHtml(displayName)}</span>
                <div class="remove-assignee" onclick="removeAssignee('${user.id}')" title="Remove ${escapeHtml(displayName)}">
                    ×
                </div>
            </div>
        `;
    }).join('');
}

function renderDropdownOptions() {
    const dropdown = document.getElementById('assignee-dropdown');
    if (!dropdown) return;

    if (filteredUsers.length === 0) {
        dropdown.innerHTML = '<div class="no-results">No team members found. Please ask an admin to add users.</div>';
        return;
    }

    dropdown.innerHTML = filteredUsers.map(user => {
        const isSelected = selectedAssignees.some(selected => selected.id === user.id);
        const displayName = getUserDisplayName(user);
        const initials = displayName.charAt(0).toUpperCase();
        const roleLabel = user.role || 'member';
        return `
            <div class="assignee-item ${isSelected ? 'selected' : ''}"
                 onclick="toggleAssignee('${user.id}')"
                 data-user-id="${user.id}"
                 tabindex="0">
                <div class="user-avatar" style="background-color: ${stringToColor(displayName)}">
                    ${initials}
                </div>
                <div class="assignee-info">
                    <div class="assignee-name">${escapeHtml(displayName)}</div>
                    <div class="assignee-role">${escapeHtml(roleLabel)}</div>
                </div>
                <div class="assignee-status">available</div>
            </div>
        `;
    }).join('');
}

function updateSelectionCounter() {
    const counter = document.getElementById('selection-counter');
    if (!counter) return;

    if (selectedAssignees.length > 0) {
        counter.textContent = selectedAssignees.length;
        counter.classList.add('show');
    } else {
        counter.classList.remove('show');
    }
}

// ==================
//  Initialization & Auth
// ==================
auth.onAuthStateChanged(async (user) => {
    if (!user) {
        window.location.href = 'index.html';
        return;
    }
    currentUser = user;

    try {
        const userDoc = await db.collection('users').doc(user.uid).get();

        if (!userDoc.exists) {
            const defaultUserData = {
                name: user.displayName || user.email.split('@')[0],
                email: user.email,
                role: 'writer',
                createdAt: new Date()
            };

            await db.collection('users').doc(user.uid).set(defaultUserData);
            currentUserName = defaultUserData.name;
            currentUserRole = defaultUserData.role;
        } else {
            const userData = userDoc.data();
            currentUserName = userData.name || user.displayName || user.email.split('@')[0];
            currentUserRole = userData.role || 'writer';
        }

        // Show UI immediately after getting user info
        setupUI();
        document.getElementById('loader').style.display = 'none';
        document.getElementById('app-container').style.display = 'flex';

        // Parallelize data fetching and setup (non-blocking)
        Promise.all([
            fetchEditors(),
            fetchAllUsers(),
            loadAvailabilityOverrides()
        ]).then(() => {
            console.log('[INIT] User data loaded successfully');
        }).catch(error => {
            console.error('[INIT] Error fetching user data:', error);
        });

        // Setup UI controls (non-blocking)
        setupNavAndListeners();
        setupOwnerOnlyControls();
        subscribeToMeetingSettings();
        setupMeetingPrepControls();
        subscribeToMeetingPrepGroups();

        // Initialize subscriptions in background (non-blocking)
        ensureSubscriptionsInitialized();

    } catch (error) {
        console.error("Initialization Error:", error);
        alert("Could not load your profile. Please refresh the page and try again.");
    }
});

function normalizeUserRecord(doc) {
    if (!doc) return null;

    const rawData = typeof doc.data === 'function' ? doc.data() : doc;
    const normalizedData = { ...rawData };
    const normalizedName = getUserDisplayName({ ...normalizedData, id: doc.id });

    return {
        id: doc.id,
        ...normalizedData,
        name: normalizedName,
        role: normalizedData.role || 'member',
        email: normalizedData.email || ''
    };
}

async function fetchEditors() {
    try {
        const editorsSnapshot = await db.collection('users')
            .where('role', 'in', ['admin', 'editor'])
            .get();

        allEditors = editorsSnapshot.docs
            .map(doc => normalizeUserRecord(doc))
            .filter(Boolean);
    } catch (error) {
        console.error("Error fetching editors:", error);
        allEditors = [];
    }
}

async function fetchAllUsers() {
    try {
        const usersSnapshot = await db.collection('users').get();
        allUsers = usersSnapshot.docs
            .map(doc => normalizeUserRecord(doc))
            .filter(Boolean);

        if (currentUser && !allUsers.some(user => user.id === currentUser.uid)) {
            const fallbackUser = normalizeUserRecord({
                id: currentUser.uid,
                name: currentUserName || currentUser.displayName || (currentUser.email ? currentUser.email.split('@')[0] : 'Me'),
                email: currentUser.email || '',
                role: currentUserRole || 'writer'
            });

            if (fallbackUser) {
                allUsers.push(fallbackUser);
            }
        }

        // Refresh the board so availability shows real names once the roster loads
        renderCurrentViewEnhanced();
        updateNavCounts();
        renderPrepMemberOptions();
        renderMeetingPrepView();
    } catch (error) {
        console.error("Error fetching users:", error);
        allUsers = [];
    }
}

function setupUI() {
    document.getElementById('user-name').textContent = currentUserName;
    document.getElementById('user-role').textContent = currentUserRole;
    const avatar = document.getElementById('user-avatar');
    avatar.textContent = currentUserName.charAt(0).toUpperCase();
    avatar.style.backgroundColor = stringToColor(currentUserName);
    if (currentUserRole === 'admin') {
        document.querySelectorAll('.admin-only').forEach(el => el.style.display = 'flex');
    }
    toggleOwnerOnlySections();
}

function isOwnerUser() {
    if (!currentUser || !currentUser.email) return false;
    return OWNER_EMAILS.includes(currentUser.email.trim().toLowerCase());
}

function toggleOwnerOnlySections() {
    const showOwner = isOwnerUser();
    document.querySelectorAll('.owner-only').forEach(el => {
        const desiredDisplay = el.dataset.ownerDisplay || 'block';
        if (el.id === 'zoom-settings-panel') {
            const isOpen = el.dataset.open === 'true';
            el.style.display = showOwner && isOpen ? desiredDisplay : 'none';
        } else {
            el.style.display = showOwner ? desiredDisplay : 'none';
        }
    });
}

function initializeZoomCTA() {
    zoomElements = Array.from(document.querySelectorAll('[data-zoom-link]'));
    if (!zoomElements.length) return;

    zoomElements.forEach(el => {
        if (el.tagName.toLowerCase() !== 'a') {
            el.addEventListener('click', event => {
                event.preventDefault();
                window.open(zoomMeetingUrl, '_blank', 'noopener,noreferrer');
            });
        }
    });

    applyZoomLinkToElements();

    const updateZoomState = () => {
        const live = isWithinZoomWindow();
        zoomElements.forEach(el => {
            el.classList.toggle('zoom-live', live);
            el.setAttribute('aria-label', live ? 'Join Zoom (live now)' : 'Join Zoom (Mondays 6:30-8:30pm ET)');
            el.title = live ? 'Live now: The Catalyst Meeting' : 'Join Zoom on Mondays, 6:30-8:30pm ET';
        });
    };

    updateZoomState();
    // Update every 30 seconds to stay in sync with the live window
    setInterval(updateZoomState, 30000);
}

function applyZoomLinkToElements() {
    if (!zoomElements.length) {
        zoomElements = Array.from(document.querySelectorAll('[data-zoom-link]'));
    }

    zoomElements.forEach(el => {
        if (el.tagName.toLowerCase() === 'a') {
            el.setAttribute('href', zoomMeetingUrl);
            el.setAttribute('target', '_blank');
            el.setAttribute('rel', 'noopener noreferrer');
        }
    });

    const zoomLinkDisplay = document.getElementById('zoom-link-display');
    if (zoomLinkDisplay) {
        zoomLinkDisplay.textContent = zoomMeetingUrl;
        zoomLinkDisplay.setAttribute('href', zoomMeetingUrl);
    }

    const zoomInput = document.getElementById('zoom-link-input');
    if (zoomInput && zoomInput !== document.activeElement) {
        zoomInput.value = zoomMeetingUrl;
    }
}

function setZoomMeetingUrl(newUrl) {
    zoomMeetingUrl = (newUrl && typeof newUrl === 'string') ? newUrl : DEFAULT_ZOOM_MEETING_URL;
    applyZoomLinkToElements();
}

function isWithinZoomWindow() {
    const now = new Date();
    const isMonday = now.toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short' }) === 'Mon';
    if (!isMonday) return false;
    
    const [hourStr, minuteStr] = now
        .toLocaleString('en-US', { timeZone: 'America/New_York', hour12: false, hour: '2-digit', minute: '2-digit' })
        .split(':');
    const minutes = parseInt(hourStr, 10) * 60 + parseInt(minuteStr, 10);
    
    return minutes >= (18 * 60 + 30) && minutes < (20 * 60 + 30);
}

// ==================
//  Meeting + Zoom Owner Controls
// ==================
function setupOwnerOnlyControls() {
    toggleOwnerOnlySections();

    const zoomForm = document.getElementById('zoom-link-form');
    if (zoomForm && !zoomForm.dataset.listenerAttached) {
        zoomForm.addEventListener('submit', handleZoomLinkSave);
        zoomForm.dataset.listenerAttached = 'true';
    }

    const meetingForm = document.getElementById('meeting-form');
    if (meetingForm && !meetingForm.dataset.listenerAttached) {
        meetingForm.addEventListener('submit', handleMeetingScheduleSave);
        meetingForm.dataset.listenerAttached = 'true';
    }

    const clearMeetingBtn = document.getElementById('clear-meeting-button');
    if (clearMeetingBtn && !clearMeetingBtn.dataset.listenerAttached) {
        clearMeetingBtn.addEventListener('click', handleClearMeetingSchedule);
        clearMeetingBtn.dataset.listenerAttached = 'true';
    }

    const settingsToggle = document.getElementById('open-zoom-settings');
    const settingsPanel = document.getElementById('zoom-settings-panel');
    if (settingsToggle && settingsPanel && !settingsToggle.dataset.listenerAttached) {
        settingsToggle.addEventListener('click', () => {
            const isOpen = settingsPanel.dataset.open === 'true';
            const nextState = !isOpen;
            settingsPanel.dataset.open = nextState ? 'true' : 'false';
            settingsPanel.style.display = nextState ? (settingsPanel.dataset.ownerDisplay || 'block') : 'none';
            settingsPanel.setAttribute('aria-hidden', (!nextState).toString());
            settingsToggle.setAttribute('aria-expanded', nextState.toString());
        });
        settingsToggle.dataset.listenerAttached = 'true';
    }
}

function subscribeToMeetingSettings() {
    try {
        if (meetingSettingsUnsubscribe) {
            meetingSettingsUnsubscribe();
            meetingSettingsUnsubscribe = null;
        }

        meetingSettingsUnsubscribe = meetingSettingsDocRef.onSnapshot(snapshot => {
            const data = snapshot.exists ? snapshot.data() : {};
            const zoomLink = sanitizeZoomLink(data.zoomLink) || DEFAULT_ZOOM_MEETING_URL;
            setZoomMeetingUrl(zoomLink);

            const meetingTimestamp = data.nextMeetingTime && data.nextMeetingTime.toDate ? data.nextMeetingTime.toDate() : null;
            const meetingTimezone = data.nextMeetingTimezone || DEFAULT_MEETING_TIMEZONE;

            updateMeetingDisplay(meetingTimestamp, meetingTimezone);
            updateMeetingEditorForm(meetingTimestamp, meetingTimezone);
        }, error => {
            console.error('[MEETING] Failed to subscribe to meeting settings:', error);
            showNotification('Live meeting settings are unavailable right now.', 'error');
        });
    } catch (error) {
        console.error('[MEETING] Error while initializing meeting settings:', error);
    }
}

async function handleZoomLinkSave(event) {
    event.preventDefault();
    if (!isOwnerUser()) {
        showNotification('Only Yair can update the Zoom link.', 'error');
        return;
    }

    const input = document.getElementById('zoom-link-input');
    if (!input) return;

    const sanitizedLink = sanitizeZoomLink(input.value);
    if (!sanitizedLink) {
        showNotification('Please enter a valid https:// Zoom link.', 'error');
        return;
    }

    try {
        await meetingSettingsDocRef.set({ zoomLink: sanitizedLink }, { merge: true });
        setZoomMeetingUrl(sanitizedLink);
        showNotification('Zoom link updated for everyone.', 'success');
    } catch (error) {
        console.error('[MEETING] Failed to update Zoom link:', error);
        showNotification('Could not update the Zoom link. Please try again.', 'error');
    }
}

function sanitizeZoomLink(rawLink) {
    if (!rawLink || typeof rawLink !== 'string') return '';
    try {
        const candidate = rawLink.trim();
        const parsed = new URL(candidate);
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
            return '';
        }
        return parsed.toString();
    } catch (error) {
        return '';
    }
}

async function handleMeetingScheduleSave(event) {
    event.preventDefault();
    if (!isOwnerUser()) {
        showNotification('Only Yair can update the meeting schedule.', 'error');
        return;
    }

    const dateInput = document.getElementById('meeting-date-input');
    const timeInput = document.getElementById('meeting-time-input');
    const timezoneInput = document.getElementById('meeting-timezone-input');

    if (!dateInput || !timeInput) {
        showNotification('Meeting inputs are missing on the page.', 'error');
        return;
    }

    const dateValue = dateInput.value;
    const timeValue = timeInput.value;
    const timeZone = timezoneInput?.value || DEFAULT_MEETING_TIMEZONE;

    if (!dateValue || !timeValue) {
        showNotification('Please choose both a date and a time.', 'error');
        return;
    }

    const meetingDate = buildDateForTimezone(dateValue, timeValue, timeZone);
    if (!meetingDate || isNaN(meetingDate.getTime())) {
        showNotification('Unable to read that date/time. Please try again.', 'error');
        return;
    }

    try {
        await meetingSettingsDocRef.set({
            nextMeetingTime: firebase.firestore.Timestamp.fromDate(meetingDate),
            nextMeetingTimezone: timeZone
        }, { merge: true });

        updateMeetingDisplay(meetingDate, timeZone);
        showNotification('Next meeting updated.', 'success');
    } catch (error) {
        console.error('[MEETING] Failed to save meeting schedule:', error);
        showNotification('Could not save the meeting time. Please try again.', 'error');
    }
}

async function handleClearMeetingSchedule() {
    if (!isOwnerUser()) {
        showNotification('Only Yair can clear the meeting schedule.', 'error');
        return;
    }

    try {
        await meetingSettingsDocRef.set({
            nextMeetingTime: null,
            nextMeetingTimezone: DEFAULT_MEETING_TIMEZONE
        }, { merge: true });

        updateMeetingDisplay(null, DEFAULT_MEETING_TIMEZONE);
        updateMeetingEditorForm(null, DEFAULT_MEETING_TIMEZONE);
        showNotification('Meeting schedule cleared.', 'success');
    } catch (error) {
        console.error('[MEETING] Failed to clear meeting schedule:', error);
        showNotification('Could not clear the meeting schedule.', 'error');
    }
}

function updateMeetingDisplay(meetingDate, timeZone = DEFAULT_MEETING_TIMEZONE) {
    const summaryEl = document.getElementById('meeting-summary');
    const statusEl = document.getElementById('meeting-status');
    const countdownEl = document.getElementById('meeting-countdown');
    const timezoneEl = document.getElementById('meeting-timezone-label');
    const prepDatetimeEl = document.getElementById('meeting-prep-datetime');
    const prepCountdownEl = document.getElementById('meeting-prep-countdown');
    const prepCountdownInlineEl = document.getElementById('meeting-prep-countdown-inline');
    const prepStatusEl = document.getElementById('meeting-prep-status');
    const prepTimezoneEl = document.getElementById('meeting-prep-timezone');

    if (meetingCountdownInterval) {
        clearInterval(meetingCountdownInterval);
        meetingCountdownInterval = null;
    }

    nextMeetingTime = meetingDate && !isNaN(meetingDate?.getTime?.()) ? meetingDate : null;
    nextMeetingTimezone = timeZone || DEFAULT_MEETING_TIMEZONE;

    const friendlyTimezone = (nextMeetingTimezone || DEFAULT_MEETING_TIMEZONE).replace(/_/g, ' ');
    const countdownTargets = [countdownEl, prepCountdownEl, prepCountdownInlineEl].filter(Boolean);
    const statusTargets = [statusEl, prepStatusEl].filter(Boolean);

    if (timezoneEl) {
        timezoneEl.textContent = nextMeetingTimezone;
    }
    if (prepTimezoneEl) {
        prepTimezoneEl.textContent = `Timezone: ${friendlyTimezone}`;
    }

    if (!nextMeetingTime) {
        if (summaryEl) summaryEl.textContent = 'No meeting scheduled';
        if (prepDatetimeEl) prepDatetimeEl.textContent = 'No meeting scheduled yet.';
        statusTargets.forEach(el => el.textContent = 'Yair will set the next date.');
        countdownTargets.forEach(el => {
            el.textContent = '-- : -- : --';
            el.classList.remove('live', 'past');
        });
        return;
    }

    const meetingLabel = nextMeetingTime.toLocaleString('en-US', {
        timeZone: nextMeetingTimezone,
        weekday: 'long',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short'
    });

    if (summaryEl) summaryEl.textContent = meetingLabel;
    if (prepDatetimeEl) prepDatetimeEl.textContent = meetingLabel;

    const updateCountdown = () => {
        const now = new Date();
        const diff = nextMeetingTime.getTime() - now.getTime();

        if (diff <= 0) {
            countdownTargets.forEach(el => {
                el.textContent = 'LIVE NOW';
                el.classList.add('live');
                el.classList.remove('past');
            });
            statusTargets.forEach(el => {
                el.textContent = 'The scheduled meeting time has arrived.';
            });

            if (meetingCountdownInterval) {
                clearInterval(meetingCountdownInterval);
                meetingCountdownInterval = null;
            }
            return;
        }

        const days = Math.floor(diff / 86400000);
        const hours = Math.floor((diff % 86400000) / 3600000);
        const minutes = Math.floor((diff % 3600000) / 60000);
        const seconds = Math.floor((diff % 60000) / 1000);

        const parts = [];
        if (days > 0) parts.push(`${days}d`);
        parts.push(`${hours.toString().padStart(2, '0')}h`);
        parts.push(`${minutes.toString().padStart(2, '0')}m`);
        parts.push(`${seconds.toString().padStart(2, '0')}s`);

        const countdownText = parts.join(' ');

        countdownTargets.forEach(el => {
            el.textContent = countdownText;
            el.classList.remove('live', 'past');
        });

        statusTargets.forEach(el => {
            el.textContent = 'Countdown is live for everyone.';
        });
    };

    updateCountdown();
    meetingCountdownInterval = setInterval(updateCountdown, 1000);
}

function updateMeetingEditorForm(meetingDate, timeZone = DEFAULT_MEETING_TIMEZONE) {
    const dateInput = document.getElementById('meeting-date-input');
    const timeInput = document.getElementById('meeting-time-input');
    const timezoneInput = document.getElementById('meeting-timezone-input');

    if (timezoneInput) {
        const allowed = Array.from(timezoneInput.options || []).some(option => option.value === timeZone);
        timezoneInput.value = allowed ? timeZone : DEFAULT_MEETING_TIMEZONE;
    }

    if (meetingDate && !isNaN(meetingDate?.getTime?.())) {
        const formatted = formatDateTimeForInputs(meetingDate, timeZone);
        if (dateInput) dateInput.value = formatted.dateString;
        if (timeInput) timeInput.value = formatted.timeString;
    } else {
        if (dateInput) dateInput.value = '';
        if (timeInput) timeInput.value = '';
    }
}

function formatDateTimeForInputs(date, timeZone) {
    try {
        const formatter = new Intl.DateTimeFormat('en-CA', {
            timeZone,
            hour12: false,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });

        const parts = formatter.formatToParts(date).reduce((acc, part) => {
            if (part.type !== 'literal') {
                acc[part.type] = part.value;
            }
            return acc;
        }, {});

        return {
            dateString: `${parts.year}-${parts.month}-${parts.day}`,
            timeString: `${parts.hour}:${parts.minute}`
        };
    } catch (error) {
        console.error('[MEETING] Failed to format date for inputs:', error);
        return { dateString: '', timeString: '' };
    }
}

function buildDateForTimezone(dateValue, timeValue, timeZone = DEFAULT_MEETING_TIMEZONE) {
    try {
        const localDate = new Date(`${dateValue}T${timeValue}:00`);
        if (isNaN(localDate.getTime())) return null;

        const targetOffset = getTimeZoneOffsetMinutes(timeZone, localDate);
        const localOffset = -localDate.getTimezoneOffset();
        const offsetDiff = targetOffset - localOffset;

        return new Date(localDate.getTime() - offsetDiff * 60000);
    } catch (error) {
        console.error('[MEETING] Failed to build meeting date for timezone:', error);
        return null;
    }
}

function getTimeZoneOffsetMinutes(timeZone, date = new Date()) {
    try {
        const formatter = new Intl.DateTimeFormat('en-US', {
            timeZone,
            hour12: false,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });

        const parts = formatter.formatToParts(date).reduce((acc, part) => {
            if (part.type !== 'literal') {
                acc[part.type] = part.value;
            }
            return acc;
        }, {});

        const asUTC = Date.UTC(
            Number(parts.year),
            Number(parts.month) - 1,
            Number(parts.day),
            Number(parts.hour),
            Number(parts.minute),
            Number(parts.second)
        );

        return (asUTC - date.getTime()) / 60000;
    } catch (error) {
        console.error('[MEETING] Failed to compute timezone offset:', error);
        return -new Date().getTimezoneOffset();
    }
}

// ==================
//  Meeting Preparation
// ==================
function sanitizeArticleLink(rawLink) {
    if (!rawLink || typeof rawLink !== 'string') return '';
    try {
        const candidate = rawLink.trim();
        const parsed = new URL(candidate);
        if (!['http:', 'https:'].includes(parsed.protocol)) {
            return '';
        }
        return parsed.toString();
    } catch (error) {
        return '';
    }
}

function formatArticleLinkLabel(link) {
    if (!link) return '';
    try {
        const parsed = new URL(link);
        return parsed.hostname.replace(/^www\./, '');
    } catch (error) {
        return '';
    }
}

function formatPrepTimestamp(timestamp) {
    if (!timestamp) return '';
    const date = timestamp.toDate ? timestamp.toDate() : timestamp;
    if (!(date instanceof Date) || isNaN(date.getTime())) return '';

    return date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
    });
}

function setupMeetingPrepControls() {
    // Support both old (.team-count-option) and new (.prep-count-btn) selectors
    const teamCountButtons = document.querySelectorAll('.team-count-option, .prep-count-btn');
    teamCountButtons.forEach(button => {
        if (button.dataset.listenerAttached) return;
        button.addEventListener('click', () => {
            const count = Math.min(6, Math.max(2, parseInt(button.dataset.teamCount, 10) || 4));
            prepBuilderState.teamCount = count;
            syncTeamCountButtons();
        });
        button.dataset.listenerAttached = 'true';
    });
    syncTeamCountButtons();

    // Support old radio cards
    const assignmentCards = document.querySelectorAll('#prep-assignment-options .assignment-card');
    assignmentCards.forEach(card => {
        if (card.dataset.listenerAttached) return;
        card.addEventListener('click', () => {
            const mode = card.dataset.mode || 'random';
            prepBuilderState.mode = mode;
            syncAssignmentModeCards(mode);
        });
        card.dataset.listenerAttached = 'true';
    });

    // Support new mode buttons
    const modeButtons = document.querySelectorAll('#prep-assignment-options .prep-mode-btn');
    modeButtons.forEach(btn => {
        if (btn.dataset.listenerAttached) return;
        btn.addEventListener('click', () => {
            const mode = btn.dataset.mode || 'random';
            prepBuilderState.mode = mode;
            syncAssignmentModeCards(mode);
        });
        btn.dataset.listenerAttached = 'true';
    });
    syncAssignmentModeCards();

    const buildBtn = document.getElementById('prep-build-teams');
    if (buildBtn && !buildBtn.dataset.listenerAttached) {
        buildBtn.addEventListener('click', handlePrepBuildTeams);
        buildBtn.dataset.listenerAttached = 'true';
    }

    const resetBtn = document.getElementById('prep-builder-reset');
    if (resetBtn && !resetBtn.dataset.listenerAttached) {
        resetBtn.addEventListener('click', resetPrepBuilder);
        resetBtn.dataset.listenerAttached = 'true';
    }

    const saveBtn = document.getElementById('prep-builder-save');
    if (saveBtn && !saveBtn.dataset.listenerAttached) {
        saveBtn.addEventListener('click', handleSavePrepTeams);
        saveBtn.dataset.listenerAttached = 'true';
    }

    const loadExistingBtn = document.getElementById('prep-load-existing');
    if (loadExistingBtn && !loadExistingBtn.dataset.listenerAttached) {
        loadExistingBtn.addEventListener('click', () => loadExistingPrepTeams(false));
        loadExistingBtn.dataset.listenerAttached = 'true';
    }

    const manualBalanceBtn = document.getElementById('prep-manual-balance');
    if (manualBalanceBtn && !manualBalanceBtn.dataset.listenerAttached) {
        manualBalanceBtn.addEventListener('click', autoBalanceManualAssignments);
        manualBalanceBtn.dataset.listenerAttached = 'true';
    }

    const applyManualBtn = document.getElementById('prep-apply-manual');
    if (applyManualBtn && !applyManualBtn.dataset.listenerAttached) {
        applyManualBtn.addEventListener('click', applyManualAssignments);
        applyManualBtn.dataset.listenerAttached = 'true';
    }

    const teamColumns = document.getElementById('prep-team-columns');
    if (teamColumns && !teamColumns.dataset.listenerAttached) {
        teamColumns.addEventListener('click', (event) => {
            const removeBtn = event.target.closest('[data-remove-member]');
            if (removeBtn) {
                const memberId = removeBtn.dataset.memberId;
                const teamId = removeBtn.dataset.teamId;
                removeMemberFromTeam(memberId, teamId);
            }
        });

        teamColumns.addEventListener('change', (event) => {
            const moveSelect = event.target.closest('[data-move-member]');
            const benchAssign = event.target.closest('[data-assign-bench]');

            if (moveSelect) {
                const memberId = moveSelect.dataset.memberId;
                const fromTeamId = moveSelect.dataset.teamId;
                const toTeamId = moveSelect.value;
                moveMemberToTeam(memberId, fromTeamId, toTeamId);
            }

            if (benchAssign) {
                const memberId = benchAssign.dataset.memberId;
                const targetTeamId = benchAssign.value;
                addBenchMemberToTeam(memberId, targetTeamId);
                benchAssign.value = '';
            }
        });

        teamColumns.dataset.listenerAttached = 'true';
    }

    const groupsList = document.getElementById('prep-groups-list');
    if (groupsList && !groupsList.dataset.listenerAttached) {
        groupsList.addEventListener('click', (event) => {
            const editBtn = event.target.closest('[data-edit-group]');
            if (editBtn) {
                event.preventDefault();
                startMeetingPrepEdit(editBtn.dataset.editGroup);
            }
        });
        groupsList.dataset.listenerAttached = 'true';
    }

    updateBuilderSummary('Pick a mode to start.');
}

function getPrepRoster() {
    if (!Array.isArray(allUsers) || !allUsers.length) return [];

    return [...allUsers]
        .filter(user => user && user.id)
        .map(user => ({
            id: user.id,
            name: getUserDisplayName(user),
            role: user.role || '',
            email: user.email || ''
        }))
        .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

function getPrepRosterMap() {
    const map = new Map();
    getPrepRoster().forEach(user => {
        map.set(user.id, user);
    });
    return map;
}

function syncTeamCountButtons() {
    const safeCount = Math.min(6, Math.max(2, prepBuilderState.teamCount || 4));
    prepBuilderState.teamCount = safeCount;

    // Support both old and new button classes
    document.querySelectorAll('.team-count-option, .prep-count-btn').forEach(button => {
        const count = parseInt(button.dataset.teamCount, 10);
        button.classList.toggle('active', count === safeCount);
    });
}

function syncAssignmentModeCards(mode = prepBuilderState.mode) {
    prepBuilderState.mode = mode === 'manual' ? 'manual' : 'random';

    // Support old radio card style
    document.querySelectorAll('#prep-assignment-options .assignment-card').forEach(card => {
        const isActive = card.dataset.mode === prepBuilderState.mode;
        card.classList.toggle('active', isActive);

        const input = card.querySelector('input[type="radio"]');
        if (input) input.checked = isActive;
    });

    // Support new button style
    document.querySelectorAll('#prep-assignment-options .prep-mode-btn').forEach(btn => {
        const isActive = btn.dataset.mode === prepBuilderState.mode;
        btn.classList.toggle('active', isActive);
    });
}

function updateBuilderSummary(text) {
    const summary = document.getElementById('prep-builder-summary');
    if (summary) {
        summary.textContent = text || 'Pick a mode to start.';
    }
}

function updatePrepHeroStats() {
    const teamCountEl = document.getElementById('prep-hero-team-count');
    const linkCountEl = document.getElementById('prep-hero-link-count');
    const overviewTeamsEl = document.getElementById('prep-overview-teams');
    const overviewLinksEl = document.getElementById('prep-overview-links');

    if (!teamCountEl && !linkCountEl && !overviewTeamsEl && !overviewLinksEl) return;

    const teamCount = meetingPrepGroups.length || 0;
    const linkCount = meetingPrepGroups.filter(group => sanitizeArticleLink(group.articleLink || '')).length;

    if (teamCountEl) teamCountEl.textContent = teamCount === 0 ? '—' : teamCount;
    if (linkCountEl) linkCountEl.textContent = linkCount === 0 ? '—' : linkCount;
    if (overviewTeamsEl) overviewTeamsEl.textContent = teamCount === 0 ? '—' : teamCount;
    if (overviewLinksEl) overviewLinksEl.textContent = linkCount === 0 ? '—' : linkCount;

    updateBenchBadges();
}

function updateBenchBadges(countOverride = null) {
    const benchCount = Math.max(0, typeof countOverride === 'number'
        ? countOverride
        : (Array.isArray(prepBuilderState.benchIds) ? prepBuilderState.benchIds.length : 0));
    const benchLabel = benchCount === 1 ? 'person' : 'people';

    const benchHero = document.getElementById('prep-bench-count');
    const benchOverview = document.getElementById('prep-overview-bench');
    const benchBadge = document.getElementById('prep-bench-badge');
    const benchNote = document.getElementById('prep-bench-note');

    if (benchHero) benchHero.textContent = benchCount;
    if (benchOverview) benchOverview.textContent = benchCount;
    if (benchBadge) benchBadge.textContent = `${benchCount} ${benchLabel} on the bench`;
    if (benchNote) {
        benchNote.textContent = benchCount
            ? `${benchCount} ${benchLabel} benched for absences. Publishing will still go through.`
            : 'Bench anyone who is out; publishing will still work.';
    }
}

function renderTeamColumns(teams = []) {
    const container = document.getElementById('prep-team-columns');
    if (!container) return;

    container.innerHTML = '';
    updateBenchBadges();

    if (!teams.length) {
        const empty = document.createElement('div');
        empty.className = 'empty-state subtle';
        empty.textContent = 'Build or load teams to assign article links.';
        container.appendChild(empty);
        return;
    }

    const rosterMap = getPrepRosterMap();

    teams.forEach((team, index) => {
        const card = document.createElement('div');
        card.className = 'team-column-card';
        const teamId = team.id || `team-${index + 1}`;
        const teamLabel = team.title || `Team ${index + 1}`;
        card.dataset.teamId = teamId;

        const header = document.createElement('div');
        header.className = 'team-column-header';

        const titleInput = document.createElement('input');
        titleInput.type = 'text';
        titleInput.className = 'team-title-input';
        titleInput.placeholder = 'Team name';
        titleInput.value = teamLabel;
        titleInput.setAttribute('data-team-field', 'title');
        header.appendChild(titleInput);

        const meta = document.createElement('div');
        meta.className = 'team-column-meta';
        const members = getPrepGroupMembers(team);

        const memberMeta = document.createElement('span');
        memberMeta.className = 'meta-pill';
        memberMeta.textContent = `${members.length} ${members.length === 1 ? 'person' : 'people'}`;
        meta.appendChild(memberMeta);

        const linkMeta = document.createElement('span');
        linkMeta.className = 'meta-pill';
        linkMeta.textContent = team.articleLink ? 'Link added' : 'Link needed';
        meta.appendChild(linkMeta);

        header.appendChild(meta);
        card.appendChild(header);

        const linkInput = document.createElement('input');
        linkInput.type = 'url';
        linkInput.className = 'team-article-input';
        linkInput.placeholder = 'Paste the article link for this team';
        linkInput.value = team.articleLink || '';
        linkInput.setAttribute('data-team-field', 'articleLink');
        card.appendChild(linkInput);

        const focusInput = document.createElement('input');
        focusInput.type = 'text';
        focusInput.className = 'team-focus-input';
        focusInput.placeholder = 'Add a focus or note (optional)';
        focusInput.value = team.notes || team.focus || '';
        focusInput.setAttribute('data-team-field', 'notes');
        card.appendChild(focusInput);

        const memberLabel = document.createElement('p');
        memberLabel.className = 'prep-card-subtext';
        memberLabel.textContent = 'Members';
        card.appendChild(memberLabel);

        const membersWrap = document.createElement('div');
        membersWrap.className = 'team-column-members';

        if (!members.length) {
            const empty = document.createElement('div');
            empty.className = 'empty-state subtle';
            empty.textContent = 'No teammates assigned yet.';
            membersWrap.appendChild(empty);
        } else {
            members.forEach(member => {
                const pill = document.createElement('div');
                pill.className = 'member-pill';
                pill.dataset.memberId = member.id;

                const nameEl = document.createElement('span');
                nameEl.textContent = member.name || 'Team member';
                pill.appendChild(nameEl);

                const roleEl = document.createElement('span');
                roleEl.className = 'muted-text';
                roleEl.textContent = member.role || '';
                pill.appendChild(roleEl);

                const controls = document.createElement('div');
                controls.className = 'member-controls';

                const moveSelect = document.createElement('select');
                moveSelect.className = 'member-move-select';
                moveSelect.dataset.moveMember = 'true';
                moveSelect.dataset.memberId = member.id;
                moveSelect.dataset.teamId = teamId;

                teams.forEach((candidateTeam, idx) => {
                    const option = document.createElement('option');
                    option.value = candidateTeam.id || `team-${idx + 1}`;
                    option.textContent = candidateTeam.title || `Team ${idx + 1}`;
                    option.selected = option.value === teamId;
                    moveSelect.appendChild(option);
                });

                controls.appendChild(moveSelect);

                const removeBtn = document.createElement('button');
                removeBtn.type = 'button';
                removeBtn.className = 'clear-btn ghost member-remove';
                removeBtn.setAttribute('data-remove-member', 'true');
                removeBtn.setAttribute('data-member-id', member.id);
                removeBtn.setAttribute('data-team-id', teamId);
                removeBtn.textContent = '✕';
                controls.appendChild(removeBtn);

                pill.appendChild(controls);
                membersWrap.appendChild(pill);
            });
        }

        card.appendChild(membersWrap);
        container.appendChild(card);
    });

    if (prepBuilderState.benchIds && prepBuilderState.benchIds.length) {
        const benchCard = document.createElement('div');
        benchCard.className = 'team-column-card bench-card';

        const benchHeader = document.createElement('div');
        benchHeader.className = 'team-column-header';
        const benchTitle = document.createElement('div');
        benchTitle.className = 'team-column-meta';
        benchTitle.textContent = 'Unassigned bench';
        benchHeader.appendChild(benchTitle);
        benchCard.appendChild(benchHeader);

        const benchWrap = document.createElement('div');
        benchWrap.className = 'team-column-members';

        prepBuilderState.benchIds.forEach(memberId => {
            const rosterUser = rosterMap.get(memberId);
            const name = rosterUser?.name || rosterUser?.email || memberId;
            const role = rosterUser?.role || '';

            const pill = document.createElement('div');
            pill.className = 'member-pill';
            pill.dataset.memberId = memberId;

            const nameEl = document.createElement('span');
            nameEl.textContent = name;
            pill.appendChild(nameEl);

            const roleEl = document.createElement('span');
            roleEl.className = 'muted-text';
            roleEl.textContent = role;
            pill.appendChild(roleEl);

            const controls = document.createElement('div');
            controls.className = 'member-controls';

            const assignSelect = document.createElement('select');
            assignSelect.className = 'member-move-select';
            assignSelect.dataset.assignBench = 'true';
            assignSelect.dataset.memberId = memberId;

            const placeholder = document.createElement('option');
            placeholder.value = '';
            placeholder.textContent = 'Send to team...';
            placeholder.disabled = true;
            placeholder.selected = true;
            assignSelect.appendChild(placeholder);

            teams.forEach((candidateTeam, idx) => {
                const option = document.createElement('option');
                option.value = candidateTeam.id || `team-${idx + 1}`;
                option.textContent = candidateTeam.title || `Team ${idx + 1}`;
                assignSelect.appendChild(option);
            });

            controls.appendChild(assignSelect);
            pill.appendChild(controls);
            benchWrap.appendChild(pill);
        });

        benchCard.appendChild(benchWrap);
        container.appendChild(benchCard);
    }

    updateBenchBadges();
}

function renderManualAssignmentTable(roster, teamCount) {
    const tableBody = document.getElementById('prep-manual-table-body');
    if (!tableBody) return;

    tableBody.innerHTML = '';

    if (!Array.isArray(roster) || !roster.length) {
        const emptyRow = document.createElement('tr');
        const emptyCell = document.createElement('td');
        emptyCell.colSpan = 3;
        emptyCell.textContent = 'Team roster is still loading.';
        emptyRow.appendChild(emptyCell);
        tableBody.appendChild(emptyRow);
        return;
    }

    roster.forEach(user => {
        const row = document.createElement('tr');

        const nameCell = document.createElement('td');
        nameCell.textContent = user.name || user.email || 'Team member';
        row.appendChild(nameCell);

        const roleCell = document.createElement('td');
        roleCell.textContent = user.role || '';
        row.appendChild(roleCell);

        const teamCell = document.createElement('td');
        const select = document.createElement('select');

        for (let i = 1; i <= teamCount; i++) {
            const option = document.createElement('option');
            option.value = i;
            option.textContent = `Team ${i}`;
            select.appendChild(option);
        }

        const assignedTeam = prepManualAssignments[user.id] || 1;
        select.value = assignedTeam;
        select.addEventListener('change', () => {
            const value = Math.min(teamCount, Math.max(1, parseInt(select.value, 10) || 1));
            prepManualAssignments[user.id] = value;
        });

        teamCell.appendChild(select);
        row.appendChild(teamCell);
        tableBody.appendChild(row);
    });
}

function hydrateManualAssignmentsFromGroups(groups = []) {
    prepManualAssignments = {};
    groups.forEach((group, index) => {
        const teamNumber = index + 1;
        const members = Array.isArray(group.memberIds) ? group.memberIds : [];
        members.forEach(memberId => {
            prepManualAssignments[memberId] = teamNumber;
        });
    });
}

function seedManualAssignments(roster, teamCount) {
    const shuffled = [...roster];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    prepManualAssignments = {};
    shuffled.forEach((user, index) => {
        prepManualAssignments[user.id] = (index % teamCount) + 1;
    });
}

function ensureBenchIntegrity() {
    const assigned = new Set();
    (prepBuilderState.workspaceTeams || []).forEach(team => {
        (team.memberIds || []).forEach(id => assigned.add(id));
    });

    const seen = new Set();
    prepBuilderState.benchIds = (prepBuilderState.benchIds || []).filter(id => {
        if (assigned.has(id) || seen.has(id)) return false;
        seen.add(id);
        return true;
    });
}

function addUserToTeam(team, user) {
    if (!team || !user) return;
    if (!Array.isArray(team.memberIds)) team.memberIds = [];
    if (!Array.isArray(team.memberNames)) team.memberNames = [];
    if (team.memberIds.includes(user.id)) return;

    team.memberIds.push(user.id);
    team.memberNames.push(user.name || user.email || 'Team member');
}

function removeMemberFromTeam(memberId, fromTeamId) {
    if (currentUserRole !== 'admin') {
        showNotification('Only admins can edit prep teams.', 'error');
        return;
    }
    if (!memberId || !fromTeamId) return;

    const team = (prepBuilderState.workspaceTeams || []).find(t => t.id === fromTeamId);
    if (!team) return;

    const idx = Array.isArray(team.memberIds) ? team.memberIds.indexOf(memberId) : -1;
    if (idx !== -1) {
        team.memberIds.splice(idx, 1);
        if (Array.isArray(team.memberNames)) {
            team.memberNames.splice(idx, 1);
        }
    }

    if (!prepBuilderState.benchIds.includes(memberId)) {
        prepBuilderState.benchIds.push(memberId);
    }

    ensureBenchIntegrity();
    renderTeamColumns(prepBuilderState.workspaceTeams);
    updateBuilderSummary('Adjusted team members. Remember to save & publish.');
}

function moveMemberToTeam(memberId, fromTeamId, toTeamId) {
    if (currentUserRole !== 'admin') {
        showNotification('Only admins can edit prep teams.', 'error');
        return;
    }
    if (!memberId || !toTeamId) return;
    if (fromTeamId === toTeamId) return;

    const teams = prepBuilderState.workspaceTeams || [];
    const rosterMap = getPrepRosterMap();
    const fromTeam = teams.find(t => t.id === fromTeamId);
    const toTeam = teams.find(t => t.id === toTeamId);

    if (!toTeam) {
        showNotification('Target team not found.', 'error');
        return;
    }

    if (fromTeam) {
        const idx = Array.isArray(fromTeam.memberIds) ? fromTeam.memberIds.indexOf(memberId) : -1;
        if (idx !== -1) {
            fromTeam.memberIds.splice(idx, 1);
            if (Array.isArray(fromTeam.memberNames)) {
                fromTeam.memberNames.splice(idx, 1);
            }
        }
    }

    const user = rosterMap.get(memberId) || { id: memberId, name: memberId };
    addUserToTeam(toTeam, user);

    prepBuilderState.benchIds = (prepBuilderState.benchIds || []).filter(id => id !== memberId);
    ensureBenchIntegrity();
    renderTeamColumns(teams);
    updateBuilderSummary('Adjusted team members. Remember to save & publish.');
}

function addBenchMemberToTeam(memberId, targetTeamId) {
    if (currentUserRole !== 'admin') {
        showNotification('Only admins can edit prep teams.', 'error');
        return;
    }
    if (!memberId || !targetTeamId) return;

    const teams = prepBuilderState.workspaceTeams || [];
    const rosterMap = getPrepRosterMap();
    const targetTeam = teams.find(t => t.id === targetTeamId);
    if (!targetTeam) {
        showNotification('Target team not found.', 'error');
        return;
    }

    const user = rosterMap.get(memberId) || { id: memberId, name: memberId };
    addUserToTeam(targetTeam, user);

    prepBuilderState.benchIds = (prepBuilderState.benchIds || []).filter(id => id !== memberId);
    ensureBenchIntegrity();
    renderTeamColumns(teams);
    updateBuilderSummary('Assigned from bench. Remember to save & publish.');
}

function autoBalanceManualAssignments() {
    if (currentUserRole !== 'admin') {
        showNotification('Only admins can adjust prep teams.', 'error');
        return;
    }

    const roster = getPrepRoster();
    if (!roster.length) {
        showNotification('Team roster is still loading.', 'error');
        return;
    }

    seedManualAssignments(roster, prepBuilderState.teamCount);
    prepBuilderState.benchIds = [];
    renderManualAssignmentTable(roster, prepBuilderState.teamCount);
    updateBuilderSummary(`Balanced ${roster.length} teammates across ${prepBuilderState.teamCount} teams.`);
}

function applyManualAssignments() {
    if (currentUserRole !== 'admin') {
        showNotification('Only admins can assign teams.', 'error');
        return;
    }

    const roster = getPrepRoster();
    const teamCount = prepBuilderState.teamCount;

    if (!roster.length) {
        showNotification('Team roster is still loading.', 'error');
        return;
    }

    if (roster.length < teamCount) {
        showNotification('Choose fewer teams so each has at least one person.', 'error');
        return;
    }

    const baseTeams = prepBuilderState.workspaceTeams.length
        ? prepBuilderState.workspaceTeams
        : meetingPrepGroups;

    const teams = Array.from({ length: teamCount }, (_, index) => {
        const existing = baseTeams[index];
        return {
            id: existing?.id || `team-${index + 1}`,
            title: existing?.title || `Team ${index + 1}`,
            articleLink: existing?.articleLink || '',
            notes: existing?.notes || existing?.focus || '',
            createdAt: existing?.createdAt || null,
            memberIds: [],
            memberNames: []
        };
    });

    roster.forEach(user => {
        const chosenTeam = Math.min(teamCount, Math.max(1, parseInt(prepManualAssignments[user.id], 10) || 1)) - 1;
        teams[chosenTeam].memberIds.push(user.id);
        teams[chosenTeam].memberNames.push(user.name || user.email || 'Team member');
    });

    const emptyTeam = teams.find(team => team.memberIds.length === 0);
    if (emptyTeam) {
        showNotification('Every team needs at least one member. Adjust assignments.', 'error');
        return;
    }

    prepBuilderState.workspaceTeams = teams;
    prepBuilderState.benchIds = [];
    renderTeamColumns(teams);
    updateBuilderSummary(`Manual teams ready — ${roster.length} people across ${teamCount} teams. Add article links and Save & publish.`);
    scrollToPrepBuilder();
}

function handlePrepBuildTeams() {
    if (currentUserRole !== 'admin') {
        showNotification('Only admins can organize prep teams.', 'error');
        return;
    }

    const roster = getPrepRoster();
    const teamCount = prepBuilderState.teamCount;

    if (!roster.length) {
        showNotification('Team roster is still loading.', 'error');
        return;
    }

    if (roster.length < teamCount) {
        showNotification('Choose fewer teams so each has at least one person.', 'error');
        return;
    }

    if (prepBuilderState.mode === 'manual') {
        seedManualAssignments(roster, teamCount);
        prepBuilderState.benchIds = [];
        renderManualAssignmentTable(roster, teamCount);
        const manualSection = document.getElementById('prep-manual-assignment');
        if (manualSection) manualSection.style.display = 'block';
        prepBuilderState.workspaceTeams = [];
        renderTeamColumns([]);
        updateBuilderSummary(`Assign ${roster.length} teammates into ${teamCount} teams.`);
        scrollToPrepBuilder();
        return;
    }

    const teams = buildTeamsFromRoster(roster, teamCount);
    prepBuilderState.workspaceTeams = teams;
    prepBuilderState.benchIds = [];
    renderTeamColumns(teams);
    const manualSection = document.getElementById('prep-manual-assignment');
    if (manualSection) manualSection.style.display = 'none';
    updateBuilderSummary(`Randomly generated ${teamCount} teams with ${roster.length} people. Drop article links for each team.`);
    scrollToPrepBuilder();
}

function loadExistingPrepTeams(silent = false) {
    if (currentUserRole !== 'admin') {
        showNotification('Only admins can load prep teams.', 'error');
        return;
    }

    if (!meetingPrepGroups.length) {
        if (!silent) {
            showNotification('No prep teams to load yet.', 'error');
        }
        return;
    }

    const teams = meetingPrepGroups.map((group, index) => ({
        id: group.id,
        title: group.title || `Team ${index + 1}`,
        articleLink: group.articleLink || '',
        notes: group.notes || group.focus || '',
        createdAt: group.createdAt || null,
        memberIds: Array.isArray(group.memberIds) ? group.memberIds : [],
        memberNames: Array.isArray(group.memberNames) ? group.memberNames : []
    }));

    prepBuilderState.teamCount = Math.min(Math.max(teams.length, 2), 6);
    prepBuilderState.mode = 'manual';
    prepBuilderState.benchIds = [];
    syncTeamCountButtons();
    syncAssignmentModeCards();

    const roster = getPrepRoster();
    hydrateManualAssignmentsFromGroups(teams);
    renderManualAssignmentTable(roster, prepBuilderState.teamCount);
    const manualSection = document.getElementById('prep-manual-assignment');
    if (manualSection) manualSection.style.display = 'block';

    prepBuilderState.workspaceTeams = teams;
    renderTeamColumns(teams);
    updateBuilderSummary(`Loaded ${teams.length} live teams. Adjust and Save & publish.`);
    if (!silent) {
        scrollToPrepBuilder();
    }
}

function resetPrepBuilder() {
    prepBuilderState = {
        teamCount: 4,
        mode: 'random',
        workspaceTeams: [],
        benchIds: []
    };
    prepManualAssignments = {};
    syncTeamCountButtons();
    syncAssignmentModeCards();
    const manualSection = document.getElementById('prep-manual-assignment');
    if (manualSection) manualSection.style.display = 'none';
    renderTeamColumns([]);
    updateBuilderSummary('Pick a mode to start.');
}

function scrollToPrepBuilder() {
    const workspace = document.getElementById('prep-builder-workspace');
    if (workspace) {
        workspace.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

function buildTeamsFromRoster(roster, teamCount) {
    if (!Array.isArray(roster) || roster.length === 0) return [];

    const shuffled = [...roster];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    const baseTeams = prepBuilderState.workspaceTeams.length
        ? prepBuilderState.workspaceTeams
        : meetingPrepGroups;

    const teams = Array.from({ length: teamCount }, (_, index) => {
        const existing = baseTeams[index];
        return {
            id: existing?.id || `team-${index + 1}`,
            title: existing?.title || `Team ${index + 1}`,
            articleLink: existing?.articleLink || '',
            notes: existing?.notes || existing?.focus || '',
            createdAt: existing?.createdAt || null,
            memberIds: [],
            memberNames: []
        };
    });

    shuffled.forEach((user, index) => {
        const teamIndex = index % teamCount;
        teams[teamIndex].memberIds.push(user.id);
        teams[teamIndex].memberNames.push(user.name || user.email || 'Team member');
    });

    return teams;
}

async function handleSavePrepTeams() {
    if (currentUserRole !== 'admin') {
        showNotification('Only admins can save prep teams.', 'error');
        return;
    }

    const container = document.getElementById('prep-team-columns');
    const cards = container
        ? Array.from(container.querySelectorAll('.team-column-card')).filter(card => !card.classList.contains('bench-card'))
        : [];

    if (!cards.length) {
        showNotification('Build teams before saving.', 'error');
        return;
    }

    const teamsToSave = [];
    const issues = [];
    const rosterSize = getPrepRoster().length;
    const benchCount = Array.isArray(prepBuilderState.benchIds) ? prepBuilderState.benchIds.length : 0;
    const removedEmptyTeams = [];

    cards.forEach((card, index) => {
        const teamId = card.dataset.teamId || `team-${index + 1}`;
        const baseTeam = prepBuilderState.workspaceTeams.find(team => team.id === teamId) || prepBuilderState.workspaceTeams[index] || {};

        const titleInput = card.querySelector('.team-title-input');
        const linkInput = card.querySelector('.team-article-input');
        const focusInput = card.querySelector('.team-focus-input');

        const title = (titleInput?.value || '').trim() || `Team ${index + 1}`;
        const articleLink = sanitizeArticleLink(linkInput?.value || '');
        const notes = (focusInput?.value || '').trim();

        const memberIds = Array.isArray(baseTeam.memberIds) ? baseTeam.memberIds : [];
        const memberNames = Array.isArray(baseTeam.memberNames) ? baseTeam.memberNames : [];

        if (!memberIds.length) {
            removedEmptyTeams.push(teamId);
            return;
        }

        if (!articleLink) {
            issues.push(`Team ${index + 1} needs a valid article link.`);
        }

        teamsToSave.push({
            id: baseTeam.id || teamId,
            title,
            articleLink,
            notes,
            memberIds,
            memberNames,
            createdAt: baseTeam.createdAt || null
        });
    });

    if (!teamsToSave.length) {
        showNotification('Add at least one teammate before publishing.', 'error');
        return;
    }

    if (issues.length) {
        showNotification(issues[0], 'error');
        return;
    }

    if (removedEmptyTeams.length) {
        prepBuilderState.workspaceTeams = (prepBuilderState.workspaceTeams || []).filter(team => !removedEmptyTeams.includes(team.id));
        renderTeamColumns(prepBuilderState.workspaceTeams);
        updateBuilderSummary(`Removed ${removedEmptyTeams.length} empty team${removedEmptyTeams.length === 1 ? '' : 's'}. Bench stays for absences.`);
    }

    const actionBits = [
        `Publish ${teamsToSave.length} prep team${teamsToSave.length === 1 ? '' : 's'}`,
        removedEmptyTeams.length ? `remove ${removedEmptyTeams.length} empty team${removedEmptyTeams.length === 1 ? '' : 's'}` : null,
        benchCount > 0 ? `leave ${benchCount} on the bench for absences` : `for ${rosterSize} people`
    ];
    const confirmMessage = `${actionBits.filter(Boolean).join(' and ')}?`;

    if (!confirm(confirmMessage)) {
        return;
    }

    try {
        const collection = db.collection('meetingPrepGroups');
        const batch = db.batch();
        const timestamp = firebase.firestore.FieldValue.serverTimestamp();

        const incomingIds = teamsToSave.map(team => team.id).filter(Boolean);
        meetingPrepGroups.forEach(group => {
            if (!incomingIds.includes(group.id)) {
                batch.delete(collection.doc(group.id));
            }
        });

        teamsToSave.forEach((team, index) => {
            const docRef = team.id ? collection.doc(team.id) : collection.doc();
            batch.set(docRef, {
                title: team.title,
                articleLink: team.articleLink,
                notes: team.notes || '',
                memberIds: team.memberIds,
                memberNames: team.memberNames,
                updatedBy: currentUser?.email || currentUserName,
                updatedAt: timestamp,
                createdAt: team.createdAt || timestamp,
                meetingTime: nextMeetingTime ? firebase.firestore.Timestamp.fromDate(nextMeetingTime) : null
            });
        });

        await batch.commit();
        showNotification('Prep teams updated and published.', 'success');
        resetPrepBuilder();
    } catch (error) {
        console.error('[MEETING PREP] Failed to save team builder:', error);
        showNotification('Could not save the prep teams. Please try again.', 'error');
    }
}

function subscribeToMeetingPrepGroups() {
    try {
        if (meetingPrepUnsubscribe) {
            meetingPrepUnsubscribe();
            meetingPrepUnsubscribe = null;
        }

        meetingPrepUnsubscribe = db.collection('meetingPrepGroups')
            .orderBy('updatedAt', 'desc')
            .onSnapshot(snapshot => {
                meetingPrepGroups = snapshot.docs.map(doc => {
                    const data = doc.data() || {};
                    return {
                        id: doc.id,
                        ...data,
                        memberIds: Array.isArray(data.memberIds) ? data.memberIds : [],
                        memberNames: Array.isArray(data.memberNames) ? data.memberNames : []
                    };
                });

                renderMeetingPrepView();
                updateNavCounts();
            }, error => {
                console.error('[MEETING PREP] Failed to subscribe to teams:', error);
                showNotification('Live meeting prep teams are unavailable right now.', 'error');
            });
    } catch (error) {
        console.error('[MEETING PREP] Error setting up prep subscription:', error);
    }
}

function renderPrepMemberOptions(selectedIds = []) {
    const container = document.getElementById('prep-member-options');
    if (!container) return;

    container.innerHTML = '';

    if (!Array.isArray(allUsers) || allUsers.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'empty-state subtle';
        empty.textContent = 'Team roster loading...';
        container.appendChild(empty);
        updatePrepMemberCount(0);
        return;
    }

    const sortedUsers = [...allUsers].sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    sortedUsers.forEach(user => {
        const option = document.createElement('label');
        option.className = 'prep-member-chip';

        option.innerHTML = `
            <input type="checkbox" value="${escapeHtml(user.id)}" ${selectedIds.includes(user.id) ? 'checked' : ''} />
            <div class="prep-chip-avatar">${escapeHtml((user.name || '?').charAt(0).toUpperCase())}</div>
            <div class="prep-chip-text">
                <span class="prep-chip-name">${escapeHtml(user.name || 'Team member')}</span>
                <span class="prep-chip-role">${escapeHtml(user.role || user.email || '')}</span>
            </div>
        `;

        container.appendChild(option);
    });

    updatePrepMemberCount(selectedIds.length);
}

function updatePrepMemberCount(countOverride = null) {
    const counter = document.getElementById('prep-member-count');
    if (!counter) return;

    let selectedCount = typeof countOverride === 'number' ? countOverride : null;
    if (selectedCount === null) {
        selectedCount = document.querySelectorAll('#prep-member-options input[type="checkbox"]:checked').length;
    }

    const label = selectedCount === 1 ? 'person' : 'people';
    counter.textContent = `${selectedCount} ${label}`;
}

function renderMeetingPrepView() {
    // Render "My Team" section
    const myTeamCard = document.getElementById('prep-my-team-card');
    if (myTeamCard) {
        const myGroups = meetingPrepGroups.filter(group => {
            const memberIds = Array.isArray(group.memberIds) ? group.memberIds : [];
            return memberIds.includes(currentUser?.uid);
        });

        if (myGroups.length > 0) {
            const myGroup = myGroups[0]; // Show first assigned team
            myTeamCard.classList.add('has-team');
            myTeamCard.innerHTML = buildMyTeamContent(myGroup);
        } else {
            myTeamCard.classList.remove('has-team');
            myTeamCard.innerHTML = `
                <div class="prep-my-team-empty">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                        <circle cx="9" cy="7" r="4"></circle>
                        <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                        <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                    </svg>
                    <p>You haven't been assigned to a team yet.</p>
                    <span class="prep-hint">Check back closer to the meeting!</span>
                </div>
            `;
        }
    }

    // Update team count
    const teamCountEl = document.getElementById('prep-team-count');
    if (teamCountEl) {
        const count = meetingPrepGroups.length;
        teamCountEl.textContent = `${count} team${count === 1 ? '' : 's'}`;
    }

    // Render all teams grid
    const allContainer = document.getElementById('prep-groups-list');
    if (allContainer) {
        allContainer.innerHTML = '';

        if (!meetingPrepGroups.length) {
            const empty = document.createElement('div');
            empty.className = 'prep-empty-state';
            empty.innerHTML = '<p>No teams created yet.</p>';
            allContainer.appendChild(empty);
        } else {
            const myGroupIds = new Set(
                meetingPrepGroups
                    .filter(group => Array.isArray(group.memberIds) && group.memberIds.includes(currentUser?.uid))
                    .map(group => group.id)
            );

            meetingPrepGroups.forEach(group => {
                const isMine = myGroupIds.has(group.id);
                allContainer.appendChild(buildSimplifiedTeamCard(group, isMine));
            });
        }
    }

    if (currentUserRole === 'admin' && !prepBuilderState.workspaceTeams.length && meetingPrepGroups.length) {
        loadExistingPrepTeams(true);
    }

    updatePrepHeroStats();
}

function buildMyTeamContent(group) {
    const members = getPrepGroupMembers(group);
    const sanitizedLink = sanitizeArticleLink(group.articleLink || '');
    const notes = (group.notes || group.focus || '').trim();

    let membersHtml = members.map(member => {
        const isMe = member.id === currentUser?.uid;
        return `
            <div class="prep-member-chip ${isMe ? 'is-me' : ''}">
                <div class="prep-member-avatar" style="background: ${member.color || stringToColor(member.name || member.id)}">${(member.name || '?').charAt(0).toUpperCase()}</div>
                <span>${escapeHtml(member.name || 'Team member')}</span>
            </div>
        `;
    }).join('');

    return `
        <div class="prep-my-team-content">
            <div class="prep-my-team-header">
                <div class="prep-my-team-title">
                    <h3>${escapeHtml(group.title || 'Your Team')}</h3>
                    <span class="prep-my-badge">Your Team</span>
                </div>
                ${sanitizedLink ? `
                    <a href="${sanitizedLink}" target="_blank" rel="noopener noreferrer" class="prep-article-btn">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                            <polyline points="15 3 21 3 21 9"></polyline>
                            <line x1="10" y1="14" x2="21" y2="3"></line>
                        </svg>
                        Open Article
                    </a>
                ` : '<span class="prep-hint">No article link yet</span>'}
            </div>
            ${notes ? `<p class="prep-hint" style="margin: 8px 0;">${escapeHtml(notes)}</p>` : ''}
            <div class="prep-my-team-members">
                ${membersHtml || '<span class="prep-hint">No members assigned</span>'}
            </div>
        </div>
    `;
}

function buildSimplifiedTeamCard(group, isMyTeam = false) {
    const card = document.createElement('div');
    card.className = `prep-team-card ${isMyTeam ? 'is-my-team' : ''}`;
    card.dataset.groupId = group.id;

    const members = getPrepGroupMembers(group);
    const sanitizedLink = sanitizeArticleLink(group.articleLink || '');

    let membersHtml = members.slice(0, 6).map(member => {
        return `
            <div class="prep-team-member">
                <div class="prep-team-member-avatar" style="background: ${member.color || stringToColor(member.name || member.id)}">${(member.name || '?').charAt(0).toUpperCase()}</div>
                <span>${escapeHtml(member.name || 'Member')}</span>
            </div>
        `;
    }).join('');

    if (members.length > 6) {
        membersHtml += `<div class="prep-team-member">+${members.length - 6} more</div>`;
    }

    card.innerHTML = `
        <div class="prep-team-card-header">
            <span class="prep-team-name">${escapeHtml(group.title || 'Team')}</span>
            <span class="prep-team-member-count">${members.length} member${members.length === 1 ? '' : 's'}</span>
        </div>
        ${sanitizedLink ? `
            <a href="${sanitizedLink}" target="_blank" rel="noopener noreferrer" class="prep-team-article">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                    <polyline points="15 3 21 3 21 9"></polyline>
                    <line x1="10" y1="14" x2="21" y2="3"></line>
                </svg>
                View Article
            </a>
        ` : ''}
        <div class="prep-team-members-list">
            ${membersHtml || '<span class="prep-hint">No members</span>'}
        </div>
    `;

    return card;
}

function buildPrepGroupCard(group, { showEditButton = false, isMyTeam = false, compact = false } = {}) {
    const card = document.createElement('div');
    card.className = 'prep-group-card';
    if (isMyTeam) card.classList.add('prep-group-card--mine');
    if (compact) card.classList.add('prep-group-card--compact');
    card.dataset.groupId = group.id;

    const members = getPrepGroupMembers(group);
    const sanitizedLink = sanitizeArticleLink(group.articleLink || '');
    const linkLabel = formatArticleLinkLabel(sanitizedLink);
    const notes = (group.notes || group.focus || '').trim();
    const updatedAt = formatPrepTimestamp(group.updatedAt || group.createdAt);
    const updatedBy = group.updatedBy || '';

    const header = document.createElement('div');
    header.className = 'prep-group-header';

    const textColumn = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'prep-group-title';
    title.textContent = group.title || 'Prep Team';
    textColumn.appendChild(title);
    if (isMyTeam) {
        const badge = document.createElement('span');
        badge.className = 'my-team-badge';
        badge.textContent = 'My team';
        textColumn.appendChild(badge);
    }

    const linkEl = document.createElement(sanitizedLink ? 'a' : 'div');
    linkEl.className = 'prep-article-link';
    if (sanitizedLink) {
        linkEl.href = sanitizedLink;
        linkEl.target = '_blank';
        linkEl.rel = 'noopener noreferrer';
        linkEl.textContent = linkLabel ? `Open ${linkLabel}` : 'Open article';
    } else {
        linkEl.textContent = 'Add an article link';
        linkEl.classList.add('muted-text');
    }
    textColumn.appendChild(linkEl);

    if (updatedAt || updatedBy) {
        const meta = document.createElement('p');
        meta.className = 'muted-text';
        const metaBits = [];
        if (updatedBy) metaBits.push(`Updated by ${updatedBy.split('@')[0]}`);
        if (updatedAt) metaBits.push(updatedAt);
        meta.textContent = metaBits.join(' • ');
        textColumn.appendChild(meta);
    }

    header.appendChild(textColumn);

    if (showEditButton) {
        const editBtn = document.createElement('button');
        editBtn.className = 'clear-btn';
        editBtn.textContent = 'Edit in builder';
        editBtn.setAttribute('data-edit-group', group.id);
        header.appendChild(editBtn);
    }

    card.appendChild(header);

    const metaList = document.createElement('div');
    metaList.className = 'prep-group-meta';

    const memberCount = members.length;
    const meetingLabel = formatPrepTimestamp(group.meetingTime || nextMeetingTime);

    if (meetingLabel) {
        metaList.appendChild(createPrepMetaItem('Meeting', meetingLabel));
    }

    if (memberCount) {
        metaList.appendChild(createPrepMetaItem('Members', `${memberCount} teammate${memberCount === 1 ? '' : 's'}`));
    }

    if (linkLabel) {
        metaList.appendChild(createPrepMetaItem('Article', linkLabel));
    }

    if (metaList.childElementCount > 0) {
        card.appendChild(metaList);
    }

    if (!compact) {
        const notesEl = document.createElement('p');
        notesEl.className = 'prep-notes';
        notesEl.textContent = notes ? `Focus: ${notes}` : 'Add a focus so this breakout knows what to prep.';
        card.appendChild(notesEl);

        const membersWrap = document.createElement('div');
        membersWrap.className = 'prep-members';

        if (!members.length) {
            const empty = document.createElement('div');
            empty.className = 'empty-state subtle';
            empty.textContent = 'No teammates assigned yet.';
            membersWrap.appendChild(empty);
        } else {
            members.forEach(member => {
                const pill = document.createElement('div');
                pill.className = 'prep-member';

                const avatar = document.createElement('div');
                avatar.className = 'prep-member-avatar';
                avatar.style.background = member.color || stringToColor(member.name || member.id);
                avatar.textContent = (member.initial || (member.name || '?').charAt(0)).toUpperCase();

                const text = document.createElement('div');
                const nameEl = document.createElement('div');
                nameEl.className = 'prep-member-name';
                nameEl.textContent = member.name || 'Team member';
                text.appendChild(nameEl);

                const roleEl = document.createElement('div');
                roleEl.className = 'prep-member-role';
                roleEl.textContent = member.role || '';
                text.appendChild(roleEl);

                pill.appendChild(avatar);
                pill.appendChild(text);
                membersWrap.appendChild(pill);
            });
        }

        card.appendChild(membersWrap);
    } else {
        const notesEl = document.createElement('p');
        notesEl.className = 'prep-notes';
        notesEl.textContent = notes ? `Focus: ${notes}` : 'Your team is highlighted in the roster.';
        card.appendChild(notesEl);
    }

    return card;
}

function createPrepMetaItem(label, value) {
    const wrapper = document.createElement('div');
    wrapper.className = 'prep-meta-item';

    const labelEl = document.createElement('span');
    labelEl.className = 'prep-meta-label';
    labelEl.textContent = label;

    const valueEl = document.createElement('span');
    valueEl.className = 'prep-meta-value';
    valueEl.textContent = value;

    wrapper.appendChild(labelEl);
    wrapper.appendChild(valueEl);
    return wrapper;
}

function getPrepGroupMembers(group) {
    if (!group) return [];
    const memberIds = Array.isArray(group.memberIds) ? group.memberIds : [];
    const memberNames = Array.isArray(group.memberNames) ? group.memberNames : [];

    if (memberIds.length) {
        return memberIds.map((id, index) => {
            const roster = allUsers.find(user => user.id === id);
            const displayName = roster?.name || memberNames[index] || getUserDisplayName({ id });
            return {
                id,
                name: displayName,
                role: roster?.role || '',
                color: stringToColor(displayName || id)
            };
        });
    }

    if (memberNames.length) {
        return memberNames.map((name, index) => ({
            id: `member-${index}`,
            name,
            role: '',
            color: stringToColor(name || `member-${index}`)
        }));
    }

    return [];
}

function startMeetingPrepEdit(groupId) {
    if (currentUserRole !== 'admin') {
        showNotification('Only admins can edit prep teams.', 'error');
        return;
    }

    if (!meetingPrepGroups.length) {
        showNotification('No prep teams to edit yet.', 'error');
        return;
    }

    const teams = meetingPrepGroups.map((group, index) => ({
        id: group.id,
        title: group.title || `Team ${index + 1}`,
        articleLink: group.articleLink || '',
        notes: group.notes || group.focus || '',
        createdAt: group.createdAt || null,
        memberIds: Array.isArray(group.memberIds) ? group.memberIds : [],
        memberNames: Array.isArray(group.memberNames) ? group.memberNames : []
    }));

    prepBuilderState.mode = 'manual';
    prepBuilderState.teamCount = Math.min(Math.max(teams.length, 2), 6);
    syncTeamCountButtons();
    syncAssignmentModeCards();

    const roster = getPrepRoster();
    hydrateManualAssignmentsFromGroups(teams);
    renderManualAssignmentTable(roster, prepBuilderState.teamCount);
    const manualSection = document.getElementById('prep-manual-assignment');
    if (manualSection) manualSection.style.display = 'block';

    prepBuilderState.workspaceTeams = teams;
    renderTeamColumns(teams);
    updateBuilderSummary('Editing current teams. Update members or links, then Save & publish.');
    scrollToPrepBuilder();

    meetingPrepEditId = groupId || null;
}

function resetMeetingPrepForm() {
    meetingPrepEditId = null;
    const form = document.getElementById('meeting-prep-form');
    if (form) {
        form.reset();
    }

    const titleEl = document.getElementById('meeting-prep-form-title');
    const saveBtn = document.getElementById('meeting-prep-save');
    const cancelBtn = document.getElementById('meeting-prep-cancel');

    if (titleEl) titleEl.textContent = 'Create prep team';
    if (saveBtn) saveBtn.textContent = 'Save team';
    if (cancelBtn) cancelBtn.style.display = 'none';

    renderPrepMemberOptions();
}

async function handleMeetingPrepSubmit(event) {
    event.preventDefault();

    if (currentUserRole !== 'admin') {
        showNotification('Only admins can update prep teams.', 'error');
        return;
    }

    const titleInput = document.getElementById('prep-title-input');
    const linkInput = document.getElementById('prep-link-input');
    const notesInput = document.getElementById('prep-notes-input');
    const selectedMemberIds = Array.from(document.querySelectorAll('#prep-member-options input[type="checkbox"]:checked'))
        .map(input => input.value);

    const title = titleInput?.value.trim();
    const articleLink = sanitizeArticleLink(linkInput?.value || '');
    const notes = notesInput?.value.trim() || '';

    if (!title) {
        showNotification('Please add a team or article title.', 'error');
        return;
    }

    if (!articleLink) {
        showNotification('Add a valid article link (http/https).', 'error');
        return;
    }

    if (!selectedMemberIds.length) {
        showNotification('Pick at least one teammate.', 'error');
        return;
    }

    const members = selectedMemberIds.map(id => {
        const roster = allUsers.find(user => user.id === id);
        return {
            id,
            name: roster?.name || getUserDisplayName({ id }),
            role: roster?.role || ''
        };
    });

    const payload = {
        title,
        articleLink,
        notes,
        memberIds: members.map(m => m.id),
        memberNames: members.map(m => m.name),
        updatedBy: currentUser?.email || currentUserName,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        meetingTime: nextMeetingTime ? firebase.firestore.Timestamp.fromDate(nextMeetingTime) : null
    };

    try {
        if (meetingPrepEditId) {
            await db.collection('meetingPrepGroups').doc(meetingPrepEditId).set(payload, { merge: true });
            showNotification('Prep team updated.', 'success');
        } else {
            payload.createdAt = firebase.firestore.FieldValue.serverTimestamp();
            await db.collection('meetingPrepGroups').add(payload);
            showNotification('Prep team created.', 'success');
        }

        resetMeetingPrepForm();
    } catch (error) {
        console.error('[MEETING PREP] Failed to save team:', error);
        showNotification('Could not save the prep team. Please try again.', 'error');
    }
}

async function handleGeneratePrepTeams() {
    if (currentUserRole !== 'admin') {
        showNotification('Only admins can auto-generate prep teams.', 'error');
        return;
    }

    if (!Array.isArray(allUsers) || allUsers.length < 2) {
        showNotification('Need at least two users to build teams.', 'error');
        return;
    }

    const sizeSelect = document.getElementById('prep-group-size');
    const groupSize = Math.min(4, Math.max(2, parseInt(sizeSelect?.value, 10) || 3));

    const roster = [...allUsers]
        .filter(user => user && user.id)
        .map(user => ({
            id: user.id,
            name: getUserDisplayName(user),
            role: user.role || '',
            email: user.email || ''
        }));

    if (roster.length < 2) {
        showNotification('No valid users found to build teams.', 'error');
        return;
    }

    const groups = buildRandomPrepGroups(roster, groupSize);
    if (!groups.length) {
        showNotification('Could not generate teams. Try a different size.', 'error');
        return;
    }

    const confirmMessage = `This will replace existing prep teams with random groups of ${groupSize}. Continue?`;
    if (!confirm(confirmMessage)) return;

    try {
        const batch = db.batch();
        const prepCollection = db.collection('meetingPrepGroups');

        // Clear existing teams to avoid duplicates
        meetingPrepGroups.forEach(group => {
            const ref = prepCollection.doc(group.id);
            batch.delete(ref);
        });

        const timestamp = firebase.firestore.FieldValue.serverTimestamp();

        groups.forEach((groupMembers, index) => {
            const docRef = prepCollection.doc();
            batch.set(docRef, {
                title: `Team ${index + 1}`,
                articleLink: '',
                notes: '',
                memberIds: groupMembers.map(m => m.id),
                memberNames: groupMembers.map(m => m.name),
                updatedAt: timestamp,
                createdAt: timestamp,
                updatedBy: currentUser?.email || currentUserName,
                meetingTime: nextMeetingTime ? firebase.firestore.Timestamp.fromDate(nextMeetingTime) : null
            });
        });

        await batch.commit();
        resetMeetingPrepForm();
        showNotification('Random prep teams generated.', 'success');
    } catch (error) {
        console.error('[MEETING PREP] Failed to generate teams:', error);
        showNotification('Could not generate teams. Please try again.', 'error');
    }
}

function buildRandomPrepGroups(roster, groupSize) {
    if (!Array.isArray(roster) || roster.length === 0) return [];

    const shuffled = [...roster];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    const groups = [];
    for (let i = 0; i < shuffled.length; i += groupSize) {
        groups.push(shuffled.slice(i, i + groupSize));
    }

    // Avoid single-person groups by combining the last two groups when needed
    if (groups.length >= 2 && groups[groups.length - 1].length === 1) {
        const last = groups.pop();
        const penultimate = groups.pop();
        const combined = penultimate.concat(last);

        if (combined.length <= 4) {
            groups.push(combined);
        } else if (combined.length === 5) {
            groups.push(combined.slice(0, 3));
            groups.push(combined.slice(3));
        } else {
            // Fallback: split roughly evenly without singles
            const mid = Math.ceil(combined.length / 2);
            groups.push(combined.slice(0, mid));
            groups.push(combined.slice(mid));
        }
    }

    return groups;
}

// ==================
//  Event Listeners
// ==================
function setupNavAndListeners() {
    document.getElementById('logout-button').addEventListener('click', () => auth.signOut());

    document.querySelectorAll('.nav-item').forEach(link => {
        link.addEventListener('click', e => {
            const href = link.getAttribute('href');
            if (href && href !== '#') {
                return;
            }

            e.preventDefault();
            const view = link.id.replace('nav-', '');
            handleNavClick(view);
        });
    });

    const addProjectBtn = document.getElementById('add-project-button');
    if (addProjectBtn) {
        // Clone to remove any existing listeners
        const newBtn = addProjectBtn.cloneNode(true);
        addProjectBtn.parentNode.replaceChild(newBtn, addProjectBtn);
        // Attach fresh listener
        document.getElementById('add-project-button').addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            console.log('[BUTTON CLICK] Add project button clicked');
            openProjectModal();
        });
        console.log('[SETUP] Add project button listener attached');
    }
    document.getElementById('add-task-button').addEventListener('click', openTaskModal);

    const statusReportBtn = document.getElementById('status-report-button');
    if (statusReportBtn) {
        statusReportBtn.addEventListener('click', generateStatusReport);
    }

    // Project modal buttons - using event delegation since these are in modals
    // These will be reattached when modals open

    document.getElementById('prev-month').addEventListener('click', () => changeMonth(-1));
    document.getElementById('next-month').addEventListener('click', () => changeMonth(1));

    document.querySelectorAll('.modal-overlay').forEach(modal => {
        const newModal = modal.cloneNode(true);
        modal.parentNode.replaceChild(newModal, modal);
    });

    const editProposalBtn = document.getElementById('edit-proposal-button');
    const saveProposalBtn = document.getElementById('save-proposal-button');
    const cancelProposalBtn = document.getElementById('cancel-proposal-button');

    if (editProposalBtn) editProposalBtn.addEventListener('click', enableProposalEditing);
    if (saveProposalBtn) saveProposalBtn.addEventListener('click', handleSaveProposal);
    if (cancelProposalBtn) {
        cancelProposalBtn.addEventListener('click', () => disableProposalEditing({ revertToOriginal: true }));
    }

    const setDeadlinesBtn = document.getElementById('set-deadlines-button');
    const requestDeadlineChangeBtn = document.getElementById('request-deadline-change-button');

    if (setDeadlinesBtn) {
        setDeadlinesBtn.addEventListener('click', () => {
            // Use window.handleSetDeadlines if available (from deadlineFixes_APPLY.js)
            // Otherwise fall back to local handleSetDeadlines (from dashboardHelpers.js)
            if (typeof window.handleSetDeadlines === 'function') {
                console.log('[DEADLINES] Using window.handleSetDeadlines from deadlineFixes_APPLY.js');
                window.handleSetDeadlines();
            } else if (typeof handleSetDeadlines === 'function') {
                console.log('[DEADLINES] Using local handleSetDeadlines');
                handleSetDeadlines();
            } else {
                console.error('[DEADLINES] handleSetDeadlines function not found!');
                showNotification('Deadline function not loaded. Please refresh the page.', 'error');
            }
        });
    }
    if (requestDeadlineChangeBtn) requestDeadlineChangeBtn.addEventListener('click', handleRequestDeadlineChange);

    document.querySelectorAll('.modal-overlay').forEach(modal => {
        modal.addEventListener('click', e => {
            if (e.target === modal || e.target.classList.contains('close-button')) {
                e.preventDefault();
                e.stopPropagation();
                closeAllModals();
            }
        });

        const closeButtons = modal.querySelectorAll('.close-button');
        closeButtons.forEach(btn => {
            btn.addEventListener('click', e => {
                e.preventDefault();
                e.stopPropagation();
                closeAllModals();
            });
        });
    });

    const projectForm = document.getElementById('project-form');
    const taskForm = document.getElementById('task-form');

    if (projectForm) {
        const newProjectForm = projectForm.cloneNode(true);
        projectForm.parentNode.replaceChild(newProjectForm, projectForm);

        const freshProjectForm = document.getElementById('project-form');
        if (freshProjectForm) {
            freshProjectForm.addEventListener('submit', handleProjectFormSubmit);
            freshProjectForm.dataset.submitHandler = 'attached';
            console.log('[SETUP] Project form submit handler attached');
        } else {
            console.error('[SETUP] Fresh project form reference missing after clone');
        }

        const saveProjectBtn = document.getElementById('save-project-button');
        if (saveProjectBtn) {
            saveProjectBtn.addEventListener('click', (event) => handleProjectFormSubmit(event));
            saveProjectBtn.dataset.clickHandler = 'attached';
            console.log('[SETUP] Project save button click handler attached');
        } else {
            console.error('[SETUP] Save project button not found after cloning form');
        }
    } else {
        console.error('[SETUP] Project form not found!');
    }
    
    if (!taskForm) {
        console.error('[SETUP] Task form not found!');
    }

    ensureTaskFormSubmitListener();
    ensureGlobalModalCloseHandler();

    initializeZoomCTA();
    setupCalendarListeners();
    setupCalendarKeyboardNavigation();
}

// ==================
//  View Management
// ==================
function handleNavClick(view) {
    if (view === 'dashboard') {
        view = 'interviews';
    }
    currentView = view;
    document.querySelectorAll('.nav-item').forEach(l => {
        l.setAttribute('aria-current', 'false');
        l.classList.remove('active');
    });
    const activeLink = document.getElementById(`nav-${view}`);
    if (activeLink) {
        activeLink.classList.add('active');
        activeLink.setAttribute('aria-current', 'page');
    }

    const viewTitles = {
        'dashboard': 'Catalyst in the Capital',
        'my-assignments': 'My Assignments',
        'interviews': 'Catalyst in the Capital',
        'opeds': 'Op-Eds',
        'calendar': 'Deadlines Calendar',
        'tasks': 'Task Management',
        'meeting-prep': 'Meeting Preparation'
    };
    document.getElementById('board-title').textContent = viewTitles[view] || view;

    const addProjectBtn = document.getElementById('add-project-button');
    const addTaskBtn = document.getElementById('add-task-button');

    if (view === 'tasks') {
        addProjectBtn.style.display = 'none';
        addTaskBtn.style.display = 'inline-flex';
    } else if (view === 'meeting-prep') {
        addProjectBtn.style.display = 'none';
        addTaskBtn.style.display = 'none';
    } else {
        addProjectBtn.style.display = 'inline-flex';
        addTaskBtn.style.display = 'none';
    }

    renderCurrentViewEnhanced();
}

function renderCurrentViewEnhanced() {
    const boardView = document.getElementById('board-view');
    const tasksView = document.getElementById('tasks-view');
    const calendarView = document.getElementById('calendar-view');
    const meetingPrepView = document.getElementById('meeting-prep-view');

    if (boardView) boardView.style.display = 'none';
    if (tasksView) tasksView.style.display = 'none';
    if (calendarView) calendarView.style.display = 'none';
    if (meetingPrepView) meetingPrepView.style.display = 'none';

    if (currentView === 'calendar') {
        if (calendarView) calendarView.style.display = 'block';
        setupCalendarListeners();
        renderCalendar();
    } else if (currentView === 'tasks') {
        if (tasksView) tasksView.style.display = 'block';
        renderTasksBoard(allTasks);
    } else if (currentView === 'meeting-prep') {
        if (meetingPrepView) meetingPrepView.style.display = 'block';
        renderMeetingPrepView();
    } else {
        if (boardView) boardView.style.display = 'block';
        renderKanbanBoard(filterProjects());
    }
}

// ==================
//  Data Handling
// ==================
function updateNavCounts() {
    if (!currentUser || !currentUser.uid) {
        return;
    }

    const projectMap = new Map();

    allProjects.forEach(project => {
        if (project.authorId === currentUser.uid || project.editorId === currentUser.uid) {
            projectMap.set(project.id, project);
        }
    });

    if (currentUserRole === 'admin') {
        allProjects.forEach(project => {
            if (isAwaitingEditorAssignment(project)) {
                projectMap.set(project.id, project);
            }
        });
    }

    const myAssignmentsProjects = projectMap.size;

    const myAssignmentsTasks = allTasks.filter(t => {
        return t.creatorId === currentUser.uid || isUserAssignedToTask(t, currentUser.uid);
    }).length;

    const totalAssignments = myAssignmentsProjects + myAssignmentsTasks;

    const navLink = document.querySelector('#nav-my-assignments span');
    if (navLink) {
        navLink.textContent = `My Assignments (${totalAssignments})`;
    }

    const meetingPrepNav = document.querySelector('#nav-meeting-prep span');
    if (meetingPrepNav) {
        const assignedPrepTeams = meetingPrepGroups.filter(group => {
            const memberIds = Array.isArray(group.memberIds) ? group.memberIds : [];
            return currentUser && memberIds.includes(currentUser.uid);
        }).length;

        meetingPrepNav.textContent = assignedPrepTeams > 0
            ? `Meeting Preparation (${assignedPrepTeams})`
            : 'Meeting Preparation';
    }
}

// ==================
//  Task Management
// ==================
function openTaskModal() {
    document.getElementById('task-form').reset();
    selectedAssignees = [];

    initializeMultiSelect();

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    document.getElementById('task-deadline').value = tomorrow.toISOString().split('T')[0];

    document.getElementById('task-modal').style.display = 'flex';

    setTimeout(() => {
        document.getElementById('task-title').focus();
    }, 100);
}

async function handleTaskFormSubmit(e) {
    e.preventDefault();

    const submitButton = document.getElementById('save-task-button');
    const originalText = submitButton.textContent;

    if (!currentUser || !currentUser.uid) {
        console.error('[TASK SUBMIT] No authenticated user available');
        showNotification('Your session expired. Please sign in again before creating tasks.', 'error');
        return;
    }

    try {
        const title = document.getElementById('task-title').value.trim();
        const deadline = document.getElementById('task-deadline').value;

        const errors = [];

        if (!title || title.length < 3) {
            errors.push('Task title must be at least 3 characters long');
        }

        if (selectedAssignees.length === 0) {
            errors.push('Please select at least one person to assign this task to');
        }

        if (!deadline) {
            errors.push('Please set a deadline for this task');
        }

        if (errors.length > 0) {
            showNotification(errors.join('. '), 'error');
            return;
        }

        submitButton.disabled = true;
        submitButton.classList.add('loading');
        submitButton.textContent = 'Creating Task...';

        const description = document.getElementById('task-description').value.trim();
        const priority = document.getElementById('task-priority').value || 'medium';

        const assigneeIds = selectedAssignees.map(u => u.id);
        const assigneeNames = selectedAssignees.map(u => getUserDisplayName(u));
        const creatorName = currentUserName || currentUser.displayName || (currentUser.email ? currentUser.email.split('@')[0] : 'Unknown User');
        const primaryAssigneeId = assigneeIds[0] || null;
        const primaryAssigneeName = assigneeNames[0] || 'Assigned Member';

        const taskData = {
            title: title,
            description: description || null,
            assigneeIds: assigneeIds,
            assigneeNames: assigneeNames,
            assigneeId: primaryAssigneeId,
            assigneeName: primaryAssigneeName,
            deadline: deadline,
            priority: priority,
            creatorId: currentUser.uid,
            creatorName: creatorName,
            status: 'pending',
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            activity: [{
                text: assigneeIds.length === 1 ?
                    `created this task and assigned it to ${assigneeNames[0]}` :
                    `created this task and assigned it to ${assigneeNames.join(', ')}`,
                authorName: creatorName,
                timestamp: new Date()
            }]
        };

        const docRef = await db.collection('tasks').add(taskData);
        console.log('[TASK SUBMIT] ✅ Task created with ID:', docRef.id);

        const nowSeconds = Math.floor(Date.now() / 1000);
        const localTask = {
            id: docRef.id,
            title,
            description: description || null,
            assigneeIds,
            assigneeNames,
            assigneeId: primaryAssigneeId,
            assigneeName: primaryAssigneeName,
            deadline,
            priority,
            creatorId: currentUser.uid,
            creatorName,
            status: 'pending',
            createdAt: { seconds: nowSeconds },
            updatedAt: { seconds: nowSeconds },
            activity: [{
                text: assigneeIds.length === 1 ?
                    `created this task and assigned it to ${assigneeNames[0]}` :
                    `created this task and assigned it to ${assigneeNames.join(', ')}`,
                authorName: creatorName,
                timestamp: { seconds: nowSeconds }
            }]
        };

        allTasks = [localTask, ...allTasks.filter(t => t.id !== docRef.id)];
        renderCurrentViewEnhanced();
        updateNavCounts();

        showNotification(`Task assigned to ${assigneeNames.join(', ')} successfully!`, 'success');

        setTimeout(() => {
            closeAllModals();
        }, 1000);

        document.getElementById('task-form').reset();
        selectedAssignees = [];

    } catch (error) {
        console.error("[ERROR] Failed to create task:", error);
        showNotification(error.message || 'Failed to create task. Please try again.', 'error');
    } finally {
        submitButton.disabled = false;
        submitButton.classList.remove('loading');
        submitButton.textContent = originalText;
    }
}

function renderTasksBoard(tasks) {
    const board = document.getElementById('tasks-board');
    board.innerHTML = '';

    const columns = [
        { id: 'pending', title: 'Pending Approval', icon: '⏳', color: '#f59e0b' },
        { id: 'approved', title: 'Approved', icon: '✅', color: '#10b981' },
        { id: 'in_progress', title: 'In Progress', icon: '🔄', color: '#3b82f6' },
        { id: 'completed', title: 'Completed', icon: '🎉', color: '#8b5cf6' }
    ];

    columns.forEach((column) => {
        const columnTasks = tasks.filter(task => getTaskColumn(task) === column.id);

        const columnEl = document.createElement('div');
        columnEl.className = 'kanban-column';
        columnEl.style.setProperty('--column-accent', column.color);

        columnEl.innerHTML = `
            <div class="column-header">
                <div class="column-title">
                    <div class="column-title-main">
                        <span class="column-icon">${column.icon}</span>
                        <span class="column-title-text">${column.title}</span>
                    </div>
                    <span class="task-count">${columnTasks.length}</span>
                </div>
            </div>
            <div class="column-content">
                <div class="kanban-cards"></div>
            </div>
        `;

        const cardsContainer = columnEl.querySelector('.kanban-cards');

        if (columnTasks.length === 0) {
            const emptyState = document.createElement('div');
            emptyState.className = 'empty-column';
            emptyState.innerHTML = `
                <div class="empty-column-icon">${column.icon}</div>
                <div class="empty-column-text">No ${column.title.toLowerCase()}</div>
                <div class="empty-column-subtext">Tasks will appear here when they reach this stage</div>
            `;
            cardsContainer.appendChild(emptyState);
        } else {
            columnTasks.forEach(task => {
                cardsContainer.appendChild(createTaskCard(task));
            });
        }

        board.appendChild(columnEl);
    });
}

function getTaskColumn(task) {
    if (task.status === 'completed') return 'completed';
    if (task.status === 'rejected') return 'pending';
    if (task.status === 'approved') {
        if (task.activity && task.activity.some(a =>
            a.text.includes('started working') ||
            a.text.includes('in progress') ||
            a.text.includes('commented:')
        )) {
            return 'in_progress';
        }
        return 'approved';
    }
    return 'pending';
}

function createTaskCard(task) {
    const card = document.createElement('div');
    
    // Get column for task
    const taskColumn = getTaskColumn(task);
    let columnClass = '';
    if (taskColumn === 'completed') {
        columnClass = 'column-completed';
    } else if (taskColumn === 'in_progress') {
        columnClass = 'column-in-progress';
    } else if (taskColumn === 'approved') {
        columnClass = 'column-approved';
    } else if (taskColumn === 'pending') {
        columnClass = 'column-pending';
    }
    
    card.className = `kanban-card priority-${task.priority || 'medium'} ${columnClass}`;
    card.dataset.id = task.id;
    card.dataset.type = 'task';

    const isOverdue = new Date(task.deadline) < new Date() && task.status !== 'completed';
    const isDueSoon = !isOverdue && new Date(task.deadline) < new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);

    if (isOverdue) card.classList.add('overdue');
    if (isDueSoon) card.classList.add('due-soon');

    const deadline = new Date(task.deadline);
    const deadlineText = deadline.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

    const priorityColors = {
        urgent: '#dc2626',
        high: '#ea580c',
        medium: '#f59e0b',
        low: '#059669'
    };

    const priorityColor = priorityColors[task.priority] || priorityColors.medium;

    const assigneeNames = getTaskAssigneeNames(task);
    let displayNames = assigneeNames.join(', ');
    let multipleIndicator = '';

    if (assigneeNames.length > 2) {
        displayNames = `${assigneeNames.slice(0, 2).join(', ')} +${assigneeNames.length - 2} more`;
        multipleIndicator = `<span class="multiple-assignees-indicator">+${assigneeNames.length}</span>`;
    } else if (assigneeNames.length > 1) {
        multipleIndicator = `<span class="multiple-assignees-indicator">+${assigneeNames.length}</span>`;
    }

    card.innerHTML = `
        <h4 class="card-title">${escapeHtml(task.title)}</h4>
        <div class="card-meta">
            <div class="priority-badge ${task.priority || 'medium'}" style="background-color: ${priorityColor}; color: white;">
                ${(task.priority || 'medium').toUpperCase()}
            </div>
            <div class="status-badge ${task.status || 'pending'}">
                ${(task.status || 'pending').replace('_', ' ')}
            </div>
            ${multipleIndicator}
        </div>
        ${task.description ? `<div class="card-content-preview">${escapeHtml(task.description.substring(0, 100))}${task.description.length > 100 ? '...' : ''}</div>` : ''}
        <div class="card-footer">
            <div class="card-author">
                <div class="user-avatar" style="background-color: ${stringToColor(task.creatorName)}">
                    ${task.creatorName.charAt(0).toUpperCase()}
                </div>
                <span title="Assigned to: ${assigneeNames.join(', ')}">→ ${escapeHtml(displayNames)}</span>
            </div>
            <div class="card-deadline ${isOverdue ? 'overdue' : isDueSoon ? 'due-today' : ''}">
                ${deadlineText}
            </div>
        </div>
        <div class="priority-indicator" style="background: ${priorityColor}; color: white; padding: 2px 8px; border-radius: 8px; font-size: 10px; font-weight: 600; margin-top: 8px; text-align: center;">
            ${(task.priority || 'medium').toUpperCase()} PRIORITY
        </div>
    `;

    card.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openTaskDetailsModal(task.id);
    });

    return card;
}

function openTaskDetailsModal(taskId) {
    const task = allTasks.find(t => t.id === taskId);
    if (!task) {
        console.error('[MODAL] Task not found:', taskId);
        showNotification('Task not found. Please refresh the page.', 'error');
        return;
    }

    console.log('[MODAL OPEN] Opening task modal:', taskId);
    
    // Force close all modals first and clear any lingering states
    closeAllModals();

    // Use setTimeout to ensure closing is complete before opening new modal
    // Increased timeout to 150ms for smoother transition
    setTimeout(() => {
        currentlyViewedTaskId = taskId;

        const modal = document.getElementById('task-details-modal');
        if (!modal) {
            console.error('[MODAL] Task modal element not found');
            return;
        }

        // Ensure modal is completely reset before opening
        modal.style.display = 'none';
        modal.style.opacity = '';
        modal.style.visibility = '';
        modal.style.transition = '';
        
        // Force browser reflow to apply the reset
        void modal.offsetHeight;
        
        // Now set display to flex to show the modal
        modal.style.display = 'flex';
        
        // Another reflow to ensure display change is applied
        void modal.offsetHeight;

        refreshTaskDetailsModal(task);
        attachTaskModalListeners();

        document.body.style.overflow = 'hidden';
        const appContainer = document.getElementById('app-container');
        if (appContainer) {
            appContainer.style.filter = 'blur(4px)';
            appContainer.style.transition = 'filter 0.3s ease';
        }
        
        console.log('[MODAL OPEN] Task modal opened successfully');
    }, 150);
}

function attachTaskModalListeners() {
    console.log('[LISTENERS] Attaching task modal listeners');
    
    const addTaskCommentBtn = document.getElementById('add-task-comment-button');
    const approveTaskBtn = document.getElementById('approve-task-button');
    const rejectTaskBtn = document.getElementById('reject-task-button');
    const completeTaskBtn = document.getElementById('complete-task-button');
    const requestExtensionBtn = document.getElementById('request-extension-button');
    const deleteTaskBtn = document.getElementById('delete-task-button');

    // Remove old listeners by cloning and replacing
    if (addTaskCommentBtn) {
        const newBtn = addTaskCommentBtn.cloneNode(true);
        addTaskCommentBtn.parentNode.replaceChild(newBtn, addTaskCommentBtn);
        newBtn.addEventListener('click', handleAddTaskComment);
    }

    if (approveTaskBtn) {
        const newBtn = approveTaskBtn.cloneNode(true);
        approveTaskBtn.parentNode.replaceChild(newBtn, approveTaskBtn);
        newBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            console.log('[BUTTON CLICK] Approve task button clicked');
            updateTaskStatus('approved');
        });
        console.log('[LISTENERS] Approve task button listener attached');
    }

    if (rejectTaskBtn) {
        const newBtn = rejectTaskBtn.cloneNode(true);
        rejectTaskBtn.parentNode.replaceChild(newBtn, rejectTaskBtn);
        newBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            console.log('[BUTTON CLICK] Reject task button clicked');
            updateTaskStatus('rejected');
        });
        console.log('[LISTENERS] Reject task button listener attached');
    }

    if (completeTaskBtn) {
        const newBtn = completeTaskBtn.cloneNode(true);
        completeTaskBtn.parentNode.replaceChild(newBtn, completeTaskBtn);
        newBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            console.log('[BUTTON CLICK] Complete task button clicked');
            updateTaskStatus('completed');
        });
    }

    if (requestExtensionBtn) {
        const newBtn = requestExtensionBtn.cloneNode(true);
        requestExtensionBtn.parentNode.replaceChild(newBtn, requestExtensionBtn);
        newBtn.addEventListener('click', handleRequestExtension);
    }

    if (deleteTaskBtn) {
        const newBtn = deleteTaskBtn.cloneNode(true);
        deleteTaskBtn.parentNode.replaceChild(newBtn, deleteTaskBtn);
        newBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            console.log('[BUTTON CLICK] Delete task button clicked');
            handleDeleteTask();
        });
        console.log('[LISTENERS] Delete task button listener attached');
    }
}

function refreshTaskDetailsModal(task) {
    const titleEl = document.getElementById('task-details-title');
    const descEl = document.getElementById('task-details-description');
    const statusEl = document.getElementById('task-details-status');
    const creatorEl = document.getElementById('task-details-creator');
    const assigneeEl = document.getElementById('task-details-assignee');
    const createdEl = document.getElementById('task-details-created');
    const deadlineEl = document.getElementById('task-details-deadline');
    const priorityEl = document.getElementById('task-details-priority');

    if (!titleEl || !descEl || !statusEl || !creatorEl || !assigneeEl || !createdEl || !deadlineEl || !priorityEl) {
        console.error('[MODAL REFRESH] Required task elements not found in DOM');
        return;
    }

    titleEl.textContent = task.title;
    descEl.textContent = task.description || 'No description provided.';
    statusEl.textContent = (task.status || 'pending').replace('_', ' ').toUpperCase();
    creatorEl.textContent = task.creatorName;

    const assigneeElement = document.getElementById('task-details-assignee');
    const assigneeNames = getTaskAssigneeNames(task);

    if (assigneeNames.length > 1) {
        assigneeElement.innerHTML = assigneeNames.map(name =>
            `<span class="task-assignee-badge">${escapeHtml(name)}</span>`
        ).join(' ');
    } else {
        assigneeElement.textContent = assigneeNames[0] || 'Not assigned';
    }

    const createdDate = getTimestampValue(task.createdAt);
    const deadlineDate = new Date(task.deadline);

    document.getElementById('task-details-created').textContent = createdDate.toLocaleDateString('en-US', {
        year: 'numeric', month: 'long', day: 'numeric'
    });
    document.getElementById('task-details-deadline').textContent = deadlineDate.toLocaleDateString('en-US', {
        year: 'numeric', month: 'long', day: 'numeric'
    });
    document.getElementById('task-details-priority').textContent = (task.priority || 'medium').toUpperCase();

    const isAdmin = currentUserRole === 'admin';
    const isCreator = currentUser.uid === task.creatorId;
    const isAssignee = isUserAssignedToTask(task, currentUser.uid);

    const adminSection = document.getElementById('task-admin-approval-section');
    if (adminSection) {
        adminSection.style.display = isAdmin && task.status === 'pending' ? 'block' : 'none';
    }

    const assigneeActions = document.getElementById('task-assignee-actions');
    if (assigneeActions) {
        assigneeActions.style.display = isAssignee && task.status === 'approved' ? 'block' : 'none';
    }

    const deleteButton = document.getElementById('delete-task-button');
    if (deleteButton) {
        const canDelete = isAdmin || isCreator;
        deleteButton.style.display = canDelete ? 'block' : 'none';
        console.log('[TASK MODAL] Delete button visibility:', {
            canDelete,
            isAdmin,
            isCreator,
            display: deleteButton.style.display
        });
    } else {
        console.error('[TASK MODAL] Delete task button not found in DOM');
    }

    renderTaskActivityFeed(task.activity || []);
}

function renderTaskActivityFeed(activity) {
    const feed = document.getElementById('task-details-activity-feed');
    if (!feed) return;

    feed.innerHTML = renderActivityWithTimestamps(activity);
}

async function updateTaskStatus(newStatus) {
    if (!currentlyViewedTaskId) {
        console.error('[TASK STATUS] No task ID provided');
        showNotification('No task selected. Please try again.', 'error');
        return;
    }

    const task = allTasks.find(t => t.id === currentlyViewedTaskId);
    if (!task) {
        console.error('[TASK STATUS] Task not found:', currentlyViewedTaskId);
        showNotification('Task not found.', 'error');
        return;
    }

    // Check permissions
    const isAdmin = currentUserRole === 'admin';
    const isAssignee = isUserAssignedToTask(task, currentUser.uid);
    const isCreator = currentUser.uid === task.creatorId;

    console.log('[TASK STATUS] Permission check:', {
        taskId: currentlyViewedTaskId,
        newStatus,
        currentUserRole,
        currentUserId: currentUser.uid,
        currentUserName,
        isAdmin,
        isAssignee,
        isCreator,
        taskStatus: task.status,
        taskCreatorId: task.creatorId,
        taskAssigneeId: task.assigneeId,
        taskAssigneeIds: task.assigneeIds
    });

    // Verify admin status from database
    try {
        const userDoc = await db.collection('users').doc(currentUser.uid).get();
        const userData = userDoc.data();
        console.log('[TASK STATUS] User document from database:', userData);
        console.log('[TASK STATUS] Database role:', userData?.role);
        
        if (userData?.role !== 'admin' && !isAdmin) {
            console.error('[TASK STATUS] Role mismatch! Local:', currentUserRole, 'Database:', userData?.role);
        }
    } catch (err) {
        console.error('[TASK STATUS] Could not verify user role:', err);
    }

    // Admin can approve/reject, assignee can mark complete
    if (newStatus === 'approved' || newStatus === 'rejected') {
        if (!isAdmin) {
            console.error('[TASK STATUS] Permission denied: User is not admin');
            showNotification('Only admins can approve or reject tasks.', 'error');
            return;
        }
    } else if (newStatus === 'completed') {
        if (!isAssignee && !isAdmin) {
            console.error('[TASK STATUS] Permission denied: User is not assignee or admin');
            showNotification('Only assigned team members can mark tasks as complete.', 'error');
            return;
        }
    }

    try {
        console.log('[TASK STATUS] Updating status to:', newStatus);
        console.log('[TASK STATUS] Current user:', currentUser.uid);
        console.log('[TASK STATUS] Task document ID:', currentlyViewedTaskId);
        
        const updates = {
            status: newStatus,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        if (newStatus === 'completed') {
            updates.completedAt = firebase.firestore.FieldValue.serverTimestamp();
        }

        const activityEntry = {
            text: `marked task as ${newStatus.replace('_', ' ')}`,
            authorName: currentUserName,
            timestamp: new Date()
        };

        console.log('[TASK STATUS] About to update with:', updates);
        console.log('[TASK STATUS] Activity entry:', activityEntry);

        await db.collection('tasks').doc(currentlyViewedTaskId).update({
            ...updates,
            activity: firebase.firestore.FieldValue.arrayUnion(activityEntry)
        });

        showNotification(`Task ${newStatus.replace('_', ' ')} successfully!`, 'success');
        console.log('[TASK STATUS] Status updated successfully');

    } catch (error) {
        console.error(`[TASK STATUS ERROR] Failed to update task status:`, error);
        console.error('[TASK STATUS ERROR] Error code:', error.code);
        console.error('[TASK STATUS ERROR] Error message:', error.message);
        console.error('[TASK STATUS ERROR] Error stack:', error.stack);
        
        let errorMessage = 'Failed to update task. ';
        if (error.code === 'permission-denied') {
            errorMessage += 'Permission denied. Please verify: 1) Your user role is "admin" in Firestore, 2) Security rules allow admin updates, 3) You are logged in correctly.';
            console.error('[FIRESTORE RULES] Permission denied! Check:');
            console.error('1. Is your role in Firestore set to "admin"?');
            console.error('2. Are the security rules published?');
            console.error('3. Try logging out and back in.');
        } else if (error.code === 'not-found') {
            errorMessage += 'Task not found in database.';
        } else if (error.code === 'unavailable') {
            errorMessage += 'Service temporarily unavailable. Please try again.';
        } else {
            errorMessage += `Error: ${error.message || 'Unknown error'}`;
        }

        showNotification(errorMessage, 'error');
    }
}

async function handleAddTaskComment() {
    const commentInput = document.getElementById('task-comment-input');
    if (!commentInput || !currentlyViewedTaskId) return;

    const comment = commentInput.value.trim();
    if (!comment) {
        showNotification('Please enter a comment.', 'error');
        return;
    }

    try {
        await db.collection('tasks').doc(currentlyViewedTaskId).update({
            activity: firebase.firestore.FieldValue.arrayUnion({
                text: `commented: "${comment}"`,
                authorName: currentUserName,
                timestamp: new Date()
            })
        });

        commentInput.value = '';
        showNotification('Comment added successfully!', 'success');

    } catch (error) {
        console.error("[ERROR] Failed to add comment:", error);
        showNotification('Failed to add comment. Please try again.', 'error');
    }
}

async function handleRequestExtension() {
    if (!currentlyViewedTaskId) return;

    const newDate = prompt('Enter new deadline (YYYY-MM-DD format):');
    if (!newDate || !isValidDate(newDate)) {
        showNotification('Please enter a valid date in YYYY-MM-DD format.', 'error');
        return;
    }

    const reason = prompt('Please provide a reason for the extension:');
    if (!reason || !reason.trim()) {
        showNotification('Please provide a reason for the extension.', 'error');
        return;
    }

    try {
        await db.collection('tasks').doc(currentlyViewedTaskId).update({
            extensionRequest: {
                requestedBy: currentUserName,
                requestedDate: newDate,
                reason: reason.trim(),
                status: 'pending',
                requestedAt: firebase.firestore.FieldValue.serverTimestamp()
            },
            activity: firebase.firestore.FieldValue.arrayUnion({
                text: `requested deadline extension to ${new Date(newDate).toLocaleDateString()}. Reason: ${reason.trim()}`,
                authorName: currentUserName,
                timestamp: new Date()
            })
        });

        showNotification('Extension request submitted successfully!', 'success');

    } catch (error) {
        console.error("[ERROR] Failed to request extension:", error);
        showNotification('Failed to submit extension request. Please try again.', 'error');
    }
}

async function handleDeleteTask() {
    if (!currentlyViewedTaskId) {
        console.error('[DELETE] No task ID provided');
        showNotification('No task selected for deletion.', 'error');
        return;
    }

    const task = allTasks.find(t => t.id === currentlyViewedTaskId);
    if (!task) {
        console.error('[DELETE] Task not found:', currentlyViewedTaskId);
        showNotification('Task not found.', 'error');
        return;
    }

    const isAdmin = currentUserRole === 'admin';
    const isCreator = currentUser.uid === task.creatorId;

    console.log('[DELETE TASK] Permissions check:', {
        currentUserRole,
        isAdmin,
        isCreator,
        taskCreatorId: task.creatorId,
        currentUserId: currentUser.uid
    });

    if (!isAdmin && !isCreator) {
        showNotification('You can only delete tasks you created.', 'error');
        return;
    }

    const confirmMessage = `Are you sure you want to permanently delete "${task.title}"?\n\nThis action cannot be undone and will remove all associated data.`;
    
    if (confirm(confirmMessage)) {
        try {
            console.log('[DELETE] Deleting task:', currentlyViewedTaskId);
            await db.collection('tasks').doc(currentlyViewedTaskId).delete();
            showNotification('Task deleted successfully!', 'success');
            console.log('[DELETE] Task deleted successfully');
            
            // Close modal after a short delay
            setTimeout(() => {
                closeAllModals();
            }, 500);
        } catch (error) {
            console.error('[DELETE ERROR] Failed to delete task:', error);
            let errorMessage = 'Failed to delete task. ';
            
            if (error.code === 'permission-denied') {
                errorMessage += 'You do not have permission to delete this task.';
            } else if (error.code === 'not-found') {
                errorMessage += 'Task not found.';
            } else {
                errorMessage += 'Please try again or contact support.';
            }
            
            showNotification(errorMessage, 'error');
        }
    }
}

// ==================
//  Projects
// ==================
function openProjectModal() {
    console.log('[OPEN MODAL] Opening project modal...');
    
    // Reset form
    const form = document.getElementById('project-form');
    if (form) {
        form.reset();
        console.log('[OPEN MODAL] Form reset');
    } else {
        console.error('[OPEN MODAL] Form not found!');
    }
    
    // Set modal title
    const modalTitle = document.getElementById('modal-title');
    if (modalTitle) {
        modalTitle.textContent = 'Propose New Article';
    }
    
    // Set default project type based on current view
    const projectTypeSelect = document.getElementById('project-type');
    if (projectTypeSelect) {
        if (currentView === 'interviews' || currentView === 'dashboard') {
            projectTypeSelect.value = 'Interview';
        } else if (currentView === 'opeds') {
            projectTypeSelect.value = 'Op-Ed';
        }
    }
    
    // Show modal
    const modal = document.getElementById('project-modal');
    if (modal) {
        modal.style.display = 'flex';
        console.log('[OPEN MODAL] Modal display set to flex');
        
        // Apply blur and disable scrolling
        document.body.style.overflow = 'hidden';
        const appContainer = document.getElementById('app-container');
        if (appContainer) {
            appContainer.style.filter = 'blur(4px)';
            appContainer.style.transition = 'filter 0.3s ease';
        }
        
        // Focus on title field after a short delay
        setTimeout(() => {
            const titleInput = document.getElementById('project-title');
            if (titleInput) {
                titleInput.focus();
                console.log('[OPEN MODAL] Title input focused');
            }
        }, 100);
        
        console.log('[OPEN MODAL] ✅ Modal opened successfully');
    } else {
        console.error('[OPEN MODAL] Modal element not found!');
    }
}

if (typeof window !== 'undefined') {
    window.openProjectModal = openProjectModal;
}

function openDetailsModal(projectId) {
    const project = allProjects.find(p => p.id === projectId);
    if (!project) {
        console.error('[MODAL] Project not found:', projectId);
        showNotification('Project not found. Please refresh the page.', 'error');
        return;
    }

    console.log('[MODAL OPEN] Opening project modal:', projectId);
    
    // Force close all modals first and clear any lingering states
    closeAllModals();
    
    // Use setTimeout to ensure closing is complete before opening new modal
    // Increased timeout to 150ms for smoother transition
    setTimeout(() => {
        // Set project ID in both local and window scope for maximum compatibility
        currentlyViewedProjectId = projectId;
        window.currentlyViewedProjectId = projectId;
        console.log('[MODAL OPEN] Set currentlyViewedProjectId:', projectId);
        console.log('[MODAL OPEN] Set window.currentlyViewedProjectId:', projectId);

        const modal = document.getElementById('details-modal');
        if (!modal) {
            console.error('[MODAL] Modal element not found');
            return;
        }
        
        // Store project ID in modal dataset for reliable access
        modal.dataset.projectId = projectId;
        console.log('[MODAL OPEN] Stored project ID in modal dataset:', projectId);

        // Ensure modal is completely reset before opening
        modal.style.display = 'none';
        modal.style.opacity = '';
        modal.style.visibility = '';
        modal.style.transition = '';
        
        // Force browser reflow to apply the reset
        void modal.offsetHeight;
        
        // Now set display to flex to show the modal
        modal.style.display = 'flex';
        
        // Another reflow to ensure display change is applied
        void modal.offsetHeight;

        refreshDetailsModal(project);
        attachProjectModalListeners();

        document.body.style.overflow = 'hidden';
        const appContainer = document.getElementById('app-container');
        if (appContainer) {
            appContainer.style.filter = 'blur(4px)';
            appContainer.style.transition = 'filter 0.3s ease';
        }
        
        console.log('[MODAL OPEN] Project modal opened successfully');
    }, 150);
}

function attachProjectModalListeners() {
    console.log('[LISTENERS] Attaching project modal listeners');
    
    const addCommentBtn = document.getElementById('add-comment-button');
    const assignEditorBtn = document.getElementById('assign-editor-button');
    const deleteProjectBtn = document.getElementById('delete-project-button');
    const approveBtn = document.getElementById('approve-button');
    const rejectBtn = document.getElementById('reject-button');

    // Remove old listeners by cloning and replacing
    if (addCommentBtn) {
        const newBtn = addCommentBtn.cloneNode(true);
        addCommentBtn.parentNode.replaceChild(newBtn, addCommentBtn);
        newBtn.addEventListener('click', handleAddComment);
    }

    if (assignEditorBtn) {
        const newBtn = assignEditorBtn.cloneNode(true);
        assignEditorBtn.parentNode.replaceChild(newBtn, assignEditorBtn);
        newBtn.addEventListener('click', handleAssignEditor);
    }

    if (deleteProjectBtn) {
        const newBtn = deleteProjectBtn.cloneNode(true);
        deleteProjectBtn.parentNode.replaceChild(newBtn, deleteProjectBtn);
        newBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            console.log('[BUTTON CLICK] Delete project button clicked');
            handleDeleteProject();
        });
        console.log('[LISTENERS] Delete project button listener attached');
    }

    if (approveBtn) {
        const newBtn = approveBtn.cloneNode(true);
        approveBtn.parentNode.replaceChild(newBtn, approveBtn);
        newBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            console.log('[BUTTON CLICK] Approve button clicked');
            approveProposal(currentlyViewedProjectId);
        });
        console.log('[LISTENERS] Approve button listener attached');
    }

    if (rejectBtn) {
        const newBtn = rejectBtn.cloneNode(true);
        rejectBtn.parentNode.replaceChild(newBtn, rejectBtn);
        newBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            console.log('[BUTTON CLICK] Reject button clicked');
            updateProposalStatus('rejected');
        });
        console.log('[LISTENERS] Reject button listener attached');
    }

    const setDeadlinesBtn = document.getElementById('set-deadlines-button');
    if (setDeadlinesBtn) {
        const newBtn = setDeadlinesBtn.cloneNode(true);
        setDeadlinesBtn.parentNode.replaceChild(newBtn, setDeadlinesBtn);
        newBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            console.log('[BUTTON CLICK] Set deadlines button clicked');
            handleSetDeadlines();
        });
        console.log('[LISTENERS] Set deadlines button listener attached');
    }

    const requestDeadlineBtn = document.getElementById('request-deadline-change-button');
    if (requestDeadlineBtn) {
        const newBtn = requestDeadlineBtn.cloneNode(true);
        requestDeadlineBtn.parentNode.replaceChild(newBtn, requestDeadlineBtn);
        newBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            console.log('[BUTTON CLICK] Request deadline change button clicked');
            handleRequestDeadlineChange();
        });
        console.log('[LISTENERS] Request deadline change listener attached');
    }

    // Attach edit button listeners for proposal editing
    if (typeof window.attachEditListeners === 'function') {
        window.attachEditListeners();
    }
}

function refreshDetailsModal(project) {
    const titleEl = document.getElementById('details-title');
    const authorEl = document.getElementById('details-author');
    const editorEl = document.getElementById('details-editor');
    const statusEl = document.getElementById('details-status');
    const deadlineEl = document.getElementById('details-publication-deadline');
    const proposalEl = document.getElementById('details-proposal');

    if (!titleEl || !authorEl || !editorEl || !statusEl || !deadlineEl || !proposalEl) {
        console.error('[MODAL REFRESH] Required elements not found in DOM');
        return;
    }

    const isAuthor = currentUser.uid === project.authorId;
    const isEditor = currentUser.uid === project.editorId;
    const isAdmin = currentUserRole === 'admin';

    titleEl.textContent = project.title;
    authorEl.textContent = project.authorName;
    editorEl.textContent = project.editorName || 'Not Assigned';

    const state = resolveProjectState(project, currentView, currentUser);
    statusEl.textContent = state.statusText;

    const finalDeadline = project.deadlines ? project.deadlines.publication : project.deadline;
    if (finalDeadline) {
        document.getElementById('details-publication-deadline').textContent =
            new Date(finalDeadline + 'T00:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    } else {
        document.getElementById('details-publication-deadline').textContent = 'Not set';
    }

    // Ensure proposal element is in paragraph mode (not textarea)
    let proposalElement = document.getElementById('details-proposal');
    const textareaElement = document.getElementById('proposal-edit-textarea');

    // If in edit mode, convert back to paragraph first
    if (textareaElement) {
        const paragraph = document.createElement('p');
        paragraph.id = 'details-proposal';
        paragraph.textContent = project.proposal || 'No proposal provided.';
        textareaElement.replaceWith(paragraph);
        proposalElement = paragraph;

        // Hide save/cancel buttons, show edit button
        const saveBtn = document.getElementById('save-proposal-button');
        const cancelBtn = document.getElementById('cancel-proposal-button');
        const editBtn = document.getElementById('edit-proposal-button');
        if (saveBtn) saveBtn.style.display = 'none';
        if (cancelBtn) cancelBtn.style.display = 'none';
        if (editBtn) editBtn.style.display = 'inline-block';
    } else if (proposalElement) {
        proposalElement.textContent = project.proposal || 'No proposal provided.';
    }

    const canEditProposal = isAuthor || isAdmin;
    const editBtn = document.getElementById('edit-proposal-button');
    if (editBtn) editBtn.style.display = canEditProposal ? 'inline-block' : 'none';

    const approvalSection = document.getElementById('admin-approval-section');
    if (approvalSection) {
        approvalSection.style.display = isAdmin && project.proposalStatus === 'pending' ? 'block' : 'none';
    }

    // Allow admins to assign/reassign editors at any time
    const assignSection = document.getElementById('assign-editor-section');
    if (assignSection) {
        assignSection.style.display = isAdmin ? 'flex' : 'none';
        
        // Update button text based on whether editor is already assigned
        const assignButton = document.getElementById('assign-editor-button');
        if (assignButton) {
            if (project.editorId) {
                assignButton.innerHTML = `
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink: 0;">
                        <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path>
                    </svg>
                    Reassign Editor
                `;
            } else {
                assignButton.innerHTML = `
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink: 0;">
                        <circle cx="12" cy="12" r="10"></circle>
                        <line x1="12" y1="8" x2="12" y2="16"></line>
                        <line x1="8" y1="12" x2="16" y2="12"></line>
                    </svg>
                    Assign Editor
                `;
            }
        }
    }

    populateEditorDropdown(project.editorId);
    renderTimeline(project, isAuthor, isEditor, isAdmin);
    renderDeadlines(project, isAuthor, isEditor, isAdmin);
    renderDeadlineRequestSection(project, isAuthor, isAdmin);
    renderActivityFeed(project.activity || []);

    const deleteButton = document.getElementById('delete-project-button');
    if (deleteButton) {
        const canDelete = isAuthor || isAdmin;
        deleteButton.style.display = canDelete ? 'block' : 'none';
        console.log('[MODAL] Delete button visibility:', {
            canDelete,
            isAuthor,
            isAdmin,
            display: deleteButton.style.display
        });
    } else {
        console.error('[MODAL] Delete project button not found in DOM');
    }
}

function renderTimeline(project, isAuthor, isEditor, isAdmin) {
    const timelineContainer = document.getElementById('details-timeline');
    if (!timelineContainer) {
        console.error('[TIMELINE] Timeline container not found');
        return;
    }
    
    timelineContainer.innerHTML = '';
    const timeline = project.timeline || {};
    
    console.log('[TIMELINE] Rendering timeline for project:', {
        projectId: project.id,
        isAuthor,
        isEditor,
        isAdmin,
        timeline
    });

    const orderedTasks = [
        "Topic Proposal Complete",
        "Interview Scheduled",
        "Interview Complete",
        "Article Writing Complete",
        "Review In Progress",
        "Review Complete",
        "Suggestions Reviewed"
    ];

    orderedTasks.forEach(task => {
        if (project.type === 'Op-Ed' && (task === "Interview Scheduled" || task === "Interview Complete")) {
            return;
        }

        let canEditTask = false;
        const authorTasks = ["Interview Scheduled", "Interview Complete", "Article Writing Complete", "Suggestions Reviewed"];
        const editorTasks = ["Review In Progress", "Review Complete"];

        // Allow admins, authors for their tasks, and editors for their tasks
        if (isAdmin) {
            canEditTask = true;
        } else if (isAuthor && authorTasks.includes(task)) {
            canEditTask = true;
        } else if (isEditor && editorTasks.includes(task)) {
            canEditTask = true;
        }

        // Topic Proposal Complete should never be editable (set by system)
        if (task === "Topic Proposal Complete") {
            canEditTask = false;
        }

        const completed = timeline[task] || false;
        const taskEl = document.createElement('div');
        taskEl.className = 'task';
        const taskId = `task-${project.id}-${task.replace(/\s+/g, '-')}`;
        
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = taskId;
        checkbox.checked = completed;
        checkbox.disabled = !canEditTask;
        
        const label = document.createElement('label');
        label.htmlFor = taskId;
        label.textContent = task;
        
        taskEl.appendChild(checkbox);
        taskEl.appendChild(label);

        if (canEditTask) {
            checkbox.addEventListener('change', async (e) => {
                const isChecked = e.target.checked;
                const previousValue = !isChecked; // Store the previous value
                
                console.log('========================================');
                console.log('[TIMELINE CHECKBOX] User clicked checkbox!');
                console.log('[TIMELINE CHECKBOX] Task:', task);
                console.log('[TIMELINE CHECKBOX] New value:', isChecked);
                console.log('[TIMELINE CHECKBOX] Previous value:', previousValue);
                console.log('[TIMELINE CHECKBOX] Project ID:', project.id);
                console.log('[TIMELINE CHECKBOX] User:', currentUserName);
                console.log('[TIMELINE CHECKBOX] Can edit:', canEditTask);
                console.log('[TIMELINE CHECKBOX] Firebase DB available:', !!db);
                console.log('========================================');
                
                // Disable checkbox while processing
                checkbox.disabled = true;
                const checkboxLabel = checkbox.nextElementSibling;
                if (checkboxLabel) {
                    checkboxLabel.style.opacity = '0.5';
                }
                
                try {
                    console.log('[TIMELINE CHECKBOX] Calling handleTaskCompletion...');
                    await handleTaskCompletion(project.id, task, isChecked, db, currentUserName);
                    console.log('[TIMELINE CHECKBOX] ✅ SUCCESS! Task completion handled');
                    
                    // Re-enable after success
                    checkbox.disabled = false;
                    if (checkboxLabel) {
                        checkboxLabel.style.opacity = '1';
                    }
                } catch (error) {
                    console.error('========================================');
                    console.error('[TIMELINE CHECKBOX] ❌ FAILED!');
                    console.error('[TIMELINE CHECKBOX] Error:', error);
                    console.error('[TIMELINE CHECKBOX] Error code:', error?.code);
                    console.error('[TIMELINE CHECKBOX] Error message:', error?.message);
                    console.error('========================================');
                    
                    // Revert checkbox on error
                    e.target.checked = previousValue;
                    checkbox.disabled = false;
                    if (checkboxLabel) {
                        checkboxLabel.style.opacity = '1';
                    }
                    // Error notification already shown in handleTaskCompletion
                }
            });
        }

        timelineContainer.appendChild(taskEl);
    });
}

function renderDeadlines(project, isAuthor, isEditor, isAdmin) {
    const deadlinesList = document.getElementById('details-deadlines-list');
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
        if (project.type === 'Op-Ed' && (field.key === 'contact' || field.key === 'interview')) {
            return;
        }

        const value = deadlines[field.key] || '';
        const deadlineItem = document.createElement('div');
        deadlineItem.className = 'deadline-item';
        deadlineItem.innerHTML = `
            <label for="deadline-${field.key}">${field.label}</label>
            <input type="date" id="deadline-${field.key}" value="${value}" ${!isAdmin ? 'disabled' : ''}>
        `;
        deadlinesList.appendChild(deadlineItem);
    });

    const setButton = document.getElementById('set-deadlines-button');
    if (setButton) {
        setButton.style.display = isAdmin ? 'block' : 'none';
    }

    const requestButton = document.getElementById('request-deadline-change-button');
    if (requestButton) {
        const hasRequest = project.deadlineRequest || project.deadlineChangeRequest;
        const isPending = hasRequest && hasRequest.status === 'pending';
        requestButton.style.display = (isAuthor || isEditor) && !isPending ? 'inline-block' : 'none';
    }
}

function renderDeadlineRequestSection(project, isAuthor, isAdmin) {
    const deadlineSection = document.getElementById('deadline-request-section');
    if (!deadlineSection) return;

    const hasRequest = project.deadlineRequest || project.deadlineChangeRequest;

    if (hasRequest) {
        const request = project.deadlineRequest || project.deadlineChangeRequest;

        if (request.status === 'pending') {
            let requestHTML = `
                <h4>Pending Deadline Request</h4>
                <p><strong>Requested by:</strong> ${request.requestedBy}</p>
                <p><strong>Reason:</strong> ${request.reason}</p>
            `;

            if (project.deadlineRequest) {
                const requestDate = new Date(request.requestedDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
                requestHTML += `<p><strong>New deadline:</strong> ${requestDate}</p>`;
            } else if (project.deadlineChangeRequest) {
                requestHTML += `<p><strong>Requested changes:</strong> ${Object.keys(request.requestedDeadlines || {}).join(', ')}</p>`;
            }

            if (isAdmin) {
                requestHTML += `
                    <div class="button-group" style="margin-top: 12px;">
                        <button onclick="handleApproveDeadlineRequest()" class="btn-success">Approve</button>
                        <button onclick="handleRejectDeadlineRequest()" class="btn-danger">Reject</button>
                    </div>
                `;
            } else {
                requestHTML += '<p style="font-style: italic; color: var(--warning-color);">Awaiting admin approval...</p>';
            }

            deadlineSection.innerHTML = requestHTML;
            deadlineSection.style.display = 'block';
        } else {
            deadlineSection.style.display = 'none';
        }
    } else {
        deadlineSection.style.display = 'none';
    }
}

function populateEditorDropdown(currentEditorId) {
    const dropdown = document.getElementById('editor-dropdown');
    if (!dropdown) return;

    dropdown.innerHTML = '<option value="">Assign an Editor</option>';
    allEditors.forEach(editor => {
        const option = document.createElement('option');
        option.value = editor.id;
        option.textContent = editor.name;
        if (editor.id === currentEditorId) option.selected = true;
        dropdown.appendChild(option);
    });
}

function renderActivityFeed(activity) {
    const activityFeed = document.getElementById('details-activity-feed');
    if (!activityFeed) return;

    if (!activity || !Array.isArray(activity)) {
        activityFeed.innerHTML = '<p>No activity yet.</p>';
        return;
    }

    activityFeed.innerHTML = renderActivityWithTimestamps(activity);
}

async function handleProjectFormSubmit(e) {
    if (e) {
        if (typeof e.preventDefault === 'function') e.preventDefault();
        if (typeof e.stopPropagation === 'function') e.stopPropagation();
    }
    
    console.log('========================================');
    console.log('[PROJECT SUBMIT] 🚀 FORM SUBMISSION STARTED');
    if (e) {
        console.log('[PROJECT SUBMIT] Event:', e);
        console.log('[PROJECT SUBMIT] Event type:', e.type);
    } else {
        console.log('[PROJECT SUBMIT] Event: none (manual invoke)');
    }
    console.log('[PROJECT SUBMIT] Timestamp:', new Date().toISOString());
    console.log('========================================');

    const submitButton = document.getElementById('save-project-button');
    if (!submitButton) {
        console.error('[PROJECT SUBMIT] Submit button not found!');
        showNotification('Form error. Please refresh and try again.', 'error');
        return;
    }

    if (submitButton.dataset.submitting === 'true') {
        console.warn('[PROJECT SUBMIT] Duplicate submission prevented');
        return;
    }

    const originalText = submitButton.textContent;

    // Validate required fields before processing
    const titleInput = document.getElementById('project-title');
    const typeInput = document.getElementById('project-type');
    const proposalInput = document.getElementById('project-proposal');
    const deadlineInput = document.getElementById('project-deadline');

    if (!titleInput || !typeInput || !proposalInput || !deadlineInput) {
        console.error('[PROJECT SUBMIT] Required form fields missing!');
        showNotification('Form error. Please refresh the page.', 'error');
        return;
    }

    const title = titleInput.value.trim();
    const type = typeInput.value;
    const proposal = proposalInput.value.trim();
    const deadline = deadlineInput.value;

    console.log('[PROJECT SUBMIT] Form values:', { title, type, proposal: proposal.substring(0, 50), deadline });

    // Validation
    if (!title || title.length < 3) {
        showNotification('Please enter a title with at least 3 characters.', 'error');
        titleInput.focus();
        return;
    }

    if (!type) {
        showNotification('Please select a project type.', 'error');
        typeInput.focus();
        return;
    }

    if (!deadline) {
        showNotification('Please set a publication deadline.', 'error');
        deadlineInput.focus();
        return;
    }

    // Validate deadline is in the future
    const deadlineDate = new Date(deadline);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    if (deadlineDate < today) {
        showNotification('Publication deadline must be in the future.', 'error');
        deadlineInput.focus();
        return;
    }

    if (!currentUser || !currentUser.uid) {
        console.error('[PROJECT SUBMIT] No authenticated user available');
        showNotification('Your session expired. Please sign in again before submitting a proposal.', 'error');
        return;
    }

    const authorId = currentUser.uid;
    const authorName = currentUserName || currentUser.displayName || (currentUser.email ? currentUser.email.split('@')[0] : 'Unknown User');
    const normalizedProposal = proposal || 'No proposal provided.';

    try {
        submitButton.disabled = true;
        submitButton.classList.add('loading');
        submitButton.textContent = 'Submitting...';
        submitButton.dataset.submitting = 'true';
        console.log('[PROJECT SUBMIT] Button disabled, preparing data...');

        // Create timeline based on project type
        const timeline = {};
        const tasks = type === "Interview"
            ? ["Topic Proposal Complete", "Interview Scheduled", "Interview Complete",
               "Article Writing Complete", "Review In Progress", "Review Complete", "Suggestions Reviewed"]
            : ["Topic Proposal Complete", "Article Writing Complete",
               "Review In Progress", "Review Complete", "Suggestions Reviewed"];

        tasks.forEach(task => timeline[task] = false);
        console.log('[PROJECT SUBMIT] Timeline created:', timeline);

        // Prepare project data
        const projectData = {
            title: title,
            type: type,
            proposal: normalizedProposal,
            deadline: deadline,
            deadlines: {
                publication: deadline,
                contact: '',
                interview: '',
                draft: '',
                review: '',
                edits: ''
            },
            authorId: authorId,
            authorName: authorName,
            editorId: null,
            editorName: null,
            proposalStatus: 'pending',
            timeline: timeline,
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            activity: [{
                text: 'created the project.',
                authorName: authorName,
                timestamp: new Date()
            }]
        };

        console.log('[PROJECT SUBMIT] Project data prepared:', {
            title: projectData.title,
            type: projectData.type,
            authorId: projectData.authorId,
            authorName: projectData.authorName,
            proposalStatus: projectData.proposalStatus
        });

        // Check Firebase connection
        if (!db) {
            throw new Error('Database connection not available');
        }

        console.log('[PROJECT SUBMIT] Adding document to Firestore...');
        const docRef = await db.collection('projects').add(projectData);
        console.log('[PROJECT SUBMIT] ✅ Document added successfully! ID:', docRef.id);

        const nowSeconds = Math.floor(Date.now() / 1000);
        const localProject = {
            id: docRef.id,
            title,
            type,
            proposal: normalizedProposal,
            deadline,
            deadlines: { ...projectData.deadlines },
            authorId,
            authorName,
            editorId: null,
            editorName: null,
            proposalStatus: 'pending',
            timeline: { ...timeline },
            createdAt: { seconds: nowSeconds },
            updatedAt: { seconds: nowSeconds },
            activity: [{
                text: 'created the project.',
                authorName,
                timestamp: { seconds: nowSeconds }
            }]
        };

        allProjects = [localProject, ...allProjects.filter(p => p.id !== docRef.id)];
        console.log('[PROJECT SUBMIT] Local project inserted for immediate UI update');
        updateNavCounts();
        renderCurrentViewEnhanced();

        showNotification('Project proposal submitted successfully!', 'success');

        // Reset form
        document.getElementById('project-form').reset();
        console.log('[PROJECT SUBMIT] Form reset');

        // Close modal after short delay
        setTimeout(() => {
            console.log('[PROJECT SUBMIT] Closing modal...');
            closeAllModals();
        }, 1000);

    } catch (error) {
        console.error('========================================');
        console.error('[PROJECT SUBMIT ERROR] Failed to create project');
        console.error('[PROJECT SUBMIT ERROR] Error:', error);
        console.error('[PROJECT SUBMIT ERROR] Error code:', error.code);
        console.error('[PROJECT SUBMIT ERROR] Error message:', error.message);
        console.error('[PROJECT SUBMIT ERROR] Error stack:', error.stack);
        console.error('========================================');
        
        let errorMessage = 'Failed to create project. ';
        
        if (error.code === 'permission-denied') {
            errorMessage += 'Permission denied. Please check: 1) You are logged in, 2) Firestore security rules allow write access, 3) Your account has the correct permissions.';
        } else if (error.code === 'unavailable') {
            errorMessage += 'Database temporarily unavailable. Please check your internet connection and try again.';
        } else if (error.message) {
            errorMessage += error.message;
        } else {
            errorMessage += 'Please try again or contact support.';
        }
        
        showNotification(errorMessage, 'error');

    } finally {
        submitButton.disabled = false;
        submitButton.classList.remove('loading');
        submitButton.textContent = originalText;
        delete submitButton.dataset.submitting;
        console.log('[PROJECT SUBMIT] Button re-enabled');
    }
}

if (typeof window !== 'undefined') {
    window.handleProjectFormSubmit = handleProjectFormSubmit;
}



// ==================
//  Kanban Board
// ==================
function isAwaitingEditorAssignment(project) {
    if (!project) return false;
    const timeline = project.timeline || {};

    return project.proposalStatus === 'approved' &&
        timeline["Article Writing Complete"] === true &&
        !timeline["Suggestions Reviewed"] &&
        !project.editorId;
}

function resolveColumnsForView(view) {
    if (typeof getColumnsForView === 'function') {
        const columns = getColumnsForView(view);
        if (Array.isArray(columns) && columns.length > 0) {
            return columns;
        }
    }

    if (view === 'my-assignments') {
        return ['To Do', 'In Progress', 'In Review', 'Done'];
    }

    return ['Topic Proposal', 'Interview Stage', 'Writing Stage', 'In Review', 'Reviewing Suggestions', 'Completed'];
}

function resolveProjectState(project, view, user) {
    const awaitingEditor = isAwaitingEditorAssignment(project);

    if (typeof getProjectState === 'function') {
        const state = getProjectState(project, view, user);
        if (view === 'my-assignments' && currentUserRole === 'admin' && awaitingEditor) {
            return {
                ...state,
                column: 'In Progress',
                color: 'yellow',
                statusText: 'Awaiting Editor Assignment'
            };
        }
        return state;
    }

    if (view === 'my-assignments' && currentUserRole === 'admin' && awaitingEditor) {
        return {
            column: 'In Progress',
            color: 'yellow',
            statusText: 'Awaiting Editor Assignment'
        };
    }

    return {
        column: 'Topic Proposal',
        color: 'default',
        statusText: 'Pending'
    };
}

function getActiveUserIds() {
    const busyUserIds = new Set();

    allProjects.forEach(project => {
        const state = resolveProjectState(project, currentView, currentUser);
        const isComplete = state.column === 'Completed' || (state.statusText || '').toLowerCase().includes('completed');

        if (!isComplete) {
            if (project.authorId) busyUserIds.add(project.authorId);
            if (project.editorId) busyUserIds.add(project.editorId);
        }
    });

    allTasks.forEach(task => {
        if (!task || task.status === 'completed') return;

        const assigneeIds = Array.isArray(task.assigneeIds) ? [...task.assigneeIds] : [];

        if (task.assigneeId && !assigneeIds.includes(task.assigneeId)) {
            assigneeIds.push(task.assigneeId);
        }

        assigneeIds.forEach(id => {
            if (id) busyUserIds.add(id);
        });
    });

    return busyUserIds;
}

function getAvailableUsers() {
    if (!Array.isArray(allUsers) || allUsers.length === 0) return [];

    const busyUserIds = getActiveUserIds();
    return allUsers.filter(user => {
        if (!user || !user.id) return false;

        const override = availabilityOverrides[user.id];

        // Check if user is hidden by admin override
        if (override?.status === 'hidden') {
            return false;
        }

        // Check if admin forced them to show (even if busy)
        if (override?.status === 'show') {
            return true;
        }

        // Otherwise, show only if not busy
        return !busyUserIds.has(user.id);
    });
}

const INACTIVITY_EXEMPT_NAMES = ['alex carter', 'stephanie solomon'];

function isInactivityExempt(name) {
    if (!name) return false;
    return INACTIVITY_EXEMPT_NAMES.includes(String(name).trim().toLowerCase());
}

function parseActivityDate(value) {
    if (!value || typeof value === 'boolean') return null;

    let date = null;

    if (value.seconds !== undefined) {
        date = new Date(value.seconds * 1000);
    } else if (typeof value.toDate === 'function') {
        date = value.toDate();
    } else if (value instanceof Date) {
        date = value;
    } else if (typeof value === 'number') {
        date = new Date(value);
    } else if (typeof value === 'string') {
        const parsed = new Date(value);
        date = isNaN(parsed.getTime()) ? null : parsed;
    }

    if (!date || isNaN(date.getTime())) {
        return null;
    }

    return date;
}

function getUserLastActivityDate(userId) {
    let lastActivityDate = null;

    const recordDate = (value) => {
        const date = parseActivityDate(value);
        if (date && (!lastActivityDate || date > lastActivityDate)) {
            lastActivityDate = date;
        }
    };

    // Check all projects for this user's activity
    allProjects.forEach(project => {
        if (project.authorId === userId || project.editorId === userId) {
            [project.createdAt, project.updatedAt, project.completedAt].forEach(recordDate);

            if (project.timeline) {
                Object.values(project.timeline).forEach(recordDate);
            }

            if (Array.isArray(project.activity)) {
                project.activity.forEach(item => recordDate(item?.timestamp));
            }
        }
    });

    // Check all tasks for this user's activity
    allTasks.forEach(task => {
        const assigneeIds = Array.isArray(task.assigneeIds) ? task.assigneeIds : [];
        if (task.assigneeId) assigneeIds.push(task.assigneeId);

        if (assigneeIds.includes(userId)) {
            [task.createdAt, task.updatedAt, task.completedAt].forEach(recordDate);

            if (Array.isArray(task.activity)) {
                task.activity.forEach(item => recordDate(item?.timestamp));
            }
        }
    });

    return lastActivityDate;
}

function isUserInactiveTwoWeeks(userId, displayName) {
    // Check admin overrides first
    if (availabilityOverrides[userId]) {
        const override = availabilityOverrides[userId];
        if (override.status === 'active') {
            return false; // Admin marked as active/not inactive
        }
        if (override.status === 'inactive') {
            return true; // Admin marked as inactive
        }
    }

    if (isInactivityExempt(displayName)) {
        return false;
    }

    const lastActivity = getUserLastActivityDate(userId);
    if (!lastActivity) {
        // If no activity found, consider them inactive
        return true;
    }

    const twoWeeksAgo = new Date();
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

    return lastActivity < twoWeeksAgo;
}

function isOwnerAdmin() {
    if (!currentUser || !currentUser.email) return false;
    return OWNER_EMAILS.includes(currentUser.email.trim().toLowerCase());
}

function loadAvailabilityOverrides() {
    if (availabilityOverridesInitPromise) {
        return availabilityOverridesInitPromise;
    }

    availabilityOverridesInitPromise = new Promise((resolve) => {
        availabilityOverridesUnsubscribe = availabilityOverridesRef.onSnapshot((doc) => {
            // Ignore local echo while a write is still pending so we don't flicker state
            if (doc.metadata.hasPendingWrites) {
                return;
            }

            const data = doc.exists ? doc.data() : {};
            const overridesFromDb = data.overrides || {};
            const updatedAt = parseActivityDate(data.lastUpdated);
            const updatedMs = updatedAt ? updatedAt.getTime() : 0;

            // Prevent older snapshots (e.g., cache) from overwriting a fresh admin edit
            const CLOCK_DRIFT_BUFFER_MS = 2000;
            if (
                updatedMs &&
                lastAvailabilityOverrideWrite &&
                (updatedMs + CLOCK_DRIFT_BUFFER_MS) <= lastAvailabilityOverrideWrite
            ) {
                console.log('[AVAILABILITY] Ignoring stale overrides snapshot');
                return;
            }

            availabilityOverrides = overridesFromDb;
            availabilityOverridesLoaded = true;
            console.log('[AVAILABILITY] Synced overrides:', availabilityOverrides);

            if (['interviews', 'opeds', 'dashboard'].includes(currentView)) {
                renderKanbanBoard(filterProjects());
            }

            resolve();
        }, (error) => {
            console.error('[AVAILABILITY] Error loading overrides:', error);
            availabilityOverrides = {};
            availabilityOverridesLoaded = true;
            resolve();
        });
    });

    return availabilityOverridesInitPromise;
}

async function saveAvailabilityOverride(userId, status) {
    if (!isOwnerAdmin()) {
        console.error('[AVAILABILITY] Only owner can save overrides');
        return;
    }

    try {
        lastAvailabilityOverrideWrite = Date.now();
        availabilityOverridesLoaded = true;

        if (status === 'auto') {
            // Remove override to use automatic detection
            delete availabilityOverrides[userId];
        } else {
            availabilityOverrides[userId] = {
                status: status, // 'active', 'inactive', 'show', or 'hidden'
                updatedAt: new Date(),
                updatedBy: currentUser.email
            };
        }

        await availabilityOverridesRef.set({
            overrides: availabilityOverrides,
            lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
        });

        console.log('[AVAILABILITY] Saved override for user:', userId, status);
        showNotification('Availability status updated', 'success');

        // Re-render the board to reflect changes
        if (currentView === 'interviews' || currentView === 'opeds' || currentView === 'dashboard') {
            renderKanbanBoard(filterProjects());
        }
    } catch (error) {
        console.error('[AVAILABILITY] Error saving override:', error);
        showNotification('Failed to update availability status', 'error');
    }
}

function destroyAvailabilityOverlay() {
    if (availabilityOverlayEscHandler) {
        document.removeEventListener('keydown', availabilityOverlayEscHandler);
        availabilityOverlayEscHandler = null;
    }

    document.body.style.overflow = availabilityPreviousOverflow;
    availabilityPreviousOverflow = '';

    const existing = document.getElementById('availability-overlay');
    if (existing && existing.parentNode) {
        existing.parentNode.removeChild(existing);
    }
}

function createAvailabilityShell({ title, subtitle, accent }) {
    destroyAvailabilityOverlay();

    availabilityPreviousOverflow = document.body.style.overflow || '';
    document.body.style.overflow = 'hidden';

    const overlay = document.createElement('div');
    overlay.id = 'availability-overlay';
    overlay.className = 'availability-overlay';

    overlay.innerHTML = `
        <div class="availability-card" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}" tabindex="-1">
            <div class="availability-card__header">
                <div>
                    <div class="availability-pill">${accent || 'Availability'}</div>
                    <h3 class="availability-title">${escapeHtml(title)}</h3>
                    ${subtitle ? `<p class="availability-subtitle">${escapeHtml(subtitle)}</p>` : ''}
                </div>
                <button class="availability-close" type="button" aria-label="Close availability dialog">×</button>
            </div>
            <div class="availability-card__body"></div>
            <div class="availability-card__footer">
                <button type="button" class="availability-secondary" data-close>Close (Esc)</button>
            </div>
        </div>
    `;

    const card = overlay.querySelector('.availability-card');
    const body = overlay.querySelector('.availability-card__body');
    const footer = overlay.querySelector('.availability-card__footer');
    const closeButtons = overlay.querySelectorAll('.availability-close, [data-close]');

    const close = () => {
        overlay.classList.add('closing');
        setTimeout(() => {
            destroyAvailabilityOverlay();
        }, 150);
    };

    availabilityOverlayEscHandler = (e) => {
        if (e.key === 'Escape') {
            close();
        }
    };

    document.addEventListener('keydown', availabilityOverlayEscHandler);

    closeButtons.forEach(btn => btn.addEventListener('click', close));
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            close();
        }
    });

    document.body.appendChild(overlay);
    if (card && typeof card.focus === 'function') {
        card.focus();
    }

    return { overlay, body, footer, close };
}

function showAvailabilityManagementModal(userId, displayName) {
    if (!isOwnerAdmin()) {
        return;
    }

    const currentOverride = availabilityOverrides[userId]?.status || 'auto';
    const safeName = escapeHtml(displayName);

    const options = [
        {
            value: 'auto',
            title: 'Automatic',
            description: 'Use the 2-week rule and turn red when inactive.',
            badge: 'Default',
            icon: '🔄'
        },
        {
            value: 'active',
            title: 'Mark as Active',
            description: 'Keep them normal (not red) regardless of activity.',
            badge: 'Override',
            icon: '✅'
        },
        {
            value: 'inactive',
            title: 'Mark as Inactive',
            description: 'Keep them highlighted red even if they do work.',
            badge: 'Alert',
            icon: '🔴'
        },
        {
            value: 'show',
            title: 'Force Show in List',
            description: 'Always show in “Not Working” even when busy.',
            badge: 'Pin',
            icon: '📌'
        },
        {
            value: 'hidden',
            title: 'Hide from List',
            description: 'Remove from the “Not Working” section entirely.',
            badge: 'Hide',
            icon: '👁️'
        }
    ];

    const { body, footer, close } = createAvailabilityShell({
        title: `Manage ${safeName}`,
        subtitle: 'Quickly change how this person appears in the “Not Working” panel.',
        accent: 'Admin Control'
    });

    const helperText = document.createElement('div');
    helperText.className = 'availability-helper';
    helperText.innerHTML = `
        <div class="availability-helper__dot"></div>
        <div>
            <div class="availability-helper__title">Tap once to save</div>
            <div class="availability-helper__desc">Click an option below to apply instantly. Click outside or press Esc to close.</div>
        </div>
    `;

    const list = document.createElement('div');
    list.className = 'availability-options';

    let saving = false;

    options.forEach(opt => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `availability-option ${opt.value === currentOverride ? 'active' : ''}`;
        btn.dataset.value = opt.value;
        btn.innerHTML = `
            <div class="availability-option__icon">${opt.icon}</div>
            <div class="availability-option__text">
                <div class="availability-option__title">${opt.title}</div>
                <div class="availability-option__desc">${opt.description}</div>
            </div>
            <div class="availability-option__badge">${opt.badge}</div>
        `;

        btn.addEventListener('click', async () => {
            if (saving) return;
            saving = true;

            list.querySelectorAll('.availability-option').forEach(el => el.classList.remove('active'));
            btn.classList.add('active', 'loading');

            try {
                await saveAvailabilityOverride(userId, opt.value);
                close();
            } catch (err) {
                console.error('[AVAILABILITY] Failed to save selection:', err);
                btn.classList.remove('loading');
                saving = false;
            }
        });

        list.appendChild(btn);
    });

    body.appendChild(helperText);
    body.appendChild(list);

    const currentStatus = document.createElement('div');
    currentStatus.className = 'availability-current';
    currentStatus.textContent = `Current: ${currentOverride === 'auto' ? 'Automatic (2-week rule)' : options.find(o => o.value === currentOverride)?.title || 'Automatic'}`;
    footer.insertBefore(currentStatus, footer.firstChild);
}

function showAddToAvailabilityModal() {
    if (!isOwnerAdmin()) {
        return;
    }

    const availableUserIds = new Set(getAvailableUsers().map(u => u.id));
    const busyOrHiddenUsers = allUsers
        .filter(user => user && user.id && !availableUserIds.has(user.id))
        .sort((a, b) => getUserDisplayName(a).localeCompare(getUserDisplayName(b)));

    if (busyOrHiddenUsers.length === 0) {
        showNotification('All team members are already in the availability section', 'info');
        return;
    }

    const { body, close } = createAvailabilityShell({
        title: 'Add someone to “Not Working”',
        subtitle: 'Force a person into the list even if they have active work.',
        accent: 'Pin to list'
    });

    const search = document.createElement('input');
    search.type = 'search';
    search.placeholder = 'Search people by name or email';
    search.className = 'availability-search';
    search.setAttribute('aria-label', 'Search people to add');

    const list = document.createElement('div');
    list.className = 'availability-add-list';

    const renderList = (query = '') => {
        list.innerHTML = '';
        const normalized = query.trim().toLowerCase();

        const filtered = busyOrHiddenUsers.filter(user => {
            if (!normalized) return true;
            const name = getUserDisplayName(user).toLowerCase();
            const email = (user.email || '').toLowerCase();
            return name.includes(normalized) || email.includes(normalized);
        });

        if (!filtered.length) {
            const empty = document.createElement('div');
            empty.className = 'availability-empty-state';
            empty.textContent = 'No matches found.';
            list.appendChild(empty);
            return;
        }

        filtered.forEach(user => {
            const displayName = getUserDisplayName(user);
            const safeName = escapeHtml(displayName);
            const isHidden = availabilityOverrides[user.id]?.status === 'hidden';
            const statusText = isHidden ? 'Hidden' : 'Working on projects';

            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'availability-add-item';
            btn.dataset.userId = user.id;
            btn.innerHTML = `
                <div class="availability-add-item__avatar" style="background:${stringToColor(displayName)}">${displayName.charAt(0).toUpperCase()}</div>
                <div class="availability-add-item__text">
                    <div class="availability-add-item__name">${safeName}</div>
                    <div class="availability-add-item__meta">${statusText}</div>
                </div>
                <span class="availability-add-item__action">Add</span>
            `;

            btn.addEventListener('click', async () => {
                btn.classList.add('loading');
                await saveAvailabilityOverride(user.id, 'show');
                showNotification(`Added ${safeName} to availability section`, 'success');
                close();
            });

            list.appendChild(btn);
        });
    };

    renderList();

    search.addEventListener('input', (e) => {
        renderList(e.target.value);
    });

    body.appendChild(search);
    body.appendChild(list);
}

function handlePendingEditorAlerts() {
    if (currentUserRole !== 'admin' || !currentUser) {
        pendingEditorAlertedProjects.clear();
        return;
    }

    const pendingProjects = allProjects.filter(isAwaitingEditorAssignment);
    const pendingIds = new Set(pendingProjects.map(project => project.id));

    pendingProjects.forEach(project => {
        if (!pendingEditorAlertedProjects.has(project.id)) {
            showNotification(`"${project.title}" is awaiting an editor assignment.`, 'warning');
            pendingEditorAlertedProjects.add(project.id);
        }
    });

    Array.from(pendingEditorAlertedProjects).forEach(projectId => {
        if (!pendingIds.has(projectId)) {
            pendingEditorAlertedProjects.delete(projectId);
        }
    });
}

function ensureTaskFormSubmitListener() {
    if (taskFormSubmitListenerAttached) {
        return;
    }

    document.addEventListener('submit', (event) => {
        const form = event.target;
        if (form && form.id === 'task-form') {
            event.preventDefault();
            handleTaskFormSubmit(event);
        }
    }, true);

    taskFormSubmitListenerAttached = true;
    console.log('[SETUP] Delegated task form handler attached');
}

function ensureGlobalModalCloseHandler() {
    if (modalCloseDelegationAttached) {
        return;
    }

    document.addEventListener('click', (event) => {
        const closeBtn = event.target.closest('.close-button');
        if (closeBtn) {
            event.preventDefault();
            event.stopPropagation();
            closeAllModals();
            return;
        }

        const target = event.target;
        if (target && target.classList && target.classList.contains('modal-overlay')) {
            event.preventDefault();
            closeAllModals();
        }
    });

    modalCloseDelegationAttached = true;
    console.log('[SETUP] Global modal close delegation attached');
}

function createAvailabilityColumn(availableUsers) {
    const columnEl = document.createElement('div');
    columnEl.className = 'kanban-column availability-column';
    columnEl.setAttribute('aria-label', 'Team members without active assignments');

    const addButtonHtml = isOwnerAdmin() ? `
        <button class="add-availability-btn" title="Add someone to this list" aria-label="Add person to availability list">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
        </button>
    ` : '';

    columnEl.innerHTML = `
        <div class="column-header availability-header">
            <div class="column-title">
                <div class="column-title-main">
                    <span class="availability-dot"></span>
                    <span class="column-title-text">Not Working On Anything</span>
                </div>
                <div style="display: flex; align-items: center; gap: 6px;">
                    <span class="task-count">${availableUsers.length}</span>
                    ${addButtonHtml}
                </div>
            </div>
            <p class="availability-subtitle">Ready to pick up a project</p>
        </div>
        <div class="column-content">
            <div class="availability-key" aria-label="Status legend">
                <div class="key-item">
                    <span class="key-dot key-dot-inactive"></span>
                    <span class="key-text">Turns red after 2 weeks of no activity</span>
                </div>
                <div class="key-item">
                    <span class="key-dot key-dot-break"></span>
                    <span class="key-text">On break</span>
                </div>
            </div>
            <div class="availability-list"></div>
        </div>
    `;

    const listEl = columnEl.querySelector('.availability-list');

    // Add click handler for the + button
    if (isOwnerAdmin()) {
        const addBtn = columnEl.querySelector('.add-availability-btn');
        if (addBtn) {
            addBtn.addEventListener('click', () => {
                showAddToAvailabilityModal();
            });
        }
    }

    if (!availableUsers.length) {
        const empty = document.createElement('div');
        empty.className = 'availability-empty';
        empty.textContent = allUsers.length === 0 ? 'Team roster loading...' : 'Everyone is assigned right now.';
        listEl.appendChild(empty);
        return columnEl;
    }

    const regularUsers = [];
    const exemptUsers = [];

    availableUsers.forEach(user => {
        const name = getUserDisplayName(user);
        const targetList = isInactivityExempt(name) ? exemptUsers : regularUsers;
        targetList.push({
            user,
            name,
            normalized: name.toLowerCase()
        });
    });

    const sortedRegular = regularUsers
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(entry => entry.user);

    const sortedExempt = INACTIVITY_EXEMPT_NAMES
        .map(name => exemptUsers.find(entry => entry.normalized === name))
        .filter(Boolean)
        .map(entry => entry.user);

    const orderedUsers = [...sortedRegular, ...sortedExempt];

    orderedUsers.forEach(user => {
        const displayName = getUserDisplayName(user);
        const safeName = escapeHtml(displayName);
        const isInactive = isUserInactiveTwoWeeks(user.id, displayName);
        const onBreak = isInactivityExempt(displayName);

        const person = document.createElement('div');
        person.className = `availability-person ${isInactive ? 'inactive-two-weeks' : ''} ${onBreak ? 'on-break' : ''}`;
        person.dataset.userId = user.id;
        person.dataset.userName = displayName;

        // Add click handler for owner admin
        if (isOwnerAdmin()) {
            person.style.cursor = 'pointer';
            person.title = 'Click to manage availability status';
            person.addEventListener('click', () => {
                showAvailabilityManagementModal(user.id, displayName);
            });
        }

        person.innerHTML = `
            <div class="user-avatar availability-avatar" style="background: ${stringToColor(displayName)}">
                ${displayName.charAt(0).toUpperCase()}
            </div>
            <div class="availability-name">${safeName}</div>
        `;

        listEl.appendChild(person);
    });

    return columnEl;
}

function renderKanbanBoard(projects) {
    const board = document.getElementById('kanban-board');
    board.innerHTML = '';

    const columns = resolveColumnsForView(currentView);

    columns.forEach(columnTitle => {
        const columnProjects = projects.filter(project => {
            const state = resolveProjectState(project, currentView, currentUser);
            return state.column === columnTitle;
        });

        const columnEl = document.createElement('div');
        columnEl.className = 'kanban-column';

        columnEl.innerHTML = `
            <div class="column-header">
                <div class="column-title">
                    <span class="column-title-text">${columnTitle}</span>
                    <span class="task-count">${columnProjects.length}</span>
                </div>
            </div>
            <div class="column-content">
                <div class="kanban-cards"></div>
            </div>
        `;

        const cardsContainer = columnEl.querySelector('.kanban-cards');
        columnProjects.forEach(project => {
            cardsContainer.appendChild(createProjectCard(project));
        });

        board.appendChild(columnEl);
    });

    const shouldShowAvailability = ['dashboard', 'interviews', 'opeds'].includes(currentView);

    if (shouldShowAvailability) {
        const availableUsers = getAvailableUsers();
        board.appendChild(createAvailabilityColumn(availableUsers));
    }
}

function filterProjects() {
    switch (currentView) {
        case 'dashboard':
        case 'interviews':
            return allProjects.filter(p => p.type === 'Interview');
        case 'opeds':
            return allProjects.filter(p => p.type === 'Op-Ed');
        case 'my-assignments':
            const userId = currentUser ? currentUser.uid : null;
            const myProjects = userId
                ? allProjects.filter(p => p.authorId === userId || p.editorId === userId)
                : [];

            let adminQueue = [];
            if (currentUserRole === 'admin') {
                adminQueue = allProjects.filter(isAwaitingEditorAssignment);
            }

            const projectMap = new Map();
            [...myProjects, ...adminQueue].forEach(project => {
                if (project && project.id) {
                    projectMap.set(project.id, project);
                }
            });

            const myTasks = userId
                ? allTasks
                    .filter(t => t.creatorId === userId || isUserAssignedToTask(t, userId))
                    .map(t => ({ ...t, isTask: true }))
                : [];

            return [...projectMap.values(), ...myTasks];
        default:
            return allProjects;
    }
}

function createProjectCard(project) {
    if (project.isTask) {
        return createTaskCardForAssignments(project);
    }

    const state = resolveProjectState(project, currentView, currentUser);
    const card = document.createElement('div');

    // Add column-based class for color coding
    let columnClass = '';
    if (state.column === 'Completed') {
        columnClass = 'column-completed';
    } else if (state.column === 'In Progress') {
        columnClass = 'column-in-progress';
    } else if (state.column === 'Approved') {
        columnClass = 'column-approved';
    } else if (state.column === 'Pending Approval') {
        columnClass = 'column-pending';
    }

    card.className = `kanban-card status-${state.color} ${columnClass}`;
    card.dataset.id = project.id;
    card.dataset.type = 'project';

    const progress = calculateProgress(project.timeline);

    const finalDeadline = project.deadlines ? project.deadlines.publication : project.deadline;
    const daysUntilDeadline = finalDeadline ? Math.ceil((new Date(finalDeadline) - new Date()) / (1000 * 60 * 60 * 24)) : 0;
    const deadlineClass = daysUntilDeadline < 0 ? 'overdue' : daysUntilDeadline <= 3 ? 'due-soon' : '';

    const deadlineRequestIndicator = (project.deadlineRequest && project.deadlineRequest.status === 'pending') ||
                                   (project.deadlineChangeRequest && project.deadlineChangeRequest.status === 'pending') ?
        '<span class="deadline-request-indicator">⏰</span>' : '';

    card.innerHTML = `
        <h4 class="card-title">${project.title} ${deadlineRequestIndicator}</h4>
        <div class="card-meta">
            <span class="card-type">${project.type}</span>
            <span class="card-status">${state.statusText}</span>
        </div>
        <div class="progress-bar-container">
            <div class="progress-bar" style="width: ${progress}%"></div>
        </div>
        <div class="card-footer">
            <div class="card-author">
                <div class="user-avatar" style="background: ${stringToColor(project.authorName)}">
                    ${project.authorName.charAt(0)}
                </div>
                <span>${project.authorName}</span>
            </div>
            <div class="card-deadline ${deadlineClass}">
                ${finalDeadline ? new Date(finalDeadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'No deadline'}
            </div>
        </div>
    `;

    card.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openDetailsModal(project.id);
    });

    return card;
}

function createTaskCardForAssignments(task) {
    const card = document.createElement('div');
    card.className = 'kanban-card task-card';
    card.dataset.id = task.id;
    card.dataset.type = 'task';

    const isOverdue = new Date(task.deadline) < new Date() && task.status !== 'completed';
    const isDueSoon = !isOverdue && new Date(task.deadline) < new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);

    if (isOverdue) card.classList.add('overdue');
    if (isDueSoon) card.classList.add('due-soon');

    const deadline = new Date(task.deadline);
    const deadlineText = deadline.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

    const priorityColors = {
        low: '#10b981',
        medium: '#f59e0b',
        high: '#ef4444',
        urgent: '#dc2626'
    };

    const priorityColor = priorityColors[task.priority] || priorityColors.medium;

    const assigneeNames = getTaskAssigneeNames(task);
    let displayNames = assigneeNames.join(', ');
    let multipleIndicator = '';

    if (assigneeNames.length > 2) {
        displayNames = `${assigneeNames.slice(0, 2).join(', ')} +${assigneeNames.length - 2} more`;
        multipleIndicator = `<span class="multiple-assignees-indicator">+${assigneeNames.length}</span>`;
    } else if (assigneeNames.length > 1) {
        multipleIndicator = `<span class="multiple-assignees-indicator">+${assigneeNames.length}</span>`;
    }

    card.innerHTML = `
        <h4 class="card-title">📋 ${escapeHtml(task.title)}</h4>
        <div class="card-meta">
            <span class="card-type" style="background: linear-gradient(135deg, #3b82f6, #1d4ed8); color: white;">TASK</span>
            <span class="card-status">${(task.status || 'pending').replace('_', ' ')}</span>
            ${multipleIndicator}
        </div>
        <div class="card-footer">
            <div class="card-author">
                <div class="user-avatar" style="background: ${stringToColor(task.creatorName)}">
                    ${task.creatorName.charAt(0)}
                </div>
                <span title="Assigned to: ${assigneeNames.join(', ')}">→ ${escapeHtml(displayNames)}</span>
            </div>
            <div class="card-deadline ${isOverdue ? 'overdue' : isDueSoon ? 'due-today' : ''}">
                ${deadlineText}
            </div>
        </div>
        <div class="priority-indicator" style="background: ${priorityColor}; color: white; padding: 2px 8px; border-radius: 8px; font-size: 10px; font-weight: 600; margin-top: 8px; text-align: center;">
            ${(task.priority || 'medium').toUpperCase()} PRIORITY
        </div>
    `;

    card.addEventListener('click', () => openTaskDetailsModal(task.id));
    return card;
}

// ==================
//  Calendar
// ==================
function renderCalendar() {
    const calendarGrid = document.getElementById('calendar-grid');
    const monthYear = document.getElementById('month-year');

    if (!calendarGrid || !monthYear) return;

    calendarGrid.innerHTML = '';

    const month = calendarDate.getMonth();
    const year = calendarDate.getFullYear();

    monthYear.textContent = `${calendarDate.toLocaleString('default', { month: 'long' })} ${year}`;

    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const prevMonth = new Date(year, month, 0);
    const today = new Date();

    for (let i = firstDay - 1; i >= 0; i--) {
        const dayDate = new Date(prevMonth);
        dayDate.setDate(prevMonth.getDate() - i);
        createCalendarDay(calendarGrid, dayDate, true, today);
    }

    for (let day = 1; day <= daysInMonth; day++) {
        const dayDate = new Date(year, month, day);
        createCalendarDay(calendarGrid, dayDate, false, today);
    }

    const totalCells = calendarGrid.children.length;
    const remainingCells = 42 - totalCells;
    const nextMonth = new Date(year, month + 1, 1);

    for (let day = 1; day <= remainingCells; day++) {
        const dayDate = new Date(nextMonth);
        dayDate.setDate(day);
        createCalendarDay(calendarGrid, dayDate, true, today);
    }

    updateCalendarStats();
}

function createCalendarDay(grid, date, isOtherMonth, today) {
    const dayEl = document.createElement('div');
    dayEl.className = 'calendar-day';

    if (isOtherMonth) {
        dayEl.classList.add('other-month');
    }

    if (isSameDay(date, today)) {
        dayEl.classList.add('today');
    }

    const dayNumber = document.createElement('div');
    dayNumber.className = 'day-number';
    dayNumber.textContent = date.getDate();

    const eventsContainer = document.createElement('div');
    eventsContainer.className = 'calendar-events';

    const dayProjects = allProjects.filter(project => {
        return hasProjectDeadlineOnDate(project, date);
    });

    const dayTasks = allTasks.filter(task => {
        return hasTaskDeadlineOnDate(task, date);
    });

    const maxVisibleEvents = 3;
    const allEvents = [...dayProjects, ...dayTasks.map(t => ({...t, isTask: true}))];

    allEvents.slice(0, maxVisibleEvents).forEach(item => {
        const eventEl = createCalendarEvent(item, date);
        eventsContainer.appendChild(eventEl);
    });

    if (allEvents.length > maxVisibleEvents) {
        const moreEl = document.createElement('div');
        moreEl.className = 'event-more';
        moreEl.textContent = `+${allEvents.length - maxVisibleEvents} more`;
        moreEl.addEventListener('click', (e) => {
            e.stopPropagation();
            showDayDetails(date, allEvents);
        });
        eventsContainer.appendChild(moreEl);
    }

    dayEl.appendChild(dayNumber);
    dayEl.appendChild(eventsContainer);

    dayEl.addEventListener('click', () => {
        if (allEvents.length === 1) {
            if (allEvents[0].isTask) {
                openTaskDetailsModal(allEvents[0].id);
            } else {
                openDetailsModal(allEvents[0].id);
            }
        } else if (allEvents.length > 1) {
            showDayDetails(date, allEvents);
        }
    });

    grid.appendChild(dayEl);
}

function createCalendarEvent(item, date) {
    const eventEl = document.createElement('div');

    if (item.isTask) {
        eventEl.className = 'calendar-event task-event';
        eventEl.textContent = `📋 ${item.title}`;
        eventEl.title = `Task: ${item.title} - Due ${date.toLocaleDateString()}`;
        eventEl.style.background = 'linear-gradient(135deg, #3b82f6, #1d4ed8)';
    } else {
        const { eventType, eventTitle } = getEventTypeForDate(item, date);
        eventEl.className = `calendar-event ${eventType}`;
        eventEl.textContent = eventTitle;
        eventEl.title = `${item.title} - ${eventTitle} - ${date.toLocaleDateString()}`;
    }

    eventEl.addEventListener('click', (e) => {
        e.stopPropagation();
        if (item.isTask) {
            openTaskDetailsModal(item.id);
        } else {
            openDetailsModal(item.id);
        }
    });

    return eventEl;
}

function hasTaskDeadlineOnDate(task, date) {
    if (!task.deadline) return false;

    try {
        const taskDeadline = new Date(task.deadline + 'T00:00:00');

        if (isNaN(taskDeadline.getTime())) {
            console.error('[CALENDAR] Invalid task deadline:', task.deadline);
            return false;
        }

        return formatDateForComparison(taskDeadline) === formatDateForComparison(date);
    } catch (error) {
        console.error('[CALENDAR] Error parsing task deadline:', error);
        return false;
    }
}

function hasProjectDeadlineOnDate(project, date) {
    const deadlines = project.deadlines || {};
    const finalDeadline = deadlines.publication || project.deadline;
    const dateStr = formatDateForComparison(date);

    const deadlineTypes = ['contact', 'interview', 'draft', 'review', 'edits'];

    for (const type of deadlineTypes) {
        if (deadlines[type]) {
            try {
                const deadlineDate = new Date(deadlines[type] + 'T00:00:00');

                if (isNaN(deadlineDate.getTime())) {
                    console.error('[CALENDAR] Invalid deadline for type:', type, deadlines[type]);
                    continue;
                }

                if (formatDateForComparison(deadlineDate) === dateStr) {
                    return true;
                }
            } catch (error) {
                console.error('[CALENDAR] Error parsing deadline:', error);
                continue;
            }
        }
    }

    if (finalDeadline) {
        try {
            const publicationDate = new Date(finalDeadline + 'T00:00:00');

            if (isNaN(publicationDate.getTime())) {
                console.error('[CALENDAR] Invalid publication deadline:', finalDeadline);
                return false;
            }

            if (formatDateForComparison(publicationDate) === dateStr) {
                return true;
            }
        } catch (error) {
            console.error('[CALENDAR] Error parsing publication deadline:', error);
            return false;
        }
    }

    return false;
}

function getEventTypeForDate(project, date) {
    const deadlines = project.deadlines || {};
    const finalDeadline = deadlines.publication || project.deadline;
    const dateStr = formatDateForComparison(date);

    if (deadlines.contact && formatDateForComparison(new Date(deadlines.contact + 'T00:00:00')) === dateStr) {
        return { eventType: 'interview', eventTitle: 'Contact Professor' };
    }
    if (deadlines.interview && formatDateForComparison(new Date(deadlines.interview + 'T00:00:00')) === dateStr) {
        return { eventType: 'interview', eventTitle: 'Interview Due' };
    }
    if (deadlines.draft && formatDateForComparison(new Date(deadlines.draft + 'T00:00:00')) === dateStr) {
        return { eventType: 'due-soon', eventTitle: 'Draft Due' };
    }
    if (deadlines.review && formatDateForComparison(new Date(deadlines.review + 'T00:00:00')) === dateStr) {
        return { eventType: 'due-soon', eventTitle: 'Review Due' };
    }
    if (deadlines.edits && formatDateForComparison(new Date(deadlines.edits + 'T00:00:00')) === dateStr) {
        return { eventType: 'due-soon', eventTitle: 'Edits Due' };
    }
    if (finalDeadline && formatDateForComparison(new Date(finalDeadline + 'T00:00:00')) === dateStr) {
        const isOverdue = new Date(finalDeadline) < new Date();
        const eventType = isOverdue ? 'overdue' : 'publication';
        return { eventType, eventTitle: 'Publication Due' };
    }

    return { eventType: 'publication', eventTitle: project.title };
}

function formatDateForComparison(date) {
    if (!date || isNaN(date.getTime())) {
        console.error('[CALENDAR] Invalid date for comparison:', date);
        return '';
    }

    return date.getFullYear() + '-' +
           String(date.getMonth() + 1).padStart(2, '0') + '-' +
           String(date.getDate()).padStart(2, '0');
}

function isSameDay(date1, date2) {
    return date1.getDate() === date2.getDate() &&
           date1.getMonth() === date2.getMonth() &&
           date1.getFullYear() === date2.getFullYear();
}

function updateCalendarStats() {
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    const monthStart = new Date(calendarDate.getFullYear(), calendarDate.getMonth(), 1);
    monthStart.setHours(0, 0, 0, 0);

    const monthEnd = new Date(calendarDate.getFullYear(), calendarDate.getMonth() + 1, 0);
    monthEnd.setHours(23, 59, 59, 999);

    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay());
    weekStart.setHours(0, 0, 0, 0);

    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);

    let thisMonthCount = 0;
    let thisWeekCount = 0;
    let overdueCount = 0;

    allProjects.forEach(project => {
        const deadlines = project.deadlines || {};
        const finalDeadline = deadlines.publication || project.deadline;

        if (finalDeadline) {
            try {
                const deadline = new Date(finalDeadline + 'T00:00:00');

                if (!isNaN(deadline.getTime())) {
                    if (deadline >= monthStart && deadline <= monthEnd) {
                        thisMonthCount++;
                    }

                    if (deadline >= weekStart && deadline <= weekEnd) {
                        thisWeekCount++;
                    }

                    const state = resolveProjectState(project, currentView, currentUser);
                    if (deadline < now && state.column !== 'Completed' && !state.statusText.includes('Completed')) {
                        overdueCount++;
                    }
                }
            } catch (error) {
                console.error('[CALENDAR STATS] Error parsing final deadline:', error);
            }
        }

        const deadlineTypes = ['contact', 'interview', 'draft', 'review', 'edits'];
        deadlineTypes.forEach(type => {
            if (deadlines[type]) {
                try {
                    const deadline = new Date(deadlines[type] + 'T00:00:00');

                    if (!isNaN(deadline.getTime())) {
                        if (deadline >= monthStart && deadline <= monthEnd) {
                            thisMonthCount++;
                        }

                        if (deadline >= weekStart && deadline <= weekEnd) {
                            thisWeekCount++;
                        }
                    }
                } catch (error) {
                    console.error('[CALENDAR STATS] Error parsing deadline type:', type, error);
                }
            }
        });
    });

    allTasks.forEach(task => {
        if (!task.deadline) return;

        try {
            const deadline = new Date(task.deadline + 'T00:00:00');

            if (!isNaN(deadline.getTime())) {
                if (deadline >= monthStart && deadline <= monthEnd) {
                    thisMonthCount++;
                }

                if (deadline >= weekStart && deadline <= weekEnd) {
                    thisWeekCount++;
                }

                if (deadline < now && task.status !== 'completed') {
                    overdueCount++;
                }
            }
        } catch (error) {
            console.error('[CALENDAR STATS] Error parsing task deadline:', error);
        }
    });

    const statMonth = document.getElementById('stat-month');
    const statWeek = document.getElementById('stat-week');
    const statOverdue = document.getElementById('stat-overdue');

    if (statMonth) statMonth.textContent = thisMonthCount;
    if (statWeek) statWeek.textContent = thisWeekCount;
    if (statOverdue) statOverdue.textContent = overdueCount;
}

function showDayDetails(date, items) {
    const dateStr = date.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });

    let message = `Events for ${dateStr}:\n\n`;

    items.forEach((item, index) => {
        if (item.isTask) {
            const assigneeNames = getTaskAssigneeNames(item);
            message += `${index + 1}. [TASK] ${item.title}\n   Assigned to: ${assigneeNames.join(', ')}\n   Priority: ${item.priority || 'medium'}\n\n`;
        } else {
            const { eventTitle } = getEventTypeForDate(item, date);
            message += `${index + 1}. ${item.title}\n   ${eventTitle}\n   Author: ${item.authorName}\n\n`;
        }
    });

    message += 'Click on an individual event to view details.';
    alert(message);
}

function changeMonth(offset) {
    calendarDate.setMonth(calendarDate.getMonth() + offset);
    renderCalendar();
}

function goToToday() {
    calendarDate = new Date();
    renderCalendar();
}

function setupCalendarListeners() {
    const prevBtn = document.getElementById('prev-month');
    const nextBtn = document.getElementById('next-month');
    const todayBtn = document.getElementById('today-btn');

    if (prevBtn) prevBtn.addEventListener('click', () => changeMonth(-1));
    if (nextBtn) nextBtn.addEventListener('click', () => changeMonth(1));
    if (todayBtn) todayBtn.addEventListener('click', goToToday);

    document.querySelectorAll('.view-toggle button').forEach((btn, index) => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.view-toggle button').forEach((b, i) => {
                b.classList.toggle('active', i === index);
            });
            renderCalendar();
        });
    });
}

function setupCalendarKeyboardNavigation() {
    document.addEventListener('keydown', (e) => {
        if (currentView !== 'calendar') return;

        switch(e.key) {
            case 'ArrowLeft':
                if (e.ctrlKey || e.metaKey) {
                    changeMonth(-1);
                    e.preventDefault();
                }
                break;
            case 'ArrowRight':
                if (e.ctrlKey || e.metaKey) {
                    changeMonth(1);
                    e.preventDefault();
                }
                break;
            case 't':
            case 'T':
                if (e.ctrlKey || e.metaKey) {
                    goToToday();
                    e.preventDefault();
                }
                break;
        }
    });
}

// ==================
//  Modals
// ==================
function closeAllModals() {
    console.log('[MODAL CLOSE] Closing all modals');
    const modals = document.querySelectorAll('.modal-overlay');

    modals.forEach(modal => {
        // Remove all inline styles to reset state completely
        modal.style.display = 'none';
        modal.style.opacity = '';
        modal.style.visibility = '';
        modal.classList.remove('loading', 'closing');
        
        // Clear any content opacity
        const content = modal.querySelector('.details-container');
        if (content) {
            content.style.opacity = '';
        }
    });

    currentlyViewedProjectId = null;
    currentlyViewedTaskId = null;
    if (typeof window !== 'undefined') {
        window.currentlyViewedProjectId = null;
        window.currentlyViewedTaskId = null;
    }
    disableProposalEditing({ revertToOriginal: true });

    document.body.style.overflow = '';
    const appContainer = document.getElementById('app-container');
    if (appContainer) {
        appContainer.style.filter = '';
    }

    // Also close availability overlays created dynamically
    destroyAvailabilityOverlay();
    
    // Force browser to apply the display:none before continuing
    document.body.offsetHeight; // Force reflow
    
    console.log('[MODAL CLOSE] All modals closed and reset');
}

if (typeof window !== 'undefined') {
    window.__modalManagerV2Applied = true;
}

// ==================
//  Status Reports
// ==================
function generateStatusReport() {
    const reportModal = document.getElementById('report-modal');
    const reportContent = document.getElementById('report-content');
    if (!reportModal || !reportContent) {
        console.error('[REPORT] Modal elements not found');
        return;
    }

    const now = new Date();
    now.setHours(0, 0, 0, 0);

    const userWorkload = {};

    allUsers.forEach(user => {
        userWorkload[user.id] = {
            name: user.name,
            role: user.role || 'member',
            email: user.email,
            projects: [],
            tasks: [],
            overdue: 0,
            onTrack: 0,
            completed: 0
        };
    });

    allProjects.forEach(project => {
        const state = resolveProjectState(project, currentView, currentUser);
        const finalDeadline = project.deadlines ? project.deadlines.publication : project.deadline;

        let status = 'on-track';
        let daysUntilDeadline = null;

        if (finalDeadline) {
            try {
                const deadline = new Date(finalDeadline + 'T00:00:00');
                if (!isNaN(deadline.getTime())) {
                    daysUntilDeadline = Math.ceil((deadline - now) / (1000 * 60 * 60 * 24));

                    if (state.column === 'Completed' || state.statusText.includes('Completed')) {
                        status = 'completed';
                    } else if (daysUntilDeadline < 0) {
                        status = 'overdue';
                    } else if (daysUntilDeadline <= 3) {
                        status = 'due-soon';
                    }
                }
            } catch (error) {
                console.error('[REPORT] Error processing project deadline:', error);
            }
        }

        const projectInfo = {
            id: project.id,
            title: project.title,
            type: project.type,
            status: status,
            state: state.statusText,
            deadline: finalDeadline,
            daysUntilDeadline: daysUntilDeadline,
            proposalStatus: project.proposalStatus
        };

        if (project.authorId && userWorkload[project.authorId]) {
            userWorkload[project.authorId].projects.push(projectInfo);
            if (status === 'overdue') userWorkload[project.authorId].overdue++;
            else if (status === 'completed') userWorkload[project.authorId].completed++;
            else userWorkload[project.authorId].onTrack++;
        }

        if (project.editorId && userWorkload[project.editorId]) {
            userWorkload[project.editorId].projects.push(projectInfo);
            if (status === 'overdue') userWorkload[project.editorId].overdue++;
            else if (status === 'completed') userWorkload[project.editorId].completed++;
            else userWorkload[project.editorId].onTrack++;
        }
    });

    allTasks.forEach(task => {
        let status = 'on-track';
        let daysUntilDeadline = null;

        if (task.deadline) {
            try {
                const deadline = new Date(task.deadline + 'T00:00:00');
                if (!isNaN(deadline.getTime())) {
                    daysUntilDeadline = Math.ceil((deadline - now) / (1000 * 60 * 60 * 24));

                    if (task.status === 'completed') {
                        status = 'completed';
                    } else if (daysUntilDeadline < 0) {
                        status = 'overdue';
                    } else if (daysUntilDeadline <= 3) {
                        status = 'due-soon';
                    }
                }
            } catch (error) {
                console.error('[REPORT] Error processing task deadline:', error);
            }
        }

        const taskInfo = {
            id: task.id,
            title: task.title,
            status: status,
            taskStatus: task.status,
            deadline: task.deadline,
            daysUntilDeadline: daysUntilDeadline,
            priority: task.priority || 'medium'
        };

        const assigneeIds = task.assigneeIds || [task.assigneeId];
        assigneeIds.forEach(assigneeId => {
            if (assigneeId && userWorkload[assigneeId]) {
                userWorkload[assigneeId].tasks.push(taskInfo);
                if (status === 'overdue') userWorkload[assigneeId].overdue++;
                else if (status === 'completed') userWorkload[assigneeId].completed++;
                else userWorkload[assigneeId].onTrack++;
            }
        });
    });

    const totalOverdue = Object.values(userWorkload).reduce((sum, user) => sum + user.overdue, 0);
    const totalOnTrack = Object.values(userWorkload).reduce((sum, user) => sum + user.onTrack, 0);
    const totalCompleted = Object.values(userWorkload).reduce((sum, user) => sum + user.completed, 0);
    const activeUsers = Object.values(userWorkload).filter(u => u.projects.length > 0 || u.tasks.length > 0).length;

    let reportHTML = `
        <div class="report-header">
            <h2>📊 Comprehensive Team Status Report</h2>
            <p class="report-date">Generated: ${new Date().toLocaleString('en-US', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            })}</p>
        </div>

        <div class="report-section executive-summary">
            <h2>🎯 Executive Summary</h2>
            <div class="summary-grid">
                <div class="summary-item total">
                    <div class="summary-icon">👥</div>
                    <div class="summary-value">${activeUsers}</div>
                    <div class="summary-label">Active Team Members</div>
                </div>
                <div class="summary-item ${totalOverdue > 0 ? 'overdue' : ''}">
                    <div class="summary-icon">⚠️</div>
                    <div class="summary-value">${totalOverdue}</div>
                    <div class="summary-label">Overdue Items</div>
                </div>
                <div class="summary-item on-track">
                    <div class="summary-icon">🎯</div>
                    <div class="summary-value">${totalOnTrack}</div>
                    <div class="summary-label">On Track</div>
                </div>
                <div class="summary-item completed">
                    <div class="summary-icon">✅</div>
                    <div class="summary-value">${totalCompleted}</div>
                    <div class="summary-label">Completed</div>
                </div>
            </div>
        </div>
    `;

    const sortedUsers = Object.values(userWorkload)
        .filter(u => u.projects.length > 0 || u.tasks.length > 0)
        .sort((a, b) => {
            if (b.overdue !== a.overdue) return b.overdue - a.overdue;
            return (b.projects.length + b.tasks.length) - (a.projects.length + a.tasks.length);
        });

    if (sortedUsers.length > 0) {
        reportHTML += `
            <div class="report-section team-details">
                <h2>👥 Team Member Breakdown</h2>
        `;

        sortedUsers.forEach(user => {
            const totalItems = user.projects.length + user.tasks.length;
            const workloadLevel = totalItems > 10 ? 'high' : totalItems > 5 ? 'medium' : 'low';
            const performanceClass = user.overdue > 0 ? 'needs-attention' : user.onTrack > user.completed ? 'in-progress' : 'excellent';

            reportHTML += `
                <div class="user-card ${performanceClass}">
                    <div class="user-card-header">
                        <div class="user-info">
                            <div class="user-avatar" style="background-color: ${stringToColor(user.name)}">
                                ${user.name.charAt(0).toUpperCase()}
                            </div>
                            <div>
                                <h3>${escapeHtml(user.name)}</h3>
                                <p class="user-role">${escapeHtml(user.role)}</p>
                            </div>
                        </div>
                        <div class="workload-indicator ${workloadLevel}">
                            <div class="workload-count">${totalItems}</div>
                            <div class="workload-label">Total Items</div>
                        </div>
                    </div>

                    <div class="user-stats">
                        <div class="stat-item ${user.overdue > 0 ? 'overdue' : ''}">
                            <span class="stat-icon">⚠️</span>
                            <span class="stat-value">${user.overdue}</span>
                            <span class="stat-label">Overdue</span>
                        </div>
                        <div class="stat-item on-track">
                            <span class="stat-icon">🎯</span>
                            <span class="stat-value">${user.onTrack}</span>
                            <span class="stat-label">On Track</span>
                        </div>
                        <div class="stat-item completed">
                            <span class="stat-icon">✅</span>
                            <span class="stat-value">${user.completed}</span>
                            <span class="stat-label">Done</span>
                        </div>
                    </div>
            `;

            if (user.projects.length > 0) {
                reportHTML += `
                    <div class="user-work-section">
                        <h4>📝 Projects (${user.projects.length})</h4>
                        <div class="work-items">
                `;

                user.projects.forEach(project => {
                    const deadlineText = project.daysUntilDeadline !== null
                        ? (project.daysUntilDeadline < 0
                            ? `${Math.abs(project.daysUntilDeadline)} days overdue`
                            : `${project.daysUntilDeadline} days remaining`)
                        : 'No deadline';

                    reportHTML += `
                        <div class="work-item ${project.status}" data-id="${project.id}" onclick="openDetailsModal('${project.id}')">
                            <div class="work-item-header">
                                <span class="work-item-title">${escapeHtml(project.title)}</span>
                                <span class="work-item-type">${escapeHtml(project.type)}</span>
                            </div>
                            <div class="work-item-meta">
                                <span class="work-item-status">${escapeHtml(project.state)}</span>
                                <span class="work-item-deadline ${project.status}">${deadlineText}</span>
                            </div>
                        </div>
                    `;
                });

                reportHTML += `
                        </div>
                    </div>
                `;
            }

            if (user.tasks.length > 0) {
                reportHTML += `
                    <div class="user-work-section">
                        <h4>📋 Tasks (${user.tasks.length})</h4>
                        <div class="work-items">
                `;

                user.tasks.forEach(task => {
                    const deadlineText = task.daysUntilDeadline !== null
                        ? (task.daysUntilDeadline < 0
                            ? `${Math.abs(task.daysUntilDeadline)} days overdue`
                            : `${task.daysUntilDeadline} days remaining`)
                        : 'No deadline';

                    reportHTML += `
                        <div class="work-item ${task.status}" data-id="${task.id}" data-type="task" onclick="openTaskDetailsModal('${task.id}')">
                            <div class="work-item-header">
                                <span class="work-item-title">${escapeHtml(task.title)}</span>
                                <span class="priority-badge ${task.priority}">${task.priority.toUpperCase()}</span>
                            </div>
                            <div class="work-item-meta">
                                <span class="work-item-status">${escapeHtml(task.taskStatus)}</span>
                                <span class="work-item-deadline ${task.status}">${deadlineText}</span>
                            </div>
                        </div>
                    `;
                });

                reportHTML += `
                        </div>
                    </div>
                `;
            }

            reportHTML += `</div>`;
        });

        reportHTML += `</div>`;
    }

    reportHTML += `
        <div class="report-section recommendations">
            <h2>💡 Recommendations</h2>
            <div class="recommendation-list">
    `;

    const highWorkloadUsers = sortedUsers.filter(u => (u.projects.length + u.tasks.length) > 10);
    const overdueUsers = sortedUsers.filter(u => u.overdue > 0);

    if (overdueUsers.length > 0) {
        reportHTML += `
            <div class="recommendation-item urgent">
                <span class="recommendation-icon">🚨</span>
                <div>
                    <h4>Immediate Attention Required</h4>
                    <p>${overdueUsers.map(u => u.name).join(', ')} ${overdueUsers.length === 1 ? 'has' : 'have'} overdue items that need immediate attention.</p>
                </div>
            </div>
        `;
    }

    if (highWorkloadUsers.length > 0) {
        reportHTML += `
            <div class="recommendation-item warning">
                <span class="recommendation-icon">⚖️</span>
                <div>
                    <h4>High Workload Alert</h4>
                    <p>${highWorkloadUsers.map(u => u.name).join(', ')} ${highWorkloadUsers.length === 1 ? 'has' : 'have'} a high number of assignments. Consider redistributing workload.</p>
                </div>
            </div>
        `;
    }

    if (overdueUsers.length === 0 && totalOnTrack > totalCompleted) {
        reportHTML += `
            <div class="recommendation-item success">
                <span class="recommendation-icon">🎉</span>
                <div>
                    <h4>Team On Track</h4>
                    <p>No overdue items! The team is making good progress. Keep up the great work!</p>
                </div>
            </div>
        `;
    }

    reportHTML += `
            </div>
        </div>
    `;

    reportContent.innerHTML = reportHTML;
    reportModal.style.display = 'flex';
}

// ==================
//  Proposal Editing
// ==================
const PROPOSAL_PLACEHOLDER_TEXT = 'No proposal provided.';

function enableProposalEditing() {
    const displayElement = document.getElementById('details-proposal');
    const editBtn = document.getElementById('edit-proposal-button');
    const saveBtn = document.getElementById('save-proposal-button');
    const cancelBtn = document.getElementById('cancel-proposal-button');

    if (!displayElement) {
        console.error('[PROPOSAL EDIT] Display element not found');
        return;
    }

    // Prevent duplicate textareas if button is clicked multiple times
    const existingTextarea = document.getElementById('proposal-edit-textarea');
    if (existingTextarea) {
        existingTextarea.focus();
        existingTextarea.setSelectionRange(existingTextarea.value.length, existingTextarea.value.length);
        return;
    }

    let originalText = (displayElement.textContent || '').trim();
    if (originalText === PROPOSAL_PLACEHOLDER_TEXT) {
        originalText = '';
    }

    const textarea = document.createElement('textarea');
    textarea.id = 'proposal-edit-textarea';
    textarea.className = 'edit-proposal-textarea';
    textarea.value = originalText;
    textarea.dataset.originalText = originalText;
    textarea.setAttribute('aria-label', 'Edit proposal text');

    textarea.addEventListener('input', () => {
        textarea.style.height = 'auto';
        textarea.style.height = `${textarea.scrollHeight}px`;
    });

    const parent = displayElement.parentNode;
    if (parent) {
        parent.replaceChild(textarea, displayElement);
    }

    // Trigger autoresize once content is in place
    requestAnimationFrame(() => {
        textarea.dispatchEvent(new Event('input'));
        textarea.focus();
        textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    });

    if (editBtn) editBtn.style.display = 'none';
    if (saveBtn) saveBtn.style.display = 'inline-block';
    if (cancelBtn) cancelBtn.style.display = 'inline-block';
}

function disableProposalEditing({ revertToOriginal = false } = {}) {
    const textarea = document.getElementById('proposal-edit-textarea');
    let proposalElement = document.getElementById('details-proposal');
    const editBtn = document.getElementById('edit-proposal-button');
    const saveBtn = document.getElementById('save-proposal-button');
    const cancelBtn = document.getElementById('cancel-proposal-button');

    if (textarea) {
        const originalText = textarea.dataset.originalText || '';
        const finalText = revertToOriginal ? originalText : textarea.value.trim();
        const sanitizedFinal = finalText || '';

        const paragraph = document.createElement('p');
        paragraph.id = 'details-proposal';
        paragraph.textContent = sanitizedFinal || PROPOSAL_PLACEHOLDER_TEXT;
        paragraph.setAttribute('data-original-text', revertToOriginal ? originalText : sanitizedFinal);

        textarea.parentNode.replaceChild(paragraph, textarea);
        proposalElement = paragraph;
    } else if (proposalElement && revertToOriginal && proposalElement.hasAttribute('data-original-text')) {
        const originalText = proposalElement.getAttribute('data-original-text');
        proposalElement.textContent = originalText || PROPOSAL_PLACEHOLDER_TEXT;
    }

    if (!proposalElement) return;

    const projectId = currentlyViewedProjectId || window.currentlyViewedProjectId || null;
    const project = projectId ? allProjects.find(p => p.id === projectId) : null;
    const isAuthor = !!(project && currentUser && currentUser.uid === project.authorId);
    const isAdmin = currentUserRole === 'admin';
    const canEditProposal = !!project && (isAuthor || isAdmin);

    if (editBtn) editBtn.style.display = canEditProposal ? 'inline-block' : 'none';
    if (saveBtn) saveBtn.style.display = 'none';
    if (cancelBtn) cancelBtn.style.display = 'none';
}

async function handleSaveProposal() {
    const textarea = document.getElementById('proposal-edit-textarea');
    if (!textarea) {
        console.error('[SAVE PROPOSAL] Edit textarea not found');
        showNotification('Please click Edit before saving.', 'error');
        return;
    }

    const projectId = currentlyViewedProjectId ||
        window.currentlyViewedProjectId ||
        document.getElementById('details-modal')?.dataset?.projectId ||
        null;

    if (!projectId) {
        console.error('[SAVE PROPOSAL] No project ID available');
        showNotification('Error: No project selected.', 'error');
        return;
    }

    if (!currentlyViewedProjectId) {
        currentlyViewedProjectId = projectId;
    }
    if (typeof window !== 'undefined') {
        window.currentlyViewedProjectId = projectId;
    }

    const newProposal = textarea.value.trim();
    const originalText = textarea.dataset.originalText || '';

    if (!newProposal) {
        showNotification('Proposal cannot be empty.', 'error');
        textarea.focus();
        return;
    }

    if (newProposal === originalText) {
        showNotification('No changes to save.', 'info');
        disableProposalEditing();
        return;
    }

    const saveBtn = document.getElementById('save-proposal-button');
    const originalButtonText = saveBtn ? saveBtn.textContent : null;

    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';
        saveBtn.classList.add('loading');
    }

    textarea.disabled = true;

    try {
        if (!db) {
            throw new Error('Database connection not available');
        }

        await db.collection('projects').doc(projectId).update({
            proposal: newProposal,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            activity: firebase.firestore.FieldValue.arrayUnion({
                text: 'updated the proposal',
                authorName: currentUserName || 'Unknown User',
                timestamp: new Date()
            })
        });

        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = originalButtonText;
            saveBtn.classList.remove('loading');
        }

        textarea.disabled = false;
        textarea.dataset.originalText = newProposal;

        showNotification('Proposal updated successfully!', 'success');
        const project = allProjects.find(p => p.id === projectId);
        if (project) {
            project.proposal = newProposal;
        }
        disableProposalEditing();

    } catch (error) {
        console.error('[SAVE PROPOSAL ERROR]', error);
        showNotification('Failed to save proposal. Please try again.', 'error');

        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = originalButtonText;
            saveBtn.classList.remove('loading');
        }
        textarea.disabled = false;
    }
}

if (typeof window !== 'undefined') {
    window.handleSaveProposal = handleSaveProposal;
}

// ==================
//  Deadline Management
// ==================
async function handleSetDeadlines() {
    const projectId = currentlyViewedProjectId || window.currentlyViewedProjectId;
    
    if (!projectId) {
        showNotification('No project selected. Please try again.', 'error');
        return;
    }

    if (!currentlyViewedProjectId && typeof currentlyViewedProjectId !== 'undefined') {
        currentlyViewedProjectId = projectId;
    }
    if (!window.currentlyViewedProjectId) {
        window.currentlyViewedProjectId = projectId;
    }

    const projectIndex = allProjects.findIndex(p => p.id === projectId);
    if (projectIndex === -1) {
        console.error('[SET DEADLINES] Project not found:', projectId);
        showNotification('Project not found. Please refresh and try again.', 'error');
        return;
    }

    const project = allProjects[projectIndex];
    const existingDeadlines = project.deadlines || {};
    const updatedDeadlines = { ...existingDeadlines };

    const deadlineFields = [
        { key: 'contact', label: 'Contact Professor', inputId: 'deadline-contact' },
        { key: 'interview', label: 'Conduct Interview', inputId: 'deadline-interview' },
        { key: 'draft', label: 'Write Draft', inputId: 'deadline-draft' },
        { key: 'review', label: 'Editor Review', inputId: 'deadline-review' },
        { key: 'edits', label: 'Review Edits', inputId: 'deadline-edits' }
    ];

    let hasChanges = false;
    const changedLabels = [];

    deadlineFields.forEach(field => {
        const input = document.getElementById(field.inputId);
        if (!input) {
            console.warn(`[SET DEADLINES] Input not found: ${field.inputId}`);
            return;
        }

        const newValue = input.value ? input.value.trim() : '';
        const currentValue = existingDeadlines[field.key] || '';

        if (newValue) {
            if (currentValue !== newValue) {
                updatedDeadlines[field.key] = newValue;
                hasChanges = true;
                changedLabels.push(field.label);
            }
        } else if (currentValue) {
            delete updatedDeadlines[field.key];
            hasChanges = true;
            changedLabels.push(`${field.label} (cleared)`);
        }
    });

    if (!updatedDeadlines.publication) {
        if (existingDeadlines.publication) {
            updatedDeadlines.publication = existingDeadlines.publication;
        } else if (project.deadline) {
            updatedDeadlines.publication = project.deadline;
        }
    }

    if (!hasChanges) {
        showNotification('No deadline changes detected. Update at least one deadline before saving.', 'warning');
        return;
    }

    try {
        await db.collection('projects').doc(project.id).update({
            deadlines: updatedDeadlines,
            activity: firebase.firestore.FieldValue.arrayUnion({
                text: changedLabels.length > 0
                    ? `updated project deadlines (${changedLabels.join(', ')})`
                    : 'updated project deadlines',
                authorName: currentUserName,
                timestamp: new Date()
            })
        });

        allProjects[projectIndex] = { ...project, deadlines: updatedDeadlines };

        if (projectId === project.id) {
            refreshDetailsModal(allProjects[projectIndex]);
            attachProjectModalListeners();
        }

        showNotification('Deadlines updated successfully!', 'success');
    } catch (error) {
        console.error('[SET DEADLINES ERROR]', error);
        showNotification('Failed to save deadlines. Please try again.', 'error');
    }
}

if (typeof window !== 'undefined') {
    window.__deadlineHandlerV2Applied = true;
}

async function handleRequestDeadlineChange() {
    if (!currentlyViewedProjectId) return;

    const reason = prompt('Please provide a reason for requesting deadline changes:');
    if (!reason || !reason.trim()) {
        showNotification('Please provide a reason for the deadline change request.', 'error');
        return;
    }

    const requestedDeadlines = {
        contact: document.getElementById('deadline-contact')?.value || '',
        interview: document.getElementById('deadline-interview')?.value || '',
        draft: document.getElementById('deadline-draft')?.value || '',
        review: document.getElementById('deadline-review')?.value || '',
        edits: document.getElementById('deadline-edits')?.value || ''
    };

    try {
        await db.collection('projects').doc(currentlyViewedProjectId).update({
            deadlineChangeRequest: {
                requestedBy: currentUserName,
                requestedDeadlines: requestedDeadlines,
                reason: reason.trim(),
                status: 'pending',
                requestedAt: new Date()
            },
            activity: firebase.firestore.FieldValue.arrayUnion({
                text: `requested deadline changes. Reason: ${reason.trim()}`,
                authorName: currentUserName,
                timestamp: new Date()
            })
        });

        showNotification('Deadline change request submitted successfully!', 'success');

    } catch (error) {
        console.error('[DEADLINE REQUEST ERROR]', error);
        showNotification('Failed to submit deadline request. Please try again.', 'error');
    }
}

async function handleApproveDeadlineRequest() {
    if (!currentlyViewedProjectId) return;

    const project = allProjects.find(p => p.id === currentlyViewedProjectId);
    if (!project) return;

    const request = project.deadlineRequest || project.deadlineChangeRequest;
    if (!request) return;

    try {
        const updates = {
            activity: firebase.firestore.FieldValue.arrayUnion({
                text: `approved deadline change request from ${request.requestedBy}`,
                authorName: currentUserName,
                timestamp: new Date()
            })
        };

        if (project.deadlineRequest) {
            updates.deadline = request.requestedDate;
            updates['deadlines.publication'] = request.requestedDate;
            updates.deadlineRequest = firebase.firestore.FieldValue.delete();
        } else if (project.deadlineChangeRequest) {
            updates.deadlines = request.requestedDeadlines;
            updates.deadlineChangeRequest = firebase.firestore.FieldValue.delete();
        }

        await db.collection('projects').doc(currentlyViewedProjectId).update(updates);

        showNotification('Deadline request approved!', 'success');

    } catch (error) {
        console.error('[APPROVE DEADLINE ERROR]', error);
        showNotification('Failed to approve deadline request. Please try again.', 'error');
    }
}

async function handleRejectDeadlineRequest() {
    if (!currentlyViewedProjectId) return;

    const project = allProjects.find(p => p.id === currentlyViewedProjectId);
    if (!project) return;

    const request = project.deadlineRequest || project.deadlineChangeRequest;
    if (!request) return;

    try {
        const updates = {
            activity: firebase.firestore.FieldValue.arrayUnion({
                text: `rejected deadline change request from ${request.requestedBy}`,
                authorName: currentUserName,
                timestamp: new Date()
            })
        };

        if (project.deadlineRequest) {
            updates.deadlineRequest = firebase.firestore.FieldValue.delete();
        } else if (project.deadlineChangeRequest) {
            updates.deadlineChangeRequest = firebase.firestore.FieldValue.delete();
        }

        await db.collection('projects').doc(currentlyViewedProjectId).update(updates);

        showNotification('Deadline request rejected.', 'info');

    } catch (error) {
        console.error('[REJECT DEADLINE ERROR]', error);
        showNotification('Failed to reject deadline request. Please try again.', 'error');
    }
}

window.handleApproveDeadlineRequest = handleApproveDeadlineRequest;
window.handleRejectDeadlineRequest = handleRejectDeadlineRequest;

// ==================
//  General Helper Functions
// ==================
function stringToColor(str) {
    if (!str) return '#cccccc';
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    let color = '#';
    for (let i = 0; i < 3; i++) {
        let value = (hash >> (i * 8)) & 0xFF;
        color += ('00' + value.toString(16)).substr(-2);
    }
    return color;
}

function calculateProgress(timeline) {
    if (!timeline) return 0;
    const totalTasks = Object.keys(timeline).length;
    const completedTasks = Object.values(timeline).filter(Boolean).length;
    return totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0;
}

function isValidDate(dateString) {
    const date = new Date(dateString);
    return date instanceof Date && !isNaN(date) && dateString.match(/^\d{4}-\d{2}-\d{2}$/);
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showNotification(message, type = 'success') {
    let container = document.getElementById('notification-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'notification-container';
        container.className = 'notification-container';
        container.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 10000;
            pointer-events: none;
        `;
        document.body.appendChild(container);
    }

    const notification = document.createElement('div');
    notification.className = 'notification';
    notification.style.cssText = `
        padding: 16px 20px;
        margin-bottom: 8px;
        border-radius: 12px;
        color: white;
        font-weight: 600;
        font-size: 14px;
        box-shadow: 0 10px 25px rgba(0, 0, 0, 0.2);
        transform: translateX(400px);
        transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        max-width: 350px;
        pointer-events: auto;
        position: relative;
    `;

    if (type === 'success') {
        notification.style.background = 'linear-gradient(135deg, #10b981, #059669)';
    } else if (type === 'error') {
        notification.style.background = 'linear-gradient(135deg, #ef4444, #dc2626)';
    } else if (type === 'warning') {
        notification.style.background = 'linear-gradient(135deg, #f59e0b, #d97706)';
    } else {
        notification.style.background = 'linear-gradient(135deg, #3b82f6, #2563eb)';
    }

    notification.textContent = message;
    container.appendChild(notification);

    setTimeout(() => {
        notification.style.transform = 'translateX(0)';
    }, 100);

    setTimeout(() => {
        notification.style.transform = 'translateX(400px)';
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 300);
    }, 4000);
}

function getTaskAssigneeNames(task) {
    if (Array.isArray(task.assigneeNames) && task.assigneeNames.length > 0) {
        return task.assigneeNames.filter(name => name && name.trim());
    } else if (task.assigneeName && task.assigneeName.trim()) {
        return [task.assigneeName];
    }
    return ['Unassigned'];
}

function getTaskAssigneeIds(task) {
    if (Array.isArray(task.assigneeIds) && task.assigneeIds.length > 0) {
        return task.assigneeIds.filter(id => id && id.trim());
    } else if (task.assigneeId && task.assigneeId.trim()) {
        return [task.assigneeId];
    }
    return [];
}

function isUserAssignedToTask(task, userId) {
    if (!task) return false;
    if (task.creatorId === userId) return true;
    const assigneeIds = getTaskAssigneeIds(task);
    return assigneeIds.includes(userId);
}

window.toggleAssignee = toggleAssignee;
window.removeAssignee = removeAssignee;
