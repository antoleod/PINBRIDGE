/**
 * PINBRIDGE Storage Service
 * Wrapper for IndexedDB.
 */

const DB_VERSION = 2; // Bump version for schema upgrade
const STORE_META = 'meta';
const STORE_VAULT = 'vault';
const STORE_VERSIONS = 'versions';

class StorageService {
    constructor() {
        this.db = null;
        this.currentDbName = 'pinbridge_db';
    }

    async init(dbName = 'pinbridge_db') {
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
    async saveAuthData(saltHex, wrappedKeyHex, recoveryWrappedKeyHex) {
        // We use a fixed key 'auth_blob' for the single user (Phase 1)
        await this.put(STORE_META, { key: 'auth_salt', value: saltHex });
        await this.put(STORE_META, { key: 'auth_wrapped_key', value: wrappedKeyHex });

        if (recoveryWrappedKeyHex) {
            await this.put(STORE_META, { key: 'auth_recovery_wrapped_key', value: recoveryWrappedKeyHex });
        }

        await this.put(STORE_META, { key: 'app_initialized', value: true });
    }

    async getAuthData() {
        const saltRec = await this.get(STORE_META, 'auth_salt');
        const keyRec = await this.get(STORE_META, 'auth_wrapped_key');
        const recoveryRec = await this.get(STORE_META, 'auth_recovery_wrapped_key');

        if (!saltRec || !keyRec) return null;

        return {
            salt: saltRec.value,
            wrappedKey: keyRec.value,
            recoveryWrappedKey: recoveryRec ? recoveryRec.value : null
        };
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

    /**
     * Vault Operations (Encrypted Notes)
     */
    async saveNote(noteObj) {
        // noteObj should have { id, iv, content, created, updated, trash, etc }
        // CONTENT IS ENCRYPTED HERE
        await this.put(STORE_VAULT, noteObj);
    }

    async getNotes() {
        return await this.getAll(STORE_VAULT);
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
}

export const storageService = new StorageService();
