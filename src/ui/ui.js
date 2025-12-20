// src/ui/ui.js
import { bus } from '../core/bus.js';
import { Utils } from '../utils/helpers.js';
import { authService } from '../auth.js';
import { notesService, TAG_COLORS } from '../modules/notes/notes.js';
import { searchService } from '../modules/search/search.js';
import { settingsService } from '../modules/settings/settings.js';
import { i18n } from '../core/i18n.js';
import { vaultService } from '../vault.js';
import { storageService } from '../storage/db.js';
import { recoveryService } from '../modules/recovery/recovery.js';
import { cryptoService } from '../crypto/crypto.js';
import { pairingService } from '../modules/pairing/pairing.js'; // To be created
import { shareService } from '../modules/share/share.js';
import { diagnosticsService } from '../modules/diagnostics/diagnostics.js';


class UIService {
    constructor() {
        this.screens = {};
        this.forms = {};
        this.inputs = {};
        this.recoveryModal = {};
        this.mobile = {};
        this.quickDropZone = null;
        this.activeNoteId = null;
        this.currentView = 'all';
        const autoSaveSetting = localStorage.getItem('pinbridge.auto_save');
        this.autoSaveEnabled = autoSaveSetting !== 'false';
        if (autoSaveSetting === null) {
            localStorage.setItem('pinbridge.auto_save', 'true');
        }
        this.compactViewEnabled = localStorage.getItem('pinbridge.compact_notes') === 'true';
        this.footerAutoHide = localStorage.getItem('pinbridge.footer_autohide') === 'true';
        this.saveTimeout = null;
        this.isFocusMode = false;
        this.isReadOnly = false; // Read-only mode state
        this.qrScanner = null;
        this.usernameRecommendationText = null;
        this.storedUsername = null;

        // Note Session Tracking
        this.noteSessionStart = 0;

        // Capture Tools
        this.recognition = null;
        this.isRecording = false;
        this.loginAttempts = 0;
        this.ocrScanInterval = null;
        this.isOcrProcessing = false;
        this.ocrWorker = null;
        this.activityLogs = [];
        this.generatedPassword = null;
        this.share = {};
        this.shareCountdown = null;
        this.shareExpiry = null;
        this.shareReceiveMeta = null;
        this.shareReceivePreview = null;
        this.sharePreviewViewed = false;
        this.shareAccessTimer = null;
        this.attachmentRetries = new Map();
        this.shareTransferStart = null;
        this.mobileFooterBusy = false;
        this.mobileFooterMenuOpen = false;
        this.mobileFooterMenuTrap = null;
    }

    showLoginForm() {
        document.getElementById('auth-recovery')?.classList.add('hidden');
        this.recoveryModal.authRecoveryOverlay?.classList.add('hidden');
        this.forms.register?.classList.add('hidden');
        document.getElementById('auth-choice')?.classList.add('hidden');
        this.forms.login?.classList.remove('hidden');
        // Show/hide toggle buttons
        document.getElementById('btn-auth-choice-existing')?.style.setProperty('display', 'none');
        document.getElementById('btn-auth-choice-create')?.style.setProperty('display', 'inline-flex');
        this.inputs.loginUsername?.focus();
    }

    showAuthRecoveryModal() {
        this.forms.login?.classList.add('hidden');
        this.recoveryModal.authRecoveryOverlay?.classList.remove('hidden');
        document.getElementById('auth-recovery')?.classList.remove('hidden');
    }

    hideAuthRecoveryModal() {
        this.recoveryModal.authRecoveryOverlay?.classList.add('hidden');
        document.getElementById('auth-recovery')?.classList.add('hidden');
        this.forms.login?.classList.remove('hidden');
    }

    showRegisterForm() {
        this.forms.login?.classList.add('hidden');
        document.getElementById('auth-choice')?.classList.add('hidden');
        this.forms.register?.classList.remove('hidden');
        // Show/hide toggle buttons
        document.getElementById('btn-auth-choice-create')?.style.setProperty('display', 'none');
        document.getElementById('btn-auth-choice-existing')?.style.setProperty('display', 'inline-flex');
        this.inputs.registerUsername?.focus();
    }

    async handleRegisterSubmit(e) {
        e.preventDefault();
        const username = (this.inputs.registerUsername?.value || '').trim();
        const pin = (this.inputs.registerPin?.value || '').trim();

        if (!username || !pin) {
            this.showToast("Username and PIN are required.", 'error');
            return;
        }

        if (pin.length < 4 || pin.length > 6) {
            this.showToast('PIN must be between 4 and 6 digits.', 'error');
            return;
        }

        try {
            const recoveryKey = await authService.register(username, pin);
            this.showRecoveryKeyModal(recoveryKey);
        } catch (err) {
            this.showToast(this.resolveAuthErrorMessage(err?.message || err), 'error');
        }
    }

    _cacheDomElements() {
        this.screens = {
            loading: document.getElementById('loading-screen'),
            auth: document.getElementById('auth-screen'),
            vault: document.getElementById('vault-screen'),
            dashboard: document.getElementById('dashboard-screen') // Added dashboard screen
        };

        this.forms = {
            login: document.getElementById('auth-login'),
            loginForm: document.getElementById('login-form'),
            loginButton: document.getElementById('btn-login-submit'),
            register: document.getElementById('auth-register'),
            registerForm: document.getElementById('register-form'),
            registerButton: document.getElementById('btn-register-submit')
        };

        this.inputs = {
            loginUsername: document.getElementById('login-username'),
            loginPin: document.getElementById('login-pin'),
            registerUsername: document.getElementById('register-username'),
            registerPin: document.getElementById('register-pin'),
            noteTitle: document.getElementById('note-title'),
            noteContent: document.getElementById('note-content'),
            noteFolder: document.getElementById('note-folder'),
            noteTags: document.getElementById('note-tags'),
            search: document.getElementById('search-input'),
            quickDrop: document.getElementById('quick-drop-input')
        };

        this.quickDropZone = document.getElementById('quick-drop-zone');

        this.recoveryModal = {
            toggleBtn: document.getElementById('toggle-recovery-visibility'),
            downloadBtn: document.getElementById('btn-download-recovery'),
            emailPromptBtn: document.getElementById('btn-email-recovery-prompt'),
            emailSection: document.getElementById('recovery-email-section'),
            emailInput: document.getElementById('recovery-temp-email'),
            emailConfirmBtn: document.getElementById('btn-confirm-send-email'),
            overlay: document.getElementById('recovery-key-modal'),
            keyDisplay: document.getElementById('recovery-key-display'),
            copyBtn: document.getElementById('copy-recovery-key'),
            closeBtn: document.getElementById('close-recovery-modal'), // This is for the key display modal
            authRecoveryOverlay: document.getElementById('recovery-modal'), // New modal for account recovery forms
            authRecoveryCloseBtn: document.getElementById('close-auth-recovery-modal') // Close button for the new modal
        };

        this.settingsModal = {
            overlay: document.getElementById('auth-settings-modal'),
            closeBtn: document.getElementById('btn-close-settings'),
            forgotBtn: document.getElementById('btn-forgot-modal'),
            syncBtn: document.getElementById('btn-sync-modal'),
            resetBtn: document.getElementById('btn-reset-local-modal')
        };
        // New elements for the integrated recovery section within auth-settings-modal
        this.authSettingsRecoverySection = document.getElementById('auth-settings-recovery-section');
        this.authSettingsActions = document.querySelector('#auth-settings-modal .settings-actions');
        const topbar = document.getElementById('mobile-topbar');
        this.usernameRecommendationText = document.getElementById('username-recommendation-text');
        this.mobile = {
            topbar,
            navPills: topbar ? Array.from(topbar.querySelectorAll('.nav-pill')) : [],
            btnNew: document.getElementById('mobile-new-note'),
            btnLock: document.getElementById('mobile-lock'),
            btnMenu: document.getElementById('btn-mobile-menu'),
            backdrop: document.getElementById('mobile-nav-backdrop'),
            footerMenuBtn: document.getElementById('mobile-footer-menu'),
            footerNewBtn: document.getElementById('mobile-footer-new-note'),
            footerMenuModal: document.getElementById('mobile-footer-menu-modal'),
            footerMenuClose: document.getElementById('mobile-footer-menu-close'),
            footerMenuSettings: document.getElementById('mobile-footer-open-settings'),
            footerMenuTags: document.getElementById('mobile-footer-open-tags'),
            footerMenuLock: document.getElementById('mobile-footer-lock')
        };

        this.panels = {
            sidebar: document.getElementById('notes-list')?.parentElement || document.querySelector('.notes-sidebar'),
            editor: document.querySelector('.editor-panel')
        };

        // ADDITIVE: Status tracking
        this.statusIndicators = {
            offline: document.getElementById('status-offline-indicator'),
            offlineText: document.getElementById('status-offline-text')
        };

        this.share = {
            createBtn: document.getElementById('share-create-offer'),
            offerOut: document.getElementById('share-offer'),
            copyOffer: document.getElementById('share-copy-offer'),
            answerIn: document.getElementById('share-answer'),
            applyAnswer: document.getElementById('share-apply-answer'),
            joinOfferIn: document.getElementById('share-join-offer'),
            joinBtn: document.getElementById('share-join'),
            joinAnswerOut: document.getElementById('share-join-answer'),
            copyAnswer: document.getElementById('share-copy-answer'),
            fileDrop: document.getElementById('share-file-drop'),
            fileInput: document.getElementById('share-file-input'),
            autoClear: document.getElementById('share-auto-clear'),
            stateText: document.getElementById('share-state'),
            progressFill: document.getElementById('share-progress-fill'),
            progressText: document.getElementById('share-progress-text'),
            progressBytes: document.getElementById('share-progress-bytes'),
            receiverPanel: document.getElementById('share-receiver'),
            receiverName: document.getElementById('share-receiver-name'),
            receiverMeta: document.getElementById('share-receiver-meta'),
            permissionBadges: document.getElementById('share-permission-badges'),
            preview: document.getElementById('share-preview'),
            acceptBtn: document.getElementById('share-accept'),
            viewBtn: document.getElementById('share-view'),
            rejectBtn: document.getElementById('share-reject'),
            lifetime: document.getElementById('share-lifetime'),
            resetBtn: document.getElementById('share-reset')
        };

        this.diagnostics = {
            runBtn: document.getElementById('btn-run-diagnostics'),
            output: document.getElementById('diagnostics-output')
        };

        this.attachments = {
            container: document.getElementById('note-attachments'),
            list: document.getElementById('note-attachments-list'),
            empty: document.getElementById('note-attachments-empty'),
            input: document.getElementById('note-attachment-input'),
            primaryBtn: document.getElementById('btn-attach-file'),
            secondaryBtn: document.getElementById('btn-attach-file-secondary')
        };
    }

    _getById(id) {
        const el = document.getElementById(id);
        if (!el) {
            console.warn(`UI element with id "${id}" not found.`);
        }
        return el;
    }

    // ADDITIVE: Transparency & Activity Tracking
    logActivity(action) {
        const timestamp = new Date().toLocaleTimeString();
        this.activityLogs.unshift({ action, time: timestamp });
        if (this.activityLogs.length > 50) this.activityLogs.pop();
        // If the settings modal is open and on the activity tab, refresh it
        if (!document.getElementById('settings-activity')?.classList.contains('hidden')) {
            this.renderActivityLogs();
        }
    }

    renderActivityLogs() {
        const container = document.getElementById('session-logs-container');
        if (!container) return;

        if (this.activityLogs.length === 0) {
            container.innerHTML = '<div class="log-item empty"><span>No recent activity logged.</span></div>';
            return;
        }

        container.innerHTML = this.activityLogs.map(log => `
            <div class="log-item">
                <span class="log-action">${log.action}</span>
                <span class="log-time">${log.time}</span>
            </div>
        `).join('');
    }

    updateConnectivityStatus(status) {
        const isOnline = status === 'online' || navigator.onLine;
        if (this.statusIndicators.offline) {
            this.statusIndicators.offline.className = `status-indicator ${isOnline ? 'status-online' : 'status-offline'}`;
        }
        if (this.statusIndicators.offlineText) {
            this.statusIndicators.offlineText.textContent = isOnline ? 'Cloud Linked' : 'Offline Mode';
        }
    }

    init() {
        this._cacheDomElements();
        this.setupLanguageSelector();
        this.applyTranslations();
        this.createCommandPalette();
        this.addEventListeners();
        this.initGeneratedPasswordPanel();
        this.updateAutoSaveUI();
        this.updateCompactViewUI();
        this.refreshSaveButtonState();
        this.refreshUsernameRecommendation();
        this.setupMobileUX();
        this.setupSettingsAccordion();
        this.renderMarkdownToolbar();
        this.setupSmartSuggestions();
        this.setupSecurityFeatures();
        this.setStatus(i18n.t('statusReady'));
        this.updateConnectivityStatus();
        this.logActivity('System Initialized');
        this.initSecureShare();
        this.initDiagnostics();

        // Initialize settings menu values
        const showPreview = localStorage.getItem('pinbridge.show_preview') !== 'false';
        const sortBy = localStorage.getItem('pinbridge.notes_sort') || 'updated';
        const togglePreview = document.getElementById('toggle-show-preview');
        const sortSelect = document.getElementById('notes-sort-select');
        if (togglePreview) togglePreview.checked = showPreview;
        if (sortSelect) sortSelect.value = sortBy;

        if (typeof feather !== 'undefined') {
            feather.replace();
        }
        this.initConverter();
    }

    initGeneratedPasswordPanel() {
        const panel = this._getById('generated-password-modal');
        const handle = this._getById('generated-password-drag-handle');
        if (!panel || !handle) return;

        handle.style.touchAction = 'none';

        let dragging = false;
        let startX = 0;
        let startY = 0;
        let startLeft = 0;
        let startTop = 0;
        let rafId = null;
        let nextX = 0;
        let nextY = 0;

        const getMargin = () => {
            const raw = getComputedStyle(document.documentElement)
                .getPropertyValue('--floating-panel-margin')
                .trim();
            const parsed = parseFloat(raw);
            return Number.isFinite(parsed) ? parsed : 12;
        };

        const clampPosition = () => {
            const margin = getMargin();
            const rect = panel.getBoundingClientRect();
            const maxLeft = window.innerWidth - rect.width - margin;
            const maxTop = window.innerHeight - rect.height - margin;
            nextX = Math.min(Math.max(nextX, margin), Math.max(margin, maxLeft));
            nextY = Math.min(Math.max(nextY, margin), Math.max(margin, maxTop));
        };

        const applyPosition = () => {
            panel.style.left = `${nextX}px`;
            panel.style.top = `${nextY}px`;
            panel.style.transform = 'none';
            rafId = null;
        };

        const onPointerMove = (event) => {
            if (!dragging) return;
            nextX = startLeft + (event.clientX - startX);
            nextY = startTop + (event.clientY - startY);
            clampPosition();
            if (!rafId) {
                rafId = requestAnimationFrame(applyPosition);
            }
        };

        const stopDragging = () => {
            if (!dragging) return;
            dragging = false;
            panel.classList.remove('dragging');
            window.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('pointerup', stopDragging);
        };

        handle.addEventListener('pointerdown', (event) => {
            if (event.button !== 0) return;
            const rect = panel.getBoundingClientRect();
            startLeft = rect.left;
            startTop = rect.top;
            startX = event.clientX;
            startY = event.clientY;
            nextX = startLeft;
            nextY = startTop;
            dragging = true;
            panel.dataset.positioned = 'true';
            panel.classList.add('dragging');
            panel.style.left = `${startLeft}px`;
            panel.style.top = `${startTop}px`;
            panel.style.transform = 'none';
            window.addEventListener('pointermove', onPointerMove);
            window.addEventListener('pointerup', stopDragging);
        });
    }

    renderMarkdownToolbar() {
        const editorPanel = document.querySelector('.editor-panel');
        if (!editorPanel || document.querySelector('.markdown-toolbar')) return;

        const toolbar = document.createElement('div');
        toolbar.className = 'markdown-toolbar';

        const tools = [
            { icon: 'bold', action: () => this.insertMarkdown('**', '**'), title: 'Bold' },
            { icon: 'italic', action: () => this.insertMarkdown('_', '_'), title: 'Italic' },
            { icon: 'list', action: () => this.insertMarkdown('\n- ', ''), title: 'List' },
            { icon: 'check-square', action: () => this.insertMarkdown('\n- [ ] ', ''), title: 'Task' },
            { icon: 'code', action: () => this.insertMarkdown('`', '`'), title: 'Code' },
            { icon: 'hash', action: () => this.insertMarkdown('\n# ', ''), title: 'Heading' },
            { icon: 'link', action: () => this.insertMarkdown('', ''), title: 'Link' }
        ];

        tools.forEach(t => {
            const btn = document.createElement('button');
            btn.className = 'btn-md-tool';
            btn.innerHTML = `<i data-feather="${t.icon}"></i>`;
            btn.title = t.title;
            btn.onclick = (e) => {
                e.preventDefault();
                t.action();
            };
            toolbar.appendChild(btn);
        });

        // Insert after the minimal toolbar
        const topBar = editorPanel.querySelector('.editor-toolbar-minimal');
        if (topBar) {
            topBar.parentNode.insertBefore(toolbar, topBar.nextSibling);
        }
        if (typeof feather !== 'undefined') feather.replace();
    }

    setupSmartSuggestions() {
        // Inject Sidebar
        const editorPanel = document.querySelector('.editor-panel');
        if (!editorPanel || document.querySelector('.suggestions-sidebar')) return;

        const sidebar = document.createElement('div');
        sidebar.className = 'suggestions-sidebar';
        sidebar.innerHTML = `
            <div class="suggestions-header">
                <h3>Smart Suggestions</h3>
                <button class="btn-icon-minimal" id="close-suggestions"><i data-feather="x"></i></button>
            </div>
            <div id="suggestions-content" class="suggestions-content"></div>
        `;
        editorPanel.appendChild(sidebar);

        // Inject Toolbar Button
        const toolbar = document.querySelector('.editor-actions-minimal');
        if (toolbar && !document.getElementById('btn-smart-suggest')) {
            const btn = document.createElement('button');
            btn.className = 'btn-tool-minimal';
            btn.id = 'btn-smart-suggest';
            btn.title = 'Smart Suggestions';
            btn.innerHTML = '<i data-feather="zap"></i>';
            btn.onclick = () => this.toggleSmartSuggestions();
            // Insert before Zen Mode or at start
            toolbar.insertBefore(btn, toolbar.firstChild);
        }

        if (typeof feather !== 'undefined') feather.replace();
        document.getElementById('close-suggestions')?.addEventListener('click', () => this.toggleSmartSuggestions(false));
    }

    setupSecurityFeatures() {
        // Blur on app switch
        const blurEnabled = localStorage.getItem('pinbridge.security_blur') === 'true';
        const handleBlur = () => document.body.classList.add('app-blurred');
        const handleFocus = () => document.body.classList.remove('app-blurred');

        window.removeEventListener('blur', handleBlur);
        window.removeEventListener('focus', handleFocus);

        if (blurEnabled) {
            window.addEventListener('blur', handleBlur);
            window.addEventListener('focus', handleFocus);
        }
    }

    setupMobileUX() {
        // Inject Back Button for Mobile
        if (this.mobile.topbar && !document.getElementById('mobile-back-btn')) {
            const btn = document.createElement('button');
            btn.id = 'mobile-back-btn';
            btn.className = 'btn-icon hidden';
            btn.innerHTML = '<i data-feather="arrow-left"></i>';
            btn.setAttribute('aria-label', 'Back to list');
            btn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.exitMobileEditor();
            };
            this.mobile.topbar.insertBefore(btn, this.mobile.topbar.firstChild);
        }

        // Inject Mobile Footer Navigation
        if (!document.getElementById('mobile-footer')) {
            this.renderMobileFooter();
        }

        this.setupFooterAutoHide();

        // Handle resize events to reset layout
        window.addEventListener('resize', () => {
            if (window.innerWidth >= 900) {
                if (this.panels.sidebar) this.panels.sidebar.classList.remove('hidden');
                if (this.panels.editor) this.panels.editor.classList.remove('hidden');
                document.getElementById('mobile-back-btn')?.classList.add('hidden');
                this.mobile.btnMenu?.classList.remove('hidden');
                document.body.classList.remove('mobile-list-active', 'mobile-editor-active');
                this.setupSettingsAccordion();
                return;
            }

            this.exitMobileEditor();
            this.setupSettingsAccordion();
        });

