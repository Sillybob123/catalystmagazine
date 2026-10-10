// Writer module — three mount keys:
//   - "draft": compose / edit a draft
//   - "mine":  list the current user's own articles
//   - "feed":  read-only feed of everything in the works across the newsroom

import { db, storage } from "../firebase-config.js";
import {
  collection, query, where, orderBy, getDocs, doc, setDoc, updateDoc,
  addDoc, serverTimestamp, getDoc, onSnapshot, deleteDoc,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { paintSuggestionMarks, renderSuggestionsPanel } from "./editor.js";
import {
  ref as storageRef,
  uploadBytesResumable,
  getDownloadURL,
  listAll,
  getMetadata,
  deleteObject,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";
import { el, esc, fmtRelative, statusPill, slugify, confirmDialog, toast, openModal } from "./ui.js";
import { convertToWebp } from "../image-utils.js";

// Writer self-review checklist. Every item must be checked before a draft
// can be submitted for editor review — mirrors the editor-side checklist
// so writers catch structural issues on their own pass first.
// Canonical topic tags shown as chips in the composer. Must match
// STORY_TOPICS (js/dashboard/admin.js), HOME_TOPIC_ORDER (js/main.js), and
// TOPIC_ORDER (js/articles-new.js) so the writer's choices line up with the
// front-end filter pills. Stored on stories/{id}.tags.
const WRITER_TOPICS = ["AI", "Health", "Medicine", "Biology", "Chemistry",
  "Public Health", "Physics", "Environment", "Space", "Neuroscience",
  "Technology", "Policy"];

const WRITER_CHECKLIST = [
  { id: "lead",       text: "I've written a lead that earns the reader's attention — specific, not a summary." },
  { id: "angle",      text: "The piece has a clear, concrete angle, not just a broad topic." },
  { id: "structure",  text: "Sections flow logically and every paragraph moves the story forward." },
  { id: "quotes",     text: "All quotes are attributed correctly and placed in context." },
  { id: "sources",    text: "Every factual claim is backed by a source I can cite." },
  { id: "terms",      text: "Scientific terms are defined for a college-level reader." },
  { id: "ending",     text: "The ending lands — a quote, callback, or forward-looking implication." },
  { id: "proofread",  text: "I've read the full piece through for grammar, clarity, and flow." },
];

export async function mount(ctx, container) {
  container.innerHTML = "";
  switch (ctx.mountKey) {
    case "draft": return mountDraftEditor(ctx, container);
    case "mine":  return mountMyArticles(ctx, container);
    case "feed":  return mountFeed(ctx, container);
    default:      return mountMyArticles(ctx, container);
  }
}

// ===== Composer icons =======================================================
// One line-icon set (24px grid, 1.75 stroke, round caps) for every control on
// the Write a draft page, so the header, toolbar and menus read as one family.
const WD_ICONS = {
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  back: '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
  bold: '<path d="M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8"/>',
  italic: '<path d="M19 4h-9M14 20H5M15 4 9 20"/>',
  underline: '<path d="M6 4v6a6 6 0 0 0 12 0V4"/><path d="M4 20h16"/>',
  strike: '<path d="M16 4H9a3 3 0 0 0-2.83 4"/><path d="M14 12a4 4 0 0 1 0 8H6"/><path d="M4 12h16"/>',
  sup: '<path d="m4 19 8-8M12 19l-8-8"/><path d="M20 12h-4c0-1.5.44-2 1.5-2.5S20 8.33 20 7c0-.47-.17-.93-.48-1.29a2.11 2.11 0 0 0-2.62-.44c-.42.24-.74.62-.9 1.07"/>',
  sub: '<path d="m4 5 8 8M12 5l-8 8"/><path d="M20 19h-4c0-1.5.44-2 1.5-2.5S20 15.33 20 14c0-.47-.17-.93-.48-1.29a2.11 2.11 0 0 0-2.62-.44c-.42.24-.74.62-.9 1.07"/>',
  color: '<path d="m6 16 6-12 6 12"/><path d="M8.2 11.5h7.6"/>',
  highlight: '<path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>',
  clear: '<path d="M4 7V4h16v3"/><path d="M5 20h6"/><path d="M13 4 8 20"/><path d="m15 15 5 5M20 15l-5 5"/>',
  ul: '<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01" stroke-width="2.6"/>',
  ol: '<path d="M10 6h11M10 12h11M10 18h11"/><path d="M4 6h1v4M4 10h2"/><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/>',
  indent: '<path d="m3 8 4 4-4 4"/><path d="M21 12H11M21 6H11M21 18H11"/>',
  outdent: '<path d="m7 8-4 4 4 4"/><path d="M21 12H11M21 6H11M21 18H11"/>',
  alignLeft: '<path d="M21 6H3M15 12H3M17 18H3"/>',
  alignCenter: '<path d="M21 6H3M17 12H7M19 18H5"/>',
  alignRight: '<path d="M21 6H3M21 12H9M21 18H7"/>',
  alignJustify: '<path d="M3 6h18M3 12h18M3 18h18"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21"/>',
  imagePlus: '<path d="M16 5h6M19 2v6"/><path d="M21 11.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7.5"/><path d="m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21"/><circle cx="9" cy="9" r="2"/>',
  gallery: '<rect x="3" y="3" width="7.5" height="18" rx="1.5"/><rect x="13.5" y="3" width="7.5" height="8" rx="1.5"/><rect x="13.5" y="13" width="7.5" height="8" rx="1.5"/>',
  video: '<path d="m16 13 5.22 3.48a.5.5 0 0 0 .78-.42V7.87a.5.5 0 0 0-.75-.43L16 10.5"/><rect x="2" y="6" width="14" height="12" rx="2"/>',
  quote: '<path d="M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"/><path d="M5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"/>',
  callout: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16"/><path d="M11 9h6M11 13h4"/>',
  stats: '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M18 17V9M13 17V5M8 17v-3"/>',
  divider: '<path d="M3 12h18"/><path d="m8 8 4-4 4 4M16 16l-4 4-4-4"/>',
  section: '<path d="M4 12h8M4 18V6M12 18V6"/><path d="M17 10h4M19 8v4"/><path d="M15 18h6"/>',
  paste: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M9 12h6M9 16h4"/>',
  omega: '<path d="M3 20h4.5a.5.5 0 0 0 .5-.5v-.28a.52.52 0 0 0-.25-.44 8 8 0 1 1 8.5 0 .52.52 0 0 0-.25.44v.28a.5.5 0 0 0 .5.5H21"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  plus: '<path d="M5 12h14M12 5v14"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  up: '<path d="m18 15-6-6-6 6"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  eye: '<path d="M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0"/><circle cx="12" cy="12" r="3"/>',
  sliders: '<path d="M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3"/><path d="M14 2v4M8 10v4M16 18v4"/>',
  book: '<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
  format: '<path d="M4 7V4h16v3"/><path d="M9 20h6M12 4v16"/>',
  keyboard: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M8 12h.01M12 12h.01M16 12h.01M7 16h10"/>',
  quotes: '<path d="M7 7h3v3c0 2-1 3.5-3 4.5"/><path d="M14 7h3v3c0 2-1 3.5-3 4.5"/>',
  outline: '<path d="M3 5h.01M3 12h.01M3 19h.01" stroke-width="2.6"/><path d="M8 5h13M12 12h9M12 19h9"/>',
  save: '<path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7M7 3v4a1 1 0 0 0 1 1h7"/>',
  send: '<path d="M14.54 21.69a.5.5 0 0 0 .94-.03l6.5-19a.5.5 0 0 0-.64-.63l-19 6.5a.5.5 0 0 0-.02.93l7.93 3.18a2 2 0 0 1 1.11 1.11z"/><path d="m21.85 2.15-10.94 10.94"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5M12 3v12"/>',
  library: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  trash: '<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
};
const wdIco = (name, size = 18) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${WD_ICONS[name] || ""}</svg>`;
const WD_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || "");
// Shortcut label for this platform: "mod+shift+x" → "⌘⇧X" on a Mac, "Ctrl+Shift+X" elsewhere.
const wdKeys = (combo) => combo.split("+").map((k) => {
  const m = { mod: WD_MAC ? "⌘" : "Ctrl", shift: WD_MAC ? "⇧" : "Shift", alt: WD_MAC ? "⌥" : "Alt" }[k];
  return m || (k.length === 1 ? k.toUpperCase() : k);
}).join(WD_MAC ? "" : "+");
// A toolbar button. `attr` is its wiring (data-cmd / data-action / data-menu).
const wdBtn = (attr, icon, label, keys) =>
  `<button type="button" class="rt-btn" ${attr} aria-label="${label}" data-tip="${label}${keys ? " · " + wdKeys(keys) : ""}">${wdIco(icon)}</button>`;
// A row in a drop-down menu.
const wdItem = (attr, icon, title, hint, keys) =>
  `<button type="button" class="rt-mi" role="menuitem" ${attr}><span class="rt-mi-ico">${wdIco(icon)}</span><span class="rt-mi-txt"><b>${title}</b>${hint ? `<small>${hint}</small>` : ""}</span>${keys ? `<kbd>${wdKeys(keys)}</kbd>` : ""}</button>`;
// Characters science writers reach for, with what each is for.
const WD_SYMBOLS = [
  ["—", "Em dash"], ["–", "En dash (ranges: 10–20)"], ["…", "Ellipsis"], ["°", "Degree"], ["µ", "Micro"], ["±", "Plus or minus"],
  ["×", "Times"], ["÷", "Divide"], ["≈", "About equal"], ["≠", "Not equal"], ["≤", "Less or equal"], ["≥", "Greater or equal"],
  ["→", "Arrow"], ["←", "Arrow left"], ["↔", "Both ways"], ["∞", "Infinity"], ["√", "Square root"], ["%", "Percent"],
  ["α", "Alpha"], ["β", "Beta"], ["γ", "Gamma"], ["δ", "Delta"], ["Δ", "Delta (change)"], ["λ", "Lambda"],
  ["π", "Pi"], ["σ", "Sigma"], ["Σ", "Sum"], ["Ω", "Omega"], ["θ", "Theta"], ["φ", "Phi"],
  ["²", "Squared"], ["³", "Cubed"], ["½", "Half"], ["¼", "Quarter"], ["§", "Section"], ["•", "Bullet"],
];
const WD_CATEGORIES = ["Feature", "Profile", "Interview", "Op-Ed", "News", "Science"];

// ===== Draft editor =========================================================
function mountDraftEditor(ctx, container) {
  // Support ?edit=<storyId> in hash for editing an existing draft.
  const editingId = getHashParam("edit");

  const wrap = el("div", { class: "compose" });
  const byline = esc(ctx.profile.name || ctx.user.email);
  wrap.innerHTML = `
    <!-- App header: the Suite menu (hamburger), back, the draft's name and
         save state on the left; guides, settings, preview and the two save
         actions on the right. Labels drop to icons (with tooltips) as the
         window narrows, so nothing ever wraps or clips. -->
    <header class="wd-head">
      <div class="wd-head-l">
        <button type="button" class="wd-ibtn" id="wd-menu" aria-label="Open the Suite menu" aria-expanded="false" aria-controls="sidebar" data-tip="Suite menu">${wdIco("menu", 20)}</button>
        <button type="button" class="wd-back" id="back-to-suite" data-tip="Back to the Suite">${wdIco("back", 17)}<span>Back to the Suite</span></button>
        <span class="wd-head-rule" aria-hidden="true"></span>
        <div class="wd-doc">
          <div class="wd-doc-title" id="wd-doc-title">Untitled draft</div>
          <div class="wd-doc-meta">
            <span class="wd-doc-kind">${editingId ? "Draft" : "New draft"}</span>
            <span class="compose-status" id="editor-status" aria-live="polite">${editingId ? "Opening…" : "Not saved yet"}</span>
          </div>
        </div>
      </div>
      <div class="wd-head-r">
        <div class="rt-menuwrap">
          <button type="button" class="wd-hbtn" data-menu="guides" aria-haspopup="menu" aria-expanded="false" data-tip="Guides and shortcuts">${wdIco("book")}<span>Guides</span>${wdIco("chevron", 14)}</button>
          <div class="rt-menu rt-menu-right" role="menu" data-menu-for="guides" hidden>
            ${wdItem('id="editorial-standards-btn"', "book", "Editorial standards", "How Catalyst reports, sources and credits")}
            ${wdItem('id="format-guide-btn"', "format", "How to format an article", "A worked example, block by block")}
            ${wdItem('id="wd-shortcuts-btn"', "keyboard", "Keyboard shortcuts", "Every key that works in here", "mod+/")}
            <div class="rt-menu-sep"></div>
            <button type="button" class="rt-mi" role="menuitemcheckbox" aria-checked="true" id="wd-smart-toggle"><span class="rt-mi-ico">${wdIco("quotes")}</span><span class="rt-mi-txt"><b>Smart punctuation</b><small>Curly quotes, -- to —, ... to …</small></span><span class="wd-switch" aria-hidden="true"></span></button>
          </div>
        </div>
        <button type="button" class="wd-hbtn" id="wd-outline-btn" aria-pressed="false" aria-controls="wd-outline" data-tip="Outline of your headings">${wdIco("outline")}<span>Outline</span></button>
        <button type="button" class="wd-hbtn" id="toggle-settings" data-tip="Category, topics and cover">${wdIco("sliders")}<span>Settings</span></button>
        <button type="button" class="wd-hbtn" id="preview-btn" data-tip="See it as readers will">${wdIco("eye")}<span>Preview</span></button>
        <span class="wd-head-rule" aria-hidden="true"></span>
        <button type="button" class="wd-save" id="save-draft-btn" data-tip="Save draft · ${wdKeys("mod+s")}">${wdIco("save", 17)}<span>Save draft</span></button>
        <button type="button" class="wd-submit" id="submit-btn">${wdIco("send", 16)}<span class="wd-l-long">Submit for review</span><span class="wd-l-short">Submit</span></button>
      </div>
    </header>

    <!-- Formatting toolbar. Every control is on show, in groups: history,
         text style, character formatting, paragraphs, and things to insert.
         Each one names itself (and its shortcut) on hover. -->
    <div class="rt-toolbar" id="rt-toolbar" role="toolbar" aria-label="Formatting">
      <div class="rt-group" aria-label="History">
        ${wdBtn('data-cmd="undo"', "undo", "Undo", "mod+z")}
        ${wdBtn('data-cmd="redo"', "redo", "Redo", "mod+shift+z")}
      </div>
      <div class="rt-group" aria-label="Text style">
        <select class="rt-select" data-block aria-label="Text style" data-tip="Text style">
          <option value="p">Body text</option>
          <option value="lede">Lead paragraph</option>
          <option value="h2">Heading</option>
          <option value="h3">Subheading</option>
          <option value="h4">Section label</option>
          <option value="note">Small print</option>
        </select>
      </div>
      <div class="rt-group" aria-label="Character formatting">
        ${wdBtn('data-cmd="bold"', "bold", "Bold", "mod+b")}
        ${wdBtn('data-cmd="italic"', "italic", "Italic", "mod+i")}
        ${wdBtn('data-cmd="underline"', "underline", "Underline", "mod+u")}
        ${wdBtn('data-cmd="strikeThrough"', "strike", "Strikethrough", "mod+shift+x")}
        ${wdBtn('data-cmd="superscript"', "sup", "Superscript (x²)", "mod+.")}
        ${wdBtn('data-cmd="subscript"', "sub", "Subscript (H₂O)", "mod+,")}
        <label class="rt-btn rt-btn-color" data-tip="Text colour" aria-label="Text colour">
          <span class="rt-color-glyph">${wdIco("color")}<span class="rt-color-bar" id="rt-color-bar-fg" style="background:#0f172a"></span></span>
          <input type="color" data-color="foreground" value="#0f172a" tabindex="-1" aria-hidden="true">
        </label>
        <label class="rt-btn rt-btn-color" data-tip="Highlight" aria-label="Highlight colour">
          <span class="rt-color-glyph">${wdIco("highlight")}<span class="rt-color-bar" id="rt-color-bar-bg" style="background:#fde68a"></span></span>
          <input type="color" data-color="background" value="#fde68a" tabindex="-1" aria-hidden="true">
        </label>
        ${wdBtn('data-action="clear"', "clear", "Clear formatting", "mod+\\")}
      </div>
      <div class="rt-group" aria-label="Paragraph">
        ${wdBtn('data-cmd="insertUnorderedList"', "ul", "Bulleted list", "mod+shift+8")}
        ${wdBtn('data-cmd="insertOrderedList"', "ol", "Numbered list", "mod+shift+7")}
        ${wdBtn('data-action="outdent"', "outdent", "Decrease indent", "shift+Tab")}
        ${wdBtn('data-action="indent"', "indent", "Increase indent", "Tab")}
        <div class="rt-menuwrap">
          <button type="button" class="rt-btn rt-btn-drop" data-menu="align" data-tip="Alignment" aria-label="Alignment" aria-haspopup="menu" aria-expanded="false"><span id="rt-align-ico">${wdIco("alignLeft")}</span>${wdIco("chevron", 12)}</button>
          <div class="rt-menu rt-menu-row" role="menu" data-menu-for="align" hidden>
            ${wdBtn('role="menuitem" data-cmd="justifyLeft"', "alignLeft", "Align left", "mod+shift+l")}
            ${wdBtn('role="menuitem" data-cmd="justifyCenter"', "alignCenter", "Centre", "mod+shift+e")}
            ${wdBtn('role="menuitem" data-cmd="justifyRight"', "alignRight", "Align right", "mod+shift+r")}
            ${wdBtn('role="menuitem" data-cmd="justifyFull"', "alignJustify", "Justify", "mod+shift+j")}
          </div>
        </div>
      </div>
      <div class="rt-group" aria-label="Insert">
        ${wdBtn('data-action="link"', "link", "Link", "mod+k")}
        ${wdBtn('data-action="image" data-dup', "image", "Image")}
        ${wdBtn('data-action="gallery" data-dup', "gallery", "Image grid")}
        ${wdBtn('data-action="blockquote" data-dup', "quote", "Pull quote")}
        ${wdBtn('data-action="callout" data-dup', "callout", "Callout box")}
        ${wdBtn('data-action="stats" data-dup', "stats", "By the numbers")}
        ${wdBtn('data-action="divider" data-dup', "divider", "Divider")}
        <div class="rt-menuwrap">
          ${wdBtn('data-menu="symbols" aria-haspopup="menu" aria-expanded="false"', "omega", "Symbols (°, µ, ±, α…)")}
          <div class="rt-menu rt-menu-symbols" role="menu" data-menu-for="symbols" hidden>
            <div class="rt-menu-label">Symbols</div>
            <div class="rt-sym-grid">${WD_SYMBOLS.map(([c, n]) => `<button type="button" role="menuitem" data-insert="${c}" title="${n}" aria-label="${n}">${c}</button>`).join("")}</div>
          </div>
        </div>
      </div>
      <span class="rt-spacer"></span>
      <div class="rt-group rt-group-end" aria-label="More">
        ${wdBtn('data-action="find"', "search", "Find and replace", "mod+f")}
        <div class="rt-menuwrap">
          <button type="button" class="rt-insert-btn" data-menu="insert" aria-haspopup="menu" aria-expanded="false">${wdIco("plus", 16)}<span>Insert</span>${wdIco("chevron", 13)}</button>
          <div class="rt-menu rt-menu-right rt-menu-insert" role="menu" data-menu-for="insert" hidden>
            <div class="rt-menu-col">
              <div class="rt-menu-label">Pictures</div>
              ${wdItem('data-action="image"', "image", "Image", "Upload, from the library, or a link")}
              ${wdItem('data-action="gallery"', "gallery", "Image grid", "Two or three pictures side by side")}
              ${wdItem('data-action="video"', "video", "Video", "Upload or paste a link")}
              <div class="rt-menu-label">Structure</div>
              ${wdItem('data-action="new-section"', "section", "New section", "A heading and a fresh paragraph")}
              ${wdItem('data-action="divider"', "divider", "Divider", "A quiet break between parts")}
            </div>
            <div class="rt-menu-col">
              <div class="rt-menu-label">Magazine blocks</div>
              ${wdItem('data-action="blockquote"', "quote", "Pull quote", "A line worth reading twice")}
              ${wdItem('data-action="callout"', "callout", "Callout box", "Key takeaway, explainer or side note")}
              ${wdItem('data-action="stats"', "stats", "By the numbers", "Big figures with a short label")}
              <div class="rt-menu-label">Bring text in</div>
              ${wdItem('data-action="paste-gdoc"', "paste", "Paste from Google Docs", "Keeps headings, bold, links and images")}
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Find and replace (opens under the toolbar) -->
    <div class="wd-find" id="wd-find" role="search" aria-label="Find and replace" hidden>
      <div class="wd-find-row">
        <span class="wd-find-ico">${wdIco("search", 16)}</span>
        <input type="text" id="wd-find-q" placeholder="Find in article" aria-label="Find" autocomplete="off" spellcheck="false">
        <span class="wd-find-count" id="wd-find-count" aria-live="polite"></span>
        <button type="button" class="wd-find-nav" id="wd-find-prev" aria-label="Previous match" data-tip="Previous · ${wdKeys("shift+Enter")}">${wdIco("up", 16)}</button>
        <button type="button" class="wd-find-nav" id="wd-find-next" aria-label="Next match" data-tip="Next · Enter">${wdIco("chevron", 16)}</button>
        <button type="button" class="wd-find-nav" id="wd-find-close" aria-label="Close find" data-tip="Close · Esc">${wdIco("close", 16)}</button>
      </div>
      <div class="wd-find-row">
        <span class="wd-find-ico" aria-hidden="true"></span>
        <input type="text" id="wd-find-r" placeholder="Replace with" aria-label="Replace with" autocomplete="off" spellcheck="false">
        <label class="wd-find-case"><input type="checkbox" id="wd-find-case"> Match case</label>
      </div>
      <div class="wd-find-acts">
        <button type="button" class="btn btn-ghost btn-sm" id="wd-find-one">Replace</button>
        <button type="button" class="btn btn-secondary btn-sm" id="wd-find-all">Replace all</button>
      </div>
    </div>

    <div class="wd-stage">
      <!-- Outline: the article's headings; click one to jump there -->
      <nav class="wd-outline" id="wd-outline" aria-label="Article outline" hidden>
        <div class="wd-outline-head"><span>Outline</span><button type="button" class="wd-outline-x" id="wd-outline-x" aria-label="Hide the outline">${wdIco("close", 14)}</button></div>
        <ol class="wd-outline-list" id="wd-outline-list"></ol>
        <p class="wd-outline-empty" id="wd-outline-empty">Headings you add show up here, so you can see the shape of the piece and jump around it.</p>
      </nav>

      <!-- The page -->
      <article class="compose-article" data-has-cover="false">
        <!-- Title block: category, headline, deck, byline, and the cover beside them -->
        <header class="wd-titleblock">
          <div class="wd-title-main">
            <div class="rt-menuwrap wd-kicker-wrap">
              <button type="button" class="wd-kicker" data-menu="category" aria-haspopup="menu" aria-expanded="false" data-tip="Change the category"><span id="hero-category">FEATURE</span>${wdIco("chevron", 12)}</button>
              <div class="rt-menu" role="menu" data-menu-for="category" hidden>
                <div class="rt-menu-label">Category</div>
                ${WD_CATEGORIES.map((c) => `<button type="button" class="rt-mi rt-mi-plain" role="menuitemradio" aria-checked="false" data-cat="${c}"><span class="rt-mi-txt"><b>${c}</b></span><span class="rt-mi-tick">${wdIco("check", 16)}</span></button>`).join("")}
              </div>
            </div>
            <h1 class="wd-headline" id="f-title" contenteditable="true" data-placeholder="Headline" spellcheck="true"></h1>
            <p class="wd-deck" id="f-dek" contenteditable="true" data-placeholder="Deck: one sentence that tells readers why this matters" spellcheck="true"></p>
            <div class="wd-byline">By <b>${byline}</b><span class="dot" aria-hidden="true"></span><span id="hero-reading-time">1 min read</span></div>
          </div>
          <div class="wd-cover" id="wd-cover">
            <div class="wd-cover-img" id="hero-image"></div>
            <div class="wd-cover-empty">
              <span class="wd-cover-ico">${wdIco("imagePlus", 22)}</span>
              <span class="wd-cover-txt"><b>Add a cover image</b><small>The first picture readers see, at the top of the article</small></span>
              <div class="wd-cover-acts">
                <button type="button" data-cover="upload">${wdIco("upload", 15)}Upload</button>
                <button type="button" data-cover="library">${wdIco("library", 15)}Library</button>
              </div>
            </div>
            <div class="wd-cover-tools">
              <button type="button" data-cover="upload" aria-label="Upload a new cover" data-tip="Upload new">${wdIco("upload", 15)}</button>
              <button type="button" data-cover="library" aria-label="Choose a cover from the library" data-tip="From library">${wdIco("library", 15)}</button>
              <button type="button" data-cover="remove" aria-label="Remove the cover" data-tip="Remove">${wdIco("trash", 15)}</button>
            </div>
            <div class="wd-cover-busy" id="wd-cover-busy" hidden><span class="spinner"></span><span id="wd-cover-busy-text">Uploading…</span></div>
          </div>
        </header>

        <!-- Body — the same typography and layouts as the public article page.
             The ghost next to it shows a suggested structure and fades out as
             soon as the writer starts typing. It's a sibling, not a child, so
             it can never end up saved to Firestore. -->
        <div class="compose-body-wrap">
          <div class="compose-body-ghost" id="f-body-ghost" aria-hidden="true">
            <div class="compose-body-ghost-inner">
              <p class="ghost-tag">Suggested structure · click here to start</p>
              <p class="ghost-lead"><strong>Opening paragraph.</strong> Lead with a specific scene, detail, or question that earns the reader's attention — not a summary. This is the hook.</p>
              <p>Add one or two setup paragraphs that establish context, stakes, or your angle. Who, what, and <em>why this matters right now.</em></p>
              <h2 class="rt-section-heading">First section heading</h2>
              <p>Use section headings to break the piece into 2–4 clear movements. Each section should move the story forward and flow logically from the last.</p>
              <figure class="rt-pullquote"><blockquote>A memorable line from your piece, pulled out for emphasis.</blockquote><figcaption>— Attribution</figcaption></figure>
              <h2 class="rt-section-heading">Closing</h2>
              <p>End with a callback to your opening, a forward-looking implication, or the sharpest quote you saved for last.</p>
              <p class="ghost-tip">Shortcuts: type <b>#</b> and a space for a heading, <b>-</b> for a list, <b>1.</b> for a numbered list. Tab indents. ${wdKeys("mod+/")} shows every shortcut.</p>
            </div>
          </div>
          <div class="compose-body article-body"
               id="f-body"
               contenteditable="true"
               spellcheck="true"></div>
        </div>
      </article>
    </div>

    <!-- Status bar -->
    <footer class="wd-statusbar" aria-label="Article statistics">
      <span id="compose-words" aria-live="polite">0 words</span>
      <span class="wd-sb-dim" id="wd-sb-chars">0 characters</span>
      <span class="wd-sb-dim" id="wd-sb-read">1 min read</span>
      <span class="wd-sb-dim" id="wd-sb-parts">No sections yet</span>
      <span class="wd-sb-dim" id="wd-sb-pics">No pictures</span>
      <span class="wd-sb-fill"></span>
      <button type="button" class="wd-sb-btn" id="wd-sb-keys">${wdIco("keyboard", 14)}<span>Shortcuts ${wdKeys("mod+/")}</span></button>
    </footer>

    <!-- Settings drawer (category, cover, hidden fields) -->
    <aside class="compose-settings" id="compose-settings" aria-hidden="true">
      <div class="compose-settings-inner">
        <div class="compose-settings-head">
          <div class="compose-settings-title">Article settings</div>
          <button class="compose-settings-close" id="close-settings" aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="field">
          <label class="label">Category</label>
          <select class="select" id="f-category">
            <option value="Feature">Feature</option>
            <option value="Profile">Profile</option>
            <option value="Interview">Interview</option>
            <option value="Op-Ed">Op-Ed</option>
            <option value="News">News</option>
            <option value="Science">Science</option>
          </select>
          <!-- Inline description that swaps based on the selected
               category. Helps a writer pick the right one when the
               labels alone are ambiguous (Feature vs Profile vs
               Science is non-obvious). Wired by the change-handler
               that already updates .compose-hero-category. -->
          <div class="category-help" id="category-help" data-category="Feature">
            <strong class="category-help-title"></strong>
            <span class="category-help-body"></span>
          </div>
          <p class="field-hint" style="margin-top:10px;color:#64748b;font-size:12px;line-height:1.45;">
            Writing a STEM book review? Use the dedicated
            <a href="#/book-reviews/write" style="color:#0f172a;font-weight:600;">Write a book review</a> page —
            it has the right fields for ISBN, rating, and the book metadata.
          </p>
        </div>
        <div class="field">
          <label class="label">Topics</label>
          <div id="f-topics" class="f-topic-chips" style="display:flex;flex-wrap:wrap;gap:8px;">
            ${WRITER_TOPICS.map(t =>
              `<button type="button" class="f-topic-chip" data-topic="${t}" aria-pressed="false"
                style="padding:6px 14px;border-radius:999px;border:1px solid var(--hairline,#e6e6e6);background:#fff;color:var(--ink-2,#475569);font-size:13px;font-weight:600;cursor:pointer;transition:all .15s ease;">${t}</button>`
            ).join("")}
          </div>
          <div class="hint" style="margin-top:8px;">What subjects does this piece cover? Pick all that apply — these power the topic filters on the home page and Articles index (e.g. a reader looking for AI or Biology stories will find yours).</div>
        </div>
        <div class="field">
          <label class="label">Cover image</label>
          <div class="cover-picker">
            <button type="button" class="btn btn-secondary btn-sm" id="f-cover-upload-btn">Upload from computer</button>
            <button type="button" class="btn btn-ghost btn-sm" id="f-cover-library-btn">Choose from library</button>
            <input type="file" id="f-cover-file" accept="image/*" hidden>
            <div class="cover-picker-progress" id="f-cover-progress" hidden>
              <div class="cover-picker-progress-track"><div class="cover-picker-progress-fill" id="f-cover-progress-fill"></div></div>
              <div class="cover-picker-progress-text" id="f-cover-progress-text">Uploading…</div>
            </div>
          </div>
          <input class="input" id="f-cover" placeholder="https://… or upload above" style="margin-top:10px;">
          <div class="hint">Upload an image (auto-converts to WebP) or paste a public URL.</div>
          <label class="cover-light-toggle">
            <input type="checkbox" id="f-cover-light">
            <span>
              <strong>Cover image is light or bright</strong>
              <span class="cover-light-toggle__hint">Adds a dark overlay so the title stays readable.</span>
            </span>
          </label>
        </div>
        <div class="field">
          <label class="label">Status</label>
          <div class="compose-settings-note">
            Use <strong>Save draft</strong> to keep working, or <strong>Submit for review</strong>
            to send to editors. You can keep editing after submission.
          </div>
        </div>
      </div>
    </aside>
    <div class="compose-settings-scrim" id="settings-scrim"></div>

    <div id="form-msg" class="editor-msg"></div>
  `;
  container.appendChild(wrap);

  const editorEl = wrap.querySelector("#f-body");
  wireRichToolbar(wrap, editorEl, ctx);
  wireHeroPreview(wrap);
  wireSettingsDrawer(wrap);
  wireCoverUpload(wrap, ctx);

  // Writer self-review checklist — shown to writers/editors who need to clear
  // it before submitting for editor review. Admins bypass it entirely (see
  // the submit handler below), so we don't render the card for them.
  const showChecklist = ctx.role !== "admin";
  const checklistCard = el("div", { class: "card", style: { marginTop: "20px", display: showChecklist ? "" : "none" } });
  checklistCard.innerHTML = `
    <div class="card-header">
      <div>
        <div class="card-title">Pre-submission checklist</div>
        <div class="card-subtitle">Every item must be confirmed before you can submit for editor review.</div>
      </div>
      <div class="writer-checklist-progress" id="writer-checklist-progress">0/${WRITER_CHECKLIST.length}</div>
    </div>
    <div class="card-body" id="writer-checklist-body"></div>`;
  container.appendChild(checklistCard);
  const checklistBody = checklistCard.querySelector("#writer-checklist-body");
  const checklistProgress = checklistCard.querySelector("#writer-checklist-progress");
  WRITER_CHECKLIST.forEach((item) => {
    const line = el("label", { class: "checklist-item" });
    line.innerHTML = `
      <input type="checkbox" data-k="${item.id}">
      <span class="checklist-label">${esc(item.text)}</span>`;
    checklistBody.appendChild(line);
  });
  const refreshChecklistProgress = () => {
    const boxes = checklistBody.querySelectorAll('input[type="checkbox"]');
    const done = Array.from(boxes).filter((b) => b.checked).length;
    checklistProgress.textContent = `${done}/${WRITER_CHECKLIST.length}`;
    checklistProgress.classList.toggle("complete", done === WRITER_CHECKLIST.length);
  };
  checklistBody.addEventListener("change", async (e) => {
    const cb = e.target.closest('input[type="checkbox"]');
    if (!cb) return;
    cb.closest(".checklist-item").classList.toggle("done", cb.checked);
    refreshChecklistProgress();
    // Persist checklist state on the story doc so it survives reloads.
    if (editingId) {
      const items = {};
      checklistBody.querySelectorAll('input[type="checkbox"]').forEach((b) => { items[b.dataset.k] = b.checked; });
      try {
        await updateDoc(doc(db, "stories", editingId), {
          writerChecklist: items,
          updatedAt: new Date().toISOString(),
        });
      } catch (err) {
        ctx.toast("Could not save checklist: " + err.message, "error");
      }
    }
  });

  // Comments + suggestions sidebar when editing.
  if (editingId) {
    const suggestions = el("div", { class: "card", style: { marginTop: "20px" } });
    suggestions.innerHTML = `
      <div class="card-header">
        <div>
          <div class="card-title">Editor suggestions</div>
          <div class="card-subtitle">Accept to apply the change. Reject to dismiss.</div>
        </div>
      </div>
      <div class="card-body" id="draft-suggestions"><div class="empty-state">No suggestions yet.</div></div>`;
    container.appendChild(suggestions);
    subscribeToSuggestions(ctx, editingId, wrap, suggestions.querySelector("#draft-suggestions"));

    const comments = el("div", { class: "card", style: { marginTop: "20px" } });
    comments.innerHTML = `
      <div class="card-header"><div class="card-title">Editor feedback</div></div>
      <div class="card-body" id="draft-comments"><div class="loading-state"><div class="spinner"></div>Loading…</div></div>`;
    container.appendChild(comments);
    subscribeToComments(editingId, comments.querySelector("#draft-comments"));
  }

  // Prefill when editing.
  if (editingId) loadDraft(editingId, wrap, ctx);

  wrap.querySelector("#editorial-standards-btn").addEventListener("click", openEditorialStandards);
  wrap.querySelector("#format-guide-btn").addEventListener("click", openFormatGuide);
  wrap.querySelector("#wd-shortcuts-btn").addEventListener("click", openShortcutsDialog);
  wrap.querySelector("#wd-sb-keys").addEventListener("click", openShortcutsDialog);
  wrap.querySelector("#preview-btn").addEventListener("click", () => openArticlePreview(wrap, ctx));
  wrap.querySelector("#save-draft-btn").addEventListener("click", () => saveStory(ctx, wrap, "draft", editingId));
  wrap.querySelector("#submit-btn").addEventListener("click", () => saveStory(ctx, wrap, "pending", editingId));

  // First-edit gate: when the writer starts typing in any compose field
  // (title, deck, body), open the Drive-review explainer. Fires once per
  // page mount so the reminder lands before they invest writing time, but
  // doesn't keep popping up while they work. Admins skip.
  if (ctx.role !== "admin") {
    wireDriveReviewGateOnFirstEdit(wrap);
  }

  // Full screen: the Suite's top bar steps aside and its sidebar becomes a
  // drawer behind the hamburger at the top left (same nav, same width, so
  // nothing in it wraps or clips).
  document.body.classList.add("wr-focus");
  const sidebar = document.getElementById("sidebar");
  const navScrim = document.getElementById("sidebar-scrim");
  const menuBtn = wrap.querySelector("#wd-menu");
  const setNav = (open) => {
    sidebar?.classList.toggle("open", open);
    navScrim?.classList.toggle("open", open);
    document.body.classList.toggle("wr-nav-open", open);
    menuBtn.setAttribute("aria-expanded", String(open));
    menuBtn.setAttribute("aria-label", open ? "Close the Suite menu" : "Open the Suite menu");
    if (open) sidebar?.querySelector(".nav-link")?.focus({ preventScroll: true });
  };
  menuBtn.addEventListener("click", () => setNav(!sidebar?.classList.contains("open")));
  const onScrim = () => setNav(false);
  const onNavClick = (e) => { if (e.target.closest(".nav-link")) setNav(false); };
  navScrim?.addEventListener("click", onScrim);
  sidebar?.addEventListener("click", onNavClick);

  // The header shows the headline as the draft's name.
  const titleEl = wrap.querySelector("#f-title");
  const docTitle = wrap.querySelector("#wd-doc-title");
  const syncDocTitle = () => {
    const t = titleEl.textContent.trim();
    docTitle.textContent = t || "Untitled draft";
    docTitle.classList.toggle("is-empty", !t);
  };
  titleEl.addEventListener("input", syncDocTitle);

  // Status bar: words, characters, reading time, sections and pictures.
  const bodyEl = wrap.querySelector("#f-body"), wordsEl = wrap.querySelector("#compose-words");
  const plural = (n, one) => `${n.toLocaleString()} ${n === 1 ? one : one + "s"}`;
  const setStat = (id, text) => { wrap.querySelector(id).textContent = text; };
  const countWords = () => {
    const text = (bodyEl.textContent || "").replace(/​/g, "").trim();
    const n = text ? text.split(/\s+/).length : 0;
    wordsEl.textContent = plural(n, "word");
    setStat("#wd-sb-chars", plural(text.length, "character"));
    setStat("#wd-sb-read", `${Math.max(1, Math.round(n / 220))} min read`);
    const secs = bodyEl.querySelectorAll("h2").length;
    setStat("#wd-sb-parts", secs ? plural(secs, "section") : "No sections yet");
    const pics = bodyEl.querySelectorAll("figure.rt-figure:not(.rt-figure-video) img, figure.rt-gallery img").length;
    setStat("#wd-sb-pics", pics ? plural(pics, "picture") : "No pictures");
  };
  bodyEl.addEventListener("input", countWords);
  countWords();
  setTimeout(() => { countWords(); syncDocTitle(); }, 1200);   // after a draft loads

  wireOutline(wrap, bodyEl, ctx);

  // Unsaved work: compare against what was last saved (or loaded).
  const snapshot = () => [
    wrap.querySelector("#f-title")?.textContent || "", wrap.querySelector("#f-dek")?.textContent || "",
    wrap.querySelector("#f-body")?.innerHTML || "", wrap.querySelector("#f-cover")?.value || "",
    wrap.querySelector("#f-category")?.value || "", [...wrap.querySelectorAll(".f-topic-chip.is-on")].map((c) => c.dataset.topic).join(","),
  ].join("␞");
  let saved = snapshot();
  let savedAt = null;
  const statusEl = wrap.querySelector("#editor-status");
  const isDirty = () => snapshot() !== saved && (bodyEl.textContent.trim() || wrap.querySelector("#f-title")?.textContent.trim());
  const paintStatus = () => {
    const dirty = !!isDirty();
    statusEl.classList.toggle("is-dirty", dirty);
    statusEl.classList.toggle("saved", !dirty && (!!savedAt || !!editingId));
    if (dirty) statusEl.textContent = "Unsaved changes";
    else if (savedAt) statusEl.textContent = `Saved at ${savedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
    else statusEl.textContent = editingId ? "All changes saved" : "Not saved yet";
  };
  let statusTimer = 0;
  const queueStatus = () => { clearTimeout(statusTimer); statusTimer = setTimeout(paintStatus, 350); };
  wrap.addEventListener("input", queueStatus);
  wrap.addEventListener("change", queueStatus);
  wrap.addEventListener("click", (e) => { if (e.target.closest(".f-topic-chip, [data-cat], [data-cover]")) queueStatus(); });
  setTimeout(() => { saved = snapshot(); paintStatus(); }, editingId ? 2500 : 300);   // after a draft loads
  wrap.addEventListener("story-saved", () => { saved = snapshot(); savedAt = new Date(); paintStatus(); });
  const onBeforeUnload = (e) => { if (isDirty()) { e.preventDefault(); e.returnValue = ""; } };
  window.addEventListener("beforeunload", onBeforeUnload);

  // Page-wide keys: ⌘S saves, ⌘/ lists the shortcuts, Esc closes the menu drawer.
  const onKey = (e) => {
    if (e.key === "Escape" && sidebar?.classList.contains("open")) { setNav(false); menuBtn.focus(); return; }
    if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
    if (document.querySelector("#modal-root .modal-backdrop, .media-dialog-scrim")) return;   // a pop-up has the keyboard
    if (e.key.toLowerCase() === "s" && !e.shiftKey) { e.preventDefault(); saveStory(ctx, wrap, "draft", editingId); }
    else if (e.key === "/") { e.preventDefault(); openShortcutsDialog(); }
  };
  document.addEventListener("keydown", onKey);

  // Back to the Suite: wherever the writer came from (else the Overview).
  const prev = window.__catalystPrevRoute || "";
  const backTo = prev && !prev.startsWith("#/writer/draft") ? prev : "#/overview";
  const leave = () => { location.hash = backTo; };
  wrap.querySelector("#back-to-suite").addEventListener("click", () => {
    if (!isDirty()) return leave();
    const body = el("div", {}, [el("p", { style: { margin: "0" } }, "You have changes that aren't saved yet. Save the draft before you go?")]);
    const keep = el("button", { class: "btn btn-ghost" }, "Keep writing");
    const drop = el("button", { class: "btn btn-secondary" }, "Leave without saving");
    const save = el("button", { class: "btn btn-accent" }, "Save draft and leave");
    const m = openModal({ title: "Leave this draft?", body, footer: [keep, drop, save], stack: true });
    keep.addEventListener("click", m.close);
    drop.addEventListener("click", () => { m.close(); saved = snapshot(); leave(); });
    save.addEventListener("click", async () => {
      save.disabled = true; save.textContent = "Saving…";
      const ok = await saveStory(ctx, wrap, "draft", editingId);
      m.close();
      if (ok) leave();
    });
  });

  return () => {
    document.body.classList.remove("wr-focus", "wr-nav-open");
    sidebar?.classList.remove("open");
    navScrim?.classList.remove("open");
    navScrim?.removeEventListener("click", onScrim);
    sidebar?.removeEventListener("click", onNavClick);
    document.removeEventListener("keydown", onKey);
    window.removeEventListener("beforeunload", onBeforeUnload);
    clearFindHighlights();
  };
}

// Watches the compose fields for the writer's first edit signal (typing,
// pasting, etc.) and opens the Drive-review explainer once. After it shows
// (regardless of accept/cancel) the listeners detach so the writer is never
// interrupted again in the same session.
function wireDriveReviewGateOnFirstEdit(wrap) {
  const fields = [
    wrap.querySelector("#f-title"),
    wrap.querySelector("#f-dek"),
    wrap.querySelector("#f-body"),
  ].filter(Boolean);
  if (!fields.length) return;

  let fired = false;
  const trigger = async (ev) => {
    if (fired) return;
    // Ignore programmatic / non-user events. `beforeinput` covers typing,
    // pasting, and IME composition; `keydown` covers keyboard input that
    // doesn't generate a `beforeinput` (rare, but belt-and-suspenders).
    if (ev && ev.type === "keydown" && (ev.metaKey || ev.ctrlKey || ev.altKey)) return;
    fired = true;
    cleanup();
    await openDriveReviewGate();
    // No matter what they choose, don't block — the modal is informational
    // at this stage; the real submit-time validation lives in saveStory.
  };
  const cleanup = () => {
    fields.forEach((f) => {
      f.removeEventListener("beforeinput", trigger);
      f.removeEventListener("keydown", trigger);
      f.removeEventListener("paste", trigger);
    });
  };
  fields.forEach((f) => {
    f.addEventListener("beforeinput", trigger);
    f.addEventListener("keydown", trigger);
    f.addEventListener("paste", trigger);
  });
}

// ===== Rich-text toolbar wiring =============================================
function wireRichToolbar(wrap, editorEl, ctx) {
  setupBlockBar(editorEl);
  const toolbar = wrap.querySelector("#rt-toolbar");
  try { document.execCommand("defaultParagraphSeparator", false, "p"); } catch {}
  try { wdSmart = localStorage.getItem("catalyst.writer.smart") !== "0"; } catch {}

  // Remember the writer's place in the article, so a control reached with
  // the keyboard (focus has left the page) still acts where they were.
  let lastRange = null;
  document.addEventListener("selectionchange", () => {
    const s = window.getSelection();
    if (s && s.rangeCount && editorEl.contains(s.anchorNode)) lastRange = s.getRangeAt(0).cloneRange();
  });
  const refocus = () => {
    const s = window.getSelection();
    const inside = s && s.rangeCount && editorEl.contains(s.anchorNode);
    editorEl.focus({ preventScroll: true });
    if (!inside && lastRange && editorEl.contains(lastRange.startContainer)) { s.removeAllRanges(); s.addRange(lastRange); }
  };
  const after = () => updateToolbarState(toolbar);

  // An empty article starts with a real paragraph, so the first line can
  // take a heading, list or indent like any other; left untouched, it goes
  // back to empty and the suggested-structure guide returns.
  editorEl.addEventListener("focus", () => {
    if (editorEl.innerHTML.trim()) return;
    editorEl.innerHTML = "<p><br></p>";
    const r = document.createRange(); r.setStart(editorEl.firstChild, 0); r.collapse(true);
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  });
  editorEl.addEventListener("blur", () => {
    if (!editorEl.textContent.replace(/​/g, "").trim() && !editorEl.querySelector("img, video, iframe, hr, figure, aside, .rt-stats")) editorEl.innerHTML = "";
  });

  // Text style
  const styleSel = toolbar.querySelector("[data-block]");
  styleSel.addEventListener("change", () => {
    refocus();
    wdApplyBlockStyle(editorEl, styleSel.value);
    after();
  });

  // Character / paragraph commands
  toolbar.querySelectorAll("[data-cmd]").forEach((btn) => {
    btn.addEventListener("mousedown", (e) => e.preventDefault()); // don't steal focus
    btn.addEventListener("click", () => {
      refocus();
      document.execCommand(btn.dataset.cmd, false, null);
      if (/List$/.test(btn.dataset.cmd)) wdFixLists(editorEl);
      after();
    });
  });

  // Actions (indent, clear, find, and every insert)
  const runAction = (action) => {
    if (action === "find") return openFind();
    refocus();
    if (action === "indent" || action === "outdent") wdChangeIndent(editorEl, action === "indent" ? 1 : -1);
    else if (action === "clear") wdClearFormatting(editorEl);
    else return handleBlockAction(action, editorEl, ctx);
    after();
  };
  toolbar.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("mousedown", (e) => e.preventDefault());
    btn.addEventListener("click", () => runAction(btn.dataset.action));
  });

  // Symbols
  toolbar.querySelectorAll("[data-insert]").forEach((btn) => {
    btn.addEventListener("mousedown", (e) => e.preventDefault());
    btn.addEventListener("click", () => { refocus(); document.execCommand("insertText", false, btn.dataset.insert); });
  });

  // Drop-down menus in the toolbar, the header and the title block.
  wireMenus(toolbar);
  wireMenus(wrap.querySelector(".wd-head"));
  wireMenus(wrap.querySelector(".wd-titleblock"));

  // Smart punctuation switch (Guides menu)
  const smartBtn = wrap.querySelector("#wd-smart-toggle");
  const paintSmart = () => smartBtn.setAttribute("aria-checked", String(wdSmart));
  paintSmart();
  smartBtn.addEventListener("click", () => {
    wdSmart = !wdSmart; paintSmart();
    try { localStorage.setItem("catalyst.writer.smart", wdSmart ? "1" : "0"); } catch {}
    toast(wdSmart ? "Smart punctuation is on." : "Smart punctuation is off.");
  });

  // Category menu on the title block
  const catSel = wrap.querySelector("#f-category");
  const paintCats = () => wrap.querySelectorAll("[data-cat]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.cat === catSel.value)));
  wrap.querySelectorAll("[data-cat]").forEach((b) => b.addEventListener("click", () => {
    catSel.value = b.dataset.cat;
    catSel.dispatchEvent(new Event("change", { bubbles: true }));
  }));
  catSel.addEventListener("change", paintCats);
  paintCats();

  // Cover tile
  wrap.querySelectorAll("[data-cover]").forEach((b) => b.addEventListener("click", () => {
    const what = b.dataset.cover;
    if (what === "upload") wrap.querySelector("#f-cover-file").click();
    else if (what === "library") wrap.querySelector("#f-cover-library-btn").click();
    else if (what === "remove") {
      const inp = wrap.querySelector("#f-cover");
      inp.value = "";
      inp.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }));

  // Find and replace
  const openFind = wireFind(wrap, editorEl);

  // Keys that behave like a word processor: Tab indents, the usual
  // shortcuts format, and a few typed patterns turn into blocks.
  editorEl.addEventListener("keydown", (e) => {
    if (e.isComposing) return;
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === "Tab" && !mod && !e.altKey) {
      e.preventDefault();
      wdChangeIndent(editorEl, e.shiftKey ? -1 : 1);
      return after();
    }
    if (!mod && !e.altKey) {
      if (e.key === " " && wdAutoFormat(editorEl, e)) return after();
      if (e.key === "Enter" && !e.shiftKey && wdAutoDivider(editorEl, e)) return after();
      if (wdSmart) wdSmartPunct(e);
      return;
    }
    if (!mod) return;
    const k = e.key.toLowerCase();
    const run = (cmd) => { e.preventDefault(); document.execCommand(cmd, false, null); if (/List$/.test(cmd)) wdFixLists(editorEl); after(); };
    if (e.altKey) {
      const m = /^Digit([0-5])$/.exec(e.code);
      if (m) { e.preventDefault(); wdApplyBlockStyle(editorEl, ["p", "h2", "h3", "h4", "lede", "note"][+m[1]]); after(); }
      return;
    }
    if (e.shiftKey) {
      if (e.code === "Digit7") return run("insertOrderedList");
      if (e.code === "Digit8") return run("insertUnorderedList");
      if (k === "x") return run("strikeThrough");
      const align = { l: "justifyLeft", e: "justifyCenter", r: "justifyRight", j: "justifyFull" }[k];
      if (align) return run(align);
      return;
    }
    if (k === "k") { e.preventDefault(); handleBlockAction("link", editorEl, ctx); return; }
    if (k === "f") { e.preventDefault(); openFind(); return; }
    if (e.key === ".") return run("superscript");
    if (e.key === ",") return run("subscript");
    if (e.key === "\\") { e.preventDefault(); wdClearFormatting(editorEl); return after(); }
    if (e.key === "]" || e.key === "[") { e.preventDefault(); wdChangeIndent(editorEl, e.key === "]" ? 1 : -1); return after(); }
  });
  // Curly quotes and dashes in the headline and deck too.
  ["#f-title", "#f-dek"].forEach((sel) => wrap.querySelector(sel)?.addEventListener("keydown", (e) => {
    if (!e.isComposing && !e.metaKey && !e.ctrlKey && !e.altKey && wdSmart) wdSmartPunct(e);
  }));

  // Color pickers — native <input type="color"> sit hidden inside the
  // .rt-btn-color labels. Clicking the label opens the OS picker; on
  // change we apply foreColor / hiliteColor and refresh the visible
  // swatch bar so the next click defaults to the same color (Docs-style
  // memory). Selection has to be restored before execCommand because
  // the color popover steals focus from contenteditable on macOS.
  toolbar.querySelectorAll('input[type="color"][data-color]').forEach((inp) => {
    const kind = inp.dataset.color === "foreground" ? "foreColor" : "hiliteColor";
    let savedRange = null;
    // Capture the caret/selection the moment the swatch is clicked,
    // before the OS picker steals focus.
    const captureRange = () => {
      const sel = window.getSelection();
      if (sel && sel.rangeCount && editorEl.contains(sel.anchorNode)) {
        savedRange = sel.getRangeAt(0).cloneRange();
      } else {
        savedRange = null;
      }
    };
    inp.parentElement.addEventListener("mousedown", captureRange);
    inp.parentElement.addEventListener("touchstart", captureRange, { passive: true });
    inp.addEventListener("input", () => {
      if (savedRange) {
        editorEl.focus();
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(savedRange);
      } else {
        editorEl.focus();
      }
      try { document.execCommand("styleWithCSS", false, true); } catch {}
      document.execCommand(kind, false, inp.value);
      // Update the visible swatch bar under the icon so the writer can
      // see (and re-apply) the last color they used.
      const bar = inp.dataset.color === "foreground"
        ? toolbar.querySelector("#rt-color-bar-fg")
        : toolbar.querySelector("#rt-color-bar-bg");
      if (bar) bar.style.background = inp.value;
      updateToolbarState(toolbar);
    });
  });

  // Reflect active states as user moves caret
  const update = () => updateToolbarState(toolbar);
  editorEl.addEventListener("keyup", update);
  editorEl.addEventListener("mouseup", update);
  editorEl.addEventListener("input", update);

  // Keyboard shortcuts are handled natively by contenteditable for B/I/U.

  // Paste handling:
  //   - If the clipboard has Google Docs / Word HTML (headings, styled runs,
  //     or embedded images), run it through the same importer the "Paste from
  //     Google Doc" button uses. Images are uploaded to Firebase Storage and
  //     their <img src> rewritten to the CDN URL, so we never inline massive
  //     base64 into the article body (which would blow Firestore's 1 MB doc
  //     limit on save).
  //   - Otherwise, insert plain text so we don't smuggle in foreign styles.
  editorEl.addEventListener("paste", (e) => {
    const cd = e.clipboardData || window.clipboardData;
    const html = cd.getData("text/html") || "";
    const text = cd.getData("text/plain") || "";

    if (html && looksLikeRichPaste(html)) {
      e.preventDefault();
      importRichPasteInline(html, editorEl, ctx);
      return;
    }

    e.preventDefault();
    document.execCommand("insertText", false, text);
  });

  // ── "New section?" hint after double-Enter ────────────────────────────
  //
  // When a writer hits Enter on an already-empty paragraph (i.e. they've
  // left a blank line between blocks of text), surface a floating chip
  // near the caret offering to drop a section heading + paragraph there.
  // It's strictly opt-in: clicking the chip inserts the section, pressing
  // Esc dismisses, typing or moving the caret hides it. No keystroke is
  // intercepted, so the editor still behaves normally if the writer
  // ignores the chip.
  installSectionHintFlow(editorEl);

  // Click on an inserted image/video figure → open the edit dialog so the
  // writer can change size, caption, alt text, or replace/remove the media.
  // We don't hijack clicks on the <video> element itself — those should play
  // the video, not open the dialog.
  editorEl.addEventListener("click", (e) => {
    const quizFig = e.target.closest("figure.rt-quiz");
    if (quizFig && editorEl.contains(quizFig)) {
      e.preventDefault();
      openQuizDialog(editorEl, ctx, quizFig);
      return;
    }
    const gallery = e.target.closest("figure.rt-gallery");
    if (gallery && editorEl.contains(gallery)) {
      e.preventDefault();
      openGalleryDialog(editorEl, ctx, gallery);
      return;
    }
    const figure = e.target.closest("figure.rt-figure");
    if (!figure || !editorEl.contains(figure)) return;
    if (e.target.tagName === "VIDEO") return; // let native controls work
    e.preventDefault();
    const kind = figure.classList.contains("rt-figure-video") ? "video" : "image";
    openMediaDialog(kind, editorEl, ctx, figure);
  });
}

