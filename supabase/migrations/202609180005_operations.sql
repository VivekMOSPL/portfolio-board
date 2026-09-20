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
