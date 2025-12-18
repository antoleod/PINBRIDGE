/**
 * Auth Module
 * Orchestrates vault setup and unlocking using a salted PIN hash.
 */

import { cryptoService } from '../../crypto/crypto.js';
import { storageService } from '../../storage/db.js';
import { Utils } from '../../utils/helpers.js';
import { bus } from '../../core/bus.js';

class AuthService {
    constructor() {
        this.isAuthenticated = false;
        this.currentUser = null;
        this.sessionKey = 'pinbridge_session';
        this.sessionTimeoutMs = 10 * 60 * 1000; // 10 minutes inactivity
        this.idleTimer = null;
        this.activityEvents = ['mousemove', 'keydown', 'click', 'touchstart', 'visibilitychange'];
        this.activityHandler = () => this.handleActivity();
    }

    /**
     * Flag that the one-time Recovery Key modal has been displayed.
     */
    async markRecoveryKeyShown() {
        await storageService.setMeta('recoveryKeyShown', true);
    }

    async recoveryKeyAlreadyShown() {
        return await storageService.getMeta('recoveryKeyShown');
    }

    /**
     * Initializes a new vault.
     * 1. Generates a salt for the PIN.
     * 2. Hashes the PIN.
     * 3. Generates a new recovery key and a salt for it.
     * 4. Hashes the recovery key.
     * 5. Saves the PIN salt, PIN hash, recovery salt, and recovery hash.
     */
    async initializeNewVault(username, pin) {
        try {
            const cleanUser = (username || '').trim();
            if (!cleanUser) {
                throw new Error('USERNAME_REQUIRED');
            }
            // 1. Handle PIN
            const pinSalt = cryptoService.generateSalt();
            const pinHash = await cryptoService.hashPin(pin, pinSalt);

            // 2. Handle Recovery Key
            const recoveryKey = Utils.bufferToHex(window.crypto.getRandomValues(new Uint8Array(32)));
            const recoverySalt = cryptoService.generateSalt();
            const recoveryHash = await cryptoService.hashPin(recoveryKey, recoverySalt);

            // 3. Save all auth materials
            await storageService.saveAuthData({
                pinSalt: Utils.bufferToHex(pinSalt),
                pinHash: pinHash,
                recoverySalt: Utils.bufferToHex(recoverySalt),
                recoveryHash: recoveryHash
            });

            // Mark that the recovery key has not been shown yet.
            await storageService.setMeta('recoveryKeyShown', false);
            await storageService.setMeta('auth_username', cleanUser);
            await storageService.setMeta('vault_username', cleanUser);

            return recoveryKey; // Return the raw key to show the user ONCE.
        } catch (e) {
            console.error("Vault setup failed", e);
            throw e;
        }
    }

    /**
     * Logs in by verifying the PIN hash.
     */
    async login(username, pin) {
        const userInput = (username || '').trim();
        if (!userInput) throw new Error('USERNAME_REQUIRED');
        if (!pin) throw new Error('PIN_REQUIRED');

        const authData = await storageService.getAuthData();
        if (!authData || !authData.pinSalt || !authData.pinHash) {
            throw new Error('VAULT_METADATA_MISSING');
        }

        const storedUser = await this.getStoredUsername();
        if (!storedUser || storedUser.toLowerCase() !== userInput.toLowerCase()) {
            throw new Error('INVALID_USER');
        }

        const saltBuf = Utils.hexToBuffer(authData.pinSalt);
        const computedHash = await cryptoService.hashPin(pin, saltBuf);

        if (computedHash === authData.pinHash) {
            this.startSession(storedUser);
            return true;
        } else {
            throw new Error('INVALID_PIN');
        }
    }

    /**
     * Recovers the vault by verifying the recovery key hash.
     */
    async recover(username, recoveryKey) {
        const userInput = (username || '').trim();
        if (!userInput) throw new Error('USERNAME_REQUIRED');
        if (!recoveryKey) throw new Error('RECOVERY_REQUIRED');

        const authData = await storageService.getAuthData();
        if (!authData || !authData.recoverySalt || !authData.recoveryHash) {
            // If the vault is old and doesn't have recovery keys, this will fail.
            return false;
        }

        const storedUser = await this.getStoredUsername();
        if (!storedUser || storedUser.toLowerCase() !== userInput.toLowerCase()) {
            throw new Error('INVALID_USER');
        }
        
        try {
            const saltBuf = Utils.hexToBuffer(authData.recoverySalt);
            const computedHash = await cryptoService.hashPin(recoveryKey, saltBuf);

            if (computedHash === authData.recoveryHash) {
                this.startSession(storedUser);
                return true;
            }
        } catch (e) {
            console.error("Recovery failed", e);
        }

        return false;
    }

    /**
     * Checks if the database has been initialized with auth data.
     */
    async hasVault() {
        return await storageService.isInitialized();
    }

    async getStoredUsername() {
        const stored = await storageService.getMeta('auth_username');
        return stored ? String(stored).trim() : null;
    }

    startSession(user, { emit = true, lastActive } = {}) {
        this.isAuthenticated = true;
        this.currentUser = user;
        this.persistSession(lastActive);
        this.bindActivityWatchers();
        this.scheduleIdleTimer(lastActive);
        if (emit) bus.emit('auth:unlock');
    }

    persistSession(lastActive) {
        const payload = {
            status: 'active',
            user: this.currentUser,
            lastActive: lastActive || Date.now()
        };
        localStorage.setItem(this.sessionKey, JSON.stringify(payload));
    }

    restoreSession() {
        const raw = localStorage.getItem(this.sessionKey);
        if (!raw) return false;
        try {
            const session = JSON.parse(raw);
            if (session.status !== 'active' || !session.user) return false;
            const last = session.lastActive || 0;
            const expired = Date.now() - last > this.sessionTimeoutMs;
            if (expired) {
                this.forceLogout('idle');
                return false;
            }
            this.startSession(session.user, { emit: false, lastActive: last });
            return true;
        } catch {
            this.logout();
            return false;
        }
    }

    bindActivityWatchers() {
        this.unbindActivityWatchers();
        this.activityEvents.forEach(ev => document.addEventListener(ev, this.activityHandler, { passive: true }));
    }

    unbindActivityWatchers() {
        this.activityEvents.forEach(ev => document.removeEventListener(ev, this.activityHandler));
        if (this.idleTimer) clearTimeout(this.idleTimer);
    }

    handleActivity() {
        if (!this.isAuthenticated) return;
        this.persistSession();
        this.scheduleIdleTimer();
    }

    scheduleIdleTimer(lastActive) {
        clearTimeout(this.idleTimer);
        const last = lastActive || Date.now();
        const elapsed = Date.now() - last;
        const remaining = Math.max(this.sessionTimeoutMs - elapsed, 1000);
        this.idleTimer = setTimeout(() => this.forceLogout('idle'), remaining);
    }

    /**
     * Logs the user out by resetting the authentication flag.
     */
    logout() {
        this.isAuthenticated = false;
        this.currentUser = null;
        this.unbindActivityWatchers();
        localStorage.removeItem(this.sessionKey);
        console.log("Session locked and cleared.");
    }

    forceLogout(reason = 'manual') {
        this.logout();
        bus.emit('auth:locked', reason);
    }
}

export const authService = new AuthService();

