// Admin → Advanced tools
// Imports a Wix "Posts.csv" export as published stories. Admin-only.
//
// The Wix CSV contains quoted, multi-line fields with escaped double quotes.
// We parse it with a state machine (no external deps) and map the columns we
// care about into Catalyst's `stories` schema.

import { db, storage } from "../firebase-config.js";
import {
  collection, addDoc, query, where, getDocs, orderBy, limit,
  doc, getDoc, setDoc, updateDoc, deleteDoc, Timestamp,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import {
  ref as storageRef, uploadBytesResumable, getDownloadURL,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";
import { el, esc, toast, slugify, confirmDialog } from "./ui.js";

// A user is "recently joined" if their account was created within this many
// days. The welcome email panel surfaces these at the top so the admin can fire
// off a welcome email to new arrivals without scrolling.
const RECENT_JOIN_DAYS = 14;

// ─── Tool registry ──────────────────────────────────────────────────────────
//
// Each tool is one entry in this array. The mount function renders a left
// rail of these and shows the active one's pane on the right; clicking a
// rail item swaps panes without re-fetching anything that's already mounted.
// Adding a new tool = appending one entry here and writing its `mount`.
//
// Layout choice: the previous version stacked all 5 tools in one long
// scroll, which forced admins to read 5 dense help blocks just to find
// the one tool they wanted. Settings-style picker UIs (System Prefs,
// GitHub Settings, Linear, Notion) all use a left rail because the eye
// can pattern-match icon + name in ~200ms vs reading paragraphs.
const TOOLS = [
  {
    id: "announce",
    label: "Announcements",
    summary: "Post a red alert banner to every staff member's Overview — meetings, When2meets, urgent asks.",
    danger: "writes",
    iconSvg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/></svg>`,
    mount: mountAnnounceTool,
  },
  {
    id: "hero",
    label: "Homepage hero image",
    summary: "Override the big image behind the Articles page hero. Defaults to the newest published story's cover.",
    danger: "writes",
    iconSvg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>`,
    mount: mountHeroTool,
  },
  {
    id: "import",
    label: "Import Wix posts",
    summary: "Bulk import an old Wix blog export into the article queue as drafts.",
    danger: "writes",
    iconSvg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`,
    mount: mountImportTool,
  },
  {
    id: "export",
    label: "Export all articles",
    summary: "Download every story (title, byline, body, URL) as a single .txt for LLM editing.",
    danger: null,
    iconSvg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
    mount: mountExportTool,
  },
  {
    id: "welcome",
    label: "Welcome emails",
    summary: "Send a role-specific onboarding walkthrough to any contributor.",
    danger: null,
    iconSvg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1 0 2 1 2 2v12c0 1-1 2-2 2H4c-1 0-2-1-2-2V6c0-1 1-2 2-2z"/><polyline points="22 6 12 13 2 6"/></svg>`,
    mount: mountWelcomeTool,
  },
  {
    id: "guidance",
    label: "Help-email composer",
    summary: "Send a polished workflow walkthrough from Aidan & Yair to a confused teammate.",
    danger: null,
    iconSvg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
    mount: mountGuidanceTool,
  },
  {
    id: "winners",
    label: "Winners' Chat",
    summary: "Edit or delete messages in the Brain Teaser Winners' Lounge.",
    danger: "writes",
    iconSvg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
    mount: mountWinnersTool,
  },
];

export async function mount(ctx, container) {
  container.innerHTML = "";
  ensureAdvancedToolsStyles();

  // Pick the initial tool from the URL hash query (?tool=…) so refresh /
  // back-forward keep the same tool open. Falls back to the first tool.
  const urlParams = new URLSearchParams(location.hash.split("?")[1] || "");
  const initialId = urlParams.get("tool") || TOOLS[0].id;
  let activeId = TOOLS.some((t) => t.id === initialId) ? initialId : TOOLS[0].id;

  const card = el("div", { class: "card adv-card" });
  card.innerHTML = `
    <div class="card-header adv-header">
      <div>
        <div class="card-title">Advanced tools</div>
        <div class="card-subtitle">Admin-only utilities. Each writes directly to the live database — pick one tool at a time and use it deliberately.</div>
      </div>
    </div>
    <div class="adv-body">
      <aside class="adv-rail" role="tablist" aria-label="Advanced tools"></aside>
      <section class="adv-pane" id="adv-pane" role="tabpanel" aria-live="polite"></section>
    </div>`;
  container.appendChild(card);

  const rail = card.querySelector(".adv-rail");
  const pane = card.querySelector("#adv-pane");
  const mountedPanes = new Map(); // tool.id -> {el, cleanup}

  // Render the left rail once. Each item is a button so keyboard users
  // can tab through them; aria-selected reflects active state.
  for (const tool of TOOLS) {
    const item = el("button", {
      type: "button",
      class: "adv-rail-item",
      role: "tab",
      "data-tool-id": tool.id,
      "aria-selected": tool.id === activeId ? "true" : "false",
    });
    item.innerHTML = `
      <span class="adv-rail-icon" aria-hidden="true">${tool.iconSvg}</span>
      <span class="adv-rail-text">
        <span class="adv-rail-label">
          ${esc(tool.label)}
          ${tool.danger === "writes" ? `<span class="adv-rail-badge" title="This tool writes to the live database">Live writes</span>` : ""}
        </span>
        <span class="adv-rail-summary">${esc(tool.summary)}</span>
      </span>
    `;
    item.addEventListener("click", () => switchTo(tool.id));
    rail.appendChild(item);
  }

  // Pane swap. We mount each tool lazily on first selection and *keep
  // its DOM cached* for fast re-entry — important because the welcome
  // tool fetches a user list and the import tool keeps mid-flight CSV
  // preview state. Cached panes are hidden via display:none, not
  // unmounted, so any open dialog or in-flight upload survives a tool
  // switch.
  function switchTo(nextId) {
    const tool = TOOLS.find((t) => t.id === nextId);
    if (!tool) return;
    activeId = nextId;
    rail.querySelectorAll(".adv-rail-item").forEach((b) => {
      b.setAttribute("aria-selected", b.dataset.toolId === nextId ? "true" : "false");
    });
    // Update the URL so refresh keeps the same tool open without
    // disturbing the hash route.
    const [route, qs] = location.hash.split("?");
    const params = new URLSearchParams(qs || "");
    params.set("tool", nextId);
    location.replace(`${route}?${params.toString()}`);

    // Hide every previously-mounted pane.
    for (const { el: e } of mountedPanes.values()) e.style.display = "none";

    let mounted = mountedPanes.get(nextId);
    if (!mounted) {
      const wrap = el("div", { class: "adv-pane-content" });
      pane.appendChild(wrap);
      let cleanup = null;
      try {
        cleanup = tool.mount(ctx, wrap) || null;
      } catch (err) {
        console.error(`[advanced-tools] ${nextId} mount failed`, err);
        wrap.innerHTML = `<div class="error-state">Could not load ${esc(tool.label)}: ${esc(err.message || err)}</div>`;
      }
      mounted = { el: wrap, cleanup };
      mountedPanes.set(nextId, mounted);
    }
    mounted.el.style.display = "";
  }

  switchTo(activeId);

  // Module cleanup — fire each tool's optional cleanup on unmount.
  return () => {
    for (const { cleanup } of mountedPanes.values()) {
      if (typeof cleanup === "function") {
        try { cleanup(); } catch (err) { console.warn(err); }
      }
    }
  };
}

// ─── Pane renderers ─────────────────────────────────────────────────────────

function paneHeader(title, sub) {
  return `
    <header class="adv-pane-header">
      <h2 class="adv-pane-title">${esc(title)}</h2>
      ${sub ? `<p class="adv-pane-sub">${sub}</p>` : ""}
    </header>`;
}

// ─── Homepage hero image ─────────────────────────────────────────────────────
// Override the big backdrop image behind the Articles page hero
// ("Stories that move science forward"). The default is the newest published
// story's cover; an admin can pin any image here instead — paste a URL or
// upload a file. Stored at site_settings/articlesHero.{image}. The public
// page (js/articles-new.js) reads this doc and prefers it over the default.
const HERO_SETTINGS_PATH = ["site_settings", "articlesHero"];

function mountHeroTool(ctx, root) {
  root.innerHTML = `
    ${paneHeader("Homepage hero image", `Override the large image behind the <strong>Articles page hero</strong> ("Stories that move science forward"). By default it shows the <strong>newest published story's cover</strong> — pin a custom image here if you'd rather show something else. Paste an image URL or upload a file, then Save. Reset any time to go back to the automatic default.`)}
    <div class="adv-pane-body" style="display:grid;gap:18px;max-width:680px;">

      <div>
        <div style="font-weight:700;font-size:12px;letter-spacing:0.04em;text-transform:uppercase;color:var(--muted,#6b7280);margin-bottom:8px;">Live preview</div>
        <div id="hero-preview" style="position:relative;aspect-ratio:16/7;border-radius:12px;overflow:hidden;background:#0f172a;border:1px solid var(--hairline,#e5e7eb);">
          <div id="hero-preview-img" style="position:absolute;inset:0;background-size:cover;background-position:center;"></div>
          <div style="position:absolute;inset:0;background:linear-gradient(180deg,rgba(15,23,42,0.1),rgba(15,23,42,0.55));"></div>
          <div style="position:absolute;left:18px;bottom:14px;color:#fff;font-family:'Poppins',sans-serif;font-weight:800;font-size:18px;letter-spacing:-0.02em;text-shadow:0 2px 12px rgba(0,0,0,0.4);">Stories that move science forward.</div>
          <span id="hero-source-badge" style="position:absolute;top:12px;left:12px;font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;padding:4px 9px;border-radius:999px;background:rgba(0,0,0,0.55);color:#fff;backdrop-filter:blur(4px);">Loading…</span>
        </div>
      </div>

      <label style="display:grid;gap:5px;">
        <span style="font-weight:600;font-size:13px;">Image URL</span>
        <input id="hero-url" type="url" placeholder="https://…  (paste a link, or use Upload below)" autocomplete="off"
               style="padding:10px 12px;border:1px solid var(--hairline,#e5e7eb);border-radius:8px;font-size:14px;font-family:inherit;">
      </label>

      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
        <input id="hero-file" type="file" accept="image/*" hidden>
        <button type="button" id="hero-upload-btn" class="btn btn-secondary btn-sm">Upload an image…</button>
        <span id="hero-upload-status" class="adv-action-hint"></span>
      </div>

      <div id="hero-msg" style="font-size:13px;min-height:18px;color:var(--danger,#b91c1c);"></div>

      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;border-top:1px solid var(--hairline,#e5e7eb);padding-top:16px;">
        <button type="button" id="hero-save" class="btn btn-accent btn-sm">Save hero image</button>
        <button type="button" id="hero-reset" class="btn btn-ghost btn-sm">Reset to default (newest story)</button>
        <span class="adv-action-hint">Changes show on the public Articles page within a minute.</span>
      </div>
    </div>`;

  const urlInput   = root.querySelector("#hero-url");
  const fileInput  = root.querySelector("#hero-file");
  const uploadBtn  = root.querySelector("#hero-upload-btn");
  const uploadStat = root.querySelector("#hero-upload-status");
  const previewImg = root.querySelector("#hero-preview-img");
  const badge      = root.querySelector("#hero-source-badge");
  const msgEl      = root.querySelector("#hero-msg");
  const saveBtn    = root.querySelector("#hero-save");
  const resetBtn   = root.querySelector("#hero-reset");

  let defaultImage = "";  // newest published story's cover (the auto default)
  let savedOverride = ""; // what's currently persisted

  function setPreview(src, isOverride) {
    const shown = src || defaultImage || "";
    previewImg.style.backgroundImage = shown ? `url('${shown.replace(/'/g, "%27")}')` : "none";
    badge.textContent = isOverride ? "Custom (pinned)" : "Default · newest story";
  }

  // Live-preview whatever's typed; empty falls back to the default.
  urlInput.addEventListener("input", () => {
    const v = urlInput.value.trim();
    setPreview(v, !!v);
  });

  // Load the current override + the newest published story's cover in parallel.
  (async () => {
    try {
      const [overrideSnap, newest] = await Promise.all([
        getDoc(doc(db, ...HERO_SETTINGS_PATH)),
        fetchNewestPublishedCover(),
      ]);
      defaultImage = newest || "";
      savedOverride = (overrideSnap.exists() && overrideSnap.data().image) || "";
      urlInput.value = savedOverride;
      setPreview(savedOverride, !!savedOverride);
    } catch (err) {
      msgEl.textContent = "Could not load current hero settings: " + (err.message || err);
    }
  })();

  uploadBtn.addEventListener("click", () => fileInput.click());

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { msgEl.textContent = "Pick an image file."; return; }
    msgEl.textContent = "";
    uploadBtn.disabled = true;
    uploadStat.textContent = "Uploading… 0%";
    try {
      const url = await uploadHeroImage(file, ctx, (pct) => { uploadStat.textContent = `Uploading… ${pct}%`; });
      uploadStat.textContent = "Uploaded ✓";
      urlInput.value = url;
      setPreview(url, true);
    } catch (err) {
      uploadStat.textContent = "";
      msgEl.textContent = "Upload failed: " + (err.message || err);
    } finally {
      uploadBtn.disabled = false;
      fileInput.value = "";
    }
  });

  saveBtn.addEventListener("click", async () => {
    const image = urlInput.value.trim();
    msgEl.style.color = "var(--danger,#b91c1c)";
    msgEl.textContent = "";
    if (!image) {
      msgEl.textContent = "Enter a URL or upload an image — or use Reset to go back to the default.";
      return;
    }
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving…";
    try {
      await setDoc(doc(db, ...HERO_SETTINGS_PATH), {
        image,
        updatedAt: new Date().toISOString(),
        updatedBy: ctx?.profile?.email || ctx?.user?.email || "admin",
      }, { merge: true });
      savedOverride = image;
      setPreview(image, true);
      toast("Homepage hero image saved.", "success");
    } catch (err) {
      msgEl.textContent = "Save failed: " + (err.message || err);
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = "Save hero image";
    }
  });

  resetBtn.addEventListener("click", async () => {
    const ok = await confirmDialog(
      "Reset the homepage hero back to the newest published story's cover? The pinned custom image will be cleared.",
      { confirmText: "Reset to default", danger: false }
    );
    if (!ok) return;
    resetBtn.disabled = true;
    try {
      // Clearing image (empty string) makes the public page fall back to the
      // newest story's cover. We keep the doc (with an audit trail) rather
      // than deleting it.
      await setDoc(doc(db, ...HERO_SETTINGS_PATH), {
        image: "",
        updatedAt: new Date().toISOString(),
        updatedBy: ctx?.profile?.email || ctx?.user?.email || "admin",
      }, { merge: true });
      savedOverride = "";
      urlInput.value = "";
      uploadStat.textContent = "";
      setPreview("", false);
      toast("Hero reset to the newest story's cover.", "success");
    } catch (err) {
      msgEl.textContent = "Reset failed: " + (err.message || err);
    } finally {
      resetBtn.disabled = false;
    }
  });
}

