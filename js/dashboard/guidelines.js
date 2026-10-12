// Editorial standards (#/writer/guidelines): what The Catalyst expects from
// writers and editors. Read top to bottom it goes: the essentials, how a story
// moves through the Story Tracker, the craft guide in four chapters, then a
// checklist each for writers and editors (ticks are remembered per browser).
//
// Content lives in CHAPTERS below. Each topic is one rule, a short
// explanation, and Do / Avoid examples. Examples marked "Illustrative" are
// invented to show a technique; don't present them as reported facts.
// Process dates mirror js/dashboard/auto-deadlines.js — keep them in sync.

import { el, esc } from "./ui.js";

const ESSENTIALS = [
  ["Write for a curious, science-literate reader", "College and above, interested in science, not a specialist in your topic. Define every technical term the first time."],
  ["Find an angle, not just a topic", "A specific person, lab, program or finding that makes the broader subject concrete."],
  ["Earn the first sentence", "Open with something surprising or vivid. Never with “This article examines…”"],
  ["Get the science exactly right", "Read the primary source. If you're unsure of a mechanism, ask the researcher before you publish it."],
  ["Report, don't prescribe", "No “must”, “should” or “need to” in a reported piece. Opinions belong to sources, or to an op-ed."],
  ["Attribute everything", "Every quote has a named speaker; every factual claim traces to reporting or a source."],
  ["End on a kicker, not a summary", "A quote, a callback or an implication that adds something new."],
  ["Hit your dates, or say so early", "Your deadlines are on your story in the Story Tracker. If one will slip, tell your editor before it does."],
];

const PROCESS = [
  { step: "Pitch", owner: "Writer, then an admin", tracker: "Pitch approved",
    text: "Propose the story in the Story Tracker: a working title, the type, the edition, a publication date, and a pitch that says what the story is, the angle and why it matters now. An admin approves or declines it." },
  { step: "Interview", owner: "Writer", tracker: "Interview scheduled · Interview done",
    text: "Contact your source within 2 days of approval and book the interview. Read their recent work first and prepare questions. Skip this step for op-eds and stories without an interview." },
  { step: "Draft", owner: "Writer", tracker: "Draft finished",
    text: "Write the piece in Write a draft. The draft is due 7 days after the interview. Before you tick “Draft finished”, run the writer checklist at the bottom of this page." },
  { step: "Edit", owner: "Editor", tracker: "Editor's review done",
    text: "An admin assigns an editor, who has 7 days to review: structure first, then accuracy, then line edits, every note with a reason." },
  { step: "Revise", owner: "Writer", tracker: "Edits made",
    text: "Work through every note within 7 days of the review. Accept, change or push back with a reason; don't leave comments unanswered. Re-check any claim an edit touched." },
  { step: "Publish", owner: "Admin", tracker: "Live on the site",
    text: "An admin does a final read, checks the headline, deck, cover image and credits, and publishes. The story then joins its season's edition." },
];

