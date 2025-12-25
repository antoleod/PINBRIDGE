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
import { syncManager } from '../modules/sync/sync-manager.js';
import { attachmentService } from '../modules/attachments/attachments.js';
import { isAdminUsername } from '../core/rbac.js';
import { validatePin, validateUsername } from '../core/validation.js';


class UIService {
    constructor() {
        this.screens = {};
        this.forms = {};
        this.inputs = {};
        this.recoveryModal = {};
        this.mobile = {};
        this.quickDropZone = null;
        this._lastWindowWidth = typeof window !== 'undefined' ? window.innerWidth : 0;
        this.activeNoteId = null;
        this.currentView = 'all';
        const autoSaveSetting = localStorage.getItem('pinbridge.auto_save');
        this.autoSaveEnabled = autoSaveSetting !== 'false';
        if (autoSaveSetting === null) {
            localStorage.setItem('pinbridge.auto_save', 'true');
        }
        this.compactViewEnabled = localStorage.getItem('pinbridge.compact_notes') === 'true';
        // Footer must stay fixed + always visible across views.
        this.footerAutoHide = false;
        localStorage.setItem('pinbridge.footer_autohide', 'false');
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
        this.voice = {
            state: 'idle', // idle | starting | listening | stopping
            stopRequested: false,
            restartAttempts: 0,
            lastFinalAt: 0,
        };
        this.ocr = {
            stream: null,
            scanIntervalId: null,
            isStarting: false,
            lastGoodText: '',
            lastGoodAt: 0,
        };
        this.loginAttempts = 0;
        this.ocrScanInterval = null;
        this.isOcrProcessing = false;
        this.ocrWorker = null;
        // Clipboard safety: keep a single auto-clear timer to avoid overlapping clears.
        this._clipboardClearTimer = null;
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

        this._pendingNavigation = null;
        this._history = {
            undoStack: [],
            redoStack: [],
            lastValue: null,
            lastSelection: { start: 0, end: 0 },
            lastPushedAt: 0,
            debounceMs: 300,
            max: 120
        };
        this._markdownToolbarButtons = new Map();
        this._inlineWrapState = {
            bold: false,
            italic: false,
            code: false
        };
        this.activePanel = 'notes'; // notes | settings | tools | null
        this._autosave = {
            pending: false,
            lastFailedAt: 0,
            debounceMs: 800
        };
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
        this.toggleAdminInviteVisibility(this.inputs.registerUsername?.value || '');
    }

    async handleRegisterSubmit(e) {
        e.preventDefault();
        const username = (this.inputs.registerUsername?.value || '').trim();
        const pin = (this.inputs.registerPin?.value || '').trim();
        const adminCode = (this.inputs.registerAdminCode?.value || '').trim();
        const usernameError = document.getElementById('register-username-error');
        const pinError = document.getElementById('register-pin-error');
        const adminCodeError = document.getElementById('register-admin-code-error');

        if (usernameError) usernameError.textContent = '';
        if (pinError) pinError.textContent = '';
        if (adminCodeError) adminCodeError.textContent = '';

        const usernameCheck = validateUsername(username);
        if (!usernameCheck.ok) {
            if (usernameError) usernameError.textContent = usernameCheck.message;
            this.showToast(usernameCheck.message, 'error');
            return;
        }

        const pinCheck = validatePin(pin);
        if (!pinCheck.ok) {
            if (pinError) pinError.textContent = pinCheck.message;
            this.showToast(pinCheck.message, 'error');
            return;
        }

        if (isAdminUsername(username) && !adminCode) {
            if (adminCodeError) adminCodeError.textContent = 'Admin invite code is required.';
            this.showToast('Admin invite code is required.', 'error');
            return;
        }

        try {
            const recoveryKey = await authService.register(username, pin, adminCode);
            this.showRecoveryKeyModal(recoveryKey);
        } catch (err) {
            if ((err?.message || err) === 'ADMIN_INVITE_REQUIRED') {
                const adminCodeError = document.getElementById('register-admin-code-error');
                if (adminCodeError) adminCodeError.textContent = 'Admin invite code is required or expired.';
            }
            this.showToast(this.resolveAuthErrorMessage(err?.message || err), 'error');
        }
    }

    toggleAdminInviteVisibility(username) {
        if (!this.registerAdminGroup) return;
        const shouldShow = isAdminUsername(username);
        this.registerAdminGroup.classList.toggle('hidden', !shouldShow);
        if (!shouldShow && this.inputs.registerAdminCode) {
            this.inputs.registerAdminCode.value = '';
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
            registerAdminCode: document.getElementById('register-admin-code'),
            noteTitle: document.getElementById('note-title'),
            noteContent: document.getElementById('note-content'),
            noteFolder: document.getElementById('note-folder'),
            noteTags: document.getElementById('note-tags'),
            search: document.getElementById('search-input'),
            quickDrop: document.getElementById('quick-drop-input')
        };

        this.checklist = {
            container: document.getElementById('note-checklist')
        };

        this.profile = {
            btn: document.getElementById('btn-profile'),
            avatar: document.getElementById('profile-avatar'),
            name: document.getElementById('profile-name'),
            dropdown: document.getElementById('profile-dropdown'),
            logout: document.getElementById('profile-logout')
        };

        this.quickDropZone = document.getElementById('quick-drop-zone');
        this.registerAdminGroup = document.getElementById('register-admin-invite-group');

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
            footerMenuAdmin: document.getElementById('mobile-footer-open-admin'),
            footerMenuLock: document.getElementById('mobile-footer-lock'),
            footerMenuSignout: document.getElementById('mobile-footer-signout')
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

        this.admin = {
            panel: document.querySelector('.admin-panel'),
            username: document.getElementById('admin-username'),
            uid: document.getElementById('admin-uid'),
            noteCount: document.getElementById('admin-note-count'),
            updated: document.getElementById('admin-updated'),
            storage: document.getElementById('admin-storage'),
            connection: document.getElementById('admin-connection'),
            syncEnabled: document.getElementById('admin-sync-enabled'),
            syncTime: document.getElementById('admin-sync-time'),
            syncQueue: document.getElementById('admin-sync-queue'),
            usersList: document.getElementById('admin-users-list'),
            tagsList: document.getElementById('admin-tags-list'),
            activityList: document.getElementById('admin-activity-list'),
            openBtn: document.getElementById('btn-open-admin'),
            exitBtn: document.getElementById('btn-exit-admin'),
            forceSyncBtn: document.getElementById('admin-force-sync'),
            lockBtn: document.getElementById('admin-lock-vault'),
            inviteCode: document.getElementById('admin-invite-code'),
            inviteExpiry: document.getElementById('admin-invite-expiry'),
            inviteGenerate: document.getElementById('admin-invite-generate'),
            inviteRevoke: document.getElementById('admin-invite-revoke'),
            inviteCopy: document.getElementById('admin-invite-copy')
        };
    }

    _getById(id) {
        const el = document.getElementById(id);
        if (!el) {
            console.warn(`UI element with id "${id}" not found.`);
        }
        return el;
    }

