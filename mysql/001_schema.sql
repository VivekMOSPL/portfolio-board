-- Follow-through Ã¢â‚¬â€ MySQL schema, core tenant and authorization model.
--
-- Port of supabase/migrations/202609170001_schema.sql.
--
-- Two deliberate differences from the PostgreSQL original, both forced by the engine:
--
--  1. MySQL has no row level security and no auth.uid(). Every authorization primitive therefore
--     takes the acting user explicitly, as p_actor. Callers must pass the user id taken from the
--     verified session, never from request input.
--
--  2. Because there is no RLS, scope is enforced by the functions below and by the read functions
--     that call them. A query that forgets to pass p_actor returns nothing, which fails closed.
--     Nothing in this file grants a broad read path.
--
-- Types: uuid -> char(36); jsonb -> json; timestamptz -> datetime(3) holding UTC; boolean ->
-- tinyint(1); text[] -> json array. Partial unique indexes become stored generated columns plus a
-- unique key, since MySQL has no partial index.

set names utf8mb4;

-- ---------------------------------------------------------------- tables

create table if not exists cb_tenants (
  id char(36) not null default (uuid()),
  name varchar(160) not null,
  status varchar(16) not null default 'trial',
  business_type varchar(40) not null default 'MFD',
  timezone varchar(64) not null default 'Asia/Kolkata',
  currency char(3) not null default 'INR',
  plan varchar(60) not null default 'Starter',
  user_limit int not null default 10,
  client_limit int not null default 1000,
  renewal_at date null,
  profile json not null default (json_object()),
  escalation_hours int not null default 24,
  version int not null default 1,
  created_at datetime(3) not null default (utc_timestamp(3)),
  primary key (id),
  constraint cb_tenants_name_len check (char_length(trim(name)) between 2 and 160),
  constraint cb_tenants_status check (status in ('trial','active','suspended','archived')),
  constraint cb_tenants_user_limit check (user_limit > 0),
  constraint cb_tenants_client_limit check (client_limit > 0),
  constraint cb_tenants_escalation check (escalation_hours between 1 and 720)
) engine=InnoDB;

-- Stands in for Supabase's auth.users. In the Supabase provider those rows are managed by GoTrue.
create table if not exists cb_accounts (
  id char(36) not null,
  email varchar(320) not null,
  email_confirmed_at datetime(3) null,
  created_at datetime(3) not null default (utc_timestamp(3)),
  primary key (id),
  unique key cb_accounts_email (email)
) engine=InnoDB;

create table if not exists cb_platform_admins (
  user_id char(36) not null,
  primary key (user_id),
  constraint cb_platform_admins_user foreign key (user_id) references cb_accounts(id)
) engine=InnoDB;

create table if not exists cb_teams (
  id char(36) not null default (uuid()),
  tenant_id char(36) not null,
  name varchar(100) not null,
  branch varchar(120) not null default '',
  active tinyint(1) not null default 1,
  primary key (id),
  unique key cb_teams_tenant_id (tenant_id, id),
  unique key cb_teams_tenant_name (tenant_id, name),
  constraint cb_teams_name_len check (char_length(trim(name)) between 2 and 100),
  constraint cb_teams_tenant foreign key (tenant_id) references cb_tenants(id)
) engine=InnoDB;

create table if not exists cb_members (
  tenant_id char(36) not null,
  user_id char(36) not null,
  name varchar(120) not null,
  email varchar(320) not null,
  role varchar(16) not null,
  team_id char(36) null,
  active tinyint(1) not null default 1,
  version int not null default 1,
  created_at datetime(3) not null default (utc_timestamp(3)),
  primary key (tenant_id, user_id),
  unique key cb_members_tenant_email (tenant_id, email),
  key cb_members_team (tenant_id, team_id),
  constraint cb_members_name_len check (char_length(trim(name)) between 2 and 120),
  constraint cb_members_role check (role in ('admin','manager','rm','auditor')),
  constraint cb_members_tenant foreign key (tenant_id) references cb_tenants(id),
  constraint cb_members_account foreign key (user_id) references cb_accounts(id),
  constraint cb_members_team_fk foreign key (tenant_id, team_id) references cb_teams(tenant_id, id)
) engine=InnoDB;

