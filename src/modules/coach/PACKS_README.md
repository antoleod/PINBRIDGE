# Coach Cards Import - Quick Guide

## How to Import a Pack
1. Go to **COACH**. If you have no packs installed, you will be prompted to import one first.
2. You can import via:
   - **Bundled:** pick a bundled pack (English/French/Dutch B1 vocab, plus a legacy French mixed pack).
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
Bundled packs are served from `src/public/packs/*.json` (and some legacy fallbacks exist if `/tests` is not served by your hosting setup).
