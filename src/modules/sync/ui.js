import { renderQRCode, clearQRCode } from './qr.js';

const DEFAULT_SIZE = 240;

function createElement(html) {
    const container = document.createElement('div');
    container.innerHTML = html.trim();
    return container.firstElementChild;
}

export function createSyncOverlay({ mode = 'offer', title = 'Sync', subtitle = '', onCancel, onManualApply, onCopy, onStarted, onScanAnswer, onScanOffer }) {
    const overlay = createElement(`
        <div class="sync-overlay">
            <div class="sync-card glass-panel">
                <header class="sync-header">
                    <div>
                        <h3>${title}</h3>
                        <p class="sync-subtitle">${subtitle}</p>
                    </div>
                    <button class="btn btn-text" data-action="cancel">Cancel pairing</button>
                </header>
                <div class="sync-status-row">
                    <span class="sync-status-label">Status:</span>
                    <span class="sync-status-text" data-role="status">Initializing...</span>
                    <span class="sync-expiry" data-role="expiry"></span>
                </div>
                <div class="sync-progress">
                    <div class="sync-progress-fill" data-role="progress"></div>
                </div>
                <div class="sync-qr" data-role="qr"></div>
                <textarea readonly class="sync-code" data-role="code" placeholder="Pairing payload will appear here..."></textarea>
                <div class="sync-actions">
                    <button class="btn btn-primary" data-action="copy">Copy code</button>
                    ${mode === 'offer' ? '<button class="btn btn-secondary" data-action="scan-answer">Scan answer QR</button>' : '<button class="btn btn-secondary" data-action="camera">Start camera</button>'}
                    <button class="btn btn-secondary" data-action="manual">Paste code manually</button>
                </div>
                <div class="sync-scanner hidden" data-role="scanner">
                    <video autoplay muted playsinline></video>
                    <p class="sync-scanner-tip">Point camera at QR code</p>
                    <button class="btn btn-text" data-action="scanner-stop">Stop camera</button>
                </div>
                <div class="sync-manual hidden" data-role="manual">
                    <textarea placeholder="Paste QR payload here..." data-role="manual-input"></textarea>
                    <button class="btn btn-primary" data-action="manual-apply">Use this code</button>
                </div>
            </div>
        </div>
    `);

    document.body.appendChild(overlay);

    const statusEl = overlay.querySelector('[data-role="status"]');
    const expiryEl = overlay.querySelector('[data-role="expiry"]');
    const progressEl = overlay.querySelector('[data-role="progress"]');
    const qrContainer = overlay.querySelector('[data-role="qr"]');
    const codeArea = overlay.querySelector('[data-role="code"]');
    const manualArea = overlay.querySelector('[data-role="manual"]');
    const manualInput = overlay.querySelector('[data-role="manual-input"]');
    const scannerArea = overlay.querySelector('[data-role="scanner"]');
    const video = scannerArea.querySelector('video');

    let expiryTimer;
    let scanner = null;

    const actions = overlay.querySelectorAll('button[data-action]');
    actions.forEach(btn => {
        btn.addEventListener('click', () => {
            const action = btn.dataset.action;
            switch (action) {
                case 'cancel':
                    onCancel?.();
                    break;
                case 'copy':
                    onCopy?.(codeArea.value);
                    break;
                case 'scan-answer':
                    startScanner(onScanAnswer);
                    break;
                case 'camera':
                    startScanner(onScanOffer);
                    break;
                case 'manual':
                    manualArea.classList.toggle('hidden');
                    break;
                case 'manual-apply':
                    onManualApply?.(manualInput.value.trim());
                    break;
                case 'scanner-stop':
                    stopScanner();
                    break;
            }
        });
    });

    function startScanner(onDetected) {
        if (!navigator.mediaDevices?.getUserMedia) {
            onStarted?.('Camera not available');
            return;
        }
        overlay.querySelector('[data-role="scanner"]').classList.remove('hidden');
        if (scanner?.stream) stopScanner();
        navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
            .then(stream => {
                const detector = window.BarcodeDetector ? new BarcodeDetector({ formats: ['qr_code'] }) : null;
                if (!detector) {
                    onStarted?.('QR scanning is not supported in this browser.');
                    stream.getTracks().forEach(track => track.stop());
                    return;
                }
                video.srcObject = stream;
                scanner = { stream, running: true };
                const scanLoop = async () => {
                    if (!scanner?.running) return;
                    try {
                        const codes = await detector.detect(video);
                        if (codes.length) {
                            stopScanner();
                            onDetected?.(codes[0].rawValue);
                            return;
                        }
                    } catch (err) {
                        scanner.running = false;
                        onStarted?.('Scanner failed');
                        return;
                    }
                    requestAnimationFrame(scanLoop);
                };
                requestAnimationFrame(scanLoop);
            })
            .catch(err => {
                onStarted?.(err.message || 'Camera permission denied');
            });
    }

    function stopScanner() {
        if (scanner?.stream) {
            scanner.stream.getTracks().forEach(track => track.stop());
        }
        scanner = null;
        scannerArea.classList.add('hidden');
        video.srcObject = null;
    }

    function updateExpiry(ts) {
        if (expiryTimer) clearInterval(expiryTimer);
        if (!ts) {
            expiryEl.textContent = '';
            return;
        }
        const update = () => {
            const remaining = Math.max(0, Math.floor((ts - Date.now()) / 1000));
            const minutes = String(Math.floor(remaining / 60)).padStart(2, '0');
            const seconds = String(remaining % 60).padStart(2, '0');
            expiryEl.textContent = `Expires in ${minutes}:${seconds}`;
            if (remaining <= 0 && expiryTimer) {
                clearInterval(expiryTimer);
            }
        };
        update();
        expiryTimer = setInterval(update, 1000);
    }

    return {
        overlay,
        setStatus(text) {
            statusEl.textContent = text;
        },
        setProgress(percent) {
            progressEl.style.width = `${Math.min(Math.max(percent, 0), 100)}%`;
        },
        setCode(value) {
            codeArea.value = value;
        },
        showQRCode(text) {
            clearQRCode(qrContainer);
            renderQRCode(qrContainer, text, DEFAULT_SIZE);
        },
        setExpiry(timestamp) {
            updateExpiry(timestamp);
        },
        showScannerMessage(message) {
            onStarted?.(message);
        },
        close() {
            stopScanner();
            overlay.remove();
        }
    };
}
