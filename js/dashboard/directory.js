// Team directory — everyone on staff with their role, email, and phone,
// searchable, plus private messaging: click "Message" to open a 1:1 chat
// thread that lives in Firestore (dm_threads) and emails the recipient a
// copy of each message (POST /api/notify/dm) so nothing gets missed.
//
// Privacy: phone numbers live on users/{uid}.phone and in directory_contacts,
// both of which are staff-read-only in firestore.rules — nothing here is
// reachable from the public site or by anonymous visitors.
//
// Admins can also add people who don't have dashboard accounts yet (interns,
// advisors, alumni) as manual entries in directory_contacts, and edit any
// card's phone number inline.

import { db } from "../firebase-config.js";
import {
  collection,
  query,
  where,
  getDocs,
  limit,
  doc,
  setDoc,
  deleteDoc,
  addDoc,
  onSnapshot,
  arrayUnion,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { el, esc, fmtRelative, openModal, confirmDialog } from "./ui.js";

const ROLE_META = {
  admin:              { label: "Administrator",      group: "Leadership",  order: 1, color: "#7c3aed" },
  editor:             { label: "Editor / Writer",    group: "Editorial",   order: 2, color: "#0f766e" },
  writer:             { label: "Writer",             group: "Editorial",   order: 3, color: "#0891b2" },
  newsletter_builder: { label: "Newsletter Builder", group: "Publishing",  order: 4, color: "#b45309" },
  marketing:          { label: "Marketing",          group: "Publishing",  order: 5, color: "#db2777" },
  social_media:       { label: "Social Media",       group: "Publishing",  order: 6, color: "#ea580c" },
  reader:             { label: "Reader",             group: "Community",   order: 7, color: "#64748b" },
};

const GROUP_ORDER = ["Leadership", "Editorial", "Publishing", "Community"];

export async function mount(ctx, container) {
  container.innerHTML = "";

  // Recent conversations — threads the signed-in user is part of, newest
  // first, so replies are easy to find without hunting through the grid.
  const convos = el("div", { class: "card" });
  convos.innerHTML = `
    <div class="card-header">
      <div>
        <div class="card-title">Your messages</div>
        <div class="card-subtitle">Private conversations with teammates — each message is also emailed to them</div>
      </div>
    </div>
    <div class="card-body" id="dir-convos"><div class="loading-state"><div class="spinner"></div>Loading&hellip;</div></div>`;
  container.appendChild(convos);

  // Directory grid
  const isAdmin = ctx.role === "admin";
  const card = el("div", { class: "card", style: { marginTop: "20px" } });
  card.innerHTML = `
    <div class="card-header" style="flex-wrap:wrap;gap:12px;align-items:flex-start;">
      <div style="min-width:240px;flex:1;">
        <div class="card-title">Team directory</div>
        <div class="card-subtitle">Everyone on staff — who they are, what they do, and how to reach them. Contact info is visible to staff only.</div>
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:nowrap;flex-shrink:0;">
        <input id="dir-search" type="search" placeholder="Search the team…" autocomplete="off" aria-label="Search by name, role, email, or phone"
               style="padding:9px 16px;border:1px solid var(--hairline,#e5e7eb);border-radius:999px;font-size:13px;font-family:inherit;width:clamp(160px,28vw,260px);min-height:38px;background:var(--surface-2,#f8fafc);">
        ${isAdmin ? `
          <button type="button" class="btn btn-secondary btn-sm" id="dir-add" style="white-space:nowrap;flex-shrink:0;min-height:38px;display:inline-flex;align-items:center;gap:6px;">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>Add person
          </button>` : ""}
      </div>
    </div>
    <div class="card-body" id="dir-body"><div class="loading-state"><div class="spinner"></div>Loading&hellip;</div></div>`;
  container.appendChild(card);

  const state = { people: [], threads: [], unsubThread: null };

  const renderGrid = () => renderDirectory(card.querySelector("#dir-body"), ctx, state, card.querySelector("#dir-search").value);
  const reload = async () => {
    try {
      state.people = await loadPeople();
      renderGrid();
    } catch (err) {
      console.warn("[directory] load failed", err);
      card.querySelector("#dir-body").innerHTML =
        `<div class="error-state">Could not load the team. ${esc(err?.message || "")}</div>`;
    }
  };
  state.reload = reload;

  card.querySelector("#dir-search").addEventListener("input", renderGrid);
  if (isAdmin) {
    card.querySelector("#dir-add").addEventListener("click", () => openContactEditor(ctx, state, null));
  }
  await reload();

  loadConversations(convos.querySelector("#dir-convos"), ctx, state);

  return () => {
    if (typeof state.unsubThread === "function") {
      try { state.unsubThread(); } catch {}
      state.unsubThread = null;
    }
  };
}

async function loadPeople() {
  const [snap, contactsSnap] = await Promise.all([
    getDocs(query(collection(db, "users"), limit(200))),
    // Manual entries admins added for people without dashboard accounts.
    getDocs(query(collection(db, "directory_contacts"), limit(200))).catch(() => null),
  ]);

  // Dedupe — a person can have two user docs (a reader doc from a newsletter
  // signup plus a staff doc); keep the doc with the highest-priority role.
  const raw = [];
  snap.forEach((d) => {
    const u = d.data();
    if ((u.status || "active") === "inactive") return;
    raw.push({ ...u, id: d.id, role: u.role || "reader" });
  });
  if (contactsSnap) {
    contactsSnap.forEach((d) => {
      const c = d.data();
      // Manual contacts lose to a real user doc with the same email in the
      // dedupe below (order 98 > any real role) — so when someone admins
      // added by hand later gets an account, the account card wins.
      raw.push({ ...c, id: d.id, role: c.role || "writer", manual: true });
    });
  }

  const byKey = new Map();
  const orderOf = (p) => (p.manual ? 98 : (ROLE_META[p.role]?.order ?? 99));
  for (const p of raw) {
    const key = identityKey(p);
    const existing = byKey.get(key);
    if (!existing) { byKey.set(key, p); continue; }
    const ao = orderOf(p);
    const bo = orderOf(existing);
    if (ao < bo) byKey.set(key, { ...existing, ...p, id: p.id, role: p.role, manual: p.manual });
    else if (ao === bo) {
      byKey.set(key, {
        ...existing,
        name: existing.name || p.name,
        email: existing.email || p.email,
        phone: existing.phone || p.phone,
      });
    } else if (!existing.phone && p.phone) {
      // The losing doc may still carry the only phone number on file.
      byKey.set(key, { ...existing, phone: p.phone });
    }
  }

  // Readers (the newsletter audience) aren't staff — keep the directory to
  // the team itself.
  const people = Array.from(byKey.values()).filter((p) => p.role !== "reader");
  people.sort((a, b) => {
    const ao = ROLE_META[a.role]?.order ?? 99;
    const bo = ROLE_META[b.role]?.order ?? 99;
    if (ao !== bo) return ao - bo;
    return (a.name || a.email || "").localeCompare(b.name || b.email || "");
  });
  return people;
}

function renderDirectory(mountEl, ctx, state, search = "") {
  const q = search.trim().toLowerCase();
  const qDigits = q.replace(/\D/g, "");
  const matches = state.people.filter((p) => {
    if (!q) return true;
    const meta = ROLE_META[p.role] || ROLE_META.reader;
    if ([p.name, p.email, p.title, meta.label].some((s) => String(s || "").toLowerCase().includes(q))) return true;
    if (qDigits && String(p.phone || "").replace(/\D/g, "").includes(qDigits)) return true;
    return false;
  });

  if (!matches.length) {
    mountEl.innerHTML = `<div class="empty-state">No one matches "${esc(search.trim())}".</div>`;
    return;
  }

  const groups = {};
  for (const p of matches) {
    const g = ROLE_META[p.role]?.group || "Community";
    (groups[g] = groups[g] || []).push(p);
  }

  mountEl.innerHTML = "";
  for (const gName of GROUP_ORDER) {
    const list = groups[gName];
    if (!list?.length) continue;

    const section = el("div", { class: "staff-group" });
    section.innerHTML = `
      <div class="staff-group-head">
        <span class="staff-group-title">${esc(gName)}</span>
        <span class="staff-group-count">${list.length}</span>
      </div>
      <div class="staff-grid"></div>`;
    const grid = section.querySelector(".staff-grid");

    for (const p of list) {
      const meta = ROLE_META[p.role] || ROLE_META.reader;
      const roleLabel = p.manual && p.title ? p.title : meta.label;
      const name = p.name || p.email || "Unknown";
      const isSelf = p.id === ctx.user.uid;
      const isAdmin = ctx.role === "admin";
      const phone = String(p.phone || "").trim();
      const card = el("div", { class: "staff-card" });
      card.innerHTML = `
        <div class="staff-avatar" style="background:${meta.color};">${esc(getInitials(name))}</div>
        <div class="staff-info" style="min-width:0;">
          <div class="staff-name">${esc(name)}${isSelf ? ` <span style="font-size:10px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted);">You</span>` : ""}</div>
          <div class="staff-role" style="color:${meta.color};">${esc(roleLabel)}</div>
          ${p.email ? `<div class="staff-email"><a href="mailto:${esc(p.email)}" style="color:inherit;text-decoration:none;">${esc(p.email)}</a></div>` : ""}
          ${phone ? `<div class="staff-email"><a href="tel:${esc(phone.replace(/[^\d+]/g, ""))}" style="color:inherit;text-decoration:none;">${esc(fmtPhone(phone))}</a></div>` : ""}
          <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;">
            ${isSelf || p.manual ? "" : `
              <button type="button" class="btn btn-secondary btn-xs" data-dm="${esc(p.id)}">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;margin-right:4px;"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>Message
              </button>`}
            ${!isSelf && p.email ? `<a class="btn btn-ghost btn-xs" href="mailto:${esc(p.email)}">Email</a>` : ""}
            ${isAdmin && p.manual ? `<button type="button" class="btn btn-ghost btn-xs" data-edit-contact>Edit</button>` : ""}
            ${isAdmin && !p.manual ? `<button type="button" class="btn btn-ghost btn-xs" data-edit-phone>${phone ? "Edit phone" : "Add phone"}</button>` : ""}
          </div>
        </div>`;
      const dmBtn = card.querySelector("[data-dm]");
      if (dmBtn) dmBtn.addEventListener("click", () => openChat(ctx, state, p));
      card.querySelector("[data-edit-contact]")?.addEventListener("click", () => openContactEditor(ctx, state, p));
      card.querySelector("[data-edit-phone]")?.addEventListener("click", () => openPhoneEditor(ctx, state, p));
      grid.appendChild(card);
    }
    mountEl.appendChild(section);
  }
}

// ─── admin: edit a teammate's phone ─────────────────────────────────────────

function openPhoneEditor(ctx, state, person) {
  const form = el("form", { style: "display:grid;gap:12px;min-width:min(380px,80vw);" });
  form.innerHTML = `
    <div style="font-size:13px;color:var(--muted);line-height:1.5;">
      Phone for <strong style="color:var(--ink);">${esc(person.name || person.email || "this person")}</strong>.
      Visible to signed-in staff only — never on the public site.
    </div>
    <label style="display:grid;gap:4px;">
      <span style="font-weight:600;font-size:13px;">Phone number</span>
      <input id="pe-phone" type="tel" value="${esc(person.phone || "")}" placeholder="+1 (555) 123-4567" autocomplete="off"
             style="padding:9px 12px;border:1px solid var(--hairline,#e5e7eb);border-radius:8px;font-size:13.5px;font-family:inherit;">
    </label>
    <div id="pe-msg" style="font-size:12.5px;color:var(--danger,#b91c1c);min-height:16px;"></div>`;

  const cancelBtn = el("button", { type: "button", class: "btn btn-secondary" }, "Cancel");
  const saveBtn = el("button", { type: "button", class: "btn btn-primary" }, "Save");
  const modal = openModal({ title: "Edit phone number", body: form, footer: [cancelBtn, saveBtn] });
  if (!modal) return;
  cancelBtn.addEventListener("click", () => modal.close());

  const save = async () => {
    const phone = form.querySelector("#pe-phone").value.trim();
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving…";
    try {
      await setDoc(doc(db, "users", person.id), { phone }, { merge: true });
      modal.close();
      ctx.toast(phone ? "Phone number saved." : "Phone number removed.", "success");
      state.reload?.();
    } catch (err) {
      form.querySelector("#pe-msg").textContent = err?.message || "Could not save.";
      saveBtn.disabled = false;
      saveBtn.textContent = "Save";
    }
  };
  saveBtn.addEventListener("click", save);
  form.addEventListener("submit", (e) => { e.preventDefault(); save(); });
  setTimeout(() => form.querySelector("#pe-phone").focus(), 0);
}

// ─── admin: add / edit a manual directory entry ─────────────────────────────
// For people who should be findable (interns, advisors, board) but don't have
// a dashboard account. Stored in directory_contacts (staff-read, admin-write).

function openContactEditor(ctx, state, contact) {
  const isEdit = !!contact;
  const form = el("form", { style: "display:grid;gap:12px;min-width:min(420px,84vw);" });
  form.innerHTML = `
    <div style="font-size:13px;color:var(--muted);line-height:1.5;">
      ${isEdit ? "Edit this directory entry." : "Add someone to the directory who doesn't have a dashboard account."}
      Contact info is visible to signed-in staff only.
    </div>
    <label style="display:grid;gap:4px;">
      <span style="font-weight:600;font-size:13px;">Full name *</span>
      <input id="ce-name" required value="${esc(contact?.name || "")}" autocomplete="off"
             style="padding:9px 12px;border:1px solid var(--hairline,#e5e7eb);border-radius:8px;font-size:13.5px;font-family:inherit;">
    </label>
    <label style="display:grid;gap:4px;">
      <span style="font-weight:600;font-size:13px;">Title / what they do</span>
      <input id="ce-title" value="${esc(contact?.title || "")}" placeholder="e.g. Faculty advisor" autocomplete="off"
             style="padding:9px 12px;border:1px solid var(--hairline,#e5e7eb);border-radius:8px;font-size:13.5px;font-family:inherit;">
    </label>
    <label style="display:grid;gap:4px;">
      <span style="font-weight:600;font-size:13px;">Section</span>
      <select id="ce-role" style="padding:9px 12px;border:1px solid var(--hairline,#e5e7eb);border-radius:8px;font-size:13.5px;font-family:inherit;background:#fff;">
        <option value="admin">Leadership</option>
        <option value="writer">Editorial</option>
        <option value="marketing">Publishing</option>
        <option value="reader">Community</option>
      </select>
    </label>
    <label style="display:grid;gap:4px;">
      <span style="font-weight:600;font-size:13px;">Email</span>
      <input id="ce-email" type="email" value="${esc(contact?.email || "")}" autocomplete="off"
             style="padding:9px 12px;border:1px solid var(--hairline,#e5e7eb);border-radius:8px;font-size:13.5px;font-family:inherit;">
    </label>
    <label style="display:grid;gap:4px;">
      <span style="font-weight:600;font-size:13px;">Phone</span>
      <input id="ce-phone" type="tel" value="${esc(contact?.phone || "")}" placeholder="+1 (555) 123-4567" autocomplete="off"
             style="padding:9px 12px;border:1px solid var(--hairline,#e5e7eb);border-radius:8px;font-size:13.5px;font-family:inherit;">
    </label>
    <div id="ce-msg" style="font-size:12.5px;color:var(--danger,#b91c1c);min-height:16px;"></div>`;
  form.querySelector("#ce-role").value = contact?.role || "writer";

  const cancelBtn = el("button", { type: "button", class: "btn btn-secondary" }, "Cancel");
  const saveBtn = el("button", { type: "button", class: "btn btn-primary" }, isEdit ? "Save changes" : "Add to directory");
  const footer = [cancelBtn, saveBtn];
  let deleteBtn = null;
  if (isEdit) {
    deleteBtn = el("button", { type: "button", class: "btn btn-ghost", style: "color:var(--danger,#b91c1c);margin-right:auto;" }, "Remove");
    footer.unshift(deleteBtn);
  }
  const modal = openModal({ title: isEdit ? "Edit directory entry" : "Add a person", body: form, footer });
  if (!modal) return;
  cancelBtn.addEventListener("click", () => modal.close());

  const save = async () => {
    const data = {
      name: form.querySelector("#ce-name").value.trim(),
      title: form.querySelector("#ce-title").value.trim(),
      role: form.querySelector("#ce-role").value,
      email: form.querySelector("#ce-email").value.trim(),
      phone: form.querySelector("#ce-phone").value.trim(),
      updatedAt: new Date().toISOString(),
      updatedById: ctx.user.uid,
    };
    if (!data.name) {
      form.querySelector("#ce-msg").textContent = "Name is required.";
      return;
    }
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving…";
    try {
      if (isEdit) {
        await setDoc(doc(db, "directory_contacts", contact.id), data, { merge: true });
      } else {
        await addDoc(collection(db, "directory_contacts"), { ...data, createdAt: new Date().toISOString() });
      }
      modal.close();
      ctx.toast(isEdit ? "Directory entry updated." : `${data.name} added to the directory.`, "success");
      state.reload?.();
    } catch (err) {
      form.querySelector("#ce-msg").textContent = err?.message || "Could not save.";
      saveBtn.disabled = false;
      saveBtn.textContent = isEdit ? "Save changes" : "Add to directory";
    }
  };
  saveBtn.addEventListener("click", save);
  form.addEventListener("submit", (e) => { e.preventDefault(); save(); });
  deleteBtn?.addEventListener("click", async () => {
    const ok = await confirmDialog(`Remove ${contact.name || "this person"} from the directory?`, { confirmText: "Remove", danger: true });
    if (!ok) return;
    try {
      await deleteDoc(doc(db, "directory_contacts", contact.id));
      modal.close();
      ctx.toast("Removed from the directory.", "success");
      state.reload?.();
    } catch (err) {
      form.querySelector("#ce-msg").textContent = err?.message || "Could not remove.";
    }
  });
  setTimeout(() => form.querySelector("#ce-name").focus(), 0);
}

// ─── Conversations list ──────────────────────────────────────────────────────

async function loadConversations(mountEl, ctx, state) {
  try {
    const snap = await getDocs(query(
      collection(db, "dm_threads"),
      where("participantIds", "array-contains", ctx.user.uid),
    ));
    // Sort client-side (array-contains + orderBy would need a composite index).
    state.threads = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  } catch (err) {
    console.warn("[directory] conversations load failed", err);
    mountEl.innerHTML = `<div class="hint">Could not load your conversations.</div>`;
    return;
  }

  if (!state.threads.length) {
    mountEl.innerHTML = `<div class="empty-state">No conversations yet. Find a teammate below and hit <strong>Message</strong> — they'll get it here and by email.</div>`;
    return;
  }

  mountEl.innerHTML = "";
  for (const t of state.threads) {
    const otherId = (t.participantIds || []).find((id) => id !== ctx.user.uid);
    const other = (t.participants && t.participants[otherId]) || {};
    const person = state.people.find((p) => p.id === otherId)
      || { id: otherId, name: other.name || "Teammate", email: other.email || "", role: other.role || "writer" };
    const last = t.lastMessage || {};
    const fromYou = last.senderId === ctx.user.uid;
    const meta = ROLE_META[person.role] || ROLE_META.reader;

    const row = el("button", {
      type: "button",
      style: "display:flex;align-items:center;gap:12px;width:100%;text-align:left;padding:10px 12px;border:0;border-top:1px solid var(--hairline,#e5e7eb);background:transparent;cursor:pointer;font:inherit;",
      onmouseenter: (e) => { e.currentTarget.style.background = "var(--surface-2,#f8fafc)"; },
      onmouseleave: (e) => { e.currentTarget.style.background = "transparent"; },
    });
    row.innerHTML = `
      <span class="staff-avatar" style="background:${meta.color};width:36px;height:36px;font-size:12px;flex-shrink:0;">${esc(getInitials(person.name || person.email || "?"))}</span>
      <span style="min-width:0;flex:1;">
        <span style="display:block;font-weight:600;font-size:13.5px;color:var(--ink);">${esc(person.name || person.email || "Teammate")}</span>
        <span style="display:block;font-size:12.5px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${fromYou ? "You: " : ""}${esc(last.text || "")}</span>
      </span>
      <span style="font-size:11.5px;color:var(--muted);white-space:nowrap;flex-shrink:0;">${esc(fmtRelative(t.updatedAt))}</span>`;
    row.addEventListener("click", () => openChat(ctx, state, person));
    mountEl.appendChild(row);
  }
}

// ─── 1:1 chat ────────────────────────────────────────────────────────────────

function threadIdFor(uidA, uidB) {
  return [uidA, uidB].sort().join("__");
}

function openChat(ctx, state, person) {
  // Only one live thread listener at a time.
  if (typeof state.unsubThread === "function") {
    try { state.unsubThread(); } catch {}
    state.unsubThread = null;
  }

  const meta = ROLE_META[person.role] || ROLE_META.reader;
  const body = el("div", { style: "display:flex;flex-direction:column;gap:0;width:min(560px,86vw);" });
  body.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;padding-bottom:12px;border-bottom:1px solid var(--hairline,#e5e7eb);">
      <span class="staff-avatar" style="background:${meta.color};width:36px;height:36px;font-size:12px;">${esc(getInitials(person.name || person.email || "?"))}</span>
      <span style="min-width:0;">
        <span style="display:block;font-weight:700;font-size:14px;color:var(--ink);">${esc(person.name || person.email || "Teammate")}</span>
        <span style="display:block;font-size:12px;color:var(--muted);">${esc(meta.label)}${person.email ? ` · ${esc(person.email)}` : ""}</span>
      </span>
    </div>
    <div id="dm-scroll" style="max-height:46vh;min-height:160px;overflow-y:auto;padding:14px 2px;display:flex;flex-direction:column;gap:8px;">
      <div class="loading-state"><div class="spinner"></div>Loading&hellip;</div>
    </div>
    <form id="dm-form" style="display:flex;gap:8px;align-items:flex-end;border-top:1px solid var(--hairline,#e5e7eb);padding-top:12px;">
      <textarea id="dm-input" rows="2" placeholder="Write a message… (they'll also get it by email)" maxlength="2000" required
                style="flex:1;resize:none;padding:10px 12px;border:1px solid var(--hairline,#e5e7eb);border-radius:12px;font-size:13.5px;font-family:inherit;line-height:1.45;"></textarea>
      <button type="submit" class="btn btn-primary btn-sm" id="dm-send" style="min-height:44px;">Send</button>
    </form>
    <div id="dm-note" style="font-size:11.5px;color:var(--muted);margin-top:6px;min-height:15px;"></div>`;

  const modal = openModal({
    title: "Private message",
    body,
    onClose: () => {
      if (typeof state.unsubThread === "function") {
        try { state.unsubThread(); } catch {}
        state.unsubThread = null;
      }
    },
  });
  if (!modal) return;

  const scrollEl = body.querySelector("#dm-scroll");
  const form = body.querySelector("#dm-form");
  const input = body.querySelector("#dm-input");
  const sendBtn = body.querySelector("#dm-send");
  const noteEl = body.querySelector("#dm-note");

  if (ctx.isPreviewing) {
    input.disabled = true;
    sendBtn.disabled = true;
    noteEl.textContent = "Messaging is disabled while previewing another account.";
  }

  const threadId = threadIdFor(ctx.user.uid, person.id);
  const ref = doc(db, "dm_threads", threadId);

  const renderMessages = (data) => {
    const msgs = Array.isArray(data?.messages) ? data.messages : [];
    if (!msgs.length) {
      scrollEl.innerHTML = `<div class="empty-state" style="padding:24px 10px;">No messages yet — say hi. ${esc(person.name || "They")} will get an email copy.</div>`;
      return;
    }
    scrollEl.innerHTML = "";
    for (const m of msgs) {
      const mine = m.senderId === ctx.user.uid;
      const bubble = el("div", {
        style: `max-width:78%;align-self:${mine ? "flex-end" : "flex-start"};` +
               `background:${mine ? "var(--accent,#0f172a)" : "var(--surface-2,#f1f5f9)"};` +
               `color:${mine ? "#fff" : "var(--ink,#111)"};` +
               `border-radius:${mine ? "14px 14px 4px 14px" : "14px 14px 14px 4px"};padding:8px 12px;`,
      });
      bubble.innerHTML = `
        <div style="font-size:13.5px;line-height:1.5;white-space:pre-wrap;word-break:break-word;">${esc(m.text || "")}</div>
        <div style="font-size:10.5px;margin-top:3px;opacity:0.65;">${esc(fmtRelative(m.at))}</div>`;
      scrollEl.appendChild(bubble);
    }
    scrollEl.scrollTop = scrollEl.scrollHeight;
  };

  state.unsubThread = onSnapshot(ref, (snap) => {
    renderMessages(snap.exists() ? snap.data() : null);
  }, (err) => {
    console.warn("[directory] thread listen failed", err);
    scrollEl.innerHTML = `<div class="error-state">Could not load this conversation. ${esc(err?.message || "")}</div>`;
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text || ctx.isPreviewing) return;

    sendBtn.disabled = true;
    sendBtn.textContent = "Sending…";
    const now = new Date().toISOString();
    const me = {
      name: ctx.profile?.name || ctx.user.email || "",
      email: ctx.profile?.email || ctx.user.email || "",
      role: ctx.role || "",
    };
    try {
      await setDoc(ref, {
        participantIds: [ctx.user.uid, person.id].sort(),
        participants: {
          [ctx.user.uid]: me,
          [person.id]: { name: person.name || "", email: person.email || "", role: person.role || "" },
        },
        updatedAt: now,
        lastMessage: { text: text.slice(0, 140), senderId: ctx.user.uid, at: now },
        messages: arrayUnion({
          senderId: ctx.user.uid,
          senderName: me.name,
          text,
          at: now,
        }),
      }, { merge: true });

      input.value = "";
      noteEl.textContent = "";

      // Email copy — best-effort; the chat itself is the source of truth.
      try {
        const res = await ctx.authedFetch("/api/notify/dm", {
          method: "POST",
          body: JSON.stringify({ toUserId: person.id, message: text }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.sent) {
          noteEl.textContent = `Sent — ${person.name || "they"} also got an email copy.`;
        } else if (res.ok && data.deduped) {
          noteEl.textContent = "Sent. (Email copy skipped — you messaged them less than a minute ago.)";
        } else {
          noteEl.textContent = "Sent in chat. (Email copy didn't go through.)";
        }
      } catch {
        noteEl.textContent = "Sent in chat. (Email copy didn't go through.)";
      }
    } catch (err) {
      console.warn("[directory] send failed", err);
      ctx.toast(`Could not send: ${err?.message || err}`, "error");
    } finally {
      sendBtn.disabled = false;
      sendBtn.textContent = "Send";
      input.focus();
    }
  });

  // Enter sends, Shift+Enter for a newline — chat muscle memory.
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });
  setTimeout(() => input.focus(), 0);
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function identityKey(person) {
  const email = String(person.email || "").trim().toLowerCase();
  if (email) return `email:${email}`;
  const name = String(person.name || "").trim().toLowerCase().replace(/\s+/g, " ");
  if (name) return `name:${name}`;
  return `id:${person.id}`;
}

// Normalize US numbers to "+1 (AAA) BBB-CCCC" for a consistent column; leave
// anything that isn't a plain 10/11-digit US number exactly as entered.
function fmtPhone(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (ten.length !== 10) return String(raw || "").trim();
  return `+1 (${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
}

function getInitials(nameOrEmail) {
  const s = String(nameOrEmail || "").trim();
  if (!s) return "?";
  if (s.includes("@")) return s[0].toUpperCase();
  const parts = s.split(/\s+/);
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
