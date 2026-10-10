import { createHash, randomBytes, randomUUID } from "node:crypto";
import { AppError } from "../domain";
import { activeProvider, setting } from "../db/config";
import { mysqlDriver, mysqlCall, mysqlScalar } from "../db/mysql";
import { verifyPassword } from "./passwords";

/**
 * Local authentication for the offline provider.
 *
 * Supabase Auth is hosted and cannot work without internet. This module replaces exactly what the
 * application used from it — sign in, resolve a session, sign out, sign out everywhere — and nothing
 * more. Registration, email confirmation and password recovery are not reimplemented; on an offline
 * installation an operator provisions accounts, which is what scripts/seed-local-auth.mjs does.
 *
 * The session cookie carries an opaque 256-bit token. Only its SHA-256 is stored, so the database
 * never holds anything that can be replayed, and revocation is a row update that takes effect on the
 * next request.
 */

export const SESSION_COOKIE = "cb_access";
const SESSION_TTL_HOURS = 24 * 7;

export type LocalUser = { id: string; email: string };

function tokenHash(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function localAuthEnabled(): boolean {
  return activeProvider() === "mysql";
}

/**
 * Verifies credentials and issues a session.
 *
 * A missing account, a missing credential row and a wrong password all produce the same message, so
 * the response cannot be used to discover which email addresses exist. The lockout counter lives in
 * the database and is applied before the password is checked.
 */
export async function localSignIn(email: string, password: string, userAgent: string): Promise<{ token: string; user: LocalUser }> {
  if (!localAuthEnabled()) throw new AppError(503, "Local sign-in is not enabled for this provider.");

  const normalised = email.trim().toLowerCase();
  const credential = await mysqlScalar<{
    user_id: string;
    email: string;
    password_hash: string;
    locked_until: string | null;
    confirmed: boolean;
  }>("select cb_local_credential(?) as result", [normalised]);

  const invalid = new AppError(401, "Sign-in failed. Check your credentials or try again later.");
  if (!credential) throw invalid;

  if (credential.locked_until && new Date(credential.locked_until) > new Date()) {
    throw new AppError(429, "Too many attempts. Please try again in 15 minutes.");
  }

  if (!verifyPassword(password, credential.password_hash)) {
    await mysqlCall("cb_local_login_failed", [credential.user_id]);
    throw invalid;
  }

  await mysqlCall("cb_local_login_ok", [credential.user_id]);

  const token = randomBytes(32).toString("base64url");
  await mysqlCall("cb_local_session_create", [
    randomUUID(),
    credential.user_id,
    tokenHash(token),
    SESSION_TTL_HOURS,
    userAgent.slice(0, 200),
  ]);

  return { token, user: { id: credential.user_id, email: credential.email } };
}

/** Resolves a session cookie to its account, or returns null when unknown, revoked or expired. */
export async function localSession(token: string | undefined): Promise<{ user: LocalUser; session: string } | null> {
  if (!token) return null;
  const row = await mysqlScalar<{ user_id: string; email: string; session: string }>(
    "select cb_local_session_lookup(?) as result",
    [tokenHash(token)],
  );
  if (!row) return null;
  return { user: { id: row.user_id, email: row.email }, session: row.session };
}

export async function localSignOut(token: string | undefined, everywhere: boolean, userId?: string): Promise<void> {
  if (everywhere && userId) {
    await mysqlCall("cb_local_session_revoke_all", [userId]);
    return;
  }
  if (token) await mysqlCall("cb_local_session_revoke", [tokenHash(token)]);
}

/** The driver the server uses once a session is resolved. */
export function driverForUser(userId: string) {
  return mysqlDriver(userId);
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 60 * 60 * SESSION_TTL_HOURS,
  };
}

export function sessionTtlHours() {
  return SESSION_TTL_HOURS;
}

/** Diagnostics only; never returns a credential. */
export function localAuthStatus() {
  return {
    provider: activeProvider(),
    database: setting("database", "mysql"),
    sessionTtlHours: SESSION_TTL_HOURS,
  };
}
