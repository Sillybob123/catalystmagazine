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
  cover:    { label: "Article cover", ratio: "16:9", px: "1920 × 1080", note: "The site shows covers wide and may trim the edges, so keep the subject inside the central 84 percent of the frame." },
  square:   { label: "Instagram post", ratio: "1:1", px: "1080 × 1080", note: "" },
  portrait: { label: "Portrait", ratio: "4:5", px: "1080 × 1350", note: "" },
  story:    { label: "Story", ratio: "9:16", px: "1080 × 1920", note: "Instagram covers the top and bottom 12 percent of a story with buttons, so keep the subject in the middle band." },
  carousel: { label: "Carousel set", ratio: "1:1", px: "1080 × 1080", note: "", set: 6 },
};
// Positive phrasing: image models follow "what to draw" far better than "what not to draw".
const SPACE = {
  none: "an edge-to-edge painting that fills the whole frame and runs off all four sides, like a crop from a larger watercolour",
  top: "the top 40 percent is open, untouched warm paper for a headline; the painting fills the lower 60 percent and runs off the left, right and bottom edges, with only its top edge melting softly into the paper",
  left: "the left 45 percent is open, untouched warm paper for text; the painting fills the right side and runs off the top, right and bottom edges, with only its left edge melting softly into the paper",
};

// The house style, written once and pasted word for word into every image
// prompt so a set of images (or a whole season of covers) stays consistent.
export const STYLE_LOCK = `[CATALYST STYLE LOCK — DO NOT DEVIATE]
Medium: transparent watercolour with fine sepia and soft charcoal ink linework over a faint pencil underdrawing, on warm off-white cold-press cotton paper (bare paper about #F4EFE3).
Line: thin, slightly wavering, confident ink lines of varied weight; light hatching in the shadows; a few pencil construction lines still visible.
Paint: soft layered washes, visible pigment granulation, gentle blooms and wet-into-wet bleeds, small patches of untouched paper as highlights.
Palette: sage green, ochre, terracotta, dusty rose, slate blue, warm grey and soft charcoal; one gentle accent at most; muted, natural, never neon.
Light and mood: soft daylight from one side; calm, curious, warm, a light touch of wit; natural-history plate meets New Yorker editorial illustration.
Finish: hand-made and slightly imperfect: uneven wash edges, pigment speckles, paper grain across the whole image, some areas detailed and others left loose.
Accuracy: animals, anatomy, plants, lab equipment and D.C. landmarks drawn correctly; people with natural proportions, gentle simple faces, five-fingered hands and a natural mix of ages and backgrounds.
Never: lettering of any kind, logos, signatures, borders, frames, glossy or airbrushed rendering, 3D-render or photographic looks, glowing sci-fi effects.`;

function buildPrompt({ size, space, title, text, kind }) {
  const S = SIZES[size] || SIZES.cover;
  const isSet = !!S.set;
  const source = kind === "concept" ? "concept" : "article";
  const body = (text || "").trim();
  const sp = isSet ? SPACE.top.replace("40 percent", "45 percent").replace("60 percent", "55 percent") : (SPACE[space] || SPACE.none);
  return `You are the art director and staff illustrator for The Catalyst, a student-run science magazine in Washington, D.C. Our images look hand-painted in a real sketchbook. Read the ${source} at the bottom, decide on the strongest picture, then ${isSet ? `make a matching set of ${S.set} carousel images` : "make ONE image"} for it.

${STYLE_LOCK}

REFERENCE
Image 1 (attached): our style reference sheet, 12 past illustrations in a grid. It controls ONLY the medium, palette, line quality, paper texture and level of detail. It does NOT control the subject, the layout, the grid, the gaps between tiles or any margin. Your output is one continuous painting, never a grid, collage, card or framed print.

FORMAT
Aspect ratio ${S.ratio} (${S.px})${isSet ? `, ${S.set} separate images` : ""}, for ${isSet ? "an Instagram carousel" : S.label}. Composition: ${sp}.${S.note ? ` ${S.note}` : ""}

STEP 1: CREATIVE DNA (think privately, don't show me)
- Story truth: what is physically real in this ${source}? (a place, an organism, an instrument, a process, a person's work)
- Reader desire: what should a curious high-school or college reader feel when they see it?
- Central mechanism: the one visual idea that captures the story.
- Forbidden clichés for THIS story: generic devices that would make the image interchangeable (always include: glowing brains, light bulbs, puzzle pieces, handshakes, circuit patterns, DNA made of light, floating icons, a lone figure staring at a galaxy).

STEP 2: ${isSet ? `PLAN THE SET` : "THREE CONCEPTS, THEN CHOOSE"}
${isSet
    ? `Plan ${S.set} images that tell the story in order (cover, who or where, the idea, how it works, why it matters, a closing scene). For each: one central idea in one clause, one concrete distinctive detail, and the setting. Keep the same light, season and palette across all ${S.set}. If a person or place appears more than once, describe them in identical words every time so they stay recognisable.`
    : `Write three different concepts. Each has: one central idea stated in one clause (never two metaphors fused together), one concrete distinctive detail another illustrator could sketch without guessing (a specific object, gesture, cross-section or viewpoint), and the setting. Prefer something specific and surprising from the ${source} over the obvious. Choose the strongest and tell me which in one line.`}

STEP 3: WRITE THE IMAGE PROMPT${isSet ? "S" : ""}
For ${isSet ? "each image" : "the chosen concept"}, write one continuous paragraph of 110 to 170 words, in this exact order:
medium → the subject in one clause → its distinctive detail → setting and composition (including the composition rule in FORMAT) → light → palette roles → paper and finish → the closing line.
Every clause must change what gets drawn; cut anything decorative. Describe what to paint, not what to avoid. Name no living artists or brands. Then end with exactly this closing line:
"Edge-to-edge watercolour painting on warm cotton paper, ${S.ratio}, no text, no lettering, no border."

STEP 4: SILENT CHECK (rewrite the prompt if any fail)
- One central idea per image, stated in one clause
- A concrete distinctive detail is present
- The composition rule from FORMAT is in the prompt
- Under 170 words, and it starts with the medium
- No clichés from Step 1, no artist or brand names
- Scientifically accurate subject
- Ends with the exact closing line${isSet ? `\n- All ${S.set} prompts share the same light, palette and recurring descriptions` : ""}

STEP 5: OUTPUT
- If you can make images: ${isSet ? `generate all ${S.set}, one per prompt,` : "generate the image from your prompt,"} attaching Image 1 as the style reference. Show me the prompt${isSet ? "s" : ""} you used.
- If you can't: give me the prompt${isSet ? "s, numbered," : ""} in a code block. In Higgsfield, use GPT Image 2.5 at high quality, ${S.ratio}, with Image 1 added as a reference; use Nano Banana 2 instead when the image is mostly a cartoon-like character.
- Then check the edges of every image: if there is any white or cream band, frame or margin, crop it or redo it.
- If I ask for a change, describe only that change and keep everything else, including the style lock, exactly the same.

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
      .cvp-seg { display:grid; grid-template-columns:repeat(auto-fit,minmax(96px,1fr)); gap:6px; }
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
      if (key === "size") {
        spaceEl.disabled = state.size === "carousel";
        spaceEl.title = spaceEl.disabled ? "Carousel slides always keep the top for the slide's text" : "";
      }
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
