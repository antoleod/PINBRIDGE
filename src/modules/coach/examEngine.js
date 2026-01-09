/* src/modules/coach/examEngine.js */
import { coachStore } from './coachStore.js';
import { i18n } from './i18n.js';

class ExamEngine {

    startExam(examType, moduleId) { // examType: 'module_exam' | 'drill'
        console.log(`Starting exam: ${examType} for module ${moduleId}`);

        // V2: Hardcoded Mock Question Generation with schema_version
        const questions = Array.from({ length: 5 }, (_, i) => ({
            id: `q_${Date.now()}_${i}`,
            schema_version: 'v2',
            concept_id: `concept_exam_${i}`,
            variant_id: `var_exam_${i}`,
            quality: { source_type: 'generated', confidence_score: 90 },
            scenario_i18n: {
                en: `Exam Scenario ${i + 1}: Dealing with complex state in ${moduleId || 'general'}.`,
                es: `Escenario de examen ${i + 1}: Manejo de estado complejo en ${moduleId || 'general'}.`,
                fr: `Scénario d'examen ${i + 1}`
            },
            decision_prompt_i18n: {
                en: "Select the optimal approach:",
                es: "Seleccione el enfoque óptimo:",
                fr: "Sélectionnez l'approche optimale:"
            },
            options_i18n: [
                { en: "Option A (Correct)", correct: true },
                { en: "Option B (Incorrect)", correct: false },
                { en: "Option C (Incorrect)", correct: false },
                { en: "Option D (Incorrect)", correct: false }
            ],
            difficulty: 3
        }));

        return {
            id: `exam_${Date.now()}`,
            schema_version: 'v2',
            startTime: Date.now(),
            totalQuestions: 5,
            currentQuestionIndex: 1, // 1-based for UI
            questions,
            answers: []
        };
    }

    submitAnswer(exam, questionId, answerIndex) {
        const question = exam.questions.find(q => q.id === questionId);
        const isCorrect = question.options_i18n[answerIndex].correct; // Mock index check

        exam.answers.push({
            questionId,
            variantId: question.variant_id, // V2: Track variant
            answerIndex,
            isCorrect,
            timestamp: Date.now()
        });

        return { exam, isCorrect };
    }

    finishExam(exam) {
        const correctCount = exam.answers.filter(a => a.isCorrect).length;
        const score = Math.round((correctCount / exam.totalQuestions) * 100);
        const pass = score >= 70;

        // Persist attempt (V2 compliant save happens in Store)
        const result = {
            score,
            pass,
            weak_domains: pass ? [] : ['State Management', 'Async Flows'] // Mock
        };

        // Save to store (fire and forget)
        coachStore.saveAttempt(coachStore.uid, {
            type: 'exam',
            examId: exam.id,
            score,
            pass,
            timestamp: Date.now(),
            details: exam.answers // Save detailed answers for auditing
        });

        return result;
    }
}

export const examEngine = new ExamEngine();
