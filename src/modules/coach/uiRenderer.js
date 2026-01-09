/* src/modules/coach/uiRenderer.js */
import { i18n } from './i18n.js';
import { bus } from '../../core/bus.js';

function getByPath(obj, path) {
    if (!path) return undefined;
    const parts = path.split('.').map(p => p.trim()).filter(Boolean);
    let cur = obj;
    for (const part of parts) {
        if (cur == null) return undefined;
        cur = cur[part];
    }
    return cur;
}

function isTruthy(val) {
    if (Array.isArray(val)) return val.length > 0;
    return !!val;
}

class UiRenderer {
    constructor() {
        this.container = document.getElementById('coach-content');
        this.viewCache = new Map();
        this.roadmapExpanded = false;
    }

    async render(view, data) {
        if (!this.container) {
            console.error('Coach content container not found!');
            return;
        }

        try {
            const template = await this.getViewTemplate(view);
            const html = this.compileTemplate(template, data);
            this.container.innerHTML = html;
            this.bindEventListeners(view, data);
            if (window.feather?.replace) window.feather.replace();
        } catch (error) {
            console.error(`Error rendering view ${view}:`, error);
            this.container.innerHTML = `<div class="glass-panel"><p>Coach: failed to load view.</p></div>`;
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

        // {{#each path}}...{{/each}}
        compiled = compiled.replace(/\{\{#each (.*?)\}\}(.*?)\{\{\/each\}\}/gs, (_match, rawPath, body) => {
            const path = rawPath.trim();
            const array = getByPath(data, path);
            if (!Array.isArray(array) || array.length === 0) return '';
            return array.map((item, index) => {
                let itemBody = body.replace(/\{\{@index\}\}/g, String(index));
                itemBody = itemBody.replace(/\{\{this\}\}/g, () => {
                    if (typeof item === 'object' && item !== null) return i18n.getContent(item);
                    return item ?? '';
                });
                return itemBody.replace(/\{\{this\.(.*?)\}\}/g, (_m, propPath) => {
                    const value = getByPath(item, propPath.trim());
                    if (typeof value === 'object' && value !== null) return i18n.getContent(value);
                    return value ?? '';
                });
            }).join('');
        });

        // {{#if condition}}...{{else}}...{{/if}}
        compiled = compiled.replace(/\{\{#if (.*?)\}\}(.*?)\{\{else\}\}(.*?)\{\{\/if\}\}/gs, (_match, condition, bodyIf, bodyElse) => {
            const result = this.evalCondition(condition.trim(), data);
            return result ? bodyIf : bodyElse;
        });

        // {{#if condition}}...{{/if}}
        compiled = compiled.replace(/\{\{#if (.*?)\}\}(.*?)\{\{\/if\}\}/gs, (_match, condition, body) => {
            const result = this.evalCondition(condition.trim(), data);
            return result ? body : '';
        });

        // Standalone {{key}} (supports nested paths)
        compiled = compiled.replace(/\{\{(.*?)\}\}/g, (_match, keyRaw) => {
            const key = keyRaw.trim();
            const val = getByPath(data, key);
            if (val !== undefined) {
                if (typeof val === 'object' && val !== null) return i18n.getContent(val);
                return val ?? '';
            }
            return uiStrings[key] || `{{${key}}}`;
        });

        return compiled;
    }

    evalCondition(condition, data) {
        // (eq path "value")
        if (condition.startsWith('(eq ')) {
            const m = condition.match(/^\(eq\s+([^\s]+)\s+"(.*)"\)$/);
            if (!m) return false;
            const path = m[1].trim();
            const expected = m[2];
            return String(getByPath(data, path) ?? '') === expected;
        }
        // path truthy (supports nested paths like weak_domains.length)
        const val = getByPath(data, condition);
        return isTruthy(val);
    }

    bindEventListeners(view, data) {
        this.container.onclick = (e) => {
            const actionEl = e.target.closest('[data-action]');
            if (!actionEl) return;

            const action = actionEl.dataset.action;
            switch (action) {
                case 'back-to-dashboard':
                    bus.emit('coach:navigate', 'dashboard');
                    break;
                case 'open-settings':
                    bus.emit('coach:navigate', 'settings');
                    break;
                case 'view-roadmap':
                    bus.emit('coach:navigate', 'roadmap');
                    break;
                case 'open-modules':
                    bus.emit('coach:navigate', 'module');
                    break;
                case 'start-session':
                    bus.emit('coach:start-session');
                    break;
                case 'retry-assisted':
                    bus.emit('coach:retry-assisted');
                    break;
                case 'next-session': {
                    const teachBack = this.container.querySelector('#coach-teachback-text')?.value?.trim() || '';
                    bus.emit('coach:feedback-continue', { teachBack });
                    break;
                }
                case 'start-exam':
                    bus.emit('coach:start-exam', { scope: 'skill' });
                    break;
                case 'start-drill':
                    bus.emit('coach:start-drill');
                    break;
                case 'start-module-exam': {
                    const moduleId = actionEl.dataset.moduleId;
                    bus.emit('coach:start-exam', { scope: 'module', moduleId });
                    break;
                }
                case 'change-skill':
                    bus.emit('coach:change-skill');
                    break;
                case 'toggle-roadmap-sessions':
                    this.roadmapExpanded = !this.roadmapExpanded;
                    bus.emit('coach:toggle-roadmap-sessions', { expanded: this.roadmapExpanded });
                    break;
            }
        };

        if (view === 'session') {
            const options = this.container.querySelectorAll('.option-btn');
            const submitBtn = this.container.querySelector('#btn-submit-answer');
            const whyEl = this.container.querySelector('#thought-process');
            let selectedIndex = null;

            const updateSubmitState = () => {
                const whyOk = (whyEl?.value || '').trim().length > 0;
                submitBtn.disabled = selectedIndex === null || !whyOk;
            };

            options.forEach(opt => {
                opt.addEventListener('click', () => {
                    options.forEach(o => o.classList.remove('active'));
                    opt.classList.add('active');
                    selectedIndex = Number(opt.dataset.index);
                    updateSubmitState();
                });
            });

            whyEl?.addEventListener('input', updateSubmitState);

            submitBtn?.addEventListener('click', () => {
                const confidence = Number(this.container.querySelector('#confidence-slider')?.value || 3);
                const justification = (whyEl?.value || '').trim();
                if (selectedIndex === null || !justification) return;
                bus.emit('coach:submit-answer', {
                    selectedIndex,
                    confidence,
                    justification
                });
            });
        }

        if (view === 'feedback') {
            const teachBackEl = this.container.querySelector('#coach-teachback-text');
            const continueBtn = this.container.querySelector('#btn-feedback-continue');
            if (teachBackEl && continueBtn) {
                const update = () => {
                    continueBtn.disabled = teachBackEl.value.trim().length === 0;
                };
                teachBackEl.addEventListener('input', update);
                update();
            }

            const toggle = this.container.querySelector('#coach-toggle-no-resources');
            const resourcesBody = this.container.querySelector('#coach-resources-body');
            toggle?.addEventListener('change', () => {
                if (!resourcesBody) return;
                resourcesBody.style.display = toggle.checked ? 'none' : '';
            });
        }

        if (view === 'settings') {
            const uiLang = this.container.querySelector('#coach-ui-language');
            const contentLang = this.container.querySelector('#coach-content-language');
            const allowToggle = this.container.querySelector('#coach-allow-multilang');

            const emitSettings = () => {
                bus.emit('coach:update-settings', {
                    ui_language: uiLang?.value,
                    content_language: contentLang?.value,
                    allow_multilang_toggle: !!allowToggle?.checked
                });
            };

            uiLang?.addEventListener('change', emitSettings);
            contentLang?.addEventListener('change', emitSettings);
            allowToggle?.addEventListener('change', emitSettings);
        }

        if (view === 'exam') {
            const options = this.container.querySelectorAll('.option-btn');
            const submitBtn = this.container.querySelector('#btn-submit-exam-answer');
            const whyEl = this.container.querySelector('#exam-why');
            let selectedIndex = null;

            const updateSubmitState = () => {
                const whyOk = (whyEl?.value || '').trim().length > 0;
                submitBtn.disabled = selectedIndex === null || !whyOk;
            };

            options.forEach(opt => {
                opt.addEventListener('click', () => {
                    options.forEach(o => o.classList.remove('active'));
                    opt.classList.add('active');
                    selectedIndex = Number(opt.dataset.index);
                    updateSubmitState();
                });
            });

            whyEl?.addEventListener('input', updateSubmitState);

            submitBtn?.addEventListener('click', () => {
                const confidence = Number(this.container.querySelector('#exam-confidence')?.value || 3);
                const justification = (whyEl?.value || '').trim();
                if (selectedIndex === null || !justification) return;
                bus.emit('coach:submit-exam-answer', {
                    selectedIndex,
                    confidence,
                    justification
                });
            });
        }
    }
}

export const uiRenderer = new UiRenderer();
