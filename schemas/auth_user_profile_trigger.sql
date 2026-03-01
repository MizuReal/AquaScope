-- Ensure new auth users always get a profile row without making HTTP calls.
-- This avoids PostgREST "No API key found in request" failures during sign-up.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (
    id,
    display_name,
    organization
  )
  values (
    new.id,
    coalesce(
      nullif(new.raw_user_meta_data ->> 'full_name', ''),
      nullif(new.raw_user_meta_data ->> 'name', ''),
      split_part(coalesce(new.email, ''), '@', 1)
    ),
    nullif(new.raw_user_meta_data ->> 'organization', '')
  )
  on conflict (id)
  do update set
    display_name = coalesce(excluded.display_name, public.profiles.display_name),
    organization = coalesce(excluded.organization, public.profiles.organization),
    updated_at = now();

  return new;
end;
$$;

-- Drop/recreate trigger so this script is safe to run multiple times.
drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
after insert on auth.users
for each row
execute procedure public.handle_new_user();
