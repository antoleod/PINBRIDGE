/* src/modules/coach/tests/difficultyEngine.test.js */
import { difficultyEngine } from '../difficultyEngine.js';

export const runTests = () => {
    console.log('%c Running DifficultyEngine Tests...', 'color: #007bff; font-weight: bold;');

    let passed = 0;
    let failed = 0;

    const assert = (desc, actual, expected) => {
        const isMatch = actual === expected;
        if (isMatch) {
            console.log(`%c✅ ${desc}`, 'color: green');
            passed++;
        } else {
            console.error(`❌ ${desc} | Expected: ${expected}, Got: ${actual}`);
            failed++;
        }
    };

    try {
        // 1. Baseline (Day 1)
        let state = { streak: 0, avgTime: 5000, recentFailures: 0, dayOfRoadmap: 1 };
        let res = difficultyEngine.computeDifficulty(state);
        assert('Day 1 base ambiguity is low', res.ambiguity, 'low');

        // 2. Weekly Ramp (Day 8 -> High)
        state = { streak: 0, avgTime: 5000, recentFailures: 0, dayOfRoadmap: 8 };
        res = difficultyEngine.computeDifficulty(state);
        assert('Day 8 base ambiguity is high', res.ambiguity, 'high');

        // 3. Weekly Ramp (Day 22 -> Judgment)
        state = { streak: 0, avgTime: 5000, recentFailures: 0, dayOfRoadmap: 22 };
        res = difficultyEngine.computeDifficulty(state);
        assert('Day 22 base ambiguity is judgment', res.ambiguity, 'judgment');
        assert('Day 22 representation is tradeoff', res.representation, 'tradeoff');

        // 4. Streak Escalation (Low -> Medium)
        state = { streak: 3, avgTime: 5000, recentFailures: 0, dayOfRoadmap: 1 };
        res = difficultyEngine.computeDifficulty(state);
        assert('Streak 3 escalates low to medium', res.ambiguity, 'medium');

        // 5. Streak Escalation (High -> Judgment)
        // Base for Day 8 is 'high'. Streak 3 should push to 'judgment'.
        state = { streak: 3, avgTime: 5000, recentFailures: 0, dayOfRoadmap: 8 };
        res = difficultyEngine.computeDifficulty(state);
        assert('Streak 3 on Day 8 escalates to judgment', res.ambiguity, 'judgment');
        assert('Streak 3 on Day 8 sets tradeoff', res.representation, 'tradeoff');

        // 6. Failure Fallback
        state = { streak: 0, avgTime: 5000, recentFailures: 2, dayOfRoadmap: 22 };
        res = difficultyEngine.computeDifficulty(state);
        assert('Failures reset ambiguity to low', res.ambiguity, 'low');
        assert('Failures set visual representation', res.representation, 'visual');

        // 7. Hesitation
        state = { streak: 0, avgTime: 11000, recentFailures: 0, dayOfRoadmap: 1 };
        res = difficultyEngine.computeDifficulty(state);
        assert('Hesitation sets analogy representation', res.representation, 'analogy');

    } catch (e) {
        console.error('Test runner failed exception:', e);
    }

    console.log(`%c Tests Complete: ${passed} Passed, ${failed} Failed`, failed > 0 ? 'color: red; font-weight: bold;' : 'color: green; font-weight: bold;');
};

// Expose globally for console access
if (typeof window !== 'undefined') window.testDifficulty = runTests;