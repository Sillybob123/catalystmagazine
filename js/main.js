// ============================================
// THE CATALYST MAGAZINE - MAIN JAVASCRIPT
// ============================================

// Diagnostic marker: confirms main.js parsed and executed at all. If this line
// doesn't appear in the console, the script never ran (HTML parse issue,
// CSP block, MIME mismatch, etc.). Temporary — added 2026-05-22 to chase
// the "articles don't render" bug.
console.log('[catalyst] main.js loaded @', new Date().toISOString(), 'pathname=', window.location.pathname);
window.__catalystMainLoaded = true;

document.addEventListener('DOMContentLoaded', () => {
    console.log('[catalyst] DOMContentLoaded fired. loadArticles=', typeof loadArticles, 'initApp=', typeof initApp, 'layoutReady=', !!window.layoutReady);
    // Don't block the Firestore fetch on the header/footer fragment requests.
    // They're independent; kicking off loadArticles() in parallel means the
    // hero can render as soon as the data resolves.
    if (typeof loadArticles === 'function' && !window.__articlesPromise) {
        try {
            window.__articlesPromise = loadArticles();
        } catch (err) {
            console.warn('[Articles] early load failed', err);
        }
    }

    const layoutPromise = window.layoutReady && typeof window.layoutReady.then === 'function'
        ? window.layoutReady.catch(error => console.error('[Layout] Load issue', error))
        : Promise.resolve();

    layoutPromise.finally(() => {
        console.log('[catalyst] layoutPromise settled, calling initApp()');
        try {
            initApp();
        } catch (err) {
            console.error('[catalyst] initApp threw synchronously:', err);
        }
    });
});

const ARTICLE_FALLBACK_IMAGE = '/NewsletterHeader1.png';
const CARD_IMAGE_WIDTH = 800;
const CARD_IMAGE_WIDTH_2X = 1400;
const HERO_IMAGE_WIDTH = 1000;
const CARD_IMAGE_QUALITY = 82;
const CARD_IMAGE_QUALITY_2X = 72;
const HERO_IMAGE_QUALITY = 62;
let articleData = [];
let fadeObserver = null;

// ============================================
// IMAGE LOADING
// Simple, fast: shimmer placeholder → image fades in on load.
// No JS decode() chains. No detached loaders. Just <img> + CSS.
// ============================================

// Rewrite image URLs to a size/quality/format appropriate for display.
// - Local assets are served as-is (already sized correctly).
// - Wix URLs use Wix's own transformer (free, built-in).
// - Everything else (Firebase Storage, Wikipedia, etc.) is proxied through
//   wsrv.nl — a free open-source image CDN that resizes, converts to WebP,
//   and edge-caches. No account or API key needed.
function getResizedImageUrl(src, width, quality) {
    if (!src || src === ARTICLE_FALLBACK_IMAGE || src.startsWith('data:') || src.startsWith('blob:')) return src;
    try {
        const isAbsolute = /^https?:\/\//i.test(src);
        if (!isAbsolute) return src; // local asset, already sized

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

        // wsrv.nl: free image proxy/resizer, outputs WebP to supported browsers.
        // URLSearchParams will percent-encode the src, so any already-encoded
        // sequence in it (e.g. Wikipedia's %28/%29) becomes double-encoded and
        // 404s. Decode the src first — but preserve %2F, which Firebase Storage
        // requires stay encoded to distinguish path segments.
        const SENTINEL = 'ENCSLASH';
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
            we: '',      // without-enlargement: never upscale
        });
        return `https://wsrv.nl/?${params}`;
    } catch { return src; }
}

function getCardImageUrl(src)  { return getResizedImageUrl(src, CARD_IMAGE_WIDTH, CARD_IMAGE_QUALITY); }
function getCardImageUrl2x(src) { return getResizedImageUrl(src, CARD_IMAGE_WIDTH_2X, CARD_IMAGE_QUALITY_2X); }
function getHeroImageUrl(src)  { return getResizedImageUrl(src, HERO_IMAGE_WIDTH, HERO_IMAGE_QUALITY); }

// Renders an <img> with a shimmer background while loading, then fades in.
// The shimmer is pure CSS — no network, shows instantly.
function createProgressiveImage(src, alt, className = '', eager = false, imageSettings = null, overlayHtml = '') {
    const imageSrc = src || ARTICLE_FALLBACK_IMAGE;
    const displaySrc = eager ? getHeroImageUrl(imageSrc) : getCardImageUrl(imageSrc);
    // For non-eager card images, offer a 2x source so retina screens get a
    // sharper render. Browsers download only ONE source based on DPR, so 1x
    // devices keep loading the small file — no perf regression.
    const displaySrc2x = eager ? null : getCardImageUrl2x(imageSrc);
    const srcsetAttr = displaySrc2x && displaySrc2x !== displaySrc
        ? `srcset="${displaySrc} 1x, ${displaySrc2x} 2x"`
        : '';
    const customStyles = getImageStyles(imageSettings);
    const fetchPriority = eager ? 'fetchpriority="high"' : '';
    const loadingAttr = eager ? 'eager' : 'lazy';

    // Check manifest for an inline base64 LQIP (zero-network blurred preview).
    const inlineLqip = window.__LQIP_MANIFEST && window.__LQIP_MANIFEST[imageSrc];
    const bgStyle = inlineLqip
        ? `background-image: url('${inlineLqip}'); background-size: cover; background-position: center;`
        : '';

    const imgWidth = eager ? HERO_IMAGE_WIDTH : CARD_IMAGE_WIDTH;
    const imgHeight = Math.round(imgWidth * 0.66);

    // If the resized URL fails (e.g. wsrv.nl's 71MP pixel-limit for huge
    // Firebase Storage originals), fall back to the original URL before the
    // generic placeholder. Encode both for safe embedding in the attribute.
    const originalEncoded = imageSrc.replace(/'/g, '&apos;');
    const fallbackEncoded = ARTICLE_FALLBACK_IMAGE.replace(/'/g, '&apos;');
    const onErrorAttr = displaySrc === imageSrc
        ? `this.onerror=null; this.src='${fallbackEncoded}'; this.classList.add('loaded');`
        : `this.onerror=function(){this.onerror=null; this.src='${fallbackEncoded}'; this.classList.add('loaded');}; this.src='${originalEncoded}';`;

    return `<div class="card-img-wrap ${className}" style="${bgStyle}">
        <img
            src="${displaySrc}"
            ${srcsetAttr}
            alt="${alt}"
            class="card-img"
            style="${customStyles}"
            width="${imgWidth}"
            height="${imgHeight}"
            loading="${loadingAttr}"
            decoding="async"
            ${fetchPriority}
            onload="this.classList.add('loaded')"
            onerror="${onErrorAttr}">
        ${overlayHtml || ''}
    </div>`;
}

// Pick an image width bucket based on the element's rendered pixel width,
// accounting for devicePixelRatio so retina screens stay sharp.
function bgImageUrl(el, raw) {
    const px = (el.offsetWidth || 640) * Math.min(window.devicePixelRatio || 1, 2);
    // Round up to the nearest bucket so wsrv.nl cache stays warm.
    const w = px <= 500 ? 640 : px <= 900 ? 1000 : 1600;
    return getResizedImageUrl(raw, w, 72);
}

function applyBgImage(el) {
    const raw = el.dataset.bgImage;
    if (!raw) return;
    const proxied = bgImageUrl(el, raw);
    const applyUrl = (url) => {
        el.style.backgroundImage = `url('${url}')`;
        if (el.dataset.bgPosition) el.style.backgroundPosition = el.dataset.bgPosition;
        if (el.dataset.bgZoom) el.style.backgroundSize = `${parseFloat(el.dataset.bgZoom) * 100}%`;
        el.classList.add('bg-loaded');
    };
    // Optimistically apply the proxied URL, and verify it loads. If the
    // proxy rejects the image (wsrv.nl has a 71MP pixel-limit for huge
    // Firebase originals), fall back to the original URL so the card
    // never shows an empty gray slot.
    if (proxied === raw) {
        applyUrl(raw);
        return;
    }
    applyUrl(proxied);
    const probe = new Image();
    probe.onerror = () => applyUrl(raw);
    probe.src = proxied;
}

function initImageOptimization() {
    // Observe lazy-background cards (featured stories section)
    const bgObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (!entry.isIntersecting) return;
            applyBgImage(entry.target);
            bgObserver.unobserve(entry.target);
        });
    }, { rootMargin: '400px 0px', threshold: 0.01 });

    document.querySelectorAll('[data-bg-image]').forEach(el => bgObserver.observe(el));
}

// Generate a pleasant placeholder color based on image URL
function getPlaceholderColor(src) {
    if (!src) return 'linear-gradient(135deg, #e5e7eb 0%, #f3f4f6 100%)';

    // Simple hash function to get consistent colors per image
    let hash = 0;
    for (let i = 0; i < src.length; i++) {
        hash = ((hash << 5) - hash) + src.charCodeAt(i);
        hash = hash & hash;
    }

    // Generate subtle, pleasant gradient colors
    const hue = Math.abs(hash % 360);
    const saturation = 8 + (Math.abs(hash >> 8) % 12); // 8-20% saturation for subtle look
    const lightness = 88 + (Math.abs(hash >> 16) % 8); // 88-96% lightness

    return `linear-gradient(135deg,
        hsl(${hue}, ${saturation}%, ${lightness}%) 0%,
        hsl(${(hue + 30) % 360}, ${saturation - 3}%, ${lightness + 2}%) 100%)`;
}


// Generate inline styles for image customization
// Settings: { position, zoom, offsetX, offsetY }
function getImageStyles(settings) {
    if (!settings) return '';

    const styles = [];

    // Object position (e.g., "center top", "50% 30%")
    if (settings.position) {
        styles.push(`object-position: ${settings.position}`);
    }

    // Build transform for zoom and offset
    const transforms = [];
    if (settings.zoom && settings.zoom !== 1) {
        transforms.push(`scale(${settings.zoom})`);
    }
    if (settings.offsetX || settings.offsetY) {
        const x = settings.offsetX || 0;
        const y = settings.offsetY || 0;
        transforms.push(`translate(${x}px, ${y}px)`);
    }

    if (transforms.length > 0) {
        styles.push(`transform: ${transforms.join(' ')}`);
    }

    return styles.length > 0 ? styles.join('; ') + ';' : '';
}

function registerLazyBackgrounds(scope = document) {
    scope.querySelectorAll('[data-bg-image]').forEach(el => {
        if (!el.classList.contains('bg-loaded')) {
            applyBgImage(el);
        }
    });
}

function registerProgressiveImages() { /* no-op: new system uses native onload */ }
function preloadImage() { /* no-op: removed hardcoded preloads */ }

// ============================================
// COLLABORATION MAILTO HANDLERS
// ============================================
function setupCollaborationMailto() {
    // Clear any legacy EmailJS rate-limit data so mailto flow never errors
    try {
        localStorage.removeItem('catalyst_form_submissions');
    } catch (err) {}

    const proposalForm = document.getElementById('proposal-form');
    if (proposalForm) {
        proposalForm.addEventListener('submit', (e) => {
            e.preventDefault();

            const formInputs = proposalForm.querySelectorAll('input:not([type="file"]), select, textarea');
            const firstName = formInputs[0]?.value.trim() || '';
            const lastName = formInputs[1]?.value.trim() || '';
            const email = formInputs[2]?.value.trim() || '';
            const proposalType = formInputs[3]?.value || '';
            const title = formInputs[4]?.value.trim() || '';
            const description = formInputs[5]?.value.trim() || '';
            const link = formInputs[6]?.value.trim() || '';

            const subject = `Article Proposal: ${title || 'Your Proposal'}`;
            const body = `Hi Catalyst Team,

I would like to submit an article proposal.

Name: ${firstName} ${lastName}
Email: ${email}
Proposal Type: ${proposalType}
Project Title: ${title}

Description:
${description}

${link ? `Link to Draft/Materials: ${link}` : ''}

IMPORTANT: Please attach your article or materials (PDF, DOC, JPG, MP3, or MP4) to this email.

Best regards,
${firstName} ${lastName}`.trim();

            const mailtoLink = `mailto:stemcatalystmagazine@gmail.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
            window.location.href = mailtoLink;
            showNotification('Opening your email client. Please attach your materials and send the email.');
        });
    }

    const teamForm = document.getElementById('team-form');
    if (teamForm) {
        teamForm.addEventListener('submit', (e) => {
            e.preventDefault();

            const formInputs = teamForm.querySelectorAll('input:not([type="file"]), select');
            const firstName = formInputs[0]?.value.trim() || '';
            const lastName = formInputs[1]?.value.trim() || '';
            const email = formInputs[2]?.value.trim() || '';
            const phone = formInputs[3]?.value.trim() || '';
            const position = formInputs[4]?.value || '';
            const portfolioLink = formInputs[5]?.value.trim() || '';

            const subject = `Team Application: ${position || 'Role'} - ${firstName} ${lastName}`.trim();
            const body = `Hi Catalyst Team,

I would like to apply to join your team.

Name: ${firstName} ${lastName}
Email: ${email}
Phone: ${phone || 'Not provided'}
Position Applied For: ${position}
${portfolioLink ? `Portfolio: ${portfolioLink}` : ''}

IMPORTANT: Please attach your CV/Resume (PDF, DOC, or DOCX) to this email.

Best regards,
${firstName} ${lastName}`.trim();

            const mailtoLink = `mailto:stemcatalystmagazine@gmail.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
            window.location.href = mailtoLink;
            showNotification('Opening your email client. Please attach your CV/Resume and send the email.');
        });
    }
}
const deepClone = (val) => {
    if (typeof structuredClone === 'function') return structuredClone(val);
    return JSON.parse(JSON.stringify(val));
};

async function initApp() {
    console.log('[catalyst] initApp() entered');
    try {
    setupNavigation();
    // setupNewsletterModal is now called by layout.js after header injection,
    // so skip it here to avoid double-binding.
    // setupNewsletterModal();
    setupScrollEffects();
    setupScrollToTop();
    setupCollaborationMailto();
    initImageOptimization();

    // Page-specific initialization
    const page = document.body.dataset.page || detectPage();
    console.log('[catalyst] initApp page=', page, 'body.dataset.page=', document.body.dataset.page);
    recordGeoVisit(page);

    // Render instant skeletons so containers are visible immediately
    renderInitialSkeletons(page);

    if (page === 'home' || page === 'articles' || page === 'article') {
        console.log('[catalyst] awaiting articles (cached promise:', !!window.__articlesPromise, ')');
        // Reuse the load kicked off at DOMContentLoaded so Firestore runs in
        // parallel with the header/footer fetch instead of serially after it.
        const allArticles = await (window.__articlesPromise || loadArticles());
        console.log('[catalyst] articles loaded:', allArticles.length, 'first title:', allArticles[0]?.title);
        // Book reviews route to /book-reviews. Hide them from home + articles
        // feeds, but keep them in the full set so /article/<slug> still resolves
        // when a reader follows a direct link to a book review.
        window.__articleCacheAll = allArticles;
        articleData = (page === 'article')
            ? allArticles
            : allArticles.filter(a => !isBookReview(a));
        // Preload first 3 article images for instant hero display
        if (articleData.length > 0) {
            articleData.slice(0, 3).forEach(article => preloadImage(article.image));
        }
    }

    if (page === 'home') {
        initHomePage(articleData);
    } else if (page === 'articles') {
        initArticlesPage(articleData);
    } else if (page === 'article') {
        console.log('[catalyst] calling initArticleDetailPage with', articleData.length, 'articles');
        initArticleDetailPage(articleData);
    } else if (page === 'about') {
        initAboutPage();
    }
    } catch (err) {
        console.error('[catalyst] initApp threw:', err, err?.stack);
    }
}

function detectPage() {
    const path = window.location.pathname;
    if (path.includes('articles')) return 'articles';
    if (path.includes('article')) return 'article';
    if (path.includes('collaborate')) return 'collaborate';
    if (path.includes('about')) return 'about';
    return 'home';
}

function recordGeoVisit(page) {
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1' || host === '') return;
    if (window.location.pathname.startsWith('/admin') || window.location.pathname.startsWith('/scheduler')) return;

    // Dedupe rapid revisits to the SAME path within 60s — back/forward
    // mashing or a stuck refresh shouldn't inflate view counts. The
    // server has no way to know it's the same person (we deliberately
    // store no visitor identity), so this guard lives client-side only.
    // sessionStorage scopes to one tab; that's the right granularity.
    try {
        const key = '__catalyst_lastVisit';
        const now = Date.now();
        const raw = sessionStorage.getItem(key);
        if (raw) {
            const last = JSON.parse(raw);
            if (last && last.path === window.location.pathname && (now - Number(last.t)) < 60000) {
                return;
            }
        }
        sessionStorage.setItem(key, JSON.stringify({ path: window.location.pathname, t: now }));
    } catch {}

    const payload = JSON.stringify({
        path: window.location.pathname,
        page,
        title: document.title,
        referrer: document.referrer ? new URL(document.referrer, window.location.href).hostname : '',
    });

    try {
        if (navigator.sendBeacon) {
            const blob = new Blob([payload], { type: 'application/json' });
            if (navigator.sendBeacon('/api/analytics/visit', blob)) return;
        }
    } catch {}

    try {
        fetch('/api/analytics/visit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: payload,
            keepalive: true,
        }).catch(() => {});
    } catch {}
}

// ============================================
// INSTANT SKELETON PLACEHOLDERS
// ============================================
function renderInitialSkeletons(page) {
    if (page === 'home') {
        renderHomeSkeletons();
    } else if (page === 'articles') {
        renderArticlesSkeletons();
    } else if (page === 'article') {
        renderArticleDetailSkeleton();
    }
}

function renderHomeSkeletons() {
    renderHeroSkeleton();
    renderFeaturedStoriesSkeleton();
    renderHomeArticlesSkeleton();
}

function renderHeroSkeleton() {
    const container = document.getElementById('hero-featured');
    if (!container) return;

    container.innerHTML = `
        <div class="hero-featured-grid">
            ${Array.from({ length: 3 }).map(() => `
                <div class="featured-card skeleton-card">
                    <div class="featured-card-image-wrapper card-skeleton"></div>
                    <div class="featured-card-overlay">
                        <span class="skeleton-pill card-skeleton"></span>
                        <div class="skeleton-line card-skeleton"></div>
                        <div class="skeleton-line short card-skeleton"></div>
                    </div>
                </div>
            `).join('')}
        </div>
    `;
}

function renderFeaturedStoriesSkeleton() {
    const grid = document.getElementById('featured-stories-grid');
    if (!grid) return;

    grid.innerHTML = Array.from({ length: 4 }).map(() => `
        <div class="featured-story-card skeleton-card">
            <div class="featured-story-image card-skeleton"></div>
            <div class="featured-story-content skeleton-body">
                <span class="skeleton-pill card-skeleton"></span>
                <div class="skeleton-line"></div>
                <div class="skeleton-line short"></div>
                <div class="skeleton-line tiny"></div>
            </div>
        </div>
    `).join('');
}

function renderHomeArticlesSkeleton() {
    const grid = document.getElementById('home-articles-grid');
    if (!grid) return;

    grid.innerHTML = Array.from({ length: 6 }).map(() => createSkeletonArticleCard()).join('');
}

function renderArticlesSkeletons() {
    const cover = document.getElementById('cover-story');
    if (cover) {
        cover.innerHTML = `
            <div class="magazine-cover-grid skeleton-card">
                <div class="magazine-cover-image card-skeleton"></div>
                <div class="magazine-cover-content skeleton-body">
                    <div class="skeleton-pill card-skeleton"></div>
                    <div class="skeleton-line"></div>
                    <div class="skeleton-line short"></div>
                    <div class="skeleton-line tiny"></div>
                </div>
            </div>
        `;
    }

    const grid = document.getElementById('magazine-grid') || document.getElementById('articles-grid');
    if (grid) {
        grid.innerHTML = Array.from({ length: 9 }).map(() => createSkeletonArticleCard('magazine')).join('');
    }
}

function renderArticleDetailSkeleton() {
    const container = document.getElementById('article-detail');
    if (!container) return;

    container.innerHTML = `
        <div class="article-detail-header">
            <span class="skeleton-pill card-skeleton"></span>
            <div class="skeleton-line card-skeleton" style="height: 28px;"></div>
            <div class="skeleton-line short card-skeleton"></div>
        </div>
        <div class="article-detail-image card-skeleton" style="height: 380px;"></div>
        <div class="article-detail-content skeleton-body">
            ${Array.from({ length: 7 }).map((_, idx) => `
                <div class="skeleton-line ${idx % 3 === 0 ? 'long' : idx % 2 === 0 ? 'short' : ''}"></div>
            `).join('')}
        </div>
    `;
}

function createSkeletonArticleCard(type = 'article') {
    const isMagazine = type === 'magazine';
    const wrapperClass = isMagazine ? 'magazine-article small' : 'article-card';
    const imageClass = isMagazine ? 'magazine-article-image-wrapper' : 'article-image';
    const contentClass = isMagazine ? 'magazine-article-content' : 'article-content';

    return `
        <article class="${wrapperClass} skeleton-card">
            <div class="${imageClass} card-skeleton"></div>
            <div class="${contentClass} skeleton-body">
                <span class="skeleton-pill card-skeleton"></span>
                <div class="skeleton-line"></div>
                <div class="skeleton-line short"></div>
                <div class="skeleton-line tiny"></div>
            </div>
        </article>
    `;
}

