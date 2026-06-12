// Editorial schedule calendar — shown on the Overview tab for every staff
// member (admin, editor, writer, marketing, newsletter builder).
//
// What it shows:
//   • SCHEDULED PUBLICATION — the date a story is slated to publish
//     (project.deadlines.publication || project.deadline). The chip carries
//     the story's live status: green when published / finished & waiting,
//     red when falling behind. Media plans backwards from this date.
//   • INTERVIEW   — scheduled interview dates
//   • MY DEADLINE — the viewer's own next deadline on their projects
//   • TASKS       — personal & shared calendar tasks. Anyone can add a task
//     on any day, pick its color, invite teammates (it appears on every
//     participant's calendar), and set a reminder — the Catalyst bot emails
//     every participant on the reminder day and again on the task day.
//
// "Falling behind" logic still keys off ready-by (publish − 7 days): every
// article must be finished a week before publish so social can prep posts.
//
// Data: live onSnapshot on `projects` + `calendar_tasks` (workflow Firestore).

import { db as workflowDb } from "../firebase-dual-config.js";
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { el, esc, openModal, toast, confirmDialog } from "./ui.js";

const STAFF_ROLES = ["admin", "editor", "writer", "marketing", "newsletter_builder"];
const READY_LEAD_DAYS = 7; // articles must be done this many days before publish

const ONE_DAY = 86400000;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Personal deadline fields, in workflow order.
const MY_DEADLINE_FIELDS = [
  { key: "contact",   label: "Contact professor" },
  { key: "interview", label: "Conduct interview" },
  { key: "draft",     label: "Write draft" },
  { key: "review",    label: "Editor review" },
  { key: "edits",     label: "Review edits" },
];

const KIND_META = {
  publish:   { label: "Scheduled publication", color: "#0f766e", bg: "#ccfbf1", dot: "#0f766e" },
  interview: { label: "Interview",             color: "#1d4ed8", bg: "#dbeafe", dot: "#3b82f6" },
  mine:      { label: "My deadline",           color: "#5b21b6", bg: "#ede9fe", dot: "#7c3aed" },
  task:      { label: "Task",                  color: "#5b21b6", bg: "#ede9fe", dot: "#7c3aed" },
};

// Task color palette — the creator picks one; it renders the same on every
// participant's calendar so a shared task is instantly recognizable.
const TASK_COLORS = [
  { id: "purple", name: "Purple", dot: "#7c3aed", bg: "#ede9fe", ink: "#5b21b6" },
  { id: "blue",   name: "Blue",   dot: "#2563eb", bg: "#dbeafe", ink: "#1d4ed8" },
  { id: "teal",   name: "Teal",   dot: "#0d9488", bg: "#ccfbf1", ink: "#0f766e" },
  { id: "amber",  name: "Amber",  dot: "#d97706", bg: "#fef3c7", ink: "#92400e" },
  { id: "pink",   name: "Pink",   dot: "#db2777", bg: "#fce7f3", ink: "#9d174d" },
  { id: "slate",  name: "Slate",  dot: "#475569", bg: "#e2e8f0", ink: "#334155" },
];
const DEFAULT_TASK_COLOR = "purple";

function taskColor(id) {
  return TASK_COLORS.find((c) => c.id === id) || TASK_COLORS[0];
}

const REMINDER_OPTIONS = [
  { value: "",  label: "No early reminder (email on the day only)" },
  { value: "1", label: "1 day before" },
  { value: "2", label: "2 days before" },
  { value: "3", label: "3 days before" },
  { value: "7", label: "1 week before" },
];

// ─── Module state ─────────────────────────────────────────────────────────────

let _unsubs = [];   // live snapshot unsubscribes — replaced on each mount
let _ctx = null;    // { uid, name, email, role }
let _staffCache = null; // staff users for the share picker

