/* src/modules/coach/coachStore.js */
import { getFirestore, doc, getDoc, setDoc, collection, getDocs, serverTimestamp, increment, query, where, orderBy, limit, addDoc } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";
import { db, auth } from '../../firebase.js';

class CoachStore {

    get uid() {
        return auth.currentUser?.uid;
    }

    // --- Settings ---
    async getSettings(uid) {
        const defaultSettings = this.getDefaultSettings();
        if (!uid) return defaultSettings;

        try {
            const settingsRef = doc(db, `users/${uid}/coach_settings/main`);
            const docSnap = await getDoc(settingsRef);

            if (docSnap.exists()) {
                return { ...defaultSettings, ...docSnap.data() };
            } else {
                await this.saveSettings(uid, defaultSettings);
                return defaultSettings;
            }
        } catch (error) {
            console.error("Error fetching coach settings:", error);
            return defaultSettings;
        }
    }

    async saveSettings(uid, settings) {
        if (!uid) return;
        try {
            const settingsRef = doc(db, `users/${uid}/coach_settings/main`);
            await setDoc(settingsRef, settings, { merge: true });
        } catch (error) {
            console.error("Error saving coach settings:", error);
        }
    }

    getDefaultSettings() {
        return {
            ui_language: 'en',
            content_language: 'en',
            allow_multilang_toggle: true,
            time_per_day_min: 15,
            intensity: 'normal',
            no_resources_mode: false,
            spaced_repetition_enabled: true,
            interleaving_enabled: true,
            teach_back_enabled: true,
            exam_pressure_enabled: true,
            active_skill_id: null
        };
    }

    // --- Skills ---
    async getSkills(uid) {
        if (!uid) return [];
        const skillsCol = collection(db, `users/${uid}/coach_skills`);
        const q = query(skillsCol, orderBy('updatedAt', 'desc'));
        const snapshot = await getDocs(q);
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    }

    async getSkill(uid, skillId) {
        if (!uid || !skillId) return null;
        const ref = doc(db, `users/${uid}/coach_skills/${skillId}`);
        const snap = await getDoc(ref);
        return snap.exists() ? { id: snap.id, ...snap.data() } : null;
    }

    async getGlobalPackHeader(packId) {
        if (!packId) return null;
        const ref = doc(db, `coach_packs/${packId}`);
        const snap = await getDoc(ref);
        return snap.exists() ? snap.data() : null;
    }

    async createSkill(uid, skillData) {
        if (!uid) return;
        const skillsCol = collection(db, `users/${uid}/coach_skills`);
        const docRef = await addDoc(skillsCol, {
            ...skillData,
            schema_version: 'v2', // V2 Enforced
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            status: 'active'
        });
        return docRef.id;
    }

    async updateSkill(uid, skillId, data) {
        if (!uid || !skillId) return;
        const ref = doc(db, `users/${uid}/coach_skills/${skillId}`);
        await setDoc(ref, { ...data, updatedAt: serverTimestamp() }, { merge: true });
    }

    // --- Modules ---
    async getModulesForSkill(uid, skillId) {
        if (!uid || !skillId) return [];
        const col = collection(db, `users/${uid}/coach_modules`);
        const q = query(col, where('skill_id', '==', skillId)); // Removed order for now as field might be missing in old data
        const snapshot = await getDocs(q);
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    }

    async createModule(uid, moduleData) {
        if (!uid) return;
        const col = collection(db, `users/${uid}/coach_modules`);
        return await addDoc(col, {
            ...moduleData,
            schema_version: 'v2',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        });
    }

