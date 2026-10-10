import mysql from "mysql2/promise";
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
    throw new Error(`MySQL routine ${fn} does not exist, or its parameters could not be read`);
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
