# IDash Follow-through Board — Build Prompt (Phase 2: Activate, Ship, Finish)

Paste this whole file as the brief for an AI coding agent working in `D:\Manav\fwai-starter\portfolio-board`.
It is written to be run by an agent that has **not** seen the earlier sessions.

---

## 0. Read this before you touch anything

1. Read `PRD.md`, `TECH-STACK.md`, `IMPLEMENTATION-PLAN.md`, `README.md` and `REPORT.md` in this folder, in that order.
2. `REPORT.md` section **"Claims ledger"** is the previous agent's evidence. Re-run the commands before you repeat any claim. A claim you have not personally reproduced is `UNVERIFIED`.
3. Do not state an outcome you have not seen in real command output. Write `UNVERIFIED:` in front of anything you have not run.
4. Never print, commit, paste into browser code, or screenshot a secret value. Keys live in `.env.local` and host environment variables only.

---

## 1. Verified current state (reproduce these before changing anything)

These were established on 2026-09-20 by running the commands shown. Confirm them yourself.

| Fact | Command | Observed result |
|---|---|---|
| The authenticated multi-tenant app exists in source | `Get-Content "app/[section]/page.tsx"` | 21 routed sections: `dashboard, follow-ups, my-day, calendar, clients, team, imports, reports, settings, notifications, audit, platform, security, login, register, forgot-password, reset-password, confirm, invite, privacy, terms` |
| A real login page renders | boot the app, fetch `/login` | `YOUR SECURE WORKSPACE … Welcome back … Email * Password * Sign in Forgot your password? Invited to a business? … Privacy · Terms` |
| Every route answers | fetch `/`, `/login`, `/register`, `/forgot-password`, `/platform`, `/dashboard`, `/my-day`, `/calendar`, `/clients`, `/team`, `/imports`, `/reports`, `/settings`, `/notifications`, `/audit`, `/security`, `/privacy` | all HTTP 200 |
| Tests pass, including real PostgreSQL RLS | `npm test` | `tests 33`, `pass 33`, `fail 0` (includes a PGlite schema/RLS/transaction suite, ~22 s) |
| The app compiles | `npm run build` | `Compiled successfully in 78s`; `Finished TypeScript in 29.6s`; routes `/`, `/_not-found`, `/[section]`, `/api/[...path]` |
| Hosting is not activated | `npm run check:ready` | `BLOCKED: missing server configuration: SUPABASE_SERVICE_ROLE_KEY` |
| **Nothing is committed** | `git status --porcelain` | 8 modified + 18 untracked, including `app/[section]/`, `app/api/`, `app/portal.tsx`, `lib/domain.ts`, `lib/server.ts`, `lib/workbooks.ts`, `scripts/`, `tests/`, `supabase/migrations/` (5 files), and all four plan docs |
| Nothing is pushed | `git status --short --branch` | `## main...origin/main` with the whole implementation still local |
| **The public site is the OLD prototype** | `Invoke-WebRequest https://portfolio-board-one.vercel.app/` | HTTP 200, 7,184 bytes, visible text is only `Portfolio Follow-up Board`; no `login`, `business`, `tenant`, `role`, `dashboard` markers; `/robots.txt` 404 |

### What this means

The four things the owner believes are missing — a Super Admin page, a business Admin page, a login-gated RM/Admin dashboard, and a functional end-to-end product — **already exist in the local source**. They are absent from `https://portfolio-board-one.vercel.app/` only because that deployment is a 13 September build of the unauthenticated prototype.

**The problem is activation and shipping, not feature creation.** Your job is to make the existing product real and reachable, then close the genuinely missing features.

---

## 2. What you must NOT do

