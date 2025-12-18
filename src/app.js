/**
 * Main Application Entry Point
 */

import { storageService } from './storage/db.js';
import { authService } from './modules/auth/auth.js';
import { notesService } from './modules/notes/notes.js';
import { searchService } from './modules/search/search.js';
import { uiService } from './ui/ui.js';
import { bus } from './core/bus.js';
import { i18n } from './core/i18n.js';

// --- INIT ---
async function init() {
    console.log("PINBRIDGE: Initializing...");
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
        await storageService.init('pinbridge_db');
        const hasVault = await authService.hasVault();
        const sessionActive = hasVault && authService.restoreSession();

        if (hasVault && sessionActive) {
            // If a session is active, go directly to the vault.
            console.log("Active session found. Unlocking vault...");
            uiService.showToast(i18n.t("toastSessionRestored"), "info");
            bus.emit('auth:unlock');
        } else {
            // Otherwise, show the auth screen.
            uiService.showScreen('auth');
            if (hasVault) {
                uiService.showLoginForm();
            } else {
                uiService.showAuthChoice();
            }
        }
    } catch (e) {
        console.error("Critical Initialization Error", e);
        uiService.showToast(i18n.t('toastVaultLoadFailed', { error: 'init storage' }), "error");
    }
}

// --- GLOBAL EVENT LISTENERS ---

// When the vault is unlocked, create the session and load the UI.
bus.on('auth:unlock', async () => {
    uiService.showScreen('vault');
    try {
        const notes = await notesService.loadAll();
        searchService.buildIndex(notes);
        uiService.renderCurrentView(notes);
    } catch (err) {
        console.error("Vault load failed", err);
        uiService.showToast(i18n.t('toastVaultLoadFailed', { error: err?.message || 'unknown error' }), "error");
    }
});

bus.on('auth:locked', (reason) => {
    uiService.handleLockedSession(reason);
});

// Start the application
init();
