/* src/modules/coach/packImportWizard.js */
import { packLoader } from './packLoader.js';
import { coachStore } from './coachStore.js';
import { bus } from '../../core/bus.js';

export const packImportWizard = {

    async start() {
        try {
            // 1. Load Local
            const localData = await packLoader.loadLocalPack();
            const packId = localData.pack.pack_id;
            const newVersion = localData.pack.version;

            // 2. Check Remote
            const globalPack = await coachStore.getGlobalPackHeader(packId);

            // 3. Prepare Preview Data
            const currentGlobalVersion = globalPack?.latest_version || 'None';
            const cardCount = localData.cards.length;
            const languages = localData.pack.languages?.join(', ') || 'N/A';
            const defaultName = localData.pack.title_i18n?.en || packId;

            // 4. Show Modal (Injecting HTML directly for specific Wizard UI)
            this.showModal({
                packId,
                newVersion,
                currentGlobalVersion,
                cardCount,
                languages,
                defaultName,
                localData
            });

        } catch (e) {
            console.error(e);
            bus.emit('ui:toast', { message: `Load Failed: ${e.message}`, type: 'error' });
        }
    },

    showModal(data) {
        // Remove existing if any
        const existing = document.getElementById('pack-import-modal');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = 'pack-import-modal';
        overlay.className = 'modal-overlay';

        const isUpdate = data.currentGlobalVersion !== 'None';
        const isSameVersion = data.currentGlobalVersion === data.newVersion;

        overlay.innerHTML = `
            <div class="modal-content glass-panel" style="max-width: 500px">
                <div class="modal-header">
                    <h2>📦 Import Pack Inspection</h2>
                </div>
                <div class="modal-body" style="text-align: left; margin: 1rem 0;">
                    
                    <div class="form-group">
                        <label>Pack Title (Editable)</label>
                        <input type="text" id="import-pack-name" class="input-field" value="${data.defaultName}">
                    </div>

                    <div class="stats-grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 1rem;">
                        <div class="stat-box">
                            <label>ID</label>
                            <code>${data.packId}</code>
                        </div>
                        <div class="stat-box">
                            <label>Cards</label>
                            <strong>${data.cardCount}</strong>
                        </div>
                        <div class="stat-box" style="${isSameVersion ? 'color: var(--warning);' : 'color: var(--success);'}">
                            <label>Local Version</label>
                            <strong>v${data.newVersion}</strong>
                        </div>
                        <div class="stat-box">
                            <label>Firestore Version</label>
                            <strong>v${data.currentGlobalVersion}</strong>
                        </div>
                    </div>

                    <p style="font-size: 0.9em; opacity: 0.8; margin-bottom: 1rem;">
                        ${isSameVersion
                ? "⚠️ Warning: This version already exists in Firestore. Overwriting might affect users if they are mid-sync."
                : "✅ Ready to likely create a new version."}
                    </p>

                    <div class="import-actions" style="display: flex; flex-direction: column; gap: 0.5rem;">
                        <button class="btn btn-primary" id="btn-import-new-version">
                            Create/Update Version v${data.newVersion}
                        </button>
                        ${isSameVersion ? `
                        <button class="btn btn-secondary" id="btn-import-overwrite" style="border: 1px solid var(--warning); color: var(--warning);">
                            Force Overwrite v${data.newVersion} (Merge)
                        </button>` : ''}
                    </div>
                </div>
                <div class="modal-footer" style="display: flex; justify-content: flex-end; gap: 0.5rem; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 1rem;">
                    <button class="btn btn-ghost" id="btn-import-cancel">Cancel</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        // Bindings
        document.getElementById('btn-import-cancel').onclick = () => overlay.remove();

        document.getElementById('btn-import-new-version').onclick = async () => {
            await this.executeImport(data.localData, 'version');
            overlay.remove();
        };

        const overwriteBtn = document.getElementById('btn-import-overwrite');
        if (overwriteBtn) {
            overwriteBtn.onclick = async () => {
                if (confirm("Confirm destructive overwrite?")) {
                    await this.executeImport(data.localData, 'overwrite');
                    overlay.remove();
                }
            };
        }
    },

    async executeImport(localData, mode) {
        bus.emit('ui:toast', { message: 'Syncing to Firestore...', type: 'info' });
        try {
            await coachStore.saveGlobalPack(
                localData.pack.pack_id,
                localData.pack.version,
                localData.pack,
                localData.cards
            );
            bus.emit('ui:toast', { message: 'Import Successful!', type: 'success' });
            bus.emit('coach:navigate', 'settings'); // Refresh settings view
        } catch (error) {
            console.error(error);
            bus.emit('ui:toast', { message: `Import Failed: ${error.message}`, type: 'error' });
        }
    }
};
