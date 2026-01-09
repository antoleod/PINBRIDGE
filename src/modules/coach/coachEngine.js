/* src/modules/coach/coachEngine.js */
import { coachStore } from './coachStore.js';
import { i18n } from './i18n.js';

class CoachEngine {

    // --- V2 Data Normalization ---
    normalizeSession(session) {
        if (session.schema_version === 'v2') return session;

        // Upgrade v1 -> v2
        return {
            ...session,
            schema_version: 'v2',
            variant_id: session.variant_id || 'v1_default',
            concept_id: session.concept_id || `legacy_${session.id}`,
            user_fields_required: session.user_fields_required || ['confidence_1to5'],
            difficulty_1to5: session.difficulty || 3,
            context_resources: session.context_resources || {
                show_only_if: ['wrong_answer'],
                skill_focus_i18n: { en: "Review Core Concepts", es: "Repasar conceptos clave", fr: "Réviser les concepts clés" },
                micro_reto_i18n: { en: "Explain this out loud.", es: "Explícalo en voz alta.", fr: "Expliquez-le à voix haute." },
                habit_i18n: { en: "Slow down.", es: "Despacio.", fr: "Ralentissez." }
            },
            quality: session.quality || {
                source_type: 'generated',
                confidence_score: 50,
                last_verified_at: new Date().toISOString()
            }
        };
    }

    // --- Skill Wizard & Generation (V2) ---
    generateBlueprint(topic, goal, intensity, language) {
        // Smart Mock: Generates a structure based on the topic string
        console.log(`Generating V2 blueprint for: ${topic}, Goal: ${goal}`);

        const modules = [
            {
                title_i18n: { en: `Fundamentals of ${topic}`, es: `Fundamentos de ${topic}`, fr: `Principes de ${topic}` },
                id: 'mod_fund',
                unlock_rule: { min_sessions_done: 5, max_repeated_error_pattern: 3 },
                domain_tags: ['fundamental', topic]
            },
            {
                title_i18n: { en: `${topic} & State`, es: `${topic} y Estado`, fr: `${topic} et État` },
                id: 'mod_state',
                unlock_rule: { min_sessions_done: 10, max_repeated_error_pattern: 3 },
                domain_tags: ['state', 'async']
            }
        ];

        return {
            skill: {
                title_i18n: { en: topic, es: topic, fr: topic },
                goal_outcome_i18n: { en: goal, es: goal, fr: goal },
                skill_type: 'technical',
                roadmap_days: 30,
                content_version: '2.0.0', // V2
                time_per_day_min: intensity === 'hard' ? 45 : 15,
                rules: {
                    error_memory: { repeat_block_threshold: 3, spaced_repetition_days: [1, 3, 7, 21] },
                    confidence_calibration: { overconfidence_rule: "warn", underconfidence_rule: "encourage" },
                    start_strategy: { two_pass_mastery: true, teach_back: true },
                    quality: { require_quality_metadata: true }
                }
            },
            modules
        };
    }

    // --- Pack Management (NEW) ---
    async importPackJson(jsonString, uid) {
        let data;
        try {
            data = JSON.parse(jsonString);
        } catch (e) {
            throw new Error("Invalid JSON format.");
        }

        if (!data.pack || !data.pack.pack_id || !data.cards) {
            throw new Error("Missing required pack fields (pack_id, version, cards).");
        }

        // Save under user tree (global catalog writes are not enabled by default in rules)
        await coachStore.saveUserPack(uid, data.pack.pack_id, data.pack.version, data.pack, data.cards);

        // 2. Install User (Update registry)
        await coachStore.installUserPack(uid, data.pack.pack_id, data.pack.version, data.pack);

        return data.pack;
    }

