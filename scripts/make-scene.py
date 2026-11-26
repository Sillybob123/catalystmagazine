#!/usr/bin/env python3
"""Make one element of the home-new.html band scene ("Science orbits the Capital").

cutout -> resize -> one shared grade -> grain -> export (WebP with alpha)

    python3 scripts/make-scene.py SRC OUT.webp --size 560 [options]

Every element of the scene goes through the same grade, so the six read as one
late-afternoon shoot: the same warm white balance, the same soft contrast curve,
the same sharpness and the same very fine grain. Only the cutout differs.

  SRC            a reference photo or a generated image (see beta/masthead/CREDITS.md
                 and GENERATIONS.md)
  OUT.webp       beta/masthead/scene/<name>.webp, at 2x its display size
  --size N       longest side of the export, in px
  --crop a,b,c,d crop first: left,top,right,bottom in px or as fractions (all <= 1)
  --model M      rembg model (default birefnet-general)
  --mask F       grayscale mask (white = keep); written there by rembg when missing
  --largest      keep only the largest shape
  --fill         fill holes inside the shape
  --exposure E   brightness offset before the curve, -0.2..0.2 (default 0)
  --sat S        saturation (default 0.88; the shared value)
  --opaque       no cutout: keep the whole (cropped) frame
  --preview      also write OUT.light.png and OUT.dark.png

Uses the cutout helpers in scripts/make-piece.py.
"""
import argparse
import importlib.util
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

_spec = importlib.util.spec_from_file_location('mp', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'make-piece.py'))
mp = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mp)

# ---- the one light (shared by every element) ----
WARM = np.array([1.035, 1.0, 0.935], np.float32)   # ~4500K afternoon sun
LO, HI = 0.07, 0.93                                  # no pure black or white
SOFT = 0.9                                           # contrast kept (1 = as normalised)
NORM = 0.35                                          # how far each image is pulled to the shared range
GRAIN = 0.012


def grade(rgb, a, sat, exposure):
    lum = rgb @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    inside = a > 0.5
    ref = lum[inside] if inside.any() else lum.ravel()
    p0, p1 = np.percentile(ref, 0.8), np.percentile(ref, 99.5)
    n = np.clip((lum - p0) / max(p1 - p0, 1e-3), 0, 1)
    n = np.clip(lum * (1 - NORM) + n * NORM + exposure, 0, 1)   # only part of the way to full range: keep the photo's own light
    n = 0.5 + (n - 0.5) * SOFT                       # soften
    n = mp.s_curve(n, 0.22)                          # a gentle shoulder and toe
    out_l = LO + (HI - LO) * n
    ratio = rgb / np.maximum(lum[..., None], 1e-4)
    ratio = 1 + (ratio - 1) * sat
    return np.clip(out_l[..., None] * ratio * WARM, 0, 1)


