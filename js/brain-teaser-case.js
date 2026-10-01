/* ════════════════════════════════════════════════════════════════════
   THE CATALYST VAULT — the case file
   ────────────────────────────────────────────────────────────────────
   This is the ONLY file to edit when the brain teaser changes.

   New case, step by step:
     1. Move the current case into ARCHIVE (top of the list), with its
        answer written out in `answer` and `explain`.
     2. Fill in CASE below: number, codename, dates, clues, answer.
     3. Answer: the page never stores it in plain text. Open
        /brain-teaser, open the browser console and run
            await CatalystVault.hash('your answer')
        then paste the result into `answer.hashes` (add one hash per
        accepted spelling for a word answer).
     4. Solution text shown after the attempt: run
            CatalystVault.encode('The answer was <strong>…</strong>')
        and paste it into `solution64`.
     5. Bump `storageKey` (e.g. 'case-05') so everyone gets a fresh
        attempt, and set `nextDropAt` to roughly two weeks out.

   answer.type:
     'code'  → a numeric lock (set `length`); the vault rings turn.
     'text'  → a passphrase (any word or number); matched without
               case, spaces or punctuation.
   ════════════════════════════════════════════════════════════════════ */

window.CATALYST_CASE = {
  number: 4,
  codename: 'Operation Silent River',
  classification: 'Top Secret // Eyes Only',
  releasedAt: '2026-09-28',
  nextDropAt: '2026-10-12T14:00:00Z',

  brief: 'Four intercepted riddles guard the Winners’ Lounge. Each resolves to a single English word — and the <strong>number of letters</strong> in that word is that dial’s digit. Read the four dials in order. <strong>One attempt.</strong>',

  clues: [
    { tag: 'Intercept 01', text: 'The one who makes me has no need of me. The one who buys me will never use me. The one who uses me will never see me — nor know that I <em>hold</em> them.' },
    { tag: 'Intercept 02', text: 'I have no mouth, yet I answer every call in the caller’s <em>own</em> voice. Born of stone and distance, I live a single moment — and I die if you stand too close.' },
    { tag: 'Intercept 03', text: 'Every creature can make me, yet none may keep me while speaking of me. The instant I am <em>named</em> aloud, I am broken.' },
    { tag: 'Intercept 04', text: 'I wear a bed I never sleep in, keep a mouth that never speaks, hold banks that store no coin — and the greatest of my kind <em>split</em> continents.' }
  ],

  answer: {
    type: 'code',
    length: 4,
    hashes: ['a7b2c0f85074def3fe9a2bd5f37564bb1622b529e0ac43d7a1fe120763147b7c']
  },
  solution64: 'SW50ZXJjZXB0Jm5ic3A7MDEgaXMgYSA8c3Ryb25nPmNvZmZpbjwvc3Ryb25nPiAoNiBsZXR0ZXJzKSwgMDIgYW4gPHN0cm9uZz5lY2hvPC9zdHJvbmc+ICg0KSwgMDMgPHN0cm9uZz5zaWxlbmNlPC9zdHJvbmc+ICg3KSwgMDQgYSA8c3Ryb25nPnJpdmVyPC9zdHJvbmc+ICg1KS4gVGhlIGNvZGUgd2FzIDxzdHJvbmc+NjQ3NTwvc3Ryb25nPi4=',

  // Kept from the previous page so returning players keep their result.
  storageKey: 'v7',
  winnersUrl: '/q7x9m2k5p8wl4n6r1t3vb'
};

/* Past cases, newest first. Shown as "Declassified". */
window.CATALYST_ARCHIVE = [
  {
    number: 3, codename: 'Four Sealed Dials', kind: 'Number cipher',
    prompt: 'Days in a week, notes in an octave, wonders of the ancient world · the largest digit whose square’s digits add back to itself · the smallest perfect number · two squared, and the sides of a square.',
    answer: '7964',
    explain: '7 · 9 (81 → 8 + 1) · 6 (1 + 2 + 3) · 4.'
  },
  {
    number: 2, codename: 'The Endless Letter', kind: 'Riddle',
    prompt: 'I am the beginning of eternity, the end of time and space, the beginning of every end, and the end of every place. What am I?',
    answer: 'The letter E',
    explain: 'E begins “eternity”, ends “time”, “space” and “place”, and begins “end”.'
  },
  {
    number: 1, codename: 'The Exponential Sequence', kind: 'Sequence',
    prompt: '3, 7, 15, 31, 63, … what comes next?',
    answer: '127',
    explain: 'Each term doubles and adds one (2ⁿ⁺¹ − 1): 63 × 2 + 1 = 127.'
  }
];
