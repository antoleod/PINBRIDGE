/* src/modules/coach/packSync.js */
import { coachStore } from './coachStore.js';
import { packLoader } from './packLoader.js';

export const packSync = {

    /**
     * Seeds or Updates the Firestore Global Catalog from the Local JSON
     */
    async syncLocalPackToFirestore() {
        // 1. Load Local
        let localData;
        try {
            localData = await packLoader.loadLocalPack();
        } catch (e) {
            throw new Error(`Local Load Failed: ${e.message}`);
        }

        const packId = localData.pack.pack_id;
        const localVersion = localData.pack.version;

        // 2. Check Remote
        const globalPack = await coachStore.getGlobalPackHeader(packId); // Need to add this method or use existing

        if (globalPack && globalPack.latest_version === localVersion) {
            return { status: 'skipped', message: 'Already up to date', version: localVersion };
        }

        // 3. Upload (Seed/Update)
        await coachStore.saveGlobalPack(packId, localVersion, localData.pack, localData.cards);

        return {
            status: 'updated',
            message: `Synced version ${localVersion} to Firestore`,
            oldVersion: globalPack?.latest_version || 'none',
            newVersion: localVersion
        };
    }
};
