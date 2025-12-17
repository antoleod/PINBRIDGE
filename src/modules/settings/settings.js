/**
 * Settings Module
 * Handles UI for Settings Modal, Export/Import, and Recovery Setup.
 */

import { vaultService } from '../vault/vault.js';
import { authService } from '../auth/auth.js';
import { Utils } from '../../utils/helpers.js';
import { syncService } from '../sync/index.js';

export const settingsService = {

    // --- EXPORT ---

    async exportJSON() {
        const notes = await vaultService.loadAll();
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(notes, null, 2));
        this.downloadFile(dataStr, `pinbridge_backup_${new Date().toISOString().slice(0, 10)}.json`);
    },

    async exportCSV() {
        const notes = await vaultService.loadAll();
        let csvContent = "data:text/csv;charset=utf-8,ID,Title,Body,Created,Updated\n";
        notes.forEach(n => {
            const body = n.body.replace(/"/g, '""'); // Escape quotes
            const row = `"${n.id}","${n.title}","${body}","${n.created || ''}","${n.updated}"`;
            csvContent += row + "\n";
        });
        this.downloadFile(csvContent, `pinbridge_notes.csv`);
    },

    downloadFile(dataUrl, filename) {
        const downloadAnchorNode = document.createElement('a');
        downloadAnchorNode.setAttribute("href", dataUrl);
        downloadAnchorNode.setAttribute("download", filename);
        document.body.appendChild(downloadAnchorNode); // required for firefox
        downloadAnchorNode.click();
        downloadAnchorNode.remove();
    },

    // --- RECOVERY UI ---

    async setupBackupCodes() {
        if (!confirm("Generate new backup codes? Old ones will be invalid.")) return;
        try {
            const codes = await authService.generateBackupCodes();
            let msg = "⚠️ SAVE THESE CODES SECURELY:\n\n";
            codes.forEach(c => msg += `• ${c}\n`);
            alert(msg);
        } catch (e) {
            alert("Error: " + e.message);
        }
    },

    async setupHint() {
        const current = await authService.getHint();
        const hint = prompt("Set a public password hint:", current || "");
        if (hint !== null) {
            await authService.saveHint(hint);
            alert("Hint saved.");
        }
    },

    async setupQA() {
        const ans = prompt("Enter a secret answer (e.g. Pet's name) to unlock your vault:\nNote: The Question itself is NOT stored, only the Answer unlocks it.");
        if (ans) {
            await authService.setupQA(ans);
            alert("Secret Answer saved. You can use it as a password to login.");
        }
    },

    // --- RENDER UI ---

    renderSettingsModal() {
        // Simple Overlay
        const overlay = document.createElement('div');
        overlay.id = 'settings-modal';
        overlay.style.cssText = `
            position: fixed; inset: 0; background: rgba(0,0,0,0.8); z-index: 200;
            display: flex; justify-content: center; align-items: center;
        `;

        overlay.innerHTML = `
            <div class="glass-panel" style="width: 500px; padding: 2rem; border-radius: 12px; max-height: 80vh; overflow-y: auto;">
                <h2 style="margin-top:0">Settings & Tools</h2>
                
                <h3 style="margin-top:1.5rem; color:var(--brand-primary)">Portability</h3>
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:0.5rem">
                    <button id="btn-export-json" class="btn btn-primary" style="background:var(--bg-surface); border:1px solid var(--border-subtle)">Export JSON</button>
                    <button id="btn-export-csv" class="btn btn-primary" style="background:var(--bg-surface); border:1px solid var(--border-subtle)">Export CSV</button>
                </div>
                <button id="btn-export-pbak" class="btn btn-primary" style="width:100%; margin-top:0.5rem">Export Encrypted (.pbak)</button>

                <h3 style="margin-top:1.5rem; color:var(--text-danger)">Security & Recovery</h3>
                <div style="display:flex; flex-direction:column; gap:0.5rem">
                    <button id="btn-rec-codes" class="btn btn-primary">Generate Backup Codes</button>
                    <button id="btn-rec-qa" class="btn btn-primary">Set Secret Answer</button>
                    <button id="btn-rec-hint" class="btn btn-primary">Set Public Hint</button>
                </div>
                
                <h3 style="margin-top:1.5rem; color:var(--brand-primary)">Sync</h3>
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:0.5rem">
                    <button id="btn-sync-send" class="btn btn-primary">Pair with QR (Send)</button>
                    <button id="btn-sync-receive" class="btn btn-primary">Scan QR (Receive)</button>
                </div>
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:0.5rem; margin-top:0.5rem">
                    <button id="btn-sync-export" class="btn btn-primary">Export encrypted</button>
                    <button id="btn-sync-import" class="btn btn-primary">Import encrypted</button>
                </div>
                <button id="btn-close-settings" class="btn btn-text" style="margin-top:2rem">Close</button>
            </div>
        `;

        document.body.appendChild(overlay);

        // Bindings
        document.getElementById('btn-export-json').onclick = () => this.exportJSON();
        document.getElementById('btn-export-csv').onclick = () => this.exportCSV();
        document.getElementById('btn-export-pbak').onclick = () => syncService.exportOfflinePackage();

        document.getElementById('btn-rec-codes').onclick = () => this.setupBackupCodes();
        document.getElementById('btn-rec-qa').onclick = () => this.setupQA();
        document.getElementById('btn-rec-hint').onclick = () => this.setupHint();
        document.getElementById('btn-sync-send').onclick = () => syncService.openOfferFlow();
        document.getElementById('btn-sync-receive').onclick = () => syncService.openAnswerFlow();
        document.getElementById('btn-sync-export').onclick = () => syncService.exportOfflinePackage();
        document.getElementById('btn-sync-import').onclick = () => syncService.importOfflinePackage();

        overlay.onclick = (e) => {
            if (e.target === overlay || e.target.id === 'btn-close-settings') overlay.remove();
        };
    }
};

// Keep the original name available for any legacy imports
export const SettingsService = settingsService;
