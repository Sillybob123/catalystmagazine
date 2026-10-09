// Social board: who posts what, and when (Social media → Posts).
//
// Assignments live in `social_assignments` (the Planner's tracker) with a
// `postId`, so a post assigned from the board shows up in the Planner too,
// emails its owners (/api/notify/assignment) and gets the daily due-day
// reminder. The board joins them onto the posts: an assigned post shows its
// owners and post-by date, and "Posted" once the assignment is done.
//
// Who can assign: admins and anyone granted '#/planner/assign' (the same
// people the Firestore rules let write assignments for others). Owners can
// mark their own post as posted.

import { esc } from "./ui.js";

const PLAN_ROLES = ["admin", "marketing", "social_media"];
const ROLE_ORDER = { social_media: 0, marketing: 1, admin: 2 };

export function canAssign(ctx) {
  if (ctx.role === "admin") return true;
  const g = ctx.profile?.extraAccess;
  return Array.isArray(g) && g.includes("#/planner/assign");
}

// ── People ──
export function avatarColor(str) {
  if (!str) return "#64748b";
  let h = 0;
  for (let i = 0; i < str.length; i++) h = str.charCodeAt(i) + ((h << 5) - h);
  return `hsl(${Math.abs(h) % 360}, 42%, 42%)`;
}
export const firstName = (n) => String(n || "").trim().split(/\s+/)[0] || "Someone";
// Posts made by the post generators carry a label, not a person's name.
export const creatorName = (n) => (/^(post studio|post bank|the catalyst)$/i.test(String(n || "").trim()) ? String(n).trim() : firstName(n));
function initials(n) {
  const parts = String(n || "?").trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || "?") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}
export function avatar(person, cls = "") {
  const name = person?.name || person?.email || "?";
  return `<i class="spa ${cls}" style="background:${avatarColor(name)}" title="${esc(name)}">${esc(initials(name))}</i>`;
}
export function avatarStack(list, max = 3) {
  const shown = list.slice(0, max).map((p) => avatar(p)).join("");
  return `<span class="spa-stack">${shown}${list.length > max ? `<i class="spa spa-more">+${list.length - max}</i>` : ""}</span>`;
}

// ── Firestore REST plumbing (values → plain objects) ──
function fromValue(v) {
  if (!v) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("timestampValue" in v) return v.timestampValue;
  if ("nullValue" in v) return null;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(fromValue);
  if ("mapValue" in v) return fromFields(v.mapValue.fields || {});
  return null;
}
function fromFields(f) { const o = {}; for (const [k, v] of Object.entries(f || {})) o[k] = fromValue(v); return o; }

export async function loadAssignments(runQuery) {
  const rows = await runQuery({ from: [{ collectionId: "social_assignments" }], limit: 600 });
  return rows.map((r) => ({ id: r.document.name.split("/").pop(), ...fromFields(r.document.fields) })).filter((a) => a.postId);
}
export async function loadTeam(runQuery) {
  const rows = await runQuery({ from: [{ collectionId: "users" }], limit: 500 });
  return rows.map((r) => ({ id: r.document.name.split("/").pop(), ...fromFields(r.document.fields) }))
    .filter((u) => u.role && (PLAN_ROLES.includes(u.role) || (u.extraAccess || []).some((g) => g === "#/planner" || g === "#/planner/assign")))
    .map((u) => ({ id: u.id, name: u.name || u.displayName || u.email || "Teammate", email: u.email || "", role: u.role }))
    .sort((a, b) => ((ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9)) || a.name.localeCompare(b.name));
}

export const ownersOf = (a) => (a?.assignees?.length ? a.assignees : a?.assigneeId ? [{ id: a.assigneeId, name: a.assigneeName || "", email: a.assigneeEmail || "" }] : []);
export const isDone = (a) => !!a && (a.status === "published" || a.status === "done");

