begin;
-- Client identity mapping between an external system (IDash-App) and portfolio-board.
-- A pushed external client is matched to existing clients by exact email or phone for STAFF REVIEW only.
-- Nothing is merged automatically: a pushed client becomes pending_review (with candidates) or unmatched,
-- and only a business administrator or manager of THAT tenant can confirm a link. PAN is accepted only as
-- a sha256 hash, stored for review, never returned to any user and cleared once a link is confirmed.
-- Durable idempotency is enforced by a single atomic function so two concurrent requests with the same
-- key cannot both apply a write.
create table cb_client_links(
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references cb_tenants,
 external_system text not null default 'idash' check(external_system ~ '^[a-z0-9_-]{2,40}$'),
 external_client_id text not null check(length(trim(external_client_id)) between 1 and 120),
 client_id uuid,
 status text not null check(status in ('linked','pending_review','unmatched')),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 reviewed_by uuid,
 reviewed_at timestamptz,
 unique(tenant_id,external_system,external_client_id),
 foreign key(tenant_id,client_id) references cb_clients(tenant_id,id));
create index cb_client_links_queue on cb_client_links(tenant_id,status);

create table cb_client_match_candidates(
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references cb_tenants,
 external_client_id text not null,
 client_id uuid not null,
 score int not null check(score between 1 and 100),
 reason text not null check(length(trim(reason)) between 1 and 200),
 status text not null default 'open' check(status in ('open','confirmed','dismissed')),
 created_at timestamptz not null default now(),
 unique(tenant_id,external_client_id,client_id),
 foreign key(tenant_id,client_id) references cb_clients(tenant_id,id));
create index cb_client_match_open on cb_client_match_candidates(tenant_id,external_client_id,status);

-- The pushed identity, kept so a person can review an unmatched or ambiguous client. Treated as sensitive:
-- never readable directly (grants revoked), never returned with its pan_hash, deletable on request.
create table cb_client_intake(
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references cb_tenants,
 external_system text not null default 'idash',
 external_client_id text not null,
 display_name text not null check(length(trim(display_name)) between 1 and 160),
 email text,
 phone text,
 pan_hash text check(pan_hash is null or pan_hash ~ '^[a-f0-9]{64}$'),
 received_at timestamptz not null default now(),
 unique(tenant_id,external_system,external_client_id));

-- Durable request deduplication for data writes. status: 'reserved' (in flight) or 'done'.
create table cb_integration_requests(
 tenant_id uuid not null references cb_tenants,
 idempotency_key text not null check(length(idempotency_key) between 8 and 120),
 endpoint text not null,
 request_hash text not null check(request_hash ~ '^[a-f0-9]{64}$'),
 response jsonb not null default '{}'::jsonb,
 status text not null default 'reserved' check(status in ('reserved','done')),
 created_at timestamptz not null default now(),
 primary key(tenant_id,idempotency_key));

alter table cb_client_links enable row level security;
alter table cb_client_match_candidates enable row level security;
alter table cb_client_intake enable row level security;
alter table cb_integration_requests enable row level security;
revoke all on cb_client_links,cb_client_match_candidates,cb_client_intake,cb_integration_requests from anon,authenticated;

