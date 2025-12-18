import { storageService } from '../../storage/db.js';
import { syncService } from '../../sync.js';
import { bus } from '../../core/bus.js';

class SyncManager {
    constructor() {
        this.isProcessing = false;
        this.isOnline = navigator.onLine;

        window.addEventListener('online', () => {
            this.isOnline = true;
            bus.emit('sync:status', 'online');
            this.processQueue();
        });

        window.addEventListener('offline', () => {
            this.isOnline = false;
            bus.emit('sync:status', 'offline');
        });

        // Initial process check
        if (this.isOnline) {
            setTimeout(() => this.processQueue(), 1000);
        }
    }

    async enqueue(type, payload, uid) {
        if (!uid) {
            console.warn('SyncManager: Missing UID, cannot enqueue');
            return;
        }
        await storageService.addToSyncQueue({ type, payload, uid, retry: 0 });
        bus.emit('sync:status', 'local_saved'); // Immediate feedback
        this.processQueue();
    }

    /**
     * Optimized enqueue: If the last item in the queue matches the type/uid, 
     * update it instead of appending. Efficient for rapid PUSH_VAULT.
     */
    async enqueueOrUpdate(type, payload, uid) {
        if (!uid) return;

        // If processing, don't mess with the queue items as they might be in-flight.
        // Append a new one to ensure consistency.
        if (this.isProcessing) {
            return this.enqueue(type, payload, uid);
        }

        try {
            const queue = await storageService.getSyncQueue();
            if (queue && queue.length > 0) {
                const lastItem = queue[queue.length - 1];
                // If last item is same type, update it
                if (lastItem.type === type && lastItem.uid === uid) {
                    await storageService.addToSyncQueue({
                        id: lastItem.id,
                        type,
                        payload,
                        uid,
                        retry: 0,
                        created: Date.now()
                    });
                    bus.emit('sync:status', 'local_saved');
                    this.processQueue();
                    return;
                }
            }
        } catch (e) {
            console.warn('Queue optimization failed', e);
        }

        // Fallback
        await this.enqueue(type, payload, uid);
    }

    async processQueue() {
        if (this.isProcessing || !this.isOnline) return;
        this.isProcessing = true;

        try {
            const queue = await storageService.getSyncQueue();
            if (queue.length === 0) {
                bus.emit('sync:status', 'synced');
                this.isProcessing = false;
                return;
            }

            bus.emit('sync:status', 'syncing');

            // Sort by insertion order
            queue.sort((a, b) => a.created - b.created);

            for (const task of queue) {
                try {
                    if (task.type === 'PUSH_VAULT') {
                        await syncService.pushVault(task.uid, task.payload);
                    } else if (task.type === 'PUSH_META') {
                        await syncService.pushMeta(task.uid, task.payload);
                    } else if (task.type === 'RECOVERY_REQUEST') {
                        await syncService.createRecoveryRequest(task.uid);
                    }

                    await storageService.removeFromSyncQueue(task.id);
                } catch (e) {
                    console.error('Sync task failed', e);
                    // Leave in queue, stop processing this batch
                    // In a real robust system, we would handle backoff here
                    bus.emit('sync:status', 'error');
                    this.isProcessing = false;
                    return;
                }
            }

            bus.emit('sync:status', 'synced');

        } catch (err) {
            console.error('Queue processing error', err);
        } finally {
            this.isProcessing = false;
        }
    }

    getIsOnline() {
        return this.isOnline;
    }
}

export const syncManager = new SyncManager();
