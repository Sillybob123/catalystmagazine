// The Catalyst Contributor Agreement.
//
//   needsAgreement(profile, uid)  true only for a new account (created from
//                             NEW_ACCOUNTS_FROM on) that has never signed, and
//                             for anyone an admin sent it to since they last
//                             signed. A new version alone never re-shows it.
//   showAgreementGate(opts)   the full-screen agreement shown on sign-in
//                             (app.js, before the Suite loads). "I agree" works
//                             once they've scrolled to the end; it posts to
//                             /api/agreement/accept, which keeps the record.
//   mountAgreementTool(ctx)   Advanced tools → Contributor agreement: who has
//                             signed, their records, and "Ask to sign" (opens
//                             it on their next visit; no email).
//
// The text lives in /legal/contributor-agreement-<version>.html. A published
// version is never edited: copy it to a new dated file and bump
// AGREEMENT_VERSION here and CURRENT_VERSION in functions/api/agreement/accept.js.

import { db } from "../firebase-config.js";
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { el, esc, toast, fmtRelative } from "./ui.js";

export const AGREEMENT_VERSION = "2026-10-15c";
const DOC_URL = `/legal/contributor-agreement-${AGREEMENT_VERSION}`;

// Accounts created from this date on sign on their first visit; people who
// were already on staff sign when an admin asks them to (Advanced tools).
const NEW_ACCOUNTS_FROM = Date.parse("2026-10-15T00:00:00Z");
const timeOf = (v) => (v && typeof v.toDate === "function" ? v.toDate().getTime() : Date.parse(v || ""));

// It shows at most once: a new account on its first visit, and after that
// only when an admin sends it again (users.agreementRequestedAt newer than
// their last signature). Publishing a new version never re-shows it by
// itself. A copy of their signing time is kept in this browser too, so a
// slow save or a reload can't bring it back.
const localKey = (uid) => `catalyst.agreementSigned.${uid}`;
const localSigned = (uid) => { try { return timeOf(localStorage.getItem(localKey(uid))); } catch { return NaN; } };

export function needsAgreement(profile, uid) {
  if (!profile) return false;
  const times = [timeOf(profile.agreementAcceptedAt), uid ? localSigned(uid) : NaN].filter(Number.isFinite);
  const signedAt = times.length ? Math.max(...times) : NaN;
  const hasSigned = Number.isFinite(signedAt) || !!profile.agreementVersion;
  const asked = timeOf(profile.agreementRequestedAt);
  if (Number.isFinite(asked)) return !hasSigned || (Number.isFinite(signedAt) && asked > signedAt);   // an admin sent it
  if (hasSigned) return false;
  const created = timeOf(profile.createdAt);
  return Number.isFinite(created) && created >= NEW_ACCOUNTS_FROM;                                // a new account's first visit
}

