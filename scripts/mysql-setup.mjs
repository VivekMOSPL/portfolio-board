// Creates and seeds the MySQL provider database, then runs the isolation assertions.
//
//   npm run db:mysql:setup     create the database, apply 001-003, grant the application user
//   npm run db:mysql:checks    run the 25 isolation assertions in 004
//
// Connection settings come from config/database.json. Passwords are read from the environment and
// never appear on a command line.
//
// Schema and routine creation runs on an administrative account. That is not a convenience: MySQL
// requires SYSTEM_USER to create a routine while binary logging is enabled, and the application
// account deliberately must not hold it. Because the routines are then owned by the administrator and
// default to SQL SECURITY DEFINER, the application can be given EXECUTE without any direct table
// access, which is what makes the scope-enforcing procedures the only path to the data.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";

const here = path.dirname(fileURLToPath(import.meta.url));
const mysqlDir = path.join(here, "..", "mysql");

const SETUP_FILES = ["001_schema.sql", "002_authorization.sql", "003_seed.sql", "005_app_functions.sql", "006_local_auth.sql", "007_read_page.sql"];
const CHECK_FILE = "004_isolation_checks.sql";

const MODE = process.argv.includes("--checks") ? "checks" : "setup";

const config = JSON.parse(
  fs.readFileSync(path.join(here, "..", "config", "database.json"), "utf8"),
);
const spec = config.providers.mysql;
const setting = (name) => {
  const entry = spec.settings[name];
  if (!entry) throw new Error(`config/database.json has no mysql setting named ${name}`);
  const raw = process.env[entry.env];
  if (raw !== undefined && raw !== "") return raw;
  return entry.default === undefined ? undefined : String(entry.default);
};

const host = setting("host");
const port = Number(setting("port"));
const database = setting("database");
const appUser = setting("user");
const adminUser = setting("adminUser");
const adminPassword = process.env[spec.settings.adminPassword.env] ?? "";

if (!setting("password")) {
  console.error("BLOCKED: missing MYSQL_PASSWORD. Set it in .env.local, then re-run.");
  process.exit(1);
}

const admin = await mysql.createConnection({
  host,
  port,
  user: adminUser,
  password: adminPassword,
  multipleStatements: true,
});

function meaningfulLines(sql) {
  return sql.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith("--")).length;
}

async function applyFile(file) {
  const sql = fs.readFileSync(path.join(mysqlDir, file), "utf8");
  process.stdout.write(`  ${file.padEnd(28)} ${String(meaningfulLines(sql)).padStart(4)} lines ... `);
  await admin.query(`use \`${database}\``);
  await admin.query(sql);
  console.log("ok");
}

console.log(`MySQL provider â€” ${MODE}`);
console.log(`  target: ${host}:${port}/${database}  (schema as ${adminUser}, application as ${appUser})`);

/**
 * Proves the boundary the application actually runs against: it cannot read a base table, and it can
 * still read through a procedure that applies the scope predicate. If the first check ever starts
 * passing as "allowed", the tenant guarantee has been lost regardless of what the isolation checks say.
 */
async function verifyApplicationBoundary() {
  const app = await mysql.createConnection({
    host,
    port,
    user: appUser,
    password: setting("password"),
    database,
  });
  const checks = [];

  let refused = false;
  try {
    await app.query("select count(*) from cb_clients");
  } catch (error) {
    refused = /denied|1142|1143/i.test(String(error.message));
  }
  checks.push(["application user cannot read a base table directly", refused]);

  const rm1 = "20000000-0000-4000-8000-000000000004";
  const tenantA = "10000000-0000-4000-8000-00000000000a";
  const tenantB = "10000000-0000-4000-8000-00000000000b";

  async function readThroughProcedure(actor, tenant) {
    const [result] = await app.query("call cb_read_clients(?,?,?,?,?)", [actor, tenant, "", 0, 50]);
    const rows = Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result;
    return Array.isArray(rows) ? rows : [];
  }

  const own = await readThroughProcedure(rm1, tenantA).catch(() => null);
  checks.push([
    "an RM reads exactly their own client through the procedure",
    own !== null && own.length === 1 && own[0].code === "A-1001",
  ]);

  const cross = await readThroughProcedure(rm1, tenantB).catch(() => []);
  checks.push(["the same RM reads nothing in another business", cross.length === 0]);

  const admin = await readThroughProcedure("20000000-0000-4000-8000-000000000002", tenantA).catch(() => []);
  checks.push(["the business admin reads every client in the tenant", admin.length === 3]);

  console.log("");
  console.log("  application boundary:");
  let failed = 0;
  for (const [name, ok] of checks) {
    if (!ok) failed++;
    console.log(`    ${ok ? "PASS" : "FAIL"}  ${name}`);
  }
  await app.end();
  if (failed) {
    console.log(`  APPLICATION BOUNDARY FAILURE (${failed} of ${checks.length})`);
    process.exitCode = 1;
  }
}

