import { storageService } from '../../storage/db.js';
import { vaultService } from '../vault/vault.js';
import { cryptoService } from '../../crypto/crypto.js';
import { Utils } from '../../utils/helpers.js';
import { PeerSession } from './webrtc.js';
import { createSyncOverlay } from './ui.js';
import { encryptMessage, decryptMessage, CHUNK_SIZE } from './protocol.js';

const syncService = {
    openOfferFlow,
    openAnswerFlow,
    exportOfflinePackage,
    importOfflinePackage,
    createVaultPackage,
    applyVaultPackage
};

let activeSession = null;
let ackResolvers = new Map();

async function createVaultPackage() {
    const notes = await storageService.getNotes();
    const meta = await storageService.getAllMeta();
    const auth = await storageService.getAuthData();
    const vault = {
        version: 1,
        createdAt: Date.now(),
        notes,
        meta,
        auth
    };
    const serialized = JSON.stringify(vault);
    const buffer = Utils.strToBuffer(serialized);
    const sha256 = await Utils.sha256Hex(buffer);
    return {
        vault,
        buffer,
        sha256
    };
}

function downloadFile(content, filename, mime = 'application/json') {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
}

async function exportOfflinePackage() {
    const payload = await createVaultPackage();
    const packageObj = {
        vault: payload.vault,
        digest: {
            sha256: payload.sha256,
            bytes: payload.buffer.byteLength
        },
        exportedAt: new Date().toISOString()
    };
    const filename = `pinbridge_vault_${new Date().toISOString().replace(/[:.]/g, '-')}.pbak`;
    downloadFile(JSON.stringify(packageObj, null, 2), filename);
}

