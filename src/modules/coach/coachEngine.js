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

    // --- Skill Wizard & Generation (Playbook V3) ---
    generateBlueprintV3(topic, goal, intensity, language) {
        const clean = (v) => String(v || '').trim();
        const topicClean = clean(topic);
        const goalClean = clean(goal);
        const start_date = new Date().toISOString().slice(0, 10);

        const mkI18n = (en, es, fr, nl) => ({
            en: clean(en),
            es: clean(es ?? en),
            fr: clean(fr ?? en),
            nl: clean(nl ?? en)
        });

        const timeByIntensity = { light: 15, normal: 30, hard: 60 };

        const isLanguageSkill =
            /(^|\b)(english|ingl[eé]s|french|fran[cç]ais|franc[eé]s|dutch|holand[eé]s|nederlands)(\b|$)/i.test(topicClean) ||
            /(^|\b)(a1|a2|b1|b2|c1|c2)(\b|$)/i.test(topicClean);

        const skill_type = isLanguageSkill ? 'language' : 'technical';

        const buildRoadmap = () => {
            const roadmap = [];
            for (let day = 1; day <= 30; day++) {
                const phase =
                    day <= 3 ? 'setup' :
                        day <= 10 ? 'foundation' :
                            day <= 22 ? 'application' :
                                'exam';

                const dayTopic = isLanguageSkill
                    ? (phase === 'setup'
                        ? `Setup + baseline (${topicClean})`
                        : phase === 'foundation'
                            ? `Vocabulary + sentences (${topicClean})`
                            : phase === 'application'
                                ? `Real-life drills (${topicClean})`
                                : `Test + consolidation (${topicClean})`)
                    : (phase === 'setup'
                        ? `Setup + mental model (${topicClean})`
                        : phase === 'foundation'
                            ? `Core building blocks (${topicClean})`
                            : phase === 'application'
                                ? `Scenarios + trade-offs (${topicClean})`
                                : `Exam mode (${topicClean})`);

                const action = isLanguageSkill
                    ? (phase === 'setup'
                        ? 'Set your target: 10 words/day. Do a 3-minute baseline (write a short text, no help).'
                        : phase === 'foundation'
                            ? 'Learn 10 B1 words. Write 5 sentences. Record yourself reading them (2 min).'
                            : phase === 'application'
                                ? 'Create a mini-dialog (6 lines). Replace 3 words with synonyms. Send a message/email draft.'
                                : 'Do a timed quiz (5 questions). Fix the 2 weakest points with 10-minute drills.')
                    : (phase === 'setup'
                        ? 'Define constraints + success metric. Sketch the system/skill in 1 page.'
                        : phase === 'foundation'
                            ? 'Study 1 core concept. Build a tiny demo or diagram. Write a 5-bullet summary.'
                            : phase === 'application'
                                ? 'Solve 1 scenario. Choose between 3 options and justify cost/risk/latency.'
                                : 'Timed drill: 5 questions. Review wrong answers and write a remediation plan.');

                const decisionPrompt = isLanguageSkill
                    ? 'You hesitate between two words. What is the best next action?'
                    : 'You have 3 solutions. What is the best next action?';

                const options = isLanguageSkill
                    ? [
                        mkI18n('Use the word in a sentence to test meaning.', 'Usa la palabra en una frase para validar el sentido.', 'Utilisez le mot dans une phrase pour tester le sens.', 'Gebruik het woord in een zin om de betekenis te testen.'),
                        mkI18n('Skip it and move on (no review).', 'Sáltalo y sigue (sin repasar).', 'Passez et avancez (sans révision).', 'Sla het over en ga verder (zonder herhalen).'),
                        mkI18n('Translate word-for-word from your native language.', 'Traduce palabra por palabra desde tu idioma.', 'Traduisez mot à mot depuis votre langue.', 'Vertaal woord-voor-woord vanuit je moedertaal.')
                    ]
                    : [
                        mkI18n('Pick the option you can validate with a quick test.', 'Elige la opción que puedes validar con una prueba rápida.', 'Choisissez l’option que vous pouvez valider par un test rapide.', 'Kies de optie die je met een snelle test kunt valideren.'),
                        mkI18n('Choose the most complex option “just in case”.', 'Elige la opción más compleja “por si acaso”.', 'Choisissez l’option la plus complexe “au cas où”.', 'Kies de meest complexe optie “voor de zekerheid”.'),
                        mkI18n('Delay the decision and read more theory.', 'Retrasa la decisión y lee más teoría.', 'Retardez la décision et lisez plus de théorie.', 'Stel de beslissing uit en lees meer theorie.')
                    ];

                roadmap.push({
                    day,
                    status: 'todo',
                    topic_i18n: mkI18n(dayTopic, dayTopic, dayTopic, dayTopic),
                    action_i18n: mkI18n(action, action, action, action),
                    micro_challenge_i18n: isLanguageSkill
                        ? mkI18n('Write 3 sentences using today’s words without a translator.', 'Escribe 3 frases con las palabras de hoy sin traductor.', 'Écrivez 3 phrases avec les mots du jour sans traducteur.', 'Schrijf 3 zinnen met de woorden van vandaag zonder vertaler.')
                        : mkI18n('Explain your choice in 2 sentences. Then write the “common trap” in 1 sentence.', 'Explica tu elección en 2 frases. Luego escribe la “trampa común” en 1 frase.', 'Expliquez votre choix en 2 phrases. Puis écrivez le “piège courant” en 1 phrase.', 'Leg je keuze uit in 2 zinnen. Schrijf daarna de “valkuil” in 1 zin.'),
                    decision: {
                        prompt_i18n: mkI18n(decisionPrompt, decisionPrompt, decisionPrompt, decisionPrompt),
                        options_i18n: options,
                        correct_index: 0,
                        justification_i18n: isLanguageSkill
                            ? mkI18n('Meaning sticks when you force usage; sentences expose gaps fast.', 'El significado se fija cuando lo usas; las frases revelan huecos rápido.', 'Le sens s’ancre quand vous l’utilisez; les phrases révèlent vite les lacunes.', 'Betekenis blijft hangen door gebruik; zinnen tonen snel de gaten.'),
                        trap_i18n: isLanguageSkill
                            ? mkI18n('Word-for-word translation leads to wrong usage.', 'La traducción literal suele llevar a un uso incorrecto.', 'La traduction mot à mot mène souvent à un mauvais usage.', 'Woord-voor-woord vertalen leidt vaak tot verkeerd gebruik.'),
                        _v: 1
                    }
                });
            }
            return roadmap;
        };

        const playbook = {
            schema_version: 'v1-playbook',
            objective_i18n: mkI18n(goalClean, goalClean, goalClean, goalClean),
            roadmap: buildRoadmap(),
            checklist: (isLanguageSkill
                ? [
                    mkI18n('I can introduce myself and my goals clearly (B1).', 'Puedo presentarme y mis objetivos con claridad (B1).', 'Je peux me présenter et exprimer mes objectifs clairement (B1).', 'Ik kan mezelf en mijn doelen duidelijk introduceren (B1).'),
                    mkI18n('I can write a short email/message with a clear ask.', 'Puedo escribir un email/mensaje corto con una petición clara.', 'Je peux écrire un email/message court avec une demande claire.', 'Ik kan een korte email/bericht schrijven met een duidelijke vraag.'),
                    mkI18n('I can talk about past experiences and future plans.', 'Puedo hablar de experiencias pasadas y planes futuros.', 'Je peux parler d’expériences passées et de projets futurs.', 'Ik kan praten over ervaringen en plannen.'),
                    mkI18n('I can keep a 5-minute conversation with corrections.', 'Puedo sostener una conversación de 5 minutos con correcciones.', 'Je peux tenir une conversation de 5 minutes avec corrections.', 'Ik kan 5 minuten gesprek voeren met correcties.'),
                    mkI18n('I can understand the main point of a short audio.', 'Puedo entender la idea principal de un audio corto.', 'Je peux comprendre l’essentiel d’un court audio.', 'Ik kan de hoofdlijn van korte audio begrijpen.'),
                    mkI18n('I can learn 10 new words/day and review them.', 'Puedo aprender 10 palabras/día y repasarlas.', 'Je peux apprendre 10 mots/jour et les réviser.', 'Ik kan 10 woorden/dag leren en herhalen.')
                ]
                : [
                    mkI18n(`I can justify key design decisions in ${topicClean}.`, `Puedo justificar decisiones clave en ${topicClean}.`, `Je sais justifier des décisions clés en ${topicClean}.`, `Ik kan kernkeuzes in ${topicClean} onderbouwen.`),
                    mkI18n('I can compare at least 3 alternatives with trade-offs.', 'Puedo comparar al menos 3 alternativas con trade-offs.', 'Je peux comparer au moins 3 alternatives avec des compromis.', 'Ik kan minstens 3 alternatieven vergelijken met trade-offs.'),
                    mkI18n('I can debug a failure scenario with a clear checklist.', 'Puedo depurar un fallo con una checklist clara.', 'Je peux diagnostiquer une panne avec une checklist claire.', 'Ik kan een failure debuggen met een duidelijke checklist.'),
                    mkI18n('I can optimize cost/latency/risk with reasoning.', 'Puedo optimizar coste/latencia/riesgo con razonamiento.', 'Je peux optimiser coût/latence/risque avec justification.', 'Ik kan kosten/latency/risico optimaliseren met argumentatie.'),
                    mkI18n('I can explain the “common trap” for each concept.', 'Puedo explicar la “trampa común” de cada concepto.', 'Je peux expliquer le “piège courant” de chaque concept.', 'Ik kan de “valkuil” per concept uitleggen.'),
                    mkI18n('I can pass a timed drill (5Q) consistently.', 'Puedo pasar un simulacro cronometrado (5 preguntas) de forma consistente.', 'Je peux réussir un drill chronométré (5 questions) de façon régulière.', 'Ik kan consequent een timed drill (5 vragen) halen.')
                ]).map((text_i18n, idx) => ({ id: `chk_${idx + 1}`, text_i18n, checked: false })),
            interview: (isLanguageSkill
                ? [
                    {
                        id: 'int_1',
                        question_i18n: mkI18n('How do you handle unknown words in a conversation?', '¿Cómo manejas palabras desconocidas en una conversación?', 'Comment gérez-vous les mots inconnus en conversation ?', 'Hoe ga je om met onbekende woorden in een gesprek?'),
                        answer_i18n: mkI18n('Use context, rephrase, and ask a clarification question.', 'Usa contexto, reformula y haz una pregunta de aclaración.', 'Utilisez le contexte, reformulez et posez une question de clarification.', 'Gebruik context, herformuleer en stel een verduidelijkingsvraag.'),
                        justification_i18n: mkI18n('It keeps the conversation moving while still learning the word.', 'Mantiene la conversación y sigues aprendiendo.', 'Cela maintient la conversation tout en apprenant le mot.', 'Het houdt het gesprek gaande en je leert toch.'),
                        trap_i18n: mkI18n('Going silent to translate every word.', 'Quedarte en silencio para traducir todo.', 'Se taire pour tout traduire.', 'Stilvallen om alles te vertalen.')
                    },
                    {
                        id: 'int_2',
                        question_i18n: mkI18n('What is your daily routine to reach B1?', '¿Cuál es tu rutina diaria para llegar a B1?', 'Quelle routine quotidienne pour atteindre B1 ?', 'Wat is je dagelijkse routine om B1 te halen?'),
                        answer_i18n: mkI18n('10 words + 5 sentences + 2 minutes speaking + 1 quick quiz.', '10 palabras + 5 frases + 2 min hablando + 1 quiz.', '10 mots + 5 phrases + 2 min oral + 1 quiz.', '10 woorden + 5 zinnen + 2 min spreken + 1 quiz.'),
                        justification_i18n: mkI18n('Short, repeatable, and forces output daily.', 'Corto, repetible y obliga a producir.', 'Court, reproductible, et force la production.', 'Kort, herhaalbaar en dwingt output.'),
                        trap_i18n: mkI18n('Only reading/watching without speaking or writing.', 'Solo leer/ver sin hablar ni escribir.', 'Lire/regarder sans parler ni écrire.', 'Alleen lezen/kijken zonder spreken of schrijven.')
                    }
                ]
                : [
                    {
                        id: 'int_1',
                        question_i18n: mkI18n(`Explain ${topicClean} to a junior in 60 seconds.`, `Explica ${topicClean} a un junior en 60 segundos.`, `Expliquez ${topicClean} à un junior en 60 secondes.`, `Leg ${topicClean} uit aan een junior in 60 seconden.`),
                        answer_i18n: mkI18n('Start with the problem, then the simplest mental model, then 1 example.', 'Empieza por el problema, luego el modelo mental y 1 ejemplo.', 'Commencez par le problème, puis le modèle mental, puis 1 exemple.', 'Begin met het probleem, dan het model, dan 1 voorbeeld.'),
                        justification_i18n: mkI18n('Shows understanding without hiding behind jargon.', 'Muestra comprensión sin esconderse en jerga.', 'Montre la compréhension sans jargon.', 'Toont begrip zonder jargon.'),
                        trap_i18n: mkI18n('Listing features without a decision or example.', 'Listar features sin decisión ni ejemplo.', 'Lister des fonctionnalités sans décision ni exemple.', 'Features opsommen zonder beslissing of voorbeeld.')
                    },
                    {
                        id: 'int_2',
                        question_i18n: mkI18n('What trade-off do you optimize first: risk, cost, or latency?', '¿Qué trade-off optimizas primero: riesgo, coste o latencia?', 'Quel compromis optimisez-vous d’abord : risque, coût ou latence ?', 'Welke trade-off optimaliseer je eerst: risico, kosten of latency?'),
                        answer_i18n: mkI18n('Risk first for critical systems; then latency; cost last unless constrained.', 'Riesgo primero en sistemas críticos; luego latencia; coste al final.', 'Risque d’abord pour les systèmes critiques; puis latence; coût en dernier.', 'Risico eerst bij kritieke systemen; dan latency; kosten als laatste.'),
                        justification_i18n: mkI18n('Cost savings don’t matter if the system is down.', 'Ahorrar no sirve si el sistema cae.', 'Le coût ne compte pas si le système tombe.', 'Kosten besparen helpt niet als het systeem down is.'),
                        trap_i18n: mkI18n('Optimizing cost early without validating reliability.', 'Optimizar coste sin validar fiabilidad.', 'Optimiser le coût sans valider la fiabilité.', 'Kosten optimaliseren zonder betrouwbaarheid te checken.')
                    }
                ]),
            quizzes: [
                {
                    id: 'quiz_1',
                    title_i18n: mkI18n('Quick Quiz: fundamentals', 'Quiz rápido: fundamentos', 'Quiz rapide : fondamentaux', 'Snelle quiz: fundamentals'),
                    questions: [
                        {
                            prompt_i18n: mkI18n('What makes learning “stick” in PINBRIDGE COACH?', '¿Qué hace que el aprendizaje se “fije” en COACH?', 'Qu’est-ce qui fait que l’apprentissage “s’ancre” ?', 'Wat zorgt dat leren “blijft hangen”?'),
                            options_i18n: [
                                mkI18n('Committing to a decision, then feedback.', 'Comprometerte con una decisión y luego feedback.', 'S’engager sur une décision puis feedback.', 'Een beslissing nemen, daarna feedback.'),
                                mkI18n('Reading more theory.', 'Leer más teoría.', 'Lire plus de théorie.', 'Meer theorie lezen.'),
                                mkI18n('Only watching videos.', 'Solo ver vídeos.', 'Regarder seulement des vidéos.', 'Alleen video’s kijken.')
                            ],
                            correct_index: 0,
                            explain_i18n: mkI18n('Decision-first forces recall and exposes gaps immediately.', 'Decision-first fuerza el recuerdo y revela huecos.', 'Decision-first force le rappel et révèle les lacunes.', 'Decision-first dwingt recall en toont gaten.')
                        },
                        {
                            prompt_i18n: mkI18n('If you’re not sure, what should you do?', 'Si no estás seguro, ¿qué haces?', 'Si vous hésitez, que faites-vous ?', 'Als je twijfelt, wat doe je?'),
                            options_i18n: [
                                mkI18n('Choose, write why, then review the feedback.', 'Elige, escribe por qué y revisa el feedback.', 'Choisissez, écrivez pourquoi, puis lisez le feedback.', 'Kies, schrijf waarom, lees feedback.'),
                                mkI18n('Skip the session.', 'Saltarte la sesión.', 'Sauter la session.', 'Sla de sessie over.'),
                                mkI18n('Wait until you feel confident.', 'Esperar a sentirte confiado.', 'Attendre d’être confiant.', 'Wachten tot je zeker bent.')
                            ],
                            correct_index: 0,
                            explain_i18n: mkI18n('The point is calibrated confidence, not perfect certainty.', 'El punto es calibrar confianza, no certeza perfecta.', 'Le but est de calibrer la confiance, pas d’être parfait.', 'Het gaat om kalibratie, niet perfectie.')
                        },
                        {
                            prompt_i18n: mkI18n('What happens when you fail with low confidence?', '¿Qué pasa si fallas con baja confianza?', 'Que se passe-t-il si vous échouez avec faible confiance ?', 'Wat gebeurt er als je faalt met lage confidence?'),
                            options_i18n: [
                                mkI18n('You get an assisted retry (Pass 2).', 'Tienes un reintento asistido (Pass 2).', 'Vous obtenez une nouvelle tentative assistée (Pass 2).', 'Je krijgt een assisted retry (Pass 2).'),
                                mkI18n('Nothing changes.', 'Nada cambia.', 'Rien ne change.', 'Niets verandert.'),
                                mkI18n('You lose your skill.', 'Pierdes tu skill.', 'Vous perdez votre skill.', 'Je verliest je skill.')
                            ],
                            correct_index: 0,
                            explain_i18n: mkI18n('Two-pass mastery is designed for exactly this.', 'El 2-pass mastery es para esto.', 'Le 2-pass mastery est fait pour ça.', '2-pass mastery is precies hiervoor.')
                        }
                    ]
                }
            ]
        };

        const export_template = this._buildExportTemplate(topicClean, goalClean, playbook);

        const modules = isLanguageSkill
            ? [
                {
                    title_i18n: mkI18n('Vocabulary (B1)', 'Vocabulario (B1)', 'Vocabulaire (B1)', 'Woordenschat (B1)'),
                    id: 'mod_vocab',
                    unlock_rule: { min_sessions_done: 0, max_repeated_error_pattern: 5 },
                    domain_tags: ['vocab', 'b1']
                },
                {
                    title_i18n: mkI18n('Speaking + pronunciation', 'Speaking + pronunciación', 'Oral + prononciation', 'Spreken + uitspraak'),
                    id: 'mod_speaking',
                    unlock_rule: { min_sessions_done: 5, max_repeated_error_pattern: 5 },
                    domain_tags: ['speaking']
                },
                {
                    title_i18n: mkI18n('Writing (messages & email)', 'Writing (mensajes & email)', 'Écriture (messages & email)', 'Schrijven (berichten & email)'),
                    id: 'mod_writing',
                    unlock_rule: { min_sessions_done: 8, max_repeated_error_pattern: 5 },
                    domain_tags: ['writing']
                }
            ]
            : [
                {
                    title_i18n: mkI18n(`Fundamentals of ${topicClean}`, `Fundamentos de ${topicClean}`, `Principes de ${topicClean}`, `Fundamentals van ${topicClean}`),
                    id: 'mod_fund',
                    unlock_rule: { min_sessions_done: 5, max_repeated_error_pattern: 3 },
                    domain_tags: ['fundamental', topicClean]
                },
                {
                    title_i18n: mkI18n(`${topicClean} & State`, `${topicClean} y Estado`, `${topicClean} et État`, `${topicClean} & state`),
                    id: 'mod_state',
                    unlock_rule: { min_sessions_done: 10, max_repeated_error_pattern: 3 },
                    domain_tags: ['state', 'async']
                }
            ];

        return {
            skill: {
                title_i18n: mkI18n(topicClean, topicClean, topicClean, topicClean),
                goal_outcome_i18n: mkI18n(goalClean, goalClean, goalClean, goalClean),
                skill_type,
                start_date,
                roadmap_days: 30,
                content_version: '2.1.0',
                time_per_day_min: timeByIntensity[intensity] || 30,
                preferred_content_language: language || 'en',
                playbook: { ...playbook, export_template },
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

    _buildExportTemplate(topic, goal, playbook) {
        const lines = [];
        lines.push(`# PINBRIDGE COACH — ${topic}`);
        lines.push(`**Goal:** ${goal}`);
        lines.push('');
        lines.push('## Dashboard');
        lines.push('- Action of today: (open COACH → Start session)');
        lines.push('- Streak: ___ days');
        lines.push('');
        lines.push('## Roadmap (30 days)');
        for (const d of playbook?.roadmap || []) {
            lines.push(`- [ ] Day ${d.day}: ${d.topic_i18n?.en || ''}`);
            lines.push(`  - Action (30–60m): ${d.action_i18n?.en || ''}`);
            lines.push(`  - Mini-decision: ${d.decision?.prompt_i18n?.en || ''}`);
        }
        lines.push('');
        lines.push('## Exam Checklist (Mark of mastery)');
        for (const c of playbook?.checklist || []) {
            lines.push(`- [ ] ${c.text_i18n?.en || ''}`);
        }
        lines.push('');
        lines.push('## Interview Mode (Q&A)');
        for (const q of playbook?.interview || []) {
            lines.push(`- **Q:** ${q.question_i18n?.en || ''}`);
            lines.push(`  - **A:** ${q.answer_i18n?.en || ''}`);
            lines.push(`  - **Why:** ${q.justification_i18n?.en || ''}`);
            lines.push(`  - **Trap:** ${q.trap_i18n?.en || ''}`);
        }
        lines.push('');
        lines.push('## Quizzes');
        for (const quiz of playbook?.quizzes || []) {
            lines.push(`- ${quiz.title_i18n?.en || ''}`);
            for (const item of quiz.questions || []) {
                lines.push(`  - Q: ${item.prompt_i18n?.en || ''}`);
            }
        }
        lines.push('');
        lines.push('## Habits');
        lines.push('- [ ] Show up daily (30 minutes)');
        lines.push('- [ ] Write your “why” every session');
        return lines.join('\n');
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
