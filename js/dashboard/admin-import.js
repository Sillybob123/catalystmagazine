// Admin → Advanced tools
// Imports a Wix "Posts.csv" export as published stories. Admin-only.
//
// The Wix CSV contains quoted, multi-line fields with escaped double quotes.
// We parse it with a state machine (no external deps) and map the columns we
// care about into Catalyst's `stories` schema.

import { db } from "../firebase-config.js";
import {
  collection, addDoc, query, where, getDocs,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { el, esc, toast, slugify } from "./ui.js";

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
    <div class="card-body">
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
    </div>`;
  container.appendChild(card);

  const fileInput = card.querySelector("#csv-file");
  const panel = card.querySelector("#import-panel");

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

// Wix "Plain Content" is a single string with paragraphs separated by
// double-newlines or runs of whitespace. Split into reasonable <p> blocks.
function plainToHtml(raw) {
  if (!raw) return "";
  const cleaned = String(raw).replace(/\r\n/g, "\n").trim();
  if (!cleaned) return "";
  // Prefer double-newline splits; if there are none, fall back to sentence-group
  // heuristics so the body isn't one giant <p>.
  let chunks = cleaned.split(/\n{2,}/);
  if (chunks.length === 1) {
    // Split on single newlines if present.
    chunks = cleaned.split(/\n+/);
  }
  if (chunks.length === 1) {
    // No newlines at all — break every ~4 sentences to keep paragraphs readable.
    const sentences = cleaned.match(/[^.!?]+[.!?]+[\s"'”’)]*|\S+$/g) || [cleaned];
    chunks = [];
    for (let i = 0; i < sentences.length; i += 4) {
      chunks.push(sentences.slice(i, i + 4).join(" ").trim());
    }
  }
  return chunks
    .map((c) => c.trim())
    .filter(Boolean)
    .map((c) => `<p>${escapeHtml(c)}</p>`)
    .join("\n");
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
  const allowed = ["Feature", "Interview", "Op-Ed", "News", "Science"];
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
    const row = el("label", {
      style: {
        display: "grid",
        gridTemplateColumns: "28px 1fr",
        gap: "10px",
        alignItems: "start",
        padding: "10px 12px",
        border: "1px solid var(--hairline)",
        borderRadius: "8px",
        background: "var(--surface)",
        cursor: "pointer",
      },
    });
    row.innerHTML = `
      <input type="checkbox" data-idx="${idx}" checked style="margin-top:4px;">
      <div>
        <div style="font-weight:600;color:var(--ink-1);">${esc(a.title)}</div>
        <div class="article-meta" style="margin-top:2px;">
          ${a.authorName
            ? (looksLikeUuid(a.authorName)
              ? `<span style="color:var(--danger);">⚠ ${esc(a.authorName)} (UUID — edit byline before publishing)</span>`
              : esc(a.authorName))
            : "Unknown author"} · ${esc(a.category)}
          ${a.publishedAt ? `· ${esc(new Date(a.publishedAt).toLocaleDateString())}` : ""}
        </div>
        ${a.dek ? `<div class="hint" style="margin-top:4px;">${esc(a.dek.slice(0, 180))}${a.dek.length > 180 ? "…" : ""}</div>` : ""}
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