    async generateQuizSession(packId) {
        const uid = coachStore.uid;

        // 1. Get User Pack Version
        const userPacks = await coachStore.getUserPacks(uid);
        const userPack = userPacks.find(p => p.pack_id === packId);

        if (!userPack) throw new Error("Pack not installed.");

        // 2. Get Pack Content (Cards)
        const packVersionData = await coachStore.getUserPackVersion(uid, packId, userPack.installed_version);
        if (!packVersionData) throw new Error("Pack content not found.");

        const allCards = packVersionData.cards;

        // 3. Get Progress
        const cardIds = allCards.map(c => c.card_id);
        const progressMap = await coachStore.getCardProgress(uid, cardIds);

        // 4. Select Candidate (Spaced Repetition or New)
        // Strategy: Priority = Due Reviews > New Cards
        const now = new Date();
        const due = [];
        const newCards = [];

        allCards.forEach(card => {
            const prog = progressMap[card.card_id];
            if (!prog) {
                newCards.push(card);
            } else if (prog.next_review_at?.toDate() <= now || prog.interval === 0) {
                due.push(card);
            }
        });

        // Pick one
        let selected = null;
        if (due.length > 0) {
            selected = due[Math.floor(Math.random() * due.length)]; // Randomize due reviews slightly
        } else if (newCards.length > 0) {
            selected = newCards[0]; // In order
        } else {
            // All done, pick random review for reinforcement
            selected = allCards[Math.floor(Math.random() * allCards.length)];
        }

        if (!selected) return null; // Should not happen unless empty pack

        // 5. Generate Distractors
        // Simple logic: Pick 2 other cards from same category
        const distractors = allCards.filter(c =>
            c.card_id !== selected.card_id &&
            c.category === selected.category
        );

        // Shuffle distractors
        const shuffledDistractors = distractors.sort(() => 0.5 - Math.random()).slice(0, 2);

        // Ensure we have 2
        while (shuffledDistractors.length < 2) {
            const random = allCards[Math.floor(Math.random() * allCards.length)];
            if (random.card_id !== selected.card_id && !shuffledDistractors.includes(random)) {
                shuffledDistractors.push(random);
            }
            if (allCards.length < 3) break; // Safety
        }

        // 6. Build Quiz Object
        const targetLang = i18n.contentLang || 'fr';
        const getOptionText = (c) => i18n.getContent(c.correct_answer_i18n);

        const options = [
            { text: getOptionText(selected), isCorrect: true },
            { text: getOptionText(shuffledDistractors[0]), isCorrect: false },
            { text: getOptionText(shuffledDistractors[1]), isCorrect: false }
        ];

        // Shuffle Options
        options.sort(() => 0.5 - Math.random());

        return {
            card: selected,
            question: i18n.getContent(selected.question_i18n),
            options: options.map(o => o.text),
            correctIndex: options.findIndex(o => o.isCorrect),
            totalCards: allCards.length,
            sessionIndex: (progressMap[selected.card_id]?.seen_count || 0) + 1
        };
    }

    // --- Session Management (V2) ---

