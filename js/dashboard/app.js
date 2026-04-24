// js/dashboard/app.js
// The unified dashboard brain. Handles:
//   - Firebase auth gate
//   - Role detection (reads users/{uid})
//   - Sidebar + top-bar rendering based on role
//   - Hash-based routing (#/writer, #/editor, ...) that mounts modules on demand
//   - Presence ping + sign-out
//
// Add new modules by extending the ROUTES map at the bottom.

import { auth, db } from "../firebase-config.js";
import {
  onAuthStateChanged, signOut, getIdToken,
  EmailAuthProvider, reauthenticateWithCredential,
  updatePassword, sendPasswordResetEmail,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

import { el, toast, initials, openModal } from "./ui.js";

// Role → display label
const ROLE_LABELS = {
  admin: "Administrator",
  editor: "Editor",
  writer: "Writer",
  newsletter_builder: "Newsletter Builder",
  marketing: "Marketing",
  reader: "Reader",
};

// Icons as SVG strings (used in nav).
const ICONS = {
  home: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`,
  pipeline: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>`,
  pen: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>`,
  check: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>`,
  mail: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 4h16c1 0 2 1 2 2v12c0 1-1 2-2 2H4c-1 0-2-1-2-2V6c0-1 1-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>`,
  chart: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>`,
  shield: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
  users: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
  book: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>`,
  activity: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>`,
};

// ---------- state ----------
const state = {
  user: null,          // Firebase user
  profile: null,       // Firestore users/{uid} doc data (includes role)
  role: null,          // Real role from Firestore (never changes during session)
  previewRole: null,   // Admin-only: role being previewed; null when not previewing
  currentRoute: null,
  currentModule: null,
  moduleCleanup: null,
};

// Role an admin can preview. The admin's real role is loaded from Firestore;
// when previewing, the sidebar/routing/context all use previewRole instead.
// Write actions continue to run against the real admin identity (Firestore rules
// check request.auth), so permissions are unaffected.
const PREVIEW_ROLES = ["writer", "editor", "newsletter_builder", "marketing"];
const PREVIEW_KEY = "catalyst.dashboard.previewRole";

function getActiveRole() {
  return state.previewRole || state.role;
}

// ---------- route config ----------
// Each route is module-loaded lazily. Loader is an async () => module.
// Module must export `mount(ctx, containerEl)` which optionally returns cleanup().
const ROUTES = {
  "#/overview": {
    label: "Overview",
    icon: ICONS.home,
    roles: ["*"],
    group: "main",
    loader: () => import("./overview.js"),
  },
  "#/pipeline/interviews": {
    label: "Catalyst in the Capital",
    icon: ICONS.pipeline,
    roles: ["*"],
    group: "main",
    loader: () => import("./pipeline.js"),
    mountKey: "interviews",
  },
  "#/pipeline/opeds": {
    label: "Op-Eds",
    icon: ICONS.book,
    roles: ["*"],
    group: "main",
    loader: () => import("./pipeline.js"),
    mountKey: "opeds",
  },
  "#/pipeline/mine": {
    label: "My assignments",
    icon: ICONS.users,
    roles: ["*"],
    group: "main",
    loader: () => import("./pipeline.js"),
    mountKey: "mine",
  },
  "#/tasks": {
    label: "Tasks",
    icon: ICONS.check,
    roles: ["*"],
    group: "main",
    loader: () => import("./tasks.js"),
  },
  "#/writer/draft": {
    label: "Submit a draft",
    icon: ICONS.pen,
    roles: ["admin", "editor", "writer"],
    group: "write",
    loader: () => import("./writer.js"),
    mountKey: "draft",
  },
  "#/writer/mine": {
    label: "My articles",
    icon: ICONS.book,
    roles: ["admin", "editor", "writer"],
    group: "write",
    loader: () => import("./writer.js"),
    mountKey: "mine",
  },
  "#/writer/feed": {
    label: "Articles in the works",
    icon: ICONS.book,
    roles: ["admin", "editor", "writer"],
    group: "write",
    loader: () => import("./writer.js"),
    mountKey: "feed",
  },
  "#/writer/guidelines": {
    label: "Editorial standards",
    icon: ICONS.book,
    roles: ["admin", "editor", "writer"],
    group: "write",
    loader: () => import("./guidelines.js"),
  },
  "#/editor/queue": {
    label: "Editing queue",
    icon: ICONS.check,
    roles: ["admin", "editor"],
    group: "edit",
    loader: () => import("./editor.js"),
    mountKey: "queue",
  },
  "#/newsletter/builder": {
    label: "Newsletter builder",
    icon: ICONS.mail,
    roles: ["admin", "newsletter_builder"],
    group: "newsletter",
    loader: () => import("./newsletter.js"),
    mountKey: "builder",
  },
  "#/newsletter/history": {
    label: "Campaign history",
    icon: ICONS.mail,
    roles: ["admin", "newsletter_builder", "marketing"],
    group: "newsletter",
    loader: () => import("./newsletter.js"),
    mountKey: "history",
  },
  "#/marketing/analytics": {
    label: "Subscribers & growth",
    icon: ICONS.chart,
    roles: ["admin", "marketing", "newsletter_builder"],
    group: "marketing",
    loader: () => import("./marketing.js"),
    mountKey: "analytics",
  },
  "#/marketing/subscribers": {
    label: "Subscriber list",
    icon: ICONS.users,
    roles: ["admin", "marketing"],
    group: "marketing",
    loader: () => import("./marketing.js"),
    mountKey: "subscribers",
  },
  "#/marketing/collabs": {
    label: "Collaboration requests",
    icon: ICONS.users,
    roles: ["admin", "marketing"],
    group: "marketing",
    loader: () => import("./marketing.js"),
    mountKey: "collabs",
  },
  "#/marketing/social": {
    label: "Social media posts",
    icon: ICONS.activity,
    roles: ["admin", "marketing"],
    group: "marketing",
    loader: () => import("./marketing.js"),
    mountKey: "social",
  },
  "#/admin/articles": {
    label: "All articles & approvals",
    icon: ICONS.shield,
    roles: ["admin"],
    group: "admin",
    loader: () => import("./admin.js"),
    mountKey: "articles",
  },
  "#/admin/users": {
    label: "Users & roles",
    icon: ICONS.users,
    roles: ["admin"],
    group: "admin",
    loader: () => import("./admin.js"),
    mountKey: "users",
  },
  "#/admin/images": {
    label: "Image library",
    icon: ICONS.pipeline,
    roles: ["admin"],
    group: "admin",
    loader: () => import("./admin.js"),
    mountKey: "images",
  },
  "#/admin/advanced": {
    label: "Advanced tools",
    icon: ICONS.shield,
    roles: ["admin"],
    group: "admin",
    loader: () => import("./admin-import.js"),
    mountKey: "advanced",
  },
  "#/admin/activity": {
    label: "Activity",
    icon: ICONS.activity,
    roles: ["admin"],
    group: "admin",
    loader: () => import("./activity.js"),
  },
  // Final-review page — the shareable link the admin sends to the writer after
  // approving. Either the writer (story author) or any admin/editor can land
  // here and push the article live. Hidden from the nav (no label shown in the
  // sidebar because it isn't grouped); accessed via ?id=<storyId>.
  "#/final-review": {
    label: "Final review",
    icon: ICONS.check,
    roles: ["admin", "editor", "writer"],
    hidden: true,
    loader: () => import("./final-review.js"),
  },
};

const GROUPS = [
  { id: "main", label: "Workspace" },
  { id: "write", label: "Writing" },
  { id: "edit", label: "Editing" },
  { id: "newsletter", label: "Newsletter" },
  { id: "marketing", label: "Marketing" },
  { id: "admin", label: "Admin" },
];

// ---------- auth bootstrap ----------
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "/admin/login";
    return;
  }
  state.user = user;
  try {
    state.profile = await ensureProfile(user);
    state.role = state.profile.role || "reader";
  } catch (err) {
    console.error("[dashboard] profile load failed", err);
    document.getElementById("content").innerHTML = `<div class="error-state">Could not load your profile. Try refreshing.</div>`;
    return;
  }

  if (state.role === "reader") {
    document.getElementById("content").innerHTML = `
      <div class="card">
        <div class="card-body empty-state">
          <p>You're signed in as <strong>${state.user.email}</strong> but you don't have staff access yet.</p>
          <p style="margin-top:12px;">Ask an admin to assign you a role, or <a href="/">head back to the public site</a>.</p>
        </div>
      </div>`;
    paintUserChip();
    return;
  }

  // Restore any previous preview role chosen this session (admin only).
  if (state.role === "admin") {
    const saved = sessionStorage.getItem(PREVIEW_KEY);
    if (saved && PREVIEW_ROLES.includes(saved)) {
      state.previewRole = saved;
    }
  }

  initPresencePing();
  paintUserChip();
  renderSidebar();
  attachGlobalHandlers();
  window.addEventListener("hashchange", handleRoute);
  handleRoute();
});

