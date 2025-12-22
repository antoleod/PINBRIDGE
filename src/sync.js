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

function toEpochMs(updatedAtMs, updatedAtIso) {
  if (typeof updatedAtMs === 'number' && Number.isFinite(updatedAtMs)) return updatedAtMs;
  const parsed = Date.parse(updatedAtIso || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function rethrowFirestoreError(operation, err) {
  const code = err?.code || err?.name || 'unknown';
  const message = err?.message || `${err}`;
  console.error(`[SYNC] Firestore error during ${operation}`, { code, message, err });
  const e = new Error(`FIRESTORE_${operation}:${code}:${message}`);
  e.cause = err;
  throw e;
}

class SyncService {
  async resolveVaultIdByUsername(username) {
    try {
      const key = normalizeUsername(username);
      if (!key) return null;
      const snap = await getDoc(doc(db, 'userDirectory', key));
      if (!snap.exists()) return null;
      const data = snap.data() || {};
      return data.vaultId || null;
    } catch (err) {
      rethrowFirestoreError('RESOLVE_VAULT_ID', err);
    }
  }

  async createUsernameMapping(username, vaultId) {
    try {
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
    } catch (err) {
      rethrowFirestoreError('CREATE_USERNAME_MAPPING', err);
    }
  }

  async fetchMeta(uid) {
    try {
      const snap = await getDoc(doc(db, 'users', uid, 'config', 'meta'));
      return snap.exists() ? snap.data() : null;
    } catch (err) {
      rethrowFirestoreError('FETCH_META', err);
    }
  }

  async fetchVault(uid) {
    try {
      const snap = await getDoc(doc(db, 'users', uid, 'vault', 'data'));
      return snap.exists() ? snap.data() : null;
    } catch (err) {
      rethrowFirestoreError('FETCH_VAULT', err);
    }
  }

  listenToVault(uid, callback) {
    try {
      return onSnapshot(doc(db, 'users', uid, 'vault', 'data'), (snap) => {
        if (snap.exists()) {
          callback(snap.data());
        }
      }, (err) => {
        console.error('[SYNC] Realtime listener error', err);
      });
    } catch (err) {
      console.error('[SYNC] Failed to start realtime listener', err);
      return () => {};
    }
  }

  async pushMeta(uid, meta) {
    try {
      await setDoc(doc(db, 'users', uid, 'config', 'meta'), meta, { merge: true });
    } catch (err) {
      rethrowFirestoreError('PUSH_META', err);
    }
  }

  async pushVault(uid, vaultDoc) {
    try {
      const incomingMs = toEpochMs(vaultDoc?.updatedAtMs, vaultDoc?.updatedAt);
      await runTransaction(db, async (tx) => {
        const ref = doc(db, 'users', uid, 'vault', 'data');
        const snap = await tx.get(ref);
        if (snap.exists()) {
          const existing = snap.data() || {};
          const existingMs = toEpochMs(existing?.updatedAtMs, existing?.updatedAt);
          if (existingMs > incomingMs) return; // Remote is newer; let realtime pull handle merge.
        }
        tx.set(ref, vaultDoc, { merge: true });
      });
    } catch (err) {
      rethrowFirestoreError('PUSH_VAULT', err);
    }
  }

  async createRecoveryRequest(uid) {
    try {
      const ref = doc(db, 'users', uid, 'recovery');
      await setDoc(ref, {
        status: 'pending',
        requestedAt: new Date().toISOString()
      }, { merge: true });
    } catch (err) {
      rethrowFirestoreError('RECOVERY_REQUEST', err);
    }
  }
}

export const syncService = new SyncService();
