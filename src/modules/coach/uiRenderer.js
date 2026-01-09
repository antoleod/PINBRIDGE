/* src/modules/coach/uiRenderer.js */
import { i18n } from './i18n.js';
import { bus } from '../../core/bus.js';
import { packLoader } from './packLoader.js';

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
        const response = await fetch(`src/modules/coach/views/${view}.html`);
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
            const action = e.target.closest('[data-action]');
            if (!action) return;

            const actionName = action.dataset.action;

            switch (actionName) {
                case 'back-to-dashboard':
                    bus.emit('coach:navigate', 'dashboard');
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
                case 'open-import-pack':
                    bus.emit('coach:navigate', 'import-pack');
                    break;
                case 'start-exam-center':
                    bus.emit('coach:navigate', 'exam-center');
                    break;
                case 'open-error-cards':
                    bus.emit('coach:navigate', 'error-cards');
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
                case 'start-quiz': {
                    const packId = action.dataset.packId;
                    if (packId) bus.emit('coach:start-quiz', { packId });
                    break;
                }
                case 'quit-quiz':
                    bus.emit('coach:navigate', 'packs');
                    break;
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
    }
}

export const uiRenderer = new UiRenderer();
