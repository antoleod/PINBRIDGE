/**
 * Productivity Module: Snippets & Templates
 */

import { Utils } from '../../utils/helpers.js';
import { storageService } from '../../storage/db.js';

// We'll store snippets in the same vault but with a special type or just local storage for MVP?
// Requirements: "Snippets reutilizables", "Plantillas con variables dinámicas"
// Let's use a simple in-memory structure persisted to LocalStorage for Phase 2 MVP.
// Phase 3 can move them to Encrypted Vault if sensitive.
// "Privacidad primero" -> Should be encrypted.
// Lets stick to them being NOTES with a tag #snippet or #template?
// For dedicated UX, let's use a separate local store for now (LocalStorage is NOT secure).
// OK, we must use the Vault.

// Implementation Strategy:
// Store snippets as Notes with metadata: { type: 'snippet' }
// Store templates as Notes with metadata: { type: 'template' }

// Since our current Vault implementation is simple { id, data }, we need to expand it or just use a specific title convention?
// Better: We'll add a 'type' field to the encrypted content.

export const ProductivityService = {

    // TEMPLATES
    processTemplate(templateBody, variables = {}) {
        // Simple variable replacement {{variable}}
        // Date support: {{date}}
        let content = templateBody;

        const now = new Date();
        content = content.replace(/{{date}}/g, now.toISOString().split('T')[0]);
        content = content.replace(/{{time}}/g, now.toLocaleTimeString());

        // Custom vars
        for (const [key, val] of Object.entries(variables)) {
            const regex = new RegExp(`{{${key}}}`, 'g');
            content = content.replace(regex, val);
        }

        return content;
    },

    getStandardTemplates() {
        return [
            { id: 't1', title: 'Daily Standup', body: '### Yesterday\n\n### Today\n\n### Blockers\n' },
            { id: 't2', title: 'Bug Report', body: '**Repro Steps**\n1. \n\n**Expected**\n\n**Actual**\n' },
            { id: 't3', title: 'Meeting Notes', body: '# Meeting: {{date}}\n\n## Attendees\n\n## Action Items\n- [ ] ' }
        ];
    }
};
