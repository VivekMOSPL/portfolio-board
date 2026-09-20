## Status per part

Local core implementation: DONE
  evidence: final npm test printed "tests 33", "pass 33", "fail 0"; duration_ms 5428.3866.
  evidence: final npm run lint produced no findings and the command sequence continued successfully.
  evidence: final npm run build printed "Compiled successfully in 4.1s", "Finished TypeScript in 8.4s", and generated /, /_not-found, /[section], /api/[...path].
  Scope: implemented source and locally tested SQL/domain behavior. This is not a claim that hosted Auth or all PRD features are complete.

Browser/public-route verification: DONE
  evidence: npm run test:browser printed:
    desktop: HTTP 200, labelled login controls visible, no horizontal overflow
    tablet: HTTP 200, labelled login controls visible, no horizontal overflow
    mobile: HTTP 200, labelled login controls visible, no horizontal overflow
    Unauthenticated dashboard shows Sign in; no business records rendered
    HTTP checks: forged-origin POST 403; unauthenticated data 401; unknown page 404; browser errors 0
  The script also asserted X-Frame-Options DENY and CSP frame-ancestors on the final running build.
  Screenshots: artifacts/login-desktop.png, login-tablet.png, login-mobile.png.
  UNVERIFIED: authenticated browser workflows and responsive layouts containing actual tenant records.

Dependency/secret hygiene: DONE
  evidence: npm audit --omit=dev printed "found 0 vulnerabilities".
  evidence: git diff --check completed without whitespace errors (only Git LF/CRLF notices).
  evidence: git check-ignore .env.local printed ".env.local".
  evidence: node --env-file=.env.local scripts/check-browser-secrets.mjs printed:
    PASS: configured server secret values are absent from .next/static; checked 1 configured secret.
  The checked secret was the locally generated CRON_SECRET. SUPABASE_SERVICE_ROLE_KEY is absent, so its future configured value has not been scanned.

Local operator package: DONE
  Files: README.md, config/environment.example, scripts/check-ready.mjs, scripts/bootstrap-platform.mjs, versioned SQL migrations and executable tests.
  evidence: npm run check:ready executes and reports the specific remaining missing setting below.
  UNVERIFIED: execution of the bootstrap script, real Auth email delivery, hosted schema installation and backup/restore.

Hosted activation and production end-to-end verification: BLOCKED
  Tried:      npm run check:ready
  Got:        BLOCKED: missing server configuration: SUPABASE_SERVICE_ROLE_KEY
  Wall:       The project owner has not supplied the server credential. No database-administration connection or SQL-editor access was provided to apply hosted migrations.
  To unblock: The owner configures SUPABASE_SERVICE_ROLE_KEY privately in .env.local and the deployment environment, applies all versioned migrations in order to the intended backed-up Supabase project, and configures Auth templates/provider and the scheduler. Then run readiness, real-user workflows, hosted isolation and deployment checks.
  APP_URL and a fresh CRON_SECRET were configured locally without printing their values.
  No hosted database mutation, production bootstrap, remote seed, deployment or backup operation was performed.

Entire master brief: FAILED acceptance / not yet complete
  The source is a substantial functional core, but several requested capabilities remain unimplemented. They are listed explicitly below. Missing infrastructure does not explain away these source gaps.

## What was implemented

- Supabase Auth server flows for login, registration/confirmation, password recovery/update, invitation acceptance and logout. HTTP-only cookies; verified user lookup; same-origin mutation checks; bounded JSON input; persistent account-attempt limit; application-level immediate session revocation.
- Tenant/member/team/client/follow-up tables with tenant foreign keys, RLS, active-account/business checks, role and record scope. Direct application-role writes are revoked. Transaction RPCs perform validation and append audit/timeline/notifications.
- Platform business creation/state/limits, first-admin invitation, plan definitions and usage counts that exclude financial/client detail.
- Business/team/RM/auditor navigation and server/database permissions.
- Clients with code/contact/consent/segment/source, add/edit/archive, assignment, Client 360 and chronological interaction/change history.
- Follow-up creation, status/outcome/next-date rules, opportunity and converted amounts, next action, optimistic concurrency, archive, duplicate and all-or-nothing bulk updates.
- Administrator corrections append new timeline entries and retain originals.
- Paginated board/list/dated calendar agenda/My Day, search/status/due filters and private saved filters.
- SQL-derived open risk, overdue/unplanned, Won/Lost conversion and timeliness metrics with shared list/metric predicates.
- CSV/XLSX import, mapping, field-validation preview, error CSV, confirmation, transactional duplicate reject/skip, idempotent retries and committed history. XLSX rejects formula cells, malformed/encrypted/oversized archives and excessive expansion.
- Filtered audited CSV/XLSX exports, explicitly limited to 30 records rather than silently truncated.
- Team/branch labels, member roles/active state, manual single-use invitations, revocation and reassignment notifications.
- In-app assignment/due/escalation notifications, read state and a stored in-app reminder preference. Service-only idempotent reminder endpoint.
- Business timezone/escalation settings and master-data creation/deactivation; retired segment/reason/product/loss-reason values are rejected for new input.
- Responsive public UI, clear loading/error/empty/conflict states, security headers and an operator setup guide.

