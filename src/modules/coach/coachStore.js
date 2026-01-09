/* src/modules/coach/coachStore.js */
import {
    doc,
    getDoc,
    setDoc,
    updateDoc,
    collection,
    getDocs,
    query,
    where,
    orderBy,
    limit,
    serverTimestamp,
    increment,
    writeBatch
} from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js';

import { db, auth } from '../../firebase.js';

function nowISODate() {
    return new Date().toISOString().slice(0, 10);
}

function safeJsonParse(text, fallback) {
    try {
        if (!text) return fallback;
        return JSON.parse(text);
    } catch {
        return fallback;
    }
}

function makeId(prefix = 'id') {
    try {
        const buf = new Uint8Array(8);
        crypto.getRandomValues(buf);
        const hex = [...buf].map(b => b.toString(16).padStart(2, '0')).join('');
        return `${prefix}_${Date.now()}_${hex}`;
    } catch {
        return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    }
}

class CoachStore {
    constructor() {
        this.cachePrefix = 'pinbridge.coach.v1.';
    }

    get uid() {
        return auth.currentUser?.uid;
    }

    getDefaultSettings() {
        return {
            ui_language: 'en',
            content_language: 'en',
            allow_multilang_toggle: true,
            spaced_repetition_intervals: [1, 3, 7],
            active_skill_id: null,
            content_version: 1
        };
    }

    _cacheKey(uid, key) {
        return `${this.cachePrefix}${uid}.${key}`;
    }

    _readCache(uid, key) {
        if (!uid) return null;
        return safeJsonParse(localStorage.getItem(this._cacheKey(uid, key)), null);
    }

    _writeCache(uid, key, value) {
        if (!uid) return;
        localStorage.setItem(this._cacheKey(uid, key), JSON.stringify(value));
    }

    async getSettings(uid) {
        const defaults = this.getDefaultSettings();
        if (!uid) return defaults;

        const cached = this._readCache(uid, 'settings');
        try {
            const settingsRef = doc(db, `users/${uid}/coach_settings/main`);
            const snap = await getDoc(settingsRef);
            const raw = snap.exists() ? snap.data() : {};

            const ui_language = raw.ui_language || defaults.ui_language;
            const allow_multilang_toggle = raw.allow_multilang_toggle ?? defaults.allow_multilang_toggle;
            const content_language = allow_multilang_toggle
                ? (raw.content_language || ui_language)
                : ui_language;

            const merged = {
                ...defaults,
                ...raw,
                ui_language,
                allow_multilang_toggle,
                content_language
            };

            if (!snap.exists()) {
                await setDoc(settingsRef, { ...merged, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true });
            } else if (raw.content_language !== merged.content_language || raw.ui_language !== merged.ui_language || raw.allow_multilang_toggle !== merged.allow_multilang_toggle) {
                await updateDoc(settingsRef, { ui_language, allow_multilang_toggle, content_language, updatedAt: serverTimestamp() });
            }

            this._writeCache(uid, 'settings', merged);
            return merged;
        } catch (error) {
            console.error('Error fetching coach settings:', error);
            return cached || defaults;
        }
    }

    async saveSettings(uid, settings) {
        if (!uid) return;
        try {
            const ref = doc(db, `users/${uid}/coach_settings/main`);
            await setDoc(ref, { ...settings, updatedAt: serverTimestamp() }, { merge: true });
            this._writeCache(uid, 'settings', settings);
        } catch (error) {
            console.error('Error saving coach settings:', error);
        }
    }

    async upsertSkill(uid, skill) {
        if (!uid || !skill?.id) return;
        const ref = doc(db, `users/${uid}/coach_skills/${skill.id}`);
        await setDoc(ref, { ...skill, updatedAt: serverTimestamp() }, { merge: true });
    }

    async listSkills(uid) {
        if (!uid) return [];
        const cacheKey = 'skills';
        const cached = this._readCache(uid, cacheKey) || [];
        try {
            const ref = collection(db, `users/${uid}/coach_skills`);
            const snap = await getDocs(ref);
            const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            this._writeCache(uid, cacheKey, items);
            return items;
        } catch (e) {
            console.warn('CoachStore.listSkills offline fallback', e);
            return cached;
        }
    }

    async getSkill(uid, skillId) {
        if (!uid || !skillId) return null;
        const cacheKey = `skill.${skillId}`;
        const cached = this._readCache(uid, cacheKey);
        try {
            const ref = doc(db, `users/${uid}/coach_skills/${skillId}`);
            const snap = await getDoc(ref);
            const item = snap.exists() ? { id: snap.id, ...snap.data() } : null;
            if (item) this._writeCache(uid, cacheKey, item);
            return item;
        } catch (e) {
            console.warn('CoachStore.getSkill offline fallback', e);
            return cached || null;
        }
    }