// Newest published story's cover image — the automatic hero default. Mirrors
// the public page's source of truth so the preview here matches the live site.
async function fetchNewestPublishedCover() {
  const qy = query(
    collection(db, "stories"),
    where("status", "==", "published"),
    orderBy("publishedAt", "desc"),
    limit(1)
  );
  const snap = await getDocs(qy);
  if (snap.empty) return "";
  const d = snap.docs[0].data();
  return d.coverImage || d.image || "";
}

// Upload a hero image to Storage and return its download URL. We write under
// stories/{uid}/hero/ — the same stories/{uid}/ prefix per-story uploads
// already use — so this works under the existing Storage security rules
// without needing a separate rules path for the homepage hero.
function uploadHeroImage(file, ctx, onProgress) {
  const uid = ctx?.user?.uid;
  if (!uid) return Promise.reject(new Error("Not signed in."));
  const ext = (file.name.match(/\.[a-z0-9]+$/i) || [""])[0].toLowerCase() || ".jpg";
  const safe = `hero-${Date.now()}${ext}`;
  const ref = storageRef(storage, `stories/${uid}/hero/${safe}`);
  const task = uploadBytesResumable(ref, file, { contentType: file.type });
  return new Promise((resolve, reject) => {
    task.on(
      "state_changed",
      (snap) => onProgress && onProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100)),
      (err) => reject(err),
      async () => {
        try { resolve(await getDownloadURL(task.snapshot.ref)); }
        catch (err) { reject(err); }
      }
    );
  });
}

// ─── Announcements ───────────────────────────────────────────────────────────
// Post a red alert banner to every staff member's dashboard Overview, with an
// optional one-click email blast to the whole team. Banners live in the
// `announcements` collection; the Overview renders the active ones.

