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

// Plain-English glossary — every technical term shown on this page has an
// entry here. tip(key, label) wraps the label in a hover/tap-able dotted
// underline. Keys are lowercased and stripped of punctuation for lookups.
const GLOSSARY = {
  "clicks":           "How many times someone clicked one of your pages from a Google search result.",
  "impressions":      "How many times one of your pages appeared in someone's Google search results — whether or not they clicked.",
  "ctr":              "Click-through rate: clicks divided by impressions, shown as a percentage. Higher means more people who saw you actually clicked.",
  "click-through rate": "Clicks divided by impressions, shown as a percentage. Higher means more people who saw you actually clicked.",
  "avg. position":    "The average ranking spot your pages appeared in across all queries. Position 1 = top of results. Lower is better.",
  "avg position":     "The average ranking spot your pages appeared in across all queries. Position 1 = top of results. Lower is better.",
  "position":         "The average ranking spot a page appeared in for this query in Google search results. 1 = top of page. Lower numbers are better.",
  "query":            "The exact words someone typed into Google when they saw or clicked one of your pages.",
  "queries":          "The exact phrases people searched on Google that led to your pages being shown.",
  "page":             "A specific article or page on catalyst-magazine.com.",
  "pages":            "Specific articles or pages on catalyst-magazine.com.",
  "performance":      "Your overall search numbers — clicks, impressions, CTR and position.",
  "rising":           "Queries where you got more clicks this period than the previous one — your content is gaining momentum here.",
  "falling":          "Queries where you got fewer clicks this period than the previous one — content may need refreshing or has lost visibility.",
  "queries gaining clicks": "Search terms where you got more clicks than in the previous period — content is gaining traction.",
  "queries losing clicks":  "Search terms where you got fewer clicks than in the previous period — worth investigating.",
  "quick wins":       "Queries you already rank decently for and that get lots of impressions, but few people actually click. Tweaking titles and meta descriptions usually fixes this.",
  "high impressions, low ctr": "Queries Google already shows you for, but where the CTR is below industry average. Easy wins.",
  "opportunities":    "Queries where a small change to titles or meta descriptions could earn meaningful extra clicks.",
  "potential clicks": "Estimated extra clicks you'd get if your CTR for this query matched the industry average for its position.",
  "expected ctr":     "The CTR an average site gets at this ranking position. If yours is much lower, that's the opportunity.",
  "brand":            "People who searched specifically for \"Catalyst Magazine\" — they already know you.",
  "discovery":        "People who searched for a topic and found Catalyst — first-time discovery of your brand.",
  "brand vs discovery":      "Brand = people searching \"Catalyst Magazine\" by name. Discovery = topic searches that lead them to you for the first time.",
  "brand vs. discovery":     "Brand = people searching \"Catalyst Magazine\" by name. Discovery = topic searches that lead them to you for the first time.",
  "search appearance": "How Google chose to show your page in results — as a regular link, a news card, an AMP page, etc.",
  "source":           "Which Google surface the data is from: standard Web search, Image, News, or Discover feed.",
  "google search console": "Google's free tool for tracking how your site performs in their search results.",
  "performance over time":  "How your clicks and impressions change day by day over the chosen period.",
  "what's happening right now": "Plain-English takeaways comparing your current period to the previous one of the same length.",
};

function tipKey(s) {
  return String(s || "").toLowerCase().replace(/[.,:]/g, "").trim();
}

