// About-page bios, from the Suite.
//
//   openBioEditor(ctx)  Everyone: their name (top right) → Update bio. Shows
//                       the bio that's on the site, or — for someone with no
//                       bio yet — what to write. Sending it creates
//                       bio_requests/{uid} via /api/bio/request, which tells
//                       the admins. The site doesn't change yet.
//   mount(ctx, el)      #/admin/bios (Team bios) — every entry on the About
//                       page, hidden ones, and staff without a bio. Admins
//                       edit anyone's bio, title, photo, sections and
//                       visibility (/api/bio/manage, live at once), and
//                       approve or send back requests (/api/bio/review).
//
// The live copy, team_bios/{slug}, is what js/about.js and the writer pages
// (functions/author/[slug].js) show.

import { db } from "../firebase-config.js";
import {
  collection, doc, getDoc, getDocs,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { el, esc, toast, fmtRelative, slugify, openModal } from "./ui.js";

const MIN = 120, MAX = 1400;

// About page sections, in page order. Keep in sync with SECTIONS in
// functions/api/bio/review.js + manage.js and rosterGroups in js/main.js.
const SECTIONS = [
  { id: "eboard", label: "Executive Board" },
  { id: "staff:Editing", label: "Staff · Editing" },
  { id: "staff:Social Media", label: "Staff · Social Media" },
  { id: "undergraduate-fellows", label: "Undergraduate Fellowship" },
  { id: "graduate-fellows", label: "Graduate Fellowship" },
  { id: "alumni", label: "Alumni" },
];
const DEFAULT_FOR_ROLE = {
  admin: { role: "", section: "eboard" },
  editor: { role: "Editor", section: "staff:Editing" },
  social_media: { role: "Social Media", section: "staff:Social Media" },
  marketing: { role: "Marketing", section: "staff:Social Media" },
  newsletter_builder: { role: "Newsletter", section: "staff:Editing" },
  writer: { role: "Undergraduate Fellow", section: "undergraduate-fellows" },
};

const GUIDE = `
  <p class="bio-guide-lead">A good bio is 3 to 5 sentences (about 60 to 120 words), in the third person, using your first name. Cover:</p>
  <ol class="bio-guide-list">
    <li><b>Where you are now.</b> Your school and year, or your job, plus your degree, major and minor.</li>
    <li><b>What draws you to science.</b> The question, subject or moment that got you interested.</li>
    <li><b>One or two highlights.</b> A lab, internship, research project or award, said plainly.</li>
    <li><b>Why The Catalyst.</b> What you want readers to get from your work.</li>
    <li><b>What's next</b> (optional). Medical school, a PhD, a career you're aiming for.</li>
  </ol>
  <p class="bio-guide-eg"><span>Example</span>Jordan is a junior at Georgetown University studying Biology of Global Health with a minor in Journalism. After two summers in an immunology lab at the NIH, Jordan became interested in how research reaches the public, and how often it doesn't. At The Catalyst, Jordan writes about infectious disease and the people working on it across D.C. After graduating, Jordan hopes to pursue an MD/MPH.</p>`;

const STYLE = `
  .bio-ed { display: grid; gap: 14px; }
  .bio-banner { display: grid; gap: 4px; padding: 12px 14px; border-radius: 12px; font-size: 13.5px; line-height: 1.5; background: var(--surface-3); color: var(--ink-2); }
  .bio-banner b { color: var(--ink); font-weight: 600; }
  .bio-banner.is-wait { background: var(--info-soft); color: #23466b; }
  .bio-banner.is-changes { background: var(--warn-soft); color: #6b450d; }
  .bio-banner.is-done { background: var(--good-soft); color: #25553e; }
  .bio-banner q { font-style: italic; white-space: pre-wrap; }
  .bio-guide { border: 1px solid var(--hairline); border-radius: 14px; background: var(--surface); }
  .bio-guide > summary { display: flex; align-items: center; gap: 8px; min-height: 44px; padding: 0 14px; cursor: pointer; font: 600 13.5px var(--font); color: var(--ink); list-style: none; }
  .bio-guide > summary::-webkit-details-marker { display: none; }
  .bio-guide > summary::after { content: ""; width: 7px; height: 7px; margin-left: auto; border-right: 1.6px solid currentColor; border-bottom: 1.6px solid currentColor; transform: rotate(45deg) translateY(-2px); transition: transform .2s; }
  .bio-guide[open] > summary::after { transform: rotate(-135deg) translateY(-2px); }
  .bio-guide > summary:focus-visible { outline: none; box-shadow: var(--focus); border-radius: 14px; }
  .bio-guide-body { padding: 0 16px 14px; font-size: 13.5px; line-height: 1.55; color: var(--ink-2); }
  .bio-guide-lead { margin: 0 0 8px; }
  .bio-guide-list { margin: 0 0 12px; padding-left: 20px; display: grid; gap: 5px; }
  .bio-guide-list b { color: var(--ink); font-weight: 600; }
  .bio-guide-eg { margin: 0; padding: 10px 12px; border-left: 2px solid var(--ink); background: var(--surface-3); border-radius: 0 10px 10px 0; font-family: var(--serif); font-size: 14.5px; }
  .bio-guide-eg span { display: block; margin-bottom: 3px; font: 600 10.5px/1.3 var(--font); letter-spacing: .14em; text-transform: uppercase; color: var(--muted); }
  .bio-label { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin: 0 0 6px; font: 600 13px var(--font); color: var(--ink); }
  .bio-count { font: 500 12px var(--font); color: var(--muted); font-variant-numeric: tabular-nums; }
  .bio-count.is-low, .bio-count.is-high { color: var(--warn); }
  textarea.bio-text, .bio-req textarea.bio-text { display: block; width: 100%; min-height: 220px; padding: 12px 14px; border: 1px solid var(--hairline); border-radius: 12px; background: var(--surface); font: 400 15.5px/1.6 var(--serif); color: var(--ink); resize: vertical; box-sizing: border-box; }
  .bio-text:focus { outline: none; border-color: var(--ink); box-shadow: var(--focus); }
  .bio-foot { margin: 0; font-size: 12.5px; line-height: 1.5; color: var(--muted); }
  .bio-foot a { color: var(--ink); }
  .bio-err { margin: 0; min-height: 18px; font-size: 13px; color: var(--danger); }

  /* review page */
  .bio-page { max-width: 1120px; }
  .bio-intro { margin: 0 0 22px; max-width: 680px; font-size: 14.5px; line-height: 1.55; color: var(--ink-2); }
  .bio-h { display: flex; align-items: baseline; gap: 10px; margin: 26px 0 12px; font: 600 17px/1.3 var(--font); letter-spacing: -.015em; color: var(--ink); }
  .bio-h .n { min-width: 24px; padding: 2px 8px; border-radius: 999px; background: var(--ink); color: var(--surface); font: 600 12px/1.5 var(--font); text-align: center; }
  .bio-req { padding: 20px 22px; border: 1px solid var(--hairline-2); border-radius: 20px; background: var(--surface); box-shadow: var(--shadow-sm); }
  .bio-req + .bio-req { margin-top: 16px; }
  .bio-req-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 12px; margin-bottom: 14px; }
  .bio-req-head h3 { margin: 0; font: 600 18px/1.3 var(--font); letter-spacing: -.015em; color: var(--ink); }
  .bio-req-meta { font-size: 13px; color: var(--muted); }
  .bio-tag { padding: 2px 9px; border-radius: 999px; font: 600 11.5px/1.5 var(--font); background: var(--info-soft); color: #23466b; }
  .bio-cols { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; }
  .bio-col-label { margin: 0 0 6px; font: 600 11.5px/1.3 var(--font); letter-spacing: .12em; text-transform: uppercase; color: var(--muted); }
  .bio-live { margin: 0; padding: 12px 14px; border-radius: 12px; background: var(--surface-3); font: 400 15px/1.6 var(--serif); color: var(--ink-2); white-space: pre-wrap; }
  .bio-live.is-empty { font: 400 13.5px/1.5 var(--font); color: var(--muted); }
  .bio-req .bio-text { min-height: 200px; }
  .bio-place { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px; margin-top: 14px; }
  .bio-field { display: grid; gap: 5px; font: 600 13px var(--font); color: var(--ink); }
  .bio-field input, .bio-field select, .bio-field textarea { min-height: 44px; padding: 8px 12px; border: 1px solid var(--hairline); border-radius: 10px; background: var(--surface); font: 400 14px var(--font); color: var(--ink); box-sizing: border-box; width: 100%; }
  .bio-field textarea { min-height: 64px; resize: vertical; line-height: 1.5; }
  .bio-field input:focus, .bio-field select:focus, .bio-field textarea:focus { outline: none; border-color: var(--ink); box-shadow: var(--focus); }
  .bio-field small { font: 400 12px/1.4 var(--font); color: var(--muted); }
  .bio-note { margin-top: 12px; }
  .bio-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; align-items: center; gap: 10px; margin-top: 14px; }
  .bio-actions .bio-err { margin-right: auto; }
  .bio-actions .btn { min-height: 44px; }
  .bio-hist { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--hairline-2); }
  .bio-hist li { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px 12px; padding: 12px 4px; border-bottom: 1px solid var(--hairline-2); font-size: 14px; color: var(--ink); }
  .bio-hist small { grid-column: 1 / -1; font-size: 12.5px; color: var(--muted); }
  .bio-pill { padding: 2px 9px; border-radius: 999px; font: 600 11.5px/1.5 var(--font); white-space: nowrap; background: var(--surface-3); color: var(--ink-2); }
  .bio-pill.is-approved { background: var(--good-soft); color: var(--good); }
  .bio-pill.is-changes { background: var(--warn-soft); color: var(--warn); }
  .bio-empty { display: flex; align-items: center; gap: 12px; padding: 18px 20px; border: 1px dashed var(--hairline); border-radius: 16px; font-size: 14.5px; color: var(--ink-2); }

  /* team list */
  .bio-top { margin-bottom: 8px; }
  .bio-tools { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
  .bio-tools .btn { min-height: 44px; }
  .bio-search { position: relative; flex: 1 1 260px; max-width: 360px; }
  .bio-search svg { position: absolute; left: 14px; top: 50%; transform: translateY(-50%); color: var(--muted); pointer-events: none; }
  .bio-search input { width: 100%; min-height: 44px; padding: 0 14px 0 40px; border: 1px solid var(--hairline); border-radius: 999px; background: var(--surface); font: 400 14px var(--font); color: var(--ink); box-sizing: border-box; }
  .bio-search input:focus { outline: none; border-color: var(--ink); box-shadow: var(--focus); }
  .bio-stats { margin: 14px 0 0; font-size: 13.5px; color: var(--muted); }
  .bio-stats b { color: var(--ink); font-weight: 600; font-variant-numeric: tabular-nums; }
  .bio-group { margin-top: 18px; }
  .bio-group h3 { display: flex; align-items: baseline; gap: 8px; margin: 0 0 4px; font: 600 12px/1.3 var(--font); letter-spacing: .12em; text-transform: uppercase; color: var(--muted); }
  .bio-group h3 span { font-weight: 500; letter-spacing: 0; color: var(--muted-2); }
  .bio-group-note { margin: 0 0 6px; font-size: 13px; line-height: 1.5; color: var(--muted); }
  .bio-group.is-hidden .bio-row { opacity: .72; }
  .bio-list { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--hairline-2); }
  .bio-list li { border-bottom: 1px solid var(--hairline-2); }
  .bio-row { display: grid; grid-template-columns: 48px minmax(160px, 260px) minmax(0, 1fr) auto; align-items: center; gap: 16px; width: 100%; min-height: 72px; padding: 10px 8px; border: 0; border-radius: 12px; background: none; text-align: left; font: inherit; color: var(--ink); cursor: pointer; }
  .bio-row:hover { background: var(--surface-3); }
  .bio-row:focus-visible { outline: none; box-shadow: var(--focus); }
  .bio-row-main { display: grid; gap: 2px; min-width: 0; }
  .bio-row-name { font: 600 14.5px/1.35 var(--font); }
  .bio-row-name .bio-tag { margin-left: 4px; vertical-align: 1px; }
  .bio-row-role { font-size: 12.5px; line-height: 1.4; color: var(--muted); }
  .bio-row-bio { font: 400 14px/1.5 var(--serif); color: var(--ink-2); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .bio-row-bio i { font-family: var(--font); font-size: 13px; color: var(--muted); }
  .bio-row-edit { padding: 7px 14px; border: 1px solid var(--hairline); border-radius: 999px; font: 600 12.5px var(--font); color: var(--ink); white-space: nowrap; }
  .bio-row:hover .bio-row-edit { background: var(--ink); border-color: var(--ink); color: var(--surface); }
  .bio-ph, .bio-ph-lg { display: grid; place-items: center; overflow: hidden; border-radius: 50%; background: var(--paper-3); color: var(--ink-2); font: 600 15px var(--font); }
  .bio-ph { width: 48px; height: 48px; }
  .bio-ph-lg { width: 100%; aspect-ratio: 1; border-radius: 20px; font-size: 44px; letter-spacing: .02em; }
  .bio-ph:has(img), .bio-ph-lg:has(img) { background: none; border-radius: 0; }
  .bio-ph img, .bio-ph-lg img { width: 100%; height: 100%; object-fit: contain; display: block; }

  /* entry editor */
  .bio-edit { display: grid; gap: 14px; }
  .bio-edit-grid { display: grid; grid-template-columns: 230px minmax(0, 1fr); gap: 24px; align-items: start; }
  .bio-edit-side { display: grid; gap: 10px; }
  .bio-edit-photo-btns { display: flex; flex-wrap: wrap; gap: 8px; }
  .bio-edit-photo-btns .btn { min-height: 40px; }
  .bio-upload { cursor: pointer; }
  .bio-upload:focus-within { box-shadow: var(--focus); }
  .bio-hint { margin: 0; font-size: 12.5px; line-height: 1.45; color: var(--muted); }
  .bio-switch { position: relative; display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 10px; align-items: start; margin-top: 6px; padding: 12px; border: 1px solid var(--hairline); border-radius: 14px; cursor: pointer; }
  .bio-switch input { position: absolute; opacity: 0; width: 1px; height: 1px; }
  .bio-switch-track { position: relative; width: 40px; height: 24px; border-radius: 999px; background: var(--paper-3); transition: background .2s; }
  .bio-switch-track::after { content: ""; position: absolute; top: 3px; left: 3px; width: 18px; height: 18px; border-radius: 50%; background: var(--surface); box-shadow: 0 1px 2px rgba(15,23,42,.25); transition: transform .2s; }
  .bio-switch input:checked + .bio-switch-track { background: var(--ink); }
  .bio-switch input:checked + .bio-switch-track::after { transform: translateX(16px); }
  .bio-switch input:focus-visible + .bio-switch-track { box-shadow: var(--focus); }
  .bio-switch b { display: block; font: 600 13px/1.35 var(--font); color: var(--ink); }
  .bio-switch small { display: block; margin-top: 2px; font-size: 12px; line-height: 1.4; color: var(--muted); }
  .bio-edit-main { display: grid; gap: 14px; min-width: 0; }
  .bio-field input[readonly] { background: var(--surface-3); color: var(--ink-2); }
  .bio-secs { display: flex; flex-wrap: wrap; gap: 8px; margin: 0; padding: 0; border: 0; min-width: 0; }
  .bio-secs legend { width: 100%; margin-bottom: 6px; padding: 0; font: 600 13px var(--font); color: var(--ink); }
  .bio-secs legend small { margin-left: 6px; font: 400 12px var(--font); color: var(--muted); }
  .bio-chip { position: relative; cursor: pointer; }
  .bio-chip input { position: absolute; opacity: 0; width: 1px; height: 1px; }
  .bio-chip span { display: inline-flex; align-items: center; min-height: 40px; padding: 0 14px; border: 1px solid var(--hairline); border-radius: 999px; font: 500 13px var(--font); color: var(--ink-2); background: var(--surface); transition: background .15s, color .15s, border-color .15s; }
  .bio-chip input:checked + span { background: var(--ink); border-color: var(--ink); color: var(--surface); }
  .bio-chip input:focus-visible + span { box-shadow: var(--focus); }
  .bio-edit textarea.bio-text { min-height: 240px; }

  @media (max-width: 900px) { .bio-row { grid-template-columns: 48px minmax(0, 1fr) auto; } .bio-row-bio { display: none; } }
  @media (max-width: 800px) { .bio-cols, .bio-place, .bio-edit-grid { grid-template-columns: minmax(0, 1fr); } .bio-req { padding: 16px 14px; border-radius: 16px; } .bio-edit-side { grid-template-columns: 120px minmax(0, 1fr); align-items: center; } .bio-edit-side .bio-switch { grid-column: 1 / -1; } }
  @media (prefers-reduced-motion: reduce) { .bio-switch-track, .bio-switch-track::after, .bio-chip span { transition: none; } }
`;

function injectStyle() {
  if (document.getElementById("bio-style")) return;
  const s = document.createElement("style");
  s.id = "bio-style";
  s.textContent = STYLE;
  document.head.appendChild(s);
}

const words = (t) => (String(t).trim().match(/\S+/g) || []).length;

function wireCounter(textarea, countEl) {
  const paint = () => {
    const n = textarea.value.trim().length, w = words(textarea.value);
    countEl.textContent = `${w} ${w === 1 ? "word" : "words"}${n < MIN ? ` · ${MIN - n} more characters needed` : n > MAX ? ` · ${n - MAX} characters over` : ""}`;
    countEl.classList.toggle("is-low", n < MIN);
    countEl.classList.toggle("is-high", n > MAX);
  };
  textarea.addEventListener("input", paint);
  paint();
}

// ── Everyone: Update bio ──────────────────────────────────────────────────
export async function openBioEditor(ctx) {
  injectStyle();
  const uid = ctx.user?.uid;
  const name = ctx.profile?.name || "";
  const slug = slugify(name);
  if (!uid) return;
  if (!name) { toast("Your account has no name yet. Ask an admin to add it in Users & roles.", "error"); return; }

  const [liveSnap, reqSnap] = await Promise.all([
    getDoc(doc(db, "team_bios", slug)).catch(() => null),
    getDoc(doc(db, "bio_requests", uid)).catch(() => null),
  ]);
  const live = liveSnap?.exists() ? liveSnap.data() : null;
  const req = reqSnap?.exists() ? reqSnap.data() : null;
  const pending = req?.status === "pending";
  const changes = req?.status === "changes";
  const first = !live?.bio;

  const body = el("div", { class: "bio-ed" });
  let banner = "";
  if (pending) {
    banner = `<div class="bio-banner is-wait"><b>Waiting for an admin to approve it</b><span>You sent this ${esc(fmtRelative(req.submittedAt))}. Your ${first ? "bio goes up" : "current bio stays on the site"} once it's approved. You can still change it below.</span></div>`;
  } else if (changes) {
    banner = `<div class="bio-banner is-changes"><b>${esc(req.decidedByName || "An admin")} asked for a few changes</b>${req.note ? `<q>${esc(req.note)}</q>` : ""}<span>Edit it below and send it again.</span></div>`;
  } else if (req?.status === "approved" && req.decidedAt && Date.now() - new Date(req.decidedAt).getTime() < 7 * 864e5) {
    banner = `<div class="bio-banner is-done"><b>Your latest bio is live</b><span>Approved by ${esc(req.decidedByName || "an admin")} ${esc(fmtRelative(req.decidedAt))}.</span></div>`;
  } else if (first) {
    banner = `<div class="bio-banner"><b>You don't have a bio on the About page yet</b><span>Write one below. Once an admin approves it, it appears on the About page and on your writer page.</span></div>`;
  }

  const startText = pending || changes ? req.bio : (live?.bio || "");
  body.innerHTML = `
    ${banner}
    <details class="bio-guide"${first && !pending && !changes ? " open" : ""}>
      <summary>What to write</summary>
      <div class="bio-guide-body">${GUIDE}</div>
    </details>
    <div>
      <label class="bio-label" for="bio-text"><span>Your bio</span><span class="bio-count" id="bio-count" aria-live="polite"></span></label>
      <textarea class="bio-text" id="bio-text" maxlength="${MAX + 200}" placeholder="${esc(name.split(/\s+/)[0])} is a …"></textarea>
    </div>
    <p class="bio-foot">An admin reads every change before it goes live. Approved bios appear on the <a href="/about#team" target="_blank" rel="noopener">About page</a> and on your <a href="/author/${esc(slug)}" target="_blank" rel="noopener">writer page</a>.</p>
    <p class="bio-err" id="bio-err" role="alert"></p>`;
  const ta = body.querySelector("#bio-text");
  ta.value = startText;
  wireCounter(ta, body.querySelector("#bio-count"));
  const err = body.querySelector("#bio-err");

  const footer = [];
  const cancel = el("button", { type: "button", class: "btn btn-secondary" }, "Cancel");
  footer.push(cancel);
  let withdraw = null;
  if (pending) {
    withdraw = el("button", { type: "button", class: "btn btn-ghost" }, "Withdraw request");
    footer.unshift(withdraw);
  }
  const send = el("button", { type: "button", class: "btn btn-primary" }, pending ? "Update request" : "Send for approval");
  footer.push(send);

  const modal = openModal({ title: first && !pending ? "Write your bio" : "Update your bio", body, footer });
  if (!modal) return;
  setTimeout(() => ta.focus({ preventScroll: true }), 50);
  cancel.addEventListener("click", () => modal.close());

  const post = async (payload) => {
    const res = await ctx.authedFetch("/api/bio/request", { method: "POST", body: JSON.stringify(payload) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  };
  send.addEventListener("click", async () => {
    err.textContent = "";
    const text = ta.value.trim();
    if (text.length < MIN) { err.textContent = `Write a little more: at least ${MIN} characters (about two sentences).`; ta.focus(); return; }
    if (text.length > MAX) { err.textContent = `That's a bit long. Keep it under ${MAX} characters.`; ta.focus(); return; }
    if (!pending && live?.bio && text === live.bio.trim()) { err.textContent = "That's the bio already on the site. Change something first."; return; }
    send.disabled = true; send.textContent = "Sending…";
    try {
      await post({ bio: text });
      modal.close();
      toast("Sent. An admin will look at it, and you'll get an email when it's live.", "success", 5200);
    } catch (e) {
      err.textContent = e.message || "Couldn't send. Try again.";
      send.disabled = false; send.textContent = pending ? "Update request" : "Send for approval";
    }
  });
  withdraw?.addEventListener("click", async () => {
    withdraw.disabled = true;
    try {
      await post({ withdraw: true });
      modal.close();
      toast("Request withdrawn. Your bio on the site hasn't changed.", "success");
    } catch (e) {
      err.textContent = e.message || "Couldn't withdraw. Try again.";
      withdraw.disabled = false;
    }
  });
}

// ── Admins: #/admin/bios (Team bios) ──────────────────────────────────────
// Everyone on the About page, grouped the way the page is, plus anyone
// hidden and staff who have no bio yet. Admins edit any entry directly
// (/api/bio/manage, live at once): bio, title, photo, sections, shown or
// hidden. Requests people sent from their name menu wait at the top.
const STAFF_ROLES = ["admin", "editor", "writer", "newsletter_builder", "marketing", "social_media"];
const sectionLabel = (id) => SECTIONS.find((s) => s.id === id)?.label || id;
const sectionsOfBio = (b) => Array.isArray(b?.sections) ? b.sections : (b?.section ? [b.section] : []);
const initialsOf = (n) => String(n || "").split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
const photo = (b, size = "") => b?.image
  ? `<span class="bio-ph${size}"><img src="${esc(b.image)}" alt="" loading="lazy" decoding="async"></span>`
  : `<span class="bio-ph${size} is-initials" aria-hidden="true">${esc(initialsOf(b?.name))}</span>`;

// About-page portraits: a black-and-white photo inside the Catalyst hexagon
// frame (/beta/social/brand/hex-frame.png: dark rim, light band, white
// center), like /YairCatalyst.webp. framePortrait() does it for any upload:
// the photo goes black and white and is clipped to the frame's white center.
// Cut-out photos (transparent background) sit on white with the shoulders at
// the bottom edge; ordinary photos fill the center. A file that already has
// the dark rim (framed by hand) is used as it is.
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const url = typeof src === "string" ? src : URL.createObjectURL(src);
    const img = new Image();
    img.onload = () => { if (typeof src !== "string") URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { if (typeof src !== "string") URL.revokeObjectURL(url); reject(new Error("That file couldn't be read as an image.")); };
    img.src = url;
  });
}
const canvasOf = (w, h) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };

