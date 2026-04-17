// Editor module — two modes via route:
//  - "queue":   list of articles assigned to me / awaiting review
//  - "review":  the review surface for a specific story (opened via #/editor/queue?review=<id>)

import { db } from "../firebase-config.js";
import {
  collection, query, where, orderBy, onSnapshot, getDocs, doc, getDoc,
  updateDoc, addDoc, setDoc, serverTimestamp, onSnapshot as onSnap,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { el, esc, fmtRelative, statusPill, confirmDialog } from "./ui.js";

// The 12-item Editor Review Checklist (exact wording per spec).
export const CHECKLIST_ITEMS = [
  { id: "lead", text: "Does the lead earn the reader's attention — surprising, specific, not a summary?" },
  { id: "angle", text: "Does the piece have a clear, concrete angle — not just a broad topic?" },
  { id: "headline", text: "Is the headline active, specific, and honest about the stakes?" },
  { id: "voice_opinion", text: "Has the writer avoided prescriptive or editorial opinion language?" },
  { id: "accuracy", text: "Are all technical claims accurate and verified against primary sources?" },
  { id: "flags_resolved", text: "Has every flagged uncertainty been addressed or resolved?" },
  { id: "story_not_review", text: "Does the piece read like a story, not a literature review?" },
  { id: "voice_credible", text: "Is the writer's voice consistent and credible throughout?" },
  { id: "quotes", text: "Are all quotes properly attributed and placed in context?" },
  { id: "terminology", text: "Is all scientific terminology defined for a college-level audience?" },
  { id: "ending", text: "Does the ending resonate — quote, callback, or forward-looking implication?" },
  { id: "proofread", text: "Has the piece been reviewed for grammar, clarity, and overall flow?" },
];

export async function mount(ctx, container) {
  container.innerHTML = "";
  const reviewId = getHashParam("review");
  if (reviewId) return mountReviewSurface(ctx, container, reviewId);
  return mountQueue(ctx, container);
}

// ===== Queue =================================================================
async function mountQueue(ctx, container) {
  // Two-column view: assigned to me, and general pending queue.
  const layout = el("div", { class: "grid grid-2" });
  const mineCard = el("div", { class: "card" });
  mineCard.innerHTML = `
    <div class="card-header">
      <div>
        <div class="card-title">Assigned to me</div>
        <div class="card-subtitle">Articles where you are the assigned editor.</div>
      </div>
    </div>
    <div class="card-body" id="mine-list"><div class="loading-state"><div class="spinner"></div>Loading…</div></div>`;

  const pendCard = el("div", { class: "card" });
  pendCard.innerHTML = `
    <div class="card-header">
      <div>
        <div class="card-title">Pending review</div>
        <div class="card-subtitle">Drafts submitted by writers and awaiting an editor.</div>
      </div>
    </div>
    <div class="card-body" id="pending-list"><div class="loading-state"><div class="spinner"></div>Loading…</div></div>`;

  layout.appendChild(mineCard);
  layout.appendChild(pendCard);
  container.appendChild(layout);

  const storiesRef = collection(db, "stories");
  try {
    const mineSnap = await getDocs(query(storiesRef, where("editorId", "==", ctx.user.uid), orderBy("updatedAt", "desc")));
    renderQueueRows(mineCard.querySelector("#mine-list"), mineSnap);
  } catch (err) {
    mineCard.querySelector("#mine-list").innerHTML = `<div class="error-state">${esc(err.message)}</div>`;
  }
  try {
    const pendSnap = await getDocs(query(storiesRef, where("status", "==", "pending"), orderBy("updatedAt", "desc")));
    renderQueueRows(pendCard.querySelector("#pending-list"), pendSnap);
  } catch (err) {
    pendCard.querySelector("#pending-list").innerHTML = `<div class="error-state">${esc(err.message)}</div>`;
  }
}

function renderQueueRows(mount, snap) {
  if (snap.empty) { mount.innerHTML = `<div class="empty-state">Nothing here.</div>`; return; }
  mount.innerHTML = "";
  snap.forEach((d) => {
    const a = d.data();
    const row = el("div", { class: "article-row" });
    row.innerHTML = `
      <div>
        <div class="article-title">${esc(a.title || "Untitled")}</div>
        <div class="article-meta">
          by ${esc(a.authorName || "Unknown")} · ${fmtRelative(a.updatedAt)} · ${statusPill(a.status)}
        </div>
      </div>
      <div><a class="btn btn-accent btn-xs" href="#/editor/queue?review=${esc(d.id)}">Open review</a></div>`;
    mount.appendChild(row);
  });
}

// ===== Review surface ========================================================
async function mountReviewSurface(ctx, container, id) {
  const header = el("div", { style: { marginBottom: "16px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px" } });
  header.innerHTML = `<a class="btn btn-ghost btn-sm" href="#/editor/queue">&larr; Back to queue</a>`;
  container.appendChild(header);

  const docRef = doc(db, "stories", id);
  let story;
  try {
    const snap = await getDoc(docRef);
    if (!snap.exists()) { container.innerHTML = `<div class="error-state">Story not found.</div>`; return; }
    story = snap.data();
  } catch (err) {
    container.innerHTML = `<div class="error-state">${esc(err.message)}</div>`; return;
  }

  // Layout: left = article editor (title/body), right = checklist + comments.
  const grid = el("div", { class: "grid", style: { gridTemplateColumns: "1.3fr 1fr", gap: "20px" } });
  container.appendChild(grid);

  // --- Left column: editor -----------------------------------------------
  const left = el("div", {});
  left.innerHTML = `
    <div class="card">
      <div class="card-header">
        <div>
          <div class="card-title">${esc(story.title || "Untitled")}</div>
          <div class="card-subtitle">by ${esc(story.authorName || "Unknown")} · ${statusPill(story.status)}</div>
        </div>
        <div style="display:flex;gap:8px;">
          <button class="btn btn-secondary btn-sm" id="save-edits">Save edits</button>
          <button class="btn btn-accent btn-sm" id="confirm-review" disabled>Confirm review complete</button>
        </div>
      </div>
      <div class="card-body">
        <div class="field"><label class="label">Title</label><input class="input" id="e-title" value="${escAttr(story.title || "")}"></div>
        <div class="grid grid-2">
          <div class="field"><label class="label">Category</label>
            <select class="select" id="e-category">
              ${["Feature","Interview","Op-Ed","News","Science"].map(c => `<option ${c === (story.category || "Feature") ? "selected" : ""}>${c}</option>`).join("")}
            </select>
          </div>
          <div class="field"><label class="label">Cover image URL</label><input class="input" id="e-cover" value="${escAttr(story.coverImage || "")}"></div>
        </div>
        <div class="field"><label class="label">Dek</label><textarea class="textarea" id="e-dek" rows="2">${esc(story.dek || story.excerpt || "")}</textarea></div>
        <div class="field"><label class="label">Body</label><textarea class="textarea" id="e-body" rows="22">${esc(story.body || "")}</textarea></div>
      </div>
    </div>

    <div class="card" style="margin-top:20px;">
      <div class="card-header"><div class="card-title">Comments & suggestions</div></div>
      <div class="card-body">
        <div id="comments-list"><div class="loading-state"><div class="spinner"></div>Loading…</div></div>
        <div style="margin-top:16px;border-top:1px solid var(--hairline-2);padding-top:14px;">
          <div class="grid grid-2">
            <div class="field"><label class="label">Paragraph # (optional)</label><input class="input" type="number" min="1" id="c-paragraph" placeholder="e.g., 3"></div>
            <div></div>
          </div>
          <div class="field"><label class="label">Comment / suggestion</label><textarea class="textarea" id="c-body" rows="3" placeholder="Leave an in-depth suggestion or question for the writer."></textarea></div>
          <button class="btn btn-primary btn-sm" id="add-comment">Post comment</button>
        </div>
      </div>
    </div>
  `;
  grid.appendChild(left);

  // --- Right column: checklist ------------------------------------------
  const right = el("div", {});
  right.innerHTML = `
    <div class="card">
      <div class="card-header">
        <div>
          <div class="card-title">Editor Review Checklist</div>
          <div class="card-subtitle">Every item must be confirmed before you can mark this article as reviewed. This ensures the piece meets Catalyst editorial standards before it moves forward in the workflow.</div>
        </div>
      </div>
      <div class="card-body" id="checklist-body"></div>
    </div>`;
  grid.appendChild(right);

  // Load checklist state for this editor + story.
  const checklistDocId = `${ctx.user.uid}`;
  const checklistRef = doc(db, "stories", id, "checklist", checklistDocId);
  const checklistSnap = await getDoc(checklistRef);
  const savedState = checklistSnap.exists() ? checklistSnap.data() : { items: {} };

  const checklistBody = right.querySelector("#checklist-body");
  checklistBody.innerHTML = "";
  CHECKLIST_ITEMS.forEach((item) => {
    const line = el("label", { class: "checklist-item" });
    const checked = !!savedState.items?.[item.id];
    if (checked) line.classList.add("done");
    line.innerHTML = `
      <input type="checkbox" data-k="${item.id}" ${checked ? "checked" : ""}>
      <span class="checklist-label">${esc(item.text)}</span>`;
    checklistBody.appendChild(line);
  });

  const confirmBtn = left.querySelector("#confirm-review");

  function refreshConfirmBtn() {
    const boxes = checklistBody.querySelectorAll('input[type="checkbox"]');
    const done = Array.from(boxes).filter((b) => b.checked).length;
    confirmBtn.disabled = done < CHECKLIST_ITEMS.length;
    confirmBtn.textContent = done < CHECKLIST_ITEMS.length
      ? `Checklist ${done}/${CHECKLIST_ITEMS.length}`
      : "Confirm review complete";
  }
  refreshConfirmBtn();

  checklistBody.addEventListener("change", async (e) => {
    const cb = e.target.closest('input[type="checkbox"]');
    if (!cb) return;
    cb.closest(".checklist-item").classList.toggle("done", cb.checked);
    const items = {};
    checklistBody.querySelectorAll('input[type="checkbox"]').forEach((b) => { items[b.dataset.k] = b.checked; });
    try {
      await setDoc(checklistRef, {
        items,
        editorId: ctx.user.uid,
        editorName: ctx.profile.name || ctx.user.email,
        updatedAt: new Date().toISOString(),
      }, { merge: true });
    } catch (err) {
      ctx.toast("Could not save checklist: " + err.message, "error");
    }
    refreshConfirmBtn();
  });

  // --- Save edits ------
  left.querySelector("#save-edits").addEventListener("click", async () => {
    try {
      await updateDoc(docRef, {
        title: left.querySelector("#e-title").value.trim(),
        category: left.querySelector("#e-category").value,
        coverImage: left.querySelector("#e-cover").value.trim(),
        dek: left.querySelector("#e-dek").value.trim(),
        body: left.querySelector("#e-body").value,
        updatedAt: new Date().toISOString(),
      });
      ctx.toast("Edits saved.", "success");
    } catch (err) { ctx.toast("Save failed: " + err.message, "error"); }
  });

  // --- Confirm review ------
  confirmBtn.addEventListener("click", async () => {
    const ok = await confirmDialog("Mark this article as reviewed? It will be advanced to 'reviewing' and sent to admin for approval.", { confirmText: "Confirm" });
    if (!ok) return;
    try {
      await updateDoc(docRef, {
        status: "reviewing",
        reviewedById: ctx.user.uid,
        reviewedByName: ctx.profile.name || ctx.user.email,
        reviewedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      ctx.toast("Review confirmed. Admin has been notified.", "success");
      location.hash = "#/editor/queue";
    } catch (err) {
      ctx.toast("Failed: " + err.message, "error");
    }
  });

  // --- Comments ------
  const commentsList = left.querySelector("#comments-list");
  const commentsRef = collection(db, "stories", id, "comments");
  const unsub = onSnap(query(commentsRef, orderBy("createdAt", "desc")), (snap) => {
    if (snap.empty) { commentsList.innerHTML = `<div class="empty-state">No comments yet.</div>`; return; }
    commentsList.innerHTML = "";
    snap.forEach((c) => {
      const cdata = c.data();
      commentsList.appendChild(el("div", { class: "comment" }, [
        el("div", { class: "comment-head" }, [
          el("span", { class: "comment-author" }, cdata.authorName || "Editor"),
          el("span", {}, ` · ${fmtRelative(cdata.createdAt)}`),
          cdata.paragraph ? el("span", { style: { color: "var(--muted-2)" } }, ` · ¶${cdata.paragraph}`) : "",
        ]),
        el("div", { class: "comment-body" }, cdata.body || ""),
      ]));
    });
  });

  left.querySelector("#add-comment").addEventListener("click", async () => {
    const body = left.querySelector("#c-body").value.trim();
    const paragraph = parseInt(left.querySelector("#c-paragraph").value, 10) || null;
    if (!body) { ctx.toast("Write something first.", "error"); return; }
    try {
      await addDoc(commentsRef, {
        body, paragraph,
        authorId: ctx.user.uid,
        authorName: ctx.profile.name || ctx.user.email,
        createdAt: new Date().toISOString(),
      });
      left.querySelector("#c-body").value = "";
      left.querySelector("#c-paragraph").value = "";
      ctx.toast("Comment posted.", "success");
    } catch (err) { ctx.toast("Failed: " + err.message, "error"); }
  });

  return () => { if (unsub) unsub(); };
}

function getHashParam(name) {
  const q = location.hash.split("?")[1];
  if (!q) return null;
  return new URLSearchParams(q).get(name);
}
function escAttr(s) {
  return esc(s);
}
