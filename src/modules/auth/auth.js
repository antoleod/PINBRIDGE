/**
 * Auth Module
 * Orchestrates the secure setup and unlocking of the vault.
 */

import { cryptoService } from '../../crypto/crypto.js';
import { storageService } from '../../storage/db.js';
import { Utils } from '../../utils/helpers.js';
import { bus } from '../../core/bus.js';

class AuthService {

    /**
     * initializeNewVault (Registration)
     * 1. Generate new Master Key
     * 2. Generate random Salt
     * 3. Wrap Master Key with PIN+Salt
     * 4. Wrap Master Key with Recovery Key
     * 5. Save Salt & Wrapped Keys to Storage
     */
    async initializeNewVault(pin) {
        try {
            // 1. Generate MK
            await cryptoService.generateMasterKey();

            // 2. Generate Salt
            const salt = cryptoService.generateSalt();

            // 3. Wrap with PIN
            const wrappedKeyBuffer = await cryptoService.exportMasterKey(pin, salt);

            // 4. Generate Recovery Key (Random Hex, e.g. 64 chars)
            const recoveryKey = Utils.bufferToHex(window.crypto.getRandomValues(new Uint8Array(32)));

            // Wrap MK with Recovery Key (using same salt for simplicity in MVP)
            const recoveryWrappedBuffer = await cryptoService.exportMasterKey(recoveryKey, salt);

            // 5. Save
            const saltHex = Utils.bufferToHex(salt);
            const wrappedHex = Utils.bufferToHex(wrappedKeyBuffer);
            const recoveryWrappedHex = Utils.bufferToHex(recoveryWrappedBuffer);

            await storageService.saveAuthData(saltHex, wrappedHex, recoveryWrappedHex);

            return recoveryKey; // Return to show user
        } catch (e) {
            console.error("Setup failed", e);
            throw e;
        }
    }

    /**
     * login (Unlock)
     * 1. Get Salt & Wrapped Key from Storage
     * 2. Try to Unwrap with PIN
     * 3. If success, Master Key is now in memory
     */
    async login(pin) {
        const authData = await storageService.getAuthData();
        if (!authData) throw new Error("No vault found. Please setup first.");

        const salt = Utils.hexToBuffer(authData.salt);
        const wrappedKey = Utils.hexToBuffer(authData.wrappedKey);

        const success = await cryptoService.importMasterKey(pin, salt, wrappedKey);

        if (success) {
            bus.emit('auth:unlock', {});
        }
        return success;
    }

    /**
     * Recover (Unlock with Recovery Key)
     */
    async recover(recoveryKey) {
        const authData = await storageService.getAuthData();
        if (!authData || !authData.recoveryWrappedKey) throw new Error("Recovery not available");

        const salt = Utils.hexToBuffer(authData.salt);
        const wrappedKey = Utils.hexToBuffer(authData.recoveryWrappedKey);

        // Try to unwrap using the recovery key
        const success = await cryptoService.importMasterKey(recoveryKey, salt, wrappedKey);

        if (success) {
            bus.emit('auth:unlock', {});
        }
        return success;
    }

    async hasVault() {
        return await storageService.isInitialized();
    }
}

export const authService = new AuthService();
