// scheduler/autoDeadlines.js
//
// Plain-script twin of /js/dashboard/auto-deadlines.js. Same rules, exposed
// as window.AutoDeadlines so dashboard.js / stateManager.js can call it
// without an import. Keep this file and the module copy in sync.
//
// Rules (each only fires when the target deadline is unset):
//   approval (Interview type) → deadlines.contact = approvedAt + 2d
//   interview scheduled       → deadlines.draft   = interviewDate + 7d
//   editor assigned           → deadlines.review  = assignedAt + 7d
//                               + editorAssignedAt = assignedAt
//   review complete           → deadlines.edits   = completedAt + 7d

(function () {
    'use strict';

    const ONE_DAY_MS = 86400000;

    function toIsoDate(date) {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }

    function addDays(date, days) {
        return toIsoDate(new Date(date.getTime() + days * ONE_DAY_MS));
    }

    function existing(project, key) {
        return !!(project && project.deadlines && project.deadlines[key]);
    }

    function deadlinePatchOnApproval(project, now) {
        now = now || new Date();
        if (!project) return {};
        if ((project.type || 'Interview') !== 'Interview') return {};
        if (existing(project, 'contact')) return {};
        return { 'deadlines.contact': addDays(now, 2) };
    }

    function deadlinePatchOnInterviewScheduled(project, interviewDate) {
        if (!project || !interviewDate) return {};
        if (existing(project, 'draft')) return {};
        const iv = new Date(`${interviewDate}T00:00:00`);
        if (isNaN(iv.getTime())) return {};
        return { 'deadlines.draft': addDays(iv, 7) };
    }

    function deadlinePatchOnEditorAssigned(project, now) {
        now = now || new Date();
        const patch = { editorAssignedAt: now.toISOString() };
        if (!existing(project, 'review')) {
            patch['deadlines.review'] = addDays(now, 7);
        }
        return patch;
    }

    function deadlinePatchOnReviewComplete(project, now) {
        now = now || new Date();
        if (!project) return {};
        if (existing(project, 'edits')) return {};
        return { 'deadlines.edits': addDays(now, 7) };
    }

    window.AutoDeadlines = {
        deadlinePatchOnApproval,
        deadlinePatchOnInterviewScheduled,
        deadlinePatchOnEditorAssigned,
        deadlinePatchOnReviewComplete,
    };
})();
