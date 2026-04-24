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

// ─── Cover palette extraction ────────────────────────────────────────────────
// Loads a cover image, samples its pixels at low res, and returns a palette
// the AI prompt can reference. Result shape:
//   { dominant: "#rrggbb", accent: "#rrggbb", swatches: ["#…","#…",...] }
//
// `dominant` is the most common color (excluding near-black/white pixels —
// those are usually shadows/highlights, not the article's mood).
// `accent` is a saturated complementary color from the image.
// `swatches` is a list of 5-7 distinct colors from the image, useful as
// background suggestions.
async function extractCoverPalette(coverImageUrl) {
  if (!coverImageUrl) return null;
  let src = coverImageUrl;
  // Wix CDN: ask for a small thumbnail — palette extraction doesn't need
  // full res and a 200×200 download is ~25× faster.
  try {
    const u = new URL(coverImageUrl);
    if (u.hostname.includes("static.wixstatic.com")) {
      const v1 = u.pathname.indexOf("/v1/");
      const assetPath = v1 >= 0 ? u.pathname.slice(0, v1) : u.pathname;
      const fname = assetPath.split("/").filter(Boolean).pop();
      src = `${u.origin}${assetPath}/v1/fill/w_240,h_240,al_c,q_80,enc_jpg/${fname}`;
    }
  } catch { /* not a URL */ }

  let img;
  try {
    img = await loadImage(src);
  } catch {
    return null;
  }

  const SIZE = 80;
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  // cover-fit
  const iw = img.naturalWidth, ih = img.naturalHeight;
  const scale = Math.max(SIZE / iw, SIZE / ih);
  const dw = iw * scale, dh = ih * scale;
  ctx.drawImage(img, (SIZE - dw) / 2, (SIZE - dh) / 2, dw, dh);

  let pixels;
  try {
    pixels = ctx.getImageData(0, 0, SIZE, SIZE).data;
  } catch {
    // CORS-tainted canvas — image was loaded direct (not through proxy).
    // Without pixel access we can't extract; return null and AI uses defaults.
    return null;
  }

  // Bucket colors by reducing precision (5 bits per channel = 32 buckets/axis).
  // This collapses near-duplicates so we get meaningful counts.
  const buckets = new Map();
  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2], a = pixels[i + 3];
    if (a < 128) continue;
    // Skip near-pure-black, near-pure-white, and gray pixels — they don't
    // describe the image's mood.
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    if (max < 18 || min > 240) continue;
    const sat = max === 0 ? 0 : (max - min) / max;
    const isMostlyGray = sat < 0.08 && Math.abs(r - g) < 12 && Math.abs(g - b) < 12;
    if (isMostlyGray && max > 60 && max < 200) continue;
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    const cur = buckets.get(key);
    if (cur) {
      cur.count++;
      cur.r += r; cur.g += g; cur.b += b;
    } else {
      buckets.set(key, { count: 1, r, g, b });
    }
  }

  if (!buckets.size) return null;

  const ranked = [...buckets.values()]
    .map((b) => ({
      r: Math.round(b.r / b.count),
      g: Math.round(b.g / b.count),
      b: Math.round(b.b / b.count),
      count: b.count,
    }))
    .sort((a, b) => b.count - a.count);

  // Pick a diverse top-N: walk down the ranked list, accept a color only if
  // it's perceptually distinct (Δ > 70 in RGB) from anything we've already
  // accepted. Each pick absorbs the counts of nearby rejected buckets so the
  // share % accurately reflects how much of the image that color (and its
  // close neighbors) covers.
  const picks = [];
  for (const c of ranked) {
    const closest = picks.find((p) => {
      const dr = p.r - c.r, dg = p.g - c.g, db = p.b - c.b;
      return Math.sqrt(dr * dr + dg * dg + db * db) < 70;
    });
    if (closest) {
      // Roll this bucket's count into its closer neighbor in the picked set.
      closest.count += c.count;
    } else if (picks.length < 6) {
      picks.push({ ...c });
    } else {
      // Past 6 colors — still attribute counts to the closest pick so the
      // total percentage reflects all sampled pixels.
      let best = picks[0], bestDist = Infinity;
      for (const p of picks) {
        const dr = p.r - c.r, dg = p.g - c.g, db = p.b - c.b;
        const d = dr * dr + dg * dg + db * db;
        if (d < bestDist) { bestDist = d; best = p; }
      }
      best.count += c.count;
    }
  }
  if (!picks.length) picks.push(ranked[0]);

  const totalCount = picks.reduce((s, p) => s + p.count, 0) || 1;
  picks.sort((a, b) => b.count - a.count);

  const toHex = (c) =>
    "#" + [c.r, c.g, c.b].map((n) => n.toString(16).padStart(2, "0")).join("");

  // Find the most saturated color among the picks for the "accent".
  const withSat = picks.map((c) => {
    const max = Math.max(c.r, c.g, c.b), min = Math.min(c.r, c.g, c.b);
    return { ...c, sat: max === 0 ? 0 : (max - min) / max };
  });
  const accent = [...withSat].sort((a, b) => b.sat - a.sat)[0];

  const swatchesWithShare = picks.map((c) => ({
    hex: toHex(c),
    share: Math.round((c.count / totalCount) * 100),
  }));

  return {
    dominant: toHex(picks[0]),
    accent: toHex(accent),
    swatches: swatchesWithShare.map((s) => s.hex),         // back-compat: hex array
    swatchesWithShare,                                       // [{hex, share}, …]
  };
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

// Public dispatcher — picks the right renderer for the page's layout.
// `page` shape:
//   { layout: "cover"|"editorial"|"hook"|"quote"|"closing",
//     title, coverImageUrl, titleStyle, imageScale,   // cover
//     headline, body, bg, accent,                     // editorial / hook
//     cta,                                            // hook
//     quote, attribution,                             // quote
//     tagline                                         // closing
//   }
async function generatePostImage(page) {
  switch (page.layout) {
    case "editorial": return renderEditorial(page);
    case "hook":      return renderHook(page);
    case "quote":     return renderQuote(page);
    case "closing":   return renderClosing(page);
    case "cover":
    default:          return renderCover(page);
  }
}

// Logo loader — shared between renderers. Cached after first load.
let _cachedLogo = null;
async function loadLogo() {
  if (_cachedLogo !== null) return _cachedLogo;
  try {
    _cachedLogo = await new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = rej;
      img.src = "/NewGlassLogo.png";
    });
  } catch {
    _cachedLogo = false; // sentinel: tried and failed
  }
  return _cachedLogo;
}

async function renderCover({ title, coverImageUrl, titleStyle = "bold", imageScale = 1 }) {
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
        // Request the original asset at maximum quality from the Wix CDN.
        // 2160px (2× the 1080 canvas — crisp on retina) at q_100, with a
        // stronger unsharp mask so the downsample inside the canvas doesn't
        // soften the image. enc_jpg keeps universal browser-canvas support.
        const v1 = u.pathname.indexOf("/v1/");
        const assetPath = v1 >= 0 ? u.pathname.slice(0, v1) : u.pathname;
        const fname = assetPath.split("/").filter(Boolean).pop();
        src = `${u.origin}${assetPath}/v1/fill/w_2160,h_2160,al_c,q_100,usm_0.66_1.00_0.00,enc_jpg/${fname}`;
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

    // Sharp photo clipped to rounded rect — reaffirm high-quality smoothing
    // so the downsample from 2160 → ~900 stays crisp (canvas state can flip
    // smoothing back to "low" between save/restore on some browsers).
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(fx, fy, fw, fh, r);
    ctx.clip();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
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
  const cachedLogo = await loadLogo();
  const logoImg = cachedLogo || null;

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

// ─── Shared helpers for typography pages ─────────────────────────────────────
//
// Lighten/darken a hex color — used to build the subtle gradient on solid-color
// pages. Returns the input untouched on parse failure.
function shadeHex(hex, amount) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return hex;
  let n = parseInt(m[1], 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  r = Math.max(0, Math.min(255, r + amount));
  g = Math.max(0, Math.min(255, g + amount));
  b = Math.max(0, Math.min(255, b + amount));
  return "#" + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}

// Paint a solid color background with a subtle vertical gradient so the page
// reads as designed rather than flat.
function paintColorBackground(ctx, SIZE, bg) {
  const top = shadeHex(bg, 14);
  const bot = shadeHex(bg, -22);
  const grad = ctx.createLinearGradient(0, 0, 0, SIZE);
  grad.addColorStop(0, top);
  grad.addColorStop(1, bot);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, SIZE, SIZE);
}

// Ensure Poppins is fully loaded into the browser font registry before we
// hand it to canvas — without this the very first render falls back to the
// browser's default sans-serif (canvas can't trigger font fetches itself).
let _poppinsReady = null;
function ensurePoppinsLoaded() {
  if (_poppinsReady) return _poppinsReady;
  if (!document.fonts || !document.fonts.load) {
    _poppinsReady = Promise.resolve();
    return _poppinsReady;
  }
  _poppinsReady = Promise.all([
    document.fonts.load(`900 32px "Poppins"`),
    document.fonts.load(`800 32px "Poppins"`),
  ]).catch(() => {});
  return _poppinsReady;
}

// Draw "THE CATALYST" wordmark — used as a footer on every non-cover,
// non-closing page so the carousel reads as one cohesive set. Defaults to
// the bottom-right corner with Poppins heavy bold. The color should be a
// soft tint of the page bg so it matches without competing with the copy.
async function drawCatalystWordmark(ctx, SIZE, opts = {}) {
  await ensurePoppinsLoaded();
  const {
    color = "rgba(255,255,255,0.55)",
    align = "right",
    bottomPad = 50,
    sidePad = 60,
    size = 26,
  } = opts;
  ctx.save();
  ctx.fillStyle = color;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = align;
  // Poppins 800 — heavy, modern. Tight letter-spacing via the canvas
  // letterSpacing CSS property (Chrome/Safari support it; Firefox falls back
  // to default tracking which still looks fine).
  ctx.font = `800 ${size}px "Poppins", "Inter", "Helvetica Neue", Arial, sans-serif`;
  if ("letterSpacing" in ctx) ctx.letterSpacing = "0.14em";
  const x = align === "right" ? SIZE - sidePad : sidePad;
  const y = SIZE - bottomPad;
  ctx.fillText("THE CATALYST", x, y);
  ctx.restore();
}

// Pick a wordmark color tuned to the page background — light/translucent
// white on dark bgs, dim near-black on light bgs.
function wordmarkColorFor(bg) {
  return readableInk(bg) === "#ffffff"
    ? "rgba(255,255,255,0.62)"
    : "rgba(10,20,36,0.55)";
}

