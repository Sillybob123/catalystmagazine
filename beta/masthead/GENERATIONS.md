# Masthead band: Higgsfield generation log

Every Higgsfield job for the `home-new.html` masthead band. Check here (and the
Higgsfield history) before generating anything new. Raw downloads live in
`beta/masthead/source/` (gitignored).

Starting balance (Nov 25, 2026): **976.66 credits** (plus plan).

| # | When (UTC) | Job / media ID | Model | Settings | Credits | Result |
|---|---|---|---|---|---|---|
| 0 | Nov 25 16:59 | media `8d894704-6de9-44bb-b309-1d71fbfb71f0` | upload | `a-source-padded.png`: plate.webp at 1600×893, padded with white paper to 1600×1595 so the Monument and Capitol fit an 8:1 strip of a 21:9 canvas | 0 | source image |
| 1 | Nov 25 17:00 | `acd4dc8e-baec-4458-bc6a-312f68f8cbd8` | `outpaint` (outpaint_image tool) | 21:9, 3722×1595, no prompt field | 0 (errored, not billed) | failed: "Something went wrong" |
| 2 | Nov 25 17:01 | `33e74fff-6a31-4ef2-b7a8-594ccd75cd09` | `outpaint` | changed: dropped width/height (tool default 1584×672) | 0 (errored, not billed) | failed again; switched to the FLUX outpaint model the account already used successfully in Nov |
| – | Nov 25 17:02 | quote only | `flux_2_pro_outpaint` | 3722 wide | 0 | rejected: canvas max 2560px per side |
| 0b | Nov 25 17:02 | media `e29e61b0-347c-4023-9936-7a54c3cff1c3` | upload | same padded source at 1083×1080 so the expanded canvas is 2520×1080 (21:9, same size as a Kling 1080p frame) | 0 | source image |
| 3 | Nov 25 17:03 | `f8da2f8d-c3e3-4f95-91c2-a8b1e5173088` | `flux_2_pro_outpaint` | expand L 718 / R 719, brief's extension prompt | 2.64 | unusable: both new sides filled with flat solid green |
| 4 | Nov 25 17:05 | `bc6f24fb-4f55-45dd-9da0-8b18c6ffbb7d` | `flux_2_pro_outpaint` | changed: empty prompt (as in the account's earlier successful outpaints) | 2.64 | clean paper, but no new drawing: the plate's own edges are blank paper, so the model just continued blank paper |
| 0c | Nov 25 17:08 | media `6bfc5c99-08cb-4909-b6b4-e45845c2ef92` | upload | `a-source-tight.png`: plate cropped to the drawing (x 470–1245, y 150–600 at 1280 scale), 669×388 | 0 | source image |
| 5 | Nov 25 17:09 | `6711ff7d-14e5-48ef-a90a-82e61764fb6a` | `flux_2_pro_outpaint` | changed: tight-cropped source (John OK'd the 5th job); expand L 925 / R 926 / T 344 / B 348 to 2520×1080, empty prompt | 2.2 | **usable**: the Mall continues left (buildings, tree rows, lawns) in the same hand; right of the Capitol thins out to paper. Saved as `source/a-outpaint-6711ff7d.png`. Lines in the new parts are a little lighter than the original (fixed with levels in Step C) |

| – | Nov 25 17:11 | — | — | John turned down the #5 still: "clumped in the center", wants it spread out and more beautiful. Videos on hold. | 0 | |
| 0d | Nov 25 17:12 | media `6c5623dd-3324-4288-85e5-b9118a66a2a8` | import | the live `beta/mall/plate.webp` as a style reference | 0 | |
| 6–7 | Nov 25 17:12 | `06298c59-bf3a-4b63-9f70-8bc746971336`, `ea7a37e9-ec30-4f4b-98a5-2f8e7f0655fd` | `nano_banana_2` (served as nano_banana_flash) | 21:9, 2k, count 2, plate as reference; new panorama: Lincoln Memorial, Reflecting Pool, Monument, Smithsonian, Capitol spread along one horizon, same pen style, 3 hatched clouds, orbit ring | 4 | both good; **`ea7a37e9` chosen** (lower, calmer). Too tall for an 8:1 strip at full width (skyline is ~5:1) |
| 8–9 | Nov 25 17:14 | `cc901068-ebd4-4e9e-8d5b-5f3a467f9d84`, `6a6ddfe3-ffbb-4db1-aafb-b937784d1bf4` | `nano_banana_2` | changed: `ea7a37e9` as reference + "smaller and lower, skyline one fifth of the image height" | 4 | the model kept the proportions; `6a6ddfe3` is the cleanest version (no foreground lawn), skyline still ~4.8:1 |
| 10 | Nov 25 17:16 | `8ff44365-73ba-4081-9998-be787c598467` | `flux_2_pro_outpaint` | strip of `6a6ddfe3` (full width, 1730×318) widened to 2544×318 | 1.32 | blank paper again (the strip's ends are paper). Same lesson as #4 |
| – | Nov 25 17:17 | quote only, media `95d7e5f9-1380-4ca8-b7e8-31c6ba81a725` | `flux_2_pro_outpaint` | strip of `6a6ddfe3` cropped so the tree rows touch both ends (x 200–2990, y 380–962 → 1524×318), L/R 510 → 2544×318 | (1.32 quoted) | **not run**: waiting for John |
| 11 | Nov 25 17:24 | `bc0d58a9-f847-4968-972a-9783ce6b0233` | `nano_banana_2` (served as nano_banana_flash) | John's attempt 2 of 3 after his 8-point feedback: his prompt verbatim (flat frontal elevation, true heights, one ground line, line hierarchy, light from the left, no annotations), plate.webp (media `6c5623dd`) as style reference, 21:9, 2k, **count 1**. Appended two sentences: use the reference for the hand only; one low strip across the middle, Monument a little left of centre, Capitol toward the right, empty sky above both ends (for the dateline and motto) | 2 | **usable**: flat elevation, one ground line, no annotations, landmarks in order, light from the left. Still had a frame, generic filler buildings, perspective lawn lines, 5 clouds on ruled lines and the Monument only 1.44x the Capitol, all fixed in post (below). Saved as `source/pano-bc0d58a9.png` |

**Spent so far: 18.80 credits.**

## Post-processing of job 11 (free, `source/compose/*.py`)

1. `clean.py`: crop the drawn frame; erase the generic filler buildings behind the trees (straight pale lines, then everything not attached to a dark hatched canopy); erase the perspective lawn and path lines so only the one ground line is left.
2. `clouds.py`: keep two clouds (small left, large right of centre), drop the other three, strip the ruled base lines.
3. `compose.py`: lay it out as a flat 7000x855 band (8.2:1). Landmark groups at Lincoln .12, Monument .45, Castle .57, Capitol .835 of the width; elm rows between them from the drawing's own tree clusters (each used at most three times, some at 82% and paler for distance); one continuous ground line; the Monument redrawn at 1.4x on a low knoll so it stands 1.93x the Capitol (555 ft vs 288 ft), with its right-hand face hatched behind a centre arris; the Capitol's hill eased down to the ground; specks removed; levels (black 32, white 226, gamma 1.25) for clean paper and solid ink.
4. Outputs: `source/band-full.png` (7000x855), `plate.webp` (2400x293, 26 KB), `source/still-21x9.png` (2520x1080 video frame, strip across the middle at y 386).


Why not an extension of `beta/mall/plate.webp`: the plate is a one-point perspective view
down the Mall (Monument and Capitol in the middle, paths converging to a vanishing point),
with measurement lines, a molecule, a constellation and the orbit ring drawn in. Extending
it (job 5) keeps the perspective and the centred cluster, so it cannot become a flat 8:1
band. From job 11 on, the band is a new flat elevation with plate.webp as the style
reference only. My own prompt for jobs 6–9 asked for "construction lines and measurement
ticks" and the orbit ellipse, which is where the fake annotations came from.


Outpainting `plate.webp` as a whole cannot extend the drawing: its edges are empty
paper, so the model continues empty paper. The drawing has to be cropped tight first
so that trees, lawn and buildings touch the source edges, then outpainted.

## Checkpoint (sent to John Nov 25, 17:1x UTC)

- Next image job (needs OK, it would be the 5th): crop the plate tight to the drawing
  (x 470–1245, y 150–600 at 1280 scale, 669×388), outpaint to 2520×1080
  (L 925, R 926, T 344, B 348), empty prompt. Quote: **2.2 credits**.
- B1 draw-on, Kling 4.0, image-to-video, 21:9, 1080p, 8s, count 1: **30 credits** (720p: 20).
- B2 ambient loop, same settings, start = end frame: **30 credits**.

## Cancelled, Nov 25 18:05 UTC

John cancelled the pen-and-ink skyline masthead (brief v1): it "read as stock AI art".
Nothing more is generated for it. The B1/B2 videos above were never run. `plate.webp`
and `map.webp` stay only until the v4 band replaces them, then they are deleted.

## Brief v4: the D.C. + science collage (from Nov 25, 18:10 UTC)

Caps without asking: 60 credits in total, 2 attempts per piece, no video. Real photos and
local tools first (cutouts with rembg `birefnet-general`, run locally; grade and grain in
`scripts/make-piece.py`).

| # | Date (UTC) | Job | Model / settings | Prompt | Credits |
|---|---|---|---|---|---|
| – | – | none yet | – | – | 0 |

**Spent under v4: 0 credits.** (Total since Nov 25: 18.80.)

Round 2 (Nov 25, 19:30 UTC: a bank of 20, palettes, announcements): 13 more real photos and
one public-domain drawing, cut out locally. **0 credits.**

## Brief v5: "Science orbits the Capital" (from Nov 25, 20:25 UTC)

Caps without asking: 80 credits in total; first attempt 2 variants for the dome and 1 for each
other asset; at most 3 attempts per asset; no video. Moon and ISS are the real NASA photos
(cut out and graded locally, free). References uploaded to Higgsfield: capitol-src.jpg
(86aaca5e), monument-src.jpg (99b11169), blossom-src.jpg (9915f42a), webb-src.jpg (3b6417ba).
Every prompt = the asset prompt + the reference sentence + "Isolated on a seamless plain
light-gray studio background, for clean cutting." + the shared light block + the anti-AI
block (both verbatim from HOME-NEW-PROMPT.md v5). Model gpt_image_2_6, quality high, 2k.

| # | Date (UTC) | Asset | Job ID(s) | Settings | Quote | Credits |
|---|---|---|---|---|---|---|
| 1 | Nov 25 20:28 | dome, attempt 1 (2 variants) | 4d7e0c53, 2cea1d33 | 4:3, ref capitol | wrnv5Mb7 | 4 |
| 2 | Nov 25 20:28 | monument, attempt 1 | 90b0d3f8 | 9:16, ref monument | TmuKUGqR | 2 |
| 3 | Nov 25 20:28 | blossoms, attempt 1 | 11b16a56 | 16:9, ref blossom | L_xzqvTj | 2 |
| 4 | Nov 25 20:28 | webb, attempt 1 | 6703e92f | 1:1, ref webb | -9wM5j8B | 2 |

**Spent under v5 so far: 10 credits.** (Balance 957.86 before, 947.86 after.)

Checked against the references at 100% (Nov 25, 20:35 UTC): all five pass, no retries.
Used: dome 2cea1d33 (cleaner detail than 4d7e0c53), monument 90b0d3f8, blossoms 11b16a56,
webb 6703e92f. Raw downloads in beta/masthead/source/scene/gen/ (gitignored); the graded
cut-outs are beta/masthead/scene/*.webp, made with scripts/make-scene.py.

### Round 3, part 2: Moon, ISS and the landmark bank (John, Nov 25 20:40 UTC)

John approved the five scene images and asked for the Moon and ISS to be generated too, and for a
D.C.-centred bank so each page load shows a different landmark. New references uploaded:
moon-src.jpg (587c2aa1), iss-src.jpg (8d16d4fb), jefferson-src.jpg (2f96e40b),
lincoln-src.jpg (71caa8d9), loc-src.jpg (6a63745e), castle-src.jpg (ca283da8). Same prompt recipe.

| # | Date (UTC) | Asset | Job ID(s) | Settings | Quote | Credits |
|---|---|---|---|---|---|---|
| 5 | Nov 25 20:47 | moon, attempt 1 | d4c5aa83 | 1:1, ref moon | r-LoHzVn | 2 |
| 6 | Nov 25 20:47 | iss, attempt 1 | ae24fc8d | 16:9, ref iss | 9-EY9Bdp | 2 |
| 7 | Nov 25 20:47 | jefferson, attempt 1 | 3edc5701 | 3:2, ref jefferson | FSBR7oRb | 2 |
| 8 | Nov 25 20:47 | lincoln, attempt 1 | cf55bbca | 3:2, ref lincoln | T5pAVvJW | 2 |
| 9 | Nov 25 20:47 | library of congress dome, attempt 1 | ffcbc5ed | 3:4, ref loc | MdJc_JC7 | 2 |
| 10 | Nov 25 20:47 | smithsonian castle, attempt 1 | 2cdc5f71 | 3:2, ref castle | MOgnlF2Y | 2 |

**Spent under v5 so far: 22 credits** (balance 947.86 before this part, 935.86 after).

Checked against the references at 100% (Nov 25, 20:55 UTC): all six pass, no retries.
Moon: the same face as the Artemis II photo, maria and the dark patches lower right in place.
ISS: main truss, eight wings (four per end, two above and two below), radiators, modules and
the docked craft below. Jefferson: shallow stepped dome, eight Ionic columns across the portico,
pediment group, the statue inside. Lincoln: twelve fluted Doric columns across the front, the
three dark entrance bays, wreaths, the attic with festoons and eagles (the carved state names are
left out: no lettering, and too small to read at band size anyway). Library of Congress: ribbed
copper dome, balustrade, cupola, small dome and the gilded Torch of Learning. Castle: the two
spired towers at the west end, the battlemented main tower and its taller turret, the octagonal
east tower, the round-arched windows. Graded cut-outs in beta/masthead/scene/ (make-scene.py).

### Round 4: the orbit bank (John, Nov 25 21:48 UTC)

John asked for 15 more objects for the orbit, D.C.-centred and each linked to a story, with a
hover tag naming what it is and its place in D.C., a different colour on each load, and no
straight edge behind the header. Same caps (80 credits, quote first, at most 3 attempts per
asset, no video). One reference per object, uploaded to Higgsfield (media id prefix):
ferret (2227e6d0), coral (7c2bc665), dragonfly (d3bd7fb4), venus (864a8397), hubble (044ae8c3), fritillary (1c3d1673), hope (ef7c1124), telegraph (573924fc), kilogram (5248f093), mosquito (0568c26e), robot (29f4e2a4), brain (65189ce4), petri (1fd31d36), cicada (03f68256), apollo (c94f98e2).
Sources of the references are in CREDITS.md, round 4. Same recipe: the asset prompt below +
the shared reference/background/light/anti-AI block of round 3, verbatim. Model gpt_image_2_6,
quality high, 2k, one image each.

| # | Date (UTC) | Asset | Job ID | Settings | Quote | Credits |
|---|---|---|---|---|---|---|
| 11 | Nov 25 22:05 | ferret, attempt 1 | b17533fe | 3:2, ref ferret | SJ4X1qJU | 2 |
| 12 | Nov 25 22:05 | coral, attempt 1 | e617479c | 4:3, ref coral | EyBubVEf | 2 |
| 13 | Nov 25 22:05 | dragonfly, attempt 1 | 2cfc8429 | 3:2, ref dragonfly | 6DfnFxWo | 2 |
| 14 | Nov 25 22:05 | venus, attempt 1 | f39e6590 | 1:1, ref venus | UWIA8r_0 | 2 |
| 15 | Nov 25 22:05 | hubble, attempt 1 | 1a03c025 | 3:2, ref hubble | wU0qFQBS | 2 |
| 16 | Nov 25 22:05 | fritillary, attempt 1 | ac1a3da0 | 1:1, ref fritillary | 9Hb-8hS4 | 2 |
| 17 | Nov 25 22:05 | hope, attempt 1 | 71a7bf98 | 1:1, ref hope | BUQSPFyA | 2 |
| 18 | Nov 25 22:05 | telegraph, attempt 1 | 77dc5c27 | 3:2, ref telegraph | UpY0FDvG | 2 |
| 19 | Nov 25 22:05 | kilogram, attempt 1 | 88817bd3 | 3:4, ref kilogram | pr7ARyPS | 2 |
| 20 | Nov 25 22:05 | mosquito, attempt 1 | 535c20d5 | 3:2, ref mosquito | 5TcqonUK | 2 |
| 21 | Nov 25 22:05 | robot, attempt 1 | bfcadaaf | 3:4, ref robot | z0NAMFo5 | 2 |
| 22 | Nov 25 22:05 | brain, attempt 1 | 44d7a3cd | 4:3, ref brain | BtsJEYqD | 2 |
| 23 | Nov 25 22:05 | petri, attempt 1 | eb11e4e2 | 1:1, ref petri | JDHtff9D | 2 |
| 24 | Nov 25 22:05 | cicada, attempt 1 | 26ca0668 | 3:2, ref cicada | vut6NZpZ | 2 |
| 25 | Nov 25 22:05 | apollo, attempt 1 | 2c6e7ef1 | 1:1, ref apollo | 2xgFVpBS | 2 |

Seven of the fifteen were refused on the first submit by Higgsfield's limit of 8 running jobs
(no job made, nothing charged) and submitted again from the same quote once slots freed.

**Spent under v5 so far: 52 credits** (balance 935.86 before this round, 905.86 after).

Checked against the references at 100% (Nov 25, 22:10 UTC): all fifteen pass, no retries.
Ferret: black mask, pale muzzle, black legs and tail tip. Coral: flattened antler branches,
ochre tissue, polyp texture. Dragonfly: boxy lander, coaxial rotor pairs on arms, landing skids,
dish antenna on a mast, power unit at the rear (a likeness of the APL design, not a drawing of
the flight unit). Venus: a full cloud-covered disc (masked to a true circle; the soft shadow
under it is dropped). Hubble: open aperture door, two solar arrays, antenna masts, aft shroud.
Fritillary: wings closed, silver spots on the cinnamon hindwing, orange forewing; the twig is
dropped in the cut. Hope: deep blue cushion-cut stone in a ring of sixteen white diamonds, the
bail kept and the chain masked off. Telegraph: lever, knob, brass posts, wooden base. Kilogram:
polished cylinder under two nested bell jars on a round base. Mosquito: spotted wings, banded
legs, long palps beside the proboscis, no blood or skin. Robot arm: seven-joint white arm with a
suturing tool (an arm of the kind STAR used, not STAR itself; the tag names it generically).
Brain: the cerebrum's folds and grooves, seen from above and to the side. Petri dish: red Serratia streaks and one
antibiotic disc with its clear ring. Cicada: black body, red eyes, orange wing veins. Apollo:
the scorched cone, hatch, windows and docking tunnel of Columbia. Graded cut-outs in
beta/masthead/scene/ (make-scene.py; commands in CREDITS.md).

Asset prompts (each followed by the shared block):
- **ferret** (3:2): A black-footed ferret (Mustela nigripes), the endangered North American ferret: the whole animal in side view, standing alert on all four short legs with its head turned toward the camera, long slender body, soft buff-tan fur paling to cream on the throat, the black bandit mask across the eyes, white muzzle and brow, black legs and feet, a black tip on the tail, small rounded ears, the whole animal including the full tail in frame, true to the species.
- **coral** (4:3): A single colony of elkhorn coral (Acropora palmata): thick, flattened, antler-like branches spreading up and out from a short base, golden-brown to ochre living tissue with paler tips at the growing edges, the fine pitted texture of tiny polyp cups all over the surface, photographed whole as a natural-history specimen, the whole colony in frame, true to the species. No water, no fish.
- **dragonfly** (3:2): NASA's Dragonfly rotorcraft lander for Saturn's moon Titan, true to the Johns Hopkins APL design in the reference: a car-sized octocopter with a boxy body, four arms each holding a pair of stacked rotors (eight rotors in all), a long landing skid on each side, a round dish antenna on a mast on top, the cylindrical power unit at the rear, white and gold thermal blankets and bare aluminum, seen in three-quarter view, the whole vehicle in frame. No ground, no sky.
- **venus** (1:1): The planet Venus seen whole from space as a full, fully lit disc: a smooth globe of thick cloud in pale cream, soft ivory and faint warm ochre, with gentle broad swirls and bands in the upper atmosphere, slightly darker toward the edge, true to the spacecraft view in the reference. A perfect sphere, the whole planet in frame. No stars.
- **hubble** (3:2): The Hubble Space Telescope as photographed by astronauts after its last servicing mission: the long cylindrical body wrapped in shiny silver and white insulation panels, the hinged aperture door open at the front, two long flat rectangular solar arrays extended out to either side on booms, the antenna masts, handrails and the wider aft section, seen in side three-quarter view, the whole spacecraft in frame, true to the reference. No Earth, no stars.
- **fritillary** (1:1): A great spangled fritillary butterfly (Speyeria cybele) perched on the tip of a short bare twig with its wings closed upright, seen side-on to show the underside: the hindwing warm cinnamon-brown with a broad pale buff band near the edge and rows of large bright silver-white spots, the forewing orange with black marks and a pale tip, black antennae with clubbed tips, slender legs, the whole butterfly in frame, true to the species. No flowers, no grass.
- **hope** (1:1): The Hope Diamond pendant as it is shown at the Smithsonian: a large deep-blue antique cushion-cut diamond set in a pendant and surrounded by a ring of sixteen white diamonds, hanging from a short length of its diamond chain at the top, platinum setting, real faceting and sparkle without glare, the whole pendant in frame, true to the reference. No display case.
- **telegraph** (3:2): A 19th-century Morse telegraph key: a dark iron lever arm with a round black knob at the front, brass pivot posts, an adjusting screw and spring, mounted on a worn, warm-toned wooden base with brass binding-post terminals and screws, seen in three-quarter view, the whole key in frame, true to the antique in the reference.
- **kilogram** (3:4): The U.S. national prototype kilogram, K20, as kept at NIST: a small polished platinum-iridium cylinder with softly rounded edges, about as tall as it is wide, standing on a small metal plate under two nested clear glass bell jars with knob handles, on a round polished metal base, the whole object in frame, true to the reference.
- **mosquito** (3:2): An Anopheles malaria mosquito (Anopheles stephensi) standing on a plain flat surface in side view, in the typical Anopheles resting posture with the body tilted up at an angle, long slender legs with pale bands, narrow wings with dark and pale spotted scales, the long straight proboscis and palps held forward, a slim pale-banded abdomen, the whole insect in frame, true to the species. No blood, no skin.
- **robot** (3:4): A lightweight seven-joint collaborative robot arm of the kind used in surgical research robots: smooth rounded white and pale-gray segments with slim dark joint rings, standing upright on a round base and bending forward at the elbow, a slim stainless-steel surgical suturing instrument fixed at its tip, seen in side three-quarter view, the whole arm in frame, true to the reference arm's design. No orange parts.
- **brain** (4:3): A real human brain seen from above and to the left, as an anatomy-collection specimen: the full cerebrum with its rounded folds (gyri) and grooves (sulci), the long central fissure between the two hemispheres, pale grayish-beige tissue with faint warm pink tones, clean and dry-looking, the whole brain in frame, true to the reference and to anatomy. No blood, no tray.
- **petri** (1:1): A clear glass petri dish with its lid off, seen from above at a slight angle, holding a layer of pale amber agar with bacterial colonies streaked across it in a lab streak pattern: bright red-orange Serratia colonies dense in one part and fading to separate small round colonies, and one small white paper antibiotic disc with a clear ring around it where no bacteria grow, the whole dish in frame. No text, no labels, no hands.
- **cicada** (3:2): A Brood X periodical cicada (Magicicada) perched on a short bare twig in side view: glossy black body, bright red eyes, clear wings with orange veins folded over the back like a roof, orange legs, the whole insect in frame, true to the species. No leaves, no flowers.
- **apollo** (1:1): The Apollo 11 command module Columbia as it is shown at the National Air and Space Museum: the cone-shaped capsule standing on its base, its outer skin scorched and streaked in browns, tans and dull silver from reentry with bare metal patches, the side hatch and small square windows, the docking tunnel at the top, seen in three-quarter side view, the whole capsule in frame, true to the real spacecraft in the reference.

## Round 6: DMV discoveries for the orbit (Nov 26, 00:31 UTC)

John rejected the round-4 objects and approved a list of ten discoveries or research from D.C.,
Maryland and Virginia (00:19 and 00:23 UTC): DART, Parker Solar Probe, Webb, dark matter
(Andromeda), GPS, HeLa cells, the COVID vaccine spike, the genetic code, the first atomic clock
and the telegraph. Webb and the telegraph were already made (rounds 3 and 4), so eight new
images. Same caps (80 credits for v5, quote first, at most 3 attempts per asset, no video).
Model gpt_image_2_6, quality high, 2k, one image each. References uploaded to Higgsfield
(media id prefix): dart (a6efbd93), parker (44c5387e), andromeda (ef98a7fe), gps (78a7ef47),
hela (18115b5c), spike (dcb7c4c4), clock (7c68c01f, imported by URL); the code chart had no
reference (the real chart's photos are not free to use, so it was drawn from its description).
Sources of the references are in CREDITS.md, round 6.

| # | Date (UTC) | Asset | Job ID | Settings | Quote | Credits |
|---|---|---|---|---|---|---|
| 26 | Nov 26 00:31 | dart, attempt 1 | 0fc27018 | 16:9, ref dart | FjbDz8bU | 2 |
| 27 | Nov 26 00:31 | parker, attempt 1 | c955072c | 1:1, ref parker | B0U4TgW0 | 2 |
| 28 | Nov 26 00:31 | andromeda, attempt 1 | a11d9081 | 1:1, ref andromeda | _lSa4ccU | 2 |
| 29 | Nov 26 00:31 | gps, attempt 1 | f0186b08 | 16:9, ref gps | RJBGUne1 | 2 |
| 30 | Nov 26 00:31 | hela, attempt 1 | eb7f56d7 | 1:1, ref hela | 0jRxIgDJ | 2 |
| 31 | Nov 26 00:31 | spike, attempt 1 | d519580a | 3:4, ref spike (MERS) | AacF6gt6 | 2 |
| 32 | Nov 26 00:31 | clock, attempt 1 | 04f604ad | 4:5, ref clock | 0yu1Qg26 | 2 |
| 33 | Nov 26 00:31 | code, attempt 1 | 84eed3c9 | 2:3, no ref | uyOB2sig | 2 |

**Spent under v5 so far: 68 of 80 credits** (balance 905.86 before this round, 889.86 after).

Checked against the references (Nov 26, 00:33 UTC): all eight kept, no retries. DART: box body
in gold and black blankets, the round antenna, the DRACO camera tube, two long roll-out arrays.
Parker: the white-faced heat shield on top, the body tucked in its shadow, the small angled wings
and the long magnetometer boom. Andromeda: the tilted spiral with a warm core, dust lanes, M32 and
M110, on a round black field (masked to a true circle). GPS: a Block IIF-style body in gold
blanket with its antenna cluster and two blue wings. HeLa: magenta cytoskeleton, cyan nuclei, a
round field (masked to a true circle). Spike: a three-chain printed trimer in coral, blue and
yellow on a wooden base; it is a likeness of a printed SARS-CoV-2 spike, made after the NIAID
MERS print, not a copy of a particular model. Clock: the two-bay gray console with knobs, meters
and a small scope screen, and the big clock on top; the waveguide coil around the dial is not
clearly drawn, so it reads as the 1949 apparatus rather than an exact copy. Code: taped graph
paper, a pencil grid of codons and amino acids, red outlines; the scrawled name at the top reads
"Wirenberg" up close, which is not legible at the 260 px export. Graded cut-outs in
beta/masthead/scene/ (make-scene.py; commands in CREDITS.md).

Asset prompts. DART, Parker, GPS, spike and clock are followed by the shared block of round 3,
verbatim. Andromeda and HeLa use a shorter block (no studio light, "a real astronomical / microscope
photograph", the disc "like a round photographic print"). The code chart uses the shared block
without "Use the reference only…" and with "no printed text" in place of "no text, no letters".
- **dart** (16:9): NASA's DART spacecraft (Double Asteroid Redirection Test), built by the Johns Hopkins Applied Physics Laboratory in Maryland, true to the design in the reference: a compact box-shaped body wrapped in gold and black thermal blankets, the round flat high-gain antenna on one face, the short black telescope tube of the DRACO camera on the front, a small thruster nozzle at the back, and two long, narrow roll-out solar arrays extended out to either side on thin booms, their dark blue-gray cells on a light frame, the arrays angled back in perspective as in the reference, seen in three-quarter view from slightly above, the whole spacecraft including both complete arrays in frame. No asteroid, no stars, no engine plume.
- **parker** (1:1): NASA's Parker Solar Probe, built by the Johns Hopkins Applied Physics Laboratory in Maryland, true to the design in the reference: the thick, round, flat heat shield on top, its sun-facing surface bright white and its edge dark gray carbon foam; tucked in the shield's shadow below it, the spacecraft body wrapped in gold and black thermal blankets with instruments, the two small dark solar array wings angled back from near the shield's rim, the slender antennas and the long thin magnetometer boom reaching out the back, seen in side three-quarter view with the shield tilted slightly toward the camera, the whole spacecraft in frame. No Sun, no flames, no stars.
- **andromeda** (1:1): The Andromeda galaxy (M31) seen through a large telescope, framed as a perfectly round view: one flat, cleanly edged circular disc of deep black night sky filling most of the frame, with the whole galaxy lying diagonally across it, true to the galaxy's real shape and orientation in the reference: a long, tilted spiral with a bright, warm creamy-yellow core, fainter blue-white spiral arms, thin dark brown dust lanes curving along the arms, its small bright companion galaxy M32 just beside the disk and the softer oval companion M110 farther out, a few sharp foreground stars. Natural visible-light colors as in a long-exposure observatory photograph, not the ultraviolet blue of the reference. The round disc is evenly lit and sits on the background like a round photographic print.
- **gps** (16:9): A GPS Block IIF navigation satellite, true to the design in the reference: a boxy body wrapped in crinkled gold thermal blanket, the cluster of navigation antenna elements and small dishes on its Earth-facing underside, and two long rectangular solar array wings with dark blue cells on thin frames extended straight out to either side on short booms, seen in three-quarter view from slightly below, the whole satellite including both complete wings in frame. No Earth, no stars.
- **hela** (1:1): Human HeLa cells in culture seen through a fluorescence microscope, framed as a perfectly round field of view: one flat, cleanly edged circular disc of black background filling most of the frame, covered with dozens of flattened, spreading cells, the fine fibres of their cytoskeleton glowing magenta-pink and their oval nuclei cyan-green, true to the staining, cell shapes and density in the reference, crisp scientific microscopy detail. The round disc is evenly lit and sits on the background like a round photographic print.
- **spike** (3:4): A 3D-printed scientific model of the SARS-CoV-2 spike protein, of the kind printed at the National Institutes of Health, standing upright on a small square wooden base: three intertwined protein chains forming a tall, club-shaped trimer, a wide, lumpy head on top narrowing to a short stalk at the bottom, the bumpy surface of packed atoms and looping strands visible, each of the three chains printed in its own color (warm coral red, deep blue and golden yellow), matte printed plastic with fine layer texture. Made the same way as the printed model in the reference, which shows a related coronavirus spike; the overall form here is the SARS-CoV-2 spike. Seen side-on, the whole model and its base in frame.
- **clock** (4:5): The first atomic clock, built at the National Bureau of Standards in Washington, D.C., in 1948-49, true to the 1949 photograph in the reference: a two-bay steel electronics console painted in gray crackle finish, about chest height, its two front panels full of round black knobs, two square-framed meters, a round dial and a small round oscilloscope screen; standing on top, a large round electric clock with a black face and white numerals in a chrome bezel, ringed by a long metal waveguide tube coiled around the dial in several tight loops; a small blank nameplate under the clock. Seen straight-on, the whole console and clock in frame, as a color museum photograph of the real apparatus (the reference is black and white).
- **code** (2:3): Marshall Nirenberg's handwritten genetic code chart from 1961-66, the working chart from his National Institutes of Health lab: a long chart made of several sheets of graph paper taped together edge to edge, the old tape seams yellowed, the paper aged to a warm cream with faint pale green grid lines, soft creases and slightly dog-eared corners; a hand-ruled grid with the 20 amino acids written in a row across the top in pencil, the 64 three-letter RNA codons written down the left side, tiny handwritten pencil numbers filling the cells, a few blocks outlined in red pencil, a scrawled signature at the top. Shown whole as a museum object, lying almost flat with its bottom end gently curling up, seen from above at a slight angle, the whole chart in frame.


## Round 7: ten more DMV discoveries (Nov 26, 01:29 UTC)

John asked for ten more (01:20 UTC): "find another 10 cool things please that are really cool and
add them as well". The bank now holds twenty. Four of the ten reuse images made earlier, so only
six new images were needed and the v5 cap holds: Hubble (`hubble.webp`), the kilogram
(`kilogram.webp`), the STAR robot surgeon (`robot.webp`) and Dragonfly (`dragonfly.webp`), all
from round 4. Same caps (80 credits for v5, quote first, at most 3 attempts per asset, no video).
Model gpt_image_2_6, quality high, 2k, one image each.

| # | Date (UTC) | Asset | Job ID | Settings | Quote | Credits |
|---|---|---|---|---|---|---|
| 34 | Nov 26 01:29 | vanguard, attempt 1 | db69c4f0 | 1:1, ref vanguard | 5KfymxtheF | 2 |
| 35 | Nov 26 01:29 | phobos, attempt 1 | bae35056 | 1:1, ref phobos | WNvCjBNF | 2 |
| 36 | Nov 26 01:29 | newhorizons, attempt 1 | bdb7864e | 4:3, ref newhorizons | eflCT9oY | 2 |
| 37 | Nov 26 01:29 | aerodrome, attempt 1 | 2da93618 | 3:2, ref aerodrome | mEWNfPHJ | 2 |
| 38 | Nov 26 01:29 | photophone, attempt 1 | c92c79f1 | 3:4, ref photophone | Qeom2WJJ | 2 |
| 39 | Nov 26 01:29 | hpv, attempt 1 | bebdb969 | 1:1, no ref | u2nQgfzp | 2 |

**Spent under v5: 80 of 80 credits. The cap is now fully used** (balance 889.86 before this
round, 877.86 after, checked Nov 26 after the jobs finished).

Checked against the references (Nov 26, 01:31 UTC): all six kept, no retries. Vanguard: the
small polished sphere with dark solar cells and long angled rod antennas. Phobos: the lumpy,
cratered potato shape with Stickney and the grooves, lit from the upper left. New Horizons: the
gold-blanketed body, the big white dish on top and the black finned power unit on its arm (the
reference drawing's label was painted out before upload). Aerodrome: the tandem pairs of
ribbed fabric wings, the brass engine in the open body, the two propellers and the cross tail.
Photophone: the silvered dish on a slim iron tripod stand, the cell at its focus and the cord.
HPV: a coral and teal printed particle of five-lobed knobs on a small wooden stand; it is a
likeness of an NIH-style printed model, made from a description, not a copy of a particular
model. Graded cut-outs in beta/masthead/scene/ (make-scene.py; commands in CREDITS.md).

Asset prompts. The first five are followed by the shared block of round 3, verbatim. HPV has no
reference, so its prompt uses the shared block without the first sentence ("Use the reference
only…").
- **vanguard** (1:1): The Vanguard 1 satellite, designed and built at the Naval Research Laboratory in Washington, D.C., in 1958, true to the unit in the reference: a small polished aluminum sphere about six and a half inches across with a bright, softly reflective metal finish, small dark square solar cells set into its surface, a few small fittings around its middle, and long, thin, straight metal rod antennas sticking out from it at angles as in the reference, seen in three-quarter view, the whole satellite including the full length of every antenna in frame. No Earth, no stars.
- **phobos** (1:1): Mars's moon Phobos, true to the spacecraft color photograph in the reference: a lumpy, potato-shaped small moon of dusty reddish-gray and tan rock, covered in craters of every size, the huge crater Stickney on one side, and fine parallel grooves running across the surface, shown whole as a real object, lit from the upper left so its lumpy shape and craters show clearly, the whole moon in frame. No Mars, no stars.
- **newhorizons** (4:3): NASA's New Horizons spacecraft, designed and built at the Johns Hopkins Applied Physics Laboratory in Maryland, true to the design in the reference drawing but as the real flight hardware: a flat, roughly triangular body about the size of a grand piano wrapped in gold thermal blanket with black panels, a large white dish antenna about seven feet across mounted on top facing up, a small antenna on a tripod above the dish, the black finned cylinder of its nuclear power unit sticking out from one corner on a short mount, small instruments and round sensor ports on the sides, seen in three-quarter view from slightly above, the whole spacecraft in frame. No Pluto, no stars.
- **aerodrome** (3:2): Samuel Langley's Aerodrome No. 5 of 1896, the steam-powered model flying machine kept at the Smithsonian's National Air and Space Museum, true to the parts shown in the reference: a slim, pointed metal body with a polished brass and copper steam engine and boiler visible in its open frame, two pairs of large white fabric wings with thin wooden ribs, one pair at the front and one pair behind it in tandem, both spread wide and flat like a dragonfly's, two wooden propellers on either side of the body between the wing pairs, and a cross-shaped white fabric tail at the back, all held together with thin wire bracing. Seen whole in a front three-quarter view from slightly below, floating freely, the whole machine including every wingtip and the tail in frame. No ceiling, no hanging wires, no water.
- **photophone** (3:4): Alexander Graham Bell's photophone receiver of 1880, true to the instrument in the engraving in the reference, as a real 19th-century scientific instrument in a museum: a large, shallow parabolic reflector of polished silvered brass about two feet across, mounted on a slender dark iron stand with a tripod foot, a small round selenium cell held at the focus in the middle of the dish, and a thin cloth-covered cord running from it, the reflector tilted slightly toward the camera, seen in three-quarter view, the whole instrument in frame. Leave out the people, the battery box and the garden of the engraving.
- **hpv** (1:1): A 3D-printed scientific model of a human papillomavirus particle, the empty virus-like shell used in HPV vaccines, of the kind printed at the National Institutes of Health: a round ball built from 72 raised, star-shaped, five-lobed protein knobs packed in an even icosahedral pattern, each knob a small five-pointed rosette, the bumpy surface detailed and crisp, matte printed plastic with fine layer texture, the knobs a soft coral pink and the gaps between them deep teal, the ball resting on a small round wooden stand. Seen straight-on, the whole model and its stand in frame.
