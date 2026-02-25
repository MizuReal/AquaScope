-- Extensions
create extension if not exists pgcrypto;

-- Categories (system-managed)
create table if not exists public.forum_categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  label text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Seed initial 5 categories (update these later as your system changes)
insert into public.forum_categories (slug, label)
values
  ('field_ops', 'Field Ops'),
  ('lab_insights', 'Lab Insights'),
  ('policy', 'Policy'),
  ('hardware', 'Hardware'),
  ('ai_models', 'AI Models')
on conflict (slug) do update
set label = excluded.label,
    is_active = true;

-- Threads (top-level posts)
create table if not exists public.forum_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  body text not null,
  is_locked boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Thread <-> Categories (max 5 per thread)
create table if not exists public.forum_thread_categories (
  thread_id uuid not null references public.forum_threads(id) on delete cascade,
  category_id uuid not null references public.forum_categories(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (thread_id, category_id)
);

-- Replies (messages)
create table if not exists public.forum_posts (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.forum_threads(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  parent_post_id uuid null references public.forum_posts(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  edited_at timestamptz null,
  deleted_at timestamptz null
);

-- Likes (per reply/message)
create table if not exists public.forum_post_likes (
  post_id uuid not null references public.forum_posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

-- Likes (per thread)
create table if not exists public.forum_thread_likes (
  thread_id uuid not null references public.forum_threads(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (thread_id, user_id)
);

-- Indexes
create index if not exists forum_threads_created_idx on public.forum_threads (created_at desc);
create index if not exists forum_posts_thread_created_idx on public.forum_posts (thread_id, created_at asc);
create index if not exists forum_posts_parent_idx on public.forum_posts (parent_post_id);
create index if not exists forum_posts_user_created_idx on public.forum_posts (user_id, created_at desc);
create index if not exists forum_thread_likes_thread_idx on public.forum_thread_likes (thread_id);
create index if not exists forum_thread_likes_user_idx on public.forum_thread_likes (user_id);

-- updated_at trigger helper
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists forum_threads_set_updated_at on public.forum_threads;
create trigger forum_threads_set_updated_at
before update on public.forum_threads
for each row execute function public.set_updated_at();

-- Enforce max 5 categories per thread
create or replace function public.forum_enforce_thread_categories_limit()
returns trigger language plpgsql as $$
declare
  category_count int;
begin
  select count(*) into category_count
  from public.forum_thread_categories
  where thread_id = new.thread_id;

  if category_count >= 5 then
    raise exception 'A thread can have at most 5 categories.';
  end if;

  return new;
end;
$$;

drop trigger if exists forum_thread_categories_limit on public.forum_thread_categories;
create trigger forum_thread_categories_limit
before insert on public.forum_thread_categories
for each row execute function public.forum_enforce_thread_categories_limit();

drop trigger if exists forum_threads_reject_bad_words on public.forum_threads;
drop trigger if exists forum_posts_reject_bad_words on public.forum_posts;
drop function if exists public.forum_reject_bad_words();
drop table if exists public.forum_bad_words;

-- RLS
alter table public.forum_categories enable row level security;
alter table public.forum_threads enable row level security;
alter table public.forum_thread_categories enable row level security;
alter table public.forum_posts enable row level security;
alter table public.forum_post_likes enable row level security;
alter table public.forum_thread_likes enable row level security;

-- Categories: readable by all
create policy "forum_categories_select"
on public.forum_categories for select
using (true);

-- Threads
create policy "forum_threads_select"
on public.forum_threads for select
using (true);

create policy "forum_threads_insert"
on public.forum_threads for insert
with check (auth.uid() = user_id);

create policy "forum_threads_update_own"
on public.forum_threads for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- Thread categories: only thread owner can add/remove
create policy "forum_thread_categories_select"
on public.forum_thread_categories for select
using (true);

create policy "forum_thread_categories_insert_owner"
on public.forum_thread_categories for insert
with check (
  exists (
    select 1 from public.forum_threads t
    where t.id = thread_id and t.user_id = auth.uid()
  )
);

create policy "forum_thread_categories_delete_owner"
on public.forum_thread_categories for delete
using (
  exists (
    select 1 from public.forum_threads t
    where t.id = thread_id and t.user_id = auth.uid()
  )
);

-- Posts (replies)
create policy "forum_posts_select"
on public.forum_posts for select
using (true);

create policy "forum_posts_insert"
on public.forum_posts for insert
with check (auth.uid() = user_id);

create policy "forum_posts_update_own"
on public.forum_posts for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- Likes
create policy "forum_post_likes_select"
on public.forum_post_likes for select
using (true);

create policy "forum_post_likes_insert"
on public.forum_post_likes for insert
with check (auth.uid() = user_id);

create policy "forum_post_likes_delete_own"
on public.forum_post_likes for delete
using (auth.uid() = user_id);

create policy "forum_thread_likes_select"
on public.forum_thread_likes for select
using (true);

create policy "forum_thread_likes_insert"
on public.forum_thread_likes for insert
with check (auth.uid() = user_id);

create policy "forum_thread_likes_delete_own"
on public.forum_thread_likes for delete
using (auth.uid() = user_id);