// When to meet: availability polls, like when2meet. They live on the
// Meeting page (meeting.js embeds mountPoll for each poll you're invited to);
// the old #/meet links redirect there.
//
//   • Admins create a poll in Advanced tools → When to meet (mountMeetTool):
//     a title, the days, and who's invited. /api/meet/notify then emails and
//     bells everyone invited.
//   • Invitees see it on their Meeting page, and Meeting jumps to the top of
//     their sidebar in red until they answer (app.js). They drag over the
//     half-hours they're free, 8 AM to 9 PM Eastern; anything left blank
//     counts as busy. Their answer saves as they go.
//   • Beside it, everyone's answers as a heatmap: the more people free, the
//     deeper the green. Hover a cell to see who's free and who isn't. The best
//     windows are listed below, and an admin can turn one into the next team
//     meeting (#/meeting?poll=…&date=…&start=…&end=…).
//
// Urgent polls (e.g. for people who missed the last meeting) carry urgent,
// reason and answerBy: until someone answers, the Suite shows them a red
// banner on every page (app.js paintMeetUrgent) and a red note on the poll.
// The results can be narrowed to an edition section, the section editors,
// writers or admins (from This edition), and "Who's free when" shows each
// person's day as a row.
//
// Data: meet_polls/{id} { title, note, dates: ["YYYY-MM-DD"], invitedUids,
// urgent, reason, answerBy (UTC ISO), nudgedAt,
// invitees: [{ name, uids }], status: open|closed, createdAt, createdBy… } and
// meet_polls/{id}/responses/{uid} { uid, name, slots: ["YYYY-MM-DDTHH:MM"] }.
// Rules: admins manage polls; invitees read the poll and all answers, and
// write only their own while it's open.