async function importOfflinePackage() {
    const overlay = document.createElement('div');
    overlay.className = 'import-overlay';
    overlay.innerHTML = `
        <div class="import-card glass-panel">
            <h3>Import encrypted package (.pbak)</h3>
            <textarea placeholder="Paste JSON here"></textarea>
            <div class="import-actions">
                <button class="btn btn-secondary" data-action="cancel">Cancel</button>
                <button class="btn btn-primary" data-action="import">Import</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
    const textarea = overlay.querySelector('textarea');

    const cleanup = () => overlay.remove();

    overlay.addEventListener('click', async (event) => {
        const action = event.target.closest('button')?.dataset.action;
        if (!action) return;
        if (action === 'cancel') {
            cleanup();
            return;
        }
        if (action === 'import') {
            try {
                const payload = JSON.parse(textarea.value);
                if (!payload?.vault || !payload?.digest) {
                    throw new Error('Package missing required fields');
                }
                const vaultString = JSON.stringify(payload.vault);
                const computed = await Utils.sha256Hex(Utils.strToBuffer(vaultString));
                if (computed !== payload.digest.sha256) {
                    throw new Error('Payload hash mismatch');
                }
                await applyVaultPackage(payload.vault);
                alert('Vault imported successfully. Reload to ensure the new data is live.');
                cleanup();
            } catch (err) {
                alert('Import failed: ' + err.message);
            }
        }
    });

    textarea.focus();
}

async function applyVaultPackage(vault, pin) {
    if (!vault?.auth) {
        throw new Error('Auth information missing');
    }
    const saltBuf = Utils.hexToBuffer(vault.auth.salt);
    const wrappedBuf = Utils.hexToBuffer(vault.auth.wrappedKey);
    if (!pin) {
        pin = prompt('Enter PIN that unlocks the source vault');
        if (!pin) {
            throw new Error('PIN required to import vault');
        }
    }
    await cryptoService.importMasterKey(pin, saltBuf, wrappedBuf);
    await storageService.saveAuthData(vault.auth.salt, vault.auth.wrappedKey, vault.auth.recoveryWrappedKey || '');
    await storageService.clearVault();
    for (const note of vault.notes || []) {
        await storageService.saveNote(note);
    }
    if (Array.isArray(vault.meta)) {
        for (const entry of vault.meta) {
            if (entry?.key) {
                await storageService.setMeta(entry.key, entry.value);
            }
        }
    }
    await vaultService.loadAll();
}

function cleanupSession() {
    if (activeSession) {
        activeSession.session?.close();
        activeSession.overlay?.close();
        activeSession = null;
        ackResolvers.clear();
    }
}

function waitForAck(seq) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            ackResolvers.delete(seq);
            reject(new Error('ACK timeout'));
        }, 4000);
        ackResolvers.set(seq, { resolve, timer });
    });
}

function createAckResolver(seq) {
    const entry = ackResolvers.get(seq);
    if (entry) {
        clearTimeout(entry.timer);
        entry.resolve();
        ackResolvers.delete(seq);
    }
}

async function sendChunks(session, buffer, overlay, sha256) {
    const totalChunks = Math.ceil(buffer.byteLength / CHUNK_SIZE);
    await session.sendEncrypted({
        type: 'meta',
        totalChunks,
        totalBytes: buffer.byteLength,
        sha256: sha256
    });

    overlay?.setProgress(0);

    for (let seq = 0; seq < totalChunks; seq += 1) {
        const chunk = buffer.slice(seq * CHUNK_SIZE, Math.min((seq + 1) * CHUNK_SIZE, buffer.byteLength));
        const payload = {
            type: 'chunk',
            seq,
            data: Utils.bufferToBase64(chunk)
        };

        let attempts = 0;
        while (attempts < 3) {
            attempts += 1;
            const ackPromise = waitForAck(seq);
            await session.sendEncrypted(payload);
            try {
                await ackPromise;
                break;
            } catch (err) {
                if (attempts >= 3) {
                    throw new Error('Failed to transfer chunk ' + seq);
                }
            }
        }
        overlay?.setProgress((seq / totalChunks) * 100);
    }

    await session.sendEncrypted({ type: 'done' });
    overlay?.setProgress(100);
}

async function openOfferFlow() {
    cleanupSession();
    const vaultPackage = await createVaultPackage();
    const overlay = createSyncOverlay({
        mode: 'offer',
        title: 'Pair with QR (Send vault)',
        subtitle: 'Device A: show QR to another device',
        onCopy: (value) => {
            if (!value) return;
            navigator.clipboard.writeText(value).catch(() => alert('Copy failed'));
        },
        onManualApply: async (value) => {
            if (!value) return;
            await handleAnswer(value);
        },
        onScanAnswer: async (value) => {
            if (!value) return;
            await handleAnswer(value);
        },
        onCancel: cleanupSession,
        onStarted: (msg) => overlay.setStatus(msg)
    });

    const handleIncoming = async (payload) => {
        if (payload.type === 'ack') {
            createAckResolver(payload.seq);
        }
    };

    const session = new PeerSession('offer', {
        encrypt: encryptMessage,
        decrypt: decryptMessage,
        onMessage: handleIncoming,
        onStateChange: (state) => overlay.setStatus(state),
        onError: (err) => overlay.setStatus(err.message),
        onTimeout: () => overlay.setStatus('Session expired'),
        onClose: cleanupSession
    });

    activeSession = { session, overlay, role: 'offer' };

    const offerPayload = await session.createOffer();
    const payloadText = JSON.stringify(offerPayload);
    overlay.setCode(payloadText);
    overlay.showQRCode(payloadText);
    overlay.setExpiry(offerPayload.t);
    overlay.setStatus('Waiting for answer...');

    async function handleAnswer(text) {
        try {
            const answer = JSON.parse(text);
            await session.applyAnswer(answer);
            await session.waitForChannelOpen();
            overlay.setStatus('Connected - transferring vault');
            await sendChunks(session, vaultPackage.buffer, overlay, vaultPackage.sha256);
            overlay.setStatus('Transfer complete');
        } catch (err) {
            overlay.setStatus('Error: ' + err.message);
        }
    }
}

async function openAnswerFlow() {
    cleanupSession();
    const overlay = createSyncOverlay({
        mode: 'answer',
        title: 'Scan QR (Receive vault)',
        subtitle: 'Device B: scan offer QR then share answer',
        onManualApply: async (value) => {
            if (!value) return;
            await handleOffer(value);
        },
        onScanOffer: async (value) => {
            if (!value) return;
            await handleOffer(value);
        },
        onCancel: cleanupSession,
        onStarted: (msg) => overlay.setStatus(msg)
    });

    const incomingState = {
        meta: null,
        chunks: [],
        received: 0
    };

    const handleIncoming = async (payload) => {
        if (payload.type === 'meta') {
            incomingState.meta = payload;
            incomingState.total = payload.totalChunks;
            overlay.setStatus('Receiving encrypted vault...');
            return;
        }
        if (payload.type === 'chunk') {
            const chunkBuffer = Utils.base64ToBuffer(payload.data);
            incomingState.chunks[payload.seq] = chunkBuffer;
            incomingState.received += 1;
            overlay.setProgress((incomingState.received / incomingState.total) * 100);
            await session.sendEncrypted({ type: 'ack', seq: payload.seq });
            return;
        }
        if (payload.type === 'done') {
            const assembled = new Uint8Array(incomingState.meta.totalBytes);
            let offset = 0;
            for (let i = 0; i < incomingState.meta.totalChunks; i += 1) {
                const chunk = incomingState.chunks[i];
                if (!chunk) {
                    throw new Error(`Missing chunk ${i}`);
                }
                assembled.set(chunk, offset);
                offset += chunk.byteLength;
            }
            const computed = await Utils.sha256Hex(assembled);
            if (computed !== incomingState.meta.sha256) {
                throw new Error('Payload hash mismatch');
            }
            const vaultString = Utils.bufferToStr(assembled);
            const vault = JSON.parse(vaultString);
            overlay.setStatus('Importing vault...');
            await applyVaultPackage(vault);
            overlay.setStatus('Vault synced successfully');
        }
    };

    const session = new PeerSession('answer', {
        encrypt: encryptMessage,
        decrypt: decryptMessage,
        onMessage: handleIncoming,
        onStateChange: (state) => overlay.setStatus(state),
        onError: (err) => overlay.setStatus(err.message),
        onTimeout: () => overlay.setStatus('Session expired'),
        onClose: cleanupSession
    });

    activeSession = { session, overlay, role: 'answer' };

    async function handleOffer(text) {
        try {
            const offer = JSON.parse(text);
            const answer = await session.acceptOffer(offer);
            const answerText = JSON.stringify(answer);
            overlay.setCode(answerText);
            overlay.showQRCode(answerText);
            overlay.setStatus('Answer generated — ready to transfer');
        } catch (err) {
            overlay.setStatus('Error: ' + err.message);
        }
    }
}

export { syncService };
