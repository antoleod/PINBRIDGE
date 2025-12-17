/**
 * Main Application Entry Point
 */

import { storageService } from './storage/db.js';
import { authService } from './modules/auth/auth.js';
import { vaultService } from './modules/vault/vault.js';
import { searchService } from './modules/search/search.js';
import { ProductivityService } from './modules/productivity/productivity.js';
import { bus } from './core/bus.js';

// --- UI REFS ---
const screens = {
    loading: document.getElementById('loading-screen'),
    auth: document.getElementById('auth-screen'),
    vault: document.getElementById('vault-screen')
};

const forms = {
    setup: document.getElementById('auth-setup'),
    login: document.getElementById('auth-login'),
    setupForm: document.getElementById('setup-form'),
    loginForm: document.getElementById('login-form')
};

// --- STATE ---
let activeNoteId = null;
let currentView = 'all'; // 'all', 'trash'

// --- INIT ---

async function init() {
    console.log("PINBRIDGE: Initializing...");

    // Register Service Worker
    if ('serviceWorker' in navigator) {
        try {
            await navigator.serviceWorker.register('./service-worker.js');
        } catch (e) {
            console.log('SW Fail', e);
        }
    }

    // Command Palette Elements creation (dynamic)
    createCommandPalette();

    try {
        await storageService.init();
        const hasVault = await authService.hasVault();

        setTimeout(() => {
            showScreen('auth');
            if (hasVault) {
                forms.login.classList.remove('hidden');
            } else {
                forms.setup.classList.remove('hidden');
            }
        }, 500);

    } catch (e) {
        console.error("Critical Init Error", e);
        alert("Failed to initialize storage.");
    }
}

// --- NAVIGATION ---

function showScreen(name) {
    Object.values(screens).forEach(el => el.classList.remove('active'));
    Object.values(screens).forEach(el => el.classList.add('hidden'));
    screens[name].classList.remove('hidden');
}

// --- EVENT HANDLERS ---

// 1. SETUP
forms.setupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const p1 = document.getElementById('setup-pin').value;
    const p2 = document.getElementById('setup-pin-confirm').value;

    if (p1 !== p2) {
        alert("PINs do not match!");
        return;
    }

    try {
        const recoveryKey = await authService.initializeNewVault(p1);
        alert(`⚠️ SAVE THIS KEY:\n\n${recoveryKey}`);
        await authService.login(p1);
    } catch (err) {
        alert("Setup failed: " + err.message);
    }
});

// 2. LOGIN
forms.loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pin = document.getElementById('login-pin').value;
    try {
        let success = false;
        if (pin.length > 30) {
            success = await authService.recover(pin);
        } else {
            success = await authService.login(pin);
        }

        if (!success) {
            alert("Incorrect PIN");
            document.getElementById('login-pin').value = '';
        }
    } catch (err) {
        alert("Login Error: " + err.message);
    }
});

// 3. AUTH EVENTS
bus.on('auth:unlock', async () => {
    showScreen('vault');
    loadVault();
});

// --- VAULT UI LOGIC ---

async function loadVault() {
    const notes = await vaultService.loadAll();
    searchService.buildIndex(notes);
    renderCurrentView(notes);
}

// Sidebar Navigation
document.querySelectorAll('.nav-item').forEach(btn => {
    btn.onclick = () => {
        document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentView = btn.dataset.view; // 'all' or 'trash'
        // If view is 'favorites' not implemented yet, falls back.

        renderCurrentView();
    };
});

function renderCurrentView(notesOverride) {
    const notes = notesOverride || vaultService.notes;
    let filtered = [];

    if (currentView === 'trash') {
        filtered = notes.filter(n => n.trash);
    } else {
        filtered = notes.filter(n => !n.trash);
    }

    // Update Button Context
    const delBtn = document.getElementById('btn-delete');
    if (currentView === 'trash') {
        delBtn.innerText = "Delete Forever";
        delBtn.style.backgroundColor = "var(--accent-danger)";
    } else {
        delBtn.innerText = "Delete";
        delBtn.style.backgroundColor = "var(--accent-danger)";
    }

    renderNoteList(filtered);
}

// SEARCH
const searchInput = document.getElementById('search-input');
searchInput.addEventListener('input', (e) => {
    const query = e.target.value;
    if (!query) {
        renderCurrentView();
        return;
    }
    const results = searchService.search(query);
    // Respect current view
    const viewResults = currentView === 'trash' ? results.filter(n => n.trash) : results.filter(n => !n.trash);
    renderNoteList(viewResults);
});