import { db, auth } from "../firebase-config.js";
import {
  collection, doc, onSnapshot, query, where, orderBy, addDoc, setDoc, updateDoc, deleteDoc, getDocs, getDoc,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { el, esc, toast, confirmDialog } from "./ui.js";
import { loadPeople, mountPeoplePicker, peopleUids, PICKER_CSS } from "./people-picker.js?v=1";
import { CURRENT_EDITION } from "./edition-deadlines.js?v=1";

const START = 8, END = 21, STEP = 30;   // 8:00 AM to 9:00 PM ET, half-hours
const SLOTS = (() => { const a = []; for (let m = START * 60; m < END * 60; m += STEP) a.push(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`); return a; })();
const nextSlot = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); const t = h * 60 + m + STEP; return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`; };
const clock = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return `${((h + 11) % 12) + 1}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "AM" : "PM"}`; };
const range = (a, b) => { const x = clock(a), y = clock(b); return x.slice(-2) === y.slice(-2) ? `${x.slice(0, -3)}–${y}` : `${x}–${y}`; };
const day = (iso, opts = { weekday: "short", month: "short", day: "numeric" }) => new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", opts);
const tomorrowIso = () => { const d = new Date(); d.setDate(d.getDate() + 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
// Eastern wall time → UTC ISO (same as meeting.js).
function etToUtcIso(date, hhmm) {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = hhmm.split(":").map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    .formatToParts(new Date(guess)).map((p) => [p.type, p.value]));
  return new Date(guess + (guess - Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute))).toISOString();
}
const byText = (iso) => iso ? `${new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).replace(":00", "")} ET` : "";
const REASON = "You missed our last meeting, so we need your availability.";
// Heatmap green for a share of people free (0–1).
const heat = (pct) => `rgba(46, 139, 87, ${(0.2 + 0.8 * pct).toFixed(3)})`;

// Groups to narrow the results by: each section of the edition in progress
// (its editor + writers, from This edition), section editors, writers, admins.
let groupsCache = null;
async function loadGroups() {
  if (groupsCache) return groupsCache;
  const [team, hub, pieces] = await Promise.all([
    loadPeople().catch(() => []),
    getDoc(doc(db, "edition_hub", CURRENT_EDITION)).catch(() => null),
    getDocs(collection(db, "edition_hub", CURRENT_EDITION, "pieces")).catch(() => null),
  ]);
  const low = (x) => String(x || "").trim().toLowerCase();
  const h = hub?.data?.() || {};
  const sections = (h.sections || []).map((sec) => ({ id: sec.id, name: sec.name, names: new Set([low(sec.editor?.name)].filter(Boolean)), uids: new Set(sec.editor?.uids || []) }));
  const writers = { names: new Set(), uids: new Set() };
  pieces?.forEach((d) => {
    const pc = d.data();
    const sec = sections.find((x) => x.id === pc.section);
    (pc.writers || []).forEach((w) => { if (w?.name) { sec?.names.add(low(w.name)); writers.names.add(low(w.name)); } });
    (pc.writerUids || []).forEach((u) => { sec?.uids.add(u); writers.uids.add(u); });
  });
  const roleOf = new Map(team.map((p) => [low(p.name), p]));
  const inSet = (set) => (p) => set.names.has(low(p.name)) || p.uids.some((u) => set.uids.has(u));
  groupsCache = [
    ...sections.map((sec) => ({ id: `s:${sec.id}`, label: sec.name, test: inSet(sec) })),
    { id: "editors", label: "Section editors", test: (p) => !!roleOf.get(low(p.name))?.sectionEditor || sections.some((sec) => [...sec.names][0] === low(p.name)) },
    { id: "writers", label: "Writers", test: inSet(writers) },
    { id: "admins", label: "Admins", test: (p) => !!roleOf.get(low(p.name))?.roles?.has("admin") },
  ];
  return groupsCache;
}

// ─── #/meet: old links (emails, notifications) → the Meeting page ───────────
export async function mount(ctx, container) {
  const pollId = new URLSearchParams(location.hash.split("?")[1] || "").get("poll");
  location.replace(`#/meeting${pollId ? `?poll=${encodeURIComponent(pollId)}` : ""}`);
  return () => {};
}

// ─── one poll, embedded in the Meeting page ─────────────────────────────────
// Returns a cleanup function.
export function mountPoll(ctx, container, id) {
  injectStyle();
  const isAdmin = ctx.role === "admin";
  const meUid = ctx.user?.uid || "";
  const meName = ctx.profile?.name || ctx.user?.displayName || "";
  const canWrite = () => auth.currentUser && auth.currentUser.uid === meUid;
  const root = el("div", { class: "mt is-embedded" });
  container.innerHTML = "";
  container.appendChild(root);
  const unsubs = [];
  pollView(id);
  return () => unsubs.forEach((u) => { try { u(); } catch {} });

  // One poll: your grid, everyone's heatmap, the best windows.
  function pollView(id) {
    let poll = null, responses = new Map(), mine = null, dirty = false, saveTimer = null, tab = "mine";
    let groups = [], filter = "all", hidden = new Set(), whoDay = "";
    loadGroups().then((g) => { groups = g; if (poll) { paintFilters(); paintGroup(); } }).catch(() => {});
    const onScroll = () => hideTip();
    window.addEventListener("scroll", onScroll, { passive: true, capture: true });
    unsubs.push(() => window.removeEventListener("scroll", onScroll, { capture: true }));
    // One delegated listener for the whole poll view (render() rebuilds the DOM).
    root.addEventListener("click", async (e) => {
        if (!e.target.closest(".mt-groupgrid")) hideTip();
      const f = e.target.closest("[data-filter]");
      if (f) { filter = f.dataset.filter; paintFilters(); paintGroup(); return; }
      const h = e.target.closest("[data-hide]");
      if (h) { const n = h.dataset.hide; hidden.has(n) ? hidden.delete(n) : hidden.add(n); paintFilters(); paintGroup(); return; }
      if (e.target.closest("[data-unhide]")) { hidden.clear(); paintFilters(); paintGroup(); return; }
      const wd = e.target.closest("[data-whoday]");
      if (wd) { whoDay = wd.dataset.whoday; paintByWho(shown(), [...(poll.dates || [])].sort()); return; }
      const nb = e.target.closest("[data-nudge]");
      if (nb) {
        const uids = JSON.parse(nb.dataset.uids || "[]");
        if (!uids.length || !(await confirmDialog(`Email and notify the ${nb.textContent.match(/\d+/)?.[0] || ""} people who haven't answered yet?`, { confirmText: "Send nudge" }))) return;
        nb.disabled = true;
        try {
          const res = await ctx.authedFetch("/api/meet/notify", { method: "POST", body: JSON.stringify({ pollId: id, nudgeUids: uids }) });
          const data = await res.json().catch(() => ({}));
          toast(res.ok ? `Nudged ${plural(data.emailed || 0, "person", "people")}.` : (data.error || "Couldn't send the nudge."), res.ok ? "success" : "error");
        } catch { toast("Couldn't send the nudge.", "error"); }
        nb.disabled = false;
      }
    });
    root.innerHTML = `<div class="loading-state"><div class="spinner"></div>Loading&hellip;</div>`;
    unsubs.push(onSnapshot(doc(db, "meet_polls", id), (s) => { poll = s.exists() ? { id: s.id, ...s.data() } : null; render(); },
      () => { root.innerHTML = `<div class="mt-empty"><p>You're not invited to this one.</p></div>`; }));
    unsubs.push(onSnapshot(collection(db, "meet_polls", id, "responses"), (s) => {
      responses = new Map(s.docs.map((d) => [d.id, d.data()]));
      if (!dirty) { mine = new Set(responses.get(meUid)?.slots || []); paintMine(); }
      if (poll) paintGroup();
    }, () => {}));

    const open = () => poll && poll.status !== "closed";
    const editable = () => open() && canWrite();

    // People = everyone invited (one row per person, all their accounts),
    // plus anyone else who answered.
    function people() {
      const list = (poll.invitees || []).map((p) => ({ name: p.name, uids: p.uids || [], slots: new Set(), answered: false }));
      const byUid = new Map(); list.forEach((p) => p.uids.forEach((u) => byUid.set(u, p)));
      responses.forEach((r, uid) => {
        let p = byUid.get(uid);
        if (!p) { p = { name: r.name || "Someone", uids: [uid], slots: new Set(), answered: false }; list.push(p); byUid.set(uid, p); }
        p.answered = true;
        (uid === meUid && mine ? [...mine] : (r.slots || [])).forEach((k) => p.slots.add(k));
      });
      // Your own row reflects what you're painting, before it saves.
      if (mine && !responses.has(meUid)) {
        const p = byUid.get(meUid);
        if (p && mine.size) { mine.forEach((k) => p.slots.add(k)); p.answered = true; }
      }
      return list;
    }

    // Everyone in the current view: the chosen group, minus anyone hidden.
    function shown() {
      const g = groups.find((x) => x.id === filter);
      return people().filter((p) => (!g || g.test(p)) && !hidden.has(p.name));
    }

    function paintFilters() {
      const box = root.querySelector(".mt-filters");
      if (!box || !poll) return;
      const all = people();
      const chips = [{ id: "all", label: "Everyone", n: all.length }, ...groups.map((g) => ({ id: g.id, label: g.label, n: all.filter(g.test).length }))].filter((c) => c.id === "all" || c.n);
      if (chips.length < 2 && !hidden.size) { box.innerHTML = ""; return; }
      box.innerHTML = `<span class="mt-filters-label">Show</span>${chips.map((c) => `<button type="button" class="mt-fchip${filter === c.id ? " is-on" : ""}" data-filter="${esc(c.id)}" aria-pressed="${filter === c.id}">${esc(c.label)}<span>${c.n}</span></button>`).join("")}${hidden.size ? `<button type="button" class="mt-link" data-unhide>Show ${hidden.size} hidden</button>` : ""}`;
    }

    // The Meeting page's header for this poll carries the red call to action
    // and the thank-you (meeting.js), so nothing extra here.
    function paintUrgent() {}

    function render() {
      if (!poll) { root.innerHTML = `<div class="mt-empty"><p>This poll was deleted.</p></div>`; return; }
      if (!mine) mine = new Set(responses.get(meUid)?.slots || []);
      const dates = [...(poll.dates || [])].sort();
      root.innerHTML = `
        <header class="mt-head">
          <div class="mt-head-row"><h3>${esc(poll.title || "Find a time")}</h3>${poll.status === "closed" ? `<span class="mt-chip">Closed</span>` : ""}</div>
          ${poll.note ? `<p class="mt-note">${esc(poll.note)}</p>` : ""}
          <p class="mt-sub">${esc(dates.map((d) => day(d, { weekday: "long", month: "short", day: "numeric" })).join(" · "))} · 8 AM–9 PM, Eastern Time${poll.answerBy ? ` · Answer by ${esc(byText(poll.answerBy))}` : ""}</p>
          ${isAdmin ? `<div class="mt-admin"><button type="button" class="btn btn-ghost btn-sm" data-status>${poll.status === "closed" ? "Reopen the poll" : "Close the poll"}</button><button type="button" class="btn btn-secondary btn-sm" data-nudge hidden></button></div>` : ""}
        </header>
        <div class="mt-filters" role="group" aria-label="Show availability for"></div>
        <div class="mt-tabs" role="tablist"><button type="button" role="tab" data-tab="mine" aria-selected="${tab === "mine"}">Your times</button><button type="button" role="tab" data-tab="group" aria-selected="${tab === "group"}">Everyone</button></div>
        <div class="mt-panels" data-tab-now="${tab}">
          <section class="mt-panel mt-panel-mine">
            <div class="mt-panel-h">
              <div><h2>Your times</h2><p class="mt-panel-sub">${editable() ? "Drag across the times you're free." : poll.status === "closed" ? "This poll is closed." : "Previewing, so you can't mark times."}</p></div>
              <div class="mt-panel-tools"><span class="mt-save" aria-live="polite"></span>${editable() ? `<button type="button" class="mt-textbtn" data-clear>Clear</button>` : ""}</div>
            </div>
            ${grid(dates, "mine")}
          </section>
          <section class="mt-panel mt-panel-group">
            <div class="mt-panel-h">
              <div><h2>Everyone</h2><p class="mt-panel-sub">Darker green, more people free.</p></div>
              <div class="mt-panel-tools mt-legend" aria-hidden="true"></div>
            </div>
            <div class="mt-groupgrid"></div>
          </section>
        </div>
        <div class="mt-tip" role="tooltip" hidden></div>
        <section class="mt-best"></section>
        <section class="mt-bywho"></section>
        <section class="mt-who"></section>`;
      paintFilters();
      paintGroup();
      wire();
    }

    function grid(dates, kind) {
      const head = `<div class="mt-corner"></div>${dates.map((d) => `<div class="mt-dh"><span>${esc(day(d, { weekday: "short" }))}</span><b>${esc(day(d, { month: "short", day: "numeric" }))}</b></div>`).join("")}`;
      const rows = SLOTS.map((t) => `<div class="mt-th${t.endsWith(":00") ? "" : " is-half"}">${t.endsWith(":00") ? esc(clock(t)) : ""}</div>${dates.map((d) => {
        const k = `${d}T${t}`;
        return kind === "mine"
          ? `<div class="mt-cell${mine.has(k) ? " is-on" : ""}${t.endsWith(":00") ? " is-hour" : ""}" data-k="${k}" role="gridcell" aria-selected="${mine.has(k)}" aria-label="${esc(`${day(d)} ${clock(t)}`)}" tabindex="-1"></div>`
          : `<div class="mt-cell mt-heat${t.endsWith(":00") ? " is-hour" : ""}" data-k="${k}" tabindex="-1"></div>`;
      }).join("")}`).join("") + `<div class="mt-th mt-th-end">${esc(clock(`${END}:00`))}</div><div class="mt-end" style="grid-column: 2 / -1"></div>`;
      return `<div class="mt-grid${kind === "mine" && editable() ? " is-edit" : ""}" data-grid="${kind}" role="grid" style="--cols:${dates.length}">${head}${rows}</div>`;
    }

    // Your grid, from `mine` (when your saved answer arrives after the poll).
    function paintMine() {
      root.querySelectorAll('[data-grid="mine"] [data-k]').forEach((c) => {
        const on = mine.has(c.dataset.k);
        c.classList.toggle("is-on", on);
        c.setAttribute("aria-selected", String(on));
      });
    }

    function paintGroup() {
      if (!poll || !root.querySelector(".mt-groupgrid")) return;
      const dates = [...(poll.dates || [])].sort();
      const ppl = shown(), total = ppl.length || 1;
      const count = (k) => ppl.filter((p) => p.slots.has(k)).length;
      const g = root.querySelector(".mt-groupgrid");
      g.innerHTML = grid(dates, "group");
      g.querySelectorAll("[data-k]").forEach((c) => {
        const n = count(c.dataset.k), pct = n / total;
        c.dataset.n = n;
        if (n) { c.style.background = heat(pct); if (pct > 0.55) c.classList.add("is-deep"); }
        c.setAttribute("aria-label", `${day(c.dataset.k.slice(0, 10))} ${clock(c.dataset.k.slice(11))}: ${n} of ${total} free`);
      });
      root.querySelector(".mt-legend").innerHTML = `<span>0</span>${[0, 0.25, 0.5, 0.75, 1].map((x) => `<i style="background:${x ? heat(x) : "var(--mt-empty)"}"></i>`).join("")}<span>${total}</span>`;
      paintBest(ppl, dates, total);
      paintByWho(ppl, dates);
      paintWho(people());
      paintUrgent();
      const nb = root.querySelector("[data-nudge]");
      if (nb) {
        const waiting = people().filter((p) => !p.answered && p.uids.length);
        nb.hidden = !waiting.length || poll.status === "closed";
        nb.textContent = `Nudge the ${waiting.length} who haven't answered`;
        nb.dataset.uids = JSON.stringify(waiting.flatMap((p) => p.uids));
      }
    }

    // Who's free when: one row per person for a chosen day.
    function paintByWho(ppl, dates) {
      const box = root.querySelector(".mt-bywho");
      if (!box) return;
      if (!dates.includes(whoDay)) whoDay = dates[0] || "";
      const rows = [...ppl].sort((a, b) => b.slots.size - a.slots.size || a.name.localeCompare(b.name));
      box.innerHTML = `<h2 class="mt-h2">Who's free when</h2>
        <div class="mt-daytabs">${dates.map((d) => `<button type="button" class="mt-fchip${d === whoDay ? " is-on" : ""}" data-whoday="${d}" aria-pressed="${d === whoDay}">${esc(day(d))}</button>`).join("")}</div>
        ${rows.length ? `<div class="mt-tl-wrap"><div class="mt-tl" style="--n:${SLOTS.length}">
          <div class="mt-tl-name"></div>${SLOTS.map((t) => `<div class="mt-tl-h">${t.endsWith(":00") && Number(t.slice(0, 2)) % 2 === 0 ? esc(clock(t).replace(" ", "\u00a0")) : ""}</div>`).join("")}
          ${rows.map((p) => `<div class="mt-tl-name${p.answered ? "" : " is-none"}" title="${esc(p.name)}">${esc(p.name)}${p.answered ? "" : " <small>no answer</small>"}</div>${SLOTS.map((t) => `<div class="mt-tl-c${p.slots.has(`${whoDay}T${t}`) ? " is-on" : ""}${t.endsWith(":00") ? " is-hour" : ""}" title="${esc(`${p.name}: ${clock(t)}`)}"></div>`).join("")}`).join("")}
          <div class="mt-tl-name mt-tl-total">Free</div>${SLOTS.map((t) => { const n = rows.filter((p) => p.slots.has(`${whoDay}T${t}`)).length; return `<div class="mt-tl-n${n === rows.length && n ? " is-all" : ""}">${n || ""}</div>`; }).join("")}
        </div></div>` : `<p class="mt-hint">No one in this group.</p>`}`;
    }

    // The best windows: runs of half-hours where the same people are free.
    function paintBest(ppl, dates, total) {
      const wins = [];
      dates.forEach((d) => {
        let cur = null;
        SLOTS.forEach((t, i) => {
          const free = ppl.filter((p) => p.slots.has(`${d}T${t}`)).map((p) => p.name);
          const key = free.join("|");
          if (cur && cur.key === key) { cur.end = i; return; }
          if (cur && cur.free.length) wins.push(cur);
          cur = { d, start: i, end: i, key, free };
        });
        if (cur && cur.free.length) wins.push(cur);
      });
      wins.sort((a, b) => (b.free.length - a.free.length) || ((b.end - b.start) - (a.end - a.start)) || a.d.localeCompare(b.d) || a.start - b.start);
      const top = wins.slice(0, 5);
      const box = root.querySelector(".mt-best");
      box.innerHTML = `<h2 class="mt-h2">Best times</h2>${top.length ? `<ol class="mt-wins">${top.map((w) => {
        const s = SLOTS[w.start], e = nextSlot(SLOTS[w.end]);
        const missing = ppl.filter((p) => !w.free.includes(p.name)).map((p) => p.name);
        return `<li class="mt-win">
          <div class="mt-win-when"><b>${esc(day(w.d, { weekday: "long", month: "short", day: "numeric" }))}</b><span>${esc(range(s, e))} ET</span></div>
          <div class="mt-win-who"><span class="mt-chip ${w.free.length / total >= 0.6 ? "is-good" : ""}">${w.free.length} of ${total} free</span>${missing.length ? `<small>Can't: ${esc(missing.join(", "))}</small>` : `<small>Everyone's free</small>`}</div>
          ${isAdmin ? `<a class="btn btn-secondary btn-sm" href="#/meeting?poll=${esc(poll.id)}&date=${w.d}&start=${s}&end=${e}">Schedule meeting</a>` : ""}
        </li>`;
      }).join("")}</ol>` : `<p class="mt-hint">No one has marked any times yet.</p>`}`;
    }

    function paintWho(ppl) {
      const box = root.querySelector(".mt-who");
      const done = ppl.filter((p) => p.answered).length;
      box.innerHTML = `<h2 class="mt-h2">Who's answered <span>${done} of ${ppl.length}</span></h2><p class="mt-people">${ppl.map((p) => `<button type="button" class="mt-person${p.answered ? " is-done" : ""}${hidden.has(p.name) ? " is-hidden" : ""}" data-hide="${esc(p.name)}" aria-pressed="${!hidden.has(p.name)}" title="${hidden.has(p.name) ? "Show" : "Hide"} ${esc(p.name)} in the results">${p.answered ? "&#10003; " : ""}${esc(p.name)}</button>`).join("")}</p><p class="mt-hint">Tap a name to leave them out of the results (or bring them back).</p>`;
    }

    function info(k) {
      const ppl = shown();
      const free = ppl.filter((p) => p.slots.has(k)).map((p) => p.name);
      const busy = ppl.filter((p) => !p.slots.has(k)).map((p) => p.name);
      const tip = root.querySelector(".mt-tip");
      const cell = root.querySelector(`.mt-groupgrid [data-k="${k}"]`);
      if (!tip || !cell) return;
      tip.innerHTML = `<div class="mt-tip-h"><b>${esc(day(k.slice(0, 10), { weekday: "short", month: "short", day: "numeric" }))}</b><span>${esc(range(k.slice(11), nextSlot(k.slice(11))))}</span></div>
        <div class="mt-tip-n"><strong>${free.length}</strong> of ${ppl.length} free</div>
        ${free.length ? `<ul class="mt-tip-list is-free">${free.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}
        ${busy.length ? `<ul class="mt-tip-list">${busy.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}`;
      tip.hidden = false;
      const r = cell.getBoundingClientRect(), t = tip.getBoundingClientRect();
      const left = Math.min(Math.max(8, r.left + r.width / 2 - t.width / 2), innerWidth - t.width - 8);
      const above = r.top - t.height - 10;
      tip.style.left = `${left}px`;
      tip.style.top = `${above > 8 ? above : r.bottom + 10}px`;
    }
    function hideTip() { const tip = root.querySelector(".mt-tip"); if (tip) tip.hidden = true;
    }

    function save() {
      if (!editable()) return;
      clearTimeout(saveTimer);
      const s = root.querySelector(".mt-save"); if (s) s.textContent = "Saving…";
      saveTimer = setTimeout(async () => {
        try {
          await setDoc(doc(db, "meet_polls", id, "responses", meUid), { uid: meUid, name: meName, slots: [...mine].sort(), updatedAt: new Date().toISOString() });
          dirty = false;
          const t = root.querySelector(".mt-save"); if (t) t.textContent = "Saved";
        } catch (err) {
          console.warn("[meet] save", err);
          const t = root.querySelector(".mt-save"); if (t) t.textContent = "Couldn't save";
          toast("Couldn't save your times. Try again.", "error");
        }
      }, 450);
    }

    function wire() {
      const g = root.querySelector('[data-grid="mine"]');
      let painting = false, mode = true;
      const apply = (c) => {
        const k = c.dataset.k;
        if (mode) mine.add(k); else mine.delete(k);
        c.classList.toggle("is-on", mode);
        c.setAttribute("aria-selected", String(mode));
      };
      if (g && editable()) {
        g.addEventListener("pointerdown", (e) => {
          const c = e.target.closest("[data-k]"); if (!c) return;
          e.preventDefault();
          painting = true; dirty = true; mode = !mine.has(c.dataset.k);
          apply(c);
          try { g.setPointerCapture(e.pointerId); } catch {}
        });
        g.addEventListener("pointermove", (e) => {
          if (!painting) return;
          const c = document.elementFromPoint(e.clientX, e.clientY)?.closest?.("[data-k]");
          if (c && g.contains(c) && mine.has(c.dataset.k) !== mode) apply(c);
        });
        const end = () => { if (!painting) return; painting = false; paintGroup(); save(); };
        g.addEventListener("pointerup", end);
        g.addEventListener("pointercancel", end);
        // Keyboard: arrows move, space or enter toggles.
        const cells = [...g.querySelectorAll("[data-k]")];
        if (cells[0]) cells[0].tabIndex = 0;
        const cols = (poll.dates || []).length;
        g.addEventListener("keydown", (e) => {
          const i = cells.indexOf(document.activeElement); if (i < 0) return;
          const move = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols }[e.key];
          if (move) { e.preventDefault(); const n = cells[i + move]; if (n) { cells[i].tabIndex = -1; n.tabIndex = 0; n.focus(); } return; }
          if (e.key === " " || e.key === "Enter") { e.preventDefault(); dirty = true; mode = !mine.has(cells[i].dataset.k); apply(cells[i]); paintGroup(); save(); }
        });
      }
      const gg = root.querySelector(".mt-groupgrid");
      gg.addEventListener("mouseover", (e) => { const c = e.target.closest("[data-k]"); if (c) info(c.dataset.k); });
      gg.addEventListener("mouseleave", hideTip);
      gg.addEventListener("click", (e) => { const c = e.target.closest("[data-k]"); if (c) { e.stopPropagation(); info(c.dataset.k); } });
      root.querySelector("[data-clear]")?.addEventListener("click", async () => {
        if (!mine.size || !(await confirmDialog("Clear all of your times?", { confirmText: "Clear" }))) return;
        mine.clear(); dirty = true; render(); save();
      });
      root.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => {
        tab = b.dataset.tab;
        root.querySelector(".mt-panels").dataset.tabNow = tab;
        root.querySelectorAll("[data-tab]").forEach((x) => x.setAttribute("aria-selected", String(x.dataset.tab === tab)));
      }));
      root.querySelector("[data-status]")?.addEventListener("click", async () => {
        try { await updateDoc(doc(db, "meet_polls", id), { status: poll.status === "closed" ? "open" : "closed" }); }
        catch { toast("Couldn't change the poll.", "error"); }
      });
    }
  }
}

