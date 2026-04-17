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
      <div style="display:flex;gap:8px;">
        <button class="btn btn-secondary btn-sm" id="btn-refresh">Regenerate</button>
        <button class="btn btn-primary btn-sm" id="btn-test">Send a test</button>
        <button class="btn btn-accent btn-sm" id="btn-send">Send to all subscribers</button>
      </div>
    </div>
    <div class="card-body">
      <div class="grid" style="grid-template-columns: 1fr 1fr; gap:20px;">
        <div>
          <div class="field">
            <label class="label">How many recent articles to include?</label>
            <select class="select" id="f-count">
              <option value="3">3 most recent articles (recommended)</option>
              <option value="2">2 most recent articles</option>
              <option value="1">1 most recent article</option>
            </select>
          </div>
          <div class="field">
            <label class="label">Email subject line</label>
            <input class="input" id="f-subject" value="New from The Catalyst">
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
              <div class="section-title" style="margin-top:0;">Articles included</div>
              <div id="article-list"><div class="loading-state" style="padding:12px;"><div class="spinner"></div>Fetching…</div></div>
            </div>
          </div>
        </div>
        <div>
          <div class="section-title" style="margin-top:0;">Live preview</div>
          <div class="newsletter-frame"><iframe id="preview-frame" sandbox="allow-same-origin" title="Newsletter preview"></iframe></div>
        </div>
      </div>
    </div>`;
  container.appendChild(card);

  const els = {
    count: card.querySelector("#f-count"),
    subject: card.querySelector("#f-subject"),
    headline: card.querySelector("#f-headline"),
    intro: card.querySelector("#f-intro"),
    status: card.querySelector("#builder-status"),
    articleList: card.querySelector("#article-list"),
    iframe: card.querySelector("#preview-frame"),
    btnRefresh: card.querySelector("#btn-refresh"),
    btnTest: card.querySelector("#btn-test"),
    btnSend: card.querySelector("#btn-send"),
  };

  let currentHtml = "";
  let currentArticles = [];

  async function regenerate() {
    els.status.textContent = "Generating preview…";
    els.articleList.innerHTML = `<div class="loading-state" style="padding:12px;"><div class="spinner"></div>Fetching…</div>`;
    try {
      const count = parseInt(els.count.value, 10);
      const headline = els.headline.value.trim() || (count === 1 ? "A fresh story from The Catalyst" : `${count} new stories from The Catalyst`);
      els.headline.value = headline;

      const res = await ctx.authedFetch("/api/newsletter/preview", {
        method: "POST",
        body: JSON.stringify({
          count,
          subject: els.subject.value,
          headline,
          intro: els.intro.value,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
      currentHtml = data.html;
      currentArticles = data.articles || [];

      renderArticleList(els.articleList, currentArticles);
      renderPreview(els.iframe, currentHtml);
      els.status.textContent = `Preview ready — ${currentArticles.length} article(s).`;
    } catch (err) {
      els.status.textContent = "Could not generate preview: " + err.message;
      els.articleList.innerHTML = `<div class="error-state">${esc(err.message)}</div>`;
    }
  }

  els.btnRefresh.addEventListener("click", regenerate);
  els.count.addEventListener("change", regenerate);
  ["input", "change"].forEach((evt) => {
    els.subject.addEventListener(evt, debounced(regenerate, 600));
    els.headline.addEventListener(evt, debounced(regenerate, 600));
    els.intro.addEventListener(evt, debounced(regenerate, 600));
  });

  els.btnTest.addEventListener("click", async () => {
    const testEmail = prompt("Send a test to which email?", ctx.profile.email || ctx.user.email || "");
    if (!testEmail) return;
    try {
      els.status.textContent = "Sending test…";
      const res = await ctx.authedFetch("/api/newsletter/send", {
        method: "POST",
        body: JSON.stringify({
          subject: els.subject.value,
          html: currentHtml,
          testEmail,
        }),
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

  els.btnSend.addEventListener("click", async () => {
    if (!currentHtml) { ctx.toast("Regenerate the preview first.", "error"); return; }
    const ok = await confirmDialog("Send this newsletter to every active subscriber? This cannot be undone.", { confirmText: "Send to all", danger: true });
    if (!ok) return;
    try {
      els.status.textContent = "Sending…";
      els.btnSend.disabled = true;
      const res = await ctx.authedFetch("/api/newsletter/send", {
        method: "POST",
        body: JSON.stringify({
          subject: els.subject.value,
          html: currentHtml,
        }),
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

  // Initial generation.
  regenerate();
}

function renderArticleList(mount, articles) {
  if (!articles.length) { mount.innerHTML = `<div class="empty-state">No articles found.</div>`; return; }
  mount.innerHTML = articles.map((a) => `
    <div class="article-row" style="margin-bottom:8px;padding:10px 12px;">
      <div>
        <div class="article-title" style="font-size:14px;">${esc(a.title || "Untitled")}</div>
        <div class="article-meta">${esc(a.category || "Feature")}${a.author ? " · " + esc(a.author) : ""}</div>
      </div>
    </div>`).join("");
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

  try {
    const res = await ctx.authedFetch("/api/newsletter/history");
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
    const body = card.querySelector("#hist-body");
    if (!data.campaigns.length) { body.innerHTML = `<div class="empty-state">No campaigns yet.</div>`; return; }
    body.innerHTML = `
      <table class="table">
        <thead><tr>
          <th>Subject</th><th>Sent</th><th>Recipients</th><th>Status</th><th>By</th>
        </tr></thead>
        <tbody>
          ${data.campaigns.map(c => `
            <tr>
              <td><strong>${esc(c.subject || "(no subject)")}</strong></td>
              <td>${c.sentAt ? fmtDate(c.sentAt) + " · " + fmtRelative(c.sentAt) : fmtRelative(c.createdAt)}</td>
              <td>${c.sentCount || c.recipientCount || 0} / ${c.recipientCount || 0}</td>
              <td>${pillForStatus(c.status)}</td>
              <td>${esc(c.createdBy || "—")}</td>
            </tr>`).join("")}
        </tbody>
      </table>`;
  } catch (err) {
    card.querySelector("#hist-body").innerHTML = `<div class="error-state">${esc(err.message)}</div>`;
  }
}

function pillForStatus(s) {
  const map = { sent: "pill-published", sending: "pill-reviewing", failed: "pill-rejected", draft: "pill-draft" };
  const cls = map[s] || "pill-draft";
  return `<span class="pill ${cls}">${esc(s || "draft")}</span>`;
}
