/* PINBRIDGE Firebase Functions: OpenAI proxy for Coach pack generation */
import admin from 'firebase-admin';
import { defineSecret } from 'firebase-functions/params';
import { onRequest } from 'firebase-functions/v2/https';

if (!admin.apps.length) admin.initializeApp();

const OPENAI_API_KEY = defineSecret('OPENAI_API_KEY');
const AI_ALLOWED_UIDS = defineSecret('AI_ALLOWED_UIDS');

const ALLOWED_ORIGINS = new Set([
  'https://pinbridge-web.web.app',
  'https://pinbridge-web.firebaseapp.com'
]);

function isEmulator() {
  return String(process.env.FUNCTIONS_EMULATOR || '').toLowerCase() === 'true';
}

function setCors(req, res) {
  const origin = String(req.headers.origin || '');
  const allowed = ALLOWED_ORIGINS.has(origin) || (isEmulator() && origin.startsWith('http://localhost'));
  if (allowed) {
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Vary', 'Origin');
  }
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Firebase-AppCheck');
  res.set('Access-Control-Max-Age', '3600');
  return allowed;
}

function bad(res, status, message) {
  res.status(status).json({ error: message });
}

function validateGeneratedPack(pack, { packId, cardCount }) {
  if (!pack || typeof pack !== 'object') throw new Error('INVALID_PACK');
  if (pack.schema_version !== 'v2-pack') throw new Error('INVALID_SCHEMA_VERSION');
  if (!pack.pack || typeof pack.pack !== 'object') throw new Error('MISSING_PACK_METADATA');
  if (String(pack.pack.pack_id || '') !== packId) throw new Error('PACK_ID_MISMATCH');
  if (!Array.isArray(pack.cards)) throw new Error('MISSING_CARDS');
  if (pack.cards.length !== cardCount) throw new Error('CARD_COUNT_MISMATCH');

  const seen = new Set();
  for (const c of pack.cards) {
    if (!c || typeof c !== 'object') throw new Error('INVALID_CARD');
    const id = String(c.card_id || '');
    if (!id) throw new Error('MISSING_CARD_ID');
    if (seen.has(id)) throw new Error('DUPLICATE_CARD_ID');
    seen.add(id);
    if (!c.front_i18n || !c.question_i18n) throw new Error('INVALID_CARD_STRUCTURE');
  }
}

async function requireAppCheck(req) {
  const token = String(req.get('X-Firebase-AppCheck') || '');
  if (!token) {
    if (isEmulator()) return { appId: 'emulator' };
    throw new Error('MISSING_APP_CHECK');
  }
  return await admin.appCheck().verifyToken(token);
}

function requireUidAllowlistOrThrow(uid) {
  const raw = String(AI_ALLOWED_UIDS.value() || '').trim();
  if (!raw) return; // allowlist not configured
  const allowed = new Set(
    raw
      .split(/[,\s]+/g)
      .map(s => s.trim())
      .filter(Boolean)
  );
  if (!allowed.has(uid)) throw new Error('UID_NOT_ALLOWED');
}

async function rateLimitOrThrow(uid, { limit = 20, windowMs = 60 * 60 * 1000 } = {}) {
  const db = admin.firestore();
  const ref = db.doc(`ai_rate_limits/${uid}`);
  const now = Date.now();

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() : null;

    const windowStart = Number(data?.windowStart || 0);
    const count = Number(data?.count || 0);
    const within = windowStart && now - windowStart < windowMs;

    const nextWindowStart = within ? windowStart : now;
    const nextCount = within ? count + 1 : 1;

    if (nextCount > limit) {
      throw new Error('RATE_LIMITED');
    }

    tx.set(ref, {
      windowStart: nextWindowStart,
      count: nextCount,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  });
}

async function callOpenAI({ apiKey, system, user }) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.4,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ]
    })
  });

  if (!res.ok) {
    let detail = '';
    try {
      const err = await res.json();
      detail = err?.error?.message || JSON.stringify(err);
    } catch {
      detail = await res.text();
    }
    throw new Error(`OPENAI_HTTP_${res.status}: ${String(detail).slice(0, 600)}`);
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content || '';
  if (!text) throw new Error('OPENAI_EMPTY_RESPONSE');
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('OPENAI_RETURNED_INVALID_JSON');
  }
}

