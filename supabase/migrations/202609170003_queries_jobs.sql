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
