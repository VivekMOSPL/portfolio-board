// Bundles supabase/migrations/*.sql into one file that can be pasted into the
// Supabase SQL editor, and appends the ledger rows so a later `npm run db:migrate`
// recognises the work as already done instead of trying to re-apply it.
//
//   npm run db:bundle     regenerate supabase/apply-all.sql
//
// The generated file is committed so it can be pasted without running node first.
// If it drifts from the migrations, regenerate it; the checksums below make that visible.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(here, "..", "supabase", "migrations");
const outFile = path.join(here, "..", "supabase", "apply-all.sql");

const files = fs
  .readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

if (files.length === 0) {
  console.error(`BLOCKED: no .sql files found in ${migrationsDir}`);
  process.exit(1);
}

const checksumOf = (sql) => crypto.createHash("sha256").update(sql).digest("hex").slice(0, 16);

const parts = [];
const ledger = [];

for (const file of files) {
  const raw = fs.readFileSync(path.join(migrationsDir, file), "utf8");
  const sql = raw.trim();
  // Checksum the raw file, exactly as apply-migrations.mjs does, so the ledger
  // written here matches what db:migrate later verifies.
  const checksum = checksumOf(raw);
  ledger.push({ file, checksum });
  parts.push(
    [
      "",
      "-- ============================================================",
      `-- ${file}`,
      `-- sha256:${checksum}`,
      "-- ============================================================",
      "",
      sql,
      "",
    ].join("\n"),
  );
}

const header = [
  "-- GENERATED FILE - do not edit by hand.",
  "-- Regenerate with: npm run db:bundle",
  "",
  "-- Applies every file in supabase/migrations in filename order, exactly once.",
  "-- Paste this entire file into the Supabase SQL editor and run it.",
  "--",
  "-- Each migration keeps its own transaction, so if one fails it rolls back on its own",
  "-- and the ones before it stay applied. Stop there and read the error.",
  "--",
  "-- The ledger block at the end records what ran, so a later `npm run db:migrate`",
  "-- skips these instead of failing on already-created tables.",
  "--",
  `-- Bundled migrations: ${files.length}`,
  ...ledger.map((l) => `--   ${l.file}  sha256:${l.checksum}`),
  "-- ============================================================",
  "",
].join("\n");

const ledgerSql = [
  "",
  "-- ============================================================",
  "-- Ledger: record what was applied so tools can skip it safely.",
  "-- ============================================================",
  "",
  "begin;",
  "",
  "create table if not exists cb_schema_migrations (",
  "  version    text primary key,",
  "  checksum   text not null,",
  "  applied_at timestamptz not null default now()",
  ");",
  "",
  ...ledger.map(
    (l) =>
      `insert into cb_schema_migrations (version, checksum) values ('${l.file}', '${l.checksum}') ` +
      "on conflict (version) do nothing;",
  ),
  "",
  "commit;",
  "",
].join("\n");

const output = header + parts.join("\n") + ledgerSql;
fs.writeFileSync(outFile, output, "utf8");

console.log(`bundled ${files.length} migrations -> ${path.relative(path.join(here, ".."), outFile)}`);
console.log(`  bytes: ${output.length}`);
for (const l of ledger) console.log(`  ${l.file}  sha256:${l.checksum}`);