## Remaining master-brief gaps

These are incomplete features, not claims of completed integrations:

1. Platform: logged expiring support impersonation, richer business/legal/contact/branding fields, complete subscription lifecycle, feature flags/trials/announcements, failed-job monitoring and invitation resend/email dispatch.
2. Account/security: SSO, MFA enrollment and tenant enforcement, richer per-user data-scope grants beyond the implemented role/team/owner rules.
3. Client model: normalized alternate contacts/households, PAN encryption/masking/deduplication, expanded investment/review/profile fields, and record-level tag/custom-field workflows. Tag/custom-field master definitions alone do not complete those workflows.
4. Follow-ups: configurable statuses/transitions, recurrence, collaborators/watchers, individual follow-up reassignment, bulk tags and richer edit workflows.
5. Files: private object storage, attachment upload/access and malware-scanning integration.
6. Reminders: working calendars/holidays/quiet hours, digests, richer escalation routing, delivery adapters and durable job monitoring.
7. Imports/exports: persistent failed-row job history, background imports/large exports, follow-up imports, duplicate-resolution preview against stored records before confirmation. Current imports are bounded synchronous transactions; duplicate detection happens at confirmation.
8. Reports: full RM/team/branch activity/productivity, stale-contact/review reports, full date/segment/source/tag filtering and advanced drill-downs.
9. Administration/privacy: complete normalized permission/subscription/configuration entities, retention/tenant export/closure/erasure workflows and final operator-specific reviewed privacy/terms.
10. Verification: real provider-backed authentication and email, authenticated browser journeys at all widths, deployed RLS, large-dataset/performance/concurrency checks, backup/restore and live release verification.

The current calendar is a dated agenda grouped within a paginated result, not a complete month/week scheduling grid. Managers see their team; RMs see assigned work. Larger scope grants are not implemented. The business invitation UI accurately labels manual delivery and does not claim an email was sent.

## What broke and how I fixed it

- Sandbox process setup repeatedly failed: helper_unknown_error: setup refresh had errors. Approved outside-sandbox command execution was used. No secrets were printed.
- A large SQL write exceeded Windows' command-length limit. Migrations were split into bounded files/writes; all are executed by the PostgreSQL tests.
- The first browser automation tool could not initialize its sandbox kernel. Headless Edge through the approved command runner was used against localhost only.
- JSX had a missing closing bracket at app/portal.tsx:251. Corrected it and reran TypeScript and ESLint.
- ESLint identified Date.now during rendering and an unescaped apostrophe. The clock now updates through state/timer, copy was corrected, and internal navigation uses Next.js routing.
- The first browser test expected the exact label Password, while the accessible label is Password *. The locator was corrected to the actual required-field label; the same visibility assertion then passed at all three sizes.
- ExcelJS brought a UUID advisory. Its only inspected usage was the compatible v4 export. The dependency was overridden to patched ^11.1.1, workbook tests passed, and npm audit reported zero vulnerabilities.
- Supabase sign-out alone leaves issued access tokens valid until expiry. Added database-level revocation and tests that prove immediate application-data denial.
- A wrapper tool error interrupted one linking edit; the guard connection was reapplied and the complete suite rerun.
- Automatic approval review rejected replacing the legacy schema file because the supplied AGENTS instructions prohibit touching pre-existing files. The rejected write was not retried indirectly. The legacy SQL files and legacy lib/supabase.ts remain unchanged; README directs operators to the versioned migrations. New migrations revoke legacy public access during authorized cutover.

## Claims ledger (every claim, with the command that proves it; unproven ones marked UNVERIFIED)

