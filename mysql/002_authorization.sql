-- Follow-through â€” MySQL authorization primitives and scope-enforcing read procedures.
--
-- This file replaces the PostgreSQL row level security policies from
-- supabase/migrations/202609170001_schema.sql.
--
-- Why procedures rather than views: MySQL refuses to define a view that references a user
-- variable (ERROR 1351), so the usual "@actor in a view" emulation of row level security is not
-- available. MySQL also has no auth.uid(). Every authorization primitive therefore takes the
-- acting user's id explicitly as p_actor, and every read path is a stored procedure that applies
-- the same predicate the PostgreSQL policy used.
--
-- The caller supplies p_actor from the verified session. Never from request input.
--
-- What this does NOT give you, and the PostgreSQL version does: the engine cannot stop a caller
-- from querying a base table directly. In the Supabase provider, a direct read of cb_clients is
-- refused by the engine's policy. Here, reads must go through these procedures or through a
-- predicate that calls cb_scope. Treat the base tables as internal. This is the central security
-- difference between the two providers and it must not be described as equivalent.

-- ---------------------------------------------------------------- primitives

drop function if exists cb_platform;
create function cb_platform(p_actor char(36)) returns tinyint(1)
  reads sql data
  return coalesce((select 1 from cb_platform_admins where user_id = p_actor limit 1), 0);

drop function if exists cb_role;
create function cb_role(p_actor char(36), p_tenant char(36)) returns varchar(16)
  reads sql data
  return (
    select m.role
    from cb_members m
    join cb_tenants b on b.id = m.tenant_id
    where m.tenant_id = p_tenant
      and m.user_id = p_actor
      and m.active = 1
      and b.status in ('trial','active')
    limit 1
  );

drop function if exists cb_scope;
create function cb_scope(p_actor char(36), p_tenant char(36), p_owner char(36), p_team char(36), p_writing tinyint(1))
  returns tinyint(1)
  reads sql data
  return coalesce((
    select 1
    from cb_members m
    join cb_tenants b on b.id = p_tenant
    where m.tenant_id = p_tenant
      and m.user_id = p_actor
      and m.active = 1
      and b.status in ('trial','active')
      and (
        m.role = 'admin'
        or (m.role = 'auditor' and p_writing = 0)
        or (m.role = 'manager' and p_team is not null and m.team_id = p_team)
        or (m.role = 'rm' and p_owner = m.user_id)
      )
    limit 1
  ), 0);

drop function if exists cb_client_scope;
create function cb_client_scope(p_actor char(36), p_tenant char(36), p_client char(36), p_writing tinyint(1))
  returns tinyint(1)
  reads sql data
  return coalesce((
    select 1
    from cb_clients c
    where c.tenant_id = p_tenant
      and c.id = p_client
      and c.archived_at is null
      and cb_scope(p_actor, p_tenant, c.owner_id, c.team_id, p_writing) = 1
    limit 1
  ), 0);

-- Superseded by passing p_actor explicitly; dropped so an upgrade cannot leave a stale helper behind.
drop function if exists cb_actor;

-- ---------------------------------------------------------------- scoped reads
-- Each is the MySQL counterpart of one PostgreSQL read policy. None of them accepts a tenant the
-- actor cannot reach: the predicate is inside the statement, not supplied by the caller.
-- Pagination takes an offset rather than a page number, because MySQL does not accept an
-- arithmetic expression in LIMIT ... OFFSET.

drop procedure if exists cb_read_tenants;
create procedure cb_read_tenants(in p_actor char(36), in p_tenant char(36))
  select t.* from cb_tenants t
  where (p_tenant is null or t.id = p_tenant)
    and (cb_platform(p_actor) = 1 or cb_role(p_actor, t.id) is not null);

drop procedure if exists cb_read_members;
create procedure cb_read_members(in p_actor char(36), in p_tenant char(36))
  select m.* from cb_members m
  where m.tenant_id = p_tenant
    and cb_role(p_actor, m.tenant_id) is not null
    and (
      m.user_id = p_actor
      or cb_role(p_actor, m.tenant_id) in ('admin','auditor')
      or (cb_role(p_actor, m.tenant_id) = 'manager' and cb_scope(p_actor, m.tenant_id, m.user_id, m.team_id, 0) = 1)
    );

drop procedure if exists cb_read_teams;
create procedure cb_read_teams(in p_actor char(36), in p_tenant char(36))
  select t.* from cb_teams t
  where t.tenant_id = p_tenant
    and (cb_role(p_actor, t.tenant_id) in ('admin','auditor')
         or cb_scope(p_actor, t.tenant_id, null, t.id, 0) = 1);

drop procedure if exists cb_read_clients;
create procedure cb_read_clients(in p_actor char(36), in p_tenant char(36), in p_search varchar(120), in p_offset int, in p_size int)
  select c.* from cb_clients c
  where c.tenant_id = p_tenant
    and cb_scope(p_actor, c.tenant_id, c.owner_id, c.team_id, 0) = 1
    and (p_search is null or p_search = '' or c.name like concat('%', p_search, '%') or c.code like concat('%', p_search, '%'))
  order by c.created_at desc
  limit p_size offset p_offset;

drop procedure if exists cb_read_followups;
create procedure cb_read_followups(in p_actor char(36), in p_tenant char(36), in p_offset int, in p_size int)
  select f.* from cb_followups f
  where f.tenant_id = p_tenant
    and cb_scope(p_actor, f.tenant_id, f.owner_id, f.team_id, 0) = 1
    and cb_client_scope(p_actor, f.tenant_id, f.client_id, 0) = 1
  order by coalesce(f.due_at, f.created_at) asc
  limit p_size offset p_offset;

drop procedure if exists cb_read_timeline;
create procedure cb_read_timeline(in p_actor char(36), in p_tenant char(36), in p_client char(36))
  select l.* from cb_timeline l
  where l.tenant_id = p_tenant
    and l.client_id = p_client
    and cb_client_scope(p_actor, l.tenant_id, l.client_id, 0) = 1
  order by l.created_at desc;

drop procedure if exists cb_read_notifications;
create procedure cb_read_notifications(in p_actor char(36), in p_tenant char(36))
  select n.* from cb_notifications n
  where n.tenant_id = p_tenant
    and n.user_id = p_actor
    and cb_role(p_actor, n.tenant_id) is not null
    and (n.client_id is null or cb_client_scope(p_actor, n.tenant_id, n.client_id, 0) = 1)
  order by n.created_at desc;

drop procedure if exists cb_read_invitations;
create procedure cb_read_invitations(in p_actor char(36), in p_tenant char(36))
  select i.* from cb_invitations i
  where i.tenant_id = p_tenant
    and cb_role(p_actor, i.tenant_id) = 'admin';

drop procedure if exists cb_read_preferences;
create procedure cb_read_preferences(in p_actor char(36), in p_tenant char(36))
  select p.* from cb_preferences p
  where p.tenant_id = p_tenant
    and p.user_id = p_actor
    and cb_role(p_actor, p.tenant_id) is not null;

drop procedure if exists cb_read_audit;
create procedure cb_read_audit(in p_actor char(36), in p_tenant char(36))
  select a.* from cb_audit a
  where ((a.tenant_id is null and cb_platform(p_actor) = 1)
      or (a.tenant_id = p_tenant and cb_role(p_actor, a.tenant_id) in ('admin','auditor')))
  order by a.created_at desc
  limit 200;
