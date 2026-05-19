import CryptoJS from 'crypto-js';
import { v4 as uuidv4 } from 'uuid';

// NOTE: For Phase 1 we use symmetric AES encryption via crypto-js. This
// service provides a small, explicit API for generating and deriving keys so
// future phases (public-key exchange) can be integrated without changing the
// encrypt/decrypt contract.
//
// SECURITY: All encrypt/decrypt operations require an explicit key parameter.
// There is intentionally no default key to prevent accidental use of weak keys.

export type EncryptedEnvelope = {
    id: string;
    checksum: string;
    ciphertext: string;
    timestamp: number;
    senderId: string;
    recipientId: string | 'broadcast';

    // Routing metadata for multi-hop mesh relay
    hops: string[];       // device IDs that forwarded the message
    relayCount: number;   // number of hops so far
    ttl: number;          // time-to-live (max hops before message is dropped)
};

export const CryptoService = {
    // Generate a random 256-bit symmetric key encoded as Base64
    generateSymmetricKey(): string {
        const wordArray = CryptoJS.lib.WordArray.random(32); // 32 bytes = 256 bits
        return wordArray.toString(CryptoJS.enc.Base64);
    },

    // Derive a symmetric key from a passphrase using PBKDF2
    deriveKeyFromPassphrase(passphrase: string, salt?: string, iterations = 10000): string {
        const actualSalt = salt ? CryptoJS.enc.Base64.parse(salt) : CryptoJS.lib.WordArray.random(16);
        const derived = CryptoJS.PBKDF2(passphrase, actualSalt, { keySize: 256 / 32, iterations });
        return derived.toString(CryptoJS.enc.Base64);
    },

    // Initialize device key: check storage, generate if missing, and persist
    async initializeDeviceKey(storage: { getDeviceKey: () => Promise<string | null>; setDeviceKey: (key: string) => Promise<void> }): Promise<string> {
        const existing = await storage.getDeviceKey();
        if (existing) {
            return existing;
        }
        const newKey = this.generateSymmetricKey();
        await storage.setDeviceKey(newKey);
        return newKey;
    },

    encryptMessage(plain: { text: string; senderId: string; recipientId: string | 'broadcast' }, key: string): EncryptedEnvelope {
        if (!key) throw new Error('[CryptoService] Encryption key is required. Call initializeDeviceKey() first.');
        const id = uuidv4();
        const timestamp = Date.now();
        const payload = JSON.stringify({ id, text: plain.text, timestamp, senderId: plain.senderId, recipientId: plain.recipientId });
        const ciphertext = CryptoJS.AES.encrypt(payload, key).toString();
        const checksum = CryptoJS.SHA256(ciphertext).toString();
        return { id, checksum, ciphertext, timestamp, senderId: plain.senderId, recipientId: plain.recipientId, hops: [], relayCount: 0, ttl: 8 };
    },

    decryptMessage(envelope: EncryptedEnvelope, key: string): { id: string; text: string; timestamp: number; senderId: string; recipientId: string | 'broadcast' } | null {
        if (!key) throw new Error('[CryptoService] Decryption key is required. Call initializeDeviceKey() first.');
        const checksum = CryptoJS.SHA256(envelope.ciphertext).toString();
        if (checksum !== envelope.checksum) return null;
        try {
            const bytes = CryptoJS.AES.decrypt(envelope.ciphertext, key);
            const json = bytes.toString(CryptoJS.enc.Utf8);
            return JSON.parse(json);
        } catch (e) {
            return null;
        }
    },
};
