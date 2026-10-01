// js/dashboard/post-studio.js
// Post Studio — put text over a Catalyst illustration and get a finished
// 1080×1350 Instagram post.
//
// Backgrounds are the watercolor drawings in /beta/social/ (listed in
// /beta/social/backgrounds.json): one per recent article, the editions, and
// evergreen series (pitch us, newsletter, book of the month, brain teaser,
// quote card, D.C. landmarks). Each leaves clean paper at the top for text
// and carries suggested text + a caption.
//
//   mountPostStudio(ctx, container, { onSaved }) → { open(preset) }
//
// Text: kicker (small caps), headline (Poppins; wrap a word in *asterisks*
// for serif italic, like the site's headlines), a line underneath, and an
// optional brand line. Download the PNG or save it as a draft on the board.

import { el, esc } from "./ui.js";

const W = 1080, H = 1350, SCALE = 2;
const INK = "#0f172a", INK_2 = "#334155", MUTED = "#5b6678";
const LIST_URL = "/beta/social/backgrounds.json";

let _list = null;
async function loadBackgrounds() {
  if (_list) return _list;
  const res = await fetch(`${LIST_URL}?v=${Date.now() >> 20}`, { cache: "no-cache" });
  if (!res.ok) throw new Error(`Could not load backgrounds (${res.status})`);
  _list = (await res.json()).backgrounds || [];
  return _list;
}

const _imgs = new Map();
function loadImg(src) {
  if (_imgs.has(src)) return _imgs.get(src);
  const p = new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Image failed to load"));
    img.src = src;
  });
  _imgs.set(src, p);
  return p;
}

async function fontsReady() {
  try {
    await Promise.all([
      document.fonts.load("700 80px Poppins"),
      document.fonts.load("600 26px Poppins"),
      document.fonts.load("italic 400 80px 'Source Serif 4'"),
      document.fonts.load("400 34px 'Source Serif 4'"),
    ]);
  } catch {}
}

// "*word*" → italic serif runs.
function runsOf(text) {
  const out = [];
  String(text || "").split(/(\*[^*]+\*)/).forEach((part) => {
    if (!part) return;
    const it = /^\*[^*]+\*$/.test(part);
    out.push({ text: it ? part.slice(1, -1) : part, italic: it });
  });
  return out;
}

// Greedy word wrap across mixed runs; returns lines of [{text, italic}].
function wrapRuns(ctx, runs, maxW, setFont) {
  const words = [];
  runs.forEach((r) => r.text.split(/(\s+)/).forEach((w) => { if (w) words.push({ text: w, italic: r.italic }); }));
  const lines = [[]];
  let width = 0;
  for (const w of words) {
    setFont(w.italic);
    const ww = ctx.measureText(w.text).width;
    const isSpace = /^\s+$/.test(w.text);
    if (!isSpace && width + ww > maxW && lines[lines.length - 1].length) {
      while (lines[lines.length - 1].length && /^\s+$/.test(lines[lines.length - 1].at(-1).text)) lines[lines.length - 1].pop();
      lines.push([]);
      width = 0;
    }
    if (isSpace && !lines[lines.length - 1].length) continue;
    lines[lines.length - 1].push(w);
    width += ww;
  }
  return lines.filter((l) => l.length);
}

function wrapPlain(ctx, text, maxW) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const w of words) {
    const t = line ? line + " " + w : w;
    if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t;
  }
  if (line) lines.push(line);
  return lines;
}

