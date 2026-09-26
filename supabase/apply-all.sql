-- GENERATED FILE - do not edit by hand.
-- Regenerate with: npm run db:bundle

-- Applies every file in supabase/migrations in filename order, exactly once.
-- Paste this entire file into the Supabase SQL editor and run it.
--
-- Each migration keeps its own transaction, so if one fails it rolls back on its own
-- and the ones before it stay applied. Stop there and read the error.
--
-- The ledger block at the end records what ran, so a later `npm run db:migrate`
-- skips these instead of failing on already-created tables.
--
-- Bundled migrations: 6
--   202609170001_schema.sql  sha256:5e4d9ccf33c9c35d
--   202609170002_commands.sql  sha256:02ebafadbc49ec43
--   202609170003_queries_jobs.sql  sha256:aa5db2c25ccd4569
--   202609170004_session_security.sql  sha256:248660b37c336c63
--   202609180005_operations.sql  sha256:acd82083e7c24c39
--   202609260006_invite_accept_identity.sql  sha256:9715d5d8ec366973
-- ============================================================

-- ============================================================
-- 202609170001_schema.sql
-- sha256:5e4d9ccf33c9c35d
-- ============================================================

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


-- ============================================================
-- 202609170002_commands.sql
-- sha256:02ebafadbc49ec43
-- ============================================================

