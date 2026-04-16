// functions/_middleware.js
// Runs for EVERY request to /functions/* (i.e. every API call).
// We use it to (a) short-circuit CORS preflight requests and (b) attach CORS
// headers to all responses.

import { corsHeaders, handleOptions } from "./_utils/http.js";

export async function onRequest(context) {
  const { request, next } = context;

  if (request.method === "OPTIONS") {
    return handleOptions(request);
  }

  const response = await next();

  // Clone so we can add headers without mutating the original.
  const newHeaders = new Headers(response.headers);
  const cors = corsHeaders(request.headers.get("Origin") || "*");
  for (const [k, v] of Object.entries(cors)) newHeaders.set(k, v);

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
}
