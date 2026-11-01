// People picker for When to meet (meet.js) and Meeting (meeting.js): one row
// per person (all of their staff accounts), quick group buttons (everyone,
// admins, the edition's section editors, writers, social & growth) and a
// search box. Staff can read `users`; the section editors come from the
// edition in progress (edition_hub/{CURRENT_EDITION}).

import { db } from "../firebase-config.js";
import { collection, getDocs, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { esc } from "./ui.js";
import { CURRENT_EDITION } from "./edition-deadlines.js?v=1";

const STAFF = ["admin", "editor", "writer", "newsletter_builder", "marketing", "social_media"];
let cache = null;

// [{ name, uids: [...], roles: Set, sectionEditor: bool }], sorted by name.
export async function loadPeople() {
  if (cache) return cache;
  const [users, hub] = await Promise.all([
    getDocs(collection(db, "users")),
    getDoc(doc(db, "edition_hub", CURRENT_EDITION)).catch(() => null),
  ]);
  const h = hub?.data?.() || {};
  const edUids = new Set(h.editorUids || []);
  const edNames = new Set((h.sections || []).map((s) => String(s.editor?.name || "").trim().toLowerCase()).filter(Boolean));
  const byName = new Map();
  users.forEach((d) => {
    const u = d.data();
    const name = String(u.name || "").trim();
    if (!name || (u.status || "active") === "inactive") return;
    const k = name.toLowerCase();
    if (!byName.has(k)) byName.set(k, { name, uids: [], roles: new Set(), staff: false, sectionEditor: false });
    const p = byName.get(k);
    p.uids.push(d.id);
    if (STAFF.includes(u.role)) { p.staff = true; p.roles.add(u.role); }
    if (edUids.has(d.id) || edNames.has(k)) p.sectionEditor = true;
  });
  cache = [...byName.values()].filter((p) => p.staff).sort((a, b) => a.name.localeCompare(b.name));
  return cache;
}

const GROUPS = [
  ["all", "Everyone", () => true],
  ["admin", "Admins", (p) => p.roles.has("admin")],
  ["section", "Section editors", (p) => p.sectionEditor],
  ["writer", "Writers", (p) => p.roles.has("writer") || p.roles.has("editor")],
  ["social", "Social & growth", (p) => ["social_media", "marketing", "newsletter_builder"].some((r) => p.roles.has(r))],
];

// Renders into `root`; `selected` is a Set of names, changed in place.
// Returns { count() }.
export function mountPeoplePicker(root, people, selected, { onChange = () => {} } = {}) {
  let q = "";
  const paint = () => {
    const shown = people.filter((p) => !q || p.name.toLowerCase().includes(q));
    root.innerHTML = `
      <div class="pp-groups">${GROUPS.map(([id, label, fn]) => {
        const n = people.filter(fn).length;
        return n ? `<button type="button" class="pp-group" data-pp-group="${id}">${esc(label)}<span>${n}</span></button>` : "";
      }).join("")}<button type="button" class="pp-group is-clear" data-pp-clear>Clear</button></div>
      <input class="input pp-search" type="search" placeholder="Search people" value="${esc(q)}" aria-label="Search people">
      <div class="pp-list">${shown.map((p) => `<label class="pp-person"><input type="checkbox" data-pp-name="${esc(p.name)}" ${selected.has(p.name) ? "checked" : ""}><span>${esc(p.name)}</span>${p.sectionEditor ? `<small>Section editor</small>` : p.roles.has("admin") ? `<small>Admin</small>` : ""}</label>`).join("") || `<p class="pp-none">No one matches.</p>`}</div>
      <p class="pp-count">${selected.size} ${selected.size === 1 ? "person" : "people"} selected</p>`;
  };
  root.addEventListener("click", (e) => {
    const g = e.target.closest("[data-pp-group]");
    if (g) {
      const fn = GROUPS.find(([id]) => id === g.dataset.ppGroup)[2];
      people.filter(fn).forEach((p) => selected.add(p.name));
      paint(); onChange(); return;
    }
    if (e.target.closest("[data-pp-clear]")) { selected.clear(); paint(); onChange(); }
  });
  root.addEventListener("change", (e) => {
    const c = e.target.closest("[data-pp-name]");
    if (!c) return;
    c.checked ? selected.add(c.dataset.ppName) : selected.delete(c.dataset.ppName);
    root.querySelector(".pp-count").textContent = `${selected.size} ${selected.size === 1 ? "person" : "people"} selected`;
    onChange();
  });
  root.addEventListener("input", (e) => {
    if (!e.target.matches(".pp-search")) return;
    q = e.target.value.trim().toLowerCase();
    const pos = e.target.selectionStart;
    paint();
    const s = root.querySelector(".pp-search"); s.focus(); try { s.setSelectionRange(pos, pos); } catch {}
  });
  paint();
  return { count: () => selected.size };
}

export const peopleUids = (people, names) => [...new Set(people.filter((p) => names.has(p.name)).flatMap((p) => p.uids))];

export const PICKER_CSS = `
.pp-groups { display: flex; flex-wrap: wrap; gap: 6px; }
.pp-group { display: inline-flex; align-items: center; gap: 6px; min-height: 34px; padding: 0 12px; border: 1px solid var(--hairline); border-radius: 99px; background: var(--surface); font: 500 12.5px var(--font); color: var(--ink-2); cursor: pointer; }
.pp-group span { font-size: 11.5px; color: var(--muted); }
.pp-group:hover { border-color: color-mix(in srgb, var(--ink) 28%, transparent); color: var(--ink); }
.pp-group.is-clear { color: var(--muted); }
.pp-search { width: 100%; margin: 10px 0 8px; }
.pp-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 2px 12px; max-height: 240px; overflow: auto; padding: 2px; }
.pp-person { display: flex; align-items: center; gap: 8px; min-height: 36px; font-size: 13.5px; cursor: pointer; }
.pp-person small { margin-left: auto; font-size: 11px; color: var(--muted); }
.pp-none { margin: 6px 0; font-size: 13px; color: var(--muted); }
.pp-count { margin: 8px 0 0; font-size: 12.5px; color: var(--muted); }
.pp-group:focus-visible, .pp-person input:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
`;
