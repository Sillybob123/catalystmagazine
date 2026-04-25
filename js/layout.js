const LEGACY_RUNTIME_CLEANUP_KEY = "catalyst-runtime-cleanup-v1";

void cleanupLegacyRuntime();

async function cleanupLegacyRuntime() {
    if (typeof window === 'undefined') return;
    if (!/(^|\.)catalyst-magazine\.com$/i.test(window.location.hostname)) return;

    try {
        if (window.localStorage?.getItem(LEGACY_RUNTIME_CLEANUP_KEY)) return;
        window.localStorage?.setItem(LEGACY_RUNTIME_CLEANUP_KEY, '1');
    } catch (err) {
        // Storage can be blocked in private browsing; keep cleanup best-effort.
    }

    try {
        if ('serviceWorker' in navigator) {
            const registrations = await navigator.serviceWorker.getRegistrations();
            await Promise.all(registrations.map((registration) => registration.unregister().catch(() => false)));
        }

        if ('caches' in window) {
            const cacheKeys = await caches.keys();
            await Promise.all(cacheKeys.map((key) => caches.delete(key).catch(() => false)));
        }
    } catch (error) {
        console.warn('[Runtime] Legacy cache cleanup failed', error);
    }
}

// Load shared header and footer so every page stays in sync
async function loadFragment(targetId, path) {
    const target = document.getElementById(targetId);
    if (!target) return;

    // Resolve path from the layout.js location so it works in nested pages
    const basePath = (() => {
        const scriptSrc = document.currentScript?.src || '';
        try {
            const url = new URL(scriptSrc, window.location.href);
            return url.pathname.replace(/\/js\/layout\.js.*$/i, '/');
        } catch (err) {
            return '/';
        }
    })();

    const resolvedPath = (() => {
        if (/^https?:\/\//i.test(path)) return path;
        if (path.startsWith('/')) return path;
        return `${basePath}${path.replace(/^\/+/, '')}`;
    })();

    try {
        const response = await fetch(resolvedPath, { cache: 'no-cache' });
        if (!response.ok) throw new Error(`Failed to load ${resolvedPath}: ${response.status}`);
        const html = await response.text();
        target.innerHTML = html;
    } catch (error) {
        console.error(`[Layout] ${error.message}`);
    }
}

const bodyDataset = document.body?.dataset || {};
const pageName = bodyDataset.page || '';
const sectionName = bodyDataset.section || '';
const isEditorial = sectionName === 'editorial' || ['writer-login', 'editorial-studio'].includes(pageName);

const headerPath = isEditorial ? '/editor-header.html' : '/header.html';
const footerPath = isEditorial ? '/editor-footer.html' : '/footer.html';

window.layoutReady = Promise.all([
    loadFragment('site-header', headerPath),
    loadFragment('site-footer', footerPath)
]).then(() => {
    setupNewsletterModal();
    setupMobileNav();
    setupWelcomePopup();
}).catch(error => {
    console.error('[Layout] Error loading shared fragments', error);
});

// Mobile hamburger menu. Lives here so every page works — previously this
// handler was only bound in main.js, which pages like /articles
// and /collaborate don't load.
function setupMobileNav() {
    const menuToggle = document.querySelector('.menu-toggle');
    const navMenu = document.querySelector('.nav-menu');
    if (!menuToggle || !navMenu) return;

    menuToggle.addEventListener('click', () => {
        const isOpen = navMenu.classList.toggle('open');
        menuToggle.classList.toggle('active', isOpen);
        menuToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });

    navMenu.querySelectorAll('a').forEach(link => {
        link.addEventListener('click', () => {
            navMenu.classList.remove('open');
            menuToggle.classList.remove('active');
            menuToggle.setAttribute('aria-expanded', 'false');
        });
    });

    // Mark the active nav link based on the current URL so the highlight
    // stays correct on every page.
    const currentPath = window.location.pathname;
    document.querySelectorAll('.nav-link').forEach(link => {
        link.classList.remove('active');
        const href = link.getAttribute('href');
        if (href === '/' && (currentPath === '/' || currentPath === '' || currentPath.endsWith('index.html'))) {
            link.classList.add('active');
        } else if (href && href !== '/' && currentPath.includes(href)) {
            link.classList.add('active');
        }
    });
}

function setupNewsletterModal() {
    const newsletterModal = document.getElementById('newsletter-modal');
    if (!newsletterModal) return;

    const mobileNewsletterBtn = document.getElementById('mobile-newsletter-btn');
    const desktopSubscribeBtn = document.getElementById('desktop-subscribe-btn');
    const modalClose = document.getElementById('newsletter-modal-close');
    const modalOverlay = document.getElementById('newsletter-modal-overlay');
    const modalContent = newsletterModal.querySelector('.newsletter-modal-content');
    const firstField = newsletterModal.querySelector('input[name="FNAME"], input[name="firstName"], input[name="EMAIL"], input[name="email"]');

    const openModal = () => {
        newsletterModal.classList.add('active');
        document.body.style.overflow = 'hidden';
        setTimeout(() => (firstField || modalContent)?.focus({ preventScroll: true }), 120);
    };
    const closeModal = () => {
        newsletterModal.classList.remove('active');
        document.body.style.overflow = '';
    };

    mobileNewsletterBtn?.addEventListener('click', openModal);
    desktopSubscribeBtn?.addEventListener('click', openModal);
    modalClose?.addEventListener('click', closeModal);
    modalOverlay?.addEventListener('click', closeModal);

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && newsletterModal.classList.contains('active')) closeModal();
    });
}

