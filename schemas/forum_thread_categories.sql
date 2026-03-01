create table public.forum_thread_categories (
  thread_id uuid not null,
  category_id uuid not null,
  created_at timestamp with time zone not null default now(),
  constraint forum_thread_categories_pkey primary key (thread_id, category_id),
  constraint forum_thread_categories_category_id_fkey foreign KEY (category_id) references forum_categories (id) on delete RESTRICT,
  constraint forum_thread_categories_thread_id_fkey foreign KEY (thread_id) references forum_threads (id) on delete CASCADE
) TABLESPACE pg_default;

create trigger forum_thread_categories_limit BEFORE INSERT on forum_thread_categories for EACH row
execute FUNCTION forum_enforce_thread_categories_limit ();