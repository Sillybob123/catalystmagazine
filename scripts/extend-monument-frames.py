#!/usr/bin/env python3
"""
extend-monument-frames.py
─────────────────────────────────────────────────────────────────────────────
Extends the hero-frames sequence by PREPENDING N new frames in which the
Washington Monument slides progressively further right, anchoring at the
image's right edge — mirroring how the Capitol anchors at the left edge.

Why prepend (not append)?
  The JS scrubs the sequence BACKWARD (from FRAME_COUNT-1 → 0) because
  capital.mp4 plays "parted → unified". So the LAST frame visually shown
  (and frozen as the page-wide backdrop) corresponds to ARRAY INDEX 0 —
  i.e., frame_0001.webp. To extend past that, the new "even more parted"
  frames must occupy array indices 0..N-1, which means renumbering the
  existing 192 frames upward by N.

What this script does
  1. Reads the current frame_0001 (the existing "most parted" frame from
     capital.mp4) — uses it as the slide base.
  2. Renames every existing frame_NNNN.webp → frame_(NNNN+N).webp.
  3. Writes N new frames as frame_0001..frame_NNNN, where:
       frame_NNNN = least extra slide (matches old frame_0001 closely)
       frame_0001 = most extra slide (monument anchored at far right edge)
  4. Reports the new total count for FRAME_COUNT in index_backup.html.

Idempotent? No — running twice will double-prepend. The script refuses
to run if frame_0001's right edge already lies within --threshold pixels
of the image's right edge (i.e., the slide has already been applied).

Run:
  python3 scripts/extend-monument-frames.py            # default 48 new frames
  python3 scripts/extend-monument-frames.py --count 60 # custom
"""

from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

import numpy as np
from PIL import Image


FRAMES_DIR    = Path('public/assets/hero-frames')
FRAME_PREFIX  = 'frame_'
FRAME_EXT     = '.webp'
FRAME_PAD     = 4

# Match scripts/extract-hero-frames.js (libwebp at q=86, method=6)
WEBP_QUALITY  = 92
WEBP_METHOD   = 6


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    p.add_argument('--count', type=int, default=48,
                   help='Number of new frames to prepend (default: 48).')
    p.add_argument('--ease', choices=['linear', 'ease-out', 'ease-in-out'], default='ease-in-out',
                   help='Slide easing curve. ease-in-out (default) gives a soft start AND a soft '
                        'arrival at the right edge.')
    p.add_argument('--threshold', type=int, default=80,
                   help='Refuse to run if frame_0001 monument-right is already within this many px '
                        'of the image right edge (default: 80) — prevents double-prepending.')
    p.add_argument('--gap-midpoint', type=int, default=None,
                   help='Column to use as the split between Capitol (left, fixed) and Monument '
                        'slab (right, moving). Auto-detected if omitted.')
    p.add_argument('--max-shift', type=int, default=None,
                   help='Cap the maximum monument-shift (in source pixels) below the natural '
                        'headroom. Use a small value (e.g. 120) for a subtle bounce-in intro. '
                        'Default: full headroom (monument lands at the right edge).')
    return p.parse_args()


def list_existing_frames() -> list[Path]:
    files = sorted(FRAMES_DIR.glob(f'{FRAME_PREFIX}*{FRAME_EXT}'))
    return [f for f in files if f.stem.removeprefix(FRAME_PREFIX).isdigit()]


def detect_gap_midpoint(arr: np.ndarray) -> int:
    gray = arr.mean(axis=2)
    col_has_content = (gray < 240).any(axis=0)
    diffs = np.diff(col_has_content.astype(int))
    starts = np.where(diffs == -1)[0]
    ends   = np.where(diffs ==  1)[0]
    gaps: list[tuple[int, int, int]] = []
    for s in starts:
        cand = ends[ends > s]
        if cand.size:
            e = int(cand[0])
            gaps.append((int(s) + 1, e, e - int(s)))
    if not gaps:
        raise SystemExit('Could not find a gap between Capitol and Monument.')
    gaps.sort(key=lambda g: -g[2])
    s, e, _ = gaps[0]
    return (s + e) // 2