def even_sharpness(rgb):
    """the same rendering for all: a slight blur, then a light unsharp mask"""
    soft = np.stack([ndi.gaussian_filter(rgb[..., c], 0.35) for c in range(3)], -1)
    halo = np.stack([ndi.gaussian_filter(soft[..., c], 1.0) for c in range(3)], -1)
    return np.clip(soft + (soft - halo) * 0.35, 0, 1)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('src'); ap.add_argument('out')
    ap.add_argument('--size', type=int, required=True)
    ap.add_argument('--crop'); ap.add_argument('--model', default='birefnet-general'); ap.add_argument('--mask')
    ap.add_argument('--largest', action='store_true'); ap.add_argument('--fill', action='store_true')
    ap.add_argument('--exposure', type=float, default=0.0); ap.add_argument('--sat', type=float, default=0.88)
    ap.add_argument('--opaque', action='store_true'); ap.add_argument('--preview', action='store_true')
    ap.add_argument('--feather', type=float, default=0.7); ap.add_argument('--choke', type=float, default=0.4)
    ap.add_argument('--quality', type=int, default=84); ap.add_argument('--seed', type=int, default=11)
    o = ap.parse_args()

    img = Image.open(o.src).convert('RGB')
    if o.crop:
        img = img.crop(mp.parse_box(o.crop, *img.size))

    if o.opaque:
        a = np.ones((img.size[1], img.size[0]), np.float32)
    else:
        if o.mask and os.path.exists(o.mask):
            m = Image.open(o.mask).convert('L')
            if m.size != img.size:
                m = m.resize(img.size, Image.BICUBIC)
        else:
            m = mp.rembg_mask(img, o.model)
            if o.mask:
                m.save(o.mask)
        a = np.asarray(m, np.float32) / 255.0
        if o.largest:
            lab, n = ndi.label(a > 0.5)
            if n > 1:
                sizes = ndi.sum(np.ones_like(a), lab, range(1, n + 1))
                a = a * ndi.binary_dilation(lab == (int(np.argmax(sizes)) + 1), iterations=3)
        if o.fill:
            a = np.maximum(a, ndi.binary_fill_holes(a > 0.5).astype(np.float32))
        a = np.clip((a - 0.12) / 0.76, 0, 1)

    ys, xs = np.nonzero(a > 0.02)
    if not len(xs):
        sys.exit('empty mask')
    pad = 4
    x0, x1 = max(xs.min() - pad, 0), min(xs.max() + pad + 1, a.shape[1])
    y0, y1 = max(ys.min() - pad, 0), min(ys.max() + pad + 1, a.shape[0])
    rgb = np.asarray(img, np.float32)[y0:y1, x0:x1] / 255.0
    a = a[y0:y1, x0:x1]
    if not o.opaque:
        rgb = mp.decontaminate(rgb, a)

    sc = o.size / max(rgb.shape[:2])
    W, H = max(1, round(rgb.shape[1] * sc)), max(1, round(rgb.shape[0] * sc))
    if sc < 1:
        rgb = np.asarray(Image.fromarray((rgb * 255).astype(np.uint8)).resize((W, H), Image.LANCZOS), np.float32) / 255.0
        a = np.asarray(Image.fromarray((a * 255).astype(np.uint8)).resize((W, H), Image.LANCZOS), np.float32) / 255.0
    else:
        W, H = rgb.shape[1], rgb.shape[0]
        print('note: source is smaller than --size; kept at %dx%d' % (W, H))

    if not o.opaque:
        if o.choke > 0:
            a = np.minimum(a, np.clip(ndi.distance_transform_edt(a > 0.5) - o.choke + 0.5, 0, 1))
        if o.feather > 0:
            a = ndi.gaussian_filter(a, o.feather)
        a = np.clip(a, 0, 1)
        rgb = mp.decontaminate(rgb, a)

    out = even_sharpness(grade(rgb, a, o.sat, o.exposure))
    rng = np.random.default_rng(o.seed)
    L = out.mean(-1)
    g = mp.grain(L.shape, GRAIN, rng) * (0.45 + 2.2 * L * (1 - L))
    out = np.clip(out + g[..., None], LO * 0.8, min(HI + 0.03, 0.97))

    pim = Image.fromarray((np.dstack([out, a]) * 255 + 0.5).astype(np.uint8), 'RGBA')
    os.makedirs(os.path.dirname(os.path.abspath(o.out)), exist_ok=True)
    pim.save(o.out, 'WEBP', quality=o.quality, alpha_quality=92, method=6)
    print('%s  %dx%d  %.1f KB' % (o.out, W, H, os.path.getsize(o.out) / 1024))
    if o.preview:
        base = os.path.splitext(o.out)[0]
        for name, col in (('light', (246, 239, 228)), ('dark', (120, 23, 30))):
            bg = Image.new('RGBA', (W + 40, H + 40), col + (255,))
            bg.alpha_composite(pim, (20, 20))
            bg.convert('RGB').save('%s.%s.png' % (base, name))


if __name__ == '__main__':
    main()
