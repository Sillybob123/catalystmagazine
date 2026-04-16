/**
 * EditorOutline - Auto-generates article outline from H1/H2/H3 tags
 * Uses MutationObserver to watch for editor changes
 */

class EditorOutline {
    constructor(editorSelector, outlineSelector) {
        this.editor = document.querySelector(editorSelector);
        this.outlineContainer = document.querySelector(outlineSelector);
        this.observer = null;
        this.debounceTimeout = null;

        if (this.editor && this.outlineContainer) {
            this.init();
        }
    }

    init() {
        // Initial outline generation
        this.generateOutline();

        // Watch for changes in editor with debouncing
        this.observer = new MutationObserver(() => {
            clearTimeout(this.debounceTimeout);
            this.debounceTimeout = setTimeout(() => {
                this.generateOutline();
            }, 300);
        });

        this.observer.observe(this.editor, {
            childList: true,
            subtree: true,
            characterData: true
        });
    }

    generateOutline() {
        // Find all H1, H2, H3 elements
        const headingElements = this.editor.querySelectorAll('h1, h2, h3');

        if (headingElements.length === 0) {
            this.outlineContainer.innerHTML = '<p class="outline-empty">Start writing to see outline...</p>';
            return;
        }

        // Build outline HTML
        let outlineHTML = '';
        headingElements.forEach((heading, index) => {
            const text = heading.textContent.trim();
            if (!text) return; // Skip empty headings

            const level = heading.tagName.toLowerCase();
            const id = `heading-${index}-${Date.now()}`;

            // Add ID to heading for scrolling (if it doesn't have one)
            if (!heading.id) {
                heading.id = id;
            }

            // Create outline item
            outlineHTML += `
                <div class="outline-item ${level}" data-target="${heading.id}">
                    ${this.escapeHtml(text)}
                </div>
            `;
        });

        this.outlineContainer.innerHTML = outlineHTML;

        // Add click handlers
        this.outlineContainer.querySelectorAll('.outline-item').forEach(item => {
            item.addEventListener('click', () => {
                const targetId = item.dataset.target;
                const targetElement = document.getElementById(targetId);
                if (targetElement) {
                    // Smooth scroll to heading
                    targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' });

                    // Brief highlight effect
                    targetElement.style.background = 'rgba(59, 130, 246, 0.1)';
                    targetElement.style.transition = 'background 0.3s';
                    setTimeout(() => {
                        targetElement.style.background = '';
                    }, 1000);
                }
            });
        });
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    destroy() {
        if (this.observer) {
            this.observer.disconnect();
        }
        clearTimeout(this.debounceTimeout);
    }
}

// Export for ES6 modules
export default EditorOutline;