def detect_paper_color(arr: np.ndarray) -> tuple[int, int, int]:
    H, W, _ = arr.shape
    strip = arr[: H // 8, :, :].reshape(-1, 3)
    lum = strip.mean(axis=1)
    bright = strip[np.argsort(lum)[-len(strip) // 4 :]]
    paper = np.median(bright, axis=0).astype(int)
    return tuple(int(v) for v in paper)


def ease_curve(t: float, kind: str) -> float:
    if kind == 'linear':
        return t
    if kind == 'ease-out':
        return 1.0 - (1.0 - t) ** 3
    if kind == 'ease-in-out':
        return 0.5 - 0.5 * float(np.cos(np.pi * t))
    return t


def renumber_existing(existing: list[Path], shift: int) -> None:
    """Shift every existing frame number UP by `shift`. Done last-to-first
    to avoid clobbering. Uses a temp suffix for absolute safety."""
    # Phase 1: rename foo.webp → foo.webp.tmp (so no collisions with new names)
    tmps: list[tuple[Path, Path]] = []
    for p in existing:
        tmp = p.with_suffix(p.suffix + '.tmp')
        p.rename(tmp)
        tmps.append((tmp, p))

    # Phase 2: rename tmp → final shifted name
    for tmp, original in tmps:
        n = int(original.stem.removeprefix(FRAME_PREFIX))
        new_name = f'{FRAME_PREFIX}{n + shift:0{FRAME_PAD}d}{FRAME_EXT}'
        tmp.rename(original.parent / new_name)


def main() -> int:
    args = parse_args()

    if not FRAMES_DIR.exists():
        print(f'[extend] frames dir not found: {FRAMES_DIR}', file=sys.stderr)
        return 1

    existing = list_existing_frames()
    if not existing:
        print('[extend] no existing frames.', file=sys.stderr)
        return 1

    base_path = FRAMES_DIR / f'{FRAME_PREFIX}0001{FRAME_EXT}'
    if not base_path.exists():
        print(f'[extend] expected base frame missing: {base_path}', file=sys.stderr)
        return 1

    img = Image.open(base_path).convert('RGB')
    arr = np.array(img)
    H, W, _ = arr.shape

    split_col = args.gap_midpoint if args.gap_midpoint is not None else detect_gap_midpoint(arr)
    paper = detect_paper_color(arr)
    print(f'[extend] base: {base_path.name}   {W}×{H}   split col: {split_col}   paper: {paper}')

    slab = arr[:, split_col:, :].copy()
    capitol = arr[:, :split_col, :].copy()
    slab_w = slab.shape[1]

    slab_gray = slab.mean(axis=2)
    slab_cols = np.where((slab_gray < 240).any(axis=0))[0]
    if not slab_cols.size:
        print('[extend] no content found in monument slab.', file=sys.stderr)
        return 1
    mon_right_in_slab = int(slab_cols.max())
    mon_right_in_full = split_col + mon_right_in_slab
    headroom = (W - 1) - mon_right_in_full
    print(f'[extend] monument right edge: col {mon_right_in_full}   headroom: {headroom}px')

    if headroom <= args.threshold:
        print(f'[extend] frame_0001 monument-right is already within {args.threshold}px of right edge — '
              f'looks like the slide was already applied. Skipping.', file=sys.stderr)
        return 0

    # Apply --max-shift cap if provided, so callers can request a subtle
    # bounce-in (e.g. 120px) instead of the full headroom slide.
    effective_shift = headroom if args.max_shift is None else min(args.max_shift, headroom)
    if effective_shift != headroom:
        print(f'[extend] capping max shift to {effective_shift}px (headroom is {headroom}px)')

    n = args.count
    print(f'[extend] prepending {n} frames with {args.ease} easing')
    print(f'[extend] renumbering existing {len(existing)} frames: +{n}')

    # ── 1. Shift existing frames up by N ─────────────────────────────────
    renumber_existing(existing, shift=n)

    # ── 2. Write new frames 1..N ──────────────────────────────────────────
    # frame_NNNN = LEAST extra-parted (matches old frame_0001 closely)
    # frame_0001 = MOST extra-parted (monument at far right edge)
    paper_arr = np.array(paper, dtype=arr.dtype)

    for out_idx in range(1, n + 1):
        # Slide amount: out_idx == n → shift = 0 (matches base);
        #               out_idx == 1 → shift = effective_shift (max bounce)
        progress = (n - out_idx) / max(1, n - 1) if n > 1 else 1.0
        eased = ease_curve(progress, args.ease)
        shift_px = int(round(eased * effective_shift))

        frame = np.empty_like(arr)
        frame[:, :split_col, :] = capitol

        if shift_px == 0:
            frame[:, split_col:, :] = slab
        else:
            # Reveal on slab's LEFT — paper fill
            frame[:, split_col : split_col + shift_px, :] = paper_arr
            usable = slab_w - shift_px if (slab_w - shift_px) > 0 else 0
            if usable > 0:
                frame[:, split_col + shift_px : split_col + shift_px + usable, :] = slab[:, :usable, :]

        out_path = FRAMES_DIR / f'{FRAME_PREFIX}{out_idx:0{FRAME_PAD}d}{FRAME_EXT}'
        Image.fromarray(frame, 'RGB').save(
            out_path,
            'WEBP',
            quality=WEBP_QUALITY,
            method=WEBP_METHOD,
        )
        if out_idx == 1 or out_idx == n or out_idx % 8 == 0:
            print(f'  [{out_idx:3d}/{n}]  shift={shift_px:>4d}px  →  {out_path.name}')

    new_total = len(existing) + n
    final_size = sum(p.stat().st_size for p in FRAMES_DIR.glob(f'{FRAME_PREFIX}*{FRAME_EXT}'))
    print()
    print(f'[extend] ✓ done.')
    print(f'[extend] new total: {new_total} frames · {final_size / 1024 / 1024:.2f} MB')
    print(f'[extend] update index_backup.html: var FRAME_COUNT = {new_total};')
    return 0


if __name__ == '__main__':
    sys.exit(main())
