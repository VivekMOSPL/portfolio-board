import { createHash, randomBytes } from "node:crypto";

/**
 * Integration credentials for an external system (IDash-App).
 *
 * A key is 32 random bytes, base64url encoded. Only its SHA-256 hash is stored, so the plaintext
 * exists exactly once, at issue time. Verification is a lookup by the hash of a 256-bit random
 * secret; that does not permit a practical timing attack, so no plaintext comparison happens
 * anywhere and no key is ever written to a log or returned again.
 */
export function issueIntegrationKey(): string {
  return randomBytes(32).toString("base64url");
}

export function hashIntegrationKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

/** Extracts the token from an `Authorization: Bearer <key>` header. Returns "" when absent. */
export function bearerKey(header: string | null | undefined): string {
  const match = /^Bearer\s+(.+)$/i.exec((header ?? "").trim());
  return match ? match[1].trim() : "";
}
