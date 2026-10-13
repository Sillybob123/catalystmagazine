// Team & messages (#/directory): private messages with teammates and the
// team directory, in one two-pane view like Messages / Contacts.
//
//   Left:  Messages | People, with search. Conversations show unread dots.
//   Right: the open conversation, or a teammate's card (role, email, phone,
//          Message / Email / Call). On a phone the panes slide.
//
// Messages live in dm_threads/{uidA__uidB} (sorted uids); each one is also
// emailed to the recipient and drops a bell notification (/api/notify/dm,
// which links back here with ?with=<sender uid>). "Read" is per person:
// readAt.<uid> on the thread, which participants may update.
//
// Privacy: phone numbers live on users/{uid}.phone and in directory_contacts,
// both staff-read-only in firestore.rules. Admins can add people without
// accounts (directory_contacts) and edit anyone's phone.
// Styles: css/directory.css (.tm-*).

import { db } from "../firebase-config.js";
import {
  collection,
  query,
  where,
  getDocs,
  limit,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  addDoc,
  onSnapshot,
  arrayUnion,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { el, esc, openModal, confirmDialog } from "./ui.js";

const ROLE_META = {
  admin:              { label: "Admin",              group: "Leadership",      order: 1 },
  editor:             { label: "Editor",             group: "Editors",         order: 2 },
  writer:             { label: "Writer",             group: "Writers",         order: 3 },
  social_media:       { label: "Social media",       group: "Social & growth", order: 4 },
  marketing:          { label: "Marketing",          group: "Social & growth", order: 5 },
  newsletter_builder: { label: "Newsletter",         group: "Social & growth", order: 6 },
  reader:             { label: "Reader",             group: "Others",          order: 7 },
};
const GROUP_ORDER = ["Leadership", "Editors", "Writers", "Social & growth", "Others"];

const ICON = {
  search: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  back: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>',
  send: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
  chat: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z"/></svg>',
  mail: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>',
  phone: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2Z"/></svg>',
  info: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><circle cx="12" cy="7.6" r=".6" fill="currentColor"/></svg>',
  plus: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  compose: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
};

// ─── Mount ───────────────────────────────────────────────────────────────────

export async function mount(ctx, container) {
  const me = ctx.user.uid;
  const isAdmin = ctx.role === "admin";
  const startWith = new URLSearchParams((location.hash.split("?")[1] || "")).get("with");

  container.classList.add("tm-content");   // edge to edge under the top bar (the router resets the class)
  container.innerHTML = `
    <div class="tm-page"><div class="tm-shell" id="tm-shell" data-view="list">
      <aside class="tm-side" aria-label="Messages and people">
        <div class="tm-side-head">
          <div class="tm-side-top">
            <div class="tm-seg" role="tablist" aria-label="Show">
              <button type="button" role="tab" id="tm-tab-messages" aria-selected="true" data-tab="messages">Messages<span class="tm-badge" id="tm-unread" hidden></span></button>
              <button type="button" role="tab" id="tm-tab-people" aria-selected="false" data-tab="people">People</button>
            </div>
            <button type="button" class="tm-compose-btn" id="tm-new" aria-label="New message" title="New message">${ICON.compose}</button>
          </div>
          <label class="tm-search">${ICON.search}<input type="search" id="tm-q" placeholder="Search" aria-label="Search messages and people" autocomplete="off"></label>
        </div>
        <div class="tm-list" id="tm-list" role="tabpanel" aria-labelledby="tm-tab-messages"></div>
        ${isAdmin ? `<div class="tm-side-foot"><button type="button" class="tm-foot-btn" id="tm-add">${ICON.plus}Add a person without an account</button></div>` : ""}
      </aside>
      <section class="tm-main" id="tm-main"></section>
    </div></div>`;

  const shell = container.querySelector("#tm-shell");
  const listEl = container.querySelector("#tm-list");
  const mainEl = container.querySelector("#tm-main");
  const qEl = container.querySelector("#tm-q");

  const state = {
    people: [], threads: [], tab: "messages", q: "",
    selected: null,          // { kind: "chat" | "person", id }
    unsubThreads: null, unsubThread: null, threadsLoaded: false,
  };

  // ── list (left pane) ──
  const personById = (id) => state.people.find((p) => p.id === id);
  const otherIdOf = (t) => (t.participantIds || []).find((id) => id !== me);
  const personForThread = (t) => {
    const oid = otherIdOf(t);
    const o = (t.participants && t.participants[oid]) || {};
    return personById(oid) || { id: oid, name: o.name || "Teammate", email: o.email || "", role: o.role || "writer", ghost: true };
  };
  const isUnread = (t) => t.lastMessage && t.lastMessage.senderId !== me
    && String(t.readAt?.[me] || "") < String(t.lastMessage.at || t.updatedAt || "");

  function renderTabs() {
    container.querySelectorAll("[data-tab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === state.tab)));
    listEl.setAttribute("aria-labelledby", `tm-tab-${state.tab}`);
    const unread = state.threads.filter(isUnread).length;
    const badge = container.querySelector("#tm-unread");
    badge.hidden = !unread; badge.textContent = unread;
  }

  function renderList() {
    renderTabs();
    const q = state.q.trim().toLowerCase();
    if (state.tab === "messages") {
      if (!state.threadsLoaded) { listEl.innerHTML = `<div class="tm-list-note"><div class="spinner"></div></div>`; return; }
      const rows = state.threads.map((t) => ({ t, p: personForThread(t) }))
        .filter(({ t, p }) => !q || String(p.name || "").toLowerCase().includes(q) || String(t.lastMessage?.text || "").toLowerCase().includes(q));
      if (!rows.length) {
        listEl.innerHTML = q
          ? `<div class="tm-list-note">No conversations match “${esc(state.q.trim())}”.</div>`
          : `<div class="tm-empty-side"><span class="tm-empty-ic">${ICON.chat}</span><p class="tm-empty-title">No messages yet</p><p>Message anyone on the team. They get it here and by email.</p><button type="button" class="btn btn-primary btn-sm" data-new>${ICON.compose}New message</button></div>`;
        listEl.querySelector("[data-new]")?.addEventListener("click", () => select({ kind: "new" }));
        return;
      }
      listEl.innerHTML = `<ul class="tm-rows">${rows.map(({ t, p }) => {
        const last = t.lastMessage || {};
        const sel = state.selected?.kind === "chat" && state.selected.id === p.id;
        const unread = isUnread(t);
        return `<li><button type="button" class="tm-row${sel ? " is-selected" : ""}${unread ? " is-unread" : ""}" data-chat="${esc(p.id)}" ${sel ? 'aria-current="true"' : ""}>
          ${avatar(p.name || p.email, "lg")}
          <span class="tm-row-main">
            <span class="tm-row-top"><span class="tm-row-name">${esc(p.name || p.email || "Teammate")}</span><time>${esc(fmtListTime(last.at || t.updatedAt))}</time></span>
            <span class="tm-row-sub">${last.senderId === me ? "You: " : ""}${esc(last.text || "")}</span>
          </span>
          ${unread ? `<span class="tm-dot" aria-label="Unread"></span>` : ""}
        </button></li>`;
      }).join("")}</ul>`;
      listEl.querySelectorAll("[data-chat]").forEach((b) => b.addEventListener("click", () => select({ kind: "chat", id: b.dataset.chat })));
      return;
    }

    // People
    const qDigits = q.replace(/\D/g, "");
    const matches = state.people.filter((p) => {
      if (!q) return true;
      const meta = ROLE_META[p.role] || ROLE_META.reader;
      if ([p.name, p.title, meta.label].some((s) => String(s || "").toLowerCase().includes(q))) return true;
      if ((p.allEmails || [p.email]).some((e) => String(e || "").toLowerCase().includes(q))) return true;
      return !!(qDigits && String(p.phone || "").replace(/\D/g, "").includes(qDigits));
    });
    if (!matches.length) { listEl.innerHTML = `<div class="tm-list-note">No one matches “${esc(state.q.trim())}”.</div>`; return; }
    const groups = {};
    for (const p of matches) (groups[ROLE_META[p.role]?.group || "Others"] ||= []).push(p);
    const hint = state.threadsLoaded && !state.threads.length && !q
      ? `<p class="tm-hint">Tap someone to see how to reach them, or the ${ICON.chat} to message them right away.</p>` : "";
    listEl.innerHTML = hint + GROUP_ORDER.filter((g) => groups[g]?.length).map((g) => `
      <div class="tm-group">
        <h3 class="tm-group-title">${esc(g)}<span>${groups[g].length}</span></h3>
        <ul class="tm-rows">${groups[g].map((p) => {
          const sel = state.selected?.kind === "person" && state.selected.id === p.id;
          const canMsg = p.id !== me && !p.manual;
          return `<li class="tm-person-li"><button type="button" class="tm-row tm-row--person${sel ? " is-selected" : ""}${canMsg ? " has-quick" : ""}" data-person="${esc(p.id)}" ${sel ? 'aria-current="true"' : ""}>
            ${avatar(p.name || p.email)}
            <span class="tm-row-main">
              <span class="tm-row-name">${esc(p.name || p.email || "Unknown")}${p.id === me ? ` <i>(you)</i>` : ""}</span>
              <span class="tm-row-sub">${esc(roleLabel(p))}</span>
            </span>
          </button>${canMsg ? `<button type="button" class="tm-quick-msg" data-quick-msg="${esc(p.id)}" aria-label="Message ${esc(p.name || p.email || "")}" title="Message">${ICON.chat}</button>` : ""}</li>`;
        }).join("")}</ul>
      </div>`).join("");
    listEl.querySelectorAll("[data-person]").forEach((b) => b.addEventListener("click", () => select({ kind: "person", id: b.dataset.person })));
    listEl.querySelectorAll("[data-quick-msg]").forEach((b) => b.addEventListener("click", () => openChatWith(b.dataset.quickMsg)));
  }

  function setTab(tab) {
    state.tab = tab;
    renderList();
    listEl.scrollTop = 0;
  }

  // ── right pane ──
  function closeThread() {
    if (typeof state.unsubThread === "function") { try { state.unsubThread(); } catch {} }
    state.unsubThread = null;
    if (state.onVisible) document.removeEventListener("visibilitychange", state.onVisible);
    state.onVisible = null;
  }

  function select(sel, { replace = true } = {}) {
    closeThread();
    state.selected = sel;
    shell.dataset.view = sel ? "detail" : "list";
    if (replace) {
      const base = "#/directory" + (sel?.kind === "chat" ? `?with=${encodeURIComponent(sel.id)}` : "");
      try { history.replaceState(null, "", base); } catch {}
    }
    renderList();
    if (sel?.kind === "new") return renderNewMessage();
    if (!sel) return renderPlaceholder();
    const person = personById(sel.id) || (sel.kind === "chat" ? personForThread(state.threads.find((t) => otherIdOf(t) === sel.id) || { participantIds: [me, sel.id] }) : null);
    if (!person) return renderPlaceholder();
    if (sel.kind === "chat") renderChat(person); else renderPerson(person);
  }

  // Open (or start) the conversation with someone.
  function openChatWith(id) {
    state.tab = "messages";
    select({ kind: "chat", id });
  }

  // Nothing open: on a wide screen show the "new message" picker, so anyone
  // can reach a teammate in one step.
  function renderPlaceholder() {
    if (matchMedia("(min-width: 820px)").matches || !state.threads.length) return renderNewMessage({ welcome: !state.threads.length });
    mainEl.innerHTML = "";
  }

  // New message: a "To:" search over the whole team, then the people as
  // tappable cards, grouped by team. Enter opens the first match.
  function renderNewMessage({ welcome = false } = {}) {
    const reachable = state.people.filter((p) => p.id !== me && !p.manual);
    mainEl.innerHTML = `
      <header class="tm-chat-head tm-new-head">
        ${backBtn()}
        <h2 class="tm-new-title">${welcome ? "Message anyone on the team" : "New message"}</h2>
      </header>
      <div class="tm-to">
        <label class="tm-to-field"><span>To:</span><input type="search" id="tm-to" placeholder="Name, role or email" autocomplete="off" aria-label="Who do you want to message?" aria-controls="tm-to-results"></label>
      </div>
      <div class="tm-new-body" id="tm-to-results"></div>`;
    wireBack();
    const input = mainEl.querySelector("#tm-to");
    const results = mainEl.querySelector("#tm-to-results");
    const draw = () => {
      const q = input.value.trim().toLowerCase();
      const list = reachable.filter((p) => !q
        || String(p.name || "").toLowerCase().includes(q)
        || roleLabel(p).toLowerCase().includes(q)
        || (p.allEmails || [p.email]).some((e) => String(e || "").toLowerCase().includes(q)));
      if (!list.length) { results.innerHTML = `<div class="tm-list-note">No one on the team matches “${esc(input.value.trim())}”.</div>`; return; }
      const groups = {};
      for (const p of list) (groups[ROLE_META[p.role]?.group || "Others"] ||= []).push(p);
      results.innerHTML = (welcome && !q ? `<p class="tm-new-lede">Pick someone to start a conversation. They'll see it here and get it by email, so it's a quick way to ask a question or check in.</p>` : "")
        + GROUP_ORDER.filter((g) => groups[g]?.length).map((g) => `
        <section class="tm-pick-group">
          <h3 class="tm-group-title">${esc(g)}<span>${groups[g].length}</span></h3>
          <div class="tm-pick-grid">${groups[g].map((p) => `
            <button type="button" class="tm-pick-card" data-pick="${esc(p.id)}">
              ${avatar(p.name || p.email, "lg")}
              <span class="tm-pick-text"><b>${esc(p.name || p.email)}</b><small>${esc(roleLabel(p))}</small></span>
              <span class="tm-pick-go" aria-hidden="true">${ICON.chat}</span>
            </button>`).join("")}</div>
        </section>`).join("");
      results.querySelectorAll("[data-pick]").forEach((b) => b.addEventListener("click", () => openChatWith(b.dataset.pick)));
    };
    input.addEventListener("input", draw);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); results.querySelector("[data-pick]")?.click(); }
    });
    draw();
    if (matchMedia("(min-width: 820px)").matches || !welcome) setTimeout(() => input.focus(), 0);
  }

  const backBtn = () => `<button type="button" class="tm-back" data-back aria-label="Back">${ICON.back}<span>${state.tab === "people" ? "People" : "Messages"}</span></button>`;
  const wireBack = () => mainEl.querySelector("[data-back]")?.addEventListener("click", () => select(null));

  // A teammate's card.
  function renderPerson(p) {
    const name = p.name || p.email || "Unknown";
    const isSelf = p.id === me;
    const phone = String(p.phone || "").trim();
    const emails = (p.allEmails && p.allEmails.length) ? p.allEmails : (p.email ? [p.email] : []);
    const canMessage = !isSelf && !p.manual && !p.ghost;
    mainEl.innerHTML = `
      <div class="tm-detail-bar">${backBtn()}</div>
      <div class="tm-card">
        ${avatar(name, "xl")}
        <h2 class="tm-card-name">${esc(name)}${isSelf ? ` <i>(you)</i>` : ""}</h2>
        <p class="tm-card-role">${esc(roleLabel(p))}</p>
        <div class="tm-actions">
          ${canMessage ? `<button type="button" class="tm-action" data-msg>${ICON.chat}<span>Message</span></button>` : ""}
          ${!isSelf && emails[0] ? `<a class="tm-action" href="mailto:${esc(emails[0])}">${ICON.mail}<span>Email</span></a>` : ""}
          ${!isSelf && phone ? `<a class="tm-action" href="tel:${esc(phone.replace(/[^\d+]/g, ""))}">${ICON.phone}<span>Call</span></a>` : ""}
        </div>
        <dl class="tm-facts">
          ${emails.map((e, i) => `<div><dt>${i ? "Other email" : "Email"}</dt><dd><a href="mailto:${esc(e)}">${esc(e)}</a></dd></div>`).join("")}
          <div><dt>Phone</dt><dd>${phone ? `<a href="tel:${esc(phone.replace(/[^\d+]/g, ""))}">${esc(fmtPhone(phone))}</a>` : `<span class="tm-muted">Not added</span>`}${isAdmin && !p.manual ? ` <button type="button" class="tm-link" data-edit-phone>${phone ? "Edit" : "Add"}</button>` : ""}</dd></div>
          <div><dt>Role</dt><dd>${esc(roleLabel(p))}${p.manual ? ` <span class="tm-muted">· no Suite account</span>` : ""}</dd></div>
        </dl>
        ${isAdmin && p.manual ? `<button type="button" class="btn btn-secondary btn-sm" data-edit-contact>Edit this entry</button>` : ""}
        <p class="tm-privacy">Contact details are only visible to signed-in staff.</p>
      </div>`;
    wireBack();
    mainEl.querySelector("[data-msg]")?.addEventListener("click", () => openChatWith(p.id));
    mainEl.querySelector("[data-edit-phone]")?.addEventListener("click", () => openPhoneEditor(ctx, state, p));
    mainEl.querySelector("[data-edit-contact]")?.addEventListener("click", () => openContactEditor(ctx, state, p));
  }

  // A conversation.
  function renderChat(person) {
    const name = person.name || person.email || "Teammate";
    const first = String(name).split(/\s+/)[0];
    mainEl.innerHTML = `
      <header class="tm-chat-head">
        ${backBtn()}
        <button type="button" class="tm-chat-who" data-info title="View contact card">
          ${avatar(name)}
          <span><b>${esc(name)}</b><small>${esc(roleLabel(person))}</small></span>
        </button>
        ${person.ghost ? "" : `<button type="button" class="tm-icon-btn" data-info aria-label="Contact card">${ICON.info}</button>`}
      </header>
      <div class="tm-thread" id="tm-thread" tabindex="0" aria-label="Conversation with ${esc(name)}"><div class="tm-list-note"><div class="spinner"></div></div></div>
      <form class="tm-compose" id="tm-compose">
        <label class="tm-compose-box">
          <textarea id="tm-input" rows="1" maxlength="2000" placeholder="Message ${esc(first)}" aria-label="Message ${esc(name)}"></textarea>
        </label>
        <button type="submit" class="tm-send" id="tm-send" aria-label="Send" disabled>${ICON.send}</button>
      </form>
      <p class="tm-compose-note" id="tm-note">Enter to send · Shift+Enter for a new line · ${esc(first)} also gets it by email</p>`;
    wireBack();
    mainEl.querySelectorAll("[data-info]").forEach((b) => b.addEventListener("click", () => { if (!person.ghost) select({ kind: "person", id: person.id }); }));

    const scrollEl = mainEl.querySelector("#tm-thread");
    const form = mainEl.querySelector("#tm-compose");
    const input = mainEl.querySelector("#tm-input");
    const sendBtn = mainEl.querySelector("#tm-send");
    const noteEl = mainEl.querySelector("#tm-note");
    if (ctx.isPreviewing || person.ghost) {
      input.disabled = true;
      noteEl.textContent = ctx.isPreviewing ? "Messaging is off while you preview another account." : "This person is no longer on the team.";
    }

    const ref = doc(db, "dm_threads", threadIdFor(me, person.id));
    let markedAt = "";
    const markRead = (data) => {
      const at = data?.lastMessage?.at || data?.updatedAt;
      if (!data || !at || ctx.isPreviewing || data.lastMessage?.senderId === me) return;
      if (String(data.readAt?.[me] || "") >= String(at) || markedAt === at) return;
      markedAt = at;
      updateDoc(ref, { [`readAt.${me}`]: new Date().toISOString() }).catch(() => {});
    };

    let lastData = null;
    state.onVisible = () => { if (document.visibilityState === "visible") markRead(lastData); };
    document.addEventListener("visibilitychange", state.onVisible);
    state.unsubThread = onSnapshot(ref, (snap) => {
      const data = snap.exists() ? snap.data() : null;
      lastData = data;
      renderMessages(scrollEl, data, person, me);
      if (document.visibilityState === "visible") markRead(data);
    }, (err) => {
      console.warn("[directory] thread listen failed", err);
      scrollEl.innerHTML = `<div class="tm-list-note">Couldn't load this conversation. ${esc(err?.message || "")}</div>`;
    });

    const grow = () => { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 140) + "px"; sendBtn.disabled = !input.value.trim() || input.disabled; };
    input.addEventListener("input", grow);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); }
    });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text || input.disabled) return;
      sendBtn.disabled = true;
      input.value = ""; grow();
      const now = new Date().toISOString();
      const mine = { name: ctx.profile?.name || ctx.user.email || "", email: ctx.profile?.email || ctx.user.email || "", role: ctx.role || "" };
      try {
        await setDoc(ref, {
          participantIds: [me, person.id].sort(),
          participants: { [me]: mine, [person.id]: { name: person.name || "", email: person.email || "", role: person.role || "" } },
          updatedAt: now,
          lastMessage: { text: text.slice(0, 140), senderId: me, at: now },
          readAt: { [me]: now },
          messages: arrayUnion({ senderId: me, senderName: mine.name, text, at: now }),
        }, { merge: true });
        noteEl.textContent = "Sending…";
        // Email copy + bell: best-effort, the chat is the source of truth.
        try {
          const res = await ctx.authedFetch("/api/notify/dm", { method: "POST", body: JSON.stringify({ toUserId: person.id, message: text }) });
          const data = await res.json().catch(() => ({}));
          noteEl.textContent = res.ok && data.sent ? `Delivered · ${first} also got an email`
            : res.ok && data.deduped ? "Delivered · email skipped (you wrote them under a minute ago)"
            : "Delivered here · the email copy didn't go through";
        } catch { noteEl.textContent = "Delivered here · the email copy didn't go through"; }
      } catch (err) {
        console.warn("[directory] send failed", err);
        input.value = text; grow();
        noteEl.textContent = `Not sent: ${err?.message || err}`;
        ctx.toast?.("Message not sent. Try again.", "error");
      } finally {
        input.focus();
      }
    });
    setTimeout(() => { if (matchMedia("(min-width: 820px)").matches) input.focus(); }, 0);
  }

  // ── data ──
  state.reload = async (keepId) => {
    try {
      state.people = await loadPeople();
    } catch (err) {
      console.warn("[directory] load failed", err);
      listEl.innerHTML = `<div class="tm-list-note">Couldn't load the team. ${esc(err?.message || "")}</div>`;
      return;
    }
    renderList();
    if (keepId && state.selected?.id === keepId) select(state.selected);
  };

  container.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => setTab(b.dataset.tab)));
  qEl.addEventListener("input", () => { state.q = qEl.value; renderList(); });
  container.querySelector("#tm-add")?.addEventListener("click", () => openContactEditor(ctx, state, null));
  container.querySelector("#tm-new").addEventListener("click", () => select({ kind: "new" }));

  await state.reload();

  state.unsubThreads = onSnapshot(query(collection(db, "dm_threads"), where("participantIds", "array-contains", me)), (snap) => {
    state.threads = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      // Hide conversations with removed team members (see formerTeamOf).
      .filter((t) => {
        const oid = otherIdOf(t);
        const o = (t.participants && t.participants[oid]) || {};
        return !isFormer({ id: oid, name: o.name, email: o.email });
      })
      .sort((a, b) => String(b.lastMessage?.at || b.updatedAt || "").localeCompare(String(a.lastMessage?.at || a.updatedAt || "")));
    const first = !state.threadsLoaded;
    state.threadsLoaded = true;
    renderList();
    if (first) {
      if (startWith) select({ kind: "chat", id: startWith }, { replace: false });
      else if (!state.threads.length) { state.tab = "people"; renderList(); renderNewMessage({ welcome: true }); }
      else if (matchMedia("(min-width: 820px)").matches) select({ kind: "chat", id: otherIdOf(state.threads[0]) });
      else renderPlaceholder();
    }
  }, (err) => {
    console.warn("[directory] conversations failed", err);
    state.threadsLoaded = true;
    listEl.innerHTML = `<div class="tm-list-note">Couldn't load your messages.</div>`;
  });

  return () => {
    closeThread();
    if (typeof state.unsubThreads === "function") { try { state.unsubThreads(); } catch {} }
  };
}

