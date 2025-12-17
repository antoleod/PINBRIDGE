/**
 * Minimal Settings Module for PINBRIDGE
 * Focused on portability and explicit reset controls.
 */

import { notesService } from '../notes/notes.js';
import { storageService } from '../../storage/db.js';
import { authService } from '../auth/auth.js';
import { syncService } from '../sync/sync.js';

export const settingsService = {
    async exportJSON() {
        const notes = await notesService.loadAll();
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(notes, null, 2));
        this.downloadFile(dataStr, `pinbridge_backup_${new Date().toISOString().slice(0, 10)}.json`);
    },

    async exportCSV() {
        const notes = await notesService.loadAll();
        let csvContent = "data:text/csv;charset=utf-8,ID,Title,Body,Folder,Tags,Created,Updated\n";
        notes.forEach(n => {
            const title = (n.title || '').replace(/"/g, '""');
            const body = (n.body || '').replace(/"/g, '""');
            const row = `"${n.id}","${title}","${body}","${n.folder || ''}","${(n.tags || []).join(' ')}","${n.created || ''}","${n.updated || ''}"`;
            csvContent += row + "\n";
        });
        this.downloadFile(csvContent, `pinbridge_notes.csv`);
    },

    downloadFile(dataUrl, filename) {
        const downloadAnchorNode = document.createElement('a');
        downloadAnchorNode.setAttribute("href", dataUrl);
        downloadAnchorNode.setAttribute("download", filename);
        document.body.appendChild(downloadAnchorNode);
        downloadAnchorNode.click();
        downloadAnchorNode.remove();
    },

    async importJSON() {
        const input = prompt("Pega aquí el JSON exportado de PINBRIDGE:");
        if (!input) return;
        try {
            const parsed = JSON.parse(input);
            if (!Array.isArray(parsed)) throw new Error("Formato inválido");
            await storageService.resetAll();
            for (const note of parsed) {
                const record = {
                    id: note.id,
                    data: JSON.stringify({
                        title: note.title || '',
                        body: note.body || '',
                        folder: note.folder || '',
                        tags: note.tags || []
                    }),
                    created: note.created || Date.now(),
                    updated: note.updated || Date.now(),
                    trash: !!note.trash,
                    pinned: !!note.pinned
                };
                await storageService.saveNote(record);
            }
            alert("Importación completada. Reinicia sesión.");
            location.reload();
        } catch (e) {
            alert("Importación fallida: " + e.message);
        }
    },

    async copyBackup() {
        const notes = await notesService.loadAll();
        const payload = JSON.stringify(notes);
        await navigator.clipboard.writeText(payload);
        alert("Backup copiado al portapapeles. Pégalo en tu otro dispositivo e importa.");
    },

    async resetVault() {
        const confirmed = confirm("Reset Vault?\nEsto borra tus notas, PIN y sesión local. No se puede deshacer.");
        if (!confirmed) return;
        await storageService.resetAll();
        authService.logout();
        location.reload();
    },

    renderSettingsModal() {
        const overlay = document.createElement('div');
        overlay.id = 'settings-modal';
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="modal-content glass-panel" style="max-width:520px">
                <h2 style="margin-top:0">Portabilidad y control</h2>
                <p class="hint">Exporta, importa o resetea. Todo ocurre en tu dispositivo.</p>
                <div class="settings-grid">
                    <button id="btn-export-json" class="btn btn-secondary">Exportar JSON</button>
                    <button id="btn-export-csv" class="btn btn-secondary">Exportar CSV</button>
                </div>
                <div class="settings-grid" style="margin-top:0.5rem">
                    <button id="btn-import-json" class="btn btn-secondary">Importar JSON</button>
                    <button id="btn-copy-backup" class="btn btn-secondary">Copiar backup al portapapeles</button>
                </div>
                <div class="settings-grid" style="margin-top:0.5rem">
                    <button id="btn-sync-export" class="btn btn-primary">Guardar backup (.json)</button>
                    <button id="btn-sync-import" class="btn btn-primary">Importar backup (.json)</button>
                </div>
                <p class="hint">Sync manual: exporta y mueve el archivo o copia/pega entre dispositivos. Todo sigue local.</p>
                <div class="divider"></div>
                <div class="danger-zone">
                    <p class="warning-text">Reset borra todo el contenido local y requerirá crear un Vault nuevo.</p>
                    <button id="btn-reset-vault" class="btn btn-primary btn-block">Reset Vault</button>
                </div>
                <button id="btn-close-settings" class="btn btn-text" style="margin-top:1rem">Cerrar</button>
            </div>
        `;

        document.body.appendChild(overlay);

        document.getElementById('btn-export-json').onclick = () => this.exportJSON();
        document.getElementById('btn-export-csv').onclick = () => this.exportCSV();
        document.getElementById('btn-import-json').onclick = () => this.importJSON();
        document.getElementById('btn-copy-backup').onclick = () => syncService.copyBackupToClipboard();
        document.getElementById('btn-sync-export').onclick = () => syncService.exportBackup();
        document.getElementById('btn-sync-import').onclick = () => syncService.importBackup();
        document.getElementById('btn-reset-vault').onclick = () => this.resetVault();

        overlay.onclick = (e) => {
            if (e.target === overlay || e.target.id === 'btn-close-settings') overlay.remove();
        };
    }
};

export const SettingsService = settingsService;