-- Service-only: performs the match-and-record pass for a pushed client batch and returns per-row results.
create function cb_client_push(p_tenant uuid,p_clients jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare c jsonb; ext text; nm text; em text; ph text; pan text; link cb_client_links; n int; results jsonb:='[]'::jsonb; cand uuid[]; cid uuid; score int; reason text;
begin
 if jsonb_typeof(p_clients)<>'array' then raise exception 'clients must be an array' using errcode='22023'; end if;
 if jsonb_array_length(p_clients)>200 then raise exception 'Too many clients in one push' using errcode='22023'; end if;
 for c in select * from jsonb_array_elements(p_clients) loop
  ext:=trim(coalesce(c->>'external_client_id',''));
  nm:=trim(coalesce(c->>'display_name',''));
  em:=nullif(lower(trim(coalesce(c->>'email',''))),'');
  ph:=nullif(trim(coalesce(c->>'phone','')),'');
  pan:=nullif(trim(coalesce(c->>'pan_hash','')),'');
  if length(ext)<1 or length(ext)>120 or length(nm)<1 or length(nm)>160 then
   results:=results||jsonb_build_object('external_client_id',ext,'action','rejected','reason','external_client_id and display_name are required');
   continue;
  end if;
  if pan is not null and pan !~ '^[a-f0-9]{64}$' then
   results:=results||jsonb_build_object('external_client_id',ext,'action','rejected','reason','pan_hash must be a sha256 hex');
   continue;
  end if;
  select * into link from cb_client_links where tenant_id=p_tenant and external_system='idash' and external_client_id=ext;
  if found then
   select count(*) into n from cb_client_match_candidates where tenant_id=p_tenant and external_client_id=ext and status='open';
   results:=results||jsonb_build_object('external_client_id',ext,'action',link.status,'candidates',n);
   continue;
  end if;
  insert into cb_client_intake(tenant_id,external_client_id,display_name,email,phone,pan_hash)
   values(p_tenant,ext,nm,em,ph,pan)
   on conflict(tenant_id,external_system,external_client_id) do update set display_name=excluded.display_name,email=excluded.email,phone=excluded.phone,pan_hash=excluded.pan_hash,received_at=now();
  select coalesce(array_agg(id),'{}'::uuid[]),count(*) into cand,n
   from cb_clients where tenant_id=p_tenant and archived_at is null
   and ((em is not null and lower(email)=em) or (ph is not null and phone=ph));
  if n=0 then
   insert into cb_client_links(tenant_id,external_client_id,status) values(p_tenant,ext,'unmatched');
   results:=results||jsonb_build_object('external_client_id',ext,'action','unmatched','candidates',0);
  else
   insert into cb_client_links(tenant_id,external_client_id,status) values(p_tenant,ext,'pending_review');
   foreach cid in array cand loop
    score:=0;reason:='';
    if em is not null and exists(select 1 from cb_clients where tenant_id=p_tenant and id=cid and lower(email)=em) then score:=score+60;reason:='email match';end if;
    if ph is not null and exists(select 1 from cb_clients where tenant_id=p_tenant and id=cid and phone=ph) then score:=score+40;if reason='' then reason:='phone match';else reason:=reason||' + phone match';end if;end if;
    insert into cb_client_match_candidates(tenant_id,external_client_id,client_id,score,reason) values(p_tenant,ext,cid,greatest(score,1),reason)
     on conflict(tenant_id,external_client_id,client_id) do nothing;
   end loop;
   results:=results||jsonb_build_object('external_client_id',ext,'action','pending_review','candidates',n);
  end if;
 end loop;
 insert into cb_audit(tenant_id,action,detail) values(p_tenant,'integration.clients.push',jsonb_build_object('count',jsonb_array_length(p_clients)));
 return jsonb_build_object('ok',true,'results',results);
end$$;

-- Service-only, ATOMIC idempotent push. Reserve, write and store the result in one transaction. Two
-- concurrent callers with the same key serialise on the primary key: one applies, the other replays or,
-- while the first is still running, is told 'in_progress'. A reservation older than five minutes may be
-- taken over so a crashed request cannot block the key forever.
create function cb_client_push_idempotent(p_tenant uuid,p_key text,p_endpoint text,p_hash text,p_clients jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare reserved boolean; existing cb_integration_requests; result jsonb;
begin
 if length(p_key)<8 or length(p_key)>120 then raise exception 'Invalid idempotency key' using errcode='22023'; end if;
 if p_hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid request hash' using errcode='22023'; end if;
 with ins as (
  insert into cb_integration_requests(tenant_id,idempotency_key,endpoint,request_hash,response,status)
  values(p_tenant,p_key,p_endpoint,p_hash,'{}'::jsonb,'reserved')
  on conflict(tenant_id,idempotency_key) do nothing
  returning 1
 ) select exists(select 1 from ins) into reserved;
  if not reserved then
   select * into existing from cb_integration_requests where tenant_id=p_tenant and idempotency_key=p_key;
   if existing.status='done' then
    if existing.request_hash<>p_hash then return jsonb_build_object('status','conflict'); end if;
    return jsonb_build_object('status','replay','response',existing.response);
   end if;
   if existing.created_at>now()-interval '5 minutes' then return jsonb_build_object('status','in_progress'); end if;
   update cb_integration_requests set request_hash=p_hash,created_at=now() where tenant_id=p_tenant and idempotency_key=p_key;
  end if;
 result:=cb_client_push(p_tenant,p_clients);
 update cb_integration_requests set response=result,status='done',created_at=now() where tenant_id=p_tenant and idempotency_key=p_key;
 return jsonb_build_object('status','applied','response',result);
end$$;

-- Staff review. Administrator or manager only, and the tenant comes from the caller's own membership,
-- never from a request parameter. The queue never returns pan_hash.
create function cb_client_link_queue() returns jsonb language plpgsql security definer set search_path=public as $$
begin
 if not cb_access_valid() then raise exception 'Authentication required' using errcode='28000'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object(
   'tenant_id',l.tenant_id,'link_id',l.id,'external_client_id',l.external_client_id,'status',l.status,
   'display_name',i.display_name,'email',i.email,'phone',i.phone,
   'candidates',coalesce((select jsonb_agg(jsonb_build_object('client_id',mc.client_id,'name',cl.name,'score',mc.score,'reason',mc.reason))
     from cb_client_match_candidates mc join cb_clients cl on cl.tenant_id=mc.tenant_id and cl.id=mc.client_id
     where mc.tenant_id=l.tenant_id and mc.external_client_id=l.external_client_id and mc.status='open'),'[]'::jsonb)))
  from cb_client_links l left join cb_client_intake i on i.tenant_id=l.tenant_id and i.external_client_id=l.external_client_id
  where l.status in ('pending_review','unmatched')
  and exists(select 1 from cb_tenants t where t.id=l.tenant_id and t.status in ('trial','active'))
  and exists(select 1 from cb_members m where m.tenant_id=l.tenant_id and m.user_id=auth.uid() and m.active and m.role in ('admin','manager'))),'[]'::jsonb);
