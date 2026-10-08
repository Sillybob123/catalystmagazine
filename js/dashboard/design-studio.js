// js/dashboard/design-studio.js
// Design Studio — a small Canva-style editor for Catalyst social posts.
//
//   mountDesignStudio(ctx, container, { savePost, onSaved, onClose })
//     → { open(post), newDesign(), hasUnsaved(), destroy() }
// Full-screen, Canva-style: top bar (back, name, size, undo/redo, save
// status, download, save), icon rail + panel, a one-row contextual toolbar,
// the canvas with zoom, and the pages strip. Drafts on the board autosave.
//
// • Formats: Instagram post 4:5 (1080×1350), square (1080×1080), story 9:16
//   (1080×1920); several pages make a carousel.
// • Each page = a background (illustration, wash or colour) + layers:
//   text, images (illustrations, article covers, uploads) and shapes.
// • Drag to move, handles to resize (text: sides wrap, corners scale),
//   snapping to the centre and margins, double-click text to type on the
//   canvas, undo/redo, arrows to nudge, Delete, ⌘D to duplicate.
// • Download the page as PNG or every page as a ZIP; save to the Social
//   board (the design is stored on the post, so it reopens here).
//
// Assets: /beta/social/library.json (Higgsfield illustrations, washes,
// night scenes, cut-out elements) + /beta/social/backgrounds.json (story
// art with ready-made text). Templates are built in code below.

import { el, esc } from "./ui.js";

// ─── Formats, fonts, palette ────────────────────────────────────────────────
const FORMATS = {
  square: { label: "Instagram post 1:1", w: 1080, h: 1080 },
  post:   { label: "Portrait 4:5", w: 1080, h: 1350 },
  story:  { label: "Story 9:16", w: 1080, h: 1920 },
  linkedin: { label: "LinkedIn 1.91:1", w: 1200, h: 627 },
  wide:   { label: "X / wide 16:9", w: 1600, h: 900 },
};
// Which board platform a format posts to (the rest are Instagram).
const FORMAT_PLATFORM = { linkedin: "linkedin", wide: "twitter" };
const PLATFORM_LABEL = { instagram: "Instagram", linkedin: "LinkedIn", twitter: "X", facebook: "Facebook" };
// Google Fonts the Studio can use. `rec` = recommended for The Catalyst
// (Poppins and Source Serif are the site's own type; Fraunces and
// Instrument Serif are editorial display serifs that sit well with them).
// w = weights, it = italic weights (a font without italics borrows the
// serif italic for *accent* words). Keys "sans"/"serif" are the originals.
const FONTS = {
  sans: { label: "Poppins", css: "'Poppins', system-ui, sans-serif", cat: "Sans", w: [300, 400, 500, 600, 700, 800], it: [300, 400, 500, 600, 700, 800], rec: true },
  serif: { label: "Source Serif 4", css: "'Source Serif 4', Georgia, serif", cat: "Serif", w: [400, 500, 600, 700], it: [400, 500, 600, 700], rec: true },
  fraunces: { label: "Fraunces", css: "'Fraunces', Georgia, serif", cat: "Serif", w: [300, 400, 500, 600, 700, 800], it: [300, 400, 500, 600, 700, 800], rec: true },
  playfair: { label: "Playfair Display", css: "'Playfair Display', Georgia, serif", cat: "Serif", w: [400, 500, 600, 700, 800], it: [400, 500, 600, 700, 800] },
  instrument: { label: "Instrument Serif", css: "'Instrument Serif', Georgia, serif", cat: "Serif", w: [400], it: [400], rec: true },
  cormorant: { label: "Cormorant Garamond", css: "'Cormorant Garamond', Georgia, serif", cat: "Serif", w: [300, 400, 500, 600, 700], it: [300, 400, 500, 600, 700] },
  ebgaramond: { label: "EB Garamond", css: "'EB Garamond', Georgia, serif", cat: "Serif", w: [400, 500, 600, 700, 800], it: [400, 500, 600, 700, 800] },
  newsreader: { label: "Newsreader", css: "'Newsreader', Georgia, serif", cat: "Serif", w: [300, 400, 500, 600, 700], it: [300, 400, 500, 600, 700] },
  lora: { label: "Lora", css: "'Lora', Georgia, serif", cat: "Serif", w: [400, 500, 600, 700], it: [400, 500, 600, 700] },
  baskerville: { label: "Libre Baskerville", css: "'Libre Baskerville', Georgia, serif", cat: "Serif", w: [400, 700], it: [400] },
  dmserif: { label: "DM Serif Display", css: "'DM Serif Display', Georgia, serif", cat: "Serif", w: [400], it: [400] },
  bodoni: { label: "Bodoni Moda", css: "'Bodoni Moda', Georgia, serif", cat: "Serif", w: [400, 500, 600, 700, 800], it: [400, 500, 600, 700, 800] },
  dmsans: { label: "DM Sans", css: "'DM Sans', system-ui, sans-serif", cat: "Sans", w: [300, 400, 500, 600, 700, 800], it: [300, 400, 500, 600, 700, 800] },
  jakarta: { label: "Plus Jakarta Sans", css: "'Plus Jakarta Sans', system-ui, sans-serif", cat: "Sans", w: [300, 400, 500, 600, 700, 800], it: [300, 400, 500, 600, 700, 800] },
  manrope: { label: "Manrope", css: "'Manrope', system-ui, sans-serif", cat: "Sans", w: [300, 400, 500, 600, 700, 800], it: [] },
  outfit: { label: "Outfit", css: "'Outfit', system-ui, sans-serif", cat: "Sans", w: [300, 400, 500, 600, 700, 800], it: [] },
  spacegrotesk: { label: "Space Grotesk", css: "'Space Grotesk', system-ui, sans-serif", cat: "Sans", w: [300, 400, 500, 600, 700], it: [] },
  figtree: { label: "Figtree", css: "'Figtree', system-ui, sans-serif", cat: "Sans", w: [300, 400, 500, 600, 700, 800], it: [300, 400, 500, 600, 700, 800] },
  montserrat: { label: "Montserrat", css: "'Montserrat', system-ui, sans-serif", cat: "Sans", w: [300, 400, 500, 600, 700, 800], it: [300, 400, 500, 600, 700, 800] },
  sora: { label: "Sora", css: "'Sora', system-ui, sans-serif", cat: "Sans", w: [300, 400, 500, 600, 700, 800], it: [] },
  plexsans: { label: "IBM Plex Sans", css: "'IBM Plex Sans', system-ui, sans-serif", cat: "Sans", w: [300, 400, 500, 600, 700], it: [300, 400, 500, 600, 700] },
  josefin: { label: "Josefin Sans", css: "'Josefin Sans', system-ui, sans-serif", cat: "Sans", w: [300, 400, 500, 600, 700], it: [300, 400, 500, 600, 700] },
  archivo: { label: "Archivo", css: "'Archivo', system-ui, sans-serif", cat: "Sans", w: [300, 400, 500, 600, 700, 800], it: [300, 400, 500, 600, 700, 800] },
  bebas: { label: "Bebas Neue", css: "'Bebas Neue', Impact, sans-serif", cat: "Display", w: [400], it: [] },
  anton: { label: "Anton", css: "'Anton', Impact, sans-serif", cat: "Display", w: [400], it: [] },
  abril: { label: "Abril Fatface", css: "'Abril Fatface', Impact, sans-serif", cat: "Display", w: [400], it: [] },
  syne: { label: "Syne", css: "'Syne', Impact, sans-serif", cat: "Display", w: [400, 500, 600, 700, 800], it: [] },
  unbounded: { label: "Unbounded", css: "'Unbounded', Impact, sans-serif", cat: "Display", w: [300, 400, 500, 600, 700, 800], it: [] },
  caveat: { label: "Caveat", css: "'Caveat', cursive", cat: "Handwritten", w: [400, 500, 600, 700], it: [] },
  dancing: { label: "Dancing Script", css: "'Dancing Script', cursive", cat: "Handwritten", w: [400, 500, 600, 700], it: [] },
  pacifico: { label: "Pacifico", css: "'Pacifico', cursive", cat: "Handwritten", w: [400], it: [] },
  greatvibes: { label: "Great Vibes", css: "'Great Vibes', cursive", cat: "Handwritten", w: [400], it: [] },
  homemade: { label: "Homemade Apple", css: "'Homemade Apple', cursive", cat: "Handwritten", w: [400], it: [] },
  kalam: { label: "Kalam", css: "'Kalam', cursive", cat: "Handwritten", w: [300, 400, 700], it: [] },
  jetbrains: { label: "JetBrains Mono", css: "'JetBrains Mono', ui-monospace, monospace", cat: "Mono", w: [300, 400, 500, 600, 700, 800], it: [300, 400, 500, 600, 700, 800] },
  spacemono: { label: "Space Mono", css: "'Space Mono', ui-monospace, monospace", cat: "Mono", w: [400, 700], it: [400, 700] },
  plexmono: { label: "IBM Plex Mono", css: "'IBM Plex Mono', ui-monospace, monospace", cat: "Mono", w: [300, 400, 500, 600, 700], it: [300, 400, 500, 600, 700] },
};
const FONT_CATS = ["Serif", "Sans", "Display", "Handwritten", "Mono"];
const WEIGHT_NAMES = { 300: "Light", 400: "Regular", 500: "Medium", 600: "Semibold", 700: "Bold", 800: "Extra bold" };
const fontOf = (k) => FONTS[k] || FONTS.sans;
function nearestWeight(F, w) {
  return F.w.reduce((b, x) => (Math.abs(x - w) < Math.abs(b - w) ? x : b), F.w[0]);
}
function fontCssUrl(keys, weightsOnly) {
  const fam = keys.map((k) => {
    const F = fontOf(k), n = F.label.replace(/ /g, "+");
    if (weightsOnly) return `family=${n}:wght@${nearestWeight(F, 400)}`;
    return F.it.length
      ? `family=${n}:ital,wght@${[...F.w.map((x) => `0,${x}`), ...F.it.map((x) => `1,${x}`)].join(";")}`
      : `family=${n}:wght@${F.w.join(";")}`;
  });
  return `https://fonts.googleapis.com/css2?${fam.join("&")}&display=swap`;
}
// Load a font's stylesheet once, then the faces a layer needs.
const _fontSheets = new Map(), _fontFaces = new Map();
function ensureFontSheet(k) {
  if (!_fontSheets.has(k)) {
    _fontSheets.set(k, new Promise((res) => {
      const l = document.createElement("link");
      l.rel = "stylesheet"; l.href = fontCssUrl([k]);
      l.onload = () => res(); l.onerror = () => res();
      document.head.appendChild(l);
      setTimeout(res, 6000);
    }));
  }
  return _fontSheets.get(k);
}
async function ensureFace(k, weight, italic) {
  const id = `${k}|${weight}|${italic ? 1 : 0}`;
  if (!_fontFaces.has(id)) {
    _fontFaces.set(id, ensureFontSheet(k).then(() => document.fonts.load(`${italic ? "italic " : ""}${weight} 40px ${fontOf(k).css}`)).catch(() => null));
  }
  return _fontFaces.get(id);
}
async function ensureFontsFor(layers) {
  const jobs = [];
  for (const L of layers || []) {
    if (L.type !== "text") continue;
    const F = fontOf(L.font), w = nearestWeight(F, L.weight || 400);
    jobs.push(ensureFace(L.font in FONTS ? L.font : "sans", w, !!L.italic && F.it.length > 0));
  }
  await Promise.all(jobs);
}
const PALETTE = ["#0f172a", "#334155", "#5b6678", "#f8f7f3", "#fdfcf9", "#c9962e", "#9a5a2e", "#7a2e3a", "#c97b84", "#5f7a61", "#3b6e8f", "#1e3a5f"];
const PAPER = "#f8f7f3";

const uid = () => Math.random().toString(36).slice(2, 9);
const clone = (o) => JSON.parse(JSON.stringify(o));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ─── Assets ─────────────────────────────────────────────────────────────────
let _lib = null;
async function loadLibrary() {
  if (_lib) return _lib;
  const bust = `v=${Date.now() >> 20}`;
  const [lib, stories] = await Promise.all([
    fetch(`/beta/social/library.json?${bust}`, { cache: "no-cache" }).then((r) => r.ok ? r.json() : { backgrounds: [], elements: [] }).catch(() => ({ backgrounds: [], elements: [] })),
    fetch(`/beta/social/backgrounds.json?${bust}`, { cache: "no-cache" }).then((r) => r.ok ? r.json() : { backgrounds: [] }).catch(() => ({ backgrounds: [] })),
  ]);
  const storyBgs = (stories.backgrounds || []).map((b) => ({
    id: b.id, title: b.title, image: b.image, thumb: b.thumb, tone: b.tone || "dark", inkTop: b.inkTop || 0.44,
    square: b.square, squareInkTop: b.squareInkTop,
    cat: b.group === "article" ? "Stories" : b.group === "edition" ? "Editions" : "Series",
    preset: b.preset, caption: b.caption, articleId: b.articleId, articleSlug: b.articleSlug, articleTitle: b.articleTitle,
  }));
  _lib = {
    backgrounds: [...storyBgs, ...(lib.backgrounds || [])],
    elements: lib.elements || [],
  };
  return _lib;
}

const _imgCache = new Map();
function proxied(src) {
  try {
    const u = new URL(src, location.origin);
    if (u.origin === location.origin || src.startsWith("data:") || src.startsWith("blob:")) return src;
    return `/api/image-proxy?url=${encodeURIComponent(u.href)}`;
  } catch { return src; }
}
function loadImg(src) {
  if (!src) return Promise.reject(new Error("no image"));
  if (_imgCache.has(src)) return _imgCache.get(src);
  const p = new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => { _imgCache.delete(src); reject(new Error("Image failed to load")); };
    img.src = proxied(src);
  });
  _imgCache.set(src, p);
  return p;
}

let _fontsP = null;
function fontsReady() {
  if (!_fontsP) {
    _fontsP = Promise.all([
      "400 40px Poppins", "500 40px Poppins", "600 40px Poppins", "700 40px Poppins",
      "400 40px 'Source Serif 4'", "600 40px 'Source Serif 4'", "italic 400 40px 'Source Serif 4'", "italic 600 40px 'Source Serif 4'",
    ].map((f) => document.fonts.load(f).catch(() => null)));
  }
  return _fontsP;
}

// ─── Text layout ────────────────────────────────────────────────────────────
function fontFor(L, italicRun) {
  const F = fontOf(L.font);
  // *Accent* words: the brand serif italic, unless the font has its own italics
  // (Poppins keeps the serif accent — it's the house style).
  if (italicRun && (L.font === "sans" || !L.font || !F.it.length)) return `italic 400 ${L.size * 1.04}px ${FONTS.serif.css}`;
  const italic = (L.italic || italicRun) && F.it.length > 0;
  const weight = nearestWeight(F, L.weight || 400);
  return `${italic ? "italic " : ""}${weight} ${L.size}px ${F.css}`;
}
function runsOf(L) {
  const text = L.upper ? String(L.text || "").toUpperCase() : String(L.text || "");
  if (L.markup === false) return [{ text, italic: false }];
  const out = [];
  text.split(/(\*[^*\n]+\*)/).forEach((part) => {
    if (!part) return;
    const it = /^\*[^*\n]+\*$/.test(part);
    out.push({ text: it ? part.slice(1, -1) : part, italic: it });
  });
  return out;
}
// Lines of words [{text, italic, w}] wrapped to L.w; honours \n.
function layoutText(ctx, L) {
  const ls = (L.ls || 0) * L.size;
  const lines = [];
  const paras = [];
  let cur = [];
  for (const r of runsOf(L)) {
    const bits = r.text.split("\n");
    bits.forEach((b, i) => {
      if (i > 0) { paras.push(cur); cur = []; }
      if (b) cur.push({ text: b, italic: r.italic });
    });
  }
  paras.push(cur);
  for (const para of paras) {
    const words = [];
    para.forEach((r) => r.text.split(/(\s+)/).forEach((w) => { if (w) words.push({ text: w, italic: r.italic }); }));
    let line = [], width = 0;
    for (const w of words) {
      ctx.font = fontFor(L, w.italic);
      const ww = ctx.measureText(w.text).width + ls * w.text.length;
      const space = /^\s+$/.test(w.text);
      if (!space && line.length && width + ww > L.w + 0.5) {
        while (line.length && /^\s+$/.test(line[line.length - 1].text)) { width -= line.pop().w; }
        lines.push({ words: line, width });
        line = []; width = 0;
      }
      if (space && !line.length) continue;
      line.push({ ...w, w: ww });
      width += ww;
    }
    while (line.length && /^\s+$/.test(line[line.length - 1].text)) { width -= line.pop().w; }
    lines.push({ words: line, width });
  }
  const lh = L.size * (L.lh || 1.15);
  return { lines, lh, height: Math.max(lh, lines.length * lh) };
}

// ─── Rendering ──────────────────────────────────────────────────────────────
function roundRect(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r || 0, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

async function drawImageBox(ctx, src, x, y, w, h, fit = "cover", radius = 0, focusY = 0.5) {
  const img = await loadImg(src);
  const iw = img.naturalWidth, ih = img.naturalHeight;
  ctx.save();
  if (radius) { roundRect(ctx, x, y, w, h, radius); ctx.clip(); }
  if (fit === "contain") {
    const s = Math.min(w / iw, h / ih);
    ctx.drawImage(img, x + (w - iw * s) / 2, y + (h - ih * s) / 2, iw * s, ih * s);
  } else {
    const s = Math.max(w / iw, h / ih);
    const dw = iw * s, dh = ih * s;
    ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) * focusY, dw, dh);
  }
  ctx.restore();
  return img;
}

// ─── Eraser ─────────────────────────────────────────────────────────────────
// Erasing is stored as brush strokes, never baked into the image, so it can
// be undone and it follows the image when it's moved or resized.
//   strokes: [{ m: "e" (erase) | "r" (restore), r: radius, s: softness 0–1,
//               p: [u, v, u, v, …] }]
// u/v are 0–1 across the image box; r is a fraction of the box width.
const _maskCache = new Map();
function strokesKey(strokes, w, h) {
  return `${Math.round(w)}x${Math.round(h)}|` + strokes.map((k) => `${k.m}${k.r}${k.s}:${k.p.length}:${k.p[0]},${k.p[1]},${k.p[k.p.length - 2]},${k.p[k.p.length - 1]}`).join(";");
}
function stampLine(g, pts, rpx, soft, W, H) {
  const dab = (x, y) => {
    const grd = g.createRadialGradient(x, y, Math.max(0, rpx * (1 - soft)), x, y, rpx);
    grd.addColorStop(0, "rgba(0,0,0,1)"); grd.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grd;
    g.beginPath(); g.arc(x, y, rpx, 0, Math.PI * 2); g.fill();
  };
  const step = Math.max(1, rpx * (soft > 0.05 ? 0.18 : 0.3));
  let px = pts[0] * W, py = pts[1] * H;
  dab(px, py);
  for (let i = 2; i < pts.length; i += 2) {
    const x = pts[i] * W, y = pts[i + 1] * H, d = Math.hypot(x - px, y - py);
    for (let t = step; t <= d; t += step) dab(px + (x - px) * (t / d), py + (y - py) * (t / d));
    px = x; py = y;
  }
}
function eraseMask(strokes, w, h) {
  const key = strokesKey(strokes, w, h);
  if (_maskCache.has(key)) return _maskCache.get(key);
  const k = Math.min(1, 2048 / Math.max(w, h));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
  const g = c.getContext("2d");
  for (const st of strokes) {
    if (!st.p || st.p.length < 2) continue;
    g.globalCompositeOperation = st.m === "r" ? "destination-out" : "source-over";
    stampLine(g, st.p, Math.max(1, st.r * w * k), clamp(st.s ?? 0.35, 0, 0.95), c.width, c.height);
  }
  if (_maskCache.size > 40) _maskCache.delete(_maskCache.keys().next().value);
  _maskCache.set(key, c);
  return c;
}
// Draw `paint` into a w×h scratch canvas, cut the erased parts, then place it.
async function drawErased(ctx, strokes, x, y, w, h, paint) {
  const off = document.createElement("canvas");
  off.width = Math.max(1, Math.ceil(w)); off.height = Math.max(1, Math.ceil(h));
  const g = off.getContext("2d");
  await paint(g);
  g.globalCompositeOperation = "destination-out";
  g.drawImage(eraseMask(strokes, w, h), 0, 0, off.width, off.height);
  ctx.drawImage(off, x, y, w, h);
}
const hasErase = (o) => Array.isArray(o?.erase) && o.erase.some((k) => k.p && k.p.length >= 2);

async function drawBgImage(ctx, bg, W, H) {
  if (bg.fit === "bottom") {
    // Fit the width, anchor to the bottom, paper colour above.
    const img = await loadImg(bg.image);
    const s = W / img.naturalWidth;
    const dh = img.naturalHeight * s;
    if (dh < H) {
      ctx.fillStyle = bg.color || PAPER;
      ctx.fillRect(0, 0, W, H);
      ctx.drawImage(img, 0, H - dh, W, dh);
      // soft seam: fade the top edge of the image into the paper above
      const g = ctx.createLinearGradient(0, H - dh, 0, H - dh + 120);
      g.addColorStop(0, bg.color || PAPER);
      g.addColorStop(1, hexA(bg.color || PAPER, 0));
      ctx.fillStyle = g;
      ctx.fillRect(0, H - dh, W, 120);
    } else {
      await drawImageBox(ctx, bg.image, 0, 0, W, H, "cover", 0, 1);
    }
  } else {
    await drawImageBox(ctx, bg.image, 0, 0, W, H, "cover", 0, bg.focusY ?? 0.5);
  }
}

// Draw one page into ctx (already scaled to page units). `skip` = layer id
// not to draw (being edited in place).
export async function renderPage(ctx, page, fmt, { skip = null } = {}) {
  await Promise.all([fontsReady(), ensureFontsFor(page.layers)]);
  const W = fmt.w, H = fmt.h;
  const bg = page.bg || {};
  ctx.save();
  ctx.fillStyle = bg.color || PAPER;
  ctx.fillRect(0, 0, W, H);
  if (bg.image) {
    try {
      if (hasErase(bg)) await drawErased(ctx, bg.erase, 0, 0, W, H, (g) => drawBgImage(g, bg, W, H));
      else await drawBgImage(ctx, bg, W, H);
    } catch {}
  }
  if (bg.image && bg.tintColor && bg.tintAlpha > 0) { ctx.fillStyle = hexA(bg.tintColor, bg.tintAlpha); ctx.fillRect(0, 0, W, H); }
  else if (bg.tint) { ctx.fillStyle = bg.tint; ctx.fillRect(0, 0, W, H); }
  ctx.restore();

  for (const L of page.layers || []) {
    if (L.hidden || L.id === skip) continue;
    ctx.save();
    ctx.globalAlpha = L.opacity ?? 1;
    try {
      if (L.type === "text") drawText(ctx, L);
      else if (L.type === "image") {
        if (L.blend === "multiply") ctx.globalCompositeOperation = "multiply";
        if (hasErase(L)) await drawErased(ctx, L.erase, L.x, L.y, L.w, L.h, (g) => drawImageBox(g, L.src, 0, 0, L.w, L.h, L.fit || "contain", L.radius || 0));
        else await drawImageBox(ctx, L.src, L.x, L.y, L.w, L.h, L.fit || "contain", L.radius || 0);
        if (L.stroke && L.sw) { ctx.globalCompositeOperation = "source-over"; ctx.strokeStyle = L.stroke; ctx.lineWidth = L.sw; roundRect(ctx, L.x, L.y, L.w, L.h, L.radius || 0); ctx.stroke(); }
      } else if (L.type === "rect") {
        roundRect(ctx, L.x, L.y, L.w, L.h, L.radius || 0);
        if (L.fill) { ctx.fillStyle = L.fill; ctx.fill(); }
        if (L.stroke && L.sw) { ctx.strokeStyle = L.stroke; ctx.lineWidth = L.sw; ctx.stroke(); }
      } else if (L.type === "ellipse") {
        ctx.beginPath();
        ctx.ellipse(L.x + L.w / 2, L.y + L.h / 2, L.w / 2, L.h / 2, 0, 0, Math.PI * 2);
        if (L.fill) { ctx.fillStyle = L.fill; ctx.fill(); }
        if (L.stroke && L.sw) { ctx.strokeStyle = L.stroke; ctx.lineWidth = L.sw; ctx.stroke(); }
      } else if (L.type === "line") {
        ctx.fillStyle = L.fill || L.stroke || "#0f172a";
        ctx.fillRect(L.x, L.y + (L.h - (L.sw || 2)) / 2, L.w, L.sw || 2);
      }
    } catch {}
    ctx.restore();
  }
}

