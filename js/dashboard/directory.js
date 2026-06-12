// Team directory — everyone on staff with their role + email, searchable,
// plus private messaging: click "Message" to open a 1:1 chat thread that
// lives in Firestore (dm_threads) and emails the recipient a copy of each
// message (POST /api/notify/dm) so nothing gets missed.

import { db } from "../firebase-config.js";
import {
  collection,
  query,
  where,
  getDocs,
  limit,
  doc,
  setDoc,
  onSnapshot,
  arrayUnion,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { el, esc, fmtRelative, openModal } from "./ui.js";

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
  const card = el("div", { class: "card", style: { marginTop: "20px" } });
  card.innerHTML = `
    <div class="card-header" style="flex-wrap:wrap;gap:12px;">
      <div>
        <div class="card-title">Team directory</div>
        <div class="card-subtitle">Everyone on staff — who they are, what they do, and how to reach them</div>
      </div>
      <input id="dir-search" type="search" placeholder="Search by name, role, or email…" autocomplete="off"
             style="padding:9px 14px;border:1px solid var(--hairline,#e5e7eb);border-radius:999px;font-size:13px;font-family:inherit;min-width:min(280px,100%);">
    </div>
    <div class="card-body" id="dir-body"><div class="loading-state"><div class="spinner"></div>Loading&hellip;</div></div>`;
  container.appendChild(card);

  const state = { people: [], threads: [], unsubThread: null };

  try {
    state.people = await loadPeople();
  } catch (err) {
    console.warn("[directory] load failed", err);
    card.querySelector("#dir-body").innerHTML =
      `<div class="error-state">Could not load the team. ${esc(err?.message || "")}</div>`;
    return;
  }

  const searchEl = card.querySelector("#dir-search");
  const renderGrid = () => renderDirectory(card.querySelector("#dir-body"), ctx, state, searchEl.value);
  searchEl.addEventListener("input", renderGrid);
  renderGrid();

  loadConversations(convos.querySelector("#dir-convos"), ctx, state);

  return () => {
    if (typeof state.unsubThread === "function") {
      try { state.unsubThread(); } catch {}
      state.unsubThread = null;
    }
  };
}

async function loadPeople() {
  const snap = await getDocs(query(collection(db, "users"), limit(200)));

  // Dedupe — a person can have two user docs (a reader doc from a newsletter
  // signup plus a staff doc); keep the doc with the highest-priority role.
  const raw = [];
  snap.forEach((d) => {
    const u = d.data();
    if ((u.status || "active") === "inactive") return;
    raw.push({ ...u, id: d.id, role: u.role || "reader" });
  });

  const byKey = new Map();
  for (const p of raw) {
    const key = identityKey(p);
    const existing = byKey.get(key);
    if (!existing) { byKey.set(key, p); continue; }
    const ao = ROLE_META[p.role]?.order ?? 99;
    const bo = ROLE_META[existing.role]?.order ?? 99;
    if (ao < bo) byKey.set(key, { ...existing, ...p, id: p.id, role: p.role });
    else if (ao === bo) {
      byKey.set(key, { ...existing, name: existing.name || p.name, email: existing.email || p.email });
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
  const matches = state.people.filter((p) => {
    if (!q) return true;
    const meta = ROLE_META[p.role] || ROLE_META.reader;
    return [p.name, p.email, meta.label].some((s) => String(s || "").toLowerCase().includes(q));
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
      const name = p.name || p.email || "Unknown";
      const isSelf = p.id === ctx.user.uid;
      const card = el("div", { class: "staff-card" });
      card.innerHTML = `
        <div class="staff-avatar" style="background:${meta.color};">${esc(getInitials(name))}</div>
        <div class="staff-info" style="min-width:0;">
          <div class="staff-name">${esc(name)}${isSelf ? ` <span style="font-size:10px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted);">You</span>` : ""}</div>
          <div class="staff-role" style="color:${meta.color};">${esc(meta.label)}</div>
          ${p.email ? `<div class="staff-email"><a href="mailto:${esc(p.email)}" style="color:inherit;text-decoration:none;">${esc(p.email)}</a></div>` : ""}
          ${isSelf ? "" : `
            <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;">
              <button type="button" class="btn btn-secondary btn-xs" data-dm="${esc(p.id)}">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;margin-right:4px;"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>Message
              </button>
              ${p.email ? `<a class="btn btn-ghost btn-xs" href="mailto:${esc(p.email)}">Email</a>` : ""}
            </div>`}
        </div>`;
      const dmBtn = card.querySelector("[data-dm]");
      if (dmBtn) dmBtn.addEventListener("click", () => openChat(ctx, state, p));
      grid.appendChild(card);
    }
    mountEl.appendChild(section);
  }
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

function getInitials(nameOrEmail) {
  const s = String(nameOrEmail || "").trim();
  if (!s) return "?";
  if (s.includes("@")) return s[0].toUpperCase();
  const parts = s.split(/\s+/);
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
