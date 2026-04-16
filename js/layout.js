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
]).catch(error => {
    console.error('[Layout] Error loading shared fragments', error);
});
