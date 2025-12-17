import { Utils } from '../../utils/helpers.js';
import { deriveSessionKey, buildOfferPayload, buildAnswerPayload, decodeOffer, decodeAnswer, SESSION_TIMEOUT_MS } from './protocol.js';

const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

export class PeerSession {
    constructor(role, callbacks = {}) {
        this.role = role; // 'offer' or 'answer'
        this.callbacks = callbacks;
        this.sid = Utils.generateId();
        this.expiration = Date.now() + SESSION_TIMEOUT_MS;
        this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
        this.channel = null;
        this.sessionKey = null;
        this.ecdhKeyPair = null;
        this.publicKeyRaw = null;
        this.publicKeyBase64 = null;

        this.channelOpenPromise = new Promise(resolve => this._resolveChannelOpen = resolve);

        this.pc.oniceconnectionstatechange = () => {
            this.callbacks.onIceState?.(this.pc.iceConnectionState);
            if (['failed', 'disconnected'].includes(this.pc.iceConnectionState)) {
                this.callbacks.onError?.(new Error('ICE connection state: ' + this.pc.iceConnectionState));
            }
        };

        this.pc.ondatachannel = (event) => {
            if (this.channel) return;
            this.attachChannel(event.channel);
        };

        this.timeoutHandle = setTimeout(() => {
            this.callbacks.onTimeout?.();
            this.close();
        }, SESSION_TIMEOUT_MS);
    }

    async generateKeyPair() {
        if (this.ecdhKeyPair) return;
        this.ecdhKeyPair = await crypto.subtle.generateKey(
            { name: 'ECDH', namedCurve: 'P-256' },
            true,
            ['deriveKey']
        );
        const raw = await crypto.subtle.exportKey('raw', this.ecdhKeyPair.publicKey);
        this.publicKeyRaw = new Uint8Array(raw);
        this.publicKeyBase64 = Utils.bufferToBase64(this.publicKeyRaw);
    }

    attachChannel(channel) {
        this.channel = channel;
        this.channel.binaryType = 'arraybuffer';
        this.channel.addEventListener('open', () => {
            this._resolveChannelOpen?.();
            this.callbacks.onStateChange?.('connected');
        });
        this.channel.addEventListener('close', () => {
            this.callbacks.onStateChange?.('closed');
        });
        this.channel.addEventListener('message', (event) => this.handleMessage(event.data));
    }

    async handleMessage(raw) {
        if (!this.sessionKey) return;
        try {
            const packet = JSON.parse(raw);
            const payload = await this.callbacks.decrypt(packet, this.sessionKey);
            this.callbacks.onMessage?.(payload);
        } catch (err) {
            this.callbacks.onError?.(err);
        }
    }

    async waitForIceGathering() {
        if (this.pc.iceGatheringState === 'complete') return;
        return new Promise(resolve => {
            const handler = () => {
                if (this.pc.iceGatheringState === 'complete') {
                    this.pc.removeEventListener('icegatheringstatechange', handler);
                    resolve();
                }
            };
            this.pc.addEventListener('icegatheringstatechange', handler);
        });
    }

    async waitForChannelOpen() {
        if (this.channel && this.channel.readyState === 'open') return;
        return this.channelOpenPromise;
    }

    async sendEncrypted(payload) {
        if (!this.sessionKey) throw new Error('Session key not ready');
        await this.waitForChannelOpen();
        const packet = await this.callbacks.encrypt(payload, this.sessionKey);
        this.channel.send(JSON.stringify(packet));
    }

    async createOffer() {
        await this.setupDataChannel();
        await this.generateKeyPair();
        const offer = await this.pc.createOffer();
        await this.pc.setLocalDescription(offer);
        await this.waitForIceGathering();
        this.expiration = Date.now() + SESSION_TIMEOUT_MS;
        return buildOfferPayload({
            sid: this.sid,
            expiration: this.expiration,
            offerSdp: offer.sdp,
            pubKey: this.publicKeyBase64
        });
    }

    async applyAnswer(answerPayload) {
        const answer = decodeAnswer(answerPayload);
        if (answer.sid !== this.sid) throw new Error('Session mismatch');
        if (Date.now() > answer.expiration) throw new Error('Answer expired');
        await this.generateKeyPair();
        this.sessionKey = await deriveSessionKey(this.ecdhKeyPair.privateKey, answer.pubB, this.sid);
        await this.pc.setRemoteDescription({ type: 'answer', sdp: answer.answer });
    }

    async acceptOffer(payload) {
        const offer = decodeOffer(payload);
        this.sid = offer.sid;
        this.expiration = offer.expiration;
        await this.generateKeyPair();
        this.sessionKey = await deriveSessionKey(this.ecdhKeyPair.privateKey, offer.pubA, this.sid);
        await this.pc.setRemoteDescription({ type: 'offer', sdp: offer.offer });
        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);
        await this.waitForIceGathering();
        return buildAnswerPayload({
            sid: this.sid,
            expiration: Date.now() + SESSION_TIMEOUT_MS,
            answerSdp: answer.sdp,
            pubKey: this.publicKeyBase64
        });
    }

    async setupDataChannel() {
        if (this.channel) return;
        const channel = this.pc.createDataChannel('pinbridge-sync', { ordered: true, reliable: true });
        this.attachChannel(channel);
    }

    close() {
        if (this.timeoutHandle) clearTimeout(this.timeoutHandle);
        if (this.channel) this.channel.close();
        if (this.pc) this.pc.close();
        this.callbacks.onClose?.();
    }
}