// ─── Advanced tools → When to meet ──────────────────────────────────────────
export async function mountMeetTool(ctx, root, paneHeader) {
  injectStyle();
  root.innerHTML = paneHeader("When to meet", "Find a time that works, like when2meet. Pick the days and who's invited: they get an email and a notification, and the poll shows up on their Meeting page, where they drag over the times they're free (8 AM–9 PM Eastern). Until they answer, Meeting sits at the top of their sidebar in red. Only the people you invite see it. You'll see the best times as answers come in, and can turn one into the next meeting.")
    + `<div class="mt-tool"><div class="mt-loading">Loading the team&hellip;</div></div><div class="mt-toollist"></div>`;
  const box = root.querySelector(".mt-tool");
  let people = [];
  try { people = await loadPeople(); } catch { box.innerHTML = `<p class="mt-hint">Couldn't load the team.</p>`; return; }
  const dates = new Set();
  const names = new Set();
  let month = (() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); })();
  box.innerHTML = `
    <form class="mt-form" novalidate>
      <label class="mt-f"><span>Title</span><input class="input" name="title" maxlength="120" value="Catch-up meeting" required></label>
      <label class="mt-f"><span>Note (optional)</span><textarea class="input" name="note" rows="2" maxlength="600" placeholder="First drafts are due Wednesday, so let's catch up before then."></textarea></label>
      <fieldset class="mt-urgentset">
        <label class="mt-check"><input type="checkbox" name="urgent" checked> <span><b>Urgent</b>: also show a red banner on every page of their Suite until they answer</span></label>
        <div class="mt-urgentfields">
          <label class="mt-f"><span>Why (shown in red)</span><input class="input" name="reason" maxlength="160" value="${esc(REASON)}"></label>
          <div class="mt-f2">
            <label class="mt-f"><span>Answer by (day)</span><input class="input" type="date" name="byDay" value="${esc(tomorrowIso())}"></label>
            <label class="mt-f"><span>Time (ET)</span><input class="input" type="time" name="byTime" step="900" value="21:00"></label>
          </div>
        </div>
      </fieldset>
      <div class="mt-f"><span>Days</span><div class="mt-cal"></div><div class="mt-daychips"></div></div>
      <div class="mt-f"><span>Who's invited</span><div class="mt-picker"></div></div>
      <div class="mt-form-foot"><span class="mt-form-msg" aria-live="polite"></span><button type="submit" class="btn btn-primary">Create and invite</button></div>
    </form>`;
  const form = box.querySelector("form");
  const msg = box.querySelector(".mt-form-msg");
  const syncUrgent = () => { box.querySelector(".mt-urgentfields").hidden = !form.urgent.checked; };
  form.urgent.addEventListener("change", syncUrgent);
  const cal = box.querySelector(".mt-cal");
  const chips = box.querySelector(".mt-daychips");
  const paintCal = () => {
    const y = month.getFullYear(), m = month.getMonth();
    const first = new Date(y, m, 1).getDay(), days = new Date(y, m + 1, 0).getDate();
    const today = todayIso();
    const cells = [];
    for (let i = 0; i < first; i++) cells.push(`<span></span>`);
    for (let d = 1; d <= days; d++) {
      const iso = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      cells.push(`<button type="button" class="mt-day${dates.has(iso) ? " is-on" : ""}${iso === today ? " is-today" : ""}" data-day="${iso}" ${iso < today ? "disabled" : ""} aria-pressed="${dates.has(iso)}">${d}</button>`);
    }
    cal.innerHTML = `<div class="mt-cal-h"><button type="button" class="mt-calnav" data-cal="-1" aria-label="Previous month">&lsaquo;</button><b>${month.toLocaleDateString("en-US", { month: "long", year: "numeric" })}</b><button type="button" class="mt-calnav" data-cal="1" aria-label="Next month">&rsaquo;</button></div>
      <div class="mt-cal-g">${["S", "M", "T", "W", "T", "F", "S"].map((w) => `<i>${w}</i>`).join("")}${cells.join("")}</div>`;
    chips.innerHTML = dates.size ? [...dates].sort().map((d) => `<span class="mt-chip">${esc(day(d))}<button type="button" data-unday="${d}" aria-label="Remove ${esc(day(d))}">&times;</button></span>`).join("") : `<span class="mt-hint">Pick one or more days.</span>`;
  };
  cal.addEventListener("click", (e) => {
    const n = e.target.closest("[data-cal]"); if (n) { month = new Date(month.getFullYear(), month.getMonth() + Number(n.dataset.cal), 1); paintCal(); return; }
    const d = e.target.closest("[data-day]"); if (d) { dates.has(d.dataset.day) ? dates.delete(d.dataset.day) : dates.add(d.dataset.day); paintCal(); }
  });
  chips.addEventListener("click", (e) => { const b = e.target.closest("[data-unday]"); if (b) { dates.delete(b.dataset.unday); paintCal(); } });
  paintCal();
  mountPeoplePicker(box.querySelector(".mt-picker"), people, names);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = form.title.value.trim();
    if (!title) { msg.textContent = "Add a title."; return; }
    if (!dates.size) { msg.textContent = "Pick at least one day."; return; }
    if (!names.size) { msg.textContent = "Invite at least one person."; return; }
    const urgent = form.urgent.checked;
    let answerBy = "";
    if (form.byDay.value && form.byTime.value) {
      answerBy = etToUtcIso(form.byDay.value, form.byTime.value);
      if (Date.parse(answerBy) <= Date.now()) { msg.textContent = "The answer-by time has already passed."; return; }
    }
    const btn = form.querySelector('[type="submit"]'); btn.disabled = true; msg.textContent = "Creating…";
    try {
      const invitees = people.filter((p) => names.has(p.name)).map((p) => ({ name: p.name, uids: p.uids }));
      const ref = await addDoc(collection(db, "meet_polls"), {
        title, note: form.note.value.trim(), dates: [...dates].sort(), startHour: START, endHour: END, slotMinutes: STEP,
        invitedUids: peopleUids(people, names), invitees, status: "open",
        urgent, reason: urgent ? (form.reason.value.trim() || REASON) : "", answerBy,
        createdAt: new Date().toISOString(), createdBy: ctx.user?.uid || "", createdByName: ctx.profile?.name || "",
      });
      msg.textContent = "Sending invites…";
      const res = await ctx.authedFetch("/api/meet/notify", { method: "POST", body: JSON.stringify({ pollId: ref.id }) });
      const data = await res.json().catch(() => ({}));
      toast(res.ok ? `Poll created. Invited ${plural(invitees.length, "person", "people")}${data.failed ? ` (${data.failed} email${data.failed === 1 ? "" : "s"} failed)` : ""}.` : "Poll created, but the invites didn't send. Use Resend invites.", res.ok ? "success" : "info");
      dates.clear(); names.clear(); form.reset(); form.title.value = "Catch-up meeting"; syncUrgent(); paintCal();
      mountPeoplePicker(box.querySelector(".mt-picker"), people, names);
      msg.textContent = "";
    } catch (err) {
      console.warn("[meet] create", err);
      msg.textContent = "Couldn't create the poll. Try again.";
    } finally { btn.disabled = false; }
  });

  // Existing polls.
  const list = root.querySelector(".mt-toollist");
  const off = onSnapshot(query(collection(db, "meet_polls"), orderBy("createdAt", "desc")), async (s) => {
    const polls = s.docs.map((d) => ({ id: d.id, ...d.data() }));
    await Promise.all(polls.map(async (p) => { try { p.responses = (await getDocs(collection(db, "meet_polls", p.id, "responses"))).size; } catch { p.responses = 0; } }));
    list.innerHTML = polls.length ? `<h3 class="mt-h2">Your polls</h3><ul class="mt-rows">${polls.map((p) => `<li class="mt-row">
      <div><b>${esc(p.title)}</b>${p.urgent ? ` <span class="mt-chip is-urgent">Urgent</span>` : ""}<small>${esc((p.dates || []).map((d) => day(d)).join(" · "))} · ${p.responses} of ${(p.invitees || []).length} answered${p.answerBy ? ` · answer by ${esc(byText(p.answerBy))}` : ""}${p.status === "closed" ? " · closed" : ""}</small></div>
      <div class="mt-row-actions"><a class="btn btn-secondary btn-sm" href="#/meeting?poll=${esc(p.id)}">Open</a>
      <button type="button" class="btn btn-ghost btn-sm" data-resend="${esc(p.id)}">Resend invites</button>
      <button type="button" class="btn btn-ghost btn-sm" data-toggle="${esc(p.id)}" data-status="${esc(p.status || "open")}">${p.status === "closed" ? "Reopen" : "Close"}</button>
      <button type="button" class="btn btn-ghost btn-sm" data-del="${esc(p.id)}">Delete</button></div>
    </li>`).join("")}</ul>` : "";
  });
  list.addEventListener("click", async (e) => {
    const b = e.target.closest("button"); if (!b) return;
    const d = b.dataset;
    try {
      if (d.toggle) await updateDoc(doc(db, "meet_polls", d.toggle), { status: d.status === "closed" ? "open" : "closed" });
      if (d.resend) {
        await updateDoc(doc(db, "meet_polls", d.resend), { emailedNames: [] });
        const res = await ctx.authedFetch("/api/meet/notify", { method: "POST", body: JSON.stringify({ pollId: d.resend }) });
        toast(res.ok ? "Invites sent again." : "Couldn't send the invites.", res.ok ? "success" : "error");
      }
      if (d.del) {
        if (!(await confirmDialog("Delete this poll and everyone's answers?", { confirmText: "Delete", danger: true }))) return;
        const r = await getDocs(collection(db, "meet_polls", d.del, "responses"));
        await Promise.all(r.docs.map((x) => deleteDoc(x.ref)));
        await deleteDoc(doc(db, "meet_polls", d.del));
        toast("Poll deleted.", "success");
      }
    } catch (err) { console.warn(err); toast("Couldn't do that. Try again.", "error"); }
  });
  return off;
}