    // --- Error Memory & Spaced Repetition ---
    async getErrorMemory(uid) {
        if (!uid) return [];
        const errorCol = collection(db, `users/${uid}/coach_error_memory`);
        const snapshot = await getDocs(errorCol);
        // Note: Firestore doesn't automatically convert timestamps in queries unless configured, 
        // passing doc data to date object might be needed in UI or Helper.
        return snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                ...data,
                // Helper format for UI
                nextRepetitionDate: data.nextRepetitionDate?.toDate().toLocaleDateString() || 'N/A'
            };
        });
    }

    async getDueReviews(uid) {
        if (!uid) return [];
        const errorCol = collection(db, `users/${uid}/coach_error_memory`);
        const now = new Date();
        const q = query(errorCol, where('nextRepetitionDate', '<=', now));
        const snapshot = await getDocs(q);
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    }

    async updateErrorMemory(uid, conceptId, isCorrect) {
        if (!uid || !conceptId) return;
        const errorRef = doc(db, `users/${uid}/coach_error_memory`, conceptId);

        try {
            const docSnap = await getDoc(errorRef);

            if (isCorrect) {
                if (docSnap.exists()) {
                    const data = docSnap.data();
                    const newRepetitionCount = (data.repetitionCount || 0) + 1;
                    const intervals = [1, 3, 7, 14, 30];
                    const days = intervals[Math.min(newRepetitionCount, intervals.length - 1)] || 30;

                    const nextDate = new Date();
                    nextDate.setDate(nextDate.getDate() + days);

                    await setDoc(errorRef, {
                        repetitionCount: newRepetitionCount,
                        nextRepetitionDate: nextDate,
                        lastReviewedAt: serverTimestamp()
                    }, { merge: true });
                }
            } else {
                let newCount = 1;
                if (docSnap.exists()) {
                    newCount = (docSnap.data().wrong_count || 0) + 1;
                }

                const nextDate = new Date();
                nextDate.setDate(nextDate.getDate() + 1);

                await setDoc(errorRef, {
                    wrong_count: newCount,
                    repetitionCount: 0,
                    lastFailureAt: serverTimestamp(),
                    nextRepetitionDate: nextDate,
                    concept_id: conceptId,
                    schema_version: 'v2'
                }, { merge: true });
            }

        } catch (e) {
            console.error("Failed to update error memory", e);
        }
    }

    // --- Attempts ---
    async saveAttempt(uid, attemptData) {
        if (!uid) return;
        const col = collection(db, `users/${uid}/coach_attempts`);
        await addDoc(col, {
            ...attemptData,
            schema_version: 'v2',
            createdAt: serverTimestamp()
        });
    }

    // --- Maintenance ---
    async getMaintenanceStatus(uid) {
        if (!uid) return null;
        const ref = doc(db, `users/${uid}/coach_maintenance/main`);
        const snap = await getDoc(ref);
        return snap.exists() ? snap.data() : { streak_days: 0, last_completed_date: null };
    }

    async updateMaintenance(uid, data) {
        if (!uid) return;
        const ref = doc(db, `users/${uid}/coach_maintenance/main`);
        await setDoc(ref, data, { merge: true });
    }

    // --- Packs & Content Management ---

    async getGlobalPackVersion(packId, version) {
        if (!packId || !version) return null;
        // Try to get the version document which should contain valid Cards as a subcollection or array.
        // For MVP/Small packs, we might store 'cards' in the version doc itself if under 1MB.
        // But prompt suggested /cards/{card_id}.
        // Let's Read the Version Doc first.
        const ref = doc(db, `coach_packs/${packId}/versions/${version}`);
        const snap = await getDoc(ref);
        if (!snap.exists()) return null;

        const data = snap.data();

        // Fetch cards from subcollection
        const cardsCol = collection(db, `coach_packs/${packId}/versions/${version}/cards`);
        const cardsSnap = await getDocs(cardsCol);
        const cards = cardsSnap.docs.map(d => d.data());

        return { ...data, cards };
    }

    async saveGlobalPack(packId, version, packData, cards) {
        if (!packId || !version) return;

        // 1. Update Global Header
        const headerRef = doc(db, `coach_packs/${packId}`);
        await setDoc(headerRef, {
            latest_version: version,
            updatedAt: serverTimestamp(),
            ...packData // basic meta like title
        }, { merge: true });

        // 2. Create Version Doc
        const versionRef = doc(db, `coach_packs/${packId}/versions/${version}`);
        await setDoc(versionRef, {
            ...packData,
            createdAt: serverTimestamp(),
            card_count: cards.length
        });

        // 3. Upload Cards (Batching 500 max)
        const batchSize = 400;
        for (let i = 0; i < cards.length; i += batchSize) {
            const chunk = cards.slice(i, i + batchSize);
            // We need a specific batch object here, but import might be tricky if not top-level.
            // We'll do parallel setDocs for simplicity if batch import missing, 
            // but standard firestore approach is writeBatch.
            // Assuming we change import to include writeBatch or use runTransaction.
            // Let's use parallel promises for now as it's cleaner without changing imports heavily.
            await Promise.all(chunk.map(c => {
                const cardRef = doc(db, `coach_packs/${packId}/versions/${version}/cards/${c.card_id}`);
                return setDoc(cardRef, c);
            }));
        }
    }

    async getUserPacks(uid) {
        if (!uid) return [];
        const col = collection(db, `users/${uid}/coach_user_packs`);
        const snap = await getDocs(col);
        return snap.docs.map(d => d.data());
    }

    async installUserPack(uid, packId, version, packData) {
        if (!uid) return;
        const ref = doc(db, `users/${uid}/coach_user_packs/${packId}`);
        await setDoc(ref, {
            pack_id: packId,
            installed_version: version,
            title_i18n: packData.title_i18n,
            description_i18n: packData.description_i18n,
            installedAt: serverTimestamp()
        });
    }

    async getCardProgress(uid, cardIds) {
        if (!uid || !cardIds || cardIds.length === 0) return {};
        // Firestore 'in' query limited to 10.
        // We will fetch ALL progress for the user and filter in memory for MVP 
        // to avoid complexity of 10-chunking for hundreds of cards.
        // Alternatively, since we usually ask for progress *of a specific pack*, 
        // maybe we should query by packId if we stored it in progress.
        // But for "Review", we want progress on these specific IDs.

        const col = collection(db, `users/${uid}/coach_card_progress`);
        const snap = await getDocs(col);

        const progressMap = {};
        snap.forEach(doc => {
            if (cardIds.includes(doc.id)) {
                progressMap[doc.id] = doc.data();
            }
        });
        return progressMap;
    }
}

export const coachStore = new CoachStore();
