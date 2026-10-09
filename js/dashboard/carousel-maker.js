// Article carousel maker (Social media → Article carousel).
//
// Pick a published story and it drafts a carousel straight from the article:
// a cover with the story's image, a few key points, a striking number and a
// quote when the text has them, and a "read the full story" page. Every
// slide is a Studio page (design-studio.js), so the result opens in the
// Studio fully editable, saves to the board as a design, and downloads as
// PNGs. An optional "write it with AI" step swaps in AI-written slides.
//
// mountCarouselMaker(ctx, root, { getArticles, getArticleHtml, studio,
//   savePost, updatePost, openInStudio }) → { selectArticle(id) }

import { esc, confirmDialog } from "./ui.js";

const W = 1080;
const FORMAT_H = { square: 1080, post: 1350 };
const M = 88;

const LOOKS = {
  paper:  { label: "Paper",  bg: "wash-paper",  dark: false, ink: "#0f172a", sub: "#334155", muted: "#5b6678", accent: "#8a5a3c", pill: "#0f172a", pillInk: "#f8f7f3", swatch: "#f1ece5" },
  sage:   { label: "Sage",   bg: "wash-sage",   dark: false, ink: "#0f172a", sub: "#334155", muted: "#5b6678", accent: "#4f6b52", pill: "#0f172a", pillInk: "#f8f7f3", swatch: "#dfe5d3" },
  night:  { label: "Night",  bg: "dark-navy",   dark: true,  ink: "#f8f7f3", sub: "#dde3ee", muted: "#a9b4c8", accent: "#e8d9b0", pill: "#f8f7f3", pillInk: "#0f172a", swatch: "#26324a" },
  forest: { label: "Forest", bg: "dark-forest", dark: true,  ink: "#f6f3ea", sub: "#dfe8dc", muted: "#b3c3b2", accent: "#e9d8a6", pill: "#f6f3ea", pillInk: "#1d2b20", swatch: "#2e4a35" },
};
const TYPES = {
  cover: { label: "Cover", fields: ["kicker", "headline", "text"] },
  point: { label: "Key point", fields: ["kicker", "headline", "text"] },
  stat:  { label: "Big number", fields: ["kicker", "number", "text"] },
  quote: { label: "Quote", fields: ["text", "who"] },
  end:   { label: "Read more", fields: ["headline", "text"] },
};
const FIELD = {
  kicker:   { label: "Label", ph: "e.g. What they found", max: 40 },
  headline: { label: "Headline", ph: "Short and punchy. Wrap a word in *stars* for italics.", max: 90, rows: 2 },
  text:     { label: "Text", ph: "One or two sentences.", max: 320, rows: 4 },
  number:   { label: "Number", ph: "e.g. 40% or 3 million", max: 14 },
  who:      { label: "Who said it", ph: "e.g. Dr. Alexandra DeCandia", max: 60 },
};

// ─── Page building ──────────────────────────────────────────────────────────
const uid = () => Math.random().toString(36).slice(2, 9);
const T = (o) => ({ id: uid(), opacity: 1, ...o });
const txt = (o) => T({ type: "text", font: "sans", weight: 400, size: 40, color: "#0f172a", align: "left", lh: 1.15, ls: 0, markup: false, h: 50, ...o });
const LOCKUP = { h: { w: 1033, h: 258 }, s: { w: 622, h: 316 } };
function logo(x, y, h, dark, stacked = false) {
  const L = LOCKUP[stacked ? "s" : "h"], w = Math.round(h * L.w / L.h);
  return T({ type: "image", src: `/beta/social/brand/${stacked ? "lockup-stacked" : "lockup"}-${dark ? "paper" : "ink"}.png?v=1`, x: x === "center" ? Math.round((W - w) / 2) : x === "right" ? W - M - w : x, y, w, h, fit: "contain", name: "Logo" });
}
const pad2 = (n) => String(n).padStart(2, "0");
function kickerRow(text, y, c) {
  return [
    T({ type: "line", x: M, y: y + 5, w: 34, h: 14, sw: 2, fill: c.accent, name: "Kicker rule" }),
    txt({ text, x: M + 50, y, w: W - 2 * M - 50, size: 21, weight: 600, ls: 0.18, upper: true, color: c.accent, lh: 1.1, name: "Label" }),
  ];
}
function chrome(i, n, c, H) {
  const segW = Math.min(64, Math.floor((W - 2 * M - (n - 1) * 8) / n));
  const bar = Array.from({ length: n }, (_, k) => T({ type: "rect", x: M + k * (segW + 8), y: H - 74, w: segW, h: 4, radius: 2, fill: k === i ? c.ink : c.muted, opacity: k === i ? 1 : 0.28, name: "Progress" }));
  return [...bar,
    txt({ text: `${pad2(i + 1)} / ${pad2(n)}`, x: M, y: 70, w: 200, size: 19, weight: 600, ls: 0.16, color: c.muted, lh: 1, name: "Page number" }),
    logo("right", 58, 36, c.dark),
  ];
}