function hexA(hex, a) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return `rgba(248,247,243,${a})`;
  const n = parseInt(m[1], 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}

function drawText(ctx, L) {
  const { lines, lh, height } = layoutText(ctx, L);
  L.h = height;   // keep the box height in sync for hit-testing and handles
  const ls = (L.ls || 0) * L.size;
  if (L.bg) {
    const pad = L.pad ?? L.size * 0.35;
    ctx.fillStyle = L.bg;
    roundRect(ctx, L.x - pad, L.y - pad * 0.6, L.w + pad * 2, height + pad * 1.2, L.bgRadius ?? pad);
    ctx.fill();
  }
  ctx.fillStyle = L.color || "#0f172a";
  ctx.textBaseline = "alphabetic";
  let y = L.y;
  for (const line of lines) {
    y += lh;
    let x = L.x;
    if (L.align === "center") x += (L.w - line.width) / 2;
    else if (L.align === "right") x += L.w - line.width;
    const base = y - lh * 0.22 - (lh - L.size * 1.15) * 0.5;
    for (const w of line.words) {
      ctx.font = fontFor(L, w.italic);
      if ("letterSpacing" in ctx) {
        ctx.letterSpacing = `${ls}px`;
        ctx.fillText(w.text, x, base);
      } else {
        let cx = x;
        for (const ch of w.text) { ctx.fillText(ch, cx, base); cx += ctx.measureText(ch).width + ls; }
      }
      x += w.w;
    }
  }
  if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
}

// Apply the template layout hints (maxH/minSize, after) once, then drop them
// so later edits by hand aren't undone. Fonts must be loaded.
const _measure = document.createElement("canvas").getContext("2d");
function textHeight(L) { return layoutText(_measure, L).height; }
export function settleLayout(page) {
  const byName = {};
  for (const L of page.layers) {
    if (L.type === "text" && L.maxH > 0) {
      const min = L.minSize || L.size * 0.5;
      let guard = 40;
      while (textHeight(L) > L.maxH && L.size > min && guard--) L.size = Math.max(min, Math.round(L.size * 0.95 * 10) / 10);
    } else if (L.type === "text" && L.maxH <= 0 && L.minSize) {
      L.size = L.minSize;
    }
    if (L.after) {
      const ref = byName[L.after[0]];
      if (ref) L.y = Math.round(ref.y + (ref.type === "text" ? textHeight(ref) : ref.h || 0) + L.after[1]);
    }
    if (L.type === "text") L.h = textHeight(L);
    delete L.maxH; delete L.minSize; delete L.after;
    if (L.name) byName[L.name] = L;
  }
  return page;
}

// For other modules that build pages: load the faces these layers use, so
// settleLayout measures with the real fonts.
export async function loadFontsFor(layers) { await Promise.all([fontsReady(), ensureFontsFor(layers)]); }

export async function renderDesignPage(design, index, scale = 1) {
  const fmt = FORMATS[design.format] || FORMATS.post;
  const c = document.createElement("canvas");
  c.width = Math.round(fmt.w * scale);
  c.height = Math.round(fmt.h * scale);
  const ctx = c.getContext("2d");
  ctx.scale(scale, scale);
  await renderPage(ctx, design.pages[index], fmt);
  return c;
}

