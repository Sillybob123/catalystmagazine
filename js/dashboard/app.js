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
  collection,
  getDocs,
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
  social_media: "Social Media",
  reader: "Reader",
};

// Icons as SVG strings (used in nav). One icon per nav entry — duplicates
// make the sidebar hard to scan because the eye uses shape, not text, to
// orient. Each icon below is referenced by exactly one route except where
// the meaning is genuinely the same (e.g. both editing screens use `check`).
const ICONS = {
  // Workspace
  home:        `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`,
  // Catalyst in the Capital — a microphone (interview-led pipeline)
  mic:         `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="8" y1="22" x2="16" y2="22"/></svg>`,
  // Op-Eds — a quill (opinion / argument)
  quill:       `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z"/><line x1="16" y1="8" x2="2" y2="22"/><line x1="17" y1="15" x2="9" y2="15"/></svg>`,
  // My assignments — a clipboard with checks
  clipboard:   `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 2h6a1 1 0 0 1 1 1v2H8V3a1 1 0 0 1 1-1z"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><polyline points="9 14 11 16 15 12"/></svg>`,
  // Tasks — a numbered list
  list:        `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/></svg>`,
  // Directory — an address book (find teammates, message them)
  addressBook: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2"/><circle cx="12" cy="9" r="2.5"/><path d="M8.5 15.5a3.5 3.5 0 0 1 7 0"/></svg>`,
  // Pin toggle — a thumbtack (outline = unpinned, filled via CSS = pinned)
  pin:         `<svg class="pin-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14l-1.6-2.4a2 2 0 0 1-.4-1.2V8a2 2 0 0 1 2-2h-14a2 2 0 0 1 2 2v5.4a2 2 0 0 1-.4 1.2z"/></svg>`,

  // Writing
  // Submit a draft — a pen drafting a line
  pen:         `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>`,
  // My articles — stacked pages with a folded corner
  pages:       `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="14" y2="13"/><line x1="8" y1="17" x2="12" y2="17"/></svg>`,
  // Articles in the works — circular arrows (work in progress / cycling)
  feed:        `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10"/><path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14"/></svg>`,
  // Editorial standards — an open book
  bookOpen:    `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4.5C5 3 7.5 3 12 4.5V21c-4.5-1.5-7-1.5-10 0z"/><path d="M22 4.5C19 3 16.5 3 12 4.5V21c4.5-1.5 7-1.5 10 0z"/></svg>`,

  // Book reviews
  // Write a book review — a book + pencil mash-up
  bookPen:     `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H17v13H6.5A2.5 2.5 0 0 0 4 17.5z"/><path d="M4 17.5A2.5 2.5 0 0 0 6.5 20H17"/><path d="M14 7l4 4-5 5h-4v-4z"/></svg>`,
  // My book reviews — bookmark on a page
  bookmark:    `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>`,
  // Admin: Book reviews queue — a stacked-books library
  library:     `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><line x1="9" y1="6" x2="9" y2="14"/><line x1="13" y1="6" x2="13" y2="14"/></svg>`,

  // Editing
  check:       `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>`,

  // Newsletter
  // Newsletter builder — paper airplane (composing/sending)
  send:        `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`,
  // Campaign history — clock with rewind
  history:     `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><polyline points="3 3 3 8 8 8"/><polyline points="12 7 12 12 15 14"/></svg>`,

  // Marketing
  // Planner — calendar with a checked day (what's coming up, what to prep)
  planner:     `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><path d="M9 16l2 2 4-4"/></svg>`,
  // Subscribers & growth — bar chart with trend arrow
  chart:       `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>`,
  // Subscriber list — group of people
  users:       `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
  // Collaboration requests — a paper plane with a person (someone
  // reaching out to collaborate). Replaces the previous "handshake"
  // glyph which read as a tangled mess at 16px.
  handshake:   `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>`,
  // Social media posts — share-arrow
  share:       `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>`,
  // Searchability / Google Search Console — magnifying glass with a trend line
  search:      `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><polyline points="8 13 10 11 12 13 14 10"/></svg>`,

  // Admin
  // All articles & approvals — a shield with a check (curation/approvals)
  shieldCheck: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/></svg>`,
  // Games — a controller / dice
  game:        `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="11" x2="10" y2="11"/><line x1="8" y1="9" x2="8" y2="13"/><circle cx="15" cy="12" r="1"/><circle cx="18" cy="10" r="1"/><rect x="2" y="6" width="20" height="12" rx="6"/></svg>`,
  // Users & roles — single user with a settings cog
  userCog:     `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="7" r="4"/><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/><circle cx="19" cy="11" r="2"/><path d="M19 8v1"/><path d="M19 13v1"/><path d="M16 11h1"/><path d="M21 11h1"/></svg>`,
  // Image library — image / picture frame
  image:       `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`,
  // Advanced tools — a wrench
  wrench:      `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>`,
  // Activity — pulse line
  activity:    `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>`,
  // Admin: Submissions — an inbox tray
  inbox:       `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>`,
};

