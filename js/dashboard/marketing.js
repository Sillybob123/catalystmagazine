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

async function firestoreQuery(structuredQuery) {
  const res = await fetch(
    `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT}/databases/(default)/documents:runQuery`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ structuredQuery }) }
  );
  if (!res.ok) throw new Error(`Firestore ${res.status}`);
  const rows = await res.json();
  return rows
    .filter((r) => r.document)
    .map((r) => {
      const f = r.document.fields || {};
      const str = (k) => f[k]?.stringValue ?? "";
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

async function firestoreWrite(authedFetch, path, fields) {
  // Use authedFetch to POST through our own proxy so auth is handled server-side,
  // but social_posts writes need service-account auth. We POST to a lightweight
  // wrapper endpoint; fall back to direct Firestore REST with the user's ID token.
  // Since we don't have a dedicated endpoint, use the Firebase JS SDK via the
  // existing authedFetch pattern but target Firestore REST directly with the
  // user's bearer token (Firestore rules must allow writes for authed users).
  const toFsValue = (v) => {
    if (v === null || v === undefined) return { nullValue: null };
    if (typeof v === "boolean") return { booleanValue: v };
    if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    if (typeof v === "string") return { stringValue: v };
    if (Array.isArray(v)) return { arrayValue: { values: v.map(toFsValue) } };
    if (typeof v === "object") {
      const out = {};
      for (const [k2, v2] of Object.entries(v)) out[k2] = toFsValue(v2);
      return { mapValue: { fields: out } };
    }
    return { stringValue: String(v) };
  };
  const fsFields = {};
  for (const [k, v] of Object.entries(fields)) fsFields[k] = toFsValue(v);

  const res = await authedFetch(
    `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT}/databases/(default)/documents/${path}`,
    { method: "PATCH", body: JSON.stringify({ fields: fsFields }) }
  );
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Firestore write failed ${res.status}: ${txt}`);
  }
  return res.json();
}

async function firestoreAdd(authedFetch, collection, fields) {
  const toFsValue = (v) => {
    if (v === null || v === undefined) return { nullValue: null };
    if (typeof v === "boolean") return { booleanValue: v };
    if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    if (typeof v === "string") return { stringValue: v };
    if (Array.isArray(v)) return { arrayValue: { values: v.map(toFsValue) } };
    if (typeof v === "object") {
      const out = {};
      for (const [k2, v2] of Object.entries(v)) out[k2] = toFsValue(v2);
      return { mapValue: { fields: out } };
    }
    return { stringValue: String(v) };
  };
  const fsFields = {};
  for (const [k, v] of Object.entries(fields)) fsFields[k] = toFsValue(v);

  const res = await authedFetch(
    `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT}/databases/(default)/documents/${collection}`,
    { method: "POST", body: JSON.stringify({ fields: fsFields }) }
  );
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Firestore add failed ${res.status}: ${txt}`);
  }
  const doc = await res.json();
  return doc.name ? doc.name.split("/").pop() : null;
}

