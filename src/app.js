/**
 * Main Application Entry Point
 */

import { ProductivityService } from './modules/productivity/productivity.js';
import { storageService } from './storage/db.js';
import { authService } from './modules/auth/auth.js';
import { vaultService } from './modules/vault/vault.js';
import { searchService } from './modules/search/search.js';
import { Utils } from './utils/helpers.js'; // Ensure Utils is imported if used directly or use via service
import { settingsService } from './modules/settings/settings.js';
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

// --- UI HELPERS ---
function getToastHost() {
    let host = document.getElementById('toast-container');
    if (!host) {
        host = document.createElement('div');
        host.id = 'toast-container';
        document.body.appendChild(host);
    }
    return host;
}

function showToast(message, type = 'info') {
    const host = getToastHost();
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerText = message;
    host.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('visible'));

    setTimeout(() => {
        toast.classList.remove('visible');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

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

    const params = new URLSearchParams(window.location.search);
    const vaultName = params.get('vault') || 'pinbridge_db';

    if (vaultName !== 'pinbridge_db') {
        document.title = `PINBRIDGE | ${vaultName}`;
        // Maybe change Logo text too?
        document.querySelector('.brand-title').innerText = `PINBRIDGE (${vaultName})`;
    }

    try {
        await storageService.init(vaultName);
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
        alert(`IMPORTANT: SAVE THIS KEY:\n\n${recoveryKey}`);
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
            if (success) logActivity("Vault Recovered");
        } else {
            success = await authService.login(pin);
            if (success) logActivity("Login Success");
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
    if (!notesOverride) {
        searchService.buildIndex(vaultService.notes);
    }
    const notes = notesOverride || vaultService.notes;
    let filtered = [];

    if (currentView === 'trash') {
        filtered = notes.filter(n => n.trash);
    } else if (currentView === 'all') {
        filtered = notes.filter(n => !n.trash);
    } else if (currentView.startsWith('folder:')) {
        const folderName = currentView.split(':')[1];
        filtered = notes.filter(n => !n.trash && n.folder === folderName);
    }

    // Always refresh folders list (to show counts or active state efficiently)
    renderFolders();

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

        const badges = [];
        if (note.pinned) badges.push('<span style="color:var(--brand-primary); font-size:0.8em">★</span>');
        if (note.trash) badges.push('<span style="color:#f85149; font-size:0.8em">&#128465;</span>');
        const badgeStr = badges.length ? ` ${badges.join(' ')}` : '';

        div.innerHTML = `
            <h4>${Utils.escapeHtml(note.title) || 'Untitled'}${badgeStr}</h4>
            <p>${Utils.escapeHtml(note.body) || 'No content'}</p>
        `;
        div.onclick = () => selectNote(note);
        listEl.appendChild(div);
    });
}

