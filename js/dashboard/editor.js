// Editor module — two modes via route:
//  - "queue":   list of articles assigned to me / awaiting review
//  - "review":  the review surface for a specific story (opened via #/editor/queue?review=<id>)

import { db } from "../firebase-config.js";
import {
  collection, query, where, orderBy, onSnapshot, getDocs, doc, getDoc,
  updateDoc, addDoc, setDoc, deleteDoc, serverTimestamp, onSnapshot as onSnap,
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

  // Layout: left = article editor (title/body), right = checklist + suggestions.
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

        <div class="review-body-wrap">
          <div class="review-body-toolbar" id="review-tools">
            <span class="review-body-hint">Select text in the article, then:</span>
            <button class="btn btn-secondary btn-xs" id="tool-highlight" disabled>Highlight</button>
            <button class="btn btn-secondary btn-xs" id="tool-suggest" disabled>Suggest edit</button>
            <button class="btn btn-secondary btn-xs" id="tool-comment" disabled>Comment on selection</button>
          </div>
          <div class="article-body review-body" id="review-body"></div>
        </div>
      </div>
    </div>

    <div class="card" style="margin-top:20px;">
      <div class="card-header"><div class="card-title">General comments</div></div>
      <div class="card-body">
        <div id="comments-list"><div class="loading-state"><div class="spinner"></div>Loading…</div></div>
        <div style="margin-top:16px;border-top:1px solid var(--hairline-2);padding-top:14px;">
          <div class="grid grid-2">
            <div class="field"><label class="label">Paragraph # (optional)</label><input class="input" type="number" min="1" id="c-paragraph" placeholder="e.g., 3"></div>
            <div></div>
          </div>
          <div class="field"><label class="label">Comment</label><textarea class="textarea" id="c-body" rows="3" placeholder="Leave a broader note for the writer."></textarea></div>
          <button class="btn btn-primary btn-sm" id="add-comment">Post comment</button>
        </div>
      </div>
    </div>
  `;
  grid.appendChild(left);

  // --- Right column: suggestions + checklist ------------------------------
  const right = el("div", {});
  right.innerHTML = `
    <div class="card">
      <div class="card-header">
        <div>
          <div class="card-title">Suggestions & highlights</div>
          <div class="card-subtitle">Inline marks on the article. Each one the writer will accept or reject.</div>
        </div>
      </div>
      <div class="card-body" id="suggestions-body">
        <div class="empty-state">Select text in the article to add a highlight or suggestion.</div>
      </div>
    </div>

    <div class="card" style="margin-top:20px;">
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

  // --- Review body: render + wire selection tools -----------------------
  const reviewBody = left.querySelector("#review-body");
  reviewBody.innerHTML = story.body || "";
  const btnHighlight = left.querySelector("#tool-highlight");
  const btnSuggest   = left.querySelector("#tool-suggest");
  const btnComment   = left.querySelector("#tool-comment");

  // Track current selection inside the review body.
  let currentRange = null;
  function refreshToolsFromSelection() {
    const sel = window.getSelection();
    const active = sel && sel.rangeCount
      && reviewBody.contains(sel.anchorNode)
      && reviewBody.contains(sel.focusNode)
      && !sel.isCollapsed;
    if (active) {
      currentRange = sel.getRangeAt(0).cloneRange();
      btnHighlight.disabled = false;
      btnSuggest.disabled = false;
      btnComment.disabled = false;
    } else {
      currentRange = null;
      btnHighlight.disabled = true;
      btnSuggest.disabled = true;
      btnComment.disabled = true;
    }
  }
  document.addEventListener("selectionchange", refreshToolsFromSelection);

  // Offsets are counted in plain text; we also save a snapshot for context + conflict detection.
  function rangeToAnchor(range) {
    const start = textOffsetOf(reviewBody, range.startContainer, range.startOffset);
    const end   = textOffsetOf(reviewBody, range.endContainer,   range.endOffset);
    const text  = range.toString();
    return { start, end, text };
  }

  const suggestionsRef = collection(db, "stories", id, "suggestions");

  btnHighlight.addEventListener("click", async () => {
    if (!currentRange) return;
    const anchor = rangeToAnchor(currentRange);
    if (!anchor.text.trim()) return;
    try {
      await addDoc(suggestionsRef, {
        kind: "highlight",
        start: anchor.start,
        end: anchor.end,
        originalText: anchor.text,
        note: "",
        authorId: ctx.user.uid,
        authorName: ctx.profile.name || ctx.user.email,
        createdAt: new Date().toISOString(),
      });
      window.getSelection().removeAllRanges();
      ctx.toast("Highlight added.", "success");
    } catch (err) { ctx.toast("Failed: " + err.message, "error"); }
  });

  btnSuggest.addEventListener("click", async () => {
    if (!currentRange) return;
    const anchor = rangeToAnchor(currentRange);
    if (!anchor.text.trim()) return;
    const replacement = prompt(`Replace with:\n\n"${anchor.text}"\n\nSuggested text:`, anchor.text);
    if (replacement === null) return;
    const note = prompt("Optional note for the writer (why this change?)", "") || "";
    try {
      await addDoc(suggestionsRef, {
        kind: "replace",
        start: anchor.start,
        end: anchor.end,
        originalText: anchor.text,
        replacementText: replacement,
        note,
        authorId: ctx.user.uid,
        authorName: ctx.profile.name || ctx.user.email,
        createdAt: new Date().toISOString(),
      });
      window.getSelection().removeAllRanges();
      ctx.toast("Suggestion saved.", "success");
    } catch (err) { ctx.toast("Failed: " + err.message, "error"); }
  });

  btnComment.addEventListener("click", async () => {
    if (!currentRange) return;
    const anchor = rangeToAnchor(currentRange);
    if (!anchor.text.trim()) return;
    const note = prompt(`Comment on:\n\n"${anchor.text}"\n\nYour note:`, "");
    if (!note) return;
    try {
      await addDoc(suggestionsRef, {
        kind: "comment",
        start: anchor.start,
        end: anchor.end,
        originalText: anchor.text,
        note,
        authorId: ctx.user.uid,
        authorName: ctx.profile.name || ctx.user.email,
        createdAt: new Date().toISOString(),
      });
      window.getSelection().removeAllRanges();
      ctx.toast("Comment added.", "success");
    } catch (err) { ctx.toast("Failed: " + err.message, "error"); }
  });

  // Live-render suggestions on the right + paint marks on the body.
  const suggestionsBody = right.querySelector("#suggestions-body");
  let currentSuggestions = [];
  const panelCtx = {
    ...ctx,
    onDelete: async (s) => {
      try {
        await deleteDoc(doc(db, "stories", id, "suggestions", s.id));
      } catch (err) { ctx.toast("Remove failed: " + err.message, "error"); }
    },
  };
  const unsubSuggestions = onSnap(query(suggestionsRef, orderBy("createdAt", "asc")), (snap) => {
    currentSuggestions = [];
    snap.forEach((d) => currentSuggestions.push({ id: d.id, ...d.data() }));
    paintSuggestionMarks(reviewBody, story.body || "", currentSuggestions);
    renderSuggestionsPanel(suggestionsBody, currentSuggestions, panelCtx, "editor");
  });

  // --- Save edits (title/category/cover/dek only; body is tracked via suggestions) ---
  left.querySelector("#save-edits").addEventListener("click", async () => {
    try {
      await updateDoc(docRef, {
        title: left.querySelector("#e-title").value.trim(),
        category: left.querySelector("#e-category").value,
        coverImage: left.querySelector("#e-cover").value.trim(),
        dek: left.querySelector("#e-dek").value.trim(),
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

  return () => {
    if (unsub) unsub();
    if (unsubSuggestions) unsubSuggestions();
    document.removeEventListener("selectionchange", refreshToolsFromSelection);
  };
}

// --- Suggestion helpers (shared with writer module via paintSuggestionMarks/renderSuggestionsPanel) ---

// Convert a (node, offset) inside `root` into a flat text-index counting all text nodes.
export function textOffsetOf(root, node, offset) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  let count = 0;
  while (walker.nextNode()) {
    const n = walker.currentNode;
    if (n === node) return count + offset;
    count += n.nodeValue.length;
  }
  if (node === root) {
    // offset is number of child nodes before; fall back to total length if unreachable.
    return count;
  }
  return count;
}

// Paints <mark class="sx-mark"> around each suggestion's [start, end) text range.
// Re-renders from `originalHTML` every time to keep marks idempotent.
export function paintSuggestionMarks(container, originalHTML, suggestions) {
  container.innerHTML = originalHTML || "";
  if (!suggestions || !suggestions.length) return;

  // Sort by start descending so inserting marks doesn't invalidate later offsets.
  const sorted = [...suggestions].sort((a, b) => b.start - a.start);
  for (const s of sorted) {
    const pair = findTextRange(container, s.start, s.end);
    if (!pair) continue;
    const range = document.createRange();
    range.setStart(pair.startNode, pair.startOffset);
    range.setEnd(pair.endNode, pair.endOffset);

    // If the range crosses element boundaries, skip a clean wrap (would split structure).
    // Use CSS Highlights-style fallback: wrap each text node slice inside the range.
    try {
      wrapRangeInMarks(range, s);
    } catch {
      // Skip unpaintable suggestion; still visible in the side panel.
    }
  }
}

function findTextRange(root, start, end) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  let count = 0;
  let startNode = null, startOffset = 0, endNode = null, endOffset = 0;
  while (walker.nextNode()) {
    const n = walker.currentNode;
    const len = n.nodeValue.length;
    if (!startNode && count + len >= start) {
      startNode = n;
      startOffset = start - count;
    }
    if (!endNode && count + len >= end) {
      endNode = n;
      endOffset = end - count;
      break;
    }
    count += len;
  }
  if (!startNode || !endNode) return null;
  return { startNode, startOffset, endNode, endOffset };
}

function wrapRangeInMarks(range, s) {
  // Walk text nodes fully inside the range and wrap each slice in a <mark>.
  const root = range.commonAncestorContainer;
  const ancestor = root.nodeType === 1 ? root : root.parentNode;
  const walker = document.createTreeWalker(ancestor, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => range.intersectsNode(n) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    const nodeStart = node === range.startContainer ? range.startOffset : 0;
    const nodeEnd   = node === range.endContainer   ? range.endOffset   : node.nodeValue.length;
    if (nodeEnd <= nodeStart) continue;
    const before = node.nodeValue.slice(0, nodeStart);
    const middle = node.nodeValue.slice(nodeStart, nodeEnd);
    const after  = node.nodeValue.slice(nodeEnd);
    const mark = document.createElement("mark");
    mark.className = `sx-mark sx-${s.kind || "highlight"}`;
    mark.dataset.suggestionId = s.id;
    mark.textContent = middle;
    const parent = node.parentNode;
    if (before) parent.insertBefore(document.createTextNode(before), node);
    parent.insertBefore(mark, node);
    if (after) parent.insertBefore(document.createTextNode(after), node);
    parent.removeChild(node);
  }
}

// Renders the side panel of suggestions with optional accept/reject buttons.
// role: "editor" shows a delete button; "writer" shows accept + reject.
export function renderSuggestionsPanel(panelEl, suggestions, ctx, role) {
  if (!suggestions.length) {
    panelEl.innerHTML = `<div class="empty-state">${role === "writer" ? "No suggestions yet." : "Select text in the article to add a highlight or suggestion."}</div>`;
    return;
  }
  panelEl.innerHTML = "";
  suggestions.forEach((s) => {
    const card = el("div", { class: `suggestion-card sx-card-${s.kind}` });
    const kindLabel = { highlight: "Highlight", replace: "Suggested edit", comment: "Comment" }[s.kind] || "Note";

    const head = el("div", { class: "suggestion-head" });
    head.innerHTML = `
      <span class="suggestion-kind">${kindLabel}</span>
      <span class="suggestion-author">${esc(s.authorName || "Editor")} · ${fmtRelative(s.createdAt)}</span>`;
    card.appendChild(head);

    const orig = el("blockquote", { class: "suggestion-original" });
    orig.textContent = s.originalText || "";
    card.appendChild(orig);

    if (s.kind === "replace") {
      const repl = el("div", { class: "suggestion-replace" });
      repl.innerHTML = `<span class="suggestion-arrow">→</span>`;
      const txt = document.createElement("span");
      txt.className = "suggestion-replace-text";
      txt.textContent = s.replacementText || "(deletion)";
      repl.appendChild(txt);
      card.appendChild(repl);
    }
    if (s.note) {
      const note = el("div", { class: "suggestion-note" });
      note.textContent = s.note;
      card.appendChild(note);
    }

    const actions = el("div", { class: "suggestion-actions" });
    if (role === "writer") {
      const accept = el("button", { class: "btn btn-accent btn-xs" }, "Accept");
      const reject = el("button", { class: "btn btn-ghost btn-xs" }, "Reject");
      accept.addEventListener("click", () => ctx.onAccept && ctx.onAccept(s));
      reject.addEventListener("click", () => ctx.onReject && ctx.onReject(s));
      if (s.kind === "comment" || s.kind === "highlight") {
        // Nothing to apply — just allow dismissing.
        accept.textContent = "Mark done";
      }
      actions.appendChild(accept);
      actions.appendChild(reject);
    } else {
      const del = el("button", { class: "btn btn-ghost btn-xs" }, "Remove");
      del.addEventListener("click", () => ctx.onDelete && ctx.onDelete(s));
      actions.appendChild(del);
    }
    card.appendChild(actions);

    // Clicking the card scrolls the corresponding mark into view.
    card.addEventListener("click", (e) => {
      if (e.target.closest("button")) return;
      const mark = document.querySelector(`.sx-mark[data-suggestion-id="${s.id}"]`);
      if (mark) {
        mark.scrollIntoView({ behavior: "smooth", block: "center" });
        mark.classList.add("is-flash");
        setTimeout(() => mark.classList.remove("is-flash"), 900);
      }
    });

    panelEl.appendChild(card);
  });
}

function getHashParam(name) {
  const q = location.hash.split("?")[1];
  if (!q) return null;
  return new URLSearchParams(q).get(name);
}
function escAttr(s) {
  return esc(s);
}
