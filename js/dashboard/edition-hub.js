// This edition (#/edition) — the planning hub for the edition in progress.
//
// Built to be calm: a solid page (no seasonal washes or drifting effects
// here), one thing at a time, and the next thing to do always at the top.
//   • Overview   what's next (the next deadline, launch, your next step),
//                your pieces or your section, the timeline, and the editors'
//                guides folded away until you need them
//   • Pieces     the four sections as cards, each with its editor and its
//                pieces; open a piece for its proposal (the editors' notes
//                beside the part they comment on), next steps, interviews
//                and its questions
//   • Questions  everything people have asked or shared; ask, update, reply,
//                mark answered
//   • Social     the lineup with hooks, people to tag and copy-ready lines
//
// Data (Firestore, staff only — see firestore.rules "This edition"):
//   edition_hub/{EDITION}            sections + editors, dates, guidance
//   edition_hub/{EDITION}/pieces     one doc per piece (proposal, notes, status)
//   edition_hub/{EDITION}/messages   questions, updates, replies, announcements
// Seeded from the proposals by scripts/seed-edition-hub.mjs (the data file is
// private, outside git). Posting also calls /api/edition/notify, which rings
// the bell for the piece's writers and section editor.
//
// Who can change what (mirrors the rules): admins anything; section editors
// any piece and the editors' to-dos; a piece's writers its stage,
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
  announcement: { label: "Announcement", verb: "Post to everyone", ph: "Something everyone working on the edition should know." },
};

// Kept between mounts, so coming back (or opening a piece from the bell)
// paints at once while the live listeners catch up.
const cache = { hub: null, pieces: null, messages: null, bios: null, staff: null };

const DAY = 86400000;
const parseDay = (s) => { const [y, m, d] = String(s || "").split("-").map(Number); return y ? new Date(y, m - 1, d) : null; };
const today = () => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); };
const daysUntil = (s) => { const d = parseDay(s); return d ? Math.round((d - today()) / DAY) : null; };
const fmtDay = (s, opts = { weekday: "short", month: "short", day: "numeric" }) => { const d = parseDay(s); return d ? d.toLocaleDateString("en-US", opts) : ""; };
const LONG = { weekday: "long", month: "long", day: "numeric" };
const sameName = (a, b) => !!a && !!b && String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
const firstName = (n) => String(n || "").trim().split(/\s+/)[0] || "Someone";
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const endStop = (t) => (/[.?!]$/.test(String(t)) ? t : `${t}.`);
const inDays = (n) => (n === 0 ? "today" : n === 1 ? "tomorrow" : n === -1 ? "yesterday" : n > 0 ? `in ${n} days` : `${-n} days ago`);
const clip = (t, n) => (String(t).length > n ? `${String(t).slice(0, n - 1)}…` : String(t));

// Escape, keep line breaks, and turn bare links into links.
function rich(text) {
  const safe = esc(text || "");
  const linked = safe.replace(/https?:\/\/[^\s<)]+[^\s<).,;:!?'"]/g, (u) => `<a href="${u}" target="_blank" rel="noopener">${u.replace(/^https?:\/\/(www\.)?/, "").slice(0, 60)}${u.length > 68 ? "…" : ""}</a>`);
  return linked.split(/\n+/).map((p) => `<p>${p}</p>`).join("");
}

const svg = (d, size = 16, sw = 2) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON = {
  back: svg(`<path d="M15 18l-6-6 6-6"/>`),
  chev: svg(`<path d="M9 18l6-6-6-6"/>`, 16),
  down: svg(`<path d="M6 9l6 6 6-6"/>`, 16),
  q: svg(`<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6"/><circle cx="12" cy="17" r=".6" fill="currentColor"/>`, 15),
  note: svg(`<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>`, 15),
  check: svg(`<polyline points="20 6 9 17 4 12"/>`, 13, 2.6),
  edit: svg(`<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>`, 14),
  drive: svg(`<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>`, 15),
  copy: svg(`<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>`, 14),
  search: svg(`<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>`, 16),
  plus: svg(`<path d="M12 5v14M5 12h14"/>`, 15),
  link: svg(`<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>`, 15),
};