    async listModules(uid, skillId) {
        if (!uid) return [];
        const cacheKey = `modules.${skillId || 'all'}`;
        const cached = this._readCache(uid, cacheKey) || [];
        try {
            const ref = collection(db, `users/${uid}/coach_modules`);
            const q = skillId ? query(ref, where('skill_id', '==', skillId), orderBy('order', 'asc')) : query(ref, orderBy('order', 'asc'));
            const snap = await getDocs(q);
            const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            this._writeCache(uid, cacheKey, items);
            return items;
        } catch (e) {
            console.warn('CoachStore.listModules offline fallback', e);
            return cached;
        }
    }

    async listSessions(uid, skillId) {
        if (!uid) return [];
        const cacheKey = `sessions.${skillId || 'all'}`;
        const cached = this._readCache(uid, cacheKey) || [];
        try {
            const ref = collection(db, `users/${uid}/coach_sessions`);
            const q = skillId ? query(ref, where('skill_id', '==', skillId), orderBy('day', 'asc')) : query(ref, orderBy('day', 'asc'));
            const snap = await getDocs(q);
            const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            this._writeCache(uid, cacheKey, items);
            return items;
        } catch (e) {
            console.warn('CoachStore.listSessions offline fallback', e);
            return cached;
        }
    }

    async getSession(uid, sessionId) {
        if (!uid || !sessionId) return null;
        const ref = doc(db, `users/${uid}/coach_sessions/${sessionId}`);
        const snap = await getDoc(ref);
        return snap.exists() ? { id: snap.id, ...snap.data() } : null;
    }

    async upsertSession(uid, session) {
        if (!uid || !session?.id) return;
        const ref = doc(db, `users/${uid}/coach_sessions/${session.id}`);
        const isNew = !(await getDoc(ref)).exists();
        await setDoc(ref, {
            ...session,
            ...(isNew ? { createdAt: serverTimestamp() } : null),
            updatedAt: serverTimestamp()
        }, { merge: true });
    }

    async getQuizVariant(uid, quizId) {
        if (!uid || !quizId) return null;
        const cacheKey = `quiz.${quizId}`;
        const cached = this._readCache(uid, cacheKey);
        try {
            const ref = doc(db, `users/${uid}/coach_quizzes/${quizId}`);
            const snap = await getDoc(ref);
            const item = snap.exists() ? { id: snap.id, ...snap.data() } : null;
            if (item) this._writeCache(uid, cacheKey, item);
            return item;
        } catch (e) {
            console.warn('CoachStore.getQuizVariant offline fallback', e);
            return cached || null;
        }
    }

    async listQuizVariantsByConcept(uid, conceptId) {
        if (!uid || !conceptId) return [];
        const cacheKey = `conceptVariants.${conceptId}`;
        const cached = this._readCache(uid, cacheKey) || [];
        try {
            const ref = collection(db, `users/${uid}/coach_quizzes`);
            const q = query(ref, where('concept_id', '==', conceptId));
            const snap = await getDocs(q);
            const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            this._writeCache(uid, cacheKey, items);
            return items;
        } catch (e) {
            console.warn('CoachStore.listQuizVariantsByConcept offline fallback', e);
            return cached;
        }
    }

    async writeBlueprint(uid, blueprint, { setActive = true } = {}) {
        if (!uid || !blueprint?.skill?.id) return;

        const batch = writeBatch(db);
        const now = serverTimestamp();

        const skillRef = doc(db, `users/${uid}/coach_skills/${blueprint.skill.id}`);
        batch.set(skillRef, { ...blueprint.skill, createdAt: now, updatedAt: now }, { merge: true });

        for (const mod of blueprint.modules || []) {
            const modRef = doc(db, `users/${uid}/coach_modules/${mod.id}`);
            batch.set(modRef, { ...mod, createdAt: now, updatedAt: now }, { merge: true });
        }

        for (const sess of blueprint.sessions || []) {
            const sessRef = doc(db, `users/${uid}/coach_sessions/${sess.id}`);
            batch.set(sessRef, { ...sess, createdAt: now, updatedAt: now }, { merge: true });
        }

        for (const quiz of blueprint.quizzes || []) {
            const quizRef = doc(db, `users/${uid}/coach_quizzes/${quiz.id}`);
            batch.set(quizRef, { ...quiz, createdAt: now, updatedAt: now }, { merge: true });
        }

        const maintenanceRef = doc(db, `users/${uid}/coach_maintenance/main`);
        batch.set(maintenanceRef, {
            id: 'main',
            createdAt: now,
            updatedAt: now,
            streak_days: 0,
            last_completed_date: null,
            consecutive_wrong: 0,
            content_version: blueprint.skill.content_version || 1
        }, { merge: true });

        if (setActive) {
            const settingsRef = doc(db, `users/${uid}/coach_settings/main`);
            batch.set(settingsRef, { active_skill_id: blueprint.skill.id, updatedAt: now }, { merge: true });
        }

        await batch.commit();
    }