export function isStaff(role) {
  return STAFF_ROLES.includes(role);
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

function parseISO(s) {
  if (!s || typeof s !== "string") return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return isNaN(d.getTime()) ? null : d;
}

function toISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDays(d, n) {
  const x = new Date(d.getTime());
  x.setDate(x.getDate() + n);
  return x;
}

function todayStart() {
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  return t;
}

function daysFromToday(iso) {
  const d = parseISO(iso);
  if (!d) return null;
  return Math.round((d.getTime() - todayStart().getTime()) / ONE_DAY);
}

function fmtNice(iso) {
  const d = parseISO(iso);
  if (!d) return iso || "—";
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function fmtMonthTitle(d) {
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

// ─── Project helpers ──────────────────────────────────────────────────────────

function pubDate(p)       { return p.deadlines?.publication || p.deadline || null; }
function readyDate(p)     { const d = parseISO(pubDate(p)); return d ? toISO(addDays(d, -READY_LEAD_DAYS)) : null; }
function interviewDate(p) { return p.deadlines?.interview || p.interviewDate || null; }
function isComplete(p)    { return !!p.timeline?.["Suggestions Reviewed"]; }
function isMine(p, uid)   { return p.authorId === uid || p.editorId === uid; }

function progressPct(p) {
  const tl = p.timeline;
  if (!tl) return 0;
  const vals = Object.values(tl);
  if (!vals.length) return 0;
  return Math.round((vals.filter(Boolean).length / vals.length) * 100);
}

// Readiness for the social team: is this article done early enough?
//   published — finished AND its publish date has arrived/passed
//   done      — finished, awaiting its publish date (media can start working)
//   behind    — internal ready-by date passed, still not finished → FALLING BEHIND
//   at-risk   — internal ready-by within 3 days, still not finished
//   on-track  — everything else
function readiness(p) {
  if (isComplete(p)) {
    const pub = pubDate(p);
    const d = pub ? daysFromToday(pub) : null;
    return d !== null && d <= 0 ? "published" : "done";
  }
  const r = readyDate(p);
  if (!r) return "on-track";
  const d = daysFromToday(r);
  if (d === null) return "on-track";
  if (d < 0) return "behind";
  if (d <= 3) return "at-risk";
  return "on-track";
}

const READINESS_META = {
  "published": { label: "Published ✓",            color: "#15803d", bg: "#dcfce7" },
  "done":      { label: "Ready — media can start", color: "#15803d", bg: "#dcfce7" },
  "on-track":  { label: "On track",                color: "#0f766e", bg: "#ccfbf1" },
  "at-risk":   { label: "At risk",                 color: "#92400e", bg: "#fef3c7" },
  "behind":    { label: "Falling behind",          color: "#b91c1c", bg: "#fee2e2" },
};

// Human stage label, simplified from the pipeline state machine.
function stageLabel(p) {
  const tl = p.timeline || {};
  if (tl["Suggestions Reviewed"]) return "Completed";
  if (p.proposalStatus !== "approved") return `Proposal ${p.proposalStatus || "pending"}`;
  if (p.type === "Interview" && !tl["Interview Complete"])
    return tl["Interview Scheduled"] ? "Interview scheduled" : "Schedule interview";
  if (!tl["Article Writing Complete"]) return "Writing";
  if (!tl["Review Complete"]) return "In review";
  return "Reviewing feedback";
}

// The viewer's single next actionable deadline on a project.
function nextMyDeadline(p) {
  const today = toISO(todayStart());
  const dl = p.deadlines || {};
  const upcoming = [];
  const past = [];
  for (const f of MY_DEADLINE_FIELDS) {
    const v = dl[f.key];
    if (!v || !parseISO(v)) continue;
    (v >= today ? upcoming : past).push({ ...f, date: v });
  }
  if (upcoming.length) return upcoming.sort((a, b) => a.date.localeCompare(b.date))[0];
  if (past.length) return past.sort((a, b) => b.date.localeCompare(a.date))[0];
  return null;
}

// Nudge copy for the personal strip.
function nudgeFor(p) {
  const pub = pubDate(p);
  const ready = readyDate(p);
  const r = readiness(p);
  if (r === "published") return { tone: "good", text: "Published — great work." };
  if (r === "done") return { tone: "good", text: "Finished — the social team can start working with it. Nice." };
  if (r === "behind") {
    const late = Math.abs(daysFromToday(ready));
    return { tone: "danger", text: `Falling behind: should have been finished ${late}d ago (publishes ${fmtNice(pub)}). If you've made progress, update your tracker — otherwise push the draft over the line now so social can prep posts.` };
  }
  if (r === "at-risk") {
    const left = daysFromToday(ready);
    return { tone: "warn", text: `${left === 0 ? "Your finish-by date is today" : `Only ${left}d to have this finished`} — articles must be done a week before publishing. Push to finish.` };
  }
  const next = nextMyDeadline(p);
  if (next) {
    const d = daysFromToday(next.date);
    if (d !== null && d < 0) return { tone: "danger", text: `"${next.label}" was due ${Math.abs(d)}d ago — wrap it up.` };
    if (d !== null && d <= 3) return { tone: "warn", text: `"${next.label}" due ${d === 0 ? "today" : `in ${d}d`}.` };
  }
  if (pub) return { tone: "ok", text: `On track. Publishes ${fmtNice(pub)} — have it fully finished a week before so social can prep.` };
  return { tone: "ok", text: "On track. No publish date set yet — propose one so it lands on the calendar." };
}

// ─── Event extraction ─────────────────────────────────────────────────────────

// Build { "YYYY-MM-DD": [event, …] } for everything visible to this viewer.
function buildEvents(projects, tasks, uid, filterMine) {
  const map = new Map();
  const push = (iso, ev) => {
    if (!iso || !parseISO(iso)) return;
    if (!map.has(iso)) map.set(iso, []);
    map.get(iso).push(ev);
  };

  for (const p of projects) {
    if (p.proposalStatus === "rejected") continue;
    const mine = isMine(p, uid);
    if (filterMine && !mine) continue;
    const done = isComplete(p);
    const base = { project: p, mine, done, readiness: readiness(p) };

    const pub = pubDate(p);
    if (pub) push(pub, { ...base, kind: "publish" });
    const iv = interviewDate(p);
    if (iv && !p.timeline?.["Interview Complete"]) push(iv, { ...base, kind: "interview" });

    if (mine && !done) {
      const next = nextMyDeadline(p);
      if (next) push(next.date, { ...base, kind: "mine", deadlineLabel: next.label });
    }
  }

  // Calendar tasks — visible only to participants, on every participant's
  // calendar. (The "Just mine" filter is irrelevant: tasks are always yours.)
  for (const t of tasks) {
    if (!Array.isArray(t.participantIds) || !t.participantIds.includes(uid)) continue;
    push(t.date, { kind: "task", task: t, mine: true, done: t.status === "done" });
  }

  const order = { publish: 0, interview: 1, task: 2, mine: 3 };
  for (const list of map.values()) {
    list.sort((a, b) => (order[a.kind] - order[b.kind]) || ((b.mine ? 1 : 0) - (a.mine ? 1 : 0)));
  }
  return map;
}

// ─── Styles ───────────────────────────────────────────────────────────────────

function ensureStyles() {
  if (document.getElementById("sched-cal-styles")) return;
  const s = document.createElement("style");
  s.id = "sched-cal-styles";
  s.textContent = `
    .sc-wrap { font-family: var(--font, 'Inter', sans-serif); }
    .sc-toolbar { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; margin-bottom:14px; }
    .sc-toolbar-left { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
    .sc-toolbar-right { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
    .sc-month { font-size:18px; font-weight:800; color:var(--ink,#0b1220); letter-spacing:-0.01em;
      min-width:158px; font-variant-numeric:tabular-nums; }
    .sc-nav { display:flex; gap:6px; align-items:center; }
    .sc-nav-btn { min-width:44px; min-height:44px; border:1px solid var(--hairline,#e5e7eb); background:var(--surface,#fff);
      border-radius:10px; cursor:pointer; font-size:15px; color:var(--ink-2,#1f2937); display:flex; align-items:center; justify-content:center;
      font-family:inherit; transition:background .12s, border-color .12s; }
    .sc-nav-btn:hover { background:var(--surface-2,#f8fafc); border-color:#cbd5e1; }
    .sc-nav-btn:focus-visible { outline:2px solid var(--accent,#0f766e); outline-offset:2px; }
    .sc-add-btn { min-height:44px; padding:0 16px; border:0; border-radius:10px; background:var(--accent,#0f766e); color:#fff;
      font-size:13px; font-weight:700; font-family:inherit; cursor:pointer; display:inline-flex; align-items:center; gap:7px;
      transition:background .12s; }
    .sc-add-btn:hover { background:#0d6962; }
    .sc-add-btn:focus-visible { outline:2px solid var(--accent,#0f766e); outline-offset:2px; }
    .sc-filter { display:flex; border:1px solid var(--hairline,#e5e7eb); border-radius:10px; overflow:hidden; background:var(--surface,#fff); }
    .sc-filter button { min-height:44px; padding:0 16px; border:0; background:transparent; font-size:13px; font-weight:600;
      color:var(--muted,#64748b); cursor:pointer; font-family:inherit; transition:background .12s, color .12s; }
    .sc-filter button.active { background:var(--accent,#0f766e); color:#fff; }
    .sc-filter button:focus-visible { outline:2px solid var(--accent,#0f766e); outline-offset:-2px; }

    .sc-legend { display:flex; gap:14px; flex-wrap:wrap; margin-bottom:12px; font-size:12px; color:var(--muted,#64748b); }
    .sc-legend span { display:inline-flex; align-items:center; gap:6px; white-space:nowrap; }
    .sc-legend i { width:9px; height:9px; border-radius:50%; display:inline-block; flex-shrink:0; }

    /* minmax(0,1fr) + min-width:0 are load-bearing: without them the no-wrap
       chips force columns to uneven widths and the grid overflows the card. */
    .sc-grid-head { display:grid; grid-template-columns:repeat(7,minmax(0,1fr)); gap:6px; margin-bottom:6px; }
    .sc-grid-head div { font-size:11px; font-weight:700; letter-spacing:.08em; text-transform:uppercase;
      color:var(--muted-2,#94a3b8); text-align:center; padding:4px 0; min-width:0; }
    .sc-grid { display:grid; grid-template-columns:repeat(7,minmax(0,1fr)); gap:6px; }
    .sc-day { background:var(--surface,#fff); border:1px solid var(--hairline-2,#eef2f7); border-radius:10px;
      min-height:96px; min-width:0; padding:6px; display:flex; flex-direction:column; gap:3px; cursor:pointer;
      overflow:hidden; position:relative; transition:border-color .12s, box-shadow .12s; }
    .sc-day:hover { border-color:#cbd5e1; box-shadow:var(--shadow-md,0 6px 16px -4px rgba(15,23,42,.08)); }
    .sc-day:hover .sc-day-add { opacity:1; }
    .sc-day:focus-visible { outline:2px solid var(--accent,#0f766e); outline-offset:2px; }
    .sc-day.other { background:var(--surface-2,#f8fafc); }
    .sc-day.other .sc-num, .sc-day.other .sc-chip { opacity:.45; }
    .sc-day.weekend:not(.other) { background:#fcfdfd; }
    .sc-day.today { border-color:var(--accent,#0f766e); box-shadow:0 0 0 1px var(--accent,#0f766e) inset; }
    .sc-day-num { display:flex; justify-content:space-between; align-items:center; flex-shrink:0; }
    .sc-num { font-size:12px; font-weight:700; color:var(--ink-2,#1f2937); font-variant-numeric:tabular-nums;
      line-height:1; padding:3px 0; }
    .sc-day.today .sc-num { background:var(--accent,#0f766e); color:#fff; border-radius:999px; padding:3px 8px; }
    .sc-day-add { position:absolute; bottom:4px; right:4px; opacity:0; font-size:14px; font-weight:700; line-height:1;
      color:var(--accent,#0f766e); background:var(--accent-soft,#ccfbf1); border-radius:6px; padding:2px 6px;
      transition:opacity .12s; pointer-events:none; }
    .sc-chip { display:flex; align-items:center; gap:5px; min-width:0; font-size:10.5px; font-weight:600; line-height:1.25;
      padding:3px 6px; border-radius:6px; }
    .sc-chip > b { flex-shrink:0; width:6px; height:6px; border-radius:50%; }
    .sc-chip > span { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:600; }
    .sc-chip.mine { box-shadow:0 0 0 1.5px currentColor inset; }
    .sc-chip.done { opacity:.55; }
    .sc-chip.done > span { text-decoration:line-through; }
    .sc-more { font-size:10px; font-weight:700; color:var(--muted,#64748b); padding:0 4px; flex-shrink:0; }

    .sc-alert { display:flex; align-items:flex-start; gap:11px; background:#fee2e2; border:1.5px solid #f87171;
      color:#991b1b; border-radius:12px; padding:13px 15px; margin-bottom:12px;
      animation: sc-pulse 1.8s ease-in-out infinite; }
    .sc-alert-icon { flex-shrink:0; width:34px; height:34px; border-radius:9px; background:#dc2626; color:#fff;
      display:flex; align-items:center; justify-content:center; font-size:17px; font-weight:800;
      animation: sc-blink 1.8s ease-in-out infinite; }
    .sc-alert-title { font-size:13px; font-weight:800; letter-spacing:.04em; text-transform:uppercase; }
    .sc-alert-text { font-size:12.5px; line-height:1.5; margin-top:3px; font-weight:500; color:#7f1d1d; }
    @keyframes sc-pulse {
      0%, 100% { box-shadow:0 0 0 0 rgba(220,38,38,.40); }
      50%      { box-shadow:0 0 0 9px rgba(220,38,38,0); }
    }
    @keyframes sc-blink { 0%, 100% { opacity:1; } 50% { opacity:.55; } }
    @media (prefers-reduced-motion: reduce) { .sc-alert, .sc-alert-icon { animation:none; } }

    .sc-strip { margin-bottom:16px; }
    .sc-strip-title { font-size:11px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; color:var(--muted,#64748b); margin-bottom:8px; }
    .sc-cards { display:grid; grid-template-columns:repeat(auto-fill,minmax(250px,1fr)); gap:10px; }
    .sc-pcard { border:1px solid var(--hairline,#e5e7eb); border-radius:10px; padding:11px 13px; background:var(--surface,#fff); }
    .sc-pcard.behind { border-color:#f87171; background:#fff7f7; }
    .sc-pcard-title { font-size:13px; font-weight:700; color:var(--ink,#0b1220); margin-bottom:3px;
      white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .sc-pcard-meta { font-size:11.5px; color:var(--muted,#64748b); margin-bottom:7px; }
    .sc-bar { height:4px; background:var(--hairline,#e5e7eb); border-radius:99px; overflow:hidden; margin-bottom:7px; }
    .sc-bar-fill { height:100%; border-radius:99px; background:linear-gradient(90deg,#14b8a6,#0f766e); }
    .sc-nudge { font-size:11.5px; line-height:1.45; border-radius:7px; padding:6px 8px; }
    .sc-nudge.ok     { background:var(--surface-2,#f8fafc); color:var(--ink-2,#374151); }
    .sc-nudge.good   { background:#dcfce7; color:#15803d; }
    .sc-nudge.warn   { background:#fef3c7; color:#92400e; }
    .sc-nudge.danger { background:#fee2e2; color:#b91c1c; }
    .sc-badge { display:inline-block; font-size:10px; font-weight:700; letter-spacing:.05em; text-transform:uppercase;
      padding:2px 8px; border-radius:999px; }

    .sc-runway { margin-top:14px; border-top:1px solid var(--hairline-2,#eef2f7); padding-top:12px; }
    .sc-runway-row { display:flex; align-items:center; justify-content:space-between; gap:10px; padding:7px 0; flex-wrap:wrap;
      border-bottom:1px dashed var(--hairline-2,#eef2f7); }
    .sc-runway-row:last-child { border-bottom:0; }
    .sc-runway-main { min-width:0; flex:1; }
    .sc-runway-title { font-size:13px; font-weight:600; color:var(--ink,#0b1220); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .sc-runway-meta { font-size:11.5px; color:var(--muted,#64748b); margin-top:1px; }

    .sc-empty { font-size:13px; color:var(--muted,#64748b); padding:18px; text-align:center; }

    /* Task form */
    .sc-form label { display:block; font-size:12px; font-weight:600; color:var(--muted,#64748b); margin:12px 0 5px; }
    .sc-form label:first-child { margin-top:0; }
    .sc-form input[type=text], .sc-form input[type=date], .sc-form textarea, .sc-form select {
      width:100%; padding:10px 12px; border:1px solid var(--hairline,#e5e7eb); border-radius:8px;
      font-size:14px; font-family:inherit; color:var(--ink,#0b1220); background:var(--surface,#fff); outline:none; }
    .sc-form input:focus-visible, .sc-form textarea:focus-visible, .sc-form select:focus-visible {
      border-color:var(--accent,#0f766e); box-shadow:0 0 0 2px var(--accent-soft,#ccfbf1); }
    .sc-form textarea { resize:vertical; min-height:64px; }
    .sc-swatches { display:flex; gap:8px; flex-wrap:wrap; }
    .sc-swatch { width:34px; height:34px; border-radius:9px; border:2px solid transparent; cursor:pointer; padding:0;
      display:flex; align-items:center; justify-content:center; }
    .sc-swatch.selected { border-color:var(--ink,#0b1220); }
    .sc-swatch:focus-visible { outline:2px solid var(--accent,#0f766e); outline-offset:2px; }
    .sc-swatch svg { display:none; }
    .sc-swatch.selected svg { display:block; }
    .sc-people { max-height:180px; overflow:auto; border:1px solid var(--hairline,#e5e7eb); border-radius:8px; }
    .sc-person { display:flex; align-items:center; gap:10px; padding:9px 12px; cursor:pointer; font-size:13px;
      color:var(--ink-2,#1f2937); border-bottom:1px solid var(--hairline-2,#eef2f7); user-select:none; }
    .sc-person:last-child { border-bottom:0; }
    .sc-person:hover { background:var(--surface-2,#f8fafc); }
    .sc-person input { width:16px; height:16px; accent-color:var(--accent,#0f766e); flex-shrink:0; }
    .sc-person small { color:var(--muted,#64748b); }
    .sc-form-err { display:none; color:#b91c1c; font-size:12px; margin-top:10px; }
    .sc-hint { font-size:11.5px; color:var(--muted,#64748b); margin-top:5px; line-height:1.45; }

    @media (max-width: 720px) {
      .sc-day { min-height:64px; }
      .sc-chip { display:none; }
      .sc-day .sc-dots { display:flex; gap:3px; flex-wrap:wrap; }
      .sc-day .sc-dots i { width:7px; height:7px; border-radius:50%; }
    }
    @media (min-width: 721px) { .sc-dots { display:none; } }
    @media (prefers-reduced-motion: reduce) {
      .sc-nav-btn, .sc-filter button, .sc-day, .sc-add-btn { transition:none; }
    }
  `;
  document.head.appendChild(s);
}

// ─── Main render ──────────────────────────────────────────────────────────────

export function renderScheduleCalendar(container, ctx) {
  if (!isStaff(ctx.role)) return;
  ensureStyles();

  // Replace any prior live subscriptions (overview can be remounted).
  for (const u of _unsubs) { try { u(); } catch {} }
  _unsubs = [];

  _ctx = {
    uid: ctx.user?.uid,
    name: ctx.profile?.name || ctx.profile?.email || "",
    email: ctx.profile?.email || ctx.user?.email || "",
    role: ctx.role,
    authedFetch: ctx.authedFetch,
  };

  const isSocialRole = ctx.role === "marketing" || ctx.role === "newsletter_builder";

  const state = {
    projects: [],
    tasks: [],
    month: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
    filterMine: false,
    loaded: false,
    tasksAvailable: true,
    error: null,
  };

  const card = el("div", { class: "card", style: { marginTop: container.childElementCount ? "20px" : "0" } });
  card.innerHTML = `
    <div class="card-header">
      <div>
        <div class="card-title">Editorial calendar</div>
        <div class="card-subtitle">${isSocialRole
          ? "Scheduled publications, interviews, and your tasks — every article is finished a week early, so plan your posts off these dates."
          : "Scheduled publications, interviews, your deadlines — and tasks you can add, color, and share with teammates."}</div>
      </div>
    </div>
    <div class="card-body"><div class="sc-wrap" id="sc-root"><div class="loading-state"><div class="spinner"></div>Loading schedule…</div></div></div>`;
  container.appendChild(card);
  const root = card.querySelector("#sc-root");

  const render = () => {
    if (state.error) {
      root.innerHTML = `<div class="error-state">Could not load the schedule. ${esc(state.error)}</div>`;
      return;
    }
    if (!state.loaded) return;
    root.innerHTML = "";
    root.appendChild(renderPersonalStrip(state, _ctx.uid, isSocialRole));
    root.appendChild(renderToolbar(state, render));
    root.appendChild(renderLegend());
    root.appendChild(renderGrid(state, _ctx.uid, render));
    root.appendChild(renderRunway(state, _ctx.uid));
  };

  _unsubs.push(onSnapshot(collection(workflowDb, "projects"), (snap) => {
    state.projects = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    state.loaded = true;
    state.error = null;
    render();
  }, (err) => {
    state.error = err?.message || "Permission denied";
    state.loaded = true;
    render();
  }));

  _unsubs.push(onSnapshot(collection(workflowDb, "calendar_tasks"), (snap) => {
    state.tasks = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (state.loaded) render();
  }, (err) => {
    // Tasks are additive — if rules aren't deployed yet, the rest of the
    // calendar still works. Saving will surface its own error.
    console.warn("[calendar] tasks unavailable:", err?.message);
    state.tasksAvailable = false;
  }));
}

// ─── Toolbar / legend ─────────────────────────────────────────────────────────

function renderToolbar(state, rerender) {
  const bar = el("div", { class: "sc-toolbar" });
  const nav = (delta) => {
    state.month = new Date(state.month.getFullYear(), state.month.getMonth() + delta, 1);
    rerender();
  };
  const left = el("div", { class: "sc-toolbar-left" }, [
    el("div", { class: "sc-month" }, fmtMonthTitle(state.month)),
    el("div", { class: "sc-nav" }, [
      el("button", { class: "sc-nav-btn", "aria-label": "Previous month", onclick: () => nav(-1) }, "←"),
      el("button", { class: "sc-nav-btn", "aria-label": "Next month", onclick: () => nav(1) }, "→"),
      el("button", { class: "sc-nav-btn", style: { padding: "0 14px", fontSize: "13px", fontWeight: "600" },
        onclick: () => { state.month = new Date(new Date().getFullYear(), new Date().getMonth(), 1); rerender(); } }, "Today"),
    ]),
  ]);

  const addBtn = el("button", { class: "sc-add-btn", onclick: () => openTaskModal({ date: toISO(todayStart()), onSaved: rerender }) });
  addBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>Add task`;

  const filter = el("div", { class: "sc-filter", role: "group", "aria-label": "Filter calendar" });
  const mkBtn = (label, mine) => el("button", {
    class: state.filterMine === mine ? "active" : "",
    onclick: () => { state.filterMine = mine; rerender(); },
  }, label);
  filter.appendChild(mkBtn("Everyone", false));
  filter.appendChild(mkBtn("Just mine", true));

  bar.appendChild(left);
  bar.appendChild(el("div", { class: "sc-toolbar-right" }, [addBtn, filter]));
  return bar;
}

function renderLegend() {
  const lg = el("div", { class: "sc-legend" });
  lg.innerHTML = `
    <span><i style="background:${KIND_META.publish.dot}"></i>Scheduled publication</span>
    <span><i style="background:#15803d"></i>Published / ready</span>
    <span><i style="background:#b91c1c"></i>Falling behind</span>
    <span><i style="background:${KIND_META.interview.dot}"></i>Interview</span>
    <span><i style="background:${KIND_META.mine.dot}"></i>My deadline</span>
    <span><i style="background:${TASK_COLORS[1].dot}"></i>Tasks (your color)</span>`;
  return lg;
}

// ─── Calendar grid ────────────────────────────────────────────────────────────

function renderGrid(state, uid, rerender) {
  const events = buildEvents(state.projects, state.tasks, uid, state.filterMine);
  const wrap = el("div", {});

  const head = el("div", { class: "sc-grid-head" });
  WEEKDAYS.forEach((w) => head.appendChild(el("div", {}, w)));
  wrap.appendChild(head);

  const grid = el("div", { class: "sc-grid" });
  const first = state.month;
  const start = addDays(first, -first.getDay()); // back to Sunday
  const todayIso = toISO(todayStart());

  for (let i = 0; i < 42; i++) {
    const day = addDays(start, i);
    const iso = toISO(day);
    const inMonth = day.getMonth() === first.getMonth();
    const dayEvents = events.get(iso) || [];
    const isToday = iso === todayIso;
    const isWeekend = day.getDay() === 0 || day.getDay() === 6;

    // Every day is interactive: days with events open the day view (which
    // includes "Add task"); empty days jump straight to the task form.
    const open = () => dayEvents.length
      ? openDayModal(iso, dayEvents, rerender)
      : openTaskModal({ date: iso, onSaved: rerender });

    const cell = el("div", {
      class: `sc-day${inMonth ? "" : " other"}${isToday ? " today" : ""}${isWeekend ? " weekend" : ""}`,
      tabindex: "0",
      role: "button",
      "aria-label": `${fmtNice(iso)} — ${dayEvents.length ? `${dayEvents.length} item${dayEvents.length === 1 ? "" : "s"}` : "add a task"}`,
      onclick: open,
      onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } },
    });

    cell.appendChild(el("div", { class: "sc-day-num" }, [
      el("span", { class: "sc-num" }, String(day.getDate())),
      dayEvents.length > 3 ? el("span", { class: "sc-more" }, `+${dayEvents.length - 3} more`) : null,
    ].filter(Boolean)));

    dayEvents.slice(0, 3).forEach((ev) => cell.appendChild(renderChip(ev)));
    if (dayEvents.length) {
      const dots = el("div", { class: "sc-dots" });
      dayEvents.slice(0, 6).forEach((ev) => {
        dots.appendChild(el("i", { style: { background: chipMeta(ev).dot } }));
      });
      cell.appendChild(dots);
    }
    if (!dayEvents.length) cell.appendChild(el("span", { class: "sc-day-add", "aria-hidden": "true" }, "+"));
    grid.appendChild(cell);
  }
  wrap.appendChild(grid);

  if (!events.size) {
    wrap.appendChild(el("div", { class: "sc-empty" },
      state.filterMine
        ? "Nothing of yours on the calendar yet — set a publish date on your project, or click any day to add a task."
        : "Nothing scheduled yet. Publish dates from the tracker show up here automatically — or click any day to add a task."));
  }
  return wrap;
}

// Resolve a chip's colors from the event — tasks use their chosen palette
// color; publish chips carry the story's live status.
function chipMeta(ev) {
  if (ev.kind === "task") {
    const c = taskColor(ev.task.color);
    return { bg: c.bg, color: c.ink, dot: c.dot };
  }
  let m = KIND_META[ev.kind];
  if (ev.kind === "publish") {
    if (ev.readiness === "published" || ev.readiness === "done") return { bg: "#dcfce7", color: "#15803d", dot: "#15803d" };
    if (ev.readiness === "behind") return { bg: "#fee2e2", color: "#b91c1c", dot: "#b91c1c" };
  }
  return { bg: m.bg, color: m.color, dot: m.dot };
}

function renderChip(ev) {
  const m = chipMeta(ev);
  let text;
  if (ev.kind === "task") {
    const shared = (ev.task.participantIds?.length || 1) > 1;
    text = `${shared ? "👥 " : ""}${ev.task.title || "(task)"}`;
  } else if (ev.kind === "publish") {
    const prefix = ev.readiness === "published" ? "Published ✓ "
      : ev.readiness === "done" ? "Ready ✓ "
      : ev.readiness === "behind" ? "Behind: "
      : "Publishes: ";
    text = `${prefix}${ev.project.title || "(untitled)"}`;
  } else if (ev.kind === "interview") {
    text = `Interview: ${ev.project.title || "(untitled)"}`;
  } else {
    text = `${ev.deadlineLabel}: ${ev.project.title || "(untitled)"}`;
  }

  const chip = el("div", {
    class: `sc-chip${ev.mine && ev.kind !== "task" ? " mine" : ""}${ev.done && ev.kind !== "publish" ? " done" : ""}`,
    style: { background: m.bg, color: m.color },
    title: text,
  });
  chip.appendChild(el("b", { style: { background: m.dot } }));
  chip.appendChild(el("span", {}, text));
  return chip;
}

// ─── Day detail modal ─────────────────────────────────────────────────────────

function openDayModal(iso, events, rerender) {
  const body = el("div", {});

  for (const ev of events) {
    if (ev.kind === "task") body.appendChild(renderTaskDetail(ev.task, iso, rerender));
    else body.appendChild(renderProjectDetail(ev));
  }

  const addBtn = el("button", { class: "btn btn-accent" }, "+ Add task on this day");
  const closeBtn = el("button", { class: "btn btn-secondary" }, "Close");
  const m = openModal({ title: fmtNice(iso), body, footer: [closeBtn, addBtn] });
  closeBtn.onclick = () => m.close();
  addBtn.onclick = () => { m.close(); openTaskModal({ date: iso, onSaved: rerender }); };
}

function renderProjectDetail(ev) {
  const m = KIND_META[ev.kind];
  const p = ev.project;
  const r = READINESS_META[ev.readiness];
  const pub = pubDate(p);
  const box = el("div", { style: { border: "1px solid var(--hairline,#e5e7eb)", borderRadius: "10px", padding: "12px 14px", marginBottom: "10px" } });
  box.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px;">
      <span class="sc-badge" style="background:${m.bg};color:${m.color};">${esc(m.label)}${ev.kind === "mine" && ev.deadlineLabel ? ` · ${esc(ev.deadlineLabel)}` : ""}</span>
      <span class="sc-badge" style="background:${r.bg};color:${r.color};">${esc(r.label)}</span>
      ${ev.mine ? `<span class="sc-badge" style="background:#ede9fe;color:#5b21b6;">Yours</span>` : ""}
    </div>
    <div style="font-weight:700;font-size:14px;color:var(--ink,#0b1220);">${esc(p.title || "(untitled)")}</div>
    <div style="font-size:12.5px;color:var(--muted,#64748b);margin-top:3px;line-height:1.5;">
      ${esc(p.authorName || "Unassigned")}${p.editorName ? ` · editor: ${esc(p.editorName)}` : ""} · ${esc(stageLabel(p))} · ${progressPct(p)}% done
      ${pub ? `<br>Scheduled publication: <strong>${esc(fmtNice(pub))}</strong> (finished a week before, so social can prep)` : ""}
    </div>
    <div class="sc-bar" style="margin-top:8px;"><div class="sc-bar-fill" style="width:${progressPct(p)}%"></div></div>`;
  return box;
}

function renderTaskDetail(task, iso, rerender) {
  const c = taskColor(task.color);
  const isCreator = task.createdById === _ctx.uid || _ctx.role === "admin";
  const done = task.status === "done";
  const people = (task.participants || []).map((p) => p.name || p.email).filter(Boolean);

  const box = el("div", { style: { border: `1px solid ${c.dot}33`, borderLeft: `4px solid ${c.dot}`, borderRadius: "10px", padding: "12px 14px", marginBottom: "10px", background: done ? "var(--surface-2,#f8fafc)" : "#fff" } });
  box.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px;">
      <span class="sc-badge" style="background:${c.bg};color:${c.ink};">${people.length > 1 ? "Shared task" : "Task"}</span>
      ${done ? `<span class="sc-badge" style="background:#dcfce7;color:#15803d;">Done ✓</span>` : ""}
      ${task.reminderDate ? `<span class="sc-badge" style="background:var(--surface-3,#f1f5f9);color:var(--muted,#64748b);">Reminder ${esc(fmtNice(task.reminderDate))}</span>` : ""}
    </div>
    <div style="font-weight:700;font-size:14px;color:var(--ink,#0b1220);${done ? "text-decoration:line-through;" : ""}">${esc(task.title || "(task)")}</div>
    ${task.notes ? `<div style="font-size:12.5px;color:var(--ink-2,#374151);margin-top:4px;line-height:1.5;white-space:pre-wrap;">${esc(task.notes)}</div>` : ""}
    <div style="font-size:12px;color:var(--muted,#64748b);margin-top:6px;line-height:1.5;">
      ${people.length > 1 ? `With: <strong>${people.map(esc).join(", ")}</strong> · ` : ""}created by ${esc(task.createdByName || "?")}
      · the bot emails ${people.length > 1 ? "everyone" : "you"} ${task.reminderDate ? `on ${esc(fmtNice(task.reminderDate))} and ` : ""}on the day.
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;">
      <button class="btn btn-secondary btn-sm" data-act="toggle">${done ? "Reopen" : "Mark done"}</button>
      ${isCreator ? `<button class="btn btn-ghost btn-sm" data-act="edit">Edit</button>
      <button class="btn btn-ghost btn-sm" data-act="delete" style="color:#b91c1c;">Delete</button>` : ""}
    </div>`;

  box.querySelector('[data-act="toggle"]')?.addEventListener("click", async () => {
    try {
      await updateDoc(doc(workflowDb, "calendar_tasks", task.id), {
        status: done ? "active" : "done",
        updatedAt: new Date().toISOString(),
      });
      toast(done ? "Task reopened." : "Task marked done.", "success");
      document.getElementById("modal-root").innerHTML = "";
    } catch (e) { toast(`Could not update task: ${e.message}`, "error"); }
  });
  box.querySelector('[data-act="edit"]')?.addEventListener("click", () => {
    document.getElementById("modal-root").innerHTML = "";
    openTaskModal({ date: task.date, existing: task, onSaved: rerender });
  });
  box.querySelector('[data-act="delete"]')?.addEventListener("click", async () => {
    const ok = await confirmDialog(`Delete "${task.title}" for everyone on it?`, { confirmText: "Delete", danger: true });
    if (!ok) return;
    try {
      await deleteDoc(doc(workflowDb, "calendar_tasks", task.id));
      toast("Task deleted.", "success");
    } catch (e) { toast(`Could not delete task: ${e.message}`, "error"); }
  });
  return box;
}

// ─── Task create/edit modal ───────────────────────────────────────────────────

async function loadStaffUsers() {
  if (_staffCache) return _staffCache;
  try {
    const snap = await getDocs(collection(workflowDb, "users"));
    const seen = new Set();
    _staffCache = snap.docs
      .map((d) => ({ uid: d.id, ...d.data() }))
      .filter((u) => STAFF_ROLES.includes(u.role) && (u.status || "active") !== "inactive")
      .filter((u) => {
        const key = String(u.email || u.name || u.uid).toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => (a.name || a.email || "").localeCompare(b.name || b.email || ""));
  } catch (e) {
    console.warn("[calendar] could not load staff for sharing:", e?.message);
    _staffCache = [];
  }
  return _staffCache;
}

function openTaskModal({ date, existing = null, onSaved } = {}) {
  const isEdit = !!existing;
  let color = existing?.color || DEFAULT_TASK_COLOR;
  const preselected = new Set((existing?.participantIds || []).filter((id) => id !== _ctx.uid));

  // Pre-compute the reminder lead from an existing task so editing round-trips.
  let leadValue = "";
  if (existing?.reminderDate && existing?.date) {
    const lead = Math.round((parseISO(existing.date) - parseISO(existing.reminderDate)) / ONE_DAY);
    if (REMINDER_OPTIONS.some((o) => o.value === String(lead))) leadValue = String(lead);
  }

  const body = el("div", { class: "sc-form" });
  body.innerHTML = `
    <label for="sct-title">Task</label>
    <input id="sct-title" type="text" maxlength="120" placeholder="e.g. Draft Instagram posts for the AI Expo story" value="${esc(existing?.title || "")}">
    <label for="sct-date">Day</label>
    <input id="sct-date" type="date" value="${esc(existing?.date || date || "")}">
    <label for="sct-notes">Notes <span style="font-weight:400;">(optional)</span></label>
    <textarea id="sct-notes" maxlength="600" placeholder="Anything your future self — or your teammates — should know.">${esc(existing?.notes || "")}</textarea>
    <label for="sct-reminder">Email reminder</label>
    <select id="sct-reminder">
      ${REMINDER_OPTIONS.map((o) => `<option value="${o.value}"${o.value === leadValue ? " selected" : ""}>${esc(o.label)}</option>`).join("")}
    </select>
    <div class="sc-hint">The Catalyst bot emails everyone on this task on the reminder day and again on the day itself.</div>
    <label>Color</label>
    <div class="sc-swatches" role="radiogroup" aria-label="Task color"></div>
    <label>Share with teammates <span style="font-weight:400;">(it shows on their calendar too)</span></label>
    <div class="sc-people"><div style="padding:10px 12px;font-size:12.5px;color:var(--muted,#64748b);">Loading team…</div></div>
    <div class="sc-form-err" id="sct-err"></div>`;

  // Color swatches
  const swatches = body.querySelector(".sc-swatches");
  const renderSwatches = () => {
    swatches.innerHTML = "";
    for (const c of TASK_COLORS) {
      const b = el("button", {
        type: "button",
        class: `sc-swatch${c.id === color ? " selected" : ""}`,
        style: { background: c.dot },
        role: "radio",
        "aria-checked": c.id === color ? "true" : "false",
        "aria-label": c.name,
        title: c.name,
        onclick: () => { color = c.id; renderSwatches(); },
      });
      b.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
      swatches.appendChild(b);
    }
  };
  renderSwatches();

  // People picker
  const peopleBox = body.querySelector(".sc-people");
  loadStaffUsers().then((staff) => {
    const others = staff.filter((u) => u.uid !== _ctx.uid);
    if (!others.length) {
      peopleBox.innerHTML = `<div style="padding:10px 12px;font-size:12.5px;color:var(--muted,#64748b);">No teammates found — this task will be just yours.</div>`;
      return;
    }
    peopleBox.innerHTML = "";
    for (const u of others) {
      const row = el("label", { class: "sc-person" });
      const cb = el("input", { type: "checkbox", "data-uid": u.uid });
      cb.checked = preselected.has(u.uid);
      cb.addEventListener("change", () => {
        if (cb.checked) preselected.add(u.uid); else preselected.delete(u.uid);
      });
      row.appendChild(cb);
      row.appendChild(el("span", {}, [
        `${u.name || u.email || "?"} `,
        el("small", {}, u.role === "admin" ? "· admin" : u.role === "editor" ? "· editor" : u.role === "marketing" ? "· marketing" : u.role === "newsletter_builder" ? "· newsletter" : "· writer"),
      ]));
      row.appendChild(el("span", { style: { marginLeft: "auto", fontSize: "11px", color: "var(--muted,#64748b)" } }, u.email || ""));
      peopleBox.appendChild(row);
    }
  });

  const cancelBtn = el("button", { class: "btn btn-secondary" }, "Cancel");
  const saveBtn = el("button", { class: "btn btn-accent" }, isEdit ? "Save changes" : "Add to calendar");
  const m = openModal({ title: isEdit ? "Edit task" : "New calendar task", body, footer: [cancelBtn, saveBtn] });
  cancelBtn.onclick = () => m.close();

  saveBtn.onclick = async () => {
    const err = body.querySelector("#sct-err");
    const title = body.querySelector("#sct-title").value.trim();
    const dateVal = body.querySelector("#sct-date").value;
    const notes = body.querySelector("#sct-notes").value.trim();
    const lead = body.querySelector("#sct-reminder").value;
    err.style.display = "none";

    if (!title) { err.textContent = "Give the task a name."; err.style.display = "block"; return; }
    if (!dateVal || !parseISO(dateVal)) { err.textContent = "Pick a day for the task."; err.style.display = "block"; return; }

    const reminderDate = lead ? toISO(addDays(parseISO(dateVal), -Number(lead))) : null;

    // Resolve participants: always the creator + everyone checked.
    const staff = await loadStaffUsers();
    const byUid = new Map(staff.map((u) => [u.uid, u]));
    const participants = [{ uid: _ctx.uid, name: _ctx.name, email: _ctx.email }];
    for (const uid of preselected) {
      const u = byUid.get(uid);
      if (u) participants.push({ uid: u.uid, name: u.name || "", email: u.email || "" });
    }

    const payload = {
      title,
      notes,
      date: dateVal,
      reminderDate,
      color,
      participants,
      participantIds: participants.map((p) => p.uid),
      status: existing?.status || "active",
      updatedAt: new Date().toISOString(),
    };

    saveBtn.disabled = true;
    saveBtn.textContent = "Saving…";
    try {
      let newId = null;
      if (isEdit) {
        await updateDoc(doc(workflowDb, "calendar_tasks", existing.id), payload);
      } else {
        const ref = await addDoc(collection(workflowDb, "calendar_tasks"), {
          ...payload,
          createdById: _ctx.uid,
          createdByName: _ctx.name,
          createdAt: new Date().toISOString(),
        });
        newId = ref.id;
      }
      m.close();
      toast(isEdit ? "Task updated." : participants.length > 1
        ? `Task added — it's now on ${participants.length} calendars.`
        : "Task added to your calendar.", "success");
      if (typeof onSaved === "function") onSaved();

      // Announce a brand-new task by email to everyone on it (creator
      // included) via Resend. Fire-and-forget: the task is already saved,
      // so an email hiccup should never look like a save failure.
      if (!isEdit) {
        notifyTaskScheduled({ taskId: newId, title, notes, date: dateVal, reminderDate, participants })
          .then((sent) => { if (sent) toast(`Scheduling email sent to ${sent} ${sent === 1 ? "person" : "people"}.`, "info"); })
          .catch((e2) => console.warn("[calendar] task announcement email failed:", e2?.message));
      }
    } catch (e) {
      saveBtn.disabled = false;
      saveBtn.textContent = isEdit ? "Save changes" : "Add to calendar";
      err.textContent = `Could not save: ${e.message}`;
      err.style.display = "block";
    }
  };
}

