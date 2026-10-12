#!/usr/bin/env node
// Editorial Suite layout check: opens every Suite page at laptop (1512px) and
// phone (390px) width and reports content that spills out of a table cell,
// overlaps its neighbour, gets cut off without an ellipsis, or runs off the
// right edge. Read-only: it only changes the page's #hash, never clicks.
//
// Usage:
//   node scripts/suite-layout-check.mjs            # checks the live site
//   node scripts/suite-layout-check.mjs http://localhost:8788
// A Chrome window opens on /admin — sign in there; the check starts by itself.
// Screenshots + report.json land in a temp folder printed at the end.
// Treat the findings as leads: look at the screenshot before changing code
// (a decorative overlay or a deliberately clipped map can be flagged).

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const SITE = (process.argv[2] || "https://www.catalyst-magazine.com").replace(/\/+$/, "");
const PORT = 9555;
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), "suite-layout-"));
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

// Every route in ROUTES (js/dashboard/app.js) except ones that need an id.
const appJs = fs.readFileSync(path.join(ROOT, "js/dashboard/app.js"), "utf8");
const block = appJs.slice(appJs.indexOf("const ROUTES = {"));
const routes = [...block.slice(0, block.indexOf("\n};")).matchAll(/^  "(#\/[^"]+)"/gm)].map((m) => m[1]).filter((r) => r !== "#/final-review");

