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
//
// Data (Firestore, staff only — see firestore.rules "This edition"):
//   edition_hub/{EDITION}            sections + editors, dates, guidance
//   edition_hub/{EDITION}/pieces     one doc per piece (proposal, notes, status)
//   edition_hub/{EDITION}/messages   questions, updates, replies, announcements
//   edition_hub/{EDITION}/activity   who did what, gathered from the team inbox
//                                    and the Drive (written with the Admin SDK);
//                                    editors and admins only, shown on Overview
// Seeded from the proposals by scripts/seed-edition-hub.mjs (the data file is
// private, outside git). Posting also calls /api/edition/notify, which rings
// the bell for the piece's writers and section editor.
//
// Who can change what (mirrors the rules): admins anything; section editors
// any piece and the editors' to-dos; a piece's writers its stage,
// checklist, interviews, title/format and their own proposal.

import { db, auth } from "../firebase-config.js";
import {
  collection, doc, onSnapshot, query, orderBy, limit, addDoc, updateDoc, deleteDoc, getDocs, setDoc,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { el, esc, toast, fmtRelative, openModal, confirmDialog, slugify, initials } from "./ui.js";

// The edition this page plans. Point it at the next edition's hub doc when
// that one is seeded.
const EDITION = "winter-2027";

const STAGES = [
  { id: "idea", label: "Needs a proposal", short: "Proposal", hint: "No proposal yet" },
  { id: "proposal", label: "Proposal reviewed", short: "Reviewed", hint: "The editors have left feedback" },
  { id: "reporting", label: "Interviewing and research", short: "Reporting", hint: "Interviews and research" },
  { id: "drafting", label: "Writing the first draft", short: "Writing", hint: "Turning it into a draft" },
  { id: "draft1", label: "First draft in", short: "Draft in", hint: "Uploaded to the Drive" },
  { id: "editing", label: "Editing with the editor", short: "Editing", hint: "Back and forth with the editor" },
  { id: "final", label: "Final draft in", short: "Final in", hint: "Submitted in the Suite" },
  { id: "ready", label: "Ready to publish", short: "Ready", hint: "Ready to go out" },
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
const cache = { hub: null, pieces: null, messages: null, bios: null, staff: null, banners: null, activity: null };

const DAY = 86400000;
const parseDay = (s) => { const [y, m, d] = String(s || "").split("-").map(Number); return y ? new Date(y, m - 1, d) : null; };
const today = () => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); };
const daysUntil = (s) => { const d = parseDay(s); return d ? Math.round((d - today()) / DAY) : null; };
const fmtDay = (s, opts = { weekday: "short", month: "short", day: "numeric" }) => { const d = parseDay(s); return d ? d.toLocaleDateString("en-US", opts) : ""; };
const LONG = { weekday: "long", month: "long", day: "numeric" };
const sameName = (a, b) => !!a && !!b && String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
const firstName = (n) => String(n || "").trim().split(/\s+/)[0] || "Someone";
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
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
  // Google's own marks, so a button reads at a glance as "this opens Google Drive / Docs".
  gdrive: `<svg class="eh-gicon" viewBox="0 0 87.3 78" width="16" height="16" aria-hidden="true"><path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" fill="#0066da"/><path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0-1.2 4.5h27.5z" fill="#00ac47"/><path d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z" fill="#ea4335"/><path d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d"/><path d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc"/><path d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00"/></svg>`,
  gdoc: `<svg class="eh-gicon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M14.5 2H6.2A2.2 2.2 0 0 0 4 4.2v15.6A2.2 2.2 0 0 0 6.2 22h11.6a2.2 2.2 0 0 0 2.2-2.2V7.5z" fill="#4285f4"/><path d="M14.5 2v4.3a1.2 1.2 0 0 0 1.2 1.2H20z" fill="#a1c2fa"/><path d="M8 12h8M8 15h8M8 18h5" stroke="#f8f7f3" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  ext: svg(`<path d="M7 17 17 7M8 7h9v9"/>`, 13),
  tracker: svg(`<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/>`, 15),
  link: svg(`<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>`, 15),
  mail: svg(`<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>`, 13),
};

export async function mount(ctx, container) {
  injectStyle();
  document.body.classList.add("eh-calm");
  container.classList.add("eh-content");
  const params = new URLSearchParams((location.hash.split("?")[1]) || "");
  const TABS = ["overview", "pieces", "talk"];
  const tabParam = params.get("tab") === "sections" ? "pieces" : params.get("tab");
  const view = {
    tab: TABS.includes(tabParam) ? tabParam : "overview",
    piece: params.get("piece") || null,
    pieceTab: params.get("view") === "talk" ? "talk" : "",
    sec: params.get("sec") || "",
    q: "", filter: "all", talkFilter: "all", showNotes: false,
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
  let banners = cache.banners || new Map();
  let activity = cache.activity || [];
  const unsubs = [];
  // When this person last saw the activity window, as it stood when the page
  // opened: entries after it get a dot for this visit.
  const seenKey = `eh.activitySeen.${ctx.user?.uid || ""}`;
  let seenAt = "";
  try { seenAt = localStorage.getItem(seenKey) || ""; } catch {}

  container.innerHTML = "";
  const root = el("div", { class: "eh" });
  container.appendChild(root);

  // ── live data
  const hubRef = doc(db, "edition_hub", EDITION);
  let activityOn = false;
  unsubs.push(onSnapshot(hubRef, (s) => {
    hub = s.exists() ? { id: s.id, ...s.data() } : null; cache.hub = hub;
    // Editors and admins only (the rules agree), so subscribe once we know.
    if (hub && !activityOn && canEdit()) {
      activityOn = true;
      unsubs.push(onSnapshot(query(collection(hubRef, "activity"), orderBy("at", "desc"), limit(300)), (a) => {
        activity = a.docs.map((d) => ({ id: d.id, ...d.data() })); cache.activity = activity; render();
      }, (err) => console.warn("[edition] activity", err?.message)));
    }
    render();
  }, (err) => fail(err)));
  unsubs.push(onSnapshot(collection(hubRef, "pieces"), (s) => {
    pieces = s.docs.map((d) => ({ id: d.id, ...d.data() }));
    cache.pieces = pieces; render();
  }, (err) => fail(err)));
  unsubs.push(onSnapshot(query(collection(hubRef, "messages"), orderBy("createdAt", "desc"), limit(500)), (s) => {
    messages = s.docs.map((d) => ({ id: d.id, ...d.data() }));
    cache.messages = messages; render();
  }, (err) => console.warn("[edition] messages", err?.message)));
  unsubs.push(onSnapshot(collection(hubRef, "banners"), (s) => {
    banners = new Map(s.docs.map((d) => [d.id, d.data()])); cache.banners = banners; render();
  }, (err) => console.warn("[edition] banners", err?.message)));
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
    if (view.piece) { qs.set("piece", view.piece); if (view.pieceTab) qs.set("view", view.pieceTab); }
    else if (view.tab !== "overview") { qs.set("tab", view.tab); if (view.tab === "pieces" && view.sec && view.sec !== "all") qs.set("sec", view.sec); }
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
      <h1 class="eh-title" aria-label="${esc(hub.theme || "The Future of Health is blank.")}">The Future of Health is <span class="eh-blank" aria-hidden="true"><span class="eh-word"></span></span><span class="eh-stop" aria-hidden="true">.</span></h1>
      <p class="eh-lede">${plural(total, "piece")} in ${plural((hub.sections || []).length, "section")}. Launches ${esc(fmtDay(hub.launch, LONG))}.</p>
      <nav class="eh-seg eh-tabs" aria-label="This edition">
        ${[["overview", "Overview", ""], ["pieces", "Pieces", ""], ["talk", "Questions", open ? String(open) : ""]].map(([id, l, n]) => `
          <button type="button" class="eh-seg-b${view.tab === id ? " is-on" : ""}" data-go="${id}" ${view.tab === id ? 'aria-current="page"' : ""}>${l}${n ? `<span class="eh-badge">${n}</span>` : ""}</button>`).join("")}
      </nav>`;
    // The blank fills itself in with each section's name.
    const slot = node.querySelector(".eh-word");
    // "Decided in D.C." and "Human?" bring their own punctuation.
    const stop = node.querySelector(".eh-stop");
    const setWord = (w) => { slot.textContent = w; stop.hidden = /[.?!]$/.test(w); };
    clearInterval(wordTimer);
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (words.length) {
      let i = 0;
      setWord(words[0]);
      slot.classList.add("is-in");
      if (!reduce) {
        wordTimer = setInterval(() => {
          slot.classList.remove("is-in");
          setTimeout(() => { i = (i + 1) % words.length; setWord(words[i]); slot.classList.add("is-in"); }, 280);
        }, 3200);
      }
    }
    return node;
  }

  // ── Overview
  function overviewView() {
    const wrap = el("div", { class: "eh-stack" });
    wrap.appendChild(nextUp());
    if (canEdit()) wrap.appendChild(activityCard());
    // Pinned notes from the sections this person writes or edits in.
    const mySecIds = new Set([...mySections().map((s) => s.id), ...pieces.filter((p) => isMine(p)).map((p) => p.section)]);
    const notes = (hub.sections || []).filter((s) => mySecIds.has(s.id) && banners.get(s.id)?.text);
    if (notes.length) { const n = el("div", { class: "eh-stack eh-notes-top" }); n.innerHTML = notes.map((s) => bannerHtml(s, { compact: true })).join(""); wrap.appendChild(n); }
    const mine = sorted(pieces.filter((p) => isMine(p) && p.section !== "held"));
    if (mine.length) wrap.appendChild(myPieces(mine));
    mySections().forEach((s) => wrap.appendChild(mySection(s)));
    wrap.appendChild(timeline());
    wrap.appendChild(attention());
    if (canEdit()) wrap.appendChild(editorsDesk());
    wrap.appendChild(guides());
    return wrap;
  }

  function nextHard() {
    const list = (hub.dates || []).filter((d) => d.hard).map((d) => ({ ...d, n: daysUntil(d.date) })).filter((d) => d.n >= 0);
    return list.sort((a, b) => a.n - b.n)[0] || null;
  }

  // The deadlines everyone works to: each hard deadline and launch day, with
  // a countdown. The next one is dark.
  function nextUp() {
    const node = el("section", { class: "eh-tiles", "aria-label": "Deadlines" });
    const items = [...(hub.dates || []).filter((d) => d.hard), { id: "launch", label: "Launch day", date: hub.launch, launch: true }];
    const nextIdx = items.findIndex((d) => daysUntil(d.date) >= 0);
    node.innerHTML = items.map((d, i) => {
      const n = daysUntil(d.date);
      const next = i === nextIdx;
      return `<article class="eh-tile${next ? " is-main" : ""}${n < 0 ? " is-past" : ""}">
        <p class="eh-tile-k">${next ? "Next deadline" : d.launch ? "Launch" : "Deadline"}${d.hard ? ` <span class="eh-hard">Hard deadline</span>` : ""}</p>
        <p class="eh-tile-big${!d.launch && n >= 0 && n <= 7 ? " is-soon" : ""}">${n < 0 ? `<span class="n">${d.launch ? "Live" : "Done"}</span>` : n === 0 ? `<span class="n">Today</span>` : `<span class="n">${n}</span><span class="u">${n === 1 ? "day" : "days"}</span>`}</p>
        <p class="eh-tile-title">${esc(d.label)}</p>
        <p class="eh-tile-sub">${esc(fmtDay(d.date, LONG))}</p>
      </article>`;
    }).join("");
    return node;
  }

  // ── Activity: who has been working on what (editors and admins). A section
  // editor sees their sections; admins see the whole edition.
  function activityCard() {
    const node = el("section", { class: "card eh-act-card" });
    const mine = mySections();
    const scope = isAdmin || !mine.length ? null : new Set(mine.map((s) => s.id));
    const inScope = (secId) => !scope || scope.has(secId);
    const items = activity.filter((a) => inScope(a.sectionId));
    const scopeName = scope ? mine.map((s) => s.name).join(" & ") : "The whole edition";
    const checked = hub.activityCheckedAt;
    const fresh = checked && (Date.now() - Date.parse(checked)) < 36 * 3600 * 1000;
    const dayKey = (iso) => { const d = new Date(iso); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
    const dayLabel = (iso) => {
      const d = new Date(iso), t = today(), y = new Date(t.getTime() - DAY);
      const k = dayKey(iso);
      if (k === dayKey(t.toISOString())) return "Today";
      if (k === dayKey(y.toISOString())) return "Yesterday";
      return d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
    };
    const SRC = { drive: { icon: ICON.gdrive, label: "Drive" }, email: { icon: ICON.mail, label: "Email" }, suite: { icon: ICON.note, label: "Suite" }, meeting: { icon: ICON.note, label: "Meeting" } };
    const shown = view.allActivity ? items : items.slice(0, 6);
    let lastDay = "";
    const rows = shown.map((a) => {
      const day = dayLabel(a.at);
      const head = day !== lastDay ? `<li class="eh-act-day">${esc(day)}</li>` : "";
      lastDay = day;
      const p = a.pieceId ? pieces.find((x) => x.id === a.pieceId) : null;
      const who = (a.people || []).join(" & ") || "Someone";
      const src = SRC[a.source] || null;
      const isNew = seenAt && a.at > seenAt;
      return `${head}<li class="eh-act-row${isNew ? " is-new" : ""}">
        ${avatar({ name: (a.people || [])[0] || who }, 30)}
        <div class="eh-act-main">
          <p class="eh-act-text"><b>${esc(who)}</b> ${esc(a.text || "")}</p>
          <p class="eh-act-meta">${p ? `<button type="button" class="eh-act-piece" data-piece="${esc(p.id)}">${esc(clip(p.title, 70))}</button>` : a.pieceTitle ? `<span>${esc(clip(a.pieceTitle, 70))}</span>` : ""}${!scope || scope.size > 1 ? `<span>${esc(section(a.sectionId)?.name || "")}</span>` : ""}${src ? `<span class="eh-act-src">${src.icon}${a.link ? `<a href="${esc(a.link)}" target="_blank" rel="noopener">${src.label}</a>` : src.label}</span>` : ""}<time datetime="${esc(a.at)}">${esc(new Date(a.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }))}</time></p>
        </div>
        ${isNew ? `<span class="eh-act-dot" aria-label="New since your last visit"></span>` : ""}
      </li>`;
    }).join("");
    // Pieces with no news in a week (from what the inbox and Drive show).
    const weekAgo = new Date(Date.now() - 7 * DAY).toISOString();
    const active = new Set(items.filter((a) => a.at >= weekAgo).map((a) => a.pieceId));
    const quiet = sorted(realPieces().filter((p) => inScope(p.section) && !active.has(p.id)));
    const newCount = seenAt ? items.filter((a) => a.at > seenAt).length : 0;
    node.innerHTML = `
      <div class="eh-act-head">
        <div>
          <h2 class="eh-act-title">Activity${newCount ? `<span class="eh-act-new">${newCount} new</span>` : ""}</h2>
          <p class="eh-act-scope">${esc(scopeName)} · from the team inbox and the Drive</p>
        </div>
        ${checked ? `<p class="eh-act-checked${fresh ? " is-fresh" : ""}" title="When the inbox and the Drive were last checked"><i></i>Checked ${esc(new Date(checked).toLocaleDateString("en-US", { month: "short", day: "numeric" }))}</p>` : ""}
      </div>
      ${items.length ? `<ol class="eh-act-list">${rows}</ol>
        ${items.length > 6 ? `<button type="button" class="eh-act-more" data-all-activity>${view.allActivity ? "Show less" : `Show all ${items.length}`}</button>` : ""}`
        : `<p class="eh-act-empty">No activity yet. Updates from the inbox and the Drive will show up here.</p>`}
      ${quiet.length ? `<div class="eh-act-quiet"><p class="eh-act-quiet-k">No news in the last week</p><p class="eh-act-quiet-v">${quiet.map((p) => `<button type="button" class="eh-act-qp" data-piece="${esc(p.id)}">${esc(firstNames(p.writers) || "Unassigned")}<span>${esc(clip(p.title, 42))}</span></button>`).join("")}</p></div>` : ""}`;
    // Mark everything as seen for next time.
    try { localStorage.setItem(seenKey, new Date().toISOString()); } catch {}
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
            <p class="eh-mine-facts">${stage(p)}${steps.length ? `<span>${done} of ${steps.length} steps done</span>` : ""}${(() => { const n = noteList(p).length; return n ? `<span>${plural(n, "editor's note", "editors' notes")}</span>` : ""; })()}${ed ? `<span>Editor: ${esc(ed.name)}</span>` : ""}${qN ? `<span class="eh-tag is-info">${plural(qN, "question")} for you</span>` : ""}${f && f.tone !== "muted" ? `<span class="eh-tag is-${f.tone}">${esc(f.text)}</span>` : ""}</p>
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

  // Progress at a glance: the one number that matters right now (first
  // drafts in, then final drafts), the stages as a strip, and every piece as
  // a small card under the stage it's at, left to right like a board.
  function attention() {
    const node = el("section", { class: "card eh-progress" });
    const list = sorted(realPieces());
    const first = hardDate("first-draft"), fin = hardDate("final-draft");
    const firstN = list.filter((p) => (STAGE_INDEX[p.status] ?? 0) >= STAGE_INDEX.draft1).length;
    const finalN = list.filter((p) => (STAGE_INDEX[p.status] ?? 0) >= STAGE_INDEX.final).length;
    const pastFirst = first && daysUntil(first.date) < 0;
    const [got, due, label] = pastFirst && fin ? [finalN, fin, "final drafts in"] : [firstN, first, "first drafts in"];
    const open = live().filter((p) => p.status === "open");
    const groups = STAGES.map((s) => ({ s, ps: list.filter((p) => (p.status || "idea") === s.id) }));
    const stale = openQs((m) => Date.now() - new Date(m.createdAt).getTime() > 2 * DAY).length;
    const dn = due ? daysUntil(due.date) : null;
    const pct = list.length ? Math.round((got / list.length) * 100) : 0;
    const card = (p) => `<li><button type="button" class="eh-pc" data-piece="${esc(p.id)}" title="${esc(p.title)}">
        <span class="eh-pc-av">${(p.writers || []).slice(0, 2).map((w) => avatar(w, 24)).join("")}</span>
        <span class="eh-pc-t">${esc(p.title)}</span>
        <span class="eh-pc-w">${esc(firstNames(p.writers))}</span>
      </button></li>`;
    node.innerHTML = `
      <div class="card-header eh-ch">
        <div><h2 class="card-title">Progress</h2><p class="card-subtitle">Where every piece is right now. Tap one to open it.</p></div>
      </div>
      <div class="card-body">
        <div class="eh-pg-top">
          <div class="eh-pg-num"><strong>${got}</strong><span>of ${list.length}</span></div>
          <div class="eh-pg-meta">
            <p class="eh-pg-label">${esc(label.charAt(0).toUpperCase() + label.slice(1))}</p>
            <div class="eh-prog is-lg" role="img" aria-label="${pct}%"><span style="width:${pct}%"></span></div>
            ${due ? `<p class="eh-meta">${esc(due.label)}: ${esc(fmtDay(due.date, LONG))} <span class="${dn <= 7 ? "eh-soon" : ""}">(${esc(inDays(dn))})</span></p>` : ""}
          </div>
        </div>
        <ol class="eh-strip" aria-label="Pieces at each stage">${groups.map(({ s, ps }) => `
          <li class="${ps.length ? "" : "is-zero"}" data-stage="${s.id}"><span class="eh-strip-n">${ps.length}</span><span class="eh-strip-l">${esc(s.label)}</span></li>`).join("")}</ol>
        <div class="eh-board">
          ${groups.filter((g) => g.ps.length).map(({ s, ps }) => `<section class="eh-col" data-stage="${s.id}">
            <h3 class="eh-col-h"><i></i>${esc(s.label)}<span>${ps.length}</span></h3>
            <ul>${ps.map(card).join("")}</ul>
          </section>`).join("")}
          ${open.length ? `<section class="eh-col is-open">
            <h3 class="eh-col-h"><i></i>Open slots<span>${open.length}</span></h3>
            <ul>${open.map((p) => `<li><button type="button" class="eh-pc is-open" data-piece="${esc(p.id)}"><span class="eh-pc-t">${esc(section(p.section)?.name)}</span><span class="eh-pc-w">${esc(p.title !== "Open slot" ? p.title.replace(/^Open slot:\s*/i, "") : "An op-ed or Q&A")}</span></button></li>`).join("")}</ul>
          </section>` : ""}
        </div>
        ${stale ? `<p class="eh-stale"><span class="eh-tag is-info">${plural(stale, "question")}</span> waiting more than two days for an answer. <button type="button" class="eh-link" data-go="talk">Answer</button></p>` : ""}
      </div>`;
    return node;
  }

  function editorsDesk() {
    const node = el("section", { class: "card" });
    const row = (t, key, attr) => `<li><label class="eh-check${t[key] ? " is-done" : ""}"><input type="checkbox" ${attr}="${esc(t.id)}" ${t[key] ? "checked" : ""}><span class="box">${ICON.check}</span><span class="txt">${esc(t.text)}</span></label></li>`;
    node.innerHTML = `
      <div class="card-header eh-ch"><div><h2 class="card-title">Editors' desk</h2><p class="card-subtitle">Shared by the editors. Tick things off as you go.</p></div><button type="button" class="btn btn-ghost btn-sm" data-edit-desk>${ICON.edit} Edit list</button></div>
      <div class="card-body eh-desk-cols">
        <div><p class="section-title eh-st">To do</p>
        <ul class="eh-checks">${(hub.editorTodos || []).map((t) => row(t, "done", "data-todo")).join("") || `<li class="eh-muted">Nothing to do.</li>`}</ul></div>
        <div><p class="section-title eh-st">Still deciding</p>
        <ul class="eh-checks">${(hub.decisions || []).map((t) => row(t, "resolved", "data-decision")).join("") || `<li class="eh-muted">Nothing open.</li>`}</ul></div>
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
          ${drive.length ? `<p class="eh-btnrow">${drive.map((s) => `<a class="btn btn-secondary btn-sm eh-g" href="${esc(s.draftsUrl || s.driveUrl)}" target="_blank" rel="noopener">${ICON.gdrive} ${esc(s.name)} drafts <span class="eh-g-k">Google Drive</span></a>`).join("")}</p>` : ""}</details>
        ${(hub.links || []).length ? `<details><summary><span>Documents: templates and guides</span>${ICON.down}</summary>
          <ul class="eh-doclinks">${hub.links.map((l) => `<li><a href="${esc(l.url)}" target="_blank" rel="noopener">${/\/folders\//.test(l.url) ? ICON.gdrive : ICON.gdoc}<span><strong>${esc(l.label)}</strong>${l.note ? `<small>${esc(l.note)}</small>` : ""}</span></a></li>`).join("")}</ul></details>` : ""}
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

  // ── section banners: a note each section's editor pins for their writers
  // (edition_hub/{ed}/banners/{sectionId}; see firestore.rules).
  const TONES = {
    note: { label: "Note", icon: svg(`<path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1z"/><path d="M15 9a3 3 0 0 1 0 6M18 6a7 7 0 0 1 0 12"/>`, 18) },
    important: { label: "Important", icon: svg(`<path d="M12 3 2 21h20z"/><path d="M12 10v5M12 18h.01"/>`, 18) },
    good: { label: "Good news", icon: svg(`<path d="m12 3 2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z"/>`, 18) },
  };
  const canEditSection = (s) => isAdmin || edits(s);
  function bannerHtml(s, { compact = false } = {}) {
    const b = banners.get(s.id);
    const can = canEditSection(s);
    if (!b?.text) return can && !compact ? `<button type="button" class="eh-banner-add" data-banner="${esc(s.id)}">${ICON.plus}<span><strong>Pin a note for ${esc(s.name)}</strong><small>Announcements, reminders, remarks. Everyone in the section sees it here and on their piece.</small></span></button>` : "";
    const t = TONES[b.tone] || TONES.note;
    return `<aside class="eh-banner is-${esc(b.tone || "note")}${compact ? " is-compact" : ""}">
      <span class="eh-banner-ic">${t.icon}</span>
      <div class="eh-banner-body">
        <p class="eh-banner-k">${compact ? `${esc(s.name)} · ` : ""}${esc(t.label)} from ${esc(b.byName || "the editor")}<span> · ${esc(fmtRelative(b.at))}</span></p>
        <div class="eh-banner-text">${rich(b.text)}</div>
      </div>
      ${can && !compact ? `<button type="button" class="btn btn-ghost btn-sm" data-banner="${esc(s.id)}">${ICON.edit} Edit</button>` : ""}
    </aside>`;
  }

  // Everyone writing in a section (not the open slots), as people.
  const sectionWriters = (s) => {
    const out = [];
    pieces.filter((p) => p.section === s.id && p.status !== "open").flatMap((p) => p.writers || [])
      .forEach((w) => { if (!out.some((x) => sameName(x.name, w.name))) out.push(w); });
    return out;
  };

  // ── Pieces: a switcher across the sections; "All" shows them side by side,
  // a section opens its own page with its editor, note and pieces.
  function defaultSection() {
    const mine = mySections()[0]?.id;
    if (mine) return mine;
    const secs = [...new Set(pieces.filter((p) => isMine(p) && p.section !== "held").map((p) => p.section))];
    return secs.length === 1 ? secs[0] : "all";
  }
  function piecesView() {
    if (!view.sec) view.sec = defaultSection();
    const wrap = el("div", { class: "eh-stack" });
    const held = pieces.filter((p) => p.section === "held");
    const count = (id) => pieces.filter((p) => p.section === id && p.status !== "open").length;
    const tabs = [["all", "All sections", realPieces().length], ...(hub.sections || []).map((s) => [s.id, s.name, count(s.id)]), ...(held.length ? [["held", "Held", held.length]] : [])];
    const sw = el("nav", { class: "eh-seg eh-secnav", "aria-label": "Sections" });
    sw.innerHTML = tabs.map(([id, l, n]) => {
      const s = section(id);
      const me2 = s && (edits(s) || pieces.some((p) => p.section === id && isMine(p)));
      return `<button type="button" class="eh-seg-b${view.sec === id ? " is-on" : ""}" data-sec="${esc(id)}" ${view.sec === id ? 'aria-current="page"' : ""}>${esc(l)}<span class="eh-badge">${n}</span>${me2 ? `<span class="eh-dot-you" title="You're in this section"></span>` : ""}</button>`;
    }).join("");
    wrap.appendChild(sw);
    if (view.sec === "all") wrap.appendChild(allSections());
    else if (view.sec === "held") wrap.appendChild(heldPage(held));
    else if (section(view.sec)) wrap.appendChild(sectionPage(section(view.sec)));
    else { view.sec = "all"; wrap.appendChild(allSections()); }
    return wrap;
  }

  function allSections() {
    const wrap = el("div", { class: "eh-stack" });
    const bar = el("div", { class: "eh-toolbar" });
    bar.innerHTML = `
      <label class="eh-search">${ICON.search}<span class="sr-only">Find a piece</span>
        <input type="search" placeholder="Search pieces, writers, interviewees" value="${esc(view.q)}" data-keep="q" autocomplete="off"></label>
      <div class="eh-seg is-sm" role="group" aria-label="Show">
        ${[["all", "Everything"], ["mine", "Mine"], ["open", "Open slots"]].map(([id, l]) => `<button type="button" class="eh-seg-b${view.filter === id ? " is-on" : ""}" data-filter="${id}" aria-pressed="${view.filter === id}">${l}</button>`).join("")}
      </div>`;
    const body = el("div", { class: "eh-stack" });
    const paint = () => { body.innerHTML = ""; body.appendChild(view.q || view.filter !== "all" ? searchResults() : sectionGrid()); };
    bar.querySelector("input").addEventListener("input", (e) => { view.q = e.target.value.trim().toLowerCase(); paint(); });
    wrap.append(bar, body);
    paint();
    return wrap;
  }

  function sectionGrid() {
    const grid = el("div", { class: "eh-secgrid" });
    grid.innerHTML = (hub.sections || []).map((s, i) => {
      const ps = sorted(pieces.filter((p) => p.section === s.id));
      const real = ps.filter((p) => p.status !== "open");
      const drafts = real.filter((p) => (STAGE_INDEX[p.status] ?? 0) >= STAGE_INDEX.draft1).length;
      const mine = edits(s) || ps.some(isMine);
      return `<section class="card eh-seccard${mine ? " is-mine" : ""}">
        <button type="button" class="eh-seccard-h" data-sec="${esc(s.id)}" aria-label="Open ${esc(s.name)}">
          <span class="eh-sec-num">${String(i + 1).padStart(2, "0")}</span>
          <span class="eh-seccard-t"><span class="eh-sec-name">${esc(s.name)}</span><span class="eh-meta">${plural(real.length, "piece")} · ${drafts} first ${drafts === 1 ? "draft" : "drafts"} in${mine ? ` · <b>You're here</b>` : ""}</span></span>
          ${s.editor ? `<span class="eh-person sm">${avatar(s.editor, 26)}<span><small>Editor</small>${esc(s.editor.name)}</span></span>` : ""}
        </button>
        ${banners.get(s.id)?.text ? `<div class="eh-seccard-b">${bannerHtml(s, { compact: true })}</div>` : ""}
        <ul class="eh-mini-list">${ps.map((p) => p.status === "open"
          ? `<li class="is-open"><button type="button" data-piece="${esc(p.id)}"><span class="eh-ml-t">Open slot</span><span class="eh-ml-w">${esc(p.subtitle || "")}</span></button></li>`
          : `<li><button type="button" data-piece="${esc(p.id)}"><span class="eh-ml-t">${esc(p.title)}</span><span class="eh-ml-w">${esc(firstNames(p.writers))}</span>${stage(p)}</button></li>`).join("") || `<li class="eh-muted">No pieces yet.</li>`}</ul>
        <div class="eh-seccard-f"><button type="button" class="btn btn-secondary btn-sm" data-sec="${esc(s.id)}">Open ${esc(s.name)} ${ICON.chev}</button></div>
      </section>`;
    }).join("");
    return grid;
  }

  function searchResults() {
    const wrap = el("div", { class: "eh-stack" });
    let shown = 0;
    [...(hub.sections || []), { id: "held", name: "Held for a later edition" }].forEach((s) => {
      const ps = sorted(pieces.filter((p) => p.section === s.id)).filter(matches);
      if (!ps.length) return;
      shown += ps.length;
      const c = el("section", { class: "card" });
      c.innerHTML = `<div class="card-header eh-ch"><div><h2 class="card-title">${esc(s.name)}</h2><p class="card-subtitle">${plural(ps.length, "match", "matches")}</p></div></div><ul class="eh-list">${ps.map(pieceRow).join("")}</ul>`;
      wrap.appendChild(c);
    });
    if (!shown) wrap.innerHTML = `<div class="card"><div class="card-empty">Nothing matches. <button type="button" class="eh-link" data-filter="all" data-clear>Show everything</button></div></div>`;
    return wrap;
  }

  function sectionPage(s) {
    const i = sectionIndex(s.id);
    const ps = sorted(pieces.filter((p) => p.section === s.id));
    const real = ps.filter((p) => p.status !== "open");
    const drafts = real.filter((p) => (STAGE_INDEX[p.status] ?? 0) >= STAGE_INDEX.draft1).length;
    const qs = openQs((m) => m.sectionId === s.id || ps.some((p) => p.id === m.pieceId)).length;
    const can = canEditSection(s);
    const inSection = ps.some(isMine);
    const recent = threadOf((m) => m.sectionId === s.id && !m.pieceId).slice(0, 4);
    const wrap = el("div", { class: "eh-stack" });
    const hero = el("section", { class: "card eh-sechero" });
    hero.innerHTML = `
      <div class="eh-sechero-top">
        <div class="eh-sechero-t">
          <p class="eh-eyebrow">${String(i + 1).padStart(2, "0")} · The Future of Health is…</p>
          <h2 class="eh-sechero-name">${esc(s.name)}</h2>
          <p class="eh-sechero-stats"><span><strong>${real.length}</strong> pieces</span><span><strong>${drafts}</strong> first drafts in</span><span><strong>${qs}</strong> open ${qs === 1 ? "question" : "questions"}</span></p>
        </div>
        <div class="eh-sechero-ed">
          ${s.editor ? `<span class="eh-person">${avatar(s.editor, 44)}<span><small>Section editor</small>${esc(s.editor.name)}</span></span>` : `<span class="eh-muted">No editor yet</span>`}
        </div>
      </div>
      <div class="eh-sechero-actions">
        ${can ? `<button type="button" class="btn btn-primary btn-sm" data-email-sec="${esc(s.id)}">${svg(`<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>`, 15)} Email the section</button>
          <button type="button" class="btn btn-secondary btn-sm" data-banner="${esc(s.id)}">${TONES.note.icon} ${banners.get(s.id)?.text ? "Edit the pinned note" : "Pin a note"}</button>
          <button type="button" class="btn btn-secondary btn-sm" data-compose="announcement" data-sec-for="${esc(s.id)}">${ICON.note} Post an update</button>` : ""}
        ${!can && inSection && s.editor ? `<button type="button" class="btn btn-primary btn-sm" data-ask-sec="${esc(s.id)}">${ICON.q} Ask ${esc(firstName(s.editor.name))}</button>` : ""}
        ${s.draftsUrl ? `<a class="btn btn-ghost btn-sm" href="${esc(s.draftsUrl)}" target="_blank" rel="noopener">${ICON.gdrive} Drafts folder <span class="eh-g-k">Google Drive</span></a>` : ""}
        ${s.driveUrl ? `<a class="btn btn-ghost btn-sm" href="${esc(s.driveUrl)}" target="_blank" rel="noopener">${ICON.gdrive} Section folder <span class="eh-g-k">Google Drive</span></a>` : ""}
        ${isAdmin ? `<button type="button" class="btn btn-ghost btn-sm" data-edit-section="${esc(s.id)}">${ICON.edit} Section settings</button>` : ""}
      </div>
      ${bannerHtml(s)}
      <div class="eh-sechero-about">
        <div><p class="section-title">About this section</p><p>${esc(s.blurb || "")}</p></div>
        ${s.belongs ? `<div><p class="section-title">What belongs here</p><p>${esc(s.belongs)}</p></div>` : ""}
      </div>`;
    wrap.appendChild(hero);
    const list = el("section", { class: "card" });
    list.innerHTML = `
      <div class="card-header eh-ch"><div><h2 class="card-title">Pieces in ${esc(s.name)}</h2><p class="card-subtitle">${plural(real.length, "piece")}${ps.length > real.length ? ` · ${plural(ps.length - real.length, "open slot")}` : ""}</p></div>
        ${canEdit() ? `<button type="button" class="btn btn-ghost btn-sm" data-add-piece="${esc(s.id)}">${ICON.plus} Add a piece</button>` : ""}</div>
      <ul class="eh-list">${ps.map(pieceRow).join("") || `<li class="eh-row is-empty">No pieces yet.</li>`}</ul>`;
    wrap.appendChild(list);
    const talk = el("section", { class: "card" });
    talk.innerHTML = `<div class="card-header eh-ch"><div><h2 class="card-title">Section updates and questions</h2><p class="card-subtitle">Posts to the whole of ${esc(s.name)}, not one piece.</p></div><button type="button" class="btn btn-ghost btn-sm" data-go="talk">All questions ${ICON.chev}</button></div>`;
    talk.appendChild(recent.length ? (() => { const u = el("ul", { class: "eh-threads" }); u.innerHTML = recent.map((m) => messageHtml(m, { showContext: false })).join(""); return u; })() : el("div", { class: "card-empty", html: `Nothing yet.${can ? " Post an update to everyone in the section." : ""}` }));
    wrap.appendChild(talk);
    return wrap;
  }

  function heldPage(held) {
    const c = el("section", { class: "card" });
    c.innerHTML = `<div class="card-header eh-ch"><div><h2 class="card-title">Held for a later edition</h2><p class="card-subtitle">${plural(held.length, "piece")} saved for another time.</p></div></div><ul class="eh-list">${sorted(held).map(pieceRow).join("")}</ul>`;
    return c;
  }

  // Pin, change or remove a section's note; optionally ring everyone's bell.
  function editBanner(s) {
    if (!canEditSection(s)) return;
    const cur = banners.get(s.id) || {};
    let tone = cur.tone || "note";
    const body = el("form", { class: "eh-form" });
    const paint = () => {
      const text = body.querySelector("textarea")?.value ?? cur.text ?? "";
      body.innerHTML = `
        <p class="eh-f-h">Pinned at the top of ${esc(s.name)} and on every piece in it, until you change or remove it.</p>
        <div class="eh-seg is-sm" role="radiogroup" aria-label="Kind of note">${Object.entries(TONES).map(([k, t]) => `<button type="button" role="radio" aria-checked="${tone === k}" class="eh-seg-b${tone === k ? " is-on" : ""}" data-tone="${k}">${esc(t.label)}</button>`).join("")}</div>
        ${field("Note", area("text", text, 4))}
        <label class="eh-inline-check"><input type="checkbox" name="notify" ${cur.text ? "" : "checked"}> Also ring the bell for everyone in ${esc(s.name)}</label>`;
    };
    paint();
    body.addEventListener("click", (e) => { const b = e.target.closest("[data-tone]"); if (b) { tone = b.dataset.tone; paint(); } });
    const footer = [
      ...(cur.text ? [el("button", { type: "button", class: "btn btn-ghost eh-left", onclick: async () => {
        try { await deleteDoc(doc(hubRef, "banners", s.id)); m.close(); toast("Note removed."); } catch { toast("Couldn't remove it.", "error"); }
      } }, "Remove note")] : []),
      el("button", { type: "button", class: "btn btn-secondary", onclick: () => m.close() }, "Cancel"),
      el("button", { type: "button", class: "btn btn-primary", onclick: () => body.requestSubmit() }, "Pin note"),
    ];
    const m = openModal({ title: `Pinned note for ${s.name}`, body, footer });
    body.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!canWrite()) return;
      const fd = new FormData(body);
      const text = String(fd.get("text") || "").trim().slice(0, 2000);
      if (!text) { body.querySelector("textarea").focus(); return; }
      try {
        await setDoc(doc(hubRef, "banners", s.id), { text, tone, byName: me.name, byUid: me.uid, at: new Date().toISOString() });
        if (fd.get("notify")) post({ kind: "announcement", text, sectionId: s.id });
        m.close(); toast("Note pinned.", "success");
      } catch (err) { console.warn(err); toast("Couldn't save the note.", "error"); }
    });
  }

  // Email everyone in a section: Gmail, the person's own mail app, or copy.
  async function emailSection(s) {
    const people = sectionWriters(s);
    const body = el("div", { class: "eh-form" });
    body.innerHTML = `<div class="loading-state"><div class="spinner"></div>Finding everyone's email&hellip;</div>`;
    const m = openModal({ title: `Email ${s.name}`, body });
    let users = new Map();
    try { const snap = await getDocs(collection(db, "users")); users = new Map(snap.docs.map((d) => [d.id, d.data()])); }
    catch { body.innerHTML = `<p class="eh-f-h">Couldn't load the team's emails. Try again in a moment.</p>`; return; }
    const STAFF = ["admin", "editor", "writer", "social_media", "marketing", "newsletter_builder"];
    const valid = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && !/\.invalid$/i.test(e) && !/@catalyst-magazine\.com$/i.test(e);
    const emailOf = (person) => {
      const accts = (person.uids || []).map((u) => users.get(u)).filter(Boolean);
      const pick = accts.find((u) => STAFF.includes(u.role) && valid(String(u.email || ""))) || accts.find((u) => valid(String(u.email || "")));
      return pick ? String(pick.email).trim() : "";
    };
    const rows = people.map((p) => ({ ...p, email: emailOf(p) }));
    const emails = [...new Set(rows.map((r) => r.email.toLowerCase()).filter(Boolean))];
    const subject = `The Catalyst · ${hub.name} · ${s.name}`;
    const gmail = `https://mail.google.com/mail/?view=cm&fs=1&bcc=${encodeURIComponent(emails.join(","))}&su=${encodeURIComponent(subject)}`;
    const mailto = `mailto:?bcc=${encodeURIComponent(emails.join(","))}&subject=${encodeURIComponent(subject)}`;
    body.innerHTML = `
      <p class="eh-f-h">Everyone writing in ${esc(s.name)}, as BCC so replies come back to you.</p>
      <ul class="eh-recips">${rows.map((r) => `<li>${avatar(r, 26)}<span><strong>${esc(r.name)}</strong>${r.email ? "" : `<small>No email on file</small>`}</span></li>`).join("") || `<li class="eh-muted">No writers in this section yet.</li>`}</ul>
      ${emails.length ? `<div class="eh-btnrow eh-email-actions">
        <a class="btn btn-primary" href="${esc(gmail)}" target="_blank" rel="noopener">${svg(`<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>`, 15)} Write in Gmail</a>
        <a class="btn btn-secondary" href="${esc(mailto)}">Open my email app</a>
        <button type="button" class="btn btn-ghost" data-copy-emails>${ICON.copy} Copy addresses</button>
      </div>` : ""}`;
    body.querySelector("[data-copy-emails]")?.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(emails.join(", ")); toast("Addresses copied.", "success", 1600); } catch { toast("Couldn't copy.", "info"); }
    });
    void m;
  }

  // ── a piece
  // Left: the work (feedback to address, the full proposal, questions).
  // Right: where it stands and what to do next, always in view.
  // Notes are plain strings (the editors' inline notes in the proposal) or
  // { text, by } (comments from the Google Doc, with who wrote them).
  const noteText = (n) => (typeof n === "string" ? n : n?.text || "");
  const noteBy = (n) => (typeof n === "string" ? "" : n?.by || "");
  const noteList = (p) => [
    ...(p.general || []).map((n, i) => ({ id: `general:${i}`, field: "general", text: noteText(n), by: noteBy(n) })),
    ...PROPOSAL.flatMap((g) => [...(g.lead ? [[g.lead, `${g.group} (overall)`]] : []), ...g.fields])
      .flatMap(([k]) => (p.notes?.[k] || []).map((n, i) => ({ id: `${k}:${i}`, field: k, text: noteText(n), by: noteBy(n) }))),
  ];
  const fieldLabel = (k) => (k === "general" ? "Overall" : k === "outline" ? "Outline (overall)" : PROPOSAL.flatMap((g) => g.fields).find(([f]) => f === k)?.[1] || k);
  const fieldValue = (p, k) => (k === "title" ? p.title : k === "subtitle" ? p.subtitle : k === "format" ? p.format : p.proposal?.[k] || "");

  function pieceView(p) {
    const s = section(p.section);
    const ed = editorOf(p);
    const wrap = el("div", { class: "eh-piece" });
    const threads = threadOf((m) => m.pieceId === p.id);
    const openN = threads.filter((m) => m.kind === "question" && !m.resolved).length;
    const notes = noteList(p);
    if (view.pieceTab !== "talk") view.pieceTab = "proposal";
    void notes;
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
          ${p.status !== "open" ? `<button type="button" class="btn btn-primary" data-compose="question" data-for="${esc(p.id)}">${ICON.q} ${isMine(p) && ed ? `Ask ${esc(firstName(ed.name))}` : "Ask a question"}</button>
          <button type="button" class="btn btn-secondary" data-compose="update" data-for="${esc(p.id)}">${ICON.note} Share an update</button>` : ""}
          ${canEdit() ? `<button type="button" class="btn btn-ghost" data-edit-piece="${esc(p.id)}">${ICON.edit} Edit piece</button>` : isMine(p) ? `<button type="button" class="btn btn-ghost" data-edit-mine="${esc(p.id)}">${ICON.edit} Edit title</button>` : ""}
        </div>
      </header>
      ${s && banners.get(s.id)?.text ? `<div class="eh-piece-note">${bannerHtml(s, { compact: true })}</div>` : ""}
      <div class="eh-pgrid">
        <aside class="eh-pside"></aside>
        <div class="eh-pmain">
          <nav class="eh-seg eh-ptabs" aria-label="This piece">
            ${[
              ["proposal", "Proposal", ""],
              ["talk", "Questions", threads.length ? (openN ? `${openN} open` : String(threads.length)) : ""],
            ].map(([id, l, n]) => `<button type="button" class="eh-seg-b${view.pieceTab === id ? " is-on" : ""}" data-pv="${id}" ${view.pieceTab === id ? 'aria-current="page"' : ""}>${l}${n ? `<span class="eh-badge${(id === "talk" && openN) || false ? " is-alert" : ""}">${n}</span>` : ""}</button>`).join("")}
          </nav>
          <div class="eh-pbody"></div>
        </div>
      </div>`;
    const body = wrap.querySelector(".eh-pbody");
    if (view.pieceTab === "talk") {
      body.appendChild(composerCard({ pieceId: p.id }));
      body.appendChild(threadCard(threads, { showContext: false, empty: "No questions or updates yet. Ask the first one." }));
    } else body.appendChild(proposalView(p));
    wrap.querySelector(".eh-pside").append(...sideCards(p));
    return wrap;
  }

  // The proposal as a one-page brief: the editors' take first (their overall
  // verdict and named Google Doc comments; the line-by-line notes stay in the
  // Doc, or inline on request), then the writer's proposal laid out by what
  // each part is for, not as one long list.
  function proposalView(p) {
    const node = el("section", { class: "card eh-doc" });
    const pr = p.proposal;
    const mine = isMine(p);
    const canProp = mine || canEdit();
    const notes = noteList(p);
    if (!pr) {
      node.innerHTML = `<div class="eh-noprop">
        <h2>No proposal here yet</h2>
        <p>${esc(p.proposalNote || (p.status === "open" ? "This slot is open. Pitch an idea, and the section editor will get back to you." : "Once the proposal is in, it shows here with the editors' take."))}</p>
        ${p.candidates?.length ? `<p class="section-title eh-st">Ideas on the table</p><ul class="eh-ticks">${p.candidates.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>` : ""}
        ${canProp && p.status !== "open" ? `<button type="button" class="btn btn-primary" data-edit-proposal="${esc(p.id)}">${mine ? "Add your proposal" : "Add the proposal"}</button>` : ""}
        ${p.status === "open" ? `<button type="button" class="btn btn-primary" data-pitch="${esc(p.section)}">Pitch an idea</button>` : ""}
      </div>`;
      return node;
    }
    const val = (k) => { const v = String(fieldValue(p, k) || "").trim(); return v && !/^(tbd\b|\?+$|n\/a$)/i.test(v) ? v : ""; };
    const inline = (k) => (view.showNotes ? notesHtml(p.notes?.[k] || []) : "");
    const long = (t) => t.length > 420;
    const cell = (k, label, cls = "") => {
      const v = val(k);
      if (!v && !(view.showNotes && (p.notes?.[k] || []).length)) return "";
      return `<div class="eh-cell ${cls}${long(v) ? " is-long" : ""}">
        <p class="eh-cell-k">${esc(label)}</p>
        ${v ? `<div class="eh-cell-v">${rich(v)}</div>${long(v) ? `<button type="button" class="eh-more" data-more>Read more</button>` : ""}` : `<p class="eh-cell-v is-blank">Left blank</p>`}
        ${inline(k)}
      </div>`;
    };

    // Editors' take: the overall verdict, or the named Doc comments.
    const general = (p.general || []).map((n) => ({ text: noteText(n), by: noteBy(n) }));
    const named = notes.filter((n) => n.by && n.field !== "general");
    const take = general.length ? general : named.length ? named : notes.slice(0, 2);
    const rest = notes.length - take.length;
    const takeHtml = notes.length ? `<section class="eh-take">
        <div class="eh-take-h"><p class="eh-take-k">The editors' take</p>
          ${p.docUrl ? `<a class="btn btn-secondary btn-sm" href="${esc(p.docUrl)}" target="_blank" rel="noopener">${ICON.gdoc} All comments in Google Docs</a>` : ""}</div>
        <ul class="eh-take-list">${take.map((n) => `<li>${n.by ? `<span class="eh-by">${esc(n.by)}${n.field && n.field !== "general" ? ` · on ${esc(fieldLabel(n.field).toLowerCase())}` : ""}</span>` : ""}${rich(n.text)}</li>`).join("")}</ul>
        ${rest > 0 ? `<p class="eh-take-more">${plural(rest, "more comment")} on specific parts of the proposal${p.docUrl ? " are in the Google Doc" : ""}.
          <label class="eh-switch"><input type="checkbox" ${view.showNotes ? "checked" : ""} data-toggle-notes><span class="tr" aria-hidden="true"></span>Show them here</label></p>` : ""}
      </section>` : "";

    const facts = [["Format", val("format")], ["Earliest delivery", val("delivery") || "Not given"]].filter(([, v]) => v);
    const outline = [["opening", "Opening"], ["context", "Context"], ["core", "Core"], ["tensions", "Tensions"], ["resolution", "Resolution"]].filter(([k]) => val(k));
    const ideaCells = [cell("theme", "How it connects to the theme"), cell("whyNow", "Why now"), cell("whyMatters", "Why it matters"), cell("whatsNew", "What's new here")].filter(Boolean);
    const audCells = [cell("audience", "Who it's for"), cell("assumed", "What readers already know"), cell("angle", "The angle")].filter(Boolean);
    const lines = (t) => String(t).split(/\n+/).map((x) => x.trim()).filter(Boolean);

    node.innerHTML = `
      <div class="card-header eh-ch">
        <div><h2 class="card-title">Proposal by ${esc(names(p.writers))}</h2>
          <p class="card-subtitle">${facts.map(([k, v]) => `<span class="eh-fact"><b>${esc(k)}</b> ${esc(v)}</span>`).join("")}</p></div>
        <div class="eh-doc-ctl">
          ${p.docUrl ? `<a class="btn btn-ghost btn-sm" href="${esc(p.docUrl)}" target="_blank" rel="noopener">${ICON.gdoc} Open in Google Docs</a>` : ""}
          ${canProp ? `<button type="button" class="btn btn-ghost btn-sm" data-edit-proposal="${esc(p.id)}">${ICON.edit} Edit</button>` : ""}
        </div>
      </div>
      <div class="eh-brief">
        ${takeHtml}
        ${val("takeaway") ? `<section class="eh-takeaway${val("takeaway").length > 240 ? " is-long" : ""}"><p class="eh-cell-k">Main takeaway</p><blockquote>${rich(val("takeaway"))}</blockquote>${inline("takeaway")}</section>` : ""}
        ${val("pitch") ? `<section class="eh-pitch"><p class="eh-cell-k">The pitch</p><div class="eh-lead">${rich(val("pitch"))}</div>${inline("pitch")}</section>` : ""}
        ${ideaCells.length ? `<section class="eh-bsec"><h3 class="eh-bsec-h">Why this story</h3><div class="eh-cells is-2">${ideaCells.join("")}</div></section>` : ""}
        ${audCells.length ? `<section class="eh-bsec"><h3 class="eh-bsec-h">Readers and angle</h3><div class="eh-cells is-3">${audCells.join("")}</div></section>` : ""}
        ${outline.length || val("visuals") ? `<section class="eh-bsec"><h3 class="eh-bsec-h">The plan</h3>
          ${view.showNotes ? notesHtml(p.notes?.outline || []) : ""}
          ${outline.length ? `<ol class="eh-path">${outline.map(([k, l]) => `<li><span class="eh-path-k">${esc(l)}</span><div class="eh-path-v">${rich(val(k))}</div>${inline(k)}</li>`).join("")}</ol>` : ""}
          ${val("visuals") ? `<div class="eh-cells">${cell("visuals", "Visual ideas")}</div>` : ""}
        </section>` : ""}
        ${val("research") || val("people") ? `<section class="eh-bsec"><h3 class="eh-bsec-h">Sources</h3><div class="eh-cells is-2">
          ${val("research") ? `<div class="eh-cell"><p class="eh-cell-k">Research</p><ul class="eh-srcs">${lines(val("research")).map((l) => `<li>${rich(l)}</li>`).join("")}</ul>${inline("research")}</div>` : ""}
          ${val("people") ? `<div class="eh-cell"><p class="eh-cell-k">People</p><ul class="eh-srcs">${lines(val("people")).map((l) => `<li>${rich(l)}</li>`).join("")}</ul>${inline("people")}</div>` : ""}
        </div></section>` : ""}
        ${val("feedback") ? `<section class="eh-ask"><p class="eh-cell-k">${esc(firstNames(p.writers))} asked the editors</p><div class="eh-ask-v">${rich(val("feedback"))}</div>${inline("feedback")}</section>` : ""}
      </div>`;
    return node;
  }
  function notesHtml(list) {
    if (!list?.length) return "";
    return `<div class="eh-notes">${list.map((n) => `<aside class="eh-note"><span class="eh-note-k">${esc(noteBy(n) || "Editor's note")}</span>${rich(noteText(n))}</aside>`).join("")}</div>`;
  }

  function sideCards(p) {
    const out = [];
    const prog = canProgress(p);
    const i = STAGE_INDEX[p.status] ?? 0;
    const first = hardDate("first-draft"), fin = hardDate("final-draft");
    const due = i < STAGE_INDEX.draft1 ? first : i < STAGE_INDEX.final ? fin : null;
    const dn = due ? daysUntil(due.date) : null;
    if (!SPECIAL[p.status]) {
      const c = el("section", { class: "card eh-side" });
      c.innerHTML = `
        <p class="section-title">Where it is</p>
        ${prog ? `<label class="eh-stage-pick"><span class="sr-only">Move this piece to</span><select data-stage-select="${esc(p.id)}">${STAGES.map((x) => `<option value="${x.id}"${x.id === (p.status || "idea") ? " selected" : ""}>${esc(x.label)}</option>`).join("")}</select>${ICON.down}</label>` : `<p class="eh-side-big">${esc(STAGES[i].label)}</p>`}
        <ol class="eh-steps" aria-hidden="true">${STAGES.map((x, k) => `<li class="${k < i ? "is-done" : k === i ? "is-now" : ""}" title="${esc(x.label)}"></li>`).join("")}</ol>
        ${prog ? `<p class="eh-side-hint">Change it when the piece moves on. ${isMine(p) ? "Your editor sees it." : "The writer sees it."}</p>` : ""}
        ${due ? `<div class="eh-side-due${dn < 0 ? " is-late" : dn <= 7 ? " is-soon" : ""}"><span>${esc(due.label)}</span><strong>${dn < 0 ? "Overdue" : esc(inDays(dn).replace(/^in /, "In "))}</strong><small>${esc(fmtDay(due.date, LONG))}</small></div>` : ""}
        <div class="eh-side-links">
          ${p.draftUrl ? `<a class="btn btn-secondary btn-sm eh-g" href="${esc(p.draftUrl)}" target="_blank" rel="noopener">${ICON.gdoc} Open the draft <span class="eh-g-k">Google Docs</span></a>` : ""}
          ${prog ? `<button type="button" class="btn btn-ghost btn-sm" data-draft-link="${esc(p.id)}">${p.draftUrl ? "Change draft link" : `${ICON.plus} Add the draft link`}</button>` : ""}
          ${section(p.section)?.draftsUrl && i < STAGE_INDEX.final ? `<a class="btn ${i < STAGE_INDEX.draft1 && isMine(p) ? "btn-primary" : "btn-ghost"} btn-sm" href="${esc(section(p.section).draftsUrl)}" target="_blank" rel="noopener">${ICON.gdrive} ${i < STAGE_INDEX.draft1 ? "Upload your first draft" : "Drafts folder"} <span class="eh-g-k">Google Drive</span></a>` : ""}
          ${section(p.section)?.driveUrl ? `<a class="btn btn-ghost btn-sm" href="${esc(section(p.section).driveUrl)}" target="_blank" rel="noopener">${ICON.gdrive} Section folder <span class="eh-g-k">Google Drive</span></a>` : ""}
          ${p.trackerId ? `<a class="btn btn-ghost btn-sm" href="#/pipeline/all?project=${esc(p.trackerId)}">${ICON.tracker} Open in the Story Tracker</a>` : ""}
        </div>
        ${section(p.section)?.draftsUrl && i < STAGE_INDEX.draft1 ? `<p class="eh-side-hint">Name it “Name_Title_Draft1”, then set the stage to First draft in.</p>` : ""}`;
      out.push(c);
    }
    const steps = p.nextSteps || [];
    if (steps.length || canEdit()) {
      const done = steps.filter((s) => s.done).length;
      const c = el("section", { class: "card eh-side" });
      c.innerHTML = `
        <div class="eh-side-h"><p class="section-title">Next steps</p>${steps.length ? `<span class="eh-muted">${done} of ${steps.length}</span>` : ""}${canEdit() ? `<button type="button" class="btn btn-ghost btn-xs" data-edit-steps="${esc(p.id)}">${ICON.edit} Edit</button>` : ""}</div>
        <ul class="eh-checks">${steps.map((s) => `<li><label class="eh-check${s.done ? " is-done" : ""}"><input type="checkbox" data-step="${esc(s.id)}" data-piece-id="${esc(p.id)}" ${s.done ? "checked" : ""} ${prog ? "" : "disabled"}><span class="box">${ICON.check}</span><span class="txt">${esc(s.text)}</span></label></li>`).join("") || `<li class="eh-muted">None yet.</li>`}</ul>`;
      out.push(c);
    }
    const ivs = p.interviews || [];
    if (ivs.length || prog) {
      const lbl = { done: "Done", scheduled: "Scheduled", contacted: "Contacted", planned: "Planned", wanted: "Wanted" };
      const c = el("section", { class: "card eh-side" });
      c.innerHTML = `
        <div class="eh-side-h"><p class="section-title">Interviews</p>${prog ? `<button type="button" class="btn btn-ghost btn-xs" data-edit-iv="${esc(p.id)}">${ivs.length ? `${ICON.edit} Edit` : `${ICON.plus} Add`}</button>` : ""}</div>
        <ul class="eh-ivs">${ivs.map((v) => `<li>
          <div><p class="eh-iv-who">${esc(v.person)}</p><p class="eh-meta">${esc([v.affiliation, v.when].filter(Boolean).join(" · "))}</p>${v.note ? `<p class="eh-meta eh-iv-note">${esc(v.note)}</p>` : ""}</div>
          <span class="eh-tag is-iv-${esc(v.status || "planned")}">${esc(lbl[v.status] || "Planned")}</span>
        </li>`).join("") || `<li class="eh-muted">None listed yet.</li>`}</ul>
        ${ivs.length ? `<p class="eh-side-hint">Send your angle and questions to ${editorOf(p) ? esc(firstName(editorOf(p).name)) : "your editor"} before each interview, and ask permission to record.</p>` : ""}`;
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
            m.close(); go({ piece: ref.id, pieceTab: "" }); toast("Added.", "success");
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
            ${field("Status", `<select class="input" name="status-${i}">${[["wanted", "Wanted"], ["planned", "Planned"], ["contacted", "Contacted, no reply yet"], ["scheduled", "Scheduled"], ["done", "Done"]].map(([id, l]) => `<option value="${id}"${v.status === id ? " selected" : ""}>${l}</option>`).join("")}</select>`)}
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
      const sectionEditors = Object.fromEntries(sections.map((x) => [x.id, x.editor?.uids || []]));
      if (await saveHub({ sections, editorUids, sectionEditors })) { m.close(); toast("Saved.", "success"); }
    });
  }

  // The editors' desk: rewrite, reorder, add or remove to-dos and open
  // decisions. Editors and admins (the rules allow editorTodos/decisions).
  function editDesk() {
    const lists = {
      editorTodos: (hub.editorTodos || []).map((t) => ({ ...t })),
      decisions: (hub.decisions || []).map((t) => ({ ...t })),
    };
    const DONE = { editorTodos: "done", decisions: "resolved" };
    const body = el("form", { class: "eh-form eh-deskedit" });
    const block = (key, title, addLabel, doneLabel) => `
      <fieldset class="eh-fs"><legend>${title}</legend>
        ${lists[key].map((t, i) => `<div class="eh-de-row">
          <textarea class="input" name="${key}-${i}" rows="2" maxlength="400" aria-label="${title} ${i + 1}">${esc(t.text)}</textarea>
          <div class="eh-de-tools">
            <label class="eh-inline-check"><input type="checkbox" name="${key}-done-${i}" ${t[DONE[key]] ? "checked" : ""}> ${doneLabel}</label>
            <span class="eh-de-move">
              <button type="button" class="eh-act" data-up="${key}:${i}" ${i === 0 ? "disabled" : ""} aria-label="Move up">&uarr;</button>
              <button type="button" class="eh-act" data-down="${key}:${i}" ${i === lists[key].length - 1 ? "disabled" : ""} aria-label="Move down">&darr;</button>
              <button type="button" class="eh-act is-danger" data-rm="${key}:${i}">Remove</button>
            </span>
          </div>
        </div>`).join("") || `<p class="eh-f-h">Nothing here.</p>`}
        <span class="eh-btnrow"><button type="button" class="btn btn-secondary btn-sm" data-add="${key}">${ICON.plus} ${addLabel}</button>
        ${lists[key].some((t) => t[DONE[key]]) ? `<button type="button" class="btn btn-ghost btn-sm" data-clear="${key}">Remove the ticked ones</button>` : ""}</span>
      </fieldset>`;
    const paint = () => { body.innerHTML = block("editorTodos", "To do", "Add a to-do", "Done") + block("decisions", "Still deciding", "Add a decision", "Decided"); };
    const read = () => Object.keys(lists).forEach((key) => lists[key].forEach((t, i) => {
      const txt = body.querySelector(`[name="${key}-${i}"]`), chk = body.querySelector(`[name="${key}-done-${i}"]`);
      if (txt) t.text = txt.value.trim();
      if (chk) t[DONE[key]] = chk.checked;
    }));
    paint();
    body.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b || b.type === "submit") return;
      read();
      const [key, i] = String(b.dataset.up || b.dataset.down || b.dataset.rm || "").split(":");
      const n = Number(i);
      if (b.dataset.add) { const k = b.dataset.add; lists[k].push({ id: `${k === "decisions" ? "q" : "t"}${Date.now().toString(36)}`, text: "", [DONE[k]]: false }); paint(); body.querySelector(`[name="${k}-${lists[k].length - 1}"]`)?.focus(); return; }
      if (b.dataset.clear) { lists[b.dataset.clear] = lists[b.dataset.clear].filter((t) => !t[DONE[b.dataset.clear]]); paint(); return; }
      if (b.dataset.up && n > 0) { [lists[key][n - 1], lists[key][n]] = [lists[key][n], lists[key][n - 1]]; paint(); return; }
      if (b.dataset.down && n < lists[key].length - 1) { [lists[key][n + 1], lists[key][n]] = [lists[key][n], lists[key][n + 1]]; paint(); return; }
      if (b.dataset.rm) { lists[key].splice(n, 1); paint(); }
    });
    const m = openModal({ title: "Editors' desk", body, size: "wide", footer: [
      el("button", { type: "button", class: "btn btn-secondary", onclick: () => m.close() }, "Cancel"),
      el("button", { type: "button", class: "btn btn-primary", onclick: () => body.requestSubmit() }, "Save"),
    ] });
    body.addEventListener("submit", async (e) => {
      e.preventDefault(); read();
      const clean = (key) => lists[key].filter((t) => t.text).map((t) => ({ id: t.id, text: t.text, [DONE[key]]: !!t[DONE[key]] }));
      if (await saveHub({ editorTodos: clean("editorTodos"), decisions: clean("decisions") })) { m.close(); toast("Editors' desk saved.", "success"); }
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
    if (d.more !== undefined) { const c = t.closest(".eh-cell"); const open = c.classList.toggle("is-open"); t.textContent = open ? "Show less" : "Read more"; return; }
    if (d.go) { go({ tab: d.go, piece: null }); return; }
    if (d.allActivity !== undefined) { view.allActivity = !view.allActivity; render(); return; }
    if (d.sec) { view.sec = d.sec; view.q = ""; view.filter = "all"; go({ tab: "pieces", piece: null }); return; }
    if (d.banner) { editBanner(section(d.banner)); return; }
    if (d.emailSec) { emailSection(section(d.emailSec)); return; }
    if (d.askSec) { composeModal({ sectionId: d.askSec, kind: "question" }); return; }
    if (d.piece) { go({ piece: d.piece, pieceTab: d.pv || "" }); return; }
    if (d.pv) { go({ pieceTab: d.pv }); return; }
    if (d.filter) { view.filter = d.filter; if (d.clear !== undefined) view.q = ""; render(); return; }
    if (d.tfilter) { view.talkFilter = d.tfilter; render(); return; }
    if (d.compose) { composeModal({ pieceId: d.for || "", sectionId: d.secFor || "", kind: d.compose }); return; }
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
    if (d.editPiece) { editPiece(pieces.find((x) => x.id === d.editPiece)); return; }
    if (d.addPiece) { editPiece(null, { isNew: true, sectionId: d.addPiece }); return; }
    if (d.editMine) { editMine(pieces.find((x) => x.id === d.editMine)); return; }
    if (d.editProposal) { editProposal(pieces.find((x) => x.id === d.editProposal)); return; }
    if (d.editIv) { editInterviews(pieces.find((x) => x.id === d.editIv)); return; }
    if (d.editSteps) { editSteps(pieces.find((x) => x.id === d.editSteps)); return; }
    if (d.draftLink) { editDraftLink(pieces.find((x) => x.id === d.draftLink)); return; }
    if (d.editSection) { editSection(section(d.editSection)); return; }
    if (d.editDates !== undefined) { editDates(); return; }
    if (d.editDesk !== undefined) { if (canEdit()) editDesk(); return; }
  });
  root.addEventListener("change", (e) => {
    const t = e.target;
    if (t.matches("[data-toggle-notes]")) { view.showNotes = t.checked; render(); return; }
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

.eh { max-width: 1080px; margin: 0 auto; padding: 0 0 72px; color: var(--ink); }
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
.eh-head { padding: 4px 0 24px; }
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
.eh-tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 20px; }
.eh-tile.is-past { opacity: .55; }
.eh-tiles.is-sm { grid-template-columns: repeat(3, minmax(0, 1fr)); margin: 28px 0 0; }
/* activity (editors and admins) */
.eh-act-card { padding: 22px 24px 18px; }
.eh-act-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.eh-act-title { display: flex; align-items: center; gap: 10px; margin: 0; font: 600 17px/1.3 var(--font); letter-spacing: -0.015em; }
.eh-act-new { padding: 3px 9px; border-radius: 99px; background: #fbe6dc; color: #9a3412; font: 600 11px/1.3 var(--font); letter-spacing: 0; }
.eh-act-scope { margin: 3px 0 0; font-size: 13px; color: var(--muted); }
.eh-act-checked { display: inline-flex; flex: none; align-items: center; gap: 7px; margin: 2px 0 0; padding: 5px 11px; border-radius: 99px; background: var(--surface-3); font: 500 12px/1.2 var(--font); color: var(--ink-2); white-space: nowrap; }
.eh-act-checked i { width: 7px; height: 7px; border-radius: 50%; background: var(--muted-2, #b8b2a7); }
.eh-act-checked.is-fresh i { background: #5f9a6b; box-shadow: 0 0 0 3px color-mix(in srgb, #5f9a6b 18%, transparent); }
.eh-act-list { margin: 14px 0 0; padding: 0; list-style: none; }
.eh-act-day { margin: 14px 0 4px; font: 600 10.5px/1.4 var(--font); letter-spacing: .12em; text-transform: uppercase; color: var(--muted); }
.eh-act-day:first-child { margin-top: 0; }
.eh-act-row { position: relative; display: grid; grid-template-columns: 30px minmax(0, 1fr) auto; gap: 12px; align-items: start; padding: 9px 10px; margin: 0 -10px; border-radius: 12px; transition: background .15s; }
.eh-act-row:hover { background: var(--surface-3); }
.eh-act-row.is-new { background: #fbf6ec; }
.eh-act-text { margin: 0; font-size: 14px; line-height: 1.45; color: var(--ink-2); overflow-wrap: anywhere; }
.eh-act-text b { font-weight: 600; color: var(--ink); }
.eh-act-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 10px; margin: 3px 0 0; font-size: 12.5px; color: var(--muted); }
.eh-act-meta > * + *::before { content: ""; display: inline-block; width: 3px; height: 3px; margin: 0 10px 2px -6px; border-radius: 50%; background: currentColor; opacity: .45; vertical-align: middle; }
.eh-act-piece { padding: 0; border: 0; background: none; font: 500 12.5px/1.4 var(--font); color: var(--ink-2); text-align: left; cursor: pointer; }
.eh-act-piece:hover { color: var(--ink); text-decoration: underline; text-underline-offset: 3px; }
.eh-act-src { display: inline-flex; align-items: center; gap: 5px; }
.eh-act-src .eh-gicon, .eh-act-src svg { width: 12px; height: 12px; }
.eh-act-src a { color: inherit; text-decoration: none; }
.eh-act-src a:hover { color: var(--ink); text-decoration: underline; text-underline-offset: 3px; }
.eh-act-dot { width: 8px; height: 8px; margin-top: 7px; border-radius: 50%; background: #c2410c; }
.eh-act-more { display: inline-flex; align-items: center; min-height: 36px; margin: 6px 0 0 -10px; padding: 0 10px; border: 0; border-radius: 10px; background: none; font: 600 13px var(--font); color: var(--ink); cursor: pointer; }
.eh-act-more:hover { background: var(--surface-3); }
.eh-act-empty { margin: 14px 0 0; font-size: 13.5px; color: var(--muted); }
.eh-act-quiet { margin: 14px 0 0; padding: 12px 14px; border-radius: 14px; background: var(--surface-2); border: 1px solid var(--hairline-2); }
.eh-act-quiet-k { margin: 0 0 8px; font: 600 10.5px/1.4 var(--font); letter-spacing: .12em; text-transform: uppercase; color: var(--muted); }
.eh-act-quiet-v { display: flex; flex-wrap: wrap; gap: 6px; margin: 0; }
.eh-act-qp { display: inline-flex; align-items: baseline; gap: 6px; min-height: 32px; padding: 6px 11px; border: 1px solid var(--hairline); border-radius: 99px; background: var(--surface); font: 600 12.5px/1.2 var(--font); color: var(--ink); cursor: pointer; }
.eh-act-qp span { font-weight: 400; color: var(--muted); }
.eh-act-qp:hover { border-color: color-mix(in srgb, var(--ink) 30%, transparent); }
.eh-act-piece:focus-visible, .eh-act-qp:focus-visible, .eh-act-more:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
@media (max-width: 640px) {
  .eh-act-card { padding: 18px 18px 14px; }
  .eh-act-head { flex-direction: column; gap: 8px; }
}

.eh-tile { display: flex; flex-direction: column; min-width: 0; padding: 22px 24px; border-radius: var(--radius); background: var(--surface); border: 1px solid var(--hairline); box-shadow: var(--shadow-sm); }
.eh-tile.is-main { background: #fdf3ee; border-color: #f2cdbd; color: var(--ink); box-shadow: var(--shadow-md); }
.eh-tile-k { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 0; font: 600 11px/1.2 var(--font); letter-spacing: .12em; text-transform: uppercase; color: var(--muted); }
.eh-tile.is-main .eh-tile-k { color: #9a3412; }
.eh-tile-big { display: flex; align-items: baseline; gap: 8px; margin: 14px 0 0; }
.eh-tile-big .n { font: 600 48px/1 var(--font); letter-spacing: -0.04em; font-variant-numeric: tabular-nums; }
.eh-tile-big .u { font-size: 15px; color: var(--muted); }
.eh-tile.is-main .eh-tile-big .n { color: #9a3412; }
.eh-tile-big.is-soon .n { color: #c2410c; }
.eh-tile-title { margin: 10px 0 0; font: 600 17px/1.3 var(--font); letter-spacing: -0.015em; }
.eh-tile-title.is-soon { color: var(--warn); }
.eh-tile-sub { margin: 4px 0 0; font-size: 13px; color: var(--muted); }
.eh-tile.is-main .eh-tile-sub { color: #a8644a; }
.eh-tile-text { margin: 12px 0 0; font-size: 14.5px; line-height: 1.5; color: var(--ink); }
.eh-tile-link { display: inline-flex; align-items: center; gap: 4px; align-self: flex-start; margin-top: auto; padding: 14px 0 0; border: 0; background: none; font: 600 13px/1.3 var(--font); color: var(--ink); text-decoration: none; cursor: pointer; text-align: left; }
.eh-tile-link:hover { text-decoration: underline; text-underline-offset: 3px; }
.eh-tile-link svg { flex: none; transition: transform .2s var(--ease-out); }
.eh-tile-link:hover svg { transform: translateX(2px); }
.eh-hard { display: inline-flex; padding: 2px 8px; border-radius: 99px; background: var(--danger-soft); color: var(--danger); font: 600 10px/1.5 var(--font); letter-spacing: .06em; }
.eh-tile.is-main .eh-hard { background: #fbe6dc; color: #9a3412; }

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
.eh-back { display: inline-flex; align-items: center; gap: 6px; min-height: 40px; margin: 0 0 0 -10px; padding: 0 12px 0 8px; border: 0; border-radius: 10px; background: none; font: 500 13.5px var(--font); color: var(--ink-2); cursor: pointer; }
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

/* piece layout: status and steps beside the work */
.eh-pgrid { display: grid; grid-template-columns: minmax(0, 1fr) 320px; grid-template-areas: "main side"; gap: 24px; align-items: start; margin-top: 30px; }
.eh-pmain { grid-area: main; min-width: 0; }
.eh-pside { grid-area: side; position: sticky; top: calc(var(--top-h, 72px) + 20px); display: flex; flex-direction: column; gap: 16px; }
.eh-pmain .eh-ptabs { margin: 0 0 16px; }
.eh-side { padding: 18px 20px; }
.eh-side .section-title { margin: 0; }
.eh-side-h { display: flex; align-items: center; gap: 10px; margin: 0 0 6px; }
.eh-side-h .section-title { flex: 1; }
.eh-side-h .eh-muted { font-size: 12.5px; }
.eh-side-big { margin: 10px 0 0; font: 600 17px/1.3 var(--font); letter-spacing: -0.015em; }
.eh-side .eh-stage-pick { margin-top: 6px; max-width: 100%; }
.eh-side .eh-stage-pick select { max-width: 100%; text-overflow: ellipsis; }
.eh-steps { display: flex; gap: 3px; margin: 10px 0 0; padding: 0; list-style: none; }
.eh-steps li { flex: 1; height: 5px; border-radius: 99px; background: var(--paper-3); }
.eh-steps li.is-done { background: var(--ink-2); }
.eh-steps li.is-now { background: var(--ink); }
.eh-side-hint { margin: 10px 0 0; font-size: 12.5px; line-height: 1.5; color: var(--muted); }
.eh-side-due { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 2px 10px; margin: 16px 0 0; padding: 12px 14px; border-radius: 12px; background: var(--surface-3); }
.eh-side-due span { font-size: 13px; font-weight: 600; }
.eh-side-due strong { grid-row: 1 / span 2; grid-column: 2; align-self: center; font: 600 14px var(--font); }
.eh-side-due small { font-size: 12px; color: var(--muted); }
.eh-side-due.is-soon { background: var(--warn-soft); } .eh-side-due.is-soon strong { color: var(--warn); }
.eh-side-due.is-late { background: var(--danger-soft); } .eh-side-due.is-late strong { color: var(--danger); }
.eh-side-links { display: flex; flex-wrap: wrap; gap: 6px; margin: 12px 0 0; }
.eh-side-links:empty { display: none; }
.eh-side .eh-check { font-size: 13.5px; }
.eh-ivs { margin: 4px 0 0; padding: 0; list-style: none; }
.eh-ivs li { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; padding: 10px 0; border-top: 1px solid var(--hairline-2); }
.eh-ivs li:first-child { border-top: 0; }
.eh-iv-who { margin: 0; font: 600 13.5px/1.35 var(--font); }

/* feedback checklist */
.eh-prog.is-flat { margin: 0; border-radius: 0; height: 3px; }
.eh-fb { padding: 6px 24px 18px; }
.eh-fb-g { padding: 18px 0 6px; border-top: 1px solid var(--hairline-2); }
.eh-fb-g:first-child { border-top: 0; }
.eh-fb-h { margin: 0 0 8px; font: 600 14px/1.3 var(--font); color: var(--ink); }
.eh-fb-quote { margin: 0 0 8px; }
.eh-fb-quote summary { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; list-style: none; cursor: pointer; padding: 8px 12px; border-radius: 10px; background: var(--surface-3); font-size: 13px; line-height: 1.5; color: var(--ink-2); }
.eh-fb-quote summary::-webkit-details-marker { display: none; }
.eh-fb-q { flex: 1 1 260px; font-style: italic; }
.eh-fb-more { font-size: 12px; font-weight: 600; color: var(--muted); white-space: nowrap; }
.eh-fb-quote[open] summary .eh-fb-q { display: none; }
.eh-fb-quote[open] .eh-ftext { padding: 10px 12px 0; font-size: 14.5px; }
.eh-fb-notes { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 8px; }
.eh-fb-note { padding: 12px 14px 12px 16px; border-left: 3px solid #c99a3d; border-radius: 0 12px 12px 0; background: color-mix(in srgb, var(--warn-soft) 60%, var(--surface)); font-size: 14px; line-height: 1.6; color: var(--ink); }
.eh-fb-note p { margin: 0 0 6px; } .eh-fb-note p:last-child { margin: 0; }
.eh-fb-note a { color: var(--info); }

/* progress card */
.eh-prog-big { margin: 0; font-size: 15px; color: var(--ink-2); }
.eh-prog-big strong { font: 600 34px/1 var(--font); letter-spacing: -0.03em; color: var(--ink); margin-right: 4px; }
.eh-prog.is-lg { height: 8px; margin: 14px 0 8px; }
.eh-groups { display: flex; flex-direction: column; gap: 14px; margin: 20px 0 0; padding: 18px 0 0; border-top: 1px solid var(--hairline-2); }
.eh-group-h { display: flex; align-items: center; gap: 8px; margin: 0 0 6px; font: 600 13px/1.3 var(--font); color: var(--ink); }
.eh-group-h i { width: 8px; height: 8px; border-radius: 50%; background: var(--dot, var(--muted-2)); }
.eh-group-h.is-open i { background: none; border: 1.5px dashed var(--warn); }
.eh-group-h span { color: var(--muted); font-weight: 500; }
.eh-group ul { margin: 0; padding: 0 0 0 16px; list-style: none; }
.eh-group li { display: flex; align-items: baseline; gap: 8px; padding: 3px 0; font-size: 13.5px; line-height: 1.45; }
.eh-group li .eh-link { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.eh-group li .eh-muted { flex: none; }
.eh-stale { margin: 18px 0 0; font-size: 13.5px; color: var(--ink-2); }

.eh-by { display: block; margin: 0 0 2px; font: 600 11px/1.3 var(--font); letter-spacing: .06em; text-transform: uppercase; color: var(--warn); }
.eh-gnote .eh-note-k { color: var(--muted); }
.eh-doclinks { margin: 0; padding: 0; list-style: none; display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 8px; }
.eh-doclinks a { display: flex; align-items: flex-start; gap: 10px; min-height: 44px; padding: 12px 14px; border-radius: 12px; background: var(--surface-3); color: var(--ink); text-decoration: none; }
.eh-doclinks a:hover { background: var(--paper-3); }
.eh-doclinks a svg { flex: none; margin-top: 2px; color: var(--muted); }
.eh-doclinks strong { display: block; font-size: 14px; font-weight: 600; }
.eh-doclinks small { display: block; margin-top: 2px; font-size: 12.5px; color: var(--muted); }

.eh-gicon { flex: none; }
.eh .btn.eh-g { gap: 8px; }
.eh-g-k { font-size: 11px; font-weight: 500; color: var(--muted); }
.eh .btn-primary .eh-g-k { color: rgba(248,247,243,.7); }
.eh .btn-primary .eh-gicon { background: var(--surface); border-radius: 4px; padding: 2px; width: 20px; height: 20px; }
.eh-inline-g { display: inline-flex; align-items: center; gap: 6px; }
.eh-tag.is-iv-contacted { background: var(--surface-3); color: var(--muted); }

/* progress board */
.eh-pg-top { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 24px; align-items: center; }
.eh-pg-num { display: flex; align-items: baseline; gap: 8px; }
.eh-pg-num strong { font: 600 56px/1 var(--font); letter-spacing: -0.045em; font-variant-numeric: tabular-nums; }
.eh-pg-num span { font-size: 16px; color: var(--muted); }
.eh-pg-label { margin: 0; font: 600 16px/1.3 var(--font); letter-spacing: -0.01em; }
.eh-pg-meta .eh-prog.is-lg { margin: 10px 0 8px; height: 10px; }
.eh-soon { color: var(--warn); font-weight: 600; }
.eh-strip { display: grid; grid-template-columns: repeat(8, minmax(0, 1fr)); gap: 6px; margin: 22px 0 0; padding: 0; list-style: none; }
.eh-strip li { display: flex; flex-direction: column; gap: 4px; padding: 10px 10px 9px; border-radius: 10px; background: var(--surface-3); border-top: 3px solid var(--dot); min-width: 0; }
.eh-strip li.is-zero { opacity: .45; }
.eh-strip-n { font: 600 20px/1 var(--font); letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
.eh-strip-l { font-size: 11.5px; line-height: 1.25; color: var(--ink-2); }
.eh-board { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 14px; margin: 22px 0 0; align-items: start; }
.eh-col { padding: 14px; border-radius: 14px; background: var(--surface-2); border: 1px solid var(--hairline-2); }
.eh-col.is-open { border-style: dashed; border-color: color-mix(in srgb, var(--warn) 45%, transparent); background: color-mix(in srgb, var(--warn-soft) 35%, var(--surface)); }
.eh-col-h { display: flex; align-items: center; gap: 8px; margin: 0 0 10px; font: 600 13px/1.3 var(--font); color: var(--ink); }
.eh-col-h i { width: 9px; height: 9px; border-radius: 50%; background: var(--dot, var(--muted-2)); flex: none; }
.eh-col.is-open .eh-col-h i { background: none; border: 1.5px dashed var(--warn); }
.eh-col-h span { margin-left: auto; min-width: 22px; height: 22px; padding: 0 7px; display: inline-grid; place-items: center; border-radius: 99px; background: var(--surface); font-size: 11.5px; color: var(--ink-2); }
.eh-col ul { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 8px; }
.eh-pc { display: grid; grid-template-columns: auto minmax(0, 1fr); grid-template-areas: "av t" "av w"; gap: 2px 10px; align-items: center; width: 100%; min-height: 52px; padding: 10px 12px; border: 1px solid var(--hairline-2); border-radius: 12px; background: var(--surface); text-align: left; cursor: pointer; font: inherit; color: inherit; transition: border-color .15s, box-shadow .15s, transform .15s; }
.eh-pc:hover { border-color: color-mix(in srgb, var(--ink) 22%, transparent); box-shadow: var(--shadow-md); transform: translateY(-1px); }
.eh-pc-av { grid-area: av; display: flex; }
.eh-pc-av .eh-av + .eh-av { margin-left: -8px; }
.eh-pc-t { grid-area: t; font: 600 13.5px/1.35 var(--font); color: var(--ink); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.eh-pc-w { grid-area: w; font-size: 12px; color: var(--muted); }
.eh-pc.is-open { grid-template-columns: minmax(0, 1fr); grid-template-areas: "t" "w"; background: transparent; border-style: dashed; }

/* section notes */
.eh-banner { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 14px; align-items: start; margin: 20px 0 0; padding: 16px 18px; border-radius: 14px; background: var(--surface-3); border: 1px solid var(--hairline-2); }
.eh-banner.is-compact { margin: 0; padding: 14px 16px; grid-template-columns: auto minmax(0, 1fr); }
.eh-banner-ic { display: grid; place-items: center; width: 36px; height: 36px; border-radius: 10px; background: var(--ink); color: var(--surface-2); }
.eh-banner.is-important { background: var(--warn-soft); border-color: color-mix(in srgb, var(--warn) 25%, transparent); }
.eh-banner.is-important .eh-banner-ic { background: var(--warn); }
.eh-banner.is-good { background: var(--good-soft); border-color: color-mix(in srgb, var(--good) 25%, transparent); }
.eh-banner.is-good .eh-banner-ic { background: var(--good); }
.eh-banner-k { margin: 0 0 4px; font: 600 11px/1.4 var(--font); letter-spacing: .06em; text-transform: uppercase; color: var(--ink-2); }
.eh-banner-k span { font-weight: 500; letter-spacing: 0; text-transform: none; color: var(--muted); }
.eh-banner-text { font-size: 14.5px; line-height: 1.6; color: var(--ink); }
.eh-banner-text p { margin: 0 0 6px; } .eh-banner-text p:last-child { margin: 0; }
.eh-banner-add { display: flex; align-items: center; gap: 14px; width: 100%; margin: 20px 0 0; padding: 16px 18px; border: 1.5px dashed var(--hairline); border-radius: 14px; background: none; text-align: left; cursor: pointer; font: inherit; color: var(--ink); }
.eh-banner-add:hover { background: var(--surface-3); border-color: color-mix(in srgb, var(--ink) 25%, transparent); }
.eh-banner-add strong { display: block; font-size: 14px; }
.eh-banner-add small { display: block; margin-top: 2px; font-size: 12.5px; color: var(--muted); }
.eh-notes-top { gap: 12px; }
.eh-piece-note { margin: 22px 0 0; }

/* section switcher */
.eh-secnav { display: flex; width: 100%; }
.eh-secnav .eh-seg-b { flex: 1 0 auto; justify-content: center; position: relative; }
.eh-dot-you { position: absolute; top: 7px; right: 8px; width: 6px; height: 6px; border-radius: 50%; background: var(--info); }

/* all sections */
.eh-secgrid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; align-items: start; }
.eh-seccard { display: flex; flex-direction: column; overflow: hidden; }
.eh-seccard.is-mine { border-color: color-mix(in srgb, var(--info) 35%, transparent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--info) 8%, transparent), var(--shadow-sm); }
.eh-seccard-h { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 14px; align-items: center; width: 100%; padding: 20px 22px; border: 0; border-bottom: 1px solid var(--hairline-2); background: none; text-align: left; cursor: pointer; font: inherit; color: inherit; }
.eh-seccard-h:hover { background: var(--surface-3); }
.eh-seccard-t { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.eh-seccard-t .eh-meta { margin: 0; }
.eh-seccard-t b { color: var(--info); font-weight: 600; }
.eh-seccard-b { padding: 14px 16px 0; }
.eh-mini-list { margin: 0; padding: 8px 10px; list-style: none; }
.eh-mini-list button { display: grid; grid-template-columns: minmax(0, 1fr) auto; grid-template-areas: "t s" "w s"; gap: 1px 12px; align-items: center; width: 100%; min-height: 48px; padding: 8px 12px; border: 0; border-radius: 10px; background: none; text-align: left; cursor: pointer; font: inherit; color: inherit; }
.eh-mini-list button:hover { background: var(--surface-3); }
.eh-ml-t { grid-area: t; font: 600 13.5px/1.35 var(--font); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.eh-ml-w { grid-area: w; font-size: 12px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.eh-mini-list .eh-stage { grid-area: s; }
.eh-mini-list li.is-open .eh-ml-t { color: var(--warn); }
.eh-mini-list li.eh-muted { padding: 12px; font-size: 13.5px; }
.eh-seccard-f { margin-top: auto; padding: 12px 16px 16px; border-top: 1px solid var(--hairline-2); }

/* one section */
.eh-sechero { padding: 26px 28px 24px; }
.eh-sechero-top { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 18px 32px; }
.eh-sechero-name { margin: 0; font: 600 clamp(28px, 3.6vw, 38px)/1.1 var(--font); letter-spacing: -0.035em; }
.eh-sechero-stats { display: flex; flex-wrap: wrap; gap: 6px 22px; margin: 12px 0 0; font-size: 13.5px; color: var(--muted); }
.eh-sechero-stats strong { color: var(--ink); font-weight: 600; }
.eh-sechero-actions { display: flex; flex-wrap: wrap; gap: 8px; margin: 22px 0 0; padding: 18px 0 0; border-top: 1px solid var(--hairline-2); }
.eh-sechero-actions .btn svg { flex: none; }
.eh-sechero-about { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px 40px; margin: 22px 0 0; }
.eh-sechero-about .section-title { margin: 0 0 8px; }
.eh-sechero-about p:not(.section-title) { margin: 0; font-size: 14px; line-height: 1.65; color: var(--ink-2); }
.eh-desk-cols { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 40px; }
.eh-desk-cols .eh-st { margin-top: 0 !important; }
.eh-de-row { display: flex; flex-direction: column; gap: 6px; padding: 0 0 12px; border-bottom: 1px solid var(--hairline-2); }
.eh-de-row:last-of-type { border-bottom: 0; }
.eh-deskedit textarea.input { min-height: 56px; }
.eh-de-tools { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 4px 12px; }
.eh-de-move { display: inline-flex; align-items: center; gap: 2px; }
.eh-de-move .eh-act { min-width: 36px; min-height: 36px; justify-content: center; font-size: 14px; }
.eh-de-move .eh-act:disabled { opacity: .35; cursor: default; background: none; }

/* email the section */
.eh-recips { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 8px; margin: 0; padding: 0; list-style: none; }
.eh-recips li { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 10px; background: var(--surface-3); font-size: 13.5px; }
.eh-recips small { display: block; font-size: 11.5px; color: var(--danger); }
.eh-email-actions { margin-top: 6px; }

/* proposal brief */
.eh-fact { display: inline-flex; gap: 6px; margin-right: 18px; }
.eh-fact b { font-weight: 600; color: var(--ink-2); }
.eh-brief { display: flex; flex-direction: column; gap: 30px; padding: 26px 28px 30px; }
.eh-take { padding: 18px 20px; border-radius: 16px; background: #fbf6ec; border: 1px solid #eadbbd; }
.eh-take-h { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; margin: 0 0 12px; }
.eh-take-k { margin: 0; font: 600 11px/1.2 var(--font); letter-spacing: .14em; text-transform: uppercase; color: #7a4f12; }
.eh-take-list { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 12px; }
.eh-take-list li { font-size: 14.5px; line-height: 1.65; color: var(--ink); }
.eh-take-list li + li { padding-top: 12px; border-top: 1px solid #eadbbd; }
.eh-take-list p { margin: 0 0 6px; } .eh-take-list p:last-child { margin: 0; }
.eh-take-list a { color: var(--info); }
.eh-take .eh-by { color: #7a4f12; }
.eh-take-more { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px 14px; margin: 14px 0 0; padding-top: 12px; border-top: 1px solid #eadbbd; font-size: 13px; color: #8a6a3a; }
.eh-cell-k { margin: 0 0 8px; font: 600 11px/1.2 var(--font); letter-spacing: .12em; text-transform: uppercase; color: var(--muted); }
.eh-takeaway blockquote { margin: 0; padding: 4px 0 4px 22px; border-left: 3px solid var(--ink); font: 500 clamp(18px, 2vw, 21px)/1.5 var(--font); letter-spacing: -0.012em; color: var(--ink); }
.eh-takeaway.is-long blockquote { font-size: 17px; line-height: 1.6; }
.eh-takeaway blockquote p { margin: 0 0 8px; } .eh-takeaway blockquote p:last-child { margin: 0; }
.eh-lead { font-size: 16px; line-height: 1.75; color: var(--ink); max-width: 72ch; }
.eh-lead p { margin: 0 0 10px; } .eh-lead p:last-child { margin: 0; }
.eh-bsec { padding-top: 26px; border-top: 1px solid var(--hairline-2); }
.eh-bsec-h { margin: 0 0 16px; font: 600 17px/1.3 var(--font); letter-spacing: -0.015em; }
.eh-cells { display: grid; gap: 14px; }
.eh-cells.is-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.eh-cells.is-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.eh-cell { position: relative; padding: 16px 18px; border-radius: 14px; background: var(--surface-2); border: 1px solid var(--hairline-2); min-width: 0; }
.eh-cell-v { font-size: 14px; line-height: 1.65; color: var(--ink-2); overflow-wrap: anywhere; }
.eh-cell-v p { margin: 0 0 8px; } .eh-cell-v p:last-child { margin: 0; }
.eh-cell-v a, .eh-srcs a, .eh-lead a, .eh-path-v a, .eh-ask-v a { color: var(--info); }
.eh-cell-v.is-blank { color: var(--muted-2); font-style: italic; }
.eh-cell.is-long:not(.is-open) .eh-cell-v { display: -webkit-box; -webkit-line-clamp: 7; -webkit-box-orient: vertical; overflow: hidden; }
.eh-more { margin-top: 8px; padding: 0; border: 0; background: none; font: 600 13px var(--font); color: var(--ink); text-decoration: underline; text-underline-offset: 3px; cursor: pointer; min-height: 32px; }
.eh-path { margin: 0 0 14px; padding: 0; list-style: none; counter-reset: st; }
.eh-path li { counter-increment: st; position: relative; padding: 0 0 18px 44px; }
.eh-path li::before { content: counter(st); position: absolute; left: 0; top: -2px; display: grid; place-items: center; width: 28px; height: 28px; border-radius: 50%; background: var(--surface-3); font: 600 12px/1 var(--font); color: var(--ink); }
.eh-path li:not(:last-child)::after { content: ""; position: absolute; left: 13.5px; top: 30px; bottom: 2px; width: 1px; background: var(--hairline); }
.eh-path-k { display: block; margin: 2px 0 4px; font: 600 13px var(--font); color: var(--ink); }
.eh-path-v { font-size: 14px; line-height: 1.65; color: var(--ink-2); }
.eh-path-v p { margin: 0 0 6px; } .eh-path-v p:last-child { margin: 0; }
.eh-srcs { margin: 0; padding: 0 0 0 18px; display: flex; flex-direction: column; gap: 8px; font-size: 13.5px; line-height: 1.55; color: var(--ink-2); }
.eh-srcs p { margin: 0; }
.eh-ask { padding: 18px 20px; border-radius: 16px; background: var(--info-soft); }
.eh-ask .eh-cell-k { color: var(--info); }
.eh-ask-v { font-size: 14.5px; line-height: 1.65; color: var(--ink); }
.eh-ask-v p { margin: 0 0 8px; } .eh-ask-v p:last-child { margin: 0; }
.eh-brief .eh-notes { margin-top: 10px; }

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
.eh-act { display: inline-flex; align-items: center; gap: 5px; min-height: 32px; padding: 0 8px; border: 0; border-radius: 8px; background: none; font: 500 12.5px var(--font); color: var(--muted); cursor: pointer; }
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
  .eh-cells.is-3 { grid-template-columns: minmax(0, 1fr); }
  .eh-strip { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .eh-secgrid, .eh-sechero-about, .eh-desk-cols { grid-template-columns: minmax(0, 1fr); }
  .eh-secnav { display: inline-flex; width: auto; max-width: 100%; }
  .eh-pgrid { grid-template-columns: minmax(0, 1fr); grid-template-areas: "side" "main"; }
  .eh-pside { position: static; }
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
  .eh-head { padding-top: 0; }
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
  .eh-fb { padding: 4px 18px 16px; }
  .eh-msg { padding: 16px 18px; gap: 10px; grid-template-columns: 32px minmax(0, 1fr); }
  .eh-msg-head time { margin-left: 0; flex-basis: 100%; }
  .eh-about select { flex: 1; max-width: none; }
  .eh-compose .eh-about { flex-basis: 100%; }
  .eh-where { grid-template-columns: minmax(0, 1fr); gap: 2px; }
  .eh-where dd { margin-bottom: 8px; }
  .eh-acc summary { padding: 0 18px; }
  .eh-acc details > :not(summary) { margin: 0 18px 18px; }
  .eh-iv { padding: 16px 18px; }
  .eh-tl li { grid-template-columns: 24px 64px minmax(0, 1fr); }
  .eh-pg-top { grid-template-columns: minmax(0, 1fr); gap: 8px; }
  .eh-cells.is-2 { grid-template-columns: minmax(0, 1fr); }
  .eh-brief { padding: 18px; gap: 24px; }
  .eh-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .eh-board { grid-template-columns: minmax(0, 1fr); }
  .eh-sechero { padding: 20px 18px; }
  .eh-seccard-h { grid-template-columns: auto minmax(0, 1fr); }
  .eh-seccard-h .eh-person { grid-column: 1 / -1; }
  .eh-banner { grid-template-columns: auto minmax(0, 1fr); }
  .eh-banner > .btn { grid-column: 2; justify-self: start; }
}
@media (prefers-reduced-motion: reduce) {
  .eh *, .eh *::before, .eh *::after { transition: none !important; animation: none !important; }
  .eh-word { opacity: 1; transform: none; }
}
`;
  document.head.appendChild(s);
}
