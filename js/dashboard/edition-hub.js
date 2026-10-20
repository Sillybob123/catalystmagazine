// This edition (#/edition) — the planning hub for the edition in progress.
//
// One page for everyone working on it:
//   • Overview   the theme, a countdown to the next deadline, the key dates,
//                what each person needs to do ("For you"), where the edition
//                stands, and the editors' guidance for everyone
//   • Sections   the four sections, each with its editor, and every piece in
//                it; open a piece for its full proposal (with the editors'
//                notes beside the part they comment on), next steps,
//                interviews and its own questions & updates
//   • Questions & updates   everything people have asked or shared, across
//                the edition; ask a question, share an update, reply, mark
//                answered
//   • For social  the lineup with hooks, people and places to tag, visual
//                ideas and copy-ready lines for launch
//
// Data (Firestore, staff only — see firestore.rules "This edition"):
//   edition_hub/{EDITION}            sections + editors, dates, guidance
//   edition_hub/{EDITION}/pieces     one doc per piece (proposal, notes, status)
//   edition_hub/{EDITION}/messages   questions, updates, replies, announcements
// The hub and pieces were seeded from the proposals by
// scripts/seed-edition-hub.mjs (the data file is private, outside git).
// Posting a message also calls /api/edition/notify, which rings the bell for
// the piece's writers and section editor.
//
// Who can change what (mirrors the rules): admins anything; section editors
// any piece and the editors' to-dos; a piece's writers its progress,
// checklist, interviews, title/format and their own proposal.

import { db, auth } from "../firebase-config.js";
import {
  collection, doc, onSnapshot, query, orderBy, limit, addDoc, updateDoc, deleteDoc, getDocs,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { el, esc, toast, fmtRelative, openModal, confirmDialog, slugify, initials } from "./ui.js";

// The edition this page plans. Point it at the next edition's hub doc when
// that one is seeded.
const EDITION = "winter-2027";

const STAGES = [
  { id: "idea", label: "Idea", hint: "No proposal yet" },
  { id: "proposal", label: "Proposal in", hint: "The editors have commented" },
  { id: "reporting", label: "Reporting", hint: "Interviews and research" },
  { id: "drafting", label: "Drafting", hint: "Writing the first draft" },
  { id: "draft1", label: "First draft in", hint: "Uploaded to the Drive" },
  { id: "editing", label: "Editing", hint: "Back and forth with the editor" },
  { id: "final", label: "Final draft in", hint: "Submitted in the Suite" },
  { id: "ready", label: "Ready", hint: "Ready to publish" },
];
const STAGE_INDEX = Object.fromEntries(STAGES.map((s, i) => [s.id, i]));
const SPECIAL = { open: "Open slot", held: "Held" };

// Proposal template, in order. Groups become headed blocks.
const PROPOSAL = [
  { group: "The basics", fields: [["title", "Working title"], ["subtitle", "Subtitle"], ["format", "Proposed format"], ["delivery", "Earliest delivery date"]] },
  { group: "The idea", fields: [["takeaway", "Main takeaway"], ["theme", "How it connects to the theme"], ["pitch", "The pitch"], ["whyNow", "Why now?"], ["whyMatters", "Why does it matter?"], ["whatsNew", "What's new here?"]] },
  { group: "Audience and angle", fields: [["audience", "Primary reader"], ["assumed", "Assumed knowledge"], ["angle", "Angle"]] },
  { group: "Outline", lead: "outline", fields: [["opening", "Opening"], ["context", "Context"], ["core", "Core"], ["tensions", "Tensions"], ["resolution", "Resolution"], ["visuals", "Potential visuals"]] },
  { group: "Sources", fields: [["research", "Key research"], ["people", "People and interviews"]] },
  { group: "Questions for the editors", fields: [["feedback", "Feedback the writer asked for"]] },
];
const PROPOSAL_EDITABLE = PROPOSAL.flatMap((g) => g.fields).filter(([k]) => !["title", "subtitle", "format"].includes(k));

const KIND = {
  question: { label: "Question", verb: "Ask a question", ph: "What do you want to ask? Be specific: the piece, the part, what you've tried." },
  update: { label: "Update", verb: "Share an update", ph: "What's new? An interview done, a draft uploaded, a change of angle, something you're stuck on." },
  announcement: { label: "Announcement", verb: "Post an announcement", ph: "Something everyone working on the edition should know." },
};

// Kept between mounts, so coming back (or opening a piece from the bell)
// paints at once while the live listeners catch up.
const cache = { hub: null, pieces: null, messages: null, bios: null, staff: null };

const DAY = 86400000;
const parseDay = (s) => { const [y, m, d] = String(s || "").split("-").map(Number); return y ? new Date(y, m - 1, d) : null; };
const today = () => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); };
const daysUntil = (s) => { const d = parseDay(s); return d ? Math.round((d - today()) / DAY) : null; };
const fmtDay = (s, opts = { weekday: "short", month: "short", day: "numeric" }) => { const d = parseDay(s); return d ? d.toLocaleDateString("en-US", opts) : ""; };
const sameName = (a, b) => !!a && !!b && String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
const firstName = (n) => String(n || "").trim().split(/\s+/)[0] || "Someone";
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const endStop = (t) => (/[.?!]$/.test(String(t)) ? t : `${t}.`);
const inDays = (n) => (n === 0 ? "today" : n === 1 ? "tomorrow" : n === -1 ? "yesterday" : n > 0 ? `in ${n} days` : `${-n} days ago`);

// Escape, keep line breaks, and turn bare links into links.
function rich(text) {
  const safe = esc(text || "");
  const linked = safe.replace(/https?:\/\/[^\s<)]+[^\s<).,;:!?'"]/g, (u) => `<a href="${u}" target="_blank" rel="noopener">${u.replace(/^https?:\/\/(www\.)?/, "").slice(0, 60)}${u.length > 68 ? "…" : ""}</a>`);
  return linked.split(/\n+/).map((p) => `<p>${p}</p>`).join("");
}

const ICON = {
  back: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>`,
  arrow: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>`,
  q: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6"/><circle cx="12" cy="17" r=".6" fill="currentColor"/></svg>`,
  notes: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/></svg>`,
  note: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
  check: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>`,
  edit: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>`,
  drive: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`,
  copy: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
  search: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>`,
  plus: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>`,
};

