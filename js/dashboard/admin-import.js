// Admin → Advanced tools
// Imports a Wix "Posts.csv" export as published stories. Admin-only.
//
// The Wix CSV contains quoted, multi-line fields with escaped double quotes.
// We parse it with a state machine (no external deps) and map the columns we
// care about into Catalyst's `stories` schema.

import { db } from "../firebase-config.js";
import {
  collection, addDoc, query, where, getDocs, orderBy,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { el, esc, toast, slugify } from "./ui.js";

// A user is "recently joined" if their account was created within this many
// days. The welcome email panel surfaces these at the top so the admin can fire
// off a welcome email to new arrivals without scrolling.
const RECENT_JOIN_DAYS = 14;

export async function mount(ctx, container) {
  container.innerHTML = "";
  const card = el("div", { class: "card" });
  card.innerHTML = `
    <div class="card-header">
      <div>
        <div class="card-title">Advanced tools</div>
        <div class="card-subtitle">Admin-only utilities. Use with care — these write directly to the live database.</div>
      </div>
    </div>
    <div class="card-body" style="display:grid;gap:16px;">
      <div style="border:1px solid var(--hairline);border-radius:10px;padding:16px;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">
          <div>
            <div style="font-weight:700;color:var(--ink-1);">Import from Wix CSV</div>
            <div class="hint" style="margin-top:4px;max-width:640px;">
              Upload a <code>Posts.csv</code> export from your old Wix blog. Each row becomes a <strong>draft</strong>
              you can review and publish from <em>All articles &amp; approvals</em>. Existing articles with the same slug are skipped.
            </div>
          </div>
          <label class="btn btn-accent btn-sm" style="cursor:pointer;">
            <input id="csv-file" type="file" accept=".csv,text/csv" style="display:none;">
            Choose CSV file
          </label>
        </div>
        <div id="import-panel" style="margin-top:16px;"></div>
      </div>

      <div style="border:1px solid var(--hairline);border-radius:10px;padding:16px;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">
          <div>
            <div style="font-weight:700;color:var(--ink-1);">Export all articles as TXT</div>
            <div class="hint" style="margin-top:4px;max-width:640px;">
              Downloads a single <code>.txt</code> with every article's title, byline, status, URL, cover image,
              excerpt, and full body. Use it to paste into an LLM for grammar or editing help.
            </div>
          </div>
          <button id="export-txt" class="btn btn-secondary btn-sm">Export articles</button>
        </div>
        <div id="export-status" class="hint" style="margin-top:10px;"></div>
      </div>

      <div style="border:1px solid var(--hairline);border-radius:10px;padding:16px;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">
          <div>
            <div style="font-weight:700;color:var(--ink-1);">Welcome email sender</div>
            <div class="hint" style="margin-top:4px;max-width:640px;">
              Send a new contributor an onboarding email with their sign-in details and a role-specific
              walkthrough of the editorial suite. Recently joined users (last ${RECENT_JOIN_DAYS} days) are
              highlighted at the top — but you can force-send the welcome email to any user.
            </div>
          </div>
          <button id="welcome-refresh" class="btn btn-secondary btn-sm">Refresh list</button>
        </div>
        <div id="welcome-panel" style="margin-top:14px;">
          <div class="loading-state"><div class="spinner"></div>Loading users…</div>
        </div>
      </div>

      <div style="border:1px solid #b7e4c7;border-left:4px solid #22c55e;border-radius:10px;padding:16px;background:#f0fdf4;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">
          <div>
            <div style="font-weight:800;color:#14532d;">Send email guidance</div>
            <div class="hint" style="margin-top:4px;max-width:720px;color:#166534;">
              Send a polished, detailed help email from Aidan and Yair to a selected user. Use this when a writer,
              editor, newsletter builder, or marketing teammate is confused about a dashboard workflow.
            </div>
          </div>
          <button id="guidance-refresh" class="btn btn-secondary btn-sm">Refresh</button>
        </div>
        <div id="guidance-panel" style="margin-top:14px;">
          <div class="loading-state"><div class="spinner"></div>Loading guidance tool…</div>
        </div>
      </div>
    </div>`;
  container.appendChild(card);

  const fileInput = card.querySelector("#csv-file");
  const panel = card.querySelector("#import-panel");
  const exportBtn = card.querySelector("#export-txt");
  const exportStatus = card.querySelector("#export-status");

  exportBtn.addEventListener("click", async () => {
    exportBtn.disabled = true;
    exportBtn.textContent = "Exporting…";
    exportStatus.textContent = "Fetching articles…";
    try {
      // No orderBy — Firestore drops any doc missing the order field, which
      // silently excluded older articles that never had `updatedAt` stamped.
      // We grab everything and sort client-side with a dated fallback chain.
      const snap = await getDocs(collection(db, "stories"));
      const stories = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => sortKey(b) - sortKey(a));
      const txt = storiesToTxt(stories);
      downloadText(`catalyst-articles-${dateStamp()}.txt`, txt);
      exportStatus.textContent = `Exported ${stories.length} article${stories.length === 1 ? "" : "s"}.`;
      toast(`Exported ${stories.length} articles.`, "success");
    } catch (err) {
      console.error(err);
      exportStatus.innerHTML = `<span style="color:var(--danger);">Export failed: ${esc(err.message)}</span>`;
      toast("Export failed.", "error");
    } finally {
      exportBtn.disabled = false;
      exportBtn.textContent = "Export articles";
    }
  });

  // ---------- Welcome email sender ----------
  const welcomePanel = card.querySelector("#welcome-panel");
  const welcomeRefresh = card.querySelector("#welcome-refresh");
  const loadWelcome = () => loadWelcomeEmailSender(ctx, welcomePanel);
  // Attach the click delegate once — loadWelcomeEmailSender only swaps innerHTML, so
  // the panel element itself sticks around and a single listener handles
  // every Send button across refreshes.
  welcomePanel.addEventListener("click", (e) => handleWelcomeClick(e, ctx));
  welcomeRefresh.addEventListener("click", loadWelcome);
  loadWelcome();

  // ---------- Email Guidance ----------
  const guidancePanel = card.querySelector("#guidance-panel");
  const guidanceRefresh = card.querySelector("#guidance-refresh");
  const loadGuidance = () => loadGuidanceEmailTool(ctx, guidancePanel);
  guidanceRefresh.addEventListener("click", loadGuidance);
  loadGuidance();

  fileInput.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    panel.innerHTML = `<div class="loading-state"><div class="spinner"></div>Parsing ${esc(file.name)}…</div>`;
    try {
      const text = await file.text();
      const { headers, rows } = parseCSV(text);
      const parsed = rows.map((r) => mapRow(headers, r)).filter((p) => p.title && p.body);
      if (!parsed.length) {
        panel.innerHTML = `<div class="empty-state">No usable rows found. Make sure the CSV has Title and Plain Content columns.</div>`;
        return;
      }
      renderPreview(ctx, panel, parsed);
    } catch (err) {
      console.error(err);
      panel.innerHTML = `<div class="error-state">Parse failed: ${esc(err.message)}</div>`;
    }
    fileInput.value = "";
  });
}

