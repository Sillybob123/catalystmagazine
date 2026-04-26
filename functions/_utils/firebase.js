// functions/_utils/firebase.js
// Utilities for talking to Firebase from a Cloudflare Pages Function.
// - verifyIdToken: validates a Firebase Auth ID token using Google's public keys.
// - firestoreFetch: thin wrapper over the Firestore REST API.
//
// We use an optional OAuth2 access token (derived from a service account) when
// writes need to bypass security rules; otherwise we can also pass the user's
// ID token for rules-evaluated requests.

const GOOGLE_KEYS_URL =
  "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";

// --- ID token verification --------------------------------------------------

let _keyCache = { keys: null, expiresAt: 0 };

async function getGoogleKeys() {
  if (_keyCache.keys && Date.now() < _keyCache.expiresAt) return _keyCache.keys;
  const res = await fetch(GOOGLE_KEYS_URL);
  if (!res.ok) throw new Error("Failed to fetch Google public keys");
  const keys = await res.json();
  // Cache for 1 hour (Google rotates ~daily).
  _keyCache = { keys, expiresAt: Date.now() + 60 * 60 * 1000 };
  return keys;
}

function base64UrlDecode(str) {
  const pad = str.length % 4 === 0 ? "" : "=".repeat(4 - (str.length % 4));
  const b64 = (str + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function parseJwt(token) {
  const [headerB64, payloadB64, signatureB64] = token.split(".");
  if (!headerB64 || !payloadB64 || !signatureB64) throw new Error("Malformed token");
  const header = JSON.parse(new TextDecoder().decode(base64UrlDecode(headerB64)));
  const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(payloadB64)));
  const signingInput = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const signature = base64UrlDecode(signatureB64);
  return { header, payload, signingInput, signature };
}

async function pemToCryptoKey(pem) {
  const pemBody = pem
    .replace(/-----BEGIN CERTIFICATE-----/, "")
    .replace(/-----END CERTIFICATE-----/, "")
    .replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));
  // Extract SPKI from X.509 cert. For simplicity, we import the cert directly
  // as a SubjectPublicKeyInfo isn't straightforward here; use the built-in
  // importKey("spki") with the parsed public key. A simpler path: use the
  // x5c-style by importing the full cert isn't supported, so we rely on
  // Google's alternative JWK endpoint when possible.
  return crypto.subtle.importKey(
    "spki",
    der.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );
}

// Fetch Google's public keys in JWK form (easier than parsing X.509 PEM).
const GOOGLE_JWK_URL =
  "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

let _jwkCache = { keys: null, expiresAt: 0 };
async function getGoogleJwks() {
  if (_jwkCache.keys && Date.now() < _jwkCache.expiresAt) return _jwkCache.keys;
  const res = await fetch(GOOGLE_JWK_URL);
  if (!res.ok) throw new Error("Failed to fetch Google JWK keys");
  const data = await res.json();
  _jwkCache = { keys: data.keys, expiresAt: Date.now() + 60 * 60 * 1000 };
  return data.keys;
}

export async function verifyIdToken(idToken, projectId) {
  const { header, payload, signingInput, signature } = parseJwt(idToken);

  if (header.alg !== "RS256") throw new Error("Unexpected JWT alg");

  const jwks = await getGoogleJwks();
  const jwk = jwks.find((k) => k.kid === header.kid);
  if (!jwk) throw new Error("Signing key not found");

  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );

  const ok = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    signature,
    signingInput
  );
  if (!ok) throw new Error("Invalid token signature");

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) throw new Error("Token expired");
  if (payload.iat && payload.iat > now + 60) throw new Error("Token issued in the future");
  if (payload.aud !== projectId) throw new Error("Token audience mismatch");
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) {
    throw new Error("Token issuer mismatch");
  }
  if (!payload.sub) throw new Error("Token has no subject");

  return payload; // { uid: sub, email, email_verified, name, ... }
}

// --- Service account OAuth2 access token ------------------------------------

let _accessTokenCache = { token: null, expiresAt: 0 };

async function getServiceAccountAccessToken(env) {
  if (_accessTokenCache.token && Date.now() < _accessTokenCache.expiresAt) {
    return _accessTokenCache.token;
  }
  const raw = env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT env var is missing");
  const sa = typeof raw === "string" ? JSON.parse(raw) : raw;

  const header = { alg: "RS256", typ: "JWT", kid: sa.private_key_id };
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/firebase",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };

  const enc = (obj) => {
    const s = btoa(JSON.stringify(obj))
      .replace(/=+$/, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
    return s;
  };
  const signingInput = `${enc(header)}.${enc(claims)}`;

  // Import the PEM private key
  const pem = sa.private_key.replace(/\\n/g, "\n");
  const pemBody = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    "pkcs8",
    der.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput)
  );
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  const jwt = `${signingInput}.${sigB64}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OAuth2 token error ${res.status}: ${text}`);
  }
  const { access_token, expires_in } = await res.json();
  _accessTokenCache = {
    token: access_token,
    expiresAt: Date.now() + (expires_in - 60) * 1000,
  };
  return access_token;
}

