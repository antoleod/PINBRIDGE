import { ensureAnonymousSession, onAuth, upgradeToEmail } from './firebase.js';
import { vaultService } from './vault.js';
import { bus } from './core/bus.js';
import { uiService } from './ui/ui.js';
import { storageService } from './storage/db.js';
import { isAdminUsername } from './core/rbac.js';
import { validatePin, validateUsername } from './core/validation.js';

/**
 * SECURITY ARCHITECT NOTE:
 * AuthService manages authentication and high-level recovery flows.
 * CRITICAL: Auth Settings (pre-login) must NEVER access decrypted vault data or require a PIN.
 * Pre-login actions are limited to recovery initialization and device sync handshakes.
 */

class AuthService {
  constructor() {
    this.uid = null;
    this.ready = new Promise((resolve) => {
      this._resolveReady = resolve;
    });
    this.sessionTimeoutMs = 10 * 60 * 1000;
    this.warningThresholdMs = 60 * 1000; // Warn 60s before
    this.lastActivity = Date.now();
    this.checkInterval = null;
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
    bus.emit('auth:locked', 'no-session');
    return false;
  }

  async createVault(username, pin, role = 'user') {
    await this.ready;
    const recoveryKey = await vaultService.createNewVault({
      uid: this.uid,
      username,
      pin,
      role
    });
    await vaultService.saveSession();
    this._bindActivityWatchers();
    this._handleActivity();
    bus.emit('auth:unlock');
    return recoveryKey;
  }

  async register(username, pin, adminInviteCode = '') {
    await this.ready;
    const usernameCheck = validateUsername(username);
    if (!usernameCheck.ok) {
      throw new Error(usernameCheck.code);
    }
    const pinCheck = validatePin(pin);
    if (!pinCheck.ok) {
      throw new Error(pinCheck.code);
    }
    const existing = await vaultService.hasExistingVault();
    if (existing) {
      throw new Error('USER_EXISTS');
    }
    let role = 'user';
    if (isAdminUsername(username)) {
      const invite = await storageService.getMeta('admin_invite');
      const isValid = invite && invite.code === adminInviteCode && invite.expiresAt > Date.now();
      if (!isValid) {
        throw new Error('ADMIN_INVITE_REQUIRED');
      }
      role = 'admin';
    }
    return this.createVault(usernameCheck.value, pinCheck.value, role);
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
      const fileContent = await vaultService.exportRecoveryFile({ username, partialPin });
      this._downloadFile(fileContent, 'pinbridge-recovery.pinbridge.json', 'application/json');
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
    await vaultService.unlockWithRecoveryFile({
      uid: this.uid,
      fileContent,
      username,
      partialPin
    });
    await vaultService.saveSession();
    this._bindActivityWatchers();
    this._handleActivity();
    bus.emit('auth:unlock');
  }

  async unlockWithDataKey(dataKey) {
    await this.ready;
    await vaultService.unlockWithDataKey({
      uid: this.uid,
      dataKey
    });
    await vaultService.saveSession();
    this._bindActivityWatchers();
    this._handleActivity();
    bus.emit('auth:unlock');
  }

  forceLogout(reason = 'manual') {
    vaultService.clearSession();
    vaultService.lock();
    this._clearActivityWatchers();
    bus.emit('auth:locked', reason);
  }

  _handleActivity() {
    this.lastActivity = Date.now();
    bus.emit('auth:activity');
  }

  _bindActivityWatchers() {
    this._clearActivityWatchers();
    this.activityEvents.forEach(ev => document.addEventListener(ev, this.activityHandler, { passive: true }));
    this.lastActivity = Date.now();

    this.checkInterval = setInterval(() => {
      const now = Date.now();
      const elapsed = now - this.lastActivity;
      const remaining = this.sessionTimeoutMs - elapsed;

      if (remaining <= 0) {
        this.forceLogout('idle');
      } else if (remaining <= this.warningThresholdMs) {
        bus.emit('auth:session-warning', Math.ceil(remaining / 1000));
      }
    }, 1000);
  }

  _clearActivityWatchers() {
    this.activityEvents.forEach(ev => document.removeEventListener(ev, this.activityHandler));
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
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
