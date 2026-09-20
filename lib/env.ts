/**
 * Runtime configuration access.
 *
 * Next.js replaces a statically written `process.env.NEXT_PUBLIC_*` with whatever value existed at
 * build time. A deployment built before those variables were set therefore has `undefined` compiled
 * into it, and no host setting can repair that at runtime — which is exactly how
 * "Authentication is not configured" survives a correctly configured project. Reading through a
 * variable name is left alone by the compiler and resolves against the real runtime environment.
 */
export function readEnv(name: string): string | undefined {
  return process.env[name];
}

export const REQUIRED_CONFIG = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "CRON_SECRET",
  "APP_URL",
] as const;

/** Names of required settings that are absent or still hold a placeholder. Values are never returned. */
export function missingConfig(): string[] {
  return REQUIRED_CONFIG.filter((name) => {
    const value = readEnv(name);
    return !value || value.includes("[");
  });
}
