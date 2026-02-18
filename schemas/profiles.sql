create table public.profiles (
  id uuid not null,
  display_name text null,
  organization text null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  avatar_url text null,
  role smallint not null default 0,
  status text not null default 'active'::text,
  constraint profiles_pkey primary key (id),
  constraint profiles_id_fkey foreign KEY (id) references auth.users (id) on delete CASCADE,
  constraint profiles_role_check check ((role = any (array[0, 1]))),
  constraint profiles_status_check check (
    (
      status = any (array['active'::text, 'deactivated'::text])
    )
  )
) TABLESPACE pg_default;

alter table public.profiles enable row level security;

create policy "profiles_select_authenticated"
on public.profiles
for select
to authenticated
using (true);

create policy "profiles_insert_own"
on public.profiles
for insert
to authenticated
with check (auth.uid() = id);

create policy "profiles_update_own"
on public.profiles
for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, organization, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'organization',
    coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture')
  )
  on conflict (id) do update set
    display_name = coalesce(excluded.display_name, public.profiles.display_name),
    organization = coalesce(excluded.organization, public.profiles.organization),
    avatar_url = coalesce(excluded.avatar_url, public.profiles.avatar_url),
    updated_at = now();

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
after insert on auth.users
for each row execute function public.handle_new_user_profile();

insert into public.profiles (id, display_name, organization, avatar_url)
select
  au.id,
  coalesce(au.raw_user_meta_data ->> 'display_name', au.raw_user_meta_data ->> 'full_name', au.raw_user_meta_data ->> 'name'),
  au.raw_user_meta_data ->> 'organization',
  coalesce(au.raw_user_meta_data ->> 'avatar_url', au.raw_user_meta_data ->> 'picture')
from auth.users au
on conflict (id) do update set
  display_name = coalesce(excluded.display_name, public.profiles.display_name),
  organization = coalesce(excluded.organization, public.profiles.organization),
  avatar_url = coalesce(excluded.avatar_url, public.profiles.avatar_url),
  updated_at = now();