// GET /api/subscribers/list
// Returns all subscriber records for admin view.

import { json, serverError } from "../../_utils/http.js";
import { firestoreRunQuery } from "../../_utils/firebase.js";
import { requireRole } from "../../_utils/auth.js";

export const onRequestGet = async ({ request, env }) => {
  try {
    const auth = await requireRole(request, env, ["admin", "marketing"]);
    if (auth instanceof Response) return auth;

    const docs = await firestoreRunQuery(env, {
      from: [{ collectionId: "subscribers" }],
      orderBy: [{ field: { fieldPath: "createdAt" }, direction: "DESCENDING" }],
      limit: 5000,
    });

    const subscribers = docs.map((d) => ({
      email: d.data.email || "",
      firstName: d.data.firstName || "",
      lastName: d.data.lastName || "",
      status: d.data.status || "active",
      source: d.data.source || "",
      createdAt: d.data.createdAt || "",
    }));

    return json({ ok: true, subscribers });
  } catch (err) {
    return serverError(err);
  }
};
