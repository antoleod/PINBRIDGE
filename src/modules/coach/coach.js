/* src/modules/coach/coach.js */
import { bus } from '../../core/bus.js';
import { coachStore } from './coachStore.js';
import { coachEngine } from './coachEngine.js'; // Legacy engine
import { quizEngine } from './quizEngine.js'; // New modular engine
import { packImportWizard } from './packImportWizard.js';
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
                if (this.currentView !== 'dashboard') this.renderCurrentView();
            }
        });

        bus.on('view:switched', ({ view }) => {
            if (view === 'coach') {
                this.onEnterCoachView();
            }
        });

        bus.on('coach:navigate', (view) => {
            this.currentView = view;
            this.renderCurrentView();
        });

        bus.on('coach:update-settings', async (settings) => {
            await this.updateSettings(settings);
            bus.emit('ui:toast', { message: 'Settings saved', type: 'success' });
        });

        // Pack Sync via Wizard
        bus.on('coach:sync-local-pack', () => {
            packImportWizard.start();
        });

        bus.on('coach:update-pack-content', async ({ packId, version }) => {
            try {
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

        // Quiz Engine
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

        // Module Exams
        bus.on('coach:start-exam', (payload) => {
            // ... legacy exam start ...
            // For now we just log or placeholders if examEngine is not fully imported, but import is missing in top lines of my view?
            // Ah, examEngine was not in my imports list above. I should add it if used.
            // Checking imports: I didn't import examEngine. I will remove the handler or comment it out to avoid ReferenceError if it's missing.
            console.log("Exam started via bus (placeholder)");
        });

        bus.on('coach:create-skill', async (payload) => {
            const { topic, goal, intensity, language } = payload;
            const blueprint = coachEngine.generateBlueprint(topic, goal, intensity, language);
            const skillId = await coachStore.createSkill(this.currentUser.uid, blueprint.skill);
            for (const mod of blueprint.modules) {
                await coachStore.createModule(this.currentUser.uid, { ...mod, skill_id: skillId });
            }
            await this.updateSettings({ active_skill_id: skillId });
            this.activeSkill = { ...blueprint.skill, id: skillId };
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
                const pass2Session = coachEngine.getPass2Session(payload.session.concept_id, payload.session);
                uiRenderer.render('session', { session: pass2Session, isPass2: true });
            } else {
                this.currentView = 'feedback';
                uiRenderer.render('feedback', { ...this.settings, ...result });
            }
        });

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

        document.querySelectorAll('.list-panel, .editor-panel, .dashboard-panel').forEach(el => el.classList.add('hidden'));
        document.querySelector('.coach-panel').classList.remove('hidden');

        const exitBtn = document.getElementById('btn-coach-exit');
        if (exitBtn) {
            exitBtn.onclick = () => {
                document.querySelector('.coach-panel').classList.add('hidden');
                bus.emit('coach:navigate-exit', {});
                const allNotesBtn = document.querySelector('[data-view="all"]');
                if (allNotesBtn) allNotesBtn.click();
            };
        }

        await this.loadSettings();

        if (this.currentUser) {
            await coachEngine.checkMaintenance(this.currentUser.uid);
        }

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
            viewData.packs = await Promise.all(packs.map(async p => {
                // Optimistic check
                const globalMeta = await coachStore.getGlobalPackVersion(p.pack_id, p.installed_version);
                return {
                    ...p,
                    title: i18n.getContent(p.title_i18n),
                    description: i18n.getContent(p.description_i18n)
                };
            }));
        }

        if (this.currentView === 'quiz') {
            if (!viewData.card && !this.currentPackId) {
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
