// src/ui/ui.js
import { bus } from '../core/bus.js';
import { Utils } from '../utils/helpers.js';
import { authService } from '../modules/auth/auth.js';
import { storageService } from '../storage/db.js';
import { notesService } from '../modules/notes/notes.js';
import { searchService } from '../modules/search/search.js';
import { settingsService } from '../modules/settings/settings.js';

class UIService {

    constructor() {
        this.screens = {
            loading: document.getElementById('loading-screen'),
            auth: document.getElementById('auth-screen'),
            vault: document.getElementById('vault-screen')
        };

        this.forms = {
            setup: document.getElementById('auth-setup'),
            login: document.getElementById('auth-login'),
            setupForm: document.getElementById('setup-form'),
            loginForm: document.getElementById('login-form'),
            btnShowSetup: document.getElementById('btn-show-setup'),
            btnShowSetupSecondary: document.getElementById('btn-show-setup-secondary'),
            btnShowLogin: document.getElementById('btn-show-login'),
            btnForgot: document.getElementById('btn-forgot'),
            btnSync: document.getElementById('btn-sync'),
            btnResetLocal: document.getElementById('btn-reset-local'),
            loginRecovery: document.getElementById('login-recovery')
        };

        this.recoveryModal = {
            overlay: document.getElementById('recovery-key-modal'),
            keyDisplay: document.getElementById('recovery-key-display'),
            copyBtn: document.getElementById('copy-recovery-key'),
            closeBtn: document.getElementById('close-recovery-modal')
        };

        this.activeNoteId = null;
        this.currentView = 'all'; // 'all', 'trash'
        this.autoSaveEnabled = localStorage.getItem('pinbridge.auto_save') !== 'false';
        this.compactViewEnabled = localStorage.getItem('pinbridge.compact_notes') === 'true';
        this.saveTimeout = null;
    }

    

        init() {

            this.createCommandPalette();

            this.addEventListeners();

            this.updateAutoSaveUI();

            this.updateCompactViewUI();

            this.refreshSaveButtonState();

        }

    

        // --- UI HELPERS ---

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

    

        // --- NAVIGATION ---

        showScreen(name) {

            Object.values(this.screens).forEach(el => el.classList.add('hidden'));

            this.screens[name].classList.remove('hidden');

        }

    

        // --- EVENT LISTENERS ---

        addEventListeners() {

            this.addAuthEventListeners();

            this.addVaultEventListeners();

            this.addEditorEventListeners();

            this.addKeyboardShortcuts();

        }

    

        addAuthEventListeners() {

            this.forms.setupForm.addEventListener('submit', (e) => this.handleSetupSubmit(e));

            this.forms.loginForm.addEventListener('submit', (e) => this.handleLoginSubmit(e));

            this.forms.btnShowSetup.addEventListener('click', () => {

                this.forms.login.classList.add('hidden');

                this.forms.setup.classList.remove('hidden');

            });

            this.forms.btnShowSetupSecondary?.addEventListener('click', () => {
                this.forms.login.classList.add('hidden');
                this.forms.setup.classList.remove('hidden');
            });

            this.forms.btnShowLogin.addEventListener('click', () => {

                this.forms.setup.classList.add('hidden');

                this.forms.login.classList.remove('hidden');

            });

            this.forms.btnForgot?.addEventListener('click', () => {
                this.forms.loginRecovery?.focus();
                this.forms.loginRecovery?.classList.add('input-focus-hint');
                setTimeout(() => this.forms.loginRecovery?.classList.remove('input-focus-hint'), 1200);
                this.showToast("Introduce tu Recovery Key y pulsa desbloquear.", "info");
            });

            this.forms.btnSync?.addEventListener('click', () => {
                settingsService.renderSettingsModal();
            });

            this.forms.btnResetLocal?.addEventListener('click', async () => {
                const confirmed = confirm("Resetear datos locales? Esto borra PIN y notas en este dispositivo.");
                if (!confirmed) return;
                await storageService.resetAll();
                localStorage.removeItem('pinbridge_session');
                location.reload();
            });

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

    

            const searchInput = document.getElementById('search-input');

            searchInput.addEventListener('input', (e) => this.handleSearchInput(e));

    

            document.getElementById('btn-new-note').onclick = () => this.handleNewNote();

            document.getElementById('btn-lock').onclick = () => {
                authService.logout();
                notesService.notes = [];
                this.currentView = 'all';
                this.activeNoteId = null;
                this.renderNoteList([]);
                searchService.buildIndex([]);
                this.clearEditor();
                this.showScreen('auth');
                this.forms.login.classList.remove('hidden');
                this.forms.setup.classList.add('hidden');
                this.showToast("Vault locked. Sesion cerrada.", "info");
            };

    

            document.getElementById('btn-toggle-compact')?.addEventListener('click', () => this.toggleCompactView());

    

            // Quick Drop

            const quickDropInput = document.getElementById('quick-drop-input');

            const quickDropZone = document.getElementById('quick-drop-zone');

            quickDropInput.addEventListener('keydown', (e) => this.handleQuickDrop(e));

            quickDropInput.addEventListener('focus', () => quickDropZone.classList.remove('collapsed'));

            quickDropInput.addEventListener('blur', () => {

                if (!quickDropInput.value) quickDropZone.classList.add('collapsed');

            });

        }

    

