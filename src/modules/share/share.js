/**
 * Peer-to-peer file transfer over WebRTC data channels.
 * Manual signaling (copy/paste) to avoid server dependency.
 */

const DEFAULT_ICE = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:global.stun.twilio.com:3478?transport=udp' }
];

class ShareService {
    constructor() {
        this.pc = null;
        this.channel = null;
        this.callbacks = {};
        this.pendingFile = null;
        this.pendingOptions = null;
        this.transfer = null;
        this.receiving = null;
        this.isInitiator = false;
    }

    setCallbacks(callbacks) {
        this.callbacks = callbacks || {};
    }

    async createOffer() {
        this._resetConnection();
        this.isInitiator = true;
        this._setupConnection();
        const offer = await this.pc.createOffer();
        await this.pc.setLocalDescription(offer);
        const sdp = await this._awaitIceGathering();
        return JSON.stringify(sdp);
    }

    async acceptAnswer(answerJson) {
        if (!this.pc) throw new Error('No active session.');
        const answer = JSON.parse(answerJson);
        await this.pc.setRemoteDescription(answer);
    }

    async joinWithOffer(offerJson) {
        this._resetConnection();
        this.isInitiator = false;
        this._setupConnection();
        const offer = JSON.parse(offerJson);
        await this.pc.setRemoteDescription(offer);
        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);
        const sdp = await this._awaitIceGathering();
        return JSON.stringify(sdp);
    }

    setFile(file, options) {
        this.pendingFile = file || null;
        this.pendingOptions = options || null;
        if (this.channel && this.channel.readyState === 'open' && this.pendingFile) {
            this._sendMetadataAndPreview();
        }
    }

    async sendTransferRequest(action) {
        if (!this.channel || this.channel.readyState !== 'open') return;
        this.channel.send(JSON.stringify({ type: 'request', action }));
    }

    cancelSession() {
        this._resetConnection();
    }

    _setupConnection() {
        this.pc = new RTCPeerConnection({ iceServers: DEFAULT_ICE });
        this.pc.oniceconnectionstatechange = () => {
            this.callbacks.onConnectionState?.(this.pc.iceConnectionState);
        };
        this.pc.onconnectionstatechange = () => {
            this.callbacks.onConnectionState?.(this.pc.connectionState);
        };

        if (this.isInitiator) {
            this.channel = this.pc.createDataChannel('pinbridge-share', { ordered: true });
            this._attachChannel(this.channel);
        } else {
            this.pc.ondatachannel = (event) => {
                this.channel = event.channel;
                this._attachChannel(this.channel);
            };
        }
    }

    _attachChannel(channel) {
        channel.binaryType = 'arraybuffer';
        channel.onopen = () => {
            this.callbacks.onChannelOpen?.();
            if (this.pendingFile) {
                this._sendMetadataAndPreview();
            }
        };
        channel.onclose = () => this.callbacks.onChannelClose?.();
        channel.onerror = (err) => this.callbacks.onError?.(err);
        channel.onmessage = (event) => this._handleMessage(event.data);
    }

    async _handleMessage(data) {
        if (typeof data === 'string') {
            const msg = this._safeJson(data);
            if (!msg?.type) return;

            if (msg.type === 'meta') {
                this.receiving = {
                    meta: msg.payload,
                    buffers: [],
                    receivedBytes: 0,
                    expectedBytes: msg.payload.size || 0
                };
                this.callbacks.onMeta?.(msg.payload);
                return;
            }

            if (msg.type === 'preview') {
                this.callbacks.onPreview?.(msg.payload);
                return;
            }

            if (msg.type === 'request') {
                if (!this.pendingFile || msg.action !== 'download') {
                    return;
                }
                const permissions = this.pendingOptions?.permissions;
                if (permissions?.mode === 'view') return;
                if (permissions?.expiresAt && Date.now() > permissions.expiresAt) return;
                await this._sendFile();
                return;
            }

            if (msg.type === 'transfer-start') {
                if (this.receiving) {
                    this.receiving.expectedBytes = msg.total;
                    this.callbacks.onTransferStart?.(msg.total);
                }
                return;
            }

            if (msg.type === 'transfer-complete') {
                this._finalizeReceive();
                return;
            }

            return;
        }

        if (data instanceof ArrayBuffer) {
            if (!this.receiving) return;
            this.receiving.buffers.push(data);
            this.receiving.receivedBytes += data.byteLength;
            this.callbacks.onProgress?.({
                direction: 'receive',
                transferred: this.receiving.receivedBytes,
                total: this.receiving.expectedBytes
            });

            if (this.receiving.expectedBytes &&
                this.receiving.receivedBytes >= this.receiving.expectedBytes) {
                this._finalizeReceive();
            }
        }
    }

    async _sendMetadataAndPreview() {
        if (!this.pendingFile || !this.channel) return;
        const file = this.pendingFile;
        const options = this.pendingOptions || {};
        const meta = {
            name: file.name,
            type: file.type || 'application/octet-stream',
            size: file.size,
            permissions: options.permissions || { mode: 'download', expiresAt: null },
            destruct: options.destruct || { rule: 'never', minutes: null },
            createdAt: Date.now()
        };

        this.channel.send(JSON.stringify({ type: 'meta', payload: meta }));

        try {
            const preview = await this._buildPreview(file);
            if (preview) {
                this.channel.send(JSON.stringify({ type: 'preview', payload: preview }));
            }
        } catch (err) {
            this.callbacks.onError?.(err);
        }
    }

    async _sendFile() {
        const file = this.pendingFile;
        if (!file || !this.channel) return;

        const chunkSize = 64 * 1024;
        let offset = 0;
        this.callbacks.onTransferStart?.(file.size);
        this.channel.send(JSON.stringify({ type: 'transfer-start', total: file.size, chunkSize }));

        const readSlice = () => {
            const slice = file.slice(offset, offset + chunkSize);
            const reader = new FileReader();
            reader.onload = () => {
                if (reader.result) {
                    this.channel.send(reader.result);
                    offset += slice.size;
                    this.callbacks.onProgress?.({
                        direction: 'send',
                        transferred: offset,
                        total: file.size
                    });

                    if (offset < file.size) {
                        readSlice();
                    } else {
                        this.channel.send(JSON.stringify({ type: 'transfer-complete' }));
                        this.callbacks.onTransferComplete?.(file);
                    }
                }
            };
            reader.onerror = (err) => this.callbacks.onError?.(err);
            reader.readAsArrayBuffer(slice);
        };

        readSlice();
    }

    _finalizeReceive() {
        if (!this.receiving) return;
        const blob = new Blob(this.receiving.buffers, { type: this.receiving.meta?.type || 'application/octet-stream' });
        const meta = this.receiving.meta;
        this.callbacks.onTransferComplete?.(blob, meta);
        this.receiving = null;
    }

    async _buildPreview(file) {
        if (file.type.startsWith('image/')) {
            return await this._buildImagePreview(file);
        }

        if (file.type === 'application/pdf') {
            return await this._buildPdfPreview(file);
        }

        return null;
    }

    async _buildImagePreview(file) {
        const dataUrl = await this._readFileAsDataUrl(file);
        const img = await this._loadImage(dataUrl);
        const maxSize = 480;
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const previewUrl = canvas.toDataURL('image/jpeg', 0.7);
        return { type: 'image', dataUrl: previewUrl };
    }

    async _buildPdfPreview(file) {
        if (!window.pdfjsLib) {
            return { type: 'pdf', dataUrl: null };
        }
        window.pdfjsLib.GlobalWorkerOptions.workerSrc =
            window.pdfjsLib.GlobalWorkerOptions.workerSrc ||
            'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.2.67/build/pdf.worker.min.js';

        const buffer = await file.arrayBuffer();
        const pdf = await window.pdfjsLib.getDocument({ data: buffer }).promise;
        const page = await pdf.getPage(1);
        const viewport = page.getViewport({ scale: 1.2 });
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvasContext: ctx, viewport }).promise;
        const dataUrl = canvas.toDataURL('image/png');
        return { type: 'pdf', dataUrl };
    }

    _readFileAsDataUrl(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = (err) => reject(err);
            reader.readAsDataURL(file);
        });
    }

    _loadImage(dataUrl) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = (err) => reject(err);
            img.src = dataUrl;
        });
    }

    _safeJson(data) {
        try {
            return JSON.parse(data);
        } catch {
            return null;
        }
    }

    _awaitIceGathering() {
        return new Promise((resolve) => {
            if (this.pc.iceGatheringState === 'complete') {
                resolve(this.pc.localDescription);
                return;
            }
            const onStateChange = () => {
                if (this.pc.iceGatheringState === 'complete') {
                    this.pc.removeEventListener('icegatheringstatechange', onStateChange);
                    resolve(this.pc.localDescription);
                }
            };
            this.pc.addEventListener('icegatheringstatechange', onStateChange);
        });
    }

    _resetConnection() {
        if (this.channel) {
            this.channel.close();
            this.channel = null;
        }
        if (this.pc) {
            this.pc.close();
            this.pc = null;
        }
        this.pendingFile = null;
        this.pendingOptions = null;
        this.receiving = null;
        this.isInitiator = false;
    }
}

export const shareService = new ShareService();
