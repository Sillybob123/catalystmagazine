// Overview page — friendly landing for every role, with the shared pipeline
// widget at the bottom so everyone sees what's going on.

import { db } from "../firebase-config.js";
import {
  collection,
  query,
  orderBy,
  limit,
  getDocs,
  getDoc,
  where,
  deleteDoc,
  doc,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { buildAdminTasks } from "./task-engine.js";
import { isProjectPublished } from "./publish-sync.js";
import { el, esc, fmtRelative, confirmDialog } from "./ui.js";
import { currentTheme, SEASONS, attachHeroField } from "./suite-theme.js?v=st-10";
import { editionDeadlinesCard } from "./edition-deadlines.js?v=1";
import { isStaff, whoseTurn, isMyTurn, nudgeFor, progressPct, stageLabel, readiness } from "./schedule-calendar.js?v=roles-5";

// Shortcuts at the top of Overview, per role: the three or four things that
// person opens most. Only routes they can reach are listed.
const SHORTCUTS = {
  admin:              [["#/admin/articles", "Articles & approvals"], ["#/pipeline/all", "Story Tracker"], ["#/admin/tasks", "Action items"], ["#/admin/submissions", "Submissions inbox"]],
  editor:             [["#/editor/queue", "Editing queue"], ["#/pipeline/mine", "My assignments"], ["#/writer/draft", "Write a draft"], ["#/tasks", "Team tasks"]],
  writer:             [["#/writer/draft", "Write a draft"], ["#/writer/mine", "My articles"], ["#/pipeline/mine", "My assignments"], ["#/writer/guidelines", "Editorial standards"]],
  marketing:          [["#/planner", "Planner"], ["#/marketing/social", "Social media posts"], ["#/marketing/analytics", "Subscribers & growth"], ["#/tasks", "Team tasks"]],
  social_media:       [["#/planner", "Planner"], ["#/marketing/social", "Social media posts"], ["#/tasks", "Team tasks"]],
  newsletter_builder: [["#/newsletter/builder", "Newsletter builder"], ["#/newsletter/history", "Campaign history"], ["#/tasks", "Team tasks"]],
};

function greetingFor(name) {
  const h = new Date().getHours();
  const part = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  const first = String(name || "").trim().split(/\s+/)[0];
  return first ? `${part}, ${first}.` : `${part}.`;
}

let _seasonListener = null;

export async function mount(ctx, container) {
  container.innerHTML = "";
  const isAdmin = ctx.role === "admin";
  container.classList.add("ov");

  // Greeting + shortcuts
  const hello = el("section", { class: "ov-hello" });
  const today = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  const shortcuts = SHORTCUTS[ctx.role] || [["#/pipeline/all", "Story Tracker"], ["#/tasks", "Team tasks"], ["#/directory", "Team & messages"]];
  hello.innerHTML = `
    <div class="ov-hello-text">
      <p class="ov-date">${esc(today)}</p>
      <h2 class="ov-greeting">${esc(greetingFor(ctx.profile?.name || ctx.user?.displayName))}</h2>
      ${isStaff(ctx.role) ? "" : `<p class="ov-lede">Here&rsquo;s the newsroom at a glance. Every section is in the menu; pin the pages you use most.</p>`}
    </div>
    <nav class="ov-shortcuts" aria-label="Shortcuts">
      ${shortcuts.map(([href, label]) => `<a class="ov-shortcut" href="${href}"><span>${esc(label)}</span><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg></a>`).join("")}
    </nav>`;
  container.appendChild(hello);
  // Seasonal theme (Advanced tools): the edition's photograph behind the
  // greeting. Follows live changes; the previous mount's listener is dropped.
  let detachField = null;
  const paintSeason = () => {
    if (!hello.isConnected) { detachField?.(); detachField = null; return; }
    const t = currentTheme();
    const season = t.season;
    hello.classList.toggle("has-season", !!season);
    hello.querySelectorAll(".ov-season-credit, .ov-season-mascot, .ov-season-line").forEach((n) => n.remove());
    detachField?.(); detachField = null;
    if (!season) return;
    const s = SEASONS[season];
    // A warm welcome under the greeting, naming the edition when it follows one.
    const edition = t.mode === "auto" && t.editionName
      ? ` The <b>${esc(t.editionName)}</b> edition is in the works.` : "";
    hello.querySelector(".ov-hello-text")?.insertAdjacentHTML("beforeend", `<p class="ov-season-line">${esc(s.hello)}${edition}</p>`);
    hello.insertAdjacentHTML("beforeend", `
      <img class="ov-season-mascot" src="${s.hero}" alt="${esc(s.heroAlt)}" decoding="async">
      <p class="ov-season-credit">${esc(s.place)}</p>`);
    detachField = attachHeroField(hello);   // its own flurry over the photo
  };
  if (_seasonListener) window.removeEventListener("suitetheme", _seasonListener);
  _seasonListener = paintSeason;
  window.addEventListener("suitetheme", paintSeason);
  paintSeason();

  // Staff announcements — admin-authored banners everyone on staff sees.
  // Loaded best-effort so a failure never blanks the page.
  const announceMount = el("div", { id: "overview-announcements" });
  container.appendChild(announceMount);
  loadAnnouncements(announceMount, ctx);

  // The edition in progress: its hard deadlines and launch, with a countdown,
  // and this person's own pieces (edition-deadlines.js).
  if (isAdmin || isStaff(ctx.role)) container.appendChild(editionDeadlinesCard(ctx));

  // Admins get the newsroom home: what needs them, what's coming, the
  // numbers, then the reminder bot folded away at the bottom.
  if (isAdmin) {
    const cleanup = mountAdminHome(container, ctx, hello);
    container.appendChild(botPanel(ctx));
    return cleanup;
  }

  // Everyone else: their own next steps, what's coming, their stories.
  if (isStaff(ctx.role)) return mountMemberHome(container, ctx, hello);
  container.appendChild(directoryCard());
}

// Catalyst bot (admin only): the controls and its email log, folded into
// one panel so they don't push the rest of the page down.
function botPanel(ctx) {
  const bot = el("details", { class: "card ov-bot" });
  bot.innerHTML = `
    <summary class="ov-bot-summary">
      <span class="ov-bot-icon" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 8V4M8.5 13.5h.01M15.5 13.5h.01M9 17h6"/></svg></span>
      <span class="ov-bot-text">
        <span class="card-title">Reminder bot</span>
        <span class="card-subtitle">Daily nudges to writers and editors, a Saturday digest for admins, and every email it has sent.</span>
      </span>
      <span class="ov-bot-stat" id="ov-bot-stat"></span>
      <svg class="ov-bot-caret" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
    </summary>
    <div class="card-body" id="bot-panel"></div>
    <div class="card-body ov-bot-log" id="bot-email-log"></div>`;
  mountBotPanel(bot.querySelector("#bot-panel"), ctx);
  mountBotEmailLog(bot.querySelector("#bot-email-log"), ctx);
  return bot;
}

// ─── Admin home ──────────────────────────────────────────────────────────────
// One screen that answers "what needs me, what's coming, how are we doing":
//   Needs you   the most urgent jobs (same engine as Action items) plus new
//               submissions and team tasks waiting for approval, one button each
//   Coming up   the next two weeks as an agenda (publications, interviews,
//               social posts, team task deadlines); the month grid lives on
//               its own page, #/calendar
//   At a glance four numbers, the newsletter, and what was published lately

const DAY = 86400000;
const startOfToday = () => { const t = new Date(); t.setHours(0, 0, 0, 0); return t; };
const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parseDay = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || "")); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
const daysFromToday = (s) => { const d = parseDay(s); return d ? Math.round((d - startOfToday()) / DAY) : null; };
const pubDateOf = (p) => p.deadlines?.publication || p.deadline || null;
const isDone = (p) => !!p.timeline?.["Suggestions Reviewed"];
const ARROW = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';

