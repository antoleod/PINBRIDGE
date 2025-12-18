import {
  doc,
  getDoc,
  onSnapshot,
  setDoc
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";
import { db } from './firebase.js';

class SyncService {
  async fetchMeta(uid) {
    const snap = await getDoc(doc(db, 'users', uid, 'config', 'meta'));
    return snap.exists() ? snap.data() : null;
  }

  async fetchVault(uid) {
    const snap = await getDoc(doc(db, 'users', uid, 'vault', 'data'));
    return snap.exists() ? snap.data() : null;
  }

  listenToVault(uid, callback) {
    return onSnapshot(doc(db, 'users', uid, 'vault', 'data'), (snap) => {
      if (snap.exists()) {
        callback(snap.data());
      }
    });
  }

  async pushMeta(uid, meta) {
    await setDoc(doc(db, 'users', uid, 'config', 'meta'), meta, { merge: true });
  }

  async pushVault(uid, vaultDoc) {
    await setDoc(doc(db, 'users', uid, 'vault', 'data'), vaultDoc, { merge: true });
  }

  async createRecoveryRequest(uid) {
    const ref = doc(db, 'users', uid, 'recovery');
    await setDoc(ref, {
      status: 'pending',
      requestedAt: new Date().toISOString()
    }, { merge: true });
  }
}

export const syncService = new SyncService();
