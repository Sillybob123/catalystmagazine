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
}).catch(error => {
    console.error('[Layout] Error loading shared fragments', error);
});

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

    mobileNewsletterBtn?.addEventListener('click', openModal);
    desktopSubscribeBtn?.addEventListener('click', openModal);
    modalClose?.addEventListener('click', closeModal);
    modalOverlay?.addEventListener('click', closeModal);

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && newsletterModal.classList.contains('active')) closeModal();
    });
}
