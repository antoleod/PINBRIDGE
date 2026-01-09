/* src/modules/coach/virtualCoach.js */
import { bus } from '../../core/bus.js';
import { coachStore } from './coachStore.js';
import { i18n } from './i18n.js';

export const virtualCoach = {
    // Provider interface for virtual AI coach
    async explainDeeper(card, userAnswer, isCorrect) {
        const uid = coachStore.uid;
        let context = '';

        // Personalization: Check history
        if (uid && card?.card_id) {
            const progress = await coachStore.getCardProgress(uid, [card.card_id]);
            const p = progress[card.card_id];
            if (p && p.wrong_count > 2 && !isCorrect) {
                context = " (You've struggled here before. Let's simplify.)";
            }
        }

        const question = i18n.getContent(card.question_i18n || card.front_i18n);
        
        if (isCorrect) {
            return `Correct on "${question}".${context} To master this, try explaining the 'why' out loud.`;
        } else {
            return `For "${question}", the key is to distinguish the core concept from the implementation details.${context}`;
        }
    },

    async generateVariant(card, levelOrType = 3) {
        const base = i18n.getContent(card.question_i18n || card.front_i18n);
        
        const isTradeoff = levelOrType === 'tradeoff' || levelOrType >= 5;
        const isTransfer = levelOrType === 'transfer' || levelOrType === 4;
        const isVisual = levelOrType === 'visual';
        const isAnalogy = levelOrType === 'analogy';

        if (isTradeoff) {
            return `Trade-off Analysis: "${base}" requires balancing conflicting needs. Which do you prioritize and why?`;
        } else if (isTransfer) {
            return `Transfer: Apply the principle of "${base}" to a non-technical negotiation.`;
        } else if (isVisual) {
            return `Visual: Draw a diagram representing "${base}" and explain the data flow.`;
        } else if (isAnalogy) {
            return `Analogy: Explain "${base}" using a kitchen/cooking metaphor.`;
        }
        return `Scenario: Explain "${base}" to a stakeholder who only cares about cost.`;
    },

    async challengeChoice(card, userChoice) {
        return `You chose "${userChoice}". But consider: does this hold up if the system is under 100% load?`;
    },

    // Hook into sessions
    init() {
        bus.on('coach:request-explanation', async ({ card, userAnswer, isCorrect }) => {
            const deeper = await this.explainDeeper(card, userAnswer, isCorrect);
            bus.emit('coach:virtual-coach-response', { type: 'explanation', content: deeper });
        });
    }
};

// Initialize
virtualCoach.init();