/**
 * PINBRIDGE Pairing Service
 * Implements device-to-device pairing via QR code and a signaling server.
 * Uses SPAKE2 for the Password-Authenticated Key Exchange.
 */
import { cryptoService } from '../../crypto/crypto.js';
import { Utils } from '../../utils/helpers.js';
import { vaultService } from '../../vault.js';

// NOTE: In a real-world scenario, this would be your own signaling server.
// A simple Glitch.me or similar WebSocket server is sufficient for this.
const SIGNALING_SERVER_URL = 'wss://pinbridge-signal.glitch.me';

// A minimal, self-contained SPAKE2 implementation.
// For production, a thoroughly audited library is always preferred.
const SPAKE2 = {
    // Using P-256 curve
    M: new Uint8Array(Utils.hexToBuffer("02886e2f97ace46e55ba9dd7242579f2993b64e16ef3dcab95afd497333d8fa12f")),
    N: new Uint8Array(Utils.hexToBuffer("03d8bbd6c639c62937b04d997f38c3770719c629d7014d49a24b4f98baa1292b49")),
    async computeSharedKey(confirmationCode, isInitiator, peerMessage) {
        const ec = new TextEncoder();
        const pw = await crypto.subtle.importKey('raw', ec.encode(confirmationCode), { name: 'PBKDF2' }, false, ['deriveBits']);
        const w = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: ec.encode(''), iterations: 1, hash: 'SHA-256' }, pw, 256);

        const scalar = await cryptoService.reduceToScalar(new Uint8Array(w));
        const wL = await cryptoService.scalarMultiply(cryptoService.G, scalar);

        const keyPair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
        const x = await crypto.subtle.exportKey('raw', keyPair.privateKey);
        const X = await crypto.subtle.exportKey('raw', keyPair.publicKey);

        const pM = await cryptoService.pointAdd(X, await cryptoService.scalarMultiply(this.M, scalar));
        const pN = await cryptoService.pointAdd(X, await cryptoService.scalarMultiply(this.N, scalar));

        const myMessage = isInitiator ? pM : pN;

        if (!peerMessage) {
            return { myMessage: Utils.bufferToBase64(myMessage), context: { x, wL } };
        }

        const S = Utils.base64ToBuffer(peerMessage);
        const pS = isInitiator ?
            await cryptoService.pointSubtract(S, await cryptoService.scalarMultiply(this.N, scalar)) :
            await cryptoService.pointSubtract(S, await cryptoService.scalarMultiply(this.M, scalar));

        const K_ = await cryptoService.scalarMultiply(pS, new Uint8Array(x));
        const K = await cryptoService.scalarMultiply(wL, new Uint8Array(x));

        const transcript = new Uint8Array([...(isInitiator ? myMessage : S), ...(isInitiator ? S : myMessage)]);
        const sharedKey = await cryptoService.hkdf(K_, K, transcript);

        return { sharedKey };
    }
};

class PairingService {
    constructor() {
        this.ws = null;
        this.pairingId = null;
        this.confirmationCode = null;
        this.callbacks = {};
        this.state = 'idle'; // idle, starting, waiting, handshake, verifying, complete, error
        this.spakeContext = null;
        this.sharedKey = null;
    }

    async startPairingSession(callbacks) {
        if (this.state !== 'idle') {
            throw new Error('A pairing session is already in progress.');
        }

        this.state = 'starting';
        this.callbacks = callbacks;

        try {
            this.pairingId = `pinbridge-${Utils.bufferToHex(crypto.getRandomValues(new Uint8Array(8)))}`;
            this.confirmationCode = `${Math.floor(100 + Math.random() * 900)}-${Math.floor(100 + Math.random() * 900)}`;

            this.callbacks.onConfirmationCode?.(this.confirmationCode);

            const qrPayload = JSON.stringify({
                pairingId: this.pairingId,
                server: SIGNALING_SERVER_URL,
                expires: Date.now() + 5 * 60 * 1000 // 5-minute expiry
            });

            const qrCodeDataURL = await cryptoService.generateQRCode(qrPayload);
            this.callbacks.onQRCode?.(qrCodeDataURL);

            this._connectToSignalingServer();
        } catch (err) {
            this.state = 'error';
            this.callbacks.onError?.(err);
        }
    }

    _connectToSignalingServer() {
        this.ws = new WebSocket(SIGNALING_SERVER_URL);

        this.ws.onopen = () => {
            this.ws.send(JSON.stringify({ type: 'subscribe', channel: this.pairingId }));
            this.state = 'waiting';
        };

        this.ws.onmessage = (event) => this._handleSignalingMessage(event.data);

        this.ws.onerror = (err) => {
            this.state = 'error';
            this.callbacks.onError?.(new Error('Signaling server connection failed.'));
            console.error('WebSocket Error:', err);
        };

        this.ws.onclose = () => {
            if (this.state !== 'complete' && this.state !== 'idle') {
                this.state = 'error';
                this.callbacks.onError?.(new Error('Connection to server lost.'));
            }
        };
    }

    async _handleSignalingMessage(data) {
        const msg = JSON.parse(data);

        switch (msg.type) {
            case 'peer-joined':
                this.callbacks.onPeerConnected?.();
                this.state = 'handshake';
                // As the initiator, we wait for the peer's SPAKE2 message.
                break;

            case 'spake-message':
                if (this.state === 'handshake') {
                    // We are the initiator, receiving the first message.
                    const { sharedKey } = await SPAKE2.computeSharedKey(this.confirmationCode, true, msg.payload);
                    this.sharedKey = sharedKey;

                    // Now, send the vault key encrypted with the new shared key.
                    await this._sendVaultKey();
                }
                break;

            case 'encrypted-data':
                if (this.state === 'verifying') {
                    try {
                        const decrypted = await cryptoService.decryptObject(msg.payload, this.sharedKey);
                        if (decrypted.vaultKey) {
                            // We are the new device, receiving the vault key.
                            await vaultService.importVaultFromKey(decrypted.vaultKey);
                            this.state = 'complete';
                            this.callbacks.onComplete?.();
                            this.cancelPairingSession();
                        }
                    } catch (err) {
                        this.state = 'error';
                        this.callbacks.onError?.(new Error('Decryption failed. Confirmation codes may not match.'));
                    }
                }
                break;
        }
    }

    async _sendVaultKey() {
        if (!this.sharedKey) {
            throw new Error('Cannot send vault key without a shared secret.');
        }

        this.state = 'verifying';
        const vaultKey = await vaultService.getVaultRecoveryKey();
        const encryptedPayload = await cryptoService.encryptObject({ vaultKey }, this.sharedKey);

        this.ws.send(JSON.stringify({
            type: 'encrypted-data',
            channel: this.pairingId,
            payload: encryptedPayload
        }));

        this.state = 'complete';
        this.callbacks.onComplete?.();
        // Don't close session immediately, wait for peer confirmation.
        setTimeout(() => this.cancelPairingSession(), 5000);
    }

    cancelPairingSession() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.state = 'idle';
        this.pairingId = null;
        this.confirmationCode = null;
        this.callbacks = {};
        this.spakeContext = null;
        this.sharedKey = null;
        console.log('Pairing session cancelled and cleaned up.');
    }
}

export const pairingService = new PairingService();