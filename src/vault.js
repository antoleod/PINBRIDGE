import { cryptoService } from './crypto/crypto.js';
import { storageService } from './storage/db.js';
import { syncService } from './sync.js';
import { Utils } from './utils/helpers.js';
import { bus } from './core/bus.js';
import { syncManager } from './modules/sync/sync-manager.js';

class VaultService {
  constructor() {
    this.dataKey = null;
    this.meta = null;
    this.vault = { notes: [], meta: {} };
    this.uid = null;
    this.localUpdatedAt = null;
    this.realtimeUnsub = null;
    this.syncEnabled = localStorage.getItem('pinbridge.sync_enabled') === 'true';
  }

  async init(uid) {
    this.uid = uid;
    await storageService.init('pinbridge_db');
    this.meta = await storageService.getCryptoMeta();
    this.localUpdatedAt = (await storageService.getEncryptedVault())?.updatedAt || null;
  }

  setSyncEnabled(enabled) {
    this.syncEnabled = enabled;
  }

  isUnlocked() {
    return !!this.dataKey;
  }

  async hasExistingVault() {
    if (this.meta) return true;
    if (!this.syncEnabled) return false;
    try {
      const remoteMeta = await syncService.fetchMeta(this.uid);
      if (remoteMeta) {
        this.meta = remoteMeta;
        await storageService.saveCryptoMeta(remoteMeta);
        return true;
      }
    } catch (e) {
      console.warn('Meta fetch offline', e);
    }
    return false;
  }

  async createNewVault({ uid, username, pin }) {
    this.uid = uid;
    await storageService.resetAll();

    const dataKey = await cryptoService.generateDataKey();
    const keySalt = cryptoService.generateSalt();
    const recoverySalt = cryptoService.generateSalt();
    const recoveryKey = Utils.bufferToHex(crypto.getRandomValues(new Uint8Array(32)));

    const pinKey = await cryptoService.deriveKeyFromSecret(pin, keySalt);
    const recoveryKeyKey = await cryptoService.deriveKeyFromSecret(recoveryKey, recoverySalt);

    const wrappedKey = await cryptoService.wrapKey(dataKey, pinKey);
    const recoveryWrappedKey = await cryptoService.wrapKey(dataKey, recoveryKeyKey);

    const now = new Date().toISOString();
    this.meta = {
      version: '1.0',
      keySalt: Utils.bufferToBase64(keySalt),
      recoverySalt: Utils.bufferToBase64(recoverySalt),
      wrappedKey,
      recoveryWrappedKey,
      username: username || '',
      updatedAt: now
    };

    this.dataKey = dataKey;
    this.vault = { notes: [], meta: { createdAt: now, username: username || '' } };

    await storageService.saveCryptoMeta(this.meta);
    if (this.syncEnabled) {
      syncManager.enqueue('PUSH_META', this.meta, this.uid);
    }
    await this.persistVault();
    this._startRealtime();
    return recoveryKey;
  }

  async unlockWithPin({ uid, pin }) {
    this.uid = uid;
    if (!this.meta && this.syncEnabled) {
      const remoteMeta = await syncService.fetchMeta(uid);
      if (!remoteMeta) throw new Error('NO_VAULT');
      this.meta = remoteMeta;
      await storageService.saveCryptoMeta(remoteMeta);
    }
    try {
      const salt = Utils.base64ToBuffer(this.meta.keySalt);
      const pinKey = await cryptoService.deriveKeyFromSecret(pin, salt);
      this.dataKey = await cryptoService.unwrapKey(this.meta.wrappedKey, pinKey);
      await this._loadLatestVault();
      this._startRealtime();
    } catch (e) {
      throw new Error('INVALID_PIN');
    }
  }