const STYLE = `
  /* over the Suite: it shows through, dimmed and blurred, but can't be used until they agree */
  .ag-gate { position: fixed; inset: 0; z-index: 9999; display: grid; place-items: center; padding: 20px; background: rgba(15, 23, 42, .32); -webkit-backdrop-filter: blur(5px) saturate(.9); backdrop-filter: blur(5px) saturate(.9); overflow: auto; animation: ag-in .35s ease-out; }
  @keyframes ag-in { from { opacity: 0; } }
  .ag-card { animation: ag-card .45s cubic-bezier(.22,1,.36,1); }
  @keyframes ag-card { from { opacity: 0; transform: translateY(14px) scale(.985); } }
  @media (prefers-reduced-motion: reduce) { .ag-gate, .ag-card { animation: none; } }
  .ag-card { width: min(760px, 100%); display: grid; grid-template-rows: auto minmax(0, 1fr) auto; max-height: calc(100dvh - 40px); border: 1px solid var(--hairline, rgba(15,23,42,.11)); border-radius: 22px; background: var(--surface, #fdfcf9); box-shadow: var(--shadow-lg, 0 30px 60px -24px rgba(15,23,42,.32)); overflow: hidden; }
  .ag-head { padding: 24px 28px 16px; border-bottom: 1px solid var(--hairline-2, rgba(15,23,42,.07)); }
  .ag-head h1 { margin: 0; font: 600 21px/1.25 var(--font, Poppins, sans-serif); letter-spacing: -0.015em; color: var(--ink, #0f172a); }
  .ag-head p { margin: 6px 0 0; font-size: 13.5px; line-height: 1.5; color: var(--muted, #5b6678); }
  .ag-scroll { overflow-y: auto; padding: 18px 28px 26px; font: 400 12.5px/1.6 var(--serif, Georgia, serif); color: var(--ink-2, #334155); scroll-behavior: smooth; }
  .ag-scroll:focus-visible { outline: none; box-shadow: inset 0 0 0 3px rgba(15,23,42,.14); }
  .ag-scroll h1, .ag-scroll .meta { display: none; }
  .ag-scroll h2 { margin: 18px 0 4px; font: 600 12.5px/1.35 var(--font, Poppins, sans-serif); color: var(--ink, #0f172a); }
  .ag-scroll p, .ag-scroll ul { margin: 0 0 8px; }
  .ag-scroll ul { padding-left: 18px; }
  .ag-scroll .ag-summary { margin-bottom: 14px; padding: 12px 16px 6px; border-radius: 12px; background: var(--surface-3, #f1efe8); font-size: 13.5px; }
  .ag-scroll .ag-summary h2 { margin-top: 0; font-size: 13.5px; }
  .ag-foot { display: grid; gap: 10px; padding: 16px 28px 20px; border-top: 1px solid var(--hairline-2, rgba(15,23,42,.07)); }
  .ag-progress { height: 3px; border-radius: 99px; background: var(--surface-3, #f1efe8); overflow: hidden; }
  .ag-progress span { display: block; height: 100%; width: 0; background: var(--ink, #0f172a); transition: width .15s; }
  .ag-row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px 16px; }
  .ag-who { font-size: 13px; line-height: 1.45; color: var(--muted, #5b6678); }
  .ag-who b { color: var(--ink, #0f172a); font-weight: 600; }
  .ag-actions { display: flex; align-items: center; gap: 8px; }
  .ag-actions .btn { min-height: 44px; }
  .ag-agree[disabled] { opacity: .45; cursor: not-allowed; }
  .ag-err { margin: 0; min-height: 0; font-size: 13px; color: var(--danger, #a3322b); }
  .ag-link { font-size: 12.5px; color: var(--muted, #5b6678); }
  .ag-link a { color: var(--ink, #0f172a); }
  @media (max-width: 560px) { .ag-head, .ag-scroll, .ag-foot { padding-left: 18px; padding-right: 18px; } }
  @media (prefers-reduced-motion: reduce) { .ag-scroll { scroll-behavior: auto; } .ag-progress span { transition: none; } }

  /* Advanced tools pane */
  .agt-top { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
  .agt-top .btn { min-height: 40px; }
  .agt-stats { margin: 12px 0 0; font-size: 13.5px; color: var(--muted); }
  .agt-stats b { color: var(--ink); font-weight: 600; }
  .agt-list { list-style: none; margin: 14px 0 0; padding: 0; border-top: 1px solid var(--hairline-2); }
  .agt-list > li { border-bottom: 1px solid var(--hairline-2); }
  .agt-row { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr) auto; align-items: center; gap: 6px 16px; padding: 12px 4px; }
  .agt-name { font: 600 14px/1.35 var(--font); color: var(--ink); }
  .agt-name small { display: block; font: 400 12.5px var(--font); color: var(--muted); }
  .agt-status { font-size: 13px; line-height: 1.4; color: var(--ink-2); }
  .agt-pill { display: inline-block; margin-right: 6px; padding: 2px 9px; border-radius: 999px; font: 600 11.5px/1.5 var(--font); }
  .agt-pill.is-signed { background: var(--good-soft); color: var(--good); }
  .agt-pill.is-asked { background: var(--warn-soft); color: var(--warn); }
  .agt-pill.is-none { background: var(--surface-3); color: var(--ink-2); }
  .agt-acts { display: flex; gap: 6px; }
  .agt-acts .btn { min-height: 36px; }
  .agt-rec { margin: 0 4px 12px; padding: 10px 14px; border-radius: 10px; background: var(--surface-3); font: 400 12.5px/1.6 var(--font); color: var(--ink-2); display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 2px 14px; }
  .agt-rec dt { color: var(--muted); }
  .agt-rec dd { margin: 0; overflow-wrap: anywhere; }
  @media (max-width: 720px) { .agt-row { grid-template-columns: minmax(0, 1fr); } }
`;
function injectStyle() {
  if (document.getElementById("ag-style")) return;
  const s = document.createElement("style");
  s.id = "ag-style"; s.textContent = STYLE;
  document.head.appendChild(s);
}

