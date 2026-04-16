// functions/_utils/http.js
// Small helpers so every function doesn't reinvent JSON responses + CORS.

export function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...(init.headers || {}),
    },
  });
}

export function badRequest(message, details) {
  return json({ ok: false, error: message, details }, { status: 400 });
}
export function unauthorized(message = "Unauthorized") {
  return json({ ok: false, error: message }, { status: 401 });
}
export function serverError(err) {
  console.error("Server error:", err);
  return json(
    { ok: false, error: "Internal server error", message: err?.message },
    { status: 500 }
  );
}

export function corsHeaders(origin = "*") {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

export function handleOptions(request) {
  const origin = request.headers.get("Origin") || "*";
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

// Very small rate-limit helper backed by Cloudflare KV.
// Will silently no-op if the KV binding is not set.
export async function rateLimit(env, key, { limit = 10, windowSeconds = 60 } = {}) {
  if (!env.RATE_LIMIT_KV) return { ok: true, skipped: true };
  const bucketKey = `rl:${key}:${Math.floor(Date.now() / 1000 / windowSeconds)}`;
  const current = parseInt((await env.RATE_LIMIT_KV.get(bucketKey)) || "0", 10);
  if (current >= limit) return { ok: false };
  await env.RATE_LIMIT_KV.put(bucketKey, String(current + 1), {
    expirationTtl: windowSeconds + 5,
  });
  return { ok: true };
}

// Basic email syntax check. Good enough for server-side guardrails.
export function isValidEmail(email) {
  return typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

export function getBearerToken(request) {
  const h = request.headers.get("Authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}
