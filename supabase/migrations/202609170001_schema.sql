-- Secure tenant schema. Legacy table retained; public access revoked.
begin;
create table cb_tenants(
 id uuid primary key default gen_random_uuid(),name text not null check(length(trim(name)) between 2 and 160),
 status text not null default 'trial' check(status in ('trial','active','suspended','archived')),
 business_type text not null default 'MFD',timezone text not null default 'Asia/Kolkata',
 currency text not null default 'INR',plan text not null default 'Starter',
 user_limit int not null default 10 check(user_limit>0),client_limit int not null default 1000 check(client_limit>0),
 renewal_at date,profile jsonb not null default '{}',escalation_hours int not null default 24 check(escalation_hours between 1 and 720),
 version int not null default 1,created_at timestamptz not null default now());
create table cb_platform_admins(user_id uuid primary key references auth.users(id));
create table cb_teams(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references cb_tenants,
 name text not null check(length(trim(name)) between 2 and 100),branch text not null default '',active boolean not null default true,
 unique(tenant_id,id),unique(tenant_id,name));
create table cb_members(
 tenant_id uuid not null references cb_tenants,user_id uuid not null references auth.users(id),
 name text not null check(length(trim(name)) between 2 and 120),email text not null,
 role text not null check(role in ('admin','manager','rm','auditor')),team_id uuid,active boolean not null default true,
 version int not null default 1,created_at timestamptz not null default now(),
 primary key(tenant_id,user_id),unique(tenant_id,email),foreign key(tenant_id,team_id) references cb_teams(tenant_id,id));
