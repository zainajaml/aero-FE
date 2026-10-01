insert into storage.buckets (id, name, public)
values ('document-images', 'document-images', true)
on conflict (id) do nothing;

create policy "Document images are publicly accessible"
on storage.objects for select
using (bucket_id = 'document-images');

create policy "Members can upload document images"
on storage.objects for insert to authenticated
with check (bucket_id = 'document-images' and owner = auth.uid());

create policy "Owners can update their document images"
on storage.objects for update to authenticated
using (bucket_id = 'document-images' and owner = auth.uid());

create policy "Owners can delete their document images"
on storage.objects for delete to authenticated
using (bucket_id = 'document-images' and owner = auth.uid());