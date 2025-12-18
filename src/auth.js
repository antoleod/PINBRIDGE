import { ensureAnonymousSession, onAuth, upgradeToEmail } from './firebase.js';
import { vaultService } from './vault.js';
import { bus } from './core/bus.js';
import { uiService } from './ui/ui.js';

// Placeholder for vaultService methods that would be needed
// In a real implementation, these would be in vault.js and handle crypto.
// For this response, I'm just defining the interface AuthService would use.
// This mock should be removed once actual vaultService methods are implemented.
const mockVaultService = {
    ...vaultService, // Keep existing methods
    getVaultRecoveryKey: async () => {
        console.log('vaultService: Retrieving vault recovery key...');
        // This would securely retrieve the vault's recovery key from its internal storage.
        return 'super-secret-vault-recovery-key-from-vault-storage'; // Placeholder
    },
    encryptRecoveryKeyWithCredentials: async (recoveryKey, username, partialPin) => {
        console.log('vaultService: Encrypting recovery key with username and partial PIN...');
        // Example: derive key from username+partialPin using PBKDF2, then AES-GCM encrypt recoveryKey.
        return `encrypted:${recoveryKey}:${username}:${partialPin}`; // Simplified placeholder
    },
    decryptRecoveryKeyWithCredentials: async (encryptedFileContent, username, partialPin) => {
        console.log('vaultService: Decrypting recovery key from file with username and partial PIN...');
        // Example: derive key from username+partialPin, then AES-GCM decrypt fileContent.
        const parts = encryptedFileContent.split(':');
        if (parts[0] === 'encrypted' && parts[2] === username && parts[3] === partialPin) {
            return parts[1]; // Return the original recovery key
        }
        throw new Error('Invalid recovery file or credentials.');
    }
};
// In a real application, you would directly modify vault.js, not mock it here.
// For the purpose of demonstrating auth.js changes, we'll use the mock.
// const vaultService = mockVaultService; // Uncomment this line if you want to test with the mock

class AuthService {
  constructor() {
    this.uid = null;
    this.ready = new Promise((resolve) => {
      this._resolveReady = resolve;
    });
    this.idleTimer = null;
    this.sessionTimeoutMs = 10 * 60 * 1000;
    this.activityEvents = ['mousemove', 'keydown', 'click', 'touchstart', 'visibilitychange'];
    this.activityHandler = () => this._handleActivity();
    this.offlineMode = false;
    this.offlineUidKey = 'pinbridge.offline_uid';
  }

  async init() {
    try {
      await ensureAnonymousSession();
      onAuth(async (user) => {
        if (!user) return;
        this.offlineMode = false;
        vaultService.setSyncEnabled(true);
        this.uid = user.uid;
        window.__PINBRIDGE_UID = user.uid;
        this._resolveReady(user.uid);
        this._bindActivityWatchers();
      });
      return this.ready;
    } catch (err) {
      console.warn('Falling back to offline-only mode. Firebase auth unavailable.', err);
      this.offlineMode = true;
      vaultService.setSyncEnabled(false);
      const offlineUid = this._getOfflineUid();
      this.uid = offlineUid;
      this._resolveReady(offlineUid);
      this._bindActivityWatchers();
      bus.emit('sync:disabled', 'auth-unavailable');
      return this.ready;
    }
  }

  getUid() {
    return this.uid;
  }

  _getOfflineUid() {
    const cached = localStorage.getItem(this.offlineUidKey);
    if (cached) return cached;
    const uid = `offline-${crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)}`;
    localStorage.setItem(this.offlineUidKey, uid);
    return uid;
  }

  async restoreSession() {
    await this.ready;
    const restored = await vaultService.tryRestoreSession();
    if (restored) {
      this._bindActivityWatchers();
      this._handleActivity();
      bus.emit('auth:unlock');
      return true;
    }
    return false;
  }

  async createVault(username, pin) {
    await this.ready;
    const recoveryKey = await vaultService.createNewVault({
      uid: this.uid,
      username,
      pin
    });
    await vaultService.saveSession();
    this._bindActivityWatchers();
    this._handleActivity();
    bus.emit('auth:unlock');
    return recoveryKey;
  }

  async unlockWithPin(pin) {
    await this.ready;
    await vaultService.unlockWithPin({
      uid: this.uid,
      pin
    });
    await vaultService.saveSession();
    this._bindActivityWatchers();
    this._handleActivity();
    bus.emit('auth:unlock');
  }

  async unlockWithRecovery(recoveryKey) {
    await this.ready;
    await vaultService.unlockWithRecovery({
      uid: this.uid,
      recoveryKey
    });
    await vaultService.saveSession();
    this._bindActivityWatchers();
    this._handleActivity();
    bus.emit('auth:unlock');
  }

  async upgradeAccount(email, password) {
    await this.ready;
    return upgradeToEmail(email, password);
  }

  /**
   * Generates an encrypted recovery file and triggers its download.
   * The file content is encrypted using the provided username and partial PIN.
   * @param {string} username The user's username.
   * @param {string} partialPin A partial PIN used for encrypting the recovery file.
   * @returns {Promise<void>}
   */
  async generateAndDownloadRecoveryFile(username, partialPin) {
    await this.ready;
    if (!username || !partialPin) {
      uiService.showToast('Username and partial PIN are required to generate the recovery file.', 'error');
      throw new Error('Missing credentials for recovery file generation.');
    }

    try {
      const vaultRecoveryKey = await vaultService.getVaultRecoveryKey();
      const encryptedFileContent = await vaultService.encryptRecoveryKeyWithCredentials(
        vaultRecoveryKey,
        username,
        partialPin
      );
      this._downloadFile(encryptedFileContent, 'pinbridge-recovery.pinbridge.key', 'application/octet-stream');
      uiService.showToast('Recovery file generated and downloaded successfully!', 'success');
    } catch (error) {
      console.error('Error generating recovery file:', error);
      uiService.showToast('Failed to generate recovery file. Please try again.', 'error');
      throw error;
    }
  }

  /**
   * Unlocks the vault using an uploaded recovery file, username, and partial PIN.
   * @param {string} fileContent The content of the .pinbridge.key file.
   * @param {string} username The user's username.
   * @param {string} partialPin A partial PIN used for decrypting the recovery file.
   * @returns {Promise<void>}
   */
  async unlockWithRecoveryFile(fileContent, username, partialPin) {
    await this.ready;
    const decryptedRecoveryKey = await vaultService.decryptRecoveryKeyWithCredentials(
      fileContent,
      username,
      partialPin
    );
    await this.unlockWithRecovery(decryptedRecoveryKey); // Reuse existing unlockWithRecovery
  }

  forceLogout(reason = 'manual') {
    vaultService.clearSession();
    vaultService.lock();
    this._clearActivityWatchers();
    bus.emit('auth:locked', reason);
  }

  _handleActivity() {
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.forceLogout('idle'), this.sessionTimeoutMs);
  }

  _bindActivityWatchers() {
    this._clearActivityWatchers();
    this.activityEvents.forEach(ev => document.addEventListener(ev, this.activityHandler, { passive: true }));
    this._handleActivity();
  }

  _clearActivityWatchers() {
    this.activityEvents.forEach(ev => document.removeEventListener(ev, this.activityHandler));
    clearTimeout(this.idleTimer);
  }

  /**
   * Helper to trigger a file download in the browser.
   * @param {string} content The content of the file.
   * @param {string} filename The name of the file.
   * @param {string} mimeType The MIME type of the file.
   */
  _downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a); // Required for Firefox
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}

export const authService = new AuthService();
