/* src/modules/coach/coach.js */
import { bus } from '../../core/bus.js';
import { coachStore } from './coachStore.js';
import { coachEngine } from './coachEngine.js';
import { examEngine } from './examEngine.js';
import { uiRenderer } from './uiRenderer.js';
import { i18n } from './i18n.js';
import { auth } from '../../firebase.js';

class CoachService {
    constructor() {
        this.currentUser = null;
        this.settings = null;
        this.currentView = 'dashboard';
        this.roadmapExpanded = false;

        this.sessionRuntime = null;
        this.feedbackRuntime = null;
        this.examRuntime = null;
        this.examTimerInterval = null;
    }

    async init() {
        document.getElementById('btn-coach-exit')?.addEventListener('click', () => {
            bus.emit('view:switch', 'all');
        });
        try { if (window.feather?.replace) window.feather.replace(); } catch {}

        bus.on('auth:unlock', async () => {
            this.currentUser = auth.currentUser;
            await this.loadSettings();
        });

        bus.on('view:switched', async ({ view }) => {
            if (view !== 'coach') return;
            await this.onEnterCoachView();
        });

        bus.on('coach:navigate', async (view) => {
            this.currentView = view;
            await this.renderCurrentView();
        });

        bus.on('coach:update-settings', async (newSettings) => {
            await this.updateSettings(newSettings);
        });

        bus.on('coach:change-skill', async () => {
            await this.createOrSwitchSkill();
        });

        bus.on('coach:start-session', async () => {
            await this.startSession({ mode: 'blind' });
        });

        bus.on('coach:retry-assisted', async () => {
            if (!this.sessionRuntime) return;
            await this.startSession({
                mode: 'assisted',
                baseSessionId: this.sessionRuntime.sessionId,
                excludeVariantId: this.sessionRuntime.variant_id
            });
        });

        bus.on('coach:submit-answer', async ({ selectedIndex, confidence, justification }) => {
            if (!this.currentUser || !this.settings || !this.sessionRuntime) return;
            try {
                const feedback = await coachEngine.submitSessionAnswer(this.currentUser.uid, {
                    settings: this.settings,
                    runtime: this.sessionRuntime,
                    selectedIndex,
                    confidence,
                    justification
                });
                this.feedbackRuntime = { ...feedback };
                this.currentView = 'feedback';
                await uiRenderer.render('feedback', { settings: this.settings, ...feedback });
                this._updateCoachHeader();
            } catch (e) {
                console.error('Failed to submit answer', e);
                bus.emit('coach:toast', { message: 'Coach: failed to submit answer.', type: 'danger' });
            }
        });

        bus.on('coach:feedback-continue', async ({ teachBack }) => {
            if (!this.currentUser) return;
            if (this.feedbackRuntime?.requireTeachBack) {
                const text = String(teachBack || '').trim();
                if (!text) return;
                await coachStore.createAttempt(this.currentUser.uid, {
                    attempt_type: 'teach_back',
                    skill_id: this.sessionRuntime?.skillId || null,
                    session_id: this.sessionRuntime?.sessionId || null,
                    concept_id: this.sessionRuntime?.conceptId || null,
                    teach_back: text,
                    language_used: this.settings?.content_language || 'en',
                    content_version: 1
                });
                await coachStore.upsertSession(this.currentUser.uid, {
                    id: this.sessionRuntime?.sessionId,
                    teach_back: text
                });
            }
            this.sessionRuntime = null;
            this.feedbackRuntime = null;
            this.currentView = 'dashboard';
            await this.renderCurrentView();
        });

        bus.on('coach:start-exam', async ({ scope, moduleId }) => {
            if (!this.currentUser || !this.settings) return;
            try {
                const activeSkill = await coachEngine.ensureActiveSkill(this.currentUser.uid, this.settings);
                if (!activeSkill) {
                    bus.emit('coach:toast', { message: 'Coach: create a roadmap first.', type: 'warning' });
                    return;
                }
                const runtime = await examEngine.startExam(this.currentUser.uid, this.settings, {
                    skillId: activeSkill.id,
                    scope,
                    moduleId,
                    attemptType: 'exam',
                    mode: 'exam',
                    totalQuestions: 5,
                    durationSec: 15 * 60
                });
                this.examRuntime = { ...runtime, answers: [], attemptId: runtime.attemptId };
                this.currentView = 'exam';
                await this.renderCurrentView();
            } catch (e) {
                console.error('Failed to start exam', e);
                bus.emit('coach:toast', { message: 'Coach: failed to start exam.', type: 'danger' });
            }
        });

        bus.on('coach:start-drill', async () => {
            if (!this.currentUser || !this.settings) return;
            try {
                const activeSkill = await coachEngine.ensureActiveSkill(this.currentUser.uid, this.settings);
                if (!activeSkill) {
                    bus.emit('coach:toast', { message: 'Coach: create a roadmap first.', type: 'warning' });
                    return;
                }
                const runtime = await examEngine.startExam(this.currentUser.uid, this.settings, {
                    skillId: activeSkill.id,
                    scope: 'skill',
                    attemptType: 'quiz',
                    mode: 'drill',
                    totalQuestions: 3,
                    durationSec: 5 * 60
                });
                this.examRuntime = { ...runtime, answers: [], attemptId: runtime.attemptId, mode: 'drill' };
                this.currentView = 'exam';
                await this.renderCurrentView();
            } catch (e) {
                console.error('Failed to start drill', e);
                bus.emit('coach:toast', { message: 'Coach: failed to start drill.', type: 'danger' });
            }
        });

        bus.on('coach:submit-exam-answer', async ({ selectedIndex, confidence, justification }) => {
            if (!this.currentUser || !this.settings || !this.examRuntime) return;
            try {
                await examEngine.submitAnswer(this.currentUser.uid, this.settings, this.examRuntime, {
                    selectedIndex,
                    confidence,
                    justification
                });
                if (this.examRuntime.currentIndex < this.examRuntime.totalQuestions) {
                    await this.renderCurrentView();
                    return;
                }
                const results = await examEngine.finishExam(this.currentUser.uid, this.settings, this.examRuntime);
                this.currentView = 'exam-results';
                this.examRuntime = null;
                this._clearExamTimer();
                await uiRenderer.render('exam-results', { settings: this.settings, ...results });
                this._updateCoachHeader();
            } catch (e) {
                console.error('Failed to submit exam answer', e);
                bus.emit('coach:toast', { message: 'Coach: failed to submit exam answer.', type: 'danger' });
            }
        });

        bus.on('coach:toggle-roadmap-sessions', async ({ expanded }) => {
            this.roadmapExpanded = !!expanded;
            if (this.currentView === 'roadmap') await this.renderCurrentView();
        });

        console.log('Coach Module Initialized');
    }

