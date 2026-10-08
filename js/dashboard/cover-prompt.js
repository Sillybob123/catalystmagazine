// Admin → Advanced tools → Cover art prompt
// Builds a detailed prompt for an image AI (ChatGPT, Gemini, Higgsfield…)
// that turns an article or a concept into a cover in the house watercolour
// style. Pairs with a style reference sheet the admin attaches to the chat:
// /beta/cover-style/catalyst-watercolor-style-sheet.jpg (12 of our own
// illustrations). Nothing here writes to the database.

import { db } from "../firebase-config.js";
import { collection, getDocs, query, where } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { esc, toast } from "./ui.js";

const SHEET = "/beta/cover-style/catalyst-watercolor-style-sheet.jpg?v=2";
const SHEET_PREVIEW = "/beta/cover-style/catalyst-watercolor-style-sheet-1600.webp?v=2";

const SIZES = {
  cover:    { label: "Article cover", ratio: "16:9", px: "1920 × 1080", note: "The site shows covers wide and may trim the edges, so keep the subject and anything important away from the outer 8 percent of the frame." },
  square:   { label: "Instagram post", ratio: "1:1", px: "1080 × 1080", note: "" },
  portrait: { label: "Portrait", ratio: "4:5", px: "1080 × 1350", note: "" },
  story:    { label: "Story", ratio: "9:16", px: "1080 × 1920", note: "Instagram covers the top and bottom 12 percent of a story with buttons, so keep the subject in the middle band." },
};
const SPACE = {
  none: "Full bleed: the painting fills the entire frame and runs right off all four edges, like a crop from a larger painting. No white or paper-coloured margin anywhere around it.",
  top: "Leave the top 40 percent of the image as completely blank warm paper, with no drawing, no wash and no texture changes, so a headline can be set there later. Everything is drawn in the lower 60 percent and runs off the left, right and bottom edges of the image; only its top edge fades softly into the blank paper.",
  left: "Leave the left 45 percent of the image as completely blank warm paper so text can be set there later. Place the subject in the right half; it runs off the top, right and bottom edges of the image and only fades softly into the paper on its left side.",
};