// The frame, measured once: its outline box, the white center's box, and a
// mask of the white center (soft at the edge where it meets the grey band).
let frameTpl = null;
async function frameTemplate() {
  if (frameTpl) return frameTpl;
  const img = await loadImage("/beta/social/brand/hex-frame.png?v=1");
  const W = img.naturalWidth, H = img.naturalHeight;
  const c = canvasOf(W, H), g = c.getContext("2d");
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, W, H).data;
  const mask = canvasOf(W, H), mg = mask.getContext("2d"), md = mg.createImageData(W, H);
  const box = () => ({ x0: Infinity, y0: Infinity, x1: -1, y1: -1 });
  const fb = box(), ib = box();
  const grow = (b, x, y) => { if (x < b.x0) b.x0 = x; if (x > b.x1) b.x1 = x; if (y < b.y0) b.y0 = y; if (y > b.y1) b.y1 = y; };
  for (let y = 0, i = 0; y < H; y++) {
    for (let x = 0; x < W; x++, i += 4) {
      const a = d[i + 3];
      if (a > 8) grow(fb, x, y);
      if (a > 200) {
        const m = Math.max(0, Math.min(1, (Math.min(d[i], d[i + 1], d[i + 2]) - 214) / 36));
        if (m > 0) { md.data[i + 3] = Math.round(m * 255); if (m > 0.5) grow(ib, x, y); }
      }
    }
  }
  mg.putImageData(md, 0, 0);
  const rect = (b) => ({ x: b.x0, y: b.y0, w: b.x1 - b.x0 + 1, h: b.y1 - b.y0 + 1 });
  frameTpl = { img, W, H, mask, frame: rect(fb), inner: rect(ib) };
  return frameTpl;
}