// ============================================
// NAVIGATION
// ============================================
// The hamburger menu and active-link wiring now lives in js/layout.js so
// every page (including ones that don't load main.js) gets the handler.
// Keep this as a no-op to preserve any existing callers.
function setupNavigation() {}

// ============================================
// NEWSLETTER MODAL
// ============================================
function setupNewsletterModal() {
    const newsletterModal = document.getElementById('newsletter-modal');
    if (!newsletterModal) return;

    const mobileNewsletterBtn = document.getElementById('mobile-newsletter-btn');
    const desktopSubscribeBtn = document.getElementById('desktop-subscribe-btn');
    const modalClose = document.getElementById('newsletter-modal-close');
    const modalOverlay = document.getElementById('newsletter-modal-overlay');

    const openModal = () => {
        newsletterModal.classList.add('active');
        document.body.style.overflow = 'hidden';
    };

    const closeModal = () => {
        newsletterModal.classList.remove('active');
        document.body.style.overflow = '';
    };

    // Both mobile mail icon and desktop subscribe button open the modal
    mobileNewsletterBtn?.addEventListener('click', openModal);
    desktopSubscribeBtn?.addEventListener('click', openModal);
    modalClose?.addEventListener('click', closeModal);
    modalOverlay?.addEventListener('click', closeModal);

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && newsletterModal.classList.contains('active')) {
            closeModal();
        }
    });
}

// ============================================
// SCROLL EFFECTS
// ============================================
function setupScrollEffects() {
    const header = document.querySelector('.header');

    window.addEventListener('scroll', () => {
        if (window.scrollY > 50) {
            header?.classList.add('scrolled');
        } else {
            header?.classList.remove('scrolled');
        }
    });

    // Intersection observer for fade-in
    fadeObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
            }
        });
    }, { threshold: 0.1 });

    document.querySelectorAll('.fade-in').forEach(el => fadeObserver.observe(el));
}

// ============================================
// SCROLL TO TOP
// ============================================
function setupScrollToTop() {
    const scrollBtn = document.getElementById('scroll-top');
    if (!scrollBtn) return;

    window.addEventListener('scroll', () => {
        if (window.scrollY > 500) {
            scrollBtn.classList.add('visible');
        } else {
            scrollBtn.classList.remove('visible');
        }
    });

    scrollBtn.addEventListener('click', () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });
}

// ============================================
// HOME PAGE
// ============================================
function initHomePage(data) {
    initHeroFeatured(data);
    initFeaturedStoriesGrid(data);
    initHomeArticles(data);
    initSearch(data);
    initBrainTeaser();
    initScrollAnimations();
}

function initHeroFeatured(data) {
    const container = document.getElementById('hero-featured');
    if (!container || !Array.isArray(data) || data.length === 0) return;

    // Get top 3 articles for hero featured grid (most recent)
    const featured = data.slice(0, 3);

    // If the hero was already painted with the same 3 articles, skip re-render
    // so the in-flight image fetches aren't cancelled and restarted.
    const signature = featured.map(a => a.image || a.title).join('||');
    if (container.dataset.heroSignature === signature) return;
    container.dataset.heroSignature = signature;

    container.innerHTML = `
        <div class="hero-featured-grid">
            ${featured.map(article => `
                <div class="featured-card" onclick="viewArticle('${encodeURIComponent(getArticleLink(article))}')">
                    ${createProgressiveImage(
                        article.image || ARTICLE_FALLBACK_IMAGE,
                        article.title,
                        'featured-card-image-wrapper',
                        true, // All 3 hero cards are above the fold → eager + high priority
                        article.imageSettings // Pass custom image settings
                    )}
                    <div class="featured-card-overlay">
                        <span class="featured-card-category">${formatCategory(article.category)}</span>
                        <h3 class="featured-card-title">${article.title}</h3>
                        <p class="featured-card-meta">${article.author} • ${article.date}</p>
                    </div>
                </div>
            `).join('')}
        </div>
    `;

    // Register progressive images for this container
    registerProgressiveImages(container);
}

// Featured Stories Grid
function initFeaturedStoriesGrid(data = []) {
    const grid = document.getElementById('featured-stories-grid');
    if (!grid || !Array.isArray(data) || !data.length) return;

    // Skip the first 3 (already shown in hero), show next 5 articles
    const featured = data.slice(3, 8);

    grid.innerHTML = featured.map((article, idx) => {
        // Build data attributes for image settings
        const settings = article.imageSettings || {};
        const dataAttrs = [];
        if (settings.position) dataAttrs.push(`data-bg-position="${settings.position}"`);
        if (settings.zoom) dataAttrs.push(`data-bg-zoom="${settings.zoom}"`);
        const lqipBg = window.__LQIP_MANIFEST && window.__LQIP_MANIFEST[article.image] ? window.__LQIP_MANIFEST[article.image] : '';
        const bgStyle = lqipBg ? `background-image: url('${lqipBg}'); background-size: cover; background-position: center;` : '';

        return `
        <div class="featured-story-card" onclick="viewArticle('${encodeURIComponent(getArticleLink(article))}')">
            <div class="featured-story-image lazy-bg" data-bg-image="${article.image || ARTICLE_FALLBACK_IMAGE}" style="${bgStyle}" ${dataAttrs.join(' ')}></div>
            <div class="featured-story-content">
                <span class="featured-story-badge">${formatCategory(article.category)}</span>
                <h3 class="featured-story-title">${article.title}</h3>
                <p class="featured-story-excerpt">${article.excerpt}</p>
                <div class="featured-story-meta">
                    <span class="featured-story-author">${article.author}</span>
                    <span>•</span>
                    <span>${article.date}</span>
                    <span>•</span>
                    <span>${article.readingTime || estimateReadingTime(article)}</span>
                </div>
            </div>
        </div>
    `}).join('');

    // Register lazy background images for this grid
    registerLazyBackgrounds(grid);
    registerFadeIn(grid);
}

// Canonical topic-tag order for the home archive pills. Only tags that actually
// appear on the loaded stories get a pill; this controls their order.
const HOME_TOPIC_ORDER = ['AI', 'Health', 'Medicine', 'Biology', 'Chemistry',
    'Public Health', 'Physics', 'Environment', 'Space', 'Neuroscience',
    'Technology', 'Policy'];
let homeArticleData = [];
let homeCurrentTopic = 'all';

function initHomeArticles(data) {
    const grid = document.getElementById('home-articles-grid');
    if (!grid || !Array.isArray(data)) return;

    homeArticleData = data;
    renderHomeTopicPills(data);
    renderHomeArticleGrid();
}

// Render the home archive grid for the currently-selected topic. When no topic
// is selected we keep the original behaviour (skip the first 8 shown above,
// show the next 12). When a topic is active we show every matching story from
// the full set so the filter feels complete.
function renderHomeArticleGrid() {
    const grid = document.getElementById('home-articles-grid');
    if (!grid) return;

    let list;
    if (homeCurrentTopic === 'all') {
        list = homeArticleData.slice(8, 20);
    } else {
        list = homeArticleData.filter(a =>
            Array.isArray(a.tags) && a.tags.includes(homeCurrentTopic)).slice(0, 12);
    }

    if (!list.length) {
        grid.innerHTML = `<p style="grid-column:1/-1;text-align:center;color:var(--text-muted);padding:32px 0;">No stories tagged “${homeCurrentTopic}” yet.</p>`;
        return;
    }

    grid.innerHTML = list.map(article => createArticleCard(article)).join('');
    registerFadeIn(grid);
    registerProgressiveImages(grid);
}

function renderHomeTopicPills(data) {
    const wrap = document.getElementById('home-topic-filters');
    if (!wrap) return;

    const present = new Set();
    for (const a of data) if (Array.isArray(a.tags)) a.tags.forEach(t => present.add(t));
    const ordered = HOME_TOPIC_ORDER.filter(t => present.has(t));
    const extras = Array.from(present).filter(t => !HOME_TOPIC_ORDER.includes(t)).sort();
    const topics = ordered.concat(extras);

    if (!topics.length) { wrap.hidden = true; return; }
    wrap.hidden = false;

    const pill = (topic, label) =>
        `<button type="button" class="topic-pill${topic === homeCurrentTopic ? ' active' : ''}" data-topic="${escapeHtmlAttr(topic)}" aria-pressed="${topic === homeCurrentTopic ? 'true' : 'false'}">${escapeHtmlAttr(label)}</button>`;

    wrap.innerHTML = pill('all', 'All Topics') + topics.map(t => pill(t, t)).join('');

    wrap.querySelectorAll('.topic-pill').forEach(p => {
        p.addEventListener('click', () => {
            homeCurrentTopic = p.dataset.topic;
            wrap.querySelectorAll('.topic-pill').forEach(b => {
                const is = b.dataset.topic === homeCurrentTopic;
                b.classList.toggle('active', is);
                b.setAttribute('aria-pressed', is ? 'true' : 'false');
            });
            renderHomeArticleGrid();
        });
    });
}

// ============================================
// ARTICLES PAGE
// ============================================
let articlesDisplayed = 9;
let currentFilter = 'all';
let currentSearch = '';

function initArticlesPage(data) {
    if (!Array.isArray(data)) return;
    initMagazineCover(data);
    initMagazineGrid(data);
    setupMagazineNav(data);
    setupMagazineSearch(data);
    setupLoadMore();
}

function renderArticles(filter = 'all', data = articleData) {
    const grid = document.getElementById('articles-grid');
    if (!grid || !Array.isArray(data)) return;

    currentFilter = filter;
    const filtered = filter === 'all'
        ? data
        : data.filter(a => a.category === filter);

    const toShow = filtered.slice(0, articlesDisplayed);

    grid.innerHTML = toShow.map(article => createArticleCard(article)).join('');

    // Update load more visibility
    const loadMoreBtn = document.getElementById('load-more-btn');
    if (loadMoreBtn) {
        loadMoreBtn.style.display = articlesDisplayed >= filtered.length ? 'none' : 'inline-flex';
    }

    registerFadeIn(grid);
    registerProgressiveImages(grid);
}

function createArticleCard(article) {
    // Use the article's link (slug URL) if available, else fall back to id
    const link = article.link || `/article/${encodeURIComponent(titleToSlug(article.title))}`;

    const imageSrc = article.image || ARTICLE_FALLBACK_IMAGE;
    const rawCategory = article.category || 'feature';
    const category = rawCategory === 'article' ? 'feature' : rawCategory;
    const readingTime = article.readingTime || estimateReadingTime(article);
    const imageMarkup = createProgressiveImage(
        imageSrc,
        article.title,
        'article-image',
        false,
        article.imageSettings,
        `<span class="article-category ${category}">${formatCategory(rawCategory)}</span>`
    );

    return `
        <article class="article-card fade-in" onclick="viewArticle('${encodeURIComponent(link)}')">
            ${imageMarkup}
            <div class="article-content">
                <h3 class="article-title">${article.title}</h3>
                <p class="article-excerpt">${article.excerpt}</p>
                <div class="article-meta">
                    <span class="article-author">${article.author}</span>
                    <span>${article.date}</span>
                    <span class="reading-time">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="10"></circle>
                            <polyline points="12 6 12 12 16 14"></polyline>
                        </svg>
                        ${readingTime}
                    </span>
                </div>
            </div>
        </article>
    `;
}

function renderEditorials() {
    const grid = document.getElementById('editorials-grid');
    if (!grid || typeof editorials === 'undefined') return;

    grid.innerHTML = editorials.map(article => `
        <article class="article-card fade-in">
            <div class="article-content" style="padding-top: 28px;">
                <span class="article-category ${article.category.replace('-', '')}" style="position: relative; margin-bottom: 16px;">${formatCategory(article.category)}</span>
                <h3 class="article-title">${article.title}</h3>
                <p class="article-excerpt">${article.excerpt}</p>
                <div class="article-meta">
                    <span class="article-author">${article.author}</span>
                    <span>${article.date}</span>
                </div>
            </div>
        </article>
    `).join('');

    registerFadeIn(grid);
}

function setupFilters() {
    const filterBtns = document.querySelectorAll('.filter-btn');
    filterBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            filterBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            articlesDisplayed = 9;
            renderArticles(btn.dataset.filter);
        });
    });
}

function setupLoadMore() {
    const btn = document.getElementById('load-more-btn');
    if (btn) {
        btn.addEventListener('click', () => {
            articlesDisplayed += 6;
            renderMagazineGrid(currentFilter, articleData);
        });
    }
}

// ============================================
// MAGAZINE STYLE - ARTICLES PAGE
// ============================================
function initMagazineCover(data) {
    const coverContainer = document.getElementById('cover-story');
    if (!coverContainer || !data.length) return;

    const coverStory = data[0];
    const rawSrc = coverStory.image || ARTICLE_FALLBACK_IMAGE;
    const coverSrc = getResizedImageUrl(rawSrc, 2400, 95);

    // Use a plain <img> with no positional tricks — the card's height flows
    // from the image's intrinsic aspect ratio, and the content column stretches
    // to match via grid align-items: stretch. No cropping, no gray gaps,
    // always looks right regardless of what the user uploads.
    const safeRaw = rawSrc.replace(/'/g, "\\'");
    const safeFallback = ARTICLE_FALLBACK_IMAGE.replace(/'/g, "\\'");
    const onErr = rawSrc && rawSrc !== coverSrc && rawSrc !== ARTICLE_FALLBACK_IMAGE
        ? `this.onerror=function(){this.onerror=null;this.src='${safeFallback}';};this.src='${safeRaw}';`
        : `this.onerror=null;this.src='${safeFallback}';`;

    coverContainer.innerHTML = `
        <div class="magazine-cover-grid" onclick="viewArticle('${encodeURIComponent(getArticleLink(coverStory))}')">
            <div class="magazine-cover-image">
                <img src="${coverSrc}" alt="${coverStory.title}" class="magazine-cover-img"
                     loading="eager" fetchpriority="high" decoding="async"
                     onerror="${onErr}">
            </div>
            <div class="magazine-cover-content">
                <div class="magazine-cover-label">Cover Story</div>
                <h2 class="magazine-cover-title">${coverStory.title}</h2>
                <p class="magazine-cover-excerpt">${coverStory.excerpt}</p>
                <div class="magazine-cover-meta">${coverStory.author} • ${coverStory.date}</div>
            </div>
        </div>
    `;
}

function initMagazineGrid(data) {
    // Check for URL parameter to set initial filter
    const urlParams = new URLSearchParams(window.location.search);
    const categoryParam = urlParams.get('category');
    const initialFilter = categoryParam || 'all';

    // Update active nav button if there's a category parameter
    if (categoryParam) {
        const navItems = document.querySelectorAll('.magazine-nav-item');
        navItems.forEach(item => {
            item.classList.remove('active');
            if (item.dataset.category === categoryParam) {
                item.classList.add('active');
            }
        });
    }

    renderMagazineGrid(initialFilter, data);
}

function renderMagazineGrid(filter, data) {
    const grid = document.getElementById('magazine-grid');
    if (!grid || !Array.isArray(data)) return;

    currentFilter = filter;

    // When the user is searching we include the cover story in the grid so
    // they can't "miss" a match that happens to be the featured piece.
    // Otherwise the first article is rendered separately as the cover story.
    const searching = !!currentSearch;
    const source = searching ? data : data.slice(1);

    let filtered = filter === 'all'
        ? source.slice()
        : source.filter(a => {
            if (filter === 'editorial') {
                return a.category === 'editorial' || a.category === 'op-ed';
            }
            return a.category === filter;
        });

    if (searching) {
        const needle = currentSearch.toLowerCase();
        filtered = filtered.filter(a => {
            const haystack = [
                a.title, a.excerpt, a.deck, a.author, a.category,
                Array.isArray(a.tags) ? a.tags.join(' ') : ''
            ].filter(Boolean).join(' ').toLowerCase();
            return haystack.includes(needle);
        });
    }

    // Hide the cover-story card while searching so the search results stand alone.
    const coverEl = document.getElementById('cover-story');
    if (coverEl) coverEl.style.display = searching ? 'none' : '';

    const toShow = filtered.slice(0, articlesDisplayed);

    if (!toShow.length) {
        grid.innerHTML = `
            <div class="magazine-empty-state">
                <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                </svg>
                <div class="magazine-empty-state__title">${searching ? 'No articles match your search' : 'No articles in this section yet'}</div>
                ${searching ? `<div class="magazine-empty-state__hint">Try a different keyword or clear the search to browse everything.</div>` : ''}
            </div>`;
        const loadMoreBtn = document.getElementById('load-more-btn');
        if (loadMoreBtn) loadMoreBtn.style.display = 'none';
        return;
    }

    // Create magazine layout with improved pattern for better alignment
    // Pattern ensures no gaps: Large (2x2), then fill row with smalls, then mediums (2x1)
    grid.innerHTML = toShow.map((article, index) => {
        let sizeClass = 'small';

        // Improved pattern for professional magazine layout
        // Every 6th article is large (2x2)
        // Every 3rd article (not large) is medium (2x1)
        // All others are small (1x1)

        if (index % 6 === 0) {
            sizeClass = 'large';
        } else if (index % 3 === 0 && index % 6 !== 0) {
            sizeClass = 'medium';
        } else {
            sizeClass = 'small';
        }

        return createMagazineArticle(article, sizeClass, index);
    }).join('');

    // Update load more visibility
    const loadMoreBtn = document.getElementById('load-more-btn');
    if (loadMoreBtn) {
        loadMoreBtn.style.display = articlesDisplayed >= filtered.length ? 'none' : 'inline-flex';
    }

    // Register progressive images for newly rendered articles
    registerProgressiveImages(grid);
}

function createMagazineArticle(article, sizeClass = 'small', gridIndex = 99) {
    const imageSrc = article.image || ARTICLE_FALLBACK_IMAGE;
    const category = article.category || 'feature';
    // Magazine grid on articles page: 3 cols in a 1200px container with 24px gap
    // → each col ~384px. Large/medium cards span 2 cols (~792px rendered).
    // On 2x retina: large/medium need ~1600px source, small need ~800px source.
    // Render every card on the articles page with an explicit high-quality
    // <img> so quality is under our control. The shared createProgressiveImage
    // path (used on home page) is deliberately untouched.
    const isBig = sizeClass === 'large' || sizeClass === 'medium';
    const imgWidth = isBig ? 1600 : 900;
    const imgQuality = isBig ? 95 : 90;
    const resized = getResizedImageUrl(imageSrc, imgWidth, imgQuality);
    const isAboveFold = sizeClass === 'large' && gridIndex === 0;
    const loadingAttr = isAboveFold ? 'eager' : 'lazy';
    const priorityAttr = isAboveFold ? 'fetchpriority="high"' : '';
    const lqip = window.__LQIP_MANIFEST && window.__LQIP_MANIFEST[imageSrc] ? window.__LQIP_MANIFEST[imageSrc] : '';
    const bgStyle = lqip ? `background-image: url('${lqip}'); background-size: cover; background-position: center;` : '';
    // If the resized proxy fails, try the original URL before the fallback.
    const cardOnError = imageSrc && imageSrc !== resized && imageSrc !== ARTICLE_FALLBACK_IMAGE
        ? `this.onerror=function(){this.onerror=null;this.src='${ARTICLE_FALLBACK_IMAGE}';this.classList.add('loaded');};this.src='${imageSrc.replace(/'/g, "\\'")}';`
        : `this.onerror=null;this.src='${ARTICLE_FALLBACK_IMAGE}';this.classList.add('loaded');`;
    const imageMarkup = `
        <div class="magazine-article-image-wrapper card-img-wrap" style="${bgStyle}">
            <img src="${resized}" alt="${article.title}" class="card-img" loading="${loadingAttr}" decoding="async" ${priorityAttr}
                 onload="this.classList.add('loaded')"
                 onerror="${cardOnError}">
        </div>
    `;

    return `
        <article class="magazine-article ${sizeClass}" onclick="viewArticle('${encodeURIComponent(getArticleLink(article))}')">
            ${imageMarkup}
            <div class="magazine-article-content">
                <div class="magazine-article-category">${formatCategory(category)}</div>
                <h3 class="magazine-article-title">${article.title}</h3>
                <p class="magazine-article-excerpt">${article.excerpt}</p>
                <div class="magazine-article-meta">${article.author} • ${article.date}</div>
            </div>
        </article>
    `;
}

function setupMagazineNav(data) {
    const navItems = document.querySelectorAll('.magazine-nav-item');
    navItems.forEach(item => {
        item.addEventListener('click', () => {
            navItems.forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');
            articlesDisplayed = 9;
            renderMagazineGrid(item.dataset.category, data);
        });
    });
}

function setupMagazineSearch(data) {
    const input = document.getElementById('magazine-search-input');
    const clearBtn = document.getElementById('magazine-search-clear');
    if (!input) return;

    const apply = () => {
        currentSearch = input.value.trim();
        if (clearBtn) clearBtn.hidden = !currentSearch;
        articlesDisplayed = 9;
        renderMagazineGrid(currentFilter, data);
    };

    let debounce;
    input.addEventListener('input', () => {
        clearTimeout(debounce);
        debounce = setTimeout(apply, 120);
    });
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && input.value) {
            input.value = '';
            apply();
        }
    });
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            input.value = '';
            apply();
            input.focus();
        });
    }
}


