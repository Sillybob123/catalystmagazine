// ===================================
// Catalyst Tracker - FIXED State Manager
// ===================================

/**
 * Determines the precise state of a project, including its column, color, and status text.
 * This handles ALL workflow transitions properly and ensures cards move between columns.
 *
 * @param {object} project - The project object from Firestore.
 * @param {string} view - The current view ('interviews', 'opeds', 'my-assignments').
 * @param {object} currentUser - Object with uid property for current user.
 * @returns {object} An object containing { column, color, statusText }.
 */
function getProjectState(project, view, currentUser) {
    const timeline = project.timeline || {};
    
    console.log('[STATE] Evaluating project:', project.title, 'Status:', project.proposalStatus, 'Type:', project.type);

    // ========================================
    // FINAL COMPLETED STATE (Highest Priority)
    // ========================================
    if (timeline["Suggestions Reviewed"]) {
        const column = view === 'my-assignments' ? "Done" : "Completed";
        console.log(`[STATE] ${project.title} -> COMPLETED`);
        return { column, color: 'green', statusText: 'Article Completed' };
    }

    // ========================================
    // MY ASSIGNMENTS VIEW (Personalized Logic)
    // ========================================
    if (view === 'my-assignments') {
        const isAuthor = project.authorId === currentUser.uid;
        const isEditor = project.editorId === currentUser.uid;

        console.log(`[MY ASSIGNMENTS] Author: ${isAuthor}, Editor: ${isEditor}`);

        // EDITOR TASKS
        if (isEditor) {
            // Editor needs to start/continue review
            if (timeline["Article Writing Complete"] && !timeline["Review Complete"]) {
                return { column: "In Progress", color: 'yellow', statusText: "Reviewing Article" };
            }
            // Editor finished their part
            if (timeline["Review Complete"]) {
                return { column: "Done", color: 'default', statusText: "Review Complete" };
            }
            // Editor assigned but article not ready yet
            if (!timeline["Article Writing Complete"]) {
                return { column: "To Do", color: 'default', statusText: "Waiting for Article" };
            }
        }

        // AUTHOR TASKS
        if (isAuthor) {
            // Author needs to review editor suggestions
            if (timeline["Review Complete"] && !timeline["Suggestions Reviewed"]) {
                return { column: "In Review", color: 'blue', statusText: "Review Editor Feedback" };
            }
            
            // Author approved, working on interview or writing
            if (project.proposalStatus === 'approved') {
                // Interview type - needs interview first
                if (project.type === 'Interview' && !timeline["Interview Complete"]) {
                    if (timeline["Interview Scheduled"]) {
                        return { column: "In Progress", color: 'yellow', statusText: "Conduct Interview" };
                    } else {
                        return { column: "To Do", color: 'default', statusText: "Schedule Interview" };
                    }
                }
                
                // Writing phase
                if (!timeline["Article Writing Complete"]) {
                    return { column: "In Progress", color: 'yellow', statusText: "Writing Article" };
                }
                
                // Waiting for editor assignment
                if (timeline["Article Writing Complete"] && !project.editorId) {
                    return { column: "In Progress", color: 'yellow', statusText: "Awaiting Editor Assignment" };
                }
                
                // Article complete, editor assigned, waiting for review
                if (timeline["Article Writing Complete"] && project.editorId && !timeline["Review Complete"]) {
                    return { column: "In Review", color: 'default', statusText: "Under Review" };
                }
            }
            
            // Proposal pending/rejected
            return { column: "To Do", color: 'default', statusText: `Proposal: ${project.proposalStatus}` };
        }

        // Fallback for my-assignments
        return { column: "To Do", color: 'default', statusText: "Pending" };
    }

    // ========================================
    // MAIN WORKFLOW VIEWS (interviews & opeds)
    // ========================================

    // 1. TOPIC PROPOSAL STAGE
    if (project.proposalStatus !== 'approved') {
        console.log(`[STATE] ${project.title} -> PROPOSAL (${project.proposalStatus})`);
        let color = 'default';
        if (project.proposalStatus === 'rejected') color = 'red';
        return { 
            column: "Topic Proposal", 
            color: color, 
            statusText: `Proposal ${project.proposalStatus}` 
        };
    }

    // 2. INTERVIEW STAGE (Interview projects only)
    if (project.type === 'Interview' && !timeline["Interview Complete"]) {
        console.log(`[STATE] ${project.title} -> INTERVIEW STAGE`);
        
        // Interview scheduled but not complete
        if (timeline["Interview Scheduled"]) {
            return { 
                column: "Interview Stage", 
                color: 'yellow', 
                statusText: "Interview Scheduled" 
            };
        }
        
        // Interview not yet scheduled
        return { 
            column: "Interview Stage", 
            color: 'default', 
            statusText: "Schedule Interview" 
        };
    }

    // 3. WRITING STAGE
    if (!timeline["Article Writing Complete"]) {
        console.log(`[STATE] ${project.title} -> WRITING STAGE`);
        return { 
            column: "Writing Stage", 
            color: 'yellow', 
            statusText: "Writing in Progress" 
        };
    }

    // 4. POST-WRITING: Editor Assignment & Review
    if (timeline["Article Writing Complete"]) {
        console.log(`[STATE] ${project.title} -> POST-WRITING`);
        
        // Need editor assignment
        if (!project.editorId) {
            console.log(`[STATE] ${project.title} -> NEEDS EDITOR`);
            return { 
                column: "Writing Stage", 
                color: 'yellow', 
                statusText: "Awaiting Editor Assignment" 
            };
        }
        
        // Editor assigned, review not complete
        if (!timeline["Review Complete"]) {
            console.log(`[STATE] ${project.title} -> IN REVIEW`);
            return { 
                column: "In Review", 
                color: 'yellow', 
                statusText: "Under Review" 
            };
        }
        
        // Review complete, author needs to review suggestions
        if (timeline["Review Complete"] && !timeline["Suggestions Reviewed"]) {
            console.log(`[STATE] ${project.title} -> REVIEWING SUGGESTIONS`);
            return { 
                column: "Reviewing Suggestions", 
                color: 'blue', 
                statusText: "Author Reviewing Feedback" 
            };
        }
    }

    // FALLBACK (should rarely hit this)
    console.log(`[STATE] ${project.title} -> FALLBACK`);
    return { 
        column: "Topic Proposal", 
        color: 'default', 
        statusText: "Pending" 
    };
}