// Wraps a label in a tooltip span if there's a matching glossary entry.
// Use this for ANY technical term shown on this page.
function tip(label, opts = {}) {
  const explicit = opts.term ? tipKey(opts.term) : null;
  const key = explicit || tipKey(label);
  const def = GLOSSARY[key];
  if (!def) return esc(label);
  return `<span class="sc-tip" tabindex="0" data-tip="${esc(def)}" aria-label="${esc(label)}: ${esc(def)}">${esc(label)}</span>`;
}

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
            ${tip("Google Search Console")}
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
              <button type="button" class="sc-range-btn sc-range-custom-btn" id="sc-range-custom-btn" aria-haspopup="dialog" aria-expanded="false">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                <span>Custom</span>
              </button>
            </div>
            <div class="sc-custom-popover" id="sc-custom-popover" role="dialog" aria-label="Custom date range" hidden>
              <div class="sc-custom-popover-title">Pick a custom range</div>
              <div class="sc-custom-fields">
                <label>Start
                  <input type="date" id="sc-custom-start">
                </label>
                <label>End
                  <input type="date" id="sc-custom-end">
                </label>
              </div>
              <div class="sc-custom-presets">
                <button type="button" class="sc-preset-chip" data-preset="yesterday">Yesterday</button>
                <button type="button" class="sc-preset-chip" data-preset="last5">Last 5 days</button>
                <button type="button" class="sc-preset-chip" data-preset="last14">Last 14 days</button>
                <button type="button" class="sc-preset-chip" data-preset="thismonth">This month</button>
                <button type="button" class="sc-preset-chip" data-preset="lastmonth">Last month</button>
              </div>
              <div class="sc-custom-footer">
                <span class="sc-custom-note" id="sc-custom-note">GSC allows up to 16 months back.</span>
                <div style="display:flex;gap:8px;">
                  <button type="button" class="sc-ghost-btn" id="sc-custom-cancel">Cancel</button>
                  <button type="button" class="sc-apply-btn" id="sc-custom-apply">Apply</button>
                </div>
              </div>
            </div>
          </div>
          <div class="sc-control-group">
            <label class="sc-control-label" for="sc-search-type">${tip("Source")}</label>
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
          <h2 class="sc-section-title">${tip("What's happening right now")}</h2>
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
          <h2 class="sc-card-title">${tip("Performance over time")}</h2>
          <p class="sc-card-sub">Daily trend across the selected period. Use the toggle to focus on one metric.</p>
        </div>
        <div class="sc-chart-toggle" id="sc-chart-toggle" role="group" aria-label="Chart metric">
          <button type="button" class="sc-chart-toggle-btn is-active" data-metric="both">Both</button>
          <button type="button" class="sc-chart-toggle-btn" data-metric="clicks">Clicks</button>
          <button type="button" class="sc-chart-toggle-btn" data-metric="impressions">Impressions</button>
          <button type="button" class="sc-chart-toggle-btn" data-metric="ctr" title="Click-through rate — clicks ÷ impressions">CTR</button>
          <button type="button" class="sc-chart-toggle-btn" data-metric="position" title="Average ranking spot — 1 is best">Position</button>
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
          <h2 class="sc-card-title">${tip("Quick wins", { term: "quick wins" })} — ${tip("high impressions, low CTR")}</h2>
          <p class="sc-card-sub">${tip("Queries")} Google is already showing you for, but few people click. Improve titles and meta descriptions to capture this traffic.</p>
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
            <h2 class="sc-card-title">${tip("Queries gaining clicks")}</h2>
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
            <h2 class="sc-card-title">${tip("Queries losing clicks")}</h2>
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
            <h2 class="sc-card-title">Top ${tip("queries")}</h2>
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
            <h2 class="sc-card-title">Top ${tip("pages")}</h2>
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
            <h3 class="sc-card-title">${tip("Brand vs. discovery")} traffic</h3>
            <p class="sc-card-sub"><strong>${tip("Brand")}</strong>: people searching "Catalyst Magazine" by name. <strong>${tip("Discovery")}</strong>: topic searches that lead them to you for the first time.</p>
          </div>
        </div>
        <div class="sc-card-body" id="sc-brand-split"><div class="loading-state"><div class="spinner"></div></div></div>
      </section>

      <div class="sc-grid-2">
        <section class="sc-card">
          <div class="sc-card-head">
            <div>
              <h3 class="sc-card-title">Where readers search from</h3>
              <p class="sc-card-sub">Country breakdown from Google Search Console, plus first-party state &amp; city visits.</p>
            </div>
            <div class="sc-geo-tabs" role="tablist" aria-label="Geography view">
              <button type="button" class="sc-geo-tab is-active" data-geo-tab="countries" role="tab" aria-selected="true">Countries</button>
              <button type="button" class="sc-geo-tab" data-geo-tab="places" role="tab" aria-selected="false">States &amp; cities</button>
            </div>
          </div>
          <div class="sc-card-body sc-geo-panels">
            <div class="sc-geo-panel is-active" data-geo-panel="countries" id="sc-countries"><div class="loading-state"><div class="spinner"></div></div></div>
            <div class="sc-geo-panel" data-geo-panel="places" hidden>
              <div class="sc-places-toolbar">
                <label class="sc-places-search">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                  <input type="search" id="sc-places-search" placeholder="Search city, state, or country…" autocomplete="off" aria-label="Filter states and cities">
                </label>
                <div class="sc-places-mode" role="group" aria-label="Group by">
                  <button type="button" class="sc-places-mode-btn is-active" data-places-mode="city" aria-pressed="true">By city</button>
                  <button type="button" class="sc-places-mode-btn" data-places-mode="state" aria-pressed="false">By state</button>
                </div>
              </div>
              <div id="sc-places-body"><div class="loading-state"><div class="spinner"></div></div></div>
            </div>
          </div>
        </section>
        <section class="sc-card">
          <div class="sc-card-head">
            <h3 class="sc-card-title">Device mix</h3>
          </div>
          <div class="sc-card-body" id="sc-devices"><div class="loading-state"><div class="spinner"></div></div></div>
        </section>
      </div>

      <section class="sc-card sc-map-card">
        <div class="sc-card-head">
          <div>
            <h3 class="sc-card-title">Reader geography map</h3>
            <p class="sc-card-sub">City-level site visits when available, with Search Console country data as a fallback. Hover or tap a marker for details.</p>
          </div>
        </div>
        <div class="sc-card-body" id="sc-geo-map"><div class="loading-state"><div class="spinner"></div></div></div>
      </section>

      <section class="sc-card" id="sc-appearance-card" style="display:none;">
        <div class="sc-card-head">
          <div>
            <h3 class="sc-card-title">${tip("Search appearance")}</h3>
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

  // State held in closures.
  // range is either { kind: "preset", days } or { kind: "custom", startDate, endDate }
  const state = {
    range: { kind: "preset", days: 28 },
    searchType: "web",
    chartMetric: "both",
    lastData: {},
  };

  // Preset range buttons
  const rangePicker = wrapper.querySelector("#sc-range-picker");
  const customBtn   = wrapper.querySelector("#sc-range-custom-btn");
  const customPop   = wrapper.querySelector("#sc-custom-popover");
  const customStart = wrapper.querySelector("#sc-custom-start");
  const customEnd   = wrapper.querySelector("#sc-custom-end");
  const customNote  = wrapper.querySelector("#sc-custom-note");

  function setActiveRangeButton(target) {
    rangePicker.querySelectorAll(".sc-range-btn").forEach((b) => {
      b.classList.toggle("is-active", b === target);
      if (b.getAttribute("role") === "tab") {
        b.setAttribute("aria-selected", b === target ? "true" : "false");
      }
    });
  }

  rangePicker.addEventListener("click", (e) => {
    const btn = e.target.closest(".sc-range-btn:not(.sc-range-custom-btn)");
    if (!btn) return;
    state.range = { kind: "preset", days: Number(btn.dataset.days) };
    setActiveRangeButton(btn);
    closeCustomPopover();
    loadAll(ctx, wrapper, state);
  });

  // Custom range popover
  function openCustomPopover() {
    // Seed the date inputs with today / today-7d as a sensible default
    const today = new Date();
    today.setDate(today.getDate() - 2); // respect GSC lag
    const seven = new Date(today);
    seven.setDate(seven.getDate() - 6);
    if (!customStart.value) customStart.value = isoDate(seven);
    if (!customEnd.value)   customEnd.value   = isoDate(today);
    const maxDate = isoDate(today);
    const minDate = isoDate(new Date(today.getTime() - 16 * 30 * 24 * 60 * 60 * 1000)); // ~16 months
    customStart.max = maxDate; customStart.min = minDate;
    customEnd.max = maxDate;   customEnd.min = minDate;
    customPop.hidden = false;
    customBtn.setAttribute("aria-expanded", "true");
    updateCustomNote();
  }
  function closeCustomPopover() {
    customPop.hidden = true;
    customBtn.setAttribute("aria-expanded", "false");
  }
  function updateCustomNote() {
    const s = customStart.value, e = customEnd.value;
    if (!s || !e) { customNote.textContent = "Pick a start and end date."; return; }
    if (s > e) { customNote.textContent = "Start date must be before end date."; customNote.style.color = "var(--sc-bad, #b91c1c)"; return; }
    const days = Math.round((new Date(e) - new Date(s)) / 86400000) + 1;
    customNote.style.color = "";
    customNote.textContent = `${days} day${days === 1 ? "" : "s"} selected`;
  }

  customBtn.addEventListener("click", () => {
    if (customPop.hidden) openCustomPopover(); else closeCustomPopover();
  });
  customStart.addEventListener("change", updateCustomNote);
  customEnd.addEventListener("change", updateCustomNote);

  // Quick presets inside the custom popover
  customPop.querySelectorAll(".sc-preset-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const today = new Date();
      today.setDate(today.getDate() - 2);
      const set = (start, end) => { customStart.value = isoDate(start); customEnd.value = isoDate(end); updateCustomNote(); };
      const kind = chip.dataset.preset;
      if (kind === "yesterday") { set(today, today); }
      else if (kind === "last5") { const s = new Date(today); s.setDate(s.getDate() - 4); set(s, today); }
      else if (kind === "last14") { const s = new Date(today); s.setDate(s.getDate() - 13); set(s, today); }
      else if (kind === "thismonth") {
        const s = new Date(today.getFullYear(), today.getMonth(), 1);
        set(s, today);
      } else if (kind === "lastmonth") {
        const s = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        const e = new Date(today.getFullYear(), today.getMonth(), 0);
        set(s, e);
      }
    });
  });

  wrapper.querySelector("#sc-custom-cancel").addEventListener("click", closeCustomPopover);
  wrapper.querySelector("#sc-custom-apply").addEventListener("click", () => {
    const s = customStart.value, e = customEnd.value;
    if (!s || !e || s > e) { customNote.style.color = "var(--sc-bad, #b91c1c)"; customNote.textContent = "Please pick a valid range first."; return; }
    state.range = { kind: "custom", startDate: s, endDate: e };
    setActiveRangeButton(customBtn);
    closeCustomPopover();
    loadAll(ctx, wrapper, state);
  });

  // Click outside closes the popover
  document.addEventListener("click", (e) => {
    if (customPop.hidden) return;
    if (customPop.contains(e.target) || customBtn.contains(e.target)) return;
    closeCustomPopover();
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
    if (state.lastData.dates?.status === "fulfilled") {
      renderTrendChart(wrapper, state.lastData.dates.value.rows, state.chartMetric);
    }
  });

  // CSV exporter
  wrapper.addEventListener("click", (e) => {
    const btn = e.target.closest(".sc-csv-btn");
    if (!btn) return;
    const which = btn.dataset.csv;
    exportCsv(which, state.lastData);
  });

  // Geo tab switching (Countries ↔ States & cities) inside "Where readers search from"
  state.placesQuery = "";
  state.placesMode = "city";
  wrapper.addEventListener("click", (e) => {
    const tab = e.target.closest(".sc-geo-tab");
    if (!tab) return;
    const panelKey = tab.dataset.geoTab;
    wrapper.querySelectorAll(".sc-geo-tab").forEach((b) => {
      const on = b === tab;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    wrapper.querySelectorAll(".sc-geo-panel").forEach((p) => {
      const on = p.dataset.geoPanel === panelKey;
      p.classList.toggle("is-active", on);
      p.hidden = !on;
    });
    if (panelKey === "places") renderPlacesPanel(wrapper, state);
  });

  // Group-by toggle (city / state) inside the places panel
  wrapper.addEventListener("click", (e) => {
    const btn = e.target.closest(".sc-places-mode-btn");
    if (!btn) return;
    state.placesMode = btn.dataset.placesMode;
    wrapper.querySelectorAll(".sc-places-mode-btn").forEach((b) => {
      const on = b === btn;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    renderPlacesPanel(wrapper, state);
  });

  // Live filter as the user types in the places search box
  const placesSearchInput = wrapper.querySelector("#sc-places-search");
  if (placesSearchInput) {
    placesSearchInput.addEventListener("input", (e) => {
      state.placesQuery = e.target.value || "";
      renderPlacesPanel(wrapper, state);
    });
  }

  loadAll(ctx, wrapper, state);
}

// ── Data loading ─────────────────────────────────────────────────────────────

// Resolve any range descriptor to an absolute start/end pair.
function resolveRange(range) {
  if (range.kind === "custom") {
    return { startDate: range.startDate, endDate: range.endDate };
  }
  const days = range.days || 28;
  const end = new Date();
  end.setDate(end.getDate() - 2); // GSC lags ~2 days
  const start = new Date(end);
  start.setDate(start.getDate() - (days - 1));
  return { startDate: isoDate(start), endDate: isoDate(end) };
}

// Compute the equal-length prior comparison window for a given range.
function priorRange(range) {
  const cur = resolveRange(range);
  const curStart = new Date(cur.startDate);
  const curEnd   = new Date(cur.endDate);
  const days = Math.round((curEnd - curStart) / 86400000) + 1;
  const prevEnd = new Date(curStart);
  prevEnd.setDate(prevEnd.getDate() - 1);
  const prevStart = new Date(prevEnd);
  prevStart.setDate(prevStart.getDate() - (days - 1));
  return {
    compareStartDate: isoDate(prevStart),
    compareEndDate:   isoDate(prevEnd),
  };
}

function isoDate(d) {
  const dd = d instanceof Date ? d : new Date(d);
  return dd.toISOString().slice(0, 10);
}

async function gscQuery(ctx, type, range, opts = {}) {
  const { startDate, endDate } = resolveRange(range);
  const cmp = opts.compare ? priorRange(range) : {};
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

async function geoVisitQuery(ctx, range) {
  // Align the start date with the GSC window so the map and the country
  // table describe the same period — but EXTEND the end date through
  // today. GSC lags Google's pipeline by ~2 days, so resolveRange() ends
  // at today-2. First-party site_geo_daily docs, on the other hand, are
  // written live with `date = today`, so using GSC's end date would
  // silently drop the last 2 days of city visits — the most recent and
  // most interesting ones — and the U.S. city view appears "broken".
  const gsc = resolveRange(range);
  let startDate = gsc.startDate;
  const today = isoDate(new Date());
  let endDate = today > gsc.endDate ? today : gsc.endDate;
  // For custom ranges the user picked specific dates — honor the end
  // they chose; don't push it forward past their intent.
  if (range.kind === "custom") {
    startDate = range.startDate;
    endDate = range.endDate;
  }
  // Pull a generous slice — site_geo_daily docs are keyed per
  // date×country×region×city, so a 90-day window with ~20 cities/day
  // can approach a few hundred. The API caps results at 500.
  const params = new URLSearchParams({ startDate, endDate, limit: "500" });
  const res = await ctx.authedFetch(`/api/analytics/geo?${params.toString()}`);
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return { rows: data.rows || [] };
}

async function loadAll(ctx, wrapper, state) {
  const { range, searchType } = state;

  // Update period labels in the note
  const cur = resolveRange(range);
  const prev = priorRange(range);
  wrapper.querySelector("#sc-period-current").textContent = `${humanDate(cur.startDate)} – ${humanDate(cur.endDate)}`;
  wrapper.querySelector("#sc-period-prev").textContent = `${humanDate(prev.compareStartDate)} – ${humanDate(prev.compareEndDate)}`;

  // Reset panels to loading
  ["sc-trend-chart", "sc-opportunities", "sc-rising", "sc-falling",
   "sc-brand-split", "sc-queries", "sc-pages", "sc-countries", "sc-devices",
   "sc-geo-map", "sc-appearance"].forEach((id) => {
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

  const [overview, dates, queries, pages, countries, devices, appearance, geoVisits] = await Promise.allSettled([
    gscQuery(ctx, "overview",  range, { ...optsCmp }),
    gscQuery(ctx, "dates",     range, { ...opts, rowLimit: 365 }),
    gscQuery(ctx, "queries",   range, { ...optsCmp, rowLimit: 100 }),
    gscQuery(ctx, "pages",     range, { ...optsCmp, rowLimit: 50 }),
    gscQuery(ctx, "countries", range, { ...optsCmp, rowLimit: 15 }),
    gscQuery(ctx, "devices",   range, { ...opts, rowLimit: 5  }),
    gscQuery(ctx, "searchAppearance", range, { ...opts, rowLimit: 15 }),
    geoVisitQuery(ctx, range),
  ]);

  // Stash everything for CSV export + chart toggle
  state.lastData = {
    overview, dates, queries, pages, countries, devices, appearance, geoVisits, range, searchType,
  };

  // ── KPIs ──
  if (overview.status === "fulfilled") {
    const cur  = overview.value.rows[0]  || {};
    const prev = overview.value.compareRows?.[0] || null;

    setKpi(wrapper, "clicks", fmtNum(cur.clicks || 0), prev?.clicks, { current: cur.clicks || 0 });
    setKpi(wrapper, "impr",   fmtNum(cur.impressions || 0), prev?.impressions, { current: cur.impressions || 0 });

    const curCtr  = cur.ctr  != null ? cur.ctr  * 100 : null;
    const prevCtr = prev?.ctr != null ? prev.ctr * 100 : null;
    setKpi(wrapper, "ctr", curCtr != null ? `${curCtr.toFixed(1)}%` : "—", prevCtr, { suffix: "pp", absoluteDelta: true, current: curCtr });

    const curPos = cur.position;
    const prevPos = prev?.position;
    setKpi(wrapper, "pos", curPos != null ? curPos.toFixed(1) : "—", prevPos, { inverse: true, current: curPos });

    // Sparklines on each KPI from the dates series
    if (dates.status === "fulfilled" && dates.value.rows.length) {
      const dateRows = dates.value.rows;
      renderKpiSparkline(wrapper, "clicks", dateRows.map((r) => r.clicks || 0), {
        dateLabels: dateRows.map((r) => r.keys?.[0] || ""),
        label: "Clicks",
        formatValue: (v) => `${fmtNum(v)} click${Math.round(v) === 1 ? "" : "s"}`,
      });
      renderKpiSparkline(wrapper, "impr", dateRows.map((r) => r.impressions || 0), {
        dateLabels: dateRows.map((r) => r.keys?.[0] || ""),
        label: "Impressions",
        formatValue: (v) => `${fmtNum(v)} impr.`,
      });
      renderKpiSparkline(wrapper, "ctr", dateRows.map((r) => (r.ctr || 0) * 100), {
        dateLabels: dateRows.map((r) => r.keys?.[0] || ""),
        label: "CTR",
        formatValue: (v) => `${v.toFixed(1)}% CTR`,
      });
      renderKpiSparkline(wrapper, "pos", dateRows.map((r) => r.position || 0), {
        inverse: true,
        dateLabels: dateRows.map((r) => r.keys?.[0] || ""),
        label: "Avg. position",
        formatValue: (v) => v ? `pos. ${v.toFixed(1)}` : "—",
      });
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
  renderGeoMap(wrapper, countries, geoVisits);
  renderPlacesPanel(wrapper, state);

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
        <div class="sc-kpi-label">${tip(label)}</div>
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
  const curNum = opts.current != null
    ? Number(opts.current)
    : parseFloat(String(value).replace(/[^0-9.\-]/g, ""));
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
  const W = 220, H = 54;
  const pad = { top: 8, right: 8, bottom: 10, left: 8 };
  const chartW = W - pad.left - pad.right;
  const chartH = H - pad.top - pad.bottom;
  const stepX = chartW / Math.max(series.length - 1, 1);
  const range = max - min || 1;
  const coords = series.map((v, i) => {
    const x = pad.left + i * stepX;
    const ratio = (v - min) / range;
    const y = pad.top + (opts.inverse ? ratio * chartH : chartH - ratio * chartH);
    return { x, y };
  });
  const points = coords.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const lastRatio = (series[series.length - 1] - min) / range;
  const lastY = pad.top + (opts.inverse ? lastRatio * chartH : chartH - lastRatio * chartH);
  const lastX = coords[coords.length - 1]?.x || W - pad.right;
  const lastV = series[series.length - 1];
  const isUp  = lastV >= series[0];
  const goodUp = !opts.inverse;
  const tone = (isUp === goodUp) ? "good" : "bad";
  const midY = pad.top + chartH / 2;
  const fillPoints = `${pad.left},${H - pad.bottom} ${points} ${W - pad.right},${H - pad.bottom}`;
  const label = opts.label || "Value";
  const dateLabels = opts.dateLabels || [];
  const formatValue = opts.formatValue || ((v) => fmtNum(v));
  const hitPoints = coords.map((p, i) => {
    const date = dateLabels[i] || "";
    const value = formatValue(series[i] || 0);
    const aria = `${label}, ${humanDate(date) || shortDate(date)}: ${value}`;
    return `<circle class="sc-kpi-spark-hit" tabindex="0" role="button" aria-label="${esc(aria)}" data-index="${i}" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="7"/>`;
  }).join("");
  el.innerHTML = `
    <svg class="sc-kpi-spark-svg is-${tone}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-label="${esc(label)} daily mini chart">
      <line class="sc-kpi-spark-guide" x1="${pad.left}" y1="${midY.toFixed(1)}" x2="${W - pad.right}" y2="${midY.toFixed(1)}"/>
      <polygon class="sc-kpi-spark-fill" points="${fillPoints}"/>
      <polyline class="sc-kpi-spark-line" points="${points}"/>
      <circle class="sc-kpi-spark-end" cx="${lastX.toFixed(1)}" cy="${lastY.toFixed(1)}" r="2.4"/>
      <circle class="sc-kpi-spark-selected" r="3.2" opacity="0"/>
      ${hitPoints}
    </svg>
    <div class="sc-kpi-spark-pop" hidden></div>`;

  const pop = el.querySelector(".sc-kpi-spark-pop");
  const selected = el.querySelector(".sc-kpi-spark-selected");
  const showPoint = (index) => {
    const p = coords[index];
    if (!p || !pop || !selected) return;
    const date = dateLabels[index] || "";
    const value = formatValue(series[index] || 0);
    selected.setAttribute("cx", p.x.toFixed(1));
    selected.setAttribute("cy", p.y.toFixed(1));
    selected.setAttribute("opacity", "1");
    pop.innerHTML = `<strong>${esc(shortDate(date))}</strong><span>${esc(value)}</span>`;
    pop.style.left = `${Math.max(10, Math.min(90, (p.x / W) * 100))}%`;
    pop.hidden = false;
  };

  el.querySelectorAll(".sc-kpi-spark-hit").forEach((dot) => {
    dot.addEventListener("click", () => showPoint(Number(dot.dataset.index)));
    dot.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      showPoint(Number(dot.dataset.index));
    });
  });
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
  const base = (inner) => `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
  const ICONS = {
    "trending-up":   base(`<path d="M4 15.5 9 10.5l4 4L20 7.5"/><path d="M16 7.5h4v4"/>`),
    "trending-down": base(`<path d="M4 8.5 9 13.5l4-4 7 7"/><path d="M16 16.5h4v-4"/>`),
    "ctr":           base(`<path d="M7 17 17 7"/><circle cx="7.5" cy="7.5" r="1.8"/><circle cx="16.5" cy="16.5" r="1.8"/>`),
    "rank":          base(`<path d="M12 19V5"/><path d="m7 10 5-5 5 5"/>`),
    "spark":         base(`<path d="M13 3 5 13h7l-1 8 8-11h-7l1-7Z"/>`),
    "lightbulb":     base(`<path d="M9 18h6"/><path d="M10 21h4"/><path d="M8.5 14.5a6 6 0 1 1 7 0c-.7.6-.9 1.3-.9 2H9.4c0-.7-.2-1.4-.9-2Z"/>`),
    "page":          base(`<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v5h5"/><path d="M10 13h6"/><path d="M10 17h4"/>`),
    "device":        base(`<rect x="8" y="3" width="8" height="18" rx="2"/><path d="M11.5 18h1"/>`),
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
    chartEl.innerHTML = renderTrendEmptyState();
    // Wire the "Try 1 year" button to switch to that preset
    const tryBtn = chartEl.querySelector('[data-action="try-year"]');
    if (tryBtn) {
      tryBtn.addEventListener("click", () => {
        const yearBtn = wrapper.querySelector('.sc-range-btn[data-days="365"]');
        if (yearBtn) yearBtn.click();
      });
    }
    return;
  }

  const dates    = rows.map((r) => r.keys?.[0] || "");
  const clicks   = rows.map((r) => r.clicks || 0);
  const imprArr  = rows.map((r) => r.impressions || 0);
  const ctrArr   = rows.map((r) => (r.ctr || 0) * 100);
  const posArr   = rows.map((r) => r.position || 0);

  const W = 920, H = 320;
  const pad = { top: 22, right: 58, bottom: 46, left: 58 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;
  const n = rows.length;

  const xc = (i) => pad.left + (i / Math.max(n - 1, 1)) * plotW;

  // Decide which series to draw based on metric toggle
  const showClicks = metric === "both" || metric === "clicks";
  const showImpr   = metric === "both" || metric === "impressions";
  const showCtr    = metric === "ctr";
  const showPos    = metric === "position";

  let leftDomain = { min: 0, max: 1 };
  let rightMax = 1;
  let leftLabel = "";
  let rightLabel = "";
  let leftFormat = fmtNum;
  let positionMode = false;

  if (showClicks && showImpr) {
    leftDomain = { min: 0, max: niceMax(Math.max(1, ...clicks)) };
    rightMax = niceMax(Math.max(1, ...imprArr));
    leftLabel = "Clicks"; rightLabel = "Impressions";
  } else if (showClicks) {
    leftDomain = { min: 0, max: niceMax(Math.max(1, ...clicks)) };
    leftLabel = "Clicks";
  } else if (showImpr) {
    leftDomain = { min: 0, max: niceMax(Math.max(1, ...imprArr)) };
    leftLabel = "Impressions";
  } else if (showCtr) {
    leftDomain = { min: 0, max: niceMax(Math.max(1, ...ctrArr)) };
    leftLabel = "CTR (%)";
    leftFormat = (v) => `${fmtPctTick(v)}%`;
  } else if (showPos) {
    const nonZeroPos = posArr.filter((v) => v > 0);
    const pMin = Math.max(1, Math.floor(Math.min(...nonZeroPos, 1)));
    const pMax = Math.ceil(Math.max(...nonZeroPos, 2));
    const room = Math.max(1, Math.ceil((pMax - pMin) * 0.18));
    leftDomain = { min: Math.max(1, pMin - room), max: pMax + room };
    leftLabel = "Position";
    leftFormat = (v) => v.toFixed(v < 10 ? 1 : 0);
    positionMode = true;
  }

  const spanLeft = leftDomain.max - leftDomain.min || 1;
  const ycLeft  = (v) => {
    const clamped = Math.max(leftDomain.min, Math.min(leftDomain.max, v));
    if (positionMode) return pad.top + ((clamped - leftDomain.min) / spanLeft) * plotH;
    return pad.top + plotH - ((clamped - leftDomain.min) / spanLeft) * plotH;
  };
  const ycRight = (v) => pad.top + plotH - (v / rightMax) * plotH;

  const leftTicks = positionMode ? rangeTicks(leftDomain.min, leftDomain.max, 4) : niceTicks(leftDomain.max, 4);
  const gridLines = leftTicks.map((t) => {
    const gy = ycLeft(t);
    return `<line class="sc-chart-gridline" x1="${pad.left}" y1="${gy.toFixed(1)}" x2="${(W - pad.right).toFixed(1)}" y2="${gy.toFixed(1)}"/>
    <text class="sc-chart-axis-text" x="${pad.left - 10}" y="${(gy + 3).toFixed(1)}" text-anchor="end">${leftFormat(t)}</text>`;
  }).join("");

  let rightAxis = "";
  if (showImpr && showClicks) {
    const rightTicks = niceTicks(rightMax, 4);
    rightAxis = rightTicks.map((t) => {
      const gy = ycRight(t);
      return `<text class="sc-chart-axis-text sc-chart-axis-text-right" x="${(W - pad.right + 10).toFixed(1)}" y="${(gy + 3).toFixed(1)}" text-anchor="start">${fmtNum(t)}</text>`;
    }).join("");
  }

  // X-axis date labels — every ~7th
  const step = Math.max(1, Math.ceil(n / 8));
  const xLabels = dates.map((d, i) => {
    if (i % step !== 0 && i !== n - 1) return "";
    return `<text class="sc-chart-axis-text" x="${xc(i).toFixed(1)}" y="${(H - pad.bottom + 20).toFixed(1)}" text-anchor="middle">${esc(shortDate(d))}</text>`;
  }).join("");

  // Build paths
  let paths = "";
  let dots = "";
  let legend = [];
  let hoverDots = "";
  const hoverSeries = [];
  const addHoverSeries = (id, label, color, yFn, valueFn, formatFn) => {
    hoverSeries.push({ id, label, color, yFn, valueFn, formatFn });
    hoverDots += `<circle class="sc-chart-hover-dot" data-series="${id}" r="4.2" fill="${color}" stroke="var(--surface)" stroke-width="2" opacity="0"/>`;
  };

  if (showImpr && showClicks) {
    const imprPath = smoothLinePath(rows, (_, i) => xc(i), (r) => ycRight(r.impressions || 0));
    paths += `<path class="sc-chart-line sc-chart-line-impressions is-dashed" d="${imprPath}"/>`;
    addHoverSeries("impressions", "Impressions", "var(--chart-impressions)", (r) => ycRight(r.impressions || 0), (r) => r.impressions || 0, fmtNum);
    legend.push({ label: "Impressions", color: "var(--chart-impressions)", dashed: true });
  } else if (showImpr) {
    const imprPath = smoothLinePath(rows, (_, i) => xc(i), (r) => ycLeft(r.impressions || 0));
    const imprFill = areaPath(rows, (_, i) => xc(i), (r) => ycLeft(r.impressions || 0), pad.top + plotH);
    paths += `<path class="sc-chart-area sc-chart-area-impressions" d="${imprFill}"/>
              <path class="sc-chart-line sc-chart-line-impressions" d="${imprPath}"/>`;
    addHoverSeries("impressions", "Impressions", "var(--chart-impressions)", (r) => ycLeft(r.impressions || 0), (r) => r.impressions || 0, fmtNum);
    legend.push({ label: "Impressions", color: "var(--chart-impressions)" });
  }

  if (showClicks) {
    const clickPath = smoothLinePath(rows, (_, i) => xc(i), (r) => ycLeft(r.clicks || 0));
    const clickFill = areaPath(rows, (_, i) => xc(i), (r) => ycLeft(r.clicks || 0), pad.top + plotH);
    paths += `<path class="sc-chart-area sc-chart-area-clicks" d="${clickFill}"/>
              <path class="sc-chart-line sc-chart-line-clicks" d="${clickPath}"/>`;
    dots += chartPointDots(rows, (_, i) => xc(i), (r) => ycLeft(r.clicks || 0), "var(--chart-clicks)", n);
    addHoverSeries("clicks", "Clicks", "var(--chart-clicks)", (r) => ycLeft(r.clicks || 0), (r) => r.clicks || 0, fmtNum);
    legend.push({ label: "Clicks", color: "var(--chart-clicks)" });
  }

  if (showCtr) {
    const ctrPath = smoothLinePath(rows, (_, i) => xc(i), (r) => ycLeft((r.ctr || 0) * 100));
    const ctrFill = areaPath(rows, (_, i) => xc(i), (r) => ycLeft((r.ctr || 0) * 100), pad.top + plotH);
    paths += `<path class="sc-chart-area sc-chart-area-ctr" d="${ctrFill}"/>
              <path class="sc-chart-line sc-chart-line-ctr" d="${ctrPath}"/>`;
    dots += chartPointDots(rows, (_, i) => xc(i), (r) => ycLeft((r.ctr || 0) * 100), "var(--chart-ctr)", n);
    addHoverSeries("ctr", "CTR", "var(--chart-ctr)", (r) => ycLeft((r.ctr || 0) * 100), (r) => (r.ctr || 0) * 100, (v) => `${v.toFixed(2)}%`);
    legend.push({ label: "CTR", color: "var(--chart-ctr)" });
  }

  if (showPos) {
    const posPath = smoothLinePath(rows, (_, i) => xc(i), (r) => ycLeft(r.position || leftDomain.max));
    paths += `<path class="sc-chart-line sc-chart-line-position" d="${posPath}"/>`;
    dots += chartPointDots(rows, (_, i) => xc(i), (r) => ycLeft(r.position || leftDomain.max), "var(--chart-position)", n);
    addHoverSeries("position", "Avg. position", "var(--chart-position)", (r) => ycLeft(r.position || leftDomain.max), (r) => r.position || 0, (v) => v.toFixed(1));
    legend.push({ label: "Avg. position", color: "var(--chart-position)" });
  }

  const totalClicks = clicks.reduce((a, b) => a + b, 0);
  const totalImpr = imprArr.reduce((a, b) => a + b, 0);
  const avgCtr = totalImpr ? (totalClicks / totalImpr) * 100 : 0;
  const weightedPos = totalImpr
    ? rows.reduce((sum, r) => sum + ((r.position || 0) * (r.impressions || 0)), 0) / totalImpr
    : avg(posArr);
  const bestClickDay = rows.reduce((best, r, i) => ((r.clicks || 0) > (best.row.clicks || 0) ? { row: r, i } : best), { row: rows[0], i: 0 });
  const statHtml = `<div class="sc-chart-stat-row">
    <span class="sc-chart-stat"><strong>${fmtNum(totalClicks)}</strong><span>Clicks</span></span>
    <span class="sc-chart-stat"><strong>${fmtNum(totalImpr)}</strong><span>Impressions</span></span>
    <span class="sc-chart-stat"><strong>${avgCtr.toFixed(1)}%</strong><span>Avg CTR</span></span>
    <span class="sc-chart-stat"><strong>${weightedPos ? weightedPos.toFixed(1) : "—"}</strong><span>Avg pos.</span></span>
    <span class="sc-chart-stat sc-chart-stat-wide"><strong>${esc(shortDate(dates[bestClickDay.i]))}</strong><span>Best click day</span></span>
  </div>`;

  const legendHtml = `<div class="sc-chart-legend">
    ${legend.map((l) => `<span class="sc-legend-item"><span class="sc-legend-line${l.dashed ? " is-dashed" : ""}" style="--legend-color:${l.color};"></span>${l.label}</span>`).join("")}
    ${positionMode ? `<span class="sc-chart-note">Lower position is better</span>` : ""}
  </div>`;

  chartEl.innerHTML = statHtml + `
    <div class="sc-chart-frame">
      ${legendHtml}
      <svg class="sc-trend-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Trend chart"
        data-left="${pad.left}" data-right="${W - pad.right}" data-top="${pad.top}" data-bottom="${pad.top + plotH}" data-count="${n}">
      <defs>
        <linearGradient id="sc-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="currentColor" stop-opacity="0.18"/>
          <stop offset="100%" stop-color="currentColor" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <line class="sc-chart-axis" x1="${pad.left}" y1="${(pad.top + plotH).toFixed(1)}" x2="${(W - pad.right).toFixed(1)}" y2="${(pad.top + plotH).toFixed(1)}"/>
      <text class="sc-chart-axis-label" x="${pad.left}" y="12">${esc(leftLabel)}</text>
      ${rightLabel ? `<text class="sc-chart-axis-label sc-chart-axis-label-right" x="${(W - pad.right).toFixed(1)}" y="12" text-anchor="end">${esc(rightLabel)}</text>` : ""}
      <g>${gridLines}</g>
      <g>${rightAxis}</g>
      ${paths}
      <g>${dots}</g>
      <line class="sc-chart-crosshair" data-crosshair x1="${pad.left}" x2="${pad.left}" y1="${pad.top}" y2="${pad.top + plotH}" opacity="0"/>
      <g data-hover-dots>${hoverDots}</g>
      <rect class="sc-chart-hitbox" x="${pad.left}" y="${pad.top}" width="${plotW}" height="${plotH}" fill="transparent"/>
      <g>${xLabels}</g>
    </svg>
    <div class="sc-chart-tooltip" role="status" aria-live="polite"></div>
    </div>`;

  wireTrendChartHover(chartEl, rows, dates, hoverSeries, { W, pad, plotW, plotH });
}

function linePath(rows, xFn, yFn) {
  return rows.map((r, i) => `${i === 0 ? "M" : "L"} ${xFn(r, i).toFixed(1)} ${yFn(r, i).toFixed(1)}`).join(" ");
}

function smoothLinePath(rows, xFn, yFn) {
  if (!rows.length) return "";
  if (rows.length < 3) return linePath(rows, xFn, yFn);
  const pts = rows.map((r, i) => ({ x: xFn(r, i), y: yFn(r, i) }));
  let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

function areaPath(rows, xFn, yFn, baseline) {
  if (!rows.length) return "";
  const top = smoothLinePath(rows, xFn, yFn);
  const lastX = xFn(rows[rows.length - 1], rows.length - 1);
  const firstX = xFn(rows[0], 0);
  return `${top} L ${lastX.toFixed(1)} ${baseline.toFixed(1)} L ${firstX.toFixed(1)} ${baseline.toFixed(1)} Z`;
}

function chartPointDots(rows, xFn, yFn, color, n) {
  if (n > 45) return "";
  return rows.map((r, i) =>
    `<circle class="sc-chart-point" cx="${xFn(r, i).toFixed(1)}" cy="${yFn(r, i).toFixed(1)}" r="${n > 24 ? 1.8 : 2.3}" fill="${color}"/>`
  ).join("");
}

function wireTrendChartHover(chartEl, rows, dates, series, dims) {
  const frame = chartEl.querySelector(".sc-chart-frame");
  const svg = chartEl.querySelector(".sc-trend-svg");
  const tooltip = chartEl.querySelector(".sc-chart-tooltip");
  const crosshair = chartEl.querySelector("[data-crosshair]");
  const hoverDots = Array.from(chartEl.querySelectorAll(".sc-chart-hover-dot"));
  if (!frame || !svg || !tooltip || !crosshair || !series.length) return;

  const hide = () => {
    tooltip.classList.remove("is-visible");
    crosshair.setAttribute("opacity", "0");
    hoverDots.forEach((dot) => dot.setAttribute("opacity", "0"));
  };

  const showIndex = (index, clientX) => {
    const row = rows[index];
    const x = dims.pad.left + (index / Math.max(rows.length - 1, 1)) * dims.plotW;
    crosshair.setAttribute("x1", x.toFixed(1));
    crosshair.setAttribute("x2", x.toFixed(1));
    crosshair.setAttribute("opacity", "1");

    for (const dot of hoverDots) {
      const cfg = series.find((s) => s.id === dot.dataset.series);
      if (!cfg) continue;
      dot.setAttribute("cx", x.toFixed(1));
      dot.setAttribute("cy", cfg.yFn(row).toFixed(1));
      dot.setAttribute("opacity", "1");
    }

    const allRows = [
      ...series.map((s) => ({
        color: s.color,
        label: s.label,
        value: s.formatFn(s.valueFn(row)),
      })),
      { color: "var(--chart-clicks)", label: "Clicks", value: fmtNum(row.clicks || 0) },
      { color: "var(--chart-impressions)", label: "Impressions", value: fmtNum(row.impressions || 0) },
      { color: "var(--chart-ctr)", label: "CTR", value: `${((row.ctr || 0) * 100).toFixed(2)}%` },
      { color: "var(--chart-position)", label: "Avg. position", value: row.position ? row.position.toFixed(1) : "—" },
    ];
    const seen = new Set();
    tooltip.innerHTML = `
      <div class="sc-tooltip-date">${esc(humanDate(dates[index]))}</div>
      ${allRows.filter((item) => {
        if (seen.has(item.label)) return false;
        seen.add(item.label);
        return true;
      }).map((item) => `
        <div class="sc-tooltip-row">
          <span><i style="background:${item.color}"></i>${esc(item.label)}</span>
          <strong>${esc(item.value)}</strong>
        </div>`).join("")}`;

    const frameRect = frame.getBoundingClientRect();
    const tipWidth = tooltip.offsetWidth || 190;
    const left = Math.max(8, Math.min(frameRect.width - tipWidth - 8, clientX - frameRect.left + 14));
    tooltip.style.left = `${left}px`;
    tooltip.style.top = "58px";
    tooltip.classList.add("is-visible");
  };

  svg.addEventListener("pointermove", (e) => {
    const rect = svg.getBoundingClientRect();
    const viewX = ((e.clientX - rect.left) / rect.width) * dims.W;
    const ratio = (Math.max(dims.pad.left, Math.min(dims.pad.left + dims.plotW, viewX)) - dims.pad.left) / dims.plotW;
    const index = Math.max(0, Math.min(rows.length - 1, Math.round(ratio * (rows.length - 1))));
    showIndex(index, e.clientX);
  });
  svg.addEventListener("pointerleave", hide);
  svg.addEventListener("focusout", hide);
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
          <th>${tip("Query")}</th>
          <th class="num">${tip("Impressions")}</th>
          <th class="num">${tip("Position")}</th>
          <th class="num">Current ${tip("CTR")}</th>
          <th class="num">${tip("Expected CTR")}</th>
          <th class="num">${tip("Potential clicks")}</th>
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
          <th>${tip("Query")}</th>
          <th class="num" title="Clicks in the previous comparison period">Prev</th>
          <th class="num" title="Clicks in the current period">Now</th>
          <th class="num">Change</th>
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

// ── Geographic map ──────────────────────────────────────────────────────────

function renderGeoMap(wrapper, result, visitsResult = null) {
  const el = wrapper.querySelector("#sc-geo-map");
  if (!el) return;
  const cityRows = visitsResult?.status === "fulfilled" ? (visitsResult.value.rows || []) : [];
  const hasCountryRows = result.status === "fulfilled" && (result.value.rows || []).length > 0;
  const W = 920, H = 430;
  const defaultCountryZoom = 2;
  const defaultUsZoom = 4;
  const countryRows = hasCountryRows ? (result.value.rows || []) : [];
  const usCityRows = cityRows.filter((r) =>
    ["US", "USA"].includes(String(r.country || "").toUpperCase()) &&
    typeof r.latitude === "number" &&
    typeof r.longitude === "number"
  );
  const hasUsCities = usCityRows.length > 0;
  if (!hasCountryRows && !hasUsCities && result.status !== "fulfilled") {
    el.innerHTML = `<div class="error-state">${esc(result.reason?.message || "Error loading geography")}</div>`;
    return;
  }
  if (!hasCountryRows && !hasUsCities) {
    el.innerHTML = `<div class="empty-state">No city or country geography data for this period yet.</div>`;
    return;
  }

  const maxCountryClicks = Math.max(1, ...countryRows.map((r) => r.clicks || 0));
  const maxCountryImpr = Math.max(1, ...countryRows.map((r) => r.impressions || 0));
  const compareRowsAll = (result.status === "fulfilled" && result.value.compareRows) || [];
  const compareByCode = new Map(compareRowsAll.map((r) => [String(r.keys?.[0] || "").toUpperCase(), r]));
  const totalCountryClicks = countryRows.reduce((sum, r) => sum + (r.clicks || 0), 0);
  const totalCountryImpr   = countryRows.reduce((sum, r) => sum + (r.impressions || 0), 0);
  const siteCtr = totalCountryImpr > 0 ? totalCountryClicks / totalCountryImpr : null;
  const countryMarkers = countryRows
    .map((r, i) => {
      const code = String(r.keys?.[0] || "").toUpperCase();
      const meta = COUNTRY_META[code];
      if (!meta) return null;
      const p = projectRegional(meta.lon, meta.lat, W, H, defaultCountryZoom, WORLD_MAP_CENTER);
      const radius = scaledMapSize(r.clicks || 0, maxCountryClicks, 2.5, 9.5, 150);
      const pulse = scaledMapSize(r.impressions || 0, maxCountryImpr, 5, 16, 6000);
      const insights = computeCountryInsights(r, code, {
        compareRow: compareByCode.get(code) || null,
        totalClicks: totalCountryClicks,
        totalImpressions: totalCountryImpr,
        siteCtr,
        cityRows,
      });
      return {
        ...r,
        code,
        meta,
        x: p.x,
        y: p.y,
        radius,
        pulse,
        label: i < 15 ? code : "",
        panelTitle: meta.name,
        primaryLabel: "Clicks",
        primaryValue: fmtNum(r.clicks || 0),
        secondaryLabel: "Impressions",
        secondaryValue: fmtNum(r.impressions || 0),
        thirdLabel: "CTR",
        thirdValue: r.ctr != null ? `${(r.ctr * 100).toFixed(1)}%` : "—",
        fourthLabel: "Position",
        fourthValue: r.position != null ? r.position.toFixed(1) : "—",
        description: "Country markers use Google Search Console geography. Drag to move around the map, scroll to zoom, or switch to U.S. city view for first-party city visit data.",
        insights,
        trending: insights.trending,
      };
    })
    .filter(Boolean)
    .sort((a, b) => (b.clicks || 0) - (a.clicks || 0))
    .slice(0, 15);

  const maxCityViews = Math.max(1, ...usCityRows.map((r) => r.views || 0));
  const initialCityCenter = usCityRows.length ? weightedCityCenter(usCityRows) : US_MAP_CENTER;
  const cityMarkers = usCityRows
    .map((r, i) => {
      const views = r.views || 0;
      const p = projectRegional(r.longitude, r.latitude, W, H, defaultUsZoom, initialCityCenter);
      const place = [r.city, r.region].filter(Boolean).join(", ") || "United States";
      const label = r.city && r.city !== "Unknown city" ? shortMapLabel(r.city) : "US";
      const radius = scaledMapSize(views, maxCityViews, 2.2, 8.8, 80);
      const pulse = scaledMapSize(views, maxCityViews, 4.5, 13.5, 80);
      const insights = computeCityInsights(r, usCityRows);
      return {
        ...r,
        code: "US",
        meta: { name: place, lat: r.latitude, lon: r.longitude },
        x: p.x,
        y: p.y,
        radius,
        pulse,
        label: i < 16 ? label : "",
        panelTitle: place,
        primaryLabel: "Views",
        primaryValue: fmtNum(views),
        secondaryLabel: "State",
        secondaryValue: r.region || r.regionCode || "—",
        thirdLabel: "Days",
        thirdValue: fmtNum(r.days || 1),
        fourthLabel: "Timezone",
        fourthValue: r.timezone ? prettyTimezone(r.timezone) : "—",
        description: cityVisitSummary(r),
        visitHistory: normalizeVisitHistory(r),
        insights,
        trending: insights.trending,
      };
    })
    .sort((a, b) => (b.views || 0) - (a.views || 0))
    .slice(0, 60);

  if (!countryMarkers.length && !cityMarkers.length) {
    el.innerHTML = `<div class="empty-state">Geography rows are present, but no map coordinates are available for this period.</div>`;
    return;
  }

  const defaultMode = cityMarkers.length ? "city" : "country";
  const topCountry = countryMarkers[0];
  const topCity = cityMarkers[0];
  const countryTileHtml = renderRegionalTiles(W, H, defaultCountryZoom, WORLD_MAP_CENTER);
  const cityTileHtml = renderRegionalTiles(W, H, defaultUsZoom, initialCityCenter);
  const countryMarkerHtml = buildMapMarkers(countryMarkers, topCountry);
  const cityMarkerHtml = buildMapMarkers(cityMarkers, topCity, { city: true });

  el.innerHTML = `
    <div class="sc-map-controls" role="group" aria-label="Map view controls">
      <div class="sc-map-mode-toggle" role="group" aria-label="Geography view">
        <button type="button" class="sc-map-mode-btn" data-map-mode="country" aria-pressed="${defaultMode === "country"}"${countryMarkers.length ? "" : " disabled"}>Country view</button>
        <button type="button" class="sc-map-mode-btn" data-map-mode="city" aria-pressed="${defaultMode === "city"}"${cityMarkers.length ? "" : " disabled"}>U.S. city view</button>
      </div>
      <div class="sc-map-zoom-controls">
        <button type="button" class="sc-map-zoom-btn" data-map-zoom="-1" aria-label="Zoom out">−</button>
        <span class="sc-map-zoom-label" data-map-zoom-label>Zoom ${defaultMode === "city" ? defaultUsZoom : defaultCountryZoom}</span>
        <button type="button" class="sc-map-zoom-btn" data-map-zoom="1" aria-label="Zoom in">+</button>
      </div>
    </div>
    <div class="sc-map-layout" data-map-mode="${defaultMode}"
      data-country-zoom="${defaultCountryZoom}" data-country-center-lon="${WORLD_MAP_CENTER.lon}" data-country-center-lat="${WORLD_MAP_CENTER.lat}"
      data-city-zoom="${defaultUsZoom}" data-city-center-lon="${initialCityCenter.lon}" data-city-center-lat="${initialCityCenter.lat}">
      <div class="sc-map-wrap">
        <svg class="sc-map-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Reader geography map">
          <defs>
            <radialGradient id="sc-map-sea" cx="50%" cy="45%" r="70%">
              <stop offset="0%" stop-color="#f8fafc"/>
              <stop offset="100%" stop-color="#eef3f8"/>
            </radialGradient>
            <clipPath id="sc-map-clip">
              <rect x="0" y="0" width="${W}" height="${H}" rx="18"/>
            </clipPath>
            <linearGradient id="sc-map-vignette" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#ffffff" stop-opacity="0.18"/>
              <stop offset="55%" stop-color="#ffffff" stop-opacity="0"/>
              <stop offset="100%" stop-color="#0f172a" stop-opacity="0.05"/>
            </linearGradient>
          </defs>
          <rect class="sc-map-ocean" x="0" y="0" width="${W}" height="${H}" rx="18"/>
          <g class="sc-map-tile-layer" clip-path="url(#sc-map-clip)" data-country-tiles="${esc(countryTileHtml)}" data-city-tiles="${esc(cityTileHtml)}">${defaultMode === "city" ? cityTileHtml : countryTileHtml}</g>
          <rect class="sc-map-vignette" x="0" y="0" width="${W}" height="${H}" rx="18"/>
          <g class="sc-map-country-layer" ${defaultMode === "city" ? "hidden" : ""}>${countryMarkerHtml}</g>
          <g class="sc-map-city-layer" ${defaultMode === "city" ? "" : "hidden"}>${cityMarkerHtml}</g>
        </svg>
        <div class="sc-map-tooltip" hidden></div>
        <div class="sc-map-attribution">© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a></div>
      </div>
      <aside class="sc-map-panel">
        ${topCountry ? mapPanelHtml(topCountry, "Top country", defaultMode === "country" ? "" : "hidden", "country") : ""}
        ${topCity ? mapPanelHtml(topCity, "Top U.S. city", defaultMode === "city" ? "" : "hidden", "city") : ""}
        ${!topCity ? `<div class="sc-map-panel-block" data-map-panel="city" hidden>
          <div class="sc-map-panel-kicker">U.S. city view</div>
          <div class="sc-map-panel-title">No city data yet</div>
          <p>City data starts appearing after new public site visits are recorded by the first-party Cloudflare analytics endpoint.</p>
        </div>` : ""}
      </aside>
    </div>`;

  wireGeoMap(el, { W, H });
}

function buildMapMarkers(rows, top, { city = false } = {}) {
  return rows.slice().reverse().map((r) => {
    const labelSide = r.meta.labelSide === "left" ? "left" : "right";
    const labelX = labelSide === "left"
      ? r.x - r.radius - 7 + (r.meta.labelDx || 0)
      : r.x + r.radius + 7 + (r.meta.labelDx || 0);
    const labelY = r.y + 4 + (r.meta.labelDy || 0);
    return `
    <g class="sc-map-marker${city ? " sc-map-city-marker" : ""}" tabindex="0" role="button"
      aria-label="${esc(r.meta.name)}: ${esc(r.primaryValue)} ${esc(r.primaryLabel.toLowerCase())}"
      data-lat="${r.meta.lat}"
      data-lon="${r.meta.lon}"
      data-radius="${r.radius.toFixed(2)}"
      data-pulse="${r.pulse.toFixed(2)}"
      data-label="${esc(r.label || "")}"
      data-label-side="${esc(labelSide)}"
      data-label-dx="${Number(r.meta.labelDx || 0).toFixed(1)}"
      data-label-dy="${Number(r.meta.labelDy || 0).toFixed(1)}"
      data-panel-title="${esc(r.panelTitle || r.meta.name)}"
      data-description="${esc(r.description || "")}"
      data-visit-history="${esc(JSON.stringify(r.visitHistory || []))}"
      data-country="${esc(r.meta.name)}"
      data-code="${esc(r.code)}"
      data-primary-label="${esc(r.primaryLabel)}"
      data-primary-value="${esc(r.primaryValue)}"
      data-secondary-label="${esc(r.secondaryLabel)}"
      data-secondary-value="${esc(r.secondaryValue)}"
      data-third-label="${esc(r.thirdLabel)}"
      data-third-value="${esc(r.thirdValue)}"
      data-fourth-label="${esc(r.fourthLabel)}"
      data-fourth-value="${esc(r.fourthValue)}"
      data-insights="${esc(JSON.stringify(r.insights || null))}"
      data-trending="${r.trending ? "1" : "0"}">
      <circle class="sc-map-pulse" cx="${r.x.toFixed(1)}" cy="${r.y.toFixed(1)}" r="${r.pulse.toFixed(1)}"/>
      <circle class="sc-map-dot${r === top ? " is-top" : ""}" cx="${r.x.toFixed(1)}" cy="${r.y.toFixed(1)}" r="${r.radius.toFixed(1)}"/>
      ${r.label ? `<text class="sc-map-label" x="${labelX.toFixed(1)}" y="${labelY.toFixed(1)}" text-anchor="${labelSide === "left" ? "end" : "start"}">${esc(r.label)}</text>` : ""}
    </g>`;
  }).join("");
}

function renderRegionalTiles(W, H, zoom, center) {
  const tileSize = 256;
  const tileZoom = Math.max(0, Math.min(19, Math.round(zoom)));
  const zoomScale = 2 ** (zoom - tileZoom);
  const c = mercatorPixel(center.lon, center.lat, zoom);
  const left = c.x - W / 2;
  const top = c.y - H / 2;
  const minX = Math.floor((left / zoomScale) / tileSize);
  const maxX = Math.floor(((left + W) / zoomScale) / tileSize);
  const minY = Math.floor((top / zoomScale) / tileSize);
  const maxY = Math.floor(((top + H) / zoomScale) / tileSize);
  const tileMax = 2 ** tileZoom;
  const images = [];
  for (let ty = minY; ty <= maxY; ty++) {
    if (ty < 0 || ty >= tileMax) continue;
    for (let tx = minX; tx <= maxX; tx++) {
      const wrappedX = ((tx % tileMax) + tileMax) % tileMax;
      images.push(`<image href="https://tile.openstreetmap.org/${tileZoom}/${wrappedX}/${ty}.png"
        x="${(tx * tileSize * zoomScale - left).toFixed(1)}" y="${(ty * tileSize * zoomScale - top).toFixed(1)}"
        width="${(tileSize * zoomScale).toFixed(1)}" height="${(tileSize * zoomScale).toFixed(1)}" preserveAspectRatio="none"/>`);
    }
  }
  return images.join("");
}

function mapPanelHtml(row, kicker, hidden, panelKey) {
  const isCity = panelKey === "city";
  const trendingBadge = row.trending
    ? `<span class="sc-city-badge sc-city-badge-trending" title="${isCity ? "More views in the recent half of the window than earlier" : "More clicks this period than the previous one"}">
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
        Trending
      </span>`
    : "";

  const insightsHtml = isCity
    ? cityPanelInsightsHtml(row.insights)
    : countryPanelInsightsHtml(row.insights);

  return `<div class="sc-map-panel-block sc-map-panel-${panelKey}" data-map-panel="${panelKey}" ${hidden}>
    <div class="sc-map-panel-kicker">${esc(kicker)}${trendingBadge}</div>
    <div class="sc-map-panel-title">${esc(row.panelTitle || row.meta.name)}</div>
    <div class="sc-map-panel-grid">
      <span><strong>${esc(row.primaryValue)}</strong>${esc(row.primaryLabel)}</span>
      <span><strong>${esc(row.secondaryValue)}</strong>${esc(row.secondaryLabel)}</span>
      <span><strong>${esc(row.thirdValue)}</strong>${esc(row.thirdLabel)}</span>
      <span><strong>${esc(row.fourthValue)}</strong>${esc(row.fourthLabel)}</span>
    </div>
    ${insightsHtml}
    ${row.visitHistory && row.visitHistory.length ? `<div class="sc-map-visit-history">${visitHistoryHtml(row.visitHistory)}</div>` : ""}
  </div>`;
}

function wireGeoMap(root, dims = { W: 920, H: 430 }) {
  const wrap = root.querySelector(".sc-map-wrap");
  const tipEl = root.querySelector(".sc-map-tooltip");
  const layout = root.querySelector(".sc-map-layout");
  const tileLayer = root.querySelector(".sc-map-tile-layer");
  const countryLayer = root.querySelector(".sc-map-country-layer");
  const cityLayer = root.querySelector(".sc-map-city-layer");
  const zoomControls = root.querySelector(".sc-map-zoom-controls");
  const zoomLabel = root.querySelector("[data-map-zoom-label]");
  if (!wrap || !tipEl) return;
  const setMode = (mode) => {
    if (!layout || !tileLayer) return;
    const next = mode === "city" ? "city" : "country";
    layout.dataset.mapMode = next;
    tileLayer.innerHTML = next === "city" ? (tileLayer.dataset.cityTiles || "") : (tileLayer.dataset.countryTiles || "");
    if (countryLayer) {
      if (next === "city") countryLayer.setAttribute("hidden", "");
      else countryLayer.removeAttribute("hidden");
    }
    if (cityLayer) {
      if (next !== "city") cityLayer.setAttribute("hidden", "");
      else cityLayer.removeAttribute("hidden");
    }
    root.querySelectorAll(".sc-map-mode-btn").forEach((btn) => {
      btn.setAttribute("aria-pressed", String(btn.dataset.mapMode === next));
    });
    root.querySelectorAll("[data-map-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.mapPanel !== next;
    });
    refreshActiveMap();
    tipEl.hidden = true;
  };
  const getMapState = (mode = layout?.dataset.mapMode || "country") => {
    const fallback = mode === "city" ? US_MAP_CENTER : WORLD_MAP_CENTER;
    return {
      mode,
      zoom: Number(layout?.dataset[`${mode}Zoom`] || (mode === "city" ? 4 : 2)),
      center: {
        lon: Number(layout?.dataset[`${mode}CenterLon`] || fallback.lon),
        lat: Number(layout?.dataset[`${mode}CenterLat`] || fallback.lat),
      },
    };
  };
  const setMapState = (mode, zoom, center) => {
    if (!layout) return;
    layout.dataset[`${mode}Zoom`] = String(zoom);
    layout.dataset[`${mode}CenterLon`] = String(center.lon);
    layout.dataset[`${mode}CenterLat`] = String(center.lat);
  };
  const refreshActiveMap = () => {
    if (!layout || !tileLayer) return;
    const { mode, zoom, center } = getMapState();
    const tileHtml = renderRegionalTiles(dims.W, dims.H, zoom, center);
    tileLayer.dataset[`${mode}Tiles`] = tileHtml;
    tileLayer.innerHTML = tileHtml;
    if (zoomLabel) zoomLabel.textContent = `Zoom ${formatMapZoom(zoom)}`;
    const selector = mode === "city" ? ".sc-map-city-marker" : ".sc-map-country-layer .sc-map-marker";
    root.querySelectorAll(selector).forEach((marker) => {
      const lon = Number(marker.dataset.lon);
      const lat = Number(marker.dataset.lat);
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
      const p = projectRegional(lon, lat, dims.W, dims.H, zoom, center);
      const radius = Number(marker.dataset.radius || 8);
      const labelSide = marker.dataset.labelSide === "left" ? "left" : "right";
      const labelDx = Number(marker.dataset.labelDx || 0);
      const labelDy = Number(marker.dataset.labelDy || 0);
      const label = marker.querySelector(".sc-map-label");
      marker.querySelector(".sc-map-pulse")?.setAttribute("cx", p.x.toFixed(1));
      marker.querySelector(".sc-map-pulse")?.setAttribute("cy", p.y.toFixed(1));
      marker.querySelector(".sc-map-dot")?.setAttribute("cx", p.x.toFixed(1));
      marker.querySelector(".sc-map-dot")?.setAttribute("cy", p.y.toFixed(1));
      if (label) {
        const labelX = labelSide === "left" ? p.x - radius - 7 + labelDx : p.x + radius + 7 + labelDx;
        label.setAttribute("x", labelX.toFixed(1));
        label.setAttribute("y", (p.y + 4 + labelDy).toFixed(1));
        label.setAttribute("text-anchor", labelSide === "left" ? "end" : "start");
      }
    });
  };
  const show = (marker) => {
    const dot = marker.querySelector(".sc-map-dot");
    if (!dot) return;
    const box = wrap.getBoundingClientRect();
    const dotBox = dot.getBoundingClientRect();
    tipEl.innerHTML = `
      <div class="sc-map-tooltip-title">${esc(marker.dataset.country || marker.dataset.code || "Country")}</div>
      <div class="sc-map-tooltip-grid">
        <span><strong>${esc(marker.dataset.primaryValue || "0")}</strong>${esc(marker.dataset.primaryLabel || "Views")}</span>
        <span><strong>${esc(marker.dataset.secondaryValue || "—")}</strong>${esc(marker.dataset.secondaryLabel || "Country")}</span>
        <span><strong>${esc(marker.dataset.thirdValue || "—")}</strong>${esc(marker.dataset.thirdLabel || "Days")}</span>
        <span><strong>${esc(marker.dataset.fourthValue || "—")}</strong>${esc(marker.dataset.fourthLabel || "Timezone")}</span>
      </div>`;
    tipEl.style.left = `${Math.max(12, Math.min(box.width - 210, dotBox.left - box.left + 18))}px`;
    tipEl.style.top = `${Math.max(12, dotBox.top - box.top - 12)}px`;
    tipEl.hidden = false;
  };
  const updatePanelFromMarker = (marker) => {
    if (!layout) return;
    const panel = root.querySelector(`[data-map-panel="${layout.dataset.mapMode}"]`);
    if (!panel) return;
    const isCity = panel.dataset.mapPanel === "city";
    const title = panel.querySelector(".sc-map-panel-title");
    const grid = panel.querySelector(".sc-map-panel-grid");
    const insightsBox = panel.querySelector(".sc-city-insights");
    const history = panel.querySelector(".sc-map-visit-history");
    const kicker = panel.querySelector(".sc-map-panel-kicker");

    if (title) title.textContent = marker.dataset.panelTitle || marker.dataset.country || "";
    if (grid) {
      grid.innerHTML = `
        <span><strong>${esc(marker.dataset.primaryValue || "0")}</strong>${esc(marker.dataset.primaryLabel || "Views")}</span>
        <span><strong>${esc(marker.dataset.secondaryValue || "—")}</strong>${esc(marker.dataset.secondaryLabel || "Country")}</span>
        <span><strong>${esc(marker.dataset.thirdValue || "—")}</strong>${esc(marker.dataset.thirdLabel || "Days")}</span>
        <span><strong>${esc(marker.dataset.fourthValue || "—")}</strong>${esc(marker.dataset.fourthLabel || "Timezone")}</span>`;
    }

    // Re-render the insights block for both city and country panels.
    let insights = null;
    try { insights = JSON.parse(marker.dataset.insights || "null"); } catch { insights = null; }
    const html = isCity ? cityPanelInsightsHtml(insights) : countryPanelInsightsHtml(insights);
    if (insightsBox) {
      insightsBox.outerHTML = html || "";
    } else if (html) {
      grid?.insertAdjacentHTML("afterend", html);
    }

    // Trending pill — applies to both modes now
    if (kicker) {
      const existing = kicker.querySelector(".sc-city-badge-trending");
      const isTrending = marker.dataset.trending === "1";
      if (isTrending && !existing) {
        kicker.insertAdjacentHTML("beforeend",
          `<span class="sc-city-badge sc-city-badge-trending"><svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>Trending</span>`);
      } else if (!isTrending && existing) {
        existing.remove();
      }
    }

    if (history) history.innerHTML = visitHistoryHtml(parseVisitHistory(marker.dataset.visitHistory));
  };
  root.querySelectorAll(".sc-map-mode-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!btn.disabled) setMode(btn.dataset.mapMode);
    });
  });
  root.querySelectorAll(".sc-map-zoom-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!layout) return;
      const delta = Number(btn.dataset.mapZoom || 0) * 0.75;
      const { mode, zoom, center } = getMapState();
      const bounds = mode === "city" ? [3, 9] : [1, 5];
      setMapState(mode, Math.max(bounds[0], Math.min(bounds[1], zoom + delta)), center);
      refreshActiveMap();
      tipEl.hidden = true;
    });
  });
  let dragState = null;
  const zoomBounds = (mode) => mode === "city" ? [3, 9] : [1, 5];
  const zoomAt = (clientX, clientY, delta) => {
    if (!layout) return;
    const state = getMapState();
    const bounds = zoomBounds(state.mode);
    const nextZoom = Math.max(bounds[0], Math.min(bounds[1], state.zoom + delta));
    if (nextZoom === state.zoom) return;
    const svg = root.querySelector(".sc-map-svg");
    const box = svg?.getBoundingClientRect();
    if (!box) return;
    const localX = Math.max(0, Math.min(dims.W, ((clientX - box.left) / box.width) * dims.W));
    const localY = Math.max(0, Math.min(dims.H, ((clientY - box.top) / box.height) * dims.H));
    const oldCenterPx = mercatorPixel(state.center.lon, state.center.lat, state.zoom);
    const underPointerPx = {
      x: oldCenterPx.x + localX - dims.W / 2,
      y: oldCenterPx.y + localY - dims.H / 2,
    };
    const underPointerGeo = mercatorLonLat(underPointerPx.x, underPointerPx.y, state.zoom);
    const newPointerPx = mercatorPixel(underPointerGeo.lon, underPointerGeo.lat, nextZoom);
    const nextCenterPx = {
      x: newPointerPx.x - localX + dims.W / 2,
      y: newPointerPx.y - localY + dims.H / 2,
    };
    setMapState(state.mode, nextZoom, mercatorLonLat(nextCenterPx.x, nextCenterPx.y, nextZoom));
    refreshActiveMap();
    tipEl.hidden = true;
  };
  wrap.addEventListener("wheel", (event) => {
    event.preventDefault();
    const delta = Math.max(-0.35, Math.min(0.35, -event.deltaY * 0.002));
    if (Math.abs(delta) >= 0.01) zoomAt(event.clientX, event.clientY, delta);
  }, { passive: false });
  wrap.addEventListener("pointerdown", (event) => {
    if (event.target.closest?.(".sc-map-marker, .sc-map-controls, .sc-map-attribution")) return;
    const state = getMapState();
    dragState = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      startCenterPx: mercatorPixel(state.center.lon, state.center.lat, state.zoom),
      zoom: state.zoom,
      mode: state.mode,
    };
    wrap.classList.add("is-dragging");
    wrap.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  });
  wrap.addEventListener("pointermove", (event) => {
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    const dx = event.clientX - dragState.x;
    const dy = event.clientY - dragState.y;
    const nextCenter = mercatorLonLat(dragState.startCenterPx.x - dx, dragState.startCenterPx.y - dy, dragState.zoom);
    setMapState(dragState.mode, dragState.zoom, nextCenter);
    refreshActiveMap();
    tipEl.hidden = true;
  });
  const endDrag = (event) => {
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    dragState = null;
    wrap.classList.remove("is-dragging");
  };
  wrap.addEventListener("pointerup", endDrag);
  wrap.addEventListener("pointercancel", endDrag);
  root.querySelectorAll(".sc-map-marker").forEach((marker) => {
    marker.addEventListener("mouseenter", () => show(marker));
    marker.addEventListener("focus", () => show(marker));
    marker.addEventListener("click", () => {
      if (layout) {
        const mode = marker.classList.contains("sc-map-city-marker") ? "city" : "country";
        const { zoom } = getMapState(mode);
        const lon = Number(marker.dataset.lon);
        const lat = Number(marker.dataset.lat);
        if (Number.isFinite(lon) && Number.isFinite(lat)) {
          const targetZoom = mode === "city" ? Math.max(6, zoom) : Math.max(3, zoom);
          setMapState(mode, targetZoom, { lon, lat });
          if (layout.dataset.mapMode !== mode) setMode(mode);
          else refreshActiveMap();
        }
      }
      updatePanelFromMarker(marker);
      show(marker);
    });
    marker.addEventListener("mouseleave", () => { tipEl.hidden = true; });
  });
  setMode(layout?.dataset.mapMode || "country");
  refreshActiveMap();
}

