import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "./crypto";

describe("crypto (AES-256-GCM secret at rest)", () => {
  it("round-trips a secret", () => {
    const secret = "bunny-api-key-abc123";
    expect(decryptSecret(encryptSecret(secret))).toBe(secret);
  });

  it("produces a fresh IV each time (ciphertext differs for the same plaintext)", () => {
    expect(encryptSecret("same")).not.toBe(encryptSecret("same"));
  });

  it("rejects a tampered ciphertext (GCM auth tag)", () => {
    const payload = encryptSecret("secret");
    const [iv, tag, data] = payload.split(".");
    const flipped = data.slice(0, -1) + (data.endsWith("A") ? "B" : "A");
    expect(() => decryptSecret(`${iv}.${tag}.${flipped}`)).toThrow();
  });

  it("rejects a malformed payload", () => {
    expect(() => decryptSecret("not-a-valid-payload")).toThrow();
  });
});
