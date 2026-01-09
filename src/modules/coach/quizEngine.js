/* src/modules/coach/quizEngine.js */
import { i18n } from './i18n.js';
import { coachStore } from './coachStore.js';

export const quizEngine = {

    // Config
    CONFIG: {
        optionsCount: 3,
        defaultTargetLang: 'fr' // Logic assumes we want to learn/answer about the Pack's main language
    },

    /**
     * Generating a Quiz Session
     * - Selects card based on SRS or New
     * - Generates distractors from same category
     */
    async generateSession(packId, userContentLang = 'en') {
        const uid = coachStore.uid;
        if (!uid) throw new Error("User not authenticated");

        // 1. Get Pack & Progress
        const userPacks = await coachStore.getUserPacks(uid);
        const userPack = userPacks.find(p => p.pack_id === packId);
        if (!userPack) throw new Error("Pack not installed locally.");

        const packData = await coachStore.getGlobalPackVersion(packId, userPack.installed_version);
        if (!packData || !packData.cards) throw new Error("Pack content missing.");

        const allCards = packData.cards;
        const cardIds = allCards.map(c => c.card_id);
        const progressMap = await coachStore.getCardProgress(uid, cardIds);

        // 2. Selection Strategy
        const now = new Date();
        const dueCards = [];
        const newCards = [];
        const learningCards = []; // Started but not due

        allCards.forEach(c => {
            const p = progressMap[c.card_id];
            if (!p) {
                newCards.push(c);
            } else {
                const nextRev = p.next_review_at?.toDate ? p.next_review_at.toDate() : new Date(p.next_review_at);
                if (nextRev <= now || p.interval === 0) {
                    dueCards.push(c);
                } else {
                    learningCards.push(c);
                }
            }
        });

        // Priority: Due > New > Random Review
        let selected = null;
        let reason = '';

        if (dueCards.length > 0) {
            selected = this._randomItem(dueCards);
            reason = 'due';
        } else if (newCards.length > 0) {
            selected = newCards[0]; // Sequential for new
            reason = 'new';
        } else {
            selected = this._randomItem(allCards);
            reason = 'review';
        }

        if (!selected) return null;

        // 3. Distractors (Context-aware)
        // Pool: Same category, excluding selected
        const categoryPool = allCards.filter(c => c.category === selected.category && c.card_id !== selected.card_id);

        let distractors = [];
        if (categoryPool.length >= 2) {
            distractors = this._shuffle(categoryPool).slice(0, 2);
        } else {
            // Fallback to any card
            const otherPool = allCards.filter(c => c.card_id !== selected.card_id);
            distractors = this._shuffle(otherPool).slice(0, 2);
        }

        // 4. Build Options
        // We need to display the "Answer" which is usually the definition or translation
        // JSON structure: card.correct_answer_i18n

        const getOptionText = (c) => i18n.getContent(c.correct_answer_i18n);

        const options = [
            { id: selected.card_id, text: getOptionText(selected), isCorrect: true },
            { id: distractors[0]?.card_id || 'd1', text: getOptionText(distractors[0] || selected), isCorrect: false },
            { id: distractors[1]?.card_id || 'd2', text: getOptionText(distractors[1] || selected), isCorrect: false }
        ];

        // Shuffle options
        const shuffledOptions = this._shuffle(options);
        const correctIndex = shuffledOptions.findIndex(o => o.isCorrect);

        // 5. Return Session Object
        return {
            card: selected,
            options: shuffledOptions.map(o => o.text),
            correctIndex,
            totalCards: allCards.length,
            sessionIndex: (progressMap[selected.card_id]?.seen_count || 0) + 1,
            progress: {
                due: dueCards.length,
                new: newCards.length,
                total: allCards.length
            }
        };
    },

    // --- Helpers ---
    _randomItem(arr) {
        return arr[Math.floor(Math.random() * arr.length)];
    },

    _shuffle(arr) {
        return [...arr].sort(() => 0.5 - Math.random());
    }
};