// Draws the post. Returns the canvas.
export async function renderPost(bg, f, canvas) {
  await fontsReady();
  canvas = canvas || document.createElement("canvas");
  canvas.width = W * SCALE;
  canvas.height = H * SCALE;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
  ctx.fillStyle = "#f8f7f3";
  ctx.fillRect(0, 0, W, H);
  let paper = "rgb(248,247,243)";
  if (bg?.image) {
    const img = await loadImg(bg.image);
    const s = Math.max(W / img.naturalWidth, H / img.naturalHeight);
    const dw = img.naturalWidth * s, dh = img.naturalHeight * s;
    ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
    try {   // the drawing's own paper color, from its top band
      const px = ctx.getImageData(0, 0, W * SCALE, 30 * SCALE).data;
      let r = 0, g = 0, b2 = 0, n = 0;
      for (let i = 0; i < px.length; i += 4 * 97) { r += px[i]; g += px[i + 1]; b2 += px[i + 2]; n++; }
      paper = `rgb(${Math.round(r / n)},${Math.round(g / n)},${Math.round(b2 / n)})`;
    } catch {}
  }

  const light = f.tone === "light";
  const ink = light ? "#f8f7f3" : INK, ink2 = light ? "rgba(248,247,243,.85)" : INK_2, muted = light ? "rgba(248,247,243,.75)" : MUTED;
  const center = f.align === "center";
  const M = 88, maxW = W - M * 2;
  const zoneBottom = Math.round(H * (bg?.textZone || 0.44));
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";

  // Brand line
  let y = f.brand !== false ? 156 : 120;

  // Headline size: largest that fits the text zone.
  const kickerH = f.kicker ? 58 : 0;
  const sub = String(f.sub || "").trim();
  let size = Number(f.size) || 84;
  let lines, lh, subLines = [], subSize = 34;
  for (; size >= 44; size -= 4) {
    lh = Math.round(size * 1.06);
    lines = wrapRuns(ctx, runsOf(f.headline), maxW, (it) => {
      ctx.font = it ? `italic 400 ${size * 1.04}px 'Source Serif 4'` : `700 ${size}px Poppins`;
    });
    subSize = Math.max(26, Math.round(size * 0.4));
    ctx.font = `400 ${subSize}px 'Source Serif 4'`;
    subLines = sub ? wrapPlain(ctx, sub, maxW) : [];
    const total = kickerH + lines.length * lh + (subLines.length ? 26 + subLines.length * subSize * 1.4 : 0);
    if (y + total <= zoneBottom) break;
  }

  // If the text runs into the drawing, wash the top of the drawing into
  // the paper behind the text so it always reads cleanly.
  const textBottom = y + kickerH + (lines || []).length * lh + (subLines.length ? 26 + subLines.length * Math.round(subSize * 1.4) : 0);
  const inkTop = (bg?.inkTop || bg?.textZone || 0.44) * H;
  if (!light && textBottom + 24 > inkTop) {
    const solid = textBottom + 18, end = solid + 150;
    const grad = ctx.createLinearGradient(0, 0, 0, end);
    grad.addColorStop(0, paper);
    grad.addColorStop(solid / end, paper);
    grad.addColorStop(1, paper.replace("rgb(", "rgba(").replace(")", ",0)"));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, end);
  }

  // (Re)draw the brand line on top of any wash.
  if (f.brand !== false) {
    ctx.font = "600 21px Poppins";
    ctx.fillStyle = muted;
    if ("letterSpacing" in ctx) ctx.letterSpacing = "4px";
    if (center) { ctx.textAlign = "center"; ctx.fillText("THE CATALYST", W / 2, 92); ctx.textAlign = "left"; }
    else {
      ctx.fillText("THE CATALYST", M, 92);
      if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
      ctx.font = "500 21px Poppins";
      ctx.textAlign = "right"; ctx.fillText("catalyst-magazine.com", W - M, 92); ctx.textAlign = "left";
    }
    if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
  }

  // Kicker
  if (f.kicker) {
    ctx.font = "600 23px Poppins";
    if ("letterSpacing" in ctx) ctx.letterSpacing = "4px";
    ctx.fillStyle = muted;
    const k = String(f.kicker).toUpperCase();
    if (center) {
      ctx.textAlign = "center"; ctx.fillText(k, W / 2, y + 22); ctx.textAlign = "left";
    } else {
      ctx.fillRect(M, y + 13, 34, 2);
      ctx.fillText(k, M + 50, y + 22);
    }
    if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
    y += kickerH;
  }

  // Headline
  ctx.fillStyle = ink;
  for (const line of lines || []) {
    y += lh;
    let lw = 0;
    for (const w of line) { ctx.font = w.italic ? `italic 400 ${size * 1.04}px 'Source Serif 4'` : `700 ${size}px Poppins`; lw += ctx.measureText(w.text).width; }
    let x = center ? (W - lw) / 2 : M;
    for (const w of line) {
      ctx.font = w.italic ? `italic 400 ${size * 1.04}px 'Source Serif 4'` : `700 ${size}px Poppins`;
      if ("letterSpacing" in ctx) ctx.letterSpacing = w.italic ? "0px" : `${-size * 0.035}px`;
      ctx.fillText(w.text, x, y);
      x += ctx.measureText(w.text).width;
    }
  }
  if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";

  // Line underneath
  if (subLines.length) {
    y += 26;
    ctx.font = `400 ${subSize}px 'Source Serif 4'`;
    ctx.fillStyle = ink2;
    for (const l of subLines) {
      y += Math.round(subSize * 1.4);
      if (center) { ctx.textAlign = "center"; ctx.fillText(l, W / 2, y); ctx.textAlign = "left"; }
      else ctx.fillText(l, M, y);
    }
  }
  return canvas;
}

