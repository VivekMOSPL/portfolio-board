import mysql from "mysql2/promise";
import { AppError } from "../domain";
import { activeProvider, setting } from "./config";

/**
 * MySQL data driver.
 *
 * The application calls the data layer as rpc(name, args), which under Supabase became a PostgREST
 * call carrying the user's JWT. MySQL has no JWT and no auth.uid(), so the acting user is passed as
 * p_actor instead. Everything else about the call shape is preserved, which is what lets the rest of
 * the server code stay provider-agnostic.
 *
 * Parameter names are read from information_schema rather than hardcoded, so a routine that gains or
 * loses a parameter cannot silently be called with the wrong arguments. A routine that needs a
 * parameter the caller did not supply raises instead of being invoked with a null.
 *
 * This driver is only ever constructed with the id of an authenticated user. It is never given a
 * value from request input.
 */

export type DataDriver = {
  provider: "mysql" | "supabase";
  rpc<T = unknown>(fn: string, args?: Record<string, unknown>): Promise<T>;
};

let pool: mysql.Pool | null = null;

function getPool(): mysql.Pool {
  if (pool) return pool;
  const password = setting("password", "mysql");
  if (!password) {
    throw new Error("MySQL provider selected but MYSQL_PASSWORD is not set");
  }
  pool = mysql.createPool({
    host: setting("host", "mysql"),
    port: Number(setting("port", "mysql")),
    user: setting("user", "mysql"),
    password,
    database: setting("database", "mysql"),
    connectionLimit: 5,
    namedPlaceholders: true,
    timezone: "Z",
    supportBigNumbers: true,
    bigNumberStrings: false,
  });
  return pool;
}

const parameterCache = new Map<string, string[]>();

async function parameterNames(fn: string): Promise<string[]> {
  const cached = parameterCache.get(fn);
  if (cached) return cached;
  const [rows] = await getPool().query<mysql.RowDataPacket[]>(
    // A function's return value appears at ordinal_position 0 with a null name and null mode, so
    // filter to named IN parameters. Procedures have no such row.
    `select parameter_name
       from information_schema.parameters
      where specific_schema = ? and specific_name = ?
        and parameter_mode = 'IN' and parameter_name is not null
      order by ordinal_position`,
    [setting("database", "mysql"), fn],
  );
  // MySQL returns information_schema columns upper-cased (PARAMETER_NAME), so read both spellings
  // rather than depending on the server's casing.
  const names = rows.map((r) => String((r as Record<string, unknown>).PARAMETER_NAME ?? (r as Record<string, unknown>).parameter_name ?? ""));
  if (names.length === 0 || names.some((n) => !n)) {
    // A routine that has not been ported yet. Reported as incomplete setup rather than as an outage,
    // so the message points at the missing migration instead of sending an operator hunting.
    throw new AppError(503, `The ${fn} routine is not present on this database. The operator must apply the versioned migrations.`);
  }
  parameterCache.set(fn, names);
  return names;
}

/** JSON columns and json-typed parameters need a string; mysql2 would otherwise send [object Object]. */
function encode(value: unknown): string | number | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "boolean") return value ? 1 : 0;
  return JSON.stringify(value) ?? null;
}

export function mysqlDriver(actor: string): DataDriver {
  if (!actor) throw new Error("mysqlDriver requires an authenticated actor");

  return {
    provider: "mysql",
    async rpc<T = unknown>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
      const params = await parameterNames(fn);
      const values: Record<string, string | number | null> = {};
      for (const name of params) {
        if (name === "p_actor") {
          values[name] = actor;
          continue;
        }
        if (!(name in args)) {
          throw new Error(`MySQL routine ${fn} requires ${name}, which the caller did not supply`);
        }
        values[name] = encode(args[name]);
      }
      const placeholders = params.map((n) => `:${n}`).join(", ");
      const [rows] = await getPool().query<mysql.RowDataPacket[]>(
        `select ${fn}(${placeholders}) as result`,
        values,
      );
      const result = rows[0]?.result ?? null;
      return result as T;
    },
  };
}

/**
 * Translates a MySQL error into the same AppError the Supabase path produces.
 *
 * The ported routines raise the PostgreSQL SQLSTATE codes the application already mapped — 42501 for
 * forbidden, 22023 for a rule violation, 40001 for a version conflict, P0002 for not found — so the
 * API boundary behaves identically on both providers. Where MySQL raises its own condition, the
 * errno is mapped instead: 1062 is a duplicate key, 3819 a CHECK violation, 1142 a refused grant.
 */
function translate(error: unknown): never {
  const e = error as { sqlState?: string; errno?: number; message?: string };
  const state = e?.sqlState ?? "";
  const errno = e?.errno ?? 0;
  const message = e?.message ?? "Unknown database error";

  if (state === "P0002") throw new AppError(404, "Record not found");
  if (state === "40001") throw new AppError(409, "This record changed. Refresh it before saving again.");
  if (state === "28000") throw new AppError(401, message);
  if (state === "42501") throw new AppError(403, message);
  if (state === "22023") throw new AppError(422, message);
  if (state === "23505" || errno === 1062) {
    throw new AppError(409, "A matching record already exists. Check the client code, email or phone.");
  }
  if (state === "23514" || errno === 3819 || errno === 1265) {
    throw new AppError(422, "Invalid data, missing required fields, or a status rule was not satisfied.");
  }
  // 1142 and 1143 are the engine refusing a table grant. Surfacing them as 403 keeps a mistake in
  // the port from looking like an outage.
  if (errno === 1142 || errno === 1143) {
    throw new AppError(403, "This operation is not permitted for the application account.");
  }
  if (/does not exist|do not have|denied/i.test(message)) {
    throw new AppError(503, "Database setup is incomplete. The operator must apply the versioned migrations.");
  }
  console.error(JSON.stringify({ event: "database_error", provider: "mysql", errno, state }));
  throw new AppError(503, "The data service is unavailable. Please retry.");
}

/** Runs a scalar-returning query and returns the first row, or null. */
export async function mysqlQuery<T = unknown>(sql: string, params: unknown[] = []): Promise<T | null> {
  try {
    const [rows] = await getPool().query<mysql.RowDataPacket[]>(sql, params as never[]);
    return (rows[0] as T) ?? null;
  } catch (error) {
    translate(error);
  }
}

/** Runs a query whose single column is aliased `result` and returns that value. */
export async function mysqlScalar<T = unknown>(sql: string, params: unknown[] = []): Promise<T | null> {
  const row = await mysqlQuery<Record<string, T>>(sql, params);
  return row ? (row.result ?? null) : null;
}

/** Calls a stored procedure. Procedures are the only way to write, since MySQL forbids it in functions. */
export async function mysqlCall(procedure: string, params: unknown[] = []): Promise<void> {
  try {
    const placeholders = params.map(() => "?").join(", ");
    await getPool().query(`call ${procedure}(${placeholders})`, params as never[]);
  } catch (error) {
    translate(error);
  }
}

/** Diagnostics for the health endpoint and the check tools. Never returns a password. */
export function mysqlStatus() {
  return {
    provider: activeProvider(),
    host: setting("host", "mysql"),
    port: setting("port", "mysql"),
    database: setting("database", "mysql"),
    user: setting("user", "mysql"),
    password: setting("password", "mysql") ? "set" : "missing",
  };
}

export async function closeMysqlPool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
