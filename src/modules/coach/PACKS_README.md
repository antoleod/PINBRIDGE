# Coach Packs - Guide

## Pack Discovery
Packs are discovered from `src/public/packs/index.json`, which catalogs all available packs with metadata (title, type, difficulty, etc.).

## How to Import a Pack
1. Go to **COACH > Create / Import / Generate**.
2. Import via:
   - **Upload:** Select the `.json` file.
   - **Paste:** Copy the entire JSON content.
3. Review the preview (name, size, language, duration).
4. Choose import mode:
   - **Create new:** Install as new pack.
   - **Merge:** Upsert into existing pack, deprecate missing cards.
   - **Upgrade:** Overwrite by version if newer.
5. Click **Import Pack**.

## File Format
Use V2 Pack JSON format. See `tests/fr_b1_mixed_premium_pack_100.json` for example.

## Bundled Packs
Available in `src/public/packs/`. Includes language and certification packs.
