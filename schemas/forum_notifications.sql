create table if not exists public.forum_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  actor_user_id uuid not null references auth.users(id) on delete cascade,
  thread_id uuid not null references public.forum_threads(id) on delete cascade,
  post_id uuid not null references public.forum_posts(id) on delete cascade,
  type text not null default 'thread_reply',
  title text not null,
  body text not null,
  is_read boolean not null default false,
  read_at timestamptz null,
  created_at timestamptz not null default now(),
  constraint forum_notifications_type_check check (type = 'thread_reply'),
  constraint forum_notifications_unique_reply unique (recipient_user_id, post_id, type)
);

create index if not exists forum_notifications_recipient_created_idx
  on public.forum_notifications (recipient_user_id, created_at desc);

create index if not exists forum_notifications_unread_idx
  on public.forum_notifications (recipient_user_id, is_read, created_at desc);

alter table public.forum_notifications enable row level security;

drop policy if exists "forum_notifications_select_own" on public.forum_notifications;
create policy "forum_notifications_select_own"
on public.forum_notifications for select
using (auth.uid() = recipient_user_id);

drop policy if exists "forum_notifications_update_own" on public.forum_notifications;
create policy "forum_notifications_update_own"
on public.forum_notifications for update
using (auth.uid() = recipient_user_id)
with check (auth.uid() = recipient_user_id);

create or replace function public.create_forum_reply_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  thread_owner uuid;
  actor_name text;
begin
  select t.user_id
  into thread_owner
  from public.forum_threads t
  where t.id = new.thread_id;

  if thread_owner is null then
    return new;
  end if;

  if thread_owner = new.user_id then
    return new;
  end if;

  select p.display_name
  into actor_name
  from public.profiles p
  where p.id = new.user_id;

  insert into public.forum_notifications (
    recipient_user_id,
    actor_user_id,
    thread_id,
    post_id,
    type,
    title,
    body
  )
  values (
    thread_owner,
    new.user_id,
    new.thread_id,
    new.id,
    'thread_reply',
    'New reply on your thread',
    coalesce(nullif(actor_name, ''), 'Someone') || ' replied to your thread.'
  )
  on conflict (recipient_user_id, post_id, type) do nothing;

  return new;
end;
$$;

drop trigger if exists forum_posts_create_reply_notification on public.forum_posts;
create trigger forum_posts_create_reply_notification
after insert on public.forum_posts
for each row
execute function public.create_forum_reply_notification();
