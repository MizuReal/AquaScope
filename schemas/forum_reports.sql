create table public.forum_reports (
  id uuid not null default gen_random_uuid (),
  reporter_id uuid not null,
  thread_id uuid not null,
  reason text not null,
  status text not null default 'pending'::text,
  reviewed_by uuid null,
  reviewed_at timestamp with time zone null,
  created_at timestamp with time zone not null default now(),
  constraint forum_reports_pkey primary key (id),
  constraint forum_reports_reporter_id_fkey foreign key (reporter_id) references auth.users (id) on delete cascade,
  constraint forum_reports_thread_id_fkey foreign key (thread_id) references forum_threads (id) on delete cascade,
  constraint forum_reports_reviewed_by_fkey foreign key (reviewed_by) references auth.users (id) on delete set null,
  constraint forum_reports_status_check check (
    status = any (array['pending'::text, 'reviewed'::text, 'dismissed'::text])
  )
) tablespace pg_default;

create index if not exists forum_reports_status_idx
  on public.forum_reports using btree (status, created_at desc) tablespace pg_default;

create index if not exists forum_reports_thread_idx
  on public.forum_reports using btree (thread_id) tablespace pg_default;

-- RLS policies
alter table public.forum_reports enable row level security;

-- Authenticated users can insert their own reports
create policy forum_reports_insert_own
  on public.forum_reports for insert
  to authenticated
  with check (auth.uid() = reporter_id);

-- Users can see their own reports
create policy forum_reports_select_own
  on public.forum_reports for select
  to authenticated
  using (auth.uid() = reporter_id);

-- Admins can see all reports
create policy forum_reports_select_admin
  on public.forum_reports for select
  to authenticated
  using (
    exists (
      select 1 from profiles
      where profiles.id = auth.uid() and profiles.role = 1
    )
  );

-- Admins can update reports (review/dismiss)
create policy forum_reports_update_admin
  on public.forum_reports for update
  to authenticated
  using (
    exists (
      select 1 from profiles
      where profiles.id = auth.uid() and profiles.role = 1
    )
  )
  with check (
    exists (
      select 1 from profiles
      where profiles.id = auth.uid() and profiles.role = 1
    )
  );
