/* src/modules/coach/packLoader.js */

export const packLoader = {
    /**
     * Loads the default local pack.
     * Tries to fetch from strict path.
     */
    async loadLocalPack() {
        const path = 'src/modules/coach/fr_b1_mixed_premium_pack_100.json';
        try {
            const response = await fetch(path);
            if (!response.ok) {
                throw new Error(`Failed to fetch pack at ${path}: ${response.statusText}`);
            }
            const data = await response.json();
            this.validatePack(data);
            return data;
        } catch (error) {
            console.error("PackLoader Error:", error);
            throw error;
        }
    },

    validatePack(data) {
        if (!data.schema_version) throw new Error("Missing schema_version");
        if (!data.pack || !data.pack.pack_id || !data.pack.version) throw new Error("Missing pack metadata (id, version)");
        if (!data.cards || !Array.isArray(data.cards)) throw new Error("Missing cards array");
        if (data.cards.length === 0) throw new Error("Pack is empty");

        // Basic Card Validation
        const sample = data.cards[0];
        if (!sample.card_id || !sample.front_i18n || !sample.question_i18n) {
            throw new Error("Invalid card structure (missing id, front or question)");
        }
    }
};