// ---------- state ----------
const state = {
  user: null,          // Firebase user
  profile: null,       // Firestore users/{uid} doc data (includes role)
  role: null,          // Real role from Firestore (never changes during session)
  previewRole: null,   // Admin-only: role being previewed; null when not previewing
  previewUser: null,   // Admin-only: a specific teammate being previewed
                       //   { uid, name, email, role, extraAccess, profile }
  pins: [],            // Ordered list of pinned route hashes (per-user, localStorage)
  currentRoute: null,
  currentModule: null,
  moduleCleanup: null,
};

// Role an admin can preview. The admin's real role is loaded from Firestore;
// when previewing, the sidebar/routing/context all use previewRole instead.
// Write actions continue to run against the real admin identity (Firestore rules
// check request.auth), so permissions are unaffected.
const PREVIEW_ROLES = ["writer", "editor", "newsletter_builder", "marketing", "social_media"];
const PREVIEW_KEY = "catalyst.dashboard.previewRole";
const PREVIEW_USER_KEY = "catalyst.dashboard.previewUser";

// ---------- pinned tabs (per-user, local) ----------
// Each person can pin the routes they use most; pins surface in a "Pinned"
// group at the very top of the sidebar, in pin order. Stored per-uid in
// localStorage (a personal preference, not worth a Firestore write/read).
// Defaults: the social-media team gets the Planner auto-pinned the first
// time they load, since that's their command center.
const PIN_KEY_PREFIX = "catalyst.dashboard.pins.";
const DEFAULT_PINS_BY_ROLE = {
  social_media: ["#/planner"],
};

function pinStorageKey() {
  // Tie pins to the *viewed* identity so an admin previewing a teammate sees
  // (and edits) that teammate's pins, mirroring how the rest of preview works.
  const uid = state.previewUser?.uid || state.user?.uid || "anon";
  return PIN_KEY_PREFIX + uid;
}

function loadPins() {
  try {
    const raw = localStorage.getItem(pinStorageKey());
    if (raw !== null) {
      const v = JSON.parse(raw);
      return Array.isArray(v) ? v.filter((h) => typeof h === "string") : [];
    }
  } catch {}
  // No saved pins yet → seed role defaults (only routes the role can access).
  const role = getActiveRole();
  const defaults = (DEFAULT_PINS_BY_ROLE[role] || [])
    .filter((h) => ROUTES[h] && isRouteAllowed(h, ROUTES[h]));
  if (defaults.length) savePins(defaults);
  return defaults;
}

function savePins(pins) {
  state.pins = pins;
  try { localStorage.setItem(pinStorageKey(), JSON.stringify(pins)); } catch {}
}

function isPinned(hash) { return state.pins.includes(hash); }

