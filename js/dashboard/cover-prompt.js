// Admin → Advanced tools → Cover art prompt
// Builds a prompt for an image AI (ChatGPT, Gemini, Higgsfield…) that paints
// a picture in The Catalyst's watercolour style, for one of the five kinds of
// image we make: article cover, Instagram post, Instagram carousel, story and
// edition cover. Each kind has its own style sheet (beta/cover-style/sheet-*)
// showing that kind's real shape and layout, and its own composition rule
// with exact limits (how far down the paint may reach, where text goes).
// The prompt follows Higgsfield's published agent skills: a fixed style lock
// pasted verbatim, labelled references, one idea per image, one short
// positively-phrased paragraph in a fixed order, and a silent check.
// Nothing here writes to the database.

import { db } from "../firebase-config.js";
import { collection, getDocs, query, where } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { esc, toast } from "./ui.js";

const V = "v=3";
const sheet = (k) => ({ full: `/beta/cover-style/sheet-${k}.jpg?${V}`, preview: `/beta/cover-style/sheet-${k}-1600.webp?${V}` });

// Paper zone wording shared by the 1:1 and 9:16 kinds. Exact rows, a hard
// line, and what "empty" means, because image models love to paint a table,
// a wall or a sky right up to the top edge.
const paperZone = (pct, rows, total) => `TWO ZONES, with a hard limit between them.
- TOP ZONE, from the top edge down to ${pct} percent of the height (rows 0 to ${rows} of ${total}): plain bare paper and nothing else. It is the same flat warm cream as the paper, with only the paper's own grain. No sky, wash, wall, table, floor, horizon line, shadow, cloud, branch or object of any kind reaches into it.
- BOTTOM ZONE, from ${pct} percent down to the bottom edge: the painting. It runs off the left, right and bottom edges. Its top edge fades out softly and irregularly into the paper, and the highest point of any paint, line or object stays below the ${pct} percent line.
- Aim for the top of the painting at about ${pct + 5} percent, so there is a safety margin; the ${pct} percent line is the absolute limit (image models tend to creep upward).
- Fit the subject inside the bottom zone: choose a low, wide arrangement, a slightly higher viewpoint, or crop tall things at the bottom edge. Never stretch the scene upward to fill the frame.`;

const TYPES = {
  cover: {
    label: "Article cover", ratio: "16:9", px: "1920 × 1080", sheet: sheet("cover"),
    use: "the cover image at the top of an article on our website",
    sheetSays: "9 of our article covers. Each is one continuous painting that fills the frame edge to edge.",
    composition: `FULL BLEED. The painting fills the entire frame and runs off all four edges, like a crop from a larger watercolour; no part of the frame is left as empty paper. Keep the subject and anything important inside the central 84 percent, because the site trims the edges on small screens. A clear focal point slightly off-centre, with depth: a foreground detail, the subject in the middle ground, and a soft background.`,
    check: "The painting reaches all four edges; nothing important sits in the outer 8 percent.",
    closing: "Edge-to-edge watercolour painting filling the whole 16:9 frame, no text, no lettering, no border.",
  },
  post: {
    label: "Instagram post", ratio: "1:1", px: "1080 × 1080", sheet: sheet("post"),
    use: "a single Instagram post; we add the headline and text in the empty top later",
    sheetSays: "9 of our Instagram posts. Notice the empty paper across the top of every one: that is where our headline goes.",
    composition: paperZone(45, 486, 1080),
    check: "Look only at the top 45 percent: it is plain paper with nothing in it. If anything is painted there, redo it.",
    closing: "Watercolour painting in the bottom 55 percent only, plain bare paper above it, 1:1, no text, no lettering, no border.",
  },
  carousel: {
    label: "Instagram carousel", ratio: "1:1", px: "1080 × 1080", sheet: sheet("carousel"), set: true,
    use: "the slides of one Instagram carousel; we add each slide's text in the empty top later",
    sheetSays: "one of our real carousels, slides 1 to 6 in order. Notice how the slides match: the same paper, light, palette and painting height on every slide, and each one shows the next part of the story.",
    composition: paperZone(45, 486, 1080) + `\n- Every slide keeps exactly the same 45 percent line, so the set lines up when someone swipes.`,
    check: "Top 45 percent is plain paper; the painting height, paper colour, light and palette match the slides before it.",
    closing: "Watercolour painting in the bottom 55 percent only, plain bare paper above it, 1:1, no text, no lettering, no border.",
  },
  story: {
    label: "Story", ratio: "9:16", px: "1080 × 1920", sheet: sheet("story"),
    use: "an Instagram story; we add the text in the empty top half later",
    sheetSays: "4 of our stories. Notice the tall empty paper above each painting: that is where the story's text goes.",
    composition: paperZone(50, 960, 1920) + `\n- Keep faces and key details above the bottom 12 percent (above row 1690), which Instagram covers with its reply bar; the painting itself can still run off the bottom edge.`,
    check: "The top half is plain paper; key details sit above the bottom 12 percent.",
    closing: "Watercolour painting in the bottom half only, plain bare paper above it, 9:16, no text, no lettering, no border.",
  },
  edition: {
    label: "Edition cover", ratio: "3:4", px: "1536 × 2048", sheet: sheet("edition"),
    use: "the cover of one of our seasonal magazine editions; we add the masthead, title and cover lines on top later",
    sheetSays: "8 of our edition covers. Notice what they share: one Washington, D.C. landmark seen straight on, seasonal trees framing it, a path or water leading in from the bottom, and a pale, empty sky across the top for the masthead.",
    composition: `EDITION COVER LAYOUT.
- One Washington, D.C. landmark (or a D.C. street or garden) in a calm, centred, one-point-perspective view, with seasonal trees framing the left and right edges and a path, lawn, steps or water leading in from the bottom edge.
- SKY ZONE, from the top edge down to 32 percent of the height (rows 0 to 655 of 2048): an almost-white pale sky wash with nothing in it, because the masthead sits there. No birds, branches, detailed clouds or rooftops reach into it. The tallest point of the landmark stays below the 38 percent line.
- Airy and light: delicate pen-and-ink with pale, transparent watercolour, plenty of white paper showing in the sky and the ground, softer and lighter than our other images.
- The season is unmistakable: falling leaves and warm reds for fall, blossoms for spring, snow and bare branches for winter, deep green for summer.`,
    check: "The top 32 percent is a pale empty sky; the landmark is centred and correct; the season is clear.",
    closing: "Light pen-and-ink and pale watercolour edition cover, empty pale sky across the top third, 3:4, no text, no lettering, no border.",
  },
};

