import { Utils } from '../../utils/helpers.js';

export const PROTOCOL_VERSION = 1;
export const SESSION_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes
export const CHUNK_SIZE = 16 * 1024;
const HKDF_INFO = Utils.strToBuffer('PINBRIDGE-SYNC-SESSION');

export function buildOfferPayload({ sid, expiration, offerSdp, pubKey }) {
    return {
        v: PROTOCOL_VERSION,
        sid,
        t: expiration,
        offer: Utils.strToBase64(offerSdp),
        pubA: pubKey
    };
}

export function buildAnswerPayload({ sid, expiration, answerSdp, pubKey }) {
    return {
        v: PROTOCOL_VERSION,
        sid,
        t: expiration,
        answer: Utils.strToBase64(answerSdp),
        pubB: pubKey
    };
}

export function decodeOffer(payload) {
    if (!payload || payload.v !== PROTOCOL_VERSION) throw new Error('Unsupported protocol version');
    return {
        sid: payload.sid,
        expiration: payload.t,
        offer: Utils.base64ToStr(payload.offer),
        pubA: payload.pubA
    };
}

export function decodeAnswer(payload) {
    if (!payload || payload.v !== PROTOCOL_VERSION) throw new Error('Unsupported protocol version');
    return {
        sid: payload.sid,
        expiration: payload.t,
        answer: Utils.base64ToStr(payload.answer),
        pubB: payload.pubB
    };
}

export function ensureNotExpired(timestamp) {
    if (Date.now() > timestamp) {
        throw new Error('Session offer expired');
    }
}

export async function deriveSessionKey(localPrivateKey, remotePublicRaw, sessionId) {
    const remoteKey = await crypto.subtle.importKey(
        'raw',
        Utils.base64ToBuffer(remotePublicRaw),
        {
            name: 'ECDH',
            namedCurve: 'P-256'
        },
        true,
        []
    );

    return crypto.subtle.deriveKey(
        {
            name: 'ECDH',
            public: remoteKey
        },
        localPrivateKey,
        {
            name: 'HKDF',
            hash: 'SHA-256',
            salt: Utils.strToBuffer(sessionId),
            info: HKDF_INFO
        },
        false,
        ['encrypt', 'decrypt']
    );
}

export async function encryptMessage(sessionKey, payload) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = Utils.strToBuffer(JSON.stringify(payload));
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, sessionKey, encoded);
    return {
        iv: Utils.bufferToBase64(iv),
        data: Utils.bufferToBase64(encrypted)
    };
}

export async function decryptMessage(sessionKey, packet) {
    if (!packet || packet.type !== 'enc') throw new Error('Invalid packet');
    const iv = Utils.base64ToBuffer(packet.iv);
    const cipher = Utils.base64ToBuffer(packet.data);
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, sessionKey, cipher);
    return JSON.parse(Utils.bufferToStr(decrypted));
}
