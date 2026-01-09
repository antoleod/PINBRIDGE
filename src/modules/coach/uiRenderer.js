/* src/modules/coach/uiRenderer.js */
import { i18n } from './i18n.js';
import { bus } from '../../core/bus.js';
import { packLoader } from './packLoader.js';
import { openaiPackGenerator } from './openaiPackGenerator.js';

class UiRenderer {
    constructor() {
        this.container = document.getElementById('coach-content');
        this.viewCache = new Map();
        this.currentView = null;

        bus.on('coach:quiz-feedback', (payload) => {
            if (this.currentView !== 'quiz') return;
            const panel = document.getElementById('quiz-feedback');
            if (!panel) return;

            panel.classList.remove('hidden');
            const title = document.getElementById('feedback-title');
            const text = document.getElementById('feedback-text');
            const icon = document.getElementById('feedback-icon');
            const example = document.getElementById('feedback-example');

            const isCorrect = !!payload?.isCorrect;
            if (title) title.textContent = isCorrect ? 'Correct' : 'Not quite';
            if (text) text.textContent = payload?.correctText || '';
            if (icon) icon.textContent = isCorrect ? '✓' : '✕';
            if (example) example.textContent = payload?.explainText || '';

            const nextBtn = document.getElementById('btn-next-card');
            if (nextBtn) {
                nextBtn.onclick = () => {
                    panel.classList.add('hidden');
                    bus.emit('coach:quiz-next');
                };
            }
        });
    }

    async render(view, data) {
        if (!this.container) {
            console.error("Coach content container not found!");
            return;
        }

        this.currentView = view;
        try {
            const template = await this.getViewTemplate(view);
            const html = this.compileTemplate(template, data || {});
            this.container.innerHTML = html;
            this.bindEventListeners(view, data);
            if (window.feather?.replace) window.feather.replace();
        } catch (error) {
            console.error(`Error rendering view ${view}:`, error);
            this.container.innerHTML = `<div class="glass-panel"><p>Error loading view: ${error.message}</p></div>`;
        }
    }

    async getViewTemplate(view) {
        if (this.viewCache.has(view)) return this.viewCache.get(view);
        const response = await fetch(`src/modules/coach/views/${view}.html?v=${Date.now()}`, { cache: 'no-store' });
        if (!response.ok) throw new Error(`Could not fetch template for view: ${view}`);
        const template = await response.text();
        this.viewCache.set(view, template);
        return template;
    }

