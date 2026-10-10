-- Follow-through — MySQL isolation checks.
--
-- These are the assertions that matter. Each one fails if the ported authorization model stopped
-- enforcing tenant or record scope. Run with:
--
--   mysql -u root followthrough -e "source mysql/004_isolation_checks.sql"
--
-- Every check compares an actual result against the expected one and reports PASS or FAIL. A single
-- FAIL means the provider is not safe to use.

set names utf8mb4;

drop temporary table if exists cb_checks;
create temporary table cb_checks (
  seq int auto_increment primary key,
  check_name varchar(90) not null,
  expected varchar(40) not null,
  actual varchar(40) not null
);

-- ---------------------------------------------------------------- actors
set @platform = '20000000-0000-4000-8000-000000000001';
set @adminA   = '20000000-0000-4000-8000-000000000002';
set @managerA = '20000000-0000-4000-8000-000000000003';
set @rm1A     = '20000000-0000-4000-8000-000000000004';
set @rm2A     = '20000000-0000-4000-8000-000000000005';
set @auditorA = '20000000-0000-4000-8000-000000000006';
set @adminB   = '20000000-0000-4000-8000-000000000007';
set @rmB      = '20000000-0000-4000-8000-000000000008';
set @stranger = '20000000-0000-4000-8000-00000000dead';

set @tenantA  = '10000000-0000-4000-8000-00000000000a';
set @tenantB  = '10000000-0000-4000-8000-00000000000b';
set @teamAlpha = '30000000-0000-4000-8000-00000000000a';
set @teamBeta  = '30000000-0000-4000-8000-00000000000b';

-- ---------------------------------------------------------------- role resolution

insert into cb_checks (check_name, expected, actual) values
('role: RM resolves to rm in own tenant', 'rm', coalesce(cb_role(@rm1A, @tenantA), 'null'));
insert into cb_checks (check_name, expected, actual) values
('role: admin resolves to admin', 'admin', coalesce(cb_role(@adminA, @tenantA), 'null'));
insert into cb_checks (check_name, expected, actual) values
('role: auditor resolves to auditor', 'auditor', coalesce(cb_role(@auditorA, @tenantA), 'null'));
insert into cb_checks (check_name, expected, actual) values
('role: outsider has no role in tenant A', 'null', coalesce(cb_role(@stranger, @tenantA), 'null'));
insert into cb_checks (check_name, expected, actual) values
('role: tenant A RM has no role in tenant B', 'null', coalesce(cb_role(@rm1A, @tenantB), 'null'));
insert into cb_checks (check_name, expected, actual) values
('platform: platform admin recognised', '1', cast(cb_platform(@platform) as char));
insert into cb_checks (check_name, expected, actual) values
('platform: ordinary admin is not platform', '0', cast(cb_platform(@adminA) as char));

-- ---------------------------------------------------------------- scope

insert into cb_checks (check_name, expected, actual) values
('scope: RM owns own record', '1', cast(cb_scope(@rm1A, @tenantA, @rm1A, @teamAlpha, 0) as char));
insert into cb_checks (check_name, expected, actual) values
('scope: RM denied another RM record', '0', cast(cb_scope(@rm1A, @tenantA, @rm2A, @teamBeta, 0) as char));
insert into cb_checks (check_name, expected, actual) values
('scope: manager allowed own team', '1', cast(cb_scope(@managerA, @tenantA, @rm1A, @teamAlpha, 0) as char));
insert into cb_checks (check_name, expected, actual) values
('scope: manager denied other team', '0', cast(cb_scope(@managerA, @tenantA, @rm2A, @teamBeta, 0) as char));
insert into cb_checks (check_name, expected, actual) values
('scope: admin allowed any record in tenant', '1', cast(cb_scope(@adminA, @tenantA, @rm2A, @teamBeta, 0) as char));
insert into cb_checks (check_name, expected, actual) values
('scope: auditor may read', '1', cast(cb_scope(@auditorA, @tenantA, @rm1A, @teamAlpha, 0) as char));
insert into cb_checks (check_name, expected, actual) values
('scope: auditor may not write', '0', cast(cb_scope(@auditorA, @tenantA, @rm1A, @teamAlpha, 1) as char));
insert into cb_checks (check_name, expected, actual) values
('scope: admin may write', '1', cast(cb_scope(@adminA, @tenantA, @rm1A, @teamAlpha, 1) as char));
insert into cb_checks (check_name, expected, actual) values
('scope: cross-tenant is refused', '0', cast(cb_scope(@rmB, @tenantA, @rm1A, @teamAlpha, 0) as char));
insert into cb_checks (check_name, expected, actual) values
('scope: unknown actor is refused', '0', cast(cb_scope(@stranger, @tenantA, @rm1A, @teamAlpha, 0) as char));

