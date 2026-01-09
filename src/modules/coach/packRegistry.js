/* src/modules/coach/packRegistry.js */
import { coachStore } from './coachStore.js';
import { packLoader } from './packLoader.js';

class PackRegistry {
    
    async getInstalledPacks(uid) {
        if (!uid) return [];
        return await coachStore.getUserPacks(uid);
    }

    async installPack(uid, packData, cards, options = {}) {
        if (!uid || !packData || !cards) throw new Error('Invalid arguments');
        const { pack_id, version } = packData;
        const { deprecateMissing, pack_name } = options;
        
        // Save content
        await coachStore.saveUserPack(uid, pack_id, version, packData, cards, { deprecateMissing });
        // Register installation
        await coachStore.installUserPack(uid, pack_id, version, packData, { pack_name });
        
        return { pack_id, version };
    }

    async checkUpdates(uid) {
        if (!uid) return [];
        const installed = await this.getInstalledPacks(uid);
        const bundled = packLoader.getBundledPacks();
        const updates = [];

        for (const b of bundled) {
            const existing = installed.find(p => p.pack_id === b.id);
            if (existing) {
                try {
                    // Load bundled to check version
                    const data = await packLoader.loadBundledPack(b.id);
                    if (data.pack.version !== existing.installed_version) {
                        updates.push({
                            pack_id: b.id,
                            current: existing.installed_version,
                            latest: data.pack.version,
                            title: b.title
                        });
                    }
                } catch (e) {
                    console.warn(`Update check failed for ${b.id}`, e);
                }
            }
        }
        return updates;
    }
}

export const packRegistry = new PackRegistry();