// Applies supabase/migrations/*.sql to the hosted database, once, in filename order.
//
//   npm run db:plan      print what would run, change nothing
//   npm run db:migrate   apply the migrations
//
// Requires DATABASE_URL in .env.local. It is read from the environment, never printed,
// and never written into source, logs or the browser bundle.
//
// The migrations each wrap themselves in begin;/commit;. This runner strips that outer
// transaction so the migration body and its schema_migrations row commit atomically.
// A migration that fails rolls back whole, and nothing is recorded.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(here, "..", "supabase", "migrations");
const DRY_RUN = process.argv.includes("--dry-run");

function redact(connectionString) {
  try {
    const u = new URL(connectionString);
    return `${u.hostname}:${u.port || "5432"}${u.pathname} as ${u.username.replace(/:.*/, "")} (password hidden)`;
  } catch {
    return "(unparseable connection string)";
  }
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString || connectionString.trim() === "" || connectionString.includes("[")) {
  console.error("BLOCKED: missing server configuration: DATABASE_URL");
  console.error("  Add the Supabase pooler connection string to .env.local as DATABASE_URL=<uri>");
  console.error("  Supabase dashboard -> Connect -> Session pooler -> copy the URI, replace [YOUR-PASSWORD].");
  process.exit(1);
}

const files = fs
  .readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

if (files.length === 0) {
  console.error(`BLOCKED: no .sql files found in ${migrationsDir}`);
  process.exit(1);
}

// Take the outer begin;/commit; out of a migration so we control the transaction.
function stripOuterTransaction(sql) {
  const lines = sql.split(/\r?\n/);
  const onlyKeyword = (line, keyword) =>
    new RegExp(`^\\s*${keyword}\\s*;?\\s*$`, "i").test(line);

  const beginIndex = lines.findIndex((l) => onlyKeyword(l, "begin"));
  let commitIndex = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (onlyKeyword(lines[i], "commit")) {
      commitIndex = i;
      break;
    }
  }

  return lines
    .filter((_, i) => i !== beginIndex && i !== commitIndex)
    .join("\n")
    .trim();
}

const migrations = files.map((file) => {
  const raw = fs.readFileSync(path.join(migrationsDir, file), "utf8");
  const body = stripOuterTransaction(raw);
  if (body.length === 0) {
    console.error(`BLOCKED: ${file} is empty after removing its transaction wrapper`);
    process.exit(1);
  }
  return {
    file,
    body,
    checksum: crypto.createHash("sha256").update(raw).digest("hex").slice(0, 16),
    statements: (body.match(/;/g) || []).length,
  };
});

console.log("IDash follow-up board — migration run");
console.log(`target   : ${redact(connectionString)}`);
console.log(`mode     : ${DRY_RUN ? "PLAN ONLY (no changes)" : "APPLY"}`);
console.log(`migrations: ${migrations.length} files found`);
console.log("");

const client = new pg.Client({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

try {
  await client.connect();
} catch (error) {
  console.error(`BLOCKED: cannot reach the database — ${error.message}`);
  console.error("  Check DATABASE_URL. Supabase pooler hosts need the region, and the username");
  console.error("  is postgres.<project-ref>. The direct db.<ref>.supabase.co host does not exist");
  console.error("  for every project.");
  process.exit(1);
}

try {
  const info = await client.query(
    "select current_database() as db, current_user as usr, current_setting('server_version') as ver",
  );
  console.log(
    `connected: db=${info.rows[0].db} user=${info.rows[0].usr} postgres=${info.rows[0].ver}`,
  );

  const legacy = await client
    .query("select to_regclass('public.followups') as t")
    .then((r) => r.rows[0].t)
    .catch(() => null);
  console.log(`legacy table public.followups : ${legacy ?? "absent"}`);

  const already = await client
    .query("select to_regclass('public.cb_schema_migrations') as t")
    .then((r) => r.rows[0].t)
    .catch(() => null);
  console.log(`tracking table               : ${already ?? "will be created"}`);
  console.log("");
} catch (error) {
  console.error(`BLOCKED: connected but could not read the schema — ${error.message}`);
  await client.end();
  process.exit(1);
}

let applied = 0;
let skipped = 0;

try {
  if (!DRY_RUN) {
    await client.query(`
      create table if not exists cb_schema_migrations (
        version    text primary key,
        checksum   text not null,
        applied_at timestamptz not null default now()
      )
    `);
  }

  for (const migration of migrations) {
    let recorded = null;
    if (!DRY_RUN) {
      const existing = await client.query(
        "select checksum from cb_schema_migrations where version = $1",
        [migration.file],
      );
      if (existing.rowCount > 0) recorded = existing.rows[0].checksum;
    }

    if (recorded) {
      if (recorded !== migration.checksum) {
        console.error(`FAILED: ${migration.file} was already applied but the file has changed.`);
        console.error(`  recorded checksum ${recorded}, file checksum ${migration.checksum}`);
        console.error("  Do not edit an applied migration. Add a new migration instead.");
        process.exit(1);
      }
      console.log(`skip     ${migration.file}  (already applied)`);
      skipped++;
      continue;
    }

    if (DRY_RUN) {
      console.log(`would run ${migration.file}  (~${migration.statements} statements, checksum ${migration.checksum})`);
      continue;
    }

    console.log(`applying ${migration.file} ...`);
    await client.query("begin");
    try {
      await client.query(migration.body);
      await client.query(
        "insert into cb_schema_migrations (version, checksum) values ($1, $2)",
        [migration.file, migration.checksum],
      );
      await client.query("commit");
      console.log(`  ok     ${migration.file}`);
      applied++;
    } catch (error) {
      await client.query("rollback");
      console.error(`  FAILED ${migration.file}`);
      console.error(`  ${error.message}`);
      if (error.detail) console.error(`  detail: ${error.detail}`);
      if (error.hint) console.error(`  hint: ${error.hint}`);
      console.error("  That migration rolled back whole. Nothing from it was applied.");
      throw error;
    }
  }
} catch {
  await client.end();
  process.exit(1);
}

console.log("");
console.log(
  DRY_RUN
    ? `PLAN COMPLETE: ${migrations.length} migrations, nothing changed.`
    : `DONE: ${applied} applied, ${skipped} already present.`,
);
await client.end();