    async loadSettings() {
        if (!this.currentUser) return;
        this.settings = await coachStore.getSettings(this.currentUser.uid);
        i18n.setLanguages(this.settings.ui_language, this.settings.content_language);
        this._updateCoachHeader();
    }

    async onEnterCoachView() {
        if (!auth.currentUser) {
            await uiRenderer.render('login-required', {});
            return;
        }
        if (!this.settings) await this.loadSettings();
        await this.renderCurrentView();
    }

    async renderCurrentView() {
        if (!this.currentUser || !this.settings) return;
        this._clearExamTimer();

        const uid = this.currentUser.uid;
        const activeSkill = await coachEngine.ensureActiveSkill(uid, this.settings);

        if (!activeSkill && this.currentView !== 'settings') {
            this.currentView = 'dashboard';
        }

        if (this.currentView === 'dashboard') {
            const state = await coachEngine.getDashboardState(uid, this.settings);
            await uiRenderer.render('dashboard', state);
            this._updateCoachHeader();
            return;
        }

        if (this.currentView === 'settings') {
            await uiRenderer.render('settings', { settings: this.settings });
            this._updateCoachHeader();
            return;
        }

        if (this.currentView === 'roadmap') {
            if (!activeSkill) {
                await uiRenderer.render('dashboard', await coachEngine.getDashboardState(uid, this.settings));
                return;
            }
            const modules = await coachStore.listModules(uid, activeSkill.id);
            const sessions = await coachStore.listSessions(uid, activeSkill.id);
            const previewCount = this.roadmapExpanded ? sessions.length : Math.min(7, sessions.length);
            await uiRenderer.render('roadmap', {
                skillName: i18n.getContent(activeSkill.title_i18n),
                modules: modules.map(m => ({
                    title: i18n.getContent(m.title_i18n),
                    hint: i18n.getContent(m.summary_i18n)
                })),
                sessionsPreview: sessions.slice(0, previewCount).map(s => ({
                    day: s.day,
                    title: s.title_i18n ? i18n.getContent(s.title_i18n) : s.concept_id,
                    concept_id: s.concept_id
                })),
                hasMoreSessions: sessions.length > previewCount
            });
            this._updateCoachHeader();
            return;
        }

        if (this.currentView === 'module') {
            if (!activeSkill) {
                await uiRenderer.render('dashboard', await coachEngine.getDashboardState(uid, this.settings));
                return;
            }
            const modules = await coachStore.listModules(uid, activeSkill.id);
            const sessions = await coachStore.listSessions(uid, activeSkill.id);
            const doneByModule = new Map();
            for (const s of sessions) {
                if (s.status === 'completed') doneByModule.set(s.module_id, (doneByModule.get(s.module_id) || 0) + 1);
            }
            await uiRenderer.render('module', {
                modules: modules.map(m => {
                    const total = sessions.filter(s => s.module_id === m.id).length || 1;
                    const done = doneByModule.get(m.id) || 0;
                    return {
                        id: m.id,
                        title: i18n.getContent(m.title_i18n),
                        summary: i18n.getContent(m.summary_i18n),
                        progressLabel: `${done}/${total}`
                    };
                })
            });
            this._updateCoachHeader();
            return;
        }

        if (this.currentView === 'session') {
            if (!this.sessionRuntime) {
                await this.startSession({ mode: 'blind' });
                return;
            }
            const quiz = await coachStore.getQuizVariant(uid, this.sessionRuntime.quizId);
            await uiRenderer.render('session', {
                settings: this.settings,
                session: quiz,
                sessionTitle: quiz ? i18n.getContent(quiz.decision_prompt_i18n) : '',
                sessionMetaLine: `${this.sessionRuntime.conceptId} • ${this.sessionRuntime.variant_id}`,
                passLabel: this.sessionRuntime.pass === 1 ? 'Pass 1 (Blind)' : 'Pass 2 (Assisted)',
                passPillTone: this.sessionRuntime.pass === 1 ? 'success' : 'warn',
                showHint: this.sessionRuntime.pass === 2
            });
            this._updateCoachHeader();
            return;
        }

        if (this.currentView === 'exam') {
            if (!this.examRuntime) {
                this.currentView = 'dashboard';
                await this.renderCurrentView();
                return;
            }
            const q = examEngine.getCurrentQuestion(this.examRuntime);
            const remainingMs = Math.max(0, (this.examRuntime.endsAtMs || 0) - Date.now());
            const timerLabel = this._formatTimer(remainingMs);
            const isDrill = this.examRuntime.mode === 'drill';
            const title = isDrill ? i18n.t('coach_drill_title') : i18n.t('coach_action_start_exam');
            const meta = isDrill ? `${this.examRuntime.totalQuestions} questions • 5 min` : `${this.examRuntime.totalQuestions} questions • 15 min`;
            await uiRenderer.render('exam', {
                settings: this.settings,
                question: q,
                examTitle: title,
                examMetaLine: meta,
                examTimerLabel: timerLabel,
                examProgressLabel: `Q ${this.examRuntime.currentIndex + 1}/${this.examRuntime.totalQuestions}`
            });
            this._updateCoachHeader();
            this._startExamTimer();
            return;
        }
    }

