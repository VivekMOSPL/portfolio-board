# MySQL provider

A port of the Follow-through schema and authorization model to MySQL, so the database layer can run
without Supabase. Selected through `config/database.json` (`"provider": "mysql"`, or the `DB_PROVIDER`
environment variable).

Status: **this is the database layer only.** The application still talks to Supabase's PostgREST and
Auth; the data layer and authentication have not been switched. See "What remains" below.

## Read this before treating MySQL as equivalent

The two providers do **not** work the same way, and one difference remains that matters.

| | Supabase (PostgreSQL) | MySQL |
|---|---|---|
| Read filtering | Row level security in the engine | Scope predicates inside `SECURITY DEFINER` procedures |
| A direct read of a base table | **Refused by the engine** | **Refused by the engine** — the application user holds no `SELECT` |
| Write filtering | Row level security in the engine | **Not yet enforced** — see the gap below |
| Acting user | `auth.uid()` from the JWT | `p_actor` supplied by the caller |
| History immutability | Trigger | Trigger |
| Authentication | Supabase Auth | Not supplied |

**Reads are protected the same way in effect, by a different mechanism.** MySQL has no row level
security, so the equivalent guarantee is built from two parts:

1. The read procedures are owned by the administrative account and default to
   `SQL SECURITY DEFINER`, so they execute with the definer's privileges.
2. The application user is granted **no `SELECT` on any base table** — only
   `insert, update, delete, execute`.

Together those mean the only route to client data is a procedure that applies the scope predicate. A
direct `select count(*) from cb_clients` by the application user is refused by the engine with
`ERROR 1142`. `db:mysql:setup` proves this on every run and fails if it ever stops being true:

```
application boundary:
  PASS  application user cannot read a base table directly
  PASS  an RM reads exactly their own client through the procedure
  PASS  the same RM reads nothing in another business
  PASS  the business admin reads every client in the tenant
```

### The remaining gap: writes are not yet filtered

The application user still holds `insert, update, delete` on the base tables, because the write
path is not ported yet. **A write made directly against a base table is not scope-checked.** Until the
command layer from `supabase/migrations/202609170002_commands.sql` is ported, writes are only as safe
as the application code that issues them.

The fix, once the command procedures exist, is to drop those three grants so that the application can
do nothing but call routines:

```sql
revoke insert, update, delete on followthrough.* from 'followthrough'@'127.0.0.1';
```

Do not describe the MySQL provider as providing equivalent protection until that step is done.

## Files

| File | Purpose |
|---|---|
| `001_schema.sql` | Tables, constraints, generated columns, immutability triggers |
| `002_authorization.sql` | `cb_platform`, `cb_role`, `cb_scope`, `cb_client_scope`, and ten `cb_read_*` procedures |
| `003_seed.sql` | Development data: two businesses, seven members, three teams, four clients |
| `004_isolation_checks.sql` | 25 assertions that fail if isolation or scope has regressed |

## Setting it up

A local MySQL 8.4 instance is expected. Anything from MySQL 8.0.16 works (CHECK constraints).

```
npm run db:mysql:setup      # create database, apply 001-003
npm run db:mysql:checks     # run the 25 isolation assertions
```

The scripts use `config/database.json` for connection settings and read the password from the
environment, so no credential appears on the command line or in a file that is committed.

`001_schema.sql` and `002_authorization.sql` are applied as an administrative user; the application
user only needs `SELECT, INSERT, UPDATE, DELETE, EXECUTE`. Schema changes are an operator action.

## Porting decisions, and what they cost

- `uuid` → `char(36)`, `timestamptz` → `datetime(3)` holding UTC, `jsonb` → `json`, `boolean` →
  `tinyint(1)`, `text[]` → a JSON array.
- **`text not null default ''` has no MySQL equivalent.** MySQL does not permit a default on `TEXT`.
  `cb_followups.description` is a bounded `varchar(2000)` instead. If unbounded text is ever needed there,
  it must move to `TEXT` and become a required column.
- **Partial unique indexes have no MySQL equivalent.** `cb_clients` uses stored generated columns
  (`email_live`, `phone_live`) that are `NULL` once a row is archived, plus a unique key. Because
  MySQL ignores `NULL`s in a unique index, this reproduces the PostgreSQL behaviour of allowing a
  duplicate address only after the original is archived.
- **A user variable in a view is refused** (ERROR 1351), so the usual `@actor`-in-a-view emulation of
  row level security is unavailable. Reads are stored procedures instead.
- **A routine parameter cannot be used in an arithmetic expression in `LIMIT ... OFFSET`.** Pagination
  takes an offset rather than a page number.
- **Creating triggers or functions with binary logging enabled requires `log_bin_trust_function_creators`.**
  It is set to 1 on the local instance. On a managed MySQL service this may need to be enabled by the
  operator.
- The legacy `public.followups` table from the unauthenticated prototype is not ported. It belongs to
  the Supabase project and has no counterpart here.

## What remains

This is the first slice. Still outstanding before the application can run on MySQL:

1. **Seven further migrations to port** — `commands`, `queries_jobs`, `session_security`,
   `operations`, `invite_accept_identity`, `integration_credentials`, `client_links`. Roughly 500 more
   statements: the command layer, session revocation, jobs, invitations and the integration surface.
2. **The data layer** — replacing `supabase-js` `.from()` and `.rpc()` calls with SQL. The read paths
   already have procedure counterparts; the command layer does not.
3. **Authentication** — MySQL supplies none. Registration, sign-in, sessions, confirmation, recovery
   and the persistent login throttle all need an implementation, or Supabase Auth must be kept for
   identity while MySQL holds the data. This was deferred by decision.
4. **The integration surface and the idempotency and audit ledgers** from migrations 7 and 8.

Until at least (1) and (2) are done, `config/database.json` should stay on `supabase`.