function dayLabel(iso) {
  const d = daysFromToday(iso);
  if (d === 0) return "Today";
  if (d === 1) return "Tomorrow";
  return parseDay(iso).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

function mountAdminHome(container, ctx, hello) {
  const uid = ctx.user?.uid;
  const home = el("div", { class: "oh" });
  home.innerHTML = `
    <section class="oh-card oh-needs" aria-labelledby="oh-needs-h">
      <header class="oh-head">
        <h3 id="oh-needs-h">Needs you</h3>
        <span class="oh-badge" id="oh-needs-count" hidden></span>
        <a class="oh-more" href="#/admin/tasks">All action items ${ARROW}</a>
      </header>
      <ol class="oh-list" id="oh-needs"><li class="oh-skel"></li><li class="oh-skel"></li><li class="oh-skel"></li></ol>
    </section>

    <section class="oh-card oh-agenda" aria-labelledby="oh-agenda-h">
      <header class="oh-head">
        <h3 id="oh-agenda-h">Coming up</h3>
        <span class="oh-sub">Next two weeks</span>
        <a class="oh-more" href="#/calendar">Full calendar ${ARROW}</a>
      </header>
      <div id="oh-agenda"><div class="oh-skel"></div><div class="oh-skel"></div></div>
    </section>

    <aside class="oh-side" aria-label="At a glance">
      <section class="oh-card">
        <header class="oh-head"><h3>At a glance</h3></header>
        <div class="oh-stats" id="oh-stats"></div>
      </section>
      <section class="oh-card oh-nl" id="nl-reminder"><div class="oh-skel"></div></section>
      <section class="oh-card" aria-labelledby="oh-pub-h">
        <header class="oh-head"><h3 id="oh-pub-h">Recently published</h3><a class="oh-more" href="#/admin/articles">All articles ${ARROW}</a></header>
        <ul class="oh-pub" id="oh-pub"><li class="oh-skel"></li></ul>
      </section>
    </aside>`;
  container.appendChild(home);
  loadNewsletterReminder(home.querySelector("#nl-reminder"), ctx);

  const state = { projects: null, users: [], overrides: {}, teamTasks: [], posts: [], submissions: null, published: null, bios: [] };
  const render = () => { renderNeeds(); renderAgenda(); renderStats(); renderSummary(); };

  // Live: the stories in the works. Everything else is read once.
  const unsub = onSnapshot(collection(db, "projects"), (snap) => {
    state.projects = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    render();
  }, (err) => {
    home.querySelector("#oh-needs").innerHTML = `<li class="oh-empty">Couldn't load the stories. ${esc(err?.message || "")}</li>`;
  });
  getDocs(collection(db, "users")).then((s) => { state.users = s.docs.map((d) => ({ id: d.id, ...d.data() })); render(); }).catch(() => {});
  if (uid) getDoc(doc(db, "taskPrefs", uid)).then((s) => { state.overrides = (s.exists() && s.data().overrides) || {}; render(); }).catch(() => {});
  getDocs(collection(db, "tasks")).then((s) => { state.teamTasks = s.docs.map((d) => ({ id: d.id, ...d.data() })); render(); }).catch(() => {});
  getDocs(collection(db, "social_assignments")).then((s) => { state.posts = s.docs.map((d) => ({ id: d.id, ...d.data() })); render(); }).catch(() => {});
  getDocs(query(collection(db, "bio_requests"), where("status", "==", "pending"))).then((s) => { state.bios = s.docs.map((d) => d.data()); render(); }).catch(() => {});
  ctx.authedFetch("/api/admin/submissions").then((r) => r.json()).then((d) => { state.submissions = d?.ok ? (d.submissions || []) : []; render(); }).catch(() => { state.submissions = []; });
  fetchRecentPublished().then((list) => { state.published = list; renderPublished(); renderStats(); }).catch(() => { state.published = []; renderPublished(); });

  // ── Needs you ──
  function needsItems() {
    if (!state.projects) return null;
    const byId = new Map(state.projects.map((p) => [p.id, p]));
    const { active } = buildAdminTasks(state.projects, state.users, state.overrides, {});
    // A "publish it" job for a story that's already live isn't a job.
    const jobs = active.filter((t) => !(t.kind === "publish" && isProjectPublished(byId.get(String(t.key).split(":")[0]))));
    const extra = [];
    const fresh = (state.submissions || []).filter((x) => x.status === "new");
    if (fresh.length) {
      const joins = fresh.filter((x) => /join/i.test(x.source || x.type || "")).length;
      const pitches = fresh.length - joins;
      const parts = [joins && `${joins} ${joins === 1 ? "application" : "applications"}`, pitches && `${pitches} ${pitches === 1 ? "pitch" : "pitches"}`].filter(Boolean);
      extra.push({ priority: "high", headline: `Read ${parts.join(" and ")} from the website`, context: "Submissions inbox · already read them? Mark them as read to clear this.", actionHref: "#/admin/submissions", actionLabel: "Open inbox",
        secondary: { label: "Mark as read", run: () => markSubmissionsRead(fresh) } });
    }
    if (state.bios.length) {
      const n = state.bios.length;
      extra.push({ priority: "high", headline: `Approve ${n} ${n === 1 ? "bio" : "bios"} for the About page`, context: state.bios.slice(0, 3).map((b) => esc(b.name || "")).join(" · ") + (n > 3 ? ` · +${n - 3}` : ""), actionHref: "#/admin/bios", actionLabel: "Review" });
    }
    const waiting = state.teamTasks.filter((t) => t.status === "pending");
    if (waiting.length) {
      extra.push({ priority: "high", headline: `Approve ${waiting.length} team ${waiting.length === 1 ? "task" : "tasks"}`, context: waiting.slice(0, 2).map((t) => esc(t.title || "")).join(" · ") + (waiting.length > 2 ? ` · +${waiting.length - 2}` : ""), actionHref: "#/tasks", actionLabel: "Review" });
    }
    const urgent = jobs.filter((t) => t.priority === "urgent");
    return [...urgent, ...extra, ...jobs.filter((t) => t.priority !== "urgent")];
  }

  function renderNeeds() {
    const list = home.querySelector("#oh-needs");
    const items = needsItems();
    if (!items) return;
    const count = home.querySelector("#oh-needs-count");
    count.hidden = !items.length; count.textContent = items.length;
    if (!items.length) {
      list.innerHTML = `<li class="oh-clear"><span class="oh-clear-ic" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></span><span><b>You're all caught up.</b> Nothing is waiting on you right now.</span></li>`;
      return;
    }
    const shown = items.slice(0, 6);
    list.innerHTML = shown.map((t) => `
      <li class="oh-job is-${t.priority}">
        <span class="oh-job-dot" aria-hidden="true"></span>
        <span class="oh-job-text">
          <span class="oh-job-title">${t.headline}</span>
          ${t.context ? `<span class="oh-job-meta">${t.context}</span>` : ""}
        </span>
        <span class="oh-job-actions">
          ${t.secondary ? `<button type="button" class="oh-job-btn oh-job-btn--quiet" data-secondary="${shown.indexOf(t)}">${esc(t.secondary.label)}</button>` : ""}
          ${t.actionHref ? `<a class="oh-job-btn" href="${esc(t.actionHref)}">${esc(t.actionLabel || "Open")}</a>` : ""}
        </span>
      </li>`).join("")
      + (items.length > shown.length ? `<li class="oh-list-more"><a href="#/admin/tasks">${items.length - shown.length} more in Action items ${ARROW}</a></li>` : "");
    list.querySelectorAll("[data-secondary]").forEach((b) => b.addEventListener("click", async () => {
      b.disabled = true; b.textContent = "Saving…";
      const ok = await shown[+b.dataset.secondary].secondary.run();
      if (!ok) { b.disabled = false; b.textContent = shown[+b.dataset.secondary].secondary.label; }
    }));
  }

  async function markSubmissionsRead(fresh) {
    try {
      const res = await ctx.authedFetch("/api/admin/submissions", { method: "POST", body: JSON.stringify({ ids: fresh.map((x) => x.id), patch: { status: "reviewing" } }) });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
      fresh.forEach((x) => { x.status = "reviewing"; });
      ctx.toast?.(`Marked ${data.updated} as read.`, "success");
      render();
      return true;
    } catch (err) {
      ctx.toast?.(`Couldn't mark them as read: ${err.message}`, "error");
      return false;
    }
  }

  // ── Coming up ──
  function renderAgenda() {
    if (!state.projects) return;
    home.querySelector("#oh-agenda").innerHTML = agendaHtml(collectAgenda(state));
  }

  // ── At a glance ──
  function renderStats() {
    const box = home.querySelector("#oh-stats");
    if (!state.projects) return;
    const ps = state.projects.filter((p) => p.proposalStatus !== "rejected" && !isProjectPublished(p));
    const pitches = ps.filter((p) => p.proposalStatus !== "approved").length;
    const working = ps.filter((p) => p.proposalStatus === "approved" && !isDone(p)).length;
    const behind = ps.filter((p) => { const pub = pubDateOf(p); const d = pub ? daysFromToday(pub) : null; return p.proposalStatus === "approved" && !isDone(p) && d !== null && d - 7 < 0; }).length;
    const month = state.published ? state.published.filter((x) => x.at && Date.now() - x.at < 30 * DAY).length : null;
    const tile = (n, label, href, tone = "") => `<a class="oh-stat${tone ? " is-" + tone : ""}" href="${href}"><b>${n ?? "–"}</b><span>${label}</span></a>`;
    box.innerHTML = tile(working, "Stories in the works", "#/pipeline/all")
      + tile(pitches, pitches === 1 ? "Pitch to review" : "Pitches to review", "#/pipeline/all", pitches ? "warn" : "")
      + tile(behind, "Behind schedule", "#/pipeline/all", behind ? "bad" : "")
      + tile(month, "Published this month", "#/admin/articles");
  }

  function renderPublished() {
    const box = home.querySelector("#oh-pub");
    const list = state.published || [];
    if (!list.length) { box.innerHTML = `<li class="oh-empty">Nothing published yet.</li>`; return; }
    box.innerHTML = list.slice(0, 5).map((x) => `
      <li><a href="${esc(x.href)}" target="_blank" rel="noopener">
        <span class="oh-pub-title">${esc(x.title)}</span>
        <span class="oh-pub-meta">${esc(x.author || "")}${x.at ? ` · ${esc(fmtRelative(new Date(x.at).toISOString()))}` : ""}</span>
      </a></li>`).join("");
  }

  // One line under the greeting: how much is waiting.
  function renderSummary() {
    const items = needsItems();
    if (!items) return;
    let line = hello.querySelector(".ov-summary");
    if (!line) { line = el("p", { class: "ov-summary" }); hello.querySelector(".ov-hello-text")?.appendChild(line); }
    const urgent = items.filter((t) => t.priority === "urgent").length;
    const week = (state.projects || []).filter((p) => { const d = daysFromToday(pubDateOf(p)); return d !== null && d >= 0 && d < 7 && !isProjectPublished(p); }).length;
    line.innerHTML = (items.length
      ? `<b>${items.length} ${items.length === 1 ? "thing needs" : "things need"} you</b>${urgent ? `, ${urgent} urgent` : ""}.`
      : `<b>You're all caught up.</b>`)
      + (week ? ` ${week} ${week === 1 ? "story publishes" : "stories publish"} this week.` : "");
  }

  return () => unsub();
}

// The next two weeks: publications, interviews, social posts and team task
// deadlines. `mine(uid)` narrows the personal ones to that person (the
// publication dates stay team-wide: everyone plans around them).
function collectAgenda(state, uid = null) {
  const horizon = 14;
  const inRange = (iso) => { const d = daysFromToday(iso); return d !== null && d >= 0 && d < horizon; };
  const onStory = (p) => !uid || p.authorId === uid || p.editorId === uid;
  const events = [];
  for (const p of state.projects || []) {
    if (p.proposalStatus === "rejected") continue;
    const pub = pubDateOf(p);
    if (pub && inRange(pub)) {
      const live = isProjectPublished(p);
      const ready = isDone(p);
      const behind = !ready && !live && (daysFromToday(pub) - 7) < 0;
      events.push({ date: pub.slice(0, 10), kind: "Publishes", title: p.title, who: p.authorName, mine: !!uid && onStory(p),
        tone: live || ready ? "good" : behind ? "bad" : "", status: live ? "Published" : ready ? "Ready" : behind ? "Behind" : "In progress", href: uid ? "#/pipeline/mine" : "#/pipeline/all" });
    }
    const iv = p.deadlines?.interview || p.interviewDate;
    if (iv && inRange(iv) && !p.timeline?.["Interview Complete"] && onStory(p)) events.push({ date: String(iv).slice(0, 10), kind: "Interview", title: p.title, who: p.authorName, href: uid ? "#/pipeline/mine" : "#/pipeline/all" });
  }
  for (const a of state.posts || []) {
    if (a.status === "published" || a.status === "done" || !inRange(a.deadline)) continue;
    const ids = Array.isArray(a.assigneeIds) && a.assigneeIds.length ? a.assigneeIds : [a.assigneeId];
    if (uid && !ids.includes(uid) && a.requestedById !== uid) continue;
    events.push({ date: String(a.deadline).slice(0, 10), kind: "Social post", title: a.articleTitle, who: a.assigneeName, href: "#/planner" });
  }
  for (const t of state.teamTasks || []) {
    if (t.status !== "approved" || !inRange(t.deadline)) continue;
    if (uid && !(t.assigneeIds || [t.assigneeId]).includes(uid)) continue;
    events.push({ date: String(t.deadline).slice(0, 10), kind: "Task due", title: t.title, who: (t.assigneeNames || [])[0], href: "#/tasks" });
  }
  return events.sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind));
}