// Alpha at a point of an image (0–255), via a 1×1 draw.
function alphaAt(img, fx, fy) {
  const c = canvasOf(1, 1), g = c.getContext("2d");
  const sx = Math.min(img.naturalWidth - 2, Math.max(0, Math.round(img.naturalWidth * fx)));
  const sy = Math.min(img.naturalHeight - 2, Math.max(0, Math.round(img.naturalHeight * fy)));
  g.drawImage(img, sx, sy, 2, 2, 0, 0, 1, 1);
  const p = g.getImageData(0, 0, 1, 1).data;
  return { a: p[3], lum: 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2] };
}

// The part of an image that isn't transparent, in its own pixels (found on a
// small copy, so it's quick).
function opaqueBox(img) {
  const w = img.naturalWidth, h = img.naturalHeight, k = Math.min(1, 400 / Math.max(w, h));
  const sw = Math.max(1, Math.round(w * k)), sh = Math.max(1, Math.round(h * k));
  const c = canvasOf(sw, sh), g = c.getContext("2d");
  g.drawImage(img, 0, 0, sw, sh);
  const d = g.getImageData(0, 0, sw, sh).data;
  let x0 = sw, y0 = sh, x1 = -1, y1 = -1;
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) if (d[(y * sw + x) * 4 + 3] > 24) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return { x: 0, y: 0, w, h };
  return { x: x0 / k, y: y0 / k, w: Math.min(w, (x1 - x0 + 1) / k), h: Math.min(h, (y1 - y0 + 1) / k) };
}

