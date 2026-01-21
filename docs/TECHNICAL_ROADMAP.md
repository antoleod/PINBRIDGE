# TECHNICAL ROADMAP.md

## Phased Upgrades

### Phase 1: Core Extensions (Week 1-2)
- **Difficulty Engine:** New module `difficultyEngine.js` to detect performance and adapt ambiguity.
- **Scenario Questions:** Extend quizEngine to generate ambiguous MCQs with real-life contexts.
- **Transfer Tasks:** Add transfer task generation in sessions.
- **Micro-Reflections:** Add 1-3 line reflection prompts post-session.

### Phase 2: Content Expansion (Week 3-4)
- **Cert Packs:** Create AWS SAA and Azure fundamentals packs with exam-aligned content.
- **Route Extension:** Upgrade existing language packs to 30+ days, adding weekly difficulty ramps.
- **Judgment Level:** Introduce questions requiring best choice among bad options.

### Phase 3: Virtual Coach (Week 5-6)
- **Coach Provider Interface:** `virtualCoach.js` as provider, not dependency.
- **Integration:** Hook into sessions for deeper explanations, variants, challenges.
- **Personalization:** Track mistakes, push difficulty.

### Phase 4: Unified Engine (Week 7-8)
- **Global Learning Model:** Refactor to support Levels 1-5 across all routes.
- **Import Upgrades:** Enhance packImportWizard for merge, version overwrite, extension.
- **Testing:** Validate with AWS/Azure routes.

## Difficulty Escalation Plan
- **Detection:** Track hesitation (time), repeated success/failure.
- **Adaptation:** Increase ambiguity, change representations (diagrams, analogies).
- **Weekly Ramp:** Days 1-7: Basic; 8-14: Ambiguous; 15-21: Transfer; 22-30: Judgment.

## Key Modules to Add/Modify
- `src/modules/coach/difficultyEngine.js`
- `src/modules/coach/virtualCoach.js`
- Extend `quizEngine.js` for scenarios/transfers.
- New cert packs in `public/packs/` or `src/modules/coach/`.</content>
<parameter name="filePath">c:\Users\X1\Documents\PINBRIDGE-1\TECHNICAL_ROADMAP.md