async function agreementHtml() {
  const res = await fetch(`${DOC_URL}.html`, { cache: "no-cache" });
  if (!res.ok) throw new Error(`Couldn't load the agreement (${res.status}).`);
  const html = await res.text();
  const doc = new DOMParser().parseFromString(html, "text/html");
  const art = doc.getElementById("agreement");
  if (!art) throw new Error("The agreement file is missing its text.");
  return art.innerHTML;
}

// Posts the acceptance; retries a few times on a bad connection.
async function saveAcceptance(authedFetch) {
  let last;
  for (let i = 0; i < 4; i++) {
    try {
      const res = await authedFetch("/api/agreement/accept", { method: "POST", body: JSON.stringify({ version: AGREEMENT_VERSION }), keepalive: true });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) return data;
      last = new Error(data.error || `HTTP ${res.status}`);
      if (res.status >= 400 && res.status < 500) break;   // won't change on retry
    } catch (e) { last = e; }
    await new Promise((r) => setTimeout(r, 800 * (i + 1)));
  }
  throw last;
}

// ── The sign-in agreement ─────────────────────────────────────────────────
// Resolves once they've agreed. { user, profile, authedFetch, onSignOut }
export function showAgreementGate({ uid, profile, authedFetch, onSignOut }) {
  injectStyle();
  return new Promise((resolve) => {
    const gate = el("div", { class: "ag-gate", role: "dialog", "aria-modal": "true", "aria-labelledby": "ag-title" });
    const asked = !!profile?.agreementVersion;   // signed before: an admin asked them to review it again
    const wasAsked = !!profile?.agreementRequestedAt;   // already on staff, asked by an admin
    gate.innerHTML = `
      <div class="ag-card">
        <header class="ag-head">
          <h1 id="ag-title">${asked ? "Please review the Contributor Agreement again" : wasAsked ? "Please read the Contributor Agreement" : "Welcome to the Editorial Suite"}</h1>
          <p>Before you start, please read The Catalyst Contributor Agreement. Scroll to the end, then click I agree.</p>
        </header>
        <div class="ag-scroll" id="ag-scroll" tabindex="0" aria-label="Contributor Agreement"><p>Loading the agreement…</p></div>
        <footer class="ag-foot">
          <div class="ag-progress" aria-hidden="true"><span id="ag-bar"></span></div>
          <p class="ag-err" id="ag-err" role="alert"></p>
          <div class="ag-row">
            <div class="ag-who">Signing as <b>${esc(profile?.name || "")}</b>${profile?.email ? ` (${esc(profile.email)})` : ""}<br><span id="ag-hint">Scroll to the end of the agreement to continue.</span></div>
            <div class="ag-actions">
              <button type="button" class="btn btn-ghost" id="ag-out">Sign out</button>
              <button type="button" class="btn btn-primary ag-agree" id="ag-agree" disabled>I agree</button>
            </div>
          </div>
          <p class="ag-link">Version 3, October 15, 2026 · <a href="${DOC_URL}" target="_blank" rel="noopener">Open it in a new tab</a> · Questions? stemcatalystmagazine@gmail.com</p>
        </footer>
      </div>`;
    document.body.appendChild(gate);
    // The Suite behind can't be clicked, typed in or tabbed to until they agree.
    const behind = [...document.body.children].filter((c) => c !== gate && !c.hasAttribute("inert"));
    behind.forEach((c) => c.setAttribute("inert", ""));
    const release = () => behind.forEach((c) => c.removeAttribute("inert"));
    const scroller = gate.querySelector("#ag-scroll"), bar = gate.querySelector("#ag-bar"), agree = gate.querySelector("#ag-agree");
    const hint = gate.querySelector("#ag-hint");
    let reachedEnd = false;
    const check = () => {
      const max = scroller.scrollHeight - scroller.clientHeight;
      const pct = max <= 0 ? 1 : Math.min(1, scroller.scrollTop / max);
      bar.style.width = `${Math.round(pct * 100)}%`;
      if (!reachedEnd && (max <= 0 || scroller.scrollTop >= max - 24)) {
        reachedEnd = true;
        agree.disabled = false;
        hint.textContent = "By clicking I agree, you sign this agreement electronically.";
      }
    };
    scroller.addEventListener("scroll", check, { passive: true });
    // Get the server ready while they read, so saving is quick.
    authedFetch("/api/agreement/accept", { method: "POST", body: JSON.stringify({ warm: true }) }).catch(() => {});
    agreementHtml().then((html) => { scroller.innerHTML = html; scroller.scrollTop = 0; requestAnimationFrame(check); scroller.focus({ preventScroll: true }); })
      .catch((e) => { scroller.innerHTML = `<p>${esc(e.message)} Reload the page to try again.</p>`; });
    gate.querySelector("#ag-out").addEventListener("click", () => onSignOut && onSignOut());
    agree.addEventListener("click", () => {
      if (!reachedEnd) return;
      // Close at once; the record saves in the background (and retries).
      const signedAt = new Date().toISOString();
      try { if (uid) localStorage.setItem(localKey(uid), signedAt); } catch { /* private mode: the server record still counts */ }
      profile.agreementVersion = AGREEMENT_VERSION;
      profile.agreementAcceptedAt = signedAt;
      gate.remove();
      release();
      resolve();
      saveAcceptance(authedFetch).catch(() => {
        // Never saved: forget the local copy so it's asked again next time.
        try { if (uid) localStorage.removeItem(localKey(uid)); } catch {}
        toast("We couldn't save your agreement. It will open again next time you sign in.", "error", 7000);
      });
    });
  });
}