function mountAnnounceTool(ctx, root) {
  root.innerHTML = `
    ${paneHeader("Staff announcements", `Post a <strong>red alert banner</strong> to the top of every staff member's dashboard Overview — a meeting reminder, a When2meet to fill out, a Zoom link. Optionally email the whole team the same message. Banners stay up until you remove them (or until an expiry date you set).`)}
    <div class="adv-pane-body" style="display:grid;gap:18px;">
      <form id="ann-form" style="display:grid;gap:14px;max-width:620px;">
        <label style="display:grid;gap:5px;">
          <span style="font-weight:600;font-size:13px;">Headline *</span>
          <input id="ann-title" required maxlength="160" placeholder="e.g. Staff meeting today at 6pm" autocomplete="off"
                 style="padding:10px 12px;border:1px solid var(--hairline,#e5e7eb);border-radius:8px;font-size:14px;font-family:inherit;">
        </label>
        <label style="display:grid;gap:5px;">
          <span style="font-weight:600;font-size:13px;">Details <span style="font-weight:400;color:var(--muted);">(optional)</span></span>
          <textarea id="ann-message" rows="3" maxlength="4000" placeholder="Add any context — agenda, what to bring, deadline to respond by…"
                    style="padding:10px 12px;border:1px solid var(--hairline,#e5e7eb);border-radius:8px;font-size:14px;font-family:inherit;line-height:1.5;resize:vertical;"></textarea>
        </label>
        <div style="display:grid;grid-template-columns:2fr 1fr;gap:10px;">
          <label style="display:grid;gap:5px;min-width:0;">
            <span style="font-weight:600;font-size:13px;">Button link <span style="font-weight:400;color:var(--muted);">(optional)</span></span>
            <input id="ann-link" type="url" placeholder="https://when2meet.com/…  or  Zoom URL" autocomplete="off"
                   style="padding:10px 12px;border:1px solid var(--hairline,#e5e7eb);border-radius:8px;font-size:14px;font-family:inherit;">
          </label>
          <label style="display:grid;gap:5px;min-width:0;">
            <span style="font-weight:600;font-size:13px;">Button text</span>
            <input id="ann-link-label" maxlength="40" placeholder="Open link" autocomplete="off"
                   style="padding:10px 12px;border:1px solid var(--hairline,#e5e7eb);border-radius:8px;font-size:14px;font-family:inherit;">
          </label>
        </div>
        <label style="display:grid;gap:5px;max-width:220px;">
          <span style="font-weight:600;font-size:13px;">Auto-remove on <span style="font-weight:400;color:var(--muted);">(optional)</span></span>
          <input id="ann-expires" type="date"
                 style="padding:9px 12px;border:1px solid var(--hairline,#e5e7eb);border-radius:8px;font-size:14px;font-family:inherit;">
        </label>
        <label style="display:flex;align-items:flex-start;gap:9px;cursor:pointer;padding:12px 14px;border:1px solid #fecaca;background:#fef2f2;border-radius:10px;">
          <input id="ann-email" type="checkbox" style="margin-top:2px;width:16px;height:16px;flex-shrink:0;">
          <span style="font-size:13.5px;line-height:1.5;color:var(--ink-2,#374151);">
            <strong>Also email this to the whole team</strong> — sends the announcement to every staff member's inbox right now. Use it when you really need eyes on it (the banner alone is silent).
          </span>
        </label>
        <div id="ann-msg" style="font-size:13px;min-height:18px;color:var(--danger,#b91c1c);"></div>
        <div style="display:flex;gap:10px;align-items:center;">
          <button type="submit" id="ann-post" class="btn btn-accent btn-sm">Post announcement</button>
          <span class="adv-action-hint">Appears on every staff Overview within seconds of posting.</span>
        </div>
      </form>

      <div style="border-top:1px solid var(--hairline,#e5e7eb);padding-top:16px;">
        <div style="font-weight:700;font-size:13px;letter-spacing:0.04em;text-transform:uppercase;color:var(--muted,#6b7280);margin-bottom:10px;">Currently live</div>
        <div id="ann-list"><div class="loading-state"><div class="spinner"></div>Loading…</div></div>
      </div>
    </div>`;

  const form = root.querySelector("#ann-form");
  const msgEl = root.querySelector("#ann-msg");
  const postBtn = root.querySelector("#ann-post");
  const listEl = root.querySelector("#ann-list");

  const refreshList = async () => {
    try {
      const snap = await getDocs(query(collection(db, "announcements"), limit(50)));
      const items = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((a) => a.active !== false)
        .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
      renderAnnList(listEl, items, ctx, refreshList);
    } catch (err) {
      listEl.innerHTML = `<div class="error-state">Could not load announcements: ${esc(err.message || err)}</div>`;
    }
  };

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    msgEl.style.color = "var(--danger,#b91c1c)";
    msgEl.textContent = "";

    const title = root.querySelector("#ann-title").value.trim();
    const message = root.querySelector("#ann-message").value.trim();
    const link = root.querySelector("#ann-link").value.trim();
    const linkLabel = root.querySelector("#ann-link-label").value.trim();
    const expires = root.querySelector("#ann-expires").value;
    const alsoEmail = root.querySelector("#ann-email").checked;

    if (!title) { msgEl.textContent = "A headline is required."; return; }

    postBtn.disabled = true;
    postBtn.textContent = alsoEmail ? "Posting & emailing…" : "Posting…";
    try {
      const now = new Date().toISOString();
      const docData = {
        title,
        message,
        link,
        linkLabel: linkLabel || (link ? "Open link" : ""),
        active: true,
        emailed: false,
        expiresAt: expires ? `${expires}T23:59:59.999Z` : null,
        createdAt: now,
        createdById: ctx.user.uid,
        createdByName: ctx.profile?.name || ctx.user.email || "Admin",
      };
      const ref = await addDoc(collection(db, "announcements"), docData);

      if (alsoEmail) {
        try {
          const res = await ctx.authedFetch("/api/notify/announcement", {
            method: "POST",
            body: JSON.stringify({ announcementId: ref.id, title, message, link }),
          });
          const data = await res.json().catch(() => ({}));
          if (res.ok && data.sent) {
            await updateDoc(ref, { emailed: true, emailedCount: data.recipientCount || 0, emailedAt: now });
            msgEl.style.color = "var(--success,#0f766e)";
            msgEl.textContent = `Posted and emailed to ${data.recipientCount} staff member${data.recipientCount === 1 ? "" : "s"}.`;
          } else {
            msgEl.style.color = "var(--success,#0f766e)";
            msgEl.textContent = "Posted to the banner. (Email didn't send — check Resend config.)";
          }
        } catch {
          msgEl.style.color = "var(--success,#0f766e)";
          msgEl.textContent = "Posted to the banner. (Email didn't send.)";
        }
      } else {
        msgEl.style.color = "var(--success,#0f766e)";
        msgEl.textContent = "Announcement is live on every staff Overview.";
      }

      form.reset();
      refreshList();
    } catch (err) {
      msgEl.style.color = "var(--danger,#b91c1c)";
      msgEl.textContent = `Could not post: ${err.message || err}`;
    } finally {
      postBtn.disabled = false;
      postBtn.textContent = "Post announcement";
    }
  });

  refreshList();
}

function renderAnnList(listEl, items, ctx, refresh) {
  if (!items.length) {
    listEl.innerHTML = `<div class="empty-state" style="padding:20px;">No live announcements. Post one above and it shows up on every staff Overview.</div>`;
    return;
  }
  listEl.innerHTML = "";
  for (const a of items) {
    const row = el("div", {
      style: "display:flex;justify-content:space-between;align-items:flex-start;gap:14px;padding:12px 14px;border:1px solid #fecaca;background:#fef2f2;border-radius:10px;margin-bottom:8px;",
    });
    row.innerHTML = `
      <div style="min-width:0;flex:1;">
        <div style="font-weight:700;font-size:14px;color:var(--ink,#0a0a0c);">${esc(a.title || "Announcement")}</div>
        ${a.message ? `<div style="margin-top:3px;font-size:13px;color:var(--ink-2,#374151);line-height:1.5;white-space:pre-wrap;">${esc(a.message)}</div>` : ""}
        <div style="margin-top:6px;font-size:11.5px;color:var(--muted,#6b7280);">
          ${a.createdByName ? `By ${esc(a.createdByName)}` : ""}${a.createdAt ? ` · ${esc(fmtAnnDate(a.createdAt))}` : ""}${a.emailed ? ` · emailed${a.emailedCount ? ` to ${a.emailedCount}` : ""}` : " · banner only"}${a.expiresAt ? ` · auto-removes ${esc(fmtAnnDate(a.expiresAt))}` : ""}
        </div>
      </div>
      <button type="button" class="btn btn-ghost btn-xs" data-remove style="color:#b91c1c;white-space:nowrap;flex-shrink:0;">Remove</button>`;
    row.querySelector("[data-remove]").addEventListener("click", async () => {
      const ok = await confirmDialog(`Remove "${a.title || "this announcement"}" from everyone's dashboard?`, { confirmText: "Remove", danger: true });
      if (!ok) return;
      try {
        await deleteDoc(doc(db, "announcements", a.id));
        ctx.toast("Announcement removed.", "success");
        refresh();
      } catch (err) {
        ctx.toast(`Could not remove: ${err.message || err}`, "error");
      }
    });
    listEl.appendChild(row);
  }
}

