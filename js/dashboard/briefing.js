// Admin Briefing — the "I just got back, catch me up" page.
//
// Built for the admin who's been away (a trip, a busy week) and opens the
// dashboard cold: it answers, in order,
//   1. What happened while I was gone?      → plain-English summary + digest
//   2. What do I need to do right now?      → top tasks (shared task-engine)
//   3. What's finished and waiting on me?   → ready-to-publish list (purple)
//   4. Who do I need to reach out to?       → per-person check-in list with
//                                             ready-to-send messages
//
// "Since you were away" is anchored on taskPrefs/{uid}.briefingLastSeenAt —
// the admin presses "I'm caught up" to reset it, so the new-since markers
// reflect *their* last real catch-up, not merely their last page load.
// Falls back to a 14-day window before the first press.
//
// Data sources (all live except where noted):
//   • projects  (workflow pipeline, primary db)         — onSnapshot
//   • users     (roster, primary db)                    — onSnapshot
//   • taskPrefs/{uid} (snooze/dismiss + lastSeen)       — onSnapshot
//   • published stories (public runQuery, title-level)  — one fetch per mount
//   • pending reader book reviews                       — one fetch per mount

import { db as workflowDb } from "../firebase-dual-config.js";
import { db as primaryDb } from "../firebase-config.js";
import {
  collection,
  onSnapshot,
  doc,
  setDoc,
  deleteField,
  getDocs,
  query,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { el, esc, slugify } from "./ui.js";
import {
  buildAdminTasks,
  createTaskRowRenderer,
  ensureTaskStyles,
  FINAL_STEP,
  IDLE_WARNING_DAYS,
  IDLE_STALE_DAYS,
  projectLastTouched,
  pubDeadline,
  daysUntil,
  fmtRelative,
  fmtDateShort,
} from "./task-engine.js";
import { isProjectPublished, isProjectCompleted, fetchPublishedTitleSet } from "./publish-sync.js";

const FALLBACK_WINDOW_DAYS = 14; // "since" window before the first "I'm caught up"
const MAX_DO_NEXT = 8;           // top tasks shown here; the rest live on #/admin/tasks

// ─── small helpers ───────────────────────────────────────────────────────────

function toMs(v) {
  if (!v) return 0;
  if (typeof v === "object" && v.seconds) return v.seconds * 1000;
  const t = new Date(v).getTime();
  return isNaN(t) ? 0 : t;
}

function pipelineHref(project) {
  return `#/pipeline/${project.type === "Op-Ed" ? "opeds" : "interviews"}`;
}

function firstName(name) {
  const n = String(name || "").trim();
  return n ? n.split(/\s+/)[0] : "";
}

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : (many || one + "s")}`;
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

// Translate a raw project-activity entry into a sentence a returning admin
// can actually read. The raw texts are written by pipeline.js (e.g.
// "completed: Review Complete"); this maps them to what they *mean*.
function describeActivity(text) {
  const t = String(text || "").trim();
  const step = t.match(/^(completed|uncompleted):\s*(.+)$/i);
  if (step) {
    const undone = step[1].toLowerCase() === "uncompleted";
    const friendly = {
      "Topic Proposal Complete":   "completed the topic proposal",
      "Interview Scheduled":       "scheduled the interview",
      "Interview Complete":        "finished the interview",
      "Article Writing Complete":  "finished writing the draft — it's ready for editing",
      "Review Complete":           "finished the editorial review — the suggestions are with the writer",
      "Suggestions Reviewed":      "reviewed the editor's suggestions — the piece is fully edited",
    }[step[2].trim()] || `marked “${step[2].trim()}” done`;
    return undone ? `walked back “${step[2].trim()}”` : friendly;
  }
  const comment = t.match(/^commented:\s*"?([\s\S]*?)"?\s*$/i);
  if (comment) return { comment: comment[1].trim() };
  return t; // already human-written ("approved the proposal", "assigned X as editor", …)
}

// The events worth surfacing in a catch-up digest, weighted so structural
// changes outrank chatter.
function activityWeight(text) {
  const t = String(text || "");
  if (/Suggestions Reviewed|Review Complete|Article Writing Complete/i.test(t)) return 3;
  if (/published|approved the proposal|assigned .* as editor|reassigned editor/i.test(t)) return 3;
  if (/^commented/i.test(t)) return 1;
  return 2;
}

// Recent published stories with enough fields for the digest (public data).
async function fetchRecentPublished(limit = 25) {
  const endpoint = "https://firestore.googleapis.com/v1/projects/catalystwriters-5ce43/databases/(default)/documents:runQuery";
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: "stories" }],
        where: { fieldFilter: { field: { fieldPath: "status" }, op: "EQUAL", value: { stringValue: "published" } } },
        orderBy: [{ field: { fieldPath: "publishedAt" }, direction: "DESCENDING" }],
        select: { fields: [
          { fieldPath: "title" }, { fieldPath: "authorName" }, { fieldPath: "author" },
          { fieldPath: "publishedAt" }, { fieldPath: "slug" }, { fieldPath: "category" },
        ] },
        limit,
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
        slug: str("slug"),
        category: str("category"),
      };
    });
}

// ─── who-to-check-in-with ────────────────────────────────────────────────────
//
// Derived straight from project state (not just the stalled-only task list) so
// a returning admin sees EVERY open hand-off — most importantly writers who
// haven't looked at their editor's suggestions yet, even if it's only been a
// day or two.

function buildCheckIns(projects) {
  const byPerson = new Map(); // name → { name, items: [] }

  const add = (name, item) => {
    const key = String(name || "").trim();
    if (!key) return;
    if (!byPerson.has(key)) byPerson.set(key, { name: key, items: [] });
    byPerson.get(key).items.push(item);
  };

  for (const p of projects) {
    if (p.proposalStatus !== "approved") continue;
    if (isProjectCompleted(p)) continue;
    const tl = p.timeline || {};
    const title = p.title || "Untitled";
    const href = pipelineHref(p);
    const lastTouched = projectLastTouched(p);
    const idleDays = lastTouched ? Math.floor((Date.now() - lastTouched) / 86400000) : null;
    const due = pubDeadline(p);
    const dDue = due ? daysUntil(due) : null;
    const overdue = dDue !== null && dDue < 0;
    const stalled = idleDays !== null && idleDays >= IDLE_WARNING_DAYS;

    if (tl["Review Complete"] && !tl[FINAL_STEP]) {
      // The scenario that prompted this page: edits delivered, writer hasn't
      // reviewed them. Always shown, stalled or not.
      add(p.authorName, {
        role: "writer", title, href, idleDays, overdue,
        urgency: overdue ? 2 : stalled ? 2 : 1,
        reason: `has editor feedback waiting on “${title}” — needs to review the suggestions to finish it`,
        message: `Hey ${firstName(p.authorName) || "there"}, ${p.editorName ? p.editorName + " " : "the editor "}finished reviewing "${title}" — could you take a look at the suggestions when you get a chance so we can wrap it up? Let me know if any of the notes are unclear.`,
      });
      continue;
    }
    if (tl["Article Writing Complete"] && p.editorId && !tl["Review Complete"]) {
      add(p.editorName, {
        role: "editor", title, href, idleDays, overdue,
        urgency: overdue || stalled ? 2 : 0,
        reason: `is editing “${title}”${stalled ? ` — quiet for ${idleDays} days` : ""}`,
        message: `Hey ${firstName(p.editorName) || "there"}, checking in on the edits for "${title}"${stalled ? ` — it's been quiet for ${idleDays} days` : ""}. How's it looking on your end? Anything you need from me?`,
      });
      continue;
    }
    if (p.type === "Interview" && !p.noInterview && !tl["Interview Scheduled"] && !tl["Interview Complete"]) {
      add(p.authorName, {
        role: "writer", title, href, idleDays, overdue,
        urgency: overdue ? 2 : stalled ? 1 : 0,
        reason: `still needs to book the interview for “${title}”`,
        message: `Hey ${firstName(p.authorName) || "there"}, just checking in on "${title}" — looks like the interview isn't booked yet. Are you able to lock in a date, or is anything blocking you?`,
      });
      continue;
    }
    if (!tl["Article Writing Complete"] && (overdue || stalled)) {
      add(p.authorName, {
        role: "writer", title, href, idleDays, overdue,
        urgency: overdue ? 2 : 1,
        reason: overdue
          ? `is past the deadline on “${title}” and still drafting`
          : `hasn't touched “${title}” in ${idleDays} days while drafting`,
        message: `Hey ${firstName(p.authorName) || "there"}, checking in on "${title}" — how's the draft coming along? Let me know if you're stuck on anything.`,
      });
    }
  }

  const people = [...byPerson.values()];
  for (const person of people) {
    person.maxUrgency = Math.max(...person.items.map((i) => i.urgency));
    person.items.sort((a, b) => b.urgency - a.urgency);
  }
  people.sort((a, b) => b.maxUrgency - a.maxUrgency || b.items.length - a.items.length);
  return people;
}

