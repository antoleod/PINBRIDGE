/**
 * Main Application Entry Point
 */

import { authService } from './auth.js';
import { notesService } from './modules/notes/notes.js';
import { searchService } from './modules/search/search.js';
import { uiService } from './ui/ui.js';
import { bus } from './core/bus.js';
import { i18n } from './core/i18n.js';
import { vaultService } from './vault.js';
import { coachService } from './modules/coach/coach.js';

// --- INIT ---
async function init() {
    console.log("PINBRIDGE: Initializing...");

    // Mobile-specific layout toggles rely on a body class for clean CSS branching.
    function updateViewportMode() {
        const isMobile = window.matchMedia('(max-width: 900px)').matches;
        document.body.classList.toggle('is-mobile', isMobile);
    }

    updateViewportMode();
    const viewportWatcher = window.matchMedia('(max-width: 900px)');
    if (typeof viewportWatcher.addEventListener === 'function') {
        viewportWatcher.addEventListener('change', updateViewportMode);
    } else if (typeof viewportWatcher.addListener === 'function') {
        viewportWatcher.addListener(updateViewportMode);
    }
    let resizeRaf;
    window.addEventListener('resize', () => {
        if (resizeRaf) cancelAnimationFrame(resizeRaf);
        resizeRaf = requestAnimationFrame(updateViewportMode);
    }, { passive: true });

    // --- Dynamic Confirmation Modal ---
    function createConfirmationModal({ title, text, confirmText, confirmTone, onConfirm }) {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';

        // Icon based on tone
        const iconSvg = confirmTone === 'danger'
            ? '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>'
            : '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>';

        overlay.innerHTML = `
            <div class="modal-content confirmation">
                <div class="confirmation-body">
                    <div class="confirmation-icon">${iconSvg}</div>
                    <h3 class="confirmation-title">${title}</h3>
                    <p class="confirmation-text">${text}</p>
                    <div class="confirmation-actions">
                        <button class="btn btn-secondary" id="modal-cancel">Cancel</button>
                        <button class="btn btn-primary ${confirmTone === 'danger' ? 'danger' : ''}" id="modal-confirm">${confirmText || 'Confirm'}</button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        const close = () => {
            overlay.remove();
        };

        overlay.querySelector('#modal-cancel').addEventListener('click', close);
        overlay.querySelector('#modal-confirm').addEventListener('click', () => {
            if (onConfirm) onConfirm();
            close();
        });

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) close();
        });
    }

    // --- Dynamic Prompt Modal (Input) ---
    function createPromptModal({ title, label, placeholder, suggestions = [], confirmText, onConfirm }) {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';

        const datalistId = 'prompt-suggestions-' + Date.now();
        const datalistHtml = suggestions.length ? `
            <datalist id="${datalistId}">
                ${suggestions.map(s => `<option value="${s}">`).join('')}
            </datalist>
        ` : '';

        overlay.innerHTML = `
            <div class="modal-content confirmation">
                <div class="confirmation-body">
                    <h3 class="confirmation-title">${title}</h3>
                    <div class="form-group" style="width: 100%; text-align: left; margin-top: 1rem;">
                        <label style="font-size: 0.9rem; color: var(--text-secondary); margin-bottom: 0.5rem; display: block;">${label}</label>
                        <input type="text" id="prompt-input" class="input-field" placeholder="${placeholder || ''}" list="${suggestions.length ? datalistId : ''}" autofocus>
                        ${datalistHtml}
                    </div>
                    <div class="confirmation-actions">
                        <button class="btn btn-secondary" id="modal-cancel">Cancel</button>
                        <button class="btn btn-primary" id="modal-confirm">${confirmText || 'Confirm'}</button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);
        const input = overlay.querySelector('#prompt-input');
        const close = () => overlay.remove();

        overlay.querySelector('#modal-cancel').addEventListener('click', close);
        overlay.querySelector('#modal-confirm').addEventListener('click', () => {
            const value = input.value.trim();
            if (value && onConfirm) onConfirm(value);
            close();
        });

        // Focus input
        setTimeout(() => input.focus(), 50);
    }

    // --- UI Enhancements ---
    function initPinVisibilityToggle() {
        const eyeIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
        const eyeOffIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`;

        const toggleButtons = document.querySelectorAll('.btn-toggle-visibility');

        toggleButtons.forEach(button => {
            const targetInputId = button.dataset.target;
            const targetInput = document.getElementById(targetInputId);

            if (!targetInput) return;

            // Set initial icon
            button.innerHTML = eyeIcon;

            button.addEventListener('click', () => {
                const label = button.dataset.label || 'PIN';
                const isPassword = targetInput.type === 'password';
                if (isPassword) {
                    targetInput.type = 'text';
                    button.innerHTML = eyeOffIcon;
                    button.setAttribute('aria-label', `Hide ${label}`);
                    button.setAttribute('title', `Hide ${label}`);
                } else {
                    targetInput.type = 'password';
                    button.innerHTML = eyeIcon;
                    button.setAttribute('aria-label', `Show ${label}`);
                    button.setAttribute('title', `Show ${label}`);
                }
            });
        });
    }

    initPinVisibilityToggle();

    function initEnterToLogin() {
        const loginForm = document.getElementById('login-form');
        if (loginForm) {
            loginForm.addEventListener('submit', (e) => {
                e.preventDefault();
                document.getElementById('btn-login-submit').click();
            });
        }
    }
    initEnterToLogin();
    // --- End UI Enhancements ---

    // --- Attachment Management (Delete Feature & UI Injection) ---
    function initAttachmentManager() {
        const list = document.getElementById('note-attachments-list');
        if (!list) return;

        // Observer to inject Delete buttons into dynamically rendered attachments
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType === 1 && node.classList.contains('attachment-item')) {
                        // Prevent duplicate buttons
                        if (node.querySelector('.btn-delete-attachment')) return;

                        const actions = node.querySelector('.attachment-actions');
                        if (actions) {
                            const btn = document.createElement('button');
                            btn.className = 'btn-icon ghost btn-delete-attachment';
                            btn.innerHTML = '<i data-feather="trash-2"></i>';
                            btn.title = 'Delete Attachment';
                            btn.ariaLabel = 'Delete Attachment';

                            // Insert before the first child (usually download/open) or append
                            actions.appendChild(btn);

                            try { if (window.feather?.replace) window.feather.replace(); } catch (err) { console.warn('Feather replace failed', err); }
                        }
                    }
                });
            });
        });

        observer.observe(list, { childList: true, subtree: true });

        // Event Delegation for Delete Action
        list.addEventListener('click', (e) => {
            const btn = e.target.closest('.btn-delete-attachment');
            if (btn) {
                const item = btn.closest('.attachment-item');
                const attachmentId = item.dataset.id;

                createConfirmationModal({
                    title: 'Delete Attachment?',
                    text: 'Are you sure you want to delete this attachment? This action cannot be undone.',
                    confirmText: 'Delete',
                    confirmTone: 'danger',
                    onConfirm: () => {
                        bus.emit('attachment:delete', attachmentId);
                        item.remove();
                        if (list.children.length === 0) {
                            document.getElementById('note-attachments-empty')?.classList.remove('hidden');
                        }
                    }
                });
            }
        });

        // Handler for attachment deletion
        bus.on('attachment:delete', async (attachmentId) => {
            const noteId = uiService.activeNoteId;
            if (!noteId) {
                console.warn('Cannot delete attachment: No active note');
                return;
            }

            const notes = vaultService.getNotes();
            const note = notes.find(n => n.id === noteId);

            if (note && note.attachments) {
                const initialCount = note.attachments.length;
                note.attachments = note.attachments.filter(a => String(a.id) !== String(attachmentId));

                if (note.attachments.length < initialCount) {
                    note.updated = Date.now();
                    await vaultService.upsertNote(note);
                    uiService.showToast('Attachment removed from vault', 'success');
                }
            }
        });
    }
    initAttachmentManager();
    // --- End Attachment Management ---

    // --- Note Deletion Management ---
    function initNoteDeleteManager() {
        const btnDelete = document.getElementById('btn-delete');
        if (!btnDelete) return;

        // Clone to remove existing listeners
        const newBtn = btnDelete.cloneNode(true);
        btnDelete.parentNode.replaceChild(newBtn, btnDelete);

        const deleteModal = document.getElementById('delete-note-modal');
        const modalTitle = deleteModal?.querySelector('h2');
        const modalText = deleteModal?.querySelector('.warning-text');

        // Clone confirm button to remove old listeners
        const oldConfirmBtn = document.getElementById('confirm-delete-note');
        let confirmBtn = oldConfirmBtn;
        if (oldConfirmBtn) {
            confirmBtn = oldConfirmBtn.cloneNode(true);
            oldConfirmBtn.parentNode.replaceChild(confirmBtn, oldConfirmBtn);
        }

        const showDeleteModal = () => {
            if (!uiService.activeNoteId) return;

            const notes = vaultService.getNotes();
            const note = notes.find(n => n.id === uiService.activeNoteId);
            if (!note) return;

            const isTrash = !!note.trash;

            if (modalTitle) modalTitle.textContent = isTrash ? 'Delete Permanently' : 'Move to Trash';
            if (modalText) modalText.textContent = isTrash
                ? 'Are you sure you want to delete this note permanently? This action cannot be undone.'
                : 'Are you sure you want to move this note to the trash?';
            if (confirmBtn) confirmBtn.textContent = isTrash ? 'Delete Permanently' : 'Move to Trash';

            if (deleteModal) {
                deleteModal.classList.remove('hidden');
                deleteModal.showModal();
            }
        };

        newBtn.addEventListener('click', showDeleteModal);

        // Keyboard Shortcut: Delete key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Delete') {
                // Ignore if typing in input/textarea/contenteditable
                const tag = document.activeElement.tagName;
                if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement.isContentEditable) return;

                // Ignore if any modal is open
                if (document.querySelector('dialog[open]')) return;

                showDeleteModal();
            }
        });

        document.getElementById('cancel-delete-note')?.addEventListener('click', () => {
            if (deleteModal) {
                deleteModal.classList.add('hidden');
                deleteModal.close();
            }
        });

        document.getElementById('close-delete-note-modal')?.addEventListener('click', () => {
            if (deleteModal) {
                deleteModal.classList.add('hidden');
                deleteModal.close();
            }
        });

        confirmBtn?.addEventListener('click', async () => {
            const noteId = uiService.activeNoteId;
            if (noteId) {
                const notes = vaultService.getNotes();
                const note = notes.find(n => n.id === noteId);

                if (note) {
                    if (note.trash) {
                        // Hard Delete
                        const newNotes = notes.filter(n => n.id !== noteId);
                        await vaultService.replaceNotes(newNotes);
                        uiService.showToast('Note deleted permanently', 'success');
                    } else {
                        // Soft Delete
                        note.trash = true;
                        note.updated = Date.now();
                        await vaultService.upsertNote(note);
                        uiService.showToast('Note moved to trash', 'success');
                    }
                }

                if (deleteModal) {
                    deleteModal.classList.add('hidden');
                    deleteModal.close();
                }

                // Clear Editor
                const titleInput = document.getElementById('note-title');
                const contentInput = document.getElementById('note-content');
                if (titleInput) titleInput.value = '';
                if (contentInput) contentInput.value = '';
                const attachmentList = document.getElementById('note-attachments-list');
                if (attachmentList) attachmentList.innerHTML = '';

                // Refresh List
                uiService.renderCurrentView(vaultService.getNotes());
            }
        });
    }
    initNoteDeleteManager();
    // --- End Note Deletion Management ---

    // --- Note List Actions Injection ---
    function initNoteListActions() {
        const list = document.getElementById('notes-list');
        if (!list) return;

        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType === 1 && node.classList.contains('note-item')) {
                        const topRow = node.querySelector('.note-top-minimal');
                        if (!topRow) return;

                        let actionsContainer = topRow.querySelector('.note-actions-minimal');
                        if (!actionsContainer) {
                            actionsContainer = document.createElement('div');
                            actionsContainer.className = 'note-actions-minimal';
                            topRow.appendChild(actionsContainer);
                        }

                        if (actionsContainer.hasChildNodes()) return;

                        // History Icon
                        const btnHistory = document.createElement('button');
                        btnHistory.className = 'note-action-icon';
                        btnHistory.dataset.action = 'history';
                        btnHistory.title = 'History';
                        btnHistory.innerHTML = '<i data-feather="clock"></i>';
                        actionsContainer.appendChild(btnHistory);

                        // Delete Icon
                        const btnDelete = document.createElement('button');
                        btnDelete.className = 'note-action-icon';
                        btnDelete.dataset.action = 'delete';
                        btnDelete.title = 'Delete';
                        btnDelete.innerHTML = '<i data-feather="trash-2"></i>';
                        actionsContainer.appendChild(btnDelete);

                        try { if (window.feather?.replace) window.feather.replace(); } catch (err) { console.warn('Feather replace failed', err); }
                    }
                });
            });
        });

        observer.observe(list, { childList: true });

        list.addEventListener('click', (e) => {
            const btn = e.target.closest('.note-action-icon');
            if (!btn) return;
            e.stopPropagation();

            const noteItem = btn.closest('.note-item');
            const noteId = noteItem.dataset.id;

            if (btn.dataset.action === 'delete') {
                uiService.activeNoteId = noteId;
                const deleteModal = document.getElementById('delete-note-modal');
                if (deleteModal) {
                    const notes = vaultService.getNotes();
                    const note = notes.find(n => n.id === noteId);
                    const modalTitle = deleteModal.querySelector('h2');
                    const modalText = deleteModal.querySelector('.warning-text');
                    const confirmBtn = document.getElementById('confirm-delete-note');

                    if (note) {
                        const isTrash = !!note.trash;
                        if (modalTitle) modalTitle.textContent = isTrash ? 'Delete Permanently' : 'Move to Trash';
                        if (modalText) modalText.textContent = isTrash
                            ? 'Are you sure you want to delete this note permanently? This action cannot be undone.'
                            : 'Are you sure you want to move this note to the trash?';
                        if (confirmBtn) confirmBtn.textContent = isTrash ? 'Delete Permanently' : 'Move to Trash';
                    }

                    deleteModal.classList.remove('hidden');
                    deleteModal.showModal();
                }
            } else if (btn.dataset.action === 'history') {
                const historyModal = document.getElementById('history-modal');
                if (historyModal) {
                    const notes = vaultService.getNotes();
                    const note = notes.find(n => n.id === noteId);
                    const listContainer = document.getElementById('history-list');

                    if (listContainer) {
                        listContainer.innerHTML = '';
                        const history = note?.history || [];

                        if (history.length === 0) {
                            listContainer.innerHTML = `
                                <div class="empty-list-placeholder">
                                    <p>No history available for this note.</p>
                                </div>`;
                        } else {
                            // Sort by date descending
                            const sortedHistory = [...history].sort((a, b) => (b.updated || 0) - (a.updated || 0));

                            sortedHistory.forEach(version => {
                                const item = document.createElement('div');
                                item.className = 'history-item';
                                const dateStr = new Date(version.updated).toLocaleString();
                                const titleSafe = (version.title || 'Untitled').replace(/</g, '&lt;');
                                const contentPreview = (version.content || '').substring(0, 60).replace(/</g, '&lt;');

                                item.innerHTML = `
                                    <div class="history-meta">
                                        <div class="history-date">${dateStr}</div>
                                        <div class="history-preview"><strong>${titleSafe}</strong><br>${contentPreview}...</div>
                                    </div>
                                    <button class="btn-icon ghost restore-btn" title="Restore this version">
                                        <i data-feather="rotate-ccw"></i>
                                    </button>
                                `;

                                item.querySelector('.restore-btn').addEventListener('click', async () => {
                                    if (confirm('Restore this version? The current version will be saved to history.')) {
                                        // Save current state to history
                                        const currentSnapshot = {
                                            updated: Date.now(),
                                            title: note.title,
                                            content: note.content
                                        };

                                        // Restore old state
                                        note.title = version.title;
                                        note.content = version.content;
                                        note.updated = Date.now();
                                        if (!note.history) note.history = [];
                                        note.history.push(currentSnapshot);

                                        await vaultService.upsertNote(note);
                                        uiService.showToast('Version restored', 'success');

                                        historyModal.classList.add('hidden');
                                        historyModal.close();

                                        // Refresh UI if this note is active
                                        if (uiService.activeNoteId === note.id) {
                                            const titleInput = document.getElementById('note-title');
                                            const contentInput = document.getElementById('note-content');
                                            if (titleInput) titleInput.value = note.title;
                                            if (contentInput) contentInput.value = note.content;
                                        }
                                        uiService.renderCurrentView(vaultService.getNotes());
                                    }
                                });

                                listContainer.appendChild(item);
                            });

                            try { if (window.feather?.replace) window.feather.replace(); } catch (err) { console.warn('Feather replace failed', err); }
                        }
                    }

                    historyModal.classList.remove('hidden');
                    historyModal.showModal();
                }
            }
        });

        document.getElementById('close-history-modal')?.addEventListener('click', () => {
            const historyModal = document.getElementById('history-modal');
            if (historyModal) {
                historyModal.classList.add('hidden');
                historyModal.close();
            }
        });
    }
    initNoteListActions();
    // --- End Note List Actions Injection ---

    // --- Note Color Sync (Visualizer) ---
    function initNoteColorSync() {
        const list = document.getElementById('notes-list');
        if (!list) return;

        const observer = new MutationObserver((mutations) => {
            const notes = vaultService.getNotes();
            const noteMap = new Map(notes.map(n => [n.id, n]));

            mutations.forEach(m => {
                m.addedNodes.forEach(node => {
                    if (node.nodeType === 1 && node.classList.contains('note-item')) {
                        const id = node.dataset.id;
                        const note = noteMap.get(id);
                        if (note && note.color) {
                            node.setAttribute('data-color', note.color);
                        }
                    }
                });
            });
        });
        observer.observe(list, { childList: true });
    }
    initNoteColorSync();

    // --- Trash Management ---
    function initTrashManager() {
        const btnEmptyTrash = document.getElementById('btn-empty-trash');
        const btnNewNote = document.getElementById('btn-new-note');
        const btnRestore = document.getElementById('btn-restore');
        const emptyModal = document.getElementById('empty-trash-modal');

        // --- Empty Trash Logic ---
        btnEmptyTrash?.addEventListener('click', () => {
            if (emptyModal) {
                emptyModal.classList.remove('hidden');
                emptyModal.showModal();
            }
        });

        document.getElementById('cancel-empty-trash')?.addEventListener('click', () => {
            if (emptyModal) {
                emptyModal.classList.add('hidden');
                emptyModal.close();
            }
        });

        document.getElementById('close-empty-trash-modal')?.addEventListener('click', () => {
            if (emptyModal) {
                emptyModal.classList.add('hidden');
                emptyModal.close();
            }
        });

        document.getElementById('confirm-empty-trash')?.addEventListener('click', async () => {
            const notes = vaultService.getNotes();
            const keptNotes = notes.filter(n => !n.trash);

            if (keptNotes.length < notes.length) {
                await vaultService.replaceNotes(keptNotes);
                uiService.showToast('Trash emptied', 'success');
                uiService.renderCurrentView(keptNotes);

                // Clear editor if active note was deleted
                if (uiService.activeNoteId) {
                    const activeStillExists = keptNotes.find(n => n.id === uiService.activeNoteId);
                    if (!activeStillExists) {
                        document.getElementById('note-title').value = '';
                        document.getElementById('note-content').value = '';
                        uiService.activeNoteId = null;
                    }
                }
            }

            if (emptyModal) {
                emptyModal.classList.add('hidden');
                emptyModal.close();
            }
        });

        // --- Restore Logic ---
        btnRestore?.addEventListener('click', async () => {
            const noteId = uiService.activeNoteId;
            if (!noteId) return;

            const notes = vaultService.getNotes();
            const note = notes.find(n => n.id === noteId);
            if (note && note.trash) {
                note.trash = false;
                note.updated = Date.now();
                await vaultService.upsertNote(note);
                uiService.showToast('Note restored', 'success');
                uiService.renderCurrentView(vaultService.getNotes());
                updateTrashUI(); // Refresh button state
            }
        });

        // --- UI State Management ---
        const updateTrashUI = () => {
            const isTrashView = uiService.currentView === 'trash';

            // Toggle List Header Buttons
            if (btnEmptyTrash) btnEmptyTrash.classList.toggle('hidden', !isTrashView);
            if (btnNewNote) btnNewNote.classList.toggle('hidden', isTrashView);

            // Toggle Restore Button based on active note
            const noteId = uiService.activeNoteId;
            if (noteId) {
                const notes = vaultService.getNotes();
                const note = notes.find(n => n.id === noteId);
                const isTrashed = !!note?.trash;
                if (btnRestore) btnRestore.classList.toggle('hidden', !isTrashed);
            } else {
                if (btnRestore) btnRestore.classList.add('hidden');
            }
        };

        // Hook into navigation and selection events to update UI
        const notesList = document.getElementById('notes-list');
        if (notesList) {
            notesList.addEventListener('click', () => setTimeout(updateTrashUI, 50));
        }

        // Initial check on unlock
        bus.on('auth:unlock', () => setTimeout(updateTrashUI, 500));
        bus.on('view:switched', () => setTimeout(updateTrashUI, 0));
    }
    initTrashManager();
    // --- End Trash Management ---

    // --- App-wide Navigation ---
    function initAppNavigation() {
        const mainPanels = {
            // Map view names to panel elements
            all: document.querySelector('.list-panel'),
            favorites: document.querySelector('.list-panel'),
            templates: document.querySelector('.list-panel'),
            trash: document.querySelector('.list-panel'),
            archive: document.querySelector('.list-panel'),
            dashboard: document.querySelector('.dashboard-panel'),
            coach: document.querySelector('.coach-panel'),
            admin: document.querySelector('.admin-panel'),
        };

        const switchView = (view) => {
            if (!view || !mainPanels[view]) {
                console.warn(`[NAV] Invalid view requested: ${view}`);
                return;
            }

            const isMobile = document.body.classList.contains('is-mobile');
            const editorPanel = document.querySelector('.editor-panel');
            // Coach-only mode is useful on mobile (full-screen focus).
            // On desktop: keep sidebar visible, but hide notes/editor to avoid split view.
            document.body.classList.toggle('coach-only', view === 'coach' && isMobile);
            document.body.classList.toggle('coach-focus', view === 'coach' && !isMobile);

            // 1. Hide all main panels
            Object.values(mainPanels).forEach(panel => panel?.classList.add('hidden'));
            if (isMobile) editorPanel?.classList.add('hidden');

            // 2. Show the target panel
            const targetPanel = mainPanels[view];
            targetPanel?.classList.remove('hidden');

            // 2b. Desktop layout: hide editor for non-note views (Coach/Dashboard/Admin)
            if (!isMobile && editorPanel) {
                const shouldHideEditor = view === 'coach' || view === 'dashboard' || view === 'admin';
                editorPanel.classList.toggle('hidden', shouldHideEditor);
            }

            // 3. Update active state on all nav buttons
            document.querySelectorAll('[data-view]').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.view === view);
            });

            // 4. Update uiService state and re-render content
            uiService.currentView = view;
            uiService.renderCurrentView(vaultService.getNotes());

            // 5. Close mobile sidebar if open
            document.body.classList.remove('mobile-sidebar-open');
            document.querySelector('.mobile-nav-backdrop')?.classList.remove('visible');

            // 6. Handle mobile list/editor state
            if (isMobile) {
                document.body.classList.add('mobile-list-active');
                document.body.classList.remove('mobile-editor-active');
            }

            // 7. Notify other modules of the view change
            bus.emit('view:switched', { view });
        };

        // Use event delegation for all navigation clicks
        document.body.addEventListener('click', (e) => {
            const navTrigger = e.target.closest('[data-view]');
            if (navTrigger) {
                e.preventDefault();
                e.stopPropagation();
                const view = navTrigger.dataset.view;
                switchView(view);
            }
        });

        // Expose the switcher to the bus for programmatic navigation
        bus.on('view:switch', switchView);
    }
    initAppNavigation();
    // --- End App-wide Navigation ---

    // --- Settings Accordion (Mobile) ---
    function initSettingsAccordion() {
        const settingsModal = document.getElementById('settings-modal');
        if (!settingsModal) return;

        settingsModal.addEventListener('click', (e) => {
            const toggle = e.target.closest('.settings-accordion-toggle');
            if (toggle) {
                const item = toggle.closest('.settings-accordion-item');
                const content = item.querySelector('.settings-accordion-content');

                // Toggle state
                const isOpen = item.classList.contains('open');

                // Close others for exclusive accordion behavior
                settingsModal.querySelectorAll('.settings-accordion-item').forEach(otherItem => {
                    if (otherItem !== item) {
                        otherItem.classList.remove('open');
                        const otherContent = otherItem.querySelector('.settings-accordion-content');
                        if (otherContent) otherContent.classList.add('hidden');
                    }
                });

                if (isOpen) {
                    item.classList.remove('open');
                    content.classList.add('hidden');
                } else {
                    item.classList.add('open');
                    content.classList.remove('hidden');
                }
            }
        });
    }
    initSettingsAccordion();
    // --- End Settings Accordion ---

    // --- Bulk Actions & Selection ---
    function initBulkActions() {
        const btnToggleSelect = document.getElementById('btn-toggle-select');
        const bulkBar = document.getElementById('bulk-action-bar');
        const btnBulkCancel = document.getElementById('btn-bulk-cancel');
        const checkSelectAll = document.getElementById('bulk-select-all');
        const countDisplay = document.getElementById('bulk-count');
        const list = document.getElementById('notes-list');

        let selectedIds = new Set();
        let isSelectionMode = false;

        const toggleSelectionMode = (active, clear = true) => {
            isSelectionMode = active;
            document.body.classList.toggle('selection-mode', active);

            // Logic: If active, show bar. If not active, hide bar.
            // Exception: If we just want to hide the bar but keep selection (e.g. via toggle button), we handle visibility separately.
            // Here we assume 'active' means "Enter/Exit Mode".
            if (active) bulkBar.classList.remove('hidden');
            else bulkBar.classList.add('hidden');

            if (!active && clear) {
                selectedIds.clear();
                updateSelectionUI();
                // Uncheck all
                list.querySelectorAll('.note-select-checkbox').forEach(cb => cb.checked = false);
                checkSelectAll.checked = false;
            }
        };

        const updateSelectionUI = () => {
            countDisplay.textContent = `${selectedIds.size} selected`;
            checkSelectAll.checked = list.children.length > 0 && selectedIds.size === list.children.length;
            checkSelectAll.indeterminate = selectedIds.size > 0 && selectedIds.size < list.children.length;
            btnToggleSelect.setAttribute('data-count', selectedIds.size);
        };

        // Inject checkboxes via Observer
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType === 1 && node.classList.contains('note-item')) {
                        if (node.querySelector('.note-select-checkbox')) return;

                        const checkbox = document.createElement('input');
                        checkbox.type = 'checkbox';
                        checkbox.className = 'note-select-checkbox';

                        // Wrap content to allow flex layout with checkbox
                        const contentWrapper = document.createElement('div');
                        contentWrapper.className = 'note-item-content';
                        while (node.firstChild) {
                            contentWrapper.appendChild(node.firstChild);
                        }

                        node.appendChild(checkbox);
                        node.appendChild(contentWrapper);

                        // Handle click
                        checkbox.addEventListener('change', (e) => {
                            e.stopPropagation();
                            const id = node.dataset.id;
                            if (e.target.checked) selectedIds.add(id);
                            else selectedIds.delete(id);
                            updateSelectionUI();
                        });

                        // Prevent note opening when clicking checkbox area
                        checkbox.addEventListener('click', e => e.stopPropagation());
                    }
                });
            });
        });

        if (list) observer.observe(list, { childList: true });

        // Listeners
        btnToggleSelect?.addEventListener('click', () => {
            if (selectedIds.size > 0) {
                // If items are selected, toggle the bar visibility only, don't clear selection
                bulkBar.classList.toggle('hidden');
            } else {
                // Standard toggle
                toggleSelectionMode(!isSelectionMode);
            }
        });

        btnBulkCancel?.addEventListener('click', () => toggleSelectionMode(false));

        checkSelectAll?.addEventListener('change', (e) => {
            const checkboxes = list.querySelectorAll('.note-select-checkbox');
            const shouldSelect = e.target.checked;

            checkboxes.forEach(cb => {
                cb.checked = shouldSelect;
                const noteItem = cb.closest('.note-item');
                if (noteItem) {
                    if (shouldSelect) selectedIds.add(noteItem.dataset.id);
                    else selectedIds.delete(noteItem.dataset.id);
                }
            });
            updateSelectionUI();
        });

        // Bulk Operations
        const performBulkAction = async (action) => {
            if (selectedIds.size === 0) return;

            const notes = vaultService.getNotes();
            const ids = Array.from(selectedIds);

            if (action === 'delete') {
                createConfirmationModal({
                    title: `Delete ${ids.length} Notes?`,
                    text: 'These notes will be moved to trash.',
                    confirmText: 'Delete',
                    confirmTone: 'danger',
                    onConfirm: async () => {
                        ids.forEach(id => {
                            const note = notes.find(n => n.id === id);
                            if (note) {
                                note.trash = true;
                                note.updated = Date.now();
                            }
                        });
                        await vaultService.persistNotes(notes);
                        uiService.showToast(`${ids.length} notes moved to trash`, 'success');
                        toggleSelectionMode(false);
                        uiService.renderCurrentView(vaultService.getNotes());
                    }
                });
            } else if (action === 'archive') {
                ids.forEach(id => {
                    const note = notes.find(n => n.id === id);
                    if (note) {
                        note.archived = !note.archived; // Toggle archive
                        note.updated = Date.now();
                    }
                });
                await vaultService.persistNotes(notes);
                uiService.showToast(`${ids.length} notes archived`, 'success');
                toggleSelectionMode(false);
                uiService.renderCurrentView(vaultService.getNotes());
            }
            else if (action === 'move') {
                const existingFolders = [...new Set(notes.map(n => n.folder).filter(Boolean))].sort();
                createPromptModal({
                    title: `Move ${ids.length} Notes`,
                    label: 'Select or type folder name',
                    placeholder: 'Folder name...',
                    suggestions: existingFolders,
                    confirmText: 'Move',
                    onConfirm: async (folderName) => {
                        ids.forEach(id => {
                            const note = notes.find(n => n.id === id);
                            if (note) {
                                note.folder = folderName;
                                note.updated = Date.now();
                            }
                        });
                        await vaultService.persistNotes(notes);
                        uiService.showToast(`${ids.length} notes moved to "${folderName}"`, 'success');
                        toggleSelectionMode(false);
                        uiService.renderCurrentView(vaultService.getNotes());
                    }
                });
            }
            else if (action === 'merge') {
                if (ids.length < 2) {
                    uiService.showToast('Select at least 2 notes to merge', 'info');
                    return;
                }
                const selectedNotes = notes.filter(n => selectedIds.has(n.id));
                const defaultTitle = `Merged Note - ${new Date().toLocaleDateString()}`;

                createPromptModal({
                    title: `Merge ${ids.length} Notes`,
                    label: 'Title for the new merged note',
                    placeholder: defaultTitle,
                    confirmText: 'Merge',
                    onConfirm: async (title) => {
                        const finalTitle = title || defaultTitle;
                        let mergedContent = selectedNotes.map(n => `# ${n.title || 'Untitled'}\n\n${n.content || ''}`).join('\n\n---\n\n');

                        const newNote = {
                            id: self.crypto && self.crypto.randomUUID ? self.crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).substr(2),
                            title: finalTitle,
                            content: mergedContent,
                            folder: selectedNotes[0].folder || '',
                            tags: [...new Set(selectedNotes.flatMap(n => n.tags || []))],
                            created: Date.now(),
                            updated: Date.now(),
                            favorite: false,
                            trash: false
                        };

                        notes.unshift(newNote);
                        await vaultService.persistNotes(notes);
                        uiService.showToast('Notes merged successfully', 'success');
                        toggleSelectionMode(false);
                        uiService.renderCurrentView(vaultService.getNotes());
                    }
                });
            }
            else if (action === 'export') {
                createPromptModal({
                    title: `Export ${ids.length} Notes`,
                    label: 'Format (json or markdown)',
                    placeholder: 'json',
                    suggestions: ['json', 'markdown'],
                    confirmText: 'Export',
                    onConfirm: (format) => {
                        const fmt = (format || 'json').toLowerCase().trim();
                        const selectedNotes = notes.filter(n => selectedIds.has(n.id));

                        let blob, filename;
                        const timestamp = new Date().toISOString().slice(0, 10);

                        if (fmt === 'markdown' || fmt === 'md') {
                            const content = selectedNotes.map(n => `# ${n.title || 'Untitled'}\n\n${n.content || ''}`).join('\n\n---\n\n');
                            blob = new Blob([content], { type: 'text/markdown' });
                            filename = `pinbridge-export-${timestamp}.md`;
                        } else {
                            // Default to JSON
                            blob = new Blob([JSON.stringify(selectedNotes, null, 2)], { type: 'application/json' });
                            filename = `pinbridge-export-${timestamp}.json`;
                        }

                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = filename;
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        URL.revokeObjectURL(url);

                        toggleSelectionMode(false);
                        uiService.showToast(`Exported ${ids.length} notes as ${fmt.toUpperCase()}`, 'success');
                    }
                });
            }
            else if (action === 'pin') {
                ids.forEach(id => {
                    const note = notes.find(n => n.id === id);
                    if (note) {
                        note.pinned = !note.pinned;
                        note.updated = Date.now();
                    }
                });
                await vaultService.persistNotes(notes);
                uiService.showToast(`${ids.length} notes pin status updated`, 'success');
                toggleSelectionMode(false);
                uiService.renderCurrentView(vaultService.getNotes());
            }
            else if (action === 'duplicate') {
                const newNotes = [];
                ids.forEach(id => {
                    const note = notes.find(n => n.id === id);
                    if (note) {
                        const copy = JSON.parse(JSON.stringify(note));
                        copy.id = self.crypto && self.crypto.randomUUID ? self.crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).substr(2);
                        copy.title = `Copy of ${note.title || 'Untitled'}`;
                        copy.created = Date.now();
                        copy.updated = Date.now();
                        copy.history = []; // Reset history for the copy
                        newNotes.push(copy);
                    }
                });
                notes.unshift(...newNotes);
                await vaultService.persistNotes(notes);
                uiService.showToast(`${newNotes.length} notes duplicated`, 'success');
                toggleSelectionMode(false);
                uiService.renderCurrentView(vaultService.getNotes());
            }
            else if (action === 'tag') {
                createPromptModal({
                    title: `Tag ${ids.length} Notes`,
                    label: 'Enter tags (comma separated). Prefix with "-" to remove.',
                    placeholder: 'work, -personal',
                    confirmText: 'Update Tags',
                    onConfirm: async (input) => {
                        const tags = input.split(',').map(t => t.trim()).filter(Boolean);
                        const toAdd = tags.filter(t => !t.startsWith('-'));
                        const toRemove = tags.filter(t => t.startsWith('-')).map(t => t.substring(1));

                        ids.forEach(id => {
                            const note = notes.find(n => n.id === id);
                            if (note) {
                                const currentTags = new Set(note.tags || []);
                                toAdd.forEach(t => currentTags.add(t));
                                toRemove.forEach(t => currentTags.delete(t));
                                note.tags = Array.from(currentTags);
                                note.updated = Date.now();
                            }
                        });
                        await vaultService.persistNotes(notes);
                        uiService.showToast('Tags updated successfully', 'success');
                        toggleSelectionMode(false);
                        uiService.renderCurrentView(vaultService.getNotes());
                    }
                });
            }
            else if (action === 'color') {
                const colors = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'gray', 'none'];
                createPromptModal({
                    title: `Color Code ${ids.length} Notes`,
                    label: 'Select a color label',
                    placeholder: 'blue',
                    suggestions: colors,
                    confirmText: 'Set Color',
                    onConfirm: async (color) => {
                        const val = color.toLowerCase().trim();
                        ids.forEach(id => {
                            const note = notes.find(n => n.id === id);
                            if (note) {
                                note.color = (val === 'none' || !val) ? null : val;
                                note.updated = Date.now();
                            }
                        });
                        await vaultService.persistNotes(notes);
                        uiService.showToast('Color labels updated', 'success');
                        toggleSelectionMode(false);
                        uiService.renderCurrentView(vaultService.getNotes());
                    }
                });
            }
        };

        document.getElementById('btn-bulk-delete')?.addEventListener('click', () => performBulkAction('delete'));
        document.getElementById('btn-bulk-archive')?.addEventListener('click', () => performBulkAction('archive'));
        document.getElementById('btn-bulk-move')?.addEventListener('click', () => performBulkAction('move'));
        document.getElementById('btn-bulk-merge')?.addEventListener('click', () => performBulkAction('merge'));
        document.getElementById('btn-bulk-export')?.addEventListener('click', () => performBulkAction('export'));
        document.getElementById('btn-bulk-pin')?.addEventListener('click', () => performBulkAction('pin'));
        document.getElementById('btn-bulk-duplicate')?.addEventListener('click', () => performBulkAction('duplicate'));
        document.getElementById('btn-bulk-tag')?.addEventListener('click', () => performBulkAction('tag'));
        document.getElementById('btn-bulk-color')?.addEventListener('click', () => performBulkAction('color'));
    }
    initBulkActions();
    // --- End Bulk Actions ---

    // --- Cache Management ---
    function initCacheSettings() {
        const btnClear = document.getElementById('btn-clear-cache');
        const sizeDisplay = document.getElementById('cache-size-display');

        // Update size when settings open
        const settingsModal = document.getElementById('settings-modal');
        if (settingsModal) {
            const observer = new MutationObserver((mutations) => {
                mutations.forEach((mutation) => {
                    if (mutation.attributeName === 'class' && !settingsModal.classList.contains('hidden')) {
                        if (navigator.storage && navigator.storage.estimate) {
                            navigator.storage.estimate().then(estimate => {
                                const mb = (estimate.usage / (1024 * 1024)).toFixed(2);
                                if (sizeDisplay) sizeDisplay.textContent = `${mb} MB`;
                            });
                        }
                    }
                });
            });
            observer.observe(settingsModal, { attributes: true });
        }

        btnClear?.addEventListener('click', () => {
            createConfirmationModal({
                title: 'Clear All Data?',
                text: 'This will wipe all local data, cache, and settings. You will be logged out. Ensure you have a backup.',
                confirmText: 'Clear & Reset',
                confirmTone: 'danger',
                onConfirm: async () => {
                    try {
                        // Clear Storage
                        localStorage.clear();
                        sessionStorage.clear();

                        // Clear Cache API
                        if ('caches' in window) {
                            const keys = await caches.keys();
                            await Promise.all(keys.map(key => caches.delete(key)));
                        }

                        // Clear IndexedDB (if used by Firebase/Local)
                        if ('indexedDB' in window && indexedDB.databases) {
                            const dbs = await indexedDB.databases();
                            dbs.forEach(db => indexedDB.deleteDatabase(db.name));
                        }

                        uiService.showToast('Data cleared. Reloading...', 'success');
                        setTimeout(() => window.location.reload(), 1000);
                    } catch (e) {
                        console.error('Clear cache failed', e);
                        uiService.showToast('Failed to clear some data', 'error');
                    }
                }
            });
        });
    }
    initCacheSettings();
    // --- End Cache Management ---

    // --- Panic Mode (Security) ---
    function initPanicMode() {
        document.addEventListener('keydown', (e) => {
            // Trigger: Ctrl + Shift + X (or Cmd + Shift + X)
            if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === 'KeyX') {
                if (e.repeat) return;
                e.preventDefault();
                console.warn('⚠️ PANIC ACTION TRIGGERED');

                // 1. Immediate visual obscuration
                const vaultScreen = document.getElementById('vault-screen');
                if (vaultScreen) vaultScreen.classList.add('hidden');

                // 2. Clear sensitive data
                vaultService.clearSession();

                // 3. Notify system
                bus.emit('auth:locked', 'panic');

                // 4. Feedback
                uiService.showToast('Vault locked via Panic Action', 'error');
            }
        });
    }
    initPanicMode();

    // --- Secure Reminders ---
    function initSecureReminders() {
        const btnReminder = document.getElementById('btn-reminder');
        const modal = document.getElementById('reminders-modal');
        const btnSave = document.getElementById('save-reminder');
        const btnClose = document.getElementById('close-reminders-modal');
        const inputDateTime = document.getElementById('reminder-datetime');
        const inputRecurrence = document.getElementById('reminder-recurrence');

        if (!btnReminder || !modal) return;

        btnReminder.addEventListener('click', () => {
            if (!uiService.activeNoteId) {
                uiService.showToast('Open a note to set a reminder', 'info');
                return;
            }

            const notes = vaultService.getNotes();
            const note = notes.find(n => n.id === uiService.activeNoteId);

            if (note && note.reminder && note.reminder.time) {
                const date = new Date(note.reminder.time);
                // Adjust for local input format
                const offsetMs = date.getTimezoneOffset() * 60000;
                const localISOTime = (new Date(date.getTime() - offsetMs)).toISOString().slice(0, 16);
                inputDateTime.value = localISOTime;
                inputRecurrence.value = note.reminder.recurrence || 'none';
            } else {
                inputDateTime.value = '';
                inputRecurrence.value = 'none';
            }

            modal.classList.remove('hidden');
            modal.showModal();
        });

        const closeModal = () => {
            modal.classList.add('hidden');
            modal.close();
        };

        btnClose?.addEventListener('click', closeModal);

        btnSave?.addEventListener('click', async () => {
            if (!uiService.activeNoteId) return;

            const timeVal = inputDateTime.value;
            const notes = vaultService.getNotes();
            const note = notes.find(n => n.id === uiService.activeNoteId);

            if (!note) return;

            if (!timeVal) {
                if (note.reminder) {
                    delete note.reminder;
                    note.updated = Date.now();
                    await vaultService.upsertNote(note);
                    uiService.showToast('Reminder removed', 'info');
                }
                closeModal();
                return;
            }

            const timestamp = new Date(timeVal).getTime();
            const recurrence = inputRecurrence.value;

            note.reminder = {
                time: timestamp,
                recurrence: recurrence,
                created: Date.now()
            };
            note.updated = Date.now();

            await vaultService.upsertNote(note);
            uiService.showToast('Secure reminder set', 'success');
            closeModal();

            if ('Notification' in window && Notification.permission !== 'granted' && Notification.permission !== 'denied') {
                Notification.requestPermission();
            }
        });
    }
    initSecureReminders();

    // --- Secure Scanner Pro ---
    function initSecureScanner() {
        const btnScan = document.getElementById('btn-scan-doc');
        const modal = document.getElementById('doc-scanner-modal');
        const video = document.getElementById('doc-scanner-video');
        const canvas = document.getElementById('doc-scanner-canvas');
        const btnCapture = document.getElementById('btn-capture-doc');
        const btnInsert = document.getElementById('btn-insert-ocr');
        const btnRetake = document.getElementById('btn-retake-doc');
        const btnClose = document.getElementById('close-doc-scanner-modal');
        const processingDiv = document.getElementById('scanner-processing');
        const resultContainer = document.getElementById('ocr-result-container');
        const resultText = document.getElementById('ocr-result-text');
        const statusText = document.getElementById('ocr-status-text');

        let stream = null;

        if (!btnScan || !modal) return;

        const stopCamera = () => {
            if (stream) {
                stream.getTracks().forEach(track => track.stop());
                stream = null;
            }
            if (video) video.srcObject = null;
        };

        const startCamera = async () => {
            try {
                stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
                video.srcObject = stream;
                await video.play();
                resultContainer.classList.add('hidden');
                btnCapture.classList.remove('hidden');
                processingDiv.classList.add('hidden');
            } catch (err) {
                console.error("Camera error", err);
                uiService.showToast("Camera access denied or unavailable", "error");
                modal.classList.add('hidden');
                modal.close();
            }
        };

        btnScan.addEventListener('click', () => {
            modal.classList.remove('hidden');
            modal.showModal();
            startCamera();
        });

        btnClose.addEventListener('click', () => {
            stopCamera();
            modal.classList.add('hidden');
            modal.close();
        });

        btnCapture.addEventListener('click', async () => {
            if (!video || !canvas) return;

            // Capture frame
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

            // UI State
            btnCapture.classList.add('hidden');
            processingDiv.classList.remove('hidden');
            statusText.textContent = "Analyzing document locally...";

            // OCR
            try {
                if (typeof Tesseract === 'undefined') {
                    throw new Error("OCR engine not loaded");
                }

                const { data: { text } } = await Tesseract.recognize(canvas, 'eng', {
                    logger: m => {
                        if (m.status === 'recognizing text') {
                            statusText.textContent = `Processing: ${Math.round(m.progress * 100)}%`;
                        }
                    }
                });

                resultText.value = text.trim();
                processingDiv.classList.add('hidden');
                resultContainer.classList.remove('hidden');
                stopCamera(); // Stop camera to save battery while reviewing
            } catch (e) {
                console.error(e);
                uiService.showToast("OCR Failed: " + e.message, "error");
                btnCapture.classList.remove('hidden');
                processingDiv.classList.add('hidden');
            }
        });

        btnRetake.addEventListener('click', () => {
            resultContainer.classList.add('hidden');
            startCamera();
        });

        btnInsert.addEventListener('click', () => {
            const text = resultText.value;
            if (text) {
                const contentArea = document.getElementById('note-content');
                if (contentArea) {
                    const start = contentArea.selectionStart;
                    const end = contentArea.selectionEnd;
                    const current = contentArea.value;
                    contentArea.value = current.substring(0, start) + text + current.substring(end);
                    // Trigger input event for auto-save if implemented
                    contentArea.dispatchEvent(new Event('input'));
                }
                uiService.showToast("Text inserted", "success");
            }
            stopCamera();
            modal.classList.add('hidden');
            modal.close();
        });
    }
    initSecureScanner();

    // Reminder Check Loop (Every 30s)
    setInterval(async () => {
        if (!vaultService.isUnlocked()) return;

        const notes = vaultService.getNotes();
        const now = Date.now();
        let changed = false;

        for (const note of notes) {
            if (note.reminder && note.reminder.time && note.reminder.time <= now) {
                // Trigger Notification
                if ('Notification' in window && Notification.permission === 'granted') {
                    new Notification('PINBRIDGE Security', {
                        body: 'Secure Reminder: A vault item requires your attention.',
                        icon: 'src/public/icons/web/pinbridge_32x32.png',
                        tag: 'pinbridge-reminder-' + note.id
                    });
                } else {
                    uiService.showToast('Secure Reminder: Check your vault notes.', 'info');
                }

                // Handle Recurrence
                if (note.reminder.recurrence === 'daily') {
                    note.reminder.time += 86400000;
                } else if (note.reminder.recurrence === 'weekly') {
                    note.reminder.time += 604800000;
                } else if (note.reminder.recurrence === 'monthly') {
                    const d = new Date(note.reminder.time);
                    d.setMonth(d.getMonth() + 1);
                    note.reminder.time = d.getTime();
                } else {
                    delete note.reminder;
                }

                note.updated = Date.now();
                await vaultService.upsertNote(note);
                changed = true;
            }
        }

        if (changed && uiService.currentView === 'all') {
            uiService.renderCurrentView(vaultService.getNotes());
        }
    }, 30000);

    const lang = i18n.init();
    document.documentElement.lang = lang;
    bus.on('i18n:change', (code) => {
        document.documentElement.lang = code || 'en';
    });

    if ('serviceWorker' in navigator) {
        try {
            await navigator.serviceWorker.register('./service-worker.js');
        } catch (e) {
            console.error('Service Worker registration failed', e);
        }
    }

    uiService.init();
    window.addEventListener('online', () => {
        vaultService.ensureSyncActive();
    });

    try {
        const uid = await authService.init();
        await vaultService.init(uid);

        // Try to restore session first (Refresh Persistence)
        const sessionRestored = await authService.restoreSession();
        if (sessionRestored) {
            console.log('Session restored');
            // Session restored -> auth:unlock event will fire and handle UI
            return;
        }

        await vaultService.hasExistingVault();
        uiService.refreshUsernameRecommendation();
        uiService.showScreen('auth');
        uiService.showLoginForm();
    } catch (e) {
        console.error("Critical Initialization Error", e);
        uiService.showToast(i18n.t('toastVaultLoadFailed', { error: 'init' }), "error");
    }
}

