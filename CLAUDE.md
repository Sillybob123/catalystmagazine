# Catalyst Magazine — Claude project context

## Project at a glance

- Static site, vanilla HTML/CSS/JS, served from Cloudflare Pages (apex `catalyst-magazine.com`) + Firebase backend.
- Source HTML lives in the repo root; the deployed bundle is mirrored under `cloudflare-dist/`. **When you edit a root HTML file, also copy it to the matching path in `cloudflare-dist/`** or it won't ship.
- Brand: editorial / academic-leaning, GW-adjacent. Logo set on warm paper background. Headline font: Poppins.

## Available design skills (installed at `~/.claude/skills/`)

Three design skill bundles are installed at user level. They are all available in every Claude Code session — invoke their commands by typing `/` (or by asking me to apply them).

### 1. Impeccable (Paul Bakaus, v3.0.6) — `~/.claude/skills/impeccable/`

Design fluency for AI harnesses. One skill, 23 commands sharing a vocabulary.

| Command | Purpose |
|---|---|
| `/impeccable` | Freeform design with full design intelligence |
| `/impeccable teach` | One-time setup — scans codebase + interviews, writes PRODUCT.md |
| `/impeccable craft` | Shape → load refs → build → iterate visually |
| `/impeccable shape` | Plan UX/UI through structured discovery (no code) |
| `/impeccable critique` | Design review with scoring + persona tests |
| `/impeccable audit` | 5-dimension technical quality check (P0–P3) |
| `/impeccable typeset` | Fix generic / inconsistent typography |
| `/impeccable layout` | Fix layout, spacing, visual rhythm |
| `/impeccable colorize` | Add strategic color without going garish |
| `/impeccable animate` | Purposeful motion (state, not decoration) |
| `/impeccable delight` | Small moments of personality |
| `/impeccable bolder` | Push timid designs toward impact |
| `/impeccable quieter` | Tone down designs that are shouting |
| `/impeccable overdrive` | Push past conventional limits (shaders, physics, cinema) |
| `/impeccable distill` | Ruthless subtraction |
| `/impeccable clarify` | Rewrite confusing UX copy |
| `/impeccable adapt` | Make designs work across screens/devices |
| `/impeccable polish` | Meticulous final pass |
| `/impeccable optimize` | UI performance — LCP to bundle |
| `/impeccable harden` | Edge cases, i18n, error states, overflow |
| `/impeccable extract` | Pull reusable components / tokens into design system |
| `/impeccable document` | Generate spec-compliant DESIGN.md |
| `/impeccable live` | Browser-native iteration on a live element |

Key Impeccable laws (apply automatically when these commands run):
- **Never use pure `#000` or `#fff`** — tint every neutral toward the brand hue.
- **Use OKLCH** for color; reduce chroma at lightness extremes.
- **Pick a color strategy first**: restrained / committed / dual-tone / maximalist.
- **Identity is preserved by default** in Live Mode v3.0.6 — variants stay on-brand, departure only when explicitly asked.
- Two context files anchor every command: `PRODUCT.md` (who/what/why) and `DESIGN.md` (visual system).

### 2. UI/UX Pro Max (`~/.claude/skills/ui-ux-pro-max/` + sibling `~/.claude/skills/{uiux-design,banner-design,ui-styling,brand,slides,design-system}/`)

UI/UX intelligence database: 50+ styles, 161 color palettes, 57 font pairings, 161 product types, 99 UX guidelines, 25 chart types, across 10 stacks.

Priority-based rule categories:
1. **Accessibility (CRITICAL)** — 4.5:1 contrast, alt text, keyboard nav, ARIA labels
2. **Touch & Interaction (CRITICAL)** — min 44×44px targets, 8px+ spacing, loading feedback
3. **Performance (HIGH)** — WebP/AVIF, lazy load, CLS < 0.1
4. **Style Selection (HIGH)** — match product type, no emoji as icons
5. **Layout & Responsive (HIGH)** — mobile-first, no horizontal scroll
6. **Typography & Color (MEDIUM)** — base 16px, line-height 1.5, semantic tokens
7. **Animation (MEDIUM)** — 150–300ms duration, prefers-reduced-motion support

Use it when: designing/refactoring pages or components, choosing color/type/layout systems, reviewing UI for UX/accessibility, building design systems.

### 3. Taste (Leonxlnx, `~/.claude/skills/taste/` + 11 siblings)