async function ensureProfile(user) {
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    const data = snap.data();
    // If the doc exists but name is blank, backfill from Firebase Auth displayName.
    if (!data.name && user.displayName) {
      await setDoc(ref, { name: user.displayName }, { merge: true });
      return { ...data, name: user.displayName };
    }
    return data;
  }
  // First-time login: create a reader/writer profile. Admin will upgrade their role.
  const profile = {
    name: user.displayName || user.email.split("@")[0],
    email: user.email || "",
    role: "writer",
    status: "active",
    createdAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
  };
  await setDoc(ref, profile, { merge: true });
  return profile;
}

// ---------- presence ping ----------
function initPresencePing() {
  const pingOnce = async () => {
    try {
      await setDoc(doc(db, "users", state.user.uid), {
        lastSeenAt: new Date().toISOString(),
      }, { merge: true });
      // Mirror doc so admin queries are fast.
      await setDoc(doc(db, "user_presence", state.user.uid), {
        lastSeenAt: new Date().toISOString(),
        name: state.profile.name || "",
        email: state.profile.email || state.user.email || "",
        role: state.role,
      }, { merge: true });
    } catch (err) {
      console.warn("[presence] ping failed", err?.message);
    }
  };
  pingOnce();
  setInterval(pingOnce, 5 * 60 * 1000); // every 5 min
}

