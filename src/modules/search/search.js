/**
 * Search Module
 * Handles client-side full text search of *decrypted* notes.
 */

class SearchService {
    constructor() {
        this.index = [];
    }

    /**
     * Index notes for searching.
     * In a robust app, use a library like FlexSearch or Lunr.
     * For MVP/Minimal, simple string matching is sufficient for < 1000 notes.
     * @param {Array} notes - Array of decrypted note objects {id, title, body}
     */
    buildIndex(notes) {
        this.index = notes;
    }

    /**
     * Search notes
     * @param {string} query 
     * @returns {Array} List of matching note objects
     */
    search(query) {
        if (!query || query.length < 2) return this.index;

        const q = query.toLowerCase();

        return this.index.filter(note => {
            const titleMatch = (note.title || '').toLowerCase().includes(q);
            const bodyMatch = (note.body || '').toLowerCase().includes(q);
            return titleMatch || bodyMatch;
        });
    }
}

export const searchService = new SearchService();