function agendaHtml(events) {
  if (!events.length) return `<p class="oh-empty">Nothing scheduled in the next two weeks. <a href="#/calendar">Open the calendar</a> to plan ahead.</p>`;
  const byDay = new Map();
  for (const e of events.slice(0, 14)) (byDay.get(e.date) || byDay.set(e.date, []).get(e.date)).push(e);
  return [...byDay.entries()].map(([day, list]) => `
    <div class="oh-day">
      <h4 class="oh-day-label${daysFromToday(day) <= 1 ? " is-soon" : ""}">${esc(dayLabel(day))}</h4>
      <ul>${list.map((e) => `
        <li><a class="oh-event${e.mine ? " is-mine" : ""}" href="${e.href}">
          <span class="oh-kind oh-kind--${e.kind.replace(/\s+/g, "-").toLowerCase()}">${esc(e.kind)}</span>
          <span class="oh-event-title">${esc(e.title || "Untitled")}</span>
          ${e.mine ? `<span class="oh-event-who"><i class="oh-yours">Yours</i></span>` : e.who ? `<span class="oh-event-who">${esc(e.who)}</span>` : ""}
          ${e.status ? `<span class="oh-status${e.tone ? " is-" + e.tone : ""}">${esc(e.status)}</span>` : ""}
        </a></li>`).join("")}</ul>
    </div>`).join("") + (events.length > 14 ? `<p class="oh-agenda-more"><a href="#/calendar">${events.length - 14} more on the calendar ${ARROW}</a></p>` : "");
}

// ─── Everyone else's home ────────────────────────────────────────────────────
// Same shape as the admin's, about *you*:
//   Your next steps  stories where it's your move (worded for your role, from
//                    the calendar's logic), your team tasks, your social posts,
//                    unread messages
//   Coming up        publication dates + your interviews, posts and tasks
//   Side             your stories and where they stand, the newsletter (for
//                    the newsletter builder), Team & messages

const ROLE_LINKS = {
  editor: "#/editor/queue",
  writer: "#/pipeline/mine",
};

