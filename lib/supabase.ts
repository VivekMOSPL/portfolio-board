import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type Outcome = "called" | "met" | "waiting" | "lost";

export type Followup = {
  id: string;
  created_at: string;
  client_name: string;
  advisor: string;
  reason: string;
  value_at_risk_paise: number;
  outcome: Outcome;
  outcome_updated_at: string;
};

export const OUTCOMES: { value: Outcome; label: string }[] = [
  { value: "called", label: "Called" },
  { value: "met", label: "Met" },
  { value: "waiting", label: "Waiting" },
  { value: "lost", label: "Lost" },
];

const URL_KEY = "NEXT_PUBLIC_SUPABASE_URL";
const KEY_KEY = "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY";

function usable(value: string | undefined): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  return trimmed.length > 0 && !trimmed.includes("[") && !trimmed.includes("]");
}

/**
 * Returns the names of any missing/placeholder settings, or null when both are set.
 * The names are shown on screen so a missing setting is never confused with an
 * empty table or a failed call.
 */
export function missingSettings(): string[] {
  const missing: string[] = [];
  if (!usable(process.env.NEXT_PUBLIC_SUPABASE_URL)) missing.push(URL_KEY);
  if (!usable(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)) missing.push(KEY_KEY);
  return missing;
}

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (client) return client;
  const missing = missingSettings();
  if (missing.length > 0) {
    throw new Error(`Missing settings: ${missing.join(", ")}`);
  }
  client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string,
  );
  return client;
}