    async startSession({ mode = 'blind', baseSessionId = null, excludeVariantId = null } = {}) {
        if (!this.currentUser || !this.settings) return;
        const uid = this.currentUser.uid;
        const activeSkill = await coachEngine.ensureActiveSkill(uid, this.settings);
        if (!activeSkill) {
            bus.emit('coach:toast', { message: 'Coach: create a roadmap first.', type: 'warning' });
            return;
        }
        try {
            const { runtime, viewData } = await coachEngine.startSession(uid, {
                settings: this.settings,
                skillId: activeSkill.id,
                mode,
                baseSessionId,
                excludeVariantId
            });
            this.sessionRuntime = runtime;
            this.currentView = 'session';
            await uiRenderer.render('session', { settings: this.settings, ...viewData });
            this._updateCoachHeader();
        } catch (e) {
            console.error('Failed to start session', e);
            bus.emit('coach:toast', { message: 'Coach: failed to start session.', type: 'danger' });
        }
    }

    async updateSettings(newSettings) {
        if (!this.currentUser) return;
        const uid = this.currentUser.uid;

        const merged = { ...this.settings, ...newSettings };
        merged.ui_language = merged.ui_language || 'en';
        merged.allow_multilang_toggle = merged.allow_multilang_toggle ?? true;
        merged.content_language = merged.allow_multilang_toggle
            ? (merged.content_language || merged.ui_language)
            : merged.ui_language;

        this.settings = merged;
        await coachStore.saveSettings(uid, merged);
        i18n.setLanguages(merged.ui_language, merged.content_language);

        // Re-render immediately without resetting runtime state.
        await this.renderCurrentView();
        bus.emit('coach:toast', { message: 'Coach: settings saved.', type: 'success' });
    }

    async createOrSwitchSkill() {
        if (!this.currentUser || !this.settings) return;
        const { topic, skillType } = await this._openSkillModal();
        if (!topic) return;

        const blueprint = coachEngine.generateBlueprint({ topic, skillType });
        await coachStore.writeBlueprint(this.currentUser.uid, blueprint, { setActive: true });

        this.settings = await coachStore.getSettings(this.currentUser.uid);
        i18n.setLanguages(this.settings.ui_language, this.settings.content_language);
        this.currentView = 'dashboard';
        await this.renderCurrentView();
        bus.emit('coach:toast', { message: 'Coach: roadmap created.', type: 'success' });
    }

