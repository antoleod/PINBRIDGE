import { cryptoService } from './crypto/crypto.js';
import { storageService } from './storage/db.js';
import { syncService } from './sync.js';
import { Utils } from './utils/helpers.js';
import { bus } from './core/bus.js';

class VaultService {
  constructor() {
    this.dataKey = null;
    this.meta = null;
    this.vault = { notes: [], meta: {} };
    this.uid = null;
    this.localUpdatedAt = null;
    this.realtimeUnsub = null;
    this.onlineHandler = () => this._resyncPending();
    this.syncEnabled = true;
  }

  async init(uid) {
    this.uid = uid;
    await storageService.init('pinbridge_db');
    this.meta = await storageService.getCryptoMeta();
    this.localUpdatedAt = (await storageService.getEncryptedVault())?.updatedAt || null;
    window.addEventListener('online', this.onlineHandler);
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
      try {
        await syncService.pushMeta(this.uid, this.meta);
      } catch (e) {
        console.warn('Meta sync deferred (offline)', e);
      }
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
      try {
        await syncService.pushVault(this.uid, record);
      } catch (e) {
        console.warn('Deferred sync (offline)', e);
      }
    }
    bus.emit('vault:saved', now);
  }

  async _loadLatestVault() {
    const local = await storageService.getEncryptedVault();
    let remote = null;
    if (this.syncEnabled) {
      try {
        remote = await syncService.fetchVault(this.uid);
      } catch (e) {
        console.warn('Vault fetch offline', e);
      }
    }
    const latest = this._pickLatest(local, remote);
    if (latest) {
      await this._decryptIntoMemory(latest);
    } else {
      this.vault = { notes: [], meta: { createdAt: new Date().toISOString(), username: this.meta?.username || '' } };
      await this.persistVault();
    }
  }

  async _decryptIntoMemory(doc) {
    this.vault = await cryptoService.decryptObject(doc.payload, this.dataKey);
    this.localUpdatedAt = doc.updatedAt;
    await storageService.saveEncryptedVault(doc);
  }

  _pickLatest(localDoc, remoteDoc) {
    if (localDoc && !remoteDoc) return localDoc;
    if (!localDoc && remoteDoc) return remoteDoc;
    if (!localDoc && !remoteDoc) return null;
    const localTime = new Date(localDoc.updatedAt || 0).getTime();
    const remoteTime = new Date(remoteDoc.updatedAt || 0).getTime();
    return remoteTime > localTime ? remoteDoc : localDoc;
  }

  async _handleRemoteSnapshot(doc) {
    if (!doc) return;
    const remoteTime = new Date(doc.updatedAt || 0).getTime();
    const localTime = new Date(this.localUpdatedAt || 0).getTime();
    if (remoteTime > localTime) {
      await this._decryptIntoMemory(doc);
      bus.emit('vault:remote-update', doc.updatedAt);
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
    window.removeEventListener('online', this.onlineHandler);
    bus.emit('vault:locked');
  }

  async fileRecoveryResetRequest() {
    await syncService.createRecoveryRequest(this.uid);
  }

  async _resyncPending() {
    if (!this.uid) return;
    if (!this.syncEnabled) return;
    if (this.meta) {
      try {
        await syncService.pushMeta(this.uid, this.meta);
      } catch (e) {
        console.warn('Meta resync failed', e);
      }
    }
    const cachedVault = await storageService.getEncryptedVault();
    if (cachedVault) {
      try {
        await syncService.pushVault(this.uid, cachedVault);
      } catch (e) {
        console.warn('Vault resync failed', e);
      }
    }
  }
}

export const vaultService = new VaultService();
