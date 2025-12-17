/**
 * PINBRIDGE Crypto Service
 * Simplified for PIN hashing and authentication.
 * 
 * SECURITY MODEL:
 * 1. A salted hash of the user's PIN is stored.
 * 2. Login works by re-computing the hash with the same salt and comparing.
 */

import { Utils } from '../utils/helpers.js';

const CONFIG = {
    PBKDF2_ITERATIONS: 100000,
    HASH: 'SHA-256',
};

class CryptoService {
    constructor() {
        // No more in-memory master key. Session state is handled by authService.
    }

    /**
     * Generates a new random Salt for PBKDF2
     */
    generateSalt() {
        return window.crypto.getRandomValues(new Uint8Array(16));
    }

    /**
     * Derives a key from a PIN using PBKDF2 for password hashing.
     * The output is a hex string representation of the hash.
     * @param {string} pin The user's PIN.
     * @param {Uint8Array} salt The salt to use.
     * @returns {Promise<string>} The derived hash as a hex string.
     */
    async hashPin(pin, salt) {
        const pinBuffer = Utils.strToBuffer(pin);

        const importedKey = await window.crypto.subtle.importKey(
            'raw',
            pinBuffer,
            'PBKDF2',
            false,
            ['deriveBits']
        );

        // Derive a 256-bit hash.
        const derivedKeyBuffer = await window.crypto.subtle.deriveBits(
            {
                name: 'PBKDF2',
                salt: salt,
                iterations: CONFIG.PBKDF2_ITERATIONS,
                hash: CONFIG.HASH
            },
            importedKey,
            256 
        );
        
        return Utils.bufferToHex(new Uint8Array(derivedKeyBuffer));
    }
}

export const cryptoService = new CryptoService();
