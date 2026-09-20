# Implementation plan
Drafted under the user's instruction to complete the unfinished master brief. PRD.md is the full source brief. This plan does not reduce its acceptance criteria.
1. Audit, draft and read PRD.md, TECH-STACK.md, then this plan; read local Next.js guidance. Record tool/provider access constraints.
2. Build secure persistent schema, RLS, guarded transactional operations, versioning, history, invitation lifecycle, imports, notification jobs and metrics. Execute adversarial database tests before connecting UI.
3. Implement authenticated server boundary, secure session cookies, origin checks, typed validation, scoped queries and commands, account lifecycle and health/job routes. Verify validation and errors.
4. Build functional responsive role-aware UI: authentication, platform tenants, dashboard, clients/detail, follow-ups board/list/calendar/My Day, team/invitations, imports, reports/export, notifications, settings, audit.
5. Run database/domain tests, lint/type checks/build and HTTP smoke checks; browser checks where available. Write setup/migration/operations docs and reconcile every master acceptance condition in REPORT.md; update WORKLOG.md with actual outputs.
6. Apply migrations, configure providers and deploy only with authorized environment access. Verify real Auth, tenant isolation and workflows against hosted services, backup/restore and live HTTP before claiming production completion. Report external blockers; complete all independent work.

