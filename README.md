# Follow-through — Client Follow-up Board

The original public board has been replaced in source with an authenticated multi-tenant application. This is a locally verified implementation, **not a claim that the complete master brief or hosted rollout is finished**. See REPORT.md for evidence and remaining gaps.

## Stack and architecture
Next.js 16.3.5 / React 19 / TypeScript / Tailwind 4; Supabase PostgreSQL and Auth; Zod validation; ExcelJS for bounded XLSX operations. UI calls same-origin Next.js route handlers. Verified Supabase sessions are carried in HTTP-only SameSite cookies. Each database read is subject to tenant/record RLS. Direct operational writes are revoked; transaction RPCs validate role, record scope, status rules and expected version, then append timeline/audit/notification events.

Platform admins manage metadata and provisioning with no implicit client-data access. Business admins have tenant scope, managers their team, RMs assigned records, auditors read-only scope. Session revocation is enforced in the database as well as Supabase. Login attempts use a service-only persistent limiter; missing server credentials fail closed.

## Setup
1. Install Node.js 24 LTS and run npm ci.
2. Create a dedicated Supabase project, or back up and review the existing project's data before an authorized cutover.
3. Apply **all files in supabase/migrations in filename order**. Use the Supabase CLI migration workflow, or execute each complete file once in the SQL editor. Do not run the old supabase/schema.sql or seed.sql; they belong to the unauthenticated prototype.
4. Configure .env.local using the variable names in config/environment.example. This file is ignored by Git. Never paste values into browser code, source control, logs or screenshots.
5. Set Auth Site URL and allowed redirect URLs to APP_URL. Configure a production email provider, verified sender, email confirmation and password policies in Supabase.
6. Configure email templates as described below. Create and verify the operator's Supabase Auth account, then provision its platform role.
7. Run npm test, npm run lint, npm run build and npm run check:ready. Start locally with npm run dev or the built app with npm start.
8. Sign in as platform admin, create a business, generate its admin invitation, then accept it while signed in as the invited user. Create a team, invite RMs, add/import clients, assign ownership, and schedule follow-ups.

### Environment
- NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: public project configuration, not privileged credentials.
- SUPABASE_SERVICE_ROLE_KEY: server only. Used for persistent auth rate limits, bootstrap and jobs. Never use it for ordinary application data reads/writes.
- APP_URL: exact application origin, for example http://localhost:3100 locally and your HTTPS origin in production. Mutation Origin checks compare against it.
- CRON_SECRET: a high-entropy secret for the reminder worker endpoint.
- BOOTSTRAP_USER_ID: only needed for the one-time bootstrap script; UUID of an existing verified Supabase Auth account.

Vercel must have the same runtime settings; .env.local is never uploaded.

### Auth email templates
Use links that send token hashes to the application and verify them through the explicit confirmation form. For signup confirmation:
  {{ .SiteURL }}/confirm?token_hash={{ .TokenHash }}
For recovery:
  {{ .SiteURL }}/reset-password?token_hash={{ .TokenHash }}
Configure and test templates in the actual provider. The application does not claim that email was delivered merely because a request succeeded. Business invitations currently generate expiring, single-use links for **manual secure delivery**. Invitation email dispatch/resend integration is not implemented.

The invitation recipient must verify their Auth email, sign in, then open the invitation. Expired, revoked, wrong-email and already-used tokens are rejected. Tokens are hashed at rest and returned only on creation.

### Platform bootstrap
After configuring the environment and setting BOOTSTRAP_USER_ID:
  node --env-file=.env.local scripts/bootstrap-platform.mjs
This explicitly adds the supplied verified account to cb_platform_admins. It does not create sample clients or a sample business.

### Development data
The database test suite creates two isolated businesses and real SQL fixtures for platform admin, business admins, manager, RMs and auditor. It applies the actual migrations to an isolated PGlite PostgreSQL database. Auth claims are fixtures in those tests; they are not evidence of hosted authentication.
There is no production demo account or default password. Do not run the legacy seed file.