function togglePin(hash) {
  const next = isPinned(hash)
    ? state.pins.filter((h) => h !== hash)
    : [...state.pins, hash];
  savePins(next);
  renderSidebar();
  // Re-highlight the active link after the rebuild.
  const path = (location.hash || "").split("?")[0];
  document.querySelectorAll(".nav-link").forEach((a) => a.classList.toggle("active", a.dataset.route === path));
}

function getActiveRole() {
  if (state.previewUser) return state.previewUser.role || "reader";
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
    icon: ICONS.mic,
    roles: ["*"],
    group: "main",
    loader: () => import("./pipeline.js"),
    mountKey: "interviews",
  },
  "#/pipeline/opeds": {
    label: "Op-Eds",
    icon: ICONS.quill,
    roles: ["*"],
    group: "main",
    loader: () => import("./pipeline.js"),
    mountKey: "opeds",
  },
  "#/pipeline/mine": {
    label: "My assignments",
    icon: ICONS.clipboard,
    roles: ["*"],
    group: "main",
    loader: () => import("./pipeline.js"),
    mountKey: "mine",
  },
  "#/tasks": {
    label: "Tasks",
    icon: ICONS.list,
    roles: ["*"],
    group: "main",
    loader: () => import("./tasks.js?v=tasks-v5"),
  },
  // Directory — the whole team with roles + emails, plus private messaging
  // (each chat message is also emailed to the recipient via /api/notify/dm).
  "#/directory": {
    label: "Directory/Team Messages",
    icon: ICONS.addressBook,
    roles: ["*"],
    group: "main",
    loader: () => import("./directory.js?v=chat-2"),
  },
  "#/writer/draft": {
    label: "Submit a draft",
    icon: ICONS.pen,
    roles: ["admin", "editor", "writer"],
    group: "write",
    loader: () => import("./writer.js?v=topics-alt"),
    mountKey: "draft",
  },
  "#/writer/mine": {
    label: "My articles",
    icon: ICONS.pages,
    roles: ["admin", "editor", "writer"],
    group: "write",
    loader: () => import("./writer.js?v=topics-alt"),
    mountKey: "mine",
  },
  "#/writer/feed": {
    label: "Articles in the works",
    icon: ICONS.feed,
    roles: ["admin", "editor", "writer"],
    group: "write",
    loader: () => import("./writer.js?v=topics-alt"),
    mountKey: "feed",
  },
  "#/writer/guidelines": {
    label: "Editorial standards",
    icon: ICONS.bookOpen,
    roles: ["admin", "editor", "writer"],
    group: "write",
    loader: () => import("./guidelines.js"),
  },
  // Book reviews live in their own sidebar group ("Book reviews") so the
  // composer + writer's own list + admin queue are next to each other.
  // They have a distinct composer with book-specific fields (ISBN, rating,
  // book author separate from byline) and publish straight to the Book
  // Reviews page rather than the regular article pipeline.
  "#/book-reviews/write": {
    label: "Write a book review",
    icon: ICONS.bookPen,
    roles: ["admin", "editor", "writer"],
    group: "book-reviews",
    loader: () => import("./book-reviews-writer.js"),
    mountKey: "write",
  },
  "#/book-reviews/mine": {
    label: "My book reviews",
    icon: ICONS.bookmark,
    roles: ["admin", "editor", "writer"],
    group: "book-reviews",
    loader: () => import("./book-reviews-writer.js"),
    mountKey: "mine",
  },
  "#/admin/book-reviews": {
    label: "Reader-submitted reviews",
    icon: ICONS.library,
    roles: ["admin"],
    group: "book-reviews",
    loader: () => import("./book-reviews-admin.js"),
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
    icon: ICONS.send,
    roles: ["admin", "newsletter_builder"],
    group: "newsletter",
    // Cache-bust: bump when newsletter.js changes shape (e.g. picker UI).
    loader: () => import("./newsletter.js?v=bookreview-picker"),
    mountKey: "builder",
  },
  "#/newsletter/history": {
    label: "Campaign history",
    icon: ICONS.history,
    roles: ["admin", "newsletter_builder", "marketing"],
    group: "newsletter",
    loader: () => import("./newsletter.js"),
    mountKey: "history",
  },
  // Planner — the social/marketing team's command center: what's publishing
  // soon, what social work is due, who to talk to, and what just went live.
  "#/planner": {
    label: "Planner",
    icon: ICONS.planner,
    roles: ["admin", "marketing", "social_media"],
    group: "marketing",
    loader: () => import("./planner.js"),
  },
  "#/marketing/analytics": {
    label: "Subscribers & growth",
    icon: ICONS.chart,
    roles: ["admin", "marketing", "newsletter_builder", "social_media"],
    group: "marketing",
    loader: () => import("./marketing.js"),
    mountKey: "analytics",
  },
  "#/marketing/subscribers": {
    label: "Subscriber list",
    icon: ICONS.users,
    roles: ["admin", "marketing", "social_media"],
    group: "marketing",
    loader: () => import("./marketing.js"),
    mountKey: "subscribers",
  },
  "#/marketing/collabs": {
    label: "Collaboration requests",
    icon: ICONS.handshake,
    roles: ["admin", "marketing"],
    group: "marketing",
    loader: () => import("./marketing.js"),
    mountKey: "collabs",
  },
  "#/marketing/social": {
    label: "Social media posts",
    icon: ICONS.share,
    roles: ["admin", "marketing", "social_media"],
    group: "marketing",
    loader: () => import("./marketing.js"),
    mountKey: "social",
  },
  "#/marketing/searchability": {
    label: "Searchability",
    icon: ICONS.search,
    roles: ["admin", "marketing", "social_media"],
    group: "marketing",
    loader: () => import("./searchability.js"),
    mountKey: "searchability",
  },
  // Tasks — the admin's to-do / review / approve queue. Full-page sibling of
  // the "Your tasks" panel on Activity; both share task-engine.js.
  "#/admin/tasks": {
    label: "Tasks",
    icon: ICONS.check,
    roles: ["admin"],
    group: "admin",
    loader: () => import("./tasks-admin.js"),
  },
  "#/admin/articles": {
    label: "All articles & approvals",
    icon: ICONS.shieldCheck,
    roles: ["admin"],
    group: "admin",
    loader: () => import("./admin.js?v=topics-alt"),
    mountKey: "articles",
  },
  // Submissions inbox — Join-the-Team applications + Article proposals
  // sent through the public collaborate page. Admins triage them here:
  // see all the fields a submitter filled in, mark as reviewed, reply.
  "#/admin/submissions": {
    label: "Submissions inbox",
    icon: ICONS.inbox,
    roles: ["admin"],
    group: "admin",
    loader: () => import("./submissions.js?v=2"),
  },
  "#/admin/games": {
    label: "Games",
    icon: ICONS.game,
    roles: ["admin"],
    group: "admin",
    loader: () => import("./games.js"),
  },
  "#/admin/users": {
    label: "Users & roles",
    icon: ICONS.userCog,
    roles: ["admin"],
    group: "admin",
    loader: () => import("./admin.js?v=topics-alt"),
    mountKey: "users",
  },
  "#/admin/images": {
    label: "Image library",
    icon: ICONS.image,
    roles: ["admin"],
    group: "admin",
    loader: () => import("./admin.js?v=topics-alt"),
    mountKey: "images",
  },
  "#/admin/advanced": {
    label: "Advanced tools",
    icon: ICONS.wrench,
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
    loader: () => import("./final-review.js?v=scope-fix"),
  },
};