        addEditorEventListeners() {

            const noteTitle = document.getElementById('note-title');

            const noteBody = document.getElementById('note-content');

            noteTitle.addEventListener('input', () => { this.scheduleAutoSave(); this.refreshSaveButtonState(); });

            noteBody.addEventListener('input', () => { this.scheduleAutoSave(); this.refreshSaveButtonState(); });

            document.getElementById('note-folder').addEventListener('input', () => this.scheduleAutoSave());

            document.getElementById('note-tags').addEventListener('input', () => this.scheduleAutoSave());

    

            document.getElementById('btn-delete').onclick = () => this.handleDelete();

            document.getElementById('btn-save-note').onclick = async () => {

                const success = await this.persistNote(true);

                if (success) {

                    this.showToast("Note saved", "success");

                }

            };

            document.getElementById('btn-toggle-autosave').onclick = () => this.toggleAutoSave();

    

            // Editor Toolbar

            document.getElementById('btn-copy-title').onclick = (e) => this.copyToClipboard(document.getElementById('note-title').value, e.target);

            document.getElementById('btn-copy-body').onclick = (e) => this.copyToClipboard(document.getElementById('note-content').value, e.target);

            document.getElementById('btn-pin-note').onclick = () => this.handlePinNote();

        }

    

        addKeyboardShortcuts() {

            document.addEventListener('keydown', (e) => {

                if ((e.ctrlKey || e.metaKey) && e.key === 'k') {

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



    // --- EVENT HANDLERS ---

    

        async handleSetupSubmit(e) {

    

            e.preventDefault();

    

            const p1 = document.getElementById('setup-pin').value;

    

            const p2 = document.getElementById('setup-pin-confirm').value;

    

            if (p1 !== p2) {



                this.showToast("Los PIN no coinciden.", "error");



                return;



            }



            try {

                const hasVault = await authService.hasVault();
                if (hasVault) {
                    const confirmReset = confirm("Ya existe un Vault local. ¿Resetear y crear uno nuevo?");
                    if (!confirmReset) {
                        this.forms.login.classList.remove('hidden');
                        this.forms.setup.classList.add('hidden');
                        document.getElementById('login-pin')?.focus();
                        return;
                    }
                    await storageService.resetAll();
                }



                const recoveryKey = await authService.initializeNewVault(p1);

    

                this.showRecoveryKeyModal(recoveryKey, async () => {

    

                    // This callback runs after the user has closed the modal.

    

                    await authService.markRecoveryKeyShown();

    

                    await authService.login(p1);

    

                    this.showToast("Vault creado con exito!", "success");

    

                });

    

            } catch (err) {

    

                this.showToast("Error al crear el Vault: " + err.message, "error");

    

            }

    

        }



    async handleLoginSubmit(e) {

        e.preventDefault();

        const pin = document.getElementById('login-pin').value.trim();
        const recovery = this.forms.loginRecovery?.value.trim();

        if (!pin && !recovery) {
            this.showToast("Escribe tu PIN o tu Recovery Key.", "error");
            return;
        }

        try {
            let success = false;

            if (recovery) {
                success = await authService.recover(recovery);
            } else {
                success = await authService.login(pin);
            }

            if (!success) throw new Error('INVALID_PIN');

            this.showToast(recovery ? "Vault desbloqueado con Recovery Key" : "Bienvenido de nuevo", "success");
        } catch (err) {

            this.showToast(this.resolveAuthErrorMessage(err?.message || err), "error");

            document.getElementById('login-pin').value = '';
            if (this.forms.loginRecovery) this.forms.loginRecovery.value = '';

            if ((err?.message || err) === 'VAULT_METADATA_MISSING') {
                this.forms.login.classList.add('hidden');
                this.forms.setup.classList.remove('hidden');
                document.getElementById('setup-pin')?.focus();
            }

        }

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

        if (this.currentView === 'trash') {

            this.currentView = 'all';

            document.querySelector('[data-view="all"]').click();

        }

        const id = await notesService.createNote("", "", "", [], { persist: false });

        this.selectNote({ id, title: "", body: "", trash: false, folder: "", tags: [] });

        document.getElementById('note-title').focus();

    }



    async handleDelete() {

        if (!this.activeNoteId) return;



        if (this.currentView === 'trash') {

            if (confirm("Permanently delete? This cannot be undone.")) {

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

        if (!this.activeNoteId) return;

        const note = notesService.notes.find(n => n.id === this.activeNoteId);

        if (!note) return;



        await notesService.togglePin(this.activeNoteId);

        this.updatePinButtonState(!note.pinned); // Optimistic update

        this.renderCurrentView();

    }



    async handleQuickDrop(e) {

        if (e.key === 'Enter') {

            const quickDropInput = e.target;

            const text = quickDropInput.value.trim();

            if (!text) return;

            const title = `Quick Drop: ${new Date().toLocaleTimeString()}`;

            await notesService.createNote(title, text);

            quickDropInput.value = '';

            this.showToast("Stashed to Inbox", "success");

            quickDropInput.placeholder = "Stashed!";

            setTimeout(() => quickDropInput.placeholder = "Quick Drop... (Enter to stash)", 1500);

            if (this.currentView === 'all') this.renderCurrentView();

        }

    }



    resolveAuthErrorMessage(code) {

        switch (code) {

            case 'INVALID_PIN': return "PIN o Recovery Key incorrecta.";

            case 'VAULT_METADATA_MISSING': return "No encontramos tu Vault local.";

            case 'VAULT_CORRUPT': return "El Vault parece estar dañado.";

            default: return `Login Error: ${code}`;

        }

    }



    // --- RENDER LOGIC ---



    renderCurrentView(notesOverride) {

        const notes = notesOverride || notesService.notes;

        let filtered = [];



        if (this.currentView === 'trash') {

            filtered = notes.filter(n => n.trash);

        } else if (this.currentView === 'all') {

            filtered = notes.filter(n => !n.trash);

        } else if (this.currentView.startsWith('folder:')) {

            const folderName = this.currentView.split(':')[1];

            filtered = notes.filter(n => !n.trash && n.folder === folderName);

        }

        

        this.renderFolders();

        this.updateDeleteButtonContext();

        this.renderNoteList(filtered);

    }

    

        renderNoteList(notes) {

    

            const listEl = document.getElementById('notes-list');

    

            listEl.innerHTML = '';

    

            if (notes.length === 0) {

    

                listEl.innerHTML = '<div class="empty-list-placeholder">No notes found.</div>';

    

                return;

    

            }

    

            notes.forEach(note => {

    

                const div = document.createElement('div');

    

                div.className = 'note-item';

    

                div.dataset.id = note.id; // Add data-id for reliable selection

    

                if (note.id === this.activeNoteId) div.classList.add('active');

    

                

    

                const badges = [];

    

                if (note.pinned) badges.push('<span class="note-badge">&#9733;</span>');

    

                

    

                div.innerHTML = `

    

                    <h4>${Utils.escapeHtml(note.title) || 'Untitled'}${badges.join(' ')}</h4>

    

                    <p>${Utils.escapeHtml(note.body) || 'No content'}</p>

    

                `;

    

                div.onclick = () => this.selectNote(note);

    

                listEl.appendChild(div);

    

            });

    

        }

    

    

    

        selectNote(note) {

    

            this.activeNoteId = note.id;

    

            document.getElementById('note-title').value = note.title;

    

            document.getElementById('note-content').value = note.body;

    

            document.getElementById('note-folder').value = note.folder || "";

    

            document.getElementById('note-tags').value = note.tags ? note.tags.join(', ') : "";

    

            

    

            this.updatePinButtonState(note.pinned);

    

            

    

            // Efficiently update active class using data-id

    

            document.querySelectorAll('.note-item.active').forEach(el => el.classList.remove('active'));

    

            const newActiveEl = document.querySelector(`.note-item[data-id="${note.id}"]`);

    

            if(newActiveEl) newActiveEl.classList.add('active');

    

    

    

            this.refreshSaveButtonState();

    

        }

    

    renderFolders() {

        const listEl = document.getElementById('folder-list');

        const suggestionEl = document.getElementById('folder-suggestions');

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

        // Flag immediately so it is never re-shown automatically.
        authService.markRecoveryKeyShown().catch(() => {
            console.warn("Could not persist recoveryKeyShown flag");
        });



        this.recoveryModal.copyBtn.onclick = () => {

            this.copyToClipboard(key, this.recoveryModal.copyBtn);

        };

        

        this.recoveryModal.closeBtn.onclick = () => {

            this.recoveryModal.overlay.classList.add('hidden');

            if(onContinue) onContinue();

        };

    }



    // --- EDITOR ---

    

    clearEditor() {

        this.activeNoteId = null;

        document.getElementById('note-title').value = "";

        document.getElementById('note-content').value = "";

        document.getElementById('note-folder').value = "";

        document.getElementById('note-tags').value = "";

        this.refreshSaveButtonState();

    }

    

        async persistNote(force = false) {

    

            if (!this.activeNoteId) return false;

    

            const note = notesService.notes.find(n => n.id === this.activeNoteId);

    

            if (note && note.trash) return false;

    

            clearTimeout(this.saveTimeout);

    

    

    

            const title = document.getElementById('note-title').value;

    

            const body = document.getElementById('note-content').value;

    

            const folder = document.getElementById('note-folder').value.trim();

    

            const tags = document.getElementById('note-tags').value.split(',').map(t => t.trim()).filter(t => t);

            

            

    

            if (!force && !this.autoSaveEnabled) {

    

                document.getElementById('editor-status').innerText = "Manual save";

    

                return false;

    

            }

    

            if (!title.trim() && !body.trim()) {

    

                this.showToast("Note cannot be empty", "error");

    

                this.refreshSaveButtonState();

    

                return false;

    

            }

            if (title.trim().toLowerCase() === 'untitled note' && !body.trim()) {
                this.showToast("Please enter a title or content", "error");
                this.refreshSaveButtonState();
                return false;
            }

    

    

    

            document.getElementById('editor-status').innerText = "Saving...";

    

            await notesService.updateNote(this.activeNoteId, title, body, folder, tags);

    

            document.getElementById('editor-status').innerText = "Saved";

    

            

    

            this.renderFolders();

    

            this.refreshSaveButtonState();

    

            // Full re-render can be slow, but ensures consistency

    

            this.renderCurrentView();

    

            return true;

    

        }



    scheduleAutoSave() {

        if (!this.activeNoteId || !this.autoSaveEnabled) return;

        clearTimeout(this.saveTimeout);

        document.getElementById('editor-status').innerText = "Typing...";

        this.saveTimeout = setTimeout(() => this.persistNote(), 1000);

    }



    // --- UI STATE UPDATERS ---



    updateDeleteButtonContext() {

        const delBtn = document.getElementById('btn-delete');

        if (this.currentView === 'trash') {

            delBtn.innerText = "Delete Forever";

        } else {

            delBtn.innerText = "Delete";

        }

    }



    updateAutoSaveUI() {

        const btn = document.getElementById('btn-toggle-autosave');

        if (!btn) return;

        btn.innerText = `Auto Save: ${this.autoSaveEnabled ? 'On' : 'Off'}`;

    }

    

    toggleAutoSave() {

        this.autoSaveEnabled = !this.autoSaveEnabled;

        localStorage.setItem('pinbridge.auto_save', this.autoSaveEnabled);

        this.updateAutoSaveUI();

        this.showToast(`Auto-save ${this.autoSaveEnabled ? 'enabled' : 'disabled'}.`);

        if (this.autoSaveEnabled) this.scheduleAutoSave();

    }



    updateCompactViewUI() {

        document.body.classList.toggle('compact-notes', this.compactViewEnabled);

        const btn = document.getElementById('btn-toggle-compact');

        if (btn) btn.innerText = `Compact: ${this.compactViewEnabled ? 'On' : 'Off'}`;

    }



    toggleCompactView() {

        this.compactViewEnabled = !this.compactViewEnabled;

        localStorage.setItem('pinbridge.compact_notes', this.compactViewEnabled);

        this.updateCompactViewUI();

    }

    

    refreshSaveButtonState() {

        const btn = document.getElementById('btn-save-note');

        if (!btn) return;

        const isEmpty = !document.getElementById('note-title')?.value.trim() && !document.getElementById('note-content')?.value.trim();

        btn.disabled = isEmpty;

        btn.title = isEmpty ? 'Add content to save' : 'Save note';

    }



    updatePinButtonState(isPinned) {

        const btn = document.getElementById('btn-pin-note');

        if(btn) btn.style.color = isPinned ? "var(--brand-primary)" : "";

    }

    

    copyToClipboard(text, btnElement) {

        if (!text) return;

        navigator.clipboard.writeText(text).then(() => {

            const original = btnElement.innerText;

            btnElement.innerText = "Copied";

            this.showToast("Copied to clipboard", "success");

            setTimeout(() => { btnElement.innerText = original; }, 1500);

        }).catch(err => {

            this.showToast('Copy failed', 'error');

        });

    }



    // --- COMMAND PALETTE ---

    createCommandPalette() {

        const el = document.createElement('div');

        el.id = 'command-palette';

        el.className = 'hidden';

        el.innerHTML = `

            <div class="palette-container">

                <input type="text" class="palette-input" placeholder="Type a command...">

                <div class="palette-results"></div>

            </div>

        `;

        document.body.appendChild(el);



        const input = el.querySelector('input');

        const results = el.querySelector('.palette-results');

        

        const commands = [

            { id: 'settings', label: 'Open Settings (Export/Reset)', action: () => settingsService.renderSettingsModal() },

            { id: 'new', label: 'Create New Note', action: () => this.handleNewNote() },

            { id: 'all', label: 'Go to All Notes', action: () => document.querySelector('[data-view="all"]').click() },

            { id: 'trash', label: 'Go to Trash', action: () => document.querySelector('[data-view="trash"]').click() },

            { id: 'lock', label: 'Lock Vault', action: () => document.getElementById('btn-lock').click() }

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

}



export const uiService = new UIService();
