// Marketing module — mount keys:
//   - "analytics": headline stats + 30-day growth sparkline
//   - "collabs":   collaboration-request pipeline

import { el, esc, fmtRelative, fmtDate } from "./ui.js";

export async function mount(ctx, container) {
  container.innerHTML = "";
  if (ctx.mountKey === "collabs") return mountCollabs(ctx, container);
  if (ctx.mountKey === "subscribers") return mountSubscriberList(ctx, container);
  if (ctx.mountKey === "social") return mountSocialPosts(ctx, container);
  return mountAnalytics(ctx, container);
}

async function mountAnalytics(ctx, container) {
  const wrapper = el("div", {});
  wrapper.innerHTML = `
    <div class="grid grid-4" id="stat-grid">
      <div class="stat"><div class="stat-label">Total subscribers</div><div class="stat-value" data-k="total">…</div></div>
      <div class="stat"><div class="stat-label">Active</div><div class="stat-value" data-k="active">…</div></div>
      <div class="stat"><div class="stat-label">New — 7 days</div><div class="stat-value" data-k="new7">…</div></div>
      <div class="stat"><div class="stat-label">New — 30 days</div><div class="stat-value" data-k="new30">…</div></div>
    </div>

    <div class="card" style="margin-top:20px;">
      <div class="card-header">
        <div>
          <div class="card-title">30-day signup growth</div>
          <div class="card-subtitle">Daily new subscriber counts over the last month.</div>
        </div>
      </div>
      <div class="card-body">
        <div class="sparkline" id="sparkline"></div>
      </div>
    </div>

    <div class="grid grid-2" style="margin-top:20px;">
      <div class="stat"><div class="stat-label">Unsubscribes</div><div class="stat-value" data-k="unsub">…</div></div>
      <div class="stat"><div class="stat-label">Collaboration requests</div><div class="stat-value" data-k="collabs">…</div></div>
    </div>`;
  container.appendChild(wrapper);

  try {
    const res = await ctx.authedFetch("/api/subscribers/stats");
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);

    const set = (k, v) => { const n = wrapper.querySelector(`[data-k="${k}"]`); if (n) n.textContent = v; };
    set("total", data.stats.total);
    set("active", data.stats.active);
    set("new7", data.stats.new7);
    set("new30", data.stats.new30);
    set("unsub", data.stats.unsubscribed);
    set("collabs", data.stats.collaborations);

    const spark = wrapper.querySelector("#sparkline");
    const maxCount = Math.max(1, ...data.series.map((d) => d.count));
    spark.innerHTML = data.series.map((d) => {
      const h = Math.round((d.count / maxCount) * 100);
      return `<div class="sparkline-bar" title="${esc(d.date)}: ${d.count}" style="height:${Math.max(4, h)}%;"></div>`;
    }).join("");
  } catch (err) {
    wrapper.innerHTML = `<div class="error-state">Could not load stats: ${esc(err.message)}</div>`;
  }
}

