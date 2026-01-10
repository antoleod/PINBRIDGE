/* src/modules/coach/packLoader.js */

const BUNDLED_PACKS = [
    { id: 'en_b1_vocab_core_40', title: 'English B1 Core Vocabulary (40)', pathsToTry: ['src/public/packs/en_b1_vocab_core_40.json'] },
    { id: 'fr_b1_vocab_core_40', title: 'French B1 Core Vocabulary (40)', pathsToTry: ['src/public/packs/fr_b1_vocab_core_40.json'] },
    { id: 'nl_b1_vocab_core_40', title: 'Dutch B1 Core Vocabulary (40)', pathsToTry: ['src/public/packs/nl_b1_vocab_core_40.json'] },
    { id: 'azure_az900_core_50', title: 'Azure AZ-900 Core', pathsToTry: ['src/public/packs/azure_az900_core_50.json'] },
    { id: 'aws_saa_c03_core_50', title: 'AWS SAA-C03 Core', pathsToTry: ['src/public/packs/aws_saa_c03_core_50.json'] },
    {
        id: 'fr_b1_mixed_premium_pack_100',
        title: 'French B1 Mixed 100 (bundled)',
        pathsToTry: [
            'tests/fr_b1_mixed_premium_pack_100.json',
            'src/public/packs/fr_b1_mixed_premium_pack_100.json',
            'src/modules/coach/fr_b1_mixed_premium_pack_100.json'
        ]
    }
];

export const packLoader = {
    getBundledPacks() {
        return [...BUNDLED_PACKS];
    },

    async loadBundledPack(bundledId) {
        const entry = BUNDLED_PACKS.find(p => p.id === bundledId);
        if (!entry) throw new Error('UNKNOWN_BUNDLED_PACK');

        let lastError = null;
        for (const path of entry.pathsToTry) {
            try {
                const data = await this.loadFromUrl(path);
                return { ...data, _source: { type: 'bundled', bundledId, path } };
            } catch (e) {
                lastError = e;
            }
        }
        throw lastError || new Error('BUNDLED_PACK_LOAD_FAILED');
    },

    async loadFromUrl(path) {
        const response = await fetch(path, { cache: 'no-store' });
        if (!response.ok) throw new Error(`Failed to fetch pack at ${path}: ${response.status} ${response.statusText}`);
        const data = await response.json();
        this.validatePack(data);
        return data;
    },

    async loadFromFile(file) {
        if (!file) throw new Error('FILE_REQUIRED');
        const text = await file.text();
        return this.loadFromText(text, { source: { type: 'file', name: file.name } });
    },

    loadFromText(text, { source } = {}) {
        if (!text || !String(text).trim()) throw new Error('EMPTY_JSON');
        let data;
        try {
            data = JSON.parse(text);
        } catch {
            throw new Error('INVALID_JSON');
        }
        this.validatePack(data);
        return { ...data, _source: source || { type: 'text' } };
    },

    validatePack(data) {
        if (!data || typeof data !== 'object') throw new Error('INVALID_PACK');
        if (!data.schema_version) throw new Error('Missing schema_version');
        if (!data.pack || !data.pack.pack_id || !data.pack.version) throw new Error('Missing pack metadata (pack_id, version)');
        if (!Array.isArray(data.cards)) throw new Error('Missing cards array');
        if (data.cards.length === 0) throw new Error('Pack is empty');

        const seen = new Set();
        for (const c of data.cards) {
            if (!c || typeof c !== 'object') throw new Error('Invalid card structure');
            if (!c.card_id) throw new Error('Missing card_id');
            if (seen.has(c.card_id)) throw new Error(`Duplicate card_id: ${c.card_id}`);
            seen.add(c.card_id);
        }

        const sample = data.cards[0];
        const hasFlashcardFields = !!sample.front_i18n;
        const hasQuizFields = !!sample.question_i18n && !!sample.correct_answer_i18n;
        if (!hasFlashcardFields && !hasQuizFields) {
            throw new Error('Invalid card structure (need front_i18n or question_i18n + correct_answer_i18n)');
        }
    }
};