function updateToolbarState(toolbar) {
  const check = (cmd) => {
    try { return document.queryCommandState(cmd); } catch { return false; }
  };
  toolbar.querySelectorAll("[data-cmd]").forEach((btn) => {
    const cmd = btn.dataset.cmd;
    if (["bold", "italic", "underline", "strikeThrough", "insertUnorderedList", "insertOrderedList",
         "subscript", "superscript", "justifyLeft", "justifyCenter", "justifyRight", "justifyFull"].includes(cmd)) {
      btn.classList.toggle("active", check(cmd));
    }
  });
  // The style box and the alignment button show where the caret is.
  const editorEl = document.getElementById("f-body");
  const sel = window.getSelection();
  if (!editorEl || !sel || !sel.rangeCount || !editorEl.contains(sel.anchorNode)) return;
  const styleSel = toolbar.querySelector("[data-block]");
  if (styleSel && document.activeElement !== styleSel) styleSel.value = wdCurrentStyle(editorEl);
  const alignIco = toolbar.querySelector("#rt-align-ico");
  if (alignIco) {
    const a = check("justifyCenter") ? "alignCenter" : check("justifyRight") ? "alignRight" : check("justifyFull") ? "alignJustify" : "alignLeft";
    if (alignIco.dataset.a !== a) { alignIco.dataset.a = a; alignIco.innerHTML = wdIco(a); }
  }
}

// ===== Composer: menus, paragraph styles, indents, typing helpers ===========
let wdSmart = true;   // smart punctuation (Guides menu; remembered per browser)

