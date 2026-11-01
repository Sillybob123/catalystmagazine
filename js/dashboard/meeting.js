// Meeting (#/meeting): the next team meeting, for everyone on staff.
//
//   • Everyone sees the next published meeting: when (Eastern Time), a
//     countdown, the join link, Add to Google Calendar, the agenda and why it
//     matters to be there; then past meetings.
//   • Admins set it: title, date, start and end, link, agenda, note, and who
//     it's for (the whole team or people picked). "Publish and email" marks it
//     published and /api/meetings/publish emails everyone it's for (with a bell
//     notification); publishing again after a change sends an "updated" email.
//     The cron sends a reminder about a day before
//     (functions/_utils/meeting-reminders.js).
//   • When to meet polls live here too, only for the people invited (and
//     admins): each poll is embedded (meet.js mountPoll). One that still needs
//     your times comes first, in red, and is open; once you've answered it
//     folds to a green line. #/meeting?poll=<id> opens and scrolls to it.
//     The sidebar moves Meeting to the top and flashes it red while you owe
//     an answer (app.js).
//   • An admin turning a poll's time into a meeting comes back here with
//     #/meeting?poll=…&date=…&start=…&end=…, which opens the form filled in.
//
// Data: meetings/{id} { title, date "YYYY-MM-DD", start "HH:MM", end, startsAt,
// endsAt (UTC ISO), link, agenda, note, audience: all|people, invitedUids,
// invitees: [{ name, uids }], status: draft|published|cancelled, pollId,
// autoReminder (default on: the email about a day before), reminders:
// [{ id, at, message, by, byName, sentAt }] (scheduled by an admin, sent by
// the cron), lastReminderAt,
// createdAt, createdBy, publishedAt, emailedAt, remindedFor }.
// Rules: staff read, admins write.

import { db } from "../firebase-config.js";
import {
  collection, doc, onSnapshot, addDoc, updateDoc, deleteDoc, getDoc, query, where,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { el, esc, toast, openModal, confirmDialog } from "./ui.js";
import { loadPeople, mountPeoplePicker, peopleUids, PICKER_CSS } from "./people-picker.js?v=1";
import { mountPoll } from "./meet.js?v=3";

const WHY = [
  "We're a team, and we count on each other. Editors need you there to give feedback and plan the section. Admins need you there to keep the edition on track. And the other writers need you there too, to talk through their pieces and help when someone's stuck, the same way they'll help you.",
  "So please come on time, come ready to share where your piece is, and come ready to pitch in on someone else's.",
];

// Eastern wall time → UTC ISO (handles daylight saving).
export function etToUtcIso(date, hhmm) {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = hhmm.split(":").map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    .formatToParts(new Date(guess)).map((p) => [p.type, p.value]));
  const asEt = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute);
  return new Date(guess + (guess - asEt)).toISOString();
}
const clock = (hhmm) => { const [h, m] = String(hhmm || "").split(":").map(Number); return Number.isNaN(h) ? "" : `${((h + 11) % 12) + 1}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "AM" : "PM"}`; };
const range = (a, b) => { const x = clock(a), y = clock(b); return x.slice(-2) === y.slice(-2) ? `${x.slice(0, -3)}–${y}` : `${x}–${y}`; };
const longDay = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
const shortDay = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
const localTime = (iso) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
const isEastern = () => { try { return ["America/New_York", "America/Detroit", "America/Toronto", "America/Indiana/Indianapolis", "America/Kentucky/Louisville"].includes(Intl.DateTimeFormat().resolvedOptions().timeZone); } catch { return true; } };
function gcal(m) {
  const f = (iso) => String(iso || "").replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const q = new URLSearchParams({ action: "TEMPLATE", text: m.title || "Catalyst team meeting", dates: `${f(m.startsAt)}/${f(m.endsAt)}`, details: [m.agenda || "", m.link ? `Join: ${m.link}` : ""].filter(Boolean).join("\n\n"), location: m.link || "" });
  return `https://calendar.google.com/calendar/render?${q}`;
}
function countdown(m, now = Date.now()) {
  const s = Date.parse(m.startsAt), e = Date.parse(m.endsAt);
  if (now >= s && now < e) return { text: "Happening now", live: true };
  const mins = Math.round((s - now) / 60000);
  if (mins < 60) return { text: `Starts in ${mins} minute${mins === 1 ? "" : "s"}`, soon: true };
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return { text: `Starts in ${hrs} hour${hrs === 1 ? "" : "s"}`, soon: true };
  const days = Math.round(hrs / 24);
  return { text: days === 1 ? "Tomorrow" : `In ${days} days` };
}
// "Sat, Nov 7, 6 PM ET" for a UTC ISO time.
const whenShort = (iso) => `${new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).replace(":00", "")} ET`;
const ICON_CAL = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></svg>`;
const ICON_BELL = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="margin-right:6px;vertical-align:-2px"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>`;
const safeLink = (u) => /^https?:\/\//i.test(String(u || "").trim()) ? String(u).trim() : "";

