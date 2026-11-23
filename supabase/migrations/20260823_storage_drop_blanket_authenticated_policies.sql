-- storage.objects carried four blanket policies per bucket for `documents`
-- and `receipts`: SELECT/INSERT/UPDATE/DELETE granted to the `authenticated`
-- role on nothing but `bucket_id = '<bucket>'`. No firm conjunct, no owner
-- check — so any signed-in user of any firm could list, download, overwrite
-- and delete every engagement agreement and every reimbursement receipt in
-- the system straight from the browser with the anon key. `scripts/rls-probe.ts`
-- could not see it: the leak is in storage, not in Postgres tables.
--
-- Nothing in the app needs them. Every read is a service-role signed URL and
-- every upload is a service-role signed upload URL, both of which bypass RLS
-- by design — which is exactly why the `files` bucket, which has never had an
-- `authenticated` policy, works the same way today.
--
-- Deny-by-default matches `files`, `templates`, `avatars` and `issuances`:
-- service_role only, with the app deciding access before it signs anything.
-- Verified by scripts/storage-probe.ts.

drop policy if exists "auth_read_documents"   on storage.objects;
drop policy if exists "auth_upload_documents" on storage.objects;
drop policy if exists "auth_update_documents" on storage.objects;
drop policy if exists "auth_delete_documents" on storage.objects;

drop policy if exists "auth_read_receipts"   on storage.objects;
drop policy if exists "auth_upload_receipts" on storage.objects;
drop policy if exists "auth_update_receipts" on storage.objects;
drop policy if exists "auth_delete_receipts" on storage.objects;