export async function framePortrait(file) {
  const photo = await loadImage(file);
  const corner = alphaAt(photo, 0, 0), rim = alphaAt(photo, 0.5, 0.004);
  const alreadyFramed = corner.a < 16 && rim.a > 200 && rim.lum < 70;
  const F = await frameTemplate();
  const OW = 1200, OH = Math.round(OW * F.frame.h / F.frame.w);
  const out = canvasOf(OW, OH), og = out.getContext("2d");

  if (alreadyFramed) {
    const k = Math.min(OW / photo.naturalWidth, OH / photo.naturalHeight);
    og.drawImage(photo, (OW - photo.naturalWidth * k) / 2, (OH - photo.naturalHeight * k) / 2, photo.naturalWidth * k, photo.naturalHeight * k);
  } else {
    const ib = F.inner;
    const pc = canvasOf(F.W, F.H), pg = pc.getContext("2d");
    pg.fillStyle = "#ffffff";
    pg.fillRect(ib.x, ib.y, ib.w, ib.h);
    const pw = photo.naturalWidth, ph = photo.naturalHeight;
    const cutOut = corner.a < 16 && alphaAt(photo, 1, 0).a < 16;
    if (cutOut) {
      // a person on a transparent background: trim the empty margins, then
      // sit the shoulders on the bottom edge, about as big as the others
      const b = opaqueBox(photo);
      const k = Math.min((ib.w * 1.2) / b.w, (ib.h * 0.84) / b.h);   // shoulders may run past the sides, like the others
      pg.drawImage(photo, b.x, b.y, b.w, b.h, ib.x + (ib.w - b.w * k) / 2, ib.y + ib.h - b.h * k + 2, b.w * k, b.h * k);
    } else {
      // an ordinary photo fills the center, keeping the upper part (faces)
      const k = Math.max(ib.w / pw, ib.h / ph);
      pg.drawImage(photo, ib.x + (ib.w - pw * k) / 2, ib.y + (ib.h - ph * k) * 0.3, pw * k, ph * k);
    }
    // black and white (by hand, so it works in every browser)
    const px = pg.getImageData(ib.x, ib.y, ib.w, ib.h), d = px.data;
    for (let i = 0; i < d.length; i += 4) {
      const y = Math.max(0, Math.min(255, (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2] - 128) * 1.06 + 128));
      d[i] = d[i + 1] = d[i + 2] = y;
    }
    pg.putImageData(px, ib.x, ib.y);
    // keep only what's inside the white center
    pg.globalCompositeOperation = "destination-in";
    pg.drawImage(F.mask, 0, 0);
    const fr = F.frame;
    og.drawImage(F.img, fr.x, fr.y, fr.w, fr.h, 0, 0, OW, OH);
    og.drawImage(pc, fr.x, fr.y, fr.w, fr.h, 0, 0, OW, OH);
  }
  // WebP where the browser can make it (Safari falls back to PNG)
  const blob = await new Promise((resolve) => out.toBlob(resolve, "image/webp", 0.9));
  if (!blob) throw new Error("Couldn't prepare the photo.");
  return blob;
}