- **Do not rebuild the architecture.** Do not regenerate auth, tenant tables, RLS, roles, the API layer, the portal, or the section routes. They exist and are tested.
- **Do not start a new project, new repo or new framework.**
- **Do not run `supabase/schema.sql` or `supabase/seed.sql`.** They are the legacy prototype's permissive, unauthenticated schema. They are retained only so the first migration can revoke their public access.
- **Do not weaken a security control to make something work** — no disabling RLS, no re-adding `using (true)` policies, no mock auth, no `anon` write access, no service-role key in the browser.
- **Do not delete `artifacts/`, `scripts/` or `tests/`.**
- **Do not overwrite or repoint an existing production deployment or database without an explicit, verified backup.** Establish which Supabase project and which Vercel project are in play first.
- **Do not restore public policies as a rollback shortcut.**

---

## 3. Your mission

Make the built product live, verified and genuinely usable by an advisory business, in this order:

1. **A. Activate hosting** — real Supabase project, migrations applied, Auth configured, environment set.
2. **B. Ship it** — commit, push, deploy, with the correct environment variables on the host.
3. **C. Prove it end-to-end** — real login, real tenant isolation, real RLS on the hosted database, real role dashboards.
4. **D. Close the remaining feature gaps** — only after A–C are green.

Do not move to D while A, B or C is failing. A deployed but unverified app is not done.

---

## 4. Workstream A — Activate hosting (Supabase)

1. Establish which Supabase project is intended. If it already holds data, **back it up first** and get the owner's explicit approval before any cutover.
2. Apply **every file in `supabase/migrations/` in filename order**:
   `202609170001_schema.sql`, `202609170002_commands.sql`, `202609170003_queries_jobs.sql`, `202609170004_session_security.sql`, `202609180005_operations.sql`.
   Use the Supabase CLI migration workflow, or execute each complete file once in the SQL editor.
3. Configure the Auth site URL and allowed redirect URLs to the exact `APP_URL`. Configure a production email provider, a verified sender, email confirmation, and password policy.
4. Configure the email templates to hit the app's own confirmation routes:
   - signup: `{{ .SiteURL }}/confirm?token_hash={{ .TokenHash }}`
   - recovery: `{{ .SiteURL }}/reset-password?token_hash={{ .TokenHash }}`
5. Populate `.env.local` from the variable names in `config/environment.example`:
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (public config, not privileged)
   - `SUPABASE_SERVICE_ROLE_KEY` (server only — rate limits, bootstrap, jobs; never for ordinary data reads/writes)
   - `APP_URL`, `CRON_SECRET` (high entropy), `BOOTSTRAP_USER_ID` (one-time)
6. Confirm the app fails closed with a missing credential, and that no server secret appears in `.next/static`:
   `node --env-file=.env.local scripts/check-browser-secrets.mjs`
7. Create and verify the operator's Supabase Auth account, then provision the platform role:
   `node --env-file=.env.local scripts/bootstrap-platform.mjs`
8. Re-run `npm run check:ready` until it passes instead of reporting the missing key.

**If the owner will not supply the service-role credential or database access, stop Workstream A and report it in the `BLOCKED` format in section 10. Do not simulate the backend. Do not ship a demo login.**

---

## 5. Workstream B — Ship it (GitHub and Vercel)

1. Confirm the intended repository. `VivekMOSPL/portfolio-board` last received a push on 2026-09-13 and is public — decide with the owner whether the real product belongs there or in the private `VivekMOSPL/portfolio-followup-board`. The product handles client financial data; a public repository is probably the wrong home. Do not change repository visibility without the owner's decision.
2. Review `git status` and `git diff`, stage only intended files, and commit with a message that describes the change. `.env.local` must stay ignored — verify with `git check-ignore .env.local`.
3. Push to `main`.
4. Identify the Vercel project behind `portfolio-board-one.vercel.app`. Record its Git connection and production branch, or state clearly that you could not.
5. Set **every** runtime variable on Vercel, not just locally. `.env.local` is never uploaded. A build that succeeds locally will still fail at runtime without `SUPABASE_SERVICE_ROLE_KEY`, `APP_URL` and `CRON_SECRET`.
6. Deploy. Then **fetch the live URL and paste what it returns** — do not infer success from the CLI's output.
7. Confirm on the live host: `/login` serves the login page, `/platform` is reachable after sign-in, an unknown path returns 404, and `/api/health` responds.
8. Set `APP_URL` to the final HTTPS origin, because mutation `Origin` checks compare against it. A mismatch will reject legitimate writes.
9. Configure an external scheduler to `POST /api/jobs/reminders` with `Authorization: Bearer <CRON_SECRET>`.
10. **The old deployed board must stop reading the legacy table.** Stage the app and database cutover together. Legacy rows are retained by the first migration and must be explicitly mapped to a tenant/client/owner — never guess ownership.

