begin;
-- Machine integration channel for an external system (IDash-App). One credential per business.
-- Only a SHA-256 hash of the key is stored; the plaintext exists once, at issue time. The channel is
-- separate from the session gateway and never reuses CRON_SECRET. A machine caller cannot issue or
-- rotate its own credential: those functions require an authenticated business administrator.
create table cb_integration_credentials(
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references cb_tenants,
 label text not null check(length(trim(label)) between 2 and 80),
 key_prefix text not null check(length(key_prefix) between 4 and 12),
 key_hash text not null unique check(key_hash ~ '^[a-f0-9]{64}$'),
 status text not null default 'active' check(status in ('active','revoked')),
 created_at timestamptz not null default now(),
 rotated_at timestamptz,
 revoked_at timestamptz,
 last_used_at timestamptz);
create unique index cb_integration_credentials_label on cb_integration_credentials(tenant_id,label) where status='active';
create index cb_integration_credentials_scope on cb_integration_credentials(tenant_id,status);

-- Append-only record of attempts. Deliberately minimal: no IP address, no request body, no secret.
create table cb_integration_audit(
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid references cb_tenants,
 credential_id uuid references cb_integration_credentials(id),
 endpoint text not null,
 outcome text not null check(outcome in ('ok','invalid','revoked','rate_limited','bad_request')),
 detail jsonb not null default '{}',
 created_at timestamptz not null default now());
create index cb_integration_audit_recent on cb_integration_audit(created_at desc);
create trigger immutable_integration_audit before update or delete on cb_integration_audit for each row execute function cb_immutable();

alter table cb_integration_credentials enable row level security;
alter table cb_integration_audit enable row level security;
revoke all on cb_integration_credentials,cb_integration_audit from anon,authenticated;

-- Resolves a presented key hash to its tenant. Returns null when unknown, or an error marker when
-- the credential is revoked. Service-only: the server calls it with the service credential.
create function cb_integration_authenticate(p_key_hash text) returns jsonb language plpgsql security definer set search_path=public as $$
declare cred cb_integration_credentials;
begin
 if p_key_hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid credential hash' using errcode='22023'; end if;
 select * into cred from cb_integration_credentials where key_hash=p_key_hash;
 if not found then return null; end if;
 if cred.status<>'active' or cred.revoked_at is not null then
  return jsonb_build_object('error','revoked','credential_id',cred.id,'tenant_id',cred.tenant_id);
 end if;
 update cb_integration_credentials set last_used_at=now() where id=cred.id;
 return jsonb_build_object('credential_id',cred.id,'tenant_id',cred.tenant_id,'label',cred.label);
end$$;

-- Service-only per-credential rate limiter, reusing the persistent cb_auth_limits store.
create function cb_integration_attempt(p_key text,p_limit int default 600,p_window_seconds int default 60) returns boolean language plpgsql security definer set search_path=public as $$
declare item cb_auth_limits;
begin
 if p_key !~ '^[a-f0-9]{64}$' then raise exception 'Invalid limiter key' using errcode='22023'; end if;
 if p_limit<1 or p_limit>100000 or p_window_seconds<1 or p_window_seconds>86400 then raise exception 'Invalid limit' using errcode='22023'; end if;
 insert into cb_auth_limits(key) values(p_key) on conflict do nothing;
 select * into item from cb_auth_limits where key=p_key for update;
 if item.window_start<now()-(p_window_seconds||' seconds')::interval then
  update cb_auth_limits set attempts=0,window_start=now() where key=p_key;item.attempts:=0;
 end if;
 if item.attempts>=p_limit then return false; end if;
 update cb_auth_limits set attempts=attempts+1 where key=p_key;
 return true;
end$$;

-- Service-only audit append. Keeps the secret out entirely.
create function cb_integration_log(p_tenant uuid,p_credential uuid,p_endpoint text,p_outcome text,p_detail jsonb default '{}') returns void language plpgsql security definer set search_path=public as $$
begin
 if p_endpoint !~ '^[a-z0-9/._-]{1,120}$' then raise exception 'Invalid endpoint' using errcode='22023'; end if;
 if p_outcome not in ('ok','invalid','revoked','rate_limited','bad_request') then raise exception 'Invalid outcome' using errcode='22023'; end if;
 insert into cb_integration_audit(tenant_id,credential_id,endpoint,outcome,detail) values(p_tenant,p_credential,p_endpoint,p_outcome,coalesce(p_detail,'{}'::jsonb));
end$$;

-- Issuance is administrator-only and requires an authenticated session for that tenant. The hash and
-- prefix are computed server-side; the plaintext key never reaches the database.
create function cb_integration_credential_issue(p_tenant uuid,p_label text,p_key_hash text,p_key_prefix text) returns jsonb language plpgsql security definer set search_path=public as $$
declare new_id uuid;
begin
 if not cb_access_valid() then raise exception 'Authentication required' using errcode='28000'; end if;
 if coalesce(cb_role(p_tenant),'')<>'admin' and not coalesce(cb_platform(),false) then raise exception 'Administrator required' using errcode='42501'; end if;
 if p_key_hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid credential hash' using errcode='22023'; end if;
 insert into cb_integration_credentials(tenant_id,label,key_hash,key_prefix) values(p_tenant,trim(p_label),p_key_hash,trim(p_key_prefix)) returning id into new_id;
 insert into cb_audit(tenant_id,actor_id,action,entity_id,detail) values(p_tenant,auth.uid(),'integration.credential.issue',new_id,jsonb_build_object('label',trim(p_label)));
 return jsonb_build_object('credential_id',new_id);
end$$;

-- Rotation revokes the named credential and issues a replacement in one transaction. Also
-- administrator-only, for the tenant that owns the credential.
create function cb_integration_credential_rotate(p_credential uuid,p_key_hash text,p_key_prefix text) returns jsonb language plpgsql security definer set search_path=public as $$
declare cred cb_integration_credentials; new_id uuid;
begin
 if not cb_access_valid() then raise exception 'Authentication required' using errcode='28000'; end if;
 select * into cred from cb_integration_credentials where id=p_credential;
 if not found then raise exception 'Credential not found' using errcode='42501'; end if;
 if coalesce(cb_role(cred.tenant_id),'')<>'admin' and not coalesce(cb_platform(),false) then raise exception 'Administrator required' using errcode='42501'; end if;
 if p_key_hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid credential hash' using errcode='22023'; end if;
 update cb_integration_credentials set status='revoked',revoked_at=now(),rotated_at=now() where id=p_credential;
 insert into cb_integration_credentials(tenant_id,label,key_hash,key_prefix) values(cred.tenant_id,cred.label,p_key_hash,trim(p_key_prefix)) returning id into new_id;
 insert into cb_audit(tenant_id,actor_id,action,entity_id,detail) values(cred.tenant_id,auth.uid(),'integration.credential.rotate',new_id,jsonb_build_object('replaced',p_credential));
 return jsonb_build_object('credential_id',new_id);
end$$;

revoke all on function cb_integration_authenticate(text),cb_integration_attempt(text,int,int),cb_integration_log(uuid,uuid,text,text,jsonb) from public,anon,authenticated;
revoke all on function cb_integration_credential_issue(uuid,text,text,text),cb_integration_credential_rotate(uuid,text,text) from public,anon,authenticated;
grant execute on function cb_integration_authenticate(text),cb_integration_attempt(text,int,int),cb_integration_log(uuid,uuid,text,text,jsonb) to service_role;
grant execute on function cb_integration_credential_issue(uuid,text,text,text),cb_integration_credential_rotate(uuid,text,text) to authenticated;
commit;