    async getDailySession(skillId) {
        const uid = coachStore.uid;
        // 1. Check for Spaced Repetition dues
        const dueReviews = await coachStore.getDueReviews(uid);

        // MVP logic: If reviews due, pick one. Else, pick next new concept.
        let conceptId = `concept_generic_${Math.floor(Math.random() * 100)}`;
        let isReview = false;
        let variantId = 'v1_std';

        if (dueReviews.length > 0) {
            conceptId = dueReviews[0].concept_id;
            isReview = true;
            // In a real V2 engine, we would fetch a Diff Variant here explicitly
            variantId = 'v2_review_variant';
        }

        const rawSession = {
            id: `sess_${Date.now()}`,
            schema_version: 'v2',
            skill_id: skillId,
            module_id: 'mod_fund', // inferred
            concept_id: conceptId,
            variant_id: variantId,
            is_review: isReview,
            difficulty_1to5: isReview ? 3 : 2,
            title_i18n: {
                en: isReview ? "Review: Key Concept" : "Daily Challenge",
                es: isReview ? "Repaso: Concepto Clave" : "Desafío Diario",
                fr: "Défi Quotidien"
            },
            scenario_i18n: {
                en: `You are faced with a situation involving ${isReview ? 'a recurring issue' : 'a new problem'} in ${skillId}.`,
                es: `Te enfrentas a una situación que involucra ${isReview ? 'un problema recurrente' : 'un nuevo problema'} en ${skillId}.`,
                fr: `Vous êtes confronté à une situation impliquant un problème dans ${skillId}.`
            },
            decision_prompt_i18n: {
                en: "What is the best immediate action?",
                es: "¿Cuál es la mejor acción inmediata?",
                fr: "Quelle est la meilleure action immédiate ?"
            },
            options_i18n: [
                { en: "Analyze the logs first", es: "Analizar los registros primero", fr: "Analyser les journaux", correct: true },
                { en: "Restart the service", es: "Reiniciar el servicio", fr: "Redémarrer", correct: false },
                { en: "Escalate immediately", es: "Escalar inmediatamente", fr: "Escalader", correct: false }
            ],
            explanation_i18n: {
                en: "Analysis is crucial before action to prevent data loss.",
                es: "El análisis es crucial antes de actuar.",
                fr: "L'analyse est cruciale avant d'agir."
            },
            trap_i18n: {
                en: "The 'Reboot First' trap: Acting before thinking.",
                es: "La trampa de 'Reiniciar Primero': Actuar antes de pensar."
            },
            user_fields_required: ['confidence_1to5', 'why_i_thought_this'], // Premium V2 feature
            quality: {
                source_type: 'generated',
                confidence_score: 85
            }
        };

        return this.normalizeSession(rawSession);
    }

    // --- 2-Pass Mastery Logic ---

    async submitSessionResult(session, answerIndex, confidence, justification) {
        const uid = coachStore.uid;
        const isCorrect = session.options_i18n[answerIndex].correct; // Simplified for array index

        // Save Attempt
        await coachStore.saveAttempt(uid, {
            type: 'session',
            sessionId: session.id,
            conceptId: session.concept_id,
            variantId: session.variant_id, // V2
            answerIndex,
            confidence,
            justification,
            isCorrect,
            timestamp: Date.now()
        });

        // Spaced Repetition Update
        await coachStore.updateErrorMemory(uid, session.concept_id, isCorrect);

        // Update streak if correct (simplification)
        if (isCorrect) {
            const maintenance = await coachStore.getMaintenanceStatus(uid);
            const today = new Date().toDateString();

            // Simple streak logic
            if (maintenance.last_completed_date !== today) {
                await coachStore.updateMaintenance(uid, {
                    streak_days: (maintenance.streak_days || 0) + 1,
                    last_completed_date: today
                });
            }
        }

        // Return feedback
        return {
            isCorrect,
            explanation: i18n.getContent(session.explanation_i18n),
            trap: i18n.getContent(session.trap_i18n),
            requiresPass2: !isCorrect || confidence <= 2
        };
    }

    // --- Pass 2 Generation ---
    getPass2Session(conceptId, originalSession) {
        // Mocking a "Helpful" variant
        return this.normalizeSession({
            ...originalSession,
            id: originalSession.id + "_pass2",
            variant_id: originalSession.variant_id + "_guided",
            title_i18n: { en: "Let's try again (Guided)", es: "Intentémoslo de nuevo (Guiado)", fr: "Réessayons (Guidé)" },
            scenario_i18n: {
                en: originalSession.scenario_i18n.en + " [Hint: Think about preserving state.]",
                es: originalSession.scenario_i18n.es + " [Pista: Piensa en preservar el estado.]",
                fr: originalSession.scenario_i18n.fr + " [Indice: Pensez à l'état.]"
            },
            is_pass_2: true
        });
    }

    // --- Maintenance & Decay ---
    async checkMaintenance(uid) {
        if (!uid) return;
        const maintenance = await coachStore.getMaintenanceStatus(uid);

        // Ensure structure exists
        if (!maintenance || maintenance.streak_days === undefined) {
            await coachStore.updateMaintenance(uid, { streak_days: 0, last_completed_date: null });
        }

        // Potential Decay logic: If last_completed_date > 30 days, reset streak? 
        // For now we just ensure initialization.
    }

}

export const coachEngine = new CoachEngine();
