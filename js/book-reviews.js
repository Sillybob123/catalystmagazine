// =====================================================
// book-reviews.js — Catalyst Magazine
// "The Stacks" page controller. Fetches the published
// stories in Firestore, keeps only category === "book-review",
// renders the featured spotlight + ticker + grid.
// Mirrors the resilient load pattern in articles-new.js
// (cache → data.js prime → Firestore upgrade).
// =====================================================
(function () {
    'use strict';

    const FALLBACK_IMAGE = '/NewsletterHeader1.png';
    const PAGE_SIZE      = 9;
    const CACHE_KEY      = 'catalyst_fs_cache_v5'; // shared with articles-new.js / main.js

    // ---------- DOM refs ----------
    const featuredEl   = document.getElementById('br-featured');
    const marqueeEl    = document.getElementById('br-marquee-track');
    const feedEl       = document.getElementById('br-feed');
    const emptyEl      = document.getElementById('br-empty');
    const loadMoreBtn  = document.getElementById('br-loadmore');
    const pillGroup    = document.querySelector('.br-pill-group');
    const pillIndicator= document.getElementById('br-pill-indicator');
    const pills        = Array.from(document.querySelectorAll('.br-pill'));
    const searchInput  = document.getElementById('br-search-input');
    const statCount    = document.getElementById('br-stat-count');
    const statGenres   = document.getElementById('br-stat-genres');
    const statLatest   = document.getElementById('br-stat-latest');

    // Community-section refs (added when we split the page in two).
    const communityFeedEl  = document.getElementById('br-community-feed');
    const communityEmptyEl = document.getElementById('br-community-empty');

    // Modal refs
    const modalEl       = document.getElementById('br-submit-modal');
    const modalOpenBtn  = document.getElementById('br-open-submit');
    const modalCloseBtn = document.getElementById('br-modal-close');
    const modalCancelBtn= document.getElementById('br-modal-cancel');
    const modalDoneBtn  = document.getElementById('br-modal-done');
    const modalForm     = document.getElementById('br-submit-form');
    const modalError    = document.getElementById('br-form-error');
    const modalSuccess  = document.getElementById('br-form-success');
    const modalSubmitBtn= document.getElementById('br-modal-submit');

    // ---------- State ----------
    // We keep two arrays: writer-authored reviews (allReviews — drives the
    // featured spotlight + main grid + marquee + filter rail) and community
    // submissions (communityReviews — drives the "From the Catalyzers" rail).
    let allReviews = [];
    let communityReviews = [];
    let visibleReviews = [];
    let rendered = 0;
    let currentGenre = 'all';
    let currentQuery = '';
    let featuredId = null;

    // ---------- Helpers ----------
    function escapeHtml(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function titleToSlug(title) {
        return String(title || '')
            .toLowerCase()
            .replace(/[’'"]/g, '')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 120);
    }

    function formatDate(dateStr) {
        if (!dateStr) return '';
        const d = new Date(dateStr);
        if (isNaN(d)) return dateStr;
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }

    // wsrv.nl resizer (matches the rest of the site)
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
                const h = Math.round(width * 1.25);
                return `${src}/v1/fill/w_${width},h_${h},al_c,q_${quality},enc_auto/${filename}`;
            }
            const SENTINEL = 'ENCSLASH';
            const protected_ = src.replace(/%2F/gi, SENTINEL);
            let decoded;
            try { decoded = decodeURIComponent(protected_); } catch { decoded = protected_; }
            decoded = decoded.replace(new RegExp(SENTINEL, 'g'), '%2F');
            const params = new URLSearchParams({
                url: decoded, w: width, q: quality, output: 'webp', fit: 'cover', we: ''
            });
            return `https://wsrv.nl/?${params}`;
        } catch { return src; }
    }

    function imageOnErrorAttr(rawSrc, resizedSrc) {
        const fb  = FALLBACK_IMAGE.replace(/'/g, '&apos;');
        const raw = (rawSrc || '').replace(/'/g, '&apos;');
        if (!rawSrc || resizedSrc === rawSrc) {
            return `this.onerror=null;this.src='${fb}';this.classList.add('loaded');`;
        }
        return `this.onerror=function(){this.onerror=null;this.src='${fb}';this.classList.add('loaded');};this.src='${raw}';`;
    }

    // Try to extract the book title and author from the dek/excerpt.
    // Writers are encouraged to write deks like: "Book Title — Author Name. Verdict…"
    // but we degrade gracefully when they don't.
    function parseBookMeta(article) {
        const excerpt = (article.excerpt || '').trim();
        // Pattern: "Title — Author. Rest" or "Title - Author. Rest"
        const m = excerpt.match(/^([^—\-•|]+)\s*[—\-•|]\s*([^.|]+?)[.|]\s*(.*)$/);
        if (m) {
            return {
                bookTitle: m[1].trim(),
                bookAuthor: m[2].trim(),
                blurb: m[3].trim() || excerpt
            };
        }
        return { bookTitle: article.title, bookAuthor: '', blurb: excerpt };
    }

    // Pull a numeric rating (0-5 or 0-10) from tags/title/excerpt, default 4.2.
    function extractRating(article) {
        const sources = [article.title, article.excerpt, (article.tags || []).join(' ')].filter(Boolean).join(' ');
        const m = sources.match(/(\d(?:\.\d)?)\s*\/\s*5\b/) || sources.match(/(\d(?:\.\d)?)\s*★/);
        if (m) {
            const n = parseFloat(m[1]);
            if (!isNaN(n) && n >= 0 && n <= 5) return n;
        }
        return 4.2;
    }

    // Genre tag detection. Falls back to "STEM" so cards always have a label.
    const GENRE_MAP = {
        astronomy:        ['astronomy','astro','cosmos','cosmology','space','universe','planet','star','galaxy'],
        biology:          ['biology','genetics','dna','evolution','medicine','neuro','brain','cell','organism','life'],
        'computer-science':['computer','code','coding','algorithm','machine learning','ai','artificial intelligence','software','programming'],
        physics:          ['physics','quantum','relativity','particle','thermodynamics','newton','einstein'],
        mathematics:      ['math','mathematics','geometry','statistics','probability','calculus','number'],
        memoir:           ['memoir','life','autobiography','journey','story of'],
        climate:          ['climate','earth','ocean','warming','sustainability','planet','environment','green']
    };
    function detectGenre(article) {
        const hay = `${article.title} ${article.excerpt} ${(article.tags || []).join(' ')}`.toLowerCase();
        for (const [genre, kws] of Object.entries(GENRE_MAP)) {
            if (kws.some(k => hay.includes(k))) return genre;
        }
        return 'stem';
    }
    const GENRE_LABEL = {
        astronomy:'Astronomy', biology:'Biology', 'computer-science':'Computer Science',
        physics:'Physics', mathematics:'Mathematics', memoir:'Memoir', climate:'Climate', stem:'STEM'
    };

    function normalizeReview(raw) {
        if (!raw || !raw.title) return null;
        const cat = String(raw.category || '').toLowerCase().replace(/\s+/g, '-');
        if (cat !== 'book-review' && cat !== 'bookreview') return null;

        const link = raw.link || raw.url || `/article/${encodeURIComponent(titleToSlug(raw.title))}`;
        const community = raw.communityPick === true || raw.communityPick === 'true';
        // Pick the best cover URL we know about right now. The ISBN
        // fallback (Open Library) is attempted async after render so
        // we don't block the initial paint with a network probe.
        const storedImage = raw.image || raw.coverImage || '';
        const article = {
            id: raw.id || raw._id || raw.slug || titleToSlug(raw.title),
            title: raw.title,
            author: raw.author || raw.authorName || 'The Catalyst',
            date: raw.date || '',
            image: storedImage || FALLBACK_IMAGE,
            hasStoredImage: !!storedImage,
            isbn: String(raw.isbn || '').replace(/[^0-9Xx]/g, '').toUpperCase(),
            link,
            category: 'book-review',
            community,
            excerpt: (raw.excerpt || raw.deck || raw.dek || '').replace(/\s+/g, ' ').trim(),
            tags: raw.tags || []
        };
        const meta = parseBookMeta(article);
        // For community-approved reviews the admin pipeline already stores
        // structured fields (bookAuthor, rating). Prefer those over the
        // heuristic dek parser when present.
        const rating = (typeof raw.rating === 'number' && raw.rating >= 1 && raw.rating <= 5)
            ? raw.rating
            : extractRating(article);
        // Prefer the explicit `genre` field from Firestore (writer dropdown
        // / public submission form) over the heuristic keyword detector.
        // The detector is a fallback for legacy reviews that pre-date the
        // dropdown.
        const explicitGenre = String(raw.genre || '').toLowerCase().replace(/\s+/g, '-');
        const validGenres = new Set(Object.keys(GENRE_LABEL));
        const genre = validGenres.has(explicitGenre) ? explicitGenre : detectGenre(article);
        return Object.assign(article, {
            bookTitle: meta.bookTitle,
            bookAuthor: raw.bookAuthor || meta.bookAuthor,
            blurb: meta.blurb,
            rating,
            genre
        });
    }

    function sortReviews(list) {
        return list.slice().sort((a, b) => {
            const da = Date.parse(a.date) || 0;
            const db = Date.parse(b.date) || 0;
            return db - da;
        });
    }

    // ---------- Data loading ----------
    function loadLocal() {
        const list = Array.isArray(window.articles) ? window.articles : [];
        return list.map(normalizeReview).filter(Boolean);
    }

    // Synchronous cache reader. Returns whatever the shared session cache
    // has right now (could be stale, could be empty). Used to paint the
    // page before the network probe resolves.
    function loadCachedReviews() {
        try {
            const cached = sessionStorage.getItem(CACHE_KEY);
            if (!cached) return [];
            const parsed = JSON.parse(cached);
            if (!Array.isArray(parsed)) return [];
            return parsed.map(normalizeReview).filter(Boolean);
        } catch { return []; }
    }

    // Always fetches Firestore — never returns the cache. We do this on
    // every /book-reviews load so a freshly-published review shows up
    // immediately, even if the user already has a cache from /articles
    // or the home page.
    async function loadFirestoreReviews() {
        const projectId = 'catalystwriters-5ce43';
        const endpoint  = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery`;

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
                        { fieldPath: 'slug' },
                        // Book-review-specific fields surfaced by the
                        // approve flow in /api/book-reviews/decide.
                        { fieldPath: 'communityPick' },
                        { fieldPath: 'bookAuthor' },
                        { fieldPath: 'rating' },
                        { fieldPath: 'isbn' },
                        { fieldPath: 'genre' }
                    ]
                },
                limit: 80
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
        return docs.map(normalizeReview).filter(Boolean);
    }

    function firestoreDocToArticle(doc) {
        const name = doc.name || '';
        const storyId = name.split('/').pop();
        const f = doc.fields || {};
        const str  = k => f[k]?.stringValue ?? '';
        const bool = k => f[k]?.booleanValue === true;
        const num  = k => {
            const v = f[k];
            if (!v) return null;
            if ('doubleValue' in v)  return Number(v.doubleValue);
            if ('integerValue' in v) return parseInt(v.integerValue, 10);
            return null;
        };

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
            category: (str('category') || '').toLowerCase().replace(/\s+/g, '-'),
            excerpt: str('deck') || str('dek') || str('excerpt') || '',
            communityPick: bool('communityPick'),
            bookAuthor: str('bookAuthor'),
            rating: num('rating'),
            isbn: str('isbn'),
            genre: (str('genre') || '').toLowerCase().replace(/\s+/g, '-')
        };
    }

    function mergeReviews(primary, secondary) {
        const keyFor = (a) => (a.link || '').split('/').pop().toLowerCase() || titleToSlug(a.title);
        const byKey   = new Map();
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
        return sortReviews(Array.from(byKey.values()));
    }

    // ---------- Rendering ----------
    function renderFeatured(review) {
        if (!review) {
            featuredEl.innerHTML = `
                <div class="br-featured-empty">
                    <h2 class="br-section-title">A new column, <em>just getting started.</em></h2>
                    <p class="br-section-lede">
                        The Stacks is The Catalyst's monthly book column — short, honest
                        write-ups on STEM books worth your shelf space. The first
                        recommendation lands soon. Check back, or browse the backlog below
                        as it fills in.
                    </p>
                </div>
            `;
            return;
        }
        const raw = review.image || FALLBACK_IMAGE;
        // Use the book-cover-aware helper so Google Books / Open Library
        // URLs aren't re-encoded through wsrv.nl (which crops + loses
        // quality on a featured-sized cover).
        const resized = getCoverImageUrl(raw, 1200, 92);
        const score = Math.round((review.rating / 5) * 100);

        featuredEl.innerHTML = `
            <div class="br-featured-grid">
                <a class="br-featured-cover" href="${escapeHtml(review.link)}" aria-label="${escapeHtml(review.bookTitle)}">
                    <img src="${escapeHtml(resized)}"
                         alt="Cover of ${escapeHtml(review.bookTitle)}"
                         loading="eager" fetchpriority="high" decoding="async"
                         onload="this.classList.add('loaded')"
                         onerror="${imageOnErrorAttr(raw, resized)}">
                </a>
                <div class="br-featured-body">
                    <span class="br-featured-tag">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
                        </svg>
                        Featured review
                    </span>
                    <h2 class="br-featured-title">${escapeHtml(review.bookTitle)}</h2>
                    ${review.bookAuthor ? `<p class="br-featured-author">by ${escapeHtml(review.bookAuthor)}</p>` : ''}
                    ${review.blurb ? `<p class="br-featured-dek">${escapeHtml(review.blurb)}</p>` : ''}

                    <div class="br-rating">
                        <div class="br-rating-dial" style="--score:${score}">
                            <span class="br-rating-dial-value">${review.rating.toFixed(1)}<small>/5</small></span>
                        </div>
                        <div>
                            <div class="br-rating-label">Catalyst rating</div>
                            <div style="margin-top:4px;color:var(--text-muted);font-size:13px;">${escapeHtml(GENRE_LABEL[review.genre] || 'STEM')} · ${escapeHtml(formatDate(review.date))}</div>
                        </div>
                    </div>

                    <div class="br-featured-byline">
                        <div>
                            <div style="font-size:11px;letter-spacing:.22em;text-transform:uppercase;color:var(--text-subtle);">Reviewed by</div>
                            <strong>${escapeHtml(review.author)}</strong>
                        </div>
                    </div>

                    <a class="br-featured-cta" href="${escapeHtml(review.link)}">
                        Read the full review
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                            <path d="M5 12h14M13 5l7 7-7 7"/>
                        </svg>
                    </a>
                </div>
            </div>
        `;

        // Featured cover upgrade. Three cases:
        //   • no stored cover + ISBN → paint Open Library, then upgrade to Google
        //   • stored cover IS an Open Library URL + ISBN → upgrade to Google
        //   • stored cover is anything else (Wix, Firebase, custom URL) →
        //     leave alone (writer chose this image deliberately)
        // This is the same logic we apply to grid cards; the featured
        // spotlight needs it too because it's the largest cover on the
        // page and low-quality is most visible there.
        if (review.isbn) {
            const storedIsOpenLibrary = !!review.image &&
                /covers\.openlibrary\.org\/b\/isbn\//.test(review.image);
            const needsUpgrade = !review.hasStoredImage || storedIsOpenLibrary;
            if (needsUpgrade) {
                // Paint the fast Open Library cover first if we don't already have one.
                if (!review.hasStoredImage) {
                    const olUrl = `https://covers.openlibrary.org/b/isbn/${review.isbn}-L.jpg?default=false`;
                    const probe = new Image();
                    probe.onload = () => {
                        if (probe.naturalWidth <= 1) return;
                        const img = featuredEl.querySelector('.br-featured-cover img');
                        if (img) img.src = olUrl;
                    };
                    probe.src = olUrl;
                }
                // Always try the Google Books high-res upgrade.
                upgradeCardToGoogleBooks(featuredEl, review.isbn);
            }
        }
    }

    function renderMarquee(reviews) {
        if (!reviews.length) {
            // Provide a placeholder ticker so the rail isn't empty pre-launch.
            const seed = [
                'The Code Breaker', 'A Brief History of Time', 'Entangled Life',
                'The Disordered Cosmos', 'The Gene', 'How Infrastructure Works',
                'Immune', 'Lost in Math'
            ];
            const html = seed.concat(seed).map(t => `<span class="br-marquee-item">${escapeHtml(t)}</span>`).join('');
            marqueeEl.innerHTML = html;
            return;
        }
        const titles = reviews.map(r => r.bookTitle);
        const doubled = titles.concat(titles); // seamless loop
        marqueeEl.innerHTML = doubled.map(t => `<span class="br-marquee-item">${escapeHtml(t)}</span>`).join('');
    }

    function variantFor(index) {
        // Asymmetric: every 5th tile is wide for visual rhythm.
        const mod = index % 5;
        return (mod === 2) ? 'wide' : '';
    }

    // Book-cover-aware URL helper. Skips the wsrv.nl proxy for sources
    // that already serve well-compressed, properly-sized covers (Google
    // Books, Open Library) because re-encoding through wsrv.nl visibly
    // degrades them — extra JPEG→WebP loss + center-crop chopping the
    // spine. For any other host, fall back to the standard resizer but
    // with fit=contain so book covers aren't cropped.
    function getCoverImageUrl(src, width, quality) {
        if (!src) return src;
        try {
            const host = new URL(src).hostname;
            if (host.includes('books.google.com') ||
                host.includes('googleusercontent.com') ||
                host.includes('covers.openlibrary.org') ||
                host.includes('firebasestorage.googleapis.com') ||
                host.includes('storage.googleapis.com')) {
                return src;
            }
        } catch { /* not a URL — fall through */ }
        // wsrv.nl path: same as getResizedImageUrl but force fit=contain
        // so we never crop the book.
        const resized = getResizedImageUrl(src, width, quality);
        return resized.replace('fit=cover', 'fit=contain');
    }

    function cardHtml(review, variant) {
        const classes = ['br-card'];
        if (variant) classes.push(variant);

        const raw = review.image || FALLBACK_IMAGE;
        const targetW = variant === 'wide' ? 1100 : 720;
        const imgSrc  = getCoverImageUrl(raw, targetW, 88);

        // Community submissions get a clear "Reader pick" badge so it's
        // obvious where each card came from at a glance.
        const pickBadge = review.community ? `
            <span class="br-card-pick" aria-label="Reader pick">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                </svg>
                Reader pick
            </span>` : '';

        // Cards that should attempt an ISBN-based cover upgrade:
        //  • no stored cover → backfill from scratch
        //  • stored cover IS an Open Library 'L' URL → try Google Books
        //    upgrade (higher-res scan)
        // Either way, we tag the card with the ISBN so backfillIsbnCovers
        // can run after first paint.
        const storedIsOpenLibrary = !!review.image &&
            /covers\.openlibrary\.org\/b\/isbn\//.test(review.image);
        const needsIsbnBackfill = !!review.isbn &&
            (!review.hasStoredImage || storedIsOpenLibrary);

        return `
            <a class="${classes.join(' ')}"
               href="${escapeHtml(review.link)}"
               data-genre="${escapeHtml(review.genre)}"
               data-community="${review.community ? 'true' : 'false'}"
               ${needsIsbnBackfill ? `data-isbn="${escapeHtml(review.isbn)}"` : ''}>
                <div class="br-card-media">
                    <img src="${escapeHtml(imgSrc)}"
                         alt="Cover of ${escapeHtml(review.bookTitle)}"
                         loading="lazy" decoding="async"
                         onload="this.classList.add('loaded')"
                         onerror="${imageOnErrorAttr(raw, imgSrc)}">
                    <span class="br-card-rating" aria-label="Rated ${review.rating.toFixed(1)} out of 5">
                        ${review.rating.toFixed(1)}<small>/5</small>
                    </span>
                    <span class="br-card-genre">${escapeHtml(GENRE_LABEL[review.genre] || 'STEM')}</span>
                    ${pickBadge}
                </div>
                <div class="br-card-body">
                    <h3 class="br-card-book">${escapeHtml(review.bookTitle)}</h3>
                    ${review.bookAuthor ? `<p class="br-card-author">by ${escapeHtml(review.bookAuthor)}</p>` : ''}
                    ${review.blurb ? `<p class="br-card-blurb">${escapeHtml(review.blurb)}</p>` : ''}
                    <div class="br-card-meta">
                        <strong>${escapeHtml(review.author)}</strong>
                        ${review.date ? `<span class="br-dot"></span><span>${escapeHtml(formatDate(review.date))}</span>` : ''}
                    </div>
                </div>
            </a>
        `;
    }

    // ---------- Community feed (separate from the writer feed) ----------
    function renderCommunityFeed() {
        if (!communityFeedEl) return;
        if (!communityReviews.length) {
            communityFeedEl.innerHTML = '';
            if (communityEmptyEl) communityEmptyEl.hidden = false;
            return;
        }
        if (communityEmptyEl) communityEmptyEl.hidden = true;
        // Show the most recent 6 community picks; the rest can be reached
        // via search on the main grid (community + writers).
        const slice = communityReviews.slice(0, 6);
        communityFeedEl.innerHTML = slice
            .map((r, i) => cardHtml(r, variantFor(i)))
            .join('');
        observeCards(communityFeedEl.querySelectorAll('.br-card:not(.in-view)'));
        backfillIsbnCovers(communityFeedEl);
    }

    // ---------- Filtering & paging ----------
    // The featured spotlight at the top of the page is the most-recent
    // writer review. Normally we hide it from the grid below to avoid
    // showing the same story twice — but only when there's at least one
    // OTHER writer review to fill the grid. Otherwise we end up with an
    // empty "From our writers" rail right under a featured story we just
    // showed.
    function filterReviews() {
        const q = currentQuery.trim().toLowerCase();
        // Only skip the featured when:
        //   • the user is on the default "All / no search" view AND
        //   • the grid would still have at least one card without it.
        const skipFeatured = currentGenre === 'all' && !q && allReviews.length > 1;
        return allReviews.filter(r => {
            if (skipFeatured && r.id === featuredId) return false;
            if (currentGenre !== 'all' && r.genre !== currentGenre) return false;
            if (!q) return true;
            const hay = `${r.title} ${r.bookAuthor} ${r.author} ${r.blurb} ${r.genre}`.toLowerCase();
            return hay.includes(q);
        });
    }

    function renderFeed(reset = true) {
        if (reset) {
            visibleReviews = filterReviews();
            rendered = 0;
            feedEl.innerHTML = '';
        }
        if (!visibleReviews.length) {
            emptyEl.hidden = false;
            loadMoreBtn.hidden = true;
            return;
        }
        emptyEl.hidden = true;

        const next = visibleReviews.slice(rendered, rendered + PAGE_SIZE);
        const startIndex = rendered;
        const html = next.map((r, i) => cardHtml(r, variantFor(startIndex + i))).join('');
        feedEl.insertAdjacentHTML('beforeend', html);
        rendered += next.length;
        loadMoreBtn.hidden = rendered >= visibleReviews.length;

        observeCards(feedEl.querySelectorAll('.br-card:not(.in-view)'));
        backfillIsbnCovers(feedEl);
    }

    // ---------- ISBN cover backfill ----------
    // When a review has an ISBN but no stored cover (typical for community
    // submissions or pre-publication drafts), probe Open Library and swap
    // the image in place. We do this AFTER the initial render so the page
    // is never blocked on a network probe — the placeholder paints first.
    //
    // Two-stage upgrade: Open Library 'L' goes in first (fast, no JSON),
    // then we try Google Books for an even higher-resolution scan and
    // upgrade in place. The image element keeps the same DOM node so the
    // CSS doesn't re-trigger the fade-in animation.
    function backfillIsbnCovers(scope) {
        const targets = scope.querySelectorAll('.br-card[data-isbn]:not([data-isbn-tried])');
        targets.forEach(card => {
            card.setAttribute('data-isbn-tried', '1');
            const isbn = card.getAttribute('data-isbn');
            if (!isbn) return;
            const img = card.querySelector('.br-card-media img');

            // Stage 1: Open Library (fast).
            const olUrl = `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false`;
            probe.onload = () => {
                if (probe.naturalWidth <= 1) return;
                if (img) {
                    img.src = olUrl;
                    img.classList.add('loaded');
                }
                // Stage 2: try to upgrade to the (higher-res) Google Books
                // scan. Failures here are silent — we already have a cover.
                upgradeCardToGoogleBooks(card, isbn);
            };
            probe.onerror = () => {
                // Open Library doesn't have it either. Last shot: Google.
                upgradeCardToGoogleBooks(card, isbn);
            };
            probe.src = olUrl;
        });
    }

    // Fetch the high-res Google Books cover (if any) and swap it in.
    // Cached per-ISBN in sessionStorage so repeated page loads don't
    // re-hit Google's JSON endpoint. Accepts either a card element
    // (will find .br-card-media img) or any container with an <img>
    // inside (used for the featured spotlight cover).
    async function upgradeCardToGoogleBooks(container, isbn) {
        const cacheKey = `gb_cover_${isbn}`;
        let url;
        try {
            const cached = sessionStorage.getItem(cacheKey);
            if (cached !== null) {
                url = cached || null;
            } else {
                const res = await fetch(`https://www.googleapis.com/books/v1/volumes?q=isbn:${encodeURIComponent(isbn)}&country=US&maxResults=1`);
                if (res.ok) {
                    const data  = await res.json();
                    const links = data.items?.[0]?.volumeInfo?.imageLinks;
                    const raw   = links?.extraLarge || links?.large || links?.medium ||
                                  links?.small || links?.thumbnail || links?.smallThumbnail;
                    if (raw) {
                        url = String(raw).replace(/^http:\/\//i, 'https://')
                                         .replace(/(\?|&)zoom=\d+/g, '$1zoom=0')
                                         .replace(/(\?|&)edge=curl/g, '$1edge=none');
                    } else {
                        url = null;
                    }
                }
                try { sessionStorage.setItem(cacheKey, url || ''); } catch {}
            }
        } catch { return; }
        if (!url) return;
        const img = container.querySelector('.br-card-media img')
                 || container.querySelector('.br-featured-cover img')
                 || container.querySelector('img');
        if (!img) return;
        // Preload the high-res before swapping so the user doesn't see a
        // flicker between the smaller and larger versions.
        const pre = new Image();
        pre.onload = () => {
            if (pre.naturalWidth > 1) {
                img.src = url;
                img.classList.add('loaded');
            }
        };
        pre.src = url;
    }

    // ---------- Stats ----------
    function paintStats(combined) {
        const set = Array.isArray(combined) && combined.length ? combined : allReviews;
        if (statCount)   statCount.textContent = set.length || '—';
        if (statGenres)  statGenres.textContent = new Set(set.map(r => r.genre)).size || '—';
        if (statLatest && set.length) statLatest.textContent = formatDate(set[0].date) || '—';
    }

    // ---------- Reveal observer ----------
    let revealObserver = null;
    function ensureRevealObserver() {
        if (revealObserver || !('IntersectionObserver' in window)) return;
        revealObserver = new IntersectionObserver((entries) => {
            for (const entry of entries) {
                if (!entry.isIntersecting) continue;
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

    // Scroll-driven "book spread": as the hero scrolls past, the stack
    // of books on the right fans outward and scales up. Progress (0 → 1)
    // is mapped from "hero fully in view" → "hero half-scrolled-out", so
    // the climax happens just before the user reaches the featured review.
    function attachScrollSpread() {
        const stack = document.querySelector('.br-hero-stack');
        const hero  = document.getElementById('br-hero');
        if (!stack || !hero) return;
        // Respect users who don't want motion.
        const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
        if (mq.matches) return;

        let ticking = false;
        const update = () => {
            const rect = hero.getBoundingClientRect();
            // viewport height is the "exit window": progress reaches 1 as
            // the hero bottom passes the top of the viewport.
            const vh = window.innerHeight || document.documentElement.clientHeight;
            // raw goes from 0 (hero at top of viewport) → 1 (hero fully scrolled past)
            const traveled = Math.min(Math.max(-rect.top / Math.max(rect.height - vh * 0.3, 1), 0), 1);
            // Ease with a smoothstep so the books accelerate gracefully
            const eased = traveled * traveled * (3 - 2 * traveled);
            stack.style.setProperty('--br-spread', eased.toFixed(3));
            stack.dataset.spread = eased > 0.7 ? '1' : '0';
            ticking = false;
        };
        const onScroll = () => {
            if (ticking) return;
            ticking = true;
            requestAnimationFrame(update);
        };
        window.addEventListener('scroll', onScroll, { passive: true });
        window.addEventListener('resize', onScroll, { passive: true });
        update();
    }

    // Reveal scroll animation for hero / section eyebrows
    function attachReveals() {
        const els = document.querySelectorAll('.br-reveal');
        if (!('IntersectionObserver' in window)) {
            els.forEach(e => e.classList.add('in'));
            return;
        }
        const io = new IntersectionObserver(entries => {
            entries.forEach(en => {
                if (en.isIntersecting) {
                    en.target.classList.add('in');
                    io.unobserve(en.target);
                }
            });
        }, { rootMargin: '0px 0px -10% 0px', threshold: 0.05 });
        els.forEach(e => io.observe(e));
    }

    // ---------- Pill indicator ----------
    function movePillIndicator() {
        const active = pillGroup?.querySelector('.br-pill[aria-selected="true"]');
        if (!active || !pillIndicator) return;
        const groupRect = pillGroup.getBoundingClientRect();
        const rect = active.getBoundingClientRect();
        pillIndicator.style.width = `${rect.width}px`;
        pillIndicator.style.transform = `translateX(${rect.left - groupRect.left - 4}px)`;
    }
    function setGenre(g) {
        currentGenre = g;
        pills.forEach(p => {
            const is = p.dataset.genre === g;
            p.setAttribute('aria-selected', is ? 'true' : 'false');
        });
        movePillIndicator();
        renderFeed(true);
    }

    // ---------- Skeletons ----------
    function paintSkeletons() {
        const skeletons = Array.from({ length: 6 }, (_, i) => {
            const v = variantFor(i);
            return `
                <div class="br-card skeleton ${v}">
                    <div class="br-card-media"></div>
                    <div class="br-card-body">
                        <div class="br-sk-bar title"></div>
                        <div class="br-sk-bar"></div>
                        <div class="br-sk-bar short"></div>
                    </div>
                </div>
            `;
        }).join('');
        feedEl.innerHTML = skeletons;
    }

    // ---------- Wiring ----------
    function bindEvents() {
        pills.forEach(p => p.addEventListener('click', () => setGenre(p.dataset.genre)));

        if (searchInput) {
            let t = null;
            searchInput.addEventListener('input', e => {
                clearTimeout(t);
                t = setTimeout(() => {
                    currentQuery = e.target.value || '';
                    renderFeed(true);
                }, 120);
            });
        }
        loadMoreBtn?.addEventListener('click', () => renderFeed(false));
        window.addEventListener('resize', movePillIndicator);
    }

    // Split the merged review set into writer reviews (drive the featured
    // spotlight, marquee, main grid, and stats) and community picks (drive
    // the "From the Catalyzers" section). Sorted independently so the most
    // recent of each surfaces at the top.
    function splitReviews(merged) {
        const writers   = [];
        const community = [];
        for (const r of merged) {
            if (r.community) community.push(r);
            else             writers.push(r);
        }
        return { writers: sortReviews(writers), community: sortReviews(community) };
    }

    function paintAll() {
        const featured = allReviews[0] || null;
        featuredId = featured ? featured.id : null;
        renderFeatured(featured);
        // Marquee + stats summarize the whole library, writers + readers.
        const combined = allReviews.concat(communityReviews);
        renderMarquee(combined);
        paintStats(combined);
        renderFeed(true);
        renderCommunityFeed();
        requestAnimationFrame(movePillIndicator);
    }

    function kickFirestore() {
        loadFirestoreReviews()
            .then(fsList => {
                if (fsList.length) {
                    // Merge against the combined set so dedupe works across both
                    // groups, then re-split.
                    const merged = mergeReviews(fsList, allReviews.concat(communityReviews));
                    const split = splitReviews(merged);
                    allReviews        = split.writers;
                    communityReviews  = split.community;
                }
                paintAll();
            })
            .catch(err => {
                console.warn('[book-reviews] Firestore load failed', err);
                paintAll();
            });
    }

    // =============================================================
    // SUBMISSION MODAL — public form
    // The modal is wired up once at start(). Opening/closing toggles
    // .is-open on the backdrop; submit POSTs to /api/book-reviews/submit
    // and flips to the success panel. Keyboard: Escape closes; first
    // input gets focus on open. Background scroll is locked while open.
    // =============================================================
    function setupSubmitModal() {
        if (!modalEl || !modalForm) return;

        let lastFocused = null;
        const focusableSelector = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled])';

        function openModal() {
            lastFocused = document.activeElement;
            modalEl.classList.add('is-open');
            modalEl.setAttribute('aria-hidden', 'false');
            document.body.style.overflow = 'hidden';
            // Reset to the form view in case the user re-opens after a success.
            modalForm.hidden = false;
            modalSuccess.hidden = true;
            modalError.hidden = true;
            // Focus the first field for keyboard users.
            const firstInput = modalForm.querySelector('input, textarea, select');
            if (firstInput) requestAnimationFrame(() => firstInput.focus());
        }

        function closeModal() {
            modalEl.classList.remove('is-open');
            modalEl.setAttribute('aria-hidden', 'true');
            document.body.style.overflow = '';
            if (lastFocused && typeof lastFocused.focus === 'function') {
                lastFocused.focus();
            }
        }

        modalOpenBtn?.addEventListener('click', openModal);
        modalCloseBtn?.addEventListener('click', closeModal);
        modalCancelBtn?.addEventListener('click', closeModal);
        modalDoneBtn?.addEventListener('click', closeModal);

        // Backdrop click closes; clicks inside the modal panel don't bubble.
        modalEl.addEventListener('click', (e) => {
            if (e.target === modalEl) closeModal();
        });

        // Escape to close + a tiny focus trap so Tab stays inside the modal.
        document.addEventListener('keydown', (e) => {
            if (!modalEl.classList.contains('is-open')) return;
            if (e.key === 'Escape') {
                e.preventDefault();
                closeModal();
                return;
            }
            if (e.key === 'Tab') {
                const focusables = Array.from(modalEl.querySelectorAll(focusableSelector))
                    .filter(el => !el.hidden && el.offsetParent !== null);
                if (!focusables.length) return;
                const first = focusables[0];
                const last  = focusables[focusables.length - 1];
                if (e.shiftKey && document.activeElement === first) {
                    e.preventDefault();
                    last.focus();
                } else if (!e.shiftKey && document.activeElement === last) {
                    e.preventDefault();
                    first.focus();
                }
            }
        });

        // Form submit
        modalForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            modalError.hidden = true;

            const data = new FormData(modalForm);
            const payload = {
                submitterName:  String(data.get('submitterName')  || '').trim(),
                submitterEmail: String(data.get('submitterEmail') || '').trim(),
                bookTitle:      String(data.get('bookTitle')      || '').trim(),
                bookAuthor:     String(data.get('bookAuthor')     || '').trim(),
                isbn:           String(data.get('isbn')           || '').trim(),
                rating:         String(data.get('rating')         || '').trim(),
                genre:          String(data.get('genre')          || '').trim(),
                deck:           String(data.get('deck')           || '').trim(),
                reviewText:     String(data.get('reviewText')     || '').trim(),
                // Honeypot. Real users send this empty; bots will fill it.
                website:        String(data.get('website')        || '').trim(),
            };

            // Lightweight client-side validation; the server re-validates too.
            const errors = [];
            if (!payload.submitterName)  errors.push('Please tell us your name.');
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.submitterEmail)) errors.push('Please enter a valid email address.');
            if (!payload.bookTitle)      errors.push('Book title is required.');
            if (!payload.bookAuthor)     errors.push('Book author is required.');
            if (!payload.genre)          errors.push('Please pick a discipline so we can shelve it right.');
            if (payload.deck.length < 10) errors.push('Please add a one-sentence summary of the book.');
            if (payload.reviewText.length < 40) errors.push('Tell us a little more — at least a few sentences.');
            if (errors.length) {
                modalError.textContent = errors[0];
                modalError.hidden = false;
                modalError.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                return;
            }

            // Toggle button to busy state
            const idle = modalSubmitBtn.querySelector('[data-label-idle]');
            const busy = modalSubmitBtn.querySelector('[data-label-busy]');
            modalSubmitBtn.disabled = true;
            if (idle) idle.hidden = true;
            if (busy) busy.hidden = false;

            try {
                const res = await fetch('/api/book-reviews/submit', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                });
                const json = await res.json().catch(() => ({}));
                if (!res.ok || !json.ok) {
                    const msg = json.error || `Submission failed (${res.status}). Please try again.`;
                    throw new Error(msg);
                }
                // Success — flip to the thank-you panel and reset the form
                // so a re-open is a clean slate.
                modalForm.reset();
                modalForm.hidden = true;
                modalSuccess.hidden = false;
                modalSuccess.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            } catch (err) {
                modalError.textContent = err.message || 'Something went wrong. Please try again.';
                modalError.hidden = false;
            } finally {
                modalSubmitBtn.disabled = false;
                if (idle) idle.hidden = false;
                if (busy) busy.hidden = true;
            }
        });
    }

    function start() {
        paintSkeletons();
        bindEvents();
        attachReveals();
        attachScrollSpread();
        setupSubmitModal();

        const prime = () => {
            // Seed paint: prefer the shared session cache (built by main.js
            // or articles-new.js on a previous visit in this tab) so the
            // page paints with real data immediately. Fall back to whatever
            // is in window.articles (data.js).
            const seedRaw = loadCachedReviews();
            const seed = seedRaw.length ? seedRaw : loadLocal();
            const split = splitReviews(seed);
            allReviews       = split.writers;
            communityReviews = split.community;
            paintAll();
            // Fresh fetch always runs and overwrites whatever the cache had,
            // so a freshly-published book review appears on first visit.
            kickFirestore();
        };
        if (window.articles) {
            prime();
        } else {
            const t0 = Date.now();
            const wait = () => {
                if (window.articles) return prime();
                if (Date.now() - t0 < 4000) return setTimeout(wait, 80);
                prime();
            };
            wait();
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }
})();