- Database/RLS/domain/XLSX assertions: npm test -> tests 33, pass 33, fail 0.
- TypeScript/build compilation: npm run build -> Compiled successfully; Finished TypeScript; generated listed routes.
- Lint: npm run lint -> no findings, successful continuation.
- Public browser/HTTP behavior: npm run test:browser -> exact output above. Authenticated UI is UNVERIFIED.
- Local public endpoints: Invoke-WebRequest http://localhost:3100/login and /api/health -> StatusCode 200; the browser run fetched the final build again.
- Secret ignore: git check-ignore .env.local -> .env.local.
- Browser secret scan: node --env-file=.env.local scripts/check-browser-secrets.mjs -> PASS for the one configured server secret.
- Production dependency advisories: npm audit --omit=dev -> found 0 vulnerabilities.
- Hosted readiness: npm run check:ready -> missing SUPABASE_SERVICE_ROLE_KEY.
- Legacy-file preservation after rejection: git status --short did not list the legacy SQL/module as modified; Get-Content of their first lines printed the original demo headers.
- Implemented source coverage is described in the architecture/setup files and source; it is not a substitute for provider-backed end-to-end evidence.
- UNVERIFIED: hosted schema state, production exposure, actual Auth/email flows, provider delivery, scheduled execution, deployed URL after changes, backup/restore, performance and regulatory compliance.
- No claim is made that the full PRD or production rollout is complete.

## What I would tell the next person

Start with PRD.md, TECH-STACK.md and IMPLEMENTATION-PLAN.md. The original brief is preserved in PRD.md.
Do not mistake the earlier static board for this implementation. The source upgrade is local and not deployed.
Do not run the old schema.sql/seed.sql. The new migration path retains legacy rows and revokes their public access; mapping them to real tenants/owners requires an explicit operator decision.
Read README.md for Auth templates, environment, bootstrap, scheduler, migration and backup instructions. Never provide keys in chat or commit .env.local.
The local preview is http://localhost:3100/login while the started process remains running.
Configure the missing server credential and migration access to unblock provider verification. Finish the source gaps above before claiming full master-brief completion.

---

# Addendum — 2026-09-20 (source published; hosting still blocked)

This addendum is by a later session. Everything below is output this session actually produced.
The paragraph above saying "The source upgrade is local and not deployed" is now half outdated: the
source is published to a repository, but it is still not deployed and still cannot be signed in to.

## Status per part

Source published to its own repository: DONE
  evidence: git init in portfolio-board, then `git push -u origin main` printed
    "To https://github.com/VivekMOSPL/portfolio-board.git" and "* [new branch]  main -> main".
  evidence: `gh api repos/VivekMOSPL/portfolio-board/git/trees/main?recursive=1` -> 66 entries, 54 files.
  evidence: commit 04197c3, `gh api repos/VivekMOSPL/portfolio-board` -> pushed_at 2026-09-20T04:59:10Z,
    default_branch main, visibility public. The repo was empty before this push (size 0, no branches),
    so nothing was overwritten and no history was rewritten.
  evidence: the remote tree contains app/portal.tsx, app/[section]/page.tsx, app/api/[...path]/route.ts,
    lib/server.ts, lib/domain.ts, all five supabase/migrations files, tests/database.test.mjs and
    scripts/bootstrap-platform.mjs. No `.env` path exists in the remote tree.

Board untracked from the private parent repository: DONE (staged, intentionally not committed)
  evidence: `git -C D:\Manav\fwai-starter ls-files portfolio-board` -> 24 before, 0 after.
  evidence: files still on disk (19 top-level files in portfolio-board).
  evidence: parent .gitignore gained "portfolio-board/"; parent HEAD remains 1031ac7.
  A nested `.git` produced no embedded-repository warning in the parent; `git status` there still
  reports its normal `## main...origin/main`.

Local build and test suite re-verified: DONE
  evidence: `npm test` -> "tests 33", "pass 33", "fail 0".
  evidence: `npm run build` -> "Compiled successfully in 78s", "Finished TypeScript in 29.6s",
    routes /, /_not-found, /[section], /api/[...path].
  evidence: `npm run typecheck` -> no output, no errors. `npm run lint` -> no findings.

Public and unauthenticated browser behaviour re-verified: DONE
  evidence: `npm run test:browser` -> "desktop: HTTP 200, labelled login controls visible, no horizontal
    overflow / tablet: ... / mobile: ... / Unauthenticated dashboard shows Sign in; no business records
    rendered / HTTP checks: forged-origin POST 403; unauthenticated data 401; unknown page 404;
    browser errors 0".
  evidence: direct probe on the freshly built app -> unauthenticated /api/data HTTP 401;
    /api/health HTTP 200 {"status":"ok","service":"client-follow-up-board"}.
  evidence: security headers on /login -> X-Frame-Options DENY; Content-Security-Policy with
    frame-ancestors 'none', object-src 'none', base-uri 'self'; X-Content-Type-Options nosniff;
    Referrer-Policy no-referrer; Permissions-Policy camera=(), microphone=(), geolocation=().
    Strict-Transport-Security was absent, which is expected over plain HTTP on localhost.