// One slide → one Studio page. `f` scales the type down when text is long.
function buildLayers(s, i, n, c, H, art, f, noDek = false) {
  const sq = H === 1080, L = [];
  const z = (v) => Math.round(v * f);
  if (s.type === "cover") {
    L.push(logo(M, 58, 46, c.dark));
    let y;
    if (art.cover) {
      const ph = sq ? 470 : 620;
      L.push(T({ type: "image", src: art.cover, x: M, y: 136, w: W - 2 * M, h: ph, fit: "cover", radius: 18, name: "Cover image" }));
      y = 136 + ph + 42;
    } else y = sq ? 230 : 300;
    if (s.kicker) { L.push(...kickerRow(s.kicker, y, c)); y += 46; }
    L.push(txt({ text: s.headline || "Headline", x: M, y, w: W - 2 * M, size: z(art.cover ? (sq ? 62 : 70) : 92), weight: 700, lh: 1.04, ls: -0.03, color: c.ink, markup: true, name: "Headline" }));
    if (s.text && !noDek) L.push(txt({ text: s.text, x: M, y: 0, w: W - 2 * M - 40, size: z(art.cover && sq ? 28 : sq ? 34 : 31), font: "serif", lh: 1.38, color: c.sub, name: "Text", after: ["Headline", 20] }));
    L.push(T({ type: "rect", x: W - M - 200, y: H - 112, w: 200, h: 56, radius: 28, fill: c.pill, name: "Swipe pill" }));
    L.push(txt({ text: "Swipe →", x: W - M - 200, y: H - 112 + 15, w: 200, size: 22, weight: 600, align: "center", color: c.pillInk, lh: 1.15, name: "Swipe" }));
  } else if (s.type === "end") {
    const top = Math.round(H * (sq ? 0.17 : 0.2));
    L.push(logo("center", top, 150, c.dark, true));
    L.push(txt({ text: s.headline || "Read the full story", x: M, y: top + 150 + 64, w: W - 2 * M, size: z(78), weight: 700, lh: 1.04, ls: -0.035, align: "center", color: c.ink, markup: true, name: "Headline" }));
    if (s.text) L.push(txt({ text: s.text, x: M + 40, y: 0, w: W - 2 * M - 80, size: z(32), font: "serif", italic: true, lh: 1.35, align: "center", color: c.sub, name: "Text", after: ["Headline", 22] }));
    L.push(T({ type: "rect", x: Math.round((W - 440) / 2), y: H - 168, w: 440, h: 62, radius: 31, fill: c.pill, name: "Link pill" }));
    L.push(txt({ text: "catalyst-magazine.com", x: Math.round((W - 440) / 2), y: H - 168 + 17, w: 440, size: 23, weight: 600, align: "center", color: c.pillInk, lh: 1.15, name: "Website" }));
  } else {
    L.push(...chrome(i, n, c, H));
    let y = sq ? 190 : 250;
    if (s.type === "quote") {
      L.push(txt({ text: "“", x: M - 8, y: y - 30, w: 200, size: 220, font: "fraunces", weight: 600, lh: 1, color: c.accent, name: "Quote mark" }));
      L.push(txt({ text: s.text || "Quote", x: M, y: y + 150, w: W - 2 * M, size: z(sq ? 50 : 56), font: "fraunces", weight: 500, lh: 1.22, ls: -0.01, color: c.ink, name: "Quote" }));
      if (s.who) L.push(txt({ text: s.who, x: M, y: 0, w: W - 2 * M, size: 20, weight: 600, ls: 0.16, upper: true, color: c.muted, lh: 1.3, name: "Who", after: ["Quote", 34] }));
    } else {
      if (s.kicker) { L.push(...kickerRow(s.kicker, y, c)); y += 56; }
      if (s.type === "stat") {
        L.push(txt({ text: s.number || "00", x: M - 6, y, w: W - 2 * M, size: z(sq ? 230 : 270), weight: 700, lh: 0.95, ls: -0.05, color: c.ink, name: "Number", maxH: Math.round((sq ? 230 : 270) * f * 1.02), minSize: 90 }));
        if (s.text) L.push(txt({ text: s.text, x: M, y: 0, w: W - 2 * M - 40, size: z(sq ? 38 : 40), font: "serif", lh: 1.4, color: c.sub, name: "Text", after: ["Number", 26] }));
      } else if (s.headline) {
        L.push(txt({ text: s.headline, x: M, y, w: W - 2 * M, size: z(sq ? 60 : 66), weight: 700, lh: 1.05, ls: -0.03, color: c.ink, markup: true, name: "Headline" }));
        if (s.text) L.push(txt({ text: s.text, x: M, y: 0, w: W - 2 * M - 30, size: z(sq ? 36 : 39), font: "serif", lh: 1.45, color: c.sub, name: "Text", after: ["Headline", 28] }));
      } else {
        const len = (s.text || "").length, base = len < 120 ? 58 : len < 190 ? 52 : 46;
        L.push(txt({ text: s.text || "Text", x: M, y, w: W - 2 * M, size: z(sq ? base : base + 4), font: "serif", lh: 1.3, color: c.ink, name: "Text" }));
      }
    }
  }
  return L;
}

function buildPage(studio, s, i, n, look, format, art, bgLib) {
  const H = FORMAT_H[format] || 1080, c = LOOKS[look] || LOOKS.paper;
  const b = bgLib[c.bg] || {};
  const bg = { color: b.paper || c.swatch, image: b.image || `/beta/social/bg/${c.bg}.webp?v=2`, fit: "cover", tone: c.dark ? "dark" : "light", inkTop: b.inkTop ?? 0.5, focusY: 0.5 };
  const limit = H - (s.type === "cover" ? 136 : s.type === "end" ? 196 : 110);
  // Shrink the type step by step; a cover first gives up its dek before
  // its headline gets small.
  const SCALES = [1, 0.94, 0.88, 0.82, 0.76, 0.7, 0.64, 0.58];
  const tries = s.type === "cover" && s.text
    ? [...SCALES.slice(0, 3).map((f) => [f, false]), ...SCALES.map((f) => [f, true])]
    : SCALES.map((f) => [f, false]);
  let page;
  for (const [f, noDek] of tries) {
    page = studio.settleLayout({ id: uid(), bg, layers: buildLayers(s, i, n, c, H, art, f, noDek) });
    const bottom = Math.max(...page.layers.filter((L) => L.type === "text" && !/Swipe|Website/.test(L.name)).map((L) => L.y + (L.h || 0)));
    if (bottom <= limit) break;
  }
  // Inner slides: sit the content a little above the middle of the page
  // instead of hanging from the top.
  if (s.type !== "cover" && s.type !== "end") {
    const body = page.layers.filter((L) => !/^(Page number|Logo|Progress)$/.test(L.name));
    const top = Math.min(...body.map((L) => L.y)), bot = Math.max(...body.map((L) => L.y + (L.h || 0)));
    const areaTop = 150, areaBot = H - 120;
    const want = Math.round(areaTop + Math.max(0, (areaBot - areaTop) - (bot - top)) * 0.42);
    if (want > top) for (const L of body) L.y += want - top;
  }
  return page;
}