// The house style, written once and pasted word for word into every prompt
// so a set of images (or a whole season of covers) stays consistent.
export const STYLE_LOCK = `[CATALYST STYLE LOCK — DO NOT DEVIATE]
Medium: transparent watercolour with fine sepia and soft charcoal ink linework over a faint pencil underdrawing, on warm off-white cold-press cotton paper (bare paper about #F4EFE3).
Line: thin, slightly wavering, confident ink lines of varied weight; light hatching in the shadows; a few pencil construction lines still visible.
Paint: soft layered washes, visible pigment granulation, gentle blooms and wet-into-wet bleeds, small patches of untouched paper as highlights.
Palette: sage green, ochre, terracotta, dusty rose, slate blue, warm grey and soft charcoal; one gentle accent at most; muted, natural, never neon.
Light and mood: soft daylight from one side; calm, curious, warm, a light touch of wit; natural-history plate meets New Yorker editorial illustration.
Finish: hand-made and slightly imperfect: uneven wash edges, pigment speckles, paper grain across the whole image, some areas detailed and others left loose.
Accuracy: animals, anatomy, plants, lab equipment and D.C. landmarks drawn correctly; people with natural proportions, gentle simple faces, five-fingered hands and a natural mix of ages and backgrounds.
Never: lettering of any kind, logos, signatures, borders, frames, glossy or airbrushed rendering, 3D-render or photographic looks, glowing sci-fi effects.`;