create table if not exists cb_clients (
  id char(36) not null default (uuid()),
  tenant_id char(36) not null,
  code varchar(60) not null,
  name varchar(160) not null,
  email varchar(320) null,
  phone varchar(20) null,
  kind varchar(16) not null default 'prospect',
  owner_id char(36) null,
  team_id char(36) null,
  segment varchar(80) not null default '',
  source varchar(80) not null default '',
  tags json not null default (json_array()),
  consent tinyint(1) not null default 0,
  profile json not null default (json_object()),
  last_contact_at datetime(3) null,
  archived_at datetime(3) null,
  version int not null default 1,
  created_at datetime(3) not null default (utc_timestamp(3)),
  updated_at datetime(3) not null default (utc_timestamp(3)),
  -- Generated keys reproduce the two partial unique indexes without a partial index.
  email_live varchar(320) generated always as
    (if(email is not null and archived_at is null, lower(email), null)) stored,
  phone_live varchar(20) generated always as
    (if(phone is not null and archived_at is null, phone, null)) stored,
  primary key (id),
  unique key cb_clients_tenant_id (tenant_id, id),
  unique key cb_clients_code (tenant_id, code),
  unique key cb_clients_email (tenant_id, email_live),
  unique key cb_clients_phone (tenant_id, phone_live),
  key cb_clients_scope (tenant_id, owner_id, team_id),
  key cb_clients_owner (tenant_id, owner_id),
  constraint cb_clients_code_len check (char_length(trim(code)) between 1 and 60),
  constraint cb_clients_name_len check (char_length(trim(name)) between 2 and 160),
  constraint cb_clients_kind check (kind in ('client','prospect')),
  constraint cb_clients_contact check (email is not null or phone is not null),
  constraint cb_clients_email_shape check (
    email is null or regexp_like(email, '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$')),
  constraint cb_clients_phone_shape check (
    phone is null or regexp_like(phone, '^[+][1-9][0-9]{7,14}$')),
  constraint cb_clients_tenant foreign key (tenant_id) references cb_tenants(id),
  constraint cb_clients_owner_fk foreign key (tenant_id, owner_id) references cb_members(tenant_id, user_id),
  constraint cb_clients_team_fk foreign key (tenant_id, team_id) references cb_teams(tenant_id, id)
) engine=InnoDB;

create table if not exists cb_followups (
  id char(36) not null default (uuid()),
  tenant_id char(36) not null,
  client_id char(36) not null,
  owner_id char(36) not null,
  team_id char(36) null,
  title varchar(200) not null,
  reason varchar(120) not null,
  description varchar(2000) not null default '',
  channel varchar(16) not null default 'call',
  priority varchar(16) not null default 'normal',
  status varchar(32) not null default 'New',
  value_paise bigint not null default 0,
  converted_paise bigint not null default 0,
  due_at datetime(3) null,
  reminder_at datetime(3) null,
  no_date_reason varchar(400) not null default '',
  next_action varchar(400) not null default '',
  outcome_note varchar(2000) not null default '',
  loss_reason varchar(400) not null default '',
  product varchar(120) not null default '',
  tags json not null default (json_array()),
  completed_at datetime(3) null,
  archived_at datetime(3) null,
  version int not null default 1,
  created_at datetime(3) not null default (utc_timestamp(3)),
  updated_at datetime(3) not null default (utc_timestamp(3)),
  sticky_due datetime(3) generated always as
    (if(archived_at is null, due_at, null)) stored,
  primary key (id),
  unique key cb_followups_tenant_id (tenant_id, id),
  key cb_followups_scope (tenant_id, owner_id, team_id, sticky_due),
  key cb_followups_client (tenant_id, client_id),
  key cb_followups_owner (tenant_id, owner_id),
  key cb_followups_team (tenant_id, team_id),
  constraint cb_followups_title_len check (char_length(trim(title)) between 2 and 200),
  constraint cb_followups_reason_len check (char_length(trim(reason)) between 1 and 120),
  constraint cb_followups_channel check (channel in ('call','meeting','email','whatsapp','video','other')),
  constraint cb_followups_priority check (priority in ('low','normal','high','urgent')),
  constraint cb_followups_status check (status in
    ('New','Due','Called','Meeting Scheduled','Met','Waiting on Client','Follow-up Required','Won','Lost','Cancelled')),
  constraint cb_followups_value check (value_paise between 0 and 900000000000000),
  constraint cb_followups_converted check (converted_paise between 0 and 900000000000000),
  constraint cb_followups_waiting check (
    status <> 'Waiting on Client' or due_at is not null or char_length(trim(no_date_reason)) > 0),
  constraint cb_followups_won_lost check (
    status not in ('Won','Lost') or char_length(trim(outcome_note)) > 0),
  constraint cb_followups_lost check (
    status <> 'Lost' or char_length(trim(loss_reason)) > 0),
  constraint cb_followups_tenant foreign key (tenant_id) references cb_tenants(id),
  constraint cb_followups_client_fk foreign key (tenant_id, client_id) references cb_clients(tenant_id, id),
  constraint cb_followups_owner_fk foreign key (tenant_id, owner_id) references cb_members(tenant_id, user_id),
  constraint cb_followups_team_fk foreign key (tenant_id, team_id) references cb_teams(tenant_id, id)
) engine=InnoDB;

