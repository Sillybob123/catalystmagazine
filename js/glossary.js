// Glossary tooltip system. Loads /glossary.json once, then scans the article
// body for matching terms and wraps the first occurrence of each in a span
// that shows a definition tooltip on hover/focus/tap.

(function () {
    'use strict';

    const GLOSSARY_URL = '/glossary.json';
    const SKIP_SELECTORS = 'h1, h2, h3, h4, h5, h6, a, code, pre, figcaption, blockquote.article-pullquote, .article-quiz, .glossary-term';

    let glossaryPromise = null;

    function loadGlossary() {
        if (!glossaryPromise) {
            glossaryPromise = fetch(GLOSSARY_URL, { cache: 'force-cache' })
                .then((r) => (r.ok ? r.json() : {}))
                .catch(() => ({}));
        }
        return glossaryPromise;
    }

    // Flatten { A: { Term: { definition } }, ... } into a Map keyed by lowercased term.
    function buildTermMap(data) {
        const map = new Map();
        Object.values(data || {}).forEach((bucket) => {
            Object.entries(bucket || {}).forEach(([term, info]) => {
                if (!term || !info || !info.definition) return;
                map.set(term.toLowerCase(), { term, definition: info.definition });
            });
        });
        return map;
    }

    function escapeRegex(str) {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    // Build one big alternation regex. Sort by length desc so multi-word terms
    // ("Black Hole") match before single-word substrings ("Black").
    function buildRegex(termMap) {
        const terms = Array.from(termMap.values())
            .map((t) => t.term)
            .sort((a, b) => b.length - a.length)
            .map(escapeRegex);
        if (!terms.length) return null;
        return new RegExp('\\b(' + terms.join('|') + ')\\b', 'gi');
    }

    function isSkippable(node) {
        let el = node.parentElement;
        while (el && el !== document.body) {
            if (el.matches && el.matches(SKIP_SELECTORS)) return true;
            el = el.parentElement;
        }
        return false;
    }

    function collectTextNodes(root) {
        const nodes = [];
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
            acceptNode(node) {
                if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
                if (isSkippable(node)) return NodeFilter.FILTER_REJECT;
                return NodeFilter.FILTER_ACCEPT;
            },
        });
        let n;
        while ((n = walker.nextNode())) nodes.push(n);
        return nodes;
    }

    function wrapMatchesInTextNode(textNode, regex, termMap, usedKeys) {
        const text = textNode.nodeValue;
        regex.lastIndex = 0;
        let match;
        const fragments = [];
        let cursor = 0;
        let touched = false;

        while ((match = regex.exec(text)) !== null) {
            const matched = match[0];
            const key = matched.toLowerCase();
            if (usedKeys.has(key)) continue;
            const entry = termMap.get(key);
            if (!entry) continue;

            usedKeys.add(key);
            touched = true;

            if (match.index > cursor) {
                fragments.push(document.createTextNode(text.slice(cursor, match.index)));
            }
            const span = document.createElement('span');
            span.className = 'glossary-term';
            span.setAttribute('tabindex', '0');
            span.setAttribute('role', 'button');
            span.setAttribute('aria-label', entry.term + ': ' + entry.definition);
            span.dataset.term = entry.term;
            span.dataset.definition = entry.definition;
            span.textContent = matched;
            fragments.push(span);
            cursor = match.index + matched.length;
        }

        if (!touched) return;
        if (cursor < text.length) {
            fragments.push(document.createTextNode(text.slice(cursor)));
        }
        const parent = textNode.parentNode;
        fragments.forEach((f) => parent.insertBefore(f, textNode));
        parent.removeChild(textNode);
    }

    // Single shared tooltip element, positioned on demand.
    let tooltipEl = null;
    function ensureTooltip() {
        if (tooltipEl) return tooltipEl;
        tooltipEl = document.createElement('div');
        tooltipEl.className = 'glossary-tooltip';
        tooltipEl.setAttribute('role', 'tooltip');
        tooltipEl.innerHTML =
            '<div class="glossary-tooltip__term"></div>' +
            '<div class="glossary-tooltip__definition"></div>';
        document.body.appendChild(tooltipEl);
        return tooltipEl;
    }

    function showTooltip(target) {
        const tip = ensureTooltip();
        tip.querySelector('.glossary-tooltip__term').textContent = target.dataset.term || '';
        tip.querySelector('.glossary-tooltip__definition').textContent = target.dataset.definition || '';
        tip.classList.add('is-visible');
        // Force layout so we can measure.
        const rect = target.getBoundingClientRect();
        const tipRect = tip.getBoundingClientRect();
        const margin = 8;
        let left = rect.left + rect.width / 2 - tipRect.width / 2;
        left = Math.max(margin, Math.min(left, window.innerWidth - tipRect.width - margin));
        let top = rect.top - tipRect.height - 10;
        let placement = 'top';
        if (top < margin) {
            top = rect.bottom + 10;
            placement = 'bottom';
        }
        tip.style.left = left + window.scrollX + 'px';
        tip.style.top = top + window.scrollY + 'px';
        tip.dataset.placement = placement;
        // Arrow pointer offset.
        const arrowLeft = rect.left + rect.width / 2 - left;
        tip.style.setProperty('--glossary-arrow-x', arrowLeft + 'px');
    }

    function hideTooltip() {
        if (tooltipEl) tooltipEl.classList.remove('is-visible');
    }

    function bindInteractions(root) {
        if (root.dataset.glossaryBound === '1') return;
        root.dataset.glossaryBound = '1';

        root.addEventListener('mouseenter', (e) => {
            const t = e.target;
            if (t && t.classList && t.classList.contains('glossary-term')) showTooltip(t);
        }, true);
        root.addEventListener('mouseleave', (e) => {
            const t = e.target;
            if (t && t.classList && t.classList.contains('glossary-term')) hideTooltip();
        }, true);
        root.addEventListener('focusin', (e) => {
            const t = e.target;
            if (t && t.classList && t.classList.contains('glossary-term')) showTooltip(t);
        });
        root.addEventListener('focusout', hideTooltip);

        // Tap-to-toggle on touch devices.
        root.addEventListener('click', (e) => {
            const t = e.target;
            if (!t || !t.classList || !t.classList.contains('glossary-term')) return;
            e.preventDefault();
            const tip = ensureTooltip();
            if (tip.classList.contains('is-visible') && tip.dataset.activeFor === t.dataset.term) {
                hideTooltip();
                tip.dataset.activeFor = '';
            } else {
                showTooltip(t);
                tip.dataset.activeFor = t.dataset.term || '';
            }
        });

        document.addEventListener('click', (e) => {
            if (!tooltipEl) return;
            if (e.target.closest && e.target.closest('.glossary-term')) return;
            if (e.target.closest && e.target.closest('.glossary-tooltip')) return;
            hideTooltip();
        });

        window.addEventListener('scroll', hideTooltip, { passive: true });
        window.addEventListener('resize', hideTooltip);
    }

    async function applyGlossary(root) {
        if (!root) return;
        const data = await loadGlossary();
        const termMap = buildTermMap(data);
        if (!termMap.size) return;
        const regex = buildRegex(termMap);
        if (!regex) return;

        const usedKeys = new Set();
        const textNodes = collectTextNodes(root);
        textNodes.forEach((node) => wrapMatchesInTextNode(node, regex, termMap, usedKeys));

        if (usedKeys.size > 0) bindInteractions(root);
    }

    window.applyGlossary = applyGlossary;
})();
