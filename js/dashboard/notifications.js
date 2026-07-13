// js/dashboard/notifications.js
//
// The topbar notification bell + inbox panel. Live-listens to the current
// user's `notifications` docs (written server-side by the /api/notify/*
// endpoints) and shows an unread badge that updates in real time. Clicking a
// notification marks it read and jumps to the relevant dashboard page.
//
// Initialized ONCE at boot from app.js (next to initPresencePing) — not per
// route — so the listener persists across navigation.

import { db } from "../firebase-config.js";
import {
  collection, query, where, limit, onSnapshot, doc, updateDoc, writeBatch,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { esc, fmtRelative } from "./ui.js";

// Newest-first sort done client-side so we don't need a composite Firestore
// index (recipientId == … + orderBy createdAt). 50 is plenty for a bell.
const MAX = 50;

// getCtx() returns the live context each call so navigation respects the
// current preview state (admin previewing a teammate, etc.).
export function initNotificationBell(ctx, getCtx) {
  const bell = document.getElementById("notif-bell");
  const badge = document.getElementById("notif-badge");
  if (!bell || !badge || !ctx?.user?.uid) return () => {};

  let items = [];
  let panel = null;

  // ---- real-time listener ----
  const q = query(
    collection(db, "notifications"),
    where("recipientId", "==", ctx.user.uid),
    limit(MAX),
  );
  const unsub = onSnapshot(
    q,
    (snap) => {
      items = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
      paintBadge();
      if (panel) renderPanel(); // keep an open panel live
    },
    (err) => console.warn("[notifications] listen failed:", err?.message || err),
  );

  // Cleared notifications stay in Firestore (deleting them would break the
  // server's dedupe — a bot reminder with the same dedupeId would come back)
  // but disappear from the bell entirely.
  function visibleItems() {
    return items.filter((n) => !n.cleared);
  }

  function unreadCount() {
    return visibleItems().filter((n) => !n.read).length;
  }

  function paintBadge() {
    const n = unreadCount();
    if (n > 0) {
      badge.textContent = n > 9 ? "9+" : String(n);
      badge.hidden = false;
      bell.classList.add("has-unread");
    } else {
      badge.hidden = true;
      bell.classList.remove("has-unread");
    }
  }

  // ---- panel (dropdown) ----
  function openPanel() {
    if (panel) return closePanel();
    panel = document.createElement("div");
    panel.className = "notif-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Notifications");
    document.body.appendChild(panel);
    renderPanel();
    positionPanel();
    bell.setAttribute("aria-expanded", "true");
    // Close on outside click / Escape.
    setTimeout(() => {
      document.addEventListener("mousedown", onOutside);
      document.addEventListener("keydown", onKey);
      window.addEventListener("resize", positionPanel);
    }, 0);
  }

  function closePanel() {
    if (!panel) return;
    panel.remove();
    panel = null;
    bell.setAttribute("aria-expanded", "false");
    document.removeEventListener("mousedown", onOutside);
    document.removeEventListener("keydown", onKey);
    window.removeEventListener("resize", positionPanel);
  }

  function onOutside(e) {
    if (panel && !panel.contains(e.target) && !bell.contains(e.target)) closePanel();
  }
  function onKey(e) { if (e.key === "Escape") closePanel(); }

  function positionPanel() {
    if (!panel) return;
    const r = bell.getBoundingClientRect();
    // Anchor under the bell, right-aligned, clamped to the viewport.
    const width = Math.min(380, window.innerWidth - 24);
    let right = Math.max(12, window.innerWidth - r.right);
    panel.style.width = width + "px";
    panel.style.top = `${r.bottom + 8}px`;
    panel.style.right = `${right}px`;
  }

  function renderPanel() {
    if (!panel) return;
    const visible = visibleItems();
    const hasUnread = unreadCount() > 0;
    const header = `
      <div class="notif-panel-head">
        <span class="notif-panel-title">Notifications</span>
        <span class="notif-panel-actions">
          ${hasUnread ? `<button type="button" class="notif-markall" id="notif-markall">Mark all read</button>` : ""}
          ${visible.length ? `<button type="button" class="notif-markall notif-clearall" id="notif-clearall" title="Remove every notification from this list">Clear all</button>` : ""}
        </span>
      </div>`;

    let listHtml;
    if (!visible.length) {
      listHtml = `<div class="notif-empty">You're all caught up.</div>`;
    } else {
      listHtml = `<ul class="notif-list">` + visible.map((n) => `
        <li class="notif-item ${n.read ? "" : "is-unread"}" data-id="${esc(n.id)}" tabindex="0" role="button">
          <span class="notif-dot" aria-hidden="true"></span>
          <span class="notif-text">
            <span class="notif-title">${esc(n.title || "Notification")}</span>
            ${n.body ? `<span class="notif-body">${esc(n.body)}</span>` : ""}
            <span class="notif-time">${esc(fmtRelative(n.createdAt) || "")}</span>
          </span>
        </li>`).join("") + `</ul>`;
    }
    panel.innerHTML = header + listHtml;

    const markAll = panel.querySelector("#notif-markall");
    if (markAll) markAll.addEventListener("click", markAllRead);
    const clearAll = panel.querySelector("#notif-clearall");
    if (clearAll) clearAll.addEventListener("click", clearAllNotifs);
    panel.querySelectorAll(".notif-item").forEach((li) => {
      const act = () => onItemClick(li.dataset.id);
      li.addEventListener("click", act);
      li.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); act(); }
      });
    });
  }

  async function onItemClick(id) {
    const n = items.find((x) => x.id === id);
    if (!n) return;
    if (!n.read) markRead(id); // fire-and-forget; listener will refresh
    closePanel();
    const hash = n.actionHash || "";
    const navigate = (getCtx && getCtx().navigate) || ctx.navigate;
    if (hash && typeof navigate === "function") navigate(hash);
  }

  async function markRead(id) {
    try {
      await updateDoc(doc(db, "notifications", id), {
        read: true,
        readAt: new Date().toISOString(),
      });
    } catch (err) {
      console.warn("[notifications] markRead failed:", err?.message || err);
    }
  }

  async function markAllRead() {
    const unread = visibleItems().filter((n) => !n.read);
    if (!unread.length) return;
    try {
      const batch = writeBatch(db);
      const now = new Date().toISOString();
      unread.forEach((n) => batch.update(doc(db, "notifications", n.id), { read: true, readAt: now }));
      await batch.commit();
    } catch (err) {
      console.warn("[notifications] markAllRead failed:", err?.message || err);
    }
  }

  // Empties the inbox: everything currently listed is marked read + cleared
  // (a soft flag — the docs stay for server-side dedupe, they just never show
  // in the bell again). Optimistic so the panel empties instantly.
  async function clearAllNotifs() {
    const visible = visibleItems();
    if (!visible.length) return;
    const now = new Date().toISOString();
    visible.forEach((n) => { n.cleared = true; if (!n.read) n.read = true; });
    paintBadge();
    renderPanel();
    try {
      const batch = writeBatch(db);
      visible.forEach((n) => batch.update(doc(db, "notifications", n.id), {
        read: true, readAt: n.readAt || now, cleared: true, clearedAt: now,
      }));
      await batch.commit();
    } catch (err) {
      console.warn("[notifications] clearAll failed:", err?.message || err);
    }
  }

  bell.addEventListener("click", openPanel);
  paintBadge();

  // Cleanup fn (mostly for completeness; the bell lives for the whole session).
  return () => { unsub(); closePanel(); };
}