function showNotification(message, type = 'success') {
    // Remove any toast that's still on screen so a quick second
    // action doesn't stack pills on top of each other.
    const existing = document.querySelector('.notification');
    if (existing) existing.remove();

    const notification = document.createElement('div');
    notification.className = `notification notification--${type === 'error' ? 'error' : 'success'}`;

    // Minimalist toast — small ink dot for success, hairline cross for
    // error. The previous design used a heavy gradient pill (blue for
    // success, red for error) that read as a default "AI generic" toast
    // and clashed with the editorial typography. New design follows the
    // same pattern Linear / Apple System notifications use: solid dark
    // surface, restrained type, soft shadow, no color encoding beyond a
    // tiny accent dot.
    const isError = type === 'error';
    const dot = isError
        ? `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`
        : `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;

    notification.innerHTML = `<span class="notification__icon">${dot}</span><span class="notification__text">${message}</span>`;

    notification.style.cssText = `
        position: fixed;
        bottom: 28px;
        left: 50%;
        transform: translateX(-50%) translateY(120%);
        background: #0a0a0c;
        color: #fbfbf9;
        padding: 11px 16px 11px 14px;
        border-radius: 999px;
        display: inline-flex;
        align-items: center;
        gap: 10px;
        font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Inter', 'Helvetica Neue', Helvetica, Arial, sans-serif;
        font-size: 13.5px;
        font-weight: 500;
        letter-spacing: -0.005em;
        line-height: 1.2;
        box-shadow: 0 12px 28px -12px rgba(0,0,0,0.45), 0 4px 10px rgba(0,0,0,0.18);
        z-index: 10000;
        max-width: min(92vw, 420px);
        opacity: 0;
        transition: transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity 200ms ease;
    `;

    // Inline icon styles so we don't depend on a CSS file shipping
    // alongside the JS — the notification is portable across pages.
    const iconEl = notification.querySelector('.notification__icon');
    iconEl.style.cssText = `
        width: 20px; height: 20px;
        display: inline-flex; align-items: center; justify-content: center;
        border-radius: 50%;
        flex-shrink: 0;
        background: ${isError ? 'rgba(248,113,113,0.18)' : 'rgba(255,255,255,0.12)'};
        color: ${isError ? '#fca5a5' : '#a7f3d0'};
    `;

    document.body.appendChild(notification);

    // Force a reflow so the entrance transition fires from the
    // off-screen state instead of skipping.
    // eslint-disable-next-line no-unused-expressions
    notification.offsetHeight;
    notification.style.transform = 'translateX(-50%) translateY(0)';
    notification.style.opacity = '1';

    setTimeout(() => {
        notification.style.transform = 'translateX(-50%) translateY(120%)';
        notification.style.opacity = '0';
        setTimeout(() => notification.remove(), 280);
    }, 3200);
}

// ============================================
// ARTICLE DETAIL PAGE
// ============================================
async function initArticleDetailPage(data) {
    console.log('[catalyst] initArticleDetailPage entered. data.length=', data?.length, 'isArray=', Array.isArray(data));
    if (!Array.isArray(data)) {
        console.warn('[catalyst] data not array — redirecting to /articles');
        window.location.href = '/articles';
        return;
    }

    // Support /article/<slug>, /book-review/<slug>, and the legacy
    // /article.html?id=<id> URL. Both slug routes serve the same shell;
    // the renderer picks the right template based on the article's category.
    const pathSlug = window.location.pathname.match(/\/(?:article|book-review)\/([^/?#]+)/)?.[1];
    const urlParams = new URLSearchParams(window.location.search);
    const rawId = urlParams.get('id');
    const isBookReviewUrl = window.location.pathname.startsWith('/book-review/');
    console.log('[catalyst] pathSlug=', pathSlug, 'rawId=', rawId, 'isBookReviewUrl=', isBookReviewUrl);

    let article = await resolveArticleForDetailPage({ data, pathSlug, rawId });
    console.log('[catalyst] resolved article:', article ? { id: article.id, title: article.title, slug: article.slug } : null);

    if (!article) {
        console.warn('[catalyst] article not resolved — redirecting to', isBookReviewUrl ? '/book-reviews' : '/articles');
        // Last-resort: book-review URLs always have a sibling /book-reviews
        // index, so route there instead of /articles. Otherwise fall back
        // to the normal articles index.
        window.location.href = isBookReviewUrl ? '/book-reviews' : '/articles';
        return;
    }

    // The resolver may have returned an article that wasn't yet in the
    // cached list (e.g. fetched directly by ID). Make sure it's in
    // articleData so related-articles / related-books picks see it.
    if (!data.some(a => String(a.id) === String(article.id))) {
        data.push(article);
    }

    // Fetch the full Firestore document to get the article body (body/content),
    // which is excluded from the listing query projection to keep it fast.
    console.log('[catalyst] fetching full body for article.id=', article.id);
    fetchFullArticleBody(article.id).then(full => {
        console.log('[catalyst] fetchFullArticleBody resolved. full=', full ? { id: full.id, hasContent: !!full.content, blocks: full.blocks?.length || 0, title: full.title } : null);
        if (full) {
            if (full.content) article.content = full.content;
            if (full.blocks && full.blocks.length) article.blocks = full.blocks;
            if (full.author && full.author !== 'The Catalyst') article.author = full.author;
            if (full.deck) article.deck = full.deck;
            if (full.lightCover !== undefined) article.lightCover = full.lightCover;
            if (full.game) article.game = full.game;
            // Book-review-specific fields. Use `!= null` so 0 / "" / false
            // don't overwrite a meaningful value from the list fetch.
            if (full.bookAuthor)    article.bookAuthor    = full.bookAuthor;
            if (full.isbn)          article.isbn          = full.isbn;
            if (full.rating != null) article.rating       = full.rating;
            if (full.communityPick !== undefined) article.communityPick = full.communityPick;
        }
        console.log('[catalyst] calling renderArticleDetail (after full-body fetch)');
        try {
            renderArticleDetail(article);
            console.log('[catalyst] renderArticleDetail returned cleanly');
        } catch (err) {
            console.error('[catalyst] renderArticleDetail THREW:', err, err?.stack);
        }
    }).catch((err) => {
        console.warn('[catalyst] fetchFullArticleBody failed:', err?.message);
        try {
            renderArticleDetail(article);
            console.log('[catalyst] renderArticleDetail returned cleanly (after fetch fail)');
        } catch (e) {
            console.error('[catalyst] renderArticleDetail THREW (after fetch fail):', e, e?.stack);
        }
    });

    try {
        renderRelatedArticles(article, data);
        console.log('[catalyst] renderRelatedArticles returned cleanly');
    } catch (err) {
        console.error('[catalyst] renderRelatedArticles THREW:', err, err?.stack);
    }
}

// =============================================================
// Article-detail resolver — multi-strategy lookup so a stale cache,
// a truncated URL, or a Firestore listing failure doesn't bounce
// the reader to /articles when there's a real article behind the URL.
//
// Strategies, in order:
//   1. <meta name="catalyst-article-id"> — set by the Pages function
//      when the slug resolved server-side. Always trust this if present.
//      Fetches by ID directly if the ID isn't in the local cache.
//   2. Local cache match (ID, slug, link slug, or title→slug).
//   3. Prefix-tolerant local cache match — handles URLs that got
//      truncated by mail clients / iMessage / Twitter (the long-title
//      reviews are most affected: "the-disappearing-spoon-and-…" can
//      lose its tail and still be unambiguously matchable).
//   4. Direct Firestore ID / slug query (cold cache, listing query failure).
// =============================================================
async function resolveArticleForDetailPage({ data, pathSlug, rawId }) {
    const injectedId = document.querySelector('meta[name="catalyst-article-id"]')?.content || '';

    if (injectedId) {
        const cached = data.find(a => String(a.id) === String(injectedId));
        if (cached) return cached;
        const fetched = await fetchArticleByIdAsListing(injectedId);
        if (fetched) return fetched;
    }

    if (rawId && !pathSlug) {
        const cached = data.find(a => String(a.id) === String(rawId));
        if (cached) return cached;
        const fetched = await fetchArticleByIdAsListing(rawId);
        if (fetched) return fetched;
    }

    if (!pathSlug) return null;

    const wantedRaw = safeDecodeURIComponent(pathSlug);
    const wantedSlug = wantedRaw.toLowerCase();

    // Exact match in the local cache. Also accept the legacy slug form so
    // historic URLs that pre-date the NFKD diacritic-strip (e.g.
    // "g-del-escher-bach…" for "Gödel, Escher, Bach…") still resolve to the
    // article and don't bounce the reader back to /book-reviews.
    let match = data.find(a =>
        String(a.id || '') === wantedRaw
        || String(a.slug || '').toLowerCase() === wantedSlug
        || slugKey(a.link || a.url || '') === wantedSlug
        || titleToSlug(a.title) === wantedSlug
        || titleToLegacySlug(a.title) === wantedSlug
    );
    if (match) return match;

    // `/book-review/<Firestore document ID>` is used for duplicate reviews
    // of the same book. Those reviews can share a title-based slug, so the
    // path segment must also be allowed to resolve as the story document ID.
    const byId = await fetchArticleByIdAsListing(wantedRaw);
    if (byId) return byId;

    // Prefix-tolerant fallback. If the URL got truncated mid-slug, this
    // still matches as long as the prefix is unique. We require ≥40 chars
    // of prefix to avoid collisions on short titles.
    if (wantedSlug.length >= 40) {
        const candidates = data.filter(a => {
            const s = String(a.slug || '').toLowerCase() || titleToSlug(a.title);
            return s && s.startsWith(wantedSlug);
        });
        if (candidates.length === 1) return candidates[0];
        // The other direction: cached slug is a prefix of the wanted slug
        // (rare — happens when the title was edited but the URL is from a
        // share before the edit landed).
        const reverse = data.filter(a => {
            const s = String(a.slug || '').toLowerCase() || titleToSlug(a.title);
            return s && s.length >= 40 && wantedSlug.startsWith(s);
        });
        if (reverse.length === 1) return reverse[0];
    }

    // Last resort: ask Firestore directly for a doc with this slug. Covers
    // the case where the listing query failed but the article exists.
    const fetched = await fetchArticleBySlug(wantedSlug);
    if (fetched) return fetched;

    return null;
}

function safeDecodeURIComponent(value) {
    try {
        return decodeURIComponent(value || '');
    } catch {
        return value || '';
    }
}

// Fetch a single published story by Firestore doc ID and shape it like a
// listing record (so the rest of the article-detail page can consume it).
async function fetchArticleByIdAsListing(storyId) {
    if (!storyId) return null;
    const projectId = 'catalystwriters-5ce43';
    try {
        const res = await fetch(
            `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/stories/${encodeURIComponent(storyId)}`
        );
        if (!res.ok) return null;
        const doc = await res.json();
        if (doc.fields?.status?.stringValue !== 'published') return null;
        return firestoreDocToArticle(doc);
    } catch {
        return null;
    }
}

// Fetch a single published story whose `slug` field equals the given value.
// Used as a final fallback when the cached articleData listing didn't
// contain the article (cold cache, listing query failure, etc.).
async function fetchArticleBySlug(slug) {
    if (!slug) return null;
    const projectId = 'catalystwriters-5ce43';
    try {
        const res = await fetch(
            `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    structuredQuery: {
                        from: [{ collectionId: 'stories' }],
                        where: {
                            compositeFilter: {
                                op: 'AND',
                                filters: [
                                    { fieldFilter: { field: { fieldPath: 'status' }, op: 'EQUAL', value: { stringValue: 'published' } } },
                                    { fieldFilter: { field: { fieldPath: 'slug' },   op: 'EQUAL', value: { stringValue: slug } } },
                                ],
                            },
                        },
                        limit: 1,
                    },
                }),
            }
        );
        if (!res.ok) return null;
        const rows = await res.json();
        const doc = Array.isArray(rows) && rows[0]?.document;
        return doc ? firestoreDocToArticle(doc) : null;
    } catch {
        return null;
    }
}

async function fetchFullArticleBody(storyId) {
    if (!storyId) return null;
    const projectId = 'catalystwriters-5ce43';
    try {
        const res = await fetch(
            `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/stories/${encodeURIComponent(storyId)}`
        );
        if (!res.ok) return null;
        const doc = await res.json();
        if (doc.fields?.status?.stringValue !== 'published') return null;
        return firestoreDocToArticle(doc);
    } catch {
        return null;
    }
}

// =============================================================
// ISBN → book cover URL (high-quality)
//
// Two sources, in order:
//   1) Google Books API (preferred — gives 1000+ px covers).
//      https://www.googleapis.com/books/v1/volumes?q=isbn:<ISBN>
//      Returns volumeInfo.imageLinks.thumbnail / smallThumbnail / etc.
//      Default thumbnail has &zoom=1 + &edge=curl — we strip both to
//      get the full-resolution flat scan.
//   2) Open Library covers (fallback — caps around 500 px, but always
//      available without an API call: just an image GET).
//      https://covers.openlibrary.org/b/isbn/<ISBN>-L.jpg?default=false
//      ?default=false makes it 404 instead of returning a 1×1 placeholder.
//
// Both are public, no API key, no auth, CORS-friendly.
// =============================================================
function normalizeIsbn(raw) {
    if (!raw) return '';
    return String(raw).replace(/[^0-9Xx]/g, '').toUpperCase();
}
function openLibraryCoverUrl(isbn, size = 'L') {
    const clean = normalizeIsbn(isbn);
    if (!clean) return '';
    return `https://covers.openlibrary.org/b/isbn/${clean}-${size}.jpg?default=false`;
}

