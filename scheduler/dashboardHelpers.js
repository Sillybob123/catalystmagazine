// ===============================
// Dashboard Helper Functions
// These functions support the main dashboard functionality
// ===============================

/**
 * Handle setting deadlines (backup function)
 * Primary implementation is in deadlineFixes_APPLY.js
 */
async function handleSetDeadlines() {
    console.log('[DEADLINES BACKUP] Starting to set deadlines...');
    
    // Try to get the project ID from multiple sources
    const projectId = currentlyViewedProjectId || window.currentlyViewedProjectId;
    
    if (!projectId) {
        console.error('[DEADLINES BACKUP] No project ID found');
        showNotification('No project selected. Please try again.', 'error');
        return;
    }
    
    const project = allProjects.find(p => p.id === projectId);
    if (!project) {
        console.error('[DEADLINES BACKUP] Project not found:', projectId);
        showNotification('Project not found. Please refresh the page.', 'error');
        return;
    }
    
    console.log('[DEADLINES BACKUP] Current project:', project);
    console.log('[DEADLINES BACKUP] Existing deadlines:', project.deadlines);
    
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
    
    // Collect all deadline values from the form
    console.log('[DEADLINES BACKUP] Reading deadline values from form...');
    deadlineFields.forEach(field => {
        const input = document.getElementById(field.inputId);
        if (input) {
            const value = input.value;
            console.log(`[DEADLINES BACKUP] ${field.label} (${field.key}): "${value}"`);
            
            // Only update if value exists and has changed
            if (value && value.trim() !== '') {
                if (newDeadlines[field.key] !== value) {
                    newDeadlines[field.key] = value;
                    hasChanges = true;
                    updatedFields.push(field.label);
                    console.log(`[DEADLINES BACKUP] ✓ ${field.label} will be updated to: ${value}`);
                }
            }
        } else {
            console.error(`[DEADLINES BACKUP] ✗ Input field not found: ${field.inputId}`);
        }
    });
    
    console.log('[DEADLINES BACKUP] Summary:');
    console.log('  - Has changes:', hasChanges);
    console.log('  - Updated fields:', updatedFields);
    console.log('  - New deadlines object:', newDeadlines);
    
    // Validate that at least one deadline was set
    if (!hasChanges) {
        showNotification('No changes detected. Please set or update at least one deadline.', 'warning');
        console.log('[DEADLINES BACKUP] No changes to save');
        return;
    }
    
    try {
        console.log('[DEADLINES BACKUP] Attempting to save to Firestore...');
        console.log('[DEADLINES BACKUP] Project ID:', projectId);
        console.log('[DEADLINES BACKUP] Saving deadlines:', newDeadlines);
        
        // Update Firestore
        await db.collection('projects').doc(projectId).update({
            deadlines: newDeadlines,
            activity: firebase.firestore.FieldValue.arrayUnion({
                text: `updated deadlines: ${updatedFields.join(', ')}`,
                authorName: currentUserName,
                timestamp: new Date()
            })
        });
        
        console.log('[DEADLINES BACKUP] ✅ Successfully saved to Firestore!');
        showNotification(`Deadlines updated successfully! Updated: ${updatedFields.join(', ')}`, 'success');
        
        // Update local project object
        const projectIndex = allProjects.findIndex(p => p.id === projectId);
        if (projectIndex !== -1) {
            allProjects[projectIndex].deadlines = newDeadlines;
            console.log('[DEADLINES BACKUP] Updated local project object');
        }
        
    } catch (error) {
        console.error('[DEADLINES BACKUP] ❌ Failed to save deadlines:', error);
        console.error('[DEADLINES BACKUP] Error code:', error.code);
        console.error('[DEADLINES BACKUP] Error message:', error.message);
        
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
 * Handle requesting deadline changes
 */
async function handleRequestDeadlineChange() {
    if (!currentlyViewedProjectId) return;
    
    const reason = prompt('Please provide a reason for the deadline change request:');
    if (!reason || !reason.trim()) {
        showNotification('Please provide a reason for the deadline change.', 'error');
        return;
    }
    
    const requestedDeadlines = {};
    const fields = ['contact', 'interview', 'draft', 'review', 'edits'];
    
    fields.forEach(field => {
        const input = document.getElementById(`deadline-${field}`);
        if (input && input.value) {
            requestedDeadlines[field] = input.value;
        }
    });
    
    try {
        await db.collection('projects').doc(currentlyViewedProjectId).update({
            deadlineChangeRequest: {
                requestedBy: currentUserName,
                requestedDeadlines: requestedDeadlines,
                reason: reason.trim(),
                status: 'pending',
                requestedAt: firebase.firestore.FieldValue.serverTimestamp()
            },
            activity: firebase.firestore.FieldValue.arrayUnion({
                text: `requested deadline changes. Reason: ${reason.trim()}`,
                authorName: currentUserName,
                timestamp: new Date()
            })
        });
        
        showNotification('Deadline change request submitted successfully!', 'success');
        
    } catch (error) {
        console.error('[ERROR] Failed to request deadline change:', error);
        showNotification('Failed to submit deadline change request. Please try again.', 'error');
    }
}

/**
 * Handle approving deadline request
 */
async function handleApproveDeadlineRequest() {
    if (!currentlyViewedProjectId) return;
    
    const project = allProjects.find(p => p.id === currentlyViewedProjectId);
    if (!project) return;
    
    try {
        const updates = {
            activity: firebase.firestore.FieldValue.arrayUnion({
                text: 'approved deadline change request',
                authorName: currentUserName,
                timestamp: new Date()
            })
        };
        
        if (project.deadlineRequest) {
            updates.deadline = project.deadlineRequest.requestedDate;
            updates['deadlines.publication'] = project.deadlineRequest.requestedDate;
            updates.deadlineRequest = firebase.firestore.FieldValue.delete();
        } else if (project.deadlineChangeRequest) {
            updates.deadlines = project.deadlineChangeRequest.requestedDeadlines;
            updates.deadlineChangeRequest = firebase.firestore.FieldValue.delete();
        }
        
        await db.collection('projects').doc(currentlyViewedProjectId).update(updates);
        
        showNotification('Deadline request approved!', 'success');
        
    } catch (error) {
        console.error('[ERROR] Failed to approve deadline request:', error);
        showNotification('Failed to approve deadline request. Please try again.', 'error');
    }
}

/**
 * Handle rejecting deadline request
 */
async function handleRejectDeadlineRequest() {
    if (!currentlyViewedProjectId) return;
    
    const project = allProjects.find(p => p.id === currentlyViewedProjectId);
    if (!project) return;
    
    try {
        const updates = {
            activity: firebase.firestore.FieldValue.arrayUnion({
                text: 'rejected deadline change request',
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
        console.error('[ERROR] Failed to reject deadline request:', error);
        showNotification('Failed to reject deadline request. Please try again.', 'error');
    }
}

/**
 * Generate comprehensive status report with detailed person information
 */
function generateStatusReport() {
    console.log('[REPORT] Generating enhanced status report...');
    
    const reportModal = document.getElementById('report-modal');
    const reportContent = document.getElementById('report-content');
    
    if (!reportModal || !reportContent) {
        console.error('[REPORT] Modal elements not found');
        return;
    }
    
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    
    // Calculate overall statistics
    const totalProjects = allProjects.length;
    const completedProjects = allProjects.filter(p => {
        const state = getProjectState(p, currentView, currentUser);
        return state.column === 'Completed';
    }).length;
    const inProgressProjects = allProjects.filter(p => {
        const state = getProjectState(p, currentView, currentUser);
        return state.column === 'In Progress';
    }).length;
    const pendingProjects = allProjects.filter(p => p.proposalStatus === 'pending').length;
    const approvedProjects = allProjects.filter(p => {
        const state = getProjectState(p, currentView, currentUser);
        return state.column === 'Approved';
    }).length;
    
    // Count overdue projects
    const overdueProjects = allProjects.filter(p => {
        const finalDeadline = p.deadlines?.publication || p.deadline;
        if (!finalDeadline) return false;
        const deadline = new Date(finalDeadline);
        deadline.setHours(0, 0, 0, 0);
        const state = getProjectState(p, currentView, currentUser);
        return deadline < now && state.column !== 'Completed';
    }).length;
    
    let html = '<div class="report-header">';
    html += '<h2>📊 Comprehensive Status Report</h2>';
    html += `<p class="report-timestamp">Generated on ${now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>`;
    html += '</div>';
    
    // Overall Summary Section
    html += '<div class="report-section report-summary">';
    html += '<h3>📈 Overall Summary</h3>';
    html += '<div class="stats-grid">';
    html += `<div class="stat-card"><div class="stat-number">${totalProjects}</div><div class="stat-label">Total Projects</div></div>`;
    html += `<div class="stat-card completed"><div class="stat-number">${completedProjects}</div><div class="stat-label">Completed</div></div>`;
    html += `<div class="stat-card in-progress"><div class="stat-number">${inProgressProjects}</div><div class="stat-label">In Progress</div></div>`;
    html += `<div class="stat-card pending"><div class="stat-number">${pendingProjects}</div><div class="stat-label">Pending Approval</div></div>`;
    html += `<div class="stat-card approved"><div class="stat-number">${approvedProjects}</div><div class="stat-label">Approved</div></div>`;
    html += `<div class="stat-card overdue"><div class="stat-number">${overdueProjects}</div><div class="stat-label">Overdue</div></div>`;
    html += '</div>';
    html += '</div>';
    
    // Task Overview Section
    html += '<div class="report-section">';
    html += '<h3>✅ Task Status</h3>';
    const totalTasks = allTasks.length;
    const completedTasks = allTasks.filter(t => t.status === 'completed').length;
    const pendingTasks = allTasks.filter(t => t.status === 'pending').length;
    const approvedTasks = allTasks.filter(t => t.status === 'approved').length;
    const overdueTasks = allTasks.filter(t => {
        if (t.status === 'completed' || !t.deadline) return false;
        const taskDeadline = new Date(t.deadline);
        taskDeadline.setHours(0, 0, 0, 0);
        return taskDeadline < now;
    }).length;
    
    html += '<div class="stats-grid">';
    html += `<div class="stat-card"><div class="stat-number">${totalTasks}</div><div class="stat-label">Total Tasks</div></div>`;
    html += `<div class="stat-card completed"><div class="stat-number">${completedTasks}</div><div class="stat-label">Completed</div></div>`;
    html += `<div class="stat-card approved"><div class="stat-number">${approvedTasks}</div><div class="stat-label">Approved</div></div>`;
    html += `<div class="stat-card pending"><div class="stat-number">${pendingTasks}</div><div class="stat-label">Pending</div></div>`;
    html += `<div class="stat-card overdue"><div class="stat-number">${overdueTasks}</div><div class="stat-label">Overdue</div></div>`;
    html += '</div>';
    html += '</div>';
    
    // Detailed Team Member Reports
    html += '<div class="report-section team-details">';
    html += '<h3>👥 Detailed Team Member Reports</h3>';
    
    // Build detailed workload for each user
    const userDetails = {};
    allUsers.forEach(user => {
        userDetails[user.id] = {
            name: user.name,
            role: user.role || 'writer',
            authoredProjects: [],
            editingProjects: [],
            assignedTasks: [],
            overdueProjects: [],
            overdueTasks: [],
            upcomingDeadlines: []
        };
    });
    
    // Collect project details for each user
    allProjects.forEach(project => {
        const state = getProjectState(project, currentView, currentUser);
        const finalDeadline = project.deadlines?.publication || project.deadline;
        const isOverdue = finalDeadline && new Date(finalDeadline) < now && state.column !== 'Completed';
        const daysUntilDeadline = finalDeadline ? Math.ceil((new Date(finalDeadline) - now) / (1000 * 60 * 60 * 24)) : null;
        
        const projectInfo = {
            title: project.title,
            status: state.statusText,
            deadline: finalDeadline ? new Date(finalDeadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'No deadline',
            isOverdue: isOverdue,
            daysUntilDeadline: daysUntilDeadline,
            progress: calculateProgress(project.timeline),
            type: project.type
        };
        
        // Add to author's list
        if (project.authorId && userDetails[project.authorId]) {
            userDetails[project.authorId].authoredProjects.push(projectInfo);
            if (isOverdue) {
                userDetails[project.authorId].overdueProjects.push(projectInfo);
            }
            if (daysUntilDeadline !== null && daysUntilDeadline >= 0 && daysUntilDeadline <= 7) {
                userDetails[project.authorId].upcomingDeadlines.push(projectInfo);
            }
        }
        
        // Add to editor's list
        if (project.editorId && userDetails[project.editorId]) {
            userDetails[project.editorId].editingProjects.push(projectInfo);
            if (isOverdue) {
                userDetails[project.editorId].overdueProjects.push(projectInfo);
            }
            if (daysUntilDeadline !== null && daysUntilDeadline >= 0 && daysUntilDeadline <= 7) {
                userDetails[project.editorId].upcomingDeadlines.push(projectInfo);
            }
        }
    });
    
    // Collect task details for each user
    allTasks.forEach(task => {
        const isOverdue = task.status !== 'completed' && task.deadline && new Date(task.deadline) < now;
        const daysUntilDeadline = task.deadline ? Math.ceil((new Date(task.deadline) - now) / (1000 * 60 * 60 * 24)) : null;
        
        const taskInfo = {
            title: task.title,
            status: (task.status || 'pending').replace('_', ' '),
            deadline: task.deadline ? new Date(task.deadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'No deadline',
            isOverdue: isOverdue,
            daysUntilDeadline: daysUntilDeadline,
            priority: task.priority || 'medium'
        };
        
        // Add to all assignees
        const assigneeIds = task.assigneeIds || (task.assigneeId ? [task.assigneeId] : []);
        assigneeIds.forEach(assigneeId => {
            if (userDetails[assigneeId]) {
                userDetails[assigneeId].assignedTasks.push(taskInfo);
                if (isOverdue) {
                    userDetails[assigneeId].overdueTasks.push(taskInfo);
                }
                if (daysUntilDeadline !== null && daysUntilDeadline >= 0 && daysUntilDeadline <= 7) {
                    userDetails[assigneeId].upcomingDeadlines.push(taskInfo);
                }
            }
        });
    });
    
    // Render detailed report for each user
    Object.values(userDetails).forEach(user => {
        const totalWorkItems = user.authoredProjects.length + user.editingProjects.length + user.assignedTasks.length;
        const totalOverdue = user.overdueProjects.length + user.overdueTasks.length;
        
        // Skip users with no work items
        if (totalWorkItems === 0) return;
        
        html += '<div class="user-report-card">';
        html += `<div class="user-report-header">`;
        html += `<div class="user-info">`;
        html += `<div class="user-avatar" style="background-color: ${stringToColor(user.name)}">${user.name.charAt(0).toUpperCase()}</div>`;
        html += `<div>`;
        html += `<h4>${escapeHtml(user.name)}</h4>`;
        html += `<p class="user-role">${escapeHtml(user.role.toUpperCase())}</p>`;
        html += `</div>`;
        html += `</div>`;
        html += `<div class="user-workload-summary">`;
        html += `<div class="workload-stat"><strong>${totalWorkItems}</strong> Total Items</div>`;
        if (totalOverdue > 0) {
            html += `<div class="workload-stat overdue"><strong>${totalOverdue}</strong> Overdue ⚠️</div>`;
        } else {
            html += `<div class="workload-stat on-track"><strong>✓</strong> On Track</div>`;
        }
        html += `</div>`;
        html += `</div>`;
        
        // Overdue items (if any)
        if (totalOverdue > 0) {
            html += '<div class="overdue-section">';
            html += '<h5 style="color: #ef4444; margin-bottom: 8px;">⚠️ OVERDUE ITEMS</h5>';
            
            user.overdueProjects.forEach(proj => {
                const daysOverdue = Math.abs(proj.daysUntilDeadline);
                html += '<div class="work-item overdue-item">';
                html += `<div class="item-title">📝 ${escapeHtml(proj.title)}</div>`;
                html += `<div class="item-meta">`;
                html += `<span class="item-status">${escapeHtml(proj.status)}</span>`;
                html += `<span class="item-deadline overdue">${proj.deadline} (${daysOverdue} days overdue)</span>`;
                html += `<span class="item-progress">${proj.progress}% complete</span>`;
                html += `</div>`;
                html += '</div>';
            });
            
            user.overdueTasks.forEach(task => {
                const daysOverdue = Math.abs(task.daysUntilDeadline);
                html += '<div class="work-item overdue-item">';
                html += `<div class="item-title">📋 ${escapeHtml(task.title)}</div>`;
                html += `<div class="item-meta">`;
                html += `<span class="item-status">${escapeHtml(task.status)}</span>`;
                html += `<span class="item-priority priority-${task.priority}">${task.priority.toUpperCase()}</span>`;
                html += `<span class="item-deadline overdue">${task.deadline} (${daysOverdue} days overdue)</span>`;
                html += `</div>`;
                html += '</div>';
            });
            
            html += '</div>';
        }
        
        // Upcoming deadlines (within 7 days)
        const upcomingNonOverdue = user.upcomingDeadlines.filter(item => !item.isOverdue);
        if (upcomingNonOverdue.length > 0) {
            html += '<div class="upcoming-section">';
            html += '<h5 style="color: #f59e0b; margin-bottom: 8px;">⏰ UPCOMING (Next 7 Days)</h5>';
            
            upcomingNonOverdue.forEach(item => {
                html += '<div class="work-item upcoming-item">';
                html += `<div class="item-title">${item.type ? '📝' : '📋'} ${escapeHtml(item.title)}</div>`;
                html += `<div class="item-meta">`;
                html += `<span class="item-status">${escapeHtml(item.status)}</span>`;
                html += `<span class="item-deadline due-soon">${item.deadline} (${item.daysUntilDeadline} days)</span>`;
                if (item.progress !== undefined) {
                    html += `<span class="item-progress">${item.progress}% complete</span>`;
                }
                html += `</div>`;
                html += '</div>';
            });
            
            html += '</div>';
        }
        
        // All projects as author
        if (user.authoredProjects.length > 0) {
            html += '<div class="work-section">';
            html += `<h5>📝 Authored Projects (${user.authoredProjects.length})</h5>`;
            user.authoredProjects.forEach(proj => {
                if (proj.isOverdue) return; // Already shown in overdue section
                html += '<div class="work-item">';
                html += `<div class="item-title">${escapeHtml(proj.title)}</div>`;
                html += `<div class="item-meta">`;
                html += `<span class="item-status">${escapeHtml(proj.status)}</span>`;
                html += `<span class="item-type">${proj.type}</span>`;
                if (proj.daysUntilDeadline !== null && proj.daysUntilDeadline >= 0) {
                    html += `<span class="item-deadline">${proj.deadline} (${proj.daysUntilDeadline} days)</span>`;
                } else {
                    html += `<span class="item-deadline">${proj.deadline}</span>`;
                }
                html += `<span class="item-progress">${proj.progress}% complete</span>`;
                html += `</div>`;
                html += '</div>';
            });
            html += '</div>';
        }
        
        // All projects as editor
        if (user.editingProjects.length > 0) {
            html += '<div class="work-section">';
            html += `<h5>✏️ Editing Projects (${user.editingProjects.length})</h5>`;
            user.editingProjects.forEach(proj => {
                if (proj.isOverdue) return; // Already shown in overdue section
                html += '<div class="work-item">';
                html += `<div class="item-title">${escapeHtml(proj.title)}</div>`;
                html += `<div class="item-meta">`;
                html += `<span class="item-status">${escapeHtml(proj.status)}</span>`;
                html += `<span class="item-type">${proj.type}</span>`;
                if (proj.daysUntilDeadline !== null && proj.daysUntilDeadline >= 0) {
                    html += `<span class="item-deadline">${proj.deadline} (${proj.daysUntilDeadline} days)</span>`;
                } else {
                    html += `<span class="item-deadline">${proj.deadline}</span>`;
                }
                html += `<span class="item-progress">${proj.progress}% complete</span>`;
                html += `</div>`;
                html += '</div>';
            });
            html += '</div>';
        }
        
        // All assigned tasks
        if (user.assignedTasks.length > 0) {
            html += '<div class="work-section">';
            html += `<h5>📋 Assigned Tasks (${user.assignedTasks.length})</h5>`;
            user.assignedTasks.forEach(task => {
                if (task.isOverdue) return; // Already shown in overdue section
                html += '<div class="work-item">';
                html += `<div class="item-title">${escapeHtml(task.title)}</div>`;
                html += `<div class="item-meta">`;
                html += `<span class="item-status">${escapeHtml(task.status)}</span>`;
                html += `<span class="item-priority priority-${task.priority}">${task.priority.toUpperCase()}</span>`;
                if (task.daysUntilDeadline !== null && task.daysUntilDeadline >= 0) {
                    html += `<span class="item-deadline">${task.deadline} (${task.daysUntilDeadline} days)</span>`;
                } else {
                    html += `<span class="item-deadline">${task.deadline}</span>`;
                }
                html += `</div>`;
                html += '</div>';
            });
            html += '</div>';
        }
        
        html += '</div>'; // Close user-report-card
    });
    
    html += '</div>'; // Close team-details section
    
    reportContent.innerHTML = html;
    reportModal.style.display = 'flex';
    console.log('[REPORT] Enhanced status report generated successfully');
}

/**
 * Handle task completion checkbox changes in project timeline
 * @param {string} projectId - The project ID
 * @param {string} taskName - The name of the task
 * @param {boolean} isCompleted - Whether the task is completed
 * @param {object} db - Firestore database instance
 * @param {string} userName - Current user's name
 */
async function handleTaskCompletion(projectId, taskName, isCompleted, db, userName) {
    console.log('[TASK COMPLETION] Updating task:', {
        projectId,
        taskName,
        isCompleted,
        userName
    });
    
    try {
        const updateData = {
            [`timeline.${taskName}`]: isCompleted,
            activity: firebase.firestore.FieldValue.arrayUnion({  
                text: isCompleted ? `completed: ${taskName}` : `uncompleted: ${taskName}`,
                authorName: userName,
                timestamp: new Date()
            })
        };
        
        console.log('[TASK COMPLETION] Update data:', updateData);
        
        await db.collection('projects').doc(projectId).update(updateData);
        
        showNotification(
            isCompleted ? `Task "${taskName}" marked as complete!` : `Task "${taskName}" unmarked.`,
            'success'
        );
        
        console.log('[TASK COMPLETION] Task updated successfully');
    } catch (error) {
        console.error('[TASK COMPLETION ERROR] Failed to update task:', error);
        console.error('[TASK COMPLETION ERROR] Error code:', error.code);
        console.error('[TASK COMPLETION ERROR] Error message:', error.message);
        
        // Provide user-friendly error message
        let errorMessage = 'Failed to update checklist. ';
        if (error.code === 'permission-denied') {
            errorMessage += 'Please update Firestore security rules to allow timeline updates. See FIRESTORE_SECURITY_RULES.txt file.';
        } else {
            errorMessage += 'Please try again or contact support.';
        }
        
        showNotification(errorMessage, 'error');
        throw error; // Re-throw to allow caller to handle
    }
}

console.log('[HELPERS] Dashboard helper functions loaded');