// ─── Rendering helpers ───────────────────────────────────────────────────────

function roleLabel(p) {
  if (p.title) return p.title;
  return (ROLE_META[p.role] || ROLE_META.reader).label;
}

function avatarColor(str) {
  let h = 0;
  for (const ch of String(str || "")) h = ch.charCodeAt(0) + ((h << 5) - h);
  return `hsl(${Math.abs(h) % 360}, 30%, 46%)`;
}
function avatar(name, size = "") {
  return `<span class="tm-av${size ? " tm-av--" + size : ""}" style="--av:${avatarColor(name)}" aria-hidden="true">${esc(getInitials(name))}</span>`;
}

const dayKey = (iso) => { const d = new Date(iso); return isNaN(d) ? "" : `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
function fmtClock(iso) {
  const d = new Date(iso);
  return isNaN(d) ? "" : d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}
function fmtDay(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "";
  const t = new Date(); t.setHours(0, 0, 0, 0);
  const x = new Date(d); x.setHours(0, 0, 0, 0);
  const diff = Math.round((t - x) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff < 7) return d.toLocaleDateString(undefined, { weekday: "long" });
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", ...(d.getFullYear() !== t.getFullYear() ? { year: "numeric" } : {}) });
}
function fmtListTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return "";
  const day = fmtDay(iso);
  if (day === "Today") return fmtClock(iso);
  if (day === "Yesterday") return "Yesterday";
  const diff = (Date.now() - d.getTime()) / 86400000;
  if (diff < 7) return d.toLocaleDateString(undefined, { weekday: "short" });
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// Messages, grouped like Messages: a day label when the day changes, bubbles
// from the same person within five minutes stacked, the time under the last.
function renderMessages(scrollEl, data, person, me) {
  const msgs = (Array.isArray(data?.messages) ? data.messages : []).slice().sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const first = String(person.name || "They").split(/\s+/)[0];
  if (!msgs.length) {
    scrollEl.innerHTML = `<div class="tm-thread-empty">${avatar(person.name || person.email, "xl")}<p class="tm-empty-title">${esc(person.name || person.email || "Teammate")}</p><p>${esc(roleLabel(person))}</p><p class="tm-muted">No messages yet. Say hello; ${esc(first)} also gets it by email.</p></div>`;
    return;
  }
  const atBottom = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight < 80;
  const readByThem = String(data?.readAt?.[person.id] || "");
  let html = "", prevDay = "", prev = null;
  msgs.forEach((m, i) => {
    const mine = m.senderId === me;
    const day = dayKey(m.at);
    if (day !== prevDay) { html += `<div class="tm-day"><span>${esc(fmtDay(m.at))}</span></div>`; prev = null; prevDay = day; }
    const next = msgs[i + 1];
    const near = (a, b) => a && b && a.senderId === b.senderId && dayKey(a.at) === dayKey(b.at) && Math.abs(new Date(b.at) - new Date(a.at)) < 5 * 60000;
    const startsGroup = !near(prev, m);
    const endsGroup = !near(m, next);
    const isLastMine = mine && !msgs.slice(i + 1).some((x) => x.senderId === me);
    html += `<div class="tm-msg ${mine ? "is-mine" : "is-theirs"}${startsGroup ? " is-start" : ""}${endsGroup ? " is-end" : ""}">
      <div class="tm-bubble" title="${esc(fmtDay(m.at) + " " + fmtClock(m.at))}">${esc(m.text || "")}</div>
      ${endsGroup ? `<span class="tm-time">${esc(fmtClock(m.at))}${isLastMine && readByThem >= String(m.at) ? " · Read" : ""}</span>` : ""}
    </div>`;
    prev = m;
  });
  scrollEl.innerHTML = html;
  if (atBottom || !scrollEl.dataset.ready) scrollEl.scrollTop = scrollEl.scrollHeight;
  scrollEl.dataset.ready = "1";
}

function threadIdFor(uidA, uidB) {
  return [uidA, uidB].sort().join("__");
}

// ─── Team list ───────────────────────────────────────────────────────────────

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
  // Removed team members (every account of theirs set back to Reader in
  // Users & roles) disappear from Team & messages entirely: no card, no
  // hand-added contact under the same name/email, no old conversations.
  // Their stories stay. Same rule as isFormerTeamMember in the bot.
  formerTeam = formerTeamOf(raw);
  if (contactsSnap) {
    contactsSnap.forEach((d) => {
      const c = d.data();
      if (isFormer({ ...c, id: d.id })) return;
      // Manual contacts lose to a real user doc with the same email in the
      // dedupe below (order 98 > any real role) — so when someone admins
      // added by hand later gets an account, the account card wins.
      raw.push({ ...c, id: d.id, role: c.role || "writer", manual: true });
    });
  }

  // Seed each record with the full set of emails declared on its own doc:
  // primary + admin-managed extraEmails + any legacy emails[]/altEmail.
  for (const p of raw) p.allEmails = emailsOf(p);

  const byKey = new Map();
  const orderOf = (p) => (p.manual ? 98 : (ROLE_META[p.role]?.order ?? 99));
  const mergeEmails = (a, b) => {
    const seen = new Set();
    const out = [];
    for (const e of [...(a || []), ...(b || [])]) {
      const k = String(e || "").trim().toLowerCase();
      if (k && !seen.has(k)) { seen.add(k); out.push(String(e).trim()); }
    }
    return out;
  };
  for (const p of raw) {
    const key = identityKey(p);
    const existing = byKey.get(key);
    if (!existing) { byKey.set(key, p); continue; }
    const ao = orderOf(p);
    const bo = orderOf(existing);
    // Whoever wins, the merged record carries every email + the phone from
    // either doc, so duplicate accounts surface one complete contact card.
    const allEmails = mergeEmails(existing.allEmails, p.allEmails);
    if (ao < bo) {
      byKey.set(key, { ...existing, ...p, id: p.id, role: p.role, manual: p.manual, phone: p.phone || existing.phone, allEmails });
    } else {
      byKey.set(key, {
        ...existing,
        name: existing.name || p.name,
        email: existing.email || p.email,
        phone: existing.phone || p.phone,
        allEmails,
      });
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


// ─── admin: edit a teammate's phone ─────────────────────────────────────────

function openPhoneEditor(ctx, state, person) {
  const form = el("form", { style: "display:grid;gap:12px;min-width:min(380px,80vw);" });
  form.innerHTML = `
    <div style="font-size:13px;color:var(--muted);line-height:1.5;">
      Phone for <strong style="color:var(--ink);">${esc(person.name || person.email || "this person")}</strong>.
      Visible to signed-in staff only — never on the public site.
    </div>
    <label class="field" style="margin:0;">
      <span class="label">Phone number</span>
      <input id="pe-phone" type="tel" value="${esc(person.phone || "")}" placeholder="+1 (555) 123-4567" autocomplete="off"
             class="input">
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
      state.reload?.(person.id);
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
    <label class="field" style="margin:0;">
      <span class="label">Full name *</span>
      <input id="ce-name" required value="${esc(contact?.name || "")}" autocomplete="off"
             class="input">
    </label>
    <label class="field" style="margin:0;">
      <span class="label">Title / what they do</span>
      <input id="ce-title" value="${esc(contact?.title || "")}" placeholder="e.g. Faculty advisor" autocomplete="off"
             class="input">
    </label>
    <label class="field" style="margin:0;">
      <span class="label">Section</span>
      <select id="ce-role" class="select">
        <option value="admin">Leadership</option>
        <option value="writer">Editorial</option>
        <option value="marketing">Publishing</option>
        <option value="reader">Community</option>
      </select>
    </label>
    <label class="field" style="margin:0;">
      <span class="label">Email</span>
      <input id="ce-email" type="email" value="${esc(contact?.email || "")}" autocomplete="off"
             class="input">
    </label>
    <label class="field" style="margin:0;">
      <span class="label">Phone</span>
      <input id="ce-phone" type="tel" value="${esc(contact?.phone || "")}" placeholder="+1 (555) 123-4567" autocomplete="off"
             class="input">
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
      state.reload?.(contact?.id);
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
      state.reload?.(contact?.id);
    } catch (err) {
      form.querySelector("#ce-msg").textContent = err?.message || "Could not remove.";
    }
  });
  setTimeout(() => form.querySelector("#ce-name").focus(), 0);
}

