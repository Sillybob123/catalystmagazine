/**
 * Dual Firebase Configuration
 *
 * Re-exports the primary DB from firebase-config.js (avoids double-initializing
 * the default app, which causes TDZ crashes), and initializes the secondary
 * workflow DB (catalystmonday) with a duplicate-init guard.
 */

import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// Re-export primary config so callers don't need to change their imports.
export { app, auth, db, storage, analytics } from "./firebase-config.js";

// ============================================
// WORKFLOW DATABASE (catalystmonday)
// ============================================
const workflowConfig = {
  apiKey: "AIzaSyBT6urJvPCtuYQ1c2iH77QTDfzE3yGw-Xk",
  authDomain: "catalystmonday.firebaseapp.com",
  projectId: "catalystmonday",
  storageBucket: "catalystmonday.appspot.com",
  messagingSenderId: "394311851220",
  appId: "1:394311851220:web:86e4939b7d5a085b46d75d"
};

// Guard against double-initialization (HMR / multiple module imports)
export const workflowApp =
  getApps().find((a) => a.name === "workflow") ||
  initializeApp(workflowConfig, "workflow");

// getAuth must be called on the workflow app so the SDK attaches the user's
// token to Firestore requests — without this, catalystmonday sees unauthenticated calls.
export const workflowAuth = getAuth(workflowApp);
export const workflowDb = getFirestore(workflowApp);