const GROUPS = [
  { id: "main", label: "Workspace" },
  { id: "write", label: "Writing" },
  // Book reviews are an editorial product, not a sub-section of writing.
  // Surfacing them as their own group makes the composer + writer's own
  // list (and, for admins, the reader-submission queue) easy to find
  // without scanning past every article-pipeline entry.
  { id: "book-reviews", label: "Book reviews" },
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

  // Restore any previous preview (role or person) chosen this session (admin only).
  if (state.role === "admin") {
    const saved = sessionStorage.getItem(PREVIEW_KEY);
    if (saved && PREVIEW_ROLES.includes(saved)) {
      state.previewRole = saved;
    }
    try {
      const savedUser = JSON.parse(sessionStorage.getItem(PREVIEW_USER_KEY) || "null");
      if (savedUser && savedUser.uid && savedUser.role) {
        state.previewUser = savedUser;
        state.previewRole = null;
      }
    } catch {}
  }

  state.pins = loadPins();
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

// Per-user extra-access overrides — admins can grant a user access to
// specific routes (by hash) that their role wouldn't normally see, via
// the Users & roles admin UI. Stored as `users/{uid}.extraAccess: string[]`.
//
// When admin is previewing another role, extraAccess is intentionally
// ignored so the sidebar reflects the previewed role's *base* permissions.
// When previewing a specific person, THEIR grants apply — the whole point
// is to see exactly what that teammate sees.
function getExtraAccess() {
  if (state.previewUser) {
    const list = state.previewUser.extraAccess;
    return Array.isArray(list) ? list : [];
  }
  if (state.previewRole) return [];
  const list = state.profile?.extraAccess;
  return Array.isArray(list) ? list : [];
}

// Returns true if the active user can see/visit a given route.
// Checks: wildcard, role match, admin override, and per-user extraAccess.
function isRouteAllowed(hash, route) {
  const active = getActiveRole();
  const effectiveRoles = active === "editor" ? [active, "writer"] : [active];
  if (route.roles.includes("*")) return true;
  if (effectiveRoles.some((r) => route.roles.includes(r))) return true;
  if (active === "admin") return true;
  if (getExtraAccess().includes(hash)) return true;
  return false;
}

// ---------- sidebar ----------
// Build one nav link, including its hover pin toggle. `pinned` controls the
// highlighted styling and the toggle's filled/outline state.
function buildNavLink(hash, route, { pinned } = {}) {
  const link = el("a", {
    class: "nav-link" + (pinned ? " nav-link-pinned" : ""),
    href: hash,
    "data-route": hash,
  });
  link.innerHTML = `${route.icon}<span class="nav-link-label">${route.label}</span>`;

  // Overview is the home tab — keep it un-pinnable so "Pinned" never just
  // duplicates the thing everyone already lands on.
  if (hash !== "#/overview") {
    const toggle = el("button", {
      type: "button",
      class: "nav-pin-toggle" + (pinned ? " is-pinned" : ""),
      "aria-label": pinned ? `Unpin ${route.label}` : `Pin ${route.label}`,
      title: pinned ? "Unpin" : "Pin to top",
    });
    toggle.innerHTML = ICONS.pin;
    toggle.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      togglePin(hash);
    });
    link.appendChild(toggle);
  }
  return link;
}

