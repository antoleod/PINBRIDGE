/* src/modules/coach/examEngine.js */
import { coachStore } from './coachStore.js';
import { coachEngine, mkI18n } from './coachEngine.js';
import { i18n } from './i18n.js';

function makeId(prefix = 'id') {
    try {
        const buf = new Uint8Array(8);
        crypto.getRandomValues(buf);
        const hex = [...buf].map(b => b.toString(16).padStart(2, '0')).join('');
        return `${prefix}_${Date.now()}_${hex}`;
    } catch {
        return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    }
}

function pickUnique(concepts, count) {
    const pool = [...new Set(concepts)];
    const out = [];
    while (pool.length > 0 && out.length < count) {
        const idx = Math.floor(Math.random() * pool.length);
        out.push(pool[idx]);
        pool.splice(idx, 1);
    }
    return out;
}

function getI18nArray(i18nArrayField, lang) {
    const safe = (l) => (['en', 'fr', 'es'].includes(l) ? l : 'en');
    const l = safe(lang);
    const v = i18nArrayField?.[l] || i18nArrayField?.en || i18nArrayField?.fr || i18nArrayField?.es || [];
    return Array.isArray(v) ? v : [];
}

class ExamEngine {
    async startExam(uid, settings, { skillId, scope = 'skill', moduleId = null, totalQuestions = 5, durationSec = 15 * 60, attemptType = 'exam', mode = 'exam' } = {}) {
        if (!uid || !skillId) throw new Error('EXAM_CONTEXT_REQUIRED');

        const modules = await coachStore.listModules(uid, skillId);
        const conceptPool = (scope === 'module' && moduleId)
            ? (modules.find(m => m.id === moduleId)?.concept_ids || [])
            : modules.flatMap(m => m.concept_ids || []);

        if (conceptPool.length === 0) throw new Error('NO_CONCEPTS');

        const errorMemory = await coachStore.listErrorMemory(uid, { limitCount: 50 });
        const relevantErrors = errorMemory
            .filter(e => conceptPool.includes(e.concept_id))
            .sort((a, b) => Number(b.count || 0) - Number(a.count || 0));

        const prioritized = relevantErrors.slice(0, Math.min(2, relevantErrors.length)).map(e => e.concept_id);
        const rest = conceptPool.filter(c => !prioritized.includes(c));
        const chosen = [
            ...prioritized,
            ...pickUnique(rest, Math.max(0, totalQuestions - prioritized.length))
        ].slice(0, Math.min(totalQuestions, conceptPool.length));

        const questionOrder = [];
        const questions = [];
        for (const conceptId of chosen) {
            const excludeVariant = relevantErrors.find(e => e.concept_id === conceptId)?.lastVariantId || null;
            const variant = await coachEngine.getAlternativeVariant(uid, conceptId, excludeVariant);
            if (!variant) continue;
            const quiz = await coachStore.getQuizVariant(uid, variant.id);
            if (!quiz) continue;
            questionOrder.push({ concept_id: conceptId, variant_id: quiz.variant_id, quiz_id: quiz.id, difficulty_1to5: quiz.difficulty_1to5 || 3, tags: quiz.tags || [] });
            questions.push(quiz);
        }

        const attemptId = makeId('exam_attempt');
        const startedAtMs = Date.now();
        const endsAtMs = startedAtMs + durationSec * 1000;

        const examId = `${skillId}__${mode}__${scope}${moduleId ? `__${moduleId}` : ''}`;

        await coachStore.upsertExam(uid, examId, {
            exam_type: 'scenario_mcq',
            skill_id: skillId,
            module_id: moduleId || null,
            scope,
            total_questions: questions.length,
            duration_sec: durationSec,
            last_started_at_ms: startedAtMs,
            content_version: 1
        });

        await coachStore.createAttempt(uid, {
            id: attemptId,
            attempt_type: attemptType,
            exam_type: 'scenario_mcq',
            exam_id: examId,
            skill_id: skillId,
            module_id: moduleId || null,
            scope,
            mode,
            duration_sec: durationSec,
            started_at_ms: startedAtMs,
            ends_at_ms: endsAtMs,
            question_order: questionOrder,
            current_index: 0,
            answers: [],
            content_version: 1
        });

        return {
            attemptId,
            durationSec,
            startedAtMs,
            endsAtMs,
            title: scope === 'module' ? i18n.t('coach_action_start_exam') : i18n.t('coach_action_start_exam'),
            questions,
            currentIndex: 0,
            totalQuestions: questions.length
        };
    }

