-- Portfolio Follow-up Board — schema
-- Paste this whole block into the Supabase SQL editor and run it.

create table if not exists public.followups (
  id                  uuid        primary key default gen_random_uuid(),
  created_at          timestamptz not null    default now(),
  client_name         text        not null    check (length(trim(client_name)) > 0),
  advisor             text        not null    check (length(trim(advisor)) > 0),
  reason              text        not null    check (length(trim(reason)) > 0),
  value_at_risk_paise bigint      not null    default 0 check (value_at_risk_paise >= 0),
  outcome             text        not null    default 'waiting'
                        check (outcome in ('called', 'met', 'waiting', 'lost')),
  outcome_updated_at  timestamptz not null    default now()
);

-- Row Level Security switched on.
alter table public.followups enable row level security;

drop policy if exists "followups_select" on public.followups;
create policy "followups_select"
  on public.followups for select
  to anon, authenticated
  using (true);

drop policy if exists "followups_insert" on public.followups;
create policy "followups_insert"
  on public.followups for insert
  to anon, authenticated
  with check (true);

drop policy if exists "followups_update" on public.followups;
create policy "followups_update"
  on public.followups for update
  to anon, authenticated
  using (true)
  with check (true);

drop policy if exists "followups_delete" on public.followups;
create policy "followups_delete"
  on public.followups for delete
  to anon, authenticated
  using (true);

-- Plain words: these four policies let anyone who has the browser key read,
-- add, change, and delete every row in this table, with no sign-in at all.
-- That is fine for a local demo; it is not safe for real client data.