High-Agency Frontend Skill — overrides default LLM design biases. Bundle includes:
- `taste` (master) · `taste-minimalist` · `taste-brutalist` · `taste-soft` · `taste-redesign`
- `taste-image-to-code` · `taste-stitch` · `taste-brandkit` · `taste-output` · `taste-gpt`
- `taste-imagegen-web` · `taste-imagegen-mobile`

Active baseline: `DESIGN_VARIANCE: 8` · `MOTION_INTENSITY: 6` · `VISUAL_DENSITY: 4`

Anti-bias rules Taste enforces:
- **THE LILA BAN** — generic "AI purple/blue" gradients are banned. Use neutral bases (Zinc/Slate) with one high-contrast accent.
- **ANTI-CENTER BIAS** — centered hero/H1 sections banned when layout variance > 4. Force split-screen, asymmetric, or left/right-anchored.
- **ANTI-CARD OVERUSE** — for dense surfaces, use `border-t` / `divide-y` / negative space instead of generic boxes.
- **ANTI-EMOJI POLICY** — never emojis in code/markup. Use Phosphor or Radix icons.
- **Viewport stability** — never `h-screen`, always `min-h-[100dvh]` to avoid iOS Safari layout jump.
- **Grid over flex-math** — use `grid grid-cols-N` not `w-[calc(...)]`.
- **Premium type** — prefer Geist / Outfit / Cabinet Grotesk / Satoshi over Inter for "premium" feel; serif fonts banned for dashboards.

## Design tokens for `ai-expo.html` (and pattern for new pages)

The AI Expo page (`ai-expo.html` and `cloudflare-dist/ai-expo.html`) was retuned using these three skills together. The token set:

```css
--ink: #0a0a0c;          /* tinted near-black, not #000 */
--paper: #fbfbf9;        /* tinted near-white, not #fff */
--accent: #c9a14a;       /* Catalyst gold — committed accent */
--accent-soft: #e8d28a;
--accent-deep: #8a6a25;
```

Reuse these on any new dark+gold editorial surface. They satisfy Impeccable's "no pure neutrals" rule and replace the prior generic AI-purple/blue gradient (Taste LILA BAN).

## Working rules in this repo

- HTML edits: always mirror to `cloudflare-dist/<same-path>`.
- Don't rewrite working pages — refine. Preserve identity by default (Impeccable v3.0.6 rule).
- Touch targets must be ≥44px (Pro Max P2). Always include `:focus-visible` outlines on interactive elements.
- Always wrap heavy motion / blur in `@media (prefers-reduced-motion: reduce)` and reduce blur radius on mobile.

## Editions (seasonal magazine pages)

- `editions.html` lists every edition. Past editions (`edition-winter-2025`, `-spring-2025`, `-fall-2025`, `-spring-2026`, `-fall-2026`) hold the real published articles for their date span (book reviews excluded); `edition-fall-2026` is the current one and also pulls in new articles by date (`data-from` / `data-to` on `<body>`, see `js/edition.js`). `edition-winter` (Winter 2027, out Dec 2026) is upcoming: `data-upcoming` turns its stories into locked previews. `edition-spring` (Spring 2027) is saved but hidden — its overview fan cover and chapter are commented out in `editions.html`.
- Seasons: Winter = Dec–Feb, named by the year of its January (Dec 2026–Feb 2027 = Winter 2027); Spring = Mar–May; Fall = Sep–Nov. A thin summer folds into fall.
- **Art for new editions: `edition-art/library/`** — 21 ready sets (5+ per season: textless cover + wide hero + phone hero). Read `edition-art/library/README.md` and `manifest.json` before making an edition; mark the set you use as `used`.
- Edition story links carry `?edition=<id>`; `js/article-edition.js` + `css/article-edition.css` (article.html) then dress the article in that edition (folio, ribbon, colours, prev/next, edition card) from `edition-art/editions.json`. Without the parameter the article page is unchanged.
- The homepage (`index.html`) is organised around the editions: story edition tags, the current-edition spread and the shelf all read `edition-art/editions.json`; the Winter 2027 sneak peek there is hand-written (update it when the next edition is announced). The previous homepage is `homepage-previous.html` (noindex). The edition archive lives at `/editions` (`editions.html`).
- `/articles` (`articles.html` + `js/articles.js`): latest spread, then a shelf per edition; search / type / edition / topic / order switch to a results grid, with state in the URL (`?category=`, `?edition=`, `?topic=`, `?q=`, `?sort=`). The admin 'Articles hero image' setting (`site_settings/articlesHero`) belonged to the old page and is not used by it. Old page kept as `articles-old.html` (noindex, still on `js/articles-new.js`).
