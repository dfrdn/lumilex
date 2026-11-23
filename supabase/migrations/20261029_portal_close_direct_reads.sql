-- A client's JWT reads no firm table directly.
--
-- The *_portal_select policies scoped rows by firm and client only, and a
-- signed-in client holds a JWT and the anon key, so they could call PostgREST
-- themselves (/rest/v1/deliverables?select=*) and read everything on their
-- matters that lib/portal/* filters out: drafts and internal work with their
-- drafter and reviewer ids, internal meetings, matters' internal fields,
-- clients' own collection and billing columns, invoice line items, exhibit
-- notes, and the working copies of unfinished deliverables in `files`. Column
-- grants can't narrow it, because staff share the `authenticated` role.
--
-- So the portal now reads with getServiceDbForFirm after getPortalSession(),
-- and every loader and /api/portal route scopes to the session's client
-- explicitly (the staff preview already ran the loaders that way). These
-- policies go. What a client's JWT still reads: its own client_users row
-- (client_users_select_own) and its own portal chat
-- (portal_chat_messages_own_select) — both are the client's own.
--
-- files_portal_insert goes too: portal uploads insert through the service
-- client after the ownership check, so the policy only let a client write
-- `files` rows directly. The team write policies on `files` (which admitted a
-- client for a matter-less row) were split and staff-gated in
-- 20261029_files_team_write_split.sql.
--
-- Probe: scripts/rls-probe.ts, portal persona.

DROP POLICY IF EXISTS clients_portal_select ON public.clients;
DROP POLICY IF EXISTS matters_portal_select ON public.matters;
DROP POLICY IF EXISTS deliverables_portal_select ON public.deliverables;
DROP POLICY IF EXISTS files_portal_select ON public.files;
DROP POLICY IF EXISTS files_portal_insert ON public.files;
DROP POLICY IF EXISTS exhibits_portal_select ON public.exhibits;
DROP POLICY IF EXISTS hearings_portal_select ON public.hearings;
DROP POLICY IF EXISTS meetings_portal_select ON public.meetings;
DROP POLICY IF EXISTS invoices_portal_select ON public.invoices;
DROP POLICY IF EXISTS invoice_payments_portal_select ON public.invoice_payments;
DROP POLICY IF EXISTS client_deposits_portal_select ON public.client_deposits;
DROP POLICY IF EXISTS file_requests_portal_select ON public.file_requests;
DROP POLICY IF EXISTS engagement_signatures_portal_select ON public.engagement_signatures;
