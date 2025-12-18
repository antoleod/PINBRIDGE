/**
 * Minimal Settings Module for PINBRIDGE
 * Focused on portability and explicit reset controls.
 */

import { storageService } from '../../storage/db.js';
import { authService } from '../../auth.js';
import { i18n } from '../../core/i18n.js';
import { vaultService } from '../../vault.js';
import { syncService } from '../../sync.js';

export const settingsService = {
    async exportJSON() {
        const backup = await this.buildBackupPayload();
        const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(backup, null, 2));
        this.downloadFile(dataStr, `pinbridge_backup_${new Date().toISOString().slice(0, 10)}.json`);
    },

    downloadFile(dataUrl, filename) {
        const downloadAnchorNode = document.createElement('a');
        downloadAnchorNode.setAttribute('href', dataUrl);
        downloadAnchorNode.setAttribute('download', filename);
        document.body.appendChild(downloadAnchorNode);
        downloadAnchorNode.click();
        downloadAnchorNode.remove();
    },

    async importJSON() {
        const input = prompt(i18n.t('settingsPromptImport'));
        if (!input) return;
        try {
            const parsed = JSON.parse(input);
            await this.restoreBackup(parsed);
            alert(i18n.t('settingsImportSuccess'));
            location.reload();
        } catch (e) {
            alert(i18n.t('settingsImportFailed', { error: e.message }));
        }
    },

    async copyBackup() {
        const backup = await this.buildBackupPayload();
        await navigator.clipboard.writeText(JSON.stringify(backup));
        alert(i18n.t('backupCopied'));
    },

    async resetVault() {
        const confirmed = confirm(i18n.t('settingsResetConfirm'));
        if (!confirmed) return;
        await storageService.resetAll();
        vaultService.meta = null;
        vaultService.vault = { notes: [], meta: {} };
        vaultService.localUpdatedAt = null;
        authService.forceLogout('manual');
        location.reload();
    },

    renderSettingsModal() {
        const overlay = document.createElement('div');
        overlay.id = 'settings-modal';
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="modal-content glass-panel" style="max-width:520px">
                <h2 style="margin-top:0">${i18n.t('settingsTitle')}</h2>
                <p class="hint">${i18n.t('settingsHint')}</p>
                <div class="settings-grid">
                    <button id="btn-export-json" class="btn btn-secondary">${i18n.t('settingsExportJson')}</button>
                </div>
                <div class="settings-grid" style="margin-top:0.5rem">
                    <button id="btn-import-json" class="btn btn-secondary">${i18n.t('settingsImportJson')}</button>
                    <button id="btn-copy-backup" class="btn btn-secondary">${i18n.t('settingsCopyBackup')}</button>
                </div>
                <p class="hint">${i18n.t('settingsSyncHint')}</p>
                <div class="divider"></div>
                <div class="danger-zone">
                    <p class="warning-text">${i18n.t('settingsResetWarning')}</p>
                    <button id="btn-reset-vault" class="btn btn-primary btn-block">${i18n.t('settingsResetCta')}</button>
                </div>
                <button id="btn-close-settings" class="btn btn-text" style="margin-top:1rem">${i18n.t('settingsClose')}</button>
            </div>
        `;

        document.body.appendChild(overlay);

        document.getElementById('btn-export-json').onclick = () => this.exportJSON();
        document.getElementById('btn-import-json').onclick = () => this.importJSON();
        document.getElementById('btn-copy-backup').onclick = () => this.copyBackup();
        document.getElementById('btn-reset-vault').onclick = () => this.resetVault();

        overlay.onclick = (e) => {
            if (e.target === overlay || e.target.id === 'btn-close-settings') overlay.remove();
        };
    }
};

settingsService.buildBackupPayload = async function () {
    const meta = await storageService.getCryptoMeta();
    const vault = await storageService.getEncryptedVault();
    if (!meta || !vault) throw new Error('NO_VAULT');
    return { meta, vault, exportedAt: new Date().toISOString() };
};

settingsService.restoreBackup = async function (payload) {
    if (!payload || !payload.meta || !payload.vault) throw new Error('Invalid backup');
    await storageService.resetAll();
    await storageService.saveCryptoMeta(payload.meta);
    await storageService.saveEncryptedVault(payload.vault);
    await syncService.pushMeta(authService.getUid(), payload.meta);
    await syncService.pushVault(authService.getUid(), payload.vault);
    vaultService.lock();
};

export const SettingsService = settingsService;