function buildPrompt({ size, space, title, text, kind }) {
  const S = SIZES[size] || SIZES.cover;
  const source = kind === "concept" ? "concept" : "article";
  const body = (text || "").trim();
  return `You are the staff illustrator for The Catalyst, a student-run science magazine based in Washington, D.C. Our covers look like they were painted by hand in a real sketchbook: delicate watercolour and fine ink on warm cotton paper. Readers should never suspect a computer made them.

Read the ${source} at the bottom of this message and make ONE cover illustration for it.

FORMAT
- Aspect ratio ${S.ratio} (${S.px} pixels), for: ${S.label}.
- ${SPACE[space] || SPACE.none}${S.note ? `\n- ${S.note}` : ""}
- I have attached a style reference sheet with 12 of our past illustrations laid out in a grid. Match their medium, palette, line quality, paper and level of detail exactly. Do NOT copy their subjects, and do NOT copy the sheet's layout: the gaps, margins and background around the tiles are only there to separate the examples. Your image is ONE illustration, not a grid, a card or a collage.
- NO BORDERS: the illustration must reach the very edge of the image on every side. Never add a white, cream or paper-coloured border, margin, mat, frame, deckled edge, drop shadow, or a "painting lying on a table" look. Don't show the edges of the paper. If you're unsure, crop in tighter.

STEP 1: FIND THE IDEA (think before you draw)
1. In one sentence, say what this ${source} is really about.
2. Come up with three different visual ideas for it. Each one must be a concrete, physical scene or object that a person could actually set up and paint from life: a particular animal in its habitat, a lab bench with the real equipment, a place in D.C., a hand holding a specific object, a cross-section of something real. Prefer something specific and surprising from the ${source} over the obvious.
3. Reject clichés: glowing brains, light bulbs for ideas, puzzle pieces, handshakes, circuit-board patterns, DNA made of light, floating icons, magnifying glasses over nothing, a lone person staring at a galaxy.
4. Pick the strongest idea and tell me which one in a single line. Then draw it.

STEP 2: THE HOUSE STYLE (follow it exactly)
- Medium: traditional transparent watercolour with fine sepia and soft charcoal ink linework over a light pencil underdrawing, on warm off-white cold-press cotton paper (like Arches 300 gsm). It should look like a high-resolution scan cropped from inside a real painting, so no page edges ever show. Bare paper is about #F4EFE3.
- Linework: thin, slightly wavering, confident ink lines with varied weight. Lines don't always close. Light hatching in shadows. A few faint pencil construction lines still visible.
- Paint: soft layered washes with visible pigment granulation, gentle blooms and backruns, wet-into-wet bleeds at the edges of shapes, and small areas of untouched white paper for highlights. Colour sits slightly inside or outside the ink lines in places, the way real watercolour does.
- Palette: muted and natural. Sage green, ochre, terracotta and dusty rose, slate blue, warm grey, soft charcoal. At most one gentle accent colour. Never neon, never fully saturated, never digital-looking gradients.
- Light: soft daylight from one side, calm and quiet. No dramatic rim lighting.
- Mood: curious, warm, intelligent, with a light touch of wit. Think natural-history plate meets a New Yorker or Kinfolk editorial illustration.
- Composition: one clear focal subject, plus one or two supporting details at most, three to six elements in total. Generous bare paper around it. A clear silhouette that still reads at thumbnail size. The subject is slightly off-centre. Nothing crammed into the corners.
- Accuracy: this is a science magazine. Animals, plants, anatomy, lab equipment, instruments, molecules and landmarks must be drawn correctly (the right number of legs, real microscope parts, the real shape of the building). If you aren't sure what something looks like, choose a simpler subject you can draw accurately.
- People (only if the idea needs them): natural proportions, simple gentle faces in three-quarter view or from behind, relaxed hands with five fingers, modern everyday clothes, a natural mix of ages and backgrounds. Never a real, identifiable person unless I ask for one.

STEP 3: MAKE IT LOOK HUMAN-MADE, NOT AI-MADE
Avoid all of these: glossy or airbrushed shading, plastic-smooth skin, perfect symmetry, glowing auras, lens flare, bokeh, photographic realism, a 3D-render look, flat vector shapes, thick colouring-book outlines, over-saturated sunsets, sparkles or particles floating everywhere, sci-fi neon, holograms, and the "too clean" look where every surface is evenly detailed.
Include small human imperfections: a few pigment speckles, slightly uneven wash edges, paper texture visible across the whole image, faint pencil marks, and details that are suggested with a few strokes instead of fully rendered. Vary the finish: some areas detailed, others left loose.
Absolutely no text of any kind: no letters, words, numbers, labels, captions, logos, signatures or watermarks. And again: no border, margin, frame or visible paper edge around the image.

STEP 4: OUTPUT
- If you can make images: make the illustration now at ${S.ratio}. Then give me the one-line idea you chose.
- If you can't make images: write the final image prompt as one paragraph of 120 to 180 words that I can paste into an image generator. Start it with "Delicate watercolour and fine ink illustration on warm off-white cotton paper," describe the scene, the palette and the composition, include the format and full-bleed instructions above, and end with "Full bleed to every edge. No border, no margin, no frame, no text, no letters, no numbers, no watermark."
- Before you send it, check the edges: if there is any white or cream band, margin or frame around the illustration, crop it away or redo it.
- If I ask for changes, keep the same style and only change what I asked for.

THE ${source.toUpperCase()}
${title ? `Title: ${title}\n` : ""}${body || "(paste the article text or describe the concept here)"}`;
}

const htmlToText = (html) => String(html || "")
  .replace(/<\/(p|h[1-6]|li|blockquote|figcaption)>/gi, "\n\n").replace(/<br\s*\/?>/gi, "\n")
  .replace(/<figure[\s\S]*?<\/figure>/gi, "")
  .replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&#39;|&rsquo;/g, "’").replace(/&ldquo;/g, "“").replace(/&rdquo;/g, "”")
  .replace(/[ \t]+/g, " ").replace(/\n\s*\n\s*(\n\s*)+/g, "\n\n").trim();

