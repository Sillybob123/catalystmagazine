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
import { onAuthStateChanged, signOut, getIdToken } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

import { el, toast, initials } from "./ui.js";

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
  role: null,
  currentRoute: null,
  currentModule: null,
  moduleCleanup: null,
};

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
  "#/marketing/collabs": {
    label: "Collaboration requests",
    icon: ICONS.users,
    roles: ["admin", "marketing"],
    group: "marketing",
    loader: () => import("./marketing.js"),
    mountKey: "collabs",
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
  // editors inherit writer permissions
  const effectiveRoles = state.role === "editor"
    ? [state.role, "writer"]
    : [state.role];
  const userIsAllowed = (roles) => roles.includes("*") || effectiveRoles.some(r => roles.includes(r)) || state.role === "admin";

  const byGroup = new Map();
  for (const [hash, route] of Object.entries(ROUTES)) {
    if (!userIsAllowed(route.roles)) continue;
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

  document.getElementById("footer-user-info").innerHTML =
    `<div style="font-weight:600;color:var(--ink-2);">${state.profile.name || state.profile.email}</div>` +
    `<div>${ROLE_LABELS[state.role] || state.role}</div>`;
}

function paintUserChip() {
  document.getElementById("user-avatar").textContent = initials(state.profile.name, state.profile.email);
  document.getElementById("user-name").textContent = state.profile.name || state.profile.email;
  document.getElementById("user-role").textContent = ROLE_LABELS[state.role] || state.role || "";
}

// ---------- routing ----------
async function handleRoute() {
  const hash = location.hash || "#/overview";
  // Strip query string (e.g. "#/editor/queue?review=abc") before looking up the route.
  const hashPath = hash.split("?")[0];
  let route = ROUTES[hashPath];

  if (!route) { location.hash = "#/overview"; return; }
  const effectiveRoles = state.role === "editor" ? [state.role, "writer"] : [state.role];
  const allowed = route.roles.includes("*") || effectiveRoles.some(r => route.roles.includes(r)) || state.role === "admin";
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
  } catch (err) {
    console.error("[dashboard] route mount failed", err);
    content.innerHTML = `<div class="error-state">Failed to load this page: ${err?.message || err}</div>`;
  }
}

function makeContext(route) {
  return {
    user: state.user,
    profile: state.profile,
    role: state.role,
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

// ---------- global handlers ----------
function attachGlobalHandlers() {
  document.getElementById("sidebar-signout").addEventListener("click", async (e) => {
    e.preventDefault();
    try {
      await signOut(auth);
      location.href = "/admin/login";
    } catch (err) { toast("Sign-out failed: " + err.message, "error"); }
  });

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
}