// ─── Drafting from the article ──────────────────────────────────────────────
const clean = (t) => String(t || "").replace(/ /g, " ").replace(/\s+/g, " ").trim();
function blocksOf(html) {
  const doc = new DOMParser().parseFromString(`<div>${html || ""}</div>`, "text/html");
  doc.querySelectorAll("figure, figcaption, script, style, img, table").forEach((e) => e.remove());
  const out = [];
  doc.querySelectorAll("p, h1, h2, h3, h4, h5, blockquote, li").forEach((el) => {
    if (el.tagName !== "BLOCKQUOTE" && el.closest("blockquote")) return;
    const t = clean(el.textContent);
    if (!t) return;
    const strong = [...el.querySelectorAll("strong, b")].map((x) => x.textContent).join(" ");
    const head = /^H\d$/.test(el.tagName) || (el.tagName === "P" && clean(strong) === t && t.length < 110 && !/[.!?]["”’]?$/.test(t));
    if (!head && t.length < 40) return;
    if (/^(photo|image|courtesy|source|credit)s?\b/i.test(t)) return;
    out.push({ head, text: t });
  });
  return out;
}
const ABBR = /\b(Dr|Mr|Mrs|Ms|Prof|St|Jr|Sr|vs|etc|e\.g|i\.e|U\.S|U\.K|No|Fig|approx|Inc|Ltd|Co|Mt|ca)\.$/i;
function sentencesOf(p) {
  const prot = p.replace(/(\d)\.(\d)/g, "$1․$2");
  const parts = prot.match(/[^.!?]+(?:[.!?]+["”’)\]]*|$)\s*/g) || [prot];
  const out = []; let buf = "";
  for (const s of parts) {
    buf += s;
    const b = buf.trim();
    if (ABBR.test(b) || /\b[A-Z]\.$/.test(b)) continue;
    if (b) out.push(b.replace(/․/g, "."));
    buf = "";
  }
  if (buf.trim()) out.push(buf.trim().replace(/․/g, "."));
  return out;
}
const PRONOUN_START = /^(He|She|They|It|This|These|That|Those|His|Her|Their|Its|But|And|So|Also|Then|There|Here|In other words|For example)\b/;
function scoreSentence(s) {
  const n = s.length;
  if (n < 50 || n > 300) return -9;
  let sc = n >= 70 && n <= 240 ? 2 : 0.5;
  if (/\d/.test(s)) sc += 1.2;
  sc += Math.min(3, (s.match(/\b(found|find|discover\w*|show\w*|reveal\w*|stud(y|ies)|research\w*|scientists?|could|because|first|only|million|billion|percent|new|why|how|without|instead|surprising\w*|key)\b/gi) || []).length);
  if (PRONOUN_START.test(s)) sc -= 2;
  if (/^(\w+\s+){0,3}(this|these|those|such)\b/i.test(s) || /^(If|While|Although|However|Still|Yet|Instead)\b/.test(s)) sc -= 1.2;
  if (/[“”"]/.test(s)) sc -= 3;
  if (/\(|https?:|www\./.test(s)) sc -= 1;
  if (/\b(I|my|me)\b/.test(s)) sc -= 1.5;
  if (/\?$/.test(s)) sc += 0.3;
  return sc;
}
const NUM_RE = /(\$?\d{1,3}(?:,\d{3})+|\$?\d+(?:\.\d+)?)(\s?(?:%|percent|per cent|million|billion|trillion|thousand)\b|%)?/gi;
function statOf(s) {
  if (/[“”"]/.test(s)) return null;
  let best = null;
  for (const m of s.matchAll(NUM_RE)) {
    const raw = m[1], suf = (m[2] || "").trim().toLowerCase();
    // Part of a name or code (COVID-19, H1N1, 3D, 5G), not a quantity.
    if (/[A-Za-z\-–]/.test(s[m.index - 1] || "") || /^[A-Za-z]/.test(s.slice(m.index + m[0].length))) continue;
    const v = parseFloat(raw.replace(/[$,]/g, ""));
    const year = !suf && /^\d{4}$/.test(raw) && v >= 1800 && v <= 2100;
    if (year || (!suf && v < 3)) continue;
    const score = (suf ? 3 : 0) + (v >= 10 ? 1 : 0) + (raw.startsWith("$") ? 1 : 0);
    const label = suf === "percent" || suf === "per cent" || suf === "%" ? `${raw}%` : suf ? `${raw} ${suf}` : raw;
    if (!best || score > best.score) best = { number: label, score };
  }
  return best && best.score >= 1 ? best : null;
}
function quotesOf(blocks, fullText) {
  const found = [];
  const NAME = "((?:Dr\\.\\s+|Professor\\s+)?[A-Z][\\w'’.-]+(?:\\s+[A-Z][\\w'’.-]+){0,2})";
  const VERB = "(?:said|says|explained|explains|added|adds|noted|notes|recalled|recalls|told)";
  blocks.forEach((b, bi) => {
    if (b.head) return;
    for (const m of b.text.matchAll(/[“"]([^”"]{40,260})[”"]/g)) {
      let q = clean(m[1]).replace(/[,;:]$/, ".");
      if (q.split(" ").length < 7 || !/^[A-Z0-9‘'(\[]/.test(q)) continue;   // whole sentences only
      if (!/[.!?…]$/.test(q)) q += ".";
      const after = b.text.slice(m.index + m[0].length, m.index + m[0].length + 90);
      const before = b.text.slice(Math.max(0, m.index - 110), m.index);
      let who = (after.match(new RegExp(`^\\s*,?\\s*${VERB}\\s+${NAME}`)) || [])[1]
        || (after.match(new RegExp(`^\\s*,?\\s*${NAME}\\s+${VERB}`)) || [])[1]
        || (before.match(new RegExp(`${NAME}\\s+${VERB}[^.“"]{0,30}[,:]?\\s*$`)) || [])[1] || "";
      if (/^(He|She|They|It|We|I|This|The)$/.test(who)) who = "";
      if (who && !/\s/.test(who)) {
        const full = fullText.match(new RegExp(`((?:Dr\\.\\s+)?[A-Z][\\w'’-]+\\s+)${who}\\b`));
        if (full) who = clean(full[1] + who);
      }
      const pos = bi / Math.max(1, blocks.length);
      let sc = (q.length >= 60 && q.length <= 200 ? 2 : 1) + (/\b(we|our|I|my)\b/i.test(q) ? 1 : 0) + (who ? 1.5 : 0) + (pos > 0.15 ? 0.5 : 0);
      found.push({ text: `“${q.replace(/^["“]|["”]$/g, "")}”`, who, sc });
    }
  });
  return found.sort((a, b) => b.sc - a.sc);
}
function splitTitle(title) {
  const t = clean(title);
  const i = t.indexOf(":");
  if (t.length > 44 && i >= 12 && i < t.length - 10) return { head: t.slice(0, i).trim(), rest: t.slice(i + 1).trim() };
  return { head: t, rest: "" };
}
function authorOf(a) {
  const n = clean(a.authorName || a.author || "");
  return !n || /^the catalyst$/i.test(n) ? "" : n;
}

export function draftSlides(article, html) {
  const blocks = blocksOf(html);
  const fullText = blocks.map((b) => b.text).join(" ");
  const total = Math.max(1, fullText.length);
  // Units: one sentence, or a short one joined to the next. Each knows where
  // it sits in the article and the nearest heading above it.
  const units = [];
  let off = 0, heading = "";
  for (const b of blocks) {
    if (b.head) { heading = b.text.replace(/[.:]$/, ""); off += b.text.length; continue; }
    const ss = sentencesOf(b.text);
    for (let k = 0; k < ss.length; k++) {
      let t = ss[k];
      if (t.length < 110 && ss[k + 1] && (t.length + ss[k + 1].length) <= 250 && !PRONOUN_START.test(t)) t = `${t} ${ss[k + 1]}`;
      units.push({ text: t, pos: off / total, heading, sc: scoreSentence(t) });
    }
    off += b.text.length;
  }
  const used = new Set();
  const take = (lo, hi, filter = () => true) => {
    const pool = units.filter((u) => u.pos >= lo && u.pos < hi && !used.has(u.text) && u.sc > 0 && filter(u)).sort((a, b) => b.sc - a.sc);
    const u = pool[0];
    if (u) { used.add(u.text); for (const v of units) if (v.text.includes(u.text) || u.text.includes(v.text)) used.add(v.text); }
    return u;
  };
  const { head, rest } = splitTitle(article.title || "");
  const dek = clean(article.deck || article.excerpt || rest);
  const slides = [{ type: "cover", kicker: clean(article.category || "Feature"), headline: head, text: dek }];
  const kick = (u, fallback) => (u?.heading && u.heading.length <= 42 ? u.heading : fallback);

  const hook = take(0, 0.32);
  if (hook) slides.push({ type: "point", kicker: kick(hook, "The story"), headline: "", text: hook.text });
  let statSlide = null;
  const statU = units.filter((u) => !used.has(u.text) && u.sc > 0 && statOf(u.text)).sort((a, b) => b.sc + statOf(b.text).score - a.sc - statOf(a.text).score)[0];
  if (statU) { used.add(statU.text); statSlide = { type: "stat", kicker: kick(statU, "By the numbers"), number: statOf(statU.text).number, text: statU.text }; }
  const mid = take(0.28, 0.72);
  if (statSlide && (!mid || statU.pos < mid.pos)) slides.push(statSlide);
  if (mid) slides.push({ type: "point", kicker: kick(mid, "Going deeper"), headline: "", text: mid.text });
  if (statSlide && mid && statU.pos >= mid.pos) slides.push(statSlide);
  const q = quotesOf(blocks, fullText)[0];
  if (q) slides.push({ type: "quote", text: q.text, who: q.who });
  const late = take(0.62, 1.01);
  if (late) slides.push({ type: "point", kicker: kick(late, "Why it matters"), headline: "", text: late.text });
  if (slides.length < 4) { const extra = take(0, 1.01); if (extra) slides.splice(slides.length, 0, { type: "point", kicker: kick(extra, "Going deeper"), headline: "", text: extra.text }); }
  const by = authorOf(article);
  slides.push({ type: "end", headline: "Read the *full story*", text: by ? `by ${by} · link in bio` : "Link in bio" });
  return slides.slice(0, 8);
}

export function draftCaption(article, slides) {
  const by = authorOf(article);
  const dek = clean(article.deck || article.excerpt || "");
  const hook = slides.find((s) => s.type === "point")?.text || "";
  const tag = `#${clean(article.category || "Science").replace(/[^A-Za-z0-9]/g, "")}`;
  return [
    clean(article.title),
    dek,
    hook && hook !== dek ? hook : "",
    `${by ? `Written by ${by} for The Catalyst.` : "From The Catalyst."} Read the full story at the link in our bio.`,
    `#TheCatalyst #STEM #ScienceInDC #StudentJournalism ${tag}`,
  ].filter(Boolean).join("\n\n");
}

function aiPrompt(article, text, n) {
  return `You are the social media editor for The Catalyst, a student science magazine in Washington, D.C. Turn the article below into an Instagram carousel that someone who has never heard of the topic would stop scrolling for, swipe all the way through, and understand.

Rules:
- ${n ? `${n} slides in total` : "5 to 7 slides in total"}: slide 1 is the cover, the last slide is "read more", everything in between tells the story in order, one idea per slide.
- Use only facts from the article. Don't invent numbers, names or claims. Quotes must be copied word for word, with the speaker's name as the article gives it.
- Write for curious high-school and college readers: plain words, short sentences, no jargon unless you explain it in the same sentence.
- Headlines at most 8 words. Text at most 2 sentences and 200 characters per slide. Labels at most 4 words.
- You may wrap one or two words of a headline in *stars* to set them in italics.
- Include a "stat" slide only if the article has a genuinely striking number, and a "quote" slide only if it has a strong quote.
- Then write an Instagram caption of 120 to 200 words: open with a hook line, explain the story in two or three short paragraphs, credit the writer, say "link in bio", and end with a question for readers and 4 to 6 hashtags including #TheCatalyst.

Before you answer, silently check and fix: every fact and number appears in the article; every quote is word for word with the right speaker; each slide makes one point and no two slides repeat each other; headlines are 8 words or fewer; the slides read in order as one story; the JSON below is valid.

Reply with ONLY this JSON (no other text):
{"caption":"…","slides":[
 {"type":"cover","kicker":"Category or topic","headline":"…","text":"one-sentence dek"},
 {"type":"point","kicker":"…","headline":"…","text":"…"},
 {"type":"stat","kicker":"…","number":"40%","text":"what the number means"},
 {"type":"quote","text":"“exact quote”","who":"Name, role"},
 {"type":"end","headline":"Read the *full story*","text":"by ${authorOf(article) || "The Catalyst"} · link in bio"}
]}

ARTICLE
Title: ${clean(article.title)}
${authorOf(article) ? `By: ${authorOf(article)}\n` : ""}${article.category ? `Section: ${clean(article.category)}\n` : ""}${clean(article.deck || article.excerpt) ? `Dek: ${clean(article.deck || article.excerpt)}\n` : ""}
${text.slice(0, 14000)}`;
}

function parseAi(raw) {
  const s = String(raw || "").replace(/```(?:json)?/gi, "");
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a < 0 || b <= a) throw new Error("Couldn't find the JSON in that reply.");
  const j = JSON.parse(s.slice(a, b + 1));
  const slides = (Array.isArray(j.slides) ? j.slides : []).map((x) => ({
    type: TYPES[x?.type] ? x.type : "point",
    kicker: clean(x?.kicker), headline: clean(x?.headline), text: clean(x?.text), number: clean(x?.number), who: clean(x?.who),
  })).filter((x) => x.headline || x.text || x.number);
  if (slides.length < 2) throw new Error("The reply didn't have enough slides.");
  return { slides, caption: String(j.caption || "").trim() };
}

// ─── UI ─────────────────────────────────────────────────────────────────────
const ICON = {
  left: '<path d="m15 6-6 6 6 6"/>', right: '<path d="m9 6 6 6-6 6"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
};
const svg = (k) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[k]}</svg>`;

export function mountCarouselMaker(ctx, root, opts) {
  const st = { article: null, html: "", slides: [], active: 0, look: "paper", format: "square", caption: "", savedId: null, saving: false };
  let studio = null, bgLib = {}, articles = [];
  const thumbs = new Map();

  root.innerHTML = `
    <div class="cm">
      <aside class="cm-side" aria-label="Choose a story">
        <div class="cm-side-head">
          <b>1. Pick a story</b>
          <label class="cm-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input type="search" id="cm-q" placeholder="Search published stories" aria-label="Search stories"></label>
        </div>
        <div class="cm-stories" id="cm-stories" role="listbox" aria-label="Published stories"><div class="cm-loading">Loading stories…</div></div>
      </aside>
      <section class="cm-main" id="cm-main" aria-live="polite"></section>
    </div>`;
  const $ = (s) => root.querySelector(s);
  const main = $("#cm-main");

  function emptyState() {
    main.innerHTML = `
      <div class="cm-empty">
        <h3>Turn a story into a carousel in a minute</h3>
        <ol>
          <li><b>Pick a story</b> on the left. The slides are drafted from the article: its cover, the key points, a striking number and a quote when it has them.</li>
          <li><b>Fix the words</b> slide by slide, and pick a look. Every change shows up straight away.</li>
          <li><b>Open it in the Studio</b> to fine-tune the design, or save it to the board and download the slides.</li>
        </ol>
      </div>`;
  }

  function renderStories() {
    const q = $("#cm-q").value.trim().toLowerCase();
    const list = articles.filter((a) => !q || `${a.title} ${a.authorName || a.author || ""} ${a.category || ""}`.toLowerCase().includes(q));
    const el = $("#cm-stories");
    if (!articles.length) { el.innerHTML = `<div class="cm-loading">No published stories found.</div>`; return; }
    if (!list.length) { el.innerHTML = `<div class="cm-loading">No stories match “${esc(q)}”.</div>`; return; }
    el.innerHTML = list.slice(0, 60).map((a) => {
      const d = Date.parse(a.publishedAt || "");
      const date = Number.isFinite(d) ? new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: new Date(d).getFullYear() !== new Date().getFullYear() ? "numeric" : undefined }) : "";
      const cover = a.coverImage || a.image || "";
      return `<button type="button" role="option" class="cm-story${st.article?.id === a.id ? " is-on" : ""}" data-id="${esc(a.id)}" aria-selected="${st.article?.id === a.id}">
        ${cover ? `<img src="${esc(cover)}" alt="" loading="lazy">` : `<span class="cm-story-ph"></span>`}
        <span><b>${esc(a.title || "Untitled")}</b><small>${esc([clean(a.category), date].filter(Boolean).join(" · "))}</small></span></button>`;
    }).join("");
  }

  function editorShell() {
    main.innerHTML = `
      <header class="cm-head">
        <div class="cm-head-title"><small>Carousel for</small><h3 id="cm-title"></h3></div>
        <div class="cm-head-ctl">
          <div class="cm-looks" role="radiogroup" aria-label="Look">
            ${Object.entries(LOOKS).map(([k, l]) => `<button type="button" role="radio" data-look="${k}" title="${l.label}" aria-label="${l.label}" style="--sw:${l.swatch}"><span></span>${l.label}</button>`).join("")}
          </div>
          <div class="cm-seg" role="radiogroup" aria-label="Size">
            <button type="button" role="radio" data-format="square">Square 1:1</button>
            <button type="button" role="radio" data-format="post">Portrait 4:5</button>
          </div>
        </div>
      </header>
      <div class="cm-strip" id="cm-strip" role="tablist" aria-label="Slides"></div>
      <div class="cm-edit">
        <div class="cm-stage"><img id="cm-big" alt="Slide preview"><span class="cm-busy" id="cm-busy" hidden>Updating…</span></div>
        <div class="cm-fields" id="cm-fields"></div>
      </div>
      <details class="cm-ai" id="cm-ai">
        <summary><b>Write the slides with AI</b><span>Optional. Copy a ready-made prompt into ChatGPT or Claude, then paste its reply here.</span></summary>
        <div class="cm-ai-body">
          <div class="cm-ai-row">
            <label>Slides <select class="input select" id="cm-ai-n"><option value="">Let the AI decide (5–7)</option><option>5</option><option>6</option><option>7</option></select></label>
            <button type="button" class="btn btn-secondary btn-sm" id="cm-ai-copy">Copy AI prompt</button>
          </div>
          <textarea class="input textarea" id="cm-ai-paste" rows="4" placeholder="Paste the AI's reply here. The slides update as soon as it's pasted."></textarea>
          <p class="cm-ai-msg" id="cm-ai-msg" role="status"></p>
        </div>
      </details>
      <div class="cm-caption">
        <div class="cm-caption-head"><b>Caption</b><span id="cm-cap-n"></span><button type="button" class="btn btn-ghost btn-sm" id="cm-cap-copy">Copy caption</button></div>
        <textarea class="input textarea" id="cm-cap" rows="7"></textarea>
      </div>
      <div class="cm-bar">
        <button type="button" class="btn btn-ghost btn-sm" id="cm-redraft" title="Throw away your edits and draft the slides from the article again">Start over</button>
        <span class="cm-bar-spacer"></span>
        <span class="cm-bar-msg" id="cm-msg" role="status"></span>
        <button type="button" class="btn btn-secondary btn-sm" id="cm-dl">Download slides</button>
        <button type="button" class="btn btn-secondary btn-sm" id="cm-save">Save to board</button>
        <button type="button" class="btn btn-primary btn-sm" id="cm-studio">Open in Studio</button>
      </div>`;
    $("#cm-title").textContent = st.article.title || "Untitled";
    main.querySelector(".cm-looks").addEventListener("click", (e) => { const b = e.target.closest("[data-look]"); if (!b) return; st.look = b.dataset.look; changed(true); });
    main.querySelector(".cm-seg").addEventListener("click", (e) => { const b = e.target.closest("[data-format]"); if (!b) return; st.format = b.dataset.format; changed(true); });
    $("#cm-strip").addEventListener("click", (e) => {
      if (e.target.closest("[data-add]")) { addSlide(); return; }
      const b = e.target.closest("[data-i]"); if (!b) return; st.active = +b.dataset.i; renderStrip(); renderFields(); renderBig();
    });
    $("#cm-strip").addEventListener("keydown", (e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault(); st.active = Math.max(0, Math.min(st.slides.length - 1, st.active + (e.key === "ArrowLeft" ? -1 : 1)));
      renderStrip(); renderFields(); renderBig(); $(`#cm-strip [data-i="${st.active}"]`)?.focus();
    });
    $("#cm-cap").addEventListener("input", () => { st.caption = $("#cm-cap").value; capCount(); dirty(); });
    $("#cm-cap-copy").addEventListener("click", () => copy($("#cm-cap").value, "Caption copied."));
    $("#cm-ai-copy").addEventListener("click", () => copy(aiPrompt(st.article, htmlText(st.html), $("#cm-ai-n").value), "Prompt copied. Paste it into ChatGPT or Claude."));
    $("#cm-ai-paste").addEventListener("input", () => {
      const msg = $("#cm-ai-msg"), v = $("#cm-ai-paste").value.trim();
      if (!v) { msg.textContent = ""; return; }
      try {
        const r = parseAi(v);
        if (r.slides[0].type !== "cover") r.slides.unshift({ type: "cover", kicker: clean(st.article.category || "Feature"), headline: splitTitle(st.article.title).head, text: "" });
        st.slides = r.slides; st.active = 0;
        if (r.caption) { st.caption = r.caption; $("#cm-cap").value = r.caption; capCount(); }
        msg.textContent = `Done: ${r.slides.length} slides from the AI. Check every fact against the article before posting.`;
        msg.className = "cm-ai-msg is-ok";
        changed(true);
      } catch (err) { msg.textContent = `${err.message} Paste the whole reply, including the { } brackets.`; msg.className = "cm-ai-msg is-err"; }
    });
    $("#cm-redraft").addEventListener("click", async () => { if (await confirmDialog("Draft the slides from the article again? Your edits to the words will be lost.", { confirmText: "Start over" })) redraft(); });
    $("#cm-dl").addEventListener("click", download);
    $("#cm-save").addEventListener("click", () => save(false));
    $("#cm-studio").addEventListener("click", () => save(true));
  }

  const htmlText = (html) => blocksOf(html).map((b) => (b.head ? `\n## ${b.text}\n` : b.text)).join("\n\n");
  async function copy(text, ok) {
    try { await navigator.clipboard.writeText(text); ctx.toast(ok, "success"); }
    catch { ctx.toast("Couldn't copy. Select the text and press Cmd+C.", "error"); }
  }
  function capCount() { const n = st.caption.length; const el = $("#cm-cap-n"); if (el) { el.textContent = `${n.toLocaleString()} / 2,200`; el.classList.toggle("is-over", n > 2200); } }

  // ── State changes ──
  let renderTimer = 0, renderSeq = 0;
  function dirty() {
    const b = $("#cm-save");
    if (b && st.savedId) b.textContent = "Save changes";
    const m = $("#cm-msg"); if (m) m.textContent = "";
  }
  function changed(all) {
    dirty();
    main.querySelectorAll("[data-look]").forEach((b) => { const on = b.dataset.look === st.look; b.classList.toggle("is-on", on); b.setAttribute("aria-checked", String(on)); });
    main.querySelectorAll("[data-format]").forEach((b) => { const on = b.dataset.format === st.format; b.classList.toggle("is-on", on); b.setAttribute("aria-checked", String(on)); });
    main.style.setProperty("--cm-ratio", st.format === "post" ? "4 / 5" : "1 / 1");
    if (all) { renderStrip(); renderFields(); }
    clearTimeout(renderTimer);
    renderTimer = setTimeout(renderAll, all ? 0 : 220);
  }
  function art() { return { cover: st.article?.coverImage || st.article?.image || "" }; }
  function pageFor(i) { return buildPage(studio, st.slides[i], i, st.slides.length, st.look, st.format, art(), bgLib); }
  function design() { return { format: st.format, pages: st.slides.map((_, i) => pageFor(i)) }; }
  async function renderAll() {
    const seq = ++renderSeq;
    $("#cm-busy")?.removeAttribute("hidden");
    await renderBig(seq);
    for (let i = 0; i < st.slides.length; i++) {
      if (seq !== renderSeq) return;
      const key = JSON.stringify([st.slides[i], i, st.slides.length, st.look, st.format]);
      if (thumbs.get(i)?.key !== key) {
        const c = await studio.renderDesignPage({ format: st.format, pages: [pageFor(i)] }, 0, 0.24);
        if (seq !== renderSeq) return;
        thumbs.set(i, { key, url: c.toDataURL("image/jpeg", 0.82) });
      }
      const img = root.querySelector(`#cm-strip [data-i="${i}"] img`);
      if (img) img.src = thumbs.get(i).url;
    }
    if (seq === renderSeq) $("#cm-busy")?.setAttribute("hidden", "");
  }
  async function renderBig(seq = renderSeq) {
    if (!st.slides[st.active]) return;
    const c = await studio.renderDesignPage({ format: st.format, pages: [pageFor(st.active)] }, 0, 0.6);
    if (seq !== renderSeq) return;
    const img = $("#cm-big"); if (img) { img.src = c.toDataURL("image/jpeg", 0.9); img.alt = `Slide ${st.active + 1} preview`; }
  }

  function renderStrip() {
    const el = $("#cm-strip"); if (!el) return;
    el.innerHTML = st.slides.map((s, i) => `
      <button type="button" role="tab" class="cm-thumb${i === st.active ? " is-on" : ""}" data-i="${i}" aria-selected="${i === st.active}" tabindex="${i === st.active ? 0 : -1}" aria-label="Slide ${i + 1}: ${esc(TYPES[s.type].label)}">
        <img alt=""${thumbs.get(i) ? ` src="${thumbs.get(i).url}"` : ""}><span>${i + 1} · ${esc(TYPES[s.type].label)}</span>
      </button>`).join("") +
      (st.slides.length < 10 ? `<button type="button" class="cm-thumb cm-add" data-add aria-label="Add a slide">${svg("plus")}<span>Add slide</span></button>` : "");
  }

  function renderFields() {
    const el = $("#cm-fields"), s = st.slides[st.active]; if (!el || !s) return;
    const n = st.slides.length, i = st.active;
    const fixed = s.type === "cover" || s.type === "end";
    el.innerHTML = `
      <div class="cm-fields-head">
        <b>Slide ${i + 1} of ${n}</b>
        <div class="cm-tools">
          <button type="button" class="cm-icon" data-act="left" ${i <= 1 || fixed ? "disabled" : ""} aria-label="Move slide earlier" title="Move earlier">${svg("left")}</button>
          <button type="button" class="cm-icon" data-act="right" ${i >= n - 2 || fixed ? "disabled" : ""} aria-label="Move slide later" title="Move later">${svg("right")}</button>
          <button type="button" class="cm-icon" data-act="dup" ${fixed || n >= 10 ? "disabled" : ""} aria-label="Duplicate slide" title="Duplicate">${svg("copy")}</button>
          <button type="button" class="cm-icon" data-act="del" ${fixed ? "disabled" : ""} aria-label="Delete slide" title="Delete">${svg("trash")}</button>
        </div>
      </div>
      ${fixed ? `<p class="cm-hint">${s.type === "cover" ? "The cover uses the story's own image." : "The last slide sends readers to the story."}</p>` : `
      <label class="cm-f"><span>Slide type</span><select class="input select" data-k="type">${["point", "stat", "quote"].map((t) => `<option value="${t}" ${s.type === t ? "selected" : ""}>${TYPES[t].label}</option>`).join("")}</select></label>`}
      ${TYPES[s.type].fields.map((k) => {
        const F = FIELD[k], v = s[k] || "";
        return `<label class="cm-f"><span>${F.label}${k === "who" || k === "kicker" ? " <em>(optional)</em>" : ""}</span>${F.rows
          ? `<textarea class="input textarea" data-k="${k}" rows="${F.rows}" maxlength="${F.max}" placeholder="${esc(F.ph)}">${esc(v)}</textarea>`
          : `<input class="input" data-k="${k}" maxlength="${F.max}" placeholder="${esc(F.ph)}" value="${esc(v)}">`}</label>`;
      }).join("")}`;
    el.querySelectorAll("[data-k]").forEach((inp) => inp.addEventListener(inp.tagName === "SELECT" ? "change" : "input", () => {
      const k = inp.dataset.k;
      s[k] = inp.value;
      if (k === "type") { if (s.type === "stat" && !s.number) s.number = statOf(s.text || "")?.number || ""; renderFields(); renderStrip(); changed(false); return; }
      changed(false);
    }));
    el.querySelector(".cm-tools").addEventListener("click", (e) => {
      const b = e.target.closest("[data-act]"); if (!b || b.disabled) return;
      const a = b.dataset.act;
      if (a === "left" || a === "right") { const j = i + (a === "left" ? -1 : 1); [st.slides[i], st.slides[j]] = [st.slides[j], st.slides[i]]; st.active = j; }
      else if (a === "dup") { st.slides.splice(i + 1, 0, { ...s }); st.active = i + 1; }
      else if (a === "del") { st.slides.splice(i, 1); st.active = Math.min(i, st.slides.length - 1); }
      thumbs.clear(); changed(true);
    });
  }

  function addSlide() {
    if (st.slides.length >= 10) return;
    const at = Math.max(1, st.slides.length - 1);
    st.slides.splice(at, 0, { type: "point", kicker: "", headline: "", text: "" });
    st.active = at; thumbs.clear(); changed(true);
    $("#cm-fields [data-k=text]")?.focus();
  }

  function redraft() {
    st.slides = draftSlides(st.article, st.html);
    st.caption = draftCaption(st.article, st.slides);
    st.active = 0; thumbs.clear();
    $("#cm-cap").value = st.caption; capCount();
    changed(true);
  }

  async function selectArticle(id) {
    const a = articles.find((x) => x.id === id);
    if (!a) return false;
    st.article = a; st.savedId = null; st.html = "";
    renderStories();
    main.innerHTML = `<div class="cm-empty"><div class="spinner"></div><p>Reading “${esc(a.title)}” and drafting the slides…</p></div>`;
    const [html] = await Promise.all([opts.getArticleHtml(a.id).catch(() => ""), ensureStudio()]);
    if (st.article !== a) return true;
    st.html = html || "";
    editorShell();
    redraft();
    return true;
  }

  async function ensureStudio() {
    if (studio) return studio;
    const [mod, lib] = await Promise.all([opts.studio(), fetch("/beta/social/library.json", { cache: "no-cache" }).then((r) => r.json()).catch(() => ({}))]);
    for (const b of lib.backgrounds || []) bgLib[b.id] = b;
    studio = mod;
    // Load the faces the layouts use before the first measurement.
    await studio.loadFontsFor([
      { type: "text", font: "sans", weight: 400 }, { type: "text", font: "sans", weight: 600 }, { type: "text", font: "sans", weight: 700 },
      { type: "text", font: "serif", weight: 400 }, { type: "text", font: "serif", weight: 400, italic: true },
      { type: "text", font: "fraunces", weight: 500 }, { type: "text", font: "fraunces", weight: 600 },
    ]);
    return studio;
  }

  // ── Output ──
  function postFields() {
    const a = st.article, n = st.slides.length;
    return {
      title: `Instagram carousel (${n} slides): ${a.title}`,
      platform: "instagram",
      content: st.caption,
      notes: "Made in the carousel maker. Open it in the Studio to fine-tune the design.",
      designJson: JSON.stringify(design()),
      articleId: a.id, articleSlug: a.slug || "", articleTitle: a.title || "",
    };
  }
  async function save(thenStudio) {
    if (st.saving || !st.article) return;
    st.saving = true;
    const btns = [$("#cm-save"), $("#cm-studio")]; btns.forEach((b) => b && (b.disabled = true));
    const msg = $("#cm-msg"); msg.textContent = "Saving…";
    try {
      const post = postFields();
      if (st.savedId) await opts.updatePost(st.savedId, post);
      else st.savedId = await opts.savePost(post);
      msg.textContent = "Saved to the board as a draft.";
      $("#cm-save").textContent = "Saved";
      if (thenStudio) await opts.openInStudio({ id: st.savedId, ...post, status: "proposed" });
    } catch (err) {
      console.error("[carousel] save", err);
      msg.textContent = ""; ctx.toast(`Couldn't save: ${err.message}`, "error");
    } finally { st.saving = false; btns.forEach((b) => b && (b.disabled = false)); }
  }
  async function download() {
    const b = $("#cm-dl"), msg = $("#cm-msg");
    b.disabled = true; msg.textContent = "Rendering the slides…";
    try {
      const d = design();
      const JSZipMod = await import("https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm");
      const zip = new (JSZipMod.default || JSZipMod)();
      const slug = (st.article.slug || "carousel").slice(0, 60);
      for (let i = 0; i < d.pages.length; i++) {
        msg.textContent = `Rendering slide ${i + 1} of ${d.pages.length}…`;
        const c = await studio.renderDesignPage(d, i, 1);
        const blob = await new Promise((r) => c.toBlob(r, "image/png"));
        zip.file(`${slug}-${pad2(i + 1)}.png`, blob);
      }
      zip.file(`${slug}-caption.txt`, st.caption);
      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const link = Object.assign(document.createElement("a"), { href: url, download: `catalyst-${slug}-carousel.zip` });
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      msg.textContent = `Downloaded ${d.pages.length} slides and the caption.`;
    } catch (err) {
      console.error("[carousel] download", err);
      msg.textContent = ""; ctx.toast(`Couldn't download: ${err.message}`, "error");
    } finally { b.disabled = false; }
  }

  $("#cm-q").addEventListener("input", renderStories);
  $("#cm-stories").addEventListener("click", (e) => { const b = e.target.closest("[data-id]"); if (b) selectArticle(b.dataset.id); });
  emptyState();
  const ready = Promise.resolve(opts.getArticles()).then((list) => { articles = list || []; renderStories(); });

  return { selectArticle: async (id) => { await ready; return selectArticle(id); } };
}
