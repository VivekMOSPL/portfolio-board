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