// Drop-down menus inside `root`: a [data-menu="x"] button opens the
// [data-menu-for="x"] panel. Arrows move, Escape closes and returns focus,
// choosing an item or clicking elsewhere closes. Menus that would run off
// the screen open the other way.
function wireMenus(root) {
  if (!root) return () => {};
  const btns = [...root.querySelectorAll("[data-menu]")];
  const menuOf = (b) => root.querySelector(`[data-menu-for="${b.dataset.menu}"]`);
  const close = (except) => btns.forEach((b) => {
    if (b === except) return;
    const m = menuOf(b);
    if (m && !m.hidden) { m.hidden = true; b.setAttribute("aria-expanded", "false"); b.classList.remove("is-open"); }
  });
  const place = (m, btn) => {
    m.style.left = ""; m.style.right = ""; m.style.top = "";
    if (getComputedStyle(m).position === "fixed") {   // phones: the toolbar scrolls, so the menu can't hang off it
      const b = btn.getBoundingClientRect();
      m.style.top = `${b.bottom + 6}px`;
      m.style.left = `${Math.max(8, Math.min(b.left, window.innerWidth - m.offsetWidth - 8))}px`;
      m.style.right = "auto";
      return;
    }
    const r = m.getBoundingClientRect();
    if (r.right > window.innerWidth - 8) { m.style.left = "auto"; m.style.right = "0"; }
    else if (r.left < 8) { m.style.left = "0"; m.style.right = "auto"; }
  };
  btns.forEach((btn) => {
    btn.addEventListener("mousedown", (e) => e.preventDefault());   // keep the writer's selection
    btn.addEventListener("click", () => {
      const m = menuOf(btn), open = m.hidden;
      close(btn);
      m.hidden = !open; btn.setAttribute("aria-expanded", String(open)); btn.classList.toggle("is-open", open);
      if (open) place(m, btn);
    });
    btn.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
        e.preventDefault(); const m = menuOf(btn);
        if (m.hidden) btn.click();
        m.querySelector("button")?.focus();
      }
    });
  });
  root.querySelectorAll(".rt-menu").forEach((m) => {
    m.addEventListener("mousedown", (e) => { if (e.target.closest("button")) e.preventDefault(); });
    m.addEventListener("click", (e) => { if (e.target.closest("button") && !e.target.closest('[role="menuitemcheckbox"]')) close(); });
    m.addEventListener("keydown", (e) => {
      const items = [...m.querySelectorAll("button")], i = items.indexOf(document.activeElement);
      const owner = root.querySelector(`[data-menu="${m.dataset.menuFor}"]`);
      if (e.key === "ArrowDown" || e.key === "ArrowRight") { e.preventDefault(); items[(i + 1) % items.length]?.focus(); }
      else if (e.key === "ArrowUp" || e.key === "ArrowLeft") { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
      else if (e.key === "Escape" || e.key === "Tab") { close(); if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); owner?.focus(); } }
    });
  });
  document.addEventListener("mousedown", (e) => { if (!root.contains(e.target) || !e.target.closest?.(".rt-menuwrap")) close(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
  return close;
}

// The block (paragraph, heading, list item…) that holds `node`.
function wdBlockOf(editorEl, node) {
  let n = node && (node.nodeType === 1 ? node : node.parentNode);
  while (n && n !== editorEl) {
    if (/^(P|DIV|H1|H2|H3|H4|LI|BLOCKQUOTE|FIGCAPTION)$/.test(n.tagName)) return n;
    n = n.parentNode;
  }
  return null;
}
// Every block the selection touches (or the caret's block).
function wdSelectedBlocks(editorEl, selector = "p, h2, h3, h4, li") {
  const s = window.getSelection();
  if (!s || !s.rangeCount) return [];
  const r = s.getRangeAt(0);
  if (!editorEl.contains(r.startContainer)) return [];
  const first = wdBlockOf(editorEl, r.startContainer);
  const pick = (b) => b && b.matches(selector) && !b.closest('[contenteditable="false"]');
  if (r.collapsed) return pick(first) ? [first] : [];
  const all = [...editorEl.querySelectorAll(selector)].filter((b) => r.intersectsNode(b) && pick(b));
  return all.length ? all : (pick(first) ? [first] : []);
}
function wdCurrentStyle(editorEl) {
  const s = window.getSelection();
  const b = s && s.rangeCount ? wdBlockOf(editorEl, s.anchorNode) : null;
  if (!b) return "p";
  if (/^H[1-4]$/.test(b.tagName)) return b.tagName === "H1" ? "h2" : b.tagName.toLowerCase();
  if (b.classList.contains("rt-lede")) return "lede";
  if (b.classList.contains("rt-note")) return "note";
  return "p";
}
const wdTidyClass = (b) => { if (!b.getAttribute("class")) b.removeAttribute("class"); };

// Text styles: body text, lead paragraph, heading, subheading, section
// label, small print. Lead and small print are paragraphs with a class
// (rt-lede / rt-note), styled the same in css/article-layouts.css.
function wdApplyBlockStyle(editorEl, v) {
  const tag = { lede: "p", note: "p", h2: "h2", h3: "h3", h4: "h4" }[v] || "p";
  document.execCommand("formatBlock", false, tag);
  wdSelectedBlocks(editorEl, "p, h2, h3, h4").forEach((b) => {
    b.classList.remove("rt-lede", "rt-note");
    if (v === "lede" || v === "note") b.classList.add(`rt-${v}`);
    wdTidyClass(b);
  });
  editorEl.dispatchEvent(new Event("input", { bubbles: true }));
}

// Tab / Shift+Tab. In a list it nests or un-nests the item; anywhere else
// it steps the paragraph in or out (three steps, rt-indent-1..3), because
// the browser's own indent wraps paragraphs in a blockquote — which this
// magazine prints as a pull quote.
function wdChangeIndent(editorEl, dir) {
  const blocks = wdSelectedBlocks(editorEl);
  if (!blocks.length) return;
  if (blocks.some((b) => b.closest("li"))) { document.execCommand(dir > 0 ? "indent" : "outdent", false, null); return; }
  blocks.forEach((b) => {
    const lvl = +((/\brt-indent-(\d)\b/.exec(b.className) || [])[1] || 0);
    const next = Math.max(0, Math.min(3, lvl + dir));
    b.classList.remove("rt-indent-1", "rt-indent-2", "rt-indent-3");
    if (next) b.classList.add(`rt-indent-${next}`);
    wdTidyClass(b);
  });
  editorEl.dispatchEvent(new Event("input", { bubbles: true }));
}

// Clear formatting: plain text, and the paragraph's indent, alignment,
// lead / small-print style back to normal. Headings stay headings.
function wdClearFormatting(editorEl) {
  document.execCommand("removeFormat", false, null);
  wdSelectedBlocks(editorEl, "p, h2, h3, h4, li").forEach((b) => {
    b.classList.remove("rt-indent-1", "rt-indent-2", "rt-indent-3", "rt-lede", "rt-note");
    b.style.removeProperty("text-align");
    if (!b.getAttribute("style")) b.removeAttribute("style");
    wdTidyClass(b);
  });
  editorEl.dispatchEvent(new Event("input", { bubbles: true }));
}

// Typed shortcuts at the start of a paragraph, then a space:
//   #  heading   ##  subheading   ###  section label   -  or  *  bullets   1.  numbers
function wdAutoFormat(editorEl, e) {
  const s = window.getSelection();
  if (!s || !s.rangeCount || !s.isCollapsed) return false;
  const r = s.getRangeAt(0);
  const block = wdBlockOf(editorEl, r.startContainer);
  if (!block || block.tagName !== "P" || block.closest("li, figure, aside, .rt-stats, blockquote")) return false;
  const pre = document.createRange();
  pre.selectNodeContents(block);
  pre.setEnd(r.startContainer, r.startOffset);
  const token = pre.toString().replace(/​/g, "");
  const rule = { "#": ["h2"], "##": ["h3"], "###": ["h4"], "-": [null, "insertUnorderedList"], "*": [null, "insertUnorderedList"], "1.": [null, "insertOrderedList"], "1)": [null, "insertOrderedList"] }[token];
  if (!rule) return false;
  e.preventDefault();
  s.removeAllRanges(); s.addRange(pre);
  document.execCommand("delete", false, null);
  if (rule[0]) document.execCommand("formatBlock", false, rule[0]);
  else { document.execCommand(rule[1], false, null); wdFixLists(editorEl); }
  editorEl.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}
// Chrome sometimes builds a new list inside the paragraph it came from
// (<p><ul>…</ul></p>). Lift such lists out, keeping the caret where it was.
function wdFixLists(editorEl) {
  editorEl.querySelectorAll(":scope p > ul, :scope p > ol").forEach((list) => {
    const p = list.parentElement;
    const rest = [...p.childNodes].filter((n) => n !== list && !(n.nodeType === 3 && !n.data.trim()) && n.nodeName !== "BR");
    if (rest.length) p.after(list);
    else p.replaceWith(list);
  });
}
// "---" (or ***) on its own line, then Enter: a divider.
function wdAutoDivider(editorEl, e) {
  const s = window.getSelection();
  if (!s || !s.rangeCount || !s.isCollapsed) return false;
  const block = wdBlockOf(editorEl, s.anchorNode);
  if (!block || block.tagName !== "P" || block.parentNode !== editorEl) return false;
  if (!["---", "—-", "***", "___"].includes(block.textContent.replace(/​/g, "").trim())) return false;
  e.preventDefault();
  const hr = document.createElement("hr");
  hr.className = "rt-divider";
  const next = document.createElement("p");
  next.innerHTML = "<br>";
  block.replaceWith(hr);
  hr.after(next);
  const r = document.createRange(); r.setStart(next, 0); r.collapse(true);
  s.removeAllRanges(); s.addRange(r);
  editorEl.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}
// Curly quotes and apostrophes, -- to an em dash, ... to an ellipsis.
function wdSmartPunct(e) {
  if (e.key.length !== 1 || !`"'-.`.includes(e.key)) return false;
  const s = window.getSelection();
  if (!s || !s.rangeCount || !s.isCollapsed) return false;
  const r = s.getRangeAt(0), n = r.startContainer;
  const before = n.nodeType === 3 ? n.data.slice(0, r.startOffset) : "";
  const prev = before.slice(-1);
  const opening = !prev || /[\s([{—–\-“‘ ​]/.test(prev);
  let out = null, back = 0;
  if (e.key === '"') out = opening ? "“" : "”";
  else if (e.key === "'") out = opening ? "‘" : "’";
  else if (e.key === "-" && prev === "-") { out = "—"; back = 1; }
  else if (e.key === "." && before.endsWith("..")) { out = "…"; back = 2; }
  if (!out) return false;
  e.preventDefault();
  if (back) {
    const rr = document.createRange();
    rr.setStart(n, r.startOffset - back); rr.setEnd(n, r.startOffset);
    s.removeAllRanges(); s.addRange(rr);
  }
  document.execCommand("insertText", false, out);
  return true;
}

// ===== Find and replace =====================================================
// Matches are painted with the CSS Custom Highlight API (no change to the
// article's HTML); replacing goes through insertText so ⌘Z undoes it.
// Text inside pictures (captions are edited in the picture window) is skipped.
function clearFindHighlights() {
  try { CSS.highlights?.delete("wd-find"); CSS.highlights?.delete("wd-find-cur"); } catch {}
}
function wireFind(wrap, editorEl) {
  const panel = wrap.querySelector("#wd-find");
  const q = panel.querySelector("#wd-find-q"), rep = panel.querySelector("#wd-find-r");
  const mc = panel.querySelector("#wd-find-case"), count = panel.querySelector("#wd-find-count");
  const canPaint = typeof CSS !== "undefined" && CSS.highlights && typeof Highlight !== "undefined";
  let matches = [], idx = -1;
  const paint = () => {
    count.textContent = q.value ? (matches.length ? `${idx + 1} of ${matches.length}` : "No matches") : "";
    count.classList.toggle("is-none", !!q.value && !matches.length);
    if (!canPaint) return;
    clearFindHighlights();
    if (matches.length) {
      CSS.highlights.set("wd-find", new Highlight(...matches));
      if (idx >= 0) CSS.highlights.set("wd-find-cur", new Highlight(matches[idx]));
    }
  };
  const search = (keepIdx) => {
    matches = [];
    const term = q.value;
    if (term) {
      const needle = mc.checked ? term : term.toLowerCase();
      const walker = document.createTreeWalker(editorEl, NodeFilter.SHOW_TEXT, {
        acceptNode: (t) => t.parentElement?.closest('[contenteditable="false"]') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
      });
      for (let t = walker.nextNode(); t; t = walker.nextNode()) {
        const hay = mc.checked ? t.data : t.data.toLowerCase();
        for (let i = hay.indexOf(needle); i !== -1; i = hay.indexOf(needle, i + needle.length)) {
          const r = document.createRange(); r.setStart(t, i); r.setEnd(t, i + term.length); matches.push(r);
        }
      }
    }
    idx = matches.length ? Math.min(keepIdx ?? 0, matches.length - 1) : -1;
    paint();
  };
  const show = () => {
    const r = matches[idx];
    if (!r) return;
    const box = r.getBoundingClientRect();
    const tb = wrap.querySelector("#rt-toolbar").getBoundingClientRect();
    if (box.top < tb.bottom + 80 || box.bottom > window.innerHeight - 80) {
      window.scrollBy({ top: box.top - window.innerHeight / 2, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    }
  };
  const go = (d) => { if (!matches.length) return; idx = (idx + d + matches.length) % matches.length; paint(); show(); };
  const replaceAt = (r) => {
    const s = window.getSelection();
    editorEl.focus({ preventScroll: true });
    s.removeAllRanges(); s.addRange(r);
    document.execCommand("insertText", false, rep.value);
  };
  const place = () => {
    const tb = wrap.querySelector("#rt-toolbar").getBoundingClientRect();
    panel.style.top = `${Math.max(8, tb.bottom + 8)}px`;
  };
  const open = () => {
    const s = window.getSelection();
    const picked = s && s.rangeCount && editorEl.contains(s.anchorNode) ? s.toString().trim() : "";
    if (picked && picked.length < 80 && !picked.includes("\n")) q.value = picked;
    panel.hidden = false;
    place();
    q.focus(); q.select();
    search();
  };
  const close = () => { panel.hidden = true; matches = []; idx = -1; clearFindHighlights(); editorEl.focus({ preventScroll: true }); };
  q.addEventListener("input", () => search());
  mc.addEventListener("change", () => search());
  q.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); go(e.shiftKey ? -1 : 1); } });
  rep.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); panel.querySelector("#wd-find-one").click(); } });
  panel.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); } });
  panel.querySelector("#wd-find-next").addEventListener("click", () => go(1));
  panel.querySelector("#wd-find-prev").addEventListener("click", () => go(-1));
  panel.querySelector("#wd-find-close").addEventListener("click", close);
  panel.querySelector("#wd-find-one").addEventListener("click", () => {
    if (idx < 0) return;
    const at = idx;
    replaceAt(matches[idx]);
    search(at); show();
    q.focus();
  });
  panel.querySelector("#wd-find-all").addEventListener("click", () => {
    if (!matches.length) return;
    const n = matches.length;
    for (let i = matches.length - 1; i >= 0; i--) replaceAt(matches[i]);
    search();
    toast(`Replaced ${n} match${n === 1 ? "" : "es"}.`, "success");
    q.focus();
  });
  editorEl.addEventListener("input", () => { if (!panel.hidden && document.activeElement === editorEl) search(idx); });
  window.addEventListener("resize", () => { if (!panel.hidden) place(); });
  return open;
}

// ===== Outline ==============================================================
// The article's headings in the left margin; click one to jump to it.
function wireOutline(wrap, bodyEl, ctx) {
  const nav = wrap.querySelector("#wd-outline");
  const list = wrap.querySelector("#wd-outline-list");
  const empty = wrap.querySelector("#wd-outline-empty");
  const btn = wrap.querySelector("#wd-outline-btn");
  const KEY = `catalyst.writer.outline.${ctx.user?.uid || "anon"}`;
  let pref = null;
  try { pref = localStorage.getItem(KEY); } catch {}
  const set = (on, remember) => {
    nav.hidden = !on;
    wrap.classList.toggle("has-outline", on);
    btn.setAttribute("aria-pressed", String(on));
    if (remember) { try { localStorage.setItem(KEY, on ? "1" : "0"); } catch {} }
  };
  set(pref ? pref === "1" : window.innerWidth >= 1400, false);
  btn.addEventListener("click", () => set(nav.hidden, true));
  wrap.querySelector("#wd-outline-x").addEventListener("click", () => { set(false, true); btn.focus(); });
  let heads = [];
  const build = () => {
    heads = [...bodyEl.querySelectorAll("h2, h3")].filter((h) => h.textContent.trim());
    list.innerHTML = `<li class="lv-0"><button type="button" data-i="-1">Headline and opening</button></li>` +
      heads.map((h, i) => `<li class="lv-${h.tagName[1]}"><button type="button" data-i="${i}">${esc(h.textContent.trim())}</button></li>`).join("");
    empty.hidden = heads.length > 0;
  };
  let t = 0;
  bodyEl.addEventListener("input", () => { clearTimeout(t); t = setTimeout(build, 300); });
  build();
  setTimeout(build, 1300);   // after a draft loads
  list.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-i]");
    if (!b) return;
    const i = +b.dataset.i;
    const target = i < 0 ? wrap.querySelector(".wd-titleblock") : heads[i];
    if (!target) return;
    const smooth = !matchMedia("(prefers-reduced-motion: reduce)").matches;
    const top = target.getBoundingClientRect().top + window.scrollY - (i < 0 ? 140 : 170);
    window.scrollTo({ top: Math.max(0, top), behavior: smooth ? "smooth" : "auto" });
    if (i >= 0) {
      bodyEl.focus({ preventScroll: true });
      const r = document.createRange(); r.selectNodeContents(target); r.collapse(false);
      const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
    }
    list.querySelectorAll("button").forEach((x) => x.classList.toggle("is-current", x === b));
  });
}

// ===== Keyboard shortcuts ===================================================
function openShortcutsDialog() {
  const groups = [
    ["Writing", [["Save draft", "mod+s"], ["Undo", "mod+z"], ["Redo", "mod+shift+z"], ["Find and replace", "mod+f"], ["Add a link", "mod+k"], ["Line break in a paragraph", "shift+Enter"], ["This list", "mod+/"]]],
    ["Characters", [["Bold", "mod+b"], ["Italic", "mod+i"], ["Underline", "mod+u"], ["Strikethrough", "mod+shift+x"], ["Superscript (x²)", "mod+."], ["Subscript (H₂O)", "mod+,"], ["Clear formatting", "mod+\\"]]],
    ["Paragraphs", [["Body text", "mod+alt+0"], ["Heading", "mod+alt+1"], ["Subheading", "mod+alt+2"], ["Section label", "mod+alt+3"], ["Lead paragraph", "mod+alt+4"], ["Small print", "mod+alt+5"], ["Bulleted list", "mod+shift+8"], ["Numbered list", "mod+shift+7"], ["Indent", "Tab"], ["Decrease indent", "shift+Tab"], ["Align left · centre · right · justify", "mod+shift+l / e / r / j"]]],
    ["Type at the start of a line", [["Heading", "# then space"], ["Subheading", "## then space"], ["Section label", "### then space"], ["Bulleted list", "- then space"], ["Numbered list", "1. then space"], ["Divider", "--- then Enter"]]],
    ["Smart punctuation", [["Curly quotes", "\" and '"], ["Em dash —", "--"], ["Ellipsis …", "..."]]],
  ];
  const keyHtml = (k) => {
    if (/ then |^"/.test(k) || k === "--" || k === "...") return `<kbd>${esc(k)}</kbd>`;
    return k.split(" / ").map((part, i) => (i ? `<span class="wd-keys-or">/</span>` : "") + `<kbd>${esc(wdKeys(part))}</kbd>`).join("");
  };
  const body = el("div", { class: "wd-keys" });
  body.innerHTML = groups.map(([name, rows]) => `
    <section class="wd-keys-group">
      <h3>${esc(name)}</h3>
      <dl>${rows.map(([what, k]) => `<div><dt>${esc(what)}</dt><dd>${keyHtml(k)}</dd></div>`).join("")}</dl>
    </section>`).join("");
  openModal({ title: "Keyboard shortcuts", body, stack: true, size: "wide" });
}

// ─── "New section?" hint ────────────────────────────────────────────────────
//
// Watches for the "Enter on an already-empty paragraph" pattern (Google
// Docs / Notion both treat this gesture as a request to insert
// something). When detected, we render a small floating chip near the
// caret offering to convert the empty space into a new section
// (heading + paragraph, the same block "+ New section" inserts).
//
// Strictly opt-in:
//   • clicking the chip → inserts the section at the caret
//   • Esc                → dismisses, won't re-show until next gesture
//   • typing / moving caret → dismisses
//   • outside click       → dismisses
//
// We don't preventDefault on Enter; the editor still behaves normally.
function installSectionHintFlow(editorEl) {
  let hintEl = null;

  const removeHint = () => {
    if (!hintEl) return;
    hintEl.remove();
    hintEl = null;
  };

  // Find the block-level ancestor (P/DIV) the caret currently sits in.
  // Returns null if the caret isn't inside the editor.
  const blockAtCaret = () => {
    const sel = window.getSelection();
    if (!sel.rangeCount) return null;
    const node = sel.getRangeAt(0).startContainer;
    let n = node.nodeType === 1 ? node : node.parentNode;
    while (n && n !== editorEl && !/^(P|DIV|H1|H2|H3|H4|LI|BLOCKQUOTE)$/i.test(n.tagName)) {
      n = n.parentNode;
    }
    return n && n !== editorEl ? n : null;
  };

  const isEmptyBlock = (block) => {
    if (!block) return false;
    const t = (block.textContent || "").replace(/​/g, "").trim();
    return t === "";
  };

  const showHintNear = (block) => {
    removeHint();
    const rect = block.getBoundingClientRect();
    if (!rect.width) return;
    const chip = document.createElement("div");
    chip.className = "rt-section-hint";
    chip.setAttribute("role", "dialog");
    chip.setAttribute("aria-label", "Insert new section?");
    chip.innerHTML = `
      <button type="button" class="rt-section-hint-action" data-hint-action="insert">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        <span>Insert new section</span>
        <kbd>↵</kbd>
      </button>
      <button type="button" class="rt-section-hint-dismiss" data-hint-action="dismiss" aria-label="Dismiss">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    `;
    document.body.appendChild(chip);

    // Position right of the empty block, vertically centered on it.
    // Falls below if there isn't room on the right.
    const chipRect = chip.getBoundingClientRect();
    const top = window.scrollY + rect.top + (rect.height / 2) - (chipRect.height / 2);
    let left = window.scrollX + rect.left + Math.min(rect.width * 0.5, 60);
    // If we'd overflow the viewport on the right, anchor to the left
    // edge of the block instead.
    if (left + chipRect.width > window.scrollX + window.innerWidth - 12) {
      left = window.scrollX + rect.left;
    }
    chip.style.top = `${top}px`;
    chip.style.left = `${left}px`;

    // Wire chip actions.
    chip.addEventListener("mousedown", (e) => e.preventDefault());
    chip.querySelector("[data-hint-action='insert']").addEventListener("click", () => {
      // Place the caret inside the empty block, then run the existing
      // new-section action (heading + paragraph) which uses the same
      // insertBlockAtCaret path the toolbar uses.
      const range = document.createRange();
      range.selectNodeContents(block);
      range.collapse(true);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      removeHint();
      handleBlockAction("new-section", editorEl, null);
    });
    chip.querySelector("[data-hint-action='dismiss']").addEventListener("click", removeHint);

    hintEl = chip;
  };

  // The chip is shown only when the caret is on a *second consecutive*
  // empty block — i.e. the writer has hit Enter into a blank line. We
  // detect that on keyup of Enter rather than keydown so the new
  // paragraph element exists in the DOM by the time we check.
  editorEl.addEventListener("keyup", (e) => {
    if (e.key !== "Enter") return;
    const block = blockAtCaret();
    if (!block || !isEmptyBlock(block)) { removeHint(); return; }
    const prev = block.previousElementSibling;
    if (!prev || !isEmptyBlock(prev)) { removeHint(); return; }
    showHintNear(block);
  });

  // Any subsequent keystroke other than Enter dismisses the chip.
  editorEl.addEventListener("keydown", (e) => {
    if (!hintEl) return;
    if (e.key === "Escape") {
      e.preventDefault();
      removeHint();
      return;
    }
    if (e.key !== "Enter" && e.key !== "Shift" && e.key !== "Meta" && e.key !== "Control" && e.key !== "Alt") {
      removeHint();
    }
  });

  // Clicks outside the editor or chip dismiss.
  document.addEventListener("mousedown", (e) => {
    if (!hintEl) return;
    if (hintEl.contains(e.target) || editorEl.contains(e.target)) return;
    removeHint();
  });

  // Reposition / dismiss on scroll so the chip doesn't float over the
  // wrong line as the writer scrolls.
  window.addEventListener("scroll", removeHint, { passive: true });
}

function handleBlockAction(action, editorEl, ctx) {
  editorEl.focus();
  if (action === "link") {
    openLinkDialog(editorEl, captureEditorRange(editorEl));
    return;
  }
  if (action === "divider") {
    insertDividerAtCaret(editorEl);
    return;
  }
  if (action === "blockquote") {
    openQuoteDialog(editorEl, captureEditorRange(editorEl));
    return;
  }
  if (action === "image") {
    openMediaDialog("image", editorEl, ctx, null, captureEditorRange(editorEl));
    return;
  }
  if (action === "video") {
    openMediaDialog("video", editorEl, ctx, null, captureEditorRange(editorEl));
    return;
  }
  if (action === "gallery") {
    openGalleryDialog(editorEl, ctx, null, captureEditorRange(editorEl));
    return;
  }
  if (action === "callout") {
    insertBlockAfterCaret(editorEl, `<aside class="rt-callout" data-tone="paper"><p class="rt-callout-label">Key takeaway</p><p>Write the one thing a reader should remember from this section.</p></aside>`, ".rt-callout p:not(.rt-callout-label)");
    editorEl.dispatchEvent(new Event("input", { bubbles: true }));
    return;
  }
  if (action === "stats") {
    const stat = (n, l) => `<div class="rt-stat"><p class="rt-stat-num">${n}</p><p class="rt-stat-label">${l}</p></div>`;
    insertBlockAfterCaret(editorEl, `<div class="rt-stats rt-stats-3">${stat("40%", "what the first number means")}${stat("3×", "what the second number means")}${stat("1 in 5", "what the third number means")}</div>`, ".rt-stat-num");
    editorEl.dispatchEvent(new Event("input", { bubbles: true }));
    return;
  }
  if (action === "paste-gdoc") {
    openGoogleDocPasteDialog(editorEl, ctx);
    return;
  }
  if (action === "quiz") {
    openQuizDialog(editorEl, ctx, null);
    return;
  }
  if (action === "new-section") {
    // Gap + heading + empty paragraph. The zero-width space in the <p>
    // keeps contenteditable from collapsing the empty paragraph.
    const html = `<p><br/></p><h2 class="rt-section-heading">New section</h2><p>&#8203;</p>`;
    insertBlockAtCaret(editorEl, html);
    // Select the "New section" text so the user can type right over it.
    const headings = editorEl.querySelectorAll("h2.rt-section-heading");
    const heading = headings[headings.length - 1];
    if (heading) {
      const range = document.createRange();
      range.selectNodeContents(heading);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
    return;
  }
}

// ===== Google Docs paste ====================================================
// Opens a dialog where writers paste from a Google Doc (or upload a .docx).
// We sanitize the HTML, map Docs' styles to our magazine blocks, extract any
// images the Doc carried over, upload them to Firebase Storage, rewrite their
// <img src> to point at the uploaded file, and then insert the result into
// the article body.
function openGoogleDocPasteDialog(editorEl, ctx) {
  const scrim = el("div", { class: "media-dialog-scrim" });
  const modal = el("div", { class: "media-dialog", style: { maxWidth: "820px" } });
  modal.innerHTML = `
    <div class="media-dialog-head">
      <div class="media-dialog-title">Paste from Google Doc</div>
      <button class="media-dialog-close" aria-label="Close">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <div class="media-dialog-body">
      <div class="hint" style="margin-bottom:10px;">
        Paste directly from your Google Doc below (⌘A, ⌘C, then ⌘V here). Headings, bold, italic, links, lists, quotes, and images all carry over.
        If an image didn't come through, use the <strong>Upload .docx</strong> option — it's 100% reliable.
      </div>
      <div id="gdoc-paste-target"
           contenteditable="true"
           style="min-height:180px;max-height:260px;overflow:auto;border:1px dashed var(--hairline-2);border-radius:10px;padding:14px 16px;background:var(--surface-1);font-family:inherit;"
           data-placeholder="Paste your Google Doc content here…"></div>
      <div class="hint" id="gdoc-count" style="margin-top:8px;">Waiting for paste…</div>

      <div style="margin-top:14px;padding-top:14px;border-top:1px dashed var(--hairline-2);">
        <div class="hint" style="margin-bottom:8px;">
          <strong>Fallback:</strong> export your Doc (File → Download → Microsoft Word .docx) and drop it here. This is the most reliable way to bring images across.
        </div>
        <label class="btn btn-ghost btn-sm" style="cursor:pointer;">
          <input type="file" id="gdoc-docx" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" style="display:none;" />
          Upload .docx file
        </label>
        <span id="gdoc-docx-name" class="hint" style="margin-left:10px;"></span>
      </div>

      <div class="field" style="margin-top:14px;">
        <label class="label" style="display:flex;align-items:center;gap:8px;cursor:pointer;">
          <input type="checkbox" id="gdoc-replace" />
          <span>Replace the entire article body (otherwise content is inserted at the cursor)</span>
        </label>
      </div>
      <div id="gdoc-progress" class="hint" style="margin-top:10px;display:none;"></div>
      <div class="media-error" id="gdoc-error"></div>
    </div>
    <div class="media-dialog-foot">
      <button class="btn btn-ghost btn-sm" id="gdoc-cancel">Cancel</button>
      <button class="btn btn-accent btn-sm" id="gdoc-insert" disabled>Insert into article</button>
    </div>
  `;
  document.body.appendChild(scrim);
  document.body.appendChild(modal);
  requestAnimationFrame(() => { scrim.classList.add("open"); modal.classList.add("open"); });

  const target = modal.querySelector("#gdoc-paste-target");
  const countEl = modal.querySelector("#gdoc-count");
  const insertBtn = modal.querySelector("#gdoc-insert");
  const replaceBox = modal.querySelector("#gdoc-replace");
  const errorEl = modal.querySelector("#gdoc-error");
  const progressEl = modal.querySelector("#gdoc-progress");
  const docxInput = modal.querySelector("#gdoc-docx");
  const docxName = modal.querySelector("#gdoc-docx-name");

  const close = () => {
    scrim.classList.remove("open");
    modal.classList.remove("open");
    setTimeout(() => { scrim.remove(); modal.remove(); }, 200);
  };
  modal.querySelector(".media-dialog-close").addEventListener("click", close);
  modal.querySelector("#gdoc-cancel").addEventListener("click", close);
  scrim.addEventListener("click", close);

  let cleanedHtml = "";
  let busy = false;

  const setBusy = (on, message = "") => {
    busy = on;
    insertBtn.disabled = on || !cleanedHtml;
    progressEl.style.display = on || message ? "block" : "none";
    progressEl.textContent = message;
  };

  const updateCount = () => {
    const words = (target.textContent || "").trim().split(/\s+/).filter(Boolean).length;
    const imgs = target.querySelectorAll("img").length;
    const parts = [];
    if (words) parts.push(`about ${words.toLocaleString()} word${words === 1 ? "" : "s"}`);
    if (imgs) parts.push(`${imgs} image${imgs === 1 ? "" : "s"}`);
    countEl.textContent = cleanedHtml
      ? `Ready to insert — ${parts.join(", ") || "content parsed"}.`
      : "Nothing to paste yet.";
  };

  // Run the async import pipeline: convert clipboard HTML, upload every image
  // to Firebase Storage, and rewrite <img src> to point at the uploaded file.
  const runImport = async (rawHtml, plain) => {
    errorEl.textContent = "";
    if (!rawHtml && !plain) {
      cleanedHtml = "";
      target.innerHTML = `<p style="color:var(--muted-2)">Nothing to paste.</p>`;
      updateCount();
      insertBtn.disabled = true;
      return;
    }
    if (!rawHtml) {
      cleanedHtml = plainTextToHtml(plain);
      target.innerHTML = cleanedHtml;
      updateCount();
      insertBtn.disabled = !cleanedHtml;
      return;
    }

    setBusy(true, "Parsing your Doc…");
    try {
      const { wrapper, imageNodes } = convertGoogleDocsHtml(rawHtml);

      if (imageNodes.length) {
        const failures = [];
        let done = 0;
        const total = imageNodes.length;
        const updateProgress = () => {
          progressEl.textContent = `Uploading images… ${done}/${total}`;
        };
        updateProgress();

        // Upload in parallel (capped to 4 at a time to avoid hammering storage).
        await runWithConcurrency(imageNodes, 4, async (node) => {
          try {
            const uploaded = await uploadPastedImage(node.src, node.filename, ctx);
            node.el.setAttribute("src", uploaded);
            node.el.setAttribute("data-uploaded", "1");
          } catch (err) {
            failures.push({ src: node.src, err });
            // Leave the original src on the image and tag it so the writer
            // sees which ones didn't transfer.
            node.el.setAttribute("data-upload-failed", "1");
          } finally {
            done++;
            updateProgress();
          }
        });

        if (failures.length) {
          errorEl.textContent = `${failures.length} image${failures.length === 1 ? "" : "s"} couldn't be uploaded automatically. Try the .docx upload below for those.`;
        }
      }

      // Re-serialize AFTER uploads so the rewritten src="firebase://..." URLs
      // land in the inserted HTML instead of the original data: URIs.
      cleanedHtml = wrapper.innerHTML;
      target.innerHTML = cleanedHtml;
      updateCount();
      insertBtn.disabled = !cleanedHtml;
    } catch (err) {
      errorEl.textContent = "Could not parse the Doc: " + (err?.message || err);
    } finally {
      setBusy(false, "");
    }
  };

  // Intercept the paste so we can read Google Docs' HTML directly instead of
  // whatever the browser would insert into a contenteditable.
  target.addEventListener("paste", (e) => {
    e.preventDefault();
    if (busy) return;
    const cd = e.clipboardData || window.clipboardData;
    const html = cd.getData("text/html") || "";
    const plain = cd.getData("text/plain") || "";
    runImport(html, plain);
  });

  // .docx upload — use mammoth.js to convert to HTML, then run it through the
  // same image-upload pipeline. mammoth gives us data:image URLs for embedded
  // images, which always upload cleanly.
  docxInput.addEventListener("change", async () => {
    const file = docxInput.files && docxInput.files[0];
    if (!file) return;
    docxName.textContent = file.name;
    setBusy(true, "Converting .docx…");
    try {
      const mammoth = await loadMammoth();
      const buf = await file.arrayBuffer();
      const result = await mammoth.convertToHtml(
        { arrayBuffer: buf },
        {
          // Map Word heading styles explicitly so we get the right levels.
          styleMap: [
            "p[style-name='Title'] => h1:fresh",
            "p[style-name='Heading 1'] => h1:fresh",
            "p[style-name='Heading 2'] => h2:fresh",
            "p[style-name='Heading 3'] => h3:fresh",
            "p[style-name='Heading 4'] => h4:fresh",
            "p[style-name='Quote'] => blockquote:fresh",
            "p[style-name='Intense Quote'] => blockquote:fresh",
          ],
        }
      );
      setBusy(true, "Parsing document…");
      await runImport(result.value, "");
    } catch (err) {
      errorEl.textContent = "Could not read .docx: " + (err?.message || err);
      setBusy(false, "");
    }
  });

  // Focus the target so the user can immediately paste.
  requestAnimationFrame(() => target.focus());

  insertBtn.addEventListener("click", () => {
    if (!cleanedHtml || busy) return;
    // Pull the LIVE preview HTML, not the snapshot from the last paste — the
    // writer may have deleted paragraphs or edited text inside the preview
    // before hitting Insert. Fall back to the snapshot if the preview is
    // somehow empty.
    const liveHtml = (target.innerHTML || "").trim();
    const htmlToInsert = liveHtml || cleanedHtml;
    try {
      if (replaceBox.checked) {
        editorEl.innerHTML = htmlToInsert;
      } else {
        insertBlockAtCaret(editorEl, htmlToInsert);
      }
      // execCommand("insertHTML") and assigning innerHTML both sometimes nest
      // a <figure> inside a <p> or drop contenteditable="false" — that breaks
      // the click-to-edit handler. Walk every figure we just inserted and
      // make sure it's at block level with the flags the toolbar expects.
      // Also wrap any stray <img> that landed outside a figure, and strip
      // width/height attributes so CSS can control sizing.
      stripInlineImgDimensions(editorEl);
      upgradeLegacyImages(editorEl);
      normalizeEditorFigures(editorEl);
      editorEl.dispatchEvent(new Event("input", { bubbles: true }));
      ctx?.toast?.("Pasted from Google Doc.", "success");
      close();
    } catch (err) {
      errorEl.textContent = "Could not insert: " + (err?.message || err);
    }
  });
}

// Repair pasted/inserted figures so the editor's click-to-edit flow works:
//   - hoist figures out of any surrounding <p> (execCommand loves to nest them)
//   - ensure contenteditable="false" so clicks don't drop a caret inside them
//   - ensure a size class (defaults to rt-size-standard)
//   - ensure data-rt-figure so the toolbar's click handler recognizes them
function normalizeEditorFigures(editorEl) {
  editorEl.querySelectorAll("figure.rt-gallery").forEach((fig) => {
    let parent = fig.parentElement;
    while (parent && parent !== editorEl && /^(p|div|span)$/i.test(parent.tagName) && !parent.classList.contains("rt-gallery-grid")) {
      parent.parentElement.insertBefore(fig, parent);
      if (!parent.textContent.trim() && !parent.querySelector("img, video, figure")) parent.remove();
      parent = fig.parentElement;
    }
    fig.setAttribute("contenteditable", "false");
  });
  editorEl.querySelectorAll("figure.rt-figure").forEach((fig) => {
    // Hoist out of <p> / <div> wrappers that the browser added around it.
    let parent = fig.parentElement;
    while (parent && parent !== editorEl && /^(p|div|span)$/i.test(parent.tagName)) {
      parent.parentElement.insertBefore(fig, parent);
      // If the wrapper is now empty, drop it; otherwise leave the other text.
      if (!parent.textContent.trim() && !parent.querySelector("img, video, figure")) {
        parent.remove();
      }
      parent = fig.parentElement;
    }
    fig.setAttribute("contenteditable", "false");
    const isVideo = fig.classList.contains("rt-figure-video") || fig.querySelector("video");
    if (!fig.hasAttribute("data-rt-figure")) {
      fig.setAttribute("data-rt-figure", isVideo ? "video" : "image");
    }
    if (!/\brt-size-[a-z]+\b/.test(fig.className)) {
      fig.classList.add("rt-size-standard");
    }
  });
}

// Google Docs (and Word) paste <img width="..." height="..." style="width: ..."
// ...>, and those attributes win against "max-width: 100%" — the image gets
// resized to a different aspect ratio and looks cropped/stretched. Strip
// them so our CSS controls sizing purely from the figure's size class.
function stripInlineImgDimensions(editorEl) {
  editorEl.querySelectorAll("img").forEach((img) => {
    img.removeAttribute("width");
    img.removeAttribute("height");
    const style = img.getAttribute("style") || "";
    if (style) {
      const cleaned = style
        .split(";")
        .map((rule) => rule.trim())
        .filter((rule) => rule && !/^(width|height|max-width|max-height|min-width|min-height|aspect-ratio)\s*:/i.test(rule))
        .join("; ");
      if (cleaned) img.setAttribute("style", cleaned);
      else img.removeAttribute("style");
    }
  });
}

// Wrap any bare <img> that isn't already inside a .rt-figure. Legacy drafts
// and some rich pastes can leave raw <img> tags in the body, which the click
// handler ignores (it only matches figure.rt-figure). This converts each one
// into a proper editable figure so writers can click to edit size/alt/caption.
function upgradeLegacyImages(editorEl) {
  const bareImgs = Array.from(editorEl.querySelectorAll("img")).filter((img) => !img.closest("figure.rt-figure, figure.rt-gallery"));
  bareImgs.forEach((img) => {
    const src = img.getAttribute("src") || "";
    if (!src) { img.remove(); return; }
    const alt = img.getAttribute("alt") || "";

    const figure = document.createElement("figure");
    figure.className = "rt-figure rt-size-standard";
    figure.setAttribute("contenteditable", "false");
    figure.setAttribute("data-rt-figure", "image");
    const newImg = document.createElement("img");
    newImg.setAttribute("src", src);
    newImg.setAttribute("alt", alt);
    figure.appendChild(newImg);

    // Swap the bare img for the figure. If the img's only ancestor up to the
    // editor is a <p>/<div> that held nothing else, drop the wrapper too so
    // we don't leave an empty paragraph behind.
    let replaceTarget = img;
    let wrapper = img.parentElement;
    while (
      wrapper && wrapper !== editorEl &&
      /^(p|div|span)$/i.test(wrapper.tagName) &&
      wrapper.childNodes.length === 1
    ) {
      replaceTarget = wrapper;
      wrapper = wrapper.parentElement;
    }
    replaceTarget.parentNode.replaceChild(figure, replaceTarget);
  });
}

// Dynamically load mammoth.js from a CDN the first time it's needed. We hang
// it off `window.mammoth` so a second .docx in the same session reuses it.
function loadMammoth() {
  if (window.mammoth) return Promise.resolve(window.mammoth);
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js";
    script.crossOrigin = "anonymous";
    script.onload = () => {
      if (window.mammoth) resolve(window.mammoth);
      else reject(new Error("mammoth failed to register"));
    };
    script.onerror = () => reject(new Error("Could not load mammoth.js (check your connection)"));
    document.head.appendChild(script);
  });
}

