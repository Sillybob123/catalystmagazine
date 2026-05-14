// GET /api/analytics/geo
// Returns cookie-free city-level visit aggregates for the dashboard.

import { json, badRequest, serverError } from "../../_utils/http.js";
import { requireRole } from "../../_utils/auth.js";
import { firestoreRunQuery } from "../../_utils/firebase.js";

const GEO_COLLECTION = "site_geo_daily";

export const onRequestGet = async ({ request, env }) => {
  try {
    const auth = await requireRole(request, env, ["admin", "marketing"]);
    if (auth instanceof Response) return auth;

    const url = new URL(request.url);
    const startDate = url.searchParams.get("startDate");
    const endDate = url.searchParams.get("endDate");
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 100), 1), 500);

    if (!isIsoDate(startDate) || !isIsoDate(endDate)) {
      return badRequest("startDate and endDate are required in YYYY-MM-DD format");
    }

    const docs = await firestoreRunQuery(env, {
      from: [{ collectionId: GEO_COLLECTION }],
      where: {
        compositeFilter: {
          op: "AND",
          filters: [
            { fieldFilter: { field: { fieldPath: "date" }, op: "GREATER_THAN_OR_EQUAL", value: { stringValue: startDate } } },
            { fieldFilter: { field: { fieldPath: "date" }, op: "LESS_THAN_OR_EQUAL", value: { stringValue: endDate } } },
          ],
        },
      },
      limit,
    });

    const byPlace = new Map();
    for (const doc of docs) {
      const d = doc.data || {};
      const key = [d.country || "", d.regionCode || d.region || "", d.city || ""].join("|");
      const current = byPlace.get(key) || {
        city: d.city || "Unknown city",
        region: d.region || "",
        regionCode: d.regionCode || "",
        country: d.country || "",
        continent: d.continent || "",
        timezone: d.timezone || "",
        latitude: typeof d.latitude === "number" ? d.latitude : null,
        longitude: typeof d.longitude === "number" ? d.longitude : null,
        views: 0,
        days: 0,
        lastPath: d.lastPath || "",
        lastSeenAt: "",
        firstSeenDate: "",
        recentDays: [],
      };
      current.views += Number(d.views || 0);
      current.days += 1;
      if (d.lastPath) current.lastPath = d.lastPath;
      if (typeof d.latitude === "number") current.latitude = d.latitude;
      if (typeof d.longitude === "number") current.longitude = d.longitude;
      const day = {
        date: d.date || "",
        views: Number(d.views || 0),
        lastPath: d.lastPath || "",
        updatedAt: d.updatedAt || "",
      };
      if (day.date) current.recentDays.push(day);
      if (day.updatedAt && (!current.lastSeenAt || day.updatedAt > current.lastSeenAt)) {
        current.lastSeenAt = day.updatedAt;
      }
      if (day.date && (!current.firstSeenDate || day.date < current.firstSeenDate)) {
        current.firstSeenDate = day.date;
      }
      byPlace.set(key, current);
    }

    // We only require `country` here. The map view filters on lat/lon
    // itself; the States & cities table does not, so dropping rows
    // without coordinates from the API would hide them from the table
    // for no good reason.
    const rows = Array.from(byPlace.values())
      .filter((r) => r.country)
      .map((r) => ({
        ...r,
        recentDays: r.recentDays
          .sort((a, b) => String(b.date).localeCompare(String(a.date)))
          .slice(0, 7),
      }))
      .sort((a, b) => b.views - a.views)
      .slice(0, limit);

    return json({ ok: true, rows });
  } catch (err) {
    if (err.status === 401 || err.status === 403) {
      return json({ ok: false, error: err.message }, { status: err.status });
    }
    return serverError(err);
  }
};

function isIsoDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}
