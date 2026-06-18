import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { env } from "../config/env";

/**
 * AES-256-GCM encrypt/decrypt for provider secrets that must be replayable
 * (e.g. the Bunny API key — unlike stream keys it can't be one-way hashed, since
 * we have to present it back to Bunny on every API call). Keyed by APP_SECRET.
 *
 * Wire format (all base64url, dot-separated):  iv.authTag.ciphertext
 */

const ALGO = "aes-256-gcm";
const IV_BYTES = 12; // 96-bit nonce, the GCM standard

/** Derive a stable 32-byte key from APP_SECRET (any length) via SHA-256. */
function key(): Buffer {
  if (!env.appSecret) {
    throw new Error("APP_SECRET is not set — cannot encrypt/decrypt provider secrets");
  }
  return createHash("sha256").update(env.appSecret).digest();
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv, authTag, ciphertext].map((b) => b.toString("base64url")).join(".");
}

export function decryptSecret(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split(".");
  if (!ivB64 || !tagB64 || !dataB64) throw new Error("malformed encrypted secret");
  const decipher = createDecipheriv(ALGO, key(), Buffer.from(ivB64, "base64url"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64url")), decipher.final()]).toString("utf8");
}
