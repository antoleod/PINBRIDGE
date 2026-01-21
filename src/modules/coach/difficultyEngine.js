/* src/modules/coach/difficultyEngine.js */
import { coachStore } from './coachStore.js';

class DifficultyEngine {
    constructor() {
        this.config = {
            hesitationThreshold: 10000, // 10 seconds
            masteryStreak: 3,
            failureThreshold: 2
        };
    }

    /**
     * Detects the user's current performance state based on recent history.
     * @param {string} uid 
     * @param {string} skillId 
     */
    async detectState(uid, skillId) {
        // Future: Fetch real history from coachStore
        // const history = await coachStore.getHistory(uid, skillId);
        
        // Mock state for Phase 1
        return {
            streak: 0,
            avgTime: 0,
            recentFailures: 0,
            dayOfRoadmap: 1 
        };
    }

    /**
     * Determines the difficulty parameters for the next session.
     * @param {Object} state - State from detectState()
     */
    computeDifficulty(state) {
        const { streak, avgTime, recentFailures, dayOfRoadmap } = state;
        
        let ambiguity = 'low';
        let representation = 'text';
        
        // Weekly Ramp Logic (Roadmap Phase 2 alignment)
        if (dayOfRoadmap > 21) {
            ambiguity = 'judgment'; // Level 5
            representation = 'tradeoff';
        }
        else if (dayOfRoadmap > 14) ambiguity = 'transfer'; // Level 4
        else if (dayOfRoadmap > 7) ambiguity = 'high'; // Level 3
        
        // Dynamic Adaptation (Short-term)
        if (streak >= this.config.masteryStreak) {
            // Push harder if not already maxed
            if (ambiguity === 'low') ambiguity = 'medium';
            else if (ambiguity === 'medium') ambiguity = 'high';
            else if (ambiguity === 'high') {
                ambiguity = 'judgment';
                representation = 'tradeoff';
            }
        }

        if (recentFailures >= this.config.failureThreshold) {
            // Fallback representation
            representation = 'visual'; // Diagram/Visual
            ambiguity = 'low'; // Reset ambiguity to help learn
        } else if (avgTime > this.config.hesitationThreshold) {
            representation = 'analogy'; // Simplify
        }

        return {
            ambiguity,
            representation,
            target_level: this._mapAmbiguityToLevel(ambiguity)
        };
    }

    /**
     * Generates distractors for a multiple choice question.
     * @param {Object} targetCard - The correct card.
     * @param {Array} allCards - All available cards in the pack.
     * @param {number|string} level - Difficulty level.
     * @returns {Array} Array of distractor cards (usually 2).
     */
    generateDistractors(targetCard, allCards, level) {
        const others = allCards.filter(c => c.card_id !== targetCard.card_id);
        if (others.length === 0) return [];

        const numLevel = typeof level === 'number' ? level : (level === 'advanced' ? 5 : 3);
        let pool = others;

        // For higher difficulty, restrict pool to same category (harder to distinguish)
        if (numLevel >= 3) {
            const sameCategory = others.filter(c => c.category === targetCard.category);
            if (sameCategory.length >= 2) pool = sameCategory;
        }

        return pool.sort(() => 0.5 - Math.random()).slice(0, 2);
    }

    _mapAmbiguityToLevel(ambiguity) {
        switch(ambiguity) {
            case 'judgment': return 5;
            case 'transfer': return 4;
            case 'high': return 3;
            case 'medium': return 2;
            default: return 1;
        }
    }
}

export const difficultyEngine = new DifficultyEngine();