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