function mountMemberHome(container, ctx, hello) {
  const uid = ctx.user?.uid;
  const role = ctx.role;
  const isNewsletter = role === "newsletter_builder";
  const home = el("div", { class: "oh" });
  home.innerHTML = `
    <section class="oh-card oh-needs" aria-labelledby="oh-needs-h">
      <header class="oh-head">
        <h3 id="oh-needs-h">Your next steps</h3>
        <span class="oh-badge" id="oh-needs-count" hidden></span>
      </header>
      <ol class="oh-list" id="oh-needs"><li class="oh-skel"></li><li class="oh-skel"></li></ol>
    </section>

    <section class="oh-card oh-agenda" aria-labelledby="oh-agenda-h">
      <header class="oh-head">
        <h3 id="oh-agenda-h">Coming up</h3>
        <span class="oh-sub">Next two weeks</span>
        <a class="oh-more" href="#/calendar">Full calendar ${ARROW}</a>
      </header>
      <div id="oh-agenda"><div class="oh-skel"></div></div>
    </section>

    <aside class="oh-side">
      ${isNewsletter ? `<section class="oh-card oh-nl" id="nl-reminder"><div class="oh-skel"></div></section>` : ""}
      <section class="oh-card" id="oh-mine-card" hidden aria-labelledby="oh-mine-h">
        <header class="oh-head"><h3 id="oh-mine-h">Your stories</h3><a class="oh-more" href="#/pipeline/mine">My assignments ${ARROW}</a></header>
        <ul class="oh-mine" id="oh-mine"></ul>
      </section>
    </aside>`;
  container.appendChild(home);
  home.querySelector(".oh-side").appendChild(directoryCard());
  if (isNewsletter) loadNewsletterReminder(home.querySelector("#nl-reminder"), ctx);

  const state = { projects: null, teamTasks: [], posts: [], threads: [] };
  const render = () => { renderNext(); renderAgenda(); renderMine(); };

  const unsub = onSnapshot(collection(db, "projects"), (snap) => {
    state.projects = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    render();
  }, () => { state.projects = []; render(); });
  getDocs(collection(db, "tasks")).then((s) => { state.teamTasks = s.docs.map((d) => ({ id: d.id, ...d.data() })); render(); }).catch(() => {});
  getDocs(collection(db, "social_assignments")).then((s) => { state.posts = s.docs.map((d) => ({ id: d.id, ...d.data() })); render(); }).catch(() => {});
  if (uid) getDocs(query(collection(db, "dm_threads"), where("participantIds", "array-contains", uid))).then((s) => { state.threads = s.docs.map((d) => d.data()); render(); }).catch(() => {});

  const myStories = () => (state.projects || []).filter((p) => (p.authorId === uid || p.editorId === uid)
    && p.proposalStatus !== "rejected" && !isDone(p) && !isProjectPublished(p));

  function nextSteps() {
    if (!state.projects) return null;
    const items = [];
    for (const p of myStories()) {
      if (!isMyTurn(p, uid)) continue;
      const turn = whoseTurn(p, uid);
      const r = readiness(p);
      const nudge = nudgeFor(p, uid);
      const editing = turn.who === "editor";
      items.push({
        priority: r === "behind" ? "urgent" : r === "at-risk" ? "high" : "normal",
        due: pubDateOf(p) || "9999",
        headline: `${esc(turn.what.charAt(0).toUpperCase() + turn.what.slice(1))}: <strong>${esc(p.title || "Untitled")}</strong>`,
        context: esc(nudge.text),
        actionHref: editing ? "#/editor/queue" : (ROLE_LINKS[role] || "#/pipeline/mine"),
        actionLabel: editing ? "Open the queue" : "Open",
      });
    }
    for (const t of state.teamTasks) {
      if (t.status !== "approved" || !(t.assigneeIds || [t.assigneeId]).includes(uid)) continue;
      const d = daysFromToday(t.deadline);
      items.push({
        priority: d !== null && d < 0 ? "urgent" : d !== null && d <= 2 ? "high" : "normal",
        due: t.deadline || "9999",
        headline: `Team task: <strong>${esc(t.title || "Untitled")}</strong>`,
        context: t.deadline ? (d < 0 ? `<span class="admin-task-due admin-task-due-over">${-d} days late</span>` : `Due ${esc(dayLabel(t.deadline))}`) : "No due date",
        actionHref: "#/tasks", actionLabel: "Open",
      });
    }
    for (const a of state.posts) {
      const ids = Array.isArray(a.assigneeIds) && a.assigneeIds.length ? a.assigneeIds : [a.assigneeId];
      if (a.status === "published" || a.status === "done" || !ids.includes(uid)) continue;
      const d = daysFromToday(a.deadline);
      items.push({
        priority: d !== null && d < 0 ? "urgent" : d !== null && d <= 2 ? "high" : "normal",
        due: a.deadline || "9999",
        headline: `Social post: <strong>${esc(a.articleTitle || "Untitled")}</strong>`,
        context: a.deadline ? (d < 0 ? `<span class="admin-task-due admin-task-due-over">${-d} days late</span>` : `Due ${esc(dayLabel(a.deadline))}`) + (a.requestedByName ? ` · asked by ${esc(a.requestedByName)}` : "") : "No due date",
        actionHref: "#/planner", actionLabel: "Open planner",
      });
    }
    const unread = state.threads.filter((t) => t.lastMessage && t.lastMessage.senderId !== uid && String(t.readAt?.[uid] || "") < String(t.lastMessage.at || ""));
    if (unread.length) {
      const names = unread.map((t) => { const o = Object.entries(t.participants || {}).find(([k]) => k !== uid); return String(o?.[1]?.name || "").split(/\s+/)[0]; }).filter(Boolean);
      items.push({ priority: "high", due: "0000", headline: `${unread.length} unread ${unread.length === 1 ? "message" : "messages"}`, context: names.length ? `From ${esc(names.slice(0, 3).join(", "))}${names.length > 3 ? ` and ${names.length - 3} more` : ""}` : "", actionHref: "#/directory", actionLabel: "Read" });
    }
    const rank = { urgent: 0, high: 1, normal: 2 };
    return items.sort((a, b) => rank[a.priority] - rank[b.priority] || String(a.due).localeCompare(String(b.due)));
  }

  function renderNext() {
    const list = home.querySelector("#oh-needs");
    const items = nextSteps();
    if (!items) return;
    const count = home.querySelector("#oh-needs-count");
    count.hidden = !items.length; count.textContent = items.length;
    list.innerHTML = items.length ? items.slice(0, 8).map((t) => `
      <li class="oh-job is-${t.priority}">
        <span class="oh-job-dot" aria-hidden="true"></span>
        <span class="oh-job-text"><span class="oh-job-title">${t.headline}</span>${t.context ? `<span class="oh-job-meta">${t.context}</span>` : ""}</span>
        <span class="oh-job-actions"><a class="oh-job-btn" href="${esc(t.actionHref)}">${esc(t.actionLabel)}</a></span>
      </li>`).join("")
      : `<li class="oh-clear"><span class="oh-clear-ic" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></span><span><b>You're all caught up.</b> ${myStories().length ? "Your stories are waiting on someone else for now." : "Nothing is waiting on you right now."}</span></li>`;
    // Summary under the greeting.
    let line = hello.querySelector(".ov-summary");
    if (!line) { line = el("p", { class: "ov-summary" }); hello.querySelector(".ov-hello-text")?.appendChild(line); }
    const urgent = items.filter((t) => t.priority === "urgent").length;
    line.innerHTML = items.length
      ? `<b>${items.length} ${items.length === 1 ? "thing is" : "things are"} waiting on you</b>${urgent ? `, ${urgent} overdue` : ""}.`
      : `<b>You're all caught up.</b>`;
  }

  function renderAgenda() {
    if (!state.projects) return;
    home.querySelector("#oh-agenda").innerHTML = agendaHtml(collectAgenda(state, uid));
  }

  function renderMine() {
    const card = home.querySelector("#oh-mine-card");
    const mine = myStories().sort((a, b) => String(pubDateOf(a) || "9").localeCompare(String(pubDateOf(b) || "9")));
    card.hidden = !mine.length;
    if (!mine.length) return;
    home.querySelector("#oh-mine").innerHTML = mine.slice(0, 5).map((p) => {
      const pct = progressPct(p);
      const turn = whoseTurn(p, uid);
      const mineNow = isMyTurn(p, uid);
      const waitingOn = turn && !mineNow ? (turn.who === "editor" ? (p.editorName || "an editor") : turn.who === "writer" ? (p.authorName || "the writer") : "an admin") : "";
      return `<li>
        <a href="${ROLE_LINKS[role] || "#/pipeline/mine"}">
          <span class="oh-mine-title">${esc(p.title || "Untitled")}</span>
          <span class="oh-mine-meta">${esc(stageLabel(p))} · ${p.editorId === uid ? "you're editing" : "you're writing"}${pubDateOf(p) ? ` · publishes ${esc(dayLabel(pubDateOf(p)))}` : ""}</span>
          <span class="oh-bar" aria-hidden="true"><span style="width:${pct}%"></span></span>
          <span class="oh-mine-turn${mineNow ? " is-you" : ""}">${mineNow ? "Your move" : waitingOn ? `Waiting on ${esc(String(waitingOn).split(/\s+/)[0])}` : ""}</span>
        </a>
      </li>`;
    }).join("");
  }

  return () => unsub();
}

// Published stories, newest first, without downloading article bodies: the
// public REST runQuery with a field projection (published stories are
// world-readable). Sorted here so no composite index is needed.
async function fetchRecentPublished() {
  const res = await fetch("https://firestore.googleapis.com/v1/projects/catalystwriters-5ce43/databases/(default)/documents:runQuery", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ structuredQuery: {
      from: [{ collectionId: "stories" }],
      where: { fieldFilter: { field: { fieldPath: "status" }, op: "EQUAL", value: { stringValue: "published" } } },
      select: { fields: ["title", "authorName", "author", "slug", "category", "publishedAt", "updatedAt"].map((f) => ({ fieldPath: f })) },
      limit: 1000,
    } }),
  });
  if (!res.ok) throw new Error(`Firestore ${res.status}`);
  const rows = await res.json();
  const val = (f) => f ? (f.stringValue ?? f.timestampValue ?? f.integerValue ?? null) : null;
  return (Array.isArray(rows) ? rows : []).filter((r) => r.document).map((r) => {
    const f = r.document.fields || {};
    const slug = val(f.slug);
    const book = /book/i.test(val(f.category) || "");
    const at = Date.parse(val(f.publishedAt) || val(f.updatedAt) || "") || 0;
    return {
      title: val(f.title) || "Untitled",
      author: val(f.authorName) || val(f.author) || "",
      at: at > Date.now() + DAY ? 0 : at,
      href: slug ? `/${book ? "book-review" : "article"}/${encodeURIComponent(slug)}` : "/articles",
    };
  }).sort((a, b) => b.at - a.at);
}

function directoryCard() {
  const c = el("a", { class: "card ov-link-card", href: "#/directory" });
  c.innerHTML = `
    <span class="ov-link-icon" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.2"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><path d="M16 5.5a3 3 0 0 1 0 5.6M18.5 19a5 5 0 0 0-2.6-4.4"/></svg></span>
    <span><span class="card-title">Team &amp; messages</span><span class="card-subtitle">Everyone&rsquo;s role and contact details, and a private message button.</span></span>
    <svg class="ov-link-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>`;
  return c;
}

// ─── Staff announcement banners ──────────────────────────────────────────────
// Red, hard-to-miss banners admins post from Advanced tools → Announcements.
// Everyone on staff sees active ones at the top of their Overview. Non-admins
// can dismiss a banner for themselves (remembered in localStorage); admins see
// a "Remove for everyone" button that deletes the announcement.

