create table public.field_samples (
  id uuid not null default gen_random_uuid (),
  user_id uuid null,
  sample_label text null,
  ph double precision null,
  hardness double precision null,
  solids double precision null,
  chloramines double precision null,
  sulfate double precision null,
  conductivity double precision null,
  organic_carbon double precision null,
  trihalomethanes double precision null,
  turbidity double precision null,
  free_chlorine_residual double precision null,
  color text null,
  source text null,
  notes text null,
  prediction_probability numeric(5, 4) not null,
  prediction_is_potable boolean not null,
  risk_level text not null,
  model_version text not null,
  anomaly_checks jsonb not null default '[]'::jsonb,
  created_at timestamp with time zone not null default now(),
  microbial_risk text null,
  microbial_score integer null,
  possible_bacteria jsonb null default '[]'::jsonb,
  constraint field_samples_pkey primary key (id),
  constraint field_samples_user_id_fkey foreign KEY (user_id) references auth.users (id) on delete set null,
  constraint field_samples_prediction_probability_check check (
    (
      (prediction_probability >= (0)::numeric)
      and (prediction_probability <= (1)::numeric)
    )
  )
) TABLESPACE pg_default;

create index IF not exists field_samples_user_created_idx on public.field_samples using btree (user_id, created_at desc) TABLESPACE pg_default;