    getCurrentQuestion(examRuntime) {
        if (!examRuntime) return null;
        return examRuntime.questions?.[examRuntime.currentIndex] || null;
    }

    async submitAnswer(uid, settings, examRuntime, { selectedIndex, confidence, justification }) {
        const question = this.getCurrentQuestion(examRuntime);
        if (!question) throw new Error('NO_QUESTION');

        const confidenceNum = Number(confidence);
        const isCorrect = Number(selectedIndex) === Number(question.correct_index);

        const answer = {
            question_index: examRuntime.currentIndex,
            quiz_id: question.id,
            concept_id: question.concept_id,
            variant_id: question.variant_id,
            answer_index: Number(selectedIndex),
            confidence_1to5: confidenceNum,
            why_i_thought_this: String(justification || ''),
            language_used: settings?.content_language || 'en',
            is_correct: isCorrect,
            content_version: question.content_version || 1
        };

        examRuntime.answers = examRuntime.answers || [];
        examRuntime.answers.push(answer);
        examRuntime.currentIndex += 1;

        await coachStore.updateAttempt(uid, examRuntime.attemptId, {
            answers: examRuntime.answers,
            current_index: examRuntime.currentIndex
        });

        if (!isCorrect) {
            await coachStore.updateErrorMemory(uid, question.concept_id, {
                intervals: settings?.spaced_repetition_intervals || [1, 3, 7],
                variantId: question.variant_id
            });
        }

        return { isCorrect };
    }

    async finishExam(uid, settings, examRuntime) {
        const total = Number(examRuntime.totalQuestions || 0);
        const answers = examRuntime.answers || [];
        const correct = answers.filter(a => a.is_correct).length;
        const score = total > 0 ? Math.round((correct / total) * 100) : 0;
        const pass = score >= 70;

        const weak = new Map();
        for (const a of answers) {
            if (a.is_correct) continue;
            const q = examRuntime.questions.find(x => x.id === a.quiz_id);
            for (const tag of (q?.tags || ['unknown'])) {
                weak.set(tag, (weak.get(tag) || 0) + 1);
            }
        }
        const weak_domains = [...weak.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k]) => k);

        const wrongConcepts = [...new Set(answers.filter(a => !a.is_correct).map(a => a.concept_id))];
        const remediation_plan_i18n = {
            en: wrongConcepts.slice(0, 3).map((c, idx) => `Day ${idx + 1}: Remediate ${c} with an assisted retry + teach-back.`),
            es: wrongConcepts.slice(0, 3).map((c, idx) => `Día ${idx + 1}: Remedia ${c} con reintento asistido + teach-back.`),
            fr: wrongConcepts.slice(0, 3).map((c, idx) => `Jour ${idx + 1} : Remédier ${c} avec réessai assisté + teach-back.`)
        };

        const remediation_days = getI18nArray(remediation_plan_i18n, settings?.content_language || 'en');

        await coachStore.updateAttempt(uid, examRuntime.attemptId, {
            finished_at_ms: Date.now(),
            score,
            pass,
            weak_domains,
            remediation_plan_i18n,
            content_version: 1
        });

        // Transfer check (MVP): schedule one new-variant concept from the wrong set.
        const transferConcept = wrongConcepts[0] || null;
        if (transferConcept) {
            const transferVariant = await coachEngine.getAlternativeVariant(uid, transferConcept, null);
            await coachStore.updateAttempt(uid, examRuntime.attemptId, {
                transfer_check: {
                    concept_id: transferConcept,
                    quiz_id: transferVariant?.id || null,
                    prompt_i18n: mkI18n(
                        'Transfer check: same concept, new scenario.',
                        'Transfer check: mismo concepto, escenario nuevo.',
                        'Transfer check : même concept, nouveau scénario.'
                    ),
                    content_version: 1
                }
            });
        }

        // Real-world feedback form (MVP)
        await coachStore.createFeedbackReal(uid, {
            linked_exam_attempt_id: examRuntime.attemptId,
            prompt_i18n: mkI18n(
                'Where can you apply this in real life this week? Write one concrete action.',
                '¿Dónde puedes aplicar esto en la vida real esta semana? Escribe una acción concreta.',
                'Où pouvez-vous appliquer cela dans la vie réelle cette semaine ? Écrivez une action concrète.'
            ),
            content_version: 1,
            source_metadata: {
                source_type: 'generated',
                source_ref: 'generated:real_world_feedback',
                last_verified_at: null,
                confidence_score: 60
            }
        });

        return { score, pass, weak_domains, remediation_days };
    }
}

export const examEngine = new ExamEngine();
