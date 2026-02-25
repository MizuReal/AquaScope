alter table public.forum_threads enable row level security;

drop policy if exists "forum_threads_delete_own"
on public.forum_threads;

create policy "forum_threads_delete_own"
on public.forum_threads
for delete
using (auth.uid() = user_id);
