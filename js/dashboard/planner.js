// Planner — the social media / marketing command center.
//
// One page that answers: what's publishing soon, what social work is due for
// each story, who's been assigned what, who to ask when something's unclear,
// and what just went live.
//
// Sections:
//   1. Stat strip — publishing soon / in pipeline / published 30d / actions due
//   2. Post assignments — "make a post for X, due by Y" tasks. Admins and
//      users granted '#/planner/assign' (Users & roles → Extra access) can
//      assign; the assignee gets an email (/api/notify/assignment) and can
//      mark the task done here.
//   3. Up next — every active story sorted by publication date, each with a
//      plain-language prep plan (1 week before → 3 days after), the proposal,
//      and a comment chat with the author (message + email, via
//      /api/notify/comment).
//   4. Just published — recent live stories cross-referenced against the
//      social_posts board so "needs a post" is impossible to miss.
//   5. Channels — quick access to the LinkedIn company page and the
//      @thecatalystdc Instagram (embedded preview where the platform allows).
//
// Data: `projects`, `social_posts`, `social_assignments`, and the assignable
// team via the client SDK (staff read); published stories via the same
// anonymous REST query the public site uses.

import { db } from "../firebase-dual-config.js";
import {
  collection,
  doc,
  getDocs,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  arrayUnion,
  serverTimestamp,
  query,
  where,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { el, esc, openModal, toast, fmtDate, fmtRelative, slugify, confirmDialog } from "./ui.js";

const LINKEDIN_URL = "https://www.linkedin.com/company/catalystdc/";
const INSTAGRAM_URL = "https://www.instagram.com/thecatalystdc/";

// Suggested social prep relative to a story's publication date. Pure
// guidance computed from dates — nothing to persist. `when` is the
// plain-language phrase shown to the team so the dates explain themselves.
const CADENCE = [
  { offset: -7, when: "1 week before publish", label: "Draft the announcement copy" },
  { offset: -3, when: "3 days before",         label: "Design graphics / pick photos" },
  { offset: -1, when: "day before",            label: "Schedule posts (LinkedIn + Instagram)" },
  { offset: 0,  when: "publish day",           label: "Post everywhere + tag the author" },
  { offset: 3,  when: "3 days after",          label: "Follow-up — share a quote or behind-the-scenes" },
];

const PLATFORMS = ["any", "instagram", "linkedin", "twitter", "facebook"];

// Roles that can be assigned a post.
const ASSIGNABLE_ROLES = ["social_media", "marketing", "admin"];

function canAssign(ctx) {
  if (ctx.role === "admin") return true;
  const grants = ctx.profile?.extraAccess;
  return Array.isArray(grants) && grants.includes("#/planner/assign");
}

export async function mount(ctx, container) {
  const assigner = canAssign(ctx);
  container.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:20px;">
      <div class="grid grid-4" id="pl-stats">
        <div class="stat"><div class="stat-label">Publishing — next 14 days</div><div class="stat-value" data-k="soon">…</div></div>
        <div class="stat"><div class="stat-label">Stories in the pipeline</div><div class="stat-value" data-k="pipeline">…</div></div>
        <div class="stat"><div class="stat-label">Published — last 30 days</div><div class="stat-value" data-k="pub30">…</div></div>
        <div class="stat"><div class="stat-label">Tasks due now</div><div class="stat-value" data-k="due">…</div></div>
      </div>

      <div class="card">
        <div class="card-header">
          <div>
            <div class="card-title">Post assignments</div>
            <div class="card-subtitle">${assigner
              ? "Who's making which post, and when it's due. Assign one from here or from any story below."
              : "Posts assigned to the team. Yours are highlighted — mark them done when the post ships."}</div>
          </div>
          ${assigner ? `<button class="btn btn-primary btn-sm" id="pl-assign-new">Assign a post</button>` : ""}
        </div>
        <div class="card-body" id="pl-assignments"><div class="loading-state"><div class="spinner"></div>Loading…</div></div>
      </div>

      <div class="card">
        <div class="card-header">
          <div>
            <div class="card-title">Up next</div>
            <div class="card-subtitle">Every story headed to publication, soonest first — with the prep each one needs. Questions? Message the writer right from here.</div>
          </div>
          <button class="btn btn-secondary btn-sm" id="pl-refresh">Refresh</button>
        </div>
        <div class="card-body" id="pl-upcoming"><div class="loading-state"><div class="spinner"></div>Loading…</div></div>
      </div>

      <div class="card">
        <div class="card-header">
          <div>
            <div class="card-title">Just published</div>
            <div class="card-subtitle">Live on the site (book reviews excluded — we don't post for those). Once a story's posts are out, "Mark posted" clears it off the list.</div>
          </div>
          <a class="btn btn-secondary btn-sm" href="#/marketing/social">Open social board</a>
        </div>
        <div class="card-body" id="pl-published"><div class="loading-state"><div class="spinner"></div>Loading…</div></div>
      </div>

      <div class="grid grid-2" id="pl-channels">
        <div class="card">
          <div class="card-header">
            <div>
              <div class="card-title">Instagram — @thecatalystdc</div>
              <div class="card-subtitle">What's live on the feed right now.</div>
            </div>
            <a class="btn btn-secondary btn-sm" href="${INSTAGRAM_URL}" target="_blank" rel="noopener">Open Instagram</a>
          </div>
          <div class="card-body" style="padding:0;">
            <iframe src="https://www.instagram.com/thecatalystdc/embed" title="Catalyst Instagram feed"
                    loading="lazy" style="width:100%;height:460px;border:0;display:block;"></iframe>
            <div style="padding:10px 16px;font-size:12px;color:var(--muted);border-top:1px solid var(--hairline,#e5e7eb);">
              Feed not loading? Instagram sometimes blocks embedded previews —
              <a href="${INSTAGRAM_URL}" target="_blank" rel="noopener" style="color:var(--accent);">open the profile directly</a>.
            </div>
          </div>
        </div>
        <div class="card">
          <div class="card-header">
            <div>
              <div class="card-title">LinkedIn — Catalyst DC</div>
              <div class="card-subtitle">Company page activity and post performance.</div>
            </div>
            <a class="btn btn-secondary btn-sm" href="${LINKEDIN_URL}" target="_blank" rel="noopener">Open LinkedIn</a>
          </div>
          <div class="card-body" style="display:flex;flex-direction:column;gap:12px;">
            <p style="margin:0;font-size:13.5px;line-height:1.6;color:var(--ink-2);">
              LinkedIn doesn't allow company feeds to be embedded, so use these jump links:
            </p>
            <div style="display:flex;flex-direction:column;gap:8px;">
              <a href="${LINKEDIN_URL}posts/" target="_blank" rel="noopener" class="btn btn-secondary btn-sm" style="justify-content:flex-start;">Recent posts — what's already been shared</a>
              <a href="https://www.linkedin.com/company/catalystdc/admin/analytics/updates/" target="_blank" rel="noopener" class="btn btn-secondary btn-sm" style="justify-content:flex-start;">Post analytics (admins of the page)</a>
              <a href="https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent("https://www.catalyst-magazine.com")}" target="_blank" rel="noopener" class="btn btn-secondary btn-sm" style="justify-content:flex-start;">Share a Catalyst link to LinkedIn</a>
            </div>
            <p style="margin:0;font-size:12px;color:var(--muted);">
              Tip: cross-check "Just published" above against the posts page so nothing ships without an announcement.
            </p>
          </div>
        </div>
      </div>
    </div>
  `;

  // Shared page state, refreshed by load(). The assign modal and row actions
  // all re-run load() so every section stays consistent.
  const state = { projects: [], stories: [], posts: [], assignments: [], team: [], cleared: [] };
  const load = () => loadData(ctx, container, state, load);
  container.querySelector("#pl-refresh").addEventListener("click", load);
  container.querySelector("#pl-assign-new")?.addEventListener("click", () =>
    openAssignModal(ctx, state, load, {}));
  await load();
}

async function loadData(ctx, container, state, reload) {
  const upcomingEl = container.querySelector("#pl-upcoming");
  const publishedEl = container.querySelector("#pl-published");
  const assignmentsEl = container.querySelector("#pl-assignments");

  // The sources are independent — fetch in parallel, fail independently.
  const [projectsRes, storiesRes, postsRes, assignRes, teamRes, clearedRes] = await Promise.allSettled([
    getDocs(collection(db, "projects")),
    fetchPublishedStories(),
    getDocs(collection(db, "social_posts")),
    getDocs(collection(db, "social_assignments")),
    getDocs(query(collection(db, "users"), where("role", "in", ASSIGNABLE_ROLES))),
    getDocs(collection(db, "planner_cleared")),
  ]);

  state.projects = projectsRes.status === "fulfilled"
    ? projectsRes.value.docs.map((d) => ({ id: d.id, ...d.data() })) : null;
  state.stories = storiesRes.status === "fulfilled" ? storiesRes.value : null;
  state.posts = postsRes.status === "fulfilled"
    ? postsRes.value.docs.map((d) => ({ id: d.id, ...d.data() })) : [];
  state.assignments = assignRes.status === "fulfilled"
    ? assignRes.value.docs.map((d) => ({ id: d.id, ...d.data() })) : null;
  state.team = teamRes.status === "fulfilled"
    ? teamRes.value.docs.map((d) => ({ id: d.id, ...d.data() })) : [];
  state.cleared = clearedRes.status === "fulfilled"
    ? clearedRes.value.docs.map((d) => ({ id: d.id, ...d.data() })) : [];

  // ── Assignments ──
  if (!state.assignments) {
    assignmentsEl.innerHTML = `<div class="error-state">Could not load assignments: ${esc(assignRes.reason?.message || "unknown error")}</div>`;
  } else {
    renderAssignments(ctx, assignmentsEl, state, reload);
  }

  // ── Up next ──
  if (!state.projects) {
    upcomingEl.innerHTML = `<div class="error-state">Could not load the pipeline: ${esc(projectsRes.reason?.message || "unknown error")}</div>`;
  } else {
    renderUpcoming(ctx, upcomingEl, state, reload);
  }

  // ── Just published ──
  if (!state.stories) {
    publishedEl.innerHTML = `<div class="error-state">Could not load published stories: ${esc(storiesRes.reason?.message || "unknown error")}</div>`;
  } else {
    renderPublished(ctx, publishedEl, state, reload);
  }

  // ── Stats ──
  const set = (k, v) => { const n = container.querySelector(`[data-k="${k}"]`); if (n) n.textContent = v; };
  const active = (state.projects || []).filter(isActiveProject);
  const now = startOfToday();
  const in14 = active.filter((p) => {
    const d = parseDay(pubDateOf(p));
    return d && d >= now && d - now <= 14 * 86400000;
  });
  // "Tasks due now" = assigned posts due today/overdue + prep steps that are
  // due for stories whose publication date is still ahead (stale dates are
  // excluded — they get a "confirm the date" note instead of fake tasks).
  const cadenceDue = active.reduce((sum, p) => {
    const pubDate = parseDay(pubDateOf(p));
    if (!pubDate || pubDate < now) return sum;
    return sum + buildCadence(pubDate).filter((c) => c.state === "today" || c.state === "overdue").length;
  }, 0);
  const assignmentsDue = (state.assignments || []).filter((a) => {
    if (a.status === "done") return false;
    const d = parseDay(a.deadline);
    return d && d <= now;
  }).length;
  const pub30 = (state.stories || []).filter((s) => {
    const d = Date.parse(s.publishedAt || "");
    return d && Date.now() - d <= 30 * 86400000;
  }).length;
  set("soon", state.projects ? String(in14.length) : "—");
  set("pipeline", state.projects ? String(active.length) : "—");
  set("pub30", state.stories ? String(pub30) : "—");
  set("due", state.projects || state.assignments ? String(cadenceDue + assignmentsDue) : "—");
}

// ─── Post assignments ─────────────────────────────────────────────────────────

function renderAssignments(ctx, mountEl, state, reload) {
  const assigner = canAssign(ctx);
  const myUid = ctx.user.uid;
  const all = state.assignments.slice();

  const open = all.filter((a) => a.status !== "done").sort((a, b) => {
    // Mine first, then soonest deadline.
    const mineA = a.assigneeId === myUid ? 0 : 1;
    const mineB = b.assigneeId === myUid ? 0 : 1;
    if (mineA !== mineB) return mineA - mineB;
    return String(a.deadline || "9999").localeCompare(String(b.deadline || "9999"));
  });
  const done = all.filter((a) => a.status === "done")
    .sort((a, b) => String(b.doneAt || "").localeCompare(String(a.doneAt || "")))
    .slice(0, 5);

  if (!open.length && !done.length) {
    mountEl.innerHTML = `<div class="empty-state">No post assignments yet.${assigner ? ` Use "Assign a post" to give someone an article and a deadline — they'll get an email.` : ""}</div>`;
    return;
  }

  mountEl.innerHTML = "";
  for (const a of open) mountEl.appendChild(assignmentRow(ctx, a, state, reload, false));
  if (done.length) {
    const h = el("div", { style: "font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:14px 0 6px;" }, "Recently completed");
    mountEl.appendChild(h);
    for (const a of done) mountEl.appendChild(assignmentRow(ctx, a, state, reload, true));
  }
}

function assignmentRow(ctx, a, state, reload, isDone) {
  const myUid = ctx.user.uid;
  const assigner = canAssign(ctx);
  const mine = a.assigneeId === myUid;
  const due = parseDay(a.deadline);
  const dueText = dueLabel(due, isDone);

  const row = el("div", {
    style: `display:flex;align-items:center;gap:12px;padding:11px 12px;border:1px solid var(--hairline,#e5e7eb);border-radius:10px;margin-bottom:8px;flex-wrap:wrap;${isDone ? "opacity:.65;" : ""}${mine && !isDone ? "background:var(--surface-2,#f8fafc);" : ""}`,
  });
  row.innerHTML = `
    <div style="flex:1;min-width:220px;">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
        <span style="font-weight:600;font-size:13.5px;color:var(--ink);${isDone ? "text-decoration:line-through;" : ""}">Post for &ldquo;${esc(a.articleTitle || "untitled article")}&rdquo;</span>
        ${a.platform && a.platform !== "any" ? `<span class="pill pill-draft" style="font-size:10.5px;">${esc(a.platform)}</span>` : ""}
        ${mine && !isDone ? `<span class="pill pill-pending" style="font-size:10.5px;">yours</span>` : ""}
      </div>
      <div style="font-size:12px;color:var(--muted);margin-top:3px;">
        ${esc(a.assigneeName || "Unassigned")} · assigned by ${esc(a.createdByName || "—")}${a.notes ? ` · “${esc(a.notes.length > 90 ? a.notes.slice(0, 89) + "…" : a.notes)}”` : ""}
      </div>
    </div>
    <span style="font-size:12px;white-space:nowrap;${dueText.urgent && !isDone ? "color:var(--danger,#b91c1c);font-weight:700;" : "color:var(--muted);"}">${esc(dueText.text)}</span>
    <div style="display:flex;gap:6px;">
      ${(mine || assigner) && !isDone ? `<button class="btn btn-secondary btn-xs" data-act="done">Mark done</button>` : ""}
      ${(mine || assigner) && isDone ? `<button class="btn btn-ghost btn-xs" data-act="reopen">Reopen</button>` : ""}
      ${assigner ? `<button class="btn btn-ghost btn-xs" data-act="remove" style="color:var(--danger,#b91c1c);">Remove</button>` : ""}
    </div>
  `;

  row.querySelector('[data-act="done"]')?.addEventListener("click", async () => {
    try {
      await updateDoc(doc(db, "social_assignments", a.id), { status: "done", doneAt: new Date().toISOString() });
      toast("Nice — marked done.", "success");
      reload();
    } catch (err) { toast("Could not update: " + err.message, "error"); }
  });
  row.querySelector('[data-act="reopen"]')?.addEventListener("click", async () => {
    try {
      await updateDoc(doc(db, "social_assignments", a.id), { status: "open", doneAt: null });
      reload();
    } catch (err) { toast("Could not update: " + err.message, "error"); }
  });
  row.querySelector('[data-act="remove"]')?.addEventListener("click", async () => {
    const ok = await confirmDialog(`Remove the assignment for "${a.articleTitle || "this article"}"?`, { confirmText: "Remove", danger: true });
    if (!ok) return;
    try {
      await deleteDoc(doc(db, "social_assignments", a.id));
      reload();
    } catch (err) { toast("Could not remove: " + err.message, "error"); }
  });
  return row;
}

function dueLabel(due, isDone) {
  if (!due) return { text: "no deadline", urgent: false };
  if (isDone) return { text: `was due ${fmtDate(due)}`, urgent: false };
  const days = Math.round((due - startOfToday()) / 86400000);
  if (days < 0) return { text: `overdue by ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"}`, urgent: true };
  if (days === 0) return { text: "due today", urgent: true };
  if (days === 1) return { text: "due tomorrow", urgent: false };
  return { text: `due ${fmtDate(due)} (${days} days)`, urgent: false };
}

// Assign-a-post modal. `prefill` can carry { articleTitle, projectId, storyId }
// when launched from a story row.
function openAssignModal(ctx, state, reload, prefill) {
  if (!canAssign(ctx)) return;

  const team = (state.team || [])
    .filter((u) => u.id !== undefined)
    .sort((a, b) => String(a.name || a.email || "").localeCompare(String(b.name || b.email || "")));

  if (!team.length) {
    toast("No assignable teammates found (social media / marketing roles).", "error");
    return;
  }

  // Article options: upcoming pipeline stories + recently published.
  const upcoming = (state.projects || []).filter(isActiveProject);
  const published = state.stories || [];
  const defaultDeadline = prefill.deadline || isoDay(new Date(Date.now() + 3 * 86400000));

  const body = el("div", { style: "display:flex;flex-direction:column;gap:12px;min-width:min(480px,80vw);" });
  body.innerHTML = `
    <label style="display:grid;gap:4px;font-size:13px;font-weight:600;color:var(--ink);">Make a post about
      <select class="select" id="as-article" style="font-weight:400;">
        ${prefill.articleTitle ? `<option value="custom" selected>${esc(prefill.articleTitle)}</option>` : `<option value="">Choose an article…</option>`}
        ${upcoming.length ? `<optgroup label="Coming up">${upcoming.map((p) => `<option value="p:${esc(p.id)}">${esc(p.title || "(untitled)")}${pubDateOf(p) ? ` — publishes ${esc(fmtDate(pubDateOf(p)))}` : ""}</option>`).join("")}</optgroup>` : ""}
        ${published.length ? `<optgroup label="Just published">${published.map((s) => `<option value="s:${esc(s.id)}">${esc(s.title || "(untitled)")}</option>`).join("")}</optgroup>` : ""}
        <option value="other">Something else (type it in)</option>
      </select>
    </label>
    <input id="as-custom-title" placeholder="What's the post about?" style="display:none;padding:9px 12px;border:1px solid var(--hairline,#e5e7eb);border-radius:8px;font-size:13px;font-family:inherit;">
    <label style="display:grid;gap:4px;font-size:13px;font-weight:600;color:var(--ink);">Assign to
      <select class="select" id="as-assignee" style="font-weight:400;">
        ${team.map((u) => `<option value="${esc(u.id)}">${esc(u.name || u.email)}${u.role ? ` (${esc(u.role === "social_media" ? "social media" : u.role)})` : ""}</option>`).join("")}
      </select>
    </label>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
      <label style="display:grid;gap:4px;font-size:13px;font-weight:600;color:var(--ink);">Post due by
        <input type="date" id="as-deadline" value="${esc(defaultDeadline)}" min="${esc(isoDay(new Date()))}" style="padding:8px 10px;border:1px solid var(--hairline,#e5e7eb);border-radius:8px;font-size:13px;font-family:inherit;">
      </label>
      <label style="display:grid;gap:4px;font-size:13px;font-weight:600;color:var(--ink);">Platform
        <select class="select" id="as-platform" style="font-weight:400;">
          ${PLATFORMS.map((p) => `<option value="${p}">${p === "any" ? "Any / their call" : p[0].toUpperCase() + p.slice(1)}</option>`).join("")}
        </select>
      </label>
    </div>
    <label style="display:grid;gap:4px;font-size:13px;font-weight:600;color:var(--ink);">Notes (optional)
      <textarea id="as-notes" rows="3" placeholder="Angle, must-include links, tone…" style="padding:9px 12px;border:1px solid var(--hairline,#e5e7eb);border-radius:8px;font-size:13px;font-family:inherit;resize:vertical;"></textarea>
    </label>
    <div style="font-size:12px;color:var(--muted);">They'll get an email with the article, deadline, and your notes — replies come back to you.</div>
  `;

  const articleSel = body.querySelector("#as-article");
  const customInput = body.querySelector("#as-custom-title");
  articleSel.addEventListener("change", () => {
    customInput.style.display = articleSel.value === "other" ? "block" : "none";
    if (articleSel.value === "other") customInput.focus();
  });

  const cancelBtn = el("button", { class: "btn btn-secondary" }, "Cancel");
  const saveBtn = el("button", { class: "btn btn-primary" }, "Assign & email");
  const modal = openModal({ title: "Assign a social post", body, footer: [cancelBtn, saveBtn] });
  if (!modal) return;
  cancelBtn.addEventListener("click", () => modal.close());

  saveBtn.addEventListener("click", async () => {
    const sel = articleSel.value;
    let articleTitle = "", projectId = null, storyId = null;
    if (sel === "custom") {
      articleTitle = prefill.articleTitle || "";
      projectId = prefill.projectId || null;
      storyId = prefill.storyId || null;
    } else if (sel === "other") {
      articleTitle = customInput.value.trim();
    } else if (sel.startsWith("p:")) {
      const p = upcoming.find((x) => x.id === sel.slice(2));
      articleTitle = p?.title || ""; projectId = p?.id || null;
    } else if (sel.startsWith("s:")) {
      const s = published.find((x) => x.id === sel.slice(2));
      articleTitle = s?.title || ""; storyId = s?.id || null;
    }
    const assigneeId = body.querySelector("#as-assignee").value;
    const assignee = team.find((u) => u.id === assigneeId);
    const deadline = body.querySelector("#as-deadline").value;
    if (!articleTitle) { toast("Pick an article (or type one in).", "error"); return; }
    if (!assignee) { toast("Pick who's making the post.", "error"); return; }
    if (!deadline) { toast("Set a deadline.", "error"); return; }

    saveBtn.disabled = true;
    saveBtn.textContent = "Assigning…";
    try {
      const ref = await addDoc(collection(db, "social_assignments"), {
        articleTitle,
        projectId,
        storyId,
        platform: body.querySelector("#as-platform").value,
        deadline,
        notes: body.querySelector("#as-notes").value.trim(),
        assigneeId: assignee.id,
        assigneeName: assignee.name || assignee.email || "",
        assigneeEmail: assignee.email || "",
        status: "open",
        createdById: ctx.user.uid,
        createdByName: ctx.profile.name || ctx.user.email,
        createdAt: new Date().toISOString(),
        doneAt: null,
      });
      modal.close();
      toast(`Assigned to ${assignee.name || assignee.email} — emailing them now.`, "success");
      reload();
      // Best-effort email; the assignment exists either way.
      ctx.authedFetch("/api/notify/assignment", {
        method: "POST",
        body: JSON.stringify({ assignmentId: ref.id }),
      }).catch((err) => console.warn("assignment email failed (non-blocking):", err));
    } catch (err) {
      toast("Could not assign: " + err.message, "error");
      saveBtn.disabled = false;
      saveBtn.textContent = "Assign & email";
    }
  });
}

// ─── Up next ──────────────────────────────────────────────────────────────────

function isActiveProject(p) {
  if (p.proposalStatus === "rejected") return false;
  if (p.timeline?.["Published"] === true) return false;
  return true;
}

function pubDateOf(p) {
  return p.deadlines?.publication || p.deadline || null;
}

function renderUpcoming(ctx, mountEl, state, reload) {
  const active = state.projects.filter(isActiveProject).sort((a, b) => {
    const da = parseDay(pubDateOf(a));
    const db_ = parseDay(pubDateOf(b));
    if (da && db_) return da - db_;
    if (da) return -1;
    if (db_) return 1;
    return String(a.title || "").localeCompare(String(b.title || ""));
  });

  if (!active.length) {
    mountEl.innerHTML = `<div class="empty-state">No stories in the pipeline right now. New proposals will show up here automatically.</div>`;
    return;
  }

  mountEl.innerHTML = "";
  for (const p of active) {
    mountEl.appendChild(renderUpcomingRow(ctx, p, state, reload));
  }
}

function renderUpcomingRow(ctx, p, state, reload) {
  const pubDateStr = pubDateOf(p);
  const pubDate = parseDay(pubDateStr);
  const stale = pubDate && pubDate < startOfToday();
  const countdown = countdownPill(pubDate);
  const stage = stageLabel(p);
  const authorFirst = String(p.authorName || "the writer").trim().split(/\s+/)[0];

  const row = el("div", {
    style: "border:1px solid var(--hairline,#e5e7eb);border-radius:12px;padding:16px 18px;margin-bottom:12px;display:flex;flex-direction:column;gap:12px;",
  });
  row.innerHTML = `
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;">
      <div style="min-width:0;">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <span style="font-weight:700;font-size:15px;color:var(--ink);letter-spacing:-.01em;">${esc(p.title || "(untitled story)")}</span>
          <span class="pill pill-draft" style="font-size:11px;">${esc(p.type || "Article")}</span>
          ${countdown}
        </div>
        <div style="margin-top:6px;display:flex;align-items:center;gap:14px;flex-wrap:wrap;font-size:12.5px;color:var(--muted);">
          <span style="display:inline-flex;align-items:center;gap:6px;">
            <span style="width:20px;height:20px;border-radius:50%;background:${avatarColor(p.authorName)};color:#fff;display:inline-flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;">${esc((p.authorName || "?")[0].toUpperCase())}</span>
            ${esc(p.authorName || "Unassigned")}
          </span>
          <span>Stage: <strong style="color:var(--ink-2);">${esc(stage)}</strong></span>
          <span>Publication: <strong style="color:var(--ink-2);">${pubDateStr ? esc(fmtDate(pubDateStr)) : "no date set"}</strong></span>
          ${p.editorName ? `<span>Editor: <strong style="color:var(--ink-2);">${esc(p.editorName)}</strong></span>` : ""}
        </div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="btn btn-secondary btn-xs" data-act="proposal">View proposal</button>
        <button class="btn btn-secondary btn-xs" data-act="chat">Message ${esc(authorFirst)}</button>
        ${canAssign(ctx) ? `<button class="btn btn-secondary btn-xs" data-act="assign">Assign post</button>` : ""}
      </div>
    </div>
    ${renderPrepPlan(p, pubDate, stale, authorFirst)}
  `;

  row.querySelector('[data-act="proposal"]').addEventListener("click", () => openProposalModal(p));
  row.querySelector('[data-act="chat"]').addEventListener("click", () => openChatModal(ctx, p));
  row.querySelector('[data-act="assign"]')?.addEventListener("click", () =>
    openAssignModal(ctx, state, reload, {
      articleTitle: p.title || "",
      projectId: p.id,
      deadline: pubDate && !stale ? isoDay(new Date(pubDate.getTime() - 86400000)) : undefined,
    }));
  return row;
}

// The per-story prep section under each "Up next" row. Three shapes:
//   - no publication date  → short note, no fake checklist
//   - date already passed  → "this date looks stale, confirm with the writer"
//   - date ahead           → plain-language plan with relative phrasing
function renderPrepPlan(p, pubDate, stale, authorFirst) {
  if (!pubDate) {
    return `<div style="font-size:12.5px;color:var(--muted);">No publication date yet — a prep plan appears here once an admin sets one. If you need a date, message ${esc(authorFirst)}.</div>`;
  }
  if (stale) {
    return `
      <div style="font-size:12.5px;line-height:1.6;background:var(--surface-2,#fffbeb);border:1px solid var(--hairline,#fde68a);border-radius:8px;padding:10px 12px;color:var(--ink-2);">
        <strong>Check this date:</strong> the planned publication date
        (${esc(fmtDate(pubDate))}) has passed but the story isn't live yet, so
        the schedule is probably out of date. Message ${esc(authorFirst)} to
        confirm the new date before planning posts — the prep plan will update
        automatically once it changes.
      </div>`;
  }
  const cadence = buildCadence(pubDate);
  return `
    <div>
      <div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:6px;">Suggested prep — based on the ${esc(fmtDate(pubDate))} publication date</div>
      <div style="display:flex;flex-direction:column;gap:5px;">
        ${cadence.map((c) => `
          <div style="display:flex;align-items:center;gap:10px;font-size:12.5px;">
            ${cadenceDot(c.state)}
            <span style="color:${c.state === "overdue" ? "var(--danger,#b91c1c)" : c.state === "today" ? "var(--ink)" : "var(--ink-2)"};${c.state === "today" || c.state === "overdue" ? "font-weight:700;" : ""}">${esc(c.label)}</span>
            <span style="margin-left:auto;color:var(--muted);white-space:nowrap;">${esc(c.when)} · ${esc(fmtDate(c.dateStr))}</span>
            ${c.state === "today" ? `<span class="pill pill-pending" style="font-size:10.5px;">do today</span>` : ""}
            ${c.state === "overdue" ? `<span class="pill pill-rejected" style="font-size:10.5px;">catch up</span>` : ""}
          </div>`).join("")}
      </div>
    </div>`;
}

// Coarse stage from the timeline checkboxes — enough for the social team to
// judge how "real" a story is without learning the whole pipeline.
function stageLabel(p) {
  const tl = p.timeline || {};
  if (p.proposalStatus !== "approved") return `Proposal ${p.proposalStatus || "pending"}`;
  if (tl["Edits Addressed"]) return "Final checks";
  if (tl["Review Complete"]) return "Author addressing edits";
  if (tl["Article Writing Complete"]) return "In editing";
  if (p.type === "Interview" && !tl["Interview Complete"]) {
    return tl["Interview Scheduled"] ? "Interview scheduled" : "Scheduling interview";
  }
  return "Writing";
}

function buildCadence(pubDate) {
  const today = startOfToday();
  return CADENCE.map((c) => {
    const d = new Date(pubDate.getTime() + c.offset * 86400000);
    const diff = Math.round((d - today) / 86400000);
    let state = "upcoming";
    if (diff === 0) state = "today";
    else if (diff < 0) state = c.offset >= 0 ? "past" : "overdue";
    // Pre-publish steps that slipped are "overdue" (still worth doing);
    // post-publish steps in the past are simply behind us.
    return { ...c, dateStr: isoDay(d), state };
  });
}

function cadenceDot(state) {
  const color = {
    overdue: "var(--danger,#b91c1c)",
    today: "var(--accent,#0f172a)",
    upcoming: "var(--hairline,#cbd5e1)",
    past: "var(--hairline,#e2e8f0)",
  }[state] || "var(--hairline)";
  return `<span style="width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0;"></span>`;
}

function countdownPill(pubDate) {
  if (!pubDate) return "";
  const days = Math.round((pubDate - startOfToday()) / 86400000);
  if (days < 0) return `<span class="pill pill-rejected" style="font-size:11px;">date passed — confirm</span>`;
  if (days === 0) return `<span class="pill pill-published" style="font-size:11px;">publishes today</span>`;
  if (days <= 7) return `<span class="pill pill-pending" style="font-size:11px;">in ${days} day${days === 1 ? "" : "s"}</span>`;
  return `<span class="pill pill-draft" style="font-size:11px;">in ${days} days</span>`;
}

// ─── Proposal modal ───────────────────────────────────────────────────────────

function openProposalModal(p) {
  const deadlines = p.deadlines || {};
  const rows = [
    ["Author", p.authorName || "—"],
    ["Editor", p.editorName || "Not assigned"],
    ["Type", p.type || "Article"],
    ["Proposal status", p.proposalStatus || "pending"],
    p.interviewDate ? ["Interview", fmtDate(p.interviewDate)] : null,
    deadlines.draft ? ["Draft due", fmtDate(deadlines.draft)] : null,
    deadlines.review ? ["Review due", fmtDate(deadlines.review)] : null,
    pubDateOf(p) ? ["Publication", fmtDate(pubDateOf(p))] : null,
  ].filter(Boolean);

  const body = el("div", { style: "display:flex;flex-direction:column;gap:14px;" });
  body.innerHTML = `
    <div style="display:grid;grid-template-columns:130px 1fr;gap:6px 12px;font-size:13px;">
      ${rows.map(([k, v]) => `
        <div style="color:var(--muted);">${esc(k)}</div>
        <div style="color:var(--ink);font-weight:600;">${esc(v)}</div>`).join("")}
    </div>
    <div>
      <div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:6px;">Pitch / proposal</div>
      <div style="font-size:13.5px;line-height:1.65;color:var(--ink-2);white-space:pre-wrap;background:var(--surface-2,#f8fafc);border:1px solid var(--hairline,#e5e7eb);border-radius:8px;padding:14px 16px;max-height:320px;overflow:auto;">${esc(p.proposal || "No written proposal on file yet — message the writer if you need the angle.")}</div>
    </div>
  `;
  openModal({ title: p.title || "(untitled story)", body });
}

// ─── Chat modal (comment thread + email) ──────────────────────────────────────

function openChatModal(ctx, p) {
  const authorFirst = String(p.authorName || "the writer").trim().split(/\s+/)[0];
  const myUid = ctx.user.uid;

  const body = el("div", { style: "display:flex;flex-direction:column;gap:12px;min-width:min(520px,80vw);" });
  body.innerHTML = `
    <div style="font-size:12.5px;color:var(--muted);">
      Messages land in the story's comment feed <strong>and</strong> ${esc(authorFirst)} gets an email copy, so nothing waits on them being logged in.
    </div>
    <div id="pl-chat-feed" style="display:flex;flex-direction:column;gap:8px;max-height:300px;overflow:auto;padding:4px 2px;"></div>
    <div style="display:flex;gap:8px;">
      <input id="pl-chat-input" placeholder="Ask ${esc(authorFirst)} a question…" style="flex:1;padding:9px 12px;border:1px solid var(--hairline,#e5e7eb);border-radius:8px;font-size:13px;font-family:inherit;color:var(--ink);background:var(--surface,#fff);outline:none;">
      <button class="btn btn-primary btn-sm" id="pl-chat-send">Send</button>
    </div>
  `;

  const feed = body.querySelector("#pl-chat-feed");
  const renderFeed = (activity) => {
    const items = (Array.isArray(activity) ? activity : [])
      .slice()
      .sort((a, b) => String(a.timestamp || "").localeCompare(String(b.timestamp || "")))
      .slice(-40);
    feed.innerHTML = items.length ? "" :
      `<div style="font-size:12.5px;color:var(--muted);text-align:center;padding:16px 0;">No activity yet — say hi!</div>`;
    for (const a of items) {
      const mine = a.authorId === myUid;
      const text = String(a.text || "");
      const m = text.match(/^commented: "([\s\S]*)"$/);
      const display = m ? m[1] : text;
      const bubble = el("div", {
        style: `max-width:85%;align-self:${mine ? "flex-end" : "flex-start"};background:${mine ? "var(--accent,#0f172a)" : "var(--surface-2,#f1f5f9)"};color:${mine ? "#fff" : "var(--ink)"};border-radius:12px;padding:8px 12px;font-size:13px;line-height:1.5;${m ? "" : "opacity:.75;font-style:italic;"}`,
      });
      bubble.innerHTML = `
        <div style="font-size:10.5px;font-weight:700;opacity:.75;margin-bottom:2px;">${esc(a.authorName || "Someone")} · ${esc(fmtRelative(a.timestamp))}</div>
        <div style="white-space:pre-wrap;">${esc(display)}</div>`;
      feed.appendChild(bubble);
    }
    feed.scrollTop = feed.scrollHeight;
  };
  renderFeed(p.activity);

  const modal = openModal({ title: `Message ${p.authorName || "the writer"} — ${p.title || "(untitled)"}`, body });
  if (!modal) return;

  const input = body.querySelector("#pl-chat-input");
  const sendBtn = body.querySelector("#pl-chat-send");
  setTimeout(() => input.focus(), 0);

  const send = async () => {
    const text = input.value.trim();
    if (!text) return;
    sendBtn.disabled = true;
    const entry = {
      text: `commented: "${text}"`,
      authorName: ctx.profile.name || ctx.user.email,
      authorId: myUid,
      timestamp: new Date().toISOString(),
    };
    try {
      // Only chat fields — matches the staff comment rule in firestore.rules.
      await updateDoc(doc(db, "projects", p.id), {
        activity: arrayUnion(entry),
        lastActivity: serverTimestamp(),
        updatedAt: new Date().toISOString(),
      });
      p.activity = [...(p.activity || []), entry];
      renderFeed(p.activity);
      input.value = "";
      toast(`Sent — ${authorFirst} will also get an email.`, "success");

      // Best-effort email copy to the author. The comment is already saved;
      // a mail failure shouldn't look like a failed send.
      ctx.authedFetch("/api/notify/comment", {
        method: "POST",
        body: JSON.stringify({ projectId: p.id, message: text, toUserId: p.authorId || "" }),
      }).catch((err) => console.warn("comment email failed (non-blocking):", err));
    } catch (err) {
      toast("Could not send: " + err.message, "error");
    }
    sendBtn.disabled = false;
  };
  sendBtn.addEventListener("click", send);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  });
}