const CHAPTERS = [
  {
    id: "before", title: "Before you write",
    topics: [
      {
        id: "audience", title: "Know your reader",
        rule: "Assume intelligence, not specialized knowledge.",
        body: `
          <p>The Catalyst is written for students in college and above who are into science. They read widely and follow an argument, but they probably don't work in your field. Every choice about vocabulary, assumed knowledge and how much to explain follows from that.</p>
          <p>Aim for a well-written science magazine feature: substantive, but readable. Not a newspaper brief, and not a journal abstract.</p>`,
        examples: [
          ["do", "Define a term the first time, in a clause: “microglia, the brain's resident immune cells, …”"],
          ["avoid", "Assuming a term is common knowledge because it's common in your lab."],
          ["avoid", "Over-explaining what a cell or a gene is. Your reader knows."],
        ],
      },
      {
        id: "angle", title: "Find your angle",
        rule: "A topic is what you write about. An angle is why someone reads it.",
        body: `
          <p>Every good science story has a specific, concrete lens: a person, a place, a lab, a program or a finding that makes a broad subject real. Often the best one is local, a D.C. example that shows a national or global trend and gives you someone you can actually interview.</p>
          <p>To find it, ask yourself:</p>
          <ul class="es-list">
            <li>What was the most surprising thing I learned while researching this?</li>
            <li>Who or what embodies the larger trend?</li>
            <li>What does my reader not know, or assume wrongly?</li>
            <li>What is still unresolved, and why does it matter now?</li>
          </ul>`,
        examples: [
          ["avoid", "“This article looks at the role of AI in higher education.” A topic: no person, place, conflict or moment."],
          ["do", "“UMD has launched a dedicated AI literacy major, and it's drawing students from every discipline.” A specific institution and a concrete claim. (Illustrative)"],
        ],
      },
    ],
  },
  {
    id: "writing", title: "Writing the piece",
    topics: [
      {
        id: "lead", title: "The lead",
        rule: "Your first sentence has one job: earn the second.",
        body: `
          <p>The lead hooks the reader, signals the stakes, sets the tone and makes a promise the rest of the piece keeps. The strongest leads are surprising: an unexpected fact, a vivid scene, or a question the reader didn't know to ask.</p>
          <p>Three types work well for us. An <strong>anecdote lead</strong> opens on a specific moment or person and suits profiles and features. A <strong>surprising-fact lead</strong> opens on a counterintuitive finding. A <strong>question lead</strong> works only when the question itself is surprising.</p>
          <p>Tip: write your lead last. Once you know the whole story, the best opening is usually hiding in the middle of your first draft.</p>`,
        examples: [
          ["do", "A scene, a person, or a finding that makes the reader stop."],
          ["avoid", "“This article examines…” or “Researchers at GW have discovered…”: a press-release opening."],
          ["avoid", "“Have you ever wondered…?”: a vague rhetorical question."],
        ],
      },
      {
        id: "structure", title: "Structure and depth",
        rule: "Tell a story, not a literature review.",
        body: `
          <p>The most common trap for science-trained writers is the survey paper: comprehensive, citation-heavy and unreadable. Go deep on one case rather than listing ten studies, then zoom out to show where it fits.</p>
          <p>Outline before you write: the lead, three or so sections, and the kicker. Cut any detail that doesn't move the story forward or help the reader understand the core finding. Let your sources carry the technical weight in quotes, placed in the right order. A niche deep-dive is fine with the right frame: start broad, go narrow, come back broad.</p>`,
        examples: [
          ["do", "One research team's work, explained in human terms, then placed in the bigger picture."],
          ["avoid", "Every fact you learned, in the order you learned it."],
        ],
      },
      {
        id: "rhythm", title: "Paragraphs and pacing",
        rule: "One paragraph, one idea. End it when the idea turns.",
        body: `
          <p>Across our published work the typical paragraph runs about three sentences, roughly 66 words. Past 120 words, make sure the density is earned. Under 40, make sure the paragraph lands a turn, a consequence or a verdict. Vary length on purpose: three paragraphs of the same length flatten the pace.</p>
          <p>Short paragraphs are a landing, not an opener. They get their force from the weight before them. In Aidan Schurr's profile of Rebecca Katz, a long account of her illness resolves into one line: “This experience, harrowing and surreal, would change everything, she said.”</p>
          <p>If a section still feels dense, add a section header or tighten the angle rather than more breaks. Profiles and interviews run tighter (about 36–45 words a paragraph); explainers run denser.</p>`,
        examples: [
          ["do", "Build a long passage, then release it with a short paragraph."],
          ["avoid", "Splitting a thought in half because the block looked long."],
        ],
      },
      {
        id: "headlines", title: "Headlines",
        rule: "Be bold and specific, never misleading.",
        body: `
          <p>A headline has to stop a scrolling reader and tell them why the story matters, in one line. Use active verbs and concrete nouns, and put the stakes in. Strong words are welcome when the story supports them. If the finding is qualified, the headline is qualified too: “may help” is not “cures.” The deck (the line under the headline) adds the context the headline can't fit.</p>`,
        examples: [
          ["avoid", "“AI in Universities: A Growing Trend”"],
          ["do", "“The AI Literacy Major That Could Reshape Every Campus” (Illustrative)"],
          ["avoid", "“Research on Memory and Protein”"],
          ["do", "“Scientists Found the Protein That Lets Your Brain Forget Fear” (Illustrative)"],
        ],
      },
      {
        id: "endings", title: "Endings",
        rule: "Land the piece. Don't summarize it.",
        body: `
          <p>Your last paragraph, the kicker, is the last impression. Three endings work reliably. A <strong>quote kicker</strong> captures the story's core in the source's own words: forward-looking, candid or unexpectedly moving. A <strong>callback</strong> returns to an image or question from the lead and resolves or reframes it. An <strong>implication</strong> points to the next question or the bigger puzzle.</p>
          <p>Look for your kicker in your notes: the moment a source expressed wonder or doubt, said what they hope to find next, or said something you didn't expect.</p>`,
        examples: [
          ["do", "End on a line that adds something new: a voice, an image, a question."],
          ["avoid", "A closing paragraph that restates what the reader just read."],
        ],
      },
    ],
  },
  {
    id: "right", title: "Getting it right",
    topics: [
      {
        id: "accuracy", title: "Accuracy and sourcing",
        rule: "If you can't explain why it's true, don't publish it.",
        body: `
          <p>One error in the science can sink an otherwise excellent piece, and in science the consequences of misinformation are real.</p>
          <ul class="es-list">
            <li><strong>Read the primary source.</strong> Not just the press release or the university news story. Know what the researchers claim, and what they don't.</li>
            <li><strong>Be exact with mechanisms.</strong> Strengthens, weakens, activates, inhibits and promotes are not interchangeable. Unsure which verb is right? Go back to the source.</li>
            <li><strong>Ask when uncertain.</strong> A short email to the researcher beats a guess. They would rather answer than be misrepresented.</li>
            <li><strong>Attribute every quote and claim,</strong> with the person's name and role the first time they appear.</li>
            <li><strong>Flag doubt in your draft.</strong> Leave a comment for your editor on anything you're not sure of. Never guess silently.</li>
          </ul>
          <p>Stuck on a concept? Ask the team. Someone with a different background can often clear it up in minutes.</p>`,
      },
      {
        id: "opinion", title: "Reporting, not opinion",
        rule: "In a reported piece, conclusions belong to sources and evidence, not to you.",
        body: `
          <p>As soon as you write “universities must,” “we should” or “scientists need to,” you've moved from reporting to editorializing. Urgency and interpretation can stay in the piece; attribute them to experts, data or researchers.</p>
          <p>Op-eds are the exception: they are opinion by design and say so. Know which format you're writing before you start. If a feature starts drifting into opinion, raise it with your editor.</p>`,
        examples: [
          ["avoid", "“Universities must integrate AI literacy into their curriculum immediately.”"],
          ["do", "“Experts say AI literacy is increasingly seen as a core skill for graduates.”"],
          ["avoid", "“This research proves current policy is wrong and must change.”"],
          ["do", "“The researchers argue the findings challenge existing protocols and may warrant a policy review.”"],
        ],
      },
      {
        id: "voice", title: "Voice and credibility",
        rule: "Sound like a person; check like a scientist.",
        body: `
          <p>Voice is why a reader finishes your article instead of someone else's on the same topic. Credibility is why they trust it: accurate science, honest attribution, the right caveats, and never overstating what the research shows. You need both. Let the evidence carry the bold claim.</p>`,
        examples: [
          ["avoid", "Too flat: “There is evidence suggesting that these programs may have positive effects on outcomes.”"],
          ["avoid", "Too editorial: “Universities must adopt these programs.”"],
          ["do", "Just right: a bold, specific sentence where the facts do the arguing, with every number traced to a source."],
        ],
      },
    ],
  },
  {
    id: "editing", title: "Editing",
    topics: [
      {
        id: "writers", title: "For writers: working with your editor",
        rule: "Editing isn't a verdict on you. It's the last stage of making the story good.",
        body: `
          <ul class="es-list">
            <li><strong>Read every note before changing anything.</strong> Single comments often point to one bigger structural issue.</li>
            <li><strong>Answer every comment.</strong> Accept it, change it, or explain respectfully why you disagree. Disagreement is welcome; silence isn't.</li>
            <li><strong>Ask about edits you don't understand.</strong> Knowing the reason makes your next draft better.</li>
            <li><strong>Re-check the science after edits.</strong> Well-meant edits can introduce errors in a mechanism or a number.</li>
            <li><strong>Tick “Edits made”</strong> in the Story Tracker when you're done, so the admin knows the piece is ready.</li>
          </ul>
          <p>Group editing sessions are worth attending even when your piece isn't up: the same structure, voice and credibility problems come up again and again.</p>`,
      },
      {
        id: "editors", title: "For editors: how we edit",
        rule: "Make the writer's story better, in the writer's voice.",
        body: `
          <p>Read the whole draft once before you comment. Then edit in this order, so you don't polish sentences that will be cut:</p>
          <ul class="es-list es-list--numbered">
            <li><strong>Story.</strong> Is there a clear angle? Does the lead earn attention and does the piece keep its promise? Does the ending land?</li>
            <li><strong>Structure.</strong> Does each section move the story forward? What should be cut, moved or expanded?</li>
            <li><strong>Accuracy.</strong> Check every technical claim, number and name against the sources. Flag anything you can't verify.</li>
            <li><strong>Fairness and format.</strong> Every quote attributed, no prescriptive language in a reported piece, the headline honest to the findings.</li>
            <li><strong>Lines.</strong> Clarity, jargon, paragraph rhythm and style, last.</li>
          </ul>
          <p>Explain the why behind every note, and mark which notes are required and which are suggestions. Make line edits as suggestions the writer can accept, rather than silently rewriting their voice. You have 7 days from assignment; if you can't make it, tell an admin early. When your review is done, tick “Editor's review done” in the Story Tracker.</p>`,
        examples: [
          ["do", "“This paragraph repeats the lead's point. Cut it, or use it to set up the second study?”"],
          ["avoid", "“Awkward.” A note the writer can't act on."],
        ],
      },
    ],
  },
];