begin;
create function cb_command(p_tenant uuid,p_action text,p_data jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=public as $$
declare r text; c cb_clients; f cb_followups; b cb_tenants; m cb_members; inv cb_invitations; j cb_imports;
 rid uuid; own uuid; team uuid; tok text; st text; rowdata jsonb; res jsonb; old_data jsonb; n int:=0; skipped int:=0;
begin
 if not cb_access_valid() then raise exception 'Authentication required' using errcode='28000'; end if;
 if p_action='tenant.create' then
  if not cb_platform() then raise exception 'Forbidden' using errcode='42501'; end if;
  insert into cb_tenants(name,business_type,plan,user_limit,client_limit,profile)
  values(trim(p_data->>'name'),coalesce(p_data->>'business_type','MFD'),coalesce(p_data->>'plan','Starter'),
  coalesce((p_data->>'user_limit')::int,10),coalesce((p_data->>'client_limit')::int,1000),coalesce(p_data->'profile','{}')) returning * into b;
  insert into cb_audit(actor_id,action,entity_id) values(auth.uid(),p_action,b.id);
  return to_jsonb(b);
 end if;
 if p_action='tenant.update' then
  if not cb_platform() then raise exception 'Forbidden' using errcode='42501'; end if;
  update cb_tenants set name=trim(p_data->>'name'),status=p_data->>'status',plan=p_data->>'plan',
  user_limit=(p_data->>'user_limit')::int,client_limit=(p_data->>'client_limit')::int,
  renewal_at=nullif(p_data->>'renewal_at','')::date,version=version+1 where id=p_tenant and version=(p_data->>'version')::int returning * into b;
  if not found then raise exception 'Conflict: reload this record' using errcode='40001'; end if;
  insert into cb_audit(actor_id,action,entity_id) values(auth.uid(),p_action,b.id); return to_jsonb(b);
 end if;
 if p_action='invite.accept' then
  select * into inv from cb_invitations where token_hash=encode(sha256(convert_to(p_data->>'token','UTF8')),'hex')
  and lower(email)=lower(auth.jwt()->>'email') and used_at is null and revoked_at is null and expires_at>now() for update;
  if not found then raise exception 'Invitation is invalid, expired, or already used' using errcode='22023'; end if;
  select * into b from cb_tenants where id=inv.tenant_id and status in ('active','trial') for update;
  if not found then raise exception 'Business unavailable' using errcode='42501'; end if;
  if (select count(*) from cb_members where tenant_id=b.id and active)>=b.user_limit then raise exception 'User limit reached' using errcode='22023'; end if;
  insert into cb_members(tenant_id,user_id,name,email,role,team_id) values(inv.tenant_id,auth.uid(),inv.name,lower(inv.email),inv.role,inv.team_id);
  update cb_invitations set used_at=now() where id=inv.id;
  insert into cb_audit(tenant_id,actor_id,action,entity_id) values(inv.tenant_id,auth.uid(),p_action,inv.id);
  return jsonb_build_object('tenant_id',inv.tenant_id);
 end if;
 r:=cb_role(p_tenant);
 if p_action in ('invite.create','invite.revoke') then
  if r is distinct from 'admin' and not cb_platform() then raise exception 'Forbidden' using errcode='42501'; end if;
  if cb_platform() and r is distinct from 'admin' and p_action='invite.create' and p_data->>'role' is distinct from 'admin' then raise exception 'Platform may invite administrators only' using errcode='42501'; end if;
  if p_action='invite.revoke' then
   update cb_invitations set revoked_at=now() where tenant_id=p_tenant and id=(p_data->>'id')::uuid and used_at is null returning id into rid;
   if rid is null then raise exception 'Not found' using errcode='P0002'; end if;
   res:=jsonb_build_object('id',rid);
  else
   select * into b from cb_tenants where id=p_tenant and status in ('active','trial') for update;
   if not found then raise exception 'Business unavailable' using errcode='42501'; end if;
   if (select count(*) from cb_members where tenant_id=p_tenant and active)+(select count(*) from cb_invitations where tenant_id=p_tenant and used_at is null and revoked_at is null and expires_at>now())>=b.user_limit then raise exception 'User limit reached' using errcode='22023'; end if;
   tok:=gen_random_uuid()::text||gen_random_uuid()::text;
   insert into cb_invitations(tenant_id,email,name,role,team_id,token_hash,expires_at)
   values(p_tenant,lower(trim(p_data->>'email')),trim(p_data->>'name'),p_data->>'role',nullif(p_data->>'team_id','')::uuid,
   encode(sha256(convert_to(tok,'UTF8')),'hex'),now()+interval '48 hours') returning id into rid;
   res:=jsonb_build_object('id',rid,'token',tok,'delivery','manual','expires_in_hours',48);
  end if;
  insert into cb_audit(tenant_id,actor_id,action,entity_id) values(p_tenant,auth.uid(),p_action,rid); return res;
 end if;
 if r is null then raise exception 'Account disabled, business suspended, or access unavailable' using errcode='42501'; end if;
 if p_action='notification.read' then
  update cb_notifications set read_at=now() where tenant_id=p_tenant and user_id=auth.uid() and id=(p_data->>'id')::uuid;
  return '{"ok":true}';
 end if;
 if p_action='preferences.update' then
  insert into cb_preferences(tenant_id,user_id,in_app) values(p_tenant,auth.uid(),(p_data->>'in_app')::boolean)
  on conflict(tenant_id,user_id) do update set in_app=excluded.in_app; return '{"ok":true}';
 end if;
 if r='auditor' then raise exception 'Read-only account' using errcode='42501'; end if;
 if p_action in ('team.create','member.update','settings.update','import.clients','export.log') and r<>'admin' then raise exception 'Administrator required' using errcode='42501'; end if;
 if p_action='team.create' then
  insert into cb_teams(tenant_id,name,branch) values(p_tenant,trim(p_data->>'name'),coalesce(p_data->>'branch','')) returning id into rid;
 elsif p_action='member.update' then
  rid:=(p_data->>'user_id')::uuid;
  if rid=auth.uid() then raise exception 'You cannot change your own access' using errcode='22023'; end if;
  select * into b from cb_tenants where id=p_tenant for update;
  select * into m from cb_members where tenant_id=p_tenant and user_id=rid for update;
  if not found then raise exception 'Not found' using errcode='P0002'; end if;
  if not m.active and (p_data->>'active')::boolean and (select count(*) from cb_members where tenant_id=p_tenant and active)>=b.user_limit then raise exception 'User limit reached' using errcode='22023'; end if;
  update cb_members set role=p_data->>'role',active=(p_data->>'active')::boolean,team_id=nullif(p_data->>'team_id','')::uuid,version=version+1
  where tenant_id=p_tenant and user_id=rid and version=(p_data->>'version')::int;
  if not found then raise exception 'Conflict: reload this record' using errcode='40001'; end if;
 elsif p_action='settings.update' then
  if not exists(select 1 from pg_timezone_names where name=p_data->>'timezone') then raise exception 'Invalid timezone' using errcode='22023'; end if;
  update cb_tenants set name=trim(p_data->>'name'),timezone=p_data->>'timezone',
  escalation_hours=(p_data->>'escalation_hours')::int,profile=coalesce(p_data->'profile','{}'),version=version+1
  where id=p_tenant and version=(p_data->>'version')::int returning id into rid;
  if not found then raise exception 'Conflict: reload this record' using errcode='40001'; end if;
 elsif p_action='import.clients' then
  select * into b from cb_tenants where id=p_tenant for update;
  select * into j from cb_imports where tenant_id=p_tenant and request_key=(p_data->>'request_key')::uuid;
  if found then return to_jsonb(j); end if;
  if jsonb_typeof(p_data->'rows') is distinct from 'array' or jsonb_array_length(p_data->'rows') not between 1 and 500 then raise exception 'Import requires 1 to 500 validated rows' using errcode='22023'; end if;
  for rowdata in select value from jsonb_array_elements(p_data->'rows') loop
   if length(trim(coalesce(rowdata->>'name','')))<2 or length(trim(coalesce(rowdata->>'code','')))=0
   or (nullif(rowdata->>'email','') is null and nullif(rowdata->>'phone','') is null)
   or (nullif(rowdata->>'email','') is not null and (rowdata->>'email') !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
   or (nullif(rowdata->>'phone','') is not null and (rowdata->>'phone') !~ '^\+[1-9][0-9]{7,14}$')
   then raise exception 'Invalid import row' using errcode='22023'; end if;
   if exists(select 1 from cb_clients where tenant_id=p_tenant and
    (code=rowdata->>'code' or (archived_at is null and (lower(email)=lower(nullif(rowdata->>'email','')) or phone=nullif(rowdata->>'phone',''))))) then
    if p_data->>'duplicates'='skip' then skipped:=skipped+1; continue; else raise exception 'Duplicate client in import' using errcode='23505'; end if;
   end if;
   perform cb_command(p_tenant,'client.create',rowdata); n:=n+1;
  end loop;
  insert into cb_imports(tenant_id,actor_id,request_key,rows_created,rows_skipped)
  values(p_tenant,auth.uid(),(p_data->>'request_key')::uuid,n,skipped) returning * into j; res:=to_jsonb(j); rid:=j.id;
 elsif p_action='export.log' then
  insert into cb_audit(tenant_id,actor_id,action,detail) values(p_tenant,auth.uid(),p_action,p_data); return '{"ok":true}';
 elsif p_action='client.create' then
  select * into b from cb_tenants where id=p_tenant for update;
  if (select count(*) from cb_clients where tenant_id=p_tenant and archived_at is null)>=b.client_limit then raise exception 'Client limit reached' using errcode='22023'; end if;
  own:=nullif(p_data->>'owner_id','')::uuid; if r='rm' then own:=auth.uid(); end if; team:=null;
  if own is not null then
   select team_id into team from cb_members where tenant_id=p_tenant and user_id=own and active and role<>'auditor';
   if not found then raise exception 'Invalid owner' using errcode='22023'; end if;
  end if;
  if not cb_scope(p_tenant,own,team,true) then raise exception 'Assignment outside your scope' using errcode='42501'; end if;
  insert into cb_clients(tenant_id,code,name,email,phone,kind,owner_id,team_id,segment,source,consent)
  values(p_tenant,trim(p_data->>'code'),trim(p_data->>'name'),lower(nullif(trim(p_data->>'email'),'')),nullif(trim(p_data->>'phone'),''),
  coalesce(p_data->>'kind','prospect'),own,team,coalesce(p_data->>'segment',''),coalesce(p_data->>'source',''),coalesce((p_data->>'consent')::boolean,false))
  returning * into c; rid:=c.id; res:=to_jsonb(c);
  insert into cb_timeline(tenant_id,client_id,actor_id,kind,summary) values(p_tenant,rid,auth.uid(),'created','Client created');
  if own is not null then insert into cb_notifications(tenant_id,user_id,client_id,message,event_key) values(p_tenant,own,rid,'A client has been assigned to you','client:'||rid); end if;
 elsif p_action in ('client.update','client.assign','client.archive','interaction.create') then
  select * into c from cb_clients where tenant_id=p_tenant and id=(p_data->>'id')::uuid and archived_at is null for update;
  if not found or not cb_scope(p_tenant,c.owner_id,c.team_id,true) then raise exception 'Not found' using errcode='P0002'; end if;
  rid:=c.id; old_data:=to_jsonb(c);
  if (p_data->>'version')::int is distinct from c.version then raise exception 'Conflict: reload this record' using errcode='40001'; end if;
  if p_action='client.assign' then
   if r not in ('admin','manager') then raise exception 'Assignment permission required' using errcode='42501'; end if;
   own:=(p_data->>'owner_id')::uuid;
   select team_id into team from cb_members where tenant_id=p_tenant and user_id=own and active and role<>'auditor';
   if not found or not cb_scope(p_tenant,own,team,true) then raise exception 'Invalid owner or team scope' using errcode='42501'; end if;
   update cb_clients set owner_id=own,team_id=team,version=version+1,updated_at=now() where id=c.id;
   update cb_followups set owner_id=own,team_id=team,version=version+1,updated_at=now()
   where tenant_id=p_tenant and client_id=c.id and archived_at is null and status not in ('Won','Lost','Cancelled');
   insert into cb_notifications(tenant_id,user_id,client_id,message,event_key) values(p_tenant,own,c.id,'A client and their open follow-ups were reassigned to you','assign:'||gen_random_uuid());
  elsif p_action='client.archive' then
   if exists(select 1 from cb_followups where client_id=c.id and archived_at is null and status not in ('Won','Lost','Cancelled')) then raise exception 'Close or archive open follow-ups first' using errcode='22023'; end if;
   update cb_clients set archived_at=now(),version=version+1,updated_at=now() where id=c.id;
  elsif p_action='client.update' then
   update cb_clients set name=trim(p_data->>'name'),email=lower(nullif(trim(p_data->>'email'),'')),phone=nullif(trim(p_data->>'phone'),''),
   kind=coalesce(p_data->>'kind',kind),segment=coalesce(p_data->>'segment',segment),source=coalesce(p_data->>'source',source),
   consent=coalesce((p_data->>'consent')::boolean,consent),version=version+1,updated_at=now() where id=c.id;
  else
   if length(trim(coalesce(p_data->>'summary','')))=0 then raise exception 'Interaction summary required' using errcode='22023'; end if;
   if coalesce(p_data->>'channel','') not in ('call','meeting','email','whatsapp','video','other','note') then raise exception 'Invalid interaction channel' using errcode='22023'; end if;
   update cb_clients set last_contact_at=case when p_data->>'channel'='note' then last_contact_at else now() end,version=version+1,updated_at=now() where id=c.id;
  end if;
  insert into cb_timeline(tenant_id,client_id,actor_id,kind,summary,detail) values(p_tenant,c.id,auth.uid(),p_action,
   case when p_action='interaction.create' then p_data->>'summary' else replace(p_action,'.',' ') end,
   case when p_action='interaction.create' then jsonb_build_object('channel',p_data->>'channel','direction',p_data->>'direction','next_action',p_data->>'next_action')
   else jsonb_build_object('before',old_data,'changes',p_data) end);
 elsif p_action='followup.create' then
  select * into c from cb_clients where tenant_id=p_tenant and id=(p_data->>'client_id')::uuid and archived_at is null for update;
  if not found or not cb_scope(p_tenant,c.owner_id,c.team_id,true) then raise exception 'Not found' using errcode='P0002'; end if;
  if c.owner_id is null then raise exception 'Assign the client before creating a follow-up' using errcode='22023'; end if;
  if not exists(select 1 from cb_members where tenant_id=p_tenant and user_id=c.owner_id and active and role<>'auditor') then raise exception 'Client owner is disabled' using errcode='22023'; end if;
  insert into cb_followups(tenant_id,client_id,owner_id,team_id,title,reason,description,channel,priority,value_paise,due_at,reminder_at,next_action,product)
  values(p_tenant,c.id,c.owner_id,c.team_id,trim(p_data->>'title'),trim(p_data->>'reason'),coalesce(p_data->>'description',''),
  coalesce(p_data->>'channel','call'),coalesce(p_data->>'priority','normal'),coalesce((p_data->>'value_paise')::bigint,0),
  nullif(p_data->>'due_at','')::timestamptz,nullif(p_data->>'reminder_at','')::timestamptz,coalesce(p_data->>'next_action',''),coalesce(p_data->>'product',''))
  returning * into f; rid:=f.id; res:=to_jsonb(f);
  insert into cb_timeline(tenant_id,client_id,followup_id,actor_id,kind,summary) values(p_tenant,c.id,f.id,auth.uid(),'followup.created',f.title);
  insert into cb_notifications(tenant_id,user_id,client_id,followup_id,message,event_key) values(p_tenant,f.owner_id,c.id,f.id,'A follow-up has been assigned to you','followup:'||f.id);
 elsif p_action in ('followup.update','followup.archive') then
  select * into f from cb_followups where tenant_id=p_tenant and id=(p_data->>'id')::uuid and archived_at is null for update;
  if not found or not cb_scope(p_tenant,f.owner_id,f.team_id,true) or not cb_client_scope(p_tenant,f.client_id,true) then raise exception 'Not found' using errcode='P0002'; end if;
  if (p_data->>'version')::int is distinct from f.version then raise exception 'Conflict: reload this record' using errcode='40001'; end if;
  rid:=f.id; old_data:=to_jsonb(f);
  if p_action='followup.archive' then
   update cb_followups set archived_at=now(),version=version+1,updated_at=now() where id=f.id;
  else
   st:=p_data->>'status';
   update cb_followups set status=st,due_at=nullif(p_data->>'due_at','')::timestamptz,
   no_date_reason=coalesce(p_data->>'no_date_reason',''),outcome_note=coalesce(p_data->>'outcome_note',''),
   loss_reason=coalesce(p_data->>'loss_reason',''),next_action=coalesce(p_data->>'next_action',''),
   converted_paise=coalesce((p_data->>'converted_paise')::bigint,0),
   completed_at=case when st in ('Won','Lost','Cancelled') then coalesce(completed_at,now()) else null end,
   updated_at=now(),version=version+1 where id=f.id;
  end if;
  insert into cb_timeline(tenant_id,client_id,followup_id,actor_id,kind,summary,detail)
  values(p_tenant,f.client_id,f.id,auth.uid(),p_action,case when p_action='followup.archive' then 'Follow-up archived' else f.status||' → '||st end,
  jsonb_build_object('before',old_data,'changes',p_data));
 else raise exception 'Unknown operation' using errcode='22023';
 end if;
 insert into cb_audit(tenant_id,actor_id,action,entity_id) values(p_tenant,auth.uid(),p_action,rid);
 return coalesce(res,jsonb_build_object('id',rid,'ok',true));
end$$;
revoke all on function cb_command(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function cb_command(uuid,text,jsonb) to authenticated;
commit;


-- ============================================================
-- 202609170003_queries_jobs.sql
-- sha256:aa5db2c25ccd4569
-- ============================================================

begin;
create function cb_session() returns jsonb language sql stable security definer set search_path=public as $$
select jsonb_build_object('user_id',auth.uid(),'platform',cb_platform(),'memberships',coalesce(
(select jsonb_agg(jsonb_build_object('tenant_id',m.tenant_id,'name',m.name,'role',m.role,'team_id',m.team_id,
'active',m.active,'tenant_name',t.name,'tenant_status',t.status,'timezone',t.timezone))
from cb_members m join cb_tenants t on t.id=m.tenant_id where m.user_id=auth.uid()),'[]'::jsonb))$$;
create function cb_invitations_list(t uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
 if cb_role(t) is distinct from 'admin' and not cb_platform() then raise exception 'Forbidden' using errcode='42501'; end if;
 return coalesce((select jsonb_agg(to_jsonb(x)) from (select id,tenant_id,email,name,role,team_id,expires_at,used_at,revoked_at,created_at from cb_invitations where tenant_id=t order by created_at desc limit 100)x),'[]');
end$$;
create function cb_filtered(t uuid,filters jsonb default '{}') returns setof cb_followups language sql stable security invoker set search_path=public as $$
select f.* from cb_followups f join cb_tenants b on b.id=f.tenant_id
where f.tenant_id=t and f.archived_at is null
and (nullif(filters->>'client_id','') is null or f.client_id=(filters->>'client_id')::uuid)
and (nullif(filters->>'owner_id','') is null or f.owner_id=(filters->>'owner_id')::uuid)
and (nullif(filters->>'status','') is null or f.status=filters->>'status')
and (nullif(filters->>'priority','') is null or f.priority=filters->>'priority')
and (nullif(filters->>'q','') is null or strpos(lower(f.title||' '||f.reason),lower(filters->>'q'))>0)
and (case coalesce(filters->>'bucket','')
when 'open' then f.status not in ('Won','Lost','Cancelled')
when 'overdue' then f.status not in ('Won','Lost','Cancelled') and f.due_at<now()
when 'today' then f.status not in ('Won','Lost','Cancelled') and (f.due_at at time zone b.timezone)::date=(now() at time zone b.timezone)::date
when 'upcoming' then f.status not in ('Won','Lost','Cancelled') and f.due_at>now()
when 'unplanned' then f.status not in ('Won','Lost','Cancelled') and f.due_at is null
when 'completed' then f.status in ('Won','Lost','Cancelled') else true end)$$;
create function cb_metrics(t uuid,filters jsonb default '{}') returns jsonb language sql stable security invoker set search_path=public as $$
select jsonb_build_object('total',count(*),'open',count(*) filter(where status not in ('Won','Lost','Cancelled')),
'overdue',count(*) filter(where status not in ('Won','Lost','Cancelled') and due_at<now()),
'unplanned',count(*) filter(where status not in ('Won','Lost','Cancelled') and due_at is null),
'won',count(*) filter(where status='Won'),'lost',count(*) filter(where status='Lost'),
'value_paise',coalesce(sum(value_paise) filter(where status not in ('Won','Lost','Cancelled')),0),
'converted_paise',coalesce(sum(converted_paise) filter(where status='Won'),0),
'on_time',count(*) filter(where completed_at is not null and due_at is not null and completed_at<=due_at),
'completed_with_due',count(*) filter(where completed_at is not null and due_at is not null))
from cb_filtered(t,filters)$$;
create function cb_followups_page(t uuid,filters jsonb default '{}',page_number int default 1) returns jsonb language sql stable security invoker set search_path=public as $$
select jsonb_build_object('total',(select count(*) from cb_filtered(t,filters)),'rows',coalesce((select jsonb_agg(to_jsonb(x)) from
(select f.*,c.name client_name from cb_filtered(t,filters) f join cb_clients c on c.tenant_id=f.tenant_id and c.id=f.client_id
order by (f.status not in ('Won','Lost','Cancelled') and f.due_at<now()) desc,
case f.priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end,
f.due_at asc nulls last,f.value_paise desc,f.id limit 30 offset (greatest(1,least(page_number,100000))-1)*30)x),'[]'::jsonb))$$;
create function cb_reminders() returns int language plpgsql security definer set search_path=public as $$
declare n int; extra int;
begin
 insert into cb_notifications(tenant_id,user_id,client_id,followup_id,message,event_key)
 select f.tenant_id,f.owner_id,f.client_id,f.id,
 case when f.due_at<now() then 'Overdue follow-up requires action' else 'A follow-up reminder is due' end,
 'due:'||f.id||':'||coalesce(f.due_at::text,f.reminder_at::text)||':'||(case when f.due_at<now() then 'overdue' else 'reminder' end)
 from cb_followups f join cb_tenants t on t.id=f.tenant_id join cb_members m on m.tenant_id=f.tenant_id and m.user_id=f.owner_id
 where t.status in ('active','trial') and m.active and f.archived_at is null and f.status not in ('Won','Lost','Cancelled')
 and (f.due_at<now() or f.reminder_at<=now())
 and not exists(select 1 from cb_preferences p where p.tenant_id=f.tenant_id and p.user_id=f.owner_id and not p.in_app)
 on conflict(event_key) do nothing;
 get diagnostics n=row_count;
 insert into cb_notifications(tenant_id,user_id,client_id,followup_id,message,event_key)
 select f.tenant_id,m.user_id,f.client_id,f.id,'Escalation: follow-up remains overdue','escalation:'||f.id||':'||f.due_at::text||':'||m.user_id
 from cb_followups f join cb_tenants t on t.id=f.tenant_id join cb_members m on m.tenant_id=f.tenant_id
 where t.status in ('active','trial') and m.active and (m.role='admin' or (m.role='manager' and m.team_id=f.team_id))
 and f.archived_at is null and f.status not in ('Won','Lost','Cancelled') and f.due_at<now()-make_interval(hours=>t.escalation_hours)
 and not exists(select 1 from cb_preferences p where p.tenant_id=m.tenant_id and p.user_id=m.user_id and not p.in_app)
 on conflict(event_key) do nothing;
 get diagnostics extra=row_count; return n+extra;
end$$;
revoke all on function cb_session(),cb_invitations_list(uuid),cb_filtered(uuid,jsonb),cb_metrics(uuid,jsonb),cb_followups_page(uuid,jsonb,int),cb_reminders() from public,anon,authenticated;
grant execute on function cb_session(),cb_invitations_list(uuid),cb_filtered(uuid,jsonb),cb_metrics(uuid,jsonb),cb_followups_page(uuid,jsonb,int) to authenticated;
grant execute on function cb_reminders() to service_role;
commit;


-- ============================================================
-- 202609170004_session_security.sql
-- sha256:248660b37c336c63
-- ============================================================

begin;
-- App-level revocation closes the access-token window left by provider sign-out.
create table cb_revocations(user_id uuid primary key references auth.users(id),revoked_before bigint not null);
create table cb_revoked_sessions(user_id uuid not null references auth.users(id),session_id text not null,primary key(user_id,session_id));
create table cb_auth_limits(key text primary key,attempts int not null default 0,window_start timestamptz not null default now());
alter table cb_revocations enable row level security;
alter table cb_revoked_sessions enable row level security;
alter table cb_auth_limits enable row level security;
revoke all on cb_revocations,cb_revoked_sessions,cb_auth_limits from anon,authenticated;
create function cb_access_valid() returns boolean language sql stable security definer set search_path=public as $$
select auth.uid() is not null
and not exists(select 1 from cb_revocations where user_id=auth.uid() and revoked_before>=coalesce((auth.jwt()->>'iat')::bigint,0))
and not exists(select 1 from cb_revoked_sessions where user_id=auth.uid() and session_id=auth.jwt()->>'session_id')$$;
create or replace function cb_platform() returns boolean language sql stable security definer set search_path=public
as $$select cb_access_valid() and exists(select 1 from cb_platform_admins where user_id=auth.uid())$$;
create or replace function cb_role(t uuid) returns text language sql stable security definer set search_path=public
as $$select m.role from cb_members m join cb_tenants b on b.id=m.tenant_id where cb_access_valid() and m.tenant_id=t and m.user_id=auth.uid() and m.active and b.status in ('trial','active')$$;
create or replace function cb_scope(t uuid,o uuid,g uuid,writing boolean default false) returns boolean language sql stable security definer set search_path=public
as $$select cb_access_valid() and exists(select 1 from cb_members m join cb_tenants b on b.id=t
where m.tenant_id=t and m.user_id=auth.uid() and m.active and b.status in ('trial','active')
and (m.role='admin' or (m.role='auditor' and not writing) or (m.role='manager' and m.team_id=g and g is not null) or (m.role='rm' and o=m.user_id)))$$;
create or replace function cb_session() returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
if not cb_access_valid() then raise exception 'Session revoked. Please sign in again' using errcode='28000'; end if;
return jsonb_build_object('user_id',auth.uid(),'platform',cb_platform(),'memberships',coalesce(
(select jsonb_agg(jsonb_build_object('tenant_id',m.tenant_id,'name',m.name,'role',m.role,'team_id',m.team_id,
'active',m.active,'tenant_name',t.name,'tenant_status',t.status,'timezone',t.timezone))
from cb_members m join cb_tenants t on t.id=m.tenant_id where m.user_id=auth.uid()),'[]'::jsonb));
end$$;
create function cb_logout(all_devices boolean default false) returns void language plpgsql security definer set search_path=public as $$
begin
if auth.uid() is null then raise exception 'Authentication required' using errcode='28000'; end if;
if all_devices then
 insert into cb_revocations values(auth.uid(),extract(epoch from clock_timestamp())::bigint)
 on conflict(user_id) do update set revoked_before=excluded.revoked_before;
else
 if auth.jwt()->>'session_id' is null then raise exception 'Session identifier missing' using errcode='28000'; end if;
 insert into cb_revoked_sessions values(auth.uid(),auth.jwt()->>'session_id') on conflict do nothing;
end if;
insert into cb_audit(actor_id,action) values(auth.uid(),case when all_devices then 'auth.logout_all' else 'auth.logout' end);
end$$;
-- Service-only persistent abuse limits. Account key and network key are HMACed by the server.
create function cb_auth_attempt(p_key text,p_event text) returns boolean language plpgsql security definer set search_path=public as $$
declare item cb_auth_limits;
begin
if p_key !~ '^[a-f0-9]{64}$' then raise exception 'Invalid limiter key' using errcode='22023'; end if;
insert into cb_auth_limits(key) values(p_key) on conflict do nothing;
select * into item from cb_auth_limits where key=p_key for update;
if item.window_start<now()-interval '15 minutes' then
 update cb_auth_limits set attempts=0,window_start=now() where key=p_key;item.attempts:=0;
end if;
if p_event='success' then
 update cb_auth_limits set attempts=0 where key=p_key;
 insert into cb_audit(action,detail) values('auth.login',jsonb_build_object('subject_hash',p_key));
 return true;
end if;
if p_event='failure' then
 insert into cb_audit(action,detail) values('auth.failed_login',jsonb_build_object('subject_hash',p_key));return true;
end if;
if p_event<>'attempt' then raise exception 'Invalid event' using errcode='22023';end if;
if item.attempts>=10 then return false;end if;
update cb_auth_limits set attempts=attempts+1 where key=p_key;
return true;
end$$;
revoke all on function cb_access_valid(),cb_logout(boolean),cb_auth_attempt(text,text) from public,anon,authenticated;
grant execute on function cb_access_valid(),cb_logout(boolean) to authenticated;
grant execute on function cb_auth_attempt(text,text) to service_role;
commit;


-- ============================================================
-- 202609180005_operations.sql
-- sha256:acd82083e7c24c39
-- ============================================================

begin;
create table cb_saved_filters(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,user_id uuid not null,
 name text not null check(length(trim(name)) between 1 and 80),filters jsonb not null default '{}',
 created_at timestamptz not null default now(),unique(tenant_id,user_id,name),
 foreign key(tenant_id,user_id) references cb_members(tenant_id,user_id));
create table cb_master_data(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references cb_tenants,
 kind text not null check(kind in ('segment','tag','reason','loss_reason','product','custom_field')),
 name text not null check(length(trim(name)) between 1 and 120),active boolean not null default true,
 version int not null default 1,created_at timestamptz not null default now(),unique(tenant_id,kind,name));
create table cb_plans(
 id uuid primary key default gen_random_uuid(),name text not null unique check(length(trim(name)) between 1 and 100),
 user_limit int not null check(user_limit>0),client_limit int not null check(client_limit>0),
 active boolean not null default true,created_at timestamptz not null default now());
insert into cb_plans(name,user_limit,client_limit) values('Starter',10,1000);
alter table cb_saved_filters enable row level security;
create policy own_filters on cb_saved_filters for select to authenticated using(user_id=auth.uid() and cb_role(tenant_id) is not null);
alter table cb_master_data enable row level security;
create policy master_read on cb_master_data for select to authenticated using(cb_role(tenant_id) is not null);
alter table cb_plans enable row level security;
create policy plan_read on cb_plans for select to authenticated using(cb_platform());
revoke all on cb_saved_filters,cb_master_data,cb_plans from anon,authenticated;
grant select on cb_saved_filters,cb_master_data,cb_plans to authenticated;
-- Extensible commands remain transactional and reuse the already-tested core authorization.
alter function cb_command(uuid,text,jsonb) rename to cb_core_command;
create function cb_command(p_tenant uuid,p_action text,p_data jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=public as $$
declare r text;rowdata jsonb;rid uuid;f cb_followups;c cb_clients;event cb_timeline;result jsonb;count_done int:=0;
begin
 if not cb_access_valid() then raise exception 'Authentication required' using errcode='28000';end if;
 r:=cb_role(p_tenant);
 if p_action='plan.create' then
  if not cb_platform() then raise exception 'Forbidden' using errcode='42501';end if;
  insert into cb_plans(name,user_limit,client_limit) values(trim(p_data->>'name'),(p_data->>'user_limit')::int,(p_data->>'client_limit')::int) returning id into rid;
  insert into cb_audit(actor_id,action,entity_id) values(auth.uid(),p_action,rid);
  return jsonb_build_object('id',rid);
 end if;
 if p_action='saved_filter.create' then
  if r is null then raise exception 'Forbidden' using errcode='42501';end if;
  if (select count(*) from cb_saved_filters where tenant_id=p_tenant and user_id=auth.uid())>=30 then raise exception 'Saved filter limit reached' using errcode='22023';end if;
  insert into cb_saved_filters(tenant_id,user_id,name,filters) values(p_tenant,auth.uid(),trim(p_data->>'name'),p_data->'filters') returning id into rid;
  return jsonb_build_object('id',rid);
 end if;
 if p_action in ('master.create','master.update') then
  if r is distinct from 'admin' then raise exception 'Administrator required' using errcode='42501';end if;
  if p_action='master.create' then
   insert into cb_master_data(tenant_id,kind,name) values(p_tenant,p_data->>'kind',trim(p_data->>'name')) returning id into rid;
  else
   update cb_master_data set active=(p_data->>'active')::boolean,version=version+1
   where tenant_id=p_tenant and id=(p_data->>'id')::uuid and version=(p_data->>'version')::int returning id into rid;
   if rid is null then raise exception 'Conflict: reload this record' using errcode='40001';end if;
  end if;
  insert into cb_audit(tenant_id,actor_id,action,entity_id) values(p_tenant,auth.uid(),p_action,rid);
  return jsonb_build_object('id',rid);
 end if;
 if p_action='bulk.followup.update' then
  if r is null or r='auditor' then raise exception 'Forbidden' using errcode='42501';end if;
  if jsonb_typeof(p_data->'items') is distinct from 'array' or jsonb_array_length(p_data->'items') not between 1 and 100 then raise exception 'Select 1 to 100 records' using errcode='22023';end if;
  for rowdata in select value from jsonb_array_elements(p_data->'items') loop
   perform cb_core_command(p_tenant,'followup.update',(p_data->'changes')||jsonb_build_object('id',rowdata->'id','version',rowdata->'version'));
   count_done:=count_done+1;
  end loop;
  return jsonb_build_object('updated',count_done);
 end if;
 if p_action='followup.duplicate' then
  select * into f from cb_followups where tenant_id=p_tenant and id=(p_data->>'id')::uuid and archived_at is null;
  if not found or not cb_scope(p_tenant,f.owner_id,f.team_id,true) or not cb_client_scope(p_tenant,f.client_id,true) then raise exception 'Not found' using errcode='P0002';end if;
  return cb_core_command(p_tenant,'followup.create',jsonb_build_object('client_id',f.client_id,'title',left(f.title,190)||' (copy)','reason',f.reason,'description',f.description,'channel',f.channel,'priority',f.priority,'value_paise',f.value_paise,'next_action',f.next_action,'product',f.product));
 end if;
 if p_action='interaction.correct' then
  if r is distinct from 'admin' then raise exception 'Administrator required' using errcode='42501';end if;
  select * into event from cb_timeline where tenant_id=p_tenant and id=(p_data->>'id')::uuid;
  if not found then raise exception 'Not found' using errcode='P0002';end if;
  insert into cb_timeline(tenant_id,client_id,followup_id,actor_id,kind,summary,detail)
  values(p_tenant,event.client_id,event.followup_id,auth.uid(),'correction',trim(p_data->>'summary'),
   jsonb_build_object('original_event_id',event.id,'original_summary',event.summary,'reason',p_data->>'reason')) returning id into rid;
  insert into cb_audit(tenant_id,actor_id,action,entity_id) values(p_tenant,auth.uid(),p_action,rid);
  return jsonb_build_object('id',rid);
 end if;
 if p_action in ('client.create','client.update','followup.create','followup.update') then
  if exists(select 1 from cb_master_data where tenant_id=p_tenant and not active and
   ((kind='segment' and name=p_data->>'segment') or (kind='reason' and name=p_data->>'reason') or
    (kind='product' and name=p_data->>'product') or (kind='loss_reason' and name=p_data->>'loss_reason')))
  then raise exception 'A selected master value is inactive' using errcode='22023';end if;
 end if;
 return cb_core_command(p_tenant,p_action,p_data);
end$$;
-- Core cannot be called directly after adding the wrapper.
revoke execute on function cb_core_command(uuid,text,jsonb) from authenticated,anon,public;
revoke all on function cb_command(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function cb_command(uuid,text,jsonb) to authenticated;
create function cb_usage() returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
 if not cb_platform() then raise exception 'Forbidden' using errcode='42501';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('tenant_id',t.id,
 'users',(select count(*) from cb_members m where m.tenant_id=t.id and m.active),
 'clients',(select count(*) from cb_clients c where c.tenant_id=t.id and c.archived_at is null),
 'followups',(select count(*) from cb_followups f where f.tenant_id=t.id and f.archived_at is null),
 'imports',(select count(*) from cb_imports i where i.tenant_id=t.id)))
 from cb_tenants t),'[]');
end$$;
revoke all on function cb_usage() from public,anon,authenticated;
grant execute on function cb_usage() to authenticated;
commit;


-- ============================================================
-- 202609260006_invite_accept_identity.sql
-- sha256:9715d5d8ec366973
-- ============================================================

begin;
-- An invitation is bound to the invited email. The single generic error made a signed-in email
-- mismatch look like an expired token. Keep the generic message for a token that is genuinely
-- unknown, expired or already used, and name the required account when the token is valid but
-- the caller is signed in as somebody else.
alter function cb_command(uuid,text,jsonb) rename to cb_command_prev;
create function cb_command(p_tenant uuid,p_action text,p_data jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=public as $$
declare invited_email text;
begin
 if not cb_access_valid() then raise exception 'Authentication required' using errcode='28000';end if;
 if p_action='invite.accept' then
  select email into invited_email from cb_invitations
  where token_hash=encode(sha256(convert_to(p_data->>'token','UTF8')),'hex')
  and used_at is null and revoked_at is null and expires_at>now();
  if invited_email is not null and lower(invited_email)<>lower(coalesce(auth.jwt()->>'email','')) then
   raise exception 'Sign in as % to accept this invitation', invited_email using errcode='42501';
  end if;
 end if;
 return cb_command_prev(p_tenant,p_action,p_data);
end$$;
-- The previous definition must not stay directly callable.
revoke execute on function cb_command_prev(uuid,text,jsonb) from authenticated,anon,public;
revoke all on function cb_command(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function cb_command(uuid,text,jsonb) to authenticated;
commit;

-- ============================================================
-- Ledger: record what was applied so tools can skip it safely.
-- ============================================================

begin;

create table if not exists cb_schema_migrations (
  version    text primary key,
  checksum   text not null,
  applied_at timestamptz not null default now()
);

insert into cb_schema_migrations (version, checksum) values ('202609170001_schema.sql', '5e4d9ccf33c9c35d') on conflict (version) do nothing;
insert into cb_schema_migrations (version, checksum) values ('202609170002_commands.sql', '02ebafadbc49ec43') on conflict (version) do nothing;
insert into cb_schema_migrations (version, checksum) values ('202609170003_queries_jobs.sql', 'aa5db2c25ccd4569') on conflict (version) do nothing;
insert into cb_schema_migrations (version, checksum) values ('202609170004_session_security.sql', '248660b37c336c63') on conflict (version) do nothing;
insert into cb_schema_migrations (version, checksum) values ('202609180005_operations.sql', 'acd82083e7c24c39') on conflict (version) do nothing;
insert into cb_schema_migrations (version, checksum) values ('202609260006_invite_accept_identity.sql', '9715d5d8ec366973') on conflict (version) do nothing;

commit;
