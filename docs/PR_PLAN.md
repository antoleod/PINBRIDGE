# PR_PLAN.md

## Phase 1: Core Infrastructure (Safe, High Impact)
**Goal:** Establish single source of truth for packs and basic hub UX.

**Files Touched:**
- `src/public/packs/index.json` (new)
- `src/modules/coach/views/dashboard.html`
- `src/modules/coach/coach.js` (add loadPacksIndex)
- `docs/COACH_AUDIT.md` (new)
- `docs/COACH_UI_SPEC.md` (new)

**Risk:** Low, UI changes are additive.
**Rollback:** Revert dashboard.html and coach.js changes.
**Test Checklist:**
- Dashboard loads without errors.
- Packs grid displays from index.json.
- Filters work (search, type, difficulty).
- CTA buttons trigger correct actions.

## Phase 2: Learning Depth Enhancements (Medium Risk)
**Goal:** Integrate difficulty engine and enhanced quiz flow.

**Files Touched:**
- `src/modules/coach/quizEngine.js` (already updated)
- `src/modules/coach/difficultyEngine.js` (already added)
- `src/modules/coach/views/quiz.html` (already updated)
- `src/modules/coach/virtualCoach.js` (already added)

**Risk:** Medium, affects quiz logic.
**Rollback:** Revert to previous quizEngine.js.
**Test Checklist:**
- Quiz sessions generate scenarios/explanations.
- Difficulty adapts based on performance.
- Transfer tasks and reflections appear.

## Phase 3: Import and Content Expansion (Low Risk)
**Goal:** Improve import flow and add cert packs.

**Files Touched:**
- `src/modules/coach/views/import-pack.html` (minor updates if needed)
- `src/public/packs/aws_saa_c03_core_50.json` (new)
- `src/public/packs/azure_az900_core_50.json` (new)
- `src/modules/coach/PACKS_README.md` (updated)

**Risk:** Low, additive content.
**Rollback:** Remove new pack files.
**Test Checklist:**
- Import preview shows correct metadata.
- Cert packs load and quiz correctly.

## Phase 4: Documentation and Cleanup (No Risk)
**Goal:** Organize docs and remove duplicates.

**Files Touched:**
- Move analysis/roadmap/model to `docs/`
- Remove duplicate pack files
- Move test file to `tests/`

**Risk:** None.
**Rollback:** Restore files if needed.
**Test Checklist:**
- Docs accessible in `docs/`
- No broken links.</content>
<parameter name="filePath">c:\Users\X1\Documents\PINBRIDGE-1\docs\PR_PLAN.md