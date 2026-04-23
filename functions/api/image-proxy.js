// GET /api/image-proxy?url=<encoded-url>
// Proxies an image from an external CDN (Wix, etc.) and returns it with
// permissive CORS headers so the dashboard Canvas generator can drawImage()
// across origins without taint errors.
//
// Only allows fetching from approved hostnames to prevent open-proxy abuse.

const ALLOWED_HOSTS = [
  "static.wixstatic.com",
  "images.unsplash.com",
  "firebasestorage.googleapis.com",
  "firebasestorage.app",          // new Firebase Storage domain (*.firebasestorage.app)
  "storage.googleapis.com",       // GCS direct URLs
];

export const onRequestGet = async ({ request }) => {
  const { searchParams } = new URL(request.url);
  const raw = searchParams.get("url");

  if (!raw) {
    return new Response("Missing url param", { status: 400 });
  }

  let parsed;
  try {
    parsed = new URL(decodeURIComponent(raw));
  } catch {
    return new Response("Invalid url param", { status: 400 });
  }

  if (!ALLOWED_HOSTS.some((h) => parsed.hostname === h || parsed.hostname.endsWith(`.${h}`))) {
    return new Response(`Host not allowed: ${parsed.hostname}`, { status: 403 });
  }

  const upstream = await fetch(parsed.toString(), {
    headers: { "User-Agent": "CatalystMagazine/1.0 ImageProxy" },
  });

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
      "Cache-Control": "public, max-age=86400, immutable",
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