// ─── mount ───────────────────────────────────────────────────────────────────

export async function mount(ctx, container) {
  container.innerHTML = "";
  ensureTaskStyles();
  ensureBriefingStyles();

  const name = firstName(ctx.profile?.name) || "there";

  // ── Skeleton ────────────────────────────────────────────────────────────────
  const hero = el("div", { class: "card brief-hero" });
  hero.innerHTML = `
    <div class="card-body">
      <div class="brief-hero-top">
        <div>
          <div class="brief-hello">${esc(greeting())}, ${esc(name)}.</div>
          <div class="brief-since" id="brief-since">Working out what you've missed&hellip;</div>
        </div>
        <button type="button" class="btn btn-secondary btn-sm" id="brief-caughtup" title="Reset the 'new since you were away' markers to now">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
          I'm caught up
        </button>
      </div>
      <div class="brief-summary" id="brief-summary"><div class="loading-state"><div class="spinner"></div>Reading the room&hellip;</div></div>
    </div>`;
  container.appendChild(hero);

  const mkSection = (id, title, sub, iconSvg) => {
    const card = el("div", { class: "card brief-section" });
    card.innerHTML = `
      <div class="card-header">
        <div>
          <div class="card-title"><span class="admin-tasks-icon" aria-hidden="true">${iconSvg}</span>${esc(title)}</div>
          <div class="card-subtitle">${sub}</div>
        </div>
        <div class="brief-section-side" id="${id}-side"></div>
      </div>
      <div class="card-body" id="${id}-body"><div class="loading-state"><div class="spinner"></div>Loading&hellip;</div></div>`;
    container.appendChild(card);
    return { body: card.querySelector(`#${id}-body`), side: card.querySelector(`#${id}-side`) };
  };

  const doNext = mkSection("brief-donext", "Do next",
    `Your highest-priority actions, from the same engine as the Tasks page.`,
    `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>`);

  const publish = mkSection("brief-publish", "Ready to publish",
    `Fully edited — the writer has reviewed the editor's suggestions. These show as <strong style="color:#6d28d9;">purple cards</strong> on the pipeline until you publish them.`,
    `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`);

  const people = mkSection("brief-people", "Who to check in with",
    `Everyone currently holding a hand-off, with a ready-to-send message. Writers who haven't reviewed their edits are always listed.`,
    `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`);

  const digest = mkSection("brief-digest", "While you were away",
    `Every meaningful change since your last catch-up — stage moves, hand-offs, comments, and what went live.`,
    `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`);

  // ── State ───────────────────────────────────────────────────────────────────
  const state = {
    projects: [],
    users: [],
    taskOverrides: {},
    lastSeenAt: null,       // ISO string or null (never caught up yet)
    published: [],          // recent published stories
    publishedTitles: new Set(),
    bookReviewsPending: 0,
    loaded: { projects: false, published: false },
  };

  const sinceMs = () => {
    const saved = toMs(state.lastSeenAt);
    return saved || (Date.now() - FALLBACK_WINDOW_DAYS * 86400000);
  };

  const prefsRef = ctx.user?.uid ? doc(workflowDb, "taskPrefs", ctx.user.uid) : null;

  async function setTaskOverride(taskKey, override) {
    if (override === null) delete state.taskOverrides[taskKey];
    else state.taskOverrides[taskKey] = override;
    renderAll();
    if (!prefsRef) return;
    try {
      await setDoc(prefsRef, { overrides: { [taskKey]: override === null ? deleteField() : override } }, { merge: true });
    } catch (e) {
      console.warn("[briefing] failed to save task override", e);
      ctx.toast("Couldn't save that — it may reappear on reload.", "error");
    }
  }

  const renderTaskRow = createTaskRowRenderer({
    toast: ctx.toast,
    setTaskOverride,
    getMenuRoot: () => doNext.body,
  });

  hero.querySelector("#brief-caughtup").addEventListener("click", async () => {
    const now = new Date().toISOString();
    state.lastSeenAt = now;
    renderAll();
    ctx.toast("Marked caught up — the “new” markers reset from now.", "success");
    if (!prefsRef) return;
    try { await setDoc(prefsRef, { briefingLastSeenAt: now }, { merge: true }); }
    catch (e) { console.warn("[briefing] failed to save lastSeen", e); }
  });

  // ── Subscriptions / fetches ─────────────────────────────────────────────────
  const unsubProjects = onSnapshot(collection(workflowDb, "projects"),
    (snap) => {
      state.projects = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      state.loaded.projects = true;
      renderAll();
    },
    (err) => {
      console.error("[briefing] projects snapshot error", err);
      doNext.body.innerHTML = `<div class="error-state">Failed to load projects: ${esc(err.message)}</div>`;
    });

  const unsubUsers = onSnapshot(collection(workflowDb, "users"),
    (snap) => { state.users = snap.docs.map((d) => ({ id: d.id, ...d.data() })); renderAll(); },
    (err) => { console.warn("[briefing] users snapshot error", err); });

  const unsubPrefs = prefsRef
    ? onSnapshot(prefsRef, (snap) => {
        const data = snap.exists() ? snap.data() : {};
        state.taskOverrides = data.overrides || {};
        state.lastSeenAt = data.briefingLastSeenAt || null;
        renderAll();
      }, (err) => console.warn("[briefing] prefs snapshot error", err))
    : () => {};

  // Recent stories feed the digest; the full title set (title-only, cheap)
  // decides which completed projects are actually live vs. awaiting publish.
  Promise.allSettled([fetchRecentPublished(25), fetchPublishedTitleSet()])
    .then(([recent, titles]) => {
      if (recent.status === "fulfilled") state.published = recent.value;
      else console.warn("[briefing] published fetch failed", recent.reason);
      if (titles.status === "fulfilled") state.publishedTitles = titles.value;
      else console.warn("[briefing] published-title fetch failed", titles.reason);
      state.loaded.published = true;
      renderAll();
    });

  (async () => {
    try {
      const snap = await getDocs(query(collection(primaryDb, "bookReviewSubmissions")));
      state.bookReviewsPending = snap.docs.filter((d) => ((d.data().status) || "pending") === "pending").length;
      renderAll();
    } catch (e) { console.warn("[briefing] book review count failed", e); }
  })();

  // ── Renderers ───────────────────────────────────────────────────────────────

  function readyToPublish() {
    return state.projects
      .filter((p) => isProjectCompleted(p) && !isProjectPublished(p, state.publishedTitles))
      .sort((a, b) => (projectLastTouched(b) || 0) - (projectLastTouched(a) || 0));
  }

  function renderAll() {
    if (!state.loaded.projects) return;
    renderSummary();
    renderDoNext();
    renderPublish();
    renderPeople();
    renderDigest();
  }

  function renderSummary() {
    const since = sinceMs();
    const sinceEl = hero.querySelector("#brief-since");
    sinceEl.innerHTML = state.lastSeenAt
      ? `You last marked yourself caught up <strong>${esc(fmtRelative(state.lastSeenAt))}</strong> (${esc(fmtDateShort(state.lastSeenAt))}). Here's everything since.`
      : `First briefing — showing the last <strong>${FALLBACK_WINDOW_DAYS} days</strong>. Press “I'm caught up” when you're done to start tracking from now.`;

    // Counts for the plain-English summary.
    let updates = 0;
    const touched = new Set();
    for (const p of state.projects) {
      for (const a of p.activity || []) {
        if (toMs(a.timestamp) > since) { updates++; touched.add(p.id); }
      }
    }
    const publishedSince = state.published.filter((s) => toMs(s.publishedAt) > since).length;
    const ready = readyToPublish().length;
    const awaitingWriter = state.projects.filter((p) =>
      p.proposalStatus === "approved" && p.timeline?.["Review Complete"] && !p.timeline?.[FINAL_STEP]).length;
    const needsEditor = state.projects.filter((p) =>
      p.proposalStatus === "approved" && p.timeline?.["Article Writing Complete"] && !p.editorId && !p.timeline?.["Review Complete"]).length;
    const proposals = state.projects.filter((p) =>
      p.proposalStatus !== "approved" && p.proposalStatus !== "rejected").length;
    const deadlineReqs = state.projects.filter((p) =>
      p.deadlineRequest?.status === "pending" || p.deadlineChangeRequest?.status === "pending").length;
    const overdueCount = state.projects.filter((p) => {
      if (isProjectCompleted(p) || p.proposalStatus !== "approved") return false;
      const d = pubDeadline(p); const n = d ? daysUntil(d) : null;
      return n !== null && n < 0;
    }).length;
    const stalledCount = state.projects.filter((p) => {
      if (isProjectCompleted(p) || p.proposalStatus !== "approved") return false;
      const t = projectLastTouched(p);
      return t && (Date.now() - t) / 86400000 >= IDLE_STALE_DAYS;
    }).length;

    const whileAway = [];
    whileAway.push(updates
      ? `<strong>${plural(updates, "update")}</strong> across <strong>${plural(touched.size, "story", "stories")}</strong>`
      : `no pipeline activity`);
    if (publishedSince) whileAway.push(`<strong>${plural(publishedSince, "story", "stories")}</strong> went live`);

    const now = [];
    if (ready)          now.push(`<strong style="color:#6d28d9;">${plural(ready, "piece")}</strong> fully edited and waiting on you to publish`);
    if (awaitingWriter) now.push(`<strong>${plural(awaitingWriter, "writer")}</strong> still need${awaitingWriter === 1 ? "s" : ""} to review their editor's suggestions`);
    if (needsEditor)    now.push(`<strong>${plural(needsEditor, "finished draft")}</strong> ha${needsEditor === 1 ? "s" : "ve"} no editor assigned`);
    if (proposals)      now.push(`<strong>${plural(proposals, "proposal")}</strong> awaiting your approval`);
    if (deadlineReqs)   now.push(`<strong>${plural(deadlineReqs, "deadline-change request")}</strong> pending`);
    if (overdueCount)   now.push(`<strong style="color:#b91c1c;">${plural(overdueCount, "story", "stories")}</strong> past deadline`);
    else if (stalledCount) now.push(`<strong>${plural(stalledCount, "story", "stories")}</strong> stalled (${IDLE_STALE_DAYS}+ days quiet)`);
    if (state.bookReviewsPending) now.push(`<strong>${plural(state.bookReviewsPending, "reader book review")}</strong> in the queue`);

    hero.querySelector("#brief-summary").innerHTML = `
      <p class="brief-lede">
        While you were away: ${whileAway.join(", ")}.
        ${now.length
          ? `Right now, ${now.join("; ")}.`
          : `Right now there's nothing waiting on you — the pipeline is fully in motion.`}
      </p>`;
  }

  function renderDoNext() {
    const { active } = buildAdminTasks(state.projects, state.users, state.taskOverrides, {
      bookReviewsPending: state.bookReviewsPending,
    });
    doNext.side.innerHTML = active.length
      ? `<span class="admin-tasks-count"><strong>${active.length}</strong> open</span>`
      : `<span class="admin-tasks-count">All clear</span>`;

    doNext.body.innerHTML = "";
    if (!active.length) {
      doNext.body.innerHTML = `<div class="empty-state">Nothing needs you right now. Enjoy it.</div>`;
      return;
    }
    const list = el("div", { class: "admin-tasks-list" });
    for (const t of active.slice(0, MAX_DO_NEXT)) list.appendChild(renderTaskRow(t, false));
    doNext.body.appendChild(list);
    if (active.length > MAX_DO_NEXT) {
      doNext.body.appendChild(el("div", { class: "brief-more", html:
        `<a href="#/admin/tasks">See all ${active.length} on the Tasks page →</a>` }));
    }
  }

  function renderPublish() {
    const ready = readyToPublish();
    publish.side.innerHTML = ready.length ? `<span class="brief-pill-purple">${ready.length}</span>` : "";
    publish.body.innerHTML = "";
    if (!state.loaded.published) {
      publish.body.innerHTML = `<div class="loading-state"><div class="spinner"></div>Checking what's live&hellip;</div>`;
      return;
    }
    if (!ready.length) {
      publish.body.innerHTML = `<div class="empty-state">Nothing is waiting to be published — everything fully edited is already live.</div>`;
      return;
    }
    const list = el("div", { class: "brief-publish-list" });
    for (const p of ready) {
      const finished = projectLastTouched(p);
      const row = el("div", { class: "brief-publish-row" });
      row.innerHTML = `
        <div class="brief-publish-main">
          <div class="brief-publish-title">${esc(p.title || "Untitled")}</div>
          <div class="brief-publish-meta">${esc(p.type || "Story")} · by <strong>${esc(p.authorName || "?")}</strong>${p.editorName ? ` · edited by ${esc(p.editorName)}` : ""} · finished ${esc(finished ? fmtRelative(finished) : "recently")}</div>
        </div>
        <div class="brief-publish-actions">
          <a class="admin-task-action" href="${esc(pipelineHref(p))}">View card</a>
          <a class="admin-task-action brief-btn-purple" href="#/admin/articles">Publish →</a>
        </div>`;
      list.appendChild(row);
    }
    publish.body.appendChild(list);
  }

  function renderPeople() {
    const checkIns = buildCheckIns(state.projects);
    people.side.innerHTML = checkIns.length
      ? `<span class="admin-tasks-count"><strong>${checkIns.length}</strong> ${checkIns.length === 1 ? "person" : "people"}</span>` : "";
    people.body.innerHTML = "";
    if (!checkIns.length) {
      people.body.innerHTML = `<div class="empty-state">No open hand-offs — nobody is sitting on anything that needs a nudge.</div>`;
      return;
    }
    const roster = state.users || [];
    const list = el("div", { class: "brief-people-list" });
    for (const person of checkIns) {
      const match = roster.find((u) =>
        (u.name || "").trim().toLowerCase() === person.name.toLowerCase());
      const card = el("div", { class: `brief-person${person.maxUrgency >= 2 ? " brief-person-hot" : ""}` });
      const itemsHtml = person.items.map((i) => `
        <div class="brief-person-item">
          <span class="brief-person-dot${i.urgency >= 2 ? " is-hot" : i.urgency === 1 ? " is-warm" : ""}" aria-hidden="true"></span>
          <span class="brief-person-reason">${firstName(esc(person.name))} ${i.reason}${i.overdue ? ` <strong class="brief-overdue">· past deadline</strong>` : ""}</span>
          <span class="brief-person-item-actions">
            <a href="${esc(i.href)}" class="brief-person-open">Open</a>
            <button type="button" class="brief-person-copy" data-msg="${esc(i.message)}" title="Copy a ready-to-send message">Copy text</button>
          </span>
        </div>`).join("");
      card.innerHTML = `
        <div class="brief-person-head">
          <span class="brief-person-avatar" style="background:${avatarColor(person.name)}">${esc(person.name.trim()[0]?.toUpperCase() || "?")}</span>
          <span class="brief-person-name">${esc(person.name)}</span>
          <span class="brief-person-role">${esc(person.items[0].role)}</span>
          ${match?.email ? `<span class="brief-person-email">${esc(match.email)}</span>` : ""}
          <a class="brief-person-dm" href="#/directory" title="Message ${esc(person.name)} in the Directory">Message</a>
        </div>
        <div class="brief-person-items">${itemsHtml}</div>`;
      list.appendChild(card);
    }
    people.body.appendChild(list);

    people.body.querySelectorAll(".brief-person-copy").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const msg = btn.dataset.msg || "";
        try {
          await navigator.clipboard.writeText(msg);
          btn.textContent = "Copied!";
          btn.classList.add("is-done");
          ctx.toast("Message copied — paste it into your texts or the Directory chat.", "success");
          setTimeout(() => { btn.textContent = "Copy text"; btn.classList.remove("is-done"); }, 1800);
        } catch {
          ctx.toast("Couldn't copy automatically. Message: " + msg, "info");
        }
      });
    });
  }

  function renderDigest() {
    const since = sinceMs();
    digest.body.innerHTML = "";

    // Merge published stories + per-project activity into one grouped digest.
    const events = [];
    for (const s of state.published) {
      const ms = toMs(s.publishedAt);
      if (ms <= since) continue;
      events.push({
        ms, isPublish: true,
        projectKey: `pub:${s.id}`,
        projectTitle: s.title,
        href: `/${s.category === "book-review" ? "book-review" : "article"}/${encodeURIComponent(s.slug || slugify(s.title))}`,
        who: s.authorName || "",
        html: `<strong>${esc(s.title || "Untitled")}</strong> by ${esc(s.authorName || "?")} was <strong style="color:#15803d;">published</strong>`,
        weight: 3,
      });
    }
    for (const p of state.projects) {
      for (const a of p.activity || []) {
        const ms = toMs(a.timestamp);
        if (ms <= since) continue;
        const desc = describeActivity(a.text);
        const who = a.authorName || "Someone";
        events.push({
          ms, projectKey: p.id,
          projectTitle: p.title || "Untitled",
          href: pipelineHref(p),
          who,
          html: typeof desc === "object" && desc.comment
            ? `<strong>${esc(who)}</strong> commented: <span class="brief-quote">“${esc(desc.comment)}”</span>`
            : `<strong>${esc(who)}</strong> ${esc(desc)}`,
          weight: activityWeight(a.text),
        });
      }
    }

    if (!events.length) {
      digest.side.innerHTML = "";
      digest.body.innerHTML = `<div class="empty-state">Quiet — nothing has changed since ${state.lastSeenAt ? "you last caught up" : `the last ${FALLBACK_WINDOW_DAYS} days began`}.</div>`;
      return;
    }
    digest.side.innerHTML = `<span class="admin-tasks-count"><strong>${events.length}</strong> update${events.length === 1 ? "" : "s"}</span>`;

    // Group by story, newest activity first; inside a group, chronological so
    // it reads as a narrative ("finished the draft… was assigned an editor…").
    const groups = new Map();
    for (const ev of events) {
      if (!groups.has(ev.projectKey)) groups.set(ev.projectKey, { title: ev.projectTitle, href: ev.href, isPublish: !!ev.isPublish, events: [] });
      groups.get(ev.projectKey).events.push(ev);
    }
    const ordered = [...groups.values()]
      .map((g) => ({ ...g, latest: Math.max(...g.events.map((e) => e.ms)) }))
      .sort((a, b) => b.latest - a.latest);

    const wrap = el("div", { class: "brief-digest" });
    for (const g of ordered) {
      g.events.sort((a, b) => a.ms - b.ms);
      const shown = g.events.length > 6
        ? g.events.filter((e) => e.weight >= 2).slice(-6)
        : g.events;
      const hiddenCount = g.events.length - shown.length;
      const block = el("div", { class: "brief-digest-group" });
      block.innerHTML = `
        <div class="brief-digest-head">
          <a class="brief-digest-title" href="${esc(g.href)}"${g.isPublish ? ` target="_blank" rel="noopener"` : ""}>${esc(g.title)}</a>
          <span class="brief-digest-when">${esc(fmtDateShort(g.latest))}</span>
        </div>
        ${shown.map((e) => `
          <div class="brief-digest-row${e.weight >= 3 ? " is-major" : ""}">
            <span class="brief-digest-tick" aria-hidden="true"></span>
            <span class="brief-digest-text">${e.html}</span>
            <span class="brief-digest-time">${esc(fmtRelative(e.ms))}</span>
          </div>`).join("")}
        ${hiddenCount > 0 ? `<div class="brief-digest-more">+ ${hiddenCount} smaller update${hiddenCount === 1 ? "" : "s"} — open the card for the full feed</div>` : ""}`;
      wrap.appendChild(block);
    }
    digest.body.appendChild(wrap);
  }

  return () => { unsubProjects(); unsubUsers(); unsubPrefs(); };
}