const WRITER_CHECKLIST = [
  "The piece has a specific angle, not just a topic.",
  "The lead earns attention and promises a payoff the piece delivers.",
  "Every technical term is defined the first time it appears.",
  "Every quote is attributed with the person's name and role.",
  "Every factual claim traces to the primary source or an interview.",
  "No “must”, “should” or “need to” in a reported piece.",
  "Paragraphs carry one idea each, and their length varies.",
  "The ending lands on something new, not a summary.",
  "The headline is specific and honest to the findings.",
  "Anything I'm unsure of is flagged in a comment for my editor.",
];

const EDITOR_CHECKLIST = [
  "I read the full draft once before commenting.",
  "The angle, lead and ending work, or my notes say how to fix them.",
  "I checked every technical claim, number and name against the sources.",
  "Every quote is attributed; nothing in a reported piece reads as opinion.",
  "The headline and deck are honest to what the story shows.",
  "Every note explains why, and required changes are marked as required.",
  "Line edits are suggestions, in the writer's voice.",
  "I ticked “Editor's review done” in the Story Tracker.",
];

const STORE_KEY = "catalyst.standards.checks.v1";
function loadChecks() { try { return JSON.parse(localStorage.getItem(STORE_KEY) || "{}"); } catch { return {}; } }
function saveChecks(v) { try { localStorage.setItem(STORE_KEY, JSON.stringify(v)); } catch {} }

