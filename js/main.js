// ============================================
// THE CATALYST MAGAZINE - MAIN JAVASCRIPT
// ============================================

document.addEventListener('DOMContentLoaded', () => {
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
        initApp();
    });
});

const ARTICLE_FALLBACK_IMAGE = '/NewsletterHeader1.png';
const CARD_IMAGE_WIDTH = 800;
const HERO_IMAGE_WIDTH = 1000;
const CARD_IMAGE_QUALITY = 78;
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
function getHeroImageUrl(src)  { return getResizedImageUrl(src, HERO_IMAGE_WIDTH, HERO_IMAGE_QUALITY); }

// Renders an <img> with a shimmer background while loading, then fades in.
// The shimmer is pure CSS — no network, shows instantly.
function createProgressiveImage(src, alt, className = '', eager = false, imageSettings = null, overlayHtml = '') {
    const imageSrc = src || ARTICLE_FALLBACK_IMAGE;
    const displaySrc = eager ? getHeroImageUrl(imageSrc) : getCardImageUrl(imageSrc);
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

    // Render instant skeletons so containers are visible immediately
    renderInitialSkeletons(page);

    if (page === 'home' || page === 'articles' || page === 'article') {
        // Reuse the load kicked off at DOMContentLoaded so Firestore runs in
        // parallel with the header/footer fetch instead of serially after it.
        articleData = await (window.__articlesPromise || loadArticles());
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
        initArticleDetailPage(articleData);
    } else if (page === 'about') {
        initAboutPage();
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

function initHomeArticles(data) {
    const grid = document.getElementById('home-articles-grid');
    if (!grid || !Array.isArray(data)) return;

    // Skip the first 8 (already shown above), show next 12 articles
    const homeArticles = data.slice(8, 20);

    grid.innerHTML = homeArticles.map(article => createArticleCard(article)).join('');
    registerFadeIn(grid);
    registerProgressiveImages(grid);
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
    // Remove existing notification
    const existing = document.querySelector('.notification');
    if (existing) existing.remove();

    const notification = document.createElement('div');
    notification.className = 'notification';

    // Choose icon and colors based on type
    const isError = type === 'error';
    const icon = isError
        ? `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="15" y1="9" x2="9" y2="15"></line>
            <line x1="9" y1="9" x2="15" y2="15"></line>
           </svg>`
        : `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
            <polyline points="22 4 12 14.01 9 11.01"/>
           </svg>`;

    const background = isError
        ? 'linear-gradient(135deg, #D32F2F 0%, #F44336 50%, #E57373 100%)'
        : 'linear-gradient(135deg, #0D47A1 0%, #1976D2 50%, #42A5F5 100%)';

    const boxShadow = isError
        ? '0 10px 40px rgba(211, 47, 47, 0.4)'
        : '0 10px 40px rgba(13, 71, 161, 0.4)';

    notification.innerHTML = `${icon}<span>${message}</span>`;

    // Add styles
    notification.style.cssText = `
        position: fixed;
        bottom: 32px;
        left: 50%;
        transform: translateX(-50%) translateY(100px);
        background: ${background};
        color: white;
        padding: 16px 28px;
        border-radius: 50px;
        display: flex;
        align-items: center;
        gap: 12px;
        font-weight: 600;
        box-shadow: ${boxShadow};
        z-index: 10000;
        animation: slideUp 0.4s ease forwards;
        max-width: 90%;
    `;

    // Add animation keyframes if not exists
    if (!document.getElementById('notification-styles')) {
        const style = document.createElement('style');
        style.id = 'notification-styles';
        style.textContent = `
            @keyframes slideUp {
                to { transform: translateX(-50%) translateY(0); }
            }
        `;
        document.head.appendChild(style);
    }

    document.body.appendChild(notification);

    setTimeout(() => {
        notification.style.animation = 'slideUp 0.4s ease reverse forwards';
        setTimeout(() => notification.remove(), 400);
    }, 4000);
}

// ============================================
// ARTICLE DETAIL PAGE
// ============================================
function initArticleDetailPage(data) {
    if (!Array.isArray(data)) {
        window.location.href = '/articles';
        return;
    }

    // Support both /article/<slug> and legacy /article.html?id=<id>
    const pathSlug = window.location.pathname.match(/\/article\/([^/?#]+)/)?.[1];
    const urlParams = new URLSearchParams(window.location.search);
    const rawId = urlParams.get('id');

    let article;
    if (pathSlug) {
        // Prefer the article ID injected by the Cloudflare Function (no scan needed)
        const injectedId = document.querySelector('meta[name="catalyst-article-id"]')?.content;
        if (injectedId) {
            article = data.find(a => String(a.id) === String(injectedId));
        }
        if (!article) {
            const slug = decodeURIComponent(pathSlug).toLowerCase();
            article = data.find(a => titleToSlug(a.title) === slug);
        }
    } else if (rawId) {
        article = data.find(a => String(a.id) === String(rawId));
    }

    if (!article) {
        window.location.href = '/articles';
        return;
    }

    // Fetch the full Firestore document to get the article body (body/content),
    // which is excluded from the listing query projection to keep it fast.
    fetchFullArticleBody(article.id).then(full => {
        if (full) {
            if (full.content) article.content = full.content;
            if (full.blocks && full.blocks.length) article.blocks = full.blocks;
            if (full.author && full.author !== 'The Catalyst') article.author = full.author;
            if (full.deck) article.deck = full.deck;
            if (full.lightCover !== undefined) article.lightCover = full.lightCover;
            if (full.game) article.game = full.game;
        }
        renderArticleDetail(article);
    }).catch(() => renderArticleDetail(article));

    renderRelatedArticles(article, data);
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

function renderArticleDetail(article) {
    const container = document.getElementById('article-detail');
    if (!container) return;

    // --- Meta tags + page title -------------------------------------------
    document.title = `${article.title} | The Catalyst Magazine`;

    const articleUrl = `${window.location.origin}/article/${encodeURIComponent(titleToSlug(article.title))}`;
    const articleImage = /^https?:\/\//i.test(article.image || '')
        ? article.image
        : `${window.location.origin}/${(article.image || 'NewLogoShape.png').replace(/^\/+/, '')}`;
    const articleDescription = article.excerpt || article.deck || article.description || 'Read this story on The Catalyst Magazine';

    document.getElementById('meta-description')?.setAttribute('content', articleDescription);
    document.getElementById('meta-og-url')?.setAttribute('content', articleUrl);
    document.getElementById('meta-og-title')?.setAttribute('content', article.title);
    document.getElementById('meta-og-description')?.setAttribute('content', articleDescription);
    document.getElementById('meta-og-image')?.setAttribute('content', articleImage);
    document.getElementById('meta-og-image-alt')?.setAttribute('content', article.title);
    document.getElementById('meta-twitter-url')?.setAttribute('content', articleUrl);
    document.getElementById('meta-twitter-title')?.setAttribute('content', article.title);
    document.getElementById('meta-twitter-description')?.setAttribute('content', articleDescription);
    document.getElementById('meta-twitter-image')?.setAttribute('content', articleImage);
    document.getElementById('meta-twitter-image-alt')?.setAttribute('content', article.title);

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
        </div>
    `;

    mountReadingProgress();
    registerProgressiveImages(container);
    hydrateQuizzes(container);
    mountArticleGame(container, article);
    if (typeof window.applyGlossary === 'function') {
        const body = container.querySelector('.article-body');
        if (body) window.applyGlossary(body);
    }
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
        fill.style.width = pct + '%';
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
    } else if (decoded.startsWith('/article/')) {
        window.location.href = decoded;
    } else {
        // Legacy id — find the article and navigate by slug
        const article = articleData.find(a => String(a.id) === String(decoded));
        if (article) {
            window.location.href = `/article/${encodeURIComponent(titleToSlug(article.title))}`;
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
    };
    return map[category] || category.charAt(0).toUpperCase() + category.slice(1);
}

function getArticleLink(article) {
    return article.link || `/article/${encodeURIComponent(titleToSlug(article.title))}`;
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
            tryAdd({
                id: raw.id || nextId++,
                title: raw.title,
                author: raw.author || 'The Catalyst',
                date: raw.date || '',
                image: raw.image || ARTICLE_FALLBACK_IMAGE,
                link: link || `/article/${encodeURIComponent(titleToSlug(raw.title))}`,
                url: link || `/article/${encodeURIComponent(titleToSlug(raw.title))}`,
                category: (raw.category || 'feature').toLowerCase(),
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
    const CACHE_KEY = 'catalyst_fs_cache_v4';
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
            // article body which can be 50-200 KB per document.
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

    const category = (str('category') || 'feature').toLowerCase();
    const content = str('body') || str('content');
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

    return {
        id: storyId,
        title,
        author: str('authorName') || str('author') || 'The Catalyst',
        date: dateStr,
        image,
        link: `/article/${encodeURIComponent(titleToSlug(title))}`,
        url: `/article/${encodeURIComponent(titleToSlug(title))}`,
        category,
        tags: arr('tags'),
        excerpt,
        deck,
        content,
        lightCover,
        game
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
    if (['feature', 'profile', 'interview', 'op-ed', 'editorial'].includes(val)) return val;
    return 'feature';
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
        image: "/YairCatalyst.png",
        linkedin: "",
        email: ""
    },
    {
        name: "Aidan Schurr",
        role: "Co-Founder, Editor-in-Chief",
        bio: "Aidan is a third year at George Washington University pursuing a B.S. in Biomedical Engineering and Pre-Med Studies. As an engineer interested in medicine, Aidan finds his interests spanning every letter in STEM, with experience in a diverse set of research labs, from clinical Alzheimer's care to machine learning development. For Aidan, The Catalyst represents the best aspects of DC: cross-disciplinary, impact driven, and far reaching. Beyond campus, he has worked alongside policymakers, lawyers, and scientists, to utilize science communication in driving global change.",
        image: "/AidanCatalyst1.png",
        linkedin: "",
        email: ""
    },
    {
        name: "Lori Preci",
        role: "Managing Editor, Writer",
        bio: "Lori is pursuing a masters in biotechnology at Johns Hopkins University, and is also a recent George Washington University graduate with a dual degree in Cellular and Molecular Biology and Chemistry. Her interest in STEM emerged in her sophomore year at GWU as a Biochemistry Lab research assistant, where she witnessed interdisciplinary collaboration happening behind the scenes without any public recognition. Lori views The Catalyst as a bridge between the disconnect in scientific fields, and has the goal of making research more accessible and sparking curiosity in STEM.",
        image: "/LoriCatalyst.png",
        linkedin: "",
        email: ""
    },
    {
        name: "Naama Ben-Dor",
        role: "Senior Writer, Editor, Media Specialist",
        bio: "Naama is a senior at Georgetown University majoring in Neurobiology with minors in Chemistry and Jewish Civilization. As the creative spark behind The Catalyst Magazine, she handles digital content and outreach, all while writing some of the magazine's most unexpected and entertaining pieces. Naama is drawn to science to understand not only how the world works but why, and deeply values the relatable nature of science journalism as a mechanism to learn about STEM.",
        image: "/NaamaCatalyst.png",
        linkedin: "",
        email: ""
    },
    {
        name: "Le Nguyen",
        role: "Writer",
        bio: "Le is a recent George Washington University graduate with a degree in Neuroscience, a minor in Creative Writing, and summa cum laude honors. With extensive research experience spanning neurodevelopment, cardiology, and pulmonary medicine at institutions including GWU School of Medicine, Johns Hopkins, and Minneapolis Heart Institute, Le brings a unique blend of scientific rigor and narrative skill to The Catalyst. Currently in his gap year working as an IR Medical Assistant at Beth Israel Deaconess Medical Center, Le is passionate about the intersections of medicine, research, and health equity as he prepares to pursue medical school.",
        image: "/Le.png",
        linkedin: "",
        email: ""
    },
    {
        name: "Ginger Taurek",
        role: "Writer",
        bio: "Ginger is a third-year student at George Washington University School of Business studying Entrepreneurship and Innovation with a minor in Sustainability. Her interests in STEM and journalism come from a passion for wildlife conservation, global sustainability, and measures to implement climate resilience and sustainable development on a global scale. Deeply interested in storytelling and science communication, Ginger strives to connect science and policy with public awareness.",
        image: "/Ginger.png",
        linkedin: "",
        email: ""
    },
    {
        name: "Aidan Brown",
        role: "Writer",
        bio: "Aidan is a senior at George Washington University pursuing a B.S./M.S. in Biology, with a concentration in Ecology, Evolution, and Environment and a minor in Geographic Information Systems. His academic interests lie at the intersection of environmental science and data analysis, with experience researching coastal ecology and tree mortality using machine learning and remote sensing. Aidan is passionate about using data to ask and answer meaningful questions about the natural world.",
        image: "/Brown.png",
        linkedin: "",
        email: ""
    },
    {
        name: "Alexis Tamm",
        role: "Writer",
        bio: "Alexis is a senior at Georgetown University majoring in English with minors in Psychology and Spanish. As an avid reader and writer, she is passionate about journalism and is particularly interested in bridging the gap between academic research and the general public through clear, accessible storytelling, with aims to pursue journalism professionally.",
        image: "/Alexis.png",
        linkedin: "",
        email: ""
    },
    {
        name: "Layla Abdoulaye",
        role: "Writer",
        bio: "Layla is a sophomore studying Physics at Howard University, with aspirations to earn a Ph.D. after graduation. Drawn to physics due to its complexity and power to explain how the world works, Layla is especially passionate about astronomy and quantum physics. Her academic interests specifically narrow on quantum materials and systems, where she hopes to contribute to cutting-edge research at the intersection of theory and discovery.",
        image: "/Layla.png",
        linkedin: "",
        email: ""
    },
    {
        name: "Sydney Reiser",
        role: "Writer",
        bio: "Sydney is a first-year Chemistry PhD student at Johns Hopkins University, having recently graduated summa cum laude from George Washington University with a B.S. in Chemistry. With a background in synthetic chemistry research and experience as a Physics Learning Assistant, she brings a strong analytical and pedagogical perspective to The Catalyst, aiming to make complex chemical concepts accessible and engaging for a wider audience.",
        image: "/Sydney.png",
        linkedin: "",
        email: ""
    },
    {
        name: "Izzy Lubinsky",
        role: "Writer",
        bio: "Izzy is a George Washington University Presidential Scholar pursuing a double major in Biology and Environmental Science, with concentrations in Ecology, Evolution, and Environment and Ecological Management. At The Catalyst, she utilizes her background as an Anatomy Laboratory Technician and a meta-analysis ecological researcher to make complex biological topics accessible to a wider audience. Her interest in STEM is driven by a passion for urban ecology and climate resilience, often exploring how green infrastructure can bridge the gap between academic research and community well-being in D.C.",
        image: "/Izzy.png",
        linkedin: "",
        email: ""
    },
    {
        name: "Azza Uwhubetine",
        role: "Writer",
        bio: "Azza is a junior at George Washington University pursuing a degree in English with a minor in Astronomy. At The Catalyst, she hopes to merge her love for science, particularly physics, with the journalistic and publishing world. Azza has previously held positions at various publishing organizations, gaining experience in editorial writing and storytelling, and also runs a non-profit dedicated to supporting children in West African communities.",
        image: "/Azza.png",
        linkedin: "",
        email: ""
    },
    {
        name: "Skye Schurr",
        role: "Writer, Media Specialist",
        bio: "Skye is a senior at Rutgers University pursuing a B.S. in Public Health, with a minor in Business Administration and a certificate in Health Policy. Over the past two summers, she has worked in Washington, D.C., contributing to research on reproductive and maternal health and authoring policy memoranda on AI in healthcare. Skye sees The Catalyst as a vehicle to increase health and civic literacy, empowering readers to understand the systems that shape their lives.",
        image: "/Skye.png",
        linkedin: "",
        email: ""
    },
    {
        name: "Rachel Lee",
        role: "Photographer, Media Specialist",
        bio: "Rachel is a junior at George Washington University majoring in Communications and Business. Originally entering GWU as a pre-med student, Rachel comes from a strong STEM and biology-focused background, but her interests have shifted toward the communications field. She is passionate about making STEM topics more accessible through creative media and visual storytelling.",
        image: "/RachelLee.png",
        linkedin: "",
        email: ""
    },
    {
        name: "Josh Shapo",
        role: "Writer",
        bio: "Josh is an electrical engineering student at the George Washington University graduating in the spring of 2027. He is involved in science advocacy and engineering policy, particularly within the space and aviation sectors. In his capacity as the Chair of IEEE-GWU and the IEEE Region 2 Student Representative, he strives to make academic and industrial STEM opportunities more accessible to students. He is currently conducting machine learning-based Heliophysics to denoise satellite magnetometry signals and aid scientific understanding of solar storms.",
        image: "/JoshShapo.png",
        linkedin: "",
        email: ""
    },
    {
        name: "Catherine May May Hubbard",
        role: "Writer",
        bio: "May May is a recent graduate from George Washington University with a B.S. in Chemistry and minor in Music. With a background in microbiology and infectious disease research, she fell in love with experimentation and piecing together the story that the research told. Teaching is a large part of her journey in education, and in college, she has had the opportunity to share her love for science as an Undergraduate Teaching Assistant for several biology laboratory courses. At The Catalyst, she hopes to use her writing to expand access to scientific knowledge and promote STEM education within the larger DMV community.",
        image: "/maymay.png",
        linkedin: "",
        email: ""
    },
    {
        name: "LaMyla Hill",
        role: "Writer",
        bio: "LaMyla is a rising Junior at Howard University, majoring in physics, with a concentration in astrophysics, and a minor in math. She is also a part of the College of Arts and Sciences Honors program and is a proud member of the Society of Physics Students. Ever since elementary school, LaMyla's dream career was to be a physicist, and she has been following this thread of fascination until now. After completing her bachelor's degree, she intends to enroll in graduate school to become an astrophysics researcher.",
        image: "/LaMayla.png",
        linkedin: "",
        email: ""
    },
    {
        name: "Sienna",
        role: "Writer",
        bio: "Sienna is a neuroscience student with a minor in Mind and Brain Studies in the Philosophy Department at George Washington University. She is passionate about science communication and connecting people with educational resources that inspire curiosity, as that is how her own love of science, philosophy, and anthropology was cultivated. Her academic interests primarily focus on understanding the biology of consciousness and the complex interactions between health, culture, and the environment. Her current research at George Washington University's Department of Neuroscience focuses on the development of next-generation therapeutics through drug repurposing to address antimicrobial resistance in parasitic hookworms.",
        image: "/Sienna.png",
        linkedin: "",
        email: ""
    },
    {
        name: "Cameron",
        role: "Writer",
        bio: "Cameron is a recent graduate from Johns Hopkins University with a B.A. in Public Health Studies and a minor in Psychology. She will be beginning her Master's of Science in Public Health at the Johns Hopkins Bloomberg School of Public Health in maternal, fetal, and perinatal health. Through her research experiences in prenatal care, harm reduction, and HIV, Cameron has become passionate about interacting with community members to ensure they have resources and education about various health topics. Cameron is drawn to the community-based side of medicine and hopes to continue to share and expand on this passion through her writing with the Catalyst, research, and in the future professionally as a physician.",
        image: "/cameron.png",
        linkedin: "",
        email: ""
    }
];

const alumniMembers = [
    {
        name: "Stephanie Solomon",
        role: "Former Editor",
        bio: "Stephanie is a Georgetown University junior studying History, Spanish, and World Affairs, with a strong background in journalism, policy research, and editorial work. At The Catalyst Magazine, she ensured every piece met high standards for accuracy and clarity, drawing on her experience in investigative writing, political communications, and media strategy. Her sharp editorial eye kept the magazine grounded in both integrity and impact, and she plans to translate these analytical writing skills into the legal field.",
        image: "/Steph.png",
        linkedin: "",
        email: ""
    },
    {
        name: "Alex Carter",
        role: "Former Writer",
        bio: "Alex is a PhD student at Princeton University studying developmental biology, in addition to a recent George Washington University graduate with a B.S. in Cellular and Molecular Biology. His work at the GWU Martin Lab explored the genetic basis of evolution and adaptation, and finds the field of biology specifically interesting due to its answers to some of the world's most challenging and relevant questions. Alex excelled at making complex genetics approachable and engaging for a broad audience.",
        image: "/CarterCatalyst.png",
        linkedin: "",
        email: ""
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

function initAboutPage() {
    const teamGrid = document.getElementById('team-grid');
    if (!teamGrid) return;

    teamGrid.innerHTML = teamMembers.map(renderMemberCard).join('');

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
