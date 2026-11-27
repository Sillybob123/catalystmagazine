# Hero announcement mode: an edition's takeover of the homepage band

The homepage band ("Science orbits the Capital") can be taken over by the next edition for a few
weeks: the band turns to the season's palettes, its tree and its weather, and a glass panel on the
right counts down to the launch, then says "Out now". After the panel's weeks the season's look can
stay on its own for a while. Outside those dates the band is exactly as it was. While an entry is on
(look or panel), the Washington Monument stays out of the scene.

Winter 2027 is the first. The next edition only needs a new entry in
`edition-art/hero-announcements.json`, a season tree and (if it is a new kind) a particles kind.

## The files

| File | What it does |
|---|---|
| `edition-art/hero-announcements.json` | The entries. The only file to edit for a new edition. |
| `js/hero-announcement.js` | Picks the entry for today (Eastern time), fills the panel and the card, centres the panel, runs the countdown and the phase changes, draws the particles, builds the glass's refraction filter and moves its rim light, and tells the band's script what changed (`window.catalystScene.announce`). |
| `css/hero-announcement.css` | The glass panel, the edition card, the particle layers and their responsive and reduced-motion rules. |
| `index.html` (assembled) | Its head holds a copy of the pick function and of the entries, so the season, palettes, tree and panel are decided **before the first paint** (no flash of spring before winter). The band's script (`scene.js` in the compose parts) lays the scene out beside the panel and leaves the Monument out. |
| `js/layout.js` | `setupAnnounce()` leaves the site-wide bar off on the homepage while the panel is up. |

