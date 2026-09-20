# Technical stack and architecture
Retain Next.js 16.3.5, React 19, TypeScript, Tailwind 4 and Supabase PostgreSQL/Auth.
Use installed Next.js guides before coding.
Browser UI calls Next.js route handlers. Server verifies Supabase identity, uses HTTP-only SameSite cookies, origin validation for mutations, bounded inputs and no-store responses.
Database enforces tenant and record scope independently through RLS. Direct writes are revoked; guarded transactional RPCs validate role/scope/state, expected version and required fields, then append immutable timeline/audit/notification records.
Roles: platform administrator (metadata only), business administrator (tenant), manager (team), RM (assigned), auditor (read only).
Entities: tenants, memberships, teams, clients, followups, timeline, notifications, invitations, imports, audit and settings. Every tenant entity has tenant_id; use composite foreign keys, unique client codes, integer minor currency units, UTC timestamps, archive fields, indexes and version counters.
Supabase Auth manages passwords and token lifecycle. No local mock identity or browser database.
Use Node tests with PGlite to execute PostgreSQL migrations/RLS/RPC tests when local PostgreSQL/Docker is unavailable. Auth schema/claims are test fixtures only, not evidence of hosted Auth verification.
Server-only service credentials and CRON_SECRET are required for background execution. Email, SSO, messaging and scanning remain explicitly unconfigured until provider integration tests pass.
Keep legacy data; quarantine public access during approved migration. Never print secret values. No automatic live migration/deployment.
Security refinement after reading Supabase sign-out documentation: database-level session revocation supplements provider logout so issued access tokens cannot continue reading application data. A service-only persistent account limiter requires SUPABASE_SERVICE_ROLE_KEY; authentication fails closed when it is absent. Verified provider behavior source: https://supabase.com/docs/guides/auth/signout .
Full normalized contacts, attachment storage, subscription lifecycle, MFA, rich configuration and advanced jobs are required by the PRD; track any unfinished portions honestly.

