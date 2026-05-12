// js/dashboard/book-reviews-admin.js
// Admin tab: reader-submitted book reviews queue.
//
// Three buckets shown side-by-side:
//   • Pending  → submissions waiting for admin decision (approve/reject)
//   • Approved → submissions already published to The Catalyst Reviews (read-only,
//                with a "View on site" link)
//   • Rejected → submissions the admin declined (read-only)
//
// Approve/reject calls POST /api/book-reviews/decide with the admin's
// Firebase ID token. On approve, the server creates a stories doc with
// category=book-review, communityPick=true, status=published — which is
// exactly what /book-reviews picks up under "From the Catalyzers."

import { auth, db } from "../firebase-config.js";
import { getIdToken } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  collection, getDocs, orderBy, query,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

import { el, esc, toast, confirmDialog, fmtRelative, fmtDate } from "./ui.js";

const COLLECTION = "bookReviewSubmissions";

export async function mount(ctx, container) {
  container.innerHTML = "";

  const card = el("div", { class: "card" });
  card.innerHTML = `
    <div class="card-header">
      <div>
        <div class="card-title">Book reviews — community submissions</div>
        <div class="card-subtitle">
          Reader-submitted reviews for The Catalyst Reviews. Approve to publish under "From the Catalyzers,"
          or reject to dismiss. Approved submissions appear on
          <a href="/book-reviews" target="_blank" rel="noopener">/book-reviews</a>.
        </div>
      </div>
      <div style="display:flex;gap:8px;align-items:center;">
        <button class="btn btn-secondary btn-sm" id="brq-refresh" type="button">Refresh</button>
      </div>
    </div>
    <div class="card-body" id="brq-body">
      <div class="loading-state"><div class="spinner"></div>Loading queue…</div>
    </div>
  `;
  container.appendChild(card);

  const body       = card.querySelector("#brq-body");
  const refreshBtn = card.querySelector("#brq-refresh");

  async function loadAndRender() {
    body.innerHTML = `<div class="loading-state"><div class="spinner"></div>Loading queue…</div>`;
    try {
      const snap = await getDocs(query(collection(db, COLLECTION), orderBy("createdAt", "desc")));
      const rows = [];
      snap.forEach((d) => rows.push({ id: d.id, ...d.data() }));

      const pending  = rows.filter((r) => (r.status || "pending") === "pending");
      const approved = rows.filter((r) => r.status === "approved");
      const rejected = rows.filter((r) => r.status === "rejected");

      body.innerHTML = "";
      body.appendChild(buildSection("Pending review", pending, "pending", loadAndRender));
      body.appendChild(buildSection("Recently approved", approved.slice(0, 12), "approved", loadAndRender));
      body.appendChild(buildSection("Rejected", rejected.slice(0, 12), "rejected", loadAndRender));
    } catch (err) {
      body.innerHTML = `<div class="error-state">${esc(err.message)}</div>`;
    }
  }

  refreshBtn.addEventListener("click", loadAndRender);
  loadAndRender();
}

// ============================================================
// Sections
// ============================================================
function buildSection(label, rows, kind, reload) {
  const wrap = el("section", { class: "brq-section" });
  wrap.innerHTML = `
    <div class="brq-section-head">
      <h3 class="brq-section-title">${esc(label)}</h3>
      <span class="brq-count">${rows.length}</span>
    </div>
  `;

  if (!rows.length) {
    const empty = el("div", { class: "empty-state", style: "padding:18px 12px;" });
    empty.textContent =
      kind === "pending"
        ? "Nothing waiting. New reader submissions show up here automatically."
        : kind === "approved"
        ? "No approved submissions yet."
        : "No rejected submissions.";
    wrap.appendChild(empty);
    return wrap;
  }

  const list = el("div", { class: "brq-list" });
  rows.forEach((r) => list.appendChild(renderRow(r, kind, reload)));
  wrap.appendChild(list);
  return wrap;
}