-- ---------------------------------------------------------------- record visibility
-- The same predicate the read procedures use. Counts, not procedures, so the assertion is numeric.

insert into cb_checks (check_name, expected, actual) values
('clients: RM sees exactly own clients',
 '1',
 cast((select count(*) from cb_clients c where c.tenant_id = @tenantA
        and cb_scope(@rm1A, c.tenant_id, c.owner_id, c.team_id, 0) = 1) as char));
insert into cb_checks (check_name, expected, actual) values
('clients: admin sees every client in the tenant',
 '3',
 cast((select count(*) from cb_clients c where c.tenant_id = @tenantA
        and cb_scope(@adminA, c.tenant_id, c.owner_id, c.team_id, 0) = 1) as char));
insert into cb_checks (check_name, expected, actual) values
('clients: manager sees own team only',
 '1',
 cast((select count(*) from cb_clients c where c.tenant_id = @tenantA
        and cb_scope(@managerA, c.tenant_id, c.owner_id, c.team_id, 0) = 1) as char));
insert into cb_checks (check_name, expected, actual) values
('clients: outsider sees nothing',
 '0',
 cast((select count(*) from cb_clients c where c.tenant_id = @tenantA
        and cb_scope(@stranger, c.tenant_id, c.owner_id, c.team_id, 0) = 1) as char));
insert into cb_checks (check_name, expected, actual) values
('clients: NULL actor sees nothing (fails closed)',
 '0',
 cast((select count(*) from cb_clients c where c.tenant_id = @tenantA
        and cb_scope(null, c.tenant_id, c.owner_id, c.team_id, 0) = 1) as char));
insert into cb_checks (check_name, expected, actual) values
('clients: tenant B RM cannot reach tenant A rows',
 '0',
 cast((select count(*) from cb_clients c where c.tenant_id = @tenantA
        and cb_scope(@rmB, c.tenant_id, c.owner_id, c.team_id, 0) = 1) as char));

insert into cb_checks (check_name, expected, actual) values
('followups: RM sees own follow-up only',
 '1',
 cast((select count(*) from cb_followups f where f.tenant_id = @tenantA
        and cb_scope(@rm1A, f.tenant_id, f.owner_id, f.team_id, 0) = 1
        and cb_client_scope(@rm1A, f.tenant_id, f.client_id, 0) = 1) as char));
insert into cb_checks (check_name, expected, actual) values
('followups: tenant B follow-up invisible in tenant A',
 '0',
 cast((select count(*) from cb_followups f where f.tenant_id = @tenantA
        and f.id = '50000000-0000-4000-8000-000000000003') as char));

-- ---------------------------------------------------------------- report

select
  seq as '#',
  check_name as assertion,
  expected,
  actual,
  if(expected = actual, 'PASS', 'FAIL') as result
from cb_checks
order by seq;

select
  count(*) as total,
  sum(if(expected = actual, 1, 0)) as passed,
  sum(if(expected = actual, 0, 1)) as failed,
  if(count(*) = sum(if(expected = actual, 1, 0)), 'ALL CHECKS PASSED', 'ISOLATION FAILURE') as verdict
from cb_checks;
