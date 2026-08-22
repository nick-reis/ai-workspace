create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  github_username text,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is
  'Application-safe user profile data linked one-to-one with Supabase Auth users.';

alter table public.profiles enable row level security;

revoke all on table public.profiles from anon;
grant select, update on table public.profiles to authenticated;
grant all on table public.profiles to service_role;

create policy "Users can view their own profile"
on public.profiles
for select
to authenticated
using ((select auth.uid()) = id);

create policy "Users can update their own profile"
on public.profiles
for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (
    id,
    github_username,
    display_name,
    avatar_url
  )
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'user_name',
      new.raw_user_meta_data ->> 'preferred_username'
    ),
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      new.raw_user_meta_data ->> 'user_name'
    ),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do update
  set
    github_username = excluded.github_username,
    display_name = excluded.display_name,
    avatar_url = excluded.avatar_url,
    updated_at = now();

  return new;
end;
$$;

create trigger on_auth_user_created
after insert or update of raw_user_meta_data on auth.users
for each row execute function public.handle_new_user();

insert into public.profiles (
  id,
  github_username,
  display_name,
  avatar_url
)
select
  id,
  coalesce(
    raw_user_meta_data ->> 'user_name',
    raw_user_meta_data ->> 'preferred_username'
  ),
  coalesce(
    raw_user_meta_data ->> 'full_name',
    raw_user_meta_data ->> 'name',
    raw_user_meta_data ->> 'user_name'
  ),
  raw_user_meta_data ->> 'avatar_url'
from auth.users
on conflict (id) do nothing;