export async function mount(ctx, container) {
  injectStyle();
  container.classList.add("eh-content");
  const params = new URLSearchParams((location.hash.split("?")[1]) || "");
  const view = {
    tab: ["overview", "sections", "talk", "social"].includes(params.get("tab")) ? params.get("tab") : "overview",
    piece: params.get("piece") || null,
    pieceTab: params.get("view") === "talk" ? "talk" : "proposal",
    q: "", filter: "all", talkFilter: "all", showNotes: true,
  };
  const me = { uid: ctx.user?.uid || "", name: ctx.profile?.name || ctx.user?.displayName || "" };
  const isAdmin = ctx.role === "admin";
  // Writes run on the signed-in account; while an admin previews a teammate
  // the page shows their view, but posting as them is refused.
  const canWrite = () => {
    if (auth.currentUser && auth.currentUser.uid === me.uid) return true;
    toast("You're previewing someone else, so posting and editing are off.", "info");
    return false;
  };

  let hub = cache.hub, pieces = cache.pieces || [], messages = cache.messages || [];
  let bios = cache.bios || new Map();
  const unsubs = [];

  container.innerHTML = "";
  const root = el("div", { class: "eh" });
  container.appendChild(root);

  // ── live data
  const hubRef = doc(db, "edition_hub", EDITION);
  unsubs.push(onSnapshot(hubRef, (s) => { hub = s.exists() ? { id: s.id, ...s.data() } : null; cache.hub = hub; render(); },
    (err) => fail(err)));
  unsubs.push(onSnapshot(collection(hubRef, "pieces"), (s) => {
    pieces = s.docs.map((d) => ({ id: d.id, ...d.data() }));
    cache.pieces = pieces; render();
  }, (err) => fail(err)));
  unsubs.push(onSnapshot(query(collection(hubRef, "messages"), orderBy("createdAt", "desc"), limit(500)), (s) => {
    messages = s.docs.map((d) => ({ id: d.id, ...d.data() }));
    cache.messages = messages; render();
  }, (err) => console.warn("[edition] messages", err?.message)));
  if (!cache.bios) {
    getDocs(collection(db, "team_bios")).then((s) => {
      bios = new Map(s.docs.map((d) => [d.id, d.data()])); cache.bios = bios; render();
    }).catch(() => {});
  }

  function fail(err) {
    console.warn("[edition]", err?.message || err);
    root.innerHTML = `<div class="eh-empty"><h2>This page couldn't load.</h2><p>${esc(/permission/i.test(String(err?.message)) ? "Your account doesn't have access to the edition plan. Ask an admin." : "Check your connection and reload.")}</p></div>`;
  }

  // ── who's who
  const section = (id) => (hub?.sections || []).find((s) => s.id === id) || null;
  const sectionIndex = (id) => (hub?.sections || []).findIndex((s) => s.id === id);
  const editorOf = (p) => section(p.section)?.editor || null;
  const isMine = (p) => (p.writerUids || []).includes(me.uid) || (p.writers || []).some((w) => sameName(w.name, me.name));
  const edits = (s) => !!s?.editor && ((s.editor.uids || []).includes(me.uid) || sameName(s.editor.name, me.name));
  const mySections = () => (hub?.sections || []).filter(edits);
  const isHubEditor = () => (hub?.editorUids || []).includes(me.uid) || mySections().length > 0;
  const canEdit = () => isAdmin || isHubEditor();
  const canProgress = (p) => canEdit() || isMine(p);
  const live = () => pieces.filter((p) => p.section !== "held");
  const realPieces = () => live().filter((p) => p.status !== "open");
  const sorted = (list) => [...list].sort((a, b) => (sectionIndex(a.section) - sectionIndex(b.section)) || ((a.order || 0) - (b.order || 0)));
  const openQs = (pred) => messages.filter((m) => m.kind === "question" && !m.resolved && pred(m));
  const threadOf = (pred) => messages.filter((m) => m.kind !== "reply" && pred(m));
  const repliesTo = (id) => messages.filter((m) => m.parentId === id).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));

  function roleLabelFor(uid, name) {
    const ed = (hub?.sections || []).find((s) => s.editor && ((s.editor.uids || []).includes(uid) || sameName(s.editor.name, name)));
    if (ed) return `Editor, ${ed.name}`;
    if (pieces.some((p) => (p.writerUids || []).includes(uid) || (p.writers || []).some((w) => sameName(w.name, name)))) return "Writer";
    return "";
  }

  // Hexagon portrait from the About page, or initials in a hexagon.
  function avatar(person, size = 34) {
    const slug = person?.slug || slugify(person?.name || "");
    const img = bios.get(slug)?.image;
    const s = `width:${size}px;height:${size}px`;
    if (img) return `<span class="eh-av" style="${s}"><img src="${esc(img)}" alt="" loading="lazy" decoding="async"></span>`;
    return `<span class="eh-av eh-av-init" style="${s};font-size:${Math.round(size * 0.34)}px" aria-hidden="true">${esc(initials(person?.name || "?"))}</span>`;
  }
  const names = (people) => (people || []).map((p) => p.name).join(" & ");

  function statusPill(p) {
    if (SPECIAL[p.status]) return `<span class="eh-pill is-${p.status}">${SPECIAL[p.status]}</span>`;
    const st = STAGES[STAGE_INDEX[p.status] ?? 0];
    return `<span class="eh-pill is-stage" data-stage="${esc(p.status)}">${esc(st.label)}</span>`;
  }
  // Behind schedule? Compared with the edition's two hard deadlines.
  function flag(p) {
    if (SPECIAL[p.status]) return null;
    const i = STAGE_INDEX[p.status] ?? 0;
    const due = (hub?.dates || []).filter((d) => d.hard);
    const first = due.find((d) => d.id === "first-draft"), fin = due.find((d) => d.id === "final-draft");
    if (fin && i < STAGE_INDEX.final) { const n = daysUntil(fin.date); if (n < 0) return { tone: "danger", text: "Final draft overdue" }; if (n <= 5) return { tone: "warn", text: `Final draft due ${inDays(n)}` }; }
    if (first && i < STAGE_INDEX.draft1) { const n = daysUntil(first.date); if (n < 0) return { tone: "danger", text: "First draft overdue" }; if (n <= 7) return { tone: "warn", text: `First draft due ${inDays(n)}` }; }
    if (p.status === "idea") return { tone: "muted", text: "Proposal needed" };
    return null;
  }

  // ── URL (in-page moves push a history entry without remounting)
  function go(next) {
    Object.assign(view, next);
    const qs = new URLSearchParams();
    if (view.piece) { qs.set("piece", view.piece); if (view.pieceTab === "talk") qs.set("view", "talk"); }
    else if (view.tab !== "overview") qs.set("tab", view.tab);
    const hash = `#/edition${qs.toString() ? `?${qs}` : ""}`;
    if (location.hash !== hash) history.pushState(null, "", hash);
    render();
    window.scrollTo({ top: 0 });
  }

  // ── render
  let heroTimer = null;
  function render() {
    if (!hub && !cache.hub) {
      root.innerHTML = `<div class="loading-state"><div class="spinner"></div>Loading the edition&hellip;</div>`;
      return;
    }
    if (!hub) { root.innerHTML = `<div class="eh-empty"><h2>No edition is being planned yet.</h2><p>An admin can set one up.</p></div>`; return; }
    const focus = captureFocus();
    root.innerHTML = "";
    root.classList.toggle("eh-piece-mode", !!view.piece);
    // A piece gets the whole page; the big hero is for the edition views.
    if (!view.piece) root.appendChild(hero()); else clearInterval(heroTimer);
    root.appendChild(tabs());
    const body = el("div", { class: "eh-body" });
    root.appendChild(body);
    if (view.piece) {
      const p = pieces.find((x) => x.id === view.piece);
      if (p) body.appendChild(pieceView(p));
      else body.appendChild(el("div", { class: "eh-empty", html: `<h2>That piece isn't in this edition.</h2><p><button type="button" class="btn btn-secondary" data-go="sections">See all pieces</button></p>` }));
    } else if (view.tab === "sections") body.appendChild(sectionsView());
    else if (view.tab === "talk") body.appendChild(talkView());
    else if (view.tab === "social") body.appendChild(socialView());
    else body.appendChild(overviewView());
    restoreFocus(focus);
  }

  // Live updates re-render the page; keep typing where it was.
  function captureFocus() {
    const a = document.activeElement;
    if (!a || !root.contains(a) || !a.dataset.keep) return null;
    return { key: a.dataset.keep, value: a.value, start: a.selectionStart, end: a.selectionEnd };
  }
  function restoreFocus(f) {
    root.querySelectorAll("[data-keep]").forEach((n) => { const v = drafts.get(n.dataset.keep); if (v != null && !n.value) n.value = v; });
    if (!f) return;
    const n = root.querySelector(`[data-keep="${CSS.escape(f.key)}"]`);
    if (!n) return;
    n.value = f.value; n.focus();
    try { n.setSelectionRange(f.start, f.end); } catch {}
  }
  const drafts = new Map();   // unsent text, by composer key
  root.addEventListener("input", (e) => { const k = e.target?.dataset?.keep; if (k) drafts.set(k, e.target.value); });

  // ── hero
  function nextDate() {
    const t = today();
    const list = (hub.dates || []).filter((d) => !d.end).map((d) => ({ ...d, n: daysUntil(d.date) })).filter((d) => d.n >= 0);
    return list.sort((a, b) => a.n - b.n)[0] || null;
  }
  function hero() {
    const words = (hub.sections || []).map((s) => s.name);
    const nd = nextDate();
    const total = realPieces().length;
    const launchN = daysUntil(hub.launch);
    const dates = hub.dates || [];
    const start = parseDay(dates[0]?.date) || today(), end = parseDay(hub.launch) || today();
    const pos = (s) => Math.max(0, Math.min(100, ((parseDay(s) - start) / Math.max(1, end - start)) * 100));
    const nowPct = Math.max(0, Math.min(100, ((today() - start) / Math.max(1, end - start)) * 100));
    const node = el("section", { class: "eh-hero", "aria-label": `${hub.name} edition` });
    node.innerHTML = `
      <div class="eh-hero-main">
        <p class="eh-kicker">The Catalyst &middot; ${esc(hub.name)} edition</p>
        <h1 class="eh-theme">The Future of Health is <span class="eh-blank"><span class="eh-blank-word" aria-hidden="true"></span><span class="sr-only">blank</span></span>.</h1>
        <p class="eh-intro">${esc(hub.intro || "")}</p>
        <ul class="eh-facts">
          <li><strong>${total}</strong> pieces</li>
          <li><strong>${(hub.sections || []).length}</strong> sections</li>
          <li>Launch <strong>${esc(fmtDay(hub.launch, { weekday: "short", month: "short", day: "numeric" }))}</strong>${launchN > 0 ? ` <span>(${plural(launchN, "day")})</span>` : ""}</li>
        </ul>
      </div>
      <aside class="eh-next" aria-label="Next deadline">
        ${nd ? `
          <p class="eh-next-label">${nd.hard ? "Next deadline" : "Coming up"}</p>
          <p class="eh-next-days"><span class="n">${nd.n === 0 ? "Today" : nd.n}</span>${nd.n === 0 ? "" : `<span class="u">${nd.n === 1 ? "day" : "days"}</span>`}</p>
          <p class="eh-next-what">${esc(nd.label)}</p>
          <p class="eh-next-date">${esc(fmtDay(nd.date, { weekday: "long", month: "long", day: "numeric" }))}${nd.hard ? ` <span class="eh-hard">Hard deadline</span>` : ""}</p>`
        : `<p class="eh-next-label">The edition is out</p><p class="eh-next-what">Launched ${esc(fmtDay(hub.launch))}</p>`}
        <div class="eh-track" aria-hidden="true">
          <span class="eh-track-fill" style="width:${nowPct}%"></span>
          ${dates.map((d) => `<span class="eh-track-dot${d.hard ? " is-hard" : ""}${daysUntil(d.end || d.date) < 0 ? " is-past" : ""}" style="left:${pos(d.date)}%" title="${esc(`${fmtDay(d.date)} · ${d.label}`)}"></span>`).join("")}
          <span class="eh-track-now" style="left:${nowPct}%"><span>Today</span></span>
        </div>
        <div class="eh-track-ends"><span>${esc(fmtDay(dates[0]?.date, { month: "short", day: "numeric" }))}</span><span>Launch ${esc(fmtDay(hub.launch, { month: "short", day: "numeric" }))}</span></div>
      </aside>`;
    // The blank fills itself in with each section's name.
    const slot = node.querySelector(".eh-blank-word");
    let i = 0;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    clearInterval(heroTimer);
    if (words.length && !reduce) {
      const show = () => { slot.classList.remove("is-in"); setTimeout(() => { slot.textContent = words[i % words.length]; slot.classList.add("is-in"); i++; }, 260); };
      show();
      heroTimer = setInterval(show, 2800);
    }
    return node;
  }

  // ── tabs
  function tabs() {
    const open = openQs(() => true).length;
    const list = [
      ["overview", "Overview", ""],
      ["sections", "Sections & pieces", String(realPieces().length)],
      ["talk", "Questions & updates", open ? `${open} open` : ""],
      ["social", "For social", ""],
    ];
    const active = view.piece ? "sections" : view.tab;
    const nav = el("nav", { class: "eh-tabs", "aria-label": "This edition" });
    nav.innerHTML = list.map(([id, label, n]) => `
      <button type="button" class="eh-tab${active === id ? " is-active" : ""}" data-go="${id}" ${active === id ? 'aria-current="page"' : ""}>
        ${esc(label)}${n ? `<span class="eh-tab-n${id === "talk" ? " is-alert" : ""}">${esc(n)}</span>` : ""}
      </button>`).join("");
    return nav;
  }

  // ── Overview
  function overviewView() {
    const wrap = el("div", { class: "eh-ov" });
    const forYou = forYouBlock();
    if (forYou) wrap.appendChild(forYou);

    const grid = el("div", { class: "eh-ov-grid" });
    grid.appendChild(datesBlock());
    grid.appendChild(progressBlock());
    wrap.appendChild(grid);

    wrap.appendChild(guidanceBlock());
    wrap.appendChild(editorsDesk());
    return wrap;
  }

  function forYouBlock() {
    const mine = sorted(pieces.filter((p) => isMine(p) && p.section !== "held"));
    const secs = mySections();
    const role = ctx.role;
    if (!mine.length && !secs.length && !isAdmin && !["social_media", "marketing"].includes(role)) return null;
    const node = el("section", { class: "eh-block eh-foryou" });
    let html = `<header class="eh-bh"><h2>For you</h2><p>${esc(firstName(me.name))}, here's what's yours in this edition.</p></header>`;

    if (mine.length) {
      html += `<div class="eh-fy-group"><h3 class="eh-h3">Your ${mine.length === 1 ? "piece" : "pieces"}</h3><div class="eh-fy-list">`;
      for (const p of mine) {
        const ed = editorOf(p);
        const steps = (p.nextSteps || []);
        const nextStep = steps.find((s) => !s.done);
        const doneN = steps.filter((s) => s.done).length;
        const f = flag(p);
        const qN = openQs((m) => m.pieceId === p.id && m.authorUid !== me.uid).length;
        html += `
          <article class="eh-fy-card">
            <p class="eh-fy-kicker">${esc(section(p.section)?.name || "")}${p.format ? ` &middot; ${esc(p.format)}` : ""}</p>
            <h4 class="eh-fy-title"><button type="button" class="eh-link" data-piece="${esc(p.id)}">${esc(p.title)}</button></h4>
            ${miniStepper(p)}
            <div class="eh-fy-meta">
              ${statusPill(p)}${f ? `<span class="eh-flag is-${f.tone}">${esc(f.text)}</span>` : ""}
              ${qN ? `<span class="eh-flag is-info">${plural(qN, "question")} for you</span>` : ""}
            </div>
            ${nextStep ? `<p class="eh-fy-next"><span>Next step${steps.length ? ` (${doneN}/${steps.length} done)` : ""}</span>${esc(nextStep.text)}</p>` : steps.length ? `<p class="eh-fy-next is-done"><span>Next steps</span>All done. Nice work.</p>` : ""}
            <div class="eh-fy-foot">
              ${ed ? `<span class="eh-person">${avatar(ed, 26)}<span><small>Your editor</small>${esc(ed.name)}</span></span>` : `<span class="eh-person"><span><small>Your editor</small>Being assigned</span></span>`}
              <span class="eh-fy-actions">
                <button type="button" class="btn btn-secondary btn-sm" data-ask="${esc(p.id)}">Ask ${ed ? esc(firstName(ed.name)) : "the editors"}</button>
                <button type="button" class="btn btn-primary btn-sm" data-piece="${esc(p.id)}">Open</button>
              </span>
            </div>
          </article>`;
      }
      html += `</div></div>`;
    }

    for (const s of secs) {
      const list = sorted(pieces.filter((p) => p.section === s.id));
      const waiting = openQs((m) => m.authorUid !== me.uid && (m.sectionId === s.id || list.some((p) => p.id === m.pieceId)));
      html += `<div class="eh-fy-group"><h3 class="eh-h3">You edit ${esc(s.name)} <span class="eh-muted">&middot; ${plural(list.filter((p) => p.status !== "open").length, "piece")}${waiting.length ? ` &middot; <button type="button" class="eh-link" data-go="talk">${plural(waiting.length, "open question")}</button>` : ""}</span></h3>
        <ul class="eh-rows">${list.map((p) => pieceRow(p, { compact: true })).join("")}</ul></div>`;
    }

    if (!mine.length && !secs.length) {
      if (["social_media", "marketing"].includes(role)) {
        html += `<p class="eh-fy-social">The <button type="button" class="eh-link" data-go="social">For social</button> tab has the lineup, hooks, people to tag and copy-ready lines for launch on ${esc(fmtDay(hub.launch, { weekday: "long", month: "long", day: "numeric" }))}.</p>`;
      } else if (isAdmin) {
        const noProp = realPieces().filter((p) => p.status === "idea").length;
        const open = live().filter((p) => p.status === "open").length;
        const qs = openQs(() => true).length;
        html += `<ul class="eh-glance">
          <li><strong>${realPieces().length}</strong><span>pieces in the lineup</span></li>
          <li><strong>${open}</strong><span>open ${open === 1 ? "slot" : "slots"}</span></li>
          <li><strong>${noProp}</strong><span>still need a proposal</span></li>
          <li><strong>${qs}</strong><span>open ${qs === 1 ? "question" : "questions"}</span></li>
        </ul>`;
      }
    }
    node.innerHTML = html;
    return node;
  }

  function miniStepper(p) {
    if (SPECIAL[p.status]) return "";
    const i = STAGE_INDEX[p.status] ?? 0;
    return `<ol class="eh-mini" aria-label="Stage ${i + 1} of ${STAGES.length}: ${esc(STAGES[i].label)}">${STAGES.map((s, k) => `<li class="${k < i ? "is-done" : k === i ? "is-now" : ""}" title="${esc(s.label)}"></li>`).join("")}</ol>`;
  }

  function datesBlock() {
    const node = el("section", { class: "eh-block eh-dates" });
    const list = hub.dates || [];
    const nd = nextDate();
    node.innerHTML = `
      <header class="eh-bh"><h2>Key dates</h2>${isAdmin ? `<button type="button" class="btn btn-ghost btn-xs" data-edit-dates>${ICON.edit} Edit</button>` : ""}</header>
      <ol class="eh-dl">${list.map((d) => {
        const past = daysUntil(d.end || d.date) < 0;
        const now = d.end && daysUntil(d.date) <= 0 && daysUntil(d.end) >= 0;
        const isNext = nd && nd.id === d.id;
        const dt = parseDay(d.date);
        return `<li class="eh-d${past ? " is-past" : ""}${isNext ? " is-next" : ""}${now ? " is-now" : ""}${d.hard ? " is-hard" : ""}">
          <span class="eh-d-cal" aria-hidden="true"><span class="m">${dt ? dt.toLocaleDateString("en-US", { month: "short" }) : ""}</span><span class="d">${dt ? dt.getDate() : ""}</span></span>
          <div class="eh-d-body">
            <p class="eh-d-when">${esc(fmtDay(d.date, { weekday: "long", month: "long", day: "numeric" }))}${d.end ? ` – ${esc(fmtDay(d.end, { month: "long", day: "numeric" }))}` : ""}
              ${d.hard ? `<span class="eh-hard">Hard deadline</span>` : ""}${now ? `<span class="eh-now">Happening now</span>` : ""}${isNext ? `<span class="eh-now">${esc(inDays(nd.n))}</span>` : ""}</p>
            <h3 class="eh-d-label">${esc(d.label)}</h3>
            ${d.detail ? `<p class="eh-d-detail">${esc(d.detail)}</p>` : ""}
            ${d.who ? `<p class="eh-d-who">${esc(d.who)}</p>` : ""}
          </div>
        </li>`;
      }).join("")}</ol>`;
    return node;
  }

  function progressBlock() {
    const node = el("section", { class: "eh-block eh-progress" });
    const list = realPieces();
    const counts = STAGES.map((s) => list.filter((p) => (p.status || "idea") === s.id).length);
    const open = live().filter((p) => p.status === "open");
    const attention = [];
    list.filter((p) => p.status === "idea").forEach((p) => attention.push({ p, text: "Proposal needed" }));
    list.forEach((p) => { const f = flag(p); if (f && f.tone !== "muted") attention.push({ p, text: f.text, tone: f.tone }); });
    const staleQs = openQs((m) => Date.now() - new Date(m.createdAt).getTime() > 2 * DAY);
    node.innerHTML = `
      <header class="eh-bh"><h2>Where the edition stands</h2></header>
      <div class="eh-bar" role="img" aria-label="${esc(STAGES.map((s, i) => `${counts[i]} ${s.label}`).join(", "))}">
        ${STAGES.map((s, i) => counts[i] ? `<span class="eh-bar-seg" data-stage="${s.id}" style="flex:${counts[i]}" title="${esc(`${s.label}: ${counts[i]}`)}"></span>` : "").join("")}
      </div>
      <ul class="eh-legend">${STAGES.map((s, i) => `<li data-stage="${s.id}"${counts[i] ? "" : ' class="is-zero"'}><span class="sw"></span>${esc(s.label)} <strong>${counts[i]}</strong></li>`).join("")}</ul>
      <div class="eh-attn">
        <h3 class="eh-h3">Needs attention</h3>
        <ul class="eh-attn-list">
          ${open.map((p) => `<li><span class="eh-flag is-warn">Open slot</span><button type="button" class="eh-link" data-piece="${esc(p.id)}">${esc(p.title === "Open slot" ? `${section(p.section)?.name}: an op-ed or Q&A` : `${section(p.section)?.name}: ${p.title.replace(/^Open slot:\s*/i, "")}`)}</button></li>`).join("")}
          ${attention.map(({ p, text, tone }) => `<li><span class="eh-flag is-${tone || "muted"}">${esc(text)}</span><button type="button" class="eh-link" data-piece="${esc(p.id)}">${esc(p.title)}</button> <span class="eh-muted">${esc(names(p.writers))}</span></li>`).join("")}
          ${staleQs.length ? `<li><span class="eh-flag is-info">${plural(staleQs.length, "question")}</span><button type="button" class="eh-link" data-go="talk">waiting more than two days for an answer</button></li>` : ""}
          ${!open.length && !attention.length && !staleQs.length ? `<li class="eh-muted">Nothing right now.</li>` : ""}
        </ul>
      </div>`;
    return node;
  }

  function guidanceBlock() {
    const node = el("section", { class: "eh-block eh-guide" });
    node.innerHTML = `
      <header class="eh-bh"><h2>How to get it right</h2><p>From the editors, for everyone.</p></header>
      <div class="eh-guide-grid">
        <div class="eh-g eh-g-draft">
          <h3 class="eh-h3">What your first draft needs</h3>
          <ul class="eh-ticks">${(hub.firstDraft || []).map((t) => `<li>${esc(t)}</li>`).join("")}</ul>
        </div>
        <div class="eh-g eh-g-fb">
          <h3 class="eh-h3">Editors' feedback for everyone</h3>
          <ol class="eh-fb">${(hub.feedback || []).map((f) => `<li><strong>${esc(f.title)}.</strong> ${esc(f.text)}</li>`).join("")}</ol>
        </div>
        <div class="eh-g">
          <h3 class="eh-h3">Interview tips</h3>
          <ul class="eh-ticks">${(hub.interviewTips || []).map((t) => `<li>${esc(t)}</li>`).join("")}</ul>
        </div>
        <div class="eh-g">
          <h3 class="eh-h3">Where your work goes</h3>
          <dl class="eh-where">${(hub.whereWork || []).map((w) => `<dt>${esc(w.label)}</dt><dd>${esc(w.text)}</dd>`).join("")}</dl>
          ${driveLinks()}
        </div>
      </div>`;
    return node;
  }
  function driveLinks() {
    const withLinks = (hub.sections || []).filter((s) => s.driveUrl);
    if (!withLinks.length) return "";
    return `<p class="eh-drive">${withLinks.map((s) => `<a class="btn btn-ghost btn-xs" href="${esc(s.driveUrl)}" target="_blank" rel="noopener">${ICON.drive} ${esc(s.name)} folder</a>`).join("")}</p>`;
  }

  function editorsDesk() {
    const node = el("section", { class: "eh-block eh-desk" });
    const can = canEdit();
    const todos = hub.editorTodos || [], decisions = hub.decisions || [];
    node.innerHTML = `
      <header class="eh-bh"><h2>Editors' desk</h2><p>${can ? "Tick things off as you go. Everyone can see this." : "What the editors are working on and still deciding."}</p></header>
      <div class="eh-desk-grid">
        <div>
          <h3 class="eh-h3">To do</h3>
          <ul class="eh-checks">${todos.map((t) => `<li><label class="eh-check${t.done ? " is-done" : ""}"><input type="checkbox" data-todo="${esc(t.id)}" ${t.done ? "checked" : ""} ${can ? "" : "disabled"}><span class="box">${ICON.check}</span><span class="txt">${esc(t.text)}</span></label></li>`).join("")}</ul>
        </div>
        <div>
          <h3 class="eh-h3">Still being decided</h3>
          <ul class="eh-checks">${decisions.map((t) => `<li><label class="eh-check${t.resolved ? " is-done" : ""}"><input type="checkbox" data-decision="${esc(t.id)}" ${t.resolved ? "checked" : ""} ${can ? "" : "disabled"}><span class="box">${ICON.check}</span><span class="txt">${esc(t.text)}</span></label></li>`).join("")}</ul>
        </div>
      </div>`;
    return node;
  }

  // ── Sections & pieces
  function matches(p) {
    if (view.filter === "mine" && !isMine(p) && !edits(section(p.section))) return false;
    if (view.filter === "proposal" && p.status !== "idea") return false;
    if (view.filter === "open" && p.status !== "open") return false;
    if (!view.q) return true;
    const hay = [p.title, p.subtitle, p.format, names(p.writers), section(p.section)?.name, ...(p.interviews || []).map((i) => `${i.person} ${i.affiliation}`)].join(" ").toLowerCase();
    return hay.includes(view.q);
  }

  function pieceRow(p, { compact = false } = {}) {
    const f = flag(p);
    const qN = openQs((m) => m.pieceId === p.id).length;
    const nN = noteCount(p);
    const mine = isMine(p);
    if (p.status === "open") {
      return `<li class="eh-row is-open">
        <div class="eh-row-main"><p class="eh-row-title">${esc(p.title)}</p>${p.subtitle ? `<p class="eh-row-sub">${esc(p.subtitle)}</p>` : ""}</div>
        <div class="eh-row-side"><button type="button" class="btn btn-secondary btn-sm" data-pitch="${esc(p.section)}">Pitch for this slot</button>${canEdit() ? `<button type="button" class="btn btn-ghost btn-sm" data-edit-piece="${esc(p.id)}">Fill it</button>` : ""}</div>
      </li>`;
    }
    return `<li class="eh-row${mine ? " is-mine" : ""}">
      <button type="button" class="eh-row-hit" data-piece="${esc(p.id)}" aria-label="Open ${esc(p.title)}"></button>
      <div class="eh-row-main">
        <p class="eh-row-title">${esc(p.title)}${mine ? ` <span class="eh-you">You</span>` : ""}</p>
        ${!compact && p.subtitle ? `<p class="eh-row-sub">${esc(p.subtitle)}</p>` : ""}
        <p class="eh-row-by">${(p.writers || []).map((w) => `<span class="eh-person sm">${avatar(w, 22)}${esc(w.name)}</span>`).join("")}${p.format ? `<span class="eh-fmt">${esc(p.format)}</span>` : ""}</p>
      </div>
      <div class="eh-row-side">
        ${statusPill(p)}
        ${f && f.tone !== "muted" ? `<span class="eh-flag is-${f.tone}">${esc(f.text)}</span>` : ""}
        ${qN ? `<span class="eh-count" title="${plural(qN, "open question")}">${ICON.q}${qN}</span>` : ""}
        ${nN && !compact ? `<span class="eh-count" title="${plural(nN, "editor's note", "editors' notes")}">${ICON.notes}${nN}</span>` : ""}
        <span class="eh-row-go" aria-hidden="true">${ICON.arrow}</span>
      </div>
    </li>`;
  }
  const noteCount = (p) => Object.values(p.notes || {}).reduce((n, a) => n + (a?.length || 0), 0) + (p.general?.length || 0);

  function sectionsView() {
    const wrap = el("div", { class: "eh-secs" });
    const bar = el("div", { class: "eh-toolbar" });
    bar.innerHTML = `
      <label class="eh-search">${ICON.search}<span class="sr-only">Find a piece</span>
        <input type="search" placeholder="Find a piece, writer or interviewee" value="${esc(view.q)}" data-keep="q" autocomplete="off"></label>
      <div class="eh-chips" role="group" aria-label="Show">
        ${[["all", "All"], ["mine", "Mine"], ["proposal", "Needs a proposal"], ["open", "Open slots"]].map(([id, l]) => `<button type="button" class="eh-chip${view.filter === id ? " is-on" : ""}" data-filter="${id}" aria-pressed="${view.filter === id}">${l}</button>`).join("")}
      </div>`;
    bar.querySelector("input").addEventListener("input", (e) => { view.q = e.target.value.trim().toLowerCase(); renderListOnly(); });
    wrap.appendChild(bar);
    const list = el("div", { class: "eh-sec-list" });
    wrap.appendChild(list);
    const renderListOnly = () => { list.innerHTML = ""; fillSections(list); };
    fillSections(list);
    return wrap;
  }

  function fillSections(list) {
    let shown = 0;
    (hub.sections || []).forEach((s, i) => {
      const ps = sorted(pieces.filter((p) => p.section === s.id)).filter(matches);
      if ((view.q || view.filter !== "all") && !ps.length) return;
      shown += ps.length;
      const node = el("section", { class: "eh-sec", id: `sec-${s.id}` });
      const count = pieces.filter((p) => p.section === s.id && p.status !== "open").length;
      const openN = pieces.filter((p) => p.section === s.id && p.status === "open").length;
      node.innerHTML = `
        <header class="eh-sec-head">
          <span class="eh-sec-num" aria-hidden="true">${String(i + 1).padStart(2, "0")}</span>
          <div class="eh-sec-titles">
            <p class="eh-sec-kicker">The Future of Health is&hellip;</p>
            <h2 class="eh-sec-name">${esc(s.name)}</h2>
            <p class="eh-sec-count">${plural(count, "piece")}${openN ? ` &middot; ${plural(openN, "open slot")}` : ""}</p>
          </div>
          <div class="eh-sec-editor">
            ${s.editor ? `<span class="eh-person">${avatar(s.editor, 40)}<span><small>Section editor</small>${esc(s.editor.name)}</span></span>` : `<span class="eh-person"><span><small>Section editor</small>Not assigned yet</span></span>`}
            <span class="eh-sec-actions">
              ${s.driveUrl ? `<a class="btn btn-ghost btn-sm" href="${esc(s.driveUrl)}" target="_blank" rel="noopener">${ICON.drive} Drive folder</a>` : ""}
              ${isAdmin ? `<button type="button" class="btn btn-ghost btn-sm" data-edit-section="${esc(s.id)}">${ICON.edit} Edit</button>` : ""}
            </span>
          </div>
        </header>
        <details class="eh-sec-about"${view.q ? "" : ""}>
          <summary>About this section</summary>
          <p>${esc(s.blurb || "")}</p>
          ${s.belongs ? `<p class="eh-belongs"><strong>What belongs here.</strong> ${esc(s.belongs)}</p>` : ""}
        </details>
        <ul class="eh-rows">${ps.map((p) => pieceRow(p)).join("") || `<li class="eh-row is-empty">No pieces yet.</li>`}</ul>
        ${canEdit() ? `<p class="eh-add"><button type="button" class="btn btn-ghost btn-sm" data-add-piece="${esc(s.id)}">${ICON.plus} Add a piece</button></p>` : ""}`;
      list.appendChild(node);
    });
    const held = sorted(pieces.filter((p) => p.section === "held")).filter(matches);
    if (held.length && view.filter !== "open" && view.filter !== "proposal") {
      const d = el("details", { class: "eh-held" });
      d.innerHTML = `<summary>Held for a later edition <span class="eh-muted">&middot; ${held.length}</span></summary><ul class="eh-rows">${held.map((p) => pieceRow(p)).join("")}</ul>`;
      list.appendChild(d);
    }
    if (!shown && !held.length) list.innerHTML = `<div class="eh-empty sm"><p>Nothing matches. <button type="button" class="eh-link" data-filter="all" data-clear>Show everything</button></p></div>`;
  }

  // ── a piece
  function pieceView(p) {
    const s = section(p.section);
    const ed = editorOf(p);
    const wrap = el("div", { class: "eh-piece" });
    const qThreads = threadOf((m) => m.pieceId === p.id);
    const openN = qThreads.filter((m) => m.kind === "question" && !m.resolved).length;
    const prog = canProgress(p);
    wrap.innerHTML = `
      <button type="button" class="eh-back" data-go="sections">${ICON.back} All pieces</button>
      <header class="eh-ph">
        <p class="eh-ph-kicker">${s ? `${esc(String(sectionIndex(s.id) + 1).padStart(2, "0"))} &middot; ${esc(s.name)}` : "Held for a later edition"}${p.format ? ` &middot; ${esc(p.format)}` : ""}</p>
        <h2 class="eh-ph-title">${esc(p.title)}</h2>
        ${p.subtitle ? `<p class="eh-ph-sub">${esc(p.subtitle)}</p>` : ""}
        <div class="eh-ph-people">
          ${(p.writers || []).map((w) => `<span class="eh-person">${avatar(w, 40)}<span><small>${(p.writers || []).length > 1 ? "Writer" : "Writer"}</small>${esc(w.name)}</span></span>`).join("")}
          ${ed ? `<span class="eh-person">${avatar(ed, 40)}<span><small>Section editor</small>${esc(ed.name)}</span></span>` : ""}
        </div>
        ${p.placement ? `<p class="eh-placement">${esc(p.placement)}</p>` : ""}
        <div class="eh-ph-actions">
          ${p.status !== "open" ? `<button type="button" class="btn btn-primary btn-sm" data-compose="question" data-for="${esc(p.id)}">${ICON.q} Ask a question</button>
          <button type="button" class="btn btn-secondary btn-sm" data-compose="update" data-for="${esc(p.id)}">${ICON.note} Share an update</button>` : ""}
          ${canEdit() ? `<button type="button" class="btn btn-ghost btn-sm" data-edit-piece="${esc(p.id)}">${ICON.edit} Edit piece</button>` : isMine(p) ? `<button type="button" class="btn btn-ghost btn-sm" data-edit-mine="${esc(p.id)}">${ICON.edit} Edit title & format</button>` : ""}
        </div>
      </header>
      ${SPECIAL[p.status] ? "" : stepper(p, prog)}
      <div class="eh-pgrid">
        <div class="eh-pmain">
          <div class="eh-subtabs" role="tablist">
            <button type="button" role="tab" class="eh-subtab${view.pieceTab === "proposal" ? " is-on" : ""}" aria-selected="${view.pieceTab === "proposal"}" data-ptab="proposal">Proposal${noteCount(p) ? ` <span class="eh-tab-n">${noteCount(p)} notes</span>` : ""}</button>
            <button type="button" role="tab" class="eh-subtab${view.pieceTab === "talk" ? " is-on" : ""}" aria-selected="${view.pieceTab === "talk"}" data-ptab="talk">Questions & updates${qThreads.length ? ` <span class="eh-tab-n${openN ? " is-alert" : ""}">${openN ? `${openN} open` : qThreads.length}</span>` : ""}</button>
          </div>
          <div class="eh-ptab-body"></div>
        </div>
        <aside class="eh-pside"></aside>
      </div>`;
    const body = wrap.querySelector(".eh-ptab-body");
    if (view.pieceTab === "talk") {
      body.appendChild(composer({ pieceId: p.id }));
      body.appendChild(threadList(qThreads, { showContext: false, empty: "No questions or updates on this piece yet. Ask the first one." }));
    } else body.appendChild(proposalView(p));
    wrap.querySelector(".eh-pside").append(...sideCards(p, prog));
    return wrap;
  }

  function stepper(p, prog) {
    const i = STAGE_INDEX[p.status] ?? 0;
    return `<ol class="eh-stepper${prog ? " is-live" : ""}" aria-label="Progress">
      ${STAGES.map((s, k) => `<li class="${k < i ? "is-done" : k === i ? "is-now" : ""}">
        ${prog ? `<button type="button" data-stage="${s.id}" data-piece-id="${esc(p.id)}" ${k === i ? 'aria-current="step"' : ""} title="${esc(s.hint)}">` : `<span ${k === i ? 'aria-current="step"' : ""} title="${esc(s.hint)}">`}
          <span class="dot">${k < i ? ICON.check : k + 1}</span><span class="lbl">${esc(s.label)}</span>
        ${prog ? "</button>" : "</span>"}
      </li>`).join("")}
    </ol>${prog ? `<p class="eh-stepper-hint">Tap a stage to move the piece there. ${isMine(p) ? "Your editor sees the change in Questions & updates." : ""}</p>` : ""}`;
  }

  function proposalView(p) {
    const node = el("div", { class: "eh-prop-wrap" });
    const pr = p.proposal;
    const mine = isMine(p);
    const canProp = mine || canEdit();
    const nN = noteCount(p);
    if (!pr) {
      node.innerHTML = `
        <div class="eh-empty sm eh-noprop">
          <h3>No proposal here yet.</h3>
          <p>${esc(p.proposalNote || (p.status === "open" ? "This slot is open. Pitch for it, and the section editor will get back to you." : "Once the proposal is in, it shows here with the editors' notes."))}</p>
          ${p.candidates?.length ? `<div class="eh-cands"><p class="eh-flabel">Ideas on the table</p><ul>${p.candidates.map((c) => `<li>${esc(c)}</li>`).join("")}</ul></div>` : ""}
          ${canProp && p.status !== "open" ? `<button type="button" class="btn btn-primary" data-edit-proposal="${esc(p.id)}">${mine ? "Add your proposal" : "Add the proposal"}</button>` : ""}
          ${p.status === "open" ? `<button type="button" class="btn btn-primary" data-pitch="${esc(p.section)}">Pitch for this slot</button>` : ""}
        </div>`;
      return node;
    }
    const by = names(p.writers);
    const head = el("div", { class: "eh-prop-tools" });
    head.innerHTML = `
      <p class="eh-prop-by">Proposal by <strong>${esc(by)}</strong>${p.updatedByName && p.updatedAt && !/seeded/i.test(p.updatedByName) ? ` <span class="eh-muted">&middot; updated ${esc(fmtRelative(p.updatedAt))}</span>` : ""}</p>
      <span class="eh-prop-ctl">
        ${nN ? `<label class="eh-switch"><input type="checkbox" ${view.showNotes ? "checked" : ""} data-toggle-notes><span class="tr" aria-hidden="true"></span>Editors' notes <strong>${nN}</strong></label>` : ""}
        ${canProp ? `<button type="button" class="btn btn-ghost btn-xs" data-edit-proposal="${esc(p.id)}">${ICON.edit} Edit proposal</button>` : ""}
      </span>`;
    node.appendChild(head);
    const art = el("article", { class: `eh-prop${view.showNotes ? "" : " hide-notes"}` });
    const valueOf = (k) => (k === "title" ? p.title : k === "subtitle" ? p.subtitle : k === "format" ? p.format : pr[k]);
    const notesFor = (k) => (p.notes?.[k] || []);
    let html = "";
    for (const g of PROPOSAL) {
      const rows = g.fields.filter(([k]) => (valueOf(k) && String(valueOf(k)).trim() && !/^tbd\b/i.test(String(valueOf(k)).trim())) || notesFor(k).length);
      const lead = g.lead ? notesFor(g.lead) : [];
      if (!rows.length && !lead.length) continue;
      html += `<section class="eh-pg"><h3 class="eh-pg-h">${esc(g.group)}</h3>`;
      if (lead.length) html += notesHtml(lead);
      for (const [k, label] of rows) {
        const v = valueOf(k);
        html += `<div class="eh-field">
          <p class="eh-flabel">${esc(label)}</p>
          ${v ? `<div class="eh-ftext${k === "takeaway" ? " is-key" : ""}">${rich(v)}</div>` : `<p class="eh-ftext is-blank">Left blank</p>`}
          ${notesHtml(notesFor(k))}
        </div>`;
      }
      html += `</section>`;
    }
    if (p.general?.length) {
      html += `<section class="eh-pg eh-general"><h3 class="eh-pg-h">The editors' overall feedback</h3>${p.general.map((t) => `<blockquote class="eh-gnote">${rich(t)}</blockquote>`).join("")}</section>`;
    }
    art.innerHTML = html;
    node.appendChild(art);
    return node;
  }
  function notesHtml(list) {
    if (!list?.length) return "";
    return `<div class="eh-notes">${list.map((t) => `<aside class="eh-note"><span class="eh-note-tag">Editor's note</span>${rich(t)}</aside>`).join("")}</div>`;
  }

  function sideCards(p, prog) {
    const out = [];
    const mine = isMine(p);
    // Next steps
    const steps = p.nextSteps || [];
    if (steps.length || canEdit()) {
      const c = el("section", { class: "eh-card" });
      const done = steps.filter((s) => s.done).length;
      c.innerHTML = `
        <header class="eh-card-h"><h3>Next steps</h3>${steps.length ? `<span class="eh-muted">${done}/${steps.length}</span>` : ""}</header>
        ${steps.length ? `<div class="eh-meter"><span style="width:${(done / steps.length) * 100}%"></span></div>` : ""}
        <ul class="eh-checks">${steps.map((s) => `<li><label class="eh-check${s.done ? " is-done" : ""}"><input type="checkbox" data-step="${esc(s.id)}" data-piece-id="${esc(p.id)}" ${s.done ? "checked" : ""} ${prog ? "" : "disabled"}><span class="box">${ICON.check}</span><span class="txt">${esc(s.text)}</span></label></li>`).join("") || `<li class="eh-muted">None yet.</li>`}</ul>
        ${canEdit() ? `<button type="button" class="btn btn-ghost btn-xs" data-edit-steps="${esc(p.id)}">${ICON.edit} Edit steps</button>` : ""}`;
      out.push(c);
    }
    // Deadlines for this piece
    if (!SPECIAL[p.status]) {
      const hard = (hub.dates || []).filter((d) => d.hard);
      const i = STAGE_INDEX[p.status] ?? 0;
      const c = el("section", { class: "eh-card" });
      c.innerHTML = `<header class="eh-card-h"><h3>Deadlines</h3></header>
        <ul class="eh-dues">${hard.map((d) => {
          const reached = (d.id === "first-draft" && i >= STAGE_INDEX.draft1) || (d.id === "final-draft" && i >= STAGE_INDEX.final);
          const n = daysUntil(d.date);
          return `<li class="${reached ? "is-done" : n < 0 ? "is-late" : n <= 7 ? "is-soon" : ""}"><span class="eh-due-l">${esc(d.label)}</span><span class="eh-due-d">${esc(fmtDay(d.date))}</span><span class="eh-due-n">${reached ? "Done" : esc(inDays(n))}</span></li>`;
        }).join("")}
          <li><span class="eh-due-l">Launch day</span><span class="eh-due-d">${esc(fmtDay(hub.launch))}</span><span class="eh-due-n">${esc(inDays(daysUntil(hub.launch)))}</span></li>
        </ul>
        ${p.draftUrl ? `<a class="btn btn-secondary btn-sm eh-block-btn" href="${esc(p.draftUrl)}" target="_blank" rel="noopener">${ICON.drive} Open the draft</a>` : ""}
        ${section(p.section)?.driveUrl ? `<a class="btn btn-ghost btn-sm eh-block-btn" href="${esc(section(p.section).driveUrl)}" target="_blank" rel="noopener">${ICON.drive} ${esc(section(p.section).name)} folder</a>` : ""}
        ${prog ? `<button type="button" class="btn btn-ghost btn-xs" data-draft-link="${esc(p.id)}">${p.draftUrl ? "Change the draft link" : "Add a link to the draft"}</button>` : ""}`;
      out.push(c);
    }
    // Interviews
    const ivs = p.interviews || [];
    if (ivs.length || prog) {
      const c = el("section", { class: "eh-card" });
      const lbl = { done: "Done", scheduled: "Scheduled", planned: "Planned", wanted: "Wanted" };
      c.innerHTML = `<header class="eh-card-h"><h3>Interviews</h3></header>
        <ul class="eh-ivs">${ivs.map((v) => `<li>
          <span class="eh-iv-st is-${esc(v.status || "planned")}">${esc(lbl[v.status] || "Planned")}</span>
          <p class="eh-iv-who">${esc(v.person)}</p>
          ${v.affiliation ? `<p class="eh-iv-aff">${esc(v.affiliation)}</p>` : ""}
          ${v.when ? `<p class="eh-iv-when">${esc(v.when)}</p>` : ""}
          ${v.note ? `<p class="eh-iv-note">${esc(v.note)}</p>` : ""}
        </li>`).join("") || `<li class="eh-muted">None listed.</li>`}</ul>
        ${prog ? `<button type="button" class="btn btn-ghost btn-xs" data-edit-iv="${esc(p.id)}">${ICON.edit} ${ivs.length ? "Update interviews" : "Add an interview"}</button>` : ""}
        ${ivs.length ? `<p class="eh-tip">Send your angle and questions to ${editorOf(p) ? esc(firstName(editorOf(p).name)) : "your editor"} before each interview, and ask permission to record.</p>` : ""}`;
      out.push(c);
    }
    if (mine && !SPECIAL[p.status]) {
      const c = el("section", { class: "eh-card eh-card-quiet" });
      c.innerHTML = `<header class="eh-card-h"><h3>Your first draft</h3></header>
        <p class="eh-tip">Due ${esc(fmtDay((hub.dates || []).find((d) => d.id === "first-draft")?.date, { weekday: "long", month: "long", day: "numeric" }))}. Upload it to your section's Drive folder as “Name_Title_Draft1”, then move this piece to <em>First draft in</em>.</p>`;
      out.push(c);
    }
    return out;
  }

  // ── Questions & updates
  function recipientsFor({ pieceId, sectionId, kind }) {
    const p = pieces.find((x) => x.id === pieceId);
    const people = [];
    const add = (x) => { if (x && !sameName(x.name, me.name) && !people.some((y) => sameName(y.name, x.name))) people.push(x); };
    if (p) { (p.writers || []).forEach(add); add(editorOf(p)); }
    else if (sectionId) {
      const s = section(sectionId); add(s?.editor);
      if (isHubEditor() || isAdmin || kind === "announcement") pieces.filter((x) => x.section === sectionId).flatMap((x) => x.writers || []).forEach(add);
    } else {
      (hub.sections || []).forEach((s) => add(s.editor));
      if (kind === "announcement" || ((isHubEditor() || isAdmin) && kind === "update")) return "Everyone working on the edition";
      return people.length ? `${people.map((x) => firstName(x.name)).join(", ")} and the admins` : "The admins";
    }
    return people.map((x) => x.name).join(", ") || "The admins";
  }

  function composer({ pieceId = "", sectionId = "", kind = "question", choose = false, compact = false, prefill = "", onSent = null } = {}) {
    const node = el("form", { class: `eh-compose${compact ? " is-compact" : ""}`, novalidate: "" });
    const key = `c:${pieceId || sectionId || "all"}:${choose ? "pick" : "fixed"}`;
    let state = { kind, pieceId, sectionId };
    const kinds = ["question", "update", ...(isHubEditor() || isAdmin ? ["announcement"] : [])];
    const aboutOptions = () => `
      <option value="">The whole edition</option>
      <optgroup label="Sections">${(hub.sections || []).map((s) => `<option value="s:${esc(s.id)}"${state.sectionId === s.id && !state.pieceId ? " selected" : ""}>${esc(s.name)}</option>`).join("")}</optgroup>
      ${(hub.sections || []).map((s) => {
        const ps = sorted(pieces.filter((p) => p.section === s.id && p.status !== "open"));
        return ps.length ? `<optgroup label="${esc(s.name)} pieces">${ps.map((p) => `<option value="p:${esc(p.id)}"${state.pieceId === p.id ? " selected" : ""}>${esc(p.title.length > 70 ? `${p.title.slice(0, 68)}…` : p.title)} (${esc(names(p.writers).split(" & ").map(firstName).join(" & "))})</option>`).join("")}</optgroup>` : "";
      }).join("")}`;
    const paint = () => {
      node.innerHTML = `
        <div class="eh-compose-top">
          <div class="eh-seg" role="radiogroup" aria-label="Kind of post">
            ${kinds.map((k) => `<button type="button" role="radio" aria-checked="${state.kind === k}" class="eh-seg-b${state.kind === k ? " is-on" : ""}" data-kind="${k}">${KIND[k].label}</button>`).join("")}
          </div>
          ${choose ? `<label class="eh-about"><span>About</span><select data-about>${aboutOptions()}</select></label>` : ""}
        </div>
        <label class="sr-only" for="${esc(key)}">${esc(KIND[state.kind].verb)}</label>
        <textarea id="${esc(key)}" rows="${compact ? 3 : 4}" maxlength="4000" placeholder="${esc(KIND[state.kind].ph)}" data-keep="${esc(key)}"></textarea>
        <div class="eh-compose-foot">
          <p class="eh-to">Goes to: <strong>${esc(recipientsFor({ ...state }))}</strong> <span class="eh-muted">(bell notification)</span></p>
          <button type="submit" class="btn btn-primary btn-sm">${esc(KIND[state.kind].verb)}</button>
        </div>`;
      const ta = node.querySelector("textarea");
      ta.value = drafts.get(key) || prefill || "";
    };
    paint();
    node.addEventListener("click", (e) => {
      const b = e.target.closest("[data-kind]");
      if (!b) return;
      const text = node.querySelector("textarea").value;
      state.kind = b.dataset.kind; drafts.set(key, text); paint();
      node.querySelector("textarea").focus();
    });
    node.addEventListener("change", (e) => {
      if (!e.target.matches("[data-about]")) return;
      const v = e.target.value;
      state.pieceId = v.startsWith("p:") ? v.slice(2) : "";
      state.sectionId = v.startsWith("s:") ? v.slice(2) : (state.pieceId ? (pieces.find((p) => p.id === state.pieceId)?.section || "") : "");
      drafts.set(key, node.querySelector("textarea").value); paint();
    });
    node.addEventListener("keydown", (e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); node.requestSubmit(); } });
    node.addEventListener("submit", async (e) => {
      e.preventDefault();
      const ta = node.querySelector("textarea");
      const text = ta.value.trim();
      if (!text) { ta.focus(); return; }
      const btn = node.querySelector("[type=submit]");
      btn.disabled = true;
      const ok = await post({ kind: state.kind, text, pieceId: state.pieceId, sectionId: state.sectionId });
      btn.disabled = false;
      if (ok) { drafts.delete(key); ta.value = ""; toast(state.kind === "question" ? "Question sent." : "Posted.", "success"); onSent?.(); }
    });
    return node;
  }

  async function post({ kind, text, pieceId = "", sectionId = "", parentId = "", auto = false }) {
    if (!canWrite()) return false;
    const p = pieces.find((x) => x.id === pieceId);
    const data = {
      kind, text: text.slice(0, 4000),
      pieceId: pieceId || "", sectionId: sectionId || p?.section || "", parentId: parentId || "",
      authorUid: me.uid, authorName: me.name, authorSlug: slugify(me.name), authorRole: roleLabelFor(me.uid, me.name) || ({ admin: "Admin", social_media: "Social media", marketing: "Marketing" }[ctx.realRole] || ""),
      createdAt: new Date().toISOString(), resolved: false, auto: !!auto,
    };
    try {
      const ref = await addDoc(collection(db, "edition_hub", EDITION, "messages"), data);
      ctx.authedFetch("/api/edition/notify", { method: "POST", body: JSON.stringify({ edition: EDITION, id: ref.id }) })
        .catch((err) => console.warn("[edition] notify", err?.message));
      return true;
    } catch (err) {
      console.warn("[edition] post", err);
      toast("That didn't send. Check your connection and try again.", "error");
      return false;
    }
  }

  function talkView() {
    const wrap = el("div", { class: "eh-talk" });
    const head = el("header", { class: "eh-bh" });
    head.innerHTML = `<h2>Questions & updates</h2><p>Ask the editors or a writer anything about the edition, and share how your piece is going. People get a bell notification when a post is about them.</p>`;
    wrap.appendChild(head);
    wrap.appendChild(composer({ choose: true }));
    const filters = el("div", { class: "eh-chips eh-talk-filters", role: "group", "aria-label": "Show" });
    const all = threadOf(() => true);
    const open = all.filter((m) => m.kind === "question" && !m.resolved);
    const mineF = all.filter((m) => m.authorUid === me.uid || pieces.some((p) => p.id === m.pieceId && (isMine(p) || edits(section(p.section)))) || (m.sectionId && !m.pieceId && edits(section(m.sectionId))));
    const opts = [["all", "Everything", all.length], ["open", "Open questions", open.length], ["updates", "Updates", all.filter((m) => m.kind === "update").length], ["mine", "About me", mineF.length], ["announce", "Announcements", all.filter((m) => m.kind === "announcement").length]];
    filters.innerHTML = opts.map(([id, l, n]) => `<button type="button" class="eh-chip${view.talkFilter === id ? " is-on" : ""}" data-tfilter="${id}" aria-pressed="${view.talkFilter === id}">${l}${n ? ` <span>${n}</span>` : ""}</button>`).join("");
    wrap.appendChild(filters);
    const list = { all, open, updates: all.filter((m) => m.kind === "update"), mine: mineF, announce: all.filter((m) => m.kind === "announcement") }[view.talkFilter] || all;
    wrap.appendChild(threadList(list, { showContext: true, empty: view.talkFilter === "open" ? "No open questions. Everything's been answered." : "Nothing here yet." }));
    return wrap;
  }

  function threadList(list, { showContext = true, empty = "Nothing yet." } = {}) {
    const ul = el("ul", { class: "eh-threads" });
    if (!list.length) { ul.innerHTML = `<li class="eh-empty sm"><p>${esc(empty)}</p></li>`; return ul; }
    // Open questions first, then newest.
    const items = [...list].sort((a, b) => (Number(b.kind === "question" && !b.resolved) - Number(a.kind === "question" && !a.resolved)) || String(b.createdAt).localeCompare(String(a.createdAt)));
    ul.innerHTML = items.map((m) => messageHtml(m, { showContext })).join("");
    return ul;
  }

  function messageHtml(m, { showContext = true, isReply = false } = {}) {
    const p = pieces.find((x) => x.id === m.pieceId);
    const s = section(m.sectionId);
    const author = { name: m.authorName, slug: m.authorSlug };
    const isQ = m.kind === "question";
    const mineMsg = m.authorUid === me.uid;
    const ctxLabel = p ? `<button type="button" class="eh-link" data-piece="${esc(p.id)}" data-ptab-go="talk">${esc(p.title.length > 64 ? `${p.title.slice(0, 62)}…` : p.title)}</button>` : s ? esc(s.name) : "The whole edition";
    const replies = isReply ? [] : repliesTo(m.id);
    return `<li class="eh-msg${isQ && !m.resolved ? " is-open" : ""}${m.kind === "announcement" ? " is-announce" : ""}${m.auto ? " is-auto" : ""}${isReply ? " is-reply" : ""}" id="m-${esc(m.id)}">
      <div class="eh-msg-av">${avatar(author, isReply ? 28 : 36)}</div>
      <div class="eh-msg-body">
        <p class="eh-msg-head">
          <strong>${esc(m.authorName || "Someone")}</strong>${m.authorRole ? `<span class="eh-msg-role">${esc(m.authorRole)}</span>` : ""}
          ${isReply ? "" : `<span class="eh-kind is-${esc(m.kind)}${isQ && m.resolved ? " is-resolved" : ""}">${isQ ? (m.resolved ? `${ICON.check} Answered` : "Question") : esc(KIND[m.kind]?.label || "Update")}</span>`}
          <time datetime="${esc(m.createdAt)}" title="${esc(new Date(m.createdAt).toLocaleString("en-US"))}">${esc(fmtRelative(m.createdAt))}${m.editedAt ? " (edited)" : ""}</time>
        </p>
        ${showContext && !isReply ? `<p class="eh-msg-ctx">On ${ctxLabel}</p>` : ""}
        <div class="eh-msg-text" data-text-of="${esc(m.id)}">${rich(m.text)}</div>
        <div class="eh-msg-actions">
          ${!isReply && !m.auto ? `<button type="button" class="eh-act" data-reply="${esc(m.id)}">Reply${replies.length ? ` (${replies.length})` : ""}</button>` : ""}
          ${isQ && !isReply ? `<button type="button" class="eh-act" data-resolve="${esc(m.id)}" data-val="${m.resolved ? "0" : "1"}">${m.resolved ? "Reopen" : "Mark answered"}</button>` : ""}
          ${mineMsg && !m.auto ? `<button type="button" class="eh-act" data-edit-msg="${esc(m.id)}">Edit</button>` : ""}
          ${mineMsg || isAdmin ? `<button type="button" class="eh-act is-danger" data-del-msg="${esc(m.id)}">Delete</button>` : ""}
          ${isQ && m.resolved && m.resolvedByName ? `<span class="eh-muted">Marked answered by ${esc(firstName(m.resolvedByName))}</span>` : ""}
        </div>
        ${replies.length ? `<ul class="eh-replies">${replies.map((r) => messageHtml(r, { showContext: false, isReply: true })).join("")}</ul>` : ""}
        ${isReply ? "" : `<div class="eh-reply-slot" data-reply-slot="${esc(m.id)}"></div>`}
      </div>
    </li>`;
  }

  function openReply(id) {
    const slot = root.querySelector(`[data-reply-slot="${CSS.escape(id)}"]`);
    if (!slot) return;
    if (slot.firstChild) { slot.querySelector("textarea")?.focus(); return; }
    const m = messages.find((x) => x.id === id);
    const key = `r:${id}`;
    const f = el("form", { class: "eh-reply-form" });
    f.innerHTML = `<label class="sr-only" for="${esc(key)}">Reply</label><textarea id="${esc(key)}" rows="2" maxlength="4000" placeholder="Write a reply" data-keep="${esc(key)}"></textarea>
      <div class="eh-reply-foot">${m?.kind === "question" && !m.resolved ? `<label class="eh-inline-check"><input type="checkbox" checked data-and-resolve> Mark answered</label>` : "<span></span>"}<span><button type="button" class="btn btn-ghost btn-xs" data-cancel>Cancel</button><button type="submit" class="btn btn-primary btn-xs">Reply</button></span></div>`;
    f.querySelector("textarea").value = drafts.get(key) || "";
    f.addEventListener("keydown", (e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); f.requestSubmit(); } });
    f.querySelector("[data-cancel]").addEventListener("click", () => { drafts.delete(key); f.remove(); });
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const text = f.querySelector("textarea").value.trim();
      if (!text) return;
      const andResolve = f.querySelector("[data-and-resolve]")?.checked;
      const ok = await post({ kind: "reply", text, parentId: id, pieceId: m?.pieceId || "", sectionId: m?.sectionId || "" });
      if (ok) {
        drafts.delete(key);
        if (andResolve) resolve(id, true);
      }
    });
    slot.appendChild(f);
    f.querySelector("textarea").focus();
  }
  // A reply form survives live re-renders: reopen the ones that were open.
  const openReplies = new Set();

  async function resolve(id, val) {
    if (!canWrite()) return;
    try {
      await updateDoc(doc(db, "edition_hub", EDITION, "messages", id), val
        ? { resolved: true, resolvedAt: new Date().toISOString(), resolvedByName: me.name }
        : { resolved: false, resolvedAt: "", resolvedByName: "" });
    } catch { toast("Couldn't update that question.", "error"); }
  }

  // ── For social
  function socialView() {
    const wrap = el("div", { class: "eh-social" });
    const launchN = daysUntil(hub.launch);
    const fin = (hub.dates || []).find((d) => d.id === "final-draft");
    const list = sorted(realPieces());
    const tags = [...new Set(list.flatMap((p) => (p.interviews || []).filter((v) => v.status !== "wanted").map((v) => v.affiliation)).filter(Boolean).map((a) => a.replace(/^(Director|Head PI|Epidemiologist|Bioethicist|MD\/PhD, medical historian),?\s*/i, "")))];
    wrap.innerHTML = `
      <header class="eh-bh"><h2>For the social team</h2><p>Everything you need to plan the launch. Titles can still change until final drafts are in${fin ? ` (${esc(fmtDay(fin.date))})` : ""}, so check back before you design.</p></header>
      <ul class="eh-glance">
        <li><strong>${launchN > 0 ? launchN : 0}</strong><span>${launchN > 0 ? `days to launch (${esc(fmtDay(hub.launch))})` : "Launched"}</span></li>
        <li><strong>${list.length}</strong><span>pieces in the lineup</span></li>
        <li><strong>${(hub.sections || []).length}</strong><span>sections</span></li>
        <li><strong>${list.filter((p) => (STAGE_INDEX[p.status] ?? 0) >= STAGE_INDEX.final).length}</strong><span>final drafts in</span></li>
      </ul>
      <section class="eh-block">
        <header class="eh-bh"><h3 class="eh-h3">Copy-ready lines</h3></header>
        <ul class="eh-copy-list">
          <li><p><strong>The theme.</strong> ${esc(hub.theme)} ${esc(hub.intro || "")}</p><button type="button" class="btn btn-ghost btn-xs" data-copy="${esc(`${hub.theme} ${hub.intro || ""}`)}">${ICON.copy} Copy</button></li>
          ${(hub.sections || []).map((s) => `<li><p><strong>The Future of Health is ${esc(endStop(s.name))}</strong> ${esc(s.blurb || "")}</p><button type="button" class="btn btn-ghost btn-xs" data-copy="${esc(`The Future of Health is ${endStop(s.name)} ${s.blurb || ""}`)}">${ICON.copy} Copy</button></li>`).join("")}
        </ul>
      </section>
      ${tags.length ? `<section class="eh-block"><header class="eh-bh"><h3 class="eh-h3">People and places to tag</h3><p>From the interviews so far. Confirm the right handles before posting.</p></header><p class="eh-tags">${tags.map((t) => `<span class="eh-tagchip">${esc(t)}</span>`).join("")}</p></section>` : ""}
      <section class="eh-block">
        <header class="eh-bh"><h3 class="eh-h3">The lineup</h3></header>
        <div class="eh-lineup">${(hub.sections || []).map((s) => {
          const ps = list.filter((p) => p.section === s.id);
          if (!ps.length) return "";
          return `<div class="eh-lu-sec"><h4 class="eh-lu-h">${esc(s.name)}</h4><ul class="eh-lu">${ps.map((p) => `
            <li class="eh-lu-item">
              <div class="eh-lu-top"><p class="eh-lu-title">${esc(p.title)}</p>${statusPill(p)}</div>
              <p class="eh-lu-by">${esc(names(p.writers))}${p.format ? ` &middot; ${esc(p.format)}` : ""}</p>
              ${p.subtitle ? `<p class="eh-lu-hook"><span>Hook</span>${esc(p.subtitle)} <button type="button" class="eh-act" data-copy="${esc(p.subtitle)}">${ICON.copy} Copy</button></p>` : ""}
              ${p.proposal?.visuals ? `<p class="eh-lu-vis"><span>Visual ideas</span>${esc(p.proposal.visuals)}</p>` : ""}
              ${(p.interviews || []).filter((v) => v.status !== "wanted").length ? `<p class="eh-lu-vis"><span>Featuring</span>${esc((p.interviews || []).filter((v) => v.status !== "wanted").map((v) => `${v.person}${v.affiliation ? ` (${v.affiliation})` : ""}`).join("; "))}</p>` : ""}
            </li>`).join("")}</ul></div>`;
        }).join("")}</div>
      </section>`;
    return wrap;
  }

  // ── writes
  async function savePiece(id, fields, { note } = {}) {
    if (!canWrite()) return false;
    try {
      await updateDoc(doc(db, "edition_hub", EDITION, "pieces", id), { ...fields, updatedAt: new Date().toISOString(), updatedBy: me.uid, updatedByName: me.name });
      if (note) post({ kind: "update", text: note, pieceId: id, auto: true });
      return true;
    } catch (err) {
      console.warn("[edition] save piece", err);
      toast(/permission/i.test(String(err?.message)) ? "You can't change that piece." : "Couldn't save. Try again.", "error");
      return false;
    }
  }
  async function saveHub(fields) {
    if (!canWrite()) return false;
    try {
      await updateDoc(hubRef, { ...fields, updatedAt: new Date().toISOString(), updatedByName: me.name });
      return true;
    } catch (err) {
      console.warn("[edition] save hub", err);
      toast("Couldn't save. Try again.", "error");
      return false;
    }
  }

  // ── modals
  async function loadStaff() {
    if (cache.staff) return cache.staff;
    // One entry per person: every account with their name (some people have
    // an old duplicate account), listed if any of them is on staff.
    const STAFF = ["admin", "editor", "writer", "social_media", "marketing", "newsletter_builder"];
    const s = await getDocs(collection(db, "users"));
    const byName = new Map();
    s.docs.forEach((d) => {
      const u = d.data(); const name = String(u.name || "").trim();
      if (!name) return;
      const k = name.toLowerCase();
      const cur = byName.get(k) || { name, slug: slugify(name), uids: [], staff: false };
      cur.uids.push(d.id);
      if (STAFF.includes(u.role)) cur.staff = true;
      byName.set(k, cur);
    });
    cache.staff = [...byName.values()].filter((x) => x.staff).sort((a, b) => a.name.localeCompare(b.name));
    return cache.staff;
  }

  function field(label, input, hint = "") {
    return `<label class="eh-f"><span class="eh-f-l">${esc(label)}</span>${input}${hint ? `<span class="eh-f-h">${esc(hint)}</span>` : ""}</label>`;
  }
  const input = (name, value = "", attrs = "") => `<input class="input" name="${name}" value="${esc(value)}" ${attrs}>`;
  const area = (name, value = "", rows = 3) => `<textarea class="input" name="${name}" rows="${rows}">${esc(value)}</textarea>`;

  async function editPiece(p, { isNew = false, sectionId = "" } = {}) {
    let staff = [];
    if (isAdmin) { try { staff = await loadStaff(); } catch {} }
    const cur = p || { title: "", subtitle: "", format: "", section: sectionId, status: "idea", writers: [], placement: "" };
    const writerNames = new Set((cur.writers || []).map((w) => w.name.toLowerCase()));
    const body = el("form", { class: "eh-form" });
    body.innerHTML = `
      ${field("Title", input("title", cur.status === "open" ? "" : cur.title, 'required maxlength="200"'))}
      ${field("Subtitle", area("subtitle", cur.status === "open" ? "" : cur.subtitle, 2))}
      <div class="eh-f-row">
        ${field("Section", `<select class="input" name="section">${[...(hub.sections || []).map((s) => [s.id, s.name]), ["held", "Held for a later edition"]].map(([id, n]) => `<option value="${id}"${cur.section === id ? " selected" : ""}>${esc(n)}</option>`).join("")}</select>`)}
        ${field("Format", input("format", cur.format, 'list="eh-formats" maxlength="60"'))}
        ${field("Stage", `<select class="input" name="status">${[...STAGES.map((s) => [s.id, s.label]), ["open", "Open slot"], ["held", "Held"]].map(([id, n]) => `<option value="${id}"${(cur.status === "open" && !isNew ? "idea" : cur.status) === id ? " selected" : ""}>${esc(n)}</option>`).join("")}</select>`)}
      </div>
      <datalist id="eh-formats"><option>Feature</option><option>Explainer</option><option>Op-ed</option><option>Q&amp;A</option><option>Essay</option><option>News</option><option>Investigation</option></datalist>
      ${isAdmin ? `<fieldset class="eh-f"><legend class="eh-f-l">Writers</legend><div class="eh-pick">${staff.map((s) => `<label class="eh-pick-i"><input type="checkbox" name="writer" value="${esc(s.name)}" ${writerNames.has(s.name.toLowerCase()) ? "checked" : ""}> ${esc(s.name)}</label>`).join("") || `<span class="eh-muted">Couldn't load the team.</span>`}</div></fieldset>` : `<p class="eh-f-h">Writers: ${esc(names(cur.writers) || "none")}. An admin can change who's writing it.</p>`}
      ${field("Placement note", input("placement", cur.placement || "", 'maxlength="200"'), "Optional, e.g. “Moved from Prevention.”")}`;
    const footer = [
      ...(isAdmin && !isNew ? [el("button", { type: "button", class: "btn btn-danger btn-sm eh-left", onclick: async () => {
        if (!(await confirmDialog(`Delete “${cur.title}” from this edition? Its questions and updates stay in the feed.`, { confirmText: "Delete", danger: true }))) return;
        try { await deleteDoc(doc(db, "edition_hub", EDITION, "pieces", cur.id)); m.close(); go({ piece: null, tab: "sections" }); toast("Deleted."); } catch { toast("Couldn't delete it.", "error"); }
      } }, "Delete")] : []),
      el("button", { type: "button", class: "btn btn-secondary", onclick: () => m.close() }, "Cancel"),
      el("button", { type: "button", class: "btn btn-primary", onclick: () => body.requestSubmit() }, isNew ? "Add piece" : "Save"),
    ];
    const m = openModal({ title: isNew ? "Add a piece" : "Edit piece", body, footer, size: "wide" });
    body.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(body);
      const title = String(fd.get("title") || "").trim();
      if (!title) { body.querySelector("[name=title]").focus(); return; }
      const fields = {
        title, subtitle: String(fd.get("subtitle") || "").trim(), section: String(fd.get("section")),
        format: String(fd.get("format") || "").trim(), status: String(fd.get("status")), placement: String(fd.get("placement") || "").trim(),
      };
      if (isAdmin) {
        const chosen = fd.getAll("writer").map(String);
        const ws = chosen.map((n) => staff.find((s) => s.name === n)).filter(Boolean).map((s) => ({ name: s.name, slug: s.slug, uids: s.uids }));
        fields.writers = ws; fields.writerUids = [...new Set(ws.flatMap((w) => w.uids))];
      }
      if (isNew) {
        {
          if (!canWrite()) return;
          try {
            const order = Math.max(0, ...pieces.filter((x) => x.section === fields.section).map((x) => x.order || 0)) + 10;
            const ref = await addDoc(collection(db, "edition_hub", EDITION, "pieces"), {
              ...fields, writers: fields.writers || [], writerUids: fields.writerUids || [], order,
              interviews: [], nextSteps: [], proposal: null, notes: {}, general: [],
              createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), updatedBy: me.uid, updatedByName: me.name,
            });
            m.close(); go({ piece: ref.id, pieceTab: "proposal" }); toast("Added.", "success");
          } catch (err) { console.warn(err); toast("Couldn't add it.", "error"); }
          return;
        }
      }
      if (await savePiece(cur.id, fields)) { m.close(); toast("Saved.", "success"); }
    });
  }

  function editMine(p) {
    const body = el("form", { class: "eh-form" });
    body.innerHTML = `
      ${field("Title", input("title", p.title, 'required maxlength="200"'))}
      ${field("Subtitle", area("subtitle", p.subtitle, 2))}
      ${field("Format", input("format", p.format, 'list="eh-formats2" maxlength="60"'), "Pick one: feature, explainer, op-ed, Q&A, essay, news or investigation.")}
      <datalist id="eh-formats2"><option>Feature</option><option>Explainer</option><option>Op-ed</option><option>Q&amp;A</option><option>Essay</option><option>News</option><option>Investigation</option></datalist>`;
    const m = openModal({ title: "Edit title & format", body, footer: [
      el("button", { type: "button", class: "btn btn-secondary", onclick: () => m.close() }, "Cancel"),
      el("button", { type: "button", class: "btn btn-primary", onclick: () => body.requestSubmit() }, "Save"),
    ] });
    body.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(body);
      const title = String(fd.get("title") || "").trim();
      if (!title) return;
      const changed = title !== p.title;
      if (await savePiece(p.id, { title, subtitle: String(fd.get("subtitle") || "").trim(), format: String(fd.get("format") || "").trim() },
        { note: changed ? `New working title: “${title}”.` : "" })) { m.close(); toast("Saved.", "success"); }
    });
  }

  function editProposal(p) {
    const pr = p.proposal || {};
    const body = el("form", { class: "eh-form" });
    body.innerHTML = `<p class="eh-f-h">${p.proposal ? "Update your proposal. The editors' notes stay where they are." : "Fill in what you have. You can paste from your proposal in the Drive. Leave anything you don't know yet blank."}</p>
      ${PROPOSAL.map((g) => {
        const fs = g.fields.filter(([k]) => !["title", "subtitle", "format"].includes(k));
        if (!fs.length) return "";
        return `<fieldset class="eh-fs"><legend>${esc(g.group)}</legend>${fs.map(([k, l]) => field(l, k === "delivery" ? input(k, pr[k] || "", 'maxlength="80"') : area(k, pr[k] || "", k === "research" || k === "feedback" ? 4 : 3))).join("")}</fieldset>`;
      }).join("")}`;
    const m = openModal({ title: p.proposal ? "Edit proposal" : "Add the proposal", body, size: "wide", footer: [
      el("button", { type: "button", class: "btn btn-secondary", onclick: () => m.close() }, "Cancel"),
      el("button", { type: "button", class: "btn btn-primary", onclick: () => body.requestSubmit() }, "Save proposal"),
    ] });
    body.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(body);
      const next = {};
      for (const [k] of PROPOSAL_EDITABLE) { const v = String(fd.get(k) || "").trim(); if (v) next[k] = v.slice(0, 6000); }
      if (!Object.keys(next).length) { toast("Fill in at least one part.", "info"); return; }
      const fields = { proposal: next };
      if (p.status === "idea") fields.status = "proposal";
      if (await savePiece(p.id, fields, { note: p.proposal ? "Updated the proposal." : "Added the proposal." })) { m.close(); toast("Proposal saved.", "success"); }
    });
  }

  function editInterviews(p) {
    const rows = (p.interviews || []).map((v) => ({ ...v }));
    if (!rows.length) rows.push({ person: "", affiliation: "", when: "", status: "planned", note: "" });
    const body = el("form", { class: "eh-form" });
    const paint = () => {
      body.innerHTML = rows.map((v, i) => `
        <fieldset class="eh-fs eh-iv-edit" data-i="${i}">
          <legend>Interview ${i + 1}</legend>
          <div class="eh-f-row">
            ${field("Who", input(`person-${i}`, v.person, 'maxlength="140" placeholder="Dr. Jane Doe"'))}
            ${field("Where they're from", input(`aff-${i}`, v.affiliation, 'maxlength="140" placeholder="GW School of Medicine"'))}
          </div>
          <div class="eh-f-row">
            ${field("When", input(`when-${i}`, v.when, 'maxlength="80" placeholder="Oct 28"'))}
            ${field("Status", `<select class="input" name="status-${i}">${[["wanted", "Wanted"], ["planned", "Planned"], ["scheduled", "Scheduled"], ["done", "Done"]].map(([id, l]) => `<option value="${id}"${v.status === id ? " selected" : ""}>${l}</option>`).join("")}</select>`)}
          </div>
          ${field("Note", input(`note-${i}`, v.note || "", 'maxlength="200"'))}
          <button type="button" class="btn btn-ghost btn-xs" data-rm="${i}">Remove</button>
        </fieldset>`).join("") + `<button type="button" class="btn btn-secondary btn-sm" data-add-iv>${ICON.plus} Add another</button>`;
    };
    const read = () => rows.forEach((v, i) => {
      const g = (n) => body.querySelector(`[name="${n}-${i}"]`)?.value?.trim() || "";
      Object.assign(v, { person: g("person"), affiliation: g("aff"), when: g("when"), status: g("status") || "planned", note: g("note") });
    });
    paint();
    body.addEventListener("click", (e) => {
      if (e.target.closest("[data-add-iv]")) { read(); rows.push({ person: "", affiliation: "", when: "", status: "planned", note: "" }); paint(); }
      const rm = e.target.closest("[data-rm]");
      if (rm) { read(); rows.splice(Number(rm.dataset.rm), 1); paint(); }
    });
    const m = openModal({ title: "Interviews", body, size: "wide", footer: [
      el("button", { type: "button", class: "btn btn-secondary", onclick: () => m.close() }, "Cancel"),
      el("button", { type: "button", class: "btn btn-primary", onclick: () => body.requestSubmit() }, "Save"),
    ] });
    body.addEventListener("submit", async (e) => {
      e.preventDefault(); read();
      const clean = rows.filter((v) => v.person);
      const before = new Map((p.interviews || []).map((v) => [v.person, v.status]));
      const newlyDone = clean.filter((v) => v.status === "done" && before.get(v.person) !== "done").map((v) => v.person);
      if (await savePiece(p.id, { interviews: clean }, { note: newlyDone.length ? `Interview done: ${newlyDone.join(", ")}.` : "" })) { m.close(); toast("Saved.", "success"); }
    });
  }

  function editSteps(p) {
    const body = el("form", { class: "eh-form" });
    body.innerHTML = field("Next steps, one per line", area("steps", (p.nextSteps || []).map((s) => s.text).join("\n"), 7), "Ticked steps stay ticked if the wording doesn't change.");
    const m = openModal({ title: "Next steps", body, footer: [
      el("button", { type: "button", class: "btn btn-secondary", onclick: () => m.close() }, "Cancel"),
      el("button", { type: "button", class: "btn btn-primary", onclick: () => body.requestSubmit() }, "Save"),
    ] });
    body.addEventListener("submit", async (e) => {
      e.preventDefault();
      const lines = String(new FormData(body).get("steps") || "").split("\n").map((s) => s.trim()).filter(Boolean);
      const old = new Map((p.nextSteps || []).map((s) => [s.text, s]));
      const steps = lines.map((text, i) => ({ id: old.get(text)?.id || `s${Date.now().toString(36)}${i}`, text, done: !!old.get(text)?.done }));
      if (await savePiece(p.id, { nextSteps: steps })) { m.close(); toast("Saved.", "success"); }
    });
  }

  function editDraftLink(p) {
    const body = el("form", { class: "eh-form" });
    body.innerHTML = field("Link to the draft", input("url", p.draftUrl || "", 'type="url" placeholder="https://docs.google.com/…"'), "The Google Doc in your section's Drive folder. Only the team can open it if it's shared that way.");
    const m = openModal({ title: "Draft link", body, footer: [
      el("button", { type: "button", class: "btn btn-secondary", onclick: () => m.close() }, "Cancel"),
      el("button", { type: "button", class: "btn btn-primary", onclick: () => body.requestSubmit() }, "Save"),
    ] });
    body.addEventListener("submit", async (e) => {
      e.preventDefault();
      const url = String(new FormData(body).get("url") || "").trim();
      if (url && !/^https:\/\/[^\s"'<>]+$/.test(url)) { toast("That link should start with https://", "info"); return; }
      if (await savePiece(p.id, { draftUrl: url })) { m.close(); toast("Saved.", "success"); }
    });
  }

  async function editSection(s) {
    let staff = [];
    try { staff = await loadStaff(); } catch {}
    const body = el("form", { class: "eh-form" });
    body.innerHTML = `
      ${field("Section editor", `<select class="input" name="editor"><option value="">Not assigned</option>${staff.map((x) => `<option value="${esc(x.name)}"${sameName(x.name, s.editor?.name) ? " selected" : ""}>${esc(x.name)}</option>`).join("")}</select>`)}
      ${field("Drive folder", input("driveUrl", s.driveUrl || "", 'type="url" placeholder="https://drive.google.com/…"'), "Where this section's drafts go. Writers get a button to it.")}`;
    const m = openModal({ title: `${s.name}`, body, footer: [
      el("button", { type: "button", class: "btn btn-secondary", onclick: () => m.close() }, "Cancel"),
      el("button", { type: "button", class: "btn btn-primary", onclick: () => body.requestSubmit() }, "Save"),
    ] });
    body.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(body);
      const pick = staff.find((x) => x.name === fd.get("editor"));
      const url = String(fd.get("driveUrl") || "").trim();
      if (url && !/^https:\/\/[^\s"'<>]+$/.test(url)) { toast("That link should start with https://", "info"); return; }
      const sections = (hub.sections || []).map((x) => x.id !== s.id ? x : { ...x, driveUrl: url, editor: pick ? { name: pick.name, slug: pick.slug, uids: pick.uids } : null });
      const editorUids = [...new Set(sections.flatMap((x) => x.editor?.uids || []))];
      if (await saveHub({ sections, editorUids })) { m.close(); toast("Saved.", "success"); }
    });
  }

  function editDates() {
    const rows = (hub.dates || []).map((d) => ({ ...d }));
    const body = el("form", { class: "eh-form" });
    const paint = () => {
      body.innerHTML = rows.map((d, i) => `
        <fieldset class="eh-fs"><legend>${esc(d.label || `Date ${i + 1}`)}</legend>
          <div class="eh-f-row">
            ${field("Date", input(`date-${i}`, d.date, 'type="date" required'))}
            ${field("Until (optional)", input(`end-${i}`, d.end || "", 'type="date"'))}
            <label class="eh-inline-check eh-f"><input type="checkbox" name="hard-${i}" ${d.hard ? "checked" : ""}> Hard deadline</label>
          </div>
          ${field("What happens", input(`label-${i}`, d.label, 'maxlength="120" required'))}
          ${field("Who", input(`who-${i}`, d.who || "", 'maxlength="80"'))}
          ${field("Details", area(`detail-${i}`, d.detail || "", 2))}
          <button type="button" class="btn btn-ghost btn-xs" data-rm="${i}">Remove</button>
        </fieldset>`).join("") + `<button type="button" class="btn btn-secondary btn-sm" data-add-date>${ICON.plus} Add a date</button>`;
    };
    const read = () => rows.forEach((d, i) => {
      const g = (n) => body.querySelector(`[name="${n}-${i}"]`);
      Object.assign(d, { date: g("date")?.value || d.date, end: g("end")?.value || "", hard: !!g("hard")?.checked, label: g("label")?.value.trim() || "", who: g("who")?.value.trim() || "", detail: g("detail")?.value.trim() || "" });
      if (!d.end) delete d.end;
    });
    paint();
    body.addEventListener("click", (e) => {
      if (e.target.closest("[data-add-date]")) { read(); rows.push({ id: `d${Date.now().toString(36)}`, date: "", label: "", who: "", detail: "", hard: false }); paint(); }
      const rm = e.target.closest("[data-rm]");
      if (rm) { read(); rows.splice(Number(rm.dataset.rm), 1); paint(); }
    });
    const m = openModal({ title: "Key dates", body, size: "wide", footer: [
      el("button", { type: "button", class: "btn btn-secondary", onclick: () => m.close() }, "Cancel"),
      el("button", { type: "button", class: "btn btn-primary", onclick: () => body.requestSubmit() }, "Save dates"),
    ] });
    body.addEventListener("submit", async (e) => {
      e.preventDefault(); read();
      const clean = rows.filter((d) => d.date && d.label).sort((a, b) => a.date.localeCompare(b.date));
      const launch = clean.find((d) => d.id === "launch")?.date || hub.launch;
      if (await saveHub({ dates: clean, launch })) { m.close(); toast("Dates saved.", "success"); }
    });
  }

  function editMessage(id) {
    const msg = messages.find((x) => x.id === id);
    if (!msg) return;
    const body = el("form", { class: "eh-form" });
    body.innerHTML = field("Your post", area("text", msg.text, 5));
    const m = openModal({ title: "Edit post", body, footer: [
      el("button", { type: "button", class: "btn btn-secondary", onclick: () => m.close() }, "Cancel"),
      el("button", { type: "button", class: "btn btn-primary", onclick: () => body.requestSubmit() }, "Save"),
    ] });
    body.addEventListener("submit", async (e) => {
      e.preventDefault();
      const text = String(new FormData(body).get("text") || "").trim();
      if (!text || !canWrite()) return;
      try { await updateDoc(doc(db, "edition_hub", EDITION, "messages", id), { text: text.slice(0, 4000), editedAt: new Date().toISOString() }); m.close(); }
      catch { toast("Couldn't save.", "error"); }
    });
  }

  function composeModal({ pieceId = "", sectionId = "", kind = "question", prefill = "" }) {
    let m = null;
    const box = composer({ pieceId, sectionId, kind, prefill, choose: !pieceId, compact: true, onSent: () => m?.close() });
    const p = pieces.find((x) => x.id === pieceId);
    m = openModal({ title: p ? `${KIND[kind].verb}: ${p.title.length > 48 ? `${p.title.slice(0, 46)}…` : p.title}` : KIND[kind].verb, body: box });
    setTimeout(() => box.querySelector("textarea")?.focus(), 30);
  }

  // ── one click handler for the whole page
  root.addEventListener("click", async (e) => {
    const t = e.target.closest("button, a, input");
    if (!t || !root.contains(t)) return;
    const d = t.dataset;
    if (d.go) { go({ tab: d.go, piece: null }); return; }
    if (d.piece) { go({ piece: d.piece, pieceTab: d.ptabGo === "talk" ? "talk" : "proposal" }); return; }
    if (d.ptab) { view.pieceTab = d.ptab; go({}); return; }
    if (d.filter) { view.filter = d.filter; if (d.clear !== undefined) view.q = ""; render(); return; }
    if (d.tfilter) { view.talkFilter = d.tfilter; render(); return; }
    if (d.ask) { composeModal({ pieceId: d.ask, kind: "question" }); return; }
    if (d.compose) { composeModal({ pieceId: d.for, kind: d.compose }); return; }
    if (d.pitch) { const s = section(d.pitch); composeModal({ sectionId: d.pitch, kind: "question", prefill: `I'd like to pitch for an open slot in ${s?.name || "this section"}. My idea: ` }); return; }
    if (d.reply) { openReplies.add(d.reply); openReply(d.reply); return; }
    if (d.resolve) { resolve(d.resolve, d.val === "1"); return; }
    if (d.editMsg) { editMessage(d.editMsg); return; }
    if (d.delMsg) {
      if (!(await confirmDialog("Delete this post? Replies to it will lose their question.", { confirmText: "Delete", danger: true }))) return;
      if (!canWrite()) return;
      try { await deleteDoc(doc(db, "edition_hub", EDITION, "messages", d.delMsg)); } catch { toast("Couldn't delete it.", "error"); }
      return;
    }
    if (d.copy !== undefined && t.tagName === "BUTTON") {
      try { await navigator.clipboard.writeText(d.copy); toast("Copied.", "success", 1600); } catch { toast("Couldn't copy. Select the text instead.", "info"); }
      return;
    }
    if (d.editPiece) { editPiece(pieces.find((x) => x.id === d.editPiece)); return; }
    if (d.addPiece) { editPiece(null, { isNew: true, sectionId: d.addPiece }); return; }
    if (d.editMine) { editMine(pieces.find((x) => x.id === d.editMine)); return; }
    if (d.editProposal) { editProposal(pieces.find((x) => x.id === d.editProposal)); return; }
    if (d.editIv) { editInterviews(pieces.find((x) => x.id === d.editIv)); return; }
    if (d.editSteps) { editSteps(pieces.find((x) => x.id === d.editSteps)); return; }
    if (d.draftLink) { editDraftLink(pieces.find((x) => x.id === d.draftLink)); return; }
    if (d.editSection !== undefined && d.editSection) { editSection(section(d.editSection)); return; }
    if (d.editDates !== undefined) { editDates(); return; }
    if (d.stage && d.pieceId) {
      const p = pieces.find((x) => x.id === d.pieceId);
      if (!p || p.status === d.stage) return;
      const label = STAGES[STAGE_INDEX[d.stage]].label;
      savePiece(p.id, { status: d.stage }, { note: `Moved this piece to “${label}”.` });
      return;
    }
  });
  root.addEventListener("change", (e) => {
    const t = e.target;
    if (t.matches("[data-toggle-notes]")) { view.showNotes = t.checked; root.querySelector(".eh-prop")?.classList.toggle("hide-notes", !t.checked); return; }
    if (t.matches("[data-step]")) {
      const p = pieces.find((x) => x.id === t.dataset.pieceId);
      if (!p) return;
      const steps = (p.nextSteps || []).map((s) => s.id === t.dataset.step ? { ...s, done: t.checked } : s);
      savePiece(p.id, { nextSteps: steps });
      return;
    }
    if (t.matches("[data-todo]") || t.matches("[data-decision]")) {
      const isTodo = t.matches("[data-todo]");
      const key = isTodo ? "editorTodos" : "decisions";
      const id = isTodo ? t.dataset.todo : t.dataset.decision;
      const list = (hub[key] || []).map((x) => x.id === id ? { ...x, [isTodo ? "done" : "resolved"]: t.checked } : x);
      saveHub({ [key]: list });
    }
  });

  // Back/forward: the hash changes, so the Suite re-mounts this page, which
  // reads the URL and paints from the cache at once.

  // Re-open reply boxes after a live re-render.
  const mo = new MutationObserver(() => { openReplies.forEach((id) => { const slot = root.querySelector(`[data-reply-slot="${CSS.escape(id)}"]`); if (slot && !slot.firstChild && drafts.get(`r:${id}`)) openReply(id); }); });
  mo.observe(root, { childList: true });

  render();

  return () => {
    unsubs.forEach((u) => { try { u(); } catch {} });
    clearInterval(heroTimer);
    mo.disconnect();
    container.classList.remove("eh-content");
  };
}