create table if not exists cb_timeline (
  id char(36) not null default (uuid()),
  tenant_id char(36) not null,
  client_id char(36) not null,
  followup_id char(36) null,
  actor_id char(36) not null,
  kind varchar(40) not null,
  summary varchar(2000) not null,
  detail json not null default (json_object()),
  created_at datetime(3) not null default (utc_timestamp(3)),
  primary key (id),
  key cb_timeline_client (tenant_id, client_id, created_at),
  key cb_timeline_followup (tenant_id, followup_id),
  constraint cb_timeline_summary_len check (char_length(trim(summary)) between 1 and 2000),
  constraint cb_timeline_client_fk foreign key (tenant_id, client_id) references cb_clients(tenant_id, id),
  constraint cb_timeline_followup_fk foreign key (tenant_id, followup_id) references cb_followups(tenant_id, id)
) engine=InnoDB;

create table if not exists cb_notifications (
  id char(36) not null default (uuid()),
  tenant_id char(36) not null,
  user_id char(36) not null,
  client_id char(36) null,
  followup_id char(36) null,
  message varchar(1000) not null,
  event_key varchar(200) not null,
  read_at datetime(3) null,
  created_at datetime(3) not null default (utc_timestamp(3)),
  primary key (id),
  unique key cb_notifications_event (event_key),
  key cb_notifications_user (tenant_id, user_id),
  key cb_notifications_client (tenant_id, client_id),
  key cb_notifications_followup (tenant_id, followup_id),
  constraint cb_notifications_member foreign key (tenant_id, user_id) references cb_members(tenant_id, user_id),
  constraint cb_notifications_client_fk foreign key (tenant_id, client_id) references cb_clients(tenant_id, id),
  constraint cb_notifications_followup_fk foreign key (tenant_id, followup_id) references cb_followups(tenant_id, id)
) engine=InnoDB;

create table if not exists cb_invitations (
  id char(36) not null default (uuid()),
  tenant_id char(36) not null,
  email varchar(320) not null,
  name varchar(120) not null,
  role varchar(16) not null,
  team_id char(36) null,
  token_hash char(64) not null,
  expires_at datetime(3) not null,
  used_at datetime(3) null,
  revoked_at datetime(3) null,
  created_at datetime(3) not null default (utc_timestamp(3)),
  primary key (id),
  unique key cb_invitations_token (token_hash),
  key cb_invitations_team (tenant_id, team_id),
  key cb_invitations_pending (tenant_id, used_at, revoked_at, expires_at),
  constraint cb_invitations_email_shape check (
    regexp_like(email, '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$')),
  constraint cb_invitations_name_len check (char_length(trim(name)) between 2 and 120),
  constraint cb_invitations_role check (role in ('admin','manager','rm','auditor')),
  constraint cb_invitations_tenant foreign key (tenant_id) references cb_tenants(id),
  constraint cb_invitations_team_fk foreign key (tenant_id, team_id) references cb_teams(tenant_id, id)
) engine=InnoDB;

create table if not exists cb_imports (
  id char(36) not null default (uuid()),
  tenant_id char(36) not null,
  actor_id char(36) not null,
  request_key char(36) not null,
  rows_created int not null,
  rows_skipped int not null default 0,
  created_at datetime(3) not null default (utc_timestamp(3)),
  primary key (id),
  unique key cb_imports_request (tenant_id, request_key),
  constraint cb_imports_tenant foreign key (tenant_id) references cb_tenants(id)
) engine=InnoDB;

create table if not exists cb_audit (
  id char(36) not null default (uuid()),
  tenant_id char(36) null,
  actor_id char(36) null,
  action varchar(60) not null,
  entity_id char(36) null,
  detail json not null default (json_object()),
  created_at datetime(3) not null default (utc_timestamp(3)),
  primary key (id),
  key cb_audit_tenant (tenant_id, created_at),
  constraint cb_audit_tenant_fk foreign key (tenant_id) references cb_tenants(id)
) engine=InnoDB;

create table if not exists cb_preferences (
  tenant_id char(36) not null,
  user_id char(36) not null,
  in_app tinyint(1) not null default 1,
  primary key (tenant_id, user_id),
  constraint cb_preferences_member foreign key (tenant_id, user_id) references cb_members(tenant_id, user_id)
) engine=InnoDB;

-- ---------------------------------------------------------------- history is append only

drop trigger if exists cb_timeline_immutable;
drop trigger if exists cb_timeline_immutable_delete;
drop trigger if exists cb_audit_immutable;
drop trigger if exists cb_audit_immutable_delete;

create trigger cb_timeline_immutable before update on cb_timeline for each row
  signal sqlstate '45000' set message_text = 'History is immutable';
create trigger cb_timeline_immutable_delete before delete on cb_timeline for each row
  signal sqlstate '45000' set message_text = 'History is immutable';
create trigger cb_audit_immutable before update on cb_audit for each row
  signal sqlstate '45000' set message_text = 'History is immutable';
create trigger cb_audit_immutable_delete before delete on cb_audit for each row
  signal sqlstate '45000' set message_text = 'History is immutable';
