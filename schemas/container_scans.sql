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
  constraint container_scans_user_id_fkey foreign KEY (user_id) references auth.users (id) on delete CASCADE,
  constraint container_scans_confidence_check check (
    (
      (confidence is null)
      or (
        (confidence >= (0)::numeric)
        and (confidence <= (1)::numeric)
      )
    )
  ),
  constraint container_scans_margin_check check (
    (
      (margin is null)
      or (
        (margin >= (0)::numeric)
        and (margin <= (1)::numeric)
      )
    )
  )
) TABLESPACE pg_default;

create index IF not exists container_scans_user_created_idx on public.container_scans using btree (user_id, created_at desc) TABLESPACE pg_default;