// ── styles
function injectStyle() {
  if (document.getElementById("eh-style")) return;
  const s = document.createElement("style");
  s.id = "eh-style";
  s.textContent = `
.eh { --eh-gap: 28px; max-width: 1180px; margin: 0 auto; padding-bottom: 64px; color: var(--ink); }
.eh .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.eh-muted { color: var(--muted); font-weight: 400; }
.eh-link { background: none; border: 0; padding: 0; font: inherit; color: var(--ink); text-decoration: underline; text-decoration-color: color-mix(in srgb, var(--ink) 30%, transparent); text-underline-offset: 3px; cursor: pointer; text-align: left; }
.eh-link:hover { text-decoration-color: var(--ink); }
.eh button:focus-visible, .eh a:focus-visible, .eh input:focus-visible, .eh select:focus-visible, .eh textarea:focus-visible, .eh summary:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }

/* hero */
.eh-hero { display: grid; grid-template-columns: minmax(0, 1.55fr) minmax(280px, 1fr); gap: 40px; align-items: stretch; padding: 34px 0 30px; border-bottom: 1px solid var(--hairline); }
.eh-kicker { margin: 0 0 14px; font: 600 11px/1 var(--font); letter-spacing: .16em; text-transform: uppercase; color: var(--muted); }
.eh-theme { margin: 0; font: 600 clamp(30px, 4.2vw, 50px)/1.06 var(--serif); letter-spacing: -0.02em; color: var(--ink); text-wrap: balance; }
.eh-blank { display: inline-block; min-width: 4.2em; border-bottom: 3px solid var(--ink); padding: 0 .08em; margin: 0 .04em; line-height: 1.02; vertical-align: baseline; font-style: italic; }
.eh-blank-word { display: inline-block; opacity: 0; transform: translateY(6px); transition: opacity .26s var(--ease-out), transform .26s var(--ease-out); white-space: nowrap; }
.eh-blank-word.is-in { opacity: 1; transform: none; }
.eh-intro { margin: 18px 0 0; max-width: 62ch; font: 400 15.5px/1.65 var(--serif); color: var(--ink-2); }
.eh-facts { display: flex; flex-wrap: wrap; gap: 8px 22px; margin: 20px 0 0; padding: 0; list-style: none; font-size: 13px; color: var(--muted); }
.eh-facts strong { color: var(--ink); font-weight: 600; }
.eh-next { position: relative; display: flex; flex-direction: column; justify-content: center; padding: 26px 26px 22px; border-radius: var(--radius-lg); background: var(--ink); color: var(--surface-2); box-shadow: var(--shadow-lg); overflow: hidden; }
.eh-next::after { content: ""; position: absolute; inset: auto -40px -60px auto; width: 200px; height: 200px; border: 1px solid rgba(248,247,243,.08); transform: rotate(30deg); clip-path: polygon(25% 6%, 75% 6%, 100% 50%, 75% 94%, 25% 94%, 0 50%); pointer-events: none; }
.eh-next-label { margin: 0; font: 600 10.5px/1 var(--font); letter-spacing: .16em; text-transform: uppercase; color: rgba(248,247,243,.62); }
.eh-next-days { display: flex; align-items: baseline; gap: 8px; margin: 10px 0 2px; }
.eh-next-days .n { font: 600 64px/0.95 var(--serif); letter-spacing: -0.03em; font-variant-numeric: tabular-nums; }
.eh-next-days .u { font-size: 15px; color: rgba(248,247,243,.7); }
.eh-next-what { margin: 6px 0 0; font: 600 17px/1.3 var(--font); letter-spacing: -0.01em; }
.eh-next-date { margin: 4px 0 0; font-size: 13px; color: rgba(248,247,243,.72); display: flex; flex-wrap: wrap; gap: 6px 8px; align-items: center; }
.eh-next .eh-hard { background: rgba(248,247,243,.14); color: var(--surface-2); }
.eh-hard { display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 999px; background: var(--danger-soft); color: var(--danger); font: 600 10.5px/1.5 var(--font); letter-spacing: .04em; text-transform: uppercase; }
.eh-now { display: inline-flex; padding: 2px 8px; border-radius: 999px; background: var(--info-soft); color: var(--info); font: 600 10.5px/1.5 var(--font); letter-spacing: .04em; text-transform: uppercase; }
.eh-track { position: relative; height: 4px; margin: 34px 4px 8px; border-radius: 99px; background: rgba(248,247,243,.16); }
.eh-track-fill { position: absolute; inset: 0 auto 0 0; border-radius: inherit; background: rgba(248,247,243,.7); }
.eh-track-dot { position: absolute; top: 50%; width: 9px; height: 9px; margin: -4.5px 0 0 -4.5px; border-radius: 50%; background: var(--ink); border: 2px solid rgba(248,247,243,.75); }
.eh-track-dot.is-hard { border-color: #f2b8b0; }
.eh-track-dot.is-past { background: rgba(248,247,243,.75); }
.eh-track-now { position: absolute; top: -26px; transform: translateX(-50%); font: 600 10px/1 var(--font); letter-spacing: .08em; text-transform: uppercase; color: var(--surface-2); }
.eh-track-now::after { content: ""; position: absolute; left: 50%; top: 14px; width: 1px; height: 16px; background: var(--surface-2); }
.eh-track-ends { display: flex; justify-content: space-between; font-size: 11px; color: rgba(248,247,243,.55); }

/* tabs */
.eh-piece-mode .eh-tabs { margin-top: 18px; }
.eh-tabs { position: sticky; top: var(--top-h, 72px); z-index: 5; display: flex; gap: 4px; margin: 0 0 var(--eh-gap); padding: 10px 0; background: color-mix(in srgb, var(--surface-2) 92%, transparent); -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px); border-bottom: 1px solid var(--hairline-2); overflow-x: auto; scrollbar-width: none; }
.eh-tabs::-webkit-scrollbar { display: none; }
.eh-tab { display: inline-flex; align-items: center; gap: 8px; min-height: 44px; padding: 0 16px; border: 0; border-radius: 999px; background: none; color: var(--ink-2); font: 500 14px/1 var(--font); white-space: nowrap; cursor: pointer; transition: background .15s, color .15s; }
.eh-tab:hover { background: rgba(15,23,42,.05); color: var(--ink); }
.eh-tab.is-active { background: var(--ink); color: var(--surface-2); }
.eh-tab-n { display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 99px; background: rgba(15,23,42,.07); color: var(--ink-2); font: 600 11px/1.4 var(--font); }
.eh-tab.is-active .eh-tab-n { background: rgba(248,247,243,.18); color: var(--surface-2); }
.eh-tab-n.is-alert { background: var(--warn-soft); color: var(--warn); }
.eh-tab.is-active .eh-tab-n.is-alert { background: #f6ecd8; color: var(--warn); }

/* blocks */
.eh-block { padding: 0 0 var(--eh-gap); margin: 0 0 var(--eh-gap); border-bottom: 1px solid var(--hairline); }
.eh-block:last-child { border-bottom: 0; }
.eh-bh { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: baseline; gap: 6px 16px; margin: 0 0 16px; }
.eh-bh h2 { margin: 0; font: 600 22px/1.2 var(--serif); letter-spacing: -0.015em; }
.eh-bh p { grid-column: 1 / -1; margin: 0; color: var(--muted); font-size: 13.5px; max-width: 70ch; }
.eh-h3 { margin: 0 0 12px; font: 600 11px/1.2 var(--font); letter-spacing: .14em; text-transform: uppercase; color: var(--muted); }
.eh-ov-grid { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr); gap: 48px; }
.eh-ov-grid > .eh-block { border-bottom: 0; }

/* people */
.eh-av { display: inline-flex; flex: none; align-items: center; justify-content: center; overflow: hidden; }
.eh-av img { width: 100%; height: 100%; object-fit: contain; }
.eh-av-init { background: var(--ink); color: var(--surface-2); font-weight: 600; letter-spacing: .02em; clip-path: polygon(25% 5%, 75% 5%, 100% 50%, 75% 95%, 25% 95%, 0 50%); }
.eh-person { display: inline-flex; align-items: center; gap: 10px; font-size: 13.5px; font-weight: 500; color: var(--ink); line-height: 1.25; }
.eh-person small { display: block; font: 500 10.5px/1.3 var(--font); letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
.eh-person.sm { gap: 6px; font-size: 12.5px; color: var(--ink-2); }

/* for you */
.eh-foryou { padding-bottom: 32px; }
.eh-fy-group + .eh-fy-group { margin-top: 26px; }
.eh-fy-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px; }
.eh-fy-card { display: flex; flex-direction: column; gap: 10px; padding: 20px 20px 16px; border: 1px solid var(--hairline); border-radius: var(--radius); background: var(--surface); box-shadow: var(--shadow-sm); }
.eh-fy-kicker { margin: 0; font: 600 10.5px/1.3 var(--font); letter-spacing: .12em; text-transform: uppercase; color: var(--muted); }
.eh-fy-title { margin: 0; font: 600 18px/1.3 var(--serif); letter-spacing: -0.01em; }
.eh-fy-title .eh-link { text-decoration: none; }
.eh-fy-title .eh-link:hover { text-decoration: underline; }
.eh-fy-meta { display: flex; flex-wrap: wrap; gap: 6px; }
.eh-fy-next { margin: 2px 0 0; padding: 10px 12px; border-radius: var(--radius-sm); background: var(--surface-3); font-size: 13px; line-height: 1.5; color: var(--ink-2); }
.eh-fy-next span { display: block; margin-bottom: 2px; font: 600 10.5px/1.3 var(--font); letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
.eh-fy-next.is-done { background: var(--good-soft); color: var(--good); }
.eh-fy-foot { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; margin-top: auto; padding-top: 6px; }
.eh-fy-actions { display: inline-flex; gap: 8px; }
.eh-fy-social { margin: 0; font-size: 14px; color: var(--ink-2); }
.eh-glance { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 0; margin: 0 0 var(--eh-gap); padding: 0; list-style: none; border-top: 1px solid var(--hairline); border-bottom: 1px solid var(--hairline); }
.eh-glance li { padding: 18px 18px 16px 0; }
.eh-glance li + li { padding-left: 18px; border-left: 1px solid var(--hairline-2); }
.eh-glance strong { display: block; font: 600 34px/1 var(--serif); letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
.eh-glance span { display: block; margin-top: 6px; font-size: 12.5px; color: var(--muted); }

/* mini stepper */
.eh-mini { display: flex; gap: 3px; margin: 0; padding: 0; list-style: none; }
.eh-mini li { flex: 1; height: 4px; border-radius: 99px; background: var(--paper-3); }
.eh-mini li.is-done { background: var(--ink-2); }
.eh-mini li.is-now { background: var(--ink); box-shadow: 0 0 0 2px color-mix(in srgb, var(--ink) 18%, transparent); }

/* pills + flags */
.eh-pill { display: inline-flex; align-items: center; min-height: 24px; padding: 0 10px; border-radius: 999px; border: 1px solid var(--hairline); background: var(--surface); font: 600 11.5px/1 var(--font); color: var(--ink-2); white-space: nowrap; }
.eh-pill[data-stage="idea"] { border-style: dashed; color: var(--muted); }
.eh-pill[data-stage="draft1"], .eh-pill[data-stage="editing"] { background: var(--info-soft); border-color: transparent; color: var(--info); }
.eh-pill[data-stage="final"], .eh-pill[data-stage="ready"] { background: var(--good-soft); border-color: transparent; color: var(--good); }
.eh-pill.is-open { border-style: dashed; border-color: var(--warn); color: var(--warn); background: none; }
.eh-pill.is-held { color: var(--muted); }
.eh-flag { display: inline-flex; align-items: center; min-height: 24px; padding: 0 9px; border-radius: 999px; font: 600 11px/1 var(--font); white-space: nowrap; }
.eh-flag.is-danger { background: var(--danger-soft); color: var(--danger); }
.eh-flag.is-warn { background: var(--warn-soft); color: var(--warn); }
.eh-flag.is-info { background: var(--info-soft); color: var(--info); }
.eh-flag.is-muted { background: var(--surface-3); color: var(--muted); }
.eh-you { display: inline-flex; vertical-align: 2px; padding: 1px 7px; border-radius: 99px; background: var(--ink); color: var(--surface-2); font: 600 10px/1.5 var(--font); letter-spacing: .06em; text-transform: uppercase; }
.eh-fmt { font-size: 12px; color: var(--muted); }
.eh-fmt::before { content: "\\00b7"; margin: 0 8px 0 2px; }

/* dates */
.eh-dl { margin: 0; padding: 0; list-style: none; }
.eh-d { display: grid; grid-template-columns: 54px minmax(0, 1fr); gap: 16px; padding: 16px 0; border-top: 1px solid var(--hairline-2); }
.eh-d:first-child { border-top: 0; padding-top: 4px; }
.eh-d-cal { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 58px; border-radius: 12px; border: 1px solid var(--hairline); background: var(--surface); }
.eh-d-cal .m { font: 600 10px/1 var(--font); letter-spacing: .12em; text-transform: uppercase; color: var(--muted); }
.eh-d-cal .d { margin-top: 4px; font: 600 22px/1 var(--serif); font-variant-numeric: tabular-nums; }
.eh-d.is-hard .eh-d-cal { border-color: color-mix(in srgb, var(--danger) 40%, transparent); }
.eh-d.is-next .eh-d-cal, .eh-d.is-now .eh-d-cal { background: var(--ink); border-color: var(--ink); color: var(--surface-2); }
.eh-d.is-next .eh-d-cal .m, .eh-d.is-now .eh-d-cal .m { color: rgba(248,247,243,.7); }
.eh-d.is-past { opacity: .5; }
.eh-d-when { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; margin: 0; font-size: 12.5px; color: var(--muted); }
.eh-d-label { margin: 3px 0 0; font: 600 16px/1.35 var(--font); letter-spacing: -0.01em; }
.eh-d-detail { margin: 4px 0 0; font-size: 13.5px; line-height: 1.55; color: var(--ink-2); }
.eh-d-who { margin: 6px 0 0; font: 600 11px/1.3 var(--font); letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }

/* progress */
.eh-bar { display: flex; gap: 3px; height: 14px; margin: 4px 0 14px; }
.eh-bar-seg { border-radius: 4px; background: var(--seg); min-width: 8px; }
[data-stage="idea"] { --seg: #d9d5ca; } [data-stage="proposal"] { --seg: #b9b3a5; } [data-stage="reporting"] { --seg: #8f97a5; } [data-stage="drafting"] { --seg: #5b6678; }
[data-stage="draft1"] { --seg: #2e5a87; } [data-stage="editing"] { --seg: #24476b; } [data-stage="final"] { --seg: #2f6b4f; } [data-stage="ready"] { --seg: #0f172a; }
.eh-legend { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px 16px; margin: 0 0 22px; padding: 0; list-style: none; font-size: 12.5px; color: var(--ink-2); }
.eh-legend li { display: flex; align-items: center; gap: 8px; }
.eh-legend li strong { margin-left: auto; font-variant-numeric: tabular-nums; }
.eh-legend li.is-zero { color: var(--muted-2); }
.eh-legend .sw { width: 10px; height: 10px; border-radius: 3px; background: var(--seg); }
.eh-attn-list { margin: 0; padding: 0; list-style: none; }
.eh-attn-list li { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; padding: 9px 0; border-top: 1px solid var(--hairline-2); font-size: 13.5px; }
.eh-attn-list li:first-child { border-top: 0; }

/* guidance */
.eh-guide-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 30px 48px; }
.eh-ticks { margin: 0; padding: 0; list-style: none; }
.eh-ticks li { position: relative; padding: 0 0 10px 24px; font-size: 14px; line-height: 1.6; color: var(--ink-2); }
.eh-ticks li::before { content: ""; position: absolute; left: 2px; top: 8px; width: 10px; height: 6px; border-left: 2px solid var(--ink); border-bottom: 2px solid var(--ink); transform: rotate(-45deg); }
.eh-fb { margin: 0; padding: 0; list-style: none; counter-reset: fb; }
.eh-fb li { counter-increment: fb; position: relative; padding: 0 0 12px 34px; font-size: 14px; line-height: 1.6; color: var(--ink-2); }
.eh-fb li::before { content: counter(fb); position: absolute; left: 0; top: 1px; width: 22px; height: 22px; border-radius: 50%; border: 1px solid var(--hairline); display: grid; place-items: center; font: 600 11px/1 var(--font); color: var(--ink); }
.eh-fb strong { color: var(--ink); }
.eh-where { margin: 0; display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 8px 16px; font-size: 14px; line-height: 1.55; }
.eh-where dt { font-weight: 600; }
.eh-where dd { margin: 0; color: var(--ink-2); }
.eh-drive { display: flex; flex-wrap: wrap; gap: 6px; margin: 14px 0 0; }

/* editors' desk */
.eh-desk-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px 48px; }
.eh-checks { margin: 0; padding: 0; list-style: none; }
.eh-checks li + li { margin-top: 2px; }
.eh-check { display: flex; align-items: flex-start; gap: 12px; min-height: 44px; padding: 10px 8px; margin: 0 -8px; border-radius: 10px; cursor: pointer; font-size: 14px; line-height: 1.5; color: var(--ink-2); }
.eh-check:hover { background: rgba(15,23,42,.04); }
.eh-check input { position: absolute; opacity: 0; width: 1px; height: 1px; }
.eh-check .box { flex: none; display: grid; place-items: center; width: 20px; height: 20px; margin-top: 1px; border-radius: 6px; border: 1.5px solid color-mix(in srgb, var(--ink) 35%, transparent); background: var(--surface); color: transparent; transition: background .15s, border-color .15s; }
.eh-check.is-done .box { background: var(--ink); border-color: var(--ink); color: var(--surface-2); }
.eh-check.is-done .txt { color: var(--muted); text-decoration: line-through; text-decoration-color: color-mix(in srgb, var(--muted) 60%, transparent); }
.eh-check input:focus-visible + .box { outline: 2px solid var(--ink); outline-offset: 2px; }
.eh-check input:disabled ~ .txt { cursor: default; }
.eh-check:has(input:disabled) { cursor: default; }
.eh-check:has(input:disabled):hover { background: none; }

/* sections */
.eh-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin: 0 0 22px; }
.eh-search { position: relative; flex: 1 1 280px; display: flex; align-items: center; }
.eh-search svg { position: absolute; left: 14px; color: var(--muted); pointer-events: none; }
.eh-search input { width: 100%; min-height: 44px; padding: 0 14px 0 40px; border: 1px solid var(--hairline); border-radius: 999px; background: var(--surface); font: 400 14px var(--font); color: var(--ink); }
.eh-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.eh-chip { min-height: 38px; padding: 0 14px; border: 1px solid var(--hairline); border-radius: 999px; background: var(--surface); font: 500 13px/1 var(--font); color: var(--ink-2); cursor: pointer; }
.eh-chip span { margin-left: 4px; color: var(--muted); font-weight: 600; }
.eh-chip:hover { border-color: color-mix(in srgb, var(--ink) 30%, transparent); }
.eh-chip.is-on { background: var(--ink); border-color: var(--ink); color: var(--surface-2); }
.eh-chip.is-on span { color: rgba(248,247,243,.7); }
.eh-sec { padding: 6px 0 30px; margin-bottom: 30px; border-bottom: 1px solid var(--hairline); scroll-margin-top: 140px; }
.eh-sec-head { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 8px 20px; align-items: end; }
.eh-sec-num { font: 600 44px/0.9 var(--serif); color: color-mix(in srgb, var(--ink) 18%, transparent); font-variant-numeric: tabular-nums; }
.eh-sec-kicker { margin: 0 0 4px; font: 500 11px/1 var(--font); letter-spacing: .12em; text-transform: uppercase; color: var(--muted); }
.eh-sec-name { margin: 0; font: 600 28px/1.1 var(--serif); letter-spacing: -0.02em; }
.eh-sec-count { margin: 6px 0 0; font-size: 12.5px; color: var(--muted); }
.eh-sec-editor { display: flex; flex-direction: column; align-items: flex-end; gap: 8px; }
.eh-sec-actions { display: inline-flex; gap: 4px; }
.eh-sec-about { margin: 16px 0 6px; }
.eh-sec-about summary { display: inline-flex; align-items: center; gap: 6px; min-height: 36px; cursor: pointer; font-size: 13px; font-weight: 500; color: var(--ink-2); list-style: none; }
.eh-sec-about summary::-webkit-details-marker { display: none; }
.eh-sec-about summary::after { content: ""; width: 7px; height: 7px; border-right: 1.6px solid currentColor; border-bottom: 1.6px solid currentColor; transform: rotate(45deg) translateY(-2px); transition: transform .2s; }
.eh-sec-about[open] summary::after { transform: rotate(225deg) translateY(-1px); }
.eh-sec-about p { margin: 6px 0 0; max-width: 78ch; font: 400 15px/1.65 var(--serif); color: var(--ink-2); }
.eh-belongs { padding: 12px 14px; border-left: 2px solid var(--ink); background: var(--surface-3); border-radius: 0 10px 10px 0; font-family: var(--font) !important; font-size: 13.5px !important; }
.eh-rows { margin: 10px 0 0; padding: 0; list-style: none; }
.eh-row { position: relative; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px 20px; align-items: center; padding: 16px 12px; margin: 0 -12px; border-top: 1px solid var(--hairline-2); border-radius: 12px; transition: background .15s; }
.eh-row:first-child { border-top-color: transparent; }
.eh-row:hover { background: rgba(15,23,42,.035); }
.eh-row:hover + .eh-row { border-top-color: transparent; }
.eh-row-hit { position: absolute; inset: 0; border: 0; background: none; border-radius: inherit; cursor: pointer; }
.eh-row-hit:focus-visible { outline: 2px solid var(--ink); outline-offset: -2px; }
.eh-row-main, .eh-row-side { position: relative; pointer-events: none; }
.eh-row-side .btn { pointer-events: auto; }
.eh-row-title { margin: 0; font: 600 16px/1.35 var(--serif); letter-spacing: -0.005em; }
.eh-row-sub { margin: 4px 0 0; font-size: 13px; line-height: 1.5; color: var(--muted); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; max-width: 80ch; }
.eh-row-by { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 14px; margin: 8px 0 0; }
.eh-row-side { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 8px; }
.eh-count { display: inline-flex; align-items: center; gap: 4px; font: 600 12px/1 var(--font); color: var(--muted); }
.eh-row-go { display: inline-flex; color: var(--muted-2); transition: transform .2s var(--ease-out), color .2s; }
.eh-row:hover .eh-row-go { color: var(--ink); transform: translateX(3px); }
.eh-row.is-mine { background: color-mix(in srgb, var(--ink) 3%, transparent); }
.eh-row.is-open { border: 1.5px dashed color-mix(in srgb, var(--warn) 45%, transparent); background: color-mix(in srgb, var(--warn-soft) 40%, transparent); margin: 10px -12px 0; }
.eh-row.is-open + .eh-row { border-top-color: transparent; }
.eh-row.is-open .eh-row-main { pointer-events: auto; }
.eh-row.is-empty { color: var(--muted); font-size: 13.5px; grid-template-columns: 1fr; }
.eh-add { margin: 10px 0 0; }
.eh-held { margin-top: 6px; }
.eh-held > summary { min-height: 44px; display: flex; align-items: center; cursor: pointer; font: 600 14px var(--font); }

/* piece */
.eh-back { display: inline-flex; align-items: center; gap: 6px; min-height: 40px; padding: 0 12px 0 8px; margin: 0 0 14px -8px; border: 0; border-radius: 99px; background: none; font: 500 13px var(--font); color: var(--ink-2); cursor: pointer; }
.eh-back:hover { background: rgba(15,23,42,.05); color: var(--ink); }
.eh-ph { padding: 0 0 22px; }
.eh-ph-kicker { margin: 0 0 10px; font: 600 11px/1.3 var(--font); letter-spacing: .14em; text-transform: uppercase; color: var(--muted); }
.eh-ph-title { margin: 0; max-width: 34ch; font: 600 clamp(26px, 3.4vw, 40px)/1.12 var(--serif); letter-spacing: -0.02em; text-wrap: balance; }
.eh-ph-sub { margin: 12px 0 0; max-width: 70ch; font: 400 17px/1.55 var(--serif); color: var(--ink-2); font-style: italic; }
.eh-ph-people { display: flex; flex-wrap: wrap; gap: 12px 28px; margin: 22px 0 0; }
.eh-placement { display: inline-block; margin: 16px 0 0; padding: 6px 12px; border-radius: 999px; background: var(--surface-3); font-size: 12.5px; color: var(--ink-2); }
.eh-ph-actions { display: flex; flex-wrap: wrap; gap: 8px; margin: 22px 0 0; }
.eh-ph-actions .btn, .eh-fy-actions .btn, .eh-sec-actions .btn { display: inline-flex; align-items: center; gap: 6px; min-height: 40px; }
.eh-stepper { display: grid; grid-template-columns: repeat(8, minmax(0, 1fr)); margin: 6px 0 0; padding: 18px 0 0; list-style: none; border-top: 1px solid var(--hairline); }
.eh-stepper li { position: relative; }
.eh-stepper li::before { content: ""; position: absolute; top: 15px; left: calc(-50% + 18px); right: calc(50% + 18px); height: 2px; background: var(--paper-3); }
.eh-stepper li:first-child::before { display: none; }
.eh-stepper li.is-done::before, .eh-stepper li.is-now::before { background: var(--ink); }
.eh-stepper button, .eh-stepper span[title] { display: flex; flex-direction: column; align-items: center; gap: 8px; width: 100%; min-height: 64px; padding: 0 2px; border: 0; background: none; font: inherit; color: var(--muted); text-align: center; }
.eh-stepper.is-live button { cursor: pointer; border-radius: 12px; }
.eh-stepper.is-live button:hover { background: rgba(15,23,42,.04); color: var(--ink); }
.eh-stepper .dot { position: relative; z-index: 1; display: grid; place-items: center; width: 32px; height: 32px; border-radius: 50%; border: 2px solid var(--paper-3); background: var(--surface-2); font: 600 12px/1 var(--font); color: var(--muted); }
.eh-stepper .lbl { font: 500 11.5px/1.25 var(--font); }
.eh-stepper li.is-done .dot { background: var(--ink); border-color: var(--ink); color: var(--surface-2); }
.eh-stepper li.is-now .dot { border-color: var(--ink); color: var(--ink); box-shadow: 0 0 0 4px color-mix(in srgb, var(--ink) 12%, transparent); }
.eh-stepper li.is-now .lbl { color: var(--ink); font-weight: 600; }
.eh-stepper-hint { margin: 4px 0 0; font-size: 12px; color: var(--muted); text-align: center; }
.eh-pgrid { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 40px; align-items: start; margin-top: 26px; }
.eh-subtabs { display: flex; gap: 4px; margin: 0 0 22px; border-bottom: 1px solid var(--hairline); }
.eh-subtab { display: inline-flex; align-items: center; gap: 8px; min-height: 46px; padding: 0 14px; margin-bottom: -1px; border: 0; border-bottom: 2px solid transparent; background: none; font: 500 14px var(--font); color: var(--muted); cursor: pointer; }
.eh-subtab:hover { color: var(--ink); }
.eh-subtab.is-on { color: var(--ink); border-bottom-color: var(--ink); font-weight: 600; }
.eh-pside { position: sticky; top: calc(var(--top-h, 72px) + 80px); display: flex; flex-direction: column; gap: 14px; }
.eh-card { padding: 18px 18px 14px; border: 1px solid var(--hairline); border-radius: var(--radius); background: var(--surface); }
.eh-card-quiet { background: var(--surface-3); border-color: transparent; }
.eh-card-h { display: flex; align-items: baseline; justify-content: space-between; margin: 0 0 10px; }
.eh-card-h h3 { margin: 0; font: 600 11px/1.2 var(--font); letter-spacing: .14em; text-transform: uppercase; color: var(--ink); }
.eh-card .eh-check { font-size: 13.5px; }
.eh-card > .btn { margin-top: 8px; display: inline-flex; align-items: center; gap: 6px; }
.eh-meter { height: 4px; margin: 0 0 8px; border-radius: 99px; background: var(--paper-3); overflow: hidden; }
.eh-meter span { display: block; height: 100%; background: var(--ink); border-radius: inherit; transition: width .3s var(--ease-out); }
.eh-dues { margin: 0; padding: 0; list-style: none; }
.eh-dues li { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 0 10px; padding: 9px 0; border-top: 1px solid var(--hairline-2); font-size: 13px; }
.eh-dues li:first-child { border-top: 0; }
.eh-due-l { font-weight: 600; }
.eh-due-d { grid-column: 1; color: var(--muted); font-size: 12.5px; }
.eh-due-n { grid-column: 2; grid-row: 1 / span 2; align-self: center; font: 600 12px var(--font); color: var(--ink-2); }
.eh-dues li.is-soon .eh-due-n { color: var(--warn); }
.eh-dues li.is-late .eh-due-n { color: var(--danger); }
.eh-dues li.is-done .eh-due-n { color: var(--good); }
.eh-block-btn { display: flex !important; justify-content: center; width: 100%; margin-top: 8px; }
.eh-ivs { margin: 0; padding: 0; list-style: none; }
.eh-ivs li { padding: 10px 0; border-top: 1px solid var(--hairline-2); }
.eh-ivs li:first-child { border-top: 0; padding-top: 2px; }
.eh-iv-st { display: inline-flex; padding: 1px 8px; border-radius: 99px; font: 600 10.5px/1.6 var(--font); letter-spacing: .04em; text-transform: uppercase; background: var(--surface-3); color: var(--muted); }
.eh-iv-st.is-done { background: var(--good-soft); color: var(--good); }
.eh-iv-st.is-scheduled { background: var(--info-soft); color: var(--info); }
.eh-iv-st.is-wanted { background: var(--warn-soft); color: var(--warn); }
.eh-iv-who { margin: 6px 0 0; font-weight: 600; font-size: 13.5px; }
.eh-iv-aff, .eh-iv-when { margin: 2px 0 0; font-size: 12.5px; color: var(--muted); }
.eh-iv-note { margin: 4px 0 0; font-size: 12.5px; color: var(--ink-2); font-style: italic; }
.eh-tip { margin: 10px 0 0; font-size: 12.5px; line-height: 1.55; color: var(--muted); }

/* proposal */
.eh-prop-tools { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; margin: 0 0 18px; }
.eh-prop-by { margin: 0; font-size: 13.5px; color: var(--ink-2); }
.eh-prop-ctl { display: inline-flex; align-items: center; gap: 12px; }
.eh-switch { display: inline-flex; align-items: center; gap: 8px; min-height: 40px; font-size: 13px; cursor: pointer; color: var(--ink-2); }
.eh-switch input { position: absolute; opacity: 0; width: 1px; height: 1px; }
.eh-switch .tr { position: relative; width: 34px; height: 20px; border-radius: 99px; background: var(--paper-3); transition: background .2s; }
.eh-switch .tr::after { content: ""; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: var(--surface); box-shadow: 0 1px 2px rgba(15,23,42,.2); transition: transform .2s var(--ease-out); }
.eh-switch input:checked + .tr { background: var(--ink); }
.eh-switch input:checked + .tr::after { transform: translateX(14px); }
.eh-switch input:focus-visible + .tr { outline: 2px solid var(--ink); outline-offset: 2px; }
.eh-pg { padding: 4px 0 18px; margin: 0 0 18px; border-bottom: 1px solid var(--hairline-2); }
.eh-pg:last-child { border-bottom: 0; }
.eh-pg-h { margin: 0 0 14px; font: 600 11px/1.2 var(--font); letter-spacing: .16em; text-transform: uppercase; color: var(--muted); }
.eh-field { margin: 0 0 18px; }
.eh-flabel { margin: 0 0 5px; font: 600 13px/1.3 var(--font); color: var(--ink); }
.eh-ftext { font: 400 15.5px/1.7 var(--serif); color: var(--ink-2); max-width: 72ch; overflow-wrap: anywhere; }
.eh-ftext p { margin: 0 0 8px; }
.eh-ftext p:last-child { margin-bottom: 0; }
.eh-ftext a, .eh-note a, .eh-gnote a, .eh-msg-text a { color: var(--info); }
.eh-ftext.is-key { padding: 14px 16px; border-radius: 12px; background: var(--surface); border: 1px solid var(--hairline); color: var(--ink); }
.eh-ftext.is-blank { font-family: var(--font); font-size: 13px; color: var(--muted-2); font-style: italic; }
.eh-notes { display: flex; flex-direction: column; gap: 8px; margin: 10px 0 0; max-width: 72ch; }
.eh-note { position: relative; padding: 10px 14px 10px 16px; border-left: 3px solid var(--warn); border-radius: 0 10px 10px 0; background: var(--warn-soft); font-size: 13.5px; line-height: 1.6; color: #4a3612; }
.eh-note p { margin: 0 0 6px; } .eh-note p:last-child { margin: 0; }
.eh-note-tag { display: block; margin: 0 0 3px; font: 600 10px/1.3 var(--font); letter-spacing: .1em; text-transform: uppercase; color: var(--warn); }
.eh-prop.hide-notes .eh-notes, .eh-prop.hide-notes .eh-general { display: none; }
.eh-general .eh-gnote { margin: 0 0 12px; padding: 14px 18px; border-radius: 12px; background: var(--surface-3); font: 400 15px/1.65 var(--serif); color: var(--ink-2); }
.eh-gnote p { margin: 0 0 6px; } .eh-gnote p:last-child { margin: 0; }
.eh-noprop { text-align: left; padding: 26px; border: 1.5px dashed var(--hairline); border-radius: var(--radius); }
.eh-noprop h3 { margin: 0 0 6px; font: 600 18px/1.3 var(--serif); }
.eh-noprop p { margin: 0 0 14px; color: var(--ink-2); font-size: 14px; }
.eh-cands { margin: 0 0 16px; }
.eh-cands ul { margin: 4px 0 0; padding-left: 18px; font: 400 15px/1.7 var(--serif); }

/* talk */
.eh-compose { margin: 0 0 18px; padding: 16px; border: 1px solid var(--hairline); border-radius: var(--radius); background: var(--surface); box-shadow: var(--shadow-sm); }
.eh-compose:focus-within { border-color: color-mix(in srgb, var(--ink) 35%, transparent); box-shadow: var(--shadow-md); }
.modal .eh-compose { margin: 0; padding: 0; border: 0; box-shadow: none; background: none; }
.eh-compose-top { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; margin: 0 0 10px; }
.eh-seg { display: inline-flex; padding: 3px; border-radius: 999px; background: var(--surface-3); }
.eh-seg-b { min-height: 36px; padding: 0 14px; border: 0; border-radius: 999px; background: none; font: 500 13px var(--font); color: var(--ink-2); cursor: pointer; }
.eh-seg-b.is-on { background: var(--surface); color: var(--ink); box-shadow: 0 1px 3px rgba(15,23,42,.12); font-weight: 600; }
.eh-about { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; color: var(--muted); }
.eh-about select { min-height: 40px; max-width: min(420px, 62vw); padding: 0 32px 0 12px; border: 1px solid var(--hairline); border-radius: 10px; background-color: var(--surface); font: 500 13px var(--font); color: var(--ink); }
.eh-compose textarea { width: 100%; min-height: 96px; padding: 12px 14px; border: 1px solid var(--hairline); border-radius: 12px; background: var(--surface-2); font: 400 14.5px/1.55 var(--font); color: var(--ink); resize: vertical; }
.eh-compose.is-compact textarea { min-height: 80px; }
.eh-compose-foot { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; margin: 10px 0 0; }
.eh-compose-foot .btn { min-height: 40px; }
.eh-to { margin: 0; font-size: 12.5px; color: var(--ink-2); }
.eh-talk-filters { margin: 0 0 8px; }
.eh-threads { margin: 0; padding: 0; list-style: none; }
.eh-msg { display: grid; grid-template-columns: 40px minmax(0, 1fr); gap: 12px; padding: 18px 0; border-top: 1px solid var(--hairline-2); }
.eh-threads > .eh-msg:first-child { border-top: 0; }
.eh-msg.is-open > .eh-msg-body > .eh-msg-text { }
.eh-msg.is-announce { padding: 18px 16px; margin: 6px 0; border: 0; border-radius: var(--radius); background: var(--ink); color: var(--surface-2); }
.eh-msg.is-announce .eh-msg-head time, .eh-msg.is-announce .eh-msg-ctx, .eh-msg.is-announce .eh-msg-role, .eh-msg.is-announce .eh-muted { color: rgba(248,247,243,.65); }
.eh-msg.is-announce .eh-msg-text { color: var(--surface-2); }
.eh-msg.is-announce .eh-act { color: rgba(248,247,243,.8); }
.eh-msg.is-announce .eh-link { color: var(--surface-2); }
.eh-msg.is-auto .eh-msg-text { font-size: 13.5px; color: var(--muted); font-style: italic; }
.eh-msg-head { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; margin: 0; font-size: 13.5px; }
.eh-msg-role { font-size: 12px; color: var(--muted); }
.eh-msg-head time { margin-left: auto; font-size: 12px; color: var(--muted); }
.eh-kind { display: inline-flex; align-items: center; gap: 4px; padding: 1px 8px; border-radius: 99px; font: 600 10.5px/1.6 var(--font); letter-spacing: .05em; text-transform: uppercase; background: var(--surface-3); color: var(--ink-2); }
.eh-kind.is-question { background: var(--warn-soft); color: var(--warn); }
.eh-kind.is-question.is-resolved { background: var(--good-soft); color: var(--good); }
.eh-kind.is-update { background: var(--info-soft); color: var(--info); }
.eh-kind.is-announcement { background: rgba(248,247,243,.16); color: var(--surface-2); }
.eh-msg-ctx { margin: 2px 0 0; font-size: 12.5px; color: var(--muted); }
.eh-msg-text { margin: 8px 0 0; font-size: 14.5px; line-height: 1.6; color: var(--ink); overflow-wrap: anywhere; max-width: 75ch; }
.eh-msg-text p { margin: 0 0 6px; } .eh-msg-text p:last-child { margin: 0; }
.eh-msg-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 4px; margin: 8px 0 0 -8px; font-size: 12.5px; }
.eh-act { min-height: 34px; padding: 0 8px; border: 0; border-radius: 8px; background: none; font: 500 12.5px var(--font); color: var(--ink-2); cursor: pointer; display: inline-flex; align-items: center; gap: 4px; }
.eh-act:hover { background: rgba(15,23,42,.05); color: var(--ink); }
.eh-act.is-danger:hover { color: var(--danger); background: var(--danger-soft); }
.eh-replies { margin: 12px 0 0; padding: 0 0 0 4px; list-style: none; border-left: 2px solid var(--hairline); }
.eh-msg.is-reply { grid-template-columns: 30px minmax(0, 1fr); gap: 10px; padding: 10px 0 10px 14px; border-top: 0; }
.eh-msg.is-reply .eh-msg-text { margin-top: 4px; font-size: 14px; }
.eh-reply-form { margin: 10px 0 0; }
.eh-reply-form textarea { width: 100%; min-height: 64px; padding: 10px 12px; border: 1px solid var(--hairline); border-radius: 10px; background: var(--surface); font: 400 14px/1.5 var(--font); resize: vertical; }
.eh-reply-foot { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 8px; }
.eh-reply-foot > span { display: inline-flex; gap: 6px; }
.eh-inline-check { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; color: var(--ink-2); cursor: pointer; min-height: 36px; }

/* social */
.eh-copy-list, .eh-lu { margin: 0; padding: 0; list-style: none; }
.eh-copy-list li { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; align-items: start; padding: 12px 0; border-top: 1px solid var(--hairline-2); }
.eh-copy-list li:first-child { border-top: 0; }
.eh-copy-list p { margin: 0; font: 400 14.5px/1.6 var(--serif); color: var(--ink-2); max-width: 80ch; }
.eh-copy-list strong { font-family: var(--font); color: var(--ink); }
.eh-tags { display: flex; flex-wrap: wrap; gap: 8px; margin: 0; }
.eh-tagchip { padding: 6px 12px; border-radius: 99px; border: 1px solid var(--hairline); background: var(--surface); font-size: 13px; }
.eh-lineup { display: grid; gap: 26px; }
.eh-lu-h { margin: 0 0 6px; font: 600 18px/1.2 var(--serif); }
.eh-lu-item { padding: 14px 0; border-top: 1px solid var(--hairline-2); }
.eh-lu-top { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 8px 14px; }
.eh-lu-title { margin: 0; font: 600 15.5px/1.35 var(--serif); }
.eh-lu-by { margin: 4px 0 0; font-size: 12.5px; color: var(--muted); }
.eh-lu-hook, .eh-lu-vis { margin: 8px 0 0; font-size: 13.5px; line-height: 1.55; color: var(--ink-2); max-width: 85ch; }
.eh-lu-hook > span, .eh-lu-vis > span { display: inline-block; min-width: 92px; margin-right: 8px; font: 600 10.5px/1.6 var(--font); letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
.eh-lu-hook .eh-act { min-height: 28px; vertical-align: middle; }

/* forms */
.eh-form { display: flex; flex-direction: column; gap: 14px; }
.eh-f { display: flex; flex-direction: column; gap: 6px; min-width: 0; flex: 1; border: 0; padding: 0; margin: 0; }
.eh-f-l { font: 600 12.5px var(--font); color: var(--ink); }
.eh-f-h { font-size: 12.5px; color: var(--muted); margin: 0; }
.eh-f-row { display: flex; flex-wrap: wrap; gap: 12px; }
.eh-f-row > .eh-f { flex: 1 1 180px; }
.eh-form .input { width: 100%; }
.eh-form textarea.input { resize: vertical; min-height: 64px; }
.eh-fs { border: 1px solid var(--hairline); border-radius: 12px; padding: 14px 14px 10px; margin: 0; display: flex; flex-direction: column; gap: 12px; }
.eh-fs legend { padding: 0 6px; font: 600 11px var(--font); letter-spacing: .12em; text-transform: uppercase; color: var(--muted); }
.eh-fs > .btn { align-self: flex-start; }
.eh-pick { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 4px 12px; max-height: 220px; overflow: auto; padding: 4px 2px; }
.eh-pick-i { display: flex; align-items: center; gap: 8px; min-height: 36px; font-size: 13.5px; cursor: pointer; }
.eh-left { margin-right: auto; }

.eh-empty { padding: 60px 20px; text-align: center; }
.eh-empty h2 { margin: 0 0 8px; font: 600 22px var(--serif); }
.eh-empty p { margin: 0; color: var(--muted); }
.eh-empty.sm { padding: 26px 0; text-align: left; }

@media (max-width: 1080px) {
  .eh-pgrid { grid-template-columns: minmax(0, 1fr); }
  .eh-pside { position: static; display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); }
}
@media (max-width: 960px) {
  .eh-hero { grid-template-columns: minmax(0, 1fr); gap: 26px; padding-top: 18px; }
  .eh-ov-grid, .eh-guide-grid, .eh-desk-grid { grid-template-columns: minmax(0, 1fr); gap: 0; }
  .eh-ov-grid > .eh-block { border-bottom: 1px solid var(--hairline); }
  .eh-guide-grid { gap: 26px; }
  .eh-desk-grid { gap: 20px; }
  .eh-glance { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .eh-glance li:nth-child(3) { padding-left: 0; border-left: 0; }
  .eh-glance li:nth-child(n+3) { border-top: 1px solid var(--hairline-2); }
}
@media (max-width: 720px) {
  .eh { --eh-gap: 22px; }
  .eh-sec-head { grid-template-columns: auto minmax(0, 1fr); }
  .eh-sec-editor { grid-column: 1 / -1; flex-direction: row; flex-wrap: wrap; align-items: center; justify-content: space-between; }
  .eh-sec-num { font-size: 34px; }
  .eh-sec-name { font-size: 24px; }
  .eh-row { grid-template-columns: minmax(0, 1fr); }
  .eh-row-side { justify-content: flex-start; }
  .eh-row-go { display: none; }
  .eh-stepper { grid-template-columns: repeat(4, minmax(0, 1fr)); row-gap: 8px; }
  .eh-stepper li:nth-child(5)::before { display: none; }
  .eh-fy-list { grid-template-columns: minmax(0, 1fr); }
  .eh-next-days .n { font-size: 52px; }
  .eh-legend { grid-template-columns: minmax(0, 1fr); }
  .eh-where { grid-template-columns: minmax(0, 1fr); gap: 2px; }
  .eh-where dd { margin-bottom: 10px; }
  .eh-copy-list li { grid-template-columns: minmax(0, 1fr); }
  .eh-copy-list li .btn { justify-self: start; }
  .eh-msg-head time { margin-left: 0; flex-basis: 100%; }
  .eh-about { flex-basis: 100%; }
  .eh-about select { flex: 1; max-width: none; }
  .eh-tabs { margin-left: -16px; margin-right: -16px; padding-left: 16px; padding-right: 16px; }
}
@media (prefers-reduced-motion: reduce) {
  .eh *, .eh *::before, .eh *::after { transition: none !important; animation: none !important; }
  .eh-blank-word { opacity: 1; transform: none; }
}
`;
  document.head.appendChild(s);
}