// ─── Templates ──────────────────────────────────────────────────────────────
// Each builds a page for a W×H canvas. `c` = content (headline, kicker, …);
// `ink` = the y where the background's drawing starts (text stays above it).
// Layout hints, settled once when the page is made (see settleLayout):
//   maxH + minSize → the type shrinks until the block fits
//   after: [name, gap] → placed under the named layer
const T = (o) => ({ id: uid(), opacity: 1, ...o });
const txt = (o) => T({ type: "text", font: "sans", weight: 400, size: 40, color: "#0f172a", align: "left", lh: 1.15, ls: 0, markup: true, h: 50, ...o });
// The Catalyst logo lockup (mark + wordmark), ink for light pages, paper for
// dark ones. Files in /beta/social/brand/ (made from NewLogoShape.png).
const LOCKUP = { h: { w: 1033, h: 258 }, s: { w: 622, h: 316 } };
const isLightColor = (c) => { const m = /^#?([0-9a-f]{6})$/i.exec(c || ""); if (!m) return false; const n = parseInt(m[1], 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) > 150; };
function logo(x, y, h, { tone = "ink", stacked = false } = {}) {
  const L = LOCKUP[stacked ? "s" : "h"];
  const w = Math.round(h * L.w / L.h);
  return T({ type: "image", src: `/beta/social/brand/${stacked ? "lockup-stacked" : "lockup"}-${tone}.png?v=1`, x: x === "center" ? null : x, y, w, h, fit: "contain", name: "Logo" });
}
function centeredLogo(W, y, h, opts) { const L = logo(0, y, h, opts); L.x = Math.round((W - L.w) / 2); return L; }
function brandLine(W, color = "#5b6678", y = 72) {
  const tone = isLightColor(color) ? "paper" : "ink";
  return [
    logo(88, y - 18, 56, { tone }),
    txt({ text: "catalyst-magazine.com", x: W - 88 - 420, y: y - 1, w: 420, size: 19, weight: 500, ls: 0.02, align: "right", color, opacity: 0.85, markup: false, name: "Website" }),
  ];
}
function kicker(text, x, y, color = "#5b6678", w = 700) {
  return [
    T({ type: "line", x, y: y + 6, w: 34, h: 14, sw: 2, fill: color, name: "Kicker rule" }),
    txt({ text, x: x + 50, y, w, size: 23, weight: 600, ls: 0.16, upper: true, color, markup: false, name: "Kicker" }),
  ];
}

const TEMPLATES = [
  { id: "headline-top", name: "Headline on paper", cat: "Story", bg: "art-venus",
    build: (W, H, c, ink) => [
      ...brandLine(W), ...kicker(c.kicker || "New feature", 88, 150),
      txt({ text: c.headline || "What Venus says about *us*", x: 88, y: 196, w: W - 176, size: 84, weight: 700, lh: 1.04, ls: -0.035, name: "Headline", maxH: ink - 196 - 130, minSize: 52 }),
      txt({ text: c.sub || "NASA's DAVINCI mission and humanity's place in space.", x: 88, y: 0, w: W - 260, size: 34, font: "serif", color: "#334155", lh: 1.35, name: "Line", after: ["Headline", 22], maxH: 100, minSize: 26 }),
    ] },
  { id: "headline-bottom", name: "Headline on a card", cat: "Story", bg: "dc-reading-room", bgFocus: 0.3,
    build: (W, H, c, ink) => [
      T({ type: "rect", x: 56, y: H - 470, w: W - 112, h: 414, radius: 24, fill: "#fdfcf9", opacity: 0.94, name: "Card" }),
      ...kicker(c.kicker || "Science in the Capital", 104, H - 420),
      txt({ text: c.headline || "Where D.C. *does science*", x: 104, y: H - 372, w: W - 208, size: 72, weight: 700, lh: 1.05, ls: -0.035, name: "Headline", maxH: 160, minSize: 44 }),
      txt({ text: c.sub || "The labs, museums and people behind the research in our city.", x: 104, y: H - 200, w: W - 208, size: 30, font: "serif", color: "#334155", lh: 1.4, name: "Line" }),
      logo(104, 54, 56, { tone: "paper" }),
    ] },
  { id: "quote", name: "Quote card", cat: "Quote", bg: "series-quote",
    build: (W, H, c, ink) => [
      ...brandLine(W),
      txt({ text: "“", x: 76, y: 150, w: 200, size: 220, font: "serif", italic: true, color: "#c9962e", lh: 0.9, markup: false, name: "Quote mark" }),
      txt({ text: c.headline || "You can’t connect the dots looking forward; you can only connect them *looking backwards.*", x: 88, y: 330, w: W - 176, size: 58, font: "serif", weight: 400, lh: 1.25, name: "Quote", maxH: ink - 330 - 90, minSize: 36 }),
      txt({ text: c.sub || "— Steve Jobs", x: 88, y: 0, w: W - 176, size: 26, weight: 600, ls: 0.06, color: "#5b6678", markup: false, name: "Attribution", after: ["Quote", 32] }),
    ] },
  { id: "stat", name: "Big number", cat: "Data", bg: "wash-sage",
    build: (W, H, c, ink) => [
      ...brandLine(W),
      ...kicker(c.kicker || "By the numbers", 88, 190),
      txt({ text: c.headline || "1 in 4", x: 80, y: 250, w: W - 160, size: 260, weight: 700, lh: 1, ls: -0.05, name: "Number" }),
      txt({ text: c.sub || "hookworm infections worldwide are in children, and the main drugs are losing their power.", x: 88, y: 0, w: W - 176, size: 42, font: "serif", lh: 1.3, color: "#334155", name: "Explanation", after: ["Number", 20] }),
      txt({ text: "Source: [add source]", x: 88, y: H - 130, w: W - 176, size: 22, color: "#5b6678", markup: false, name: "Source" }),
    ] },
  { id: "list", name: "Three things", cat: "Data", bg: "wash-paper",
    build: (W, H, c, ink) => {
      const items = c.items || ["Antibiotics also hit the good bacteria in your gut.", "That damage fuels resistance and makes people sick.", "GW researchers are designing drugs that pick their targets."];
      const top = Math.round(H * 0.34), gap = Math.round((H - top - 140) / 3);
      return [
        ...brandLine(W),
        ...kicker(c.kicker || "Three things to know", 88, 160),
        txt({ text: c.headline || "Saving the *good* guys", x: 88, y: 206, w: W - 176, size: 76, weight: 700, lh: 1.04, ls: -0.035, name: "Headline", maxH: top - 206 - 40, minSize: 48 }),
        ...items.flatMap((t, i) => [
          T({ type: "line", x: 88, y: top + i * gap, w: W - 176, h: 2, sw: 1.5, fill: "rgba(15,23,42,.18)", name: `Rule ${i + 1}` }),
          txt({ text: String(i + 1).padStart(2, "0"), x: 88, y: top + i * gap + 24, w: 120, size: 44, font: "serif", italic: true, color: "#c9962e", markup: false, name: `Number ${i + 1}` }),
          txt({ text: t, x: 220, y: top + i * gap + 26, w: W - 308, size: 36, font: "serif", lh: 1.35, name: `Item ${i + 1}` }),
        ]),
      ];
    } },
  { id: "edition", name: "Edition cover", cat: "Edition", bg: "night-capitol",
    build: (W, H, c, ink) => [
      txt({ text: c.kicker || "THE CATALYST · NO. 05", x: 88, y: 110, w: W - 176, size: 24, weight: 600, ls: 0.22, align: "center", color: "#e8d9b0", markup: false, name: "Kicker" }),
      txt({ text: c.headline || "The Fall 2026 *Edition*", x: 88, y: 170, w: W - 176, size: 96, weight: 700, lh: 1.02, ls: -0.04, align: "center", color: "#f8f7f3", name: "Title", maxH: ink - 170 - 170, minSize: 56 }),
      txt({ text: c.sub || "New Frontiers in the Capital", x: 88, y: 0, w: W - 176, size: 40, font: "serif", italic: true, align: "center", color: "#e8d9b0", markup: false, name: "Theme", after: ["Title", 22] }),
      T({ type: "rect", x: W / 2 - 170, y: 0, w: 340, h: 64, radius: 32, fill: "rgba(248,247,243,.12)", stroke: "rgba(248,247,243,.5)", sw: 1.5, name: "Button", after: ["Theme", 30] }),
      txt({ text: "Read it now", x: W / 2 - 170, y: 0, w: 340, size: 26, weight: 600, align: "center", color: "#f8f7f3", markup: false, name: "Button text", after: ["Theme", 40] }),
    ] },
  { id: "coming-soon", name: "Coming soon", cat: "Edition", bg: "ed-winter-2027",
    build: (W, H, c, ink) => [
      ...brandLine(W),
      T({ type: "rect", x: 88, y: 150, w: 290, h: 54, radius: 27, fill: "#0f172a", name: "Pill" }),
      txt({ text: c.kicker || "Coming in December", x: 88, y: 160, w: 290, size: 22, weight: 600, align: "center", color: "#f8f7f3", markup: false, name: "Pill text" }),
      txt({ text: c.headline || "The Winter 2027 *edition*", x: 88, y: 236, w: W - 176, size: 86, weight: 700, lh: 1.03, ls: -0.035, name: "Headline", maxH: ink - 236 - 90, minSize: 52 }),
      txt({ text: c.sub || "Medical Innovation in the Capital.", x: 88, y: 0, w: W - 176, size: 36, font: "serif", color: "#334155", name: "Line", after: ["Headline", 22] }),
    ] },
  { id: "season-fall", name: "Fall edition", cat: "Edition", bg: "season-fall-georgetown",
    build: (W, H, c, ink) => [
      ...brandLine(W, "#7a4a24"),
      txt({ text: c.kicker || "Out now · The Fall Edition", x: 88, y: 150, w: W - 176, size: 24, weight: 600, ls: 0.16, upper: true, color: "#9a5a2e", markup: false, name: "Kicker" }),
      txt({ text: c.headline || "New Frontiers *in the Capital*", x: 88, y: 196, w: W - 176, size: 90, weight: 700, lh: 1.03, ls: -0.04, name: "Headline", maxH: ink - 196 - 100, minSize: 52 }),
      txt({ text: c.sub || "Twelve stories from the labs, clinics and museums of D.C.", x: 88, y: 0, w: W - 260, size: 32, font: "serif", color: "#334155", name: "Line", after: ["Headline", 22] }),
    ] },
  { id: "season-winter", name: "Winter edition", cat: "Edition", bg: "season-winter-library",
    build: (W, H, c, ink) => [
      ...brandLine(W, "#3b5b7a"),
      T({ type: "rect", x: 88, y: 150, w: 300, h: 52, radius: 26, fill: "#1e3a5f", name: "Pill" }),
      txt({ text: c.kicker || "The Winter Edition", x: 88, y: 160, w: 300, size: 21, weight: 600, align: "center", color: "#f8f7f3", markup: false, name: "Pill text" }),
      txt({ text: c.headline || "Medicine for a *colder* season", x: 88, y: 232, w: W - 176, size: 88, weight: 700, lh: 1.04, ls: -0.04, color: "#1e2a3a", name: "Headline", maxH: ink - 232 - 100, minSize: 52 }),
      txt({ text: c.sub || "Arriving in December · catalyst-magazine.com", x: 88, y: 0, w: W - 176, size: 30, font: "serif", italic: true, color: "#3b5b7a", markup: false, name: "Line", after: ["Headline", 22] }),
    ] },
  { id: "season-spring", name: "Spring edition", cat: "Edition", bg: "season-spring-tidal",
    build: (W, H, c, ink) => [
      txt({ text: c.kicker || "THE CATALYST · SPRING", x: 88, y: 110, w: W - 176, size: 23, weight: 600, ls: 0.22, align: "center", color: "#b0606e", markup: false, name: "Kicker" }),
      txt({ text: c.headline || "Everything *in bloom*", x: 88, y: 168, w: W - 176, size: 100, font: "serif", weight: 400, lh: 1.02, ls: -0.02, align: "center", color: "#1e2a3a", name: "Headline", maxH: ink - 168 - 110, minSize: 56 }),
      txt({ text: c.sub || "The Spring Edition · coming in March", x: 88, y: 0, w: W - 176, size: 30, weight: 500, align: "center", color: "#5b6678", markup: false, name: "Line", after: ["Headline", 24] }),
    ] },
  { id: "hiring-writers", name: "Writers wanted", cat: "Announcement", bg: "wash-blush",
    build: (W, H, c) => [
      ...brandLine(W),
      T({ type: "image", src: "/beta/social/el/people-writer.webp?v=2", x: W - 88 - 520, y: H - 60 - 560, w: 520, h: 560, fit: "contain", name: "Writer" }),
      ...kicker(c.kicker || "Join the newsroom", 88, 160),
      txt({ text: c.headline || "Love science? *Write about it.*", x: 88, y: 206, w: W - 176, size: 86, weight: 700, lh: 1.04, ls: -0.035, name: "Headline", maxH: Math.round(H * 0.3), minSize: 52 }),
      txt({ text: c.sub || "No experience needed. We train every new writer.", x: 88, y: 0, w: W - 400, size: 32, font: "serif", color: "#334155", name: "Line", after: ["Headline", 22] }),
    ] },
  { id: "speaker-event", name: "Talk / speaker", cat: "Announcement", bg: "wash-paper",
    build: (W, H, c) => [
      ...brandLine(W),
      T({ type: "image", src: "/beta/social/el/people-speaker.webp?v=2", x: W / 2 - 230, y: H - 60 - 470, w: 460, h: 470, fit: "contain", name: "Speaker" }),
      txt({ text: c.kicker || "Thursday · 6 pm · Science & Engineering Hall", x: 88, y: 160, w: W - 176, size: 23, weight: 600, ls: 0.12, upper: true, align: "center", color: "#5b6678", markup: false, name: "Kicker" }),
      txt({ text: c.headline || "How a vaccine *gets made*", x: 88, y: 208, w: W - 176, size: 88, weight: 700, lh: 1.04, ls: -0.035, align: "center", name: "Title", maxH: Math.round(H * 0.3), minSize: 52 }),
      txt({ text: c.sub || "A talk with Dr. Maya Chen · free and open to all", x: 88, y: 0, w: W - 176, size: 30, font: "serif", italic: true, align: "center", color: "#334155", markup: false, name: "Line", after: ["Title", 22] }),
    ] },
  { id: "body-fact", name: "Body fact", cat: "Data", bg: "wash-sage",
    build: (W, H, c) => [
      ...brandLine(W),
      T({ type: "image", src: "/beta/social/el/med-heart.webp?v=2", x: W - 88 - 360, y: H - 80 - 420, w: 360, h: 420, fit: "contain", name: "Heart" }),
      ...kicker(c.kicker || "Your body, explained", 88, 160),
      txt({ text: c.headline || "100,000", x: 80, y: 210, w: W - 160, size: 200, weight: 700, lh: 1, ls: -0.05, name: "Number" }),
      txt({ text: c.sub || "times a day, your heart beats, without you thinking about it once.", x: 88, y: 0, w: W - 520, size: 40, font: "serif", lh: 1.3, color: "#334155", name: "Explanation", after: ["Number", 24] }),
    ] },
  { id: "ask-doctor", name: "Ask a doctor", cat: "Health", bg: "wash-paper",
    build: (W, H, c) => [
      ...brandLine(W),
      T({ type: "image", elId: "med-consult", x: 88, y: Math.round(H * 0.5), w: W - 176, h: Math.round(H * 0.42), fit: "contain" }),
      T({ type: "rect", x: 88, y: 150, w: 230, h: 52, radius: 26, fill: "#3b6e8f", name: "Pill" }),
      txt({ text: c.kicker || "Ask a doctor", x: 88, y: 160, w: 230, size: 21, weight: 600, align: "center", color: "#fdfcf9", markup: false, name: "Pill text" }),
      txt({ text: c.headline || "Is it a cold, *or the flu?*", x: 88, y: 232, w: W - 176, size: 86, weight: 700, lh: 1.04, ls: -0.035, name: "Question", maxH: Math.round(H * 0.22), minSize: 50 }),
      txt({ text: c.sub || "A GW physician answers. Read it at the link in bio.", x: 88, y: 0, w: W - 176, size: 30, font: "serif", color: "#334155", name: "Line", after: ["Question", 20] }),
    ] },
  { id: "myth-fact", name: "Myth vs fact", cat: "Health", bg: "wash-paper",
    build: (W, H, c) => {
      const mid = Math.round(H * 0.56);
      return [
        ...brandLine(W),
        ...kicker(c.kicker || "Health myths", 88, 150),
        T({ type: "rect", x: 88, y: 210, w: 150, h: 50, radius: 25, fill: "#7a2e3a", name: "Myth pill" }),
        txt({ text: "MYTH", x: 88, y: 220, w: 150, size: 21, weight: 700, ls: 0.16, align: "center", color: "#fdfcf9", markup: false, name: "Myth label" }),
        txt({ text: c.headline || "You lose most of your body heat *through your head.*", x: 88, y: 284, w: W - 176, size: 54, font: "serif", lh: 1.22, color: "#5b6678", name: "Myth", maxH: mid - 284 - 50, minSize: 34 }),
        T({ type: "line", x: 88, y: mid, w: W - 176, h: 2, sw: 1.5, fill: "rgba(15,23,42,.2)", name: "Divider" }),
        T({ type: "rect", x: 88, y: mid + 46, w: 150, h: 50, radius: 25, fill: "#5f7a61", name: "Fact pill" }),
        txt({ text: "FACT", x: 88, y: mid + 56, w: 150, size: 21, weight: 700, ls: 0.16, align: "center", color: "#fdfcf9", markup: false, name: "Fact label" }),
        txt({ text: c.sub || "Your head loses heat like any other uncovered part of your body: about *10 percent.*", x: 88, y: mid + 120, w: W - 176, size: 54, weight: 600, lh: 1.18, ls: -0.02, name: "Fact", maxH: H - mid - 120 - 80, minSize: 34 }),
      ];
    } },
  { id: "know-the-signs", name: "Know the signs", cat: "Health", bg: "wash-blush",
    build: (W, H, c) => {
      const items = c.items || [["F", "Face drooping on one side"], ["A", "Arm weakness or numbness"], ["S", "Speech that is slurred or strange"], ["T", "Time to call 911, right away"]];
      const top = Math.round(H * 0.33), gap = Math.round((H - top - 110) / items.length);
      return [
        ...brandLine(W),
        ...kicker(c.kicker || "Know the signs", 88, 150),
        txt({ text: c.headline || "Stroke? Think *FAST.*", x: 88, y: 196, w: W - 176, size: 84, weight: 700, lh: 1.04, ls: -0.035, name: "Headline", maxH: top - 196 - 30, minSize: 50 }),
        ...items.flatMap(([n, t], i) => [
          T({ type: "ellipse", x: 88, y: top + i * gap, w: 96, h: 96, fill: "#7a2e3a", name: `Badge ${i + 1}` }),
          txt({ text: n, x: 88, y: top + i * gap + 20, w: 96, size: 46, weight: 700, align: "center", color: "#fdfcf9", markup: false, name: `Letter ${i + 1}` }),
          txt({ text: t, x: 214, y: top + i * gap + 24, w: W - 302, size: 38, font: "serif", lh: 1.3, name: `Item ${i + 1}` }),
        ]),
      ];
    } },
  { id: "research-breakthrough", name: "New research", cat: "Health", bg: "med-bg-lab",
    build: (W, H, c, ink) => [
      ...brandLine(W), ...kicker(c.kicker || "New research", 88, 150),
      txt({ text: c.headline || "A blood test that spots Alzheimer’s *years earlier*", x: 88, y: 196, w: W - 176, size: 80, weight: 700, lh: 1.05, ls: -0.035, name: "Headline", maxH: ink - 196 - 110, minSize: 48 }),
      txt({ text: c.sub || "What it could mean for patients, and what it can’t do yet.", x: 88, y: 0, w: W - 260, size: 32, font: "serif", color: "#334155", name: "Line", after: ["Headline", 22] }),
    ] },
  { id: "mental-health", name: "Mental health", cat: "Health", bg: "wash-lavender",
    build: (W, H, c) => [
      ...brandLine(W),
      T({ type: "image", elId: "med-mental-health", x: W / 2 - 260, y: Math.round(H * 0.5), w: 520, h: Math.round(H * 0.44), fit: "contain" }),
      txt({ text: c.kicker || "Mental health matters", x: 100, y: 170, w: W - 200, size: 23, weight: 600, ls: 0.16, upper: true, align: "center", color: "#6b5b8a", markup: false, name: "Kicker" }),
      txt({ text: c.headline || "It’s okay to *not be okay.*", x: 100, y: 220, w: W - 200, size: 88, weight: 700, lh: 1.04, ls: -0.035, align: "center", name: "Headline", maxH: Math.round(H * 0.24), minSize: 52 }),
      txt({ text: c.sub || "Free, confidential support: call or text 988, any time.", x: 120, y: 0, w: W - 240, size: 30, font: "serif", align: "center", color: "#334155", name: "Line", after: ["Headline", 20] }),
    ] },
  { id: "clinician", name: "Meet the clinician", cat: "Health", bg: "wash-sage",
    build: (W, H, c) => [
      ...brandLine(W),
      T({ type: "image", elId: "med-surgeon", x: W / 2 - 280, y: 150, w: 560, h: Math.round(H * 0.46), fit: "contain" }),
      ...kicker(c.kicker || "Meet the clinician", W / 2 - 160, Math.round(H * 0.46) + 190, "#5b6678", 320),
      txt({ text: c.headline || "Dr. Amara *Okafor*", x: 88, y: Math.round(H * 0.46) + 236, w: W - 176, size: 76, weight: 700, align: "center", ls: -0.03, name: "Name", maxH: 170, minSize: 48 }),
      txt({ text: c.sub || "Trauma surgeon · on what the first hour after an injury decides", x: 120, y: 0, w: W - 240, size: 30, font: "serif", italic: true, align: "center", color: "#334155", markup: false, name: "Role", after: ["Name", 16] }),
    ] },
  { id: "public-health-stat", name: "Public health number", cat: "Health", bg: "wash-lavender",
    build: (W, H, c) => [
      ...brandLine(W),
      T({ type: "image", elId: "med-global-health", x: W - 88 - 380, y: H - 80 - 400, w: 380, h: 400, fit: "contain", anchorX: 1 }),
      ...kicker(c.kicker || "Public health, by the numbers", 88, 170),
      txt({ text: c.headline || "1 in 3", x: 80, y: 220, w: W - 160, size: 240, weight: 700, lh: 1, ls: -0.05, color: "#1e3a5f", name: "Number" }),
      txt({ text: c.sub || "children in some D.C. neighborhoods live with asthma. Where you grow up shapes how you breathe.", x: 88, y: 0, w: W - 300, size: 38, font: "serif", lh: 1.32, color: "#334155", name: "Explanation", after: ["Number", 20] }),
    ] },
  { id: "brain-fact", name: "Brain fact", cat: "Health", bg: "med-bg-brain",
    build: (W, H, c, ink) => [
      ...brandLine(W),
      txt({ text: c.kicker || "Brain fact", x: 88, y: 150, w: W - 176, size: 52, font: "serif", italic: true, color: "#6b5b8a", markup: false, name: "Kicker" }),
      txt({ text: c.headline || "Forgetting isn’t a flaw. Your brain *clears space on purpose.*", x: 88, y: 230, w: W - 176, size: 64, weight: 600, lh: 1.12, ls: -0.025, name: "Fact", maxH: ink - 230 - 40, minSize: 40 }),
    ] },
  { id: "nutrition-tip", name: "Nutrition tip", cat: "Health", bg: "wash-sage",
    build: (W, H, c) => [
      ...brandLine(W),
      T({ type: "image", elId: "med-plate", x: W / 2 - 280, y: Math.round(H * 0.46), w: 560, h: Math.round(H * 0.46), fit: "contain" }),
      ...kicker(c.kicker || "Eat well", 88, 160),
      txt({ text: c.headline || "Fill *half* your plate with vegetables and fruit.", x: 88, y: 206, w: W - 176, size: 76, weight: 700, lh: 1.05, ls: -0.035, name: "Headline", maxH: Math.round(H * 0.24), minSize: 46 }),
      txt({ text: c.sub || "What the new U.S. Dietary Guidelines actually say.", x: 88, y: 0, w: W - 176, size: 30, font: "serif", color: "#334155", name: "Line", after: ["Headline", 20] }),
    ] },
  { id: "word-of-week", name: "Science word", cat: "Health", bg: "wash-paper",
    build: (W, H, c) => [
      ...brandLine(W),
      T({ type: "image", elId: "neuro-myelin", x: W / 2 - 320, y: Math.round(H * 0.58), w: 640, h: Math.round(H * 0.34), fit: "contain" }),
      ...kicker(c.kicker || "Word of the week", 88, 170),
      txt({ text: c.headline || "Myelin", x: 80, y: 220, w: W - 160, size: 150, font: "serif", weight: 600, lh: 1, ls: -0.02, name: "Word" }),
      txt({ text: c.pron || "/ˈmaɪ.ə.lɪn/ · noun", x: 88, y: 0, w: W - 176, size: 28, color: "#5b6678", markup: false, name: "Pronunciation", after: ["Word", 14] }),
      txt({ text: c.sub || "The fatty coat around nerve fibres that lets signals travel fast. In MS, the immune system attacks it.", x: 88, y: 0, w: W - 176, size: 36, font: "serif", lh: 1.35, color: "#334155", name: "Definition", after: ["Pronunciation", 30] }),
    ] },
  { id: "inside-hospital", name: "Inside the hospital", cat: "Health", bg: "med-bg-corridor",
    build: (W, H, c, ink) => [
      ...brandLine(W), ...kicker(c.kicker || "Inside the hospital", 88, 150),
      txt({ text: c.headline || "The night shift that *keeps D.C. alive*", x: 88, y: 196, w: W - 176, size: 82, weight: 700, lh: 1.04, ls: -0.035, name: "Headline", maxH: ink - 196 - 110, minSize: 48 }),
      txt({ text: c.sub || "Twelve hours with the nurses of a downtown ER.", x: 88, y: 0, w: W - 260, size: 32, font: "serif", color: "#334155", name: "Line", after: ["Headline", 22] }),
    ] },
  { id: "heart-explainer", name: "Health, explained", cat: "Health", bg: "med-bg-heart",
    build: (W, H, c, ink) => [
      ...brandLine(W),
      txt({ text: c.kicker || "HEALTH, EXPLAINED", x: 88, y: 150, w: W - 176, size: 23, weight: 600, ls: 0.18, align: "center", color: "#9a4a4a", markup: false, name: "Kicker" }),
      txt({ text: c.headline || "What actually happens *in a heart attack*", x: 88, y: 196, w: W - 176, size: 80, font: "serif", lh: 1.06, align: "center", name: "Headline", maxH: ink - 196 - 110, minSize: 48 }),
      txt({ text: c.sub || "Swipe for the 60-second version →", x: 88, y: 0, w: W - 176, size: 28, weight: 500, align: "center", color: "#5b6678", markup: false, name: "Line", after: ["Headline", 22] }),
    ] },
  { id: "event", name: "Event / date", cat: "Announcement", bg: "wash-ochre",
    build: (W, H, c, ink) => [
      ...brandLine(W),
      T({ type: "rect", x: 88, y: 170, w: 210, h: 230, radius: 22, fill: "#0f172a", name: "Date card" }),
      txt({ text: "OCT", x: 88, y: 196, w: 210, size: 30, weight: 600, ls: 0.2, align: "center", color: "#e8d9b0", markup: false, name: "Month" }),
      txt({ text: "24", x: 88, y: 236, w: 210, size: 120, weight: 700, align: "center", color: "#f8f7f3", lh: 1, markup: false, name: "Day" }),
      txt({ text: c.kicker || "Writers’ workshop", x: 340, y: 186, w: W - 428, size: 24, weight: 600, ls: 0.14, upper: true, color: "#5b6678", markup: false, name: "Kicker" }),
      txt({ text: c.headline || "How to *interview* a scientist", x: 340, y: 226, w: W - 428, size: 58, weight: 700, lh: 1.06, ls: -0.03, name: "Title" }),
      txt({ text: c.sub || "6 pm · GWU Science & Engineering Hall · open to all", x: 88, y: 470, w: W - 176, size: 32, font: "serif", color: "#334155", name: "Details" }),
    ] },
  { id: "writer", name: "Meet the writer", cat: "People", bg: "wash-blush",
    build: (W, H, c, ink) => [
      ...brandLine(W),
      T({ type: "ellipse", x: W / 2 - 200, y: 170, w: 400, h: 400, fill: "#e7e4da", stroke: "#fdfcf9", sw: 10, name: "Photo frame (drop a photo here)" }),
      txt({ text: "Add a photo: Photos → Upload", x: W / 2 - 200, y: 345, w: 400, size: 22, align: "center", color: "#5b6678", markup: false, name: "Photo hint" }),
      ...kicker("Meet the writer", W / 2 - 150, 620, "#5b6678", 300),
      txt({ text: c.headline || "Sienna *Halstead*", x: 88, y: 664, w: W - 176, size: 76, weight: 700, align: "center", ls: -0.03, name: "Name" }),
      txt({ text: c.sub || "Public health · George Washington University", x: 88, y: 770, w: W - 176, size: 32, font: "serif", italic: true, align: "center", color: "#334155", markup: false, name: "Role" }),
    ] },
  { id: "question", name: "Ask a question", cat: "Engagement", bg: "wash-lavender",
    build: (W, H, c, ink) => [
      ...brandLine(W),
      txt({ text: c.headline || "Would you trust an AI to *read your X-ray?*", x: 100, y: Math.round(H * 0.22), w: W - 200, size: 80, weight: 700, lh: 1.08, ls: -0.035, align: "center", name: "Question", maxH: Math.round(H * 0.4), minSize: 48 }),
      txt({ text: c.sub || "Tell us in the comments.", x: 100, y: 0, w: W - 200, size: 34, font: "serif", italic: true, align: "center", color: "#5b6678", markup: false, name: "Prompt", after: ["Question", 36] }),
    ] },
  { id: "carousel-cover", name: "Carousel: cover", cat: "Carousel", bg: "art-algae",
    build: (W, H, c, ink) => [
      ...brandLine(W), ...kicker(c.kicker || "Feature", 88, 150),
      txt({ text: c.headline || "Making algae *dance*", x: 88, y: 196, w: W - 176, size: 92, weight: 700, lh: 1.03, ls: -0.04, name: "Headline", maxH: ink - 196 - 40, minSize: 54 }),
      T({ type: "rect", x: W - 88 - 210, y: H - 120, w: 210, h: 58, radius: 29, fill: "#0f172a", name: "Swipe pill" }),
      txt({ text: "Swipe →", x: W - 88 - 210, y: H - 109, w: 210, size: 24, weight: 600, align: "center", color: "#f8f7f3", markup: false, name: "Swipe" }),
    ] },
  { id: "carousel-text", name: "Carousel: text page", cat: "Carousel", bg: "wash-paper",
    build: (W, H, c, ink) => [
      txt({ text: c.kicker || "02 / 05", x: 88, y: 80, w: 300, size: 24, weight: 600, ls: 0.14, color: "#5b6678", markup: false, name: "Page number" }),
      txt({ text: c.headline || "Gentle motion, *no chemicals*", x: 88, y: 170, w: W - 176, size: 66, weight: 700, lh: 1.06, ls: -0.03, name: "Heading" }),
      txt({ text: c.sub || "Most microalgae harvesting relies on chemicals or energy-hungry machines. Algae-n-Roll's rotating tank uses the physics of flow instead: slow rotation gathers the algae so they can be collected cleanly.", x: 88, y: 0, w: W - 176, size: 38, font: "serif", lh: 1.5, color: "#334155", name: "Body", after: ["Heading", 40], maxH: H - 520, minSize: 26 }),
    ] },
  { id: "carousel-end", name: "Carousel: read more", cat: "Carousel", bg: "series-newsletter",
    build: (W, H, c, ink) => [
      ...brandLine(W),
      txt({ text: c.headline || "Read the *full story*", x: 88, y: 190, w: W - 176, size: 88, weight: 700, lh: 1.04, ls: -0.04, name: "Headline", maxH: ink - 190 - 100, minSize: 52 }),
      txt({ text: c.sub || "Link in bio · catalyst-magazine.com", x: 88, y: 0, w: W - 176, size: 34, font: "serif", color: "#334155", markup: false, name: "Line", after: ["Headline", 24] }),
    ] },
  { id: "night", name: "Night headline", cat: "Story", bg: "night-observatory",
    build: (W, H, c, ink) => [
      ...brandLine(W, "#e8d9b0"), ...kicker(c.kicker || "Space", 88, 160, "#e8d9b0"),
      txt({ text: c.headline || "What Venus says about *us*", x: 88, y: 206, w: W - 176, size: 86, weight: 700, lh: 1.04, ls: -0.035, color: "#f8f7f3", name: "Headline", maxH: ink - 206 - 120, minSize: 52 }),
      txt({ text: c.sub || "NASA's DAVINCI mission and humanity's place in space.", x: 88, y: 0, w: W - 260, size: 34, font: "serif", color: "#e8d9b0", name: "Line", after: ["Headline", 22] }),
    ] },
  { id: "minimal", name: "Just type", cat: "Announcement", bg: "wash-paper",
    build: (W, H, c, ink) => [
      ...brandLine(W),
      txt({ text: c.headline || "Science is a *story* worth telling well.", x: 88, y: Math.round(H * 0.24), w: W - 176, size: 100, weight: 700, lh: 1.02, ls: -0.045, name: "Headline", maxH: Math.round(H * 0.6), minSize: 56 }),
    ] },
  { id: "science-explained", name: "Science explained", cat: "Story", bg: "sci-dna",
    build: (W, H, c, ink) => [
      ...brandLine(W), ...kicker(c.kicker || "Science, explained", 88, 150),
      txt({ text: c.headline || "How your genes *switch on*", x: 88, y: 196, w: W - 176, size: 88, weight: 700, lh: 1.04, ls: -0.035, name: "Headline", maxH: ink - 196 - 120, minSize: 52 }),
      txt({ text: c.sub || "A two-minute guide to gene expression.", x: 88, y: 0, w: W - 260, size: 34, font: "serif", color: "#334155", lh: 1.35, name: "Line", after: ["Headline", 22] }),
    ] },
  { id: "dc-weekend", name: "Science in D.C.", cat: "Story", bg: "dc-botanic",
    build: (W, H, c, ink) => [
      ...brandLine(W),
      T({ type: "rect", x: 88, y: 150, w: 250, h: 52, radius: 26, fill: "#5f7a61", name: "Pill" }),
      txt({ text: c.kicker || "This weekend", x: 88, y: 160, w: 250, size: 21, weight: 600, align: "center", color: "#fdfcf9", markup: false, name: "Pill text" }),
      txt({ text: c.headline || "Go see the *orchids* at the Botanic Garden", x: 88, y: 232, w: W - 176, size: 76, weight: 700, lh: 1.05, ls: -0.035, name: "Headline", maxH: ink - 232 - 110, minSize: 48 }),
      txt({ text: c.sub || "Free · open daily 10 am to 5 pm", x: 88, y: 0, w: W - 176, size: 32, font: "serif", color: "#334155", name: "Line", after: ["Headline", 20] }),
    ] },
  { id: "did-you-know", name: "Did you know?", cat: "Data", bg: "sci-glassware",
    build: (W, H, c, ink) => [
      ...brandLine(W),
      txt({ text: c.kicker || "Did you know?", x: 88, y: 150, w: W - 176, size: 54, font: "serif", italic: true, color: "#9a5a2e", markup: false, name: "Kicker" }),
      txt({ text: c.headline || "Glass beakers were made *heat-proof* by a railway-lantern maker in 1893.", x: 88, y: 236, w: W - 176, size: 60, weight: 600, lh: 1.12, ls: -0.025, name: "Fact", maxH: ink - 236 - 50, minSize: 40 }),
    ] },
  { id: "dark-statement", name: "Statement (dark)", cat: "Quote", bg: "dark-navy",
    build: (W, H, c) => [
      ...brandLine(W, "#c9cfda"),
      txt({ text: c.headline || "The best science writing makes you *feel* the question.", x: 110, y: Math.round(H * 0.3), w: W - 220, size: 76, font: "serif", lh: 1.16, align: "center", color: "#f8f7f3", name: "Statement", maxH: Math.round(H * 0.42), minSize: 44 }),
      txt({ text: c.sub || "The Catalyst editors", x: 110, y: 0, w: W - 220, size: 24, weight: 600, ls: 0.16, upper: true, align: "center", color: "#c9cfda", markup: false, name: "Attribution", after: ["Statement", 44] }),
    ] },
  { id: "burgundy-quote", name: "Quote (burgundy)", cat: "Quote", bg: "dark-burgundy",
    build: (W, H, c) => [
      txt({ text: "“", x: 0, y: Math.round(H * 0.14), w: W, size: 240, font: "serif", italic: true, color: "#f1d9c8", lh: 0.9, align: "center", markup: false, name: "Quote mark" }),
      txt({ text: c.headline || "Nothing in life is to be feared, it is only to be *understood.*", x: 110, y: Math.round(H * 0.34), w: W - 220, size: 64, font: "serif", lh: 1.22, align: "center", color: "#fbf3ec", name: "Quote", maxH: Math.round(H * 0.38), minSize: 40 }),
      txt({ text: c.sub || "— Marie Curie", x: 110, y: 0, w: W - 220, size: 26, weight: 600, ls: 0.08, align: "center", color: "#f1d9c8", markup: false, name: "Attribution", after: ["Quote", 40] }),
      centeredLogo(W, H - 128, 56, { tone: "paper" }),
    ] },
  { id: "book-pick", name: "Book pick", cat: "People", bg: "wash-blush",
    build: (W, H, c) => [
      ...brandLine(W),
      T({ type: "image", src: "/beta/social/el/el-books.webp?v=2", x: W / 2 - 260, y: 170, w: 520, h: 370, fit: "contain", name: "Books" }),
      ...kicker(c.kicker || "Book review", W / 2 - 140, 600, "#5b6678", 300),
      txt({ text: c.headline || "*The Gene*, by Siddhartha Mukherjee", x: 100, y: 646, w: W - 200, size: 64, weight: 700, lh: 1.08, ls: -0.03, align: "center", name: "Title", maxH: 220, minSize: 40 }),
      txt({ text: c.sub || "“A history that reads like a thriller.”", x: 100, y: 0, w: W - 200, size: 34, font: "serif", italic: true, align: "center", color: "#334155", markup: false, name: "Line", after: ["Title", 24] }),
      txt({ text: "★★★★★", x: 100, y: 0, w: W - 200, size: 34, align: "center", color: "#c9962e", ls: 0.12, markup: false, name: "Stars", after: ["Line", 26] }),
    ] },
  { id: "newsletter", name: "Newsletter", cat: "Announcement", bg: "wash-sage",
    build: (W, H, c) => [
      ...brandLine(W),
      T({ type: "image", src: "/beta/social/el/el-envelope.webp?v=2", x: W / 2 - 210, y: Math.round(H * 0.42), w: 420, h: 483, fit: "contain", name: "Envelope" }),
      txt({ text: c.headline || "Science news, *in your inbox*", x: 88, y: 170, w: W - 176, size: 84, weight: 700, lh: 1.04, ls: -0.035, align: "center", name: "Headline", maxH: Math.round(H * 0.42) - 170 - 110, minSize: 48 }),
      txt({ text: c.sub || "Subscribe free · link in bio", x: 88, y: 0, w: W - 176, size: 32, font: "serif", align: "center", color: "#334155", markup: false, name: "Line", after: ["Headline", 22] }),
    ] },
  { id: "brain-teaser", name: "Brain teaser", cat: "Engagement", bg: "wash-lavender",
    build: (W, H, c) => [
      ...brandLine(W),
      T({ type: "image", src: "/beta/social/el/el-brain.webp?v=2", x: W - 88 - 330, y: H - 88 - 283, w: 330, h: 283, fit: "contain", name: "Brain" }),
      ...kicker(c.kicker || "Brain teaser", 88, 160),
      txt({ text: c.headline || "I have keys but open *no locks.* What am I?", x: 88, y: 206, w: W - 176, size: 80, weight: 700, lh: 1.06, ls: -0.035, name: "Question", maxH: Math.round(H * 0.45), minSize: 48 }),
      txt({ text: c.sub || "Answer in tomorrow’s story.", x: 88, y: 0, w: W - 176, size: 32, font: "serif", italic: true, color: "#5b6678", markup: false, name: "Line", after: ["Question", 26] }),
    ] },
  { id: "night-lab", name: "Late in the lab", cat: "Story", bg: "night-lab",
    build: (W, H, c, ink) => [
      ...brandLine(W, "#e8d9b0"), ...kicker(c.kicker || "Behind the research", 88, 160, "#e8d9b0"),
      txt({ text: c.headline || "What keeps a scientist *up at night?*", x: 88, y: 206, w: W - 176, size: 84, weight: 700, lh: 1.04, ls: -0.035, color: "#f8f7f3", name: "Headline", maxH: ink - 206 - 110, minSize: 50 }),
      txt({ text: c.sub || "Five GW researchers on the questions they can’t let go.", x: 88, y: 0, w: W - 260, size: 32, font: "serif", color: "#e8d9b0", name: "Line", after: ["Headline", 22] }),
    ] },
  { id: "join", name: "We’re recruiting", cat: "Announcement", bg: "series-join",
    build: (W, H, c, ink) => [
      ...brandLine(W),
      T({ type: "rect", x: 88, y: 150, w: 250, h: 54, radius: 27, fill: "#c9962e", name: "Pill" }),
      txt({ text: "Now recruiting", x: 88, y: 160, w: 250, size: 22, weight: 600, align: "center", color: "#fdfcf9", markup: false, name: "Pill text" }),
      txt({ text: c.headline || "Join *The Catalyst*", x: 88, y: 236, w: W - 176, size: 92, weight: 700, lh: 1.03, ls: -0.04, name: "Headline", maxH: ink - 236 - 80, minSize: 52 }),
      txt({ text: c.sub || "Writers · editors · designers · social media", x: 88, y: 0, w: W - 176, size: 34, font: "serif", color: "#334155", markup: false, name: "Roles", after: ["Headline", 20] }),
    ] },
];

// ─── The editor ─────────────────────────────────────────────────────────────
export async function mountDesignStudio(ctx, container, { savePost, onSaved, onClose } = {}) {
  const [lib] = await Promise.all([loadLibrary().catch(() => ({ backgrounds: [], elements: [] })), fontsReady()]);
  const bgById = Object.fromEntries(lib.backgrounds.map((b) => [b.id, b]));

  // Stories: light illustrations fit the width and sit at the bottom (paper
  // above); dark scenes and textures fill the frame.
  const fitFor = (format, b) => (format === "story" && b && b.tone !== "dark" && (b.inkTop ?? 0.5) >= 0.15 ? "bottom" : "cover");
  // Illustrations are drawn 4:5; many also have a 1:1 version (blank paper
  // on top, the drawing below) that square designs use instead.
  const baseUrl = (u) => String(u || "").split("?")[0];
  const bgByImage = new Map();
  for (const b of lib.backgrounds) { bgByImage.set(baseUrl(b.image), b); if (b.square) bgByImage.set(baseUrl(b.square), b); }
  const useSquare = (b, format) => format === "square" && !!b?.square;
  const bgFrom = (b, format, extra = {}) => ({
    color: b?.paper && b.tone !== "dark" ? b.paper : PAPER,
    image: (useSquare(b, format) ? b.square : b?.image) || null, fit: fitFor(format, b), tone: b?.tone || "light",
    inkTop: useSquare(b, format) ? (b.squareInkTop ?? 0.42) : (b?.inkTop ?? 0.5), ...extra,
  });
  const blankPage = () => ({ id: uid(), bg: { color: PAPER, image: bgById["wash-paper"]?.image || null }, layers: [] });
  const AUTOSAVE = `catalyst.studio.design.${ctx.user?.uid || "anon"}`;

  let design = null;
  try { design = JSON.parse(localStorage.getItem(AUTOSAVE) || "null"); } catch {}
  if (!design || !Array.isArray(design.pages) || !design.pages.length) design = newDesignFrom("headline-top");
  // sel = the one selected layer; multi = ids when two or more are selected.
  let pageIdx = 0, sel = null, multi = [], editingId = null, panel = "templates", postId = null;
  let eraser = null, painting = null, lastBrushPt = null;   // eraser brush (see "eraser" below)
  let caption = "", designTitle = "Untitled design", statusReady = false;
  let postPlatform = null, postTitle = null;   // of the post opened from the board
  const undo = [], redo = [];

  function newDesignFrom(tid, format = "square", content = {}, bgId) {
    const d = { format, pages: [] };
    d.pages.push(pageFromTemplate(tid, format, content, bgId));
    return d;
  }
  function pageFromTemplate(tid, format, content = {}, bgId) {
    const t = TEMPLATES.find((x) => x.id === tid) || TEMPLATES[0];
    const fmt = FORMATS[format] || FORMATS.post;
    const b = bgById[bgId || t.bg];
    const fitMode = fitFor(format, b);
    const focusY = t.bgFocus ?? 0.5;
    // Where does the drawing start on this canvas? (backgrounds are 4:5)
    let ink = fmt.h * 0.62;
    if (useSquare(b, format)) ink = fmt.h * (b.squareInkTop ?? 0.42);
    else if (b && b.inkTop >= 0.15) {
      const imgH = fitMode === "bottom" ? fmt.w * 1.25 : 2000 * Math.max(fmt.w / 1600, fmt.h / 2000);
      const top = fitMode === "bottom" ? fmt.h - imgH : (fmt.h - imgH) * focusY;
      ink = Math.min(fmt.h, top + b.inkTop * imgH);
    }
    return settleLayout({
      id: uid(),
      bg: bgFrom(b, format, { focusY }),
      layers: t.build(fmt.w, fmt.h, content, Math.round(ink)).map((L) => fitElement({ ...L, id: uid() })),
    });
  }

  // Template image layers can name a library element (elId): fit it inside
  // the template's box at its real proportions (anchored to the box bottom).
  const elById = Object.fromEntries(lib.elements.map((e) => [e.id, e]));
  function fitElement(L) {
    if (L.type !== "image" || !L.elId) return L;
    const e = elById[L.elId];
    if (!e) return L;
    const k = Math.min(L.w / (e.w || 1), L.h / (e.h || 1));
    const w = Math.round((e.w || L.w) * k), h = Math.round((e.h || L.h) * k);
    const ax = L.anchorX ?? 0.5;
    const out = { ...L, src: e.image, x: Math.round(L.x + (L.w - w) * ax), y: Math.round(L.y + L.h - h), w, h, name: L.name || e.title };
    delete out.elId; delete out.anchorX;
    return out;
  }

  const page = () => design.pages[pageIdx];
  const fmt = () => FORMATS[design.format] || FORMATS.post;
  const layer = (id) => page().layers.find((l) => l.id === id);

  // ── selection (one layer, or several) ──
  const selIds = () => (multi.length ? multi : sel ? [sel] : []);
  const selLayers = () => selIds().map(layer).filter(Boolean);
  function setSelection(ids) {
    ids = [...new Set(ids)].filter((id) => layer(id));
    if (openPop && !(ids.length === selIds().length && ids.every((id) => selIds().includes(id)))) openPop = null;
    if (eraser && eraser.target === "layer" && !(ids.length === 1 && ids[0] === eraser.id)) { eraser = null; painting = null; artboard?.classList.remove("is-erasing"); }
    if (ids.length === 1) { sel = ids[0]; multi = []; }
    else { sel = null; multi = ids.length ? ids : []; }
  }
  // A grouped layer selects its whole group.
  const withGroup = (L) => (L.group ? page().layers.filter((x) => x.group === L.group).map((x) => x.id) : [L.id]);
  function bbox(ls) {
    if (!ls.length) return { x: 0, y: 0, w: 0, h: 0 };
    const x = Math.min(...ls.map((L) => L.x)), y = Math.min(...ls.map((L) => L.y));
    const r = Math.max(...ls.map((L) => L.x + L.w)), b = Math.max(...ls.map((L) => L.y + (L.h || 10)));
    return { x, y, w: r - x, h: b - y };
  }
  // Selected layers as units: a whole selected group moves/aligns as one.
  function selUnits() {
    const ls = selLayers().filter((L) => !L.locked), ids = new Set(ls.map((L) => L.id)), out = [], seen = new Set();
    for (const L of ls) {
      if (seen.has(L.id)) continue;
      const g = L.group ? page().layers.filter((x) => x.group === L.group) : null;
      const unit = g && g.every((x) => ids.has(x.id)) ? g.filter((x) => !x.locked) : [L];
      unit.forEach((x) => seen.add(x.id));
      out.push(unit);
    }
    return out;
  }
  const shiftUnit = (unit, dx, dy) => unit.forEach((L) => { L.x = Math.round(L.x + dx); L.y = Math.round(L.y + dy); });
  // Align to each other (2+ units) or to the page margins (one unit).
  function alignSelection(how) {
    const units = selUnits();
    if (!units.length) return;
    const f = fmt(), M = 88;
    const ref = units.length === 1 ? { x: M, y: M, w: f.w - 2 * M, h: f.h - 2 * M } : bbox(units.flat());
    if (units.length === 1 && (how === "center" || how === "middle")) { ref.x = 0; ref.w = f.w; ref.y = 0; ref.h = f.h; }
    for (const u of units) {
      const b = bbox(u);
      const dx = how === "left" ? ref.x - b.x : how === "center" ? ref.x + ref.w / 2 - (b.x + b.w / 2) : how === "right" ? ref.x + ref.w - (b.x + b.w) : 0;
      const dy = how === "top" ? ref.y - b.y : how === "middle" ? ref.y + ref.h / 2 - (b.y + b.h / 2) : how === "bottom" ? ref.y + ref.h - (b.y + b.h) : 0;
      shiftUnit(u, dx, dy);
    }
    commit(); draw(); paintToolbar();
    flashSelectionGuides();
  }
  // Even gaps between 3+ units, keeping the outer two where they are.
  function distribute(axis) {
    const units = selUnits().map((u) => ({ u, b: bbox(u) }));
    if (units.length < 3) return;
    const X = axis === "h";
    units.sort((a, b) => (X ? a.b.x - b.b.x : a.b.y - b.b.y));
    const first = units[0].b, last = units[units.length - 1].b;
    const span = X ? last.x + last.w - first.x : last.y + last.h - first.y;
    const total = units.reduce((t, x) => t + (X ? x.b.w : x.b.h), 0);
    const gap = (span - total) / (units.length - 1);
    let pos = X ? first.x : first.y;
    for (const { u, b } of units) {
      shiftUnit(u, X ? pos - b.x : 0, X ? 0 : pos - b.y);
      pos += (X ? b.w : b.h) + gap;
    }
    commit(); draw(); paintToolbar();
    flashSelectionGuides();
  }
  function groupSelection() {
    const ls = selLayers();
    if (ls.length < 2) return;
    const g = "g" + uid();
    ls.forEach((L) => { L.group = g; });
    commit(); draw(); paintToolbar(); paintPanelIfLayers();
  }
  function ungroupSelection() {
    selLayers().forEach((L) => { delete L.group; });
    commit(); draw(); paintToolbar(); paintPanelIfLayers();
  }

  // ── history ──
  function commit() {
    undo.push(JSON.stringify({ design, pageIdx }));
    if (undo.length > 80) undo.shift();
    redo.length = 0;
    try { localStorage.setItem(AUTOSAVE, JSON.stringify(design)); } catch {}
    paintHistory();
    if (typeof markDirty === "function" && statusReady) markDirty();
  }
  let pendingCommit = 0;
  function commitSoon() { clearTimeout(pendingCommit); pendingCommit = setTimeout(commit, 400); }
  function restore(snap) {
    const s = JSON.parse(snap); design = s.design; pageIdx = Math.min(s.pageIdx, design.pages.length - 1); sel = null; multi = [];
    try { localStorage.setItem(AUTOSAVE, JSON.stringify(design)); } catch {}   // keep the autosave in step with undo/redo
    refreshAll();
    if (statusReady) markDirty();
  }
  function doUndo() { if (undo.length < 2) return; redo.push(undo.pop()); restore(undo[undo.length - 1]); paintHistory(); }
  function doRedo() { if (!redo.length) return; const s = redo.pop(); undo.push(s); restore(s); paintHistory(); }

  // ── shell ──
  const RAIL = [
    ["templates", "Templates", '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>'],
    ["elements", "Elements", '<path d="M12 3c3 3 3 6 0 9-3-3-3-6 0-9z"/><circle cx="7" cy="17" r="4"/><rect x="13" y="13" width="8" height="8" rx="1.5"/>'],
    ["text", "Text", '<path d="M5 6V4h14v2"/><path d="M12 4v16"/><path d="M9 20h6"/>'],
    ["photos", "Uploads", '<path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>'],
    ["backgrounds", "Backgrounds", '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="m3 16 5-5 4 4 3-3 6 6"/><circle cx="15.5" cy="8.5" r="1.5"/>'],
    ["layers", "Layers", '<path d="m12 3 9 5-9 5-9-5 9-5z"/><path d="m3 13 9 5 9-5"/>'],
    ["caption", "Caption", '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1.2-4.4A8 8 0 1 1 21 12z"/><path d="M8.5 10.5h7M8.5 13.5h4.5"/>'],
  ];
  container.innerHTML = `
    <div class="ds">
      <header class="ds-top">
        <div class="ds-top-left">
          <button type="button" class="ds-back" id="ds-back" title="Back to posts"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg><span>Posts</span></button>
          <span class="ds-top-sep" aria-hidden="true"></span>
          <input type="text" class="ds-title" id="ds-title" maxlength="140" value="Untitled design" aria-label="Design name" spellcheck="false">
          <select id="ds-format" class="ds-topselect" aria-label="Size" title="Resize the design">${Object.entries(FORMATS).map(([k, f]) => `<option value="${k}">${f.label} · ${f.w}×${f.h}</option>`).join("")}</select>
          <span class="ds-top-sep" aria-hidden="true"></span>
          <button type="button" class="ds-topicon" id="ds-undo" title="Undo (⌘Z)" aria-label="Undo"><svg viewBox="0 0 24 24"><path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/></svg></button>
          <button type="button" class="ds-topicon" id="ds-redo" title="Redo (⇧⌘Z)" aria-label="Redo"><svg viewBox="0 0 24 24"><path d="m15 14 5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/></svg></button>
          <span class="ds-status" id="ds-status" aria-live="polite"></span>
        </div>
        <div class="ds-top-right">
          <button type="button" class="ds-topbtn" id="ds-new" title="Start a new design">New design</button>
          <div class="ds-menuwrap">
            <button type="button" class="ds-topbtn" id="ds-dl-menu" aria-haspopup="menu" aria-expanded="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/></svg>Download</button>
            <div class="ds-menu ds-dlmenu" id="ds-dl-pop" role="menu" hidden>
              <button type="button" role="menuitem" id="ds-dl-page"><b>This page</b><small>PNG, full size</small></button>
              <button type="button" role="menuitem" id="ds-dl-all"><b>All pages</b><small>ZIP of numbered PNGs</small></button>
            </div>
          </div>
          <button type="button" class="ds-savebtn" id="ds-save" title="Save to the board (⌘S)">Save</button>
        </div>
      </header>
      <div class="ds-body" id="ds-body">
        <nav class="ds-rail" aria-label="Studio panels">
          ${RAIL.map(([k, label, icon]) => `<button type="button" data-panel="${k}" class="${k === "templates" ? "is-on" : ""}" title="${label}"><svg viewBox="0 0 24 24">${icon}</svg><span>${label}</span></button>`).join("")}
        </nav>
        <div class="ds-panel" id="ds-panel"></div>
        <div class="ds-main">
          <div class="ds-toolbar" id="ds-toolbar"></div>
          <div class="ds-stage" id="ds-stage">
            <div class="ds-artboard" id="ds-artboard">
              <canvas id="ds-canvas"></canvas>
              <div class="ds-overlay" id="ds-overlay"></div>
            </div>
          </div>
          <div class="ds-bottom">
            <div class="ds-pages" id="ds-pages"></div>
            <div class="ds-zoom" role="group" aria-label="Zoom">
              <button type="button" data-zoom="out" title="Zoom out (⌘−)" aria-label="Zoom out"><svg viewBox="0 0 24 24"><path d="M5 12h14"/></svg></button>
              <button type="button" data-zoom="fit" id="ds-zoom-val" title="Fit to screen (⌘0)">100%</button>
              <button type="button" data-zoom="in" title="Zoom in (⌘+)" aria-label="Zoom in"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></button>
            </div>
          </div>
        </div>
      </div>
    </div>`;

  const $ = (s) => container.querySelector(s);
  const canvas = $("#ds-canvas"), overlay = $("#ds-overlay"), artboard = $("#ds-artboard"), stage = $("#ds-stage");
  let scale = 0.4;

  // ── sizing ──
  let zoom = 1;   // multiplier on "fit to screen"
  function fit() {
    const f = fmt();
    const r = stage.getBoundingClientRect();
    const availW = Math.max(200, r.width - 64), availH = Math.max(200, (r.height || window.innerHeight - 200) - 56);
    scale = Math.min(availW / f.w, availH / f.h) * zoom;
    const zl = container.querySelector("#ds-zoom-val"); if (zl) zl.textContent = `${Math.round(scale * 100)}%`;
    artboard.style.width = `${Math.round(f.w * scale)}px`;
    artboard.style.height = `${Math.round(f.h * scale)}px`;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(f.w * scale * dpr);
    canvas.height = Math.round(f.h * scale * dpr);
    canvas.style.width = artboard.style.width;
    canvas.style.height = artboard.style.height;
    lockToolbarHeight();
    draw();
  }
  const ro = new ResizeObserver(() => fit());
  ro.observe(stage);

  // One render per frame, however fast sliders and pickers fire.
  let drawing = 0, drawQueued = false;
  function draw() {
    if (drawQueued) return;
    drawQueued = true;
    requestAnimationFrame(() => { drawQueued = false; drawNow(); });
  }
  function drawNow() {
    const token = ++drawing;
    const c2 = canvas.getContext("2d");
    const dpr = canvas.width / (fmt().w * scale);
    const off = document.createElement("canvas");
    off.width = canvas.width; off.height = canvas.height;
    const o = off.getContext("2d");
    o.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
    renderPage(o, page(), fmt(), { skip: editingId }).then(() => {
      if (token !== drawing) return;
      c2.clearRect(0, 0, canvas.width, canvas.height);
      c2.drawImage(off, 0, 0);
      paintSelection();
      paintPagesThumb(pageIdx);
    });
  }

  // ── selection overlay ──
  function paintSelection(guides = guidesNow, marquee = null) {
    if (editingId) return;   // the inline text editor lives in the overlay
    const S = (v) => `${(v * scale).toFixed(1)}px`;
    overlay.innerHTML = guides.map((g) => {
      if (g.axis === "x") return `<div class="ds-guide is-v${g.full ? " is-page" : ""}" style="left:${S(g.v)};top:${S(g.from)};height:${S(g.to - g.from)}"></div>`;
      if (g.axis === "y") return `<div class="ds-guide is-h${g.full ? " is-page" : ""}" style="top:${S(g.v)};left:${S(g.from)};width:${S(g.to - g.from)}"></div>`;
      const len = Math.round(g.b - g.a);
      if (len <= 0) return "";
      return g.gap === "x"
        ? `<div class="ds-gap is-x" style="left:${S(g.a)};width:${S(g.b - g.a)};top:${S(g.at)}"><span>${len}</span></div>`
        : `<div class="ds-gap is-y" style="top:${S(g.a)};height:${S(g.b - g.a)};left:${S(g.at)}"><span>${len}</span></div>`;
    }).join("");
    if (marquee) {
      const m = el("div", { class: "ds-marquee" });
      Object.assign(m.style, { left: `${marquee.x * scale}px`, top: `${marquee.y * scale}px`, width: `${marquee.w * scale}px`, height: `${marquee.h * scale}px` });
      overlay.appendChild(m);
    }
    // Several layers: a thin outline on each, one box around them all with
    // corner handles (they resize together).
    if (multi.length) {
      const ls = selLayers();
      for (const L of ls) {
        const o = el("div", { class: "ds-sel is-member" + (L.locked ? " is-locked" : "") });
        Object.assign(o.style, { left: `${L.x * scale}px`, top: `${L.y * scale}px`, width: `${L.w * scale}px`, height: `${(L.h || 10) * scale}px` });
        overlay.appendChild(o);
      }
      const b = bbox(ls);
      const grouped = ls.length > 1 && ls.every((L) => L.group && L.group === ls[0].group);
      const box = el("div", { class: "ds-sel is-multi" + (grouped ? " is-group" : "") });
      Object.assign(box.style, { left: `${b.x * scale}px`, top: `${b.y * scale}px`, width: `${b.w * scale}px`, height: `${b.h * scale}px` });
      if (ls.some((L) => !L.locked)) ["nw", "ne", "sw", "se"].forEach((h) => box.appendChild(el("span", { class: `ds-h ds-h-${h}`, "data-h": h })));
      overlay.appendChild(box);
      quickActions(b, false);
      return;
    }
    const L = sel && layer(sel);
    if (!L || L.id === editingId) return;
    const box = el("div", { class: "ds-sel" + (L.locked ? " is-locked" : "") });
    Object.assign(box.style, { left: `${L.x * scale}px`, top: `${L.y * scale}px`, width: `${L.w * scale}px`, height: `${(L.h || 10) * scale}px` });
    if (!L.locked) {
      const hs = L.type === "text" ? ["w", "e", "nw", "ne", "sw", "se"] : L.type === "line" ? ["w", "e"] : ["n", "s", "w", "e", "nw", "ne", "sw", "se"];
      hs.forEach((h) => box.appendChild(el("span", { class: `ds-h ds-h-${h}`, "data-h": h })));
    }
    overlay.appendChild(box);
    quickActions({ x: L.x, y: L.y, w: L.w, h: L.h || 10 }, L.locked);
  }
  // Floating pill above the selection (Canva-style): duplicate, delete, lock, more.
  function quickActions(b, locked) {
    if ((drag && drag.moved) || eraser || editingId) return;
    const qa = el("div", { class: "ds-qa", role: "toolbar", "aria-label": "Quick actions" });
    qa.innerHTML = `
      <button type="button" data-qa="dup" title="Duplicate (⌘D)" aria-label="Duplicate"><svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/></svg></button>
      <button type="button" data-qa="del" title="Delete (⌫)" aria-label="Delete"><svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg></button>
      <button type="button" data-qa="lock" title="${locked ? "Unlock" : "Lock"}" aria-label="${locked ? "Unlock" : "Lock"}"><svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 ${locked ? "8 0v3" : "7.5-1.5"}"/></svg></button>
      <button type="button" data-qa="more" title="More (right-click)" aria-label="More actions"><svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/></svg></button>`;
    const top = b.y * scale - 46;
    Object.assign(qa.style, { left: `${(b.x + b.w / 2) * scale}px`, top: `${top < 4 ? (b.y + b.h) * scale + 14 : top}px` });
    overlay.appendChild(qa);
  }

  // ── hit testing + dragging ──
  function pt(e) {
    const r = artboard.getBoundingClientRect();
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
  }
  function hit(p) {
    const ls = page().layers;
    for (let i = ls.length - 1; i >= 0; i--) {
      const L = ls[i];
      if (L.hidden) continue;
      const pad = L.type === "line" ? 14 : 4;
      if (p.x >= L.x - pad && p.x <= L.x + L.w + pad && p.y >= L.y - pad && p.y <= L.y + (L.h || 10) + pad) return L;
    }
    return null;
  }
  // ── smart guides (Canva-style) ──
  // While dragging, a box snaps (within SNAP_PX on screen) to the page edges,
  // centre and margins and to every other layer's edges and centre; it also
  // snaps to even spacing between neighbours. Matching lines show as red
  // dashed guides, equal gaps as red spacing markers. Hold Alt to move freely.
  const SNAP_PX = 6, MARGIN = 88;
  let guidesNow = [], guideTimer = 0;
  function scene(exclude) {
    return page().layers.filter((L) => !L.hidden && !exclude.has(L.id)).map((L) => ({ x: L.x, y: L.y, w: L.w, h: L.h || 10 }));
  }
  const ax = (X) => (X ? { p: "x", s: "w", cp: "y", cs: "h", size: fmt().w } : { p: "y", s: "h", cp: "x", cs: "w", size: fmt().h });
  function lineTargets(others, X) {
    const a = ax(X);
    const t = [{ v: 0, page: 1 }, { v: a.size / 2, page: 1 }, { v: a.size, page: 1 }, { v: MARGIN, page: 1 }, { v: a.size - MARGIN, page: 1 }];
    for (const o of others) t.push({ v: o[a.p], o }, { v: o[a.p] + o[a.s] / 2, o }, { v: o[a.p] + o[a.s], o });
    return t;
  }
  // Positions along one axis that give equal gaps with neighbours in the same row/column.
  function spacingCandidates(b, others, X) {
    const a = ax(X), out = [];
    const overlaps = (o, r) => o[a.cp] < r[a.cp] + r[a.cs] && o[a.cp] + o[a.cs] > r[a.cp];
    const row = others.filter((o) => overlaps(o, b));
    const mid = b[a.p] + b[a.s] / 2, end = (o) => o[a.p] + o[a.s];
    const before = row.filter((o) => end(o) <= mid).sort((p, q) => end(q) - end(p));
    const after = row.filter((o) => o[a.p] >= mid).sort((p, q) => p[a.p] - q[a.p]);
    const A = before[0], C = after[0];
    if (A && C && C[a.p] - end(A) >= b[a.s]) {
      const pos = (end(A) + C[a.p] - b[a.s]) / 2;
      out.push({ pos, marks: [[end(A), pos], [pos + b[a.s], C[a.p]]] });
    }
    if (A) {
      const A2 = others.filter((o) => overlaps(o, A) && end(o) <= A[a.p]).sort((p, q) => end(q) - end(p))[0];
      if (A2) { const g = A[a.p] - end(A2); if (g > 0) out.push({ pos: end(A) + g, marks: [[end(A2), A[a.p]], [end(A), end(A) + g]] }); }
    }
    if (C) {
      const C2 = others.filter((o) => overlaps(o, C) && o[a.p] >= end(C)).sort((p, q) => p[a.p] - q[a.p])[0];
      if (C2) { const g = C2[a.p] - end(C); if (g > 0) out.push({ pos: C[a.p] - g - b[a.s], marks: [[end(C), C2[a.p]], [C[a.p] - g, C[a.p]]] }); }
    }
    return out;
  }
  // How far to shift box b along an axis to snap the given edges (0 if none in reach).
  function snapShift(b, others, X, edges, withSpacing) {
    const a = ax(X), thr = SNAP_PX / scale;
    const p = b[a.p], sz = b[a.s];
    const ev = { start: p, mid: p + sz / 2, end: p + sz };
    let best = null;
    for (const t of lineTargets(others, X)) for (const e of edges) {
      const d = t.v - ev[e];
      if (Math.abs(d) <= thr && (best === null || Math.abs(d) < Math.abs(best))) best = d;
    }
    if (withSpacing) for (const c of spacingCandidates(b, others, X)) {
      const d = c.pos - p;
      if (Math.abs(d) <= thr && (best === null || Math.abs(d) < Math.abs(best) - 0.01)) best = d;
    }
    return best || 0;
  }
  // The guides that box b exactly lines up with right now.
  function guidesFor(b, others, { spacing = true, edgesX = ["start", "mid", "end"], edgesY = ["start", "mid", "end"] } = {}) {
    const out = [], seen = new Set(), tol = 0.75;
    for (const X of [true, false]) {
      const a = ax(X), edges = X ? edgesX : edgesY;
      const ev = { start: b[a.p], mid: b[a.p] + b[a.s] / 2, end: b[a.p] + b[a.s] };
      const crossSize = X ? fmt().h : fmt().w;
      for (const t of lineTargets(others, X)) for (const e of edges) {
        if (Math.abs(t.v - ev[e]) > tol) continue;
        const v = Math.round(t.v * 2) / 2;
        let from = 0, to = crossSize;
        if (t.o) { from = Math.min(b[a.cp], t.o[a.cp]) - 12; to = Math.max(b[a.cp] + b[a.cs], t.o[a.cp] + t.o[a.cs]) + 12; }
        const key = `${X ? "x" : "y"}${v}`;
        const prev = out.find((g) => g.key === key);
        if (prev) { if (!t.page && !prev.full) { prev.from = Math.min(prev.from, from); prev.to = Math.max(prev.to, to); } else if (t.page) { prev.from = 0; prev.to = crossSize; prev.full = 1; } continue; }
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ key, axis: X ? "x" : "y", v, from, to, full: t.page ? 1 : 0 });
      }
      if (spacing) for (const c of spacingCandidates(b, others, X)) {
        if (Math.abs(c.pos - b[a.p]) > tol) continue;
        const at = b[a.cp] + b[a.cs] / 2;
        for (const [m0, m1] of c.marks) out.push({ gap: X ? "x" : "y", a: m0, b: m1, at });
        break;
      }
    }
    return out;
  }
  // Show guides for a moment after a toolbar/keyboard move.
  function flashGuides(g) {
    clearTimeout(guideTimer);
    guidesNow = g;
    paintSelection();
    guideTimer = setTimeout(() => { if (!drag) { guidesNow = []; paintSelection(); } }, 900);
  }
  function flashSelectionGuides() {
    const units = selUnits();
    if (!units.length) return;
    const out = [];
    for (const u of units) {
      const uid2 = new Set(u.map((L) => L.id));
      // match against the page and everything else (other selected units included)
      const others = page().layers.filter((L) => !L.hidden && !uid2.has(L.id)).map((L) => ({ x: L.x, y: L.y, w: L.w, h: L.h || 10 }));
      out.push(...guidesFor(bbox(u), others));
    }
    flashGuides(out);
  }

  let drag = null;
  const DRAG_START = 3;   // screen px before a press becomes a drag (no jump on click)
  artboard.addEventListener("pointerdown", (e) => {
    if (editingId || e.button === 2) return;
    if (e.target.closest(".ds-qa")) return;
    const p = pt(e);
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    const handle = e.target.closest(".ds-h");
    if (handle && multi.length) {
      const ls = selLayers().filter((L) => !L.locked);
      drag = { mode: "gresize", h: handle.dataset.h, start: p, box: bbox(ls), orig: ls.map(clone), moved: false };
    } else if (handle && sel) {
      drag = { mode: "resize", h: handle.dataset.h, start: p, orig: clone(layer(sel)), moved: false };
    } else {
      const L = hit(p);
      if (!L) {
        // Empty page: drag a box to select (shift/⌘ adds to the selection).
        const base = additive ? selIds() : [];
        if (!additive) setSelection([]);
        drag = { mode: "marquee", start: p, base, moved: false };
      } else {
        const ids = withGroup(L), cur = selIds();
        const inSel = ids.every((id) => cur.includes(id));
        let drill = false;
        if (additive) setSelection(inSel ? cur.filter((id) => !ids.includes(id)) : [...cur, ...ids]);
        else if (!inSel) setSelection(ids);
        // Clicking inside an already-selected group (no drag) picks that one layer.
        else drill = !!L.group && cur.length === ids.length && ids.length > 1;
        const moving = selLayers().filter((x) => !x.locked);
        if (selIds().includes(L.id) && moving.length) {
          drag = { mode: "move", start: p, box: bbox(moving), orig: moving.map(clone), moved: false, drill: drill ? L.id : null };
        }
      }
      paintToolbar();
      paintPanelIfLayers();
    }
    paintSelection();
    if (drag) artboard.setPointerCapture(e.pointerId);
  });
  artboard.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const p = pt(e);
    const dx = p.x - drag.start.x, dy = p.y - drag.start.y;
    if (!drag.moved) {
      if (Math.hypot(dx, dy) * scale < DRAG_START) return;
      drag.moved = true;
    }
    let guides = [];
    if (drag.mode === "marquee") {
      const m = { x: Math.min(drag.start.x, p.x), y: Math.min(drag.start.y, p.y), w: Math.abs(dx), h: Math.abs(dy) };
      const touched = page().layers.filter((L) => !L.hidden && !L.locked &&
        L.x < m.x + m.w && L.x + L.w > m.x && L.y < m.y + m.h && L.y + (L.h || 10) > m.y);
      setSelection([...drag.base, ...touched.flatMap(withGroup)]);
      paintSelection([], m);
      return;
    }
    if (drag.mode === "move") {
      const b0 = drag.box;
      const nb = { x: b0.x + dx, y: b0.y + dy, w: b0.w, h: b0.h };
      if (!drag.others) drag.others = scene(new Set(drag.orig.map((o) => o.id)));
      if (!e.altKey) {
        nb.x += snapShift(nb, drag.others, true, ["start", "mid", "end"], true);
        nb.y += snapShift(nb, drag.others, false, ["start", "mid", "end"], true);
      }
      const ox = Math.round(nb.x - b0.x), oy = Math.round(nb.y - b0.y);
      for (const o of drag.orig) { const L = layer(o.id); if (L) { L.x = o.x + ox; L.y = o.y + oy; } }
      guides = e.altKey ? [] : guidesFor({ x: b0.x + ox, y: b0.y + oy, w: b0.w, h: b0.h }, drag.others);
    } else if (drag.mode === "gresize") {
      // Scale everything together from the opposite corner.
      const h = drag.h, b = drag.box;
      const kx = (b.w + (h.includes("e") ? dx : -dx)) / Math.max(1, b.w);
      const ky = (b.h + (h.includes("s") ? dy : -dy)) / Math.max(1, b.h);
      const k = clamp(Math.abs(kx - 1) > Math.abs(ky - 1) ? kx : ky, 0.1, 8);
      const ax = h.includes("w") ? b.x + b.w : b.x, ay = h.includes("n") ? b.y + b.h : b.y;
      for (const o of drag.orig) {
        const L = layer(o.id); if (!L) continue;
        L.x = Math.round(ax + (o.x - ax) * k); L.y = Math.round(ay + (o.y - ay) * k);
        L.w = Math.max(4, Math.round(o.w * k)); L.h = Math.max(2, Math.round((o.h || 10) * k));
        if (o.type === "text") L.size = Math.round(o.size * k * 10) / 10;
        if (o.sw) L.sw = Math.round(o.sw * k * 10) / 10;
        if (o.radius) L.radius = Math.round(o.radius * k);
      }
    } else {
      const L = layer(sel);
      if (!L) return;
      const o = drag.orig, h = drag.h;
      const ratio = o.w / Math.max(1, o.h || 1);
      if (L.type === "text") {
        if (h === "e") L.w = Math.max(60, o.w + dx);
        else if (h === "w") { L.w = Math.max(60, o.w - dx); L.x = o.x + o.w - L.w; }
        else {
          // corners scale the type and the box together
          const k = clamp((o.w + (h.includes("e") ? dx : -dx)) / o.w, 0.2, 6);
          L.size = Math.round(o.size * k * 10) / 10; L.w = o.w * k;
          if (h.includes("w")) L.x = o.x + o.w - L.w;
          if (h.includes("n")) L.y = o.y + (o.h || 0) - (o.h || 0) * k;
        }
      } else {
        let nx = o.x, ny = o.y, nw = o.w, nh = o.h;
        if (h.includes("e")) nw = o.w + dx;
        if (h.includes("w")) { nw = o.w - dx; nx = o.x + dx; }
        if (h.includes("s")) nh = o.h + dy;
        if (h.includes("n")) { nh = o.h - dy; ny = o.y + dy; }
        if (h.length === 2 && !e.shiftKey && L.type !== "rect" && L.type !== "line") {   // keep proportions on corners
          nh = nw / ratio;
          if (h.includes("n")) ny = o.y + o.h - nh;
        }
        // Snap the edges being dragged.
        if (!e.altKey) {
          if (!drag.others) drag.others = scene(new Set([L.id]));
          const lockRatio = h.length === 2 && !e.shiftKey && L.type !== "rect" && L.type !== "line";
          const bx = { x: nx, y: ny, w: nw, h: nh };
          if (h.includes("e")) nw += snapShift(bx, drag.others, true, ["end"], false);
          if (h.includes("w")) { const d = snapShift(bx, drag.others, true, ["start"], false); nx += d; nw -= d; }
          if (lockRatio) { const nh2 = nw / ratio; if (h.includes("n")) ny = o.y + o.h - nh2; nh = nh2; }
          else {
            if (h.includes("s")) nh += snapShift(bx, drag.others, false, ["end"], false);
            if (h.includes("n")) { const d = snapShift(bx, drag.others, false, ["start"], false); ny += d; nh -= d; }
          }
        }
        L.x = Math.round(nx); L.y = Math.round(ny); L.w = Math.max(10, Math.round(nw)); L.h = Math.max(L.type === "line" ? 4 : 10, Math.round(nh));
      }
      if (!e.altKey) {
        if (!drag.others) drag.others = scene(new Set([L.id]));
        // Text side handles: snap the edge that moves.
        if (L.type === "text" && (h === "e" || h === "w")) {
          const bx = { x: L.x, y: L.y, w: L.w, h: L.h || 10 };
          const d = snapShift(bx, drag.others, true, [h === "e" ? "end" : "start"], false);
          if (h === "e") L.w += d; else { L.x += d; L.w -= d; }
        }
        const eX = [h.includes("w") ? "start" : null, h.includes("e") ? "end" : null].filter(Boolean);
        const eY = [h.includes("n") ? "start" : null, h.includes("s") ? "end" : null].filter(Boolean);
        guides = guidesFor({ x: L.x, y: L.y, w: L.w, h: L.h || 10 }, drag.others, { spacing: false, edgesX: eX, edgesY: eY });
      }
    }
    clearTimeout(guideTimer);
    guidesNow = guides;
    draw();
    paintSelection();
  });
  const endDrag = () => {
    if (!drag) return;
    const d = drag;
    drag = null;
    guidesNow = [];
    if (!d.moved) {
      // A plain click: nothing moves. Inside a selected group it drills in.
      if (d.drill) setSelection([d.drill]);
      paintSelection(); paintToolbar(); paintPanelIfLayers();
      return;
    }
    if (d.mode === "marquee") { paintSelection(); paintToolbar(); paintPanelIfLayers(); return; }
    paintSelection();
    commit(); paintToolbar();
  };
  artboard.addEventListener("pointerup", endDrag);
  artboard.addEventListener("pointercancel", endDrag);

  // ── eraser ──
  const brushEl = el("div", { class: "ds-brush", "aria-hidden": "true" });
  artboard.appendChild(brushEl);
  function eraserTarget() {
    if (!eraser) return null;
    return eraser.target === "bg" ? page().bg : layer(eraser.id);
  }
  function startEraser(target) {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem("catalyst.studio.brush") || "{}"); } catch {}
    if (target === "layer") { const L = sel && layer(sel); if (!L || L.type !== "image") return; eraser = { target, id: L.id }; }
    else { if (!page().bg?.image) return; eraser = { target: "bg" }; }
    Object.assign(eraser, { mode: "e", size: saved.size || 60, soft: saved.soft ?? 0.35 });
    artboard.classList.add("is-erasing");
    paintToolbar(); paintSelection();
  }
  function stopEraser() {
    eraser = null; painting = null;
    artboard.classList.remove("is-erasing");
    brushEl.style.display = "none";
    paintToolbar(); paintSelection();
  }
  function moveBrush(p) {
    if (!eraser || !p) { brushEl.style.display = "none"; return; }
    lastBrushPt = p;
    const r = eraser.size;
    Object.assign(brushEl.style, { display: "block", left: `${(p.x - r) * scale}px`, top: `${(p.y - r) * scale}px`, width: `${2 * r * scale}px`, height: `${2 * r * scale}px` });
    brushEl.classList.toggle("is-restore", eraser.mode === "r");
  }
  // Page point → the target's own 0–1 space (+ radius as a fraction of its width).
  function toTarget(p) {
    const T = eraserTarget(); if (!T) return null;
    const f = fmt();
    const box = eraser.target === "bg" ? { x: 0, y: 0, w: f.w, h: f.h } : { x: T.x, y: T.y, w: T.w, h: T.h || 10 };
    return { u: (p.x - box.x) / box.w, v: (p.y - box.y) / box.h, r: eraser.size / box.w, box };
  }
  const r4 = (n) => Math.round(n * 10000) / 10000;
  artboard.addEventListener("pointerdown", (e) => {
    if (!eraser || editingId || e.target.closest(".ds-qa")) return;
    e.stopImmediatePropagation();
    const T = eraserTarget(); if (!T) return stopEraser();
    const q = toTarget(pt(e));
    painting = { m: eraser.mode, r: r4(q.r), s: eraser.soft, p: [r4(q.u), r4(q.v)] };
    (T.erase || (T.erase = [])).push(painting);
    artboard.setPointerCapture(e.pointerId);
    draw();
  }, true);
  artboard.addEventListener("pointermove", (e) => {
    if (!eraser) return;
    const p = pt(e);
    moveBrush(p);
    if (!painting) return;
    const q = toTarget(p); if (!q) return;
    const n = painting.p.length;
    const du = (q.u - painting.p[n - 2]) * q.box.w, dv = (q.v - painting.p[n - 1]) * q.box.h;
    if (Math.hypot(du, dv) < Math.max(1.5, eraser.size * 0.12)) return;
    painting.p.push(r4(q.u), r4(q.v));
    draw();
  });
  const endPaint = () => { if (!painting) return; painting = null; commit(); paintToolbar(); };
  artboard.addEventListener("pointerup", endPaint);
  artboard.addEventListener("pointercancel", endPaint);
  artboard.addEventListener("pointerleave", () => { if (!painting) brushEl.style.display = "none"; });

  // ── font picker ──
  let fontPop = null;
  function closeFontPicker() { fontPop?.remove(); fontPop = null; document.removeEventListener("pointerdown", onFontOutside, true); }
  function onFontOutside(e) { if (fontPop && !fontPop.contains(e.target) && !e.target.closest('[data-act="font-pick"]')) closeFontPicker(); }
  let _previewSheet = false;
  function openFontPicker(btn) {
    if (fontPop) return closeFontPicker();
    const L = sel && layer(sel); if (!L || L.type !== "text") return;
    if (!_previewSheet) {   // every family at one weight, for the previews
      _previewSheet = true;
      const l = document.createElement("link"); l.rel = "stylesheet";
      l.href = fontCssUrl(Object.keys(FONTS), true);
      document.head.appendChild(l);
    }
    const row = (k) => { const F = FONTS[k]; return `<button type="button" role="option" data-font="${k}" class="${L.font === k || (!L.font && k === "sans") ? "is-on" : ""}" style="font-family:${esc(F.css)};font-weight:${nearestWeight(F, 400)}">${esc(F.label)}</button>`; };
    const recs = Object.keys(FONTS).filter((k) => FONTS[k].rec);
    fontPop = el("div", { class: "ds-fontpop", role: "dialog", "aria-label": "Fonts" });
    fontPop.innerHTML = `
      <input type="search" class="ds-fontsearch" placeholder="Search fonts" aria-label="Search fonts">
      <div class="ds-fontlist" role="listbox">
        <div class="ds-fontgroup" data-group="rec"><h5>Recommended for The Catalyst</h5>
          ${recs.map((k) => `<button type="button" role="option" data-font="${k}" class="ds-fontrec${L.font === k || (!L.font && k === "sans") ? " is-on" : ""}"><span style="font-family:${esc(FONTS[k].css)};font-weight:${k === "sans" ? 600 : 400}">${esc(FONTS[k].label)}</span><small style="font-family:${esc(FONTS[k].css)}">Science, told beautifully.</small></button>`).join("")}
        </div>
        ${FONT_CATS.map((c) => `<div class="ds-fontgroup"><h5>${c}</h5>${Object.keys(FONTS).filter((k) => FONTS[k].cat === c).map(row).join("")}</div>`).join("")}
      </div>`;
    container.querySelector(".ds").appendChild(fontPop);
    const r = btn.getBoundingClientRect(), host = container.querySelector(".ds").getBoundingClientRect();
    Object.assign(fontPop.style, { left: `${Math.max(8, r.left - host.left)}px`, top: `${r.bottom - host.top + 6}px` });
    const search = fontPop.querySelector(".ds-fontsearch");
    search.focus();
    search.addEventListener("input", () => {
      const q = search.value.trim().toLowerCase();
      fontPop.querySelectorAll("[data-font]").forEach((b2) => { b2.hidden = q && !FONTS[b2.dataset.font].label.toLowerCase().includes(q); });
      fontPop.querySelectorAll(".ds-fontgroup").forEach((g) => { g.hidden = ![...g.querySelectorAll("[data-font]")].some((x) => !x.hidden); });
    });
    search.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); closeFontPicker(); btn.focus(); } e.stopPropagation(); });
    fontPop.addEventListener("click", async (e) => {
      const b2 = e.target.closest("[data-font]"); if (!b2) return;
      const k = b2.dataset.font, T = sel && layer(sel); if (!T) return;
      T.font = k;
      T.weight = nearestWeight(FONTS[k], T.weight || 400);
      closeFontPicker();
      await ensureFontsFor([T]);
      commit(); draw(); paintToolbar();
    });
    setTimeout(() => document.addEventListener("pointerdown", onFontOutside, true), 0);
  }

  // ── clipboard (layers) ──
  let clip = null, pendingPaste = 0;
  function copySelection() { const ls = selLayers(); if (ls.length) clip = ls.map(clone); }
  function pasteLayers() {
    if (!clip || !clip.length) return;
    const regroup = {}, made = [];
    const exists = (c) => page().layers.some((l) => l.x === c.x && l.y === c.y && l.type === c.type);
    const off = clip.some(exists) ? 24 : 0;
    for (const c0 of clip) {
      const c = { ...clone(c0), id: uid(), x: c0.x + off, y: c0.y + off };
      if (c0.group) c.group = regroup[c0.group] || (regroup[c0.group] = "g" + uid());
      page().layers.push(c); made.push(c.id);
    }
    clip = clip.map((c) => ({ ...c, x: c.x + off, y: c.y + off }));
    setSelection(made); commit(); draw(); paintToolbar(); paintPanelIfLayers();
  }

  // ── right-click menu ──
  let ctxMenu = null;
  function closeMenu() { ctxMenu?.remove(); ctxMenu = null; }
  function openMenu(clientX, clientY) {
    closeMenu();
    const ls = selLayers(), n = ls.length, L = ls[0];
    const grouped = n > 1 && ls.every((x) => x.group && x.group === ls[0].group);
    const item = (act, label, key = "", dis = false, danger = false) => `<button type="button" role="menuitem" data-m="${act}"${dis ? " disabled" : ""} class="${danger ? "is-danger" : ""}"><span>${label}</span>${key ? `<kbd>${key}</kbd>` : ""}</button>`;
    const sep = `<span class="ds-menusep" role="separator"></span>`;
    const html = n ? [
      item("copy", "Copy", "⌘C"), item("cut", "Cut", "⌘X"), item("paste", "Paste", "⌘V", !clip), item("dup", "Duplicate", "⌘D"), item("del", "Delete", "⌫", false, true), sep,
      item("front", "Bring to front", "⇧⌘]"), item("up", "Bring forward", "⌘]"), item("down", "Send backward", "⌘["), item("back", "Send to back", "⇧⌘["), sep,
      n > 1 ? (grouped ? item("ungroup", "Ungroup", "⇧⌘G") : item("group", "Group", "⌘G")) : (L.group ? item("ungroup", "Ungroup", "⇧⌘G") : ""),
      n === 1 ? item("lock", L.locked ? "Unlock" : "Lock") : "",
      n === 1 && L.type === "text" ? item("edit", "Edit text", "Double-click") : "",
      n === 1 && L.type === "image" ? item("erase", "Erase parts…") + item("to-bg", "Set as background") : "",
    ].join("") : [item("paste", "Paste", "⌘V", !clip), item("all", "Select all", "⌘A"), sep, page().bg?.image ? item("bg-erase", "Erase parts of the background…") : "", item("new-page", "Add a page")].join("");
    ctxMenu = el("div", { class: "ds-menu ds-ctxmenu", role: "menu" });
    ctxMenu.innerHTML = html;
    const root = container.querySelector(".ds"), rr = root.getBoundingClientRect();
    root.appendChild(ctxMenu);
    const mw = ctxMenu.offsetWidth, mh = ctxMenu.offsetHeight;
    Object.assign(ctxMenu.style, { left: `${Math.min(clientX - rr.left, rr.width - mw - 8)}px`, top: `${Math.min(clientY - rr.top, rr.height - mh - 8)}px` });
    ctxMenu.addEventListener("click", (e) => {
      const b = e.target.closest("[data-m]"); if (!b || b.disabled) return;
      closeMenu();
      runAction(b.dataset.m);
    });
  }
  function runAction(m) {
    const ls = selLayers(), ids = ls.map((x) => x.id), L = ls[0];
    if (m === "copy") return copySelection();
    if (m === "cut") { copySelection(); return removeLayers(ids); }
    if (m === "paste") return pasteLayers();
    if (m === "dup") return duplicateLayers(ids);
    if (m === "del") return removeLayers(ids);
    if (m === "group") return groupSelection();
    if (m === "ungroup") return ungroupSelection();
    if (m === "all") { setSelection(page().layers.filter((x) => !x.hidden && !x.locked).map((x) => x.id)); paintSelection(); paintToolbar(); return; }
    if (m === "lock" && L) { L.locked = !L.locked; commit(); draw(); paintToolbar(); return; }
    if (m === "edit" && L) return startEditing(L);
    if (m === "erase") return startEraser("layer");
    if (m === "bg-erase") return startEraser("bg");
    if (m === "to-bg") { const b = $('#ds-toolbar [data-act="to-bg"]'); return b && b.click(); }
    if (m === "new-page") { design.pages.splice(pageIdx + 1, 0, blankPage()); pageIdx++; setSelection([]); commit(); refreshAll(); return; }
    if (["front", "up", "down", "back"].includes(m)) {
      const order = m === "front" || m === "up" ? [...ids].reverse() : ids;
      for (const id of order) moveLayer(id, m === "front" ? "top" : m === "back" ? "bottom" : m === "up" ? 1 : -1);
      paintToolbar();
    }
  }
  artboard.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    if (editingId || eraser) return;
    const L = hit(pt(e));
    if (L && !selIds().includes(L.id)) setSelection(withGroup(L));
    if (!L) setSelection([]);
    paintSelection(); paintToolbar(); paintPanelIfLayers();
    openMenu(e.clientX, e.clientY);
  });
  document.addEventListener("pointerdown", (e) => { if (ctxMenu && !ctxMenu.contains(e.target)) closeMenu(); }, true);
  overlay.addEventListener("click", (e) => {
    const b = e.target.closest("[data-qa]"); if (!b) return;
    const ls = selLayers(), ids = ls.map((x) => x.id);
    if (b.dataset.qa === "dup") duplicateLayers(ids);
    else if (b.dataset.qa === "del") removeLayers(ids);
    else if (b.dataset.qa === "lock") { const on = !ls.every((x) => x.locked); ls.forEach((x) => { x.locked = on; }); commit(); draw(); paintToolbar(); }
    else if (b.dataset.qa === "more") { const r = b.getBoundingClientRect(); openMenu(r.left, r.bottom + 6); }
  });

  // ── hover outline + cursor ──
  const hoverEl = el("div", { class: "ds-hover", "aria-hidden": "true" });
  artboard.appendChild(hoverEl);
  artboard.addEventListener("pointermove", (e) => {
    if (drag || eraser || editingId) { hoverEl.style.display = "none"; return; }
    if (e.target.closest(".ds-h")) { hoverEl.style.display = "none"; artboard.style.cursor = ""; return; }
    if (e.target.closest(".ds-qa")) { hoverEl.style.display = "none"; artboard.style.cursor = "default"; return; }
    const L = hit(pt(e));
    artboard.style.cursor = L ? (L.locked ? "default" : "move") : "default";
    if (L && !selIds().includes(L.id)) {
      Object.assign(hoverEl.style, { display: "block", left: `${L.x * scale}px`, top: `${L.y * scale}px`, width: `${L.w * scale}px`, height: `${(L.h || 10) * scale}px` });
    } else hoverEl.style.display = "none";
  });
  artboard.addEventListener("pointerleave", () => { hoverEl.style.display = "none"; });

  // ── edit text in place ──
  artboard.addEventListener("dblclick", (e) => {
    const L = hit(pt(e));
    if (L && L.type === "text" && !L.locked) startEditing(L);
  });
  function startEditing(L) {
    setSelection([L.id]); editingId = L.id;
    const ta = el("textarea", { class: "ds-inline-edit", spellcheck: "true" });
    ta.value = L.text;
    Object.assign(ta.style, {
      left: `${L.x * scale}px`, top: `${L.y * scale}px`, width: `${L.w * scale}px`, minHeight: `${(L.h || L.size * 1.2) * scale}px`,
      font: `${L.italic && fontOf(L.font).it.length ? "italic " : ""}${nearestWeight(fontOf(L.font), L.weight || 400)} ${L.size * scale}px ${fontOf(L.font).css}`,
      lineHeight: `${(L.lh || 1.15)}`, color: L.color, textAlign: L.align || "left",
      letterSpacing: `${(L.ls || 0) * L.size * scale}px`, textTransform: L.upper ? "uppercase" : "none",
    });
    overlay.innerHTML = "";
    overlay.appendChild(ta);
    draw();
    ta.addEventListener("pointerdown", (e) => e.stopPropagation());
    ta.focus();
    ta.select();
    const grow = () => { ta.style.height = "auto"; ta.style.height = `${ta.scrollHeight}px`; };
    grow();
    ta.addEventListener("input", () => { L.text = ta.value; grow(); });
    const done = () => {
      editingId = null;
      ta.remove();
      commit();
      draw();
      paintToolbar();
    };
    ta.addEventListener("blur", done, { once: true });
    ta.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); ta.blur(); } e.stopPropagation(); });
  }

  // ── keyboard ──
  const onKey = (e) => {
    if (!container.isConnected) return;
    if (!container.getClientRects().length) return;   // studio tab not visible
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || "") || document.activeElement?.isContentEditable;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); doSave({ auto: false }); return; }
    if (mod && (e.key === "=" || e.key === "+" || e.key === "-" || e.key === "0") && !typing) { e.preventDefault(); setZoom(e.key === "0" ? 1 : zoom * (e.key === "-" ? 0.8 : 1.25)); return; }
    if (mod && e.key.toLowerCase() === "z") { if (typing) return; e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); return; }
    if (typing) return;
    if (eraser) {
      if (e.key === "Escape" || e.key === "Enter") { e.preventDefault(); stopEraser(); }
      else if (e.key === "[" || e.key === "]") { e.preventDefault(); eraser.size = clamp(eraser.size * (e.key === "]" ? 1.15 : 1 / 1.15), 6, 320); paintToolbar(); moveBrush(lastBrushPt); }
      return;
    }
    if (mod && e.key.toLowerCase() === "a") { e.preventDefault(); setSelection(page().layers.filter((L) => !L.hidden && !L.locked).map((L) => L.id)); paintSelection(); paintToolbar(); paintPanelIfLayers(); return; }
    if (e.key === "Escape") closeMenu();
    if (mod && e.key.toLowerCase() === "v") { clearTimeout(pendingPaste); pendingPaste = setTimeout(() => pasteLayers(), 80); return; }
    const ls = selLayers();
    if (!ls.length) return;
    if (mod && e.key.toLowerCase() === "c") { copySelection(); return; }
    if (mod && e.key.toLowerCase() === "x") { e.preventDefault(); copySelection(); removeLayers(ls.map((L) => L.id)); return; }
    if (mod && (e.key === "]" || e.key === "[")) { e.preventDefault(); runAction(e.key === "]" ? (e.shiftKey ? "front" : "up") : (e.shiftKey ? "back" : "down")); return; }
    if (mod && e.key.toLowerCase() === "g") { e.preventDefault(); e.shiftKey ? ungroupSelection() : groupSelection(); return; }
    if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); removeLayers(ls.map((L) => L.id)); return; }
    if (mod && e.key.toLowerCase() === "d") { e.preventDefault(); duplicateLayers(ls.map((L) => L.id)); return; }
    if (e.key === "Escape") { setSelection([]); paintSelection(); paintToolbar(); paintPanelIfLayers(); return; }
    const step = e.shiftKey ? 10 : 1;
    const mv = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    const movable = ls.filter((L) => !L.locked);
    if (mv && movable.length) { e.preventDefault(); movable.forEach((L) => { L.x += mv[0]; L.y += mv[1]; }); draw(); commitSoon(); flashSelectionGuides(); }
  };
  document.addEventListener("keydown", onKey);

  // ── layer ops ──
  function addLayer(L) {
    const f = fmt();
    L.id = uid();
    if (L.x == null) L.x = Math.round((f.w - L.w) / 2);
    if (L.y == null) L.y = Math.round((f.h - (L.h || 100)) / 2);
    page().layers.push(L);
    setSelection([L.id]);
    commit(); draw(); paintToolbar(); paintPanelIfLayers();
  }
  function removeLayer(id) { removeLayers([id]); }
  function removeLayers(ids) {
    page().layers = page().layers.filter((l) => !ids.includes(l.id));
    setSelection(selIds().filter((id) => !ids.includes(id)));
    commit(); draw(); paintToolbar(); paintPanelIfLayers();
  }
  function duplicateLayer(id) { duplicateLayers([id]); }
  // Copies keep their grouping (as a new group), offset down and right.
  function duplicateLayers(ids) {
    const regroup = {}, made = [];
    for (const id of ids) {
      const L = layer(id); if (!L) continue;
      const c = { ...clone(L), id: uid(), x: L.x + 24, y: L.y + 24 };
      if (L.group) c.group = regroup[L.group] || (regroup[L.group] = "g" + uid());
      page().layers.splice(page().layers.indexOf(L) + 1, 0, c);
      made.push(c.id);
    }
    setSelection(made); commit(); draw(); paintToolbar(); paintPanelIfLayers();
  }
  function moveLayer(id, dir) {
    const ls = page().layers, i = ls.findIndex((l) => l.id === id);
    const j = dir === "top" ? ls.length - 1 : dir === "bottom" ? 0 : clamp(i + dir, 0, ls.length - 1);
    if (i < 0 || i === j) return;
    const [x] = ls.splice(i, 1); ls.splice(j, 0, x);
    commit(); draw(); paintPanelIfLayers();
  }

  // ── contextual toolbar ──
  // Colours already used anywhere in the design (for quick matching).
  function designColours() {
    const out = new Set();
    for (const pg of design.pages) {
      if (/^#[0-9a-f]{6}$/i.test(pg.bg?.color || "")) out.add(pg.bg.color.toLowerCase());
      for (const L of pg.layers) for (const c of [L.color, L.fill]) if (/^#[0-9a-f]{6}$/i.test(c || "")) out.add(c.toLowerCase());
    }
    return [...out].filter((c) => !PALETTE.includes(c)).slice(0, 8);
  }
  function swatches(cur, attr, { none = false } = {}) {
    const hex = /^#[0-9a-f]{6}$/i.test(cur || "") ? cur.toLowerCase() : "";
    const sw = (c) => `<button type="button" class="ds-sw${hex === c.toLowerCase() ? " is-on" : ""}" data-${attr}="${c}" style="--c:${c}" title="${c}" aria-label="Colour ${c}"></button>`;
    const used = designColours();
    return `<div class="ds-swatches">
      ${none ? `<button type="button" class="ds-sw ds-sw-none${!cur ? " is-on" : ""}" data-${attr}="none" title="None" aria-label="No colour"></button>` : ""}
      ${used.length ? used.map(sw).join("") + `<span class="ds-sw-sep" aria-hidden="true"></span>` : ""}
      ${PALETTE.map(sw).join("")}
      <label class="ds-sw ds-sw-custom" title="Pick any colour"><input type="color" data-${attr}-custom value="${hex || "#0f172a"}" aria-label="Pick any colour"></label>
      <input class="ds-hex" type="text" maxlength="7" spellcheck="false" value="${hex}" placeholder="#hex" data-${attr}-hex aria-label="Hex colour">
    </div>`;
  }
  function paintToolbar() { $("#ds-toolbar").innerHTML = toolbarHTML(); }
  // Reserve the height of the tallest toolbar at this width, so selecting
  // something never pushes the page up or down.
  let lockedForW = 0;
  function lockToolbarHeight(force = false) {
    const tb = $("#ds-toolbar");
    const w = tb.clientWidth;
    if (!w || (!force && w === lockedForW)) return;
    lockedForW = w;
    tb.style.minHeight = "";
    let max = 0;
    for (const [L, n] of [[{ __eraser: true }, 1], [null, 0], [txt({}), 1], [{ type: "image", fit: "contain", w: 100, h: 100 }, 1], [{ type: "rect", fill: "#0f172a", w: 100, h: 100 }, 1], [{ type: "line", w: 100, h: 14 }, 1], [null, 3]]) {
      tb.innerHTML = toolbarHTML(L, n, true);
      max = Math.max(max, tb.offsetHeight);
    }
    tb.style.minHeight = `${max}px`;
    paintToolbar();
  }
  const ICON_ALIGN = {
    left: '<path d="M4 3v18"/><rect x="8" y="6" width="11" height="4" rx="1"/><rect x="8" y="14" width="7" height="4" rx="1"/>',
    center: '<path d="M12 3v18"/><rect x="6" y="6" width="12" height="4" rx="1"/><rect x="8" y="14" width="8" height="4" rx="1"/>',
    right: '<path d="M20 3v18"/><rect x="5" y="6" width="11" height="4" rx="1"/><rect x="9" y="14" width="7" height="4" rx="1"/>',
    top: '<path d="M3 4h18"/><rect x="6" y="8" width="4" height="11" rx="1"/><rect x="14" y="8" width="4" height="7" rx="1"/>',
    middle: '<path d="M3 12h18"/><rect x="6" y="6" width="4" height="12" rx="1"/><rect x="14" y="8" width="4" height="8" rx="1"/>',
    bottom: '<path d="M3 20h18"/><rect x="6" y="5" width="4" height="11" rx="1"/><rect x="14" y="9" width="4" height="7" rx="1"/>',
  };
  const alignButtons = (toPage) => ["left", "center", "right", "top", "middle", "bottom"].map((a) =>
    `<button type="button" class="ds-icon" data-place="${a}" title="Align ${a}${toPage ? " to the page" : ""}" aria-label="Align ${a}${toPage ? " to the page" : ""}"><svg viewBox="0 0 24 24">${ICON_ALIGN[a]}</svg></button>`).join("");
  // sample: every button shown, for measuring the toolbar's height.
  function multiToolbar(n, sample = false) {
    const ls = selLayers();
    const grouped = !sample && ls.length > 1 && ls.every((L) => L.group && L.group === ls[0].group);
    const anyGroup = sample || ls.some((L) => L.group);
    const units = sample ? 3 : selUnits().length;
    return `
      <span class="ds-tb-label">${grouped ? "Group" : `${n || ls.length} selected`}</span><span class="ds-tb-sep"></span>
      ${alignButtons(units <= 1)}
      ${units >= 3 ? `<button type="button" class="ds-icon" data-act="dist-h" title="Space evenly across" aria-label="Space evenly across"><svg viewBox="0 0 24 24"><path d="M3 4v16M21 4v16"/><rect x="9" y="7" width="6" height="10" rx="1"/></svg></button>
      <button type="button" class="ds-icon" data-act="dist-v" title="Space evenly down" aria-label="Space evenly down"><svg viewBox="0 0 24 24"><path d="M4 3h16M4 21h16"/><rect x="7" y="9" width="10" height="6" rx="1"/></svg></button>` : ""}
      <span class="ds-tb-sep"></span>
      ${grouped ? "" : `<button type="button" class="ds-ghost" data-act="group" title="Group (⌘G)">Group</button>`}
      ${anyGroup ? `<button type="button" class="ds-ghost" data-act="ungroup" title="Ungroup (⇧⌘G)">Ungroup</button>` : ""}
      <span class="ds-tb-sep"></span>
      <button type="button" class="ds-icon" data-act="dup" title="Duplicate (⌘D)" aria-label="Duplicate"><svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/></svg></button>
      <button type="button" class="ds-icon is-danger" data-act="del" title="Delete" aria-label="Delete"><svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg></button>
      <span class="ds-tb-hint">Shift- or ⌘-click to add or remove. Drag a corner to resize together.</span>`;
  }
  function eraserToolbar() {
    const er = eraser || { mode: "e", size: 60, soft: 0.35, target: "layer" };
    const T = eraserTarget();
    const count = (T?.erase || []).length;
    return `
      <span class="ds-tb-label">Eraser · ${er.target === "bg" ? "background" : "image"}</span><span class="ds-tb-sep"></span>
      <div class="ds-seg" role="group" aria-label="Brush">
        <button type="button" data-er-mode="e" class="${er.mode === "e" ? "is-on" : ""}" aria-pressed="${er.mode === "e"}">Erase</button>
        <button type="button" data-er-mode="r" class="${er.mode === "r" ? "is-on" : ""}" aria-pressed="${er.mode === "r"}">Restore</button>
      </div>
      <label class="ds-tb-field" title="Brush size ( [ and ] )">Size<input type="range" min="6" max="320" step="1" value="${er.size}" data-er="size"><output>${Math.round(er.size)}</output></label>
      <label class="ds-tb-field" title="Soft edges blend the cut into the picture">Softness<input type="range" min="0" max="0.9" step="0.05" value="${er.soft}" data-er="soft"></label>
      <span class="ds-tb-sep"></span>
      <button type="button" class="ds-ghost" data-act="er-undo"${count ? "" : " disabled"}>Undo stroke</button>
      <button type="button" class="ds-ghost" data-act="er-reset"${count ? "" : " disabled"}>Reset</button>
      <button type="button" class="btn btn-primary btn-sm" data-act="er-done">Done</button>
      <span class="ds-tb-hint">Paint over the part you want gone. Restore paints it back. Nothing is lost: the original image is kept.</span>`;
  }
  // Toolbar popovers: one open at a time, kept open across re-renders.
  let openPop = null;
  const I = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
  const ICONS = {
    opacity: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M4 12h16M12 4v16M8 4v8M16 12v8"/>',
    position: '<rect x="4" y="9" width="10" height="10" rx="1.5"/><path d="M10 5h9v9"/>',
    spacing: '<path d="M4 7h16M4 12h10M4 17h16"/><path d="m18 10 2 2-2 2"/>',
    corners: '<path d="M4 20V10a6 6 0 0 1 6-6h10"/>',
    border: '<rect x="4" y="4" width="16" height="16" rx="2" stroke-dasharray="3 2.5"/>',
    adjust: '<path d="M5 6h9M18 6h1M5 12h3M12 12h7M5 18h11M20 18h-1"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
    wash: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>',
    edit: '<path d="M4 20h4L20 8l-4-4L4 16v4z"/>',
    dup: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
    del: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>',
    more: '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
    italic: '<path d="M14 4h-4M14 20h-4M15 4 9 20"/>',
    upper: '<path d="M3 18 7 6l4 12M4.5 14h5M14 18V6h4a3 3 0 0 1 0 6h-4m0 0h4.5a3 3 0 0 1 0 6H14"/>',
    bold: '<path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z"/>',
    tleft: '<path d="M4 6h16M4 10h10M4 14h16M4 18h10"/>', tcenter: '<path d="M4 6h16M7 10h10M4 14h16M7 18h10"/>', tright: '<path d="M4 6h16M10 10h10M4 14h16M10 18h10"/>',
    front: '<rect x="8" y="8" width="11" height="11" rx="1.5"/><path d="M5 15V6a1 1 0 0 1 1-1h9"/>',
  };
  const lockIcon = (on) => `<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 ${on ? "8 0v3" : "7.5-1.5"}"/>`;
  function popBtn(key, inner, title, content, cls = "") {
    const on = openPop === key;
    return `<span class="ds-popwrap${on ? " is-open" : ""}"><button type="button" class="ds-tbtn ${cls}" data-pop="${key}" title="${title}" aria-label="${title}" aria-haspopup="dialog" aria-expanded="${on}">${inner}</button>${on ? `<div class="ds-pop" data-popbody="${key}" role="dialog" aria-label="${title}">${content}</div>` : ""}</span>`;
  }
  const field = (label, input, out = "") => `<label class="ds-popfield"><span>${label}</span>${input}${out ? `<output>${out}</output>` : ""}</label>`;
  function commonRight(L) {
    return `
      <span class="ds-tb-sep"></span>
      ${popBtn("opacity", I(ICONS.opacity), "Transparency", field("Transparency", `<input type="range" min="0.1" max="1" step="0.05" value="${L.opacity ?? 1}" data-prop="opacity">`, `${Math.round((L.opacity ?? 1) * 100)}%`))}
      ${popBtn("position", `${I(ICONS.position)}<span>Position</span>`, "Position", `
        <div class="ds-pophead">Layer order</div>
        <div class="ds-popgrid2">
          <button type="button" class="ds-popbtn" data-act="front">Bring to front</button><button type="button" class="ds-popbtn" data-act="up">Forward</button>
          <button type="button" class="ds-popbtn" data-act="back">Send to back</button><button type="button" class="ds-popbtn" data-act="down">Backward</button>
        </div>
        <div class="ds-pophead">Align to the page</div>
        <div class="ds-poprow">${alignButtons(true)}</div>`, "has-label")}
      <button type="button" class="ds-icon${L.locked ? " is-on" : ""}" data-act="lock" title="${L.locked ? "Unlock" : "Lock"}" aria-label="${L.locked ? "Unlock" : "Lock"}">${I(lockIcon(L.locked))}</button>
      <button type="button" class="ds-icon" data-act="dup" title="Duplicate (⌘D)" aria-label="Duplicate">${I(ICONS.dup)}</button>
      <button type="button" class="ds-icon is-danger" data-act="del" title="Delete (⌫)" aria-label="Delete">${I(ICONS.del)}</button>`;
  }
  const colourDot = (c) => `<span class="ds-cdot" style="--c:${c && c !== "none" ? c : "transparent"}"></span>`;
  function toolbarHTML(L = sel && layer(sel), n = selIds().length, sample = false) {
    if (eraser || L?.__eraser) return eraserToolbar();
    if (n > 1) return multiToolbar(n, sample);
    if (!L) return bgControls();
    if (sample) openPop = null;
    if (L.type === "text") {
      const F = fontOf(L.font), align = L.align || "left";
      return `
        <button type="button" class="ds-fontbtn" data-act="font-pick" aria-haspopup="listbox" title="Font" style="font-family:${esc(F.css)}">${esc(F.label)}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button>
        <select class="ds-weight" data-prop="weight" aria-label="Weight" title="Weight">${F.w.map((w) => `<option value="${w}"${nearestWeight(F, Number(L.weight) || 400) === w ? " selected" : ""}>${WEIGHT_NAMES[w] || w}</option>`).join("")}</select>
        <div class="ds-stepper" title="Font size">
          <button type="button" data-act="size-dec" aria-label="Smaller">−</button>
          <input type="number" min="6" max="400" value="${Math.round(L.size)}" data-prop="size" aria-label="Font size">
          <button type="button" data-act="size-inc" aria-label="Bigger">+</button>
        </div>
        ${popBtn("color", `<span class="ds-colorA" style="--c:${esc(L.color || "#0f172a")}">A</span>`, "Text colour", `<div class="ds-pophead">Text colour</div>${swatches(L.color, "color")}`)}
        <button type="button" class="ds-icon${(L.weight || 400) >= 600 ? " is-on" : ""}" data-act="bold" title="Bold" aria-label="Bold">${I(ICONS.bold)}</button>
        <button type="button" class="ds-icon${L.italic ? " is-on" : ""}" data-toggle="italic" title="Italic" aria-label="Italic">${I(ICONS.italic)}</button>
        <button type="button" class="ds-icon${L.upper ? " is-on" : ""}" data-toggle="upper" title="Uppercase" aria-label="Uppercase">${I(ICONS.upper)}</button>
        <button type="button" class="ds-icon" data-act="align-cycle" title="Text alignment: ${align}" aria-label="Text alignment: ${align}">${I(ICONS["t" + align])}</button>
        ${popBtn("spacing", I(ICONS.spacing), "Spacing", `
          ${field("Letter spacing", `<input type="range" min="-0.08" max="0.3" step="0.005" value="${L.ls || 0}" data-prop="ls">`, Math.round((L.ls || 0) * 1000))}
          ${field("Line spacing", `<input type="range" min="0.8" max="2" step="0.02" value="${L.lh || 1.15}" data-prop="lh">`, (L.lh || 1.15).toFixed(2))}`)}
        <button type="button" class="ds-icon" data-act="edit" title="Edit text (double-click)" aria-label="Edit text">${I(ICONS.edit)}</button>
        ${commonRight(L)}`;
    } else if (L.type === "image") {
      return `
        <button type="button" class="ds-tbtn has-label ds-erase-btn" data-act="erase" title="Paint away parts of this image"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 21-4-4 10-10 8 8-6 6H7z"/><path d="M8 12l6 6"/><path d="M14 21h7"/></svg><span>Erase</span></button>
        ${popBtn("adjust", `${I(ICONS.adjust)}<span>Adjust</span>`, "Adjust image", `
          ${field("Fit", `<select data-prop="fit"><option value="contain"${L.fit !== "cover" ? " selected" : ""}>Whole image</option><option value="cover"${L.fit === "cover" ? " selected" : ""}>Fill the box</option></select>`)}
          ${field("Blend", `<select data-prop="blend"><option value="normal"${L.blend !== "multiply" ? " selected" : ""}>Normal</option><option value="multiply"${L.blend === "multiply" ? " selected" : ""}>Multiply (sits into paper)</option></select>`)}
          ${field("Rounded corners", `<input type="range" min="0" max="400" step="2" value="${L.radius || 0}" data-prop="radius">`, Math.round(L.radius || 0))}`, "has-label")}
        <button type="button" class="ds-tbtn has-label" data-act="to-bg" title="Use this image as the page background"><span>Set as background</span></button>
        ${commonRight(L)}`;
    } else {
      const isLine = L.type === "line";
      return `
        ${popBtn("fill", colourDot(L.fill), isLine ? "Line colour" : "Colour", `<div class="ds-pophead">${isLine ? "Line colour" : "Colour"}</div>${swatches(L.fill, "fill")}`)}
        ${isLine
          ? popBtn("border", I(ICONS.border), "Thickness", field("Thickness", `<input type="range" min="1" max="24" step="0.5" value="${L.sw || 2}" data-prop="sw">`, L.sw || 2))
          : popBtn("border", I(ICONS.border), "Border", `${field("Border width", `<input type="range" min="0" max="24" step="0.5" value="${L.sw || 0}" data-prop="sw">`, L.sw || 0)}<div class="ds-pophead">Border colour</div>${swatches(L.stroke, "stroke")}`)}
        ${!isLine && L.type !== "ellipse" ? popBtn("corners", I(ICONS.corners), "Rounded corners", field("Rounded corners", `<input type="range" min="0" max="300" step="2" value="${L.radius || 0}" data-prop="radius">`, Math.round(L.radius || 0))) : ""}
        ${commonRight(L)}`;
    }
  }
  // Background controls (toolbar when nothing is selected, and the top of
  // the Backgrounds panel). A colour = a plain page; a wash tints the image.
  function bgControls({ inPanel = false } = {}) {
    const bg = page().bg || {};
    const hasImg = !!bg.image;
    if (inPanel) {
      return `
      <div class="ds-bgctl"><span class="ds-tb-label">${hasImg ? "Plain colour" : "Colour"}</span>${swatches(hasImg ? "" : bg.color, "bgc")}</div>
      ${hasImg ? `<div class="ds-bgctl"><span class="ds-tb-label">Wash over image</span>${swatches(bg.tintAlpha > 0 ? bg.tintColor : "", "tint", { none: true })}
        <label class="ds-tb-field">Strength<input type="range" min="0" max="0.85" step="0.01" value="${bg.tintAlpha || 0}" data-bgprop="tintAlpha"></label></div>
      <div class="ds-bgctl"><label class="ds-tb-field">Position<select data-act="bg-fit"><option value="cover"${bg.fit !== "bottom" ? " selected" : ""}>Fill the page</option><option value="bottom"${bg.fit === "bottom" ? " selected" : ""}>Fit width, at the bottom</option></select></label>
        <button type="button" class="ds-ghost" data-act="bg-clear">Remove image</button></div>` : ""}`;
    }
    return `
      <span class="ds-tb-label">Page ${pageIdx + 1}</span><span class="ds-tb-sep"></span>
      ${popBtn("bgc", `${colourDot(hasImg ? "" : bg.color || PAPER)}<span>Background</span>`, "Background colour", `<div class="ds-pophead">${hasImg ? "Swap the image for a plain colour" : "Background colour"}</div>${swatches(hasImg ? "" : bg.color, "bgc")}`, "has-label")}
      ${hasImg ? `
      ${popBtn("wash", `${I(ICONS.wash)}<span>Wash</span>`, "Wash over the image", `<div class="ds-pophead">Wash over the image</div>${swatches(bg.tintAlpha > 0 ? bg.tintColor : "", "tint", { none: true })}${field("Strength", `<input type="range" min="0" max="0.85" step="0.01" value="${bg.tintAlpha || 0}" data-bgprop="tintAlpha">`, `${Math.round((bg.tintAlpha || 0) * 100)}%`)}`, "has-label")}
      <select class="ds-tbselect" data-act="bg-fit" aria-label="Image position" title="Image position"><option value="cover"${bg.fit !== "bottom" ? " selected" : ""}>Fill the page</option><option value="bottom"${bg.fit === "bottom" ? " selected" : ""}>Fit width, at the bottom</option></select>
      <button type="button" class="ds-tbtn has-label ds-erase-btn" data-act="bg-erase" title="Paint away parts of the background"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 21-4-4 10-10 8 8-6 6H7z"/><path d="M8 12l6 6"/><path d="M14 21h7"/></svg><span>Erase parts</span></button>
      <button type="button" class="ds-tbtn has-label" data-act="bg-clear" title="Remove the background image"><span>Remove image</span></button>` : ""}
      <span class="ds-tb-hint">Click anything to edit it · double-click text to type · right-click for more</span>`;
  }
  // Apply a colour from any swatch row. kind: color | fill | bgc | tint
  function applyColour(kind, c, { live = false } = {}) {
    const L = sel && layer(sel);
    const bg = page().bg || (page().bg = {});
    if (kind === "color" && L) L.color = c;
    else if (kind === "fill" && L) L.fill = c;
    else if (kind === "stroke" && L) { L.stroke = c; if (!(L.sw > 0)) L.sw = 3; }
    else if (kind === "bgc") {
      // A full-bleed image would hide the colour, so a colour means a plain page.
      if (bg.image && bg.fit !== "bottom") bg.image = null;
      bg.color = c;
    } else if (kind === "tint") {
      if (c === "none") bg.tintAlpha = 0;
      else { bg.tintColor = c; if (!(bg.tintAlpha > 0)) bg.tintAlpha = 0.35; }
    } else return;
    draw();
    if (live) commitSoon();
    else { commit(); paintToolbar(); syncPanelBg(); }
  }
  function syncPanelBg() {
    const box = container.querySelector("#ds-panel-bgctl");
    if (box) box.innerHTML = bgControls({ inPanel: true });
    container.querySelectorAll("[data-bg]").forEach((t) => t.classList.toggle("is-on", bgByImage.get(baseUrl(page().bg?.image))?.id === t.dataset.bg));
  }
  function onColourInput(e) {
    const t = e.target;
    for (const kind of ["color", "fill", "stroke", "bgc", "tint"]) {
      if (t.matches(`[data-${kind}-custom]`)) { applyColour(kind, t.value, { live: true }); const hx = t.closest(".ds-swatches")?.querySelector(".ds-hex"); if (hx) hx.value = t.value; return true; }
      if (t.matches(`[data-${kind}-hex]`)) {
        let v = t.value.trim(); if (v && v[0] !== "#") v = "#" + v;
        if (/^#[0-9a-f]{6}$/i.test(v)) applyColour(kind, v.toLowerCase(), { live: true });
        return true;
      }
    }
    if (t.dataset.bgprop) { page().bg[t.dataset.bgprop] = Number(t.value); if (t.dataset.bgprop === "tintAlpha" && !page().bg.tintColor) page().bg.tintColor = "#0f172a"; draw(); commitSoon(); return true; }
    return false;
  }
  function onColourClick(b) {
    for (const kind of ["color", "fill", "stroke", "bgc", "tint"]) {
      if (b.dataset[kind] != null && b.classList.contains("ds-sw")) { applyColour(kind, b.dataset[kind]); return true; }
    }
    if (b.dataset.act === "bg-clear") { page().bg.image = null; commit(); draw(); paintToolbar(); syncPanelBg(); return true; }
    return false;
  }
  function onBgFit(t) {
    if (t.dataset.act !== "bg-fit") return false;
    page().bg.fit = t.value; draw(); commit(); paintToolbar(); syncPanelBg(); return true;
  }

  document.addEventListener("pointerdown", (e) => {
    if (openPop && !e.target.closest(".ds-popwrap")) { openPop = null; paintToolbar(); }
  }, true);
  $("#ds-toolbar").addEventListener("input", (e) => {
    if (e.target.dataset.er && eraser) {
      eraser[e.target.dataset.er] = Number(e.target.value);
      const out = e.target.parentElement.querySelector("output"); if (out) out.textContent = Math.round(eraser.size);
      try { localStorage.setItem("catalyst.studio.brush", JSON.stringify({ size: eraser.size, soft: eraser.soft })); } catch {}
      return moveBrush(lastBrushPt);
    }
    if (onColourInput(e)) return;
    const t = e.target;
    const L = sel && layer(sel);
    if (t.dataset.prop && L) {
      const v = t.type === "range" || t.type === "number" ? Number(t.value) : t.value;
      const out = t.closest(".ds-popfield")?.querySelector("output");
      if (out) out.textContent = t.dataset.prop === "opacity" ? `${Math.round(v * 100)}%` : t.dataset.prop === "lh" ? Number(v).toFixed(2) : t.dataset.prop === "ls" ? Math.round(v * 1000) : Math.round(v * 10) / 10;
      L[t.dataset.prop] = t.dataset.prop === "weight" ? Number(v) : v;
      if (t.dataset.prop === "sw" && L.type !== "line" && !L.stroke) L.stroke = "#0f172a";
      draw(); commitSoon();
    }
  });
  $("#ds-toolbar").addEventListener("change", (e) => {
    const t = e.target;
    if (onBgFit(t)) return;
    if (t.matches("input[type=color], .ds-hex")) { paintToolbar(); syncPanelBg(); return; }   // picker closed / hex entered: refresh the "is-on" rings
    if (t.tagName === "SELECT" && sel) paintToolbar();
  });
  $("#ds-toolbar").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.pop) { openPop = openPop === b.dataset.pop ? null : b.dataset.pop; paintToolbar(); return; }
    {
      const L0 = sel && layer(sel);
      if (L0 && (b.dataset.act === "size-inc" || b.dataset.act === "size-dec")) {
        const st = L0.size >= 100 ? 4 : L0.size >= 40 ? 2 : 1;
        L0.size = clamp(Math.round(L0.size) + (b.dataset.act === "size-inc" ? st : -st), 6, 400);
        draw(); commitSoon(); paintToolbar(); return;
      }
      if (L0 && b.dataset.act === "bold") { const F = fontOf(L0.font); L0.weight = (L0.weight || 400) >= 600 ? nearestWeight(F, 400) : nearestWeight(F, 700); commit(); draw(); paintToolbar(); return; }
      if (L0 && b.dataset.act === "align-cycle") { const o = ["left", "center", "right"]; L0.align = o[(o.indexOf(L0.align || "left") + 1) % 3]; commit(); draw(); paintToolbar(); return; }
      if (L0 && (b.dataset.act === "front" || b.dataset.act === "back")) { moveLayer(L0.id, b.dataset.act === "front" ? "top" : "bottom"); paintToolbar(); return; }
    }
    if (b.dataset.erMode) { eraser.mode = b.dataset.erMode; return paintToolbar(); }
    if (b.dataset.act === "erase") return startEraser("layer");
    if (b.dataset.act === "bg-erase") return startEraser("bg");
    if (b.dataset.act === "er-done") return stopEraser();
    if (b.dataset.act === "er-undo") { const T = eraserTarget(); if (T?.erase?.length) { T.erase.pop(); if (!T.erase.length) delete T.erase; commit(); draw(); paintToolbar(); } return; }
    if (b.dataset.act === "er-reset") { const T = eraserTarget(); if (T?.erase) { delete T.erase; commit(); draw(); paintToolbar(); } return; }
    if (b.dataset.act === "font-pick") return openFontPicker(b);
    if (b.dataset.act === "to-bg") {
      const L = sel && layer(sel); if (!L || L.type !== "image") return;
      page().bg = { ...(page().bg || {}), image: L.src, fit: "cover", focusY: 0.5, tone: "light" };
      if (L.erase) page().bg.erase = clone(L.erase); else delete page().bg.erase;
      page().layers = page().layers.filter((x) => x.id !== L.id);
      setSelection([]); commit(); draw(); paintToolbar(); paintPanelIfLayers(); return;
    }
    if (b.dataset.place) return alignSelection(b.dataset.place);
    if (b.dataset.act === "dist-h" || b.dataset.act === "dist-v") return distribute(b.dataset.act === "dist-h" ? "h" : "v");
    if (b.dataset.act === "group") return groupSelection();
    if (b.dataset.act === "ungroup") return ungroupSelection();
    if (multi.length && b.dataset.act === "del") return removeLayers(selIds());
    if (multi.length && b.dataset.act === "dup") return duplicateLayers(selIds());
    const L = sel && layer(sel);
    if (onColourClick(b)) return;
    if (b.dataset.toggle && L) { L[b.dataset.toggle] = !L[b.dataset.toggle]; }
    else if (b.dataset.align && L) { L.align = b.dataset.align; }
    else if (b.dataset.act === "del" && L) return removeLayer(L.id);
    else if (b.dataset.act === "dup" && L) return duplicateLayer(L.id);
    else if (b.dataset.act === "up" && L) return moveLayer(L.id, 1);
    else if (b.dataset.act === "down" && L) return moveLayer(L.id, -1);
    else if (b.dataset.act === "lock" && L) { L.locked = !L.locked; }
    else if (b.dataset.act === "edit" && L) return startEditing(L);
    else return;
    commit(); draw(); paintToolbar();
  });

  // ── left panel ──
  container.querySelector(".ds-rail").addEventListener("click", (e) => {
    const b = e.target.closest("[data-panel]");
    if (!b) return;
    const collapsed = $("#ds-body").classList.contains("is-collapsed");
    if (b.dataset.panel === panel && !collapsed) { setPanelOpen(false); return; }
    panel = b.dataset.panel;
    container.querySelectorAll(".ds-rail button").forEach((x) => x.classList.toggle("is-on", x === b));
    if (collapsed) setPanelOpen(true);
    paintPanel();
  });

  const thumbCache = new Map();
  async function templateThumb(t) {
    const key = `${t.id}|${design.format}`;
    if (thumbCache.has(key)) return thumbCache.get(key);
    const f = fmt();
    const s = 220 / f.w;
    const c = document.createElement("canvas");
    c.width = 220; c.height = Math.round(f.h * s);
    const x = c.getContext("2d");
    x.scale(s, s);
    const pg = pageFromTemplate(t.id, design.format);
    await renderPage(x, pg, f);
    const url = c.toDataURL("image/jpeg", 0.8);
    thumbCache.set(key, url);
    return url;
  }

  function paintPanelIfLayers() { if (panel === "layers") paintPanel(); }
  async function paintPanel() {
    const p = $("#ds-panel");
    if (panel === "templates") {
      const ORDER = ["Health", "Story", "Edition", "Data", "Quote", "Announcement", "People", "Engagement", "Carousel"];
      const cats = [...new Set(TEMPLATES.map((t) => t.cat))].sort((x, y) => (ORDER.indexOf(x) + 1 || 99) - (ORDER.indexOf(y) + 1 || 99));
      p.innerHTML = `<h3>Templates</h3><p class="ds-panel-hint">Click one to lay it out on this page. Everything stays editable.</p>` +
        cats.map((c) => `<h4>${esc(c)}</h4><div class="ds-tgrid">${TEMPLATES.filter((t) => t.cat === c).map((t) => `
          <button type="button" class="ds-ttile" data-tpl="${t.id}"><span class="ds-tthumb" data-thumb="${t.id}" style="aspect-ratio:${fmt().w}/${fmt().h}"></span><span>${esc(t.name)}</span></button>`).join("")}</div>`).join("");
      for (const t of TEMPLATES) {
        templateThumb(t).then((url) => { const s = p.querySelector(`[data-thumb="${t.id}"]`); if (s) s.style.backgroundImage = `url(${url})`; }).catch(() => {});
      }
    } else if (panel === "backgrounds") {
      const cats = [...new Set(lib.backgrounds.map((b) => b.cat))];
      p.innerHTML = `<h3>Background</h3>
        <div class="ds-panel-bgctl" id="ds-panel-bgctl">${bgControls({ inPanel: true })}</div>
        <h4>Illustrations</h4>
        <p class="ds-panel-hint">Watercolour scenes with room for text, washes and night skies.</p>
        <div class="ds-chips">${["All", ...cats].map((c, i) => `<button type="button" data-bgcat="${esc(c)}" class="${i === 0 ? "is-on" : ""}">${esc(c)}</button>`).join("")}</div>
        <div class="ds-bgrid" id="ds-bgrid"></div>`;
      const paintBg = (cat) => {
        p.querySelector("#ds-bgrid").innerHTML = lib.backgrounds.filter((b) => cat === "All" || b.cat === cat).map((b) => `
          <button type="button" class="ds-btile${(page().bg?.image || "-") === b.image ? " is-on" : ""}" data-bg="${esc(b.id)}" title="${esc(b.title)}"><img src="${esc(b.thumb || b.image)}" alt="${esc(b.title)}" loading="lazy"></button>`).join("");
      };
      paintBg("All");
      p.querySelector(".ds-chips").addEventListener("click", (e) => {
        const b = e.target.closest("[data-bgcat]"); if (!b) return;
        p.querySelectorAll(".ds-chips button").forEach((x) => x.classList.toggle("is-on", x === b));
        paintBg(b.dataset.bgcat);
      });
    } else if (panel === "elements") {
      const ecats = [...new Set(lib.elements.map((e) => e.cat || "Other"))];
      p.innerHTML = `<h3>Elements</h3>
        <input type="search" class="ds-search" id="ds-el-search" placeholder="Search ${lib.elements.length} illustrations…" aria-label="Search illustrations">
        <div class="ds-chips" id="ds-el-cats">${["All", ...ecats].map((c, i) => `<button type="button" data-elcat="${esc(c)}" class="${i === 0 ? "is-on" : ""}">${esc(c)}</button>`).join("")}</div>
        <div class="ds-egrid" id="ds-egrid"></div>
        <h4>Shapes</h4><div class="ds-shapes">
          <button type="button" data-shape="rect" title="Rectangle"><span style="border-radius:4px"></span></button>
          <button type="button" data-shape="round" title="Rounded card"><span style="border-radius:14px"></span></button>
          <button type="button" data-shape="pill" title="Pill"><span style="border-radius:99px;height:22px"></span></button>
          <button type="button" data-shape="ellipse" title="Circle"><span style="border-radius:50%"></span></button>
          <button type="button" data-shape="frame" title="Outline frame"><span style="background:none;border:2px solid currentColor;border-radius:6px"></span></button>
          <button type="button" data-shape="line" title="Line"><span style="height:3px"></span></button>
        </div>`;
      let ecat = "All";
      const paintEls = () => {
        const q = p.querySelector("#ds-el-search").value.trim().toLowerCase();
        const list = lib.elements.filter((e) => (ecat === "All" || (e.cat || "Other") === ecat) && (!q || `${e.title} ${e.cat} ${e.tags || ""}`.toLowerCase().includes(q)));
        p.querySelector("#ds-egrid").innerHTML = list.map((e) => `<button type="button" class="ds-etile" data-el="${esc(e.id)}" title="${esc(e.title)}"><img src="${esc(e.thumb || e.image)}" alt="${esc(e.title)}" loading="lazy"></button>`).join("") || `<p class="ds-panel-hint">Nothing matches.</p>`;
      };
      paintEls();
      p.querySelector("#ds-el-search").addEventListener("input", paintEls);
      p.querySelector("#ds-el-cats").addEventListener("click", (e) => {
        const b = e.target.closest("[data-elcat]"); if (!b) return;
        ecat = b.dataset.elcat;
        p.querySelectorAll("#ds-el-cats button").forEach((x) => x.classList.toggle("is-on", x === b));
        paintEls();
      });
    } else if (panel === "text") {
      p.innerHTML = `<h3>Text</h3><p class="ds-panel-hint">Wrap a word in *asterisks* to set it in the serif italic, like our headlines.</p>
        <div class="ds-textpresets">
          <button type="button" data-text="heading" class="tp-heading">Add a heading</button>
          <button type="button" data-text="sub" class="tp-sub">Add a subheading</button>
          <button type="button" data-text="body" class="tp-body">Add body text</button>
          <button type="button" data-text="kicker" class="tp-kicker">ADD A KICKER</button>
          <button type="button" data-text="quote" class="tp-quote">“Add a quote”</button>
          <button type="button" data-text="brand" class="tp-kicker">THE CATALYST</button>
          <button type="button" data-text="url" class="tp-body">catalyst-magazine.com</button>
          <button type="button" data-text="cta" class="tp-body">Link in bio →</button>
        </div>
        <h4>Headings in our recommended fonts</h4>
        <p class="ds-panel-hint">Pick any text, then the font name in the toolbar to see all ${Object.keys(FONTS).length} fonts.</p>
        <div class="ds-textpresets">
          ${Object.keys(FONTS).filter((k) => FONTS[k].rec).map((k) => `<button type="button" data-text-font="${k}" class="tp-font" style="font-family:${esc(FONTS[k].css)};font-weight:${k === "sans" ? 700 : 400}">${esc(FONTS[k].label)}</button>`).join("")}
        </div>`;
      Object.keys(FONTS).filter((k) => FONTS[k].rec).forEach((k) => ensureFace(k, nearestWeight(FONTS[k], k === "sans" ? 700 : 400), false));
    } else if (panel === "photos") {
      const ups = myUploads();
      p.innerHTML = `<h3>Photos</h3>
        <label class="ds-upload" id="ds-dropzone"><input type="file" accept="image/*" id="ds-file" multiple hidden><span>Upload your images</span><small>Click to choose, drop files here or onto the page, or paste (⌘V). PNG cut-outs keep their transparency.</small></label>
        <h4>Your uploads</h4>
        <div class="ds-bgrid ds-uploads" id="ds-uploads">${ups.length ? ups.map((u) => `
          <div class="ds-utile">
            <button type="button" class="ds-btile is-photo" data-upload="${esc(u.url)}" title="Add to the page"><img src="${esc(proxied(u.url))}" alt="" loading="lazy"></button>
            <button type="button" class="ds-ubg" data-upload-bg="${esc(u.url)}" title="Use as the page background">Background</button>
          </div>`).join("") : `<p class="ds-panel-hint">Images you upload show up here so you can use them again.</p>`}</div>
        <h4>Article covers</h4><div class="ds-bgrid" id="ds-covers"><p class="ds-panel-hint">Loading…</p></div>`;
      p.querySelector("#ds-file").addEventListener("change", onUpload);
      const dz = p.querySelector("#ds-dropzone");
      dz.addEventListener("dragover", (e) => { if (hasFiles(e)) { e.preventDefault(); dz.classList.add("is-over"); } });
      dz.addEventListener("dragleave", () => dz.classList.remove("is-over"));
      dz.addEventListener("drop", (e) => { e.preventDefault(); dz.classList.remove("is-over"); uploadFiles([...e.dataTransfer.files]); });
      loadCovers().then((covers) => {
        const g = p.querySelector("#ds-covers");
        if (!g) return;
        g.innerHTML = covers.map((c) => `<button type="button" class="ds-btile is-photo" data-photo="${esc(c.src)}" title="${esc(c.title)}"><img src="${esc(proxied(c.src))}" alt="" loading="lazy"></button>`).join("") || `<p class="ds-panel-hint">No covers found.</p>`;
        // A cover that no longer exists shouldn't leave an empty tile.
        g.querySelectorAll("img").forEach((img) => img.addEventListener("error", () => img.closest("button")?.remove(), { once: true }));
      });
    } else if (panel === "caption") {
      const plat = currentPlatform();
      const LIMIT = { instagram: 2200, linkedin: 3000, twitter: 280, facebook: 63206 };
      p.innerHTML = `<h3>Caption</h3><p class="ds-panel-hint">Saved with the post on the board. Copy it from there when you post.</p>
        <label class="ds-flabel" for="ds-platform">Posting to</label>
        <select id="ds-platform" class="ds-fselect">${Object.entries(PLATFORM_LABEL).map(([k, v]) => `<option value="${k}"${k === plat ? " selected" : ""}>${v}</option>`).join("")}</select>
        <label class="ds-flabel" for="ds-cap">Caption</label>
        <textarea id="ds-cap" class="ds-cap" rows="12" placeholder="Write the caption…">${esc(caption)}</textarea>
        <div class="ds-capfoot"><span id="ds-capcount"></span><button type="button" class="ds-ghost" id="ds-tags">Add our hashtags</button></div>`;
      const ta = p.querySelector("#ds-cap"), cnt = p.querySelector("#ds-capcount");
      const count = () => { const lim = LIMIT[currentPlatform()] || 2200; cnt.textContent = `${caption.length.toLocaleString()} / ${lim.toLocaleString()}`; cnt.classList.toggle("is-over", caption.length > lim); };
      count();
      ta.addEventListener("input", () => { caption = ta.value; count(); markDirty(); });
      ta.addEventListener("keydown", (e) => e.stopPropagation());
      p.querySelector("#ds-platform").addEventListener("change", (e) => { postPlatform = e.target.value; count(); markDirty(); });
      p.querySelector("#ds-tags").addEventListener("click", () => {
        const tags = "#ScienceInDC #STEM #StudentJournalism #TheCatalyst";
        if (!caption.includes("#TheCatalyst")) { caption = (caption.trim() ? caption.trim() + "\n\n" : "") + tags; ta.value = caption; count(); markDirty(); }
      });
    } else if (panel === "layers") {
      const ls = [...page().layers].reverse();
      p.innerHTML = `<h3>Layers</h3><p class="ds-panel-hint">Top of the list is in front.</p>
        <ul class="ds-layers">${ls.map((L) => `
          <li class="${selIds().includes(L.id) ? "is-on" : ""}" data-layer="${L.id}">
            <span class="ds-ltype">${{ text: "T", image: "Img", rect: "Box", ellipse: "Circ", line: "Line" }[L.type] || ""}</span>
            <span class="ds-lname">${esc(L.name || (L.type === "text" ? String(L.text).replace(/\*/g, "").slice(0, 32) : L.type))}${L.group ? ` <span class="ds-lgroup" title="In a group">grouped</span>` : ""}</span>
            <button type="button" data-lact="hide" title="${L.hidden ? "Show" : "Hide"}">${L.hidden ? "Show" : "Hide"}</button>
            <button type="button" data-lact="up" title="Forward">↑</button>
            <button type="button" data-lact="down" title="Backward">↓</button>
          </li>`).join("") || `<li class="ds-panel-hint">Nothing on this page yet.</li>`}</ul>`;
    }
  }

  $("#ds-panel").addEventListener("input", (e) => { onColourInput(e); });
  $("#ds-panel").addEventListener("change", (e) => {
    if (onBgFit(e.target)) return;
    if (e.target.matches("#ds-panel-bgctl input[type=color], #ds-panel-bgctl .ds-hex")) { paintToolbar(); syncPanelBg(); }
  });
  $("#ds-panel").addEventListener("click", (e) => {
    const t = e.target.closest("button, li[data-layer]");
    if (!t) return;
    if (t.closest("#ds-panel-bgctl")) { onColourClick(t); return; }
    const f = fmt();
    if (t.dataset.tpl) {
      const cur = page();
      const keepText = {};
      design.pages[pageIdx] = { ...pageFromTemplate(t.dataset.tpl, design.format, keepText), id: cur.id };
      setSelection([]); commit(); draw(); paintToolbar();
    } else if (t.dataset.bg) {
      const b = bgById[t.dataset.bg];
      page().bg = bgFrom(b, design.format, { focusY: page().bg?.focusY ?? 0.5 });
      commit(); draw(); paintToolbar(); syncPanelBg();
    } else if (t.dataset.el) {
      const e2 = lib.elements.find((x) => x.id === t.dataset.el);
      const k = 440 / Math.max(e2.w || 1, e2.h || 1);
      addLayer({ type: "image", src: e2.image, w: Math.round((e2.w || 440) * k), h: Math.round((e2.h || 440) * k), fit: "contain", blend: "normal", name: e2.title });
    } else if (t.dataset.textFont) {
      const k = t.dataset.textFont, F = FONTS[k];
      const L = txt({ name: "Heading", text: "Your headline here", font: k, weight: nearestWeight(F, k === "sans" ? 700 : 400), size: k === "sans" ? 84 : 92, ls: k === "sans" ? -0.035 : -0.01, lh: 1.04, w: f.w - 176 });
      ensureFontsFor([L]).then(() => addLayer(L));
    } else if (t.dataset.upload) {
      placeImage(t.dataset.upload);
    } else if (t.dataset.uploadBg) {
      useAsBackground(t.dataset.uploadBg);
    } else if (t.dataset.photo) {
      addLayer({ type: "image", src: t.dataset.photo, w: Math.round(f.w * 0.7), h: Math.round(f.w * 0.7 * 0.66), fit: "cover", radius: 18, name: "Photo" });
    } else if (t.dataset.shape) {
      const s = t.dataset.shape;
      const base = { name: s };
      if (s === "rect") addLayer({ ...base, type: "rect", w: 520, h: 320, fill: "#0f172a" });
      else if (s === "round") addLayer({ ...base, type: "rect", w: f.w - 176, h: 380, radius: 28, fill: "#fdfcf9", opacity: 0.94 });
      else if (s === "pill") addLayer({ ...base, type: "rect", w: 300, h: 60, radius: 30, fill: "#0f172a" });
      else if (s === "ellipse") addLayer({ ...base, type: "ellipse", w: 360, h: 360, fill: "#c9962e" });
      else if (s === "frame") addLayer({ ...base, type: "rect", x: 40, y: 40, w: f.w - 80, h: f.h - 80, radius: 12, fill: "", stroke: "#0f172a", sw: 2 });
      else if (s === "line") addLayer({ ...base, type: "line", w: 300, h: 14, sw: 2, fill: "#0f172a" });
    } else if (t.dataset.text) {
      const k = t.dataset.text;
      const W = f.w;
      const presets = {
        heading: { text: "Your *headline* here", size: 84, weight: 700, ls: -0.035, lh: 1.04, w: W - 176 },
        sub: { text: "A line that explains the story.", size: 40, font: "serif", color: "#334155", lh: 1.35, w: W - 176 },
        body: { text: "Body text for a carousel page. Keep it short and conversational.", size: 34, font: "serif", lh: 1.5, color: "#334155", w: W - 176 },
        kicker: { text: "New feature", size: 23, weight: 600, ls: 0.16, upper: true, color: "#5b6678", markup: false, w: 600 },
        quote: { text: "“A line from the story that *stops you.*”", size: 56, font: "serif", lh: 1.25, w: W - 176 },
        brand: { text: "THE CATALYST", size: 22, weight: 600, ls: 0.18, color: "#5b6678", markup: false, w: 420 },
        url: { text: "catalyst-magazine.com", size: 24, weight: 500, color: "#5b6678", markup: false, w: 420 },
        cta: { text: "Link in bio →", size: 30, weight: 600, markup: false, w: 400 },
      };
      addLayer(txt({ name: k, ...presets[k] }));
    } else if (t.closest("li[data-layer]")) {
      const li = t.closest("li[data-layer]");
      const L = layer(li.dataset.layer);
      if (!L) return;
      const act = e.target.closest("[data-lact]")?.dataset.lact;
      if (act === "hide") { L.hidden = !L.hidden; commit(); draw(); paintPanel(); return; }
      if (act === "up") return moveLayer(L.id, 1);
      if (act === "down") return moveLayer(L.id, -1);
      // The list picks single layers (even inside a group); shift/⌘ adds.
      if (e.shiftKey || e.metaKey || e.ctrlKey) { const cur = selIds(); setSelection(cur.includes(L.id) ? cur.filter((id) => id !== L.id) : [...cur, L.id]); }
      else setSelection([L.id]);
      paintSelection(); paintToolbar(); paintPanel();
    }
  });

  // ── photos ──
  let _covers = null;
  async function loadCovers() {
    if (_covers) return _covers;
    try {
      const res = await fetch("https://firestore.googleapis.com/v1/projects/catalystwriters-5ce43/databases/(default)/documents:runQuery", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ structuredQuery: { from: [{ collectionId: "stories" }], where: { fieldFilter: { field: { fieldPath: "status" }, op: "EQUAL", value: { stringValue: "published" } } }, select: { fields: [{ fieldPath: "title" }, { fieldPath: "coverImage" }, { fieldPath: "publishedAt" }, { fieldPath: "category" }] }, limit: 80 } }),
      });
      const rows = await res.json();
      _covers = rows.filter((r) => r.document).map((r) => r.document.fields)
        .filter((f) => f.coverImage?.stringValue && !/book/i.test(f.category?.stringValue || ""))
        .sort((a, b) => String(b.publishedAt?.stringValue || "").localeCompare(String(a.publishedAt?.stringValue || "")))
        .slice(0, 40)
        .map((f) => ({ title: f.title?.stringValue || "", src: f.coverImage.stringValue }));
    } catch { _covers = []; }
    return _covers;
  }
  // ── your own images ──
  const UPLOADS = `catalyst.studio.uploads.${ctx.user?.uid || "anon"}`;
  function myUploads() { try { return JSON.parse(localStorage.getItem(UPLOADS) || "[]"); } catch { return []; } }
  function rememberUpload(u) {
    const list = [u, ...myUploads().filter((x) => x.url !== u.url)].slice(0, 48);
    try { localStorage.setItem(UPLOADS, JSON.stringify(list)); } catch {}
  }
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes("Files");
  // Place an image at its own proportions, as large as fits comfortably.
  async function placeImage(url, at = null, nth = 0) {
    const f = fmt();
    let iw = 4, ih = 3;
    try { const img = await loadImg(url); iw = img.naturalWidth; ih = img.naturalHeight; } catch {}
    const k = Math.min((f.w * 0.72) / iw, (f.h * 0.6) / ih);
    const w = Math.max(40, Math.round(iw * k)), h = Math.max(40, Math.round(ih * k));
    const x = at ? Math.round(at.x - w / 2) : Math.round((f.w - w) / 2) + nth * 28;
    const y = at ? Math.round(at.y - h / 2) : Math.round((f.h - h) / 2) + nth * 28;
    addLayer({ type: "image", src: url, x, y, w, h, fit: "contain", radius: 0, name: "Your image" });
  }
  function useAsBackground(url) {
    page().bg = { ...(page().bg || {}), image: url, fit: "cover", focusY: 0.5, tone: "light" };
    delete page().bg.erase;
    commit(); draw(); paintToolbar(); syncPanelBg();
  }
  async function uploadFiles(files, at = null) {
    files = files.filter((f) => /^image\//.test(f.type));
    if (!files.length) { ctx.toast?.("That isn't an image file.", "error"); return; }
    const label = container.querySelector("#ds-dropzone span");
    const { uploadToFirebase } = await import("./writer.js?v=topics-alt");
    let i = 0;
    for (const file of files) {
      const n = files.length > 1 ? ` ${i + 1} of ${files.length}` : "";
      if (label) label.textContent = `Uploading${n}…`;
      try {
        const url = await uploadToFirebase(file, "image", ctx, (pct) => { if (label) label.textContent = `Uploading${n}… ${pct}%`; });
        rememberUpload({ url, name: file.name, at: Date.now() });
        await placeImage(url, at && files.length === 1 ? at : null, i);
      } catch (err) {
        ctx.toast?.(`Could not upload ${file.name}: ${err.message || err}`, "error");
      }
      i++;
    }
    if (panel === "photos") paintPanel();
  }
  async function onUpload(e) {
    const files = [...(e.target.files || [])];
    e.target.value = "";
    if (files.length) await uploadFiles(files);
  }
  // Drop files straight onto the page.
  stage.addEventListener("dragover", (e) => { if (hasFiles(e)) { e.preventDefault(); stage.classList.add("is-dropping"); } });
  stage.addEventListener("dragleave", (e) => { if (!stage.contains(e.relatedTarget)) stage.classList.remove("is-dropping"); });
  stage.addEventListener("drop", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault(); stage.classList.remove("is-dropping");
    const r = artboard.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    uploadFiles([...e.dataTransfer.files], inside ? pt(e) : null);
  });
  // Paste an image (screenshot, copied picture) with ⌘V.
  const onPaste = (e) => {
    if (!container.isConnected || !container.getClientRects().length) return;
    if (/INPUT|TEXTAREA/.test(document.activeElement?.tagName || "")) return;
    const files = [...(e.clipboardData?.files || [])].filter((f) => /^image\//.test(f.type));
    clearTimeout(pendingPaste);
    if (!files.length) { if (clip) { e.preventDefault(); pasteLayers(); } return; }
    e.preventDefault();
    uploadFiles(files);
  };
  document.addEventListener("paste", onPaste);

  // ── pages strip ──
  const pageThumbs = new Map();
  function paintPages() {
    const strip = $("#ds-pages");
    strip.innerHTML = design.pages.map((pg, i) => `
      <div class="ds-ptile${i === pageIdx ? " is-on" : ""}" data-page="${i}">
        <button type="button" class="ds-pthumb" data-goto="${i}" style="aspect-ratio:${fmt().w}/${fmt().h}" aria-label="Page ${i + 1}"><img alt="" data-pimg="${i}"></button>
        <span>${i + 1}</span>
        ${design.pages.length > 1 ? `<button type="button" class="ds-pdel" data-pdel="${i}" aria-label="Delete page ${i + 1}" title="Delete page">×</button>` : ""}
      </div>`).join("") + `
      <button type="button" class="ds-padd" data-padd="dup" title="Duplicate this page">+ Duplicate page</button>
      <button type="button" class="ds-padd" data-padd="blank" title="Add a blank page">+ Blank page</button>`;
    design.pages.forEach((_, i) => paintPagesThumb(i));
  }
  async function paintPagesThumb(i) {
    const img = container.querySelector(`[data-pimg="${i}"]`);
    if (!img) return;
    const f = fmt(), s = 96 / f.w;
    const c = document.createElement("canvas");
    c.width = 96; c.height = Math.round(f.h * s);
    const x = c.getContext("2d"); x.scale(s, s);
    await renderPage(x, design.pages[i], f);
    img.src = c.toDataURL("image/jpeg", 0.7);
  }
  $("#ds-pages").addEventListener("click", (e) => {
    const t = e.target.closest("button");
    if (!t) return;
    if (t.dataset.goto) { pageIdx = Number(t.dataset.goto); setSelection([]); refreshAll(); }
    else if (t.dataset.pdel) {
      design.pages.splice(Number(t.dataset.pdel), 1);
      pageIdx = Math.min(pageIdx, design.pages.length - 1); setSelection([]); commit(); refreshAll();
    } else if (t.dataset.padd) {
      const np = t.dataset.padd === "dup" ? { ...clone(page()), id: uid() } : blankPage();
      if (t.dataset.padd === "dup") np.layers.forEach((l) => { l.id = uid(); });
      design.pages.splice(pageIdx + 1, 0, np);
      pageIdx++; setSelection([]); commit(); refreshAll();
    }
  });

  // ── top bar ──
  $("#ds-format").value = design.format;
  $("#ds-format").addEventListener("change", (e) => {
    const from = fmt(), to = FORMATS[e.target.value];
    // Re-flow: things in the top part stay put, things in the bottom part
    // keep their distance from the bottom edge, the middle scales.
    design.pages.forEach((pg) => {
      pg.layers.forEach((L) => {
        const mid = L.y + (L.h || 0) / 2;
        if (L.y <= from.h * 0.45) return;
        if (mid >= from.h * 0.6) L.y = Math.round(L.y + (to.h - from.h));
        else L.y = Math.round(L.y * (to.h / from.h));
      });
      if (pg.bg?.image) {
        const b = bgByImage.get(baseUrl(pg.bg.image));
        if (b && !hasErase(pg.bg)) { const nb = bgFrom(b, e.target.value); pg.bg.image = nb.image; pg.bg.inkTop = nb.inkTop; }
        pg.bg.fit = fitFor(e.target.value, pg.bg);
      }
    });
    design.format = e.target.value;
    thumbCache.clear();
    commit(); refreshAll(); fit();
  });
  $("#ds-undo").addEventListener("click", doUndo);
  $("#ds-redo").addEventListener("click", doRedo);
  function paintHistory() {
    $("#ds-undo").disabled = undo.length < 2;
    $("#ds-redo").disabled = !redo.length;
  }

  // ── saving ──
  // A design on the board autosaves a moment after each change (the layout,
  // name and caption: cheap). "Save" (⌘S) also refreshes the board images.
  // A new design lives on this device until it's saved once.
  let dirty = false, saving = null, autosaveTimer = 0, saveAgain = false, lastError = "";
  const statusEl = $("#ds-status");
  function setStatus() {
    let t, cls;
    if (saving) { t = "Saving…"; cls = "is-saving"; }
    else if (lastError) { t = "Couldn't save · retry"; cls = "is-error"; }
    else if (!postId) { t = dirty ? "Not on the board yet" : "New design"; cls = "is-local"; }
    else if (dirty) { t = "Unsaved changes"; cls = "is-dirty"; }
    else { t = "All changes saved"; cls = "is-saved"; }
    statusEl.textContent = t;
    statusEl.className = `ds-status ${cls}`;
    statusEl.title = lastError || (postId ? "Saved to the Social media board" : "Kept in this browser. Click Save to put it on the board.");
    $("#ds-save").textContent = postId ? "Save" : "Save draft";
  }
  statusEl.addEventListener("click", () => { if (lastError) doSave({ auto: false }); });
  function markDirty() {
    dirty = true; lastError = "";
    setStatus();
    if (postId) { clearTimeout(autosaveTimer); autosaveTimer = setTimeout(() => doSave({ auto: true }), 1800); }
  }
  const autoTitle = () => {
    const head = design.pages[0]?.layers.find((l) => l.type === "text" && /headline|title|question|name|quote|number|heading/i.test(l.name || ""));
    return String(head?.text || "Studio design").replace(/\*/g, "").replace(/\s+/g, " ").trim().slice(0, 90);
  };
  const currentPlatform = () => postPlatform || FORMAT_PLATFORM[design.format] || "instagram";
  async function doSave({ auto = false } = {}) {
    if (typeof savePost !== "function") return;
    if (saving) { saveAgain = true; return saving; }
    clearTimeout(autosaveTimer);
    const creating = !postId;
    if (auto && creating) return;
    const title = designTitle && designTitle !== "Untitled design" ? designTitle : `${PLATFORM_LABEL[currentPlatform()] || "Instagram"}: ${autoTitle()}`;
    const fields = { id: postId, title, platform: currentPlatform(), content: caption, designJson: JSON.stringify(design), updatedAt: new Date().toISOString() };
    if (creating) fields.notes = `Made in the Studio (${FORMATS[design.format].label}${design.pages.length > 1 ? `, ${design.pages.length} pages` : ""}). Download it from the board, or open it in the Studio to edit.`;
    const wasDirty = dirty;
    dirty = false;
    saving = (async () => {
      setStatus();
      try {
        const saved = await savePost(fields);
        if (saved && saved.id) postId = saved.id;
        postTitle = title;
        if (creating && designTitle === "Untitled design") { designTitle = title; $("#ds-title").value = title; }
        lastError = "";
        if (!auto) { onSaved?.(); uploadImagesSoon(); ctx.toast?.(creating ? "Saved to the board as a draft." : "Saved.", "success"); }
      } catch (err) {
        dirty = dirty || wasDirty;
        lastError = err.message || String(err);
        if (!auto) ctx.toast?.("Could not save: " + lastError, "error");
      }
    })();
    await saving;
    saving = null;
    setStatus();
    if (saveAgain || (dirty && postId)) { saveAgain = false; if (dirty) markDirty(); }
  }
  // Board images (for the post's downloads and other pages that show it)
  // go up in the background after an explicit save.
  let uploadingImages = false;
  async function uploadImagesSoon() {
    if (uploadingImages || !postId) return;
    uploadingImages = true;
    const id = postId;
    try {
      const { uploadToFirebase } = await import("./writer.js?v=topics-alt");
      const imageUrls = [];
      for (let i = 0; i < design.pages.length; i++) imageUrls.push(await uploadToFirebase(new File([await exportPage(i)], `post-${i + 1}.png`, { type: "image/png" }), "image", ctx));
      await savePost({ id, coverImageUrl: imageUrls[0] || "", imageUrls });
      onSaved?.();
    } catch (err) { console.warn("[studio] page images not uploaded", err); }
    finally { uploadingImages = false; }
  }
  $("#ds-save").addEventListener("click", () => doSave({ auto: false }));
  const onBeforeUnload = (e) => {
    if (!container.isConnected || !container.getClientRects().length) return;
    if (saving || (dirty && postId)) { e.preventDefault(); e.returnValue = ""; }
  };
  window.addEventListener("beforeunload", onBeforeUnload);

  // ── name ──
  $("#ds-title").addEventListener("input", (e) => { designTitle = e.target.value.trim() || "Untitled design"; markDirty(); });
  $("#ds-title").addEventListener("keydown", (e) => { if (e.key === "Enter") e.target.blur(); e.stopPropagation(); });
  $("#ds-title").addEventListener("focus", (e) => e.target.select());

  // ── back to the board ──
  $("#ds-back").addEventListener("click", async () => {
    if (postId && (dirty || saving)) await doSave({ auto: true });
    if (!postId && dirty && design.pages.some((pg) => pg.layers.length)) {
      const choice = await askDialog("Save this design to the board?", "It's kept in this browser either way, but only saved designs show up on the board for the team.", [["keep", "Keep editing"], ["leave", "Don't save"], ["save", "Save draft", true]]);
      if (choice === "keep" || !choice) return;
      if (choice === "save") { await doSave({ auto: false }); if (!postId) return; }
    }
    onClose?.();
  });
  // A small in-Studio dialog: resolves with the chosen key (or null).
  function askDialog(title, text, buttons) {
    return new Promise((resolve) => {
      const wrap = el("div", { class: "ds-dialog-back" });
      wrap.innerHTML = `<div class="ds-dialog" role="dialog" aria-modal="true" aria-labelledby="ds-dlg-t"><h3 id="ds-dlg-t">${esc(title)}</h3>${text ? `<p>${esc(text)}</p>` : ""}<div class="ds-dialog-actions">${buttons.map(([k, label, primary]) => `<button type="button" class="${primary ? "ds-savebtn" : "ds-ghost"}" data-k="${k}">${esc(label)}</button>`).join("")}</div></div>`;
      const done = (k) => { wrap.remove(); document.removeEventListener("keydown", onEsc, true); resolve(k); };
      const onEsc = (e) => { if (e.key === "Escape") { e.stopPropagation(); done(null); } };
      wrap.addEventListener("click", (e) => { const b = e.target.closest("[data-k]"); if (b) done(b.dataset.k); else if (e.target === wrap) done(null); });
      document.addEventListener("keydown", onEsc, true);
      container.querySelector(".ds").appendChild(wrap);
      wrap.querySelector(".ds-savebtn, button")?.focus();
    });
  }

  // ── new design: pick a size ──
  function newDesign() {
    return new Promise((resolve) => {
      const wrap = el("div", { class: "ds-dialog-back" });
      const card = (k) => { const f = FORMATS[k]; const r = f.w / f.h; const w = r >= 1 ? 92 : Math.round(92 * r), h = r >= 1 ? Math.round(92 / r) : 92;
        return `<button type="button" class="ds-fmtcard" data-fmt="${k}"><span class="ds-fmtshape" style="width:${w}px;height:${h}px"></span><b>${f.label.split(" ")[0] === "X" ? "X / wide" : f.label.replace(/ \d.*$/, "")}</b><small>${f.label.match(/[\d.]+:[\d.]+/)?.[0] || ""} · ${f.w}×${f.h}</small></button>`; };
      wrap.innerHTML = `<div class="ds-dialog ds-newdlg" role="dialog" aria-modal="true" aria-labelledby="ds-new-t">
        <h3 id="ds-new-t">Create a design</h3><p>Choose a size. You can change it later from the top bar.</p>
        <div class="ds-fmtgrid">${["square", "story", "post", "linkedin", "wide"].map(card).join("")}</div>
        <div class="ds-dialog-actions"><button type="button" class="ds-ghost" data-k="cancel">Cancel</button></div></div>`;
      const done = (k) => { wrap.remove(); document.removeEventListener("keydown", onEsc, true); resolve(k); };
      const onEsc = (e) => { if (e.key === "Escape") { e.stopPropagation(); done(null); } };
      wrap.addEventListener("click", (e) => {
        const b = e.target.closest("[data-fmt]");
        if (b) {
          design = { format: b.dataset.fmt, pages: [blankPage()] };
          pageIdx = 0; setSelection([]); postId = null; postPlatform = FORMAT_PLATFORM[b.dataset.fmt] || null; postTitle = null;
          caption = ""; designTitle = "Untitled design"; $("#ds-title").value = designTitle;
          zoom = 1; undo.length = 0; redo.length = 0;
          panel = "templates"; container.querySelectorAll(".ds-rail button").forEach((x) => x.classList.toggle("is-on", x.dataset.panel === "templates"));
          setPanelOpen(true);
          commit(); dirty = false; setStatus(); refreshAll();
          return done(b.dataset.fmt);
        }
        if (e.target.closest("[data-k]") || e.target === wrap) done(null);
      });
      document.addEventListener("keydown", onEsc, true);
      container.querySelector(".ds").appendChild(wrap);
      wrap.querySelector("[data-fmt]")?.focus();
    });
  }
  $("#ds-new").addEventListener("click", () => newDesign());

  // ── download ──
  async function exportPage(i) {
    const c = await renderDesignPage(design, i, 1);
    return new Promise((r) => c.toBlob(r, "image/png"));
  }
  const fileBase = () => `catalyst-${String((designTitle !== "Untitled design" && designTitle) || autoTitle() || "post").replace(/^(instagram|linkedin|x|facebook)[^:]*:\s*/i, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "post"}`;
  const dlPop = $("#ds-dl-pop"), dlBtn = $("#ds-dl-menu");
  const closeDl = () => { dlPop.hidden = true; dlBtn.setAttribute("aria-expanded", "false"); };
  dlBtn.addEventListener("click", () => { const open = dlPop.hidden; dlPop.hidden = !open; dlBtn.setAttribute("aria-expanded", String(open)); });
  document.addEventListener("pointerdown", (e) => { if (!dlPop.hidden && !e.target.closest(".ds-menuwrap")) closeDl(); });
  $("#ds-dl-page").addEventListener("click", async () => {
    closeDl();
    downloadBlob(await exportPage(pageIdx), `${fileBase()}${design.pages.length > 1 ? `-${pageIdx + 1}` : ""}.png`);
  });
  $("#ds-dl-all").addEventListener("click", async () => {
    closeDl();
    dlBtn.disabled = true; const label = dlBtn.innerHTML; dlBtn.textContent = "Preparing…";
    try {
      if (design.pages.length === 1) { downloadBlob(await exportPage(0), `${fileBase()}.png`); return; }
      const JSZipMod = await import("https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm");
      const zip = new (JSZipMod.default || JSZipMod)();
      for (let i = 0; i < design.pages.length; i++) zip.file(`${String(i + 1).padStart(2, "0")}.png`, await exportPage(i));
      downloadBlob(await zip.generateAsync({ type: "blob" }), `${fileBase()}-carousel.zip`);
    } finally { dlBtn.disabled = false; dlBtn.innerHTML = label; }
  });
  function downloadBlob(blob, name) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  }

  // ── zoom ──
  function setZoom(z) {
    const prev = scale;
    zoom = clamp(z, 0.15, 6);
    fit();
    void prev;
  }
  container.querySelector(".ds-zoom").addEventListener("click", (e) => {
    const b = e.target.closest("[data-zoom]"); if (!b) return;
    if (b.dataset.zoom === "fit") setZoom(1);
    else setZoom(zoom * (b.dataset.zoom === "in" ? 1.25 : 0.8));
  });
  stage.addEventListener("wheel", (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;   // pinch or ⌘-scroll zooms; plain scroll pans
    e.preventDefault();
    setZoom(zoom * Math.exp(-e.deltaY * 0.0025));
  }, { passive: false });

  // ── panel open / closed (click the active rail item to hide it) ──
  function setPanelOpen(open) { $("#ds-body").classList.toggle("is-collapsed", !open); requestAnimationFrame(() => { lockedForW = 0; fit(); }); }

  function refreshAll() {
    if (eraser && !eraserTarget()) stopEraser();
    $("#ds-format").value = design.format;
    fit();
    paintPages();
    lockToolbarHeight(true);
    paintToolbar();
    paintPanel();
    paintHistory();
  }

  commit();
  statusReady = true;
  dirty = false;
  setStatus();
  refreshAll();
  requestAnimationFrame(fit);

  return {
    // Open a post from the board: its saved design, or a design built from
    // a ready-made background + text (older Studio drafts).
    async open(post = {}) {
      clearTimeout(autosaveTimer);
      postId = post.id || null;
      postPlatform = post.platform || null;
      postTitle = post.title || null;
      if (post.designJson) {
        try { design = JSON.parse(post.designJson); } catch {}
      } else if (post.backgroundId) {
        const b = bgById[post.backgroundId];
        const s = post.studio || b?.preset || {};
        // Instagram posts are 1:1; only stories are tall.
        const f0 = /story/i.test(post.title || "") ? "story" : post.platform === "linkedin" ? "linkedin" : post.platform === "twitter" ? "wide" : "square";
        design = newDesignFrom("headline-top", f0, { kicker: s.kicker, headline: s.headline, sub: s.sub }, post.backgroundId);
      }
      caption = post.content || bgById[post.backgroundId]?.caption || "";
      designTitle = post.title || "Untitled design";
      $("#ds-title").value = designTitle;
      pageIdx = 0; setSelection([]); zoom = 1;
      undo.length = 0; redo.length = 0;
      commit(); dirty = false; lastError = ""; setStatus(); refreshAll();
    },
    newDesign,
    hasUnsaved: () => !!(saving || (dirty && postId)),
    refit: () => { lockedForW = 0; fit(); },
    destroy() { document.removeEventListener("keydown", onKey); document.removeEventListener("paste", onPaste); window.removeEventListener("beforeunload", onBeforeUnload); ro.disconnect(); },
  };
}
