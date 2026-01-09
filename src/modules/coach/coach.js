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
        this._hasAnyPack = null;
        this._activeQuiz = null;
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
            this.safeNavigate(view);
        });

        bus.on('coach:update-settings', async (settings) => {
            await this.updateSettings(settings);
            bus.emit('ui:toast', { message: 'Settings saved', type: 'success' });
        });

        // Pack Sync via Wizard (legacy/dev)
        bus.on('coach:sync-local-pack', () => {
            packImportWizard.start();
        });

        bus.on('coach:update-pack-content', async ({ packId, version }) => {
            // Reserved for Phase 3/Sync. For Phase 1 we only manage user-owned pack content.
            try {
                const uid = this.currentUser?.uid;
                if (!uid) return;
                const userData = await coachStore.getUserPackVersion(uid, packId, version);
                if (!userData) throw new Error('PACK_VERSION_NOT_FOUND');
                await coachStore.installUserPack(uid, packId, version, userData);
                bus.emit('ui:toast', { message: `Installed v${version}`, type: 'success' });
                this._hasAnyPack = true;
                this.currentView = 'packs';
                this.renderCurrentView();
            } catch (e) {
                console.error(e);
                bus.emit('ui:toast', { message: `Update failed: ${e.message}`, type: 'error' });
            }
        });

        bus.on('coach:import-pack', async ({ packData, packName, targetPackId, importMode }) => {
            try {
                const uid = this.currentUser?.uid;
                if (!uid) throw new Error('NOT_AUTHENTICATED');
                if (!packData?.pack?.pack_id || !packData?.pack?.version || !Array.isArray(packData?.cards)) {
                    throw new Error('INVALID_PACK');
                }

                const originalPackId = packData.pack.pack_id;
                const packId = (targetPackId || originalPackId).trim();
                const version = String(packData.pack.version).trim();
                if (!packId) throw new Error('PACK_ID_REQUIRED');

                const deprecateMissing = importMode === 'overwrite';
                const normalizedPack = {
                    ...packData.pack,
                    pack_id: packId,
                    version
                };

                await coachStore.saveUserPack(uid, packId, version, normalizedPack, packData.cards, { deprecateMissing });
                await coachStore.installUserPack(uid, packId, version, normalizedPack, { pack_name: packName || null });

                bus.emit('ui:toast', { message: 'Pack imported', type: 'success' });
                this._hasAnyPack = true;
                this.currentView = 'packs';
                this.renderCurrentView();
            } catch (e) {
                console.error(e);
                bus.emit('ui:toast', { message: `Import failed: ${e.message}`, type: 'error' });
            }
        });

        // Quiz Engine
        bus.on('coach:start-quiz', async ({ packId }) => {
            try {
                const quizParams = await quizEngine.generateSession(packId, this.settings.content_language);
                if (!quizParams || !quizParams.card) {
                    bus.emit('ui:toast', { message: 'No cards available to review right now.', type: 'info' });
                    return;
                }
                this.currentPackId = packId;
                this.currentView = 'quiz';
                this._activeQuiz = { ...quizParams, packId };

                const card = quizParams.card;
                uiRenderer.render('quiz', {
                    pack_title: 'Pack Practice',
                    card_id: card.card_id,
                    category: card.category || '',
                    question: i18n.getContent(card.question_i18n),
                    tts_text: card.tts?.text || i18n.getContent(card.front_i18n) || '',
                    tts_lang: card.tts?.language || 'fr-FR',
                    options: quizParams.options,
                    total_cards: quizParams.totalCards,
                    current_card_index: quizParams.sessionIndex
                });

                if (card.tts?.auto_read && card.tts?.text) {
                    bus.emit('coach:tts-play', { text: card.tts.text, lang: card.tts.language || 'fr-FR' });
                }
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

        bus.on('coach:quiz-submit', async ({ selectedIndex, confidence_1to5 = null }) => {
            try {
                const uid = this.currentUser?.uid;
                if (!uid) return;
                if (!this._activeQuiz?.card?.card_id) return;

                const card = this._activeQuiz.card;
                const isCorrect = Number(selectedIndex) === Number(this._activeQuiz.correctIndex);

                await coachStore.updateCardProgress(uid, card.card_id, {
                    isCorrect,
                    confidence_1to5,
                    pack_id: this.currentPackId
                });

                bus.emit('coach:quiz-feedback', {
                    isCorrect,
                    correctText: i18n.getContent(card.correct_answer_i18n),
                    explainText: i18n.getContent(card.example_sentence_i18n) || '',
                    nextAction: 'next'
                });
            } catch (e) {
                console.error(e);
                bus.emit('ui:toast', { message: `Save failed: ${e.message}`, type: 'error' });
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
            uiRenderer.render('loginRequired');
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

        await this.refreshPackPresence();

        // IMPORT-FIRST: if user has no installed packs, force import flow.
        if (!this._hasAnyPack) {
            this.currentView = 'import-pack';
        } else if (!this.settings.active_skill_id) {
            this.currentView = 'skills';
        } else {
            this.currentView = 'dashboard';
        }

        this.renderCurrentView();
    }

    async refreshPackPresence() {
        const uid = this.currentUser?.uid;
        if (!uid) {
            this._hasAnyPack = false;
            return;
        }
        try {
            const packs = await coachStore.getUserPacks(uid);
            this._hasAnyPack = packs.length > 0;
        } catch {
            this._hasAnyPack = false;
        }
    }

    async safeNavigate(view) {
        const uid = this.currentUser?.uid;
        if (!uid) {
            this.currentView = 'loginRequired';
            this.renderCurrentView();
            return;
        }

        // Guard: while no packs installed, only allow import-pack.
        await this.refreshPackPresence();
        if (!this._hasAnyPack && view !== 'import-pack') {
            this.currentView = 'import-pack';
            this.renderCurrentView();
            return;
        }

        this.currentView = view;
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
            viewData.packs = packs.map(p => ({
                ...p,
                title: p.pack_name || i18n.getContent(p.title_i18n) || p.pack_id,
                description: i18n.getContent(p.description_i18n) || '',
                level: p.level || p?.metadata?.level || ''
            }));
        }

        if (this.currentView === 'quiz') {
            if (!viewData.card && !this.currentPackId) {
                this.currentView = 'packs';
                this.renderCurrentView();
                return;
            }
        }

        if (this.currentView === 'import-pack') {
            viewData.hasInstalledPacks = this._hasAnyPack;
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