  async unlockWithRecovery({ uid, recoveryKey }) {
    this.uid = uid;
    if (!this.meta && this.syncEnabled) {
      const remoteMeta = await syncService.fetchMeta(uid);
      if (!remoteMeta) throw new Error('NO_VAULT');
      this.meta = remoteMeta;
      await storageService.saveCryptoMeta(remoteMeta);
    }
    try {
      const salt = Utils.base64ToBuffer(this.meta.recoverySalt);
      const recoveryKeyKey = await cryptoService.deriveKeyFromSecret(recoveryKey, salt);
      this.dataKey = await cryptoService.unwrapKey(this.meta.recoveryWrappedKey, recoveryKeyKey);
      await this._loadLatestVault();
      this._startRealtime();
    } catch (e) {
      console.error(e);
      throw new Error('INVALID_PIN');
    }
  }

  getNotes() {
    return this.vault.notes || [];
  }

  async upsertNote(note) {
    const existingIndex = this.vault.notes.findIndex(n => n.id === note.id);
    if (existingIndex >= 0) {
      this.vault.notes[existingIndex] = note;
    } else {
      this.vault.notes.push(note);
    }
    await this.persistVault();
  }

  async replaceNotes(notes) {
    this.vault.notes = notes;
    await this.persistVault();
  }

  async persistVault() {
    if (!this.dataKey) throw new Error('LOCKED');
    const now = new Date().toISOString();
    this.vault.meta = this.vault.meta || {};
    this.vault.meta.updatedAt = now;
    const payload = await cryptoService.encryptObject(this.vault, this.dataKey);
    const record = {
      version: '1.0',
      updatedAt: now,
      cipher: 'AES-GCM',
      payload
    };
    this.localUpdatedAt = now;
    await storageService.saveEncryptedVault(record);

    if (this.syncEnabled) {
      // Use Queue with optimization
      syncManager.enqueueOrUpdate('PUSH_VAULT', record, this.uid);
    }
    bus.emit('vault:saved', now);
  }

  async persistNotes(notes) {
    if (!Array.isArray(notes)) return;
    this.vault.notes = notes.map(note => ({ ...note }));
    await this.persistVault();
  }

  async _loadLatestVault() {
    const local = await storageService.getEncryptedVault();
    let remote = null;
    if (this.syncEnabled) {
      try {
        remote = await syncService.fetchVault(this.uid);
      } catch (e) {
        console.warn('Vault fetch offline, using local', e);
      }
    }

    const { mergedRecord, mergedData } = await this._smartMerge(local, remote);

    if (mergedData) {
      this.vault = mergedData;
      this.localUpdatedAt = mergedRecord.updatedAt;

      // If merge changed something or remote was newer, we save local.
      // If we merged remote data in, we should persist.
      await storageService.saveEncryptedVault(mergedRecord);
    } else {
      // Init empty
      this.vault = { notes: [], meta: { createdAt: new Date().toISOString(), username: this.meta?.username || '' } };
      await this.persistVault();
    }
  }