The head copy comes from `beta/masthead/source/compose/assemble.py`: it reads the entries file and the
text between `/* pick:start */` and `/* pick:end */` in `js/hero-announcement.js`. **After editing the
entries, run `python3 assemble.py` in `beta/masthead/source/compose/`** (on John's Mac) and mirror
`index.html` to `cloudflare-dist/`. If you forget, nothing breaks: the script re-reads the entries
file on every visit and switches to it, just with one quick snap after the first paint instead of
being right from the start.

## The entry

```json
{
  "id": "winter-2027",              // also the site bar's data-key (see "The bar" below)
  "edition": "winter-2027",         // the edition's id in editions.json
  "season": "winter",               // written on <html data-season>; names the palette table
  "themeFrom": "2026-11-26T00:00:00-05:00",   // the season's look starts
  "themeTo":   "2027-03-01T00:00:00-05:00",   // and ends
  "panelFrom": "2026-11-26T00:00:00-05:00",   // the panel (countdown) appears
  "launch":    "2026-12-15T00:00:00-05:00",   // the countdown's zero; the panel's wording turns to "Out now"
  "panelTo":   "2027-01-20T00:00:00-05:00",   // the panel goes; the look stays until themeTo
  "number": "06",
  "title": "Winter 2027",
  "lead": "The future of health is",
  "blanks": ["decided in D.C.?", "prevention?", "human?", "up for debate?"],   // turn one every 3s; after launch they are the section links
  "cover": "/edition-art/winter/cover-2027-700.webp?v=3",
  "link": "/edition-winter",
  "before": { "kicker": "Next edition", "note": "Out December 15", "cta": "Take a sneak peek" },   // the panel's three lines: kicker, title, note
  "after":  { "kicker": "Out now", "note": "Read it now", "cta": "Read the edition" },
  "tree": "/beta/masthead/scene/tree-winter.webp",   // a -720.webp copy must sit beside it
  "particles": "snow",              // a kind in PARTICLES in js/hero-announcement.js, or leave it out
  "paletteEvery": 12,               // seconds per palette: 8 held + the band's 4s fade
  "palettes": [ { "name": "midnight", "g": "oklch(30% .047 252.9)", "c": "oklch(91.7% .011 234.8)" }, … ],
  "text": "#f6efe4",                // --t: the band's type, orbit lines (at 32%) and the panel's cream
  "accent": "#f4b9a4"               // the rotating blank and the card's lead line
}
```

(JSON has no comments: the ones above are only for this guide.)

Dates are ISO with the Eastern offset (`-05:00` in winter, `-04:00` from mid-March to early
November). Write midnight Eastern as `T00:00:00-05:00`.

## Dates and phases

| When | What the band shows |
|---|---|
| before `themeFrom`, or from `themeTo` | the band as usual (spring palettes, cherry tree, Monument in the scene) |
| `themeFrom` to `panelFrom` | the season's look only (allowed: a theme without a panel) |
| `panelFrom` to `launch` | the look, plus the panel with the countdown (days, hours, minutes, seconds to `launch`) |
| `launch` to `panelTo` | the look, plus the panel saying "Out now", the sections as links, "Read the edition" |
| `panelTo` to `themeTo` | the season's look only |

The entry whose theme dates contain now wins; if two overlap, the later one in the file. The page
changes phase by itself at `launch`, `panelTo` and `themeTo` if it is open at that moment.

## Preview URLs

| URL | Shows |
|---|---|
| `/?announce-date=2026-11-30` | that day at noon Eastern (countdown) |
| `/?announce-date=2026-12-20` | after launch ("Out now") |
| `/?announce-date=2027-02-10` | the season's look without the panel |
| `/?announce-date=2026-12-14T23:59:30-05:00` | thirty seconds before launch: watch it turn |
| `/?announce=winter-2027` | that entry's look now, whatever the date (with its panel if now is before `panelTo`) |
| `/?announce=off` | the band as it is without any entry |
| `&pal=0` to `&pal=4` | start on that palette of the entry's list (0 is the first) |
| `&glass=url`, `&glass=frost` | force the refraction (`url`) or the blur fallback that Safari gets (`frost`); see "The glass" |

The preview date also applies to the site bar on the homepage, so `2027-02-10` shows it gone.

## Palettes

Each palette is `g` (the band's ground) and `c` (the sun disc), written in oklch. They replace the
band's own five for the season, keep its 4-second fade, and turn every `paletteEvery` seconds. A
fade never starts within 2 seconds of a landmark change; it waits until the new landmark has risen.

Picking them:

- Keep `g` dark, about 30 to 38% lightness, chroma under .09 (more looks neon at this size), and
  the hues of the season (winter: blue, teal, slate, a cold violet).
- Keep `c` very light, 91 to 94%, chroma under .02, tinted toward `g`'s hue so the sun belongs to it.
- Check the type on `g`, in the panel too (the glass adds about 8% cream). It must clear 4.5:1.
  Winter 2027 (contrast against the cream `#f6efe4` and the accent `#f4b9a4`):

| Palette | `g` | Cream on `g` | Accent on `g` | Cream on the panel glass | 68% cream on the glass | 55% cream on the glass |
|---|---|---|---|---|---|---|
| midnight | oklch(30% .047 252.9) | 11.9 | 8.0 | 9.5 | 5.4 | 4.1 |
| cobalt | oklch(37.2% .08 255.5) | 9.1 | 6.1 | 7.4 | 4.4 | 3.4 |
| evergreen | oklch(32.4% .036 184.3) | 10.8 | 7.2 | 8.6 | 5.0 | 3.8 |
| glacier | oklch(37.7% .049 217.8) | 8.7 | 5.9 | 7.1 | 4.3 | 3.4 |
| twilight | oklch(34.4% .042 276.6) | 10.2 | 6.8 | 8.1 | 4.8 | 3.7 |

The 68% (kicker) and 55% (countdown labels) tiers fall under 4.5:1 on the lighter grounds; they are
small and repeat what the digits and the hidden text say, but a darker `g` (or brighter tiers) fixes it.

A quick way to measure: paste the oklch into any converter to hex, then into a contrast checker.

## The season tree

The tree must be the spring tree, re-seasoned, pixel for pixel in the same place, so it can swap in
with no layout change. Make it by editing the original picture, never from scratch:

1. Higgsfield, model `gpt_image_2_6`, quality high, 2k, 16:9, with job **6b81207e** (the spring
   tree) as the image reference. Prompt: "Keep the exact same cherry tree, trunk, limb, branch
   shapes and framing, pixel-aligned; change only the season to …" (say what: bare and snowy with a
   few early blossoms; full autumn leaves; …), then the shared light block and the anti-AI block
   from `beta/masthead/GENERATIONS.md`. 2 credits per try, at most 2 tries. Log the job in
   `GENERATIONS.md`.
2. Download it to `beta/masthead/source/scene/gen/tree-<season>.png` (gitignored).
3. Cut it with the script that cut `tree.webp` (same crop, scale and settings; it also writes the
   720px copy):

   ```
   python3 -I beta/masthead/source/scene/key-tree.py beta/masthead/source/scene/gen/tree-<season>.png beta/masthead/scene/tree-<season>.webp --bg auto
   ```

   `--bg auto` measures the generation's gray from the empty right side of the frame (each try's
   gray is a little different). Note: `tree.webp` was cut with `key-tree.py`, not
   `scripts/make-scene.py`, whose AI cut-out leaves gray haze between the blossoms.
4. Check it: lay it over `tree.webp` at 50% (trunk and limb must line up), look for kept twigs, clean
   edges and no haze, and keep it under about 160 KB.
