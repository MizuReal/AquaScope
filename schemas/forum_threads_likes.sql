create table public.forum_thread_likes (
  thread_id uuid not null,
  user_id uuid not null,
  created_at timestamp with time zone not null default now(),
  constraint forum_thread_likes_pkey primary key (thread_id, user_id),
  constraint forum_thread_likes_thread_id_fkey foreign KEY (thread_id) references forum_threads (id) on delete CASCADE,
  constraint forum_thread_likes_user_id_fkey foreign KEY (user_id) references auth.users (id) on delete CASCADE
) TABLESPACE pg_default;

create index IF not exists forum_thread_likes_thread_idx on public.forum_thread_likes using btree (thread_id) TABLESPACE pg_default;

create index IF not exists forum_thread_likes_user_idx on public.forum_thread_likes using btree (user_id) TABLESPACE pg_default;