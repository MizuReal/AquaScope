create table if not exists public.forum_thread_likes (
  thread_id uuid not null,
  user_id uuid not null,
  created_at timestamp with time zone not null default now(),
  constraint forum_thread_likes_pkey primary key (thread_id, user_id),
  constraint forum_thread_likes_thread_id_fkey foreign key (thread_id) references public.forum_threads (id) on delete cascade,
  constraint forum_thread_likes_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade
) tablespace pg_default;

create index if not exists forum_thread_likes_thread_idx on public.forum_thread_likes using btree (thread_id) tablespace pg_default;
create index if not exists forum_thread_likes_user_idx on public.forum_thread_likes using btree (user_id) tablespace pg_default;

alter table public.forum_thread_likes enable row level security;

create policy "forum_thread_likes_select"
on public.forum_thread_likes for select
using (true);

create policy "forum_thread_likes_insert"
on public.forum_thread_likes for insert
with check (auth.uid() = user_id);

create policy "forum_thread_likes_delete_own"
on public.forum_thread_likes for delete
using (auth.uid() = user_id);