// Strip the bits of a Google Books image URL that downsize / decorate
// the cover. zoom=1 → zoom=0 returns the original-resolution scan;
// removing edge=curl drops the fake page-curl PNG overlay; http→https
// avoids mixed-content blocking on our HTTPS site.
function upscaleGoogleBooksUrl(u) {
    if (!u) return '';
    let url = String(u).replace(/^http:\/\//i, 'https://');
    url = url.replace(/(\?|&)zoom=\d+/g, '$1zoom=0');
    url = url.replace(/(\?|&)edge=curl/g, '$1edge=none');
    return url;
}

// Ask Google Books for the best cover URL we can get. Returns null
// when the book isn't in their catalog or has no image. Cached in
// sessionStorage so multiple lookups for the same ISBN in one tab
// only hit Google once.
async function fetchGoogleBooksCover(isbn) {
    const clean = normalizeIsbn(isbn);
    if (!clean) return null;
    const cacheKey = `gb_cover_${clean}`;
    try {
        const cached = sessionStorage.getItem(cacheKey);
        if (cached !== null) return cached || null;
    } catch {}

    try {
        const res = await fetch(`https://www.googleapis.com/books/v1/volumes?q=isbn:${encodeURIComponent(clean)}&country=US&maxResults=1`);
        if (!res.ok) throw new Error('Google Books ' + res.status);
        const data = await res.json();
        const item = data.items && data.items[0];
        const links = item?.volumeInfo?.imageLinks;
        if (!links) {
            try { sessionStorage.setItem(cacheKey, ''); } catch {}
            return null;
        }
        // Prefer the most-zoomable URL Google returns. Each link is a
        // pre-baked scaled version of the same scan; upscaleGoogleBooksUrl
        // flips zoom=0 on all of them to request the original.
        const candidate = links.extraLarge || links.large || links.medium ||
                          links.small || links.thumbnail || links.smallThumbnail;
        const upscaled = upscaleGoogleBooksUrl(candidate);
        try { sessionStorage.setItem(cacheKey, upscaled || ''); } catch {}
        return upscaled || null;
    } catch {
        return null;
    }
}

// Probe Open Library's covers CDN. Used as the fallback when Google
// has nothing — and also as an immediate first-paint candidate while
// the (slower) Google JSON fetch is in flight.
function probeOpenLibraryCover(isbn) {
    return new Promise((resolve) => {
        const url = openLibraryCoverUrl(isbn, 'L');
        if (!url) return resolve(null);
        const img = new Image();
        let settled = false;
        const done = (val) => { if (!settled) { settled = true; resolve(val); } };
        img.onload  = () => done(img.naturalWidth > 1 ? url : null);
        img.onerror = () => done(null);
        setTimeout(() => done(null), 6000);
        img.src = url;
    });
}

// Main entry point: best-effort high-res cover lookup. Tries Google
// Books first (high-res); if Google misses, falls back to Open Library.
// Returns null if nothing usable is found.
async function fetchIsbnCover(isbn) {
    const clean = normalizeIsbn(isbn);
    if (!clean) return null;
    const fromGoogle = await fetchGoogleBooksCover(clean);
    if (fromGoogle) return fromGoogle;
    return await probeOpenLibraryCover(clean);
}

// Kept around for callers that just need a fast, no-network URL (no
// probing): use Open Library directly. Falls through to placeholder
// behaviour in CSS if the cover doesn't exist on Open Library.
function probeIsbnCover(isbn, size = 'L') {
    // Backwards-compatibility shim. Async probe with the old name.
    return probeOpenLibraryCover(isbn);
}

// Expose for the writer composer module + book-reviews.js so they
// can reuse the exact same lookup logic.
window.__catalystIsbnCover     = probeIsbnCover;           // legacy alias
window.__catalystBestCover     = fetchIsbnCover;           // preferred (Google → OL)
window.__catalystOpenLibraryUrl = openLibraryCoverUrl;     // fast no-probe URL

function renderArticleDetail(article) {
    const container = document.getElementById('article-detail');
    if (!container) return;

    // Book reviews get their own dedicated template — different layout,
    // big cover, rating spread, book-metadata header. Keeps reviews from
    // looking like every other Catalyst article.
    if (isBookReview(article)) {
        return renderBookReviewDetail(article, container);
    }

    // --- Meta tags + page title -------------------------------------------
    document.title = `${article.title} | The Catalyst Magazine`;

    const articleUrl = `${window.location.origin}/article/${encodeURIComponent(article.slug || titleToSlug(article.title))}`;
    const articleImage = /^https?:\/\//i.test(article.image || '')
        ? article.image
        : `${window.location.origin}/${(article.image || 'NewLogoShape.png').replace(/^\/+/, '')}`;
    const articleDescription = article.excerpt || article.deck || article.description || 'Read this story on The Catalyst Magazine';

    setMetaContent('meta-description',         articleDescription);
    setMetaContent('meta-og-url',              articleUrl);
    setMetaContent('meta-og-title',            article.title);
    setMetaContent('meta-og-description',      articleDescription);
    setMetaContent('meta-og-image',            articleImage);
    setMetaContent('meta-og-image-alt',        article.title);
    setMetaContent('meta-twitter-url',         articleUrl);
    setMetaContent('meta-twitter-title',       article.title);
    setMetaContent('meta-twitter-description', articleDescription);
    setMetaContent('meta-twitter-image',       articleImage);
    setMetaContent('meta-twitter-image-alt',   article.title);

    // Canonical + author + keywords + Article JSON-LD — site-wide SEO
    // baseline so every article page is indexable with full signals
    // (not just book reviews). Idempotent upserters live above
    // renderBookReviewDetail.
    upsertCanonicalLink(articleUrl);
    upsertNamedMeta('author', article.author || 'The Catalyst Magazine');
    upsertNamedMeta('robots', 'index, follow, max-image-preview:large, max-snippet:-1');
    const tagKeywords = Array.isArray(article.tags) ? article.tags.filter(Boolean) : [];
    const kwSet = [
        article.title,
        article.category && `${formatCategory(article.category)} — The Catalyst Magazine`,
        ...tagKeywords,
        'The Catalyst Magazine',
        'science journalism'
    ].filter(Boolean);
    upsertNamedMeta('keywords', kwSet.join(', '));

    upsertJsonLd('catalyst-article-jsonld', {
        '@context': 'https://schema.org',
        '@type': 'NewsArticle',
        headline: article.title,
        description: articleDescription,
        image: articleImage ? [articleImage] : undefined,
        url: articleUrl,
        mainEntityOfPage: articleUrl,
        datePublished: (() => {
            if (!article.date) return undefined;
            const d = new Date(article.date);
            return isNaN(d) ? undefined : d.toISOString().slice(0, 10);
        })(),
        author: { '@type': 'Person', name: article.author || 'The Catalyst' },
        publisher: {
            '@type': 'Organization',
            name: 'The Catalyst Magazine',
            url: 'https://www.catalyst-magazine.com/',
            logo: {
                '@type': 'ImageObject',
                url: 'https://www.catalyst-magazine.com/NewLogoShape.png'
            }
        },
        inLanguage: 'en-US',
        articleSection: article.category ? formatCategory(article.category) : undefined,
        keywords: tagKeywords.length ? tagKeywords.join(', ') : undefined
    });

    // --- Content ----------------------------------------------------------
    const contentHtml = article.blocks?.length
        ? renderContentBlocks(article.blocks)
        : (article.content || `<p>${article.excerpt || ''}</p>`);
    const readingTime = article.readingTime || estimateReadingTime(article);
    const heroImage = getResizedImageUrl(article.image || ARTICLE_FALLBACK_IMAGE, 1600, 80);
    const category = formatCategory(article.category || 'feature');
    const authorInitials = (article.author || 'TC')
        .split(/\s+/)
        .map(s => s[0])
        .filter(Boolean)
        .slice(0, 2)
        .join('')
        .toUpperCase();
    const deckHtml = article.deck
        ? `<p class="article-hero__deck">${escapeHtmlAttr(article.deck)}</p>`
        : '';
    const shareUrl = encodeURIComponent(articleUrl);
    const shareText = encodeURIComponent(article.title);

    container.innerHTML = `
        <header class="article-hero${article.lightCover ? ' article-hero--light-cover' : ''}">
            <div class="article-hero__image" style="background-image:url('${escapeHtmlAttr(heroImage)}')"></div>
            <div class="article-hero__inner">
                <div class="article-hero__surface">
                    <span class="article-hero__category">${category}</span>
                    <h1 class="article-hero__title">${escapeHtmlAttr(article.title)}</h1>
                    ${deckHtml}
                    <div class="article-hero__meta">
                        <span>By <strong>${escapeHtmlAttr(article.author || 'The Catalyst')}</strong></span>
                        <span class="dot"></span>
                        <span>${escapeHtmlAttr(article.date || '')}</span>
                        <span class="dot"></span>
                        <span class="reading-time">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline>
                            </svg>
                            ${readingTime}
                        </span>
                    </div>
                </div>
            </div>
        </header>

        <div class="article-body-wrap">
            <article class="article-body">${contentHtml}</article>

            <aside class="article-byline">
                <div class="article-byline__avatar">${authorInitials}</div>
                <div>
                    <div class="article-byline__name">${escapeHtmlAttr(article.author || 'The Catalyst')}</div>
                    <div class="article-byline__role">Contributing writer · The Catalyst Magazine</div>
                </div>
            </aside>

            <div class="article-share" role="group" aria-label="Share this story">
                <span>Share</span>
                <a class="article-share__btn" href="https://twitter.com/intent/tweet?url=${shareUrl}&text=${shareText}" target="_blank" rel="noopener" aria-label="Share on X">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                </a>
                <a class="article-share__btn" href="https://www.linkedin.com/sharing/share-offsite/?url=${shareUrl}" target="_blank" rel="noopener" aria-label="Share on LinkedIn">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M4.98 3.5C4.98 4.88 3.87 6 2.5 6S0 4.88 0 3.5 1.12 1 2.5 1s2.48 1.12 2.48 2.5zM.22 8h4.56v14H.22V8zM7.78 8h4.37v1.93h.06c.61-1.15 2.1-2.37 4.32-2.37 4.62 0 5.47 3.04 5.47 7v7.45h-4.56v-6.6c0-1.58-.03-3.61-2.2-3.61-2.2 0-2.54 1.72-2.54 3.5V22H7.78V8z"/></svg>
                </a>
                <button class="article-share__btn" type="button" onclick="copyArticleLink()" aria-label="Copy link">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                </button>
            </div>

            ${articleNewsletterNudge()}
        </div>
    `;

    mountReadingProgress();
    registerProgressiveImages(container);
    hydrateQuizzes(container);
    mountArticleGame(container, article);
    // Wire the just-injected end-of-article newsletter form so it posts to
    // /api/subscribe (newsletter-handler.js binds any form[data-newsletter-form]).
    if (typeof window.initNewsletterForms === 'function') {
        window.initNewsletterForms();
    }
    if (typeof window.applyGlossary === 'function') {
        const body = container.querySelector('.article-body');
        if (body) window.applyGlossary(body);
    }
}

// Small end-of-article newsletter prompt. Sits after the share row so readers
// who finished the piece get a gentle, low-friction nudge to subscribe. Posts
// inline to /api/subscribe via the shared newsletter handler — no extra click,
// no modal. Already-subscribed readers get a friendly "you're on the list" reply.
function articleNewsletterNudge() {
    return `
        <aside class="article-newsletter" aria-labelledby="article-nl-title">
            <div class="article-newsletter__glow" aria-hidden="true"></div>
            <div class="article-newsletter__inner">
                <p class="article-newsletter__eyebrow">Enjoyed this story?</p>
                <h3 class="article-newsletter__title" id="article-nl-title">Are you signed up for our newsletter yet?</h3>
                <p class="article-newsletter__copy">Get our strongest stories, D.C. STEM spotlights, and interviews — straight to your inbox. No spam, ever.</p>
                <form class="article-newsletter__form" data-newsletter-form="article-footer" novalidate>
                    <label class="sr-only" for="article-nl-email">Email address</label>
                    <input type="email" id="article-nl-email" name="EMAIL" class="article-newsletter__input" placeholder="you@example.com" required autocomplete="email" inputmode="email">
                    <button type="submit" class="article-newsletter__btn">
                        Subscribe
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
                    </button>
                    <div class="newsletter-response article-newsletter__response" aria-live="polite"></div>
                </form>
                <p class="article-newsletter__fineprint">Read by students at GW, Georgetown, Howard, American &amp; UMD. Unsubscribe anytime.</p>
            </div>
        </aside>
    `;
}

// =============================================================
// SEO helpers — small DOM upserters used by the book-review renderer
// (and reusable by other detail templates). Each one is idempotent so
// repeated renders don't pile up duplicate <meta> / <link> tags.
// =============================================================

// Set the `content` of an existing <meta id="..."> when present.
// Silently no-ops if the tag isn't in the static shell — keeps the
// callsite linear without optional-chain boilerplate everywhere.
function setMetaContent(id, value) {
    const el = document.getElementById(id);
    if (el) el.setAttribute('content', String(value || ''));
}

// Insert or update <link rel="canonical">. Replaces any existing one
// so an article page that previously rendered (different URL) doesn't
// leave a stale canonical pointing to the prior story.
function upsertCanonicalLink(href) {
    if (!href) return;
    let link = document.querySelector('link[rel="canonical"]');
    if (!link) {
        link = document.createElement('link');
        link.setAttribute('rel', 'canonical');
        document.head.appendChild(link);
    }
    link.setAttribute('href', href);
}

// Insert or update <meta name="..."> for non-id-tagged tags
// (author, keywords, robots). Distinct from <meta property="og:...">
// which we manage by id in the static shell.
function upsertNamedMeta(name, content) {
    if (!name) return;
    let el = document.head.querySelector(`meta[name="${name}"]`);
    if (!el) {
        el = document.createElement('meta');
        el.setAttribute('name', name);
        document.head.appendChild(el);
    }
    el.setAttribute('content', String(content || ''));
}

// Insert or update a <script type="application/ld+json"> identified
// by a stable id. The id prevents duplicate JSON-LD blocks across
// navigations on the SPA-style article shell.
function upsertJsonLd(id, payload) {
    if (!id || !payload) return;
    let el = document.getElementById(id);
    if (!el) {
        el = document.createElement('script');
        el.type = 'application/ld+json';
        el.id = id;
        document.head.appendChild(el);
    }
    try {
        el.textContent = JSON.stringify(payload);
    } catch {
        // Bad payload — leave any previous valid JSON in place rather
        // than wipe it out with malformed content.
    }
}

// Build the Schema.org Review object Google reads to render
// star-rating rich results. Includes:
//   • itemReviewed: a Book entity with title/author/isbn so the
//     review attaches to a real cataloged work
//   • reviewRating: 0.5–5 worst→best (when we have a number)
//   • author: the reviewer (Person)
//   • publisher: The Catalyst Magazine (Organization)
//   • reviewBody: a stripped-text excerpt for crawlers
function buildBookReviewJsonLd({
    article, articleUrl, articleImage,
    bookTitle, bookAuthor, reviewer, rating
}) {
    // Pull a plaintext snippet of the actual review prose for reviewBody.
    // Strip HTML, collapse whitespace, clip to ~600 chars (Google reads
    // far less in practice, but a fuller body helps for entity context).
    const rawBody = article.content || article.body || article.reviewText || '';
    const plainBody = String(rawBody)
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<\/(p|div|li|h[1-6])>/gi, ' ')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/\s+/g, ' ')
        .trim();
    const reviewBody = plainBody.length > 600
        ? plainBody.slice(0, 600).replace(/\s+\S*$/, '') + '…'
        : plainBody;

    const itemReviewed = {
        '@type': 'Book',
        name: bookTitle || article.title || '',
    };
    if (bookAuthor) {
        itemReviewed.author = { '@type': 'Person', name: bookAuthor };
    }
    if (article.isbn) {
        // Schema.org accepts plain ISBN-10 or ISBN-13.
        itemReviewed.isbn = String(article.isbn).replace(/[^0-9Xx]/g, '');
    }
    if (articleImage) {
        itemReviewed.image = articleImage;
    }

    const ld = {
        '@context': 'https://schema.org',
        '@type': 'Review',
        url: articleUrl,
        mainEntityOfPage: articleUrl,
        headline: bookTitle ? `${bookTitle} — Book Review` : (article.title || ''),
        name: bookTitle ? `${bookTitle} — Book Review` : (article.title || ''),
        itemReviewed,
        author: { '@type': 'Person', name: reviewer || 'The Catalyst' },
        publisher: {
            '@type': 'Organization',
            name: 'The Catalyst Magazine',
            url: 'https://www.catalyst-magazine.com/',
            logo: {
                '@type': 'ImageObject',
                url: 'https://www.catalyst-magazine.com/NewLogoShape.png'
            }
        },
        inLanguage: 'en-US',
        isPartOf: {
            '@type': 'CollectionPage',
            name: 'The Catalyst Reviews',
            url: 'https://www.catalyst-magazine.com/book-reviews'
        }
    };

    if (article.date) {
        const d = new Date(article.date);
        if (!isNaN(d)) ld.datePublished = d.toISOString().slice(0, 10);
    }
    if (typeof rating === 'number' && rating >= 0 && rating <= 5) {
        ld.reviewRating = {
            '@type': 'Rating',
            ratingValue: rating,
            bestRating: 5,
            worstRating: 0.5
        };
    }
    if (reviewBody) {
        ld.reviewBody = reviewBody;
    }
    if (articleImage) {
        ld.image = articleImage;
    }
    return ld;
}