// Legacy — kept for compatibility with existing call sites that still use
// the top-left logo+wordmark. New layouts use drawCatalystWordmark.
async function drawCornerMark(ctx, SIZE, opts = {}) {
  const { color = "rgba(255,255,255,0.92)", x = 36, y = 36, withLogo = true } = opts;
  const logo = await loadLogo();
  let cursorX = x;
  if (withLogo && logo) {
    const sz = 56;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(logo, cursorX, y, sz, sz);
    cursorX += sz + 12;
  }
  ctx.fillStyle = color;
  ctx.textBaseline = "middle";
  ctx.font = `700 24px "Inter", "Helvetica Neue", Arial, sans-serif`;
  ctx.fillText("THE CATALYST", cursorX, y + 28);
}

// Wrap text and shrink font until the block fits inside `maxHeight`. Returns
// { lines, fontSize, lineHeight, blockHeight }.
function fitText(ctx, text, { font, startSize, minSize = 22, maxWidth, maxHeight, lineHeightMul = 1.2 }) {
  let size = startSize;
  while (true) {
    ctx.font = font(size);
    const lines = wrapText(ctx, text, 0, maxWidth, size * lineHeightMul);
    const lh = size * lineHeightMul;
    const blockH = lines.length * lh;
    if (blockH <= maxHeight || size <= minSize) {
      return { lines, fontSize: size, lineHeight: lh, blockHeight: blockH };
    }
    size -= 2;
  }
}

// Default — gives any layout a sensible bg if the user didn't pick one.
function pickBg(page, fallback = "#0c2545") {
  return (page.bg || "").trim() || fallback;
}

// Choose readable text color for a given background. For dark bg → white text;
// for light bg → near-black text.
function readableInk(bg) {
  const m = /^#?([0-9a-f]{6})$/i.exec(bg || "");
  if (!m) return "#ffffff";
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  // Perceptual luminance — Rec. 709 weights.
  const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luma > 0.62 ? "#0a1424" : "#ffffff";
}

// ─── Editorial-split layout ──────────────────────────────────────────────────
// Big headline at the top in white over solid color, optional body in a softer
// frosted band at the bottom. Matches the "A Window to the Dawn of Time" card.
async function renderEditorial(page) {
  const SIZE = 1080;
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d");

  const bg = pickBg(page, "#0a1f3d");
  paintColorBackground(ctx, SIZE, bg);

  const ink = readableInk(bg);
  const pad = 72;
  const maxW = SIZE - pad * 2;

  const headline = (page.headline || "").trim();
  const body     = (page.body || "").trim();

  // Headline sized to fill ~top 55% of the canvas. Bold sans serif.
  const headlineFont = (sz) => `900 ${sz}px "Inter", "Helvetica Neue", Arial, sans-serif`;
  const headFit = fitText(ctx, headline || " ", {
    font: headlineFont,
    startSize: 86,
    minSize: 44,
    maxWidth: maxW,
    maxHeight: SIZE * 0.45,
    lineHeightMul: 1.1,
  });

  // Top band — solid bg already painted; headline sits inside it.
  ctx.fillStyle = ink;
  ctx.font = headlineFont(headFit.fontSize);
  ctx.textBaseline = "alphabetic";
  let hy = 200 + headFit.fontSize * 0.9;
  for (const line of headFit.lines) {
    ctx.fillText(line, pad, hy);
    hy += headFit.lineHeight;
  }

  // Bottom band — slightly tinted lighter overlay for the body, echoing the
  // "A Window to the Dawn of Time" two-tone composition.
  if (body) {
    const bandTop = SIZE * 0.58;
    const bandH   = SIZE - bandTop;
    const isDark = ink === "#ffffff";
    ctx.fillStyle = isDark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.06)";
    ctx.fillRect(0, bandTop, SIZE, bandH);

    const bodyFont = (sz) => `500 ${sz}px "Inter", "Helvetica Neue", Arial, sans-serif`;
    const bodyFit = fitText(ctx, body, {
      font: bodyFont,
      startSize: 38,
      minSize: 24,
      maxWidth: maxW,
      maxHeight: bandH - 160,
      lineHeightMul: 1.4,
    });

    ctx.fillStyle = isDark ? "rgba(255,255,255,0.92)" : "rgba(10,20,36,0.88)";
    ctx.font = bodyFont(bodyFit.fontSize);
    let by = bandTop + 70 + bodyFit.fontSize * 0.9;
    for (const line of bodyFit.lines) {
      ctx.fillText(line, pad, by);
      by += bodyFit.lineHeight;
    }
  }

  await drawCatalystWordmark(ctx, SIZE, { color: wordmarkColorFor(bg) });

  return canvas.toDataURL("image/png");
}

// ─── Hook / stat layout ──────────────────────────────────────────────────────
// Massive top statement (e.g. "In Washington D.C., a child's health…") with a
// lighter body band underneath and a CTA line ("Read X by Y. Link in bio.").
async function renderHook(page) {
  const SIZE = 1080;
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d");

  const bg = pickBg(page, "#5b3fb8");
  paintColorBackground(ctx, SIZE, bg);

  const ink = readableInk(bg);
  const isDark = ink === "#ffffff";
  const pad = 72;
  const maxW = SIZE - pad * 2;

  const headline = (page.headline || "").trim();
  const body     = (page.body || "").trim();
  const cta      = (page.cta || "").trim();

  // Top half — huge headline.
  const headlineFont = (sz) => `900 ${sz}px "Inter", "Helvetica Neue", Arial, sans-serif`;
  const headFit = fitText(ctx, headline || " ", {
    font: headlineFont,
    startSize: 92,
    minSize: 48,
    maxWidth: maxW,
    maxHeight: SIZE * 0.48,
    lineHeightMul: 1.08,
  });

  ctx.fillStyle = ink;
  ctx.font = headlineFont(headFit.fontSize);
  ctx.textBaseline = "alphabetic";
  let hy = 130 + headFit.fontSize * 0.9;
  for (const line of headFit.lines) {
    ctx.fillText(line, pad, hy);
    hy += headFit.lineHeight;
  }

  // Bottom band — body + CTA on a dark/light contrast strip.
  const bandTop = SIZE * 0.56;
  const bandH = SIZE - bandTop;
  ctx.fillStyle = isDark ? "rgba(0,0,0,0.32)" : "rgba(255,255,255,0.55)";
  ctx.fillRect(0, bandTop, SIZE, bandH);

  let cursorY = bandTop + 70;

  if (body) {
    const bodyFont = (sz) => `500 ${sz}px "Inter", "Helvetica Neue", Arial, sans-serif`;
    const bodyFit = fitText(ctx, body, {
      font: bodyFont,
      startSize: 36,
      minSize: 24,
      maxWidth: maxW,
      maxHeight: (bandH - 140) * (cta ? 0.55 : 1),
      lineHeightMul: 1.4,
    });
    ctx.fillStyle = ink;
    ctx.font = bodyFont(bodyFit.fontSize);
    let y = cursorY + bodyFit.fontSize * 0.9;
    for (const line of bodyFit.lines) {
      ctx.fillText(line, pad, y);
      y += bodyFit.lineHeight;
    }
    cursorY = y + 12;
  }

  if (cta) {
    const ctaFont = (sz) => `700 ${sz}px "Inter", "Helvetica Neue", Arial, sans-serif`;
    const ctaFit = fitText(ctx, cta, {
      font: ctaFont,
      startSize: 32,
      minSize: 22,
      maxWidth: maxW,
      // Reserve 110px for the THE CATALYST wordmark in the bottom-right
      maxHeight: SIZE - cursorY - 110,
      lineHeightMul: 1.35,
    });
    ctx.fillStyle = ink;
    ctx.font = ctaFont(ctaFit.fontSize);
    let y = cursorY + ctaFit.fontSize * 0.9;
    for (const line of ctaFit.lines) {
      ctx.fillText(line, pad, y);
      y += ctaFit.lineHeight;
    }
  }

  await drawCatalystWordmark(ctx, SIZE, { color: wordmarkColorFor(bg) });

  return canvas.toDataURL("image/png");
}

// ─── Quote layout ────────────────────────────────────────────────────────────
// Large pull-quote, centered-ish, with attribution underneath. Useful for a
// "Meet Dr. X" intro page (paste their bio as the quote, name as attribution)
// or a real pull-quote from the article.
async function renderQuote(page) {
  const SIZE = 1080;
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d");

  const bg = pickBg(page, "#0c2545");
  paintColorBackground(ctx, SIZE, bg);

  const ink = readableInk(bg);
  const isDark = ink === "#ffffff";

  const pad = 96;
  const maxW = SIZE - pad * 2;

  const quote       = (page.quote || page.body || "").trim();
  const attribution = (page.attribution || "").trim();

  // Decorative open-quote glyph
  ctx.fillStyle = isDark ? "rgba(255,255,255,0.18)" : "rgba(10,20,36,0.14)";
  ctx.font = `900 240px "Source Serif 4", Georgia, "Times New Roman", serif`;
  ctx.textBaseline = "alphabetic";
  ctx.fillText("“", pad - 8, 240);

  // Quote body — italic serif, fills the middle of the canvas.
  const quoteFont = (sz) => `italic 500 ${sz}px "Source Serif 4", Georgia, "Times New Roman", serif`;
  const qFit = fitText(ctx, quote || " ", {
    font: quoteFont,
    startSize: 56,
    minSize: 32,
    maxWidth: maxW,
    maxHeight: SIZE * 0.55,
    lineHeightMul: 1.32,
  });

  ctx.fillStyle = ink;
  ctx.font = quoteFont(qFit.fontSize);
  const blockTop = (SIZE - qFit.blockHeight) / 2 - 30;
  let qy = blockTop + qFit.fontSize * 0.9;
  for (const line of qFit.lines) {
    ctx.fillText(line, pad, qy);
    qy += qFit.lineHeight;
  }

  // Attribution — small caps style under the quote.
  if (attribution) {
    const attrY = blockTop + qFit.blockHeight + 56;
    // Thin accent rule
    ctx.strokeStyle = isDark ? "rgba(255,255,255,0.6)" : "rgba(10,20,36,0.5)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(pad, attrY);
    ctx.lineTo(pad + 80, attrY);
    ctx.stroke();

    ctx.fillStyle = ink;
    ctx.font = `700 28px "Inter", "Helvetica Neue", Arial, sans-serif`;
    ctx.textBaseline = "alphabetic";
    ctx.fillText(attribution.toUpperCase(), pad, attrY + 44);
  }

  await drawCatalystWordmark(ctx, SIZE, { color: wordmarkColorFor(bg) });

  return canvas.toDataURL("image/png");
}