export async function mount(ctx, container) {
  injectStyle();
  document.body.classList.add("eh-calm");
  container.classList.add("eh-content");
  const params = new URLSearchParams((location.hash.split("?")[1]) || "");
  const TABS = ["overview", "pieces", "talk", "social"];
  const tabParam = params.get("tab") === "sections" ? "pieces" : params.get("tab");
  const view = {
    tab: TABS.includes(tabParam) ? tabParam : "overview",
    piece: params.get("piece") || null,
    pieceTab: ["talk", "steps"].includes(params.get("view")) ? params.get("view") : "proposal",
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
  const hardDate = (id) => (hub?.dates || []).find((d) => d.id === id);

  function roleLabelFor(uid, name) {
    const ed = (hub?.sections || []).find((s) => s.editor && ((s.editor.uids || []).includes(uid) || sameName(s.editor.name, name)));
    if (ed) return `Editor, ${ed.name}`;
    if (pieces.some((p) => (p.writerUids || []).includes(uid) || (p.writers || []).some((w) => sameName(w.name, name)))) return "Writer";
    return "";
  }

  // Hexagon portrait from the About page, or initials in a hexagon.
  function avatar(person, size = 32) {
    const slug = person?.slug || slugify(person?.name || "");
    const img = bios.get(slug)?.image;
    const s = `width:${size}px;height:${size}px`;
    if (img) return `<span class="eh-av" style="${s}"><img src="${esc(img)}" alt="" loading="lazy" decoding="async"></span>`;
    return `<span class="eh-av eh-av-init" style="${s};font-size:${Math.round(size * 0.34)}px" aria-hidden="true">${esc(initials(person?.name || "?"))}</span>`;
  }
  const names = (people) => (people || []).map((p) => p.name).join(" & ");
  const firstNames = (people) => (people || []).map((p) => firstName(p.name)).join(" & ");

  function stage(p) {
    if (SPECIAL[p.status]) return `<span class="eh-stage is-${p.status}"><i></i>${SPECIAL[p.status]}</span>`;
    const st = STAGES[STAGE_INDEX[p.status] ?? 0];
    return `<span class="eh-stage" data-stage="${esc(st.id)}"><i></i>${esc(st.label)}</span>`;
  }
  const progressPct = (p) => Math.round((((STAGE_INDEX[p.status] ?? 0) + 1) / STAGES.length) * 100);
  // Behind schedule? Compared with the edition's two hard deadlines.
  function flag(p) {
    if (SPECIAL[p.status]) return null;
    const i = STAGE_INDEX[p.status] ?? 0;
    const first = hardDate("first-draft"), fin = hardDate("final-draft");
    if (fin && i < STAGE_INDEX.final) { const n = daysUntil(fin.date); if (n < 0) return { tone: "danger", text: "Final draft overdue" }; if (n <= 5) return { tone: "warn", text: `Final draft due ${inDays(n)}` }; }
    if (first && i < STAGE_INDEX.draft1) { const n = daysUntil(first.date); if (n < 0) return { tone: "danger", text: "First draft overdue" }; if (n <= 7) return { tone: "warn", text: `First draft due ${inDays(n)}` }; }
    if (p.status === "idea") return { tone: "muted", text: "Needs a proposal" };
    return null;
  }
  const noteCount = (p) => Object.values(p.notes || {}).reduce((n, a) => n + (a?.length || 0), 0) + (p.general?.length || 0);

  // ── URL (in-page moves push a history entry without remounting)
  function go(next) {
    Object.assign(view, next);
    const qs = new URLSearchParams();
    if (view.piece) { qs.set("piece", view.piece); if (view.pieceTab !== "proposal") qs.set("view", view.pieceTab); }
    else if (view.tab !== "overview") qs.set("tab", view.tab);
    const hash = `#/edition${qs.toString() ? `?${qs}` : ""}`;
    if (location.hash !== hash) history.pushState(null, "", hash);
    render();
    window.scrollTo({ top: 0 });
  }

  // ── render
  let wordTimer = null;
  function render() {
    if (!hub && !cache.hub) {
      root.innerHTML = `<div class="loading-state"><div class="spinner"></div>Loading the edition&hellip;</div>`;
      return;
    }
    if (!hub) { root.innerHTML = `<div class="eh-empty"><h2>No edition is being planned yet.</h2><p>An admin can set one up.</p></div>`; return; }
    const focus = captureFocus();
    root.innerHTML = "";
    if (view.piece) {
      clearInterval(wordTimer);
      const p = pieces.find((x) => x.id === view.piece);
      root.appendChild(p ? pieceView(p) : el("div", { class: "eh-empty", html: `<h2>That piece isn't in this edition.</h2><p><button type="button" class="btn btn-secondary" data-go="pieces">See all pieces</button></p>` }));
    } else {
      root.appendChild(header());
      const body = el("div", { class: "eh-body" });
      root.appendChild(body);
      if (view.tab === "pieces") body.appendChild(piecesView());
      else if (view.tab === "talk") body.appendChild(talkView());
      else if (view.tab === "social") body.appendChild(socialView());
      else body.appendChild(overviewView());
    }
    restoreFocus(focus);
  }

  // Live updates re-render the page; keep typing where it was.
  const drafts = new Map();   // unsent text, by composer key
  root.addEventListener("input", (e) => { const k = e.target?.dataset?.keep; if (k) drafts.set(k, e.target.value); });
  function captureFocus() {
    const a = document.activeElement;
    if (!a || !root.contains(a) || !a.dataset.keep) return null;
    return { key: a.dataset.keep, value: a.value, start: a.selectionStart, end: a.selectionEnd };
  }
  function restoreFocus(f) {
    if (!f) return;
    const n = root.querySelector(`[data-keep="${CSS.escape(f.key)}"]`);
    if (!n) return;
    n.value = f.value; n.focus();
    try { n.setSelectionRange(f.start, f.end); } catch {}
  }

  // ── page header: the theme, and the four views
  function header() {
    const words = (hub.sections || []).map((s) => s.name);
    const total = realPieces().length;
    const open = openQs(() => true).length;
    const node = el("header", { class: "eh-head" });
    node.innerHTML = `
      <p class="eh-eyebrow">${esc(hub.name)} edition</p>
      <h1 class="eh-title" aria-label="${esc(hub.theme || "The Future of Health is blank.")}">The Future of Health is <span class="eh-blank" aria-hidden="true"><span class="eh-word"></span></span>.</h1>
      <p class="eh-lede">${plural(total, "piece")} in ${plural((hub.sections || []).length, "section")}. Launches ${esc(fmtDay(hub.launch, LONG))}.</p>
      <nav class="eh-seg eh-tabs" aria-label="This edition">
        ${[["overview", "Overview", ""], ["pieces", "Pieces", ""], ["talk", "Questions", open ? String(open) : ""], ["social", "Social", ""]].map(([id, l, n]) => `
          <button type="button" class="eh-seg-b${view.tab === id ? " is-on" : ""}" data-go="${id}" ${view.tab === id ? 'aria-current="page"' : ""}>${l}${n ? `<span class="eh-badge">${n}</span>` : ""}</button>`).join("")}
      </nav>`;
    // The blank fills itself in with each section's name.
    const slot = node.querySelector(".eh-word");
    clearInterval(wordTimer);
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (words.length) {
      let i = 0;
      slot.textContent = words[0];
      slot.classList.add("is-in");
      if (!reduce) {
        wordTimer = setInterval(() => {
          slot.classList.remove("is-in");
          setTimeout(() => { i = (i + 1) % words.length; slot.textContent = words[i]; slot.classList.add("is-in"); }, 280);
        }, 3200);
      }
    }
    return node;
  }

  // ── Overview
  function overviewView() {
    const wrap = el("div", { class: "eh-stack" });
    wrap.appendChild(nextUp());
    const mine = sorted(pieces.filter((p) => isMine(p) && p.section !== "held"));
    if (mine.length) wrap.appendChild(myPieces(mine));
    mySections().forEach((s) => wrap.appendChild(mySection(s)));
    wrap.appendChild(timeline());
    if (canEdit()) {
      const g = el("div", { class: "eh-grid-2" });
      g.appendChild(attention());
      g.appendChild(editorsDesk());
      wrap.appendChild(g);
    }
    wrap.appendChild(guides());
    return wrap;
  }

  function nextHard() {
    const list = (hub.dates || []).filter((d) => d.hard).map((d) => ({ ...d, n: daysUntil(d.date) })).filter((d) => d.n >= 0);
    return list.sort((a, b) => a.n - b.n)[0] || null;
  }

  function nextUp() {
    const node = el("section", { class: "eh-tiles", "aria-label": "What's next" });
    const nh = nextHard();
    const launchN = daysUntil(hub.launch);
    const mine = sorted(pieces.filter((p) => isMine(p) && p.section !== "held"));
    const big = (n) => (n === 0 ? `<span class="n">Today</span>` : `<span class="n">${n}</span><span class="u">${n === 1 ? "day" : "days"}</span>`);
    let third = "";
    const step = mine.flatMap((p) => (p.nextSteps || []).filter((s) => !s.done).map((s) => ({ p, s })))[0];
    if (mine.length) {
      third = step
        ? `<p class="eh-tile-k">Your next step</p><p class="eh-tile-text">${esc(step.s.text)}</p><button type="button" class="eh-tile-link" data-piece="${esc(step.p.id)}" data-pv="steps">${esc(clip(step.p.title, 46))} ${ICON.chev}</button>`
        : `<p class="eh-tile-k">Your next steps</p><p class="eh-tile-text">All done. Your editor will be in touch about what comes next.</p><button type="button" class="eh-tile-link" data-piece="${esc(mine[0].id)}">Open your piece ${ICON.chev}</button>`;
    } else if (mySections().length) {
      const s = mySections()[0];
      const qs = openQs((m) => m.authorUid !== me.uid && (m.sectionId === s.id || pieces.some((p) => p.id === m.pieceId && p.section === s.id)));
      third = `<p class="eh-tile-k">Waiting on you</p><p class="eh-tile-big"><span class="n">${qs.length}</span><span class="u">open ${qs.length === 1 ? "question" : "questions"}</span></p><button type="button" class="eh-tile-link" data-go="talk">Open questions ${ICON.chev}</button>`;
    } else if (["social_media", "marketing"].includes(ctx.role)) {
      third = `<p class="eh-tile-k">The lineup</p><p class="eh-tile-text">Hooks, people to tag and copy-ready lines for launch day.</p><button type="button" class="eh-tile-link" data-go="social">Plan the launch ${ICON.chev}</button>`;
    } else {
      const qs = openQs(() => true).length;
      third = `<p class="eh-tile-k">Open questions</p><p class="eh-tile-big"><span class="n">${qs}</span></p><button type="button" class="eh-tile-link" data-go="talk">Questions ${ICON.chev}</button>`;
    }
    node.innerHTML = `
      <article class="eh-tile is-main">
        ${nh ? `<p class="eh-tile-k">Next deadline${nh.hard ? ` <span class="eh-hard">Hard deadline</span>` : ""}</p>
          <p class="eh-tile-big${nh.n <= 7 ? " is-soon" : ""}">${big(nh.n)}</p>
          <p class="eh-tile-title">${esc(nh.label)}</p>
          <p class="eh-tile-sub">${esc(fmtDay(nh.date, LONG))}</p>`
        : `<p class="eh-tile-k">Deadlines</p><p class="eh-tile-title">All deadlines have passed.</p>`}
      </article>
      <article class="eh-tile">
        <p class="eh-tile-k">Launch</p>
        <p class="eh-tile-big">${launchN > 0 ? big(launchN) : `<span class="n">Live</span>`}</p>
        <p class="eh-tile-sub">${esc(fmtDay(hub.launch, LONG))}</p>
      </article>
      <article class="eh-tile">${third}</article>`;
    return node;
  }

  function myPieces(list) {
    const node = el("section", { class: "card" });
    node.innerHTML = `
      <div class="card-header eh-ch"><div><h2 class="card-title">Your ${list.length === 1 ? "piece" : "pieces"}</h2></div></div>
      <ul class="eh-list">${list.map((p) => {
        const ed = editorOf(p);
        const steps = p.nextSteps || [];
        const done = steps.filter((s) => s.done).length;
        const qN = openQs((m) => m.pieceId === p.id && m.authorUid !== me.uid).length;
        const f = flag(p);
        return `<li class="eh-mine">
          <button type="button" class="eh-hit" data-piece="${esc(p.id)}" aria-label="Open ${esc(p.title)}"></button>
          <div class="eh-mine-main">
            <p class="eh-meta">${esc(section(p.section)?.name || "")}${p.format ? ` · ${esc(p.format)}` : ""}</p>
            <p class="eh-mine-title">${esc(p.title)}</p>
            <div class="eh-prog" aria-label="Stage: ${esc(STAGES[STAGE_INDEX[p.status] ?? 0]?.label || "")}"><span style="width:${progressPct(p)}%"></span></div>
            <p class="eh-mine-facts">${stage(p)}${steps.length ? `<span>${done} of ${steps.length} steps done</span>` : ""}${ed ? `<span>Editor: ${esc(ed.name)}</span>` : ""}${qN ? `<span class="eh-tag is-info">${plural(qN, "question")} for you</span>` : ""}${f && f.tone !== "muted" ? `<span class="eh-tag is-${f.tone}">${esc(f.text)}</span>` : ""}</p>
          </div>
          <span class="eh-chev">${ICON.chev}</span>
        </li>`;
      }).join("")}</ul>`;
    return node;
  }

  function mySection(s) {
    const list = sorted(pieces.filter((p) => p.section === s.id));
    const waiting = openQs((m) => m.authorUid !== me.uid && (m.sectionId === s.id || list.some((p) => p.id === m.pieceId))).length;
    const node = el("section", { class: "card" });
    node.innerHTML = `
      <div class="card-header eh-ch">
        <div><h2 class="card-title">Your section: ${esc(s.name)}</h2><p class="card-subtitle">${plural(list.filter((p) => p.status !== "open").length, "piece")}${waiting ? ` · ${plural(waiting, "open question")}` : ""}</p></div>
        ${waiting ? `<button type="button" class="btn btn-secondary btn-sm" data-go="talk">Answer questions</button>` : ""}
      </div>
      <ul class="eh-list">${list.map(pieceRow).join("")}</ul>`;
    return node;
  }

  function timeline() {
    const node = el("section", { class: "card" });
    const dates = hub.dates || [];
    const nextIdx = dates.findIndex((d) => daysUntil(d.end || d.date) >= 0);
    const nxt = dates[nextIdx];
    node.innerHTML = `
      <div class="card-header eh-ch"><div><h2 class="card-title">Timeline</h2></div>${isAdmin ? `<button type="button" class="btn btn-ghost btn-sm" data-edit-dates>${ICON.edit} Edit</button>` : ""}</div>
      <div class="card-body">
        <ol class="eh-tl">${dates.map((d, i) => {
          const past = daysUntil(d.end || d.date) < 0;
          return `<li class="${past ? "is-past" : ""}${i === nextIdx ? " is-next" : ""}${d.hard ? " is-hard" : ""}">
            <span class="eh-tl-dot">${past ? ICON.check : ""}</span>
            <span class="eh-tl-date">${esc(fmtDay(d.date, { month: "short", day: "numeric" }))}${d.end ? `–${esc(fmtDay(d.end, { month: "short", day: "numeric" }))}` : ""}</span>
            <span class="eh-tl-label">${esc(d.label)}</span>
            ${d.hard ? `<span class="eh-tl-hard">Hard deadline</span>` : ""}
          </li>`;
        }).join("")}</ol>
        ${nxt?.detail ? `<div class="eh-tl-detail"><p class="eh-tl-detail-k">${daysUntil(nxt.date) <= 0 && nxt.end ? "Happening now" : `Next · ${esc(fmtDay(nxt.date, LONG))}`}</p><p><strong>${esc(nxt.label)}.</strong> ${esc(nxt.detail)}</p></div>` : ""}
      </div>`;
    return node;
  }

  function attention() {
    const node = el("section", { class: "card" });
    const list = realPieces();
    const counts = STAGES.map((s) => list.filter((p) => (p.status || "idea") === s.id).length);
    const items = [];
    live().filter((p) => p.status === "open").forEach((p) => items.push(`<li><span class="eh-tag is-warn">Open slot</span><button type="button" class="eh-link" data-piece="${esc(p.id)}">${esc(section(p.section)?.name)}${p.title !== "Open slot" ? `: ${esc(p.title.replace(/^Open slot:\s*/i, ""))}` : ""}</button></li>`));
    list.forEach((p) => { const f = flag(p); if (f) items.push(`<li><span class="eh-tag is-${f.tone}">${esc(f.text)}</span><button type="button" class="eh-link" data-piece="${esc(p.id)}">${esc(clip(p.title, 64))}</button></li>`); });
    const stale = openQs((m) => Date.now() - new Date(m.createdAt).getTime() > 2 * DAY).length;
    if (stale) items.push(`<li><span class="eh-tag is-info">${plural(stale, "question")}</span><button type="button" class="eh-link" data-go="talk">unanswered for more than two days</button></li>`);
    node.innerHTML = `
      <div class="card-header eh-ch"><div><h2 class="card-title">Where things stand</h2><p class="card-subtitle">${plural(list.length, "piece")} · ${plural(list.filter((p) => (STAGE_INDEX[p.status] ?? 0) >= STAGE_INDEX.draft1).length, "first draft")} in</p></div></div>
      <div class="card-body">
        <div class="eh-bar" role="img" aria-label="${esc(STAGES.map((s, i) => `${counts[i]} ${s.label}`).join(", "))}">${STAGES.map((s, i) => counts[i] ? `<span data-stage="${s.id}" style="flex:${counts[i]}" title="${esc(`${s.label}: ${counts[i]}`)}"></span>` : "").join("")}</div>
        <p class="eh-bar-key">${STAGES.map((s, i) => counts[i] ? `<span data-stage="${s.id}"><i></i>${esc(s.label)} ${counts[i]}</span>` : "").join("")}</p>
        <ul class="eh-attn">${items.join("") || `<li class="eh-muted">Nothing needs attention.</li>`}</ul>
      </div>`;
    return node;
  }

  function editorsDesk() {
    const node = el("section", { class: "card" });
    const row = (t, key, attr) => `<li><label class="eh-check${t[key] ? " is-done" : ""}"><input type="checkbox" ${attr}="${esc(t.id)}" ${t[key] ? "checked" : ""}><span class="box">${ICON.check}</span><span class="txt">${esc(t.text)}</span></label></li>`;
    node.innerHTML = `
      <div class="card-header eh-ch"><div><h2 class="card-title">Editors' desk</h2><p class="card-subtitle">Shared by the editors. Tick things off as you go.</p></div></div>
      <div class="card-body">
        <p class="section-title eh-st">To do</p>
        <ul class="eh-checks">${(hub.editorTodos || []).map((t) => row(t, "done", "data-todo")).join("")}</ul>
        <p class="section-title eh-st">Still deciding</p>
        <ul class="eh-checks">${(hub.decisions || []).map((t) => row(t, "resolved", "data-decision")).join("")}</ul>
      </div>`;
    return node;
  }

  function guides() {
    const node = el("section", { class: "card" });
    const drive = (hub.sections || []).filter((s) => s.driveUrl);
    node.innerHTML = `
      <div class="card-header eh-ch"><div><h2 class="card-title">Guides</h2><p class="card-subtitle">From the editors, for everyone. Open one when you need it.</p></div></div>
      <div class="eh-acc">
        <details><summary><span>What your first draft needs</span>${ICON.down}</summary>
          <ul class="eh-ticks">${(hub.firstDraft || []).map((t) => `<li>${esc(t)}</li>`).join("")}</ul></details>
        <details><summary><span>Editors' feedback for everyone</span>${ICON.down}</summary>
          <ol class="eh-num">${(hub.feedback || []).map((f) => `<li><strong>${esc(f.title)}.</strong> ${esc(f.text)}</li>`).join("")}</ol></details>
        <details><summary><span>Interview tips</span>${ICON.down}</summary>
          <ul class="eh-ticks">${(hub.interviewTips || []).map((t) => `<li>${esc(t)}</li>`).join("")}</ul></details>
        <details><summary><span>Where your work goes</span>${ICON.down}</summary>
          <dl class="eh-where">${(hub.whereWork || []).map((w) => `<dt>${esc(w.label)}</dt><dd>${esc(w.text)}</dd>`).join("")}</dl>
          ${drive.length ? `<p class="eh-btnrow">${drive.map((s) => `<a class="btn btn-secondary btn-sm" href="${esc(s.driveUrl)}" target="_blank" rel="noopener">${ICON.drive} ${esc(s.name)} folder</a>`).join("")}</p>` : ""}</details>
      </div>`;
    return node;
  }

  // ── Pieces
  function matches(p) {
    if (view.filter === "mine" && !isMine(p) && !edits(section(p.section))) return false;
    if (view.filter === "open" && p.status !== "open") return false;
    if (!view.q) return true;
    const hay = [p.title, p.subtitle, p.format, names(p.writers), section(p.section)?.name, ...(p.interviews || []).map((i) => `${i.person} ${i.affiliation}`)].join(" ").toLowerCase();
    return hay.includes(view.q);
  }

  function pieceRow(p) {
    if (p.status === "open") {
      return `<li class="eh-row is-open">
        <div class="eh-row-main"><p class="eh-row-title">${esc(p.title === "Open slot" ? "Open slot" : p.title.replace(/^Open slot:\s*/i, "Open slot: "))}</p><p class="eh-meta">${esc(p.subtitle || "")}</p></div>
        <div class="eh-row-side"><button type="button" class="btn btn-secondary btn-sm" data-pitch="${esc(p.section)}">Pitch an idea</button>${canEdit() ? `<button type="button" class="btn btn-ghost btn-sm" data-edit-piece="${esc(p.id)}">Fill it</button>` : ""}</div>
      </li>`;
    }
    const qN = openQs((m) => m.pieceId === p.id).length;
    const f = flag(p);
    return `<li class="eh-row${isMine(p) ? " is-mine" : ""}">
      <button type="button" class="eh-hit" data-piece="${esc(p.id)}" aria-label="Open ${esc(p.title)}"></button>
      <div class="eh-row-main">
        <p class="eh-row-title">${esc(p.title)}${isMine(p) ? ` <span class="eh-you">You</span>` : ""}</p>
        <p class="eh-meta">${esc(names(p.writers))}${p.format ? ` · ${esc(p.format)}` : ""}</p>
      </div>
      <div class="eh-row-side">
        ${f && f.tone !== "muted" ? `<span class="eh-tag is-${f.tone}">${esc(f.text)}</span>` : ""}
        ${qN ? `<span class="eh-count" title="${plural(qN, "open question")}">${ICON.q}${qN}</span>` : ""}
        ${stage(p)}
        <span class="eh-chev">${ICON.chev}</span>
      </div>
    </li>`;
  }

  function piecesView() {
    const wrap = el("div", { class: "eh-stack" });
    const bar = el("div", { class: "eh-toolbar" });
    bar.innerHTML = `
      <label class="eh-search">${ICON.search}<span class="sr-only">Find a piece</span>
        <input type="search" placeholder="Search pieces, writers, interviewees" value="${esc(view.q)}" data-keep="q" autocomplete="off"></label>
      <div class="eh-seg is-sm" role="group" aria-label="Show">
        ${[["all", "All"], ["mine", "Mine"], ["open", "Open slots"]].map(([id, l]) => `<button type="button" class="eh-seg-b${view.filter === id ? " is-on" : ""}" data-filter="${id}" aria-pressed="${view.filter === id}">${l}</button>`).join("")}
      </div>`;
    const list = el("div", { class: "eh-stack" });
    bar.querySelector("input").addEventListener("input", (e) => { view.q = e.target.value.trim().toLowerCase(); list.innerHTML = ""; fillSections(list); });
    wrap.append(bar, list);
    fillSections(list);
    return wrap;
  }

  function fillSections(list) {
    let shown = 0;
    (hub.sections || []).forEach((s, i) => {
      const ps = sorted(pieces.filter((p) => p.section === s.id)).filter(matches);
      if ((view.q || view.filter !== "all") && !ps.length) return;
      shown += ps.length;
      const count = pieces.filter((p) => p.section === s.id && p.status !== "open").length;
      const node = el("section", { class: "card eh-sec", id: `sec-${s.id}` });
      node.innerHTML = `
        <div class="card-header eh-ch eh-sec-h">
          <div class="eh-sec-t">
            <p class="eh-sec-num">${String(i + 1).padStart(2, "0")}</p>
            <div><h2 class="eh-sec-name">${esc(s.name)}</h2><p class="card-subtitle">${plural(count, "piece")}</p></div>
          </div>
          <div class="eh-sec-ed">
            ${s.editor ? `<span class="eh-person">${avatar(s.editor, 30)}<span><small>Editor</small>${esc(s.editor.name)}</span></span>` : `<span class="eh-muted">No editor yet</span>`}
            ${s.driveUrl ? `<a class="btn btn-ghost btn-sm" href="${esc(s.driveUrl)}" target="_blank" rel="noopener" aria-label="${esc(s.name)} Drive folder">${ICON.drive}</a>` : ""}
            ${isAdmin ? `<button type="button" class="btn btn-ghost btn-sm" data-edit-section="${esc(s.id)}" aria-label="Edit ${esc(s.name)}">${ICON.edit}</button>` : ""}
          </div>
        </div>
        <details class="eh-secabout"><summary>About this section ${ICON.down}</summary><p>${esc(s.blurb || "")}</p>${s.belongs ? `<p class="eh-belongs"><strong>What belongs here.</strong> ${esc(s.belongs)}</p>` : ""}</details>
        <ul class="eh-list">${ps.map(pieceRow).join("") || `<li class="eh-row is-empty">No pieces yet.</li>`}</ul>
        ${canEdit() ? `<div class="eh-card-foot"><button type="button" class="btn btn-ghost btn-sm" data-add-piece="${esc(s.id)}">${ICON.plus} Add a piece</button></div>` : ""}`;
      list.appendChild(node);
    });
    const held = sorted(pieces.filter((p) => p.section === "held")).filter(matches);
    if (held.length && view.filter === "all") {
      const d = el("details", { class: "card eh-held" });
      d.innerHTML = `<summary class="card-header eh-ch"><div><h2 class="card-title">Held for a later edition</h2><p class="card-subtitle">${plural(held.length, "piece")}</p></div>${ICON.down}</summary><ul class="eh-list">${held.map(pieceRow).join("")}</ul>`;
      list.appendChild(d);
    }
    if (!shown && !held.length) list.innerHTML = `<div class="card"><div class="card-empty">Nothing matches. <button type="button" class="eh-link" data-filter="all" data-clear>Show everything</button></div></div>`;
  }

  // ── a piece
  function pieceView(p) {
    const s = section(p.section);
    const ed = editorOf(p);
    const wrap = el("div", { class: "eh-piece" });
    const threads = threadOf((m) => m.pieceId === p.id);
    const openN = threads.filter((m) => m.kind === "question" && !m.resolved).length;
    const prog = canProgress(p);
    const steps = p.nextSteps || [];
    const done = steps.filter((x) => x.done).length;
    const first = hardDate("first-draft");
    const i = STAGE_INDEX[p.status] ?? 0;
    const firstDone = i >= STAGE_INDEX.draft1;
    const fn = first ? daysUntil(first.date) : null;
    wrap.innerHTML = `
      <button type="button" class="eh-back" data-go="pieces">${ICON.back} All pieces</button>
      <header class="eh-ph">
        <div class="eh-ph-main">
          <p class="eh-eyebrow">${s ? esc(s.name) : "Held for a later edition"}${p.format ? ` · ${esc(p.format)}` : ""}</p>
          <h1 class="eh-ph-title">${esc(p.title)}</h1>
          ${p.subtitle ? `<p class="eh-ph-sub">${esc(p.subtitle)}</p>` : ""}
          <div class="eh-people">
            ${(p.writers || []).map((w) => `<span class="eh-person">${avatar(w, 36)}<span><small>Writer</small>${esc(w.name)}</span></span>`).join("")}
            ${ed ? `<span class="eh-person">${avatar(ed, 36)}<span><small>Editor</small>${esc(ed.name)}</span></span>` : ""}
          </div>
          ${p.placement ? `<p class="eh-placement">${esc(p.placement)}</p>` : ""}
        </div>
        <div class="eh-ph-actions">
          ${p.status !== "open" ? `<button type="button" class="btn btn-primary" data-compose="question" data-for="${esc(p.id)}">${ICON.q} Ask a question</button>
          <button type="button" class="btn btn-secondary" data-compose="update" data-for="${esc(p.id)}">${ICON.note} Share an update</button>` : ""}
          ${canEdit() ? `<button type="button" class="btn btn-ghost" data-edit-piece="${esc(p.id)}">${ICON.edit} Edit</button>` : isMine(p) ? `<button type="button" class="btn btn-ghost" data-edit-mine="${esc(p.id)}">${ICON.edit} Edit title</button>` : ""}
        </div>
      </header>
      ${SPECIAL[p.status] ? "" : `
      <section class="eh-tiles is-sm" aria-label="Progress">
        <article class="eh-tile">
          <p class="eh-tile-k">Stage</p>
          ${prog ? `<label class="eh-stage-pick"><span class="sr-only">Move this piece to</span><select data-stage-select="${esc(p.id)}">${STAGES.map((x) => `<option value="${x.id}"${x.id === (p.status || "idea") ? " selected" : ""}>${esc(x.label)}</option>`).join("")}</select>${ICON.down}</label>` : `<p class="eh-tile-title">${esc(STAGES[i].label)}</p>`}
          <div class="eh-prog"><span style="width:${progressPct(p)}%"></span></div>
          <p class="eh-tile-sub">Step ${i + 1} of ${STAGES.length} · ${esc(STAGES[i].hint)}</p>
        </article>
        <article class="eh-tile">
          <p class="eh-tile-k">Next steps</p>
          <p class="eh-tile-title">${steps.length ? `${done} of ${steps.length} done` : "None yet"}</p>
          <div class="eh-prog"><span style="width:${steps.length ? (done / steps.length) * 100 : 0}%"></span></div>
          <button type="button" class="eh-tile-link" data-pv="steps">See steps ${ICON.chev}</button>
        </article>
        <article class="eh-tile">
          <p class="eh-tile-k">First draft</p>
          <p class="eh-tile-title${!firstDone && fn != null && fn <= 7 ? " is-soon" : ""}">${firstDone ? "In" : fn == null ? "—" : fn < 0 ? "Overdue" : `Due ${esc(inDays(fn))}`}</p>
          <p class="eh-tile-sub">${first ? esc(fmtDay(first.date, LONG)) : ""}</p>
          ${p.draftUrl ? `<a class="eh-tile-link" href="${esc(p.draftUrl)}" target="_blank" rel="noopener">Open the draft ${ICON.chev}</a>` : prog ? `<button type="button" class="eh-tile-link" data-draft-link="${esc(p.id)}">Add the draft link ${ICON.chev}</button>` : ""}
        </article>
      </section>`}
      <nav class="eh-seg eh-ptabs" aria-label="This piece">
        ${[["proposal", "Proposal", noteCount(p) ? `${noteCount(p)} notes` : ""], ["steps", "Steps<span class=\"eh-wide\"> & interviews</span>", ""], ["talk", "Questions", threads.length ? (openN ? `${openN} open` : String(threads.length)) : ""]].map(([id, l, n]) => `
          <button type="button" class="eh-seg-b${view.pieceTab === id ? " is-on" : ""}" data-pv="${id}" ${view.pieceTab === id ? 'aria-current="page"' : ""}>${l}${n ? `<span class="eh-badge${id === "talk" && openN ? " is-alert" : ""}">${n}</span>` : ""}</button>`).join("")}
      </nav>
      <div class="eh-pbody"></div>`;
    const body = wrap.querySelector(".eh-pbody");
    if (view.pieceTab === "talk") {
      body.appendChild(composerCard({ pieceId: p.id }));
      body.appendChild(threadCard(threads, { showContext: false, empty: "No questions or updates yet. Ask the first one." }));
    } else if (view.pieceTab === "steps") body.appendChild(stepsView(p, prog));
    else body.appendChild(proposalView(p));
    return wrap;
  }

  function proposalView(p) {
    const node = el("section", { class: "card eh-doc" });
    const pr = p.proposal;
    const mine = isMine(p);
    const canProp = mine || canEdit();
    const nN = noteCount(p);
    if (!pr) {
      node.innerHTML = `<div class="eh-noprop">
        <h2>No proposal here yet</h2>
        <p>${esc(p.proposalNote || (p.status === "open" ? "This slot is open. Pitch an idea, and the section editor will get back to you." : "Once the proposal is in, it shows here with the editors' notes."))}</p>
        ${p.candidates?.length ? `<p class="section-title eh-st">Ideas on the table</p><ul class="eh-ticks">${p.candidates.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>` : ""}
        ${canProp && p.status !== "open" ? `<button type="button" class="btn btn-primary" data-edit-proposal="${esc(p.id)}">${mine ? "Add your proposal" : "Add the proposal"}</button>` : ""}
        ${p.status === "open" ? `<button type="button" class="btn btn-primary" data-pitch="${esc(p.section)}">Pitch an idea</button>` : ""}
      </div>`;
      return node;
    }
    const valueOf = (k) => (k === "title" ? p.title : k === "subtitle" ? p.subtitle : k === "format" ? p.format : pr[k]);
    const notesFor = (k) => (p.notes?.[k] || []);
    let html = `
      <div class="card-header eh-ch">
        <div><h2 class="card-title">Proposal by ${esc(names(p.writers))}</h2>${p.updatedAt && p.updatedByName && !/seeded/i.test(p.updatedByName) ? `<p class="card-subtitle">Updated ${esc(fmtRelative(p.updatedAt))}</p>` : ""}</div>
        <div class="eh-doc-ctl">
          ${nN ? `<label class="eh-switch"><input type="checkbox" ${view.showNotes ? "checked" : ""} data-toggle-notes><span class="tr" aria-hidden="true"></span>Editors' notes</label>` : ""}
          ${canProp ? `<button type="button" class="btn btn-ghost btn-sm" data-edit-proposal="${esc(p.id)}">${ICON.edit} Edit</button>` : ""}
        </div>
      </div>
      <div class="eh-doc-body${view.showNotes ? "" : " hide-notes"}">`;
    for (const g of PROPOSAL) {
      const rows = g.fields.filter(([k]) => (valueOf(k) && String(valueOf(k)).trim() && !/^tbd\b/i.test(String(valueOf(k)).trim())) || notesFor(k).length);
      const lead = g.lead ? notesFor(g.lead) : [];
      if (!rows.length && !lead.length) continue;
      html += `<section class="eh-pg"><h3 class="section-title">${esc(g.group)}</h3>${notesHtml(lead)}`;
      for (const [k, label] of rows) {
        const v = valueOf(k);
        html += `<div class="eh-field${k === "takeaway" ? " is-key" : ""}">
          <p class="eh-flabel">${esc(label)}</p>
          ${v ? `<div class="eh-ftext">${rich(v)}</div>` : `<p class="eh-ftext is-blank">Left blank</p>`}
          ${notesHtml(notesFor(k))}
        </div>`;
      }
      html += `</section>`;
    }
    if (p.general?.length) html += `<section class="eh-pg eh-general"><h3 class="section-title">The editors' overall feedback</h3>${p.general.map((t) => `<div class="eh-gnote">${rich(t)}</div>`).join("")}</section>`;
    html += `</div>`;
    node.innerHTML = html;
    return node;
  }
  function notesHtml(list) {
    if (!list?.length) return "";
    return `<div class="eh-notes">${list.map((t) => `<aside class="eh-note"><span class="eh-note-k">Editor's note</span>${rich(t)}</aside>`).join("")}</div>`;
  }

  function stepsView(p, prog) {
    const wrap = el("div", { class: "eh-grid-2" });
    const steps = p.nextSteps || [];
    const done = steps.filter((s) => s.done).length;
    const a = el("section", { class: "card" });
    a.innerHTML = `
      <div class="card-header eh-ch"><div><h2 class="card-title">Next steps</h2><p class="card-subtitle">${steps.length ? `${done} of ${steps.length} done${prog ? ". Tick them off as you go." : ""}` : "None yet."}</p></div>
        ${canEdit() ? `<button type="button" class="btn btn-ghost btn-sm" data-edit-steps="${esc(p.id)}">${ICON.edit} Edit</button>` : ""}</div>
      <div class="card-body"><ul class="eh-checks">${steps.map((s) => `<li><label class="eh-check${s.done ? " is-done" : ""}"><input type="checkbox" data-step="${esc(s.id)}" data-piece-id="${esc(p.id)}" ${s.done ? "checked" : ""} ${prog ? "" : "disabled"}><span class="box">${ICON.check}</span><span class="txt">${esc(s.text)}</span></label></li>`).join("") || `<li class="eh-muted">The editors haven't added steps yet.</li>`}</ul></div>`;
    const ivs = p.interviews || [];
    const lbl = { done: "Done", scheduled: "Scheduled", planned: "Planned", wanted: "Wanted" };
    const b = el("section", { class: "card" });
    b.innerHTML = `
      <div class="card-header eh-ch"><div><h2 class="card-title">Interviews</h2><p class="card-subtitle">${ivs.length ? `Send your angle and questions to ${editorOf(p) ? esc(firstName(editorOf(p).name)) : "your editor"} first, and ask permission to record.` : "None listed yet."}</p></div>
        ${prog ? `<button type="button" class="btn btn-ghost btn-sm" data-edit-iv="${esc(p.id)}">${ivs.length ? `${ICON.edit} Edit` : `${ICON.plus} Add`}</button>` : ""}</div>
      <ul class="eh-list">${ivs.map((v) => `<li class="eh-iv">
        <div><p class="eh-row-title">${esc(v.person)}</p><p class="eh-meta">${esc([v.affiliation, v.when].filter(Boolean).join(" · "))}</p>${v.note ? `<p class="eh-meta eh-iv-note">${esc(v.note)}</p>` : ""}</div>
        <span class="eh-tag is-iv-${esc(v.status || "planned")}">${esc(lbl[v.status] || "Planned")}</span>
      </li>`).join("")}</ul>`;
    wrap.append(a, b);
    const sd = section(p.section)?.driveUrl;
    if (p.draftUrl || sd || prog) {
      const c = el("section", { class: "card eh-span-2" });
      c.innerHTML = `<div class="card-header eh-ch"><div><h2 class="card-title">The draft</h2><p class="card-subtitle">Upload it to your section's Drive folder as “Name_Title_Draft1”, then set the stage to First draft in.</p></div>
        <div class="eh-btnrow">${p.draftUrl ? `<a class="btn btn-secondary btn-sm" href="${esc(p.draftUrl)}" target="_blank" rel="noopener">${ICON.link} Open the draft</a>` : ""}${sd ? `<a class="btn btn-ghost btn-sm" href="${esc(sd)}" target="_blank" rel="noopener">${ICON.drive} Section folder</a>` : ""}${prog ? `<button type="button" class="btn btn-ghost btn-sm" data-draft-link="${esc(p.id)}">${p.draftUrl ? "Change link" : `${ICON.plus} Add the link`}</button>` : ""}</div></div>`;
      wrap.appendChild(c);
    }
    return wrap;
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
    const state = { kind, pieceId, sectionId };
    const kinds = ["question", "update", ...(isHubEditor() || isAdmin ? ["announcement"] : [])];
    const aboutOptions = () => `
      <option value="">The whole edition</option>
      <optgroup label="Sections">${(hub.sections || []).map((s) => `<option value="s:${esc(s.id)}"${state.sectionId === s.id && !state.pieceId ? " selected" : ""}>${esc(s.name)}</option>`).join("")}</optgroup>
      ${(hub.sections || []).map((s) => {
        const ps = sorted(pieces.filter((p) => p.section === s.id && p.status !== "open"));
        return ps.length ? `<optgroup label="${esc(s.name)}">${ps.map((p) => `<option value="p:${esc(p.id)}"${state.pieceId === p.id ? " selected" : ""}>${esc(clip(p.title, 64))} (${esc(firstNames(p.writers))})</option>`).join("")}</optgroup>` : "";
      }).join("")}`;
    const paint = () => {
      node.innerHTML = `
        <div class="eh-compose-top">
          <div class="eh-seg is-sm" role="radiogroup" aria-label="Kind of post">
            ${kinds.map((k) => `<button type="button" role="radio" aria-checked="${state.kind === k}" class="eh-seg-b${state.kind === k ? " is-on" : ""}" data-kind="${k}">${KIND[k].label}</button>`).join("")}
          </div>
          ${choose ? `<label class="eh-about"><span>About</span><select data-about>${aboutOptions()}</select></label>` : ""}
        </div>
        <label class="sr-only" for="${esc(key)}">${esc(KIND[state.kind].verb)}</label>
        <textarea id="${esc(key)}" rows="${compact ? 3 : 3}" maxlength="4000" placeholder="${esc(KIND[state.kind].ph)}" data-keep="${esc(key)}"></textarea>
        <div class="eh-compose-foot">
          <p class="eh-to">Goes to <strong>${esc(recipientsFor({ ...state }))}</strong></p>
          <button type="submit" class="btn btn-primary btn-sm">${esc(KIND[state.kind].verb)}</button>
        </div>`;
      node.querySelector("textarea").value = drafts.get(key) || prefill || "";
    };
    paint();
    node.addEventListener("click", (e) => {
      const b = e.target.closest("[data-kind]");
      if (!b) return;
      drafts.set(key, node.querySelector("textarea").value);
      state.kind = b.dataset.kind; paint();
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
  function composerCard(opts) {
    const c = el("section", { class: "card eh-compose-card" });
    c.appendChild(composer(opts));
    return c;
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
    const wrap = el("div", { class: "eh-stack" });
    wrap.appendChild(composerCard({ choose: true }));
    const all = threadOf(() => true);
    const open = all.filter((m) => m.kind === "question" && !m.resolved);
    const aboutMe = all.filter((m) => m.authorUid === me.uid || pieces.some((p) => p.id === m.pieceId && (isMine(p) || edits(section(p.section)))) || (m.sectionId && !m.pieceId && edits(section(m.sectionId))));
    const updates = all.filter((m) => m.kind === "update" || m.kind === "announcement");
    const sets = { all, open, mine: aboutMe, updates };
    const bar = el("div", { class: "eh-toolbar" });
    bar.innerHTML = `<div class="eh-seg is-sm" role="group" aria-label="Show">${[["all", "Everything", all.length], ["open", "Open questions", open.length], ["mine", "About me", aboutMe.length], ["updates", "Updates", updates.length]].map(([id, l, n]) => `<button type="button" class="eh-seg-b${view.talkFilter === id ? " is-on" : ""}" data-tfilter="${id}" aria-pressed="${view.talkFilter === id}">${l}${n ? `<span class="eh-badge">${n}</span>` : ""}</button>`).join("")}</div>`;
    wrap.appendChild(bar);
    wrap.appendChild(threadCard(sets[view.talkFilter] || all, { showContext: true, empty: view.talkFilter === "open" ? "No open questions. Everything has been answered." : "Nothing here yet. Ask a question or share an update above." }));
    return wrap;
  }

  function threadCard(list, { showContext = true, empty = "Nothing yet." } = {}) {
    const c = el("section", { class: "card" });
    if (!list.length) { c.innerHTML = `<div class="card-empty">${esc(empty)}</div>`; return c; }
    // Open questions first, then newest.
    const items = [...list].sort((a, b) => (Number(b.kind === "question" && !b.resolved) - Number(a.kind === "question" && !a.resolved)) || String(b.createdAt).localeCompare(String(a.createdAt)));
    c.innerHTML = `<ul class="eh-threads">${items.map((m) => messageHtml(m, { showContext })).join("")}</ul>`;
    return c;
  }

  function messageHtml(m, { showContext = true, isReply = false } = {}) {
    const p = pieces.find((x) => x.id === m.pieceId);
    const s = section(m.sectionId);
    const author = { name: m.authorName, slug: m.authorSlug };
    const isQ = m.kind === "question";
    const mineMsg = m.authorUid === me.uid;
    const ctxLabel = p ? `<button type="button" class="eh-link" data-piece="${esc(p.id)}" data-pv="talk">${esc(clip(p.title, 64))}</button>` : s ? esc(s.name) : "The whole edition";
    const replies = isReply ? [] : repliesTo(m.id);
    return `<li class="eh-msg${isQ && !m.resolved ? " is-open" : ""}${m.kind === "announcement" ? " is-announce" : ""}${m.auto ? " is-auto" : ""}${isReply ? " is-reply" : ""}" id="m-${esc(m.id)}">
      <div class="eh-msg-av">${avatar(author, isReply ? 28 : 36)}</div>
      <div class="eh-msg-body">
        <p class="eh-msg-head">
          <strong>${esc(m.authorName || "Someone")}</strong>${m.authorRole ? `<span class="eh-muted">${esc(m.authorRole)}</span>` : ""}
          ${isReply ? "" : `<span class="eh-tag is-k-${esc(m.kind)}${isQ && m.resolved ? " is-resolved" : ""}">${isQ ? (m.resolved ? `${ICON.check} Answered` : "Question") : esc(KIND[m.kind]?.label || "Update")}</span>`}
          <time datetime="${esc(m.createdAt)}" title="${esc(new Date(m.createdAt).toLocaleString("en-US"))}">${esc(fmtRelative(m.createdAt))}${m.editedAt ? " · edited" : ""}</time>
        </p>
        ${showContext && !isReply ? `<p class="eh-msg-ctx">On ${ctxLabel}</p>` : ""}
        <div class="eh-msg-text">${rich(m.text)}</div>
        <div class="eh-msg-actions">
          ${!isReply && !m.auto ? `<button type="button" class="eh-act" data-reply="${esc(m.id)}">Reply${replies.length ? ` · ${replies.length}` : ""}</button>` : ""}
          ${isQ && !isReply ? `<button type="button" class="eh-act" data-resolve="${esc(m.id)}" data-val="${m.resolved ? "0" : "1"}">${m.resolved ? "Reopen" : "Mark answered"}</button>` : ""}
          ${mineMsg && !m.auto ? `<button type="button" class="eh-act" data-edit-msg="${esc(m.id)}">Edit</button>` : ""}
          ${mineMsg || isAdmin ? `<button type="button" class="eh-act is-danger" data-del-msg="${esc(m.id)}">Delete</button>` : ""}
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
      <div class="eh-reply-foot">${m?.kind === "question" && !m.resolved ? `<label class="eh-inline-check"><input type="checkbox" checked data-and-resolve> Mark answered</label>` : "<span></span>"}<span><button type="button" class="btn btn-ghost btn-sm" data-cancel>Cancel</button><button type="submit" class="btn btn-primary btn-sm">Reply</button></span></div>`;
    f.querySelector("textarea").value = drafts.get(key) || "";
    f.addEventListener("keydown", (e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); f.requestSubmit(); } });
    f.querySelector("[data-cancel]").addEventListener("click", () => { drafts.delete(key); openReplies.delete(id); f.remove(); });
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const text = f.querySelector("textarea").value.trim();
      if (!text) return;
      const andResolve = f.querySelector("[data-and-resolve]")?.checked;
      const ok = await post({ kind: "reply", text, parentId: id, pieceId: m?.pieceId || "", sectionId: m?.sectionId || "" });
      if (ok) { drafts.delete(key); openReplies.delete(id); if (andResolve) resolve(id, true); }
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

  // ── Social
  function socialView() {
    const wrap = el("div", { class: "eh-stack" });
    const launchN = daysUntil(hub.launch);
    const fin = hardDate("final-draft");
    const list = sorted(realPieces());
    const tags = [...new Set(list.flatMap((p) => (p.interviews || []).filter((v) => v.status !== "wanted").map((v) => v.affiliation)).filter(Boolean).map((a) => a.replace(/^(Director|Head PI|Epidemiologist|Bioethicist|MD\/PhD, medical historian),?\s*/i, "")))];
    const finals = list.filter((p) => (STAGE_INDEX[p.status] ?? 0) >= STAGE_INDEX.final).length;
    wrap.innerHTML = `
      <section class="eh-tiles" aria-label="Launch">
        <article class="eh-tile is-main"><p class="eh-tile-k">Launch</p><p class="eh-tile-big">${launchN > 0 ? `<span class="n">${launchN}</span><span class="u">days</span>` : `<span class="n">Live</span>`}</p><p class="eh-tile-sub">${esc(fmtDay(hub.launch, LONG))}</p></article>
        <article class="eh-tile"><p class="eh-tile-k">In the lineup</p><p class="eh-tile-big"><span class="n">${list.length}</span><span class="u">pieces</span></p><p class="eh-tile-sub">Across ${plural((hub.sections || []).length, "section")}</p></article>
        <article class="eh-tile"><p class="eh-tile-k">Final drafts in</p><p class="eh-tile-big"><span class="n">${finals}</span><span class="u">of ${list.length}</span></p><p class="eh-tile-sub">Titles can change until ${fin ? esc(fmtDay(fin.date, { month: "long", day: "numeric" })) : "final drafts"}</p></article>
      </section>
      ${(hub.sections || []).map((s) => {
        const ps = list.filter((p) => p.section === s.id);
        if (!ps.length) return "";
        return `<section class="card">
          <div class="card-header eh-ch"><div><h2 class="card-title">${esc(s.name)}</h2><p class="card-subtitle">${plural(ps.length, "piece")}</p></div><button type="button" class="btn btn-ghost btn-sm" data-copy="${esc(`The Future of Health is ${endStop(s.name)} ${s.blurb || ""}`)}">${ICON.copy} Copy section blurb</button></div>
          <ul class="eh-list">${ps.map((p) => `<li class="eh-lu">
            <div class="eh-lu-top"><div><p class="eh-row-title">${esc(p.title)}</p><p class="eh-meta">${esc(names(p.writers))}${p.format ? ` · ${esc(p.format)}` : ""}</p></div>${stage(p)}</div>
            ${p.subtitle ? `<div class="eh-hook"><p>${esc(p.subtitle)}</p><button type="button" class="btn btn-ghost btn-xs" data-copy="${esc(p.subtitle)}">${ICON.copy} Copy</button></div>` : ""}
            ${p.proposal?.visuals || (p.interviews || []).some((v) => v.status !== "wanted") ? `<dl class="eh-lu-dl">
              ${p.proposal?.visuals ? `<dt>Visual ideas</dt><dd>${esc(p.proposal.visuals)}</dd>` : ""}
              ${(p.interviews || []).some((v) => v.status !== "wanted") ? `<dt>Featuring</dt><dd>${esc((p.interviews || []).filter((v) => v.status !== "wanted").map((v) => `${v.person}${v.affiliation ? ` (${v.affiliation})` : ""}`).join("; "))}</dd>` : ""}
            </dl>` : ""}
          </li>`).join("")}</ul>
        </section>`;
      }).join("")}
      <div class="eh-grid-2">
        <section class="card"><div class="card-header eh-ch"><div><h2 class="card-title">The theme</h2></div><button type="button" class="btn btn-ghost btn-sm" data-copy="${esc(`${hub.theme} ${hub.intro || ""}`)}">${ICON.copy} Copy</button></div><div class="card-body"><p class="eh-quote">${esc(hub.theme)} ${esc(hub.intro || "")}</p></div></section>
        ${tags.length ? `<section class="card"><div class="card-header eh-ch"><div><h2 class="card-title">People and places to tag</h2><p class="card-subtitle">From the interviews so far. Check each handle before posting.</p></div></div><div class="card-body"><p class="eh-chips">${tags.map((t) => `<span class="eh-chip">${esc(t)}</span>`).join("")}</p></div></section>` : ""}
      </div>`;
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
        try { await deleteDoc(doc(db, "edition_hub", EDITION, "pieces", cur.id)); m.close(); go({ piece: null, tab: "pieces" }); toast("Deleted."); } catch { toast("Couldn't delete it.", "error"); }
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
    const t = e.target.closest("button, a");
    if (!t || !root.contains(t)) return;
    const d = t.dataset;
    if (d.go) { go({ tab: d.go, piece: null }); return; }
    if (d.piece) { go({ piece: d.piece, pieceTab: d.pv || "proposal" }); return; }
    if (d.pv) { go({ pieceTab: d.pv }); return; }
    if (d.filter) { view.filter = d.filter; if (d.clear !== undefined) view.q = ""; render(); return; }
    if (d.tfilter) { view.talkFilter = d.tfilter; render(); return; }
    if (d.compose) { composeModal({ pieceId: d.for, kind: d.compose }); return; }
    if (d.pitch) { const s = section(d.pitch); composeModal({ sectionId: d.pitch, kind: "question", prefill: `I'd like to pitch for an open slot in ${s?.name || "this section"}. My idea: ` }); return; }
    if (d.reply) { openReplies.add(d.reply); openReply(d.reply); return; }
    if (d.resolve) { resolve(d.resolve, d.val === "1"); return; }
    if (d.editMsg) { editMessage(d.editMsg); return; }
    if (d.delMsg) {
      if (!(await confirmDialog("Delete this post? Its replies go with it from view.", { confirmText: "Delete", danger: true }))) return;
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
    if (d.editSection) { editSection(section(d.editSection)); return; }
    if (d.editDates !== undefined) { editDates(); return; }
  });
  root.addEventListener("change", (e) => {
    const t = e.target;
    if (t.matches("[data-toggle-notes]")) { view.showNotes = t.checked; root.querySelector(".eh-doc-body")?.classList.toggle("hide-notes", !t.checked); return; }
    if (t.matches("[data-stage-select]")) {
      const p = pieces.find((x) => x.id === t.dataset.stageSelect);
      if (!p || p.status === t.value) return;
      savePiece(p.id, { status: t.value }, { note: `Moved this piece to “${STAGES[STAGE_INDEX[t.value]].label}”.` });
      return;
    }
    if (t.matches("[data-step]")) {
      const p = pieces.find((x) => x.id === t.dataset.pieceId);
      if (!p) return;
      savePiece(p.id, { nextSteps: (p.nextSteps || []).map((s) => s.id === t.dataset.step ? { ...s, done: t.checked } : s) });
      return;
    }
    if (t.matches("[data-todo]") || t.matches("[data-decision]")) {
      const isTodo = t.matches("[data-todo]");
      const key = isTodo ? "editorTodos" : "decisions";
      const id = isTodo ? t.dataset.todo : t.dataset.decision;
      saveHub({ [key]: (hub[key] || []).map((x) => x.id === id ? { ...x, [isTodo ? "done" : "resolved"]: t.checked } : x) });
    }
  });

  // Back/forward: the hash changes, so the Suite re-mounts this page, which
  // reads the URL and paints from the cache at once.

  // Re-open reply boxes after a live re-render.
  const mo = new MutationObserver(() => { openReplies.forEach((id) => { const slot = root.querySelector(`[data-reply-slot="${CSS.escape(id)}"]`); if (slot && !slot.firstChild) openReply(id); }); });
  mo.observe(root, { childList: true });

  render();

  return () => {
    unsubs.forEach((u) => { try { u(); } catch {} });
    clearInterval(wordTimer);
    mo.disconnect();
    document.body.classList.remove("eh-calm");
    container.classList.remove("eh-content");
  };
}

// ── styles
// The Suite's own cards, buttons and type, set on a plain page: no seasonal
// washes behind it, generous space, one accent (ink), color only for meaning.
function injectStyle() {
  if (document.getElementById("eh-style")) return;
  const s = document.createElement("style");
  s.id = "eh-style";
  s.textContent = `
body.eh-calm, html[data-suite-theme] body.eh-calm { background: var(--surface-2); }
body.eh-calm::before { display: none !important; }
html[data-suite-theme] body.eh-calm .topbar { background: color-mix(in srgb, var(--surface-2) 88%, transparent); }

.eh { max-width: 1080px; margin: 0 auto; padding: 8px 0 72px; color: var(--ink); }
.eh .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.eh button:focus-visible, .eh a:focus-visible, .eh select:focus-visible, .eh textarea:focus-visible, .eh input:focus-visible, .eh summary:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
.eh .card + .card { margin-top: 0; }
.eh-stack { display: flex; flex-direction: column; gap: 20px; }
.eh-grid-2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; align-items: start; }
.eh-span-2 { grid-column: 1 / -1; }
.eh-muted { color: var(--muted); }
.eh-link { background: none; border: 0; padding: 0; font: inherit; color: var(--ink); text-align: left; cursor: pointer; text-decoration: underline; text-decoration-color: color-mix(in srgb, var(--ink) 25%, transparent); text-underline-offset: 3px; }
.eh-link:hover { text-decoration-color: var(--ink); }
.eh .card-header.eh-ch { display: flex; flex-direction: row; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 10px 16px; }
.eh-ch > div:first-child { flex: 1 1 220px; min-width: 0; }
.eh-ch > .btn, .eh-ch > .eh-doc-ctl, .eh-ch > .eh-btnrow { flex: none; margin-left: auto; width: auto; }
.eh-st { margin: 0 0 8px; }
.eh-st:not(:first-child) { margin-top: 22px; }
.eh-btnrow { display: flex; flex-wrap: wrap; gap: 8px; margin: 0; }
.eh .btn { display: inline-flex; align-items: center; gap: 7px; }
.eh .btn:not(.btn-sm):not(.btn-xs) { min-height: 42px; }
.eh .btn-sm { min-height: 36px; }

/* header */
.eh-head { padding: 28px 0 26px; }
.eh-eyebrow { margin: 0 0 12px; font: 600 11px/1.2 var(--font); letter-spacing: .14em; text-transform: uppercase; color: var(--muted); }
.eh-title { margin: 0; font: 600 clamp(30px, 4.4vw, 46px)/1.1 var(--font); letter-spacing: -0.035em; color: var(--ink); }
.eh-blank { display: inline-block; min-width: 3.6em; padding: 0 .06em; border-bottom: 3px solid currentColor; line-height: 1.05; }
.eh-word { display: inline-block; color: var(--muted); opacity: 0; transform: translateY(5px); transition: opacity .28s var(--ease-out), transform .28s var(--ease-out); white-space: nowrap; }
.eh-word.is-in { opacity: 1; transform: none; }
.eh-lede { margin: 14px 0 0; font-size: 15px; line-height: 1.6; color: var(--ink-2); }
.eh-tabs { margin-top: 26px; }

/* segmented control */
.eh-seg { display: inline-flex; gap: 2px; padding: 4px; border-radius: 14px; background: var(--surface-3); border: 1px solid var(--hairline-2); max-width: 100%; overflow-x: auto; scrollbar-width: none; }
.eh-seg::-webkit-scrollbar { display: none; }
.eh-seg-b { display: inline-flex; align-items: center; gap: 7px; min-height: 40px; padding: 0 18px; border: 0; border-radius: 10px; background: none; font: 500 14px/1 var(--font); color: var(--ink-2); white-space: nowrap; cursor: pointer; transition: background .18s, color .18s, box-shadow .18s; }
.eh-seg-b:hover { color: var(--ink); }
.eh-seg-b.is-on { background: var(--surface); color: var(--ink); font-weight: 600; box-shadow: 0 1px 2px rgba(15,23,42,.08), 0 2px 8px -2px rgba(15,23,42,.10); }
.eh-seg.is-sm .eh-seg-b { min-height: 34px; padding: 0 14px; font-size: 13px; }
.eh-badge { display: inline-flex; align-items: center; justify-content: center; min-width: 20px; height: 20px; padding: 0 6px; border-radius: 99px; background: rgba(15,23,42,.08); font: 600 11px/1 var(--font); color: var(--ink-2); }
.eh-badge.is-alert { background: var(--warn-soft); color: var(--warn); }

/* tiles */
.eh-tiles { display: grid; grid-template-columns: 1.3fr 1fr 1fr; gap: 20px; }
.eh-tiles.is-sm { grid-template-columns: repeat(3, minmax(0, 1fr)); margin: 28px 0 0; }
.eh-tile { display: flex; flex-direction: column; min-width: 0; padding: 22px 24px; border-radius: var(--radius); background: var(--surface); border: 1px solid var(--hairline); box-shadow: var(--shadow-sm); }
.eh-tile.is-main { background: var(--ink); border-color: var(--ink); color: var(--surface-2); box-shadow: var(--shadow-md); }
.eh-tile-k { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 0; font: 600 11px/1.2 var(--font); letter-spacing: .12em; text-transform: uppercase; color: var(--muted); }
.eh-tile.is-main .eh-tile-k { color: rgba(248,247,243,.6); }
.eh-tile-big { display: flex; align-items: baseline; gap: 8px; margin: 14px 0 0; }
.eh-tile-big .n { font: 600 48px/1 var(--font); letter-spacing: -0.04em; font-variant-numeric: tabular-nums; }
.eh-tile-big .u { font-size: 15px; color: var(--muted); }
.eh-tile.is-main .eh-tile-big .u { color: rgba(248,247,243,.65); }
.eh-tile-big.is-soon .n { color: #f3c98b; }
.eh-tile-title { margin: 10px 0 0; font: 600 17px/1.3 var(--font); letter-spacing: -0.015em; }
.eh-tile-title.is-soon { color: var(--warn); }
.eh-tile-sub { margin: 4px 0 0; font-size: 13px; color: var(--muted); }
.eh-tile.is-main .eh-tile-sub { color: rgba(248,247,243,.7); }
.eh-tile-text { margin: 12px 0 0; font-size: 14.5px; line-height: 1.5; color: var(--ink); }
.eh-tile-link { display: inline-flex; align-items: center; gap: 4px; align-self: flex-start; margin-top: auto; padding: 14px 0 0; border: 0; background: none; font: 600 13px/1.3 var(--font); color: var(--ink); text-decoration: none; cursor: pointer; text-align: left; }
.eh-tile-link:hover { text-decoration: underline; text-underline-offset: 3px; }
.eh-tile-link svg { flex: none; transition: transform .2s var(--ease-out); }
.eh-tile-link:hover svg { transform: translateX(2px); }
.eh-hard { display: inline-flex; padding: 2px 8px; border-radius: 99px; background: var(--danger-soft); color: var(--danger); font: 600 10px/1.5 var(--font); letter-spacing: .06em; }
.eh-tile.is-main .eh-hard { background: rgba(248,247,243,.14); color: var(--surface-2); }

/* progress */
.eh-prog { height: 4px; margin: 12px 0 0; border-radius: 99px; background: var(--paper-3); overflow: hidden; }
.eh-prog span { display: block; height: 100%; border-radius: inherit; background: var(--ink); transition: width .4s var(--ease-out); }
[data-stage="idea"] { --dot: #c9c4b6; } [data-stage="proposal"] { --dot: #a99f8a; } [data-stage="reporting"] { --dot: #8a93a3; } [data-stage="drafting"] { --dot: #5b6678; }
[data-stage="draft1"] { --dot: #2e5a87; } [data-stage="editing"] { --dot: #24476b; } [data-stage="final"] { --dot: #2f6b4f; } [data-stage="ready"] { --dot: #0f172a; }
.eh-stage { display: inline-flex; align-items: center; gap: 7px; font: 500 12.5px/1 var(--font); color: var(--ink-2); white-space: nowrap; }
.eh-stage i { width: 8px; height: 8px; border-radius: 50%; background: var(--dot, var(--muted-2)); }
.eh-stage.is-open { color: var(--warn); } .eh-stage.is-open i { background: none; border: 1.5px dashed var(--warn); }
.eh-stage.is-held { color: var(--muted); }
.eh-tag { display: inline-flex; align-items: center; gap: 4px; min-height: 22px; padding: 0 9px; border-radius: 99px; background: var(--surface-3); color: var(--ink-2); font: 600 11px/1 var(--font); white-space: nowrap; }
.eh-tag.is-danger { background: var(--danger-soft); color: var(--danger); }
.eh-tag.is-warn { background: var(--warn-soft); color: var(--warn); }
.eh-tag.is-info, .eh-tag.is-k-update, .eh-tag.is-iv-scheduled { background: var(--info-soft); color: var(--info); }
.eh-tag.is-muted { color: var(--muted); }
.eh-tag.is-k-question { background: var(--warn-soft); color: var(--warn); }
.eh-tag.is-resolved, .eh-tag.is-iv-done { background: var(--good-soft); color: var(--good); }
.eh-tag.is-k-announcement { background: var(--ink); color: var(--surface-2); }
.eh-tag.is-iv-wanted { background: var(--warn-soft); color: var(--warn); }
.eh-you { display: inline-flex; vertical-align: 2px; padding: 1px 7px; border-radius: 99px; background: var(--ink); color: var(--surface-2); font: 600 10px/1.5 var(--font); letter-spacing: .06em; text-transform: uppercase; }
.eh-count { display: inline-flex; align-items: center; gap: 4px; font: 600 12px/1 var(--font); color: var(--warn); }

/* people */
.eh-av { display: inline-flex; flex: none; align-items: center; justify-content: center; overflow: hidden; }
.eh-av img { width: 100%; height: 100%; object-fit: contain; }
.eh-av-init { background: var(--ink); color: var(--surface-2); font-weight: 600; clip-path: polygon(25% 5%, 75% 5%, 100% 50%, 75% 95%, 25% 95%, 0 50%); }
.eh-person { display: inline-flex; align-items: center; gap: 10px; font-size: 13.5px; font-weight: 500; line-height: 1.25; }
.eh-person small { display: block; font: 500 10.5px/1.3 var(--font); letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }

/* lists inside cards */
.eh-list { margin: 0; padding: 0; list-style: none; }
.eh-list > li { position: relative; border-top: 1px solid var(--hairline-2); }
.eh-list > li:first-child { border-top: 0; }
.eh-hit { position: absolute; inset: 0; z-index: 1; border: 0; background: none; cursor: pointer; }
.eh-hit:focus-visible { outline: 2px solid var(--ink); outline-offset: -2px; border-radius: 4px; }
.eh-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px 20px; align-items: center; padding: 16px 24px; transition: background .15s; }
.eh-row:has(.eh-hit):hover, .eh-mine:hover { background: var(--surface-3); }
.eh-row .btn { position: relative; z-index: 2; }
.eh-row-title { margin: 0; font: 600 15px/1.4 var(--font); letter-spacing: -0.01em; color: var(--ink); }
.eh-meta { margin: 3px 0 0; font-size: 13px; line-height: 1.5; color: var(--muted); }
.eh-row-side { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 10px 14px; }
.eh-chev { display: inline-flex; color: var(--muted-2); transition: transform .2s var(--ease-out), color .2s; }
.eh-row:hover .eh-chev, .eh-mine:hover .eh-chev { color: var(--ink); transform: translateX(2px); }
.eh-row.is-open { background: color-mix(in srgb, var(--warn-soft) 45%, transparent); }
.eh-row.is-open .eh-row-title { color: var(--warn); }
.eh-row.is-empty { color: var(--muted); font-size: 13.5px; grid-template-columns: 1fr; }
.eh-mine { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 16px; align-items: center; padding: 20px 24px; transition: background .15s; }
.eh-mine-title { margin: 4px 0 0; font: 600 17px/1.35 var(--font); letter-spacing: -0.015em; }
.eh-mine .eh-prog { max-width: 420px; }
.eh-mine-facts { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 16px; margin: 10px 0 0; font-size: 12.5px; color: var(--muted); }
.eh-card-foot { padding: 10px 16px 12px; border-top: 1px solid var(--hairline-2); }

/* timeline */
.eh-tl { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); margin: 0; padding: 0; list-style: none; }
.eh-tl li { position: relative; display: flex; flex-direction: column; gap: 3px; padding: 0 10px 0 0; }
.eh-tl li::before { content: ""; position: absolute; top: 11px; left: 26px; right: 0; height: 2px; background: var(--paper-3); }
.eh-tl li:last-child::before { display: none; }
.eh-tl li.is-past::before { background: var(--ink); }
.eh-tl-dot { position: relative; z-index: 1; display: grid; place-items: center; width: 24px; height: 24px; margin-bottom: 10px; border-radius: 50%; border: 2px solid var(--paper-3); background: var(--surface); color: var(--surface-2); }
.eh-tl li.is-past .eh-tl-dot { background: var(--ink); border-color: var(--ink); }
.eh-tl li.is-next .eh-tl-dot { border-color: var(--ink); box-shadow: 0 0 0 5px color-mix(in srgb, var(--ink) 10%, transparent); }
.eh-tl li.is-next .eh-tl-dot::after { content: ""; width: 8px; height: 8px; border-radius: 50%; background: var(--ink); }
.eh-tl-date { font: 600 12px/1.3 var(--font); color: var(--muted); font-variant-numeric: tabular-nums; }
.eh-tl-label { font: 600 13.5px/1.35 var(--font); color: var(--ink); padding-right: 8px; }
.eh-tl li.is-past .eh-tl-label { color: var(--muted); }
.eh-tl-hard { font: 600 10.5px/1.3 var(--font); letter-spacing: .04em; color: var(--danger); }
.eh-tl-detail { margin: 22px 0 0; padding: 14px 16px; border-radius: 12px; background: var(--surface-3); font-size: 14px; line-height: 1.6; color: var(--ink-2); }
.eh-tl-detail p { margin: 0; }
.eh-tl-detail-k { margin-bottom: 4px !important; font: 600 11px/1.2 var(--font); letter-spacing: .12em; text-transform: uppercase; color: var(--muted); }
.eh-tl-detail strong { color: var(--ink); }

/* where things stand */
.eh-bar { display: flex; gap: 3px; height: 10px; }
.eh-bar span { border-radius: 3px; background: var(--dot); min-width: 6px; }
.eh-bar-key { display: flex; flex-wrap: wrap; gap: 6px 14px; margin: 12px 0 6px; font-size: 12px; color: var(--muted); }
.eh-bar-key span { display: inline-flex; align-items: center; gap: 6px; }
.eh-bar-key i { width: 8px; height: 8px; border-radius: 2px; background: var(--dot); }
.eh-attn { margin: 12px 0 0; padding: 0; list-style: none; }
.eh-attn li { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; padding: 10px 0; border-top: 1px solid var(--hairline-2); font-size: 13.5px; }

/* checklists */
.eh-checks { margin: 0; padding: 0; list-style: none; }
.eh-check { display: flex; align-items: flex-start; gap: 12px; min-height: 44px; padding: 10px; margin: 0 -10px; border-radius: 10px; cursor: pointer; font-size: 14px; line-height: 1.5; color: var(--ink); }
.eh-check:hover { background: var(--surface-3); }
.eh-check input { position: absolute; opacity: 0; width: 1px; height: 1px; }
.eh-check .box { flex: none; display: grid; place-items: center; width: 20px; height: 20px; margin-top: 1px; border-radius: 6px; border: 1.5px solid color-mix(in srgb, var(--ink) 30%, transparent); background: var(--surface); color: transparent; transition: background .15s, border-color .15s; }
.eh-check.is-done .box { background: var(--ink); border-color: var(--ink); color: var(--surface-2); }
.eh-check.is-done .txt { color: var(--muted); text-decoration: line-through; text-decoration-color: color-mix(in srgb, var(--muted) 50%, transparent); }
.eh-check input:focus-visible + .box { outline: 2px solid var(--ink); outline-offset: 2px; }
.eh-check:has(input:disabled) { cursor: default; }
.eh-check:has(input:disabled):hover { background: none; }

/* guides */
.eh-acc details { border-top: 1px solid var(--hairline-2); }
.eh-acc details:first-child { border-top: 0; }
.eh-acc summary, .eh-secabout summary, .eh-held > summary { display: flex; align-items: center; justify-content: space-between; gap: 12px; list-style: none; cursor: pointer; }
.eh-acc summary::-webkit-details-marker, .eh-secabout summary::-webkit-details-marker, .eh-held > summary::-webkit-details-marker { display: none; }
.eh-acc summary { min-height: 56px; padding: 0 24px; font: 500 15px/1.3 var(--font); color: var(--ink); }
.eh-acc summary:hover { background: var(--surface-3); }
.eh-acc summary svg, .eh-secabout summary svg, .eh-held > summary > svg { flex: none; color: var(--muted); transition: transform .25s var(--ease-out); }
.eh-acc details[open] summary svg, .eh-secabout[open] summary svg, .eh-held[open] > summary > svg { transform: rotate(180deg); }
.eh-acc details > :not(summary) { margin: 0 24px 20px; }
.eh-ticks { margin: 0; padding: 0; list-style: none; }
.eh-ticks li { position: relative; padding: 0 0 10px 24px; font-size: 14px; line-height: 1.6; color: var(--ink-2); }
.eh-ticks li::before { content: ""; position: absolute; left: 3px; top: 8px; width: 9px; height: 5px; border-left: 2px solid var(--ink); border-bottom: 2px solid var(--ink); transform: rotate(-45deg); }
.eh-num { margin: 0; padding: 0; list-style: none; counter-reset: n; }
.eh-num li { counter-increment: n; position: relative; padding: 0 0 12px 34px; font-size: 14px; line-height: 1.6; color: var(--ink-2); }
.eh-num li::before { content: counter(n); position: absolute; left: 0; top: 1px; display: grid; place-items: center; width: 22px; height: 22px; border-radius: 50%; background: var(--surface-3); font: 600 11px/1 var(--font); color: var(--ink); }
.eh-num strong { color: var(--ink); }
.eh-where { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 8px 18px; font-size: 14px; line-height: 1.55; }
.eh-where dt { font-weight: 600; } .eh-where dd { margin: 0; color: var(--ink-2); }
.eh-acc .eh-btnrow { margin-top: 14px; }

/* sections */
.eh-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; }
.eh-search { position: relative; flex: 1 1 280px; display: flex; align-items: center; }
.eh-search svg { position: absolute; left: 14px; color: var(--muted); pointer-events: none; }
.eh-search input { width: 100%; min-height: 44px; padding: 0 14px 0 40px; border: 1px solid var(--hairline); border-radius: 12px; background: var(--surface); font: 400 14px var(--font); color: var(--ink); }
.eh-search input:focus { outline: none; border-color: color-mix(in srgb, var(--ink) 35%, transparent); box-shadow: var(--focus); }
.eh-sec-h { align-items: center; }
.eh-sec-t { display: flex; align-items: center; gap: 16px; min-width: 0; }
.eh-sec-num { margin: 0; font: 600 13px/1 var(--font); color: var(--muted-2); font-variant-numeric: tabular-nums; }
.eh-sec-name { margin: 0; font: 600 20px/1.2 var(--font); letter-spacing: -0.025em; }
.eh-sec-ed { display: flex; align-items: center; gap: 6px; }
.eh-sec-ed .eh-person { margin-right: 6px; }
.eh-secabout { border-bottom: 1px solid var(--hairline-2); }
.eh-secabout summary { justify-content: flex-start; gap: 6px; min-height: 44px; padding: 0 24px; font-size: 13px; font-weight: 500; color: var(--muted); }
.eh-secabout summary:hover { color: var(--ink); }
.eh-secabout p { margin: 0 24px 14px; max-width: 76ch; font-size: 14px; line-height: 1.65; color: var(--ink-2); }
.eh-belongs { padding: 12px 14px; border-radius: 10px; background: var(--surface-3); }
.eh-held > summary { padding-right: 24px; }

/* a piece */
.eh-back { display: inline-flex; align-items: center; gap: 6px; min-height: 40px; margin: 18px 0 0 -10px; padding: 0 12px 0 8px; border: 0; border-radius: 10px; background: none; font: 500 13.5px var(--font); color: var(--ink-2); cursor: pointer; }
.eh-back:hover { background: var(--surface-3); color: var(--ink); }
.eh-ph { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 24px 40px; align-items: start; padding: 18px 0 0; }
.eh-ph-title { margin: 0; max-width: 30ch; font: 600 clamp(26px, 3.4vw, 36px)/1.15 var(--font); letter-spacing: -0.035em; text-wrap: balance; }
.eh-ph-sub { margin: 14px 0 0; max-width: 64ch; font-size: 16px; line-height: 1.6; color: var(--ink-2); }
.eh-people { display: flex; flex-wrap: wrap; gap: 14px 28px; margin: 22px 0 0; }
.eh-placement { display: inline-block; margin: 16px 0 0; padding: 6px 12px; border-radius: 99px; background: var(--surface-3); font-size: 12.5px; color: var(--ink-2); }
.eh-ph-actions { display: flex; flex-direction: column; align-items: stretch; gap: 8px; min-width: 200px; }
.eh-stage-pick { position: relative; display: inline-flex; align-items: center; margin-top: 8px; align-self: flex-start; }
.eh-stage-pick select { appearance: none; -webkit-appearance: none; min-height: 40px; padding: 0 36px 0 0; border: 0; background: none; font: 600 17px/1.3 var(--font); letter-spacing: -0.015em; color: var(--ink); cursor: pointer; }
.eh-stage-pick svg { position: absolute; right: 8px; pointer-events: none; color: var(--muted); }
.eh-stage-pick:hover select { text-decoration: underline; text-underline-offset: 4px; text-decoration-color: color-mix(in srgb, var(--ink) 30%, transparent); }
.eh-ptabs { margin: 28px 0 20px; }
.eh-doc-ctl { display: flex; align-items: center; gap: 10px; }
.eh-switch { display: inline-flex; align-items: center; gap: 8px; min-height: 36px; font-size: 13px; color: var(--ink-2); cursor: pointer; white-space: nowrap; }
.eh-switch input { position: absolute; opacity: 0; width: 1px; height: 1px; }
.eh-switch .tr { position: relative; width: 34px; height: 20px; border-radius: 99px; background: var(--paper-3); transition: background .2s; }
.eh-switch .tr::after { content: ""; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: var(--surface); box-shadow: 0 1px 2px rgba(15,23,42,.25); transition: transform .2s var(--ease-out); }
.eh-switch input:checked + .tr { background: var(--ink); }
.eh-switch input:checked + .tr::after { transform: translateX(14px); }
.eh-switch input:focus-visible + .tr { outline: 2px solid var(--ink); outline-offset: 2px; }
.eh-doc-body { padding: 8px 32px 28px; }
.eh-pg { padding: 22px 0 6px; border-top: 1px solid var(--hairline-2); }
.eh-pg:first-child { border-top: 0; }
.eh-pg > .section-title { margin: 0 0 16px; }
.eh-field { margin: 0 0 22px; max-width: 70ch; }
.eh-flabel { margin: 0 0 6px; font: 600 13px/1.3 var(--font); color: var(--muted); }
.eh-ftext { font: 400 15.5px/1.7 var(--font); color: var(--ink); overflow-wrap: anywhere; }
.eh-ftext p { margin: 0 0 8px; } .eh-ftext p:last-child { margin: 0; }
.eh-ftext a, .eh-note a, .eh-gnote a, .eh-msg-text a { color: var(--info); }
.eh-field.is-key .eh-ftext { padding: 16px 18px; border-radius: 12px; background: var(--surface-3); font-weight: 500; }
.eh-ftext.is-blank { font-size: 13px; color: var(--muted-2); font-style: italic; }
.eh-notes { display: flex; flex-direction: column; gap: 8px; margin: 12px 0 0; }
.eh-note { padding: 12px 14px 12px 16px; border-left: 3px solid #c99a3d; border-radius: 0 12px 12px 0; background: color-mix(in srgb, var(--warn-soft) 70%, var(--surface)); font-size: 13.5px; line-height: 1.6; color: #4a3612; }
.eh-note p { margin: 0 0 6px; } .eh-note p:last-child { margin: 0; }
.eh-note-k { display: block; margin: 0 0 3px; font: 600 10.5px/1.3 var(--font); letter-spacing: .1em; text-transform: uppercase; color: var(--warn); }
.eh-doc-body.hide-notes .eh-notes, .eh-doc-body.hide-notes .eh-general { display: none; }
.eh-gnote { margin: 0 0 10px; padding: 14px 18px; border-radius: 12px; background: var(--surface-3); font-size: 14.5px; line-height: 1.65; color: var(--ink-2); max-width: 75ch; }
.eh-gnote p { margin: 0 0 6px; } .eh-gnote p:last-child { margin: 0; }
.eh-noprop { padding: 40px 32px; }
.eh-noprop h2 { margin: 0 0 8px; font: 600 20px/1.3 var(--font); letter-spacing: -0.02em; }
.eh-noprop p { margin: 0 0 18px; max-width: 60ch; font-size: 14.5px; line-height: 1.6; color: var(--ink-2); }
.eh-noprop .eh-ticks { margin-bottom: 18px; }
.eh-iv { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 16px 24px; }
.eh-iv-note { font-style: italic; }

/* questions */
.eh-compose-card { padding: 18px 20px; }
.eh-compose-top { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; margin: 0 0 12px; }
.eh-about { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; color: var(--muted); }
.eh-about select { width: auto; min-height: 38px; max-width: min(420px, 60vw); padding: 0 30px 0 12px; border: 1px solid var(--hairline); border-radius: 10px; background-color: var(--surface); font: 500 13px var(--font); color: var(--ink); }
.eh-compose textarea { display: block; width: 100%; min-height: 92px; padding: 12px 14px; border: 1px solid var(--hairline); border-radius: 12px; background: var(--surface-2); font: 400 14.5px/1.55 var(--font); color: var(--ink); resize: vertical; transition: border-color .15s, box-shadow .15s; }
.eh-compose textarea:focus { outline: none; border-color: color-mix(in srgb, var(--ink) 35%, transparent); box-shadow: var(--focus); background: var(--surface); }
.eh-compose-foot { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; margin: 12px 0 0; }
.eh-to { margin: 0; font-size: 12.5px; color: var(--muted); }
.eh-to strong { color: var(--ink-2); font-weight: 600; }
.modal .eh-compose { padding: 0; }
.eh-threads { margin: 0; padding: 0; list-style: none; }
.eh-msg { display: grid; grid-template-columns: 38px minmax(0, 1fr); gap: 14px; padding: 20px 24px; border-top: 1px solid var(--hairline-2); }
.eh-threads > .eh-msg:first-child { border-top: 0; }
.eh-msg.is-open { box-shadow: inset 3px 0 0 #c99a3d; }
.eh-msg.is-announce { background: var(--surface-3); }
.eh-msg.is-auto .eh-msg-text { font-size: 13.5px; color: var(--muted); }
.eh-msg-head { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; margin: 0; font-size: 13.5px; }
.eh-msg-head .eh-muted { font-size: 12.5px; }
.eh-msg-head time { margin-left: auto; font-size: 12px; color: var(--muted); }
.eh-msg-ctx { margin: 2px 0 0; font-size: 12.5px; color: var(--muted); }
.eh-msg-text { margin: 8px 0 0; max-width: 72ch; font-size: 14.5px; line-height: 1.6; overflow-wrap: anywhere; }
.eh-msg-text p { margin: 0 0 6px; } .eh-msg-text p:last-child { margin: 0; }
.eh-msg-actions { display: flex; flex-wrap: wrap; gap: 2px; margin: 8px 0 0 -8px; }
.eh-act { display: inline-flex; align-items: center; min-height: 32px; padding: 0 8px; border: 0; border-radius: 8px; background: none; font: 500 12.5px var(--font); color: var(--muted); cursor: pointer; }
.eh-act:hover { background: var(--surface-3); color: var(--ink); }
.eh-act.is-danger:hover { background: var(--danger-soft); color: var(--danger); }
.eh-replies { margin: 14px 0 0; padding: 0; list-style: none; border-left: 2px solid var(--hairline); }
.eh-msg.is-reply { grid-template-columns: 28px minmax(0, 1fr); gap: 10px; padding: 8px 0 8px 16px; border: 0; box-shadow: none; }
.eh-msg.is-reply .eh-msg-text { margin-top: 3px; font-size: 14px; }
.eh-reply-form { margin: 12px 0 0; }
.eh-reply-form textarea { display: block; width: 100%; min-height: 64px; padding: 10px 12px; border: 1px solid var(--hairline); border-radius: 10px; background: var(--surface); font: 400 14px/1.5 var(--font); resize: vertical; }
.eh-reply-form textarea:focus { outline: none; box-shadow: var(--focus); border-color: color-mix(in srgb, var(--ink) 35%, transparent); }
.eh-reply-foot { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 8px; }
.eh-reply-foot > span { display: inline-flex; gap: 6px; }
.eh-inline-check { display: inline-flex; align-items: center; gap: 8px; min-height: 36px; font-size: 13px; color: var(--ink-2); cursor: pointer; }

/* social */
.eh-lu { padding: 18px 24px; }
.eh-lu-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.eh-hook { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin: 12px 0 0; padding: 12px 14px; border-radius: 12px; background: var(--surface-3); }
.eh-hook p { margin: 0; font-size: 14px; line-height: 1.55; color: var(--ink); max-width: 72ch; }
.eh-lu-dl { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 4px 16px; margin: 12px 0 0; font-size: 13px; line-height: 1.55; }
.eh-lu-dl dt { font: 600 11px/1.9 var(--font); letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
.eh-lu-dl dd { margin: 0; color: var(--ink-2); }
.eh-quote { margin: 0; font-size: 14.5px; line-height: 1.65; color: var(--ink-2); }
.eh-chips { display: flex; flex-wrap: wrap; gap: 8px; margin: 0; }
.eh-chip { padding: 7px 12px; border-radius: 99px; background: var(--surface-3); font-size: 13px; color: var(--ink); }

/* forms (modals) */
.eh-form { display: flex; flex-direction: column; gap: 14px; }
.eh-f { display: flex; flex-direction: column; gap: 6px; min-width: 0; flex: 1; border: 0; padding: 0; margin: 0; }
.eh-f-l { font: 600 12.5px var(--font); color: var(--ink); }
.eh-f-h { margin: 0; font-size: 12.5px; color: var(--muted); }
.eh-f-row { display: flex; flex-wrap: wrap; gap: 12px; }
.eh-f-row > .eh-f { flex: 1 1 180px; }
.eh-form .input { width: 100%; }
.eh-form textarea.input { resize: vertical; min-height: 64px; }
.eh-fs { display: flex; flex-direction: column; gap: 12px; margin: 0; padding: 14px 14px 10px; border: 1px solid var(--hairline); border-radius: 12px; }
.eh-fs legend { padding: 0 6px; font: 600 11px var(--font); letter-spacing: .12em; text-transform: uppercase; color: var(--muted); }
.eh-fs > .btn { align-self: flex-start; }
.eh-pick { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 4px 12px; max-height: 220px; overflow: auto; padding: 4px 2px; }
.eh-pick-i { display: flex; align-items: center; gap: 8px; min-height: 36px; font-size: 13.5px; cursor: pointer; }
.eh-left { margin-right: auto; }

.eh-empty { padding: 80px 20px; text-align: center; }
.eh-empty h2 { margin: 0 0 8px; font: 600 22px var(--font); letter-spacing: -0.02em; }
.eh-empty p { margin: 0; color: var(--muted); }

@media (max-width: 960px) {
  .eh-tiles, .eh-tiles.is-sm { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .eh-tiles > .is-main { grid-column: 1 / -1; }
  .eh-tiles.is-sm > :first-child { grid-column: 1 / -1; }
  .eh-grid-2 { grid-template-columns: minmax(0, 1fr); }
  .eh-ph { grid-template-columns: minmax(0, 1fr); }
  .eh-ph-actions { flex-direction: row; flex-wrap: wrap; min-width: 0; }
  .eh-tl { grid-auto-flow: row; grid-auto-columns: auto; gap: 0; }
  .eh-tl li { display: grid; grid-template-columns: 24px 74px minmax(0, 1fr); column-gap: 14px; align-items: start; padding: 0 0 18px; }
  .eh-tl li::before { top: 24px; bottom: 0; left: 11px; right: auto; width: 2px; height: auto; }
  .eh-tl-dot { grid-row: 1 / span 2; margin: 0; }
  .eh-tl-date { padding-top: 4px; }
  .eh-tl-label { grid-column: 3; grid-row: 1; padding-top: 2px; }
  .eh-tl-hard { grid-column: 3; }
}
@media (max-width: 640px) {
  .eh-head { padding-top: 14px; }
  .eh-tiles { grid-template-columns: minmax(0, 1fr); gap: 12px; }
  .eh-tiles.is-sm { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
  .eh-tiles.is-sm .eh-tile { padding: 16px; }
  .eh-wide { display: none; }
  .eh-tile-big .n { font-size: 40px; }
  .eh-seg:not(.is-sm) { display: flex; width: 100%; }
  .eh-seg:not(.is-sm) .eh-seg-b { flex: 1 0 auto; padding: 0 12px; justify-content: center; }
  .eh-row { grid-template-columns: minmax(0, 1fr); padding: 14px 18px; }
  .eh-row-side { justify-content: flex-start; }
  .eh-row-side .eh-chev { display: none; }
  .eh-mine { padding: 18px; }
  .eh-sec-ed { width: 100%; }
  .eh-doc-body { padding: 4px 18px 22px; }
  .eh-msg { padding: 16px 18px; gap: 10px; grid-template-columns: 32px minmax(0, 1fr); }
  .eh-msg-head time { margin-left: 0; flex-basis: 100%; }
  .eh-about select { flex: 1; max-width: none; }
  .eh-compose .eh-about { flex-basis: 100%; }
  .eh-where, .eh-lu-dl { grid-template-columns: minmax(0, 1fr); gap: 2px; }
  .eh-where dd, .eh-lu-dl dd { margin-bottom: 8px; }
  .eh-acc summary { padding: 0 18px; }
  .eh-acc details > :not(summary) { margin: 0 18px 18px; }
  .eh-lu, .eh-iv { padding: 16px 18px; }
  .eh-hook { flex-direction: column; }
  .eh-tl li { grid-template-columns: 24px 64px minmax(0, 1fr); }
}
@media (prefers-reduced-motion: reduce) {
  .eh *, .eh *::before, .eh *::after { transition: none !important; animation: none !important; }
  .eh-word { opacity: 1; transform: none; }
}
`;
  document.head.appendChild(s);
}