// --- GLOBAL EVENT LISTENERS ---

// When the vault is unlocked, create the session and load the UI.
bus.on('auth:unlock', async () => {
    console.log('auth:unlock event fired');
    uiService.showScreen('vault');
    uiService.applyAdminVisibility();
    uiService.updateUserIdentity();
    vaultService.ensureSyncActive();

    // Show skeleton loaders while loading
    uiService.renderNoteList([], true);

    // Small delay to ensure vault is fully initialized
    await new Promise(resolve => setTimeout(resolve, 100));

    try {
        // Ensure vault is unlocked
        if (!vaultService.isUnlocked()) {
            console.error('Vault is not unlocked');
            uiService.showToast('Vault is locked. Please try again.', 'error');
            return;
        }

        console.log('Loading notes...');
        const notes = await notesService.loadAll();
        console.log('Notes loaded:', notes.length, 'notes');

        if (notes && Array.isArray(notes)) {
            searchService.buildIndex(notes);
            bus.emit('view:switch', 'all'); // Trigger initial render via new navigation system
        } else {
            console.error('Notes is not an array:', notes);
            uiService.renderCurrentView([]);
        }
    } catch (err) {
        console.error("Vault load failed", err);
        uiService.showToast(i18n.t('toastVaultLoadFailed', { error: err?.message || 'unknown error' }), "error");
        // Still render empty view to show the UI
        uiService.renderCurrentView([]);
    }
});