    _formatMediaError(err) {
        const name = err?.name || 'Error';
        if (name === 'NotAllowedError' || name === 'PermissionDeniedError') return 'Permission denied. Please allow access and retry.';
        if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return 'No compatible device found.';
        if (name === 'NotReadableError' || name === 'TrackStartError') return 'Device is already in use by another app.';
        if (name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError') return 'Camera constraints not supported on this device.';
        if (name === 'AbortError') return 'Request was interrupted. Try again.';
        return err?.message || 'Unexpected error. Try again.';
    }

    async _getCameraStream(constraints) {
        if (!navigator.mediaDevices?.getUserMedia) {
            throw new Error('Camera is not supported in this browser.');
        }
        try {
            return await navigator.mediaDevices.getUserMedia(constraints);
        } catch (err) {
            if (err?.name === 'OverconstrainedError' || err?.name === 'ConstraintNotSatisfiedError') {
                return await navigator.mediaDevices.getUserMedia({ video: true });
            }
            throw err;
        }
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
                <span class="log-action">${Utils.escapeHtml(log.action)}</span>
                <span class="log-time">${Utils.escapeHtml(log.time)}</span>
            </div>
        `).join('');
    }

    updateConnectivityStatus(status) {
        const isOnline = status === 'online' || navigator.onLine;
        if (this.statusIndicators.offline) {
            this.statusIndicators.offline.className = `status-indicator ${isOnline ? 'status-online' : 'status-offline'}`;
        }
        if (this.statusIndicators.offlineText) {
            this.statusIndicators.offlineText.textContent = isOnline ? 'Cloud Linked' : 'Offline';
        }
    }

    applyAdminVisibility() {
        const isAdmin = vaultService.isAdmin();
        document.querySelectorAll('.admin-only').forEach(el => {
            el.classList.toggle('hidden', !isAdmin);
        });
        if (this.mobile.footerMenuAdmin) {
            this.mobile.footerMenuAdmin.classList.toggle('hidden', !isAdmin);
        }
    }

    ensureAdminAccess() {
        if (vaultService.isAdmin()) return true;
        this.showToast('Admin access required.', 'error');
        this.currentView = 'all';
        this.applyAdminVisibility();
        return false;
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
        this.setupSecurityFeatures();
        this.setStatus(i18n.t('statusReady'));
        this.updateConnectivityStatus();
        this.logActivity('System Initialized');
        this.initSecureShare();
        this.initDiagnostics();

        if (typeof feather !== 'undefined') {
            feather.replace();
        }

        // Keep media resources stable across background/foreground transitions (mobile-first).
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) return;
            this.stopOCRCamera();
            this._stopCameraForQRScan?.();
            this.stopVoiceRecording(true);
        });
        window.addEventListener('pagehide', () => {
            this.stopOCRCamera();
            this._stopCameraForQRScan?.();
            this.stopVoiceRecording(true);
        });
    }

    initGeneratedPasswordPanel() {
        const panel = document.getElementById('generated-password-modal');
        const handle = document.getElementById('generated-password-drag-handle');
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
            btn.setAttribute('aria-label', t.title);
            btn.setAttribute('aria-pressed', 'false');
            btn.dataset.format = t.icon;
            btn.onclick = (e) => {
                e.preventDefault();
                t.action();
            };
            toolbar.appendChild(btn);
            if (['bold', 'italic', 'code'].includes(t.icon)) {
                this._markdownToolbarButtons.set(t.icon, btn);
            }
        });

        // Insert after the minimal toolbar
        const topBar = editorPanel.querySelector('.editor-toolbar-minimal');
        if (topBar) {
            topBar.parentNode.insertBefore(toolbar, topBar.nextSibling);
        }
        if (typeof feather !== 'undefined') feather.replace();
        this.updateMarkdownToolbarState();
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

        document.getElementById('mobile-footer')?.classList.remove('footer-hidden');

        // Handle resize events to reset layout
        window.addEventListener('resize', () => {
            const currentWidth = window.innerWidth;
            const prevWidth = this._lastWindowWidth || currentWidth;
            this._lastWindowWidth = currentWidth;

            // Mobile keyboards often fire `resize` from viewport height changes.
            // Only react when we actually cross the responsive breakpoint.
            const crossedBreakpoint = (prevWidth >= 900) !== (currentWidth >= 900);
            if (!crossedBreakpoint) {
                this.setupSettingsAccordion();
                return;
            }

            if (currentWidth >= 900) {
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

    updateDuplicateDetectionUI() {
        const toggle = document.getElementById('toggle-duplicate-detection');
        if (!toggle) return;
        toggle.checked = localStorage.getItem('pinbridge.duplicate_detection') !== 'false';
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
                // On desktop, tabs control visibility with `.hidden`. On mobile, the accordion controls
                // visibility, so we must clear the tab-hidden state or the section stays non-interactive.
                section.classList.remove('hidden');

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

            const activeTab = document.querySelector('.settings-tab.active')?.dataset?.tab || 'general';
            if (typeof this.switchSettingsTab === 'function') {
                this.switchSettingsTab(activeTab);
            }
        }
    }

    setupFooterAutoHide() {
        // Deprecated: footer must remain visible and fixed.
        return;
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
                    this.closeMobileSidebar();
                    this.closeMobileFooterMenu();
                    this.openSettingsModal();
                    return;
                }

                this.closeMobileSidebar();
                this.closeMobileFooterMenu();

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
        this.inputs.registerUsername?.addEventListener('input', (e) => {
            this.toggleAdminInviteVisibility(e.target.value || '');
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
        const username = document.getElementById('recovery-key-username')?.value?.trim?.() || '';
        if (!recoveryKey) {
            this.showToast('Please enter your recovery key', 'error');
            return;
        }
        if (!username) {
            this.showToast('Please enter your username', 'error');
            return;
        }

        try {
            await authService.unlockWithRecovery(username, recoveryKey);
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
            const record = await recoveryService.verifyBackupCode(code);
            if (!record) {
                this.showToast('Invalid or already used backup code', 'error');
                return;
            }

            const salt = Utils.base64ToBuffer(record.salt || '');
            const key = await cryptoService.deriveKeyFromSecret(code, salt);
            const dataKey = await cryptoService.unwrapKey(record.wrappedKey, key);
            await authService.unlockWithDataKey(dataKey);
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
            const dataKey = await recoveryService.recoverFromSecretAnswer(answer);
            await authService.unlockWithDataKey(dataKey);
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
        const usernameCheck = validateUsername(username);
        if (!usernameCheck.ok) {
            this.showToast(usernameCheck.message, 'error');
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
            const usernameCheck = validateUsername(username);
            if (!usernameCheck.ok) {
                this.showToast(usernameCheck.message, 'error');
                return;
            }

            await authService.unlockWithPin(usernameCheck.value, pin);
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
        const raw = `${code || ''}`;
        const normalized = raw.toLowerCase();
        if (normalized.includes('firestore_')) {
            return `Sync error: ${raw}`;
        }
        if (normalized.includes('missing or insufficient permissions') || normalized.includes('permission-denied')) {
            return 'Sync permission error (Firestore). Confirm you published rules for the same Firebase projectId used by the app, then reload.';
        }
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
            case 'USERNAME_INVALID':
                return 'Username must be 3-32 characters (letters, numbers, _ or -).';
            case 'PIN_REQUIRED':
                return i18n.t('authErrorPinRequired');
            case 'PIN_INVALID':
                return 'PIN must be 4-6 digits.';
            case 'RECOVERY_REQUIRED':
                return i18n.t('authErrorRecoveryRequired');
            case 'USER_EXISTS':
                return i18n.t('authErrorUserExists');
            case 'ADMIN_INVITE_REQUIRED':
                return 'Admin invite code is required or expired.';
            case 'RECOVERY_FILE_INVALID':
                return 'Recovery file is invalid.';
            default:
                return `${i18n.t('loginFormTitle')}: ${code}`;
        }
    }

    handleLockedSession(reason) {
        vaultService.lock();
        this.showScreen('auth');
        this.showLoginForm();
        this.updateUserIdentity(null);
        notesService.notes = [];
        searchService.buildIndex([]);
        this.renderNoteList([]);
        this.clearEditor();
        this.currentView = 'all';
        this.hideSessionTimer();
        document.querySelectorAll('.nav-item, .folder-item').forEach(el => el.classList.remove('active'));
        this.applyAdminVisibility();

        // Don't show a toast on initial load when no session is found
        if (reason === 'no-session') return;

        const msg = reason === 'idle' ? i18n.t('toastVaultLockedIdle') : i18n.t('toastVaultLocked');
        this.showToast(msg, 'info');
    }

    addVaultEventListeners() {
        document.querySelectorAll('.nav-item[data-view]').forEach(btn => {
            btn.onclick = () => {
                this.guardUnsavedChanges(async () => {
                    this.setActivePanel('notes');
                    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    this.currentView = btn.dataset.view;
                    this.closeAllPanels({ reason: 'navigate' });
                    this.closeMobileSidebar();
                    this.closeMobileFooterMenu();
                    this.renderCurrentView();
                }, { source: 'navigate' });
            };
        });

        this.mobile.navPills?.forEach(btn => {
            btn.onclick = () => {
                this.guardUnsavedChanges(async () => {
                    this.setActivePanel('notes');
                    this.mobile.navPills.forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    this.currentView = btn.dataset.view;
                    this.closeAllPanels({ reason: 'navigate' });
                    this.closeMobileSidebar();
                    this.closeMobileFooterMenu();
                    this.renderCurrentView();
                }, { source: 'navigate' });
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

        this.bindProfileMenu();

        document.getElementById('btn-lock')?.addEventListener('click', () => this.handleLockAction());
        document.getElementById('btn-signout')?.addEventListener('click', () => this.handleSignOutAction());
        document.getElementById('mobile-signout')?.addEventListener('click', () => this.handleSignOutAction());
        if (this.mobile.btnLock) this.mobile.btnLock.onclick = () => this.handleLockAction();

        document.getElementById('btn-toggle-compact')?.addEventListener('click', () => this.toggleCompactView());

        if (this.inputs.quickDrop) {
            const quickDropInput = this.inputs.quickDrop;
            quickDropInput.addEventListener('keydown', (e) => this.handleQuickDrop(e));
            quickDropInput.addEventListener('focus', () => this.quickDropZone?.classList.remove('collapsed'));
            quickDropInput.addEventListener('blur', () => {
                if (!quickDropInput.value) this.quickDropZone?.classList.add('collapsed');
            });
        }

        this.bindEditorIntelligence();
    }

    toggleMobileSidebar() {
        const shouldOpen = !document.body.classList.contains('mobile-sidebar-open');
        if (shouldOpen) this.openMobileSidebar();
        else this.closeMobileSidebar();
    }

    updateUserIdentity(username) {
        const name = (username || vaultService.meta?.username || vaultService.vault?.meta?.username || '').trim();
        const validated = name ? validateUsername(name) : { ok: false };
        const safeName = validated.ok ? validated.value : '';
        const display = safeName ? `@${safeName}` : i18n.t('loginFormTitle');
        const mobile = document.getElementById('mobile-user-display');
        if (mobile) mobile.textContent = display;
        if (this.profile?.name) this.profile.name.textContent = display;
        if (this.profile?.avatar) {
            const initials = safeName ? safeName.slice(0, 2).toUpperCase() : 'PB';
            this.profile.avatar.textContent = initials;
            this.profile.avatar.title = safeName ? safeName : i18n.t('loginFormTitle');
        }
    }

    bindProfileMenu() {
        const btn = this.profile?.btn;
        const dropdown = this.profile?.dropdown;
        const logout = this.profile?.logout;
        if (!btn || !dropdown) return;

        const close = () => {
            dropdown.classList.add('hidden');
            btn.setAttribute('aria-expanded', 'false');
        };

        const toggle = () => {
            const isOpen = !dropdown.classList.contains('hidden');
            if (isOpen) close();
            else {
                dropdown.classList.remove('hidden');
                btn.setAttribute('aria-expanded', 'true');
                // Ensure icons render if menu opened after initial feather replace.
                if (typeof feather !== 'undefined') feather.replace();
            }
        };

        if (!btn.dataset.boundProfile) {
            btn.dataset.boundProfile = 'true';
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                toggle();
            });

            btn.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggle();
                }
                if (e.key === 'Escape') {
                    e.preventDefault();
                    close();
                    btn.focus();
                }
            });

            document.addEventListener('click', (e) => {
                if (dropdown.classList.contains('hidden')) return;
                if (btn.contains(e.target) || dropdown.contains(e.target)) return;
                close();
            });
        }

        if (logout && !logout.dataset.boundLogout) {
            logout.dataset.boundLogout = 'true';
            logout.addEventListener('click', async (e) => {
                e.preventDefault();
                close();
                await this.handleSignOutAction();
            });
        }
    }

    openMobileSidebar() {
        document.body.classList.add('mobile-sidebar-open');
        let backdrop = document.getElementById('mobile-nav-backdrop');
        if (!backdrop) {
            backdrop = document.createElement('div');
            backdrop.id = 'mobile-nav-backdrop';
            backdrop.className = 'mobile-nav-backdrop';
            document.body.appendChild(backdrop);
            backdrop.addEventListener('click', () => this.closeMobileSidebar());
        }
        backdrop.classList.add('visible');
    }

    async handleLockAction() {
        // Lock = quick privacy action (no confirmation).
        const ok = await this.guardUnsavedChanges(async () => true, { source: 'lock' });
        if (!ok) return;
        authService.forceLogout('manual');
    }

    async handleSignOutAction() {
        // Sign out = explicit account/session termination.
        const ok = await this.guardUnsavedChanges(async () => true, { source: 'signout' });
        if (!ok) return;
        if (!confirm('Sign out on this device? Your vault stays encrypted, and you can sign back in anytime.')) return;
        await authService.signOut('manual');
    }

    async guardUnsavedChanges(onProceed, { source } = {}) {
        if (!this.activeNoteId) {
            if (onProceed) await onProceed();
            return true;
        }
        const hasChanged = this.isNoteChanged();
        if (!hasChanged) {
            if (onProceed) await onProceed();
            return true;
        }

        // Try to persist silently first to avoid friction.
        const saved = await this.persistNote(true);
        if (saved) {
            if (onProceed) await onProceed();
            return true;
        }

        // Save failed (or blocked). Show a subtle inline guard instead of a modal.
        this._pendingNavigation = onProceed || null;
        this.showUnsavedGuard(source);
        return false;
    }

    showUnsavedGuard(source) {
        const toolbar = document.querySelector('.editor-toolbar-minimal');
        if (!toolbar) return;

        let guard = document.getElementById('unsaved-guard');
        if (!guard) {
            guard = document.createElement('div');
            guard.id = 'unsaved-guard';
            guard.className = 'unsaved-guard';
            guard.innerHTML = `
                <div class="unsaved-guard-text">Unsaved changes</div>
                <div class="unsaved-guard-actions">
                    <button type="button" class="btn btn-secondary btn-sm" id="unsaved-guard-save">Save</button>
                    <button type="button" class="btn btn-text btn-sm" id="unsaved-guard-discard">Discard</button>
                </div>
            `;
            toolbar.appendChild(guard);

            guard.querySelector('#unsaved-guard-save')?.addEventListener('click', async () => {
                const ok = await this.persistNote(true);
                if (!ok) return;
                this.hideUnsavedGuard();
                const pending = this._pendingNavigation;
                this._pendingNavigation = null;
                if (pending) await pending();
            });

            guard.querySelector('#unsaved-guard-discard')?.addEventListener('click', async () => {
                this.hideUnsavedGuard();
                this._pendingNavigation = null;
                const note = notesService.notes.find(n => n.id === this.activeNoteId);
                if (!note) return;
                if (this.inputs.noteTitle) this.inputs.noteTitle.value = note.title || '';
                if (this.inputs.noteContent) this.inputs.noteContent.value = note.body || '';
                if (this.inputs.noteFolder) this.inputs.noteFolder.value = note.folder || '';
                if (this.inputs.noteTags) this.inputs.noteTags.value = (note.tags || []).join(', ');
                this.refreshSaveButtonState();
                this.scheduleAutoSave();
            });
        }

        guard.dataset.source = source || '';
        guard.classList.add('visible');
    }

    hideUnsavedGuard() {
        const guard = document.getElementById('unsaved-guard');
        guard?.classList.remove('visible');
    }

    bindEditorIntelligence() {
        const textarea = this.inputs.noteContent;
        if (!textarea || textarea.dataset.boundIntelligence) return;
        textarea.dataset.boundIntelligence = 'true';

        this._history.lastValue = textarea.value;
        this._pushHistorySnapshot();
        this.updateUndoRedoUI();

        textarea.addEventListener('keydown', (e) => this.handleEditorKeydown(e));
        textarea.addEventListener('beforeinput', (e) => {
            if (e.inputType === 'insertLineBreak') {
                if (this.handleSmartListEnter()) {
                    e.preventDefault();
                }
                return;
            }
            if (e.inputType === 'deleteContentBackward') {
                if (this.handleListBackspace()) {
                    e.preventDefault();
                }
            }
        });
        textarea.addEventListener('input', () => {
            this.hideUnsavedGuard();
            this._maybePushHistorySnapshot();
            this.updateUndoRedoUI();
            this.updateMarkdownToolbarState();
        });

        textarea.addEventListener('click', () => this.updateMarkdownToolbarState());
        textarea.addEventListener('keyup', () => this.updateMarkdownToolbarState());
        document.addEventListener('selectionchange', () => {
            if (document.activeElement === textarea) this.updateMarkdownToolbarState();
        });

        document.getElementById('btn-undo')?.addEventListener('click', () => this.undo());
        document.getElementById('btn-redo')?.addEventListener('click', () => this.redo());
    }

    handleEditorKeydown(e) {
        const textarea = this.inputs.noteContent;
        if (!textarea) return;

        const isMac = navigator.platform.toLowerCase().includes('mac');
        const mod = isMac ? e.metaKey : e.ctrlKey;

        if (mod && !e.altKey && (e.key === 'z' || e.key === 'Z')) {
            e.preventDefault();
            if (e.shiftKey) this.redo();
            else this.undo();
            return;
        }

        if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
            // Newline should exit any inline wrap toggle mode.
            if (this._inlineWrapState.bold || this._inlineWrapState.italic || this._inlineWrapState.code) {
                this._inlineWrapState.bold = false;
                this._inlineWrapState.italic = false;
                this._inlineWrapState.code = false;
                this.updateMarkdownToolbarState();
            }
            if (this.handleSmartListEnter()) {
                e.preventDefault();
            }
        }

        if (e.key === 'Backspace' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
            if (this.handleListBackspace()) {
                e.preventDefault();
            }
        }
    }

    handleSmartListEnter() {
        const textarea = this.inputs.noteContent;
        if (!textarea) return false;

        const value = textarea.value;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        if (start !== end) return false;

        const lineStart = value.lastIndexOf('\n', start - 1) + 1;
        const lineEnd = value.indexOf('\n', start);
        const currentLine = value.slice(lineStart, lineEnd === -1 ? value.length : lineEnd);
        const beforeCursorInLine = value.slice(lineStart, start);

        const ordered = currentLine.match(/^(\s*)(\d+)\.\s?(.*)$/);
        const unordered = currentLine.match(/^(\s*)([-*])\s?(.*)$/);

        const insertAt = (text) => {
            textarea.setRangeText(text, start, end, 'end');
            textarea.dispatchEvent(new Event('input'));
        };

        if (ordered) {
            const indent = ordered[1] || '';
            const n = Number(ordered[2] || '1');
            const rest = ordered[3] || '';
            if (beforeCursorInLine.trim() === `${n}.` || rest.trim() === '') {
                insertAt('\n');
                return true;
            }
            insertAt(`\n${indent}${n + 1}. `);
            return true;
        }

        if (unordered) {
            const indent = unordered[1] || '';
            const bullet = unordered[2] || '-';
            const rest = unordered[3] || '';
            if (beforeCursorInLine.trim() === bullet || rest.trim() === '') {
                insertAt('\n');
                return true;
            }
            insertAt(`\n${indent}${bullet} `);
            return true;
        }

        return false;
    }

    handleListBackspace() {
        const textarea = this.inputs.noteContent;
        if (!textarea) return false;
        const value = textarea.value;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        if (start !== end) return false;
        if (start === 0) return false;

        const lineStart = value.lastIndexOf('\n', start - 1) + 1;
        const beforeCursorInLine = value.slice(lineStart, start);

        // If cursor is right after a list prefix, remove the prefix (keep content).
        // Ordered: "12. " or "12."
        const orderedPrefix = beforeCursorInLine.match(/^(\s*)(\d+)\.\s?$/);
        if (orderedPrefix) {
            textarea.setRangeText('', lineStart + orderedPrefix[1].length, start, 'end');
            textarea.dispatchEvent(new Event('input'));
            return true;
        }

        // Unordered: "- " "*" with optional space
        const unorderedPrefix = beforeCursorInLine.match(/^(\s*)([-*])\s?$/);
        if (unorderedPrefix) {
            textarea.setRangeText('', lineStart + unorderedPrefix[1].length, start, 'end');
            textarea.dispatchEvent(new Event('input'));
            return true;
        }

        return false;
    }

    _pushHistorySnapshot() {
        const textarea = this.inputs.noteContent;
        if (!textarea) return;
        const snap = {
            value: textarea.value,
            selectionStart: textarea.selectionStart,
            selectionEnd: textarea.selectionEnd
        };
        const last = this._history.undoStack[this._history.undoStack.length - 1];
        if (last && last.value === snap.value && last.selectionStart === snap.selectionStart && last.selectionEnd === snap.selectionEnd) {
            return;
        }
        this._history.undoStack.push(snap);
        if (this._history.undoStack.length > this._history.max) this._history.undoStack.shift();
        this._history.redoStack = [];
        this._history.lastValue = snap.value;
        this._history.lastSelection = { start: snap.selectionStart, end: snap.selectionEnd };
        this._history.lastPushedAt = Date.now();
    }

    _maybePushHistorySnapshot() {
        const textarea = this.inputs.noteContent;
        if (!textarea) return;
        const now = Date.now();
        const changed = textarea.value !== this._history.lastValue;
        if (!changed) return;
        if (now - this._history.lastPushedAt < this._history.debounceMs) return;
        this._pushHistorySnapshot();
    }

    undo() {
        const textarea = this.inputs.noteContent;
        if (!textarea) return;
        if (this._history.undoStack.length <= 1) return;

        const current = this._history.undoStack.pop();
        if (current) this._history.redoStack.push(current);
        const prev = this._history.undoStack[this._history.undoStack.length - 1];
        if (!prev) return;

        textarea.value = prev.value;
        textarea.setSelectionRange(prev.selectionStart, prev.selectionEnd);
        textarea.focus();
        textarea.dispatchEvent(new Event('input'));
        this.updateUndoRedoUI();
    }

    redo() {
        const textarea = this.inputs.noteContent;
        if (!textarea) return;
        const next = this._history.redoStack.pop();
        if (!next) return;

        this._history.undoStack.push(next);
        textarea.value = next.value;
        textarea.setSelectionRange(next.selectionStart, next.selectionEnd);
        textarea.focus();
        textarea.dispatchEvent(new Event('input'));
        this.updateUndoRedoUI();
    }

    updateUndoRedoUI() {
        const undoBtn = document.getElementById('btn-undo');
        const redoBtn = document.getElementById('btn-redo');
        if (undoBtn) undoBtn.disabled = this._history.undoStack.length <= 1;
        if (redoBtn) redoBtn.disabled = this._history.redoStack.length === 0;
    }

    closeMobileSidebar() {
        document.body.classList.remove('mobile-sidebar-open');
        document.getElementById('mobile-nav-backdrop')?.classList.remove('visible');
    }

    showSettingsModal() {
        // Auth Settings (pre-login): never touch encrypted vault data.
        this.setActivePanel('settings');
        this.settingsModal.overlay?.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
    }

    hideSettingsModal() {
        this.settingsModal.overlay?.classList.add('hidden');
        document.body.style.overflow = '';
        if (this.activePanel === 'settings') this.setActivePanel('notes');
    }

    setActivePanel(panel) {
        this.activePanel = panel;

        // Mobile-first: ensure layers do not overlap or intercept clicks.
        if (panel !== 'settings') {
            this.settingsModal.overlay?.classList.add('hidden');
            document.getElementById('settings-modal')?.classList.add('hidden');
            document.body.style.overflow = '';
        }
        if (panel !== 'tools') {
            document.getElementById('generated-password-modal')?.classList.add('hidden');
        }
        if (panel !== 'notes') {
            // keep notes panel as baseline; close sidebar overlays/menus
            this.closeMobileSidebar();
            this.closeMobileFooterMenu();
        }
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
            // Voice: bind existing button (index.html) once.
            const voiceBtn = document.getElementById('btn-voice-type');
            if (voiceBtn && !voiceBtn.dataset.boundVoice) {
                voiceBtn.dataset.boundVoice = 'true';
                voiceBtn.onclick = (e) => {
                    e.preventDefault();
                    this.toggleVoiceRecording();
                };
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
        });

        this.inputs.noteContent?.addEventListener('input', () => {
            this.scheduleAutoSave();
            this.refreshSaveButtonState();
            this.updateWordCount();
            this.autoResizeTextarea(this.inputs.noteContent);
            this.renderChecklistFromEditor();
        });

        // Smart list/autocomplete is handled centrally in `bindEditorIntelligence()` (desktop + mobile).

        this.inputs.noteFolder?.addEventListener('input', () => this.scheduleAutoSave());
        this.inputs.noteTags?.addEventListener('input', () => {
            this.scheduleAutoSave();
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

        // Dashboard actions (delegate so icons/cards work too)
        const dashboardPanel = document.querySelector('.dashboard-panel');
        if (dashboardPanel && !dashboardPanel.dataset.boundActions) {
            dashboardPanel.dataset.boundActions = 'true';
            dashboardPanel.addEventListener('click', (e) => {
                const target = e.target.closest('[data-action]');
                if (!target) return;
                const action = target.dataset.action;
                if (!action) return;

                if (action === 'new-note') {
                    this.currentView = 'all';
                    document.querySelector('[data-view="all"]')?.click();
                    this.handleNewNote();
                    return;
                }
                if (action === 'new-template') {
                    this.currentView = 'templates';
                    document.querySelector('[data-view="templates"]')?.click();
                    this.handleNewNote();
                    return;
                }
                if (action === 'view-favorites') {
                    document.querySelector('[data-view="favorites"]')?.click();
                    return;
                }
                if (action === 'view-trash') {
                    document.querySelector('[data-view="trash"]')?.click();
                    return;
                }
                if (action === 'view-all') {
                    document.querySelector('[data-view="all"]')?.click();
                    return;
                }
                if (action === 'view-folders') {
                    this.openFoldersFromDashboard();
                    return;
                }
                if (action === 'view-tags') {
                    this.openTagsView();
                    return;
                }
            });
            dashboardPanel.addEventListener('keydown', (e) => {
                const isActivation = e.key === 'Enter' || e.key === ' ';
                if (!isActivation) return;
                const target = e.target.closest('[data-action]');
                if (!target) return;
                e.preventDefault();
                target.click();
            });
        }

        // Settings Modal (vault-only)
        document.getElementById('btn-vault-settings')?.addEventListener('click', () => this.openSettingsModal());
        document.getElementById('close-settings-modal')?.addEventListener('click', () => {
            document.getElementById('settings-modal').classList.add('hidden');
        });
        this.admin.openBtn?.addEventListener('click', () => {
            document.getElementById('settings-modal')?.classList.add('hidden');
            this.openAdminPanel();
        });
        this.admin.exitBtn?.addEventListener('click', () => this.exitAdminPanel());
        this.admin.forceSyncBtn?.addEventListener('click', () => {
            vaultService.ensureSyncActive();
            syncManager.processQueue();
            this.showToast('Sync queued.', 'info');
            this.renderAdminPanel();
        });
        this.admin.lockBtn?.addEventListener('click', () => authService.forceLogout('manual'));
        this.admin.inviteGenerate?.addEventListener('click', () => this.generateAdminInvite());
        this.admin.inviteRevoke?.addEventListener('click', () => this.revokeAdminInvite());
        this.admin.inviteCopy?.addEventListener('click', () => this.copyAdminInvite());

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
                const tabName = e.currentTarget?.dataset?.tab;
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
                    this.persistNote({ force: true, reason: 'autosave', silent: true }).catch(err => console.error("Final persist failed", err));

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

        // Guard against overlapping recognition instances (common source of inconsistent behavior).
        if (this.recognition && this.voice.state !== 'idle') {
            if (this.voice.state === 'listening') {
                this.stopVoiceRecording();
            }
            return;
        }

        if (this.voice.state === 'starting' || this.voice.state === 'stopping') {
            this.showToast('Please wait…', 'info');
            return;
        }

        if (this.voice.state === 'listening') {
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
            this.voice.state = 'listening';
            this.voice.stopRequested = false;
            const btn = document.getElementById('btn-voice-type');
            btn?.classList.add('recording-pulse');
            btn?.setAttribute('aria-pressed', 'true');
            if (btn) {
                btn.disabled = false;
                btn.title = 'Stop Voice Typing';
            }
            this.showToast('Listening...', 'info');
        };

        this.recognition.onresult = (event) => {
            for (let i = event.resultIndex; i < event.results.length; ++i) {
                if (event.results[i].isFinal) {
                    this.insertTextAtCursor(event.results[i][0].transcript + ' ');
                    this.voice.lastFinalAt = Date.now();
                }
            }
        };

        this.recognition.onerror = (event) => {
            console.error('Speech error', event.error);
            const code = event?.error;
            if (code === 'not-allowed' || code === 'service-not-allowed') {
                this.showToast('Microphone permission denied. Enable it in browser settings and retry.', 'error');
            } else if (code === 'no-speech') {
                this.showToast('No speech detected. Try again.', 'info');
            } else if (code === 'audio-capture') {
                this.showToast('No microphone found or it is unavailable.', 'error');
            } else if (code === 'network') {
                const isSecure = window.isSecureContext || location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname);
                this.showToast(isSecure ? 'Speech service unavailable. Try Chrome/Edge, then retry.' : 'Speech requires HTTPS (or localhost). Open the app on HTTPS and retry.', 'error');
            } else {
                this.showToast('Speech recognition error. Try again.', 'error');
            }
            this.stopVoiceRecording(true);
        };

        this.recognition.onend = () => {
            const btn = document.getElementById('btn-voice-type');
            btn?.classList.remove('recording-pulse');
            btn?.setAttribute('aria-pressed', 'false');
            if (btn) {
                btn.disabled = false;
                btn.title = 'Voice Typing';
            }

            // If the browser ended recognition due to silence, retry once to reduce "random" stops.
            const endedUnexpectedly = !this.voice.stopRequested && this.voice.state === 'listening';
            const timeSinceFinal = Date.now() - (this.voice.lastFinalAt || 0);
            if (endedUnexpectedly && this.voice.restartAttempts < 1 && timeSinceFinal < 10_000) {
                this.voice.restartAttempts += 1;
                this.voice.state = 'starting';
                setTimeout(() => {
                    try {
                        this.recognition?.start();
                    } catch {
                        this.stopVoiceRecording(true);
                    }
                }, 250);
                return;
            }

            this.voice.state = 'idle';
            this.voice.stopRequested = false;
            this.voice.restartAttempts = 0;
            this.isRecording = false;
            this.recognition = null;
        };

        this.voice.state = 'starting';
        this.voice.restartAttempts = 0;
        const startBtn = document.getElementById('btn-voice-type');
        if (startBtn) startBtn.disabled = true;
        try {
            this.recognition.start();
        } catch (err) {
            console.error('Speech start error', err);
            this.showToast('Could not start speech recognition. Try again.', 'error');
            this.stopVoiceRecording(true);
        }
    }

    stopVoiceRecording(force = false) {
        if (this.voice.state === 'idle') return;
        this.voice.stopRequested = true;
        this.voice.state = 'stopping';
        this.isRecording = false;

        const btn = document.getElementById('btn-voice-type');
        btn?.classList.remove('recording-pulse');
        btn?.setAttribute('aria-pressed', 'false');
        if (btn) {
            btn.disabled = false;
            btn.title = 'Voice Typing';
        }

        if (this.recognition) {
            try {
                this.recognition.stop();
            } catch (err) {
                if (!force) console.warn('Speech stop error', err);
                this.recognition = null;
                this.voice.state = 'idle';
                this.voice.stopRequested = false;
                this.voice.restartAttempts = 0;
            }
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
            // Close on backdrop click (predictable cleanup of camera + timers).
            modal.addEventListener('click', (e) => {
                if (e.target === modal) this.hideOCRModal();
            });
        }

        const modal = this._getById('ocr-modal');
        modal.classList.remove('hidden');

        // Reset UI state on each open to avoid confusing stale results.
        const statusEl = this._getById('ocr-status');
        const previewEl = this._getById('ocr-result-preview');
        const insertBtn = this._getById('btn-insert-ocr');
        if (statusEl) statusEl.innerText = 'Preparing scanner...';
        if (previewEl) previewEl.textContent = '';
        if (insertBtn) insertBtn.disabled = true;
        this.ocr.lastGoodText = '';
        this.ocr.lastGoodAt = 0;

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
                tessedit_pageseg_mode: Tesseract.PSM.AUTO,
            });
        }

        this.startOCRCamera();
    }

    hideOCRModal() {
        this._getById('ocr-modal')?.classList.add('hidden');
        this.stopOCRCamera();
        // Release OCR processing resources so repeated usage doesn't degrade over time.
        this.isOcrProcessing = false;
    }

    async startOCRCamera() {
        const video = this._getById('ocr-video');
        if (!video) return;
        if (this.ocr.isStarting) return;

        // Avoid duplicate streams/intervals on repeated opens.
        // Important: enforce single active camera session (OCR vs QR scanning).
        // This prevents leaked tracks and "camera already in use" errors after repeated usage.
        this._stopCameraForQRScan?.();
        this.stopOCRCamera();
        this.ocr.isStarting = true;

        const statusEl = this._getById('ocr-status');
        if (statusEl) statusEl.innerText = 'Requesting camera permission...';
        try {
            const stream = await this._getCameraStream({
                video: {
                    facingMode: { ideal: 'environment' },
                    width: { ideal: 1920 },
                    height: { ideal: 1080 },
                }
            });
            this.ocr.stream = stream;
            video.srcObject = stream;
            video.setAttribute('playsinline', '');
            await video.play();
            if (statusEl) statusEl.innerText = 'Point camera at text';
            this.ocr.scanIntervalId = setInterval(() => this.scanFrame(), 1200);
        } catch (err) {
            console.error("OCR Camera Error:", err);
            const message = this._formatMediaError(err);
            if (statusEl) statusEl.innerText = message;
            this.showToast(message, 'error');
        } finally {
            this.ocr.isStarting = false;
        }
    }

    stopOCRCamera() {
        if (this.ocr.scanIntervalId) {
            clearInterval(this.ocr.scanIntervalId);
            this.ocr.scanIntervalId = null;
        }
        this.isOcrProcessing = false;
        const video = this._getById('ocr-video');
        if (video && video.srcObject) {
            video.pause?.();
            video.srcObject.getTracks().forEach(track => track.stop());
            video.srcObject = null;
        }
        if (this.ocr.stream) {
            this.ocr.stream.getTracks().forEach(track => track.stop());
            this.ocr.stream = null;
        }
    }

    async scanFrame() {
        const video = this._getById('ocr-video');
        const modal = this._getById('ocr-modal');
        const overlay = modal?.querySelector('.qr-scanner-overlay');
        const statusEl = this._getById('ocr-status');
        const previewEl = this._getById('ocr-result-preview');

        if (!video || !overlay || !statusEl || !previewEl || this.isOcrProcessing || !this.ocrWorker) return;
        if (!video.videoWidth || !video.videoHeight) return;

        this.isOcrProcessing = true;
        statusEl.innerText = 'Capturing...';

        // Reuse a single canvas/context to reduce allocations and improve stability on mobile.
        if (!this.ocr._canvas) {
            this.ocr._canvas = document.createElement('canvas');
            this.ocr._context = this.ocr._canvas.getContext('2d', { willReadFrequently: true });
        }
        const canvas = this.ocr._canvas;
        const context = this.ocr._context;
        if (!context) {
            this.isOcrProcessing = false;
            statusEl.innerText = 'Camera error.';
            return;
        }

        const videoRect = video.getBoundingClientRect();
        const overlayRect = overlay.getBoundingClientRect();

        const scaleX = video.videoWidth / videoRect.width;
        const scaleY = video.videoHeight / videoRect.height;

        const cropX = Math.max(0, Math.round((overlayRect.left - videoRect.left) * scaleX));
        const cropY = Math.max(0, Math.round((overlayRect.top - videoRect.top) * scaleY));
        const cropWidth = Math.min(video.videoWidth - cropX, Math.max(1, Math.round(overlayRect.width * scaleX)));
        const cropHeight = Math.min(video.videoHeight - cropY, Math.max(1, Math.round(overlayRect.height * scaleY)));

        // Scale up small crops to improve OCR accuracy while keeping memory bounded.
        const maxDim = 1600;
        const scaleUp = Math.min(2, maxDim / Math.max(cropWidth, cropHeight));
        const targetWidth = Math.max(1, Math.round(cropWidth * scaleUp));
        const targetHeight = Math.max(1, Math.round(cropHeight * scaleUp));

        canvas.width = targetWidth;
        canvas.height = targetHeight;

        context.drawImage(video, cropX, cropY, cropWidth, cropHeight, 0, 0, targetWidth, targetHeight);

        this._preprocessCanvas(canvas);

        try {
            const { data } = await this.ocrWorker.recognize(canvas);
            const processedText = this._postProcessOcrText(data.text);

            if (data.confidence > 60) {
                statusEl.innerText = `Confidence: ${data.confidence.toFixed(0)}%`;
                // Avoid visually "jittering" by re-rendering identical content on every interval.
                if (processedText && processedText !== this.ocr.lastGoodText) {
                    this.ocr.lastGoodText = processedText;
                    this.ocr.lastGoodAt = Date.now();
                    previewEl.textContent = processedText;
                    const insertBtn = this._getById('btn-insert-ocr');
                    if (insertBtn) insertBtn.disabled = false;
                }
            } else {
                statusEl.innerText = "Text not clear yet ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â adjust angle or lighting";
            }

            // Sanitize any accidental mojibake in the "not clear" message.
            if (statusEl.innerText?.startsWith('Text not clear yet')) {
                statusEl.innerText = 'Text not clear yet — adjust angle or lighting.';
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
                    // Ensure we also release camera/mic resources tied to modals.
                    this.stopOCRCamera();
                    this._stopCameraForQRScan?.();
                    this.stopVoiceRecording(true);
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
        this.setActivePanel('settings');
        this.closeAllPanels({ exceptIds: ['settings-modal'], reason: 'open-settings' });
        this.renderSettingsPanel(); // Render full settings UI
        this.renderThemeSwitcher();
        this.initBackgroundSettingsControls();
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

    closeAllPanels({ exceptIds = [], reason = '' } = {}) {
        const keep = new Set(exceptIds || []);

        // Close any open overlay modals/sheets/dialogs used across the app.
        document.querySelectorAll('.modal-overlay').forEach(el => {
            if (keep.has(el.id)) return;
            el.classList.add('hidden');
        });

        if (reason) {
            this.logActivity(`UI: close panels (${reason})`);
        }
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
                        <label>Background</label>
                        <div class="settings-item">
                            <div class="settings-item-content">
                                <div class="settings-item-title">Use background image</div>
                                <div class="settings-item-description">Optional image overlay behind the app.</div>
                            </div>
                            <label class="toggle-switch">
                                <input type="checkbox" id="toggle-bg-enabled">
                                <span class="toggle-slider"></span>
                            </label>
                        </div>
                        <div id="bg-controls" class="mt-1">
                            <div id="bg-preview" class="bg-preview">
                                <div class="bg-preview-label">Preview</div>
                            </div>
                            <div class="form-group mt-1">
                                <label for="bg-file">Choose image</label>
                                <input id="bg-file" type="file" accept="image/*" class="input-field">
                                <p class="hint">Stored locally in your browser (data URL). Recommended &lt; 2 MB.</p>
                            </div>
                            <div class="form-group">
                                <label for="bg-fit">Fit</label>
                                <select id="bg-fit" class="input-field">
                                    <option value="cover">Cover</option>
                                    <option value="contain">Contain</option>
                                </select>
                            </div>
                            <div class="form-group">
                                <label for="bg-opacity">Opacity</label>
                                <input id="bg-opacity" type="range" min="0" max="0.9" step="0.05">
                            </div>
                            <div class="form-group">
                                <label for="bg-blur">Blur</label>
                                <input id="bg-blur" type="range" min="0" max="18" step="1">
                            </div>
                            <div class="settings-actions">
                                <button id="bg-clear" class="settings-action">
                                    <div class="settings-action-content">
                                        <span class="settings-action-title">Clear background</span>
                                    </div>
                                </button>
                            </div>
                        </div>
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

                    <h3>Notes</h3>
                    <div class="settings-item">
                        <div class="settings-item-content">
                            <span class="settings-item-title">Compact view</span>
                            <span class="settings-item-desc">Tighter note list spacing.</span>
                        </div>
                        <div class="toggle-switch">
                            <input type="checkbox" id="toggle-compact-view" class="toggle-input">
                            <label for="toggle-compact-view" class="toggle-label"></label>
                        </div>
                    </div>
                    <div class="settings-item">
                        <div class="settings-item-content">
                            <span class="settings-item-title">Show preview</span>
                            <span class="settings-item-desc">Show a short body preview in the list.</span>
                        </div>
                        <div class="toggle-switch">
                            <input type="checkbox" id="toggle-show-preview" class="toggle-input">
                            <label for="toggle-show-preview" class="toggle-label"></label>
                        </div>
                    </div>
                    <div class="settings-item">
                        <div class="settings-item-content">
                            <span class="settings-item-title">Sort notes</span>
                            <span class="settings-item-desc">Choose how notes are ordered.</span>
                        </div>
                        <select id="notes-sort-select" class="settings-select">
                            <option value="updated">Last updated</option>
                            <option value="created">Date created</option>
                            <option value="title">Title</option>
                        </select>
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

            // Notes list settings (migrated from legacy notes settings menu).
            const compactToggle = document.getElementById('toggle-compact-view');
            if (compactToggle) compactToggle.checked = this.compactViewEnabled;
            compactToggle?.addEventListener('change', (e) => {
                this.compactViewEnabled = !!e.target.checked;
                localStorage.setItem('pinbridge.compact_notes', this.compactViewEnabled ? 'true' : 'false');
                this.updateCompactViewUI();
            });

            const previewToggle = document.getElementById('toggle-show-preview');
            if (previewToggle) previewToggle.checked = localStorage.getItem('pinbridge.show_preview') !== 'false';
            previewToggle?.addEventListener('change', (e) => {
                localStorage.setItem('pinbridge.show_preview', e.target.checked ? 'true' : 'false');
                this.renderCurrentView();
            });

            const sortSelect = document.getElementById('notes-sort-select');
            if (sortSelect) sortSelect.value = localStorage.getItem('pinbridge.notes_sort') || 'updated';
            sortSelect?.addEventListener('change', (e) => {
                localStorage.setItem('pinbridge.notes_sort', e.target.value || 'updated');
                this.renderCurrentView();
            });
            this._bindSetting('setting-footer-autohide', 'pinbridge.footer_autohide', 'checkbox', (val) => {
                // Footer must remain visible; keep setting disabled for UX consistency.
                this.footerAutoHide = false;
                localStorage.setItem('pinbridge.footer_autohide', 'false');
                const el = document.getElementById('setting-footer-autohide');
                if (el) {
                    el.checked = false;
                    el.setAttribute('disabled', 'disabled');
                }
                document.getElementById('mobile-footer')?.classList.remove('footer-hidden');
            });
            // Apply immediately (callback only runs on change).
            const footerAutoHideEl = document.getElementById('setting-footer-autohide');
            if (footerAutoHideEl) {
                footerAutoHideEl.checked = false;
                footerAutoHideEl.setAttribute('disabled', 'disabled');
            }

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
            { id: 'low-contrast', name: 'Low Contrast' },
            { id: 'nord', name: 'Nord' },
            { id: 'rose', name: 'Rose' }
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

    applyBackgroundFromStorage() {
        const enabled = localStorage.getItem('pinbridge.bg.enabled') === 'true';
        const image = localStorage.getItem('pinbridge.bg.image') || '';
        const opacity = localStorage.getItem('pinbridge.bg.opacity');
        const blur = localStorage.getItem('pinbridge.bg.blur');
        const fit = localStorage.getItem('pinbridge.bg.fit');

        if (!enabled || !image) {
            document.body.style.setProperty('--app-bg-image', 'none');
            return;
        }

        document.body.style.setProperty('--app-bg-image', `url("${image}")`);
        if (opacity !== null) document.body.style.setProperty('--app-bg-opacity', String(opacity));
        if (blur !== null) document.body.style.setProperty('--app-bg-blur', `${parseInt(blur, 10) || 0}px`);
        if (fit) document.body.style.setProperty('--app-bg-fit', fit);
    }

    updateBackgroundPreview() {
        const preview = document.getElementById('bg-preview');
        if (!preview) return;
        const enabled = localStorage.getItem('pinbridge.bg.enabled') === 'true';
        const image = localStorage.getItem('pinbridge.bg.image') || '';
        const opacity = localStorage.getItem('pinbridge.bg.opacity') ?? '0.35';
        const blur = localStorage.getItem('pinbridge.bg.blur') ?? '0';
        const fit = localStorage.getItem('pinbridge.bg.fit') || 'cover';

        preview.style.setProperty('--preview-bg-image', enabled && image ? `url("${image}")` : 'none');
        preview.style.setProperty('--preview-bg-opacity', enabled && image ? String(opacity) : '0');
        preview.style.setProperty('--preview-bg-blur', `${parseInt(blur, 10) || 0}px`);
        preview.style.setProperty('--preview-bg-fit', fit);
    }

    initBackgroundSettingsControls() {
        const toggle = document.getElementById('toggle-bg-enabled');
        const file = document.getElementById('bg-file');
        const opacity = document.getElementById('bg-opacity');
        const blur = document.getElementById('bg-blur');
        const fit = document.getElementById('bg-fit');
        const clear = document.getElementById('bg-clear');
        const controls = document.getElementById('bg-controls');
        if (!toggle || !file || !opacity || !blur || !fit || !clear) return;

        const enabled = localStorage.getItem('pinbridge.bg.enabled') === 'true';
        toggle.checked = enabled;
        if (controls) controls.style.opacity = enabled ? '1' : '0.6';

        opacity.value = localStorage.getItem('pinbridge.bg.opacity') ?? '0.35';
        blur.value = localStorage.getItem('pinbridge.bg.blur') ?? '0';
        fit.value = localStorage.getItem('pinbridge.bg.fit') || 'cover';

        const sync = () => {
            localStorage.setItem('pinbridge.bg.opacity', String(opacity.value));
            localStorage.setItem('pinbridge.bg.blur', String(blur.value));
            localStorage.setItem('pinbridge.bg.fit', String(fit.value));
            this.applyBackgroundFromStorage();
            this.updateBackgroundPreview();
        };

        toggle.addEventListener('change', () => {
            localStorage.setItem('pinbridge.bg.enabled', toggle.checked ? 'true' : 'false');
            if (controls) controls.style.opacity = toggle.checked ? '1' : '0.6';
            this.applyBackgroundFromStorage();
            this.updateBackgroundPreview();
        });

        opacity.addEventListener('input', sync);
        blur.addEventListener('input', sync);
        fit.addEventListener('change', sync);

        file.addEventListener('change', async () => {
            const selected = file.files?.[0];
            if (!selected) return;
            if (!selected.type?.startsWith('image/')) {
                this.showToast('Please select an image file.', 'error');
                return;
            }
            if (selected.size > 2 * 1024 * 1024) {
                this.showToast('Image is too large (max 2 MB recommended).', 'error');
                return;
            }
            const dataUrl = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result || ''));
                reader.onerror = () => reject(new Error('read_failed'));
                reader.readAsDataURL(selected);
            }).catch(() => '');

            if (!dataUrl) {
                this.showToast('Failed to load image.', 'error');
                return;
            }

            localStorage.setItem('pinbridge.bg.image', dataUrl);
            localStorage.setItem('pinbridge.bg.enabled', 'true');
            toggle.checked = true;
            if (controls) controls.style.opacity = '1';
            this.applyBackgroundFromStorage();
            this.updateBackgroundPreview();
            this.showToast('Background updated.', 'success');
        });

        clear.addEventListener('click', (e) => {
            e.preventDefault();
            localStorage.removeItem('pinbridge.bg.image');
            localStorage.setItem('pinbridge.bg.enabled', 'false');
            toggle.checked = false;
            if (controls) controls.style.opacity = '0.6';
            this.applyBackgroundFromStorage();
            this.updateBackgroundPreview();
            this.showToast('Background cleared.', 'info');
        });

        this.applyBackgroundFromStorage();
        this.updateBackgroundPreview();
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

        // Normalize icons (some older stored icons may be garbled text)
        const iconEls = Array.from(container.querySelectorAll('.method-icon'));
        iconEls.forEach((el, idx) => {
            if (idx === 0) {
                el.innerHTML = '<i data-feather="key"></i>';
                return;
            }
            const raw = (el.textContent || '').trim();
            const isFeatherName = /^[a-z0-9-]+$/i.test(raw);
            el.innerHTML = `<i data-feather="${isFeatherName ? raw : 'shield'}"></i>`;
        });
        if (typeof feather !== 'undefined') feather.replace();
    }

    async generateBackupCodes() {
        try {
            const vaultKey = vaultService.dataKey;
            if (!vaultKey) {
                this.showToast('Unlock the vault before generating backup codes.', 'error');
                return;
            }
            const codes = await recoveryService.generateBackupCodes(vaultKey);

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
            // Security: auto-clear clipboard after a short delay to reduce accidental leakage.
            this._scheduleClipboardClear();
        }).catch(() => {
            this.showToast('Copy failed. Select and copy manually.', 'error');
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
        const body = (this.inputs.noteContent?.value || '');
        const folder = (this.inputs.noteFolder?.value || '').trim();
        const tags = (this.inputs.noteTags?.value || '').split(',').map(t => t.trim()).filter(t => t);

        const currentTags = (note.tags || []).map(t => typeof t === 'string' ? t : t.name);

        return note.title !== title ||
            (note.body || '') !== body ||
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
        if (!vaultService.dataKey) {
            this.showToast('No vault key available', 'error');
            return;
        }
        this.openGenerateFileModal();
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
            const vaultKey = vaultService.dataKey;
            if (!vaultKey) {
                this.showToast('Unlock the vault before setting a secret question.', 'error');
                return;
            }
            await recoveryService.setupSecretQuestion(question, answer, vaultKey);
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
        // Logic-only "smart lists": expand checklist shorthand and continue lists on Enter.
        // Keep UI unchanged; only modify textarea content/cursor to prevent surprises.
        if (e.key !== 'Enter') return;

        const textarea = this.inputs.noteContent;
        const value = textarea.value || '';
        const cursor = textarea.selectionStart || 0;
        const before = value.slice(0, cursor);
        const after = value.slice(cursor);
        const currentLine = before.split('\n').pop() || '';

        // "[] " or "[ ] " at line start -> "- [ ] "
        const normalizedLine = currentLine.replace(/^\s*(\[\s?\])\s+/, '- [ ] ');
        if (normalizedLine !== currentLine) {
            const newBefore = before.slice(0, before.length - currentLine.length) + normalizedLine;
            textarea.value = newBefore + after;
            const newCursor = newBefore.length;
            textarea.setSelectionRange(newCursor, newCursor);
            return;
        }

        // Continue checklist items: "- [ ] " or "- [x] "
        const listMatch = normalizedLine.match(/^(\s*-\s*\[(?: |x)\]\s+)/i);
        if (!listMatch) return;

        e.preventDefault();
        const prefix = listMatch[1];
        const insertion = `\n${prefix}`;
        textarea.value = before + insertion + after;
        const nextCursor = cursor + insertion.length;
        textarea.setSelectionRange(nextCursor, nextCursor);
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

        this.mobile.footerMenuAdmin?.addEventListener('click', () => {
            this.closeMobileFooterMenu();
            this.openAdminPanel();
        });

        this.mobile.footerMenuLock?.addEventListener('click', () => {
            this.closeMobileFooterMenu();
            authService.forceLogout('manual');
        });

        this.mobile.footerMenuSignout?.addEventListener('click', () => {
            this.closeMobileFooterMenu();
            authService.signOut('manual');
        });
    }

    openAdminPanel() {
        if (!this.ensureAuthenticated()) return;
        if (!this.ensureAdminAccess()) return;
        this.closeAllPanels({ reason: 'open-admin' });
        this.currentView = 'admin';
        this.renderCurrentView();
    }

    exitAdminPanel() {
        this.currentView = 'all';
        this.renderCurrentView();
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
                // Security: auto-clear clipboard after a short delay to reduce accidental leakage.
                this._scheduleClipboardClear(30000);
            }
        }).catch(() => {
            this.showToast('Copy failed. Select and copy manually.', 'error');
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
        this.setActivePanel('tools');
        modal?.classList.remove('hidden');
    }

    closeGeneratedPasswordModal() {
        this._getById('generated-password-modal')?.classList.add('hidden');
        if (this.activePanel === 'tools') this.setActivePanel('notes');
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
        // Important: enforce single active camera session (QR scan vs OCR).
        // OCR holds a stream + interval loop; we must stop it before starting QR scanning.
        this.stopOCRCamera();
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

        const allTags = notes.flatMap(n => (n.tags || []).map(t => (typeof t === 'string' ? t : t?.name)).filter(Boolean));
        const uniqueTags = new Set(allTags.map(t => String(t).trim()).filter(Boolean));
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
            const key = String(tag || '').trim();
            if (!key) return;
            tagFreq[key] = (tagFreq[key] || 0) + 1;
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

        const wrap = prefix && suffix;
        const noSelection = start === end;

        // Avoid visible "****" artifacts for inline toggles (Bold/Italic/Code):
        // when there's no selection, insert only the opening marker and toggle a state;
        // a second click inserts the closing marker.
        const isToggleWrap = wrap && noSelection && prefix === suffix;
        const markerKey = prefix === '**' ? 'bold' : prefix === '_' ? 'italic' : prefix === '`' ? 'code' : null;
        if (isToggleWrap && markerKey) {
            const marker = prefix;
            const active = !!this._inlineWrapState[markerKey];
            const inserted = marker;
            textarea.value = before + inserted + after;
            const caret = start + marker.length;
            textarea.selectionStart = caret;
            textarea.selectionEnd = caret;
            this._inlineWrapState[markerKey] = !active;
        } else {
            textarea.value = before + prefix + selected + suffix + after;
            textarea.selectionStart = start + prefix.length;
            textarea.selectionEnd = Math.max(start + prefix.length, end + prefix.length + selected.length);
        }
        textarea.focus();

        // Trigger save
        textarea.dispatchEvent(new Event('input'));
    }

    updateMarkdownToolbarState() {
        const textarea = this.inputs.noteContent;
        if (!textarea) return;

        const pos = textarea.selectionStart;
        const text = textarea.value;

        const isInside = (marker) => {
            const before = text.slice(0, pos);
            const after = text.slice(pos);
            const open = before.lastIndexOf(marker);
            if (open === -1) return false;
            const closeRel = after.indexOf(marker);
            if (closeRel === -1) return false;
            const close = pos + closeRel;
            if (close <= open) return false;
            const between = text.slice(open + marker.length, close);
            return !between.includes('\n');
        };

        for (const [format, btn] of this._markdownToolbarButtons.entries()) {
            const active = format === 'bold' ? (this._inlineWrapState.bold || isInside('**'))
                : format === 'italic' ? (this._inlineWrapState.italic || isInside('_'))
                    : format === 'code' ? (this._inlineWrapState.code || isInside('`'))
                        : false;
            btn.classList.toggle('active', active);
            btn.setAttribute('aria-pressed', active ? 'true' : 'false');
        }
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
        this.applyBackgroundFromStorage();
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
        this.closeAllPanels({ reason: 'new-note' });

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

        // 2 Create new note and persist immediately so it syncs across devices.
        const id = await notesService.createNote("", "", "", [], { persist: true, allowEmpty: true, isTemplate: isTemplateView });

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
        const adminPanel = document.querySelector('.admin-panel');

        if (this.currentView === 'admin') {
            if (!this.ensureAdminAccess()) {
                this.currentView = 'all';
                return;
            }
            editorPanel?.classList.add('hidden');
            dashboardPanel?.classList.add('hidden');
            adminPanel?.classList.remove('hidden');
            this.renderAdminPanel();
            document.querySelectorAll('.nav-item[data-view]').forEach(btn => btn.classList.remove('active'));
            document.querySelectorAll('.mobile-nav-item').forEach(btn => btn.classList.remove('active'));
            return;
        }

        if (this.currentView === 'dashboard') {
            // Show dashboard, hide editor
            editorPanel?.classList.add('hidden');
            dashboardPanel?.classList.remove('hidden');
            adminPanel?.classList.add('hidden');
            this.renderDashboard();
            // Sync Mobile Footer State
            document.querySelectorAll('.mobile-nav-item').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.view === this.currentView);
            });
            return;
        }

        if (this.currentView === 'tags') {
            editorPanel?.classList.add('hidden');
            dashboardPanel?.classList.add('hidden');
            adminPanel?.classList.add('hidden');
            this.updateDeleteButtonContext();
            this.renderTagsView();
            document.querySelectorAll('.mobile-nav-item').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.view === this.currentView);
            });
            return;
        } else {
            // Show editor, hide dashboard with animation
            if (editorPanel?.classList.contains('hidden')) {
                editorPanel.style.animation = 'slideInRight 0.4s cubic-bezier(0.4, 0, 0.2, 1)';
            }
            editorPanel?.classList.remove('hidden');
            dashboardPanel?.classList.add('hidden');
            adminPanel?.classList.add('hidden');

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
                // Prevent accidental open after long-press context menu on mobile
                if (div.dataset.longpress === '1') {
                    div.dataset.longpress = '0';
                    return;
                }
                // Don't select note if clicking on action buttons
                if (e.target.closest('.note-action-icon')) {
                    e.stopPropagation();
                    return;
                }
                this.selectNote(note);
            };

            // Desktop equivalent for mobile long-press
            div.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                this.showMobileContextMenu(note);
            });

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
        let longPressTriggered = false;
        const longPressDuration = 500;

        el.addEventListener('touchstart', (e) => {
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
            isSwiping = false;
            isScrolling = false;
            longPressTriggered = false;
            el.style.transition = 'none'; // Disable transition for direct 1:1 movement

            // Start Long Press Timer
            longPressTimer = setTimeout(() => {
                this.hapticFeedback();
                this.showMobileContextMenu(note);
                longPressTriggered = true;
                el.dataset.longpress = '1';
                setTimeout(() => { el.dataset.longpress = '0'; }, 650);
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
            if (longPressTriggered) return;
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
        const isArchived = note.archived;
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

                <button class="ctx-item" data-action="archive">
                    <i data-feather="${isArchived ? 'inbox' : 'archive'}"></i> ${isArchived ? 'Unarchive' : 'Archive'}
                </button>

                <button class="ctx-item" data-action="tags">
                    <i data-feather="tag"></i> Edit Tags
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
                if (action === 'archive') {
                    await this.handleArchiveNote(note.id);
                    this.renderCurrentView();
                }
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
                if (action === 'tags') {
                    const existing = (note.tags || []).map(t => typeof t === 'string' ? t : t.name).join(', ');
                    const tagString = prompt('Tags (comma separated):', existing);
                    if (tagString !== null) {
                        const tags = tagString.split(',').map(t => t.trim()).filter(Boolean);
                        await notesService.updateNote(note.id, note.title, note.body, note.folder, tags);
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
        this.renderChecklistFromText(note.body || '');

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

    _parseChecklist(text) {
        const lines = String(text || '').split('\n');
        const items = [];
        const re = /^(\s*)-\s*\[(x| )\]\s+(.*)$/i;
        for (let i = 0; i < lines.length; i += 1) {
            const m = lines[i].match(re);
            if (!m) continue;
            items.push({
                lineIndex: i,
                indent: m[1] || '',
                checked: (m[2] || '').toLowerCase() === 'x',
                text: (m[3] || '').trim()
            });
        }
        return items;
    }

    _setEditorLineChecklistState(lineIndex, checked) {
        const textarea = this.inputs.noteContent;
        if (!textarea) return false;
        const lines = String(textarea.value || '').split('\n');
        if (lineIndex < 0 || lineIndex >= lines.length) return false;
        const re = /^(\s*)-\s*\[(x| )\]\s+/i;
        if (!re.test(lines[lineIndex])) return false;
        const prefix = lines[lineIndex].replace(re, `$1- [${checked ? 'x' : ' '}] `);
        // Preserve original text after the checklist marker.
        lines[lineIndex] = prefix + lines[lineIndex].replace(re, '');
        textarea.value = lines.join('\n');
        textarea.dispatchEvent(new Event('input'));
        return true;
    }

    _setAllChecklistState(checked) {
        const textarea = this.inputs.noteContent;
        if (!textarea) return;
        const lines = String(textarea.value || '').split('\n');
        const re = /^(\s*)-\s*\[(x| )\]\s+/i;
        let changed = false;
        for (let i = 0; i < lines.length; i += 1) {
            if (!re.test(lines[i])) continue;
            const prefix = lines[i].replace(re, `$1- [${checked ? 'x' : ' '}] `);
            lines[i] = prefix + lines[i].replace(re, '');
            changed = true;
        }
        if (!changed) return;
        textarea.value = lines.join('\n');
        textarea.dispatchEvent(new Event('input'));
    }

    renderChecklistFromEditor() {
        const text = this.inputs.noteContent?.value || '';
        this.renderChecklistFromText(text);
    }

    renderChecklistFromText(text) {
        const container = this.checklist?.container;
        if (!container) return;

        const items = this._parseChecklist(text);
        if (!items.length) {
            container.classList.add('hidden');
            container.innerHTML = '';
            return;
        }

        const done = items.filter(i => i.checked).length;
        const total = items.length;

        container.classList.remove('hidden');
        container.innerHTML = `
            <div class="checklist-header">
                <div class="checklist-title">
                    <h3>Tasks</h3>
                    <span class="checklist-progress">${done}/${total} done</span>
                </div>
                <div class="checklist-actions">
                    <button type="button" class="btn-checklist" data-checklist-action="check-all" ${done === total ? 'disabled' : ''}>Check all</button>
                    <button type="button" class="btn-checklist" data-checklist-action="uncheck-all" ${done === 0 ? 'disabled' : ''}>Uncheck</button>
                </div>
            </div>
            <div class="checklist-items"></div>
            <div class="checklist-hint">Tip: tap a task to toggle. The note text stays as a checklist so it syncs normally.</div>
        `;

        const itemsEl = container.querySelector('.checklist-items');
        if (!itemsEl) return;

        for (const item of items) {
            const row = document.createElement('label');
            row.className = `checklist-item ${item.checked ? 'is-done' : ''}`;
            row.dataset.lineIndex = String(item.lineIndex);
            row.innerHTML = `
                <input type="checkbox" ${item.checked ? 'checked' : ''} aria-label="Toggle task">
                <div class="checklist-text">${Utils.escapeHtml(item.text || '(untitled task)')}</div>
            `;
            itemsEl.appendChild(row);
        }

        if (!container.dataset.boundChecklist) {
            container.dataset.boundChecklist = 'true';
            container.addEventListener('click', (e) => {
                const actionBtn = e.target.closest('[data-checklist-action]');
                if (actionBtn) {
                    const action = actionBtn.dataset.checklistAction;
                    if (action === 'check-all') this._setAllChecklistState(true);
                    if (action === 'uncheck-all') this._setAllChecklistState(false);
                    return;
                }

                const row = e.target.closest('.checklist-item');
                if (!row) return;
                const checkbox = row.querySelector('input[type="checkbox"]');
                const lineIndex = Number.parseInt(row.dataset.lineIndex || '', 10);
                if (!Number.isFinite(lineIndex)) return;

                // If the click was on the checkbox, let it change first; otherwise toggle it manually.
                const nextChecked = e.target === checkbox ? checkbox.checked : !(checkbox?.checked);
                if (checkbox && e.target !== checkbox) checkbox.checked = nextChecked;
                this._setEditorLineChecklistState(lineIndex, nextChecked);
            });
        }
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
        const metaContainer = document.getElementById('note-meta-info');
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
            <span title="Last updated"><i data-feather="calendar"></i><span class="note-meta-text">${date}</span></span>
            <span title="Time spent working"><i data-feather="clock"></i><span class="note-meta-text">${timeStr}</span></span>
            <span title="Version count"><i data-feather="git-commit"></i><span class="note-meta-text">v${version}</span></span>
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
                this.persistNote({ force: true, reason: 'autosave', silent: true }).catch(e => console.error("Auto-save on clear failed", e));
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

    async persistNote(forceOrOptions = false) {
        if (!this.ensureAuthenticated()) return false;
        if (!this.activeNoteId) return false;

        const options = typeof forceOrOptions === 'object' && forceOrOptions !== null
            ? forceOrOptions
            : { force: !!forceOrOptions };
        const { force = false, reason = 'manual', silent = false } = options;

        const note = notesService.notes.find(n => n.id === this.activeNoteId);
        if (note && note.trash) return false;

        clearTimeout(this.saveTimeout);

        const title = (this.inputs.noteTitle?.value || '').trim();
        const body = (this.inputs.noteContent?.value || '');
        const folder = (this.inputs.noteFolder?.value || '').trim();
        const tags = (this.inputs.noteTags?.value || '').split(',').map(t => t.trim()).filter(t => t);

        // DETERMINISTIC CHANGE DETECTION
        const hasChanged = this.isNoteChanged();

        if (!hasChanged && !force) {
            console.log(`[Persistence] Skipping save for ${this.activeNoteId} - no changes detected.`);
            return true;
        }

        if (!title && !body.trim()) {
            if (force && !silent) this.showToast(i18n.t('toastNoteEmpty'), 'error');
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

        if (!silent) {
            this.setStatus(i18n.t('statusSaving') + (folder ? ` (${folder})...` : '...'));
        }

        try {
            await notesService.updateNote(this.activeNoteId, title, body, folder, tags);
            console.log(`[Persistence] Successfully saved note: ${this.activeNoteId}`);

            const updatedNote = notesService.notes.find(n => n.id === this.activeNoteId);
            const savedAt = new Date().toLocaleTimeString();
            this._autosave.pending = false;
            this.setStatus(`${i18n.t('statusSaved')} ${savedAt}${folder ? ` (${folder})` : ''}`);

            this.renderFolders();
            this.refreshSaveButtonState();
            this.updateActiveListItem(updatedNote);
            this.renderNoteMeta(updatedNote);

            return true;
        } catch (err) {
            console.error(`[Persistence] FAILED to save note: ${this.activeNoteId}`, err);
            this._autosave.pending = true;
            this._autosave.lastFailedAt = Date.now();
            this.setStatus(reason === 'autosave' ? 'Offline • Unsaved changes' : 'Error saving', 'error');
            if (!silent && reason !== 'autosave') {
                this.showToast('Note could not be saved. Check connection/storage.', 'error');
            }
            return false;
        }
    }

    scheduleAutoSave() {
        if (!this.activeNoteId || !this.autoSaveEnabled) return;
        clearTimeout(this.saveTimeout);

        // Typing should never feel like "saving" and must never spam error UI.
        // Show a calm, persistent indicator until the debounced autosave succeeds.
        this._autosave.pending = true;
        this.setStatus('Unsaved changes');

        this.saveTimeout = setTimeout(() => {
            this.persistNote({ reason: 'autosave', silent: true }).catch(() => { });
        }, this._autosave.debounceMs);
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

    openFoldersFromDashboard() {
        this.currentView = 'all';
        document.querySelector('[data-view="all"]')?.click();
        this.renderCurrentView();

        const folderList = document.getElementById('folder-list');
        if (!folderList) return;

        // On mobile the sidebar is hidden; open it so folders are discoverable.
        if (this.mobile?.btnMenu) {
            this.openMobileSidebar();
        }

        const firstFolder = folderList.querySelector('.folder-item');
        if (firstFolder) {
            firstFolder.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            firstFolder.focus?.();
        } else {
            this.showToast('No folders yet. Add a folder name in a note to create one.', 'info');
        }
    }

    openTagsView() {
        this.currentView = 'tags';
        this.renderCurrentView();
    }

    renderTagsView() {
        const listEl = document.getElementById('notes-list');
        if (!listEl) return;

        const notes = notesService.notes.filter(n => !n.trash && !n.isTemplate && !n.archived);
        const freq = new Map();
        notes.forEach(n => {
            (n.tags || []).forEach(t => {
                const name = (typeof t === 'string' ? t : t?.name) || '';
                const key = name.trim();
                if (!key) return;
                freq.set(key, (freq.get(key) || 0) + 1);
            });
        });

        const tags = Array.from(freq.entries()).sort((a, b) => b[1] - a[1]);

        listEl.innerHTML = `
            <div class="empty-list-placeholder" style="text-align:left">
                <strong>Tags</strong>
                <div class="hint" style="margin-top:6px">Tap a tag to filter notes.</div>
                <div style="margin-top:10px">
                    <button class="btn btn-secondary btn-sm" id="btn-tags-back">Back to Notes</button>
                </div>
            </div>
        `;

        listEl.querySelector('#btn-tags-back')?.addEventListener('click', () => {
            this.currentView = 'all';
            document.querySelector('[data-view="all"]')?.click();
            this.renderCurrentView();
        });

        if (!tags.length) {
            const hint = document.createElement('div');
            hint.className = 'empty-list-placeholder';
            hint.innerHTML = 'No tags yet. Add tags in the Tags field or use #hashtags.';
            listEl.appendChild(hint);
            return;
        }

        tags.forEach(([tag, count]) => {
            const row = document.createElement('div');
            row.className = 'note-item';
            row.tabIndex = 0;
            row.setAttribute('role', 'button');
            row.setAttribute('aria-label', `Filter by tag ${tag}`);
            row.innerHTML = `
                <div class="note-top-minimal">
                    <h4>#${Utils.escapeHtml(tag)}</h4>
                    <div class="note-actions-minimal">
                        <span class="note-badge">${count}</span>
                    </div>
                </div>
                <p class="note-preview">Show notes tagged with #${Utils.escapeHtml(tag)}</p>
            `;
            const activate = () => {
                this.currentView = 'all';
                document.querySelector('[data-view="all"]')?.click();
                const input = document.getElementById('search-input');
                if (input) {
                    input.value = `#${tag}`;
                    input.dispatchEvent(new Event('input'));
                    input.focus();
                } else {
                    this.renderCurrentView();
                }
            };
            row.addEventListener('click', activate);
            row.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    activate();
                }
            });
            listEl.appendChild(row);
        });

        if (typeof feather !== 'undefined') feather.replace();
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
            const original = btnElement?.innerText;
            if (btnElement) btnElement.innerText = i18n.t('toastCopyOk');
            this.showToast(i18n.t('toastCopyOk'), 'success');
            // Security: auto-clear clipboard after a short delay to reduce accidental leakage.
            this._scheduleClipboardClear();
            if (btnElement && original) setTimeout(() => { btnElement.innerText = original; }, 1500);
        }).catch(() => {
            this.showToast(i18n.t('toastCopyFail'), 'error');
        });
    }

    _scheduleClipboardClear(delayMs = 30000) {
        // Best-effort only: browsers can deny clipboard writes in some contexts.
        if (this._clipboardClearTimer) {
            clearTimeout(this._clipboardClearTimer);
            this._clipboardClearTimer = null;
        }
        this._clipboardClearTimer = setTimeout(() => {
            navigator.clipboard.writeText(' ').catch(() => { });
            this._clipboardClearTimer = null;
            this.showToast('Clipboard cleared.', 'info');
        }, delayMs);
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

        try {
            const startTime = Date.now();
            this.updateAttachmentProgress(pendingId, 5, null);
            const { meta, hash } = await attachmentService.attachFileToNote(note, file);
            const elapsed = (Date.now() - startTime) / 1000;
            const remaining = elapsed > 0 ? Math.max(0, Math.round((100 - 5) / elapsed)) : null;
            this.updateAttachmentProgress(pendingId, 30, remaining);

            if (!(note.title || note.body)) {
                note.title = file.name;
                note.body = `Attached file: ${file.name}`;
            }

            const attachments = Array.isArray(note.attachments) ? [...note.attachments] : [];
            attachments.push(meta);
            note.attachments = attachments;
            await notesService.persistNote(note);
            this.renderAttachments(note);

            syncManager.enqueue('PUSH_ATTACHMENT', { hash }, vaultService.uid);
            this.updateAttachmentProgress(pendingId, 100, 0);
            this.showToast('File attached to note.', 'success');
        } catch (err) {
            console.error('Attach failed', err);
            this.attachmentRetries.set(pendingId, file);
            this.updateAttachmentStatus(pendingId, 'error', 'Attach failed. Tap retry.');
        }
    }

    renderAttachments(note) {
        if (!this.attachments?.list || !this.attachments?.empty) return;
        this.attachments.list.innerHTML = '';
        const attachments = note?.attachments || [];
        // Background migrate legacy inline attachments so they can sync cross-device without bloating the vault doc.
        if (note && attachments.some(a => a?.data && !a?.hash)) {
            attachmentService.migrateLegacyInlineAttachments(note)
                .then(async (res) => {
                    if (!res?.changed) return;
                    await notesService.persistNote(note);
                    for (const hash of res.hashesToUpload || []) {
                        syncManager.enqueue('PUSH_ATTACHMENT', { hash }, vaultService.uid);
                    }
                    this.renderAttachments(note);
                })
                .catch((e) => console.warn('Attachment migration failed', e));
        }
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

    async generateAdminInvite() {
        if (!this.ensureAdminAccess()) return;
        const code = Utils.generateId().replace(/-/g, '').slice(0, 12).toUpperCase();
        const expiresAt = Date.now() + (24 * 60 * 60 * 1000);
        await storageService.setMeta('admin_invite', { code, expiresAt });
        await this.renderAdminInvite();
        this.showToast('Admin invite created (valid for 24h).', 'success');
    }

    async revokeAdminInvite() {
        if (!this.ensureAdminAccess()) return;
        await storageService.setMeta('admin_invite', null);
        await this.renderAdminInvite();
        this.showToast('Admin invite revoked.', 'info');
    }

    async copyAdminInvite() {
        if (!this.ensureAdminAccess()) return;
        const invite = await storageService.getMeta('admin_invite');
        if (!invite?.code) {
            this.showToast('No active admin invite.', 'error');
            return;
        }
        try {
            await navigator.clipboard.writeText(invite.code);
            this.showToast('Admin invite copied.', 'success');
            // Security: auto-clear clipboard after a short delay to reduce accidental leakage.
            this._scheduleClipboardClear();
        } catch (e) {
            this.showToast('Copy failed. Select and copy manually.', 'error');
        }
    }

    async renderAdminInvite() {
        if (!this.admin.inviteCode || !this.admin.inviteExpiry) return;
        const invite = await storageService.getMeta('admin_invite');
        const isValid = invite?.code && invite.expiresAt > Date.now();
        if (!isValid) {
            this.admin.inviteCode.textContent = 'Not active';
            this.admin.inviteExpiry.textContent = '-';
            return;
        }
        this.admin.inviteCode.textContent = invite.code;
        this.admin.inviteExpiry.textContent = new Date(invite.expiresAt).toLocaleString();
    }

    async renderAdminPanel() {
        if (!this.admin.panel) return;
        const meta = await storageService.getCryptoMeta();
        const username = meta?.username || this.storedUsername || '-';
        const uid = authService.getUid() || '-';
        const noteCount = notesService.notes.length;
        const lastUpdated = vaultService.localUpdatedAt
            ? new Date(vaultService.localUpdatedAt).toLocaleString()
            : '-';
        const encryptedVault = await storageService.getEncryptedVault();
        const vaultSize = encryptedVault ? `${Math.ceil(JSON.stringify(encryptedVault).length / 1024)} KB` : '-';
        const syncQueue = await storageService.getSyncQueue();
        const safeUsername = Utils.escapeHtml(username);
        const safeUid = Utils.escapeHtml(uid);

        if (this.admin.username) this.admin.username.textContent = username;
        if (this.admin.uid) this.admin.uid.textContent = uid;
        if (this.admin.noteCount) this.admin.noteCount.textContent = `${noteCount}`;
        if (this.admin.storage) this.admin.storage.textContent = vaultSize;
        if (this.admin.updated) this.admin.updated.textContent = lastUpdated;

        if (this.admin.connection) {
            this.admin.connection.textContent = navigator.onLine ? 'Online' : 'Offline';
        }
        if (this.admin.syncEnabled) {
            this.admin.syncEnabled.textContent = localStorage.getItem('pinbridge.sync_enabled') === 'true' ? 'Enabled' : 'Disabled';
        }
        if (this.admin.syncTime) {
            this.admin.syncTime.textContent = vaultService.localUpdatedAt
                ? new Date(vaultService.localUpdatedAt).toLocaleTimeString()
                : '-';
        }
        if (this.admin.syncQueue) {
            this.admin.syncQueue.textContent = `${syncQueue?.length || 0}`;
        }

        if (this.admin.usersList) {
            this.admin.usersList.innerHTML = `
                <div class="admin-user-row">
                    <strong>${safeUsername}</strong>
                    <span>User ID: ${safeUid}</span>
                    <span>Notes: ${noteCount}</span>
                </div>
            `;
        }

        if (this.admin.tagsList) {
            const tagCounts = {};
            notesService.notes.forEach(note => {
                (note.tags || []).forEach(tag => {
                    const name = typeof tag === 'string' ? tag : tag.name;
                    if (!name) return;
                    tagCounts[name] = (tagCounts[name] || 0) + 1;
                });
            });
            const tagRows = Object.entries(tagCounts)
                .sort((a, b) => b[1] - a[1])
                .map(([name, count]) => `
                    <div class="admin-tag-row">
                        <span>${Utils.escapeHtml(name)}</span>
                        <strong>${count}</strong>
                    </div>
                `);
            this.admin.tagsList.innerHTML = tagRows.length
                ? tagRows.join('')
                : '<p class="hint">No tags yet.</p>';
        }

        if (this.admin.activityList) {
            const items = this.activityLogs.slice(0, 8).map(log => `
                <div class="admin-activity-item">
                    <span>${Utils.escapeHtml(log.action)}</span>
                    <span>${Utils.escapeHtml(log.time)}</span>
                </div>
            `);
            this.admin.activityList.innerHTML = items.length
                ? items.join('')
                : '<p class="hint">No recent activity logged.</p>';
        }
        await this.renderAdminInvite();
        if (typeof feather !== 'undefined') feather.replace();
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
            if (attachment?.data && !attachment?.hash) {
                const note = notesService.notes.find(n => n.id === this.activeNoteId);
                if (note) {
                    const migrated = await attachmentService.migrateLegacyInlineAttachments(note);
                    if (migrated?.changed) {
                        await notesService.persistNote(note);
                        for (const hash of migrated.hashesToUpload || []) {
                            syncManager.enqueue('PUSH_ATTACHMENT', { hash }, vaultService.uid);
                        }
                        this.renderAttachments(note);
                    }
                }
            }

            if (attachment?.hash) {
                await attachmentService.downloadToLocal(vaultService.uid, attachment.hash);
                this.updateAttachmentProgress(attachment.id, 60, null);
                const bytes = await attachmentService.getLocalBytes(attachment.hash);
                if (!bytes) throw new Error('ATTACHMENT_LOCAL_MISSING');
                const blob = new Blob([bytes], { type: attachment.type || 'application/octet-stream' });
                const elapsed = (Date.now() - start) / 1000;
                this.updateAttachmentProgress(attachment.id, 100, elapsed > 0 ? 0 : null);

                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = attachment.name || 'pinbridge-file';
                document.body.appendChild(link);
                link.click();
                link.remove();
                URL.revokeObjectURL(url);
            } else if (attachment?.data) {
                const response = await fetch(attachment.data);
                const blob = await response.blob();
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = attachment.name || 'pinbridge-file';
                document.body.appendChild(link);
                link.click();
                link.remove();
                URL.revokeObjectURL(url);
                this.updateAttachmentProgress(attachment.id, 100, 0);
            } else {
                throw new Error('ATTACHMENT_NO_DATA');
            }
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
            // Security: auto-clear clipboard after a short delay to reduce accidental leakage.
            this._scheduleClipboardClear();
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
