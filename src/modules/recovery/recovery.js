/**
 * Recovery Service
 * Manages account recovery methods (backup codes, recovery file, secret questions)
 * Privacy-first: No mandatory email/phone required
 */

import { cryptoService } from '../../crypto/crypto.js';
import { storageService } from '../../storage/db.js';
import { Utils } from '../../utils/helpers.js';

class RecoveryService {
    constructor() {
        this.backupCodes = [];
        this.secretQuestion = null;
    }

    /**
     * Generate 10 cryptographically random backup codes
     * Format: XXXX-XXXX-XXXX-XXXX
     */
    async generateBackupCodes() {
        const codes = [];
        for (let i = 0; i < 10; i++) {
            const randomBytes = crypto.getRandomValues(new Uint8Array(8));
            const code = Array.from(randomBytes)
                .map(byte => byte.toString(16).padStart(2, '0'))
                .join('')
                .toUpperCase()
                .match(/.{1,4}/g)
                .join('-');
            codes.push(code);
        }

        // Hash codes before storing
        const hashedCodes = await Promise.all(
            codes.map(async code => ({
                hash: await this.hashCode(code),
                used: false,
                createdAt: Date.now()
            }))
        );

        // Store hashed codes in IndexedDB
        await storageService.saveRecoveryMethod('backup_codes', {
            codes: hashedCodes,
            createdAt: Date.now()
        });

        this.backupCodes = codes; // Keep plaintext temporarily for display
        return codes;
    }

    /**
     * Hash a backup code using SHA-256
     */
    async hashCode(code) {
        const encoder = new TextEncoder();
        const data = encoder.encode(code);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        return Utils.bufferToHex(hashBuffer);
    }

    /**
     * Verify a backup code
     */
    async verifyBackupCode(inputCode) {
        const stored = await storageService.getRecoveryMethod('backup_codes');
        if (!stored || !stored.codes) return false;

        const inputHash = await this.hashCode(inputCode);

        // Find matching unused code
        const codeIndex = stored.codes.findIndex(
            c => c.hash === inputHash && !c.used
        );

        if (codeIndex === -1) return false;

        // Mark code as used
        stored.codes[codeIndex].used = true;
        stored.codes[codeIndex].usedAt = Date.now();
        await storageService.saveRecoveryMethod('backup_codes', stored);

        return true;
    }

    /**
     * Generate recovery file (encrypted vault key backup)
     */
    async generateRecoveryFile(vaultKey) {
        if (!vaultKey) throw new Error('Vault key required');

        // Export vault key
        const exportedKey = await crypto.subtle.exportKey('raw', vaultKey);

        // Create recovery file structure
        const recoveryData = {
            version: '1.0',
            type: 'pinbridge-recovery',
            createdAt: Date.now(),
            vaultKey: Utils.bufferToBase64(exportedKey)
        };

        // Convert to JSON and create downloadable blob
        const json = JSON.stringify(recoveryData, null, 2);
        const blob = new Blob([json], { type: 'application/json' });

        // Mark recovery file as created
        await storageService.saveRecoveryMethod('recovery_file', {
            createdAt: Date.now(),
            downloaded: true
        });

        return blob;
    }

    /**
     * Import recovery file
     */
    async importRecoveryFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();

            reader.onload = async (e) => {
                try {
                    const data = JSON.parse(e.target.result);

                    // Validate structure
                    if (data.type !== 'pinbridge-recovery' || !data.vaultKey) {
                        throw new Error('Invalid recovery file');
                    }

                    // Import vault key
                    const keyBuffer = Utils.base64ToBuffer(data.vaultKey);
                    const vaultKey = await cryptoService.importRawKey(keyBuffer);

                    resolve(vaultKey);
                } catch (err) {
                    reject(err);
                }
            };

            reader.onerror = () => reject(new Error('Failed to read file'));
            reader.readAsText(file);
        });
    }

    /**
     * Setup secret question
     */
    async setupSecretQuestion(question, answer) {
        if (!question || !answer) {
            throw new Error('Question and answer required');
        }

        // Hash the answer (case-sensitive)
        const answerHash = await this.hashCode(answer);

        const secretData = {
            question,
            answerHash,
            createdAt: Date.now()
        };

        await storageService.saveRecoveryMethod('secret_question', secretData);
        this.secretQuestion = { question, hasAnswer: true };

        return true;
    }

    /**
     * Verify secret question answer
     */
    async verifySecretAnswer(answer) {
        const stored = await storageService.getRecoveryMethod('secret_question');
        if (!stored || !stored.answerHash) return false;

        const inputHash = await this.hashCode(answer);
        return inputHash === stored.answerHash;
    }

    /**
     * Get all active recovery methods
     */
    async getActiveRecoveryMethods() {
        const methods = [];

        // Check backup codes
        const backupCodes = await storageService.getRecoveryMethod('backup_codes');
        if (backupCodes && backupCodes.codes) {
            const unusedCount = backupCodes.codes.filter(c => !c.used).length;
            methods.push({
                type: 'backup_codes',
                name: 'Backup Codes',
                icon: '🎫',
                status: `${unusedCount}/10 remaining`,
                createdAt: backupCodes.createdAt
            });
        }

        // Check recovery file
        const recoveryFile = await storageService.getRecoveryMethod('recovery_file');
        if (recoveryFile && recoveryFile.downloaded) {
            methods.push({
                type: 'recovery_file',
                name: 'Recovery File',
                icon: '💾',
                status: 'Downloaded',
                createdAt: recoveryFile.createdAt
            });
        }

        // Check secret question
        const secretQuestion = await storageService.getRecoveryMethod('secret_question');
        if (secretQuestion && secretQuestion.question) {
            methods.push({
                type: 'secret_question',
                name: 'Secret Question',
                icon: '❓',
                status: 'Active',
                createdAt: secretQuestion.createdAt,
                question: secretQuestion.question
            });
        }

        return methods;
    }

    /**
     * Remove a recovery method
     */
    async removeRecoveryMethod(type) {
        await storageService.deleteRecoveryMethod(type);
    }
}

export const recoveryService = new RecoveryService();