// ─── Just published ───────────────────────────────────────────────────────────

async function fetchPublishedStories() {
  const endpoint = "https://firestore.googleapis.com/v1/projects/catalystwriters-5ce43/databases/(default)/documents:runQuery";
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: "stories" }],
        where: {
          fieldFilter: {
            field: { fieldPath: "status" },
            op: "EQUAL",
            value: { stringValue: "published" },
          },
        },
        orderBy: [{ field: { fieldPath: "publishedAt" }, direction: "DESCENDING" }],
        select: {
          fields: [
            { fieldPath: "title" },
            { fieldPath: "authorName" },
            { fieldPath: "author" },
            { fieldPath: "publishedAt" },
            { fieldPath: "category" },
            { fieldPath: "slug" },
          ],
        },
        limit: 20,
      },
    }),
  });
  if (!res.ok) throw new Error(`Firestore ${res.status}`);
  const rows = await res.json();
  return (Array.isArray(rows) ? rows : [])
    .filter((r) => r.document)
    .map((r) => {
      const f = r.document.fields || {};
      const str = (k) => f[k]?.stringValue || "";
      return {
        id: r.document.name.split("/").pop(),
        title: str("title"),
        authorName: str("authorName") || str("author"),
        publishedAt: str("publishedAt") || f.publishedAt?.timestampValue || "",
        category: str("category"),
        slug: str("slug"),
      };
    })
    // We don't make social posts for book reviews — keep them off the Planner.
    .filter((s) => s.category !== "book-review")
    .slice(0, 12);
}

