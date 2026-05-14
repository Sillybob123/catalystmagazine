// POST /api/analytics/visit
// First-party, cookie-free visit geography aggregation.
// Stores daily city totals only. It does not store raw IP addresses, user IDs,
// cookies, or any durable visitor identifier.
//
// Geography source: Cloudflare populates `request.cf` with IP-derived data
// from MaxMind. Fields we use:
//   cf.country     — ISO-3166-1 alpha-2 ("US", "DE"), or "T1" (Tor) / "XX"
//                    (unknown). Falls back to the CF-IPCountry header on
//                    edge configurations where request.cf is omitted.
//   cf.regionCode  — ISO-3166-2 subdivision ("VA", "NY", "DC"). Trustworthy
//                    for US/CA/AU; spotty elsewhere.
//   cf.region      — Human-readable region name. Used as a fallback.
//   cf.city        — City label as MaxMind sees it. Missing for some ISPs.
//   cf.latitude    — City centroid. We require this for map plotting only,
//   cf.longitude     not for the per-place table.
//   cf.timezone    — IANA zone ("America/New_York"). Used for "last seen"
//                    formatting in the panel.
//   cf.continent   — 2-letter continent code.

import { json, serverError } from "../../_utils/http.js";
import { firestoreCommit, firestoreDocumentName } from "../../_utils/firebase.js";

const GEO_COLLECTION = "site_geo_daily";

export const onRequestPost = async ({ request, env }) => {
  try {
    // Defensive — request.cf is normally always present on Cloudflare Pages,
    // but if an edge config or worker chain has stripped it, fail cleanly
    // rather than logging blank rows.
    const cf = request.cf || {};
    const country = cleanCode(cf.country || request.headers.get("CF-IPCountry") || "");

    // Reject obvious noise BEFORE doing anything else (cheap fast path).
    //  - "" / "XX": Cloudflare could not resolve a country (private ranges,
    //               some carrier-grade NAT).
    //  - "T1": Tor exit nodes.
    if (!country || country === "T1" || country === "XX") {
      return json({ ok: true, recorded: false, reason: "no_geography" });
    }

    const userAgent = request.headers.get("User-Agent") || "";
    if (looksLikeBot(userAgent)) {
      return json({ ok: true, recorded: false, reason: "bot" });
    }

    // Speculation Rules / link prefetch hints. Chrome and Edge send these
    // when warming caches before the user actually clicks. Counting them
    // as visits inflates view counts for popular landing pages.
    const purpose = (request.headers.get("Sec-Purpose") || request.headers.get("Purpose") || "").toLowerCase();
    if (purpose.includes("prefetch") || purpose.includes("prerender")) {
      return json({ ok: true, recorded: false, reason: "prefetch" });
    }

    let body = {};
    try {
      const text = await request.text();
      body = text ? JSON.parse(text) : {};
    } catch {
      body = {};
    }

    const path = cleanPath(body.path || new URL(request.headers.get("Referer") || request.url).pathname);
    if (isIgnoredPath(path)) {
      return json({ ok: true, recorded: false, reason: "ignored_path" });
    }

    const city = cleanLabel(cf.city || "");
    const region = cleanLabel(cf.region || "");
    const regionCode = cleanCode(cf.regionCode || "");
    const continent = cleanCode(cf.continent || "");
    const timezone = cleanLabel(cf.timezone || "");
    const latitude = toNumber(cf.latitude);
    const longitude = toNumber(cf.longitude);

    const date = new Date().toISOString().slice(0, 10);
    // Aggregation key: (date, country, region, city). All four go into the
    // doc id so concurrent increments from the same place on the same day
    // converge on the same row. "Unknown" sentinels keep the key shape
    // stable when fields are missing.
    const cityKey = city || "Unknown city";
    const regionKey = regionCode || region || "unknown-region";
    const docId = [date, country, regionKey, cityKey].map(docPart).join("__");
    const docPath = `${GEO_COLLECTION}/${docId}`;
    const now = new Date().toISOString();

    await firestoreCommit(env, [{
      update: {
        name: firestoreDocumentName(env, docPath),
        fields: {
          date: { stringValue: date },
          country: { stringValue: country },
          city: { stringValue: cityKey },
          region: { stringValue: region },
          regionCode: { stringValue: regionCode },
          continent: { stringValue: continent },
          timezone: { stringValue: timezone },
          latitude: latitude == null ? { nullValue: null } : { doubleValue: latitude },
          longitude: longitude == null ? { nullValue: null } : { doubleValue: longitude },
          lastPath: { stringValue: path },
          updatedAt: { timestampValue: now },
        },
      },
      updateMask: {
        fieldPaths: [
          "date", "country", "city", "region", "regionCode", "continent",
          "timezone", "latitude", "longitude", "lastPath", "updatedAt",
        ],
      },
      updateTransforms: [
        { fieldPath: "views", increment: { integerValue: "1" } },
      ],
    }]);

    return json({ ok: true, recorded: true });
  } catch (err) {
    return serverError(err);
  }
};

function cleanLabel(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 96);
}

function cleanCode(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 16);
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function cleanPath(path) {
  const p = String(path || "/").trim();
  const normalized = p.startsWith("/") ? p : `/${p}`;
  return normalized.split(/[?#]/)[0].slice(0, 180) || "/";
}

function isIgnoredPath(path) {
  return (
    path.startsWith("/admin") ||
    path.startsWith("/api") ||
    path.startsWith("/scheduler") ||
    path.includes(".") && /\.(css|js|png|jpe?g|webp|svg|ico|json|txt|xml|map)$/i.test(path)
  );
}

function looksLikeBot(userAgent) {
  if (!userAgent) return true; // no UA == almost certainly automation
  // Generic substrings catch most: googlebot, bingbot, applebot, yandexbot,
  // baiduspider, ahrefsbot, semrushbot, etc. Explicit names cover preview
  // crawlers + tools (curl, wget, python, headless chrome) and meta
  // crawlers that don't include "bot" in their UA.
  return /bot|crawler|spider|preview|slurp|facebookexternalhit|linkedinbot|whatsapp|telegrambot|discordbot|applebot|yandex|baidu|duckduck|petalbot|gptbot|claudebot|chatgpt|anthropic|headlesschrome|phantomjs|puppeteer|playwright|axios|curl\/|wget\/|python-requests|go-http-client|java\/|okhttp/i.test(userAgent);
}

function docPart(value) {
  return String(value || "unknown")
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 72) || "unknown";
}
