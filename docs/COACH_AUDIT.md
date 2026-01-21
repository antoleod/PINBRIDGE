# COACH_AUDIT.md

## What Works Well
- Modular architecture with clear separation (engine, store, UI renderer).
- I18n support for multi-language content.
- Firebase integration for user data and progress.
- PWA features (offline, service workers).
- TTS for accessibility.
- Pack import wizard for extensibility.

## What is Fragile
- Pack files duplicated: `fr_b1_mixed_premium_pack_100.json` in `src/modules/coach/`, `public/packs/`, and `tests/`. Risk of inconsistency.
- Test file `difficultyEngine.test.js` in runtime directory `src/modules/coach/` – should be in `tests/`.
- No centralized pack catalog; discovery via multiple loaders (packLoader.js, packRegistry.js) without clear single source.
- Documentation scattered: analysis files in root, READMEs in subdirs.

## What is Confusing
- Coach navigation: Multiple views (dashboard, packs, quiz) but landing page may not clearly guide users to packs or progress.
- Empty states: If no packs installed, unclear what to do next.
- Pack metadata: Inconsistent; some packs have i18n, others don't; no standard fields like difficulty or duration.
- Import flow: Preview and merge options exist but may not be intuitive.

## What is Missing
- Single source of truth for packs: No `public/packs/index.json` catalog.
- Learning hub UX: Current dashboard lacks clear sections for discovery, continuation, reviews.
- Pack card component: No reusable component for displaying packs with states (not started, in progress, completed).
- Difficulty integration: Engine exists but not fully hooked into UI or progression.
- Virtual coach: Provider exists but not integrated into UI feedback.
- Documentation: No UI spec, PR plan, or consolidated docs in `/docs`.

## Additional Concerns
- UX friction: Quiz view shows progress but no clear path to transfer tasks or reflections.
- Scalability: As packs grow, need better filtering/search in hub.
- Maintenance: Code has TODOs; need cleanup.</content>
<parameter name="filePath">c:\Users\X1\Documents\PINBRIDGE-1\docs\COACH_AUDIT.md