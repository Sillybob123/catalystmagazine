/**
 * Catalyst Workflow State Manager (ES6 Module Version)
 *
 * Determines the precise state of editorial projects in the workflow pipeline.
 * Extracted from scheduler/stateManager.js for reuse across the application.
 *
 * @module workflow/state-manager
 */

/**
 * Determines the precise state of a project, including its column, color, and status text.
 * This handles ALL workflow transitions properly and ensures cards move between columns.
 *
 * @param {object} project - The project object from Firestore.
 * @param {string} view - The current view ('interviews', 'opeds', 'my-assignments').
 * @param {object} currentUser - Object with uid property for current user.
 * @returns {object} An object containing { column, color, statusText }.
 */
export function getProjectState(project, view, currentUser) {
    const timeline = project.timeline || {};

    // ========================================
    // FINAL COMPLETED STATE (Highest Priority)
    // ========================================
    if (timeline["Suggestions Reviewed"]) {
        const column = view === 'my-assignments' ? "Done" : "Completed";
        return { column, color: 'green', statusText: 'Article Completed' };
    }

    // ========================================
    // MY ASSIGNMENTS VIEW (Personalized Logic)
    // ========================================
    if (view === 'my-assignments') {
        const isAuthor = project.authorId === currentUser?.uid;
        const isEditor = project.editorId === currentUser?.uid;

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
        return {
            column: "Writing Stage",
            color: 'yellow',
            statusText: "Writing in Progress"
        };
    }

    // 4. POST-WRITING: Editor Assignment & Review
    if (timeline["Article Writing Complete"]) {
        // Need editor assignment
        if (!project.editorId) {
            return {
                column: "Writing Stage",
                color: 'yellow',
                statusText: "Awaiting Editor Assignment"
            };
        }

        // Editor assigned, review not complete
        if (!timeline["Review Complete"]) {
            return {
                column: "In Review",
                color: 'yellow',
                statusText: "Under Review"
            };
        }

        // Review complete, author needs to review suggestions
        if (timeline["Review Complete"] && !timeline["Suggestions Reviewed"]) {
            return {
                column: "Reviewing Suggestions",
                color: 'blue',
                statusText: "Author Reviewing Feedback"
            };
        }
    }

    // FALLBACK (should rarely hit this)
    return {
        column: "Topic Proposal",
        color: 'default',
        statusText: "Pending"
    };
}

/**
 * Helper function to get all possible columns for a view
 *
 * @param {string} view - The view name ('interviews', 'opeds', 'my-assignments')
 * @returns {string[]} Array of column names for the view
 */
export function getColumnsForView(view) {
    const KANBAN_COLUMNS = {
        'interviews': ["Topic Proposal", "Interview Stage", "Writing Stage", "In Review", "Reviewing Suggestions", "Completed"],
        'opeds': ["Topic Proposal", "Writing Stage", "In Review", "Reviewing Suggestions", "Completed"],
        'my-assignments': ["To Do", "In Progress", "In Review", "Done"]
    };

    return KANBAN_COLUMNS[view] || [];
}

/**
 * Calculates progress percentage based on timeline completion
 *
 * @param {object} timeline - Project timeline object with boolean values
 * @returns {number} Progress percentage (0-100)
 */
export function calculateProgress(timeline) {
    if (!timeline) return 0;
    const tasks = Object.values(timeline);
    if (tasks.length === 0) return 0;
    const completed = tasks.filter(t => t === true).length;
    return Math.round((completed / tasks.length) * 100);
}

/**
 * Validates that a project state makes sense
 *
 * @param {object} state - The state object returned by getProjectState
 * @param {string} view - The current view
 * @returns {boolean} True if valid, false otherwise
 */
export function validateProjectState(state, view) {
    const validColumns = getColumnsForView(view);

    if (!validColumns.includes(state.column)) {
        console.warn(`[VALIDATION] Invalid column "${state.column}" for view "${view}". Valid columns:`, validColumns);
        return false;
    }

    return true;
}

/**
 * Gets a summary of all projects grouped by status
 *
 * @param {object[]} projects - Array of project objects
 * @param {string} view - The current view
 * @param {object} currentUser - Current user object
 * @returns {object} Object with column names as keys and project arrays as values
 */
export function groupProjectsByColumn(projects, view, currentUser) {
    const columns = getColumnsForView(view);
    const grouped = {};

    // Initialize empty arrays for each column
    columns.forEach(column => {
        grouped[column] = [];
    });

    // Group projects
    projects.forEach(project => {
        const state = getProjectState(project, view, currentUser);
        if (grouped[state.column]) {
            grouped[state.column].push({
                ...project,
                state
            });
        }
    });

    return grouped;
}
