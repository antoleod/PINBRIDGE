/**
 * Notes Module
 * Manages note data and keeps plain text storage in sync with the UI cache.
 * (Formerly VaultService)
 */

import { storageService } from '../../storage/db.js';
import { Utils } from '../../utils/helpers.js';
import { bus } from '../../core/bus.js';

class NotesService {
    constructor() {
        this.notes = []; // In-memory cache of notes for UI/search
    }

    /**
     * Load all notes from IndexedDB and parse them into memory.
     */
    async loadAll() {
        this.notes = [];
        // We assume authService has already authenticated the user.
        const storedNotes = await storageService.getNotes();

        for (const storedNote of storedNotes) {
            try {
                // New behavior: data is a JSON string, not an encrypted blob.
                const noteData = JSON.parse(storedNote.data);

                this.notes.push({
                    id: storedNote.id,
                    title: noteData.title || '',
                    body: noteData.body || '',
                    folder: noteData.folder || "",
                    tags: noteData.tags || [],
                    created: storedNote.created || storedNote.updated || Date.now(),
                    updated: storedNote.updated || storedNote.created || Date.now(),
                    trash: storedNote.trash || false,
                    pinned: storedNote.pinned || false
                });
            } catch (e) {
                // This will catch errors from trying to parse old, encrypted data.
                console.error(`Failed to parse note ${storedNote.id}. It might be from a previous encrypted version.`, e);
                this.notes.push({
                    id: storedNote.id,
                    title: "Legacy note (unreadable)",
                    body: "This note comes from an older encrypted version and cannot be opened now.",
                    created: storedNote.created || storedNote.updated || Date.now(),
                    updated: storedNote.updated || Date.now(),
                    trash: false,
                    pinned: false,
                    error: true
                });
            }
        }

        this.sortNotes();
        bus.emit('notes:loaded', this.notes);
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
        bus.emit('notes:updated', this.notes);
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
        bus.emit('notes:updated', this.notes);
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
        bus.emit('notes:updated', this.notes);
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
        bus.emit('notes:updated', this.notes);
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
        bus.emit('notes:updated', this.notes);
    }

    /**
     * Permanently delete a note.
     */
    async deleteNote(id) {
        await storageService.deleteNote(id);
        this.notes = this.notes.filter(n => n.id !== id);
        bus.emit('notes:updated', this.notes);
    }

    /**
     * Persist the provided note back to IndexedDB as a plain JSON string.
     * @param {Object} note - note object
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
        if (trimmedTitle.toLowerCase() === 'untitled note' && !trimmedBody) {
            console.warn(`Skipping placeholder note persistence for ${note.id}`);
            return;
        }
        const payload = {
            title: note.title,
            body: note.body,
            folder: note.folder,
            tags: note.tags
        };
        
        // New behavior: Store data as a plain JSON string. No encryption.
        const noteData = JSON.stringify(payload);

        const record = {
            id: note.id,
            data: noteData,
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

export const notesService = new NotesService();
