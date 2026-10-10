import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * Password hashing for the local (offline) provider.
 *
 * scrypt with parameters recorded inside the encoded value, so the cost can be raised later without
 * invalidating existing hashes: verification reads N, r and p from the stored string rather than
 * assuming today's settings.
 *
 * Format: scrypt$N$r$p$<salt base64>$<hash base64>
 *
 * This module is only used by the local provider. Under Supabase, credentials live in GoTrue's
 * auth.users and the application never handles a password hash.
 */

const PARAMS = { N: 16384, r: 8, p: 1 } as const;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

function normalise(password: string): string {
  // Unicode normalisation so a password typed on one platform verifies on another.
  return password.normalize("NFKC");
}

export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_LENGTH);
  const hash = scryptSync(normalise(password), salt, KEY_LENGTH, PARAMS);
  return [
    "scrypt",
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString("base64"),
    hash.toString("base64"),
  ].join("$");
}

/**
 * Constant-time verification. Returns false rather than throwing on a malformed stored value, so a
 * corrupt row cannot be distinguished from a wrong password by timing or by an error message.
 */
export function verifyPassword(password: string, encoded: string | null | undefined): boolean {
  if (!encoded) return false;
  const parts = encoded.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltB64, hashB64] = parts;
  const cost = { N: Number(n), r: Number(r), p: Number(p) };
  if (!Number.isFinite(cost.N) || !Number.isFinite(cost.r) || !Number.isFinite(cost.p)) return false;
  try {
    const salt = Buffer.from(saltB64, "base64");
    const expected = Buffer.from(hashB64, "base64");
    if (salt.length === 0 || expected.length === 0) return false;
    const actual = scryptSync(normalise(password), salt, expected.length, cost);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