// ---------- sidebar ----------
function renderSidebar() {
  const nav = document.getElementById("nav");
  const active = getActiveRole();
  // editors inherit writer permissions
  const effectiveRoles = active === "editor"
    ? [active, "writer"]
    : [active];
  // When previewing, admin access is suppressed so the sidebar reflects what
  // the previewed role would actually see.
  const userIsAllowed = (roles) => roles.includes("*") || effectiveRoles.some(r => roles.includes(r)) || active === "admin";

  const byGroup = new Map();
  for (const [hash, route] of Object.entries(ROUTES)) {
    if (!userIsAllowed(route.roles)) continue;
    if (route.hidden) continue;
    const g = route.group || "main";
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g).push({ hash, ...route });
  }

  const frag = document.createDocumentFragment();
  for (const g of GROUPS) {
    const items = byGroup.get(g.id);
    if (!items || !items.length) continue;
    const group = el("div", { class: "nav-group" });
    group.appendChild(el("div", { class: "nav-group-title" }, g.label));
    for (const item of items) {
      const link = el("a", {
        class: "nav-link",
        href: item.hash,
        "data-route": item.hash,
      });
      link.innerHTML = `${item.icon}<span>${item.label}</span>`;
      group.appendChild(link);
    }
    frag.appendChild(group);
  }
  nav.innerHTML = "";
  nav.appendChild(frag);

  // Ensure a default route exists
  if (!location.hash) location.hash = "#/overview";

  const footerRoleLine = state.previewRole
    ? `<div><span style="color:var(--muted);">Previewing as</span> ${ROLE_LABELS[state.previewRole] || state.previewRole}</div>`
    : `<div>${ROLE_LABELS[state.role] || state.role}</div>`;
  document.getElementById("footer-user-info").innerHTML =
    `<div style="font-weight:600;color:var(--ink-2);">${state.profile.name || state.profile.email}</div>` +
    footerRoleLine;
}

