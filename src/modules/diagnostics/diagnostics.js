import { notesService } from '../notes/notes.js';
import { storageService } from '../../storage/db.js';
import { vaultService } from '../../vault.js';
import { cryptoService } from '../../crypto/crypto.js';

class DiagnosticsService {
    async runPersistenceChecks() {
        if (!vaultService.isUnlocked()) {
            throw new Error('Vault locked. Unlock before running checks.');
        }

        const results = [];
        const report = (name, ok, details) => {
            results.push({ name, ok, details: details || '' });
        };

        const uniqueId = `diag-${Date.now()}`;
        const initialTitle = `Diagnostics Note ${uniqueId}`;
        const initialBody = `Diagnostics body ${uniqueId}`;
        const updatedBody = `${initialBody} (updated)`;

        const id = await notesService.createNote(initialTitle, initialBody, '', []);
        report('Create note', !!id, id ? `id=${id}` : 'no id');

        const encrypted = await storageService.getEncryptedVault();
        if (!encrypted?.payload) {
            report('Encrypted vault exists', false, 'missing encrypted vault');
        } else {
            const decrypted = await cryptoService.decryptObject(encrypted.payload, vaultService.dataKey);
            const found = (decrypted.notes || []).find(n => n.id === id);
            report('Note persisted in vault', !!found, found ? 'found in encrypted vault' : 'not found');
        }

        await notesService.updateNote(id, initialTitle, updatedBody, '', []);
        const updatedEncrypted = await storageService.getEncryptedVault();
        const updatedDecrypted = updatedEncrypted?.payload
            ? await cryptoService.decryptObject(updatedEncrypted.payload, vaultService.dataKey)
            : null;
        const updatedNote = updatedDecrypted?.notes?.find(n => n.id === id);
        report('Note update persisted', updatedNote?.body === updatedBody, updatedNote ? 'updated body matches' : 'missing');

        const ids = new Set();
        let duplicate = false;
        notesService.notes.forEach(note => {
            if (ids.has(note.id)) duplicate = true;
            ids.add(note.id);
        });
        report('No duplicate IDs in memory', !duplicate, duplicate ? 'duplicate id detected' : 'ok');

        return results;
    }
}

export const diagnosticsService = new DiagnosticsService();