const STYLE = `
.es { --es-measure: 68ch; display: grid; grid-template-columns: 236px minmax(0, 1fr); gap: 48px; align-items: start; max-width: 1180px; }
.es-toc { position: sticky; top: calc(var(--top-h, 72px) + 24px); max-height: calc(100vh - var(--top-h, 72px) - 48px); overflow: auto; padding: 4px 0 24px; }
.es-toc h2 { margin: 0 0 12px; font: 600 11px/1.3 var(--font); letter-spacing: .12em; text-transform: uppercase; color: var(--muted); }
.es-toc ol { list-style: none; margin: 0; padding: 0; }
.es-toc li + li { margin-top: 2px; }
.es-toc .es-toc-group { margin: 16px 0 6px; font: 600 11px/1.3 var(--font); letter-spacing: .08em; text-transform: uppercase; color: var(--muted-2); }
.es-toc a { display: block; padding: 7px 10px 7px 12px; border-left: 2px solid var(--hairline); color: var(--muted); font: 500 13px/1.35 var(--font); text-decoration: none; transition: color .15s, border-color .15s; }
.es-toc a:hover { color: var(--ink); }
.es-toc a[aria-current="true"] { color: var(--ink); border-left-color: var(--ink); font-weight: 600; }
.es-toc a:focus-visible { outline: none; box-shadow: var(--focus); border-radius: 4px; }

.es-main { min-width: 0; }
.es-hero { padding: 6px 0 30px; border-bottom: 1px solid var(--hairline); }
.es-eyebrow { margin: 0 0 10px; font: 600 11px/1.3 var(--font); letter-spacing: .12em; text-transform: uppercase; color: var(--muted); }
.es-hero h1 { margin: 0; font: 600 clamp(26px, 3vw, 34px)/1.15 var(--font); letter-spacing: -0.025em; color: var(--ink); }
.es-hero p { max-width: var(--es-measure); margin: 12px 0 0; font: 400 17px/1.6 var(--serif); color: var(--ink-2); }
.es-hero-actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 18px; }
.es-hero-actions a { display: inline-flex; align-items: center; min-height: 40px; padding: 0 16px; border: 1px solid var(--hairline); border-radius: 999px; background: var(--surface); color: var(--ink); font: 500 13px var(--font); text-decoration: none; }
.es-hero-actions a:hover { border-color: var(--ink-2); }
.es-hero-actions a:focus-visible { outline: none; box-shadow: var(--focus); }

.es-block { padding: 40px 0; border-bottom: 1px solid var(--hairline); scroll-margin-top: calc(var(--top-h, 72px) + 16px); }
.es-block > h2 { margin: 0; font: 600 22px/1.25 var(--font); letter-spacing: -0.02em; color: var(--ink); }
.es-block > .es-lede { max-width: var(--es-measure); margin: 8px 0 0; font: 400 16px/1.6 var(--serif); color: var(--muted); }

.es-essentials { counter-reset: es; list-style: none; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 32px; margin: 22px 0 0; padding: 0; }
.es-essentials li { counter-increment: es; display: grid; grid-template-columns: 32px minmax(0, 1fr); gap: 2px 8px; padding: 16px 0; border-top: 1px solid var(--hairline-2); }
.es-essentials li::before { content: counter(es, decimal-leading-zero); grid-row: span 2; font: 600 13px/1.6 var(--font); color: var(--muted-2); }
.es-essentials b { font: 600 15px/1.4 var(--font); color: var(--ink); }
.es-essentials span { font: 400 14.5px/1.55 var(--serif); color: var(--ink-2); }

.es-steps { list-style: none; margin: 22px 0 0; padding: 0; }
.es-steps li { position: relative; display: grid; grid-template-columns: 150px minmax(0, 1fr); gap: 4px 28px; padding: 18px 0 18px 26px; border-top: 1px solid var(--hairline-2); }
.es-steps li::before { content: ""; position: absolute; left: 4px; top: 25px; width: 9px; height: 9px; border-radius: 50%; background: var(--ink); }
.es-steps li::after { content: ""; position: absolute; left: 8px; top: 38px; bottom: -22px; width: 1px; background: var(--hairline); }
.es-steps li:last-child::after { display: none; }
.es-steps h3 { margin: 0; font: 600 15px/1.4 var(--font); color: var(--ink); }
.es-steps .es-owner { display: block; margin-top: 2px; font: 500 12.5px/1.4 var(--font); color: var(--muted); }
.es-steps p { margin: 0; font: 400 15px/1.6 var(--serif); color: var(--ink-2); }
.es-steps .es-tracker { display: inline-block; margin-top: 8px; padding: 2px 9px; border-radius: 999px; background: var(--surface-3); font: 500 11.5px/1.6 var(--font); color: var(--ink-2); }

.es-chapter-title { margin: 0 0 4px; font: 600 11px/1.3 var(--font); letter-spacing: .12em; text-transform: uppercase; color: var(--muted); }
.es-topic { padding: 34px 0; border-bottom: 1px solid var(--hairline-2); scroll-margin-top: calc(var(--top-h, 72px) + 16px); }
.es-topic:last-child { border-bottom: 0; }
.es-topic h3 { margin: 0; font: 600 20px/1.3 var(--font); letter-spacing: -0.015em; color: var(--ink); }
.es-rule { max-width: var(--es-measure); margin: 10px 0 0; padding-left: 14px; border-left: 3px solid var(--ink); font: 500 italic 17.5px/1.5 var(--serif); color: var(--ink); }
.es-prose { max-width: var(--es-measure); }
.es-prose p { margin: 14px 0 0; font: 400 16px/1.7 var(--serif); color: var(--ink-2); }
.es-prose strong { color: var(--ink); font-weight: 600; }
.es-list { margin: 12px 0 0; padding-left: 20px; font: 400 16px/1.65 var(--serif); color: var(--ink-2); }
.es-list li + li { margin-top: 6px; }
.es-list--numbered { list-style: decimal; }
.es-examples { display: grid; gap: 8px; max-width: var(--es-measure); margin-top: 18px; }
.es-ex { display: grid; grid-template-columns: 64px minmax(0, 1fr); gap: 12px; align-items: baseline; padding: 11px 14px; border-radius: var(--radius-sm); font: 400 15px/1.55 var(--serif); color: var(--ink-2); }
.es-ex b { font: 600 11px/1.6 var(--font); letter-spacing: .08em; text-transform: uppercase; }
.es-ex--do { background: var(--good-soft); }
.es-ex--do b { color: var(--good); }
.es-ex--avoid { background: var(--danger-soft); }
.es-ex--avoid b { color: var(--danger); }

.es-checks { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; margin-top: 22px; }
.es-check { padding: 20px 22px; border: 1px solid var(--hairline); border-radius: var(--radius); background: var(--surface); }
.es-check-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 8px; }
.es-check h3 { margin: 0; font: 600 16px/1.3 var(--font); color: var(--ink); }
.es-check-count { font: 500 12.5px var(--font); color: var(--muted); white-space: nowrap; }
.es-check ul { list-style: none; margin: 0; padding: 0; }
.es-check label { display: grid; grid-template-columns: 20px minmax(0, 1fr); gap: 10px; align-items: start; min-height: 44px; padding: 10px 0; border-top: 1px solid var(--hairline-2); cursor: pointer; font: 400 14.5px/1.5 var(--serif); color: var(--ink-2); }
.es-check li:first-child label { border-top: 0; }
.es-check input { width: 18px; height: 18px; margin: 2px 0 0; accent-color: var(--ink); cursor: pointer; }
.es-check input:checked + span { color: var(--muted); text-decoration: line-through; text-decoration-color: var(--muted-2); }
.es-check-reset { min-height: 32px; margin-top: 10px; padding: 0 12px; border: 1px solid var(--hairline); border-radius: 999px; background: none; font: 500 12.5px var(--font); color: var(--muted); cursor: pointer; }
.es-check-reset:hover { color: var(--ink); border-color: var(--ink-2); }
.es-check-reset:focus-visible { outline: none; box-shadow: var(--focus); }

@media (max-width: 1080px) {
  .es { grid-template-columns: minmax(0, 1fr); gap: 0; }
  .es-toc { display: none; }
}
@media (max-width: 720px) {
  .es-essentials, .es-checks { grid-template-columns: minmax(0, 1fr); }
  .es-steps li { grid-template-columns: minmax(0, 1fr); }
  .es-ex { grid-template-columns: minmax(0, 1fr); gap: 2px; }
  .es-block { padding: 30px 0; }
}
@media (prefers-reduced-motion: reduce) { .es-toc a { transition: none; } }
`;

