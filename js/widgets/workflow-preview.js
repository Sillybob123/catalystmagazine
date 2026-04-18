/**
 * Workflow Preview Widget
 *
 * Displays a read-only preview of the editorial workflow from catalystmonday database.
 * Shows project counts and status summary with link to full scheduler for management.
 *
 * @module widgets/workflow-preview
 */

import { workflowDb } from '../firebase-dual-config.js';
import { collection, onSnapshot } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getProjectState, groupProjectsByColumn, calculateProgress } from '../workflow/state-manager.js';

export class WorkflowPreviewWidget {
    constructor(containerId, currentUser) {
        this.container = document.getElementById(containerId);
        this.currentUser = currentUser;
        this.currentView = 'interviews';
        this.allProjects = [];
        this.unsubscribe = null;
        this.loading = true;

        if (!this.container) {
            console.error('[WORKFLOW PREVIEW] Container not found:', containerId);
            return;
        }

        this.init();
    }

    init() {
        console.log('[WORKFLOW PREVIEW] Initializing widget');
        this.showLoading();
        this.setupTabs();
        this.setupSubscription();
    }

    setupTabs() {
        const tabs = this.container.closest('.card').querySelectorAll('.workflow-tab');
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                tabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                this.currentView = tab.dataset.view;
                this.render();
            });
        });
    }

    setupSubscription() {
        console.log('[WORKFLOW PREVIEW] Setting up subscription to catalystmonday projects');

        try {
            const projectsRef = collection(workflowDb, 'projects');
            this.unsubscribe = onSnapshot(projectsRef,
                (snapshot) => {
                    console.log(`[WORKFLOW PREVIEW] Received ${snapshot.docs.length} projects from catalystmonday`);
                    this.allProjects = snapshot.docs.map(doc => ({
                        id: doc.id,
                        ...doc.data()
                    }));
                    this.loading = false;
                    this.updateCounts();
                    this.render();
                },
                (error) => {
                    console.error('[WORKFLOW PREVIEW] Subscription error:', error);
                    this.showError('Failed to load workflow data. Please check your connection.');
                    this.loading = false;
                }
            );
        } catch (error) {
            console.error('[WORKFLOW PREVIEW] Failed to setup subscription:', error);
            this.showError('Failed to initialize workflow preview.');
            this.loading = false;
        }
    }

    updateCounts() {
        const interviewCount = this.allProjects.filter(p => p.type === 'Interview').length;
        const opedCount = this.allProjects.filter(p => p.type === 'Op-Ed').length;
        const myAssignmentsCount = this.allProjects.filter(p =>
            p.authorId === this.currentUser?.uid ||
            p.editorId === this.currentUser?.uid
        ).length;

        const countElements = {
            'interviews-count': interviewCount,
            'opeds-count': opedCount,
            'my-assignments-count': myAssignmentsCount
        };

        Object.entries(countElements).forEach(([id, count]) => {
            const el = document.getElementById(id);
            if (el) el.textContent = count;
        });
    }

    render() {
        if (this.loading) {
            this.showLoading();
            return;
        }

        const filteredProjects = this.filterProjects();

        if (filteredProjects.length === 0) {
            this.showEmpty();
            return;
        }

        // Group projects by column for summary view
        const grouped = groupProjectsByColumn(filteredProjects, this.currentView, this.currentUser);

        this.container.innerHTML = this.renderSummaryView(grouped);
    }

    filterProjects() {
        switch (this.currentView) {
            case 'interviews':
                return this.allProjects.filter(p => p.type === 'Interview');
            case 'opeds':
                return this.allProjects.filter(p => p.type === 'Op-Ed');
            case 'my-assignments':
                return this.allProjects.filter(p =>
                    p.authorId === this.currentUser?.uid ||
                    p.editorId === this.currentUser?.uid
                );
            default:
                return this.allProjects;
        }
    }

    renderSummaryView(grouped) {
        const columns = Object.keys(grouped);

        return `
            <div class="workflow-summary-grid">
                ${columns.map(columnName => {
                    const projects = grouped[columnName];
                    const count = projects.length;

                    if (count === 0) return '';

                    // Get sample projects (max 3) to show titles
                    const sampleProjects = projects.slice(0, 3);
                    const hasMore = count > 3;

                    return `
                        <div class="workflow-summary-column">
                            <div class="summary-column-header">
                                <div class="summary-column-title">${columnName}</div>
                                <div class="summary-column-count">${count}</div>
                            </div>
                            <div class="summary-column-body">
                                ${sampleProjects.map(p => `
                                    <div class="summary-project-item ${this.getColorClass(p.state.color)}">
                                        <div class="summary-project-title">${this.truncate(p.title, 50)}</div>
                                        <div class="summary-project-meta">
                                            <span class="summary-project-type">${p.type || 'Article'}</span>
                                            ${this.renderProgress(p.timeline)}
                                        </div>
                                    </div>
                                `).join('')}
                                ${hasMore ? `
                                    <div class="summary-more-items">
                                        +${count - 3} more...
                                    </div>
                                ` : ''}
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
            <div class="workflow-summary-footer">
                <p class="summary-footer-text">
                    This is a preview of your editorial workflow.
                    <a href="/admin/scheduler" class="summary-footer-link">Open Full Scheduler</a>
                    to manage projects, assign editors, and update timelines.
                </p>
            </div>
        `;
    }

    renderProgress(timeline) {
        const progress = calculateProgress(timeline);
        return `
            <div class="summary-progress-bar">
                <div class="summary-progress-fill" style="width: ${progress}%"></div>
            </div>
        `;
    }

    getColorClass(color) {
        const classMap = {
            'green': 'summary-status-green',
            'yellow': 'summary-status-yellow',
            'blue': 'summary-status-blue',
            'red': 'summary-status-red',
            'default': 'summary-status-default'
        };
        return classMap[color] || 'summary-status-default';
    }

    truncate(text, maxLength) {
        if (!text) return '';
        return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
    }

    showLoading() {
        this.container.innerHTML = `
            <div class="workflow-loading-state">
                <div class="workflow-loading-spinner"></div>
                <div>Loading workflow from scheduler...</div>
            </div>
        `;
    }

    showEmpty() {
        this.container.innerHTML = `
            <div class="workflow-empty-state">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <rect x="3" y="3" width="7" height="7" rx="1"></rect>
                    <rect x="14" y="3" width="7" height="7" rx="1"></rect>
                    <rect x="14" y="14" width="7" height="7" rx="1"></rect>
                    <rect x="3" y="14" width="7" height="7" rx="1"></rect>
                </svg>
                <div class="workflow-empty-text">No projects in this view</div>
                <a href="/admin/scheduler" class="btn btn-primary btn-small" style="margin-top: 16px;">
                    Go to Scheduler
                </a>
            </div>
        `;
    }

    showError(message) {
        this.container.innerHTML = `
            <div class="workflow-error-state">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="12" y1="8" x2="12" y2="12"></line>
                    <line x1="12" y1="16" x2="12.01" y2="16"></line>
                </svg>
                <div class="workflow-error-text">${message}</div>
                <button class="btn btn-secondary btn-small" style="margin-top: 16px;" onclick="location.reload()">
                    Retry
                </button>
            </div>
        `;
    }

    destroy() {
        if (this.unsubscribe) {
            this.unsubscribe();
            console.log('[WORKFLOW PREVIEW] Unsubscribed from catalystmonday');
        }
    }
}

// Auto-initialize if container exists
document.addEventListener('DOMContentLoaded', () => {
    const container = document.getElementById('workflow-preview-board');
    if (container) {
        console.log('[WORKFLOW PREVIEW] Auto-initializing widget');
        // Will be initialized with user object after auth
    }
});
