/* src/modules/coach/quizEngine.js */
import { i18n } from './i18n.js';
import { coachStore } from './coachStore.js';
import { difficultyEngine } from './difficultyEngine.js';
import { virtualCoach } from './virtualCoach.js';

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

        const packData = await coachStore.getUserPackVersion(uid, packId, userPack.installed_version);
        if (!packData || !packData.cards) throw new Error("Pack content missing.");

        const allCards = packData.cards.filter(c => !c.deprecated);
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

        // Assess difficulty for this card
        const diffState = await difficultyEngine.detectState(uid, selected.card_id);
        const { target_level: level, representation } = difficultyEngine.computeDifficulty(diffState);

        // 3. Distractors (Context-aware, adapted by difficulty)
        let distractors = [];
        if (typeof difficultyEngine.generateDistractors === 'function') {
            distractors = difficultyEngine.generateDistractors(selected, allCards, level);
        } else {
            // Fallback: Random from same category if possible
            const sameCat = allCards.filter(c => c.card_id !== selected.card_id && c.category === selected.category);
            const pool = sameCat.length >= 2 ? sameCat : allCards.filter(c => c.card_id !== selected.card_id);
            distractors = this._shuffle(pool).slice(0, 2);
        }

        // 4. Build Options
        const getOptionText = (c) => i18n.getContent(c.correct_answer_i18n);

        const options = [
            { id: selected.card_id, text: getOptionText(selected), isCorrect: true },
            { id: distractors[0]?.card_id || 'd1', text: getOptionText(distractors[0] || selected), isCorrect: false },
            { id: distractors[1]?.card_id || 'd2', text: getOptionText(distractors[1] || selected), isCorrect: false }
        ];

        // Shuffle options
        const shuffledOptions = this._shuffle(options);
        const correctIndex = shuffledOptions.findIndex(o => o.isCorrect);

        // 5. Generate Scenario, Explanation, Transfer, Reflection
        const scenario = await this.generateScenario(selected, level, representation);
        const explanation = this.generateExplanation(selected, distractors);
        const transferTask = this.generateTransferTask(selected);
        const reflectionPrompt = this.generateReflectionPrompt();

        // 6. Return Enhanced Session Object
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
            },
            // New fields for depth
            scenario,
            explanation,
            transferTask,
            reflectionPrompt,
            difficultyLevel: level,
            representation
        };
    },

    async generateScenario(card, level, representation) {
        // Use Virtual Coach for advanced levels
        if (level === 'advanced' || (typeof level === 'number' && level >= 3)) {
            const param = (representation && representation !== 'text') ? representation : (typeof level === 'number' ? level : 4);
            return await virtualCoach.generateVariant(card, param);
        }

        const base = i18n.getContent(card.question_i18n || card.correct_answer_i18n);
        return `Translate or explain: "${base}"`;
    },

    generateExplanation(card, distractors) {
        const correct = i18n.getContent(card.correct_answer_i18n);
        let exp = `Correct: "${correct}" because it accurately conveys the meaning.`;
        distractors.forEach(d => {
            if (d) {
                const wrong = i18n.getContent(d.correct_answer_i18n);
                exp += ` "${wrong}" fails because it's too literal/misleading.`;
            }
        });
        return exp;
    },

    generateTransferTask(card) {
        // Same idea, different context
        const concept = i18n.getContent(card.question_i18n || card.correct_answer_i18n);
        return `Apply this in a business meeting: How would you use "${concept}" to respond to a colleague's question?`;
    },

    generateReflectionPrompt() {
        const prompts = [
            "What surprised you about this?",
            "How might this change your approach?",
            "Where else could you apply this?"
        ];
        return this._randomItem(prompts);
    },

    // --- Helpers ---
    _randomItem(arr) {
        return arr[Math.floor(Math.random() * arr.length)];
    },

    _shuffle(arr) {
        return [...arr].sort(() => 0.5 - Math.random());
    }
};