function fmtAnnDate(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function mountImportTool(ctx, root) {
  root.innerHTML = `
    ${paneHeader("Import from Wix CSV", `Upload a <code>Posts.csv</code> export from your old Wix blog. Each row becomes a <strong>draft</strong> you can review and publish from <em>All articles &amp; approvals</em>. Existing articles with the same slug are skipped — re-imports are safe.`)}
    <div class="adv-actions">
      <label class="btn btn-accent btn-sm" style="cursor:pointer;">
        <input id="csv-file" type="file" accept=".csv,text/csv" style="display:none;">
        Choose CSV file
      </label>
      <span class="adv-action-hint">Files stay in your browser until you click "Import" on the preview.</span>
    </div>
    <div id="import-panel" class="adv-pane-body"></div>`;

  const fileInput = root.querySelector("#csv-file");
  const panel = root.querySelector("#import-panel");

  fileInput.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    panel.innerHTML = `<div class="loading-state"><div class="spinner"></div>Parsing ${esc(file.name)}…</div>`;
    try {
      const text = await file.text();
      const { headers, rows } = parseCSV(text);
      const parsed = rows.map((r) => mapRow(headers, r)).filter((p) => p.title && p.body);
      if (!parsed.length) {
        panel.innerHTML = `<div class="empty-state">No usable rows found. Make sure the CSV has Title and Plain Content columns.</div>`;
        return;
      }
      renderPreview(ctx, panel, parsed);
    } catch (err) {
      console.error(err);
      panel.innerHTML = `<div class="error-state">Parse failed: ${esc(err.message)}</div>`;
    }
    fileInput.value = "";
  });
}

