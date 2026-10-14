// About-page bios, from the Suite.
//
//   openBioEditor(ctx)  Everyone: their name (top right) → Update bio. Shows
//                       the bio that's on the site, or — for someone with no
//                       bio yet — what to write. Sending it creates
//                       bio_requests/{uid} via /api/bio/request, which tells
//                       the admins. The site doesn't change yet.
//   mount(ctx, el)      #/admin/bios — admins read each request next to the
//                       live bio, fix wording, and approve (/api/bio/review
//                       writes team_bios/{slug}, live at once) or send it back
//                       with a note.
//
// The live copy, team_bios/{slug}, is what js/about.js and the writer pages
// (functions/author/[slug].js) show.

import { db } from "../firebase-config.js";
import {
  collection, doc, getDoc, getDocs,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { el, esc, toast, fmtRelative, slugify, openModal } from "./ui.js";

const MIN = 120, MAX = 1400;

// Where someone new appears on the About page. Keep in sync with SECTIONS in
// functions/api/bio/review.js and rosterGroups in js/main.js.
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
  @media (max-width: 800px) { .bio-cols, .bio-place { grid-template-columns: minmax(0, 1fr); } .bio-req { padding: 16px 14px; border-radius: 16px; } }
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

// ── Admins: #/admin/bios ──────────────────────────────────────────────────
export async function mount(ctx, container) {
  injectStyle();
  container.innerHTML = "";
  const page = el("div", { class: "bio-page" });
  page.innerHTML = `
    <p class="bio-intro">When someone updates their bio in the Suite, it waits here. Read it next to what's on the site now, fix any wording, then approve it to put it live on the About page and their writer page, or send it back with a note.</p>
    <div id="bio-pending"><div class="loading-state"><div class="spinner"></div>Loading…</div></div>
    <div id="bio-history"></div>`;
  container.appendChild(page);

  let requests = [], bios = new Map(), users = new Map();
  const load = async () => {
    const [rq, tb, us] = await Promise.all([
      getDocs(collection(db, "bio_requests")),
      getDocs(collection(db, "team_bios")),
      getDocs(collection(db, "users")).catch(() => null),
    ]);
    requests = rq.docs.map((d) => ({ id: d.id, ...d.data() }));
    bios = new Map(tb.docs.map((d) => [d.id, d.data()]));
    users = new Map((us?.docs || []).map((d) => [d.id, d.data()]));
    render();
  };

  function render() {
    const pending = requests.filter((r) => r.status === "pending").sort((a, b) => String(a.submittedAt).localeCompare(String(b.submittedAt)));
    const done = requests.filter((r) => r.status === "approved" || r.status === "changes")
      .sort((a, b) => String(b.decidedAt || "").localeCompare(String(a.decidedAt || ""))).slice(0, 15);

    const box = page.querySelector("#bio-pending");
    box.innerHTML = `<h2 class="bio-h">Waiting for you ${pending.length ? `<span class="n">${pending.length}</span>` : ""}</h2>`;
    if (!pending.length) {
      box.insertAdjacentHTML("beforeend", `<div class="bio-empty">No bios waiting. When someone sends one, every admin gets a notification and an email.</div>`);
    }
    pending.forEach((r) => box.appendChild(requestCard(r)));

    page.querySelector("#bio-history").innerHTML = done.length ? `
      <h2 class="bio-h">Recently handled</h2>
      <ul class="bio-hist">${done.map((r) => `
        <li><span>${esc(r.name)}</span><span class="bio-pill is-${r.status}">${r.status === "approved" ? "Live" : "Sent back"}</span>
        <small>${r.status === "approved" ? "Approved" : "Sent back"} by ${esc(r.decidedByName || "an admin")} ${esc(fmtRelative(r.decidedAt))}${r.note ? ` · “${esc(r.note.slice(0, 120))}${r.note.length > 120 ? "…" : ""}”` : ""}</small></li>`).join("")}
      </ul>` : "";
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
    page.querySelector("#bio-pending").innerHTML = `<div class="error-state">Couldn't load bio requests: ${esc(e?.message || e)}</div>`;
  }
}