export async function mount(ctx, container) {
  injectStyle();
  const isAdmin = ctx.role === "admin";
  const meUid = ctx.user?.uid || "";
  const params = new URLSearchParams(location.hash.split("?")[1] || "");
  const askedPoll = params.get("date") ? "" : (params.get("poll") || "");
  const root = el("div", { class: "mg" });
  container.innerHTML = "";
  container.appendChild(root);
  root.innerHTML = `
    <header class="mg-head">
      <div><h1>Meeting</h1><p>When we're meeting next, what we'll cover, and how to join.</p></div>
      ${isAdmin ? `<button type="button" class="btn btn-primary" data-new>Set the next meeting</button>` : ""}
    </header>
    <div class="mg-polls"></div>
    <div class="mg-main"><div class="loading-state"><div class="spinner"></div>Loading&hellip;</div></div>`;
  const pollsEl = root.querySelector(".mg-polls");
  const mainEl = root.querySelector(".mg-main");
  let meetings = [], tick = null;
  const unsub = onSnapshot(collection(db, "meetings"), (s) => {
    meetings = s.docs.map((d) => ({ id: d.id, ...d.data() }));
    render();
  }, () => { mainEl.innerHTML = `<div class="mg-empty"><p>Couldn't load meetings.</p></div>`; });

  // ── When to meet polls: the ones I'm invited to (admins: all open ones). ──
  // Kept outside mainEl, which re-renders every minute, so a poll you're
  // dragging on is never rebuilt.
  let polls = [];
  const answered = new Map();      // pollId -> { done, off }
  const entries = new Map();       // pollId -> { sec, head, body, open, cleanup }
  let scrolled = false;
  const pollQuery = isAdmin ? collection(db, "meet_polls") : query(collection(db, "meet_polls"), where("invitedUids", "array-contains", meUid));
  const unsubPolls = meUid ? onSnapshot(pollQuery, (s) => {
    polls = s.docs.map((d) => ({ id: d.id, ...d.data() })).filter((p) => p.status !== "closed" || p.id === askedPoll);
    for (const [pid, rec] of answered) if (!polls.some((p) => p.id === pid)) { rec.off(); answered.delete(pid); }
    polls.filter(invited).forEach((p) => {
      if (answered.has(p.id)) return;
      const rec = { done: false, checked: false, off: () => {} };
      answered.set(p.id, rec);
      rec.off = onSnapshot(doc(db, "meet_polls", p.id, "responses", meUid), (r) => { rec.done = r.exists() && (r.data().slots || []).length > 0; rec.checked = true; paintPolls(); }, () => { rec.checked = true; paintPolls(); });
    });
    paintPolls();
  }, () => {}) : () => {};
  function invited(p) { return (p.invitedUids || []).includes(meUid); }
  function needs(p) { return invited(p) && p.status !== "closed" && !answered.get(p.id)?.done; }
  const byLong = (iso) => iso ? `${new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).replace(":00", "")} ET` : "";
  const daysText = (p) => (p.dates || []).slice().sort().map((d) => new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })).join(" · ");

  function pollHead(p, open) {
    const by = byLong(p.answerBy);
    const late = p.answerBy && Date.parse(p.answerBy) < Date.now();
    if (needs(p)) {
      return `<span class="mg-urgent-tag">${p.urgent ? "First, before the next meeting" : "Needed from you"}</span>
        <h2>${esc(p.urgent ? (p.reason || "You missed our last meeting, so we need your availability.") : `When can you meet? ${p.title || ""}`.trim())}</h2>
        <p>${late ? `This was due ${esc(by)}. Please add your times now.` : by ? `Please mark when you're free by <b>${esc(by)}</b>.` : "Please mark when you're free as soon as you can."} Drag over the times below. It takes a minute.</p>`;
    }
    const toggle = `<button type="button" class="btn btn-ghost btn-sm" data-poll-toggle="${esc(p.id)}" aria-expanded="${open}">${open ? "Hide" : invited(p) ? "Change your times or see everyone's" : "See the answers"}</button>`;
    if (invited(p)) {
      return `<div class="mg-pollrow"><span class="mg-pollrow-ico" aria-hidden="true">&#10003;</span><div><b>Your times are in</b><small>${esc(p.title || "When to meet")} · ${esc(daysText(p))}${p.status === "closed" ? " · closed" : ""}</small></div>${toggle}</div>`;
    }
    return `<div class="mg-pollrow"><span class="mg-pollrow-ico is-admin" aria-hidden="true">${ICON_CAL}</span><div><b>When to meet: ${esc(p.title || "")}</b><small>${esc(daysText(p))}${p.answerBy ? ` · answer by ${esc(byLong(p.answerBy))}` : ""}${p.status === "closed" ? " · closed" : ""} · you're not invited, admins can see it</small></div>${toggle}</div>`;
  }

  function paintPolls() {
    const rank = (p) => (needs(p) ? (p.urgent ? 0 : 1) : invited(p) ? 2 : 3);
    // Wait until we know whether I've answered, so it opens (or not) correctly.
    const list = polls.filter((p) => !invited(p) || answered.get(p.id)?.checked).sort((a, b) => rank(a) - rank(b) || String(a.answerBy || "9").localeCompare(String(b.answerBy || "9")));
    for (const [pid, e] of entries) if (!list.some((p) => p.id === pid)) { e.cleanup?.(); e.sec.remove(); entries.delete(pid); }
    list.forEach((p) => {
      let e = entries.get(p.id);
      if (!e) {
        e = { sec: el("section", { class: "mg-poll", "data-poll": p.id }), head: el("div", { class: "mg-poll-head" }), body: el("div", { class: "mg-poll-body" }), open: needs(p) || p.id === askedPoll, cleanup: null };
        e.sec.append(e.head, e.body);
        entries.set(p.id, e);
      }
      if (needs(p)) e.open = true;
      e.sec.className = `mg-poll ${needs(p) ? "is-needs" : invited(p) ? "is-done" : "is-admin"}`;
      e.sec.setAttribute("role", needs(p) ? "alert" : "region");
      e.head.innerHTML = pollHead(p, e.open);
      if (e.open && !e.cleanup) e.cleanup = mountPoll(ctx, e.body, p.id);
      if (!e.open && e.cleanup) { e.cleanup(); e.cleanup = null; e.body.innerHTML = ""; }
      e.body.hidden = !e.open;
      pollsEl.appendChild(e.sec);   // keeps order; moving a node keeps what's inside it
    });
    if (askedPoll && !scrolled && entries.get(askedPoll)) {
      scrolled = true;
      requestAnimationFrame(() => entries.get(askedPoll)?.sec.scrollIntoView({ behavior: "smooth", block: "start" }));
      history.replaceState(null, "", "#/meeting");
    }
  }

  root.addEventListener("click", (e) => {
    if (e.target.closest("[data-new]")) editMeeting(null);
    const b = e.target.closest("[data-edit]");
    if (b) editMeeting(meetings.find((m) => m.id === b.dataset.edit));
    const r = e.target.closest("[data-remind]");
    if (r) remindDialog(meetings.find((m) => m.id === r.dataset.remind));
    const t = e.target.closest("[data-poll-toggle]");
    if (t) { const en = entries.get(t.dataset.pollToggle); if (en) { en.open = !en.open; paintPolls(); } }
  });

  tick = setInterval(() => { if (document.contains(root)) render(); }, 60000);

  // Coming from When to meet with a time picked.
  if (isAdmin && params.get("date")) {
    let preset = { date: params.get("date"), start: params.get("start") || "18:00", end: params.get("end") || "19:00", pollId: params.get("poll") || "" };
    if (preset.pollId) {
      try { const p = await getDoc(doc(db, "meet_polls", preset.pollId)); if (p.exists()) { preset.title = p.data().title || ""; preset.invitees = p.data().invitees || []; } } catch {}
    }
    history.replaceState(null, "", "#/meeting");
    editMeeting(null, preset);
  }
  return () => { unsub(); unsubPolls(); answered.forEach((r) => r.off()); entries.forEach((e) => e.cleanup?.()); clearInterval(tick); };

  function render() {
    const now = Date.now();
    const visible = meetings.filter((m) => isAdmin || m.status === "published" || m.status === "cancelled");
    const upcoming = visible.filter((m) => m.endsAt && Date.parse(m.endsAt) > now && m.status !== "draft").sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    const next = upcoming.find((m) => m.status === "published");
    const later = upcoming.filter((m) => m !== next);
    const drafts = isAdmin ? meetings.filter((m) => m.status === "draft").sort((a, b) => String(a.startsAt || "").localeCompare(String(b.startsAt || ""))) : [];
    const past = visible.filter((m) => m.status === "published" && m.endsAt && Date.parse(m.endsAt) <= now).sort((a, b) => b.startsAt.localeCompare(a.startsAt)).slice(0, 8);

    mainEl.innerHTML = `
      ${next ? nextCard(next, now) : `<section class="mg-none"><h2>No meeting on the calendar yet.</h2><p>${isAdmin ? "Set the next one. You can publish it quietly or email everyone, and send a reminder whenever you like." : "When the next one is set, it shows up here, usually with an email and a reminder before."}</p></section>`}
      ${drafts.length ? `<h2 class="mg-h2">Drafts <span>only admins see these</span></h2><ul class="mg-rows">${drafts.map((m) => row(m, "draft")).join("")}</ul>` : ""}
      ${later.length ? `<h2 class="mg-h2">Also coming up</h2><ul class="mg-rows">${later.map((m) => row(m)).join("")}</ul>` : ""}
      <section class="mg-why">
        <h2 class="mg-h2">Why showing up matters</h2>
        <div class="mg-why-card">${WHY.map((t) => `<p>${esc(t)}</p>`).join("")}<p class="mg-why-foot">If you really can't make it, tell your section editor ahead of time so they can catch you up.</p></div>
      </section>
      ${past.length ? `<h2 class="mg-h2">Past meetings</h2><ul class="mg-rows">${past.map((m) => row(m, "past")).join("")}</ul>` : ""}`;
  }

  function nextCard(m, now) {
    const c = countdown(m, now);
    const link = safeLink(m.link);
    const agenda = String(m.agenda || "").split(/\n+/).map((s) => s.replace(/^[-•*]\s*/, "").trim()).filter(Boolean);
    const who = m.audience === "people" ? (m.invitees || []).map((p) => p.name) : null;
    return `<section class="mg-next${c.live ? " is-live" : ""}">
      <div class="mg-next-main">
        <span class="mg-badge${c.live ? " is-live" : c.soon ? " is-soon" : ""}">${esc(c.text)}</span>
        <h2>${esc(m.title || "Team meeting")}</h2>
        <p class="mg-when"><b>${esc(longDay(m.date))}</b><span>${esc(range(m.start, m.end))} Eastern</span></p>
        ${isEastern() ? "" : `<p class="mg-local">That's ${esc(localTime(m.startsAt))}–${esc(localTime(m.endsAt))} where you are.</p>`}
        <div class="mg-actions">
          ${link ? `<a class="btn btn-primary" href="${esc(link)}" target="_blank" rel="noopener">Join the meeting</a>` : ""}
          <a class="btn btn-secondary" href="${esc(gcal(m))}" target="_blank" rel="noopener">Add to Google Calendar</a>
          ${isAdmin ? `<button type="button" class="btn btn-ghost" data-edit="${esc(m.id)}">Edit</button>` : ""}
        </div>
        ${link ? `<p class="mg-linktext">${esc(link)}</p>` : ""}
        ${isAdmin ? reminderStrip(m) : ""}
      </div>
      <div class="mg-next-side">
        ${agenda.length ? `<h3>On the agenda</h3><ol class="mg-agenda">${agenda.map((a) => `<li>${esc(a)}</li>`).join("")}</ol>` : `<h3>On the agenda</h3><p class="mg-muted">The agenda will be posted here.</p>`}
        ${m.note ? `<p class="mg-note">${esc(m.note)}</p>` : ""}
        <p class="mg-for">${who ? `For: ${esc(who.join(", "))}` : "For the whole team"}</p>
      </div>
    </section>`;
  }

  // Admins: what's been sent and what's coming, plus Remind everyone.
  function reminderStrip(m) {
    const pending = (m.reminders || []).filter((r) => !r.sentAt).sort((a, b) => a.at.localeCompare(b.at));
    const bits = [];
    if (!m.emailedAt && !m.lastReminderAt) bits.push("Published quietly: no one has been emailed yet");
    if (m.lastReminderAt) bits.push(`Last reminder ${whenShort(m.lastReminderAt)}`);
    if (pending.length) bits.push(`Scheduled: ${pending.map((r) => whenShort(r.at)).join(", ")}`);
    bits.push(m.autoReminder === false ? "Automatic day-before reminder off" : m.remindedFor === m.startsAt ? "Day-before reminder done" : "Automatic reminder a day before");
    return `<div class="mg-remind"><button type="button" class="btn btn-secondary btn-sm" data-remind="${esc(m.id)}">${ICON_BELL}Remind everyone</button><p>${bits.map(esc).join(" · ")}</p></div>`;
  }

  function row(m, kind = "") {
    const status = m.status === "cancelled" ? `<span class="mg-chip is-off">Cancelled</span>` : kind === "draft" ? `<span class="mg-chip">Draft</span>` : "";
    return `<li class="mg-row${m.status === "cancelled" ? " is-cancelled" : ""}">
      <div><b>${esc(m.title || "Team meeting")}</b> ${status}<small>${m.date ? `${esc(shortDay(m.date))} · ${esc(range(m.start, m.end))} ET` : "No date yet"}</small></div>
      ${isAdmin && kind !== "past" ? `<button type="button" class="btn btn-ghost btn-sm" data-edit="${esc(m.id)}">${kind === "draft" ? "Edit or publish" : "Edit"}</button>` : ""}
    </li>`;
  }

  async function editMeeting(cur, preset = {}) {
    const isNew = !cur;
    const m = cur || { title: preset.title || "Catalyst team meeting", date: preset.date || "", start: preset.start || "18:00", end: preset.end || "19:00", link: "", agenda: "", note: "", audience: preset.invitees?.length ? "people" : "all", invitees: preset.invitees || [], pollId: preset.pollId || "" };
    const body = el("div", { class: "mg-form" });
    body.innerHTML = `
      <label class="mg-f"><span>Title</span><input class="input" name="title" maxlength="120" value="${esc(m.title || "")}"></label>
      <div class="mg-f3">
        <label class="mg-f"><span>Date</span><input class="input" type="date" name="date" value="${esc(m.date || "")}"></label>
        <label class="mg-f"><span>Starts (ET)</span><input class="input" type="time" name="start" step="900" value="${esc(m.start || "")}"></label>
        <label class="mg-f"><span>Ends (ET)</span><input class="input" type="time" name="end" step="900" value="${esc(m.end || "")}"></label>
      </div>
      <label class="mg-f"><span>Meeting link (Zoom, Meet…)</span><input class="input" name="link" type="url" placeholder="https://" value="${esc(m.link || "")}"></label>
      <label class="mg-f"><span>Agenda, one item per line</span><textarea class="input" name="agenda" rows="4" maxlength="2000">${esc(m.agenda || "")}</textarea></label>
      <label class="mg-f"><span>Note (optional)</span><textarea class="input" name="note" rows="2" maxlength="1000">${esc(m.note || "")}</textarea></label>
      <div class="mg-f"><span>Who it's for</span>
        <div class="mg-aud"><label><input type="radio" name="audience" value="all" ${m.audience !== "people" ? "checked" : ""}> The whole team</label><label><input type="radio" name="audience" value="people" ${m.audience === "people" ? "checked" : ""}> Only some people</label></div>
        <div class="mg-picker" ${m.audience === "people" ? "" : "hidden"}></div>
      </div>
      <label class="mg-check"><input type="checkbox" name="autoReminder" ${m.autoReminder === false ? "" : "checked"}> Send the automatic reminder email about a day before</label>
      <p class="mg-form-msg" aria-live="polite">${m.status === "published" ? "This meeting is published. You can save quietly or email everyone the update." : "Publish it quietly (it shows on the Meeting page, no emails) or publish and email everyone it's for. You can send a reminder any time after."}</p>`;
    const names = new Set((m.invitees || []).map((p) => p.name));
    let people = [];
    const pickerBox = body.querySelector(".mg-picker");
    loadPeople().then((p) => { people = p; mountPeoplePicker(pickerBox, people, names); }).catch(() => { pickerBox.textContent = "Couldn't load the team."; });
    body.addEventListener("change", (e) => { if (e.target.name === "audience") pickerBox.hidden = e.target.value !== "people"; });
    const msg = body.querySelector(".mg-form-msg");

    const read = () => {
      const f = (n) => body.querySelector(`[name="${n}"]`);
      const audience = body.querySelector('[name="audience"]:checked').value;
      const v = { title: f("title").value.trim() || "Catalyst team meeting", date: f("date").value, start: f("start").value, end: f("end").value, link: f("link").value.trim(), agenda: f("agenda").value.trim(), note: f("note").value.trim(), audience };
      if (!v.date || !v.start || !v.end) return { err: "Add the date, start and end." };
      if (v.end <= v.start) return { err: "The end time needs to be after the start." };
      if (v.link && !safeLink(v.link)) return { err: "The link should start with https://" };
      if (audience === "people" && !names.size) return { err: "Pick who the meeting is for." };
      v.startsAt = etToUtcIso(v.date, v.start);
      v.endsAt = etToUtcIso(v.date, v.end);
      const chosen = people.length ? people.filter((p) => names.has(p.name)).map((p) => ({ name: p.name, uids: p.uids })) : (m.invitees || []);
      v.invitees = audience === "people" ? chosen : [];
      v.invitedUids = audience === "people" ? (people.length ? peopleUids(people, names) : [...new Set(chosen.flatMap((p) => p.uids || []))]) : [];
      v.autoReminder = f("autoReminder").checked;
      if (m.startsAt && m.startsAt !== v.startsAt) v.remindedFor = "";   // new time, new reminder
      return { v };
    };
    // mode: "draft" (not published), "quiet" (published, no emails), "email".
    const save = async (mode) => {
      const publish = mode === "email";
      const goLive = mode !== "draft";
      const { v, err } = read();
      if (err) { msg.textContent = err; msg.classList.add("is-err"); return; }
      if (goLive && Date.parse(v.endsAt) < Date.now()) { msg.textContent = "That time has already passed."; msg.classList.add("is-err"); return; }
      buttons.forEach((b) => { b.disabled = true; });
      msg.classList.remove("is-err");
      msg.textContent = publish ? "Publishing and emailing…" : goLive ? "Publishing…" : "Saving…";
      try {
        let id = cur?.id;
        if (isNew) {
          const ref = await addDoc(collection(db, "meetings"), { ...v, pollId: m.pollId || "", status: "draft", createdAt: new Date().toISOString(), createdBy: ctx.user?.uid || "", createdByName: ctx.profile?.name || "" });
          id = ref.id;
        } else {
          await updateDoc(doc(db, "meetings", id), { ...v, updatedAt: new Date().toISOString() });
        }
        if (goLive && !publish && m.status !== "published") {
          await updateDoc(doc(db, "meetings", id), { status: "published", publishedAt: m.publishedAt || new Date().toISOString() });
        }
        if (publish) {
          const res = await ctx.authedFetch("/api/meetings/publish", { method: "POST", body: JSON.stringify({ meetingId: id }) });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || "publish failed");
          toast(`${data.kind === "updated" ? "Updated" : "Published"}. Emailed ${data.emailed || 0} ${data.emailed === 1 ? "person" : "people"}${data.failed ? ` (${data.failed} failed)` : ""}.`, "success");
        } else toast(goLive && m.status !== "published" ? "Published. No one was emailed." : "Saved. No one was emailed.", "success");
        modal.close();
      } catch (e2) {
        console.warn("[meeting] save", e2);
        msg.textContent = publish ? "Saved, but the emails didn't go out. Try Publish again." : "Couldn't save. Try again.";
        msg.classList.add("is-err");
        buttons.forEach((b) => { b.disabled = false; });
      }
    };
    const buttons = [];
    const published = m.status === "published";
    if (!isNew) buttons.push(el("button", { class: "btn btn-ghost mg-del", onclick: async () => {
      if (published) {
        if (!(await confirmDialog("Cancel this meeting? It shows as cancelled on the Meeting page and no reminder goes out. No email is sent, so tell people in Team & messages.", { confirmText: "Cancel meeting", danger: true }))) return;
        await updateDoc(doc(db, "meetings", cur.id), { status: "cancelled", cancelledAt: new Date().toISOString() });
      } else {
        if (!(await confirmDialog("Delete this draft?", { confirmText: "Delete", danger: true }))) return;
        await deleteDoc(doc(db, "meetings", cur.id));
      }
      modal.close();
    } }, published ? "Cancel meeting" : "Delete"));
    if (!published) buttons.push(el("button", { class: "btn btn-ghost", onclick: () => save("draft") }, "Save draft"));
    buttons.push(el("button", { class: "btn btn-secondary", onclick: () => save("quiet") }, published ? "Save without emailing" : "Publish without emailing"));
    buttons.push(el("button", { class: "btn btn-primary", onclick: () => save("email") }, published ? "Save and email the update" : "Publish and email"));
    const modal = openModal({ title: isNew ? "Set the next meeting" : "Edit meeting", body, footer: buttons, size: "wide" });
  }

  // Remind everyone: send now, or schedule one (Eastern Time) for the cron.
  function remindDialog(m) {
    if (!m) return;
    const startDay = m.date;
    const dayBefore = (() => { const d = new Date(`${m.date}T12:00:00`); d.setDate(d.getDate() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; })();
    const reminders = [...(m.reminders || [])].sort((a, b) => a.at.localeCompare(b.at));
    const body = el("div", { class: "mg-form" });
    const paint = () => {
      body.innerHTML = `
        <p class="mg-r-lead">For <b>${esc(m.title || "Team meeting")}</b>, ${esc(shortDay(m.date))} · ${esc(range(m.start, m.end))} ET. It goes to ${m.audience === "people" ? esc((m.invitees || []).map((p) => p.name).join(", ")) : "the whole team"} by email and as a notification.</p>
        <div class="mg-aud mg-r-when">
          <label><input type="radio" name="when" value="now" checked> Send now</label>
          <label><input type="radio" name="when" value="later"> Schedule it</label>
        </div>
        <div class="mg-f3 mg-r-at" hidden>
          <label class="mg-f"><span>Day</span><input class="input" type="date" name="rday" value="${esc(dayBefore)}" max="${esc(startDay)}"></label>
          <label class="mg-f"><span>Time (ET)</span><input class="input" type="time" name="rtime" step="900" value="${esc(m.start || "18:00")}"></label>
        </div>
        <label class="mg-f"><span>Add a note (optional)</span><textarea class="input" name="rmsg" rows="2" maxlength="600" placeholder="Bring one question about your draft."></textarea></label>
        ${reminders.length ? `<div class="mg-f"><span>Reminders</span><ul class="mg-r-list">${reminders.map((r) => `<li><span>${r.sentAt ? `Sent ${esc(whenShort(r.sentAt))}` : `Scheduled for ${esc(whenShort(r.at))}`}${r.message ? ` · “${esc(r.message.length > 60 ? r.message.slice(0, 60) + "…" : r.message)}”` : ""}</span>${r.sentAt ? "" : `<button type="button" class="btn btn-ghost btn-sm" data-unschedule="${esc(r.id)}">Remove</button>`}</li>`).join("")}</ul></div>` : ""}
        <label class="mg-check"><input type="checkbox" name="auto" ${m.autoReminder === false ? "" : "checked"}> Also send the automatic reminder about a day before${m.remindedFor === m.startsAt ? " (done)" : ""}</label>
        <p class="mg-form-msg" aria-live="polite"></p>`;
    };
    paint();
    body.addEventListener("change", async (e) => {
      if (e.target.name === "when") body.querySelector(".mg-r-at").hidden = e.target.value !== "later";
      if (e.target.name === "auto") {
        try { await updateDoc(doc(db, "meetings", m.id), { autoReminder: e.target.checked }); m.autoReminder = e.target.checked; toast(e.target.checked ? "Automatic reminder on." : "Automatic reminder off.", "success"); }
        catch { toast("Couldn't change that.", "error"); }
      }
    });
    body.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-unschedule]"); if (!b) return;
      const next = (m.reminders || []).filter((r) => r.id !== b.dataset.unschedule);
      try { await updateDoc(doc(db, "meetings", m.id), { reminders: next }); m.reminders = next; reminders.splice(0, reminders.length, ...next.sort((a, c) => a.at.localeCompare(c.at))); paint(); toast("Reminder removed.", "success"); }
      catch { toast("Couldn't remove it.", "error"); }
    });
    const go = el("button", { class: "btn btn-primary", onclick: async () => {
      const msg = body.querySelector(".mg-form-msg");
      const later = body.querySelector('[name="when"]:checked').value === "later";
      const message = body.querySelector('[name="rmsg"]').value.trim();
      msg.classList.remove("is-err");
      go.disabled = true;
      try {
        if (later) {
          const day = body.querySelector('[name="rday"]').value, time = body.querySelector('[name="rtime"]').value;
          if (!day || !time) throw new Error("Pick a day and time.");
          const at = etToUtcIso(day, time);
          if (Date.parse(at) <= Date.now()) throw new Error("Pick a time in the future, or Send now.");
          if (Date.parse(at) >= Date.parse(m.startsAt)) throw new Error("Pick a time before the meeting starts.");
          const r = { id: `r${Date.now().toString(36)}`, at, message, by: ctx.user?.uid || "", byName: ctx.profile?.name || "", sentAt: "" };
          await updateDoc(doc(db, "meetings", m.id), { reminders: [...(m.reminders || []), r] });
          toast(`Reminder scheduled for ${whenShort(at)}.`, "success");
        } else {
          msg.textContent = "Sending…";
          const res = await ctx.authedFetch("/api/meetings/remind", { method: "POST", body: JSON.stringify({ meetingId: m.id, message }) });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || "Couldn't send the reminder.");
          toast(`Reminder sent to ${data.emailed || 0} ${data.emailed === 1 ? "person" : "people"}${data.failed ? ` (${data.failed} failed)` : ""}.`, "success");
        }
        modal.close();
      } catch (err) {
        msg.textContent = err.message || "Something went wrong."; msg.classList.add("is-err");
        go.disabled = false;
      }
    } }, "Send reminder");
    body.addEventListener("change", (e) => { if (e.target.name === "when") go.textContent = e.target.value === "later" ? "Schedule reminder" : "Send reminder"; });
    const modal = openModal({ title: "Remind everyone", body, footer: [el("button", { class: "btn btn-secondary", onclick: () => modal.close() }, "Close"), go] });
  }
}

function injectStyle() {
  if (document.getElementById("mg-style")) return;
  const s = document.createElement("style");
  s.id = "mg-style";
  s.textContent = PICKER_CSS + `
.mg { max-width: 1040px; margin: 0 auto; padding: 0 0 64px; color: var(--ink); }
.mg-head { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 12px 20px; padding: 4px 0 20px; }
.mg-head h1 { margin: 0; font: 600 clamp(26px, 3.4vw, 34px)/1.15 var(--font); letter-spacing: -0.03em; }
.mg-head p { margin: 8px 0 0; font-size: 14.5px; line-height: 1.6; color: var(--ink-2); }
.mg-h2 { margin: 32px 0 12px; font: 600 17px/1.3 var(--font); letter-spacing: -0.015em; }
.mg-h2 span { font-weight: 500; font-size: 12.5px; color: var(--muted); margin-left: 6px; }
.mg-empty { padding: 60px 20px; text-align: center; color: var(--muted); }
.mg-none { padding: 34px 28px; border: 1px dashed var(--hairline); border-radius: 18px; background: var(--surface); }
.mg-none h2 { margin: 0 0 6px; font: 600 19px var(--font); }
.mg-none p { margin: 0; font-size: 14.5px; color: var(--ink-2); line-height: 1.6; }
.mg-next { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr); border-radius: 20px; overflow: hidden; border: 1px solid #eadbbd; background: #fbf6ec; box-shadow: var(--shadow-sm); }
.mg-next-main { padding: 28px 30px 26px; }
.mg-next-side { padding: 28px 30px 26px; background: color-mix(in srgb, #fbf6ec 55%, var(--surface)); border-left: 1px solid #eadbbd; }
.mg-badge { display: inline-flex; padding: 4px 12px; border-radius: 99px; background: #f1e3c4; color: #8a5a12; font: 700 11.5px/1.5 var(--font); letter-spacing: .02em; }
.mg-badge.is-soon { background: #fbe4da; color: #9a3412; }
.mg-badge.is-live { background: #2f7d4f; color: #f4fbf6; }
.mg-next h2 { margin: 14px 0 0; font: 600 clamp(22px, 2.8vw, 28px)/1.2 var(--font); letter-spacing: -0.025em; }
.mg-when { display: flex; flex-direction: column; gap: 2px; margin: 12px 0 0; }
.mg-when b { font-size: 17px; } .mg-when span { font-size: 15.5px; color: var(--ink-2); }
.mg-local { margin: 6px 0 0; font-size: 13px; color: var(--muted); }
.mg-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 20px; }
.mg-actions .btn { min-height: 44px; }
.mg-linktext { margin: 10px 0 0; font-size: 12.5px; color: var(--muted); word-break: break-all; }
.mg-next-side h3 { margin: 0 0 10px; font: 700 11.5px var(--font); letter-spacing: .12em; text-transform: uppercase; color: #8a5a12; }
.mg-agenda { margin: 0; padding-left: 20px; font-size: 14.5px; line-height: 1.6; color: var(--ink); }
.mg-agenda li + li { margin-top: 4px; }
.mg-note { margin: 14px 0 0; font-size: 14px; line-height: 1.6; color: var(--ink-2); white-space: pre-wrap; }
.mg-for { margin: 16px 0 0; font-size: 12.5px; color: var(--muted); }
.mg-muted { margin: 0; font-size: 14px; color: var(--muted); }
.mg-why-card { padding: 20px 24px; border-radius: 16px; background: #f6efe3; border: 1px solid #eadbbd; max-width: 760px; }
.mg-why-card p { margin: 0; font-size: 15px; line-height: 1.7; color: var(--ink); }
.mg-why-card p + p { margin-top: 10px; }
.mg-why-card .mg-why-foot { font-size: 13.5px; color: #7a6a4f; }
.mg-rows { margin: 0; padding: 0; list-style: none; }
.mg-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 0; border-top: 1px solid var(--hairline-2); }
.mg-row b { font-size: 14.5px; } .mg-row small { display: block; font-size: 12.5px; color: var(--muted); margin-top: 2px; }
.mg-row.is-cancelled b { text-decoration: line-through; color: var(--muted); }
.mg-chip { display: inline-flex; padding: 2px 9px; border-radius: 99px; background: var(--surface-3); font: 600 11px/1.5 var(--font); color: var(--ink-2); margin-left: 6px; vertical-align: 2px; }
.mg-chip.is-off { background: #fbe4da; color: #9a3412; }
.mg-form { display: flex; flex-direction: column; gap: 14px; }
.mg-f { display: flex; flex-direction: column; gap: 6px; min-width: 0; } .mg-f > span { font: 600 12.5px var(--font); }
.mg-f3 { display: grid; grid-template-columns: 1.3fr 1fr 1fr; gap: 10px; }
.mg-aud { display: flex; flex-wrap: wrap; gap: 6px 18px; font-size: 14px; }
.mg-aud label { display: inline-flex; align-items: center; gap: 6px; min-height: 36px; cursor: pointer; }
.mg-picker { margin-top: 6px; }
.mg-polls { display: flex; flex-direction: column; gap: 12px; margin: 0 0 18px; }
.mg-polls:empty { display: none; }
.mg-poll { border-radius: 20px; border: 1px solid var(--hairline); background: var(--surface); scroll-margin-top: 80px; }
.mg-poll-body { padding: 4px 22px 18px; }
.mg-poll.is-needs { background: #fdecea; border: 1px solid #f3b8b0; border-left: 6px solid #c4321f; color: #6e1a10; }
.mg-poll.is-needs .mg-poll-head { padding: 22px 24px 14px; }
.mg-poll.is-needs .mg-poll-body { padding: 0 14px 14px; }
.mg-poll.is-needs .mg-poll-body .mt-panel, .mg-poll.is-needs .mg-poll-body .mt-win, .mg-poll.is-needs .mg-poll-body .mt-tl-wrap { border-color: #f0c7c0; }
.mg-poll.is-needs .mt-head h3 { color: var(--ink); }
.mg-poll.is-done { background: #eef6f0; border-color: #cfe4d6; }
.mg-pollrow { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 14px; padding: 14px 18px; }
.mg-pollrow > div { flex: 1 1 220px; display: flex; flex-direction: column; gap: 2px; }
.mg-pollrow b { font-size: 14.5px; } .mg-pollrow small { font-size: 12.5px; color: var(--muted); }
.mg-pollrow-ico { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 50%; background: #2f7d4f; color: #f4fbf6; font-weight: 700; flex: none; }
.mg-pollrow-ico.is-admin { background: var(--surface-3); color: var(--ink-2); }
.mg-poll-head > .mg-urgent-tag + h2 { margin-top: 12px; }
.mg-poll-head h2 { margin: 0; font: 600 clamp(19px, 2.4vw, 23px)/1.3 var(--font); letter-spacing: -0.02em; color: #8f1d10; }
.mg-poll-head p { margin: 8px 0 0; font-size: 14.5px; line-height: 1.6; }
.mg-urgent-tag { display: inline-flex; padding: 4px 12px; border-radius: 99px; background: #b42318; color: #fff8f6; font: 700 11.5px/1.5 var(--font); letter-spacing: .02em; }
.mg-check { display: flex; align-items: center; gap: 8px; min-height: 36px; font-size: 14px; cursor: pointer; }
.mg-remind { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; margin-top: 18px; padding-top: 16px; border-top: 1px dashed #e3cfa5; }
.mg-remind .btn { min-height: 40px; }
.mg-remind p { margin: 0; font-size: 12.5px; line-height: 1.5; color: #7a6a4f; flex: 1 1 220px; }
.mg-r-lead { margin: 0; font-size: 14px; line-height: 1.6; color: var(--ink-2); }
.mg-r-list { margin: 0; padding: 0; list-style: none; }
.mg-r-list li { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 6px 0; border-top: 1px solid var(--hairline-2); font-size: 13.5px; }
.mg-form-msg { margin: 0; font-size: 13px; color: var(--muted); }
.mg-form-msg.is-err { color: #b4441b; font-weight: 600; }
.modal-footer .mg-del { margin-right: auto; color: #b4441b; }
@media (max-width: 820px) {
  .mg-next { grid-template-columns: minmax(0, 1fr); }
  .mg-next-side { border-left: 0; border-top: 1px solid #eadbbd; }
  .mg-next-main, .mg-next-side { padding: 22px 20px; }
  .mg-f3 { grid-template-columns: 1fr 1fr; } .mg-f3 > :first-child { grid-column: 1 / -1; }
}
`;
  document.head.appendChild(s);
}
