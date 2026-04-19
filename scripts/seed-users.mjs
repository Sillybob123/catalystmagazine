// scripts/seed-users.mjs
// Creates / updates Firebase Auth users and their Firestore /users/{uid} docs.
// Run: node scripts/seed-users.mjs

import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import https from 'https';

// ── Read refresh token from Firebase CLI local store ──────────────────────
const configPath = join(homedir(), '.config/configstore/firebase-tools.json');
const cliConfig  = JSON.parse(readFileSync(configPath, 'utf8'));
const { refresh_token, access_token: cachedToken, expires_at } = cliConfig.tokens;

// Build a firebase-admin compatible credential object
function makeCliCredential() {
  let currentToken = cachedToken;
  let expiresAt    = expires_at;

  function refreshViaOAuth() {
    return new Promise((resolve, reject) => {
      const body = new URLSearchParams({
        // Firebase CLI public OAuth client (same values as firebase-tools source)
        client_id:     process.env.FIREBASE_CLIENT_ID     || '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com',
        client_secret: process.env.FIREBASE_CLIENT_SECRET || 'j9iVZfS8vu8gURBQiMSEbFCB',
        grant_type:    'refresh_token',
        refresh_token,
      }).toString();

      const req = https.request({
        hostname: 'oauth2.googleapis.com',
        path:     '/token',
        method:   'POST',
        headers:  { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
      }, res => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) return reject(new Error(parsed.error_description || parsed.error));
            currentToken = parsed.access_token;
            expiresAt    = Date.now() + parsed.expires_in * 1000;
            resolve({ access_token: currentToken, expires_in: parsed.expires_in });
          } catch (e) { reject(e); }
        });
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  return {
    getAccessToken: async () => {
      if (!currentToken || Date.now() >= expiresAt - 60_000) {
        await refreshViaOAuth();
      }
      return { access_token: currentToken, expires_in: Math.floor((expiresAt - Date.now()) / 1000) };
    },
  };
}

// ── Users to seed ────────────────────────────────────────────────────────────
const USERS = [
  { uid: 'NUADG7VSYJhR177LVtFJW957P8H3', email: 'juan.martinez@gwmail.gwu.edu',     createdAt: '2026-04-09', lastSeen: '2026-04-11' },
  { uid: 'GijuxelRGuWNMCgXoNDlNMoIolN2', email: 'meredith.kinkade@gwmail.gwu.edu',  createdAt: '2026-02-23', lastSeen: '2026-03-08' },
  { uid: 'R1npCarvaWX9wV9HrQ0cj60UltH2', email: 'jada.traynor@gwmail.gwu.edu',      createdAt: '2026-02-15', lastSeen: '2026-04-16' },
  { uid: '8SWsCMXEmFNSVlBQiF7yxpmMMHp2', email: 'ygutman19@gmail.com',              createdAt: '2026-02-15', lastSeen: '2026-02-15' },
  { uid: '6itakqYvuAbBMKLc12C6rRjgNVb2', email: 'aidanitaischurr@gmail.com',        createdAt: '2026-02-15', lastSeen: '2026-04-16' },
  { uid: 'yj6KYUqyo3dmv9pSnCUTMxmT0j63', email: 'bsl53@georgetown.edu',             createdAt: '2026-01-22', lastSeen: '2026-01-22' },
  { uid: 'OgS7dL57bEUnPLPxWg0xIN1z0hF3', email: 'skyeschurr25@gmail.com',           createdAt: '2025-11-09', lastSeen: '2025-11-17' },
  { uid: 'qvOamGsq7FVcYMeBK6P4NQtvRHh1', email: 'cfields1108@gmail.com',            createdAt: '2025-11-09', lastSeen: '2026-03-08' },
  { uid: 'Qk9XuFSOPIa0y1jyRMivaiJWk3O2', email: 'tpkaplan31@gmail.com',             createdAt: '2025-10-16', lastSeen: '2025-10-16' },
  { uid: 'GvoNsm6rspW8pdGCHoSvLKAO4413', email: 'izzy.lubinsky@gwmail.gwu.edu',     createdAt: '2025-10-15', lastSeen: '2026-04-05' },
  { uid: 'pX8Kp88nzibiAiu0KsbZJD0UYjT2', email: 'sydneyreiser@icloud.com',          createdAt: '2025-10-08', lastSeen: '2026-04-05' },
  { uid: 'qse3g0G5JcWXi0Paj8yxGiaQ6ww2', email: 'beonguyen2005@gmail.com',          createdAt: '2025-09-03', lastSeen: '2025-11-09' },
  { uid: 'wUuM5fJOlEhEdfeIlNFRaRJqPzZ2', email: 'rachel.lee@gwmail.gwu.edu',        createdAt: '2025-08-28', lastSeen: '2025-09-29' },
  { uid: 'id9xtnWXV3RJoc',               email: 'layla.abdoulaye@bison.howard.edu', createdAt: '2025-08-28', lastSeen: '2026-01-25' },
];

const DEFAULT_PASSWORD = '123456';
const DEFAULT_ROLE     = 'writer';
const DEFAULT_STATUS   = 'active';

// ── Init admin SDK ────────────────────────────────────────────────────────────
if (!getApps().length) {
  initializeApp({ credential: makeCliCredential(), projectId: 'catalystwriters-5ce43' });
}

const auth = getAuth();
const db   = getFirestore();

// ── Upsert one user ───────────────────────────────────────────────────────────
async function upsertUser({ uid, email, createdAt, lastSeen }) {
  let authUid = uid;

  // 1. Firebase Auth
  try {
    await auth.getUser(uid);
    await auth.updateUser(uid, { email, password: DEFAULT_PASSWORD });
    console.log(`  [auth] updated  ${email}`);
  } catch (err) {
    if (err.code === 'auth/user-not-found') {
      try {
        const created = await auth.createUser({ uid, email, password: DEFAULT_PASSWORD, emailVerified: false });
        authUid = created.uid;
        console.log(`  [auth] created  ${email} (${authUid})`);
      } catch (createErr) {
        if (createErr.code === 'auth/uid-already-exists') {
          await auth.updateUser(uid, { email, password: DEFAULT_PASSWORD });
          console.log(`  [auth] patched  ${email} (uid existed)`);
        } else {
          throw createErr;
        }
      }
    } else {
      throw err;
    }
  }

  // 2. Firestore /users/{uid}
  const ref  = db.collection('users').doc(authUid);
  const snap = await ref.get();

  const payload = {
    email,
    role:      DEFAULT_ROLE,
    status:    DEFAULT_STATUS,
    createdAt: new Date(createdAt),
    lastSeen:  new Date(lastSeen),
    updatedAt: new Date(),
  };

  if (snap.exists) {
    await ref.set(payload, { merge: true });
    console.log(`  [db]   merged   ${email}`);
  } else {
    await ref.set({ ...payload, displayName: '', bio: '', articles: [] });
    console.log(`  [db]   created  ${email}`);
  }
}

// ── Run ───────────────────────────────────────────────────────────────────────
console.log(`\nSeeding ${USERS.length} users → catalystwriters-5ce43\n`);
let ok = 0, fail = 0;
for (const user of USERS) {
  try {
    await upsertUser(user);
    ok++;
  } catch (err) {
    console.error(`  [ERR] ${user.email}: ${err.message}`);
    fail++;
  }
}
console.log(`\n✓ Done. ${ok} succeeded, ${fail} failed.\n`);
