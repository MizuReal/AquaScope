create table public.forum_posts (
  id uuid not null default gen_random_uuid (),
  thread_id uuid not null,
  user_id uuid not null,
  parent_post_id uuid null,
  body text not null,
  created_at timestamp with time zone not null default now(),
  edited_at timestamp with time zone null,
  deleted_at timestamp with time zone null,
  constraint forum_posts_pkey primary key (id),
  constraint forum_posts_parent_post_id_fkey foreign KEY (parent_post_id) references forum_posts (id) on delete CASCADE,
  constraint forum_posts_thread_id_fkey foreign KEY (thread_id) references forum_threads (id) on delete CASCADE,
  constraint forum_posts_user_id_fkey foreign KEY (user_id) references auth.users (id) on delete CASCADE
) TABLESPACE pg_default;

create index IF not exists forum_posts_thread_created_idx on public.forum_posts using btree (thread_id, created_at) TABLESPACE pg_default;

create index IF not exists forum_posts_parent_idx on public.forum_posts using btree (parent_post_id) TABLESPACE pg_default;

create index IF not exists forum_posts_user_created_idx on public.forum_posts using btree (user_id, created_at desc) TABLESPACE pg_default;