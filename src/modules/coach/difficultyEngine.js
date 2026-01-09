/* src/modules/coach/difficultyEngine.js */
import { coachStore } from './coachStore.js';

export const difficultyEngine = {
    // Track user performance to adapt difficulty
    async assessDifficulty(uid, cardId, sessionData) {
        const progress = await coachStore.getCardProgress(uid, [cardId]);
        const p = progress[cardId];
        if (!p) return { level: 'basic', representation: 'text' };

        const successRate = p.correct_count / p.seen_count;
        const avgTime = p.avg_response_time || 0;
        const streak = p.current_streak || 0;

        let level = 'basic';
        let representation = 'text';

        if (successRate > 0.8 && streak > 3) {
            level = 'advanced'; // Increase ambiguity
        } else if (avgTime > 10000) { // Hesitation
            level = 'simplified'; // Use analogies
        } else if (successRate < 0.5) {
            representation = 'diagram'; // Change rep
        }

        return { level, representation };
    },

    // Adapt distractors based on level
    generateDistractors(card, allCards, level) {
        let pool = allCards.filter(c => c.card_id !== card.card_id);

        if (level === 'advanced') {
            // More subtle distractors: similar but wrong
            pool = pool.filter(c => c.category === card.category); // Keep same category but make them closer
        } else {
            pool = pool.filter(c => c.category === card.category);
        }

        return this._shuffle(pool).slice(0, 2);
    },

    // Helpers
    _shuffle(arr) {
        return [...arr].sort(() => 0.5 - Math.random());
    }
};</content>
<parameter name="filePath">c:\Users\X1\Documents\PINBRIDGE-1\src\modules\coach\difficultyEngine.js