    async getMaintenance(uid) {
        if (!uid) return {
            streak_days: 0,
            last_completed_date: null,
            consecutive_wrong: 0,
            calibration_bias: 0
        };
        const ref = doc(db, `users/${uid}/coach_maintenance/main`);
        const cached = this._readCache(uid, 'maintenance');
        try {
            const snap = await getDoc(ref);
            const data = snap.exists() ? snap.data() : {};
            const merged = {
                streak_days: 0,
                last_completed_date: null,
                consecutive_wrong: 0,
                calibration_bias: 0,
                ...data
            };
            this._writeCache(uid, 'maintenance', merged);
            return merged;
        } catch (e) {
            console.error('Error fetching coach maintenance:', e);
            return cached || { streak_days: 0, last_completed_date: null, consecutive_wrong: 0, calibration_bias: 0 };
        }
    }

    async updateMaintenance(uid, patch) {
        if (!uid) return;
        const ref = doc(db, `users/${uid}/coach_maintenance/main`);
        await setDoc(ref, { ...patch, updatedAt: serverTimestamp() }, { merge: true });
    }

    async createAttempt(uid, attempt) {
        if (!uid) return null;
        const id = attempt?.id || makeId('attempt');
        const ref = doc(db, `users/${uid}/coach_attempts/${id}`);
        await setDoc(ref, { ...attempt, id, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true });
        return id;
    }

    async updateAttempt(uid, attemptId, patch) {
        if (!uid || !attemptId) return;
        const ref = doc(db, `users/${uid}/coach_attempts/${attemptId}`);
        await setDoc(ref, { ...patch, updatedAt: serverTimestamp() }, { merge: true });
    }

    async upsertExam(uid, examId, exam) {
        if (!uid || !examId) return;
        const ref = doc(db, `users/${uid}/coach_exams/${examId}`);
        const isNew = !(await getDoc(ref)).exists();
        await setDoc(ref, {
            id: examId,
            ...exam,
            ...(isNew ? { createdAt: serverTimestamp() } : null),
            updatedAt: serverTimestamp()
        }, { merge: true });
    }

    async createFeedbackReal(uid, feedback) {
        if (!uid) return null;
        const id = makeId('feedback');
        const ref = doc(db, `users/${uid}/coach_feedback_real/${id}`);
        await setDoc(ref, { ...feedback, id, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true });
        return id;
    }

    async getErrorMemory(uid, conceptId) {
        if (!uid || !conceptId) return null;
        const ref = doc(db, `users/${uid}/coach_error_memory/${conceptId}`);
        const snap = await getDoc(ref);
        return snap.exists() ? { id: snap.id, ...snap.data() } : null;
    }

    async listErrorMemory(uid, { limitCount = 50 } = {}) {
        if (!uid) return [];
        const ref = collection(db, `users/${uid}/coach_error_memory`);
        const q = query(ref, orderBy('lastFailureAt', 'desc'), limit(limitCount));
        const snap = await getDocs(q);
        return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    }

    async updateErrorMemory(uid, conceptId, { intervals = [1, 3, 7], variantId = null } = {}) {
        if (!uid || !conceptId) return;
        const errorRef = doc(db, `users/${uid}/coach_error_memory/${conceptId}`);

        try {
            const snap = await getDoc(errorRef);
            const data = snap.exists() ? snap.data() : {};
            const repetitionCount = Math.min(Number(data.repetitionCount || 0), intervals.length - 1);
            const intervalDays = intervals[repetitionCount] || 1;
            const next = new Date();
            next.setDate(next.getDate() + intervalDays);

            const patch = {
                concept_id: conceptId,
                count: increment(1),
                lastFailureAt: serverTimestamp(),
                repetitionCount: increment(1),
                nextRepetitionDate: next,
                ...(variantId ? { lastVariantId: variantId } : null)
            };

            await setDoc(errorRef, patch, { merge: true });
        } catch (e) {
            console.error('Failed to update error memory', e);
        }
    }

    computeNewStreak(lastCompletedDate, currentStreak, completedToday) {
        const today = nowISODate();
        if (!completedToday) return { streak: currentStreak, last: lastCompletedDate };
        if (lastCompletedDate === today) return { streak: currentStreak, last: lastCompletedDate };

        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const y = yesterday.toISOString().slice(0, 10);

        if (lastCompletedDate === y) return { streak: (currentStreak || 0) + 1, last: today };
        return { streak: 1, last: today };
    }
}

export const coachStore = new CoachStore();
