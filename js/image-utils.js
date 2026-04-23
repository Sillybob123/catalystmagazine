// Shared image helpers.
// Primary export: convertToWebp(file) — returns a File encoded as image/webp,
// or the original File if the browser can't produce a WebP blob.
//
// We intentionally keep this framework-free so it can be imported from
// both the writer dashboard and the studio editor.

const WEBP_QUALITY = 0.92;            // visually lossless
const MAX_DIMENSION = 3200;           // longest edge — high enough for any web use
const ALREADY_WEBP = /^image\/webp$/i;
const ANIMATED = /^image\/gif$/i;     // canvas re-encode would drop animation — skip

// Downsize + re-encode big uploads. Accept any input size; the canvas pipeline
// handles arbitrarily large images (limited only by browser memory).
// - If the source is already WebP at a reasonable size, ship as-is.
// - If the source is under 2 MB and already small, ship as-is — no point re-encoding.
// - Otherwise re-encode to WebP at quality 0.92, scaled to fit MAX_DIMENSION.
export async function convertToWebp(file) {
  if (!file || !file.type || !file.type.startsWith('image/')) return file;
  if (ANIMATED.test(file.type)) return file;
  // Small already-WebP files are fine as-is.
  if (ALREADY_WEBP.test(file.type) && file.size < 2 * 1024 * 1024) return file;

  try {
    const bitmap = await loadBitmap(file);
    const { width, height } = fitWithin(bitmap.width, bitmap.height, MAX_DIMENSION);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, width, height);

    const blob = await canvasToBlob(canvas, 'image/webp', WEBP_QUALITY);
    if (!blob) return file;
    // Only swap if the re-encoded version is meaningfully smaller or we
    // actually needed to downscale (source dims exceeded MAX_DIMENSION).
    const didResize = bitmap.width > MAX_DIMENSION || bitmap.height > MAX_DIMENSION;
    if (!didResize && blob.size >= file.size) return file;

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
