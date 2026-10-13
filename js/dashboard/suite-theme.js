// Seasonal themes for the Editorial Suite.
//
// An admin picks the theme in Advanced tools (settings/suiteTheme):
//   mode:    "off" | "auto" | "fall" | "winter" | "spring" | "summer"
//            "auto" follows the current edition (settings/editions.current,
//            e.g. "Fall 2026"), falling back to the calendar season.
//   effects: false turns the drifting leaves / snow / petals / fireflies off
//            for everyone (the colours and the Overview banner stay).
//
// The theme sets <html data-suite-theme="fall"> (colours in
// css/suite-themes.css), adds a small edition chip to the top bar and a
// photo banner to the Overview, and runs one light canvas of particles
// behind the content. The particles never run on focus pages (writing,
// reviewing, building the newsletter or a post), with reduced motion, in a
// hidden tab, or when the person turns "Seasonal effects" off in their menu.

import { db } from "../firebase-config.js";
import { doc, onSnapshot, setDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

export const SEASONS = {
  fall: {
    label: "Fall", particles: "leaves",
    art: "/edition-art/fall-2026/hero-1600.webp",
    thumb: "/edition-art/fall-2026/hero-900.webp",
    place: "The Jefferson Memorial in autumn, from the Fall 2026 edition",
    blurb: "Warm paper, rust accents and a few leaves drifting down.",
  },
  winter: {
    label: "Winter", particles: "snow",
    art: "/edition-art/winter/hero-1600.webp",
    thumb: "/edition-art/winter/hero-1600.webp",
    place: "The Capitol on a snowy night, from the Winter 2027 edition",
    blurb: "Cool paper, slate-blue accents and a light snowfall.",
  },
  spring: {
    label: "Spring", particles: "petals",
    art: "/edition-art/spring-2026/hero-1600.webp",
    thumb: "/edition-art/spring-2026/hero-900.webp",
    place: "The Einstein Memorial among redbuds, from the Spring 2026 edition",
    blurb: "Soft paper, blossom accents and petals on the breeze.",
  },
  summer: {
    label: "Summer", particles: "fireflies",
    art: "/edition-art/library/summer-01/hero-1600.webp",
    thumb: "/edition-art/library/summer-01/hero-900.webp",
    place: "The Lincoln Memorial at dusk",
    blurb: "Golden-hour paper, green accents and a few fireflies.",
  },
};

// Pages where people need to concentrate: no motion at all.
const FOCUS_ROUTES = [
  "#/writer/draft", "#/book-reviews/write", "#/final-review",
  "#/newsletter/builder", "#/marketing/social",
];
const isFocusRoute = (hash) => {
  const path = String(hash || "").split("?")[0];
  if (FOCUS_ROUTES.includes(path)) return true;
  return path === "#/editor/queue" && /[?&]review=/.test(hash);   // the review surface
};

const PREF_KEY = "catalyst.suite.seasonalEffects";
function effectsAllowedByUser() { try { return localStorage.getItem(PREF_KEY) !== "off"; } catch { return true; } }
function setEffectsAllowedByUser(on) { try { localStorage.setItem(PREF_KEY, on ? "on" : "off"); } catch {} }

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

export function currentTheme() {
  return { ...state, season: resolveSeason() };
}

// ---------- apply --------------------------------------------------------------
function apply() {
  const season = resolveSeason();
  state.season = season;
  const root = document.documentElement;
  if (season) root.dataset.suiteTheme = season; else delete root.dataset.suiteTheme;
  if (season) root.style.setProperty("--season-art", `url("${SEASONS[season].art}")`);
  else root.style.removeProperty("--season-art");
  paintChip(season);
  updateParticles();
  window.dispatchEvent(new CustomEvent("suitetheme", { detail: currentTheme() }));
}

const ICONS = {
  leaves: '<path d="M5 19c0-8 6-14 14-14 0 8-6 14-14 14Z"/><path d="M5 19 13 11"/>',
  snow: '<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9"/>',
  petals: '<path d="M12 12c-3-4-1-8 0-9 1 1 3 5 0 9Zm0 0c4-3 8-1 9 0-1 1-5 3-9 0Zm0 0c3 4 1 8 0 9-1-1-3-5 0-9Zm0 0c-4 3-8 1-9 0 1-1 5-3 9 0Z"/>',
  fireflies: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/>',
};

function paintChip(season) {
  const actions = document.querySelector(".topbar-actions");
  if (!actions) return;
  let chip = document.getElementById("season-chip");
  if (!season) { chip?.remove(); return; }
  if (!chip) {
    chip = document.createElement("span");
    chip.id = "season-chip";
    chip.className = "season-chip";
    actions.prepend(chip);
  }
  const s = SEASONS[season];
  const label = state.mode === "auto" && state.editionName ? state.editionName : `${s.label} theme`;
  chip.title = state.mode === "auto" ? "Seasonal theme, following the current edition" : "Seasonal theme";
  chip.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[s.particles]}</svg><span>${label.replace(/[<>&]/g, "")}</span>`;
}

// ---------- particles -------------------------------------------------------------
let canvas = null, ctx2d = null, raf = 0, parts = [], kind = null, lastT = 0, W = 0, H = 0, DPR = 1;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

function particlesWanted() {
  return !!state.season && state.effects && effectsAllowedByUser()
    && !reducedMotion.matches && !document.hidden && !isFocusRoute(location.hash);
}

function updateParticles() {
  if (!particlesWanted()) { stopParticles(); return; }
  const want = SEASONS[state.season].particles;
  if (canvas && kind === want) return;
  startParticles(want);
}

function stopParticles() {
  cancelAnimationFrame(raf); raf = 0;
  if (canvas) { canvas.remove(); canvas = null; ctx2d = null; }
  parts = []; kind = null;
}

const rand = (a, b) => a + Math.random() * (b - a);
const PALETTES = {
  leaves: ["#b45a2a", "#c9832e", "#8f3f23", "#d39a45", "#a8662f"],
  petals: ["#e7a6bf", "#f0c3d3", "#d98bab", "#f5d7e2"],
  snow: ["#a9bccd", "#bccad7", "#97adc1"],
  fireflies: ["#e3b44f", "#efc96b"],
};

function makeParticle(k, initial) {
  const p = { k, x: rand(0, W), y: initial ? rand(-H, H) : rand(-60, -10), t: rand(0, 1000), color: PALETTES[k][Math.floor(Math.random() * PALETTES[k].length)] };
  if (k === "leaves") Object.assign(p, { size: rand(9, 16), vy: rand(16, 30), sway: rand(18, 42), swayF: rand(0.25, 0.55), rot: rand(0, Math.PI * 2), vr: rand(-0.6, 0.6), alpha: rand(0.38, 0.6) });
  if (k === "petals") Object.assign(p, { size: rand(5, 9), vy: rand(14, 26), sway: rand(22, 48), swayF: rand(0.3, 0.6), rot: rand(0, Math.PI * 2), vr: rand(-0.9, 0.9), alpha: rand(0.45, 0.7) });
  if (k === "snow") Object.assign(p, { size: rand(1.2, 2.8), vy: rand(10, 24), sway: rand(6, 16), swayF: rand(0.2, 0.5), alpha: rand(0.45, 0.85) });
  if (k === "fireflies") Object.assign(p, { size: rand(1.6, 2.6), y: rand(H * 0.25, H), vx: rand(-6, 6), vy: rand(-5, 3), alpha: 0, pulse: rand(0.4, 0.9) });
  return p;
}

function resize() {
  if (!canvas) return;
  DPR = Math.min(2, window.devicePixelRatio || 1);
  W = window.innerWidth; H = window.innerHeight;
  canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
  ctx2d.setTransform(DPR, 0, 0, DPR, 0, 0);
}

function startParticles(k) {
  stopParticles();
  kind = k;
  canvas = document.createElement("canvas");
  canvas.className = "season-canvas";
  canvas.setAttribute("aria-hidden", "true");
  document.body.prepend(canvas);
  ctx2d = canvas.getContext("2d");
  resize();
  const small = W < 760;
  const count = { leaves: small ? 7 : 14, petals: small ? 8 : 16, snow: small ? 26 : 50, fireflies: small ? 8 : 16 }[k];
  parts = Array.from({ length: count }, () => makeParticle(k, true));
  lastT = performance.now();
  raf = requestAnimationFrame(frame);
}

function drawLeaf(c, p) {
  c.save(); c.translate(p.x, p.y); c.rotate(p.rot);
  c.globalAlpha = p.alpha; c.fillStyle = p.color;
  const s = p.size;
  c.beginPath();
  c.moveTo(0, -s);
  c.quadraticCurveTo(s * 0.75, -s * 0.2, 0, s);
  c.quadraticCurveTo(-s * 0.75, -s * 0.2, 0, -s);
  c.fill();
  c.strokeStyle = "rgba(60,30,15,.25)"; c.lineWidth = 0.7;
  c.beginPath(); c.moveTo(0, -s * 0.8); c.lineTo(0, s * 1.15); c.stroke();
  c.restore();
}
function drawPetal(c, p) {
  c.save(); c.translate(p.x, p.y); c.rotate(p.rot);
  c.scale(1, Math.abs(Math.cos(p.t * 1.3)) * 0.7 + 0.3);   // the flutter
  c.globalAlpha = p.alpha; c.fillStyle = p.color;
  c.beginPath(); c.ellipse(0, 0, p.size, p.size * 0.62, 0, 0, Math.PI * 2); c.fill();
  c.restore();
}

function frame(now) {
  if (!canvas) return;
  const dt = Math.min(0.05, (now - lastT) / 1000); lastT = now;
  const c = ctx2d;
  c.clearRect(0, 0, W, H);
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    p.t += dt;
    if (p.k === "fireflies") {
      p.vx += rand(-4, 4) * dt; p.vy += rand(-4, 4) * dt;
      p.vx = Math.max(-9, Math.min(9, p.vx)); p.vy = Math.max(-7, Math.min(7, p.vy));
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.alpha = 0.15 + 0.6 * Math.max(0, Math.sin(p.t * p.pulse * 2));
      if (p.x < -20 || p.x > W + 20 || p.y < -20 || p.y > H + 20) parts[i] = makeParticle("fireflies", true);
      const g = c.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * 5);
      g.addColorStop(0, `rgba(239, 201, 107, ${p.alpha})`);
      g.addColorStop(1, "rgba(239, 201, 107, 0)");
      c.fillStyle = g; c.beginPath(); c.arc(p.x, p.y, p.size * 5, 0, Math.PI * 2); c.fill();
      continue;
    }
    p.y += p.vy * dt;
    const dx = Math.sin(p.t * p.swayF * Math.PI) * p.sway;
    const x0 = p.x; p.x = x0 + (dx - (p.dx || 0)); p.dx = dx;
    if (p.rot != null) p.rot += p.vr * dt;
    if (p.y > H + 30) { parts[i] = makeParticle(p.k, false); continue; }
    if (p.k === "leaves") drawLeaf(c, p);
    else if (p.k === "petals") drawPetal(c, p);
    else { c.globalAlpha = p.alpha; c.fillStyle = p.color; c.beginPath(); c.arc(p.x, p.y, p.size, 0, Math.PI * 2); c.fill(); }
  }
  c.globalAlpha = 1;
  raf = requestAnimationFrame(frame);
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
  updateParticles();
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
  window.addEventListener("hashchange", updateParticles);
  window.addEventListener("resize", () => { resize(); });
  document.addEventListener("visibilitychange", updateParticles);
  reducedMotion.addEventListener?.("change", updateParticles);
}


// ---------- the picker (Advanced tools → Suite theme) ----------------------------
const escHtml = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const CHECK = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5L20 7"/></svg>';

export function mountThemePicker(ctx, root) {
  root.innerHTML = `
    <header class="adv-pane-header">
      <h2 class="adv-pane-title">Suite theme</h2>
      <p class="adv-pane-sub">Give the Editorial Suite a seasonal look for everyone on staff: the season's colours, the edition's photograph on the Overview, and a few leaves, snowflakes, petals or fireflies drifting behind the pages. It never animates on focus pages (Write a draft, reviews, the newsletter builder, Social Studio), and anyone can switch the effects off for themselves from the menu under their name.</p>
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
    ...Object.entries(SEASONS).map(([k, v]) => ({ mode: k, title: v.label, text: v.blurb, art: `<div class="st-tile-art" style="background-image:url('${v.thumb}')"></div>` })),
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
    effectsBox.disabled = !live.season;
    status.textContent = live.season
      ? `${SEASONS[live.season].label} theme is on for everyone${live.effects ? "" : ", without drifting effects"}.`
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
