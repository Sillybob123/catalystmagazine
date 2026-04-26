// Newsletter Builder + Campaign History.
// Mount keys:
//   - "builder": compose + preview + send a newsletter
//   - "history": list past campaigns

import { el, esc, fmtRelative, fmtDate, confirmDialog } from "./ui.js";

export async function mount(ctx, container) {
  container.innerHTML = "";
  if (ctx.mountKey === "history") return mountHistory(ctx, container);
  return mountBuilder(ctx, container);
}

// ====================== BUILDER ============================================
async function mountBuilder(ctx, container) {
  const card = el("div", { class: "card" });
  card.innerHTML = `
    <div class="card-header">
      <div>
        <div class="card-title">Newsletter builder</div>
        <div class="card-subtitle">Generate a Gmail-safe issue from your most recent published articles.</div>
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <div role="tablist" aria-label="Newsletter theme" style="display:inline-flex;border:1px solid var(--hairline);border-radius:8px;overflow:hidden;">
          <button type="button" class="btn btn-ghost btn-xs" data-theme="classic" aria-pressed="true" style="border-radius:0;border:0;padding:6px 14px;font-weight:600;background:var(--surface-2);">Classic</button>
          <button type="button" class="btn btn-ghost btn-xs" data-theme="inbox" aria-pressed="false" style="border-radius:0;border:0;border-left:1px solid var(--hairline);padding:6px 14px;font-weight:600;">Inbox version</button>
        </div>
        <button class="btn btn-secondary btn-sm" id="btn-refresh">Regenerate</button>
        <button class="btn btn-primary btn-sm" id="btn-test">Send a test</button>
        <button class="btn btn-secondary btn-sm" id="btn-schedule">Schedule send…</button>
        <button class="btn btn-accent btn-sm" id="btn-send">Send to all subscribers</button>
      </div>
    </div>
    <!-- Scheduling panel — collapsed by default; opens via "Schedule send…". -->
    <div id="schedule-panel" style="display:none;padding:14px 20px;background:var(--surface-2);border-bottom:1px solid var(--hairline);">
      <div style="display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap;">
        <div class="field" style="margin:0;flex:1;min-width:240px;">
          <label class="label" for="f-scheduled-at">Send at (Eastern Time)</label>
          <input class="input" id="f-scheduled-at" type="datetime-local">
          <div class="hint" id="schedule-hint" style="margin-top:6px;">The newsletter will be dispatched within ~5 minutes of this time. You can cancel any time before then from the campaign history.</div>
        </div>
        <div style="display:flex;gap:6px;">
          <button type="button" class="btn btn-ghost btn-sm" id="btn-schedule-cancel">Cancel</button>
          <button type="button" class="btn btn-accent btn-sm" id="btn-schedule-confirm">Schedule</button>
        </div>
      </div>
    </div>
    <div id="theme-notice" style="display:none;margin:0 0 0 0;padding:10px 20px;background:#f0f9ff;border-bottom:1px solid #bae6fd;font-size:13px;color:#0369a1;line-height:1.5;">
      <strong>Inbox version</strong> — Plain-text letter style designed to land in Gmail Primary (not Promotions). Each subscriber sees their first name in the greeting. Your classic template is preserved; switch back any time.
    </div>
    <div class="card-body">
      <div class="grid" style="grid-template-columns: 1fr 1fr; gap:20px;">
        <div>
          <div class="field">
            <label class="label">Email subject line</label>
            <input class="input" id="f-subject" value="The Catalyst Newsletter">
          </div>
          <div class="field">
            <label class="label">Headline</label>
            <input class="input" id="f-headline" value="">
            <div class="hint">Appears at the top of the email, above the article cards.</div>
          </div>
          <div class="field">
            <label class="label">Intro paragraph</label>
            <textarea class="textarea" id="f-intro" rows="3">Here is the latest reporting from our team of student writers. Tap any card to read the full piece.</textarea>
          </div>
          <div id="builder-status" class="hint"></div>
          <div class="card" style="margin-top:20px;background:var(--surface-2);">
            <div class="card-body">
              <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:8px;">
                <div class="section-title" style="margin:0;">Articles in this issue</div>
                <div style="display:flex;gap:6px;">
                  <button type="button" class="btn btn-ghost btn-xs" id="btn-pick-top3">Pick 3 most recent</button>
                  <button type="button" class="btn btn-ghost btn-xs" id="btn-clear-picks">Clear</button>
                </div>
              </div>
              <div class="hint" style="margin-bottom:10px;">Check up to 3 articles. The 3 most recent are selected by default — override if you want a different mix.</div>
              <div id="article-picker"><div class="loading-state" style="padding:12px;"><div class="spinner"></div>Loading articles…</div></div>
            </div>
          </div>
        </div>
        <div>
          <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px;">
            <div class="section-title" style="margin:0;">Live preview</div>
            <div class="preview-size-toggle" role="tablist" aria-label="Preview width" style="display:inline-flex;border:1px solid var(--hairline);border-radius:8px;overflow:hidden;">
              <button type="button" class="btn btn-ghost btn-xs" data-preview-size="mobile" aria-pressed="true" style="border-radius:0;border:0;padding:6px 12px;font-weight:600;background:var(--surface-2);">Mobile</button>
              <button type="button" class="btn btn-ghost btn-xs" data-preview-size="desktop" aria-pressed="false" style="border-radius:0;border:0;border-left:1px solid var(--hairline);padding:6px 12px;font-weight:600;">Desktop (Gmail)</button>
            </div>
          </div>
          <div class="newsletter-frame" id="preview-frame-wrap"><iframe id="preview-frame" sandbox="allow-same-origin" title="Newsletter preview"></iframe></div>
          <div class="hint" id="preview-size-hint" style="margin-top:6px;">Rendering at 420px wide — matches phone mail clients.</div>
        </div>
      </div>
    </div>`;
  container.appendChild(card);

  const els = {
    subject: card.querySelector("#f-subject"),
    headline: card.querySelector("#f-headline"),
    intro: card.querySelector("#f-intro"),
    status: card.querySelector("#builder-status"),
    picker: card.querySelector("#article-picker"),
    btnTop3: card.querySelector("#btn-pick-top3"),
    btnClear: card.querySelector("#btn-clear-picks"),
    iframe: card.querySelector("#preview-frame"),
    frameWrap: card.querySelector("#preview-frame-wrap"),
    sizeHint: card.querySelector("#preview-size-hint"),
    btnRefresh: card.querySelector("#btn-refresh"),
    btnTest: card.querySelector("#btn-test"),
    btnSend: card.querySelector("#btn-send"),
    btnSchedule: card.querySelector("#btn-schedule"),
    btnScheduleConfirm: card.querySelector("#btn-schedule-confirm"),
    btnScheduleCancel: card.querySelector("#btn-schedule-cancel"),
    schedulePanel: card.querySelector("#schedule-panel"),
    scheduledAtInput: card.querySelector("#f-scheduled-at"),
    scheduleHint: card.querySelector("#schedule-hint"),
    themeNotice: card.querySelector("#theme-notice"),
  };

  // Active theme — "classic" (default, existing template) or "inbox" (new delivery-optimized)
  let activeTheme = "classic";

  // Available published articles (most recent first). Populated once on mount.
  let availableArticles = [];
  const MAX_PICK = 3;
  const selectedIds = new Set();

  // Theme toggle — switches between "classic" (branded card template) and
  // "inbox" (plain letter style optimized for Gmail Primary placement).
  card.querySelectorAll("[data-theme]").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeTheme = btn.dataset.theme;
      card.querySelectorAll("[data-theme]").forEach((b) => {
        const active = b === btn;
        b.setAttribute("aria-pressed", active ? "true" : "false");
        b.style.background = active ? "var(--surface-2)" : "";
        b.style.fontWeight = active ? "700" : "600";
      });
      els.themeNotice.style.display = activeTheme === "inbox" ? "block" : "none";
      // Swap intro placeholder text to match the expected tone for each theme.
      if (activeTheme === "inbox" && els.intro.value === "Here is the latest reporting from our team of student writers. Tap any card to read the full piece.") {
        els.intro.value = "";
      } else if (activeTheme === "classic" && !els.intro.value.trim()) {
        els.intro.value = "Here is the latest reporting from our team of student writers. Tap any card to read the full piece.";
      }
      regenerate();
    });
  });

  // Preview-width toggle. Desktop mode simulates Gmail's wider reading pane
  // (~900px), mobile simulates phone clients (~420px). The email template is
  // fluid — the iframe width change is what drives its @media breakpoints.
  els.frameWrap.dataset.size = "mobile";
  card.querySelectorAll("[data-preview-size]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const size = btn.dataset.previewSize;
      els.frameWrap.dataset.size = size;
      card.querySelectorAll("[data-preview-size]").forEach((b) => {
        b.setAttribute("aria-pressed", b === btn ? "true" : "false");
      });
      els.sizeHint.textContent = size === "desktop"
        ? "Rendering at full desktop width — matches Gmail's wide reading pane."
        : "Rendering at 420px wide — matches phone mail clients.";
    });
  });

  let currentHtml = "";
  let currentArticles = [];

  async function regenerate() {
    const ids = Array.from(selectedIds);
    if (!ids.length) {
      els.status.textContent = "Pick at least one article to preview.";
      renderPreview(els.iframe, "<html><body style='font-family:sans-serif;padding:40px;color:#666;text-align:center;'>Select one to three articles on the left to see the preview.</body></html>");
      currentHtml = "";
      currentArticles = [];
      return;
    }
    els.status.textContent = "Generating preview…";
    try {
      const count = ids.length;
      const headline = els.headline.value.trim() || (count === 1 ? "A fresh story from The Catalyst" : `${count} new stories from The Catalyst`);
      els.headline.value = headline;

      const res = await ctx.authedFetch("/api/newsletter/preview", {
        method: "POST",
        body: JSON.stringify({
          articleIds: ids,
          subject: els.subject.value,
          headline,
          intro: els.intro.value,
          theme: activeTheme,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
      currentHtml = data.html;
      currentArticles = data.articles || [];
      renderPreview(els.iframe, currentHtml);
      els.status.textContent = `Preview ready — ${currentArticles.length} article(s).${activeTheme === "inbox" ? " (Inbox version — preview shows \"Hi Reader\" greeting; real sends use each subscriber's first name.)" : ""}`;
    } catch (err) {
      els.status.textContent = "Could not generate preview: " + err.message;
    }
  }

  els.btnRefresh.addEventListener("click", regenerate);
  ["input", "change"].forEach((evt) => {
    els.subject.addEventListener(evt, debounced(regenerate, 600));
    els.headline.addEventListener(evt, debounced(regenerate, 600));
    els.intro.addEventListener(evt, debounced(regenerate, 600));
  });

  // ----- Article picker wiring -----
  function renderPicker() {
    if (!availableArticles.length) {
      els.picker.innerHTML = `<div class="empty-state" style="padding:12px;">No published articles yet.</div>`;
      return;
    }
    const atMax = selectedIds.size >= MAX_PICK;
    els.picker.innerHTML = availableArticles.map((a) => {
      const checked = selectedIds.has(a.id);
      const disabled = !checked && atMax;
      return `
        <label class="article-row" style="margin-bottom:6px;padding:10px 12px;display:grid;grid-template-columns:24px 1fr;gap:10px;align-items:start;cursor:${disabled ? "not-allowed" : "pointer"};opacity:${disabled ? "0.5" : "1"};">
          <input type="checkbox" data-article-id="${esc(a.id)}" ${checked ? "checked" : ""} ${disabled ? "disabled" : ""} style="margin-top:3px;">
          <div>
            <div class="article-title" style="font-size:14px;">${esc(a.title || "Untitled")}</div>
            <div class="article-meta">${esc(a.category || "Feature")}${a.author ? " · " + esc(a.author) : ""}${a.date ? " · " + esc(a.date) : ""}</div>
          </div>
        </label>`;
    }).join("");
  }

  els.picker.addEventListener("change", (e) => {
    const cb = e.target.closest('input[type="checkbox"][data-article-id]');
    if (!cb) return;
    const id = cb.dataset.articleId;
    if (cb.checked) {
      if (selectedIds.size >= MAX_PICK) { cb.checked = false; return; }
      selectedIds.add(id);
    } else {
      selectedIds.delete(id);
    }
    renderPicker();
    regenerate();
  });

  els.btnTop3.addEventListener("click", () => {
    selectedIds.clear();
    availableArticles.slice(0, MAX_PICK).forEach((a) => selectedIds.add(a.id));
    renderPicker();
    regenerate();
  });

  els.btnClear.addEventListener("click", () => {
    selectedIds.clear();
    renderPicker();
    regenerate();
  });

  // Load published articles for the picker, preselect top 3, then regenerate.
  loadPublishedArticles()
    .then((list) => {
      availableArticles = list;
      list.slice(0, MAX_PICK).forEach((a) => selectedIds.add(a.id));
      renderPicker();
      regenerate();
    })
    .catch((err) => {
      els.picker.innerHTML = `<div class="error-state">${esc(err.message)}</div>`;
    });

  // Build the inboxParams payload needed by the server to re-render per subscriber.
  // Only used when activeTheme === "inbox".
  function buildInboxParams() {
    return {
      headline: els.headline.value.trim(),
      intro: els.intro.value.trim(),
      articles: currentArticles,
      siteUrl: "https://www.catalyst-magazine.com",
    };
  }

  els.btnTest.addEventListener("click", async () => {
    const testEmail = prompt("Send a test to which email?", ctx.profile.email || ctx.user.email || "");
    if (!testEmail) return;
    try {
      els.status.textContent = "Sending test…";
      const payload = {
        subject: els.subject.value,
        html: currentHtml,
        testEmail,
        theme: activeTheme,
      };
      if (activeTheme === "inbox") payload.inboxParams = buildInboxParams();
      const res = await ctx.authedFetch("/api/newsletter/send", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
      ctx.toast(`Test sent to ${testEmail}`, "success");
      els.status.textContent = "Test sent.";
    } catch (err) {
      ctx.toast("Test failed: " + err.message, "error");
      els.status.textContent = "Test failed.";
    }
  });

  // ----- Schedule send wiring -----
  // Default the input to "tomorrow at 9am Eastern" so admins don't have to
  // hunt for a sensible starting value. The DOM input is in the browser's
  // local TZ, so we convert ET → local for the default, then local → ET for
  // submission via the helpers below.
  function setDefaultScheduleValue() {
    const now = new Date();
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0, 0);
    els.scheduledAtInput.value = formatLocalForInput(tomorrow);
  }

  els.btnSchedule.addEventListener("click", () => {
    if (!currentHtml) { ctx.toast("Regenerate the preview first.", "error"); return; }
    if (!els.scheduledAtInput.value) setDefaultScheduleValue();
    els.schedulePanel.style.display = "block";
    els.scheduledAtInput.focus();
  });

  els.btnScheduleCancel.addEventListener("click", () => {
    els.schedulePanel.style.display = "none";
  });

  els.btnScheduleConfirm.addEventListener("click", async () => {
    const local = els.scheduledAtInput.value;
    if (!local) { ctx.toast("Pick a date and time first.", "error"); return; }

    // Reinterpret the input value (which the browser parsed as local TZ) as
    // Eastern Time. Returns a UTC ISO string for the API.
    const utcIso = easternLocalToUtcIso(local);
    if (!utcIso) { ctx.toast("Invalid date.", "error"); return; }
    const sched = new Date(utcIso);
    if (sched.getTime() < Date.now() + 60_000) {
      ctx.toast("Pick a time at least 1 minute in the future.", "error");
      return;
    }

    const themeLabel = activeTheme === "inbox" ? "Inbox version (personalized)" : "Classic";
    const prettyEt = sched.toLocaleString("en-US", {
      timeZone: "America/New_York",
      dateStyle: "full",
      timeStyle: "short",
    });
    const ok = await confirmDialog(
      `Schedule this newsletter (${themeLabel}) to send at ${prettyEt} Eastern? You can cancel it from the history page any time before then.`,
      { confirmText: "Schedule", danger: false }
    );
    if (!ok) return;

    try {
      els.status.textContent = "Scheduling…";
      els.btnScheduleConfirm.disabled = true;
      const payload = {
        subject: els.subject.value,
        html: currentHtml,
        theme: activeTheme,
        scheduledAt: utcIso,
      };
      if (activeTheme === "inbox") payload.inboxParams = buildInboxParams();
      const res = await ctx.authedFetch("/api/newsletter/send", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
      ctx.toast(`Scheduled for ${prettyEt} ET.`, "success");
      els.status.textContent = `Scheduled. Campaign ID: ${data.campaignId}. Cancel from the history page if needed.`;
      els.schedulePanel.style.display = "none";
    } catch (err) {
      ctx.toast("Schedule failed: " + err.message, "error");
      els.status.textContent = "Schedule failed.";
    } finally {
      els.btnScheduleConfirm.disabled = false;
    }
  });

  els.btnSend.addEventListener("click", async () => {
    if (!currentHtml) { ctx.toast("Regenerate the preview first.", "error"); return; }
    const themeLabel = activeTheme === "inbox" ? "Inbox version (personalized)" : "Classic";
    const ok = await confirmDialog(`Send this newsletter (${themeLabel}) to every active subscriber? This cannot be undone.`, { confirmText: "Send to all", danger: true });
    if (!ok) return;
    try {
      els.status.textContent = "Sending…";
      els.btnSend.disabled = true;
      const payload = {
        subject: els.subject.value,
        html: currentHtml,
        theme: activeTheme,
      };
      if (activeTheme === "inbox") payload.inboxParams = buildInboxParams();
      const res = await ctx.authedFetch("/api/newsletter/send", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
      ctx.toast(`Sent to ${data.recipientCount} subscriber(s).`, "success");
      els.status.textContent = `Sent to ${data.recipientCount} subscriber(s). Campaign ID: ${data.campaignId}`;
    } catch (err) {
      ctx.toast("Send failed: " + err.message, "error");
      els.status.textContent = "Send failed.";
    } finally {
      els.btnSend.disabled = false;
    }
  });

  // Initial load happens in loadPublishedArticles().then(... regenerate()).
}

// Public Firestore REST query — stories with status=published are publicly
// readable per firestore.rules, so no auth token is required. Mirrors the
// query used by the public site in js/main.js.
async function loadPublishedArticles() {
  const projectId = "catalystwriters-5ce43";
  const endpoint = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery`;
  const body = {
    structuredQuery: {
      from: [{ collectionId: "stories" }],
      where: {
        fieldFilter: {
          field: { fieldPath: "status" },
          op: "EQUAL",
          value: { stringValue: "published" },
        },
      },
      orderBy: [{ field: { fieldPath: "publishedAt" }, direction: "DESCENDING" }],
      limit: 40,
    },
  };
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Firestore ${res.status}`);
  const rows = await res.json();
  if (!Array.isArray(rows)) return [];
  return rows
    .map((r) => r.document)
    .filter(Boolean)
    .map((doc) => {
      const id = (doc.name || "").split("/").pop();
      const f = doc.fields || {};
      const str = (k) => f[k]?.stringValue ?? "";
      const ts = f.publishedAt?.timestampValue || f.createdAt?.timestampValue || "";
      const date = ts ? new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "";
      return {
        id,
        title: str("title"),
        author: str("authorName") || str("author"),
        category: str("category"),
        date,
      };
    })
    .filter((a) => a.id && a.title);
}

function renderPreview(iframe, html) {
  // Use srcdoc so Gmail's sanitizer isn't involved — this is a dev preview only.
  iframe.srcdoc = html;
}

function debounced(fn, ms) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// Format a Date for an <input type="datetime-local"> value (browser-local).
function formatLocalForInput(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Reinterpret a "datetime-local" string (no timezone info) as Eastern Time
// regardless of the user's browser TZ, and return the corresponding UTC ISO.
//
// The trick: build a Date as if the string were UTC, then ask Intl what
// time *that* UTC instant looks like in America/New_York. The difference
// between what we wanted (the local string) and what we got is the ET
// offset for that wall-clock time — DST included. Subtract it.
function easternLocalToUtcIso(localStr) {
  // localStr: "2026-04-28T09:00" (no seconds, no TZ)
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(localStr);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number);
  // Pretend the wall-clock is UTC.
  const fakeUtc = Date.UTC(y, mo - 1, d, h, mi, 0);
  // Ask what that instant would be in NY wall-clock.
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date(fakeUtc));
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  const nyAsUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  // The offset between fakeUtc-as-NY and the fake instant tells us NY's
  // offset for that wall-clock; the *actual* UTC instant is fakeUtc minus
  // that offset (going the other way: NY ahead of UTC by `-offset`).
  const offsetMs = nyAsUtc - fakeUtc;
  return new Date(fakeUtc - offsetMs).toISOString();
}

// ====================== HISTORY ============================================
async function mountHistory(ctx, container) {
  const card = el("div", { class: "card" });
  card.innerHTML = `
    <div class="card-header">
      <div>
        <div class="card-title">Campaign history</div>
        <div class="card-subtitle">Every newsletter you've sent.</div>
      </div>
      <a class="btn btn-accent btn-sm" href="#/newsletter/builder">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        New campaign
      </a>
    </div>
    <div class="card-body" id="hist-body"><div class="loading-state"><div class="spinner"></div>Loading…</div></div>`;
  container.appendChild(card);

  async function load() {
    try {
      const res = await ctx.authedFetch("/api/newsletter/history");
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
      const body = card.querySelector("#hist-body");
      if (!data.campaigns.length) { body.innerHTML = `<div class="empty-state">No campaigns yet.</div>`; return; }

      const scheduled = data.campaigns.filter(c => c.status === "scheduled");
      const others = data.campaigns.filter(c => c.status !== "scheduled");

      const scheduledHtml = scheduled.length ? `
        <div class="section-title" style="margin:0 0 10px 0;">Scheduled</div>
        <table class="table" style="margin-bottom:24px;">
          <thead><tr>
            <th>Subject</th><th>Sends at (ET)</th><th>Status</th><th>By</th><th></th>
          </tr></thead>
          <tbody>
            ${scheduled.map(c => `
              <tr data-campaign-id="${esc(c.id)}">
                <td><strong>${esc(c.subject || "(no subject)")}</strong></td>
                <td>${c.scheduledAt ? esc(fmtEastern(c.scheduledAt)) : "—"}</td>
                <td>${pillForStatus(c.status)}</td>
                <td>${esc(c.createdBy || "—")}</td>
                <td style="text-align:right;">
                  <button class="btn btn-ghost btn-xs" data-cancel="${esc(c.id)}">Cancel</button>
                </td>
              </tr>`).join("")}
          </tbody>
        </table>` : "";

      const sentHtml = others.length ? `
        <div class="section-title" style="margin:0 0 10px 0;">Past campaigns</div>
        <table class="table">
          <thead><tr>
            <th>Subject</th><th>Sent</th><th>Recipients</th><th>Status</th><th>By</th>
          </tr></thead>
          <tbody>
            ${others.map(c => `
              <tr>
                <td><strong>${esc(c.subject || "(no subject)")}</strong></td>
                <td>${c.sentAt ? fmtDate(c.sentAt) + " · " + fmtRelative(c.sentAt) : fmtRelative(c.createdAt)}</td>
                <td>${c.sentCount || c.recipientCount || 0} / ${c.recipientCount || 0}</td>
                <td>${pillForStatus(c.status)}</td>
                <td>${esc(c.createdBy || "—")}</td>
              </tr>`).join("")}
          </tbody>
        </table>` : "";

      body.innerHTML = scheduledHtml + sentHtml;

      // Wire up Cancel buttons on scheduled rows.
      body.querySelectorAll("[data-cancel]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const campaignId = btn.dataset.cancel;
          const ok = await confirmDialog(
            "Cancel this scheduled newsletter? It will not be sent.",
            { confirmText: "Cancel send", danger: true }
          );
          if (!ok) return;
          btn.disabled = true;
          try {
            const res = await ctx.authedFetch("/api/newsletter/cancel", {
              method: "POST",
              body: JSON.stringify({ campaignId }),
            });
            const out = await res.json();
            if (!res.ok || !out.ok) throw new Error(out.error || `HTTP ${res.status}`);
            ctx.toast("Scheduled send canceled.", "success");
            await load();
          } catch (err) {
            ctx.toast("Cancel failed: " + err.message, "error");
            btn.disabled = false;
          }
        });
      });
    } catch (err) {
      card.querySelector("#hist-body").innerHTML = `<div class="error-state">${esc(err.message)}</div>`;
    }
  }

  await load();
}

// Format an ISO timestamp as a human-readable Eastern Time string.
function fmtEastern(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("en-US", {
      timeZone: "America/New_York",
      month: "short", day: "numeric", year: "numeric",
      hour: "numeric", minute: "2-digit",
    });
  } catch { return iso; }
}

function pillForStatus(s) {
  const map = { sent: "pill-published", sending: "pill-reviewing", failed: "pill-rejected", draft: "pill-draft" };
  const cls = map[s] || "pill-draft";
  return `<span class="pill ${cls}">${esc(s || "draft")}</span>`;
}
