/* src/modules/coach/packSync.js */
import { coachStore } from './coachStore.js';
import { packLoader } from './packLoader.js';

export const packSync = {

    /**
     * Legacy helper: keeps a copy of a bundled pack in the user's own Firestore tree.
     * (Global catalog writes are not enabled by default in rules.)
     */
    async syncLocalPackToFirestore() {
        const uid = coachStore.uid;
        if (!uid) throw new Error('NOT_AUTHENTICATED');

        const bundled = packLoader.getBundledPacks()?.[0];
        if (!bundled) throw new Error('NO_BUNDLED_PACKS');

        let localData;
        try {
            localData = await packLoader.loadBundledPack(bundled.id);
        } catch (e) {
            throw new Error(`Local Load Failed: ${e.message}`);
        }

        const packId = localData.pack.pack_id;
        const localVersion = localData.pack.version;

        const header = await coachStore.getUserPackHeader(uid, packId);
        if (header && header.latest_version === localVersion) {
            return { status: 'skipped', message: 'Already up to date', version: localVersion };
        }

        await coachStore.saveUserPack(uid, packId, localVersion, localData.pack, localData.cards);
        await coachStore.installUserPack(uid, packId, localVersion, localData.pack);

        return {
            status: 'updated',
            message: `Synced version ${localVersion} to Firestore`,
            oldVersion: header?.latest_version || 'none',
            newVersion: localVersion
        };
    }
};