5. Add it to `beta/masthead/CREDITS.md` (with the command) and put the path in the entry's `tree`.

`/beta/*` is cached for a year: if you replace a tree picture, give it a new name (or `?v=`).

## Particles

`PARTICLES` in `js/hero-announcement.js` holds the kinds. A kind is a slant (degrees) and a list of
layers; a layer is a square tile of small shapes that falls one tile per `dur` seconds, turned by
the slant. They move by transform only and stop under reduced motion. They sit above the tree, under
the copy, the nav and the panel, and thin to about 12% behind the headline and subtitle.

Snow is the only kind so far: two layers of cream dots (a 260px tile with 7 flakes over 30s, a 340px
tile with 3 larger ones over 21s) at -8°. For petals or leaves, add a kind whose `draw` returns the
tile's SVG shapes (an ellipse or a small path, in the season's colours), and name it in the entry.

## The panel

From 1001px the panel sits at the right of the band; at 1000px and under its content moves to the
edition card (below): at the foot of the band on tablets, under the first story on phones.

- **Place.** Its right edge is on the nav pill's right edge. It is centred vertically between the
  bottom of the nav pill and the band's bottom edge, with equal gaps (`placePanel()` measures both,
  on load, when the header arrives and on every resize; the CSS centres it in the band until then).
