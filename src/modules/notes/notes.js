/**
 * Notes Module
 * Manages note data and keeps plain text storage in sync with the UI cache.
 * (Formerly VaultService)
 */

import { Utils } from '../../utils/helpers.js';
import { bus } from '../../core/bus.js';
import { vaultService } from '../../vault.js';

class NotesService {
    constructor() {
        this.notes = [];
    }

    /**
     * Load all notes from IndexedDB and parse them into memory.
     */
    async loadAll() {
        this.notes = vaultService.getNotes().map(n => ({ ...n }));
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
            const persisted = await this.persistNote(note);
            if (persisted) Object.assign(note, persisted);
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
        this.sortNotes();
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
        this.notes = this.notes.filter(n => n.id !== id);
        await vaultService.replaceNotes(this.notes);
        this.sortNotes();
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
        const updatedNote = { ...note };
        if (bumpUpdated) {
            updatedNote.updated = Date.now();
        }
        await vaultService.upsertNote(updatedNote);
        const localIndex = this.notes.findIndex(n => n.id === note.id);
        if (localIndex >= 0) {
            this.notes[localIndex] = updatedNote;
        }
        return updatedNote;
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
