// Games tab — admin-only.
// Lets an admin attach a knowledge game to any published story. Two
// variants are available:
//   - "doodle": a Catalyst Doodle Jump climb with a single gold question
//               platform and rescue-on-death prompts.
//   - "flappy": a Flappy Catalyst run with a gold question pipe and
//               rescue-on-crash prompts.
// Both variants share the same 3-question payload format, so a writer can
// switch between them without re-entering questions.
//
// Flow:
//   1. Pick a published article from the list.
//   2. Pick the game type (doodle or flappy).
//   3. Click "Copy AI prompt" — the prompt is preloaded with the article body
//      and asks for a JSON payload of 3 questions.
//   4. Paste the AI's JSON into the textarea.
//   5. Validate (3 questions × 4 options × 1 correct).
//   6. Save to stories/{id}.game (with kind) — the article page picks it up
//      automatically.

import { db } from "../firebase-config.js";
import {
  collection, getDocs, doc, getDoc, updateDoc, query, where, orderBy, deleteField,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { el, esc, toast, openModal, confirmDialog, fmtDate } from "./ui.js";

export async function mount(ctx, container) {
  if (ctx.role !== "admin") {
    container.innerHTML = `<div class="empty-state">Admins only.</div>`;
    return;
  }

  container.innerHTML = "";
  const card = el("div", { class: "card" });
  card.innerHTML = `
    <div class="card-header">
      <div>
        <div class="card-title">Article games</div>
        <div class="card-subtitle">Attach a Doodle Jump or Flappy Catalyst knowledge game to any published article. Readers see it pinned to the bottom of the story.</div>
      </div>
      <div style="display:flex;gap:8px;align-items:center;">
        <input class="input" id="games-search" type="search" placeholder="Search articles…" style="min-width:220px;padding:8px 10px;border:1px solid var(--hairline);border-radius:6px;">
        <select class="select" id="games-filter" style="min-width:160px;">
          <option value="all">All articles</option>
          <option value="with">With game</option>
          <option value="without">Without game</option>
        </select>
      </div>
    </div>
    <div class="card-body card-body--flush" id="games-body">
      <div class="loading-state"><div class="spinner"></div>Loading published articles…</div>
    </div>`;
  container.appendChild(card);

  const body = card.querySelector("#games-body");
  const searchEl = card.querySelector("#games-search");
  const filterEl = card.querySelector("#games-filter");

  let allRows = [];

  async function load() {
    body.innerHTML = `<div class="loading-state"><div class="spinner"></div>Loading published articles…</div>`;
    try {
      const snap = await getDocs(query(
        collection(db, "stories"),
        where("status", "==", "published"),
        orderBy("publishedAt", "desc")
      ));
      allRows = [];
      snap.forEach((d) => allRows.push({ id: d.id, ...d.data() }));
      paint();
    } catch (err) {
      console.error("[games] load failed", err);
      body.innerHTML = `<div class="error-state">${esc(err.message || "Could not load articles.")}</div>`;
    }
  }

  function paint() {
    const q = searchEl.value.trim().toLowerCase();
    const filter = filterEl.value;
    const rows = allRows.filter((r) => {
      const hasGame = !!(r.game && Array.isArray(r.game.questions) && r.game.questions.length);
      if (filter === "with" && !hasGame) return false;
      if (filter === "without" && hasGame) return false;
      if (!q) return true;
      const hay = [r.title, r.authorName, r.author, r.dek, r.deck].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(q);
    });

    if (!rows.length) {
      body.innerHTML = `<div class="empty-state">No articles match your filters.</div>`;
      return;
    }

    body.innerHTML = "";
    const list = el("div", { class: "articles-list" });
    rows.forEach((r) => list.appendChild(renderRow(r, ctx, load)));
    body.appendChild(list);
  }

  searchEl.addEventListener("input", () => paint());
  filterEl.addEventListener("change", paint);
  load();
}

function renderRow(article, ctx, reload) {
  const hasGame = !!(article.game && Array.isArray(article.game.questions) && article.game.questions.length);
  const qCount = hasGame ? article.game.questions.length : 0;
  const gameKind = hasGame ? (article.game.kind || "doodle") : "";
  const gameKindLabel = gameKind === "flappy" ? "Flappy" : "Doodle Jump";
  const cover = article.coverImage || article.image || "/NewLogoShape.png";
  const date = article.publishedAt
    ? fmtDate(article.publishedAt.toDate ? article.publishedAt.toDate() : article.publishedAt)
    : "—";
  const title = article.title || "(untitled)";
  const author = article.authorName || article.author || "The Catalyst";

  const row = el("div", { class: "ar-row" });
  row.innerHTML = `
    <div class="ar-row-media">
      <img src="${esc(cover)}" alt="" style="width:64px;height:64px;border-radius:10px;object-fit:cover;border:1px solid var(--hairline);">
    </div>
    <div class="ar-row-meta" style="min-width:0;flex:1;">
      <div class="ar-row-title" style="font-weight:600;color:var(--ink-2);font-size:15px;line-height:1.3;">${esc(title)}</div>
      <div class="ar-row-sub" style="color:var(--muted);font-size:13px;margin-top:2px;">
        ${esc(author)} &middot; ${esc(date)}
      </div>
      <div style="margin-top:6px;">
        ${hasGame
          ? `<span class="pill pill-published" style="background:#dcfce7;color:#166534;">${esc(gameKindLabel)} · ${qCount} question${qCount === 1 ? "" : "s"}</span>`
          : `<span class="pill pill-draft" style="background:var(--hairline-soft, #eef0f4);color:var(--muted);">No game yet</span>`}
      </div>
    </div>
    <div class="ar-row-actions" style="display:flex;gap:8px;align-items:center;flex-shrink:0;"></div>
  `;
  const actions = row.querySelector(".ar-row-actions");

  const btnEdit = el("button", { class: "btn btn-primary btn-sm", type: "button" },
    hasGame ? "Edit game" : "Add game");
  btnEdit.addEventListener("click", () => openGameDialog(article, ctx, reload));
  actions.appendChild(btnEdit);

  if (hasGame) {
    const btnPreview = el("a", {
      class: "btn btn-ghost btn-sm",
      href: `/article.html?id=${encodeURIComponent(article.id)}#article-doodle`,
      target: "_blank",
      rel: "noopener",
    }, "Preview");
    actions.appendChild(btnPreview);

    const btnRemove = el("button", { class: "btn btn-ghost btn-sm", type: "button", style: { color: "var(--danger)" } }, "Remove");
    btnRemove.addEventListener("click", async () => {
      const ok = await confirmDialog(`Remove the knowledge game from “${title}”? Readers will no longer see the game at the bottom of the article.`, {
        confirmText: "Remove game",
        danger: true,
      });
      if (!ok) return;
      try {
        await updateDoc(doc(db, "stories", article.id), { game: deleteField() });
        toast("Game removed.", "success");
        reload();
      } catch (err) {
        console.error("[games] remove failed", err);
        toast("Could not remove the game: " + (err.message || err), "error");
      }
    });
    actions.appendChild(btnRemove);
  }

  return row;
}

// ---------------------------------------------------------------------------
// Dialog: pick / paste / save
// ---------------------------------------------------------------------------

const AI_PROMPT_TEMPLATE = `You are writing 10 multiple-choice questions for a knowledge game pinned to the bottom of an article on The Catalyst Magazine, a student-run STEM publication.

Goals:
- Test whether the reader actually read and understood the article.
- Each question is fair, factual, and resolvable from the article body alone.
- Questions vary in difficulty — some easy (key facts), some interpretive, some nuanced.
- Cover different parts and ideas in the article so no two questions feel repetitive.
- Avoid trick questions, ambiguous phrasings, or "all of the above"-style options.
- Each question has exactly 4 short options (under ~12 words each). One is correct, three are plausible distractors drawn from the article's themes.
- Tone: confident, lightly playful, no slang.

The game randomly picks 3 of these 10 questions per play session, so each replay feels fresh. Write all 10 at different difficulty levels and covering different aspects of the article.

Output ONLY a single JSON object, no prose, in EXACTLY this shape:

{
  "title": "<short, fun game title — 6 words max>",
  "intro": "<one-line tagline shown above the game — 14 words max>",
  "questions": [
    {
      "prompt": "<question text>",
      "options": ["<A>", "<B>", "<C>", "<D>"],
      "correct": <0|1|2|3>,
      "feedbackCorrect": "<short congrats line — 12 words max>",
      "feedbackIncorrect": "<short hint at the right answer — 14 words max>"
    },
    { ... },
    ... (10 questions total)
  ]
}

ARTICLE METADATA:
Title: __TITLE__
Author: __AUTHOR__

ARTICLE BODY:
"""
__BODY__
"""`;

async function openGameDialog(article, ctx, reload) {
  // Pull the freshest version of the doc (in case body / game just changed).
  let full = article;
  try {
    const snap = await getDoc(doc(db, "stories", article.id));
    if (snap.exists()) full = { id: snap.id, ...snap.data() };
  } catch {}

  const existingGame = full.game && Array.isArray(full.game.questions) ? full.game : null;

  const form = el("form", { id: "game-form", style: "display:grid;gap:14px;" });
  form.innerHTML = `
    <div style="display:flex;gap:12px;align-items:flex-start;border:1px solid var(--hairline);border-radius:10px;padding:12px;background:var(--paper,#fbfaf3);">
      <img src="${esc(full.coverImage || full.image || "/NewLogoShape.png")}" alt=""
           style="width:56px;height:56px;border-radius:8px;object-fit:cover;flex-shrink:0;">
      <div style="min-width:0;flex:1;">
        <div style="font-weight:700;font-size:14px;color:var(--ink-2);line-height:1.3;">${esc(full.title || "")}</div>
        <div style="color:var(--muted);font-size:12px;margin-top:2px;">${esc(full.authorName || full.author || "")}</div>
      </div>
      <a href="/article.html?id=${encodeURIComponent(full.id)}" target="_blank" rel="noopener"
         class="btn btn-ghost btn-xs">Open</a>
    </div>

    <div style="display:grid;gap:6px;">
      <label class="label" style="margin:0;font-weight:600;font-size:13px;">Game type</label>
      <div id="kind-picker" role="radiogroup" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        <label class="kind-opt" data-kind="doodle" style="display:flex;gap:10px;align-items:flex-start;border:1.5px solid var(--hairline);border-radius:10px;padding:10px 12px;cursor:pointer;transition:all .14s ease;">
          <input type="radio" name="game-kind" value="doodle" style="margin-top:3px;flex-shrink:0;">
          <span style="display:grid;gap:2px;">
            <span style="font-weight:700;font-size:13px;color:var(--ink-2);">Doodle Jump</span>
            <span style="font-size:11.5px;color:var(--muted);line-height:1.35;">Bounce upward, gold platforms ask questions, rescue prompt on death.</span>
          </span>
        </label>
        <label class="kind-opt" data-kind="flappy" style="display:flex;gap:10px;align-items:flex-start;border:1.5px solid var(--hairline);border-radius:10px;padding:10px 12px;cursor:pointer;transition:all .14s ease;">
          <input type="radio" name="game-kind" value="flappy" style="margin-top:3px;flex-shrink:0;">
          <span style="display:grid;gap:2px;">
            <span style="font-weight:700;font-size:13px;color:var(--ink-2);">Flappy Catalyst</span>
            <span style="font-size:11.5px;color:var(--muted);line-height:1.35;">Flap through pipes, gold pipe asks a question, rescue prompt on crash.</span>
          </span>
        </label>
      </div>
      <div id="kind-note" style="font-size:12px;color:var(--muted);min-height:16px;line-height:1.4;"></div>
    </div>

    <div style="display:grid;gap:6px;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
        <label class="label" style="margin:0;font-weight:600;font-size:13px;">Step 1 &middot; Generate questions with AI</label>
        <button type="button" class="btn btn-secondary btn-sm" id="copy-prompt">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
          </svg>
          Copy AI prompt
        </button>
      </div>
      <div style="font-size:12px;color:var(--muted);line-height:1.5;">
        Paste this into ChatGPT, Claude, or your AI of choice. It includes the article body and asks for the exact JSON shape this dialog expects.
      </div>
    </div>

    <div style="display:grid;gap:6px;">
      <label class="label" for="ai-output" style="margin:0;font-weight:600;font-size:13px;">Step 2 &middot; Paste the AI's JSON</label>
      <textarea id="ai-output" rows="10"
                placeholder='{ "title": "...", "intro": "...", "questions": [ { "prompt": "...", "options": ["A","B","C","D"], "correct": 0 }, ... ] }'
                style="width:100%;padding:10px 12px;border:1px solid var(--hairline);border-radius:8px;font-family:ui-monospace,Menlo,Monaco,Consolas,monospace;font-size:12px;line-height:1.5;resize:vertical;min-height:160px;"></textarea>
      <div id="ai-msg" style="font-size:12px;min-height:16px;line-height:1.4;"></div>
    </div>

    <div id="preview-block" hidden style="display:grid;gap:10px;border:1px solid var(--hairline);border-radius:10px;padding:14px;background:#fff;">
      <div style="font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);">Preview</div>
      <div id="preview-title" style="font-weight:700;font-size:15px;color:var(--ink-2);"></div>
      <div id="preview-intro" style="font-size:13px;color:var(--muted);"></div>
      <ol id="preview-questions" style="margin:0;padding-left:20px;display:grid;gap:10px;"></ol>
    </div>
  `;

  const cancelBtn = el("button", { type: "button", class: "btn btn-secondary" }, "Cancel");
  const saveBtn = el("button", { type: "submit", class: "btn btn-accent", form: "game-form" },
    existingGame ? "Save changes" : "Save game");

  const modal = openModal({
    title: existingGame ? "Edit knowledge game" : "Add knowledge game",
    body: form,
    footer: [cancelBtn, saveBtn],
  });
  if (!modal) return;

  // Make the modal a bit roomier for editing JSON.
  modal.modal.style.maxWidth = "720px";
  modal.modal.style.width = "min(720px, calc(100vw - 32px))";

  cancelBtn.addEventListener("click", () => modal.close());

  // Game-kind picker. Default to the existing game's kind (or "doodle" for
  // games saved before the picker existed). Visual highlight on the
  // selected option for clarity. Switching the radio reuses the existing
  // questions, so an admin can flip a game from doodle to flappy (or vice
  // versa) without re-pasting the JSON — the kind change is persisted on
  // Save and applied to the article on the next reader load.
  const originalKind = (existingGame && existingGame.kind) === "flappy" ? "flappy" : (existingGame ? "doodle" : null);
  const initialKind = originalKind || "doodle";
  const kindNoteEl = form.querySelector("#kind-note");
  const kindRadios = form.querySelectorAll('input[name="game-kind"]');
  kindRadios.forEach((r) => {
    if (r.value === initialKind) r.checked = true;
    r.addEventListener("change", () => { paintKindHighlight(); paintKindNote(); });
  });
  function paintKindHighlight() {
    form.querySelectorAll(".kind-opt").forEach((opt) => {
      const input = opt.querySelector('input[name="game-kind"]');
      if (input && input.checked) {
        opt.style.borderColor = "var(--accent, #f4a72b)";
        opt.style.background = "rgba(244, 167, 43, 0.08)";
      } else {
        opt.style.borderColor = "var(--hairline)";
        opt.style.background = "";
      }
    });
  }
  function paintKindNote() {
    if (!kindNoteEl || !originalKind) { if (kindNoteEl) kindNoteEl.textContent = ""; return; }
    const checked = form.querySelector('input[name="game-kind"]:checked');
    const sel = checked ? checked.value : originalKind;
    if (sel !== originalKind) {
      const fromLabel = originalKind === "flappy" ? "Flappy Catalyst" : "Doodle Jump";
      const toLabel = sel === "flappy" ? "Flappy Catalyst" : "Doodle Jump";
      kindNoteEl.textContent = `Save will switch this article from ${fromLabel} to ${toLabel} — same questions, new game.`;
      kindNoteEl.style.color = "var(--accent-deep, #d6881d)";
    } else {
      kindNoteEl.textContent = "";
      kindNoteEl.style.color = "";
    }
  }
  // Allow clicking anywhere on the .kind-opt to select.
  form.querySelectorAll(".kind-opt").forEach((opt) => {
    opt.addEventListener("click", (e) => {
      if (e.target.tagName !== "INPUT") {
        const input = opt.querySelector('input[name="game-kind"]');
        if (input) { input.checked = true; paintKindHighlight(); paintKindNote(); }
      }
    });
  });
  paintKindHighlight();
  paintKindNote();

  // Pre-fill the textarea if we already have a game.
  const aiOutEl = form.querySelector("#ai-output");
  if (existingGame) {
    const seed = {
      title: existingGame.title || "",
      intro: existingGame.intro || "",
      questions: existingGame.questions.map((q) => ({
        prompt: q.prompt,
        options: q.options,
        correct: q.correct,
        feedbackCorrect: q.feedbackCorrect || "",
        feedbackIncorrect: q.feedbackIncorrect || "",
      })),
    };
    aiOutEl.value = JSON.stringify(seed, null, 2);
  }

  // Live-preview as the admin pastes.
  const msgEl = form.querySelector("#ai-msg");
  const previewBlock = form.querySelector("#preview-block");
  const previewTitle = form.querySelector("#preview-title");
  const previewIntro = form.querySelector("#preview-intro");
  const previewQs = form.querySelector("#preview-questions");

  function showError(text) {
    msgEl.textContent = text;
    msgEl.style.color = "var(--danger)";
    previewBlock.hidden = true;
    saveBtn.disabled = true;
  }
  function showOk(parsed) {
    msgEl.textContent = `Looks good — ${parsed.questions.length} question${parsed.questions.length === 1 ? "" : "s"} ready.`;
    msgEl.style.color = "var(--good, #166534)";
    previewBlock.hidden = false;
    previewTitle.textContent = parsed.title;
    previewIntro.textContent = parsed.intro;
    previewQs.innerHTML = parsed.questions.map((q, i) => {
      const opts = q.options.map((o, oi) => {
        const correct = oi === q.correct;
        return `<li style="${correct ? "color:#166534;font-weight:600;" : "color:var(--ink-2);"}">${esc(o)}${correct ? " ✓" : ""}</li>`;
      }).join("");
      return `
        <li style="font-size:13px;line-height:1.45;">
          <div style="font-weight:600;color:var(--ink-2);margin-bottom:4px;">${esc(q.prompt)}</div>
          <ol type="A" style="margin:0;padding-left:18px;">${opts}</ol>
        </li>
      `;
    }).join("");
    saveBtn.disabled = false;
  }

  function revalidate() {
    const raw = aiOutEl.value.trim();
    if (!raw) {
      msgEl.textContent = "";
      previewBlock.hidden = true;
      saveBtn.disabled = true;
      return;
    }
    let parsed;
    try {
      parsed = parseGameJson(raw);
    } catch (err) {
      showError(err.message);
      return;
    }
    showOk(parsed);
  }

  aiOutEl.addEventListener("input", revalidate);
  revalidate();

  // Copy AI prompt with the article body inlined.
  form.querySelector("#copy-prompt").addEventListener("click", async () => {
    const body = extractArticleBody(full);
    if (!body || body.length < 80) {
      toast("Couldn't find a usable article body to send to the AI. Open the article and verify it has content.", "error");
      return;
    }
    const prompt = AI_PROMPT_TEMPLATE
      .replace("__TITLE__", full.title || "(untitled)")
      .replace("__AUTHOR__", full.authorName || full.author || "The Catalyst")
      .replace("__BODY__", body);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(prompt);
      } else {
        const ta = document.createElement("textarea");
        ta.value = prompt;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
      }
      toast("Prompt copied — paste it into your AI.", "success");
    } catch (err) {
      console.error("[games] copy prompt failed", err);
      toast("Could not copy. Long-press to copy manually.", "error");
    }
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const raw = aiOutEl.value.trim();
    let parsed;
    try {
      parsed = parseGameJson(raw);
    } catch (err) {
      showError(err.message);
      return;
    }
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving…";
    try {
      const selectedKindEl = form.querySelector('input[name="game-kind"]:checked');
      const selectedKind = selectedKindEl && selectedKindEl.value === "flappy" ? "flappy" : "doodle";
      await updateDoc(doc(db, "stories", full.id), {
        game: {
          kind: selectedKind,
          title: parsed.title,
          intro: parsed.intro,
          questions: parsed.questions.map((q) => ({
            prompt: q.prompt,
            options: q.options,
            correct: q.correct,
            feedbackCorrect: q.feedbackCorrect || "",
            feedbackIncorrect: q.feedbackIncorrect || "",
          })),
          updatedAt: new Date().toISOString(),
        },
      });
      toast(existingGame ? "Game updated." : "Game added to the article.", "success");
      modal.close();
      reload();
    } catch (err) {
      console.error("[games] save failed", err);
      msgEl.textContent = "Save failed: " + (err.message || err);
      msgEl.style.color = "var(--danger)";
      saveBtn.disabled = false;
      saveBtn.textContent = existingGame ? "Save changes" : "Save game";
    }
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Strict-but-friendly parser for the AI's JSON. Returns { title, intro, questions }
// or throws an Error with a human-readable message.
function parseGameJson(raw) {
  // Strip code fences the AI loves to add (```json ... ```).
  let s = raw.trim();
  if (s.startsWith("```")) {
    s = s.replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
  }
  let data;
  try {
    data = JSON.parse(s);
  } catch (err) {
    throw new Error("That doesn't look like valid JSON. Check for missing quotes or commas.");
  }
  if (!data || typeof data !== "object") throw new Error("Expected a JSON object at the top level.");
  if (!Array.isArray(data.questions)) throw new Error("Missing a 'questions' array.");
  if (data.questions.length < 3 || data.questions.length > 10) {
    throw new Error(`Expected 3–10 questions, got ${data.questions.length}.`);
  }
  const out = {
    title: typeof data.title === "string" && data.title.trim() ? data.title.trim().slice(0, 80) : "Test your knowledge",
    intro: typeof data.intro === "string" && data.intro.trim() ? data.intro.trim().slice(0, 160) : "Climb high — answer correctly to earn power-ups.",
    questions: [],
  };
  data.questions.forEach((q, i) => {
    if (!q || typeof q !== "object") throw new Error(`Question ${i + 1}: not an object.`);
    if (typeof q.prompt !== "string" || !q.prompt.trim()) throw new Error(`Question ${i + 1}: missing 'prompt'.`);
    if (!Array.isArray(q.options) || q.options.length !== 4) {
      throw new Error(`Question ${i + 1}: needs exactly 4 options, got ${Array.isArray(q.options) ? q.options.length : "none"}.`);
    }
    const opts = q.options.map((o, oi) => {
      if (typeof o !== "string" || !o.trim()) throw new Error(`Question ${i + 1}, option ${oi + 1}: must be a non-empty string.`);
      return o.trim().slice(0, 200);
    });
    const correct = Number(q.correct);
    if (!Number.isInteger(correct) || correct < 0 || correct > 3) {
      throw new Error(`Question ${i + 1}: 'correct' must be 0, 1, 2, or 3 (got ${q.correct}).`);
    }
    out.questions.push({
      prompt: q.prompt.trim().slice(0, 280),
      options: opts,
      correct,
      feedbackCorrect: typeof q.feedbackCorrect === "string" ? q.feedbackCorrect.trim().slice(0, 160) : "",
      feedbackIncorrect: typeof q.feedbackIncorrect === "string" ? q.feedbackIncorrect.trim().slice(0, 160) : "",
    });
  });
  return out;
}

// Best-effort plaintext of the article body, suitable for sending to an AI.
// Pulls from common fields produced by the writer's editor.
function extractArticleBody(article) {
  const parts = [];
  if (article.dek) parts.push(String(article.dek));
  if (article.deck) parts.push(String(article.deck));
  if (Array.isArray(article.blocks) && article.blocks.length) {
    article.blocks.forEach((b) => {
      const t = String(b?.type || "").toLowerCase();
      if (t.includes("paragraph") && b.content) parts.push(String(b.content));
      else if (t.includes("heading") && b.content) parts.push(String(b.content));
      else if (t.includes("quote") && b.content) parts.push("“" + String(b.content) + "”");
      else if (t.includes("list") && Array.isArray(b.items)) parts.push(b.items.join(" · "));
    });
  }
  if (typeof article.body === "string" && article.body.trim()) parts.push(stripHtml(article.body));
  if (typeof article.content === "string" && article.content.trim()) parts.push(stripHtml(article.content));
  // Dedupe & trim — Firestore body and content are sometimes the same string.
  const seen = new Set();
  const cleaned = parts
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => {
      if (!s || seen.has(s)) return false;
      seen.add(s);
      return true;
    })
    .join("\n\n");
  // Keep the prompt within reasonable AI input bounds.
  return cleaned.slice(0, 12000);
}

function stripHtml(html) {
  const div = document.createElement("div");
  div.innerHTML = String(html);
  // Replace block tags with newlines first so paragraphs read naturally.
  div.querySelectorAll("br").forEach((n) => n.replaceWith("\n"));
  div.querySelectorAll("p, li, h1, h2, h3, h4, h5, h6, blockquote").forEach((n) => {
    n.append("\n\n");
  });
  return (div.textContent || "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
}
