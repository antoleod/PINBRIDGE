// Firebase initialization (CDN ES modules v10+)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence,
  updateProfile,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  EmailAuthProvider,
  linkWithCredential
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import {
  getFirestore
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAZxx-yus11M5acGpB9l1sMyCbWCstsF_I",
  authDomain: "pinbridge-web.firebaseapp.com",
  projectId: "pinbridge-web",
  storageBucket: "pinbridge-web.firebasestorage.app",
  messagingSenderId: "533556805684",
  appId: "1:533556805684:web:ef0e12c06d174a833b8a61"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

setPersistence(auth, browserLocalPersistence).catch(() => {});

async function ensureAnonymousSession() {
  if (auth.currentUser) return auth.currentUser;
  try {
    const result = await signInAnonymously(auth);
    return result.user;
  } catch (err) {
    console.error("Anonymous auth failed", err);
    if (auth.currentUser) return auth.currentUser;
    throw err;
  }
}

function onAuth(cb) {
  return onAuthStateChanged(auth, cb);
}

async function upgradeToEmail(email, password) {
  if (!email || !password) throw new Error("EMAIL_REQUIRED");
  const current = auth.currentUser;
  if (current && current.isAnonymous) {
    const credential = EmailAuthProvider.credential(email, password);
    const { user } = await linkWithCredential(current, credential);
    if (user && user.displayName !== current.displayName) {
      await updateProfile(user, { displayName: current.displayName || "PINBRIDGE" });
    }
    return user;
  }
  const { user } = await signInWithEmailAndPassword(auth, email, password);
  return user;
}

export {
  app,
  auth,
  db,
  ensureAnonymousSession,
  onAuth,
  upgradeToEmail
};
