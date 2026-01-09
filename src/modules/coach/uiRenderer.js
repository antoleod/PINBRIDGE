/* src/modules/coach/uiRenderer.js */
import { i18n } from './i18n.js';
import { bus } from '../../core/bus.js';

class UiRenderer {
    constructor() {
        this.container = document.getElementById('coach-content');
        this.viewCache = new Map();
    }

    async render(view, data) {
        if (!this.container) {
            console.error("Coach content container not found!");
            return;
        }

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
        if (this.viewCache.has(view)) {
            return this.viewCache.get(view);
        }
        const response = await fetch(`src/modules/coach/views/${view}.html`);
        if (!response.ok) {
            throw new Error(`Could not fetch template for view: ${view}`);
        }
        const template = await response.text();
        this.viewCache.set(view, template);
        return template;
    }

    compileTemplate(template, data) {
        const uiStrings = i18n.getStringsFor(i18n.uiLang);

        let compiled = template;

        // {{#each array}}...{{/each}}
        compiled = compiled.replace(/\{\{#each (.*?)\}\}(.*?)\{\{\/each\}\}/gs, (match, arrayName, body) => {
            const keys = arrayName.trim().split('.');
            let array = data;
            for (const key of keys) {
                if (array && typeof array === 'object') {
                    array = array[key];
                } else {
                    array = undefined;
                    break;
                }
            }
            if (!array && keys.length === 1) {
                array = data[arrayName.trim()];
            }

            if (!array || !Array.isArray(array)) {
                // If array matches exactly one key in data but is not an array, maybe it's missing.
                // Or maybe the user meant a simple block. For #each, we expect array.
                // Return empty if not iterable.
                return '';
            }

            return array.map((item, index) => {
                let itemBody = body.replace(/\{\{@index\}\}/g, index);

                itemBody = itemBody.replace(/\{\{this\}\}/g, (m) => {
                    if (typeof item === 'object' && item !== null) {
                        return i18n.getContent(item);
                    }
                    return item;
                });

                return itemBody.replace(/\{\{this\.(.*?)\}\}/g, (m, prop) => {
                    const value = item[prop.trim()];
                    if (typeof value === 'object' && value !== null) {
                        return i18n.getContent(value);
                    }
                    return value !== undefined ? value : '';
                });
            }).join('');
        });

        // Standalone {{key}}
        compiled = compiled.replace(/\{\{(.*?)\}\}/g, (match, key) => {
            const k = key.trim();
            if (k.startsWith('#') || k.startsWith('/')) return match;

            const keys = k.split('.');
            let val = data;
            for (const subKey of keys) {
                val = val ? val[subKey] : undefined;
            }
            if (val !== undefined) {
                if (typeof val === 'object' && val !== null) {
                    return i18n.getContent(val);
                }
                return val;
            }

            return uiStrings[k] || ``;
        });

        // Basic {{#if (eq var "value")}} or {{#if var}}
        compiled = compiled.replace(/\{\{#if (.*?)\}\}(.*?)\{\{(?:else\}\}(.*?)\{\{)?\/if\}\}/gs, (match, condition, bodyIf, bodyElse) => {
            let result = false;

            if (condition.includes('eq')) {
                const [_, varName, value] = condition.match(/eq (.*?) "(.*?)"/);
                // Hack for simple matching within current context
                let actualValue = data;

                // Try finding in settings first if it looks like a setting
                if (data.settings && data.settings[varName.split('.').pop()]) {
                    actualValue = data.settings[varName.split('.').pop()];
                } else if (data[varName]) {
                    actualValue = data[varName];
                } else if (varName.includes('.')) {
                    // Nested check
                    const keys = varName.split('.');
                    let val = data;
                    for (const subKey of keys) {
                        val = val ? val[subKey] : undefined;
                    }
                    actualValue = val;
                } else {
                    // Check 'this' if inside loop (not supported well here, but let's try data root)
                    actualValue = data[varName];
                }

                result = (String(actualValue) === value);
            } else {
                // Simple boolean check
                result = !!data[condition.trim()];
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
                case 'view-my-skills':
                    bus.emit('coach:navigate', 'skills');
                    break;
                case 'open-settings':
                    bus.emit('coach:navigate', 'settings');
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
                case 'set-active-skill':
                    const skillId = action.dataset.id;
                    bus.emit('coach:activate-skill', skillId);
                    break;
                case 'start-module-exam':
                    const moduleId = action.dataset.moduleId;
                    bus.emit('coach:start-exam', { moduleId });
                    break;
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
                    submitBtn.disabled = false;
                });
            });

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

        if (view === 'settings') {
            // Link to packs
            const managePacksBtn = document.getElementById('btn-manage-packs');
            if (managePacksBtn) managePacksBtn.onclick = () => bus.emit('coach:navigate', 'packs');

            // Seed Local Pack (Developer Tool)
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
                }
            }
        }
    }
}

export const uiRenderer = new UiRenderer();
