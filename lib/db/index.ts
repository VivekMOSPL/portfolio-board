import { activeProvider, describeProvider, missingProviderSettings, providerNames, providerSpec, setting } from "./config";
import { mysqlDriver, mysqlStatus, closeMysqlPool, type DataDriver } from "./mysql";

export {
  activeProvider,
  closeMysqlPool,
  describeProvider,
  missingProviderSettings,
  mysqlStatus,
  providerNames,
  providerSpec,
  setting,
};
export type { DataDriver };

/**
 * Returns a data driver bound to one authenticated user.
 *
 * Under the Supabase provider the driver is built from the request's session tokens in lib/server.ts,
 * because PostgREST carries the user's JWT and PostgreSQL resolves auth.uid() from it. Under MySQL
 * there is no JWT, so the resolved user id is passed here and every routine receives it as p_actor.
 *
 * The actor must come from a verified session. Passing a value taken from a request body would let a
 * caller act as anyone.
 */
export function dataDriverFor(actor: string | null): DataDriver {
  const provider = activeProvider();
  if (provider === "mysql") {
    if (!actor) throw new Error("MySQL provider requires an authenticated actor");
    return mysqlDriver(actor);
  }
  throw new Error(
    "The supabase data driver is constructed from the request session in lib/server.ts, not here",
  );
}