// =============================================================
// BOOK REVIEW article template — dedicated layout.
// Different shape from the regular article: tall standalone book cover,
// big book title + author header, prominent rating spread, body sits in
// a narrower column for a book-jacket feel. Styles are isolated under
// body[data-page="article"].is-book-review in /css/book-review-article.css.
// =============================================================
function renderBookReviewDetail(article, container) {
    // Tag the body so the scoped CSS activates only for this template.
    document.body.classList.add('is-book-review');

    // --- Meta tags + SEO ---
    // Per-review SEO matters because every review is its own crawlable
    // URL. We compose:
    //   • a rich <title> that leads with the book title (the primary query)
    //   • a description sentence that includes the book, the author, the
    //     rating, and the reviewer — every signal Google likes for a
    //     review-style snippet
    //   • OG / Twitter for social unfurls
    //   • canonical so duplicate slug routes collapse to one URL
    //   • a JSON-LD Review with itemReviewed:Book + reviewRating, the
    //     thing that unlocks star-rating rich results in SERPs
    // -----------------------------------------------------------------
    const articleUrl = getBookReviewDetailUrl(article);
    const socialImage = getBookReviewCover(article);
    const articleImage = /^https?:\/\//i.test(socialImage || '')
        ? socialImage
        : `${window.location.origin}/${(socialImage || 'NewLogoShape.png').replace(/^\/+/, '')}`;

    const bookTitle  = article.bookTitle  || article.title || '';
    const bookAuthor = article.bookAuthor || '';
    const reviewer   = article.author || 'The Catalyst';
    const seoRating  = (typeof article.rating === 'number') ? article.rating : null;
    const ratingText = seoRating != null ? `${seoRating.toFixed(1)}/5` : '';

    // Page title — leads with the book title (the dominant query term),
    // followed by "book review" and the brand. Keeps under ~60 chars when
    // possible by trimming the brand suffix on long titles.
    const titleLead = `${bookTitle} — Book Review`;
    const titleFull = `${titleLead} | The Catalyst Reviews`;
    document.title = (titleFull.length > 70 && titleLead.length > 0)
        ? `${titleLead} | The Catalyst`
        : titleFull;

    // Description — pack the book, author, rating, and reviewer into a
    // single sentence under ~160 chars. Falls through to the original
    // excerpt/deck if no structured book metadata exists yet.
    const descPieces = [];
    if (bookTitle)  descPieces.push(`Review of ${bookTitle}`);
    if (bookAuthor) descPieces.push(`by ${bookAuthor}`);
    if (ratingText) descPieces.push(`— rated ${ratingText}`);
    descPieces.push(`by ${reviewer} for The Catalyst Reviews.`);
    let structuredDesc = descPieces.join(' ').replace(/\s+/g, ' ').trim();
    // Append a short flavor clip from the review body / deck if there's
    // room left, so the snippet has substance beyond the meta line.
    const flavor = (article.excerpt || article.deck || '').replace(/\s+/g, ' ').trim();
    if (flavor && structuredDesc.length < 110) {
        const room = 158 - structuredDesc.length - 1;
        structuredDesc += ' ' + (flavor.length > room ? flavor.slice(0, Math.max(40, room - 1)).trim() + '…' : flavor);
    }
    const articleDescription = (bookTitle || ratingText)
        ? structuredDesc
        : (article.excerpt || article.deck || `A book review by ${reviewer} for The Catalyst Reviews.`);

    // Image alt — describes what the OG card actually shows.
    const imageAlt = bookTitle
        ? `Cover of ${bookTitle}${bookAuthor ? ` by ${bookAuthor}` : ''}`
        : `${article.title} — The Catalyst Reviews`;

    setMetaContent('meta-description',         articleDescription);
    setMetaContent('meta-og-url',              articleUrl);
    setMetaContent('meta-og-title',            document.title);
    setMetaContent('meta-og-description',      articleDescription);
    setMetaContent('meta-og-image',            articleImage);
    setMetaContent('meta-og-image-alt',        imageAlt);
    setMetaContent('meta-twitter-url',         articleUrl);
    setMetaContent('meta-twitter-title',       document.title);
    setMetaContent('meta-twitter-description', articleDescription);
    setMetaContent('meta-twitter-image',       articleImage);
    setMetaContent('meta-twitter-image-alt',   imageAlt);

    // Inject (or update) canonical + author + keywords + JSON-LD —
    // these live outside the static <head> ids so we manage them here.
    upsertCanonicalLink(articleUrl);
    upsertNamedMeta('author',     reviewer);
    upsertNamedMeta('robots',     'index, follow, max-image-preview:large, max-snippet:-1');
    const kwParts = [
        bookTitle && `${bookTitle} review`,
        bookTitle && `${bookTitle} book review`,
        bookAuthor && bookTitle && `${bookTitle} by ${bookAuthor}`,
        article.genre && `${article.genre} book review`,
        'STEM book review',
        'science book review',
        'The Catalyst Reviews',
        'The Catalyst Magazine'
    ].filter(Boolean);
    upsertNamedMeta('keywords', kwParts.join(', '));

    upsertJsonLd('catalyst-review-jsonld',
        buildBookReviewJsonLd({
            article, articleUrl, articleImage,
            bookTitle, bookAuthor, reviewer, rating: seoRating
        })
    );

    // --- Derived values ---
    // Pull the review body from whichever field carries it. The public
    // submission flow saves to `content`; some legacy writer-saved stories
    // use `body` or `reviewText`. Falling back through these keeps older
    // reviews from rendering with only the deck/excerpt.
    const rawBody = article.content
        || article.body
        || article.reviewText
        || '';
    let bodyHtml = article.blocks?.length
        ? renderContentBlocks(article.blocks)
        : (rawBody ? rawBody : `<p>${escapeHtmlAttr(article.excerpt || '')}</p>`);

    // Auto-promote any standalone quoted paragraph (a <p> whose entire
    // text content is wrapped in quotation marks) into a <blockquote>
    // so it renders as a proper pullquote. This runs at view time so
    // older reviews that pre-date the server-side detection in
    // decide.js still get the nicer treatment.
    bodyHtml = promotePullquotes(bodyHtml);

    const contentHtml = bodyHtml;
    const readingTime = article.readingTime || estimateReadingTime(article);
    const rating = (typeof article.rating === 'number' && article.rating >= 0 && article.rating <= 5) ? article.rating : null;
    const ratingPct = rating != null ? Math.round((rating / 5) * 100) : null;
    const stars = renderStars(rating);
    const isReaderPick = !!article.communityPick;
    const isbn = article.isbn || '';
    const shareUrl  = encodeURIComponent(articleUrl);
    const shareText = encodeURIComponent(article.title);

    // The "back" link points back to the column index.
    const backLink = document.querySelector('.article-page .back-link');
    if (backLink) {
        backLink.setAttribute('href', '/book-reviews');
        backLink.lastChild.textContent = ' Back to Book Reviews';
    }

    // Pretty discipline label for the "Filed under" chip. Mirrors the
    // /book-reviews pill set so a reader can tell at a glance which shelf
    // this lives on without us re-listing the title or author.
    const genreLabel = (() => {
        const g = (article.genre || '').toLowerCase();
        const map = {
            'astronomy': 'Astronomy', 'biology': 'Biology',
            'chemistry': 'Chemistry',
            'computer-science': 'Computer Science', 'physics': 'Physics',
            'mathematics': 'Mathematics', 'climate': 'Climate',
            'memoir': 'Memoir', 'stem': 'STEM',
        };
        return map[g] || '';
    })();

    const coverSrc = getBookReviewCover(article);
    const coverFallback = getUploadedReviewCover(article) || ARTICLE_FALLBACK_IMAGE;

    container.innerHTML = `
        <article class="brx" data-has-cover="${coverSrc !== ARTICLE_FALLBACK_IMAGE ? 'true' : 'false'}">
            <header class="brx-hero">
                <div class="brx-hero-inner">
                    <div class="brx-hero-meta">
                        <span class="brx-kicker">
                            ${isReaderPick ? 'Reader pick · The Catalyst Reviews' : 'The Catalyst Reviews'}
                        </span>
                        ${genreLabel
                            ? `<span class="brx-genre-chip">${escapeHtmlAttr(genreLabel)}</span>`
                            : ''
                        }
                    </div>

                    <h1 class="brx-title" data-length="${(article.title || '').length < 40 ? 'short' : (article.title || '').length < 80 ? 'medium' : (article.title || '').length < 120 ? 'long' : 'xlong'}">${escapeHtmlAttr(article.title)}</h1>

                    ${article.bookAuthor
                        ? `<p class="brx-book-author">by <strong>${escapeHtmlAttr(article.bookAuthor)}</strong></p>`
                        : ''
                    }

                    ${article.deck
                        ? `<p class="brx-deck">${escapeHtmlAttr(article.deck)}</p>`
                        : ''
                    }

                    <div class="brx-byline">
                        <div class="brx-byline-pair">
                            <span class="brx-byline-label">Reviewed by</span>
                            <span class="brx-byline-name">${escapeHtmlAttr(article.author || 'The Catalyst')}</span>
                        </div>
                        ${article.date
                            ? `<div class="brx-byline-pair">
                                <span class="brx-byline-label">Published</span>
                                <span class="brx-byline-name">${escapeHtmlAttr(article.date)}</span>
                              </div>`
                            : ''
                        }
                        <div class="brx-byline-pair">
                            <span class="brx-byline-label">Reading time</span>
                            <span class="brx-byline-name">${escapeHtmlAttr(readingTime)}</span>
                        </div>
                    </div>
                </div>
            </header>

            <section class="brx-spread">
                <aside class="brx-cover-wrap">
                    <div class="brx-cover">
                        <img class="brx-cover-img"
                             alt="Cover of ${escapeHtmlAttr(article.title)}"
                             src="${escapeHtmlAttr(coverSrc)}"
                             data-fallback-src="${escapeHtmlAttr(coverFallback)}"
                             loading="eager"
                             fetchpriority="high">
                        <div class="brx-cover-shadow" aria-hidden="true"></div>
                    </div>
                </aside>

                <div class="brx-verdict">
                    ${rating != null
                        ? `<div class="brx-verdict-card">
                            <div class="brx-verdict-eyebrow">${isReaderPick ? 'Reader rating' : 'Catalyst rating'}</div>
                            <div class="brx-verdict-row">
                                <div class="brx-rating-dial" style="--score:${ratingPct};">
                                    <span class="brx-rating-num">${rating.toFixed(1)}</span>
                                </div>
                                <div class="brx-rating-detail">
                                    <div class="brx-rating-stars" aria-label="${rating.toFixed(1)} out of 5">${stars}</div>
                                    <div class="brx-rating-caption">${isReaderPick ? "A Catalyzer's verdict" : "From our reviewer"}</div>
                                </div>
                            </div>
                          </div>`
                        : ''
                    }

                    ${(isbn || genreLabel)
                        ? `<dl class="brx-meta-list">
                            ${isbn
                                ? `<div class="brx-meta-row">
                                    <dt>ISBN</dt>
                                    <dd><code>${escapeHtmlAttr(isbn)}</code></dd>
                                  </div>`
                                : ''
                            }
                            ${genreLabel
                                ? `<div class="brx-meta-row">
                                    <dt>Filed under</dt>
                                    <dd>${escapeHtmlAttr(genreLabel)}</dd>
                                  </div>`
                                : ''
                            }
                          </dl>`
                        : ''
                    }

                    <div class="brx-pullquote" aria-hidden="${article.deck ? 'true' : 'false'}">
                        <svg class="brx-pullquote-mark" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                            <path d="M7.17 6C4.86 6 3 7.84 3 10.13c0 2.29 1.86 4.13 4.17 4.13.36 0 .7-.05 1.03-.13-.46 1.4-1.87 2.46-3.7 2.62l.7 1.25c3.3-.32 5.8-3.13 5.8-7.04C11 7.84 9.45 6 7.17 6zm9.66 0c-2.31 0-4.17 1.84-4.17 4.13 0 2.29 1.86 4.13 4.17 4.13.36 0 .7-.05 1.03-.13-.46 1.4-1.87 2.46-3.7 2.62l.7 1.25c3.3-.32 5.8-3.13 5.8-7.04C20.66 7.84 19.11 6 16.83 6z"/>
                        </svg>
                        <p>${escapeHtmlAttr(article.deck || `A short, honest take on ${article.bookAuthor || 'this book'}'s work — what it's about, who it's for, and why it earns its place on the shelf.`)}</p>
                    </div>

                    <div class="brx-body">${contentHtml}</div>
                </div>
            </section>

            <div class="brx-body-wrap">
                <footer class="brx-coda">
                    <div class="brx-coda-byline">
                        <span class="brx-coda-label">Reviewed by</span>
                        <span class="brx-coda-name">${escapeHtmlAttr(article.author || 'The Catalyst')}</span>
                    </div>
                    <div class="brx-share" role="group" aria-label="Share this review">
                        <span class="brx-share-label">Share</span>
                        <a class="brx-share-btn" href="https://twitter.com/intent/tweet?url=${shareUrl}&text=${shareText}" target="_blank" rel="noopener" aria-label="Share on X">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                        </a>
                        <a class="brx-share-btn" href="https://www.linkedin.com/sharing/share-offsite/?url=${shareUrl}" target="_blank" rel="noopener" aria-label="Share on LinkedIn">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M4.98 3.5C4.98 4.88 3.87 6 2.5 6S0 4.88 0 3.5 1.12 1 2.5 1s2.48 1.12 2.48 2.5zM.22 8h4.56v14H.22V8zM7.78 8h4.37v1.93h.06c.61-1.15 2.1-2.37 4.32-2.37 4.62 0 5.47 3.04 5.47 7v7.45h-4.56v-6.6c0-1.58-.03-3.61-2.2-3.61-2.2 0-2.54 1.72-2.54 3.5V22H7.78V8z"/></svg>
                        </a>
                        <button class="brx-share-btn" type="button" onclick="copyArticleLink()" aria-label="Copy link">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                        </button>
                    </div>
                </footer>

                <section class="brx-shelf" aria-labelledby="brx-shelf-title" hidden>
                    <header class="brx-shelf-head">
                        <span class="brx-shelf-eyebrow">Next on the shelf</span>
                        <h2 class="brx-shelf-title" id="brx-shelf-title">Other books you might enjoy</h2>
                        <p class="brx-shelf-deck">Hand-picked from The Catalyst Reviews based on the genre and feel of this review.</p>
                    </header>
                    <div class="brx-shelf-grid" role="list"></div>
                </section>

                ${articleNewsletterNudge()}

                <a class="brx-cta" href="/book-reviews">
                    <span>Explore more Catalyst Reviews</span>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path d="M5 12h14M13 5l7 7-7 7"/>
                    </svg>
                </a>
            </div>
        </article>
    `;

    mountBookReviewCoverFallback(container);
    mountReadingProgress();
    renderRelatedBookReviews(article, container);
    // Wire the just-injected newsletter form (same handler as the article one).
    if (typeof window.initNewsletterForms === 'function') {
        window.initNewsletterForms();
    }

    // ── Cover upgrade pass ──
    // The hero <img> has already been set to the best URL we knew about
    // at render time (the fast Open Library L thumbnail, or the uploaded
    // admin cover if no ISBN). If a high-res Google Books cover resolves,
    // swap it in — but only after pre-validating that the upgraded URL
    // actually loads as a real image (>1px). A broken or 1×1 Google
    // response must NOT replace a working uploaded/fallback cover.
    if (article.isbn) {
        fetchIsbnCover(article.isbn).then((url) => {
            if (!url) return;
            const img = container.querySelector('.brx-cover-img');
            if (!img) return;
            if (img.src && img.src.indexOf('books.google.com') !== -1) return;

            // Pre-validate off-DOM. Only swap on a real cover-sized image —
            // Google Books returns its "no preview available" placeholder
            // (≈128×177) with a 200 OK when the requested zoom level has no
            // real scan, so a >1px check isn't enough. A real cover is at
            // least a few hundred pixels on the short side.
            const probe = new Image();
            probe.onload = () => {
                const w = probe.naturalWidth || 0;
                const h = probe.naturalHeight || 0;
                if (w >= 200 && h >= 200) {
                    img.src = url;
                    img.classList.remove('failed');
                    img.classList.add('loaded');
                    container.querySelector('.brx')?.setAttribute('data-has-cover', 'true');
                }
            };
            probe.onerror = () => {};
            probe.src = url;
        });
    }
}

function getBookReviewDetailUrl(article) {
    const current = window.location.pathname.match(/^\/book-review\/([^/?#]+)/);
    const canonicalSlug = article.slug || titleToSlug(article.title || '');
    if (current) {
        const rawSegment = current[1];
        const decodedSegment = safeDecodeURIComponent(rawSegment);
        const segmentSlug = decodedSegment.toLowerCase();
        const matchesCurrentArticle =
            decodedSegment === String(article.id || '') ||
            segmentSlug === String(canonicalSlug || '').toLowerCase() ||
            segmentSlug === titleToSlug(article.title || '') ||
            segmentSlug === titleToLegacySlug(article.title || '');

        if (matchesCurrentArticle) {
            return `${window.location.origin}/book-review/${rawSegment}`;
        }
    }

    const fallbackSegment = canonicalSlug || article.id || '';
    return `${window.location.origin}/book-review/${encodeURIComponent(fallbackSegment)}`;
}

// =============================================================
// Related book reviews — "Other books you might enjoy".
// Picks up to 3 other published book reviews. Same-genre matches
// come first; if there aren't enough we fill with the most recent
// other reviews so the shelf is never empty.
// =============================================================
function renderRelatedBookReviews(currentArticle, container) {
    const shelf = container.querySelector('.brx-shelf');
    const grid  = shelf?.querySelector('.brx-shelf-grid');
    if (!shelf || !grid) return;

    const pool = (window.__articleCacheAll || articleData || []).filter((a) =>
        a && isBookReview(a) && String(a.id) !== String(currentArticle.id)
    );
    if (!pool.length) return;

    const currentGenre = String(currentArticle.genre || '').toLowerCase();
    const sameGenre = currentGenre
        ? pool.filter((a) => String(a.genre || '').toLowerCase() === currentGenre)
        : [];
    const others   = pool.filter((a) => !sameGenre.includes(a));

    // Newest first within each bucket; same-genre wins ties.
    const byNewest = (a, b) => {
        const da = Date.parse(a.publishedAt || a.date || 0) || 0;
        const db = Date.parse(b.publishedAt || b.date || 0) || 0;
        return db - da;
    };
    sameGenre.sort(byNewest);
    others.sort(byNewest);

    const picks = [...sameGenre, ...others].slice(0, 3);
    if (!picks.length) return;

    grid.innerHTML = picks.map((review) => {
        const slug = review.slug || titleToSlug(review.title || '');
        const href = `/book-review/${encodeURIComponent(slug)}`;
        const cover = getBookReviewCover(review);
        const fallback = getUploadedReviewCover(review) || ARTICLE_FALLBACK_IMAGE;
        const rating = (typeof review.rating === 'number' && review.rating >= 0 && review.rating <= 5)
            ? review.rating.toFixed(1)
            : null;
        const genre = formatBookReviewGenre(review.genre);
        return `
            <a class="brx-shelf-card" role="listitem" href="${escapeHtmlAttr(href)}">
                <div class="brx-shelf-cover">
                    <img class="brx-shelf-cover-img"
                         src="${escapeHtmlAttr(cover)}"
                         data-fallback-src="${escapeHtmlAttr(fallback)}"
                         alt="Cover of ${escapeHtmlAttr(review.title || '')}"
                         loading="lazy" decoding="async">
                </div>
                <div class="brx-shelf-body">
                    ${genre ? `<span class="brx-shelf-genre">${escapeHtmlAttr(genre)}</span>` : ''}
                    <h3 class="brx-shelf-book">${escapeHtmlAttr(review.title || '')}</h3>
                    ${review.bookAuthor
                        ? `<p class="brx-shelf-author">by ${escapeHtmlAttr(review.bookAuthor)}</p>`
                        : ''}
                    <div class="brx-shelf-meta">
                        ${rating
                            ? `<span class="brx-shelf-rating" aria-label="Rated ${rating} out of 5">★ ${rating}</span>`
                            : ''}
                        <span class="brx-shelf-byline">Reviewed by ${escapeHtmlAttr(review.author || 'The Catalyst')}</span>
                    </div>
                </div>
            </a>
        `;
    }).join('');

    // Wire fallback covers (Open Library 1×1 placeholder → uploaded cover).
    grid.querySelectorAll('.brx-shelf-cover-img').forEach((img) => {
        const fall = img.dataset.fallbackSrc || ARTICLE_FALLBACK_IMAGE;
        let used = false;
        const useFallback = () => {
            if (used) return;
            used = true;
            img.src = fall;
        };
        img.addEventListener('error', useFallback);
        img.addEventListener('load', () => {
            if (img.naturalWidth <= 1 || img.naturalHeight <= 1) useFallback();
        });
    });

    shelf.hidden = false;
}

// Pretty discipline label for the book-review shelf chips. Mirrors the
// inline genre map used inside renderBookReviewDetail() so chips on the
// related-books shelf read the same way as the detail page.
function formatBookReviewGenre(genre) {
    const g = String(genre || '').toLowerCase();
    const map = {
        'astronomy': 'Astronomy', 'biology': 'Biology', 'chemistry': 'Chemistry',
        'computer-science': 'Computer Science', 'physics': 'Physics',
        'mathematics': 'Mathematics', 'climate': 'Climate', 'memoir': 'Memoir',
        'stem': 'STEM',
    };
    return map[g] || '';
}

function mountBookReviewCoverFallback(container) {
    const img = container.querySelector('.brx-cover-img');
    if (!img) return;
    const uploadedCover = img.dataset.fallbackSrc || ARTICLE_FALLBACK_IMAGE;
    // Cascade through every cover source we know about, in priority order.
    // Each entry is tried at most once; on the final placeholder we stop
    // and mark the image as failed so CSS can show a neutral background.
    const cascade = [];
    if (uploadedCover && uploadedCover !== ARTICLE_FALLBACK_IMAGE) {
        cascade.push(uploadedCover);
    }
    cascade.push(ARTICLE_FALLBACK_IMAGE);

    const tried = new Set();
    const advance = () => {
        while (cascade.length) {
            const next = cascade.shift();
            if (!next || tried.has(next)) continue;
            tried.add(next);
            // Same src as what's already on the element means we'd just
            // re-trigger the same error handler — skip and try the next one.
            if (next === img.getAttribute('src')) continue;
            img.src = next;
            if (next === ARTICLE_FALLBACK_IMAGE) img.classList.add('failed');
            return true;
        }
        img.classList.add('failed');
        return false;
    };
    const markLoadedOrFallback = () => {
        // Open Library's default=false can still yield a tiny placeholder in
        // some edge cases. Treat that as "no ISBN cover" and fall back to the
        // uploaded/admin cover.
        if (img.naturalWidth <= 1 || img.naturalHeight <= 1) {
            advance();
            return;
        }
        img.classList.remove('failed');
        img.classList.add('loaded');
    };
    img.addEventListener('load', markLoadedOrFallback);
    img.addEventListener('error', advance);
    // Track the initial src so we don't re-pick it as a fallback step.
    tried.add(img.getAttribute('src'));
    if (img.complete) markLoadedOrFallback();
}

// Promote standalone quoted paragraphs in a review body into <blockquote>
// pullquotes so they get the editorial quote treatment automatically.
// A paragraph qualifies when its full visible text (after trimming) starts
// AND ends with a quotation mark — straight, smart, or guillemet.
//
// We use DOMParser so the transformation operates on actual nodes rather
// than fragile string regex (the content is already-rendered HTML by the
// time this runs, so we can trust DOM semantics).
function promotePullquotes(html) {
    if (!html || typeof html !== 'string') return html;
    if (typeof DOMParser === 'undefined') return html;
    const OPEN_Q  = /^["“”«]/;
    const CLOSE_Q = /["“”»]$/;
    try {
        const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
        const root = doc.body.firstChild;
        if (!root) return html;
        root.querySelectorAll('p').forEach((p) => {
            // Only promote plain quoted lines — leave anything that contains
            // links, images, or inline formatting alone so we don't strip
            // intent from a thoughtfully formatted paragraph.
            if (p.querySelector('a, img, strong, em, br, code')) return;
            const text = (p.textContent || '').trim();
            if (text.length < 12) return;
            if (!OPEN_Q.test(text) || !CLOSE_Q.test(text)) return;
            const stripped = text.replace(/^["“”«]\s*/, '').replace(/\s*["“”»]$/, '');
            const bq = doc.createElement('blockquote');
            bq.textContent = stripped;
            p.replaceWith(bq);
        });
        return root.innerHTML;
    } catch {
        return html;
    }
}

// Pick the best initial cover URL for the book-review template.
// Priority: ISBN-derived cover first (Open Library instantly, upgraded to
// Google Books after paint) > uploaded/admin cover > generic fallback.
function getBookReviewCover(article) {
    if (article.isbn) {
        const u = openLibraryCoverUrl(article.isbn, 'L');
        if (u) return u;
    }
    const uploaded = getUploadedReviewCover(article);
    if (uploaded) return uploaded;
    return ARTICLE_FALLBACK_IMAGE;
}

function getUploadedReviewCover(article) {
    const candidate = article.image || article.coverImage || '';
    if (candidate && candidate !== ARTICLE_FALLBACK_IMAGE) return candidate;
    return ARTICLE_FALLBACK_IMAGE;
}

// Render a star strip for a 0–5 (half-step) rating. Pure SVG-as-data-uri
// would work too; inline-SVG is just easier to style.
function renderStars(rating) {
    if (rating == null) return '';
    const out = [];
    for (let i = 1; i <= 5; i++) {
        const fill = Math.min(Math.max(rating - (i - 1), 0), 1); // 0, 0.5, or 1
        out.push(`<span class="brx-star" style="--fill:${fill};">
            <svg viewBox="0 0 24 24" aria-hidden="true">
                <defs><linearGradient id="brx-g${i}" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="${fill * 100}%" stop-color="currentColor"/>
                    <stop offset="${fill * 100}%" stop-color="currentColor" stop-opacity="0.18"/>
                </linearGradient></defs>
                <polygon fill="url(#brx-g${i})"
                    points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
            </svg>
        </span>`);
    }
    return out.join('');
}

// Article games: an admin can attach either a Doodle Jump or a Flappy
// knowledge game to a story (stories/{id}.game). Both variants share the
// question/rescue mechanics and the iframe-host bridge; only the visual
// game and template differ. The `game.kind` field selects the variant —
// missing/unknown values default to "doodle" so older saves keep working.
function mountArticleGame(container, article) {
    if (!container || !article || !article.game) return;
    const data = article.game;
    if (!Array.isArray(data.questions) || data.questions.length === 0) return;
    const kind = (data.kind || "doodle").toLowerCase();
    if (kind === "flappy") {
        mountFlappyGame(container, article);
    } else {
        mountDoodleGame(container, article);
    }
}

// Append the Catalyst Doodle Jump knowledge game below the article body when
// an admin has attached a game to this story (stories/{id}.game). Renders into
// a sandboxed iframe at the very end of .article-body-wrap so the share row
// stays inline with the body, and the game gets its own roomy section.
async function mountDoodleGame(container, article) {
    if (!container || !article || !article.game) return;
    const data = article.game;
    if (!Array.isArray(data.questions) || data.questions.length === 0) return;

    const wrapEl = container.querySelector('.article-body-wrap');
    if (!wrapEl) return;

    // Avoid double-mounting on hot re-renders.
    if (wrapEl.querySelector('.article-doodle-game')) return;

    try {
        const tmpl = await loadDoodleTemplate();
        const html = renderDoodleGameHtml(tmpl, data, article.id);
        const section = document.createElement('section');
        section.className = 'article-doodle-game';
        section.setAttribute('aria-label', 'Article knowledge game');
        section.innerHTML = `
            <div class="article-doodle-game__lead">
                <span class="article-doodle-game__eyebrow">Test what you read</span>
                <h2 class="article-doodle-game__title">${escapeHtmlAttr(data.title || 'Knowledge climb')}</h2>
                <p class="article-doodle-game__intro">${escapeHtmlAttr(data.intro || 'Bounce as high as you can — gold platforms ask one question at a time. Three correct answers and you’re a Catalyst.')}</p>
            </div>
        `;
        const iframe = createArticleGameIframe({
            title: data.title || 'Catalyst Doodle Jump',
            allow: 'accelerometer; gyroscope; fullscreen',
            html
        });
        section.appendChild(createArticleGameFrameWrap(section, iframe));

        // Insert ABOVE the byline so the reader sees the game right after
        // the article body, before the author card and share row.
        const byline = wrapEl.querySelector('.article-byline');
        if (byline) {
            wrapEl.insertBefore(section, byline);
        } else {
            wrapEl.appendChild(section);
        }

        // Listen for size + scroll-lock messages from the game iframe so
        // (a) the iframe always shows the entire game without clipping, and
        // (b) wheel/touch events inside the canvas don't bubble out to the
        //     host page while the player is actively climbing.
        attachDoodleHostBridge(iframe);
    } catch (err) {
        console.warn('Could not mount doodle knowledge game', err);
    }
}

// Wires a single doodle-game iframe to its host page. The iframe only sends
// height updates now — we deliberately do NOT lock host scroll while the
// game is active, so the reader can keep scrolling the article past the
// game with mouse wheel, trackpad, or touch even mid-play.
function attachDoodleHostBridge(iframe) {
    function onMessage(e) {
        if (!e.data || e.source !== iframe.contentWindow) return;
        if (e.data.type === 'doodle:height') {
            // Lower bound 360 — well under any real game height — so the
            // iframe never pads trailing whitespace below the content. The
            // template's reportHeight measures .stage tightly, so we trust
            // its number directly. Upper bound stays at 1300 as a safety.
            const h = Math.max(360, Math.min(1300, Number(e.data.height) || 0));
            if (h) iframe.style.height = h + 'px';
        }
    }
    window.addEventListener('message', onMessage);
}

function createArticleGameIframe({ title, allow, html }) {
    const iframe = document.createElement('iframe');
    iframe.className = 'article-doodle-frame';
    iframe.title = title;
    iframe.loading = 'lazy';
    iframe.setAttribute('allow', allow);
    iframe.setAttribute('scrolling', 'no');
    iframe.srcdoc = html;
    return iframe;
}

function createArticleGameFrameWrap(section, iframe) {
    const frameWrap = document.createElement('div');
    frameWrap.className = 'article-doodle-game__frame-wrap';

    const expandBtn = document.createElement('button');
    expandBtn.className = 'article-doodle-game__expand-btn';
    expandBtn.type = 'button';
    expandBtn.setAttribute('aria-expanded', 'false');
    expandBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M8 3H3v5"></path>
            <path d="M3 3l7 7"></path>
            <path d="M16 3h5v5"></path>
            <path d="M21 3l-7 7"></path>
            <path d="M8 21H3v-5"></path>
            <path d="M3 21l7-7"></path>
            <path d="M16 21h5v-5"></path>
            <path d="M21 21l-7-7"></path>
        </svg>
        <span>Full screen</span>
    `;

    const label = expandBtn.querySelector('span');
    function setExpanded(expanded) {
        section.classList.toggle('is-expanded', expanded);
        document.body.classList.toggle('has-doodle-expanded', expanded);
        expandBtn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        if (label) label.textContent = expanded ? 'Close' : 'Full screen';
        iframe.contentWindow?.postMessage({ type: 'doodle:expanded', expanded }, '*');
    }

    expandBtn.addEventListener('click', () => {
        setExpanded(!section.classList.contains('is-expanded'));
    });

    frameWrap.addEventListener('click', (event) => {
        if (section.classList.contains('is-expanded') && event.target === frameWrap) {
            setExpanded(false);
        }
    });

    window.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && section.classList.contains('is-expanded')) {
            setExpanded(false);
        }
    });

    frameWrap.appendChild(iframe);
    frameWrap.appendChild(expandBtn);
    return frameWrap;
}

const ARTICLE_GAME_ASSET_VERSION = '20260428-games-6';

function gameAssetUrl(path) {
    return window.location.origin + path + '?v=' + encodeURIComponent(ARTICLE_GAME_ASSET_VERSION);
}

let doodleTemplatePromise = null;
function loadDoodleTemplate() {
    if (!doodleTemplatePromise) {
        // Cache-bust by date so a deploy immediately invalidates the
        // previously-cached template; otherwise force-cache + the static URL
        // can hold a stale copy in the reader's browser indefinitely.
        const bust = 'v=' + (window.__DOODLE_TEMPLATE_VERSION__ || ARTICLE_GAME_ASSET_VERSION);
        doodleTemplatePromise = fetch('/posts/games/_doodle_template.html?' + bust, { cache: 'reload' })
            .then((res) => {
                if (!res.ok) throw new Error('doodle template ' + res.status);
                return res.text();
            })
            .catch((err) => {
                doodleTemplatePromise = null;
                throw err;
            });
    }
    return doodleTemplatePromise;
}

