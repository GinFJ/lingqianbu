-- 零钱簿：端到端加密同步后端
-- 在 Supabase SQL Editor 中完整执行本文件，然后在 Auth 设置中开启 Anonymous Sign-Ins。

create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;
revoke all on schema private from public, anon;

create table if not exists public.sync_rooms (
  id uuid primary key,
  invite_secret_hash text not null check (invite_secret_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid not null,
  created_at timestamptz not null default now()
);

create table if not exists public.sync_room_members (
  room_id uuid not null references public.sync_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

create table if not exists public.sync_events (
  id uuid primary key,
  room_id uuid not null references public.sync_rooms(id) on delete cascade,
  device_id uuid not null,
  ciphertext text not null,
  iv text not null,
  created_at timestamptz not null default now()
);

create index if not exists sync_events_room_created_idx on public.sync_events(room_id, created_at, id);
create index if not exists sync_room_members_user_idx on public.sync_room_members(user_id, room_id);

alter table public.sync_rooms enable row level security;
alter table public.sync_room_members enable row level security;
alter table public.sync_events enable row level security;

create or replace function private.is_sync_room_member(target_room uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.sync_room_members
    where room_id = target_room and user_id = (select auth.uid())
  );
$$;

create or replace function public.create_sync_room(p_room_id uuid, p_invite_secret_hash text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if p_invite_secret_hash is null or p_invite_secret_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid invite hash'; end if;

  insert into public.sync_rooms (id, invite_secret_hash, created_by)
  values (p_room_id, p_invite_secret_hash, auth.uid());

  insert into public.sync_room_members (room_id, user_id)
  values (p_room_id, auth.uid())
  on conflict do nothing;
  return true;
end;
$$;

create or replace function public.join_sync_room(p_room_id uuid, p_invite_secret text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  expected_hash text;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  select invite_secret_hash into expected_hash from public.sync_rooms where id = p_room_id;
  if expected_hash is null then raise exception 'sync room not found'; end if;
  if p_invite_secret is null or expected_hash <> encode(extensions.digest(convert_to(p_invite_secret, 'UTF8'), 'sha256'), 'hex') then
    raise exception 'invalid invite secret';
  end if;

  insert into public.sync_room_members (room_id, user_id)
  values (p_room_id, auth.uid())
  on conflict do nothing;
  return true;
end;
$$;

drop policy if exists "members can read rooms" on public.sync_rooms;
create policy "members can read rooms" on public.sync_rooms
for select to authenticated using (private.is_sync_room_member(id));

drop policy if exists "members can read own memberships" on public.sync_room_members;
create policy "members can read own memberships" on public.sync_room_members
for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists "members can read encrypted events" on public.sync_events;
create policy "members can read encrypted events" on public.sync_events
for select to authenticated using (private.is_sync_room_member(room_id));

drop policy if exists "members can append encrypted events" on public.sync_events;
create policy "members can append encrypted events" on public.sync_events
for insert to authenticated with check (
  private.is_sync_room_member(room_id)
  and length(ciphertext) > 0
  and octet_length(ciphertext) <= 5242880
  and length(iv) between 12 and 32
);

revoke all on public.sync_rooms, public.sync_room_members, public.sync_events from anon, authenticated;
grant select on public.sync_rooms, public.sync_room_members to authenticated;
grant select, insert on public.sync_events to authenticated;

drop function if exists public.is_sync_room_member(uuid);

revoke all on function private.is_sync_room_member(uuid) from public, anon;
revoke all on function public.create_sync_room(uuid, text) from public, anon;
revoke all on function public.join_sync_room(uuid, text) from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.is_sync_room_member(uuid) to authenticated;
grant execute on function public.create_sync_room(uuid, text) to authenticated;
grant execute on function public.join_sync_room(uuid, text) to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.sync_events;
exception when duplicate_object then null;
end $$;
