create table public.forum_categories (
  id uuid not null default gen_random_uuid (),
  slug text not null,
  label text not null,
  is_active boolean not null default true,
  created_at timestamp with time zone not null default now(),
  constraint forum_categories_pkey primary key (id),
  constraint forum_categories_slug_key unique (slug)
) TABLESPACE pg_default;