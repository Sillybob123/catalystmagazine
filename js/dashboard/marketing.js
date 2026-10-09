// Marketing module — mount keys:
//   - "analytics": headline stats + 30-day growth sparkline
//   - "collabs":   collaboration-request pipeline

import { el, esc, fmtRelative, fmtDate, confirmDialog } from "./ui.js";
import { canAssign, loadAssignments, loadTeam, applyPlan, scheduleHTML, mountPlan, avatar, avatarStack, creatorName, fmtTime } from "./social-plan.js?v=2";

export async function mount(ctx, container) {
  container.innerHTML = "";
  if (ctx.mountKey === "collabs") return mountCollabs(ctx, container);
  if (ctx.mountKey === "subscribers") return mountSubscriberList(ctx, container);
  if (ctx.mountKey === "social") return mountSocialPosts(ctx, container);
  return mountAnalytics(ctx, container);
}

async function mountAnalytics(ctx, container) {
  const wrapper = el("div", {});
  wrapper.innerHTML = `
    <div class="grid grid-4" id="stat-grid">
      <div class="stat"><div class="stat-label">Total subscribers</div><div class="stat-value" data-k="total">…</div></div>
      <div class="stat"><div class="stat-label">Active</div><div class="stat-value" data-k="active">…</div></div>
      <div class="stat"><div class="stat-label">New — 7 days</div><div class="stat-value" data-k="new7">…</div></div>
      <div class="stat"><div class="stat-label">New — 30 days</div><div class="stat-value" data-k="new30">…</div></div>
    </div>

    <div class="card" style="margin-top:20px;">
      <div class="card-header">
        <div>
          <div class="card-title">30-day signup growth</div>
          <div class="card-subtitle">Daily new subscribers, peak days, and trend over the last month.</div>
        </div>
      </div>
      <div class="card-body">
        <div class="growth-summary" id="growth-summary">
          <div class="growth-stat"><div class="growth-stat-label">Avg / day</div><div class="growth-stat-value" data-g="avg">…</div></div>
          <div class="growth-stat"><div class="growth-stat-label">Peak day</div><div class="growth-stat-value" data-g="peak">…</div><div class="growth-stat-sub" data-g="peakDate">&nbsp;</div></div>
          <div class="growth-stat"><div class="growth-stat-label">Active days</div><div class="growth-stat-value" data-g="activeDays">…</div><div class="growth-stat-sub">of 30</div></div>
          <div class="growth-stat"><div class="growth-stat-label">Busiest weekday</div><div class="growth-stat-value" data-g="bestDow">…</div><div class="growth-stat-sub" data-g="bestDowAvg">&nbsp;</div></div>
        </div>
        <div class="growth-chart" id="growth-chart"></div>
      </div>
    </div>

    <div class="grid grid-2" style="margin-top:20px;">
      <div class="stat"><div class="stat-label">Unsubscribes</div><div class="stat-value" data-k="unsub">…</div></div>
      <div class="stat"><div class="stat-label">Collaboration requests</div><div class="stat-value" data-k="collabs">…</div></div>
    </div>`;
  container.appendChild(wrapper);

  try {
    const res = await ctx.authedFetch("/api/subscribers/stats");
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);

    const set = (k, v) => { const n = wrapper.querySelector(`[data-k="${k}"]`); if (n) n.textContent = v; };
    set("total", data.stats.total);
    set("active", data.stats.active);
    set("new7", data.stats.new7);
    set("new30", data.stats.new30);
    set("unsub", data.stats.unsubscribed);
    set("collabs", data.stats.collaborations);

    renderGrowthChart(wrapper, data.series || []);
  } catch (err) {
    wrapper.innerHTML = `<div class="error-state">Could not load stats: ${esc(err.message)}</div>`;
  }
}

// Render the 30-day signup growth chart + summary stats.
// `series` is `[{date: 'YYYY-MM-DD', count: N}]` ordered oldest → newest.
//
// Why a hand-rolled SVG instead of Chart.js: the dashboard already ships
// zero third-party JS for charts, and a 30-bar daily view doesn't need a
// runtime. SVG also gives crisp text + perfect retina rendering and lets
// the bars hook into existing CSS tokens.
function renderGrowthChart(wrapper, series) {
  const sumEl = wrapper.querySelector("#growth-summary");
  const chartEl = wrapper.querySelector("#growth-chart");
  if (!chartEl) return;

  const counts = series.map((d) => d.count || 0);
  const total = counts.reduce((a, b) => a + b, 0);
  const avg = series.length ? total / series.length : 0;
  const peakCount = counts.length ? Math.max(...counts) : 0;
  const peakIdx = counts.indexOf(peakCount);
  const peakDate = peakCount > 0 && peakIdx >= 0 ? series[peakIdx].date : null;
  const activeDays = counts.filter((c) => c > 0).length;

  // Weekday averages — which day of week pulls in the most signups.
  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const dowTotals = [0, 0, 0, 0, 0, 0, 0];
  const dowCounts = [0, 0, 0, 0, 0, 0, 0];
  series.forEach((d) => {
    const dow = dateOnly(d.date).getDay();
    dowTotals[dow] += d.count || 0;
    dowCounts[dow] += 1;
  });
  const dowAvgs = dowTotals.map((t, i) => (dowCounts[i] ? t / dowCounts[i] : 0));
  const bestDowIdx = dowAvgs.indexOf(Math.max(...dowAvgs));
  const bestDow = dowAvgs[bestDowIdx] > 0 ? DOW[bestDowIdx] : "—";
  const bestDowAvg = dowAvgs[bestDowIdx] > 0
    ? `${dowAvgs[bestDowIdx].toFixed(1)} / day avg`
    : "no signups yet";

  if (sumEl) {
    const setG = (k, v) => {
      const n = sumEl.querySelector(`[data-g="${k}"]`);
      if (n) n.textContent = v;
    };
    setG("avg", avg.toFixed(1));
    setG("peak", peakCount);
    setG("peakDate", peakDate ? fmtChartDate(peakDate) : "no signups");
    setG("activeDays", activeDays);
    setG("bestDow", bestDow);
    setG("bestDowAvg", bestDowAvg);
  }

  if (!series.length) {
    chartEl.innerHTML = `<div class="empty-state" style="padding:20px;">No signup data yet.</div>`;
    return;
  }

  const rolling = series.map((_, i) => {
    const lo = Math.max(0, i - 6);
    const slice = counts.slice(lo, i + 1);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  });
  const cumulative = counts.reduce((acc, count, i) => {
    acc.push((acc[i - 1] || 0) + count);
    return acc;
  }, []);
  const rows = series.map((d, i) => {
    const date = dateOnly(d.date);
    const count = d.count || 0;
    const prev = i > 0 ? counts[i - 1] : null;
    return {
      date: d.date,
      count,
      rolling: rolling[i] || 0,
      cumulative: cumulative[i] || count,
      change: prev == null ? null : count - prev,
      weekday: DOW[date.getDay()],
      isPeak: count === peakCount && count > 0 && i === peakIdx,
    };
  });

  // SVG geometry. Use a viewBox so it scales with the card but keeps exact
  // coordinates for hit targets, tooltip positioning, and keyboard focus.
  const W = 860, H = 300;
  const pad = { top: 18, right: 20, bottom: 46, left: 44 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;

  const n = series.length;
  const step = plotW / n;
  const barW = Math.max(5, Math.min(20, step * 0.58));
  const xCenter = (i) => pad.left + step * i + step / 2;
  const x = (i) => xCenter(i) - barW / 2;
  const baseline = pad.top + plotH;
  const yMax = niceMax(Math.max(peakCount, ...rolling));
  const yTicks = niceTicks(yMax, 4);
  const y = (v) => pad.top + plotH - (v / (yMax || 1)) * plotH;

  const linePath = rolling.map((v, i) => {
    const cx = xCenter(i);
    const cy = y(v);
    return `${i === 0 ? "M" : "L"} ${cx.toFixed(1)} ${cy.toFixed(1)}`;
  }).join(" ");
  const areaPath = linePath
    ? `${linePath} L ${xCenter(n - 1).toFixed(1)} ${baseline.toFixed(1)} L ${xCenter(0).toFixed(1)} ${baseline.toFixed(1)} Z`
    : "";

  // Date labels — show every ~5th day so the axis doesn't crowd.
  const labelStep = Math.max(1, Math.ceil(n / 6));

  const gridLines = yTicks.map((t) => {
    const gy = y(t);
    return `<line class="growth-grid-line" x1="${pad.left}" y1="${gy.toFixed(1)}" x2="${(W - pad.right).toFixed(1)}" y2="${gy.toFixed(1)}"/>` +
      `<text class="growth-axis-label" x="${pad.left - 10}" y="${(gy + 3).toFixed(1)}" text-anchor="end">${t}</text>`;
  }).join("");

  const bars = rows.map((d, i) => {
    const v = d.count;
    const bx = x(i);
    const by = y(v);
    const bh = Math.max(v > 0 ? 3 : 0, baseline - by);
    return `<rect class="growth-bar${d.isPeak ? " growth-bar-peak" : ""}" data-index="${i}" x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${barW.toFixed(1)}" height="${bh.toFixed(1)}" rx="4"/>`;
  }).join("");

  const hitZones = rows.map((d, i) => {
    const hx = pad.left + step * i;
    return `<rect class="growth-hit" tabindex="0" role="button" aria-label="${esc(fmtFullChartDate(d.date))}: ${d.count} signup${d.count === 1 ? "" : "s"}" data-index="${i}" x="${hx.toFixed(1)}" y="${pad.top}" width="${step.toFixed(1)}" height="${plotH}"/>`;
  }).join("");

  const avgDots = rows.map((d, i) => {
    if (i % 3 !== 0 && i !== n - 1 && !d.isPeak) return "";
    return `<circle class="growth-line-dot" cx="${xCenter(i).toFixed(1)}" cy="${y(d.rolling).toFixed(1)}" r="2.2"/>`;
  }).join("");

  const xLabels = series.map((d, i) => {
    if (i % labelStep !== 0 && i !== n - 1) return "";
    return `<text class="growth-axis-label" x="${xCenter(i).toFixed(1)}" y="${(H - pad.bottom + 22).toFixed(1)}" text-anchor="middle">${esc(shortDate(d.date))}</text>`;
  }).join("");

  chartEl.innerHTML = `
    <div class="growth-chart-toolbar">
      <div class="growth-chart-legend">
        <span class="growth-legend-item"><span class="growth-legend-swatch growth-legend-swatch-bar"></span>Daily signups</span>
        <span class="growth-legend-item"><span class="growth-legend-swatch growth-legend-swatch-line"></span>7-day rolling avg</span>
      </div>
      <div class="growth-total-pill">${fmtWhole(total)} total over ${n} days</div>
    </div>
    <div class="growth-chart-stage">
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Interactive 30-day signup growth chart">
        <defs>
          <linearGradient id="growth-area-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.14"/>
            <stop offset="100%" stop-color="var(--accent)" stop-opacity="0"/>
          </linearGradient>
        </defs>
        <g>${gridLines}</g>
        <g>${bars}</g>
        ${areaPath ? `<path class="growth-area" d="${areaPath}"/>` : ""}
        <path class="growth-line" d="${linePath}"/>
        <g>${avgDots}</g>
        <line class="growth-crosshair" x1="0" x2="0" y1="${pad.top}" y2="${baseline}" hidden/>
        <circle class="growth-selected-dot" r="4.5" hidden/>
        <g>${xLabels}</g>
        <g>${hitZones}</g>
      </svg>
      <div class="growth-tooltip" hidden></div>
    </div>
    <div class="growth-day-panel" id="growth-day-panel"></div>`;

  const stage = chartEl.querySelector(".growth-chart-stage");
  const tooltip = chartEl.querySelector(".growth-tooltip");
  const panel = chartEl.querySelector("#growth-day-panel");
  const crosshair = chartEl.querySelector(".growth-crosshair");
  const selectedDot = chartEl.querySelector(".growth-selected-dot");
  const barEls = Array.from(chartEl.querySelectorAll(".growth-bar"));
  const hitEls = Array.from(chartEl.querySelectorAll(".growth-hit"));
  let lockedIdx = peakIdx >= 0 ? peakIdx : n - 1;

  const showDay = (idx, showTooltip = false) => {
    const d = rows[idx];
    if (!d) return;
    const cx = xCenter(idx);
    const barY = y(d.count);
    const lineY = y(d.rolling);
    barEls.forEach((bar) => bar.classList.toggle("is-selected", Number(bar.dataset.index) === idx));
    hitEls.forEach((hit) => hit.classList.toggle("is-selected", Number(hit.dataset.index) === idx));
    crosshair?.removeAttribute("hidden");
    selectedDot?.removeAttribute("hidden");
    if (crosshair) {
      crosshair.setAttribute("x1", cx.toFixed(1));
      crosshair.setAttribute("x2", cx.toFixed(1));
    }
    if (selectedDot) {
      selectedDot.setAttribute("cx", cx.toFixed(1));
      selectedDot.setAttribute("cy", lineY.toFixed(1));
    }
    if (panel) {
      panel.innerHTML = growthDayPanelHtml(d, avg, peakCount);
    }
    if (showTooltip && tooltip && stage) {
      tooltip.innerHTML = growthTooltipHtml(d, avg, peakCount);
      tooltip.hidden = false;
      tooltip.style.visibility = "hidden";
      const stageBox = stage.getBoundingClientRect();
      const svgBox = stage.querySelector("svg").getBoundingClientRect();
      const sx = svgBox.width / W;
      const sy = svgBox.height / H;
      const left = (svgBox.left - stageBox.left) + cx * sx;
      const pointTop = (svgBox.top - stageBox.top) + Math.min(barY, lineY) * sy;
      const tooltipWidth = 220;
      const tooltipHeight = tooltip.offsetHeight || 130;
      const aboveTop = pointTop - tooltipHeight - 18;
      const belowTop = pointTop + 18;
      tooltip.style.left = `${Math.max(12, Math.min(stageBox.width - tooltipWidth - 12, left - tooltipWidth / 2))}px`;
      tooltip.style.top = `${aboveTop >= 12 ? aboveTop : Math.min(stageBox.height - tooltipHeight - 12, belowTop)}px`;
      tooltip.style.visibility = "";
    }
  };

  hitEls.forEach((hit) => {
    const idx = Number(hit.dataset.index);
    hit.addEventListener("mouseenter", () => showDay(idx, true));
    hit.addEventListener("mousemove", () => showDay(idx, true));
    hit.addEventListener("focus", () => showDay(idx, true));
    hit.addEventListener("click", () => {
      lockedIdx = idx;
      showDay(idx, true);
    });
    hit.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        lockedIdx = idx;
        showDay(idx, true);
      }
    });
    hit.addEventListener("mouseleave", () => {
      if (tooltip) tooltip.hidden = true;
      showDay(lockedIdx, false);
    });
    hit.addEventListener("blur", () => {
      if (tooltip) tooltip.hidden = true;
      showDay(lockedIdx, false);
    });
  });
  showDay(lockedIdx, false);
}