// ---------- CSV parsing ----------
// State machine. Handles quoted fields, embedded newlines, and "" escapes.
function parseCSV(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1); // BOM
  const rows = [];
  let field = "";
  let row = [];
  let i = 0;
  let inQuotes = false;
  const len = text.length;
  while (i < len) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === ",") { row.push(field); field = ""; i++; continue; }
    if (c === "\r") { i++; continue; }
    if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
    field += c; i++;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return { headers: [], rows: [] };
  const headers = rows.shift().map((h) => h.trim());
  const nonEmpty = rows.filter((r) => r.some((v) => v && v.trim()));
  return { headers, rows: nonEmpty };
}

function mapRow(headers, row) {
  const get = (name) => {
    const idx = headers.indexOf(name);
    return idx >= 0 ? (row[idx] || "") : "";
  };
  const title = get("Title").trim();
  // Use the CSV's Author value as-is (admin can override in Edit details).
  // Wix exports often store a UUID here rather than a readable name — flag it
  // in the preview so the admin notices and fixes it before publishing.
  const author = get("Author").trim();
  const excerpt = get("Excerpt").trim();
  const cover = get("Cover Image").trim();
  const plain = get("Plain Content");
  const published = get("Published Date").trim();
  const slugRaw = get("Slug").trim();
  const category = get("Main Category").trim();

  return {
    title,
    authorName: author,
    dek: excerpt,
    coverImage: cover,
    body: plainToHtml(plain),
    publishedAt: normalizeDate(published),
    slug: slugRaw ? slugify(slugRaw) : slugify(title),
    category: mapCategory(category),
  };
}

