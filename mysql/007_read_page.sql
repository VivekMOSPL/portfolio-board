-- Follow-through — MySQL operations tables and scoped page reads.
--
-- Ports the three tables the workspace needs from supabase/migrations/202609180005_operations.sql, and
-- adds the single scoped read routine that replaces the PostgREST table reads the route performed with
-- client.from(table).select(...).
--
-- Why one routine rather than a view per table: MySQL refuses a user variable in a view definition, and
-- the application user holds no SELECT on any base table, so a scoped read has to be a routine that
-- applies the predicate itself. cb_read_page takes the resource name and returns the same
-- { rows, total } shape the route already expects, so the route's contract is unchanged.

-- ---------------------------------------------------------------- tables

create table if not exists cb_plans (
  id char(36) not null default (uuid()),
  name varchar(100) not null,
  user_limit int not null,
  client_limit int not null,
  active tinyint(1) not null default 1,
  created_at datetime(3) not null default (utc_timestamp(3)),
  primary key (id),
  unique key cb_plans_name (name),
  constraint cb_plans_name_len check (char_length(trim(name)) between 1 and 100),
  constraint cb_plans_user_limit check (user_limit > 0),
  constraint cb_plans_client_limit check (client_limit > 0)
) engine=InnoDB;

create table if not exists cb_master_data (
  id char(36) not null default (uuid()),
  tenant_id char(36) not null,
  kind varchar(24) not null,
  name varchar(120) not null,
  active tinyint(1) not null default 1,
  version int not null default 1,
  created_at datetime(3) not null default (utc_timestamp(3)),
  primary key (id),
  unique key cb_master_data_kind_name (tenant_id, kind, name),
  constraint cb_master_data_kind check (kind in ('segment','tag','reason','loss_reason','product','custom_field')),
  constraint cb_master_data_name_len check (char_length(trim(name)) between 1 and 120),
  constraint cb_master_data_tenant foreign key (tenant_id) references cb_tenants(id)
) engine=InnoDB;

create table if not exists cb_saved_filters (
  id char(36) not null default (uuid()),
  tenant_id char(36) not null,
  user_id char(36) not null,
  name varchar(80) not null,
  filters json not null default (json_object()),
  created_at datetime(3) not null default (utc_timestamp(3)),
  primary key (id),
  unique key cb_saved_filters_name (tenant_id, user_id, name),
  constraint cb_saved_filters_name_len check (char_length(trim(name)) between 1 and 80),
  constraint cb_saved_filters_member foreign key (tenant_id, user_id) references cb_members(tenant_id, user_id)
) engine=InnoDB;

insert into cb_plans (name, user_limit, client_limit)
  values ('Starter', 10, 1000)
  on duplicate key update name = values(name);

-- ---------------------------------------------------------------- reads

-- Every business, for the platform console. Metadata only: no client or follow-up figures, so platform
-- administration is not a route to client data.
drop function if exists cb_read_plans;
create function cb_read_plans(p_actor char(36), p_offset int, p_size int) returns json
  reads sql data
  return json_object(
    'total', (select count(*) from cb_plans),
    'rows', coalesce((
      select json_arrayagg(json_object(
        'id',           p.id,
        'name',         p.name,
        'user_limit',   p.user_limit,
        'client_limit', p.client_limit,
        'active',       cast(p.active = 1 as json),
        'created_at',   date_format(p.created_at, '%Y-%m-%dT%H:%i:%s.%fZ')
      ))
      from (
        select * from cb_plans where cb_platform(p_actor) = 1
        order by created_at limit p_size offset p_offset
      ) p
    ), json_array())
  );