function ensureStyles() {
  if (document.getElementById("es-styles")) return;
  const st = document.createElement("style");
  st.id = "es-styles";
  st.textContent = STYLE;
  document.head.appendChild(st);
}

const exampleHtml = ([kind, text]) =>
  `<div class="es-ex es-ex--${kind}"><b>${kind === "do" ? "Do" : "Avoid"}</b><span>${esc(text)}</span></div>`;

function topicHtml(t) {
  return `
    <article class="es-topic" id="${esc(t.id)}" data-es-section>
      <h3>${esc(t.title)}</h3>
      <p class="es-rule">${esc(t.rule)}</p>
      <div class="es-prose">${t.body}</div>
      ${t.examples ? `<div class="es-examples">${t.examples.map(exampleHtml).join("")}</div>` : ""}
    </article>`;
}

function checklistHtml(id, title, items, checks) {
  const done = items.filter((_, i) => checks[`${id}-${i}`]).length;
  return `
    <div class="es-check" data-list="${id}">
      <div class="es-check-head"><h3>${esc(title)}</h3><span class="es-check-count" aria-live="polite">${done} of ${items.length}</span></div>
      <ul>${items.map((item, i) => `
        <li><label><input type="checkbox" data-check="${id}-${i}" ${checks[`${id}-${i}`] ? "checked" : ""}><span>${esc(item)}</span></label></li>`).join("")}
      </ul>
      <button type="button" class="es-check-reset" data-reset="${id}">Clear ticks</button>
    </div>`;
}

