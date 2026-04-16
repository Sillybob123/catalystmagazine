// GET /api/health -> { ok: true }
// Sanity-check route you can hit from the browser after deploying.

import { json, serverError } from "../_utils/http.js";

export const onRequestGet = async ({ env }) => {
  try {
    return json({
      ok: true,
      service: "catalyst-magazine",
      project: env.FIREBASE_PROJECT_ID || "(unset)",
      resendConfigured: Boolean(env.RESEND_API_KEY),
      serviceAccountConfigured: Boolean(env.FIREBASE_SERVICE_ACCOUNT),
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return serverError(err);
  }
};