// Run `task` across `items` with at most `limit` in flight at once.
async function runWithConcurrency(items, limit, task) {
  const results = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await task(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
}

// Walk the editor body and upload any <img> that still has a data: URI src
// (e.g. a paste import where an upload failed, or an image dropped into the
// contenteditable directly by the browser). Replaces each data: src with the
// uploaded Storage URL in place. Silently skips images that are already
// pointing at https URLs.
async function uploadInlineDataImages(bodyEl, ctx, onProgress) {
  const imgs = Array.from(bodyEl.querySelectorAll("img")).filter((img) => {
    const src = img.getAttribute("src") || "";
    return src.startsWith("data:");
  });
  if (!imgs.length) return;

  let done = 0;
  const total = imgs.length;
  onProgress && onProgress(done, total);

  await runWithConcurrency(imgs, 3, async (img) => {
    const src = img.getAttribute("src") || "";
    const altName = (img.getAttribute("alt") || "pasted") + extFromMimeOrUrl(src);
    try {
      const uploaded = await uploadPastedImage(src, altName, ctx);
      img.setAttribute("src", uploaded);
      img.setAttribute("data-uploaded", "1");
      img.removeAttribute("data-upload-failed");
    } finally {
      done++;
      onProgress && onProgress(done, total);
    }
  });
}

// Convert a pasted <img src> into a File, push it to Firebase Storage via the
// same content-hash pipeline used by the media dialog, and return the public
// download URL. Works for:
//   - data:image/… (Docs desktop app, mammoth.js .docx conversion)
//   - https://lh*.googleusercontent.com/… (Docs browser paste) — subject to CORS
//   - any other https image URL the Doc happened to carry
async function uploadPastedImage(src, filename, ctx) {
  let blob;
  if (src.startsWith("data:")) {
    blob = await (await fetch(src)).blob();
  } else {
    // Cross-origin fetch — if the remote blocks CORS this throws, which the
    // caller catches and reports as a per-image failure.
    const res = await fetch(src, { mode: "cors", credentials: "omit" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    blob = await res.blob();
  }
  if (!blob.type.startsWith("image/")) {
    throw new Error(`Not an image (type: ${blob.type || "unknown"})`);
  }
  const safeName = (filename || "pasted-image").replace(/[^a-z0-9._-]/gi, "_").slice(0, 60);
  const file = new File([blob], safeName, { type: blob.type });
  return await uploadToFirebase(file, "image", ctx);
}

// Detect clipboard HTML that's worth running through the Google Docs
// importer. We don't want to invoke the heavy pipeline for trivial pastes
// (a single styled word from another tab), but we MUST catch anything that
// carries images or Docs-shaped structure — otherwise base64 <img> URIs end
// up in the body and Firestore rejects the save with "too many bytes".
function looksLikeRichPaste(html) {
  if (!html) return false;
  // Images (base64 or remote) are the #1 reason we need to run the importer.
  if (/<img\b/i.test(html)) return true;
  // Google Docs always includes this marker wrapper.
  if (/id="docs-internal-guid/i.test(html)) return true;
  // Headings, lists, tables, blockquotes — import as magazine blocks.
  if (/<(h[1-6]|ul|ol|blockquote|table|figure)\b/i.test(html)) return true;
  return false;
}

// Run a pasted HTML blob through the Google Docs importer and insert the
// result at the current caret. Image uploads happen in the background; we
// insert placeholders first so the writer sees immediate feedback, then
// swap each <img src> to the Storage URL as uploads complete.
async function importRichPasteInline(rawHtml, editorEl, ctx) {
  const savedRange = captureEditorRange(editorEl);

  let converted;
  try {
    converted = convertGoogleDocsHtml(rawHtml);
  } catch (err) {
    console.warn("[paste] could not parse clipboard HTML, falling back to plain text", err);
    const text = new DOMParser().parseFromString(rawHtml, "text/html").body?.textContent || "";
    document.execCommand("insertText", false, text);
    return;
  }

  const { wrapper, imageNodes } = converted;
  const html = wrapper ? wrapper.innerHTML : "";
  if (!html) return;

  // Insert the converted HTML first so the writer sees the content land in
  // place. Each <img> carries its original data:/https src for now; we'll
  // rewrite them to uploaded URLs as the async uploads complete via the
  // liveBySrc map below.
  insertBlockAtCaret(editorEl, html, savedRange);
  stripInlineImgDimensions(editorEl);
  upgradeLegacyImages(editorEl);
  normalizeEditorFigures(editorEl);
  editorEl.dispatchEvent(new Event("input", { bubbles: true }));

  if (!imageNodes.length) return;

  // The <img> nodes that convertGoogleDocsHtml returned live in a detached
  // wrapper, not in the editor. Group the live editor <img>s by src so we
  // can update every copy when an upload finishes (dedupes by src, which is
  // what writers expect — pasting the same image twice should upload once
  // and share the URL).
  const liveBySrc = new Map();
  editorEl.querySelectorAll("img").forEach((img) => {
    const s = img.getAttribute("src") || "";
    if (!s) return;
    if (!liveBySrc.has(s)) liveBySrc.set(s, []);
    liveBySrc.get(s).push(img);
  });

  // One upload per distinct src (imageNodes may list the same src multiple
  // times if the Doc repeats an image).
  const uniqueSrcs = new Map();
  imageNodes.forEach((n) => {
    if (n.src && liveBySrc.has(n.src) && !uniqueSrcs.has(n.src)) {
      uniqueSrcs.set(n.src, n);
    }
  });
  const pending = Array.from(uniqueSrcs.values());
  if (!pending.length) return;

  ctx?.toast?.(`Uploading ${pending.length} pasted image${pending.length === 1 ? "" : "s"}…`, "info");
  let failed = 0;

  await runWithConcurrency(pending, 4, async (node) => {
    const liveImgs = (liveBySrc.get(node.src) || []).filter((img) => editorEl.contains(img));
    if (!liveImgs.length) return;
    try {
      const uploaded = await uploadPastedImage(node.src, node.filename, ctx);
      liveImgs.forEach((img) => {
        img.setAttribute("src", uploaded);
        img.setAttribute("data-uploaded", "1");
      });
    } catch (err) {
      failed++;
      liveImgs.forEach((img) => img.setAttribute("data-upload-failed", "1"));
      console.warn("[paste] image upload failed", err);
    }
  });

  editorEl.dispatchEvent(new Event("input", { bubbles: true }));
  if (failed) {
    ctx?.toast?.(`${failed} image${failed === 1 ? "" : "s"} couldn't upload. Click each to re-upload, or use the .docx option.`, "error");
  } else {
    ctx?.toast?.("Pasted images uploaded.", "success");
  }
}

// Convert Google Docs clipboard HTML into our magazine structure.
// Returns { html, imageNodes } where imageNodes is a live-ish list of
// { el, src, filename } records the caller can upload and rewrite.
function convertGoogleDocsHtml(rawHtml) {
  // Docs wraps the real content in a <b id="docs-internal-guid-…"> or similar;
  // parse with DOMParser so we never inject the raw string into the DOM.
  const doc = new DOMParser().parseFromString(rawHtml, "text/html");

  // Strip <style>, <meta>, <script>, and Google's comment wrappers.
  doc.querySelectorAll("style, meta, script, link, title").forEach((n) => n.remove());

  // If Docs wrapped everything in a single <b id="docs-internal-…">, unwrap it
  // (otherwise the entire article would end up bold).
  doc.querySelectorAll('b[id^="docs-internal-guid"]').forEach((b) => {
    const parent = b.parentNode;
    while (b.firstChild) parent.insertBefore(b.firstChild, b);
    parent.removeChild(b);
  });

  const body = doc.body;
  if (!body) return { html: "", imageNodes: [] };

  // Walk the top-level children and convert each one to a magazine block.
  const out = [];
  body.childNodes.forEach((node) => {
    const block = convertGDocBlock(node);
    if (block) out.push(block);
  });

  // Collapse consecutive empty paragraphs and trailing blanks.
  const rawJoined = out.join("\n").replace(/(<p><br\/?><\/p>\s*){2,}/g, "<p><br/></p>").trim();
  const normalized = normalizeGDocText(rawJoined);

  // Parse the final string once more so we can return live <img> references
  // for the async upload step. The caller mutates these .el nodes in place
  // and must re-serialize wrapper.innerHTML AFTER uploads run — that's why we
  // return the live wrapper, not a pre-serialized string.
  const wrapper = document.createElement("div");
  wrapper.innerHTML = normalized;
  const imageNodes = Array.from(wrapper.querySelectorAll("img"))
    .map((img) => ({
      el: img,
      src: img.getAttribute("src") || "",
      filename: (img.getAttribute("alt") || "pasted") + extFromMimeOrUrl(img.getAttribute("src") || ""),
    }))
    .filter((n) => n.src);

  return { wrapper, imageNodes };
}

function extFromMimeOrUrl(src) {
  if (src.startsWith("data:image/png")) return ".png";
  if (src.startsWith("data:image/jpeg") || src.startsWith("data:image/jpg")) return ".jpg";
  if (src.startsWith("data:image/webp")) return ".webp";
  if (src.startsWith("data:image/gif")) return ".gif";
  const m = src.match(/\.(png|jpe?g|webp|gif)(\?|$)/i);
  return m ? `.${m[1].toLowerCase()}` : ".png";
}

// Tidy up the quirks Docs leaves in text: stray non-breaking spaces, weird
// double-space runs, straight quotes where Docs already had curly ones, and
// zero-width characters it sometimes sprinkles around.
function normalizeGDocText(html) {
  return html
    .replace(/[\u200B-\u200D\uFEFF]/g, "")  // zero-width joiners/space
    .replace(/\u00A0/g, " ")                 // non-breaking → regular space
    .replace(/ {2,}/g, " ");
}

function convertGDocBlock(node) {
  if (node.nodeType === Node.TEXT_NODE) {
    const t = node.nodeValue.replace(/\s+/g, " ").trim();
    return t ? `<p>${escapeHtml(t)}</p>` : "";
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const tag = node.tagName.toLowerCase();

  // Google Docs maps heading levels to HEADING_1..HEADING_4 in HTML as h1-h4.
  // Our editor treats h2.rt-section-heading as the top-level magazine section
  // break, h3 as a subheading inside a section, h4 as a small eyebrow label.
  if (tag === "h1" || tag === "h2") {
    const inner = convertGDocInline(node);
    // Empty gap before a new section so it visually separates in the editor.
    return inner ? `<p><br/></p><h2 class="rt-section-heading">${inner}</h2>` : "";
  }
  if (tag === "h3") {
    const inner = convertGDocInline(node);
    return inner ? `<h3>${inner}</h3>` : "";
  }
  if (tag === "h4" || tag === "h5" || tag === "h6") {
    const inner = convertGDocInline(node);
    return inner ? `<h4>${inner}</h4>` : "";
  }
  if (tag === "ul" || tag === "ol") {
    const items = [];
    node.querySelectorAll(":scope > li").forEach((li) => {
      const inner = convertGDocInline(li);
      if (inner) items.push(`<li>${inner}</li>`);
    });
    return items.length ? `<${tag}>${items.join("")}</${tag}>` : "";
  }
  if (tag === "blockquote") {
    const inner = convertGDocInline(node);
    return inner ? `<figure class="rt-pullquote"><blockquote>${inner}</blockquote></figure>` : "";
  }
  if (tag === "hr") return `<hr class="rt-divider" />`;
  if (tag === "br") return "";
  if (tag === "table") {
    // Magazine doesn't style raw tables — flatten rows into paragraphs.
    const rows = [];
    node.querySelectorAll("tr").forEach((tr) => {
      const cells = [];
      tr.querySelectorAll("td, th").forEach((c) => {
        const t = convertGDocInline(c);
        if (t) cells.push(t);
      });
      if (cells.length) rows.push(`<p>${cells.join(" · ")}</p>`);
    });
    return rows.join("\n");
  }
  if (tag === "figure") {
    // Word/mammoth sometimes wraps images in <figure>. Dive in for the <img>
    // and any <figcaption>.
    const img = node.querySelector("img");
    const cap = node.querySelector("figcaption");
    if (img) {
      const src = img.getAttribute("src") || "";
      if (!src) return "";
      const alt = img.getAttribute("alt") || "";
      const captionHtml = cap ? `<figcaption><span class="fig-caption-text">${escapeHtml(cap.textContent.trim())}</span></figcaption>` : "";
      return `<figure class="rt-figure rt-size-standard" contenteditable="false" data-rt-figure="image"><img src="${escapeAttr(src)}" alt="${escapeAttr(alt)}" />${captionHtml}</figure>`;
    }
    return "";
  }
  if (tag === "img") {
    const src = node.getAttribute("src") || "";
    if (!src) return "";
    const alt = node.getAttribute("alt") || "";
    return `<figure class="rt-figure rt-size-standard" contenteditable="false" data-rt-figure="image"><img src="${escapeAttr(src)}" alt="${escapeAttr(alt)}" /></figure>`;
  }
  if (tag === "p" || tag === "div") {
    // If the paragraph is just an image (Docs loves to wrap <img> in <p>),
    // hoist it to a figure block.
    const onlyImg = node.children.length === 1 && node.children[0].tagName.toLowerCase() === "img" && !node.textContent.trim();
    if (onlyImg) {
      return convertGDocBlock(node.children[0]);
    }
    // Docs sometimes wraps a heading inside a <p>; if the paragraph has a
    // single heading-ish child, recurse.
    if (node.children.length === 1 && /^h[1-6]$/i.test(node.children[0].tagName)) {
      return convertGDocBlock(node.children[0]);
    }
    const inner = convertGDocInline(node);
    if (!inner) return `<p><br/></p>`;
    return `<p>${inner}</p>`;
  }
  // Unknown element — recurse into children so we don't drop content.
  const parts = [];
  node.childNodes.forEach((child) => {
    const b = convertGDocBlock(child);
    if (b) parts.push(b);
  });
  return parts.join("\n");
}

// Convert inline runs inside a block. Looks at the element's inline style as
// well as the tag name — Google Docs encodes bold/italic via
// `font-weight: 700` and `font-style: italic` on <span>s rather than <b>/<i>.
function convertGDocInline(node) {
  if (node.nodeType === Node.TEXT_NODE) {
    return escapeHtml(node.nodeValue);
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const tag = node.tagName.toLowerCase();
  if (tag === "br") return "<br/>";

  // Inline image (rare — Docs almost always wraps img in a <p>), preserve it
  // so the block-level pass picks it up when we walk the paragraph again.
  if (tag === "img") {
    const src = node.getAttribute("src") || "";
    if (!src) return "";
    return `<img src="${escapeAttr(src)}" alt="${escapeAttr(node.getAttribute("alt") || "")}" />`;
  }

  // Recurse through children first, then wrap based on this element's styling.
  let inner = "";
  node.childNodes.forEach((child) => { inner += convertGDocInline(child); });
  if (!inner) return "";

  if (tag === "a") {
    let href = node.getAttribute("href") || "";
    // Docs wraps external links in a redirect: https://www.google.com/url?q=REAL&sa=…
    try {
      if (href.startsWith("https://www.google.com/url")) {
        const u = new URL(href);
        const real = u.searchParams.get("q");
        if (real) href = real;
      }
    } catch { /* leave as-is */ }
    if (!href) return inner;
    return `<a href="${escapeAttr(href)}" target="_blank" rel="noopener">${inner}</a>`;
  }

  // Sub/superscript — useful for footnote markers and scientific notation.
  if (tag === "sup") return `<sup>${inner}</sup>`;
  if (tag === "sub") return `<sub>${inner}</sub>`;

  const style = (node.getAttribute("style") || "").toLowerCase();
  const weight = (style.match(/font-weight:\s*(\d+|bold|bolder)/) || [])[1];
  const vAlign = (style.match(/vertical-align:\s*([a-z-]+)/) || [])[1];
  const isBold = tag === "b" || tag === "strong" || weight === "bold" || weight === "bolder" || (weight && parseInt(weight, 10) >= 600);
  const isItalic = tag === "i" || tag === "em" || /font-style:\s*italic/.test(style);
  const isUnderline = tag === "u" || /text-decoration[^;]*underline/.test(style);
  const isStrike = tag === "s" || tag === "strike" || tag === "del" || /text-decoration[^;]*line-through/.test(style);
  const isSuper = vAlign === "super";
  const isSub = vAlign === "sub";

  let out = inner;
  if (isBold)      out = `<strong>${out}</strong>`;
  if (isItalic)    out = `<em>${out}</em>`;
  if (isUnderline) out = `<u>${out}</u>`;
  if (isStrike)    out = `<s>${out}</s>`;
  if (isSuper)     out = `<sup>${out}</sup>`;
  if (isSub)       out = `<sub>${out}</sub>`;
  return out;
}

// ===== Article preview ======================================================
// Opens a new tab showing the draft as readers will see it on the live site.
// We reuse the public site's stylesheets (css/styles.css + article-premium.css)
// and mount the same `.article-detail` structure that js/main.js produces, so
// the writer sees a true-to-life preview without needing to publish.
function openArticlePreview(wrap, ctx) {
  const rawBody = wrap.querySelector("#f-body").innerHTML
    .replace(/<mark class="sx-mark[^"]*"[^>]*>([\s\S]*?)<\/mark>/g, "$1");
  return openArticlePreviewFromData({
    title: (wrap.querySelector("#f-title").textContent || "").trim(),
    dek: (wrap.querySelector("#f-dek").textContent || "").trim(),
    cover: wrap.querySelector("#f-cover").value.trim(),
    lightCover: !!wrap.querySelector("#f-cover-light")?.checked,
    category: wrap.querySelector("#f-category").value || "Feature",
    author: ctx.profile?.name || ctx.user?.email || "The Catalyst",
    bodyHtml: rawBody,
    bodyText: (wrap.querySelector("#f-body").textContent || ""),
  }, ctx);
}

// Data-driven twin of openArticlePreview — admin edits don't have the writer's
// compose form, so they build a data object from the details modal and call
// this directly. Kept as a separate function so the writer path stays identical.
// A story that opens with a picture: mark that first figure (skipping empty
// paragraphs before it) so article-premium.css can set it beside the opening
// text instead of above it. Mirrors js/main.js markLeadFigure(). Keep in sync.
function markLeadFigure(html) {
    const s = String(html || '');
    const lead = /^(?:\s|<p\b[^>]*>(?:\s|&nbsp;|<br\s*\/?>|<a\b[^>]*>\s*<\/a>)*<\/p>)*/i.exec(s)[0];
    const rest = s.slice(lead.length);
    // A layout the writer chose on purpose (wide, full width, inset, grid) wins.
    if (/^<figure\b[^>]*\bclass=["'][^"']*\b(rt-size-(?:wide|large)|rt-align-|rt-gallery|rt-cap-side|rt-cap-overlay)/i.test(rest)) return s;
    if (/^<figure\b/i.test(rest)) {
        return lead + rest.replace(/^<figure\b([^>]*?)(\sclass=["']([^"']*)["'])?/i, (m, a, c, cls) => `<figure${a.replace(/\sclass=["'][^"']*["']/i, '')} class="${cls ? cls + ' ' : ''}rt-lead"`);
    }
    if (/^<p\b[^>]*>\s*(?:<a\b[^>]*>\s*)?<img\b[^>]*>\s*(?:<\/a>\s*)?<\/p>/i.test(rest)) {
        return lead + rest.replace(/^<p\b/i, '<p class="rt-lead"');
    }
    return s;
}

export function openArticlePreviewFromData(data, ctx) {
  const title = (data.title || "").trim() || "Untitled draft";
  const dek = (data.dek || "").trim();
  const cover = (data.cover || "").trim();
  const lightCover = !!data.lightCover;
  const category = data.category || "Feature";
  const author = data.author || "The Catalyst";
  const bodyHtml = markLeadFigure(data.bodyHtml || "");
  const publishedDate = data.publishedDate instanceof Date && !isNaN(data.publishedDate)
    ? data.publishedDate : new Date();

  // Reading time mirrors the public-site estimator: 220 wpm against the body.
  const bodyText = data.bodyText != null
    ? String(data.bodyText)
    : (bodyHtml ? bodyHtml.replace(/<[^>]+>/g, " ") : "");
  const wordCount = bodyText.trim().split(/\s+/).filter(Boolean).length;
  const readingTime = `${Math.max(1, Math.round(wordCount / 220))} min read`;
  const todayStr = publishedDate.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  const initials = author.split(/\s+/).map((s) => s[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();

  // Resolve the absolute origin so preview stylesheets, fonts, and the quiz
  // template all load from the live site instead of about:srcdoc.
  const origin = window.location.origin;
  const heroBg = cover || `${origin}/NewLogoShape.png`;

  const doc = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Preview · ${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
<link href="https://fonts.googleapis.com/css2?family=Source+Serif+Pro:ital,wght@0,400;0,600;0,700;1,400&family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${origin}/css/styles.css">
<link rel="stylesheet" href="${origin}/css/article-premium.css?v=20261009-lead">
<link rel="stylesheet" href="${origin}/css/article-layouts.css?v=4">
<style>
  body { background: var(--canvas, #fafafa); }
  .preview-banner {
    position: sticky; top: 0; z-index: 1000;
    background: #0b1220; color: #fff;
    padding: 10px 20px; text-align: center;
    font: 600 13px/1.4 Inter, system-ui, sans-serif;
    letter-spacing: 0.04em;
  }
  .preview-banner span { opacity: 0.7; font-weight: 400; margin-left: 10px; }
  main { padding-top: 0; }
  .article-page { padding: 40px 24px 80px; }
  .article-page .container { max-width: 1100px; margin: 0 auto; }
</style>
</head>
<body data-page="article">
  <div class="preview-banner">PREVIEW MODE <span>This is how your article will appear when published.</span></div>
  <main>
    <section class="article-page">
      <div class="container">
        <div class="article-detail">
          <header class="article-hero${lightCover ? ' article-hero--light-cover' : ''}">
            <div class="article-hero__image" style="background-image:url('${escAttrJs(heroBg)}')"></div>
            <div class="article-hero__inner">
              <div class="article-hero__surface">
                <span class="article-hero__category">${esc(category)}</span>
                <h1 class="article-hero__title">${esc(title)}</h1>
                ${dek ? `<p class="article-hero__deck">${esc(dek)}</p>` : ""}
                <div class="article-hero__meta">
                  <span>By <strong>${esc(author)}</strong></span>
                  <span class="dot"></span>
                  <span>${esc(todayStr)}</span>
                  <span class="dot"></span>
                  <span class="reading-time">${esc(readingTime)}</span>
                </div>
              </div>
            </div>
          </header>
          <div class="article-body-wrap">
            <article class="article-body" id="preview-article-body">${bodyHtml}</article>
            <aside class="article-byline">
              <div class="article-byline__avatar">${esc(initials || "TC")}</div>
              <div>
                <div class="article-byline__name">${esc(author)}</div>
                <div class="article-byline__role">Contributing writer · The Catalyst Magazine</div>
              </div>
            </aside>
          </div>
        </div>
      </div>
    </section>
  </main>
  <script>
    // Inline-hydrate any quiz figures using the same template + substitution
    // logic as the public article page. We can't import main.js here because
    // its module entry-point pulls in the full site router; instead we reuse
    // the same template fetch and placeholder-swap.
    (function () {
      const ORIGIN = ${JSON.stringify(origin)};
      function decodeQuiz(raw) {
        try { return JSON.parse(decodeURIComponent(escape(atob(raw)))); }
        catch (e) { return null; }
      }
      function esc(s) {
        return String(s == null ? '' : s)
          .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      }
      function renderGameHtml(template, data) {
        const powers = ['double', 'fire', 'both'];
        const questions = (data.questions || []).map(function (q, i) {
          const correctIdx = Math.max(0, Math.min(q.correct, (q.options || []).length - 1));
          return {
            qID: i,
            q: q.prompt,
            options: (q.options || []).map(function (text, oi) { return { text: text, correct: oi === correctIdx }; }),
            feedbackCorrect: q.feedbackCorrect || '✅ Correct!',
            feedbackIncorrect: q.feedbackIncorrect || '❌ Not quite — give it another look.',
            power: powers[i % powers.length]
          };
        });
        const json = JSON.stringify(questions, null, 2);
        return template
          .replace(/__GAME_TITLE__/g, esc(data.title || 'Knowledge quiz'))
          .replace(/__GAME_INTRO__/g, esc(data.intro || 'Test your knowledge of the article.'))
          .replace('/*__QUESTIONS_JSON__*/[]', json);
      }
      const figures = document.querySelectorAll('figure.rt-quiz[data-quiz]');
      if (!figures.length) return;
      fetch(ORIGIN + '/posts/games/_template.html').then(function (res) {
        if (!res.ok) throw new Error('template ' + res.status);
        return res.text();
      }).then(function (template) {
        figures.forEach(function (figure) {
          const data = decodeQuiz(figure.getAttribute('data-quiz') || '');
          if (!data || !Array.isArray(data.questions) || !data.questions.length) return;
          const wrap = document.createElement('div');
          wrap.className = 'article-block article-quiz';
          const iframe = document.createElement('iframe');
          iframe.className = 'article-quiz-frame';
          iframe.title = data.title || 'Interactive quiz';
          iframe.setAttribute('allow', 'fullscreen');
          iframe.srcdoc = renderGameHtml(template, data);
          wrap.appendChild(iframe);
          figure.replaceWith(wrap);
        });
      }).catch(function (err) { console.warn('preview quiz hydration failed', err); });
    })();
  </script>
</body>
</html>`;

  // Open a fresh window and write the document. Using a Blob URL (rather than
  // document.write) keeps the new tab's history clean and avoids the deprecated
  // open + write pattern that some browsers warn about.
  const blob = new Blob([doc], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, "_blank", "noopener,noreferrer");
  if (!win) {
    ctx?.toast?.("Allow pop-ups for this site to see the preview.", "error");
    URL.revokeObjectURL(url);
    return;
  }
  // Revoke the URL once the new tab has had time to fetch it.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// Small helper used by openArticlePreview when the value is going into a
// JS string in the inlined preview document. Mirrors escapeAttr but allows
// embedding directly into a quoted style attribute or JS string.
function escAttrJs(value) {
  return String(value == null ? "" : value)
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/"/g, "&quot;")
    .replace(/\n/g, " ");
}

// ===== Format guide =========================================================
function openEditorialStandards() {
  const url = new URL("/admin/#/writer/guidelines", window.location.origin).toString();
  const win = window.open(url, "_blank", "noopener");
  if (!win) {
    toast("Allow pop-ups for this site to open the editorial standards.", "error");
  }
}

// Opens a new tab showing a fully-formatted example article. The example uses
// the same stylesheets as a real published article (css/styles.css +
// article-premium.css) so what the writer sees here is literally how their
// article will look — modeled after CNN / NYT magazine layouts.
// Each block has a labeled callout on the left explaining what it is and
// how to insert it from the toolbar.
function openFormatGuide() {
  const origin = window.location.origin;
  const heroBg = "https://images.unsplash.com/photo-1504711434969-e33886168f5c?auto=format&fit=crop&w=1800&q=80";
  const inlineImg = "https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&w=1600&q=80";
  const sideImg = "https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=1200&q=80";

  // Each block in the example is tagged with data-guide="…" and a human label
  // via data-guide-label. A small CSS pass then draws a gutter annotation to
  // the left of each block with the label — exactly like a museum placard.
  const doc = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>How to format a Catalyst article</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
<link href="https://fonts.googleapis.com/css2?family=Source+Serif+Pro:ital,wght@0,400;0,600;0,700;1,400&family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${origin}/css/styles.css">
<link rel="stylesheet" href="${origin}/css/article-premium.css">
<style>
  body { background: var(--canvas, #fafafa); }
  .guide-banner {
    position: sticky; top: 0; z-index: 1000;
    background: linear-gradient(90deg,#0b1220,#1f2a44);
    color: #fff;
    padding: 14px 22px;
    font: 600 13px/1.4 Inter, system-ui, sans-serif;
    letter-spacing: 0.04em;
    display: flex; align-items: center; gap: 14px;
    box-shadow: 0 2px 10px rgba(0,0,0,0.2);
  }
  .guide-banner .dot { width: 8px; height: 8px; border-radius: 50%; background: #22c55e; flex: 0 0 auto; box-shadow: 0 0 0 4px rgba(34,197,94,0.2); }
  .guide-banner strong { font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
  .guide-banner span { opacity: 0.75; font-weight: 400; }
  .guide-banner button {
    margin-left: auto;
    background: rgba(255,255,255,0.12); color: #fff;
    border: 1px solid rgba(255,255,255,0.25);
    padding: 7px 14px; border-radius: 8px;
    font: 600 12px/1 Inter, system-ui, sans-serif;
    letter-spacing: 0.06em; text-transform: uppercase;
    cursor: pointer;
  }
  .guide-banner button:hover { background: rgba(255,255,255,0.2); }

  main { padding-top: 0; }
  .article-page { padding: 40px 24px 100px; }
  .article-page .container { max-width: 1280px; margin: 0 auto; }

  /* Left-gutter annotations — show what each block is called and how to
     insert it. On desktop the callout floats to the left of the article
     in a single card (label + detail stacked inside one ::before so the
     detail always sits right under the label, regardless of how tall the
     annotated block is). On narrower screens the callout stacks above
     each block so nothing gets clipped. */
  .guide-annotation { position: relative; }
  .guide-annotation::before {
    content: attr(data-guide-label);
    position: absolute;
    left: -252px;
    top: -4px;
    width: 230px;
    font: 700 11px/1.5 Inter, system-ui, sans-serif;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: #2563eb;
    padding: 10px 14px 6px;
    background: #eff6ff;
    border-left: 3px solid #2563eb;
    border-top-left-radius: 4px;
    border-top-right-radius: 4px;
    box-shadow: 0 1px 2px rgba(15,23,42,0.05);
  }
  .guide-annotation::after {
    content: attr(data-guide-detail);
    position: absolute;
    left: -252px;
    top: 34px;
    width: 230px;
    font: 400 12px/1.55 Inter, system-ui, sans-serif;
    color: #475569;
    padding: 0 14px 12px;
    background: #eff6ff;
    border-left: 3px solid #2563eb;
    border-bottom-left-radius: 4px;
    border-bottom-right-radius: 4px;
    box-shadow: 0 1px 2px rgba(15,23,42,0.05);
  }
  /* Short blocks like the divider need reserved vertical space so the
     absolutely-positioned callout doesn't overlap whatever block follows. */
  .guide-divider-wrap { min-height: 120px; margin: 28px 0; }
  .guide-divider-wrap hr { margin: 0; }

  @media (max-width: 1200px) {
    .guide-annotation::before,
    .guide-annotation::after {
      position: static;
      display: block;
      width: auto;
      max-width: 720px;
      margin: 0 auto;
      left: auto;
      top: auto;
      box-shadow: none;
    }
    .guide-annotation::before { margin-top: 10px; border-top-right-radius: 4px; }
    .guide-annotation::after { margin-bottom: 14px; }
    .guide-divider-wrap { min-height: 0; }
  }
</style>
</head>
<body data-page="article">
  <div class="guide-banner">
    <span class="dot"></span>
    <strong>Formatting guide</strong>
    <span>This is what a professionally formatted Catalyst article looks like. Match this structure in your own piece.</span>
    <button onclick="window.close()">Close</button>
  </div>
  <main>
    <section class="article-page">
      <div class="container">
        <div class="article-detail">
          <header class="article-hero guide-annotation"
            data-guide-label="① Hero"
            data-guide-detail="Cover image + category + headline + deck. Set these from the Settings drawer and the title/subtitle fields above the body.">
            <div class="article-hero__image" style="background-image:url('${heroBg}')"></div>
            <div class="article-hero__inner">
              <div class="article-hero__surface">
                <span class="article-hero__category">Feature</span>
                <h1 class="article-hero__title">The Quiet Revolution Inside Your Cells</h1>
                <p class="article-hero__deck">A new generation of researchers is rewriting what we thought we knew about cellular memory — and the implications reach far beyond the lab.</p>
                <div class="article-hero__meta">
                  <span>By <strong>Example Writer</strong></span>
                  <span class="dot"></span>
                  <span>Apr 18, 2026</span>
                  <span class="dot"></span>
                  <span class="reading-time">6 min read</span>
                </div>
              </div>
            </div>
          </header>

          <div class="article-body-wrap">
            <article class="article-body">

              <p class="guide-annotation"
                data-guide-label="② Opening paragraph"
                data-guide-detail="The first paragraph gets an automatic drop-cap. Open with a specific scene, detail, or question — not a summary. This is your hook.">
                It was just past midnight in the basement lab when the cell lit up. For Dr. Lina Ortega, who had spent four years chasing a single blue flicker on a microscope screen, the glow meant everything — proof that a dying cell could be coaxed, briefly, to remember.
              </p>

              <p>That flicker, captured on February 14th in a cramped corner of the Weill Institute, may sound like a small result. But to researchers working at the edge of cellular biology, it is a kind of earthquake. For decades, the conventional wisdom held that memory lived strictly in neurons. Ortega's work — and a growing body of research behind it — suggests otherwise.</p>

              <h2 class="rt-section-heading guide-annotation"
                data-guide-label="③ Section heading"
                data-guide-detail="Use these to break your article into 2–4 movements. Click 'New section' in the toolbar to insert one with a heading + paragraph.">What the cells were telling us</h2>

              <p>The first hint came from an unassuming experiment. When Ortega exposed a line of skin cells to a specific chemical signal and then re-exposed them weeks later, the cells responded <em>faster</em> the second time — as if they had been waiting for it. Something had shifted inside them. Something had stuck.</p>

              <p>"It looked like the cells were learning," Ortega said. "And that's a word we do not throw around casually in this field."</p>

              <figure class="guide-annotation"
                data-guide-label="④ Inline image"
                data-guide-detail="Click the image button in the toolbar. Upload or paste a URL. You can add a caption — add ' — Credit' after the caption text to credit the source.">
                <img src="${inlineImg}" alt="A microscope lab" loading="lazy" />
                <figcaption><span class="fig-caption-text">A late-night session at Weill's cellular imaging bay.</span><span class="fig-caption-credit">Photo — Catalyst Magazine</span></figcaption>
              </figure>

              <p>The finding sits on a foundation laid by quieter work throughout the last decade. In 2019, a team in Kyoto showed that cell membranes could retain structural "echoes" of past stressors. In 2022, researchers in Toronto demonstrated that even bacteria could, in a crude sense, anticipate environments. Each paper was interesting on its own. Taken together, they start to form a pattern.</p>

              <figure class="rt-pullquote guide-annotation"
                data-guide-label="⑤ Pull-quote"
                data-guide-detail="Use the quote icon in the toolbar. Pull-quotes highlight a single, powerful line — use them sparingly, once or twice per article.">
                <blockquote>If cells can remember, the boundary between biology and computation gets much blurrier than anyone wants to admit.</blockquote>
                <figcaption>— Dr. Lina Ortega, Weill Institute</figcaption>
              </figure>

              <h2 class="rt-section-heading">Why this matters beyond the lab</h2>

              <p>The implications reach past pure biology. If cellular memory is real and durable, pharmacologists gain a new handle on chronic disease — the body's own recorded history of exposures could become a target. Ethicists raise different questions: what does it mean for a tissue to "remember" trauma? And what are we transplanting when we transplant cells?</p>

              <ul class="guide-annotation"
                data-guide-label="⑥ Bulleted list"
                data-guide-detail="Use the list buttons in the toolbar. Lists are good for enumerating distinct items — but avoid relying on them as a replacement for strong paragraphs.">
                <li><strong>Chronic-disease research</strong> could target the cellular record of past inflammation, not just the current flare-up.</li>
                <li><strong>Organ transplantation</strong> may need to account for the "history" a donated tissue carries with it.</li>
                <li><strong>Developmental biology</strong> has to grapple with the idea that early-life exposures might echo decades later at the cellular level.</li>
              </ul>

              <div class="guide-annotation guide-divider-wrap"
                data-guide-label="⑦ Divider"
                data-guide-detail="Use the divider button to mark a major transition — a new chapter of your argument, a time jump, or a shift in subject. Use sparingly.">
                <hr class="rt-divider" />
              </div>

              <h2 class="rt-section-heading">The skeptics' case</h2>

              <p>Not everyone is convinced. Dr. Rafael Chen, a cell biologist at Stanford who reviewed Ortega's pre-print, pushed back on the framing. "We have to be careful with the word <em>memory</em>," he said. "What we are seeing could be explained by simpler mechanisms — chromatin state, metabolic priming — that we already have names for. Calling it memory is marketing, not science."</p>

              <p>Ortega takes the critique in stride. "Rafael is right that we need more replication," she said. "But dismissing the language is a way of pretending we already understand the phenomenon. We don't. That's why we're studying it."</p>

              <p>Chen's lab is now running its own version of the experiment. Results are expected by the end of the year.</p>

              <figure class="guide-annotation"
                data-guide-label="⑧ Image with wider size"
                data-guide-detail="When you click an image, a dialog lets you change its size (standard / wide / full) and caption. Use wider sizes sparingly for moments of visual emphasis.">
                <img src="${sideImg}" alt="Abstract visualization" loading="lazy" />
                <figcaption><span class="fig-caption-text">Data visualization of membrane-state echoes across 48 hours.</span><span class="fig-caption-credit">Illustration — Catalyst Magazine</span></figcaption>
              </figure>

              <h2 class="rt-section-heading">What comes next</h2>

              <p>For now, the work continues at the pace that science actually moves: slowly, with long silences between breakthroughs. Ortega's lab has two more papers in the pipeline. Chen's results will either complicate or confirm the picture. Either way, the flicker at midnight is no longer just a quirk on a screen.</p>

              <p class="guide-annotation"
                data-guide-label="⑨ Closing"
                data-guide-detail="Land it. End with a callback to your opening, a forward-looking implication, or the sharpest line you've saved for last. Don't trail off.">
                "The cells aren't telling us what we want to hear yet," Ortega said. "They're telling us something harder — that we've been asking the wrong questions. We have to get better at listening."
              </p>

            </article>

            <aside class="article-byline">
              <div class="article-byline__avatar">EW</div>
              <div>
                <div class="article-byline__name">Example Writer</div>
                <div class="article-byline__role">Contributing writer · The Catalyst Magazine</div>
              </div>
            </aside>
          </div>
        </div>
      </div>
    </section>
  </main>
</body>
</html>`;

  const blob = new Blob([doc], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, "_blank", "noopener");
  if (!win) {
    alert("Please allow popups to see the format guide.");
    URL.revokeObjectURL(url);
    return;
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// ===== Quiz dialog ==========================================================
// Lets a writer add a 3-question knowledge quiz that renders at the end of the
// article as the same retro-arcade "Neuro Dash" mini-game used elsewhere in
// the magazine. The quiz data is base64-encoded JSON parked on a non-editable
// <figure class="rt-quiz" data-quiz="…"> block. At render time the public
// article page (js/main.js) loads the game template and embeds the game in an
// iframe at that figure's position.
function openQuizDialog(editorEl, ctx, existingFigure = null) {
  const isEdit = !!existingFigure;

  let initial = {
    title: "",
    intro: "",
    questions: defaultQuizQuestions(),
  };
  if (isEdit) {
    try {
      const raw = existingFigure.getAttribute("data-quiz") || "";
      const parsed = decodeQuizData(raw);
      if (parsed && Array.isArray(parsed.questions) && parsed.questions.length === 3) {
        initial = {
          title: parsed.title || "",
          intro: parsed.intro || "",
          questions: parsed.questions,
        };
      }
    } catch { /* fall back to defaults */ }
  }

  const scrim = el("div", { class: "media-dialog-scrim" });
  const modal = el("div", { class: "media-dialog quiz-dialog", style: { maxWidth: "760px" } });
  modal.innerHTML = `
    <div class="media-dialog-head">
      <div class="media-dialog-title">${isEdit ? "Edit" : "Add"} interactive quiz game</div>
      <button class="media-dialog-close" aria-label="Close">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <div class="media-dialog-body">
      <div class="hint" style="margin-bottom:14px;">
        Add a 3-question retro arcade mini-game to the end of your article.
        Readers run, jump, and collect coins while answering your questions to
        unlock the goal portal.
      </div>
      <div class="field">
        <label class="label">Game title</label>
        <input class="input" id="qz-title" placeholder='e.g. "Neuro Dash: Unfolding the Mystery"' value="${escapeAttr(initial.title || "")}" />
      </div>
      <div class="field">
        <label class="label">Intro line (shown above the game)</label>
        <input class="input" id="qz-intro" placeholder='e.g. "🧠 Test your knowledge about misfolded proteins!"' value="${escapeAttr(initial.intro || "")}" />
      </div>
      <div id="qz-questions"></div>
      <div class="media-error" id="qz-error"></div>
    </div>
    <div class="media-dialog-foot">
      ${isEdit ? `<button class="btn btn-ghost btn-sm" id="qz-delete" style="color:var(--danger);margin-right:auto;">Remove quiz</button>` : ""}
      <button class="btn btn-ghost btn-sm" id="qz-cancel">Cancel</button>
      <button class="btn btn-accent btn-sm" id="qz-save">${isEdit ? "Save changes" : "Insert quiz"}</button>
    </div>
  `;
  document.body.appendChild(scrim);
  document.body.appendChild(modal);
  requestAnimationFrame(() => { scrim.classList.add("open"); modal.classList.add("open"); });

  const questionsEl = modal.querySelector("#qz-questions");
  const errorEl = modal.querySelector("#qz-error");

  // Render the 3 question cards. Each card has a prompt, 3 answer choices
  // (matches the canvas game's option modal which sizes for 3), a radio to
  // mark the correct one, and per-question feedback for both outcomes.
  initial.questions.slice(0, 3).forEach((q, qi) => {
    const card = el("div", { class: "quiz-q-card" });
    card.innerHTML = `
      <div class="quiz-q-head">Question ${qi + 1}</div>
      <div class="field">
        <label class="label">Prompt</label>
        <input class="input qz-q-prompt" data-qi="${qi}" placeholder="Ask a question about your article" value="${escapeAttr(q.prompt || "")}" />
      </div>
      <div class="field">
        <label class="label">Answer choices (pick the correct one with the radio)</label>
        <div class="quiz-options" data-qi="${qi}">
          ${[0, 1, 2].map((oi) => {
            const opt = q.options?.[oi] || "";
            const isCorrect = q.correct === oi;
            return `
              <label class="quiz-option-row">
                <input type="radio" name="qz-correct-${qi}" value="${oi}" ${isCorrect ? "checked" : ""} aria-label="Mark choice ${oi + 1} as correct" />
                <input class="input qz-q-option" data-qi="${qi}" data-oi="${oi}" placeholder="Choice ${oi + 1}" value="${escapeAttr(opt)}" />
              </label>`;
          }).join("")}
        </div>
      </div>
      <div class="field">
        <label class="label">Feedback when correct</label>
        <input class="input qz-q-fc" data-qi="${qi}" placeholder='e.g. "✅ Correct! Here\'s why…"' value="${escapeAttr(q.feedbackCorrect || "")}" />
      </div>
      <div class="field">
        <label class="label">Feedback when wrong</label>
        <input class="input qz-q-fi" data-qi="${qi}" placeholder='e.g. "❌ Not quite — the article explains…"' value="${escapeAttr(q.feedbackIncorrect || "")}" />
      </div>
    `;
    questionsEl.appendChild(card);
  });

  const close = () => {
    scrim.classList.remove("open");
    modal.classList.remove("open");
    setTimeout(() => { scrim.remove(); modal.remove(); }, 200);
  };
  modal.querySelector(".media-dialog-close").addEventListener("click", close);
  modal.querySelector("#qz-cancel").addEventListener("click", close);
  scrim.addEventListener("click", close);

  if (isEdit) {
    modal.querySelector("#qz-delete").addEventListener("click", () => {
      // Drop both the figure and the empty paragraph the editor parked after it.
      const after = existingFigure.nextElementSibling;
      existingFigure.remove();
      if (after && after.tagName === "P" && (after.textContent || "").trim() === "") after.remove();
      editorEl.dispatchEvent(new Event("input", { bubbles: true }));
      ctx?.toast?.("Quiz removed.", "success");
      close();
    });
  }

  modal.querySelector("#qz-save").addEventListener("click", () => {
    const title = (modal.querySelector("#qz-title").value || "").trim();
    const intro = (modal.querySelector("#qz-intro").value || "").trim();
    if (!title) { errorEl.textContent = "Please add a game title."; return; }

    const questions = [];
    for (let qi = 0; qi < 3; qi++) {
      const prompt = (modal.querySelector(`.qz-q-prompt[data-qi="${qi}"]`).value || "").trim();
      const options = [];
      for (let oi = 0; oi < 3; oi++) {
        const v = (modal.querySelector(`.qz-q-option[data-qi="${qi}"][data-oi="${oi}"]`).value || "").trim();
        if (v) options.push(v);
      }
      const correctRaw = modal.querySelector(`input[name="qz-correct-${qi}"]:checked`)?.value;
      const correct = correctRaw == null ? -1 : Number(correctRaw);
      const feedbackCorrect = (modal.querySelector(`.qz-q-fc[data-qi="${qi}"]`).value || "").trim();
      const feedbackIncorrect = (modal.querySelector(`.qz-q-fi[data-qi="${qi}"]`).value || "").trim();

      if (!prompt) { errorEl.textContent = `Question ${qi + 1} is missing a prompt.`; return; }
      if (options.length < 2) { errorEl.textContent = `Question ${qi + 1} needs at least 2 answer choices.`; return; }
      if (correct < 0 || correct >= options.length) {
        errorEl.textContent = `Question ${qi + 1}: pick which answer is correct (and make sure it's filled in).`;
        return;
      }
      questions.push({ prompt, options, correct, feedbackCorrect, feedbackIncorrect });
    }

    const data = { title, intro, questions };
    const figureHtml = renderQuizFigureHtml(data);

    if (isEdit) {
      existingFigure.outerHTML = figureHtml;
    } else {
      // Always append at the end — the article reads better with the game
      // sitting after the closing paragraph rather than mid-body.
      const wrapper = document.createElement("div");
      wrapper.innerHTML = figureHtml + `<p><br/></p>`;
      while (wrapper.firstChild) editorEl.appendChild(wrapper.firstChild);
    }
    editorEl.dispatchEvent(new Event("input", { bubbles: true }));
    ctx?.toast?.(isEdit ? "Quiz updated." : "Quiz added to the end of your article.", "success");
    close();
  });
}

function defaultQuizQuestions() {
  return [
    { prompt: "", options: ["", "", ""], correct: 0, feedbackCorrect: "", feedbackIncorrect: "" },
    { prompt: "", options: ["", "", ""], correct: 0, feedbackCorrect: "", feedbackIncorrect: "" },
    { prompt: "", options: ["", "", ""], correct: 0, feedbackCorrect: "", feedbackIncorrect: "" },
  ];
}

function encodeQuizData(data) {
  // Base64 keeps the quiz JSON readable to our renderer but opaque to the
  // contenteditable rich-text engine, which would otherwise mangle quotes and
  // angle brackets in the data attribute as the writer types around the block.
  const json = JSON.stringify(data);
  return btoa(unescape(encodeURIComponent(json)));
}

function decodeQuizData(raw) {
  if (!raw) return null;
  try {
    const json = decodeURIComponent(escape(atob(raw)));
    return JSON.parse(json);
  } catch { return null; }
}

function renderQuizFigureHtml(data) {
  const encoded = encodeQuizData(data);
  const count = data.questions.length;
  const title = escapeHtml(data.title || "Knowledge quiz");
  const intro = escapeHtml(data.intro || "Test your knowledge of this article.");
  // The visible content is just an editor-side preview card. The public
  // article page replaces this with the actual game iframe at render time.
  return `<figure class="rt-quiz" contenteditable="false" data-rt-quiz="1" data-quiz="${escapeAttr(encoded)}">
    <div class="rt-quiz-card">
      <div class="rt-quiz-eyebrow">🎮 Interactive quiz game</div>
      <div class="rt-quiz-title">${title}</div>
      <div class="rt-quiz-intro">${intro}</div>
      <div class="rt-quiz-meta">${count} question${count === 1 ? "" : "s"} · readers play to unlock the goal · click to edit</div>
    </div>
  </figure>`;
}

// Fallback when the clipboard has no HTML (rare — plain text copy).
// Double newlines become paragraph breaks; single newlines become <br/>.
function plainTextToHtml(text) {
  if (!text) return "";
  return text
    .split(/\n{2,}/)
    .map((para) => `<p>${escapeHtml(para).replace(/\n/g, "<br/>")}</p>`)
    .join("\n");
}

// Insert an <hr class="rt-divider"> as a top-level block in the editor,
// followed by an empty paragraph where the caret lands. Using execCommand
// to insert an <hr> tends to nest it inside the current paragraph and leave
// a stranded empty block above — this routes around that.
function insertDividerAtCaret(editorEl) {
  editorEl.focus();
  const sel = window.getSelection();
  const hr = document.createElement("hr");
  hr.className = "rt-divider";
  const after = document.createElement("p");
  after.innerHTML = "<br/>";
  // Find the top-level block inside the editor that contains the caret.
  let block = null;
  if (sel && sel.rangeCount && editorEl.contains(sel.anchorNode)) {
    let n = sel.anchorNode;
    while (n && n.parentNode !== editorEl) n = n.parentNode;
    block = n;
  }
  if (block && block !== editorEl) {
    block.after(hr);
    hr.after(after);
  } else {
    // No known caret inside a block — append to the end.
    editorEl.appendChild(hr);
    editorEl.appendChild(after);
  }
  // Place caret inside the new paragraph so the writer keeps typing below.
  const range = document.createRange();
  range.setStart(after, 0);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
  editorEl.dispatchEvent(new Event("input", { bubbles: true }));
}

function insertBlockAtCaret(editorEl, html, savedRange = null) {
  editorEl.focus();
  const sel = window.getSelection();
  // If the caller captured a range before the dialog stole focus, restore it
  // so the new block lands where the writer's cursor actually was.
  if (savedRange && editorEl.contains(savedRange.startContainer)) {
    sel.removeAllRanges();
    sel.addRange(savedRange);
  } else if (!sel || sel.rangeCount === 0 || !editorEl.contains(sel.anchorNode)) {
    // No known position — append to end.
    const range = document.createRange();
    range.selectNodeContents(editorEl);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  }
  document.execCommand("insertHTML", false, html);
}

// Put a block (callout, numbers row…) on its own line after the paragraph the
// caret is in, so it never merges into that paragraph; an empty paragraph is
// replaced. Then select `focusSel` inside the new block so the writer can type.
function insertBlockAfterCaret(editorEl, html, focusSel) {
  const sel = window.getSelection();
  let node = sel && sel.rangeCount && editorEl.contains(sel.anchorNode) ? sel.anchorNode : null;
  while (node && node.parentNode !== editorEl) node = node.parentNode;
  const tpl = document.createElement("template");
  tpl.innerHTML = html.trim();
  const block = tpl.content.firstElementChild;
  const after = document.createElement("p"); after.innerHTML = "<br>";
  if (node && node.nodeType === 1 && /^P$/i.test(node.tagName) && !node.textContent.replace(/\u200b/g, "").trim() && !node.querySelector("img, video, figure")) node.replaceWith(block);
  else if (node) node.after(block);
  else editorEl.appendChild(block);
  if (!block.nextElementSibling) block.after(after);
  const target = (focusSel && block.querySelector(focusSel)) || block;
  const r = document.createRange(); r.selectNodeContents(target);
  sel.removeAllRanges(); sel.addRange(r);
}

// Snapshot the editor's current selection so we can restore it after a modal
// has stolen focus. Returns a cloned Range (safe to hold) or null.
function captureEditorRange(editorEl) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!editorEl.contains(range.startContainer)) return null;
  return range.cloneRange();
}

// Split a writer's caption into main text + optional credit line.
// We recognize an em-dash (—), regular dash surrounded by spaces (" - "), or
// a vertical bar ("|") as the credit separator. Everything after is rendered
// in a small, letter-spaced, non-italic span styled by CSS.
function renderFigureCaption(raw) {
  const text = String(raw || "").trim();
  if (!text) return "";
  const match = text.match(/^(.*?)\s*(?:—|–| - | \| )\s*(.+)$/);
  if (match) {
    const main = match[1].trim();
    const credit = match[2].trim();
    return `<figcaption><span class="fig-caption-text">${escapeHtml(main)}</span><span class="fig-caption-credit">${escapeHtml(credit)}</span></figcaption>`;
  }
  return `<figcaption><span class="fig-caption-text">${escapeHtml(text)}</span></figcaption>`;
}

// ===== Image grid (2–3 pictures side by side) ===============================
// figure.rt-gallery > .rt-gallery-grid > img…, one shared caption + credit.
// Click a grid in the composer to edit it.
function openGalleryDialog(editorEl, ctx, existing = null, savedRange = null) {
  const items = existing
    ? [...existing.querySelectorAll(".rt-gallery-grid img")].map((img) => ({ url: img.getAttribute("src") || "", alt: img.getAttribute("alt") || "" }))
    : [{ url: "", alt: "" }, { url: "", alt: "" }];
  const cls = existing?.classList;
  let shape = cls?.contains("rt-shape-square") ? "square" : cls?.contains("rt-shape-portrait") ? "portrait" : cls?.contains("rt-shape-natural") ? "natural" : "landscape";
  let width = cls?.contains("rt-size-wide") ? "wide" : "column";
  let edges = cls?.contains("rt-frame-plain") ? "plain" : cls?.contains("rt-frame-rounded") ? "rounded" : "soft";
  const capEl = existing?.querySelector("figcaption");
  let caption = (capEl?.querySelector(".fig-caption-text")?.textContent || (capEl && !capEl.querySelector(".fig-caption-credit") ? capEl.textContent : "") || "").trim();
  const legacyCredit = (capEl?.querySelector(".fig-caption-credit")?.textContent || "").trim();
  const gSrc = { type: "", kind: "Photo", name: "", url: "", license: "", ...Object.fromEntries(Object.entries(readFigureSource(existing)).filter(([, v]) => v)) };
  let gCtl = null;

  const scrim = el("div", { class: "media-dialog-scrim" });
  const modal = el("div", { class: "media-dialog media-dialog-design" });
  document.body.appendChild(scrim); document.body.appendChild(modal);
  requestAnimationFrame(() => { scrim.classList.add("open"); modal.classList.add("open"); });
  const onEsc = (e) => { if (e.key === "Escape" && document.body.lastElementChild === modal) { e.stopPropagation(); close(); } };
  document.addEventListener("keydown", onEsc, true);
  const close = () => { document.removeEventListener("keydown", onEsc, true); scrim.classList.remove("open"); modal.classList.remove("open"); setTimeout(() => { scrim.remove(); modal.remove(); }, 200); };
  scrim.addEventListener("click", close);

  const seg = (name, cur, opts) => `<div class="mseg" role="radiogroup">${opts.map(([v, l]) => `<label><input type="radio" name="${name}" value="${v}" ${cur === v ? "checked" : ""}><span>${l}</span></label>`).join("")}</div>`;
  function paint() {
    modal.innerHTML = `
      <div class="media-dialog-head">
        <div class="media-dialog-title">${existing ? "Edit" : "Insert"} image grid</div>
        <button class="media-dialog-close" aria-label="Close"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
      </div>
      <div class="media-dialog-body">
        <p class="hint" style="margin:0 0 12px;">Two or three pictures side by side, sharing one caption. Good for before-and-after, a lab and its people, or a series.</p>
        <div class="mgal-slots mgal-n${items.length}">
          ${items.map((it, i) => `
            <div class="mgal-slot" data-i="${i}">
              <button type="button" class="mgal-pic${it.url ? " has-img" : ""}" data-act="pick" aria-label="Choose picture ${i + 1}">${it.url ? `<img src="${escapeAttr(it.url)}" alt="">` : `<span>+ Picture ${i + 1}</span>`}</button>
              <div class="mgal-tools">
                <button type="button" class="btn btn-ghost btn-xs" data-act="upload">Upload</button>
                <button type="button" class="btn btn-ghost btn-xs" data-act="library">Library</button>
                ${items.length > 2 ? `<button type="button" class="btn btn-ghost btn-xs" data-act="remove" aria-label="Remove picture ${i + 1}">Remove</button>` : ""}
              </div>
              <input class="input input-sm" data-alt="${i}" placeholder="Alt text: describe picture ${i + 1}" value="${escapeAttr(it.alt)}">
            </div>`).join("")}
          ${items.length < 3 ? `<button type="button" class="mgal-add" data-act="add">+ Add a third picture</button>` : ""}
        </div>
        <input type="file" id="g-file" accept="image/*" hidden>
        <div class="field"><label class="label" for="g-cap">Caption <em class="opt">(optional)</em></label><input class="input" id="g-cap" value="${escapeAttr(caption)}" placeholder="One caption for the whole grid"></div>
        ${sourceFieldsHTML("g-src", gSrc, ctx?.profile?.name || "")}
        <p class="hint" style="margin:-4px 0 0;">If the pictures come from different places, choose the main source and name the others in the caption.</p>
        <div class="mgal-opts">
          <div class="field"><span class="label">Shape</span>${seg("g-shape", shape, [["landscape", "Landscape"], ["square", "Square"], ["portrait", "Portrait"], ["natural", "As shot"]])}</div>
          <div class="field"><span class="label">Width</span>${seg("g-width", width, [["column", "Column"], ["wide", "Wide"]])}</div>
          <div class="field"><span class="label">Edges</span>${seg("g-edges", edges, [["soft", "Soft"], ["plain", "Square"], ["rounded", "Rounded"]])}</div>
        </div>
        <div class="media-progress" id="g-progress" hidden><div class="media-progress-bar"><span id="g-fill"></span></div><div class="media-progress-text" id="g-ptext">Uploading…</div></div>
        <div class="media-error" id="g-error"></div>
      </div>
      <div class="media-dialog-foot">
        ${existing ? `<button class="btn btn-ghost btn-sm" data-act="delete" style="color:var(--danger);margin-right:auto;">Remove grid</button>` : ""}
        <button class="btn btn-ghost btn-sm" data-act="cancel">Cancel</button>
        <button class="btn btn-accent btn-sm" data-act="save">${existing ? "Save changes" : "Insert grid"}</button>
      </div>`;
    gCtl = wireSourceFields(modal, "g-src", gSrc, ctx?.profile?.name || "", legacyCredit);
  }
  const keep = () => {
    caption = modal.querySelector("#g-cap")?.value.trim() ?? caption;
    if (modal.querySelector('[data-src-prefix="g-src"]')) readSourceFields(modal, "g-src", gSrc);
    shape = modal.querySelector('input[name="g-shape"]:checked')?.value || shape;
    width = modal.querySelector('input[name="g-width"]:checked')?.value || width;
    edges = modal.querySelector('input[name="g-edges"]:checked')?.value || edges;
    modal.querySelectorAll("[data-alt]").forEach((inp) => { items[+inp.dataset.alt].alt = inp.value.trim(); });
  };
  paint();
  let uploadFor = -1;
  modal.addEventListener("change", async (e) => {
    if (e.target.id !== "g-file") return;
    const f = e.target.files[0]; e.target.value = "";
    if (!f || uploadFor < 0) return;
    const err = modal.querySelector("#g-error");
    if (!f.type.startsWith("image/")) { err.textContent = "Please choose an image file."; return; }
    if (f.size > 10 * 1024 * 1024) { err.textContent = "File too large. Max 10 MB."; return; }
    const prog = modal.querySelector("#g-progress"); prog.hidden = false;
    try {
      const url = await uploadToFirebase(f, "image", ctx, (pct) => { modal.querySelector("#g-fill").style.width = pct + "%"; modal.querySelector("#g-ptext").textContent = `Uploading… ${pct}%`; });
      keep(); items[uploadFor].url = url; paint();
    } catch (ex) { err.textContent = "Upload failed: " + (ex?.message || ex); prog.hidden = true; }
  });
  modal.addEventListener("click", (e) => {
    const b = e.target.closest("[data-act], .media-dialog-close"); if (!b) return;
    if (b.classList.contains("media-dialog-close") || b.dataset.act === "cancel") return close();
    const i = +(b.closest(".mgal-slot")?.dataset.i ?? -1);
    const act = b.dataset.act;
    if (act === "upload" || act === "pick") { keep(); uploadFor = i; modal.querySelector("#g-file").click(); return; }
    if (act === "library") { keep(); openImageLibraryPicker(ctx, (url) => { items[i].url = url; paint(); }); return; }
    if (act === "remove") { keep(); items.splice(i, 1); paint(); return; }
    if (act === "add") { keep(); items.push({ url: "", alt: "" }); paint(); return; }
    if (act === "delete") { existing.remove(); editorEl.dispatchEvent(new Event("input", { bubbles: true })); return close(); }
    if (act === "save") {
      keep();
      const err = modal.querySelector("#g-error");
      const filled = items.filter((it) => it.url);
      if (filled.length < 2) { err.textContent = "Add at least two pictures."; return; }
      if (filled.some((it) => !it.alt)) { err.textContent = "Please add alt text to every picture: describe what it shows, for screen readers and search."; return; }
      const problem = gCtl.problem();
      if (problem) { err.textContent = `Image source: ${problem}`; modal.querySelector(".msrc")?.scrollIntoView({ behavior: "smooth", block: "center" }); return; }
      const cl = ["rt-gallery", `rt-cols-${filled.length}`, `rt-shape-${shape}`, width === "wide" ? "rt-size-wide" : "", edges !== "soft" ? `rt-frame-${edges}` : ""].filter(Boolean).join(" ");
      const plural = { Photo: "Photos", Illustration: "Illustrations", Chart: "Charts", Map: "Maps", Figure: "Figures", Screenshot: "Screenshots", Video: "Videos" };
      const src = { ...gSrc, kind: plural[gSrc.kind] || gSrc.kind };
      const cap = `<figcaption>${caption ? `<span class="fig-caption-text">${escapeHtml(caption)}</span>` : ""}${creditHtml(src)}</figcaption>`;
      const html = `<figure class="${cl}" contenteditable="false" data-rt-figure="gallery"${sourceAttrs(gSrc)}><div class="rt-gallery-grid">${filled.map((it) => `<img src="${escapeAttr(it.url)}" alt="${escapeAttr(it.alt)}" />`).join("")}</div>${cap}</figure>`;
      if (existing) existing.outerHTML = html;
      else insertBlockAtCaret(editorEl, html + "<p><br/></p>", savedRange);
      editorEl.dispatchEvent(new Event("input", { bubbles: true }));
      close();
    }
  });
}

// ===== Block bar =============================================================
// A small floating bar over a callout, a numbers row or a pull quote while
// the writer is working in it: change its style, or remove it.
const BLOCK_STYLES = {
  callout: { sel: "aside.rt-callout", attr: "data-tone", opts: [["paper", "Paper"], ["sage", "Sage"], ["ink", "Dark"], ["line", "Outline"]],
    labels: ["Key takeaway", "Explainer", "Why it matters", "By the way", "Methods", "Glossary"] },
  stats: { sel: ".rt-stats", cls: ["rt-stats-1", "rt-stats-2", "rt-stats-3"], opts: [["rt-stats-1", "1"], ["rt-stats-2", "2"], ["rt-stats-3", "3"]] },
  quote: { sel: "figure.rt-pullquote", cls: ["", "rt-pq-large", "rt-pq-side"], opts: [["", "Classic"], ["rt-pq-large", "Large"], ["rt-pq-side", "Beside text"]] },
};
function setupBlockBar(editorEl) {
  document.querySelectorAll(".rt-blockbar").forEach((x) => x.remove());   // one per composer
  const bar = el("div", { class: "rt-blockbar", role: "toolbar", "aria-label": "Block style" });
  bar.hidden = true;
  document.body.appendChild(bar);
  let cur = null, kind = null;
  const find = (node) => {
    const elx = node?.nodeType === 1 ? node : node?.parentElement;
    for (const [k, d] of Object.entries(BLOCK_STYLES)) { const b = elx?.closest?.(d.sel); if (b && editorEl.contains(b)) return [b, k]; }
    return [null, null];
  };
  const place = () => {
    if (!cur) return;
    const r = cur.getBoundingClientRect();
    bar.style.top = `${window.scrollY + r.top - bar.offsetHeight - 10}px`;
    bar.style.left = `${window.scrollX + Math.max(8, r.left)}px`;
  };
  const paint = () => {
    const d = BLOCK_STYLES[kind];
    const on = d.attr ? cur.getAttribute(d.attr) || d.opts[0][0] : (d.cls.find((c) => c && cur.classList.contains(c)) || "");
    const n = kind === "stats" ? cur.querySelectorAll(".rt-stat").length : 0;
    bar.innerHTML = `<span class="rt-blockbar-name">${{ callout: "Callout", stats: "Numbers", quote: "Pull quote" }[kind]}</span>
      ${d.opts.map(([v, l]) => `<button type="button" data-style="${v}" class="${(kind === "stats" ? `rt-stats-${n}` : on) === v ? "is-on" : ""}">${l}</button>`).join("")}
      ${kind === "callout" ? `<select aria-label="Label">${d.labels.map((l) => `<option${cur.querySelector(".rt-callout-label")?.textContent.trim() === l ? " selected" : ""}>${l}</option>`).join("")}<option value="">Custom…</option></select>` : ""}
      <button type="button" data-style="__remove" class="is-danger" title="Remove this block">Remove</button>`;
    bar.hidden = false; place();
  };
  const show = () => {
    const sel = window.getSelection();
    const [b, k] = find(sel?.anchorNode);
    if (b === cur) return;
    cur?.classList.remove("is-active");
    cur = b; kind = k;
    if (!cur) { bar.hidden = true; return; }
    cur.classList.add("is-active");
    paint();
  };
  document.addEventListener("selectionchange", () => { if (!bar.contains(document.activeElement)) show(); });
  window.addEventListener("scroll", place, { passive: true });
  bar.addEventListener("mousedown", (e) => { if (e.target.tagName !== "SELECT") e.preventDefault(); });
  bar.addEventListener("click", (e) => {
    const b = e.target.closest("[data-style]"); if (!b || !cur) return;
    const v = b.dataset.style, d = BLOCK_STYLES[kind];
    if (v === "__remove") { cur.remove(); cur = null; bar.hidden = true; editorEl.dispatchEvent(new Event("input", { bubbles: true })); return; }
    if (d.attr) cur.setAttribute(d.attr, v);
    else if (kind === "stats") {
      const want = +v.slice(-1), have = cur.querySelectorAll(".rt-stat");
      d.cls.forEach((c) => cur.classList.remove(c)); cur.classList.add(v);
      for (let i = have.length; i < want; i++) cur.insertAdjacentHTML("beforeend", `<div class="rt-stat"><p class="rt-stat-num">00</p><p class="rt-stat-label">what the number means</p></div>`);
      [...have].slice(want).forEach((x) => x.remove());
    } else { d.cls.forEach((c) => c && cur.classList.remove(c)); if (v) cur.classList.add(v); }
    editorEl.dispatchEvent(new Event("input", { bubbles: true }));
    paint();
  });
  bar.addEventListener("change", (e) => {
    if (e.target.tagName !== "SELECT" || !cur) return;
    const label = cur.querySelector(".rt-callout-label") || cur.insertAdjacentElement("afterbegin", el("p", { class: "rt-callout-label" }));
    if (e.target.value) label.textContent = e.target.value;
    else { const r = document.createRange(); r.selectNodeContents(label); const s2 = getSelection(); s2.removeAllRanges(); s2.addRange(r); label.focus?.(); }
    editorEl.dispatchEvent(new Event("input", { bubbles: true }));
  });
  editorEl.addEventListener("input", () => { if (cur && !editorEl.contains(cur)) { cur = null; bar.hidden = true; } else place(); });
}

// ===== Small composer dialogs (link, pull quote) ===========================
// Same look as the image window. `fields` is HTML; onSubmit(root) returns
// an error string to keep the dialog open, or nothing to close it.
function openComposerDialog({ title, fields, submitLabel, onSubmit, onOpen }) {
  const scrim = el("div", { class: "media-dialog-scrim" });
  const modal = el("div", { class: "media-dialog media-dialog-sm", role: "dialog", "aria-modal": "true", "aria-label": title });
  modal.innerHTML = `
    <div class="media-dialog-head"><div class="media-dialog-title">${title}</div>
      <button class="media-dialog-close" aria-label="Close"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>
    <form class="media-dialog-body" novalidate>${fields}<div class="media-error" data-err></div><button type="submit" hidden></button></form>
    <div class="media-dialog-foot"><button class="btn btn-ghost btn-sm" data-cancel>Cancel</button><button class="btn btn-accent btn-sm" data-ok>${submitLabel}</button></div>`;
  document.body.appendChild(scrim); document.body.appendChild(modal);
  requestAnimationFrame(() => { scrim.classList.add("open"); modal.classList.add("open"); modal.querySelector("input, textarea")?.focus(); });
  const close = () => { document.removeEventListener("keydown", onKey, true); scrim.classList.remove("open"); modal.classList.remove("open"); setTimeout(() => { scrim.remove(); modal.remove(); }, 200); };
  const submit = () => { const err = onSubmit(modal); if (err) { modal.querySelector("[data-err]").textContent = err; return; } close(); };
  const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
  document.addEventListener("keydown", onKey, true);
  scrim.addEventListener("click", close);
  modal.querySelector(".media-dialog-close").addEventListener("click", close);
  modal.querySelector("[data-cancel]").addEventListener("click", close);
  modal.querySelector("[data-ok]").addEventListener("click", submit);
  modal.querySelector("form").addEventListener("submit", (e) => { e.preventDefault(); submit(); });
  onOpen?.(modal);
}

function openLinkDialog(editorEl, range) {
  const selected = range ? range.toString() : "";
  const existing = range ? (range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement)?.closest("a") : null;
  openComposerDialog({
    title: existing ? "Edit link" : "Add a link",
    submitLabel: existing ? "Save link" : "Add link",
    fields: `
      <div class="field"><label class="label" for="ln-url">Link address <span class="req">*</span></label><input class="input" id="ln-url" type="url" inputmode="url" placeholder="https://www.nih.gov/…" value="${escapeAttr(existing?.getAttribute("href") || "")}"></div>
      ${selected || existing ? "" : `<div class="field"><label class="label" for="ln-text">Text to show <span class="req">*</span></label><input class="input" id="ln-text" placeholder="e.g. the study published in Nature"></div>`}
      ${existing ? `<button type="button" class="btn btn-ghost btn-sm" id="ln-remove" style="color:var(--danger);">Remove link</button>` : ""}
      <p class="hint" style="margin:0;">Links open in a new tab. Link to the original source (the study, the agency, the lab) whenever you can.</p>`,
    onOpen: (m) => m.querySelector("#ln-remove")?.addEventListener("click", () => {
      existing.replaceWith(...existing.childNodes); editorEl.dispatchEvent(new Event("input", { bubbles: true })); m.querySelector("[data-cancel]").click();
    }),
    onSubmit: (m) => {
      let url = m.querySelector("#ln-url").value.trim();
      if (!url) return "Paste the link address.";
      if (!/^(https?:|mailto:)/i.test(url)) url = "https://" + url.replace(/^\/+/, "");
      if (!/^(https?:\/\/[^\s.]+\.[^\s]+|mailto:\S+@\S+)$/i.test(url)) return "That doesn't look like a web address.";
      if (existing) { existing.setAttribute("href", url); existing.target = "_blank"; existing.rel = "noopener"; }
      else {
        editorEl.focus();
        const sel = window.getSelection(); sel.removeAllRanges();
        if (range) sel.addRange(range);
        if (selected) document.execCommand("createLink", false, url);
        else {
          const text = m.querySelector("#ln-text").value.trim();
          if (!text) return "Add the text to show.";
          document.execCommand("insertHTML", false, `<a href="${escapeAttr(url)}" target="_blank" rel="noopener">${escapeHtml(text)}</a>&nbsp;`);
        }
        editorEl.querySelectorAll("a:not([target])").forEach((a) => { a.target = "_blank"; a.rel = "noopener"; });
      }
      editorEl.dispatchEvent(new Event("input", { bubbles: true }));
    },
  });
}

function openQuoteDialog(editorEl, range) {
  openComposerDialog({
    title: "Add a pull quote",
    submitLabel: "Add quote",
    fields: `
      <div class="field"><label class="label" for="pq-text">The quote <span class="req">*</span></label><textarea class="input textarea" id="pq-text" rows="3" placeholder="One memorable line, word for word."></textarea></div>
      <div class="field"><label class="label" for="pq-who">Who said it <em class="opt">(optional)</em></label><input class="input" id="pq-who" placeholder="e.g. Dr. Alexandra DeCandia, Georgetown University"></div>
      <div class="field"><span class="label">Style</span><div class="mseg" role="radiogroup">${[["", "Classic"], ["rt-pq-large", "Large"], ["rt-pq-side", "Beside the text"]].map(([v, l], i) => `<label><input type="radio" name="pq-style" value="${v}" ${i === 0 ? "checked" : ""}><span>${l}</span></label>`).join("")}</div></div>
      <p class="hint" style="margin:0;">Use a pull quote once or twice per article, for a line worth reading twice.</p>`,
    onSubmit: (m) => {
      const text = m.querySelector("#pq-text").value.trim();
      if (!text) return "Write the quote.";
      const who = m.querySelector("#pq-who").value.trim().replace(/^[—–-]\s*/, "");
      const style = m.querySelector('input[name="pq-style"]:checked')?.value || "";
      const sel = window.getSelection(); editorEl.focus(); sel.removeAllRanges(); if (range) sel.addRange(range);
      insertBlockAfterCaret(editorEl, `<figure class="rt-pullquote${style ? " " + style : ""}"><blockquote>${escapeHtml(text.replace(/^["“]|["”]$/g, ""))}</blockquote>${who ? `<figcaption>— ${escapeHtml(who)}</figcaption>` : ""}</figure>`, "blockquote");
      editorEl.dispatchEvent(new Event("input", { bubbles: true }));
    },
  });
}

// ===== Image sources and credits ===========================================
// Every picture says where it came from, the way magazines credit images.
// The writer answers "Where is this from?" and the credit line is written
// for them ("Photo: Jane Doe / NIH (CC BY)", "Courtesy of …"), linked to the
// source when there is one. The answers are kept on the figure
// (data-src-*) so editors can check them and the writer can re-open them.
const SRC_TYPES = [
  ["own", "I took or made it"],
  ["web", "From a website or publication"],
  ["courtesy", "Given to us (courtesy)"],
  ["staff", "Catalyst staff art"],
  ["ai", "AI-generated"],
];
const SRC_KINDS = ["Photo", "Illustration", "Chart", "Map", "Figure", "Screenshot", "Video"];
function readFigureSource(fig) {
  const d = fig?.dataset || {};
  return { type: d.srcType || "", kind: d.srcKind || "Photo", name: d.srcName || "", url: d.srcUrl || "", license: d.srcLicense || "" };
}
function sourceAttrs(src) {
  const a = (k, v) => (v ? ` data-src-${k}="${escapeAttr(v)}"` : "");
  return a("type", src.type) + a("kind", src.kind) + a("name", src.name) + a("url", src.url) + a("license", src.license);
}
// Plain-text credit (for the preview and checks) and the HTML credit span.
function creditText(src) {
  const k = src.kind || "Photo";
  if (src.type === "own") return `${k}: ${src.name}`;
  if (src.type === "web") return `${k}: ${src.name}`;
  if (src.type === "courtesy") return `Courtesy of ${src.name}`;
  if (src.type === "staff") return `${k}: ${src.name || "The Catalyst"}`;
  if (src.type === "ai") return `AI-generated ${k.toLowerCase()}: ${src.name}`;
  return "";
}
function creditHtml(src) {
  const txt = creditText(src); if (!txt) return "";
  if (!src.url || !/^https?:\/\//i.test(src.url) || !src.name) return `<span class="fig-caption-credit">${escapeHtml(txt)}</span>`;
  const i = txt.indexOf(src.name);
  return `<span class="fig-caption-credit">${escapeHtml(txt.slice(0, i))}<a href="${escapeAttr(src.url)}" target="_blank" rel="noopener nofollow">${escapeHtml(src.name)}</a>${escapeHtml(txt.slice(i + src.name.length))}</span>`;
}
// What's missing, in plain words ("" when complete).
function sourceProblem(src) {
  if (!src.type) return "Say where this picture is from.";
  if (src.type === "own" && !src.name) return "Add the name of the person who took or made it.";
  if (src.type === "web") {
    if (!/^https?:\/\/\S+\.\S+/i.test(src.url)) return "Paste the link to the page where you found it.";
    if (!src.name) return "Add who made or owns it (a photographer, lab or organization).";
  }
  if (src.type === "courtesy" && !src.name) return "Add the person or organization that gave it to us.";
  if (src.type === "ai" && !src.name) return "Add the tool it was made with (e.g. Higgsfield, ChatGPT).";
  return "";
}
function sourceFieldsHTML(p, src, writerName) {
  const nameLabel = { own: "Taken or made by", web: "Made or owned by", courtesy: "Courtesy of", staff: "Artist (optional)", ai: "Made with" }[src.type] || "Name";
  const namePh = { own: writerName || "Your name", web: "e.g. Kimberly Fraser / USFWS", courtesy: "e.g. GW Milken Institute School of Public Health", staff: "The Catalyst", ai: "e.g. Higgsfield" }[src.type] || "";
  return `
    <div class="msrc" data-src-prefix="${p}">
      <div class="msrc-head"><span class="label">Where is this from? <span class="req">*</span></span><span class="hint">Every picture is credited, like in a printed magazine.</span></div>
      <div class="msrc-types" role="radiogroup" aria-label="Where is this from?">
        ${SRC_TYPES.map(([v, l]) => `<label><input type="radio" name="${p}-type" value="${v}" ${src.type === v ? "checked" : ""}><span>${l}</span></label>`).join("")}
      </div>
      ${src.type ? `
      <div class="msrc-fields">
        ${src.type !== "courtesy" ? `<div class="field"><label class="label" for="${p}-kind">Type</label><select class="input select" id="${p}-kind">${SRC_KINDS.map((k) => `<option${src.kind === k ? " selected" : ""}>${k}</option>`).join("")}</select></div>` : ""}
        <div class="field msrc-name"><label class="label" for="${p}-name">${nameLabel}${src.type === "staff" ? "" : ' <span class="req">*</span>'}</label><input class="input" id="${p}-name" value="${escapeAttr(src.name || (src.type === "own" ? writerName || "" : ""))}" placeholder="${escapeAttr(namePh)}"></div>
        ${src.type === "web" || src.type === "courtesy" ? `<div class="field msrc-url"><label class="label" for="${p}-url">Link to the source${src.type === "web" ? ' <span class="req">*</span>' : ' <em class="opt">(optional)</em>'}</label><input class="input" id="${p}-url" value="${escapeAttr(src.url)}" placeholder="https://…"></div>` : ""}
      </div>` : ""}
      <div class="msrc-credit" id="${p}-credit-line"></div>
    </div>`;
}
// Read the fields back into `src` (mutates and returns it).
function readSourceFields(root, p, src) {
  const t = root.querySelector(`input[name="${p}-type"]:checked`)?.value;
  if (t) src.type = t;
  const v = (id) => root.querySelector(`#${p}-${id}`);
  if (v("kind")) src.kind = v("kind").value;
  if (v("name")) src.name = v("name").value.trim();
  src.url = v("url") ? v("url").value.trim() : (src.type === "web" || src.type === "courtesy" ? src.url : "");
  src.license = "";
  if (src.type === "courtesy") src.kind = src.kind || "Photo";
  return src;
}
function paintCreditLine(root, p, src, legacyCredit) {
  const line = root.querySelector(`#${p}-credit-line`); if (!line) return;
  const txt = creditText(src), problem = sourceProblem(src);
  line.className = `msrc-credit${problem ? " is-missing" : ""}`;
  line.innerHTML = txt && !problem
    ? `<span>Credit will read</span><b>${escapeHtml(txt)}</b>`
    : `<span>${escapeHtml(problem)}</span>${legacyCredit ? `<em>Current credit: ${escapeHtml(legacyCredit)}</em>` : ""}`;
}
// Wire one source section inside `root`. Returns { get(), problem() }.
function wireSourceFields(root, p, src, writerName, legacyCredit, onChange) {
  const host = root.querySelector(`[data-src-prefix="${p}"]`);
  const repaint = () => {
    readSourceFields(root, p, src);
    host.outerHTML = sourceFieldsHTML(p, src, writerName);
    paintCreditLine(root, p, src, legacyCredit);
    rewire();
    onChange?.();
  };
  const rewire = () => {
    const h = root.querySelector(`[data-src-prefix="${p}"]`);
    h.querySelectorAll(`input[name="${p}-type"]`).forEach((r) => r.addEventListener("change", () => {
      const keepName = src.type === r.value ? src.name : "";
      src.type = r.value; src.name = keepName; if (r.value !== "web") src.license = "";
      if (r.value === "staff" || r.value === "ai") src.kind = "Illustration";
      const html = sourceFieldsHTML(p, src, writerName);
      h.outerHTML = html; paintCreditLine(root, p, src, legacyCredit); rewire(); onChange?.();
      root.querySelector(`#${p}-name`)?.focus();
    }));
    h.querySelectorAll("input, select").forEach((x) => x.addEventListener(x.tagName === "SELECT" ? "change" : "input", () => { readSourceFields(root, p, src); paintCreditLine(root, p, src, legacyCredit); onChange?.(); }));
  };
  paintCreditLine(root, p, src, legacyCredit); rewire();
  return { get: () => readSourceFields(root, p, src), problem: () => sourceProblem(readSourceFields(root, p, src)), repaint };
}

// Picture layouts in the image window: how much room the picture takes and
// whether the text wraps beside it. `size`/`align` become rt-size-* and
// rt-align-* classes, styled by css/article-layouts.css.
const MLAY_ICO = (body) => `<svg viewBox="0 0 64 44" fill="none">${body}</svg>`;
const MLAY_TXT = (x, w, ys) => ys.map((y) => `<rect x="${x}" y="${y}" width="${w}" height="2.6" rx="1.3" fill="currentColor" opacity=".35"/>`).join("");
const MEDIA_LAYOUTS = [
  { id: "inset-left", label: "Inset left", size: "compact", align: "left", hint: "A smaller picture on the left; the text wraps around it. Great for portraits and details.",
    icon: MLAY_ICO(`<rect x="8" y="9" width="20" height="16" rx="2" fill="currentColor" opacity=".8"/>${MLAY_TXT(32, 24, [10, 15, 20, 25])}${MLAY_TXT(8, 48, [30, 35])}`) },
  { id: "inset-right", label: "Inset right", size: "compact", align: "right", hint: "A smaller picture on the right; the text wraps around it.",
    icon: MLAY_ICO(`<rect x="36" y="9" width="20" height="16" rx="2" fill="currentColor" opacity=".8"/>${MLAY_TXT(8, 24, [10, 15, 20, 25])}${MLAY_TXT(8, 48, [30, 35])}`) },
  { id: "small", label: "Centered", size: "compact", align: "", hint: "A modest picture centred in the column, with text above and below.",
    icon: MLAY_ICO(`${MLAY_TXT(8, 48, [6])}<rect x="20" y="12" width="24" height="18" rx="2" fill="currentColor" opacity=".8"/>${MLAY_TXT(8, 48, [35])}`) },
  { id: "column", label: "Column", size: "standard", align: "", hint: "As wide as the text. The everyday choice.",
    icon: MLAY_ICO(`${MLAY_TXT(8, 48, [5])}<rect x="8" y="11" width="48" height="22" rx="2" fill="currentColor" opacity=".8"/>${MLAY_TXT(8, 48, [37])}`) },
  { id: "wide", label: "Wide", size: "wide", align: "", hint: "Breaks out past the text on both sides, for maps, charts and big scenes.",
    icon: MLAY_ICO(`${MLAY_TXT(14, 36, [5])}<rect x="3" y="11" width="58" height="22" rx="2" fill="currentColor" opacity=".8"/>${MLAY_TXT(14, 36, [37])}`) },
  { id: "full", label: "Full width", size: "large", align: "", hint: "Edge to edge across the whole screen. Save it for one big, beautiful photo.",
    icon: MLAY_ICO(`${MLAY_TXT(14, 36, [4])}<rect x="0" y="10" width="64" height="25" fill="currentColor" opacity=".8"/>${MLAY_TXT(14, 36, [39])}`) },
];

// ===== Media upload dialog (images + videos) ================================
// When `existingFigure` is passed, we edit it in place instead of inserting a
// new one — lets writers click an already-placed image/video to change its
// caption, alt text, or size. When `savedRange` is passed, the new figure is
// inserted at that exact caret position (the caller captured it before the
// dialog stole focus from the contenteditable).
function openMediaDialog(kind, editorEl, ctx, existingFigure = null, savedRange = null) {
  const isImage = kind === "image";
  const accept = isImage ? "image/*" : "video/*";
  const label = isImage ? "image" : "video";
  const isEdit = !!existingFigure;

  // Pull current values out of the figure so we can prefill the dialog.
  let initialUrl = "";
  let initialAlt = "";
  let initialCaption = "";
  let initialSize = "standard";
  let initialCredit = "";
  let initialLayout = "column", initialCap = "classic", initialFrame = "soft";
  const mSrc = { type: "", kind: kind === "video" ? "Video" : "Photo", name: "", url: "", license: "" };
  if (isEdit) {
    const mediaEl = existingFigure.querySelector(isImage ? "img" : "video");
    initialUrl = mediaEl?.getAttribute("src") || "";
    initialAlt = (isImage ? mediaEl?.getAttribute("alt") : mediaEl?.getAttribute("aria-label")) || "";
    // Reconstruct the writer-facing caption (main — credit) from the split
    // spans. Falls back to the raw textContent for older figures that were
    // inserted before the split-span structure existed.
    const capEl = existingFigure.querySelector("figcaption");
    if (capEl) {
      const mainSpan = capEl.querySelector(".fig-caption-text");
      const creditSpan = capEl.querySelector(".fig-caption-credit");
      if (mainSpan || creditSpan) {
        initialCaption = (mainSpan?.textContent || "").trim();
        initialCredit = (creditSpan?.textContent || "").trim();
      } else {
        initialCaption = capEl.textContent.trim();
      }
    }
    Object.assign(mSrc, Object.fromEntries(Object.entries(readFigureSource(existingFigure)).filter(([, v]) => v)));
    if (!mSrc.url) mSrc.url = existingFigure.querySelector(".fig-caption-credit a")?.getAttribute("href") || "";
    const sizeMatch = (existingFigure.className || "").match(/rt-size-(\w+)/);
    if (sizeMatch) initialSize = sizeMatch[1];
    const cls = existingFigure.classList;
    initialLayout = cls.contains("rt-align-left") ? "inset-left" : cls.contains("rt-align-right") ? "inset-right"
      : ({ small: "small", compact: "small", standard: "column", wide: "wide", large: "full" })[initialSize] || "column";
    initialCap = cls.contains("rt-cap-minimal") ? "minimal" : cls.contains("rt-cap-side") ? "side" : cls.contains("rt-cap-overlay") ? "overlay" : "classic";
    initialFrame = cls.contains("rt-frame-plain") ? "plain" : cls.contains("rt-frame-rounded") ? "rounded" : cls.contains("rt-frame-mounted") ? "mounted" : "soft";
  }

  // Build the modal
  const scrim = el("div", { class: "media-dialog-scrim" });
  const modal = el("div", { class: "media-dialog" });

  modal.innerHTML = `
    <div class="media-dialog-head">
      <div class="media-dialog-title">${isEdit ? "Edit" : "Insert"} ${label}</div>
      <button class="media-dialog-close" aria-label="Close">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <div class="media-dialog-body">
      <div class="media-dropzone" id="m-drop" tabindex="0">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="17 8 12 3 7 8"/>
          <line x1="12" y1="3" x2="12" y2="15"/>
        </svg>
        <div class="media-dropzone-title">${isEdit ? `Replace the ${label}` : `Drop ${isImage ? "an image" : "a video"} here`}, or <span class="link">browse your computer</span></div>
        <div class="media-dropzone-hint">${isImage ? "JPG, PNG, WebP, or GIF — up to 10 MB." : "MP4 or WebM — up to 100 MB."}</div>
        <input type="file" id="m-file" accept="${accept}" hidden />
      </div>

      <div class="media-or"><span>or</span></div>

      ${isImage ? `
      <div class="field">
        <button type="button" class="btn btn-secondary btn-sm" id="m-browse-library" style="width:100%;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:6px;"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
          Choose from your image library
        </button>
      </div>` : ""}

      <div class="field">
        <label class="label" style="font-size:12px;">Or paste a URL</label>
        <input class="input" id="m-url" placeholder="https://…" value="${escapeAttr(initialUrl)}" />
      </div>

      <div class="field">
        <label class="label">${isImage ? "Alt text (describe the image) <span style=\"color:var(--danger,#dc2626);\">*</span>" : "Caption / description"}</label>
        <input class="input" id="m-alt" placeholder="${isImage ? "e.g. 'A researcher pipettes a blue sample into a microplate in a lab'" : "What's happening in this video"}" value="${escapeAttr(initialAlt)}" />
        ${isImage ? `<div class="hint" style="margin-top:6px;">Required. Describe what the image shows in one clear sentence — write it for a reader who can't see it. This is read aloud by screen readers <strong>and</strong> helps this article rank in Google Image search (better SEO for your story).</div>` : ""}
      </div>
      <div class="field">
        <label class="label" for="m-caption">Caption <em class="opt">(optional)</em></label>
        <input class="input" id="m-caption" placeholder="e.g. Researchers review the sequencing data at the Milken Institute." value="${escapeAttr(initialCaption)}" />
      </div>
      ${sourceFieldsHTML("m-src", mSrc, ctx?.profile?.name || "")}
      ${isImage ? `
      <div class="media-design">
        <div class="media-design-controls">
          <div class="field">
            <span class="label">Layout</span>
            <div class="mlay-grid" role="radiogroup" aria-label="Layout">
              ${MEDIA_LAYOUTS.map((o) => `<label class="mlay-opt" title="${o.hint}"><input type="radio" name="m-layout" value="${o.id}" ${initialLayout === o.id ? "checked" : ""}><span class="mlay-ico" aria-hidden="true">${o.icon}</span><span class="mlay-name">${o.label}</span></label>`).join("")}
            </div>
            <div class="hint" id="m-layout-hint"></div>
          </div>
          <div class="field">
            <span class="label">Caption style</span>
            <div class="mseg" role="radiogroup" aria-label="Caption style">
              ${[["classic", "Classic"], ["minimal", "Minimal"], ["side", "Beside"], ["overlay", "On image"]].map(([v, l]) => `<label><input type="radio" name="m-cap" value="${v}" ${initialCap === v ? "checked" : ""}><span>${l}</span></label>`).join("")}
            </div>
          </div>
          <div class="field">
            <span class="label">Edges</span>
            <div class="mseg" role="radiogroup" aria-label="Edges">
              ${[["soft", "Soft"], ["plain", "Square"], ["rounded", "Rounded"], ["mounted", "Mounted"]].map(([v, l]) => `<label><input type="radio" name="m-frame" value="${v}" ${initialFrame === v ? "checked" : ""}><span>${l}</span></label>`).join("")}
            </div>
          </div>
        </div>
        <div class="media-preview" aria-hidden="true">
          <div class="media-preview-label">Preview</div>
          <div class="mlp" id="m-preview"></div>
        </div>
      </div>` : ""}

      <div class="media-progress" id="m-progress" hidden>
        <div class="media-progress-bar"><span id="m-progress-fill"></span></div>
        <div class="media-progress-text" id="m-progress-text">Uploading… 0%</div>
      </div>

      <div class="media-error" id="m-error"></div>
    </div>
    <div class="media-dialog-foot">
      ${isEdit ? `<button class="btn btn-ghost btn-sm" id="m-delete" style="color:var(--danger);margin-right:auto;">Remove ${label}</button>` : ""}
      <button class="btn btn-ghost btn-sm" id="m-cancel">Cancel</button>
      <button class="btn btn-accent btn-sm" id="m-insert" ${isEdit ? "" : "disabled"}>${isEdit ? "Save changes" : "Insert"}</button>
    </div>
  `;

  if (isImage) modal.classList.add("media-dialog-design");
  document.body.appendChild(scrim);
  document.body.appendChild(modal);
  requestAnimationFrame(() => { scrim.classList.add("open"); modal.classList.add("open"); });

  const fileInput = modal.querySelector("#m-file");
  let paintPreview = () => {};
  const srcCtl = wireSourceFields(modal, "m-src", mSrc, ctx?.profile?.name || "", initialCredit, () => paintPreview());
  const urlInput = modal.querySelector("#m-url");
  const altInput = modal.querySelector("#m-alt");
  const capInput = modal.querySelector("#m-caption");
  const drop = modal.querySelector("#m-drop");
  const insertBtn = modal.querySelector("#m-insert");
  const progressWrap = modal.querySelector("#m-progress");
  const progressFill = modal.querySelector("#m-progress-fill");
  const progressText = modal.querySelector("#m-progress-text");
  const errorEl = modal.querySelector("#m-error");

  let resolvedUrl = null;
  let pendingFile = null;

  // Live preview of where the picture sits in the article.
  const pick = (name, fallback) => modal.querySelector(`input[name="${name}"]:checked`)?.value || fallback;
  paintPreview = () => {
    const pv = modal.querySelector("#m-preview"); if (!pv) return;
    const layout = pick("m-layout", "column"), cap = pick("m-cap", "classic"), frame = pick("m-frame", "soft");
    const L = MEDIA_LAYOUTS.find((o) => o.id === layout) || MEDIA_LAYOUTS[0];
    const src = resolvedUrl || (urlInput.value.trim().startsWith("http") ? urlInput.value.trim() : "") || initialUrl;
    const credit = sourceProblem(mSrc) ? "" : creditText(mSrc);
    const capTxt = (capInput.value.trim() || (credit ? "" : "Your caption appears here"));
    const lines = (n, short) => Array.from({ length: n }, (_, i) => `<i class="mlp-line${short && i === n - 1 ? " is-short" : ""}"></i>`).join("");
    pv.className = `mlp is-${layout}`;
    pv.innerHTML = `${layout.startsWith("inset") ? "" : lines(2)}
      <div class="mlp-fig is-${layout} cap-${cap} frame-${frame}">
        <div class="mlp-img">${src ? `<img src="${escapeAttr(src)}" alt="">` : ""}</div>
        ${capTxt || credit ? `<div class="mlp-cap"><b>${escapeHtml(capTxt)}</b>${credit ? `<small>${escapeHtml(credit)}</small>` : ""}</div>` : ""}
      </div>
      ${lines(layout.startsWith("inset") ? 9 : 4, true)}`;
    const hint = modal.querySelector("#m-layout-hint"); if (hint) hint.textContent = L.hint;
  };
  modal.addEventListener("change", (e) => { if (e.target.matches('input[name="m-layout"], input[name="m-cap"], input[name="m-frame"]')) paintPreview(); });
  capInput.addEventListener("input", paintPreview);
  urlInput.addEventListener("change", paintPreview);

  const onEsc = (e) => { if (e.key === "Escape" && document.body.lastElementChild === modal) { e.stopPropagation(); close(); } };
  document.addEventListener("keydown", onEsc, true);
  const close = () => {
    document.removeEventListener("keydown", onEsc, true);
    scrim.classList.remove("open");
    modal.classList.remove("open");
    setTimeout(() => { scrim.remove(); modal.remove(); }, 200);
  };
  modal.querySelector(".media-dialog-close").addEventListener("click", close);
  modal.querySelector("#m-cancel").addEventListener("click", close);
  scrim.addEventListener("click", close);

  const updateInsertState = () => {
    insertBtn.disabled = !(resolvedUrl || urlInput.value.trim());
  };
  urlInput.addEventListener("input", () => {
    resolvedUrl = null;
    pendingFile = null;
    updateInsertState();
  });

  // Clear the "needs alt text" warning once the writer starts describing it.
  altInput.addEventListener("input", () => {
    if (altInput.value.trim()) {
      altInput.classList.remove("input--needs-attention");
      if (errorEl.textContent.startsWith("Please add alt text")) errorEl.textContent = "";
    }
  });

  const libraryBtn = modal.querySelector("#m-browse-library");
  if (libraryBtn) {
    libraryBtn.addEventListener("click", () => {
      openImageLibraryPicker(ctx, (pickedUrl) => {
        resolvedUrl = pickedUrl;
        pendingFile = null;
        urlInput.value = pickedUrl;
        urlInput.disabled = false;
        drop.classList.add("has-file");
        progressWrap.hidden = true;
        errorEl.textContent = "";
        updateInsertState();
        paintPreview();
      });
    });
  }
  paintPreview();

  drop.addEventListener("click", () => fileInput.click());
  drop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") fileInput.click(); });
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("hover"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("hover"));
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    drop.classList.remove("hover");
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  });
  fileInput.addEventListener("change", (e) => {
    const f = e.target.files[0];
    if (f) handleFile(f);
  });

  const maxBytes = isImage ? 10 * 1024 * 1024 : 100 * 1024 * 1024;
  async function handleFile(file) {
    errorEl.textContent = "";
    if (isImage && !file.type.startsWith("image/")) { errorEl.textContent = "Please choose an image file."; return; }
    if (!isImage && !file.type.startsWith("video/")) { errorEl.textContent = "Please choose a video file."; return; }
    if (file.size > maxBytes) {
      errorEl.textContent = `File too large. Max ${isImage ? "10 MB" : "100 MB"}.`;
      return;
    }
    pendingFile = file;
    urlInput.value = file.name;
    urlInput.disabled = true;
    drop.classList.add("has-file");

    try {
      progressWrap.hidden = false;
      resolvedUrl = await uploadToFirebase(file, kind, ctx, (pct) => {
        progressFill.style.width = pct + "%";
        progressText.textContent = `Uploading… ${pct}%`;
      });
      progressText.textContent = "Upload complete.";
      updateInsertState();
      paintPreview();
    } catch (err) {
      errorEl.textContent = "Upload failed: " + (err?.message || err);
      progressWrap.hidden = true;
      urlInput.disabled = false;
      urlInput.value = "";
      resolvedUrl = null;
      pendingFile = null;
      drop.classList.remove("has-file");
    }
  }

  insertBtn.addEventListener("click", () => {
    const url = resolvedUrl || urlInput.value.trim();
    if (!url) return;
    const alt = altInput.value.trim();

    // Require alt text on images. It's read aloud by screen readers and is a
    // real Google Image-search ranking signal, so we don't let a story ship an
    // undescribed image. Prompt the writer and focus the field instead of
    // silently inserting an empty alt="".
    if (isImage && !alt) {
      errorEl.innerHTML = "Please add alt text — describe what the image shows so it's accessible and helps your article's SEO.";
      altInput.focus();
      altInput.classList.add("input--needs-attention");
      altInput.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    const caption = capInput.value.trim();
    const srcProblem = srcCtl.problem();
    if (srcProblem) {
      errorEl.textContent = `Image source: ${srcProblem}`;
      modal.querySelector(".msrc")?.scrollIntoView({ behavior: "smooth", block: "center" });
      modal.querySelector(".msrc")?.classList.add("flash-attention");
      setTimeout(() => modal.querySelector(".msrc")?.classList.remove("flash-attention"), 1600);
      return;
    }
    const src = srcCtl.get();
    const credit = creditHtml(src);
    let figClass = "rt-figure rt-size-standard";
    if (isImage) {
      const L = MEDIA_LAYOUTS.find((o) => o.id === pick("m-layout", "column")) || MEDIA_LAYOUTS[0];
      // Keep a legacy "small" when it's still small, otherwise use the layout's size.
      const size = L.size === "compact" && initialSize === "small" ? "small" : L.size;
      const cap = pick("m-cap", "classic"), frame = pick("m-frame", "soft");
      figClass = ["rt-figure", `rt-size-${size}`, L.align ? `rt-align-${L.align}` : "", cap !== "classic" ? `rt-cap-${cap}` : "", frame !== "soft" ? `rt-frame-${frame}` : ""].filter(Boolean).join(" ");
    }

    // Build just the <figure>…</figure> (no trailing <p>) so an in-place edit
    // doesn't duplicate the empty paragraph that already follows the figure.
    // An em-dash in the caption still works as a credit separator.
    const captionHtml = `<figcaption>${caption ? `<span class="fig-caption-text">${escapeHtml(caption)}</span>` : ""}${credit}</figcaption>`;
    const figureHtml = isImage
      ? `<figure class="${figClass}" contenteditable="false" data-rt-figure="image"${sourceAttrs(src)}>
           <img src="${escapeAttr(url)}" alt="${escapeAttr(alt)}" />
           ${captionHtml}
         </figure>`
      : `<figure class="rt-figure rt-figure-video" contenteditable="false" data-rt-figure="video"${sourceAttrs(src)}>
           <video src="${escapeAttr(url)}" controls playsinline preload="metadata"${alt ? ` aria-label="${escapeAttr(alt)}"` : ""}></video>
           ${captionHtml}
         </figure>`;

    if (isEdit) {
      // Replace the existing figure in place. Using outerHTML keeps the
      // surrounding text (and empty paragraph after) exactly as it was.
      existingFigure.outerHTML = figureHtml;
    } else {
      // New insert — use the caret position the toolbar captured before the
      // dialog opened, and add a blank paragraph so typing continues below.
      insertBlockAtCaret(editorEl, figureHtml + `<p><br/></p>`, savedRange);
    }
    editorEl.dispatchEvent(new Event("input", { bubbles: true }));
    close();
  });

  // Remove button (edit mode only) — deletes the figure from the article.
  const deleteBtn = modal.querySelector("#m-delete");
  if (deleteBtn && isEdit) {
    deleteBtn.addEventListener("click", () => {
      existingFigure.remove();
      editorEl.dispatchEvent(new Event("input", { bubbles: true }));
      close();
    });
  }
}

// ===== Image library picker =================================================
// Lists every image the current writer has previously uploaded (both inline
// figures and cover images go to the same path prefix) and lets them pick
// one to reuse. Called from the media dialog and the cover-image field.
export function openImageLibraryPicker(ctx, onPick) {
  const uid = ctx?.user?.uid;
  if (!uid) { ctx?.toast?.("Sign in to browse your library.", "error"); return; }

  const isAdmin = ctx?.role === "admin";
  const scrim = el("div", { class: "media-dialog-scrim" });
  const modal = el("div", { class: "media-dialog media-dialog-wide" });
  modal.innerHTML = `
    <div class="media-dialog-head">
      <div class="media-dialog-title">${isAdmin ? "Image library (all writers)" : "Your image library"}</div>
      <button class="media-dialog-close" aria-label="Close">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <div class="media-dialog-body">
      <div class="library-grid-toolbar">
        <div class="hint">${isAdmin
          ? "Every image uploaded by any writer. Click to reuse, or hover to delete."
          : "Click an image to use it. These are photos you've uploaded from any article."}</div>
        <div class="library-grid-count" id="lib-count"></div>
      </div>
      <div class="library-grid-scroll">
        <div id="lib-grid" class="library-grid">
          <div class="loading-state" style="grid-column:1/-1;"><div class="spinner"></div>Loading images…</div>
        </div>
      </div>
      <div class="media-error" id="lib-error"></div>
    </div>
    <div class="media-dialog-foot">
      <button class="btn btn-ghost btn-sm" id="lib-cancel">Cancel</button>
    </div>
  `;
  document.body.appendChild(scrim);
  document.body.appendChild(modal);
  requestAnimationFrame(() => { scrim.classList.add("open"); modal.classList.add("open"); });

  const close = () => {
    scrim.classList.remove("open");
    modal.classList.remove("open");
    setTimeout(() => { scrim.remove(); modal.remove(); }, 200);
  };
  modal.querySelector(".media-dialog-close").addEventListener("click", close);
  modal.querySelector("#lib-cancel").addEventListener("click", close);
  scrim.addEventListener("click", close);

  const grid = modal.querySelector("#lib-grid");
  const errorEl = modal.querySelector("#lib-error");
  const countEl = modal.querySelector("#lib-count");

  (async () => {
    try {
      const entries = await loadImageLibrary(isAdmin ? null : uid);
      if (!entries.length) {
        grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;">No images yet. Upload one and it'll appear here next time.</div>`;
        countEl.textContent = "";
        return;
      }
      countEl.textContent = `${entries.length} image${entries.length === 1 ? "" : "s"}`;
      renderLibraryGrid(grid, entries, {
        allowDelete: isAdmin,
        onPick: (entry) => { onPick(entry.url); close(); },
        onDelete: async (entry, tile) => {
          const ok = await confirmDialog(
            "Delete this image? It will be removed from Firebase Storage, and any article referencing it will show a broken image.",
            { confirmText: "Delete", danger: true },
          );
          if (!ok) return;
          try {
            await deleteObject(entry.ref);
            tile.remove();
            const remaining = grid.querySelectorAll(".library-tile").length;
            countEl.textContent = remaining ? `${remaining} image${remaining === 1 ? "" : "s"}` : "";
            if (!remaining) {
              grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;">Library is empty.</div>`;
            }
            ctx?.toast?.("Image deleted.", "success");
          } catch (err) {
            ctx?.toast?.("Could not delete: " + (err?.message || err), "error");
          }
        },
      });
    } catch (err) {
      errorEl.textContent = "Could not load library: " + (err?.message || err);
      grid.innerHTML = "";
    }
  })();
}

// Load the image library entries. When `ownerUid` is passed we only list
// that user's folder; when null we walk every writer's folder (admin view).
export async function loadImageLibrary(ownerUid) {
  const rootPaths = ownerUid ? [`stories/${ownerUid}/images`] : await listAllUserImagePaths();
  const allEntries = [];
  for (const path of rootPaths) {
    try {
      const folderRef = storageRef(storage, path);
      const listing = await listAll(folderRef);
      const batch = await Promise.all(listing.items.map(async (item) => {
        try {
          const [url, meta] = await Promise.all([
            getDownloadURL(item),
            getMetadata(item).catch(() => null),
          ]);
          const updated = meta?.updated ? new Date(meta.updated).getTime() : 0;
          const ownerFromPath = item.fullPath.split("/")[1] || "";
          return {
            url,
            name: item.name,
            ref: item,
            fullPath: item.fullPath,
            owner: ownerFromPath,
            size: meta?.size || 0,
            contentType: meta?.contentType || "",
            updated,
          };
        } catch {
          return null;
        }
      }));
      batch.filter(Boolean).forEach((e) => allEntries.push(e));
    } catch (err) {
      console.warn("[image-library] skipping", path, err?.message || err);
    }
  }
  return allEntries.sort((a, b) => b.updated - a.updated);
}

// Enumerate every writer folder under `stories/`. Admin-only.
async function listAllUserImagePaths() {
  const root = storageRef(storage, "stories");
  const listing = await listAll(root);
  return listing.prefixes.map((p) => `${p.fullPath}/images`);
}

export function renderLibraryGrid(grid, entries, opts = {}) {
  const { allowDelete = false, onPick, onDelete, usageBadge } = opts;
  grid.innerHTML = "";
  entries.forEach((entry) => {
    const tile = el("button", { class: "library-tile", type: "button", title: "Click to use this image" });
    const metaLine = entry.owner ? shortenOwner(entry.owner) : "";
    let badgeHtml = "";
    if (usageBadge) {
      const status = usageBadge(entry); // "used" | "unused" | null
      if (status === "unused") {
        tile.classList.add("library-tile--unused");
        badgeHtml = `<span class="library-tile-badge library-tile-badge--unused" title="This image isn't referenced by any article — safe to delete.">Unused</span>`;
      } else if (status === "used") {
        badgeHtml = `<span class="library-tile-badge library-tile-badge--used" title="Referenced by at least one article.">Used</span>`;
      }
    }
    tile.innerHTML = `
      <img src="${escapeAttr(entry.url)}" alt="" loading="lazy" />
      ${badgeHtml}
      ${metaLine ? `<div class="library-tile-meta">${escapeHtml(metaLine)}</div>` : ""}
      ${allowDelete ? `<span class="library-tile-delete" role="button" aria-label="Delete image" title="Delete this image">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
      </span>` : ""}`;
    tile.addEventListener("click", (e) => {
      if (allowDelete && e.target.closest(".library-tile-delete")) {
        e.preventDefault();
        e.stopPropagation();
        onDelete && onDelete(entry, tile);
        return;
      }
      onPick && onPick(entry);
    });
    grid.appendChild(tile);
  });
}

function shortenOwner(uid) {
  if (!uid) return "";
  return uid.length > 10 ? `${uid.slice(0, 6)}…${uid.slice(-3)}` : uid;
}

// Content-hash-based upload. The storage path is derived from the file's
// SHA-256, so re-uploading the same image (even with a different filename)
// lands on the same object — automatic dedupe, no orphan copies.
export async function uploadToFirebase(file, kind, ctx, onProgress) {
  const uid = ctx?.user?.uid || "anonymous";
  const toUpload = kind === "image" ? await convertToWebp(file) : file;
  const hash = await hashFile(toUpload);
  const ext = extFromFile(toUpload);
  const path = `stories/${uid}/${kind}s/${hash}${ext}`;
  const ref = storageRef(storage, path);

  // If this exact file was already uploaded, reuse the existing object.
  try {
    await getMetadata(ref);
    onProgress && onProgress(100);
    const url = await getDownloadURL(ref);
    return url;
  } catch (err) {
    // Not found (object-not-found) — proceed with upload. Any other error
    // also falls through; the upload will surface the real problem.
  }

  const task = uploadBytesResumable(ref, toUpload, { contentType: toUpload.type });
  return new Promise((resolve, reject) => {
    task.on(
      "state_changed",
      (snap) => {
        const pct = Math.round((snap.bytesTransferred / snap.totalBytes) * 100);
        onProgress && onProgress(pct);
      },
      (err) => reject(err),
      async () => {
        try {
          const url = await getDownloadURL(task.snapshot.ref);
          resolve(url);
        } catch (err) { reject(err); }
      }
    );
  });
}

async function hashFile(file) {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function extFromFile(file) {
  const fromName = (file.name || "").match(/\.[a-z0-9]+$/i);
  if (fromName) return fromName[0].toLowerCase();
  const type = (file.type || "").toLowerCase();
  if (type === "image/webp") return ".webp";
  if (type === "image/png") return ".png";
  if (type === "image/jpeg") return ".jpg";
  if (type === "image/gif") return ".gif";
  if (type === "video/mp4") return ".mp4";
  if (type === "video/webm") return ".webm";
  return "";
}

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function escapeAttr(s) { return escapeHtml(s).replace(/`/g, "&#96;"); }

// ===== Hero live preview ====================================================
function wireHeroPreview(wrap) {
  const article = wrap.querySelector(".compose-article");
  const heroImg = wrap.querySelector("#hero-image");
  const coverInput = wrap.querySelector("#f-cover");
  const categoryEl = wrap.querySelector("#f-category");
  const heroCategory = wrap.querySelector("#hero-category");
  const body = wrap.querySelector("#f-body");
  const readingTime = wrap.querySelector("#hero-reading-time");

  const refreshCover = () => {
    const url = coverInput.value.trim();
    if (url) {
      heroImg.style.backgroundImage = `url("${url.replace(/"/g, '\\"')}")`;
      article.setAttribute("data-has-cover", "true");
    } else {
      heroImg.style.backgroundImage = "";
      article.setAttribute("data-has-cover", "false");
    }
  };
  // Per-category description that appears under the dropdown so writers
  // know which one they actually want. Pulled out of the JSX so the
  // copy is editable in one place. Keep titles short — the wider span
  // does the explanatory work.
  const CATEGORY_HELP = {
    "Feature":   { title: "In-depth reported story",   body: "A long-form piece with reporting, multiple sources, and a clear narrative arc — your default for ambitious work." },
    "Profile":   { title: "Person- or lab-led story",  body: "Focuses on a researcher, professor, lab, or student. Built around interviews + their work; the person is the through-line." },
    "Interview": { title: "Q&A format",                body: "Lightly edited Q&A with one interview subject. Use this only when the back-and-forth IS the story; otherwise use Profile or Feature." },
    "Op-Ed":     { title: "Opinion / argument",        body: "First-person argument with a clear take. Cite sources, but the angle is yours. Editors will press for a sharp thesis." },
    "News":      { title: "Time-sensitive update",     body: "Short, factual report on a development that just happened. Lead with the news; depth comes from a follow-up Feature." },
    "Science":   { title: "Explainer / concept piece", body: "Unpacks a STEM concept, finding, or method for a college-level reader. Less reporting-heavy than a Feature; more teaching." },
  };
  const helpEl = wrap.querySelector("#category-help");
  const refreshCategory = () => {
    const value = categoryEl.value || "Feature";
    heroCategory.textContent = value.toUpperCase();
    if (helpEl) {
      const meta = CATEGORY_HELP[value] || { title: value, body: "" };
      helpEl.dataset.category = value;
      helpEl.querySelector(".category-help-title").textContent = meta.title;
      helpEl.querySelector(".category-help-body").textContent = meta.body;
    }
  };
  const lightCoverCb = wrap.querySelector("#f-cover-light");
  const refreshLightCover = () => {
    article.classList.toggle("article--light-cover", !!lightCoverCb?.checked);
  };
  const refreshReadingTime = () => {
    const words = (body.textContent || "").trim().split(/\s+/).filter(Boolean).length;
    const mins = Math.max(1, Math.round(words / 220));
    readingTime.textContent = `${mins} min read`;
  };

  coverInput.addEventListener("input", refreshCover);
  categoryEl.addEventListener("change", refreshCategory);
  body.addEventListener("input", refreshReadingTime);
  if (lightCoverCb) lightCoverCb.addEventListener("change", refreshLightCover);
  refreshCover(); refreshCategory(); refreshReadingTime(); refreshLightCover();

  // Make title/dek single-line-ish: prevent Enter from creating <div>s inside them.
  ["#f-title", "#f-dek"].forEach((sel) => {
    const n = wrap.querySelector(sel);
    n.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        // Move focus into the next field / body.
        if (sel === "#f-title") wrap.querySelector("#f-dek").focus();
        else wrap.querySelector("#f-body").focus();
      }
    });
    // Strip any pasted HTML in title/dek.
    n.addEventListener("paste", (e) => {
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData("text/plain").replace(/\n+/g, " ");
      document.execCommand("insertText", false, text);
    });
  });
}

// ===== Settings drawer ======================================================
function wireSettingsDrawer(wrap) {
  const panel = wrap.querySelector("#compose-settings");
  const scrim = wrap.querySelector("#settings-scrim");
  const open = () => { panel.classList.add("open"); scrim.classList.add("open"); panel.setAttribute("aria-hidden", "false"); };
  const close = () => { panel.classList.remove("open"); scrim.classList.remove("open"); panel.setAttribute("aria-hidden", "true"); };
  wrap.querySelector("#toggle-settings").addEventListener("click", open);
  wrap.querySelector("#close-settings").addEventListener("click", close);
  scrim.addEventListener("click", close);

  // Topic chips — toggle on/off (and the inline styling) on click. Selected
  // topics are read back from the .is-on chips at save time (saveStory).
  wrap.querySelectorAll(".f-topic-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const on = chip.classList.toggle("is-on");
      chip.setAttribute("aria-pressed", on ? "true" : "false");
      chip.style.background = on ? "var(--ink,#0f172a)" : "#fff";
      chip.style.color = on ? "#fff" : "var(--ink-2,#475569)";
      chip.style.borderColor = on ? "var(--ink,#0f172a)" : "var(--hairline,#e6e6e6)";
    });
  });
}

// Reflect the chip's on/off visual state. Shared by the load path (when a
// draft is reopened) and could be reused elsewhere. Kept tiny + inline-style
// based so it doesn't depend on dashboard.css carrying a .is-on rule.
function setTopicChipState(chip, on) {
  chip.classList.toggle("is-on", on);
  chip.setAttribute("aria-pressed", on ? "true" : "false");
  chip.style.background = on ? "var(--ink,#0f172a)" : "#fff";
  chip.style.color = on ? "#fff" : "var(--ink-2,#475569)";
  chip.style.borderColor = on ? "var(--ink,#0f172a)" : "var(--hairline,#e6e6e6)";
}

// ===== Cover-image upload ===================================================
function wireCoverUpload(wrap, ctx) {
  const btn       = wrap.querySelector("#f-cover-upload-btn");
  const libraryBtn = wrap.querySelector("#f-cover-library-btn");
  const fileInput = wrap.querySelector("#f-cover-file");
  const urlInput  = wrap.querySelector("#f-cover");
  const progress  = wrap.querySelector("#f-cover-progress");
  const fill      = wrap.querySelector("#f-cover-progress-fill");
  const text      = wrap.querySelector("#f-cover-progress-text");
  // The cover tile on the page shows the same progress.
  const busy      = wrap.querySelector("#wd-cover-busy");
  const busyText  = wrap.querySelector("#wd-cover-busy-text");

  btn.addEventListener("click", () => fileInput.click());
  if (libraryBtn) {
    libraryBtn.addEventListener("click", () => {
      openImageLibraryPicker(ctx, (pickedUrl) => {
        urlInput.value = pickedUrl;
        urlInput.dispatchEvent(new Event("input", { bubbles: true }));
      });
    });
  }
  fileInput.addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { ctx.toast("Please choose an image file.", "error"); return; }
    if (file.size > 10 * 1024 * 1024) ctx.toast("Preparing large image…");

    progress.hidden = false;
    fill.style.width = "0%";
    text.textContent = "Preparing…";
    btn.disabled = true;

    try {
      if (busy) { busy.hidden = false; busyText.textContent = "Preparing…"; }
      const url = await uploadToFirebase(file, "image", ctx, (pct) => {
        fill.style.width = pct + "%";
        text.textContent = `Uploading… ${pct}%`;
        if (busyText) busyText.textContent = `Uploading… ${pct}%`;
      });
      urlInput.value = url;
      urlInput.dispatchEvent(new Event("input", { bubbles: true }));
      text.textContent = "Uploaded.";
      setTimeout(() => { progress.hidden = true; }, 800);
    } catch (err) {
      ctx.toast("Cover upload failed: " + (err?.message || err), "error");
      progress.hidden = true;
    } finally {
      btn.disabled = false;
      if (busy) busy.hidden = true;
      fileInput.value = "";
    }
  });
}

async function loadDraft(id, wrap, ctx) {
  try {
    const snap = await getDoc(doc(db, "stories", id));
    if (!snap.exists()) return;
    const d = snap.data();
    if (d.authorId !== ctx.user.uid && ctx.role !== "admin" && ctx.role !== "editor") {
      wrap.querySelector("#form-msg").textContent = "You don't have permission to edit this article.";
      wrap.querySelectorAll("input, select, button").forEach((n) => n.disabled = true);
      wrap.querySelectorAll("[contenteditable]").forEach((n) => n.setAttribute("contenteditable", "false"));
      return;
    }
    wrap.querySelector("#f-title").textContent = d.title || "";
    wrap.querySelector("#f-category").value = d.category || "Feature";
    // Restore the saved topic chips so reopening a draft keeps its tags.
    const savedTags = Array.isArray(d.tags) ? d.tags : [];
    wrap.querySelectorAll(".f-topic-chip").forEach((chip) => {
      setTopicChipState(chip, savedTags.includes(chip.dataset.topic));
    });
    wrap.querySelector("#f-cover").value = d.coverImage || "";
    const lightCoverCb = wrap.querySelector("#f-cover-light");
    if (lightCoverCb) {
      lightCoverCb.checked = !!d.lightCover;
      lightCoverCb.dispatchEvent(new Event("change", { bubbles: true }));
    }
    wrap.querySelector("#f-dek").textContent = d.dek || d.excerpt || "";
    const bodyEl = wrap.querySelector("#f-body");
    bodyEl.innerHTML = d.body || "";
    // Repair figures on reload: historical drafts (and older paste imports)
    // may be missing contenteditable="false" or the data-rt-figure flag, and
    // without those the click-to-edit handler can't match them. Also upgrade
    // any bare <img> that never got wrapped in a .rt-figure so writers can
    // edit size/alt/caption on old inline images too. Strip stale width/
    // height attrs that old Docs pastes persisted so CSS can size the image.
    stripInlineImgDimensions(bodyEl);
    upgradeLegacyImages(bodyEl);
    normalizeEditorFigures(bodyEl);
    // Restore the writer's checklist state so progress carries across sessions.
    const saved = d.writerChecklist || {};
    document.querySelectorAll('#writer-checklist-body input[type="checkbox"]').forEach((cb) => {
      cb.checked = !!saved[cb.dataset.k];
      cb.closest(".checklist-item").classList.toggle("done", cb.checked);
    });
    const progressEl = document.getElementById("writer-checklist-progress");
    if (progressEl) {
      const total = document.querySelectorAll('#writer-checklist-body input[type="checkbox"]').length;
      const done = document.querySelectorAll('#writer-checklist-body input[type="checkbox"]:checked').length;
      progressEl.textContent = `${done}/${total}`;
      progressEl.classList.toggle("complete", done === total);
    }
    // Refresh hero preview
    wrap.querySelector("#f-cover").dispatchEvent(new Event("input", { bubbles: true }));
    wrap.querySelector("#f-category").dispatchEvent(new Event("change", { bubbles: true }));
  } catch (err) {
    wrap.querySelector("#form-msg").textContent = "Could not load draft: " + err.message;
  }
}

/**
 * Drive-review explainer shown the first time a writer starts typing in
 * any compose field on the Submit-a-draft page. Explains the off-platform
 * workflow that needs to happen before this dashboard submission: the
 * writer drops the draft into their folder in the shared Catalyst Google
 * Drive and gets it reviewed by a peer editor there. Once that peer
 * review is done, they paste/type the final version into the dashboard
 * here and use "Submit for review" to send it to admins.
 *
 * Informational only — does not block the writer either way.
 */
function openDriveReviewGate() {
  return new Promise((resolve) => {
    ensureDriveGateStyles();
    const body = el("div", { style: { fontFamily: "'Inter',-apple-system,BlinkMacSystemFont,sans-serif" } });
    body.innerHTML = `
      <p style="margin:0 0 14px;font-size:14px;line-height:1.55;color:#1f2937;">
        Quick heads-up before you start writing here. Your story should
        first live in the <strong>shared Catalyst Google Drive</strong> and
        be reviewed by a peer editor there. Only after that peer review
        should you bring the final version into this editorial dashboard
        for admins to do the final pass.
      </p>

      <div class="drive-gate-steps">
        <div class="drive-gate-step">
          <div class="drive-gate-step-num">1</div>
          <div class="drive-gate-step-body">
            <div class="drive-gate-step-title">Draft it in Google Drive first</div>
            <div class="drive-gate-step-text">Write your story inside <em>your folder</em> in the shared Catalyst Google Drive. If you don't have a folder yet, ask Aidan or Yair.</div>
          </div>
        </div>
        <div class="drive-gate-step">
          <div class="drive-gate-step-num">2</div>
          <div class="drive-gate-step-body">
            <div class="drive-gate-step-title">Get it reviewed by a peer editor</div>
            <div class="drive-gate-step-text">Share it with one of our peer editors and work through their comments in Google Docs. Resolve every thread before moving on.</div>
          </div>
        </div>
        <div class="drive-gate-step">
          <div class="drive-gate-step-num">3</div>
          <div class="drive-gate-step-body">
            <div class="drive-gate-step-title">Then bring the final version here</div>
            <div class="drive-gate-step-text">Paste the polished draft into this editor and hit "Submit for review" so admins can do the final pass.</div>
          </div>
        </div>
      </div>

      <label class="drive-gate-confirm">
        <input type="checkbox" id="drive-gate-cb">
        <span>Got it — my story is already reviewed on Google Drive</span>
      </label>
    `;

    const skipBtn = el("button", { class: "btn btn-secondary" }, "I'll do that first");
    const continueBtn = el("button", { class: "btn btn-accent" }, "Continue writing here");
    continueBtn.disabled = true;

    const m = openModal({ title: "Before you start writing", body, footer: [skipBtn, continueBtn] });

    const cb = body.querySelector("#drive-gate-cb");
    cb.addEventListener("change", () => {
      continueBtn.disabled = !cb.checked;
    });

    skipBtn.onclick = () => { m.close(); resolve(false); };
    continueBtn.onclick = () => { m.close(); resolve(true); };
  });
}

function ensureDriveGateStyles() {
  if (document.getElementById("drive-gate-styles")) return;
  const s = document.createElement("style");
  s.id = "drive-gate-styles";
  s.textContent = `
    .drive-gate-steps {
      display:flex; flex-direction:column; gap:10px;
      margin:0 0 16px 0;
    }
    .drive-gate-step {
      display:flex; gap:12px; align-items:flex-start;
      padding:12px 14px; background:#f8fafc; border:1px solid #e5e7eb;
      border-radius:10px;
    }
    .drive-gate-step-num {
      flex-shrink:0; width:24px; height:24px; border-radius:50%;
      background:#0f172a; color:#fff;
      display:flex; align-items:center; justify-content:center;
      font-size:12px; font-weight:700;
    }
    .drive-gate-step-body { flex:1; min-width:0; }
    .drive-gate-step-title {
      font-size:13.5px; font-weight:600; color:#0f172a;
      margin-bottom:3px; line-height:1.4;
    }
    .drive-gate-step-text {
      font-size:13px; color:#475569; line-height:1.5;
    }
    .drive-gate-confirm {
      display:flex; align-items:flex-start; gap:10px;
      padding:12px 14px; background:#fefce8; border:1px solid #fde047;
      border-radius:10px; cursor:pointer; user-select:none;
      font-size:13.5px; font-weight:600; color:#713f12; line-height:1.45;
    }
    .drive-gate-confirm input[type=checkbox] {
      margin-top:2px; width:16px; height:16px; flex-shrink:0;
      accent-color:var(--ink,#0f172a); cursor:pointer;
    }
  `;
  document.head.appendChild(s);
}

async function saveStory(ctx, wrap, desiredStatus, editingId) {
  const title = (wrap.querySelector("#f-title").textContent || "").trim();
  const category = wrap.querySelector("#f-category").value;
  const tags = Array.from(wrap.querySelectorAll(".f-topic-chip.is-on"))
    .map((c) => c.dataset.topic)
    .filter(Boolean);
  const coverImage = wrap.querySelector("#f-cover").value.trim();
  const lightCover = !!wrap.querySelector("#f-cover-light")?.checked;
  const dek = (wrap.querySelector("#f-dek").textContent || "").trim();
  const bodyEl = wrap.querySelector("#f-body");
  const msg = wrap.querySelector("#form-msg");

  // Firestore rejects documents over 1 MB. An inline base64 image can easily
  // be 1–5 MB on its own, so if a paste/upload leaves any data: URIs in the
  // body we must ship them to Storage before writing the doc.
  try {
    await uploadInlineDataImages(bodyEl, ctx, (done, total) => {
      msg.textContent = `Uploading ${done}/${total} embedded image${total === 1 ? "" : "s"}…`;
    });
    msg.textContent = "";
  } catch (err) {
    msg.textContent = "Could not upload embedded images: " + (err?.message || err);
    ctx.toast("Couldn't upload embedded images. " + (err?.message || err), "error");
    return;
  }

  // Wrap any stray <img> in a figure and re-apply contenteditable="false" /
  // data-rt-figure on every figure, so the persisted HTML is clickable when
  // the draft is reopened. Strip any width/height attrs a paste left behind
  // so the saved HTML also renders cleanly on the public article page.
  stripInlineImgDimensions(bodyEl);
  upgradeLegacyImages(bodyEl);
  normalizeEditorFigures(bodyEl);

  // Strip any live suggestion marks before persisting — they're rendered on top, not saved.
  const body = bodyEl.innerHTML.replace(/<mark class="sx-mark[^"]*"[^>]*>([\s\S]*?)<\/mark>/g, "$1");
  const bodyText = bodyEl.textContent || "";

  // Last-resort guard: if anything is still a data: URI (upload genuinely
  // failed) the body is going to be too large for Firestore. Fail early with
  // a readable error instead of the cryptic "too many bytes" from the SDK.
  if (/src="data:/i.test(body)) {
    const failedCount = (body.match(/src="data:/gi) || []).length;
    msg.textContent = `Save blocked: ${failedCount} image${failedCount === 1 ? "" : "s"} couldn't upload to storage. Click each and use the editor's image tool to re-add them.`;
    ctx.toast("Can't save — some images are still inline. See the message above the toolbar.", "error");
    return;
  }
  if (body.length > 900_000) {
    msg.textContent = `Save blocked: body is ${(body.length/1024).toFixed(0)} KB — Firestore limits a single document to ~1 MB. Move some images into a follow-up draft, or contact an editor.`;
    ctx.toast("Article body is too large to save. Try splitting it.", "error");
    return;
  }

  // Collect the writer's self-review checklist state.
  const writerChecklist = {};
  document.querySelectorAll('#writer-checklist-body input[type="checkbox"]').forEach((cb) => {
    writerChecklist[cb.dataset.k] = cb.checked;
  });
  const checklistDone = WRITER_CHECKLIST.every((item) => writerChecklist[item.id]);

  if (!title) { msg.textContent = "Please add a title before saving."; return; }

  if (desiredStatus === "pending") {
    // Hard gate for "Submit for review": title, cover image, excerpt (dek),
    // body, and every item on the writer's checklist must be checked.
    const missing = [];
    if (!title) missing.push("a title");
    if (!coverImage) missing.push("a cover image");
    if (!dek) missing.push("an excerpt (the one-sentence deck under the headline)");
    if (!bodyText.trim()) missing.push("body text");
    if (missing.length) {
      msg.textContent = "Before submitting, please add " + missing.join(", ") + ".";
      ctx.toast("Can't submit yet — missing " + missing.join(", ") + ".", "error");
      return;
    }
    // Every image in the body needs alt text (accessibility + image SEO). The
    // insert dialog already requires it, but pasted images can slip through —
    // catch them here and point the writer at the offending image to describe it.
    const imgsMissingAlt = Array.from(bodyEl.querySelectorAll("img"))
      .filter((img) => !(img.getAttribute("alt") || "").trim());
    if (imgsMissingAlt.length) {
      const n = imgsMissingAlt.length;
      msg.textContent = `Before submitting, add alt text to ${n} image${n === 1 ? "" : "s"} — click the image, then describe what it shows. It helps accessibility and your article's SEO.`;
      ctx.toast(`${n} image${n === 1 ? " needs" : "s need"} alt text before you can submit.`, "error");
      // Scroll the first undescribed image into view and flash it.
      const first = imgsMissingAlt[0];
      const fig = first.closest("figure") || first;
      fig.scrollIntoView({ behavior: "smooth", block: "center" });
      fig.classList.add("flash-attention");
      setTimeout(() => fig.classList.remove("flash-attention"), 1600);
      return;
    }
    // Every picture is credited: it says where it came from (older images
    // that already carry a written credit are accepted as they are).
    const uncited = Array.from(bodyEl.querySelectorAll("figure.rt-figure, figure.rt-gallery"))
      .filter((f) => !f.dataset.srcType && !(f.querySelector(".fig-caption-credit")?.textContent || "").trim());
    if (uncited.length) {
      const n = uncited.length;
      msg.textContent = `Before submitting, say where ${n === 1 ? "1 picture is" : `${n} pictures are`} from: click ${n === 1 ? "it" : "each one"} and fill in "Where is this from?" so it gets a proper credit.`;
      ctx.toast(`${n} picture${n === 1 ? " needs" : "s need"} a source before you can submit.`, "error");
      const fig = uncited[0];
      fig.scrollIntoView({ behavior: "smooth", block: "center" });
      fig.classList.add("flash-attention");
      setTimeout(() => fig.classList.remove("flash-attention"), 1600);
      return;
    }
    // Admins bypass the checklist — they're expected to be self-editing and
    // often import or publish pieces that never went through a writer's review.
    if (!checklistDone && ctx.role !== "admin") {
      msg.textContent = "Before submitting, please complete every item on the pre-submission checklist.";
      ctx.toast("Complete the checklist to submit for review.", "error");
      // Flash the checklist card so the writer notices it.
      const card = document.getElementById("writer-checklist-body")?.closest(".card");
      if (card) {
        card.classList.add("flash-attention");
        card.scrollIntoView({ behavior: "smooth", block: "center" });
        setTimeout(() => card.classList.remove("flash-attention"), 1600);
      }
      return;
    }
  }

  const payload = {
    title, category, tags, coverImage, lightCover, dek, body,
    slug: slugify(title),
    writerChecklist,
    status: desiredStatus,
    updatedAt: new Date().toISOString(),
  };

  try {
    if (editingId) {
      // Don't stamp author fields on updates — the doc already has them, and
      // overwriting here would clobber bylines on admin-imported drafts when
      // the admin opens them to tweak a cover image or field.
      await updateDoc(doc(db, "stories", editingId), payload);
      ctx.toast(desiredStatus === "pending" ? "Submitted for review." : "Draft saved.", "success");
    } else {
      payload.authorId = ctx.user.uid;
      payload.authorName = ctx.profile.name || ctx.user.email;
      payload.createdAt = new Date().toISOString();
      const ref = await addDoc(collection(db, "stories"), payload);
      ctx.toast(desiredStatus === "pending" ? "Submitted for review." : "Draft saved.", "success");
      location.hash = `#/writer/draft?edit=${ref.id}`;
    }
    msg.textContent = "";
    wrap.dispatchEvent(new CustomEvent("story-saved"));
    return true;
  } catch (err) {
    msg.textContent = "Save failed: " + err.message;
    ctx.toast("Save failed: " + err.message, "error");
  }
}

function subscribeToSuggestions(ctx, storyId, wrap, panel) {
  const bodyEl = wrap.querySelector("#f-body");
  const q = query(collection(db, "stories", storyId, "suggestions"), orderBy("createdAt", "asc"));
  let lastKey = "";
  return onSnapshot(q, (snap) => {
    const items = [];
    snap.forEach((d) => items.push({ id: d.id, ...d.data() }));

    // Only re-paint the body when the set of suggestions actually changed,
    // to avoid losing the writer's caret on every snapshot echo.
    const key = items.map((s) => `${s.id}:${s.start}-${s.end}`).join("|");
    if (key !== lastKey) {
      lastKey = key;
      const cleanHtml = bodyEl.innerHTML.replace(/<mark class="sx-mark[^"]*"[^>]*>([\s\S]*?)<\/mark>/g, "$1");
      paintSuggestionMarks(bodyEl, cleanHtml, items);
    }

    const writerCtx = {
      ...ctx,
      onAccept: async (s) => {
        try {
          if (s.kind === "replace") {
            applyReplacement(bodyEl, s);
            await persistBody(storyId, bodyEl);
          }
          await deleteDoc(doc(db, "stories", storyId, "suggestions", s.id));
          ctx.toast("Applied.", "success");
        } catch (err) { ctx.toast("Could not apply: " + err.message, "error"); }
      },
      onReject: async (s) => {
        try {
          await deleteDoc(doc(db, "stories", storyId, "suggestions", s.id));
        } catch (err) { ctx.toast("Failed: " + err.message, "error"); }
      },
    };
    renderSuggestionsPanel(panel, items, writerCtx, "writer");
  });
}

// Replace the range [s.start, s.end) with s.replacementText in the editable body.
// Falls back to no-op if the text no longer matches (writer edited around it).
function applyReplacement(bodyEl, s) {
  // Strip any existing marks for cleanness before measuring offsets.
  bodyEl.querySelectorAll("mark.sx-mark").forEach((m) => {
    const parent = m.parentNode;
    while (m.firstChild) parent.insertBefore(m.firstChild, m);
    parent.removeChild(m);
  });
  bodyEl.normalize();

  const walker = document.createTreeWalker(bodyEl, NodeFilter.SHOW_TEXT, null);
  let count = 0;
  let startNode = null, startOffset = 0, endNode = null, endOffset = 0;
  while (walker.nextNode()) {
    const n = walker.currentNode;
    const len = n.nodeValue.length;
    if (!startNode && count + len >= s.start) {
      startNode = n;
      startOffset = s.start - count;
    }
    if (!endNode && count + len >= s.end) {
      endNode = n;
      endOffset = s.end - count;
      break;
    }
    count += len;
  }
  if (!startNode || !endNode) throw new Error("range not found in current text");

  const range = document.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);

  // Conflict check: has the text underneath drifted?
  if (range.toString() !== (s.originalText || "")) {
    throw new Error("text has changed since the suggestion was made");
  }
  range.deleteContents();
  if (s.replacementText) {
    range.insertNode(document.createTextNode(s.replacementText));
  }
}

async function persistBody(storyId, bodyEl) {
  await updateDoc(doc(db, "stories", storyId), {
    body: bodyEl.innerHTML,
    updatedAt: new Date().toISOString(),
  });
}

function subscribeToComments(storyId, mount) {
  const q = query(collection(db, "stories", storyId, "comments"), orderBy("createdAt", "desc"));
  return onSnapshot(q, (snap) => {
    if (snap.empty) {
      mount.innerHTML = `<div class="empty-state">No editor feedback yet.</div>`;
      return;
    }
    mount.innerHTML = "";
    snap.forEach((d) => {
      const c = d.data();
      mount.appendChild(el("div", { class: "comment" }, [
        el("div", { class: "comment-head" }, [
          el("span", { class: "comment-author" }, c.authorName || "Editor"),
          el("span", {}, ` · ${fmtRelative(c.createdAt)}`),
          c.paragraph ? el("span", { style: { color: "var(--muted-2)" } }, ` · ¶${c.paragraph}`) : "",
        ]),
        el("div", { class: "comment-body" }, c.body || ""),
      ]));
    });
  });
}

// ===== My articles ==========================================================
async function mountMyArticles(ctx, container) {
  const card = el("div", { class: "card" });
  card.innerHTML = `
    <div class="card-header">
      <div>
        <div class="card-title">My articles</div>
        <div class="card-subtitle">Every piece you've written or are working on.</div>
      </div>
      <a class="btn btn-accent btn-sm" href="#/writer/draft">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        New draft
      </a>
    </div>
    <div class="card-body" id="my-list"><div class="loading-state"><div class="spinner"></div>Loading…</div></div>`;
  container.appendChild(card);

  try {
    const snap = await getDocs(query(
      collection(db, "stories"),
      where("authorId", "==", ctx.user.uid),
      orderBy("updatedAt", "desc"),
    ));
    renderArticleRows(card.querySelector("#my-list"), snap, true);
  } catch (err) {
    card.querySelector("#my-list").innerHTML = `<div class="error-state">${esc(err.message)}</div>`;
  }
}

// ===== Public-to-newsroom feed =============================================
async function mountFeed(ctx, container) {
  const card = el("div", { class: "card" });
  card.innerHTML = `
    <div class="card-header">
      <div>
        <div class="card-title">Articles in the works</div>
        <div class="card-subtitle">Everything the newsroom is working on — read-only across the team.</div>
      </div>
    </div>
    <div class="card-body" id="feed-list"><div class="loading-state"><div class="spinner"></div>Loading…</div></div>`;
  container.appendChild(card);

  try {
    // Show everything except rejected; order by most recently updated.
    const snap = await getDocs(query(
      collection(db, "stories"),
      orderBy("updatedAt", "desc"),
    ));
    renderArticleRows(card.querySelector("#feed-list"), snap, false);
  } catch (err) {
    card.querySelector("#feed-list").innerHTML = `<div class="error-state">${esc(err.message)}</div>`;
  }
}

function renderArticleRows(mount, snap, allowEdit) {
  if (snap.empty) {
    mount.innerHTML = `<div class="empty-state">Nothing here yet.</div>`;
    return;
  }
  // Book reviews live in the same `stories` collection but are tracked
  // separately under #/book-reviews — keep them out of the article views.
  const rows = [];
  snap.forEach((d) => {
    const a = d.data();
    if (a.category === "book-review") return;
    rows.push({ id: d.id, data: a });
  });
  if (!rows.length) {
    mount.innerHTML = `<div class="empty-state">Nothing here yet.</div>`;
    return;
  }
  mount.innerHTML = "";
  rows.forEach(({ id, data: a }) => {
    const row = el("div", { class: "article-row" });
    row.innerHTML = `
      <div>
        <div class="article-title">${esc(a.title || "Untitled")}</div>
        <div class="article-meta">
          by ${esc(a.authorName || a.author || "Unknown")} · ${fmtRelative(a.updatedAt)} · ${statusPill(a.status)}
          ${a.category ? ` · <span>${esc(a.category)}</span>` : ""}
        </div>
      </div>
      <div style="display:flex;gap:8px;align-items:center;">
        ${a.status === "approved"
          ? `<a class="btn btn-accent btn-xs" href="#/final-review?id=${esc(id)}" title="Review how the article will look and publish it">Review &amp; publish</a>` : ""}
        ${allowEdit ? `<a class="btn btn-secondary btn-xs" href="#/writer/draft?edit=${esc(id)}">Open</a>` : ""}
        ${a.status === "published" && a.url
          ? `<a class="btn btn-ghost btn-xs" href="${esc(a.url)}" target="_blank" rel="noopener">View</a>` : ""}
        ${allowEdit ? `<button class="btn btn-ghost btn-xs" data-action="delete" data-id="${esc(id)}" style="color:var(--danger);">Delete</button>` : ""}
      </div>`;
    mount.appendChild(row);
  });

  if (!allowEdit) return;
  mount.addEventListener("click", async (e) => {
    const btn = e.target.closest('[data-action="delete"]');
    if (!btn) return;
    const id = btn.dataset.id;
    const ok = await confirmDialog(
      "Delete this article? This cannot be undone.",
      { confirmText: "Delete", danger: true },
    );
    if (!ok) return;
    btn.disabled = true;
    try {
      await deleteDoc(doc(db, "stories", id));
      toast("Article deleted.", "success");
      // Remove the row without a full reload.
      btn.closest(".article-row")?.remove();
      if (!mount.querySelector(".article-row")) {
        mount.innerHTML = `<div class="empty-state">Nothing here yet.</div>`;
      }
    } catch (err) {
      btn.disabled = false;
      toast("Delete failed: " + err.message, "error");
    }
  });
}

function getHashParam(name) {
  const q = location.hash.split("?")[1];
  if (!q) return null;
  return new URLSearchParams(q).get(name);
}
