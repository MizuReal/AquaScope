create table public.forum_post_likes (
  post_id uuid not null,
  user_id uuid not null,
  created_at timestamp with time zone not null default now(),
  constraint forum_post_likes_pkey primary key (post_id, user_id),
  constraint forum_post_likes_post_id_fkey foreign KEY (post_id) references forum_posts (id) on delete CASCADE,
  constraint forum_post_likes_user_id_fkey foreign KEY (user_id) references auth.users (id) on delete CASCADE
) TABLESPACE pg_default;