function growthTooltipHtml(d, avg, peakCount) {
  return `
    <div class="growth-tooltip-title">${esc(fmtFullChartDate(d.date))}</div>
    <div class="growth-tooltip-grid">
      <span><strong>${fmtWhole(d.count)}</strong>Signups</span>
      <span><strong>${d.rolling.toFixed(1)}</strong>7-day avg</span>
      <span><strong>${fmtChange(d.change)}</strong>vs. prior day</span>
      <span><strong>${fmtWhole(d.cumulative)}</strong>Cumulative</span>
    </div>
    <div class="growth-tooltip-note">${esc(dayInsight(d, avg, peakCount))}</div>`;
}

function growthDayPanelHtml(d, avg, peakCount) {
  return `
    <div>
      <div class="growth-day-kicker">Selected day</div>
      <div class="growth-day-title">${esc(fmtFullChartDate(d.date))}</div>
      <div class="growth-day-note">${esc(dayInsight(d, avg, peakCount))}</div>
    </div>
    <div class="growth-day-grid">
      <span><strong>${fmtWhole(d.count)}</strong>Signups</span>
      <span><strong>${d.rolling.toFixed(1)}</strong>7-day avg</span>
      <span><strong>${fmtChange(d.change)}</strong>vs. prior day</span>
      <span><strong>${fmtWhole(d.cumulative)}</strong>Running total</span>
    </div>`;
}

function dayInsight(d, avg, peakCount) {
  if (d.isPeak) return `Peak day: ${fmtWhole(d.count)} signup${d.count === 1 ? "" : "s"}, ${compareToAvg(d.count, avg)}.`;
  if (d.count === 0) return `No new signups recorded on this ${d.weekday}.`;
  return `${fmtWhole(d.count)} signup${d.count === 1 ? "" : "s"} on ${d.weekday}, ${compareToAvg(d.count, avg)}.`;
}

function compareToAvg(count, avg) {
  if (!avg) return "with no 30-day average yet";
  const diff = count - avg;
  if (Math.abs(diff) < 0.05) return "right at the 30-day average";
  return `${Math.abs(diff).toFixed(1)} ${diff > 0 ? "above" : "below"} the 30-day average`;
}

function fmtWhole(value) {
  return Math.round(Number(value) || 0).toLocaleString();
}

function fmtChange(value) {
  if (value == null) return "—";
  if (value === 0) return "0";
  return `${value > 0 ? "+" : ""}${fmtWhole(value)}`;
}

function dateOnly(yyyyMmDd) {
  // Parse the YYYY-MM-DD date in local time so weekday math doesn't
  // shift across the UTC boundary for late-night signups.
  const [y, m, d] = (yyyyMmDd || "").split("-").map(Number);
  return new Date(y || 1970, (m || 1) - 1, d || 1);
}

