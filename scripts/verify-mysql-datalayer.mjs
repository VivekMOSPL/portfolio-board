// Proves the application's own MySQL data driver works against local MySQL, not just the raw SQL.
//
//   npm run mysql:datalayer
//
// This imports lib/db/mysql.ts — the same module the server would use — and drives it as each seeded
// role. It asserts that the data the application receives is already scoped: an RM cannot reach
// another RM's client, and nobody can reach another business, whatever they ask for.
//
// The unit under test is the adapter, so a failure here means the application would leak data even
// though the database is correct.

import { mysqlDriver, closeMysqlPool, mysqlStatus } from "../lib/db/mysql.ts";

const ids = {
  platform: "20000000-0000-4000-8000-000000000001",
  adminA: "20000000-0000-4000-8000-000000000002",
  managerA: "20000000-0000-4000-8000-000000000003",
  rm1A: "20000000-0000-4000-8000-000000000004",
  rm2A: "20000000-0000-4000-8000-000000000005",
  auditorA: "20000000-0000-4000-8000-000000000006",
  adminB: "20000000-0000-4000-8000-000000000007",
  rmB: "20000000-0000-4000-8000-000000000008",
  stranger: "20000000-0000-4000-8000-00000000dead",
};
const tenantA = "10000000-0000-4000-8000-00000000000a";
const tenantB = "10000000-0000-4000-8000-00000000000b";

const status = mysqlStatus();
console.log("MySQL data-layer verification");
console.log(`  ${status.host}:${status.port}/${status.database} as ${status.user} (password ${status.password})`);
console.log("");

let failures = 0;
function check(name, ok, detail = "") {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? "  -> " + detail : ""}`);
}

// ---------------------------------------------------------------- the adapter must refuse a missing actor

try {
  mysqlDriver("");
  check("driver refuses to be built without an actor", false, "no error raised");
} catch {
  check("driver refuses to be built without an actor", true);
}

// ---------------------------------------------------------------- session payload

const rmSession = await mysqlDriver(ids.rm1A).rpc("cb_session");
check("cb_session returns the user id", rmSession.user_id === ids.rm1A, JSON.stringify(rmSession.user_id));
check("cb_session reports platform false for an RM", rmSession.platform === false);
check("cb_session returns exactly one membership", rmSession.memberships.length === 1);
check(
  "membership carries the tenant name and timezone",
  rmSession.memberships[0].tenant_name === "IDash — Datachron Solutions" &&
    rmSession.memberships[0].timezone === "Asia/Kolkata",
);

const platformSession = await mysqlDriver(ids.platform).rpc("cb_session");
check("cb_session reports platform true for the platform admin", platformSession.platform === true);
check("the platform admin holds no membership of its own", platformSession.memberships.length === 0);

// ---------------------------------------------------------------- the real test: is the data scoped?

async function clientsVisibleTo(actor, tenant) {
  const page = await mysqlDriver(actor).rpc("cb_client_page", {
    p_tenant: tenant,
    p_search: "",
    p_offset: 0,
    p_size: 100,
  });
  return page;
}

const rmOwn = await clientsVisibleTo(ids.rm1A, tenantA);
check("RM sees exactly one client in their own business", rmOwn.total === 1 && rmOwn.rows.length === 1, `total ${rmOwn.total}`);
check("and it is the one they own", rmOwn.rows[0]?.code === "A-1001", JSON.stringify(rmOwn.rows.map((r) => r.code)));

const rmCross = await clientsVisibleTo(ids.rm1A, tenantB);
check("RM sees nothing in another business", rmCross.total === 0 && rmCross.rows.length === 0, `total ${rmCross.total}`);

const otherRm = await clientsVisibleTo(ids.rm2A, tenantA);
check("a second RM sees only their own client", otherRm.total === 1 && otherRm.rows[0]?.code === "A-1002", JSON.stringify(otherRm.rows.map((r) => r.code)));

const manager = await clientsVisibleTo(ids.managerA, tenantA);
check("the manager sees only their team's client", manager.total === 1 && manager.rows[0]?.code === "A-1001", `total ${manager.total}`);

const admin = await clientsVisibleTo(ids.adminA, tenantA);
check("the business admin sees every client in the tenant", admin.total === 3, `total ${admin.total}`);

const auditor = await clientsVisibleTo(ids.auditorA, tenantA);
check("the auditor can read the tenant's clients", auditor.total === 3, `total ${auditor.total}`);

const outsider = await clientsVisibleTo(ids.stranger, tenantA);
check("someone with no membership sees nothing", outsider.total === 0 && outsider.rows.length === 0, `total ${outsider.total}`);

const tenantBRmInA = await clientsVisibleTo(ids.rmB, tenantA);
check("a business B RM sees nothing in business A", tenantBRmInA.total === 0, `total ${tenantBRmInA.total}`);

// ---------------------------------------------------------------- platform console is metadata only

const platformTenants = await mysqlDriver(ids.platform).rpc("cb_tenant_list");
check("the platform admin lists both businesses", Array.isArray(platformTenants) && platformTenants.length === 2, `got ${JSON.stringify(platformTenants)?.slice(0, 80)}`);
check(
  "the platform listing carries no client counts",
  Array.isArray(platformTenants) && platformTenants.every((t) => !("clients" in t) && !("followups" in t)),
);

const nonPlatformTenants = await mysqlDriver(ids.adminA).rpc("cb_tenant_list");
check(
  "a business admin gets no platform listing",
  Array.isArray(nonPlatformTenants) && nonPlatformTenants.length === 0,
  JSON.stringify(nonPlatformTenants),
);

// ---------------------------------------------------------------- adapter integrity

const missingArg = await mysqlDriver(ids.rm1A)
  .rpc("cb_client_page", { p_tenant: tenantA })
  .then(() => null)
  .catch((e) => e.message);
check("a call missing a required parameter is refused, not run with null", typeof missingArg === "string" && /requires/.test(missingArg), String(missingArg));

const unknownFn = await mysqlDriver(ids.rm1A)
  .rpc("cb_does_not_exist")
  .then(() => null)
  .catch((e) => e.message);
check("an unknown routine is refused", typeof unknownFn === "string" && /does not exist/.test(unknownFn), String(unknownFn));

await closeMysqlPool();

console.log("");
if (failures) {
  console.log(`MYSQL DATA LAYER FAILED: ${failures} check(s) failed`);
  process.exit(1);
}
console.log("MYSQL DATA LAYER VERIFIED");