// ─── helpers ─────────────────────────────────────────────────────────────────

// Identities (uids, emails, names) of people with no staff account left.
let formerTeam = { ids: new Set(), keys: new Set() };
function identityKeys(p) {
  const keys = emailsOf(p).map((e) => `email:${e.toLowerCase()}`);
  const name = String(p.name || "").trim().toLowerCase().replace(/\s+/g, " ");
  if (name) keys.push(`name:${name}`);
  return keys;
}
function formerTeamOf(users) {
  const staff = new Set(), ids = new Set(), keys = new Set();
  for (const u of users) if (u.role !== "reader") identityKeys(u).forEach((k) => staff.add(k));
  for (const u of users) {
    if (u.role !== "reader") continue;
    const k = identityKeys(u);
    if (k.some((x) => staff.has(x))) continue;   // also has a staff account: still on the team
    ids.add(u.id); k.forEach((x) => keys.add(x));
  }
  return { ids, keys };
}
function isFormer(p) {
  return formerTeam.ids.has(p.id) || identityKeys(p).some((k) => formerTeam.keys.has(k));
}

function identityKey(person) {
  const email = String(person.email || "").trim().toLowerCase();
  if (email) return `email:${email}`;
  const name = String(person.name || "").trim().toLowerCase().replace(/\s+/g, " ");
  if (name) return `name:${name}`;
  return `id:${person.id}`;
}

// All emails declared on one user/contact doc, de-duplicated and ordered with
// the primary first. Honors the admin-managed extraEmails list plus any
// legacy emails[]/altEmail fields.
function emailsOf(p) {
  const seen = new Set();
  const out = [];
  const add = (v) => {
    const e = String(v || "").trim();
    const k = e.toLowerCase();
    if (e && e.includes("@") && !seen.has(k)) { seen.add(k); out.push(e); }
  };
  add(p.email);
  if (Array.isArray(p.extraEmails)) p.extraEmails.forEach(add);
  if (Array.isArray(p.emails)) p.emails.forEach(add);
  add(p.altEmail);
  return out;
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