// ─── Closing brand layout ────────────────────────────────────────────────────
// Reuses the article's cover photo, blurred + heavily darkened, with the glass
// logo and "Join the Changemakers" tagline. Auto-generated from the cover —
// no separate image upload needed.
async function renderClosing(page) {
  const SIZE = 1080;
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d");

  // ── Base fill — only ever shown if the cover image fails to load. ─────────
  // We pick a graceful gradient instead of a flat black, so even the failure
  // state looks intentional.
  const fallbackGrad = ctx.createLinearGradient(0, 0, SIZE, SIZE);
  fallbackGrad.addColorStop(0, "#13243f");
  fallbackGrad.addColorStop(1, "#0a1424");
  ctx.fillStyle = fallbackGrad;
  ctx.fillRect(0, 0, SIZE, SIZE);

  // The user-picked tint (defaults to a near-neutral so the cover photo is
  // what carries the color; tint just nudges the whole thing toward a hue).
  const tint = (page.bg || "").trim() || "#0a1830";

  let coverLoaded = false;
  if (page.coverImageUrl) {
    let src = page.coverImageUrl;
    try {
      const u = new URL(page.coverImageUrl);
      if (u.hostname.includes("static.wixstatic.com")) {
        // Same q_100 high-quality fetch as the cover renderer — keeps the
        // blur source crisp so the smoothed result has rich color, not mush.
        const v1 = u.pathname.indexOf("/v1/");
        const assetPath = v1 >= 0 ? u.pathname.slice(0, v1) : u.pathname;
        const fname = assetPath.split("/").filter(Boolean).pop();
        src = `${u.origin}${assetPath}/v1/fill/w_2160,h_2160,al_c,q_100,usm_0.66_1.00_0.00,enc_jpg/${fname}`;
      }
    } catch { /* not a URL */ }

    try {
      const img = await loadImage(src);
      const iw = img.naturalWidth, ih = img.naturalHeight;

      // ── Two-pass blur for depth ─────────────────────────────────────────
      // Pass 1: heavy bloom (THUMB=20) for the soft underlying field.
      // Pass 2: medium blur (THUMB=64) on top at low opacity, so the photo's
      // shapes still register subtly. The result feels like real Gaussian
      // depth-of-field rather than the flat pixelation of a single tiny
      // thumbnail.
      const drawBlurred = (thumbSize, alpha) => {
        const tCanvas = document.createElement("canvas");
        tCanvas.width = thumbSize;
        tCanvas.height = thumbSize;
        const tctx = tCanvas.getContext("2d");
        tctx.imageSmoothingEnabled = true;
        tctx.imageSmoothingQuality = "high";
        const tScale = Math.max(thumbSize / iw, thumbSize / ih);
        const tw = iw * tScale, th = ih * tScale;
        tctx.drawImage(img, (thumbSize - tw) / 2, (thumbSize - th) / 2, tw, th);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(tCanvas, 0, 0, SIZE, SIZE);
        ctx.restore();
      };
      drawBlurred(20, 1.0);   // soft base
      drawBlurred(72, 0.55);  // sharper top layer adds shape and saturation
      coverLoaded = true;
    } catch { /* fall through to fallback */ }
  }

  // ── Color tint, but gentle ─────────────────────────────────────────────────
  // The previous version used multiply + 60% black, which flattened the photo
  // to near-black. Here we just add a soft, low-opacity tint so the user-picked
  // color whispers through the photo without erasing it.
  ctx.save();
  ctx.globalCompositeOperation = "multiply";
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = tint;
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.restore();

  // ── Vignette: dark corners → bright center, focuses the eye on the logo ──
  const vignette = ctx.createRadialGradient(
    SIZE / 2, SIZE * 0.42, SIZE * 0.18,
    SIZE / 2, SIZE * 0.50, SIZE * 0.78
  );
  vignette.addColorStop(0,   "rgba(0,0,0,0)");
  vignette.addColorStop(0.7, "rgba(0,0,0,0.32)");
  vignette.addColorStop(1,   "rgba(0,0,0,0.62)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, SIZE, SIZE);

  // ── Soft luminous glow behind where the logo will sit ─────────────────────
  const glow = ctx.createRadialGradient(
    SIZE / 2, SIZE * 0.40, 0,
    SIZE / 2, SIZE * 0.40, SIZE * 0.42
  );
  glow.addColorStop(0,   "rgba(255,255,255,0.18)");
  glow.addColorStop(0.5, "rgba(255,255,255,0.06)");
  glow.addColorStop(1,   "rgba(255,255,255,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, SIZE, SIZE);

  // ── Frosted-glass card holding the logo + wordmark ────────────────────────
  // Apple-style: rounded rect, semi-translucent fill, soft top-edge sheen,
  // thin bright border, drop shadow. This makes the brand mark feel like a
  // physical object floating in front of the photo, not pasted on top of it.
  const cardW = SIZE * 0.72;
  const cardH = SIZE * 0.62;
  const cardX = (SIZE - cardW) / 2;
  const cardY = SIZE * 0.18;
  const cardR = 32;

  // Outer drop shadow
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.55)";
  ctx.shadowBlur = 60;
  ctx.shadowOffsetY = 24;
  ctx.fillStyle = "rgba(255,255,255,0.001)"; // near-zero so only the shadow renders
  ctx.beginPath();
  ctx.roundRect(cardX, cardY, cardW, cardH, cardR);
  ctx.fill();
  ctx.restore();

  // Glass fill — frosted white over the photo
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(cardX, cardY, cardW, cardH, cardR);
  ctx.clip();

  // Layered fills give the glass a subtle vertical gradient, like real frosted
  // acrylic catching ambient light from above.
  const glassGrad = ctx.createLinearGradient(0, cardY, 0, cardY + cardH);
  glassGrad.addColorStop(0,    "rgba(255,255,255,0.18)");
  glassGrad.addColorStop(0.5,  "rgba(255,255,255,0.10)");
  glassGrad.addColorStop(1,    "rgba(255,255,255,0.05)");
  ctx.fillStyle = glassGrad;
  ctx.fillRect(cardX, cardY, cardW, cardH);

  // Thin top-edge sheen
  const sheen = ctx.createLinearGradient(0, cardY, 0, cardY + 80);
  sheen.addColorStop(0, "rgba(255,255,255,0.28)");
  sheen.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = sheen;
  ctx.fillRect(cardX, cardY, cardW, 80);
  ctx.restore();

  // Bright thin border — gives the glass card its edge definition
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.42)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(cardX + 0.75, cardY + 0.75, cardW - 1.5, cardH - 1.5, cardR - 1);
  ctx.stroke();
  // Inner softer border for that dual-stroke glassy look
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(cardX + 4, cardY + 4, cardW - 8, cardH - 8, cardR - 4);
  ctx.stroke();
  ctx.restore();

  // ── Logo + wordmark INSIDE the glass card ─────────────────────────────────
  const logo = await loadLogo();
  if (logo) {
    const logoSize = 240;
    const logoX = (SIZE - logoSize) / 2;
    const logoY = cardY + cardH * 0.18;
    // Subtle glow behind the logo for the levitating glass-orb effect
    ctx.save();
    ctx.shadowColor = "rgba(180,210,255,0.55)";
    ctx.shadowBlur = 48;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(logo, logoX, logoY, logoSize, logoSize);
    ctx.restore();
  }

  // "The Catalyst Magazine" — clean serif-y feel via Inter at light weight,
  // sized large but not heavy so the glass aesthetic stays calm.
  ctx.save();
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = 12;
  ctx.font = `500 56px "Inter", "Helvetica Neue", Arial, sans-serif`;
  if ("letterSpacing" in ctx) ctx.letterSpacing = "-0.01em";
  ctx.fillText("The Catalyst Magazine", SIZE / 2, cardY + cardH * 0.74);

  // Tagline — softer, with letter-spacing for that editorial-print feel
  const tagline = (page.tagline || "Join the Changemakers.").trim();
  ctx.shadowBlur = 8;
  ctx.font = `400 26px "Inter", "Helvetica Neue", Arial, sans-serif`;
  if ("letterSpacing" in ctx) ctx.letterSpacing = "0.04em";
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.fillText(tagline, SIZE / 2, cardY + cardH * 0.86);
  ctx.restore();

  // ── catalyst-magazine.com URL pinned to the bottom edge of the canvas ────
  // Tiny + tracked-out so the closing page can subtly remind viewers where to
  // find more — without dominating the design.
  await ensurePoppinsLoaded();
  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.font = `700 22px "Poppins", "Inter", "Helvetica Neue", Arial, sans-serif`;
  if ("letterSpacing" in ctx) ctx.letterSpacing = "0.18em";
  ctx.fillText("CATALYST-MAGAZINE.COM", SIZE / 2, SIZE - 50);
  ctx.restore();

  return canvas.toDataURL("image/png");
}

