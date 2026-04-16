// ===============================
// MODAL FIX V5 - Complete Animation State Reset + Edit Mode Cleanup
// Fixes modal transition bugs when switching between modals
// VERSION 5 - UPDATED: Added automatic edit mode cancellation on modal close
// ===============================

console.log('[MODAL FIX V5] Loading enhanced transition reset fix...');

// Wait for page to fully load
window.addEventListener('load', function() {
    console.log('[MODAL FIX V4] Page loaded, applying comprehensive modal fixes...');
    
    setTimeout(function() {
        
        /**
         * Complete modal state reset - removes ALL styles and animations
         */
        function completeModalReset(modal) {
            if (!modal) return;
            
            // Remove ALL inline styles that might interfere
            modal.style.cssText = '';
            
            // Set display to none explicitly
            modal.style.display = 'none';
            
            // Remove any classes that might have been added
            modal.classList.remove('loading', 'animating', 'open', 'closing');
            
            // Force browser to recalculate styles
            void modal.offsetHeight;
            window.getComputedStyle(modal).display;
            
            // Clear the modal content's animation state too
            const content = modal.querySelector('.modal-content');
            if (content) {
                content.style.animation = 'none';
                content.style.transform = 'none';
                content.style.opacity = '';
                void content.offsetHeight;
            }
        }
        
        /**
         * Enhanced closeAllModals with complete reset
         */
        window.closeAllModals = function() {
            console.log('[MODAL FIX V4] Closing all modals with complete reset...');

            // Cancel any active proposal editing
            const editTextarea = document.getElementById('proposal-edit-textarea');
            if (editTextarea) {
                console.log('[MODAL FIX V4] Canceling active proposal edit...');
                if (typeof window.disableProposalEditing === 'function') {
                    window.disableProposalEditing({ revertToOriginal: true });
                }
            }

            const modalIds = [
                'project-modal',
                'task-modal',
                'details-modal',
                'task-details-modal',
                'report-modal'
            ];

            modalIds.forEach(function(modalId) {
                const modal = document.getElementById(modalId);
                if (modal) {
                    completeModalReset(modal);
                }
            });

            // Clear tracked IDs in both local and window scope
            if (typeof currentlyViewedProjectId !== 'undefined') {
                currentlyViewedProjectId = null;
            }
            window.currentlyViewedProjectId = null;

            if (typeof currentlyViewedTaskId !== 'undefined') {
                currentlyViewedTaskId = null;
            }
            window.currentlyViewedTaskId = null;

            // Remove background blur and restore scrolling
            document.body.style.overflow = '';
            document.body.style.filter = '';

            const appContainer = document.getElementById('app-container');
            if (appContainer) {
                appContainer.style.filter = '';
                appContainer.style.transition = '';
            }

            console.log('[MODAL FIX V4] All modals closed and states reset');
        };
        
        /**
         * Safe modal opening with proper animation sequence
         */
        function safeOpenModal(modalId, setupFunction) {
            console.log('[MODAL FIX V4] Opening modal safely:', modalId);
            
            // First, ensure all modals are closed
            window.closeAllModals();
            
            // Use requestAnimationFrame for smooth transition
            requestAnimationFrame(function() {
                // Wait one more frame to ensure cleanup is complete
                requestAnimationFrame(function() {
                    
                    const modal = document.getElementById(modalId);
                    if (!modal) {
                        console.error('[MODAL FIX V4] Modal not found:', modalId);
                        return;
                    }
                    
                    // Reset the modal completely first
                    completeModalReset(modal);
                    
                    // Use setTimeout to ensure the reset is processed
                    setTimeout(function() {
                        
                        // Remove animation temporarily
                        modal.style.animation = 'none';
                        
                        // Set display to flex
                        modal.style.display = 'flex';
                        
                        // Force reflow
                        void modal.offsetHeight;
                        
                        // Re-enable animation for the fade-in effect
                        modal.style.animation = '';
                        
                        // Ensure the modal content animates properly
                        const content = modal.querySelector('.modal-content');
                        if (content) {
                            content.style.animation = 'none';
                            void content.offsetHeight;
                            content.style.animation = '';
                        }
                        
                        // Add blur to background
                        document.body.style.overflow = 'hidden';
                        const appContainer = document.getElementById('app-container');
                        if (appContainer) {
                            appContainer.style.filter = 'blur(4px)';
                            appContainer.style.transition = 'filter 0.3s ease';
                        }
                        
                        // Run setup function after modal is visible
                        if (typeof setupFunction === 'function') {
                            setTimeout(setupFunction, 50);
                        }
                        
                        console.log('[MODAL FIX V4] Modal opened successfully:', modalId);
                        
                    }, 100); // Small delay to ensure reset is complete
                });
            });
        }
        
        /**
         * Override openDetailsModal with safe opening
         */
        window.openDetailsModal = function(projectId) {
            console.log('[MODAL FIX V4] Opening project details:', projectId);
            
            if (typeof allProjects === 'undefined') {
                console.error('[MODAL FIX V4] allProjects not available');
                return;
            }
            
            const project = allProjects.find(function(p) { return p.id === projectId; });
            if (!project) {
                console.error('[MODAL FIX V4] Project not found:', projectId);
                if (typeof showNotification === 'function') {
                    showNotification('Project not found', 'error');
                }
                return;
            }
            
            safeOpenModal('details-modal', function() {
                if (typeof currentlyViewedProjectId !== 'undefined') {
                    currentlyViewedProjectId = projectId;
                }
                window.currentlyViewedProjectId = projectId;

                // Ensure edit mode is disabled before showing new proposal
                const editTextarea = document.getElementById('proposal-edit-textarea');
                if (editTextarea && typeof window.disableProposalEditing === 'function') {
                    console.log('[MODAL FIX V4] Cleaning up leftover edit state...');
                    window.disableProposalEditing({ revertToOriginal: true });
                }

                if (typeof refreshDetailsModal === 'function') {
                    refreshDetailsModal(project);
                }
                if (typeof attachProjectModalListeners === 'function') {
                    attachProjectModalListeners();
                }
            });
        };
        
        /**
         * Override openTaskDetailsModal with safe opening
         */
        window.openTaskDetailsModal = function(taskId) {
            console.log('[MODAL FIX V4] Opening task details:', taskId);
            
            if (typeof allTasks === 'undefined') {
                console.error('[MODAL FIX V4] allTasks not available');
                return;
            }
            
            const task = allTasks.find(function(t) { return t.id === taskId; });
            if (!task) {
                console.error('[MODAL FIX V4] Task not found:', taskId);
                if (typeof showNotification === 'function') {
                    showNotification('Task not found', 'error');
                }
                return;
            }
            
            safeOpenModal('task-details-modal', function() {
                if (typeof currentlyViewedTaskId !== 'undefined') {
                    currentlyViewedTaskId = taskId;
                }
                window.currentlyViewedTaskId = taskId;
                
                if (typeof refreshTaskDetailsModal === 'function') {
                    refreshTaskDetailsModal(task);
                }
                if (typeof attachTaskModalListeners === 'function') {
                    attachTaskModalListeners();
                }
            });
        };
        
        /**
         * Setup proper close button handlers
         */
        setTimeout(function() {
            // Remove existing listeners first
            const modalOverlays = document.querySelectorAll('.modal-overlay');
            console.log('[MODAL FIX V4] Setting up close handlers for', modalOverlays.length, 'modals');
            
            modalOverlays.forEach(function(modal) {
                // Clone to remove old listeners
                const newModal = modal.cloneNode(true);
                modal.parentNode.replaceChild(newModal, modal);
            });
            
            // Re-query after replacement
            const freshModals = document.querySelectorAll('.modal-overlay');
            freshModals.forEach(function(modal) {
                modal.addEventListener('click', function(e) {
                    if (e.target === modal || e.target.classList.contains('close-button')) {
                        e.preventDefault();
                        e.stopPropagation();
                        console.log('[MODAL FIX V4] Close triggered');
                        window.closeAllModals();
                    }
                });
                
                // Also add to all close buttons inside the modal
                const closeButtons = modal.querySelectorAll('.close-button');
                closeButtons.forEach(function(btn) {
                    btn.addEventListener('click', function(e) {
                        e.preventDefault();
                        e.stopPropagation();
                        console.log('[MODAL FIX V4] Close button clicked');
                        window.closeAllModals();
                    });
                });
            });
            
            // ESC key support - remove old listener first
            document.removeEventListener('keydown', window.modalEscHandler);
            window.modalEscHandler = function(e) {
                if (e.key === 'Escape' || e.keyCode === 27) {
                    console.log('[MODAL FIX V4] ESC pressed, closing modals');
                    window.closeAllModals();
                }
            };
            document.addEventListener('keydown', window.modalEscHandler);
            
        }, 500);
        
        console.log('[MODAL FIX V4] ✅ Enhanced modal fix fully applied');
        
    }, 2000); // Wait for page to fully initialize
});

console.log('[MODAL FIX V4] Script loaded successfully');
