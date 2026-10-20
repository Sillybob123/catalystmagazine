// The edition's deadlines on the Suite Overview, so nobody forgets them:
// first draft and final draft (both hard deadlines) and launch day, each with
// a countdown, plus the signed-in person's own pieces and their next step.
// Reads the same hub as This edition (edition_hub/{CURRENT_EDITION}, staff
// only); shows nothing if it can't, or once the edition has been out a week.

import { db } from "../firebase-config.js";
import { doc, getDoc, collection, getDocs } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { el, esc } from "./ui.js";

// Keep in step with EDITION in edition-hub.js.
export const CURRENT_EDITION = "winter-2027";

const STAGE_LABEL = {
  idea: "Needs a proposal", proposal: "Proposal reviewed", reporting: "Interviewing and research",
  drafting: "Writing the first draft", draft1: "First draft in", editing: "Editing with the editor",
  final: "Final draft in", ready: "Ready to publish",
};
const ORDER = Object.keys(STAGE_LABEL);
const DAY = 86400000;
const parseDay = (s) => { const [y, m, d] = String(s || "").split("-").map(Number); return y ? new Date(y, m - 1, d) : null; };
const daysUntil = (s) => { const d = parseDay(s); if (!d) return null; const n = new Date(); return Math.round((d - new Date(n.getFullYear(), n.getMonth(), n.getDate())) / DAY); };
const fmt = (s, o) => parseDay(s)?.toLocaleDateString("en-US", o) || "";
const when = (n) => (n < 0 ? "Passed" : n === 0 ? "Today" : n === 1 ? "Tomorrow" : `In ${n} days`);

export function editionDeadlinesCard(ctx) {
  injectStyle();
  const card = el("section", { class: "card ed-dl", hidden: "" });
  (async () => {
    try {
      const snap = await getDoc(doc(db, "edition_hub", CURRENT_EDITION));
      if (!snap.exists()) return;
      const hub = snap.data();
      const launchN = daysUntil(hub.launch);
      if (launchN != null && launchN < -7) return;
      const dates = (hub.dates || []).filter((d) => d.hard);
      const items = [...dates, { id: "launch", label: "Launch day", date: hub.launch, launch: true }];
      const uid = ctx.user?.uid || "", name = String(ctx.profile?.name || "").trim().toLowerCase();
      let mine = [];
      try {
        const ps = await getDocs(collection(db, "edition_hub", CURRENT_EDITION, "pieces"));
        mine = ps.docs.map((d) => ({ id: d.id, ...d.data() }))
          .filter((p) => p.section !== "held" && p.status !== "open")
          .filter((p) => (p.writerUids || []).includes(uid) || (p.writers || []).some((w) => String(w.name || "").trim().toLowerCase() === name));
      } catch {}
      const nextIdx = items.findIndex((d) => daysUntil(d.date) >= 0);
      card.innerHTML = `
        <div class="ed-dl-head">
          <div><p class="ed-dl-k">${esc(hub.name || "This")} edition</p><h2 class="ed-dl-title">Deadlines to remember</h2></div>
          <a class="btn btn-secondary btn-sm" href="#/edition">Open This edition</a>
        </div>
        <ol class="ed-dl-list">${items.map((d, i) => {
          const n = daysUntil(d.date);
          const tone = n < 0 ? "is-past" : d.launch ? "" : n <= 7 ? "is-soon" : "";
          return `<li class="${tone}${i === nextIdx ? " is-next" : ""}">
            <span class="ed-dl-label">${esc(d.label)}</span>
            <span class="ed-dl-date">${esc(fmt(d.date, { weekday: "long", month: "long", day: "numeric" }))}</span>
            <span class="ed-dl-when">${esc(when(n))}</span>
            ${d.hard ? `<span class="ed-dl-hard">Hard deadline</span>` : ""}
          </li>`;
        }).join("")}</ol>
        ${mine.length ? `<ul class="ed-dl-mine">${mine.map((p) => {
          const step = (p.nextSteps || []).find((s) => !s.done);
          const i = ORDER.indexOf(p.status || "idea");
          const due = i < ORDER.indexOf("draft1") ? dates.find((d) => d.id === "first-draft") : i < ORDER.indexOf("final") ? dates.find((d) => d.id === "final-draft") : null;
          return `<li><a href="#/edition?piece=${encodeURIComponent(p.id)}">
            <span class="ed-dl-mt">${esc(p.title)}</span>
            <span class="ed-dl-mm">${esc(STAGE_LABEL[p.status] || "")}${due ? ` · ${esc(due.label)} ${esc(when(daysUntil(due.date)).toLowerCase())}` : ""}${step ? ` · Next: ${esc(step.text)}` : ""}</span>
          </a></li>`;
        }).join("")}</ul>` : ""}`;
      card.hidden = false;
    } catch { /* not staff, or offline: leave it hidden */ }
  })();
  return card;
}

function injectStyle() {
  if (document.getElementById("ed-dl-style")) return;
  const s = document.createElement("style");
  s.id = "ed-dl-style";
  s.textContent = `
.ed-dl { padding: 22px 24px 20px; margin: 0 0 20px; }
.ed-dl-head { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 12px; margin: 0 0 16px; }
.ed-dl-k { margin: 0 0 4px; font: 600 11px/1.2 var(--font); letter-spacing: .14em; text-transform: uppercase; color: var(--muted); }
.ed-dl-title { margin: 0; font: 600 18px/1.25 var(--font); letter-spacing: -0.02em; color: var(--ink); }
.ed-dl-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 12px; margin: 0; padding: 0; list-style: none; }
.ed-dl-list li { display: flex; flex-direction: column; gap: 3px; padding: 14px 16px; border-radius: 12px; background: var(--surface-3); }
.ed-dl-list li.is-next { background: var(--ink); color: var(--surface-2); }
.ed-dl-label { font: 600 14px/1.3 var(--font); }
.ed-dl-date { font-size: 12.5px; color: var(--muted); }
.ed-dl-list li.is-next .ed-dl-date { color: rgba(248,247,243,.7); }
.ed-dl-when { margin-top: 6px; font: 600 20px/1.1 var(--font); letter-spacing: -0.02em; }
.ed-dl-list li.is-soon .ed-dl-when { color: var(--warn); }
.ed-dl-list li.is-next.is-soon .ed-dl-when { color: #f3c98b; }
.ed-dl-list li.is-past { opacity: .55; }
.ed-dl-hard { align-self: flex-start; margin-top: 4px; padding: 2px 8px; border-radius: 99px; background: var(--danger-soft); color: var(--danger); font: 600 10px/1.5 var(--font); letter-spacing: .06em; }
.ed-dl-list li.is-next .ed-dl-hard { background: rgba(248,247,243,.14); color: var(--surface-2); }
.ed-dl-mine { margin: 16px 0 0; padding: 0; list-style: none; border-top: 1px solid var(--hairline-2); }
.ed-dl-mine a { display: flex; flex-direction: column; gap: 2px; min-height: 44px; justify-content: center; padding: 10px 8px; margin: 0 -8px; border-radius: 10px; color: inherit; text-decoration: none; }
.ed-dl-mine a:hover { background: var(--surface-3); }
.ed-dl-mine a:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
.ed-dl-mt { font: 600 14px/1.35 var(--font); color: var(--ink); }
.ed-dl-mm { font-size: 12.5px; line-height: 1.45; color: var(--muted); }
`;
  document.head.appendChild(s);
}
