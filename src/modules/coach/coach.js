/* src/modules/coach/coach.js */
import { bus } from '../../core/bus.js';
import { coachStore } from './coachStore.js';
import { coachEngine } from './coachEngine.js'; // Legacy engine
import { quizEngine } from './quizEngine.js'; // New modular engine
import { packSync } from './packSync.js';
import { tts } from './tts.js';
import { uiRenderer } from './uiRenderer.js';
import { i18n } from './i18n.js';
import { auth, db } from '../../firebase.js';

class CoachService {
    constructor() {
        this.currentUser = null;
        this.settings = {};
        this.activeSkill = null;
        this.currentView = 'dashboard';
        this.currentPackId = null;
    }

    async init() {
        this.currentUser = auth.currentUser;
        auth.onAuthStateChanged(async (user) => {
            this.currentUser = user;
            if (user) {
                await this.loadSettings();
                // If we are in coach view, re-render
                if (this.currentView !== 'dashboard') this.renderCurrentView();
            }
        });

        bus.on('view:switched', ({ view }) => {
            if (view === 'coach') {
                this.onEnterCoachView();
            }
        });

        // --- Event Bus Bindings ---

        bus.on('coach:navigate', (view) => {
            this.currentView = view;
            this.renderCurrentView();
        });

        bus.on('coach:update-settings', async (settings) => {
            await this.updateSettings(settings);
            bus.emit('ui:toast', { message: 'Settings saved', type: 'success' });
        });

        bus.on('coach:sync-local-pack', async () => {
            bus.emit('ui:toast', { message: 'Syncing local pack...', type: 'info' });
            try {
                const result = await packSync.syncLocalPackToFirestore();
                if (result.status === 'skipped') {
                    bus.emit('ui:toast', { message: `Pack already up to date (v${result.version})`, type: 'info' });
                } else {
                    bus.emit('ui:toast', { message: `Pack synced! ${result.oldVersion} -> ${result.newVersion}`, type: 'success' });
                }
                // Refresh view if in settings
                if (this.currentView === 'settings') this.renderCurrentView();
            } catch (e) {
                bus.emit('ui:toast', { message: `Sync Failed: ${e.message}`, type: 'error' });
            }
        });

        bus.on('coach:update-pack-content', async ({ packId, version }) => {
            try {
                // To update: we essentially re-install user pack with new version
                // 1. Fetch metadata (we need title etc)
                const globalData = await coachStore.getGlobalPackVersion(packId, version);
                if (globalData) {
                    await coachStore.installUserPack(this.currentUser.uid, packId, version, globalData);
                    bus.emit('ui:toast', { message: `Updated to v${version}`, type: 'success' });
                    this.renderCurrentView();
                }
            } catch (e) {
                console.error(e);
            }
        });

        // --- Use New Quiz Engine ---
        bus.on('coach:start-quiz', async ({ packId }) => {
            try {
                const quizParams = await quizEngine.generateSession(packId, this.settings.content_language);
                if (!quizParams) {
                    bus.emit('ui:toast', { message: 'No cards available to review right now.', type: 'info' });
                    return;
                }
                this.currentPackId = packId;
                this.currentView = 'quiz';
                uiRenderer.render('quiz', { ...quizParams, pack_title: "Pack Practice" });
            } catch (e) {
                console.error(e);
                bus.emit('ui:toast', { message: `Quiz Error: ${e.message}`, type: 'error' });
            }
        });

        bus.on('coach:quiz-next', () => {
            if (this.currentPackId) {
                bus.emit('coach:start-quiz', { packId: this.currentPackId });
            }
        });

        bus.on('coach:tts-play', ({ text, lang }) => {
            tts.speak(text, { lang: lang, rate: 0.9 });
        });
        bus.on('coach:start-exam', (payload) => {
            // Start Module Exam
            const exam = examEngine.startExam('mod_exam_1'); // Dynamic in real app
            this.currentView = 'exam';
            uiRenderer.render('exam', { exam, question: exam.questions[0] });
        });

        bus.on('coach:submit-exam-answer', (payload) => {
            const { exam, isCorrect } = examEngine.submitAnswer(payload.exam, payload.questionId, payload.answerIndex);

            if (exam.currentQuestionIndex >= exam.totalQuestions) {
                const results = examEngine.finishExam(exam);
                this.currentView = 'exam-results';
                uiRenderer.render('exam-results', { ...results }); // Pass results object
            } else {
                exam.currentQuestionIndex++;
                uiRenderer.render('exam', { exam, question: exam.questions[exam.currentQuestionIndex - 1] });
            }
        });


        bus.on('coach:create-skill', async (payload) => {
            // Wizard completion
            const { topic, goal, intensity, language } = payload;
            const blueprint = coachEngine.generateBlueprint(topic, goal, intensity, language);

            // Save to Firestore
            const skillId = await coachStore.createSkill(this.currentUser.uid, blueprint.skill);
            for (const mod of blueprint.modules) {
                await coachStore.createModule(this.currentUser.uid, { ...mod, skill_id: skillId });
            }

            // Set as active
            await this.updateSettings({ active_skill_id: skillId });

            this.activeSkill = { ...blueprint.skill, id: skillId }; // Optimistic update

            bus.emit('coach:navigate', 'dashboard');
            bus.emit('ui:toast', { message: 'Skill Created Successfully!', type: 'success' });
        });

        bus.on('coach:submit-answer', async (payload) => {
            const result = await coachEngine.submitSessionResult(
                payload.session,
                payload.answerIndex,
                payload.confidence,
                payload.justification
            );

            if (result.requiresPass2 && !payload.session.is_pass_2) {
                // Trigger Pass 2 immediately if needed (and wasn't already Pass 2)
                const pass2Session = coachEngine.getPass2Session(payload.session.concept_id, payload.session);
                uiRenderer.render('session', { session: pass2Session, isPass2: true });
            } else {
                this.currentView = 'feedback';
                uiRenderer.render('feedback', { ...this.settings, ...result });
            }
        });

        // Set Activate Skill
        bus.on('coach:activate-skill', async (skillId) => {
            await this.updateSettings({ active_skill_id: skillId });
            const skill = await coachStore.getSkill(this.currentUser.uid, skillId);
            this.activeSkill = skill;
            bus.emit('coach:navigate', 'dashboard');
        });

        console.log("Coach Module Initialized (Premium)");
    }

