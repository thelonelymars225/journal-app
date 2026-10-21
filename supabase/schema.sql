-- Journal tables for Supabase. Paste this whole file into the SQL Editor of
-- your Supabase project and press Run. It is safe to run again.
--
-- Each row belongs to the signed-in user (user_id defaults to auth.uid()), and
-- row-level security means a request can only ever see or change its own rows.
-- The anon key that ships in the web app can't read anything without a login.

-- Entries are stored whole as JSON, so new fields in the app need no migration.
-- Deleted entries stay as tombstones (deleted = true) so other devices learn
-- about the delete.
create table if not exists public.entries (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  id         text        not null,
  data       jsonb       not null,
  deleted    boolean     not null default false,
  synced_at  timestamptz not null default now(),
  primary key (user_id, id)
);

-- Settings shared between devices (life topics, sorting sensitivity, ...).
create table if not exists public.settings (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  key        text        not null,
  value      jsonb,
  synced_at  timestamptz not null default now(),
  primary key (user_id, key)
);

-- synced_at is stamped by the server on every write, so devices can ask for
-- "everything changed since my last sync" without trusting their own clocks.
create or replace function public.touch_synced_at()
returns trigger language plpgsql as $$
begin
  new.synced_at := clock_timestamp();
  return new;
end;
$$;

drop trigger if exists entries_touch on public.entries;
create trigger entries_touch before insert or update on public.entries
  for each row execute function public.touch_synced_at();

drop trigger if exists settings_touch on public.settings;
create trigger settings_touch before insert or update on public.settings
  for each row execute function public.touch_synced_at();

create index if not exists entries_user_synced on public.entries (user_id, synced_at);
create index if not exists settings_user_synced on public.settings (user_id, synced_at);

alter table public.entries  enable row level security;
alter table public.settings enable row level security;

drop policy if exists "own entries" on public.entries;
create policy "own entries" on public.entries
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "own settings" on public.settings;
create policy "own settings" on public.settings
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Nobody without a login gets in, even by accident.
revoke all on public.entries  from anon;
revoke all on public.settings from anon;
grant select, insert, update, delete on public.entries  to authenticated;
grant select, insert, update, delete on public.settings to authenticated;