function renderSidebar() {
  const nav = document.getElementById("nav");

  const byGroup = new Map();
  for (const [hash, route] of Object.entries(ROUTES)) {
    if (!isRouteAllowed(hash, route)) continue;
    if (route.hidden) continue;
    const g = route.group || "main";
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g).push({ hash, ...route });
  }

  // Only keep pins that are real, visible, allowed routes (a role change or a
  // removed route shouldn't leave a dangling pin). Preserve pin order.
  const pinnedHashes = state.pins.filter(
    (h) => ROUTES[h] && !ROUTES[h].hidden && isRouteAllowed(h, ROUTES[h]) && h !== "#/overview");

  const frag = document.createDocumentFragment();

  // "Pinned" group at the very top — the user's own shortcuts.
  if (pinnedHashes.length) {
    const group = el("div", { class: "nav-group nav-group-pinned" });
    group.appendChild(el("div", { class: "nav-group-title" }, "Pinned"));
    for (const hash of pinnedHashes) {
      group.appendChild(buildNavLink(hash, ROUTES[hash], { pinned: true }));
    }
    frag.appendChild(group);
  }

  // Regular groups — every allowed route stays in its normal section too, so
  // pinning is purely additive (the item is still findable where it lives).
  for (const g of GROUPS) {
    const items = byGroup.get(g.id);
    if (!items || !items.length) continue;
    const group = el("div", { class: "nav-group" });
    group.appendChild(el("div", { class: "nav-group-title" }, g.label));
    for (const item of items) {
      group.appendChild(buildNavLink(item.hash, ROUTES[item.hash], { pinned: false }));
    }
    frag.appendChild(group);
  }
  nav.innerHTML = "";
  nav.appendChild(frag);

  // Ensure a default route exists
  if (!location.hash) location.hash = "#/overview";

  const footerRoleLine = state.previewUser
    ? `<div><span style="color:var(--muted);">Previewing</span> ${state.previewUser.name || state.previewUser.email}</div>`
    : state.previewRole
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
  if (state.previewUser) {
    roleEl.textContent = `Viewing ${state.previewUser.name || state.previewUser.email}`;
    roleEl.style.color = "#b45309";
  } else if (state.previewRole) {
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
  if (!isRouteAllowed(hashPath, route)) {
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
// as another role or a specific teammate. Called after each module mount.
function injectPreviewBanner(content) {
  if (!state.previewRole && !state.previewUser) return;
  const banner = el("div", { class: "preview-banner", role: "status" });
  if (state.previewUser) {
    const who = state.previewUser.name || state.previewUser.email;
    const roleLabel = ROLE_LABELS[state.previewUser.role] || state.previewUser.role || "";
    banner.innerHTML = `
      <span class="preview-banner-dot" aria-hidden="true"></span>
      <span class="preview-banner-text">
        Previewing <strong>${who}</strong>'s dashboard (${roleLabel}) &middot; their pages, grants, and data &middot; saving/posting is blocked while previewing
      </span>
      <button type="button" class="preview-banner-exit">Exit preview</button>
    `;
  } else {
    const label = ROLE_LABELS[state.previewRole] || state.previewRole;
    banner.innerHTML = `
      <span class="preview-banner-dot" aria-hidden="true"></span>
      <span class="preview-banner-text">
        Previewing as <strong>${label}</strong> &middot; your admin permissions are unchanged
      </span>
      <button type="button" class="preview-banner-exit">Exit preview</button>
    `;
  }
  banner.querySelector(".preview-banner-exit").addEventListener("click", () => exitAllPreviews());
  content.prepend(banner);
}

// When loaded from a dev/static server (Live Server, file://, etc.), our
// /api/* endpoints aren't running locally — route them to the deployed
// Cloudflare Pages origin so the dashboard stays fully functional in dev.
// Honors window.__CATALYST_API_BASE__ as a manual override if set.
const PROD_API_BASE = "https://catalystmagazine.pages.dev";
function resolveApiUrl(url) {
  if (typeof url !== "string" || !url.startsWith("/api/")) return url;
  if (typeof window !== "undefined" && window.__CATALYST_API_BASE__) {
    return window.__CATALYST_API_BASE__.replace(/\/$/, "") + url;
  }
  if (typeof location === "undefined") return url;
  const host = location.hostname;
  const isProd =
    host.endsWith(".pages.dev") ||
    host.endsWith("catalyst-magazine.com") ||
    host.endsWith("catalystmagazine.com");
  if (isProd) return url;
  // Local dev (localhost, 127.0.0.1, file://, LAN IPs) — use prod API.
  return PROD_API_BASE + url;
}

function makeContext(route) {
  // When previewing a specific teammate, hand modules THEIR identity (uid,
  // profile) so "My articles", calendars, and assignment lists show their
  // data — staff-wide read rules make that possible. Writes still run on the
  // admin's auth token, so anything self-attributed is rejected by Firestore
  // rules rather than forged.
  const pu = state.previewUser;
  const ctxUser = pu
    ? { uid: pu.uid, email: pu.email || "", displayName: pu.name || "" }
    : state.user;
  const ctxProfile = pu
    ? (pu.profile || { name: pu.name, email: pu.email, role: pu.role, extraAccess: pu.extraAccess })
    : state.profile;
  return {
    user: ctxUser,
    profile: ctxProfile,
    role: getActiveRole(),
    realRole: state.role,
    isPreviewing: !!state.previewRole || !!state.previewUser,
    mountKey: route.mountKey || null,
    toast,
    // Helper to build authorized fetch requests to our own /api endpoints.
    // When the dashboard is loaded from a static dev server (VS Code Live
    // Server, file:// preview, etc.) the local origin has no Cloudflare
    // Functions, so /api/* requests would 404. In that case, route /api
    // calls to the deployed Cloudflare Pages origin instead so previews
    // and sends still work end-to-end during development.
    authedFetch: async (url, init = {}) => {
      const token = await getIdToken(state.user);
      const headers = new Headers(init.headers || {});
      headers.set("Authorization", `Bearer ${token}`);
      if (init.body && !headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
      }
      const target = resolveApiUrl(url);
      return fetch(target, { ...init, headers });
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
  if (nextRole === state.previewRole && !state.previewUser) { closeUserMenu(); return; }

  // Role preview and person preview are mutually exclusive.
  state.previewUser = null;
  sessionStorage.removeItem(PREVIEW_USER_KEY);

  state.previewRole = nextRole;
  if (nextRole) {
    sessionStorage.setItem(PREVIEW_KEY, nextRole);
  } else {
    sessionStorage.removeItem(PREVIEW_KEY);
  }

  state.pins = loadPins();
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

// Preview a specific teammate — their role, their extra-access grants, their
// data. Pass null to exit.
function setPreviewUser(next) {
  if (state.role !== "admin") return;
  if (next && next.uid === state.user.uid) {
    toast("That's you — no preview needed.", "info");
    return;
  }
  state.previewRole = null;
  sessionStorage.removeItem(PREVIEW_KEY);
  state.previewUser = next;
  if (next) {
    sessionStorage.setItem(PREVIEW_USER_KEY, JSON.stringify(next));
  } else {
    sessionStorage.removeItem(PREVIEW_USER_KEY);
  }

  state.pins = loadPins();
  paintUserChip();
  renderSidebar();
  closeUserMenu();

  if (location.hash === "#/overview") {
    handleRoute();
  } else {
    location.hash = "#/overview";
  }

  if (next) {
    toast(`Previewing ${next.name || next.email}'s dashboard.`, "info");
  } else {
    toast("Back to your admin view.", "info");
  }
}

function exitAllPreviews() {
  if (state.previewUser) setPreviewUser(null);
  else setPreviewRole(null);
}

// Searchable teammate list → click to preview. Loads the users directory
// once per open; admins can read every user doc.
async function openPersonPicker() {
  closeUserMenu();
  const body = el("div", { style: "display:flex;flex-direction:column;gap:10px;min-width:min(420px,80vw);" });
  body.innerHTML = `
    <input id="pp-search" placeholder="Search by name or email…" autocomplete="off"
           style="padding:9px 12px;border:1px solid var(--hairline,#e5e7eb);border-radius:8px;font-size:13px;font-family:inherit;">
    <div id="pp-list" style="max-height:340px;overflow:auto;display:flex;flex-direction:column;gap:2px;">
      <div class="loading-state"><div class="spinner"></div>Loading team…</div>
    </div>`;
  const modal = openModal({ title: "Preview a teammate's dashboard", body });
  if (!modal) return;

  let people = [];
  try {
    const snap = await getDocs(collection(db, "users"));
    people = snap.docs
      .map((d) => ({ uid: d.id, ...d.data() }))
      .filter((u) => u.uid !== state.user.uid && u.role && u.role !== "reader")
      .sort((a, b) => String(a.name || a.email || "").localeCompare(String(b.name || b.email || "")));
  } catch (err) {
    body.querySelector("#pp-list").innerHTML = `<div class="error-state">Could not load users: ${err.message}</div>`;
    return;
  }

  const listEl = body.querySelector("#pp-list");
  const searchEl = body.querySelector("#pp-search");
  const renderList = () => {
    const q = searchEl.value.trim().toLowerCase();
    const matches = people.filter((u) =>
      !q || String(u.name || "").toLowerCase().includes(q) || String(u.email || "").toLowerCase().includes(q));
    listEl.innerHTML = "";
    if (!matches.length) {
      listEl.innerHTML = `<div style="padding:14px;text-align:center;color:var(--muted);font-size:13px;">No one matches "${searchEl.value.trim()}".</div>`;
      return;
    }
    for (const u of matches) {
      const row = el("button", {
        type: "button",
        style: "display:flex;align-items:center;gap:10px;width:100%;text-align:left;padding:9px 10px;border:0;background:transparent;border-radius:8px;cursor:pointer;font:inherit;",
        onmouseenter: (e) => { e.currentTarget.style.background = "var(--surface-2,#f1f5f9)"; },
        onmouseleave: (e) => { e.currentTarget.style.background = "transparent"; },
      });
      row.innerHTML = `
        <span style="width:30px;height:30px;border-radius:50%;background:var(--accent,#0f172a);color:#fff;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0;">${initials(u.name, u.email)}</span>
        <span style="min-width:0;flex:1;">
          <span style="display:block;font-weight:600;font-size:13.5px;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${u.name || u.email || "(no name)"}</span>
          <span style="display:block;font-size:11.5px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${u.email || ""}</span>
        </span>
        <span style="font-size:11px;font-weight:700;color:var(--muted);white-space:nowrap;">${ROLE_LABELS[u.role] || u.role}${Array.isArray(u.extraAccess) && u.extraAccess.length ? ` · +${u.extraAccess.length}` : ""}</span>`;
      row.addEventListener("click", () => {
        modal.close();
        setPreviewUser({
          uid: u.uid,
          name: u.name || "",
          email: u.email || "",
          role: u.role,
          extraAccess: Array.isArray(u.extraAccess) ? u.extraAccess : [],
          profile: u,
        });
      });
      listEl.appendChild(row);
    }
  };
  searchEl.addEventListener("input", renderList);
  renderList();
  setTimeout(() => searchEl.focus(), 0);
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
      <div class="user-menu-divider"></div>
      <button type="button" class="user-menu-item" data-action="preview-person" ${state.previewUser ? 'aria-current="true"' : ""}>
        <span class="user-menu-item-dot"></span>
        <span class="user-menu-item-label">${state.previewUser
          ? `Previewing: ${state.previewUser.name || state.previewUser.email}`
          : "Preview a specific person…"}</span>
      </button>
      ${state.previewRole || state.previewUser ? `
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
  // Close the drawer on mobile when the writer picks a nav link, otherwise
  // the new view appears underneath the open drawer and they have to tap
  // the scrim to see it.
  sidebar.addEventListener("click", (e) => {
    const link = e.target.closest(".nav-link");
    if (!link) return;
    if (window.matchMedia("(max-width: 900px)").matches) {
      sidebar.classList.remove("open");
      scrim.classList.remove("open");
    }
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
      exitAllPreviews();
      return;
    }
    if (action === "preview-person") {
      openPersonPicker();
      return;
    }
    if (action === "preview") {
      const role = btn.dataset.role;
      // Clicking "admin" while not previewing is a no-op; clicking it while
      // previewing exits the preview.
      if (role === "admin") {
        exitAllPreviews();
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