export async function mount(ctx, container) {
  ensureStyles();
  container.innerHTML = "";
  const checks = loadChecks();

  const toc = [
    { id: "essentials", title: "The essentials" },
    { id: "process", title: "How a story moves" },
    ...CHAPTERS.flatMap((c) => [{ group: c.title }, ...c.topics.map((t) => ({ id: t.id, title: t.title.replace(/^For (writers|editors): /, (m, w) => w[0].toUpperCase() + w.slice(1) + ": ") }))]),
    { group: "Checklists" },
    { id: "checklists", title: "Before you submit or sign off" },
  ];

  const page = el("div", { class: "es" });
  page.innerHTML = `
    <nav class="es-toc" aria-label="On this page">
      <h2>On this page</h2>
      <ol>${toc.map((t) => t.group
        ? `<li class="es-toc-group" aria-hidden="true">${esc(t.group)}</li>`
        : `<li><a href="#/writer/guidelines?section=${esc(t.id)}" data-target="${esc(t.id)}">${esc(t.title)}</a></li>`).join("")}
      </ol>
    </nav>

    <div class="es-main">
      <header class="es-hero">
        <p class="es-eyebrow">Editorial standards</p>
        <h1>How we write and edit at The Catalyst</h1>
        <p>What every writer and editor is expected to do, from pitch to publication. Start with the essentials; the guide below explains each one, with examples.</p>
        <div class="es-hero-actions">
          <a href="#/writer/guidelines?section=checklists" data-target="checklists">Writer checklist</a>
          <a href="#/writer/guidelines?section=editors" data-target="editors">Guidance for editors</a>
        </div>
      </header>

      <section class="es-block" id="essentials" data-es-section aria-labelledby="es-h-essentials">
        <h2 id="es-h-essentials">The essentials</h2>
        <p class="es-lede">Eight standards every piece meets. If you remember nothing else, remember these.</p>
        <ol class="es-essentials">${ESSENTIALS.map(([b, s]) => `<li><b>${esc(b)}</b><span>${esc(s)}</span></li>`).join("")}</ol>
      </section>

      <section class="es-block" id="process" data-es-section aria-labelledby="es-h-process">
        <h2 id="es-h-process">How a story moves</h2>
        <p class="es-lede">Every story follows the same steps in the Story Tracker. Each step has an owner and a default deadline; an admin can set different dates for a story.</p>
        <ol class="es-steps">${PROCESS.map((s) => `
          <li>
            <div><h3>${esc(s.step)}</h3><span class="es-owner">${esc(s.owner)}</span></div>
            <div><p>${esc(s.text)}</p><span class="es-tracker">In the tracker: ${esc(s.tracker)}</span></div>
          </li>`).join("")}
        </ol>
      </section>

      ${CHAPTERS.map((c) => `
        <section class="es-block" aria-labelledby="es-h-${esc(c.id)}">
          <p class="es-chapter-title" id="es-h-${esc(c.id)}">${esc(c.title)}</p>
          ${c.topics.map(topicHtml).join("")}
        </section>`).join("")}

      <section class="es-block" id="checklists" data-es-section aria-labelledby="es-h-checks" style="border-bottom:0">
        <h2 id="es-h-checks">Checklists</h2>
        <p class="es-lede">Run the writer checklist before you tick “Draft finished”, and the editor checklist before “Editor's review done”. Your ticks stay in this browser until you clear them.</p>
        <div class="es-checks">
          ${checklistHtml("writer", "Before you submit a draft", WRITER_CHECKLIST, checks)}
          ${checklistHtml("editor", "Before you sign off an edit", EDITOR_CHECKLIST, checks)}
        </div>
      </section>
    </div>`;
  container.appendChild(page);

  // Checklists: remembered per browser.
  const updateCount = (listId) => {
    const box = page.querySelector(`[data-list="${listId}"]`);
    const all = box.querySelectorAll("input[type=checkbox]");
    box.querySelector(".es-check-count").textContent = `${[...all].filter((i) => i.checked).length} of ${all.length}`;
  };
  page.querySelector(".es-checks").addEventListener("change", (e) => {
    const box = e.target.closest("[data-check]"); if (!box) return;
    checks[box.dataset.check] = box.checked;
    if (!box.checked) delete checks[box.dataset.check];
    saveChecks(checks);
    updateCount(box.dataset.check.split("-")[0]);
  });
  page.querySelector(".es-checks").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-reset]"); if (!btn) return;
    const id = btn.dataset.reset;
    page.querySelectorAll(`[data-check^="${id}-"]`).forEach((i) => { i.checked = false; delete checks[i.dataset.check]; });
    saveChecks(checks);
    updateCount(id);
  });

  // In-page navigation: links scroll without leaving the route; the menu
  // follows the section in view.
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const sections = [...page.querySelectorAll("[data-es-section]")];
  const links = [...page.querySelectorAll(".es-toc a")];
  const mark = (id) => links.forEach((a) => a.setAttribute("aria-current", a.dataset.target === id ? "true" : "false"));
  const go = (id, behavior) => {
    const target = page.querySelector(`#${CSS.escape(id)}`);
    if (!target) return;
    target.scrollIntoView({ behavior: reduced ? "auto" : behavior, block: "start" });
    history.replaceState(null, "", `#/writer/guidelines?section=${encodeURIComponent(id)}`);
    mark(id);
  };
  page.addEventListener("click", (e) => {
    const a = e.target.closest("a[data-target]"); if (!a) return;
    e.preventDefault();
    go(a.dataset.target, "smooth");
  });
  const io = new IntersectionObserver((entries) => {
    const hit = entries.filter((x) => x.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
    if (hit) mark(hit.target.id);
  }, { rootMargin: "-20% 0px -65% 0px" });
  sections.forEach((s) => io.observe(s));
  mark("essentials");

  const requested = new URLSearchParams(location.hash.split("?")[1] || "").get("section");
  if (requested) requestAnimationFrame(() => setTimeout(() => go(requested, "auto"), 40));

  return () => io.disconnect();
}
