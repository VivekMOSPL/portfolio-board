Master Build Prompt — Multi-tenant Client Follow-up Board
You are a senior SaaS product architect, UX designer, and full-stack engineer. Upgrade the existing prototype at `https://portfolio-board-one.vercel.app/` into a production-ready, secure, multi-tenant Client Follow-up Board for Mutual Fund Distributors (MFDs), Certified Financial Advisors (CFAs), Chartered Accountants (CAs), wealth managers, and advisory firms.
Do not build another static demo. Build a functional application with authentication, persistent data, tenant isolation, role-based permissions, validation, audit history, responsive UI, and realistic end-to-end workflows. Preserve the current board's clean visual language and its strong “value at risk” summary, but redesign the product architecture and navigation where necessary.
1. Product objective
The application must help an advisory business ensure that no client follow-up is missed. It must let a firm create its team, import or add clients, assign clients and follow-ups to Relationship Managers (RMs), schedule next actions, record every interaction, identify overdue work, and measure conversions and value at risk.
The product is a multi-tenant SaaS:
The platform owner manages subscribed businesses.
Each business manages only its own users, clients, follow-ups, settings, and reports.
RMs see and act only on records assigned to them unless a business administrator grants wider access.
No business or user may read, change, search, export, or infer another tenant's data.
2. Roles and access control
Implement these roles with server-side authorization, not only hidden menu items:
Platform Super Admin
Create, edit, activate, suspend, archive, and impersonate a business using a clearly logged support mode.
Store legal/trade name, business type (MFD/CFA/CA/wealth manager/other), ARN or registration number where applicable, GST/PAN fields where applicable, address, city, state, PIN, country, phone, email, website, logo, primary contact, time zone, subscription plan, user limit, client limit, start date, renewal date, and status.
Invite the first Business Admin and resend/revoke invitations.
View tenant usage, active users, client/follow-up counts, storage/import usage, subscription status, failed jobs, and last activity.
Configure plans, feature flags, limits, trial periods, announcements, and platform-wide master data.
View platform audit logs. Never expose tenant financial/client data by default.
Business Admin
Manage business profile, branding, working hours, holidays, follow-up rules, custom fields, templates, notification preferences, and integrations.
Invite, edit, deactivate, and reactivate RMs, team leaders, and read-only users.
Create teams/branches and assign managers and RMs.
Set permissions and data scope: own records, team records, or all business records.
Add/import clients and prospects; assign or bulk-reassign ownership.
View all business dashboards, reports, audit activity, imports, and exports.
Team Manager (recommended)
View team workload and performance.
Assign/reassign team clients and follow-ups.
Review overdue tasks, stale leads, and unassigned records.
Cannot change subscription or platform/business security settings.
Relationship Manager (RM)
See assigned clients/prospects and assigned follow-ups.
Create follow-ups for permitted clients, record calls/meetings/messages, add notes, set outcomes, schedule the next action, and close/reopen items.
View personal dashboard, calendar/list/board, reminders, and performance.
Cannot access other teams or global exports unless granted.
Read-only/Auditor (optional)
Can view authorized records and reports but cannot edit, import, export, or communicate.
3. Authentication and account lifecycle
Create these flows:
Login with email and password; architecture ready for Google/Microsoft SSO.
Secure password hashing, session management, CSRF protection where applicable, rate limiting, account lockout, and logout from all devices.
Email invitation with expiring single-use token.
Forgot/reset password, expired invitation, disabled account, suspended tenant, and unauthorized-access screens.
Optional two-factor authentication and enforced 2FA by tenant.
On login, route users to the correct role-based dashboard.
Every protected route and API must validate user, tenant, role, permission, and record scope.
4. Application navigation
Use a responsive app shell with business branding, global search, notification centre, profile menu, tenant name, and role-aware navigation.
Primary modules:
Dashboard
Follow-ups
Clients & Prospects
Calendar
Team (authorized roles)
Imports
Reports
Business Settings
Platform Administration (Super Admin only)
Mobile must support the RM's daily workflow comfortably. Use a compact drawer or bottom navigation for primary RM actions.
5. Role-based dashboards
RM dashboard
Today, overdue, upcoming, completed, and unplanned follow-ups.
Personal value at risk, high-priority clients, stale clients, and recently contacted clients.
“My day” agenda ordered by overdue state, priority, due time, and value at risk.
Quick actions: add client, add follow-up, log call, log meeting, schedule next action.
Business Admin/Manager dashboard
Business/team pipeline and value at risk.
Follow-ups due today, overdue, completed, rescheduled, won, and lost.
Workload by RM, unassigned clients, stale records, overdue ageing, and upcoming commitments.
RM performance with activity counts, on-time completion rate, conversion rate, outcome value, and average follow-up cycle.
Filters for branch, team, RM, client segment, reason, status, priority, date range, source, and tags.
Super Admin dashboard
Total/active/trial/suspended businesses.
Active users, tenants approaching limits, renewals due, recent registrations, failed invitations/imports, and system activity.
All dashboard figures must link to the filtered underlying records and respect permissions.
6. Follow-up workspace
Keep the current board concept but make it an operational workspace with Board, List, Calendar, and My Day views.
Each follow-up must support:
Business, client/prospect, owner RM, optional team/branch.
Title, purpose/reason, description, channel (call, meeting, email, WhatsApp, video, other), priority, status, and outcome.
Value at risk/opportunity amount and product/category.
Due date and time, reminder date/time, recurrence, created source, tags, attachments, and internal collaborators/watchers.
Last contact, next action, completion time, created/updated by, and timestamps.
Statuses configurable per tenant, with sensible defaults: New, Due, Called, Meeting Scheduled, Met, Waiting on Client, Follow-up Required, Won, Lost, Cancelled.
“Waiting” must always require a next follow-up date or an explicit “no date” reason.
“Won” and “Lost” must require an outcome note; Lost may require a loss reason; Won may record converted amount/product.
Changing status must create a timeline event, not overwrite history.
Card/list actions:
Open client details.
Log interaction.
Change status/outcome.
Assign/reassign.
Set or reschedule next action.
Add note/attachment.
Mark complete, reopen, duplicate, or archive subject to permission.
Bulk assign, bulk reschedule, bulk tag, bulk status update, and export for authorized users.
Add saved filters, pagination or virtualisation, debounced search, empty states, loading states, permission errors, and retry states. Avoid loading the entire tenant dataset into the browser.
7. Client and prospect management
Client record:
Unique tenant-scoped client code.
Client/prospect type, full name/entity name, primary phone/email, alternate contacts, preferred channel/language, date of birth/incorporation where relevant, address, city/state/PIN, PAN masked in normal views, family/household, segment, source, tags, assigned RM/team/branch, lifecycle status, and consent/communication preferences.
Optional business-relevant fields such as AUM, SIP amount, review date, risk profile, products held, opportunity value, and custom fields.
Duplicate detection using configurable combinations of phone, email, PAN hash, and client code.
Client 360 page showing profile, open follow-ups, complete interaction timeline, notes, attachments, outcomes, assignments, and audit history.
Reassignment must preserve historical ownership and activities.
Soft delete/archive; do not silently hard-delete operational history.
8. Interaction and timeline history
Every client needs an immutable chronological timeline containing calls, meetings, emails/messages logged by users, notes, attachments, status changes, assignments, reminders, imports, and outcome changes.
Each interaction records date/time, channel, direction (inbound/outbound), user, summary, outcome, duration where useful, next action, and next due date. Users may correct entries only with permission; retain original value and edit audit.
9. Notifications and reminders
In-app notifications for assigned, due soon, overdue, reassigned, mentioned, and escalated items.
Email notifications and digest settings; design integration points for WhatsApp/SMS without pretending they work until credentials/providers are configured.
User-level quiet hours and tenant working days/holidays.
Configurable escalation: RM reminder, then team manager/business admin after defined overdue intervals.
Notification preferences by channel and event.
Idempotent background jobs so the same reminder is not sent twice.
10. Import, export, and data quality
CSV/XLSX client and follow-up import with downloadable template.
Upload, column mapping, validation preview, duplicate strategy, assignment mapping, error report, confirmation, progress, and import history.
Allow safe retry without creating duplicates.
Authorized filtered export to CSV/XLSX; log who exported what scope and when.
Validate Indian phone numbers, email, dates, currency, required fields, and tenant limits while still supporting international formats when configured.
11. Reporting
Create filterable reports for:
Follow-up ageing and overdue analysis.
Activity by RM/team/branch/channel/reason.
Pipeline and value at risk.
Won/lost conversion and loss reasons.
RM productivity and on-time completion.
Clients with no contact in N days.
Upcoming reviews/renewals/commitments.
Import and audit activity.
Define metrics precisely and show numerator/denominator or drill-down records. Do not use misleading vanity metrics.
12. Settings and master data
Business Admin can configure branches, teams, client segments, tags, follow-up reasons, priorities, statuses and allowed transitions, loss reasons, product categories, custom fields, working days, holidays, reminder/escalation rules, email templates, and import defaults.
Prevent deletion of values already in use; allow deactivation instead.
13. Data model
Design normalized persistent entities at minimum for:
Business/Tenant, SubscriptionPlan, Subscription
User, Role, Permission, UserRole, Session/Invitation
Branch, Team, TeamMember
Client, ClientContact, ClientAssignment, ClientCustomFieldValue, Tag
FollowUp, FollowUpStatusHistory, FollowUpAssignment, Reminder, RecurrenceRule
Interaction, Note, Attachment
Notification, NotificationPreference
ImportJob, ImportRowError, ExportJob
AuditLog and configurable master-data entities
Every tenant-owned row must contain `TenantId`/`BusinessId`. Enforce tenant isolation at the database/query-policy layer and in service/API authorization. Add suitable unique constraints, foreign keys, indexes, optimistic concurrency, UTC timestamps, and soft-delete/archive fields.
14. API and backend requirements
Use a clear service/domain layer and typed validation.
Paginate, filter, and sort on the server.
Use transactions for multi-record changes.
Implement optimistic concurrency and friendly conflict messages.
Use background jobs for reminders, digests, imports, and large exports.
Store attachments in object storage with tenant-scoped paths, content-type/size controls, malware-scanning integration point, and short-lived signed access.
Add structured logs, health checks, error tracking, and job monitoring without logging secrets or sensitive client data.
Provide seed data only for development; production must not show Pragati Wealth Advisors or sample clients unless a demo tenant was deliberately created.
15. Security, privacy, and compliance
Follow OWASP practices; validate and authorize every write and read.
Encrypt traffic and sensitive data at rest where appropriate.
Mask sensitive identifiers and restrict exports.
Maintain audit logs for login, failed login, invite, role/permission changes, client/follow-up changes, assignments, imports, exports, impersonation, and settings changes.
Support configurable data retention, account deactivation, tenant export, and tenant closure workflow.
Add privacy policy, terms, consent handling, and Indian data-protection readiness. Do not claim legal or regulatory compliance without formal review.
Never place secrets in browser code or commit them to source control.
16. UX and design requirements
Retain the current professional slate/white look and strong rupee-value hierarchy, but add an intentional full application shell.
Make overdue/due/priority understandable through text and icons, not colour alone.
Use accessible forms, keyboard navigation, focus states, confirmations for destructive actions, and WCAG-conscious contrast.
Make all important screens responsive. Test desktop, tablet, and mobile widths.
Use Indian number formatting (`₹`, lakh/crore) with a tenant setting for locale/currency.
Use realistic domain copy; replace “every client who needs chasing” with professional wording such as “Client commitments and follow-ups requiring action.”
17. Essential screens
Build and connect these screens; do not leave decorative dead buttons:
Login, forgot/reset password, invite acceptance
Super Admin dashboard and business list
Create/edit/view business and subscription/usage page
Business Admin dashboard
Team/user list, invite/edit user, roles/permissions, branch/team setup
RM dashboard / My Day
Follow-up board, list, calendar, detail/create/edit drawer or page
Client/prospect list, create/edit, Client 360 timeline
Import wizard and import history/errors
Reports with drill-down
Notifications centre
Business settings and profile/security settings
Audit log
Helpful 403, 404, empty, loading, error, suspended-tenant, and limit-reached states
18. Critical end-to-end workflows
Demonstrate with persistent data and automated tests:
Super Admin creates a business and invites its Admin.
Business Admin accepts invitation, completes business settings, creates a branch/team, and invites an RM.
Admin imports clients, resolves duplicate/errors, and assigns records to the RM.
RM logs in and sees only assigned work.
RM records a call, changes status to Waiting, and schedules the required next action.
Reminder becomes due and overdue, then escalates according to the tenant rule.
Admin sees updated dashboard metrics and drills into the exact records.
Admin reassigns a client; history remains intact and the new RM receives a notification.
RM marks a follow-up Won/Lost with required outcome data; reports update correctly.
A user from another tenant attempts direct URL/API access and receives no record or metadata.
19. Acceptance criteria
The work is complete only when:
There is real authentication and persistent storage.
All protected routes and APIs enforce tenant and record scope.
Super Admin, Business Admin, Manager, RM, and optional Read-only accounts have visibly and technically different permissions.
Business, user, client, assignment, follow-up, timeline, reminder, import, reporting, and audit workflows function end to end.
Dashboard values are calculated from stored records and drill down accurately.
Refreshing or opening the app on another device does not erase changes.
Forms have validation and meaningful success/error feedback.
Mobile and desktop workflows are usable and accessible.
Tests cover authorization/tenant isolation, status transition rules, metrics, imports, and the main workflows.
A README documents architecture, setup, environment variables, database migrations, seed/demo accounts, test commands, deployment, backup, and operational limitations.
20. Delivery method
First audit the existing repository and reuse its working stack and visual components where sensible. Then provide:
A brief gap analysis of the current implementation.
Proposed architecture and database schema.
Route map and permission matrix.
A phased implementation plan prioritizing secure authentication, tenant isolation, core follow-up workflow, and persistent data before optional integrations.
Complete production-quality code for the agreed phase, migrations, tests, seed/demo data, and setup documentation.
Do not claim completion for mocked authentication, browser-only storage, static arrays, non-functional buttons, fake notifications, or charts that are not calculated from persistent records. Clearly label any provider-dependent feature such as email, WhatsApp, SMS, SSO, payments, or file scanning until it is genuinely configured and tested.