bus.on('auth:locked', (reason) => {
    uiService.handleLockedSession(reason);
});

bus.on('vault:remote-update', async () => {
    const listContainer = document.getElementById('notes-list')?.parentElement;
    const scrollTop = listContainer ? listContainer.scrollTop : 0;

    const notes = await notesService.loadAll();
    searchService.buildIndex(notes);
    uiService.showToast('Your vault was updated from another device.', 'info');

    const searchInput = document.getElementById('search-input');
    const query = searchInput ? searchInput.value.trim() : '';

    if (query) {
        const results = searchService.search(query);
        const viewResults = uiService.currentView === 'trash' ? results.filter(n => n.trash) : results.filter(n => !n.trash);
        uiService.renderNoteList(viewResults);
    } else {
        uiService.renderCurrentView(notes);
    }

    if (listContainer) listContainer.scrollTop = scrollTop;

    if (uiService.activeNoteId) {
        const activeNote = notes.find(n => n.id === uiService.activeNoteId);
        if (activeNote) uiService.renderNoteMeta(activeNote);
    }
});

// Start the application
window.addEventListener('DOMContentLoaded', init);

// ADDITIVE: Privacy - Clear session on exit
window.addEventListener('beforeunload', () => {
    const clearOnExit = localStorage.getItem('pinbridge.clear_on_exit') === 'true';
    if (clearOnExit) {
        vaultService.clearSession();
    }
});