function buildPrompt({ type, slides, season, title, text, kind }) {
  const T = TYPES[type] || TYPES.cover;
  const n = T.set ? slides : 1;
  const source = type === "edition" ? "edition" : kind === "concept" ? "concept" : "article";
  const body = (text || "").trim();
  const what = T.set ? `a matching set of ${n} carousel slides, made one at a time` : `ONE image`;
  return `You are the art director and staff illustrator for The Catalyst, a student-run science magazine in Washington, D.C. Our images look hand-painted in a real sketchbook. Read the ${source} at the bottom, decide on the strongest picture, then make ${what} for ${T.use}.

${STYLE_LOCK}

REFERENCE
Image 1 (attached): our ${T.label.toLowerCase()} style sheet, ${T.sheetSays} It controls the medium, palette, line, paper and above all the LAYOUT of this kind of image: copy where the paint sits and where the paper is left empty. It does NOT control the subject. The thin dark lines between the examples only separate them: your output is one single image, never a grid, collage, card or framed print.

FORMAT
Aspect ratio ${T.ratio} (${T.px}).
${T.composition}

STEP 1: CREATIVE DNA (think privately, don't show me)
- Story truth: what is physically real in this ${source}? (a place, an organism, an instrument, a process, a person's work)
- Reader desire: what should a curious high-school or college reader feel when they see it?
- Central mechanism: the one visual idea that captures it.
- Forbidden clichés for THIS ${source}: generic devices that would make the image interchangeable (always include: glowing brains, light bulbs, puzzle pieces, handshakes, circuit patterns, DNA made of light, floating icons, a lone figure staring at a galaxy).${type === "edition" ? `\n- Season: ${season || "the edition's season"}; landmark: one that suits the edition's theme (if one is named below, use it).` : ""}

STEP 2: ${T.set ? "PLAN THE SET" : "THREE CONCEPTS, THEN CHOOSE"}
${T.set
    ? `Plan ${n} slides that tell the story in order (for example: cover, who or where, the big idea, how it works, why it matters, a closing scene). For each slide write one line: the central idea in one clause, one concrete distinctive detail, and the setting. All slides share the same light, time of day, season and palette. If a person or place appears more than once, write one fixed description of them now and reuse it word for word on every slide.`
    : `Write three different concepts. Each has: one central idea stated in one clause (never two metaphors fused together), one concrete distinctive detail another illustrator could sketch without guessing (a specific object, gesture, cross-section or viewpoint), and the setting. Prefer something specific and surprising from the ${source} over the obvious. Choose the strongest and tell me which in one line.`}

STEP 3: WRITE THE IMAGE PROMPT${T.set ? " FOR EACH SLIDE" : ""}
Write one continuous paragraph of 110 to 170 words, in this exact order:
medium → the subject in one clause → its distinctive detail → setting → the layout rule from FORMAT in your own words (with the exact percentage) → light → palette roles → paper and finish → the closing line.
Every clause must change what gets drawn; cut anything decorative. Describe what to paint, not what to avoid. Name no living artists or brands. End with exactly this closing line:
"${T.closing}"

STEP 4: SILENT CHECK (redo the prompt, or the image, if any fail)
- One central idea, stated in one clause, plus a concrete distinctive detail
- ${T.check}
- Under 170 words, starts with the medium, ends with the exact closing line
- No clichés from Step 1, no artist or brand names, scientifically accurate subject
- No white or cream band, frame or margin around the outside of the image

STEP 5: OUTPUT
${T.set
    ? `You can only make one image per message, so we'll go one slide at a time:
1. First show me the plan from Step 2 as a numbered list, one line per slide.
2. Then make ONLY slide 1 (attach Image 1 as the style reference), show its prompt under it, and stop.
3. Wait for me. When I reply "next" (or "ready" or "go"), make the next slide, and only that one, with its prompt. Keep going until all ${n} are done, then say "That's the set."
4. Before every slide, re-read the style lock, the plan and the fixed descriptions, and look at the slides you've already made: the new one must sit naturally next to them (same paper colour, same light direction, same 45 percent line, similar amount of detail) while showing the next part of the story.
5. If I reply "redo" with a note, remake the same slide with only that change.
If you can't make images at all, give me all ${n} prompts, numbered, in one code block instead.`
    : `- If you can make images: make it from your prompt, attaching Image 1 as the style reference, and show me the prompt you used.
- If you can't: give me the prompt in a code block.
- Then look at your image against the check in Step 4. If it fails (for example, paint reaching into the empty zone), say so and make it again.
- If I ask for a change, change only that and keep everything else, including the style lock and the layout, exactly the same.`}
In Higgsfield, use GPT Image 2.5 at high quality, ${T.ratio}, with Image 1 added as a reference image; use Nano Banana 2 instead when the image is mostly a cartoon-like character.

THE ${source.toUpperCase()}
${title ? `Title: ${title}\n` : ""}${body || (type === "edition" ? "(describe the edition: its season, title and theme, and a landmark if you have one in mind)" : "(paste the article text or describe the concept here)")}`;
}

const htmlToText = (html) => String(html || "")
  .replace(/<\/(p|h[1-6]|li|blockquote|figcaption)>/gi, "\n\n").replace(/<br\s*\/?>/gi, "\n")
  .replace(/<figure[\s\S]*?<\/figure>/gi, "")
  .replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&#39;|&rsquo;/g, "’").replace(/&ldquo;/g, "“").replace(/&rdquo;/g, "”")
  .replace(/[ \t]+/g, " ").replace(/\n\s*\n\s*(\n\s*)+/g, "\n\n").trim();

const LAYOUT_NOTE = {
  cover: "Full bleed: the painting fills the whole frame. Subject kept away from the edges the site trims.",
  post: "Top 45% stays plain paper for the headline; the painting sits in the bottom 55%.",
  carousel: "Same 45% paper line on every slide. The AI makes slide 1, then waits for you to say “next” before each one.",
  story: "Top half stays plain paper for text; key details sit above Instagram's reply bar.",
  edition: "A centred D.C. landmark with seasonal trees; the top third is a pale, empty sky for the masthead.",
};

export function mountCoverPromptTool(ctx, root) {
  root.innerHTML = `
    <header class="adv-pane-header">
      <h2 class="adv-pane-title">Cover art prompt</h2>
      <p class="adv-pane-sub">Pick what you're making, paste an article or describe the idea, and this builds a detailed prompt for an image AI (ChatGPT, Gemini or Higgsfield) in The Catalyst's watercolour style. Each kind of image has its own style sheet: attach it to the same chat so the AI copies the right layout.</p>
    </header>
    <div class="cvp">
      <div class="cvp-form">
        <div class="cvp-field">
          <span class="cvp-label">What you're making</span>
          <div class="cvp-seg" role="radiogroup" aria-label="What you're making" id="cvp-type">
            ${Object.entries(TYPES).map(([k, t], i) => `<button type="button" role="radio" data-type="${k}" aria-checked="${i === 0}" class="${i === 0 ? "is-on" : ""}">${esc(t.label)}<small>${t.ratio}</small></button>`).join("")}
          </div>
          <p class="cvp-layout" id="cvp-layout"></p>
        </div>
        <label class="cvp-field" id="cvp-slides-wrap" hidden>
          <span class="cvp-label">Slides</span>
          <select class="input select" id="cvp-slides">${[4, 5, 6, 7, 8].map((n) => `<option value="${n}"${n === 6 ? " selected" : ""}>${n} slides</option>`).join("")}</select>
        </label>
        <label class="cvp-field" id="cvp-season-wrap" hidden>
          <span class="cvp-label">Season</span>
          <select class="input select" id="cvp-season"><option>Fall</option><option>Winter</option><option>Spring</option><option>Summer</option></select>
        </label>
        <div class="cvp-field" id="cvp-kind-wrap">
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
          <a class="btn btn-secondary btn-sm" id="cvp-dl" href="#" download>Download style sheet</a>
        </div>
        <ol class="cvp-steps" id="cvp-steps"></ol>
      </div>
    </div>
    <figure class="cvp-sheet">
      <a id="cvp-sheet-link" href="#" target="_blank" rel="noopener"><img id="cvp-sheet-img" alt="" loading="lazy"></a>
      <figcaption id="cvp-sheet-cap"></figcaption>
    </figure>`;

  if (!document.getElementById("cvp-styles")) {
    const st = document.createElement("style");
    st.id = "cvp-styles";
    st.textContent = `
      .cvp { display:grid; grid-template-columns:minmax(0,0.9fr) minmax(0,1.1fr); gap:24px; align-items:start; }
      @media (max-width: 1100px) { .cvp { grid-template-columns:1fr; } }
      .cvp-form { display:flex; flex-direction:column; gap:16px; }
      .cvp-field { display:flex; flex-direction:column; gap:7px; min-width:0; }
      .cvp-field[hidden] { display:none; }
      .cvp-label { font-size:12px; font-weight:600; letter-spacing:.04em; color:var(--ink); }
      .cvp-label em { font-style:normal; font-weight:500; color:var(--muted); letter-spacing:0; }
      .cvp-seg { display:grid; grid-template-columns:repeat(auto-fit,minmax(104px,1fr)); gap:6px; }
      .cvp-seg-sm { grid-template-columns:repeat(2,minmax(0,1fr)); }
      .cvp-seg button { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:2px; min-height:48px; padding:6px 8px; border:1px solid var(--hairline-2, rgba(15,23,42,.14)); border-radius:10px; background:var(--surface,#fbfaf6); color:var(--ink); font:600 12.5px/1.2 var(--font, inherit); cursor:pointer; transition:background .15s, border-color .15s; text-align:center; }
      .cvp-seg button small { font-size:11px; font-weight:500; color:var(--muted); }
      .cvp-seg button:hover { border-color:var(--ink); }
      .cvp-seg button.is-on { background:var(--ink); border-color:var(--ink); color:var(--paper,#f8f7f3); }
      .cvp-seg button.is-on small { color:rgba(248,247,243,.72); }
      .cvp-seg button:focus-visible, .cvp-actions .btn:focus-visible, .cvp-prompt:focus-visible { outline:2px solid var(--ink); outline-offset:2px; }
      .cvp-layout { margin:2px 0 0; font-size:12.5px; line-height:1.5; color:var(--muted); }
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
      .cvp-sheet img { display:block; max-width:100%; max-height:560px; height:auto; margin:0 auto; border-radius:12px; box-shadow:0 1px 0 rgba(15,23,42,.06), 0 12px 30px -18px rgba(15,23,42,.4); }
      .cvp-sheet figcaption { margin-top:8px; font-size:12.5px; color:var(--muted); text-align:center; }
    `;
    document.head.appendChild(st);
  }

  const $ = (s) => root.querySelector(s);
  const state = { type: "cover", kind: "article" };
  const out = $("#cvp-prompt"), count = $("#cvp-count");
  const titleEl = $("#cvp-title"), textEl = $("#cvp-text"), storyEl = $("#cvp-story"), slidesEl = $("#cvp-slides"), seasonEl = $("#cvp-season");

  function refresh() {
    const T = TYPES[state.type];
    const p = buildPrompt({ ...state, slides: +slidesEl.value, season: seasonEl.value, title: titleEl.value.trim(), text: textEl.value });
    out.textContent = p;
    count.textContent = `${p.length.toLocaleString()} characters`;
    $("#cvp-layout").textContent = LAYOUT_NOTE[state.type];
    $("#cvp-slides-wrap").hidden = !T.set;
    $("#cvp-season-wrap").hidden = state.type !== "edition";
    $("#cvp-kind-wrap").hidden = state.type === "edition";
    $("#cvp-story-wrap").hidden = state.type === "edition" || state.kind !== "article";
    $("#cvp-text-label").textContent = state.type === "edition" ? "Describe the edition" : state.kind === "article" ? "Article text" : "Describe the idea";
    textEl.placeholder = state.type === "edition"
      ? "e.g. Winter 2027, “Medical Innovation in the Capital”. Maybe the Smithsonian Castle in snow."
      : state.kind === "article" ? "Paste the article here. The whole thing is best; the AI picks the most paintable idea from it."
        : "e.g. A post about how octopuses can taste with their arms, for our fun-facts series.";
    const dl = $("#cvp-dl");
    dl.href = T.sheet.full; dl.setAttribute("download", `catalyst-style-sheet-${state.type}.jpg`);
    dl.textContent = `Download the ${T.label.toLowerCase()} style sheet`;
    $("#cvp-sheet-link").href = T.sheet.full;
    const img = $("#cvp-sheet-img");
    if (img.dataset.type !== state.type) { img.src = T.sheet.preview; img.dataset.type = state.type; img.alt = `Style sheet for ${T.label.toLowerCase()}s: ${T.sheetSays}`; }
    $("#cvp-sheet-cap").textContent = `The ${T.label.toLowerCase()} style sheet: ${T.sheetSays} Attach the full-size file, not a screenshot.`;
    $("#cvp-steps").innerHTML = T.set
      ? `<li>Copy the prompt and download the carousel style sheet.</li>
         <li>In ChatGPT or Gemini, attach the sheet and paste the prompt. It shows you the plan and makes slide 1.</li>
         <li>Reply <b>next</b> for each following slide, or <b>redo</b> plus a note to fix one. Save each image as you go.</li>`
      : `<li>Copy the prompt and download the ${esc(T.label.toLowerCase())} style sheet.</li>
         <li>In ChatGPT or Gemini, attach the sheet and paste the prompt. In Higgsfield, add the sheet as a reference image.</li>
         <li>If the first try is close but not right, reply with one change at a time ("warmer light", "fewer flowers", "no person").</li>`;
  }
  function seg(group, attr, key) {
    group.addEventListener("click", (e) => {
      const b = e.target.closest(`[data-${attr}]`); if (!b) return;
      state[key] = b.dataset[attr];
      group.querySelectorAll("button").forEach((x) => { const on = x === b; x.classList.toggle("is-on", on); x.setAttribute("aria-checked", String(on)); });
      refresh();
    });
  }
  seg($("#cvp-type"), "type", "type");
  seg($("#cvp-kind"), "kind", "kind");
  [titleEl, textEl].forEach((x) => x.addEventListener("input", refresh));
  [slidesEl, seasonEl].forEach((x) => x.addEventListener("change", refresh));

  $("#cvp-copy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(out.textContent); toast("Prompt copied. Attach the style sheet too.", "success"); }
    catch {
      const r = document.createRange(); r.selectNodeContents(out);
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
      toast("Couldn't copy automatically. The prompt is selected: press Cmd+C.", "error");
    }
  });

  // Published stories for "Fill from a story", loaded on first use.
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
