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
        this.autoSaveEnabled = localStorage.getItem('pinbridge.auto_save') === 'true';
        this.compactViewEnabled = localStorage.getItem('pinbridge.compact_notes') === 'true';
        this.saveTimeout = null;
        this.isFocusMode = false;
        this.isReadOnly = false; // Read-only mode state
    }

    _cacheDomElements() {
        this.screens = {
            loading: document.getElementById('loading-screen'),
            auth: document.getElementById('auth-screen'),
            vault: document.getElementById('vault-screen'),
            dashboard: document.getElementById('dashboard-screen') // Added dashboard screen
        };

        this.forms = {
            choice: document.getElementById('auth-choice'),
            setup: document.getElementById('auth-setup'),
            login: document.getElementById('auth-login'),
            setupForm: document.getElementById('setup-form'),
            loginForm: document.getElementById('login-form'),
            btnCreateStart: document.getElementById('btn-create-start'),
            btnLoginStart: document.getElementById('btn-login-start'),
            btnShowSetup: document.getElementById('btn-show-setup'),
            btnShowLogin: document.getElementById('btn-show-login')
        };

        this.inputs = {
            setupUsername: document.getElementById('setup-username'),
            setupPin: document.getElementById('setup-pin'),
            setupPinConfirm: document.getElementById('setup-pin-confirm'),
            loginPin: document.getElementById('login-pin'),
            loginRecovery: document.getElementById('login-recovery'),
            noteTitle: document.getElementById('note-title'),
            noteContent: document.getElementById('note-content'),
            noteFolder: document.getElementById('note-folder'),
            noteTags: document.getElementById('note-tags'),
            search: document.getElementById('search-input'),
            quickDrop: document.getElementById('quick-drop-input')
        };

        this.quickDropZone = document.getElementById('quick-drop-zone');

        this.recoveryModal = {
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

        const topbar = document.getElementById('mobile-topbar');
        this.mobile = {
            topbar,
            navPills: topbar ? Array.from(topbar.querySelectorAll('.nav-pill')) : [],
            btnNew: document.getElementById('mobile-new-note'),
            btnLock: document.getElementById('mobile-lock'),
            btnMenu: document.getElementById('btn-mobile-menu'),
            backdrop: document.getElementById('mobile-nav-backdrop')
        };
    }
    
    _getById(id) {
        const el = document.getElementById(id);
        if (!el) {
            console.warn(`UI element with id "${id}" not found.`);
        }
        return el;
    }

    init() {
        this._cacheDomElements();
        this.setupLanguageSelector();
        this.applyTranslations();
        this.createCommandPalette();
        this.addEventListeners();
        this.updateAutoSaveUI();
        this.updateCompactViewUI();
        this.refreshSaveButtonState();
        this.setStatus(i18n.t('statusReady'));
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
        requestAnimationFrame(() => toast.classList.add('visible'));
        setTimeout(() => {
            toast.classList.remove('visible');
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    showScreen(name) {
        Object.values(this.screens).forEach(el => el?.classList.add('hidden'));
        this.screens[name]?.classList.remove('hidden');
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

        window.addEventListener('beforeunload', (e) => {
            // Check if save button is enabled (unsaved changes)
            const saveBtn = document.getElementById('btn-save-note');
            if (saveBtn && !saveBtn.disabled) {
                e.preventDefault();
                e.returnValue = ''; // Standard for showing alert
            }
        });
    }

    addAuthEventListeners() {
        this.forms.btnCreateStart?.addEventListener('click', () => this.showSetupForm());
        this.forms.btnLoginStart?.addEventListener('click', () => this.showLoginForm());
        this.forms.btnShowSetup?.addEventListener('click', () => this.showSetupForm());
        this.forms.btnShowLogin?.addEventListener('click', () => this.showLoginForm());

        this.forms.setupForm?.addEventListener('submit', (e) => this.handleSetupSubmit(e));
        this.forms.loginForm?.addEventListener('submit', (e) => this.handleLoginSubmit(e));

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
            this.inputs.loginRecovery?.focus();
            this.inputs.loginRecovery?.classList.add('input-focus-hint');
            setTimeout(() => this.inputs.loginRecovery?.classList.remove('input-focus-hint'), 1200);
            this.showToast(i18n.t('toastRecoveryHint'), 'info');
        });

        this.settingsModal.syncBtn?.addEventListener('click', () => {
            this.hideSettingsModal();
            settingsService.renderSettingsModal();
        });

        this.settingsModal.resetBtn?.addEventListener('click', async () => {
            this.hideSettingsModal();
            await this.handleResetLocal();
        });

        // Account Recovery
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

    showAuthRecoveryModal() {
        // Hide other auth views
        this.forms.choice?.classList.add('hidden');
        this.forms.login?.classList.add('hidden');
        this.forms.setup?.classList.add('hidden');
        // The auth-recovery div is now inside the modal, so we show the modal overlay
        this.recoveryModal.authRecoveryOverlay?.classList.remove('hidden');
        document.body.style.overflow = 'hidden'; // Prevent scrolling behind modal

        // Load secret question if available
        this.loadSecretQuestion();
    }

    hideAuthRecoveryModal() {
        this.recoveryModal.authRecoveryOverlay?.classList.add('hidden');
        document.body.style.overflow = ''; // Restore scrolling
        this.loadSecretQuestion();
    }

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

    showAuthChoice() {
        this.forms.choice?.classList.remove('hidden');
        this.forms.setup?.classList.add('hidden');
        this.forms.login?.classList.add('hidden');
        this.recoveryModal.authRecoveryOverlay?.classList.add('hidden'); // Hide new modal
    }

    showSetupForm() {
        this.forms.choice?.classList.add('hidden');
        this.forms.login?.classList.add('hidden');
        this.forms.setup?.classList.remove('hidden');
        this.recoveryModal.authRecoveryOverlay?.classList.add('hidden'); // Hide new modal
        this.inputs.setupUsername?.focus();
    }

    showLoginForm() {
        this.forms.choice?.classList.add('hidden');
        this.forms.setup?.classList.add('hidden');
        this.forms.login?.classList.remove('hidden');
        this.recoveryModal.authRecoveryOverlay?.classList.add('hidden'); // Hide new modal
        this.inputs.loginPin?.focus();
    }

    async handleSetupSubmit(e) {
        e.preventDefault();
        const username = (this.inputs.setupUsername?.value || '').trim();
        const p1 = (this.inputs.setupPin?.value || '').trim();
        const p2 = (this.inputs.setupPinConfirm?.value || '').trim();

        if (!username) {
            this.showToast(i18n.t('authErrorUsernameRequired'), 'error');
            return;
        }
        if (!p1 || !p2) {
            this.showToast(i18n.t('authErrorPinRequired'), 'error');
            return;
        }
        if (p1 !== p2) {
            this.showToast(i18n.t('authErrorPinMismatch'), 'error');
            return;
        }

        try {
            const hasVault = await vaultService.hasExistingVault();
            if (hasVault) {
                const confirmReset = confirm(i18n.t('settingsResetConfirm'));
                if (!confirmReset) {
                    this.showLoginForm();
                    return;
                }
                await storageService.resetAll();
            }

            const recoveryKey = await authService.createVault(username, p1);
            this.showRecoveryKeyModal(recoveryKey, async () => {
                await storageService.setMeta('vault_username', username);
                this.showToast(i18n.t('toastWelcomeBack'), 'success');
            });
        } catch (err) {
            this.showToast(i18n.t('toastVaultLoadFailed', { error: err?.message || 'error' }), 'error');
        }
    }

    async handleLoginSubmit(e) {
        e.preventDefault();
        const pin = (this.inputs.loginPin?.value || '').trim();
        const recovery = (this.inputs.loginRecovery?.value || '').trim();

        if (!pin && !recovery) {
            this.showToast(i18n.t('authErrorPinRequired'), 'error');
            return;
        }

        try {
            if (recovery) {
                await authService.unlockWithRecovery(recovery);
            } else {
                await authService.unlockWithPin(pin);
            }

            const welcomeName = vaultService.meta?.username || await storageService.getMeta('vault_username');
            const greeting = welcomeName ? i18n.t('toastWelcomeNamed', { name: welcomeName }) : i18n.t('toastWelcomeBack');
            this.showToast(recovery ? i18n.t('toastRecoveryUnlocked') : greeting, 'success');
        } catch (err) {
            this.showToast(this.resolveAuthErrorMessage(err?.message || err), 'error');
            if (this.inputs.loginPin) this.inputs.loginPin.value = '';
            if (this.inputs.loginRecovery) this.inputs.loginRecovery.value = '';

            const code = err?.message || err;
            if (code === 'VAULT_METADATA_MISSING' || code === 'NO_VAULT') {
                this.showSetupForm();
                this.inputs.setupUsername?.focus();
            }
        }
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
        document.querySelectorAll('.nav-item, .folder-item').forEach(el => el.classList.remove('active'));
        
        // Don't show a toast on initial load when no session is found
        if (reason === 'no-session') return;

        const msg = reason === 'idle' ? i18n.t('toastVaultLockedIdle') : i18n.t('toastVaultLocked');
        this.showToast(msg, 'info');
    }

    addVaultEventListeners() {
        document.querySelectorAll('.nav-item').forEach(btn => {
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
        this.settingsModal.overlay?.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
    }

    hideSettingsModal() {
        this.settingsModal.overlay?.classList.add('hidden');
        document.body.style.overflow = '';
    }

    addEditorEventListeners() {
        this.inputs.noteTitle?.addEventListener('input', () => {
            this.scheduleAutoSave();
            this.refreshSaveButtonState();
        });

        this.inputs.noteContent?.addEventListener('input', () => {
            this.scheduleAutoSave();
            this.refreshSaveButtonState();
            this.updateWordCount();
        });

        this.inputs.noteFolder?.addEventListener('input', () => this.scheduleAutoSave());
        this.inputs.noteTags?.addEventListener('input', () => this.scheduleAutoSave());

        document.getElementById('btn-delete')?.addEventListener('click', () => this.handleDelete());
        document.getElementById('btn-save-note')?.addEventListener('click', async () => {
            try {
                const success = await this.persistNote(true);
                if (success) this.showToast(i18n.t('toastNoteSaved'), 'success');
            } catch (err) {
                console.error('Save failed', err);
                this.showToast(i18n.t('toastVaultLoadFailed', { error: 'Save Error' }), 'error');
            }
        });
        document.getElementById('btn-toggle-autosave')?.addEventListener('click', () => this.toggleAutoSave());

        // Formatting & Tools
        document.getElementById('btn-md-bold')?.addEventListener('click', () => this.insertMarkdown('**', '**'));
        document.getElementById('btn-md-italic')?.addEventListener('click', () => this.insertMarkdown('_', '_'));
        document.getElementById('btn-md-list')?.addEventListener('click', () => this.insertMarkdown('\n- ', ''));
        document.getElementById('btn-md-check')?.addEventListener('click', () => this.insertMarkdown('\n- [ ] ', ''));

        // Focus Mode
        document.getElementById('btn-focus-mode')?.addEventListener('click', () => this.toggleFocusMode());
        document.getElementById('btn-exit-focus-mode')?.addEventListener('click', () => this.toggleFocusMode(false));

        document.getElementById('btn-duplicate')?.addEventListener('click', () => this.handleDuplicate());
        document.getElementById('btn-download')?.addEventListener('click', () => this.handleDownload());
        document.getElementById('btn-pin-note')?.addEventListener('click', () => this.handlePinNote());

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

        // Settings Modal
        document.getElementById('btn-settings')?.addEventListener('click', () => this.openSettingsModal());
        document.getElementById('close-settings-modal')?.addEventListener('click', () => {
            document.getElementById('settings-modal').classList.add('hidden');
        });
        
        // Theme switcher logic
        const themeSwitcher = document.getElementById('theme-switcher');
        if (themeSwitcher) {
            themeSwitcher.addEventListener('click', (e) => this.handleThemeChange(e));
        }

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
        // Settings Tabs
        document.querySelectorAll('.settings-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                const tabName = e.target.dataset.tab;
                this.switchSettingsTab(tabName);
            });
        });

        // Recovery Actions
        document.getElementById('btn-generate-backup-codes')?.addEventListener('click', () => this.generateBackupCodes());
        document.getElementById('btn-download-recovery-file')?.addEventListener('click', () => this.downloadRecoveryFile());
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
        document.getElementById('confirm-backup-codes')?.addEventListener('click', () => {
            document.getElementById('backup-codes-modal').classList.add('hidden');
            this.showToast('Backup codes saved successfully', 'success');
            this.renderActiveRecoveryMethods();
        });

        // Secret Question Modal
        document.getElementById('close-secret-question-modal')?.addEventListener('click', () => {
            document.getElementById('secret-question-modal').classList.add('hidden');
        });
        document.getElementById('cancel-secret-question')?.addEventListener('click', () => {
            document.getElementById('secret-question-modal').classList.add('hidden');
        });

        // Password Generator
        this._getById('btn-generate-password')?.addEventListener('click', () => this.generatePassword());
        this._getById('btn-copy-password')?.addEventListener('click', () => this.copyPassword());

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

    toggleFocusMode(forceState) {
        this.isFocusMode = typeof forceState === 'boolean' ? forceState : !this.isFocusMode;
        document.body.classList.toggle('focus-mode-active', this.isFocusMode);
        this.hapticFeedback();

        if (this.isFocusMode) {
            this.showToast('Focus Mode enabled. Press "F" or "Esc" to exit.', 'info');
        }
    }

    addKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            if (e.key.toLowerCase() === 'f' && !['INPUT', 'TEXTAREA'].includes(e.target.tagName)) {
                e.preventDefault();
                this.toggleFocusMode();
            }
            if (e.key === 'Escape' && this.isFocusMode) {
                this.toggleFocusMode(false);
            }
        });
    }

    async openSettingsModal() {
        const modal = document.getElementById('settings-modal');
        this.renderThemeSwitcher();
        // Set the toggle to the correct initial state
        const syncEnabled = localStorage.getItem('pinbridge.sync_enabled') === 'true';
        const syncToggle = document.getElementById('toggle-sync-enabled');
        if (syncToggle) syncToggle.checked = syncEnabled;
        modal.classList.remove('hidden');
        // Update dependent toggles
        const tagSyncToggle = this._getById('toggle-tag-sync');
        if (tagSyncToggle) tagSyncToggle.disabled = !syncEnabled;
        this.updateDuplicateDetectionUI();
        await this.renderActiveRecoveryMethods();
    }

    renderThemeSwitcher() {
        const container = document.getElementById('theme-switcher');
        if (!container) return;

        const themes = [
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
    }

    async renderActiveRecoveryMethods() {
        const container = document.getElementById('active-recovery-methods');
        const methods = await recoveryService.getActiveRecoveryMethods();

        // Always show recovery key (created on vault setup)
        let html = `
            <div class="recovery-method-item active">
                <div class="method-info">
                    <span class="method-icon">🔑</span>
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
        const length = parseInt(document.querySelector('input[name="pw-length"]:checked').value);
        const includeUppercase = this._getById('pw-opt-uppercase').checked;
        const includeNumbers = this._getById('pw-opt-numbers').checked;
        const includeSymbols = this._getById('pw-opt-symbols').checked;

        const charsets = {
            lower: 'abcdefghjkmnpqrstuvwxyz',
            upper: 'ABCDEFGHJKMNPQRSTUVWXYZ',
            numbers: '23456789',
            symbols: '!@#$%&*?_'
        };

        let characterPool = charsets.lower;
        const requiredChars = [];

        if (includeUppercase) {
            characterPool += charsets.upper;
            requiredChars.push(this._getRandomChar(charsets.upper));
        }
        if (includeNumbers) {
            characterPool += charsets.numbers;
            requiredChars.push(this._getRandomChar(charsets.numbers));
        }
        if (includeSymbols) {
            characterPool += charsets.symbols;
            requiredChars.push(this._getRandomChar(charsets.symbols));
        }

        let password = requiredChars.join('');
        const remainingLength = length - password.length;

        for (let i = 0; i < remainingLength; i++) {
            password += this._getRandomChar(characterPool);
        }

        // Shuffle the password to ensure required characters are not always at the start
        const shuffledPassword = this._shuffleString(password);

        this._getById('generated-password-display').value = shuffledPassword;
        this.showToast('New password generated!', 'success');
    }

    _getRandomChar(charset) {
        const randomValues = new Uint32Array(1);
        crypto.getRandomValues(randomValues);
        return charset[randomValues[0] % charset.length];
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

    copyPassword() {
        const password = this._getById('generated-password-display').value;
        if (!password) return;

        navigator.clipboard.writeText(password).then(() => {
            this.showToast('Password copied to clipboard!', 'success');
            if (this._getById('pw-opt-autoclear').checked) {
                setTimeout(() => {
                    navigator.clipboard.writeText(' ').catch(() => {}); // Clear clipboard
                    this.showToast('Clipboard cleared.', 'info');
                }, 30000);
            }
        });
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
        pairingService.cancelPairingSession();
        const modal = this._getById('pairing-modal');
        if (modal) modal.classList.add('hidden');
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
        if (badge) badge.innerText = `${words} w`;
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

        // 3. Render view to show legacy note updates and prep list
        this.renderCurrentView();

        // 4. Select the new note (which is now in memory notes list)
        // We need to fetch the full object from notesService to be safe
        const newNote = notesService.notes.find(n => n.id === id);
        if (newNote) {
            this.selectNote(newNote);
        } else {
            // Fallback
            this.selectNote({ id, title: "", body: "", trash: false, folder: "", tags: [], isTemplate: isTemplateView });
        }

        this.inputs.noteTitle?.focus();
    }

    async handleDelete() {
        if (!this.ensureAuthenticated()) return;
        if (!this.activeNoteId) return;

        if (this.currentView === 'trash') {
            if (confirm(i18n.t('confirmDeleteForever'))) {
                await notesService.deleteNote(this.activeNoteId);
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

    async handlePinNote() {
        if (!this.ensureAuthenticated() || !this.activeNoteId) return;
        const note = notesService.notes.find(n => n.id === this.activeNoteId);
        if (!note) return;
        await notesService.togglePin(this.activeNoteId);
        this.updatePinButtonState(!note.pinned);
        this.renderCurrentView();
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
            // Show editor, hide dashboard
            editorPanel?.classList.remove('hidden');
            dashboardPanel?.classList.add('hidden');

            const notes = notesOverride || notesService.notes;
            const filtered = this.getFilteredNotes(notes);
            this.renderFolders();
            this.updateDeleteButtonContext();
            this.renderNoteList(filtered);
        }
    }

    getFilteredNotes(notes = notesService.notes) {
        if (this.currentView === 'trash') return notes.filter(n => n.trash);
        if (this.currentView === 'templates') return notes.filter(n => n.isTemplate && !n.trash);

        // Normal views should EXCLUDE templates
        let filtered = notes.filter(n => !n.trash && !n.isTemplate);

        if (this.currentView === 'favorites') return filtered.filter(n => n.pinned);
        if (this.currentView.startsWith('folder:')) {
            const folder = this.currentView.split('folder:')[1];
            return filtered.filter(n => n.folder === folder);
        }
        return filtered; // 'all' view
    }

    renderNoteList(notes) {
        const listEl = document.getElementById('notes-list');
        if (!listEl) return;
        listEl.innerHTML = '';

        if (!notes.length) {
            listEl.innerHTML = `<div class="empty-list-placeholder">${i18n.t('emptyList')}</div>`;
            return;
        }

        notes.forEach(note => {
            const div = document.createElement('div');
            div.className = 'note-item';
            div.dataset.id = note.id;
            if (note.id === this.activeNoteId) div.classList.add('active');

            const badges = [];
            if (note.pinned) badges.push('<span class="note-badge">&#9733;</span>');

            div.innerHTML = `
                <div class="note-top">
                    <h4>${Utils.escapeHtml(note.title) || i18n.t('noteTitlePlaceholder')}${badges.join(' ')}</h4>
                     <div class="note-actions">
                        <button class="note-action" data-action="history" title="View History">
                            <svg viewBox="0 0 24 24" class="icon-small"><path d="M1 4v6h6"></path><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path></svg>
                        </button>
                        <button class="note-action" data-action="duplicate" title="Duplicate Note">
                            <svg viewBox="0 0 24 24" class="icon-small"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect></svg>
                        </button>
                        <button class="note-action" data-action="archive" title="Archive Note">
                            <svg viewBox="0 0 24 24" class="icon-small"><polyline points="21 8 21 21 3 21 3 8"></polyline><rect x="1" y="3" width="22" height="5"></rect><line x1="10" y1="12" x2="14" y2="12"></line></svg>
                        </button>
                        <button class="note-action" data-action="pin" title="${i18n.t('pinNote')}">
                            <svg viewBox="0 0 24 24" class="icon-small"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
                        </button>
                        <button class="note-action" data-action="trash" title="${note.trash ? i18n.t('deleteForever') : i18n.t('delete')}">&#128465;</button>
                    </div>
                </div>
                <p>${Utils.escapeHtml(note.body) || i18n.t('noteBodyPlaceholder')}</p>
            `;

            div.onclick = (e) => {
                if (e.target.classList.contains('note-action')) return;
                this.selectNote(note);
            };

            div.querySelectorAll('.note-action').forEach(btn => {
                btn.onclick = async (e) => {
                    e.stopPropagation();
                    const action = btn.dataset.action;
                    switch (action) {
                        case 'pin':
                            await notesService.togglePin(note.id);
                            this.renderCurrentView();
                            break;
                        case 'trash':
                            if (note.trash) {
                                await notesService.deleteNote(note.id);
                            } else {
                                await notesService.moveToTrash(note.id);
                            }
                            this.activeNoteId = null;
                            this.clearEditor();
                            this.renderCurrentView();
                            break;
                        case 'duplicate':
                            this.selectNote(note); // Select it first
                            await this.handleDuplicate();
                            break;
                        case 'history':
                            this.selectNote(note); // Select it first
                            await this.showHistoryModal();
                            break;
                        case 'archive':
                            // Placeholder for archive functionality
                            this.showToast(`Archive function for "${note.title}" not yet implemented.`, 'info');
                            break;
                    }
                };
            });

            listEl.appendChild(div);
        });
    }

    updateActiveListItem(note) {
        if (!note) return;
        const el = document.querySelector(`.note-item[data-id="${note.id}"]`);
        if (!el) return;
        const titleEl = el.querySelector('h4');
        const bodyEl = el.querySelector('p');
        const actions = el.querySelector('.note-actions');
        const badge = note.pinned ? '<span class="note-badge">&#9733;</span>' : '';
        if (titleEl) titleEl.innerHTML = `${Utils.escapeHtml(note.title) || i18n.t('noteTitlePlaceholder')}${badge}`;
        if (bodyEl) bodyEl.innerHTML = Utils.escapeHtml(note.body) || i18n.t('noteBodyPlaceholder');
        if (actions) {
            actions.querySelector('[data-action="pin"]')?.classList.toggle('active', !!note.pinned);
        }
    }

    selectNote(note) {
        this.activeNoteId = note.id;
        if (this.inputs.noteTitle) this.inputs.noteTitle.value = note.title;
        if (this.inputs.noteContent) this.inputs.noteContent.value = note.body;
        if (this.inputs.noteFolder) this.inputs.noteFolder.value = note.folder || '';
        if (this.inputs.noteTags) this.inputs.noteTags.value = note.tags ? note.tags.join(', ') : '';

        this.updatePinButtonState(note.pinned);

        document.querySelectorAll('.note-item.active').forEach(el => el.classList.remove('active'));
        const newActiveEl = document.querySelector(`.note-item[data-id="${note.id}"]`);
        if (newActiveEl) newActiveEl.classList.add('active');

        this.refreshSaveButtonState();
        this.updateWordCount();
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

        this.recoveryModal.copyBtn.onclick = () => {
            this.copyToClipboard(key, this.recoveryModal.copyBtn);
        };

        this.recoveryModal.closeBtn.onclick = () => {
            this.recoveryModal.overlay.classList.add('hidden');
            if (onContinue) onContinue();
        };
    }

    clearEditor() {
        this.activeNoteId = null;
        if (this.inputs.noteTitle) this.inputs.noteTitle.value = '';
        if (this.inputs.noteContent) this.inputs.noteContent.value = '';
        if (this.inputs.noteFolder) this.inputs.noteFolder.value = '';
        if (this.inputs.noteTags) this.inputs.noteTags.value = '';
        this.refreshSaveButtonState();
        this.setStatus(i18n.t('statusReady'));
    }

    async persistNote(force = false) {
        if (!this.ensureAuthenticated()) return false;
        if (!this.activeNoteId) return false;

        const note = notesService.notes.find(n => n.id === this.activeNoteId);
        if (note && note.trash) return false;

        clearTimeout(this.saveTimeout);

        const title = this.inputs.noteTitle?.value || '';
        const body = this.inputs.noteContent?.value || '';
        const folder = (this.inputs.noteFolder?.value || '').trim();
        const tags = (this.inputs.noteTags?.value || '').split(',').map(t => t.trim()).filter(t => t);

        if (!title.trim() && !body.trim()) {
            this.showToast(i18n.t('toastNoteEmpty'), 'error');
            this.refreshSaveButtonState();
            return false;
        }

        if (!force && !this.autoSaveEnabled) {
            this.setStatus(i18n.t('statusManual'));
            return false;
        }

        if (title.trim().toLowerCase() === 'untitled note' && !body.trim()) {
            this.showToast(i18n.t('toastNotePlaceholderBlocked'), 'error');
            this.refreshSaveButtonState();
            return false;
        }

        this.setStatus(i18n.t('statusSaving') + (folder ? ` (${folder})...` : '...'));
        await notesService.updateNote(this.activeNoteId, title, body, folder, tags);
        this.setStatus(i18n.t('statusSaved') + (folder ? ` (${folder})` : ''));
        this.renderFolders();
        this.refreshSaveButtonState();
        this.updateActiveListItem(note);
        return true;
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

    updateCompactViewUI() {
        document.body.classList.toggle('compact-notes', this.compactViewEnabled);
        const btn = document.getElementById('btn-toggle-compact');
        if (btn) btn.innerText = i18n.t('compactLabel', { state: i18n.t(this.compactViewEnabled ? 'compactOn' : 'compactOff') });
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
            { id: 'settings', label: i18n.t('settingsTitle'), action: () => settingsService.renderSettingsModal() },
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
}

export const uiService = new UIService();