    compileTemplate(template, data) {
        const uiStrings = i18n.getStringsFor(i18n.uiLang);
        let compiled = template;

        const resolvePath = (root, dotted) => {
            const keys = String(dotted || '').trim().split('.');
            let val = root;
            for (const k of keys) {
                val = val ? val[k] : undefined;
            }
            return val;
        };

        // {{#each array}}...{{/each}}
        compiled = compiled.replace(/\{\{#each (.*?)\}\}(.*?)\{\{\/each\}\}/gs, (match, arrayName, body) => {
            const arr = resolvePath(data, arrayName) ?? data[arrayName?.trim()];
            if (!Array.isArray(arr)) return '';

            return arr.map((item, index) => {
                let itemBody = body.replace(/\{\{@index\}\}/g, index);

                itemBody = itemBody.replace(/\{\{this\}\}/g, () => {
                    if (typeof item === 'object' && item !== null) return i18n.getContent(item);
                    return String(item ?? '');
                });

                return itemBody.replace(/\{\{this\.(.*?)\}\}/g, (m, prop) => {
                    const value = item?.[prop.trim()];
                    if (typeof value === 'object' && value !== null) return i18n.getContent(value);
                    return value !== undefined ? String(value) : '';
                });
            }).join('');
        });

        // Standalone {{key}}
        compiled = compiled.replace(/\{\{(.*?)\}\}/g, (match, key) => {
            const k = key.trim();
            if (k === 'else' || k.startsWith('#') || k.startsWith('/')) return match;

            const val = resolvePath(data, k);
            if (val !== undefined) {
                if (typeof val === 'object' && val !== null) return i18n.getContent(val);
                return String(val);
            }
            return uiStrings[k] || ``;
        });

        // Basic {{#if (eq var "value")}} or {{#if var}}
        compiled = compiled.replace(/\{\{#if (.*?)\}\}(.*?)\{\{(?:else\}\}(.*?)\{\{)?\/if\}\}/gs, (match, condition, bodyIf, bodyElse) => {
            const cond = String(condition || '').trim();
            let result = false;

            if (cond.includes('eq')) {
                const parsed = cond.match(/eq (.*?) "(.*?)"/);
                if (parsed) {
                    const [, varName, expected] = parsed;
                    const actual = resolvePath(data, varName);
                    result = String(actual) === expected;
                }
            } else {
                const val = resolvePath(data, cond);
                result = !!val;
            }

            return result ? bodyIf : (bodyElse || '');
        });

        return compiled;
    }

    bindEventListeners(view, data) {
        this.container.onclick = (e) => {
            try {
                const rawTarget = e?.target;
                const target = rawTarget instanceof Element ? rawTarget : rawTarget?.parentElement || null;
                const action = (target && typeof target.closest === 'function') ? target.closest('[data-action]') : null;
                if (!action) return;

                const actionName = action.dataset.action;
                if (!actionName) return;

                switch (actionName) {
                    case 'back-to-dashboard':
                        bus.emit('coach:navigate', 'dashboard');
                        break;
                    case 'back-to-roadmap':
                        bus.emit('coach:navigate', 'roadmap');
                        break;
                    case 'back-to-skills':
                        bus.emit('coach:navigate', 'skills');
                        break;
                    case 'back-to-packs':
                        bus.emit('coach:navigate', 'packs');
                        break;
                case 'view-my-skills':
                    bus.emit('coach:navigate', 'skills');
                    break;
                    case 'open-settings':
                        bus.emit('coach:navigate', 'settings');
                        break;
                    case 'open-roadmap':
                        bus.emit('coach:navigate', 'roadmap');
                        break;
                    case 'open-checklist':
                        bus.emit('coach:navigate', 'checklist');
                        break;
                    case 'open-interview':
                        bus.emit('coach:navigate', 'interview');
                        break;
                    case 'open-quizzes':
                        bus.emit('coach:navigate', 'quizzes');
                        break;
                    case 'open-export':
                        bus.emit('coach:navigate', 'export');
                        break;
                    case 'open-packs':
                        bus.emit('coach:navigate', 'packs');
                        break;
                    case 'open-import-pack':
                        bus.emit('coach:navigate', 'import-pack');
                        break;
                case 'start-exam-center':
                    bus.emit('coach:navigate', 'exam-center');
                    break;
                case 'open-error-cards':
                    bus.emit('coach:navigate', 'error-cards');
                    break;
                case 'coach-back':
                    bus.emit('coach:back');
                    break;
                // Learning Hub (dashboard)
                case 'start-pack': {
                    const packId = action.dataset.packId;
                    if (packId) bus.emit('coach:start-pack', { packId });
                    break;
                }
                case 'continue-pack':
                case 'review-pack': {
                    const packId = action.dataset.packId;
                    if (packId) bus.emit('coach:start-quiz', { packId });
                    break;
                }
                case 'start-reviews':
                    bus.emit('coach:navigate', 'error-cards');
                    break;
                case 'import-pack':
                    bus.emit('coach:navigate', 'import-pack');
                    break;
                case 'create-pack':
                    bus.emit('coach:navigate', 'create-pack');
                    break;
                case 'generate-pack':
                    bus.emit('coach:navigate', 'generate-pack');
                    break;
                case 'add-new-skill':
                    bus.emit('coach:navigate', 'add-skill');
                    break;
                case 'start-session':
                    bus.emit('coach:navigate', 'session');
                    break;
                case 'set-active-skill': {
                    const skillId = action.dataset.id;
                    bus.emit('coach:activate-skill', skillId);
                    break;
                }
                case 'start-module-exam': {
                    const moduleId = action.dataset.moduleId;
                    bus.emit('coach:start-exam', { moduleId });
                    break;
                }
                case 'apply-update': {
                    const packId = action.dataset.packId;
                    if (packId) bus.emit('coach:apply-update', { packId });
                    break;
                }
                case 'update-pack': {
                    const packId = action.dataset.packId;
                    if (packId) bus.emit('coach:apply-update', { packId });
                    break;
                }
                case 'start-quiz': {
                    const packId = action.dataset.packId;
                    if (packId) bus.emit('coach:start-quiz', { packId });
                    break;
                }
                case 'quit-quiz':
                    bus.emit('coach:navigate', 'packs');
                    break;
                case 'open-roadmap-day': {
                    const day = Number(action.dataset.day);
                    if (Number.isFinite(day)) bus.emit('coach:open-roadmap-day', { day });
                    break;
                }
                case 'cycle-roadmap-status': {
                    const day = Number(action.dataset.day);
                    if (Number.isFinite(day)) bus.emit('coach:cycle-roadmap-status', { day });
                    break;
                }
                case 'toggle-checklist-item': {
                    const itemId = action.dataset.itemId;
                    const checked = !!action.checked;
                    if (itemId) bus.emit('coach:toggle-checklist-item', { itemId, checked });
                    break;
                }
                case 'copy-export': {
                    const text = document.getElementById('coach-export-text')?.value || '';
                    const copy = async () => {
                        if (!text) return;
                        try {
                            await navigator.clipboard.writeText(text);
                            bus.emit('ui:toast', { message: i18n.t('coach_toast_copied'), type: 'success' });
                        } catch {
                            const el = document.getElementById('coach-export-text');
                            if (el) {
                                el.focus();
                                el.select();
                                document.execCommand('copy');
                                bus.emit('ui:toast', { message: i18n.t('coach_toast_copied'), type: 'success' });
                            }
                        }
                    };
                    copy();
                    break;
                }
                case 'answer-roadmap-decision': {
                    const selectedIndex = Number(action.dataset.index);
                    const correctIndex = Number(data?.decision_correct_index);
                    const isCorrect = selectedIndex === correctIndex;

                    const panel = document.getElementById('roadmap-decision-feedback');
                    const icon = document.getElementById('roadmap-feedback-icon');
                    const title = document.getElementById('roadmap-feedback-title');
                    const why = document.getElementById('roadmap-feedback-why');
                    const trap = document.getElementById('roadmap-feedback-trap');

                    if (icon) icon.textContent = isCorrect ? '✓' : '✕';
                    if (title) title.textContent = isCorrect ? i18n.t('coach_feedback_correct') : i18n.t('coach_feedback_incorrect');
                    if (why) why.textContent = data?.decision_justification || '';
                    if (trap) trap.textContent = data?.decision_trap ? `${i18n.t('coach_label_trap')}: ${data.decision_trap}` : '';
                    if (panel) panel.classList.remove('hidden');

                    // Disable buttons after answer (prevents spam taps).
                    this.container.querySelectorAll('[data-action="answer-roadmap-decision"]').forEach(btn => (btn.disabled = true));

                    bus.emit('coach:roadmap-decision-answered', {
                        day: Number(data?.day),
                        selectedIndex,
                        correctIndex,
                        isCorrect
                    });
                    break;
                }
                case 'answer-quiz': {
                    const quizId = action.dataset.quizId;
                    const qIndex = Number(action.dataset.qIndex);
                    const optIndex = Number(action.dataset.optIndex);
                    if (!quizId || !Number.isFinite(qIndex) || !Number.isFinite(optIndex)) break;

                    const q = (data?.quizQuestions || []).find(x => x.quiz_id === quizId && Number(x.q_index) === qIndex);
                    if (!q) break;

                    const isCorrect = optIndex === Number(q.correct_index);
                    const feedbackEl = document.getElementById(`quiz-feedback-${quizId}-${qIndex}`);
                    const textEl = document.getElementById(`quiz-feedback-text-${quizId}-${qIndex}`);
                    if (textEl) textEl.textContent = (isCorrect ? '✓ ' : '✕ ') + (q.explain || '');
                    if (feedbackEl) feedbackEl.classList.remove('hidden');

                    // Disable question options after answer.
                    this.container
                        .querySelectorAll(`[data-action="answer-quiz"][data-quiz-id="${quizId}"][data-q-index="${qIndex}"]`)
                        .forEach(btn => (btn.disabled = true));

                    bus.emit('coach:quiz-block-answered', { quizId, qIndex, optIndex, isCorrect });
                    break;
                }
                case 'play-tts': {
                    const text = data?.tts_text || data?.question || '';
                    const lang = data?.tts_lang || 'fr-FR';
                    if (text) bus.emit('coach:tts-play', { text, lang });
                    break;
                }
                    case 'next-session':
                        bus.emit('coach:navigate', 'dashboard');
                        break;
                }
            } catch (err) {
                console.error('Coach action handler error:', err);
            }
        };

        if (view === 'add-skill') {
            const btnCreate = document.getElementById('btn-create-skill');
            if (btnCreate) {
                btnCreate.onclick = () => {
                    const topic = document.getElementById('skill-topic').value;
                    const goal = document.getElementById('skill-goal').value;
                    const intensity = document.getElementById('skill-intensity').value;
                    const language = document.getElementById('skill-language').value;
                    if (!topic || !goal) return;
                    bus.emit('coach:create-skill', { topic, goal, intensity, language });
                };
            }
        }

        if (view === 'session') {
            const options = this.container.querySelectorAll('.option-btn');
            const submitBtn = document.getElementById('btn-submit-answer');
            let selectedIndex = null;

            options.forEach(opt => {
                opt.addEventListener('click', () => {
                    options.forEach(o => o.classList.remove('active'));
                    opt.classList.add('active');
                    selectedIndex = opt.dataset.index;
                    if (submitBtn) submitBtn.disabled = false;
                });
            });

            if (submitBtn) {
                submitBtn.addEventListener('click', () => {
                    const confidence = document.getElementById('confidence-slider').value;
                    const justification = document.getElementById('thought-process').value;
                    bus.emit('coach:submit-answer', {
                        session: data.session,
                        answerIndex: selectedIndex,
                        confidence,
                        justification
                    });
                });
            }
        }

        if (view === 'settings') {
            const managePacksBtn = document.getElementById('btn-manage-packs');
            if (managePacksBtn) managePacksBtn.onclick = () => bus.emit('coach:navigate', 'packs');

            const seedBtn = document.getElementById('btn-seed-pack');
            if (seedBtn) seedBtn.onclick = () => bus.emit('coach:sync-local-pack');

            const saveBtn = document.getElementById('btn-save-settings');
            if (saveBtn) {
                saveBtn.onclick = () => {
                    const ui_language = document.getElementById('coach-ui-language').value;
                    const content_language = document.getElementById('coach-content-language').value;
                    const time_per_day_min = document.getElementById('coach-time').value;
                    const intensity = document.getElementById('coach-intensity').value;
                    const no_resources_mode = document.getElementById('coach-no-resources').checked;

                    bus.emit('coach:update-settings', {
                        ui_language,
                        content_language,
                        time_per_day_min,
                        intensity,
                        no_resources_mode
                    });
                };
            }
        }

        if (view === 'import-pack') {
            const fileInput = document.getElementById('pack-file-input');
            const fileNameDisplay = document.getElementById('file-name-display');
            const paste = document.getElementById('pack-json-paste');
            const previewBox = document.getElementById('import-preview');
            const confirmBtn = document.getElementById('btn-confirm-import');

            const bundledSelect = document.getElementById('bundled-pack-select');
            const bundledBtn = document.getElementById('btn-load-bundled');

            const nameInput = document.getElementById('import-pack-name');
            const packIdInput = document.getElementById('import-pack-id');
            const versionInput = document.getElementById('import-pack-version');

            const modeRadios = [...this.container.querySelectorAll('input[name="import-mode"]')];

            const setPreview = (parsed) => {
                if (!parsed) return;
                const pack = parsed.pack;
                const cards = parsed.cards || [];

                const idEl = document.getElementById('preview-id');
                const titleEl = document.getElementById('preview-title');
                const versionEl = document.getElementById('preview-version');
                const countEl = document.getElementById('preview-count');
                const langsEl = document.getElementById('preview-languages');
                const levelEl = document.getElementById('preview-level');
                const catsEl = document.getElementById('preview-categories');

                if (idEl) idEl.textContent = pack.pack_id || '';
                if (titleEl) titleEl.textContent = i18n.getContent(pack.title_i18n) || pack.pack_id || '';
                if (versionEl) versionEl.textContent = pack.version || '';
                if (countEl) countEl.textContent = String(cards.length);
                if (langsEl) langsEl.textContent = (pack.languages || []).join(', ');
                if (levelEl) levelEl.textContent = pack.level || '';
                if (catsEl) catsEl.textContent = Array.isArray(pack.categories) ? pack.categories.map(c => c.id).join(', ') : '';

                if (previewBox) previewBox.classList.remove('hidden');
                if (confirmBtn) confirmBtn.disabled = false;

                if (packIdInput) packIdInput.value = pack.pack_id || '';
                if (versionInput) versionInput.value = pack.version || '';
                if (nameInput && !nameInput.value) nameInput.value = i18n.getContent(pack.title_i18n) || pack.pack_id || '';
            };

            let parsedPack = null;

            const parsePaste = () => {
                try {
                    const parsed = packLoader.loadFromText(paste?.value || '');
                    parsedPack = parsed;
                    setPreview(parsed);
                } catch {
                    // ignore until valid
                }
            };

            if (fileInput) {
                fileInput.onchange = async () => {
                    const file = fileInput.files?.[0];
                    if (!file) return;
                    if (fileNameDisplay) fileNameDisplay.textContent = file.name;
                    try {
                        const parsed = await packLoader.loadFromFile(file);
                        parsedPack = parsed;
                        setPreview(parsed);
                    } catch (e) {
                        bus.emit('ui:toast', { message: `Invalid pack: ${e.message}`, type: 'error' });
                        if (confirmBtn) confirmBtn.disabled = true;
                    }
                };
            }

            if (paste) {
                let t;
                paste.addEventListener('input', () => {
                    if (t) clearTimeout(t);
                    t = setTimeout(parsePaste, 250);
                });
            }

            if (bundledSelect) {
                const packs = packLoader.getBundledPacks();
                bundledSelect.innerHTML = packs.map(p => `<option value="${p.id}">${p.title}</option>`).join('');
            }

            if (bundledBtn) {
                bundledBtn.onclick = async () => {
                    try {
                        const id = bundledSelect?.value;
                        const parsed = await packLoader.loadBundledPack(id);
                        parsedPack = parsed;
                        setPreview(parsed);
                    } catch (e) {
                        bus.emit('ui:toast', { message: `Bundled load failed: ${e.message}`, type: 'error' });
                    }
                };
            }

            if (confirmBtn) {
                confirmBtn.onclick = () => {
                    if (!parsedPack) return;

                    const importMode = modeRadios.find(r => r.checked)?.value || 'new';
                    const targetPackId = (packIdInput?.value || parsedPack.pack.pack_id || '').trim();
                    const packName = (nameInput?.value || '').trim();
                    const version = (versionInput?.value || parsedPack.pack.version || '').trim();

                    const packData = {
                        ...parsedPack,
                        pack: {
                            ...parsedPack.pack,
                            pack_id: targetPackId,
                            version
                        }
                    };

                    bus.emit('coach:import-pack', { packData, packName, targetPackId, importMode });
                };
            }
        }

        const downloadJson = (filename, data) => {
            const json = JSON.stringify(data, null, 2);
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
        };

        const ttsLangFor = (lang) => {
            const l = (String(lang || '').trim() || 'en').toLowerCase();
            if (l === 'en') return 'en-US';
            if (l === 'es') return 'es-ES';
            if (l === 'fr') return 'fr-FR';
            if (l === 'nl') return 'nl-NL';
            return 'en-US';
        };

        const sanitizePackId = (packId) => String(packId || '')
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9_\\-]+/g, '_')
            .replace(/^_+|_+$/g, '');

        const buildStubPack = ({ pack_id, version, pack_name, source_lang, target_lang, cardCount, topic }) => {
            const safePackId = sanitizePackId(pack_id);
            const safeVersion = String(version || '1.0.0').trim() || '1.0.0';
            const safeName = String(pack_name || safePackId || 'My Pack').trim() || 'My Pack';
            const count = Math.max(1, Math.min(500, Number(cardCount) || 10));
            const src = (String(source_lang || 'en').trim() || 'en').toLowerCase();
            const tgt = (String(target_lang || 'en').trim() || 'en').toLowerCase();
            const nowIso = new Date().toISOString();

            const cards = Array.from({ length: count }).map((_, idx) => {
                const n = String(idx + 1).padStart(3, '0');
                const term = topic ? `${topic} ${n}` : `Term ${n}`;
                return {
                    card_id: `${safePackId || 'pack'}_${n}`,
                    category: 'core',
                    tags: ['generated'],
                    front_i18n: { [src]: term, [tgt]: term },
                    question_i18n: { [src]: `What is "${term}"?`, [tgt]: `What is "${term}"?` },
                    correct_answer_i18n: { [src]: `Definition of ${term}`, [tgt]: `Definition of ${term}` },
                    usage_type: 'concept',
                    tts: { auto_read: false, language: ttsLangFor(tgt), text: term, rate: 1.0 },
                    difficulty_1to5: 2
                };
            });

            return {
                schema_version: 'v2-pack',
                generated_at: nowIso,
                pack: {
                    pack_id: safePackId || 'my_pack',
                    version: safeVersion,
                    level: 'Custom',
                    mode: 'CUSTOM',
                    languages: Array.from(new Set(['en', src, tgt].filter(Boolean))),
                    title_i18n: { en: safeName, [src]: safeName, [tgt]: safeName },
                    description_i18n: { en: 'User generated pack', [src]: 'User generated pack', [tgt]: 'User generated pack' },
                    categories: [{ id: 'core', title_i18n: { en: 'Core', [src]: 'Core', [tgt]: 'Core' } }],
                    card_count: cards.length
                },
                cards
            };
        };

        if (view === 'create-pack') {
            const packIdEl = document.getElementById('create-pack-id');
            const nameEl = document.getElementById('create-pack-name');
            const versionEl = document.getElementById('create-pack-version');
            const srcLangEl = document.getElementById('create-pack-source-lang');
            const tgtLangEl = document.getElementById('create-pack-target-lang');
            const countEl = document.getElementById('create-pack-count');
            const topicEl = document.getElementById('create-pack-topic');
            const downloadBtn = document.getElementById('btn-create-pack-download');
            const installBtn = document.getElementById('btn-create-pack-install');

            const getPack = () => buildStubPack({
                pack_id: packIdEl?.value,
                version: versionEl?.value,
                pack_name: nameEl?.value,
                source_lang: srcLangEl?.value,
                target_lang: tgtLangEl?.value,
                cardCount: countEl?.value,
                topic: topicEl?.value
            });

            if (downloadBtn) {
                downloadBtn.onclick = () => {
                    const pack = getPack();
                    downloadJson(`${pack.pack.pack_id || 'pack'}.json`, pack);
                };
            }

            if (installBtn) {
                installBtn.onclick = () => {
                    const packData = getPack();
                    bus.emit('coach:import-pack', {
                        packData,
                        packName: packData.pack.title_i18n?.en || packData.pack.pack_id,
                        targetPackId: packData.pack.pack_id,
                        importMode: 'new'
                    });
                };
            }
        }

        if (view === 'generate-pack') {
            const packIdEl = document.getElementById('gen-pack-id');
            const nameEl = document.getElementById('gen-pack-name');
            const versionEl = document.getElementById('gen-pack-version');
            const srcLangEl = document.getElementById('gen-pack-source-lang');
            const tgtLangEl = document.getElementById('gen-pack-target-lang');
            const topicEl = document.getElementById('gen-pack-topic');
            const termsEl = document.getElementById('gen-pack-terms');
            const downloadBtn = document.getElementById('btn-gen-pack-download');
            const installBtn = document.getElementById('btn-gen-pack-install');
            const aiBtn = document.getElementById('btn-gen-pack-ai');
            const statusEl = document.getElementById('gen-pack-status');
            const settingsDetails = document.getElementById('openai-settings');

            const buildFromTerms = () => {
                const base = buildStubPack({
                    pack_id: packIdEl?.value,
                    version: versionEl?.value,
                    pack_name: nameEl?.value,
                    source_lang: srcLangEl?.value,
                    target_lang: tgtLangEl?.value,
                    cardCount: 1,
                    topic: topicEl?.value
                });

                const src = (String(srcLangEl?.value || 'en').trim() || 'en').toLowerCase();
                const tgt = (String(tgtLangEl?.value || 'en').trim() || 'en').toLowerCase();
                const terms = String(termsEl?.value || '')
                    .split(/\r?\n/)
                    .map(s => s.trim())
                    .filter(Boolean)
                    .slice(0, 500);

                if (terms.length === 0) {
                    bus.emit('ui:toast', { message: 'Add at least 1 term (one per line).', type: 'info' });
                    return null;
                }

                base.cards = terms.map((term, idx) => {
                    const n = String(idx + 1).padStart(3, '0');
                    return {
                        card_id: `${base.pack.pack_id}_${n}`,
                        category: 'core',
                        tags: ['generated', 'terms'],
                        front_i18n: { [src]: term, [tgt]: term },
                        question_i18n: { [src]: `What does "${term}" mean?`, [tgt]: `What does "${term}" mean?` },
                        correct_answer_i18n: { [src]: term, [tgt]: term },
                        usage_type: 'vocab',
                        tts: { auto_read: false, language: ttsLangFor(tgt), text: term, rate: 1.0 },
                        difficulty_1to5: 2
                    };
                });
                base.pack.card_count = base.cards.length;
                return base;
            };

            const setStatus = (text) => {
                if (statusEl) statusEl.textContent = String(text || '');
            };

            if (downloadBtn) {
                downloadBtn.onclick = () => {
                    const pack = buildFromTerms();
                    if (!pack) return;
                    downloadJson(`${pack.pack.pack_id || 'pack'}.json`, pack);
                };
            }

            if (installBtn) {
                installBtn.onclick = () => {
                    const packData = buildFromTerms();
                    if (!packData) return;
                    bus.emit('coach:import-pack', {
                        packData,
                        packName: packData.pack.title_i18n?.en || packData.pack.pack_id,
                        targetPackId: packData.pack.pack_id,
                        importMode: 'new'
                    });
                };
            }

            if (aiBtn) {
                aiBtn.onclick = async () => {
                    const args = {
                        pack_id: packIdEl?.value,
                        pack_name: nameEl?.value,
                        version: versionEl?.value,
                        source_lang: srcLangEl?.value,
                        target_lang: tgtLangEl?.value,
                        topic: topicEl?.value || nameEl?.value || '',
                        cardCount: Number(document.getElementById('gen-pack-count')?.value || 20)
                    };

                    try {
                        aiBtn.disabled = true;
                        setStatus('Generating with OpenAI...');

                        const packData = await openaiPackGenerator.generatePackJSON(args);
                        // Validate against our pack rules.
                        packLoader.validatePack(packData);

                        setStatus(`Generated ${packData.cards?.length || 0} cards.`);

                        bus.emit('coach:import-pack', {
                            packData,
                            packName: packData.pack?.title_i18n?.en || packData.pack?.pack_id,
                            targetPackId: packData.pack?.pack_id,
                            importMode: 'new'
                        });
                    } catch (e) {
                        console.error(e);
                        setStatus('');
                        if (String(e?.message || '').includes('OPENAI_API_KEY_NOT_CONFIGURED')) {
                            if (settingsDetails && settingsDetails.tagName === 'DETAILS') settingsDetails.open = true;
                            bus.emit('ui:toast', { message: 'AI is not configured on the server yet. Set the Functions secret OPENAI_API_KEY.', type: 'error' });
                            return;
                        }
                        bus.emit('ui:toast', { message: `AI generation failed: ${e.message}`, type: 'error' });
                    } finally {
                        aiBtn.disabled = false;
                    }
                };
            }
        }

        if (view === 'quiz') {
            const options = this.container.querySelectorAll('.option-btn');
            options.forEach(opt => {
                opt.addEventListener('click', () => {
                    options.forEach(o => o.classList.remove('active'));
                    opt.classList.add('active');
                    const selectedIndex = Number(opt.dataset.index);
                    bus.emit('coach:quiz-submit', { selectedIndex });
                });
            });
        }

        if (view === 'dashboard') {
            const searchInput = document.getElementById('pack-search');
            const typeSelect = document.getElementById('pack-filter-type');
            const difficultySelect = document.getElementById('pack-filter-difficulty');
            const packsGrid = document.getElementById('packs-grid');

            const filterPacks = () => {
                const search = (searchInput?.value || '').toLowerCase();
                const type = typeSelect?.value || '';
                const difficulty = difficultySelect?.value || '';
                const cards = packsGrid?.querySelectorAll('.pack-card') || [];

                cards.forEach(card => {
                    const title = card.querySelector('.pack-title')?.textContent?.toLowerCase() || '';
                    const cardType = card.dataset.type || '';
                    const cardDifficulty = card.dataset.difficulty || '';
                    const matchesSearch = !search || title.includes(search);
                    const matchesType = !type || cardType === type;
                    const matchesDifficulty = !difficulty || cardDifficulty === difficulty;
                    card.style.display = matchesSearch && matchesType && matchesDifficulty ? '' : 'none';
                });
            };

            if (searchInput) searchInput.addEventListener('input', filterPacks);
            if (typeSelect) typeSelect.addEventListener('change', filterPacks);
            if (difficultySelect) difficultySelect.addEventListener('change', filterPacks);
        }
    }
}

export const uiRenderer = new UiRenderer();