function paintUserChip() {
  document.getElementById("user-avatar").textContent = initials(state.profile.name, state.profile.email);
  document.getElementById("user-name").textContent = state.profile.name || state.profile.email;
  const roleEl = document.getElementById("user-role");
  if (state.previewRole) {
    roleEl.textContent = `Viewing as ${ROLE_LABELS[state.previewRole] || state.previewRole}`;
    roleEl.style.color = "#b45309";
  } else {
    roleEl.textContent = ROLE_LABELS[state.role] || state.role || "";
    roleEl.style.color = "";
  }
}

// ---------- routing ----------
async function handleRoute() {
  const hash = location.hash || "#/overview";
  // Strip query string (e.g. "#/editor/queue?review=abc") before looking up the route.
  const hashPath = hash.split("?")[0];
  let route = ROUTES[hashPath];

  if (!route) { location.hash = "#/overview"; return; }
  const active = getActiveRole();
  const effectiveRoles = active === "editor" ? [active, "writer"] : [active];
  const allowed = route.roles.includes("*") || effectiveRoles.some(r => route.roles.includes(r)) || active === "admin";
  if (!allowed) {
    toast("You don't have access to that page.", "error");
    location.hash = "#/overview";
    return;
  }

  // Highlight active nav link
  document.querySelectorAll(".nav-link").forEach((a) => a.classList.toggle("active", a.dataset.route === hashPath));
  const labelPath = route.label;
  document.getElementById("page-title-text").textContent = labelPath;

  const content = document.getElementById("content");
  content.innerHTML = `<div class="loading-state"><div class="spinner"></div>Loading&hellip;</div>`;

  // Run cleanup on previous module
  if (typeof state.moduleCleanup === "function") {
    try { state.moduleCleanup(); } catch (e) { console.warn(e); }
  }
  state.moduleCleanup = null;

  try {
    const mod = await route.loader();
    const ctx = makeContext(route);
    const maybeCleanup = await mod.mount(ctx, content);
    if (typeof maybeCleanup === "function") state.moduleCleanup = maybeCleanup;
    state.currentRoute = hash;
    state.currentModule = mod;
    injectPreviewBanner(content);
  } catch (err) {
    console.error("[dashboard] route mount failed", err);
    content.innerHTML = `<div class="error-state">Failed to load this page: ${err?.message || err}</div>`;
  }
}

// Prepend a preview banner to the mounted content when the admin is previewing
// as another role. Called after each module mount.
function injectPreviewBanner(content) {
  if (!state.previewRole) return;
  const label = ROLE_LABELS[state.previewRole] || state.previewRole;
  const banner = el("div", { class: "preview-banner", role: "status" });
  banner.innerHTML = `
    <span class="preview-banner-dot" aria-hidden="true"></span>
    <span class="preview-banner-text">
      Previewing as <strong>${label}</strong> &middot; your admin permissions are unchanged
    </span>
    <button type="button" class="preview-banner-exit">Exit preview</button>
  `;
  banner.querySelector(".preview-banner-exit").addEventListener("click", () => setPreviewRole(null));
  content.prepend(banner);
}