function injectStyle() {
  if (document.getElementById("mt-style")) return;
  const s = document.createElement("style");
  s.id = "mt-style";
  s.textContent = PICKER_CSS + `
.mt { max-width: 1120px; margin: 0 auto; padding: 0 0 64px; color: var(--ink); }
.mt-head { padding: 4px 0 18px; }
.mt-head h1, .mt-head h3 { margin: 0; font: 600 clamp(26px, 3.4vw, 34px)/1.15 var(--font); letter-spacing: -0.03em; }
.mt.is-embedded { max-width: none; padding: 0; }
.mt.is-embedded .mt-head { padding: 0 0 14px; }
.mt.is-embedded .mt-head h3 { font-size: 19px; letter-spacing: -0.015em; }
.mt-head p { margin: 8px 0 0; font-size: 14.5px; line-height: 1.6; color: var(--ink-2); max-width: 70ch; }
.mt-head-row { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.mt-note { white-space: pre-wrap; }
.mt-sub { color: var(--muted) !important; font-size: 13.5px !important; }
.mt-admin { margin-top: 10px; }
.mt-back { display: inline-flex; min-height: 36px; align-items: center; font-size: 13.5px; color: var(--muted); text-decoration: none; }
.mt-back:hover { color: var(--ink); }
.mt-h2 { margin: 28px 0 12px; font: 600 17px/1.3 var(--font); letter-spacing: -0.015em; }
.mt-h2 span { font-weight: 500; font-size: 13px; color: var(--muted); margin-left: 6px; }
.mt-empty { padding: 60px 20px; text-align: center; color: var(--muted); }
.mt-empty h2 { color: var(--ink); font: 600 20px var(--font); margin: 0 0 8px; }
.mt-chip { display: inline-flex; align-items: center; gap: 4px; padding: 3px 10px; border-radius: 99px; background: var(--surface-3); font: 600 11.5px/1.5 var(--font); color: var(--ink-2); white-space: nowrap; }
.mt-chip.is-good { background: #e3f1e7; color: #2f7d4f; }
.mt-chip.is-todo { background: #fbe4da; color: #9a3412; }
.mt-chip button { border: 0; background: none; padding: 0 0 0 2px; font-size: 14px; line-height: 1; color: inherit; cursor: pointer; }
.mt-hint { margin: 0 0 10px; font-size: 13px; line-height: 1.55; color: var(--muted); }
.mt-link { margin-top: 10px; padding: 0; border: 0; background: none; font: 500 13px var(--font); color: var(--muted); text-decoration: underline; text-underline-offset: 3px; cursor: pointer; min-height: 36px; }
.mt-pollcards { display: grid; gap: 10px; }
.mt-pollcard { display: flex; align-items: center; justify-content: space-between; gap: 14px; width: 100%; min-height: 64px; padding: 14px 18px; border: 1px solid var(--hairline); border-radius: 14px; background: var(--surface); text-align: left; font: inherit; color: var(--ink); cursor: pointer; transition: border-color .15s, transform .15s; }
.mt-pollcard:hover { border-color: color-mix(in srgb, var(--ink) 25%, transparent); transform: translateY(-1px); }
.mt-pollcard-main, .mt-pollcard-side { display: flex; flex-direction: column; gap: 3px; }
.mt-pollcard-side { align-items: flex-end; }
.mt-pollcard b { font-size: 15px; } .mt-pollcard small { font-size: 12.5px; color: var(--muted); }
.mt-tabs { display: none; gap: 4px; padding: 4px; margin: 0 0 12px; border-radius: 12px; background: var(--surface-3); }
.mt-tabs button { flex: 1; min-height: 40px; border: 0; border-radius: 9px; background: none; font: 500 14px var(--font); color: var(--ink-2); cursor: pointer; }
.mt-tabs button[aria-selected="true"] { background: var(--surface); color: var(--ink); font-weight: 600; box-shadow: var(--shadow-sm); }
.mt-panels { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; align-items: stretch; }
.mt-panel { --mt-empty: #f1eee8; min-width: 0; display: flex; flex-direction: column; padding: 22px 22px 18px; border-radius: 22px; background: #fffdf9; border: 1px solid rgba(15, 23, 42, 0.06); box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04), 0 8px 24px rgba(15, 23, 42, 0.05); }
.mt-panel-h { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; min-height: 52px; margin-bottom: 14px; }
.mt-panel-h h2 { margin: 0; font: 600 17px/1.25 var(--font); letter-spacing: -0.02em; color: var(--ink); }
.mt-panel-sub { margin: 4px 0 0; font-size: 13px; line-height: 1.4; color: var(--muted); }
.mt-panel-tools { display: flex; align-items: center; gap: 10px; flex: none; padding-top: 1px; }
.mt-save { font-size: 12px; font-weight: 500; color: #2e8b57; }
.mt-textbtn { min-height: 32px; padding: 0 12px; border: 0; border-radius: 99px; background: rgba(15, 23, 42, 0.05); font: 500 12.5px var(--font); color: var(--ink-2); cursor: pointer; transition: background .15s; }
.mt-textbtn:hover { background: rgba(15, 23, 42, 0.09); }
.mt-textbtn:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
.mt-legend { gap: 3px; font-size: 11px; color: var(--muted); }
.mt-legend i { width: 12px; height: 12px; border-radius: 4px; }
.mt-legend span { margin: 0 3px; }
.mt-grid { display: grid; grid-template-columns: 44px repeat(var(--cols), minmax(40px, 1fr)); column-gap: 5px; row-gap: 2px; overflow-x: auto; padding: 0 0 10px; user-select: none; -webkit-user-select: none; }
.mt-grid.is-edit { touch-action: none; cursor: pointer; }
.mt-corner { position: sticky; left: 0; background: #fffdf9; }
.mt-dh { display: flex; flex-direction: column; align-items: center; gap: 1px; padding: 0 0 10px; line-height: 1.2; }
.mt-dh span { font: 600 10.5px var(--font); letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
.mt-dh b { font: 600 13.5px var(--font); color: var(--ink); letter-spacing: -0.01em; }
.mt-th { position: sticky; left: 0; z-index: 1; align-self: start; padding-right: 6px; background: #fffdf9; font-size: 10.5px; line-height: 1; color: var(--muted); text-align: right; transform: translateY(-50%); white-space: nowrap; }
.mt-cell { height: 17px; border-radius: 4px; background: var(--mt-empty); transition: background-color .12s ease; }
.mt-cell.is-hour { margin-top: 0; }
.mt-grid[data-grid="mine"] .mt-cell.is-on { background: #2e8b57; }
.mt-grid.is-edit .mt-cell:hover { box-shadow: inset 0 0 0 1.5px rgba(46, 139, 87, .7); }
.mt-cell:focus-visible { outline: 2px solid var(--ink); outline-offset: 1px; }
.mt-th-end { height: 0; }
.mt-end { height: 0; }
.mt-heat { cursor: default; }
.mt-heat:hover { box-shadow: inset 0 0 0 1.5px rgba(15, 23, 42, .55); }
.mt-tip { position: fixed; z-index: 60; width: 220px; max-height: 320px; overflow: auto; padding: 12px 14px; border-radius: 14px; background: #fffdf9; border: 1px solid rgba(15, 23, 42, 0.08); box-shadow: 0 12px 32px rgba(15, 23, 42, 0.14); pointer-events: none; }
.mt-tip-h { display: flex; justify-content: space-between; gap: 8px; font-size: 12px; color: var(--muted); }
.mt-tip-h b { color: var(--ink); font-weight: 600; }
.mt-tip-n { margin: 6px 0 8px; font-size: 13px; color: var(--ink-2); }
.mt-tip-n strong { font-size: 18px; color: var(--ink); letter-spacing: -0.02em; }
.mt-tip-list { margin: 0; padding: 0; list-style: none; display: grid; gap: 3px; font-size: 12.5px; color: var(--muted); }
.mt-tip-list li::before { content: ""; display: inline-block; width: 7px; height: 7px; margin-right: 7px; border-radius: 50%; background: #d6d1c7; vertical-align: 1px; }
.mt-tip-list.is-free { color: var(--ink); margin-bottom: 8px; }
.mt-tip-list.is-free li::before { background: #2e8b57; }
.mt-wins { margin: 0; padding: 0; list-style: none; display: grid; gap: 8px; }
.mt-win { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 1.4fr) auto; align-items: center; gap: 10px 16px; padding: 12px 16px; border: 1px solid var(--hairline); border-radius: 14px; background: var(--surface); }
.mt-win-when { display: flex; flex-direction: column; gap: 2px; } .mt-win-when b { font-size: 14.5px; } .mt-win-when span { font-size: 13px; color: var(--ink-2); }
.mt-win-who { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; } .mt-win-who small { font-size: 12.5px; color: var(--muted); }
.mt-people { display: flex; flex-wrap: wrap; gap: 6px; margin: 0; }
.mt-person { padding: 6px 11px; border-radius: 99px; background: var(--surface-3); font-size: 13px; color: var(--muted); }
.mt-person.is-done { background: #e3f1e7; color: #2f7d4f; font-weight: 600; }
.mt-chip.is-urgent { background: #fdecea; color: #b42318; }
.mt-pollcard.is-urgent { border: 1px solid #f3b8b0; border-left: 5px solid #c4321f; background: #fff5f3; }
.mt-pollcard em { font-style: normal; font: 700 12.5px/1.4 var(--font); color: #b42318; }
.mt-urgent { display: flex; flex-direction: column; gap: 3px; margin: 0 0 18px; padding: 14px 18px; border-radius: 14px; background: #fdecea; border: 1px solid #f3b8b0; border-left: 5px solid #c4321f; color: #6e1a10; font-size: 14px; line-height: 1.5; }
.mt-urgent b { font-size: 16px; color: #8f1d10; }
.mt-done { margin: 0 0 18px; padding: 12px 16px; border-radius: 14px; background: #e3f1e7; color: #245f3c; font: 600 14px/1.5 var(--font); }
.mt-admin { display: flex; flex-wrap: wrap; gap: 8px; }
.mt-filters { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 0 0 14px; }
.mt-filters-label { font: 600 12px var(--font); color: var(--muted); margin-right: 4px; text-transform: uppercase; letter-spacing: .08em; }
.mt-fchip { display: inline-flex; align-items: center; gap: 6px; min-height: 36px; padding: 0 13px; border: 1px solid var(--hairline); border-radius: 99px; background: var(--surface); font: 500 13px var(--font); color: var(--ink-2); cursor: pointer; }
.mt-fchip span { font-size: 11.5px; color: var(--muted); }
.mt-fchip:hover { border-color: color-mix(in srgb, var(--ink) 28%, transparent); }
.mt-fchip.is-on { background: #2f7d4f; border-color: #2f7d4f; color: #f4fbf6; font-weight: 600; }
.mt-fchip.is-on span { color: #d4ecdc; }
.mt-fchip:focus-visible, .mt-person:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
button.mt-person { border: 0; font: inherit; font-size: 13px; cursor: pointer; min-height: 32px; }
.mt-person.is-hidden { opacity: .45; text-decoration: line-through; }
.mt-daytabs { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
.mt-tl-wrap { overflow-x: auto; padding: 14px 16px 10px; border: 1px solid var(--hairline); border-radius: 16px; background: var(--surface); }
.mt-tl { display: grid; grid-template-columns: minmax(120px, 170px) repeat(var(--n), minmax(16px, 1fr)); row-gap: 4px; min-width: 620px; }
.mt-tl-h { font-size: 10.5px; color: var(--muted); white-space: nowrap; overflow: visible; height: 16px; }
.mt-tl-name { padding-right: 10px; font-size: 13px; font-weight: 600; color: var(--ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; align-self: center; }
.mt-tl-name.is-none { color: var(--muted); font-weight: 500; }
.mt-tl-name small { font-size: 11px; font-weight: 500; }
.mt-tl-c { height: 22px; background: var(--surface-2); border-left: 1px dotted var(--hairline-2); }
.mt-tl-c.is-hour { border-left: 1px solid var(--hairline); }
.mt-tl-c.is-on { background: #3f8f5c; border-left-color: rgba(255,255,255,.25); }
.mt-tl-total { color: var(--muted); font-weight: 600; font-size: 12px; padding-top: 4px; }
.mt-tl-n { font-size: 11px; color: var(--muted); text-align: center; padding-top: 4px; }
.mt-tl-n.is-all { color: #2f7d4f; font-weight: 700; }
.mt-urgentset { margin: 0; padding: 12px 14px; border: 1px solid #f3b8b0; border-radius: 14px; background: #fff5f3; display: flex; flex-direction: column; gap: 10px; }
.mt-urgentfields { display: flex; flex-direction: column; gap: 10px; }
.mt-urgentfields[hidden] { display: none; }
.mt-check { display: flex; align-items: center; gap: 8px; min-height: 36px; font-size: 14px; cursor: pointer; }
.mt-check b { color: #b42318; }
.mt-f2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
/* Advanced tools */
.mt-form { display: flex; flex-direction: column; gap: 16px; max-width: 720px; }
.mt-f { display: flex; flex-direction: column; gap: 6px; } .mt-f > span { font: 600 12.5px var(--font); color: var(--ink); }
.mt-cal { max-width: 320px; padding: 12px; border: 1px solid var(--hairline); border-radius: 14px; background: var(--surface); }
.mt-cal-h { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; font-size: 14px; }
.mt-calnav { width: 36px; height: 36px; border: 0; border-radius: 50%; background: none; font-size: 20px; cursor: pointer; color: var(--ink); }
.mt-calnav:hover { background: var(--surface-3); }
.mt-cal-g { display: grid; grid-template-columns: repeat(7, 1fr); gap: 3px; text-align: center; }
.mt-cal-g i { font-style: normal; font-size: 11px; color: var(--muted); padding: 2px 0; }
.mt-day { height: 38px; border: 0; border-radius: 10px; background: none; font: 500 13.5px var(--font); color: var(--ink); cursor: pointer; }
.mt-day:hover:not(:disabled) { background: var(--surface-3); }
.mt-day.is-today { box-shadow: inset 0 0 0 1px var(--hairline); }
.mt-day.is-on { background: #2f7d4f; color: #f7fbf8; font-weight: 600; }
.mt-day:disabled { color: var(--muted-2, #b9b3a8); cursor: default; }
.mt-daychips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.mt-form-foot { display: flex; align-items: center; justify-content: flex-end; gap: 12px; }
.mt-form-msg { font-size: 13px; color: var(--muted); margin-right: auto; }
.mt-rows { margin: 0; padding: 0; list-style: none; }
.mt-row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 16px; padding: 12px 0; border-top: 1px solid var(--hairline-2); }
.mt-row b { display: block; font-size: 14.5px; } .mt-row small { font-size: 12.5px; color: var(--muted); }
.mt-row-actions { display: flex; flex-wrap: wrap; gap: 4px; }
.mt-pollcard:focus-visible, .mt-day:focus-visible, .mt-calnav:focus-visible, .mt-tabs button:focus-visible, .mt-link:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
@media (max-width: 860px) {
  .mt-tabs { display: flex; }
  .mt-panels { grid-template-columns: minmax(0, 1fr); }
  .mt-panels[data-tab-now="mine"] .mt-panel-group, .mt-panels[data-tab-now="group"] .mt-panel-mine { display: none; }
  .mt-win { grid-template-columns: minmax(0, 1fr); }
}
@media (prefers-reduced-motion: reduce) { .mt-pollcard:hover { transform: none; } }
`;
  document.head.appendChild(s);
}
