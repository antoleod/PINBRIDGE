/**
 * PINBRIDGE Storage Service
 * Wrapper for IndexedDB.
 */

const DB_VERSION = 7; // Increment for attachments store
const STORE_META = 'meta';
const STORE_VAULT = 'vault';
const STORE_VERSIONS = 'versions';
const STORE_SYNC_QUEUE = 'syncQueue'; // Changed from 'sync_queue'
const STORE_RECOVERY = 'recovery'; // New store for recovery methods
const STORE_TAGS = 'tags'; // New store for tag metadata
const STORE_ATTACHMENTS = 'attachments'; // Encrypted attachment blobs keyed by hash
const STORES = [STORE_META, STORE_VAULT, STORE_VERSIONS, STORE_SYNC_QUEUE, STORE_RECOVERY, STORE_TAGS, STORE_ATTACHMENTS];

class StorageService {
    constructor() {
        this.db = null;
        this.currentDbName = null;
    }

    async init(dbName = 'pinbridge') {
        this.currentDbName = dbName;
        if (this.db) {
            this.db.close();
        }

        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.currentDbName, DB_VERSION);

            request.onerror = (event) => {
                console.error("IDB Error", event);
                reject("Could not open database");
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                // Meta store (key-value)
                if (!db.objectStoreNames.contains(STORE_META)) {
                    db.createObjectStore(STORE_META, { keyPath: 'key' });
                }
                // Vault store (notes)
                if (!db.objectStoreNames.contains(STORE_VAULT)) {
                    db.createObjectStore(STORE_VAULT, { keyPath: 'id' });
                }
                // Versions store
                if (!db.objectStoreNames.contains(STORE_VERSIONS)) {
                    const vStore = db.createObjectStore(STORE_VERSIONS, { keyPath: 'versionId' });
                    vStore.createIndex('noteId', 'noteId', { unique: false });
                }
                // Sync Queue
                if (!db.objectStoreNames.contains(STORE_SYNC_QUEUE)) {
                    const qStore = db.createObjectStore(STORE_SYNC_QUEUE, { keyPath: 'id', autoIncrement: true });
                    qStore.createIndex('timestamp', 'timestamp', { unique: false });
                }
                // Recovery store (backup codes, secret questions, etc.)
                if (!db.objectStoreNames.contains(STORE_RECOVERY)) {
                    db.createObjectStore(STORE_RECOVERY, { keyPath: 'type' });
                }
                // Tags store (for colors, sync settings, etc.)
                if (!db.objectStoreNames.contains(STORE_TAGS)) {
                    db.createObjectStore(STORE_TAGS, { keyPath: 'name' });
                }
                // Attachments store (encrypted blobs keyed by sha256 hash)
                if (!db.objectStoreNames.contains(STORE_ATTACHMENTS)) {
                    db.createObjectStore(STORE_ATTACHMENTS, { keyPath: 'hash' });
                }
            };

