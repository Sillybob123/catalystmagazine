// POST /api/analytics/visit
// First-party, cookie-free visit geography aggregation.
// Stores daily city totals only. It does not store raw IP addresses, user IDs,
// cookies, or any durable visitor identifier.

import { json, serverError } from "../../_utils/http.js";
import { firestoreCommit, firestoreDocumentName } from "../../_utils/firebase.js";

const GEO_COLLECTION = "site_geo_daily";

export const onRequestPost = async ({ request, env }) => {
  try {
    const cf = request.cf || {};
    const country = cleanCode(cf.country || request.headers.get("CF-IPCountry") || "");
    const city = cleanLabel(cf.city || "");
    const region = cleanLabel(cf.region || "");
    const regionCode = cleanCode(cf.regionCode || "");
    const continent = cleanCode(cf.continent || "");
    const timezone = cleanLabel(cf.timezone || "");
    const latitude = toNumber(cf.latitude);
    const longitude = toNumber(cf.longitude);

    if (!country || country === "T1") {
      return json({ ok: true, recorded: false, reason: "no_geography" });
    }

    let body = {};
    try {
      const text = await request.text();
      body = text ? JSON.parse(text) : {};
    } catch {
      body = {};
    }

    const userAgent = request.headers.get("User-Agent") || "";
    if (looksLikeBot(userAgent)) {
      return json({ ok: true, recorded: false, reason: "bot" });
    }

    const path = cleanPath(body.path || new URL(request.headers.get("Referer") || request.url).pathname);
    if (isIgnoredPath(path)) {
      return json({ ok: true, recorded: false, reason: "ignored_path" });
    }

    const date = new Date().toISOString().slice(0, 10);
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
  return /bot|crawler|spider|preview|slurp|facebookexternalhit|linkedinbot|whatsapp|telegrambot|discordbot/i.test(userAgent);
}

function docPart(value) {
  return String(value || "unknown")
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 72) || "unknown";
}