function renderPublished(ctx, mountEl, state, reload) {
  const assigner = canAssign(ctx);
  const clearedById = new Map(state.cleared.map((c) => [c.id, c]));
  const active = state.stories.filter((s) => !clearedById.has(s.id));
  const cleared = state.stories.filter((s) => clearedById.has(s.id));

  mountEl.innerHTML = "";

  if (!active.length) {
    mountEl.appendChild(el("div", { class: "empty-state" },
      cleared.length
        ? "All caught up — every recent story has been posted for."
        : "Nothing published recently."));
  }

  for (const s of active) {
    const covered = hasSocialPost(s, state.posts);
    const url = `/article/${encodeURIComponent(s.slug || slugify(s.title))}`;
    const row = el("div", {
      style: "display:flex;align-items:center;gap:12px;padding:11px 4px;border-bottom:1px solid var(--hairline,#f1f5f9);flex-wrap:wrap;",
    });
    row.innerHTML = `
      <div style="flex:1;min-width:220px;">
        <a href="${esc(url)}" target="_blank" rel="noopener" style="font-weight:600;font-size:14px;color:var(--ink);text-decoration:none;">${esc(s.title || "(untitled)")}</a>
        <div style="font-size:12px;color:var(--muted);margin-top:2px;">
          ${esc(s.authorName || "The Catalyst")}${s.category ? ` · ${esc(s.category)}` : ""} · published ${esc(fmtRelative(s.publishedAt))}
        </div>
      </div>
      ${covered
        ? `<span class="pill pill-published" style="font-size:11px;">social: covered</span>`
        : `<span class="pill pill-pending" style="font-size:11px;">needs a post</span>
           ${assigner ? `<button class="btn btn-secondary btn-xs" data-act="assign">Assign post</button>` : ""}
           <a class="btn btn-secondary btn-xs" href="#/marketing/social">Create post</a>`}
      ${assigner ? `<button class="btn btn-ghost btn-xs" data-act="clear" title="Posts are done — remove this story from the Planner">Mark posted</button>` : ""}
    `;
    row.querySelector('[data-act="assign"]')?.addEventListener("click", () =>
      openAssignModal(ctx, state, reload, { articleTitle: s.title || "", storyId: s.id }));
    row.querySelector('[data-act="clear"]')?.addEventListener("click", async () => {
      try {
        await setDoc(doc(db, "planner_cleared", s.id), {
          storyId: s.id,
          title: s.title || "",
          clearedById: ctx.user.uid,
          clearedByName: ctx.profile.name || ctx.user.email,
          clearedAt: new Date().toISOString(),
        });
        toast(`"${s.title || "Story"}" marked as posted — cleared from the Planner.`, "success");
        reload();
      } catch (err) { toast("Could not mark as posted: " + err.message, "error"); }
    });
    mountEl.appendChild(row);
  }

  // Cleared stories live in a collapsed section so the working list stays
  // clean but nothing is lost — the social lead can restore a story if a
  // post still needs doing.
  if (cleared.length) {
    const toggle = el("button", {
      class: "btn btn-ghost btn-xs",
      style: "margin-top:10px;color:var(--muted);",
    }, `Already posted (${cleared.length}) — show`);
    const list = el("div", { style: "display:none;margin-top:6px;" });
    toggle.addEventListener("click", () => {
      const open = list.style.display !== "none";
      list.style.display = open ? "none" : "block";
      toggle.textContent = `Already posted (${cleared.length}) — ${open ? "show" : "hide"}`;
    });
    for (const s of cleared) {
      const meta = clearedById.get(s.id) || {};
      const row = el("div", {
        style: "display:flex;align-items:center;gap:12px;padding:8px 4px;border-bottom:1px solid var(--hairline,#f1f5f9);flex-wrap:wrap;opacity:.7;",
      });
      row.innerHTML = `
        <div style="flex:1;min-width:220px;">
          <span style="font-weight:600;font-size:13px;color:var(--ink);">${esc(s.title || "(untitled)")}</span>
          <div style="font-size:11.5px;color:var(--muted);margin-top:2px;">
            marked posted by ${esc(meta.clearedByName || "—")}${meta.clearedAt ? ` · ${esc(fmtRelative(meta.clearedAt))}` : ""}
          </div>
        </div>
        <span class="pill pill-published" style="font-size:10.5px;">posted</span>
        ${assigner ? `<button class="btn btn-ghost btn-xs" data-act="restore">Restore</button>` : ""}
      `;
      row.querySelector('[data-act="restore"]')?.addEventListener("click", async () => {
        try {
          await deleteDoc(doc(db, "planner_cleared", s.id));
          toast("Restored to the Planner.", "info");
          reload();
        } catch (err) { toast("Could not restore: " + err.message, "error"); }
      });
      list.appendChild(row);
    }
    mountEl.appendChild(toggle);
    mountEl.appendChild(list);
  }
}

// A published story counts as "covered" when any social post references it —
// by articleId when available, by title substring for legacy posts. Mirrors
// the matching used by the social board's "Needs a post" suggestions.
function hasSocialPost(story, posts) {
  const titleLc = String(story.title || "").toLowerCase();
  return (posts || []).some((post) => {
    if (post.articleId && post.articleId === story.id) return true;
    if (!titleLc) return false;
    const haystack = `${post.title || ""} ${post.articleTitle || ""}`.toLowerCase();
    return haystack.includes(titleLc);
  });
}

// ─── Small utils ──────────────────────────────────────────────────────────────

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function isoDay(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Parse a YYYY-MM-DD (or ISO) date string to a local-midnight Date, or null.
function parseDay(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isFinite(d.getTime()) ? d : null;
}

function avatarColor(name) {
  const palette = ["#0f766e", "#7c3aed", "#b45309", "#1d4ed8", "#be185d", "#15803d", "#475569"];
  let h = 0;
  for (const ch of String(name || "?")) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return palette[h % palette.length];
}
