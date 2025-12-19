/**
 * Notes Module
 * Manages note data and keeps plain text storage in sync with the UI cache.
 * (Formerly VaultService)
 */

import { Utils } from '../../utils/helpers.js';
import { bus } from '../../core/bus.js';
import { vaultService } from '../../vault.js';
import { storageService } from '../../storage/db.js';

// Tag color palette
const TAG_COLORS = {
    red: '#ef4444',
    orange: '#f97316',
    yellow: '#eab308',
    green: '#22c55e',
    blue: '#3b82f6',
    purple: '#a855f7',
    pink: '#ec4899',
    gray: '#6b7280'
};

class NotesService {
    constructor() {
        this.notes = [];
    }

    /**
     * Load all notes from IndexedDB and parse them into memory.
     */
    async loadAll() {
        if (!vaultService.isUnlocked()) {
            console.warn('Cannot load notes: vault is locked');
            this.notes = [];
            return this.notes;
        }
        
        const vaultNotes = vaultService.getNotes();
        console.log('Vault notes from getNotes():', vaultNotes?.length || 0);
        
        this.notes = (vaultNotes || []).map(n => ({ ...n }));
        this.sortNotes();
        bus.emit('notes:loaded', this.notes);
        return this.notes;
    }

    /**
     * Extract hashtags from text and return as tag objects with default color
     */
    extractTags(text) {
        if (!text) return [];
        const regex = /#[\w-]+/g;
        const matches = text.match(regex) || [];
        return matches.map(tag => ({
            name: tag.substring(1), // Remove #
            color: 'blue' // Default color
        }));
    }

    /**
     * Get color for a tag name (from existing tags or default)
     */
    getTagColor(tagName, existingTags = []) {
        const existing = existingTags.find(t =>
            (typeof t === 'string' ? t : t.name) === tagName
        );
        return existing?.color || 'blue';
    }

    /**
     * Normalize tags to object format {name, color}
     */
    normalizeTags(tags) {
        if (!tags || !Array.isArray(tags)) return [];
        return tags.map(tag => {
            if (typeof tag === 'string') {
                return { name: tag, color: 'blue' };
            }
            return tag;
        });
    }

    _isGeneratedPasswordNote(note) {
        if (!note?.tags) return false;
        return note.tags.some(tag => (typeof tag === 'string' ? tag : tag.name) === 'generated-password');
    }

    /**
     * Create a new note.
     */
    async createNote(title = "", body = "", folder = "", tags = [], options = {}) {
        const id = `note-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        // Auto-extract tags from body
        const extractedTags = this.extractTags(body);
        const normalizedTags = this.normalizeTags(tags);

        // Merge tags (preserve colors from manual tags)
        const mergedTags = [...normalizedTags];
        extractedTags.forEach(extracted => {
            if (!mergedTags.find(t => t.name === extracted.name)) {
                mergedTags.push(extracted);
            }
        });

        const note = {
            id,
            title: title || '',
            body: body || '',
            folder: folder || '',
            tags: mergedTags,
            trash: false,
            pinned: false,
            created: Date.now(),
            updated: Date.now(),
            isTemplate: options.isTemplate || false
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

        // Auto-extract tags from new body
        const extractedTags = this.extractTags(body || '');
        const normalizedTags = this.normalizeTags(tags);

        // Merge tags (preserve existing colors)
        const mergedTags = [...normalizedTags];
        extractedTags.forEach(extracted => {
            if (!mergedTags.find(t => t.name === extracted.name)) {
                // Use existing color if tag was previously used
                const existingColor = this.getTagColor(extracted.name, note.tags);
                mergedTags.push({ name: extracted.name, color: existingColor });
            }
        });

        // Versioning: Save OLD state before updating if it has content
        if ((note.body || note.title) && !this._isGeneratedPasswordNote(note)) {
            await this.saveVersion(note);
        }

        note.title = title || '';
        note.body = body || '';
        note.folder = folder;
        note.tags = mergedTags;
        note.updated = Date.now();

        await this.persistNote(note);
        this.sortNotes();
        bus.emit('notes:updated', this.notes);
    }

    async saveVersion(note) {
        const versionId = Utils.generateId();
        const version = {
            versionId,
            noteId: note.id,
            timestamp: Date.now(),
            title: note.title,
            body: note.body,
            folder: note.folder,
            tags: note.tags
        };
        try {
            await storageService.saveVersion(version);
        } catch (e) {
            console.warn('Failed to save version', e);
        }
    }

    async getHistory(noteId) {
        try {
            return await storageService.getNoteVersions(noteId);
        } catch (e) {
            console.warn('Failed to fetch history', e);
            return [];
        }
    }

    async restoreVersion(noteId, versionId) {
        const history = await this.getHistory(noteId);
        const version = history.find(v => v.versionId === versionId);
        if (!version) return;

        await this.updateNote(noteId, version.title, version.body, version.folder, version.tags);
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
     * Archive a note.
     */
    async archiveNote(id) {
        const note = this.notes.find(n => n.id === id);
        if (!note) return;

        note.archived = true;
        note.updated = Date.now();
        await this.persistNote(note);
        this.sortNotes();
        bus.emit('notes:updated', this.notes);
    }

    /**
     * Unarchive a note.
     */
    async unarchiveNote(id) {
        const note = this.notes.find(n => n.id === id);
        if (!note) return;

        note.archived = false;
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

    /**
     * Update the color of a specific tag across all notes
     */
    async updateTagColor(tagName, newColor) {
        let updated = false;

        this.notes.forEach(note => {
            if (note.tags && Array.isArray(note.tags)) {
                note.tags.forEach(tag => {
                    if ((typeof tag === 'string' ? tag : tag.name) === tagName) {
                        if (typeof tag === 'object') {
                            tag.color = newColor;
                            updated = true;
                        }
                    }
                });
            }
        });

        if (updated) {
            await vaultService.persistNotes(this.notes);
            bus.emit('notes:updated', this.notes);
        }
    }

    /**
     * Get all unique tags with their colors
     */
    getAllTags() {
        const tagMap = new Map();

        this.notes.forEach(note => {
            if (note.trash || note.isTemplate) return;
            if (note.tags && Array.isArray(note.tags)) {
                note.tags.forEach(tag => {
                    const tagName = typeof tag === 'string' ? tag : tag.name;
                    const tagColor = typeof tag === 'object' ? tag.color : 'blue';

                    if (!tagMap.has(tagName)) {
                        tagMap.set(tagName, { name: tagName, color: tagColor, count: 0 });
                    }
                    tagMap.get(tagName).count++;
                });
            }
        });

        return Array.from(tagMap.values()).sort((a, b) => b.count - a.count);
    }
}

export const notesService = new NotesService();
export { TAG_COLORS };
