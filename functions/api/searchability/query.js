// POST /api/searchability/query
// Proxies Google Search Console searchAnalytics/query requests.
// Auth: Cloudflare secret GSC_OAUTH (JSON with client_id, client_secret,
//       refresh_token, token_uri) is exchanged for a short-lived access token
//       on each cold start; the token is cached in module scope (~50 min).
//
// Body: { startDate, endDate, type, rowLimit?, searchType? }
//   type: "overview" | "queries" | "pages" | "countries" | "devices" |
//         "dates" | "searchAppearance"
//   searchType: "web" | "image" | "video" | "news" | "discover" (default "web")

import { json, badRequest, serverError } from "../../_utils/http.js";
import { requireRole } from "../../_utils/auth.js";

const SITE_URL = "sc-domain:catalyst-magazine.com";
const GSC_BASE = "https://searchconsole.googleapis.com/webmasters/v3";

// Module-level token cache — survives for the life of the worker instance.
let cachedToken = null;
let tokenExpiresAt = 0;

async function getAccessToken(env) {
  if (cachedToken && Date.now() < tokenExpiresAt - 60_000) return cachedToken;

  const creds = JSON.parse(env.GSC_OAUTH);
  const body = new URLSearchParams({
    client_id: creds.client_id,
    client_secret: creds.client_secret,
    refresh_token: creds.refresh_token,
    grant_type: "refresh_token",
  });

  const res = await fetch(creds.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Token refresh failed (${res.status}): ${err}`);
  }

  const data = await res.json();
  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + (data.expires_in || 3600) * 1000;
  return cachedToken;
}

// type → GSC dimension array
const DIMENSION_MAP = {
  overview:         [],
  queries:          ["query"],
  pages:            ["page"],
  countries:        ["country"],
  devices:          ["device"],
  dates:            ["date"],
  searchAppearance: ["searchAppearance"],
  // Combined dims for richer insights
  queryByDevice:    ["query", "device"],
  pageByDate:       ["page", "date"],
};

async function gscFetch(env, requestBody) {
  const token = await getAccessToken(env);
  const encoded = encodeURIComponent(SITE_URL);
  const url = `${GSC_BASE}/sites/${encoded}/searchAnalytics/query`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  if (!res.ok) {
    const err = await res.text();
    if (res.status === 401) { cachedToken = null; tokenExpiresAt = 0; }
    const e = new Error(`GSC API error (${res.status}): ${err}`);
    e.status = res.status;
    throw e;
  }

  return res.json();
}

export const onRequestPost = async ({ request, env }) => {
  try {
    const auth = await requireRole(request, env, ["admin", "marketing"]);
    if (auth instanceof Response) return auth;

    if (!env.GSC_OAUTH) {
      return json({ ok: false, error: "GSC_OAUTH secret not configured." }, { status: 503 });
    }

    let body;
    try { body = await request.json(); }
    catch { return badRequest("Invalid JSON body"); }

    const {
      startDate,
      endDate,
      type = "overview",
      rowLimit = 10,
      searchType = "web",
      compareStartDate,
      compareEndDate,
    } = body;

    if (!startDate || !endDate) return badRequest("startDate and endDate are required");

    const dimensions = DIMENSION_MAP[type] ?? DIMENSION_MAP.overview;
    const safeLimit  = Math.min(Math.max(1, rowLimit), 1000);

    const mainBody = {
      startDate,
      endDate,
      rowLimit: safeLimit,
      searchType,
      ...(dimensions.length ? { dimensions } : {}),
    };

    // Optional comparison range — runs in parallel for period-over-period deltas.
    const promises = [gscFetch(env, mainBody)];
    if (compareStartDate && compareEndDate) {
      promises.push(gscFetch(env, {
        startDate: compareStartDate,
        endDate:   compareEndDate,
        rowLimit:  safeLimit,
        searchType,
        ...(dimensions.length ? { dimensions } : {}),
      }));
    }

    const [main, compare] = await Promise.all(promises);

    return json({
      ok: true,
      type,
      rows: main.rows || [],
      compareRows: compare?.rows || null,
    });
  } catch (err) {
    if (err.status === 401 || err.status === 403) {
      return json({ ok: false, error: err.message }, { status: err.status });
    }
    return serverError(err);
  }
};
