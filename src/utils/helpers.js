/**
 * Helper Utilities
 */

export const Utils = {
    /**
     * Generate a random UUID v4
     */
    uuidv4() {
        return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c =>
            (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
        );
    },

    /**
     * Simple unique id helper (prefers crypto.randomUUID when available)
     */
    generateId() {
        if (typeof crypto.randomUUID === 'function') {
            return crypto.randomUUID();
        }
        return this.uuidv4();
    },

    /**
     * Convert ArrayBuffer to Hex String
     */
    bufferToHex(buffer) {
        return [...new Uint8Array(buffer)]
            .map(b => b.toString(16).padStart(2, "0"))
            .join("");
    },

    /**
     * Convert Hex String to ArrayBuffer
     */
    hexToBuffer(hex) {
        const tokens = hex.match(/.{1,2}/g);
        if (!tokens) return new Uint8Array(0);
        return new Uint8Array(tokens.map(byte => parseInt(byte, 16)));
    },

    /**
     * String to ArrayBuffer (UTF-8)
     */
    strToBuffer(str) {
        return new TextEncoder().encode(str);
    },

    /**
     * ArrayBuffer to String (UTF-8)
     */
    bufferToStr(buffer) {
        return new TextDecoder().decode(buffer);
    },

    /**
     * Encode ArrayBuffer / TypedArray to base64 string
     */
    bufferToBase64(buffer) {
        const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer;
        let binary = "";
        for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    },

    /**
     * Decode base64 string to Uint8Array
     */
    base64ToBuffer(base64) {
        const binary = atob(base64);
        const len = binary.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes;
    },

    /**
     * Encode UTF-8 string to base64
     */
    strToBase64(str) {
        const encoded = new TextEncoder().encode(str);
        return this.bufferToBase64(encoded);
    },

    /**
     * Decode base64 string to UTF-8 string
     */
    base64ToStr(base64) {
        const buffer = this.base64ToBuffer(base64);
        return this.bufferToStr(buffer);
    },

    /**
     * Compute SHA-256 hash returning hex string
     */
    async sha256Hex(value) {
        let buffer;
        if (typeof value === 'string') {
            buffer = this.strToBuffer(value);
        } else if (value instanceof ArrayBuffer) {
            buffer = new Uint8Array(value);
        } else if (value && value.buffer instanceof ArrayBuffer) {
            buffer = new Uint8Array(value.buffer);
        } else {
            buffer = new Uint8Array(0);
        }
        const hash = await crypto.subtle.digest('SHA-256', buffer);
        return this.bufferToHex(hash);
    },

    /**
     * Escape HTML entities to prevent injection in previews
     */
    escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }
};