function renderRow(sub, kind, reload) {
  const row = el("article", { class: "brq-row" });
  const ratingHtml = sub.rating != null
    ? `<span class="brq-pill brq-pill-rating">${esc(String(sub.rating))}/5</span>`
    : "";
  const isbnHtml = sub.isbn
    ? `<span class="brq-meta-item">ISBN ${esc(sub.isbn)}</span>`
    : "";
  const genreHtml = sub.genre
    ? `<span class="brq-meta-item">${esc(sub.genre.replace(/\b\w/g, (c) => c.toUpperCase()).replace(/-/g, " "))}</span>`
    : "";
  const deckHtml = sub.deck
    ? `<p class="brq-deck" style="margin:6px 0 0;color:var(--ink-2);font-style:italic;">“${esc(sub.deck)}”</p>`
    : "";

  // Truncate the review to ~3 lines in the row; "Show full" opens a dialog
  // with the entire text so the admin can read before deciding.
  const fullReview = String(sub.reviewText || "").trim();
  const isLong     = fullReview.length > 320;
  const preview    = isLong ? fullReview.slice(0, 320).trim() + "…" : fullReview;

  const linkOut = sub.publishedStoryId
    ? `<a class="btn btn-ghost btn-xs" href="/book-reviews" target="_blank" rel="noopener">View on site</a>`
    : "";

  row.innerHTML = `
    <header class="brq-row-head">
      <div>
        <h4 class="brq-book-title">${esc(sub.bookTitle || "Untitled")}</h4>
        <p class="brq-book-meta">
          by <strong>${esc(sub.bookAuthor || "—")}</strong>
          ${genreHtml}
          ${isbnHtml}
          ${ratingHtml}
        </p>
        ${deckHtml}
      </div>
      <div class="brq-row-status">
        <span class="brq-pill brq-pill-${esc(sub.status || "pending")}">${esc(sub.status || "pending")}</span>
        <span class="brq-row-when">${esc(fmtRelative(sub.createdAt))}</span>
      </div>
    </header>

    <div class="brq-byline">
      Submitted by <strong>${esc(sub.submitterName || "Anonymous")}</strong>
      &nbsp;·&nbsp;
      <a href="mailto:${esc(sub.submitterEmail || "")}">${esc(sub.submitterEmail || "")}</a>
    </div>

    <div class="brq-review" data-full="${isLong ? "false" : "true"}">
      <p class="brq-review-text">${esc(preview)}</p>
      ${isLong ? `<button class="btn btn-ghost btn-xs brq-expand" type="button">Show full review</button>` : ""}
    </div>

    <footer class="brq-actions">
      ${
        kind === "pending"
          ? `
        <button class="btn btn-accent btn-sm" data-action="approve" type="button">Approve &amp; publish</button>
        <button class="btn btn-danger btn-sm" data-action="reject" type="button">Reject</button>
      `
          : `
        ${linkOut}
        <span class="brq-decided">
          ${sub.status === "approved" ? "Approved" : "Rejected"}
          ${sub.decidedBy ? ` by ${esc(sub.decidedBy)}` : ""}
          ${sub.decidedAt ? ` · ${esc(fmtDate(sub.decidedAt))}` : ""}
        </span>
      `
      }
    </footer>
  `;

  // Expand truncated review
  const expandBtn = row.querySelector(".brq-expand");
  if (expandBtn) {
    expandBtn.addEventListener("click", () => {
      const wrap = row.querySelector(".brq-review");
      const isFull = wrap.dataset.full === "true";
      wrap.querySelector(".brq-review-text").textContent = isFull ? preview : fullReview;
      wrap.dataset.full = isFull ? "false" : "true";
      expandBtn.textContent = isFull ? "Show full review" : "Show less";
    });
  }

  // Action buttons
  const approveBtn = row.querySelector('[data-action="approve"]');
  const rejectBtn  = row.querySelector('[data-action="reject"]');
  if (approveBtn) approveBtn.addEventListener("click", () => decide(sub, "approve", row, reload));
  if (rejectBtn)  rejectBtn.addEventListener( "click", () => decide(sub, "reject",  row, reload));

  return row;
}

// ============================================================
// Decide — POST /api/book-reviews/decide
// ============================================================
async function decide(sub, action, row, reload) {
  if (action === "reject") {
    const ok = await confirmDialog(
      `Reject the submission for "${sub.bookTitle || "this book"}"? The reader is not notified automatically.`,
      { confirmText: "Reject", danger: true }
    );
    if (!ok) return;
  }

  // Lock the row's buttons while the request is in flight.
  const buttons = Array.from(row.querySelectorAll("button"));
  const prevLabels = buttons.map((b) => b.textContent);
  buttons.forEach((b, i) => {
    b.disabled = true;
    if (b.dataset.action === action) b.textContent = action === "approve" ? "Publishing…" : "Rejecting…";
  });

  try {
    const token = await getIdToken(auth.currentUser, /* forceRefresh */ false);
    const res = await fetch("/api/book-reviews/decide", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ submissionId: sub.id, action }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.ok) {
      throw new Error(json.error || json.message || `Decision failed (${res.status})`);
    }

    toast(
      action === "approve"
        ? `Published "${sub.bookTitle}" on The Catalyst Reviews.`
        : `Rejected "${sub.bookTitle}".`,
      "success"
    );
    // Bust the page's session cache so the new community pick appears
    // immediately when the admin opens /book-reviews.
    try { sessionStorage.removeItem("catalyst_fs_cache_v5"); } catch {}
    reload();
  } catch (err) {
    toast(err.message || "Something went wrong", "error", 5000);
    // Restore button state on failure
    buttons.forEach((b, i) => {
      b.disabled = false;
      b.textContent = prevLabels[i];
    });
  }
}
