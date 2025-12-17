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
            const fingerprint = await cryptoService.getMasterKeyFingerprint();
            await storageService.setMeta('auth_master_hash', fingerprint);

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
        if (!authData || !authData.salt || !authData.wrappedKey) {
            throw new Error('VAULT_METADATA_MISSING');
        }

        const saltBuf = new Uint8Array(Utils.hexToBuffer(authData.salt));
        const wrappedBuf = Utils.hexToBuffer(authData.wrappedKey);

        try {
            await cryptoService.importMasterKey(pin, saltBuf, wrappedBuf);
            await this.ensureMasterKeyFingerprintMatches();
            bus.emit('auth:unlock');
            return true;
        } catch (err) {
            if (err?.message === 'Invalid Credentials') {
                throw new Error('INVALID_PIN');
            }
            console.error('Login failed', err);
            throw new Error('VAULT_CORRUPT');
        }
    }

    async recover(secretString) {
        // Try as Recovery Key (Hex)
        // OR Backup Code (Short string?)
        // OR Answer (String)

        const authData = await storageService.getAuthData();
        if (!authData) return false;
        const salt = new Uint8Array(Utils.hexToBuffer(authData.salt));

        // Strategy: We have multiple wrapped keys stored in meta.
        // We need to try to unwrap EACH of them with the provided secret.
        // 1. Primary Recovery Key
        try {
            if (authData.recoveryWrappedKey) {
                const wrapped = Utils.hexToBuffer(authData.recoveryWrappedKey);
                await cryptoService.importMasterKey(secretString, salt, wrapped);
                await this.ensureMasterKeyFingerprintMatches();
                bus.emit('auth:unlock');
                return true;
            }
        } catch (e) { }

        // 2. Try Backup Codes
        const backupCodesBlob = await storageService.getMeta('auth_backup_codes_blob'); // Array of wrapped keys?
        if (backupCodesBlob) {
            for (const wrapped of backupCodesBlob) {
                try {
                    const wrappedBuf = Utils.hexToBuffer(wrapped);
                    await cryptoService.importMasterKey(secretString, salt, wrappedBuf);
                    await this.ensureMasterKeyFingerprintMatches();
                    bus.emit('auth:unlock');
                    return true;
                } catch (e) { }
            }
        }

        // 3. Try Q&A
        const qaWrapped = await storageService.getMeta('auth_qa_wrapped');
        if (qaWrapped) {
            try {
                const qaBuf = Utils.hexToBuffer(qaWrapped);
                await cryptoService.importMasterKey(secretString, salt, qaBuf);
                await this.ensureMasterKeyFingerprintMatches();
                bus.emit('auth:unlock');
                return true;
            } catch (e) { }
        }

        return false;
    }

    async ensureMasterKeyFingerprintMatches() {
        const stored = await storageService.getMeta('auth_master_hash');
        const current = await cryptoService.getMasterKeyFingerprint();
        if (stored && stored !== current) {
            console.error('Master key fingerprint mismatch', { stored, current });
            throw new Error('VAULT_CORRUPT');
        }
        if (!stored) {
            await storageService.setMeta('auth_master_hash', current);
        }
    }

    // --- EXTENDED RECOVERY METHODS ---

    async saveHint(hintText) {
        await storageService.setMeta('auth_hint', hintText);
    }

    async getHint() {
        return await storageService.getMeta('auth_hint');
    }

    async setupQA(answer) {
        if (!cryptoService.masterKey) throw new Error("Vault locked");
        const authData = await storageService.getAuthData();
        const salt = new Uint8Array(Utils.hexToBuffer(authData.salt));

        const wrapped = await cryptoService.exportMasterKey(answer, salt);
        await storageService.setMeta('auth_qa_wrapped', Utils.bufferToHex(wrapped));
    }

    async generateBackupCodes() {
        if (!cryptoService.masterKey) throw new Error("Vault locked");
        const authData = await storageService.getAuthData();
        const salt = new Uint8Array(Utils.hexToBuffer(authData.salt));

        const codes = [];
        const wrappedBlobs = [];

        for (let i = 0; i < 5; i++) {
            const code = Utils.uuidv4().substring(0, 8).toUpperCase(); // Short code
            codes.push(code);
            const wrapped = await cryptoService.exportMasterKey(code, salt);
            wrappedBlobs.push(Utils.bufferToHex(wrapped));
        }

        await storageService.setMeta('auth_backup_codes_blob', wrappedBlobs);
        return codes;
    }

    async hasVault() {
        return await storageService.isInitialized();
    }
}

export const authService = new AuthService();
