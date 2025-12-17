/**
 * Vault Module
 * Manages note data and keeps encrypted storage in sync with the UI cache.
 */

import { cryptoService } from '../../crypto/crypto.js';
import { storageService } from '../../storage/db.js';
import { Utils } from '../../utils/helpers.js';
import { bus } from '../../core/bus.js';

class VaultService {
    constructor() {
        this.notes = []; // In-memory cache of decrypted notes for UI/search
    }

    /**
     * Load all notes from IndexedDB and decrypt them into memory.
     */
    async loadAll() {
        this.notes = [];
        if (!cryptoService.masterKey) {
            throw new Error("Vault locked");
        }
        const encryptedNotes = await storageService.getNotes();

        for (const encNote of encryptedNotes) {
            try {
                const decryptedJson = await cryptoService.decryptData(encNote.data);
                const noteData = JSON.parse(decryptedJson);

                this.notes.push({
                    id: encNote.id,
                    title: noteData.title || '',
                    body: noteData.body || '',
                    folder: noteData.folder || "",
                    tags: noteData.tags || [],
                    created: encNote.created || encNote.updated || Date.now(),
                    updated: encNote.updated || encNote.created || Date.now(),
                    trash: encNote.trash || false,
                    pinned: encNote.pinned || false
                });
            } catch (e) {
                console.error(`Failed to decrypt note ${encNote.id}`, e);
                this.notes.push({
                    id: encNote.id,
                    title: "⚠️ Decryption Failed",
                    body: "Could not decrypt this note.",
                    created: encNote.created || encNote.updated || Date.now(),
                    updated: encNote.updated || Date.now(),
                    trash: false,
                    pinned: false,
                    error: true
                });
            }
        }

        this.sortNotes();
        bus.emit('vault:notes_loaded', this.notes);
        return this.notes;
    }

    /**
     * Create a new note.
     */
    async createNote(title, body, folder = "", tags = [], options = {}) {
        const id = Utils.generateId();
        const timestamp = Date.now();
        const note = {
            id,
            title: title || '',
            body: body || '',
            folder,
            tags,
            created: timestamp,
            updated: timestamp,
            trash: false,
            pinned: false
        };

        const { persist = true } = options;
        const contentPresent = (note.title || '').trim() || (note.body || '').trim();
        if (persist && contentPresent) {
            await this.persistNote(note);
        }
        this.notes.push(note);
        this.sortNotes();
        bus.emit('vault:updated', this.notes);
        return id;
    }

    /**
     * Update an existing note (content, folder, tags).
     */
    async updateNote(id, title, body, folder = "", tags = []) {
        const note = this.notes.find(n => n.id === id);
        if (!note) return;

        note.title = title || '';
        note.body = body || '';
        note.folder = folder;
        note.tags = tags;
        note.updated = Date.now();

        await this.persistNote(note);
        this.sortNotes();
        bus.emit('vault:updated', this.notes);
    }

    /**
     * Save a point-in-time version of a note (optional history).
     */
    async createVersion(note) {
        try {
            const plainObj = { title: note.title, body: note.body, folder: note.folder, tags: note.tags };
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

    /**
     * Pin/unpin a note without altering its updated timestamp.
     */
    async togglePin(id) {
        const note = this.notes.find(n => n.id === id);
        if (!note) return;

        note.pinned = !note.pinned;
        await this.persistNote(note, { bumpUpdated: false });
        this.sortNotes();
        bus.emit('vault:updated', this.notes);
    }

    /**
     * Soft delete a note (move to trash).
     */
    async moveToTrash(id) {
        const note = this.notes.find(n => n.id === id);
        if (!note) return;

        note.trash = true;
        note.updated = Date.now();
        await this.persistNote(note);
        bus.emit('vault:updated', this.notes);
    }

    /**
     * Restore a trashed note.
     */
    async restoreFromTrash(id) {
        const note = this.notes.find(n => n.id === id);
        if (!note) return;

        note.trash = false;
        note.updated = Date.now();
        await this.persistNote(note);
        this.sortNotes();
        bus.emit('vault:updated', this.notes);
    }

    /**
     * Permanently delete a note.
     */
    async deleteNote(id) {
        await storageService.deleteNote(id);
        this.notes = this.notes.filter(n => n.id !== id);
        bus.emit('vault:updated', this.notes);
    }

    /**
     * Persist the provided note back to IndexedDB, encrypting its content.
     * @param {Object} note - decrypted note object
     * @param {Object} options
     * @param {boolean} options.bumpUpdated - whether to bump the updated timestamp (default true)
     */
    async persistNote(note, { bumpUpdated = true } = {}) {
        const trimmedTitle = (note.title || '').trim();
        const trimmedBody = (note.body || '').trim();
        if (!trimmedTitle && !trimmedBody) {
            console.warn(`Skipping empty note persistence for ${note.id}`);
            return;
        }
        const payload = {
            title: note.title,
            body: note.body,
            folder: note.folder,
            tags: note.tags
        };
        const encryptedData = await cryptoService.encryptData(JSON.stringify(payload));

        const record = {
            id: note.id,
            data: encryptedData,
            created: note.created,
            updated: bumpUpdated ? Date.now() : note.updated,
            trash: !!note.trash,
            pinned: !!note.pinned
        };

        if (bumpUpdated) {
            note.updated = record.updated;
        }

        await storageService.saveNote(record);
    }

    /**
     * Sort notes by pinned first, then by updated timestamp desc.
     */
    sortNotes() {
        this.notes.sort((a, b) => {
            if (a.pinned && !b.pinned) return -1;
            if (!a.pinned && b.pinned) return 1;
            return b.updated - a.updated;
        });
    }
}

export const vaultService = new VaultService();
