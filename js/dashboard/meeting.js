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
//   • When to meet hands off here: #/meeting?poll=…&date=…&start=…&end=…
//     opens the form filled in with that time and the poll's people.
//
// Data: meetings/{id} { title, date "YYYY-MM-DD", start "HH:MM", end, startsAt,
// endsAt (UTC ISO), link, agenda, note, audience: all|people, invitedUids,
// invitees: [{ name, uids }], status: draft|published|cancelled, pollId,
// createdAt, createdBy, publishedAt, emailedAt, remindedFor }.
// Rules: staff read, admins write.

import { db } from "../firebase-config.js";
import {
  collection, doc, onSnapshot, addDoc, updateDoc, deleteDoc, getDoc,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { el, esc, toast, openModal, confirmDialog } from "./ui.js";
import { loadPeople, mountPeoplePicker, peopleUids, PICKER_CSS } from "./people-picker.js?v=1";

const WHY = [
  ["Decisions happen here", "Deadlines, section plans and changes to the edition are settled in the meeting. Being there means you hear them first-hand."],
  ["Get unstuck early", "Bring the question you're stuck on. It's the fastest way to get help from your editor and the rest of the team."],
  ["Keep your section moving", "Your editor and co-writers plan around what you share. Showing up on time keeps everyone in step."],
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
const safeLink = (u) => /^https?:\/\//i.test(String(u || "").trim()) ? String(u).trim() : "";

export async function mount(ctx, container) {
  injectStyle();
  const isAdmin = ctx.role === "admin";
  const root = el("div", { class: "mg" });
  container.innerHTML = "";
  container.appendChild(root);
  let meetings = [], tick = null;
  root.innerHTML = `<div class="loading-state"><div class="spinner"></div>Loading&hellip;</div>`;
  const unsub = onSnapshot(collection(db, "meetings"), (s) => {
    meetings = s.docs.map((d) => ({ id: d.id, ...d.data() }));
    render();
  }, () => { root.innerHTML = `<div class="mg-empty"><p>Couldn't load meetings.</p></div>`; });
  root.addEventListener("click", (e) => {
    if (e.target.closest("[data-new]")) editMeeting(null);
    const b = e.target.closest("[data-edit]");
    if (b) editMeeting(meetings.find((m) => m.id === b.dataset.edit));
  });

  tick = setInterval(() => { if (document.contains(root)) render(); }, 60000);

  // Coming from When to meet with a time picked.
  const params = new URLSearchParams(location.hash.split("?")[1] || "");
  if (isAdmin && params.get("date")) {
    let preset = { date: params.get("date"), start: params.get("start") || "18:00", end: params.get("end") || "19:00", pollId: params.get("poll") || "" };
    if (preset.pollId) {
      try { const p = await getDoc(doc(db, "meet_polls", preset.pollId)); if (p.exists()) { preset.title = p.data().title || ""; preset.invitees = p.data().invitees || []; } } catch {}
    }
    history.replaceState(null, "", "#/meeting");
    editMeeting(null, preset);
  }
  return () => { unsub(); clearInterval(tick); };

  function render() {
    const now = Date.now();
    const visible = meetings.filter((m) => isAdmin || m.status === "published" || m.status === "cancelled");
    const upcoming = visible.filter((m) => m.endsAt && Date.parse(m.endsAt) > now && m.status !== "draft").sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    const next = upcoming.find((m) => m.status === "published");
    const later = upcoming.filter((m) => m !== next);
    const drafts = isAdmin ? meetings.filter((m) => m.status === "draft").sort((a, b) => String(a.startsAt || "").localeCompare(String(b.startsAt || ""))) : [];
    const past = visible.filter((m) => m.status === "published" && m.endsAt && Date.parse(m.endsAt) <= now).sort((a, b) => b.startsAt.localeCompare(a.startsAt)).slice(0, 8);

    root.innerHTML = `
      <header class="mg-head">
        <div><h1>Meeting</h1><p>When we're meeting next, what we'll cover, and how to join.</p></div>
        ${isAdmin ? `<button type="button" class="btn btn-primary" data-new>Set the next meeting</button>` : ""}
      </header>
      ${next ? nextCard(next, now) : `<section class="mg-none"><h2>No meeting on the calendar yet.</h2><p>${isAdmin ? "Set the next one and everyone it's for gets an email, then a reminder the day before." : "You'll get an email as soon as the next one is set, and a reminder the day before."}</p></section>`}
      ${drafts.length ? `<h2 class="mg-h2">Drafts <span>only admins see these</span></h2><ul class="mg-rows">${drafts.map((m) => row(m, "draft")).join("")}</ul>` : ""}
      ${later.length ? `<h2 class="mg-h2">Also coming up</h2><ul class="mg-rows">${later.map((m) => row(m)).join("")}</ul>` : ""}
      <section class="mg-why">
        <h2 class="mg-h2">Why it matters to be there</h2>
        <div class="mg-why-grid">${WHY.map(([h, p], i) => `<div class="mg-why-item mg-why-${i}"><b>${esc(h)}</b><p>${esc(p)}</p></div>`).join("")}</div>
        <p class="mg-why-foot">Can't make it? Tell your section editor before the meeting so they can catch you up.</p>
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
      </div>
      <div class="mg-next-side">
        ${agenda.length ? `<h3>On the agenda</h3><ol class="mg-agenda">${agenda.map((a) => `<li>${esc(a)}</li>`).join("")}</ol>` : `<h3>On the agenda</h3><p class="mg-muted">The agenda will be posted here.</p>`}
        ${m.note ? `<p class="mg-note">${esc(m.note)}</p>` : ""}
        <p class="mg-for">${who ? `For: ${esc(who.join(", "))}` : "For the whole team"}</p>
      </div>
    </section>`;
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
      <p class="mg-form-msg" aria-live="polite">${m.status === "published" ? "This meeting is published. Saving and emailing sends everyone an updated email." : "Publishing emails everyone it's for, and they get a reminder about a day before."}</p>`;
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
      if (m.startsAt && m.startsAt !== v.startsAt) v.remindedFor = "";   // new time, new reminder
      return { v };
    };
    const save = async (publish) => {
      const { v, err } = read();
      if (err) { msg.textContent = err; msg.classList.add("is-err"); return; }
      if (publish && Date.parse(v.endsAt) < Date.now()) { msg.textContent = "That time has already passed."; msg.classList.add("is-err"); return; }
      buttons.forEach((b) => { b.disabled = true; });
      msg.classList.remove("is-err");
      msg.textContent = publish ? "Publishing and emailing…" : "Saving…";
      try {
        let id = cur?.id;
        if (isNew) {
          const ref = await addDoc(collection(db, "meetings"), { ...v, pollId: m.pollId || "", status: "draft", createdAt: new Date().toISOString(), createdBy: ctx.user?.uid || "", createdByName: ctx.profile?.name || "" });
          id = ref.id;
        } else {
          await updateDoc(doc(db, "meetings", id), { ...v, updatedAt: new Date().toISOString() });
        }
        if (publish) {
          const res = await ctx.authedFetch("/api/meetings/publish", { method: "POST", body: JSON.stringify({ meetingId: id }) });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || "publish failed");
          toast(`${data.kind === "updated" ? "Updated" : "Published"}. Emailed ${data.emailed || 0} ${data.emailed === 1 ? "person" : "people"}${data.failed ? ` (${data.failed} failed)` : ""}.`, "success");
        } else toast("Saved.", "success");
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
    if (!published) buttons.push(el("button", { class: "btn btn-secondary", onclick: () => save(false) }, "Save draft"));
    if (published) buttons.push(el("button", { class: "btn btn-secondary", onclick: () => save(false) }, "Save without emailing"));
    buttons.push(el("button", { class: "btn btn-primary", onclick: () => save(true) }, published ? "Save and email the update" : "Publish and email"));
    const modal = openModal({ title: isNew ? "Set the next meeting" : "Edit meeting", body, footer: buttons, size: "wide" });
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
.mg-why-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.mg-why-item { padding: 16px 18px; border-radius: 14px; }
.mg-why-item b { display: block; font-size: 14.5px; margin-bottom: 4px; }
.mg-why-item p { margin: 0; font-size: 13.5px; line-height: 1.55; color: var(--ink-2); }
.mg-why-0 { background: #e2ecf7; } .mg-why-0 b { color: #2b5f9e; }
.mg-why-1 { background: #e3f1e7; } .mg-why-1 b { color: #2f7d4f; }
.mg-why-2 { background: #fbe4da; } .mg-why-2 b { color: #b4441b; }
.mg-why-foot { margin: 12px 0 0; font-size: 13.5px; color: var(--muted); }
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
.mg-form-msg { margin: 0; font-size: 13px; color: var(--muted); }
.mg-form-msg.is-err { color: #b4441b; font-weight: 600; }
.modal-footer .mg-del { margin-right: auto; color: #b4441b; }
@media (max-width: 820px) {
  .mg-next { grid-template-columns: minmax(0, 1fr); }
  .mg-next-side { border-left: 0; border-top: 1px solid #eadbbd; }
  .mg-next-main, .mg-next-side { padding: 22px 20px; }
  .mg-why-grid { grid-template-columns: minmax(0, 1fr); }
  .mg-f3 { grid-template-columns: 1fr 1fr; } .mg-f3 > :first-child { grid-column: 1 / -1; }
}
`;
  document.head.appendChild(s);
}