function renderDoodleGameHtml(template, data, articleId) {
    const title = data.title || 'Knowledge climb';
    const intro = data.intro || 'Climb high — answer the gold-platform questions to earn power-ups.';
    return renderGameTemplate(template, data, {
        title,
        intro,
        characterUrl: gameAssetUrl('/doodlecharacter.png'),
        articleId: articleId || ''
    });
}

// ----- Flappy variant -------------------------------------------------------
// Same iframe + bridge plumbing as the doodle game; just a different
// template + sprite asset.
async function mountFlappyGame(container, article) {
    if (!container || !article || !article.game) return;
    const data = article.game;
    if (!Array.isArray(data.questions) || data.questions.length === 0) return;
    const wrapEl = container.querySelector('.article-body-wrap');
    if (!wrapEl) return;
    if (wrapEl.querySelector('.article-doodle-game')) return;
    try {
        const tmpl = await loadFlappyTemplate();
        const html = renderFlappyGameHtml(tmpl, data, article.id);
        const section = document.createElement('section');
        // Reuse the doodle CSS class so the eyebrow/title/intro layout
        // matches without forking styles.
        section.className = 'article-doodle-game';
        section.setAttribute('aria-label', 'Article knowledge game');
        section.innerHTML = `
            <div class="article-doodle-game__lead">
                <span class="article-doodle-game__eyebrow">Test what you read</span>
                <h2 class="article-doodle-game__title">${escapeHtmlAttr(data.title || 'Flappy Catalyst')}</h2>
                <p class="article-doodle-game__intro">${escapeHtmlAttr(data.intro || 'Flap with space or tap. Pass pipes to score, gold pipes ask questions, crash and answer one to keep flying.')}</p>
            </div>
        `;
        const iframe = createArticleGameIframe({
            title: data.title || 'Flappy Catalyst',
            allow: 'fullscreen',
            html
        });
        section.appendChild(createArticleGameFrameWrap(section, iframe));
        const byline = wrapEl.querySelector('.article-byline');
        if (byline) wrapEl.insertBefore(section, byline);
        else wrapEl.appendChild(section);
        attachDoodleHostBridge(iframe);
    } catch (err) {
        console.warn('Could not mount flappy knowledge game', err);
    }
}

let flappyTemplatePromise = null;
function loadFlappyTemplate() {
    if (!flappyTemplatePromise) {
        const bust = 'v=' + (window.__FLAPPY_TEMPLATE_VERSION__ || ARTICLE_GAME_ASSET_VERSION);
        flappyTemplatePromise = fetch('/posts/games/_flappy_template.html?' + bust, { cache: 'reload' })
            .then((res) => {
                if (!res.ok) throw new Error('flappy template ' + res.status);
                return res.text();
            })
            .catch((err) => {
                flappyTemplatePromise = null;
                throw err;
            });
    }
    return flappyTemplatePromise;
}

function renderFlappyGameHtml(template, data, articleId) {
    const title = data.title || 'Flappy Catalyst';
    const intro = data.intro || 'Pass pipes to score. The gold pipe asks a question.';
    return renderGameTemplate(template, data, {
        title,
        intro,
        characterUrl: gameAssetUrl('/flappybird.png'),
        articleId: articleId || ''
    });
}

// Shared template renderer — both game variants share the same marker layout
// so a single helper handles questions sanitization + JS injection.
function renderGameTemplate(template, data, opts) {
    // Pass all questions (up to 10) — the game shuffles and picks 3 per run.
    const questions = (data.questions || []).map((q) => {
        const optsRaw = Array.isArray(q.options) ? q.options : [];
        const options = optsRaw.map(o => typeof o === 'string' ? o : (o?.text || ''));
        const correct = Math.max(0, Math.min(Number(q.correct ?? 0), options.length - 1));
        return {
            prompt: q.prompt || q.q || '',
            options,
            correct,
            feedbackCorrect: q.feedbackCorrect || '',
            feedbackIncorrect: q.feedbackIncorrect || ''
        };
    });
    const payload = {
        questions,
        characterUrl: opts.characterUrl,
        articleId: opts.articleId || ''
    };
    // Defensively escape any literal "</script>" the AI might have written into
    // a question — it'd otherwise prematurely close the inline <script> tag.
    const safeJson = JSON.stringify(payload).replace(/<\/script>/gi, '<\\/script>');
    return template
        .replace(/__GAME_TITLE__/g, escapeHtmlAttr(opts.title))
        .replace(/__GAME_INTRO__/g, escapeHtmlAttr(opts.intro))
        .replace(/\/\*__GAME_DATA__\*\/\{[\s\S]*?\}\s*;/, safeJson + ';');
}

// Replace any quiz figures the writer dropped into the article body with the
// retro-arcade quiz mini-game. The figure carries the writer-authored quiz
// data on a data-quiz attribute (base64-encoded JSON written by
// js/dashboard/writer.js); we materialize the game by loading the template at
// posts/games/_template.html, substituting the quiz data, and embedding the
// result into a sandboxed iframe at the figure's position.
function hydrateQuizzes(container) {
    if (!container) return;
    const figures = container.querySelectorAll('figure.rt-quiz[data-quiz]');
    if (!figures.length) return;
    figures.forEach(async (figure) => {
        const data = decodeQuizFigure(figure);
        if (!data || !Array.isArray(data.questions) || !data.questions.length) return;
        try {
            const tmpl = await loadQuizTemplate();
            const html = renderQuizGameHtml(tmpl, data);
            const wrap = document.createElement('div');
            wrap.className = 'article-block article-quiz';
            const iframe = document.createElement('iframe');
            iframe.className = 'article-quiz-frame';
            iframe.title = data.title || 'Interactive quiz';
            iframe.loading = 'lazy';
            iframe.setAttribute('allow', 'fullscreen');
            iframe.srcdoc = html;
            wrap.appendChild(iframe);
            figure.replaceWith(wrap);
        } catch (err) {
            console.warn('Could not load quiz game template', err);
        }
    });
}

function decodeQuizFigure(figure) {
    const raw = figure.getAttribute('data-quiz') || '';
    if (!raw) return null;
    try {
        const json = decodeURIComponent(escape(atob(raw)));
        return JSON.parse(json);
    } catch (err) {
        console.warn('Could not decode quiz data', err);
        return null;
    }
}

let quizTemplatePromise = null;
function loadQuizTemplate() {
    if (!quizTemplatePromise) {
        quizTemplatePromise = fetch('/posts/games/_template.html', { cache: 'force-cache' })
            .then((res) => {
                if (!res.ok) throw new Error('quiz template ' + res.status);
                return res.text();
            })
            .catch((err) => {
                // Reset so a later reader can retry after a transient failure.
                quizTemplatePromise = null;
                throw err;
            });
    }
    return quizTemplatePromise;
}

// Substitute the writer's quiz data into the game template. Three placeholders:
// __GAME_TITLE__ (page title + visible heading), __GAME_INTRO__ (instruction
// line above the canvas), and the comment-marked Q array assignment.
function renderQuizGameHtml(template, data) {
    const title = data.title || 'Knowledge quiz';
    const intro = data.intro || 'Test your knowledge of the article.';
    // Build the Q array in the shape the game engine expects, rotating power-up
    // types so each question grants a different ability.
    const powers = ['double', 'fire', 'both'];
    const questions = data.questions.map((q, i) => {
        const correctIdx = Math.max(0, Math.min(q.correct, q.options.length - 1));
        return {
            qID: i,
            q: q.prompt,
            options: q.options.map((text, oi) => ({ text, correct: oi === correctIdx })),
            feedbackCorrect: q.feedbackCorrect || '✅ Correct!',
            feedbackIncorrect: q.feedbackIncorrect || '❌ Not quite — give it another look.',
            power: powers[i % powers.length],
        };
    });
    const json = JSON.stringify(questions, null, 2);
    return template
        .replace(/__GAME_TITLE__/g, escapeHtmlAttr(title))
        .replace(/__GAME_INTRO__/g, escapeHtmlAttr(intro))
        .replace('/*__QUESTIONS_JSON__*/[]', json);
}

// Minimal HTML-attribute-safe escape; article.content may contain trusted HTML.
function escapeHtmlAttr(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

// Reading-progress bar — height of window / scroll position.
function mountReadingProgress() {
    if (document.getElementById('reading-progress')) return;
    const bar = document.createElement('div');
    bar.id = 'reading-progress';
    bar.className = 'reading-progress';
    bar.innerHTML = `
        <div class="reading-progress__track"><div class="reading-progress__fill"></div></div>
        <div class="reading-progress__pill" aria-hidden="true"><span class="reading-progress__pct">0%</span><span class="reading-progress__remaining"></span></div>
    `;
    document.body.prepend(bar);
    const fill = bar.querySelector('.reading-progress__fill');
    const pctEl = bar.querySelector('.reading-progress__pct');
    const remainingEl = bar.querySelector('.reading-progress__remaining');

    // Progress is measured against the article body, not the whole page, so
    // the bar reflects "how far through the story am I" rather than how far
    // through the footer / related articles. When the article element isn't
    // mounted yet (shouldn't happen here, but defensively) we fall back to
    // whole-document scroll.
    const getArticleRange = () => {
        const article = document.querySelector('.article-body');
        if (!article) {
            const doc = document.documentElement;
            return { start: 0, end: (doc.scrollHeight - doc.clientHeight) || 1 };
        }
        const rect = article.getBoundingClientRect();
        const scrolled = window.scrollY || window.pageYOffset || 0;
        // Reading "starts" when the top of the article meets the top of the
        // viewport, and "ends" when the bottom of the article is in view.
        const start = rect.top + scrolled - 120;
        const end = rect.bottom + scrolled - window.innerHeight + 40;
        return { start, end: Math.max(end, start + 1) };
    };

    // Estimate remaining read time from remaining word count at 220 wpm.
    let totalWords = 0;
    const recomputeWords = () => {
        const article = document.querySelector('.article-body');
        totalWords = article ? (article.textContent || '').trim().split(/\s+/).filter(Boolean).length : 0;
    };
    recomputeWords();

    const update = () => {
        const { start, end } = getArticleRange();
        const scrolled = window.scrollY || window.pageYOffset || 0;
        const pct = Math.min(100, Math.max(0, ((scrolled - start) / (end - start)) * 100));
        // The progress rail is now vertical (left edge of the viewport)
        // so we drive the fill via height. We also still set width: 100%
        // for graceful-degradation against any older CSS that expects a
        // horizontal bar.
        fill.style.height = pct + '%';
        fill.style.width = '100%';
        pctEl.textContent = Math.round(pct) + '%';
        // Reveal the pill as soon as the reader starts scrolling the article.
        bar.classList.toggle('is-active', scrolled > 40);
        bar.classList.toggle('is-complete', pct >= 99);
        if (totalWords > 0) {
            const remainingWords = Math.max(0, totalWords * (1 - pct / 100));
            const mins = Math.max(0, Math.round(remainingWords / 220));
            remainingEl.textContent = pct >= 99 ? 'Finished' : (mins <= 0 ? 'Almost done' : `${mins} min left`);
        } else {
            remainingEl.textContent = '';
        }
    };
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', () => { recomputeWords(); update(); });
    // Content may hydrate (images loading, quizzes embedding) after we mount,
    // which shifts the article height — recompute a few times.
    setTimeout(() => { recomputeWords(); update(); }, 500);
    setTimeout(() => { recomputeWords(); update(); }, 2000);
    update();
}

// Copy link helper used by the share row.
window.copyArticleLink = function () {
    const url = window.location.href;
    (navigator.clipboard && navigator.clipboard.writeText)
        ? navigator.clipboard.writeText(url).then(() => {
            showNotification?.('Link copied!', 'success');
          })
        : (() => { const i = document.createElement('input'); i.value = url; document.body.appendChild(i); i.select(); document.execCommand('copy'); i.remove(); })();
};

function renderRelatedArticles(currentArticle, data = articleData) {
    const container = document.getElementById('related-articles');
    if (!container || !Array.isArray(data)) return;

    // Get 3 random articles from the same category, excluding current
    const related = data
        .filter(a => a.id !== currentArticle.id && a.category === currentArticle.category)
        .sort(() => Math.random() - 0.5)
        .slice(0, 3);

    // If not enough from same category, fill with random articles
    if (related.length < 3) {
        const additional = data
            .filter(a => a.id !== currentArticle.id && !related.includes(a))
            .sort(() => Math.random() - 0.5)
            .slice(0, 3 - related.length);
        related.push(...additional);
    }

    container.innerHTML = related.map(article => createArticleCard(article)).join('');

    registerFadeIn(container);
    registerProgressiveImages(container);
}

function viewArticle(linkOrId) {
    if (!linkOrId) return;
    const decoded = decodeURIComponent(linkOrId);
    if (decoded.startsWith('http') || decoded.startsWith('posts/')) {
        window.location.href = decoded;
    } else if (decoded.startsWith('/article/') || decoded.startsWith('/book-review/')) {
        window.location.href = decoded;
    } else {
        // Legacy id — find the article and navigate by slug. Use
        // getArticleLink so book reviews route to /book-review/<slug>.
        const article = articleData.find(a => String(a.id) === String(decoded));
        if (article) {
            window.location.href = getArticleLink(article);
        } else {
            window.location.href = `/article/${encodeURIComponent(decoded)}`;
        }
    }
}

// ============================================
// UTILITIES
// ============================================
function formatCategory(category) {
    const map = {
        'feature': 'Feature',
        'profile': 'Profile',
        'interview': 'Interview',
        'op-ed': 'Op-Ed',
        'oped': 'Op-Ed',
        'editorial': 'Editorial',
        'article': 'Feature',
        'news': 'News',
        'science': 'Science',
        'book-review': 'Book Review',
        'bookreview': 'Book Review',
    };
    return map[category] || category.charAt(0).toUpperCase() + category.slice(1);
}

function getArticleLink(article) {
    if (!article) return '/articles';
    const slug = article.slug || titleToSlug(article.title);
    if (isBookReview(article)) {
        // Book reviews live under /book-review/<slug> so the category is
        // legible in the URL. We DON'T trust article.link here — the cached
        // record may have been built before the move, and it would still say
        // /article/<slug>. Always rebuild from the slug.
        return `/book-review/${encodeURIComponent(slug)}`;
    }
    return article.link || `/article/${encodeURIComponent(slug)}`;
}

// Same path logic as getArticleLink but exposed for callers that build
// `link` fields up front (the Firestore loader, the home / articles
// renderers). Centralizing here keeps the /article/ vs /book-review/
// decision in one place.
function buildArticlePath(slug, category) {
    const cat = String(category || '').toLowerCase().replace(/\s+/g, '-');
    const prefix = cat === 'book-review' ? '/book-review/' : '/article/';
    return `${prefix}${encodeURIComponent(slug)}`;
}

// ============================================
// DATA LOADER (fallback to /posts text if needed)
// ============================================
async function loadArticles() {
    if (window.__articleCache) return window.__articleCache;

    // Dedup by normalized title, post-URL slug, and Wix image asset ID.
    // Image-ID match catches stories where the data.js title diverged from the
    // JSON source but both entries point to the same uploaded cover image.
    const byKey = new Map();
    const slugIndex = new Map();
    const imgIndex = new Map();
    let nextId = 1;

    const tryAdd = (article) => {
        if (!article || !article.title) return;
        const titleKey = safeKey(article);
        const linkSlug = slugKey(article.link || article.url || '');
        const titleSlug = titleToSlug(article.title);
        const imgId = imageAssetId(article.image);
        if (byKey.has(titleKey)) return;
        if (linkSlug && slugIndex.has(linkSlug)) return;
        if (titleSlug && slugIndex.has(titleSlug)) return;
        if (imgId && imgIndex.has(imgId)) return;
        byKey.set(titleKey, article);
        if (linkSlug) slugIndex.set(linkSlug, titleKey);
        if (titleSlug) slugIndex.set(titleSlug, titleKey);
        if (imgId) imgIndex.set(imgId, titleKey);
    };

    // Build a title → data.js record map so JSON posts can inherit the
    // canonical /post/<slug> link (JSON files only carry metadata, not URLs).
    const baseByTitle = new Map();
    if (Array.isArray(window.articles)) {
        window.articles.forEach(raw => {
            if (!raw?.title) return;
            baseByTitle.set(raw.title.toLowerCase().trim(), raw);
        });
    }

    // Load all published stories from Firestore (includes legacy JSON articles
    // migrated to Firestore via scripts/import-json-to-firestore.js).
    try {
        const fsArticles = await loadFromFirestore();
        fsArticles.forEach(article => tryAdd(article));
    } catch (err) {
        console.warn('Firestore article load failed', err);
    }

    // Merge in articles defined in js/data.js (published via the studio)
    if (Array.isArray(window.articles)) {
        window.articles.forEach(raw => {
            if (!raw || !raw.title) return;
            const link = raw.link || raw.url || '';
            const cat = (raw.category || 'feature').toLowerCase();
            const fallbackPath = buildArticlePath(titleToSlug(raw.title), cat);
            tryAdd({
                id: raw.id || nextId++,
                title: raw.title,
                author: raw.author || 'The Catalyst',
                date: raw.date || '',
                image: raw.image || ARTICLE_FALLBACK_IMAGE,
                link: link || fallbackPath,
                url: link || fallbackPath,
                category: cat,
                tags: raw.tags || [],
                excerpt: raw.deck || raw.excerpt || '',
                deck: raw.deck || '',
                content: raw.content || ''
            });
        });
    }

    const combined = Array.from(byKey.values()).filter(a => a.title).sort((a, b) => {
        const dateA = Date.parse(a.date) || 0;
        const dateB = Date.parse(b.date) || 0;
        if (dateA !== dateB) return dateB - dateA;
        // Tiebreaker: higher source index (newer JSON file) wins.
        return (b.sourceIndex || 0) - (a.sourceIndex || 0);
    });

    window.__articleCache = combined;
    return combined;
}

// Fetch published stories from the catalystwriters-5ce43 Firestore via REST.
// Public reads of documents where status == 'published' are permitted by
// firestore.rules, so no auth token is required.
async function loadFromFirestore() {
    // Session cache: Firestore is the slowest part of startup. Within one tab
    // session the article list doesn't change, so serve the cached copy instantly.
    // Bumped to v5 when we added book-review fields (communityPick,
    // bookAuthor, rating, isbn) to the shared query projection. Old v4
    // caches don't carry those fields, which is why fresh book reviews
    // weren't appearing on /book-reviews after publish.
    const CACHE_KEY = 'catalyst_fs_cache_v6';
    try {
        const cached = sessionStorage.getItem(CACHE_KEY);
        if (cached) return JSON.parse(cached);
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
            orderBy: [
                { field: { fieldPath: 'publishedAt' }, direction: 'DESCENDING' }
            ],
            // Only fetch the fields the listing UI needs — excludes the full
            // article body which can be 50-200 KB per document. The
            // book-review-specific fields are included so /book-reviews can
            // reuse the same shared sessionStorage cache without re-fetching.
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
                    { fieldPath: 'tags' },
                    { fieldPath: 'slug' },
                    { fieldPath: 'status' },
                    { fieldPath: 'lightCover' },
                    // Book-review fields. Free to include even on non-book
                    // stories — Firestore just returns null for missing
                    // values, which the renderer ignores.
                    { fieldPath: 'communityPick' },
                    { fieldPath: 'bookAuthor' },
                    { fieldPath: 'rating' },
                    { fieldPath: 'isbn' },
                    { fieldPath: 'genre' },
                ]
            },
            limit: 60
        }
    };

    console.log('[catalyst] loadFromFirestore: POSTing to', endpoint);
    const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    console.log('[catalyst] loadFromFirestore: response status=', res.status, 'ok=', res.ok);
    if (!res.ok) {
        const errText = await res.text().catch(() => '(no body)');
        console.error('[catalyst] loadFromFirestore failed body:', errText.slice(0, 500));
        throw new Error(`Firestore ${res.status}`);
    }

    const rows = await res.json();
    console.log('[catalyst] loadFromFirestore: raw rows length=', Array.isArray(rows) ? rows.length : 'NOT-ARRAY', 'sample:', JSON.stringify(rows).slice(0, 200));
    if (!Array.isArray(rows)) return [];

    const articles = rows
        .map(row => row.document)
        .filter(Boolean)
        .map(firestoreDocToArticle)
        .filter(a => a && a.title);

    try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(articles)); } catch {}
    return articles;
}

