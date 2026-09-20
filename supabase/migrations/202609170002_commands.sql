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
