// js/dashboard/searchability.js
// "Searchability" dashboard — Google Search Console data, period-over-period.
//
// Sections:
//   • Range picker (7d / 28d / 90d / 1y)  + search-type toggle (web/news/etc)
//   • 4 KPI tiles with % deltas vs the previous equal-length period
//   • Sparkline trend on each KPI tile
//   • Insights strip — automatic findings ("clicks up 24% week-over-week", etc.)
//   • Big clicks + impressions trend chart
//   • Opportunities — high-impression-low-CTR queries with click-potential math
//   • Rising + falling queries vs previous period
//   • Top queries / pages with brand vs non-brand split
//   • Countries + devices breakdown
//   • Search appearance (FAQ, Article, etc.) if available
//   • CSV export

import { el, esc } from "./ui.js";

// Date range presets
const RANGES = [
  { label: "7 days",  days: 7  },
  { label: "28 days", days: 28 },
  { label: "90 days", days: 90 },
  { label: "1 year",  days: 365 },
];

const SEARCH_TYPES = [
  { label: "Web",      value: "web"      },
  { label: "Image",    value: "image"    },
  { label: "News",     value: "news"     },
  { label: "Discover", value: "discover" },
];

// Brand terms — queries containing these are "branded" (people who already
// know Catalyst). Everything else is "discovery" traffic.
const BRAND_TERMS = ["catalyst magazine", "catalyst-magazine", "catalystmagazine", "the catalyst"];

export async function mount(ctx, container) {
  container.innerHTML = "";

  const wrapper = el("div", { class: "sc-page" });
  wrapper.innerHTML = `
    <!-- ─── HERO: page title + filters + KPI strip in one premium card ─── -->
    <section class="sc-hero" aria-labelledby="sc-hero-title">
      <div class="sc-hero-top">
        <div class="sc-hero-title-block">
          <div class="sc-hero-eyebrow">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            Google Search Console
          </div>
          <h1 class="sc-hero-title" id="sc-hero-title">Searchability</h1>
          <p class="sc-hero-sub">How readers find Catalyst on Google — performance, opportunities, and trends.</p>
        </div>

        <div class="sc-controls" role="toolbar" aria-label="Filters">
          <div class="sc-control-group">
            <label class="sc-control-label" for="sc-range-picker">Range</label>
            <div class="sc-range-picker" id="sc-range-picker" role="tablist" aria-label="Date range">
              ${RANGES.map((r, i) =>
                `<button type="button" class="sc-range-btn ${i === 1 ? "is-active" : ""}" data-days="${r.days}" role="tab" aria-selected="${i === 1}">${esc(r.label)}</button>`
              ).join("")}
            </div>
          </div>
          <div class="sc-control-group">
            <label class="sc-control-label" for="sc-search-type">Source</label>
            <div class="sc-select-wrap">
              <select class="sc-select" id="sc-search-type" aria-label="Search type">
                ${SEARCH_TYPES.map((t) => `<option value="${esc(t.value)}">${esc(t.label)}</option>`).join("")}
              </select>
              <svg class="sc-select-caret" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
            </div>
          </div>
          <button type="button" class="sc-refresh-btn" id="sc-refresh" aria-label="Refresh data" title="Refresh data">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="23 4 23 10 17 10"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10"/><polyline points="1 20 1 14 7 14"/><path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14"/></svg>
          </button>
        </div>
      </div>

      <div class="sc-period-bar" id="sc-period-bar">
        <span class="sc-period-pulse" aria-hidden="true"></span>
        <span class="sc-period-label">
          <strong id="sc-period-current">…</strong>
          <span class="sc-period-sep">vs.</span>
          <span class="sc-period-prev" id="sc-period-prev">…</span>
        </span>
        <span class="sc-period-note">GSC data lags ~2 days</span>
      </div>

      <div class="sc-kpi-grid">
        ${kpiTile("Clicks",       "clicks", "Total search result clicks",                  "click")}
        ${kpiTile("Impressions",  "impr",   "Times your pages appeared in search",         "eye")}
        ${kpiTile("Click-through rate", "ctr", "Clicks ÷ impressions",                     "ctr")}
        ${kpiTile("Avg. position","pos",    "Average rank in results (1 = top)",           "rank")}
      </div>
    </section>

    <!-- ─── Action layer: insights + trend chart ─── -->
    <section class="sc-section">
      <div class="sc-section-head">
        <div>
          <h2 class="sc-section-title">What's happening right now</h2>
          <p class="sc-section-sub">Auto-generated takeaways from your current period vs. the previous one.</p>
        </div>
      </div>
      <div class="sc-insights" id="sc-insights">
        <div class="sc-insights-loading"><div class="spinner"></div>Analyzing your search data…</div>
      </div>
    </section>

    <section class="sc-card sc-trend-card">
      <div class="sc-card-head">
        <div>
          <h2 class="sc-card-title">Performance over time</h2>
          <p class="sc-card-sub">Daily trend across the selected period. Use the toggle to focus on one metric.</p>
        </div>
        <div class="sc-chart-toggle" id="sc-chart-toggle" role="group" aria-label="Chart metric">
          <button type="button" class="sc-chart-toggle-btn is-active" data-metric="both">Both</button>
          <button type="button" class="sc-chart-toggle-btn" data-metric="clicks">Clicks</button>
          <button type="button" class="sc-chart-toggle-btn" data-metric="impressions">Impressions</button>
          <button type="button" class="sc-chart-toggle-btn" data-metric="ctr">CTR</button>
          <button type="button" class="sc-chart-toggle-btn" data-metric="position">Position</button>
        </div>
      </div>
      <div class="sc-card-body">
        <div id="sc-trend-chart"><div class="loading-state"><div class="spinner"></div>Loading chart…</div></div>
      </div>
    </section>

    <!-- ─── Opportunities — the single most actionable section ─── -->
    <section class="sc-card sc-card-highlight">
      <div class="sc-card-head">
        <div>
          <div class="sc-pill sc-pill-accent">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/></svg>
            Highest-value action
          </div>
          <h2 class="sc-card-title">Quick wins — high impressions, low CTR</h2>
          <p class="sc-card-sub">Queries Google is already showing you for, but few people click. Improve titles and meta descriptions to capture this traffic.</p>
        </div>
        <button type="button" class="sc-ghost-btn sc-csv-btn" data-csv="opportunities">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Export CSV
        </button>
      </div>
      <div class="sc-card-body" id="sc-opportunities"><div class="loading-state"><div class="spinner"></div>Calculating opportunities…</div></div>
    </section>

    <!-- ─── What's moving — rising + falling side by side ─── -->
    <div class="sc-grid-2">
      <section class="sc-card">
        <div class="sc-card-head">
          <div>
            <div class="sc-pill sc-pill-up">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
              Rising
            </div>
            <h2 class="sc-card-title">Queries gaining clicks</h2>
            <p class="sc-card-sub">Biggest gains vs. the previous period.</p>
          </div>
        </div>
        <div class="sc-card-body" id="sc-rising"><div class="loading-state"><div class="spinner"></div></div></div>
      </section>
      <section class="sc-card">
        <div class="sc-card-head">
          <div>
            <div class="sc-pill sc-pill-down">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/></svg>
              Falling
            </div>
            <h2 class="sc-card-title">Queries losing clicks</h2>
            <p class="sc-card-sub">Worth investigating — content may need a refresh.</p>
          </div>
        </div>
        <div class="sc-card-body" id="sc-falling"><div class="loading-state"><div class="spinner"></div></div></div>
      </section>
    </div>

    <!-- ─── Top performers ─── -->
    <div class="sc-grid-2">
      <section class="sc-card">
        <div class="sc-card-head">
          <div>
            <h2 class="sc-card-title">Top queries</h2>
            <p class="sc-card-sub">The search terms driving the most traffic.</p>
          </div>
          <button type="button" class="sc-ghost-btn sc-csv-btn" data-csv="queries">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            CSV
          </button>
        </div>
        <div class="sc-card-body" id="sc-queries"><div class="loading-state"><div class="spinner"></div></div></div>
      </section>
      <section class="sc-card">
        <div class="sc-card-head">
          <div>
            <h2 class="sc-card-title">Top pages</h2>
            <p class="sc-card-sub">Which articles earn the most search traffic.</p>
          </div>
          <button type="button" class="sc-ghost-btn sc-csv-btn" data-csv="pages">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            CSV
          </button>
        </div>
        <div class="sc-card-body" id="sc-pages"><div class="loading-state"><div class="spinner"></div></div></div>
      </section>
    </div>

    <!-- ─── Audience layer (lower priority — context, not action) ─── -->
    <section class="sc-section sc-audience-section">
      <div class="sc-section-head">
        <div>
          <h2 class="sc-section-title">Audience</h2>
          <p class="sc-section-sub">Who's finding you and how they're searching.</p>
        </div>
      </div>

      <section class="sc-card">
        <div class="sc-card-head">
          <div>
            <h3 class="sc-card-title">Brand vs. discovery traffic</h3>
            <p class="sc-card-sub"><strong>Brand</strong>: people searching "Catalyst Magazine" by name. <strong>Discovery</strong>: topic searches that lead them to you for the first time.</p>
          </div>
        </div>
        <div class="sc-card-body" id="sc-brand-split"><div class="loading-state"><div class="spinner"></div></div></div>
      </section>

      <div class="sc-grid-2">
        <section class="sc-card">
          <div class="sc-card-head">
            <h3 class="sc-card-title">Where readers search from</h3>
          </div>
          <div class="sc-card-body" id="sc-countries"><div class="loading-state"><div class="spinner"></div></div></div>
        </section>
        <section class="sc-card">
          <div class="sc-card-head">
            <h3 class="sc-card-title">Device mix</h3>
          </div>
          <div class="sc-card-body" id="sc-devices"><div class="loading-state"><div class="spinner"></div></div></div>
        </section>
      </div>

      <section class="sc-card" id="sc-appearance-card" style="display:none;">
        <div class="sc-card-head">
          <div>
            <h3 class="sc-card-title">Search appearance</h3>
            <p class="sc-card-sub">How Google chooses to show your pages — rich results, article cards, etc.</p>
          </div>
        </div>
        <div class="sc-card-body" id="sc-appearance"></div>
      </section>
    </section>

    <!-- ─── Footer: link to GSC ─── -->
    <div class="sc-footer">
      <a class="sc-footer-link" href="https://search.google.com/search-console?resource_id=sc-domain%3Acatalyst-magazine.com" target="_blank" rel="noopener">
        Open in Google Search Console
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
      </a>
    </div>`;

  container.appendChild(wrapper);

  // State held in closures
  const state = {
    days: 28,
    searchType: "web",
    chartMetric: "both",
    lastData: {},
  };

  // Range picker
  wrapper.querySelector("#sc-range-picker").addEventListener("click", (e) => {
    const btn = e.target.closest(".sc-range-btn");
    if (!btn) return;
    state.days = Number(btn.dataset.days);
    wrapper.querySelectorAll(".sc-range-btn").forEach((b) => {
      b.classList.toggle("is-active", b === btn);
      b.setAttribute("aria-selected", b === btn ? "true" : "false");
    });
    loadAll(ctx, wrapper, state);
  });

  // Search type
  wrapper.querySelector("#sc-search-type").addEventListener("change", (e) => {
    state.searchType = e.target.value;
    loadAll(ctx, wrapper, state);
  });

  // Refresh
  wrapper.querySelector("#sc-refresh").addEventListener("click", () => loadAll(ctx, wrapper, state));

  // Chart metric toggle
  wrapper.querySelector("#sc-chart-toggle").addEventListener("click", (e) => {
    const btn = e.target.closest(".sc-chart-toggle-btn");
    if (!btn) return;
    state.chartMetric = btn.dataset.metric;
    wrapper.querySelectorAll(".sc-chart-toggle-btn").forEach((b) => {
      b.classList.toggle("is-active", b === btn);
    });
    if (state.lastData.dates) renderTrendChart(wrapper, state.lastData.dates, state.chartMetric);
  });

  // CSV exporter
  wrapper.addEventListener("click", (e) => {
    const btn = e.target.closest(".sc-csv-btn");
    if (!btn) return;
    const which = btn.dataset.csv;
    exportCsv(which, state.lastData);
  });

  loadAll(ctx, wrapper, state);
}

