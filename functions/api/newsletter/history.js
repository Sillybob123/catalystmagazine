// GET /api/newsletter/history
// Lists recent newsletter campaigns (most recent first).

import { json, serverError } from "../../_utils/http.js";
import { firestoreRunQuery } from "../../_utils/firebase.js";
import { requireRole } from "../../_utils/auth.js";

export const onRequestGet = async ({ request, env }) => {
  try {
    const auth = await requireRole(request, env, ["admin", "newsletter_builder", "marketing"]);
    if (auth instanceof Response) return auth;

    const rows = await firestoreRunQuery(env, {
      from: [{ collectionId: "newsletter_campaigns" }],
      orderBy: [{ field: { fieldPath: "createdAt" }, direction: "DESCENDING" }],
      limit: 50,
    });

    const campaigns = rows.map((r) => ({
      id: r.id,
      subject: r.data.subject,
      status: r.data.status,
      recipientCount: r.data.recipientCount || 0,
      sentCount: r.data.sentCount || 0,
      createdAt: r.data.createdAt,
      sentAt: r.data.sentAt,
      createdBy: r.data.createdByName || r.data.createdBy,
    }));

    return json({ ok: true, campaigns });
  } catch (err) {
    return serverError(err);
  }
};
