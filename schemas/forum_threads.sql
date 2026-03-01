create table public.forum_threads (
  id uuid not null default gen_random_uuid (),
  user_id uuid not null,
  title text not null,
  body text not null,
  is_locked boolean not null default false,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint forum_threads_pkey primary key (id),
  constraint forum_threads_user_id_fkey foreign KEY (user_id) references auth.users (id) on delete CASCADE
) TABLESPACE pg_default;

create index IF not exists forum_threads_created_idx on public.forum_threads using btree (created_at desc) TABLESPACE pg_default;

create trigger forum_threads_set_updated_at BEFORE
update on forum_threads for EACH row
execute FUNCTION set_updated_at ();