// ── Data loading ─────────────────────────────────────────────────────────────

function dateRange(days) {
  const end = new Date();
  end.setDate(end.getDate() - 2); // GSC lags ~2 days
  const start = new Date(end);
  start.setDate(start.getDate() - (days - 1));
  return {
    startDate: isoDate(start),
    endDate:   isoDate(end),
  };
}

function priorRange(days) {
  const cur = dateRange(days);
  const curStart = new Date(cur.startDate);
  const prevEnd = new Date(curStart);
  prevEnd.setDate(prevEnd.getDate() - 1);
  const prevStart = new Date(prevEnd);
  prevStart.setDate(prevStart.getDate() - (days - 1));
  return {
    compareStartDate: isoDate(prevStart),
    compareEndDate:   isoDate(prevEnd),
  };
}

function isoDate(d) { return d.toISOString().slice(0, 10); }

async function gscQuery(ctx, type, days, opts = {}) {
  const { startDate, endDate } = dateRange(days);
  const cmp = opts.compare ? priorRange(days) : {};
  const body = {
    startDate, endDate,
    type,
    rowLimit:  opts.rowLimit  || 10,
    searchType: opts.searchType || "web",
    ...cmp,
  };
  const res = await ctx.authedFetch("/api/searchability/query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return { rows: data.rows || [], compareRows: data.compareRows || null };
}

async function loadAll(ctx, wrapper, state) {
  const { days, searchType } = state;

  // Update period labels in the note
  const cur = dateRange(days);
  const prev = priorRange(days);
  wrapper.querySelector("#sc-period-current").textContent = `${humanDate(cur.startDate)} – ${humanDate(cur.endDate)}`;
  wrapper.querySelector("#sc-period-prev").textContent = `${humanDate(prev.compareStartDate)} – ${humanDate(prev.compareEndDate)}`;

  // Reset panels to loading
  ["sc-trend-chart", "sc-opportunities", "sc-rising", "sc-falling",
   "sc-brand-split", "sc-queries", "sc-pages", "sc-countries", "sc-devices",
   "sc-appearance"].forEach((id) => {
    const el = wrapper.querySelector(`#${id}`);
    if (el) el.innerHTML = `<div class="loading-state"><div class="spinner"></div>Loading…</div>`;
  });
  // Insights uses a grid-friendly loading block that spans the row
  const insightsEl = wrapper.querySelector("#sc-insights");
  if (insightsEl) {
    insightsEl.innerHTML = `<div class="sc-insights-loading"><div class="spinner"></div>Analyzing your search data…</div>`;
  }
  wrapper.querySelectorAll(".sc-kpi-delta").forEach((n) => { n.textContent = ""; n.className = "sc-kpi-delta"; });
  wrapper.querySelectorAll(".sc-kpi-value").forEach((n) => { n.textContent = "…"; });
  wrapper.querySelectorAll(".sc-kpi-spark").forEach((n) => { n.innerHTML = ""; });

  // Fire all requests in parallel
  const opts = { searchType };
  const optsCmp = { ...opts, compare: true };

  const [overview, dates, queries, pages, countries, devices, appearance] = await Promise.allSettled([
    gscQuery(ctx, "overview",  days, { ...optsCmp }),
    gscQuery(ctx, "dates",     days, { ...opts, rowLimit: 365 }),
    gscQuery(ctx, "queries",   days, { ...optsCmp, rowLimit: 100 }),
    gscQuery(ctx, "pages",     days, { ...optsCmp, rowLimit: 50 }),
    gscQuery(ctx, "countries", days, { ...opts, rowLimit: 15 }),
    gscQuery(ctx, "devices",   days, { ...opts, rowLimit: 5  }),
    gscQuery(ctx, "searchAppearance", days, { ...opts, rowLimit: 15 }),
  ]);

  // Stash everything for CSV export + chart toggle
  state.lastData = {
    overview, dates, queries, pages, countries, devices, appearance, days, searchType,
  };

  // ── KPIs ──
  if (overview.status === "fulfilled") {
    const cur  = overview.value.rows[0]  || {};
    const prev = overview.value.compareRows?.[0] || null;

    setKpi(wrapper, "clicks", fmtNum(cur.clicks || 0), prev?.clicks);
    setKpi(wrapper, "impr",   fmtNum(cur.impressions || 0), prev?.impressions);

    const curCtr  = cur.ctr  != null ? cur.ctr  * 100 : null;
    const prevCtr = prev?.ctr != null ? prev.ctr * 100 : null;
    setKpi(wrapper, "ctr", curCtr != null ? `${curCtr.toFixed(1)}%` : "—", prevCtr, { suffix: "pp", absoluteDelta: true });

    const curPos = cur.position;
    const prevPos = prev?.position;
    setKpi(wrapper, "pos", curPos != null ? curPos.toFixed(1) : "—", prevPos, { inverse: true });

    // Sparklines on each KPI from the dates series
    if (dates.status === "fulfilled" && dates.value.rows.length) {
      renderKpiSparkline(wrapper, "clicks", dates.value.rows.map((r) => r.clicks || 0));
      renderKpiSparkline(wrapper, "impr",   dates.value.rows.map((r) => r.impressions || 0));
      renderKpiSparkline(wrapper, "ctr",    dates.value.rows.map((r) => (r.ctr || 0) * 100));
      renderKpiSparkline(wrapper, "pos",    dates.value.rows.map((r) => r.position || 0), { inverse: true });
    }
  } else {
    ["clicks", "impr", "ctr", "pos"].forEach((k) => setKpi(wrapper, k, "—"));
  }

  // ── Insights ──
  renderInsights(wrapper, state.lastData);

  // ── Trend chart ──
  if (dates.status === "fulfilled") {
    renderTrendChart(wrapper, dates.value.rows, state.chartMetric);
  } else {
    wrapper.querySelector("#sc-trend-chart").innerHTML =
      `<div class="error-state">Could not load chart: ${esc(dates.reason?.message || "unknown")}</div>`;
  }

  // ── Opportunities — high-impression, low-CTR queries ──
  renderOpportunities(wrapper, queries);

  // ── Rising + Falling ──
  renderRisingFalling(wrapper, queries);

  // ── Brand vs Discovery ──
  renderBrandSplit(wrapper, queries, overview);

  // ── Top tables ──
  renderRankedTable(wrapper, "#sc-queries",   queries,   "query",   { topN: 15 });
  renderRankedTable(wrapper, "#sc-pages",     pages,     "page",    { topN: 15 });
  renderRankedTable(wrapper, "#sc-countries", countries, "country", { topN: 10 });
  renderRankedTable(wrapper, "#sc-devices",   devices,   "device",  { topN: 5  });

  // ── Search appearance (optional — only show if rows exist) ──
  if (appearance.status === "fulfilled" && appearance.value.rows.length) {
    wrapper.querySelector("#sc-appearance-card").style.display = "";
    renderRankedTable(wrapper, "#sc-appearance", appearance, "searchAppearance", { topN: 10 });
  } else {
    wrapper.querySelector("#sc-appearance-card").style.display = "none";
  }
}

// ── KPI helpers ──────────────────────────────────────────────────────────────

function kpiTile(label, key, hint, iconKey) {
  return `
    <div class="sc-kpi" title="${esc(hint)}">
      <div class="sc-kpi-head">
        <div class="sc-kpi-label">${esc(label)}</div>
        <span class="sc-kpi-icon">${kpiIcon(iconKey)}</span>
      </div>
      <div class="sc-kpi-value-row">
        <div class="sc-kpi-value" data-kv="${esc(key)}">…</div>
        <div class="sc-kpi-delta" data-kd="${esc(key)}"></div>
      </div>
      <div class="sc-kpi-spark" data-ks="${esc(key)}"></div>
    </div>`;
}

function kpiIcon(k) {
  if (k === "click")
    return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 9 5 12 1.8-5.2L21 14Z"/><path d="M7.2 2.2 8 5.1"/><path d="m5.1 8-2.9-.8"/><path d="M14 4.1 12 6"/><path d="m6 12-1.9 2"/></svg>`;
  if (k === "eye")
    return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>`;
  if (k === "ctr")
    return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="5" x2="5" y2="19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/></svg>`;
  if (k === "rank")
    return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9 12 3l6 6"/><path d="M12 3v18"/></svg>`;
  return "";
}

// Updates a single KPI tile.
// opts.inverse = lower is better (used for position)
// opts.suffix  = "pp" for percentage-point deltas (CTR)
// opts.absoluteDelta = show raw difference, not %
function setKpi(wrapper, key, value, prev, opts = {}) {
  const v = wrapper.querySelector(`[data-kv="${key}"]`);
  const d = wrapper.querySelector(`[data-kd="${key}"]`);
  if (v) v.textContent = value;
  if (!d) return;
  if (prev == null || prev === undefined) { d.textContent = ""; return; }

  // Extract numeric current value for delta math
  const curNum = parseFloat(String(value).replace(/[^0-9.\-]/g, ""));
  if (!Number.isFinite(curNum)) { d.textContent = ""; return; }
  const prevNum = Number(prev);
  if (!Number.isFinite(prevNum) || prevNum === 0) {
    if (curNum === 0) { d.textContent = "0"; return; }
    d.textContent = "new";
    d.className = "sc-kpi-delta is-up";
    return;
  }

  let display;
  let directionUp;
  if (opts.absoluteDelta) {
    // Both numbers should already be in the same units (e.g. both as 8.5 not 0.085).
    const diff = curNum - prevNum;
    directionUp = diff >= 0;
    display = `${diff >= 0 ? "+" : ""}${diff.toFixed(1)}${opts.suffix || ""}`;
  } else {
    const pct = ((curNum - prevNum) / Math.abs(prevNum)) * 100;
    directionUp = pct >= 0;
    display = `${pct >= 0 ? "+" : ""}${pct.toFixed(0)}%`;
  }

  const goodUp = !opts.inverse;
  const isGood = directionUp === goodUp;
  d.textContent = `${directionUp ? "▲" : "▼"} ${display}`;
  d.className = `sc-kpi-delta ${isGood ? "is-up" : "is-down"}`;
}

function renderKpiSparkline(wrapper, key, series, opts = {}) {
  const el = wrapper.querySelector(`[data-ks="${key}"]`);
  if (!el || !series.length) return;
  const max = Math.max(...series) || 1;
  const min = Math.min(...series);
  const W = 120, H = 28;
  const stepX = W / Math.max(series.length - 1, 1);
  const range = max - min || 1;
  const points = series.map((v, i) => {
    const x = i * stepX;
    const y = H - ((v - min) / range) * H;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const lastV = series[series.length - 1];
  const isUp  = lastV >= series[0];
  const goodUp = !opts.inverse;
  const color = (isUp === goodUp) ? "var(--accent)" : "#dc2626";
  el.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="width:100%;height:28px;">
      <polyline points="${points}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" opacity="0.85"/>
    </svg>`;
}

function fmtNum(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000)    return `${(n / 1_000).toFixed(0)}K`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}

// ── Insights strip ──────────────────────────────────────────────────────────

function renderInsights(wrapper, data) {
  const el = wrapper.querySelector("#sc-insights");
  const insights = [];

  // 1) Overview deltas
  if (data.overview?.status === "fulfilled") {
    const cur = data.overview.value.rows[0] || {};
    const prev = data.overview.value.compareRows?.[0];
    if (prev) {
      const clickPct = pctChange(cur.clicks, prev.clicks);
      if (Math.abs(clickPct) >= 10 && prev.clicks > 5) {
        insights.push({
          tone: clickPct > 0 ? "good" : "warn",
          icon: clickPct > 0 ? "trending-up" : "trending-down",
          title: `Clicks ${clickPct > 0 ? "up" : "down"} ${Math.abs(clickPct).toFixed(0)}%`,
          body:  `${fmtNum(cur.clicks)} this period vs. ${fmtNum(prev.clicks)} the previous one.`,
        });
      }
      const imprPct = pctChange(cur.impressions, prev.impressions);
      if (Math.abs(imprPct) >= 15 && prev.impressions > 50) {
        insights.push({
          tone: imprPct > 0 ? "good" : "warn",
          icon: imprPct > 0 ? "trending-up" : "trending-down",
          title: `Impressions ${imprPct > 0 ? "up" : "down"} ${Math.abs(imprPct).toFixed(0)}%`,
          body:  `Google showed your pages ${fmtNum(cur.impressions)} times (was ${fmtNum(prev.impressions)}).`,
        });
      }
      const ctrDelta = ((cur.ctr || 0) - (prev.ctr || 0)) * 100;
      if (Math.abs(ctrDelta) >= 0.3 && (prev.impressions || 0) > 100) {
        insights.push({
          tone: ctrDelta > 0 ? "good" : "info",
          icon: "ctr",
          title: `CTR ${ctrDelta > 0 ? "improved" : "dropped"} ${Math.abs(ctrDelta).toFixed(1)}pp`,
          body: `From ${((prev.ctr || 0) * 100).toFixed(1)}% to ${((cur.ctr || 0) * 100).toFixed(1)}%.`,
        });
      }
      const posDelta = (cur.position || 0) - (prev.position || 0);
      if (Math.abs(posDelta) >= 1 && (prev.impressions || 0) > 100) {
        insights.push({
          tone: posDelta < 0 ? "good" : "warn", // lower is better
          icon: "rank",
          title: `Avg. position ${posDelta < 0 ? "moved up" : "slipped"} ${Math.abs(posDelta).toFixed(1)} spots`,
          body: `Now ${(cur.position || 0).toFixed(1)} (was ${(prev.position || 0).toFixed(1)}).`,
        });
      }
    }
  }

  // 2) Single best-performing query
  if (data.queries?.status === "fulfilled") {
    const rows = data.queries.value.rows;
    const compareRows = data.queries.value.compareRows || [];
    const compareMap = new Map(compareRows.map((r) => [r.keys?.[0], r]));
    const risers = rows
      .map((r) => {
        const prev = compareMap.get(r.keys?.[0]);
        const delta = (r.clicks || 0) - (prev?.clicks || 0);
        return { ...r, delta };
      })
      .filter((r) => r.delta >= 3)
      .sort((a, b) => b.delta - a.delta);
    if (risers.length) {
      const top = risers[0];
      insights.push({
        tone: "good",
        icon: "spark",
        title: `Top rising query: "${truncate(top.keys[0], 60)}"`,
        body: `+${top.delta} clicks vs. previous period (${top.clicks} this period). Position ${top.position.toFixed(1)}.`,
      });
    }

    // 3) Best opportunity — high impressions, low CTR
    const opps = rows
      .filter((r) => (r.impressions || 0) >= 100 && (r.ctr || 0) < 0.02 && (r.position || 0) <= 20)
      .sort((a, b) => b.impressions - a.impressions);
    if (opps.length) {
      const top = opps[0];
      const potential = Math.round((top.impressions || 0) * 0.05);
      insights.push({
        tone: "info",
        icon: "lightbulb",
        title: `Easy win — "${truncate(top.keys[0], 60)}"`,
        body: `${fmtNum(top.impressions)} impressions, but only ${((top.ctr || 0) * 100).toFixed(1)}% CTR. A better title/meta could earn ~${potential} extra clicks at industry-average CTR.`,
      });
    }

    // 4) Top page
    if (data.pages?.status === "fulfilled" && data.pages.value.rows.length) {
      const topPage = data.pages.value.rows[0];
      insights.push({
        tone: "info",
        icon: "page",
        title: `Best-performing page`,
        body: `<a href="${esc(topPage.keys[0])}" target="_blank" rel="noopener">${esc(pagePath(topPage.keys[0]))}</a> — ${fmtNum(topPage.clicks)} clicks, ${fmtNum(topPage.impressions)} impressions.`,
      });
    }

    // 5) Mobile vs desktop CTR gap
    if (data.devices?.status === "fulfilled") {
      const dev = data.devices.value.rows;
      const mobile  = dev.find((r) => r.keys?.[0] === "MOBILE");
      const desktop = dev.find((r) => r.keys?.[0] === "DESKTOP");
      if (mobile && desktop) {
        const totalClicks = (mobile.clicks || 0) + (desktop.clicks || 0);
        if (totalClicks > 20) {
          const mobileShare = ((mobile.clicks || 0) / totalClicks) * 100;
          insights.push({
            tone: "info",
            icon: "device",
            title: `${mobileShare.toFixed(0)}% of clicks come from mobile`,
            body: `${fmtNum(mobile.clicks || 0)} mobile vs. ${fmtNum(desktop.clicks || 0)} desktop clicks.`,
          });
        }
      }
    }
  }

  if (!insights.length) {
    el.innerHTML = `<div class="empty-state" style="padding:18px;">Not enough data yet — try the 90-day or 1-year range.</div>`;
    return;
  }

  el.innerHTML = insights.slice(0, 6).map((ins) => `
    <div class="sc-insight sc-insight-${ins.tone}">
      <div class="sc-insight-icon">${insightIcon(ins.icon)}</div>
      <div>
        <div class="sc-insight-title">${ins.title}</div>
        <div class="sc-insight-body">${ins.body}</div>
      </div>
    </div>
  `).join("");
}

function insightIcon(name) {
  const ICONS = {
    "trending-up":   `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>`,
    "trending-down": `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/></svg>`,
    "ctr":           `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="5" x2="5" y2="19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/></svg>`,
    "rank":          `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6-6 6 6"/><path d="M12 3v18"/></svg>`,
    "spark":         `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
    "lightbulb":     `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.9.8 1 2 1 3.3h6c0-1.3.1-2.5 1-3.3A7 7 0 0 0 12 2z"/></svg>`,
    "page":          `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`,
    "device":        `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12" y2="18"/></svg>`,
  };
  return ICONS[name] || ICONS["spark"];
}

function pctChange(cur, prev) {
  if (!prev) return cur ? 100 : 0;
  return ((cur - prev) / Math.abs(prev)) * 100;
}

function truncate(s, n) {
  s = String(s || "");
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

// ── Trend chart ──────────────────────────────────────────────────────────────

function renderTrendChart(wrapper, rows, metric = "both") {
  const chartEl = wrapper.querySelector("#sc-trend-chart");
  if (!rows.length) {
    chartEl.innerHTML = `<div class="empty-state">No data for this period.</div>`;
    return;
  }

  const dates    = rows.map((r) => r.keys?.[0] || "");
  const clicks   = rows.map((r) => r.clicks || 0);
  const imprArr  = rows.map((r) => r.impressions || 0);
  const ctrArr   = rows.map((r) => (r.ctr || 0) * 100);
  const posArr   = rows.map((r) => r.position || 0);

  const W = 900, H = 280;
  const pad = { top: 16, right: 50, bottom: 42, left: 50 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;
  const n = rows.length;

  const xc = (i) => pad.left + (i / Math.max(n - 1, 1)) * plotW;

  // Decide which series to draw based on metric toggle
  const showClicks = metric === "both" || metric === "clicks";
  const showImpr   = metric === "both" || metric === "impressions";
  const showCtr    = metric === "ctr";
  const showPos    = metric === "position";

  let leftMax, rightMax, leftLabel, rightLabel;
  if (showClicks && showImpr) {
    leftMax  = niceMax(Math.max(1, ...clicks));
    rightMax = niceMax(Math.max(1, ...imprArr));
    leftLabel = "Clicks"; rightLabel = "Impressions";
  } else if (showClicks) {
    leftMax = niceMax(Math.max(1, ...clicks));
    leftLabel = "Clicks";
  } else if (showImpr) {
    leftMax = niceMax(Math.max(1, ...imprArr));
    leftLabel = "Impressions";
  } else if (showCtr) {
    leftMax = niceMax(Math.max(1, ...ctrArr));
    leftLabel = "CTR (%)";
  } else if (showPos) {
    leftMax = Math.ceil(Math.max(1, ...posArr));
    leftLabel = "Position";
  }

  const ycLeft  = (v) => pad.top + plotH - (v / leftMax) * plotH;
  const ycRight = (v) => pad.top + plotH - (v / rightMax) * plotH;
  // Position chart is inverted (1 = top, large numbers worse)
  const ycPos   = (v) => pad.top + (v / leftMax) * plotH;

  // Gridlines off leftMax
  const leftTicks = niceTicks(leftMax, 4);
  const gridLines = leftTicks.map((t) => {
    const gy = ycLeft(t);
    return `<line x1="${pad.left}" y1="${gy.toFixed(1)}" x2="${(W - pad.right).toFixed(1)}" y2="${gy.toFixed(1)}" stroke="var(--surface-3)" stroke-width="1"/>
    <text x="${pad.left - 8}" y="${(gy + 3).toFixed(1)}" text-anchor="end" font-size="11" fill="var(--muted)" font-family="Inter,system-ui,sans-serif">${showCtr ? `${t}%` : fmtNum(t)}</text>`;
  }).join("");

  let rightAxis = "";
  if (showImpr && showClicks) {
    const rightTicks = niceTicks(rightMax, 4);
    rightAxis = rightTicks.map((t) => {
      const gy = ycRight(t);
      return `<text x="${(W - pad.right + 8).toFixed(1)}" y="${(gy + 3).toFixed(1)}" text-anchor="start" font-size="11" fill="var(--muted-2)" font-family="Inter,system-ui,sans-serif">${fmtNum(t)}</text>`;
    }).join("");
  }

  // X-axis date labels — every ~7th
  const step = Math.max(1, Math.ceil(n / 8));
  const xLabels = dates.map((d, i) => {
    if (i % step !== 0 && i !== n - 1) return "";
    return `<text x="${xc(i).toFixed(1)}" y="${(H - pad.bottom + 18).toFixed(1)}" text-anchor="middle" font-size="11" fill="var(--muted)" font-family="Inter,system-ui,sans-serif">${esc(shortDate(d))}</text>`;
  }).join("");

  // Build paths
  let paths = "";
  let dots = "";
  let legend = [];

  if (showImpr && showClicks) {
    // Impressions: dashed line (right axis), no fill
    const imprPath = linePath(rows, (_, i) => xc(i), (r) => ycRight(r.impressions || 0));
    paths += `<path d="${imprPath}" fill="none" stroke="var(--muted-2)" stroke-width="1.5" stroke-dasharray="5 4" opacity="0.85"/>`;
    legend.push({ label: "Impressions", color: "var(--muted-2)", dashed: true });
  } else if (showImpr) {
    const imprPath = linePath(rows, (_, i) => xc(i), (r) => ycLeft(r.impressions || 0));
    const imprFill = imprPath + ` L ${xc(n-1).toFixed(1)} ${(pad.top+plotH).toFixed(1)} L ${pad.left.toFixed(1)} ${(pad.top+plotH).toFixed(1)} Z`;
    paths += `<path d="${imprFill}" fill="url(#sc-fill)"/>
              <path d="${imprPath}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    legend.push({ label: "Impressions", color: "var(--accent)" });
  }

  if (showClicks) {
    const clickPath = linePath(rows, (_, i) => xc(i), (r) => ycLeft(r.clicks || 0));
    const clickFill = clickPath + ` L ${xc(n-1).toFixed(1)} ${(pad.top+plotH).toFixed(1)} L ${pad.left.toFixed(1)} ${(pad.top+plotH).toFixed(1)} Z`;
    paths += `<path d="${clickFill}" fill="url(#sc-fill)"/>
              <path d="${clickPath}" fill="none" stroke="var(--accent)" stroke-width="2.25" stroke-linejoin="round" stroke-linecap="round"/>`;
    dots += rows.map((r, i) =>
      `<circle cx="${xc(i).toFixed(1)}" cy="${ycLeft(r.clicks || 0).toFixed(1)}" r="2.5" fill="var(--accent)"><title>${esc(shortDate(dates[i]))}: ${r.clicks || 0} clicks${showImpr ? ` · ${r.impressions || 0} impressions` : ""}</title></circle>`
    ).join("");
    legend.push({ label: "Clicks", color: "var(--accent)" });
  }

  if (showCtr) {
    const ctrPath = linePath(rows, (_, i) => xc(i), (r) => ycLeft((r.ctr || 0) * 100));
    paths += `<path d="${ctrPath}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round"/>`;
    dots += rows.map((r, i) =>
      `<circle cx="${xc(i).toFixed(1)}" cy="${ycLeft((r.ctr || 0) * 100).toFixed(1)}" r="2.5" fill="var(--accent)"><title>${esc(shortDate(dates[i]))}: ${((r.ctr || 0) * 100).toFixed(2)}% CTR</title></circle>`
    ).join("");
    legend.push({ label: "CTR", color: "var(--accent)" });
  }

  if (showPos) {
    const posPath = linePath(rows, (_, i) => xc(i), (r) => ycPos(r.position || 0));
    paths += `<path d="${posPath}" fill="none" stroke="var(--accent)" stroke-width="2"/>`;
    dots += rows.map((r, i) =>
      `<circle cx="${xc(i).toFixed(1)}" cy="${ycPos(r.position || 0).toFixed(1)}" r="2.5" fill="var(--accent)"><title>${esc(shortDate(dates[i]))}: position ${(r.position || 0).toFixed(1)}</title></circle>`
    ).join("");
    legend.push({ label: "Avg position", color: "var(--accent)" });
  }

  const legendHtml = `<div class="sc-chart-legend">
    ${legend.map((l) => `<span class="sc-legend-item"><span class="sc-legend-line" style="background:${l.color};${l.dashed ? "border-top:2px dashed " + l.color + ";background:transparent;" : ""}"></span>${l.label}</span>`).join("")}
  </div>`;

  chartEl.innerHTML = legendHtml + `
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Trend chart">
      <defs>
        <linearGradient id="sc-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.22"/>
          <stop offset="100%" stop-color="var(--accent)" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <g>${gridLines}</g>
      <g>${rightAxis}</g>
      ${paths}
      <g>${dots}</g>
      <g>${xLabels}</g>
    </svg>`;
}

function linePath(rows, xFn, yFn) {
  return rows.map((r, i) => `${i === 0 ? "M" : "L"} ${xFn(r, i).toFixed(1)} ${yFn(r, i).toFixed(1)}`).join(" ");
}

// ── Opportunities (high impressions, low CTR) ────────────────────────────────

function renderOpportunities(wrapper, result) {
  const el = wrapper.querySelector("#sc-opportunities");
  if (result.status !== "fulfilled") {
    el.innerHTML = `<div class="error-state">${esc(result.reason?.message || "Error")}</div>`;
    return;
  }
  const rows = result.value.rows;
  // Score = impressions × (industry-avg CTR for that position − actual CTR)
  // Industry-avg CTRs (Advanced Web Ranking 2024 averages, rough):
  const POS_CTR = { 1: 0.276, 2: 0.158, 3: 0.110, 4: 0.082, 5: 0.064, 6: 0.052, 7: 0.043, 8: 0.036, 9: 0.030, 10: 0.026 };
  const expectedCtr = (pos) => {
    if (pos <= 0) return 0;
    const k = Math.round(pos);
    if (k <= 10) return POS_CTR[k];
    if (k <= 20) return 0.018;
    return 0.008;
  };

  const opps = rows
    .filter((r) => (r.impressions || 0) >= 50 && r.position && r.position <= 30)
    .map((r) => {
      const expected = expectedCtr(r.position);
      const gap = expected - (r.ctr || 0);
      const potentialClicks = Math.max(0, Math.round((r.impressions || 0) * gap));
      return { ...r, expected, gap, potentialClicks };
    })
    .filter((r) => r.potentialClicks >= 3)
    .sort((a, b) => b.potentialClicks - a.potentialClicks)
    .slice(0, 10);

  if (!opps.length) {
    el.innerHTML = `<div class="empty-state">No clear opportunities found — your titles &amp; meta look well-tuned for the queries you rank for.</div>`;
    return;
  }

  el.innerHTML = `
    <table class="table sc-table">
      <thead>
        <tr>
          <th>Query</th>
          <th style="text-align:right;">Impressions</th>
          <th style="text-align:right;">Position</th>
          <th style="text-align:right;">Current CTR</th>
          <th style="text-align:right;">Expected CTR</th>
          <th style="text-align:right;">Potential clicks</th>
        </tr>
      </thead>
      <tbody>
        ${opps.map((r) => `<tr>
          <td class="sc-dim-cell"><span class="sc-dim-label" title="${esc(r.keys[0])}">${esc(r.keys[0])}</span></td>
          <td class="num">${fmtNum(r.impressions)}</td>
          <td class="num">${r.position.toFixed(1)}</td>
          <td class="num">${(r.ctr * 100).toFixed(1)}%</td>
          <td class="num" style="color:var(--muted);">${(r.expected * 100).toFixed(1)}%</td>
          <td class="num"><span class="sc-pot-chip">+${r.potentialClicks}</span></td>
        </tr>`).join("")}
      </tbody>
    </table>`;
}

// ── Rising + Falling queries ─────────────────────────────────────────────────

function renderRisingFalling(wrapper, result) {
  const riseEl = wrapper.querySelector("#sc-rising");
  const fallEl = wrapper.querySelector("#sc-falling");

  if (result.status !== "fulfilled") {
    const msg = `<div class="error-state">${esc(result.reason?.message || "Error")}</div>`;
    riseEl.innerHTML = msg; fallEl.innerHTML = msg;
    return;
  }

  const rows = result.value.rows;
  const compareRows = result.value.compareRows || [];
  if (!compareRows.length) {
    const msg = `<div class="empty-state">Comparison data unavailable.</div>`;
    riseEl.innerHTML = msg; fallEl.innerHTML = msg;
    return;
  }

  const compareMap = new Map(compareRows.map((r) => [r.keys?.[0], r]));
  const annotated = rows.map((r) => {
    const prev = compareMap.get(r.keys?.[0]);
    return {
      query:   r.keys[0],
      cur:     r.clicks || 0,
      prev:    prev?.clicks || 0,
      delta:   (r.clicks || 0) - (prev?.clicks || 0),
      position: r.position || 0,
      curImpr: r.impressions || 0,
    };
  });

  // Also include queries that USED to get clicks but no longer appear
  for (const p of compareRows) {
    if (!rows.find((r) => r.keys?.[0] === p.keys?.[0])) {
      annotated.push({
        query: p.keys[0],
        cur:   0,
        prev:  p.clicks || 0,
        delta: -(p.clicks || 0),
        position: p.position || 0,
        curImpr: 0,
      });
    }
  }

  const risers = annotated
    .filter((r) => r.delta > 0 && r.prev >= 0)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 8);

  const fallers = annotated
    .filter((r) => r.delta < 0 && r.prev >= 3)
    .sort((a, b) => a.delta - b.delta)
    .slice(0, 8);

  riseEl.innerHTML = risers.length ? rfTable(risers, "up") : `<div class="empty-state">No notable risers this period.</div>`;
  fallEl.innerHTML = fallers.length ? rfTable(fallers, "down") : `<div class="empty-state">No notable fallers — nice and steady.</div>`;
}

function rfTable(rows, dir) {
  return `
    <table class="table sc-table">
      <thead>
        <tr>
          <th>Query</th>
          <th style="text-align:right;">Prev</th>
          <th style="text-align:right;">Now</th>
          <th style="text-align:right;">Change</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((r) => `<tr>
          <td class="sc-dim-cell"><span class="sc-dim-label" title="${esc(r.query)}">${esc(r.query)}</span></td>
          <td class="num" style="color:var(--muted);">${r.prev}</td>
          <td class="num">${r.cur}</td>
          <td class="num"><span class="sc-delta-chip is-${dir}">${r.delta > 0 ? "+" : ""}${r.delta}</span></td>
        </tr>`).join("")}
      </tbody>
    </table>`;
}

// ── Brand vs Discovery ──────────────────────────────────────────────────────

function renderBrandSplit(wrapper, queriesResult, overviewResult) {
  const el = wrapper.querySelector("#sc-brand-split");
  if (queriesResult.status !== "fulfilled") {
    el.innerHTML = `<div class="error-state">${esc(queriesResult.reason?.message || "Error")}</div>`;
    return;
  }
  const rows = queriesResult.value.rows;
  let brand = { clicks: 0, impressions: 0 };
  let discovery = { clicks: 0, impressions: 0 };
  for (const r of rows) {
    const q = String(r.keys?.[0] || "").toLowerCase();
    const isBrand = BRAND_TERMS.some((t) => q.includes(t));
    const target = isBrand ? brand : discovery;
    target.clicks      += r.clicks || 0;
    target.impressions += r.impressions || 0;
  }

  // Totals (from overview, since queries is capped at 100 rows)
  let totalClicks = 0, totalImpr = 0;
  if (overviewResult.status === "fulfilled") {
    const o = overviewResult.value.rows[0] || {};
    totalClicks = o.clicks || 0;
    totalImpr   = o.impressions || 0;
  }

  // "Other" = clicks not in the top 100 queries we fetched (privacy-anonymized, etc.)
  const other = {
    clicks:      Math.max(0, totalClicks - brand.clicks - discovery.clicks),
    impressions: Math.max(0, totalImpr   - brand.impressions - discovery.impressions),
  };

  const totalForBar = brand.clicks + discovery.clicks + other.clicks || 1;
  const bShare = (brand.clicks / totalForBar) * 100;
  const dShare = (discovery.clicks / totalForBar) * 100;
  const oShare = (other.clicks / totalForBar) * 100;

  el.innerHTML = `
    <div class="sc-split">
      <div class="sc-split-bar">
        <div class="sc-split-seg sc-seg-discovery" style="width:${dShare.toFixed(1)}%;" title="Discovery: ${discovery.clicks} clicks"></div>
        <div class="sc-split-seg sc-seg-brand"     style="width:${bShare.toFixed(1)}%;" title="Brand: ${brand.clicks} clicks"></div>
        <div class="sc-split-seg sc-seg-other"     style="width:${oShare.toFixed(1)}%;" title="Other / privacy-anonymized: ${other.clicks} clicks"></div>
      </div>
      <div class="sc-split-legend">
        <div class="sc-split-item">
          <div class="sc-split-swatch sc-seg-discovery"></div>
          <div>
            <div class="sc-split-label">Discovery (topic searches)</div>
            <div class="sc-split-val">${fmtNum(discovery.clicks)} clicks · ${fmtNum(discovery.impressions)} impr · ${dShare.toFixed(0)}%</div>
          </div>
        </div>
        <div class="sc-split-item">
          <div class="sc-split-swatch sc-seg-brand"></div>
          <div>
            <div class="sc-split-label">Brand searches</div>
            <div class="sc-split-val">${fmtNum(brand.clicks)} clicks · ${fmtNum(brand.impressions)} impr · ${bShare.toFixed(0)}%</div>
          </div>
        </div>
        ${other.clicks > 0 ? `<div class="sc-split-item">
          <div class="sc-split-swatch sc-seg-other"></div>
          <div>
            <div class="sc-split-label">Other (anonymized long-tail)</div>
            <div class="sc-split-val">${fmtNum(other.clicks)} clicks · ${oShare.toFixed(0)}%</div>
          </div>
        </div>` : ""}
      </div>
      ${dShare > 50
        ? `<div class="sc-callout sc-callout-good">More than half your clicks come from people who don't know Catalyst yet — your discovery funnel is working.</div>`
        : dShare > 25
        ? `<div class="sc-callout sc-callout-info">Brand traffic dominates — readers know you. Building topic-specific content could open new discovery channels.</div>`
        : `<div class="sc-callout sc-callout-warn">Most clicks are people searching for "Catalyst" directly. Topic-focused articles ranked higher could bring new readers in.</div>`}
    </div>`;
}

// ── Generic ranked table (used for queries / pages / countries / devices) ────

function renderRankedTable(wrapper, selector, result, dimKey, opts = {}) {
  const el = wrapper.querySelector(selector);
  if (!el) return;
  if (result.status !== "fulfilled") {
    el.innerHTML = `<div class="error-state">${esc(result.reason?.message || "Error loading data")}</div>`;
    return;
  }
  const allRows = result.value.rows;
  if (!allRows.length) {
    el.innerHTML = `<div class="empty-state">No data for this period.</div>`;
    return;
  }
  const rows = allRows.slice(0, opts.topN || 10);

  const maxClicks = Math.max(1, ...rows.map((r) => r.clicks || 0));
  const isPage = dimKey === "page";
  const isCountry = dimKey === "country";
  const isDevice = dimKey === "device";
  const isAppearance = dimKey === "searchAppearance";

  // Compare map for query/page delta chips
  const compareRows = result.value.compareRows || [];
  const compareMap = new Map(compareRows.map((r) => [r.keys?.[0], r]));
  const showDelta = compareRows.length > 0 && (dimKey === "query" || dimKey === "page");

  el.innerHTML = `
    <table class="table sc-table">
      <thead>
        <tr>
          <th>${dimKey === "query" ? "Query" : isPage ? "Page" : isCountry ? "Country" : isDevice ? "Device" : "Appearance"}</th>
          <th class="num">Clicks</th>
          ${showDelta ? `<th class="num">Δ</th>` : ""}
          <th class="num">Impr.</th>
          <th class="num">CTR</th>
          <th class="num">Pos.</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((r) => {
          const dim = r.keys?.[0] || "—";
          let label;
          if (isPage)        label = pagePath(dim);
          else if (isCountry) label = countryName(dim);
          else if (isDevice) label = titleCase(dim);
          else if (isAppearance) label = appearanceLabel(dim);
          else label = dim;
          const href  = isPage ? dim : null;
          const pct   = Math.round(((r.clicks || 0) / maxClicks) * 100);

          let deltaCell = "";
          if (showDelta) {
            const prev = compareMap.get(dim);
            const delta = (r.clicks || 0) - (prev?.clicks || 0);
            const dir = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
            deltaCell = `<td class="num">${delta !== 0 ? `<span class="sc-delta-chip is-${dir}">${delta > 0 ? "+" : ""}${delta}</span>` : "—"}</td>`;
          }

          return `<tr>
            <td class="sc-dim-cell">
              <div class="sc-bar-wrap">
                <div class="sc-bar" style="width:${pct}%"></div>
                <span class="sc-dim-label" title="${esc(dim)}">${href ? `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(label)}</a>` : esc(label)}</span>
              </div>
            </td>
            <td class="num strong">${fmtNum(r.clicks || 0)}</td>
            ${deltaCell}
            <td class="num muted">${fmtNum(r.impressions || 0)}</td>
            <td class="num">${r.ctr != null ? `${(r.ctr * 100).toFixed(1)}%` : "—"}</td>
            <td class="num muted">${r.position != null ? r.position.toFixed(1) : "—"}</td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>`;
}

// ── CSV export ──────────────────────────────────────────────────────────────

function exportCsv(which, data) {
  let rows = [];
  let header = [];
  let name = `gsc-${which}-${isoDate(new Date())}.csv`;

  if (which === "queries" && data.queries?.status === "fulfilled") {
    header = ["Query", "Clicks", "Impressions", "CTR", "Position"];
    rows = data.queries.value.rows.map((r) => [
      r.keys[0], r.clicks || 0, r.impressions || 0, ((r.ctr || 0) * 100).toFixed(2) + "%", (r.position || 0).toFixed(1),
    ]);
  } else if (which === "pages" && data.pages?.status === "fulfilled") {
    header = ["Page", "Clicks", "Impressions", "CTR", "Position"];
    rows = data.pages.value.rows.map((r) => [
      r.keys[0], r.clicks || 0, r.impressions || 0, ((r.ctr || 0) * 100).toFixed(2) + "%", (r.position || 0).toFixed(1),
    ]);
  } else if (which === "opportunities" && data.queries?.status === "fulfilled") {
    header = ["Query", "Impressions", "Position", "Current CTR", "Potential clicks"];
    // Re-compute opportunities same as in renderOpportunities
    const POS_CTR = { 1: 0.276, 2: 0.158, 3: 0.110, 4: 0.082, 5: 0.064, 6: 0.052, 7: 0.043, 8: 0.036, 9: 0.030, 10: 0.026 };
    const expectedCtr = (pos) => {
      if (pos <= 0) return 0;
      const k = Math.round(pos);
      return POS_CTR[k] || (k <= 20 ? 0.018 : 0.008);
    };
    rows = data.queries.value.rows
      .filter((r) => (r.impressions || 0) >= 50 && r.position && r.position <= 30)
      .map((r) => ({
        q: r.keys[0],
        imp: r.impressions || 0,
        pos: r.position,
        ctr: r.ctr || 0,
        potential: Math.max(0, Math.round((r.impressions || 0) * (expectedCtr(r.position) - (r.ctr || 0)))),
      }))
      .filter((r) => r.potential >= 3)
      .sort((a, b) => b.potential - a.potential)
      .map((r) => [r.q, r.imp, r.pos.toFixed(1), (r.ctr * 100).toFixed(2) + "%", r.potential]);
  }

  if (!rows.length) return;

  const csv = [header, ...rows].map((row) =>
    row.map((cell) => {
      const s = String(cell ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(",")
  ).join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── Utilities ───────────────────────────────────────────────────────────────

function shortDate(yyyyMmDd) {
  if (!yyyyMmDd) return "";
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function humanDate(yyyyMmDd) {
  if (!yyyyMmDd) return "";
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function pagePath(url) {
  try { return new URL(url).pathname || url; } catch { return url; }
}

function titleCase(s) {
  return (s || "—").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// GSC returns ISO-3166-alpha-3 country codes (USA, GBR, etc.).
const COUNTRY_NAMES = {
  USA: "🇺🇸 United States", GBR: "🇬🇧 United Kingdom", CAN: "🇨🇦 Canada", AUS: "🇦🇺 Australia",
  IND: "🇮🇳 India", DEU: "🇩🇪 Germany", FRA: "🇫🇷 France", ITA: "🇮🇹 Italy", ESP: "🇪🇸 Spain",
  NLD: "🇳🇱 Netherlands", BRA: "🇧🇷 Brazil", MEX: "🇲🇽 Mexico", JPN: "🇯🇵 Japan", KOR: "🇰🇷 South Korea",
  CHN: "🇨🇳 China", IDN: "🇮🇩 Indonesia", PHL: "🇵🇭 Philippines", PAK: "🇵🇰 Pakistan", BGD: "🇧🇩 Bangladesh",
  NGA: "🇳🇬 Nigeria", ZAF: "🇿🇦 South Africa", EGY: "🇪🇬 Egypt", KEN: "🇰🇪 Kenya",
  RUS: "🇷🇺 Russia", POL: "🇵🇱 Poland", SWE: "🇸🇪 Sweden", NOR: "🇳🇴 Norway", DNK: "🇩🇰 Denmark",
  IRL: "🇮🇪 Ireland", NZL: "🇳🇿 New Zealand", SGP: "🇸🇬 Singapore", HKG: "🇭🇰 Hong Kong",
  TWN: "🇹🇼 Taiwan", THA: "🇹🇭 Thailand", VNM: "🇻🇳 Vietnam", MYS: "🇲🇾 Malaysia",
  ARE: "🇦🇪 United Arab Emirates", SAU: "🇸🇦 Saudi Arabia", ISR: "🇮🇱 Israel", TUR: "🇹🇷 Turkey",
  ARG: "🇦🇷 Argentina", CHL: "🇨🇱 Chile", COL: "🇨🇴 Colombia", PER: "🇵🇪 Peru",
};
function countryName(code) {
  if (!code) return "—";
  return COUNTRY_NAMES[code.toUpperCase()] || code.toUpperCase();
}

function appearanceLabel(s) {
  // GSC sends raw enum values like "AMP_TOP_STORIES", "ARTICLE", etc.
  return titleCase((s || "").replace(/_/g, " ").toLowerCase());
}

function niceMax(v) {
  if (!v || v <= 0) return 4;
  if (v <= 4) return 4;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const norm = v / pow;
  const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return nice * pow;
}

function niceTicks(max, count) {
  const step = max / count;
  return Array.from({ length: count + 1 }, (_, i) => Math.round(step * i));
}
