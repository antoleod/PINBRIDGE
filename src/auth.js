import { ensureAnonymousSession, onAuth, upgradeToEmail } from './firebase.js';
import { vaultService } from './vault.js';
import { bus } from './core/bus.js';

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

  async createVault(username, pin) {
    await this.ready;
    const recoveryKey = await vaultService.createNewVault({
      uid: this.uid,
      username,
      pin
    });
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
    this._bindActivityWatchers();
    this._handleActivity();
    bus.emit('auth:unlock');
  }

  async upgradeAccount(email, password) {
    await this.ready;
    return upgradeToEmail(email, password);
  }

  forceLogout(reason = 'manual') {
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

  _getOfflineUid() {
    const cached = localStorage.getItem(this.offlineUidKey);
    if (cached) return cached;
    const uid = `offline-${crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)}`;
    localStorage.setItem(this.offlineUidKey, uid);
    return uid;
  }
}

export const authService = new AuthService();
