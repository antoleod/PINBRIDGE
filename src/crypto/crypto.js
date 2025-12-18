import { Utils } from '../utils/helpers.js';

const CONFIG = {
    PBKDF2_ITERATIONS: 120000,
    HASH: 'SHA-256',
    KEY_LENGTH: 256,
    GCM_IV_BYTES: 12
};

class CryptoService {
    generateSalt() {
        return crypto.getRandomValues(new Uint8Array(16));
    }

    async deriveKeyFromSecret(secret, salt) {
        const secretBuffer = Utils.strToBuffer(secret);
        const baseKey = await crypto.subtle.importKey(
            'raw',
            secretBuffer,
            { name: 'PBKDF2' },
            false,
            ['deriveKey']
        );

        return crypto.subtle.deriveKey(
            {
                name: 'PBKDF2',
                salt,
                iterations: CONFIG.PBKDF2_ITERATIONS,
                hash: CONFIG.HASH
            },
            baseKey,
            { name: 'AES-GCM', length: CONFIG.KEY_LENGTH },
            false,
            ['encrypt', 'decrypt']
        );
    }

    async generateDataKey() {
        return crypto.subtle.generateKey(
            { name: 'AES-GCM', length: CONFIG.KEY_LENGTH },
            true,
            ['encrypt', 'decrypt']
        );
    }

    async exportKeyBytes(key) {
        const raw = await crypto.subtle.exportKey('raw', key);
        return new Uint8Array(raw);
    }

    async wrapKey(dataKey, wrappingKey) {
        const iv = crypto.getRandomValues(new Uint8Array(CONFIG.GCM_IV_BYTES));
        const raw = await this.exportKeyBytes(dataKey);
        const cipherBuffer = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv },
            wrappingKey,
            raw
        );
        const payload = new Uint8Array(iv.byteLength + cipherBuffer.byteLength);
        payload.set(iv, 0);
        payload.set(new Uint8Array(cipherBuffer), iv.byteLength);
        return Utils.bufferToBase64(payload);
    }

    async unwrapKey(wrappedBase64, wrappingKey) {
        const payload = Utils.base64ToBuffer(wrappedBase64);
        const iv = payload.slice(0, CONFIG.GCM_IV_BYTES);
        const ciphertext = payload.slice(CONFIG.GCM_IV_BYTES);
        const rawKey = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv },
            wrappingKey,
            ciphertext
        );
        return crypto.subtle.importKey(
            'raw',
            rawKey,
            { name: 'AES-GCM' },
            false,
            ['encrypt', 'decrypt']
        );
    }

    async encryptObject(obj, key) {
        const iv = crypto.getRandomValues(new Uint8Array(CONFIG.GCM_IV_BYTES));
        const plaintext = Utils.strToBuffer(JSON.stringify(obj));
        const cipherBuffer = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv },
            key,
            plaintext
        );
        const payload = new Uint8Array(iv.byteLength + cipherBuffer.byteLength);
        payload.set(iv, 0);
        payload.set(new Uint8Array(cipherBuffer), iv.byteLength);
        return Utils.bufferToBase64(payload);
    }

    async decryptObject(payloadBase64, key) {
        const payload = Utils.base64ToBuffer(payloadBase64);
        const iv = payload.slice(0, CONFIG.GCM_IV_BYTES);
        const ciphertext = payload.slice(CONFIG.GCM_IV_BYTES);
        const plainBuffer = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv },
            key,
            ciphertext
        );
        const json = Utils.bufferToStr(new Uint8Array(plainBuffer));
        return JSON.parse(json);
    }

    wipeBytes(arr) {
        if (!arr) return;
        for (let i = 0; i < arr.length; i += 1) {
            arr[i] = 0;
        }
    }
}

export const cryptoService = new CryptoService();
