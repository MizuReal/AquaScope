create table public.forum_notifications (
  id uuid not null default gen_random_uuid (),
  recipient_user_id uuid not null,
  actor_user_id uuid not null,
  thread_id uuid not null,
  post_id uuid not null,
  type text not null default 'thread_reply'::text,
  title text not null,
  body text not null,
  is_read boolean not null default false,
  read_at timestamp with time zone null,
  created_at timestamp with time zone not null default now(),
  constraint forum_notifications_pkey primary key (id),
  constraint forum_notifications_unique_reply unique (recipient_user_id, post_id, type),
  constraint forum_notifications_actor_user_id_fkey foreign KEY (actor_user_id) references auth.users (id) on delete CASCADE,
  constraint forum_notifications_thread_id_fkey foreign KEY (thread_id) references forum_threads (id) on delete CASCADE,
  constraint forum_notifications_recipient_user_id_fkey foreign KEY (recipient_user_id) references auth.users (id) on delete CASCADE,
  constraint forum_notifications_post_id_fkey foreign KEY (post_id) references forum_posts (id) on delete CASCADE,
  constraint forum_notifications_type_check check ((type = 'thread_reply'::text))
) TABLESPACE pg_default;

create index IF not exists forum_notifications_recipient_created_idx on public.forum_notifications using btree (recipient_user_id, created_at desc) TABLESPACE pg_default;

create index IF not exists forum_notifications_unread_idx on public.forum_notifications using btree (recipient_user_id, is_read, created_at desc) TABLESPACE pg_default;