export async function mountPostStudio(ctx, container, { onSaved, savePost } = {}) {
  container.innerHTML = `
    <div class="ps">
      <div class="ps-gallery">
        <div class="ps-gallery-head">
          <div>
            <h3>Backgrounds</h3>
            <p>Watercolor drawings with room for text. Pick one; the text is filled in for you and you can change everything.</p>
          </div>
          <div class="ps-filter" role="group" aria-label="Show">
            <button type="button" data-g="all" class="is-on">All</button>
            <button type="button" data-g="article">Articles</button>
            <button type="button" data-g="edition">Editions</button>
            <button type="button" data-g="series">Series</button>
          </div>
        </div>
        <div class="ps-grid" id="ps-grid"><div class="loading-state"><div class="spinner"></div>Loading…</div></div>
      </div>
      <aside class="ps-editor">
        <div class="ps-preview"><canvas id="ps-canvas" aria-label="Post preview"></canvas></div>
        <div class="ps-fields">
          <label class="ps-field"><span>Kicker</span><input id="ps-kicker" maxlength="48" placeholder="New story"></label>
          <label class="ps-field"><span>Headline <em>wrap a word in *asterisks* for italic</em></span><textarea id="ps-headline" rows="2" maxlength="140"></textarea></label>
          <label class="ps-field"><span>Line underneath</span><textarea id="ps-sub" rows="2" maxlength="220"></textarea></label>
          <div class="ps-row">
            <label class="ps-field ps-inline"><span>Text</span>
              <select id="ps-align"><option value="left">Left</option><option value="center">Centered</option></select></label>
            <label class="ps-field ps-inline"><span>Size</span>
              <input id="ps-size" type="range" min="52" max="104" step="4" value="84"></label>
            <label class="ps-check"><input id="ps-brand" type="checkbox" checked> Brand line</label>
          </div>
          <label class="ps-field"><span>Caption</span><textarea id="ps-caption" rows="6"></textarea></label>
          <div class="ps-actions">
            <button type="button" class="btn btn-primary btn-sm" id="ps-download">Download image</button>
            <button type="button" class="btn btn-secondary btn-sm" id="ps-copy">Copy caption</button>
            <button type="button" class="btn btn-secondary btn-sm" id="ps-save">Save as draft</button>
          </div>
          <p class="ps-hint">1080 &times; 1350, Instagram's portrait size.</p>
        </div>
      </aside>
    </div>`;

  const $ = (id) => container.querySelector(id);
  const canvas = $("#ps-canvas");
  const f = { kicker: "", headline: "", sub: "", align: "left", size: 84, brand: true, tone: "dark" };
  let bg = null, group = "all", list = [], timer = 0;

  const draw = () => {
    clearTimeout(timer);
    timer = setTimeout(() => { renderPost(bg, f, canvas).catch((e) => ctx.toast?.(e.message, "error")); }, 60);
  };

  const fill = (b, preset = {}) => {
    bg = b;
    const s = { ...(b?.preset || {}), ...preset };
    $("#ps-kicker").value = f.kicker = s.kicker || "";
    $("#ps-headline").value = f.headline = s.headline || "";
    $("#ps-sub").value = f.sub = s.sub || "";
    $("#ps-caption").value = s.caption || b?.caption || "";
    f.tone = b?.tone || "dark";
    container.querySelectorAll(".ps-tile").forEach((t) => t.classList.toggle("is-on", t.dataset.id === b?.id));
    draw();
  };

  const paintGrid = () => {
    const grid = $("#ps-grid");
    const shown = list.filter((b) => group === "all" || b.group === group);
    grid.innerHTML = shown.map((b) => `
      <button type="button" class="ps-tile${bg && bg.id === b.id ? " is-on" : ""}" data-id="${esc(b.id)}" title="${esc(b.title)}">
        <img src="${esc(b.thumb || b.image)}" alt="" loading="lazy" decoding="async">
        <span>${esc(b.title)}</span>
      </button>`).join("") || `<div class="empty-state">No backgrounds here yet.</div>`;
  };

  container.querySelector(".ps-filter").addEventListener("click", (e) => {
    const b = e.target.closest("[data-g]");
    if (!b) return;
    group = b.dataset.g;
    container.querySelectorAll(".ps-filter button").forEach((x) => x.classList.toggle("is-on", x === b));
    paintGrid();
  });
  $("#ps-grid").addEventListener("click", (e) => {
    const t = e.target.closest(".ps-tile");
    if (!t) return;
    fill(list.find((b) => b.id === t.dataset.id));
    if (window.matchMedia("(max-width: 1100px)").matches) container.querySelector(".ps-editor").scrollIntoView({ behavior: "smooth", block: "start" });
  });
  [["#ps-kicker", "kicker"], ["#ps-headline", "headline"], ["#ps-sub", "sub"]].forEach(([id, k]) =>
    $(id).addEventListener("input", (e) => { f[k] = e.target.value; draw(); }));
  $("#ps-align").addEventListener("change", (e) => { f.align = e.target.value; draw(); });
  $("#ps-size").addEventListener("input", (e) => { f.size = Number(e.target.value); draw(); });
  $("#ps-brand").addEventListener("change", (e) => { f.brand = e.target.checked; draw(); });

  $("#ps-download").addEventListener("click", async () => {
    if (!bg) return ctx.toast?.("Pick a background first.", "error");
    const c = await renderPost(bg, f);
    c.toBlob((blob) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `catalyst-${bg.id}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }, "image/png");
  });
  $("#ps-copy").addEventListener("click", () => {
    navigator.clipboard.writeText($("#ps-caption").value || "").then(() => ctx.toast?.("Caption copied.", "success"));
  });
  $("#ps-save").addEventListener("click", async () => {
    if (!bg) return ctx.toast?.("Pick a background first.", "error");
    if (typeof savePost !== "function") return;
    const btn = $("#ps-save");
    btn.disabled = true;
    try {
      await savePost({
        title: `Instagram: ${bg.articleTitle || f.headline.replace(/\*/g, "") || bg.title}`,
        platform: "instagram",
        content: $("#ps-caption").value,
        notes: `Made in Post Studio on "${bg.title}". Open it in the Studio to change the text, then Download image.`,
        coverImageUrl: new URL(bg.image, location.origin).href,
        backgroundId: bg.id,
        studio: { kicker: f.kicker, headline: f.headline, sub: f.sub, align: f.align, size: f.size, brand: f.brand },
        articleId: bg.articleId || "",
        articleSlug: bg.articleSlug || "",
        articleTitle: bg.articleTitle || "",
      });
      ctx.toast?.("Saved as a draft on the board.", "success");
      onSaved?.();
    } catch (err) {
      ctx.toast?.("Could not save: " + err.message, "error");
    } finally {
      btn.disabled = false;
    }
  });

  try {
    list = await loadBackgrounds();
    paintGrid();
    if (!bg && list.length) fill(list[0]);
  } catch (err) {
    $("#ps-grid").innerHTML = `<div class="error-state">${esc(err.message)}</div>`;
  }

  return {
    async open({ backgroundId, studio, caption } = {}) {
      list = list.length ? list : await loadBackgrounds();
      const b = list.find((x) => x.id === backgroundId) || list[0];
      if (studio) {
        f.align = studio.align || "left"; $("#ps-align").value = f.align;
        f.size = studio.size || 84; $("#ps-size").value = f.size;
        f.brand = studio.brand !== false; $("#ps-brand").checked = f.brand;
      }
      fill(b, { ...(studio || {}), caption });
    },
  };
}
