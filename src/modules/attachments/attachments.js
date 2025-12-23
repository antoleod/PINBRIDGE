import { Utils } from '../../utils/helpers.js';
import { storageService } from '../../storage/db.js';
import { vaultService } from '../../vault.js';
import { syncService } from '../../sync.js';
import { cryptoService } from '../../crypto/crypto.js';

const DEFAULT_CHUNK_BYTES = 256 * 1024; // 256KiB raw before encryption/base64.

function stripDataUrlPrefix(dataUrl) {
  const idx = (dataUrl || '').indexOf(',');
  if (idx < 0) return null;
  return dataUrl.slice(idx + 1);
}

async function dataUrlToBytes(dataUrl) {
  const base64 = stripDataUrlPrefix(dataUrl);
  if (!base64) return new Uint8Array(0);
  return Utils.base64ToBuffer(base64);
}

async function fileToBytes(file) {
  const buf = await file.arrayBuffer();
  return new Uint8Array(buf);
}

function chunkBytes(bytes, chunkSize) {
  const out = [];
  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    out.push(bytes.slice(offset, Math.min(bytes.byteLength, offset + chunkSize)));
  }
  return out;
}

class AttachmentService {
  constructor() {
    this.chunkBytes = DEFAULT_CHUNK_BYTES;
  }

  /**
   * Converts legacy inline data URL attachments into hashed, synced attachments.
   * Mutates the note if migration happens and persists it.
   */
  async migrateLegacyInlineAttachments(note) {
    if (!note || !Array.isArray(note.attachments) || note.attachments.length === 0) return false;
    let changed = false;
    const hashesToUpload = [];

    const next = [];
    for (const att of note.attachments) {
      if (!att) continue;
      if (att.hash && !att.data) {
        next.push(att);
        continue;
      }
      if (!att.data) {
        next.push(att);
        continue;
      }

      const bytes = await dataUrlToBytes(att.data);
      const hash = await Utils.sha256Hex(bytes);
      const meta = {
        id: att.id || Utils.generateId(),
        noteId: note.id,
        name: att.name || 'file',
        type: att.type || 'application/octet-stream',
        size: typeof att.size === 'number' ? att.size : bytes.byteLength,
        hash,
        createdAt: att.createdAt || Date.now(),
        updatedAt: Date.now()
      };

      await this.saveLocalEncrypted(hash, bytes, meta);
      hashesToUpload.push(hash);
      next.push(meta);
      changed = true;
    }

    if (changed) {
      note.attachments = next;
    }
    return { changed, hashesToUpload };
  }

  async saveLocalEncrypted(hash, bytes, meta) {
    if (!vaultService?.dataKey) throw new Error('LOCKED');
    const payloadBase64 = await cryptoService.encryptBytes(bytes, vaultService.dataKey);
    const now = Date.now();
    await storageService.saveAttachment({
      hash,
      payloadBase64,
      meta: meta || null,
      createdAt: meta?.createdAt || now,
      updatedAt: meta?.updatedAt || now
    });
  }

  async getLocalBytes(hash) {
    if (!vaultService?.dataKey) throw new Error('LOCKED');
    const rec = await storageService.getAttachment(hash);
    if (!rec?.payloadBase64) return null;
    return cryptoService.decryptBytes(rec.payloadBase64, vaultService.dataKey);
  }

  async attachFileToNote(note, file) {
    if (!note?.id) throw new Error('NOTE_REQUIRED');
    if (!file) throw new Error('FILE_REQUIRED');
    if (!vaultService?.uid) throw new Error('VAULT_ID_REQUIRED');

    const bytes = await fileToBytes(file);
    const hash = await Utils.sha256Hex(bytes);
    const now = Date.now();
    const meta = {
      id: Utils.generateId(),
      noteId: note.id,
      name: file.name || 'file',
      type: file.type || 'application/octet-stream',
      size: file.size || bytes.byteLength,
      hash,
      createdAt: now,
      updatedAt: now
    };

    await this.saveLocalEncrypted(hash, bytes, meta);
    return { meta, hash };
  }

  async ensureRemoteAvailable(uid, hash, { force = false } = {}) {
    const remoteMeta = await syncService.fetchAttachmentMeta(uid, hash);
    if (remoteMeta && !force) return remoteMeta;
    const local = await storageService.getAttachment(hash);
    if (!local?.payloadBase64) throw new Error('ATTACHMENT_NOT_LOCAL');
    const bytes = await cryptoService.decryptBytes(local.payloadBase64, vaultService.dataKey);
    const meta = local.meta || remoteMeta || { hash, createdAt: Date.now(), updatedAt: Date.now() };
    await this._uploadToRemote(uid, meta, bytes);
    return meta;
  }

  async downloadToLocal(uid, hash) {
    const existing = await storageService.getAttachment(hash);
    if (existing?.payloadBase64) return true;

    const meta = await syncService.fetchAttachmentMeta(uid, hash);
    if (!meta) throw new Error('ATTACHMENT_NOT_FOUND');

    const rows = await syncService.fetchAttachmentChunksOrdered(uid, hash);
    if (!rows?.length) throw new Error('ATTACHMENT_EMPTY');

    const parts = [];
    for (const row of rows) {
      const decrypted = await cryptoService.decryptBytes(row.payloadBase64, vaultService.dataKey);
      parts.push(decrypted);
    }

    const total = parts.reduce((sum, p) => sum + p.byteLength, 0);
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
      merged.set(part, offset);
      offset += part.byteLength;
    }

    const computed = await Utils.sha256Hex(merged);
    if (computed !== hash) throw new Error('ATTACHMENT_HASH_MISMATCH');

    await this.saveLocalEncrypted(hash, merged, meta);
    return true;
  }

  async _uploadToRemote(uid, meta, bytes) {
    const chunks = chunkBytes(bytes, this.chunkBytes);
    const attachmentDoc = {
      hash: meta.hash,
      name: meta.name,
      type: meta.type,
      size: meta.size,
      chunks: chunks.length,
      createdAt: meta.createdAt || Date.now(),
      updatedAt: meta.updatedAt || Date.now(),
      cipher: 'AES-GCM',
      version: '1.0'
    };
    await syncService.pushAttachmentMeta(uid, attachmentDoc);

    for (let i = 0; i < chunks.length; i += 1) {
      const payloadBase64 = await cryptoService.encryptBytes(chunks[i], vaultService.dataKey);
      await syncService.pushAttachmentChunk(uid, meta.hash, i, payloadBase64);
    }
  }
}

export const attachmentService = new AttachmentService();
