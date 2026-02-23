insert into storage.buckets (id, name, public)
values ('container-scans', 'container-scans', true)
on conflict (id) do update set public = true;

create policy "container_scans_upload_own"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'container-scans'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "container_scans_delete_own"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'container-scans'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "container_scans_update_own"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'container-scans'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'container-scans'
  and (storage.foldername(name))[1] = auth.uid()::text
);
