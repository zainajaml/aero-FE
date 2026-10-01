import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * AES-256-GCM envelope for Jira OAuth credentials, byte-compatible with the source app's
 * WebCrypto implementation:
 *
 *     v1.<base64url(iv)>.<base64url(ciphertext || 16-byte tag)>
 *
 * The key is SHA-256 of the trimmed secret, so any encoding of at least 32 characters works.
 * Values that are not an envelope are rejected (no legacy plaintext fallback). Errors never
 * contain the key or the credential.
 */
const VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;

export class CredentialDecryptError extends Error {
  constructor() {
    super("Stored Jira credentials could not be decrypted. Reconnect Jira to continue.");
    this.name = "CredentialDecryptError";
  }
}

export type CredentialCipher = {
  encrypt(plaintext: string): string;
  decrypt(envelope: string): string;
};

export function isEncryptedCredential(value: string | null | undefined): boolean {
  if (!value) return false;
  const parts = value.split(".");
  return parts.length === 3 && parts[0] === VERSION && !!parts[1] && !!parts[2];
}

export function createCredentialCipher(secret: string): CredentialCipher {
  const key = createHash("sha256").update(secret.trim(), "utf8").digest();
  return {
    encrypt(plaintext) {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
      const sealed = Buffer.concat([body, cipher.getAuthTag()]);
      return `${VERSION}.${iv.toString("base64url")}.${sealed.toString("base64url")}`;
    },
    decrypt(envelope) {
      if (!isEncryptedCredential(envelope)) throw new CredentialDecryptError();
      const [, ivPart, dataPart] = envelope.split(".") as [string, string, string];
      try {
        const iv = Buffer.from(ivPart, "base64url");
        const sealed = Buffer.from(dataPart, "base64url");
        if (iv.length !== IV_BYTES || sealed.length < TAG_BYTES) throw new Error("bad envelope");
        const decipher = createDecipheriv("aes-256-gcm", key, iv);
        decipher.setAuthTag(sealed.subarray(sealed.length - TAG_BYTES));
        return Buffer.concat([
          decipher.update(sealed.subarray(0, sealed.length - TAG_BYTES)),
          decipher.final(),
        ]).toString("utf8");
      } catch {
        throw new CredentialDecryptError();
      }
    },
  };
}