function selectNote(note) {
    activeNoteId = note.id;
    document.getElementById('note-title').value = note.title;
    document.getElementById('note-content').value = note.body;
    document.getElementById('note-folder').value = note.folder || "";
    document.getElementById('note-tags').value = note.tags ? note.tags.join(', ') : "";
    updatePinButtonState(note.pinned);

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

// 4. EDITOR ACTIONS

const btnNew = document.getElementById('btn-new-note');
const noteTitle = document.getElementById('note-title');
const noteBody = document.getElementById('note-content');
const btnDelete = document.getElementById('btn-delete');
const btnLock = document.getElementById('btn-lock');
const btnSaveNote = document.getElementById('btn-save-note');
const btnToggleAutoSave = document.getElementById('btn-toggle-autosave');
let autoSaveEnabled = localStorage.getItem('pinbridge.auto_save') !== 'false';

btnLock.onclick = () => {
    logActivity("Vault Locked");
    location.reload();
};

function updateAutoSaveUI() {
    if (!btnToggleAutoSave) return;
    btnToggleAutoSave.innerText = `Auto Save: ${autoSaveEnabled ? 'On' : 'Off'}`;
    btnToggleAutoSave.dataset.state = autoSaveEnabled ? 'on' : 'off';
}

btnToggleAutoSave.onclick = () => {
    autoSaveEnabled = !autoSaveEnabled;
    localStorage.setItem('pinbridge.auto_save', autoSaveEnabled ? 'true' : 'false');
    updateAutoSaveUI();
    document.getElementById('editor-status').innerText = autoSaveEnabled ? 'Auto-save enabled' : 'Manual save mode';
    if (autoSaveEnabled) scheduleAutoSave();
};

btnSaveNote.onclick = () => persistNote(true);

updateAutoSaveUI();

// NEW NOTE
btnNew.onclick = async () => {
    // If in trash, force switch to All
    if (currentView === 'trash') {
        currentView = 'all';
        document.querySelector('[data-view="all"]').click();
    }
    const id = await vaultService.createNote("", "");
    logActivity("Created Note", id);
    selectNote({ id, title: "", body: "", trash: false });
    document.getElementById('note-title').focus();
};

// AUTO SAVE
let saveTimeout;
function scheduleAutoSave() {
    if (!activeNoteId) return;
    if (!autoSaveEnabled) {
        document.getElementById('editor-status').innerText = "Manual save mode";
        return;
    }
    clearTimeout(saveTimeout);
    document.getElementById('editor-status').innerText = "Saving...";
    saveTimeout = setTimeout(() => persistNote(), 1000);
}

async function persistNote(force = false) {
    if (!activeNoteId) return;
    const note = vaultService.notes.find(n => n.id === activeNoteId);
    if (note && note.trash) return;
    clearTimeout(saveTimeout);

    const title = document.getElementById('note-title').value;
    const body = document.getElementById('note-content').value;
    const folder = document.getElementById('note-folder').value.trim();
    const tags = document.getElementById('note-tags').value.split(',').map(t => t.trim()).filter(t => t);
    const trimmedTitle = title.trim();
    const trimmedBody = body.trim();

    if (!force && !autoSaveEnabled) {
        document.getElementById('editor-status').innerText = "Manual save mode";
        return;
    }

    if (!trimmedTitle && !trimmedBody) {
        document.getElementById('editor-status').innerText = "No content to save";
        return;
    }

    document.getElementById('editor-status').innerText = "Saving...";
    await vaultService.updateNote(activeNoteId, title, body, folder, tags);
    document.getElementById('editor-status').innerText = "Saved";

    renderFolders();
    const isSearching = searchInput.value.trim().length > 0;
    if (isSearching) {
        const results = searchService.search(searchInput.value.trim());
        const viewResults = currentView === 'trash' ? results.filter(n => n.trash) : results.filter(n => !n.trash);
        renderNoteList(viewResults);
    } else {
        renderCurrentView();
    }
}

document.getElementById('note-title').addEventListener('input', scheduleAutoSave);
document.getElementById('note-content').addEventListener('input', scheduleAutoSave);
document.getElementById('note-folder').addEventListener('input', scheduleAutoSave);
document.getElementById('note-tags').addEventListener('input', scheduleAutoSave);

// DELETE / RESTORE
btnDelete.onclick = async () => {
    if (!activeNoteId) return;

    if (currentView === 'trash') {
        if (confirm("Permanently delete?")) {
            await vaultService.deleteNote(activeNoteId);
            logActivity("Deleted Note (Permanent)", activeNoteId);
            activeNoteId = null;
            clearEditor();
            renderCurrentView();
        }
    } else {
        await vaultService.moveToTrash(activeNoteId);
        logActivity("Moved to Trash", activeNoteId);
        activeNoteId = null;
        clearEditor();
        renderCurrentView();
    }
};

function clearEditor() {
    document.getElementById('note-title').value = "";
    document.getElementById('note-content').value = "";
    document.getElementById('note-folder').value = "";
    document.getElementById('note-tags').value = "";
}
// ...

function renderFolders() {
    const listEl = document.getElementById('folder-list');
    listEl.innerHTML = '';
    const suggestionEl = document.getElementById('folder-suggestions');
    suggestionEl.innerHTML = '';

    const folders = new Set();
    vaultService.notes.forEach(n => {
        if (n.folder && !n.trash) folders.add(n.folder);
    });

    folders.forEach(f => {
        // Sidebar Item
        const btn = document.createElement('div');
        btn.className = 'folder-item';
        btn.innerText = f.substring(0, 2); // Initials
        btn.title = f;
        if (currentView === `folder:${f}`) btn.classList.add('active');

        btn.onclick = () => {
            document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.folder-item').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentView = `folder:${f}`;
            renderCurrentView();
        };
        listEl.appendChild(btn);

        // Datalist
        const opt = document.createElement('option');
        opt.value = f;
        suggestionEl.appendChild(opt);
    });
}


// ... imports

// FEATURE: QUICK DROP
const quickDropInput = document.getElementById('quick-drop-input');
const quickDropZone = document.getElementById('quick-drop-zone');

quickDropInput.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
        const text = quickDropInput.value.trim();
        if (!text) return;

        // Create a new note automatically with a timestamp title or generic
        const title = `Quick Drop: ${new Date().toLocaleTimeString()}`;
        await vaultService.createNote(title, text);

        quickDropInput.value = '';
        showToast("Stashed to Inbox", "success");
        // Visual feedback
        quickDropInput.placeholder = "Stashed!";
        setTimeout(() => quickDropInput.placeholder = "Quick Drop... (Enter to stash)", 1500);

        // Refresh list if 'all' view
        if (currentView === 'all') renderCurrentView();
    }
});

