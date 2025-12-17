/**
 * Vault Module
 * Manages Note data, handles encryption/decryption transparency.
 */

import { cryptoService } from '../../crypto/crypto.js';
import { storageService } from '../../storage/db.js';
import { Utils } from '../../utils/helpers.js';
import { bus } from '../../core/bus.js';

class VaultService {
    constructor() {
        this.notes = []; // In-memory cache of DECRYPTED notes (for UI)
    }

    /**
     * Load all notes from DB and decrypt them.
     */
    async loadAll() {
        this.notes = [];
        const encryptedNotes = await storageService.getNotes();

        for (const encNote of encryptedNotes) {
            try {
                const decryptedJson = await cryptoService.decryptData(encNote.data);
                const noteData = JSON.parse(decryptedJson); // { title, body }

                this.notes.push({
                    id: encNote.id,
                    title: noteData.title,
                    body: noteData.body,
                    folder: noteData.folder || "",
                    tags: noteData.tags || [],
                    updated: encNote.updated,
                    trash: encNote.trash || false,
                    pinned: encNote.pinned || false // Load pinned status
                });
            } catch (e) {
                console.error(`Failed to decrypt note ${encNote.id}`, e);
                this.notes.push({
                    id: encNote.id,
                    title: "⚠️ Decryption Failed",
                    body: "Could not decrypt this note.",
                    updated: encNote.updated || Date.now(),
                    error: true
                });
            }
        }

        // Sort by Pinned then updated desc
        this.sortNotes();

        bus.emit('vault:notes_loaded', this.notes);
        return this.notes;
    }

    async createNote(title, body, folder = "", tags = []) {
        const id = Utils.generateId();
        const timestamp = Date.now();

        // Encrypt content (including folder/tags)
        // We include metadata in encrypted blob for max privacy
        const plainObj = { title, body, folder, tags };
        const encryptedData = await cryptoService.encryptData(JSON.stringify(plainObj));

        const noteRecord = {
            id,
            data: encryptedData,
            created: timestamp,
            updated: timestamp,
            trash: false,
            pinned: false
        };

        await storageService.saveNote(noteRecord);

        // Update local cache
        this.notes.push({ id, title, body, folder, tags, updated: timestamp, trash: false, pinned: false });
        this.sortNotes();
        bus.emit('vault:updated', this.notes);

        return id;
    }


    // 2. Encrypt New Data
    const plainObj = { title, body };
    const plainText = JSON.stringify(plainObj);
    const encryptedData = await cryptoService.encryptData(plainText);

    // 3. Save
    const noteRecord = {
        id: id,
        data: encryptedData,
        updated: timestamp,
        trash: false
    };

        await storageService.saveNote(noteRecord);

// 4. Update local cache
const index = this.notes.findIndex(n => n.id === id);
if (index !== -1) {
    this.notes[index] = { id, title, body, updated: timestamp, trash: false };
    // Move to top
    const item = this.notes.splice(index, 1)[0];
    this.notes.unshift(item);
}
bus.emit('vault:updated', this.notes);
    }

    async createVersion(note) {
    try {
        const plainObj = { title: note.title, body: note.body };
        const encryptedData = await cryptoService.encryptData(JSON.stringify(plainObj));

        const versionObj = {
            versionId: Utils.uuidv4(),
            noteId: note.id,
            data: encryptedData,
            savedAt: Date.now()
        };

        await storageService.saveVersion(versionObj);
    } catch (e) {
        console.error("Versioning failed", e);
    }
}

    // Toggle Pin
    async togglePin(id) {
    const note = this.notes.find(n => n.id === id);
    if (!note) return;

    const newPinnedState = !note.pinned;

    // Persist to        // Reuse create/update logic but preserve exact content?
    const plainObj = { title: note.title, body: note.body, folder: note.folder, tags: note.tags };
    const encryptedData = await cryptoService.encryptData(JSON.stringify(plainObj));

    const noteRecord = {
        id: id,
        data: encryptedData,
        updated: note.updated, // Don't bump updated time for pin?
        trash: note.trash,
        pinned: newPinnedState
    };

    await storageService.saveNote(noteRecord);

    // Update local
    note.pinned = newPinnedState;

    // Re-sort: Pinned first, then updated desc
    this.sortNotes();

    bus.emit('vault:updated', this.notes);
}

sortNotes() {
    this.notes.sort((a, b) => {
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
        return b.updated - a.updated;
    });
}

    // Soft Delete
    async moveToTrash(id) {
    const note = this.notes.find(n => n.id === id);
    if (!note) return;

    // Re-encrypt to update DB record properly or just update metadata if we separated them.
    // Since 'trash' is a top-level property in DB object, we just re-save the whole thing.
    // We reuse the existing encrypted data logic.

    const plainObj = { title: note.title, body: note.body };
    const encryptedData = await cryptoService.encryptData(JSON.stringify(plainObj));

    const noteRecord = {
        id: id,
        data: encryptedData,
        updated: Date.now(),
        trash: true
    };

    await storageService.saveNote(noteRecord);

    note.trash = true;
    bus.emit('vault:updated', this.notes);
}

    // Restore
    async restoreFromTrash(id) {
    const note = this.notes.find(n => n.id === id);
    if (!note) return;

    const plainObj = { title: note.title, body: note.body };
    const encryptedData = await cryptoService.encryptData(JSON.stringify(plainObj));

    const noteRecord = {
        id: id,
        data: encryptedData,
        updated: Date.now(),
        trash: false
    };

    await storageService.saveNote(noteRecord);

    note.trash = false;
    bus.emit('vault:updated', this.notes);
}

    // Hard Delete
    async deleteNote(id) {
    await storageService.deleteNote(id);
    this.notes = this.notes.filter(n => n.id !== id);
    bus.emit('vault:updated', this.notes);
}
}

export const vaultService = new VaultService();
