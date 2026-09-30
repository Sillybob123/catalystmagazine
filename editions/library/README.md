# Edition art library

Ready-made art for future editions of The Catalyst: **21 sets: 5 per season, plus a sixth fall set (`fall-06`)**
(spring, summer, fall, winter). Each set is one Washington, D.C. landmark in
that season, generated with Higgsfield (Nano Banana) to match the existing
edition pages.

`manifest.json` lists every set: its season, landmark, a description, whether
its hero photo is dark, whether the cover's sky is dark, and its status.

## What is in a set

| File | Use |
|---|---|
| `cover-700/1100/1600.webp` | The magazine cover drawing (pen-and-ink + watercolor, 3584:4800). **It has no text.** The masthead, dateline, title and cover lines are added in HTML (`.wx-cover` in `css/edition.css`), so any title works. |
| `hero-900/1600/2600.webp` | The wide hero photo behind the edition page (desktop). The landmark sits right of centre. |
| `hero-tall-800/1200.webp` | The same scene as a tall photo for phones. The landmark sits in the lower-middle, with sky above. |

## Making a new edition

1. Work out the season. Winter = Dec–Feb, named by the year of its January
   (e.g. Winter 2027 = Dec 2026–Feb 2027), Spring = Mar–May, Summer = Jun–Aug,
   Fall = Sep–Nov. The Catalyst publishes fall, winter and spring editions; a
   thin summer is folded into fall.
2. In `manifest.json`, pick a set with that `season` and `"status": "available"`.
   Prefer a landmark that suits the edition's theme.
3. Move its folder to `editions/<season>-<year>/`, and in `manifest.json` set
   `"status": "used"` and `"used_by": "<Season Year>"`. Never reuse a used set.
4. Build the page from an existing edition page:
   * a **light** hero (`hero_is_dark: false`): copy `edition-fall-2026.html`
     (or `edition-spring-2026.html` for blossom colours);
   * a **dark** hero (`hero_is_dark: true`): copy `edition-fall-2025.html`
     or `edition-winter-2025.html` (light text, with a colour band easing the
     hero into the page).
   * `cover_sky_is_dark: true`: add `is-night` to the `.wx-cover` figure and
     the `.wx-cover.is-night` rules (see `edition-fall-2025.html`) so the
     masthead turns light.
5. Weather: `data-weather="snow"` for winter, `"petals"` for spring, none for
   summer and fall.
6. Add the edition to `edition-overview.html` (hero fan, year rail, a chapter).

An edition that is not out yet gets `data-upcoming="<Month Year>"` on `<body>`:
its stories show as locked previews (see `js/edition.js`).

## Sets already used

`manifest.json → already_used_by_editions` lists the art used by existing
editions (in `editions/<edition>/`, plus `editions/winter/` (Winter 2027) and
`editions/spring/` (Spring 2027, saved but hidden from the overview for now)). Those landmarks are taken.
