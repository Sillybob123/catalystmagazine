// projectState.js - Centralized state management for project workflow

const WORKFLOW_COLUMNS = {
    TOPIC_PROPOSAL: "Topic Proposal",
    INTERVIEW_STAGE: "Interview Stage", 
    WRITING_STAGE: "Writing Stage",
    IN_REVIEW: "In Review",
    REVIEWING_SUGGESTIONS: "Reviewing Suggestions",
    COMPLETED: "Completed"
};

const CARD_COLORS = {
    DEFAULT: 'default',
    YELLOW: 'yellow',
    BLUE: 'blue',
    GREEN: 'green'
};

function getProjectState(project) {
    const timeline = project.timeline || {};
    
    console.log(`[STATE] Evaluating project: ${project.title}`);
    console.log(`[STATE] Timeline:`, timeline);
    console.log(`[STATE] Proposal Status: ${project.proposalStatus}`);
    
    // 1. COMPLETED - Final state
    if (timeline["Suggestions Reviewed"]) {
        return {
            column: WORKFLOW_COLUMNS.COMPLETED,
            color: CARD_COLORS.GREEN,
            statusText: "Completed"
        };
    }
    
    // 2. REVIEWING SUGGESTIONS - Author reviewing editor feedback
    if (timeline["Review Complete"] && !timeline["Suggestions Reviewed"]) {
        return {
            column: WORKFLOW_COLUMNS.REVIEWING_SUGGESTIONS,
            color: CARD_COLORS.BLUE,
            statusText: "Author Reviewing Feedback"
        };
    }
    
    // 3. IN REVIEW - Editor reviewing article
    if (project.editorId && timeline["Article Writing Complete"] && !timeline["Review Complete"]) {
        return {
            column: WORKFLOW_COLUMNS.IN_REVIEW,
            color: CARD_COLORS.YELLOW,
            statusText: "Under Editor Review"
        };
    }
    
    // 4. WRITING STAGE - Article being written or awaiting editor
    if (timeline["Interview Complete"] || (project.type === 'Op-Ed' && project.proposalStatus === 'approved')) {
        // Check if we're waiting for editor assignment
        if (timeline["Article Writing Complete"] && !project.editorId) {
            return {
                column: WORKFLOW_COLUMNS.WRITING_STAGE,
                color: CARD_COLORS.YELLOW,
                statusText: "Awaiting Editor Assignment"
            };
        }
        
        // Still writing
        if (!timeline["Article Writing Complete"]) {
            return {
                column: WORKFLOW_COLUMNS.WRITING_STAGE,
                color: CARD_COLORS.YELLOW,
                statusText: "Writing Article"
            };
        }
    }
    
    // 5. INTERVIEW STAGE - For interview projects
    if (project.type === 'Interview' && project.proposalStatus === 'approved' && !timeline["Interview Complete"]) {
        const color = timeline["Interview Scheduled"] ? CARD_COLORS.YELLOW : CARD_COLORS.DEFAULT;
        const status = timeline["Interview Scheduled"] ? "Interview Scheduled" : "Schedule Interview";
        
        return {
            column: WORKFLOW_COLUMNS.INTERVIEW_STAGE,
            color: color,
            statusText: status
        };
    }
    
    // 6. TOPIC PROPOSAL - Initial state
    return {
        column: WORKFLOW_COLUMNS.TOPIC_PROPOSAL,
        color: CARD_COLORS.DEFAULT,
        statusText: project.proposalStatus === 'approved' ? 'Approved' : 
                   project.proposalStatus === 'rejected' ? 'Rejected' : 'Pending Approval'
    };
}

// Helper function to determine which columns to show based on view
function getColumnsForView(view) {
    const allColumns = Object.values(WORKFLOW_COLUMNS);
    
    switch(view) {
        case 'interviews':
            return allColumns; // Show all columns for interviews
        case 'opeds':
            // Op-Eds skip interview stage
            return allColumns.filter(col => col !== WORKFLOW_COLUMNS.INTERVIEW_STAGE);
        default:
            return allColumns;
    }
}