const DISMISS_KEY = "catalyst.dashboard.dismissedAnnouncements";

function getDismissed() {
  try {
    const v = JSON.parse(localStorage.getItem(DISMISS_KEY) || "[]");
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}
function setDismissed(ids) {
  try { localStorage.setItem(DISMISS_KEY, JSON.stringify(ids.slice(-100))); } catch {}
}

async function loadAnnouncements(mount, ctx) {
  const isAdmin = ctx.role === "admin";
  let items = [];
  try {
    const snap = await getDocs(query(collection(db, "announcements"), limit(50)));
    const now = Date.now();
    items = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((a) => {
        if (a.active === false) return false;
        // Optional auto-expiry: hide once expiresAt passes.
        if (a.expiresAt && Date.parse(a.expiresAt) && Date.parse(a.expiresAt) < now) return false;
        return true;
      })
      .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  } catch (err) {
    console.warn("[overview] announcements load failed", err);
    return; // silent — never block the Overview
  }

  const dismissed = isAdmin ? [] : getDismissed();
  const render = () => {
    const visible = items.filter((a) => !dismissed.includes(a.id));
    if (!visible.length) { mount.innerHTML = ""; return; }
    mount.innerHTML = "";
    for (const a of visible) {
      mount.appendChild(announcementBanner(a, ctx, isAdmin, {
        onDismiss: () => {
          dismissed.push(a.id);
          setDismissed(dismissed);
          render();
        },
        onRemove: async (banner) => {
          const ok = await confirmDialog(
            "Remove this announcement for everyone on staff?",
            { confirmText: "Remove", danger: true });
          if (!ok) return;
          try {
            await deleteDoc(doc(db, "announcements", a.id));
            items = items.filter((x) => x.id !== a.id);
            render();
            ctx.toast("Announcement removed.", "success");
          } catch (err) {
            ctx.toast(`Could not remove: ${err?.message || err}`, "error");
          }
        },
      }));
    }
  };
  render();
}

function announcementBanner(a, ctx, isAdmin, { onDismiss, onRemove }) {
  const title = a.title || "Announcement";
  const wrap = el("div", {
    class: "ov-announce",
    style: "margin-bottom:18px;background:#fef2f2;border:1px solid #fecaca;border-left:4px solid #b91c1c;border-radius:12px;padding:16px 18px;display:flex;gap:14px;align-items:flex-start;",
  });

  const link = String(a.link || "").trim();
  const linkIsHash = link.startsWith("#/");
  const linkBtn = link
    ? `<a href="${esc(link)}"${linkIsHash ? "" : ` target="_blank" rel="noopener"`} class="btn btn-sm" style="background:#b91c1c;color:#fff;border-color:#b91c1c;margin-top:10px;display:inline-flex;align-items:center;gap:6px;">
         ${esc(a.linkLabel || "Open link")}
         <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
       </a>`
    : "";

  wrap.innerHTML = `
    <div style="width:34px;height:34px;border-radius:9px;background:#b91c1c;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px;">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
    </div>
    <div style="min-width:0;flex:1;">
      <div style="font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:#b91c1c;margin-bottom:3px;">Staff announcement</div>
      <div style="font-size:16px;font-weight:700;letter-spacing:-0.01em;line-height:1.35;color:var(--ink,#0a0a0c);">${esc(title)}</div>
      ${a.message ? `<div style="margin-top:6px;font-size:14px;line-height:1.6;color:var(--ink-2,#374151);white-space:pre-wrap;">${esc(a.message)}</div>` : ""}
      <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;">
        ${linkBtn}
      </div>
      <div style="margin-top:10px;font-size:11.5px;color:var(--muted,#6b7280);">
        ${a.createdByName ? `Posted by ${esc(a.createdByName)}` : "Posted by the admins"}${a.createdAt ? ` · ${esc(fmtRelative(a.createdAt))}` : ""}${a.emailed ? " · emailed to staff" : ""}
      </div>
    </div>
    <div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0;">
      ${isAdmin
        ? `<button type="button" data-act="remove" class="btn btn-ghost btn-xs" style="color:#b91c1c;white-space:nowrap;">Remove for everyone</button>`
        : `<button type="button" data-act="dismiss" aria-label="Dismiss" title="Dismiss" style="border:0;background:transparent;cursor:pointer;color:#b91c1c;padding:2px 6px;font-size:18px;line-height:1;">&times;</button>`}
    </div>`;

  wrap.querySelector('[data-act="dismiss"]')?.addEventListener("click", () => onDismiss());
  wrap.querySelector('[data-act="remove"]')?.addEventListener("click", () => onRemove(wrap));
  return wrap;
}

async function loadNewsletterReminder(mount, ctx) {
  try {
    const res = await ctx.authedFetch("/api/newsletter/history");
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);

    const sent = (data.campaigns || []).filter((c) => c.status === "sent");
    const last = sent[0] || null;
    const lastDate = last ? new Date(last.sentAt || last.createdAt) : null;
    const now = Date.now();
    const TWO_WEEKS = 14 * 24 * 60 * 60 * 1000;
    const overdue = !lastDate || (now - lastDate.getTime()) > TWO_WEEKS;
    const daysSince = lastDate ? Math.floor((now - lastDate.getTime()) / (24 * 60 * 60 * 1000)) : null;

    mount.innerHTML = `
      <div class="ov-nl">
        <p class="ov-nl-kicker"><span class="ov-dot ${overdue ? "is-late" : "is-ok"}" aria-hidden="true"></span>Newsletter</p>
        <p class="ov-nl-title">${overdue
          ? (lastDate ? `Last sent ${daysSince} day${daysSince === 1 ? "" : "s"} ago` : "No issue sent yet")
          : `Sent ${daysSince === 0 ? "today" : daysSince + " day" + (daysSince === 1 ? "" : "s") + " ago"}`}</p>
        <p class="ov-nl-meta">${last
          ? `${esc(last.subject || "(no subject)")} · ${last.recipientCount || 0} recipients`
          : "Send the first issue to keep subscribers engaged."}</p>
        <p class="ov-nl-meta">${overdue ? "We aim to send one every two weeks." : "On schedule (every two weeks)."}</p>
        <a class="btn ${overdue ? "btn-primary" : "btn-secondary"} btn-sm" href="#/newsletter/builder">${overdue ? "Build the next issue" : "Open the builder"}</a>
      </div>`;
  } catch (err) {
    mount.innerHTML = `<div class="hint">Could not load newsletter status.</div>`;
  }
}


// ─── Catalyst bot control panel ─────────────────────────────────────────────

