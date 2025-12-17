/**
 * Minimal offline sync/export/import helper.
 * All data stays local; export produces a JSON file you can move to another device.
 */

import { storageService } from '../../storage/db.js';

export const syncService = {
    /**
     * Export all local data (notes + meta + auth) to a downloadable JSON file.
     */
    async exportBackup() {
        const payload = await buildPayload();
        download(JSON.stringify(payload, null, 2), `pinbridge_backup_${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    },

    /**
     * Import a backup from a JSON file chosen by the user.
     */
    async importBackup() {
        return new Promise((resolve) => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.json,application/json';
            input.onchange = async (e) => {
                const file = e.target.files?.[0];
                if (!file) return resolve(false);
                try {
                    const text = await file.text();
                    const parsed = JSON.parse(text);
                    await restorePayload(parsed);
                    alert('Backup importado. Reinicia la app para continuar.');
                    location.reload();
                    resolve(true);
                } catch (err) {
                    alert('No se pudo importar: ' + (err?.message || err));
                    resolve(false);
                }
            };
            input.click();
        });
    },

    /**
     * Copy backup to clipboard (quick sync via paste).
     */
    async copyBackupToClipboard() {
        const payload = await buildPayload();
        await navigator.clipboard.writeText(JSON.stringify(payload));
        alert('Backup copiado. Pega en el otro dispositivo y usa Importar desde portapapeles.');
    },

    /**
     * Import from clipboard.
     */
    async importFromClipboard() {
        try {
            const text = await navigator.clipboard.readText();
            if (!text) throw new Error('Portapapeles vacío');
            const parsed = JSON.parse(text);
            await restorePayload(parsed);
            alert('Importado desde portapapeles. Reinicia la app.');
            location.reload();
        } catch (err) {
            alert('No se pudo importar: ' + (err?.message || err));
        }
    }
};

async function buildPayload() {
    const notes = await storageService.getNotes();
    const meta = await storageService.getAllMeta();
    const auth = await storageService.getAuthData();
    return { notes, meta, auth, exportedAt: Date.now() };
}

async function restorePayload(payload) {
    if (!payload || !Array.isArray(payload.notes)) throw new Error('Formato de backup inválido');
    await storageService.resetAll();
    for (const note of payload.notes) {
        await storageService.saveNote(note);
    }
    if (payload.meta) {
        for (const entry of payload.meta) {
            await storageService.setMeta(entry.key, entry.value);
        }
    }
    if (payload.auth) {
        await storageService.saveAuthData(payload.auth);
    }
}

function download(content, filename) {
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

export default syncService;