    _openSkillModal() {
        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.className = 'modal-overlay';

            const defaultTopic = '';
            const selectId = `coach-skill-type-${Date.now()}`;
            const inputId = `coach-topic-${Date.now()}`;

            overlay.innerHTML = `
                <div class="modal-content confirmation" style="max-width: 520px;">
                    <div class="confirmation-body" style="gap: 0.85rem;">
                        <h3 class="confirmation-title">${i18n.t('coach_action_create_plan')}</h3>
                        <p class="confirmation-text">${i18n.t('coach_no_plan_hint')}</p>
                        <div class="form-group" style="width: 100%; text-align: left;">
                            <label for="${inputId}" style="font-size: 0.9rem; color: var(--text-secondary); margin-bottom: 0.5rem; display: block;">Topic</label>
                            <input type="text" id="${inputId}" class="input-field" placeholder="AWS Storage, Azure IAM, French, Habit…" value="${defaultTopic}" autofocus>
                            <div style="display:flex; gap:0.5rem; flex-wrap:wrap; margin-top:0.6rem;">
                                <button type="button" class="btn btn-secondary coach-chip" data-topic="AWS Storage">AWS Storage</button>
                                <button type="button" class="btn btn-secondary coach-chip" data-topic="Azure IAM">Azure IAM</button>
                                <button type="button" class="btn btn-secondary coach-chip" data-topic="French">French</button>
                                <button type="button" class="btn btn-secondary coach-chip" data-topic="Habit">Habit</button>
                            </div>
                        </div>
                        <div class="form-group" style="width: 100%; text-align: left;">
                            <label for="${selectId}" style="font-size: 0.9rem; color: var(--text-secondary); margin-bottom: 0.5rem; display: block;">Skill type</label>
                            <select id="${selectId}" class="input-field">
                                <option value="certification">certification</option>
                                <option value="technical" selected>technical</option>
                                <option value="language">language</option>
                                <option value="habit">habit</option>
                                <option value="cognitive">cognitive</option>
                            </select>
                        </div>
                        <div class="confirmation-actions">
                            <button class="btn btn-secondary" id="coach-modal-cancel">Cancel</button>
                            <button class="btn btn-primary" id="coach-modal-confirm">${i18n.t('coach_action_create_plan')}</button>
                        </div>
                    </div>
                </div>
            `;

            document.body.appendChild(overlay);
            const topicEl = overlay.querySelector(`#${CSS.escape(inputId)}`);
            const typeEl = overlay.querySelector(`#${CSS.escape(selectId)}`);
            const close = (result) => {
                overlay.remove();
                resolve(result || { topic: null, skillType: null });
            };

            overlay.querySelector('#coach-modal-cancel')?.addEventListener('click', () => close());
            overlay.querySelector('#coach-modal-confirm')?.addEventListener('click', () => {
                const topic = (topicEl?.value || '').trim();
                if (!topic) return;
                const inferred = coachEngine.classifySkillType(topic);
                const skillType = (typeEl?.value || inferred).trim() || inferred;
                close({ topic, skillType });
            });

            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) close();
            });

            overlay.querySelectorAll('.coach-chip')?.forEach(btn => {
                btn.addEventListener('click', () => {
                    const topic = btn.getAttribute('data-topic');
                    if (topicEl) topicEl.value = topic;
                    if (typeEl) typeEl.value = coachEngine.classifySkillType(topic);
                    topicEl?.focus();
                });
            });

            setTimeout(() => topicEl?.focus(), 25);
        });
    }

    _updateCoachHeader() {
        const titleEl = document.querySelector('.coach-header h1');
        const subtitleEl = document.querySelector('.coach-header .subtitle');
        if (titleEl) titleEl.textContent = i18n.t('coach_title');
        if (subtitleEl) subtitleEl.textContent = i18n.t('coach_subtitle');
    }

    _formatTimer(ms) {
        const total = Math.ceil(ms / 1000);
        const m = String(Math.floor(total / 60)).padStart(2, '0');
        const s = String(total % 60).padStart(2, '0');
        return `${m}:${s}`;
    }

    _startExamTimer() {
        this._clearExamTimer();
        const tick = () => {
            const el = document.getElementById('exam-timer');
            if (!el || !this.examRuntime) return;
            const remainingMs = Math.max(0, (this.examRuntime.endsAtMs || 0) - Date.now());
            el.textContent = this._formatTimer(remainingMs);
        };
        this.examTimerInterval = setInterval(tick, 1000);
        tick();
    }

    _clearExamTimer() {
        if (this.examTimerInterval) clearInterval(this.examTimerInterval);
        this.examTimerInterval = null;
    }
}

export const coachService = new CoachService();
coachService.init();
