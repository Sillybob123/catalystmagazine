/**
 * seed-user-names.mjs
 *
 * Sets the `name` field on every user in catalystwriters-5ce43 so that
 * when a writer logs in and submits a proposal, their authorName is correct
 * (e.g. "Lori Preci" not "lori.preci@gwu.edu").
 *
 * Run: node scripts/seed-user-names.mjs
 */

import { createRequire } from "module";
const require = createRequire(import.meta.url);

const { OAuth2Client } = require("/opt/homebrew/lib/node_modules/firebase-tools/node_modules/google-auth-library");
const Configstore = require("/opt/homebrew/lib/node_modules/firebase-tools/node_modules/configstore");

const PROJECT_ID = "catalystwriters-5ce43";
const FS_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

const cfg = new Configstore("firebase-tools");
const tokens = cfg.get("tokens");
const oauthClient = new OAuth2Client();
oauthClient.setCredentials({
  access_token: tokens.access_token,
  refresh_token: tokens.refresh_token,
  expiry_date: tokens.expires_at,
  token_type: "Bearer",
  id_token: tokens.id_token,
});

async function getToken() {
  const { token } = await oauthClient.getAccessToken();
  return token;
}

async function patchDoc(collection, docId, fields) {
  const token = await getToken();
  // Only patch specified fields using field mask
  const fieldPaths = Object.keys(fields).join(",");
  const res = await fetch(
    `${FS_BASE}/${collection}/${docId}?updateMask.fieldPaths=${fieldPaths}`,
    {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ fields }),
    }
  );
  const data = await res.json();
  if (data.error) throw new Error(JSON.stringify(data.error));
  return data;
}

const fStr = (v) => ({ stringValue: v ?? "" });

// ── uid → display name mapping ───────────────────────────────────────────────
// Derived from the authorId/authorName pairs in all projects,
// plus known editors from the dashboard.
const USER_NAMES = {
  // Writers (from project authorId/authorName)
  "ambIEY71lSbeZ1cn94h0kOht3lZ2": "Alexis Tamm",
  "yj6KYUqyo3dmv9pSnCUTMxmT0j63": "Belinda Li",
  "qvOamGsq7FVcYMeBK6P4NQtvRHh1": "Cameron Fields",
  "qse3g0G5JcWXi0Paj8yxGiaQ6ww2": "Le Nguyen",
  "R1npCarvaWX9wV9HrQ0cj60UltH2": "Jada Traynor",
  "GvoNsm6rspW8pdGCHoSvLKAO4413": "Izzy Lubinsky",
  "ZPBFhEEO3cWzjUbNDNfhRxr5c102": "Naama Ben-Dor",
  "X2KxbnbjRReXZnynPMEbGJPVqw43": "Aidan Brown",
  "pX8Kp88nzibiAiu0KsbZJD0UYjT2": "Sydney Reiser",
  "E4ImUZWrRNRNm0KFT9PGCeXZm4a2": "Lori Preci",
  // Editors / admins
  "8LdHnkyhEITmcEE0h93DIC4ZDXv2": "Aidan Schurr",
  "6itakqYvuAbBMKLc12C6rRjgNVb2": "Aidan Schurr",  // aidanitaischurr@gmail.com
  // Other known users from seed-users.mjs
  "NUADG7VSYJhR177LVtFJW957P8H3": "Juan Martinez",
  "GijuxelRGuWNMCgXoNDlNMoIolN2": "Meredith Kinkade",
  "8SWsCMXEmFNSVlBQiF7yxpmMMHp2": "Ygutman",
  "OgS7dL57bEUnPLPxWg0xIN1z0hF3": "Skye Schurr",
  "Qk9XuFSOPIa0y1jyRMivaiJWk3O2": "T. Kaplan",
  "wUuM5fJOlEhEdfeIlNFRaRJqPzZ2": "Rachel Lee",
};

console.log(`\nSetting display names on ${Object.keys(USER_NAMES).length} users → catalystwriters-5ce43\n`);

let ok = 0, fail = 0;
for (const [uid, name] of Object.entries(USER_NAMES)) {
  try {
    await patchDoc("users", uid, { name: fStr(name) });
    console.log(`  ✓ users/${uid}  "${name}"`);
    ok++;
  } catch (e) {
    // User doc may not exist yet (they haven't logged in) — that's fine,
    // name will be set on first login via ensureProfile → user.displayName.
    // But log it anyway.
    const msg = e.message.includes("NOT_FOUND") ? "doc not found (user hasn't logged in yet)" : e.message;
    console.log(`  ⚠ users/${uid}: ${msg}`);
    fail++;
  }
}

console.log(`\n✓ Done. ${ok} updated, ${fail} skipped/failed.\n`);
