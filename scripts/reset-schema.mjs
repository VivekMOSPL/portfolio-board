// Removes every cb_* object in the public schema so the migrations can be applied
// cleanly to a known-empty slate.
//
//   npm run db:reset          drop cb_* objects, refusing if they hold real data
//   npm run db:reset -- --force   drop anyway (use only when you are certain)
//
// It never touches anything outside cb_*: the legacy public.followups table, its rows,
// auth.users and Supabase's own schemas are all left alone.
//
// Refusing by default is deliberate. A partial or failed migration leaves cb_* tables
// present but empty, and re-running migrations over them fails with "already exists".
// Dropping them is the correct recovery — but only when they hold no client records.

import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";

const here = path.dirname(fileURLToPath(import.meta.url));
const FORCE = process.argv.includes("--force");

const connectionString = process.env.DATABASE_URL;
if (!connectionString || connectionString.trim() === "" || connectionString.includes("[")) {
  console.error("BLOCKED: missing server configuration: DATABASE_URL");
  console.error("  Add the Supabase pooler connection string to .env.local as DATABASE_URL=<uri>");
  process.exit(1);
}

function redact(cs) {
  try {
    const u = new URL(cs);
    return `${u.hostname}:${u.port || "5432"}${u.pathname} as ${u.username.replace(/:.*/, "")} (password hidden)`;
  } catch {
    return "(unparseable connection string)";
  }
}

const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });

try {
  await client.connect();
} catch (error) {
  console.error(`BLOCKED: cannot reach the database — ${error.message}`);
  process.exit(1);
}

console.log("IDash follow-up board — schema reset");
console.log(`target: ${redact(connectionString)}`);
console.log(`mode  : ${FORCE ? "FORCE (drops regardless of data)" : "guarded (refuses if real data exists)"}`);
console.log("");

try {
  const { rows: tableRows } = await client.query(`
    select tablename from pg_tables
    where schemaname = 'public' and tablename like 'cb\\_%'
    order by tablename
  `);
  const tables = tableRows.map((r) => r.tablename);

  const { rows: funcRows } = await client.query(`
    select p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'cb\\_%'
    order by p.proname
  `);
  const funcs = [...new Set(funcRows.map((r) => r.proname))];

  const { rows: viewRows } = await client.query(`
    select viewname from pg_views
    where schemaname = 'public' and viewname like 'cb\\_%'
    order by viewname
  `);
  const views = viewRows.map((r) => r.viewname);

  console.log(`found: ${tables.length} cb_ tables, ${funcs.length} cb_ functions, ${views.length} cb_ views`);

  if (tables.length === 0 && funcs.length === 0 && views.length === 0) {
    console.log("nothing to drop - the schema is already clear.");
    await client.end();
    process.exit(0);
  }

  // Data-safety check. cb_plans and cb_master_data hold operator-seeded lookup rows,
  // not client records, so a single seed row in those is not treated as real data.
  const lookup = new Set(["cb_plans", "cb_master_data", "cb_schema_migrations"]);
  let realRows = 0;
  const counts = [];
  for (const t of tables) {
    const { rows } = await client.query(`select count(*)::bigint as n from public."${t}"`);
    const n = Number(rows[0].n);
    counts.push({ t, n });
    if (n > 0 && !lookup.has(t)) realRows += n;
  }

  console.log("");
  for (const c of counts) {
    if (c.n > 0) console.log(`  ${c.t}: ${c.n} row(s)${lookup.has(c.t) ? "  (seed/lookup - not real data)" : ""}`);
  }

  if (realRows > 0 && !FORCE) {
    console.error("");
    console.error(`REFUSING: ${realRows} row(s) of real data live in cb_ tables.`);
    console.error("  Resetting would delete client records. Take a backup and confirm first,");
    console.error("  then re-run with --force if that is genuinely what you want.");
    await client.end();
    process.exit(1);
  }

  console.log("");
  console.log("dropping...");
  await client.query("begin");
  try {
    // Tables cascade to their indexes, constraints, triggers and dependent policies.
    for (const t of tables) {
      await client.query(`drop table if exists public."${t}" cascade`);
      console.log(`  dropped table    ${t}`);
    }
    for (const v of views) {
      await client.query(`drop view if exists public."${v}" cascade`);
      console.log(`  dropped view     ${v}`);
    }
    for (const f of funcs) {
      // Identity arguments are unknown, so drop every overload by name.
      await client.query(`
        do $$
        declare r record;
        begin
          for r in
            select p.oid::regprocedure as sig
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = '${f.replace(/'/g, "''")}'
          loop
            execute format('drop function if exists %s cascade', r.sig);
          end loop;
        end $$;
      `);
      console.log(`  dropped function ${f}`);
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    console.error(`FAILED: ${error.message}`);
    await client.end();
    process.exit(1);
  }

  const { rows: after } = await client.query(`
    select count(*)::int as n from pg_tables where schemaname='public' and tablename like 'cb\\_%'
  `);
  console.log("");
  console.log(`cb_ tables remaining: ${after[0].n}`);
  const legacy = await client
    .query("select to_regclass('public.followups') as t, (select count(*) from public.followups)::int as n")
    .then((r) => r.rows[0])
    .catch(() => null);
  if (legacy) console.log(`legacy public.followups untouched: ${legacy.t}, ${legacy.n} rows`);
  console.log("RESET COMPLETE - now run: npm run db:migrate");
} catch (error) {
  console.error(`FAILED: ${error.message}`);
  await client.end();
  process.exit(1);
}

await client.end();
