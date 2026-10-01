// js/dashboard/design-studio.js
// Design Studio — a small Canva-style editor for Catalyst social posts.
//
//   mountDesignStudio(ctx, container, { savePost, onSaved }) → { open(post) }
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
  post:   { label: "Post 4:5",   w: 1080, h: 1350 },
  square: { label: "Square 1:1", w: 1080, h: 1080 },
  story:  { label: "Story 9:16", w: 1080, h: 1920 },
};
const FONTS = {
  sans:  { label: "Poppins",       css: "Poppins" },
  serif: { label: "Source Serif",  css: "'Source Serif 4'" },
};
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
  const serif = L.font === "serif" || italicRun;
  const italic = L.italic || italicRun;
  const weight = italicRun && L.font !== "serif" ? 400 : (L.weight || 400);
  return `${italic ? "italic " : ""}${weight} ${L.size * (italicRun && L.font !== "serif" ? 1.04 : 1)}px ${serif ? FONTS.serif.css : FONTS.sans.css}`;
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

// Draw one page into ctx (already scaled to page units). `skip` = layer id
// not to draw (being edited in place).
export async function renderPage(ctx, page, fmt, { skip = null } = {}) {
  await fontsReady();
  const W = fmt.w, H = fmt.h;
  const bg = page.bg || {};
  ctx.save();
  ctx.fillStyle = bg.color || PAPER;
  ctx.fillRect(0, 0, W, H);
  if (bg.image) {
    try {
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
        await drawImageBox(ctx, L.src, L.x, L.y, L.w, L.h, L.fit || "contain", L.radius || 0);
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
function brandLine(W, color = "#5b6678", y = 72) {
  return [
    txt({ text: "THE CATALYST", x: 88, y, w: 420, size: 21, weight: 600, ls: 0.18, color, markup: false, name: "Brand" }),
    txt({ text: "catalyst-magazine.com", x: W - 88 - 420, y, w: 420, size: 21, weight: 500, align: "right", color, markup: false, name: "Website" }),
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
      txt({ text: "THE CATALYST", x: 104, y: 70, w: 400, size: 21, weight: 600, ls: 0.18, color: "#fdfcf9", markup: false, name: "Brand" }),
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
      T({ type: "image", src: "/beta/social/el/people-writer.webp?v=1", x: W - 88 - 520, y: H - 60 - 560, w: 520, h: 560, fit: "contain", name: "Writer" }),
      ...kicker(c.kicker || "Join the newsroom", 88, 160),
      txt({ text: c.headline || "Love science? *Write about it.*", x: 88, y: 206, w: W - 176, size: 86, weight: 700, lh: 1.04, ls: -0.035, name: "Headline", maxH: Math.round(H * 0.3), minSize: 52 }),
      txt({ text: c.sub || "No experience needed. We train every new writer.", x: 88, y: 0, w: W - 400, size: 32, font: "serif", color: "#334155", name: "Line", after: ["Headline", 22] }),
    ] },
  { id: "speaker-event", name: "Talk / speaker", cat: "Announcement", bg: "wash-paper",
    build: (W, H, c) => [
      ...brandLine(W),
      T({ type: "image", src: "/beta/social/el/people-speaker.webp?v=1", x: W / 2 - 230, y: H - 60 - 470, w: 460, h: 470, fit: "contain", name: "Speaker" }),
      txt({ text: c.kicker || "Thursday · 6 pm · Science & Engineering Hall", x: 88, y: 160, w: W - 176, size: 23, weight: 600, ls: 0.12, upper: true, align: "center", color: "#5b6678", markup: false, name: "Kicker" }),
      txt({ text: c.headline || "How a vaccine *gets made*", x: 88, y: 208, w: W - 176, size: 88, weight: 700, lh: 1.04, ls: -0.035, align: "center", name: "Title", maxH: Math.round(H * 0.3), minSize: 52 }),
      txt({ text: c.sub || "A talk with Dr. Maya Chen · free and open to all", x: 88, y: 0, w: W - 176, size: 30, font: "serif", italic: true, align: "center", color: "#334155", markup: false, name: "Line", after: ["Title", 22] }),
    ] },
  { id: "body-fact", name: "Body fact", cat: "Data", bg: "wash-sage",
    build: (W, H, c) => [
      ...brandLine(W),
      T({ type: "image", src: "/beta/social/el/med-heart.webp?v=1", x: W - 88 - 360, y: H - 80 - 420, w: 360, h: 420, fit: "contain", name: "Heart" }),
      ...kicker(c.kicker || "Your body, explained", 88, 160),
      txt({ text: c.headline || "100,000", x: 80, y: 210, w: W - 160, size: 200, weight: 700, lh: 1, ls: -0.05, name: "Number" }),
      txt({ text: c.sub || "times a day, your heart beats, without you thinking about it once.", x: 88, y: 0, w: W - 520, size: 40, font: "serif", lh: 1.3, color: "#334155", name: "Explanation", after: ["Number", 24] }),
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
      txt({ text: "THE CATALYST", x: 0, y: H - 110, w: W, size: 20, weight: 600, ls: 0.22, align: "center", color: "#f1d9c8", markup: false, name: "Brand" }),
    ] },
  { id: "book-pick", name: "Book pick", cat: "People", bg: "wash-blush",
    build: (W, H, c) => [
      ...brandLine(W),
      T({ type: "image", src: "/beta/social/el/el-books.webp?v=1", x: W / 2 - 260, y: 170, w: 520, h: 370, fit: "contain", name: "Books" }),
      ...kicker(c.kicker || "Book review", W / 2 - 140, 600, "#5b6678", 300),
      txt({ text: c.headline || "*The Gene*, by Siddhartha Mukherjee", x: 100, y: 646, w: W - 200, size: 64, weight: 700, lh: 1.08, ls: -0.03, align: "center", name: "Title", maxH: 220, minSize: 40 }),
      txt({ text: c.sub || "“A history that reads like a thriller.”", x: 100, y: 0, w: W - 200, size: 34, font: "serif", italic: true, align: "center", color: "#334155", markup: false, name: "Line", after: ["Title", 24] }),
      txt({ text: "★★★★★", x: 100, y: 0, w: W - 200, size: 34, align: "center", color: "#c9962e", ls: 0.12, markup: false, name: "Stars", after: ["Line", 26] }),
    ] },
  { id: "newsletter", name: "Newsletter", cat: "Announcement", bg: "wash-sage",
    build: (W, H, c) => [
      ...brandLine(W),
      T({ type: "image", src: "/beta/social/el/el-envelope.webp?v=1", x: W / 2 - 210, y: Math.round(H * 0.42), w: 420, h: 483, fit: "contain", name: "Envelope" }),
      txt({ text: c.headline || "Science news, *in your inbox*", x: 88, y: 170, w: W - 176, size: 84, weight: 700, lh: 1.04, ls: -0.035, align: "center", name: "Headline", maxH: Math.round(H * 0.42) - 170 - 110, minSize: 48 }),
      txt({ text: c.sub || "Subscribe free · link in bio", x: 88, y: 0, w: W - 176, size: 32, font: "serif", align: "center", color: "#334155", markup: false, name: "Line", after: ["Headline", 22] }),
    ] },
  { id: "brain-teaser", name: "Brain teaser", cat: "Engagement", bg: "wash-lavender",
    build: (W, H, c) => [
      ...brandLine(W),
      T({ type: "image", src: "/beta/social/el/el-brain.webp?v=1", x: W - 88 - 330, y: H - 88 - 283, w: 330, h: 283, fit: "contain", name: "Brain" }),
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
export async function mountDesignStudio(ctx, container, { savePost, onSaved } = {}) {
  const [lib] = await Promise.all([loadLibrary().catch(() => ({ backgrounds: [], elements: [] })), fontsReady()]);
  const bgById = Object.fromEntries(lib.backgrounds.map((b) => [b.id, b]));

  // Stories: light illustrations fit the width and sit at the bottom (paper
  // above); dark scenes and textures fill the frame.
  const fitFor = (format, b) => (format === "story" && b && b.tone !== "dark" && (b.inkTop ?? 0.5) >= 0.15 ? "bottom" : "cover");
  const bgFrom = (b, format, extra = {}) => ({
    color: b?.paper && b.tone !== "dark" ? b.paper : PAPER,
    image: b?.image || null, fit: fitFor(format, b), tone: b?.tone || "light", inkTop: b?.inkTop ?? 0.5, ...extra,
  });
  const blankPage = () => ({ id: uid(), bg: { color: PAPER, image: bgById["wash-paper"]?.image || null }, layers: [] });
  const AUTOSAVE = `catalyst.studio.design.${ctx.user?.uid || "anon"}`;

  let design = null;
  try { design = JSON.parse(localStorage.getItem(AUTOSAVE) || "null"); } catch {}
  if (!design || !Array.isArray(design.pages) || !design.pages.length) design = newDesignFrom("headline-top");
  let pageIdx = 0, sel = null, editingId = null, panel = "templates", postId = null;
  const undo = [], redo = [];

  function newDesignFrom(tid, format = "post", content = {}, bgId) {
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
    if (b && b.inkTop >= 0.15) {
      const imgH = fitMode === "bottom" ? fmt.w * 1.25 : 2000 * Math.max(fmt.w / 1600, fmt.h / 2000);
      const top = fitMode === "bottom" ? fmt.h - imgH : (fmt.h - imgH) * focusY;
      ink = Math.min(fmt.h, top + b.inkTop * imgH);
    }
    return settleLayout({
      id: uid(),
      bg: bgFrom(b, format, { focusY }),
      layers: t.build(fmt.w, fmt.h, content, Math.round(ink)).map((L) => ({ ...L, id: uid() })),
    });
  }

  const page = () => design.pages[pageIdx];
  const fmt = () => FORMATS[design.format] || FORMATS.post;
  const layer = (id) => page().layers.find((l) => l.id === id);

  // ── history ──
  function commit() {
    undo.push(JSON.stringify({ design, pageIdx }));
    if (undo.length > 80) undo.shift();
    redo.length = 0;
    try { localStorage.setItem(AUTOSAVE, JSON.stringify(design)); } catch {}
    paintHistory();
  }
  let pendingCommit = 0;
  function commitSoon() { clearTimeout(pendingCommit); pendingCommit = setTimeout(commit, 400); }
  function restore(snap) { const s = JSON.parse(snap); design = s.design; pageIdx = Math.min(s.pageIdx, design.pages.length - 1); sel = null; refreshAll(); }
  function doUndo() { if (undo.length < 2) return; redo.push(undo.pop()); restore(undo[undo.length - 1]); paintHistory(); }
  function doRedo() { if (!redo.length) return; const s = redo.pop(); undo.push(s); restore(s); paintHistory(); }

  // ── shell ──
  container.innerHTML = `
    <div class="ds">
      <div class="ds-top">
        <div class="ds-top-left">
          <select id="ds-format" aria-label="Format">${Object.entries(FORMATS).map(([k, f]) => `<option value="${k}">${f.label}</option>`).join("")}</select>
          <button type="button" class="ds-icon" id="ds-undo" title="Undo (⌘Z)" aria-label="Undo"><svg viewBox="0 0 24 24"><path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/></svg></button>
          <button type="button" class="ds-icon" id="ds-redo" title="Redo (⇧⌘Z)" aria-label="Redo"><svg viewBox="0 0 24 24"><path d="m15 14 5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/></svg></button>
          <button type="button" class="ds-ghost" id="ds-new">New design</button>
        </div>
        <div class="ds-top-right">
          <button type="button" class="btn btn-secondary btn-sm" id="ds-dl-page">Download PNG</button>
          <button type="button" class="btn btn-secondary btn-sm" id="ds-dl-all">Download all (ZIP)</button>
          <button type="button" class="btn btn-primary btn-sm" id="ds-save">Save to board</button>
        </div>
      </div>
      <div class="ds-body">
        <nav class="ds-rail" aria-label="Studio panels">
          ${[["templates", "Templates", '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>'],
             ["backgrounds", "Backgrounds", '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="m3 16 5-5 4 4 3-3 6 6"/><circle cx="15.5" cy="8.5" r="1.5"/>'],
             ["elements", "Elements", '<path d="M12 3c3 3 3 6 0 9-3-3-3-6 0-9z"/><circle cx="7" cy="17" r="4"/><rect x="13" y="13" width="8" height="8" rx="1.5"/>'],
             ["text", "Text", '<path d="M5 6V4h14v2"/><path d="M12 4v16"/><path d="M9 20h6"/>'],
             ["photos", "Photos", '<path d="M4 7h3l2-3h6l2 3h3v13H4z"/><circle cx="12" cy="13" r="3.5"/>'],
             ["layers", "Layers", '<path d="m12 3 9 5-9 5-9-5 9-5z"/><path d="m3 13 9 5 9-5"/>']]
            .map(([k, label, icon]) => `<button type="button" data-panel="${k}" class="${k === "templates" ? "is-on" : ""}"><svg viewBox="0 0 24 24">${icon}</svg><span>${label}</span></button>`).join("")}
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
          <div class="ds-pages" id="ds-pages"></div>
        </div>
      </div>
      <div class="ds-caption">
        <label for="ds-caption-text">Caption <span>for Instagram (saved with the post)</span></label>
        <textarea id="ds-caption-text" rows="3" placeholder="Write the caption…"></textarea>
      </div>
    </div>`;

  const $ = (s) => container.querySelector(s);
  const canvas = $("#ds-canvas"), overlay = $("#ds-overlay"), artboard = $("#ds-artboard"), stage = $("#ds-stage");
  let scale = 0.4;

  // ── sizing ──
  function fit() {
    const f = fmt();
    const r = stage.getBoundingClientRect();
    const availW = Math.max(240, r.width - 48), availH = Math.max(320, Math.min(window.innerHeight - 260, 900));
    scale = Math.min(availW / f.w, availH / f.h);
    artboard.style.width = `${Math.round(f.w * scale)}px`;
    artboard.style.height = `${Math.round(f.h * scale)}px`;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(f.w * scale * dpr);
    canvas.height = Math.round(f.h * scale * dpr);
    canvas.style.width = artboard.style.width;
    canvas.style.height = artboard.style.height;
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
  function paintSelection(guides = []) {
    if (editingId) return;   // the inline text editor lives in the overlay
    overlay.innerHTML = guides.map((g) => g.v
      ? `<div class="ds-guide is-v" style="left:${g.v * scale}px"></div>`
      : `<div class="ds-guide is-h" style="top:${g.h * scale}px"></div>`).join("");
    const L = sel && layer(sel);
    if (!L || L.id === editingId) return;
    const box = el("div", { class: "ds-sel" + (L.locked ? " is-locked" : "") });
    Object.assign(box.style, { left: `${L.x * scale}px`, top: `${L.y * scale}px`, width: `${L.w * scale}px`, height: `${(L.h || 10) * scale}px` });
    if (!L.locked) {
      const hs = L.type === "text" ? ["w", "e", "nw", "ne", "sw", "se"] : L.type === "line" ? ["w", "e"] : ["n", "s", "w", "e", "nw", "ne", "sw", "se"];
      hs.forEach((h) => box.appendChild(el("span", { class: `ds-h ds-h-${h}`, "data-h": h })));
    }
    overlay.appendChild(box);
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
  const SNAP = 8;
  function snapMove(L, nx, ny) {
    const f = fmt(), guides = [];
    const cx = nx + L.w / 2, cy = ny + (L.h || 0) / 2;
    const xs = [[f.w / 2, cx - L.w / 2, "c"], [88, nx, "l"], [f.w - 88, nx + L.w, "r"]];
    for (const [g, v, kind] of xs) {
      if (Math.abs(v - g) < SNAP / scale * 0.5 + 2 || Math.abs((kind === "c" ? cx : v) - g) < SNAP / Math.max(scale, 0.3)) {
        if (kind === "c") nx = g - L.w / 2; else if (kind === "l") nx = g; else nx = g - L.w;
        guides.push({ v: g }); break;
      }
    }
    if (Math.abs(cy - f.h / 2) < SNAP / Math.max(scale, 0.3)) { ny = f.h / 2 - (L.h || 0) / 2; guides.push({ h: f.h / 2 }); }
    return { nx, ny, guides };
  }

  let drag = null;
  artboard.addEventListener("pointerdown", (e) => {
    if (editingId) return;
    const p = pt(e);
    const handle = e.target.closest(".ds-h");
    if (handle && sel) {
      const L = layer(sel);
      drag = { mode: "resize", h: handle.dataset.h, start: p, orig: clone(L) };
    } else {
      const L = hit(p);
      sel = L ? L.id : null;
      if (L && !L.locked) drag = { mode: "move", start: p, orig: clone(L) };
      paintToolbar();
      paintPanelIfLayers();
    }
    paintSelection();
    if (drag) artboard.setPointerCapture(e.pointerId);
  });
  artboard.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const p = pt(e), L = layer(sel);
    if (!L) return;
    const dx = p.x - drag.start.x, dy = p.y - drag.start.y, o = drag.orig;
    let guides = [];
    if (drag.mode === "move") {
      const s = snapMove(L, o.x + dx, o.y + dy);
      L.x = Math.round(s.nx); L.y = Math.round(s.ny); guides = s.guides;
    } else {
      const h = drag.h;
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
        L.x = Math.round(nx); L.y = Math.round(ny); L.w = Math.max(10, Math.round(nw)); L.h = Math.max(L.type === "line" ? 4 : 10, Math.round(nh));
      }
    }
    draw();
    paintSelection(guides);
  });
  const endDrag = () => {
    if (!drag) return;
    const changed = JSON.stringify(drag.orig) !== JSON.stringify(layer(sel));
    drag = null;
    paintSelection();
    if (changed) { commit(); paintToolbar(); }
  };
  artboard.addEventListener("pointerup", endDrag);
  artboard.addEventListener("pointercancel", endDrag);

  // ── edit text in place ──
  artboard.addEventListener("dblclick", (e) => {
    const L = hit(pt(e));
    if (L && L.type === "text" && !L.locked) startEditing(L);
  });
  function startEditing(L) {
    sel = L.id; editingId = L.id;
    const ta = el("textarea", { class: "ds-inline-edit", spellcheck: "true" });
    ta.value = L.text;
    Object.assign(ta.style, {
      left: `${L.x * scale}px`, top: `${L.y * scale}px`, width: `${L.w * scale}px`, minHeight: `${(L.h || L.size * 1.2) * scale}px`,
      font: `${L.italic ? "italic " : ""}${L.weight || 400} ${L.size * scale}px ${L.font === "serif" ? FONTS.serif.css : FONTS.sans.css}`,
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
    if (container.offsetParent === null) return;   // studio tab not visible
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || "") || document.activeElement?.isContentEditable;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === "z") { if (typing) return; e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); return; }
    if (typing) return;
    const L = sel && layer(sel);
    if (!L) return;
    if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); removeLayer(L.id); return; }
    if (mod && e.key.toLowerCase() === "d") { e.preventDefault(); duplicateLayer(L.id); return; }
    if (e.key === "Escape") { sel = null; paintSelection(); paintToolbar(); return; }
    const step = e.shiftKey ? 10 : 1;
    const mv = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (mv && !L.locked) { e.preventDefault(); L.x += mv[0]; L.y += mv[1]; draw(); commitSoon(); }
  };
  document.addEventListener("keydown", onKey);

  // ── layer ops ──
  function addLayer(L) {
    const f = fmt();
    L.id = uid();
    if (L.x == null) L.x = Math.round((f.w - L.w) / 2);
    if (L.y == null) L.y = Math.round((f.h - (L.h || 100)) / 2);
    page().layers.push(L);
    sel = L.id;
    commit(); draw(); paintToolbar(); paintPanelIfLayers();
  }
  function removeLayer(id) {
    page().layers = page().layers.filter((l) => l.id !== id);
    if (sel === id) sel = null;
    commit(); draw(); paintToolbar(); paintPanelIfLayers();
  }
  function duplicateLayer(id) {
    const L = layer(id); if (!L) return;
    const c = { ...clone(L), id: uid(), x: L.x + 24, y: L.y + 24 };
    const i = page().layers.indexOf(L);
    page().layers.splice(i + 1, 0, c);
    sel = c.id; commit(); draw(); paintToolbar(); paintPanelIfLayers();
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
  function paintToolbar() {
    const tb = $("#ds-toolbar");
    const L = sel && layer(sel);
    if (!L) {
      tb.innerHTML = bgControls();
      return;
    }
    const common = `
      <span class="ds-tb-sep"></span>
      <label class="ds-tb-field" title="Opacity">Opacity<input type="range" min="0.1" max="1" step="0.05" value="${L.opacity ?? 1}" data-prop="opacity"></label>
      <button type="button" class="ds-icon" data-act="up" title="Bring forward" aria-label="Bring forward"><svg viewBox="0 0 24 24"><path d="M12 19V5"/><path d="m6 11 6-6 6 6"/></svg></button>
      <button type="button" class="ds-icon" data-act="down" title="Send backward" aria-label="Send backward"><svg viewBox="0 0 24 24"><path d="M12 5v14"/><path d="m6 13 6 6 6-6"/></svg></button>
      <button type="button" class="ds-icon" data-act="dup" title="Duplicate (⌘D)" aria-label="Duplicate"><svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/></svg></button>
      <button type="button" class="ds-icon" data-act="lock" title="${L.locked ? "Unlock" : "Lock"}" aria-label="${L.locked ? "Unlock" : "Lock"}"><svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 ${L.locked ? "8 0v3" : "7.5-1.5"}"/></svg></button>
      <button type="button" class="ds-icon is-danger" data-act="del" title="Delete" aria-label="Delete"><svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg></button>`;
    if (L.type === "text") {
      tb.innerHTML = `
        <select data-prop="font" aria-label="Font">${Object.entries(FONTS).map(([k, f]) => `<option value="${k}"${L.font === k ? " selected" : ""}>${f.label}</option>`).join("")}</select>
        <select data-prop="weight" aria-label="Weight">${[400, 500, 600, 700].map((w) => `<option value="${w}"${Number(L.weight) === w ? " selected" : ""}>${{ 400: "Regular", 500: "Medium", 600: "Semibold", 700: "Bold" }[w]}</option>`).join("")}</select>
        <label class="ds-tb-field ds-size">Size<input type="number" min="8" max="400" value="${Math.round(L.size)}" data-prop="size"></label>
        <button type="button" class="ds-icon${L.italic ? " is-on" : ""}" data-toggle="italic" title="Italic" aria-label="Italic"><svg viewBox="0 0 24 24"><path d="M14 4h-4M14 20h-4M15 4 9 20"/></svg></button>
        <button type="button" class="ds-icon${L.upper ? " is-on" : ""}" data-toggle="upper" title="Uppercase" aria-label="Uppercase"><svg viewBox="0 0 24 24"><path d="M3 18 7 6l4 12M4.5 14h5M14 18V6h4a3 3 0 0 1 0 6h-4m0 0h4.5a3 3 0 0 1 0 6H14"/></svg></button>
        ${["left", "center", "right"].map((a) => `<button type="button" class="ds-icon${(L.align || "left") === a ? " is-on" : ""}" data-align="${a}" title="Align ${a}" aria-label="Align ${a}"><svg viewBox="0 0 24 24">${a === "left" ? '<path d="M4 6h16M4 10h10M4 14h16M4 18h10"/>' : a === "center" ? '<path d="M4 6h16M7 10h10M4 14h16M7 18h10"/>' : '<path d="M4 6h16M10 10h10M4 14h16M10 18h10"/>'}</svg></button>`).join("")}
        <label class="ds-tb-field">Spacing<input type="range" min="-0.08" max="0.3" step="0.01" value="${L.ls || 0}" data-prop="ls"></label>
        <label class="ds-tb-field">Lines<input type="range" min="0.8" max="2" step="0.02" value="${L.lh || 1.15}" data-prop="lh"></label>
        ${swatches(L.color, "color")}
        <button type="button" class="ds-ghost" data-act="edit">Edit text</button>
        ${common}`;
    } else if (L.type === "image") {
      tb.innerHTML = `
        <label class="ds-tb-field">Fit<select data-prop="fit"><option value="contain"${L.fit !== "cover" ? " selected" : ""}>Whole image</option><option value="cover"${L.fit === "cover" ? " selected" : ""}>Fill the box</option></select></label>
        <label class="ds-tb-field">Blend<select data-prop="blend"><option value="normal"${L.blend !== "multiply" ? " selected" : ""}>Normal</option><option value="multiply"${L.blend === "multiply" ? " selected" : ""}>Multiply (on paper)</option></select></label>
        <label class="ds-tb-field">Corners<input type="range" min="0" max="400" step="2" value="${L.radius || 0}" data-prop="radius"></label>
        ${common}`;
    } else {
      tb.innerHTML = `
        <span class="ds-tb-label">Fill</span>${swatches(L.fill, "fill")}
        ${L.type !== "line" ? `<label class="ds-tb-field">Corners<input type="range" min="0" max="300" step="2" value="${L.radius || 0}" data-prop="radius"></label>
        <label class="ds-tb-field">Outline<input type="range" min="0" max="20" step="0.5" value="${L.sw || 0}" data-prop="sw"></label>` : `<label class="ds-tb-field">Thickness<input type="range" min="1" max="20" step="0.5" value="${L.sw || 2}" data-prop="sw"></label>`}
        ${common}`;
    }
  }
  // Background controls (toolbar when nothing is selected, and the top of
  // the Backgrounds panel). A colour = a plain page; a wash tints the image.
  function bgControls({ inPanel = false } = {}) {
    const bg = page().bg || {};
    const hasImg = !!bg.image;
    return `
      ${inPanel ? "" : `<span class="ds-tb-label">Page ${pageIdx + 1}</span><span class="ds-tb-sep"></span>`}
      <div class="ds-bgctl">
        <span class="ds-tb-label">${hasImg ? "Plain colour" : "Colour"}</span>
        ${swatches(hasImg ? "" : bg.color, "bgc")}
      </div>
      ${hasImg ? `
      <div class="ds-bgctl">
        <span class="ds-tb-label">Wash over image</span>
        ${swatches(bg.tintAlpha > 0 ? bg.tintColor : "", "tint", { none: true })}
        <label class="ds-tb-field">Strength<input type="range" min="0" max="0.85" step="0.01" value="${bg.tintAlpha || 0}" data-bgprop="tintAlpha"></label>
      </div>
      <div class="ds-bgctl">
        <label class="ds-tb-field">Position<select data-act="bg-fit"><option value="cover"${bg.fit !== "bottom" ? " selected" : ""}>Fill the page</option><option value="bottom"${bg.fit === "bottom" ? " selected" : ""}>Fit width, at the bottom</option></select></label>
        <button type="button" class="ds-ghost" data-act="bg-clear">Remove image</button>
      </div>` : ""}
      ${inPanel ? "" : `<span class="ds-tb-hint">Click anything on the page to edit it. Double-click text to type.</span>`}`;
  }
  // Apply a colour from any swatch row. kind: color | fill | bgc | tint
  function applyColour(kind, c, { live = false } = {}) {
    const L = sel && layer(sel);
    const bg = page().bg || (page().bg = {});
    if (kind === "color" && L) L.color = c;
    else if (kind === "fill" && L) L.fill = c;
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
    container.querySelectorAll("[data-bg]").forEach((t) => t.classList.toggle("is-on", (bgById[t.dataset.bg]?.image || "") === (page().bg?.image || "-")));
  }
  function onColourInput(e) {
    const t = e.target;
    for (const kind of ["color", "fill", "bgc", "tint"]) {
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
    for (const kind of ["color", "fill", "bgc", "tint"]) {
      if (b.dataset[kind] != null && b.classList.contains("ds-sw")) { applyColour(kind, b.dataset[kind]); return true; }
    }
    if (b.dataset.act === "bg-clear") { page().bg.image = null; commit(); draw(); paintToolbar(); syncPanelBg(); return true; }
    return false;
  }
  function onBgFit(t) {
    if (t.dataset.act !== "bg-fit") return false;
    page().bg.fit = t.value; draw(); commit(); paintToolbar(); syncPanelBg(); return true;
  }

  $("#ds-toolbar").addEventListener("input", (e) => {
    if (onColourInput(e)) return;
    const t = e.target;
    const L = sel && layer(sel);
    if (t.dataset.prop && L) {
      const v = t.type === "range" || t.type === "number" ? Number(t.value) : t.value;
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
    panel = b.dataset.panel;
    container.querySelectorAll(".ds-rail button").forEach((x) => x.classList.toggle("is-on", x === b));
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
      const cats = [...new Set(TEMPLATES.map((t) => t.cat))];
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
        </div>`;
    } else if (panel === "photos") {
      p.innerHTML = `<h3>Photos</h3>
        <label class="ds-upload"><input type="file" accept="image/*" id="ds-file" hidden><span>Upload a photo</span><small>JPG or PNG. Saved to the team's storage.</small></label>
        <h4>Article covers</h4><div class="ds-bgrid" id="ds-covers"><p class="ds-panel-hint">Loading…</p></div>`;
      p.querySelector("#ds-file").addEventListener("change", onUpload);
      loadCovers().then((covers) => {
        const g = p.querySelector("#ds-covers");
        if (!g) return;
        g.innerHTML = covers.map((c) => `<button type="button" class="ds-btile is-photo" data-photo="${esc(c.src)}" title="${esc(c.title)}"><img src="${esc(proxied(c.src))}" alt="" loading="lazy"></button>`).join("") || `<p class="ds-panel-hint">No covers found.</p>`;
        // A cover that no longer exists shouldn't leave an empty tile.
        g.querySelectorAll("img").forEach((img) => img.addEventListener("error", () => img.closest("button")?.remove(), { once: true }));
      });
    } else if (panel === "layers") {
      const ls = [...page().layers].reverse();
      p.innerHTML = `<h3>Layers</h3><p class="ds-panel-hint">Top of the list is in front.</p>
        <ul class="ds-layers">${ls.map((L) => `
          <li class="${L.id === sel ? "is-on" : ""}" data-layer="${L.id}">
            <span class="ds-ltype">${{ text: "T", image: "Img", rect: "Box", ellipse: "Circ", line: "Line" }[L.type] || ""}</span>
            <span class="ds-lname">${esc(L.name || (L.type === "text" ? String(L.text).replace(/\*/g, "").slice(0, 32) : L.type))}</span>
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
      sel = null; commit(); draw(); paintToolbar();
    } else if (t.dataset.bg) {
      const b = bgById[t.dataset.bg];
      page().bg = bgFrom(b, design.format, { focusY: page().bg?.focusY ?? 0.5 });
      commit(); draw(); paintToolbar(); syncPanelBg();
    } else if (t.dataset.el) {
      const e2 = lib.elements.find((x) => x.id === t.dataset.el);
      const k = 440 / Math.max(e2.w || 1, e2.h || 1);
      addLayer({ type: "image", src: e2.image, w: Math.round((e2.w || 440) * k), h: Math.round((e2.h || 440) * k), fit: "contain", blend: "normal", name: e2.title });
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
      sel = L.id; paintSelection(); paintToolbar(); paintPanel();
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
  async function onUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const label = e.target.closest(".ds-upload").querySelector("span");
    label.textContent = "Uploading…";
    try {
      const { uploadToFirebase } = await import("./writer.js?v=topics-alt");
      const url = await uploadToFirebase(file, "image", ctx, (pct) => { label.textContent = `Uploading… ${pct}%`; });
      const f = fmt();
      addLayer({ type: "image", src: url, w: Math.round(f.w * 0.7), h: Math.round(f.w * 0.7 * 0.75), fit: "cover", radius: 18, name: "Photo" });
      label.textContent = "Upload a photo";
    } catch (err) {
      label.textContent = "Upload failed. Try again.";
      ctx.toast?.(err.message || "Upload failed", "error");
    }
    e.target.value = "";
  }

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
    if (t.dataset.goto) { pageIdx = Number(t.dataset.goto); sel = null; refreshAll(); }
    else if (t.dataset.pdel) {
      design.pages.splice(Number(t.dataset.pdel), 1);
      pageIdx = Math.min(pageIdx, design.pages.length - 1); sel = null; commit(); refreshAll();
    } else if (t.dataset.padd) {
      const np = t.dataset.padd === "dup" ? { ...clone(page()), id: uid() } : blankPage();
      if (t.dataset.padd === "dup") np.layers.forEach((l) => { l.id = uid(); });
      design.pages.splice(pageIdx + 1, 0, np);
      pageIdx++; sel = null; commit(); refreshAll();
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
      if (pg.bg?.image) pg.bg.fit = fitFor(e.target.value, pg.bg);
    });
    design.format = e.target.value;
    thumbCache.clear();
    commit(); refreshAll(); fit();
  });
  $("#ds-undo").addEventListener("click", doUndo);
  $("#ds-redo").addEventListener("click", doRedo);
  $("#ds-new").addEventListener("click", () => {
    design = newDesignFrom("headline-top", design.format); pageIdx = 0; sel = null; postId = null;
    $("#ds-caption-text").value = "";
    commit(); refreshAll();
  });
  function paintHistory() {
    $("#ds-undo").disabled = undo.length < 2;
    $("#ds-redo").disabled = !redo.length;
  }

  async function exportPage(i) {
    const c = await renderDesignPage(design, i, 1);
    return new Promise((r) => c.toBlob(r, "image/png"));
  }
  const fileBase = () => {
    const h = design.pages[0]?.layers.find((l) => l.type === "text" && /headline|title|heading|question/i.test(l.name || ""));
    return `catalyst-${String(h?.text || "post").replace(/\*/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "post"}`;
  };
  $("#ds-dl-page").addEventListener("click", async () => {
    const blob = await exportPage(pageIdx);
    downloadBlob(blob, `${fileBase()}${design.pages.length > 1 ? `-${pageIdx + 1}` : ""}.png`);
  });
  $("#ds-dl-all").addEventListener("click", async () => {
    const btn = $("#ds-dl-all");
    btn.disabled = true; btn.textContent = "Preparing…";
    try {
      if (design.pages.length === 1) { downloadBlob(await exportPage(0), `${fileBase()}.png`); return; }
      const JSZipMod = await import("https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm");
      const zip = new (JSZipMod.default || JSZipMod)();
      for (let i = 0; i < design.pages.length; i++) zip.file(`${String(i + 1).padStart(2, "0")}.png`, await exportPage(i));
      downloadBlob(await zip.generateAsync({ type: "blob" }), `${fileBase()}-carousel.zip`);
    } finally { btn.disabled = false; btn.textContent = "Download all (ZIP)"; }
  });
  function downloadBlob(blob, name) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  }

  $("#ds-save").addEventListener("click", async () => {
    if (typeof savePost !== "function") return;
    const btn = $("#ds-save");
    btn.disabled = true; btn.textContent = "Saving…";
    try {
      let coverUrl = "";
      try {
        const { uploadToFirebase } = await import("./writer.js?v=topics-alt");
        const blob = await exportPage(0);
        coverUrl = await uploadToFirebase(new File([blob], "post.png", { type: "image/png" }), "image", ctx);
      } catch (err) { console.warn("[studio] cover upload failed", err); }
      const head = design.pages[0].layers.find((l) => l.type === "text" && /headline|title|question|name|quote|number/i.test(l.name || ""));
      const saved = await savePost({
        id: postId,
        title: `Instagram: ${String(head?.text || "Studio design").replace(/\*/g, "").slice(0, 90)}${design.pages.length > 1 ? ` (${design.pages.length}-page carousel)` : ""}`,
        platform: "instagram",
        content: $("#ds-caption-text").value,
        notes: `Made in the Studio (${FORMATS[design.format].label}${design.pages.length > 1 ? `, ${design.pages.length} pages` : ""}). Open it in the Studio to edit or download.`,
        coverImageUrl: coverUrl,
        designJson: JSON.stringify(design),
      });
      if (saved && saved.id) postId = saved.id;
      ctx.toast?.("Saved to the board.", "success");
      onSaved?.();
    } catch (err) {
      ctx.toast?.("Could not save: " + err.message, "error");
    } finally { btn.disabled = false; btn.textContent = "Save to board"; }
  });

  function refreshAll() {
    $("#ds-format").value = design.format;
    fit();
    paintPages();
    paintToolbar();
    paintPanel();
    paintHistory();
  }

  commit();
  refreshAll();
  requestAnimationFrame(fit);

  return {
    // Open a post from the board: its saved design, or a design built from
    // a ready-made background + text (older Studio drafts).
    async open(post = {}) {
      postId = post.id || null;
      if (post.designJson) {
        try { design = JSON.parse(post.designJson); } catch {}
      } else if (post.backgroundId) {
        const b = bgById[post.backgroundId];
        const s = post.studio || b?.preset || {};
        design = newDesignFrom("headline-top", "post", { kicker: s.kicker, headline: s.headline, sub: s.sub }, post.backgroundId);
      }
      $("#ds-caption-text").value = post.content || bgById[post.backgroundId]?.caption || "";
      pageIdx = 0; sel = null;
      commit(); refreshAll();
    },
    destroy() { document.removeEventListener("keydown", onKey); ro.disconnect(); },
  };
}