// ── Advanced tools → Contributor agreement ────────────────────────────────
export function mountAgreementTool(ctx, root, paneHeader) {
  injectStyle();
  root.innerHTML = `
    ${paneHeader("Contributor agreement", `New staff sign The Catalyst Contributor Agreement the first time they sign in; anyone already on staff sees it on their next visit after you ask them here (no email is sent). See who has signed, open each record (time, version, IP address), and ask people to sign. <a href="${DOC_URL}" target="_blank" rel="noopener">Read the agreement</a>`)}
    <div class="adv-pane-body">
      <div class="agt-top">
        <button type="button" class="btn btn-primary btn-sm" id="agt-ask-all">Ask everyone who hasn't signed</button>
        <button type="button" class="btn btn-secondary btn-sm" id="agt-csv">Download records (CSV)</button>
        <input class="input" id="agt-q" type="search" placeholder="Find someone" style="max-width:220px">
      </div>
      <p class="agt-stats" id="agt-stats">Loading…</p>
      <ul class="agt-list" id="agt-list"></ul>
    </div>`;
  let people = [], records = new Map(), q = "";

  const statusOf = (u) => {
    const rec = records.get(u.id);
    const asked = Date.parse(u.agreementRequestedAt || ""), signed = Date.parse(rec?.acceptedAt || "");
    if (rec && !(Number.isFinite(asked) && asked > signed)) return "signed";
    if (Number.isFinite(asked)) return "asked";
    return "none";
  };
  const fmt = (iso) => { const d = new Date(iso); return isNaN(d) ? "" : d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }); };

  async function load() {
    const [us, ac] = await Promise.all([getDocs(collection(db, "users")), getDocs(collection(db, "agreement_acceptances"))]);
    // each person's most recent signature, whichever version it was
    records = new Map();
    ac.docs.map((d) => d.data()).forEach((r) => { const cur = records.get(r.uid); if (!cur || String(r.acceptedAt) > String(cur.acceptedAt)) records.set(r.uid, r); });
    people = us.docs.map((d) => ({ id: d.id, ...d.data() })).filter((u) => u.role && u.role !== "reader")
      .sort((a, b) => String(a.name || a.email).localeCompare(String(b.name || b.email)));
    render();
  }

  function render() {
    const signed = people.filter((u) => statusOf(u) === "signed").length;
    root.querySelector("#agt-stats").innerHTML = `<b>${signed}</b> of <b>${people.length}</b> staff have signed. People only see the agreement again if you send it to them.`;
    const list = people.filter((u) => !q || `${u.name} ${u.email} ${u.role}`.toLowerCase().includes(q));
    root.querySelector("#agt-list").innerHTML = list.map((u) => {
      const st = statusOf(u), rec = records.get(u.id);
      const label = st === "signed" ? `<span class="agt-pill is-signed">Signed</span>${esc(fmt(rec.acceptedAt))}${rec.version !== AGREEMENT_VERSION ? ` · earlier version` : ""}`
        : st === "asked" ? `<span class="agt-pill is-asked">Asked</span>${esc(fmtRelative(u.agreementRequestedAt))}, not signed yet`
        : `<span class="agt-pill is-none">Not signed</span>`;
      return `<li data-uid="${esc(u.id)}">
        <div class="agt-row">
          <span class="agt-name">${esc(u.name || "(no name)")}<small>${esc(u.email || "")} · ${esc(String(u.role).replace("_", " "))}</small></span>
          <span class="agt-status">${label}</span>
          <span class="agt-acts">
            ${rec ? `<button type="button" class="btn btn-ghost btn-sm" data-rec>Record</button>` : ""}
            <button type="button" class="btn btn-secondary btn-sm" data-ask>${st === "none" ? "Ask to sign" : "Ask again"}</button>
          </span>
        </div>
      </li>`;
    }).join("") || `<li class="agt-row">No one matches.</li>`;
  }

  async function ask(uids, btn) {
    if (!uids.length) { toast("Everyone has signed.", "success"); return; }
    btn.disabled = true;
    try {
      const res = await ctx.authedFetch("/api/agreement/request", { method: "POST", body: JSON.stringify({ uids }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || `Request failed (${res.status})`);
      toast(`Done. The agreement will open for ${data.sent === 1 ? "them" : `these ${data.sent} people`} the next time they open the Editorial Suite. No email is sent.`, "success", 5200);
      await load();
    } catch (e) { toast(e.message || "Couldn't send.", "error"); }
    finally { btn.disabled = false; }
  }

  root.querySelector("#agt-q").addEventListener("input", (e) => { q = e.target.value.trim().toLowerCase(); render(); });
  root.querySelector("#agt-ask-all").addEventListener("click", (e) => ask(people.filter((u) => statusOf(u) !== "signed").map((u) => u.id), e.currentTarget));
  root.querySelector("#agt-list").addEventListener("click", (e) => {
    const li = e.target.closest("li[data-uid]"); if (!li) return;
    const u = people.find((x) => x.id === li.dataset.uid);
    if (e.target.closest("[data-ask]")) return ask([u.id], e.target.closest("[data-ask]"));
    if (e.target.closest("[data-rec]")) {
      const open = li.querySelector(".agt-rec");
      if (open) { open.remove(); return; }
      const r = records.get(u.id);
      li.insertAdjacentHTML("beforeend", `<dl class="agt-rec">
        <dt>Signed</dt><dd>${esc(fmt(r.acceptedAt))} (${esc(r.acceptedAt)})</dd>
        <dt>As</dt><dd>${esc(r.name)} · ${esc(r.email)} · ${esc(r.role)}</dd>
        <dt>Version</dt><dd>${esc(r.version)} · <a href="${esc(r.documentUrl)}" target="_blank" rel="noopener">the text they agreed to</a></dd>
        <dt>Text fingerprint</dt><dd>SHA-256 ${esc(r.textSha256)}</dd>
        <dt>IP address</dt><dd>${esc(r.ip || "—")}${r.country ? ` (${esc(r.country)})` : ""}</dd>
        <dt>Browser</dt><dd>${esc(r.userAgent || "—")}</dd>
        <dt>How</dt><dd>${esc(r.method || "")}</dd>
      </dl>`);
    }
  });
  root.querySelector("#agt-csv").addEventListener("click", () => {
    const cols = ["name", "email", "role", "status", "acceptedAt", "version", "ip", "country", "userAgent", "textSha256", "documentUrl"];
    const rows = people.map((u) => { const r = records.get(u.id) || {}; return { name: u.name || "", email: u.email || "", role: u.role || "", status: statusOf(u), acceptedAt: r.acceptedAt || "", version: r.version || "", ip: r.ip || "", country: r.country || "", userAgent: r.userAgent || "", textSha256: r.textSha256 || "", documentUrl: r.documentUrl || "" }; });
    const csv = [cols.join(","), ...rows.map((r) => cols.map((c) => `"${String(r[c]).replace(/"/g, '""')}"`).join(","))].join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `catalyst-contributor-agreement-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });

  load().catch((e) => { root.querySelector("#agt-stats").textContent = `Couldn't load: ${e.message || e}`; });
}