function firestoreDocToArticle(doc) {
    const name = doc.name || '';
    const storyId = name.split('/').pop();
    const f = doc.fields || {};
    const str = k => f[k]?.stringValue ?? '';
    const arr = k => (f[k]?.arrayValue?.values || []).map(v => v.stringValue).filter(Boolean);

    const publishedRaw = f.publishedAt?.timestampValue || f.publishedAt?.stringValue || f.createdAt?.timestampValue || f.createdAt?.stringValue || '';
    let dateStr = '';
    if (publishedRaw) {
        const d = new Date(publishedRaw);
        if (!isNaN(d)) {
            dateStr = d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
        }
    }

    const title = str('title');
    if (!title) return null;

    const category = (str('category') || 'feature').toLowerCase().replace(/\s+/g, '-');
    const slug = str('slug') || titleToSlug(title);
    // Book-review submissions used to be stored under `reviewText`; the
    // newer pipeline writes them as `content`. Fall through any of the
    // three so older approved reviews still render with their full body.
    const content = str('body') || str('content') || str('reviewText');
    const deck = str('dek') || str('deck');
    const lightCover = f.lightCover?.booleanValue === true;
    const excerpt = deck || (content ? content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 220) : '');

    const rawImage = str('coverImage');
    let image = ARTICLE_FALLBACK_IMAGE;
    if (rawImage) {
        image = /^https?:\/\//i.test(rawImage)
            ? rawImage
            : `${window.location.origin}/${rawImage.replace(/^\/+/, '')}`;
    }

    // Optional admin-attached Doodle Jump knowledge game. The dashboard
    // "Games" tab writes a stories/{id}.game map of { questions, title, intro }.
    const game = decodeFirestoreGame(f.game);

    // Book-review-specific fields (only populated when category === 'book-review').
    // Captured here so the article-detail renderer can branch into the
    // dedicated book-review template without re-fetching.
    const bookAuthor    = str('bookAuthor');
    const isbn          = str('isbn');
    const genre         = str('genre');
    const communityPick = f.communityPick?.booleanValue === true;
    const ratingRaw     = f.rating;
    let rating = null;
    if (ratingRaw) {
        if ('doubleValue'  in ratingRaw) rating = Number(ratingRaw.doubleValue);
        else if ('integerValue' in ratingRaw) rating = parseInt(ratingRaw.integerValue, 10);
    }

    return {
        id: storyId,
        title,
        author: str('authorName') || str('author') || 'The Catalyst',
        date: dateStr,
        image,
        slug,
        link: buildArticlePath(slug, category),
        url: buildArticlePath(slug, category),
        category,
        tags: arr('tags'),
        excerpt,
        deck,
        content,
        lightCover,
        game,
        // Book-review extras (undefined / null for other categories)
        bookAuthor,
        isbn,
        genre,
        rating,
        communityPick
    };
}

// Decode the `stories/{id}.game` Firestore map into the shape the doodle
// template expects. Returns null if the field is missing or malformed.
function decodeFirestoreGame(field) {
    if (!field) return null;
    const map = field.mapValue?.fields;
    if (!map) return null;
    const str = k => map[k]?.stringValue ?? '';
    const questionsRaw = map.questions?.arrayValue?.values || [];
    const questions = questionsRaw.map((q) => {
        const qf = q?.mapValue?.fields;
        if (!qf) return null;
        const prompt = qf.prompt?.stringValue || qf.q?.stringValue || '';
        const options = (qf.options?.arrayValue?.values || [])
            .map(v => v.stringValue || '')
            .filter(s => s.length);
        const correct = Number(qf.correct?.integerValue ?? qf.correct?.doubleValue ?? -1);
        if (!prompt || options.length < 2 || correct < 0 || correct >= options.length) return null;
        return {
            prompt,
            options,
            correct,
            feedbackCorrect: qf.feedbackCorrect?.stringValue || '',
            feedbackIncorrect: qf.feedbackIncorrect?.stringValue || ''
        };
    }).filter(Boolean);
    if (!questions.length) return null;
    // `kind` selects the game variant on the article page — "flappy" or
    // "doodle" (default). Older saves don't have this field, so the
    // dispatcher in mountArticleGame falls back to doodle.
    const kindRaw = (str('kind') || '').toLowerCase();
    const kind = kindRaw === 'flappy' ? 'flappy' : 'doodle';
    return {
        kind,
        title: str('title') || 'Test your knowledge',
        intro: str('intro') || 'Climb to the top — answer correctly to power up.',
        questions
    };
}

function buildExcerptFromBlocks(blocks = []) {
    const firstPara = (blocks || []).find(b => (b.type || '').toLowerCase().includes('paragraph'));
    if (!firstPara?.content) return '';
    return firstPara.content.replace(/\s+/g, ' ').slice(0, 220).trim();
}

function paragraphize(raw) {
    const blocks = raw.split(/\n\s*\n/).map(b => b.trim()).filter(Boolean);
    return blocks.map(p => `<p>${p}</p>`).join('');
}

function extractTextFromRichContent(raw = '') {
    if (!raw) return '';
    try {
        const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
        const texts = [];
        const walk = (node) => {
            if (!node) return;
            if (Array.isArray(node)) {
                node.forEach(walk);
                return;
            }
            if (node.textData && node.textData.text) {
                texts.push(node.textData.text);
            }
            if (Array.isArray(node.nodes)) {
                node.nodes.forEach(walk);
            }
        };
        walk(data.nodes || data);
        return texts.join(' ').replace(/\s+/g, ' ').trim();
    } catch (err) {
        return '';
    }
}

async function loadFromCsv(path) {
    try {
        const res = await fetch(path);
        if (!res.ok) return [];
        const text = await res.text();
        return parseCsv(text);
    } catch (err) {
        console.warn('CSV fetch failed', path, err);
        return [];
    }
}

function parseCsv(text) {
    const rows = [];
    let currentField = '';
    let currentRow = [];
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ch === '"') {
            if (inQuotes && text[i + 1] === '"') {
                currentField += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (ch === ',' && !inQuotes) {
            currentRow.push(currentField);
            currentField = '';
        } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
            if (ch === '\r' && text[i + 1] === '\n') i++; // handle CRLF
            currentRow.push(currentField);
            rows.push(currentRow);
            currentRow = [];
            currentField = '';
        } else {
            currentField += ch;
        }
    }

    if (currentField.length || currentRow.length) {
        currentRow.push(currentField);
        rows.push(currentRow);
    }

    if (!rows.length) return [];

    const headers = rows.shift().map((h, idx) => normalizeHeaderName(h, idx));

    return rows
        .filter(r => r.some(cell => (cell || '').trim().length))
        .map(cols => {
            const obj = {};
            headers.forEach((h, idx) => {
                obj[h] = (cols[idx] || '').replace(/\uFEFF/g, '');
            });
            return obj;
        });
}

function normalizeHeaderName(header = '', idx = 0) {
    const cleaned = header.replace(/\uFEFF/g, '').trim();
    if (cleaned) return cleaned;
    return `__col_${idx}`;
}