/**
 * Automatically updates project state when timeline tasks are completed.
 * This ensures proper workflow progression and column transitions.
 */
async function handleTaskCompletion(projectId, taskName, isCompleted, db, currentUserName) {
    console.log(`[TASK UPDATE] ${taskName} = ${isCompleted} for project ${projectId}`);
    
    const updates = {
        [`timeline.${taskName}`]: isCompleted
    };
    
    // Add automatic state transitions
    if (isCompleted) {
        switch (taskName) {
            case "Topic Proposal Complete":
                // This happens when admin approves proposal
                updates.proposalStatus = 'approved';
                console.log("[AUTO] Setting proposal status to approved");
                break;
                
            case "Interview Scheduled":
                // No additional updates needed, but card should turn yellow
                console.log("[AUTO] Interview scheduled, card should be yellow");
                break;
                
            case "Interview Complete":
                // Card should move to Writing Stage
                console.log("[AUTO] Interview complete, moving to writing stage");
                break;
                
            case "Article Writing Complete":
                // This triggers the need for editor assignment
                console.log("[AUTO] Article complete, needs editor assignment");
                break;
                
            case "Review Complete":
                // Card moves to "Reviewing Suggestions" and becomes blue
                console.log("[AUTO] Review complete, moving to suggestions phase");
                break;
                
            case "Suggestions Reviewed":
                // Final completion - card becomes green and moves to Completed
                console.log("[AUTO] All done, project completed!");
                break;
        }
    } else {
        // Handle unchecking tasks - reverse some automatic states if needed
        switch (taskName) {
            case "Topic Proposal Complete":
                if (updates.proposalStatus !== 'approved') {
                    updates.proposalStatus = 'pending';
                }
                break;
        }
    }

    const activity = {
        text: `${isCompleted ? 'completed' : 'un-completed'} the task: "${taskName}"`,
        authorName: currentUserName,
        timestamp: new Date()
    };

    updates.activity = firebase.firestore.FieldValue.arrayUnion(activity);
    
    try {
        await db.collection('projects').doc(projectId).update(updates);
        console.log(`[TASK UPDATE] Successfully updated ${taskName} for project ${projectId}`);
        
    } catch (error) {
        console.error(`[TASK UPDATE ERROR] Failed to update ${taskName}:`, error);
        throw error;
    }
}

/**
 * Helper function to get all possible columns for a view
 */
function getColumnsForView(view) {
    const KANBAN_COLUMNS = {
        'interviews': ["Topic Proposal", "Interview Stage", "Writing Stage", "In Review", "Reviewing Suggestions", "Completed"],
        'opeds': ["Topic Proposal", "Writing Stage", "In Review", "Reviewing Suggestions", "Completed"],
        'my-assignments': ["To Do", "In Progress", "In Review", "Done"]
    };
    
    return KANBAN_COLUMNS[view] || [];
}

/**
 * Validates that a project state makes sense
 */
function validateProjectState(project, state) {
    const validColumns = getColumnsForView(state.view);
    
    if (!validColumns.includes(state.column)) {
        console.warn(`[VALIDATION] Invalid column "${state.column}" for view "${state.view}". Valid columns:`, validColumns);
        return false;
    }
    
    return true;
}

// Export functions for use in other files
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        getProjectState,
        handleTaskCompletion,
        getColumnsForView,
        validateProjectState
    };
}