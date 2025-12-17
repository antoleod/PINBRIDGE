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
    async initializeNewVault(pin) {
        try {
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

            return recoveryKey; // Return the raw key to show the user ONCE.
        } catch (e) {
            console.error("Vault setup failed", e);
            throw e;
        }
    }

    /**
     * Logs in by verifying the PIN hash.
     */
    async login(pin) {
        const authData = await storageService.getAuthData();
        if (!authData || !authData.pinSalt || !authData.pinHash) {
            throw new Error('VAULT_METADATA_MISSING');
        }

        const saltBuf = Utils.hexToBuffer(authData.pinSalt);
        const computedHash = await cryptoService.hashPin(pin, saltBuf);

        if (computedHash === authData.pinHash) {
            this.isAuthenticated = true;
            bus.emit('auth:unlock');
            return true;
        } else {
            throw new Error('INVALID_PIN');
        }
    }

    /**
     * Recovers the vault by verifying the recovery key hash.
     */
    async recover(recoveryKey) {
        const authData = await storageService.getAuthData();
        if (!authData || !authData.recoverySalt || !authData.recoveryHash) {
            // If the vault is old and doesn't have recovery keys, this will fail.
            return false;
        }
        
        try {
            const saltBuf = Utils.hexToBuffer(authData.recoverySalt);
            const computedHash = await cryptoService.hashPin(recoveryKey, saltBuf);

            if (computedHash === authData.recoveryHash) {
                this.isAuthenticated = true;
                bus.emit('auth:unlock');
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

    /**
     * Logs the user out by resetting the authentication flag.
     */
    logout() {
        this.isAuthenticated = false;
        localStorage.removeItem('pinbridge_session');
        console.log("Session locked and cleared.");
    }
}

export const authService = new AuthService();

