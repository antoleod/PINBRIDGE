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
