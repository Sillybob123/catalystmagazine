// Shared image helpers.
// Primary export: convertToWebp(file) — returns a File encoded as image/webp,
// or the original File if the browser can't produce a WebP blob.
//
// We intentionally keep this framework-free so it can be imported from
// both the writer dashboard and the studio editor.

const WEBP_QUALITY = 0.85;            // visually near-lossless, ~30% smaller than JPEG
const MAX_DIMENSION = 2400;           // longest edge; plenty for full-bleed web covers
const ALREADY_WEBP = /^image\/webp$/i;
const ANIMATED = /^image\/gif$/i;     // canvas re-encode would drop animation — skip

export async function convertToWebp(file) {
  if (!file || !file.type || !file.type.startsWith('image/')) return file;
  if (ALREADY_WEBP.test(file.type)) return file;
  if (ANIMATED.test(file.type)) return file;

  try {
    const bitmap = await loadBitmap(file);
    const { width, height } = fitWithin(bitmap.width, bitmap.height, MAX_DIMENSION);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, width, height);

    const blob = await canvasToBlob(canvas, 'image/webp', WEBP_QUALITY);
    if (!blob) return file;
    if (blob.size >= file.size) return file;  // don't ship a larger file

    const baseName = (file.name || 'image').replace(/\.[^.]+$/, '');
    return new File([blob], `${baseName}.webp`, { type: 'image/webp', lastModified: Date.now() });
  } catch (err) {
    console.warn('[image-utils] WebP conversion failed, sending original', err);
    return file;
  }
}

function fitWithin(w, h, max) {
  if (w <= max && h <= max) return { width: w, height: h };
  const ratio = w >= h ? max / w : max / h;
  return { width: Math.round(w * ratio), height: Math.round(h * ratio) };
}

async function loadBitmap(file) {
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(file); } catch { /* fall through */ }
  }
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}