create table cb_clients(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references cb_tenants,
 code text not null check(length(trim(code)) between 1 and 60),name text not null check(length(trim(name)) between 2 and 160),
 email text,phone text,kind text not null default 'prospect' check(kind in ('client','prospect')),owner_id uuid,team_id uuid,
 segment text not null default '',source text not null default '',tags text[] not null default '{}',
 consent boolean not null default false,profile jsonb not null default '{}',last_contact_at timestamptz,archived_at timestamptz,
 version int not null default 1,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(tenant_id,id),unique(tenant_id,code),foreign key(tenant_id,owner_id) references cb_members(tenant_id,user_id),
 foreign key(tenant_id,team_id) references cb_teams(tenant_id,id),
 check(email is not null or phone is not null),
 check(email is null or email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
 check(phone is null or phone ~ '^\+[1-9][0-9]{7,14}$'));
create unique index cb_clients_email on cb_clients(tenant_id,lower(email)) where email is not null and archived_at is null;
create unique index cb_clients_phone on cb_clients(tenant_id,phone) where phone is not null and archived_at is null;
create index cb_clients_scope on cb_clients(tenant_id,owner_id,team_id);
create table cb_followups(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references cb_tenants,client_id uuid not null,
 owner_id uuid not null,team_id uuid,title text not null check(length(trim(title)) between 2 and 200),
 reason text not null check(length(trim(reason)) between 1 and 120),description text not null default '',
 channel text not null default 'call' check(channel in ('call','meeting','email','whatsapp','video','other')),
 priority text not null default 'normal' check(priority in ('low','normal','high','urgent')),
 status text not null default 'New' check(status in ('New','Due','Called','Meeting Scheduled','Met','Waiting on Client','Follow-up Required','Won','Lost','Cancelled')),
 value_paise bigint not null default 0 check(value_paise between 0 and 900000000000000),
 converted_paise bigint not null default 0 check(converted_paise between 0 and 900000000000000),
 due_at timestamptz,reminder_at timestamptz,no_date_reason text not null default '',next_action text not null default '',
 outcome_note text not null default '',loss_reason text not null default '',product text not null default '',tags text[] not null default '{}',
 completed_at timestamptz,archived_at timestamptz,version int not null default 1,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(tenant_id,id),foreign key(tenant_id,client_id) references cb_clients(tenant_id,id),
 foreign key(tenant_id,owner_id) references cb_members(tenant_id,user_id),foreign key(tenant_id,team_id) references cb_teams(tenant_id,id),
 check(status<>'Waiting on Client' or due_at is not null or length(trim(no_date_reason))>0),
 check(status not in ('Won','Lost') or length(trim(outcome_note))>0),
 check(status<>'Lost' or length(trim(loss_reason))>0));
create index cb_followups_scope on cb_followups(tenant_id,owner_id,team_id,due_at) where archived_at is null;
create table cb_timeline(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,client_id uuid not null,followup_id uuid,
 actor_id uuid not null,kind text not null,summary text not null check(length(trim(summary)) between 1 and 2000),
 detail jsonb not null default '{}',created_at timestamptz not null default now(),
 foreign key(tenant_id,client_id) references cb_clients(tenant_id,id),foreign key(tenant_id,followup_id) references cb_followups(tenant_id,id));
create index cb_timeline_client on cb_timeline(tenant_id,client_id,created_at desc);
create table cb_notifications(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,user_id uuid not null,client_id uuid,followup_id uuid,
 message text not null,event_key text not null unique,read_at timestamptz,created_at timestamptz not null default now(),
 foreign key(tenant_id,user_id) references cb_members(tenant_id,user_id),foreign key(tenant_id,client_id) references cb_clients(tenant_id,id),
 foreign key(tenant_id,followup_id) references cb_followups(tenant_id,id));
create table cb_invitations(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references cb_tenants,
 email text not null check(email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
 name text not null check(length(trim(name)) between 2 and 120),role text not null check(role in ('admin','manager','rm','auditor')),
 team_id uuid,token_hash text not null unique,expires_at timestamptz not null,used_at timestamptz,revoked_at timestamptz,
 created_at timestamptz not null default now(),foreign key(tenant_id,team_id) references cb_teams(tenant_id,id));
create table cb_imports(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references cb_tenants,actor_id uuid not null,
 request_key uuid not null,rows_created int not null,rows_skipped int not null default 0,created_at timestamptz not null default now(),
 unique(tenant_id,request_key));
create table cb_audit(
 id uuid primary key default gen_random_uuid(),tenant_id uuid references cb_tenants,actor_id uuid,action text not null,
 entity_id uuid,detail jsonb not null default '{}',created_at timestamptz not null default now());
create index cb_audit_tenant on cb_audit(tenant_id,created_at desc);
create table cb_preferences(
 tenant_id uuid not null,user_id uuid not null,in_app boolean not null default true,
 primary key(tenant_id,user_id),foreign key(tenant_id,user_id) references cb_members(tenant_id,user_id));

create function cb_platform() returns boolean language sql stable security definer set search_path=public
as $$select exists(select 1 from cb_platform_admins where user_id=auth.uid())$$;
create function cb_role(t uuid) returns text language sql stable security definer set search_path=public
as $$select m.role from cb_members m join cb_tenants b on b.id=m.tenant_id where m.tenant_id=t and m.user_id=auth.uid() and m.active and b.status in ('trial','active')$$;
create function cb_scope(t uuid,o uuid,g uuid,writing boolean default false) returns boolean language sql stable security definer set search_path=public
as $$select exists(select 1 from cb_members m join cb_tenants b on b.id=t
where m.tenant_id=t and m.user_id=auth.uid() and m.active and b.status in ('trial','active')
and (m.role='admin' or (m.role='auditor' and not writing) or (m.role='manager' and m.team_id=g and g is not null) or (m.role='rm' and o=m.user_id)))$$;
create function cb_client_scope(t uuid,c uuid,writing boolean default false) returns boolean language sql stable security definer set search_path=public
as $$select exists(select 1 from cb_clients where tenant_id=t and id=c and archived_at is null and cb_scope(t,owner_id,team_id,writing))$$;
create function cb_immutable() returns trigger language plpgsql set search_path=public as $$
begin raise exception 'History is immutable'; end$$;
create trigger immutable_timeline before update or delete on cb_timeline for each row execute function cb_immutable();
create trigger immutable_audit before update or delete on cb_audit for each row execute function cb_immutable();
alter table cb_tenants enable row level security;
create policy tenant_read on cb_tenants for select to authenticated using(cb_platform() or cb_role(id) is not null);
alter table cb_platform_admins enable row level security;
create policy platform_self on cb_platform_admins for select to authenticated using(user_id=auth.uid());
alter table cb_members enable row level security;
create policy member_read on cb_members for select to authenticated using(cb_role(tenant_id) is not null and (user_id=auth.uid() or cb_role(tenant_id) in ('admin','auditor') or (cb_role(tenant_id)='manager' and cb_scope(tenant_id,user_id,team_id))));
alter table cb_teams enable row level security;
create policy team_read on cb_teams for select to authenticated using(cb_role(tenant_id) in ('admin','auditor') or cb_scope(tenant_id,null,id));
alter table cb_clients enable row level security;
create policy client_read on cb_clients for select to authenticated using(cb_scope(tenant_id,owner_id,team_id));
alter table cb_followups enable row level security;
create policy followup_read on cb_followups for select to authenticated using(cb_scope(tenant_id,owner_id,team_id) and cb_client_scope(tenant_id,client_id));
alter table cb_timeline enable row level security;
create policy timeline_read on cb_timeline for select to authenticated using(cb_client_scope(tenant_id,client_id));
alter table cb_notifications enable row level security;
create policy notification_read on cb_notifications for select to authenticated using(user_id=auth.uid() and cb_role(tenant_id) is not null and (client_id is null or cb_client_scope(tenant_id,client_id)));
alter table cb_invitations enable row level security;
alter table cb_imports enable row level security;
create policy import_read on cb_imports for select to authenticated using(cb_role(tenant_id)='admin');
alter table cb_audit enable row level security;
create policy audit_read on cb_audit for select to authenticated using((tenant_id is null and cb_platform()) or cb_role(tenant_id) in ('admin','auditor'));
alter table cb_preferences enable row level security;
create policy preference_read on cb_preferences for select to authenticated using(user_id=auth.uid() and cb_role(tenant_id) is not null);
revoke all on cb_tenants,cb_platform_admins,cb_members,cb_teams,cb_clients,cb_followups,cb_timeline,cb_notifications,cb_invitations,cb_imports,cb_audit,cb_preferences from anon,authenticated;
grant select on cb_tenants,cb_platform_admins,cb_members,cb_teams,cb_clients,cb_followups,cb_timeline,cb_notifications,cb_imports,cb_audit,cb_preferences to authenticated;
revoke all on function cb_platform(),cb_role(uuid),cb_scope(uuid,uuid,uuid,boolean),cb_client_scope(uuid,uuid,boolean),cb_immutable() from public,anon,authenticated;
grant execute on function cb_platform(),cb_role(uuid),cb_scope(uuid,uuid,uuid,boolean),cb_client_scope(uuid,uuid,boolean) to authenticated;
do $$begin if to_regclass('public.followups') is not null then
 execute 'revoke all on public.followups from anon, authenticated';
 execute 'drop policy if exists followups_select on public.followups';
 execute 'drop policy if exists followups_insert on public.followups';
 execute 'drop policy if exists followups_update on public.followups';
 execute 'drop policy if exists followups_delete on public.followups';
end if; end$$;
commit;
