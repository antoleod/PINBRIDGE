# GLOBAL ANALYSIS.md

## Vision Alignment
PINBRIDGE is currently a quiz-based learning app with Firebase backend, focusing on language packs (French B1, etc.) and basic vocab/mixed cards. It has SRS for spaced repetition, but lacks the depth for certifications, decision-making, and mastery as per the vision.

**Strengths:**
- Modular architecture with coach module, quiz engine, store.
- I18n support, PWA, offline capabilities.
- Pack import/export, user progress tracking.

**Gaps:**
- Content limited to languages; no cert routes (AWS, Azure).
- Learning model is Level 1-2 (recognition, understanding); missing application, transfer, judgment.
- Difficulty static: distractors from same category, no adaptation.
- No ambiguity, real-life scenarios, transfer tasks, or reflections.
- No virtual coach for deeper explanations or challenges.
- Routes short (100 cards); need 30+ days with escalation.
- UX matches Quizlet/Memrise but cognitively shallow.

**Risks:**
- Over-reliance on quizzes; users may not achieve mastery.
- No unified engine for certs + languages.
- Difficulty not escalating; retention low.
- Virtual coach absent; no personalized pushing.

## Repository Structure Audit
- **Entry Points:** index.html (PWA), app.js (main logic).
- **Routing:** Bus-based event system for views.
- **State Management:** CoachStore for user data, progress.
- **Firebase Usage:** Auth, Firestore for packs/progress.
- **Coach Module Status:** Active, with quizEngine, packImportWizard, TTS, etc. Supports V2 schema.

## Limitations Summary
1. **Cognitive Depth:** Pure memorization; no scenarios forcing decisions.
2. **Difficulty:** Fixed; no detection of success/hesitation to adapt.
3. **Content Scope:** Language-focused; need certs with exam alignment.
4. **Daily Structure:** Missing concept, scenario, decision, explanation, transfer, reflection.
5. **Coach:** No virtual AI coach for variants or challenges.
6. **Routes:** Short; need extension to 30+ days with weekly escalation.

## Upgrade Opportunities
- Extend quizEngine to support scenario-based questions.
- Add difficulty engine module.
- Integrate virtual coach provider.
- Create cert packs with ambiguous MCQs.
- Upgrade existing packs with transfer tasks.</content>
<parameter name="filePath">c:\Users\X1\Documents\PINBRIDGE-1\GLOBAL_ANALYSIS.md