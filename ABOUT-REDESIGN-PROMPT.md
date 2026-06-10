# Prompt: Redesign the About page into a premium, dynamic experience

> Copy everything below the line into the expensive model. It front-loads all
> the project facts so the model spends its tokens building, not exploring.

---

## ROLE

You are a senior frontend designer-engineer. Redesign the **About page** of The
Catalyst Magazine into a premium, editorial, award-worthy experience with
tasteful, dynamic scroll animations and a hero-grade scroll-driven logo
animation — without breaking the existing data pipeline, brand, or accessibility
guarantees. This is a refinement at a high level of craft, **not** a re-theming.

## OUTPUT TARGET — BUILD A COPY, NOT THE LIVE PAGE

**Do NOT edit `about.html`.** Create a new standalone file **`aboutcopy.html`**
in the repo root that is a full, self-contained copy of the redesigned page, so
the owner can open it side-by-side with the live page to review the new edits
before anything goes live. Rules for the copy:

- Copy `about.html` as the starting point, then apply your redesign to
  `aboutcopy.html`. Keep the exact same `<head>` wiring (it must still load
  `/css/styles.css`, the shared header/footer mounts, and the same scripts) so
  it renders identically to production except for your changes.
- It must be openable directly in a browser and look complete. It still pulls
  the team data from `/js/main.js` at runtime (see the JS contract below), so
  keep the `#team-grid` / `#alumni-grid` mount points and card contract intact.
- Keep `body data-page="about"` so the existing page-scoped CSS still applies —
  you are layering on top of and overriding it within the copy's own `<style>`.
- If you must change the markup that `js/main.js` emits, do NOT edit the shared
  `js/main.js` (that would affect the live page). Instead, put any card/markup
  reshaping inside an inline `<script>` in `aboutcopy.html` that runs AFTER
  `main.js` and re-renders/augments the cards. The live data functions stay
  untouched; the copy is fully self-contained.

## WHAT THIS SITE IS

The Catalyst Magazine — a Washington, D.C. student-run STEM magazine. Editorial,
academic-leaning, serious but warm. Cross-institutional (GW, Georgetown, Howard,
Johns Hopkins). The About page tells the mission, the origin story, the
editorial commitment, and introduces the team + alumni.

## STACK & DEPLOY (do not change these assumptions)

- **Static site**: vanilla HTML/CSS/JS. No build step, no framework, no bundler.
  Do not introduce React/Vue/Tailwind/npm packages. Plain `<style>` + `<script>`.
- Hosted on **Cloudflare Pages, deploys from the repo root** on push to `main`.
  (`cloudflare-dist/` is gitignored and unused — ignore any instruction to
  mirror there.)
- Fonts: **Poppins** (already loaded via Google Fonts in the page head).
- The page is **`about.html`**. Page-specific CSS lives in a single `<style>`
  block in that file, scoped with `body[data-page="about"]`. The global
  stylesheet is `/css/styles.css` (shared by every page — **do not edit it**
  except as a last resort, and never in a way that affects other pages).

## CRITICAL ARCHITECTURE — THE TEAM IS RENDERED BY JS, NOT HARDCODED

The team and alumni cards are **injected at runtime by `/js/main.js`**. You must
preserve this contract or the page goes blank:

- `about.html` contains two empty mount points:
  - `<div class="team-roster" id="team-grid"></div>`  (active team)
  - `<div class="team-grid" id="alumni-grid"></div>`  (alumni)
- `js/main.js` defines `teamMembers[]` (source of truth: name, role, bio,
  image), `alumniMembers[]`, and `rosterGroups[]` which arranges people into
  labeled sections. `initAboutPage()` renders grouped subsections into
  `#team-grid` and alumni into `#alumni-grid` via `renderMemberCard()` /
  `renderRosterGroup()`.
- Each card has class `.team-member-card` with a `data-member="<slug>"`
  attribute (slug = lowercased name). Inner: `.team-member-image`,
  `.team-member-name`, `.team-member-role`, `.team-member-bio`.
- Current roster groups: **Executive Board**, **Staff** (sub-clusters: Editing,
  Social Media), **Undergraduate Fellowship**, **Graduate Fellowship**, then
  **Alumni** as a separate section.

**Rules for the team section (in `aboutcopy.html`):**
- You MAY restyle `.team-member-card`, `.team-group`, `.team-group-title`,
  `.team-cluster-label`, `.team-roster`, the grids, and add scroll animations
  to them — all via the copy's own scoped `<style>`.
- `js/main.js` is SHARED with the live page — **do not edit it.** If you want a
  different card structure, reshape the rendered DOM with an inline `<script>`
  in `aboutcopy.html` that runs after `main.js`'s `initAboutPage()` has
  populated the grids (e.g. on `DOMContentLoaded` + a short delay, or by
  observing the grids for child nodes), reading the existing `.team-member-name`
  / `.team-member-role` / `.team-member-bio` / `.team-member-image` content and
  re-wrapping it. Do not refetch data — reuse what `main.js` rendered.