function shortDate(yyyyMmDd) {
  const d = dateOnly(yyyyMmDd);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function fmtChartDate(yyyyMmDd) {
  const d = dateOnly(yyyyMmDd);
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function fmtFullChartDate(yyyyMmDd) {
  const d = dateOnly(yyyyMmDd);
  return d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric", year: "numeric" });
}

// Round a max value up to a "nice" axis cap so gridlines fall on whole numbers.
function niceMax(v) {
  if (!v || v <= 0) return 4;
  if (v <= 4) return 4;
  if (v <= 10) return Math.ceil(v / 2) * 2;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const norm = v / pow;
  let nice;
  if (norm <= 1) nice = 1;
  else if (norm <= 2) nice = 2;
  else if (norm <= 5) nice = 5;
  else nice = 10;
  return nice * pow;
}

function niceTicks(max, count) {
  const step = max / count;
  const ticks = [];
  for (let i = 0; i <= count; i++) ticks.push(Math.round(step * i));
  return ticks;
}

async function mountSubscriberList(ctx, container) {
  const card = el("div", { class: "card" });
  card.innerHTML = `
    <div class="card-header">
      <div>
        <div class="card-title">Subscriber list</div>
        <div class="card-subtitle">Everyone currently on the mailing list.</div>
      </div>
      <div style="display:flex;gap:8px;align-items:center;">
        <input class="input" id="sub-search" placeholder="Search name or email…" style="width:220px;">
        <select class="input" id="sub-filter" style="width:130px;">
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="unsubscribed">Unsubscribed</option>
        </select>
        <span id="sub-count" class="hint" style="white-space:nowrap;"></span>
      </div>
    </div>
    <div class="card-body" id="sub-body"><div class="loading-state"><div class="spinner"></div>Loading…</div></div>`;
  container.appendChild(card);

  const body = card.querySelector("#sub-body");
  const searchInput = card.querySelector("#sub-search");
  const filterSelect = card.querySelector("#sub-filter");
  const countEl = card.querySelector("#sub-count");

  let allSubscribers = [];

  function renderList() {
    const q = searchInput.value.trim().toLowerCase();
    const statusFilter = filterSelect.value;

    const filtered = allSubscribers.filter((s) => {
      if (statusFilter && s.status !== statusFilter) return false;
      if (q) {
        const haystack = `${s.firstName} ${s.lastName} ${s.email}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });

    countEl.textContent = `${filtered.length} of ${allSubscribers.length}`;

    if (!filtered.length) {
      body.innerHTML = `<div class="empty-state">No subscribers match your search.</div>`;
      return;
    }

    body.innerHTML = `
      <table class="table">
        <thead>
          <tr><th>Name</th><th>Email</th><th>Status</th><th>Source</th><th>Joined</th></tr>
        </thead>
        <tbody>
          ${filtered.map((s) => `
            <tr>
              <td><strong>${esc((s.firstName + " " + s.lastName).trim() || "—")}</strong></td>
              <td><a href="mailto:${esc(s.email)}">${esc(s.email)}</a></td>
              <td><span class="pill ${s.status === "active" ? "pill-published" : "pill-rejected"}">${esc(s.status)}</span></td>
              <td>${esc(s.source || "—")}</td>
              <td>${s.createdAt ? fmtRelative(s.createdAt) : "—"}</td>
            </tr>`).join("")}
        </tbody>
      </table>`;
  }

  try {
    const res = await ctx.authedFetch("/api/subscribers/list");
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
    allSubscribers = data.subscribers;
    renderList();
  } catch (err) {
    body.innerHTML = `<div class="error-state">Could not load subscribers: ${esc(err.message)}</div>`;
    return;
  }

  searchInput.addEventListener("input", renderList);
  filterSelect.addEventListener("change", renderList);
}

async function mountCollabs(ctx, container) {
  const card = el("div", { class: "card" });
  card.innerHTML = `
    <div class="card-header">
      <div>
        <div class="card-title">Collaboration requests</div>
        <div class="card-subtitle">People who have signed up to work with Catalyst.</div>
      </div>
    </div>
    <div class="card-body" id="collab-body"><div class="loading-state"><div class="spinner"></div>Loading…</div></div>`;
  container.appendChild(card);

  try {
    const res = await ctx.authedFetch("/api/subscribers/stats");
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
    const body = card.querySelector("#collab-body");
    const list = data.collaborations || [];
    if (!list.length) { body.innerHTML = `<div class="empty-state">No collaboration requests yet.</div>`; return; }

    body.innerHTML = `
      <table class="table">
        <thead>
          <tr><th>Name</th><th>Email</th><th>Interest</th><th>Message</th><th>Received</th></tr>
        </thead>
        <tbody>
          ${list.map((r) => `
            <tr>
              <td><strong>${esc(r.name)}</strong></td>
              <td><a href="mailto:${esc(r.email)}">${esc(r.email)}</a></td>
              <td>${esc(r.role || "—")}</td>
              <td style="max-width:420px;">${esc(r.message || "").slice(0, 240)}${r.message && r.message.length > 240 ? "…" : ""}</td>
              <td>${r.createdAt ? fmtRelative(r.createdAt) : "—"}</td>
            </tr>`).join("")}
        </tbody>
      </table>`;
  } catch (err) {
    card.querySelector("#collab-body").innerHTML = `<div class="error-state">${esc(err.message)}</div>`;
  }
}

// ─── Social Media Posts ──────────────────────────────────────────────────────

const FIRESTORE_PROJECT = "catalystwriters-5ce43";

// Fetch an image (via the same-origin proxy for other hosts) and re-encode
// it as JPEG; falls back to the original bytes if it can't be decoded.
async function fetchAsJpeg(src) {
  let url = src;
  try {
    const u = new URL(src, location.origin);
    if (u.origin !== location.origin) url = `/api/image-proxy?url=${encodeURIComponent(u.href)}`;
  } catch {}
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  if (blob.type === "image/jpeg") return blob;
  try {
    const bmp = await createImageBitmap(blob);
    const c = document.createElement("canvas");
    c.width = bmp.width; c.height = bmp.height;
    const g = c.getContext("2d");
    g.fillStyle = "#ffffff"; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(bmp, 0, 0);
    return await new Promise((r) => c.toBlob((b) => r(b || blob), "image/jpeg", 0.93));
  } catch { return blob; }
}
function saveBlob(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

const PLATFORM_META = {
  instagram: { label: "Instagram", icon: "IG", pill: "pill-reviewing" },
  linkedin:  { label: "LinkedIn",  icon: "IN", pill: "pill-approved"  },
  twitter:   { label: "Twitter",   icon: "TW", pill: "pill-pending"   },
  facebook:  { label: "Facebook",  icon: "FB", pill: "pill-draft"     },
};


// Shared Firestore value serialiser used by write helpers.
function toFsValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === "string") return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFsValue) } };
  if (typeof v === "object") {
    const out = {};
    for (const [k, val] of Object.entries(v)) out[k] = toFsValue(val);
    return { mapValue: { fields: out } };
  }
  return { stringValue: String(v) };
}
function toFsFields(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[k] = toFsValue(v);
  return out;
}

async function firestoreRunQuery(authedFetch, structuredQuery) {
  const res = await authedFetch(
    `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT}/databases/(default)/documents:runQuery`,
    { method: "POST", body: JSON.stringify({ structuredQuery }) }
  );
  if (!res.ok) throw new Error(`Firestore ${res.status}`);
  const rows = await res.json();
  return rows.filter((r) => r.document);
}

function fsStr(fields, k) { return fields[k]?.stringValue ?? ""; }

// Query helper for social_posts — returns structured post objects.
async function firestoreQuery(authedFetch, structuredQuery) {
  const docs = await firestoreRunQuery(authedFetch, structuredQuery);
  return docs.map((r) => {
    const f = r.document.fields || {};
    const str = (k) => fsStr(f, k);
    const arr = (k) => (f[k]?.arrayValue?.values || []).map((v) => {
      const m = v.mapValue?.fields || {};
      return { text: m.text?.stringValue ?? "", authorName: m.authorName?.stringValue ?? "", timestamp: m.timestamp?.stringValue ?? m.timestamp?.timestampValue ?? "" };
    });
    return {
      id: r.document.name.split("/").pop(),
      title: str("title"),
      platform: str("platform"),
      content: str("content"),
      notes: str("notes"),
      status: str("status"),
      proposerName: str("proposerName"),
      proposerId: str("proposerId"),
      assigneeName: str("assigneeName"),
      deadline: str("deadline"),
      createdAt: str("createdAt") || (f.createdAt?.timestampValue ?? ""),
      articleId: str("articleId"),
      articleSlug: str("articleSlug"),
      articleTitle: str("articleTitle"),
      coverImageUrl: str("coverImageUrl"),
      imageUrls: (f.imageUrls?.arrayValue?.values || []).map((v) => v.stringValue || "").filter(Boolean),
      bank: f.bank?.booleanValue === true,
      series: str("series"),
      boardType: str("boardType"),
      seriesNo: Number(f.seriesNo?.integerValue ?? f.seriesNo?.doubleValue ?? 0),
      backgroundId: str("backgroundId"),
      designJson: str("designJson"),
      studio: (() => {
        const m = f.studio?.mapValue?.fields;
        if (!m) return null;
        const v = (k) => m[k]?.stringValue ?? (m[k]?.integerValue != null ? Number(m[k].integerValue) : m[k]?.booleanValue);
        return { kicker: v("kicker") || "", headline: v("headline") || "", sub: v("sub") || "", align: v("align") || "left", size: v("size") || 84, brand: v("brand") !== false };
      })(),
      activity: arr("activity"),
    };
  });
}

// Query helper for stories/articles — returns article objects with all relevant fields.
// No select projection so we get every field stored on the document.
async function firestoreQueryArticles(authedFetch, structuredQuery) {
  const docs = await firestoreRunQuery(authedFetch, structuredQuery);
  return docs.map((r) => {
    const f = r.document.fields || {};
    const str = (k) => fsStr(f, k);
    // Log first doc's raw fields once so we can see the exact field names
    if (r === docs[0]) {
      console.log("[firestoreQueryArticles] raw fields on first doc:", Object.keys(f));
      console.log("[firestoreQueryArticles] coverImage field raw:", f.coverImage);
      console.log("[firestoreQueryArticles] image field raw:", f.image);
    }
    return {
      id: r.document.name.split("/").pop(),
      title: str("title"),
      authorName: str("authorName"),
      author: str("author"),
      coverImage: str("coverImage"),
      image: str("image"),
      slug: str("slug"),
      category: str("category"),
      deck: str("deck"),
      excerpt: str("excerpt"),
      publishedAt: str("publishedAt") || (f.publishedAt?.timestampValue ?? ""),
    };
  });
}

// Partial update: only the given fields change (a PATCH without an
// updateMask would replace the whole document).
async function firestoreWrite(authedFetch, path, fields) {
  const mask = Object.keys(fields).map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join("&");
  const res = await authedFetch(
    `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT}/databases/(default)/documents/${path}?${mask}`,
    { method: "PATCH", body: JSON.stringify({ fields: toFsFields(fields) }) }
  );
  if (!res.ok) throw new Error(`Firestore write failed ${res.status}: ${await res.text()}`);
  return res.json();
}

async function firestoreAdd(authedFetch, collection, fields) {
  const res = await authedFetch(
    `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT}/databases/(default)/documents/${collection}`,
    { method: "POST", body: JSON.stringify({ fields: toFsFields(fields) }) }
  );
  if (!res.ok) throw new Error(`Firestore add failed ${res.status}: ${await res.text()}`);
  const doc = await res.json();
  return doc.name ? doc.name.split("/").pop() : null;
}

// Fetch a single article's full `content` (HTML body) by its Firestore doc ID.
// Returns plain text with HTML tags stripped, or "" on failure.
// The story's body HTML, as stored (the carousel maker reads its headings,
// paragraphs and quotes).
async function firestoreGetArticleHtml(authedFetch, docId) {
  const res = await authedFetch(`https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT}/databases/(default)/documents/stories/${docId}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data.fields?.content?.stringValue || "";
}

async function mountSocialPosts(ctx, container) {
  // ── Page shell: tabbed — "Board" (kanban) and "Create" (inline generator) ──
  container.innerHTML = `
    <div class="sp-page">

      <header class="spb-hero">
        <div>
          <h2>Social media</h2>
          <p>Every post for Instagram, LinkedIn and X: design it in the Studio, then copy the caption and download the images when it's time to post.</p>
        </div>
        <div class="spb-hero-actions">
          <button type="button" class="btn btn-secondary btn-sm" id="sp-goto-create" title="Turn a published article into a carousel">Carousel from an article</button>
          <button type="button" class="btn btn-primary btn-sm" id="sp-new-design"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>Create a design</button>
        </div>
      </header>
      <div role="tablist" class="spb-tabs" aria-label="Social media">
        <button role="tab" id="sp-tab-board" class="sp-tab">Posts</button>
        <button role="tab" id="sp-tab-studio" class="sp-tab">Studio</button>
        <button role="tab" id="sp-tab-create" class="sp-tab">Article carousel</button>
      </div>

      <!-- BOARD VIEW -->
      <section id="sp-board-view" class="spb">
        <div class="spb-controls">
          <label class="spb-search">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
            <input type="search" id="sp-search" placeholder="Search posts and captions" aria-label="Search posts">
          </label>
          <div class="spb-seg" id="sp-platform-seg" role="group" aria-label="Platform">
            <button type="button" data-platform="" class="is-on">All</button>
            <button type="button" data-platform="instagram">Instagram</button>
            <button type="button" data-platform="linkedin">LinkedIn</button>
            <button type="button" data-platform="twitter">X</button>
          </div>
          <button type="button" class="spb-selbtn" id="sp-select" aria-pressed="false" title="Pick several posts to duplicate or delete them">Select</button>
          <div class="spb-seg spb-view" id="sp-view-seg" role="group" aria-label="View">
            <button type="button" data-view="grid" class="is-on">Grid</button>
            <button type="button" data-view="schedule">Schedule</button>
          </div>
          <select class="spb-sort" id="sp-sort" aria-label="Sort">
            <option value="due">Due date</option>
            <option value="new">Newest first</option>
            <option value="old">Oldest first</option>
          </select>
        </div>
        <div class="spb-status" id="sp-status-tabs" role="tablist" aria-label="Status"></div>
        <div class="spb-types" id="sp-type-row" role="group" aria-label="What the post is for"></div>
        <div class="spb-cover" id="sp-coverage" hidden></div>
        <div class="spb-bankbar" id="sp-bank-bar" hidden>
          <p>Ready-made posts for slow weeks. Open one, give it a date and move it to Drafts.</p>
          <div class="spb-seg" id="sp-series-seg" role="group" aria-label="Series"></div>
        </div>

        <!-- Newest drafts and who made them -->
        <div id="sp-recent" class="spb-recent" hidden></div>

        <!-- Suggestions: published articles that don't have a post yet -->
        <div id="sp-suggestions-wrap" class="spb-suggest" hidden>
          <div class="spb-suggest-head"><b>Needs a post</b><span id="sp-suggestions-count"></span></div>
          <div id="sp-suggestions-list" class="spb-suggest-list"></div>
        </div>

        <div class="spb-selbar" id="sp-selbar" role="region" aria-label="Selected posts" hidden></div>
        <div id="sp-list" class="spb-grid" aria-live="polite"><div class="loading-state"><div class="spinner"></div>Loading…</div></div>
      </section>

      <!-- STUDIO VIEW — the design editor (design-studio.js) -->
      <section id="sp-studio-view" class="sp-studio" style="display:none;"></section>

      <!-- ARTICLE CAROUSEL — carousel-maker.js -->
      <section id="sp-create-view" class="sp-create" style="display:none;"></section>

    </div>

    <style>
      .sp-tab.active { background: var(--surface) !important; color: var(--ink) !important; box-shadow: var(--shadow-sm); }
    </style>`;

  // ── Detail modal (for clicking a board card) ───────────────────────────────
  const detailModal = document.createElement("div");
  detailModal.className = "modal-backdrop";
  detailModal.id = "sp-detail-modal";
  detailModal.style.cssText = "display:none;";
  detailModal.innerHTML = `
    <div class="modal spd" role="dialog" aria-modal="true" aria-labelledby="sp-detail-title">
      <div class="modal-header">
        <div class="modal-title" id="sp-detail-title">Post</div>
        <button class="btn btn-ghost btn-sm" id="sp-detail-close" aria-label="Close" style="margin-left:auto;">✕</button>
      </div>
      <div class="modal-body" id="sp-detail-body"></div>
      <div class="modal-footer" id="sp-detail-footer"></div>
    </div>`;
  document.body.appendChild(detailModal);

  // ── Tab switching ──────────────────────────────────────────────────────────
  const tabBoard  = container.querySelector("#sp-tab-board");
  const tabCreate = container.querySelector("#sp-tab-create");
  const boardView  = container.querySelector("#sp-board-view");
  const createView = container.querySelector("#sp-create-view");

  const tabStudio = container.querySelector("#sp-tab-studio");
  const studioView = container.querySelector("#sp-studio-view");
  let studio = null;
  async function ensureStudio() {
    if (studio) return studio;
    const { mountDesignStudio } = await studioModule();
    studio = await mountDesignStudio(ctx, studioView, {
      onSaved: () => { boardStale = true; },
      onClose: () => { setActiveTab("board"); if (boardStale) { boardStale = false; loadPosts(); } },
      // New design → new draft on the board; re-saving an opened post updates it.
      savePost: async ({ id, copyOnFail, ...post }) => {
        if (id) {
          try {
            await firestoreWrite(ctx.authedFetch, `social_posts/${id}`, post);
            boardStale = true;
            return { id };
          } catch (err) {
            // Autosave never forks a post; an explicit save of someone else's
            // post (not allowed to edit it) saves a copy as a new draft.
            if (!copyOnFail) throw err;
            console.warn("[studio] update failed, saving a copy", err);
          }
        }
        const newId = await firestoreAdd(ctx.authedFetch, "social_posts", {
          ...post,
          status: "proposed",
          proposerId: ctx.user.uid,
          proposerName: ctx.profile.name || ctx.user.email,
          assigneeId: null,
          assigneeName: null,
          deadline: new Date(Date.now() + 3 * 86400000).toISOString().split("T")[0],
          createdAt: new Date().toISOString(),
          activity: [{ text: "designed in the Studio", authorName: ctx.profile.name || ctx.user.email, timestamp: new Date().toISOString() }],
        });
        boardStale = true;
        return { id: newId };
      },
    });
    return studio;
  }
  let boardStale = false;
  async function openInStudio(p) {
    setActiveTab("studio");
    const s = await ensureStudio();
    await s.open(p);
    s.refit?.();
  }
  async function openNewDesign() {
    setActiveTab("studio");
    const s = await ensureStudio();
    s.refit?.();
    await s.newDesign?.();
  }

  // The Studio is a full-screen editor; the other two views live in the page.
  function setActiveTab(which) {
    const tabs = { board: [tabBoard, boardView, "flex"], studio: [tabStudio, studioView, "block"], create: [tabCreate, createView, "block"] };
    for (const [k, [tab, view, disp]] of Object.entries(tabs)) {
      const on = k === which;
      tab.classList.toggle("active", on);
      tab.setAttribute("aria-selected", on ? "true" : "false");
      view.style.display   = on ? disp : "none";
    }
    studioView.classList.toggle("is-open", which === "studio");
    document.body.classList.toggle("ds-lock", which === "studio");
    if (which === "studio" && studio) requestAnimationFrame(() => studio.refit?.());
  }
  tabBoard.addEventListener("click",  () => setActiveTab("board"));
  tabStudio.addEventListener("click", async () => { setActiveTab("studio"); const s = await ensureStudio(); s.refit?.(); });
  tabCreate.addEventListener("click", () => { setActiveTab("create"); ensureCreateInitialized(); });
  container.querySelector("#sp-goto-create").addEventListener("click", () => { setActiveTab("create"); ensureCreateInitialized(); });
  container.querySelector("#sp-new-design").addEventListener("click", openNewDesign);
  // Leaving the page (another dashboard route) must not leave the body locked.
  window.addEventListener("hashchange", () => { if (!container.isConnected) document.body.classList.remove("ds-lock"); });

  // ── Cleanup: remove body-level modal when module unmounts ─────────────────
  const cleanup = () => {
    detailModal.remove();
  };

  // ── State ──────────────────────────────────────────────────────────────────
  let allPosts = [];
  let publishedArticles = [];

  const listEl = container.querySelector("#sp-list");
  const statusTabs = container.querySelector("#sp-status-tabs");
  const searchEl = container.querySelector("#sp-search");
  const sortEl = container.querySelector("#sp-sort");
  const suggestionsWrap = container.querySelector("#sp-suggestions-wrap");
  const suggestionsList = container.querySelector("#sp-suggestions-list");
  const suggestionsCount = container.querySelector("#sp-suggestions-count");
  const boardFilter = { platform: "", status: "", q: "", series: "", view: "grid", type: "", article: "" };
  const lead = canAssign(ctx), myUid = ctx.user?.uid;
  let scheduleWeek = 0, team = null;
  // Select mode: pick cards, then duplicate or delete them together.
  let selecting = false, visibleIds = [];
  const picked = new Set();
  const ensureTeam = async () => team || (team = await loadTeam((q) => firestoreRunQuery(ctx.authedFetch, q)).catch(() => []));
  const SERIES_LABEL = { "wacky-word": "Wacky Word Wednesday", "fun-fact": "Fun facts" };

  // True if `post` is plausibly about `article` — matches by stored
  // articleId when available, else by title substring (legacy posts).
  function postMatchesArticle(post, article) {
    if (!post || !article) return false;
    if (post.articleId && article.id && post.articleId === article.id) return true;
    if (post.articleSlug && article.slug && post.articleSlug === article.slug) return true;
    const at = (article.title || "").trim().toLowerCase();
    if (!at) return false;
    const haystack = `${post.title || ""} ${post.articleTitle || ""}`.toLowerCase();
    return haystack.includes(at);
  }

  // What a post is for. A post can pick its own (boardType); otherwise it's
  // worked out from its story link, series and title.
  const TYPES = [["article", "Articles"], ["recruit", "Recruitment"], ["fun", "Fun posts"], ["edition", "Editions"], ["other", "Other"]];
  const TYPE_LABEL = { article: "Article", recruit: "Recruitment", fun: "Fun post", edition: "Edition", other: "Other" };
  const STALE_DAYS = 20;
  function articleFor(p) { return publishedArticles.find((a) => postMatchesArticle(p, a)) || null; }
  function typeOf(p) {
    if (TYPE_LABEL[p.boardType]) return p.boardType;
    if (p.bank || p.series) return "fun";
    const t = `${p.title || ""} ${p.backgroundId || ""}`.toLowerCase();
    if (/wacky word|fun fact|brain teaser|did you know|myth vs fact/.test(t)) return "fun";
    if (/series-(join|pitch)|join the team|pitch us|recruit|writers wanted|hiring|join the catalyst|apply to/.test(t)) return "recruit";
    if (p.articleId || p.articleSlug || p.article) return "article";
    if (/edition|\bed-/.test(t)) return "edition";
    return "other";
  }
  // Drafts for a story published more than 20 days ago are too late to post;
  // they move to Archived (unless someone has been assigned to post them).
  function annotate() {
    const cutoff = Date.now() - STALE_DAYS * 86400000;
    for (const p of allPosts) {
      p.article = articleFor(p);
      p.type = typeOf(p);
      const t = Date.parse(p.article?.publishedAt || "");
      p.stale = !p.bank && Number.isFinite(t) && t < cutoff && p.status !== "posted" && !p.assign;
    }
  }

  // ── Board cards: a visual gallery ──────────────────────────────────────────
  const STATUS_LABEL = { proposed: "Draft", approved: "Approved", assigned: "Assigned", posted: "Posted", bank: "Bank" };
  const PLATFORM_ICON = {
    instagram: '<rect x="3.5" y="3.5" width="17" height="17" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.2" cy="6.8" r=".9" fill="currentColor" stroke="none"/>',
    linkedin: '<rect x="3.5" y="3.5" width="17" height="17" rx="3"/><path d="M8 10.5V16M8 7.6v.1M11.5 16v-3.3a2.2 2.2 0 0 1 4.4 0V16M11.5 10.5V16"/>',
    twitter: '<path d="M5 4.5 19 19.5M19 4.5 5 19.5"/>',
    facebook: '<path d="M14.5 8H16V4.8h-2.4A3.6 3.6 0 0 0 10 8.4V11H8v3h2v6.5h3V14h2.4l.6-3h-3V8.8a.8.8 0 0 1 .5-.8z"/>',
  };
  const platIcon = (pl) => `<svg viewBox="0 0 24 24" aria-hidden="true">${PLATFORM_ICON[pl] || PLATFORM_ICON.instagram}</svg>`;
  // "Instagram carousel (6 slides): Title" → "Title"
  const cleanTitle = (t) => String(t || "Untitled").replace(/^(instagram|linkedin|x|twitter|facebook)(\s+(carousel|story|post))?(\s*\([^)]*\))?\s*:\s*/i, "").replace(/\s*\(\d+-page carousel\)$/i, "").trim() || "Untitled";
  function designOf(p) { if (!p.designJson) return null; try { return JSON.parse(p.designJson); } catch { return null; } }
  function kindOf(p) {
    const d = designOf(p), n = d?.pages?.length || p.imageUrls?.length || 1;
    if (n > 1) return `Carousel · ${n} slides`;
    if (d?.format === "story" || /story/i.test(p.title || "")) return "Story";
    return "Post";
  }
  const isWide = (p) => { const f = designOf(p)?.format; return f === "linkedin" || f === "wide" || (!f && (p.platform === "linkedin" || p.platform === "twitter")); };
  // Frame shape for the card / detail preview, from the design's format.
  const shapeOf = (p) => { if (isWide(p)) return "wide"; const f = designOf(p)?.format; return f === "square" ? "square" : f === "story" ? "story" : f === "post" ? "portrait" : "other"; };
  function dueInfo(p) {
    if (!p.deadline) return { text: p.status === "posted" ? "Posted" : "No date set", cls: p.status === "posted" ? "is-done" : "is-none" };
    const [yy, mm, dd] = String(p.deadline).split("-").map(Number);
    const d = new Date(yy, (mm || 1) - 1, dd || 1);   // local midnight, so day maths is exact
    if (!yy || Number.isNaN(d.getTime())) return { text: p.deadline, cls: "" };
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const days = Math.round((d - today) / 86400000);
    const txt = d.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(d.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}) });
    if (p.status === "posted") return { text: `Posted ${txt}`, cls: "is-done" };
    if (days < 0) return { text: `Overdue ${txt}`, cls: "is-late" };
    if (days === 0) return { text: `Due today${p.postTime ? " · " + fmtTime(p.postTime) : ""}`, cls: "is-soon" };
    if (days <= 3) return { text: `Due ${txt}`, cls: "is-soon" };
    return { text: `Due ${txt}`, cls: "" };
  }
  function postCardHTML(p) {
    const due = p.bank ? { text: SERIES_LABEL[p.series] || "Ready anytime", cls: "is-series" } : dueInfo(p), st = p.bank ? "bank" : (p.status || "proposed");
    const live = !!designOf(p);
    const img = p.coverImageUrl || "";
    return `
      <article class="spc${selecting && picked.has(p.id) ? " is-picked" : ""}" data-id="${esc(p.id)}" tabindex="0" aria-label="${esc(cleanTitle(p.title))}"${selecting ? ` aria-pressed="${picked.has(p.id)}"` : ""}>
        <div class="spc-media is-${shapeOf(p)}">
          ${selecting ? `<span class="spc-check" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg></span>` : ""}
          ${live ? `<img alt="" data-live="${esc(p.id)}"${img ? ` src="${esc(img)}"` : ""}>` : img ? `<img alt="" src="${esc(img)}" loading="lazy">` : `<span class="spc-empty">${platIcon(p.platform)}<small>No image yet</small></span>`}
          ${/^Carousel/.test(kindOf(p)) ? `<span class="spc-kind" title="${esc(kindOf(p))}"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/></svg>${esc(kindOf(p).replace(/\D+/g, ""))}</span>` : ""}
          <div class="spc-hover">
            ${live || p.backgroundId ? `<button type="button" class="spc-act" data-card-act="studio">Edit</button>` : ""}
            <button type="button" class="spc-act" data-card-act="open">Details</button>
          </div>
        </div>
        <div class="spc-body">
          <h3 class="spc-title">${esc(cleanTitle(p.title))}</h3>
          <div class="spc-meta">
            <span class="spc-due ${due.cls}"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2.5"/><path d="M4 10h16M9 3v4M15 3v4"/></svg><span>${esc(due.text)}</span></span>
            <span class="spc-status is-${esc(st)}">${esc(STATUS_LABEL[st] || st)}</span>
          </div>
          ${p.bank ? "" : `<div class="spc-by">${avatar({ name: p.proposerName })}<span>${esc(creatorName(p.proposerName))}${p.createdAt ? ` · ${esc(fmtRelative(p.createdAt))}` : ""}</span><span class="spc-end">${p.owners?.length ? `<span class="spc-owners" title="Posting: ${esc(p.owners.map((o) => o.name).join(", "))}">${avatarStack(p.owners, 2)}</span>` : ""}<span class="spc-plat" title="${esc((PLATFORM_META[p.platform] || {}).label || "Instagram")}">${platIcon(p.platform)}</span></span></div>`}
        </div>
      </article>`;
  }

  // Live previews for Studio designs (always the latest saved layout).
  let _studioMod = null;
  const studioModule = () => _studioMod || (_studioMod = import("./design-studio.js?v=16"));
  const FORMAT_W = { post: 1080, square: 1080, story: 1080, linkedin: 1200, wide: 1600 };
  const liveCache = new Map();
  async function renderDesignImage(p, page = 0, width = 420, type = "image/jpeg") {
    const d = designOf(p); if (!d || !d.pages?.[page]) return null;
    const key = `${p.id}|${page}|${width}|${p.designJson.length}|${p.designJson.slice(-40)}`;
    if (liveCache.has(key)) return liveCache.get(key);
    const job = (async () => {
      const m = await studioModule();
      const c = await m.renderDesignPage(d, page, width / (FORMAT_W[d.format] || 1080));
      return c.toDataURL(type, 0.86);
    })().catch(() => null);
    liveCache.set(key, job);
    return job;
  }
  const liveQueue = [];
  let liveBusy = false;
  async function pumpLive() {
    if (liveBusy) return; liveBusy = true;
    while (liveQueue.length) {
      const img = liveQueue.shift();
      if (!img.isConnected) continue;
      const p = allPosts.find((x) => x.id === img.dataset.live);
      if (!p) continue;
      const url = await renderDesignImage(p);
      if (url && img.isConnected) img.src = url;
    }
    liveBusy = false;
  }
  const liveObserver = "IntersectionObserver" in window ? new IntersectionObserver((entries) => {
    for (const en of entries) if (en.isIntersecting) { liveObserver.unobserve(en.target); liveQueue.push(en.target); }
    pumpLive();
  }, { rootMargin: "300px" }) : null;

  // ── Render the board ───────────────────────────────────────────────────────
  function render() {
    const { platform: pf, status: sf } = boardFilter;
    const q = boardFilter.q.trim().toLowerCase();
    annotate();
    const searched = allPosts.filter((p) => (p.title || p.content || p.designJson || p.coverImageUrl || p.platform) && (!pf || p.platform === pf) && (!q || `${p.title} ${p.content} ${p.articleTitle}`.toLowerCase().includes(q)));
    // Type chips count everything that's live (not archived, not the bank).
    const typeCounts = {}; for (const p of searched) if (!p.bank && !p.stale) typeCounts[p.type] = (typeCounts[p.type] || 0) + 1;
    renderTypeRow(typeCounts);
    const tf = boardFilter.type, af = boardFilter.article;
    const matching = searched.filter((p) => (!tf || (p.bank ? tf === "fun" : p.type === tf)) && (!af || p.article?.id === af));
    // Bank posts (ready-made, undated) live in their own tab; drafts for old
    // stories in Archived.
    const base = matching.filter((p) => !p.bank && !p.stale);
    const bank = matching.filter((p) => p.bank);
    const archived = matching.filter((p) => p.stale);
    const counts = { "": base.length, bank: bank.length, archived: archived.length };
    for (const p of base) counts[p.status || "proposed"] = (counts[p.status || "proposed"] || 0) + 1;
    const isMine = (p) => p.status !== "posted" && p.owners?.some((o) => o.id === myUid);
    counts.mine = base.filter(isMine).length;
    statusTabs.innerHTML = [["", "All"], ...(counts.mine || sf === "mine" ? [["mine", "For me"]] : []), ["proposed", "Drafts"], ["approved", "Approved"], ["assigned", "Assigned"], ["posted", "Posted"], ...(counts.archived || sf === "archived" ? [["archived", "Archived"]] : []), ["bank", "Post bank"]]
      .map(([k, label]) => `<button type="button" role="tab" data-status="${k}" class="${sf === k ? "is-on" : ""}${k === "bank" ? " is-bank" : ""}" aria-selected="${sf === k}"${k === "archived" ? ` title="Drafts for stories published more than ${STALE_DAYS} days ago: too late to post"` : ""}>${label}<span>${counts[k] || 0}</span></button>`).join("");
    const bankBar = container.querySelector("#sp-bank-bar");
    bankBar.hidden = sf !== "bank";
    if (sf === "bank") {
      const sc = {}; for (const p of bank) sc[p.series || "other"] = (sc[p.series || "other"] || 0) + 1;
      container.querySelector("#sp-series-seg").innerHTML = [["", "All"], ...Object.keys(sc).map((k) => [k, SERIES_LABEL[k] || "Other"])]
        .map(([k, label]) => `<button type="button" data-series="${k}" class="${boardFilter.series === k ? "is-on" : ""}">${label} <small>${k ? sc[k] : bank.length}</small></button>`).join("");
    }

    const sort = sortEl.value;
    const pool = sf === "bank" ? bank.filter((p) => !boardFilter.series || p.series === boardFilter.series)
      : sf === "archived" ? archived
      : base.filter((p) => !sf || (sf === "mine" ? isMine(p) : (p.status || "proposed") === sf));
    const list = pool.sort((a, b) => {
      if (sf === "bank" && sort === "due") return (a.series || "").localeCompare(b.series || "") || (a.seriesNo - b.seriesNo);
      if (sort === "new") return String(b.createdAt).localeCompare(String(a.createdAt));
      if (sort === "old") return String(a.createdAt).localeCompare(String(b.createdAt));
      const empty = (x) => (!x.title && !x.content && !x.coverImageUrl && !x.designJson ? 1 : 0);
      if (empty(a) !== empty(b)) return empty(a) - empty(b);
      const pa = a.status === "posted" ? 1 : 0, pb = b.status === "posted" ? 1 : 0;
      if (pa !== pb) return pa - pb;
      return (a.deadline || "9999").localeCompare(b.deadline || "9999") || String(b.createdAt).localeCompare(String(a.createdAt));
    });

    const schedule = boardFilter.view === "schedule" && sf !== "bank";
    listEl.className = schedule ? "sps" : `spb-grid${selecting ? " is-selecting" : ""}`;
    if (schedule && selecting) setSelecting(false, { quiet: true });
    container.querySelector("#sp-select").hidden = schedule;
    sortEl.hidden = schedule;
    renderRecent(base, sf, q || tf || af, schedule);
    renderCoverage(sf, schedule);
    if (schedule) {
      for (const p of pool) { p.cleanTitle = cleanTitle(p.title); }
      listEl.innerHTML = scheduleHTML(pool, scheduleWeek, {
        myUid,
        thumb: (p) => (designOf(p) ? `<img alt="" data-live="${esc(p.id)}"${p.coverImageUrl ? ` src="${esc(p.coverImageUrl)}"` : ""}>` : p.coverImageUrl ? `<img alt="" src="${esc(p.coverImageUrl)}" loading="lazy">` : `<span class="sps-ph">${platIcon(p.platform)}</span>`),
      });
      listEl.querySelectorAll("img[data-live]").forEach((img) => (liveObserver ? liveObserver.observe(img) : liveQueue.push(img)));
      if (!liveObserver) pumpLive();
    } else if (!allPosts.length) {
      listEl.innerHTML = `<div class="spb-empty"><b>No posts yet</b><p>Create a design in the Studio, or turn a published article into a carousel.</p><button type="button" class="btn btn-primary btn-sm" data-empty-new>Create a design</button></div>`;
      listEl.querySelector("[data-empty-new]").addEventListener("click", openNewDesign);
    } else if (!list.length) {
      listEl.innerHTML = `<div class="spb-empty"><b>Nothing matches</b><p>Try another filter or clear the search.</p></div>`;
    } else {
      visibleIds = list.map((p) => p.id);
      listEl.innerHTML = list.map(postCardHTML).join("");
      listEl.querySelectorAll("img[data-live]").forEach((img) => (liveObserver ? liveObserver.observe(img) : liveQueue.push(img)));
      if (!liveObserver) pumpLive();
    }
    if (tf === "article" || af) suggestionsWrap.hidden = true; else renderSuggestions();
  }

  // Type chips: Articles · Recruitment · Fun posts · Editions · Other.
  const typeRow = container.querySelector("#sp-type-row");
  function renderTypeRow(counts) {
    const af = boardFilter.article && publishedArticles.find((a) => a.id === boardFilter.article);
    typeRow.innerHTML = `<span class="spb-types-label">Show</span>` +
      [["", "Everything"], ...TYPES].map(([k, label]) => `<button type="button" data-type="${k}" class="${boardFilter.type === k ? "is-on" : ""}" aria-pressed="${boardFilter.type === k}">${label}${k ? `<small>${counts[k] || 0}</small>` : ""}</button>`).join("") +
      (af ? `<span class="spb-artfilter">Posts for <b>${esc(af.title)}</b><button type="button" data-clear-article aria-label="Show all posts">×</button></span>` : "");
  }
  typeRow.addEventListener("click", (e) => {
    if (e.target.closest("[data-clear-article]")) { boardFilter.article = ""; render(); return; }
    const b = e.target.closest("[data-type]"); if (!b) return;
    boardFilter.type = b.dataset.type; boardFilter.article = "";
    if (boardFilter.status === "bank" && b.dataset.type !== "fun" && b.dataset.type) boardFilter.status = "";
    render();
  });

  // Articles: has each recent story got a post yet?
  const coverEl = container.querySelector("#sp-coverage");
  function renderCoverage(sf, schedule) {
    const show = boardFilter.type === "article" && !boardFilter.article && !schedule && sf !== "bank" && publishedArticles.length;
    coverEl.hidden = !show;
    if (!show) return;
    const now = Date.now(), cutoff = now - STALE_DAYS * 86400000;
    const list = publishedArticles.filter((a) => Date.parse(a.publishedAt || "") >= now - 60 * 86400000)
      .sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt))).slice(0, 12);
    coverEl.innerHTML = `<div class="spb-cover-head"><b>Stories from the last 60 days</b><span>Has each one got a post? Stories older than ${STALE_DAYS} days are too late to promote.</span></div>
      <ul class="spb-cover-list">${list.map((a) => {
        const posts = allPosts.filter((p) => !p.bank && postMatchesArticle(p, a));
        const posted = posts.filter((p) => p.status === "posted").length;
        const fresh = Date.parse(a.publishedAt || "") >= cutoff;
        const state = posted ? ["is-done", `Posted${posted > 1 ? ` · ${posted}` : ""}`] : posts.length ? ["is-draft", `${posts.length} draft${posts.length === 1 ? "" : "s"}`] : fresh ? ["is-none", "No post yet"] : ["is-late", "No post · too late"];
        const d = new Date(a.publishedAt);
        return `<li class="spb-cover-row${fresh ? "" : " is-old"}">
          ${a.coverImage || a.image ? `<img src="${esc(a.coverImage || a.image)}" alt="" loading="lazy">` : `<span class="spb-cover-ph"></span>`}
          <span class="spb-cover-txt"><b>${esc(a.title)}</b><small>${esc([a.authorName || a.author, Number.isFinite(+d) ? d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) : ""].filter(Boolean).join(" · "))}</small></span>
          <span class="spb-cover-state ${state[0]}">${state[1]}</span>
          ${posts.length ? `<button type="button" class="btn btn-ghost btn-sm" data-cover-view="${esc(a.id)}">See posts</button>` : ""}
          ${fresh ? `<button type="button" class="btn btn-secondary btn-sm" data-cover-make="${esc(a.id)}">${posts.length ? "Another" : "Make a post"}</button>` : ""}
        </li>`;
      }).join("") || `<li class="spb-cover-empty">No stories published in the last 60 days.</li>`}</ul>`;
  }
  coverEl.addEventListener("click", (e) => {
    const v = e.target.closest("[data-cover-view]");
    if (v) { boardFilter.article = v.dataset.coverView; boardFilter.status = ""; render(); return; }
    const m = e.target.closest("[data-cover-make]");
    if (m) startCreateForArticleId(m.dataset.coverMake);
  });
  // The newest drafts, with who made them, so nothing new slips by.
  const recentEl = container.querySelector("#sp-recent");
  function renderRecent(base, sf, q, schedule) {
    const since = Date.now() - 14 * 86400000;
    const list = (sf === "" || sf === "proposed") && !q && !schedule
      ? base.filter((p) => Date.parse(p.createdAt || "") >= since).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 8) : [];
    recentEl.hidden = !list.length;
    if (!list.length) return;
    recentEl.innerHTML = `<div class="spb-recent-head"><b>Just added</b><span>${list.length === 1 ? "The newest draft" : `The ${list.length} newest drafts`} and who made them</span></div>
      <div class="spb-recent-list">${list.map((p) => `
        <button type="button" class="spb-recent-item" data-open="${esc(p.id)}">
          <span class="spb-recent-img">${designOf(p) ? `<img alt="" data-live="${esc(p.id)}"${p.coverImageUrl ? ` src="${esc(p.coverImageUrl)}"` : ""}>` : p.coverImageUrl ? `<img alt="" src="${esc(p.coverImageUrl)}" loading="lazy">` : platIcon(p.platform)}</span>
          <span class="spb-recent-txt"><b>${esc(cleanTitle(p.title))}</b><small>${avatar({ name: p.proposerName })}<span>${esc(p.platform && p.platform !== "instagram" ? ((PLATFORM_META[p.platform] || {}).label || p.platform) : kindOf(p).split(" · ")[0])} · ${esc(creatorName(p.proposerName))} · ${esc(fmtRelative(p.createdAt))}</span></small></span>
        </button>`).join("")}</div>`;
    recentEl.querySelectorAll("img[data-live]").forEach((img) => (liveObserver ? liveObserver.observe(img) : liveQueue.push(img)));
    if (!liveObserver) pumpLive();
  }
  recentEl.addEventListener("click", (e) => { const b = e.target.closest("[data-open]"); if (b) openDetail(allPosts.find((x) => x.id === b.dataset.open)); });
  container.querySelector("#sp-view-seg").addEventListener("click", (e) => {
    const b = e.target.closest("[data-view]"); if (!b) return;
    boardFilter.view = b.dataset.view;
    container.querySelectorAll("#sp-view-seg button").forEach((x) => x.classList.toggle("is-on", x === b));
    try { localStorage.setItem("catalyst.social.view", boardFilter.view); } catch {}
    render();
  });
  try { const v = localStorage.getItem("catalyst.social.view"); if (v === "schedule") { boardFilter.view = v; container.querySelectorAll("#sp-view-seg button").forEach((x) => x.classList.toggle("is-on", x.dataset.view === v)); } } catch {}
  listEl.addEventListener("click", (e) => {
    const wk = e.target.closest("[data-week]");
    if (wk) { scheduleWeek = Number(wk.dataset.week) === 0 ? 0 : scheduleWeek + Number(wk.dataset.week); render(); return; }
    const open = e.target.closest("[data-open]");
    if (open) { openDetail(allPosts.find((x) => x.id === open.dataset.open)); return; }
    const card = e.target.closest(".spc"); if (!card) return;
    if (selecting) { togglePick(card.dataset.id); return; }
    const p = allPosts.find((x) => x.id === card.dataset.id); if (!p) return;
    const act = e.target.closest("[data-card-act]")?.dataset.cardAct;
    if (act === "studio") return openInStudio(p);
    openDetail(p);
  });
  listEl.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const card = e.target.closest(".spc"); if (!card || e.target !== card) return;
    e.preventDefault();
    if (selecting) togglePick(card.dataset.id); else openDetail(allPosts.find((x) => x.id === card.dataset.id));
  });
  statusTabs.addEventListener("click", (e) => { const b = e.target.closest("[data-status]"); if (!b) return; boardFilter.status = b.dataset.status; boardFilter.series = ""; render(); });
  container.querySelector("#sp-series-seg").addEventListener("click", (e) => { const b = e.target.closest("[data-series]"); if (!b) return; boardFilter.series = b.dataset.series; render(); });
  container.querySelector("#sp-platform-seg").addEventListener("click", (e) => {
    const b = e.target.closest("[data-platform]"); if (!b) return;
    boardFilter.platform = b.dataset.platform;
    container.querySelectorAll("#sp-platform-seg button").forEach((x) => x.classList.toggle("is-on", x === b));
    render();
  });
  let searchT = 0;
  searchEl.addEventListener("input", () => { clearTimeout(searchT); searchT = setTimeout(() => { boardFilter.q = searchEl.value; render(); }, 120); });
  sortEl.addEventListener("change", render);

  const selBtn = container.querySelector("#sp-select"), selBar = container.querySelector("#sp-selbar");
  const canDeletePost = (p) => ctx.role === "admin" || p.proposerId === myUid;
  function setSelecting(on, { quiet = false } = {}) {
    selecting = on; picked.clear();
    selBtn.setAttribute("aria-pressed", String(on)); selBtn.classList.toggle("is-on", on);
    selBtn.textContent = on ? "Done" : "Select";
    paintSelBar();
    if (!quiet) render();
  }
  function togglePick(id) {
    picked.has(id) ? picked.delete(id) : picked.add(id);
    const card = listEl.querySelector(`.spc[data-id="${CSS.escape(id)}"]`);
    if (card) { card.classList.toggle("is-picked", picked.has(id)); card.setAttribute("aria-pressed", String(picked.has(id))); }
    paintSelBar();
  }
  function paintSelBar() {
    selBar.hidden = !selecting;
    if (!selecting) { selBar.innerHTML = ""; return; }
    const n = picked.size;
    const allOn = visibleIds.length && visibleIds.every((id) => picked.has(id));
    selBar.innerHTML = `
      <b>${n ? `${n} selected` : "Click posts to select them"}</b>
      <button type="button" class="btn btn-ghost btn-sm" data-sel="all">${allOn ? "Clear" : `Select all ${visibleIds.length}`}</button>
      <span class="spb-selbar-spacer"></span>
      <button type="button" class="btn btn-secondary btn-sm" data-sel="dup" ${n ? "" : "disabled"}>Duplicate</button>
      <button type="button" class="btn btn-danger btn-sm" data-sel="del" ${n ? "" : "disabled"}>Delete</button>
      <button type="button" class="btn btn-ghost btn-sm" data-sel="done">Done</button>`;
  }
  selBtn.addEventListener("click", () => setSelecting(!selecting));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && selecting && container.isConnected && detailModal.style.display !== "grid" && !document.querySelector("#modal-root .modal-backdrop")) setSelecting(false);
  });
  selBar.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-sel]"); if (!b || b.disabled) return;
    const act = b.dataset.sel;
    if (act === "done") return setSelecting(false);
    if (act === "all") {
      const allOn = visibleIds.every((id) => picked.has(id));
      visibleIds.forEach((id) => (allOn ? picked.delete(id) : picked.add(id)));
      listEl.querySelectorAll(".spc").forEach((c) => { const on = picked.has(c.dataset.id); c.classList.toggle("is-picked", on); c.setAttribute("aria-pressed", String(on)); });
      return paintSelBar();
    }
    const posts = [...picked].map((id) => allPosts.find((x) => x.id === id)).filter(Boolean);
    if (act === "del") {
      const mine = posts.filter(canDeletePost), theirs = posts.length - mine.length;
      if (!mine.length) { ctx.toast("You can only delete posts you made.", "error"); return; }
      const ok = await confirmDialog(`Delete ${mine.length} post${mine.length === 1 ? "" : "s"}? This can't be undone.${theirs ? ` (${theirs} made by someone else will be skipped.)` : ""}`, { confirmText: "Delete", danger: true });
      if (!ok) return;
      b.disabled = true;
      let done = 0, failed = 0;
      for (const p of mine) {
        try {
          const res = await ctx.authedFetch(`https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT}/databases/(default)/documents/social_posts/${p.id}`, { method: "DELETE" });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          done++;
        } catch { failed++; }
      }
      ctx.toast(failed ? `Deleted ${done}; ${failed} couldn't be deleted.` : `Deleted ${done} post${done === 1 ? "" : "s"}.`, failed ? "error" : "success");
      setSelecting(false, { quiet: true }); await loadPosts();
    }
    if (act === "dup") {
      b.disabled = true;
      let done = 0;
      const now = new Date().toISOString(), me = ctx.profile?.name || ctx.user?.email || "";
      for (const p of posts) {
        try {
          await firestoreAdd(ctx.authedFetch, "social_posts", {
            title: p.title ? `${p.title} (copy)` : "Copy", platform: p.platform || "instagram", content: p.content || "", notes: p.notes || "",
            designJson: p.designJson || "", coverImageUrl: p.coverImageUrl || "", imageUrls: p.imageUrls || [],
            articleId: p.articleId || "", articleSlug: p.articleSlug || "", articleTitle: p.articleTitle || "",
            backgroundId: p.backgroundId || "", boardType: p.boardType || "", ...(p.studio ? { studio: p.studio } : {}),
            status: "proposed", deadline: "", proposerId: myUid, proposerName: me, assigneeId: null, assigneeName: null,
            createdAt: now, activity: [{ text: `duplicated from "${cleanTitle(p.title)}"`, authorName: me, timestamp: now }],
          });
          done++;
        } catch (err) { console.warn("[social] duplicate", err); }
      }
      ctx.toast(`Made ${done} cop${done === 1 ? "y" : "ies"}. ${done === 1 ? "It's" : "They're"} in Drafts.`, done ? "success" : "error");
      setSelecting(false, { quiet: true }); await loadPosts();
    }
  });

  // Suggestions: published articles from the last 30 days that don't yet have
  // any matching post on the board. Click → switches to Create tab with the
  // article pre-selected.
  function renderSuggestions() {
    if (!publishedArticles.length) { suggestionsWrap.hidden = true; return; }
    // Only stories published in the last 20 days: after that it's too late
    // to promote them. Stories without a publish date aren't suggested.
    const cutoff = Date.now() - 20 * 86400000;
    const recent = publishedArticles.filter((a) => {
      const t = Date.parse(a.publishedAt || "");
      return Number.isFinite(t) && t >= cutoff;
    });
    const needsPost = recent.filter((a) => !allPosts.some((p) => postMatchesArticle(p, a)));
    if (!needsPost.length) { suggestionsWrap.hidden = true; return; }
    suggestionsWrap.hidden = false;
    suggestionsCount.textContent = `${needsPost.length} published ${needsPost.length === 1 ? "story" : "stories"} without a post`;
    suggestionsList.innerHTML = needsPost.slice(0, 8).map((a) => {
      const cover = a.coverImage || a.image || "";
      return `<button type="button" class="spb-chip" data-article-id="${esc(a.id)}" title="Make a carousel for this story">
        ${cover ? `<img src="${esc(cover)}" alt="" loading="lazy">` : `<span class="spb-chip-ph"></span>`}
        <span>${esc(a.title)}</span><b>Make a post</b></button>`;
    }).join("");
    suggestionsList.querySelectorAll("[data-article-id]").forEach((b) => b.addEventListener("click", () => startCreateForArticleId(b.dataset.articleId)));
  }

  // Switch to the Create tab and preselect the article (initializing the
  // Create view first if it has never been opened in this session).
  async function startCreateForArticleId(articleId) {
    setActiveTab("create");
    const m = await ensureCreateInitialized();
    return m.selectArticle(articleId);
  }

  // ── Load posts ─────────────────────────────────────────────────────────────
  let deepLinked = false;
  async function loadPosts() {
    listEl.innerHTML = `<div class="loading-state"><div class="spinner"></div>Loading…</div>`;
    try {
      const [posts, assigns] = await Promise.all([
        firestoreQuery(ctx.authedFetch, {
          from: [{ collectionId: "social_posts" }],
          orderBy: [{ field: { fieldPath: "createdAt" }, direction: "DESCENDING" }],
          limit: 400,
        }),
        loadAssignments((q) => firestoreRunQuery(ctx.authedFetch, q)).catch((err) => { console.warn("[social] assignments", err); return []; }),
      ]);
      allPosts = posts;
      for (const p of allPosts) { p.cleanTitle = cleanTitle(p.title); p.kind = kindOf(p); }
      applyPlan(allPosts, assigns);
      render();
      // Deep link from an assignment email: #/marketing/social?post=<id>
      const want = new URLSearchParams(location.hash.split("?")[1] || "").get("post");
      if (want && !deepLinked) { deepLinked = true; const hit = allPosts.find((x) => x.id === want); if (hit) openDetail(hit); }
    } catch (err) {
      listEl.innerHTML = `<div class="error-state">Could not load posts: ${esc(err.message)}</div>`;
    }
  }

  // ── Load published articles for the generator dropdown ─────────────────────
  // Book reviews are deliberately excluded — the social post composer is
  // for editorial articles only. Reviews have their own promo flow on
  // the /book-reviews page and don't fit the article-card carousel format.
  async function loadArticles() {
    try {
      const all = await firestoreQueryArticles(ctx.authedFetch, {
        from: [{ collectionId: "stories" }],
        where: { fieldFilter: { field: { fieldPath: "status" }, op: "EQUAL", value: { stringValue: "published" } } },
        orderBy: [{ field: { fieldPath: "publishedAt" }, direction: "DESCENDING" }],
        limit: 60,
      });
      publishedArticles = (all || []).filter((a) => {
        const cat = String(a?.category || "").toLowerCase().replace(/\s+/g, "-");
        return cat !== "book-review" && cat !== "bookreview";
      });
      console.log("[loadArticles] loaded", publishedArticles.length, "articles (book reviews filtered out). First article coverImage:", publishedArticles[0]?.coverImage, "image:", publishedArticles[0]?.image);
    } catch (err) {
      console.error("[loadArticles] error:", err);
      publishedArticles = [];
    }
  }

  // ── Detail modal ───────────────────────────────────────────────────────────
  const closeDetail = () => { detailModal.style.display = "none"; document.removeEventListener("keydown", detailKeys); };
  function detailKeys(e) {
    if (e.key === "Escape") { e.stopPropagation(); closeDetail(); }
    else if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || "")) detailModal.querySelector(e.key === "ArrowLeft" ? "[data-slide-prev]" : "[data-slide-next]")?.click();
  }
  detailModal.querySelector("#sp-detail-close").addEventListener("click", closeDetail);
  detailModal.addEventListener("click", (e) => { if (e.target === detailModal) closeDetail(); });

  function openDetail(p) {
    if (!p) return;
    const pm = PLATFORM_META[p.platform] || { label: p.platform || "Instagram" };
    const st = p.bank ? "bank" : (p.status || "proposed");
    const design = designOf(p);
    const nSlides = design?.pages?.length || p.imageUrls?.length || (p.coverImageUrl ? 1 : 0);
    const staticImgs = p.imageUrls && p.imageUrls.length ? p.imageUrls : (p.coverImageUrl ? [p.coverImageUrl] : []);
    const canEdit = !!(design || p.backgroundId);
    const canStatus = ["admin", "editor"].includes(ctx.role);
    const canDelete = ctx.role === "admin" || p.proposerId === ctx.user?.uid;
    detailModal.querySelector("#sp-detail-title").textContent = cleanTitle(p.title);

    detailModal.querySelector("#sp-detail-body").innerHTML = `
      <div class="spd-grid">
        <div class="spd-preview">
          <div class="spd-stage is-${shapeOf(p)}">
            ${nSlides ? `<img id="spd-img" alt="Slide 1 of ${nSlides}">` : `<div class="spd-noimg">${platIcon(p.platform)}<span>No image on this post yet${canEdit ? "" : ". Design one in the Studio"}.</span></div>`}
            ${nSlides > 1 ? `<button type="button" class="spd-nav is-prev" data-slide-prev aria-label="Previous slide">‹</button><button type="button" class="spd-nav is-next" data-slide-next aria-label="Next slide">›</button><span class="spd-count" id="spd-count">1 / ${nSlides}</span>` : ""}
          </div>
          ${nSlides > 1 ? `<div class="spd-strip is-${shapeOf(p)}">${Array.from({ length: nSlides }, (_, i) => `<button type="button" data-slide="${i}" class="${i === 0 ? "is-on" : ""}" aria-label="Slide ${i + 1}"><img alt="" data-thumb="${i}"><span>${i + 1}</span></button>`).join("")}</div>` : ""}
        </div>
        <div class="spd-side">
          <div class="spd-chips">
            <span class="spd-chip">${platIcon(p.platform)}${esc(pm.label)}</span>
            <span class="spc-status is-${esc(st)}">${esc(STATUS_LABEL[st] || st)}</span>
            <span class="spd-chip">${esc(kindOf(p))}</span>
            ${p.bank ? "" : `<label class="spd-type"><span class="sr-only">What it's for</span><select id="spd-type" aria-label="What it's for" title="What this post is for (sorts it on the board)">${TYPES.map(([k]) => `<option value="${k}"${(p.type || typeOf(p)) === k ? " selected" : ""}>${TYPE_LABEL[k]}</option>`).join("")}</select></label>`}
          </div>
          ${p.bank ? `<label class="spd-label" for="spd-due">Post on</label>
          <div class="spd-due"><input type="date" id="spd-due" value="${esc(p.deadline || "")}"><span id="spd-due-status"></span></div>` : `<div id="spd-plan" class="spd-plan"><div class="loading-state"><div class="spinner"></div></div></div>`}
          <div class="spd-labelrow"><label class="spd-label" for="sp-detail-caption">Caption</label><span id="sp-detail-caption-status"></span></div>
          <textarea id="sp-detail-caption" class="input textarea spd-caption" rows="9">${esc(p.content || "")}</textarea>
          <div class="spd-capactions">
            <button type="button" class="btn btn-secondary btn-sm" id="spd-copy">Copy caption</button>
            <button type="button" class="btn btn-secondary btn-sm" id="spd-save-cap" disabled>Save caption</button>
            <span class="spd-capcount" id="spd-capcount"></span>
          </div>
          ${p.notes ? `<details class="spd-notes"><summary>Notes</summary><pre>${esc(p.notes)}</pre></details>` : ""}
          <div class="spd-by">By <strong>${esc(p.proposerName || "—")}</strong>${p.createdAt ? ` · ${fmtRelative(p.createdAt)}` : ""}${p.articleSlug ? ` · <a href="/article/${esc(p.articleSlug)}" target="_blank" rel="noopener">Story</a>` : ""}</div>
        </div>
      </div>`;

    // Slides: Studio designs render live (always the latest layout).
    let cur = 0;
    const bigImg = detailModal.querySelector("#spd-img");
    const slideSrc = async (i, width) => (design ? await renderDesignImage(p, i, width) : staticImgs[i] || staticImgs[0]);
    async function show(i) {
      if (!bigImg) return;
      cur = (i + nSlides) % nSlides;
      bigImg.alt = `Slide ${cur + 1} of ${nSlides}`;
      const src = await slideSrc(cur, 900);
      if (src) bigImg.src = src;
      detailModal.querySelectorAll("[data-slide]").forEach((b) => b.classList.toggle("is-on", Number(b.dataset.slide) === cur));
      const c = detailModal.querySelector("#spd-count"); if (c) c.textContent = `${cur + 1} / ${nSlides}`;
    }
    show(0);
    (async () => { for (let i = 0; i < nSlides && nSlides > 1; i++) { const t = detailModal.querySelector(`[data-thumb="${i}"]`); const src = await slideSrc(i, 160); if (t && src) t.src = src; } })();
    detailModal.querySelector("[data-slide-prev]")?.addEventListener("click", () => show(cur - 1));
    detailModal.querySelector("[data-slide-next]")?.addEventListener("click", () => show(cur + 1));
    detailModal.querySelectorAll("[data-slide]").forEach((b) => b.addEventListener("click", () => show(Number(b.dataset.slide))));

    // What it's for (sorts it under Articles / Recruitment / Fun posts …).
    detailModal.querySelector("#spd-type")?.addEventListener("change", async (e) => {
      const v = e.target.value, prev = p.boardType;
      p.boardType = v; render();
      try { await firestoreWrite(ctx.authedFetch, `social_posts/${p.id}`, { boardType: v }); ctx.toast(`Filed under ${TYPES.find(([k]) => k === v)[1]}.`, "success"); }
      catch (err) { p.boardType = prev; render(); ctx.toast("Only the person who made this post (or an editor) can change that: " + err.message, "error"); }
    });

    // Who posts it, and when (social-plan.js). Bank posts just keep a date
    // for when they move to the drafts.
    const dueEl = detailModal.querySelector("#spd-due");
    const planEl = detailModal.querySelector("#spd-plan");
    if (planEl) {
      ensureTeam().then((t) => {
        if (!planEl.isConnected) return;
        mountPlan(planEl, {
          p, ctx, team: t, lead,
          api: {
            write: (path, fields) => firestoreWrite(ctx.authedFetch, path, fields),
            add: (col, fields) => firestoreAdd(ctx.authedFetch, col, fields),
            del: async (path) => { const r = await ctx.authedFetch(`https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT}/databases/(default)/documents/${path}`, { method: "DELETE" }); if (!r.ok) throw new Error(`HTTP ${r.status}`); },
            notify: (id) => ctx.authedFetch("/api/notify/assignment", { method: "POST", body: JSON.stringify({ assignmentId: id }) }).catch((err) => console.warn("[social] notify", err)),
            writePost: (fields) => firestoreWrite(ctx.authedFetch, `social_posts/${p.id}`, fields),
          },
          onChange: async () => { closeDetail(); await loadPosts(); const again = allPosts.find((x) => x.id === p.id); if (again) openDetail(again); },
        });
      });
    }

    // Caption
    const captionEl = detailModal.querySelector("#sp-detail-caption");
    const captionStatus = detailModal.querySelector("#sp-detail-caption-status");
    const saveCaptionBtn = detailModal.querySelector("#spd-save-cap");
    const capCount = detailModal.querySelector("#spd-capcount");
    const LIMIT = { instagram: 2200, linkedin: 3000, twitter: 280, facebook: 63206 };
    const countCap = () => { const lim = LIMIT[p.platform] || 2200; capCount.textContent = `${captionEl.value.length.toLocaleString()} / ${lim.toLocaleString()}`; capCount.classList.toggle("is-over", captionEl.value.length > lim); };
    countCap();
    detailModal.querySelector("#spd-copy").addEventListener("click", (e) => {
      navigator.clipboard.writeText(captionEl.value || "").then(() => { e.target.textContent = "Copied"; setTimeout(() => { e.target.textContent = "Copy caption"; }, 1600); });
    });
    captionEl.addEventListener("input", () => {
      const dirty = captionEl.value !== (p.content || "");
      saveCaptionBtn.disabled = !dirty;
      captionStatus.textContent = dirty ? "Unsaved changes" : "";
      countCap();
    });
    saveCaptionBtn.addEventListener("click", async () => {
      saveCaptionBtn.disabled = true; saveCaptionBtn.textContent = "Saving…";
      try {
        await firestoreWrite(ctx.authedFetch, `social_posts/${p.id}`, { content: captionEl.value });
        p.content = captionEl.value;
        captionStatus.textContent = "Saved";
        setTimeout(() => { captionStatus.textContent = ""; }, 1500);
      } catch (err) {
        ctx.toast("Save failed: " + err.message, "error");
        saveCaptionBtn.disabled = false;
      } finally { saveCaptionBtn.textContent = "Save caption"; }
    });

    // Footer actions
    const footer = detailModal.querySelector("#sp-detail-footer");
    footer.innerHTML = "";
    if (canDelete) {
      const delBtn = el("button", { class: "btn btn-ghost btn-sm spd-delete" }, "Delete");
      delBtn.addEventListener("click", async () => {
        const ok = await confirmDialogSafe(`Delete "${cleanTitle(p.title)}" from the board? This can't be undone.`);
        if (!ok) return;
        try {
          const res = await ctx.authedFetch(`https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT}/databases/(default)/documents/social_posts/${p.id}`, { method: "DELETE" });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          allPosts = allPosts.filter((x) => x.id !== p.id);
          closeDetail(); render();
          ctx.toast("Post deleted.", "success");
        } catch (err) { ctx.toast("Could not delete: " + err.message, "error"); }
      });
      footer.appendChild(delBtn);
    }
    footer.appendChild(el("span", { class: "spd-spacer" }));
    if (p.bank) {
      const useBtn = el("button", { class: "btn btn-secondary btn-sm", title: "Take it out of the bank and put it with the drafts (with the date above, if you set one)" }, "Move to drafts");
      useBtn.addEventListener("click", async () => {
        useBtn.disabled = true;
        try {
          await firestoreWrite(ctx.authedFetch, `social_posts/${p.id}`, { bank: false, status: "proposed", deadline: dueEl?.value || p.deadline || "" });
          ctx.toast(dueEl?.value ? "Moved to drafts with its date." : "Moved to drafts. Give it a date and someone to post it when you're ready.", "success");
          closeDetail(); await loadPosts();
        } catch (err) { ctx.toast("Could not move it: " + err.message, "error"); useBtn.disabled = false; }
      });
      footer.appendChild(useBtn);
    }
    // Assigned posts are marked posted from the "who posts it" block above.
    if (canStatus && !p.bank && !p.assign) {
      const transitions = { proposed: "approved", approved: "posted", assigned: "posted" };
      const labels = { proposed: "Approve", approved: "Mark posted", assigned: "Mark posted" };
      if (transitions[st]) {
        const btn = el("button", { class: "btn btn-secondary btn-sm" }, labels[st]);
        btn.addEventListener("click", async () => {
          btn.disabled = true;
          try {
            await firestoreWrite(ctx.authedFetch, `social_posts/${p.id}`, { status: transitions[st] });
            ctx.toast(`Marked as ${STATUS_LABEL[transitions[st]].toLowerCase()}`, "success");
            closeDetail();
            await loadPosts();
          } catch (err) { ctx.toast("Failed: " + err.message, "error"); btn.disabled = false; }
        });
        footer.appendChild(btn);
      }
    }
    if (nSlides) {
      const multi = nSlides > 1;
      const dlLabel = multi ? `Download all ${nSlides} (ZIP)` : "Download image";
      const dlBtn = el("button", { class: "btn btn-secondary btn-sm" }, dlLabel);
      dlBtn.addEventListener("click", async () => {
        dlBtn.disabled = true; dlBtn.textContent = "Preparing…";
        const base = `catalyst-${(p.articleSlug || cleanTitle(p.title).toLowerCase().replace(/[^a-z0-9]+/g, "-")).slice(0, 60)}`;
        // A slide as a JPEG blob: rendered from the design, or the stored image.
        const slideBlob = async (i) => {
          if (design) {
            const m = await studioModule();
            const c = await m.renderDesignPage(design, i, 1);
            const flat = document.createElement("canvas"); flat.width = c.width; flat.height = c.height;
            const g = flat.getContext("2d"); g.fillStyle = "#ffffff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(c, 0, 0);
            return await new Promise((r) => flat.toBlob(r, "image/jpeg", 0.93));
          }
          return fetchAsJpeg(staticImgs[i]);
        };
        try {
          if (!multi) saveBlob(await slideBlob(0), `${base}.jpg`);
          else {
            const JSZipMod = await import("https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm");
            const zip = new (JSZipMod.default || JSZipMod)();
            for (let i = 0; i < nSlides; i++) { dlBtn.textContent = `Preparing ${i + 1}/${nSlides}…`; zip.file(`${String(i + 1).padStart(2, "0")}.jpg`, await slideBlob(i)); }
            saveBlob(await zip.generateAsync({ type: "blob" }), `${base}-carousel.zip`);
          }
        } catch (err) {
          console.warn("[social] download failed", err);
          ctx.toast("Could not download: " + (err.message || err), "error");
        } finally { dlBtn.disabled = false; dlBtn.textContent = dlLabel; }
      });
      footer.appendChild(dlBtn);
    }
    if (canEdit) {
      const studioBtn = el("button", { class: "btn btn-primary btn-sm" }, "Open in Studio");
      studioBtn.addEventListener("click", () => { closeDetail(); openInStudio(p); });
      footer.appendChild(studioBtn);
    } else if (p.articleId) {
      const editBtn = el("button", { class: "btn btn-primary btn-sm" }, "Open in carousel maker");
      editBtn.addEventListener("click", async () => {
        closeDetail();
        const found = await startCreateForArticleId(p.articleId);
        if (!found) ctx.toast("This story isn't published yet, so the carousel maker can't load it.", "error");
      });
      footer.appendChild(editBtn);
    }

    detailModal.style.display = "grid";
    document.addEventListener("keydown", detailKeys);
    detailModal.querySelector("#sp-detail-close").focus();
  }
  const confirmDialogSafe = (msg) => confirmDialog(msg, { confirmText: "Delete", danger: true });

  // ── Article carousel (carousel-maker.js) ──────────────────────────────────
  let maker = null;
  async function ensureCreateInitialized() {
    if (maker) return maker;
    const { mountCarouselMaker } = await import("./carousel-maker.js?v=2");
    maker = mountCarouselMaker(ctx, createView, {
      getArticles: async () => { if (!publishedArticles.length) await loadArticles(); return publishedArticles; },
      getArticleHtml: (id) => firestoreGetArticleHtml(ctx.authedFetch, id),
      studio: studioModule,
      savePost: async (post) => {
        const id = await firestoreAdd(ctx.authedFetch, "social_posts", {
          ...post,
          status: "proposed",
          proposerId: ctx.user.uid,
          proposerName: ctx.profile.name || ctx.user.email,
          assigneeId: null,
          assigneeName: null,
          deadline: new Date(Date.now() + 3 * 86400000).toISOString().split("T")[0],
          createdAt: new Date().toISOString(),
          activity: [{ text: "made in the carousel maker", authorName: ctx.profile.name || ctx.user.email, timestamp: new Date().toISOString() }],
        });
        boardStale = true;
        return id;
      },
      updatePost: async (id, post) => { await firestoreWrite(ctx.authedFetch, `social_posts/${id}`, post); boardStale = true; },
      openInStudio: (post) => openInStudio(post),
    });
    return maker;
  }

  // ── Filters ────────────────────────────────────────────────────────────────
  // (filters are wired up next to render())

  // Load posts and the published-article list in parallel so the Board can
  // surface "needs a post" suggestions on first paint without waiting for
  // the user to open the Create tab.
  await Promise.all([
    loadPosts(),
    loadArticles().then(() => render()),
  ]);
  return cleanup;
}
