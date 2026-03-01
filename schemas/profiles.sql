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

create trigger trg_profiles_preserve_non_null_fields BEFORE
update on profiles for EACH row
execute FUNCTION profiles_preserve_non_null_fields ();