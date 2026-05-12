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
    const searchInput  = document.getElementById('br-search-input');
    const searchClear  = document.getElementById('br-search-clear');
    const railGenreEl  = document.getElementById('br-rail-genre-select');
    const statCount    = document.getElementById('br-stat-count');
    const statGenres   = document.getElementById('br-stat-genres');
    const statLatest   = document.getElementById('br-stat-latest');

    // Community-section refs (added when we split the page in two).
    const communityFeedEl       = document.getElementById('br-community-feed');
    const communityEmptyEl      = document.getElementById('br-community-empty');
    const communityNoMatchEl    = document.getElementById('br-community-no-match');
    const communitySearchEl     = document.getElementById('br-community-search-input');
    const communitySearchClear  = document.getElementById('br-community-search-clear');
    const communityStatusEl     = document.getElementById('br-community-status');
    const communityCountEl      = document.getElementById('br-community-count');
    const communityTopGenreEl   = document.getElementById('br-community-top-genre');
    const communityLoadMoreEl   = document.getElementById('br-community-loadmore');
    const communityLoadMoreWrap = document.getElementById('br-community-loadmore-wrap');
    const communityGenreEl      = document.getElementById('br-community-genre-filter');

    const COMMUNITY_PAGE_SIZE = 9;
    let communityQuery   = '';
    let communityGenre   = 'all';
    let communityShown   = COMMUNITY_PAGE_SIZE;

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

    // Try to extract legacy book title/author data from the dek/excerpt.
    // Firestore book reviews store the actual book title in `title`, so this
    // parser is only for older/local records whose title field was generic
    // and whose dek looked like: "Book Title — Author Name. Verdict…".
    function parseBookMeta(article) {
        const excerpt = (article.excerpt || '').trim();
        const fallback = { bookTitle: article.title, bookAuthor: '', blurb: excerpt };
        if (!article.allowExcerptMetaParse) return fallback;

        // Pattern: "Title — Author. Rest" or "Title - Author. Rest"
        const m = excerpt.match(/^([^—\-•|]+)\s*[—\-•|]\s*([^.|]+?)[.|]\s*(.*)$/);
        if (m) {
            return {
                bookTitle: m[1].trim(),
                bookAuthor: m[2].trim(),
                blurb: m[3].trim() || excerpt
            };
        }
        return fallback;
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
        chemistry:        ['chemistry','chemical','periodic','molecule','reaction','element','compound','atom'],
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
        astronomy:'Astronomy', biology:'Biology', chemistry:'Chemistry',
        'computer-science':'Computer Science',
        physics:'Physics', mathematics:'Mathematics', memoir:'Memoir', climate:'Climate', stem:'STEM'
    };

    function normalizeReview(raw) {
        if (!raw || !raw.title) return null;
        const cat = String(raw.category || '').toLowerCase().replace(/\s+/g, '-');
        if (cat !== 'book-review' && cat !== 'bookreview') return null;

        // Book reviews canonicalize on /book-review/<slug>. Don't trust
        // raw.link from cached JSON either — it may still say /article/
        // from before the URL move.
        const link = `/book-review/${encodeURIComponent(raw.slug || titleToSlug(raw.title))}`;
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
            allowExcerptMetaParse: raw.source === 'local',
            tags: raw.tags || []
        };
        const meta = parseBookMeta(article);
        // For community-approved reviews the admin pipeline already stores
        // structured fields (bookAuthor, rating). Prefer those over the
        // heuristic dek parser when present. The submission API accepts
        // ratings down to 0.5, so anything in [0.5, 5] is a real number
        // and must NOT fall through to the heuristic extractor (which
        // defaults to 4.2 and silently rewrites reader scores like 0.5).
        //
        // For community picks, the only trustworthy rating source is
        // raw.rating — there is no review-body text to mine for an
        // "X/5" signal. If raw.rating is missing, treat the review as
        // UNRATED instead of inventing 4.2; otherwise a real 0.5 score
        // that was previously stored as null (older decide.js bug) ends
        // up displayed as the heuristic default.
        const storedRating = (typeof raw.rating === 'number' && raw.rating >= 0.5 && raw.rating <= 5)
            ? raw.rating
            : null;
        const isCommunity = community;
        const rating = storedRating != null
            ? storedRating
            : (isCommunity ? null : extractRating(article));
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
        return list.map((item) => normalizeReview({ ...item, source: 'local' })).filter(Boolean);
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
            // This loader only ever returns book-reviews (filtered downstream),
            // so the link prefix is /book-review/.
            link: `/book-review/${encodeURIComponent(slug)}`,
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
        // Dedupe on STORY IDENTITY, not title. Two community reviews of the
        // same book are legitimate distinct entries — the aggregate card
        // collapses them back together for display. We previously deduped
        // by lowercase title here, which silently dropped every duplicate
        // pick so the aggregate card never had >1 review to combine.
        const keyFor = (a) =>
            String(a.id || (a.link || '').split('/').pop() || titleToSlug(a.title))
                .toLowerCase();
        const byKey = new Map();
        for (const a of primary) {
            const k = keyFor(a);
            if (!k) continue;
            byKey.set(k, a);
        }
        for (const a of secondary) {
            const k = keyFor(a);
            if (!k || byKey.has(k)) continue;
            byKey.set(k, a);
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
                            <span class="br-rating-dial-value">${review.rating.toFixed(1)}</span>
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
        // Keep review grids uniform: equal-width cards read cleaner,
        // especially in the reader-picks section where there may only be
        // three reviews.
        return '';
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

        // Community submissions get a clear "Reader pick" badge in the
        // card body instead of over the cover, so the jacket art stays
        // unobstructed.
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
                    <span class="br-card-genre">${escapeHtml(GENRE_LABEL[review.genre] || 'STEM')}</span>
                </div>
                <div class="br-card-body">
                    <div class="br-card-kicker">
                        ${typeof review.rating === 'number'
                            ? `<span class="br-card-rating" aria-label="Rated ${review.rating.toFixed(1)} out of 5">
                                    ${review.rating.toFixed(1)}<small>/5</small>
                               </span>`
                            : `<span class="br-card-rating br-card-rating-unrated" aria-label="Unrated">
                                    —<small>/5</small>
                               </span>`}
                        ${pickBadge}
                    </div>
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

    // Aggregate card — used when 2+ community reviews share the same
    // book. Inherits the standard .br-card silhouette (floating cover,
    // body below, no outer box) so it sits at the same height/width as
    // its neighbours in the grid. Adds three small bits of unique chrome:
    // a "stack of papers" hint behind the cover, a "N readers" pill in
    // the kicker row, and a "See all N reviews" button that opens the
    // reviews modal (search + sort + scroll). Single-review groups
    // render through cardHtml() unchanged.
    function aggregateCardHtml(group, variant) {
        const lead = group.lead;
        const classes = ['br-card', 'br-card-aggregate'];
        if (variant) classes.push(variant);

        const raw = lead.image || FALLBACK_IMAGE;
        const targetW = variant === 'wide' ? 1100 : 720;
        const imgSrc  = getCoverImageUrl(raw, targetW, 88);

        const storedIsOpenLibrary = !!lead.image &&
            /covers\.openlibrary\.org\/b\/isbn\//.test(lead.image);
        const needsIsbnBackfill = !!lead.isbn &&
            (!lead.hasStoredImage || storedIsOpenLibrary);

        const avg = group.avgRating != null ? group.avgRating : null;
        const ratingDisplay = avg != null
            ? `${avg.toFixed(1)}<small>/5</small>`
            : '—';
        const readersLabel = `${group.count} ${group.count === 1 ? 'reader' : 'readers'}`;

        // The entire card is a clickable surface that opens the reviews modal.
        // The outer element is a <div role="button"> so the cover, title, and
        // body all trigger the modal on click. No nested <a> tags — those would
        // conflict with the outer interactive role.
        return `
            <div class="${classes.join(' ')}"
                 data-group-key="${escapeHtml(group.key)}"
                 data-community="true"
                 data-aggregate="true"
                 data-genre="${escapeHtml(lead.genre)}"
                 role="button"
                 tabindex="0"
                 aria-haspopup="dialog"
                 aria-label="See all reviews for ${escapeHtml(lead.bookTitle)}">
                <div class="br-card-aggregate-media"
                     ${needsIsbnBackfill ? `data-isbn="${escapeHtml(lead.isbn)}"` : ''}>
                    <span class="br-card-aggregate-stack" aria-hidden="true">
                        <span></span><span></span>
                    </span>
                    <img src="${escapeHtml(imgSrc)}"
                         alt="Cover of ${escapeHtml(lead.bookTitle)}"
                         loading="lazy" decoding="async"
                         onload="this.classList.add('loaded')"
                         onerror="${imageOnErrorAttr(raw, imgSrc)}">
                    <span class="br-card-genre">${escapeHtml(GENRE_LABEL[lead.genre] || 'STEM')}</span>
                </div>
                <div class="br-card-body">
                    <div class="br-card-kicker">
                        <span class="br-card-rating" aria-label="Average rating ${avg != null ? avg.toFixed(1) : 'unrated'} out of 5 from ${group.count} readers">
                            ${ratingDisplay}
                        </span>
                        <span class="br-card-pick" aria-label="${readersLabel}">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                                <circle cx="9" cy="7" r="4"/>
                                <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>
                            </svg>
                            ${readersLabel}
                        </span>
                    </div>
                    <h3 class="br-card-book">${escapeHtml(lead.bookTitle)}</h3>
                    ${lead.bookAuthor ? `<p class="br-card-author">by ${escapeHtml(lead.bookAuthor)}</p>` : ''}
                    <span class="br-aggregate-toggle" aria-hidden="true">
                        <span class="br-aggregate-toggle-label">
                            See all ${group.count} reviews
                        </span>
                        <svg class="br-aggregate-toggle-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                            <path d="M5 12h14M13 5l7 7-7 7"/>
                        </svg>
                    </span>
                </div>
            </div>
        `;
    }

    // ---------- Community feed (separate from the writer feed) ----------
    // Group reviews about the same book together. A "book key" is the
    // normalized (title + author) tuple. When N≥2 reviews share a key, we
    // render ONE aggregate card (avg rating, N reviewers) instead of N
    // duplicate cards. The aggregate card can be expanded to show each
    // individual reader review inline.
    function bookKeyOf(r) {
        const norm = (s) => String(s || '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, ' ')
            .trim();
        const t = norm(r.bookTitle || r.title);
        const a = norm(r.bookAuthor);
        return a ? `${t}::${a}` : t;
    }
    function groupCommunityByBook(reviews) {
        const map = new Map();
        for (const r of reviews) {
            const key = bookKeyOf(r);
            if (!key) continue;
            if (!map.has(key)) map.set(key, []);
            map.get(key).push(r);
        }
        // Sort each group: highest-rated first, then most recent. This gives
        // us a stable "lead review" to use as the aggregate card's surface.
        const groups = [];
        for (const [key, list] of map) {
            list.sort((a, b) => {
                const rb = (b.rating || 0) - (a.rating || 0);
                if (rb !== 0) return rb;
                return (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0);
            });
            const ratings = list.map((r) => r.rating).filter((x) => Number.isFinite(x) && x > 0);
            const avg = ratings.length
                ? Math.round((ratings.reduce((s, x) => s + x, 0) / ratings.length) * 10) / 10
                : null;
            groups.push({
                key,
                lead: list[0],
                reviews: list,
                count: list.length,
                avgRating: avg,
            });
        }
        // Overall ordering: most-reviewed first (genuine social signal), then
        // by the lead review's date so newly-added single picks stay near the
        // top of the feed.
        groups.sort((a, b) => {
            if (b.count !== a.count) return b.count - a.count;
            return (Date.parse(b.lead.date) || 0) - (Date.parse(a.lead.date) || 0);
        });
        return groups;
    }

    // Apply the current search query across the community pool. Searches
    // book title, book author, reviewer name (submitter), and deck so
    // readers can find a pick by any of those.
    function filterCommunity() {
        const q = communityQuery.trim().toLowerCase();
        const g = (communityGenre || 'all').toLowerCase();
        return communityReviews.filter((r) => {
            if (g !== 'all') {
                const reviewGenre = String(r.genre || '').toLowerCase();
                if (reviewGenre !== g) return false;
            }
            if (!q) return true;
            const hay = [
                r.title,
                r.bookTitle,
                r.bookAuthor,
                r.author,
                r.submitterName,
                r.deck,
                r.excerpt,
            ]
                .filter(Boolean)
                .map((s) => String(s).toLowerCase())
                .join(' • ');
            return hay.includes(q);
        });
    }

    function updateCommunityStats() {
        const total = communityReviews.length;
        if (communityCountEl) communityCountEl.textContent = total ? String(total) : '—';

        if (communityTopGenreEl) {
            if (!total) {
                communityTopGenreEl.textContent = '—';
            } else {
                const counts = new Map();
                communityReviews.forEach((r) => {
                    const g = (r.genre || '').toString();
                    if (!g) return;
                    counts.set(g, (counts.get(g) || 0) + 1);
                });
                let top = '';
                let topN = 0;
                counts.forEach((n, g) => {
                    if (n > topN) { topN = n; top = g; }
                });
                communityTopGenreEl.textContent = top
                    ? top.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
                    : '—';
            }
        }
    }

    function renderCommunityFeed() {
        if (!communityFeedEl) return;

        updateCommunityStats();

        const toolbarEl = document.querySelector('.br-community-toolbar');

        // Brand-new community pool empty — show the "be the first" empty state
        // and hide the search bar entirely (nothing to search yet).
        if (!communityReviews.length) {
            communityFeedEl.innerHTML = '';
            if (communityEmptyEl)   communityEmptyEl.hidden = false;
            if (communityNoMatchEl) communityNoMatchEl.hidden = true;
            if (communityStatusEl)  communityStatusEl.textContent = '';
            if (communityLoadMoreWrap) communityLoadMoreWrap.hidden = true;
            if (toolbarEl) toolbarEl.hidden = true;
            return;
        }

        if (toolbarEl) toolbarEl.hidden = false;
        if (communityEmptyEl) communityEmptyEl.hidden = true;

        const matches = filterCommunity();
        const hasQuery = communityQuery.trim().length > 0;
        const hasGenre = (communityGenre || 'all') !== 'all';
        const genreLabel = hasGenre
            ? communityGenre.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
            : '';
        // Friendly "filter pinned" suffix used in status messages.
        const filterTail = (() => {
            if (hasQuery && hasGenre) return ` in ${genreLabel} for "${communityQuery.trim()}"`;
            if (hasQuery)              return ` for "${communityQuery.trim()}"`;
            if (hasGenre)              return ` in ${genreLabel}`;
            return '';
        })();

        // No matches for the active query / filter — distinct empty state.
        if (!matches.length) {
            communityFeedEl.innerHTML = '';
            if (communityNoMatchEl) communityNoMatchEl.hidden = false;
            if (communityStatusEl)  communityStatusEl.textContent = `No reader picks${filterTail}.`;
            if (communityLoadMoreWrap) communityLoadMoreWrap.hidden = true;
            return;
        }
        if (communityNoMatchEl) communityNoMatchEl.hidden = true;

        // Group reviews by book so duplicates collapse into a single aggregate
        // card. Single-book groups still render through cardHtml() so the look
        // doesn't change for the common case. Pagination is keyed on groups,
        // not raw reviews, so the "Show more" count is meaningful.
        const groups = groupCommunityByBook(matches);
        if (communityShown > groups.length) communityShown = COMMUNITY_PAGE_SIZE;
        const slice = groups.slice(0, communityShown);

        communityFeedEl.innerHTML = slice
            .map((g, i) => g.count > 1
                ? aggregateCardHtml(g, variantFor(i))
                : cardHtml(g.lead, variantFor(i)))
            .join('');
        observeCards(communityFeedEl.querySelectorAll('.br-card:not(.in-view)'));
        backfillIsbnCovers(communityFeedEl);

        // Status line. After grouping, the visible unit is a book (group) not
        // a raw review, so we report "books" when groups < matches and
        // "picks" otherwise (single-review groups feel like reviews).
        if (communityStatusEl) {
            const filterActive = hasQuery || hasGenre;
            const hasGroups = groups.length !== matches.length;
            const groupWord = groups.length === 1 ? 'book' : 'books';
            const reviewWord = matches.length === 1 ? 'review' : 'reviews';

            if (filterActive) {
                if (groups.length <= slice.length) {
                    communityStatusEl.textContent = hasGroups
                        ? `${groups.length} ${groupWord} (${matches.length} ${reviewWord})${filterTail}`
                        : `${matches.length} ${reviewWord}${filterTail}`;
                } else {
                    communityStatusEl.textContent =
                        `Showing ${slice.length} of ${groups.length} ${groupWord}${filterTail}`;
                }
            } else if (groups.length > slice.length) {
                communityStatusEl.textContent =
                    `Showing ${slice.length} of ${groups.length} ${groupWord}`;
            } else {
                communityStatusEl.textContent = '';
            }
        }

        if (communityLoadMoreWrap) {
            communityLoadMoreWrap.hidden = groups.length <= slice.length;
        }
    }

    function bindCommunitySearch() {
        if (!communitySearchEl) return;

        let debounce;
        const apply = (val) => {
            communityQuery = val || '';
            communityShown = COMMUNITY_PAGE_SIZE;
            if (communitySearchClear) communitySearchClear.hidden = !communityQuery;
            renderCommunityFeed();
        };

        communitySearchEl.addEventListener('input', (e) => {
            clearTimeout(debounce);
            const val = e.target.value;
            debounce = setTimeout(() => apply(val), 120);
        });

        // Submitting the form (Enter key) shouldn't navigate — it's a live
        // filter, not a form submission.
        communitySearchEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                clearTimeout(debounce);
                apply(communitySearchEl.value);
            }
            if (e.key === 'Escape' && communitySearchEl.value) {
                communitySearchEl.value = '';
                apply('');
            }
        });

        if (communitySearchClear) {
            communitySearchClear.addEventListener('click', () => {
                communitySearchEl.value = '';
                apply('');
                communitySearchEl.focus();
            });
        }
    }

    function bindCommunityLoadMore() {
        if (!communityLoadMoreEl) return;
        communityLoadMoreEl.addEventListener('click', () => {
            communityShown += COMMUNITY_PAGE_SIZE;
            renderCommunityFeed();
        });
    }

    function bindCommunityGenreFilter() {
        if (!communityGenreEl) return;
        communityGenreEl.addEventListener('change', (e) => {
            communityGenre = (e.target.value || 'all').toLowerCase();
            communityShown = COMMUNITY_PAGE_SIZE;
            renderCommunityFeed();
        });
        enhanceShelfSelect(communityGenreEl);
    }

    // Delegated handler for aggregate cards. Clicking anywhere on the card
    // (cover, title, body, or the "See all N reviews" label) opens the
    // reviews modal. The card itself has role="button" + tabindex="0" so
    // keyboard users can also activate it with Enter/Space.
    function bindCommunityAggregateToggle() {
        if (!communityFeedEl) return;

        function openFromCard(e) {
            const card = e.target.closest('.br-card-aggregate');
            if (!card) return;
            e.preventDefault();
            const key = card.dataset.groupKey;
            if (!key) return;
            const group = findGroupByKey(key);
            if (!group) return;
            openReviewsModal(group, card);
        }

        communityFeedEl.addEventListener('click', openFromCard);
        communityFeedEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') openFromCard(e);
        });
    }

    // Re-derive a group from its key by re-running the same grouping the
    // feed used. Safer than caching the group on a DOM attribute because
    // the underlying review list can change (filter/search/load-more
    // re-renders) between the original card render and the modal open.
    function findGroupByKey(key) {
        const groups = groupCommunityByBook(communityReviews);
        return groups.find((g) => g.key === key) || null;
    }

    // ============================================================
    // REVIEWS MODAL — opens from an aggregate card.
    // Shows the book header (cover + title + average + count), a
    // toolbar (search by reviewer name + sort), and a scrollable list
    // of every individual reader review for the book. The list re-
    // renders on every search/sort change; the empty state surfaces
    // when no name matches the query.
    // ============================================================
    let reviewsModalState = null;

    function setupReviewsModal() {
        const modal = document.getElementById('br-reviews-modal');
        if (!modal) return;
        const closeBtn  = document.getElementById('br-reviews-modal-close');
        const searchEl  = document.getElementById('br-reviews-modal-search-input');
        const clearBtn  = document.getElementById('br-reviews-modal-search-clear');
        const sortEl    = document.getElementById('br-reviews-modal-sort-select');
        const bodyEl    = document.getElementById('br-reviews-modal-list');

        closeBtn?.addEventListener('click', closeReviewsModal);
        modal.addEventListener('click', (e) => {
            // Click on the backdrop (but NOT the modal content) dismisses.
            if (e.target === modal) closeReviewsModal();
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && modal.classList.contains('is-open')) {
                closeReviewsModal();
            }
        });

        if (searchEl) {
            searchEl.addEventListener('input', () => {
                if (!reviewsModalState) return;
                reviewsModalState.query = searchEl.value || '';
                if (clearBtn) clearBtn.hidden = !reviewsModalState.query;
                renderReviewsModalList();
            });
        }
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                if (!searchEl) return;
                searchEl.value = '';
                searchEl.dispatchEvent(new Event('input', { bubbles: true }));
                searchEl.focus();
            });
        }
        if (sortEl) {
            sortEl.addEventListener('change', () => {
                if (!reviewsModalState) return;
                reviewsModalState.sort = sortEl.value;
                renderReviewsModalList();
            });
        }
        // Stash the list element on the modal for renderReviewsModalList.
        modal._listEl = bodyEl;
        modal._emptyEl = document.getElementById('br-reviews-modal-empty');
    }

    function openReviewsModal(group, returnFocusEl) {
        const modal = document.getElementById('br-reviews-modal');
        if (!modal || !group) return;

        reviewsModalState = {
            group,
            query: '',
            sort: 'rating-desc',
            returnFocusEl: returnFocusEl || null,
        };

        // Populate the head — cover, eyebrow, title, author, average, count.
        const lead = group.lead;
        const imgEl     = document.getElementById('br-reviews-modal-img');
        const eyebrowEl = document.getElementById('br-reviews-modal-eyebrow');
        const titleEl   = document.getElementById('br-reviews-modal-title');
        const authorEl  = document.getElementById('br-reviews-modal-author');
        const avgEl     = document.getElementById('br-reviews-modal-avg');
        const readersEl = document.getElementById('br-reviews-modal-readers');
        const searchEl  = document.getElementById('br-reviews-modal-search-input');
        const sortEl    = document.getElementById('br-reviews-modal-sort-select');
        const clearBtn  = document.getElementById('br-reviews-modal-search-clear');

        if (imgEl) {
            imgEl.src = getCoverImageUrl(lead.image || FALLBACK_IMAGE, 240, 90);
            imgEl.alt = `Cover of ${lead.bookTitle}`;
        }
        if (eyebrowEl) eyebrowEl.textContent = 'From the Catalyzers';
        if (titleEl)   titleEl.textContent   = lead.bookTitle || 'Book reviews';
        if (authorEl)  authorEl.textContent  = lead.bookAuthor ? `by ${lead.bookAuthor}` : '';

        const avg = group.avgRating;
        if (avgEl) {
            avgEl.innerHTML = avg != null
                ? `${avg.toFixed(1)}<small>/5</small>`
                : `—<small>/5</small>`;
            avgEl.setAttribute('aria-label',
                avg != null ? `Average rating ${avg.toFixed(1)} out of 5` : 'Unrated');
        }
        if (readersEl) {
            readersEl.textContent = `${group.count} ${group.count === 1 ? 'reader' : 'readers'}`;
        }

        // Reset toolbar state.
        if (searchEl) searchEl.value = '';
        if (sortEl)   sortEl.value   = 'rating-desc';
        if (clearBtn) clearBtn.hidden = true;

        renderReviewsModalList();

        modal.setAttribute('aria-hidden', 'false');
        modal.classList.add('is-open');
        document.documentElement.style.overflow = 'hidden';
        // Defer focus to after the open transition so screen readers get
        // the labelled dialog before they jump to the search field.
        requestAnimationFrame(() => {
            searchEl?.focus({ preventScroll: true });
        });
    }

    function closeReviewsModal() {
        const modal = document.getElementById('br-reviews-modal');
        if (!modal) return;
        modal.classList.remove('is-open');
        modal.setAttribute('aria-hidden', 'true');
        document.documentElement.style.overflow = '';
        // Return focus to whatever opened the modal so keyboard users
        // pick up where they left off.
        const ret = reviewsModalState?.returnFocusEl;
        reviewsModalState = null;
        if (ret && typeof ret.focus === 'function') {
            ret.focus({ preventScroll: true });
        }
    }

    function renderReviewsModalList() {
        if (!reviewsModalState) return;
        const modal = document.getElementById('br-reviews-modal');
        if (!modal) return;
        const listEl  = modal._listEl;
        const emptyEl = modal._emptyEl;
        if (!listEl) return;

        const { group, query, sort } = reviewsModalState;
        const q = String(query || '').trim().toLowerCase();
        const filtered = group.reviews.filter((r) => {
            if (!q) return true;
            const hay = String(r.author || '').toLowerCase();
            return hay.includes(q);
        });

        const sorted = filtered.slice().sort((a, b) => {
            switch (sort) {
                case 'rating-asc':
                    return (numOrInf(a.rating)) - (numOrInf(b.rating));
                case 'date-desc':
                    return (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0);
                case 'date-asc':
                    return (Date.parse(a.date) || 0) - (Date.parse(b.date) || 0);
                case 'rating-desc':
                default:
                    return (numOrNegInf(b.rating)) - (numOrNegInf(a.rating));
            }
        });

        if (!sorted.length) {
            listEl.innerHTML = '';
            if (emptyEl) emptyEl.hidden = false;
            return;
        }
        if (emptyEl) emptyEl.hidden = true;

        listEl.innerHTML = sorted.map((r) => reviewModalItemHtml(r, q)).join('');
    }

    function numOrInf(v)    { return Number.isFinite(v) ? v :  Infinity; }
    function numOrNegInf(v) { return Number.isFinite(v) ? v : -Infinity; }

    function reviewModalItemHtml(r, query) {
        const hasRating = typeof r.rating === 'number';
        const rd = hasRating ? r.rating.toFixed(1) : '—';
        const dateStr = r.date ? formatDate(r.date) : '';
        const blurb = r.blurb || r.excerpt || '';
        const name = r.author || 'A Catalyzer';
        const nameHtml = query
            ? highlightMatch(name, query)
            : escapeHtml(name);
        // Use the Firestore document ID (r.id) when available so each
        // review gets a unique URL even when two reviews cover the same
        // book (they would otherwise share the same title-based slug).
        const reviewLink = r.id
            ? `/book-review/${encodeURIComponent(r.id)}`
            : r.link;
        return `
            <li class="br-reviews-modal-item">
                <div class="br-reviews-modal-item-head">
                    <span class="br-reviews-modal-item-rating ${hasRating ? '' : 'is-unrated'}" aria-label="${hasRating ? `Rated ${rd} out of 5` : 'Unrated'}">
                        <span class="br-reviews-modal-item-rating-num">${rd}</span><small>/5</small>
                    </span>
                    <div class="br-reviews-modal-item-byline">
                        <strong>${nameHtml}</strong>
                        ${dateStr ? `<span class="br-dot"></span><span>${escapeHtml(dateStr)}</span>` : ''}
                    </div>
                </div>
                ${blurb ? `<p class="br-reviews-modal-item-blurb">${escapeHtml(blurb)}</p>` : ''}
                <a class="br-reviews-modal-item-link" href="${escapeHtml(reviewLink)}">
                    Read full review
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path d="M5 12h14M13 5l7 7-7 7"/>
                    </svg>
                </a>
            </li>
        `;
    }

    // Highlight the first case-insensitive match of `query` within `text`.
    // Used to make the search hit visible in the reviewer name. Both
    // pieces are escaped individually so injection is impossible.
    function highlightMatch(text, query) {
        const safe = escapeHtml(text);
        if (!query) return safe;
        const idx = text.toLowerCase().indexOf(query.toLowerCase());
        if (idx < 0) return safe;
        const before = escapeHtml(text.slice(0, idx));
        const hit    = escapeHtml(text.slice(idx, idx + query.length));
        const after  = escapeHtml(text.slice(idx + query.length));
        return `${before}<mark>${hit}</mark>${after}`;
    }

    // ---------- Custom dropdown for the Shelf selects ----------
    // Wraps a native <select> with a styled menu so the dropdown panel
    // matches the rest of the page. The native <select> stays mounted
    // (kept in sync via .value) so form semantics + screen readers
    // still work, and we re-emit a 'change' event on it whenever the
    // user picks an option from the custom menu.
    function enhanceShelfSelect(selectEl) {
        if (!selectEl || selectEl.dataset.enhanced === 'true') return;
        const wrapper = selectEl.closest('.br-community-filter');
        if (!wrapper) return;

        wrapper.dataset.enhanced = 'true';
        selectEl.setAttribute('tabindex', '-1');

        // Build the custom menu from the <option>s currently in the DOM.
        const menu = document.createElement('div');
        menu.className = 'br-shelf-menu';
        menu.setAttribute('role', 'listbox');
        menu.setAttribute('aria-label', selectEl.getAttribute('aria-label') || 'Choose a shelf');
        menu.hidden = true;

        const checkSvg = `<svg class="br-shelf-option-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>`;

        const options = Array.from(selectEl.options);
        const buttons = options.map((opt) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'br-shelf-option';
            btn.setAttribute('role', 'option');
            btn.dataset.value = opt.value;
            btn.innerHTML = `<span>${opt.textContent}</span>${checkSvg}`;
            btn.addEventListener('click', () => {
                selectEl.value = opt.value;
                selectEl.dispatchEvent(new Event('change', { bubbles: true }));
                refreshSelected();
                close();
                // Move focus back to the trigger so keyboard users keep flow.
                triggerArea.focus();
            });
            return btn;
        });
        buttons.forEach((b) => menu.appendChild(b));
        wrapper.appendChild(menu);

        // The clickable trigger zone — entire wrapper minus the menu.
        // We use a focusable element so keyboard users can open it with
        // Enter/Space. The wrapper itself is a <label>, but we don't
        // want clicking the label to bubble into native-select-open,
        // so we attach a separate button-like span that intercepts.
        const triggerArea = document.createElement('span');
        triggerArea.className = 'br-community-filter-trigger';
        triggerArea.setAttribute('role', 'combobox');
        triggerArea.setAttribute('aria-haspopup', 'listbox');
        triggerArea.setAttribute('aria-expanded', 'false');
        triggerArea.setAttribute('tabindex', '0');
        triggerArea.style.cssText =
            'position:absolute;inset:0;border-radius:inherit;outline:none;cursor:pointer;';
        wrapper.appendChild(triggerArea);

        function refreshSelected() {
            buttons.forEach((b) => {
                b.setAttribute('aria-selected', b.dataset.value === selectEl.value ? 'true' : 'false');
            });
        }
        function open() {
            menu.hidden = false;
            requestAnimationFrame(() => {
                menu.dataset.open = 'true';
                wrapper.dataset.open = 'true';
                triggerArea.setAttribute('aria-expanded', 'true');
            });
            document.addEventListener('mousedown', onDocDown, true);
            document.addEventListener('keydown', onKeyDown);
            // Focus the currently-selected option so keyboard arrows work.
            const active = buttons.find((b) => b.dataset.value === selectEl.value) || buttons[0];
            active?.focus();
        }
        function close() {
            menu.dataset.open = 'false';
            wrapper.dataset.open = 'false';
            triggerArea.setAttribute('aria-expanded', 'false');
            // Match the transition duration before hiding so animation plays.
            setTimeout(() => { if (menu.dataset.open !== 'true') menu.hidden = true; }, 200);
            document.removeEventListener('mousedown', onDocDown, true);
            document.removeEventListener('keydown', onKeyDown);
        }
        function toggle() {
            if (menu.dataset.open === 'true') close();
            else open();
        }
        function onDocDown(e) {
            if (!wrapper.contains(e.target)) close();
        }
        function onKeyDown(e) {
            if (e.key === 'Escape') { e.preventDefault(); close(); triggerArea.focus(); return; }
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                const i = buttons.indexOf(document.activeElement);
                const next = (i + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
                buttons[next]?.focus();
            }
        }

        triggerArea.addEventListener('click', toggle);
        triggerArea.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
                e.preventDefault();
                open();
            }
        });

        // Initialize selected state, and keep buttons in sync if the
        // native select is mutated elsewhere (e.g., setGenre()).
        refreshSelected();
        selectEl.addEventListener('change', refreshSelected);
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
        // Plain cards carry data-isbn on the outer .br-card anchor; aggregate
        // cards (multi-review books) carry it on the inner media div.
        // Pick up both shapes so aggregate covers also get the upgrade.
        const targets = scope.querySelectorAll(
            '.br-card[data-isbn]:not([data-isbn-tried]), .br-card-aggregate-media[data-isbn]:not([data-isbn-tried])'
        );
        targets.forEach(card => {
            card.setAttribute('data-isbn-tried', '1');
            const isbn = card.getAttribute('data-isbn');
            if (!isbn) return;
            const img = card.querySelector('img');

            // Stage 1: Open Library (fast). Use a fresh probe Image PER
            // card — a previously-shared global would let later iterations
            // clobber earlier ones' onload handlers, so only the last card
            // in the loop ever got its cover backfilled.
            const olUrl = `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false`;
            const probe = new Image();
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
        // flicker between the smaller and larger versions. Require a real
        // cover-sized image (Google's "no preview" placeholder is ≈128×177
        // and is served with a 200 OK, so a >1px check isn't enough).
        const pre = new Image();
        pre.onload = () => {
            if (pre.naturalWidth >= 200 && pre.naturalHeight >= 200) {
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
        let pointerX = 0;
        let pointerY = 0;
        let spread = 0;

        const update = () => {
            const rect = hero.getBoundingClientRect();
            // viewport height is the "exit window": progress reaches 1 as
            // the hero bottom passes the top of the viewport.
            const vh = window.innerHeight || document.documentElement.clientHeight;
            // raw goes from 0 (hero at top of viewport) → 1 (hero fully scrolled past)
            const traveled = Math.min(Math.max(-rect.top / Math.max(rect.height - vh * 0.3, 1), 0), 1);
            // Ease with a smoothstep so the books accelerate gracefully
            const eased = traveled * traveled * (3 - 2 * traveled);
            spread = eased;
            const glow = Math.min(1, eased * 1.18);
            const orbit = 16 + eased * 132 + pointerX * 10;
            const tiltX = (-2.5 + eased * 5.5 + pointerY * -3.5);
            const tiltY = (3.5 - eased * 7 + pointerX * 4.5);
            const scanX = -70 + eased * 140;
            stack.style.setProperty('--br-spread', spread.toFixed(3));
            stack.style.setProperty('--br-glow', glow.toFixed(3));
            stack.style.setProperty('--br-orbit', `${orbit.toFixed(2)}deg`);
            stack.style.setProperty('--br-orbit-reverse', `${(orbit * -1).toFixed(2)}deg`);
            stack.style.setProperty('--br-tilt-x', `${tiltX.toFixed(2)}deg`);
            stack.style.setProperty('--br-tilt-y', `${tiltY.toFixed(2)}deg`);
            stack.style.setProperty('--br-scan-x', `${scanX.toFixed(2)}%`);
            stack.dataset.spread = eased > 0.7 ? '1' : '0';
            ticking = false;
        };
        const requestUpdate = () => {
            if (ticking) return;
            ticking = true;
            requestAnimationFrame(update);
        };
        const onPointerMove = event => {
            const rect = stack.getBoundingClientRect();
            if (!rect.width || !rect.height) return;
            pointerX = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
            pointerY = ((event.clientY - rect.top) / rect.height - 0.5) * 2;
            pointerX = Math.min(Math.max(pointerX, -1), 1);
            pointerY = Math.min(Math.max(pointerY, -1), 1);
            requestUpdate();
        };
        const onPointerLeave = () => {
            pointerX = 0;
            pointerY = 0;
            requestUpdate();
        };
        window.addEventListener('scroll', requestUpdate, { passive: true });
        window.addEventListener('resize', requestUpdate, { passive: true });
        stack.addEventListener('pointermove', onPointerMove, { passive: true });
        stack.addEventListener('pointerleave', onPointerLeave, { passive: true });
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

    function setGenre(g) {
        currentGenre = (g || 'all').toLowerCase();
        if (railGenreEl && railGenreEl.value !== currentGenre) {
            railGenreEl.value = currentGenre;
        }
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
        if (railGenreEl) {
            railGenreEl.addEventListener('change', (e) => {
                setGenre(e.target.value || 'all');
            });
            enhanceShelfSelect(railGenreEl);
        }

        if (searchInput) {
            let t = null;
            const apply = (val) => {
                currentQuery = val || '';
                if (searchClear) searchClear.hidden = !currentQuery;
                renderFeed(true);
            };
            searchInput.addEventListener('input', e => {
                clearTimeout(t);
                t = setTimeout(() => apply(e.target.value), 120);
            });
            searchInput.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && searchInput.value) {
                    searchInput.value = '';
                    apply('');
                }
            });
            searchClear?.addEventListener('click', () => {
                searchInput.value = '';
                apply('');
                searchInput.focus();
            });
        }
        loadMoreBtn?.addEventListener('click', () => renderFeed(false));

        bindCommunitySearch();
        bindCommunityLoadMore();
        bindCommunityGenreFilter();
        bindCommunityAggregateToggle();
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
    // RATING SLIDER — continuous 0.0–5.0 input
    // Wires .br-rating-slider so dragging the range input updates:
    //   • the star bar (filled by width %)
    //   • the numeric readout ("4.2 / 5")
    //   • the flavor label ("Strongly recommend", etc.)
    //   • the hidden form input the submit handler reads
    // RATING_FLAVORS is the original dropdown copy, kept verbatim.
    // =============================================================
    const RATING_FLAVORS = [
        { min: 4.7, label: "Couldn't put it down" },
        { min: 4.0, label: 'Strongly recommend' },
        { min: 3.5, label: 'Very good' },
        { min: 2.8, label: 'Solid' },
        { min: 2.0, label: 'Mixed' },
        { min: 1.0, label: 'Disappointing' },
        { min: 0.1, label: 'Skip it' },
    ];
    function flavorForRating(n) {
        if (!Number.isFinite(n) || n <= 0) return '';
        for (const f of RATING_FLAVORS) {
            if (n >= f.min) return f.label;
        }
        return '';
    }
    function wireRatingSlider({ root, hiddenInputId } = {}) {
        if (!root) return;
        const input = root.querySelector('.br-rating-slider-input');
        const fill = root.querySelector('.br-rating-slider-stars-fill');
        const value = root.querySelector('.br-rating-slider-value');
        // Flavor label now lives in the hint slot OUTSIDE the slider root
        // (so it sits below the pill, where text-input hints render).
        // Try root first for backwards compat, then look at the sibling.
        const flavor = root.querySelector('.br-rating-slider-flavor')
            || document.getElementById('br-rating-flavor');
        const hidden = hiddenInputId ? document.getElementById(hiddenInputId) : null;
        if (!input) return;

        const sync = () => {
            const raw = parseFloat(input.value);
            const n = Number.isFinite(raw) ? Math.round(raw * 10) / 10 : 0;
            const pct = Math.max(0, Math.min(100, (n / 5) * 100));
            // --br-pct drives:
            //   • the slider track's progress gradient (in CSS)
            //   • the stars-fill clip-path (CSS reads var(--br-pct))
            // so we only need to set it once on the root.
            root.style.setProperty('--br-pct', String(pct));
            root.dataset.value = n > 0 ? String(n) : '0';
            if (value) {
                if (n > 0) {
                    value.innerHTML = `${n.toFixed(1)}<small>/ 5</small>`;
                } else {
                    value.textContent = '— Optional —';
                }
            }
            if (flavor) {
                const f = flavorForRating(n);
                flavor.textContent = f || 'Drag to set a rating from 0 to 5. Optional.';
            }
            if (hidden) hidden.value = n > 0 ? n.toFixed(1) : '';
        };

        // Browsers fire `input` while dragging and `change` on release. The
        // first one drives the live readout; the second one is a safety net.
        input.addEventListener('input', sync);
        input.addEventListener('change', sync);

        // Reset hook — called by the modal after the form resets so the
        // slider doesn't carry a previous submission's value.
        root.__resetRatingSlider = () => {
            input.value = '0';
            sync();
        };

        sync();
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

        // Hook up the rating slider on first modal init.
        const ratingSliderEl = document.getElementById('br-rating-slider');
        if (ratingSliderEl) {
            wireRatingSlider({ root: ratingSliderEl, hiddenInputId: 'br-rating' });
        }

        let lastFocused = null;
        let turnstileWidgetId = null;
        const turnstileSlot = document.getElementById('br-turnstile-slot');
        const focusableSelector = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled])';

        // Render (or reset) the Turnstile widget. Safe to call multiple times.
        // No-ops if no site key is configured or the Turnstile script hasn't
        // finished loading yet — book-reviews-submit retries it on every
        // modal open.
        function ensureTurnstile() {
            const key = (typeof window !== 'undefined' && window.TURNSTILE_SITE_KEY) || '';
            if (!key || !turnstileSlot || !window.turnstile) return;
            if (turnstileWidgetId !== null) {
                try { window.turnstile.reset(turnstileWidgetId); } catch {}
                return;
            }
            turnstileSlot.innerHTML = '';
            try {
                turnstileWidgetId = window.turnstile.render(turnstileSlot, {
                    sitekey: key,
                    theme: 'auto',
                    action: 'book-review-submit',
                });
            } catch (err) {
                console.warn('[book-reviews] Turnstile render failed:', err);
            }
        }

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
            // Turnstile is NOT rendered at modal-open. The widget's iframe
            // and verification routine briefly fight the form for focus +
            // event-loop time on some connections, which made the modal
            // feel "frozen" — users reported not being able to type or
            // move the rating slider during widget load. We render it
            // only when the user actually presses Submit; until then the
            // form is fully usable with zero network activity.
        }

        function closeModal() {
            // Move focus OUT of the modal *before* hiding it from assistive
            // tech. Otherwise the browser logs "Blocked aria-hidden on an
            // element because its descendant retained focus."
            const active = document.activeElement;
            if (active && modalEl.contains(active) && typeof active.blur === 'function') {
                active.blur();
            }
            modalEl.classList.remove('is-open');
            modalEl.setAttribute('aria-hidden', 'true');
            document.body.style.overflow = '';
            if (lastFocused && typeof lastFocused.focus === 'function') {
                lastFocused.focus();
            }
        }

        // Lazily render Turnstile, then wait for a token. Returns the token
        // string, or '' if the user cancels or it times out. Called at
        // submit time so the widget never runs during the user's typing.
        async function waitForTurnstileToken(maxWaitMs = 30000) {
            if (!window.TURNSTILE_SITE_KEY) return '';
            // Maybe we already have a token sitting in the form from a
            // previous render (e.g. an earlier failed submit).
            const existing = String(new FormData(modalForm).get('cf-turnstile-response') || '').trim();
            if (existing) return existing;

            // Render the widget if we haven't yet. The Turnstile script tag
            // was deferred at page load, so window.turnstile is almost
            // always ready by now. If it's STILL loading on a slow
            // connection, poll a few times before giving up.
            const renderWhenReady = () => new Promise((resolve) => {
                let tries = 0;
                const tick = () => {
                    if (window.turnstile) { ensureTurnstile(); resolve(true); return; }
                    if (++tries > 40) { resolve(false); return; } // ~8 s
                    setTimeout(tick, 200);
                };
                tick();
            });
            const ready = await renderWhenReady();
            if (!ready) return '';

            // Poll for the token. Turnstile inserts a hidden
            // <input name="cf-turnstile-response"> when the challenge
            // resolves. On invisible/managed mode this usually completes
            // in well under a second.
            return new Promise((resolve) => {
                const started = Date.now();
                const poll = () => {
                    const t = String(new FormData(modalForm).get('cf-turnstile-response') || '').trim();
                    if (t) return resolve(t);
                    if (Date.now() - started > maxWaitMs) return resolve('');
                    setTimeout(poll, 200);
                };
                poll();
            });
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
                turnstileToken: '',  // filled in after waitForTurnstileToken()
                // Honeypot. Real users send this empty; bots will fill it.
                website:        String(data.get('website')        || '').trim(),
            };

            // Validate content first — fail fast on missing fields BEFORE
            // we kick off the Turnstile dance, so the user isn't told
            // "verifying…" when their form was incomplete anyway.
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

            // NOW render Turnstile and wait for a token. This is the
            // FIRST moment the widget appears on the page, so the user
            // never had any chance for it to interfere with their typing.
            if (window.TURNSTILE_SITE_KEY) {
                payload.turnstileToken = await waitForTurnstileToken();
                if (!payload.turnstileToken) {
                    modalError.textContent = 'Please complete the human-verification check that just appeared, then press Send again.';
                    modalError.hidden = false;
                    modalError.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                    modalSubmitBtn.disabled = false;
                    if (idle) idle.hidden = false;
                    if (busy) busy.hidden = true;
                    return;
                }
            }

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
                // <input type="range"> doesn't always honor form.reset() (and
                // the linked stars/readout would lag the underlying value), so
                // explicitly reset the slider helper too.
                const ratingSliderReset = document.getElementById('br-rating-slider');
                if (ratingSliderReset && ratingSliderReset.__resetRatingSlider) {
                    ratingSliderReset.__resetRatingSlider();
                }
                modalForm.hidden = true;
                modalSuccess.hidden = false;
                modalSuccess.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            } catch (err) {
                modalError.textContent = err.message || 'Something went wrong. Please try again.';
                modalError.hidden = false;
                // Reset Turnstile so the user can retry — each token is
                // single-use and the server has already consumed it.
                ensureTurnstile();
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
        setupReviewsModal();

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
