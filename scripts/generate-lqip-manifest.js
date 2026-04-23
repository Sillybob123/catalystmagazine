#!/usr/bin/env node
// Generates js/lqip-manifest.js: tiny base64 previews for every article image.
// Pulls from BOTH data.js (static) and Firestore (published articles) so
// newly-published articles are covered automatically on every deploy.
// Run: node scripts/generate-lqip-manifest.js
//      Or automatically via: npm run pages:deploy

const fs   = require('fs');
const path = require('path');
const https = require('https');

const ROOT       = path.resolve(__dirname, '..');
const DATA_JS    = path.join(ROOT, 'js', 'data.js');
const OUTPUT     = path.join(ROOT, 'js', 'lqip-manifest.js');
const LQIP_W     = 24;
const LQIP_Q     = 30;
const PROJECT_ID = 'catalystwriters-5ce43';

// ── Collect URLs from data.js (regex, no eval) ──────────────────────────────
function urlsFromDataJs() {
    const src = fs.readFileSync(DATA_JS, 'utf8');
    const set = new Set();
    const re  = /image\s*:\s*["']([^"']+static\.wixstatic\.com[^"']+)["']/g;
    let m;
    while ((m = re.exec(src)) !== null) set.add(m[1]);
    return set;
}

// ── Collect URLs from Firestore (public REST, status==published) ─────────────
function fetchJson(url, body) {
    return new Promise((resolve, reject) => {
        const opts = new URL(url);
        const req  = https.request({
            hostname: opts.hostname,
            path:     opts.pathname + opts.search,
            method:   body ? 'POST' : 'GET',
            headers:  { 'Content-Type': 'application/json' }
        }, res => {
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => {
                try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
                catch (e) { reject(e); }
            });
        });
        req.on('error', reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

async function urlsFromFirestore() {
    const endpoint = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:runQuery`;
    const body = {
        structuredQuery: {
            from: [{ collectionId: 'stories' }],
            where: { fieldFilter: {
                field: { fieldPath: 'status' }, op: 'EQUAL',
                value: { stringValue: 'published' }
            }},
            select: { fields: [{ fieldPath: 'coverImage' }, { fieldPath: 'image' }] }
        }
    };
    try {
        const rows = await fetchJson(endpoint, body);
        const set  = new Set();
        for (const row of rows) {
            const f = row.document?.fields || {};
            const img = f.coverImage?.stringValue || f.image?.stringValue || '';
            if (img && img.includes('static.wixstatic.com')) set.add(img);
        }
        return set;
    } catch (err) {
        console.warn('[lqip] Firestore fetch failed (using data.js only):', err.message);
        return new Set();
    }
}

// ── Build a tiny Wix preview URL ─────────────────────────────────────────────
function lqipUrl(src) {
    try {
        const u     = new URL(src);
        const parts = u.pathname.split('/').filter(Boolean);
        const name  = parts[parts.length - 1];
        const h     = Math.round(LQIP_W * 0.66);
        if (parts.includes('v1')) {
            return src.replace(/q_\d+/g, `q_${LQIP_Q}`).replace(/w_\d+/g, `w_${LQIP_W}`);
        }
        return `${src}/v1/fill/w_${LQIP_W},h_${h},al_c,q_${LQIP_Q},enc_auto/${name}`;
    } catch { return null; }
}

// ── Fetch binary ─────────────────────────────────────────────────────────────
function fetchBinary(url) {
    return new Promise((resolve, reject) => {
        const get = (u, depth = 0) => {
            if (depth > 3) return reject(new Error('too many redirects'));
            https.get(u, res => {
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    res.resume();
                    return get(res.headers.location, depth + 1);
                }
                if (res.statusCode !== 200) {
                    res.resume();
                    return reject(new Error(`HTTP ${res.statusCode}`));
                }
                const chunks = [];
                res.on('data', c => chunks.push(c));
                res.on('end', () => resolve({
                    buffer: Buffer.concat(chunks),
                    type:   res.headers['content-type'] || 'image/jpeg'
                }));
                res.on('error', reject);
            }).on('error', reject);
        };
        get(url);
    });
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
    const [staticUrls, fsUrls] = await Promise.all([
        Promise.resolve(urlsFromDataJs()),
        urlsFromFirestore()
    ]);

    const all = new Set([...staticUrls, ...fsUrls]);
    console.log(`[lqip] ${staticUrls.size} from data.js + ${fsUrls.size} from Firestore = ${all.size} total`);

    // Keep existing entries so we don't re-fetch unchanged images
    let existing = {};
    if (fs.existsSync(OUTPUT)) {
        try {
            const m = fs.readFileSync(OUTPUT, 'utf8').match(/window\.__LQIP_MANIFEST\s*=\s*(\{[\s\S]*\});/);
            if (m) existing = JSON.parse(m[1]);
        } catch {}
    }

    const manifest = { ...existing };
    let added = 0, cached = 0, failed = 0;

    for (const src of all) {
        if (manifest[src]) { cached++; continue; }
        const preview = lqipUrl(src);
        if (!preview) { failed++; continue; }
        try {
            const { buffer, type } = await fetchBinary(preview);
            if (buffer.length > 5000) { failed++; continue; } // sanity cap
            manifest[src] = `data:${type};base64,${buffer.toString('base64')}`;
            added++;
            process.stdout.write('.');
        } catch (err) {
            failed++;
            console.warn(`\n[lqip] failed: ${err.message} (${src.slice(-40)})`);
        }
    }

    const out = `// AUTO-GENERATED — do not edit. Re-runs on every deploy.\n` +
                `window.__LQIP_MANIFEST = ${JSON.stringify(manifest, null, 2)};\n`;
    fs.writeFileSync(OUTPUT, out);
    console.log(`\n[lqip] done — added=${added} cached=${cached} failed=${failed}`);
}

main().catch(e => { console.error(e); process.exit(1); });