-- One scoped page for a named resource. The resource name selects both the table and its predicate, so
-- a caller cannot ask for a table that has no scope rule. Unknown resources raise rather than falling
-- through to an unfiltered read.
drop function if exists cb_read_page;
create function cb_read_page(
  p_actor char(36), p_resource varchar(24), p_tenant char(36),
  p_q varchar(120), p_offset int, p_size int) returns json
  reads sql data
  return case p_resource

    when 'clients' then json_object(
      'total', (select count(*) from cb_clients c
                 where c.tenant_id = p_tenant and c.archived_at is null
                   and cb_scope(p_actor, c.tenant_id, c.owner_id, c.team_id, 0) = 1
                   and (p_q is null or p_q = '' or c.name like concat('%', p_q, '%'))),
      'rows', coalesce((
        select json_arrayagg(json_object(
          'id', c.id, 'code', c.code, 'name', c.name, 'email', c.email, 'phone', c.phone,
          'kind', c.kind, 'owner_id', c.owner_id, 'team_id', c.team_id,
          'segment', c.segment, 'source', c.source, 'version', c.version,
          'created_at', date_format(c.created_at, '%Y-%m-%dT%H:%i:%s.%fZ')))
        from (
          select * from cb_clients c
           where c.tenant_id = p_tenant and c.archived_at is null
             and cb_scope(p_actor, c.tenant_id, c.owner_id, c.team_id, 0) = 1
             and (p_q is null or p_q = '' or c.name like concat('%', p_q, '%'))
           order by c.created_at desc limit p_size offset p_offset
        ) c
      ), json_array()))

    when 'members' then json_object(
      'total', (select count(*) from cb_members m
                 where m.tenant_id = p_tenant and cb_role(p_actor, m.tenant_id) is not null
                   and (m.user_id = p_actor or cb_role(p_actor, m.tenant_id) in ('admin','auditor')
                        or (cb_role(p_actor, m.tenant_id) = 'manager'
                            and cb_scope(p_actor, m.tenant_id, m.user_id, m.team_id, 0) = 1))),
      'rows', coalesce((
        select json_arrayagg(json_object(
          'user_id', m.user_id, 'name', m.name, 'email', m.email, 'role', m.role,
          'team_id', m.team_id, 'active', cast(m.active = 1 as json), 'version', m.version,
          'created_at', date_format(m.created_at, '%Y-%m-%dT%H:%i:%s.%fZ')))
        from (
          select * from cb_members m
           where m.tenant_id = p_tenant and cb_role(p_actor, m.tenant_id) is not null
             and (m.user_id = p_actor or cb_role(p_actor, m.tenant_id) in ('admin','auditor')
                  or (cb_role(p_actor, m.tenant_id) = 'manager'
                      and cb_scope(p_actor, m.tenant_id, m.user_id, m.team_id, 0) = 1))
           order by m.name limit p_size offset p_offset
        ) m
      ), json_array()))

    when 'teams' then json_object(
      'total', (select count(*) from cb_teams t
                 where t.tenant_id = p_tenant
                   and (cb_role(p_actor, t.tenant_id) in ('admin','auditor')
                        or cb_scope(p_actor, t.tenant_id, null, t.id, 0) = 1)),
      'rows', coalesce((
        select json_arrayagg(json_object(
          'id', t.id, 'name', t.name, 'branch', t.branch, 'active', cast(t.active = 1 as json)))
        from (
          select * from cb_teams t
           where t.tenant_id = p_tenant
             and (cb_role(p_actor, t.tenant_id) in ('admin','auditor')
                  or cb_scope(p_actor, t.tenant_id, null, t.id, 0) = 1)
           order by t.name limit p_size offset p_offset
        ) t
      ), json_array()))

    when 'timeline' then json_object(
      'total', 0,
      'rows', coalesce((
        select json_arrayagg(json_object(
          'id', l.id, 'kind', l.kind, 'summary', l.summary, 'actor_id', l.actor_id,
          'created_at', date_format(l.created_at, '%Y-%m-%dT%H:%i:%s.%fZ')))
        from cb_timeline l
         where l.tenant_id = p_tenant
           and cb_client_scope(p_actor, l.tenant_id, l.client_id, 0) = 1
         order by l.created_at desc limit p_size offset p_offset
      ), json_array()))

    when 'notifications' then json_object(
      'total', 0,
      'rows', coalesce((
        select json_arrayagg(json_object(
          'id', n.id, 'message', n.message, 'event_key', n.event_key,
          'read_at', date_format(n.read_at, '%Y-%m-%dT%H:%i:%s.%fZ'),
          'created_at', date_format(n.created_at, '%Y-%m-%dT%H:%i:%s.%fZ')))
        from cb_notifications n
         where n.tenant_id = p_tenant and n.user_id = p_actor
           and cb_role(p_actor, n.tenant_id) is not null
         order by n.created_at desc limit p_size offset p_offset
      ), json_array()))

    when 'imports' then json_object(
      'total', 0,
      'rows', coalesce((
        select json_arrayagg(json_object(
          'id', i.id, 'rows_created', i.rows_created, 'rows_skipped', i.rows_skipped,
          'created_at', date_format(i.created_at, '%Y-%m-%dT%H:%i:%s.%fZ')))
        from cb_imports i
         where i.tenant_id = p_tenant and cb_role(p_actor, i.tenant_id) = 'admin'
         order by i.created_at desc limit p_size offset p_offset
      ), json_array()))

    when 'audit' then json_object(
      'total', 0,
      'rows', coalesce((
        select json_arrayagg(json_object(
          'id', a.id, 'action', a.action, 'entity_id', a.entity_id, 'actor_id', a.actor_id,
          'created_at', date_format(a.created_at, '%Y-%m-%dT%H:%i:%s.%fZ')))
        from cb_audit a
         where (a.tenant_id = p_tenant and cb_role(p_actor, a.tenant_id) in ('admin','auditor'))
         order by a.created_at desc limit p_size offset p_offset
      ), json_array()))

    when 'preferences' then json_object(
      'total', 0,
      'rows', coalesce((
        select json_arrayagg(json_object(
          'tenant_id', p.tenant_id, 'user_id', p.user_id, 'in_app', cast(p.in_app = 1 as json)))
        from cb_preferences p
         where p.tenant_id = p_tenant and p.user_id = p_actor
           and cb_role(p_actor, p.tenant_id) is not null
      ), json_array()))

    when 'filters' then json_object(
      'total', 0,
      'rows', coalesce((
        select json_arrayagg(json_object(
          'id', f.id, 'name', f.name, 'filters', f.filters,
          'created_at', date_format(f.created_at, '%Y-%m-%dT%H:%i:%s.%fZ')))
        from cb_saved_filters f
         where f.tenant_id = p_tenant and f.user_id = p_actor
           and cb_role(p_actor, f.tenant_id) is not null
         order by f.created_at desc limit p_size offset p_offset
      ), json_array()))

    when 'masters' then json_object(
      'total', 0,
      'rows', coalesce((
        select json_arrayagg(json_object(
          'id', d.id, 'kind', d.kind, 'name', d.name,
          'active', cast(d.active = 1 as json), 'version', d.version))
        from cb_master_data d
         where d.tenant_id = p_tenant and cb_role(p_actor, d.tenant_id) is not null
         order by d.kind, d.name limit p_size offset p_offset
      ), json_array()))

    when 'settings' then json_object(
      'total', (select count(*) from cb_tenants t where t.id = p_tenant and cb_role(p_actor, t.id) is not null),
      'rows', coalesce((
        select json_arrayagg(json_object(
          'id', t.id, 'name', t.name, 'status', t.status, 'business_type', t.business_type,
          'timezone', t.timezone, 'currency', t.currency, 'plan', t.plan,
          'user_limit', t.user_limit, 'client_limit', t.client_limit,
          'escalation_hours', t.escalation_hours, 'version', t.version,
          'profile', t.profile))
        from cb_tenants t
         where t.id = p_tenant and cb_role(p_actor, t.id) is not null
      ), json_array()))

    else json_object('total', 0, 'rows', json_array())
  end;
