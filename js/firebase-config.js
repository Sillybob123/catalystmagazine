// Firebase Configuration for Catalyst Writers CMS
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-analytics.js";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyDY2KhiDrOqRTdHKB1XfEndM_q0hS6tx-0",
  authDomain: "catalystwriters-5ce43.firebaseapp.com",
  projectId: "catalystwriters-5ce43",
  storageBucket: "catalystwriters-5ce43.firebasestorage.app",  // Match Storage console bucket name
  messagingSenderId: "450537311266",
  appId: "1:450537311266:web:d0c286d8a5553eb92a0e7b",
  measurementId: "G-0P4DMW8ZZ1"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);
const analytics = getAnalytics(app);

export { app, auth, db, storage, analytics };
