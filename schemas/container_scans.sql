create table public.container_scans (
  id uuid not null default gen_random_uuid (),
  user_id uuid not null,
  predicted_class text not null,
  confidence numeric(6, 5) null,
  is_valid boolean not null default false,
  rejection_reason text null,
  entropy numeric(10, 6) null,
  margin numeric(10, 6) null,
  probabilities jsonb not null default '{}'::jsonb,
  image_uri text null,
  created_at timestamp with time zone not null default now(),
  constraint container_scans_pkey primary key (id),
  constraint container_scans_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade,
  constraint container_scans_confidence_check check (
    confidence is null
    or (
      confidence >= (0)::numeric
      and confidence <= (1)::numeric
    )
  ),
  constraint container_scans_margin_check check (
    margin is null
    or (
      margin >= (0)::numeric
      and margin <= (1)::numeric
    )
  )
) tablespace pg_default;

create index if not exists container_scans_user_created_idx
  on public.container_scans using btree (user_id, created_at desc)
  tablespace pg_default;

alter table public.container_scans enable row level security;

create policy "container_scans_select_own"
on public.container_scans
for select
to authenticated
using (auth.uid() = user_id);

create policy "container_scans_insert_own"
on public.container_scans
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "container_scans_delete_own"
on public.container_scans
for delete
to authenticated
using (auth.uid() = user_id);
