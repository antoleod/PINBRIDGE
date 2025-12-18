// src/ui/ui.js
import { bus } from '../core/bus.js';
import { Utils } from '../utils/helpers.js';
import { authService } from '../auth.js';
import { notesService } from '../modules/notes/notes.js';
import { searchService } from '../modules/search/search.js';
import { settingsService } from '../modules/settings/settings.js';
import { i18n } from '../core/i18n.js';
import { vaultService } from '../vault.js';
import { storageService } from '../storage/db.js';

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
        this.autoSaveEnabled = localStorage.getItem('pinbridge.auto_save') !== 'false';
        this.compactViewEnabled = localStorage.getItem('pinbridge.compact_notes') === 'true';
        this.saveTimeout = null;
    }

    _cacheDomElements() {
        this.screens = {
            loading: document.getElementById('loading-screen'),
            auth: document.getElementById('auth-screen'),
            vault: document.getElementById('vault-screen')
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
            btnShowLogin: document.getElementById('btn-show-login'),
            btnForgot: document.getElementById('btn-forgot'),
            btnSync: document.getElementById('btn-sync'),
            btnResetLocal: document.getElementById('btn-reset-local')
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
            closeBtn: document.getElementById('close-recovery-modal')
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
    }

    addAuthEventListeners() {
        this.forms.btnCreateStart?.addEventListener('click', () => this.showSetupForm());
        this.forms.btnLoginStart?.addEventListener('click', () => this.showLoginForm());
        this.forms.btnShowSetup?.addEventListener('click', () => this.showSetupForm());
        this.forms.btnShowLogin?.addEventListener('click', () => this.showLoginForm());

        this.forms.setupForm?.addEventListener('submit', (e) => this.handleSetupSubmit(e));
        this.forms.loginForm?.addEventListener('submit', (e) => this.handleLoginSubmit(e));

        this.forms.btnForgot?.addEventListener('click', () => {
            this.showLoginForm();
            this.inputs.loginRecovery?.focus();
            this.inputs.loginRecovery?.classList.add('input-focus-hint');
            setTimeout(() => this.inputs.loginRecovery?.classList.remove('input-focus-hint'), 1200);
            this.showToast(i18n.t('toastRecoveryHint'), 'info');
        });

        this.forms.btnSync?.addEventListener('click', () => {
            settingsService.renderSettingsModal();
        });

        this.forms.btnResetLocal?.addEventListener('click', async () => {
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
        });
    }

    showAuthChoice() {
        this.forms.choice?.classList.remove('hidden');
        this.forms.setup?.classList.add('hidden');
        this.forms.login?.classList.add('hidden');
    }

    showSetupForm() {
        this.forms.choice?.classList.add('hidden');
        this.forms.login?.classList.add('hidden');
        this.forms.setup?.classList.remove('hidden');
        this.inputs.setupUsername?.focus();
    }

    showLoginForm() {
        this.forms.choice?.classList.add('hidden');
        this.forms.setup?.classList.add('hidden');
        this.forms.login?.classList.remove('hidden');
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

    addEditorEventListeners() {
        this.inputs.noteTitle?.addEventListener('input', () => { this.scheduleAutoSave(); this.refreshSaveButtonState(); });
        this.inputs.noteContent?.addEventListener('input', () => { this.scheduleAutoSave(); this.refreshSaveButtonState(); });
        this.inputs.noteFolder?.addEventListener('input', () => this.scheduleAutoSave());
        this.inputs.noteTags?.addEventListener('input', () => this.scheduleAutoSave());

        document.getElementById('btn-delete')?.addEventListener('click', () => this.handleDelete());
        document.getElementById('btn-save-note')?.addEventListener('click', async () => {
            const success = await this.persistNote(true);
            if (success) this.showToast(i18n.t('toastNoteSaved'), 'success');
        });
        document.getElementById('btn-toggle-autosave')?.addEventListener('click', () => this.toggleAutoSave());

        document.getElementById('btn-copy-title')?.addEventListener('click', (e) => this.copyToClipboard(this.inputs.noteTitle?.value, e.target));
        document.getElementById('btn-copy-body')?.addEventListener('click', (e) => this.copyToClipboard(this.inputs.noteContent?.value, e.target));
        document.getElementById('btn-pin-note')?.addEventListener('click', () => this.handlePinNote());
    }

    addKeyboardShortcuts() {
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
        if (this.currentView === 'trash') {
            this.currentView = 'all';
            document.querySelector('[data-view="all"]')?.click();
        }
        const id = await notesService.createNote("", "", "", [], { persist: false });
        this.selectNote({ id, title: "", body: "", trash: false, folder: "", tags: [] });
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
        const notes = notesOverride || notesService.notes;
        const filtered = this.getFilteredNotes(notes);
        this.renderFolders();
        this.updateDeleteButtonContext();
        this.renderNoteList(filtered);
    }

    getFilteredNotes(notes = notesService.notes) {
        if (this.currentView === 'trash') return notes.filter(n => n.trash);
        if (this.currentView === 'all') return notes.filter(n => !n.trash);
        if (this.currentView?.startsWith('folder:')) {
            const folderName = this.currentView.split(':')[1];
            return notes.filter(n => !n.trash && n.folder === folderName);
        }
        return notes;
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
                        <button class="note-action" data-action="pin" title="${i18n.t('pinNote')}">&#9733;</button>
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
                    if (action === 'pin') {
                        await notesService.togglePin(note.id);
                        this.renderCurrentView();
                    }
                    if (action === 'trash') {
                        if (note.trash) {
                            await notesService.deleteNote(note.id);
                        } else {
                            await notesService.moveToTrash(note.id);
                        }
                        this.activeNoteId = null;
                        this.clearEditor();
                        this.renderCurrentView();
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

        if (!force && !this.autoSaveEnabled) {
            this.setStatus(i18n.t('statusManual'));
            return false;
        }

        if (!title.trim() && !body.trim()) {
            this.showToast(i18n.t('toastNoteEmpty'), 'error');
            this.refreshSaveButtonState();
            return false;
        }
        if (title.trim().toLowerCase() === 'untitled note' && !body.trim()) {
            this.showToast(i18n.t('toastNotePlaceholderBlocked'), 'error');
            this.refreshSaveButtonState();
            return false;
        }

        this.setStatus(i18n.t('statusSaving'));
        await notesService.updateNote(this.activeNoteId, title, body, folder, tags);
        this.setStatus(i18n.t('statusSaved'));
        this.renderFolders();
        this.refreshSaveButtonState();
        this.updateActiveListItem(note);
        return true;
    }

    scheduleAutoSave() {
        if (!this.activeNoteId || !this.autoSaveEnabled) return;
        clearTimeout(this.saveTimeout);
        this.setStatus(i18n.t('statusSaving'));
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
