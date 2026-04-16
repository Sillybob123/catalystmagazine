// GET /api/health -> { ok: true }
// Sanity-check route you can hit from the browser after deploying.

import { json, serverError } from "../_utils/http.js";

export const onRequestGet = async ({ env }) => {
  try {
    const saRaw = env.FIREBASE_SERVICE_ACCOUNT;
    let saStatus = "missing";
    if (saRaw) {
      try {
        const parsed = typeof saRaw === "string" ? JSON.parse(saRaw) : saRaw;
        saStatus = parsed.project_id ? `ok (${parsed.project_id})` : "set but no project_id";
      } catch {
        saStatus = `set but invalid JSON (starts with: ${String(saRaw).slice(0, 20)}...)`;
      }
    }

    return json({
      ok: true,
      service: "catalyst-magazine",
      project: env.FIREBASE_PROJECT_ID || "(unset)",
      resendConfigured: Boolean(env.RESEND_API_KEY),
      serviceAccountConfigured: Boolean(saRaw),
      serviceAccountStatus: saStatus,
      envKeysPresent: Object.keys(env).filter(k => !k.startsWith("__")).sort(),
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return serverError(err);
  }
};