const DETECT = `(() => {
  const out = [];
  const vis = (el) => { const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false; const cs = getComputedStyle(el); return cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0.05; };
  const desc = (el) => { let s = el.tagName.toLowerCase(); if (el.id) s += '#' + el.id; const c = [...el.classList].slice(0, 2).join('.'); if (c) s += '.' + c; const t = (el.innerText || el.value || '').trim().replace(/\\s+/g, ' ').slice(0, 40); return t ? \`\${s} "\${t}"\` : s; };
  const root = document.querySelector('#app, main, .main, body');
  const inMain = (el) => !el.closest('.sidebar, nav.sidebar, aside.sidebar, .wr-drawer, [role="dialog"]:not([open])');
  // 1. content spilling out of a table cell
  root.querySelectorAll('td, th').forEach((td) => {
    if (!vis(td) || !inMain(td)) return;
    const r = td.getBoundingClientRect();
    for (const c of td.querySelectorAll('*')) {
      if (!vis(c) || getComputedStyle(c).position === 'absolute' || getComputedStyle(c).position === 'fixed') continue;
      const cr = c.getBoundingClientRect();
      let clipped = false; for (let q = c.parentElement; q && q !== td.parentElement; q = q.parentElement) { if (/hidden|clip|auto|scroll/.test(getComputedStyle(q).overflowX)) { const qr = q.getBoundingClientRect(); if (qr.right <= r.right + 3 && qr.left >= r.left - 3) { clipped = true; break; } } }
      if (clipped) continue;
      const by = Math.max(cr.right - r.right, r.left - cr.left);
      if (by > 3) { out.push({ type: 'spills out of table cell', el: desc(c), by: Math.round(by) }); break; }
    }
  });
  // 2. siblings in a flex/grid row overlapping each other
  root.querySelectorAll('*').forEach((p) => {
    const d = getComputedStyle(p).display;
    if (!/flex|grid/.test(d) || !vis(p) || !inMain(p)) return;
    const kids = [...p.children].filter((k) => vis(k) && !/absolute|fixed/.test(getComputedStyle(k).position) && getComputedStyle(k).pointerEvents !== 'none');
    if (kids.length < 2 || kids.length > 40) return;
    for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) {
      const a = kids[i].getBoundingClientRect(), b = kids[j].getBoundingClientRect();
      const w = Math.min(a.right, b.right) - Math.max(a.left, b.left), h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (w > 4 && h > 4) { out.push({ type: 'overlaps neighbour', el: desc(kids[i]), other: desc(kids[j]), area: Math.round(w) + 'x' + Math.round(h) }); return; }
    }
  });
  // 3. text cut off without an ellipsis
  root.querySelectorAll('button, a, label, span, p, h1, h2, h3, h4, td, th, div, select').forEach((e) => {
    if (!vis(e) || !inMain(e)) return;
    const cs = getComputedStyle(e);
    if (!/hidden|clip/.test(cs.overflowX) || cs.textOverflow === 'ellipsis') return;
    if (e.closest('.sr-only, .visually-hidden') || (cs.position === 'absolute' && e.clientWidth <= 1)) return;   // screen-reader-only text
    if (e.children.length > 0 && e.tagName !== 'SELECT') return;
    if (e.scrollWidth > e.clientWidth + 2 && (e.innerText || '').trim()) out.push({ type: 'text cut off', el: desc(e), by: e.scrollWidth - e.clientWidth });
  });
  // 4. element wider than the window
  root.querySelectorAll('*').forEach((e) => {
    if (!vis(e) || !inMain(e)) return;
    const r = e.getBoundingClientRect();
    if (r.right > innerWidth + 2 && !e.closest('[style*="overflow"], .table-wrap, .scroll-x') && getComputedStyle(e).position !== 'fixed') {
      let p = e.parentElement, scrolls = false;
      while (p) { if (/auto|scroll/.test(getComputedStyle(p).overflowX)) { scrolls = true; break; } p = p.parentElement; }
      // clipped on purpose with an ellipsis somewhere up the chain: fine
      let q = e; while (q && !scrolls) { if (getComputedStyle(q).textOverflow === 'ellipsis') scrolls = true; q = q.parentElement; }
      if (!scrolls) out.push({ type: 'off the right edge', el: desc(e), by: Math.round(r.right - innerWidth) });
    }
  });
  if (document.documentElement.scrollWidth > innerWidth + 1) out.push({ type: 'page scrolls sideways', by: document.documentElement.scrollWidth - innerWidth });
  const seen = new Set();
  return JSON.stringify(out.filter((o) => { const k = o.type + o.el; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 25));
})()`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn(CHROME, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${path.join(OUT, "profile")}`, "--no-first-run", "--window-size=1512,980", `${SITE}/admin/`], { stdio: "ignore" });

async function pageTarget() {
  for (;;) {
    try {
      const t = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((x) => x.type === "page" && x.url.startsWith(SITE));
      if (t) return t;
    } catch {}
    await sleep(1000);
  }
}
let target = await pageTarget();
console.log("Sign in to the Suite in the Chrome window that just opened…");
while (!/\/admin\/?#\//.test(target.url)) { await sleep(3000); target = await pageTarget(); }

const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d.result || d.error); pending.delete(d.id); } };
await new Promise((r) => (ws.onopen = r));
await sleep(3000);

const report = {}; let total = 0;
for (const [label, width, height, mobile] of [["laptop", 1512, 860, false], ["phone", 390, 844, true]]) {
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile });
  for (const r of routes) {
    await send("Runtime.evaluate", { expression: `location.hash = ${JSON.stringify(r)}` });
    await sleep(4500);
    const res = await send("Runtime.evaluate", { expression: DETECT, returnByValue: true });
    const issues = JSON.parse(res?.result?.value || "[]");
    (report[r] ||= {})[label] = issues; total += issues.length;
    const shot = await send("Page.captureScreenshot", { format: "jpeg", quality: 70 });
    fs.writeFileSync(path.join(OUT, `${label}-${r.replace(/[#/]+/g, "_")}.jpg`), Buffer.from(shot.data, "base64"));
    for (const i of issues) console.log(`${label.padEnd(6)} ${r.padEnd(28)} ${i.type}: ${i.el || ""}${i.other ? " / " + i.other : ""}${i.by ? ` (${i.by}px)` : ""}`);
  }
}
fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
console.log(`\n${routes.length} pages × 2 sizes checked, ${total} finding(s). Screenshots: ${OUT}`);
ws.close(); chrome.kill(); process.exit(0);