export const generateCoachPack = onRequest(
  {
    region: 'us-central1',
    secrets: [OPENAI_API_KEY, AI_ALLOWED_UIDS]
  },
  async (req, res) => {
    const corsOk = setCors(req, res);
    if (req.method === 'OPTIONS') return res.status(204).send('');
    if (req.method !== 'POST') return bad(res, 405, 'METHOD_NOT_ALLOWED');
    if (!corsOk) return bad(res, 403, 'CORS_NOT_ALLOWED');

    const authHeader = String(req.get('authorization') || '');
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : '';
    if (!token) return bad(res, 401, 'MISSING_AUTH');

    let decoded;
    try {
      decoded = await admin.auth().verifyIdToken(token);
    } catch {
      return bad(res, 401, 'INVALID_AUTH');
    }

    // Personal mode: if you don't want App Check, configure an allowlist of UIDs.
    // This prevents random anonymous users from burning your OpenAI key.
    try {
      requireUidAllowlistOrThrow(decoded.uid);
    } catch (e) {
      return bad(res, 403, e?.message || 'UID_NOT_ALLOWED');
    }

    try {
      await rateLimitOrThrow(decoded.uid, { limit: 30, windowMs: 60 * 60 * 1000 });
    } catch (e) {
      return bad(res, 429, e?.message || 'RATE_LIMITED');
    }

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const packId = String(body.pack_id || 'generated_pack')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_\-]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'generated_pack';
    const packName = String(body.pack_name || packId).trim() || packId;
    const version = String(body.version || '1.0.0').trim() || '1.0.0';
    const sourceLang = (String(body.source_lang || 'en').trim() || 'en').toLowerCase();
    const targetLang = (String(body.target_lang || 'en').trim() || 'en').toLowerCase();
    const topic = String(body.topic || packName).trim();
    const cardCount = Math.max(5, Math.min(100, Number(body.cardCount) || 20));

    const schemaHint = {
      schema_version: 'v2-pack',
      generated_at: new Date().toISOString(),
      pack: {
        pack_id: packId,
        version,
        level: 'Custom',
        mode: 'CUSTOM',
        languages: ['en', sourceLang, targetLang],
        title_i18n: { en: packName, [sourceLang]: packName, [targetLang]: packName },
        description_i18n: {
          en: `AI generated pack about ${topic || packName}`,
          [sourceLang]: `AI generated pack about ${topic || packName}`,
          [targetLang]: `AI generated pack about ${topic || packName}`
        },
        categories: [{ id: 'core', title_i18n: { en: 'Core', [sourceLang]: 'Core', [targetLang]: 'Core' } }],
        card_count: cardCount
      },
      cards: [
        {
          card_id: `${packId}_001`,
          category: 'core',
          tags: ['generated', 'ai'],
          front_i18n: { [sourceLang]: 'TERM', [targetLang]: 'TERM_TRANSLATION' },
          question_i18n: { [sourceLang]: 'Question?', [targetLang]: 'Question?' },
          correct_answer_i18n: { [sourceLang]: 'Answer', [targetLang]: 'Answer' },
          example_sentence_i18n: { [sourceLang]: 'Example.', [targetLang]: 'Example.' },
          usage_type: 'vocab',
          tts: { auto_read: false, language: targetLang === 'es' ? 'es-ES' : targetLang === 'fr' ? 'fr-FR' : targetLang === 'nl' ? 'nl-NL' : 'en-US', text: 'TERM', rate: 1.0 },
          difficulty_1to5: 2
        }
      ]
    };

    const system = [
      'You generate study packs for PINBRIDGE Coach.',
      'Return ONLY valid JSON (no markdown, no code fences, no commentary).',
      'Must match this schema shape: schema_version, generated_at, pack, cards.',
      'Constraints:',
      `- pack.pack_id="${packId}", pack.version="${version}"`,
      `- cards length exactly ${cardCount}`,
      '- Each card must include: card_id (unique), category, tags, front_i18n, question_i18n, correct_answer_i18n.',
      `- Use languages keys exactly "${sourceLang}" and "${targetLang}" in *_i18n objects (you may also include "en").`,
      '- Ensure card_id format: <pack_id>_<3-digit> like pack_001, pack_002, ...',
      '- Keep content concise and high quality.'
    ].join('\n');

    const user = [
      `Generate a pack about: ${topic}`,
      `Source language: ${sourceLang}`,
      `Target language: ${targetLang}`,
      `Pack name: ${packName}`,
      `Card count: ${cardCount}`,
      'Example schema (for shape only):',
      JSON.stringify(schemaHint)
    ].join('\n');

    const apiKey = OPENAI_API_KEY.value();
    if (!apiKey) return bad(res, 501, 'OPENAI_API_KEY_NOT_CONFIGURED');

    try {
      const pack = await callOpenAI({ apiKey, system, user });
      validateGeneratedPack(pack, { packId, cardCount });
      res.status(200).json(pack);
    } catch (e) {
      bad(res, 500, e?.message || 'GENERATION_FAILED');
    }
  }
);