async function mountSocialPosts(ctx, container) {
  // ── Page shell: tabbed — "Board" (kanban) and "Create" (inline generator) ──
  container.innerHTML = `
    <div class="sp-page" style="display:flex;flex-direction:column;gap:18px;">

      <!-- Hero / tabs -->
      <div style="display:flex;flex-direction:column;gap:10px;">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;">
          <div>
            <h2 style="font-size:20px;font-weight:800;margin:0;letter-spacing:-.01em;">Social media</h2>
            <p style="font-size:13px;color:var(--muted);margin:4px 0 0;">Design Instagram &amp; LinkedIn posts from your published articles.</p>
          </div>
        </div>
        <div role="tablist" style="display:inline-flex;gap:4px;background:var(--surface-2);border:1px solid var(--border);border-radius:12px;padding:4px;width:fit-content;">
          <button role="tab" id="sp-tab-board" class="sp-tab" style="padding:8px 16px;border:0;background:var(--surface);color:var(--ink);border-radius:8px;font-weight:600;font-size:13px;cursor:pointer;box-shadow:var(--shadow-sm);">📋 Board</button>
          <button role="tab" id="sp-tab-create" class="sp-tab" style="padding:8px 16px;border:0;background:transparent;color:var(--muted);border-radius:8px;font-weight:600;font-size:13px;cursor:pointer;">✨ Create post</button>
        </div>
      </div>

      <!-- BOARD VIEW -->
      <section id="sp-board-view" style="display:flex;flex-direction:column;gap:14px;">
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
          <select class="input select" id="sp-platform-filter" style="width:160px;">
            <option value="">All platforms</option>
            <option value="instagram">📸 Instagram</option>
            <option value="linkedin">💼 LinkedIn</option>
            <option value="twitter">🐦 Twitter</option>
            <option value="facebook">📘 Facebook</option>
          </select>
          <select class="input select" id="sp-status-filter" style="width:150px;">
            <option value="">All statuses</option>
            <option value="proposed">Proposed</option>
            <option value="approved">Approved</option>
            <option value="assigned">Assigned</option>
            <option value="posted">Posted</option>
          </select>
          <button class="btn btn-primary btn-sm" id="sp-goto-create" style="margin-left:auto;">✨ Create new post</button>
        </div>
        <div id="sp-list"><div class="loading-state"><div class="spinner"></div>Loading…</div></div>
      </section>

      <!-- CREATE VIEW (inline — no modal) -->
      <section id="sp-create-view" style="display:none;">
        <div class="sp-create-grid" style="display:grid;grid-template-columns:minmax(0,1fr) 420px;gap:22px;align-items:start;">

          <!-- LEFT: preview + thumbnails -->
          <div style="display:flex;flex-direction:column;gap:14px;min-width:0;">
            <div style="background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:18px;box-shadow:var(--shadow-sm);">
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
                <div>
                  <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;">Preview</div>
                  <div id="sp-gen-preview-label" style="font-size:13px;font-weight:600;color:var(--ink);margin-top:2px;">Page 1</div>
                </div>
                <div id="sp-gen-status" style="font-size:12px;color:var(--muted);"></div>
              </div>
              <div id="sp-gen-preview-wrap" style="width:100%;aspect-ratio:1;background:linear-gradient(135deg,var(--surface-2),var(--surface-3));border-radius:14px;border:1px solid var(--border);overflow:hidden;display:flex;align-items:center;justify-content:center;">
                <div style="color:var(--muted);font-size:13px;text-align:center;padding:24px;max-width:320px;">
                  <div style="font-size:32px;margin-bottom:8px;">✨</div>
                  Pick an article on the right to get started.
                </div>
              </div>
            </div>

            <!-- Thumbnail strip (multi-page only) -->
            <div id="sp-gen-thumbs-wrap" style="display:none;background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:14px 16px;box-shadow:var(--shadow-sm);">
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
                <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;">Carousel pages</div>
                <button class="btn btn-ghost btn-xs" id="sp-gen-add-page">+ Add page</button>
              </div>
              <div id="sp-gen-page-list" style="display:flex;gap:10px;overflow-x:auto;padding-bottom:4px;"></div>
            </div>

            <!-- Action bar -->
            <div style="display:flex;gap:10px;flex-wrap:wrap;background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:14px 16px;box-shadow:var(--shadow-sm);">
              <button class="btn btn-secondary btn-sm" id="sp-gen-preview-btn" style="flex:1;min-width:120px;">Preview all</button>
              <button class="btn btn-primary btn-sm" id="sp-gen-download-btn" disabled style="flex:1;min-width:120px;">⬇ Download</button>
              <button class="btn btn-accent btn-sm" id="sp-gen-save-btn" disabled style="flex:1;min-width:160px;">Save to board</button>
            </div>
          </div>

          <!-- RIGHT: controls panel -->
          <aside style="display:flex;flex-direction:column;gap:14px;">

            <!-- Article + mode -->
            <div style="background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:18px;box-shadow:var(--shadow-sm);display:flex;flex-direction:column;gap:14px;">
              <label style="font-size:12px;font-weight:700;color:var(--ink);text-transform:uppercase;letter-spacing:.06em;">Article
                <select class="input select" id="sp-gen-article" style="margin-top:6px;width:100%;font-weight:500;text-transform:none;letter-spacing:0;">
                  <option value="">Loading articles…</option>
                </select>
              </label>
              <label style="font-size:12px;font-weight:700;color:var(--ink);text-transform:uppercase;letter-spacing:.06em;">Platform
                <select class="input select" id="sp-gen-platform" style="margin-top:6px;width:100%;font-weight:500;text-transform:none;letter-spacing:0;">
                  <option value="instagram">📸 Instagram</option>
                  <option value="linkedin">💼 LinkedIn</option>
                </select>
              </label>
              <label style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--surface-2);border-radius:10px;cursor:pointer;font-size:13px;font-weight:600;">
                <input type="checkbox" id="sp-gen-multi" style="width:16px;height:16px;accent-color:var(--accent);cursor:pointer;">
                <span style="flex:1;">Multi-page carousel</span>
                <span style="font-size:11px;color:var(--muted);font-weight:500;">Add up to ~10 pages</span>
              </label>
            </div>

            <!-- AI helper (only visible in multi-page mode) -->
            <div id="sp-gen-ai-panel" style="display:none;background:linear-gradient(135deg, rgba(124,92,255,0.10), rgba(56,189,248,0.08));border:1px solid rgba(124,92,255,0.35);border-radius:16px;padding:16px 18px;box-shadow:var(--shadow-sm);">
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
                <span style="font-size:18px;">✨</span>
                <strong style="font-size:13px;">AI helper</strong>
                <button class="btn btn-ghost btn-xs" id="sp-gen-ai-toggle" style="margin-left:auto;">Hide</button>
              </div>
              <div id="sp-gen-ai-body">
                <p style="font-size:12px;color:var(--muted);margin:0 0 10px;line-height:1.5;">Copy the prompt below into ChatGPT or Claude. It already includes this article's content and the colors from your cover image, so the pages match perfectly. Paste the AI's answer in the box underneath — pages auto-generate.</p>

                <!-- Palette card — appears once an article is selected and its cover is sampled -->
                <div id="sp-gen-ai-palette" style="display:none;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:10px 12px;margin-bottom:10px;">
                  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
                    <span style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.07em;">Cover palette</span>
                    <span id="sp-gen-ai-palette-status" style="font-size:11px;color:var(--muted);"></span>
                  </div>
                  <div id="sp-gen-ai-palette-swatches" style="display:flex;gap:6px;flex-wrap:wrap;"></div>
                </div>

                <div style="display:flex;gap:6px;margin-bottom:6px;">
                  <button class="btn btn-primary btn-xs" id="sp-gen-ai-copy" disabled style="flex:1;opacity:.55;cursor:not-allowed;">📋 Copy prompt</button>
                  <button class="btn btn-secondary btn-xs" id="sp-gen-ai-view">View prompt</button>
                </div>
                <p id="sp-gen-ai-hint" style="font-size:11px;color:var(--muted);margin:0 0 8px;font-style:italic;">Pick an article above to enable the prompt — it will include the cover's colors.</p>
                <pre id="sp-gen-ai-prompt" style="display:none;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:10px 12px;font-size:11px;line-height:1.5;max-height:200px;overflow:auto;margin:0 0 10px;white-space:pre-wrap;word-break:break-word;"></pre>
                <textarea id="sp-gen-ai-paste" class="input textarea" rows="5"
                  placeholder="Paste the AI's response here — pages generate instantly."
                  style="width:100%;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;min-height:100px;"></textarea>
              </div>
            </div>

            <!-- Page editor -->
            <div id="sp-gen-page-editor-card" style="background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:18px;box-shadow:var(--shadow-sm);display:flex;flex-direction:column;gap:14px;">
              <div id="sp-gen-page-editor-header" style="display:flex;align-items:center;gap:8px;">
                <span style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;">Current page</span>
              </div>
              <div id="sp-gen-page-editor" style="display:flex;flex-direction:column;gap:14px;"></div>
            </div>

            <!-- Caption -->
            <div style="background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:18px;box-shadow:var(--shadow-sm);">
              <label style="font-size:12px;font-weight:700;color:var(--ink);text-transform:uppercase;letter-spacing:.06em;">Caption
                <textarea class="input textarea" id="sp-gen-caption" rows="6"
                  style="margin-top:6px;width:100%;min-height:120px;font-size:13px;font-weight:400;text-transform:none;letter-spacing:0;"></textarea>
                <span style="font-size:12px;color:var(--muted);font-weight:500;" id="sp-gen-char">0 characters</span>
              </label>
            </div>

          </aside>
        </div>
      </section>

    </div>

    <style>
      .sp-tab.active { background: var(--surface) !important; color: var(--ink) !important; box-shadow: var(--shadow-sm); }
      .sp-page-thumb {
        flex: 0 0 auto; width: 96px; cursor: pointer; border-radius: 10px;
        border: 2px solid var(--border); overflow: hidden; background: var(--surface-2);
        transition: transform .12s, border-color .12s; position: relative;
      }
      .sp-page-thumb:hover { transform: translateY(-2px); }
      .sp-page-thumb.active { border-color: var(--accent); }
      .sp-page-thumb-img { width: 100%; aspect-ratio: 1; display: block; }
      .sp-page-thumb-placeholder {
        width: 100%; aspect-ratio: 1; display: flex; align-items: center; justify-content: center;
        font-size: 22px; color: var(--muted); background: var(--surface-2);
      }
      .sp-page-thumb-label {
        font-size: 10px; font-weight: 600; padding: 4px 6px; text-align: center;
        color: var(--ink); background: var(--surface); border-top: 1px solid var(--border);
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .sp-page-thumb-del {
        position: absolute; top: 4px; right: 4px; width: 20px; height: 20px;
        border-radius: 50%; border: 0; background: rgba(0,0,0,0.6); color: white;
        font-size: 12px; line-height: 1; cursor: pointer; display: none;
      }
      .sp-page-thumb:hover .sp-page-thumb-del { display: block; }
      .sp-swatch {
        width: 26px; height: 26px; border-radius: 6px; border: 2px solid var(--border);
        cursor: pointer; padding: 0; transition: transform .12s;
      }
      .sp-swatch:hover { transform: scale(1.1); }
      .sp-swatch.active { border-color: var(--accent); box-shadow: 0 0 0 2px rgba(124,92,255,0.25); }
    </style>`;

  // ── Detail modal (for clicking a board card) ───────────────────────────────
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

  // ── Tab switching ──────────────────────────────────────────────────────────
  const tabBoard  = container.querySelector("#sp-tab-board");
  const tabCreate = container.querySelector("#sp-tab-create");
  const boardView  = container.querySelector("#sp-board-view");
  const createView = container.querySelector("#sp-create-view");

  function setActiveTab(which) {
    const isBoard = which === "board";
    tabBoard.classList.toggle("active", isBoard);
    tabCreate.classList.toggle("active", !isBoard);
    tabBoard.style.background  = isBoard ? "var(--surface)" : "transparent";
    tabBoard.style.color       = isBoard ? "var(--ink)" : "var(--muted)";
    tabBoard.style.boxShadow   = isBoard ? "var(--shadow-sm)" : "none";
    tabCreate.style.background = !isBoard ? "var(--surface)" : "transparent";
    tabCreate.style.color      = !isBoard ? "var(--ink)" : "var(--muted)";
    tabCreate.style.boxShadow  = !isBoard ? "var(--shadow-sm)" : "none";
    boardView.style.display  = isBoard ? "flex" : "none";
    createView.style.display = !isBoard ? "block" : "none";
  }
  tabBoard.addEventListener("click",  () => setActiveTab("board"));
  tabCreate.addEventListener("click", () => { setActiveTab("create"); ensureCreateInitialized(); });
  container.querySelector("#sp-goto-create").addEventListener("click", () => { setActiveTab("create"); ensureCreateInitialized(); });

  // ── Cleanup: remove body-level modal when module unmounts ─────────────────
  const cleanup = () => {
    detailModal.remove();
  };

  // ── State ──────────────────────────────────────────────────────────────────
  let allPosts = [];
  let publishedArticles = [];
  let selectedArticle = null;

  // Multi-page carousel state. Always at least one page (the cover).
  // Each page has its own data + a cached `dataUrl` once previewed.
  // dataUrl is invalidated whenever any of the page's inputs change.
  let pages = [];
  let activePageIdx = 0;
  let multiMode = false;
  let customCoverDataUrl = null; // applies to the cover page only

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

  // ── Generator (inline — no modal) ──────────────────────────────────────────
  const articleSelect  = container.querySelector("#sp-gen-article");
  const platformSelect = container.querySelector("#sp-gen-platform");
  const captionArea    = container.querySelector("#sp-gen-caption");
  const charEl         = container.querySelector("#sp-gen-char");
  const previewWrap    = container.querySelector("#sp-gen-preview-wrap");
  const previewLabel   = container.querySelector("#sp-gen-preview-label");
  const statusEl       = container.querySelector("#sp-gen-status");
  const previewBtn     = container.querySelector("#sp-gen-preview-btn");
  const downloadBtn    = container.querySelector("#sp-gen-download-btn");
  const saveBtn        = container.querySelector("#sp-gen-save-btn");
  const multiToggle    = container.querySelector("#sp-gen-multi");
  const thumbsWrap     = container.querySelector("#sp-gen-thumbs-wrap");
  const pageListEl     = container.querySelector("#sp-gen-page-list");
  const addPageBtn     = container.querySelector("#sp-gen-add-page");
  const editorEl       = container.querySelector("#sp-gen-page-editor");
  const aiPanel        = container.querySelector("#sp-gen-ai-panel");
  const aiBody         = container.querySelector("#sp-gen-ai-body");
  const aiToggleBtn    = container.querySelector("#sp-gen-ai-toggle");
  const aiCopyBtn      = container.querySelector("#sp-gen-ai-copy");
  const aiViewBtn      = container.querySelector("#sp-gen-ai-view");
  const aiPromptEl     = container.querySelector("#sp-gen-ai-prompt");
  const aiPasteEl      = container.querySelector("#sp-gen-ai-paste");
  const aiHintEl       = container.querySelector("#sp-gen-ai-hint");
  const aiPaletteCard  = container.querySelector("#sp-gen-ai-palette");
  const aiPaletteSwEl  = container.querySelector("#sp-gen-ai-palette-swatches");
  const aiPaletteStatusEl = container.querySelector("#sp-gen-ai-palette-status");

  // Cover palette state — sampled once per (article + custom-image) combo.
  let coverPalette = null;
  // Bumped on every article/custom-image change so a slow extraction from a
  // previous article doesn't overwrite a newer one.
  let paletteRequestId = 0;

  captionArea.addEventListener("input", () => { charEl.textContent = `${captionArea.value.length} characters`; });

  // ── Caption builder (carried over from single-page version) ────────────────
  function buildCaption(article, platform) {
    const rawAuthor = (article.authorName || article.author || "").trim();
    const isCatalystPlaceholder = !rawAuthor || rawAuthor.toLowerCase() === "the catalyst";
    const authorCredit = isCatalystPlaceholder ? "The Catalyst team" : `${rawAuthor} from The Catalyst`;
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

  // ── Multi-page state helpers ───────────────────────────────────────────────
  // A "cover" page always lives at index 0 — its image + title come from the
  // selected article (overridable). Other pages are pure typography on a
  // chosen background color, so the only image in the whole carousel is the
  // article cover (which the closing page reuses, blurred).
  function defaultCoverPage() {
    return { layout: "cover", titleStyle: "bold", imageScale: 1, dataUrl: null };
  }
  function defaultClosingPage() {
    return { layout: "closing", tagline: "Join the Changemakers.", bg: "#0a1830", dataUrl: null };
  }
  function blankPage(layout) {
    const base = { layout, dataUrl: null };
    if (layout === "editorial") return { ...base, headline: "", body: "", bg: "#0a1f3d" };
    if (layout === "hook")      return { ...base, headline: "", body: "", cta: "", bg: "#5b3fb8" };
    if (layout === "quote")     return { ...base, quote: "", attribution: "", bg: "#0c2545" };
    if (layout === "closing")   return defaultClosingPage();
    return defaultCoverPage();
  }

  // Resolve the cover image URL the cover & closing pages should render with.
  function articleCoverUrl() {
    if (customCoverDataUrl) return customCoverDataUrl;
    if (!selectedArticle) return "";
    return selectedArticle.coverImage || selectedArticle.image || "";
  }

  // Build the renderer-input for a given page — merges the page's editable
  // fields with article-derived data (title, cover image).
  function renderInputFor(page) {
    if (page.layout === "cover") {
      return {
        layout: "cover",
        title: selectedArticle ? selectedArticle.title : "",
        coverImageUrl: articleCoverUrl(),
        titleStyle: page.titleStyle || "bold",
        imageScale: typeof page.imageScale === "number" ? page.imageScale : 1,
      };
    }
    if (page.layout === "closing") {
      return {
        layout: "closing",
        coverImageUrl: articleCoverUrl(),
        tagline: page.tagline || "Join the Changemakers.",
        bg: page.bg || "#0a1830",
      };
    }
    return { ...page };
  }

  // Marks a page (and the preview area) as needing re-render.
  function invalidatePage(idx) {
    if (pages[idx]) pages[idx].dataUrl = null;
    if (idx === activePageIdx) {
      downloadBtn.disabled = !anyPagesReady();
      saveBtn.disabled = !anyPagesReady();
      previewWrap.innerHTML = `<span style="color:var(--muted);font-size:13px;text-align:center;padding:20px;">Click Preview to regenerate</span>`;
      statusEl.textContent = "";
    }
  }
  function invalidateAll() {
    pages.forEach((p) => { p.dataUrl = null; });
    downloadBtn.disabled = true;
    saveBtn.disabled = true;
    previewWrap.innerHTML = `<span style="color:var(--muted);font-size:13px;text-align:center;padding:20px;">Click Preview to regenerate</span>`;
    statusEl.textContent = "";
  }
  function anyPagesReady() {
    return pages.some((p) => !!p.dataUrl);
  }

  const LAYOUT_LABELS = {
    cover:     "Cover",
    editorial: "Editorial",
    hook:      "Hook / Stat",
    quote:     "Quote",
    closing:   "Closing",
  };
  const LAYOUT_ICONS = {
    cover: "🖼️", editorial: "📰", hook: "💬", quote: "❝", closing: "✨",
  };

  // ── Page thumbnails (horizontal strip, multi-page only) ────────────────────
  // Each thumb shows the rendered page image if available, else a placeholder
  // with the layout icon. Clicking switches the active page; hovering exposes
  // a delete button for non-cover pages.
  function renderPageList() {
    pageListEl.innerHTML = pages.map((p, i) => {
      const active = i === activePageIdx;
      const label = LAYOUT_LABELS[p.layout] || p.layout;
      const icon  = LAYOUT_ICONS[p.layout] || "•";
      const deletable = pages.length > 1 && p.layout !== "cover";
      const preview = p.dataUrl
        ? `<img class="sp-page-thumb-img" src="${p.dataUrl}" alt="Page ${i + 1}">`
        : `<div class="sp-page-thumb-placeholder">${icon}</div>`;
      return `
        <div class="sp-page-thumb ${active ? "active" : ""}" data-idx="${i}">
          ${preview}
          <div class="sp-page-thumb-label">${i + 1}. ${esc(label)}</div>
          ${deletable ? `<button class="sp-page-thumb-del" data-del="${i}" title="Delete page">×</button>` : ""}
        </div>`;
    }).join("");

    pageListEl.querySelectorAll(".sp-page-thumb").forEach((el) => {
      el.addEventListener("click", (e) => {
        if (e.target.dataset.del !== undefined) return;
        activePageIdx = parseInt(el.dataset.idx, 10);
        renderPageList();
        renderEditor();
        renderPreviewForActive();
      });
    });
    pageListEl.querySelectorAll("button[data-del]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.del, 10);
        pages.splice(idx, 1);
        if (activePageIdx >= pages.length) activePageIdx = pages.length - 1;
        renderPageList();
        renderEditor();
        renderPreviewForActive();
      });
    });
  }

  // ── Editor (middle column) — swaps based on the active page's layout ───────
  function renderEditor() {
    const page = pages[activePageIdx];
    if (!page) { editorEl.innerHTML = ""; return; }

    const layoutPicker = multiMode && page.layout !== "cover" ? `
      <label style="font-size:13px;font-weight:600;">Layout
        <select class="input select" id="sp-gen-layout" style="margin-top:6px;width:100%;">
          <option value="editorial" ${page.layout === "editorial" ? "selected" : ""}>📰 Editorial — headline + body</option>
          <option value="hook"      ${page.layout === "hook"      ? "selected" : ""}>💬 Hook — big stat + body + CTA</option>
          <option value="quote"     ${page.layout === "quote"     ? "selected" : ""}>❝ Quote — pull-quote + attribution</option>
          <option value="closing"   ${page.layout === "closing"   ? "selected" : ""}>✨ Closing — blurred cover + logo</option>
        </select>
      </label>
    ` : "";

    let body = "";
    if (page.layout === "cover") {
      body = `
        <label style="font-size:13px;font-weight:600;">Title style
          <select class="input select" data-bind="titleStyle" style="margin-top:6px;width:100%;">
            <option value="bold"    ${page.titleStyle === "bold"    ? "selected" : ""}>Bold — strong & punchy</option>
            <option value="elegant" ${page.titleStyle === "elegant" ? "selected" : ""}>Elegant — editorial serif</option>
          </select>
        </label>
        <div>
          <div style="font-size:13px;font-weight:600;margin-bottom:6px;">Cover image</div>
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <div id="sp-gen-img-name" style="font-size:12px;color:var(--muted);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${customCoverDataUrl ? "Custom image" : "Using article cover image"}</div>
            <button class="btn btn-secondary btn-xs" id="sp-gen-img-btn">Replace image</button>
            <button class="btn btn-ghost btn-xs" id="sp-gen-img-clear" style="display:${customCoverDataUrl ? "" : "none"};">✕ Reset</button>
          </div>
          <input type="file" id="sp-gen-img-file" accept="image/*" style="display:none;">
        </div>
        <div>
          <div style="font-size:13px;font-weight:600;margin-bottom:8px;">Image size <span id="sp-gen-scale-val" style="font-weight:400;color:var(--muted);">${Math.round((page.imageScale || 1) * 100)}%</span></div>
          <input type="range" id="sp-gen-scale" min="50" max="130" value="${Math.round((page.imageScale || 1) * 100)}" step="5"
            style="width:100%;accent-color:var(--accent);cursor:pointer;">
        </div>`;
    } else if (page.layout === "editorial") {
      body = `
        <label style="font-size:13px;font-weight:600;">Headline
          <textarea class="input textarea" data-bind="headline" rows="3"
            style="margin-top:6px;width:100%;font-size:14px;font-weight:700;">${esc(page.headline || "")}</textarea>
        </label>
        <label style="font-size:13px;font-weight:600;">Body
          <textarea class="input textarea" data-bind="body" rows="5"
            style="margin-top:6px;width:100%;font-size:13px;">${esc(page.body || "")}</textarea>
        </label>
        ${colorPickerHtml(page.bg, "#0a1f3d")}`;
    } else if (page.layout === "hook") {
      body = `
        <label style="font-size:13px;font-weight:600;">Headline
          <textarea class="input textarea" data-bind="headline" rows="3"
            style="margin-top:6px;width:100%;font-size:14px;font-weight:700;">${esc(page.headline || "")}</textarea>
        </label>
        <label style="font-size:13px;font-weight:600;">Body
          <textarea class="input textarea" data-bind="body" rows="3"
            style="margin-top:6px;width:100%;font-size:13px;">${esc(page.body || "")}</textarea>
        </label>
        <label style="font-size:13px;font-weight:600;">Call to action
          <textarea class="input textarea" data-bind="cta" rows="3"
            style="margin-top:6px;width:100%;font-size:13px;"
            placeholder='e.g. Read "The Geography of Risk" by Alexis Tamm. Link in bio.'>${esc(page.cta || "")}</textarea>
        </label>
        ${colorPickerHtml(page.bg, "#5b3fb8")}`;
    } else if (page.layout === "quote") {
      body = `
        <label style="font-size:13px;font-weight:600;">Quote / body
          <textarea class="input textarea" data-bind="quote" rows="6"
            style="margin-top:6px;width:100%;font-size:13px;">${esc(page.quote || "")}</textarea>
        </label>
        <label style="font-size:13px;font-weight:600;">Attribution
          <input class="input" data-bind="attribution" type="text"
            style="margin-top:6px;width:100%;font-size:13px;"
            placeholder="Dr. Duilia De Mello, NASA researcher" value="${esc(page.attribution || "")}">
        </label>
        ${colorPickerHtml(page.bg, "#0c2545")}`;
    } else if (page.layout === "closing") {
      body = `
        <label style="font-size:13px;font-weight:600;">Tagline
          <input class="input" data-bind="tagline" type="text"
            style="margin-top:6px;width:100%;font-size:13px;"
            value="${esc(page.tagline || "Join the Changemakers.")}">
        </label>
        ${colorPickerHtml(page.bg, "#0a1830", "Color tint")}
        <p style="font-size:11.5px;color:var(--muted);margin:0;">The closing page reuses the article cover, blurred and tinted with the color above.</p>`;
    }

    editorEl.innerHTML = `
      <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.07em;">Page ${activePageIdx + 1} ${multiMode ? `of ${pages.length}` : ""} · ${esc(LAYOUT_LABELS[page.layout])}</div>
      ${layoutPicker}
      ${body}`;

    bindEditorInputs(page);
  }

  function colorPickerHtml(value, fallback, label = "Background color") {
    const v = value || fallback;
    const swatches = ["#0a1f3d", "#0c2545", "#1a3270", "#5b3fb8", "#7a3fa3", "#0e3b29", "#7a2418", "#1a1a1a", "#f5f0ea"];
    return `
      <div>
        <div style="font-size:13px;font-weight:600;margin-bottom:6px;">${label}</div>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
          <input type="color" data-bind="bg" value="${esc(v)}" style="width:46px;height:32px;border:1px solid var(--border);border-radius:6px;padding:0;cursor:pointer;background:transparent;">
          <input class="input" data-bind="bg" type="text" value="${esc(v)}" style="width:110px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;">
          <div style="display:flex;gap:4px;flex-wrap:wrap;">
            ${swatches.map((c) => `<button type="button" data-swatch="${c}" title="${c}" style="width:22px;height:22px;border-radius:4px;border:1px solid var(--border);background:${c};cursor:pointer;padding:0;"></button>`).join("")}
          </div>
        </div>
      </div>`;
  }

  function bindEditorInputs(page) {
    // Generic data-bind handlers — keep page state in sync as the user types.
    editorEl.querySelectorAll("[data-bind]").forEach((el) => {
      const key = el.dataset.bind;
      const handler = (e) => {
        const v = e.target.value;
        page[key] = key === "imageScale" ? parseFloat(v) : v;
        // Keep paired color text/swatch inputs visually in sync
        if (key === "bg") {
          editorEl.querySelectorAll("[data-bind='bg']").forEach((other) => {
            if (other !== e.target) other.value = v;
          });
        }
        invalidatePage(activePageIdx);
      };
      el.addEventListener("input", handler);
      el.addEventListener("change", handler);
    });

    // Swatch buttons
    editorEl.querySelectorAll("button[data-swatch]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        page.bg = btn.dataset.swatch;
        editorEl.querySelectorAll("[data-bind='bg']").forEach((el) => { el.value = page.bg; });
        invalidatePage(activePageIdx);
      });
    });

    // Layout switcher
    const layoutSel = editorEl.querySelector("#sp-gen-layout");
    if (layoutSel) {
      layoutSel.addEventListener("change", (e) => {
        const newLayout = e.target.value;
        // Replace this page with a fresh blank of the new layout, but preserve
        // common fields where possible so a hook→editorial switch keeps the bg.
        const old = pages[activePageIdx];
        const fresh = blankPage(newLayout);
        if (old.bg) fresh.bg = old.bg;
        if (old.headline && (newLayout === "editorial" || newLayout === "hook")) fresh.headline = old.headline;
        if (old.body     && (newLayout === "editorial" || newLayout === "hook")) fresh.body = old.body;
        pages[activePageIdx] = fresh;
        renderPageList();
        renderEditor();
        invalidatePage(activePageIdx);
      });
    }

    // Cover-only — image size slider
    const scaleSlider = editorEl.querySelector("#sp-gen-scale");
    const scaleValEl = editorEl.querySelector("#sp-gen-scale-val");
    if (scaleSlider) {
      scaleSlider.addEventListener("input", () => {
        const pct = parseInt(scaleSlider.value, 10);
        page.imageScale = pct / 100;
        scaleValEl.textContent = `${pct}%`;
        invalidatePage(activePageIdx);
      });
    }

    // Cover-only — replace image
    const imgBtn      = editorEl.querySelector("#sp-gen-img-btn");
    const imgFileEl   = editorEl.querySelector("#sp-gen-img-file");
    const imgNameEl   = editorEl.querySelector("#sp-gen-img-name");
    const imgClearBtn = editorEl.querySelector("#sp-gen-img-clear");
    if (imgBtn && imgFileEl) {
      imgBtn.addEventListener("click", () => imgFileEl.click());
      imgFileEl.addEventListener("change", () => {
        const file = imgFileEl.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
          customCoverDataUrl = e.target.result;
          imgNameEl.textContent = file.name;
          imgClearBtn.style.display = "";
          // Cover image change affects both cover AND closing pages
          pages.forEach((p, i) => {
            if (p.layout === "cover" || p.layout === "closing") invalidatePage(i);
          });
          // New cover → resample palette so the AI prompt reflects it.
          refreshCoverPalette();
        };
        reader.readAsDataURL(file);
      });
      imgClearBtn.addEventListener("click", () => {
        customCoverDataUrl = null;
        imgFileEl.value = "";
        imgNameEl.textContent = "Using article cover image";
        imgClearBtn.style.display = "none";
        pages.forEach((p, i) => {
          if (p.layout === "cover" || p.layout === "closing") invalidatePage(i);
        });
        refreshCoverPalette();
      });
    }
  }

  // ── Preview area ───────────────────────────────────────────────────────────
  function renderPreviewForActive() {
    const page = pages[activePageIdx];
    previewLabel.textContent = page ? `Page ${activePageIdx + 1} / ${pages.length}` : "";
    if (page && page.dataUrl) {
      const img = document.createElement("img");
      img.src = page.dataUrl;
      img.style.cssText = "width:100%;height:100%;object-fit:cover;display:block;";
      previewWrap.innerHTML = "";
      previewWrap.appendChild(img);
    } else {
      previewWrap.innerHTML = `<span style="color:var(--muted);font-size:13px;text-align:center;padding:20px;">Click Preview to render this page</span>`;
    }
  }

  // ── Multi-page toggle ──────────────────────────────────────────────────────
  multiToggle.addEventListener("change", () => {
    multiMode = multiToggle.checked;
    if (multiMode) {
      thumbsWrap.style.display = "";
      aiPanel.style.display = "";
      // Bootstrap a sensible default carousel: cover + editorial + closing
      if (pages.length === 1) {
        pages.push(blankPage("editorial"));
        pages.push(defaultClosingPage());
      }
      refreshAiPrompt();
      updateAiCopyState();
      renderPaletteCard();
    } else {
      thumbsWrap.style.display = "none";
      aiPanel.style.display = "none";
      // Collapse back to just the cover
      pages = [pages[0] || defaultCoverPage()];
      activePageIdx = 0;
    }
    renderPageList();
    renderEditor();
    renderPreviewForActive();
  });

  addPageBtn.addEventListener("click", () => {
    // Insert before any closing page so the closing always stays last.
    const closingIdx = pages.findIndex((p) => p.layout === "closing");
    const insertAt = closingIdx === -1 ? pages.length : closingIdx;
    pages.splice(insertAt, 0, blankPage("editorial"));
    activePageIdx = insertAt;
    renderPageList();
    renderEditor();
    renderPreviewForActive();
  });

  // ── AI helper ──────────────────────────────────────────────────────────────
  // Builds a prompt tailored to the selected article — pre-fills the article's
  // title/deck/author/category AND a real palette extracted from the cover
  // image, so the AI returns colors that match the cover for free.
  function buildAiPrompt() {
    const a = selectedArticle;
    if (!a) return "[Select an article first to generate the prompt.]";
    const title   = a.title       || "[article title]";
    const deck    = a.deck || a.excerpt || "";
    const author  = a.authorName || a.author || "[author name]";
    const category = a.category || "Feature";

    // Build the color guidance section. If we successfully extracted a palette,
    // tell the AI the exact hex codes AND each color's share of the cover so
    // it knows which color is dominant. The AI is also encouraged to use
    // complementary colors that harmonize with the palette — they don't have
    // to be identical to the swatches, just clearly inspired by them.
    let colorGuidance;
    if (coverPalette && coverPalette.swatchesWithShare && coverPalette.swatchesWithShare.length) {
      const list = coverPalette.swatchesWithShare
        .map((s) => `${s.hex} (${s.share}%)`)
        .join(", ");
      const top = coverPalette.swatchesWithShare[0];
      colorGuidance = `• bg: design the carousel around the article's cover palette. Each color below shows its share of the cover image, so you know what's dominant:
   ${list}
   The dominant cover color is ${coverPalette.dominant} (${top.share}% of the image) and the most saturated accent is ${coverPalette.accent}.
   Lean heavily into whichever color has the largest share — if blue is 55% and brown is 8%, the carousel should feel mostly blue with brown as an occasional accent. You may use the swatch hex codes verbatim, OR pick complementary / analogous hex colors that harmonize beautifully with them (slightly different tones, deeper or lighter shades, colors that share a similar mood). The result should feel like a designer hand-picked the palette to extend the cover image — not slavishly copy it. Always ensure dark backgrounds for any page with white text. Avoid clashing colors that fight the cover.`;
    } else {
      colorGuidance = `• bg: pick a hex color that fits the article's mood. Dark blues for science/space (#0a1f3d, #0c2545, #1a3270); purple for social/equity (#5b3fb8, #7a3fa3); deep green for environment (#0e3b29); warm red for urgency (#7a2418). Each page should feel like part of the same palette — pick 2 max.`;
    }

    return `You are designing an Instagram carousel for The Catalyst Magazine — a polished, editorial publication about science, tech, and social impact. Given the article info below, produce a CAPTION for the post AND 3 to 5 carousel pages that deliver the key ideas of the article in a scroll-stopping, beautiful way. Everything must feel like a premium magazine — confident, curious, human, never clickbait.

── ARTICLE ──
Title: ${title}
Author: ${author}
Category: ${category}
Deck: ${deck || "(no deck — infer from title)"}
Article URL: https://www.catalyst-magazine.com

── OUTPUT FORMAT ──
Return ONLY the blocks below. No preamble, no markdown headers, no commentary.

First, the caption block (single block at the top — NO --- before it):
caption: <the full Instagram caption, 3-6 short lines separated by \\n\\n; engaging hook in line 1; a tight summary of the article's most interesting idea; ends with the line: Read more by ${author} at catalyst-magazine.com — link in bio. ✨> | hashtags should be a final \\n\\n line of 4-7 relevant hashtags including #TheCatalyst and #CatalystMagazine.

Then a single line of exactly three dashes: ---

Then the page blocks, each separated by a line of exactly three dashes: ---
Each page is "key: value" lines. Valid keys per layout:

  layout: editorial      → headline, body, bg
  layout: hook           → headline, body, cta, bg
  layout: quote          → quote, attribution, bg

Do NOT include a cover page — one is added automatically from the article.
Do NOT include a closing page — one is added automatically.

── COPY GUIDELINES ──
• caption: write it like a great magazine teaser. Open with a sentence that makes someone stop scrolling — a striking fact, an unexpected angle, or a question. Then 1-2 lines that crystallize what the article is about and why it matters NOW. Close with: "Read more by ${author} at catalyst-magazine.com — link in bio. ✨" then a blank line, then 4-7 relevant hashtags. Use \\n\\n between paragraphs in the caption value. Total length 400-700 characters before hashtags.
• headline: 6-12 words max. Punchy, concrete. End with a period or question mark.
• body: 1-2 short sentences. Specific facts, names, numbers over generalities. ≤ 220 characters.
• cta: optional on "hook" pages. One sentence that points to the article, e.g. 'Read "${title}" by ${author}. Link in bio.'
• quote: an actual quotable line (real or faithfully paraphrased from the article) in 1-3 sentences. No quotation marks — they're added automatically.
• attribution: person's name + 1 short role, e.g. "Dr. Duilia De Mello, NASA astronomer".
${colorGuidance}

── STRUCTURE ──
Aim for this arc:
1. Editorial "what" page — establish the core idea with a crisp headline + body.
2. Hook "why it matters" page — a surprising stat, consequence, or counter-intuitive point. Include a cta pointing readers to the full article.
3. (Optional) Quote page — a human voice from the piece: a researcher, a person affected, a quotable line from the author.
4. (Optional) A second editorial or hook page that adds a new angle.

── EXAMPLE (format only — your colors should come from the cover palette above) ──
caption: Light from 13 billion years ago is teaching us how galaxies were born — and where ours is going next.\\n\\nDr. Duilia De Mello uses NASA's deep space telescopes to look so far back in time that she's watching the first galaxies form. Her work on cosmic collisions is rewriting what we know about our own origins.\\n\\nRead more by ${author} at catalyst-magazine.com — link in bio. ✨\\n\\n#TheCatalyst #CatalystMagazine #Astronomy #ScienceWriting #STEM #NASA #SpaceExploration
---
layout: editorial
headline: A Window to the Dawn of Time.
body: Dr. De Mello's work with deep space telescopes captures light that has traveled for billions of years, creating a direct view of how galaxies first formed.
bg: #0a1f3d
---
layout: hook
headline: In Washington D.C., a child's health can change dramatically from one zip code to the next.
body: Children in some neighborhoods face asthma rates 3.5× higher than in others.
cta: Read "The Geography of Risk" by Alexis Tamm. Link in bio.
bg: #5b3fb8
---
layout: quote
quote: The universe keeps asking us the same question — not what we are, but when we are.
attribution: Dr. Duilia De Mello, NASA astronomer
bg: #0c2545

── NOW WRITE THE CAPTION + PAGES FOR "${title}" ──`;
  }

  function refreshAiPrompt() {
    aiPromptEl.textContent = buildAiPrompt();
  }

  // Enable/disable the Copy button based on whether the user has picked
  // an article. The button is disabled until then because copying a prompt
  // with placeholder text would be useless.
  function updateAiCopyState() {
    const ready = !!selectedArticle;
    aiCopyBtn.disabled = !ready;
    aiCopyBtn.style.opacity = ready ? "1" : ".55";
    aiCopyBtn.style.cursor  = ready ? "pointer" : "not-allowed";
    if (!ready) {
      aiHintEl.textContent = "Pick an article above to enable the prompt — it will include the cover's colors.";
      aiHintEl.style.display = "";
    } else if (coverPalette) {
      aiHintEl.textContent = "Includes cover palette — paste the AI's reply below to auto-build pages.";
      aiHintEl.style.display = "";
    } else {
      aiHintEl.textContent = "Sampling cover colors…";
      aiHintEl.style.display = "";
    }
  }

  // Render the small palette card under the helper. Hidden until we have one.
  function renderPaletteCard() {
    if (!selectedArticle) {
      aiPaletteCard.style.display = "none";
      return;
    }
    aiPaletteCard.style.display = "";
    if (!coverPalette) {
      aiPaletteStatusEl.textContent = "Sampling…";
      aiPaletteSwEl.innerHTML = `<div style="font-size:11px;color:var(--muted);">Reading colors from the cover image…</div>`;
      return;
    }
    const items = coverPalette.swatchesWithShare || coverPalette.swatches.map((hex) => ({ hex, share: 0 }));
    aiPaletteStatusEl.textContent = `${items.length} colors · sized by share`;
    aiPaletteSwEl.innerHTML = items.map((item) => `
      <div title="${item.hex} — ${item.share}% of cover" style="display:flex;flex-direction:column;align-items:center;gap:3px;">
        <div style="width:32px;height:32px;border-radius:6px;border:1px solid rgba(0,0,0,0.12);background:${item.hex};position:relative;overflow:hidden;">
          <div style="position:absolute;inset:auto 0 0 0;height:18px;background:rgba(0,0,0,0.55);color:white;font-size:9px;font-weight:700;display:flex;align-items:center;justify-content:center;letter-spacing:.02em;">${item.share}%</div>
        </div>
        <span style="font-size:9.5px;color:var(--muted);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">${item.hex}</span>
      </div>
    `).join("");
  }

  // Sample the article cover and update the palette + UI. Called when the
  // article changes or when the user uploads a custom cover image.
  async function refreshCoverPalette() {
    const myId = ++paletteRequestId;
    coverPalette = null;
    renderPaletteCard();
    updateAiCopyState();
    refreshAiPrompt();
    const url = articleCoverUrl();
    if (!url) return;
    try {
      const palette = await extractCoverPalette(url);
      // If the user changed article while we were sampling, drop this result.
      if (myId !== paletteRequestId) return;
      coverPalette = palette || null;
    } catch {
      coverPalette = null;
    }
    renderPaletteCard();
    updateAiCopyState();
    refreshAiPrompt();
  }

  aiToggleBtn.addEventListener("click", () => {
    const hidden = aiBody.style.display === "none";
    aiBody.style.display = hidden ? "" : "none";
    aiToggleBtn.textContent = hidden ? "Hide" : "Show";
  });

  aiViewBtn.addEventListener("click", () => {
    const hidden = aiPromptEl.style.display === "none";
    aiPromptEl.style.display = hidden ? "block" : "none";
    aiViewBtn.textContent = hidden ? "Hide prompt" : "View prompt";
  });

  aiCopyBtn.addEventListener("click", async () => {
    if (!selectedArticle) {
      ctx.toast("Select an article first.", "error");
      return;
    }
    refreshAiPrompt();
    try {
      await navigator.clipboard.writeText(aiPromptEl.textContent);
      const orig = aiCopyBtn.textContent;
      aiCopyBtn.textContent = "✓ Copied!";
      setTimeout(() => { aiCopyBtn.textContent = orig; }, 1800);
    } catch {
      ctx.toast("Copy failed — view the prompt and copy manually.", "error");
      aiPromptEl.style.display = "block";
      aiViewBtn.textContent = "Hide prompt";
    }
  });

  // Auto-parse pasted AI text — debounced so the user isn't interrupted.
  let aiParseTimer = null;
  aiPasteEl.addEventListener("input", () => {
    clearTimeout(aiParseTimer);
    aiParseTimer = setTimeout(() => tryApplyAiPaste(), 500);
  });
  aiPasteEl.addEventListener("paste", () => {
    // Give the paste event a tick to land in the textarea, then apply.
    setTimeout(() => tryApplyAiPaste(), 50);
  });

  function tryApplyAiPaste() {
    const text = aiPasteEl.value.trim();
    if (!text) return;
    const { caption, pages: parsedPages } = parseAiBlock(text);
    // Don't toast-spam on partial input — wait until we have at least one page
    // OR an explicit caption block.
    if (!parsedPages.length && !caption) return;
    if (parsedPages.length) {
      const cover = pages[0] || defaultCoverPage();
      pages = [cover, ...parsedPages];
      if (!pages.some((p) => p.layout === "closing")) {
        pages.push(defaultClosingPage());
      }
      activePageIdx = Math.min(1, pages.length - 1);
    }
    if (caption) {
      captionArea.value = caption;
      charEl.textContent = `${caption.length} characters`;
    }
    aiPasteEl.value = "";
    const bits = [];
    if (parsedPages.length) bits.push(`${parsedPages.length} page${parsedPages.length === 1 ? "" : "s"}`);
    if (caption) bits.push("caption");
    ctx.toast(`✨ AI generated ${bits.join(" + ")}.`, "success");
    renderPageList();
    renderEditor();
    renderPreviewForActive();
  }

  // ── Article + platform changes ─────────────────────────────────────────────
  function onArticleChange() {
    const idx = articleSelect.value;
    if (idx === "") {
      selectedArticle = null;
      coverPalette = null;
      paletteRequestId++;
      renderPaletteCard();
      updateAiCopyState();
      refreshAiPrompt();
      return;
    }
    selectedArticle = publishedArticles[parseInt(idx, 10)];
    captionArea.value = buildCaption(selectedArticle, platformSelect.value);
    charEl.textContent = `${captionArea.value.length} characters`;
    customCoverDataUrl = null;
    // The cover/closing depend on the article — invalidate and re-render.
    invalidateAll();
    renderEditor();
    renderPreviewForActive();
    // Sample the new cover's palette in the background.
    refreshCoverPalette();
  }
  articleSelect.addEventListener("change", onArticleChange);
  platformSelect.addEventListener("change", () => {
    if (selectedArticle) {
      captionArea.value = buildCaption(selectedArticle, platformSelect.value);
      charEl.textContent = `${captionArea.value.length} characters`;
    }
  });

  // ── Preview / Download / Save handlers ─────────────────────────────────────
  previewBtn.addEventListener("click", async () => {
    if (!selectedArticle) { ctx.toast("Select an article first.", "error"); return; }
    previewBtn.disabled = true;
    previewBtn.textContent = "Generating…";
    statusEl.textContent = multiMode ? `Rendering ${pages.length} pages…` : "Drawing image…";
    previewWrap.innerHTML = `<div class="spinner"></div>`;
    try {
      // Render every page that's missing a cached dataUrl, in order. Sequential
      // because each pulls from canvas + image loaders that don't parallelize
      // cleanly, and there's only ever a handful of pages.
      for (let i = 0; i < pages.length; i++) {
        if (!pages[i].dataUrl) {
          statusEl.textContent = `Rendering page ${i + 1} / ${pages.length}…`;
          pages[i].dataUrl = await generatePostImage(renderInputFor(pages[i]));
        }
      }
      renderPreviewForActive();
      statusEl.textContent = `${pages.length} page${pages.length === 1 ? "" : "s"} ready · 1080 × 1080 px each`;
      downloadBtn.disabled = false;
      saveBtn.disabled = false;
    } catch (err) {
      previewWrap.innerHTML = `<span style="color:var(--danger);font-size:13px;padding:20px;text-align:center;">Error: ${esc(err.message)}</span>`;
      statusEl.textContent = "";
    } finally {
      previewBtn.disabled = false;
      previewBtn.textContent = "Preview";
    }
  });

  downloadBtn.addEventListener("click", async () => {
    if (!anyPagesReady()) return;
    const slug = selectedArticle?.slug || "post";
    // Single-page → just download the PNG directly.
    if (pages.length === 1) {
      const a = document.createElement("a");
      a.href = pages[0].dataUrl;
      a.download = `catalyst-${slug}-instagram.png`;
      a.click();
      return;
    }
    // Multi-page → bundle as ZIP. JSZip is loaded on demand from a CDN so the
    // dashboard bundle stays slim for the common single-page path.
    downloadBtn.disabled = true;
    downloadBtn.textContent = "Bundling…";
    try {
      const JSZipMod = await import("https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm");
      const JSZip = JSZipMod.default || JSZipMod;
      const zip = new JSZip();
      pages.forEach((p, i) => {
        if (!p.dataUrl) return;
        const layout = p.layout;
        const base64 = p.dataUrl.split(",")[1];
        zip.file(`${String(i + 1).padStart(2, "0")}-${layout}.png`, base64, { base64: true });
      });
      const blob = await zip.generateAsync({ type: "blob" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `catalyst-${slug}-carousel.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } catch (err) {
      ctx.toast("ZIP failed: " + err.message, "error");
    } finally {
      downloadBtn.disabled = false;
      downloadBtn.textContent = "Download";
    }
  });

  saveBtn.addEventListener("click", async () => {
    if (!selectedArticle || !anyPagesReady()) return;
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving…";
    const platform = platformSelect.value;
    const author = selectedArticle.authorName || selectedArticle.author || "The Catalyst";
    const slug = selectedArticle.slug || "";
    const coverUrl = articleCoverUrl();
    const pageSummary = pages.map((p, i) => `${i + 1}. ${LAYOUT_LABELS[p.layout]}`).join("\n");
    const carouselNote = pages.length > 1
      ? `\n\nCarousel (${pages.length} pages):\n${pageSummary}\n\nDownload the ZIP from the image generator and post the PNGs in order.`
      : "\n\nDownload the generated PNG from the image generator.";
    try {
      await firestoreAdd(ctx.authedFetch, "social_posts", {
        title: `${platform === "instagram" ? "Instagram" : "LinkedIn"}: ${selectedArticle.title}${pages.length > 1 ? ` (${pages.length}-page carousel)` : ""}`,
        platform,
        content: captionArea.value,
        notes: platform === "instagram"
          ? `Cover image (square 1080×1080): ${coverUrl}${carouselNote}`
          : `Article URL: https://www.catalyst-magazine.com/article/${slug}\nAuthor: ${author}`,
        status: "proposed",
        proposerId: ctx.user.uid,
        proposerName: ctx.profile.name || ctx.user.email,
        assigneeId: null,
        assigneeName: null,
        deadline: new Date(Date.now() + 3 * 86400000).toISOString().split("T")[0],
        createdAt: new Date().toISOString(),
        activity: [{ text: `created via image generator (${pages.length} page${pages.length === 1 ? "" : "s"})`, authorName: ctx.profile.name || ctx.user.email, timestamp: new Date().toISOString() }],
      });
      ctx.toast("Saved to social posts board!", "success");
      setActiveTab("board");
      resetCreate();
      await loadPosts();
    } catch (err) {
      ctx.toast("Failed to save: " + err.message, "error");
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = "Save draft to board";
    }
  });

  // ── AI block parser ────────────────────────────────────────────────────────
  // Accepts a block of text where pages are separated by lines containing only
  // dashes (e.g. `---`). Inside each section, `key: value` lines populate the
  // page's fields. Whitespace-tolerant; unknown keys are ignored.
  // Returns { caption: string|null, pages: Page[] }. Sections without a
  // `layout:` key are treated as caption-bearing blocks (the AI is instructed
  // to put `caption: …` at the top, before the first `---`).
  function parseAiBlock(text) {
    if (!text || !text.trim()) return { caption: null, pages: [] };
    const sections = text.split(/^\s*-{3,}\s*$/m).map((s) => s.trim()).filter(Boolean);
    const pages = [];
    let caption = null;
    for (const section of sections) {
      const obj = {};
      for (const rawLine of section.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#")) continue;
        const m = /^([a-zA-Z_][\w-]*)\s*:\s*(.*)$/.exec(line);
        if (!m) continue;
        const key = m[1].toLowerCase();
        // Convert literal `\n` sequences in the value to real newlines so AI
        // can fit a paragraph break onto a single line.
        const value = m[2].replace(/\\n/g, "\n").trim();
        obj[key] = value;
      }
      // Top-level caption block — has no `layout:` field.
      if (!obj.layout && obj.caption) {
        caption = obj.caption;
        continue;
      }
      const layout = (obj.layout || "").toLowerCase();
      if (!["editorial", "hook", "quote", "closing"].includes(layout)) continue;
      const page = blankPage(layout);
      for (const k of ["headline", "body", "cta", "quote", "attribution", "tagline", "bg"]) {
        if (obj[k] !== undefined) page[k] = obj[k];
      }
      pages.push(page);
    }
    return { caption, pages };
  }

  // ── Create view lifecycle ──────────────────────────────────────────────────
  function resetCreate() {
    selectedArticle = null;
    customCoverDataUrl = null;
    multiMode = false;
    multiToggle.checked = false;
    thumbsWrap.style.display = "none";
    aiPanel.style.display = "none";
    pages = [defaultCoverPage()];
    activePageIdx = 0;

    articleSelect.value = "";
    platformSelect.value = "instagram";
    captionArea.value = "";
    charEl.textContent = "0 characters";
    previewWrap.innerHTML = `
      <div style="color:var(--muted);font-size:13px;text-align:center;padding:24px;max-width:320px;">
        <div style="font-size:32px;margin-bottom:8px;">✨</div>
        Pick an article on the right to get started.
      </div>`;
    previewLabel.textContent = "Page 1";
    statusEl.textContent = "";
    downloadBtn.disabled = true;
    saveBtn.disabled = true;
    aiPasteEl.value = "";
    aiPromptEl.style.display = "none";
    aiViewBtn.textContent = "View prompt";
    coverPalette = null;
    paletteRequestId++;
    renderPaletteCard();
    updateAiCopyState();

    renderPageList();
    renderEditor();
  }

  // First-time visit to the Create tab: load articles, populate dropdown,
  // and initialize the view. Subsequent visits preserve any work in progress.
  let createInitialized = false;
  async function ensureCreateInitialized() {
    if (createInitialized) return;
    createInitialized = true;
    resetCreate();
    if (!publishedArticles.length) {
      articleSelect.innerHTML = `<option value="">Loading…</option>`;
      await loadArticles();
    }
    populateArticleDropdown();
  }

  // ── Filters ────────────────────────────────────────────────────────────────
  platformFilter.addEventListener("change", render);
  statusFilter.addEventListener("change", render);

  await loadPosts();
  return cleanup;
}
