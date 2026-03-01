create table public.water_potability (
  id uuid not null default gen_random_uuid (),
  ph numeric null,
  hardness numeric null,
  solids numeric null,
  chloramines numeric null,
  sulfate numeric null,
  conductivity numeric null,
  organic_carbon numeric null,
  trihalomethanes numeric null,
  turbidity numeric null,
  is_potable boolean null,
  microbial_risk text null,
  constraint water_potability_pkey primary key (id),
  constraint water_potability_microbial_risk_check check (
    (
      (microbial_risk is null)
      or (
        microbial_risk = any (array['low'::text, 'medium'::text, 'high'::text])
      )
    )
  )
) TABLESPACE pg_default;