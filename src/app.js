/**
 * Main Application Entry Point
 */

import { storageService } from './storage/db.js';
import { authService } from './modules/auth/auth.js';
import { notesService } from './modules/notes/notes.js';
import { searchService } from './modules/search/search.js';
import { uiService } from './ui/ui.js';
import { bus } from './core/bus.js';

// --- INIT ---
async function init() {
    console.log("PINBRIDGE: Initializing...");

    if ('serviceWorker' in navigator) {
        try {
            await navigator.serviceWorker.register('./service-worker.js');
        } catch (e) {
            console.error('Service Worker registration failed', e);
        }
    }

    uiService.init();

    try {
        await storageService.init('pinbridge_db');
        const hasVault = await authService.hasVault();
        const sessionActive = localStorage.getItem('pinbridge_session') === 'active';

        if (hasVault && sessionActive) {
            // If a session is active, go directly to the vault.
            console.log("Active session found. Unlocking vault...");
            uiService.showToast("Session restored", "info");
            authService.isAuthenticated = true;
            bus.emit('auth:unlock');
        } else {
            // Otherwise, show the auth screen.
            uiService.showScreen('auth');
            if (hasVault) {
                // The login form is shown by default
            } else {
                uiService.forms.login.classList.add('hidden');
                uiService.forms.setup.classList.remove('hidden');
            }
        }
    } catch (e) {
        console.error("Critical Initialization Error", e);
        uiService.showToast("Failed to initialize storage.", "error");
    }
}

// --- GLOBAL EVENT LISTENERS ---

// When the vault is unlocked, create the session and load the UI.
bus.on('auth:unlock', async () => {
    localStorage.setItem('pinbridge_session', 'active');
    uiService.showScreen('vault');
    try {
        const notes = await notesService.loadAll();
        searchService.buildIndex(notes);
        uiService.renderCurrentView(notes);
    } catch (err) {
        console.error("Vault load failed", err);
        uiService.showToast(`Vault load failed: ${err?.message || 'unknown error'}`, "error");
    }
});

// Start the application
init();