export function mountCoverPromptTool(ctx, root) {
  root.innerHTML = `
    <header class="adv-pane-header">
      <h2 class="adv-pane-title">Cover art prompt</h2>
      <p class="adv-pane-sub">Paste an article or describe an idea, and this builds a detailed prompt for an image AI (ChatGPT, Gemini or Higgsfield) to paint a cover in The Catalyst's watercolour style. Attach the style sheet below to the same chat so the AI can see exactly what we mean.</p>
    </header>
    <div class="cvp">
      <div class="cvp-form">
        <div class="cvp-field">
          <span class="cvp-label">What it's for</span>
          <div class="cvp-seg" role="radiogroup" aria-label="Size" id="cvp-size">
            ${Object.entries(SIZES).map(([k, s], i) => `<button type="button" role="radio" data-size="${k}" aria-checked="${i === 0}" class="${i === 0 ? "is-on" : ""}">${esc(s.label)}<small>${s.ratio}</small></button>`).join("")}
          </div>
        </div>
        <label class="cvp-field">
          <span class="cvp-label">Room for text</span>
          <select class="input select" id="cvp-space">
            <option value="none">None: a full painted scene</option>
            <option value="top">Blank paper at the top for a headline</option>
            <option value="left">Blank paper on the left for text</option>
          </select>
        </label>
        <div class="cvp-field">
          <span class="cvp-label">Start from</span>
          <div class="cvp-seg cvp-seg-sm" role="radiogroup" aria-label="Source" id="cvp-kind">
            <button type="button" role="radio" data-kind="article" aria-checked="true" class="is-on">An article</button>
            <button type="button" role="radio" data-kind="concept" aria-checked="false">An idea</button>
          </div>
        </div>
        <label class="cvp-field" id="cvp-story-wrap">
          <span class="cvp-label">Fill from a published story <em>(optional)</em></span>
          <select class="input select" id="cvp-story"><option value="">Choose a story…</option></select>
        </label>
        <label class="cvp-field">
          <span class="cvp-label">Title <em>(optional)</em></span>
          <input class="input" id="cvp-title" maxlength="200" placeholder="e.g. Saving the Good Guys">
        </label>
        <label class="cvp-field">
          <span class="cvp-label" id="cvp-text-label">Article text</span>
          <textarea class="input textarea" id="cvp-text" rows="9" placeholder="Paste the article here. The whole thing is best; the AI picks the most paintable idea from it."></textarea>
        </label>
      </div>
      <div class="cvp-out">
        <div class="cvp-out-head">
          <span class="cvp-label">Your prompt</span>
          <span class="cvp-count" id="cvp-count"></span>
        </div>
        <pre class="cvp-prompt" id="cvp-prompt" tabindex="0" aria-label="Generated prompt"></pre>
        <div class="cvp-actions">
          <button type="button" class="btn btn-primary btn-sm" id="cvp-copy">Copy prompt</button>
          <a class="btn btn-secondary btn-sm" href="${SHEET}" download="catalyst-watercolor-style-sheet.jpg">Download style sheet</a>
        </div>
        <ol class="cvp-steps">
          <li>Copy the prompt and download the style sheet.</li>
          <li>In ChatGPT or Gemini, attach the style sheet and paste the prompt. In Higgsfield, add the sheet as a reference image.</li>
          <li>If the first try is close but not right, reply with one change at a time ("warmer light", "fewer flowers", "no person").</li>
        </ol>
      </div>
    </div>
    <figure class="cvp-sheet">
      <a href="${SHEET}" target="_blank" rel="noopener"><img src="${SHEET_PREVIEW}" alt="Style reference sheet: twelve Catalyst watercolour illustrations, including a Georgetown street in autumn, a tardigrade, the Library of Congress reading room, an anatomical heart with flowers, a honey pot, fungi under a seedling, cherry blossoms at the Jefferson Memorial, an octopus, a shark by a shoreline, a microscope under a desk lamp at night, an old window with a robin, and a panda eating bamboo" loading="lazy"></a>
      <figcaption>The style sheet: 12 of our own illustrations. Attach the full-size file, not a screenshot.</figcaption>
    </figure>`;

  if (!document.getElementById("cvp-styles")) {
    const st = document.createElement("style");
    st.id = "cvp-styles";
    st.textContent = `
      .cvp { display:grid; grid-template-columns:minmax(0,0.9fr) minmax(0,1.1fr); gap:24px; align-items:start; }
      @media (max-width: 1100px) { .cvp { grid-template-columns:1fr; } }
      .cvp-form { display:flex; flex-direction:column; gap:16px; }
      .cvp-field { display:flex; flex-direction:column; gap:7px; min-width:0; }
      .cvp-label { font-size:12px; font-weight:600; letter-spacing:.04em; color:var(--ink); }
      .cvp-label em { font-style:normal; font-weight:500; color:var(--muted); letter-spacing:0; }
      .cvp-seg { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:6px; }
      .cvp-seg-sm { grid-template-columns:repeat(2,minmax(0,1fr)); }
      .cvp-seg button { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:2px; min-height:48px; padding:6px 8px; border:1px solid var(--hairline-2, rgba(15,23,42,.14)); border-radius:10px; background:var(--surface,#fbfaf6); color:var(--ink); font:600 12.5px/1.2 var(--font, inherit); cursor:pointer; transition:background .15s, border-color .15s; }
      .cvp-seg button small { font-size:11px; font-weight:500; color:var(--muted); }
      .cvp-seg button:hover { border-color:var(--ink); }
      .cvp-seg button.is-on { background:var(--ink); border-color:var(--ink); color:var(--paper,#f8f7f3); }
      .cvp-seg button.is-on small { color:rgba(248,247,243,.72); }
      .cvp-seg button:focus-visible, .cvp-actions .btn:focus-visible, .cvp-prompt:focus-visible { outline:2px solid var(--ink); outline-offset:2px; }
      .cvp-form .textarea { min-height:190px; resize:vertical; font-size:13.5px; line-height:1.55; }
      .cvp-out { display:flex; flex-direction:column; gap:10px; min-width:0; position:sticky; top:12px; }
      .cvp-out-head { display:flex; align-items:baseline; justify-content:space-between; gap:12px; }
      .cvp-count { font-size:12px; color:var(--muted); font-variant-numeric:tabular-nums; }
      .cvp-prompt { margin:0; max-height:420px; overflow:auto; padding:14px 16px; border:1px solid var(--hairline-2, rgba(15,23,42,.14)); border-radius:12px; background:#f4efe3; color:#1f2937; font:12.5px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace; white-space:pre-wrap; word-break:break-word; }
      .cvp-actions { display:flex; gap:10px; flex-wrap:wrap; }
      .cvp-actions .btn { min-height:44px; display:inline-flex; align-items:center; }
      .cvp-steps { margin:4px 0 0; padding-left:20px; font-size:13px; line-height:1.55; color:var(--muted); }
      .cvp-steps li + li { margin-top:4px; }
      .cvp-sheet { margin:8px 0 0; }
      .cvp-sheet img { display:block; width:100%; height:auto; border-radius:12px; box-shadow:0 1px 0 rgba(15,23,42,.06), 0 12px 30px -18px rgba(15,23,42,.4); }
      .cvp-sheet figcaption { margin-top:8px; font-size:12.5px; color:var(--muted); }
    `;
    document.head.appendChild(st);
  }

  const $ = (s) => root.querySelector(s);
  const state = { size: "cover", space: "none", kind: "article" };
  const out = $("#cvp-prompt"), count = $("#cvp-count");
  const titleEl = $("#cvp-title"), textEl = $("#cvp-text"), spaceEl = $("#cvp-space"), storyEl = $("#cvp-story");

  function refresh() {
    const p = buildPrompt({ ...state, title: titleEl.value.trim(), text: textEl.value });
    out.textContent = p;
    count.textContent = `${p.length.toLocaleString()} characters`;
  }
  function seg(group, attr, key) {
    group.addEventListener("click", (e) => {
      const b = e.target.closest(`[data-${attr}]`); if (!b) return;
      state[key] = b.dataset[attr];
      group.querySelectorAll("button").forEach((x) => { const on = x === b; x.classList.toggle("is-on", on); x.setAttribute("aria-checked", String(on)); });
      if (key === "kind") {
        $("#cvp-story-wrap").hidden = state.kind !== "article";
        $("#cvp-text-label").textContent = state.kind === "article" ? "Article text" : "Describe the idea";
        textEl.placeholder = state.kind === "article"
          ? "Paste the article here. The whole thing is best; the AI picks the most paintable idea from it."
          : "e.g. A post about how octopuses can taste with their arms, for our fun-facts series.";
      }
      refresh();
    });
  }
  seg($("#cvp-size"), "size", "size");
  seg($("#cvp-kind"), "kind", "kind");
  spaceEl.addEventListener("change", () => { state.space = spaceEl.value; refresh(); });
  titleEl.addEventListener("input", refresh);
  textEl.addEventListener("input", refresh);

  $("#cvp-copy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(out.textContent); toast("Prompt copied. Attach the style sheet too.", "success"); }
    catch {
      const r = document.createRange(); r.selectNodeContents(out);
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
      toast("Couldn't copy automatically. The prompt is selected: press Cmd+C.", "error");
    }
  });

  // Published stories for "Fill from a story" — loaded on first focus.
  let stories = null;
  async function loadStories() {
    if (stories) return;
    stories = [];
    storyEl.innerHTML = `<option value="">Loading stories…</option>`;
    try {
      const snap = await getDocs(query(collection(db, "stories"), where("status", "==", "published")));
      const t = (v) => (v?.toDate ? v.toDate().getTime() : Date.parse(v || "") || 0);
      stories = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
        .filter((s) => !/book/i.test(String(s.category || "")))
        .sort((a, b) => t(b.publishedAt) - t(a.publishedAt));
      storyEl.innerHTML = `<option value="">Choose a story…</option>` + stories.map((s, i) => `<option value="${i}">${esc(s.title || "Untitled")}</option>`).join("");
    } catch (err) {
      console.warn("[cover-prompt] stories", err);
      storyEl.innerHTML = `<option value="">Couldn't load stories. Paste the text instead.</option>`;
    }
  }
  storyEl.addEventListener("focus", loadStories);
  storyEl.addEventListener("pointerdown", loadStories);
  storyEl.addEventListener("change", () => {
    const s = stories?.[+storyEl.value];
    if (!s) return;
    titleEl.value = s.title || "";
    const dek = s.deck || s.excerpt || "";
    textEl.value = `${dek ? dek + "\n\n" : ""}${htmlToText(s.content)}`.slice(0, 14000);
    refresh();
  });

  refresh();
}