## Commands
- npm test — PostgreSQL/RLS/transaction and typed-input/CSV/XLSX tests.
- npm run typecheck — TypeScript.
- npm run lint — ESLint.
- npm run build — production compilation.
- npm run start -- --port 3100 — serve built app.
- npm run test:browser — headless Edge checks against localhost:3100, with screenshots in artifacts/.
- npm run check:ready — environment and migrated REST schema readiness; no client records fetched.

## Routes
Public: /login, /register, /forgot-password, /reset-password, /confirm, /invite, /privacy, /terms.
Workspace: /dashboard, /my-day, /follow-ups, /calendar, /clients, /team, /imports, /reports, /notifications, /audit, /settings, /security.
Platform: /platform. Unknown pages return 404.
APIs: /api/session, /api/data, /api/command, /api/export, /api/import-file, /api/auth/*, /api/jobs/reminders, /api/health.
Workspace pages contain no embedded tenant records. Their APIs validate the session and scope before returning data. Role-hidden navigation is not the security boundary.

## Working behavior
- Clients: required contact validation, tenant-unique code/email/phone, ownership, consent, segment/source, archive and Client 360.
- Follow-ups: client-linked creation, status/outcome rules, due/reminder times, priorities, opportunity/converted values, next action, concurrency checks, duplicate, archive and transactional bulk updates.
- Timeline: interactions, changes and assignments are retained; administrators can append corrections without rewriting originals.
- Views: paginated board, list, dated agenda/calendar and My Day; search/status/due filters and private saved filters.
- Reports: open value, overdue/unplanned, Won/Lost conversion and on-time completion with shared SQL predicates for totals and drill-downs.
- Team: teams/branches, invitations, role/active-state changes and client/open-work reassignment.
- Imports: CSV/XLSX upload, column mapping, field validation, error download, confirmation, duplicate reject/skip, idempotent retries and committed import history.
- Exports: audited filtered CSV/XLSX; explicitly bounded to 30 records. Larger background exports are not implemented and are rejected instead of silently truncated.
- Settings: business name/timezone/escalation, master-value creation/deactivation; platform plans/business states/limits and usage counts.
- Notifications: actual assignment and scheduled due/escalation events, read state and in-app preference.
- Scheduled reminders: authenticated POST /api/jobs/reminders with Authorization: Bearer CRON_SECRET. Configure an external scheduler to invoke it. Event keys prevent duplicate reminders/escalations on retry.

## Deployment and cutover
Do not overwrite a production environment without verifying its identity and backup. The first migration revokes anonymous/authenticated access to the old followups table and removes its permissive policies, but retains its rows. Existing legacy rows must be explicitly mapped to a tenant/client/owner before migration; this implementation never guesses their ownership.
Stage the application and database cutover together: the old deployed board stops reading the legacy table after revocation. Never restore the public policies as a rollback shortcut.
Deploy only after provider configuration, real account workflows, cross-tenant API tests, backup/restore and migrated-schema readiness are verified. Fetch the deployed URL and protected API behavior after release.

## Backup and operations
Enable database backups/PITR appropriate to the selected Supabase plan. Export schema/data with the supported Supabase/Postgres tools into encrypted operator-controlled storage. Back up Auth settings, environment configuration and object-storage data separately if later enabled. Perform and document a restore into an isolated project before launch; compare tenant membership, client/follow-up counts and audit continuity. No backup/restore has been executed by this task.
Monitor server logs (structured event/code only), provider Auth failures, worker HTTP failures and job execution cadence. Rotate service/worker secrets through the host environment. Review retention with the business; soft archive is not a legal data-erasure workflow.

## Limits and outstanding work
See REPORT.md for the full acceptance reconciliation. Not yet implemented: support impersonation; SSO/MFA UI or enforcement; automatic invitation emails; full contact/PAN/custom-field modeling; attachments and scanning/storage flow; configurable status transitions; recurrence, quiet hours/holidays/digests; advanced branch/RM productivity reports; background imports/large exports; complete subscription/feature-flag controls; and retention/tenant closure workflows.
Master-data definitions for tags/custom fields are stored, but full record-level custom-field and tag workflows are not finished.
The privacy/terms pages are operational notices pending the operator's legal identity, contact details, retention choices and formal review. No legal compliance claim is made.