- Do not remove the `data-member` slug on cards (one CSS rule keys off
  `data-member="josh-shapo"`, `="cameron"`, `="belinda-li"`, `="dani-molloy"`
  to scale square-source photos by 1.12 — preserve that behavior).
- Do NOT hardcode people into `aboutcopy.html`. The team comes from `main.js`.

## CURRENT PAGE SECTIONS (in order)

1. `.page-hero` — dark near-black band, white 3D-extruded "About The Catalyst"
   title with an existing scroll parallax (JS sets `--hero-y`). Subtitle:
   "Catalyst (noun): An agent that sparks significant change".
2. `#mission` — 3 `.about-card`s (Our Mission / What We Publish / Our Values)
   with tag chips.
3. `#story` — "Our Story", a three-act editorial layout (`.story-act` with
   chapter numbers 01/02/03 and a drop-cap on act 1).
4. `#commitment` — "Our Commitment", 3 cards.
5. `#team` — dark slate band, "Meet the Team", the JS-rendered roster groups.
6. `#alumni` — "Alumni", JS-rendered grid.
7. `#newsletter-section` — Mailchimp signup form (leave functionally intact).

The shared header (`#site-header`) and footer (`#site-footer`) are injected by
`/js/layout.js` — **do not touch them**.

## BRAND & DESIGN TOKENS (match exactly — this is a slate monochrome site)

The site palette is **slate monochrome**, NOT colorful, NOT gold. Gold is
reserved for one unrelated page; never use it here. Tint every neutral toward
slate — never pure `#000`/`#fff`. The page already defines these under
`body[data-page="about"]`; reuse them:

```css
--ink: #0f172a;        /* slate-900, primary ink + accent */
--ink-soft: #1f2937;
--slate-700: #334155;
--paper: #ffffff;
--paper-off: #f4f6f8;
--paper-cool: #eef1f5;
--line: #e5e7eb;
--line-strong: #cbd5e1;
--text: #1f2937;
--text-muted: #4b5563;
--text-subtle: #9ca3af;
--accent: #0f172a;     /* the accent IS the slate ink (monochrome) */
--accent-soft: #334155;
--accent-deep: #0b1220;
/* page background gradient: */
background: linear-gradient(135deg, #f8fafc 0%, #eef1f5 45%, #e5e7eb 100%);
```

The `#team` band uses `linear-gradient(135deg,#0f172a,#1f2937 50%,#334155)`.
Headline font is Poppins (already loaded). Body copy is also Poppins.

## ⭐ CENTERPIECE: SCROLL-DRIVEN LOGO IMAGE SEQUENCE (build this)

The hero must feature an **Apple-style scroll-scrubbed image sequence** of the
Catalyst logo assembling itself as the user scrolls. The frames already exist —
you do NOT process any video. Use them as-is:

- **Path:** `/logo-sequence/frame-000.webp` … `/logo-sequence/frame-119.webp`
  (zero-padded 3 digits, **0-indexed, 120 frames total**, ~1.8 MB combined).
- Each frame is **982×720**, opaque, on a warm light paper-gray background
  (roughly `#dadbdc` — it is NOT transparent). The animation starts almost
  blank (frame 0) and **builds the black hexagonal "atom" logo** up to the full
  mark by frame 119 (hexagon ring + crossing internal lines + orbital ellipses,
  with a soft drop shadow on the paper).

**How to build it (canvas frame-scrub — the premium, reliable approach):**

1. A tall pinned/sticky hero section (e.g. `~250–350vh` of scroll distance) with
   a `position: sticky; top: 0; height: 100dvh` inner stage that holds a
   `<canvas>` (or a single `<img>` whose `src` you swap — canvas is smoother).
2. **Preload all 120 frames** into an array of `Image` objects before enabling
   the scrub (show a subtle loader or the first frame until ready). Decode with
   `img.decode()` where available.
3. On scroll, map the hero's scroll progress (0→1) to a frame index
   `Math.min(119, Math.round(progress * 119))`, and draw that frame to the
   canvas inside `requestAnimationFrame` (throttle: only redraw when the index
   changes). Size the canvas with `devicePixelRatio` for crispness; use
   `object-fit: cover`-style math so it fills the stage without distortion.
4. **Composite it into the brand, don't just paste the gray video.** The raw
   frames have a flat gray background that will clash with the page. Options
   (pick what looks most premium): blend the canvas with `mix-blend-mode`
   (e.g. `multiply` over a brand-tinted backdrop so the black logo reads and the
   gray drops out), OR frame it deliberately inside a slate hero band with the
   sequence centered as the focal object, OR mask/fade the frame edges with a
   radial/linear gradient so it melts into the page. The black logo on slate or
   paper must look intentional and high-end, never like an embedded video clip.
5. Overlay the hero title/eyebrow on top of (or beside) the assembling logo, and
   let type and logo choreograph together as you scroll (e.g. title fades/rises
   while the logo completes). Avoid a dead "video in a box" look.