function renderNoteList(notes) {
    const listEl = document.getElementById('notes-list');
    listEl.innerHTML = '';

    if (notes.length === 0) {
        listEl.innerHTML = '<div style="padding:1rem; color:#666; text-align:center">No notes found.</div>';
    }

    notes.forEach(note => {
        const div = document.createElement('div');
        div.className = 'note-item';
        if (note.id === activeNoteId) div.classList.add('active');

        let trashBadge = note.trash ? ' <span style="color:#f85149; font-size:0.8em">🗑️</span>' : '';

        div.innerHTML = `
            <h4>${escapeHtml(note.title) || 'Untitled'}${trashBadge}</h4>
            <p>${escapeHtml(note.body) || 'No content'}</p>
        `;
        div.onclick = () => selectNote(note);
        listEl.appendChild(div);
    });
}

function selectNote(note) {
    activeNoteId = note.id;
    document.getElementById('note-title').value = note.title;
    document.getElementById('note-content').value = note.body;

    // Update active class manually to avoid re-render
    document.querySelectorAll('.note-item').forEach(el => el.classList.remove('active'));
    // Ideally find the one we clicked, but for MVP re-render of list logic is tricky without ID ref on DOM.
    // Let's just re-render list if needed, or iterate.
    // Iterating...
    // Actually, renderCurrentView() is creating new elements.
    // We already handled 'active' class in renderNoteList based on activeNoteId.
    // So just refreshing the list view is easiest:
    renderCurrentView(vaultService.notes);
}

