/**
 * Dual Firebase Configuration
 *
 * This module provides access to TWO separate Firebase projects:
 * 1. Primary (catalystwriters-5ce43) - For stories, content, main dashboard
 * 2. Workflow (catalystmonday) - For editorial workflow, projects, tasks
 *
 * Both databases remain completely independent.
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, enableIndexedDbPersistence } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-analytics.js";

// ============================================
// PRIMARY DATABASE (catalystwriters-5ce43)
// Used for: Stories, content, main dashboard
// ============================================
const primaryConfig = {
  apiKey: "AIzaSyDY2KhiDrOqRTdHKB1XfEndM_q0hS6tx-0",
  authDomain: "catalystwriters-5ce43.firebaseapp.com",
  projectId: "catalystwriters-5ce43",
  storageBucket: "catalystwriters-5ce43.firebasestorage.app",
  messagingSenderId: "450537311266",
  appId: "1:450537311266:web:d0c286d8a5553eb92a0e7b",
  measurementId: "G-0P4DMW8ZZ1"
};

// Initialize primary app (default)
const primaryApp = initializeApp(primaryConfig);
const auth = getAuth(primaryApp);
const db = getFirestore(primaryApp);
const storage = getStorage(primaryApp);
const analytics = getAnalytics(primaryApp);

// Enable offline persistence for primary
enableIndexedDbPersistence(db, { synchronizeTabs: true })
  .catch((err) => {
    if (err.code === 'failed-precondition') {
      console.warn('[PRIMARY DB] Multiple tabs open - persistence disabled');
    } else if (err.code === 'unimplemented') {
      console.warn('[PRIMARY DB] Persistence not available in browser');
    }
  });

// ============================================
// WORKFLOW DATABASE (catalystmonday)
// Used for: Editorial workflow, projects, tasks, scheduler
// ============================================
const workflowConfig = {
  apiKey: "AIzaSyBT6urJvPCtuYQ1c2iH77QTDfzE3yGw-Xk",
  authDomain: "catalystmonday.firebaseapp.com",
  projectId: "catalystmonday",
  storageBucket: "catalystmonday.appspot.com",
  messagingSenderId: "394311851220",
  appId: "1:394311851220:web:86e4939b7d5a085b46d75d"
};

// Initialize workflow app (secondary)
const workflowApp = initializeApp(workflowConfig, 'workflow');
const workflowDb = getFirestore(workflowApp);

// Enable offline persistence for workflow
enableIndexedDbPersistence(workflowDb, { synchronizeTabs: true })
  .catch((err) => {
    if (err.code === 'failed-precondition') {
      console.warn('[WORKFLOW DB] Multiple tabs open - persistence disabled');
    } else if (err.code === 'unimplemented') {
      console.warn('[WORKFLOW DB] Persistence not available in browser');
    }
  });

// ============================================
// EXPORTS
// ============================================

// Primary database (catalystwriters-5ce43)
export {
  primaryApp as app,
  auth,
  db,
  storage,
  analytics
};

// Workflow database (catalystmonday)
export {
  workflowApp,
  workflowDb
};

// Helper to check which database a user should access
export function getDatabaseForUser(userRole) {
  // All users can read from both databases
  // Primary for stories, Workflow for projects
  return {
    primary: db,
    workflow: workflowDb
  };
}

console.log('[FIREBASE] Dual configuration initialized');
console.log('[FIREBASE] Primary DB: catalystwriters-5ce43');
console.log('[FIREBASE] Workflow DB: catalystmonday');