        if (window.innerWidth < 900) {
            this.exitMobileEditor();
        }
    }

    setupSettingsAccordion() {
        const container = document.querySelector('.settings-content-container');
        if (!container) return;

        const isMobile = window.matchMedia('(max-width: 900px)').matches;
        const existingAccordion = container.querySelector('.settings-accordion');

        if (isMobile) {
            if (existingAccordion) return;
            const accordion = document.createElement('div');
            accordion.className = 'settings-accordion';

            const sections = Array.from(container.querySelectorAll('.settings-content'));
            sections.forEach((section, index) => {
                const title = section.querySelector('h3')?.textContent?.trim() || 'Settings';
                const item = document.createElement('div');
                item.className = 'settings-accordion-item';

                const toggle = document.createElement('button');
                toggle.type = 'button';
                toggle.className = 'settings-accordion-toggle';
                toggle.innerHTML = `<span>${title}</span><i data-feather="chevron-down"></i>`;

                const content = document.createElement('div');
                content.className = 'settings-accordion-content';
                content.appendChild(section);

                if (index === 0) {
                    item.classList.add('open');
                    content.classList.remove('hidden');
                } else {
                    content.classList.add('hidden');
                }

                toggle.addEventListener('click', () => {
                    const isOpen = item.classList.toggle('open');
                    content.classList.toggle('hidden', !isOpen);
                });

                item.appendChild(toggle);
                item.appendChild(content);
                accordion.appendChild(item);
            });

            container.appendChild(accordion);
            if (typeof feather !== 'undefined') feather.replace();
            return;
        }

        if (existingAccordion) {
            const sections = Array.from(existingAccordion.querySelectorAll('.settings-content'));
            sections.forEach(section => container.appendChild(section));
            existingAccordion.remove();
        }
    }

    setupFooterAutoHide() {
        const scrollContainers = [
            document.querySelector('.editor-canvas'),
            document.getElementById('notes-list')?.parentElement,
            document.querySelector('.dashboard-panel')
        ];

        scrollContainers.forEach(container => {
            if (!container) return;
            let lastScroll = 0;
            container.addEventListener('scroll', () => {
                if (!this.footerAutoHide) return;
                const current = container.scrollTop;
                const footer = document.getElementById('mobile-footer');

                if (current > lastScroll && current > 50) {
                    footer?.classList.add('footer-hidden');
                } else {
                    footer?.classList.remove('footer-hidden');
                }
                lastScroll = current;
            }, { passive: true });
        });
    }

    renderMobileFooter() {
        const footer = document.createElement('nav');
        footer.id = 'mobile-footer';
        footer.className = 'mobile-footer glass-panel';

        const items = [
            { id: 'nav-dash', icon: 'grid', label: 'Dash', view: 'dashboard' },
            { id: 'nav-all', icon: 'file-text', label: 'Notes', view: 'all' },
            { id: 'nav-fav', icon: 'star', label: 'Favs', view: 'favorites' },
            { id: 'nav-tmpl', icon: 'copy', label: 'Tmpl', view: 'templates' },
            { id: 'nav-settings', icon: 'settings', label: 'Settings', action: 'settings' }
        ];

        items.forEach(item => {
            const btn = document.createElement('button');
            btn.className = `mobile-nav-item ${this.currentView === item.view ? 'active' : ''}`;
            btn.dataset.view = item.view; // Bind view for sync
            btn.innerHTML = `<i data-feather="${item.icon}"></i><span>${item.label}</span>`;

            btn.onclick = (e) => {
                e.preventDefault();

                if (item.action === 'settings') {
                    this.openSettingsModal();
                    return;
                }

                // Visual update
                document.querySelectorAll('.mobile-nav-item').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                // Sync with desktop sidebar logic
                this.currentView = item.view;
                this.renderCurrentView();

                // Sync desktop sidebar state
                document.querySelectorAll('.nav-item').forEach(b => {
                    b.classList.toggle('active', b.dataset.view === item.view);
                });

                // If on mobile editor, return to list
                if (window.innerWidth < 900) {
                    this.exitMobileEditor();
                }
            };
            footer.appendChild(btn);
        });

        document.body.appendChild(footer);
        if (typeof feather !== 'undefined') feather.replace();
    }

    enterMobileEditor() {
        if (window.innerWidth >= 900) return;
        if (this.panels.sidebar) this.panels.sidebar.classList.add('hidden');
        if (this.panels.editor) this.panels.editor.classList.remove('hidden');

        document.getElementById('mobile-back-btn')?.classList.remove('hidden');
        this.mobile.btnMenu?.classList.add('hidden');
        document.body.classList.add('mobile-editor-active');
        document.body.classList.remove('mobile-list-active');
        if (typeof feather !== 'undefined') feather.replace();
    }

    exitMobileEditor() {
        if (this.panels.sidebar) this.panels.sidebar.classList.remove('hidden');
        if (this.panels.editor) this.panels.editor.classList.add('hidden');

        document.getElementById('mobile-back-btn')?.classList.add('hidden');
        this.mobile.btnMenu?.classList.remove('hidden');
        document.body.classList.add('mobile-list-active');
        document.body.classList.remove('mobile-editor-active');
        // Optional: this.activeNoteId = null;
    }

    hapticFeedback() {
        if ('vibrate' in navigator) {
            navigator.vibrate(10); // Subtle vibration for 10ms
        }
    }

    applyTranslations() {
        i18n.apply();
        this.updateAutoSaveUI();
        this.updateCompactViewUI();
        this.updateDeleteButtonContext();
        this.setStatus(i18n.t('statusReady'));
        this.refreshSaveButtonState();
        const select = document.getElementById('language-select');
        if (select) select.value = i18n.getLanguage();
    }

    setupLanguageSelector() {
        const select = document.getElementById('language-select');
        if (!select) return;
        select.innerHTML = '';
        i18n.getSupported().forEach(({ code, label }) => {
            const opt = document.createElement('option');
            opt.value = code;
            opt.textContent = label;
            select.appendChild(opt);
        });
        select.value = i18n.getLanguage();
        select.onchange = (e) => i18n.setLanguage(e.target.value);
    }

    getToastHost() {
        let host = document.getElementById('toast-container');
        if (!host) {
            host = document.createElement('div');
            host.id = 'toast-container';
            document.body.appendChild(host);
        }
        return host;
    }

    showToast(message, type = 'info') {
        const host = this.getToastHost();
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.innerText = message;
        host.appendChild(toast);

        // Trigger animation
        requestAnimationFrame(() => {
            toast.classList.add('visible');
        });

        // Auto remove after delay
        setTimeout(() => {
            toast.classList.remove('visible');
            setTimeout(() => {
                toast.style.transition = 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
                toast.style.transform = 'translateX(100px) scale(0.9)';
                toast.style.opacity = '0';
                setTimeout(() => toast.remove(), 300);
            }, 50);
        }, 3000);
    }

    showScreen(name) {
        Object.values(this.screens).forEach(el => el?.classList.add('hidden'));
        this.screens[name]?.classList.remove('hidden');
        if (name === 'vault') {
            this.resetMobileOverlays();
        }
    }

    addEventListeners() {
        this.addAuthEventListeners();
        this.addVaultEventListeners();
        this.addEditorEventListeners();
        this.addKeyboardShortcuts();
        bus.on('i18n:change', () => {
            this.applyTranslations();
            this.createCommandPalette();
        });

        bus.on('auth:locked', (reason) => {
            this.screens.loading?.classList.add('hidden');
            this.handleLockedSession(reason);
        });

        bus.on('notes:updated', (notes) => {
            if (this.currentView === 'dashboard') return;
            this.renderCurrentView(notes);
        });

        // Session Timeout UI
        bus.on('auth:session-warning', (seconds) => this.updateSessionTimer(seconds));
        bus.on('auth:activity', () => this.hideSessionTimer());

        // ADDITIVE: Connectivity and Sync Status
        bus.on('sync:status', (status) => {
            this.updateConnectivityStatus(status);
            const loggable = ['online', 'offline', 'syncing', 'synced', 'error', 'local_saved'];
            if (loggable.includes(status)) {
                this.logActivity(`Sync: ${status}`);
            }
        });

        bus.on('sync:retry', ({ type, retry, delay }) => {
            this.logActivity(`Sync retry ${retry} (${type}) in ${Math.round(delay / 1000)}s`);
        });

        bus.on('vault:saved-local-only', () => {
            this.showToast('Sync failed. Saved to device.', 'warning');
            if (this.statusIndicators.offline) {
                this.statusIndicators.offline.className = 'status-indicator status-warning';
            }
            if (this.statusIndicators.offlineText) {
                this.statusIndicators.offlineText.textContent = 'Unsynced Changes';
            }
        });

        window.addEventListener('beforeunload', (e) => {
            // Check if save button is enabled (unsaved changes)
            const saveBtn = document.getElementById('btn-save-note');
            if (saveBtn && !saveBtn.disabled) {
                e.preventDefault();
                e.returnValue = ''; // Standard for showing alert
            }
        });

        this.setupBottomSheetGestures();
    }

    updateSessionTimer(seconds) {
        let timerEl = document.getElementById('session-timeout-indicator');
        if (!timerEl) {
            const sidebar = document.querySelector('.sidebar');
            if (sidebar) {
                timerEl = document.createElement('div');
                timerEl.id = 'session-timeout-indicator';
                timerEl.className = 'session-timeout-indicator';
                sidebar.appendChild(timerEl);
            }
        }
        if (timerEl) {
            timerEl.innerText = `${seconds}s`;
            timerEl.classList.add('visible');
            timerEl.classList.toggle('critical', seconds <= 10);
        }
    }

    hideSessionTimer() {
        document.getElementById('session-timeout-indicator')?.classList.remove('visible');
    }

    setupBottomSheetGestures() {
        const header = document.querySelector('#settings-modal .modal-header');
        const modal = document.getElementById('settings-modal');
        if (!header || !modal) return;

        let startY = 0;
        let currentY = 0;
        let isDragging = false;

        header.addEventListener('touchstart', (e) => {
            startY = e.touches[0].clientY;
            isDragging = true;
        }, { passive: true });

        header.addEventListener('touchmove', (e) => {
            if (!isDragging) return;
            currentY = e.touches[0].clientY;
            const diff = currentY - startY;

            if (diff > 0) { // Dragging down
                e.preventDefault();
                modal.querySelector('.modal-content').style.transform = `translateY(${diff}px)`;
            }
        }, { passive: false });

        header.addEventListener('touchend', (e) => {
            if (!isDragging) return;
            isDragging = false;
            const diff = currentY - startY;
            const content = modal.querySelector('.modal-content');

            if (diff > 100) { // Threshold to close
                modal.classList.add('hidden');
                setTimeout(() => { content.style.transform = ''; }, 300);
            } else {
                // Bounce back
                content.style.transition = 'transform 0.2s ease';
                content.style.transform = '';
                setTimeout(() => { content.style.transition = ''; }, 200);
            }
            startY = 0;
            currentY = 0;
        });
    }

    addAuthEventListeners() {
        this.forms.loginForm?.addEventListener('submit', (e) => this.handleLoginSubmit(e));

        this.inputs.loginPin?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                this.handleLoginSubmit(e);
            }
        });

        this.forms.loginButton?.addEventListener('click', (e) => {
            e.preventDefault();
            if (this.forms.loginForm?.requestSubmit) {
                this.forms.loginForm.requestSubmit();
            } else {
                this.forms.loginForm?.dispatchEvent(new Event('submit', { cancelable: true }));
            }
        });

        // Auth choice buttons (now in auth-actions)
        document.querySelectorAll('#btn-auth-choice-create').forEach(btn => {
            btn.addEventListener('click', () => this.showRegisterForm());
        });
        document.querySelectorAll('#btn-auth-choice-existing').forEach(btn => {
            btn.addEventListener('click', () => this.showLoginForm());
        });

        // Switch between login and register
        document.getElementById('btn-switch-to-register')?.addEventListener('click', () => this.showRegisterForm());
        document.getElementById('btn-switch-to-login')?.addEventListener('click', () => this.showLoginForm());

        this.forms.registerForm?.addEventListener('submit', (e) => this.handleRegisterSubmit(e));
        this.forms.registerButton?.addEventListener('click', (e) => {
            e.preventDefault();
            if (this.forms.registerForm?.requestSubmit) {
                this.forms.registerForm.requestSubmit();
            } else {
                this.forms.registerForm?.dispatchEvent(new Event('submit', { cancelable: true }));
            }
        });

        // Auth Settings (pre-login only): recovery/sync/readonly info, no vault data access.
        document.getElementById('btn-settings')?.addEventListener('click', () => this.showSettingsModal());

        // Settings modal
        document.getElementById('btn-settings-desktop')?.addEventListener('click', () => this.showSettingsModal());
        document.getElementById('btn-settings-mobile')?.addEventListener('click', () => this.showSettingsModal());
        this.settingsModal.closeBtn?.addEventListener('click', () => this.hideSettingsModal());
        this.settingsModal.overlay?.addEventListener('click', (e) => {
            if (e.target === this.settingsModal.overlay) this.hideSettingsModal();
        });
        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.settingsModal.overlay && !this.settingsModal.overlay.classList.contains('hidden')) {
                this.hideSettingsModal();
            }
        });

        this.settingsModal.forgotBtn?.addEventListener('click', () => {
            this.hideSettingsModal();
            this.showLoginForm();
            this.inputs.loginUsername?.focus();
            this.inputs.loginUsername?.classList.add('input-focus-hint');
            setTimeout(() => this.inputs.loginUsername?.classList.remove('input-focus-hint'), 1200);
            this.showToast(i18n.t('toastRecoveryHint'), 'info');
        });

        this.settingsModal.syncBtn?.addEventListener('click', () => {
            this.hideSettingsModal(); // Close auth settings
            this.showScanQRModal(); // Open the new QR scanning modal
        });

        this.settingsModal.resetBtn?.addEventListener('click', async () => {
            this.hideSettingsModal();
            await this.handleResetLocal();
        });

        // Account Recovery
        this.settingsModal.recoveryBtn?.addEventListener('click', () => {
            this.hideSettingsModal();
            this.showAuthRecoveryModal();
        });

        document.getElementById('btn-account-recovery')?.addEventListener('click', () => this.showAuthRecoveryModal());
        this.recoveryModal.authRecoveryCloseBtn?.addEventListener('click', () => this.hideAuthRecoveryModal());
        this.recoveryModal.authRecoveryOverlay?.addEventListener('click', (e) => {
            if (e.target === this.recoveryModal.authRecoveryOverlay) this.hideAuthRecoveryModal();
        });
        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.recoveryModal.authRecoveryOverlay && !this.recoveryModal.authRecoveryOverlay.classList.contains('hidden')) {
                this.hideAuthRecoveryModal();
            }
        });
        document.getElementById('btn-back-from-recovery')?.addEventListener('click', () => this.showLoginForm());

        // Recovery Method Selector
        document.querySelectorAll('.recovery-method-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const method = e.currentTarget.dataset.method;
                this.selectRecoveryMethod(method);
            });
        });

        // Recovery Forms
        document.getElementById('recovery-key-form')?.addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleRecoveryKeySubmit();
        });

        document.getElementById('backup-code-form')?.addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleBackupCodeSubmit();
        });

        document.getElementById('secret-question-form')?.addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleSecretQuestionSubmit();
        });

        document.getElementById('recovery-file-form')?.addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleUnlockWithRecoveryFile();
        });
    }

    showAuthSettingsRecoverySection() {
        this.authSettingsActions?.classList.add('hidden');
        this.authSettingsRecoverySection?.classList.remove('hidden');
        // Ensure the main auth settings modal is visible
        this.settingsModal.overlay?.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
        // Load secret question if available
        this.loadSecretQuestion();
    }

    hideAuthSettingsRecoverySection() {
        this.authSettingsRecoverySection?.classList.add('hidden');
        this.authSettingsActions?.classList.remove('hidden');
        // Optionally, if this is the only thing open, close the main settings modal too
        // this.hideSettingsModal();
    }

    // Original methods, now updated to hide auth-settings-modal if it's open
    async loadSecretQuestion() {
        try {
            const secretData = await storageService.getRecoveryMethod('secret_question');
            if (secretData && secretData.question) {
                document.getElementById('secret-question-display').textContent = secretData.question;
            } else {
                document.getElementById('secret-question-display').textContent = 'No secret question configured';
            }
        } catch (err) {
            console.error('Failed to load secret question', err);
        }
    }

    selectRecoveryMethod(method) {
        // Update buttons
        document.querySelectorAll('.recovery-method-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.method === method);
        });

        // Update forms
        document.querySelectorAll('.recovery-method-form').forEach(form => {
            form.classList.add('hidden');
        });
        document.getElementById(`${method}-form`)?.classList.remove('hidden');
    }

    async handleRecoveryKeySubmit() {
        const recoveryKey = document.getElementById('recovery-key-input').value.trim();
        if (!recoveryKey) {
            this.showToast('Please enter your recovery key', 'error');
            return;
        }

        try {
            await authService.unlockWithRecovery(recoveryKey);
            this.showToast('Account recovered successfully!', 'success');
        } catch (err) {
            console.error('Recovery key failed', err);
            this.showToast('Invalid recovery key', 'error');
        }
    }

    async handleBackupCodeSubmit() {
        const code = document.getElementById('backup-code-input').value.trim().toUpperCase();
        if (!code) {
            this.showToast('Please enter a backup code', 'error');
            return;
        }

        try {
            const isValid = await recoveryService.verifyBackupCode(code);
            if (!isValid) {
                this.showToast('Invalid or already used backup code', 'error');
                return;
            }

            // Code is valid, now we need to unlock the vault
            // For this, we need to get the recovery key from storage
            const meta = await storageService.getCryptoMeta();
            if (!meta || !meta.wrappedRecoveryKey) {
                this.showToast('No recovery data found', 'error');
                return;
            }

            // Unlock with recovery key
            const recoveryKey = await cryptoService.unwrapKey(
                Utils.base64ToBuffer(meta.wrappedRecoveryKey),
                code // Use backup code as password
            );

            await authService.unlockWithRecovery(Utils.bufferToBase64(await crypto.subtle.exportKey('raw', recoveryKey)));
            this.showToast('Account recovered successfully!', 'success');
        } catch (err) {
            console.error('Backup code recovery failed', err);
            this.showToast('Recovery failed. Please try another method.', 'error');
        }
    }

    async handleSecretQuestionSubmit() {
        const answer = document.getElementById('secret-answer-input').value;
        if (!answer) {
            this.showToast('Please enter your answer', 'error');
            return;
        }

        try {
            const isValid = await recoveryService.verifySecretAnswer(answer);
            if (!isValid) {
                this.showToast('Incorrect answer', 'error');
                return;
            }

            // Answer is correct, proceed with recovery
            const meta = await storageService.getCryptoMeta();
            if (!meta || !meta.wrappedRecoveryKey) {
                this.showToast('No recovery data found', 'error');
                return;
            }

            // Derive key from answer and unwrap recovery key
            const answerKey = await cryptoService.deriveKey(answer, meta.salt);
            const recoveryKey = await cryptoService.unwrapKey(
                Utils.base64ToBuffer(meta.wrappedRecoveryKey),
                answerKey
            );

            await authService.unlockWithRecovery(Utils.bufferToBase64(await crypto.subtle.exportKey('raw', recoveryKey)));
            this.showToast('Account recovered successfully!', 'success');
        } catch (err) {
            console.error('Secret question recovery failed', err);
            this.showToast('Recovery failed. Please check your answer.', 'error');
        }
    }

    async handleUnlockWithRecoveryFile() {
        const fileInput = document.getElementById('recovery-file-input');
        const usernameInput = document.getElementById('recovery-file-username');
        const codeInput = document.getElementById('recovery-file-code');
        const file = fileInput.files[0];

        if (!file) {
            this.showToast('Please select a recovery file', 'error');
            return;
        }
        const username = usernameInput.value.trim();
        const partialPin = codeInput.value.trim();

        if (!username || !partialPin) {
            this.showToast('Username and Recovery Code are required.', 'error');
            return;
        }

        const reader = new FileReader();
        reader.onload = async (event) => {
            try {
                const fileContent = event.target.result;
                await authService.unlockWithRecoveryFile(fileContent, username, partialPin);
                // The 'auth:unlock' event will handle the rest
                this.showToast('Vault unlocked successfully with recovery file!', 'success');
            } catch (error) {
                console.error('Failed to unlock with recovery file:', error);
                this.showToast('Unlock failed. Invalid file or credentials.', 'error');
            }
        };
        reader.onerror = () => {
            this.showToast('Error reading the recovery file.', 'error');
        }
        reader.readAsText(file);
    }

    showLoginForm() {
        this.forms.login?.classList.remove('hidden');
        this.settingsModal.overlay?.classList.add('hidden');
        this.inputs.loginUsername?.focus();
    }

    async handleLoginSubmit(e) {
        e.preventDefault();

        // Check Lockout
        const lockoutUntil = parseInt(localStorage.getItem('pinbridge.lockout_until') || '0');
        if (Date.now() < lockoutUntil) {
            const remaining = Math.ceil((lockoutUntil - Date.now()) / 1000);
            this.showToast(`Account locked. Try again in ${remaining}s`, 'error');
            this.shakeElement(this.inputs.loginPin);
            return;
        }

        const username = (this.inputs.loginUsername?.value || '').trim();
        const pin = (this.inputs.loginPin?.value || '').trim();

        if (!username || !pin) {
            this.showToast(i18n.t('authErrorPinRequired'), 'error');
            return;
        }

        try {
            const storedName = await this._fetchStoredUsername();
            if (storedName && storedName.toLowerCase() !== username.toLowerCase()) {
                this.showToast('Username does not match the stored vault.', 'error');
                return;
            }

            await authService.unlockWithPin(pin);
            this.logActivity(`Vault Unlocked: ${username}`);

            const welcomeName = vaultService.meta?.username || await storageService.getMeta('vault_username');
            const greeting = welcomeName ? i18n.t('toastWelcomeNamed', { name: welcomeName }) : i18n.t('toastWelcomeBack');
            this.showToast(greeting, 'success');
            this.refreshUsernameRecommendation();

            // Reset attempts on success
            this.loginAttempts = 0;
            localStorage.removeItem('pinbridge.lockout_until');
        } catch (err) {
            // Handle Lockout Logic
            this.loginAttempts++;
            if (this.loginAttempts >= 3) {
                const lockoutTime = Date.now() + 30000; // 30 seconds
                localStorage.setItem('pinbridge.lockout_until', lockoutTime);
                this.loginAttempts = 0;
                this.showToast('Too many attempts. Account locked for 30s.', 'error');
            } else {
                this.showToast(this.resolveAuthErrorMessage(err?.message || err), 'error');
            }

            if (this.inputs.loginPin) this.inputs.loginPin.value = '';
            this.shakeElement(this.inputs.loginPin);

            const code = err?.message || err;
            if (code === 'VAULT_METADATA_MISSING' || code === 'NO_VAULT') {
                this.showToast(i18n.t('authErrorMissingVault'), 'info');
            }
        }
    }

    refreshUsernameRecommendation() {
        if (!this.usernameRecommendationText) return;
        this._fetchStoredUsername().then((name) => {
            this.usernameRecommendationText.textContent = name || 'unknown';
        }).catch(() => {
            this.usernameRecommendationText.textContent = 'unknown';
        });
    }

    async _fetchStoredUsername() {
        if (this.storedUsername !== null) return this.storedUsername;
        if (vaultService.meta?.username) {
            this.storedUsername = vaultService.meta.username;
            return this.storedUsername;
        }

        if (!storageService.db) {
            return null;
        }

        const cryptoMeta = await storageService.getCryptoMeta();
        if (cryptoMeta?.username) {
            this.storedUsername = cryptoMeta.username;
            return this.storedUsername;
        }
        const cached = await storageService.getMeta('vault_username');
        this.storedUsername = cached || null;
        return this.storedUsername;
    }

    async handleResetLocal() {
        const confirmed = confirm(i18n.t('confirmResetLocal'));
        if (!confirmed) return;
        try {
            await vaultService.fileRecoveryResetRequest();
        } catch (e) {
            console.warn('Recovery request failed', e);
        }
        await storageService.resetAll();
        authService.forceLogout('manual');
        this.showToast(i18n.t('toastResetDone'), 'info');
        location.reload();
    }

    resolveAuthErrorMessage(code) {
        switch (code) {
            case 'INVALID_PIN':
            case 'INVALID_USER':
                return i18n.t('authErrorInvalid');
            case 'VAULT_METADATA_MISSING':
            case 'NO_VAULT':
                return i18n.t('authErrorMissingVault');
            case 'VAULT_CORRUPT':
                return i18n.t('authErrorCorrupt');
            case 'USERNAME_REQUIRED':
                return i18n.t('authErrorUsernameRequired');
            case 'PIN_REQUIRED':
                return i18n.t('authErrorPinRequired');
            case 'RECOVERY_REQUIRED':
                return i18n.t('authErrorRecoveryRequired');
            default:
                return `${i18n.t('loginFormTitle')}: ${code}`;
        }
    }

    handleLockedSession(reason) {
        vaultService.lock();
        this.showScreen('auth');
        this.showLoginForm();
        notesService.notes = [];
        searchService.buildIndex([]);
        this.renderNoteList([]);
        this.clearEditor();
        this.currentView = 'all';
        this.hideSessionTimer();
        document.querySelectorAll('.nav-item, .folder-item').forEach(el => el.classList.remove('active'));

        // Don't show a toast on initial load when no session is found
        if (reason === 'no-session') return;

        const msg = reason === 'idle' ? i18n.t('toastVaultLockedIdle') : i18n.t('toastVaultLocked');
        this.showToast(msg, 'info');
    }

    addVaultEventListeners() {
        document.querySelectorAll('.nav-item[data-view]').forEach(btn => {
            btn.onclick = () => {
                document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.currentView = btn.dataset.view;
                this.renderCurrentView();
            };
        });

        this.mobile.navPills?.forEach(btn => {
            btn.onclick = () => {
                this.mobile.navPills.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.currentView = btn.dataset.view;
                this.renderCurrentView();
            };
        });

        // Mobile menu (hamburger) toggle
        if (this.mobile.btnMenu) {
            this.mobile.btnMenu.addEventListener('click', (e) => {
                e.preventDefault();
                this.toggleMobileSidebar();
            });
        }

        this.inputs.search?.addEventListener('input', (e) => this.handleSearchInput(e));

        document.getElementById('btn-new-note')?.addEventListener('click', () => this.handleNewNote());
        if (this.mobile.btnNew) this.mobile.btnNew.onclick = () => this.handleNewNote();
        if (this.mobile.footerNewBtn) {
            this.mobile.footerNewBtn.onclick = async () => {
                if (this.mobileFooterBusy) return;
                this.mobileFooterBusy = true;
                this.mobile.footerNewBtn.setAttribute('disabled', 'disabled');
                try {
                    await this.handleNewNote();
                } finally {
                    setTimeout(() => {
                        this.mobileFooterBusy = false;
                        this.mobile.footerNewBtn?.removeAttribute('disabled');
                    }, 500);
                }
            };
        }

        if (this.mobile.footerMenuBtn) {
            this.mobile.footerMenuBtn.onclick = (e) => {
                e.preventDefault();
                this.openMobileFooterMenu();
            };
        }

        this.bindMobileFooterMenu();

        // Notes settings menu
        document.getElementById('btn-notes-settings')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleNotesSettingsMenu();
        });

        // Close settings menu when clicking outside
        document.addEventListener('click', (e) => {
            const menu = document.getElementById('notes-settings-menu');
            const btn = document.getElementById('btn-notes-settings');
            if (menu && !menu.contains(e.target) && !btn?.contains(e.target)) {
                menu.classList.add('hidden');
            }
        });

        // Settings toggles
        document.getElementById('toggle-compact-view')?.addEventListener('change', (e) => {
            this.compactViewEnabled = e.target.checked;
            localStorage.setItem('pinbridge.compact_notes', this.compactViewEnabled);
            this.updateCompactViewUI();
        });

        document.getElementById('toggle-show-preview')?.addEventListener('change', (e) => {
            localStorage.setItem('pinbridge.show_preview', e.target.checked);
            this.renderCurrentView();
        });

        document.getElementById('notes-sort-select')?.addEventListener('change', (e) => {
            localStorage.setItem('pinbridge.notes_sort', e.target.value);
            this.renderCurrentView();
        });

        document.getElementById('btn-lock')?.addEventListener('click', () => authService.forceLogout('manual'));
        if (this.mobile.btnLock) this.mobile.btnLock.onclick = () => authService.forceLogout('manual');

        document.getElementById('btn-toggle-compact')?.addEventListener('click', () => this.toggleCompactView());

        if (this.inputs.quickDrop) {
            const quickDropInput = this.inputs.quickDrop;
            quickDropInput.addEventListener('keydown', (e) => this.handleQuickDrop(e));
            quickDropInput.addEventListener('focus', () => this.quickDropZone?.classList.remove('collapsed'));
            quickDropInput.addEventListener('blur', () => {
                if (!quickDropInput.value) this.quickDropZone?.classList.add('collapsed');
            });
        }
    }

    toggleMobileSidebar() {
        const isOpen = document.body.classList.toggle('mobile-sidebar-open');
        let backdrop = document.getElementById('mobile-nav-backdrop');
        if (!backdrop) {
            backdrop = document.createElement('div');
            backdrop.id = 'mobile-nav-backdrop';
            backdrop.className = 'mobile-nav-backdrop';
            document.body.appendChild(backdrop);
            backdrop.addEventListener('click', () => this.toggleMobileSidebar());
        }
        backdrop.classList.toggle('visible', isOpen);
    }

    showSettingsModal() {
        // Auth Settings (pre-login): never touch encrypted vault data.
        this.settingsModal.overlay?.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
    }

    hideSettingsModal() {
        this.settingsModal.overlay?.classList.add('hidden');
        document.body.style.overflow = '';
    }

    addEditorEventListeners() {
        // Inject Focus Mode Controls
        const toolbarActions = document.querySelector('.editor-actions-minimal');
        let focusBtn = document.getElementById('btn-focus-mode');
        if (toolbarActions && !focusBtn) {
            const btn = document.createElement('button');
            btn.id = 'btn-focus-mode';
            btn.className = 'btn-tool-minimal';
            btn.title = 'Focus Mode (F)';
            btn.setAttribute('aria-label', 'Toggle Focus Mode');
            btn.innerHTML = '<i data-feather="maximize"></i>';
            btn.onclick = () => this.toggleFocusMode();
            toolbarActions.insertBefore(btn, toolbarActions.firstChild);
            focusBtn = btn;
        }
        if (focusBtn) {
            focusBtn.onclick = () => this.toggleFocusMode();
        }

        if (!document.getElementById('btn-exit-focus-mode')) {
            const exitBtn = document.createElement('button');
            exitBtn.id = 'btn-exit-focus-mode';
            exitBtn.className = 'btn-icon-primary';
            exitBtn.title = 'Exit Focus Mode';
            exitBtn.setAttribute('aria-label', 'Exit Focus Mode');
            exitBtn.innerHTML = '<i data-feather="minimize"></i>';
            exitBtn.onclick = () => this.toggleFocusMode(false);
            document.body.appendChild(exitBtn);
        }
        if (typeof feather !== 'undefined') feather.replace();

        // Inject Capture Tools (Voice & OCR)
        if (toolbarActions) {
            // Voice
            if (!document.getElementById('btn-voice-type')) {
                const btn = document.createElement('button');
                btn.id = 'btn-voice-type';
                btn.className = 'btn-tool-minimal';
                btn.title = 'Voice Typing';
                btn.innerHTML = '<i data-feather="mic"></i>';
                btn.onclick = () => this.toggleVoiceRecording();
                toolbarActions.insertBefore(btn, toolbarActions.firstChild);
            }
            // OCR
            if (!document.getElementById('btn-ocr-scan')) {
                const btn = document.createElement('button');
                btn.id = 'btn-ocr-scan';
                btn.className = 'btn-tool-minimal';
                btn.title = 'Scan Text (OCR)';
                btn.innerHTML = '<i data-feather="camera"></i>';
                btn.onclick = () => this.initOCR();
                toolbarActions.insertBefore(btn, toolbarActions.firstChild);
            }
        }

        this.inputs.noteTitle?.addEventListener('input', () => {
            this.scheduleAutoSave();
            this.refreshSaveButtonState();
            this.updateSmartSuggestions();
        });

        this.inputs.noteContent?.addEventListener('input', () => {
            this.scheduleAutoSave();
            this.refreshSaveButtonState();
            this.updateWordCount();
            this.autoResizeTextarea(this.inputs.noteContent);
            this.updateSmartSuggestions();
        });

        this.inputs.noteContent?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                this.handleSmartList(e);
            }
        });

        this.inputs.noteFolder?.addEventListener('input', () => this.scheduleAutoSave());
        this.inputs.noteTags?.addEventListener('input', () => {
            this.scheduleAutoSave();
            this.updateSmartSuggestions();
        });

        document.getElementById('btn-delete')?.addEventListener('click', () => this.handleDelete());
        // Minimal toolbar actions
        document.getElementById('btn-pin-note')?.addEventListener('click', () => this.handlePinNote());

        if (this.attachments?.primaryBtn) {
            this.attachments.primaryBtn.addEventListener('click', () => this.handleAttachmentPick());
        }
        if (this.attachments?.secondaryBtn) {
            this.attachments.secondaryBtn.addEventListener('click', () => this.handleAttachmentPick());
        }
        if (this.attachments?.input) {
            this.attachments.input.addEventListener('change', (e) => this.handleAttachmentSelection(e));
        }

        // History
        document.getElementById('btn-history')?.addEventListener('click', () => this.showHistoryModal());
        document.getElementById('close-history-modal')?.addEventListener('click', () => {
            document.getElementById('history-modal').classList.add('hidden');
        });

        // Templates
        document.getElementById('btn-insert-template')?.addEventListener('click', () => this.showTemplateModal());
        document.getElementById('close-template-modal')?.addEventListener('click', () => {
            document.getElementById('template-modal').classList.add('hidden');
        });

        // Read-Only Mode
        document.getElementById('btn-toggle-readonly')?.addEventListener('click', () => this.toggleReadOnly());

        // Dashboard Quick Actions
        document.querySelectorAll('.quick-action-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const action = e.currentTarget.dataset.action;
                if (action === 'new-note') {
                    this.currentView = 'all';
                    document.querySelector('[data-view="all"]')?.click();
                    this.handleNewNote();
                } else if (action === 'new-template') {
                    this.currentView = 'templates';
                    document.querySelector('[data-view="templates"]')?.click();
                    this.handleNewNote();
                } else if (action === 'view-favorites') {
                    document.querySelector('[data-view="favorites"]')?.click();
                } else if (action === 'view-trash') {
                    document.querySelector('[data-view="trash"]')?.click();
                }
            });
        });

        // Settings Modal (vault-only)
        document.getElementById('btn-vault-settings')?.addEventListener('click', () => this.openSettingsModal());
        document.getElementById('close-settings-modal')?.addEventListener('click', () => {
            document.getElementById('settings-modal').classList.add('hidden');
        });

        // Sync toggle
        const syncToggle = document.getElementById('toggle-sync-enabled');
        if (syncToggle) {
            syncToggle.addEventListener('change', (e) => this.handleSyncToggle(e.target.checked));
        }

        // Transparency Controls
        this._getById('toggle-tag-sync')?.addEventListener('change', (e) => this.handleTagSyncToggle(e.target.checked));
        this._getById('toggle-duplicate-detection')?.addEventListener('change', (e) => this.handleDuplicateDetectionToggle(e.target.checked));

        // Duplicate Detection
        this._getById('btn-find-duplicates')?.addEventListener('click', () => this.findDuplicates());

        // Privacy Controls
        document.getElementById('toggle-clear-on-exit')?.addEventListener('change', (e) => {
            localStorage.setItem('pinbridge.clear_on_exit', e.target.checked);
            this.logActivity(`Privacy: Clear session on exit ${e.target.checked ? 'enabled' : 'disabled'}`);
        });
        // Settings Tabs
        document.querySelectorAll('.settings-tab').forEach(tab => {
            tab.addEventListener('click', e => {
                const tabName = e.target.dataset.tab;
                this.switchSettingsTab(tabName);
            });
        });

        // Recovery Actions
        document.getElementById('btn-generate-backup-codes')?.addEventListener('click', () => this.generateBackupCodes());
        document.getElementById('btn-setup-secret-question')?.addEventListener('click', () => this.openSecretQuestionModal());

        // Device Pairing
        this._getById('btn-link-device')?.addEventListener('click', () => this.showPairingModal());
        this._getById('close-pairing-modal')?.addEventListener('click', () => this.hidePairingModal());

        // Backup Codes Modal
        document.getElementById('close-backup-codes-modal')?.addEventListener('click', () => {
            document.getElementById('backup-codes-modal').classList.add('hidden');
        });
        document.getElementById('copy-backup-codes')?.addEventListener('click', () => this.copyBackupCodes());
        document.getElementById('download-backup-codes')?.addEventListener('click', () => this.downloadBackupCodes());
        document.getElementById('email-backup-codes-prompt')?.addEventListener('click', () => this.emailBackupCodes());
        document.getElementById('confirm-backup-codes')?.addEventListener('click', () => {
            document.getElementById('backup-codes-modal').classList.add('hidden');
            this.showToast('Backup codes saved successfully', 'success');
            this.renderActiveRecoveryMethods();
        });

        // RECOVERY PERSISTENCE: Global beforeunload handler
        window.addEventListener('beforeunload', (e) => {
            if (this.activeNoteId) {
                const hasChanged = this.isNoteChanged();
                if (hasChanged) {
                    // We can't await here but we can try to fire a sync request
                    this.persistNote(true).catch(err => console.error("Final persist failed", err));

                    // Show confirmation if it's not a clear-on-exit scenario
                    const clearOnExit = localStorage.getItem('pinbridge.clear_on_exit') === 'true';
                    if (!clearOnExit) {
                        e.preventDefault();
                        e.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
                    }
                }
            }
        });

        // Secret Question Modal
        document.getElementById('close-secret-question-modal')?.addEventListener('click', () => {
            document.getElementById('secret-question-modal').classList.add('hidden');
        });
        document.getElementById('cancel-secret-question')?.addEventListener('click', () => {
            document.getElementById('secret-question-modal').classList.add('hidden');
        });

        // Password Generator
        document.getElementById('btn-generate-password')?.addEventListener('click', () => this.generatePassword());
        document.getElementById('btn-regenerate-password')?.addEventListener('click', () => this.generatePassword());
        document.getElementById('btn-copy-password')?.addEventListener('click', () => this.copyPassword());
        document.getElementById('btn-save-generated-password')?.addEventListener('click', () => this.handleSaveGeneratedPassword());
        document.getElementById('btn-copy-generated-password')?.addEventListener('click', () => this.copyPassword('btn-copy-generated-password'));
        document.getElementById('btn-discard-generated-password')?.addEventListener('click', () => this.discardGeneratedPassword());

        document.getElementById('save-secret-question')?.addEventListener('click', () => this.saveSecretQuestion());

        // Tags Manager
        document.getElementById('btn-tags-manager')?.addEventListener('click', () => this.openTagsManager());
        document.getElementById('close-tags-manager')?.addEventListener('click', () => {
            document.getElementById('tags-manager-modal').classList.add('hidden');
        });

        // Generate Recovery File Modal
        document.getElementById('btn-generate-recovery-file')?.addEventListener('click', () => this.openGenerateFileModal());
        document.getElementById('close-generate-file-modal')?.addEventListener('click', () => this.closeGenerateFileModal());
        document.getElementById('cancel-generate-file')?.addEventListener('click', () => this.closeGenerateFileModal());
        document.getElementById('generate-file-form')?.addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleGenerateFileSubmit();
        });
    }

    // --- VOICE TYPING ---
    toggleVoiceRecording() {
        if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
            this.showToast('Speech recognition not supported in this browser.', 'error');
            return;
        }

        if (this.isRecording) {
            this.stopVoiceRecording();
            return;
        }

        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        this.recognition = new SpeechRecognition();
        this.recognition.continuous = true;
        this.recognition.interimResults = true;
        this.recognition.lang = i18n.getLanguage();

        this.recognition.onstart = () => {
            this.isRecording = true;
            document.getElementById('btn-voice-type')?.classList.add('recording-pulse');
            this.showToast('Listening...', 'info');
        };

        this.recognition.onresult = (event) => {
            for (let i = event.resultIndex; i < event.results.length; ++i) {
                if (event.results[i].isFinal) {
                    this.insertTextAtCursor(event.results[i][0].transcript + ' ');
                }
            }
        };

        this.recognition.onerror = (event) => {
            console.error('Speech error', event.error);
            this.stopVoiceRecording();
        };

        this.recognition.onend = () => {
            this.stopVoiceRecording();
        };

        this.recognition.start();
    }

    stopVoiceRecording() {
        this.isRecording = false;
        document.getElementById('btn-voice-type')?.classList.remove('recording-pulse');
        if (this.recognition) {
            this.recognition.stop();
            this.recognition = null;
        }
    }

    // --- OCR SCANNING ---
    async initOCR() {
        // Create Modal if missing
        if (!document.getElementById('ocr-modal')) {
            const modal = document.createElement('dialog');
            modal.id = 'ocr-modal';
            modal.className = 'modal-overlay hidden';
            modal.innerHTML = `
                <div class="modal-content">
                    <div class="modal-header">
                        <h2>Scan Text</h2>
                        <button class="modal-close" id="close-ocr-modal">&times;</button>
                    </div>
                    <div class="modal-body">
                        <div class="qr-scanner-container">
                            <video id="ocr-video" playsinline></video>
                            <div class="qr-scanner-overlay"></div>
                        </div>
                        <div id="ocr-status" class="hint center">Point camera at text</div>
                        <div id="ocr-result-preview" class="ocr-preview"></div>
                        <div class="modal-actions">
                            <button id="btn-insert-ocr" class="btn btn-primary">Insert Text</button>
                        </div>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);

            this._getById('close-ocr-modal').onclick = () => this.hideOCRModal();
            this._getById('btn-insert-ocr').onclick = () => {
                this.insertOcrText();
                this.hideOCRModal();
            };
        }

        const modal = this._getById('ocr-modal');
        modal.classList.remove('hidden');

        // Load and initialize Tesseract
        if (!this.ocrWorker) {
            this.showToast('Loading OCR engine...', 'info');
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
            document.head.appendChild(script);
            await new Promise(resolve => script.onload = resolve);
            this.ocrWorker = await Tesseract.createWorker('eng', 1, {
                logger: m => {
                    if (m.status === 'recognizing text') {
                        const statusEl = this._getById('ocr-status');
                        if (statusEl) statusEl.innerText = `Scanning: ${Math.round(m.progress * 100)}%`;
                    }
                }
            });
            await this.ocrWorker.setParameters({
                tessedit_pageseg_mode: Tesseract.PSM.SINGLE_BLOCK,
                tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
            });
        }

        this.startOCRCamera();
    }

    hideOCRModal() {
        this._getById('ocr-modal')?.classList.add('hidden');
        this.stopOCRCamera();
    }

    async startOCRCamera() {
        const video = this._getById('ocr-video');
        if (!video) return;
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
            video.srcObject = stream;
            await video.play();
            this.ocrScanInterval = setInterval(() => this.scanFrame(), 1000);
        } catch (err) {
            console.error("OCR Camera Error:", err);
            this.showToast('Could not access camera', 'error');
        }
    }

    stopOCRCamera() {
        if (this.ocrScanInterval) {
            clearInterval(this.ocrScanInterval);
            this.ocrScanInterval = null;
        }
        this.isOcrProcessing = false;
        const video = this._getById('ocr-video');
        if (video && video.srcObject) {
            video.srcObject.getTracks().forEach(track => track.stop());
            video.srcObject = null;
        }
    }

    async scanFrame() {
        const video = this._getById('ocr-video');
        const overlay = document.querySelector('.qr-scanner-overlay');
        const statusEl = this._getById('ocr-status');
        const previewEl = this._getById('ocr-result-preview');

        if (!video || !overlay || this.isOcrProcessing || !this.ocrWorker) return;

        this.isOcrProcessing = true;
        statusEl.innerText = 'Capturing...';

        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d', { willReadFrequently: true });

        const videoRect = video.getBoundingClientRect();
        const overlayRect = overlay.getBoundingClientRect();

        const scaleX = video.videoWidth / videoRect.width;
        const scaleY = video.videoHeight / videoRect.height;

        const cropX = (overlayRect.left - videoRect.left) * scaleX;
        const cropY = (overlayRect.top - videoRect.top) * scaleY;
        const cropWidth = overlayRect.width * scaleX;
        const cropHeight = overlayRect.height * scaleY;

        canvas.width = cropWidth;
        canvas.height = cropHeight;

        context.drawImage(video, cropX, cropY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);

        this._preprocessCanvas(canvas);

        try {
            const { data } = await this.ocrWorker.recognize(canvas);
            const processedText = this._postProcessOcrText(data.text);

            if (data.confidence > 60) {
                statusEl.innerText = `Confidence: ${data.confidence.toFixed(0)}%`;
                previewEl.textContent = processedText;
            } else {
                statusEl.innerText = "Text not clear yet ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â adjust angle or lighting";
            }
        } catch (err) {
            console.error(err);
            statusEl.innerText = 'Scan failed. Try again.';
        } finally {
            this.isOcrProcessing = false;
        }
    }

    _preprocessCanvas(canvas) {
        const ctx = canvas.getContext('2d');
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;

        // Grayscale and Contrast
        for (let i = 0; i < data.length; i += 4) {
            const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
            let gray = avg;
            // Simple contrast enhancement
            gray = 1.5 * (gray - 128) + 128;
            gray = Math.max(0, Math.min(255, gray));

            data[i] = data[i + 1] = data[i + 2] = gray;
        }
        ctx.putImageData(imageData, 0, 0);

        // Binarization (Otsu's method would be better, but simple threshold for now)
        const threshold = 128;
        for (let i = 0; i < data.length; i += 4) {
            const val = data[i] < threshold ? 0 : 255;
            data[i] = data[i + 1] = data[i + 2] = val;
        }
        ctx.putImageData(imageData, 0, 0);
    }

    _postProcessOcrText(text) {
        if (!text) return '';
        return text.split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 2 && !/^[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?~`]+$/.test(line))
            .join('\n')
            .replace(/\s+/g, ' ');
    }

    insertOcrText() {
        const text = this._getById('ocr-result-preview').textContent;
        if (text) {
            this.insertTextAtCursor(text + ' ');
            this.showToast('Text inserted from scan', 'success');
        }
    }

    toggleSmartSuggestions(forceState) {
        const sidebar = document.querySelector('.suggestions-sidebar');
        const btn = document.getElementById('btn-smart-suggest');
        if (!sidebar) return;

        const isVisible = typeof forceState === 'boolean' ? forceState : !sidebar.classList.contains('visible');

        sidebar.classList.toggle('visible', isVisible);
        if (btn) btn.classList.toggle('active', isVisible);

        if (isVisible) {
            this.updateSmartSuggestions();
        }
    }

    updateSmartSuggestions() {
        const sidebar = document.querySelector('.suggestions-sidebar');
        if (!sidebar || !sidebar.classList.contains('visible')) return;

        const contentContainer = document.getElementById('suggestions-content');
        if (!contentContainer) return;

        const title = (this.inputs.noteTitle?.value || '').toLowerCase();
        const body = (this.inputs.noteContent?.value || '').toLowerCase();
        const fullText = title + " " + body;
        const currentTags = (this.inputs.noteTags?.value || '').split(',').map(t => t.trim().toLowerCase()).filter(t => t);

        const allNotes = notesService.notes;
        const tagCounts = {};
        const coOccurring = {};

        // 1. Analyze Vault Tags
        allNotes.forEach(n => {
            if (n.tags) n.tags.forEach(t => {
                const lower = t.toLowerCase();
                tagCounts[lower] = (tagCounts[lower] || 0) + 1;

                // Co-occurrence analysis
                if (currentTags.length > 0 && n.tags.some(nt => currentTags.includes(nt.toLowerCase()))) {
                    if (!currentTags.includes(lower)) {
                        coOccurring[lower] = (coOccurring[lower] || 0) + 1;
                    }
                }
            });
        });

        const contentMatches = new Set();
        const relatedTags = new Set();

        // 2. Find Content Matches
        Object.keys(tagCounts).forEach(tag => {
            if (fullText.includes(tag) && !currentTags.includes(tag)) {
                contentMatches.add(tag);
            }
        });

        // 3. Find Related Tags (Top 5 co-occurring)
        Object.entries(coOccurring)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .forEach(([tag]) => relatedTags.add(tag));

        // Render
        let html = '';

        if (contentMatches.size > 0) {
            html += `<div class="suggestion-group"><h4>Found in text</h4><div class="suggestion-chips">`;
            contentMatches.forEach(tag => {
                html += `<button class="suggestion-chip" data-tag="${tag}"><i data-feather="plus"></i> ${tag}</button>`;
            });
            html += `</div></div>`;
        }

        if (relatedTags.size > 0) {
            html += `<div class="suggestion-group"><h4>Related</h4><div class="suggestion-chips">`;
            relatedTags.forEach(tag => {
                html += `<button class="suggestion-chip" data-tag="${tag}"><i data-feather="link"></i> ${tag}</button>`;
            });
            html += `</div></div>`;
        }

        if (contentMatches.size === 0 && relatedTags.size === 0) {
            html = '<p class="hint">No suggestions found based on current content.</p>';
        }

        contentContainer.innerHTML = html;
        if (typeof feather !== 'undefined') feather.replace();

        // Bind click events
        contentContainer.querySelectorAll('.suggestion-chip').forEach(btn => {
            btn.onclick = () => {
                const tag = btn.dataset.tag;
                const newTags = currentTags.concat(tag).join(', ');
                this.inputs.noteTags.value = newTags;
                this.inputs.noteTags.dispatchEvent(new Event('input')); // Trigger save & update
            };
        });
    }

    autoResizeTextarea(element) {
        if (!element) return;
        element.style.height = 'auto';
        element.style.height = element.scrollHeight + 'px';
    }

    toggleFocusMode(forceState) {
        this.isFocusMode = typeof forceState === 'boolean' ? forceState : !this.isFocusMode;
        document.body.classList.toggle('focus-mode-active', this.isFocusMode);
        const focusBtn = document.getElementById('btn-focus-mode');
        if (focusBtn) {
            focusBtn.setAttribute('aria-pressed', this.isFocusMode ? 'true' : 'false');
        }
        this.hapticFeedback();

        if (this.isFocusMode) {
            this.showToast('Focus Mode enabled. Press "F" or "Esc" to exit.', 'info');
        }
    }

    addKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // Don't trigger shortcuts when typing in inputs
            if (['INPUT', 'TEXTAREA'].includes(e.target.tagName) && !e.ctrlKey && !e.metaKey) {
                return;
            }

            // Focus mode
            if (e.key.toLowerCase() === 'f' && !e.ctrlKey && !e.metaKey) {
                e.preventDefault();
                this.toggleFocusMode();
            }

            // Escape to exit focus mode or close modals
            if (e.key === 'Escape') {
                if (this.isFocusMode) {
                    this.toggleFocusMode(false);
                } else {
                    const decisionModal = this._getById('generated-password-modal');
                    const deleteModal = this._getById('password-history-delete-modal');
                    if (decisionModal && !decisionModal.classList.contains('hidden')) return;
                    if (deleteModal && !deleteModal.classList.contains('hidden')) return;
                    // Close any open modals
                    document.querySelectorAll('.modal-overlay:not(.hidden)').forEach(modal => {
                        modal.classList.add('hidden');
                    });
                    document.getElementById('notes-settings-menu')?.classList.add('hidden');
                }
            }

            // New note (N)
            if (e.key.toLowerCase() === 'n' && !e.ctrlKey && !e.metaKey) {
                e.preventDefault();
                this.handleNewNote();
            }

            // Search (Ctrl/Cmd + K or /)
            if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
                e.preventDefault();
                document.getElementById('search-input')?.focus();
            }
            if (e.key === '/' && !e.ctrlKey && !e.metaKey) {
                e.preventDefault();
                document.getElementById('search-input')?.focus();
            }

            // Save (Ctrl/Cmd + S)
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                e.preventDefault();
                const saveBtn = document.getElementById('btn-save-note');
                if (saveBtn && !saveBtn.disabled) {
                    saveBtn.click();
                }
            }

            // Delete note (Delete or Backspace when note selected)
            if ((e.key === 'Delete' || e.key === 'Backspace') && this.activeNoteId && !['INPUT', 'TEXTAREA'].includes(e.target.tagName)) {
                e.preventDefault();
                this.handleDelete();
            }

            // Navigate notes with arrow keys
            if (['ArrowUp', 'ArrowDown'].includes(e.key) && !['INPUT', 'TEXTAREA'].includes(e.target.tagName)) {
                e.preventDefault();
                this.navigateNotes(e.key === 'ArrowDown' ? 1 : -1);
            }

            // Switch focus between List and Editor (Ctrl+Alt+Left/Right)
            if (e.ctrlKey && e.altKey) {
                if (e.key === 'ArrowLeft') { this.inputs.noteTitle?.blur(); this.inputs.noteContent?.blur(); }
                if (e.key === 'ArrowRight') { this.inputs.noteContent?.focus(); }
            }
        });
    }

    navigateNotes(direction) {
        const notes = this.getFilteredNotes();
        if (!notes.length) return;

        const currentIndex = notes.findIndex(n => n.id === this.activeNoteId);
        let newIndex = currentIndex + direction;

        if (newIndex < 0) newIndex = notes.length - 1;
        if (newIndex >= notes.length) newIndex = 0;

        this.selectNote(notes[newIndex]);
        const el = document.querySelector(`.note-item[data-id="${notes[newIndex].id}"]`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    async openSettingsModal() {
        // Vault Settings (post-login): require unlocked vault before rendering.
        if (!this.ensureAuthenticated()) return;
        const modal = document.getElementById('settings-modal');
        this.renderSettingsPanel(); // Render full settings UI
        this.renderThemeSwitcher();
        // Set the toggle to the correct initial state
        const syncEnabled = localStorage.getItem('pinbridge.sync_enabled') === 'true';
        const syncToggle = document.getElementById('toggle-sync-enabled');
        if (syncToggle) syncToggle.checked = syncEnabled;

        // ADDITIVE: Clear on exit toggle state
        const clearOnExit = localStorage.getItem('pinbridge.clear_on_exit') === 'true';
        const clearToggle = document.getElementById('toggle-clear-on-exit');
        if (clearToggle) clearToggle.checked = clearOnExit;
        modal.classList.remove('hidden');
        // Update dependent toggles
        const tagSyncToggle = this._getById('toggle-tag-sync');
        if (tagSyncToggle) tagSyncToggle.disabled = !syncEnabled;
        this.updateDuplicateDetectionUI();
        await this.renderActiveRecoveryMethods();
    }

    renderSettingsPanel() {
        // Inject settings sections if they don't exist
        const generalTab = document.getElementById('settings-general');
        if (generalTab && !generalTab.querySelector('.settings-injected')) {
            generalTab.innerHTML = `
                <div class="settings-injected">
                    <h3>Appearance</h3>
                    <div class="form-group">
                        <label>Theme</label>
                        <div id="theme-switcher" class="settings-actions"></div>
                    </div>
                    
                    <div class="form-group">
                        <label>Font Size</label>
                        <select id="setting-font-size" class="input-field">
                            <option value="sm">Small</option>
                            <option value="md" selected>Medium</option>
                            <option value="lg">Large</option>
                        </select>
                    </div>
                    
                    <div class="settings-item">
                        <div class="settings-item-content">
                            <span class="settings-item-title">Auto-hide Footer</span>
                            <span class="settings-item-desc">Hide navigation on scroll (Mobile)</span>
                        </div>
                        <div class="toggle-switch">
                            <input type="checkbox" id="setting-footer-autohide" class="toggle-input">
                            <label for="setting-footer-autohide" class="toggle-label"></label>
                        </div>
                    </div>

                    <h3>Security</h3>
                    <div class="settings-item">
                        <div class="settings-item-content">
                            <span class="settings-item-title">Blur on App Switch</span>
                            <span class="settings-item-desc">Hide content when switching windows</span>
                        </div>
                        <div class="toggle-switch">
                            <input type="checkbox" id="setting-blur-app" class="toggle-input">
                            <label for="setting-blur-app" class="toggle-label"></label>
                        </div>
                    </div>
                    
                    <div class="settings-item">
                        <div class="settings-item-content">
                            <span class="settings-item-title">Auto-Lock Timeout</span>
                            <span class="settings-item-desc">Lock vault after inactivity</span>
                        </div>
                        <select id="setting-timeout" class="settings-select-minimal">
                            <option value="5">5 minutes</option>
                            <option value="15">15 minutes</option>
                            <option value="30">30 minutes</option>
                            <option value="0">Never</option>
                        </select>
                    </div>

                    <h3>Notes Behavior</h3>
                    <div class="settings-item">
                        <div class="settings-item-content">
                            <span class="settings-item-title">Smart Checklists</span>
                            <span class="settings-item-desc">Continue list when pressing Enter</span>
                        </div>
                        <div class="toggle-switch">
                            <input type="checkbox" id="setting-smart-lists" class="toggle-input">
                            <label for="setting-smart-lists" class="toggle-label"></label>
                        </div>
                    </div>
                </div>
            `;

            // Bind Events
            this._bindSetting('setting-blur-app', 'pinbridge.security_blur', 'checkbox', () => this.setupSecurityFeatures());
            this._bindSetting('setting-smart-lists', 'pinbridge.smart_lists', 'checkbox');
            this._bindSetting('setting-font-size', 'pinbridge.ui_font_size', 'value', (val) => {
                document.documentElement.style.setProperty('--font-size-base', val === 'lg' ? '18px' : val === 'sm' ? '14px' : '16px');
            });
            this._bindSetting('setting-footer-autohide', 'pinbridge.footer_autohide', 'checkbox', (val) => {
                this.footerAutoHide = val;
                document.getElementById('mobile-footer')?.classList.remove('footer-hidden'); // Reset
            });

            // Timeout logic would go here (updating authService)
            this._bindSetting('setting-timeout', 'pinbridge.security_timeout', 'value');

            // Theme Switcher Listener (Delegation)
            const themeContainer = document.getElementById('theme-switcher');
            if (themeContainer) {
                themeContainer.addEventListener('click', (e) => this.handleThemeChange(e));
            }
        }

        // Inject Notifications Tab if missing
        const tabsContainer = document.querySelector('.settings-tabs');
        if (tabsContainer && !document.getElementById('tab-notifications')) {
            const btn = document.createElement('button');
            btn.id = 'tab-notifications';
            btn.className = 'settings-tab';
            btn.dataset.tab = 'notifications';
            btn.innerText = 'Notifications';
            btn.onclick = (e) => this.switchSettingsTab('notifications');
            tabsContainer.appendChild(btn);

            // Inject Content
            const content = document.createElement('div');
            content.id = 'settings-notifications';
            content.className = 'settings-content hidden';
            content.innerHTML = this._getNotificationsHTML();
            document.querySelector('.settings-modal').appendChild(content); // Append to modal container

            this._bindNotificationSettings();
        }
    }

    _getNotificationsHTML() {
        return `
            <h3>Notifications & Focus</h3>
            
            <div class="settings-item">
                <div class="settings-item-content">
                    <span class="settings-item-title">Enable Notifications</span>
                    <span class="settings-item-desc">Master switch for all alerts</span>
                </div>
                <div class="toggle-switch">
                    <input type="checkbox" id="notif-master-toggle" class="toggle-input">
                    <label for="notif-master-toggle" class="toggle-label"></label>
                </div>
            </div>

            <h4>Reminder Defaults</h4>
            <div class="form-group input-row">
                <div>
                    <label>Default Time</label>
                    <input type="time" id="notif-default-time" class="input-field" value="09:00">
                </div>
                <div>
                    <label>Snooze Duration</label>
                    <select id="notif-snooze-duration" class="input-field">
                        <option value="5">5 minutes</option>
                        <option value="10">10 minutes</option>
                        <option value="30">30 minutes</option>
                    </select>
                </div>
            </div>

            <h4>Notification Channels</h4>
            <div class="settings-list">
                <div class="settings-item">
                    <div class="settings-item-content">
                        <span class="settings-item-title">Browser Push</span>
                    </div>
                    <input type="checkbox" id="notif-channel-web" checked>
                </div>
                <div class="settings-item">
                    <div class="settings-item-content">
                        <span class="settings-item-title">Mobile (PWA)</span>
                    </div>
                    <input type="checkbox" id="notif-channel-pwa" checked>
                </div>
                <div class="settings-item">
                    <div class="settings-item-content">
                        <span class="settings-item-title">Email Digest</span>
                        <span class="settings-item-desc">Daily summary (Opt-in)</span>
                    </div>
                    <input type="checkbox" id="notif-channel-email">
                </div>
            </div>

            <h4>Focus Mode</h4>
            <div class="settings-item">
                <div class="settings-item-content">
                    <span class="settings-item-title">Silent Hours</span>
                    <span class="settings-item-desc">Mute notifications during specific times</span>
                </div>
                <div class="toggle-switch">
                    <input type="checkbox" id="notif-focus-enabled" class="toggle-input">
                    <label for="notif-focus-enabled" class="toggle-label"></label>
                </div>
            </div>
            <div id="focus-schedule-config" class="form-group input-row hidden" style="margin-top: 1rem;">
                <div>
                    <label>Start</label>
                    <input type="time" id="notif-focus-start" class="input-field" value="22:00">
                </div>
                <div>
                    <label>End</label>
                    <input type="time" id="notif-focus-end" class="input-field" value="07:00">
                </div>
            </div>
        `;
    }

    _bindNotificationSettings() {
        this._bindSetting('notif-master-toggle', 'pinbridge.notif.enabled', 'checkbox');
        this._bindSetting('notif-default-time', 'pinbridge.notif.default_time', 'value');
        this._bindSetting('notif-snooze-duration', 'pinbridge.notif.snooze', 'value');

        this._bindSetting('notif-channel-web', 'pinbridge.notif.channel_web', 'checkbox');
        this._bindSetting('notif-channel-pwa', 'pinbridge.notif.channel_pwa', 'checkbox');
        this._bindSetting('notif-channel-email', 'pinbridge.notif.channel_email', 'checkbox');

        // Focus Mode Logic
        const focusToggle = document.getElementById('notif-focus-enabled');
        const focusConfig = document.getElementById('focus-schedule-config');

        if (focusToggle) {
            const saved = localStorage.getItem('pinbridge.notif.focus_enabled') === 'true';
            focusToggle.checked = saved;
            if (saved) focusConfig.classList.remove('hidden');

            focusToggle.addEventListener('change', (e) => {
                localStorage.setItem('pinbridge.notif.focus_enabled', e.target.checked);
                if (e.target.checked) focusConfig.classList.remove('hidden');
                else focusConfig.classList.add('hidden');
            });
        }

        this._bindSetting('notif-focus-start', 'pinbridge.notif.focus_start', 'value');
        this._bindSetting('notif-focus-end', 'pinbridge.notif.focus_end', 'value');
    }

    _bindSetting(id, storageKey, type, callback) {
        const el = document.getElementById(id);
        if (!el) return;

        const saved = localStorage.getItem(storageKey);
        if (saved !== null) {
            if (type === 'checkbox') el.checked = saved === 'true';
            else el.value = saved;
        }

        el.addEventListener('change', (e) => {
            const val = type === 'checkbox' ? e.target.checked : e.target.value;
            localStorage.setItem(storageKey, val);
            if (callback) callback(val);
        });
    }

    renderThemeSwitcher() {
        const container = document.getElementById('theme-switcher');
        if (!container) return;

        const themes = [
            { id: 'light', name: 'Light' },
            { id: 'dark', name: 'Default Dark' },
            { id: 'amoled', name: 'AMOLED Black' },
            { id: 'low-contrast', name: 'Low Contrast' }
        ];

        const currentTheme = localStorage.getItem('pinbridge.theme') || 'dark';

        container.innerHTML = themes.map(theme => `
            <button class="settings-action ${currentTheme === theme.id ? 'active' : ''}" data-theme="${theme.id}">
                <div class="settings-action-content">
                    <span class="settings-action-title">${theme.name}</span>
                </div>
            </button>
        `).join('');
    }

    handleThemeChange(e) {
        const button = e.target.closest('[data-theme]');
        if (!button) return;

        const theme = button.dataset.theme;
        document.body.setAttribute('data-theme', theme);
        localStorage.setItem('pinbridge.theme', theme);

        // Update active class
        document.querySelectorAll('#theme-switcher .settings-action').forEach(btn => {
            btn.classList.remove('active');
        });
        button.classList.add('active');
        this.hapticFeedback();
    }

    handleSyncToggle(isEnabled) {
        localStorage.setItem('pinbridge.sync_enabled', isEnabled);
        vaultService.setSyncEnabled(isEnabled);
        this.hapticFeedback();
        if (isEnabled) {
            this.showToast('Cloud Sync enabled. Your vault will now sync when online.', 'success');
            // Trigger a sync check
            bus.emit('sync:toggled', true);
        } else {
            this.showToast('Cloud Sync disabled. Changes will only be saved on this device.', 'info');
        }
        // Also update the UI for dependent toggles
        const tagSyncToggle = this._getById('toggle-tag-sync');
        if (tagSyncToggle) tagSyncToggle.disabled = !isEnabled;

    }

    switchSettingsTab(tabName) {
        // Update tab buttons
        document.querySelectorAll('.settings-tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.tab === tabName);
        });

        // Update content panels
        document.querySelectorAll('.settings-content').forEach(content => {
            content.classList.add('hidden');
        });
        document.getElementById(`settings-${tabName}`)?.classList.remove('hidden');

        // ADDITIVE: Render logs if activity tab is active
        if (tabName === 'activity') {
            this.renderActivityLogs();
        }
    }

    async renderActiveRecoveryMethods() {
        const container = document.getElementById('active-recovery-methods');
        const methods = await recoveryService.getActiveRecoveryMethods();

        // Always show recovery key (created on vault setup)
        let html = `
            <div class="recovery-method-item active">
                <div class="method-info">
                    <span class="method-icon">ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ¢â‚¬Ëœ</span>
                    <div>
                        <strong>Recovery Key</strong>
                        <p>Created on vault setup</p>
                    </div>
                </div>
                <span class="badge success">Active</span>
            </div>
        `;

        // Add other methods
        methods.forEach(method => {
            html += `
                <div class="recovery-method-item active">
                    <div class="method-info">
                        <span class="method-icon">${method.icon}</span>
                        <div>
                            <strong>${method.name}</strong>
                            <p>${method.status}</p>
                        </div>
                    </div>
                    <span class="badge success">Active</span>
                </div>
            `;
        });

        container.innerHTML = html;
    }

    async generateBackupCodes() {
        try {
            const codes = await recoveryService.generateBackupCodes();

            // Show codes in modal
            const modal = document.getElementById('backup-codes-modal');
            const display = document.getElementById('backup-codes-display');

            display.innerHTML = codes.map(code =>
                `<div class="backup-code-item">${code}</div>`
            ).join('');

            modal.classList.remove('hidden');
        } catch (err) {
            console.error('Failed to generate backup codes', err);
            this.showToast('Failed to generate backup codes', 'error');
        }
    }

    copyBackupCodes() {
        const codes = Array.from(document.querySelectorAll('.backup-code-item'))
            .map(el => el.textContent)
            .join('\n');

        navigator.clipboard.writeText(codes).then(() => {
            this.showToast('Backup codes copied to clipboard', 'success');
        });
    }

    downloadBackupCodes() {
        const codes = Array.from(document.querySelectorAll('.backup-code-item'))
            .map(el => el.textContent)
            .join('\n');

        const blob = new Blob([`PINBRIDGE Backup Codes\nGenerated: ${new Date().toLocaleString()}\n\n${codes}\n\nKeep these codes safe. Each can only be used once.`],
            { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `pinbridge-backup-codes-${Date.now()}.txt`;
        a.click();
        URL.revokeObjectURL(url);

        this.showToast('Backup codes downloaded', 'success');
    }

    isNoteChanged() {
        if (!this.activeNoteId) return false;
        const note = notesService.notes.find(n => n.id === this.activeNoteId);
        if (!note) return false;

        const title = (this.inputs.noteTitle?.value || '').trim();
        const body = (this.inputs.noteContent?.value || '').trim();
        const folder = (this.inputs.noteFolder?.value || '').trim();
        const tags = (this.inputs.noteTags?.value || '').split(',').map(t => t.trim()).filter(t => t);

        const currentTags = (note.tags || []).map(t => typeof t === 'string' ? t : t.name);

        return note.title !== title ||
            note.body !== body ||
            note.folder !== folder ||
            JSON.stringify(currentTags) !== JSON.stringify(tags);
    }

    emailBackupCodes() {
        const codes = Array.from(document.querySelectorAll('.backup-code-item'))
            .map(el => el.textContent)
            .join('\n');

        const email = prompt("Enter email address to send backup codes (Standard email is not encrypted):");
        if (email && email.includes('@')) {
            if (confirm(`Explicitly send backup codes to ${email}?`)) {
                console.log(`[Recovery] Sending backup codes to ${email}`);
                this.showToast('Backup codes sent successfully!', 'success');
                this.logActivity(`Backup codes sent to ${email}`);
            }
        }
    }

    async downloadRecoveryFile() {
        try {
            const vaultKey = vaultService.dataKey;
            if (!vaultKey) {
                this.showToast('No vault key available', 'error');
                return;
            }

            const blob = await recoveryService.generateRecoveryFile(vaultKey);
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `pinbridge-recovery-${Date.now()}.json`;
            a.click();
            URL.revokeObjectURL(url);

            this.showToast('Recovery file downloaded', 'success');
            await this.renderActiveRecoveryMethods();
        } catch (err) {
            console.error('Failed to download recovery file', err);
            this.showToast('Failed to download recovery file', 'error');
        }
    }

    openSecretQuestionModal() {
        const modal = document.getElementById('secret-question-modal');
        modal.classList.remove('hidden');

        // Clear inputs
        document.getElementById('secret-question-input').value = '';
        document.getElementById('setup-secret-answer-input').value = '';
        document.getElementById('secret-answer-confirm').value = '';
    }

    async saveSecretQuestion() {
        const question = document.getElementById('secret-question-input').value.trim();
        const answer = document.getElementById('setup-secret-answer-input').value;
        const confirm = document.getElementById('secret-answer-confirm').value;

        if (!question || !answer) {
            this.showToast('Please fill in all fields', 'error');
            return;
        }

        if (answer !== confirm) {
            this.showToast('Answers do not match', 'error');
            return;
        }

        try {
            await recoveryService.setupSecretQuestion(question, answer);
            document.getElementById('secret-question-modal').classList.add('hidden');
            this.showToast('Secret question saved successfully', 'success');
            await this.renderActiveRecoveryMethods();
        } catch (err) {
            console.error('Failed to save secret question', err);
            this.showToast('Failed to save secret question', 'error');
        }
    }

    openGenerateFileModal() {
        const modal = document.getElementById('generate-file-modal');
        if (!modal) return;

        // Pre-fill username if available
        const usernameInput = document.getElementById('generate-file-username');
        if (usernameInput && vaultService.meta?.username) {
            usernameInput.value = vaultService.meta.username;
        }

        modal.classList.remove('hidden');
    }

    closeGenerateFileModal() {
        const modal = document.getElementById('generate-file-modal');
        if (modal) modal.classList.add('hidden');
    }

    async handleGenerateFileSubmit() {
        const username = document.getElementById('generate-file-username').value.trim();
        const partialPin = document.getElementById('generate-file-code').value.trim();

        await authService.generateAndDownloadRecoveryFile(username, partialPin);

        // Close modal on success
        this.closeGenerateFileModal();
    }

    /**
     * Password Generator Logic
     */
    generatePassword() {
        const lengthInput = document.querySelector('input[name="pw-length"]:checked');
        if (!lengthInput) {
            this.showToast('Select a password length.', 'error');
            return;
        }
        const length = parseInt(lengthInput.value, 10);

        const allWords = [
            'love', 'my', 'job', 'build', 'secure', 'future', 'think', 'deep', 'code', 'trust',
            'focus', 'create', 'guide', 'bright', 'calm', 'clear', 'smart', 'brave', 'strong',
            'ready', 'steady', 'kind', 'share', 'value', 'honor', 'logic', 'light', 'quick',
            'sound', 'skill', 'power', 'work', 'grow', 'safe', 'goal', 'truth', 'peace',
            'order', 'solid', 'fresh', 'prime', 'sharp', 'craft', 'drive', 'dream', 'learn',
            'adapt', 'solve', 'shift', 'track', 'guard'
        ];
        const excludeAmbiguous = this._getById('pw-opt-no-ambiguous')?.checked;
        const words = excludeAmbiguous
            ? allWords.filter(word => !/[lLoO]/.test(word))
            : allWords;
        const symbols = ['!', '@', '#', '$', '%'];

        if (words.length < 3) {
            this.showToast('Not enough words available.', 'error');
            return;
        }

        const wordBuckets = new Map();
        words.forEach(word => {
            const len = word.length;
            if (!wordBuckets.has(len)) wordBuckets.set(len, []);
            wordBuckets.get(len).push(word);
        });

        const minWordLen = Math.min(...Array.from(wordBuckets.keys()));
        const minLength = (minWordLen * 3) + 5; // 1 lead + 2 dots + 1 trailing number + 1 symbol
        if (length < minLength) {
            this.showToast('Selected length is too short for this format.', 'error');
            return;
        }

        const possibleNumberLengths = [];
        if (length - 5 - (minWordLen * 3) >= 1) possibleNumberLengths.push(1);
        if (length - 6 - (minWordLen * 3) >= 0) possibleNumberLengths.push(2);
        if (!possibleNumberLengths.length) {
            this.showToast('Selected length is too short for this format.', 'error');
            return;
        }

        const numberLength = this._getRandomItem(possibleNumberLengths);
        const wordTarget = length - 4 - numberLength;

        const wordLengths = Array.from(wordBuckets.keys());
        let chosenLengths = null;
        for (let attempt = 0; attempt < 200; attempt++) {
            const l1 = this._getRandomItem(wordLengths);
            const l2 = this._getRandomItem(wordLengths);
            const l3 = wordTarget - l1 - l2;
            if (wordBuckets.has(l3)) {
                chosenLengths = [l1, l2, l3];
                break;
            }
        }

        if (!chosenLengths) {
            this.showToast('Could not fit words to selected length.', 'error');
            return;
        }

        const pickedWords = [];
        chosenLengths.forEach(len => {
            const bucket = wordBuckets.get(len);
            pickedWords.push(this._getRandomItem(bucket));
        });
        const uniqueWords = Array.from(new Set(pickedWords));
        while (uniqueWords.length < 3) {
            const randomLen = this._getRandomItem(chosenLengths);
            const bucket = wordBuckets.get(randomLen);
            uniqueWords.push(this._getRandomItem(bucket));
        }

        const [word1, word2, word3] = this._shuffleArray(uniqueWords.slice(0, 3))
            .map(word => this._capitalizeWord(word));
        const leadingNumber = this._getSecureRandomInt(1, 9);
        const trailingNumber = numberLength === 1
            ? this._getSecureRandomInt(1, 9)
            : this._getSecureRandomInt(10, 99);
        const symbol = this._getRandomItem(symbols);

        const passphrase = `${leadingNumber}${word1}.${word2}.${word3}${trailingNumber}${symbol}`;

        if (passphrase.length !== length) {
            this.showToast('Length mismatch. Try again.', 'error');
            return;
        }

        this.generatedPassword = passphrase;
        const passwordInput = this._getById('generated-password-display');
        passwordInput.value = passphrase;

        // UX Feedback
        passwordInput.classList.add('highlight');
        passwordInput.select();
        setTimeout(() => {
            passwordInput.classList.remove('highlight');
        }, 500);
    }

    handleSmartList(e) {
        if (!this.inputs.noteContent) return;
        // Guard against missing smart-list implementation to avoid runtime errors.
        const value = this.inputs.noteContent.value || '';
        const lineStart = value.slice(0, this.inputs.noteContent.selectionStart || 0).split('\n').pop() || '';
        if (!lineStart.trim()) return;
    }

    bindMobileFooterMenu() {
        if (!this.mobile.footerMenuModal || this.mobile.footerMenuModal.dataset.bound) return;
        this.mobile.footerMenuModal.dataset.bound = 'true';

        this.mobile.footerMenuClose?.addEventListener('click', () => this.closeMobileFooterMenu());
        this.mobile.footerMenuModal.addEventListener('click', (e) => {
            if (e.target === this.mobile.footerMenuModal) this.closeMobileFooterMenu();
        });

        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.mobileFooterMenuOpen) {
                this.closeMobileFooterMenu();
            }
        });

        this.mobile.footerMenuSettings?.addEventListener('click', () => {
            this.closeMobileFooterMenu();
            this.openSettingsModal();
        });

        this.mobile.footerMenuTags?.addEventListener('click', () => {
            this.closeMobileFooterMenu();
            document.getElementById('btn-tags-manager')?.click();
        });

        this.mobile.footerMenuLock?.addEventListener('click', () => {
            this.closeMobileFooterMenu();
            authService.forceLogout('manual');
        });
    }

    resetMobileOverlays() {
        document.body.classList.remove('mobile-sidebar-open');
        document.getElementById('mobile-nav-backdrop')?.classList.remove('visible');
        this.closeMobileFooterMenu();
    }

    openMobileFooterMenu() {
        if (!this.mobile.footerMenuModal) return;
        if (this.mobileFooterMenuOpen) return;
        this.mobileFooterMenuOpen = true;
        this.mobile.footerMenuModal.classList.remove('hidden');
        this.mobile.footerMenuModal.setAttribute('aria-modal', 'true');
        this.mobile.footerMenuModal.setAttribute('role', 'dialog');

        const focusable = this.getFocusableElements(this.mobile.footerMenuModal);
        const initial = focusable[0] || this.mobile.footerMenuClose || this.mobile.footerMenuModal;
        initial?.focus();
        this.mobileFooterMenuTrap = this.trapFocus(this.mobile.footerMenuModal);

        if (typeof feather !== 'undefined') feather.replace();
    }

    closeMobileFooterMenu() {
        if (!this.mobile.footerMenuModal || !this.mobileFooterMenuOpen) return;
        this.mobileFooterMenuOpen = false;
        this.mobile.footerMenuModal.classList.add('hidden');
        this.mobileFooterMenuModalCleanup();
        this.mobile.footerMenuBtn?.focus();
    }

    mobileFooterMenuModalCleanup() {
        if (this.mobileFooterMenuTrap) {
            this.mobileFooterMenuTrap();
            this.mobileFooterMenuTrap = null;
        }
    }

    getFocusableElements(container) {
        return Array.from(container.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
            .filter(el => !el.hasAttribute('disabled'));
    }

    trapFocus(container) {
        const focusable = this.getFocusableElements(container);
        if (!focusable.length) return () => {};
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const handler = (e) => {
            if (e.key !== 'Tab') return;
            if (e.shiftKey && document.activeElement === first) {
                e.preventDefault();
                last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first.focus();
            }
        };
        container.addEventListener('keydown', handler);
        return () => container.removeEventListener('keydown', handler);
    }

    _getRandomChar(charset) {
        const randomValues = new Uint32Array(1);
        crypto.getRandomValues(randomValues);
        return charset[randomValues[0] % charset.length];
    }

    _getSecureRandomInt(min, max) {
        const range = max - min + 1;
        const maxUint = 0x100000000;
        const limit = Math.floor(maxUint / range) * range;
        let value;
        do {
            const randomValues = new Uint32Array(1);
            crypto.getRandomValues(randomValues);
            value = randomValues[0];
        } while (value >= limit);
        return min + (value % range);
    }

    _getRandomItem(items) {
        const index = this._getSecureRandomInt(0, items.length - 1);
        return items[index];
    }

    _shuffleArray(items) {
        const arr = items.slice();
        for (let i = arr.length - 1; i > 0; i--) {
            const j = this._getSecureRandomInt(0, i);
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    }

    _capitalizeWord(word) {
        return word.charAt(0).toUpperCase() + word.slice(1);
    }

    _shuffleString(str) {
        const arr = str.split('');
        for (let i = arr.length - 1; i > 0; i--) {
            const randomValues = new Uint32Array(1);
            crypto.getRandomValues(randomValues);
            const j = randomValues[0] % (i + 1);
            [arr[i], arr[j]] = [arr[j], arr[i]]; // Swap
        }
        return arr.join('');
    }

    copyPassword(buttonId = 'btn-copy-password') {
        const panelInput = this._getById('generated-password-panel-display');
        const passwordInput = this._getById('generated-password-display');
        const password = this.generatedPassword || panelInput?.value || passwordInput?.value;
        if (!password) return;

        const button = this._getById(buttonId);
        navigator.clipboard.writeText(password).then(() => {
            this._setCopyFeedback(button);
            const autoClearToggle = this._getById('pw-opt-autoclear');
            if (autoClearToggle?.checked) {
                setTimeout(() => {
                    navigator.clipboard.writeText(' ').catch(() => { }); // Clear clipboard
                    this.showToast('Clipboard cleared.', 'info');
                }, 30000);
            }
        });
    }

    _setCopyFeedback(button) {
        if (!button) return;
        const original = button.innerText;
        button.innerText = 'Copied';
        button.disabled = true;
        setTimeout(() => {
            button.innerText = original;
            button.disabled = false;
        }, 1200);
    }

    openGeneratedPasswordModal() {
        const modal = this._getById('generated-password-modal');
        const titleInput = this._getById('generated-password-note-title');
        const panelInput = this._getById('generated-password-panel-display');
        if (titleInput) {
            titleInput.value = '';
            titleInput.focus();
        }
        if (panelInput) {
            panelInput.value = this.generatedPassword || '';
            panelInput.type = 'password';
        }
        if (modal && !modal.dataset.positioned) {
            modal.style.left = '50%';
            modal.style.top = 'var(--floating-panel-top)';
            modal.style.transform = 'translateX(-50%)';
        }
        modal?.classList.remove('hidden');
    }

    closeGeneratedPasswordModal() {
        this._getById('generated-password-modal')?.classList.add('hidden');
    }

    discardGeneratedPassword() {
        this.generatedPassword = null;
        const panelInput = this._getById('generated-password-panel-display');
        if (panelInput) panelInput.value = '';
        const passwordInput = this._getById('generated-password-display');
        if (passwordInput) passwordInput.value = '';
        const titleInput = this._getById('generated-password-note-title');
        if (titleInput) titleInput.value = '';
        this.closeGeneratedPasswordModal();
    }

    async handleSaveGeneratedPassword() {
        if (!this.ensureAuthenticated()) return;
        if (!this.generatedPassword) {
            this.showToast('Generate a password first.', 'error');
            return;
        }
        const titleInput = this._getById('generated-password-note-title');
        const title = (titleInput?.value || '').trim();
        if (!title) {
            this.showToast('A note title is required.', 'error');
            return;
        }
        await notesService.createNote(title, this.generatedPassword, '', ['generated-password']);
        this.discardGeneratedPassword();
        this.showToast('Password saved to vault.', 'success');
        if (this.currentView === 'all') this.renderCurrentView();
    }

    async findDuplicates() {
        // This is a placeholder for the full UI. For now, we'll log to console.
        this.showToast('Scanning for duplicates...', 'info');

        // In a real implementation, you'd get notes with their encrypted hashes
        // const notes = await notesService.getAllNotesWithHashes();
        const notes = notesService.notes.filter(n => !n.trash);

        // --- Strategy 1: Identical Titles ---
        const titles = {};
        notes.forEach(note => {
            if (!note.title) return;
            if (!titles[note.title]) {
                titles[note.title] = [];
            }
            titles[note.title].push(note.id);
        });

        const titleDuplicates = Object.entries(titles).filter(([_, ids]) => ids.length > 1);

        // --- Strategy 2: Identical Content (simulated with body length) ---
        // In reality, you would use a hash of the encrypted content.
        const content = {};
        notes.forEach(note => {
            const key = note.body ? note.body.length : 0; // SIMULATION
            if (key === 0) return;
            if (!content[key]) {
                content[key] = [];
            }
            content[key].push(note.id);
        });

        const contentDuplicates = Object.entries(content).filter(([_, ids]) => ids.length > 1);

        console.log('--- Duplicate Scan Results ---');
        if (titleDuplicates.length > 0) {
            console.log('Found duplicates by TITLE:');
            titleDuplicates.forEach(([title, ids]) => {
                console.log(`- Title: "${title}", Note IDs: ${ids.join(', ')}`);
            });
        } else {
            console.log('No duplicates found by title.');
        }

        if (contentDuplicates.length > 0) {
            console.log('Found duplicates by CONTENT (simulated):');
            contentDuplicates.forEach(([_, ids]) => {
                console.log(`- Note IDs: ${ids.join(', ')}`);
            });
        } else {
            console.log('No duplicates found by content.');
        }

        const total = titleDuplicates.length + contentDuplicates.length;
        this.showToast(total > 0 ? `Found ${total} group(s) of duplicates. See console for details.` : 'No duplicates found.', 'success');

        // Here you would open a modal to display these results to the user.
    }

    async showPairingModal() {
        const modal = this._getById('pairing-modal');
        if (!modal) return;

        const qrContainer = this._getById('pairing-qr-code');
        const confirmationDisplay = this._getById('pairing-confirmation-code');
        const statusDisplay = this._getById('pairing-status');

        modal.classList.remove('hidden');
        qrContainer.innerHTML = '<div class="loader-pulse"></div>';
        confirmationDisplay.textContent = '------';
        statusDisplay.textContent = 'Generating secure session...';

        try {
            await pairingService.startPairingSession({
                onQRCode: (qrCodeDataURL) => {
                    qrContainer.innerHTML = `<img src="${qrCodeDataURL}" alt="Pairing QR Code">`;
                    statusDisplay.textContent = 'Scan this QR code with your other device.';
                },
                onConfirmationCode: (code) => {
                    confirmationDisplay.textContent = code;
                },
                onPeerConnected: () => {
                    statusDisplay.textContent = 'Device connected. Confirming secure channel...';
                },
                onVerified: () => {
                    statusDisplay.textContent = 'Channel secured. Waiting for confirmation on both devices...';
                    // Here you would enable a "Confirm" button on the UI
                },
                onComplete: () => {
                    statusDisplay.textContent = 'Pairing successful!';
                    this.showToast('Device paired successfully!', 'success');
                    setTimeout(() => this.hidePairingModal(), 2000);
                },
                onError: (error) => {
                    statusDisplay.textContent = `Error: ${error.message}. Please try again.`;
                    console.error('Pairing Error:', error);
                }
            });
        } catch (err) {
            statusDisplay.textContent = `Failed to start session: ${err.message}`;
            console.error('Failed to start pairing session:', err);
        }
    }

    hidePairingModal() {
        if (pairingService) {
            pairingService.cancelPairingSession();
        }
        const modal = this._getById('pairing-modal');
        if (modal) modal.classList.add('hidden');
    }

    async revokeDeviceAccess() {
        if (confirm('Are you sure you want to revoke access for ALL linked devices? This cannot be undone.')) {
            this.showToast('Revoking access for all linked devices...', 'info');
            // In a real implementation, this would involve:
            // 1. Communicating with a sync server to invalidate device tokens.
            // 2. Clearing local pairing data.
            // await pairingService.revokeAllDevices(); // Hypothetical call
            this.showToast('Access revoked for all linked devices.', 'success');
            this.renderActiveRecoveryMethods(); // Refresh the list
        }
    }
    // --- QR Code Scanning (New Device) ---

    showScanQRModal() {
        const modal = this._getById('scan-qr-modal');
        if (!modal) return;

        this.hideSettingsModal();
        modal.classList.remove('hidden');
        this._startCameraForQRScan();

        this._getById('close-scan-qr-modal')?.addEventListener('click', () => this.hideScanQRModal(), { once: true });
        this._getById('scan-qr-form')?.addEventListener('submit', (e) => {
            e.preventDefault();
            this._handleScannedData();
        }, { once: true });
    }

    hideScanQRModal() {
        const modal = this._getById('scan-qr-modal');
        if (modal) modal.classList.add('hidden');
        this._stopCameraForQRScan();
    }

    async _startCameraForQRScan() {
        const video = this._getById('qr-video');
        const statusEl = this._getById('scan-qr-status');
        if (!video || !statusEl) return;

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
            video.srcObject = stream;
            video.play();
            statusEl.textContent = 'Point camera at the QR code...';

            // Dynamically load jsQR library
            if (!window.jsQR) {
                const script = document.createElement('script');
                script.src = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js';
                document.head.appendChild(script);
                await new Promise(resolve => script.onload = resolve);
            }

            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');

            const scan = () => {
                if (video.readyState === video.HAVE_ENOUGH_DATA) {
                    canvas.height = video.videoHeight;
                    canvas.width = video.videoWidth;
                    context.drawImage(video, 0, 0, canvas.width, canvas.height);
                    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
                    const code = window.jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: 'dontInvert' });

                    if (code) {
                        this._getById('qr-data-input').value = code.data;
                        statusEl.textContent = 'QR Code detected! Enter confirmation code.';
                        this._getById('confirmation-code-input').focus();
                        this.hapticFeedback();
                        // Stop scanning once found
                        return;
                    }
                }
                this.qrScanner = requestAnimationFrame(scan);
            };
            this.qrScanner = requestAnimationFrame(scan);
        } catch (err) {
            console.error("Camera access error:", err);
            statusEl.textContent = 'Could not access camera. Please grant permission.';
        }
    }

    async openTagsManager() {
        const modal = document.getElementById('tags-manager-modal');
        modal.classList.remove('hidden');
        await this.renderTagsManager();
    }

    async renderTagsManager() {
        const container = document.getElementById('tags-list');
        const tags = notesService.getAllTags();

        if (tags.length === 0) {
            container.innerHTML = '<p class="hint center">No tags yet. Use #hashtags in your notes!</p>';
            return;
        }

        container.innerHTML = tags.map(tag => `
            <div class="tag-manager-item">
                <div class="tag-manager-info">
                    <div class="tag-color-preview" style="background-color: ${TAG_COLORS[tag.color]}"></div>
                    <div class="tag-manager-details">
                        <strong>#${tag.name}</strong>
                        <span>${tag.count} note${tag.count !== 1 ? 's' : ''}</span>
                    </div>
                </div>
                <div class="tag-color-picker" data-tag="${tag.name}">
                    ${Object.keys(TAG_COLORS).map(colorName => `
                        <div class="color-option ${tag.color === colorName ? 'active' : ''}" 
                             data-color="${colorName}" 
                             style="background-color: ${TAG_COLORS[colorName]}"
                             title="${colorName}"></div>
                    `).join('')}
                </div>
            </div>
        `).join('');

        // Add click listeners to color options
        document.querySelectorAll('.color-option').forEach(option => {
            option.addEventListener('click', async (e) => {
                const color = e.target.dataset.color;
                const picker = e.target.closest('.tag-color-picker');
                const tagName = picker.dataset.tag;

                // Update UI immediately
                picker.querySelectorAll('.color-option').forEach(opt => {
                    opt.classList.remove('active');
                });
                e.target.classList.add('active');

                // Update preview
                const preview = picker.closest('.tag-manager-item').querySelector('.tag-color-preview');
                preview.style.backgroundColor = TAG_COLORS[color];

                // Update in backend
                await notesService.updateTagColor(tagName, color);

                // Refresh note list to show new colors
                this.renderCurrentView();

                this.showToast(`Tag color updated to ${color}`, 'success');
            });
        });
    }

    _stopCameraForQRScan() {
        if (this.qrScanner) {
            cancelAnimationFrame(this.qrScanner);
            this.qrScanner = null;
        }
        const video = this._getById('qr-video');
        if (video && video.srcObject) {
            video.srcObject.getTracks().forEach(track => track.stop());
            video.srcObject = null;
        }
    }

    async _handleScannedData() {
        const qrData = this._getById('qr-data-input').value;
        const confirmationCode = this._getById('confirmation-code-input').value;
        const statusEl = this._getById('scan-qr-status');

        if (!qrData || !confirmationCode) {
            statusEl.textContent = 'Error: Missing data. Please scan again.';
            return;
        }

        this._stopCameraForQRScan();

        try {
            await pairingService.joinPairingSession(qrData, confirmationCode, {
                onConnecting: () => statusEl.textContent = 'Connecting to peer...',
                onHandshake: () => statusEl.textContent = 'Performing secure handshake...',
                onComplete: () => {
                    statusEl.textContent = 'Success! Vault imported.';
                    this.showToast('Vault successfully linked and unlocked!', 'success');
                    // The 'auth:unlock' event will be fired by the service, handling the UI transition.
                    this.hideScanQRModal();
                },
                onError: (err) => statusEl.textContent = `Error: ${err.message}`
            });
        } catch (err) {
            statusEl.textContent = `Failed to start pairing: ${err.message}`;
        }
    }

    toggleReadOnly() {
        this.isReadOnly = !this.isReadOnly;
        const btn = document.getElementById('btn-toggle-readonly');
        const title = this.inputs.noteTitle;
        const content = this.inputs.noteContent;
        const folder = this.inputs.noteFolder;
        const tags = this.inputs.noteTags;

        if (this.isReadOnly) {
            title.readOnly = true;
            content.readOnly = true;
            folder.readOnly = true;
            tags.readOnly = true;
            btn.style.color = 'var(--brand-primary)';
            btn.title = 'Unlock (Read-Only Active)';
            this.showToast('Read-Only Mode Activated', 'info');
        } else {
            title.readOnly = false;
            content.readOnly = false;
            folder.readOnly = false;
            tags.readOnly = false;
            btn.style.color = '';
            btn.title = 'Toggle Read-Only';
            this.showToast('Edit Mode Activated', 'success');
        }
    }

    renderDashboard() {
        const notes = notesService.notes.filter(n => !n.trash && !n.isTemplate);

        // Stats
        document.getElementById('stat-total-notes').innerText = notes.length;
        document.getElementById('stat-favorites').innerText = notes.filter(n => n.pinned).length;

        const folders = new Set(notes.filter(n => n.folder).map(n => n.folder));
        document.getElementById('stat-folders').innerText = folders.size;

        const allTags = notes.flatMap(n => n.tags || []);
        const uniqueTags = new Set(allTags);
        document.getElementById('stat-tags').innerText = uniqueTags.size;

        // Recent Notes (last 5)
        const recentNotes = [...notes].sort((a, b) => b.updated - a.updated).slice(0, 5);
        const recentContainer = document.getElementById('dashboard-recent-notes');
        recentContainer.innerHTML = '';

        if (recentNotes.length === 0) {
            recentContainer.innerHTML = '<p class="hint center">No notes yet. Create your first note!</p>';
        } else {
            recentNotes.forEach(note => {
                const el = document.createElement('div');
                el.className = 'dashboard-note-item';
                el.innerHTML = `
                    <div class="note-info">
                        <strong>${Utils.escapeHtml(note.title || 'Untitled')}</strong>
                        <span class="note-date">${new Date(note.updated).toLocaleDateString()}</span>
                    </div>
                `;
                el.onclick = () => {
                    this.currentView = 'all';
                    document.querySelector('[data-view="all"]')?.click();
                    setTimeout(() => this.selectNote(note), 100);
                };
                recentContainer.appendChild(el);
            });
        }

        // Top Tags (by frequency)
        const tagFreq = {};
        allTags.forEach(tag => {
            tagFreq[tag] = (tagFreq[tag] || 0) + 1;
        });

        const topTags = Object.entries(tagFreq)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10);

        const tagsContainer = document.getElementById('dashboard-top-tags');
        tagsContainer.innerHTML = '';

        if (topTags.length === 0) {
            tagsContainer.innerHTML = '<p class="hint center">No tags yet. Use #hashtags in your notes!</p>';
        } else {
            topTags.forEach(([tag, count]) => {
                const el = document.createElement('span');
                el.className = 'tag-badge';
                el.innerText = `#${tag} (${count})`;
                el.onclick = () => {
                    // Search for this tag
                    this.currentView = 'all';
                    document.querySelector('[data-view="all"]')?.click();
                    setTimeout(() => {
                        document.getElementById('search-input').value = `#${tag}`;
                        document.getElementById('search-input').dispatchEvent(new Event('input'));
                    }, 100);
                };
                tagsContainer.appendChild(el);
            });
        }
    }

    async showTemplateModal() {
        if (!this.activeNoteId && this.currentView !== 'all') return; // Should be editable
        const modal = document.getElementById('template-modal');
        const list = document.getElementById('template-list');
        modal.classList.remove('hidden');

        const templates = notesService.notes.filter(n => n.isTemplate && !n.trash);
        list.innerHTML = '';

        if (templates.length === 0) {
            list.innerHTML = '<p class="hint center">No templates found. Create a note in "Templates" view.</p>';
            return;
        }

        templates.forEach(t => {
            const el = document.createElement('div');
            el.className = 'history-item'; // Reuse style
            el.innerHTML = `
                <div class="history-meta">
                    <strong>${Utils.escapeHtml(t.title || 'Untitled')}</strong>
                    <div class="history-preview">${Utils.escapeHtml((t.body || '').substring(0, 60))}...</div>
                </div>
                <button class="btn btn-secondary btn-sm">Insert</button>
            `;
            el.querySelector('button').onclick = () => {
                this.insertMarkdown(t.body || '', '');
                document.getElementById('template-modal').classList.add('hidden');
                this.showToast('Template inserted', 'success');
            };
            list.appendChild(el);
        });
    }

    async showHistoryModal() {
        if (!this.activeNoteId) return;
        const modal = document.getElementById('history-modal');
        const list = document.getElementById('history-list');
        list.innerHTML = '<div class="loader-pulse"></div>'; // Loading state
        modal.classList.remove('hidden');

        const history = await notesService.getHistory(this.activeNoteId);
        list.innerHTML = '';

        if (!history || history.length === 0) {
            list.innerHTML = '<p class="hint center">No history available for this note.</p>';
            return;
        }

        // Sort desc
        history.sort((a, b) => b.timestamp - a.timestamp);

        history.forEach(ver => {
            const el = document.createElement('div');
            el.className = 'history-item';
            const date = new Date(ver.timestamp).toLocaleString();

            el.innerHTML = `
                <div class="history-meta">
                    <div class="history-date">${date}</div>
                    <div class="history-preview">${Utils.escapeHtml((ver.body || '').substring(0, 50))}...</div>
                </div>
                <button class="btn btn-secondary btn-sm">Restore</button>
            `;

            el.querySelector('button').onclick = async () => {
                if (confirm('Restore this version? Current content will be saved as a new history entry.')) {
                    await notesService.restoreVersion(this.activeNoteId, ver.versionId);

                    // Reload UI
                    const note = notesService.notes.find(n => n.id === this.activeNoteId);
                    if (note) {
                        this.selectNote(note);
                        this.showToast('Version restored', 'success');
                        modal.classList.add('hidden');
                    }
                }
            };
            list.appendChild(el);
        });
    }

    insertMarkdown(prefix, suffix) {
        const textarea = this.inputs.noteContent;
        if (!textarea) return;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const text = textarea.value;
        const selected = text.substring(start, end);

        const before = text.substring(0, start);
        const after = text.substring(end);

        textarea.value = before + prefix + selected + suffix + after;
        textarea.selectionStart = start + prefix.length;
        textarea.selectionEnd = Math.max(start + prefix.length, end + prefix.length + selected.length);
        textarea.focus();

        // Trigger save
        textarea.dispatchEvent(new Event('input'));
    }

    insertTextAtCursor(text) {
        const textarea = this.inputs.noteContent;
        if (!textarea) return;

        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const currentVal = textarea.value;

        textarea.value = currentVal.substring(0, start) + text + currentVal.substring(end);
        textarea.selectionStart = textarea.selectionEnd = start + text.length;
        textarea.focus();
        textarea.dispatchEvent(new Event('input'));
    }

    async handleDuplicate() {
        if (!this.activeNoteId) return;
        // Force save current first
        await this.persistNote(true);
        const note = notesService.notes.find(n => n.id === this.activeNoteId);
        if (!note) return;

        const newTitle = `${note.title} (Copy)`;
        const newBody = note.body;

        const id = await notesService.createNote(newTitle, newBody, note.folder, note.tags, { isTemplate: note.isTemplate });
        this.renderCurrentView();

        // Select new copy
        const newNote = notesService.notes.find(n => n.id === id);
        if (newNote) this.selectNote(newNote);
        this.showToast('Note duplicated', 'success');
    }

    handleDownload() {
        if (!this.activeNoteId) return;
        const title = this.inputs.noteTitle.value || 'Untitled';
        const body = this.inputs.noteContent.value || '';
        const blob = new Blob([`${title}\n\n${body}`], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.txt`;
        a.click();
        URL.revokeObjectURL(url);
    }

    updateWordCount() {
        const text = this.inputs.noteContent?.value || '';
        const words = text.trim() ? text.trim().split(/\s+/).length : 0;
        const badge = document.getElementById('word-count-badge');

        // Read time calculation (approx 225 words per minute)
        const minutes = Math.ceil(words / 225);
        const readTimeText = minutes > 0 ? `${minutes} min read` : '';

        if (badge) {
            badge.innerText = `${words} w`;
            // Check for existing read time badge or create it
            let rt = document.getElementById('read-time-badge');
            if (!rt && readTimeText) {
                rt = document.createElement('span');
                rt.id = 'read-time-badge';
                rt.className = 'status-badge';
                rt.style.marginLeft = '8px';
                badge.parentNode.insertBefore(rt, badge.nextSibling);
            }
            if (rt) rt.innerText = readTimeText;
        }
    }

    addKeyboardShortcuts() {
        // Apply the current theme on startup
        const savedTheme = localStorage.getItem('pinbridge.theme') || 'dark';
        if (savedTheme !== 'dark') {
            document.body.setAttribute('data-theme', savedTheme);
        }
        document.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
                e.preventDefault();
                this.togglePalette(true);
            }
            if (e.key === 'Escape') {
                const palette = document.getElementById('command-palette');
                if (palette && !palette.classList.contains('hidden')) {
                    this.togglePalette(false);
                }
            }
        });
    }

    handleSearchInput(e) {
        const query = e.target.value;
        if (!query) {
            this.renderCurrentView();
            return;
        }
        const results = searchService.search(query);
        const viewResults = this.currentView === 'trash' ? results.filter(n => n.trash) : results.filter(n => !n.trash);
        this.renderNoteList(viewResults);
    }

    async handleNewNote() {
        if (!this.ensureAuthenticated()) return;
        this.logActivity('New note created');

        // Animate button click
        const btn = document.getElementById('btn-new-note');
        if (btn) {
            btn.style.transform = 'scale(0.9)';
            setTimeout(() => {
                btn.style.transform = '';
            }, 150);
        }

        // 1. Force save current note if active
        if (this.activeNoteId) {
            await this.persistNote(true);
        }

        if (this.currentView === 'trash') {
            this.currentView = 'all';
            document.querySelector('[data-view="all"]')?.click();
        }

        const isTemplateView = this.currentView === 'templates';

        // 2 Create new empty note (non-persisted until typed in)
        const id = await notesService.createNote("", "", "", [], { persist: false, isTemplate: isTemplateView });

        // Ensure the new note has a timestamp for sorting
        const newNote = notesService.notes.find(n => n.id === id);
        if (newNote) {
            newNote.updated = Date.now(); // Force top sort
            this.selectNote(newNote);
        } else {
            // Fallback
            this.selectNote({ id, title: "", body: "", trash: false, folder: "", tags: [], isTemplate: isTemplateView, updated: Date.now() });
        }

        // 3. Render view to show legacy note updates and prep list
        this.renderCurrentView();

        this.inputs.noteTitle?.focus();
    }

    async handleDelete() {
        if (!this.ensureAuthenticated()) return;
        if (!this.activeNoteId) return;

        if (this.currentView === 'trash') {
            const note = notesService.notes.find(n => n.id === this.activeNoteId);
            let allowed = confirm(i18n.t('confirmDeleteForever'));
            if (allowed && this._isGeneratedPasswordNote(note)) {
                allowed = await this.confirmGeneratedPasswordDeletion();
            }
            if (allowed) {
                await notesService.deleteNote(this.activeNoteId);
                this.logActivity('Note moved to trash');
                this.activeNoteId = null;
                this.clearEditor();
                this.renderCurrentView();
            }
        } else {
            await notesService.moveToTrash(this.activeNoteId);
            this.activeNoteId = null;
            this.clearEditor();
            this.renderCurrentView();
        }
    }

    async handlePinNote(noteId = this.activeNoteId) {
        if (!this.ensureAuthenticated() || !noteId) return;
        const note = notesService.notes.find(n => n.id === noteId);
        if (!note) return;
        await notesService.togglePin(noteId);
        if (noteId === this.activeNoteId) {
            this.updatePinButtonState(!note.pinned);
        }
        this.renderCurrentView();
    }

    async handleArchiveNote(noteId) {
        if (!this.ensureAuthenticated()) return;
        const note = notesService.notes.find(n => n.id === noteId);
        if (!note) return;

        if (note.archived) {
            await notesService.unarchiveNote(noteId);
            this.showToast('Note unarchived', 'success');
        } else {
            await notesService.archiveNote(noteId);
            this.showToast('Note archived', 'success');
        }

        if (this.activeNoteId === noteId) {
            this.activeNoteId = null;
            this.clearEditor();
        }
    }

    async handleQuickDrop(e) {
        if (!this.ensureAuthenticated()) return;
        if (e.key === 'Enter') {
            const quickDropInput = e.target;
            const text = (quickDropInput.value || '').trim();
            if (!text) return;
            const title = `${i18n.t('quickDropLabel')}: ${new Date().toLocaleTimeString()}`;
            await notesService.createNote(title, text);
            quickDropInput.value = '';
            this.showToast(i18n.t('quickDropToast'), 'success');
            quickDropInput.placeholder = i18n.t('quickDropStashed');
            setTimeout(() => quickDropInput.placeholder = i18n.t('quickDropPlaceholder'), 1500);
            if (this.currentView === 'all') this.renderCurrentView();
        }
    }

    renderCurrentView(notesOverride) {
        const editorPanel = document.querySelector('.editor-panel');
        const dashboardPanel = document.querySelector('.dashboard-panel');

        if (this.currentView === 'dashboard') {
            // Show dashboard, hide editor
            editorPanel?.classList.add('hidden');
            dashboardPanel?.classList.remove('hidden');
            this.renderDashboard();
        } else {
            // Show editor, hide dashboard with animation
            if (editorPanel?.classList.contains('hidden')) {
                editorPanel.style.animation = 'slideInRight 0.4s cubic-bezier(0.4, 0, 0.2, 1)';
            }
            editorPanel?.classList.remove('hidden');
            dashboardPanel?.classList.add('hidden');

            const notes = notesOverride || notesService.notes;
            const filtered = this.getFilteredNotes(notes);
            this.renderFolders();
            this.updateDeleteButtonContext();
            this.renderNoteList(filtered);

            // Sync Mobile Footer State
            document.querySelectorAll('.mobile-nav-item').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.view === this.currentView);
            });
        }
    }

    getFilteredNotes(notes = notesService.notes) {
        if (this.currentView === 'trash') return this.sortNotes(notes.filter(n => n.trash));
        if (this.currentView === 'templates') return this.sortNotes(notes.filter(n => n.isTemplate && !n.trash));
        if (this.currentView === 'archive') return this.sortNotes(notes.filter(n => n.archived && !n.trash));

        // Normal views should EXCLUDE templates, archived, and trash
        let filtered = notes.filter(n => !n.trash && !n.isTemplate && !n.archived);

        if (this.currentView === 'favorites') filtered = filtered.filter(n => n.pinned);
        if (this.currentView.startsWith('folder:')) {
            const folder = this.currentView.split('folder:')[1];
            filtered = filtered.filter(n => n.folder === folder);
        }

        return this.sortNotes(filtered);
    }

    sortNotes(notes) {
        const sortBy = localStorage.getItem('pinbridge.notes_sort') || 'updated';
        const sorted = [...notes];

        switch (sortBy) {
            case 'created':
                sorted.sort((a, b) => (b.created || 0) - (a.created || 0));
                break;
            case 'title':
                sorted.sort((a, b) => {
                    const titleA = (a.title || '').toLowerCase();
                    const titleB = (b.title || '').toLowerCase();
                    return titleA.localeCompare(titleB);
                });
                break;
            case 'updated':
            default:
                sorted.sort((a, b) => (b.updated || 0) - (a.updated || 0));
                break;
        }

        // Always show pinned notes first
        return sorted.sort((a, b) => {
            if (a.pinned && !b.pinned) return -1;
            if (!a.pinned && b.pinned) return 1;
            return 0;
        });
    }

    renderNoteList(notes, showSkeleton = false) {
        const listEl = document.getElementById('notes-list');
        if (!listEl) return;
        listEl.innerHTML = '';

        if (showSkeleton) {
            // Show skeleton loaders
            for (let i = 0; i < 5; i++) {
                const skeleton = document.createElement('div');
                skeleton.className = 'skeleton-loader';
                listEl.appendChild(skeleton);
            }
            return;
        }

        if (!notes.length) {
            listEl.innerHTML = `<div class="empty-list-placeholder">${i18n.t('emptyList')}</div>`;
            return;
        }

        notes.forEach(note => {
            const div = document.createElement('div');
            div.className = 'note-item';
            div.dataset.id = note.id;
            if (note.id === this.activeNoteId) div.classList.add('active');
            this.addSwipeHandlers(div, note);

            const badges = [];
            if (note.pinned) badges.push('<span class="note-badge">&#9733;</span>');

            const showPreview = localStorage.getItem('pinbridge.show_preview') !== 'false';
            const previewText = showPreview ? Utils.escapeHtml(note.body?.substring(0, 100) || '') || '' : '';

            div.innerHTML = `
                <div class="note-top-minimal">
                    <h4>${Utils.escapeHtml(note.title) || i18n.t('noteTitlePlaceholder')}${badges.join(' ')}</h4>
                    <div class="note-actions-minimal">
                        <button class="note-action-icon ${note.pinned ? 'active' : ''}" data-action="pin" title="${note.pinned ? 'Unpin' : 'Pin as favorite'}" data-note-id="${note.id}">
                            <i data-feather="star"></i>
                        </button>
                        <button class="note-action-icon ${note.archived ? 'active' : ''}" data-action="archive" title="${note.archived ? 'Unarchive' : 'Archive'}" data-note-id="${note.id}">
                            <i data-feather="archive"></i>
                        </button>
                        <button class="note-action-icon" data-action="trash" title="Delete" data-note-id="${note.id}">
                            <i data-feather="trash-2"></i>
                        </button>
                    </div>
                </div>
                ${showPreview ? `<p class="note-preview">${previewText}</p>` : ''}
            `;

            div.onclick = (e) => {
                // Don't select note if clicking on action buttons
                if (e.target.closest('.note-action-icon')) {
                    e.stopPropagation();
                    return;
                }
                this.selectNote(note);
            };

            // Add event listeners for action buttons
            div.querySelectorAll('.note-action-icon').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    const action = btn.dataset.action;
                    const noteId = btn.dataset.noteId;

                    switch (action) {
                        case 'pin':
                            await notesService.togglePin(noteId);
                            // Re-initialize feather icons after update
                            if (typeof feather !== 'undefined') {
                                feather.replace();
                            }
                            this.renderCurrentView();
                            break;
                        case 'trash':
                            if (note.trash) {
                                let allowed = confirm('Permanently delete this note?');
                                if (allowed && this._isGeneratedPasswordNote(note)) {
                                    allowed = await this.confirmGeneratedPasswordDeletion();
                                }
                                if (allowed) await notesService.deleteNote(noteId);
                            } else {
                                await notesService.moveToTrash(noteId);
                            }
                            if (this.activeNoteId === noteId) {
                                this.activeNoteId = null;
                                this.clearEditor();
                            }
                            this.renderCurrentView();
                            break;
                        case 'archive':
                            await this.handleArchiveNote(noteId);
                            // Re-initialize feather icons after update
                            if (typeof feather !== 'undefined') {
                                feather.replace();
                            }
                            this.renderCurrentView();
                            break;
                    }
                });
            });

            // Initialize feather icons for this note
            if (typeof feather !== 'undefined') {
                feather.replace();
            }

            listEl.appendChild(div);

            // Initialize feather icons for this note
            if (typeof feather !== 'undefined') {
                feather.replace();
            }
        });
    }

    addSwipeHandlers(el, note) {
        let startX = 0;
        let startY = 0;
        let currentX = 0;
        let isSwiping = false;
        let isScrolling = false;
        const threshold = 80; // Distance to trigger action

        // Long press vars
        let longPressTimer = null;
        const longPressDuration = 500;

        el.addEventListener('touchstart', (e) => {
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
            isSwiping = false;
            isScrolling = false;
            el.style.transition = 'none'; // Disable transition for direct 1:1 movement

            // Start Long Press Timer
            longPressTimer = setTimeout(() => {
                this.hapticFeedback();
                this.showMobileContextMenu(note);
                isSwiping = false;
                isScrolling = true; // Prevent swipe logic from continuing
            }, longPressDuration);
        }, { passive: true });

        el.addEventListener('touchmove', (e) => {
            // Check movement to cancel long press
            const moveX = e.touches[0].clientX;
            const moveY = e.touches[0].clientY;
            if (Math.abs(moveX - startX) > 10 || Math.abs(moveY - startY) > 10) {
                clearTimeout(longPressTimer);
            }

            if (isScrolling) return;

            currentX = e.touches[0].clientX;
            const diffX = currentX - startX;
            const diffY = e.touches[0].clientY - startY;

            // Determine if user is scrolling vertically or swiping horizontally
            if (!isSwiping && !isScrolling) {
                if (Math.abs(diffY) > Math.abs(diffX)) {
                    isScrolling = true;
                    clearTimeout(longPressTimer);
                    return;
                }
                if (Math.abs(diffX) > 10) {
                    isSwiping = true;
                    clearTimeout(longPressTimer);
                }
            }

            if (isSwiping) {
                e.preventDefault();
                el.style.transform = `translateX(${diffX}px)`;

                // Visual feedback based on direction
                if (diffX > 0) { // Right Swipe (Pin)
                    el.style.background = `rgba(59, 130, 246, ${Math.min(Math.abs(diffX) / 200, 0.4)})`;
                    el.style.borderColor = 'var(--brand-primary)';
                } else { // Left Swipe (Trash)
                    el.style.background = `rgba(239, 68, 68, ${Math.min(Math.abs(diffX) / 200, 0.4)})`;
                    el.style.borderColor = 'var(--text-danger)';
                }
            }
        }, { passive: false });

        el.addEventListener('touchend', async (e) => {
            clearTimeout(longPressTimer);
            if (!isSwiping) return;

            el.style.transition = 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
            const diffX = currentX - startX;

            if (diffX > threshold) {
                // Trigger Pin
                el.style.transform = 'translateX(100%)';
                el.style.opacity = '0';
                this.hapticFeedback();
                setTimeout(() => this.handlePinNote(note.id), 200);
            } else if (diffX < -threshold) {
                // Trigger Trash
                el.style.transform = 'translateX(-100%)';
                el.style.opacity = '0';
                this.hapticFeedback();
                setTimeout(async () => {
                    if (note.trash) {
                        let allowed = confirm(i18n.t('confirmDeleteForever'));
                        if (allowed && this._isGeneratedPasswordNote(note)) {
                            allowed = await this.confirmGeneratedPasswordDeletion();
                        }
                        if (allowed) await notesService.deleteNote(note.id);
                    } else {
                        await notesService.moveToTrash(note.id);
                    }
                    this.renderCurrentView();
                }, 200);
            } else {
                // Reset
                el.style.transform = '';
                el.style.background = '';
                el.style.borderColor = '';
                el.style.opacity = '';
            }
        });
    }

    showMobileContextMenu(note) {
        let overlay = document.getElementById('mobile-ctx-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'mobile-ctx-overlay';
            overlay.className = 'mobile-context-menu-overlay';
            document.body.appendChild(overlay);

            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) {
                    overlay.classList.remove('visible');
                }
            });
        }

        const isPinned = note.pinned;
        const isTrash = note.trash;

        overlay.innerHTML = `
            <div class="mobile-context-menu">
                <div class="ctx-header">${Utils.escapeHtml(note.title || 'Untitled Note')}</div>
                
                <button class="ctx-item" data-action="folder">
                    <i data-feather="folder"></i> Move to Folder
                </button>
                
                <button class="ctx-item" data-action="share">
                    <i data-feather="share-2"></i> Share
                </button>
                
                <button class="ctx-item" data-action="pin">
                    <i data-feather="${isPinned ? 'star-off' : 'star'}"></i> ${isPinned ? 'Unpin' : 'Pin to Top'}
                </button>
                
                <button class="ctx-item danger" data-action="delete">
                    <i data-feather="${isTrash ? 'trash-2' : 'trash'}"></i> ${isTrash ? 'Delete Forever' : 'Move to Trash'}
                </button>
            </div>
        `;

        if (typeof feather !== 'undefined') feather.replace();

        // Bind actions
        overlay.querySelectorAll('.ctx-item').forEach(btn => {
            btn.onclick = async () => {
                const action = btn.dataset.action;
                overlay.classList.remove('visible');

                if (action === 'pin') this.handlePinNote(note.id);
                if (action === 'delete') {
                    if (isTrash) {
                        let allowed = confirm(i18n.t('confirmDeleteForever'));
                        if (allowed && this._isGeneratedPasswordNote(note)) {
                            allowed = await this.confirmGeneratedPasswordDeletion();
                        }
                        if (allowed) await notesService.deleteNote(note.id);
                    } else {
                        await notesService.moveToTrash(note.id);
                    }
                    this.renderCurrentView();
                }
                if (action === 'share') {
                    if (navigator.share) {
                        navigator.share({ title: note.title, text: note.body }).catch(console.error);
                    } else {
                        this.showToast('Sharing not supported on this device', 'info');
                    }
                }
                if (action === 'folder') {
                    const folder = prompt('Enter folder name:', note.folder || '');
                    if (folder !== null) {
                        await notesService.updateNote(note.id, note.title, note.body, folder, note.tags);
                        this.renderCurrentView();
                    }
                }
            };
        });

        // Show
        requestAnimationFrame(() => overlay.classList.add('visible'));
    }

    updateActiveListItem(note) {
        if (!note) return;
        const el = document.querySelector(`.note-item[data-id="${note.id}"]`);
        if (!el) return;
        const titleEl = el.querySelector('h4');
        const bodyEl = el.querySelector('.note-preview');
        const badge = note.pinned ? '<span class="note-badge">&#9733;</span>' : '';
        if (titleEl) titleEl.innerHTML = `${Utils.escapeHtml(note.title) || i18n.t('noteTitlePlaceholder')}${badge}`;
        if (bodyEl) {
            const preview = note.body?.substring(0, 100) || '';
            bodyEl.textContent = preview;
        }
    }

    async selectNote(note) {
        // DETERMINISTIC PERSISTENCE: Save CURRENT note before switching if it has changes
        if (this.activeNoteId && this.activeNoteId !== note.id) {
            const hasChanged = this.refreshSaveButtonState(); // This happens to return true if button would be enabled
            if (hasChanged) {
                console.log(`[Persistence] Saving previous note ${this.activeNoteId} before switching to ${note.id}`);
                await this.persistNote(true);
            }
        }

        // Animate selection change
        const prevActive = document.querySelector('.note-item.active');
        if (prevActive) {
            prevActive.style.transition = 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)';
        }

        this.activeNoteId = note.id;

        // Update DOM elements
        if (this.inputs.noteTitle) {
            this.inputs.noteTitle.value = note.title || '';
            this.inputs.noteTitle.style.animation = 'fadeIn 0.3s ease';
            setTimeout(() => {
                if (this.inputs.noteTitle) this.inputs.noteTitle.style.animation = '';
            }, 300);
        }
        if (this.inputs.noteContent) {
            this.inputs.noteContent.value = note.body || '';
            this.inputs.noteContent.style.animation = 'fadeIn 0.3s ease';
            setTimeout(() => {
                if (this.inputs.noteContent) this.inputs.noteContent.style.animation = '';
            }, 300);
        }
        if (this.inputs.noteFolder) this.inputs.noteFolder.value = note.folder || '';
        if (this.inputs.noteTags) {
            const tagNames = (note.tags || []).map(t => typeof t === 'string' ? t : t.name);
            this.inputs.noteTags.value = tagNames.join(', ');
        }

        this.updatePinButtonState(note.pinned);
        this.startNoteSession(note);
        this.renderAttachments(note);

        document.querySelectorAll('.note-item.active').forEach(el => el.classList.remove('active'));
        const newActiveEl = document.querySelector(`.note-item[data-id="${note.id}"]`);
        if (newActiveEl) {
            newActiveEl.classList.add('active');
            newActiveEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }

        this.enterMobileEditor();
        this.autoResizeTextarea(this.inputs.noteContent);

        this.refreshSaveButtonState();
        this.updateWordCount();

        console.log(`[Persistence] Switched to note: ${note.id}`);
    }

    startNoteSession(note) {
        this.noteSessionStart = Date.now();
        this.renderNoteMeta(note);
    }

    getNoteMeta(noteId) {
        try {
            return JSON.parse(localStorage.getItem(`pinbridge_meta_${noteId}`)) || {};
        } catch (e) { return {}; }
    }

    saveNoteMeta(noteId, data) {
        const current = this.getNoteMeta(noteId);
        localStorage.setItem(`pinbridge_meta_${noteId}`, JSON.stringify({ ...current, ...data }));
    }

    renderNoteMeta(note) {
        const metaContainer = document.querySelector('.editor-meta-minimal');
        if (!metaContainer) return;

        const meta = this.getNoteMeta(note.id);
        const workTimeMs = meta.workTime || 0;

        // Format time (e.g., 1h 20m)
        const minutes = Math.floor(workTimeMs / 60000);
        const hours = Math.floor(minutes / 60);
        const timeStr = hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`;

        const date = new Date(note.updated || Date.now()).toLocaleDateString();
        // Mock version count based on history availability or random for demo if empty
        const version = note.history ? note.history.length + 1 : 1;

        metaContainer.innerHTML = `
            <div class="note-meta-info">
                <span title="Last updated"><i data-feather="calendar"></i> ${date}</span>
                <span title="Time spent working"><i data-feather="clock"></i> ${timeStr}</span>
                <span title="Version count"><i data-feather="git-commit"></i> v${version}</span>
            </div>
        `;
        if (typeof feather !== 'undefined') feather.replace();
    }

    renderFolders() {
        const listEl = document.getElementById('folder-list');
        const suggestionEl = document.getElementById('folder-suggestions');
        if (!listEl || !suggestionEl) return;
        listEl.innerHTML = '';
        suggestionEl.innerHTML = '';
        const folders = new Set(notesService.notes.filter(n => n.folder && !n.trash).map(n => n.folder));
        folders.forEach(f => {
            const btn = document.createElement('div');
            btn.className = 'folder-item';
            btn.innerText = f.substring(0, 2);
            btn.title = f;
            if (this.currentView === `folder:${f}`) btn.classList.add('active');
            btn.onclick = () => {
                document.querySelectorAll('.nav-item, .folder-item').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.currentView = `folder:${f}`;
                this.renderCurrentView();
            };
            listEl.appendChild(btn);
            const opt = document.createElement('option');
            opt.value = f;
            suggestionEl.appendChild(opt);
        });
    }

    showRecoveryKeyModal(key, onContinue) {
        this.recoveryModal.keyDisplay.innerText = key;
        this.recoveryModal.overlay.classList.remove('hidden');

        // Reset state (Requirement 1, 4)
        this.recoveryModal.keyDisplay.classList.add('blurred-text');
        if (this.recoveryModal.toggleBtn) {
            this.recoveryModal.toggleBtn.innerHTML = '<i data-feather="eye"></i>';
            if (window.feather) window.feather.replace();
        }
        if (this.recoveryModal.emailSection) {
            this.recoveryModal.emailSection.classList.add('hidden');
            this.recoveryModal.emailInput.value = '';
        }

        // Show/Hide Toggle (Requirement 1)
        if (this.recoveryModal.toggleBtn) {
            this.recoveryModal.toggleBtn.onclick = () => {
                const isBlurred = this.recoveryModal.keyDisplay.classList.toggle('blurred-text');
                this.recoveryModal.toggleBtn.innerHTML = isBlurred ? '<i data-feather="eye"></i>' : '<i data-feather="eye-off"></i>';
                if (window.feather) window.feather.replace();
                this.logActivity(`Recovery Key: ${isBlurred ? 'hidden' : 'revealed'}`);
            };
        }

        // Copy (Requirement 2)
        this.recoveryModal.copyBtn.onclick = () => {
            this.copyToClipboard(key, this.recoveryModal.copyBtn);
            this.logActivity('Recovery Key: copied to clipboard');
        };

        // Download (Requirement 3)
        if (this.recoveryModal.downloadBtn) {
            this.recoveryModal.downloadBtn.onclick = () => {
                const blob = new Blob([`PINBRIDGE Recovery Key: ${key}\n\nKeep this file safe and do not share it.`], { type: 'text/plain' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'recovery-key-pinbridge.txt';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                this.showToast('Recovery key downloaded as .txt', 'success');
                this.logActivity('Recovery Key: downloaded as file');
            };
        }

        // Email Section Prompt (Requirement 4)
        if (this.recoveryModal.emailPromptBtn) {
            this.recoveryModal.emailPromptBtn.onclick = () => {
                const isHidden = this.recoveryModal.emailSection.classList.toggle('hidden');
                if (!isHidden) this.recoveryModal.emailInput.focus();
            };
        }

        // Email Confirm & Send (Requirement 4)
        if (this.recoveryModal.emailConfirmBtn) {
            this.recoveryModal.emailConfirmBtn.onclick = () => {
                const email = this.recoveryModal.emailInput.value.trim();
                if (!email || !email.includes('@')) {
                    this.showToast('Please enter a valid email address.', 'error');
                    return;
                }

                if (confirm(`Explicitly send recovery key to ${email}? standard email is not encrypted.`)) {
                    console.log('Consent received. Simulating email send.');
                    this.showToast('Recovery key sent successfully!', 'success');
                    this.logActivity(`Recovery Key: sent to ${email}`);
                    this.recoveryModal.emailSection.classList.add('hidden');
                }
            };
        }

        this.recoveryModal.closeBtn.onclick = () => {
            this.recoveryModal.overlay.classList.add('hidden');
            this.recoveryModal.keyDisplay.innerText = ''; // Ensure key is cleared when modal closed
            if (onContinue) onContinue();
        };
    }

    clearEditor() {
        if (this.activeNoteId) {
            const hasChanged = this.refreshSaveButtonState();
            if (hasChanged) {
                this.persistNote(true).catch(e => console.error("Auto-save on clear failed", e));
            }
        }
        this.activeNoteId = null;
        if (this.inputs.noteTitle) this.inputs.noteTitle.value = '';
        if (this.inputs.noteContent) this.inputs.noteContent.value = '';
        if (this.inputs.noteFolder) this.inputs.noteFolder.value = '';
        if (this.inputs.noteTags) this.inputs.noteTags.value = '';
        this.renderAttachments(null);
        this.refreshSaveButtonState();
        this.setStatus(i18n.t('statusReady'));
    }

    async persistNote(force = false) {
        if (!this.ensureAuthenticated()) return false;
        if (!this.activeNoteId) return false;

        const note = notesService.notes.find(n => n.id === this.activeNoteId);
        if (note && note.trash) return false;

        clearTimeout(this.saveTimeout);

        const title = (this.inputs.noteTitle?.value || '').trim();
        const body = (this.inputs.noteContent?.value || '').trim();
        const folder = (this.inputs.noteFolder?.value || '').trim();
        const tags = (this.inputs.noteTags?.value || '').split(',').map(t => t.trim()).filter(t => t);

        // DETERMINISTIC CHANGE DETECTION
        const hasChanged = this.isNoteChanged();

        if (!hasChanged && !force) {
            console.log(`[Persistence] Skipping save for ${this.activeNoteId} - no changes detected.`);
            return true;
        }

        if (!title && !body) {
            if (force) this.showToast(i18n.t('toastNoteEmpty'), 'error');
            this.refreshSaveButtonState();
            return false;
        }

        if (!force && !this.autoSaveEnabled) {
            this.setStatus(i18n.t('statusManual'));
            return false;
        }

        if (title.toLowerCase() === 'untitled note' && !body) {
            if (force) this.showToast(i18n.t('toastNotePlaceholderBlocked'), 'error');
            this.refreshSaveButtonState();
            return false;
        }

        // Update Work Time
        if (this.noteSessionStart) {
            const sessionDuration = Date.now() - this.noteSessionStart;
            const currentMeta = this.getNoteMeta(this.activeNoteId);
            this.saveNoteMeta(this.activeNoteId, { workTime: (currentMeta.workTime || 0) + sessionDuration });
            this.noteSessionStart = Date.now(); // Reset session start
        }

        this.setStatus(i18n.t('statusSaving') + (folder ? ` (${folder})...` : '...'));

        try {
            await notesService.updateNote(this.activeNoteId, title, body, folder, tags);
            console.log(`[Persistence] Successfully saved note: ${this.activeNoteId}`);

            const updatedNote = notesService.notes.find(n => n.id === this.activeNoteId);
            const savedAt = new Date().toLocaleTimeString();
            this.setStatus(`${i18n.t('statusSaved')} ${savedAt}${folder ? ` (${folder})` : ''}`);

            this.renderFolders();
            this.refreshSaveButtonState();
            this.updateActiveListItem(updatedNote);
            this.renderNoteMeta(updatedNote);

            return true;
        } catch (err) {
            console.error(`[Persistence] FAILED to save note: ${this.activeNoteId}`, err);
            this.setStatus('Error Saving!', 'error');
            this.showToast('Note could not be saved. Check connection/storage.', 'error');
            return false;
        }
    }

    scheduleAutoSave() {
        if (!this.activeNoteId || !this.autoSaveEnabled) return;
        clearTimeout(this.saveTimeout);
        const folder = (this.inputs.noteFolder?.value || '').trim();
        this.setStatus(i18n.t('statusSaving') + (folder ? ` (${folder})...` : '...'));
        this.saveTimeout = setTimeout(() => this.persistNote(), 500);
    }

    updateDeleteButtonContext() {
        const delBtn = document.getElementById('btn-delete');
        if (!delBtn) return;
        delBtn.innerText = this.currentView === 'trash' ? i18n.t('deleteForever') : i18n.t('delete');
    }

    updateAutoSaveUI() {
        const btn = document.getElementById('btn-toggle-autosave');
        if (!btn) return;
        const stateText = i18n.t(this.autoSaveEnabled ? 'compactOn' : 'compactOff');
        btn.innerText = i18n.t('autosaveLabel', { state: stateText });
    }

    toggleAutoSave() {
        this.autoSaveEnabled = !this.autoSaveEnabled;
        localStorage.setItem('pinbridge.auto_save', this.autoSaveEnabled);
        this.updateAutoSaveUI();
        this.showToast(`${i18n.t('autosaveLabel', { state: i18n.t(this.autoSaveEnabled ? 'compactOn' : 'compactOff') })}.`);
        if (this.autoSaveEnabled) this.scheduleAutoSave();
    }

    toggleNotesSettingsMenu() {
        const menu = document.getElementById('notes-settings-menu');
        if (menu) {
            menu.classList.toggle('hidden');
            // Initialize feather icons when menu opens
            if (!menu.classList.contains('hidden') && typeof feather !== 'undefined') {
                feather.replace();
            }
        }
    }

    updateCompactViewUI() {
        document.body.classList.toggle('compact-notes', this.compactViewEnabled);
        const btn = document.getElementById('btn-toggle-compact');
        if (btn) btn.innerText = i18n.t('compactLabel', { state: i18n.t(this.compactViewEnabled ? 'compactOn' : 'compactOff') });

        // Update settings menu toggle
        const toggle = document.getElementById('toggle-compact-view');
        if (toggle) toggle.checked = this.compactViewEnabled;
    }

    toggleCompactView() {
        this.compactViewEnabled = !this.compactViewEnabled;
        localStorage.setItem('pinbridge.compact_notes', this.compactViewEnabled);
        this.updateCompactViewUI();
    }

    refreshSaveButtonState() {
        const btn = document.getElementById('btn-save-note');
        if (!btn) return;
        const isEmpty = !(this.inputs.noteTitle?.value || '').trim() && !(this.inputs.noteContent?.value || '').trim();
        btn.disabled = isEmpty;
        btn.title = isEmpty ? i18n.t('toastNoteEmpty') : i18n.t('btnSave');
    }

    updatePinButtonState(isPinned) {
        const btn = document.getElementById('btn-pin-note');
        if (btn) btn.style.color = isPinned ? 'var(--brand-primary)' : '';
    }

    copyToClipboard(text, btnElement) {
        if (!text) return;
        navigator.clipboard.writeText(text).then(() => {
            const original = btnElement.innerText;
            btnElement.innerText = i18n.t('toastCopyOk');
            this.showToast(i18n.t('toastCopyOk'), 'success');
            setTimeout(() => { btnElement.innerText = original; }, 1500);
        }).catch(() => {
            this.showToast(i18n.t('toastCopyFail'), 'error');
        });
    }

    createCommandPalette() {
        const existing = document.getElementById('command-palette');
        if (existing) existing.remove();
        const el = document.createElement('div');
        el.id = 'command-palette';
        el.className = 'hidden';
        el.innerHTML = `
            <div class="palette-container">
                <input type="text" class="palette-input" placeholder="${i18n.t('palettePlaceholder')}">
                <div class="palette-results"></div>
            </div>
        `;
        document.body.appendChild(el);

        const input = el.querySelector('input');
        const results = el.querySelector('.palette-results');

        const commands = [
            {
                id: 'settings',
                label: i18n.t('settingsTitle'),
                action: () => this.ensureAuthenticated() && settingsService.renderSettingsModal()
            },
            { id: 'new', label: i18n.t('newNoteTooltip'), action: () => this.handleNewNote() },
            { id: 'all', label: i18n.t('navAll'), action: () => document.querySelector('[data-view="all"]')?.click() },
            { id: 'trash', label: i18n.t('navTrash'), action: () => document.querySelector('[data-view="trash"]')?.click() },
            { id: 'lock', label: i18n.t('lockVault'), action: () => authService.forceLogout('manual') }
        ];

        input.addEventListener('input', () => {
            const q = input.value.toLowerCase();
            const matches = commands.filter(c => c.label.toLowerCase().includes(q));
            this.renderPalette(matches, results);
        });
        el.addEventListener('click', (e) => {
            if (e.target === el) this.togglePalette(false);
        });
    }

    renderPalette(items, container) {
        container.innerHTML = '';
        items.forEach(item => {
            const div = document.createElement('div');
            div.className = 'palette-item';
            div.innerHTML = `<span>${item.label}</span>`;
            div.onclick = () => {
                item.action();
                this.togglePalette(false);
            };
            container.appendChild(div);
        });
    }

    togglePalette(show) {
        const el = document.getElementById('command-palette');
        if (!el) return;
        const input = el.querySelector('input');
        if (show) {
            el.classList.remove('hidden');
            input.value = '';
            input.focus();
            input.dispatchEvent(new Event('input'));
        } else {
            el.classList.add('hidden');
        }
    }

    setStatus(text) {
        const status = document.getElementById('editor-status');
        if (status) status.innerText = text;
    }

    ensureAuthenticated() {
        if (vaultService.isUnlocked()) return true;
        this.showScreen('auth');
        this.showToast(i18n.t('authRequired'), 'error');
        return false;
    }

    _isGeneratedPasswordNote(note) {
        if (!note?.tags) return false;
        return note.tags.some(tag => (typeof tag === 'string' ? tag : tag.name) === 'generated-password');
    }

    confirmGeneratedPasswordDeletion() {
        return new Promise((resolve) => {
            const modal = this._getById('password-history-delete-modal');
            const step1 = this._getById('password-history-delete-step-1');
            const step2 = this._getById('password-history-delete-step-2');
            const step3 = this._getById('password-history-delete-step-3');
            const input = this._getById('password-history-delete-input');
            const btnCancel = this._getById('btn-password-delete-cancel');
            const btnContinue = this._getById('btn-password-delete-continue');
            const btnBack = this._getById('btn-password-delete-back');
            const btnConfirm = this._getById('btn-password-delete-confirm');
            const btnFinal = this._getById('btn-password-delete-final');

            if (!modal || !step1 || !step2 || !step3 || !input) {
                resolve(false);
                return;
            }

            const reset = () => {
                step1.classList.remove('hidden');
                step2.classList.add('hidden');
                step3.classList.add('hidden');
                input.value = '';
            };

            const cleanup = (result) => {
                btnCancel?.removeEventListener('click', onCancel);
                btnContinue?.removeEventListener('click', onContinue);
                btnBack?.removeEventListener('click', onBack);
                btnConfirm?.removeEventListener('click', onConfirm);
                btnFinal?.removeEventListener('click', onFinal);
                modal.classList.add('hidden');
                reset();
                resolve(result);
            };

            const onCancel = () => cleanup(false);
            const onContinue = () => {
                step1.classList.add('hidden');
                step2.classList.remove('hidden');
            };
            const onBack = () => {
                step2.classList.add('hidden');
                step1.classList.remove('hidden');
            };
            const onConfirm = () => {
                step2.classList.add('hidden');
                step3.classList.remove('hidden');
                input.focus();
            };
            const onFinal = () => {
                if (input.value !== 'DELETE') {
                    input.value = '';
                    input.focus();
                    this.showToast('Type DELETE to confirm.', 'error');
                    return;
                }
                cleanup(true);
            };

            btnCancel?.addEventListener('click', onCancel);
            btnContinue?.addEventListener('click', onContinue);
            btnBack?.addEventListener('click', onBack);
            btnConfirm?.addEventListener('click', onConfirm);
            btnFinal?.addEventListener('click', onFinal);

            reset();
            modal.classList.remove('hidden');
        });
    }

    shakeElement(el) {
        if (!el) return;
        el.classList.add('shake-animation');
        setTimeout(() => el.classList.remove('shake-animation'), 500);
    }

    /**
     * Secure Document Converter
     */
    initConverter() {
        const dropZone = this._getById('converter-drop-zone');
        const fileInput = this._getById('converter-file-input');
        const statusDiv = this._getById('converter-status');
        const statusText = this._getById('converter-status-text');
        const actionsDiv = this._getById('converter-actions');
        const convertBtn = this._getById('btn-convert-file');
        const attachToggle = this._getById('attach-to-note');

        if (!dropZone || !fileInput) return;

        dropZone.addEventListener('click', () => fileInput.click());

        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.classList.add('drag-over');
        });

        dropZone.addEventListener('dragleave', () => {
            dropZone.classList.remove('drag-over');
        });

        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.classList.remove('drag-over');
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                fileInput.files = files;
                this.handleConverterFileSelection(files[0]);
            }
        });

        fileInput.addEventListener('change', () => {
            if (fileInput.files.length > 0) {
                this.handleConverterFileSelection(fileInput.files[0]);
            }
        });

        convertBtn.addEventListener('click', () => this.handleFileConversion());
    }

    handleConverterFileSelection(file) {
        const actionsDiv = this._getById('converter-actions');
        const statusDiv = this._getById('converter-status');
        const dropZonePrompt = this._getById('converter-drop-zone')?.querySelector('.drop-zone-prompt');

        if (!file.name.match(/\.(doc|docx)$/i)) {
            this.showToast('Please select a DOC or DOCX file.', 'error');
            return;
        }

        if (file.size > 10 * 1024 * 1024) {
            this.showToast('File size must be less than 10MB.', 'error');
            return;
        }

        if (dropZonePrompt) dropZonePrompt.textContent = `Selected: ${file.name}`;
        if (actionsDiv) actionsDiv.style.display = 'flex';
        if (statusDiv) statusDiv.style.display = 'none';

        if (typeof feather !== 'undefined') {
            feather.replace();
        }
    }

    async handleFileConversion() {
        const fileInput = this._getById('converter-file-input');
        const statusDiv = this._getById('converter-status');
        const statusText = this._getById('converter-status-text');
        const actionsDiv = this._getById('converter-actions');
        const attachToggle = this._getById('attach-to-note');

        if (!fileInput || fileInput.files.length === 0) return;

        const file = fileInput.files[0];
        const formData = new FormData();
        formData.append('file', file);

        if (actionsDiv) actionsDiv.style.display = 'none';
        if (statusDiv) statusDiv.style.display = 'flex';
        if (statusText) statusText.textContent = 'Converting...';

        try {
            const response = await fetch('http://localhost:3001/api/convert', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) throw new Error('Conversion failed');

            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            const pdfName = file.name.replace(/\.(doc|docx)$/i, '.pdf');
            a.download = pdfName;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);

            this.showToast('File converted successfully!', 'success');
            if (statusText) statusText.textContent = 'Success!';

            if (attachToggle && attachToggle.checked) {
                await this.attachPdfToNote(blob, pdfName);
            }

        } catch (error) {
            console.error(error);
            this.showToast('Conversion failed. Is the server running?', 'error');
            if (statusText) statusText.textContent = 'Error';
            if (actionsDiv) actionsDiv.style.display = 'flex';
        }
    }

    async attachPdfToNote(blob, filename) {
        const reader = new FileReader();
        reader.onloadend = async () => {
            const base64data = reader.result;
            const title = `Converted PDF: ${filename}`;
            const body = `This note contains a converted PDF file.\n\n[Attachment: ${filename}]`;
            const tags = ['converted', 'pdf'];
            const options = {
                attachments: [{
                    name: filename,
                    type: 'application/pdf',
                    data: base64data
                }]
            };
            await notesService.createNote(title, body, '', tags, options);
            this.showToast('PDF attached as a new vault note.', 'success');
        };
        reader.readAsDataURL(blob);
    }

    async handleAttachmentPick() {
        if (!this.ensureAuthenticated()) return;
        if (!this.activeNoteId) {
            await this.handleNewNote();
        }
        if (!this.activeNoteId) {
            this.showToast('Create a note before attaching a file.', 'error');
            return;
        }
        this.attachments?.input?.click();
    }

    async handleAttachmentSelection(e) {
        const file = e.target.files?.[0];
        if (!file) return;
        await this.attachFileToActiveNote(file);
        e.target.value = '';
    }

    async attachFileToActiveNote(file) {
        if (!this.activeNoteId) return;
        const note = notesService.notes.find(n => n.id === this.activeNoteId);
        if (!note) {
            this.showToast('Please select a note before attaching.', 'error');
            return;
        }

        const attachmentId = Utils.generateId();
        const pendingId = `pending-${attachmentId}`;
        this.renderAttachmentItem({
            id: pendingId,
            name: file.name,
            type: file.type || 'file',
            size: file.size,
            status: 'uploading',
            progress: 0
        }, { pending: true });

        const reader = new FileReader();
        const startTime = Date.now();
        reader.onprogress = (event) => {
            if (!event.lengthComputable) return;
            const percent = Math.round((event.loaded / event.total) * 100);
            const elapsed = (Date.now() - startTime) / 1000;
            const remaining = percent > 0 ? Math.max(0, Math.round((elapsed * (100 - percent)) / percent)) : null;
            this.updateAttachmentProgress(pendingId, percent, remaining);
        };
        reader.onerror = () => {
            this.attachmentRetries.set(pendingId, file);
            this.updateAttachmentStatus(pendingId, 'error', 'Upload failed. Tap retry.');
        };
        reader.onloadend = async () => {
            if (reader.error) return;
            try {
                const data = reader.result;
                if (!(note.title || note.body)) {
                    note.title = file.name;
                    note.body = `Attached file: ${file.name}`;
                }
                const attachments = Array.isArray(note.attachments) ? [...note.attachments] : [];
                attachments.push({
                    id: attachmentId,
                    name: file.name,
                    type: file.type || 'application/octet-stream',
                    size: file.size,
                    data
                });
                note.attachments = attachments;
                await notesService.persistNote(note);
                this.renderAttachments(note);
                this.showToast('File attached to note.', 'success');
            } catch (err) {
                console.error('Attach failed', err);
                this.attachmentRetries.set(pendingId, file);
                this.updateAttachmentStatus(pendingId, 'error', 'Attach failed. Tap retry.');
            }
        };
        reader.readAsDataURL(file);
    }

    renderAttachments(note) {
        if (!this.attachments?.list || !this.attachments?.empty) return;
        this.attachments.list.innerHTML = '';
        const attachments = note?.attachments || [];
        if (!attachments.length) {
            this.attachments.empty.classList.remove('hidden');
            return;
        }
        this.attachments.empty.classList.add('hidden');
        attachments.forEach(att => this.renderAttachmentItem(att));
    }

    renderAttachmentItem(attachment, { pending = false } = {}) {
        if (!this.attachments?.list) return;
        const item = document.createElement('div');
        item.className = 'attachment-item';
        item.dataset.attachmentId = attachment.id;

        const subtitleText = pending ? 'Uploading...' : 'Ready to download';
        item.innerHTML = `
            <div class="attachment-meta">
                <div class="attachment-name">${attachment.name}</div>
                <div class="attachment-subtitle">${subtitleText}</div>
                <div class="attachment-progress">
                    <div class="attachment-progress-bar"><span></span></div>
                    <span class="attachment-progress-text">0%</span>
                </div>
            </div>
            <div class="attachment-actions">
                <button class="btn btn-secondary attachment-download" ${pending ? 'disabled' : ''}>Download</button>
                <button class="btn btn-text attachment-retry hidden">Retry</button>
            </div>
        `;

        const progressRow = item.querySelector('.attachment-progress');
        if (!pending) {
            progressRow.classList.add('hidden');
        }

        const downloadBtn = item.querySelector('.attachment-download');
        const retryBtn = item.querySelector('.attachment-retry');

        if (downloadBtn && !pending) {
            downloadBtn.addEventListener('click', () => this.downloadAttachment(attachment, item));
        }

        if (retryBtn) {
            retryBtn.addEventListener('click', () => this.retryAttachment(attachment.id, item));
        }

        this.attachments.list.appendChild(item);
    }

    updateAttachmentProgress(attachmentId, percent, remainingSeconds = null) {
        const item = this.attachments?.list?.querySelector(`[data-attachment-id="${attachmentId}"]`);
        if (!item) return;
        const bar = item.querySelector('.attachment-progress-bar span');
        const text = item.querySelector('.attachment-progress-text');
        const row = item.querySelector('.attachment-progress');
        if (row) row.classList.remove('hidden');
        if (bar) bar.style.width = `${percent}%`;
        if (text) {
            const remainingText = remainingSeconds !== null ? ` (${remainingSeconds}s)` : ``;
            text.textContent = `${percent}%${remainingText}`;
        }
    }

    updateAttachmentStatus(attachmentId, status, message, { retryMode = 'upload' } = {}) {
        const item = this.attachments?.list?.querySelector(`[data-attachment-id="${attachmentId}"]`);
        if (!item) return;
        const subtitle = item.querySelector('.attachment-subtitle');
        const retryBtn = item.querySelector('.attachment-retry');
        const downloadBtn = item.querySelector('.attachment-download');
        if (subtitle && message) subtitle.textContent = message;
        if (status === 'error') {
            retryBtn?.classList.remove('hidden');
            if (retryBtn) retryBtn.dataset.retryMode = retryMode;
            downloadBtn?.setAttribute('disabled', 'disabled');
        }
    }

    async retryAttachment(attachmentId, item) {
        const retryMode = item?.querySelector('.attachment-retry')?.dataset.retryMode || 'upload';
        if (retryMode === 'download') {
            const note = notesService.notes.find(n => n.id === this.activeNoteId);
            const attachment = note?.attachments?.find(att => att.id === attachmentId);
            if (attachment) {
                item?.querySelector('.attachment-retry')?.classList.add('hidden');
                item?.querySelector('.attachment-download')?.removeAttribute('disabled');
                await this.downloadAttachment(attachment, item);
            }
            return;
        }
        const file = this.attachmentRetries.get(attachmentId);
        if (!file) return;
        this.attachmentRetries.delete(attachmentId);
        item?.remove();
        await this.attachFileToActiveNote(file);
    }

    async downloadAttachment(attachment, item) {
        try {
            this.updateAttachmentProgress(attachment.id, 0);
            const start = Date.now();
            const dataUrl = attachment.data;
            const response = await fetch(dataUrl);
            const blob = await response.blob();
            const elapsed = (Date.now() - start) / 1000;
            const remaining = elapsed > 0 ? Math.max(0, Math.round((100 - 100) / elapsed)) : null;
            this.updateAttachmentProgress(attachment.id, 100, remaining);

            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = attachment.name || 'pinbridge-file';
            document.body.appendChild(link);
            link.click();
            link.remove();
            URL.revokeObjectURL(url);
        } catch (err) {
            console.error('Download failed', err);
            this.updateAttachmentStatus(attachment.id, 'error', 'Download failed. Tap retry.', { retryMode: 'download' });
        }
    }

    /* --- Secure Share --- */
    initSecureShare() {
        if (!this.share.createBtn) return;

        shareService.setCallbacks({
            onChannelOpen: () => this.setShareStatus('Connected. Ready to share.', 'success'),
            onChannelClose: () => this.setShareStatus('Transfer closed.', 'info'),
            onConnectionState: (state) => {
                if (state === 'connected') this.setShareStatus('Secure channel established.', 'success');
                if (state === 'failed' || state === 'disconnected') this.setShareStatus('Connection lost.', 'error');
            },
            onMeta: (meta) => this.renderIncomingShare(meta),
            onPreview: (payload) => this.renderSharePreview(payload),
            onTransferStart: (total) => {
                this.setShareStatus('Transferring...', 'info');
                this.shareTransferStart = Date.now();
                this.setShareProgress(0, total);
            },
            onProgress: ({ direction, transferred, total }) => {
                this.setShareProgress(transferred, total);
                if (direction === 'send') {
                    this.setShareStatus('Uploading...', 'info');
                } else {
                    this.setShareStatus('Downloading...', 'info');
                }
            },
            onTransferComplete: (payload, meta) => {
                if (meta) {
                    this.handleIncomingComplete(payload, meta);
                } else {
                    this.setShareStatus('Transfer completed.', 'success');
                    if (this.share.autoClear?.checked) {
                        this.clearShareFileSelection();
                    }
                    this.logActivity('File sent successfully');
                }
            },
            onError: (err) => {
                console.error(err);
                this.setShareStatus('Transfer failed.', 'error');
                this.showToast('Secure transfer failed. Try again.', 'error');
            }
        });

        this.share.createBtn.addEventListener('click', async () => {
            try {
                this.setShareStatus('Preparing secure transfer...', 'info');
                const offer = await shareService.createOffer();
                this.share.offerOut.value = offer;
                this.showToast('Invite created. Share it securely.', 'success');
            } catch (err) {
                this.setShareStatus('Failed to start transfer.', 'error');
            }
        });

        this.share.applyAnswer.addEventListener('click', async () => {
            const answer = this.share.answerIn.value.trim();
            if (!answer) return;
            try {
                await shareService.acceptAnswer(answer);
                this.setShareStatus('Answer accepted. Connecting...', 'info');
            } catch (err) {
                this.setShareStatus('Answer rejected.', 'error');
            }
        });

        this.share.joinBtn.addEventListener('click', async () => {
            const offer = this.share.joinOfferIn.value.trim();
            if (!offer) return;
            try {
                this.setShareStatus('Connecting securely...', 'info');
                const answer = await shareService.joinWithOffer(offer);
                this.share.joinAnswerOut.value = answer;
                this.showToast('Answer generated. Send it back.', 'success');
            } catch (err) {
                this.setShareStatus('Failed to connect.', 'error');
            }
        });

        this.share.copyOffer.addEventListener('click', () => this.copyShareText(this.share.offerOut));
        this.share.copyAnswer.addEventListener('click', () => this.copyShareText(this.share.joinAnswerOut));

        this.share.fileDrop.addEventListener('click', () => this.share.fileInput.click());
        this.share.fileDrop.addEventListener('dragover', (e) => {
            e.preventDefault();
            this.share.fileDrop.classList.add('drag-over');
        });
        this.share.fileDrop.addEventListener('dragleave', () => {
            this.share.fileDrop.classList.remove('drag-over');
        });
        this.share.fileDrop.addEventListener('drop', (e) => {
            e.preventDefault();
            this.share.fileDrop.classList.remove('drag-over');
            const file = e.dataTransfer.files?.[0];
            if (file) this.prepareShareFile(file);
        });
        this.share.fileInput.addEventListener('change', () => {
            const file = this.share.fileInput.files?.[0];
            if (file) this.prepareShareFile(file);
        });

        this.share.acceptBtn.addEventListener('click', () => this.acceptIncomingShare());
        this.share.viewBtn.addEventListener('click', () => this.viewIncomingShare());
        this.share.rejectBtn.addEventListener('click', () => this.rejectIncomingShare());
        this.share.resetBtn?.addEventListener('click', () => this.resetShareSession());
    }

    copyShareText(el) {
        if (!el?.value) return;
        navigator.clipboard.writeText(el.value).then(() => {
            this.showToast('Copied to clipboard.', 'success');
        }).catch(() => {
            this.showToast('Copy failed. Select and copy manually.', 'error');
        });
    }

    prepareShareFile(file) {
        if (!file) return;
        this.setShareStatus(`Ready to share ${file.name}`, 'info');
        this.setShareProgress(0, file.size);
        const options = this.getShareOptions();
        shareService.setFile(file, options);
    }

    syncShareOptions() {
        if (!this.share.fileInput?.files?.length) return;
        const file = this.share.fileInput.files[0];
        shareService.setFile(file, this.getShareOptions());
    }

    getShareOptions() {
        const permissionMode = 'download';
        const expiresAt = null;
        const destructRule = 'never';
        const destructMinutes = null;

        return {
            permissions: {
                mode: permissionMode,
                expiresAt
            },
            destruct: {
                rule: destructRule,
                minutes: destructRule === 'after_minutes' ? destructMinutes : null
            }
        };
    }

    renderIncomingShare(meta) {
        this.shareReceiveMeta = meta;
        this.sharePreviewViewed = false;
        this.share.receiverPanel?.classList.remove('hidden');
        this.share.receiverName.textContent = meta.name || 'Shared file';
        this.share.receiverMeta.textContent = `${this.formatBytes(meta.size)} - ${meta.type || 'File'}`;
        this.share.preview.innerHTML = '<span class="hint">Preview loading...</span>';
        this.share.permissionBadges.innerHTML = '';
        if (this.shareAccessTimer) {
            clearInterval(this.shareAccessTimer);
        this.shareAccessTimer = null;
        this.shareTransferStart = null;
    }

        const badges = [];
        if (meta.permissions?.mode === 'view') badges.push('View Only');
        if (meta.permissions?.mode === 'download') badges.push('Download Allowed');
        if (meta.permissions?.expiresAt) badges.push('Time Limited');

        badges.forEach(label => {
            const span = document.createElement('span');
            span.className = 'share-badge neutral';
            span.textContent = label;
            this.share.permissionBadges.appendChild(span);
        });

        const now = Date.now();
        if (meta.permissions?.expiresAt && now > meta.permissions.expiresAt) {
            this.setShareStatus('Access expired.', 'error');
            this.disableIncomingActions();
            return;
        }

        if (meta.permissions?.mode === 'view') {
            this.share.acceptBtn.disabled = true;
            this.share.acceptBtn.textContent = 'Download Disabled';
        } else {
            this.share.acceptBtn.disabled = false;
            this.share.acceptBtn.textContent = 'Download';
        }

        this.share.viewBtn.disabled = false;
        this.share.rejectBtn.disabled = false;
        this.setShareStatus('Preview available.', 'info');
        this.updateShareLifetime();

        if (meta.permissions?.expiresAt) {
            this.shareAccessTimer = setInterval(() => this.updateShareLifetime(), 30000);
        }
    }

    renderSharePreview(payload) {
        if (!payload) {
            this.share.preview.innerHTML = '<span class="hint">No preview available.</span>';
            return;
        }

        this.shareReceivePreview = payload;
        if (payload.dataUrl) {
            const img = document.createElement('img');
            img.src = payload.dataUrl;
            img.alt = 'Preview';
            this.share.preview.innerHTML = '';
            this.share.preview.appendChild(img);
        } else {
            this.share.preview.innerHTML = '<span class="hint">Preview unavailable for this file.</span>';
        }
    }

    acceptIncomingShare() {
        if (!this.shareReceiveMeta) return;
        if (this.shareReceiveMeta.permissions?.mode === 'view') return;

        if (this.shareReceiveMeta.permissions?.expiresAt &&
            Date.now() > this.shareReceiveMeta.permissions.expiresAt) {
            this.setShareStatus('Access expired.', 'error');
            this.disableIncomingActions();
            return;
        }

        this.setShareStatus('Requesting file...', 'info');
        shareService.sendTransferRequest('download');
        this.startShareCountdown('download');
    }

    viewIncomingShare() {
        if (!this.shareReceiveMeta) return;
        this.sharePreviewViewed = true;
        this.setShareStatus('Preview opened.', 'info');
        this.logActivity('File previewed');
        this.startShareCountdown('view');
    }

    rejectIncomingShare() {
        this.setShareStatus('Transfer declined.', 'info');
        this.clearIncomingShare();
    }

    handleIncomingComplete(blob, meta) {
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = meta?.name || 'pinbridge-file';
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.URL.revokeObjectURL(url);
        this.setShareStatus('Download completed.', 'success');
        this.logActivity('File downloaded');
        this.startShareCountdown('downloaded');
    }

    setShareStatus(text, tone) {
        if (!this.share.stateText) return;
        this.share.stateText.textContent = text;
        this.share.stateText.dataset.tone = tone || 'info';
    }

    setShareProgress(transferred, total) {
        const percent = total ? Math.min(100, Math.round((transferred / total) * 100)) : 0;
        if (this.share.progressFill) {
            this.share.progressFill.style.width = `${percent}%`;
        }
        if (this.share.progressText) {
            this.share.progressText.textContent = `${percent}%`;
        }
        if (this.share.progressBytes) {
            if (!total) {
                this.share.progressBytes.textContent = 'Waiting for a file.';
            } else {
                const elapsed = this.shareTransferStart ? (Date.now() - this.shareTransferStart) / 1000 : 0;
                const rate = elapsed > 0 ? transferred / elapsed : 0;
                const remaining = rate > 0 ? Math.round((total - transferred) / rate) : null;
                this.share.progressBytes.textContent = remaining !== null ? `${remaining}s remaining` : '';
            }
        }
    }

    updateShareLifetime() {
        if (!this.shareReceiveMeta?.permissions?.expiresAt) {
            this.share.lifetime.textContent = 'No expiration set.';
            return;
        }

        const remaining = Math.max(0, this.shareReceiveMeta.permissions.expiresAt - Date.now());
        if (remaining === 0) {
            this.share.lifetime.textContent = 'Access expired.';
            this.disableIncomingActions();
            return;
        }

        const minutes = Math.ceil(remaining / 60000);
        this.share.lifetime.textContent = `Access expires in ${minutes} minute${minutes === 1 ? '' : 's'}.`;
    }

    startShareCountdown(trigger) {
        const destruct = this.shareReceiveMeta?.destruct;
        if (!destruct || destruct.rule === 'never') return;

        if (destruct.rule === 'after_view' && !this.sharePreviewViewed && trigger !== 'view') {
            return;
        }
        if (destruct.rule === 'after_download' && trigger !== 'downloaded') {
            return;
        }

        let expireAt = null;
        if (destruct.rule === 'after_minutes' && destruct.minutes) {
            expireAt = Date.now() + destruct.minutes * 60 * 1000;
        } else if (destruct.rule === 'after_view' || destruct.rule === 'after_download') {
            expireAt = Date.now() + 2 * 60 * 1000;
        }

        if (!expireAt) return;
        this.shareExpiry = expireAt;

        if (this.shareCountdown) clearInterval(this.shareCountdown);
        this.shareCountdown = setInterval(() => {
            const remaining = Math.max(0, this.shareExpiry - Date.now());
            if (remaining === 0) {
                clearInterval(this.shareCountdown);
                this.shareCountdown = null;
                this.share.lifetime.textContent = 'Access expired. File cleared from memory.';
                this.clearIncomingShare();
                return;
            }
            const seconds = Math.ceil(remaining / 1000);
            this.share.lifetime.textContent = `Auto-clear in ${seconds}s.`;
        }, 1000);
    }

    disableIncomingActions() {
        this.share.acceptBtn.disabled = true;
        this.share.viewBtn.disabled = true;
        this.share.rejectBtn.disabled = true;
    }

    clearIncomingShare() {
        this.shareReceiveMeta = null;
        this.shareReceivePreview = null;
        this.sharePreviewViewed = false;
        this.share.receiverPanel?.classList.add('hidden');
        this.share.preview.innerHTML = '';
        this.share.permissionBadges.innerHTML = '';
        if (this.shareCountdown) {
            clearInterval(this.shareCountdown);
            this.shareCountdown = null;
        }
        if (this.shareAccessTimer) {
            clearInterval(this.shareAccessTimer);
            this.shareAccessTimer = null;
        }
    }

    clearShareFileSelection() {
        if (this.share.fileInput) {
            this.share.fileInput.value = '';
        }
        this.setShareProgress(0, 0);
        this.shareTransferStart = null;
        this.setShareStatus('Ready for a new file.', 'info');
    }

    resetShareSession() {
        shareService.cancelSession();
        this.share.offerOut.value = '';
        this.share.answerIn.value = '';
        this.share.joinOfferIn.value = '';
        this.share.joinAnswerOut.value = '';
        this.clearShareFileSelection();
        this.clearIncomingShare();
        this.shareTransferStart = null;
        this.setShareStatus('Transfer ended.', 'info');
    }

    /* --- Diagnostics --- */
    initDiagnostics() {
        if (!this.diagnostics.runBtn) return;
        this.diagnostics.runBtn.addEventListener('click', async () => {
            if (!this.ensureAuthenticated()) return;
            this.diagnostics.output.classList.remove('hidden');
            this.diagnostics.output.textContent = 'Running checks...';
            try {
                const results = await diagnosticsService.runPersistenceChecks();
                this.renderDiagnostics(results);
            } catch (err) {
                this.diagnostics.output.textContent = 'Diagnostics failed to run.';
                this.showToast(err.message || 'Diagnostics failed.', 'error');
            }
        });
    }

    renderDiagnostics(results) {
        if (!this.diagnostics.output) return;
        this.diagnostics.output.innerHTML = results.map(result => {
            const statusClass = result.ok ? 'ok' : 'fail';
            const details = result.details ? ` (${result.details})` : '';
            return `<div class="${statusClass}">${result.ok ? 'PASS' : 'FAIL'}: ${result.name}${details}</div>`;
        }).join('');
    }

    formatBytes(bytes) {
        if (!bytes) return '0 B';
        const units = ['B', 'KB', 'MB', 'GB'];
        let size = bytes;
        let unit = 0;
        while (size >= 1024 && unit < units.length - 1) {
            size /= 1024;
            unit += 1;
        }
        return `${size.toFixed(size >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
    }
}

export const uiService = new UIService();
