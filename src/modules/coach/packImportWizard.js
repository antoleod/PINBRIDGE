/* src/modules/coach/packImportWizard.js */
import { packLoader } from './packLoader.js';
import { bus } from '../../core/bus.js';

export const packImportWizard = {

    async start() {
        try {
            // Legacy/dev entry point: reuse the bundled pack import flow.
            const bundled = packLoader.getBundledPacks()?.[0];
            if (!bundled) throw new Error('NO_BUNDLED_PACKS');

            const localData = await packLoader.loadBundledPack(bundled.id);
            const packId = localData.pack.pack_id;
            const version = localData.pack.version;
            const cardCount = localData.cards.length;
            const languages = localData.pack.languages?.join(', ') || 'N/A';
            const defaultName = localData.pack.title_i18n?.en || packId;

            this.showModal({
                packId,
                version,
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
        const existing = document.getElementById('pack-import-modal');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = 'pack-import-modal';
        overlay.className = 'modal-overlay';

        overlay.innerHTML = `
            <div class="modal-content glass-panel" style="max-width: 520px">
                <div class="modal-header">
                    <h2>Install bundled pack</h2>
                </div>
                <div class="modal-body" style="text-align: left; margin: 1rem 0;">
                    <div class="form-group">
                        <label>Pack name (editable)</label>
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
                        <div class="stat-box">
                            <label>Version</label>
                            <strong>v${data.version}</strong>
                        </div>
                        <div class="stat-box">
                            <label>Languages</label>
                            <strong>${data.languages}</strong>
                        </div>
                    </div>

                    <div class="import-actions" style="display: flex; flex-direction: column; gap: 0.5rem;">
                        <button class="btn btn-primary" id="btn-import-install">Install</button>
                        <button class="btn btn-secondary" id="btn-import-open-full">Open full import…</button>
                    </div>
                </div>
                <div class="modal-footer" style="display: flex; justify-content: flex-end; gap: 0.5rem; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 1rem;">
                    <button class="btn btn-ghost" id="btn-import-cancel">Cancel</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        document.getElementById('btn-import-cancel').onclick = () => overlay.remove();
        document.getElementById('btn-import-open-full').onclick = () => {
            overlay.remove();
            bus.emit('coach:navigate', 'import-pack');
        };

        document.getElementById('btn-import-install').onclick = () => {
            const packName = document.getElementById('import-pack-name')?.value?.trim() || data.defaultName;
            bus.emit('coach:import-pack', {
                packData: data.localData,
                packName,
                targetPackId: data.packId,
                importMode: 'new'
            });
            overlay.remove();
        };
    }
};

