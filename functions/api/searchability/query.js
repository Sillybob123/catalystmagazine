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

// Custom error class so the top-level handler can map specific failure modes
// to user-friendly messages and stable HTTP status codes. Each kind below is
// surfaced verbatim in the Searchability dashboard banner so an admin sees
// "your refresh token expired — re-authorize at /admin/setup/gsc" instead of
// a generic "500 Internal Server Error".
class GSCAuthError extends Error {
  constructor(kind, message, { httpStatus = 503, fix } = {}) {
    super(message);
    this.name = "GSCAuthError";
    this.kind = kind;          // "missing_secret" | "malformed_secret" | "refresh_failed" | "refresh_token_expired"
    this.httpStatus = httpStatus;
    this.fix = fix;            // one-line, plain-English remediation step
  }
}

async function getAccessToken(env) {
  if (cachedToken && Date.now() < tokenExpiresAt - 60_000) return cachedToken;

  if (!env.GSC_OAUTH) {
    throw new GSCAuthError(
      "missing_secret",
      "Google Search Console is not configured for this environment.",
      { fix: "Set the GSC_OAUTH secret in Cloudflare Pages → Settings → Environment variables." }
    );
  }

  let creds;
  try {
    creds = JSON.parse(env.GSC_OAUTH);
  } catch {
    throw new GSCAuthError(
      "malformed_secret",
      "GSC_OAUTH secret is not valid JSON.",
      { fix: "In Cloudflare Pages → Settings → Environment variables, replace GSC_OAUTH with the full JSON blob from the OAuth client (client_id, client_secret, refresh_token, token_uri)." }
    );
  }

  if (!creds.client_id || !creds.client_secret || !creds.refresh_token) {
    throw new GSCAuthError(
      "malformed_secret",
      "GSC_OAUTH secret is missing one of: client_id, client_secret, refresh_token.",
      { fix: "Regenerate the OAuth credentials JSON and re-set the GSC_OAUTH secret in Cloudflare Pages." }
    );
  }

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
    const errText = await res.text();
    // Google's most common refresh-token failure modes — surfaced separately
    // so the dashboard can tell admins "go re-grant access" vs "the secret
    // is wrong". The OAuth client being in Testing publishing status is the
    // #1 cause: Google expires those refresh tokens after 7 days, which is
    // why the page "stops working" without anyone touching it.
    const isInvalidGrant =
      res.status === 400 &&
      /invalid_grant|expired|revoked/i.test(errText);

    if (isInvalidGrant) {
      throw new GSCAuthError(
        "refresh_token_expired",
        "The Google Search Console refresh token expired or was revoked.",
        {
          httpStatus: 503,
          fix:
            "Re-grant access: in Google Cloud Console, set the OAuth client's publishing status to \"In production\" (Testing-mode tokens expire every 7 days). Then run the OAuth flow once to mint a new refresh_token and update the GSC_OAUTH secret in Cloudflare Pages.",
        }
      );
    }

    throw new GSCAuthError(
      "refresh_failed",
      `Google rejected the token refresh (HTTP ${res.status}).`,
      {
        httpStatus: 502,
        fix: "Check that the GSC_OAUTH secret in Cloudflare Pages is correct and the OAuth client credentials haven't been rotated or deleted in Google Cloud Console.",
      }
    );
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
    const auth = await requireRole(request, env, ["admin", "marketing", "social_media"]);
    if (auth instanceof Response) return auth;

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
    // Auth / config failures from getAccessToken — return the structured
    // payload so the dashboard can render a useful banner instead of just
    // showing a spinner forever or a generic "500".
    if (err instanceof GSCAuthError) {
      return json({
        ok: false,
        error: err.message,
        kind: err.kind,
        fix: err.fix,
      }, { status: err.httpStatus });
    }
    // GSC API errors (token validated, but Google rejected the query) —
    // typically 401/403 if the token's scopes were revoked.
    if (err.status === 401 || err.status === 403) {
      return json({
        ok: false,
        error: "Search Console access denied.",
        kind: "gsc_api_forbidden",
        fix: "The OAuth token no longer has read access to this Search Console property. Re-grant the 'Search Console (Read-only)' scope and update GSC_OAUTH.",
      }, { status: err.status });
    }
    // Don't leak internal error messages — log server-side only.
    console.error("searchability/query error:", err);
    return json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
};