// Wix "Plain Content" is a single flat string: paragraph boundaries are
// signalled (inconsistently) by double-newlines, but Wix also injects stray
// single newlines mid-sentence — often right after abbreviations like "Dr.",
// "D.C.", or "Ph.D." Splitting on those newlines produced fragments like
// "...from the treetops. Dr." followed by "Kelly Russo-Petrick". We treat
// single newlines as soft breaks (glue them back with a space), and only
// split on hard paragraph boundaries (double-newline, or sentence-end
// followed by newline and a capital letter that isn't a known abbreviation).
function plainToHtml(raw) {
  if (!raw) return "";
  let cleaned = String(raw).replace(/\r\n/g, "\n").trim();
  if (!cleaned) return "";

  // 1. Collapse runs of whitespace within each line so single newlines that
  //    split a sentence across "lines" get normalized to a single space.
  cleaned = cleaned.replace(/[ \t]+/g, " ");

  // 2. Normalize single newlines to spaces unless they look like a real
  //    paragraph break. A real break = blank line, OR the prior character is
  //    a sentence-ending punctuation *that isn't a common abbreviation* and
  //    the next line starts with a capital.
  const KNOWN_ABBREVS = [
    "Dr", "Mr", "Mrs", "Ms", "Prof", "Sr", "Jr", "St", "Ave", "Rd", "Blvd",
    "Inc", "Ltd", "Co", "Corp", "Rev", "Gen", "Gov", "Pres", "Sen", "Rep",
    "U.S", "U.K", "U.N", "D.C", "N.Y", "L.A", "Ph.D", "M.D", "B.A", "M.A",
    "a.m", "p.m", "etc", "vs", "e.g", "i.e",
  ];
  const abbrevTest = new RegExp(
    "(?:\\b(?:" + KNOWN_ABBREVS.map((a) => a.replace(/\./g, "\\.")).join("|") + ")\\.)$",
    "i",
  );

  // Work line-by-line; join each pair with " " or "\n\n" as appropriate.
  const lines = cleaned.split(/\n/);
  let out = "";
  for (let i = 0; i < lines.length; i++) {
    const cur = lines[i].trim();
    if (!cur) {
      // blank line → hard paragraph break
      if (!out.endsWith("\n\n") && out.length) out += "\n\n";
      continue;
    }
    if (!out) { out = cur; continue; }
    if (out.endsWith("\n\n")) { out += cur; continue; }

    const prevEndsSentence = /[.!?][")\]]?$/.test(out);
    const nextStartsCapital = /^[A-Z“"(\[]/.test(cur);
    const prevIsAbbrev = abbrevTest.test(out);

    if (prevEndsSentence && nextStartsCapital && !prevIsAbbrev) {
      out += "\n\n" + cur; // real paragraph break
    } else {
      out += " " + cur; // soft line break → merge
    }
  }

  // 3. Final split into paragraphs.
  const chunks = out.split(/\n{2,}/).map((c) => c.trim()).filter(Boolean);
  return chunks.map((c) => `<p>${escapeHtml(c)}</p>`).join("\n");
}

function looksLikeUuid(s) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function normalizeDate(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

function mapCategory(wixCategory) {
  if (!wixCategory) return "Feature";
  const allowed = ["Feature", "Profile", "Interview", "Op-Ed", "News", "Science"];
  const hit = allowed.find((c) => c.toLowerCase() === wixCategory.toLowerCase());
  return hit || "Feature";
}

// ---------- Preview + import ----------
function renderPreview(ctx, panel, items) {
  panel.innerHTML = "";
  const header = el("div", {
    style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap", marginBottom: "10px" },
  });
  header.innerHTML = `
    <div style="font-weight:700;color:var(--ink-1);">Found ${items.length} article${items.length === 1 ? "" : "s"}</div>
    <div style="display:flex;gap:8px;">
      <button class="btn btn-secondary btn-sm" id="toggle-all">Toggle all</button>
      <button class="btn btn-accent btn-sm" id="import-btn">Import selected</button>
    </div>`;
  panel.appendChild(header);

  const list = el("div", { style: { display: "grid", gap: "8px", maxHeight: "480px", overflow: "auto", padding: "4px" } });
  items.forEach((a, idx) => {
    const row = el("div", {
      style: {
        display: "grid",
        gridTemplateColumns: "28px 1fr",
        gap: "10px",
        alignItems: "start",
        padding: "10px 12px",
        border: "1px solid var(--hairline)",
        borderRadius: "8px",
        background: "var(--surface)",
      },
    });
    const authorIsUuid = looksLikeUuid(a.authorName);
    const authorValue = authorIsUuid ? "" : (a.authorName || "");
    const dateValue = toDatetimeLocal(a.publishedAt);
    row.innerHTML = `
      <input type="checkbox" data-idx="${idx}" checked style="margin-top:4px;">
      <div>
        <div style="font-weight:600;color:var(--ink-1);">${esc(a.title)}</div>
        <div class="article-meta" style="margin-top:2px;">${esc(a.category)}${a.dek ? " · " + esc(a.dek.slice(0, 140)) + (a.dek.length > 140 ? "…" : "") : ""}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px;">
          <label style="display:grid;gap:4px;font-size:12px;color:var(--ink-2);">
            Author
            <input type="text" data-field="author" data-idx="${idx}" value="${esc(authorValue)}" placeholder="${authorIsUuid ? "UUID — enter real name" : "Author name"}"
              style="padding:6px 8px;border:1px solid ${authorIsUuid ? "var(--danger)" : "var(--hairline)"};border-radius:6px;background:var(--surface);color:var(--ink-1);font-size:13px;">
          </label>
          <label style="display:grid;gap:4px;font-size:12px;color:var(--ink-2);">
            Published
            <input type="datetime-local" data-field="date" data-idx="${idx}" value="${esc(dateValue)}"
              style="padding:6px 8px;border:1px solid var(--hairline);border-radius:6px;background:var(--surface);color:var(--ink-1);font-size:13px;">
          </label>
        </div>
        ${authorIsUuid ? `<div class="hint" style="margin-top:4px;color:var(--danger);">⚠ Wix stored a UUID for this author — enter the real name above.</div>` : ""}
      </div>`;
    list.appendChild(row);
  });
  panel.appendChild(list);

  const status = el("div", { class: "hint", style: { marginTop: "10px" } });
  panel.appendChild(status);

  panel.querySelector("#toggle-all").addEventListener("click", () => {
    const boxes = panel.querySelectorAll('input[type="checkbox"][data-idx]');
    const allOn = Array.from(boxes).every((b) => b.checked);
    boxes.forEach((b) => { b.checked = !allOn; });
  });

  panel.querySelector("#import-btn").addEventListener("click", async () => {
    // Pull edited author/date values back onto the items before importing.
    panel.querySelectorAll('input[data-field="author"]').forEach((input) => {
      const idx = parseInt(input.dataset.idx, 10);
      const val = input.value.trim();
      if (val) items[idx].authorName = val;
      else if (looksLikeUuid(items[idx].authorName)) items[idx].authorName = "";
    });
    panel.querySelectorAll('input[data-field="date"]').forEach((input) => {
      const idx = parseInt(input.dataset.idx, 10);
      const val = input.value.trim();
      if (val) {
        const d = new Date(val);
        if (Number.isFinite(d.getTime())) items[idx].publishedAt = d.toISOString();
      } else {
        items[idx].publishedAt = null;
      }
    });

    const boxes = Array.from(panel.querySelectorAll('input[type="checkbox"][data-idx]'));
    const selected = boxes.filter((b) => b.checked).map((b) => items[parseInt(b.dataset.idx, 10)]);
    if (!selected.length) { toast("Nothing selected.", "error"); return; }

    const btn = panel.querySelector("#import-btn");
    btn.disabled = true;
    btn.textContent = "Importing…";
    let created = 0, skipped = 0, failed = 0;
    const errors = [];
    for (let i = 0; i < selected.length; i++) {
      const a = selected[i];
      status.textContent = `Importing ${i + 1} / ${selected.length} — ${a.title}`;
      try {
        if (a.slug && await slugExists(a.slug)) { skipped++; continue; }
        // Firestore rules require authorId == request.auth.uid and status in
        // ['draft','pending'] for a writer/editor/admin creating a story. We
        // import as drafts owned by the admin so they can review and publish.
        // Byline comes from the CSV (admin can fix it in Edit details); the
        // original Wix publish date is used unless the admin overrides.
        const adminName = ctx.profile.name || ctx.user.email;
        const byline = a.authorName || adminName;
        await addDoc(collection(db, "stories"), {
          title: a.title,
          slug: a.slug,
          category: a.category,
          coverImage: a.coverImage,
          dek: a.dek,
          // `body` is used by the dashboard editor; `content` is what the
          // public article page reads (see firestoreDocToArticle in main.js).
          // Keep them in sync so the article renders after publish.
          body: a.body,
          content: a.body,
          authorName: byline,
          authorId: ctx.user.uid,
          authors: [{ name: byline }],
          status: "draft",
          publishedAt: a.publishedAt || null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          importedFromWix: true,
          importedById: ctx.user.uid,
          importedByName: adminName,
        });
        created++;
      } catch (err) {
        console.error("import failed:", a.title, err);
        errors.push(`${a.title}: ${err.message}`);
        failed++;
      }
    }
    btn.disabled = false;
    btn.textContent = "Import selected";
    status.innerHTML = `Done — <strong>${created}</strong> imported as drafts, ${skipped} skipped (duplicate slug), ${failed} failed.`;
    if (failed) {
      const details = el("details", { style: { marginTop: "8px" } });
      details.innerHTML = `<summary style="cursor:pointer;color:var(--danger);">Show ${failed} error${failed === 1 ? "" : "s"}</summary>
        <pre style="white-space:pre-wrap;font-size:12px;color:var(--ink-2);margin-top:6px;">${esc(errors.join("\n"))}</pre>`;
      status.appendChild(details);
    }
    if (created) toast(`Imported ${created} draft${created === 1 ? "" : "s"}. Review them under All articles.`, "success", 5000);
    else if (failed) toast(`Import failed for ${failed} article${failed === 1 ? "" : "s"}.`, "error");
  });
}

async function slugExists(slug) {
  try {
    const snap = await getDocs(query(collection(db, "stories"), where("slug", "==", slug)));
    return !snap.empty;
  } catch {
    return false;
  }
}

function toDatetimeLocal(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Sort key for stories: prefer publishedAt, then createdAt, then updatedAt.
// Any of these can be a Firestore Timestamp, an ISO string, a millisecond
// number, or missing. Returns 0 for anything unparseable so docs still sort
// rather than being dropped.
function sortKey(s) {
  return tsToMillis(s.publishedAt)
      || tsToMillis(s.createdAt)
      || tsToMillis(s.updatedAt)
      || 0;
}

function tsToMillis(v) {
  if (v == null) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : 0;
  }
  // Firestore Timestamp SDK object
  if (typeof v.toMillis === "function") {
    try { return v.toMillis(); } catch { return 0; }
  }
  // Firestore REST shape { seconds, nanoseconds } or toDate()
  if (typeof v.toDate === "function") {
    try { return v.toDate().getTime(); } catch { return 0; }
  }
  if (typeof v.seconds === "number") {
    return v.seconds * 1000 + Math.floor((v.nanoseconds || 0) / 1e6);
  }
  return 0;
}

// ---------- TXT export ----------
// Dumps every field on every story. Body is rendered both as the raw HTML
// (so the export is lossless) and as a plain-text version (so it's easy to
// paste into an LLM). New schema fields land here automatically — we iterate
// the doc's own keys instead of whitelisting.
function storiesToTxt(stories) {
  const header = [
    "Catalyst articles export",
    `Generated: ${new Date().toISOString()}`,
    `Total: ${stories.length}`,
    "",
  ].join("\n");

  // Fields that get special rendering and should be omitted from the generic
  // "all other fields" dump at the bottom of each block.
  const HANDLED = new Set([
    "id", "title", "slug", "category", "status",
    "authorName", "authorId", "author",
    "publishedAt", "createdAt", "updatedAt",
    "coverImage", "image", "lightCover",
    "dek", "excerpt",
    "body", "content",
  ]);

  const blocks = stories.map((s, i) => {
    const bodyHtml = s.body || s.content || "";
    const bodyText = htmlToPlain(bodyHtml);

    const topFields = [
      ["#", String(i + 1)],
      ["ID", s.id || ""],
      ["Title", s.title || ""],
      ["Slug", s.slug || ""],
      ["Category", s.category || ""],
      ["Status", s.status || ""],
      ["Author", s.authorName || s.author || ""],
      ["Author ID", s.authorId || ""],
      ["Published at", fmtDate(s.publishedAt)],
      ["Created at", fmtDate(s.createdAt)],
      ["Updated at", fmtDate(s.updatedAt)],
      ["URL", s.slug ? `/article/${s.slug}` : (s.id ? `/posts/${s.id}.html` : "")],
      ["Cover image", s.coverImage || s.image || ""],
      ["Light cover", s.lightCover || ""],
      ["Excerpt / Dek", s.dek || s.excerpt || ""],
    ].map(([k, v]) => `${k}: ${v}`).join("\n");

    // Dump any remaining top-level fields so nothing gets silently dropped
    // (tags, writerChecklist, sourceFile, etc.). Values stringified as JSON
    // so nested structures are still human-readable.
    const extraKeys = Object.keys(s).filter((k) => !HANDLED.has(k)).sort();
    const extras = extraKeys.length
      ? "\nOther fields:\n" + extraKeys.map((k) => `  ${k}: ${stringifyValue(s[k])}`).join("\n")
      : "";

    return [
      "=".repeat(72),
      topFields,
      extras,
      "",
      "BODY (HTML):",
      bodyHtml || "(empty)",
      "",
      "BODY (plain text):",
      bodyText || "(empty)",
      "",
    ].join("\n");
  });

  return header + "\n" + blocks.join("\n");
}

function fmtDate(v) {
  const ms = tsToMillis(v);
  if (!ms) return v ? String(v) : "";
  return new Date(ms).toISOString();
}

function stringifyValue(v) {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  // Firestore Timestamp → ISO
  const ms = tsToMillis(v);
  if (ms) return new Date(ms).toISOString();
  try { return JSON.stringify(v); } catch { return String(v); }
}

function htmlToPlain(html) {
  if (!html) return "";
  return String(html)
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|blockquote)>/gi, "\n\n")
    .replace(/<li[^>]*>/gi, " - ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function dateStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

// ---------- Welcome email sender ----------
// Lists every user, sorted by createdAt desc. Recently joined users get a
// "NEW" pill so the admin notices them. Each row has a Send button that
// fires POST /api/welcome-email; the API resolves the user (server-side),
// sends the onboarding email via Resend, and stamps welcomeEmailSentAt on
// the user doc so we can show "Sent on …" on subsequent loads.
async function loadWelcomeEmailSender(ctx, mount) {
  mount.innerHTML = `<div class="loading-state"><div class="spinner"></div>Loading users…</div>`;
  let users;
  try {
    const snap = await getDocs(query(collection(db, "users"), orderBy("createdAt", "desc")));
    users = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.error("welcome email sender: load users failed", err);
    mount.innerHTML = `<div class="error-state">Could not load users: ${esc(err.message)}</div>`;
    return;
  }
  if (!users.length) {
    mount.innerHTML = `<div class="empty-state">No users yet.</div>`;
    return;
  }

  const cutoff = Date.now() - RECENT_JOIN_DAYS * 86400000;
  const recent = users.filter((u) => parseDate(u.createdAt) >= cutoff);
  const others = users.filter((u) => parseDate(u.createdAt) < cutoff);

  mount.innerHTML = "";

  if (recent.length) {
    mount.appendChild(renderSection("Recently joined", recent, ctx, /* highlight */ true));
  }
  mount.appendChild(renderSection("All users", others.length ? others : users, ctx, false));
}

// ---------- Email guidance sender ----------
async function loadGuidanceEmailTool(ctx, mount) {
  mount.innerHTML = `<div class="loading-state"><div class="spinner"></div>Loading guidance tool…</div>`;
  try {
    const [templateRes, userSnap] = await Promise.all([
      ctx.authedFetch("/api/guidance-email"),
      getDocs(query(collection(db, "users"), orderBy("createdAt", "desc"))),
    ]);
    const templateData = await templateRes.json().catch(() => ({}));
    if (!templateRes.ok || !templateData.ok) throw new Error(templateData.error || `HTTP ${templateRes.status}`);

    const templates = templateData.templates || [];
    const users = userSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((u) => u.email)
      .sort((a, b) => (roleLabel(a.role || "").localeCompare(roleLabel(b.role || "")) || String(a.name || a.email).localeCompare(String(b.name || b.email))));

    if (!templates.length) {
      mount.innerHTML = `<div class="empty-state">No guidance templates are configured.</div>`;
      return;
    }
    if (!users.length) {
      mount.innerHTML = `<div class="empty-state">No users with email addresses found.</div>`;
      return;
    }

    mount.innerHTML = `
      <div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px;">
        <div class="field" style="margin:0;">
          <label class="label">User</label>
          <select class="select" id="guidance-user">
            ${users.map((u) => `<option value="${esc(u.id)}">${esc(u.name || u.email)} — ${esc(roleLabel(u.role || "reader"))} (${esc(u.email)})</option>`).join("")}
          </select>
        </div>
        <div class="field" style="margin:0;">
          <label class="label">Guidance template</label>
          <select class="select" id="guidance-template">
            ${templates.map((t) => `<option value="${esc(t.id)}">${esc(t.title)} — ${esc(t.audience)}</option>`).join("")}
          </select>
        </div>
      </div>
      <div id="guidance-preview" style="margin-top:12px;"></div>
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-top:12px;">
        <div class="hint" id="guidance-last-sent" style="color:#166534;"></div>
        <button class="btn btn-accent btn-sm" id="guidance-send">Send guidance email</button>
      </div>
      <div id="guidance-status" class="hint" style="margin-top:8px;color:var(--danger);"></div>
    `;

    const userSelect = mount.querySelector("#guidance-user");
    const templateSelect = mount.querySelector("#guidance-template");
    const preview = mount.querySelector("#guidance-preview");
    const lastSent = mount.querySelector("#guidance-last-sent");
    const status = mount.querySelector("#guidance-status");
    const sendBtn = mount.querySelector("#guidance-send");

    const renderPreview = () => {
      const user = users.find((u) => u.id === userSelect.value) || users[0];
      const template = templates.find((t) => t.id === templateSelect.value) || templates[0];
      const sentAt = user.lastGuidanceEmailSentAt ? new Date(parseDate(user.lastGuidanceEmailSentAt)) : null;
      const sentTemplate = user.lastGuidanceEmailTemplate
        ? templates.find((t) => t.id === user.lastGuidanceEmailTemplate)?.title || user.lastGuidanceEmailTemplate
        : null;

      preview.innerHTML = `
        <div style="border:1px solid #b7e4c7;border-radius:10px;background:#ffffff;padding:14px 16px;">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">
            <div>
              <div style="font-size:12px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;color:#166534;">Email preview</div>
              <div style="font-weight:800;color:var(--ink-1);font-size:16px;margin-top:4px;">${esc(template.subject)}</div>
            </div>
            <span style="display:inline-flex;padding:4px 9px;border-radius:999px;background:#dcfce7;color:#166534;font-size:11px;font-weight:800;">${esc(template.audience)}</span>
          </div>
          <p style="margin:10px 0 0;color:var(--ink-2);font-size:13.5px;line-height:1.55;">${esc(template.intro)}</p>
          <div style="margin-top:10px;font-size:12px;color:#166534;">
            Recipient: <strong>${esc(user.name || user.email)}</strong> · ${esc(user.email)}
          </div>
        </div>
      `;
      lastSent.textContent = sentAt
        ? `Last guidance sent: ${sentTemplate || "template"} on ${sentAt.toLocaleDateString()}`
        : "No guidance email recorded for this user yet.";
      status.textContent = "";
    };

    userSelect.addEventListener("change", renderPreview);
    templateSelect.addEventListener("change", renderPreview);
    renderPreview();

    sendBtn.addEventListener("click", async () => {
      const user = users.find((u) => u.id === userSelect.value);
      const template = templates.find((t) => t.id === templateSelect.value);
      if (!user || !template) return;
      if (!confirm(`Send "${template.title}" guidance to ${user.name || user.email}?`)) return;

      sendBtn.disabled = true;
      sendBtn.textContent = "Sending…";
      status.textContent = "";
      try {
        const res = await ctx.authedFetch("/api/guidance-email", {
          method: "POST",
          body: JSON.stringify({ uid: user.id, templateId: template.id }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
        user.lastGuidanceEmailSentAt = new Date().toISOString();
        user.lastGuidanceEmailTemplate = template.id;
        toast(`Guidance email sent to ${user.email}.`, "success");
        renderPreview();
      } catch (err) {
        console.error(err);
        status.textContent = `Send failed: ${err.message}`;
        toast("Guidance email failed.", "error");
      } finally {
        sendBtn.disabled = false;
        sendBtn.textContent = "Send guidance email";
      }
    });
  } catch (err) {
    console.error("guidance email tool failed", err);
    mount.innerHTML = `<div class="error-state">Could not load guidance email tool: ${esc(err.message)}</div>`;
  }
}

async function handleWelcomeClick(e, ctx) {
  const btn = e.target.closest("[data-welcome-send]");
  if (!btn) return;
  const uid = btn.dataset.welcomeSend;
  const email = btn.dataset.email || "";
  const name = btn.dataset.name || "";
  if (btn.dataset.sentAt && !confirm(`Welcome email was already sent to ${email}. Send it again?`)) return;

  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = "Sending…";
  try {
    const res = await ctx.authedFetch("/api/welcome-email", {
      method: "POST",
      body: JSON.stringify({ uid, email, name }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
    toast(`Welcome email sent to ${email}.`, "success");
    btn.textContent = "Resend";
    btn.dataset.sentAt = new Date().toISOString();
    const sentLabel = btn.closest("[data-welcome-row]")?.querySelector("[data-sent-label]");
    if (sentLabel) sentLabel.textContent = `Sent just now`;
  } catch (err) {
    console.error(err);
    toast(`Send failed: ${err.message}`, "error");
    btn.textContent = original;
  } finally {
    btn.disabled = false;
  }
}

function renderSection(title, users, ctx, highlight) {
  const wrap = el("div", { style: { marginBottom: "14px" } });
  wrap.innerHTML = `
    <div style="font-size:11px;font-weight:700;color:var(--muted);letter-spacing:0.08em;text-transform:uppercase;margin:8px 0 8px;">
      ${esc(title)} <span style="color:var(--ink-2);font-weight:600;">· ${users.length}</span>
    </div>`;
  const list = el("div", { style: { display: "grid", gap: "6px" } });
  users.forEach((u) => list.appendChild(renderWelcomeRow(u, ctx, highlight)));
  wrap.appendChild(list);
  return wrap;
}

function renderWelcomeRow(u, ctx, highlight) {
  const row = el("div", {
    "data-welcome-row": "1",
    style: {
      display: "grid",
      gridTemplateColumns: "1fr auto",
      gap: "12px",
      alignItems: "center",
      padding: "10px 12px",
      border: `1px solid ${highlight ? "rgba(168,132,58,0.4)" : "var(--hairline)"}`,
      background: highlight ? "rgba(251,246,236,0.5)" : "var(--surface)",
      borderRadius: "8px",
    },
  });

  const name = u.name || "(no name)";
  const email = u.email || "";
  const role = u.role || "reader";
  const joined = u.createdAt ? new Date(parseDate(u.createdAt)).toLocaleDateString() : "—";
  const sentAt = u.welcomeEmailSentAt ? new Date(parseDate(u.welcomeEmailSentAt)) : null;
  const sentLabel = sentAt ? `Sent ${sentAt.toLocaleDateString()}` : "Not sent yet";
  const newPill = highlight
    ? `<span style="display:inline-block;padding:1px 7px;border-radius:999px;background:#a8843a;color:#fff;font-size:10px;font-weight:700;letter-spacing:0.06em;margin-left:8px;">NEW</span>`
    : "";

  row.innerHTML = `
    <div style="min-width:0;">
      <div style="font-weight:600;color:var(--ink-1);font-size:14px;">
        ${esc(name)} ${newPill}
      </div>
      <div style="font-size:12px;color:var(--ink-2);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(email)}</div>
      <div style="font-size:11px;color:var(--muted);margin-top:3px;">
        ${esc(roleLabel(role))} · joined ${esc(joined)} · <span data-sent-label>${esc(sentLabel)}</span>
      </div>
    </div>
    <button class="btn ${sentAt ? "btn-secondary" : "btn-accent"} btn-sm"
            data-welcome-send="${esc(u.id)}"
            data-email="${esc(email)}"
            data-name="${esc(name)}"
            ${sentAt ? `data-sent-at="${esc(sentAt.toISOString())}"` : ""}>
      ${sentAt ? "Resend" : "Send welcome"}
    </button>`;
  return row;
}

function roleLabel(r) {
  const map = {
    admin: "Admin",
    // Editors at Catalyst are also expected to write — surface that here so
    // the welcome email list reads consistently with the welcome email body.
    editor: "Editor / Writer",
    writer: "Writer",
    newsletter_builder: "Newsletter builder",
    marketing: "Marketing",
    reader: "Reader",
  };
  return map[r] || r;
}

function parseDate(v) {
  if (!v) return 0;
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : 0;
  }
  if (typeof v.toMillis === "function") { try { return v.toMillis(); } catch { return 0; } }
  if (typeof v.seconds === "number") return v.seconds * 1000;
  return 0;
}