Hosted activation and deployment: BLOCKED (unchanged)
  Tried:      npm run check:ready
  Got:        BLOCKED: missing server configuration: SUPABASE_SERVICE_ROLE_KEY
  Wall:       The service-role credential is not present in .env.local, and no hosted Auth account has
              been created. Migrations cannot be applied, the platform admin cannot be bootstrapped, and
              no user can authenticate. Only the project owner can supply these.
  To unblock: owner adds SUPABASE_SERVICE_ROLE_KEY privately to .env.local and to the deployment
              environment, creates and verifies the first Auth account, and connects the deployment.

Deployment: BLOCKED
  Tried:      checked for Vercel credentials: .vercel link, VERCEL_TOKEN, %USERPROFILE%\.vercel\auth.json
  Got:        .vercel link False; VERCEL_TOKEN not set; auth.json False
  Wall:       No Vercel credential or project link exists on this machine, so no deploy can be issued
              from here and project settings cannot be read.
  Surviving state: https://portfolio-board-one.vercel.app/ still returns 7184 bytes on / and 404 on /login,
              i.e. the unauthenticated prototype. The push did not change the live site.

Reminder scheduling (n8n): BLOCKED
  Tried:      n8n_list_credentials
  Got:        2 credentials: "Google Sheets account" (googleSheetsOAuth2Api), "DeepSeek account" (deepSeekApi)
  Wall:       POST /api/jobs/reminders requires an Authorization: Bearer header. No httpHeaderAuth
              credential exists, and this tooling can list credentials but not create them. The endpoint
              is also not deployed, so a workflow built now could neither run nor be verified.
  To unblock: owner creates an httpHeaderAuth credential in idash.app.n8n.cloud named "IDash Board CRON"
              with Header Name "Authorization" and value "Bearer <CRON_SECRET>", after the app is deployed.

## Claims ledger (this session)

- Public repo contents and commit: gh api trees + repo metadata -> 54 files, 04197c3, pushed_at above.
- No credential published: recursive remote tree contains no `.env` path; a full-project scan for
  JWT-shaped values (`eyJ...`) found only one hit, a base64 `integrity` hash in package-lock.json for
  lightningcss-linux-x64-gnu, which is not a key.
- Parent repo untracking: ls-files count 24 -> 0; parent HEAD unchanged at 1031ac7.
- Local suite, build, typecheck, lint, browser smoke and security headers: outputs quoted above.
- UNVERIFIED: hosted schema, hosted RLS behaviour, real provider authentication and email delivery,
  authenticated browser journeys, tenant isolation on the hosted database, backup/restore, and the
  deployed URL after any change. None of these have been observed.
- Not done: no migration applied, no bootstrap executed, no deployment issued, no n8n workflow created,
  no commit made in the parent repository.

## What broke and how I fixed it

- The public repository was an empty shell (size 0, no branches) rather than a populated prototype.
  This removed the expected unrelated-histories problem, so a clean `git init` + first push was used
  instead of any merge or force-push.
- `portfolio-board` was not its own repository; `git rev-parse --show-toplevel` returned
  `D:/Manav/fwai-starter`. A nested repository was created deliberately, and the parent was left
  tracked-but-staged-for-untracking so its history was not rewritten.
- Two `gh api` JSON pipelines failed with "Invalid JSON primitive: gh." while the repository had no
  commits, because the API returns a non-JSON error for an empty repository. Re-run after the push.

## What I would tell the next person

Read this addendum before the sections above; the repository state has moved but the deployment has not.
Do not redeploy the legacy prototype, and do not re-add its public policies as a shortcut.
The public repository is public: confirm that is still intended before adding anything, and note that
secret scanning and push protection are disabled on it.
The single highest-value action is the owner adding SUPABASE_SERVICE_ROLE_KEY. Until that happens
nothing hosted is verifiable, and no amount of further source work changes that.

---

# Addendum 2 — 2026-09-20/21: hosted activation COMPLETE, authenticated journey VERIFIED

The blocker in Addendum 1 is cleared. The schema is live on the hosted project and a real
authenticated journey has been exercised in a browser.

## Status per part

Hosted schema applied: DONE
  evidence: `npm run db:migrate` -> five lines "ok  20260917000X_*.sql", then
    "DONE: 5 applied, 0 already present."
  evidence: `npm run check:ready` -> "Database schema readiness: HTTP 200 for all required tables."
  The connection reported "connected: db=postgres user=postgres postgres=17.6".