function makeContext(route) {
  return {
    user: state.user,
    profile: state.profile,
    role: getActiveRole(),
    realRole: state.role,
    isPreviewing: !!state.previewRole,
    mountKey: route.mountKey || null,
    toast,
    // Helper to build authorized fetch requests to our own /api endpoints.
    authedFetch: async (url, init = {}) => {
      const token = await getIdToken(state.user);
      const headers = new Headers(init.headers || {});
      headers.set("Authorization", `Bearer ${token}`);
      if (init.body && !headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
      }
      return fetch(url, { ...init, headers });
    },
    navigate: (hash) => { location.hash = hash; },
  };
}

// ---------- role preview (admin only) ----------
// Switch the dashboard to render as if the admin were another role. Passing
// null clears the preview and returns to the real admin view.
function setPreviewRole(nextRole) {
  if (state.role !== "admin") return;
  if (nextRole && !PREVIEW_ROLES.includes(nextRole)) return;
  if (nextRole === state.previewRole) { closeUserMenu(); return; }

  state.previewRole = nextRole;
  if (nextRole) {
    sessionStorage.setItem(PREVIEW_KEY, nextRole);
  } else {
    sessionStorage.removeItem(PREVIEW_KEY);
  }

  paintUserChip();
  renderSidebar();
  closeUserMenu();

  // If the current route is no longer allowed under the new role, handleRoute
  // will redirect to #/overview. Either way, re-run it to remount with the new
  // ctx.role so modules re-render their role-gated UI.
  if (location.hash === "#/overview") {
    handleRoute();
  } else {
    location.hash = "#/overview";
  }

  if (nextRole) {
    toast(`Previewing dashboard as ${ROLE_LABELS[nextRole] || nextRole}.`, "info");
  } else {
    toast("Back to your admin view.", "info");
  }
}

function renderUserMenu() {
  const menu = document.getElementById("user-menu");
  if (!menu) return;
  const isAdmin = state.role === "admin";

  const header = `
    <div class="user-menu-header">
      <div class="user-menu-header-label">Signed in</div>
      <div class="user-menu-header-name">${state.profile.name || state.profile.email}</div>
      <div class="user-menu-header-email">${state.profile.email || ""}</div>
    </div>
  `;

  if (!isAdmin) {
    menu.innerHTML = `
      ${header}
      <button type="button" class="user-menu-item" data-action="change-password">
        <span class="user-menu-item-dot"></span>
        <span class="user-menu-item-label">Change password</span>
      </button>
      <div class="user-menu-divider"></div>
      <button type="button" class="user-menu-item" data-action="signout">
        <span class="user-menu-item-dot"></span>
        <span class="user-menu-item-label">Sign out</span>
      </button>
    `;
  } else {
    const activeRole = getActiveRole();
    const roleItem = (role, tag = "") => {
      const label = ROLE_LABELS[role] || role;
      const current = role === activeRole;
      return `
        <button type="button" class="user-menu-item" data-action="preview" data-role="${role}" ${current ? 'aria-current="true"' : ""}>
          <span class="user-menu-item-dot"></span>
          <span class="user-menu-item-label">${label}</span>
          ${tag ? `<span class="user-menu-item-tag">${tag}</span>` : ""}
        </button>
      `;
    };

    menu.innerHTML = `
      ${header}
      <div class="user-menu-section-label">View dashboard as</div>
      ${roleItem("admin", "You")}
      ${PREVIEW_ROLES.map((r) => roleItem(r)).join("")}
      ${state.previewRole ? `
        <div class="user-menu-divider"></div>
        <button type="button" class="user-menu-item user-menu-exit" data-action="exit-preview">
          <span class="user-menu-item-dot" style="background:currentColor;"></span>
          <span class="user-menu-item-label">Exit preview</span>
        </button>
      ` : ""}
      <div class="user-menu-divider"></div>
      <button type="button" class="user-menu-item" data-action="change-password">
        <span class="user-menu-item-dot"></span>
        <span class="user-menu-item-label">Change password</span>
      </button>
      <button type="button" class="user-menu-item" data-action="signout">
        <span class="user-menu-item-dot"></span>
        <span class="user-menu-item-label">Sign out</span>
      </button>
    `;
  }

  menu.hidden = false;
  document.getElementById("user-chip").setAttribute("aria-expanded", "true");
}