quickDropInput.addEventListener('focus', () => quickDropZone.classList.remove('collapsed'));
quickDropInput.addEventListener('blur', () => {
    if (!quickDropInput.value) quickDropZone.classList.add('collapsed');
});


// FEATURE: EDITOR TOOLBAR ACTIONS (Copy, Pin)
const btnCopyTitle = document.getElementById('btn-copy-title');
const btnCopyBody = document.getElementById('btn-copy-body');
const btnPinNote = document.getElementById('btn-pin-note');

btnCopyTitle.onclick = () => {
    const text = document.getElementById('note-title').value;
    copyToClipboard(text, btnCopyTitle);
};

btnCopyBody.onclick = () => {
    const text = document.getElementById('note-content').value;
    copyToClipboard(text, btnCopyBody);
};

btnPinNote.onclick = async () => {
    if (!activeNoteId) return;
    const note = vaultService.notes.find(n => n.id === activeNoteId);
    if (!note) return;

    // Toggle Pin Logic
    // Needs support in VaultService or just use a hacky 'pinned' property on note object 
    // which needs to be persisted?
    // VaultService.updateNote doesn't expose metadata like 'pinned' yet.
    // We should add `togglePin(id)` to VaultService.

    // For now, let's assume we implement togglePin in VaultService or mock it.
    // Let's add the method to VaultService in next tool call.
    // For UI, we toggle class 'active' on button

    await vaultService.togglePin(activeNoteId);
    updatePinButtonState(note.pinned); // Optimistic or wait for event?
    renderCurrentView(); // Re-sort list
};

function copyToClipboard(text, btnElement) {
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
        const original = btnElement.innerText;
        btnElement.innerText = "Copied";
        btnElement.style.color = "var(--text-success)";
        showToast("Copied to clipboard", "success");
        setTimeout(() => {
            btnElement.innerText = original;
            btnElement.style.color = "";
        }, 1500);

        // FEATURE: CLIPBOARD CLEAN MODE (Phase 7)
        // Auto-clear after 45 seconds for security
        setTimeout(() => {
            navigator.clipboard.writeText("").then(() => {
                showToast("Clipboard cleared for security", "info");
            });
        }, 45000);

    }).catch(err => {
        console.error('Copy failed', err);
        showToast('Copy failed', 'error');
    });
}

// FEATURE: ACTIVITY TIMELINE (Phase 7)
// Simple in-memory log for session audit (could be persisted to DB/Meta)
let activityLog = [];

function logActivity(action, details = "") {
    const entry = {
        timestamp: new Date().toLocaleTimeString(),
        action,
        details
    };
    activityLog.unshift(entry);
    if (activityLog.length > 50) activityLog.pop(); // Keep last 50
    // Persist? storageService.saveMeta('activity_log', activityLog);
}

function showActivityTimeline() {
    // Render a simple modal or list via Alert for now, or Toast
    const logStr = activityLog.map(e => `[${e.timestamp}] ${e.action} ${e.details}`).join('\n');
    alert("Session Activity Log:\n\n" + (logStr || "No activity yet."));
}

// Add to Command Palette
// ... we need to push to 'commands' array in createCommandPalette logic ...
// Since we can't easily reach into that function scope, we rely on a separate button or 
// modify createCommandPalette in next tool call to include it.

function updatePinButtonState(isPinned) {
    if (isPinned) {
        btnPinNote.style.color = "var(--brand-primary)";
        btnPinNote.innerText = "★";
    } else {
        btnPinNote.style.color = "";
        btnPinNote.innerText = "☆";
    }
}


