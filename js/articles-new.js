// =====================================================
// articlesnew.js — preview articles page
// Renders the hero, spotlight, filter rail, and feed from
// window.articles (and Firestore published stories).
// Self-contained: no coupling to main.js runtime state.
// =====================================================
(function () {
    'use strict';

    const FALLBACK_IMAGE = '/NewsletterHeader1.png';
    // Neutral placeholder shown in the hero backdrop while the real cover
    // for the newest story loads from Firestore. Kept intentionally generic
    // so we never flash a stale article image.
    const HERO_PLACEHOLDER = '/postimages/sustainable.webp';
    const PAGE_SIZE = 12;

    // ---------- DOM refs ----------
    const heroBackdrop   = document.getElementById('an-hero-backdrop');
    const spotlightEl    = document.getElementById('an-spotlight');
    const feedEl         = document.getElementById('an-feed-grid');
    const emptyEl        = document.getElementById('an-empty');
    const loadMoreBtn    = document.getElementById('an-loadmore');
    const pillGroup      = document.querySelector('.an-pill-group');
    const pillIndicator  = document.getElementById('an-pill-indicator');
    const pills          = Array.from(document.querySelectorAll('.an-pill'));
    const searchInput    = document.getElementById('an-search-input');
    const searchClear    = document.getElementById('an-search-clear');
    const filterRail     = document.getElementById('an-filter-rail');

    // ---------- State ----------
    let allArticles = [];
    let visibleArticles = [];
    let rendered = 0;
    let currentCategory = 'all';
    let currentQuery = '';

    // ---------- Image URL helper (mirrors main.js) ----------
    function getResizedImageUrl(src, width, quality) {
        if (!src || src === FALLBACK_IMAGE || src.startsWith('data:') || src.startsWith('blob:')) return src;
        try {
            if (!/^https?:\/\//i.test(src)) return src;
            const url = new URL(src);

            if (url.hostname.includes('static.wixstatic.com')) {
                const parts = url.pathname.split('/').filter(Boolean);
                const filename = parts[parts.length - 1];
                if (parts.includes('v1')) {
                    return src.replace(/q_\d+/g, `q_${quality}`).replace(/w_\d+/g, `w_${width}`);
                }
                const h = Math.round(width * 0.66);
                return `${src}/v1/fill/w_${width},h_${h},al_c,q_${quality},enc_auto/${filename}`;
            }

            const SENTINEL = 'ENCSLASH';
            const protected_ = src.replace(/%2F/gi, SENTINEL);
            let decoded;
            try { decoded = decodeURIComponent(protected_); } catch { decoded = protected_; }
            decoded = decoded.replace(new RegExp(SENTINEL, 'g'), '%2F');

            const params = new URLSearchParams({
                url: decoded,
                w: width,
                q: quality,
                output: 'webp',
                fit: 'cover',
                we: ''
            });
            return `https://wsrv.nl/?${params}`;
        } catch { return src; }
    }

    // ---------- Helpers ----------
    function titleToSlug(title) {
        return String(title || '')
            .toLowerCase()
            .replace(/[’'"]/g, '')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 120);
    }

    function formatCategory(cat) {
        if (!cat) return 'Story';
        const c = String(cat).toLowerCase();
        if (c === 'feature') return 'Feature';
        if (c === 'profile') return 'Profile';
        if (c === 'interview') return 'Interview';
        if (c === 'editorial' || c === 'op-ed') return 'Editorial';
        return cat.charAt(0).toUpperCase() + cat.slice(1);
    }

    function formatDate(dateStr) {
        if (!dateStr) return '';
        const d = new Date(dateStr);
        if (isNaN(d)) return dateStr;
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }

    function escapeHtml(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function normalizeArticle(raw) {
        if (!raw || !raw.title) return null;
        const cat = String(raw.category || 'feature').toLowerCase();
        const link = raw.link || raw.url || `/article/${encodeURIComponent(titleToSlug(raw.title))}`;
        return {
            id: raw.id || raw._id || raw.slug || titleToSlug(raw.title),
            title: raw.title,
            author: raw.author || raw.authorName || 'The Catalyst',
            date: raw.date || '',
            image: raw.image || raw.coverImage || FALLBACK_IMAGE,
            link,
            category: cat === 'op-ed' ? 'editorial' : cat,
            excerpt: (raw.excerpt || raw.deck || raw.dek || '').replace(/\s+/g, ' ').trim()
        };
    }

    function loadArticles() {
        const list = Array.isArray(window.articles) ? window.articles : [];
        const normalized = list.map(normalizeArticle).filter(Boolean);
        return sortArticles(normalized);
    }

    function sortArticles(list) {
        return list.slice().sort((a, b) => {
            const da = Date.parse(a.date) || 0;
            const db = Date.parse(b.date) || 0;
            return db - da;
        });
    }

    // ---------- Firestore ----------
    async function loadFirestoreArticles() {
        // Reuse the same session cache key main.js uses so we don't re-fetch.
        const CACHE_KEY = 'catalyst_fs_cache_v4';
        try {
            const cached = sessionStorage.getItem(CACHE_KEY);
            if (cached) return JSON.parse(cached).map(fsToNormalized).filter(Boolean);
        } catch {}

        const projectId = 'catalystwriters-5ce43';
        const endpoint = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery`;

        const body = {
            structuredQuery: {
                from: [{ collectionId: 'stories' }],
                where: {
                    fieldFilter: {
                        field: { fieldPath: 'status' },
                        op: 'EQUAL',
                        value: { stringValue: 'published' }
                    }
                },
                orderBy: [{ field: { fieldPath: 'publishedAt' }, direction: 'DESCENDING' }],
                select: {
                    fields: [
                        { fieldPath: 'title' },
                        { fieldPath: 'authorName' },
                        { fieldPath: 'author' },
                        { fieldPath: 'publishedAt' },
                        { fieldPath: 'createdAt' },
                        { fieldPath: 'coverImage' },
                        { fieldPath: 'image' },
                        { fieldPath: 'excerpt' },
                        { fieldPath: 'deck' },
                        { fieldPath: 'dek' },
                        { fieldPath: 'category' },
                        { fieldPath: 'slug' }
                    ]
                },
                limit: 60
            }
        };

        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        if (!res.ok) throw new Error(`Firestore ${res.status}`);

        const rows = await res.json();
        if (!Array.isArray(rows)) return [];

        const docs = rows.map(r => r.document).filter(Boolean).map(firestoreDocToArticle).filter(Boolean);
        try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(docs)); } catch {}
        return docs.map(fsToNormalized).filter(Boolean);
    }

    function firestoreDocToArticle(doc) {
        const name = doc.name || '';
        const storyId = name.split('/').pop();
        const f = doc.fields || {};
        const str = k => f[k]?.stringValue ?? '';

        const publishedRaw = f.publishedAt?.timestampValue
            || f.publishedAt?.stringValue
            || f.createdAt?.timestampValue
            || f.createdAt?.stringValue
            || '';
        let dateStr = '';
        if (publishedRaw) {
            const d = new Date(publishedRaw);
            if (!isNaN(d)) {
                dateStr = d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
            }
        }

        const title = str('title');
        if (!title) return null;

        const rawImage = str('coverImage') || str('image');
        let image = FALLBACK_IMAGE;
        if (rawImage) {
            image = /^https?:\/\//i.test(rawImage)
                ? rawImage
                : `${window.location.origin}/${rawImage.replace(/^\/+/, '')}`;
        }

        const slug = str('slug') || titleToSlug(title);

        return {
            id: storyId,
            title,
            author: str('authorName') || str('author') || 'The Catalyst',
            date: dateStr,
            image,
            link: `/article/${encodeURIComponent(slug)}`,
            category: (str('category') || 'feature').toLowerCase(),
            excerpt: str('deck') || str('dek') || str('excerpt') || ''
        };
    }

    function fsToNormalized(a) {
        if (!a || !a.title) return null;
        return normalizeArticle(a);
    }

    // Merge & dedupe (local hardcoded + Firestore). Firestore wins on slug/id;
    // fall back to title-lowercase key so we never show the same story twice.
    function mergeArticles(primary, secondary) {
        const keyFor = (a) => (a.link || '').split('/').pop().toLowerCase() || titleToSlug(a.title);
        const byKey = new Map();
        const byTitle = new Map();
        for (const a of primary) {
            byKey.set(keyFor(a), a);
            byTitle.set(a.title.toLowerCase().trim(), a);
        }
        for (const a of secondary) {
            const k = keyFor(a);
            const t = a.title.toLowerCase().trim();
            if (byKey.has(k) || byTitle.has(t)) continue;
            byKey.set(k, a);
            byTitle.set(t, a);
        }
        return sortArticles(Array.from(byKey.values()));
    }

    // ---------- Hero ----------
    // Paint a neutral placeholder the moment the page renders. This avoids
    // flashing a stale hardcoded cover (e.g. an old Wix image from data.js)
    // while we wait for Firestore to resolve.
    function paintHeroPlaceholder() {
        heroBackdrop.style.backgroundImage = `url('${HERO_PLACEHOLDER}')`;
        heroBackdrop.classList.add('ready');
    }

    function paintHero(articles) {
        if (!articles.length) return;

        const src = articles[0].image || FALLBACK_IMAGE;
        const resized = getResizedImageUrl(src, 1800, 72);

        const probe = new Image();
        probe.decoding = 'async';
        probe.onload = () => {
            heroBackdrop.style.backgroundImage = `url('${resized}')`;
            heroBackdrop.classList.add('ready');
        };
        probe.onerror = () => {
            heroBackdrop.style.backgroundImage = `url('${src}')`;
            heroBackdrop.classList.add('ready');
        };
        probe.src = resized;
    }

    // ---------- Spotlight ----------
    function renderSpotlight(article) {
        if (!article) {
            spotlightEl.innerHTML = '';
            spotlightEl.removeAttribute('aria-busy');
            return;
        }
        const rawSpot = article.image || FALLBACK_IMAGE;
        const imgSrc = getResizedImageUrl(rawSpot, 1400, 82);

        spotlightEl.setAttribute('aria-busy', 'false');
        spotlightEl.innerHTML = `
            <a class="an-spotlight-link" href="${escapeHtml(article.link)}">${escapeHtml(article.title)}</a>
            <div class="an-spotlight-media">
                <img src="${escapeHtml(imgSrc)}"
                     alt="${escapeHtml(article.title)}"
                     loading="eager"
                     fetchpriority="high"
                     decoding="async"
                     onload="this.classList.add('loaded')"
                     onerror="${imageOnErrorAttr(rawSpot, imgSrc)}">
            </div>
            <div class="an-spotlight-body">
                <span class="an-spotlight-tag">${escapeHtml(formatCategory(article.category))}</span>
                <h3 class="an-spotlight-title">${escapeHtml(article.title)}</h3>
                ${article.excerpt ? `<p class="an-spotlight-excerpt">${escapeHtml(article.excerpt)}</p>` : ''}
                <div class="an-spotlight-meta">
                    <span>${escapeHtml(article.author)}</span>
                    ${article.date ? `<span class="an-dot"></span><span>${escapeHtml(formatDate(article.date))}</span>` : ''}
                </div>
                <span class="an-spotlight-cta">
                    Read the story
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M5 12h14M13 5l7 7-7 7"/>
                    </svg>
                </span>
            </div>
        `;
    }

    // Two-step fallback chain for image errors: first try the raw (original)
    // URL, and only if that also fails show the generic fallback. This
    // matches main.js so wsrv.nl proxy failures don't leave us with a blank.
    function imageOnErrorAttr(rawSrc, resizedSrc) {
        const fb = FALLBACK_IMAGE.replace(/'/g, '&apos;');
        const raw = rawSrc.replace(/'/g, '&apos;');
        if (!rawSrc || resizedSrc === rawSrc) {
            return `this.onerror=null;this.src='${fb}';this.classList.add('loaded');`;
        }
        return `this.onerror=function(){this.onerror=null;this.src='${fb}';this.classList.add('loaded');};this.src='${raw}';`;
    }

    // ---------- Cards ----------
    function cardHtml(article, variant) {
        const classes = ['an-card'];
        if (variant) classes.push(variant);

        const raw = article.image || FALLBACK_IMAGE;
        const imgSrc = getResizedImageUrl(raw, variant === 'wide' ? 1200 : 900, 80);

        return `
            <a class="${classes.join(' ')}" href="${escapeHtml(article.link)}" data-category="${escapeHtml(article.category)}">
                <div class="an-card-media">
                    <span class="an-card-cat">${escapeHtml(formatCategory(article.category))}</span>
                    <img src="${escapeHtml(imgSrc)}"
                         alt="${escapeHtml(article.title)}"
                         loading="lazy"
                         decoding="async"
                         onload="this.classList.add('loaded')"
                         onerror="${imageOnErrorAttr(raw, imgSrc)}">
                </div>
                <div class="an-card-body">
                    <h3 class="an-card-title">${escapeHtml(article.title)}</h3>
                    ${article.excerpt ? `<p class="an-card-excerpt">${escapeHtml(article.excerpt)}</p>` : ''}
                    <div class="an-card-meta">
                        <span>${escapeHtml(article.author)}</span>
                        ${article.date ? `<span class="an-dot"></span><span>${escapeHtml(formatDate(article.date))}</span>` : ''}
                    </div>
                </div>
            </a>
        `;
    }

    function variantFor(index) {
        // Pattern repeats every 5 tiles (2 wides + 3 standard = 12+12 cols).
        // That guarantees every row completely fills the 12-col grid — no gaps.
        const mod = index % 5;
        return (mod === 0 || mod === 1) ? 'wide' : '';
    }

    // ---------- Feed rendering ----------
    function filterArticles() {
        const q = currentQuery.trim().toLowerCase();
        // The first article appears in the cover spotlight above — exclude it
        // from the feed when we're in the default "all, no search" view so it
        // isn't shown twice. For any filtered view, include everything.
        const spotlightId = allArticles[0]?.id;
        const skipSpotlight = currentCategory === 'all' && !q;
        return allArticles.filter(a => {
            if (skipSpotlight && a.id === spotlightId) return false;
            if (currentCategory !== 'all' && a.category !== currentCategory) return false;
            if (!q) return true;
            return (a.title && a.title.toLowerCase().includes(q))
                || (a.author && a.author.toLowerCase().includes(q))
                || (a.excerpt && a.excerpt.toLowerCase().includes(q));
        });
    }

    function renderFeed(reset = true) {
        if (reset) {
            visibleArticles = filterArticles();
            rendered = 0;
            feedEl.innerHTML = '';
        }

        if (!visibleArticles.length) {
            emptyEl.hidden = false;
            loadMoreBtn.hidden = true;
            return;
        }
        emptyEl.hidden = true;

        const next = visibleArticles.slice(rendered, rendered + PAGE_SIZE);
        const startIndex = rendered;
        const html = next.map((a, i) => cardHtml(a, variantFor(startIndex + i))).join('');
        feedEl.insertAdjacentHTML('beforeend', html);
        rendered += next.length;

        loadMoreBtn.hidden = rendered >= visibleArticles.length;

        // Reveal the freshly appended cards on scroll
        observeCards(feedEl.querySelectorAll('.an-card:not(.in-view)'));
    }

    // ---------- Intersection-based reveal ----------
    let revealObserver = null;
    function ensureRevealObserver() {
        if (revealObserver || !('IntersectionObserver' in window)) return;
        revealObserver = new IntersectionObserver((entries) => {
            for (const entry of entries) {
                if (!entry.isIntersecting) continue;
                // Staggered reveal within a batch
                const siblings = Array.from(entry.target.parentElement?.children || []);
                const localIndex = siblings.indexOf(entry.target);
                const delay = Math.min((localIndex % 6) * 60, 360);
                setTimeout(() => entry.target.classList.add('in-view'), delay);
                revealObserver.unobserve(entry.target);
            }
        }, { rootMargin: '0px 0px -10% 0px', threshold: 0.05 });
    }

    function observeCards(nodeList) {
        if (!('IntersectionObserver' in window)) {
            nodeList.forEach(n => n.classList.add('in-view'));
            return;
        }
        ensureRevealObserver();
        nodeList.forEach(n => revealObserver.observe(n));
    }

    // ---------- Pill indicator ----------
    function movePillIndicator() {
        const active = pillGroup.querySelector('.an-pill.active');
        if (!active || !pillIndicator) return;
        const groupRect = pillGroup.getBoundingClientRect();
        const rect = active.getBoundingClientRect();
        pillIndicator.style.width = `${rect.width}px`;
        pillIndicator.style.transform = `translateX(${rect.left - groupRect.left - 5}px)`;
    }

    function setCategory(cat) {
        currentCategory = cat;
        pills.forEach(p => {
            const is = p.dataset.category === cat;
            p.classList.toggle('active', is);
            p.setAttribute('aria-selected', is ? 'true' : 'false');
        });
        movePillIndicator();
        renderFeed(true);
    }

    // ---------- Skeletons ----------
    function paintSkeletons() {
        const skeletons = Array.from({ length: 6 }, (_, i) => {
            const variant = variantFor(i);
            return `
                <div class="an-card skeleton ${variant}">
                    <div class="an-card-media"></div>
                    <div class="an-card-body">
                        <div class="an-sk-bar title"></div>
                        <div class="an-sk-bar"></div>
                        <div class="an-sk-bar short"></div>
                    </div>
                </div>
            `;
        }).join('');
        feedEl.innerHTML = skeletons;
    }

    // ---------- Events ----------
    function bindEvents() {
        pills.forEach(p => {
            p.addEventListener('click', () => setCategory(p.dataset.category));
        });

        window.addEventListener('resize', movePillIndicator);
        // The filter rail is inside scrollable content with sticky; we can still
        // listen for when it "sticks" using IntersectionObserver on a sentinel.
        // Simpler: scroll listener with throttling.
        let ticking = false;
        window.addEventListener('scroll', () => {
            if (ticking) return;
            ticking = true;
            requestAnimationFrame(() => {
                const rect = filterRail.getBoundingClientRect();
                filterRail.classList.toggle('is-stuck', rect.top <= 0);
                ticking = false;
            });
        }, { passive: true });

        // Debounced live search
        let searchTimer = null;
        searchInput.addEventListener('input', (e) => {
            const v = e.target.value;
            searchClear.hidden = v.length === 0;
            clearTimeout(searchTimer);
            searchTimer = setTimeout(() => {
                currentQuery = v;
                renderFeed(true);
            }, 140);
        });
        searchClear.addEventListener('click', () => {
            searchInput.value = '';
            searchClear.hidden = true;
            currentQuery = '';
            renderFeed(true);
            searchInput.focus();
        });

        loadMoreBtn.addEventListener('click', () => renderFeed(false));
    }

    // ---------- Init ----------
    function start() {
        // Show the neutral hero placeholder right away so the page never
        // flashes a stale hardcoded image from data.js.
        paintHeroPlaceholder();
        paintSkeletons();
        bindEvents();

        // Paint with whatever's available right now (usually window.articles
        // from data.js), then upgrade when Firestore resolves.
        const prime = () => {
            allArticles = loadArticles();
            paintAll();
            kickFirestore();
        };

        if (window.articles) {
            prime();
        } else {
            const retryStart = Date.now();
            const wait = () => {
                if (window.articles) return prime();
                if (Date.now() - retryStart < 4000) return setTimeout(wait, 80);
                prime();
            };
            wait();
        }
    }

    function kickFirestore() {
        loadFirestoreArticles()
            .then(fsList => {
                if (fsList.length) {
                    // Firestore is the source of truth for published stories —
                    // it always wins on cover image, date, excerpt, author. Fall
                    // back to the hardcoded data.js list only for titles that
                    // don't exist in Firestore.
                    allArticles = mergeArticles(fsList, allArticles);
                    renderSpotlight(allArticles[0]);
                    renderFeed(true);
                }
                // Always paint the hero from the (now-fresh) newest article.
                paintHero(allArticles);
            })
            .catch(err => {
                console.warn('[articles] Firestore load failed', err);
                // Last resort: use whatever data.js gave us so the hero isn't
                // stuck on the placeholder forever.
                paintHero(allArticles);
            });
    }

    function paintAll() {
        // Intentionally don't paint the hero here — the placeholder stays up
        // until Firestore resolves. data.js can carry stale cover images for
        // articles that were later updated in the studio, and we don't want
        // to flash those.
        renderSpotlight(allArticles[0]);
        renderFeed(true);
        // Position indicator after layout settles
        requestAnimationFrame(movePillIndicator);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }
})();