// Team photos go where the Suite already uploads story images (the admin's
// own folder), named by content hash so the same photo is stored once.
async function uploadPhoto(file, ctx) {
  const [{ storage }, { ref, uploadBytes, getDownloadURL }] = await Promise.all([
    import("../firebase-config.js"),
    import("https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js"),
  ]);
  const framed = await framePortrait(file);
  const ext = framed.type === "image/png" ? "png" : "webp";
  const digest = await crypto.subtle.digest("SHA-256", await framed.arrayBuffer());
  const hash = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
  const r = ref(storage, `stories/${ctx.user.uid}/images/${hash}.${ext}`);
  await uploadBytes(r, framed, { contentType: framed.type || "image/webp" });
  return getDownloadURL(r);
}

export async function mount(ctx, container) {
  injectStyle();
  container.innerHTML = "";
  const page = el("div", { class: "bio-page" });
  page.innerHTML = `
    <div class="bio-top">
      <p class="bio-intro">Everyone on the About page, as it appears there. Edit anyone's bio, title, photo and sections, or hide them. Your changes go live straight away. When someone sends their own bio from the Suite, it waits at the top for approval.</p>
      <div class="bio-tools">
        <label class="bio-search"><span class="sr-only">Find someone</span>
          <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
          <input type="search" id="bio-q" placeholder="Find someone" autocomplete="off">
        </label>
        <button type="button" class="btn btn-secondary" id="bio-add">Add someone</button>
        <a class="btn btn-ghost" href="/about#team" target="_blank" rel="noopener">View About page</a>
      </div>
      <p class="bio-stats" id="bio-stats"></p>
    </div>
    <div id="bio-pending"></div>
    <div id="bio-team"><div class="loading-state"><div class="spinner"></div>Loading…</div></div>
    <div id="bio-history"></div>`;
  container.appendChild(page);

  let requests = [], bios = new Map(), users = new Map();
  let q = "";
  const load = async () => {
    const [rq, tb, us] = await Promise.all([
      getDocs(collection(db, "bio_requests")),
      getDocs(collection(db, "team_bios")),
      getDocs(collection(db, "users")).catch(() => null),
    ]);
    requests = rq.docs.map((d) => ({ id: d.id, ...d.data() }));
    bios = new Map(tb.docs.map((d) => [d.id, { slug: d.id, ...d.data() }]));
    users = new Map((us?.docs || []).map((d) => [d.id, d.data()]));
    render();
  };

  page.querySelector("#bio-q").addEventListener("input", (e) => { q = e.target.value.trim().toLowerCase(); renderTeam(); });
  page.querySelector("#bio-add").addEventListener("click", () => openEntryEditor({ isNew: true }));

  function render() { renderPending(); renderTeam(); renderHistory(); }

  // ── waiting requests ──
  function renderPending() {
    const pending = requests.filter((r) => r.status === "pending").sort((a, b) => String(a.submittedAt).localeCompare(String(b.submittedAt)));
    const box = page.querySelector("#bio-pending");
    box.innerHTML = pending.length ? `<h2 class="bio-h">Waiting for approval <span class="n">${pending.length}</span></h2>` : "";
    pending.forEach((r) => box.appendChild(requestCard(r)));
  }

  // ── the team ──
  function staffWithoutBio() {
    const seen = new Set(bios.keys());
    const out = [];
    for (const [uid, u] of users) {
      const name = String(u.name || "").trim();
      const slug = slugify(name);
      if (!name || !slug || seen.has(slug) || !STAFF_ROLES.includes(u.role)) continue;
      seen.add(slug);
      out.push({ uid, name, slug, suiteRole: u.role });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  function renderTeam() {
    const all = [...bios.values()];
    const match = (b) => !q || String(b.name || "").toLowerCase().includes(q) || String(b.role || "").toLowerCase().includes(q);
    const shown = all.filter((b) => !b.hidden && sectionsOfBio(b).length);
    const hidden = all.filter((b) => b.hidden || !sectionsOfBio(b).length);
    const missing = staffWithoutBio();
    page.querySelector("#bio-stats").innerHTML = `<b>${shown.length}</b> on the About page · <b>${hidden.length}</b> hidden · <b>${missing.length}</b> staff without a bio`;

    const row = (b, section) => {
      const others = sectionsOfBio(b).filter((s) => s !== section);
      const pending = requests.some((r) => r.status === "pending" && r.slug === b.slug);
      return `
        <li><button type="button" class="bio-row" data-slug="${esc(b.slug)}">
          ${photo(b)}
          <span class="bio-row-main">
            <span class="bio-row-name">${esc(b.name)}${pending ? ` <span class="bio-tag">Sent a new bio</span>` : ""}</span>
            <span class="bio-row-role">${esc(b.role || "No title")}${others.length ? ` · also in ${others.map((s) => esc(sectionLabel(s))).join(", ")}` : ""}</span>
          </span>
          <span class="bio-row-bio">${b.bio ? esc(b.bio) : "<i>No bio yet</i>"}</span>
          <span class="bio-row-edit">Edit</span>
        </button></li>`;
    };
    const groups = SECTIONS.map((s) => {
      const people = shown.filter((b) => sectionsOfBio(b).includes(s.id) && match(b)).sort((a, b) => a.name.localeCompare(b.name));
      if (!people.length) return "";
      return `<section class="bio-group"><h3>${esc(s.label)} <span>${people.length}</span></h3><ul class="bio-list">${people.map((b) => row(b, s.id)).join("")}</ul></section>`;
    }).join("");
    const hid = hidden.filter(match).sort((a, b) => a.name.localeCompare(b.name));
    const miss = missing.filter((m) => !q || m.name.toLowerCase().includes(q));
    const box = page.querySelector("#bio-team");
    box.innerHTML = `
      <h2 class="bio-h">On the About page</h2>
      ${groups || `<div class="bio-empty">${q ? "No one on the About page matches that." : "No one is on the About page yet."}</div>`}
      ${hid.length ? `<section class="bio-group is-hidden"><h3>Hidden from the About page <span>${hid.length}</span></h3><p class="bio-group-note">Their entry is kept, so you can bring them back any time.</p><ul class="bio-list">${hid.map((b) => row(b, "")).join("")}</ul></section>` : ""}
      ${miss.length ? `<section class="bio-group"><h3>Staff without a bio <span>${miss.length}</span></h3><p class="bio-group-note">On the team in the Suite but not on the About page. Write a bio for them, or ask them to send one from their name menu.</p>
        <ul class="bio-list">${miss.map((m) => `<li><button type="button" class="bio-row" data-new-uid="${esc(m.uid)}">${photo(m)}<span class="bio-row-main"><span class="bio-row-name">${esc(m.name)}</span><span class="bio-row-role">${esc(m.suiteRole.replace("_", " "))} in the Suite</span></span><span class="bio-row-bio"><i>No bio yet</i></span><span class="bio-row-edit">Add</span></button></li>`).join("")}</ul></section>` : ""}`;
    box.querySelectorAll("[data-slug]").forEach((b) => b.addEventListener("click", () => openEntryEditor({ entry: bios.get(b.dataset.slug) })));
    box.querySelectorAll("[data-new-uid]").forEach((b) => b.addEventListener("click", () => {
      const m = missing.find((x) => x.uid === b.dataset.newUid);
      const def = DEFAULT_FOR_ROLE[m.suiteRole] || DEFAULT_FOR_ROLE.writer;
      openEntryEditor({ isNew: true, entry: { name: m.name, uid: m.uid, role: def.role, sections: [def.section], bio: "", image: "" } });
    }));
  }

  function renderHistory() {
    const done = requests.filter((r) => r.status === "approved" || r.status === "changes")
      .sort((a, b) => String(b.decidedAt || "").localeCompare(String(a.decidedAt || ""))).slice(0, 12);
    page.querySelector("#bio-history").innerHTML = done.length ? `
      <h2 class="bio-h">Recent requests</h2>
      <ul class="bio-hist">${done.map((r) => `
        <li><span>${esc(r.name)}</span><span class="bio-pill is-${r.status}">${r.status === "approved" ? "Approved" : "Sent back"}</span>
        <small>${r.status === "approved" ? "Approved" : "Sent back"} by ${esc(r.decidedByName || "an admin")} ${esc(fmtRelative(r.decidedAt))}${r.note ? ` · “${esc(r.note.slice(0, 120))}${r.note.length > 120 ? "…" : ""}”` : ""}</small></li>`).join("")}
      </ul>` : "";
  }

  // ── edit one entry (or add someone) ──
  function openEntryEditor({ entry = null, isNew = false }) {
    const e = entry || { name: "", role: "", sections: [], bio: "", image: "" };
    const secs = new Set(sectionsOfBio(e));
    let image = e.image || "";
    const pending = !isNew && requests.find((r) => r.status === "pending" && r.slug === e.slug);
    const body = el("div", { class: "bio-edit" });
    body.innerHTML = `
      ${pending ? `<div class="bio-banner is-wait"><b>${esc(e.name.split(/\s+/)[0])} sent a new bio that's waiting for approval</b><span>It's at the top of this page. Saving here doesn't touch their request.</span></div>` : ""}
      <div class="bio-edit-grid">
        <div class="bio-edit-side">
          <div class="bio-edit-photo" id="be-photo"></div>
          <div class="bio-edit-photo-btns">
            <label class="btn btn-secondary btn-sm bio-upload">Upload photo<input type="file" accept="image/*" id="be-file" hidden></label>
            <button type="button" class="btn btn-ghost btn-sm" id="be-remove">Remove</button>
          </div>
          <p class="bio-hint" id="be-photo-hint">Upload any photo: it's made black and white and put in the Catalyst hexagon automatically. A head-and-shoulders shot works best. Without one, their initials show.</p>
          <label class="bio-switch">
            <input type="checkbox" id="be-show" ${e.hidden ? "" : "checked"}>
            <span class="bio-switch-track" aria-hidden="true"></span>
            <span><b>Show on the About page</b><small>Turn off to hide them without losing their entry.</small></span>
          </label>
        </div>
        <div class="bio-edit-main">
          <label class="bio-field">Name
            <input type="text" id="be-name" value="${esc(e.name)}" ${isNew && !e.uid ? "" : "readonly"} placeholder="First and last name">
            ${isNew && !e.uid ? `<small>Use the name they publish under, so their articles link to their writer page.</small>` : ""}
          </label>
          <label class="bio-field">Title under their name
            <input type="text" id="be-role" value="${esc(e.role || "")}" placeholder="For example: Undergraduate Fellow">
          </label>
          <fieldset class="bio-secs">
            <legend>Sections of the About page <small>Pick one or more.</small></legend>
            ${SECTIONS.map((s) => `<label class="bio-chip"><input type="checkbox" value="${esc(s.id)}" ${secs.has(s.id) ? "checked" : ""}><span>${esc(s.label)}</span></label>`).join("")}
          </fieldset>
          <div>
            <label class="bio-label" for="be-bio"><span>Bio</span><span class="bio-count" id="be-count"></span></label>
            <textarea class="bio-text" id="be-bio" placeholder="${esc((e.name || "They").split(/\s+/)[0])} is a …"></textarea>
          </div>
          ${!isNew && e.updatedAt ? `<p class="bio-hint">Last changed ${esc(fmtRelative(e.updatedAt))}${e.approvedByName ? ` · ${esc(e.approvedByName)}` : ""}</p>` : ""}
        </div>
      </div>
      <p class="bio-err" id="be-err" role="alert"></p>`;
    const ta = body.querySelector("#be-bio");
    ta.value = e.bio || "";
    wireCounter(ta, body.querySelector("#be-count"));
    const err = body.querySelector("#be-err");
    const paintPhoto = () => {
      body.querySelector("#be-photo").innerHTML = photo({ name: body.querySelector("#be-name").value || e.name, image }, "-lg");
      body.querySelector("#be-remove").hidden = !image;
    };
    paintPhoto();
    body.querySelector("#be-name").addEventListener("input", () => { if (!image) paintPhoto(); });
    body.querySelector("#be-remove").addEventListener("click", () => { image = ""; paintPhoto(); });
    body.querySelector("#be-file").addEventListener("change", async (ev) => {
      const file = ev.target.files?.[0];
      ev.target.value = "";
      if (!file) return;
      if (!/^image\//.test(file.type)) { err.textContent = "Choose an image file (JPG, PNG or WebP)."; return; }
      if (file.size > 15 * 1024 * 1024) { err.textContent = "That photo is over 15 MB. Choose a smaller one."; return; }
      const hint = body.querySelector("#be-photo-hint");
      hint.textContent = "Framing and uploading…"; err.textContent = "";
      try {
        image = await uploadPhoto(file, ctx);
        paintPhoto();
        hint.textContent = "Uploaded. Save to put it on the About page.";
      } catch (x) {
        hint.textContent = "Upload any photo: it's made black and white and put in the Catalyst hexagon automatically.";
        err.textContent = `Couldn't upload the photo: ${x?.message || x}`;
      }
    });

    const cancel = el("button", { type: "button", class: "btn btn-secondary" }, "Cancel");
    const save = el("button", { type: "button", class: "btn btn-primary" }, isNew ? "Add to the About page" : "Save changes");
    const modal = openModal({ title: isNew ? (e.name ? `Add ${e.name} to the About page` : "Add someone to the About page") : `Edit ${e.name}`, body, footer: [cancel, save], size: "wide" });
    if (!modal) return;
    cancel.addEventListener("click", () => modal.close());
    save.addEventListener("click", async () => {
      err.textContent = "";
      const payload = {
        slug: isNew ? undefined : e.slug,
        uid: e.uid || undefined,
        name: body.querySelector("#be-name").value.trim(),
        role: body.querySelector("#be-role").value.trim(),
        sections: [...body.querySelectorAll(".bio-secs input:checked")].map((x) => x.value),
        hidden: !body.querySelector("#be-show").checked,
        bio: ta.value.trim(),
        image,
      };
      if (!payload.name) { err.textContent = "Give them a name."; return; }
      if (isNew && bios.has(slugify(payload.name))) { err.textContent = `${payload.name} is already on the list. Edit their entry instead.`; return; }
      if (!payload.hidden) {
        if (payload.bio.length < 40) { err.textContent = "Write a bio first, or turn off Show on the About page."; ta.focus(); return; }
        if (!payload.role) { err.textContent = "Give them a title, for example Writer."; return; }
        if (!payload.sections.length) { err.textContent = "Choose at least one section."; return; }
      }
      save.disabled = true; save.textContent = "Saving…";
      try {
        const res = await ctx.authedFetch("/api/bio/manage", { method: "POST", body: JSON.stringify(payload) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) throw new Error(data.error || `Request failed (${res.status})`);
        modal.close();
        toast(payload.hidden ? `${payload.name.split(/\s+/)[0]} is hidden from the About page.` : `Saved. ${payload.name.split(/\s+/)[0]}'s entry is live on the About page.`, "success");
        await load();
      } catch (x) {
        err.textContent = x.message || "Couldn't save. Try again.";
        save.disabled = false; save.textContent = isNew ? "Add to the About page" : "Save changes";
      }
    });
  }

  function requestCard(r) {
    const live = bios.get(r.slug);
    const isNew = !live;
    const u = users.get(r.uid) || {};
    const def = DEFAULT_FOR_ROLE[r.suiteRole || u.role] || DEFAULT_FOR_ROLE.writer;
    const card = el("article", { class: "bio-req" });
    card.innerHTML = `
      <header class="bio-req-head">
        <h3>${esc(r.name)}</h3>
        ${isNew ? `<span class="bio-tag">First bio</span>` : ""}
        <span class="bio-req-meta">Sent ${esc(fmtRelative(r.submittedAt))}${live?.role ? ` · ${esc(live.role)}` : ""}</span>
      </header>
      <div class="bio-cols">
        <div>
          <p class="bio-col-label">On the site now</p>
          ${live?.bio ? `<p class="bio-live">${esc(live.bio)}</p>` : `<p class="bio-live is-empty">Nothing yet. Approving adds ${esc(r.name.split(/\s+/)[0])} to the About page.</p>`}
        </div>
        <div>
          <label class="bio-col-label" for="bt-${esc(r.id)}">Proposed (you can edit it)</label>
          <textarea class="bio-text" id="bt-${esc(r.id)}"></textarea>
          <span class="bio-count" data-count></span>
        </div>
      </div>
      ${isNew ? `
      <div class="bio-place">
        <label class="bio-field">Title under their name
          <input type="text" data-role value="${esc(def.role)}" placeholder="For example: Undergraduate Fellow">
        </label>
        <label class="bio-field">Section of the About page
          <select data-section>${SECTIONS.map((s) => `<option value="${esc(s.id)}"${s.id === def.section ? " selected" : ""}>${esc(s.label)}</option>`).join("")}</select>
        </label>
      </div>` : ""}
      <label class="bio-field bio-note">Note to ${esc(r.name.split(/\s+/)[0])} <small>Optional when you approve. Needed if you send it back, so they know what to change.</small>
        <textarea data-note placeholder="For example: Could you add what you're studying?"></textarea>
      </label>
      <div class="bio-actions">
        <p class="bio-err" role="alert"></p>
        <button type="button" class="btn btn-secondary" data-act="reject">Send back</button>
        <button type="button" class="btn btn-primary" data-act="approve">Approve and publish</button>
      </div>`;
    const ta = card.querySelector("textarea.bio-text");
    ta.value = r.bio || "";
    wireCounter(ta, card.querySelector("[data-count]"));
    const err = card.querySelector(".bio-err");
    card.querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", async () => {
      err.textContent = "";
      const action = b.dataset.act;
      const note = card.querySelector("[data-note]").value.trim();
      if (action === "reject" && !note) { err.textContent = "Add a note so they know what to change."; card.querySelector("[data-note]").focus(); return; }
      const payload = { uid: r.uid || r.id, action, bio: ta.value.trim(), note };
      if (isNew) {
        payload.role = card.querySelector("[data-role]").value.trim();
        payload.section = card.querySelector("[data-section]").value;
        if (action === "approve" && !payload.role) { err.textContent = "Give them a title for the About page."; return; }
      }
      card.querySelectorAll("[data-act]").forEach((x) => { x.disabled = true; });
      b.textContent = action === "approve" ? "Publishing…" : "Sending…";
      try {
        const res = await ctx.authedFetch("/api/bio/review", { method: "POST", body: JSON.stringify(payload) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) throw new Error(data.error || `Request failed (${res.status})`);
        toast(action === "approve" ? `${r.name.split(/\s+/)[0]}'s bio is live.` : `Sent back to ${r.name.split(/\s+/)[0]}.`, "success");
        await load();
      } catch (e) {
        err.textContent = e.message || "Something went wrong. Try again.";
        card.querySelectorAll("[data-act]").forEach((x) => { x.disabled = false; });
        b.textContent = action === "approve" ? "Approve and publish" : "Send back";
      }
    }));
    return card;
  }

  try {
    await load();
  } catch (e) {
    page.querySelector("#bio-team").innerHTML = `<div class="error-state">Couldn't load the team: ${esc(e?.message || e)}</div>`;
  }
}
