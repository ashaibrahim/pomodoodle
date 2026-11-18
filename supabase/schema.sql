-- Pomodoodle: cloud progress for signed-in users.
-- Run this once in Supabase → SQL Editor → New query → Run.

create table if not exists public.progress (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,   -- sessions, minutes per day, achievements…
  settings   jsonb not null default '{}'::jsonb,   -- name, buddy, timer + reminder settings
  updated_at timestamptz not null default now(),
  -- keep rows small: progress is a few KB even after years of daily use
  constraint progress_size check (pg_column_size(data) < 200000 and pg_column_size(settings) < 10000)
);

-- Row Level Security: each person can only see and change their own row.
alter table public.progress enable row level security;

drop policy if exists "read own progress" on public.progress;
create policy "read own progress" on public.progress
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "insert own progress" on public.progress;
create policy "insert own progress" on public.progress
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "update own progress" on public.progress;
create policy "update own progress" on public.progress
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "delete own progress" on public.progress;
create policy "delete own progress" on public.progress
  for delete to authenticated using ((select auth.uid()) = user_id);

-- Guests (the public "anon" key without a sign-in) get no access at all.
revoke all on public.progress from anon;
grant select, insert, update, delete on public.progress to authenticated;