async function mountSocialPosts(ctx, container) {
  // ── Shell ──────────────────────────────────────────────────────────────────
  container.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px;">
      <div>
        <h2 style="font-size:18px;font-weight:700;margin:0;">Social media posts</h2>
        <p style="font-size:13px;color:var(--muted);margin:4px 0 0;">Draft, review, and track Instagram &amp; LinkedIn posts.</p>
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
        <button class="btn btn-primary btn-sm" id="sp-new-btn">+ New post</button>
      </div>
    </div>

    <div id="sp-list"><div class="loading-state"><div class="spinner"></div>Loading…</div></div>

    <!-- Detail / edit modal -->
    <div class="modal-backdrop" id="sp-modal" style="display:none;">
      <div class="modal" style="max-width:660px;">
        <div class="modal-header">
          <div class="modal-title" id="sp-modal-title">Post</div>
          <button class="btn btn-ghost btn-sm" id="sp-modal-close" style="margin-left:auto;">✕</button>
        </div>
        <div class="modal-body" id="sp-modal-body"></div>
        <div class="modal-footer" id="sp-modal-footer" style="display:flex;gap:8px;justify-content:flex-end;padding:16px 24px;border-top:1px solid var(--border);flex-wrap:wrap;"></div>
      </div>
    </div>

    <!-- New post modal -->
    <div class="modal-backdrop" id="sp-create-modal" style="display:none;">
      <div class="modal" style="max-width:580px;">
        <div class="modal-header">
          <div class="modal-title">New post draft</div>
          <button class="btn btn-ghost btn-sm" id="sp-create-close" style="margin-left:auto;">✕</button>
        </div>
        <div class="modal-body">
          <div style="display:flex;flex-direction:column;gap:14px;">
            <label style="font-size:13px;font-weight:600;">Title <span style="color:var(--danger)">*</span>
              <input class="input" id="sp-new-title" placeholder="e.g. Instagram: Can AI Transform Speech Therapy?" style="margin-top:4px;width:100%;">
            </label>
            <label style="font-size:13px;font-weight:600;">Platform <span style="color:var(--danger)">*</span>
              <select class="input select" id="sp-new-platform" style="margin-top:4px;width:100%;">
                <option value="">Select platform…</option>
                <option value="instagram">📸 Instagram</option>
                <option value="linkedin">💼 LinkedIn</option>
                <option value="twitter">🐦 Twitter</option>
                <option value="facebook">📘 Facebook</option>
              </select>
            </label>
            <label style="font-size:13px;font-weight:600;">Caption / copy <span style="color:var(--danger)">*</span>
              <textarea class="input textarea" id="sp-new-content" rows="6" placeholder="Write your post copy here…" style="margin-top:4px;width:100%;min-height:130px;"></textarea>
              <span style="font-size:12px;color:var(--muted);" id="sp-char-count">0 characters</span>
            </label>
            <label style="font-size:13px;font-weight:600;">Notes / image link
              <textarea class="input textarea" id="sp-new-notes" rows="3" placeholder="Paste image URL, extra context, etc." style="margin-top:4px;width:100%;min-height:70px;"></textarea>
            </label>
            <label style="font-size:13px;font-weight:600;">Post-by deadline
              <input class="input" type="date" id="sp-new-deadline" style="margin-top:4px;width:180px;">
            </label>
          </div>
        </div>
        <div class="modal-footer" style="display:flex;gap:8px;justify-content:flex-end;padding:16px 24px;border-top:1px solid var(--border);">
          <button class="btn btn-secondary btn-sm" id="sp-create-cancel">Cancel</button>
          <button class="btn btn-primary btn-sm" id="sp-create-submit">Create draft</button>
        </div>
      </div>
    </div>`;

  let allPosts = [];
  const listEl = container.querySelector("#sp-list");
  const platformFilter = container.querySelector("#sp-platform-filter");
  const statusFilter = container.querySelector("#sp-status-filter");

  // ── Render list ─────────────────────────────────────────────────────────────
  function render() {
    const pf = platformFilter.value;
    const sf = statusFilter.value;
    const posts = allPosts.filter((p) => (!pf || p.platform === pf) && (!sf || p.status === sf));

    if (!posts.length) {
      listEl.innerHTML = `<div class="empty-state">No posts match your filters.</div>`;
      return;
    }

    listEl.innerHTML = posts.map((p) => {
      const pm = PLATFORM_META[p.platform] || { label: p.platform, icon: "📱", pill: "pill-draft" };
      const sp = STATUS_PILL[p.status] || "pill-draft";
      const preview = (p.content || "").slice(0, 120) + ((p.content || "").length > 120 ? "…" : "");
      return `
        <div class="card" style="margin-bottom:12px;cursor:pointer;" data-id="${esc(p.id)}">
          <div class="card-body" style="display:flex;gap:16px;align-items:flex-start;">
            <div style="font-size:28px;line-height:1;">${pm.icon}</div>
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

    listEl.querySelectorAll("[data-id]").forEach((card) => {
      card.addEventListener("click", () => openPost(allPosts.find((p) => p.id === card.dataset.id)));
    });
  }

  // ── Load posts ──────────────────────────────────────────────────────────────
  async function loadPosts() {
    listEl.innerHTML = `<div class="loading-state"><div class="spinner"></div>Loading…</div>`;
    try {
      allPosts = await firestoreQuery({
        from: [{ collectionId: "social_posts" }],
        orderBy: [{ field: { fieldPath: "createdAt" }, direction: "DESCENDING" }],
        limit: 200,
      });
      render();
    } catch (err) {
      listEl.innerHTML = `<div class="error-state">Could not load posts: ${esc(err.message)}</div>`;
    }
  }

  // ── Detail modal ─────────────────────────────────────────────────────────────
  const modal = container.querySelector("#sp-modal");
  const modalTitle = container.querySelector("#sp-modal-title");
  const modalBody = container.querySelector("#sp-modal-body");
  const modalFooter = container.querySelector("#sp-modal-footer");

  function openPost(p) {
    if (!p) return;
    const pm = PLATFORM_META[p.platform] || { label: p.platform, icon: "📱", pill: "pill-draft" };
    const sp = STATUS_PILL[p.status] || "pill-draft";

    modalTitle.textContent = p.title || "Post";

    // Check if content has an image URL in notes
    const imageMatch = (p.notes || "").match(/https?:\/\/\S+\.(jpg|jpeg|png|webp|gif)/i) ||
                       (p.notes || "").match(/https?:\/\/static\.wixstatic\.com\/\S+/i);
    const imageUrl = imageMatch ? imageMatch[0].replace(/[,\s].*$/, "") : null;

    modalBody.innerHTML = `
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px;">
        <span class="pill ${pm.pill}">${pm.icon} ${esc(pm.label)}</span>
        <span class="pill ${sp}">${esc(p.status)}</span>
        ${p.deadline ? `<span class="pill pill-draft">Due ${esc(p.deadline)}</span>` : ""}
      </div>

      ${imageUrl && p.platform === "instagram" ? `
        <div style="margin-bottom:16px;">
          <div style="font-size:12px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;">Cover image (square)</div>
          <img src="${esc(imageUrl)}" alt="Cover" style="width:180px;height:180px;object-fit:cover;border-radius:8px;border:1px solid var(--border);">
          <div style="margin-top:6px;">
            <a href="${esc(imageUrl)}" target="_blank" class="btn btn-secondary btn-xs">Download image ↗</a>
          </div>
        </div>` : ""}

      <div style="margin-bottom:16px;">
        <div style="font-size:12px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;">Caption / copy</div>
        <div id="sp-detail-content-wrap">
          <pre style="white-space:pre-wrap;font-family:inherit;font-size:14px;background:var(--surface-2);border-radius:8px;padding:14px;margin:0;border:1px solid var(--border);">${esc(p.content || "—")}</pre>
        </div>
      </div>

      ${p.notes ? `
        <div style="margin-bottom:16px;">
          <div style="font-size:12px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;">Notes</div>
          <pre style="white-space:pre-wrap;font-family:inherit;font-size:13px;color:var(--ink-2);background:var(--surface-2);border-radius:8px;padding:12px;margin:0;border:1px solid var(--border);">${esc(p.notes)}</pre>
        </div>` : ""}

      <div style="font-size:12px;color:var(--muted);">
        Proposed by <strong>${esc(p.proposerName || "—")}</strong>
        ${p.createdAt ? ` · ${fmtRelative(p.createdAt)}` : ""}
      </div>`;

    // Footer actions
    modalFooter.innerHTML = "";

    // Copy caption button
    const copyBtn = el("button", { class: "btn btn-secondary btn-sm" });
    copyBtn.textContent = "Copy caption";
    copyBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(p.content || "").then(() => {
        copyBtn.textContent = "Copied!";
        setTimeout(() => { copyBtn.textContent = "Copy caption"; }, 2000);
      });
    });
    modalFooter.appendChild(copyBtn);

    // Status progression buttons (admin/editor only)
    if (["admin", "editor"].includes(ctx.role)) {
      if (p.status === "proposed") {
        const approveBtn = el("button", { class: "btn btn-accent btn-sm" });
        approveBtn.textContent = "Approve";
        approveBtn.addEventListener("click", () => updateStatus(p, "approved"));
        modalFooter.appendChild(approveBtn);
      }
      if (p.status === "approved") {
        const assignBtn = el("button", { class: "btn btn-primary btn-sm" });
        assignBtn.textContent = "Mark assigned";
        assignBtn.addEventListener("click", () => updateStatus(p, "assigned"));
        modalFooter.appendChild(assignBtn);
      }
      if (p.status === "assigned") {
        const postedBtn = el("button", { class: "btn btn-primary btn-sm" });
        postedBtn.textContent = "Mark posted ✓";
        postedBtn.addEventListener("click", () => updateStatus(p, "posted"));
        modalFooter.appendChild(postedBtn);
      }
    }

    modal.style.display = "flex";
  }

  async function updateStatus(p, newStatus) {
    try {
      await firestoreWrite(ctx.authedFetch, `social_posts/${p.id}`, { status: newStatus });
      ctx.toast(`Marked as ${newStatus}`, "success");
      modal.style.display = "none";
      await loadPosts();
    } catch (err) {
      ctx.toast("Failed to update: " + err.message, "error");
    }
  }

  container.querySelector("#sp-modal-close").addEventListener("click", () => { modal.style.display = "none"; });
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.style.display = "none"; });

  // ── New post modal ──────────────────────────────────────────────────────────
  const createModal = container.querySelector("#sp-create-modal");
  const contentInput = container.querySelector("#sp-new-content");
  const charCount = container.querySelector("#sp-char-count");

  contentInput.addEventListener("input", () => {
    charCount.textContent = `${contentInput.value.length} characters`;
  });

  container.querySelector("#sp-new-btn").addEventListener("click", () => {
    container.querySelector("#sp-new-title").value = "";
    container.querySelector("#sp-new-platform").value = "";
    contentInput.value = "";
    container.querySelector("#sp-new-notes").value = "";
    container.querySelector("#sp-new-deadline").value = new Date(Date.now() + 3 * 86400000).toISOString().split("T")[0];
    charCount.textContent = "0 characters";
    createModal.style.display = "flex";
    container.querySelector("#sp-new-title").focus();
  });

  const closeCreate = () => { createModal.style.display = "none"; };
  container.querySelector("#sp-create-close").addEventListener("click", closeCreate);
  container.querySelector("#sp-create-cancel").addEventListener("click", closeCreate);
  createModal.addEventListener("click", (e) => { if (e.target === createModal) closeCreate(); });

  container.querySelector("#sp-create-submit").addEventListener("click", async () => {
    const title = container.querySelector("#sp-new-title").value.trim();
    const platform = container.querySelector("#sp-new-platform").value;
    const content = contentInput.value.trim();
    const notes = container.querySelector("#sp-new-notes").value.trim();
    const deadline = container.querySelector("#sp-new-deadline").value;

    if (!title || !platform || !content) {
      ctx.toast("Title, platform, and caption are required.", "error");
      return;
    }

    const submitBtn = container.querySelector("#sp-create-submit");
    submitBtn.disabled = true;
    submitBtn.textContent = "Creating…";

    try {
      await firestoreAdd(ctx.authedFetch, "social_posts", {
        title,
        platform,
        content,
        notes: notes || null,
        deadline: deadline || null,
        status: "proposed",
        proposerId: ctx.user.uid,
        proposerName: ctx.profile.name || ctx.user.email,
        assigneeId: null,
        assigneeName: null,
        createdAt: new Date().toISOString(),
        activity: [{ text: "created this post", authorName: ctx.profile.name || ctx.user.email, timestamp: new Date().toISOString() }],
      });
      ctx.toast("Post draft created!", "success");
      closeCreate();
      await loadPosts();
    } catch (err) {
      ctx.toast("Failed to create post: " + err.message, "error");
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Create draft";
    }
  });

  // ── Filters ─────────────────────────────────────────────────────────────────
  platformFilter.addEventListener("change", render);
  statusFilter.addEventListener("change", render);

  await loadPosts();
}
