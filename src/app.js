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

bus.on('vault:remote-update', async () => {
    const notes = await notesService.loadAll();
    searchService.buildIndex(notes);
    uiService.showToast('Your vault was updated from another device.', 'info');
    uiService.renderCurrentView(notes);
});

bus.on('sync:disabled', () => {
    uiService.showToast('Sync unavailable. Working in offline-only mode.', 'info');
});

// Start the application
window.addEventListener('DOMContentLoaded', init);