    async loadSettings() {
        if (!this.currentUser) return;
        this.settings = await coachStore.getSettings(this.currentUser.uid);
        i18n.setLanguages(this.settings.ui_language, this.settings.content_language);

        if (this.settings.active_skill_id) {
            this.activeSkill = await coachStore.getSkill(this.currentUser.uid, this.settings.active_skill_id);
        }
    }

    async onEnterCoachView() {
        if (!this.currentUser) {
            uiRenderer.render('login-required');
            return;
        }

        // Manual Panel Management (since we are now a "View" inside Vault Screen)
        document.querySelectorAll('.list-panel, .editor-panel, .dashboard-panel').forEach(el => el.classList.add('hidden'));
        document.querySelector('.coach-panel').classList.remove('hidden');

        // Bind Global Coach Events (Exit)
        const exitBtn = document.getElementById('btn-coach-exit');
        if (exitBtn) {
            exitBtn.onclick = () => {
                document.querySelector('.coach-panel').classList.add('hidden');
                // Return to default view (e.g., All Notes)
                bus.emit('coach:navigate-exit', {});
                // We fire a UI event to let the main app take over, usually 'view:switched' logic in UI handles 'all'
                // But we need to simulate a click on "All Notes" or direct manipulation
                const allNotesBtn = document.querySelector('[data-view="all"]');
                if (allNotesBtn) allNotesBtn.click();
            };
        }

        await this.loadSettings();

        // Perform maintenance/decay check
        if (this.currentUser) {
            await coachEngine.checkMaintenance(this.currentUser.uid);
        }

        // If no active skill, redirect to skills library or add-skill
        if (!this.settings.active_skill_id) {
            this.currentView = 'skills';
        } else {
            this.currentView = 'dashboard';
        }

        this.renderCurrentView();
    }

    async renderCurrentView() {
        let viewData = { settings: this.settings };

        if (this.currentView === 'dashboard') {
            if (this.activeSkill) {
                viewData.skillName = i18n.getContent(this.activeSkill.title_i18n);
                const maintenance = await coachStore.getMaintenanceStatus(this.currentUser.uid);
                viewData.streak = maintenance?.streak_days || 0;
                const reviews = await coachStore.getDueReviews(this.currentUser.uid);
                viewData.reviewsCount = reviews.length;
            }
        }

        if (this.currentView === 'session') {
            if (!this.activeSkill) return;
            const session = await coachEngine.getDailySession(this.activeSkill.id);
            viewData.session = session;
        }

        if (this.currentView === 'skills') {
            const skills = await coachStore.getSkills(this.currentUser.uid);
            viewData.skills = skills.map(s => ({
                ...s,
                title: i18n.getContent(s.title_i18n),
                skill_type: s.skill_type || 'technical'
            }));
        }

        if (this.currentView === 'packs') {
            const packs = await coachStore.getUserPacks(this.currentUser.uid);
            // Enrich with "Update Available" check (optimistic)
            viewData.packs = await Promise.all(packs.map(async p => {
                const globalMeta = await coachStore.getGlobalPackVersion(p.pack_id, p.installed_version); // Ideally fetch pack root to check 'latest'
                // Simplification for MVP:
                return {
                    ...p,
                    title: i18n.getContent(p.title_i18n),
                    description: i18n.getContent(p.description_i18n)
                };
            }));
        }

        if (this.currentView === 'import-pack') {
            // Static view, no data needed initially
        }

        if (this.currentView === 'quiz') {
            // Data passed directly via start-quiz event usually, but if refresh happens:
            // We fallback or redirect.
            if (!viewData.card) {
                // If we are here without data, maybe redirect back to packs
                this.currentView = 'packs';
                this.renderCurrentView();
                return;
            }
        }

        if (this.currentView === 'exam-center') {
            const modules = await coachStore.getModulesForSkill(this.currentUser.uid, this.settings.active_skill_id);
            viewData.modules = modules;
        }

        if (this.currentView === 'error-cards') {
            const errors = await coachStore.getErrorMemory(this.currentUser.uid);
            viewData.errors = errors;
        }

        uiRenderer.render(this.currentView, viewData);
    }
    async updateSettings(newSettings) {
        if (!this.currentUser) return;
        this.settings = { ...this.settings, ...newSettings };
        await coachStore.saveSettings(this.currentUser.uid, this.settings);
        i18n.setLanguages(this.settings.ui_language, this.settings.content_language);
        this.renderCurrentView();
    }
}

export const coachService = new CoachService();
coachService.init();
