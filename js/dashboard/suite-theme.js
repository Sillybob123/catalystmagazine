// Seasonal themes for the Editorial Suite.
//
// An admin picks the theme in Advanced tools (settings/suiteTheme):
//   mode:    "off" | "auto" | "fall" | "winter" | "spring" | "summer"
//            "auto" follows the current edition (settings/editions.current,
//            e.g. "Fall 2026"), falling back to the calendar season.
//   effects: false turns the drifting leaves / snow / petals / fireflies off
//            for everyone (the colours, art and mascots stay).
//
// A theme sets <html data-suite-theme="fall"> (colours and painted washes in
// css/suite-themes.css), decorates the logo (snow cap, a leaf, flowers, a
// summer glow), puts the season's painted mascot in the sidebar corner, and
// gives the Overview a seasonal hero (see overview.js). Particles drift on
// one canvas behind the cards and on a second inside the Overview hero. They
// never run on focus pages (writing, reviewing, building the newsletter or a
// post), with reduced motion, in a hidden tab, or when the person turns
// "Seasonal effects" off in their menu.
//
// Mascots were painted for this (Higgsfield, gpt_image_2_5, background
// removed) and live in /beta/suite-theme/<season>-{hero,corner}.webp.

import { db } from "../firebase-config.js";
import { doc, onSnapshot, setDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const ART_V = "?v=2";
const mascot = (season, which) => `/beta/suite-theme/${season}-${which}.webp${ART_V}`;

export const SEASONS = {
  fall: {
    label: "Fall", particles: "leaves",
    art: "/edition-art/fall-2026/hero-1600.webp",
    thumb: "/edition-art/fall-2026/hero-900.webp",
    place: "The Jefferson Memorial in autumn, from the Fall 2026 edition",
    blurb: "Warm paper, painted leaves drifting down and a friendly scarecrow.",
    hello: "Happy fall! Grab something warm. Here’s what the newsroom is working on.",
    hero: mascot("fall", "hero"), corner: mascot("fall", "corner"),
    heroAlt: "A smiling scarecrow with a sunflower in its straw hat, standing among pumpkins",
    cornerAlt: "A scarecrow with a crow on its arm",
  },
  winter: {
    label: "Winter", particles: "snow",
    art: "/edition-art/winter/hero-1600.webp",
    thumb: "/edition-art/winter/hero-1600.webp",
    place: "The Capitol on a snowy night, from the Winter 2027 edition",
    blurb: "Cool paper, real snowflakes, a snow-capped logo and a snowman.",
    hello: "Stay cozy! Here’s what the newsroom is working on this winter.",
    hero: mascot("winter", "hero"), corner: mascot("winter", "corner"),
    heroAlt: "A snowman in a navy striped scarf and hat, holding a mug of cocoa",
    cornerAlt: "A snowman in a top hat, waving",
  },
  spring: {
    label: "Spring", particles: "petals",
    art: "/edition-art/spring-2026/hero-1600.webp",
    thumb: "/edition-art/spring-2026/hero-900.webp",
    place: "The Einstein Memorial among redbuds, from the Spring 2026 edition",
    blurb: "Soft paper, blossoms on the breeze, flowers on the logo and a bunny.",
    hello: "Happy spring! Fresh stories are blooming in the newsroom.",
    hero: mascot("spring", "hero"), corner: mascot("spring", "corner"),
    heroAlt: "A bunny in a crown of cherry blossoms, holding pink tulips",
    cornerAlt: "A bunny with a watering can beside a pot of tulips and a robin",
  },
  summer: {
    label: "Summer", particles: "fireflies",
    art: "/edition-art/library/summer-01/hero-1600.webp",
    thumb: "/edition-art/library/summer-01/hero-900.webp",
    place: "The Lincoln Memorial at dusk",
    blurb: "Golden-hour paper, fireflies, a sunny logo and a puppy in sunglasses.",
    hello: "Happy summer! Here’s what the newsroom is up to.",
    hero: mascot("summer", "hero"), corner: mascot("summer", "corner"),
    heroAlt: "A golden retriever puppy in round sunglasses",
    cornerAlt: "A vintage ice cream cart with a striped canopy",
  },
};

// The logo itself in the season's dress: the same hexagon and orbits, the
// frame made of ice and snow, autumn leaves, cherry blossom, or summer sun.
const LOGO_V = 1;

// Pages where people need to concentrate: no motion at all.
const FOCUS_ROUTES = [
  "#/writer/draft", "#/book-reviews/write", "#/final-review",
  "#/newsletter/builder", "#/marketing/social",
  "#/edition",   // This edition: a plain, calm page
];
const isFocusRoute = (hash) => {
  const path = String(hash || "").split("?")[0];
  if (FOCUS_ROUTES.includes(path)) return true;
  return path === "#/editor/queue" && /[?&]review=/.test(hash);   // the review surface
};

const PREF_KEY = "catalyst.suite.seasonalEffects";
function effectsAllowedByUser() { try { return localStorage.getItem(PREF_KEY) !== "off"; } catch { return true; } }
function setEffectsAllowedByUser(on) { try { localStorage.setItem(PREF_KEY, on ? "on" : "off"); } catch {} }
// Anyone can turn the whole theme off for themselves (the switch in the top bar).
const HIDE_KEY = "catalyst.suite.themeOff";
function themeHiddenByUser() { try { return localStorage.getItem(HIDE_KEY) === "1"; } catch { return false; } }
function setThemeHiddenByUser(off) { try { off ? localStorage.setItem(HIDE_KEY, "1") : localStorage.removeItem(HIDE_KEY); } catch {} }

const state = { mode: "off", effects: true, editionName: "", season: null, started: false };

function calendarSeason(d = new Date()) {
  const m = d.getMonth();
  return m >= 8 && m <= 10 ? "fall" : (m === 11 || m <= 1) ? "winter" : m <= 4 ? "spring" : "summer";
}
function seasonFromName(name) {
  const m = /(fall|autumn|winter|spring|summer)/i.exec(String(name || ""));
  return m ? (m[1].toLowerCase() === "autumn" ? "fall" : m[1].toLowerCase()) : null;
}

export function resolveSeason(mode = state.mode, editionName = state.editionName) {
  if (!mode || mode === "off") return null;
  if (mode === "auto") return seasonFromName(editionName) || calendarSeason();
  return SEASONS[mode] ? mode : null;
}

// season: what this person sees (null when they turned the theme off);
// siteSeason: what the admins set for everyone.
export function currentTheme() {
  const siteSeason = resolveSeason();
  return { ...state, siteSeason, hiddenByMe: !!siteSeason && themeHiddenByUser(), season: siteSeason && !themeHiddenByUser() ? siteSeason : null };
}

// ---------- apply --------------------------------------------------------------
function apply() {
  const siteSeason = resolveSeason();
  const season = siteSeason && !themeHiddenByUser() ? siteSeason : null;
  state.season = season;
  paintThemeSwitch(siteSeason);
  const root = document.documentElement;
  if (season) root.dataset.suiteTheme = season; else delete root.dataset.suiteTheme;
  if (season) root.style.setProperty("--season-art", `url("${SEASONS[season].art}")`);
  else root.style.removeProperty("--season-art");
  paintLogo(season);
  paintCorner(season);
  updateFields();
  window.dispatchEvent(new CustomEvent("suitetheme", { detail: currentTheme() }));
}

// A quiet switch at the start of the top bar, only while a theme is on.
function paintThemeSwitch(siteSeason) {
  const bar = document.querySelector(".topbar-actions");
  let btn = document.querySelector(".season-switch");
  if (!siteSeason || !bar) { btn?.remove(); return; }
  if (!btn) {
    btn = document.createElement("button");
    btn.type = "button";
    btn.className = "season-switch";
    btn.addEventListener("click", () => { setThemeHiddenByUser(!themeHiddenByUser()); apply(); });
    bar.prepend(btn);
  }
  const off = themeHiddenByUser();
  const label = off ? "Turn theme on" : "Turn off theme";
  btn.setAttribute("aria-pressed", String(!off));
  btn.title = off ? `Show the ${SEASONS[siteSeason].label} theme again` : "Hide the seasonal theme for you (no one else is affected)";
  btn.setAttribute("aria-label", label);
  btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">${off
    ? '<path d="M12 3v2M12 19v2M5 12H3M21 12h-2M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M6.3 17.7l1.4-1.4M16.3 7.7l1.4-1.4"/><circle cx="12" cy="12" r="3.5"/>'
    : '<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>'}</svg><span>${label}</span>`;
}

function paintLogo(season) {
  const brand = document.querySelector(".sidebar .brand");
  const img = brand?.querySelector(".brand-mark img");
  if (!img) return;
  if (!img.dataset.plainSrc) img.dataset.plainSrc = img.getAttribute("src");
  const want = season ? `/beta/suite-theme/${season}-logo.webp?v=${LOGO_V}` : img.dataset.plainSrc;
  if (img.getAttribute("src") !== want) img.setAttribute("src", want);
  brand.querySelector(".brand-mark").dataset.season = season || "";
}

function paintCorner(season) {
  const sidebar = document.getElementById("sidebar");
  if (!sidebar) return;
  let corner = sidebar.querySelector(".season-corner");
  if (!season) { corner?.remove(); return; }
  if (!corner) {
    corner = document.createElement("div");
    corner.className = "season-corner";
    corner.setAttribute("aria-hidden", "true");
    sidebar.insertBefore(corner, sidebar.querySelector(".sidebar-footer"));
  }
  const s = SEASONS[season];
  corner.innerHTML = `<img src="${s.corner}" alt="" width="214" height="320" decoding="async" loading="lazy">`;
}

// ---------- particles ----------------------------------------------------------
// A field is one canvas of particles: the page-wide one sits behind the cards;
// the Overview hero asks for its own (attachHeroField) over its photograph.
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const rand = (a, b) => a + Math.random() * (b - a);

function motionAllowed() {
  return !!state.season && state.effects && effectsAllowedByUser() && !reducedMotion.matches && !document.hidden;
}

class Field {
  constructor(host, { fixed, density }) {
    this.host = host; this.fixed = fixed; this.density = density;
    this.canvas = null; this.kind = null; this.parts = []; this.raf = 0;
  }
  sync(wanted) {
    const want = wanted && state.season ? SEASONS[state.season].particles : null;
    if (!want) return this.stop();
    if (this.canvas && this.kind === want) return;
    this.start(want);
  }
  start(kind) {
    this.stop();
    this.kind = kind;
    const cv = document.createElement("canvas");
    cv.className = this.fixed ? "season-canvas" : "season-canvas season-canvas--local";
    cv.setAttribute("aria-hidden", "true");
    this.host.prepend(cv);
    this.canvas = cv; this.ctx = cv.getContext("2d");
    this.resize();
    const small = this.W < 760;
    const base = { leaves: small ? 7 : 15, petals: small ? 8 : 18, snow: small ? 18 : 36, fireflies: small ? 9 : 18 }[kind];
    this.parts = Array.from({ length: Math.max(4, Math.round(base * this.density)) }, () => this.make(kind, true));
    this.last = performance.now();
    // ~30 frames a second is plenty for drifting leaves or snow and halves
    // the drawing work (motion is time-based, so the speed is unchanged).
    let drawn = 0;
    const loop = (now) => {
      if (!this.canvas) return;
      if (now - drawn >= 32) { drawn = now; this.frame(now); }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }
  stop() {
    cancelAnimationFrame(this.raf); this.raf = 0;
    this.canvas?.remove(); this.canvas = null; this.parts = []; this.kind = null;
  }
  resize() {
    if (!this.canvas) return;
    const dpr = Math.min(1.5, window.devicePixelRatio || 1);   // soft shapes; full Retina isn't worth the pixels
    const r = this.fixed ? { width: window.innerWidth, height: window.innerHeight } : this.host.getBoundingClientRect();
    this.W = Math.max(1, r.width); this.H = Math.max(1, r.height);
    this.canvas.width = Math.round(this.W * dpr); this.canvas.height = Math.round(this.H * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  make(k, initial) {
    const W = this.W, H = this.H;
    const p = { k, x: rand(0, W), y: initial ? rand(-H, H) : rand(-60, -10), t: rand(0, 1000), color: PALETTES[k][Math.floor(Math.random() * PALETTES[k].length)] };
    if (k === "leaves") Object.assign(p, { shape: Math.random() < 0.6 ? "maple" : "leaf", size: rand(12, 20), vy: rand(16, 30), sway: rand(18, 42), swayF: rand(0.25, 0.55), rot: rand(0, Math.PI * 2), vr: rand(-0.6, 0.6), alpha: rand(0.55, 0.8) });
    if (k === "petals") Object.assign(p, { shape: Math.random() < 0.45 ? "blossom" : "petal", size: rand(6, 11), vy: rand(14, 26), sway: rand(22, 48), swayF: rand(0.3, 0.6), rot: rand(0, Math.PI * 2), vr: rand(-0.9, 0.9), alpha: rand(0.6, 0.85) });
    if (k === "snow") {
      // Mostly real six-armed flakes, with a few soft specks for depth.
      const flake = Math.random() < 0.7;
      Object.assign(p, { shape: flake ? "flake" : "speck", size: flake ? rand(7, 14) : rand(1.4, 2.6), vy: flake ? rand(12, 24) : rand(8, 16), sway: rand(8, 22), swayF: rand(0.2, 0.5), rot: rand(0, Math.PI), vr: rand(-0.4, 0.4), alpha: flake ? rand(0.6, 0.95) : rand(0.4, 0.65) });
      if (!this.fixed) p.color = Math.random() < 0.7 ? "#ffffff" : "#e6eef5";   // white over the night photo
    }
    if (k === "fireflies") Object.assign(p, { size: rand(1.6, 2.8), y: rand(H * 0.25, H), vx: rand(-6, 6), vy: rand(-5, 3), alpha: 0, pulse: rand(0.4, 0.9) });
    return p;
  }
  frame(now) {
    const dt = Math.min(0.05, (now - this.last) / 1000); this.last = now;
    const c = this.ctx, W = this.W, H = this.H;
    c.clearRect(0, 0, W, H);
    for (let i = 0; i < this.parts.length; i++) {
      const p = this.parts[i];
      p.t += dt;
      if (p.k === "fireflies") {
        p.vx = Math.max(-9, Math.min(9, p.vx + rand(-4, 4) * dt)); p.vy = Math.max(-7, Math.min(7, p.vy + rand(-4, 4) * dt));
        p.x += p.vx * dt; p.y += p.vy * dt;
        p.alpha = 0.18 + 0.7 * Math.max(0, Math.sin(p.t * p.pulse * 2));
        if (p.x < -20 || p.x > W + 20 || p.y < -20 || p.y > H + 20) { this.parts[i] = this.make("fireflies", true); continue; }
        const g = c.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * 6);
        g.addColorStop(0, `rgba(250, 214, 110, ${p.alpha})`);
        g.addColorStop(0.35, `rgba(239, 190, 80, ${p.alpha * 0.45})`);
        g.addColorStop(1, "rgba(239, 190, 80, 0)");
        c.fillStyle = g; c.beginPath(); c.arc(p.x, p.y, p.size * 6, 0, Math.PI * 2); c.fill();
        continue;
      }
      p.y += p.vy * dt;
      const dx = Math.sin(p.t * p.swayF * Math.PI) * p.sway;
      p.x += dx - (p.dx || 0); p.dx = dx;
      if (p.rot != null) p.rot += p.vr * dt;
      if (p.y > H + 30) { this.parts[i] = this.make(p.k, false); continue; }
      if (p.shape === "speck") { c.globalAlpha = p.alpha; c.fillStyle = p.color; c.beginPath(); c.arc(p.x, p.y, p.size, 0, Math.PI * 2); c.fill(); }
      else drawSprite(c, p, p.k === "leaves" || p.k === "petals");
    }
    c.globalAlpha = 1;
  }
}

let pageField = null;
const heroFields = new Set();

function updateFields() {
  const ok = motionAllowed();
  if (!pageField) pageField = new Field(document.body, { fixed: true, density: 1 });
  pageField.sync(ok && !isFocusRoute(location.hash));
  for (const f of heroFields) {
    if (!f.host.isConnected) { f.stop(); heroFields.delete(f); continue; }
    f.sync(ok);
  }
}

// The Overview hero's own flurry, over its photograph. Returns a detach fn.
export function attachHeroField(host) {
  const f = new Field(host, { fixed: false, density: 0.8 });
  heroFields.add(f);
  f.sync(motionAllowed());
  return () => { f.stop(); heroFields.delete(f); };
}

// ---------- the person's own switch (in their user menu) -------------------------
export function effectsMenuItemHtml() {
  if (!state.season || !state.effects) return "";
  const on = effectsAllowedByUser();
  return `
    <button type="button" class="user-menu-item" data-action="toggle-season-effects" role="menuitemcheckbox" aria-checked="${on}">
      <span class="user-menu-item-dot"></span>
      <span class="user-menu-item-label">Seasonal effects</span>
      <span class="user-menu-item-tag">${on ? "On" : "Off"}</span>
    </button>`;
}
export function toggleEffectsForMe() {
  setEffectsAllowedByUser(!effectsAllowedByUser());
  updateFields();
}

// ---------- start ---------------------------------------------------------------
export function initSuiteTheme() {
  if (state.started) return;
  state.started = true;
  onSnapshot(doc(db, "settings", "suiteTheme"), (snap) => {
    const d = snap.exists() ? snap.data() : {};
    state.mode = typeof d.mode === "string" ? d.mode : "off";
    state.effects = d.effects !== false;
    apply();
  }, (err) => console.warn("[theme] settings", err?.message));
  onSnapshot(doc(db, "settings", "editions"), (snap) => {
    state.editionName = snap.exists() && typeof snap.data().current === "string" ? snap.data().current.trim() : "";
    if (state.mode === "auto") apply();
  }, () => {});
  window.addEventListener("hashchange", updateFields);
  window.addEventListener("resize", () => { pageField?.resize(); heroFields.forEach((f) => f.resize()); });
  document.addEventListener("visibilitychange", updateFields);
  reducedMotion.addEventListener?.("change", updateFields);
}

const PALETTES = {
  leaves: ["#b45a2a", "#c9832e", "#8f3f23", "#d39a45", "#a8662f"],
  petals: ["#e7a6bf", "#f0c3d3", "#d98bab", "#f5d7e2"],
  snow: ["#8ea9c1", "#a3b9cc", "#7d9bb6"],
  fireflies: ["#e3b44f", "#efc96b"],
};
const MAPLE = new Path2D("M0-10l1.5 3.4 3-1.3-.75 3.4 3.4.55-2.25 2.45 2.65 2.05-3.6.75.55 3.2-2.8-1.7L0 6.2l-1.3-2.4-2.8 1.7.55-3.2-3.6-.75 2.65-2.05-2.25-2.45 3.4-.55-.75-3.4 3 1.3z");
const sprites = new Map();
function sprite(shape, color) {
  const key = shape + color;
  if (sprites.has(key)) return sprites.get(key);
  const S = 64, cv = document.createElement("canvas");
  cv.width = cv.height = S;
  const g = cv.getContext("2d");
  g.translate(S / 2, S / 2);
  const k = S / 26;   // shapes are authored on a ~26-unit grid
  g.scale(k, k);
  if (shape === "maple") {
    g.fillStyle = color; g.fill(MAPLE);
    g.strokeStyle = "rgba(70,30,10,.35)"; g.lineWidth = 0.45;
    g.beginPath(); g.moveTo(0, 6.2); g.lineTo(0, 11); g.moveTo(0, 6); g.lineTo(0, -7); g.moveTo(0, 0); g.lineTo(5, -3); g.moveTo(0, 0); g.lineTo(-5, -3); g.stroke();
  } else if (shape === "leaf") {
    g.fillStyle = color;
    g.beginPath(); g.moveTo(0, -11); g.bezierCurveTo(7, -6, 7, 5, 0, 10); g.bezierCurveTo(-7, 5, -7, -6, 0, -11); g.fill();
    g.strokeStyle = "rgba(70,30,10,.35)"; g.lineWidth = 0.5;
    g.beginPath(); g.moveTo(0, -9); g.lineTo(0, 12);
    for (let y = -5; y <= 5; y += 3.3) { g.moveTo(0, y); g.lineTo(4, y - 3); g.moveTo(0, y); g.lineTo(-4, y - 3); }
    g.stroke();
  } else if (shape === "flake") {
    g.strokeStyle = color; g.lineCap = "round"; g.lineWidth = 1.15;
    for (let a = 0; a < 6; a++) {
      g.save(); g.rotate((a * Math.PI) / 3);
      g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -11);
      g.moveTo(0, -4.5); g.lineTo(2.8, -7.2); g.moveTo(0, -4.5); g.lineTo(-2.8, -7.2);
      g.moveTo(0, -7.8); g.lineTo(1.8, -9.6); g.moveTo(0, -7.8); g.lineTo(-1.8, -9.6);
      g.stroke(); g.restore();
    }
    g.fillStyle = color; g.beginPath(); g.arc(0, 0, 1.3, 0, Math.PI * 2); g.fill();
  } else if (shape === "blossom") {
    g.fillStyle = color;
    for (let a = 0; a < 5; a++) {
      g.save(); g.rotate((a * 2 * Math.PI) / 5);
      g.beginPath(); g.moveTo(0, 0); g.bezierCurveTo(4.5, -3, 4, -9, 1, -10); g.lineTo(0, -8.6); g.lineTo(-1, -10); g.bezierCurveTo(-4, -9, -4.5, -3, 0, 0); g.fill();
      g.restore();
    }
    g.fillStyle = "#f3d27a"; g.beginPath(); g.arc(0, 0, 2, 0, Math.PI * 2); g.fill();
    g.fillStyle = "rgba(150,60,90,.45)";
    for (let a = 0; a < 5; a++) { const r = (a * 2 * Math.PI) / 5 + 0.6; g.beginPath(); g.arc(Math.cos(r) * 3.2, Math.sin(r) * 3.2, 0.55, 0, Math.PI * 2); g.fill(); }
  } else if (shape === "petal") {
    g.fillStyle = color;
    g.beginPath(); g.moveTo(0, 8); g.bezierCurveTo(7, 3, 6, -6, 1.2, -8); g.lineTo(0, -6.4); g.lineTo(-1.2, -8); g.bezierCurveTo(-6, -6, -7, 3, 0, 8); g.fill();
  }
  sprites.set(key, cv);
  return cv;
}
function drawSprite(c, p, flutter) {
  const img = sprite(p.shape, p.color);
  const d = p.size * 2;
  c.save(); c.translate(p.x, p.y); c.rotate(p.rot || 0);
  if (flutter) c.scale(1, Math.abs(Math.cos(p.t * 1.3)) * 0.7 + 0.3);
  c.globalAlpha = p.alpha;
  c.drawImage(img, -d / 2, -d / 2, d, d);
  c.restore();
}


// ---------- the picker (Advanced tools → Suite theme) ----------------------------
const escHtml = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const CHECK = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5L20 7"/></svg>';

export function mountThemePicker(ctx, root) {
  root.innerHTML = `
    <header class="adv-pane-header">
      <h2 class="adv-pane-title">Suite theme</h2>
      <p class="adv-pane-sub">Give the Editorial Suite a seasonal look for everyone on staff: the season's colors and painted washes, a decorated logo, a mascot in the sidebar corner, a welcoming Overview with the edition's photograph, and leaves, snowflakes, petals or fireflies drifting behind the pages. It never animates on focus pages (Write a draft, reviews, the newsletter builder, Social Studio), and anyone can switch the effects off for themselves from the menu under their name.</p>
    </header>
    <div class="st-grid" role="radiogroup" aria-label="Suite theme" id="st-grid"></div>
    <div class="st-row">
      <label class="st-switch"><input type="checkbox" id="st-effects"> Drifting effects (leaves, snow, petals, fireflies)</label>
      <span class="st-status" id="st-status" aria-live="polite"></span>
    </div>`;
  const grid = root.querySelector("#st-grid");
  const effectsBox = root.querySelector("#st-effects");
  const status = root.querySelector("#st-status");

  const tiles = [
    { mode: "off", title: "Off", text: "The standard Suite, no seasonal touches.", art: `<div class="st-tile-art st-tile-art--off">No theme</div>` },
    { mode: "auto", title: "Match the current edition", text: "", art: `<div class="st-tile-art st-tile-art--auto">${["fall", "winter", "spring", "summer"].map((k) => `<span style="background-image:url('${SEASONS[k].thumb}')"></span>`).join("")}</div>` },
    ...Object.entries(SEASONS).map(([k, v]) => ({ mode: k, title: v.label, text: v.blurb, art: `<div class="st-tile-art" style="background-image:url('${v.thumb}')"><img class="st-tile-mascot" src="${v.corner}" alt="" loading="lazy"></div>` })),
  ];

  const render = () => {
    const live = currentTheme();
    const autoSeason = resolveSeason("auto", state.editionName);
    grid.innerHTML = tiles.map((t) => {
      const text = t.mode === "auto"
        ? `Follows the current edition${state.editionName ? ` (${escHtml(state.editionName)})` : ""}. Now: ${escHtml(SEASONS[autoSeason].label)}.`
        : escHtml(t.text);
      return `
        <button type="button" class="st-tile" role="radio" aria-checked="${live.mode === t.mode}" data-mode="${t.mode}">
          ${t.art}
          <span class="st-tile-text"><b>${escHtml(t.title)}</b><span>${text}</span></span>
          <span class="st-tile-check">${CHECK}</span>
        </button>`;
    }).join("");
    effectsBox.checked = live.effects;
    effectsBox.disabled = !live.siteSeason;
    status.textContent = live.siteSeason
      ? `${SEASONS[live.siteSeason].label} theme is on for everyone${live.effects ? "" : ", without drifting effects"}.${live.hiddenByMe ? " You've turned it off for yourself (top bar)." : ""}`
      : "No theme is on.";
  };

  const save = async (patch) => {
    status.textContent = "Saving…";
    try {
      await setDoc(doc(db, "settings", "suiteTheme"), {
        ...patch,
        updatedAt: new Date().toISOString(),
        updatedByName: ctx?.profile?.name || ctx?.user?.email || "",
      }, { merge: true });
    } catch (err) {
      status.textContent = `Could not save: ${err.message}`;
    }
  };

  grid.addEventListener("click", (e) => {
    const b = e.target.closest("[data-mode]"); if (!b) return;
    save({ mode: b.dataset.mode, effects: effectsBox.checked || state.mode === "off" });
  });
  effectsBox.addEventListener("change", () => save({ effects: effectsBox.checked }));

  render();
  const onTheme = () => render();
  window.addEventListener("suitetheme", onTheme);
  return () => window.removeEventListener("suitetheme", onTheme);
}
