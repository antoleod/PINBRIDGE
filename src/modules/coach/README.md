# PINBRIDGE Coach Module (V2 Upgrade)

## Overview
The COACH module is a premium, rigorous learning engine designed to build technical skills through scenario-based 2-pass mastery.

**Version:** 2.0 (Premium Contract)
**Key Upgrade Features:**
- **I18n Native:** All content supports EN/ES/FR switching at runtime.
- **Variant Tracking:** Every session/question tracks `variant_id` to ensure unique repeated exposures.
- **Quality Metadata:** All AI-generated content includes confidence scores and source types.
- **Backward Compatibility:** Reads legacy V1 data and normalizes it on-the-fly without database migration.
- **Rules Engine:** Skills now include explicit rules for error memory, confidence calibration, and study strategies.

## V2 Schema Compatibility
The module now enforces `schema_version: 'v2'` on all new data writes.
Old data (V1) is automatically upgraded when read via `CoachEngine.normalizeSession()`.

## Architecture
- `coach.js`: Controller.
- `coachEngine.js`: Business Logic (Session Generation, Normalization, Decay).
- `coachStore.js`: Data Access (Firestore, Enforced Schema Versioning).
- `uiRenderer.js`: Zero-dependency template engine.

## Usage
Users access the module via the "Coach" navigation tab. No manual migration is needed for existing users.

## Adding New Skills
New skills generated via the wizard are automatically V2 compliant, including the new `rules` object for customized learning strategies.