function mountExportTool(ctx, root) {
  root.innerHTML = `
    ${paneHeader("Export all articles as TXT", `Downloads a single <code>.txt</code> with every article's title, byline, status, URL, cover image, excerpt, and full body. Drop the file into ChatGPT or Claude for editing help.`)}
    <div class="adv-actions">
      <button id="export-txt" class="btn btn-accent btn-sm">Export articles</button>
      <span id="export-status" class="adv-action-hint"></span>
    </div>`;

  const exportBtn = root.querySelector("#export-txt");
  const exportStatus = root.querySelector("#export-status");

  exportBtn.addEventListener("click", async () => {
    exportBtn.disabled = true;
    exportBtn.textContent = "Exporting…";
    exportStatus.textContent = "Fetching articles…";
    try {
      // No orderBy — Firestore drops any doc missing the order field, which
      // silently excluded older articles that never had `updatedAt` stamped.
      // We grab everything and sort client-side with a dated fallback chain.
      const snap = await getDocs(collection(db, "stories"));
      const stories = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => sortKey(b) - sortKey(a));
      const txt = storiesToTxt(stories);
      downloadText(`catalyst-articles-${dateStamp()}.txt`, txt);
      exportStatus.textContent = `Exported ${stories.length} article${stories.length === 1 ? "" : "s"}.`;
      toast(`Exported ${stories.length} articles.`, "success");
    } catch (err) {
      console.error(err);
      exportStatus.innerHTML = `<span style="color:var(--danger);">Export failed: ${esc(err.message)}</span>`;
      toast("Export failed.", "error");
    } finally {
      exportBtn.disabled = false;
      exportBtn.textContent = "Export articles";
    }
  });
}

function mountWelcomeTool(ctx, root) {
  root.innerHTML = `
    ${paneHeader("Welcome email sender", `Send a new contributor an onboarding email with their sign-in details and a role-specific walkthrough of the editorial suite. Recently joined users (last ${RECENT_JOIN_DAYS} days) are highlighted at the top — but you can force-send the welcome email to any user.`)}
    <div class="adv-actions">
      <button id="welcome-refresh" class="btn btn-secondary btn-sm">Refresh list</button>
    </div>
    <div id="welcome-panel" class="adv-pane-body">
      <div class="loading-state"><div class="spinner"></div>Loading users…</div>
    </div>`;

  const welcomePanel = root.querySelector("#welcome-panel");
  const welcomeRefresh = root.querySelector("#welcome-refresh");
  const loadWelcome = () => loadWelcomeEmailSender(ctx, welcomePanel);
  // Attach the click delegate once — loadWelcomeEmailSender only swaps
  // innerHTML, so the panel element itself sticks around and a single
  // listener handles every Send button across refreshes.
  welcomePanel.addEventListener("click", (e) => handleWelcomeClick(e, ctx));
  welcomeRefresh.addEventListener("click", loadWelcome);
  loadWelcome();
}

function mountGuidanceTool(ctx, root) {
  root.innerHTML = `
    ${paneHeader("Send email guidance", `Send a polished, detailed help email from Aidan and Yair to a selected user. Use this when a writer, editor, newsletter builder, or marketing teammate is confused about a dashboard workflow.`)}
    <div class="adv-actions">
      <button id="guidance-refresh" class="btn btn-secondary btn-sm">Refresh</button>
    </div>
    <div id="guidance-panel" class="adv-pane-body">
      <div class="loading-state"><div class="spinner"></div>Loading guidance tool…</div>
    </div>`;

  const guidancePanel = root.querySelector("#guidance-panel");
  const guidanceRefresh = root.querySelector("#guidance-refresh");
  const loadGuidance = () => loadGuidanceEmailTool(ctx, guidancePanel);
  guidanceRefresh.addEventListener("click", loadGuidance);
  loadGuidance();
}

function mountWinnersTool(ctx, root) {
  root.innerHTML = `
    ${paneHeader("Winners' Chat manager", `Edit any message that solvers have left in the Winners' Lounge. Change the <strong>display name</strong>, <strong>title</strong>, <strong>message text</strong>, <strong>like count</strong>, and <strong>posted date</strong>, or delete a message entirely.`)}
    <div class="adv-actions">
      <button id="winners-chat-refresh" class="btn btn-secondary btn-sm">Refresh</button>
    </div>
    <div id="winners-chat-panel" class="adv-pane-body">
      <div class="loading-state"><div class="spinner"></div>Loading messages…</div>
    </div>`;

  const winnersPanel = root.querySelector("#winners-chat-panel");
  const winnersRefresh = root.querySelector("#winners-chat-refresh");
  const loadWinners = () => loadWinnersChat(winnersPanel);
  winnersPanel.addEventListener("click", (e) => handleWinnersChatClick(e, winnersPanel));
  winnersRefresh.addEventListener("click", loadWinners);
  loadWinners();
}

// ─── Styles ─────────────────────────────────────────────────────────────────

function ensureAdvancedToolsStyles() {
  if (document.getElementById("adv-tools-styles")) return;
  const s = document.createElement("style");
  s.id = "adv-tools-styles";
  s.textContent = `
    .adv-card { overflow:hidden; }
    .adv-header { border-bottom:1px solid var(--hairline); }

    /* ── 2-col layout: rail + pane ── */
    .adv-body {
      display:grid;
      grid-template-columns: 280px 1fr;
      min-height:540px;
    }
    @media (max-width: 880px) {
      .adv-body { grid-template-columns: 1fr; }
      .adv-rail { border-right:0; border-bottom:1px solid var(--hairline); }
    }

    /* ── Left rail ── */
    .adv-rail {
      display:flex;
      flex-direction:column;
      gap:2px;
      padding:14px 10px;
      background:var(--surface-2, #f8fafc);
      border-right:1px solid var(--hairline);
    }
    .adv-rail-item {
      all:unset;
      display:grid;
      grid-template-columns:32px 1fr;
      gap:12px;
      align-items:flex-start;
      padding:10px 12px;
      border-radius:8px;
      cursor:pointer;
      color:var(--ink-2);
      transition:background .12s ease, color .12s ease;
    }
    .adv-rail-item:hover {
      background:rgba(15,23,42,0.05);
      color:var(--ink);
    }
    .adv-rail-item:focus-visible {
      outline:2px solid var(--ink);
      outline-offset:2px;
    }
    .adv-rail-item[aria-selected="true"] {
      background:#fff;
      color:var(--ink);
      box-shadow:0 1px 2px rgba(15,23,42,0.05), inset 3px 0 0 var(--ink, #0f172a);
    }
    .adv-rail-icon {
      display:inline-flex;
      align-items:center;
      justify-content:center;
      width:32px; height:32px;
      border-radius:6px;
      background:rgba(15,23,42,0.06);
    }
    .adv-rail-icon svg { width:16px; height:16px; }
    .adv-rail-item[aria-selected="true"] .adv-rail-icon {
      background:var(--ink);
      color:#fff;
    }
    .adv-rail-text { display:flex; flex-direction:column; gap:2px; min-width:0; }
    .adv-rail-label {
      font-size:13px;
      font-weight:600;
      letter-spacing:-0.005em;
      display:inline-flex;
      align-items:center;
      gap:6px;
      flex-wrap:wrap;
    }
    .adv-rail-summary {
      font-size:11.5px;
      color:var(--muted);
      line-height:1.4;
    }
    .adv-rail-badge {
      font-size:9px;
      font-weight:700;
      letter-spacing:0.08em;
      text-transform:uppercase;
      color:#92400e;
      background:#fef3c7;
      padding:2px 6px;
      border-radius:999px;
    }

    /* ── Right pane ── */
    .adv-pane {
      padding:28px 32px 32px;
      background:#fff;
      min-width:0;
    }
    @media (max-width: 880px) {
      .adv-pane { padding:22px 18px 24px; }
    }
    .adv-pane-content { display:flex; flex-direction:column; gap:18px; }
    .adv-pane-header { padding:0; margin:0; }
    .adv-pane-title {
      font-size:20px;
      font-weight:700;
      letter-spacing:-0.015em;
      color:var(--ink);
      margin:0 0 6px;
    }
    .adv-pane-sub {
      font-size:13.5px;
      line-height:1.55;
      color:var(--muted);
      margin:0;
      max-width:680px;
    }
    .adv-pane-sub code {
      font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
      font-size:12px;
      background:var(--surface-2,#f1f5f9);
      padding:1px 6px;
      border-radius:4px;
    }
    .adv-pane-body { margin-top:6px; }

    /* ── Action row (button + status hint) ── */
    .adv-actions {
      display:flex;
      gap:12px;
      align-items:center;
      flex-wrap:wrap;
      padding:14px 0;
      border-top:1px solid var(--hairline);
      border-bottom:1px solid var(--hairline);
    }
    .adv-action-hint {
      font-size:12.5px;
      color:var(--muted);
      line-height:1.4;
    }
  `;
  document.head.appendChild(s);
}

// ---------- CSV parsing ----------
// State machine. Handles quoted fields, embedded newlines, and "" escapes.
function parseCSV(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1); // BOM
  const rows = [];
  let field = "";
  let row = [];
  let i = 0;
  let inQuotes = false;
  const len = text.length;
  while (i < len) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === ",") { row.push(field); field = ""; i++; continue; }
    if (c === "\r") { i++; continue; }
    if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
    field += c; i++;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return { headers: [], rows: [] };
  const headers = rows.shift().map((h) => h.trim());
  const nonEmpty = rows.filter((r) => r.some((v) => v && v.trim()));
  return { headers, rows: nonEmpty };
}

function mapRow(headers, row) {
  const get = (name) => {
    const idx = headers.indexOf(name);
    return idx >= 0 ? (row[idx] || "") : "";
  };
  const title = get("Title").trim();
  // Use the CSV's Author value as-is (admin can override in Edit details).
  // Wix exports often store a UUID here rather than a readable name — flag it
  // in the preview so the admin notices and fixes it before publishing.
  const author = get("Author").trim();
  const excerpt = get("Excerpt").trim();
  const cover = get("Cover Image").trim();
  const plain = get("Plain Content");
  const published = get("Published Date").trim();
  const slugRaw = get("Slug").trim();
  const category = get("Main Category").trim();

  return {
    title,
    authorName: author,
    dek: excerpt,
    coverImage: cover,
    body: plainToHtml(plain),
    publishedAt: normalizeDate(published),
    slug: slugRaw ? slugify(slugRaw) : slugify(title),
    category: mapCategory(category),
  };
}

// Wix "Plain Content" is a single flat string: paragraph boundaries are
// signalled (inconsistently) by double-newlines, but Wix also injects stray
// single newlines mid-sentence — often right after abbreviations like "Dr.",
// "D.C.", or "Ph.D." Splitting on those newlines produced fragments like
// "...from the treetops. Dr." followed by "Kelly Russo-Petrick". We treat
// single newlines as soft breaks (glue them back with a space), and only
// split on hard paragraph boundaries (double-newline, or sentence-end
// followed by newline and a capital letter that isn't a known abbreviation).
function plainToHtml(raw) {
  if (!raw) return "";
  let cleaned = String(raw).replace(/\r\n/g, "\n").trim();
  if (!cleaned) return "";

  // 1. Collapse runs of whitespace within each line so single newlines that
  //    split a sentence across "lines" get normalized to a single space.
  cleaned = cleaned.replace(/[ \t]+/g, " ");

  // 2. Normalize single newlines to spaces unless they look like a real
  //    paragraph break. A real break = blank line, OR the prior character is
  //    a sentence-ending punctuation *that isn't a common abbreviation* and
  //    the next line starts with a capital.
  const KNOWN_ABBREVS = [
    "Dr", "Mr", "Mrs", "Ms", "Prof", "Sr", "Jr", "St", "Ave", "Rd", "Blvd",
    "Inc", "Ltd", "Co", "Corp", "Rev", "Gen", "Gov", "Pres", "Sen", "Rep",
    "U.S", "U.K", "U.N", "D.C", "N.Y", "L.A", "Ph.D", "M.D", "B.A", "M.A",
    "a.m", "p.m", "etc", "vs", "e.g", "i.e",
  ];
  const abbrevTest = new RegExp(
    "(?:\\b(?:" + KNOWN_ABBREVS.map((a) => a.replace(/\./g, "\\.")).join("|") + ")\\.)$",
    "i",
  );

  // Work line-by-line; join each pair with " " or "\n\n" as appropriate.
  const lines = cleaned.split(/\n/);
  let out = "";
  for (let i = 0; i < lines.length; i++) {
    const cur = lines[i].trim();
    if (!cur) {
      // blank line → hard paragraph break
      if (!out.endsWith("\n\n") && out.length) out += "\n\n";
      continue;
    }
    if (!out) { out = cur; continue; }
    if (out.endsWith("\n\n")) { out += cur; continue; }

    const prevEndsSentence = /[.!?][")\]]?$/.test(out);
    const nextStartsCapital = /^[A-Z“"(\[]/.test(cur);
    const prevIsAbbrev = abbrevTest.test(out);

    if (prevEndsSentence && nextStartsCapital && !prevIsAbbrev) {
      out += "\n\n" + cur; // real paragraph break
    } else {
      out += " " + cur; // soft line break → merge
    }
  }

  // 3. Final split into paragraphs.
  const chunks = out.split(/\n{2,}/).map((c) => c.trim()).filter(Boolean);
  return chunks.map((c) => `<p>${escapeHtml(c)}</p>`).join("\n");
}

function looksLikeUuid(s) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function normalizeDate(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

function mapCategory(wixCategory) {
  if (!wixCategory) return "Feature";
  const allowed = ["Feature", "Profile", "Interview", "Op-Ed", "News", "Science"];
  const hit = allowed.find((c) => c.toLowerCase() === wixCategory.toLowerCase());
  return hit || "Feature";
}

// ---------- Preview + import ----------
function renderPreview(ctx, panel, items) {
  panel.innerHTML = "";
  const header = el("div", {
    style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap", marginBottom: "10px" },
  });
  header.innerHTML = `
    <div style="font-weight:700;color:var(--ink-1);">Found ${items.length} article${items.length === 1 ? "" : "s"}</div>
    <div style="display:flex;gap:8px;">
      <button class="btn btn-secondary btn-sm" id="toggle-all">Toggle all</button>
      <button class="btn btn-accent btn-sm" id="import-btn">Import selected</button>
    </div>`;
  panel.appendChild(header);

  const list = el("div", { style: { display: "grid", gap: "8px", maxHeight: "480px", overflow: "auto", padding: "4px" } });
  items.forEach((a, idx) => {
    const row = el("div", {
      style: {
        display: "grid",
        gridTemplateColumns: "28px 1fr",
        gap: "10px",
        alignItems: "start",
        padding: "10px 12px",
        border: "1px solid var(--hairline)",
        borderRadius: "8px",
        background: "var(--surface)",
      },
    });
    const authorIsUuid = looksLikeUuid(a.authorName);
    const authorValue = authorIsUuid ? "" : (a.authorName || "");
    const dateValue = toDatetimeLocal(a.publishedAt);
    row.innerHTML = `
      <input type="checkbox" data-idx="${idx}" checked style="margin-top:4px;">
      <div>
        <div style="font-weight:600;color:var(--ink-1);">${esc(a.title)}</div>
        <div class="article-meta" style="margin-top:2px;">${esc(a.category)}${a.dek ? " · " + esc(a.dek.slice(0, 140)) + (a.dek.length > 140 ? "…" : "") : ""}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px;">
          <label style="display:grid;gap:4px;font-size:12px;color:var(--ink-2);">
            Author
            <input type="text" data-field="author" data-idx="${idx}" value="${esc(authorValue)}" placeholder="${authorIsUuid ? "UUID — enter real name" : "Author name"}"
              style="padding:6px 8px;border:1px solid ${authorIsUuid ? "var(--danger)" : "var(--hairline)"};border-radius:6px;background:var(--surface);color:var(--ink-1);font-size:13px;">
          </label>
          <label style="display:grid;gap:4px;font-size:12px;color:var(--ink-2);">
            Published
            <input type="datetime-local" data-field="date" data-idx="${idx}" value="${esc(dateValue)}"
              style="padding:6px 8px;border:1px solid var(--hairline);border-radius:6px;background:var(--surface);color:var(--ink-1);font-size:13px;">
          </label>
        </div>
        ${authorIsUuid ? `<div class="hint" style="margin-top:4px;color:var(--danger);">⚠ Wix stored a UUID for this author — enter the real name above.</div>` : ""}
      </div>`;
    list.appendChild(row);
  });
  panel.appendChild(list);

  const status = el("div", { class: "hint", style: { marginTop: "10px" } });
  panel.appendChild(status);

  panel.querySelector("#toggle-all").addEventListener("click", () => {
    const boxes = panel.querySelectorAll('input[type="checkbox"][data-idx]');
    const allOn = Array.from(boxes).every((b) => b.checked);
    boxes.forEach((b) => { b.checked = !allOn; });
  });

  panel.querySelector("#import-btn").addEventListener("click", async () => {
    // Pull edited author/date values back onto the items before importing.
    panel.querySelectorAll('input[data-field="author"]').forEach((input) => {
      const idx = parseInt(input.dataset.idx, 10);
      const val = input.value.trim();
      if (val) items[idx].authorName = val;
      else if (looksLikeUuid(items[idx].authorName)) items[idx].authorName = "";
    });
    panel.querySelectorAll('input[data-field="date"]').forEach((input) => {
      const idx = parseInt(input.dataset.idx, 10);
      const val = input.value.trim();
      if (val) {
        const d = new Date(val);
        if (Number.isFinite(d.getTime())) items[idx].publishedAt = d.toISOString();
      } else {
        items[idx].publishedAt = null;
      }
    });

    const boxes = Array.from(panel.querySelectorAll('input[type="checkbox"][data-idx]'));
    const selected = boxes.filter((b) => b.checked).map((b) => items[parseInt(b.dataset.idx, 10)]);
    if (!selected.length) { toast("Nothing selected.", "error"); return; }

    const btn = panel.querySelector("#import-btn");
    btn.disabled = true;
    btn.textContent = "Importing…";
    let created = 0, skipped = 0, failed = 0;
    const errors = [];
    for (let i = 0; i < selected.length; i++) {
      const a = selected[i];
      status.textContent = `Importing ${i + 1} / ${selected.length} — ${a.title}`;
      try {
        if (a.slug && await slugExists(a.slug)) { skipped++; continue; }
        // Firestore rules require authorId == request.auth.uid and status in
        // ['draft','pending'] for a writer/editor/admin creating a story. We
        // import as drafts owned by the admin so they can review and publish.
        // Byline comes from the CSV (admin can fix it in Edit details); the
        // original Wix publish date is used unless the admin overrides.
        const adminName = ctx.profile.name || ctx.user.email;
        const byline = a.authorName || adminName;
        await addDoc(collection(db, "stories"), {
          title: a.title,
          slug: a.slug,
          category: a.category,
          coverImage: a.coverImage,
          dek: a.dek,
          // `body` is used by the dashboard editor; `content` is what the
          // public article page reads (see firestoreDocToArticle in main.js).
          // Keep them in sync so the article renders after publish.
          body: a.body,
          content: a.body,
          authorName: byline,
          authorId: ctx.user.uid,
          authors: [{ name: byline }],
          status: "draft",
          publishedAt: a.publishedAt || null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          importedFromWix: true,
          importedById: ctx.user.uid,
          importedByName: adminName,
        });
        created++;
      } catch (err) {
        console.error("import failed:", a.title, err);
        errors.push(`${a.title}: ${err.message}`);
        failed++;
      }
    }
    btn.disabled = false;
    btn.textContent = "Import selected";
    status.innerHTML = `Done — <strong>${created}</strong> imported as drafts, ${skipped} skipped (duplicate slug), ${failed} failed.`;
    if (failed) {
      const details = el("details", { style: { marginTop: "8px" } });
      details.innerHTML = `<summary style="cursor:pointer;color:var(--danger);">Show ${failed} error${failed === 1 ? "" : "s"}</summary>
        <pre style="white-space:pre-wrap;font-size:12px;color:var(--ink-2);margin-top:6px;">${esc(errors.join("\n"))}</pre>`;
      status.appendChild(details);
    }
    if (created) toast(`Imported ${created} draft${created === 1 ? "" : "s"}. Review them under All articles.`, "success", 5000);
    else if (failed) toast(`Import failed for ${failed} article${failed === 1 ? "" : "s"}.`, "error");
  });
}

async function slugExists(slug) {
  try {
    const snap = await getDocs(query(collection(db, "stories"), where("slug", "==", slug)));
    return !snap.empty;
  } catch {
    return false;
  }
}

function toDatetimeLocal(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Sort key for stories: prefer publishedAt, then createdAt, then updatedAt.
// Any of these can be a Firestore Timestamp, an ISO string, a millisecond
// number, or missing. Returns 0 for anything unparseable so docs still sort
// rather than being dropped.
function sortKey(s) {
  return tsToMillis(s.publishedAt)
      || tsToMillis(s.createdAt)
      || tsToMillis(s.updatedAt)
      || 0;
}

function tsToMillis(v) {
  if (v == null) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : 0;
  }
  // Firestore Timestamp SDK object
  if (typeof v.toMillis === "function") {
    try { return v.toMillis(); } catch { return 0; }
  }
  // Firestore REST shape { seconds, nanoseconds } or toDate()
  if (typeof v.toDate === "function") {
    try { return v.toDate().getTime(); } catch { return 0; }
  }
  if (typeof v.seconds === "number") {
    return v.seconds * 1000 + Math.floor((v.nanoseconds || 0) / 1e6);
  }
  return 0;
}

// ---------- TXT export ----------
// Dumps every field on every story. Body is rendered both as the raw HTML
// (so the export is lossless) and as a plain-text version (so it's easy to
// paste into an LLM). New schema fields land here automatically — we iterate
// the doc's own keys instead of whitelisting.
function storiesToTxt(stories) {
  const header = [
    "Catalyst articles export",
    `Generated: ${new Date().toISOString()}`,
    `Total: ${stories.length}`,
    "",
  ].join("\n");

  // Fields that get special rendering and should be omitted from the generic
  // "all other fields" dump at the bottom of each block.
  const HANDLED = new Set([
    "id", "title", "slug", "category", "status",
    "authorName", "authorId", "author",
    "publishedAt", "createdAt", "updatedAt",
    "coverImage", "image", "lightCover",
    "dek", "excerpt",
    "body", "content",
  ]);

  const blocks = stories.map((s, i) => {
    const bodyHtml = s.body || s.content || "";
    const bodyText = htmlToPlain(bodyHtml);

    const topFields = [
      ["#", String(i + 1)],
      ["ID", s.id || ""],
      ["Title", s.title || ""],
      ["Slug", s.slug || ""],
      ["Category", s.category || ""],
      ["Status", s.status || ""],
      ["Author", s.authorName || s.author || ""],
      ["Author ID", s.authorId || ""],
      ["Published at", fmtDate(s.publishedAt)],
      ["Created at", fmtDate(s.createdAt)],
      ["Updated at", fmtDate(s.updatedAt)],
      ["URL", s.slug
        ? `${String(s.category || "").toLowerCase() === "book-review" ? "/book-review/" : "/article/"}${s.slug}`
        : (s.id ? `/posts/${s.id}.html` : "")],
      ["Cover image", s.coverImage || s.image || ""],
      ["Light cover", s.lightCover || ""],
      ["Excerpt / Dek", s.dek || s.excerpt || ""],
    ].map(([k, v]) => `${k}: ${v}`).join("\n");

    // Dump any remaining top-level fields so nothing gets silently dropped
    // (tags, writerChecklist, sourceFile, etc.). Values stringified as JSON
    // so nested structures are still human-readable.
    const extraKeys = Object.keys(s).filter((k) => !HANDLED.has(k)).sort();
    const extras = extraKeys.length
      ? "\nOther fields:\n" + extraKeys.map((k) => `  ${k}: ${stringifyValue(s[k])}`).join("\n")
      : "";

    return [
      "=".repeat(72),
      topFields,
      extras,
      "",
      "BODY (HTML):",
      bodyHtml || "(empty)",
      "",
      "BODY (plain text):",
      bodyText || "(empty)",
      "",
    ].join("\n");
  });

  return header + "\n" + blocks.join("\n");
}

function fmtDate(v) {
  const ms = tsToMillis(v);
  if (!ms) return v ? String(v) : "";
  return new Date(ms).toISOString();
}

function stringifyValue(v) {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  // Firestore Timestamp → ISO
  const ms = tsToMillis(v);
  if (ms) return new Date(ms).toISOString();
  try { return JSON.stringify(v); } catch { return String(v); }
}

function htmlToPlain(html) {
  if (!html) return "";
  return String(html)
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|blockquote)>/gi, "\n\n")
    .replace(/<li[^>]*>/gi, " - ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function dateStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

// ---------- Welcome email sender ----------
// Lists every user, sorted by createdAt desc. Recently joined users get a
// "NEW" pill so the admin notices them. Each row has a Send button that
// fires POST /api/welcome-email; the API resolves the user (server-side),
// sends the onboarding email via Resend, and stamps welcomeEmailSentAt on
// the user doc so we can show "Sent on …" on subsequent loads.
async function loadWelcomeEmailSender(ctx, mount) {
  mount.innerHTML = `<div class="loading-state"><div class="spinner"></div>Loading users…</div>`;
  let users;
  try {
    const snap = await getDocs(query(collection(db, "users"), orderBy("createdAt", "desc")));
    users = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.error("welcome email sender: load users failed", err);
    mount.innerHTML = `<div class="error-state">Could not load users: ${esc(err.message)}</div>`;
    return;
  }
  if (!users.length) {
    mount.innerHTML = `<div class="empty-state">No users yet.</div>`;
    return;
  }

  const cutoff = Date.now() - RECENT_JOIN_DAYS * 86400000;
  const recent = users.filter((u) => parseDate(u.createdAt) >= cutoff);
  const others = users.filter((u) => parseDate(u.createdAt) < cutoff);

  mount.innerHTML = "";

  if (recent.length) {
    mount.appendChild(renderSection("Recently joined", recent, ctx, /* highlight */ true));
  }
  mount.appendChild(renderSection("All users", others.length ? others : users, ctx, false));
}

// ---------- Email guidance sender ----------
async function loadGuidanceEmailTool(ctx, mount) {
  mount.innerHTML = `<div class="loading-state"><div class="spinner"></div>Loading guidance tool…</div>`;
  try {
    const [templateRes, userSnap] = await Promise.all([
      ctx.authedFetch("/api/guidance-email"),
      getDocs(query(collection(db, "users"), orderBy("createdAt", "desc"))),
    ]);
    const templateData = await templateRes.json().catch(() => ({}));
    if (!templateRes.ok || !templateData.ok) throw new Error(templateData.error || `HTTP ${templateRes.status}`);

    const templates = templateData.templates || [];
    const users = userSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((u) => u.email)
      .sort((a, b) => (roleLabel(a.role || "").localeCompare(roleLabel(b.role || "")) || String(a.name || a.email).localeCompare(String(b.name || b.email))));

    if (!templates.length) {
      mount.innerHTML = `<div class="empty-state">No guidance templates are configured.</div>`;
      return;
    }
    if (!users.length) {
      mount.innerHTML = `<div class="empty-state">No users with email addresses found.</div>`;
      return;
    }

    mount.innerHTML = `
      <div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px;">
        <div class="field" style="margin:0;">
          <label class="label">User</label>
          <select class="select" id="guidance-user">
            ${users.map((u) => `<option value="${esc(u.id)}">${esc(u.name || u.email)} — ${esc(roleLabel(u.role || "reader"))} (${esc(u.email)})</option>`).join("")}
          </select>
        </div>
        <div class="field" style="margin:0;">
          <label class="label">Guidance template</label>
          <select class="select" id="guidance-template">
            ${templates.map((t) => `<option value="${esc(t.id)}">${esc(t.title)} — ${esc(t.audience)}</option>`).join("")}
          </select>
        </div>
      </div>
      <div id="guidance-preview" style="margin-top:12px;"></div>
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-top:12px;">
        <div class="hint" id="guidance-last-sent" style="color:#166534;"></div>
        <button class="btn btn-accent btn-sm" id="guidance-send">Send guidance email</button>
      </div>
      <div id="guidance-status" class="hint" style="margin-top:8px;color:var(--danger);"></div>
    `;

    const userSelect = mount.querySelector("#guidance-user");
    const templateSelect = mount.querySelector("#guidance-template");
    const preview = mount.querySelector("#guidance-preview");
    const lastSent = mount.querySelector("#guidance-last-sent");
    const status = mount.querySelector("#guidance-status");
    const sendBtn = mount.querySelector("#guidance-send");

    const renderPreview = () => {
      const user = users.find((u) => u.id === userSelect.value) || users[0];
      const template = templates.find((t) => t.id === templateSelect.value) || templates[0];
      const sentAt = user.lastGuidanceEmailSentAt ? new Date(parseDate(user.lastGuidanceEmailSentAt)) : null;
      const sentTemplate = user.lastGuidanceEmailTemplate
        ? templates.find((t) => t.id === user.lastGuidanceEmailTemplate)?.title || user.lastGuidanceEmailTemplate
        : null;

      preview.innerHTML = `
        <div style="border:1px solid #b7e4c7;border-radius:10px;background:#ffffff;padding:14px 16px;">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">
            <div>
              <div style="font-size:12px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;color:#166534;">Email preview</div>
              <div style="font-weight:800;color:var(--ink-1);font-size:16px;margin-top:4px;">${esc(template.subject)}</div>
            </div>
            <span style="display:inline-flex;padding:4px 9px;border-radius:999px;background:#dcfce7;color:#166534;font-size:11px;font-weight:800;">${esc(template.audience)}</span>
          </div>
          <p style="margin:10px 0 0;color:var(--ink-2);font-size:13.5px;line-height:1.55;">${esc(template.intro)}</p>
          <div style="margin-top:10px;font-size:12px;color:#166534;">
            Recipient: <strong>${esc(user.name || user.email)}</strong> · ${esc(user.email)}
          </div>
        </div>
      `;
      lastSent.textContent = sentAt
        ? `Last guidance sent: ${sentTemplate || "template"} on ${sentAt.toLocaleDateString()}`
        : "No guidance email recorded for this user yet.";
      status.textContent = "";
    };

    userSelect.addEventListener("change", renderPreview);
    templateSelect.addEventListener("change", renderPreview);
    renderPreview();

    sendBtn.addEventListener("click", async () => {
      const user = users.find((u) => u.id === userSelect.value);
      const template = templates.find((t) => t.id === templateSelect.value);
      if (!user || !template) return;
      if (!confirm(`Send "${template.title}" guidance to ${user.name || user.email}?`)) return;

      sendBtn.disabled = true;
      sendBtn.textContent = "Sending…";
      status.textContent = "";
      try {
        const res = await ctx.authedFetch("/api/guidance-email", {
          method: "POST",
          body: JSON.stringify({ uid: user.id, templateId: template.id }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
        user.lastGuidanceEmailSentAt = new Date().toISOString();
        user.lastGuidanceEmailTemplate = template.id;
        toast(`Guidance email sent to ${user.email}.`, "success");
        renderPreview();
      } catch (err) {
        console.error(err);
        status.textContent = `Send failed: ${err.message}`;
        toast("Guidance email failed.", "error");
      } finally {
        sendBtn.disabled = false;
        sendBtn.textContent = "Send guidance email";
      }
    });
  } catch (err) {
    console.error("guidance email tool failed", err);
    mount.innerHTML = `<div class="error-state">Could not load guidance email tool: ${esc(err.message)}</div>`;
  }
}

async function handleWelcomeClick(e, ctx) {
  const btn = e.target.closest("[data-welcome-send]");
  if (!btn) return;
  const uid = btn.dataset.welcomeSend;
  const email = btn.dataset.email || "";
  const name = btn.dataset.name || "";
  if (btn.dataset.sentAt && !confirm(`Welcome email was already sent to ${email}. Send it again?`)) return;

  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = "Sending…";
  try {
    const res = await ctx.authedFetch("/api/welcome-email", {
      method: "POST",
      body: JSON.stringify({ uid, email, name }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
    toast(`Welcome email sent to ${email}.`, "success");
    btn.textContent = "Resend";
    btn.dataset.sentAt = new Date().toISOString();
    const sentLabel = btn.closest("[data-welcome-row]")?.querySelector("[data-sent-label]");
    if (sentLabel) sentLabel.textContent = `Sent just now`;
  } catch (err) {
    console.error(err);
    toast(`Send failed: ${err.message}`, "error");
    btn.textContent = original;
  } finally {
    btn.disabled = false;
  }
}

function renderSection(title, users, ctx, highlight) {
  const wrap = el("div", { style: { marginBottom: "14px" } });
  wrap.innerHTML = `
    <div style="font-size:11px;font-weight:700;color:var(--muted);letter-spacing:0.08em;text-transform:uppercase;margin:8px 0 8px;">
      ${esc(title)} <span style="color:var(--ink-2);font-weight:600;">· ${users.length}</span>
    </div>`;
  const list = el("div", { style: { display: "grid", gap: "6px" } });
  users.forEach((u) => list.appendChild(renderWelcomeRow(u, ctx, highlight)));
  wrap.appendChild(list);
  return wrap;
}

function renderWelcomeRow(u, ctx, highlight) {
  const row = el("div", {
    "data-welcome-row": "1",
    style: {
      display: "grid",
      gridTemplateColumns: "1fr auto",
      gap: "12px",
      alignItems: "center",
      padding: "10px 12px",
      border: `1px solid ${highlight ? "rgba(168,132,58,0.4)" : "var(--hairline)"}`,
      background: highlight ? "rgba(251,246,236,0.5)" : "var(--surface)",
      borderRadius: "8px",
    },
  });

  const name = u.name || "(no name)";
  const email = u.email || "";
  const role = u.role || "reader";
  const joined = u.createdAt ? new Date(parseDate(u.createdAt)).toLocaleDateString() : "—";
  const sentAt = u.welcomeEmailSentAt ? new Date(parseDate(u.welcomeEmailSentAt)) : null;
  const sentLabel = sentAt ? `Sent ${sentAt.toLocaleDateString()}` : "Not sent yet";
  const newPill = highlight
    ? `<span style="display:inline-block;padding:1px 7px;border-radius:999px;background:#a8843a;color:#fff;font-size:10px;font-weight:700;letter-spacing:0.06em;margin-left:8px;">NEW</span>`
    : "";

  row.innerHTML = `
    <div style="min-width:0;">
      <div style="font-weight:600;color:var(--ink-1);font-size:14px;">
        ${esc(name)} ${newPill}
      </div>
      <div style="font-size:12px;color:var(--ink-2);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(email)}</div>
      <div style="font-size:11px;color:var(--muted);margin-top:3px;">
        ${esc(roleLabel(role))} · joined ${esc(joined)} · <span data-sent-label>${esc(sentLabel)}</span>
      </div>
    </div>
    <button class="btn ${sentAt ? "btn-secondary" : "btn-accent"} btn-sm"
            data-welcome-send="${esc(u.id)}"
            data-email="${esc(email)}"
            data-name="${esc(name)}"
            ${sentAt ? `data-sent-at="${esc(sentAt.toISOString())}"` : ""}>
      ${sentAt ? "Resend" : "Send welcome"}
    </button>`;
  return row;
}

function roleLabel(r) {
  const map = {
    admin: "Admin",
    // Editors at Catalyst are also expected to write — surface that here so
    // the welcome email list reads consistently with the welcome email body.
    editor: "Editor / Writer",
    writer: "Writer",
    newsletter_builder: "Newsletter builder",
    marketing: "Marketing",
    reader: "Reader",
  };
  return map[r] || r;
}

function parseDate(v) {
  if (!v) return 0;
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : 0;
  }
  if (typeof v.toMillis === "function") { try { return v.toMillis(); } catch { return 0; } }
  if (typeof v.seconds === "number") return v.seconds * 1000;
  return 0;
}

// ============================================================================
// Winners' Chat manager
// ============================================================================
//
// Lists all messages in /winners-chat (newest first) with inline editing for
// display name, title, message body, like count, and posted date. Saves write
// straight to Firestore — admin role bypasses the like-only rule.

const WINNERS_COLLECTION = "winners-chat";

async function loadWinnersChat(panel) {
  panel.innerHTML = `<div class="loading-state"><div class="spinner"></div>Loading messages…</div>`;
  try {
    const q = query(collection(db, WINNERS_COLLECTION), orderBy("timestamp", "desc"), limit(200));
    const snap = await getDocs(q);

    if (snap.empty) {
      panel.innerHTML = `<div class="empty-state" style="padding:24px;text-align:center;color:var(--ink-3);">No messages yet.</div>`;
      return;
    }

    const rows = snap.docs.map(d => renderWinnersRow(d.id, d.data())).join("");
    panel.innerHTML = `
      <div style="display:grid;gap:10px;">
        <div class="hint" style="font-size:12px;">${snap.size} message${snap.size === 1 ? "" : "s"} · newest first</div>
        ${rows}
      </div>`;
  } catch (err) {
    console.error("[winners-chat] load failed", err);
    panel.innerHTML = `<div class="error-state" style="padding:16px;color:var(--danger);">Could not load messages: ${esc(err.message)}</div>`;
  }
}

function renderWinnersRow(id, data) {
  const username = data.username || "";
  const title    = data.title || "";
  const message  = data.message || "";
  const likes    = Number(data.likes || 0);
  const tsMs     = parseDate(data.timestamp);
  const dtLocal  = tsMs ? toLocalDateTimeInput(new Date(tsMs)) : "";
  const userId   = data.userId || "—";

  return `
    <div class="winners-row" data-id="${esc(id)}" style="border:1px solid var(--hairline);border-radius:10px;padding:14px;background:var(--bg-2,#fafafa);">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
        <label style="font-size:12px;color:var(--ink-3);display:block;">
          Display name
          <input class="form-control wc-name" type="text" value="${esc(username)}" maxlength="50" style="width:100%;margin-top:4px;padding:6px 10px;border:1px solid var(--hairline);border-radius:6px;font:inherit;">
        </label>
        <label style="font-size:12px;color:var(--ink-3);display:block;">
          Title (optional)
          <input class="form-control wc-title" type="text" value="${esc(title)}" maxlength="30" style="width:100%;margin-top:4px;padding:6px 10px;border:1px solid var(--hairline);border-radius:6px;font:inherit;">
        </label>
      </div>

      <label style="font-size:12px;color:var(--ink-3);display:block;margin-bottom:10px;">
        Message
        <textarea class="form-control wc-message" maxlength="500" rows="2" style="width:100%;margin-top:4px;padding:6px 10px;border:1px solid var(--hairline);border-radius:6px;font:inherit;resize:vertical;">${esc(message)}</textarea>
      </label>

      <div style="display:grid;grid-template-columns:120px 1fr;gap:10px;margin-bottom:10px;">
        <label style="font-size:12px;color:var(--ink-3);display:block;">
          Likes
          <input class="form-control wc-likes" type="number" min="0" step="1" value="${likes}" style="width:100%;margin-top:4px;padding:6px 10px;border:1px solid var(--hairline);border-radius:6px;font:inherit;">
        </label>
        <label style="font-size:12px;color:var(--ink-3);display:block;">
          Posted at
          <input class="form-control wc-date" type="datetime-local" value="${esc(dtLocal)}" style="width:100%;margin-top:4px;padding:6px 10px;border:1px solid var(--hairline);border-radius:6px;font:inherit;">
        </label>
      </div>

      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">
        <div class="hint" style="font-size:11px;font-family:'SF Mono',ui-monospace,monospace;">
          id: ${esc(id)} · uid: ${esc(String(userId).substring(0, 18))}…
        </div>
        <div style="display:flex;gap:8px;">
          <button class="btn btn-secondary btn-sm wc-delete" data-action="delete">Delete</button>
          <button class="btn btn-accent btn-sm wc-save" data-action="save">Save changes</button>
        </div>
      </div>
    </div>`;
}

function toLocalDateTimeInput(d) {
  // Convert a Date to the value format expected by <input type="datetime-local">
  // (YYYY-MM-DDTHH:mm in *local* time).
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function handleWinnersChatClick(e, panel) {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const row = btn.closest(".winners-row");
  if (!row) return;
  const id = row.dataset.id;

  if (btn.dataset.action === "save") {
    const username = row.querySelector(".wc-name").value.trim();
    const titleVal = row.querySelector(".wc-title").value.trim();
    const message  = row.querySelector(".wc-message").value.trim();
    const likes    = Math.max(0, parseInt(row.querySelector(".wc-likes").value || "0", 10));
    const dateStr  = row.querySelector(".wc-date").value;

    if (!username) { toast("Display name can't be empty.", "error"); return; }
    if (!message)  { toast("Message can't be empty.", "error"); return; }
    if (username.length > 50) { toast("Name must be 50 characters or less.", "error"); return; }
    if (titleVal.length > 30) { toast("Title must be 30 characters or less.", "error"); return; }
    if (message.length  > 500){ toast("Message must be 500 characters or less.", "error"); return; }

    let timestamp;
    if (dateStr) {
      const d = new Date(dateStr);
      if (Number.isNaN(d.getTime())) { toast("Invalid date.", "error"); return; }
      timestamp = Timestamp.fromDate(d);
    }

    btn.disabled = true;
    btn.textContent = "Saving…";
    try {
      const ref = doc(db, WINNERS_COLLECTION, id);
      const patch = {
        username,
        title: titleVal || null,
        message,
        likes,
      };
      if (timestamp) patch.timestamp = timestamp;
      await updateDoc(ref, patch);
      toast("Message updated.", "success");
    } catch (err) {
      console.error("[winners-chat] save failed", err);
      toast(`Save failed: ${err.message}`, "error");
    } finally {
      btn.disabled = false;
      btn.textContent = "Save changes";
    }
    return;
  }

  if (btn.dataset.action === "delete") {
    const ok = await confirmDialog("Delete this message permanently?", { confirmText: "Delete", danger: true });
    if (!ok) return;
    btn.disabled = true;
    try {
      await deleteDoc(doc(db, WINNERS_COLLECTION, id));
      row.remove();
      toast("Message deleted.", "success");
    } catch (err) {
      console.error("[winners-chat] delete failed", err);
      toast(`Delete failed: ${err.message}`, "error");
      btn.disabled = false;
    }
  }
}