const US_MAP_CENTER = { lon: -98.6, lat: 39.8 };
const WORLD_MAP_CENTER = { lon: 0, lat: 20 };

function projectCountry(lon, lat, width, height) {
  const x = ((lon + 180) / 360) * width;
  const boundedLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const latRad = boundedLat * Math.PI / 180;
  const y = (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * height;
  return { x, y };
}

function projectRegional(lon, lat, width, height, zoom, center) {
  const point = mercatorPixel(lon, lat, zoom);
  const c = mercatorPixel(center.lon, center.lat, zoom);
  return {
    x: width / 2 + point.x - c.x,
    y: height / 2 + point.y - c.y,
  };
}

function mercatorPixel(lon, lat, zoom) {
  const tileSize = 256;
  const scale = 2 ** zoom * tileSize;
  const boundedLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const latRad = boundedLat * Math.PI / 180;
  return {
    x: ((lon + 180) / 360) * scale,
    y: (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * scale,
  };
}

function mercatorLonLat(x, y, zoom) {
  const tileSize = 256;
  const scale = 2 ** zoom * tileSize;
  const lon = ((x / scale) * 360) - 180;
  const n = Math.PI - (2 * Math.PI * y) / scale;
  const lat = (180 / Math.PI) * Math.atan(Math.sinh(n));
  return {
    lon: ((((lon + 180) % 360) + 360) % 360) - 180,
    lat: Math.max(-85.05112878, Math.min(85.05112878, lat)),
  };
}

function weightedCityCenter(rows) {
  let total = 0;
  let lon = 0;
  let lat = 0;
  rows.forEach((r) => {
    const weight = Math.max(1, Number(r.views || 0));
    lon += Number(r.longitude) * weight;
    lat += Number(r.latitude) * weight;
    total += weight;
  });
  if (!total) return US_MAP_CENTER;
  return { lon: lon / total, lat: lat / total };
}

function normalizeVisitHistory(row) {
  const days = Array.isArray(row.recentDays) ? row.recentDays : [];
  return days
    .map((day) => ({
      date: String(day.date || "").slice(0, 10),
      views: Number(day.views || 0),
      updatedAt: String(day.updatedAt || ""),
      lastPath: String(day.lastPath || row.lastPath || ""),
    }))
    .filter((day) => day.date && day.views > 0)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    .slice(0, 7);
}

function cityVisitSummary(row) {
  const history = normalizeVisitHistory(row);
  const last = history[0];
  if (!last) {
    return `${fmtNum(row.views || 0)} visit${Number(row.views || 0) === 1 ? "" : "s"} recorded from this city.`;
  }
  const latest = last.updatedAt ? formatVisitDateTime(last.updatedAt) : humanDate(last.date);
  const path = last.lastPath ? ` Last page: ${pagePath(last.lastPath)}.` : "";
  return `Last visit from this city: ${latest}.${path}`;
}

// Derive richer insights for the Top U.S. city panel. Returns a shape
// that can be JSON-serialized onto the marker dataset and rendered by
// cityPanelInsightsHtml() so panel updates on marker click stay cheap.
function computeCityInsights(row, allCityRows) {
  const history = normalizeVisitHistory(row);
  const totalViews = Number(row.views || 0);
  const totalUsViews = allCityRows.reduce((sum, r) => sum + Number(r.views || 0), 0) || 1;
  const sharePct = totalUsViews ? Math.round((totalViews / totalUsViews) * 100) : 0;

  // Peak day = the single day with the most views (also gives us the
  // "burst" angle in the panel header).
  let peak = null;
  for (const d of history) {
    if (!peak || d.views > peak.views) peak = d;
  }

  // Trending: more views in the most-recent half of the history than
  // in the older half. We use the row.days range when possible.
  let trending = false;
  if (history.length >= 2) {
    const sorted = history.slice().sort((a, b) => a.date.localeCompare(b.date));
    const mid = Math.floor(sorted.length / 2);
    const olderViews = sorted.slice(0, mid).reduce((s, d) => s + d.views, 0);
    const recentViews = sorted.slice(mid).reduce((s, d) => s + d.views, 0);
    trending = recentViews > olderViews && recentViews >= 3;
  }

  // Most-read page from this city = path with the highest total views
  // across all recorded days (fallback to row.lastPath).
  const byPath = new Map();
  for (const d of history) {
    if (!d.lastPath) continue;
    byPath.set(d.lastPath, (byPath.get(d.lastPath) || 0) + d.views);
  }
  let topPath = "";
  let topPathViews = 0;
  for (const [p, v] of byPath.entries()) {
    if (v > topPathViews) { topPath = p; topPathViews = v; }
  }
  if (!topPath && row.lastPath) topPath = row.lastPath;

  // First seen / last seen — use the data we have.
  const sortedAsc = history.slice().sort((a, b) => a.date.localeCompare(b.date));
  const firstSeen = sortedAsc[0]?.date || row.firstSeenDate || "";
  const lastSeen = sortedAsc[sortedAsc.length - 1]?.date || "";
  const lastSeenAt = row.lastSeenAt || sortedAsc[sortedAsc.length - 1]?.updatedAt || "";

  return {
    sharePct,
    trending,
    peakDate: peak?.date || "",
    peakViews: peak?.views || 0,
    topPath,
    topPathViews,
    firstSeenDate: firstSeen,
    lastSeenDate: lastSeen,
    lastSeenAt,
    timezone: row.timezone || "",
    state: row.region || row.regionCode || "",
  };
}

// Build the rich-panel HTML body — used both on first render and after
// marker clicks (via updatePanelFromMarker). Reads from the parsed
// insights object so we can stash it as JSON on each marker dataset.
function cityPanelInsightsHtml(insights) {
  if (!insights) return "";
  const peakLine = insights.peakDate
    ? `<strong>${esc(humanDate(insights.peakDate))}</strong> · ${fmtNum(insights.peakViews)} view${insights.peakViews === 1 ? "" : "s"}`
    : "—";
  const localTimeLine = insights.lastSeenAt && insights.timezone
    ? `${esc(formatVisitTimeInZone(insights.lastSeenAt, insights.timezone))} <span class="sc-city-stat-sub">${esc(prettyTimezone(insights.timezone))}</span>`
    : insights.lastSeenAt
      ? esc(formatVisitDateTime(insights.lastSeenAt))
      : "—";
  // Window span — use the compact "MMM d" form (no year) so the
  // narrow stat tile doesn't wrap onto two lines.
  const span = insights.firstSeenDate && insights.lastSeenDate && insights.firstSeenDate !== insights.lastSeenDate
    ? `${esc(shortDate(insights.firstSeenDate))} – ${esc(shortDate(insights.lastSeenDate))}`
    : insights.firstSeenDate
      ? esc(shortDate(insights.firstSeenDate))
      : "—";
  const topPageLine = insights.topPath
    ? `<a href="${esc(insights.topPath)}" target="_blank" rel="noopener" title="${esc(insights.topPath)}">${esc(pagePath(insights.topPath))}</a> · ${fmtNum(insights.topPathViews)} view${insights.topPathViews === 1 ? "" : "s"}`
    : "—";

  return `
    <div class="sc-city-insights">
      <div class="sc-city-stat">
        <div class="sc-city-stat-label">Share of U.S. visits</div>
        <div class="sc-city-stat-value">${insights.sharePct}%</div>
      </div>
      <div class="sc-city-stat">
        <div class="sc-city-stat-label">Peak day</div>
        <div class="sc-city-stat-value">${peakLine}</div>
      </div>
      <div class="sc-city-stat sc-city-stat-wide">
        <div class="sc-city-stat-label">Most-read page</div>
        <div class="sc-city-stat-value">${topPageLine}</div>
      </div>
      <div class="sc-city-stat">
        <div class="sc-city-stat-label">Last seen</div>
        <div class="sc-city-stat-value">${localTimeLine}</div>
      </div>
      <div class="sc-city-stat sc-city-stat-compact">
        <div class="sc-city-stat-label">Window</div>
        <div class="sc-city-stat-value">${span}</div>
      </div>
    </div>`;
}

// Derive panel insights for a country marker. Same shape contract as
// computeCityInsights: returns a JSON-serializable object that gets
// stashed on the marker dataset and re-rendered on click.
function computeCountryInsights(row, code, opts) {
  const { compareRow, totalClicks, totalImpressions, siteCtr, cityRows } = opts;
  const clicks = Number(row.clicks || 0);
  const impressions = Number(row.impressions || 0);
  const ctr = row.ctr != null ? Number(row.ctr) : null;

  const shareClicks = totalClicks > 0 ? Math.round((clicks / totalClicks) * 100) : 0;
  const shareImpr   = totalImpressions > 0 ? Math.round((impressions / totalImpressions) * 100) : 0;

  // Period-over-period delta (compare = previous equal-length window).
  let deltaClicks = null;
  let deltaPct = null;
  if (compareRow) {
    const prev = Number(compareRow.clicks || 0);
    deltaClicks = clicks - prev;
    if (prev > 0) deltaPct = Math.round(((clicks - prev) / prev) * 100);
    else if (clicks > 0) deltaPct = 100;
  }
  const trending = deltaClicks != null && deltaClicks > 0 && clicks >= 3;

  // CTR comparison vs site overall (rough "intent" signal). Positive
  // means this market converts impressions to clicks at above-average
  // rates — usually because the queries skew brand or topical.
  let ctrDelta = null;
  if (ctr != null && siteCtr != null && siteCtr > 0) {
    ctrDelta = ctr - siteCtr; // in fractional units (e.g. 0.025 = +2.5pp)
  }

  // Top first-party city for this country (from site_geo_daily). For
  // most non-US countries we won't have anything; that's expected.
  let topCity = "";
  let topCityViews = 0;
  for (const c of cityRows || []) {
    if (String(c.country || "").toUpperCase() !== code) continue;
    const v = Number(c.views || 0);
    if (v > topCityViews) {
      topCity = c.city && c.city !== "Unknown city" ? c.city : "";
      topCityViews = v;
    }
  }

  return {
    shareClicks,
    shareImpr,
    deltaClicks,
    deltaPct,
    trending,
    ctrDelta,
    siteCtrPct: siteCtr != null ? +(siteCtr * 100).toFixed(2) : null,
    avgPosition: row.position != null ? +Number(row.position).toFixed(1) : null,
    topCity,
    topCityViews,
  };
}

function countryPanelInsightsHtml(insights) {
  if (!insights) return "";

  // Δ clicks chip
  let deltaCell = "—";
  if (insights.deltaClicks != null && insights.deltaClicks !== 0) {
    const dir = insights.deltaClicks > 0 ? "up" : "down";
    const sign = insights.deltaClicks > 0 ? "+" : "";
    const pctText = insights.deltaPct != null ? ` <span class="sc-city-stat-sub">${sign}${insights.deltaPct}% vs prev</span>` : "";
    deltaCell = `<span class="sc-delta-chip is-${dir}">${sign}${fmtNum(insights.deltaClicks)} clicks</span>${pctText}`;
  } else if (insights.deltaClicks === 0) {
    deltaCell = `<span class="sc-delta-chip is-flat">no change</span>`;
  }

  // CTR vs site
  let ctrCell = "—";
  if (insights.ctrDelta != null) {
    const pp = insights.ctrDelta * 100;
    const dir = pp > 0.05 ? "up" : pp < -0.05 ? "down" : "flat";
    const sign = pp > 0 ? "+" : "";
    ctrCell = `<span class="sc-delta-chip is-${dir}">${sign}${pp.toFixed(1)}pp</span> <span class="sc-city-stat-sub">site avg ${insights.siteCtrPct != null ? insights.siteCtrPct.toFixed(1) + "%" : "—"}</span>`;
  }

  const topCity = insights.topCity
    ? `${esc(insights.topCity)} <span class="sc-city-stat-sub">${fmtNum(insights.topCityViews)} view${insights.topCityViews === 1 ? "" : "s"}</span>`
    : `<span class="sc-city-stat-sub">No first-party city data yet</span>`;

  return `
    <div class="sc-city-insights">
      <div class="sc-city-stat">
        <div class="sc-city-stat-label">Share of clicks</div>
        <div class="sc-city-stat-value">${insights.shareClicks}%</div>
      </div>
      <div class="sc-city-stat">
        <div class="sc-city-stat-label">Share of impressions</div>
        <div class="sc-city-stat-value">${insights.shareImpr}%</div>
      </div>
      <div class="sc-city-stat sc-city-stat-wide">
        <div class="sc-city-stat-label">Period change</div>
        <div class="sc-city-stat-value">${deltaCell}</div>
      </div>
      <div class="sc-city-stat sc-city-stat-wide">
        <div class="sc-city-stat-label">CTR vs site</div>
        <div class="sc-city-stat-value">${ctrCell}</div>
      </div>
      <div class="sc-city-stat sc-city-stat-wide">
        <div class="sc-city-stat-label">Top city (first-party)</div>
        <div class="sc-city-stat-value">${topCity}</div>
      </div>
    </div>`;
}

function formatVisitTimeInZone(iso, timezone) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  try {
    return date.toLocaleString(undefined, {
      timeZone: timezone,
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return formatVisitDateTime(iso);
  }
}

function prettyTimezone(tz) {
  if (!tz) return "";
  return String(tz).replace(/^.*\//, "").replace(/_/g, " ");
}

function parseVisitHistory(raw) {
  try {
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function visitHistoryHtml(history) {
  if (!history.length) return "";
  return `<div class="sc-map-history-title">Recent visits</div>
    <div class="sc-map-history-list">
      ${history.slice(0, 5).map((day) => `
        <div class="sc-map-history-row">
          <div>
            <strong>${esc(humanDate(day.date) || day.date)}</strong>
            ${day.updatedAt ? `<span>${esc(formatVisitTime(day.updatedAt))}</span>` : ""}
            ${day.lastPath ? `<em title="${esc(day.lastPath)}">${esc(pagePath(day.lastPath))}</em>` : ""}
          </div>
          <b>${fmtNum(day.views)} ${Number(day.views) === 1 ? "view" : "views"}</b>
        </div>`).join("")}
    </div>`;
}

function formatVisitDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value || "");
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatVisitTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `last seen ${date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}

function shortMapLabel(label) {
  const text = String(label || "").trim();
  return text.length > 16 ? `${text.slice(0, 15)}…` : text;
}

function scaledMapSize(value, maxValue, min, growth, meaningfulMax) {
  const scaleMax = Math.max(1, maxValue || 0, meaningfulMax || 1);
  const ratio = Math.max(0, Math.min(1, value / scaleMax));
  return min + Math.sqrt(ratio) * growth;
}

function formatMapZoom(zoom) {
  const rounded = Math.round(zoom);
  return Math.abs(zoom - rounded) < 0.05 ? String(rounded) : zoom.toFixed(1);
}

// ── States & cities panel (first-party site_geo_daily aggregates) ────────────
//
// Reads the cached geoVisits result from state.lastData and renders a
// searchable table inside the "Where readers search from" card's
// "States & cities" tab. Two group-by modes:
//   - "city":  one row per city × state × country
//   - "state": rows collapsed to country + state (a state can have many
//              cities, so we sum views across them)
//
// The searchbar matches city, state, region code, and country name.
function renderPlacesPanel(wrapper, state) {
  const panel = wrapper.querySelector('[data-geo-panel="places"]');
  if (!panel || panel.hidden) return; // tab not active — skip work, will re-run on activation
  const body = panel.querySelector("#sc-places-body");
  if (!body) return;

  const visits = state.lastData?.geoVisits;
  if (!visits || visits.status === "pending") {
    body.innerHTML = `<div class="loading-state"><div class="spinner"></div>Loading places…</div>`;
    return;
  }
  if (visits.status !== "fulfilled") {
    body.innerHTML = `<div class="error-state">${esc(visits.reason?.message || "Could not load places.")}</div>`;
    return;
  }

  const rows = visits.value?.rows || [];
  if (!rows.length) {
    body.innerHTML = `<div class="empty-state">No first-party visit data for this period yet. City and state breakdowns appear after readers visit the site within the selected window.</div>`;
    return;
  }

  const mode = state.placesMode === "state" ? "state" : "city";
  const query = String(state.placesQuery || "").trim().toLowerCase();

  // Bucket the raw rows. In state mode we collapse cities into their state.
  const buckets = new Map();
  for (const r of rows) {
    const country = (r.country || "").toUpperCase();
    const state2 = r.region || r.regionCode || "";
    const city = r.city && r.city !== "Unknown city" ? r.city : "";
    const key = mode === "state"
      ? `${country}|${state2}`
      : `${country}|${state2}|${city}`;
    const cur = buckets.get(key) || {
      country,
      state: state2,
      stateCode: r.regionCode || "",
      city,
      views: 0,
      days: 0,
      cityCount: new Set(),
      lastSeenAt: "",
      lastPath: "",
      timezone: r.timezone || "",
    };
    cur.views += Number(r.views || 0);
    cur.days += Number(r.days || 0);
    if (city) cur.cityCount.add(city);
    if (r.timezone && !cur.timezone) cur.timezone = r.timezone;
    if (r.lastPath && !cur.lastPath) cur.lastPath = r.lastPath;
    if (r.lastSeenAt && r.lastSeenAt > cur.lastSeenAt) cur.lastSeenAt = r.lastSeenAt;
    buckets.set(key, cur);
  }

  let display = Array.from(buckets.values())
    .map((b) => ({ ...b, cityCount: b.cityCount.size }))
    .sort((a, b) => b.views - a.views);

  if (query) {
    display = display.filter((b) => {
      const haystack = [
        b.city, b.state, b.stateCode, b.country, countryName(b.country),
      ].join(" ").toLowerCase();
      return haystack.includes(query);
    });
  }

  const totalViews = display.reduce((sum, r) => sum + r.views, 0);
  if (!display.length) {
    body.innerHTML = `<div class="empty-state">No ${mode === "state" ? "states" : "cities"} match "${esc(query)}". Try a different search.</div>`;
    return;
  }

  const maxViews = Math.max(1, ...display.map((r) => r.views));
  const rowsHtml = display.slice(0, 100).map((r) => {
    const pct = Math.round((r.views / maxViews) * 100);
    const place = mode === "state"
      ? (r.state || r.stateCode || "—")
      : (r.city || r.state || "—");
    const secondary = mode === "state"
      ? `${r.cityCount} ${r.cityCount === 1 ? "city" : "cities"}`
      : (r.state || r.stateCode || "");
    // Two-line cell: the bar lives in its own row beneath the
    // place/state stack so the long-place + nowrap rules from
    // .sc-dim-label don't clip the second line into a pill.
    return `<tr>
      <td class="sc-places-cell">
        <div class="sc-places-stack">
          <div class="sc-places-text">
            <span class="sc-places-place" title="${esc(place)}">${esc(place)}</span>
            ${secondary ? `<span class="sc-places-sub" title="${esc(secondary)}">${esc(secondary)}</span>` : ""}
          </div>
          <div class="sc-places-bar-track" aria-hidden="true">
            <div class="sc-places-bar-fill" style="width:${pct}%"></div>
          </div>
        </div>
      </td>
      <td class="sc-places-country muted">${esc(countryName(r.country))}</td>
      <td class="num strong">${fmtNum(r.views)}</td>
      <td class="num muted">${fmtNum(r.days)}</td>
    </tr>`;
  }).join("");

  body.innerHTML = `
    <div class="sc-places-summary">
      <strong>${fmtNum(display.length)}</strong> ${mode === "state" ? (display.length === 1 ? "state" : "states") : (display.length === 1 ? "city" : "cities")}
      · <strong>${fmtNum(totalViews)}</strong> view${totalViews === 1 ? "" : "s"} in this window${query ? ` matching "${esc(query)}"` : ""}
    </div>
    <table class="table sc-table sc-places-table">
      <colgroup>
        <col class="sc-places-col-place">
        <col class="sc-places-col-country">
        <col class="sc-places-col-views">
        <col class="sc-places-col-days">
      </colgroup>
      <thead>
        <tr>
          <th>${mode === "state" ? "State / region" : "City"}</th>
          <th>Country</th>
          <th class="num">Views</th>
          <th class="num" title="Distinct days this place appeared in the window">Days</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>
    ${display.length > 100 ? `<div class="sc-places-foot">Showing top 100 of ${fmtNum(display.length)}. Refine the search to narrow the list.</div>` : ""}
  `;
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
      <colgroup>
        <col class="sc-col-dim">
        <col class="sc-col-clicks">
        ${showDelta ? `<col class="sc-col-delta">` : ""}
        <col class="sc-col-impr">
        <col class="sc-col-ctr">
        <col class="sc-col-pos">
      </colgroup>
      <thead>
        <tr>
          <th>${dimKey === "query" ? tip("Query") : isPage ? tip("Page") : isCountry ? "Country" : isDevice ? "Device" : tip("Appearance", { term: "search appearance" })}</th>
          <th class="num">${tip("Clicks")}</th>
          ${showDelta ? `<th class="num" title="Change in clicks vs. the previous period">Δ</th>` : ""}
          <th class="num">${tip("Impr.", { term: "impressions" })}</th>
          <th class="num">${tip("CTR")}</th>
          <th class="num">${tip("Pos.", { term: "position" })}</th>
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

const COUNTRY_META = {
  USA: { name: "United States", lat: 39.8, lon: -98.6 },
  GBR: { name: "United Kingdom", lat: 55.4, lon: -3.4 },
  CAN: { name: "Canada", lat: 56.1, lon: -106.3 },
  AUS: { name: "Australia", lat: -25.3, lon: 133.8 },
  IND: { name: "India", lat: 20.6, lon: 78.9 },
  DEU: { name: "Germany", lat: 51.2, lon: 10.5 },
  FRA: { name: "France", lat: 46.2, lon: 2.2 },
  ITA: { name: "Italy", lat: 41.9, lon: 12.6, labelSide: "left", labelDy: 14 },
  ESP: { name: "Spain", lat: 40.5, lon: -3.7 },
  NLD: { name: "Netherlands", lat: 52.1, lon: 5.3 },
  BRA: { name: "Brazil", lat: -14.2, lon: -51.9 },
  MEX: { name: "Mexico", lat: 23.6, lon: -102.5 },
  JPN: { name: "Japan", lat: 36.2, lon: 138.3 },
  KOR: { name: "South Korea", lat: 35.9, lon: 127.8 },
  CHN: { name: "China", lat: 35.9, lon: 104.2 },
  IDN: { name: "Indonesia", lat: -0.8, lon: 113.9 },
  PHL: { name: "Philippines", lat: 12.9, lon: 122.8 },
  PAK: { name: "Pakistan", lat: 30.4, lon: 69.3 },
  BGD: { name: "Bangladesh", lat: 23.7, lon: 90.4 },
  NGA: { name: "Nigeria", lat: 9.1, lon: 8.7 },
  ZAF: { name: "South Africa", lat: -30.6, lon: 22.9 },
  EGY: { name: "Egypt", lat: 26.8, lon: 30.8 },
  KEN: { name: "Kenya", lat: -0.0, lon: 37.9 },
  RUS: { name: "Russia", lat: 61.5, lon: 105.3 },
  POL: { name: "Poland", lat: 51.9, lon: 19.1 },
  SWE: { name: "Sweden", lat: 60.1, lon: 18.6, labelDx: 2, labelDy: -6 },
  NOR: { name: "Norway", lat: 60.5, lon: 8.5 },
  DNK: { name: "Denmark", lat: 56.3, lon: 9.5 },
  IRL: { name: "Ireland", lat: 53.4, lon: -8.2 },
  NZL: { name: "New Zealand", lat: -40.9, lon: 174.9 },
  SGP: { name: "Singapore", lat: 1.4, lon: 103.8 },
  HKG: { name: "Hong Kong", lat: 22.3, lon: 114.2 },
  TWN: { name: "Taiwan", lat: 23.7, lon: 121.0 },
  THA: { name: "Thailand", lat: 15.9, lon: 101.0 },
  VNM: { name: "Vietnam", lat: 14.1, lon: 108.3 },
  MYS: { name: "Malaysia", lat: 4.2, lon: 101.9 },
  ARE: { name: "United Arab Emirates", lat: 24.0, lon: 54.0 },
  SAU: { name: "Saudi Arabia", lat: 23.9, lon: 45.1 },
  ISR: { name: "Israel", lat: 31.0, lon: 35.0, labelDx: 2, labelDy: 10 },
  TUR: { name: "Turkey", lat: 39.0, lon: 35.2 },
  ARG: { name: "Argentina", lat: -38.4, lon: -63.6 },
  CHL: { name: "Chile", lat: -35.7, lon: -71.5 },
  COL: { name: "Colombia", lat: 4.6, lon: -74.1 },
  PER: { name: "Peru", lat: -9.2, lon: -75.0 },
  AUT: { name: "Austria", lat: 47.5, lon: 14.6, labelDx: 4, labelDy: -6 },
  BEL: { name: "Belgium", lat: 50.5, lon: 4.5, labelDx: 4, labelDy: -12 },
  HRV: { name: "Croatia", lat: 45.1, lon: 15.2, labelDx: 6, labelDy: 8 },
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

function rangeTicks(min, max, count) {
  const span = max - min || 1;
  return Array.from({ length: count + 1 }, (_, i) => min + (span / count) * i);
}

function fmtPctTick(v) {
  if (v >= 10 || Number.isInteger(v)) return v.toFixed(0);
  return v.toFixed(1);
}

function avg(arr) {
  const nums = arr.filter((v) => Number.isFinite(v) && v > 0);
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

// Empty state for the trend chart — explains *why* and offers a one-click fix.
function renderTrendEmptyState() {
  return `
    <div class="sc-empty">
      <div class="sc-empty-icon" aria-hidden="true">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M7 14l4-4 4 4 5-5"/><circle cx="7" cy="14" r="1"/><circle cx="11" cy="10" r="1"/><circle cx="15" cy="14" r="1"/><circle cx="20" cy="9" r="1"/></svg>
      </div>
      <div class="sc-empty-title">No clicks or impressions for this range</div>
      <div class="sc-empty-body">
        Either Google hasn't reported activity for these dates yet (GSC data lags ~2 days), or this period genuinely had no traffic.
        A wider range usually has data — most sites do over a year.
      </div>
      <div class="sc-empty-actions">
        <button type="button" class="sc-apply-btn" data-action="try-year">Try the 1-year range</button>
      </div>
    </div>`;
}