// Put each post's assignment on it. The post keeps its own status/date in
// `own` so un-assigning brings them back.
export function applyPlan(posts, assignments) {
  const byPost = new Map();
  for (const a of assignments) {
    const cur = byPost.get(a.postId);
    if (!cur || String(a.updatedAt || a.createdAt || "") > String(cur.updatedAt || cur.createdAt || "")) byPost.set(a.postId, a);
  }
  for (const p of posts) {
    p.own = p.own || { status: p.status, deadline: p.deadline };
    const a = byPost.get(p.id) || null;
    p.assign = a;
    p.owners = ownersOf(a);
    p.status = a ? (isDone(a) ? "posted" : "assigned") : p.own.status;
    p.deadline = a ? (a.deadline || p.own.deadline || "") : p.own.deadline;
    p.postTime = a?.postTime || "";
  }
}

export function fmtTime(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || ""); if (!m) return "";
  const h = +m[1], ap = h >= 12 ? "pm" : "am", h12 = h % 12 || 12;
  return `${h12}${m[2] === "00" ? "" : ":" + m[2]} ${ap}`;
}
const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// ── Schedule: two weeks, Monday first ──
export function scheduleHTML(posts, offsetWeeks, { myUid, thumb }) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const start = new Date(today); start.setDate(today.getDate() - ((today.getDay() + 6) % 7) + offsetWeeks * 7);
  const days = Array.from({ length: 14 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  const byDay = new Map(days.map((d) => [dayKey(d), []]));
  let undated = 0;
  for (const p of posts) {
    if (!p.deadline) { if (p.status !== "posted") undated++; continue; }
    byDay.get(p.deadline)?.push(p);
  }
  for (const list of byDay.values()) list.sort((a, b) => (a.postTime || "99").localeCompare(b.postTime || "99"));
  const end = days[13];
  const range = `${start.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${end.toLocaleDateString(undefined, { month: "short", day: "numeric", year: end.getFullYear() !== today.getFullYear() ? "numeric" : undefined })}`;
  const cell = (d) => {
    const k = dayKey(d), list = byDay.get(k);
    const past = d < today, isToday = +d === +today;
    return `<div class="sps-day${isToday ? " is-today" : ""}${past ? " is-past" : ""}" data-day="${k}">
      <div class="sps-dayhead"><span>${d.toLocaleDateString(undefined, { weekday: "short" })}</span><b>${d.getDate()}</b></div>
      ${list.map((p) => {
        const late = past && p.status !== "posted";
        const mine = p.owners?.some((o) => o.id === myUid);
        return `<button type="button" class="sps-item is-${esc(p.status || "proposed")}${late ? " is-late" : ""}${mine ? " is-mine" : ""}" data-open="${esc(p.id)}" title="${esc(p.title)}">
          ${thumb(p)}
          <span class="sps-txt"><b>${esc(p.cleanTitle)}</b><small>${p.postTime ? esc(fmtTime(p.postTime)) + " · " : ""}${p.status === "posted" ? "Posted" : late ? "Overdue" : p.owners?.length ? esc(p.owners.map((o) => firstName(o.name)).join(", ")) : "Not assigned"}</small></span>
        </button>`;
      }).join("")}
    </div>`;
  };
  return `
    <div class="sps-head">
      <div class="sps-nav">
        <button type="button" class="sps-arrow" data-week="-1" aria-label="Earlier">‹</button>
        <button type="button" class="sps-today" data-week="0">Today</button>
        <button type="button" class="sps-arrow" data-week="1" aria-label="Later">›</button>
        <b>${esc(range)}</b>
      </div>
      <span class="sps-note">${undated ? `${undated} draft${undated === 1 ? "" : "s"} without a date. Open one to schedule it.` : "Every draft has a date."}</span>
    </div>
    <div class="sps-week">${days.slice(0, 7).map(cell).join("")}</div>
    <div class="sps-week">${days.slice(7).map(cell).join("")}</div>`;
}

// ── The "who and when" block in a post's details ──
// api: { write(path, fields), add(collection, fields), del(path), notify(id), writePost(fields) }
export function mountPlan(el, { p, ctx, team, lead, api, onChange }) {
  const a = p.assign;
  const myUid = ctx.user?.uid;
  const owners = ownersOf(a);
  const mine = owners.some((o) => o.id === myUid);
  const ownsPost = p.proposerId === myUid || ["admin", "editor"].includes(ctx.role);
  const canDate = lead || (a ? mine : ownsPost);
  let picked = owners.map((o) => o.id);

  const peopleHTML = () => {
    const sel = picked.map((id) => team.find((u) => u.id === id) || owners.find((o) => o.id === id)).filter(Boolean);
    return sel.length
      ? sel.map((u) => `<span class="spp-person">${avatar(u)}<span>${esc(u.name)}</span>${lead ? `<button type="button" data-unpick="${esc(u.id)}" aria-label="Remove ${esc(u.name)}">×</button>` : ""}</span>`).join("")
      : `<span class="spp-none">${lead ? "Nobody yet" : "Not assigned yet"}</span>`;
  };
  el.innerHTML = `
    <div class="spp">
      <div class="spp-row">
        <label class="spd-label" for="spp-date">Post on</label>
        <div class="spp-when">
          <input type="date" id="spp-date" value="${esc(p.deadline || "")}" ${canDate ? "" : "disabled"}>
          <input type="time" id="spp-time" value="${esc(p.postTime || "")}" ${canDate ? "" : "disabled"} aria-label="Time (optional)" step="900">
        </div>
      </div>
      <div class="spp-row">
        <span class="spd-label">Who posts it</span>
        <div class="spp-people"><span id="spp-people">${peopleHTML()}</span>
          ${lead ? `<span class="spp-addwrap"><button type="button" class="spp-add" id="spp-add" aria-haspopup="listbox" aria-expanded="false">+ Assign</button>
            <div class="spp-menu" id="spp-menu" role="listbox" aria-label="Team" hidden>
              <input type="search" class="spp-q" id="spp-q" placeholder="Search the team" aria-label="Search the team">
              <div class="spp-list" id="spp-list"></div>
            </div></span>` : ""}
        </div>
      </div>
      ${lead ? `<p class="spp-hint" id="spp-hint" aria-live="polite"></p>` : ""}
      <div class="spp-row spp-taskrow">
        <label class="spd-label" for="spp-task">Task <em>(optional)</em></label>
        ${lead ? `<textarea id="spp-task" class="input textarea" rows="2" placeholder="e.g. Post at 6 pm, tag @gwtoday and share it to our story too.">${esc(a?.notes || "")}</textarea>`
          : `<p class="spp-taskro">${a?.notes ? esc(a.notes) : "No extra instructions."}</p>`}
      </div>
      <div class="spp-actions">
        ${a ? `<span class="spp-meta">${isDone(a) ? `Posted${a.doneAt ? " " + new Date(a.doneAt).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : ""}` : `Assigned by ${esc(firstName(a.createdByName))}`}</span>` : ""}
        <span class="spp-spacer"></span>
        <span class="spp-status" id="spp-status" role="status"></span>
        ${a && lead ? `<button type="button" class="btn btn-ghost btn-sm" id="spp-unassign">Unassign</button>` : ""}
        ${a && (lead || mine) ? `<button type="button" class="btn btn-secondary btn-sm" id="spp-done">${isDone(a) ? "Not posted yet" : "Mark as posted"}</button>` : ""}
        ${lead ? `<button type="button" class="btn btn-primary btn-sm" id="spp-save" disabled>${a ? "Save" : "Assign"}</button>` : ""}
      </div>
    </div>`;
  const $ = (s) => el.querySelector(s);
  const status = (t) => { $("#spp-status").textContent = t; };
  const dateEl = $("#spp-date"), timeEl = $("#spp-time"), taskEl = $("#spp-task");
  const saveBtn = $("#spp-save");
  const start = JSON.stringify([p.deadline || "", p.postTime || "", owners.map((o) => o.id).sort(), a?.notes || ""]);
  const dirty = () => JSON.stringify([dateEl.value, timeEl.value, [...picked].sort(), taskEl ? taskEl.value.trim() : a?.notes || ""]) !== start;
  // Say exactly when people hear about it.
  const hint = () => {
    const h = $("#spp-hint"); if (!h) return;
    const before = owners.map((o) => o.id);
    const fresh = picked.filter((id) => !before.includes(id) && id !== myUid).map((id) => team.find((u) => u.id === id)).filter(Boolean);
    const all = picked.map((id) => team.find((u) => u.id === id) || owners.find((o) => o.id === id)).filter(Boolean);
    const d = dateEl.value ? new Date(dateEl.value + "T12:00:00") : null;
    const when = d ? d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : "";
    if (!all.length) { h.textContent = ""; return; }
    const names = (list) => list.map((u) => firstName(u.name)).join(", ");
    h.textContent = [
      fresh.length ? `${names(fresh)} will get an email as soon as you save.` : "",
      d ? `${names(all)} ${all.length === 1 ? "gets" : "get"} a reminder email the morning of ${when}${timeEl.value ? `, for the ${fmtTime(timeEl.value)} post` : ""}.` : "Pick a day and they'll get a reminder that morning.",
    ].filter(Boolean).join(" ");
  };
  const refresh = () => { hint(); if (saveBtn) { saveBtn.disabled = !dirty(); saveBtn.textContent = !a && !picked.length ? "Save date" : a ? "Save" : "Assign & notify"; } };

  // People picker
  const menu = $("#spp-menu"), list = $("#spp-list"), q = $("#spp-q");
  const paintList = () => {
    const s = (q?.value || "").trim().toLowerCase();
    list.innerHTML = team.filter((u) => !s || `${u.name} ${u.email}`.toLowerCase().includes(s)).map((u) => `
      <button type="button" role="option" class="spp-opt${picked.includes(u.id) ? " is-on" : ""}" data-pick="${esc(u.id)}" aria-selected="${picked.includes(u.id)}">
        ${avatar(u)}<span><b>${esc(u.name)}${u.id === myUid ? " (you)" : ""}</b><small>${esc({ social_media: "Social media", marketing: "Marketing", admin: "Admin" }[u.role] || u.role || "")}</small></span>
        <span class="spp-check" aria-hidden="true">${picked.includes(u.id) ? "✓" : ""}</span>
      </button>`).join("") || `<p class="spp-empty">No one matches.</p>`;
  };
  const closeMenu = () => { if (!menu || menu.hidden) return; menu.hidden = true; $("#spp-add").setAttribute("aria-expanded", "false"); };
  $("#spp-add")?.addEventListener("click", () => {
    const open = menu.hidden; menu.hidden = !open; $("#spp-add").setAttribute("aria-expanded", String(open));
    if (open) { paintList(); q.value = ""; q.focus(); }
  });
  q?.addEventListener("input", paintList);
  // Escape closes just the menu, not the whole post.
  menu?.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); closeMenu(); $("#spp-add").focus(); } });
  list?.addEventListener("click", (e) => {
    e.stopPropagation();   // the list re-renders; don't let the outside-click check close the menu
    const b = e.target.closest("[data-pick]"); if (!b) return;
    const id = b.dataset.pick;
    picked = picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id];
    paintList(); $("#spp-people").innerHTML = peopleHTML(); refresh();
    list.querySelector(`[data-pick="${CSS.escape(id)}"]`)?.focus();   // keep focus (and Escape) inside the menu
  });
  el.addEventListener("click", (e) => {
    const b = e.target.closest("[data-unpick]"); if (b) { picked = picked.filter((x) => x !== b.dataset.unpick); $("#spp-people").innerHTML = peopleHTML(); if (!menu?.hidden) paintList(); refresh(); return; }
    if (menu && !menu.hidden && e.target.isConnected && !e.target.closest(".spp-addwrap")) closeMenu();
  });
  [dateEl, timeEl].forEach((x) => x.addEventListener("input", refresh));
  taskEl?.addEventListener("input", refresh);

  // Someone who can date the post but not assign (its author, or an owner):
  // the date saves as soon as it changes.
  if (!lead && canDate) {
    const saveDate = async () => {
      status("Saving…");
      try {
        if (a) await api.write(`social_assignments/${a.id}`, { deadline: dateEl.value || a.deadline || "", postTime: timeEl.value || "", updatedAt: new Date().toISOString() });
        else await api.writePost({ deadline: dateEl.value || "" });
        status("Saved"); onChange();
      } catch (err) { status(""); ctx.toast("Couldn't save the date: " + err.message, "error"); }
    };
    dateEl.addEventListener("change", saveDate); timeEl.addEventListener("change", saveDate);
  }

  saveBtn?.addEventListener("click", async () => {
    const sel = picked.map((id) => team.find((u) => u.id === id) || owners.find((o) => o.id === id)).filter(Boolean);
    if (sel.length && !dateEl.value) { status(""); ctx.toast("Pick the day it should go out.", "error"); dateEl.focus(); return; }
    saveBtn.disabled = true; status("Saving…");
    try {
      if (!sel.length && !a) {
        // Just a date on an unassigned draft (allowed for its author and editors).
        await api.writePost({ deadline: dateEl.value || "" }).catch(() => { throw new Error("only the person who made this draft can date it without assigning it. Pick who posts it, then save"); });
      } else if (!sel.length && a) {
        // Nobody left: same as unassigning.
        await api.del(`social_assignments/${a.id}`);
        await api.writePost({ deadline: dateEl.value || a.deadline || "" }).catch(() => {});
      } else {
        const primary = sel[0];
        const fields = {
          postId: p.id, articleTitle: p.cleanTitle || p.title || "Social post", platform: p.platform || "instagram",
          type: /Carousel/.test(p.kind || "") ? "Infographic carousel" : "", link: "",
          deadline: dateEl.value, postTime: timeEl.value || "", notes: taskEl ? taskEl.value.trim() : (a?.notes || ""),
          assigneeId: primary.id, assigneeName: primary.name || "", assigneeEmail: primary.email || "",
          assignees: sel.map((u) => ({ id: u.id, name: u.name || "", email: u.email || "" })), assigneeIds: sel.map((u) => u.id),
          status: a && isDone(a) ? "published" : "scheduled", updatedAt: new Date().toISOString(),
        };
        let id = a?.id;
        const before = owners.map((o) => o.id);
        if (a) await api.write(`social_assignments/${a.id}`, fields);
        else id = await api.add("social_assignments", { ...fields, doneAt: null, createdById: myUid, createdByName: ctx.profile?.name || ctx.user?.email || "", createdAt: new Date().toISOString() });
        const added = sel.map((u) => u.id).filter((x) => !before.includes(x) && x !== myUid);
        if (added.length) api.notify(id);
        ctx.toast(added.length ? `Assigned. Emailing ${sel.filter((u) => added.includes(u.id)).map((u) => firstName(u.name)).join(", ")}.` : "Saved.", "success");
      }
      status("Saved"); onChange();
    } catch (err) {
      status(""); saveBtn.disabled = false;
      ctx.toast("Couldn't save: " + err.message, "error");
    }
  });
  $("#spp-done")?.addEventListener("click", async (e) => {
    const done = !isDone(a);
    e.target.disabled = true;
    try {
      await api.write(`social_assignments/${a.id}`, { status: done ? "published" : "scheduled", doneAt: done ? new Date().toISOString() : null, updatedAt: new Date().toISOString() });
      if (done) api.writePost({ status: "posted" }).catch(() => {});
      ctx.toast(done ? "Marked as posted." : "Moved back to scheduled.", "success");
      onChange();
    } catch (err) { e.target.disabled = false; ctx.toast("Couldn't update: " + err.message, "error"); }
  });
  $("#spp-unassign")?.addEventListener("click", async (e) => {
    e.target.disabled = true;
    try {
      await api.del(`social_assignments/${a.id}`);
      await api.writePost({ deadline: a.deadline || p.own?.deadline || "" }).catch(() => {});
      ctx.toast("Unassigned.", "success"); onChange();
    } catch (err) { e.target.disabled = false; ctx.toast("Couldn't unassign: " + err.message, "error"); }
  });
  refresh();
  return { close: closeMenu };
}