// Stable per-name avatar color (same recipe as Activity/Tasks pages).
function avatarColor(str) {
  if (!str) return "#64748b";
  let h = 0;
  for (let i = 0; i < str.length; i++) h = str.charCodeAt(i) + ((h << 5) - h);
  return `hsl(${Math.abs(h) % 360}, 55%, 46%)`;
}

function ensureBriefingStyles() {
  if (document.getElementById("briefing-styles")) return;
  const s = document.createElement("style");
  s.id = "briefing-styles";
  s.textContent = `
    .brief-hero .brief-hero-top { display:flex; align-items:flex-start; justify-content:space-between; gap:14px; flex-wrap:wrap; }
    .brief-hello { font-size:20px; font-weight:800; color:#0b1220; }
    .brief-since { font-size:13px; color:#64748b; margin-top:4px; line-height:1.5; }
    .brief-hero #brief-caughtup { display:inline-flex; align-items:center; gap:6px; min-height:44px; }
    .brief-lede { font-size:14.5px; line-height:1.7; color:#334155; margin:14px 0 0;
      padding:14px 16px; background:#f8fafc; border:1px solid #e5e7eb; border-radius:10px; }

    .brief-section { margin-top:16px; }
    .brief-section .card-title { display:flex; align-items:center; gap:8px; }
    .brief-more { margin-top:12px; font-size:13px; }
    .brief-more a { color:#0f766e; font-weight:700; text-decoration:none; }
    .brief-more a:hover { text-decoration:underline; }

    .brief-pill-purple { display:inline-flex; align-items:center; justify-content:center;
      min-width:26px; height:26px; padding:0 9px; border-radius:999px;
      background:#ede9fe; color:#6d28d9; font-size:12px; font-weight:800; }

    /* Ready to publish */
    .brief-publish-list { display:flex; flex-direction:column; gap:10px; }
    .brief-publish-row { display:flex; align-items:center; gap:14px; flex-wrap:wrap;
      padding:13px 15px; background:#f5f3ff; border:1px solid #ddd6fe;
      border-left:3px solid #7c3aed; border-radius:10px; }
    .brief-publish-main { flex:1; min-width:220px; }
    .brief-publish-title { font-size:14px; font-weight:700; color:#0b1220; }
    .brief-publish-meta { font-size:12.5px; color:#64748b; margin-top:3px; }
    .brief-publish-actions { display:flex; gap:7px; }
    .brief-btn-purple { color:#6d28d9 !important; border-color:#c4b5fd !important; background:#faf5ff !important; }
    .brief-btn-purple:hover { background:#6d28d9 !important; color:#fff !important; border-color:#6d28d9 !important; }

    /* People */
    .brief-people-list { display:flex; flex-direction:column; gap:12px; }
    .brief-person { border:1px solid #e5e7eb; border-radius:10px; padding:13px 15px; background:#fff; }
    .brief-person-hot { border-color:#fecaca; background:#fffafa; }
    .brief-person-head { display:flex; align-items:center; gap:9px; flex-wrap:wrap; }
    .brief-person-avatar { width:30px; height:30px; border-radius:50%; color:#fff;
      display:inline-flex; align-items:center; justify-content:center; font-size:12px; font-weight:700; flex-shrink:0; }
    .brief-person-name { font-size:14px; font-weight:800; color:#0b1220; }
    .brief-person-role { font-size:10.5px; font-weight:800; text-transform:uppercase; letter-spacing:.05em;
      background:#f1f5f9; color:#64748b; padding:3px 8px; border-radius:999px; }
    .brief-person-email { font-size:12px; color:#94a3b8; }
    .brief-person-dm { margin-left:auto; font-size:12.5px; font-weight:700; color:#0f766e; text-decoration:none;
      padding:7px 10px; border:1px solid #99f6e4; border-radius:8px; background:#f0fdfa; min-height:36px; display:inline-flex; align-items:center; }
    .brief-person-dm:hover { background:#0f766e; color:#fff; border-color:#0f766e; }
    .brief-person-items { margin-top:10px; display:flex; flex-direction:column; gap:7px; }
    .brief-person-item { display:flex; align-items:center; gap:9px; flex-wrap:wrap; font-size:13px; color:#334155; line-height:1.5; }
    .brief-person-dot { width:8px; height:8px; border-radius:50%; background:#cbd5e1; flex-shrink:0; }
    .brief-person-dot.is-warm { background:#f59e0b; }
    .brief-person-dot.is-hot { background:#dc2626; }
    .brief-person-reason { flex:1; min-width:200px; }
    .brief-overdue { color:#b91c1c; }
    .brief-person-item-actions { display:flex; gap:6px; }
    .brief-person-open, .brief-person-copy {
      font-size:12px; font-weight:700; font-family:inherit; cursor:pointer; text-decoration:none;
      padding:6px 10px; border-radius:7px; min-height:32px; display:inline-flex; align-items:center;
    }
    .brief-person-open { color:#0f172a; border:1px solid #cbd5e1; background:#f8fafc; }
    .brief-person-open:hover { background:#0f172a; color:#fff; border-color:#0f172a; }
    .brief-person-copy { color:#0f766e; border:1px solid #99f6e4; background:#f0fdfa; }
    .brief-person-copy:hover { background:#0f766e; color:#fff; border-color:#0f766e; }
    .brief-person-copy.is-done { background:#dcfce7; color:#15803d; border-color:#86efac; }

    /* Digest */
    .brief-digest { display:flex; flex-direction:column; gap:14px; }
    .brief-digest-group { border:1px solid #e5e7eb; border-radius:10px; padding:12px 15px; background:#fff; }
    .brief-digest-head { display:flex; align-items:baseline; gap:10px; margin-bottom:8px; }
    .brief-digest-title { font-size:14px; font-weight:800; color:#0b1220; text-decoration:none;
      overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .brief-digest-title:hover { color:#0f766e; text-decoration:underline; }
    .brief-digest-when { margin-left:auto; flex-shrink:0; font-size:11.5px; color:#94a3b8; }
    .brief-digest-row { display:flex; align-items:baseline; gap:9px; padding:5px 0; font-size:13px; color:#334155; line-height:1.55; }
    .brief-digest-tick { width:7px; height:7px; border-radius:50%; background:#cbd5e1; flex-shrink:0; position:relative; top:-1px; }
    .brief-digest-row.is-major .brief-digest-tick { background:#7c3aed; }
    .brief-digest-row.is-major .brief-digest-text { color:#0b1220; }
    .brief-digest-text { flex:1; min-width:0; }
    .brief-quote { color:#475569; font-style:italic; }
    .brief-digest-time { flex-shrink:0; font-size:11px; color:#94a3b8; white-space:nowrap; }
    .brief-digest-more { font-size:12px; color:#94a3b8; padding-top:6px; }

    @media (max-width:600px) {
      .brief-person-dm { margin-left:0; }
      .brief-digest-title { white-space:normal; }
    }
  `;
  document.head.appendChild(s);
}
