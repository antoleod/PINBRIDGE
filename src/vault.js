import { cryptoService } from './crypto/crypto.js';
import { storageService } from './storage/db.js';
import { syncService } from './sync.js';
import { Utils } from './utils/helpers.js';
import { bus } from './core/bus.js';
import { syncManager } from './modules/sync/sync-manager.js';
import { canAccessAdmin, coerceRole, ROLES } from './core/rbac.js';

class VaultService {
  constructor() {
    this.dataKey = null;
    this.meta = null;
    this.vault = { notes: [], meta: {} };
    this.uid = null;
    this.authUid = null;
    this.localUpdatedAt = null;
    this.localUpdatedAtMs = 0;
    this.realtimeUnsub = null;
    this.syncEnabled = localStorage.getItem('pinbridge.sync_enabled') === 'true';
    this.deviceId = localStorage.getItem('pinbridge.device_id') || (crypto?.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));
    localStorage.setItem('pinbridge.device_id', this.deviceId);
  }

  async init(uid) {
    this.authUid = uid;
    this.uid = sessionStorage.getItem('pb_session_vault_id') || null;
    await storageService.init('pinbridge_db');
    this.meta = await storageService.getCryptoMeta();
    const stored = await storageService.getEncryptedVault();
    this.localUpdatedAt = stored?.updatedAt || null;
    this.localUpdatedAtMs = stored?.updatedAtMs || (this.localUpdatedAt ? Date.parse(this.localUpdatedAt) : 0) || 0;
  }

  _toEpochMs(updatedAtMs, updatedAtIso) {
    if (typeof updatedAtMs === 'number' && Number.isFinite(updatedAtMs)) return updatedAtMs;
    const parsed = Date.parse(updatedAtIso || '');
    return Number.isFinite(parsed) ? parsed : 0;
  }

  _computeVaultUpdatedMs() {
    const notes = Array.isArray(this.vault?.notes) ? this.vault.notes : [];
    let max = 0;
    for (const note of notes) {
      const v = typeof note?.updated === 'number' ? note.updated : 0;
      if (v > max) max = v;
    }
    // Fallback to monotonic "now" to cover settings/meta-only updates.
    return Math.max(max, Date.now());
  }

  ensureSyncActive() {
    if (!this.syncEnabled || !this.uid || !this.dataKey) return false;
    if (!navigator.onLine) {
      bus.emit('sync:status', 'offline');
      return false;
    }
    this._startRealtime();
    syncManager.processQueue();
    bus.emit('sync:status', 'online');
    return true;
  }

  setSyncEnabled(enabled) {
    this.syncEnabled = enabled;
    if (!enabled) {
      if (this.realtimeUnsub) this.realtimeUnsub();
      this.realtimeUnsub = null;
      return;
    }
    if (!this.uid || !this.dataKey) return;
    this._startRealtime();
    this.persistVault().catch((e) => {
      console.warn('Sync enable persist failed', e);
    });
  }

  isUnlocked() {
    return !!this.dataKey;
  }

  async hasExistingVault() {
    if (this.meta) return true;
    if (!this.syncEnabled || !this.uid) return false;
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

  async createNewVault({ uid, username, pin, role = ROLES.USER }) {
    this.uid = uid;
    await storageService.resetAll();

    const dataKey = await cryptoService.generateDataKey();
    const keySalt = cryptoService.generateSalt();
    const recoverySalt = cryptoService.generateSalt();
    const recoveryKey = Utils.bufferToHex(crypto.getRandomValues(new Uint8Array(32)));
    const safeRole = coerceRole(role, username);

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
      role: safeRole,
      updatedAt: now
    };

    this.dataKey = dataKey;
    this.vault = { notes: [], meta: { createdAt: now, username: username || '', role: safeRole } };

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
    if (!this.meta) {
      throw new Error('NO_VAULT');
    }
    this.meta.role = coerceRole(this.meta.role, this.meta.username);
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
    this.meta = this.meta || null;
    if (this.meta) {
      this.meta.role = coerceRole(this.meta.role, this.meta.username);
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
    if (!this.vault) {
      console.warn('Vault not initialized, returning empty notes array');
      return [];
    }
    return this.vault.notes || [];
  }

  async upsertNote(note) {
    if (!this.vault.notes) this.vault.notes = [];
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
    const updatedAtMs = this._computeVaultUpdatedMs();
    const updatedAt = new Date(updatedAtMs).toISOString();
    this.vault.meta = this.vault.meta || {};
    this.vault.meta.updatedAt = updatedAt;
    const payload = await cryptoService.encryptObject(this.vault, this.dataKey);
    const record = {
      version: '1.0',
      updatedAt,
      updatedAtMs,
      deviceId: this.deviceId,
      cipher: 'AES-GCM',
      payload
    };
    this.localUpdatedAt = updatedAt;
    this.localUpdatedAtMs = updatedAtMs;
    await storageService.saveEncryptedVault(record);

    if (this.syncEnabled) {
      // Use Queue with optimization
      try {
        if (typeof syncManager !== 'undefined') syncManager.enqueueOrUpdate('PUSH_VAULT', record, this.uid);
      } catch (e) {
        console.warn('Sync push failed, but local saved', e);
        bus.emit('vault:saved-local-only', now);
      }
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
      if (this.meta) {
        this.meta.role = coerceRole(this.meta.role, this.meta.username);
      }
      if (this.vault.meta) {
        this.vault.meta.role = coerceRole(this.vault.meta.role, this.vault.meta.username || this.meta?.username);
      }

      // If merge changed something or remote was newer, we save local.
      // If we merged remote data in, we should persist.
      await storageService.saveEncryptedVault(mergedRecord);
    } else {
      // Init empty
      const fallbackRole = coerceRole(this.meta?.role, this.meta?.username);
      this.vault = { notes: [], meta: { createdAt: new Date().toISOString(), username: this.meta?.username || '', role: fallbackRole } };
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
    } catch (e) {
      console.error('Local decrypt fail', e);
      if (remoteRecord) {
        try {
          const data = await cryptoService.decryptObject(remoteRecord.payload, this.dataKey);
          return { mergedRecord: remoteRecord, mergedData: data };
        } catch (re) { console.error('Remote decrypt fail', re); }
      }
      return { mergedRecord: null, mergedData: null };
    }

    try {
      remoteData = await cryptoService.decryptObject(remoteRecord.payload, this.dataKey);
    } catch (e) { console.error('Remote decrypt fail', e); return { mergedRecord: localRecord, mergedData: localData }; }

    // Map merge
    const noteMap = new Map();
    (localData.notes || []).forEach(n => noteMap.set(n.id, n));

    // Merge remote into local
    (remoteData.notes || []).forEach(rNote => {
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
    let maxNoteMs = 0;
    for (const note of mergedNotes) {
      const v = typeof note?.updated === 'number' ? note.updated : 0;
      if (v > maxNoteMs) maxNoteMs = v;
    }

    const localMs = this._toEpochMs(localRecord?.updatedAtMs, localRecord?.updatedAt);
    const remoteMs = this._toEpochMs(remoteRecord?.updatedAtMs, remoteRecord?.updatedAt);
    const mergedUpdatedAtMs = Math.max(localMs, remoteMs, maxNoteMs);
    const mergedUpdatedAt = new Date(mergedUpdatedAtMs).toISOString();

    const mergedData = {
      ...localData,
      notes: mergedNotes,
      meta: { ...localData.meta, updatedAt: mergedUpdatedAt }
    };

    // Re-encrypt
    const payload = await cryptoService.encryptObject(mergedData, this.dataKey);
    const mergedRecord = {
      version: '1.0',
      updatedAt: mergedUpdatedAt,
      updatedAtMs: mergedUpdatedAtMs,
      deviceId: this.deviceId,
      cipher: 'AES-GCM',
      payload
    };

    return { mergedRecord, mergedData };
  }

  async _handleRemoteSnapshot(doc) {
    if (!doc || !this.dataKey) return; // Ignore if locked

    // Check timestamps to avoid loops
    const remoteTime = this._toEpochMs(doc.updatedAtMs, doc.updatedAt);
    const localTime = this.localUpdatedAtMs || this._toEpochMs(null, this.localUpdatedAt);

    if (remoteTime <= localTime) return; // We are up to date or ahead

    console.log('Remote update detected, merging...');
    const local = await storageService.getEncryptedVault();
    const { mergedRecord, mergedData } = await this._smartMerge(local, doc);

    if (mergedData) {
      this.vault = mergedData;
      this.localUpdatedAt = mergedRecord.updatedAt;
      this.localUpdatedAtMs = mergedRecord.updatedAtMs || this._toEpochMs(null, mergedRecord.updatedAt);
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
      if (this.uid) sessionStorage.setItem('pb_session_vault_id', this.uid);
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
      sessionStorage.removeItem('pb_session_vault_id');
      return false;
    }
  }

  clearSession() {
    sessionStorage.removeItem('pb_session_key');
    sessionStorage.removeItem('pb_session_vault_id');
  }

  async fileRecoveryResetRequest() {
    syncManager.enqueue('RECOVERY_REQUEST', {}, this.uid);
  }

  getRole() {
    const username = this.meta?.username || this.vault?.meta?.username || '';
    const role = this.meta?.role || this.vault?.meta?.role || ROLES.USER;
    return coerceRole(role, username);
  }

  isAdmin() {
    return canAccessAdmin(this.meta || this.vault?.meta);
  }

  async exportRecoveryFile({ username, partialPin }) {
    if (!this.dataKey) throw new Error('LOCKED');
    const safeUsername = (username || '').trim();
    const safePin = (partialPin || '').trim();
    if (!safeUsername || !safePin) throw new Error('RECOVERY_REQUIRED');

    const salt = cryptoService.generateSalt();
    const wrappingKey = await cryptoService.deriveKeyFromSecret(`${safeUsername}:${safePin}`, salt);
    const wrappedKey = await cryptoService.wrapKey(this.dataKey, wrappingKey);

    return JSON.stringify({
      version: '1.0',
      type: 'pinbridge-recovery-file',
      createdAt: new Date().toISOString(),
      username: safeUsername,
      salt: Utils.bufferToBase64(salt),
      wrappedKey
    });
  }

  async unlockWithRecoveryFile({ uid, fileContent, username, partialPin }) {
    this.uid = uid;
    if (!this.meta && this.syncEnabled) {
      const remoteMeta = await syncService.fetchMeta(uid);
      if (!remoteMeta) throw new Error('NO_VAULT');
      this.meta = remoteMeta;
      await storageService.saveCryptoMeta(remoteMeta);
    }
    if (!this.meta) throw new Error('NO_VAULT');

    let payload;
    try {
      payload = typeof fileContent === 'string' ? JSON.parse(fileContent) : fileContent;
    } catch (e) {
      throw new Error('RECOVERY_FILE_INVALID');
    }

    if (!payload || payload.type !== 'pinbridge-recovery-file') {
      throw new Error('RECOVERY_FILE_INVALID');
    }

    const salt = Utils.base64ToBuffer(payload.salt || '');
    const safeUsername = (username || '').trim();
    const safePin = (partialPin || '').trim();
    const wrappingKey = await cryptoService.deriveKeyFromSecret(`${safeUsername}:${safePin}`, salt);
    try {
      this.dataKey = await cryptoService.unwrapKey(payload.wrappedKey, wrappingKey);
      await this._loadLatestVault();
      this._startRealtime();
    } catch (e) {
      throw new Error('INVALID_PIN');
    }
  }

  async unlockWithDataKey({ uid, dataKey }) {
    this.uid = uid;
    if (!this.meta && this.syncEnabled) {
      const remoteMeta = await syncService.fetchMeta(uid);
      if (!remoteMeta) throw new Error('NO_VAULT');
      this.meta = remoteMeta;
      await storageService.saveCryptoMeta(remoteMeta);
    }
    if (!this.meta) throw new Error('NO_VAULT');
    this.dataKey = dataKey;
    await this._loadLatestVault();
    this._startRealtime();
  }
}

export const vaultService = new VaultService();
