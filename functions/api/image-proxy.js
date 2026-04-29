// GET /api/image-proxy?url=<encoded-url>[&w=560][&q=80]
// Proxies an image from an external CDN (Wix, Firebase, etc.) so:
//   1. Dashboard Canvas can drawImage() across origins without taint
//   2. Newsletter <img> tags get a stable, cacheable URL on our own domain
//      (Gmail's image proxy + Cloudflare's edge cache both cache aggressively
//       only when the response sets long-lived public Cache-Control)
//
// Only allows fetching from approved hostnames to prevent open-proxy abuse.

const ALLOWED_HOSTS = [
  "static.wixstatic.com",
  "images.unsplash.com",
  "firebasestorage.googleapis.com",
  "firebasestorage.app",          // new Firebase Storage domain (*.firebasestorage.app)
  "storage.googleapis.com",       // GCS direct URLs
  "upload.wikimedia.org",         // Wikipedia article images
  "commons.wikimedia.org",        // Wikimedia Commons
  "en.wikipedia.org",             // Wikipedia thumbnails
  "wikipedia.org",                // Any Wikipedia subdomain
];

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

export const onRequestGet = async ({ request }) => {
  const { searchParams } = new URL(request.url);
  const raw = searchParams.get("url");

  if (!raw) {
    return new Response("Missing url param", { status: 400 });
  }

  // searchParams.get() already URL-decodes once — do NOT call decodeURIComponent again
  // or double-encoded paths like %252F get corrupted to %2F then /.
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return new Response("Invalid url param", { status: 400 });
  }

  if (!ALLOWED_HOSTS.some((h) => parsed.hostname === h || parsed.hostname.endsWith(`.${h}`))) {
    return new Response(`Host not allowed: ${parsed.hostname}`, { status: 403 });
  }

  const wRaw = searchParams.get("w");
  const qRaw = searchParams.get("q");
  const width = wRaw ? clamp(parseInt(wRaw, 10) || 0, 64, 2048) : 0;
  const quality = qRaw ? clamp(parseInt(qRaw, 10) || 0, 40, 95) : 82;
  const wantResize = width > 0;

  // Try Cloudflare Image Resizing if a width was requested. cf.image is a
  // no-op (returns original bytes) on plans where Image Resizing isn't
  // enabled — but on Pages it throws. We try it, and on any failure fall
  // back to the un-transformed origin fetch.
  let upstream;
  if (wantResize) {
    try {
      upstream = await fetch(parsed.toString(), {
        headers: { "User-Agent": "CatalystMagazine/1.0 ImageProxy" },
        cf: {
          image: { width, quality, fit: "scale-down", format: "auto" },
        },
      });
      if (!upstream.ok) throw new Error(`status ${upstream.status}`);
    } catch {
      upstream = null;
    }
  }
  if (!upstream) {
    upstream = await fetch(parsed.toString(), {
      headers: { "User-Agent": "CatalystMagazine/1.0 ImageProxy" },
    });
  }

  if (!upstream.ok) {
    const body = await upstream.text().catch(() => "");
    return new Response(`Upstream ${upstream.status}: ${body.slice(0, 200)}`, { status: 502 });
  }

  const contentType = upstream.headers.get("content-type") || "image/jpeg";
  const body = await upstream.arrayBuffer();

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Access-Control-Allow-Origin": "*",
      // 1 year, immutable — newsletters reference a stable URL that never
      // changes content. This lets Gmail's image proxy cache the bytes
      // forever, so reopening or forwarding the email is instant.
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
};

export const onRequestOptions = () =>
  new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Max-Age": "86400",
    },
  });