  // Smart Merge Logic: Decrypts both, merges notes by timestamp, re-encrypts.
  async _smartMerge(localRecord, remoteRecord) {
    if (!localRecord && !remoteRecord) return { mergedRecord: null, mergedData: null };

    // If only one exists, return it (decrypted)
    if (localRecord && !remoteRecord) {
      const data = await cryptoService.decryptObject(localRecord.payload, this.dataKey);
      return { mergedRecord: localRecord, mergedData: data };
    }
    if (!localRecord && remoteRecord) {
      const data = await cryptoService.decryptObject(remoteRecord.payload, this.dataKey);
      return { mergedRecord: remoteRecord, mergedData: data };
    }

    // Both exist. Decrypt.
    let localData, remoteData;
    try {
      localData = await cryptoService.decryptObject(localRecord.payload, this.dataKey);
    } catch (e) { console.error('Local decrypt fail', e); return { mergedRecord: remoteRecord, mergedData: await cryptoService.decryptObject(remoteRecord.payload, this.dataKey) }; }

    try {
      remoteData = await cryptoService.decryptObject(remoteRecord.payload, this.dataKey);
    } catch (e) { console.error('Remote decrypt fail', e); return { mergedRecord: localRecord, mergedData: localData }; }

    // Map merge
    const noteMap = new Map();
    localData.notes.forEach(n => noteMap.set(n.id, n));

    // Merge remote into local
    remoteData.notes.forEach(rNote => {
      const lNote = noteMap.get(rNote.id);
      if (!lNote) {
        // Remote has new note, add it
        noteMap.set(rNote.id, rNote);
      } else {
        // Conflict: Last Write Wins
        if (rNote.updated > lNote.updated) {
          noteMap.set(rNote.id, rNote);
        }
      }
    });

    // Reconstruct
    const mergedNotes = Array.from(noteMap.values());
    const maxTime = new Date().toISOString();

    const mergedData = {
      ...localData,
      notes: mergedNotes,
      meta: { ...localData.meta, updatedAt: maxTime }
    };

    // Re-encrypt
    const payload = await cryptoService.encryptObject(mergedData, this.dataKey);
    const mergedRecord = {
      version: '1.0',
      updatedAt: maxTime,
      cipher: 'AES-GCM',
      payload
    };

    return { mergedRecord, mergedData };
  }

  async _handleRemoteSnapshot(doc) {
    if (!doc || !this.dataKey) return; // Ignore if locked

    // Check timestamps to avoid loops
    const remoteTime = new Date(doc.updatedAt || 0).getTime();
    const localTime = new Date(this.localUpdatedAt || 0).getTime();

    if (remoteTime <= localTime) return; // We are up to date or ahead

    console.log('Remote update detected, merging...');
    const local = await storageService.getEncryptedVault();
    const { mergedRecord, mergedData } = await this._smartMerge(local, doc);

    if (mergedData) {
      this.vault = mergedData;
      this.localUpdatedAt = mergedRecord.updatedAt;
      await storageService.saveEncryptedVault(mergedRecord);
      bus.emit('vault:remote-update', mergedRecord.updatedAt);
      bus.emit('notes:loaded', this.vault.notes); // Force UI refresh
    }
  }

  _startRealtime() {
    if (this.realtimeUnsub) this.realtimeUnsub();
    if (!this.syncEnabled) return;
    this.realtimeUnsub = syncService.listenToVault(this.uid, (doc) => this._handleRemoteSnapshot(doc));
  }

  lock() {
    this.dataKey = null;
    this.vault = { notes: [], meta: {} };
    if (this.realtimeUnsub) this.realtimeUnsub();
    this.realtimeUnsub = null;
    bus.emit('vault:locked');
  }

  async saveSession() {
    if (!this.dataKey) return;
    try {
      const exported = await cryptoService.exportKeyBytes(this.dataKey);
      const b64 = Utils.bufferToBase64(exported);
      sessionStorage.setItem('pb_session_key', b64);
    } catch (e) {
      console.warn('Session save failed', e);
    }
  }

  async tryRestoreSession() {
    const b64 = sessionStorage.getItem('pb_session_key');
    if (!b64) return false;
    try {
      const raw = Utils.base64ToBuffer(b64);
      this.dataKey = await cryptoService.importRawKey(raw);
      // We need to load vault
      if (!this.meta && this.syncEnabled) {
        const remoteMeta = await syncService.fetchMeta(this.uid);
        if (remoteMeta) {
          this.meta = remoteMeta;
          await storageService.saveCryptoMeta(remoteMeta);
        }
      }
      await this._loadLatestVault();
      this._startRealtime();
      return true;
    } catch (e) {
      console.warn('Session restore failed', e);
      sessionStorage.removeItem('pb_session_key');
      return false;
    }
  }

  clearSession() {
    sessionStorage.removeItem('pb_session_key');
  }

  async fileRecoveryResetRequest() {
    syncManager.enqueue('RECOVERY_REQUEST', {}, this.uid);
  }
}

export const vaultService = new VaultService();