try {
  if (MODE === "setup") {
    await admin.query(
      `create database if not exists \`${database}\` character set utf8mb4 collate utf8mb4_0900_ai_ci`,
    );
    console.log(`  database ${database}: ready`);

    for (const file of SETUP_FILES) await applyFile(file);

    // The application gets no direct read access to the base tables. Because the read procedures are
    // owned by the administrator and run as SQL SECURITY DEFINER, they still work â€” so the only path
    // to client data is a routine that applies the scope predicate. A direct select is refused by the
    // engine, which is the guarantee PostgreSQL provided with row level security.
    for (const host_ of ["127.0.0.1", "localhost"]) {
      await admin.query(
        `grant insert, update, delete, execute on \`${database}\`.* to '${appUser}'@'${host_}'`,
      );
    }
    await admin.query("flush privileges");
    console.log(`  granted ${appUser}: insert, update, delete, execute; no SELECT, no DDL`);

    const [inventory] = await admin.query(`
      select
        (select count(*) from information_schema.tables where table_schema = database() and table_type='BASE TABLE') as tables,
        (select count(*) from information_schema.triggers where trigger_schema = database()) as triggers,
        (select count(*) from information_schema.routines where routine_schema = database() and routine_type='FUNCTION') as functions,
        (select count(*) from information_schema.routines where routine_schema = database() and routine_type='PROCEDURE') as procedures
    `);
    const [rows] = await admin.query(`
      select 'tenants' as entity, count(*) as n from cb_tenants
      union all select 'accounts', count(*) from cb_accounts
      union all select 'members', count(*) from cb_members
      union all select 'teams', count(*) from cb_teams
      union all select 'clients', count(*) from cb_clients
      union all select 'followups', count(*) from cb_followups
      union all select 'timeline', count(*) from cb_timeline
    `);
    console.log("");
    console.log(`  objects: ${inventory[0].tables} tables, ${inventory[0].triggers} triggers, ` +
      `${inventory[0].functions} functions, ${inventory[0].procedures} procedures`);
    for (const r of rows) console.log(`  ${r.entity.padEnd(12)} ${r.n}`);
    console.log("");
    console.log("SETUP COMPLETE. Next: npm run db:mysql:checks");
    await verifyApplicationBoundary();
  } else {
    await admin.query(`use \`${database}\``);
    await admin.query(fs.readFileSync(path.join(mysqlDir, CHECK_FILE), "utf8"));

    const [rows] = await admin.query(`
      select count(*) as total,
             sum(if(expected = actual, 1, 0)) as passed,
             sum(if(expected = actual, 0, 1)) as failed
      from cb_checks
    `);
    const summary = rows[0];
    console.log("");
    console.log(`  total ${summary.total}   passed ${summary.passed}   failed ${summary.failed}`);
    if (Number(summary.failed) !== 0) {
      const [bad] = await admin.query(
        "select check_name, expected, actual from cb_checks where expected <> actual order by seq",
      );
      for (const b of bad) console.log(`  FAIL ${b.check_name}: expected ${b.expected}, got ${b.actual}`);
      console.log("ISOLATION FAILURE");
      process.exitCode = 1;
    } else {
      console.log("ALL ISOLATION CHECKS PASSED");
    }
    await admin.query("drop temporary table if exists cb_checks");
  }
} catch (error) {
  console.error("");
  console.error(`FAILED: ${error.message}`);
  process.exitCode = 1;
} finally {
  await admin.end();
}
