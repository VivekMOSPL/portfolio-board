-- Follow-through — MySQL development seed.
--
-- Mirrors the fixtures the PostgreSQL test suite builds: two isolated businesses, a platform admin,
-- a business admin, a manager, two RMs, an auditor, teams, clients and follow-ups. It exists so the
-- authorization model can be exercised without Supabase. It is development data, not production
-- content, and it is idempotent: re-running replaces the same rows.
--
-- Every identifier is fixed so assertions in mysql/004_isolation_checks.sql can name them.

set names utf8mb4;
set foreign_key_checks = 0;
truncate table cb_timeline;
truncate table cb_notifications;
truncate table cb_followups;
truncate table cb_clients;
truncate table cb_imports;
truncate table cb_audit;
truncate table cb_invitations;
truncate table cb_preferences;
truncate table cb_members;
truncate table cb_teams;
truncate table cb_platform_admins;
truncate table cb_accounts;
truncate table cb_tenants;
set foreign_key_checks = 1;

-- ---------------------------------------------------------------- businesses

insert into cb_tenants (id, name, status, business_type, plan, user_limit, client_limit, profile) values
  ('10000000-0000-4000-8000-00000000000a', 'IDash — Datachron Solutions', 'active', 'other', 'Starter', 10, 1000, '{}'),
  ('10000000-0000-4000-8000-00000000000b', 'Meridian Wealth', 'active', 'wealth manager', 'Starter', 10, 1000, '{}');

-- ---------------------------------------------------------------- accounts
-- In the Supabase provider these rows are owned by GoTrue. Here they are the local identity rows
-- that member and platform-admin records point at.

insert into cb_accounts (id, email, email_confirmed_at) values
  ('20000000-0000-4000-8000-000000000001', 'platform@followthrough.test',  utc_timestamp(3)),
  ('20000000-0000-4000-8000-000000000002', 'admin.a@followthrough.test',     utc_timestamp(3)),
  ('20000000-0000-4000-8000-000000000003', 'manager.a@followthrough.test',   utc_timestamp(3)),
  ('20000000-0000-4000-8000-000000000004', 'rm1.a@followthrough.test',       utc_timestamp(3)),
  ('20000000-0000-4000-8000-000000000005', 'rm2.a@followthrough.test',       utc_timestamp(3)),
  ('20000000-0000-4000-8000-000000000006', 'auditor.a@followthrough.test',   utc_timestamp(3)),
  ('20000000-0000-4000-8000-000000000007', 'admin.b@followthrough.test',     utc_timestamp(3)),
  ('20000000-0000-4000-8000-000000000008', 'rm.b@followthrough.test',        utc_timestamp(3));

insert into cb_platform_admins (user_id) values ('20000000-0000-4000-8000-000000000001');

-- ---------------------------------------------------------------- teams and members

insert into cb_teams (id, tenant_id, name, branch) values
  ('30000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a', 'Alpha', 'Janakpuri'),
  ('30000000-0000-4000-8000-00000000000b', '10000000-0000-4000-8000-00000000000a', 'Beta',  'Janakpuri'),
  ('30000000-0000-4000-8000-00000000000c', '10000000-0000-4000-8000-00000000000b', 'One',   'Pune');

insert into cb_members (tenant_id, user_id, name, email, role, team_id) values
  ('10000000-0000-4000-8000-00000000000a', '20000000-0000-4000-8000-000000000002', 'Aisha Admin',   'admin.a@followthrough.test',   'admin',   null),
  ('10000000-0000-4000-8000-00000000000a', '20000000-0000-4000-8000-000000000003', 'Mohan Manager', 'manager.a@followthrough.test', 'manager', '30000000-0000-4000-8000-00000000000a'),
  ('10000000-0000-4000-8000-00000000000a', '20000000-0000-4000-8000-000000000004', 'Ravi RM',       'rm1.a@followthrough.test',     'rm',      '30000000-0000-4000-8000-00000000000a'),
  ('10000000-0000-4000-8000-00000000000a', '20000000-0000-4000-8000-000000000005', 'Reena RM',      'rm2.a@followthrough.test',     'rm',      '30000000-0000-4000-8000-00000000000b'),
  ('10000000-0000-4000-8000-00000000000a', '20000000-0000-4000-8000-000000000006', 'Asha Auditor',  'auditor.a@followthrough.test', 'auditor', null),
  ('10000000-0000-4000-8000-00000000000b', '20000000-0000-4000-8000-000000000007', 'Bhavna Admin',  'admin.b@followthrough.test',   'admin',   null),
  ('10000000-0000-4000-8000-00000000000b', '20000000-0000-4000-8000-000000000008', 'Bilal RM',      'rm.b@followthrough.test',      'rm',      '30000000-0000-4000-8000-00000000000c');

-- ---------------------------------------------------------------- clients
-- Only Aisha (admin) and the platform admin can see all of A. Ravi sees only his own, Reena only
-- hers and her team's, and Bhavna's clients are invisible to everyone in A.

insert into cb_clients (id, tenant_id, code, name, email, phone, kind, owner_id, team_id, tags, profile) values
  ('40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-00000000000a', 'A-1001', 'Ravi Client One',   'one@example.test',   null, 'client',   '20000000-0000-4000-8000-000000000004', '30000000-0000-4000-8000-00000000000a', '[]', '{}'),
  ('40000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-00000000000a', 'A-1002', 'Reena Client Two',  null, '+919000000002', 'client',   '20000000-0000-4000-8000-000000000005', '30000000-0000-4000-8000-00000000000b', '[]', '{}'),
  ('40000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-00000000000a', 'A-1003', 'Admin Client Three', 'three@example.test', null, 'prospect', '20000000-0000-4000-8000-000000000002', null, '[]', '{}'),
  ('40000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-00000000000b', 'B-2001', 'Bilal Client Four', 'four@example.test',  null, 'client',   '20000000-0000-4000-8000-000000000008', '30000000-0000-4000-8000-00000000000c', '[]', '{}');

-- ---------------------------------------------------------------- follow-ups

insert into cb_followups (id, tenant_id, client_id, owner_id, team_id, title, reason, status, due_at) values
  ('50000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-00000000000a', '40000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000004', '30000000-0000-4000-8000-00000000000a', 'Review portfolio',   'Quarterly review', 'Due', utc_timestamp(3) + interval 2 day),
  ('50000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-00000000000a', '40000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000005', '30000000-0000-4000-8000-00000000000b', 'Renewal reminder',   'Policy renewal',   'New', utc_timestamp(3) + interval 5 day),
  ('50000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-00000000000b', '40000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000008', '30000000-0000-4000-8000-00000000000c', 'Onboarding call',    'New client',       'New', utc_timestamp(3) + interval 1 day);

insert into cb_timeline (tenant_id, client_id, followup_id, actor_id, kind, summary) values
  ('10000000-0000-4000-8000-00000000000a', '40000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000004', 'created', 'Follow-up created');

insert into cb_preferences (tenant_id, user_id, in_app) values
  ('10000000-0000-4000-8000-00000000000a', '20000000-0000-4000-8000-000000000004', 1);