            request.onsuccess = (event) => {
                this.db = event.target.result;
                resolve(this.db);
            };
        });
    }

    // --- low level helpers ---

    async put(storeName, data) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction([storeName], 'readwrite');
            const store = tx.objectStore(storeName);
            const req = store.put(data);

            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    async get(storeName, key) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction([storeName], 'readonly');
            const store = tx.objectStore(storeName);
            const req = store.get(key);

            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    async getAll(storeName) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction([storeName], 'readonly');
            const store = tx.objectStore(storeName);
            const req = store.getAll();

            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    async getByIndex(storeName, indexName, value) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction([storeName], 'readonly');
            const store = tx.objectStore(storeName);
            const index = store.index(indexName);
            const req = index.getAll(value);

            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }


    async delete(storeName, key) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction([storeName], 'readwrite');
            const store = tx.objectStore(storeName);
            const req = store.delete(key);

            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    }

    // --- High Level API ---

    /**
     * Save Auth Data (Wrapped Key, Salt, Recovery Data)
     */
    async saveAuthData(authObject) {
        // We use a fixed key 'auth_data' to store the entire auth object.
        await this.put(STORE_META, { key: 'auth_data', value: authObject });
        await this.put(STORE_META, { key: 'app_initialized', value: true });
    }

    async getAuthData() {
        const result = await this.get(STORE_META, 'auth_data');
        return result ? result.value : null;
    }

    async isInitialized() {
        const rec = await this.get(STORE_META, 'app_initialized');
        return !!rec;
    }

    async setMeta(key, value) {
        await this.put(STORE_META, { key, value });
    }

    async getMeta(key) {
        const result = await this.get(STORE_META, key);
        return result ? result.value : null;
    }

    async getAllMeta() {
        return await this.getAll(STORE_META);
    }

    async saveCryptoMeta(meta) {
        await this.put(STORE_META, { key: 'crypto_meta', value: meta });
        await this.put(STORE_META, { key: 'app_initialized', value: true });
    }

    async getCryptoMeta() {
        const result = await this.get(STORE_META, 'crypto_meta');
        return result ? result.value : null;
    }

    /**
     * Vault Operations (Plain text notes)
     */
    async saveNote(noteObj) {
        // noteObj should have { id, iv, content, created, updated, trash, etc }
        // CONTENT IS ENCRYPTED HERE
        await this.put(STORE_VAULT, noteObj);
    }

    async saveEncryptedVault(record) {
        // We overwrite the single vault record. 
        // Previously we cleared the store, but that creates a risk of data loss 
        // if the write fails or app closes between clear and put.
        await this.put(STORE_VAULT, { id: 'vault', ...record });
    }

    async getEncryptedVault() {
        const result = await this.get(STORE_VAULT, 'vault');
        return result || null;
    }

    async getNotes() {
        return await this.getAll(STORE_VAULT);
    }

    async clearVault() {
        return this.clearStore(STORE_VAULT);
    }

    async deleteNote(id) {
        await this.delete(STORE_VAULT, id);
    }

    /**
     * Versioning
     */
    async saveVersion(versionObj) {
        await this.put(STORE_VERSIONS, versionObj);
    }

    async getNoteVersions(noteId) {
        return await this.getByIndex(STORE_VERSIONS, 'noteId', noteId);
    }

    /**
     * Clear a single object store.
     */
    async clearStore(storeName) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction([storeName], 'readwrite');
            const store = tx.objectStore(storeName);
            const req = store.clear();
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    }

    /**
     * Reset all persisted data (auth + vault + versions).
     * Used when the user explicitly wipes the vault.
     */
    async resetAll() {
        for (const storeName of STORES) {
            await this.clearStore(storeName);
        }
    }

    // --- Sync Queue API ---
    async getSyncQueue() {
        return await this.getAll(STORE_SYNC_QUEUE);
    }

    async addToSyncQueue(task) {
        return await this.put(STORE_SYNC_QUEUE, {
            created: Date.now(),
            ...task
        });
    }

    async removeFromSyncQueue(id) {
        return await this.delete(STORE_SYNC_QUEUE, id);
    }

    async clearSyncQueue() {
        return await this.clearStore(STORE_SYNC_QUEUE);
    }

    // --- Attachments API ---
    async saveAttachment(record) {
        // record = { hash, payloadBase64, meta, updatedAt, createdAt }
        return await this.put(STORE_ATTACHMENTS, record);
    }

    async getAttachment(hash) {
        return await this.get(STORE_ATTACHMENTS, hash);
    }

    async deleteAttachment(hash) {
        return await this.delete(STORE_ATTACHMENTS, hash);
    }

    async getAllAttachments() {
        return await this.getAll(STORE_ATTACHMENTS);
    }

    async clearAttachments() {
        return await this.clearStore(STORE_ATTACHMENTS);
    }

    // --- Recovery Methods API ---
    async saveRecoveryMethod(type, data) {
        return await this.put(STORE_RECOVERY, {
            type,
            ...data,
            updatedAt: Date.now()
        });
    }

    async getRecoveryMethod(type) {
        return await this.get(STORE_RECOVERY, type);
    }

    async getAllRecoveryMethods() {
        return await this.getAll(STORE_RECOVERY);
    }

    async deleteRecoveryMethod(type) {
        return await this.delete(STORE_RECOVERY, type);
    }

    // --- Tags API ---
    async saveTag(tagData) {
        // tagData = { name, color, isSynced, createdAt }
        return await this.put(STORE_TAGS, tagData);
    }

    async getTag(tagName) {
        return await this.get(STORE_TAGS, tagName);
    }

    async getAllTags() {
        return await this.getAll(STORE_TAGS);
    }

    async deleteTag(tagName) {
        return await this.delete(STORE_TAGS, tagName);
    }
}

export const storageService = new StorageService();