If the deployment serves the old prototype after a successful build, that is a failure, not a cache. Investigate the Vercel project's Git link and production branch.

---

## 6. Workstream C — Prove it end-to-end (this is the part that has never been done)

Everything below is currently `UNVERIFIED`. Do it for real, on the hosted environment.

1. **Real authentication.** Sign up, receive the confirmation email, confirm, sign in, sign out. Test password recovery and reset. Prove expired, revoked, wrong-email and already-used invitation tokens are rejected.
2. **Roles.** Create one account per role and confirm each sees only what it should:
   - **Platform Super Admin** — creates businesses, sets business state/limits, sees usage counts, and has **no implicit access to client financial detail**.
   - **Business Admin** — full scope inside exactly one tenant; manages business settings, branches, teams and members.
   - **Team Manager** — sees their team.
   - **RM** — sees only assigned records.
   - **Auditor / read-only** — reads, cannot mutate.
3. **Tenant isolation.** With two real businesses, prove Business A cannot read or write Business B's clients, follow-ups, timeline, reports or exports — through the UI **and** by calling the APIs directly with A's session.
4. **Row Level Security on the hosted database.** Confirm the hosted policies behave as the local PGlite suite asserts. Local test fixtures are not evidence of hosted behaviour.
5. **Session security.** Disable a membership and suspend a tenant — access must be denied immediately, including for tokens already issued. Global and per-session logout must deny issued-token access at once.
6. **The core follow-up workflow, as a real user:** create a business → invite its admin → accept the invitation → create a team → invite RMs → add or import clients → assign ownership → schedule follow-ups → advance status → see the timeline, notifications and My Day update → run a report → export → import a CSV/XLSX and confirm duplicate reject/skip and error download.
7. **Browser journeys at desktop, tablet and mobile widths**, authenticated, with real records — not just the login screen. Capture screenshots.
8. **Backup and restore.** Perform and document a real restore into an isolated project; compare tenant membership, client/follow-up counts and audit continuity.
9. Record every result. Failures are findings, not embarrassments.

---

## 7. Workstream D — Remaining functional gaps, in priority order

Close these only after A–C are green. They are the real remaining work, taken from `REPORT.md` and `README.md`.

**P0 — blocks real business use**
1. Invitation email dispatch and resend (today: single-use links generated for manual secure delivery only, and the UI must not imply an email was sent).
2. Tags and custom fields at record level — master definitions exist, workflows do not.
3. Attachment upload/access via private object storage, with malware-scanning integration.
4. Configurable status transitions, recurrence, collaborators/watchers, individual reassignment, bulk tagging.
5. Persistent failed-row import history; duplicate-resolution preview against stored records **before** confirmation; follow-up imports.

**P1 — needed for a complete product**
6. Support impersonation for the platform admin, logged and expiring.
7. SSO and MFA enrolment plus tenant enforcement; richer per-user data-scope grants.
8. Normalized alternate contacts and households; PAN encryption, masking and deduplication.
9. Working calendars, holidays, quiet hours, digests and richer escalation routing with delivery adapters and durable job monitoring.
10. Full RM/team/branch activity and productivity reports, stale-contact and review reports, full date/segment/source/tag filtering.
11. Larger background exports and background imports — today exports are bounded to 30 records and larger ones are rejected rather than truncated. Never silently truncate.
12. A real month/week scheduling grid — the current calendar is a dated agenda inside a paginated result.

