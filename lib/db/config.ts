import fs from "node:fs";
import path from "node:path";
import { readEnv } from "../env";

/**
 * Database provider selection.
 *
 * config/database.json names the provider and the environment variables that carry its settings.
 * It deliberately holds no credential: values are read from the environment, so this file is safe to
 * commit and a provider can be switched without editing source.
 *
 * The two providers are not equivalent. Supabase enforces tenant and record scope in the database
 * with row level security and security definer functions, and supplies authentication. MySQL has
 * neither, so the same guarantees have to come from explicit predicates passed an acting user. See
 * mysql/README.md. Nothing here may be used to claim the providers offer the same protection.
 */

export type ProviderName = "supabase" | "mysql";

type SettingSpec = {
  env: string;
  required?: boolean;
  secret?: boolean;
  default?: string | number;
};

type ProviderSpec = {
  label: string;
  driver: string;
  supportsAuth: boolean;
  supportsRowLevelSecurity: boolean;
  notes?: string;
  settings: Record<string, SettingSpec>;
};

type ConfigFile = {
  provider: string;
  providers: Record<string, ProviderSpec>;
};

let cache: ConfigFile | null = null;

function config(): ConfigFile {
  if (cache) return cache;
  const file = path.join(process.cwd(), "config", "database.json");
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as ConfigFile;
  if (!parsed.providers?.[parsed.provider]) {
    throw new Error(`config/database.json names an unknown provider: ${parsed.provider}`);
  }
  cache = parsed;
  return cache;
}

/** DB_PROVIDER overrides the file, so a deployment can switch without a code change. */
export function activeProvider(): ProviderName {
  const name = (readEnv("DB_PROVIDER") || config().provider) as ProviderName;
  if (!config().providers[name]) {
    throw new Error(`DB_PROVIDER names an unknown provider: ${name}`);
  }
  return name;
}

export function providerSpec(name: ProviderName = activeProvider()): ProviderSpec {
  return config().providers[name];
}

export function providerNames(): ProviderName[] {
  return Object.keys(config().providers) as ProviderName[];
}

/** Reads a provider setting from the environment, falling back to the documented default. */
export function setting(name: string, provider: ProviderName = activeProvider()): string | undefined {
  const spec = providerSpec(provider).settings[name];
  if (!spec) throw new Error(`unknown setting ${name} for provider ${provider}`);
  const value = readEnv(spec.env);
  if (value !== undefined && value !== "") return value;
  return spec.default === undefined ? undefined : String(spec.default);
}

/** Names of required provider settings that are absent. Values are never returned. */
export function missingProviderSettings(provider: ProviderName = activeProvider()): string[] {
  const spec = providerSpec(provider);
  return Object.keys(spec.settings).filter((name) => {
    const entry = spec.settings[name];
    if (!entry.required) return false;
    return setting(name, provider) === undefined;
  });
}

/** Provider summary for diagnostics. Secrets are reduced to a presence flag. */
export function describeProvider(provider: ProviderName = activeProvider()) {
  const spec = providerSpec(provider);
  const resolved: Record<string, string> = {};
  for (const [name, entry] of Object.entries(spec.settings)) {
    const value = setting(name, provider);
    resolved[name] = entry.secret ? (value ? "set" : "missing") : (value ?? "missing");
  }
  return {
    provider,
    label: spec.label,
    driver: spec.driver,
    supportsAuth: spec.supportsAuth,
    supportsRowLevelSecurity: spec.supportsRowLevelSecurity,
    settings: resolved,
  };
}