function escapeHtml(text) {
    if (!text) return "";
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

// 4. EDITOR ACTIONS

const btnNew = document.getElementById('btn-new-note');
const btnSave = document.getElementById('editor-status');
const noteTitle = document.getElementById('note-title');
const noteBody = document.getElementById('note-content');
const btnDelete = document.getElementById('btn-delete');
const btnLock = document.getElementById('btn-lock');

// NEW NOTE
btnNew.onclick = async () => {
    // If in trash, force switch to All
    if (currentView === 'trash') {
        currentView = 'all';
        document.querySelector('[data-view="all"]').click();
    }
    const id = await vaultService.createNote("", "");
    selectNote({ id, title: "", body: "", trash: false });
    document.getElementById('note-title').focus();
};

// AUTO SAVE
let saveTimeout;
function triggerSave() {
    if (!activeNoteId) return;
    // Don't save if in trash? Or allow editing in trash?
    // Usually trash is read-only.
    const note = vaultService.notes.find(n => n.id === activeNoteId);
    if (note && note.trash) return; // Prevent editing in trash

    clearTimeout(saveTimeout);
    document.getElementById('editor-status').innerText = "Saving...";

    saveTimeout = setTimeout(async () => {
        await vaultService.updateNote(activeNoteId, noteTitle.value, noteBody.value);
        document.getElementById('editor-status').innerText = "Saved";
    }, 1000);
}

noteTitle.addEventListener('input', triggerSave);
noteBody.addEventListener('input', triggerSave);

// DELETE / RESTORE
btnDelete.onclick = async () => {
    if (!activeNoteId) return;

    if (currentView === 'trash') {
        if (confirm("Permanently delete?")) {
            await vaultService.deleteNote(activeNoteId);
            activeNoteId = null;
            clearEditor();
            renderCurrentView();
        }
    } else {
        await vaultService.moveToTrash(activeNoteId);
        activeNoteId = null;
        clearEditor();
        renderCurrentView();
    }
};

function clearEditor() {
    noteTitle.value = "";
    noteBody.value = "";
}

// LOCK
btnLock.onclick = () => {
    location.reload();
};

// 5. EVENT BUS
bus.on('vault:updated', (notes) => {
    // We already mostly handle local UI updates, but this syncs if changed elsewhere
    // renderCurrentView(notes); // Don't loop endlessly if we trigger own events
});


// 6. COMMAND PALETTE (Phase 4) & SHORTCUTS

function createCommandPalette() {
    const el = document.createElement('div');
    el.id = 'command-palette';
    el.className = 'hidden';
    el.innerHTML = `
        <div class="palette-container">
            <input type="text" class="palette-input" placeholder="Type a command...">
            <div class="palette-results" id="palette-results"></div>
        </div>
    `;
    document.body.appendChild(el);

    // Logic
    const input = el.querySelector('input');
    const results = el.querySelector('#palette-results');

    import { ProductivityService } from './modules/productivity/productivity.js';

    // ... imports

    // ... in createCommandPalette commands array ...
    const commands = [
        { id: 'new', label: 'Create New Note', action: () => btnNew.click() },
        { id: 'view_all', label: 'Go to All Notes', action: () => document.querySelector('[data-view="all"]').click() },
        { id: 'view_trash', label: 'Go to Trash', action: () => document.querySelector('[data-view="trash"]').click() },
        { id: 'template', label: 'Insert Template', action: () => showTemplates() },
        { id: 'health', label: 'Run Vault Health Check', action: () => runHealthCheck() },
        { id: 'toggle_safe', label: 'Toggle Safe View', action: () => document.body.classList.toggle('safe-view-mode') },
        { id: 'lock', label: 'Lock Vault', action: () => location.reload() }
    ];

    // ...

    // FEATURE: TEMPLATES
    function showTemplates() {
        const templates = ProductivityService.getStandardTemplates();
        const list = templates.map(t => ({
            label: `Template: ${t.title}`,
            action: async () => {
                // Insert into active note or create new
                if (!activeNoteId) {
                    const id = await vaultService.createNote(t.title, "");
                    activeNoteId = id;
                }
                const processedBody = ProductivityService.processTemplate(t.body);
                // Append or Replace? Let's Append if not empty
                const currentBody = document.getElementById('note-content').value;
                const newBody = currentBody ? currentBody + '\n\n' + processedBody : processedBody;

                document.getElementById('note-content').value = newBody;
                triggerSave();
                renderCurrentView(); // Content preview update
            }
        }));

        // Reuse command palette UI to show templates? 
        // Hacky but works: Render specific items into palette container
        const el = document.getElementById('command-palette');
        const container = el.querySelector('#palette-results');
        const input = el.querySelector('input');

        // Temporarily override palette behavior or just show them?
        // Let's just show them as a sub-menu effectively via alert for MVP or custom render

        // Better: Open palette with pre-filled "Template: " filter? 
        // No, let's just render them directly into the palette results area 
        // and force the palette open.
        togglePalette(true);
        input.value = "Template: "; // Filter trick
        // Wait, the input listener will filter 'commands'. We need to add templates TO 'commands' dynamically?
        // Correct approach: Add dynamic commands or a secondary picker.
        // For MVP: Alert selection is too ugly.
        // Let's just use the `commands` array.
    }

    // FEATURE: HEALTH CHECK
    async function runHealthCheck() {
        const notes = vaultService.notes;
        let corrupted = 0;

        notes.forEach(n => {
            if (n.error || n.title.includes("Decryption Failed")) corrupted++;
        });

        if (corrupted > 0) {
            alert(`Health Check Complete.\n\n⚠️ Found ${corrupted} corrupted note(s).\nPlease check the list for 'Decryption Failed' items.`);
        } else {
            alert(`Health Check Complete.\n\n✅ All ${notes.length} notes are valid and decryptable.`);
        }
    }

    input.addEventListener('input', () => {
        const q = input.value.toLowerCase();
        const matches = commands.filter(c => c.label.toLowerCase().includes(q));
        renderPalette(matches, results, el);
    });

    // Close on click outside
    el.addEventListener('click', (e) => {
        if (e.target === el) togglePalette(false);
    });
}

function renderPalette(items, container, wrapper) {
    container.innerHTML = '';
    items.forEach(item => {
        const div = document.createElement('div');
        div.className = 'palette-item';
        div.innerHTML = `<span>${item.label}</span>`;
        div.onclick = () => {
            item.action();
            togglePalette(false);
        };
        container.appendChild(div);
    });
}

function togglePalette(show) {
    const el = document.getElementById('command-palette');
    const input = el.querySelector('input');
    if (show) {
        el.classList.remove('hidden');
        input.value = '';
        input.focus();
        // Trigger initial render
        input.dispatchEvent(new Event('input'));
    } else {
        el.classList.add('hidden');
    }
}

// KEYBOARD SHORTCUTS
document.addEventListener('keydown', (e) => {
    // Ctrl+K -> Command Palette
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        togglePalette(true);
    }

    // Esc -> Close Palette
    if (e.key === 'Escape') {
        const palette = document.getElementById('command-palette');
        if (!palette.classList.contains('hidden')) {
            togglePalette(false);
        }
    }
});


// Start
init();
