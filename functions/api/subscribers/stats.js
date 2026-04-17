// GET /api/subscribers/stats
// Returns marketing-relevant counts derived from Firestore.

import { json, serverError } from "../../_utils/http.js";
import { firestoreRunQuery } from "../../_utils/firebase.js";
import { requireRole } from "../../_utils/auth.js";

export const onRequestGet = async ({ request, env }) => {
  try {
    const auth = await requireRole(request, env, ["admin", "marketing", "newsletter_builder"]);
    if (auth instanceof Response) return auth;

    // Pull all subscribers (we cap at 5k to be safe — replace with paging if we grow past that).
    const subs = await firestoreRunQuery(env, {
      from: [{ collectionId: "subscribers" }],
      limit: 5000,
    });

    // Pull collaboration requests.
    const collabs = await firestoreRunQuery(env, {
      from: [{ collectionId: "collaboration_requests" }],
      limit: 1000,
    });

    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const week = now - 7 * dayMs;
    const month = now - 30 * dayMs;

    let total = 0;
    let active = 0;
    let unsubscribed = 0;
    let new7 = 0;
    let new30 = 0;
    const growthByDay = {}; // yyyy-mm-dd -> count

    for (const s of subs) {
      total++;
      const status = s.data.status || "active";
      if (status === "active") active++;
      else if (status === "unsubscribed") unsubscribed++;

      const created = parseTs(s.data.createdAt);
      if (created) {
        if (created >= week) new7++;
        if (created >= month) new30++;
        const day = new Date(created).toISOString().slice(0, 10);
        growthByDay[day] = (growthByDay[day] || 0) + 1;
      }
    }

    // Build sparkline series (last 30 days).
    const series = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now - i * dayMs).toISOString().slice(0, 10);
      series.push({ date: d, count: growthByDay[d] || 0 });
    }

    const collabList = collabs
      .map((c) => ({
        id: c.id,
        name: c.data.name || "",
        email: c.data.email || "",
        role: c.data.role || c.data.interest || "",
        message: c.data.message || "",
        createdAt: c.data.createdAt || "",
      }))
      .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));

    return json({
      ok: true,
      stats: {
        total,
        active,
        unsubscribed,
        new7,
        new30,
        collaborations: collabList.length,
      },
      series,
      collaborations: collabList.slice(0, 100),
    });
  } catch (err) {
    return serverError(err);
  }
};

function parseTs(s) {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}
