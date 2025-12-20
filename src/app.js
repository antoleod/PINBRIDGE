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

// --- INIT ---
async function init() {
    console.log("PINBRIDGE: Initializing...");

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
            // Small delay for smooth transition from skeleton
            await new Promise(resolve => setTimeout(resolve, 300));
            uiService.renderCurrentView(notes);

            // Initialize feather icons after rendering
            if (typeof feather !== 'undefined') {
                feather.replace();
            }
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

bus.on('sync:disabled', () => {
    uiService.showToast('Sync unavailable. Working in offline-only mode.', 'info');
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