**Constraints for the sequence:**
- Wrap the whole scrub in `prefers-reduced-motion: reduce` — in that mode, skip
  the scroll-scrub entirely and just show the final frame (`frame-119.webp`) as
  a static hero logo.
- Mobile: the sequence must still work but be lighter — you may reduce the pinned
  scroll distance, and you should still preload (120 small WebPs is fine), but
  ensure no jank and no layout shift. Reserve the hero's height up front (CLS<0.1).
- Don't block first paint on the full preload — render the first frame
  immediately, preload the rest, then enable scrubbing.
- Keep total motion buttery: transform/opacity + canvas draws only; no
  per-frame layout reads.

This sequence is the signature moment of the page — make it feel inevitable and
expensive, like the logo is being engineered into existence as you scroll.

## WHAT "PREMIUM + DYNAMIC" SHOULD MEAN HERE

Aim for the feel of a high-end editorial/agency site (think Pentagram, Stripe
Press, a serious magazine masthead) — restrained, confident, typographic, with
motion that reveals structure rather than decorating it. Specifically:

- **Scroll-reveal choreography**: staggered fade/translate/clip reveals as
  sections and cards enter the viewport, using `IntersectionObserver` (an
  observer pattern already exists in `initAboutPage` — extend it, don't fight
  it). Cards in a group should stagger, not pop in all at once.
- **Editorial typography**: strong type scale contrast, generous whitespace,
  refined letter-spacing. Consider an oversized section index/numbering motif,
  a sticky section label, or a subtle horizontal rule system.
- **Depth & layering**: the hero already has parallax — you may add tasteful
  parallax/scroll-linked motion elsewhere (e.g. the story section, the team
  band) but keep it subtle and performant (transform/opacity only).
- **Premium team cards**: refine the member cards — hover states, image
  treatment, a clean info hierarchy (name → role → bio). The team band is dark;
  make the cards feel like crafted objects on that surface.
- **Micro-interactions**: purposeful, 150–300ms, eased. Hover, focus, and
  in-view transitions. No gratuitous bounce.
- Optional, only if it elevates: a thin scroll-progress indicator, a numeric
  "team count" that counts up on reveal, magnetic/under-line link effects.

Do NOT use generic "AI" purple/blue gradients, glassmorphism overload, emojis as
icons, or centered-everything hero clichés. Keep it on-brand slate monochrome.

## HARD CONSTRAINTS (non-negotiable)

1. **Preserve the JS data contract** (mount IDs `#team-grid`/`#alumni-grid`,
   card classes, the `data-member` slug). The cards are rendered by the SHARED
   `js/main.js` — do not edit it; reshape the rendered DOM from an inline script
   in `aboutcopy.html` instead (see the team-section rules above).
2. **Accessibility**: maintain 4.5:1 text contrast; visible `:focus-visible`
   outlines on all interactive elements; touch targets ≥44px; semantic headings.
3. **Reduced motion**: wrap ALL non-trivial motion/parallax/blur in
   `@media (prefers-reduced-motion: reduce)` and disable it there. The page
   already has such a block — extend it.
4. **Performance**: animate only `transform`/`opacity`; use `will-change`
   sparingly; lazy-load images (`loading="lazy"` is already set); no layout
   thrash; reduce blur radius on mobile. Target CLS < 0.1.
5. **Responsive / mobile-first**: no horizontal scroll; the roster grids must
   reflow to 1 column on small screens; the hero and story layouts must adapt
   (there are existing `@media (max-width:900px)` and `520px` blocks — keep them
   working).
6. **Scope discipline**: everything lives in `aboutcopy.html` only. All new CSS
   must stay under `body[data-page="about"]`. Do not edit `about.html`,
   `/css/styles.css`, `/js/main.js`, `/js/layout.js`, the header, or the footer.
   Keep the Mailchimp newsletter form working.
7. **Don't break working content** — keep the mission/story/commitment copy and
   the team data intact unless explicitly improving presentation.

## DELIVERABLES

1. **`aboutcopy.html`** — the complete, self-contained redesigned page (full
   `<head>`, the page-scoped `<style>` block, the markup, and all inline
   `<script>` for the scroll-driven logo sequence + scroll-reveal animations).
   It must open in a browser and render fully, pulling team data from
   `/js/main.js` exactly as the live page does. **Do not modify `about.html`,
   `js/main.js`, `/css/styles.css`, the header, or the footer.**
2. A short note (5–10 lines) describing: the logo image-sequence system (how
   preload + scrub + compositing work), the scroll-reveal/animation system, and
   any new CSS classes — so it can be maintained and later ported into the live
   `about.html`.
3. State briefly how to preview it (open `aboutcopy.html`) and confirm the
   image-sequence frames load from `/logo-sequence/frame-000.webp`…`-119.webp`.

Work at a high level of craft. Make deliberate design decisions and state the
rationale briefly. Prioritize a cohesive system over scattered effects.
```