async function mountSubscriberList(ctx, container) {
  const card = el("div", { class: "card" });
  card.innerHTML = `
    <div class="card-header">
      <div>
        <div class="card-title">Subscriber list</div>
        <div class="card-subtitle">Everyone currently on the mailing list.</div>
      </div>
      <div style="display:flex;gap:8px;align-items:center;">
        <input class="input" id="sub-search" placeholder="Search name or email…" style="width:220px;">
        <select class="input" id="sub-filter" style="width:130px;">
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="unsubscribed">Unsubscribed</option>
        </select>
        <span id="sub-count" class="hint" style="white-space:nowrap;"></span>
      </div>
    </div>
    <div class="card-body" id="sub-body"><div class="loading-state"><div class="spinner"></div>Loading…</div></div>`;
  container.appendChild(card);

  const body = card.querySelector("#sub-body");
  const searchInput = card.querySelector("#sub-search");
  const filterSelect = card.querySelector("#sub-filter");
  const countEl = card.querySelector("#sub-count");

  let allSubscribers = [];

  function renderList() {
    const q = searchInput.value.trim().toLowerCase();
    const statusFilter = filterSelect.value;

    const filtered = allSubscribers.filter((s) => {
      if (statusFilter && s.status !== statusFilter) return false;
      if (q) {
        const haystack = `${s.firstName} ${s.lastName} ${s.email}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });

    countEl.textContent = `${filtered.length} of ${allSubscribers.length}`;

    if (!filtered.length) {
      body.innerHTML = `<div class="empty-state">No subscribers match your search.</div>`;
      return;
    }

    body.innerHTML = `
      <table class="table">
        <thead>
          <tr><th>Name</th><th>Email</th><th>Status</th><th>Source</th><th>Joined</th></tr>
        </thead>
        <tbody>
          ${filtered.map((s) => `
            <tr>
              <td><strong>${esc((s.firstName + " " + s.lastName).trim() || "—")}</strong></td>
              <td><a href="mailto:${esc(s.email)}">${esc(s.email)}</a></td>
              <td><span class="pill ${s.status === "active" ? "pill-published" : "pill-rejected"}">${esc(s.status)}</span></td>
              <td>${esc(s.source || "—")}</td>
              <td>${s.createdAt ? fmtRelative(s.createdAt) : "—"}</td>
            </tr>`).join("")}
        </tbody>
      </table>`;
  }

  try {
    const res = await ctx.authedFetch("/api/subscribers/list");
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
    allSubscribers = data.subscribers;
    renderList();
  } catch (err) {
    body.innerHTML = `<div class="error-state">Could not load subscribers: ${esc(err.message)}</div>`;
    return;
  }

  searchInput.addEventListener("input", renderList);
  filterSelect.addEventListener("change", renderList);
}

async function mountCollabs(ctx, container) {
  const card = el("div", { class: "card" });
  card.innerHTML = `
    <div class="card-header">
      <div>
        <div class="card-title">Collaboration requests</div>
        <div class="card-subtitle">People who have signed up to work with Catalyst.</div>
      </div>
    </div>
    <div class="card-body" id="collab-body"><div class="loading-state"><div class="spinner"></div>Loading…</div></div>`;
  container.appendChild(card);

  try {
    const res = await ctx.authedFetch("/api/subscribers/stats");
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
    const body = card.querySelector("#collab-body");
    const list = data.collaborations || [];
    if (!list.length) { body.innerHTML = `<div class="empty-state">No collaboration requests yet.</div>`; return; }

    body.innerHTML = `
      <table class="table">
        <thead>
          <tr><th>Name</th><th>Email</th><th>Interest</th><th>Message</th><th>Received</th></tr>
        </thead>
        <tbody>
          ${list.map((r) => `
            <tr>
              <td><strong>${esc(r.name)}</strong></td>
              <td><a href="mailto:${esc(r.email)}">${esc(r.email)}</a></td>
              <td>${esc(r.role || "—")}</td>
              <td style="max-width:420px;">${esc(r.message || "").slice(0, 240)}${r.message && r.message.length > 240 ? "…" : ""}</td>
              <td>${r.createdAt ? fmtRelative(r.createdAt) : "—"}</td>
            </tr>`).join("")}
        </tbody>
      </table>`;
  } catch (err) {
    card.querySelector("#collab-body").innerHTML = `<div class="error-state">${esc(err.message)}</div>`;
  }
}

// ─── Social Media Posts ──────────────────────────────────────────────────────

const FIRESTORE_PROJECT = "catalystwriters-5ce43";

const PLATFORM_META = {
  instagram: { label: "Instagram", icon: "📸", pill: "pill-reviewing" },
  linkedin:  { label: "LinkedIn",  icon: "💼", pill: "pill-approved"  },
  twitter:   { label: "Twitter",   icon: "🐦", pill: "pill-pending"   },
  facebook:  { label: "Facebook",  icon: "📘", pill: "pill-draft"     },
};

const STATUS_PILL = {
  proposed: "pill-pending",
  approved: "pill-approved",
  assigned: "pill-reviewing",
  posted:   "pill-published",
};

// Shared Firestore value serialiser used by write helpers.
function toFsValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === "string") return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFsValue) } };
  if (typeof v === "object") {
    const out = {};
    for (const [k, val] of Object.entries(v)) out[k] = toFsValue(val);
    return { mapValue: { fields: out } };
  }
  return { stringValue: String(v) };
}
function toFsFields(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[k] = toFsValue(v);
  return out;
}

async function firestoreRunQuery(authedFetch, structuredQuery) {
  const res = await authedFetch(
    `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT}/databases/(default)/documents:runQuery`,
    { method: "POST", body: JSON.stringify({ structuredQuery }) }
  );
  if (!res.ok) throw new Error(`Firestore ${res.status}`);
  const rows = await res.json();
  return rows.filter((r) => r.document);
}

function fsStr(fields, k) { return fields[k]?.stringValue ?? ""; }

// Query helper for social_posts — returns structured post objects.
async function firestoreQuery(authedFetch, structuredQuery) {
  const docs = await firestoreRunQuery(authedFetch, structuredQuery);
  return docs.map((r) => {
    const f = r.document.fields || {};
    const str = (k) => fsStr(f, k);
    const arr = (k) => (f[k]?.arrayValue?.values || []).map((v) => {
      const m = v.mapValue?.fields || {};
      return { text: m.text?.stringValue ?? "", authorName: m.authorName?.stringValue ?? "", timestamp: m.timestamp?.stringValue ?? m.timestamp?.timestampValue ?? "" };
    });
    return {
      id: r.document.name.split("/").pop(),
      title: str("title"),
      platform: str("platform"),
      content: str("content"),
      notes: str("notes"),
      status: str("status"),
      proposerName: str("proposerName"),
      proposerId: str("proposerId"),
      assigneeName: str("assigneeName"),
      deadline: str("deadline"),
      createdAt: str("createdAt") || (f.createdAt?.timestampValue ?? ""),
      activity: arr("activity"),
    };
  });
}

// Query helper for stories/articles — returns article objects with all relevant fields.
// No select projection so we get every field stored on the document.
async function firestoreQueryArticles(authedFetch, structuredQuery) {
  const docs = await firestoreRunQuery(authedFetch, structuredQuery);
  return docs.map((r) => {
    const f = r.document.fields || {};
    const str = (k) => fsStr(f, k);
    // Log first doc's raw fields once so we can see the exact field names
    if (r === docs[0]) {
      console.log("[firestoreQueryArticles] raw fields on first doc:", Object.keys(f));
      console.log("[firestoreQueryArticles] coverImage field raw:", f.coverImage);
      console.log("[firestoreQueryArticles] image field raw:", f.image);
    }
    return {
      id: r.document.name.split("/").pop(),
      title: str("title"),
      authorName: str("authorName"),
      author: str("author"),
      coverImage: str("coverImage"),
      image: str("image"),
      slug: str("slug"),
      category: str("category"),
      deck: str("deck"),
      excerpt: str("excerpt"),
    };
  });
}

async function firestoreWrite(authedFetch, path, fields) {
  const res = await authedFetch(
    `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT}/databases/(default)/documents/${path}`,
    { method: "PATCH", body: JSON.stringify({ fields: toFsFields(fields) }) }
  );
  if (!res.ok) throw new Error(`Firestore write failed ${res.status}: ${await res.text()}`);
  return res.json();
}

async function firestoreAdd(authedFetch, collection, fields) {
  const res = await authedFetch(
    `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT}/databases/(default)/documents/${collection}`,
    { method: "POST", body: JSON.stringify({ fields: toFsFields(fields) }) }
  );
  if (!res.ok) throw new Error(`Firestore add failed ${res.status}: ${await res.text()}`);
  const doc = await res.json();
  return doc.name ? doc.name.split("/").pop() : null;
}

// ── Canvas image generator ──────────────────────────────────────────────────
// Produces a 1080×1080 PNG matching the style in the example:
//   - Full-bleed cover photo
//   - Dark gradient over bottom ~45%
//   - Bold white title text (wrapped)
//   - "New Article" badge pill top-left with logo icon

function loadImage(src) {
  // data: URLs load directly — no proxy needed.
  if (src.startsWith("data:")) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = (e) => reject(new Error(`Failed to load data URL`));
      img.src = src;
    });
  }

  // All external URLs first go through the server-side proxy (adds CORS headers).
  // If the proxy itself 404s or errors (e.g. host not in allowlist), we
  // fall back to a direct crossOrigin load — works if the image host already
  // sends permissive CORS headers (Wikimedia, Firebase Storage, etc.).
  const proxySrc = `/api/image-proxy?url=${encodeURIComponent(src)}`;

  function tryLoad(url, label) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = (e) => {
        console.warn(`[loadImage] ${label} failed:`, url.slice(0, 120));
        reject(e);
      };
      img.src = url;
    });
  }

  console.log("[loadImage] via proxy →", proxySrc.slice(0, 120));
  return tryLoad(proxySrc, "proxy").catch(() => {
    console.log("[loadImage] proxy failed, trying direct →", src.slice(0, 120));
    return tryLoad(src, "direct");
  });
}

function wrapText(ctx, text, x, maxWidth, lineHeight) {
  const words = text.split(" ");
  const lines = [];
  let line = "";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

async function generatePostImage(title, coverImageUrl, titleStyle = "bold", imageScale = 1) {
  const SIZE = 1080;
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d");

  // ── Cover photo ────────────────────────────────────────────────────────────
  // Dark base — always painted first so we have a fallback.
  ctx.fillStyle = "#0b1520";
  ctx.fillRect(0, 0, SIZE, SIZE);

  let coverImg = null;
  if (coverImageUrl) {
    let src = coverImageUrl;
    try {
      const u = new URL(coverImageUrl);
      if (u.hostname.includes("static.wixstatic.com")) {
        // Request highest-res JPEG from Wix CDN — 2160px wide so it's crisp on retina
        const v1 = u.pathname.indexOf("/v1/");
        const assetPath = v1 >= 0 ? u.pathname.slice(0, v1) : u.pathname;
        const fname = assetPath.split("/").filter(Boolean).pop();
        src = `${u.origin}${assetPath}/v1/fill/w_2160,h_2160,al_c,q_95,usm_0.33_1.00_0.00,enc_jpg/${fname}`;
      }
      // Firebase Storage URLs are already full-resolution — use as-is
    } catch { /* not a parseable URL */ }

    try {
      coverImg = await loadImage(src);
      console.log("[generatePostImage] cover loaded:", coverImg.naturalWidth, "×", coverImg.naturalHeight);
    } catch (err) {
      console.warn("[generatePostImage] cover failed:", err.message);
    }
  }

  // ── Figure out title metrics early — we need them to size the gradient ──────
  // "New Article" badge bottom edge = 36 (badgeY) + 82 (badgeH) = 118px.
  // We shrink the font until the title block top sits at least 174px from the
  // canvas top — safely below the badge — so text never overlaps it.
  const BADGE_BOTTOM = 36 + 100; // 136 px — matches badgeY + badgeH
  const pad = 54;
  const maxW = SIZE - pad * 2;
  // Title lives in the bottom ~26% of the canvas — image gets the rest
  const bottomPad = 56;
  const TEXT_ZONE_H = SIZE * 0.26; // ~281px reserved for text at the bottom

  const isElegant = titleStyle === "elegant";
  const titleFont = isElegant
    ? (sz) => `italic 400 ${sz}px "Source Serif 4", Georgia, "Times New Roman", serif`
    : (sz) => `900 ${sz}px "Inter", "Helvetica Neue", Arial, sans-serif`;

  // Start at 52px and shrink until text fits in TEXT_ZONE_H
  let fontSize = isElegant ? 54 : 52;
  let lines;
  while (true) { // eslint-disable-line no-constant-condition
    ctx.font = titleFont(fontSize);
    lines = wrapText(ctx, title, pad, maxW, fontSize * 1.15);
    const lh = fontSize * (isElegant ? 1.32 : 1.22);
    const bh = lines.length * lh + (isElegant ? 40 : 0); // rule + sub-label space
    if (bh <= TEXT_ZONE_H - bottomPad || fontSize <= 28) break;
    fontSize -= 2;
  }

  const lineH  = fontSize * (isElegant ? 1.32 : 1.22);
  const blockH = lines.length * lineH;
  // Text block anchored to the bottom; titleTop is where text starts
  const titleTop = SIZE - bottomPad - blockH - (isElegant ? 40 : 0);

  // ── Draw cover image ────────────────────────────────────────────────────────
  if (coverImg) {
    const iw = coverImg.naturalWidth, ih = coverImg.naturalHeight;

    // ── Blurred backdrop via downsample-then-upsample (no filter API needed) ──
    // Draw image into a 32×32 canvas — the tiny size acts as a strong blur kernel.
    // Then stretch that pixelated thumbnail back to full SIZE with imageSmoothingQuality
    // "high" which interpolates it into a soft bokeh-like blur.
    const THUMB = 32;
    const thumbCanvas = document.createElement("canvas");
    thumbCanvas.width = THUMB;
    thumbCanvas.height = THUMB;
    const tctx = thumbCanvas.getContext("2d");
    tctx.imageSmoothingEnabled = true;
    tctx.imageSmoothingQuality = "high";
    const tScale = Math.max(THUMB / iw, THUMB / ih);
    const tw = iw * tScale, th = ih * tScale;
    tctx.drawImage(coverImg, (THUMB - tw) / 2, (THUMB - th) / 2, tw, th);

    // Scale the thumbnail back up to canvas size — this gives a smooth blur effect
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(thumbCanvas, 0, 0, SIZE, SIZE);

    // Heavy dark overlay so the bg reads as a dark, moody blurred field — not a photo
    ctx.fillStyle = "rgba(0,0,0,0.70)";
    ctx.fillRect(0, 0, SIZE, SIZE);

    // ── Sharp image card in the safe zone (badge → title) ───────────────────
    const margin     = SIZE * 0.07;
    const maxImgW    = SIZE - margin * 2;
    const imgZoneTop = BADGE_BOTTOM + 24;
    const imgZoneBot = titleTop - 24;
    const zoneH      = Math.max(140, imgZoneBot - imgZoneTop);
    const fitScale   = Math.min(maxImgW / iw, zoneH / ih) * imageScale;
    const fw = iw * fitScale, fh = ih * fitScale;
    const fx = (SIZE - fw) / 2;
    const fy = imgZoneTop + (zoneH - fh) / 2;
    const r = 20;

    // Drop shadow behind the card
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.7)";
    ctx.shadowBlur = 60;
    ctx.shadowOffsetY = 16;
    ctx.fillStyle = "rgba(0,0,0,0.01)";
    ctx.beginPath();
    ctx.roundRect(fx, fy, fw, fh, r);
    ctx.fill();
    ctx.restore();

    // Sharp photo clipped to rounded rect
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(fx, fy, fw, fh, r);
    ctx.clip();
    ctx.drawImage(coverImg, fx, fy, fw, fh);
    ctx.restore();

    // Glossy top-edge sheen
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(fx, fy, fw, fh, r);
    ctx.clip();
    const gloss = ctx.createLinearGradient(0, fy, 0, fy + fh * 0.4);
    gloss.addColorStop(0, "rgba(255,255,255,0.14)");
    gloss.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gloss;
    ctx.fillRect(fx, fy, fw, fh);
    ctx.restore();

    // Thin white border
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.roundRect(fx, fy, fw, fh, r);
    ctx.stroke();
    ctx.restore();
  } else {
    // No cover — deep dark gradient with a blue accent glow
    const fbGrad = ctx.createLinearGradient(0, 0, SIZE, SIZE);
    fbGrad.addColorStop(0,   "#0d1f38");
    fbGrad.addColorStop(0.5, "#131c30");
    fbGrad.addColorStop(1,   "#0b1520");
    ctx.fillStyle = fbGrad;
    ctx.fillRect(0, 0, SIZE, SIZE);
    const accentGrad = ctx.createRadialGradient(SIZE * 0.78, SIZE * 0.22, 0, SIZE * 0.78, SIZE * 0.22, SIZE * 0.55);
    accentGrad.addColorStop(0, "rgba(80,120,220,0.18)");
    accentGrad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = accentGrad;
    ctx.fillRect(0, 0, SIZE, SIZE);
  }

  // ── Bottom gradient overlay — expands to cover the whole title block ────────
  // Gradient starts just above the text zone — always covers bottom ~28%
  const gradStart = Math.min(titleTop - 40, SIZE * 0.72);
  const gradH = SIZE - gradStart;
  const grad = ctx.createLinearGradient(0, gradStart, 0, SIZE);
  grad.addColorStop(0,    "rgba(0,0,0,0)");
  grad.addColorStop(0.28, "rgba(0,0,0,0.7)");
  grad.addColorStop(1,    "rgba(0,0,0,0.97)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, gradStart, SIZE, gradH);

  // ── Title text ─────────────────────────────────────────────────────────────
  ctx.textBaseline = "alphabetic";
  ctx.font = titleFont(fontSize);

  if (isElegant) {
    // ── Elegant editorial style ────────────────────────────────────────────
    // Thin accent rule above the title — spans the width of the longest line
    const ruleY = titleTop - 20;
    const ruleW = Math.max(...lines.map((l) => ctx.measureText(l).width));
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.82)";
    ctx.lineWidth   = 3;
    ctx.beginPath();
    ctx.moveTo(pad, ruleY);
    ctx.lineTo(pad + ruleW, ruleY);
    ctx.stroke();
    ctx.restore();

    // Title lines — warm white, generous letter spacing, soft shadow
    ctx.fillStyle = "#f5f0ea";
    ctx.shadowColor = "rgba(0,0,0,0.85)";
    ctx.shadowBlur = 24;
    ctx.letterSpacing = "0.01em";
    let ty = titleTop + lineH * 0.82;
    for (const line of lines) {
      ctx.fillText(line, pad, ty);
      ty += lineH;
    }
    ctx.shadowBlur = 0;

    // "The Catalyst" sub-label below the title — small caps style
    const subY = titleTop + blockH + 28;
    ctx.save();
    ctx.font = `600 22px "Inter", "Helvetica Neue", Arial, sans-serif`;
    ctx.fillStyle = "rgba(255,255,255,0.52)";
    ctx.letterSpacing = "0.18em";
    ctx.fillText("THE CATALYST", pad, subY);
    ctx.restore();
  } else {
    // ── Bold default style ─────────────────────────────────────────────────
    let ty = SIZE - bottomPad - blockH + lineH * 0.82;
    ctx.fillStyle = "#ffffff";
    ctx.shadowColor = "rgba(0,0,0,0.7)";
    ctx.shadowBlur = 16;
    for (const line of lines) {
      ctx.fillText(line, pad, ty);
      ty += lineH;
    }
    ctx.shadowBlur = 0;
  }

  // ── "New Article" badge (top-left) ─────────────────────────────────────────
  // Load the 1024×1024 glass logo — draw it at high res then downscale for crispness
  let logoImg = null;
  try {
    logoImg = await new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = rej;
      img.src = "/NewGlassLogo.png";
    });
  } catch { /* badge renders without icon */ }

  const badgeX = 36, badgeY = 36;
  const badgeH = 100;
  const badgeR = badgeH / 2;
  const iconSize = 78;
  const labelSize = 33;
  const textLabel = "New Article";

  ctx.font = `700 ${labelSize}px "Inter", "Helvetica Neue", Arial, sans-serif`;
  const labelW = ctx.measureText(textLabel).width;
  const gap = 14;
  const innerPad = 22;
  const badgeW = innerPad + (logoImg ? iconSize + gap : 0) + labelW + innerPad;

  // Frosted-glass pill background
  ctx.fillStyle = "rgba(10,16,30,0.82)";
  ctx.beginPath();
  ctx.roundRect(badgeX, badgeY, badgeW, badgeH, badgeR);
  ctx.fill();

  // Subtle white border
  ctx.strokeStyle = "rgba(255,255,255,0.28)";
  ctx.lineWidth = 2;
  ctx.stroke();

  // Logo icon — draw at natural resolution into a high-res offscreen canvas first
  // so it stays sharp when downscaled onto the 1080 canvas
  let textStartX = badgeX + innerPad;
  if (logoImg) {
    const iconX = badgeX + innerPad;
    const iconY = badgeY + (badgeH - iconSize) / 2;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(logoImg, iconX, iconY, iconSize, iconSize);
    textStartX = iconX + iconSize + gap;
  }

  ctx.fillStyle = "#ffffff";
  ctx.textBaseline = "middle";
  ctx.shadowBlur = 0;
  ctx.font = `700 ${labelSize}px "Inter", "Helvetica Neue", Arial, sans-serif`;
  ctx.fillText(textLabel, textStartX, badgeY + badgeH / 2);

  return canvas.toDataURL("image/png");
}

async function mountSocialPosts(ctx, container) {
  // ── Page shell ─────────────────────────────────────────────────────────────
  container.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px;">
      <div>
        <h2 style="font-size:18px;font-weight:700;margin:0;">Social media posts</h2>
        <p style="font-size:13px;color:var(--muted);margin:4px 0 0;">Generate cover images and captions for Instagram &amp; LinkedIn.</p>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <select class="input select" id="sp-platform-filter" style="width:150px;">
          <option value="">All platforms</option>
          <option value="instagram">📸 Instagram</option>
          <option value="linkedin">💼 LinkedIn</option>
          <option value="twitter">🐦 Twitter</option>
          <option value="facebook">📘 Facebook</option>
        </select>
        <select class="input select" id="sp-status-filter" style="width:140px;">
          <option value="">All statuses</option>
          <option value="proposed">Proposed</option>
          <option value="approved">Approved</option>
          <option value="assigned">Assigned</option>
          <option value="posted">Posted</option>
        </select>
        <button class="btn btn-primary btn-sm" id="sp-generate-btn">✦ Generate post image</button>
      </div>
    </div>
    <div id="sp-list"><div class="loading-state"><div class="spinner"></div>Loading…</div></div>`;

  // ── Modals appended to body so they cover the full viewport ────────────────
  const detailModal = document.createElement("div");
  detailModal.className = "modal-backdrop";
  detailModal.id = "sp-detail-modal";
  detailModal.style.cssText = "display:none;";
  detailModal.innerHTML = `
    <div class="modal" style="width:min(680px,92vw);max-height:90vh;">
      <div class="modal-header">
        <div class="modal-title" id="sp-detail-title">Post</div>
        <button class="btn btn-ghost btn-sm" id="sp-detail-close" style="margin-left:auto;">✕</button>
      </div>
      <div class="modal-body" id="sp-detail-body"></div>
      <div class="modal-footer" id="sp-detail-footer" style="flex-wrap:wrap;gap:8px;"></div>
    </div>`;
  document.body.appendChild(detailModal);

  const generateModal = document.createElement("div");
  generateModal.className = "modal-backdrop";
  generateModal.id = "sp-generate-modal";
  generateModal.style.cssText = "display:none;";
  generateModal.innerHTML = `
    <div class="modal" style="width:min(860px,95vw);max-height:95vh;">
      <div class="modal-header">
        <div class="modal-title">Generate post image</div>
        <button class="btn btn-ghost btn-sm" id="sp-gen-close" style="margin-left:auto;">✕</button>
      </div>
      <div class="modal-body">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:28px;align-items:start;">

          <!-- Left: controls -->
          <div style="display:flex;flex-direction:column;gap:16px;">
            <label style="font-size:13px;font-weight:600;">Select published article
              <select class="input select" id="sp-gen-article" style="margin-top:6px;width:100%;">
                <option value="">Loading articles…</option>
              </select>
            </label>

            <label style="font-size:13px;font-weight:600;">Platform
              <select class="input select" id="sp-gen-platform" style="margin-top:6px;width:100%;">
                <option value="instagram">📸 Instagram</option>
                <option value="linkedin">💼 LinkedIn</option>
              </select>
            </label>

            <label style="font-size:13px;font-weight:600;">Title style
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px;" id="sp-gen-style-picker">
                <label style="cursor:pointer;">
                  <input type="radio" name="sp-gen-style" value="bold" checked style="display:none;">
                  <div class="sp-style-card" data-val="bold" style="border:2px solid var(--accent);border-radius:10px;padding:10px 12px;background:var(--surface-2);transition:all .15s;">
                    <div style="font-size:15px;font-weight:900;font-family:'Inter','Helvetica Neue',Arial,sans-serif;color:var(--ink);line-height:1.15;letter-spacing:-.01em;">Bold<br><span style="font-size:11px;font-weight:500;color:var(--muted);">Strong & punchy</span></div>
                  </div>
                </label>
                <label style="cursor:pointer;">
                  <input type="radio" name="sp-gen-style" value="elegant" style="display:none;">
                  <div class="sp-style-card" data-val="elegant" style="border:2px solid var(--border);border-radius:10px;padding:10px 12px;background:var(--surface-2);transition:all .15s;">
                    <div style="font-size:15px;font-weight:400;font-style:italic;font-family:'Source Serif 4','Georgia',serif;color:var(--ink);line-height:1.2;letter-spacing:.01em;">Elegant<br><span style="font-size:11px;font-weight:500;font-style:normal;font-family:'Inter',sans-serif;color:var(--muted);">Editorial serif</span></div>
                  </div>
                </label>
              </div>
            </label>

            <div>
              <div style="font-size:13px;font-weight:600;margin-bottom:6px;">Cover image</div>
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                <div id="sp-gen-img-name" style="font-size:12px;color:var(--muted);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">Using article cover image</div>
                <button class="btn btn-secondary btn-xs" id="sp-gen-img-btn">Replace image</button>
                <button class="btn btn-ghost btn-xs" id="sp-gen-img-clear" style="display:none;">✕ Reset</button>
              </div>
              <input type="file" id="sp-gen-img-file" accept="image/*" style="display:none;">
            </div>

            <div>
              <div style="font-size:13px;font-weight:600;margin-bottom:8px;">Image size <span id="sp-gen-scale-val" style="font-weight:400;color:var(--muted);">100%</span></div>
              <input type="range" id="sp-gen-scale" min="50" max="130" value="100" step="5"
                style="width:100%;accent-color:var(--accent);cursor:pointer;">
            </div>

            <label style="font-size:13px;font-weight:600;">Caption
              <textarea class="input textarea" id="sp-gen-caption" rows="7"
                style="margin-top:6px;width:100%;min-height:140px;font-size:13px;"></textarea>
              <span style="font-size:12px;color:var(--muted);" id="sp-gen-char">0 characters</span>
            </label>

            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              <button class="btn btn-secondary btn-sm" id="sp-gen-preview-btn">Preview image</button>
              <button class="btn btn-primary btn-sm" id="sp-gen-download-btn" disabled>Download image</button>
            </div>
            <button class="btn btn-accent btn-sm" id="sp-gen-save-btn" disabled>Save draft to board</button>
          </div>

          <!-- Right: canvas preview -->
          <div style="display:flex;flex-direction:column;gap:10px;">
            <div style="font-size:12px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;">Preview</div>
            <div id="sp-gen-preview-wrap" style="width:100%;aspect-ratio:1;background:var(--surface-3);border-radius:12px;border:1px solid var(--border);overflow:hidden;display:flex;align-items:center;justify-content:center;">
              <span style="color:var(--muted);font-size:13px;">Select an article and click Preview</span>
            </div>
            <div id="sp-gen-status" style="font-size:12px;color:var(--muted);min-height:18px;"></div>
          </div>

        </div>
      </div>
    </div>`;
  document.body.appendChild(generateModal);

  // ── Cleanup: remove body-level modals when module unmounts ─────────────────
  const cleanup = () => {
    detailModal.remove();
    generateModal.remove();
  };

  // ── State ──────────────────────────────────────────────────────────────────
  let allPosts = [];
  let publishedArticles = [];
  let generatedDataUrl = null;
  let selectedArticle = null;
  let customImageDataUrl = null; // set when user uploads a replacement image

  const listEl = container.querySelector("#sp-list");
  const platformFilter = container.querySelector("#sp-platform-filter");
  const statusFilter = container.querySelector("#sp-status-filter");

  // ── Render post list ───────────────────────────────────────────────────────
  function render() {
    const pf = platformFilter.value;
    const sf = statusFilter.value;
    const posts = allPosts.filter((p) => (!pf || p.platform === pf) && (!sf || p.status === sf));

    if (!posts.length) {
      listEl.innerHTML = `<div class="empty-state">No posts yet. Click "Generate post image" to create your first one.</div>`;
      return;
    }

    listEl.innerHTML = posts.map((p) => {
      const pm = PLATFORM_META[p.platform] || { label: p.platform, icon: "📱", pill: "pill-draft" };
      const sp = STATUS_PILL[p.status] || "pill-draft";
      const preview = (p.content || "").slice(0, 130) + ((p.content || "").length > 130 ? "…" : "");
      return `
        <div class="card" style="margin-bottom:12px;cursor:pointer;" data-id="${esc(p.id)}">
          <div class="card-body" style="display:flex;gap:16px;align-items:flex-start;">
            <div style="font-size:28px;line-height:1;flex-shrink:0;">${pm.icon}</div>
            <div style="flex:1;min-width:0;">
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px;">
                <strong style="font-size:14px;">${esc(p.title)}</strong>
                <span class="pill ${pm.pill}" style="font-size:11px;">${esc(pm.label)}</span>
                <span class="pill ${sp}" style="font-size:11px;">${esc(p.status)}</span>
              </div>
              ${preview ? `<div style="font-size:13px;color:var(--ink-2);white-space:pre-line;margin-bottom:6px;">${esc(preview)}</div>` : ""}
              <div style="font-size:12px;color:var(--muted);">
                By ${esc(p.proposerName || "—")}
                ${p.deadline ? ` · Due ${esc(p.deadline)}` : ""}
                ${p.createdAt ? ` · ${fmtRelative(p.createdAt)}` : ""}
              </div>
            </div>
          </div>
        </div>`;
    }).join("");

    listEl.querySelectorAll("[data-id]").forEach((card) =>
      card.addEventListener("click", () => openDetail(allPosts.find((p) => p.id === card.dataset.id)))
    );
  }

  // ── Load posts ─────────────────────────────────────────────────────────────
  async function loadPosts() {
    listEl.innerHTML = `<div class="loading-state"><div class="spinner"></div>Loading…</div>`;
    try {
      allPosts = await firestoreQuery(ctx.authedFetch, {
        from: [{ collectionId: "social_posts" }],
        orderBy: [{ field: { fieldPath: "createdAt" }, direction: "DESCENDING" }],
        limit: 200,
      });
      render();
    } catch (err) {
      listEl.innerHTML = `<div class="error-state">Could not load posts: ${esc(err.message)}</div>`;
    }
  }

  // ── Load published articles for the generator dropdown ─────────────────────
  async function loadArticles() {
    try {
      publishedArticles = await firestoreQueryArticles(ctx.authedFetch, {
        from: [{ collectionId: "stories" }],
        where: { fieldFilter: { field: { fieldPath: "status" }, op: "EQUAL", value: { stringValue: "published" } } },
        orderBy: [{ field: { fieldPath: "publishedAt" }, direction: "DESCENDING" }],
        limit: 60,
      });
      console.log("[loadArticles] loaded", publishedArticles.length, "articles. First article coverImage:", publishedArticles[0]?.coverImage, "image:", publishedArticles[0]?.image);
    } catch (err) {
      console.error("[loadArticles] error:", err);
      publishedArticles = [];
    }
  }

  // ── Detail modal ───────────────────────────────────────────────────────────
  const closeDetail = () => { detailModal.style.display = "none"; };
  detailModal.querySelector("#sp-detail-close").addEventListener("click", closeDetail);
  detailModal.addEventListener("click", (e) => { if (e.target === detailModal) closeDetail(); });

  function openDetail(p) {
    if (!p) return;
    const pm = PLATFORM_META[p.platform] || { label: p.platform, icon: "📱", pill: "pill-draft" };
    const sp = STATUS_PILL[p.status] || "pill-draft";
    detailModal.querySelector("#sp-detail-title").textContent = p.title || "Post";

    detailModal.querySelector("#sp-detail-body").innerHTML = `
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px;">
        <span class="pill ${pm.pill}">${pm.icon} ${esc(pm.label)}</span>
        <span class="pill ${sp}">${esc(p.status)}</span>
        ${p.deadline ? `<span class="pill pill-draft">Due ${esc(p.deadline)}</span>` : ""}
      </div>
      <div style="margin-bottom:16px;">
        <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.07em;margin-bottom:6px;">Caption</div>
        <pre style="white-space:pre-wrap;font-family:inherit;font-size:14px;background:var(--surface-2);border-radius:8px;padding:14px;margin:0;border:1px solid var(--border);max-height:260px;overflow-y:auto;">${esc(p.content || "—")}</pre>
      </div>
      ${p.notes ? `
      <div style="margin-bottom:16px;">
        <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.07em;margin-bottom:6px;">Notes</div>
        <pre style="white-space:pre-wrap;font-family:inherit;font-size:13px;color:var(--ink-2);background:var(--surface-2);border-radius:8px;padding:12px;margin:0;border:1px solid var(--border);">${esc(p.notes)}</pre>
      </div>` : ""}
      <div style="font-size:12px;color:var(--muted);">By <strong>${esc(p.proposerName || "—")}</strong>${p.createdAt ? ` · ${fmtRelative(p.createdAt)}` : ""}</div>`;

    const footer = detailModal.querySelector("#sp-detail-footer");
    footer.innerHTML = "";

    const copyBtn = el("button", { class: "btn btn-secondary btn-sm" });
    copyBtn.textContent = "Copy caption";
    copyBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(p.content || "").then(() => {
        copyBtn.textContent = "Copied!";
        setTimeout(() => { copyBtn.textContent = "Copy caption"; }, 2000);
      });
    });
    footer.appendChild(copyBtn);

    if (["admin", "editor"].includes(ctx.role)) {
      const transitions = { proposed: "approved", approved: "assigned", assigned: "posted" };
      const labels = { proposed: "Approve", approved: "Mark assigned", assigned: "Mark posted ✓" };
      if (transitions[p.status]) {
        const btn = el("button", { class: "btn btn-primary btn-sm" });
        btn.textContent = labels[p.status];
        btn.addEventListener("click", async () => {
          btn.disabled = true;
          try {
            await firestoreWrite(ctx.authedFetch, `social_posts/${p.id}`, { status: transitions[p.status] });
            ctx.toast(`Marked as ${transitions[p.status]}`, "success");
            closeDetail();
            await loadPosts();
          } catch (err) { ctx.toast("Failed: " + err.message, "error"); }
        });
        footer.appendChild(btn);
      }
    }

    detailModal.style.display = "grid";
  }

  // ── Generate modal ─────────────────────────────────────────────────────────
  const closeGenerate = () => { generateModal.style.display = "none"; generatedDataUrl = null; customImageDataUrl = null; };
  generateModal.querySelector("#sp-gen-close").addEventListener("click", closeGenerate);
  generateModal.addEventListener("click", (e) => { if (e.target === generateModal) closeGenerate(); });

  const articleSelect = generateModal.querySelector("#sp-gen-article");
  const platformSelect = generateModal.querySelector("#sp-gen-platform");
  const captionArea = generateModal.querySelector("#sp-gen-caption");
  const charEl = generateModal.querySelector("#sp-gen-char");
  const previewWrap = generateModal.querySelector("#sp-gen-preview-wrap");
  const statusEl = generateModal.querySelector("#sp-gen-status");
  const previewBtn = generateModal.querySelector("#sp-gen-preview-btn");
  const downloadBtn = generateModal.querySelector("#sp-gen-download-btn");
  const saveBtn = generateModal.querySelector("#sp-gen-save-btn");

  // ── Image size slider ───────────────────────────────────────────────────────
  const scaleSlider = generateModal.querySelector("#sp-gen-scale");
  const scaleValEl  = generateModal.querySelector("#sp-gen-scale-val");
  const getImageScale = () => parseInt(scaleSlider.value, 10) / 100;
  scaleSlider.addEventListener("input", () => {
    scaleValEl.textContent = `${scaleSlider.value}%`;
    // Reset preview so user regenerates with new size
    generatedDataUrl = null;
    downloadBtn.disabled = true;
    saveBtn.disabled = true;
    previewWrap.innerHTML = `<span style="color:var(--muted);font-size:13px;">Size changed — click Preview to regenerate</span>`;
    statusEl.textContent = "";
  });

  // ── Style picker ────────────────────────────────────────────────────────────
  const styleCards = generateModal.querySelectorAll(".sp-style-card");
  const getSelectedStyle = () => {
    const checked = generateModal.querySelector("input[name='sp-gen-style']:checked");
    return checked ? checked.value : "bold";
  };
  const updateStyleCards = () => {
    styleCards.forEach((card) => {
      const radio = card.closest("label").querySelector("input[type=radio]");
      card.style.borderColor = radio.checked ? "var(--accent)" : "var(--border)";
      card.style.background  = radio.checked ? "var(--surface-3)" : "var(--surface-2)";
    });
  };
  generateModal.querySelectorAll("input[name='sp-gen-style']").forEach((radio) => {
    radio.addEventListener("change", () => {
      updateStyleCards();
      // Reset preview so user re-generates with new style
      generatedDataUrl = null;
      downloadBtn.disabled = true;
      saveBtn.disabled = true;
      previewWrap.innerHTML = `<span style="color:var(--muted);font-size:13px;">Style changed — click Preview to regenerate</span>`;
      statusEl.textContent = "";
    });
  });
  // Clicking the card div itself toggles the hidden radio
  styleCards.forEach((card) => {
    card.addEventListener("click", () => {
      const radio = card.closest("label").querySelector("input[type=radio]");
      radio.checked = true;
      radio.dispatchEvent(new Event("change", { bubbles: true }));
    });
  });

  captionArea.addEventListener("input", () => { charEl.textContent = `${captionArea.value.length} characters`; });

  // ── Custom image picker ────────────────────────────────────────────────────
  const imgFileInput = generateModal.querySelector("#sp-gen-img-file");
  const imgBtn = generateModal.querySelector("#sp-gen-img-btn");
  const imgClearBtn = generateModal.querySelector("#sp-gen-img-clear");
  const imgNameEl = generateModal.querySelector("#sp-gen-img-name");

  imgBtn.addEventListener("click", () => imgFileInput.click());

  imgFileInput.addEventListener("change", () => {
    const file = imgFileInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      customImageDataUrl = e.target.result;
      imgNameEl.textContent = file.name;
      imgClearBtn.style.display = "";
      // Reset any existing preview so user knows they need to re-generate
      generatedDataUrl = null;
      downloadBtn.disabled = true;
      saveBtn.disabled = true;
      previewWrap.innerHTML = `<span style="color:var(--muted);font-size:13px;">Image replaced — click Preview to regenerate</span>`;
      statusEl.textContent = "";
    };
    reader.readAsDataURL(file);
  });

  imgClearBtn.addEventListener("click", () => {
    customImageDataUrl = null;
    imgFileInput.value = "";
    imgNameEl.textContent = "Using article cover image";
    imgClearBtn.style.display = "none";
    generatedDataUrl = null;
    downloadBtn.disabled = true;
    saveBtn.disabled = true;
    previewWrap.innerHTML = `<span style="color:var(--muted);font-size:13px;">Click "Preview image" to regenerate</span>`;
    statusEl.textContent = "";
  });

  function buildCaption(article, platform) {
    const rawAuthor = (article.authorName || article.author || "").trim();
    // Format: "Aidan Brown from The Catalyst" — but if the stored value IS
    // already "The Catalyst" or is empty, fall back gracefully.
    const isCatalystPlaceholder = !rawAuthor || rawAuthor.toLowerCase() === "the catalyst";
    const authorCredit = isCatalystPlaceholder
      ? "The Catalyst team"
      : `${rawAuthor} from The Catalyst`;
    const deck = article.deck || article.excerpt || "";
    const slug = article.slug || "";
    const category = article.category || "Feature";
    const tag = `#${category.replace(/\s+/g, "")}`;
    const url = slug ? `https://www.catalyst-magazine.com/article/${slug}` : "https://www.catalyst-magazine.com";
    if (platform === "linkedin") {
      return `We just published a new article on The Catalyst Magazine!\n\n"${article.title}"\n\n${deck ? deck + "\n\n" : ""}Big shoutout to ${authorCredit} for writing this piece. Read it here:\n${url}\n\n#TheCatalyst #STEMJournalism #ScienceWriting #CatalystMagazine ${tag}`;
    }
    return `"${article.title}"\n\n${deck ? deck + "\n\n" : ""}Written by ${authorCredit} — link in bio to read the full article!\n\n${tag} #TheCatalyst #STEMJournalism #ScienceWriting #CatalystMagazine`;
  }

  function populateArticleDropdown() {
    articleSelect.innerHTML = publishedArticles.length
      ? `<option value="">Select an article…</option>` + publishedArticles.map((a, i) =>
          `<option value="${i}">${esc(a.title)}</option>`).join("")
      : `<option value="">No published articles found</option>`;
  }

  function onArticleOrPlatformChange() {
    const idx = articleSelect.value;
    if (idx === "") { selectedArticle = null; return; }
    selectedArticle = publishedArticles[parseInt(idx, 10)];
    captionArea.value = buildCaption(selectedArticle, platformSelect.value);
    charEl.textContent = `${captionArea.value.length} characters`;
    // Reset preview + custom image when article changes
    generatedDataUrl = null;
    customImageDataUrl = null;
    imgFileInput.value = "";
    imgNameEl.textContent = "Using article cover image";
    imgClearBtn.style.display = "none";
    downloadBtn.disabled = true;
    saveBtn.disabled = true;
    previewWrap.innerHTML = `<span style="color:var(--muted);font-size:13px;">Click "Preview image" to generate</span>`;
    statusEl.textContent = "";
  }

  articleSelect.addEventListener("change", onArticleOrPlatformChange);
  platformSelect.addEventListener("change", () => {
    if (selectedArticle) {
      captionArea.value = buildCaption(selectedArticle, platformSelect.value);
      charEl.textContent = `${captionArea.value.length} characters`;
    }
  });

  previewBtn.addEventListener("click", async () => {
    if (!selectedArticle) { ctx.toast("Select an article first.", "error"); return; }
    previewBtn.disabled = true;
    previewBtn.textContent = "Generating…";
    statusEl.textContent = "Drawing image…";
    previewWrap.innerHTML = `<div class="spinner"></div>`;
    try {
      // Use uploaded custom image (data URL) or fall back to article cover URL
      const coverUrl = customImageDataUrl || selectedArticle.coverImage || selectedArticle.image || "";
      console.log("[Preview] article:", selectedArticle.title, "| coverUrl:", coverUrl);
      statusEl.textContent = coverUrl ? `Loading cover…` : "No cover image found — using gradient";
      generatedDataUrl = await generatePostImage(selectedArticle.title, coverUrl, getSelectedStyle(), getImageScale());
      const img = document.createElement("img");
      img.src = generatedDataUrl;
      img.style.cssText = "width:100%;height:100%;object-fit:cover;display:block;";
      previewWrap.innerHTML = "";
      previewWrap.appendChild(img);
      statusEl.textContent = coverUrl
        ? "1080 × 1080 px — ready to download"
        : "No cover image in Firestore — upload one manually or set it in the editor";
      downloadBtn.disabled = false;
      saveBtn.disabled = false;
    } catch (err) {
      previewWrap.innerHTML = `<span style="color:var(--danger);font-size:13px;">Error: ${esc(err.message)}</span>`;
      statusEl.textContent = "";
    } finally {
      previewBtn.disabled = false;
      previewBtn.textContent = "Preview image";
    }
  });

  downloadBtn.addEventListener("click", () => {
    if (!generatedDataUrl) return;
    const a = document.createElement("a");
    const slug = selectedArticle?.slug || "post";
    a.href = generatedDataUrl;
    a.download = `catalyst-${slug}-instagram.png`;
    a.click();
  });

  saveBtn.addEventListener("click", async () => {
    if (!selectedArticle || !generatedDataUrl) return;
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving…";
    const platform = platformSelect.value;
    const author = selectedArticle.authorName || selectedArticle.author || "The Catalyst";
    const slug = selectedArticle.slug || "";
    const coverUrl = selectedArticle.coverImage || selectedArticle.image || "";
    try {
      await firestoreAdd(ctx.authedFetch, "social_posts", {
        title: `${platform === "instagram" ? "Instagram" : "LinkedIn"}: ${selectedArticle.title}`,
        platform,
        content: captionArea.value,
        notes: platform === "instagram"
          ? `Cover image (square 1080×1080): ${coverUrl}\n\nDownload the generated PNG from the image generator.`
          : `Article URL: https://www.catalyst-magazine.com/article/${slug}\nAuthor: ${author}`,
        status: "proposed",
        proposerId: ctx.user.uid,
        proposerName: ctx.profile.name || ctx.user.email,
        assigneeId: null,
        assigneeName: null,
        deadline: new Date(Date.now() + 3 * 86400000).toISOString().split("T")[0],
        createdAt: new Date().toISOString(),
        activity: [{ text: "created via image generator", authorName: ctx.profile.name || ctx.user.email, timestamp: new Date().toISOString() }],
      });
      ctx.toast("Saved to social posts board!", "success");
      closeGenerate();
      await loadPosts();
    } catch (err) {
      ctx.toast("Failed to save: " + err.message, "error");
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = "Save draft to board";
    }
  });

  // ── Open generate modal ────────────────────────────────────────────────────
  container.querySelector("#sp-generate-btn").addEventListener("click", async () => {
    generatedDataUrl = null;
    customImageDataUrl = null;
    selectedArticle = null;
    articleSelect.value = "";
    platformSelect.value = "instagram";
    captionArea.value = "";
    charEl.textContent = "0 characters";
    imgFileInput.value = "";
    imgNameEl.textContent = "Using article cover image";
    imgClearBtn.style.display = "none";
    previewWrap.innerHTML = `<span style="color:var(--muted);font-size:13px;">Select an article and click Preview</span>`;
    statusEl.textContent = "";
    downloadBtn.disabled = true;
    saveBtn.disabled = true;
    // Reset style picker to bold
    const boldRadio = generateModal.querySelector("input[name='sp-gen-style'][value='bold']");
    if (boldRadio) { boldRadio.checked = true; updateStyleCards(); }
    scaleSlider.value = "100";
    scaleValEl.textContent = "100%";
    generateModal.style.display = "grid";

    if (!publishedArticles.length) {
      articleSelect.innerHTML = `<option value="">Loading…</option>`;
      await loadArticles();
      populateArticleDropdown();
    } else {
      populateArticleDropdown();
    }
  });

  // ── Filters ────────────────────────────────────────────────────────────────
  platformFilter.addEventListener("change", render);
  statusFilter.addEventListener("change", render);

  await loadPosts();
  return cleanup;
}