function closeUserMenu() {
  const menu = document.getElementById("user-menu");
  if (!menu) return;
  menu.hidden = true;
  const chip = document.getElementById("user-chip");
  if (chip) chip.setAttribute("aria-expanded", "false");
}

// ---------- change password ----------
// Lets any signed-in user set a new password. We reauthenticate with their
// current password first (Firebase requires this for updatePassword when the
// session is older than a few minutes) and then call updatePassword. If the
// user forgot their current password, they can fall back to the email reset
// link — same flow as the public /admin/login "Forgot password" form.
function openChangePasswordModal() {
  const email = state.user?.email || state.profile?.email || "";

  const form = el("form", { style: "display:grid;gap:12px;" });
  form.innerHTML = `
    <div style="color:var(--muted);font-size:13px;">
      Signed in as <strong>${email || "(no email)"}</strong>.
      Your new password must be at least 6 characters.
    </div>
    <label style="display:grid;gap:4px;">
      <span style="font-weight:600;font-size:13px;">Current password</span>
      <input type="password" id="cp-current" autocomplete="current-password" required
             style="padding:8px 10px;border:1px solid var(--hairline);border-radius:6px;">
    </label>
    <label style="display:grid;gap:4px;">
      <span style="font-weight:600;font-size:13px;">New password</span>
      <input type="password" id="cp-new" autocomplete="new-password" minlength="6" required
             style="padding:8px 10px;border:1px solid var(--hairline);border-radius:6px;">
    </label>
    <label style="display:grid;gap:4px;">
      <span style="font-weight:600;font-size:13px;">Confirm new password</span>
      <input type="password" id="cp-confirm" autocomplete="new-password" minlength="6" required
             style="padding:8px 10px;border:1px solid var(--hairline);border-radius:6px;">
    </label>
    <div id="cp-msg" style="color:var(--danger);font-size:13px;min-height:18px;"></div>
    <div style="font-size:12px;color:var(--muted);border-top:1px solid var(--hairline);padding-top:10px;">
      Forgot your current password?
      <a href="#" id="cp-reset-link" style="color:var(--accent);text-decoration:underline;">
        Email me a reset link instead
      </a>.
    </div>
  `;

  const cancelBtn = el("button", { type: "button", class: "btn btn-secondary" }, "Cancel");
  const saveBtn = el("button", { type: "submit", class: "btn btn-primary", form: "" }, "Update password");
  saveBtn.setAttribute("form", "cp-form");
  form.id = "cp-form";

  const modal = openModal({
    title: "Change password",
    body: form,
    footer: [cancelBtn, saveBtn],
  });
  if (!modal) {
    toast("Could not open dialog.", "error");
    return;
  }

  cancelBtn.addEventListener("click", () => modal.close());

  const msgEl = form.querySelector("#cp-msg");
  const currentInput = form.querySelector("#cp-current");
  const newInput = form.querySelector("#cp-new");
  const confirmInput = form.querySelector("#cp-confirm");
  setTimeout(() => currentInput.focus(), 0);

  form.querySelector("#cp-reset-link").addEventListener("click", async (e) => {
    e.preventDefault();
    if (!email) {
      msgEl.textContent = "No email on file for this account — contact an admin.";
      return;
    }
    msgEl.style.color = "";
    msgEl.textContent = "Sending reset link…";
    try {
      await sendPasswordResetEmail(auth, email);
      modal.close();
      toast(`Reset link sent to ${email}. Check your inbox (and spam).`, "success");
    } catch (err) {
      msgEl.style.color = "var(--danger)";
      msgEl.textContent = friendlyAuthError(err);
    }
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    msgEl.style.color = "var(--danger)";
    msgEl.textContent = "";

    const current = currentInput.value;
    const next = newInput.value;
    const confirm = confirmInput.value;

    if (!current || !next || !confirm) {
      msgEl.textContent = "Please fill in all three fields.";
      return;
    }
    if (next.length < 6) {
      msgEl.textContent = "New password must be at least 6 characters.";
      return;
    }
    if (next !== confirm) {
      msgEl.textContent = "New password and confirmation don't match.";
      return;
    }
    if (next === current) {
      msgEl.textContent = "New password must be different from your current one.";
      return;
    }
    if (!auth.currentUser || !email) {
      msgEl.textContent = "Not signed in — please reload the page and try again.";
      return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = "Updating…";
    try {
      const cred = EmailAuthProvider.credential(email, current);
      await reauthenticateWithCredential(auth.currentUser, cred);
      await updatePassword(auth.currentUser, next);
      modal.close();
      toast("Password updated. Use your new password next time you sign in.", "success");
    } catch (err) {
      msgEl.textContent = friendlyAuthError(err);
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = "Update password";
    }
  });
}

function friendlyAuthError(err) {
  const code = err?.code || "";
  if (code === "auth/wrong-password" || code === "auth/invalid-credential") {
    return "Current password is incorrect.";
  }
  if (code === "auth/weak-password") return "New password is too weak (at least 6 characters).";
  if (code === "auth/too-many-requests") return "Too many attempts. Please wait a minute and try again.";
  if (code === "auth/requires-recent-login") {
    return "For security, please sign out and back in, then try again.";
  }
  if (code === "auth/user-not-found") return "No account found for this email.";
  if (code === "auth/network-request-failed") return "Network error — check your connection and retry.";
  return err?.message || "Something went wrong.";
}

// ---------- global handlers ----------
function attachGlobalHandlers() {
  document.getElementById("sidebar-signout").addEventListener("click", async (e) => {
    e.preventDefault();
    try {
      await signOut(auth);
      location.href = "/admin/login";
    } catch (err) { toast("Sign-out failed: " + err.message, "error"); }
  });

  const sidebarChangePwd = document.getElementById("sidebar-change-password");
  if (sidebarChangePwd) {
    sidebarChangePwd.addEventListener("click", (e) => {
      e.preventDefault();
      openChangePasswordModal();
    });
  }

  const sidebar = document.getElementById("sidebar");
  const scrim = document.getElementById("sidebar-scrim");
  document.getElementById("hamburger").addEventListener("click", () => {
    sidebar.classList.toggle("open");
    scrim.classList.toggle("open");
  });
  scrim.addEventListener("click", () => {
    sidebar.classList.remove("open");
    scrim.classList.remove("open");
  });

  // User chip dropdown (open on click, close on outside click or Escape).
  const chip = document.getElementById("user-chip");
  const menu = document.getElementById("user-menu");
  chip.addEventListener("click", (e) => {
    e.stopPropagation();
    if (menu.hidden) {
      renderUserMenu();
    } else {
      closeUserMenu();
    }
  });
  menu.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === "signout") {
      try {
        await signOut(auth);
        location.href = "/admin/login";
      } catch (err) { toast("Sign-out failed: " + err.message, "error"); }
      return;
    }
    if (action === "change-password") {
      closeUserMenu();
      openChangePasswordModal();
      return;
    }
    if (action === "exit-preview") {
      setPreviewRole(null);
      return;
    }
    if (action === "preview") {
      const role = btn.dataset.role;
      // Clicking "admin" while not previewing is a no-op; clicking it while
      // previewing exits the preview.
      if (role === "admin") {
        setPreviewRole(null);
      } else {
        setPreviewRole(role);
      }
    }
  });
  document.addEventListener("click", (e) => {
    if (menu.hidden) return;
    if (!e.target.closest("#user-chip-wrap")) closeUserMenu();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !menu.hidden) closeUserMenu();
  });
}
