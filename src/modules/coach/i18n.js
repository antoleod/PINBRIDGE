/* src/modules/coach/i18n.js */

const SUPPORTED = ['en', 'fr', 'es', 'nl'];

function safeLang(lang) {
    return SUPPORTED.includes(lang) ? lang : 'en';
}

class CoachI18n {
    constructor() {
        this.uiLang = 'en';
        this.contentLang = 'en';
        this.strings = {
            en: {
                coach_title: 'Coach',
                coach_subtitle: 'Decision-first learning, offline-first friendly.',

                coach_dashboard_title: 'Your plan',
                coach_dashboard_subtitle: 'One decision per session. Feedback after you commit.',
                coach_today_title: "Today's decision",
                coach_no_plan_hint: 'Create a 30-day roadmap for any topic (certification, language, habit, skill).',

                coach_action_start_session: 'Start session',
                coach_action_submit: 'Submit',
                coach_action_continue: 'Continue',
                coach_action_back: 'Back',
                coach_action_settings: 'Settings',
                coach_action_view_roadmap: 'Roadmap',
                coach_action_modules: 'Modules',
                coach_action_start_exam: 'Start exam',
                coach_action_timed_drill: 'Timed drill',
                coach_action_change_topic: 'Change topic',
                coach_action_create_plan: 'Create roadmap',
                coach_action_retry_assisted: 'Retry (assisted)',
                coach_action_show_all_30: 'Show all 30 days',
                coach_action_checklist: 'Checklist',
                coach_action_interview: 'Interview',
                coach_action_quizzes: 'Quizzes',
                coach_action_export: 'Export',
                coach_action_packs: 'Packs',
                coach_action_open_day: 'Open day',
                coach_status_todo: 'To do',
                coach_status_doing: 'Doing',
                coach_status_done: 'Done',
                coach_action_copy: 'Copy',
                coach_toast_copied: 'Copied',

                myPacks: 'My packs',
                importPack: 'Import pack',
                back: 'Back',

                coach_metric_streak: 'Streak',
                coach_metric_today: 'Today',
                coach_metric_load: 'Cognitive load',

                coach_label_scenario: 'Scenario',
                coach_label_hint: 'Hint',
                coach_label_decision: 'Decision',
                coach_label_confidence: 'Confidence (1–5)',
                coach_label_why: 'Why did you choose this?',
                coach_label_explain: 'Explanation',
                coach_label_trap: 'Common trap',
                coach_label_calibration: 'Confidence calibration',
                coach_label_resources: 'Resources (only if needed)',
                coach_label_teachback: 'Teach-back (required)',
                coach_label_action_practice: 'Action practice (20–30 min)',
                coach_label_mini_challenge: 'Mini-challenge',
                coach_label_results: 'Results',

                coach_confidence_1: 'Guessing',
                coach_confidence_3: 'Unsure',
                coach_confidence_5: 'Confident',

                coach_placeholder_why: 'My reasoning is…',
                coach_placeholder_teachback: 'Explain it in 1–2 sentences as if teaching a colleague.',
                coach_hint_required: 'Required.',
                coach_hint_teachback: 'This locks in learning and reveals gaps.',
                coach_toggle_no_resources: 'No resources',
                coach_toggle_on: 'On',
                coach_hint_sources_versioned: 'All resources/questions include source metadata + content_version.',

                coach_feedback_correct: 'Correct',
                coach_feedback_incorrect: 'Not quite',

                coach_settings_title: 'Coach settings',
                coach_settings_ui_language: 'UI language',
                coach_settings_ui_language_hint: 'Labels/buttons in Coach use this language.',
                coach_settings_content_language: 'Content language',
                coach_settings_content_language_hint: 'Scenarios/options/explanations use this language.',
                coach_settings_allow_toggle: 'Allow content language toggle',
                coach_settings_allow_toggle_hint: 'If off, content_language follows UI language.',

                coach_exam_pass: 'Exam passed',
                coach_exam_fail: 'Needs improvement',
                coach_exam_score: 'Score',
                coach_exam_weak_domains: 'Weak areas',
                coach_exam_remediation_title: '3-day remediation plan',
                coach_drill_title: 'Timed drill',

                coach_roadmap_title: 'Roadmap (30 days)',
                coach_roadmap_sessions_title: 'Upcoming sessions',

                coach_modules_title: 'Modules',
                coach_modules_hint: 'Interleaving is on: sessions mix modules automatically.'
            },
            es: {
                coach_title: 'Coach',
                coach_subtitle: 'Aprendizaje decision-first, con enfoque offline-first.',

                coach_dashboard_title: 'Tu plan',
                coach_dashboard_subtitle: 'Una decisión por sesión. Feedback después de comprometerte.',
                coach_today_title: 'La decisión de hoy',
                coach_no_plan_hint: 'Crea un roadmap de 30 días para cualquier tema (certificación, idioma, hábito, habilidad).',

                coach_action_start_session: 'Empezar sesión',
                coach_action_submit: 'Enviar',
                coach_action_continue: 'Continuar',
                coach_action_back: 'Volver',
                coach_action_settings: 'Ajustes',
                coach_action_view_roadmap: 'Roadmap',
                coach_action_modules: 'Módulos',
                coach_action_start_exam: 'Iniciar examen',
                coach_action_timed_drill: 'Drill con tiempo',
                coach_action_change_topic: 'Cambiar tema',
                coach_action_create_plan: 'Crear roadmap',
                coach_action_retry_assisted: 'Reintentar (asistido)',
                coach_action_show_all_30: 'Ver los 30 días',
                coach_action_checklist: 'Checklist',
                coach_action_interview: 'Entrevista',
                coach_action_quizzes: 'Quizzes',
                coach_action_export: 'Exportar',
                coach_action_packs: 'Packs',
                coach_action_open_day: 'Abrir día',
                coach_status_todo: 'Por hacer',
                coach_status_doing: 'Haciendo',
                coach_status_done: 'Hecho',
                coach_action_copy: 'Copiar',
                coach_toast_copied: 'Copiado',

                myPacks: 'Mis packs',
                importPack: 'Importar pack',
                back: 'Volver',

                coach_metric_streak: 'Racha',
                coach_metric_today: 'Hoy',
                coach_metric_load: 'Carga cognitiva',

                coach_label_scenario: 'Escenario',
                coach_label_hint: 'Pista',
                coach_label_decision: 'Decisión',
                coach_label_confidence: 'Confianza (1–5)',
                coach_label_why: '¿Por qué elegiste esto?',
                coach_label_explain: 'Explicación',
                coach_label_trap: 'Trampa común',
                coach_label_calibration: 'Calibración de confianza',
                coach_label_resources: 'Recursos (solo si hace falta)',
                coach_label_teachback: 'Teach-back (obligatorio)',
                coach_label_action_practice: 'Acción práctica (20–30 min)',
                coach_label_mini_challenge: 'Mini-reto',
                coach_label_results: 'Resultados',

                coach_confidence_1: 'Adivinando',
                coach_confidence_3: 'Dudando',
                coach_confidence_5: 'Seguro',

                coach_placeholder_why: 'Mi razonamiento es…',
                coach_placeholder_teachback: 'Explícalo en 1–2 frases como si enseñaras a un colega.',
                coach_hint_required: 'Obligatorio.',
                coach_hint_teachback: 'Esto fija el aprendizaje y revela huecos.',
                coach_toggle_no_resources: 'Sin recursos',
                coach_toggle_on: 'Activado',
                coach_hint_sources_versioned: 'Todos los recursos/preguntas incluyen source metadata + content_version.',

                coach_feedback_correct: 'Correcto',
                coach_feedback_incorrect: 'No del todo',

                coach_settings_title: 'Ajustes de Coach',
                coach_settings_ui_language: 'Idioma de la UI',
                coach_settings_ui_language_hint: 'Labels/botones de Coach usan este idioma.',
                coach_settings_content_language: 'Idioma del contenido',
                coach_settings_content_language_hint: 'Escenarios/opciones/explicaciones usan este idioma.',
                coach_settings_allow_toggle: 'Permitir cambiar idioma del contenido',
                coach_settings_allow_toggle_hint: 'Si se desactiva, content_language sigue a la UI.',

                coach_exam_pass: 'Examen aprobado',
                coach_exam_fail: 'Necesita mejora',
                coach_exam_score: 'Puntuación',
                coach_exam_weak_domains: 'Áreas débiles',
                coach_exam_remediation_title: 'Plan de remediación (3 días)',
                coach_drill_title: 'Drill con tiempo',

                coach_roadmap_title: 'Roadmap (30 días)',
                coach_roadmap_sessions_title: 'Próximas sesiones',

                coach_modules_title: 'Módulos',
                coach_modules_hint: 'Interleaving activo: las sesiones mezclan módulos automáticamente.'
            },
            fr: {
                coach_title: 'Coach',
                coach_subtitle: "Apprentissage decision-first, orienté offline-first.",

                coach_dashboard_title: 'Votre plan',
                coach_dashboard_subtitle: 'Une décision par session. Feedback après engagement.',
                coach_today_title: "Décision du jour",
                coach_no_plan_hint: "Créez une feuille de route de 30 jours pour n'importe quel sujet (certification, langue, habitude, compétence).",

                coach_action_start_session: 'Démarrer la session',
                coach_action_submit: 'Valider',
                coach_action_continue: 'Continuer',
                coach_action_back: 'Retour',
                coach_action_settings: 'Réglages',
                coach_action_view_roadmap: 'Roadmap',
                coach_action_modules: 'Modules',
                coach_action_start_exam: "Démarrer l'examen",
                coach_action_timed_drill: 'Drill chronométré',
                coach_action_change_topic: 'Changer de sujet',
                coach_action_create_plan: 'Créer un roadmap',
                coach_action_retry_assisted: 'Réessayer (assisté)',
                coach_action_show_all_30: 'Voir les 30 jours',
                coach_action_checklist: 'Checklist',
                coach_action_interview: 'Entretien',
                coach_action_quizzes: 'Quiz',
                coach_action_export: 'Exporter',
                coach_action_packs: 'Packs',
                coach_action_open_day: 'Ouvrir le jour',
                coach_status_todo: 'À faire',
                coach_status_doing: 'En cours',
                coach_status_done: 'Fait',
                coach_action_copy: 'Copier',
                coach_toast_copied: 'Copié',

                myPacks: 'Mes packs',
                importPack: 'Importer un pack',
                back: 'Retour',

                coach_metric_streak: 'Série',
                coach_metric_today: "Aujourd'hui",
                coach_metric_load: 'Charge cognitive',

                coach_label_scenario: 'Scénario',
                coach_label_hint: 'Indice',
                coach_label_decision: 'Décision',
                coach_label_confidence: 'Confiance (1–5)',
                coach_label_why: 'Pourquoi ce choix ?',
                coach_label_explain: 'Explication',
                coach_label_trap: 'Piège courant',
                coach_label_calibration: 'Calibration de confiance',
                coach_label_resources: 'Ressources (si nécessaire)',
                coach_label_teachback: 'Teach-back (obligatoire)',
                coach_label_action_practice: 'Action pratique (20–30 min)',
                coach_label_mini_challenge: 'Mini-défi',
                coach_label_results: 'Résultats',

                coach_confidence_1: 'Au hasard',
                coach_confidence_3: 'Incertain',
                coach_confidence_5: 'Confiant',

                coach_placeholder_why: 'Mon raisonnement…',
                coach_placeholder_teachback: "Expliquez en 1–2 phrases comme si vous enseigniez à un collègue.",
                coach_hint_required: 'Obligatoire.',
                coach_hint_teachback: "Cela consolide l'apprentissage et révèle les lacunes.",
                coach_toggle_no_resources: 'Sans ressources',
                coach_toggle_on: 'Activé',
                coach_hint_sources_versioned: 'Chaque ressource/question inclut des métadonnées de source + content_version.',

                coach_feedback_correct: 'Correct',
                coach_feedback_incorrect: 'Pas tout à fait',

                coach_settings_title: 'Réglages Coach',
                coach_settings_ui_language: "Langue de l'UI",
                coach_settings_ui_language_hint: "Les libellés/boutons de Coach utilisent cette langue.",
                coach_settings_content_language: 'Langue du contenu',
                coach_settings_content_language_hint: "Les scénarios/options/explications utilisent cette langue.",
                coach_settings_allow_toggle: 'Autoriser le changement de langue du contenu',
                coach_settings_allow_toggle_hint: "Si désactivé, content_language suit la langue UI.",

                coach_exam_pass: 'Examen réussi',
                coach_exam_fail: 'À améliorer',
                coach_exam_score: 'Score',
                coach_exam_weak_domains: 'Points faibles',
                coach_exam_remediation_title: 'Plan de remédiation (3 jours)',
                coach_drill_title: 'Drill chronométré',

                coach_roadmap_title: 'Roadmap (30 jours)',
                coach_roadmap_sessions_title: 'Sessions à venir',

                coach_modules_title: 'Modules',
                coach_modules_hint: "Interleaving activé : les sessions mélangent les modules automatiquement."
            },
            nl: {
                coach_title: 'Coach',
                coach_subtitle: 'Decision-first leren, offline-first vriendelijk.',

                coach_dashboard_title: 'Je plan',
                coach_dashboard_subtitle: 'Eén beslissing per sessie. Feedback nadat je kiest.',
                coach_today_title: 'Beslissing van vandaag',
                coach_no_plan_hint: 'Maak een 30-dagen roadmap voor elk onderwerp (certificering, taal, gewoonte, skill).',

                coach_action_start_session: 'Start sessie',
                coach_action_submit: 'Verstuur',
                coach_action_continue: 'Doorgaan',
                coach_action_back: 'Terug',
                coach_action_settings: 'Instellingen',
                coach_action_view_roadmap: 'Roadmap',
                coach_action_modules: 'Modules',
                coach_action_start_exam: 'Start examen',
                coach_action_timed_drill: 'Timed drill',
                coach_action_change_topic: 'Onderwerp wijzigen',
                coach_action_create_plan: 'Roadmap maken',
                coach_action_retry_assisted: 'Opnieuw (assisted)',
                coach_action_show_all_30: 'Toon alle 30 dagen',
                coach_action_checklist: 'Checklist',
                coach_action_interview: 'Interview',
                coach_action_quizzes: 'Quiz',
                coach_action_export: 'Export',
                coach_action_packs: 'Packs',
                coach_action_open_day: 'Open dag',
                coach_status_todo: 'Te doen',
                coach_status_doing: 'Bezig',
                coach_status_done: 'Klaar',
                coach_action_copy: 'Kopiëren',
                coach_toast_copied: 'Gekopieerd',

                coach_metric_streak: 'Streak',
                coach_metric_today: 'Vandaag',
                coach_metric_load: 'Cognitieve belasting',

                coach_label_scenario: 'Scenario',
                coach_label_hint: 'Hint',
                coach_label_decision: 'Beslissing',
                coach_label_confidence: 'Zelfvertrouwen (1–5)',
                coach_label_why: 'Waarom koos je dit?',
                coach_label_explain: 'Uitleg',
                coach_label_trap: 'Valkuil',
                coach_label_calibration: 'Kalibratie',
                coach_label_resources: 'Resources (alleen indien nodig)',
                coach_label_teachback: 'Teach-back (verplicht)',
                coach_label_action_practice: 'Actie-oefening (20–30 min)',
                coach_label_mini_challenge: 'Mini-uitdaging',
                coach_label_results: 'Resultaten',

                coach_confidence_1: 'Gok',
                coach_confidence_3: 'Twijfel',
                coach_confidence_5: 'Zeker',

                coach_placeholder_why: 'Mijn redenering is…',
                coach_placeholder_teachback: 'Leg het uit in 1–2 zinnen alsof je het aan een collega leert.',
                coach_hint_required: 'Verplicht.',
                coach_hint_teachback: 'Dit verankert het leren en toont gaten.',
                coach_toggle_no_resources: 'Geen resources',
                coach_toggle_on: 'Aan',
                coach_hint_sources_versioned: 'Elke resource/vraag heeft source metadata + content_version.',

                coach_feedback_correct: 'Correct',
                coach_feedback_incorrect: 'Niet helemaal',

                coach_settings_title: 'Coach-instellingen',
                coach_settings_ui_language: 'UI-taal',
                coach_settings_ui_language_hint: 'Labels/knoppen in Coach gebruiken deze taal.',
                coach_settings_content_language: 'Content-taal',
                coach_settings_content_language_hint: 'Scenario’s/opties/uitleg gebruiken deze taal.',
                coach_settings_allow_toggle: 'Content-taal wissel toestaan',
                coach_settings_allow_toggle_hint: 'Als uit, volgt content_language de UI-taal.',

                coach_exam_pass: 'Examen gehaald',
                coach_exam_fail: 'Verbetering nodig',
                coach_exam_score: 'Score',
                coach_exam_weak_domains: 'Zwakke punten',
                coach_exam_remediation_title: '3-daags remediation plan',
                coach_drill_title: 'Timed drill',

                coach_roadmap_title: 'Roadmap (30 dagen)',
                coach_roadmap_sessions_title: 'Komende sessies',

                coach_modules_title: 'Modules',
                coach_modules_hint: 'Interleaving is aan: sessies mixen modules automatisch.',

                myPacks: 'Mijn packs',
                importPack: 'Pack importeren',
                back: 'Terug'
            }
        };
    }

    setLanguages(uiLang, contentLang) {
        this.uiLang = safeLang(uiLang);
        this.contentLang = safeLang(contentLang ?? uiLang);
        return { uiLang: this.uiLang, contentLang: this.contentLang };
    }

    t(key) {
        const ui = this.strings[this.uiLang] || this.strings.en;
        return ui[key] || this.strings.en[key] || key;
    }

    getStringsFor(lang) {
        return this.strings[safeLang(lang)] || this.strings.en;
    }

    getContent(i18nField) {
        if (!i18nField) return '';
        if (typeof i18nField === 'string') return i18nField;
        const lang = safeLang(this.contentLang);
        return (
            i18nField[lang] ||
            i18nField.en ||
            i18nField.fr ||
            i18nField.es ||
            i18nField.nl ||
            ''
        );
    }
}

export const i18n = new CoachI18n();