function normalizeKey(key = '') {
    return key.replace(/\uFEFF/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function getField(row, key) {
    if (!row || !key) return '';
    const target = normalizeKey(key);
    for (const candidate of Object.keys(row)) {
        if (normalizeKey(candidate) === target) {
            return row[candidate];
        }
    }
    return '';
}

function normalizeWixImage(raw) {
    if (!raw) return '';
    const val = raw.trim();
    // Example: wix:image://v1/11b1c4_abc~mv2.jpg/xyz#originWidth=...
    const match = val.match(/wix:image:\/\/v1\/([^#]+?)(?:\/|#|$)/);
    if (match) {
        return `https://static.wixstatic.com/media/${match[1]}`;
    }
    return val;
}

function stripHtml(str = '') {
    return str.replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
}

function parseAuthor(row) {
    const nameDateRaw = getField(row, 'Name, Date');
    const strongMatch = nameDateRaw.match(/<strong[^>]*>([^<]+)<\/strong>/i);
    if (strongMatch) return strongMatch[1].trim();

    const fromNameDate = stripHtml(nameDateRaw);
    if (fromNameDate) {
        const parts = fromNameDate.split(/\s{2,}/);
        if (parts.length && parts[0].trim()) return parts[0].trim();
    }

    const authorField = getField(row, 'Author');
    if (authorField && !/^[0-9a-f-]{8,}$/i.test(authorField.trim())) return authorField.trim();
    return 'The Catalyst';
}

function parseDate(row) {
    const nameDate = stripHtml(getField(row, 'Name, Date'));
    const dateMatch = nameDate.match(/([A-Za-z]{3,9}\s+\d{1,2},\s*\d{4})/);
    if (dateMatch) return dateMatch[1];

    const published = getField(row, 'Published Date') || getField(row, 'Last Published Date') || '';
    const d = published ? new Date(published) : null;
    if (d && !isNaN(d.getTime())) {
        return d.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
    }
    return '';
}

function normalizeCategory(cat = '') {
    const val = cat.toLowerCase().replace(/\s+/g, '-');
    if (['feature', 'profile', 'interview', 'op-ed', 'editorial', 'book-review', 'news', 'science'].includes(val)) return val;
    return 'feature';
}

// Book reviews live on their own page (/book-reviews). They must not bleed
// into the homepage hero/featured grids or the Articles index.
function isBookReview(article) {
    if (!article) return false;
    const cat = String(article.category || '').toLowerCase().replace(/\s+/g, '-');
    return cat === 'book-review';
}

function normalizeLink(link = '') {
    if (!link) return '#';
    if (link.startsWith('http')) return link;
    if (link.startsWith('/')) return `https://www.catalyst-magazine.com${link}`;
    const slug = link.replace(/^\/+/, '');
    return `https://www.catalyst-magazine.com/post/${slug}`;
}

function safeKey(article) {
    return (article.title || '')
        .toLowerCase()
        .replace(/[’']/g, "'")
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

// Extract the post slug from a canonical catalyst-magazine.com/post/<slug> URL
// so articles baked into data.js with long aliased slugs dedupe against the
// JSON source when they point to the same Wix post.
function slugKey(link = '') {
    if (!link) return '';
    const match = String(link).match(/\/post\/([^/?#]+)/i);
    return match ? match[1].toLowerCase() : '';
}

// Derive a Wix-style post slug from a title so JSON articles (which carry no
// link) still dedupe against data.js entries whose link slug matches.
function titleToSlug(title = '') {
    return String(title)
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[\u2018\u2019’]/g, '')
        .replace(/&/g, ' and ')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

// Legacy slug form — see titleToLegacySlug() in functions/_utils/article-meta.js.
// Same shape minus the NFKD diacritic-strip, so non-ASCII letters become "-".
// Used as a fallback match when resolving slugs from URLs that pre-date the
// NFKD normalization (e.g. "g-del-escher-bach…" for "Gödel, Escher, Bach…").
function titleToLegacySlug(title = '') {
    return String(title)
        .toLowerCase()
        .replace(/[‘’’]/g, '')
        .replace(/&/g, ' and ')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

// Extract the Wix static asset ID (e.g. 11b1c4_9737d25c5ad74ba7...~mv2.jpeg)
// from a cover image URL. Two articles sharing this ID are the same story
// even if their titles or link slugs have diverged.
function imageAssetId(image = '') {
    if (!image) return '';
    const match = String(image).match(/([a-f0-9_]+~mv2\.[a-z]+)/i);
    return match ? match[1].toLowerCase() : '';
}

async function loadFromJsonPosts(start = 1, end = 100, baseByTitle = new Map()) {
    const articles = [];
    const indexes = [];
    for (let i = start; i <= end; i++) {
        indexes.push(i);
    }

    // Fetch in small batches to avoid waterfall latency
    const batchSize = 10;
    let emptyBatches = 0;
    for (let i = 0; i < indexes.length; i += batchSize) {
        const chunk = indexes.slice(i, i + batchSize);
        const chunkResults = await Promise.all(chunk.map(idx => fetchJsonArticle(idx, baseByTitle)));
        chunkResults.forEach(list => {
            list.forEach(article => articles.push(article));
        });

        const addedThisBatch = chunkResults.reduce((sum, list) => sum + list.length, 0);
        if (addedThisBatch === 0) {
            emptyBatches += 1;
        } else {
            emptyBatches = 0;
        }

        // After several empty batches, stop requesting higher indexes
        if (emptyBatches >= 3 && articles.length) {
            break;
        }
    }

    return articles;
}

async function fetchJsonArticle(index, baseByTitle) {
    try {
        const res = await fetch(`posts/article${index}.json`);
        if (!res.ok) return [];

        // Cloudflare Pages may return HTML for missing files (200 + html).
        const ct = res.headers.get('content-type') || '';
        if (ct.includes('text/html')) return [];

        const text = (await res.text()).replace(/^\uFEFF/, '').trim();
        if (!text || text.startsWith('<!')) return [];

        const parsedList = parsePossiblyStackedJson(text);
        return parsedList
            .map(data => convertJsonToArticle(data, baseByTitle))
            .filter(Boolean)
            .map(article => ({ ...article, sourceIndex: index }));
    } catch (err) {
        console.warn('Unable to load JSON article', index, err);
        return [];
    }
}

function parsePossiblyStackedJson(text = '') {
    const cleaned = text.trim();
    if (!cleaned) return [];

    try {
        const parsed = JSON.parse(cleaned);
        return Array.isArray(parsed) ? parsed : [parsed];
    } catch (err) {
        try {
            const normalized = `[${cleaned.replace(/}\s*{/g, '},{')}]`;
            const parsed = JSON.parse(normalized);
            return Array.isArray(parsed) ? parsed : [parsed];
        } catch (error) {
            console.warn('Failed to parse JSON', error);
            return [];
        }
    }
}

function convertJsonToArticle(data = {}, baseByTitle = new Map()) {
    const meta = data.article_data?.metadata || {};
    const blocks = Array.isArray(data.article_data?.content_blocks) ? data.article_data.content_blocks : [];
    const title = (meta.title || '').trim();
    if (!title) return null;

    const titleKey = title.toLowerCase().trim();
    const baseMatch = baseByTitle.get(titleKey);
    const author = (meta.author || '').trim() || baseMatch?.author || 'The Catalyst';
    const date = formatJsonDate(meta.publish_date) || baseMatch?.date || '';
    const cover = meta.cover_image_url || baseMatch?.image || ARTICLE_FALLBACK_IMAGE;
    const excerpt = (meta.excerpt || buildExcerptFromBlocks(blocks) || baseMatch?.excerpt || '').trim();
    const category = normalizeCategory(meta.category || baseMatch?.category || guessCategoryFromTitle(title));
    const content = blocks?.length ? renderContentBlocks(blocks) : (baseMatch?.content || '');
    const link = baseMatch?.link || `/article/${encodeURIComponent(titleToSlug(title))}`;
    const readingTime = estimateReadingTime({ content, excerpt });

    // Image display settings (optional)
    // image_position: CSS object-position, e.g., "center top", "50% 30%", "left center"
    // image_zoom: scale factor, e.g., 1.0 (default), 1.2 (20% bigger), 0.8 (20% smaller)
    // image_offset_x: horizontal offset in pixels, e.g., 10, -20
    // image_offset_y: vertical offset in pixels, e.g., 10, -20
    const imageSettings = {
        position: meta.image_position || null,
        zoom: meta.image_zoom || null,
        offsetX: meta.image_offset_x || null,
        offsetY: meta.image_offset_y || null
    };

    return {
        title,
        author,
        date,
        image: cover,
        imageSettings,
        link,
        category,
        excerpt,
        content,
        blocks,
        readingTime
    };
}

function renderContentBlocks(blocks = []) {
    if (!Array.isArray(blocks) || !blocks.length) return '';
    const sorted = [...blocks].sort((a, b) => (a.order || 0) - (b.order || 0));

    return sorted.map(block => {
        const type = (block.type || '').toLowerCase();
        const content = block.content || '';
        switch (type) {
            case 'section_header':
            case 'section_header_or_caption':
                return `<h2 class="article-block section-header">${content}</h2>`;
            case 'section_sub_header':
                return `<h3 class="article-block section-subheader">${content}</h3>`;
            case 'pull_quote':
                return `<blockquote class="article-block pull-quote">${content}</blockquote>`;
            case 'image': {
                const url = block.url || '';
                const alt = block.alt_text || 'Article image';
                const caption = block.caption || '';
                if (!url) return '';
                const resized = getResizedImageUrl(url, 1200, 78);
                return `
                    <figure class="article-block article-image">
                        <img src="${resized}" alt="${alt}" loading="lazy" decoding="async">
                        ${caption ? `<figcaption class="image-caption">${caption}</figcaption>` : ''}
                    </figure>
                `;
            }
            case 'image_placeholder': {
                const alt = block.alt_text || 'Image placeholder';
                const caption = block.caption || block.note || '';
                return `
                    <figure class="article-block image-placeholder" aria-label="${alt}">
                        <div class="image-placeholder-box">
                            <span>${alt}</span>
                        </div>
                        ${caption ? `<figcaption>${caption}</figcaption>` : ''}
                    </figure>
                `;
            }
            case 'video_placeholder': {
                const caption = block.caption || block.note || '';
                return `
                    <div class="article-block video-placeholder">
                        <div class="image-placeholder-box">
                            <span>${caption || 'Video placeholder'}</span>
                        </div>
                        ${caption ? `<p class="placeholder-caption">${caption}</p>` : ''}
                    </div>
                `;
            }
            case 'embed': {
                const url = block.url || block.src || '';
                const title = block.title || block.alt_text || 'Embedded content';
                const height = block.height || 480;
                const caption = block.caption || block.note || '';
                if (!url) return '';
                return `
                    <figure class="article-block article-embed">
                        <div class="embed-frame">
                            <iframe
                                src="${url}"
                                title="${title}"
                                loading="lazy"
                                style="width: 100%; height: ${height}px; border: none; border-radius: 12px;"
                                allow="fullscreen"
                            ></iframe>
                        </div>
                        ${caption ? `<figcaption class="embed-caption">${caption}</figcaption>` : ''}
                    </figure>
                `;
            }
            case 'html': {
                const caption = block.caption || block.note || '';
                return `
                    <div class="article-block custom-html">
                        ${block.content || ''}
                        ${caption ? `<p class="html-caption">${caption}</p>` : ''}
                    </div>
                `;
            }
            case 'game': {
                const src = block.src || '';
                const title = block.title || 'Interactive Game';
                const height = block.height || '600';
                if (!src) return '';
                return `
                    <div class="article-block article-game">
                        <iframe
                            src="${src}"
                            title="${title}"
                            loading="lazy"
                            allow="fullscreen"
                            style="width: 100%; height: ${height}px; border: none;"
                        ></iframe>
                    </div>
                `;
            }
            default:
                return `<p class="article-block paragraph">${content}</p>`;
        }
    }).join('');
}

function formatJsonDate(raw = '') {
    if (!raw) return '';
    const trimmed = raw.trim();
    const hasYear = /\d{4}/.test(trimmed);
    const now = new Date();
    const fallbackYear = now.getFullYear();
    const withYear = hasYear ? trimmed : `${trimmed}, ${fallbackYear}`;
    const d = new Date(withYear);

    // If we guessed the year and the date ends up in the future, bump it to last year
    if (!hasYear && !isNaN(d.getTime()) && d.getTime() > now.getTime()) {
        d.setFullYear(fallbackYear - 1);
    }

    if (!isNaN(d.getTime())) {
        return d.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
    }
    return trimmed;
}

function guessCategoryFromTitle(title = '') {
    const normalized = title.toLowerCase();
    if (normalized.includes('interview')) return 'interview';
    if (normalized.includes('profile') || normalized.includes('journey')) return 'profile';
    if (normalized.includes('op-ed') || normalized.includes('op ed')) return 'op-ed';
    return 'feature';
}

function estimateReadingTime(article = {}) {
    const textSource = stripHtml(article.content || '') || article.excerpt || '';
    const words = textSource.split(/\s+/).filter(Boolean).length;
    const minutes = Math.max(2, Math.round(words / 225));
    return `${minutes} min read`;
}

function registerFadeIn(scope = document) {
    const elements = scope.querySelectorAll('.fade-in');
    if (!elements.length) return;
    if (fadeObserver) {
        elements.forEach(el => fadeObserver.observe(el));
    } else {
        elements.forEach(el => el.classList.add('visible'));
    }
}

// ============================================
// SEARCH FUNCTIONALITY
// ============================================
let searchData = [];

function initSearch(data) {
    searchData = data || [];
    const searchInput = document.getElementById('search-input');
    const searchClear = document.getElementById('search-clear');
    const searchResultsCount = document.getElementById('search-results-count');
    const articlesGrid = document.getElementById('home-articles-grid');

    if (!searchInput) return;

    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.trim().toLowerCase();

        if (query.length > 0) {
            searchClear.style.display = 'flex';
            performSearch(query, articlesGrid, searchResultsCount);
        } else {
            searchClear.style.display = 'none';
            searchResultsCount.style.display = 'none';
            initHomeArticles(searchData);
        }
    });

    searchClear.addEventListener('click', () => {
        searchInput.value = '';
        searchClear.style.display = 'none';
        searchResultsCount.style.display = 'none';
        initHomeArticles(searchData);
        searchInput.focus();
    });
}

function performSearch(query, gridElement, countElement) {
    if (!Array.isArray(searchData) || !gridElement) return;

    const results = searchData.filter(article => {
        const searchableText = `
            ${article.title || ''}
            ${article.author || ''}
            ${article.excerpt || ''}
            ${article.content || ''}
            ${article.category || ''}
        `.toLowerCase();

        return searchableText.includes(query);
    });

    gridElement.innerHTML = results.slice(0, 12).map(article => createArticleCard(article)).join('');

    countElement.textContent = results.length === 1
        ? `Found 1 article matching "${query}"`
        : `Found ${results.length} articles matching "${query}"`;
    countElement.style.display = 'block';

    registerFadeIn(gridElement);
    registerProgressiveImages(gridElement);
}

// ============================================
// BRAIN TEASER
// ============================================
const brainTeasers = [
    {
        question: "A doctor and a bus driver are both in love with the same woman, an attractive girl named Sarah. The bus driver had to go on a long bus trip that would last a week. Before he left, he gave Sarah seven apples. Why?",
        answer: "An apple a day keeps the doctor away!"
    },
    {
        question: "You see a boat filled with people. It has not sunk, but when you look again you don't see a single person on the boat. Why?",
        answer: "All the people on the boat are married."
    },
    {
        question: "What can you hold in your left hand but not in your right?",
        answer: "Your right elbow."
    },
    {
        question: "I speak without a mouth and hear without ears. I have no body, but I come alive with wind. What am I?",
        answer: "An echo."
    },
    {
        question: "You walk into a room with a match, a kerosene lamp, a candle, and a fireplace. Which do you light first?",
        answer: "The match."
    },
    {
        question: "The more you take, the more you leave behind. What are they?",
        answer: "Footsteps."
    }
];

function initBrainTeaser() {
    const questionElement = document.querySelector('.brain-teaser-question');
    const revealButton = document.getElementById('reveal-answer');
    const answerElement = document.getElementById('brain-teaser-answer');
    const answerContent = document.querySelector('.brain-teaser-answer-content');

    if (!questionElement || !revealButton || !answerElement) return;

    // Select random brain teaser
    const teaser = brainTeasers[Math.floor(Math.random() * brainTeasers.length)];
    questionElement.textContent = teaser.question;
    answerContent.textContent = teaser.answer;

    revealButton.addEventListener('click', () => {
        if (answerElement.style.display === 'none') {
            answerElement.style.display = 'block';
            revealButton.textContent = 'Hide Answer';
        } else {
            answerElement.style.display = 'none';
            revealButton.textContent = 'Reveal Answer';
        }
    });
}

// ============================================
// SCROLL ANIMATIONS
// ============================================
function initScrollAnimations() {
    const scrollRevealObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('revealed');
            }
        });
    }, {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    });

    // Apply scroll-reveal class to sections
    const sections = document.querySelectorAll('.section');
    sections.forEach((section, index) => {
        // Alternate between different reveal effects
        if (index % 3 === 0) {
            section.classList.add('scroll-reveal');
        } else if (index % 3 === 1) {
            section.classList.add('scroll-reveal-scale');
        } else {
            section.classList.add('scroll-reveal');
        }
        scrollRevealObserver.observe(section);
    });

    // Apply to article cards
    const articleCards = document.querySelectorAll('.article-card, .featured-story-card, .about-card');
    articleCards.forEach(card => {
        card.classList.add('scroll-reveal-scale');
        scrollRevealObserver.observe(card);
    });

    // Apply stagger effect to grids
    const grids = document.querySelectorAll('.articles-grid, .featured-stories-grid, .about-grid');
    grids.forEach(grid => {
        grid.classList.add('stagger-children');
        scrollRevealObserver.observe(grid);
    });
}

// ============================================
// ABOUT PAGE - TEAM SECTION
// ============================================
const teamMembers = [
    {
        name: "Yair Ben-Dor",
        role: "Co-Founder, Editor-in-Chief, Website Developer",
        bio: "Yair is a recent summa cum laude graduate from George Washington University with a B.S. in Cellular and Molecular Biology and a minor in Chemistry. A DMV local, Yair is passionate about using STEM as a unifying force to make research accessible and collaborative across D.C. institutions and universities. His interests lie in how STEM provides an evidence-based framework for understanding the world, turning scientific curiosity into real-world impact. He is currently applying to medical schools with the aim of becoming a physician.",
        image: "/YairCatalyst.webp",
        linkedin: "",
        email: ""
    },
    {
        name: "Aidan Schurr",
        role: "Co-Founder, Editor-in-Chief",
        bio: "Aidan is a fourth year at George Washington University pursuing a B.S. in Biomedical Engineering and Pre-Med Studies. As an engineer interested in medicine, Aidan finds his interests spanning every letter in STEM, with experience in a diverse set of research labs, from clinical Alzheimer's care to machine learning development. For Aidan, The Catalyst represents the best aspects of DC: cross-disciplinary, impact driven, and far reaching. Beyond campus, he has worked alongside policymakers, lawyers, and scientists, to utilize science communication in driving global change.",
        image: "/AidanCatalyst1.webp",
        linkedin: "",
        email: ""
    },
    {
        name: "Lori Preci",
        role: "Managing Editor, Writer",
        bio: "Lori is pursuing a masters in biotechnology at Johns Hopkins University, and is also a recent George Washington University graduate with a dual degree in Cellular and Molecular Biology and Chemistry. Her interest in STEM emerged in her sophomore year at GWU as a Biochemistry Lab research assistant, where she witnessed interdisciplinary collaboration happening behind the scenes without any public recognition. Lori views The Catalyst as a bridge between the disconnect in scientific fields, and has the goal of making research more accessible and sparking curiosity in STEM.",
        image: "/LoriCatalyst.webp",
        linkedin: "",
        email: ""
    },
    {
        name: "Dani Molloy",
        role: "Digital Strategy Lead",
        bio: "Dani is a senior at Cornell University pursuing a B.A. in Information Science with a concentration in UX and a minor in Business. She is passionate about digital storytelling, user-centered design, and the ways emerging technologies can help people discover and engage with new ideas. Her interests lie at the intersection of technology, communication, and artificial intelligence, particularly how thoughtful design can make complex information more accessible and engaging. At The Catalyst, Dani is excited to help grow the publication's reach, strengthen its online community, and connect more readers with the stories shaping the future of STEM.",
        image: "/Dani.webp",
        linkedin: "",
        email: ""
    },
    {
        name: "Le Nguyen",
        role: "Writer",
        bio: "Le is a recent George Washington University graduate with a degree in Neuroscience, a minor in Creative Writing, and summa cum laude honors. With extensive research experience spanning neurodevelopment, cardiology, and pulmonary medicine at institutions including GWU School of Medicine, Johns Hopkins, and Minneapolis Heart Institute, Le brings a unique blend of scientific rigor and narrative skill to The Catalyst. Currently in his gap year working as an IR Medical Assistant at Beth Israel Deaconess Medical Center, Le is passionate about the intersections of medicine, research, and health equity as he prepares to pursue medical school.",
        image: "/Le.webp",
        linkedin: "",
        email: ""
    },
    {
        name: "Ginger Taurek",
        role: "Writer",
        bio: "Ginger is a senior at George Washington University School of Business studying Entrepreneurship and Innovation with a minor in Sustainability. Her interests in STEM and journalism come from a passion for wildlife conservation, global sustainability, and measures to implement climate resilience and sustainable development on a global scale. Deeply interested in storytelling and science communication, Ginger strives to connect science and policy with public awareness.",
        image: "/Ginger.webp",
        linkedin: "",
        email: ""
    },
    {
        name: "Aidan Brown",
        role: "Writer",
        bio: "Aidan recently completed his B.S. in Biology at George Washington University and is now pursuing his M.S., with a concentration in Ecology, Evolution, and Environment and a minor in Geographic Information Systems. His academic interests lie at the intersection of environmental science and data analysis, with experience researching coastal ecology and tree mortality using machine learning and remote sensing. Aidan is passionate about using data to ask and answer meaningful questions about the natural world.",
        image: "/Brown.webp",
        linkedin: "",
        email: ""
    },
    {
        name: "Alexis Tamm",
        role: "Writer",
        bio: "Alexis is a recent Georgetown University graduate with a degree in English, a minor in Spanish, and magna cum laude honors. As an avid reader and writer, she is passionate about science communication and is particularly interested in bridging the gap between academic research and the general public through clear, accessible storytelling. Her writing has been published in multiple outlets, and she is always excited to apply her journalistic skillset to The Catalyst in exploring new developments in STEM and sharing them with a broader audience.",
        image: "/Alexis.webp",
        linkedin: "",
        email: ""
    },
    {
        name: "Belinda Li",
        role: "Writer",
        bio: "Belinda is a recent graduate of Georgetown University, where she majored in biology and minored in journalism. She has an interest in science writing and journalism, and she is passionate about making science more accessible to a lay audience. Her interest in science communication was shaped through her work as an intern at NASA's Goddard Space Flight Center, where she contributed to projects bridging technical advancements and public understanding. Belinda is fascinated by all areas of science, and she hopes to continue exploring and sharing about science in her future career.",
        image: "/Belinda.webp",
        linkedin: "",
        email: ""
    },
    {
        name: "Layla Abdoulaye",
        role: "Writer",
        bio: "Layla is a junior studying Physics at Howard University, with aspirations to earn a Ph.D. after graduation. Drawn to physics due to its complexity and power to explain how the world works, Layla is especially passionate about astronomy and quantum physics. Her academic interests specifically narrow on quantum materials and systems, where she hopes to contribute to cutting-edge research at the intersection of theory and discovery.",
        image: "/Layla.webp",
        linkedin: "",
        email: ""
    },
    {
        name: "Izzy Lubinsky",
        role: "Writer",
        bio: "Izzy is a George Washington University Presidential Scholar pursuing a double major in Biology and Environmental Science, with concentrations in Ecology, Evolution, and Environment and Ecological Management. At The Catalyst, she utilizes her background as an Anatomy Laboratory Technician and a meta-analysis ecological researcher to make complex biological topics accessible to a wider audience. Her interest in STEM is driven by a passion for urban ecology and climate resilience, often exploring how green infrastructure can bridge the gap between academic research and community well-being in D.C.",
        image: "/Izzy.webp",
        linkedin: "",
        email: ""
    },
    {
        name: "Skye Schurr",
        role: "Writer, Media Specialist",
        bio: "Skye is a recent Rutgers University graduate with a B.S. in Public Health, a minor in Business Administration, and a certificate in Health Policy. Over the past two summers, she has worked in Washington, D.C., contributing to research on reproductive and maternal health and authoring policy memoranda on AI in healthcare. Skye sees The Catalyst as a vehicle to increase health and civic literacy, empowering readers to understand the systems that shape their lives.",
        image: "/Skye.webp",
        linkedin: "",
        email: ""
    },
    {
        name: "Josh Shapo",
        role: "Writer",
        bio: "Josh is an electrical engineering student at the George Washington University graduating in the spring of 2027. He is involved in science advocacy and engineering policy, particularly within the space and aviation sectors. In his capacity as the Chair of IEEE-GWU and the IEEE Region 2 Student Representative, he strives to make academic and industrial STEM opportunities more accessible to students. He is currently conducting machine learning-based Heliophysics to denoise satellite magnetometry signals and aid scientific understanding of solar storms.",
        image: "/JoshShapo.webp",
        linkedin: "",
        email: ""
    },
    {
        name: "Catherine May May Hubbard",
        role: "Writer",
        bio: "May May is a recent graduate from George Washington University with a B.S. in Chemistry and minor in Music. With a background in microbiology and infectious disease research, she fell in love with experimentation and piecing together the story that the research told. Teaching is a large part of her journey in education, and in college, she has had the opportunity to share her love for science as an Undergraduate Teaching Assistant for several biology laboratory courses. At The Catalyst, she hopes to use her writing to expand access to scientific knowledge and promote STEM education within the larger DMV community.",
        image: "/maymay.webp",
        linkedin: "",
        email: ""
    },
    {
        name: "LaMyla Hill",
        role: "Writer",
        bio: "LaMyla is a rising Senior at Howard University, majoring in physics, with a concentration in astrophysics, and a minor in math. She is also a part of the College of Arts and Sciences Honors program and is a proud member of the Society of Physics Students. Ever since elementary school, LaMyla's dream career was to be a physicist, and she has been following this thread of fascination until now. After completing her bachelor's degree, she intends to enroll in graduate school to become an astrophysics researcher.",
        image: "/LaMayla.webp",
        linkedin: "",
        email: ""
    },
    {
        name: "Sienna Halstead",
        role: "Writer",
        bio: "Sienna is a neuroscience student with a minor in Mind and Brain Studies in the Philosophy Department at George Washington University. She is passionate about science communication and connecting people with educational resources that inspire curiosity, as that is how her own love of science, philosophy, and anthropology was cultivated. Her academic interests primarily focus on understanding the biology of consciousness and the complex interactions between health, culture, and the environment. Her current research at George Washington University's Department of Neuroscience focuses on the development of next-generation therapeutics through drug repurposing to address antimicrobial resistance in parasitic hookworms.",
        image: "/Sienna.webp",
        linkedin: "",
        email: ""
    },
    {
        name: "Cameron Fields",
        role: "Writer",
        bio: "Cameron is a recent graduate from Johns Hopkins University with a B.A. in Public Health Studies and a minor in Psychology. She will be beginning her Master's of Science in Public Health at the Johns Hopkins Bloomberg School of Public Health in maternal, fetal, and perinatal health. Through her research experiences in prenatal care, harm reduction, and HIV, Cameron has become passionate about interacting with community members to ensure they have resources and education about various health topics. Cameron is drawn to the community-based side of medicine and hopes to continue to share and expand on this passion through her writing with the Catalyst, research, and in the future professionally as a physician.",
        image: "/cameron.webp",
        linkedin: "",
        email: ""
    }
];

const alumniMembers = [
    {
        name: "Sydney Reiser",
        role: "Writer",
        bio: "Sydney is a Chemistry PhD student at Johns Hopkins University, having graduated summa cum laude from George Washington University with a B.S. in Chemistry. With a background in synthetic chemistry research and experience as a Physics Learning Assistant, she brings a strong analytical and pedagogical perspective to The Catalyst, aiming to make complex chemical concepts accessible and engaging for a wider audience.",
        image: "/Sydney.webp",
        linkedin: "",
        email: ""
    },
    {
        name: "Naama Ben-Dor",
        role: "Senior Writer, Editor, Media Specialist",
        bio: "Naama is a summa cum laude graduate of Georgetown University and a member of Phi Beta Kappa, where she majored in Neurobiology with minors in Chemistry and Jewish Civilization. As the creative spark behind The Catalyst Magazine, she handles digital content and outreach, all while writing some of the magazine's most unexpected and entertaining pieces. Naama is drawn to science to understand not only how the world works but why, and deeply values the relatable nature of science journalism as a mechanism to learn about STEM.",
        image: "/NaamaCatalyst.webp",
        linkedin: "",
        email: ""
    },
    {
        name: "Rachel Lee",
        role: "Photographer, Media Specialist",
        bio: "Rachel is a junior at George Washington University majoring in Communications and Business. Originally entering GWU as a pre-med student, Rachel comes from a strong STEM and biology-focused background, but her interests have shifted toward the communications field. She is passionate about making STEM topics more accessible through creative media and visual storytelling.",
        image: "/RachelLee.webp",
        linkedin: "",
        email: ""
    },
    {
        name: "Azza Uwhubetine",
        role: "Writer",
        bio: "Azza studied English with a minor in Astronomy at George Washington University. At The Catalyst, she merged her love for science, particularly physics, with the journalistic and publishing world. Azza has held positions at various publishing organizations, gaining experience in editorial writing and storytelling, and also runs a non-profit dedicated to supporting children in West African communities.",
        image: "/Azza.webp",
        linkedin: "",
        email: ""
    },
    {
        name: "Stephanie Solomon",
        role: "Former Editor",
        bio: "Stephanie is a Georgetown University junior studying History, Spanish, and World Affairs, with a strong background in journalism, policy research, and editorial work. At The Catalyst Magazine, she ensured every piece met high standards for accuracy and clarity, drawing on her experience in investigative writing, political communications, and media strategy. Her sharp editorial eye kept the magazine grounded in both integrity and impact, and she plans to translate these analytical writing skills into the legal field.",
        image: "/Steph.webp",
        linkedin: "",
        email: ""
    },
    {
        name: "Alex Carter",
        role: "Former Writer",
        bio: "Alex is a PhD student at Princeton University studying developmental biology, in addition to a recent George Washington University graduate with a B.S. in Cellular and Molecular Biology. His work at the GWU Martin Lab explored the genetic basis of evolution and adaptation, and finds the field of biology specifically interesting due to its answers to some of the world's most challenging and relevant questions. Alex excelled at making complex genetics approachable and engaging for a broad audience.",
        image: "/CarterCatalyst.webp",
        linkedin: "",
        email: ""
    }
];

/* ── Roster groups for the About page ──────────────────────────────────────
   teamMembers above is the single source of truth for every active member's
   bio/photo. The roster below references those people by name and arranges
   them into the four sections the org is structured around. A person may
   appear in more than one group (e.g. an E-Board member who also edits, or a
   graduate fellow who runs social) — we reference the same card data each
   time so bios never drift out of sync.

   Sub-groups (e.g. Editing vs. Social Media inside Staff) get an optional
   `subtitle` so the section can show a small label above that cluster. */
const rosterGroups = [
    {
        id: "eboard",
        title: "Executive Board",
        clusters: [
            { members: ["Aidan Schurr", "Yair Ben-Dor", "Lori Preci", "Dani Molloy"] }
        ]
    },
    {
        id: "staff",
        title: "Staff",
        clusters: [
            { subtitle: "Editing", members: ["Belinda Li", "Alexis Tamm", "Le Nguyen", "Aidan Schurr", "Lori Preci"] },
            { subtitle: "Social Media", members: ["Skye Schurr", "Cameron Fields"] }
        ]
    },
    {
        id: "undergraduate-fellows",
        title: "Undergraduate Fellowship",
        blurb: "Undergraduate writers reporting across the D.C. STEM landscape.",
        clusters: [
            { members: ["Sienna Halstead", "Izzy Lubinsky", "Ginger Taurek", "LaMyla Hill", "Layla Abdoulaye", "Josh Shapo"] }
        ]
    },
    {
        id: "graduate-fellows",
        title: "Graduate Fellowship",
        blurb: "Graduate fellows bringing advanced research perspectives to the magazine.",
        clusters: [
            { members: ["Aidan Brown", "Belinda Li", "Lori Preci", "Skye Schurr", "Cameron Fields", "Catherine May May Hubbard", "Le Nguyen"] }
        ]
    }
];

function getTeamMemberImageUrl(src) {
    if (!src) return src;
    const isAbsolute = /^https?:\/\//i.test(src);
    if (!isAbsolute) return src;
    try {
        const url = new URL(src);
        if (url.hostname.includes('static.wixstatic.com')) {
            const parts = url.pathname.split('/').filter(Boolean);
            const filename = parts[parts.length - 1];
            // Use Wix 'fit' (not 'fill') so the image is resized without cropping/zoom
            return `${src.split('/v1/')[0]}/v1/fit/w_640,h_640,q_80/${filename}`;
        }
    } catch {}
    return src;
}

function renderMemberCard(member) {
    const slug = (member.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    return `
        <div class="team-member-card" data-member="${slug}">
            <img src="${getTeamMemberImageUrl(member.image)}" alt="${member.name}" class="team-member-image" loading="lazy" decoding="async" onerror="this.src='NewsletterHeader1.png'">
            <div class="team-member-info">
                <h3 class="team-member-name">${member.name}</h3>
                <div class="team-member-role">${member.role}</div>
                <p class="team-member-bio">${member.bio}</p>
                ${member.linkedin || member.email ? `
                    <div class="team-member-social">
                        ${member.linkedin ? `
                            <a href="${member.linkedin}" target="_blank" rel="noopener" aria-label="LinkedIn">
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"/>
                                    <rect x="2" y="9" width="4" height="12"/>
                                    <circle cx="4" cy="4" r="2"/>
                                </svg>
                            </a>
                        ` : ''}
                        ${member.email ? `
                            <a href="${member.email}" aria-label="Email">
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                                    <polyline points="22,6 12,13 2,6"/>
                                </svg>
                            </a>
                        ` : ''}
                    </div>
                ` : ''}
            </div>
        </div>
    `;
}

/* Look up a member's full card data by name from the single source of truth.
   Logs (rather than throws) if a roster name has no matching person so a typo
   never blanks the whole section. */
const _memberByName = new Map(teamMembers.map(m => [m.name, m]));
function findMember(name) {
    const m = _memberByName.get(name);
    if (!m) console.warn(`[about] roster references unknown member: "${name}"`);
    return m;
}

/* Render one roster group (Executive Board, Staff, …) as a labeled block with
   one or more clusters. Each cluster can carry its own sub-label (e.g. Editing
   vs. Social Media within Staff). */
function renderRosterGroup(group) {
    const clustersHtml = group.clusters.map(cluster => {
        const cards = cluster.members
            .map(findMember)
            .filter(Boolean)
            .map(renderMemberCard)
            .join('');
        if (!cards) return '';
        const sub = cluster.subtitle
            ? `<h4 class="team-cluster-label">${cluster.subtitle}</h4>`
            : '';
        return `${sub}<div class="team-grid">${cards}</div>`;
    }).join('');

    return `
        <div class="team-group" id="group-${group.id}">
            <div class="team-group-header">
                <h3 class="team-group-title">${group.title}</h3>
                ${group.blurb ? `<p class="team-group-blurb">${group.blurb}</p>` : ''}
            </div>
            ${clustersHtml}
        </div>
    `;
}

function initAboutPage() {
    const teamGrid = document.getElementById('team-grid');
    if (!teamGrid) return;

    teamGrid.innerHTML = rosterGroups.map(renderRosterGroup).join('');

    const alumniGrid = document.getElementById('alumni-grid');
    if (alumniGrid) {
        alumniGrid.innerHTML = alumniMembers.map(renderMemberCard).join('');
    }

    // Add scroll reveal animation to team cards
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('revealed');
            }
        });
    }, {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    });

    const allCards = document.querySelectorAll('#team-grid .team-member-card, #alumni-grid .team-member-card');
    allCards.forEach(card => {
        card.classList.add('scroll-reveal-scale');
        observer.observe(card);
    });
}