**P2 — commercial and compliance**
13. Subscription lifecycle, plans, feature flags, trials, announcements, failed-job monitoring.
14. Retention, tenant export, tenant closure and erasure workflows.
15. Operator-specific privacy notice and terms, legally reviewed — they are currently operational notices pending the owner's legal identity, contact details and retention choices.

**Also required for production:** database backups/PITR, encrypted operator-controlled exports, separate Auth/object-storage backups, structured logging, provider Auth-failure monitoring, worker failure monitoring, and a documented secret-rotation procedure.

---

## 8. Acceptance criteria — do not report done until all are true

- [ ] Supabase migrations applied to the hosted project, in order, with `npm run check:ready` passing.
- [ ] Auth provider, sender, confirmation and password policy configured and exercised with real email.
- [ ] Implementation committed and pushed; `.env.local` still ignored.
- [ ] Vercel deployment serving the current build; the live URL returns the login page, not the old board.
- [ ] A real platform admin created a real business, and the invited admin accepted the invitation.
- [ ] Two real businesses proven isolated through both UI and direct API calls.
- [ ] Each of the five roles proven to see and do only what its scope allows.
- [ ] Session revocation and tenant suspension proven to deny already-issued tokens.
- [ ] The full follow-up workflow completed by a real user, with timeline and notification evidence.
- [ ] Import and export exercised with real files, including duplicate and error handling.
- [ ] Authenticated screenshots at desktop, tablet and mobile widths.
- [ ] A documented backup and restore, with counts compared.
- [ ] `npm test`, `npm run typecheck`, `npm run lint`, `npm run build` all re-run and passing, with output pasted.

---

## 9. Safeguards (violating these fails the task)

- No mock, stubbed or hardcoded authentication. No shared demo password. No "just for testing" bypass flag.
- No browser-only persistence. All business data lives in the hosted database.
- Data is never lost because a check was relaxed. Status changes append history; corrections append and retain originals.
- Role-hidden navigation is **not** a security boundary. Authorisation is enforced server-side and by RLS.
- Every read is scoped by tenant and by record. Every mutation is validated server-side for role, scope, status rules and expected version.
- Missing server credentials must fail closed, never open.
- A status like `Won`, `Met` or `Complete` is set only after the underlying thing actually happened.
- No secrets in the browser bundle, in Git, in logs, in screenshots or in chat. Re-run `scripts/check-browser-secrets.mjs` after configuring secrets.
- No invented URLs, deployments, test results or email deliveries. If you did not fetch it, it is `UNVERIFIED`.

---

## 10. When you hit a wall

Stop that part and report exactly this shape:

```
BLOCKED: <the one thing that cannot be done>
  Tried:      <the command or action, verbatim>
  Got:        <the actual error, verbatim>
  Wall:       <why it cannot be passed from here>
  To unblock: <the precise next action, and who has to do it>
```

Then carry on with every other part that does not depend on it. Do not work around a missing credential by weakening security or by faking the feature.

Known walls to expect up front:
- `SUPABASE_SERVICE_ROLE_KEY` and hosted database access — only the owner can supply these.
- Email provider credentials and a verified sender domain.
- The decision on which repository and which Vercel project are authoritative.
- Any cutover of existing production data.

---

## 11. Report back with

1. Status per workstream: A, B, C, D — `DONE | BLOCKED | FAILED`, each with the command and its real output.
2. The live URL and what it actually returned when you fetched it.
3. A claims ledger: every claim with the command that proves it; anything unproven marked `UNVERIFIED`.
4. What broke and how you diagnosed it.
5. What the next person must know.

Write it to `REPORT.md` in this folder, not only to chat.
