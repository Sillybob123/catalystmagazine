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
      const snap = await getDocs(query(collection(db, "stories"), orderBy("updatedAt", "desc")));
      const stories = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
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

// ---------- TXT export ----------
function storiesToTxt(stories) {
  const header = [
    "Catalyst articles export",
    `Generated: ${new Date().toISOString()}`,
    `Total: ${stories.length}`,
    "",
  ].join("\n");

  const blocks = stories.map((s, i) => {
    const body = htmlToPlain(s.content || s.body || "");
    const fields = [
      ["#", String(i + 1)],
      ["ID", s.id || ""],
      ["Title", s.title || ""],
      ["Slug", s.slug || ""],
      ["Category", s.category || ""],
      ["Status", s.status || ""],
      ["Author", s.authorName || ""],
      ["Author ID", s.authorId || ""],
      ["Published at", s.publishedAt || ""],
      ["Created at", s.createdAt || ""],
      ["Updated at", s.updatedAt || ""],
      ["URL", s.slug ? `/posts/${s.id}.html` : ""],
      ["Cover image", s.coverImage || s.image || ""],
      ["Excerpt", s.dek || s.excerpt || ""],
    ].map(([k, v]) => `${k}: ${v}`).join("\n");
    return `${"=".repeat(72)}\n${fields}\n\nBODY:\n${body}\n`;
  });

  return header + "\n" + blocks.join("\n");
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