end$$;
create function cb_client_link_confirm(p_link uuid,p_client uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare link cb_client_links;
begin
 if not cb_access_valid() then raise exception 'Authentication required' using errcode='28000'; end if;
 select * into link from cb_client_links where id=p_link;
 if not found then raise exception 'Link not found' using errcode='42501'; end if;
 if coalesce(cb_role(link.tenant_id),'') not in ('admin','manager') then raise exception 'Permission required' using errcode='42501'; end if;
 if not exists(select 1 from cb_clients where tenant_id=link.tenant_id and id=p_client and archived_at is null) then raise exception 'Client not found' using errcode='42501'; end if;
 update cb_client_links set status='linked',client_id=p_client,reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now() where id=p_link;
 update cb_client_match_candidates set status='confirmed' where tenant_id=link.tenant_id and external_client_id=link.external_client_id and client_id=p_client;
 update cb_client_match_candidates set status='dismissed' where tenant_id=link.tenant_id and external_client_id=link.external_client_id and client_id<>p_client and status='open';
 -- the PAN hash is no longer needed once the link is human-confirmed
 update cb_client_intake set pan_hash=null where tenant_id=link.tenant_id and external_client_id=link.external_client_id;
 insert into cb_audit(tenant_id,actor_id,action,entity_id,detail) values(link.tenant_id,auth.uid(),'integration.client.link',p_link,jsonb_build_object('client_id',p_client));
 return jsonb_build_object('link_id',p_link,'status','linked','client_id',p_client);
end$$;
-- Deletion of the sensitive intake record on request. Administrator or manager of the owning tenant only.
create function cb_client_intake_forget(p_link uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare link cb_client_links;
begin
 if not cb_access_valid() then raise exception 'Authentication required' using errcode='28000'; end if;
 select * into link from cb_client_links where id=p_link;
 if not found then raise exception 'Link not found' using errcode='42501'; end if;
 if coalesce(cb_role(link.tenant_id),'') not in ('admin','manager') then raise exception 'Permission required' using errcode='42501'; end if;
 delete from cb_client_intake where tenant_id=link.tenant_id and external_client_id=link.external_client_id;
 insert into cb_audit(tenant_id,actor_id,action,entity_id,detail) values(link.tenant_id,auth.uid(),'integration.client.intake_delete',p_link,'{}'::jsonb);
 return jsonb_build_object('link_id',p_link,'intake_deleted',true);
end$$;

revoke all on function cb_client_push(uuid,jsonb),cb_client_push_idempotent(uuid,text,text,text,jsonb) from public,anon,authenticated;
revoke all on function cb_client_link_queue(),cb_client_link_confirm(uuid,uuid),cb_client_intake_forget(uuid) from public,anon,authenticated;
grant execute on function cb_client_push(uuid,jsonb),cb_client_push_idempotent(uuid,text,text,text,jsonb) to service_role;
grant execute on function cb_client_link_queue(),cb_client_link_confirm(uuid,uuid),cb_client_intake_forget(uuid) to authenticated;
commit;