Platform administrator provisioned: DONE
  evidence: `npm run go:live` ->
    "Database schema readiness: HTTP 200 for all required tables."
    "Platform administrator provisioned for the supplied verified user ID. No client data was read."
    "Database schema readiness: HTTP 200 for all required tables."

Authenticated journey in a real browser: DONE
  evidence: `node scripts/verify-auth.mjs` ->
    "signed in, landed on /dashboard"
    "session cookies: cb_access(secure=true,httpOnly=true), cb_refresh(secure=true,httpOnly=true)"
    "browser errors: 0"
    "AUTHENTICATED JOURNEY VERIFIED"
  The platform administrator lands on Platform administration with the Super Admin badge, an
  empty "Subscribed businesses" panel and the prompt "Create the first business and invite its
  administrator." Screenshot: artifacts/auth-platform.png.

First tenant created through the product UI: DONE
  evidence: filled the platform create-business form and saved -> "Saved successfully."
    Row after save: "IDash — Datachron Solutions   other · Starter · trial
    0 / 10 users · 0 / 1000 clients · 0 follow-ups   Manage   Invite admin
    1–1 of 1 records".
    Screenshot: artifacts/platform-after-create.png.

Invitation issued and accepted: DONE
  evidence: "Invite admin" -> "Invitation created for manual delivery. Share this single-use link
    securely: http://localhost:3100/invite?token=..." (shown once, as designed; email is not
    configured, so the UI correctly says manual delivery rather than claiming an email was sent).
  evidence: signed in as the invited address and accepted -> the workspace becomes
    "IDash — Datachron Solutions" with role admin and the account name "IDash Business Admin".

Role scoping: DONE
  evidence: platform administrator link set is exactly
    /dashboard /notifications /platform /privacy /terms
  evidence: business administrator link set is exactly
    Overview, My day, Follow-ups, Clients & prospects, Calendar, Team, Imports, Reports,
    Notifications, Audit trail, Business settings, Profile & security
  evidence: business administrator opening /platform shows no "Subscribed businesses" panel and
    no "Super Admin" badge - the platform console is not reachable.

Tenant isolation through the API: DONE
  evidence: as the business administrator of the first tenant, calling
    /api/data?resource=clients&tenant=11111111-1111-4111-8111-111111111111
    returned HTTP 403 {"error":"Account disabled, business suspended, or access unavailable"}.

## How the hosted blocker was actually cleared

The SQL editor was the problem, not the SQL. Applying supabase/apply-all.sql through the dashboard
left 19 tables present and 13 functions missing: the statements were executed individually, so the
migrations' own begin;/commit; wrappers did not make them atomic. Re-running then failed on
"relation cb_tenants already exists".

Root cause of the connection difficulty: the project's direct database host
db.qmrkbqsqwzaeergwhofc.supabase.co publishes only an AAAA record, and this workstation has no IPv6
egress, so the direct string could never connect. The project is hosted in ap-northeast-2; the
working URI is the session pooler at
aws-0-ap-northeast-2.pooler.supabase.com:5432 with username postgres.qmrkbqsqwzaeergwhofc.
The region was found by sweeping every aws-0/aws-1 pooler host in parallel; the ones that answer
"tenant/user ... not found" are the wrong region.

Recovery, both built and run from the repository:
  npm run db:reset   -> dropped 19 cb_ tables and 17 cb_ functions; legacy public.followups
                        left untouched at 18 rows; refused nothing because no client rows existed
  npm run db:migrate -> applied all five migrations atomically, recording checksums in
                        cb_schema_migrations so a re-run skips rather than fails

## Claims ledger (this addendum)

- Hosted schema, readiness, bootstrap, browser sign-in, tenant creation, invitation acceptance,
  role scoping and cross-tenant denial: commands and outputs quoted above.
- UNVERIFIED still: provider-backed email delivery (no provider configured), scheduled reminder
  execution, backup/restore rehearsal, deployed-URL behaviour, and performance at volume.
- The deployment itself has NOT happened. Nothing was deployed by this session.

## What I would tell the next person

Prefer `npm run db:migrate` over the dashboard SQL editor for this schema. The editor applies the
statements one at a time and will leave a half-built schema that then refuses to rebuild.
`npm run db:reset` is the recovery, and it is safe only while cb_ tables hold no client records.
The operator console stores business name, type, plan and limits. It has no address field, so the
registered address the brief mentions is not collected there; business profile and timezone
(~Asia/Kolkata by default) live in the tenant's own Business settings.