- **Size.** 272×242, radius 20, padding 18 (scaled with the band's column past 1440).
- **Compact.** 248 wide, cover 48×64, the "The future of health is …" line hidden: from 1001 to
  1180px, and wherever 242px plus two 18px gaps would not fit (`ha-tight`).
- **Content**, top to bottom: the cover, 16px, then three lines (kicker, title, `note`); the line
  "The future of health is" with the rotating blank (14px below; the four blanks share one grid
  cell, so nothing reflows); the countdown (13px below) or, after launch, the four sections as
  links; the full-width button 16px from the bottom (a 38px pill with a 44px hit area). All of it
  sits above the glass (z-index 2).
- **The cover**: a plain magazine at a slight turn. The link has `perspective: 380px`; the 58×78
  box inside is turned `rotateY(-17deg) rotateZ(-1.5deg)` from its left edge, with three shadows,
  a spine strip (8px gradient on the left), a gloss over the whole cover and a .5px hairline.

### The scene beside the panel

The scene is centred between the end of the headline and the panel's left edge (at 1440 the
landmark's centre is at x 853). It is bigger than the band's usual one: the Capitol about 214×313
at a 360px band (its statue 20px or more under the nav, about 47px cut at the bottom), the sun 380
across with its centre 12px under the band's edge, the orbit rx 160, ry 36, tilted 6°, and the
objects at full size (the aerodrome 144 wide, the telegraph 110, New Horizons 116). All of it
scales with the band's height, like the rest of the scene.

At every point of the loop the orbit plus half the widest object stays at least 28px from the end
of the headline and 26px from the panel, and the front objects at least 14px above the band's
bottom. When a landmark cannot keep these gaps it is drawn smaller; the panel and the copy never
move. Because the centre depends on where the headline ends, the scene waits for the web fonts
(at most 1.2s, while the landmark's picture is still loading anyway) before it is shown, so it
never shifts.

### The edition card (1000px and under)

Two copies of one card, filled alike by the script; CSS shows one. Its height is fixed (164, or
104 from 601px, where it is all on one row), so filling it moves nothing.

- **Tablets (761–1000px): `#ha-ticket`** (after `.band-grid`, inside `.band-in`), a floating glass
  card at the band's foot, over the scene's last 16px, with 18px of band under it; the gutter's
  width (at most 720), radius 22.
- **Phones (760px and under): `#ha-card`**, in Latest stories between the first story
  (`#ls-lead`) and the side column, at John's ask (Nov 26): solid in the season's first colour
  (`--ha-ink` and `--ha-accent`, set on it by the script, since the band's colours don't reach
  it), radius 18, no refraction. The band there is the season alone, and on all stacked widths
  the headline and subtitle are centred.
- **Content**: the cover (46×62) and three lines (kicker with the date, the title, "The future of
  health is" with the rotating blank) on top; under a hairline, the countdown and a "Sneak peek"
  pill (40px, 44px hit area). After launch the button fills the row. Under 390px the countdown and
  the button tighten, under 360 the cover and the lead shrink, and under 350 the countdown drops
  its seconds. The lead line is hidden if it would not fit on one line.
- **The scene sinks into the tablet card.** The band script reads the card's top edge (`sinkY` in the scene
  script) and masks the landmark, the next landmark during a change and the sun from there: a
  34px fade under the frosted glass (Safari, Firefox), a hard edge under the refracting glass
  (Chromium, `.ha-lens`), which would bend a fade into a smudge. The orbit is placed so the front
  objects stay 12px or more above the card.
- **Phone scene** (no card in the band): the headline in two lines with the subtitle under it, the scene
  `clamp(250px, 64vw, 360px)` tall, the landmark centred (the wide ones at least 60% of the
  width), a rounder orbit (ry .34 of rx) whose objects keep 10px from the screen's edges and are
  at most a quarter of its width.

## The glass

The panel and the card are liquid glass: nearly clear, with the light living in a 1–2px edge.

- **Refraction (Chrome and Edge).** An SVG displacement filter with chromatic aberration, in
  `backdrop-filter: blur(1px) url(…#displace) blur(3px) brightness(1.12) saturate(1.6)`. The filter
  is built for the panel's real size and radius by `lgMap()` / `lgFilter()` (depth 14, strength 95,
  chromatic aberration 6), adapted from `getDisplacementMap` / `getDisplacementFilter` in
  [nikdelvin/liquid-glass](https://github.com/nikdelvin/liquid-glass) (MIT; the notice is at the
  top of the JS, the credit in `beta/masthead/CREDITS.md`). A ResizeObserver rebuilds it when the
  size changes. Support is read back the library's way (`backdrop-filter: url(#test)`); Safari
  can accept `url()` there without drawing it, so Apple's browsers always get the fallback.
- **Fallback (Safari).** `-webkit-backdrop-filter: blur(14px) saturate(150%) brightness(1.06)`.
  Everything else (tint, shadows, rings, moving light, fringe) is the same.
- **Body.** A 160° cream tint (.13 → .04 → .07), three drop shadows, and four inset shadows that
  shade the slab like a lens.
- **Rings** (`.ha-glass`, under the content). Each ring is a transparent border with a padding-box
  mask (`mask: linear-gradient(#000 0 0) padding-box exclude, linear-gradient(#000 0 0)`), so its
  inner corners follow the radius:
  1. base rim, 1px: a neutral edge, brighter at the top left, with a faint pastel cast;
  2. moving rim light, 1.5px: a white arc centred on angle A, with a dim one opposite (opacity
     .3 + .6·i);
  3. prism fringe, 2px, blurred .4px: a thin spectrum beside the light (opacity .75·i);
  4. a faint inner colour band: the same spectrum on a 9px ring, blurred 5px, screen (.32·i).
- **Motion.** A is the light's angle (0 at the top, clockwise), i its strength; at rest A = −42,
  i = .22. Over the panel the pointer sets A (from the centre; ignored within 6px of it) and i
  (strongest at the edges and corners); off it, both go back to rest. While the pointer is over the
  panel, each frame A turns the short way by 40% of the gap, i and the panel's lean (up to 1.2px
  toward the pointer) close 40% of theirs too, measured against a 60fps frame so a 120Hz screen
  moves no faster: the light keeps up with the pointer like real glass (most of the way there in a
  tenth of a second; John found the old 2.2° a frame too slow). Off the panel it drifts back to
  rest at 12% a frame (about half a second). The loop writes the two CSS variables and a
  transform, reads no layout, and stops once settled. Touch screens, the card and
  reduced motion stay at rest. Under "reduce transparency" the glass is solid.

`?glass=frost` shows Chrome what Safari draws; `?glass=url` forces the refraction.

## The bar

The site bar (`#site-announce` in `header.html`) says the same thing as the panel, so `js/layout.js`
leaves it off on the homepage while the panel is up, when the bar's `data-key` is the entry's `id`.
Keep the bar's `data-key` = the entry's `id` and its `data-until` = the entry's `panelTo`: the
homepage then also skips holding room for the bar in the season's last weeks.

## Caching

`edition-art/hero-announcements.json` revalidates every 5 minutes (`_headers`), unlike the rest of
`edition-art/` (a year). The JS and CSS revalidate on every request. The cover and the tree are
cached for a year: new names (or a bumped `?v=`) when replaced.

## Before shipping a new entry

1. Preview each phase at 1440, 1280, 1180, 1000, 760 and 390 wide: nothing collides, no sideways scroll,
   the snow (or petals) never on the type, the panel's two gaps equal, the lead line on one line.
2. Watch a landmark change with the panel up (every 30 seconds) and a palette fade.
3. Check Safari, or at least `?glass=frost` in Chrome, and move the pointer round the panel.
4. Mirror every changed file to `cloudflare-dist/`.
