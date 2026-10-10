-- Follow-through — MySQL application-facing functions.
--
-- These are the routines the application calls through its data layer. They deliberately share the
-- names of their PostgreSQL counterparts so the adapter can map rpc(name, args) onto them unchanged.
--
-- The one signature difference is mandatory: where PostgreSQL resolved the acting user from the JWT
-- with auth.uid(), MySQL has no such thing. Every function takes p_actor first, and the adapter
-- supplies it from the verified session. A caller that passes NULL gets an empty result rather than
-- everything, so a missing actor fails closed.

-- ---------------------------------------------------------------- cb_session
-- The account payload the workspace loads on every request: who the user is, whether they are a
-- platform administrator, and every membership they hold with the tenant's name, status and timezone.

drop function if exists cb_session;
create function cb_session(p_actor char(36)) returns json
  reads sql data
  return (
    select json_object(
      'user_id', p_actor,
      'platform', cast(cb_platform(p_actor) = 1 as json),
      'memberships', coalesce((
        select json_arrayagg(json_object(
          'tenant_id',     m.tenant_id,
          'name',          m.name,
          'role',          m.role,
          'team_id',       m.team_id,
          'active',        cast(m.active = 1 as json),
          'tenant_name',   b.name,
          'tenant_status', b.status,
          'timezone',      b.timezone
        ))
        from cb_members m
        join cb_tenants b on b.id = m.tenant_id
        where m.user_id = p_actor
      ), json_array())
    )
  );

-- ---------------------------------------------------------------- cb_tenant_list
-- The platform console. Business metadata only: it deliberately returns no client or follow-up
-- figures, so platform administration cannot become a route to client data.

drop function if exists cb_tenant_list;
create function cb_tenant_list(p_actor char(36)) returns json
  reads sql data
  return coalesce((
    select json_arrayagg(json_object(
      'id',            t.id,
      'name',          t.name,
      'status',        t.status,
      'business_type', t.business_type,
      'plan',          t.plan,
      'user_limit',    t.user_limit,
      'client_limit',  t.client_limit,
      'timezone',      t.timezone,
      'created_at',    date_format(t.created_at, '%Y-%m-%dT%H:%i:%s.%fZ'),
      'users',         (select count(*) from cb_members m where m.tenant_id = t.id and m.active = 1)
    ))
    from cb_tenants t
    where cb_platform(p_actor) = 1
    order by t.created_at
  ), json_array());

-- ---------------------------------------------------------------- cb_client_page
-- The client list with paging, search and a total, in the shape the workspace expects.

drop function if exists cb_client_page;
create function cb_client_page(p_actor char(36), p_tenant char(36), p_search varchar(120), p_offset int, p_size int)
  returns json
  reads sql data
  return json_object(
    'total', (
      select count(*) from cb_clients c
      where c.tenant_id = p_tenant
        and cb_scope(p_actor, c.tenant_id, c.owner_id, c.team_id, 0) = 1
        and (p_search is null or p_search = '' or c.name like concat('%', p_search, '%') or c.code like concat('%', p_search, '%'))
    ),
    'rows', coalesce((
      select json_arrayagg(json_object(
        'id',            c.id,
        'code',          c.code,
        'name',          c.name,
        'email',         c.email,
        'phone',         c.phone,
        'kind',          c.kind,
        'owner_id',      c.owner_id,
        'team_id',       c.team_id,
        'segment',       c.segment,
        'source',        c.source,
        'version',       c.version
      ))
      from cb_clients c
      where c.tenant_id = p_tenant
        and cb_scope(p_actor, c.tenant_id, c.owner_id, c.team_id, 0) = 1
        and (p_search is null or p_search = '' or c.name like concat('%', p_search, '%') or c.code like concat('%', p_search, '%'))
      order by c.created_at desc
      limit p_size offset p_offset
    ), json_array())
  );
