# Coach Cards Import - Quick Guide

## How to Import a Pack
1. Go to **COACH**. If you have no packs installed, you will be prompted to import one first.
2. You can import via:
   - **Bundled:** pick the bundled pack (includes `tests/fr_b1_mixed_premium_pack_100.json`).
   - **Upload:** Select the `.json` file.
   - **Paste:** Copy the entire JSON content into the text area.
3. Review the preview (pack id/version/title/cards) and click **Import Pack**.

## Testing Logic
1. After import, go to **Coach > Packs**.
2. You should see your new pack (e.g., "French B1").
3. Click **"Practice"** to start a session.
4. **Auto-read (TTS):** Ensure your volume is up. The French word should be spoken automatically.
5. **Progress:** Answer correctly/incorrectly. The system will schedule next review.

## File Format
Use the standard V2 Pack JSON format found in `tests/fr_b1_mixed_premium_pack_100.json`.

## Bundled pack serving
For robust static serving, a copy is also kept at `src/public/packs/fr_b1_mixed_premium_pack_100.json` and the loader will fall back to it if `/tests` is not served by your hosting setup.