// ... existing init and other code ...



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

    // ... in createCommandPalette commands array ...
    const commands = [
        { id: 'settings', label: 'Open Settings (Export/Recovery)', action: () => settingsService.renderSettingsModal() },
        { id: 'new', label: 'Create New Note', action: () => btnNew.click() },
        { id: 'view_all', label: 'Go to All Notes', action: () => document.querySelector('[data-view="all"]').click() },
        { id: 'view_trash', label: 'Go to Trash', action: () => document.querySelector('[data-view="trash"]').click() },
        { id: 'template', label: 'Insert Template', action: () => showTemplates() },
        { id: 'timeline', label: 'View Activity Timeline', action: () => showActivityTimeline() },
        { id: 'health', label: 'Run Vault Health Check', action: () => runHealthCheck() },
        { id: 'switch_vault', label: 'Switch Vault / Profile', action: () => switchVault() },
        { id: 'toggle_safe', label: 'Toggle Safe View', action: () => document.body.classList.toggle('safe-view-mode') },
        { id: 'lock', label: 'Lock Vault', action: () => location.reload() }
    ];

    // ...

    // FEATURE: MULTI-VAULT
    async function switchVault() {
        const newName = prompt("Enter Vault Name (e.g. 'work', 'personal'):", "pinbridge_db");
        if (!newName) return;

        // Simple reload with query param? Or re-init?
        // Re-init is cleaner for SPA but requires clearing all state.
        // Easiest: Reload page with ?vault=name using URLParams

        const url = new URL(window.location);
        url.searchParams.set('vault', newName); // e.g. ?vault=work
        window.location.href = url.toString();
    }

    // FEATURE: TEMPLATES
    function showTemplates() {
        const templates = ProductivityService.getStandardTemplates();
        const list = templates.map((t, idx) => `${idx + 1}. ${t.title}`).join('\n');
        const choice = prompt(`Choose a template to insert:\n\n${list}\n\nType number or title:`);
        if (!choice) return;

        const template = templates.find(t => t.title.toLowerCase() === choice.toLowerCase()) ||
            templates[parseInt(choice, 10) - 1];

        if (!template) {
            showToast('Template not found', 'error');
            return;
        }

        (async () => {
            if (!activeNoteId) {
                const id = await vaultService.createNote(template.title, "");
                activeNoteId = id;
            }
            const processedBody = ProductivityService.processTemplate(template.body);
            const currentBody = document.getElementById('note-content').value;
            const newBody = currentBody ? `${currentBody}\n\n${processedBody}` : processedBody;

            document.getElementById('note-content').value = newBody;
            scheduleAutoSave();
            renderCurrentView();
        })();
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


// FEATURE: SHARE PREVIEW (Phase 4)
function openSharePreview() {
    if (!activeNoteId) return;
    const title = document.getElementById('note-title').value;
    const body = document.getElementById('note-content').value;

    const win = window.open('', '_blank');
    if (win) {
        win.document.write(`
            <html>
            <head>
                <title>${Utils.escapeHtml(title)} - Read Only</title>
                <style>
                    body { background: #18181b; color: #f4f4f5; font-family: system-ui, sans-serif; padding: 2rem; max-width: 800px; margin: 0 auto; }
                    h1 { border-bottom: 1px solid #3f3f46; padding-bottom: 1rem; }
                    pre { white-space: pre-wrap; font-family: 'Consolas', monospace; font-size: 1.1rem; line-height: 1.6; }
                    .meta { color: #52525b; font-size: 0.8rem; margin-top: 2rem; border-top: 1px solid #27272a; padding-top: 1rem; }
                </style>
            </head>
            <body>
                <h1>${Utils.escapeHtml(title)}</h1>
                <pre>${Utils.escapeHtml(body)}</pre>
                <div class="meta">Generated by PINBRIDGE - Local Secure View</div>
            </body>
            </html>
        `);
        win.document.close();
    }
}

// Add to Command Palette
// ... in createCommandPalette commands array ...
// We need to inject this into the existing commands list or push it.
// Since we can't easily edit the const array inside the function scope without re-writing the whole function,
// we will expose it globally or re-declare. 
// For now, let's simply append to the 'commands' array if we can reach it, 
// OR just rely on a new button in the UI if we add one.
// Let's add a button to the Editor Toolbar first.

// Add UI Button for Share
const btnShare = document.createElement('button');
btnShare.className = 'btn-tool';
btnShare.innerText = 'Preview';
btnShare.title = 'Read-Only Preview';
btnShare.onclick = openSharePreview;

// Insert before Delete button
const actionsDiv = document.querySelector('.editor-actions');
if (actionsDiv) {
    actionsDiv.insertBefore(btnShare, document.getElementById('btn-delete'));
}

// Start
init();