// First-visit welcome popup. Shown once per browser; respects user dismissal
// and never appears on editorial / staff pages. Markup is injected here (not
// in header.html) because dev tools like Live Server mangle HTML fragments
// that contain multiple SVGs.
function setupWelcomePopup() {
    if (isEditorial) return;

    const STORAGE_KEY = 'catalyst-welcome-seen-v1';
    const COOKIE_KEY = 'catalyst_welcome_seen';

    const hasSeen = () => {
        try {
            if (window.localStorage?.getItem(STORAGE_KEY)) return true;
        } catch (_) {}
        return document.cookie.split('; ').some(c => c.startsWith(COOKIE_KEY + '='));
    };

    const markSeen = () => {
        try { window.localStorage?.setItem(STORAGE_KEY, '1'); } catch (_) {}
        const oneYear = 60 * 60 * 24 * 365;
        document.cookie = `${COOKIE_KEY}=1; path=/; max-age=${oneYear}; SameSite=Lax`;
    };

    const forceShow = new URLSearchParams(window.location.search).has('welcome');
    if (hasSeen() && !forceShow) {
        console.log('[welcome-popup] suppressed: already seen. Add ?welcome=1 to force.');
        return;
    }
    const openDelay = forceShow ? 350 : 6000;
    console.log(`[welcome-popup] will appear in ${openDelay}ms`);

    const checkSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';

    const markup = `
        <div class="welcome-popup-overlay" id="welcome-popup-overlay"></div>
        <div class="welcome-popup-card" tabindex="-1">
            <button class="welcome-popup-close" id="welcome-popup-close" aria-label="Close">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
            <div class="welcome-popup-masthead" aria-hidden="true">
                <img src="/WebLogo.png" alt="" class="welcome-popup-logo" loading="lazy" decoding="async">
            </div>
            <p class="welcome-popup-eyebrow">Welcome to The Catalyst</p>
            <h2 class="welcome-popup-title" id="welcome-popup-title">Stories that spark scientific curiosity.</h2>
            <p class="welcome-popup-subtitle">Join thousands of curious minds for thoughtful stories, D.C. STEM spotlights, and behind-the-scenes interviews, delivered with care and never spam.</p>
            <form data-newsletter-form id="welcome-popup-form" class="welcome-popup-form" novalidate>
                <div class="welcome-popup-name-row">
                    <label class="welcome-popup-field">
                        <span>First name</span>
                        <input type="text" name="FNAME" class="welcome-popup-input" placeholder="Ada" required autocomplete="given-name">
                    </label>
                    <label class="welcome-popup-field">
                        <span>Last name</span>
                        <input type="text" name="LNAME" class="welcome-popup-input" placeholder="Lovelace" required autocomplete="family-name">
                    </label>
                </div>
                <label class="welcome-popup-field welcome-popup-field--email">
                    <span>Email address</span>
                    <input type="email" name="EMAIL" class="welcome-popup-input" placeholder="you@example.com" required autocomplete="email" inputmode="email">
                </label>
                <button type="submit" class="welcome-popup-submit">
                    Subscribe
                    <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                </button>
                <div class="newsletter-response welcome-popup-response" aria-live="polite"></div>
            </form>
            <div class="welcome-popup-perks">
                <div class="welcome-popup-perk">${checkSvg}<span>Exclusive stories</span></div>
                <div class="welcome-popup-perk">${checkSvg}<span>No spam, ever</span></div>
                <div class="welcome-popup-perk">${checkSvg}<span>Unsubscribe anytime</span></div>
            </div>
            <button type="button" class="welcome-popup-dismiss" id="welcome-popup-dismiss">Maybe later</button>
        </div>
    `;

    const popup = document.createElement('div');
    popup.className = 'welcome-popup';
    popup.id = 'welcome-popup';
    popup.setAttribute('role', 'dialog');
    popup.setAttribute('aria-modal', 'true');
    popup.setAttribute('aria-labelledby', 'welcome-popup-title');
    popup.setAttribute('aria-hidden', 'true');
    popup.innerHTML = markup;
    document.body.appendChild(popup);

    // Re-run newsletter handler binding so the new form posts to /api/subscribe
    if (typeof window.initNewsletterForms === 'function') {
        window.initNewsletterForms();
    }

    const overlay = document.getElementById('welcome-popup-overlay');
    const closeBtn = document.getElementById('welcome-popup-close');
    const dismissBtn = document.getElementById('welcome-popup-dismiss');
    const responseDiv = popup.querySelector('.welcome-popup-response');
    const firstFocus = popup.querySelector('input[name="FNAME"]');

    const open = () => {
        popup.classList.add('active');
        popup.setAttribute('aria-hidden', 'false');
        document.body.style.overflow = 'hidden';
        markSeen();
        setTimeout(() => firstFocus?.focus({ preventScroll: true }), 600);
    };

    const close = () => {
        popup.classList.remove('active');
        popup.setAttribute('aria-hidden', 'true');
        document.body.style.overflow = '';
    };

    overlay?.addEventListener('click', close);
    closeBtn?.addEventListener('click', close);
    dismissBtn?.addEventListener('click', close);

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && popup.classList.contains('active')) close();
    });

    // Close on successful subscribe — newsletter-handler.js sets a success
    // class on the response div after the API call resolves.
    if (responseDiv) {
        const observer = new MutationObserver(() => {
            if (responseDiv.classList.contains('success')) {
                setTimeout(close, 1800);
            }
        });
        observer.observe(responseDiv, { attributes: true, attributeFilter: ['class'] });
    }

    // Show after a deliberate delay so the page has time to settle. The
    // preview query string opens quickly for design QA.
    setTimeout(open, openDelay);
}
