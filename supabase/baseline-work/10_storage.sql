-- Storage: buckets (6) and storage.objects policies (9), exact values from live DB.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/png','image/jpeg','image/webp','image/gif'])
on conflict (id) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documents', 'documents', false, 52428800, array['application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','image/jpeg','image/png'])
on conflict (id) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('files', 'files', false, null, null)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('issuances', 'issuances', true, null, null)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 20971520, array['image/jpeg','image/png','image/gif','image/webp','image/heic','application/pdf'])
on conflict (id) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('templates', 'templates', false, null, array['application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/msword'])
on conflict (id) do nothing;

-- Policies on storage.objects

create policy "Service role full access" on storage.objects as permissive for all to service_role using (true) with check (true);

create policy "auth_delete_documents" on storage.objects as permissive for delete to authenticated using ((bucket_id = 'documents'::text));

create policy "auth_delete_receipts" on storage.objects as permissive for delete to authenticated using ((bucket_id = 'receipts'::text));

create policy "auth_read_documents" on storage.objects as permissive for select to authenticated using ((bucket_id = 'documents'::text));

create policy "auth_read_receipts" on storage.objects as permissive for select to authenticated using ((bucket_id = 'receipts'::text));

create policy "auth_update_documents" on storage.objects as permissive for update to authenticated using ((bucket_id = 'documents'::text));

create policy "auth_update_receipts" on storage.objects as permissive for update to authenticated using ((bucket_id = 'receipts'::text));

create policy "auth_upload_documents" on storage.objects as permissive for insert to authenticated with check ((bucket_id = 'documents'::text));

create policy "auth_upload_receipts" on storage.objects as permissive for insert to authenticated with check ((bucket_id = 'receipts'::text));
