/**
 * PINBRIDGE Crypto Service
 * Wrapper around Web Crypto API (SubtleCrypto).
 * 
 * SECURITY MODEL:
 * 1. MasterKey (MK): AES-GCM 256. Generated once. Never stored in plain text.
 * 2. PIN Key (PK): Derived from User PIN + Salt using PBKDF2.
 * 3. Wrapped Master Key (WMK): The MK encrypted with the PK. Stored in IDB.
 */

import { Utils } from '../utils/helpers.js';

const CONFIG = {
    PBKDF2_ITERATIONS: 100000,
    HASH: 'SHA-256',
    AES_ALGO: 'AES-GCM',
    KEY_LENGTH: 256
};

class CryptoService {
    constructor() {
        this.masterKey = null; // In-memory ONLY
    }

    /**
     * Generates a new random Salt for PBKDF2
     */
    generateSalt() {
        return window.crypto.getRandomValues(new Uint8Array(16));
    }

    /**
     * Generates a new random IV (Initialization Vector)
     */
    generateIV() {
        return window.crypto.getRandomValues(new Uint8Array(12)); // 96-bit for AES-GCM
    }

    /**
     * Phase 1: Registration - Generate a brand new Master Key
     */
    async generateMasterKey() {
        this.masterKey = await window.crypto.subtle.generateKey(
            {
                name: CONFIG.AES_ALGO,
                length: CONFIG.KEY_LENGTH,
            },
            true, // extractable (must be to wrap it)
            ['encrypt', 'decrypt', 'wrapKey', 'unwrapKey']
        );
        return this.masterKey;
    }

    /**
     * Derive a Key from PIN (PBKDF2)
     * Used for wrapping/unwrapping the Master Key.
     */
    async deriveKeyFromPin(pin, salt) {
        const pinBuffer = Utils.strToBuffer(pin);

        // 1. Import PIN as raw key material
        const importedKey = await window.crypto.subtle.importKey(
            'raw',
            pinBuffer,
            'PBKDF2',
            false,
            ['deriveKey']
        );

        // 2. Derive the actual AES-KW (KeyWrap) key
        return await window.crypto.subtle.deriveKey(
            {
                name: 'PBKDF2',
                salt: salt,
                iterations: CONFIG.PBKDF2_ITERATIONS,
                hash: CONFIG.HASH
            },
            importedKey,
            {
                name: 'AES-KW', // Used strictly for wrapping keys
                length: 256
            },
            true, // extractable? No, we just use it for wrap/unwrap
            ['wrapKey', 'unwrapKey']
        );
    }

    /**
     * Encrypts the MasterKey using the PIN-derived key
     */
    async exportMasterKey(pin, salt) {
        if (!this.masterKey) throw new Error("No Master Key in memory");

        const wrappingKey = await this.deriveKeyFromPin(pin, salt);

        const wrappedKeyBuffer = await window.crypto.subtle.wrapKey(
            'raw', // Format to export MK in before encryption
            this.masterKey,
            wrappingKey,
            'AES-KW'
        );

        return wrappedKeyBuffer;
    }

    /**
     * Imports (Unwraps) the Master Key using PIN
     */
    async importMasterKey(pin, salt, wrappedKeyBuffer) {
        try {
            const unwrappingKey = await this.deriveKeyFromPin(pin, salt);

            this.masterKey = await window.crypto.subtle.unwrapKey(
                'raw',
                wrappedKeyBuffer,
                unwrappingKey,
                'AES-KW',
                {
                    name: CONFIG.AES_ALGO
                },
                true,
                ['encrypt', 'decrypt']
            );
            return true;
        } catch (e) {
            console.error("Failed to unwrap key. Wrong PIN?", e);
            throw new Error("Invalid Credentials"); // Generic error
        }
    }

    /**
     * Encrypt Data (String -> Encrypted Object)
     */
    async encryptData(plainText) {
        if (!this.masterKey) throw new Error("Vault locked");

        const iv = this.generateIV();
        const encodedData = Utils.strToBuffer(plainText);

        const encryptedBuffer = await window.crypto.subtle.encrypt(
            {
                name: CONFIG.AES_ALGO,
                iv: iv
            },
            this.masterKey,
            encodedData
        );

        return {
            iv: Utils.bufferToHex(iv),
            content: Utils.bufferToHex(encryptedBuffer)
        };
    }

    /**
     * Decrypt Data (Encrypted Object -> String)
     */
    async decryptData(encryptedObj) {
        if (!this.masterKey) throw new Error("Vault locked");

        const iv = Utils.hexToBuffer(encryptedObj.iv);
        const data = Utils.hexToBuffer(encryptedObj.content);

        const decryptedBuffer = await window.crypto.subtle.decrypt(
            {
                name: CONFIG.AES_ALGO,
                iv: iv
            },
            this.masterKey,
            data
        );

        return Utils.bufferToStr(decryptedBuffer);
    }

    /**
     * Returns a SHA-256 fingerprint of the master key for integrity checks.
     */
    async getMasterKeyFingerprint() {
        if (!this.masterKey) throw new Error("Vault locked");
        const rawKey = await window.crypto.subtle.exportKey('raw', this.masterKey);
        return await Utils.sha256Hex(new Uint8Array(rawKey));
    }
}

export const cryptoService = new CryptoService();