function mountBotPanel(mount, ctx) {
  const render = (state = "idle", result = null, err = null) => {
    mount.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:16px;">
        <div style="display:flex;align-items:center;gap:14px;">
          <div style="width:44px;height:44px;border-radius:12px;background:#0b0b0d;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round">
              <rect x="3" y="8" width="18" height="12" rx="2"/>
              <path d="M12 2v6"/>
              <circle cx="8.5" cy="13" r="1.2"/>
              <circle cx="15.5" cy="13" r="1.2"/>
              <path d="M9 17h6"/>
            </svg>
          </div>
          <div>
            <div style="font-weight:700;font-size:15px;color:var(--ink);">Catalyst editorial bot</div>
            <div style="font-size:13px;color:var(--muted);margin-top:2px;">
              Daily writer reminders (deadlines + 10-day idle checks) and a Saturday admin digest with copy-paste messages.
            </div>
          </div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn btn-ghost btn-sm" data-bot-action="preview" title="Compute what would be sent — nothing leaves the building.">Preview (dry run)</button>
          <button class="btn btn-ghost btn-sm" data-bot-action="digest-preview" title="Preview the Saturday digest without emailing anyone.">Preview digest</button>
          <a class="btn btn-ghost btn-sm" href="#/admin/users" title="Pause Catalyst bot reminders for specific writers.">Manage exemptions</a>
          <button class="btn btn-secondary btn-sm" data-bot-action="digest-to-admins" title="Email the Saturday digest to the admin team right now.">Send digest to admins</button>
          <button class="btn btn-accent btn-sm" data-bot-action="run" title="Send every writer their reminder email now.">Run bot now</button>
        </div>
      </div>
      <div id="bot-status" style="margin-top:14px;"></div>
    `;

    const statusEl = mount.querySelector("#bot-status");
    if (state === "running") {
      statusEl.innerHTML = `<div class="hint" style="display:flex;align-items:center;gap:8px;"><div class="spinner"></div>Running — this takes a few seconds…</div>`;
    } else if (state === "error") {
      statusEl.innerHTML = `<div class="error-state">${esc(err?.message || err || "Something went wrong.")}</div>`;
    } else if (state === "done" && result) {
      statusEl.innerHTML = renderBotResult(result);
      wireBotResultHandlers(statusEl, result);
    }

    mount.querySelectorAll("[data-bot-action]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const action = btn.dataset.botAction;
        // "preview"          → compute writer reminders + force-preview the digest, dry run
        // "digest-preview"   → only show what the digest would contain, no send
        // "digest-to-admins" → force-send the digest to the admin team right now
        // "run"              → send all writer reminders AND force-send digest
        const payload =
          action === "preview"         ? { mode: "auto", dryRun: true, forceDigest: true } :
          action === "digest-preview"  ? { mode: "digest", dryRun: true } :
          action === "digest-to-admins" ? { mode: "digest-to-admins" } :
                                          { mode: "auto", forceDigest: true };

        if (action === "digest-to-admins") {
          if (!confirm("Send the Saturday digest email to all admins right now?")) return;
        }
        if (action === "run") {
          if (!confirm("This will actually email every planned writer. Continue?")) return;
        }

        render("running");
        try {
          const res = await ctx.authedFetch("/api/bot/run", {
            method: "POST",
            body: JSON.stringify(payload),
          });
          const data = await res.json();
          if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
          render("done", data);
        } catch (e) {
          render("error", null, e);
        }
      });
    });
  };

  render();
}

function renderBotResult(r) {
  const w = r.writerReminders || {};
  const d = r.adminDigest || {};
  const items = Array.isArray(w.items) ? w.items : [];
  const skipped = Array.isArray(w.skipped) ? w.skipped : [];

  const headerTone = r.dryRun
    ? { bg: "#eff6ff", border: "#bfdbfe", ink: "#1e3a8a", title: "Preview — nothing sent." }
    : { bg: "#f0fdf4", border: "#bbf7d0", ink: "#14532d", title: "Bot run complete." };

  return `
    <div style="background:${headerTone.bg};border:1px solid ${headerTone.border};border-radius:12px;padding:14px 16px;">
      <div style="font-weight:700;font-size:14px;color:${headerTone.ink};margin-bottom:6px;">${headerTone.title}</div>
      <div style="font-size:13px;color:${headerTone.ink};line-height:1.6;">
        Scanned <strong>${r.projectsScanned}</strong> projects across <strong>${r.usersScanned}</strong> users.
        Writer reminders: <strong>${w.planned || 0}</strong> planned${r.dryRun ? "" : `, <strong>${w.sent || 0}</strong> sent`}${skipped.length ? `, <strong>${skipped.length}</strong> skipped` : ""}${w.errors?.length ? `, <strong>${w.errors.length}</strong> failed` : ""}.
        ${d.sent ? ` Admin digest <strong>sent</strong> to <strong>${d.recipientCount}</strong> recipient${d.recipientCount === 1 ? "" : "s"}.` : ""}
        ${d.skipped ? ` Digest: ${esc(d.skipped)}.` : ""}
        ${d.error ? ` Digest error: <strong>${esc(d.error)}</strong>.` : ""}
      </div>
      ${w.errors?.length ? `<div style="margin-top:10px;font-size:12px;color:#991b1b;"><strong>Errors:</strong> ${w.errors.map(e => esc(e.error)).join("; ")}</div>` : ""}
    </div>

    ${r.policy ? renderPolicy(r.policy) : ""}
    ${items.length ? renderPlannedReminders(items) : ""}
    ${skipped.length ? renderSkippedReminders(skipped) : ""}
    ${d.rows ? renderDigestPreview(d) : ""}
  `;
}

// What the nudge policy decided this run, in plain words.
const HOLD_REASON = {
  "one-nudge-per-story": "Another reminder about the same story went instead",
  "waiting-on-admin": "Not their move: waiting on an admin",
  "waiting-on-editor": "Not their move: waiting on the editor",
  "waiting-on-writer": "Not their move: waiting on the writer",
  "pitch-not-approved": "Pitch not approved yet",
  "story-declined": "Story was declined",
  "story-finished": "Story is finished",
  "backing-off": "Backing off: the last reminder hasn't been answered",
  "stopped-after-3-unanswered": "Stopped: 3+ reminders unanswered (admins told instead)",
  "weekend": "Weekend: routine reminders wait for Monday",
};
function renderPolicy(pol) {
  const held = Array.isArray(pol.held) ? pol.held : [];
  const esc8 = Array.isArray(pol.escalations) ? pol.escalations : [];
  if (!held.length && !esc8.length) return "";
  return `
    <div class="bot-policy">
      <p class="bot-policy-title">Held back today (${held.length})</p>
      ${held.length ? `<ul>${held.map((h) => `<li><strong>${esc(h.projectTitle || "Story")}</strong> · ${esc(h.recipientEmail || "")}<span>${esc(HOLD_REASON[h.reason] || h.reason)}${h.nextInDays ? ` (next possible in ${h.nextInDays}d)` : ""}</span></li>`).join("")}</ul>` : `<p class="pm-muted">Nothing held back.</p>`}
      ${esc8.length ? `<p class="bot-policy-title">Needs a person (${esc8.length})</p>
        <ul>${esc8.map((x) => `<li><strong>${esc(x.personName)}</strong> on ${esc(x.projectTitle)}<span>${x.unanswered} reminders since ${esc(String(x.firstUnansweredAt).slice(0, 10))} with no change. The bot has stopped emailing them about it.</span></li>`).join("")}</ul>` : ""}
    </div>`;
}

function renderPlannedReminders(items) {
  const rows = items.map((it, idx) => {
    const kindBadge = kindLabel(it.kind);
    const meta = [
      it.daysUntilDeadline != null ? `${it.daysUntilDeadline}d to deadline` : null,
      it.daysInactive != null ? `${it.daysInactive}d idle` : null,
    ].filter(Boolean).join(" · ");

    return `
      <div style="border-top:1px solid var(--hairline,#e5e7eb);">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;padding:12px 14px;gap:12px;cursor:pointer;" data-reminder-toggle="${idx}">
          <div style="min-width:0;flex:1;">
            <div style="font-weight:600;font-size:14px;color:var(--ink,#111);">
              <span style="display:inline-block;background:${kindBadge.bg};color:${kindBadge.ink};font-size:10px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;padding:2px 8px;border-radius:999px;margin-right:8px;vertical-align:middle;">${esc(kindBadge.text)}</span>
              ${esc(it.writerName || it.writerEmail)}
              <span style="color:var(--muted,#6b7280);font-weight:400;"> — ${esc(it.projectTitle || "(untitled)")}</span>
            </div>
            <div style="margin-top:4px;font-size:12px;color:var(--muted,#6b7280);">
              <span style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">${esc(it.writerEmail)}</span>
              ${meta ? ` · ${esc(meta)}` : ""}
            </div>
            <div style="margin-top:6px;font-size:13px;color:var(--ink-2,#374151);line-height:1.45;">
              <strong>Subject:</strong> ${esc(it.subject || "(no subject)")}
            </div>
          </div>
          <button class="btn btn-ghost btn-xs" type="button" style="flex-shrink:0;" data-reminder-toggle="${idx}">View full email &rarr;</button>
        </div>
        <div data-reminder-body="${idx}" style="display:none;padding:0 14px 14px 14px;">
          <div style="border:1px solid var(--hairline,#e5e7eb);border-radius:10px;overflow:hidden;background:#fff;">
            <iframe data-reminder-frame="${idx}" sandbox="allow-same-origin" style="width:100%;border:0;display:block;background:#fff;min-height:200px;" scrolling="no"></iframe>
          </div>
        </div>
      </div>
    `;
  }).join("");

  return `
    <div style="margin-top:14px;border:1px solid var(--hairline,#e5e7eb);border-radius:12px;overflow:hidden;">
      <div style="padding:10px 14px;background:#f8fafc;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted,#6b7280);">
        Planned writer emails (${items.length})
      </div>
      ${rows}
    </div>
  `;
}

function renderSkippedReminders(skipped) {
  // Group by reason so admins see "writer-not-found ×5" rather than a flat list.
  const byReason = {};
  for (const s of skipped) {
    if (!byReason[s.reason]) byReason[s.reason] = [];
    byReason[s.reason].push(s);
  }

  const REASON_LABELS = {
    "writer-not-found":  { label: "Writer not found in users",   hint: "The project's authorId / authorName / authorEmail doesn't match any row in the users collection. The writer won't be emailed until they sign in (which creates their user doc) or the authorId on the project is healed." },
    "writer-has-no-email": { label: "Writer has no email",        hint: "Their users/{uid} doc is missing an email field." },
    "writer-exempt":     { label: "Writer reminder exemption",   hint: "An admin paused Catalyst bot reminder nudges for this writer, either indefinitely or until a specific date." },
    "cooldown-active":   { label: "7-day cooldown active",        hint: "A reminder of this kind was already sent within the past 7 days." },
    "project-complete":  { label: "Story already published",      hint: "timeline['Suggestions Reviewed'] is true." },
    "no-activity-data":  { label: "No activity/deadline data",    hint: "The project has no deadline, no updatedAt, and no activity entries — nothing to compare against." },
    "not-idle-yet":      { label: "Near idle, not triggered yet", hint: "Close to but still under the 10-day idle threshold." },
  };

  const sections = Object.entries(byReason).map(([reason, list]) => {
    const meta = REASON_LABELS[reason] || { label: reason, hint: "" };
    const tone = reason === "writer-not-found" || reason === "writer-has-no-email"
      ? { bg: "#fef2f2", border: "#fecaca", ink: "#991b1b" }
      : reason === "writer-exempt"
        ? { bg: "#eff6ff", border: "#bfdbfe", ink: "#1d4ed8" }
      : { bg: "#f8fafc", border: "#e5e7eb", ink: "#374151" };

    return `
      <div style="border:1px solid ${tone.border};background:${tone.bg};border-radius:10px;padding:12px 14px;margin-top:10px;">
        <div style="font-weight:700;font-size:13px;color:${tone.ink};">${esc(meta.label)} <span style="font-weight:500;color:var(--muted,#6b7280);">(${list.length})</span></div>
        ${meta.hint ? `<div style="margin-top:4px;font-size:12px;color:var(--muted,#6b7280);line-height:1.5;">${esc(meta.hint)}</div>` : ""}
        <div style="margin-top:8px;display:grid;gap:6px;">
          ${list.slice(0, 25).map((s) => `
            <div style="font-size:12.5px;color:${tone.ink};line-height:1.45;">
              <strong>${esc(s.projectTitle || "(untitled)")}</strong>
              ${s.writerName ? ` — ${esc(s.writerName)}` : ""}
              ${s.authorName && !s.writerName ? ` — author on project: ${esc(s.authorName)}` : ""}
              ${s.writerEmail ? ` <span style="color:var(--muted,#6b7280);font-family:ui-monospace,monospace;">${esc(s.writerEmail)}</span>` : ""}
              ${s.authorEmail && !s.writerEmail ? ` <span style="color:var(--muted,#6b7280);font-family:ui-monospace,monospace;">${esc(s.authorEmail)}</span>` : ""}
              ${s.daysInactive != null ? ` <span style="color:var(--muted,#6b7280);">· ${s.daysInactive}d idle</span>` : ""}
              ${s.kind ? ` <span style="color:var(--muted,#6b7280);">· ${esc(s.kind)}</span>` : ""}
              ${s.lastSentAt ? ` <span style="color:var(--muted,#6b7280);">· last sent ${esc(fmtShort(s.lastSentAt))}</span>` : ""}
              ${s.exemption ? ` <span style="color:var(--muted,#6b7280);">· ${esc(formatBotExemptionLabel(s.exemption))}</span>` : ""}
              ${s.exemption?.reason ? ` <span style="color:var(--muted,#6b7280);">· ${esc(s.exemption.reason)}</span>` : ""}
            </div>
          `).join("")}
          ${list.length > 25 ? `<div style="font-size:12px;color:var(--muted,#6b7280);">…and ${list.length - 25} more.</div>` : ""}
        </div>
      </div>
    `;
  }).join("");

  return `
    <div style="margin-top:14px;">
      <div style="font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted,#6b7280);padding:0 4px;">
        Skipped (${skipped.length}) — why these writers didn't make the list
      </div>
      ${sections}
    </div>
  `;
}

function renderDigestPreview(d) {
  const rows = Array.isArray(d.rows) ? d.rows : [];
  const flaggedRows = rows.filter((r) => r.flaggedCount > 0);

  const writerBlocks = rows.map((row) => {
    const flagged = row.flaggedCount > 0;
    const exempt = row.exemption;
    const headerBg = exempt ? "#eff6ff" : (flagged ? "#fff4e5" : "#f8fafc");
    const headerInk = exempt ? "#1d4ed8" : (flagged ? "#92400e" : "var(--ink,#111)");
    const projList = row.projects.map((p) => `
      <li style="margin:3px 0;color:var(--ink-2,#374151);">
        <strong>${esc(p.title)}</strong> — ${esc(p.stage)}
        ${p.flags && p.flags.length ? ` <span style="color:#9b1c1c;font-size:11px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;">${p.flags.map(esc).join(" · ")}</span>` : ""}
      </li>
    `).join("");

    const copy = row.copyPasteMessage
      ? `
        <div style="margin-top:10px;background:#0b0b0d;border-radius:10px;padding:12px 14px;">
          <div style="font-size:10px;font-weight:700;letter-spacing:0.22em;color:#a1a1a6;text-transform:uppercase;margin-bottom:6px;">Copy-paste message</div>
          <div style="color:#f2f2f5;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;line-height:1.6;white-space:pre-wrap;">${esc(row.copyPasteMessage)}</div>
        </div>`
      : "";

    return `
      <div style="border:1px solid var(--hairline,#e5e7eb);border-radius:10px;overflow:hidden;margin-top:10px;">
        <div style="padding:10px 14px;background:${headerBg};">
          <div style="font-weight:700;color:${headerInk};font-size:14px;">
            ${esc(row.writerName || "Unassigned")}
            ${exempt ? `<span style="font-size:10px;font-weight:700;letter-spacing:0.16em;color:#1d4ed8;text-transform:uppercase;margin-left:8px;">Reminders paused</span>` : ""}
            ${!exempt && flagged ? `<span style="font-size:10px;font-weight:700;letter-spacing:0.16em;color:#9b1c1c;text-transform:uppercase;margin-left:8px;">Needs attention</span>` : ""}
          </div>
          ${row.writerEmail ? `<div style="font-size:12px;color:var(--muted,#6b7280);margin-top:2px;font-family:ui-monospace,monospace;">${esc(row.writerEmail)}</div>` : ""}
          ${exempt ? `<div style="font-size:12px;color:#1d4ed8;margin-top:4px;line-height:1.5;">${esc(formatBotExemptionLabel(exempt))}${exempt.reason ? ` · ${esc(exempt.reason)}` : ""}</div>` : ""}
        </div>
        <div style="padding:10px 14px;">
          <ul style="margin:0;padding-left:18px;font-size:13px;line-height:1.55;">${projList}</ul>
          ${copy}
        </div>
      </div>
    `;
  }).join("");

  return `
    <div style="margin-top:14px;border:1px solid var(--hairline,#e5e7eb);border-radius:12px;overflow:hidden;">
      <div style="padding:10px 14px;background:#f8fafc;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted,#6b7280);display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;">
        <span>Admin digest preview — ${rows.length} writer${rows.length === 1 ? "" : "s"}, ${flaggedRows.length} flagged</span>
        ${d.recipients ? `<span style="text-transform:none;letter-spacing:0;font-weight:500;color:var(--muted,#6b7280);">Recipients: ${d.recipients.map(esc).join(", ")}</span>` : ""}
      </div>
      <div style="padding:10px 14px 14px 14px;">
        <div style="font-size:13px;color:var(--ink-2,#374151);margin-bottom:4px;"><strong>Subject:</strong> ${esc(d.subject || "")}</div>
        ${writerBlocks}
      </div>
    </div>
  `;
}

function kindLabel(kind) {
  if (kind === "deadline-overdue")     return { text: "Overdue",        bg: "#fde8e8", ink: "#9b1c1c" };
  if (kind === "deadline-1d")          return { text: "Due tomorrow",   bg: "#fff4e5", ink: "#92400e" };
  if (kind === "deadline-3d")          return { text: "Due in 3d",      bg: "#fff4e5", ink: "#92400e" };
  if (kind === "idle")                 return { text: "Idle nudge",     bg: "#eef2ff", ink: "#3730a3" };
  if (kind === "editor-idle")          return { text: "Editor idle",    bg: "#eef2ff", ink: "#3730a3" };
  if (kind === "editor-just-assigned") return { text: "Editor assigned",bg: "#ecfeff", ink: "#155e75" };
  if (kind === "interview-prep")       return { text: "Interview soon", bg: "#f5f3ff", ink: "#5b21b6" };
  if (kind === "interview-followup")   return { text: "Post-interview", bg: "#f5f3ff", ink: "#5b21b6" };
  if (kind === "post-approval-idle")   return { text: "Post-approval",  bg: "#eef2ff", ink: "#3730a3" };
  return { text: kind || "reminder", bg: "#f3f4f6", ink: "#374151" };
}

function fmtShort(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatBotExemptionLabel(exemption) {
  if (!exemption) return "";
  if (!exemption.untilDate) return "Reminders paused indefinitely";
  const d = new Date(`${exemption.untilDate}T12:00:00`);
  const when = isNaN(d.getTime())
    ? exemption.untilDate
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return `Reminders paused until ${when}`;
}

function wireBotResultHandlers(root, result) {
  const items = result?.writerReminders?.items || [];
  const loaded = new Set();

  root.querySelectorAll("[data-reminder-toggle]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      const idx = el.dataset.reminderToggle;
      const body = root.querySelector(`[data-reminder-body="${idx}"]`);
      if (!body) return;
      const willShow = body.style.display === "none";
      body.style.display = willShow ? "block" : "none";
      if (willShow && !loaded.has(idx)) {
        loaded.add(idx);
        const frame = body.querySelector(`[data-reminder-frame="${idx}"]`);
        const html = items[Number(idx)]?.html;
        if (frame && html) loadIntoFrame(frame, html);
      }
    });
  });
}

function loadIntoFrame(frame, html) {
  const doc = frame.contentDocument || frame.contentWindow?.document;
  if (!doc) return;
  doc.open();
  doc.write(html);
  doc.close();
  const resize = () => {
    try {
      const h = doc.documentElement.scrollHeight || doc.body?.scrollHeight || 600;
      frame.style.height = h + "px";
    } catch {}
  };
  if (doc.readyState === "complete") {
    resize();
  } else {
    frame.addEventListener("load", resize, { once: true });
  }
  setTimeout(resize, 50);
  setTimeout(resize, 300);
}

// ─── Bot email activity log ──────────────────────────────────────────────────
//
// Shows the last 50 days of bot-sent writer/editor emails. Rows turn red when
// the recipient hasn't moved their project since the email — i.e. they were
// nudged and ignored it. Admin digests are intentionally excluded (not
// actionable per-recipient).

function mountBotEmailLog(mount, ctx) {
  const render = (state, data, err) => {
    const headerHtml = `
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;">
        <div>
          <div class="card-title">Emails the bot has sent</div>
          <div class="card-subtitle">Open a row to see why it was sent and the full message. &ldquo;No change since&rdquo; means the story hasn&rsquo;t moved since that nudge.</div>
        </div>
        <button class="btn btn-ghost btn-sm" data-email-log-action="refresh">Refresh</button>
      </div>
      <div id="bot-email-log-body" style="margin-top:14px;"></div>
    `;
    mount.innerHTML = headerHtml;
    const body = mount.querySelector("#bot-email-log-body");

    if (state === "loading") {
      body.innerHTML = `<div class="hint" style="display:flex;align-items:center;gap:8px;"><div class="spinner"></div>Loading…</div>`;
    } else if (state === "error") {
      body.innerHTML = `<div class="error-state">${esc(err?.message || err || "Could not load email log.")}</div>`;
    } else if (state === "ready") {
      body.innerHTML = renderBotEmailLog(data);
      const entries = Array.isArray(data.entries) ? data.entries : [];
      const ignored = entries.filter((e) => e.ignored).length;
      const stat = document.getElementById("ov-bot-stat");
      if (stat) stat.textContent = entries.length ? `${entries.length} sent${ignored ? ` · ${ignored} unanswered` : ""}` : "";
      // Each row opens to show why it was sent and the full message.
      body.querySelectorAll("[data-email-log-toggle]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const panel = body.querySelector(`[data-email-log-detail="${CSS.escape(btn.getAttribute("data-email-log-toggle"))}"]`);
          if (!panel) return;
          panel.hidden = !panel.hidden;
          btn.setAttribute("aria-expanded", panel.hidden ? "false" : "true");
        });
      });
      const list = body.querySelector(".bl-list");
      body.querySelector(".bl-more")?.addEventListener("click", (ev) => { list.dataset.collapsed = "0"; ev.currentTarget.remove(); });
      body.querySelectorAll("[data-bl-filter]").forEach((b) => b.addEventListener("click", () => {
        body.querySelectorAll("[data-bl-filter]").forEach((x) => x.classList.toggle("is-on", x === b));
        list.dataset.filter = b.dataset.blFilter;
      }));
    }

    mount.querySelector("[data-email-log-action='refresh']")?.addEventListener("click", load);
  };

  const load = async () => {
    render("loading");
    try {
      const res = await ctx.authedFetch("/api/bot/email-log");
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
      render("ready", data);
    } catch (e) {
      render("error", null, e);
    }
  };

  load();
}

function renderBotEmailLog(data) {
  const entries = Array.isArray(data.entries) ? data.entries : [];
  if (!entries.length) {
    return `<div class="empty-state">The bot hasn&rsquo;t sent any emails yet.</div>`;
  }
  const ignoredCount = entries.filter((e) => e.ignored).length;

  const rows = entries.map((e, idx) => {
    const k = kindLabel(e.kind);
    const reason = e.reason || reasonFromLogEntry(e);
    const bodyText = e.bodyText || "";
    const facts = [
      e.daysUntilDeadline != null ? (e.daysUntilDeadline < 0 ? `${-e.daysUntilDeadline}d past deadline` : `${e.daysUntilDeadline}d to deadline`) : null,
      e.daysInactive != null ? `${e.daysInactive}d idle` : null,
      e.projectMissing ? "project deleted" : null,
      e.projectComplete ? "story finished" : null,
    ].filter(Boolean).join(" · ");
    return `
      <li class="bl-row${e.ignored ? " is-ignored" : ""}" data-ignored="${e.ignored ? "1" : "0"}">
        <button type="button" class="bl-head" aria-expanded="false" data-email-log-toggle="${idx}">
          <span class="bl-kind" style="--k-bg:${k.bg};--k-ink:${k.ink}">${esc(k.text)}</span>
          <span class="bl-who"><strong>${esc(e.recipientName || e.recipientEmail || "(unknown)")}</strong>${e.projectTitle ? ` <span class="bl-about">· ${esc(e.projectTitle)}</span>` : ""}</span>
          <span class="bl-facts">${esc(facts)}</span>
          ${e.ignored ? `<span class="bl-flag">No change in ${Math.floor(e.daysSinceSent)}d</span>` : `<span class="bl-flag bl-flag--quiet"></span>`}
          <span class="bl-date">${esc(fmtShort(e.sentAt))}</span>
        </button>
        <div class="bl-detail" data-email-log-detail="${idx}" hidden>
          ${e.subject ? `<p class="bl-subject"><span>Subject</span> ${esc(e.subject)}</p>` : ""}
          ${e.recipientEmail ? `<p class="bl-subject"><span>To</span> ${esc(e.recipientEmail)}</p>` : ""}
          ${reason ? `<p class="bl-why"><span>Why it was sent</span>${esc(reason)}</p>` : ""}
          ${bodyText ? `<pre class="bl-body">${esc(bodyText)}</pre>` : `<p class="bl-none">No message body on file (sent before messages were saved).</p>`}
        </div>
      </li>`;
  }).join("");

  return `
    <div class="bl-bar">
      <p class="bl-summary">${entries.length} email${entries.length === 1 ? "" : "s"} in the last 50 days${ignoredCount ? ` · <strong>${ignoredCount} with no change since</strong>` : ""}</p>
      <div class="bl-filter" role="group" aria-label="Show">
        <button type="button" class="is-on" data-bl-filter="all">All</button>
        <button type="button" data-bl-filter="ignored">No change since</button>
      </div>
    </div>
    <ul class="bl-list" data-collapsed="1">${rows}</ul>
    ${entries.length > 8 ? `<button type="button" class="btn btn-secondary btn-sm bl-more">Show all ${entries.length}</button>` : ""}`;
}

// Backfill a "why" string for old log rows that pre-date the `reason` field.
// Mirrors the server-side reasonForReminder() but works from the stored
// daysInactive / daysUntilDeadline signals.
function reasonFromLogEntry(e) {
  if (!e) return "";
  const k = e.kind;
  const dD = e.daysUntilDeadline;
  const dI = e.daysInactive;
  if (k === "deadline-overdue") {
    const past = dD != null ? Math.abs(dD) : null;
    return past != null
      ? `Deadline passed ${past} day${past === 1 ? "" : "s"} ago and the project hasn't been marked complete.`
      : `Deadline has passed and the project isn't marked complete.`;
  }
  if (k === "deadline-1d") return `Deadline is tomorrow — final reminder before it's due.`;
  if (k === "deadline-3d") return dD != null ? `Deadline is in ${dD} day${dD === 1 ? "" : "s"} — early heads-up.` : `Deadline is approaching.`;
  if (k === "idle") return dI != null ? `No project activity for ${dI} day${dI === 1 ? "" : "s"} — checking in.` : `Project has been idle — checking in.`;
  if (k === "editor-idle") return dI != null ? `Editor hasn't moved this draft in ${dI} day${dI === 1 ? "" : "s"}.` : `Editor hasn't moved this draft recently.`;
  if (k === "editor-just-assigned") return `Editor was recently assigned — gentle nudge to start reviewing.`;
  if (k === "interview-prep") return `Interview is coming up — sending prep tips.`;
  if (k === "interview-followup") return `Interview already happened but "Interview Complete" hasn't been checked off.`;
  if (k === "post-approval-idle") return `Proposal was approved a while ago and the writer hasn't moved it.`;
  if (k === "proposal-no-schedule") return `Proposal was approved but no interview date is on file yet.`;
  return "";
}