// --- Firestore REST helpers -------------------------------------------------

export function getProjectId(env) {
  if (env.FIREBASE_PROJECT_ID) return env.FIREBASE_PROJECT_ID;
  // Fallback: extract project_id from the service account JSON
  const raw = env.FIREBASE_SERVICE_ACCOUNT;
  if (raw) {
    try {
      const sa = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (sa.project_id) return sa.project_id;
    } catch { /* ignore */ }
  }
  throw new Error("FIREBASE_PROJECT_ID env var is missing and could not be derived from service account");
}

function firestoreBase(env) {
  const projectId = getProjectId(env);
  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
}

export async function firestoreGet(env, path) {
  const token = await getServiceAccountAccessToken(env);
  const res = await fetch(`${firestoreBase(env)}/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Firestore GET ${path} failed: ${res.status}`);
  return res.json();
}

export async function firestoreCreate(env, collection, fields, docId) {
  const token = await getServiceAccountAccessToken(env);
  const url = new URL(`${firestoreBase(env)}/${collection}`);
  if (docId) url.searchParams.set("documentId", docId);
  const res = await fetch(url.toString(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fields: toFirestoreFields(fields) }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Firestore create failed ${res.status}: ${text}`);
  }
  return fromFirestoreDoc(await res.json());
}

// Optional `precondition` lets callers do an optimistic-concurrency update:
// pass the document's updateTime (returned by firestoreGet as `__updateTime`,
// or available via doc.updateTime in raw responses) and Firestore will reject
// the PATCH if the doc was modified in the meantime. Used by dispatch-due to
// ensure two simultaneous cron runs can't both claim the same campaign.
export async function firestoreUpdate(env, path, fields, { mergeFields = true, precondition = null } = {}) {
  const token = await getServiceAccountAccessToken(env);
  const url = new URL(`${firestoreBase(env)}/${path}`);
  if (mergeFields) {
    for (const k of Object.keys(fields)) {
      url.searchParams.append("updateMask.fieldPaths", k);
    }
  }
  if (precondition?.updateTime) {
    url.searchParams.append("currentDocument.updateTime", precondition.updateTime);
  } else if (precondition?.exists != null) {
    url.searchParams.append("currentDocument.exists", String(precondition.exists));
  }
  const res = await fetch(url.toString(), {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fields: toFirestoreFields(fields) }),
  });
  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`Firestore update failed ${res.status}: ${text}`);
    err.status = res.status;
    throw err;
  }
  return fromFirestoreDoc(await res.json());
}

export async function firestoreRunQuery(env, structuredQuery) {
  const token = await getServiceAccountAccessToken(env);
  const res = await fetch(`${firestoreBase(env)}:runQuery`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ structuredQuery }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Firestore query failed ${res.status}: ${text}`);
  }
  const rows = await res.json();
  return rows
    .filter((r) => r.document)
    .map((r) => ({
      name: r.document.name,
      id: r.document.name.split("/").pop(),
      data: fromFirestoreFields(r.document.fields || {}),
    }));
}

// Convert plain JS -> Firestore typed fields
function toFirestoreFields(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[k] = toFirestoreValue(v);
  return out;
}
function toFirestoreValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") {
    return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  }
  if (typeof v === "string") return { stringValue: v };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) {
    return { arrayValue: { values: v.map(toFirestoreValue) } };
  }
  if (typeof v === "object") {
    return { mapValue: { fields: toFirestoreFields(v) } };
  }
  return { stringValue: String(v) };
}

// Firestore typed fields -> plain JS
function fromFirestoreFields(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields)) out[k] = fromFirestoreValue(v);
  return out;
}
function fromFirestoreValue(v) {
  if (!v) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("timestampValue" in v) return v.timestampValue;
  if ("nullValue" in v) return null;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(fromFirestoreValue);
  if ("mapValue" in v) return fromFirestoreFields(v.mapValue.fields || {});
  return null;
}

export function fromFirestoreDoc(doc) {
  return {
    name: doc.name,
    id: doc.name ? doc.name.split("/").pop() : null,
    data: fromFirestoreFields(doc.fields || {}),
  };
}