// POST the new task to /api/calendar/notify, which emails every participant
// (creator included) that the task was scheduled and for what day.
// Returns the number of emails sent.
async function notifyTaskScheduled({ taskId, title, notes, date, reminderDate, participants }) {
  if (typeof _ctx?.authedFetch !== "function") return 0;
  const res = await _ctx.authedFetch("/api/calendar/notify", {
    method: "POST",
    body: JSON.stringify({
      taskId,
      title,
      notes,
      date,
      reminderDate,
      createdByName: _ctx.name,
      createdByEmail: _ctx.email,
      participants: participants.map((p) => ({ name: p.name, email: p.email })),
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data.sent || 0;
}

// ─── Personal strip ───────────────────────────────────────────────────────────

function renderPersonalStrip(state, uid, isSocialRole) {
  const wrap = el("div", { class: "sc-strip" });
  const mine = state.projects
    .filter((p) => isMine(p, uid) && !isComplete(p) && p.proposalStatus !== "rejected")
    .sort((a, b) => (pubDate(a) || "9999").localeCompare(pubDate(b) || "9999"));

  if (!mine.length || isSocialRole) return wrap; // social roles get the runway instead

  // Flashing red alert when any of the viewer's stories is falling behind —
  // i.e. its finish-by date (publish − 1 week) has passed and it isn't done.
  const behind = mine.filter((p) => readiness(p) === "behind");
  if (behind.length) {
    const titles = behind.map((p) => `"${p.title || "(untitled)"}"`).join(", ");
    const alert = el("div", { class: "sc-alert", role: "alert" });
    alert.innerHTML = `
      <div class="sc-alert-icon" aria-hidden="true">!</div>
      <div>
        <div class="sc-alert-title">Falling behind — ${behind.length === 1 ? "1 story needs" : `${behind.length} stories need`} you</div>
        <div class="sc-alert-text">${esc(titles)} ${behind.length === 1 ? "is" : "are"} past the point where ${behind.length === 1 ? "it" : "they"} should be finished.
        Made progress? Update your tracker so the team knows. If not, this is the push: finish it today —
        every article must be done a week before publish so the social team can build posts around <em>your</em> work. You've got this.</div>
      </div>`;
    wrap.appendChild(alert);
  }

  wrap.appendChild(el("div", { class: "sc-strip-title" }, `Your deadlines (${mine.length})`));
  const cards = el("div", { class: "sc-cards" });
  mine.slice(0, 6).forEach((p) => {
    const pct = progressPct(p);
    const nudge = nudgeFor(p);
    const next = nextMyDeadline(p);
    const c = el("div", { class: `sc-pcard${readiness(p) === "behind" ? " behind" : ""}` });
    c.innerHTML = `
      <div class="sc-pcard-title" title="${esc(p.title || "")}">${esc(p.title || "(untitled)")}</div>
      <div class="sc-pcard-meta">${esc(stageLabel(p))} · ${pct}%${next ? ` · next: ${esc(next.label)} ${esc(fmtNice(next.date))}` : ""}</div>
      <div class="sc-bar"><div class="sc-bar-fill" style="width:${pct}%"></div></div>
      <div class="sc-nudge ${nudge.tone}">${esc(nudge.text)}</div>`;
    cards.appendChild(c);
  });
  wrap.appendChild(cards);
  return wrap;
}

// ─── Social runway ────────────────────────────────────────────────────────────
//
// "What's landing soon" — the next scheduled publications with their live
// status, plus everything finished and awaiting publish, so the social team
// knows exactly what to prep and when.

function renderRunway(state, uid) {
  const wrap = el("div", { class: "sc-runway" });
  const today = toISO(todayStart());
  const horizon = toISO(addDays(todayStart(), 30));

  const upcoming = state.projects
    .filter((p) => {
      if (p.proposalStatus === "rejected") return false;
      const pub = pubDate(p);
      if (pub && pub >= today && pub <= horizon) return true;
      return isComplete(p) && (!pub || pub > today);
    })
    .sort((a, b) => (pubDate(a) || "9999").localeCompare(pubDate(b) || "9999"));

  wrap.appendChild(el("div", { class: "sc-strip-title" }, "Social media runway — scheduled publications & ready to work on"));
  if (!upcoming.length) {
    wrap.appendChild(el("div", { class: "sc-empty", style: { padding: "10px", textAlign: "left" } },
      "Nothing scheduled to publish in the next 30 days and nothing finished awaiting publish. Set publication dates in the tracker so the social team can plan."));
    return wrap;
  }

  upcoming.slice(0, 8).forEach((p) => {
    const r = READINESS_META[readiness(p)];
    const pub = pubDate(p);
    const dPub = pub ? daysFromToday(pub) : null;
    const when = !pub
      ? "publish date not set yet"
      : `publishes ${fmtNice(pub)} (${dPub === 0 ? "today" : dPub < 0 ? `${Math.abs(dPub)}d ago` : `in ${dPub}d`})`;
    const row = el("div", { class: "sc-runway-row" });
    row.innerHTML = `
      <div class="sc-runway-main">
        <div class="sc-runway-title">${esc(p.title || "(untitled)")}${isMine(p, uid) ? ` <span class="sc-badge" style="background:#ede9fe;color:#5b21b6;">Yours</span>` : ""}</div>
        <div class="sc-runway-meta">${esc(p.authorName || "Unassigned")} · ${esc(when)} · ${progressPct(p)}% done</div>
      </div>
      <span class="sc-badge" style="background:${r.bg};color:${r.color};flex-shrink:0;">${esc(r.label)}</span>`;
    wrap.appendChild(row);
  });
  return wrap;
}
