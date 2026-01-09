/* src/modules/coach/openaiPackGenerator.js */
import { app, auth, ensureAnonymousSession } from '../../firebase.js';

export const openaiPackGenerator = {
    async generatePackJSON({
        pack_id,
        pack_name,
        version = '1.0.0',
        source_lang = 'en',
        target_lang = 'en',
        topic = '',
        cardCount = 20
    }) {
        await ensureAnonymousSession();
        const projectId = app?.options?.projectId;
        if (!projectId) throw new Error('FIREBASE_PROJECT_ID_MISSING');

        const idToken = await auth.currentUser?.getIdToken?.();
        if (!idToken) throw new Error('AUTH_TOKEN_MISSING');

        const endpoint = `https://us-central1-${projectId}.cloudfunctions.net/generateCoachPack`;
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${idToken}`
            },
            body: JSON.stringify({
                pack_id,
                pack_name,
                version,
                source_lang,
                target_lang,
                topic,
                cardCount
            })
        });

        const payload = await res.json().catch(() => null);
        if (!res.ok) {
            const msg = payload?.error || `HTTP_${res.status}`;
            throw new Error(msg);
        }
        return payload;
    }
};
