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

    async importRawKey(rawBuffer) {
        return crypto.subtle.importKey(
            'raw',
            rawBuffer,
            { name: 'AES-GCM' },
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
            true,
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

    async encryptBytes(bytes, key) {
        const iv = crypto.getRandomValues(new Uint8Array(CONFIG.GCM_IV_BYTES));
        const plaintext = bytes instanceof Uint8Array ? bytes : (bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : new Uint8Array(0));
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

    async decryptBytes(payloadBase64, key) {
        const payload = Utils.base64ToBuffer(payloadBase64);
        const iv = payload.slice(0, CONFIG.GCM_IV_BYTES);
        const ciphertext = payload.slice(CONFIG.GCM_IV_BYTES);
        const plainBuffer = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv },
            key,
            ciphertext
        );
        return new Uint8Array(plainBuffer);
    }

    wipeBytes(arr) {
        if (!arr) return;
        for (let i = 0; i < arr.length; i += 1) {
            arr[i] = 0;
        }
    }

    async generateQRCode(text, options = {}) {
        const value = typeof text === 'string' ? text : JSON.stringify(text);
        const size = Number.isFinite(options.size) ? options.size : 220;
        if (!value) throw new Error('QR_DATA_REQUIRED');

        if (!this._qrLib) {
            this._qrLib = import('https://cdn.jsdelivr.net/npm/qrcode@1.5.3/+esm');
        }
        const qr = await this._qrLib;
        const toDataURL = qr?.toDataURL || qr?.default?.toDataURL;
        if (typeof toDataURL !== 'function') {
            throw new Error('QR_LIB_UNAVAILABLE');
        }

        return toDataURL(value, {
            width: size,
            margin: 1,
            color: {
                dark: '#000000',
                light: '#ffffff'
            }
        });
    }
}

export const cryptoService = new CryptoService();
