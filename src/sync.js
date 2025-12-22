import {
  doc,
  getDoc,
  onSnapshot,
  runTransaction,
  setDoc
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";
import { db } from './firebase.js';

function normalizeUsername(username) {
  return (username || '').trim().toLowerCase();
}

class SyncService {
  async resolveVaultIdByUsername(username) {
    const key = normalizeUsername(username);
    if (!key) return null;
    const snap = await getDoc(doc(db, 'userDirectory', key));
    if (!snap.exists()) return null;
    const data = snap.data() || {};
    return data.vaultId || null;
  }

  async createUsernameMapping(username, vaultId) {
    const key = normalizeUsername(username);
    if (!key) throw new Error('USERNAME_REQUIRED');
    if (!vaultId) throw new Error('VAULT_ID_REQUIRED');

    await runTransaction(db, async (tx) => {
      const ref = doc(db, 'userDirectory', key);
      const snap = await tx.get(ref);
      if (snap.exists()) {
        throw new Error('USER_EXISTS');
      }
      tx.set(ref, {
        username: (username || '').trim(),
        vaultId,
        createdAt: new Date().toISOString()
      });
    });
  }

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
