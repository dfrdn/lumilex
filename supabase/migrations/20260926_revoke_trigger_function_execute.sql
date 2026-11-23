-- Revoke EXECUTE on the SECURITY DEFINER trigger functions, and on
-- recalc_client_status, from every API role.
--
-- The advisors list all ten trigger functions under
-- anon_security_definer_function_executable and
-- authenticated_security_definer_function_executable because they carry the
-- default function ACL. None of them is reachable that way: PostgREST does not
-- expose `returns trigger`, and a direct call raises 0A000. But the grant is
-- also useless — Postgres checks EXECUTE on a trigger function once, at
-- CREATE TRIGGER, and never when the trigger fires (verified for
-- webhook_file_uploaded in 20260926_revoke_call_app_api.sql, and again for all
-- ten here: an authenticated staff session inserting and updating matters,
-- tasks, deliverables and deliverable_files, and service_role writing
-- chat_messages and file_analyses — the two tables no user policy lets staff
-- write — fired every trigger with the grant revoked). Revoking clears the
-- findings without changing behaviour.
--
-- recalc_client_status(text) is not a trigger function. It re-derives
-- clients.status from the client's matters and writes it, for any client id,
-- in any firm, and anon could call it through /rest/v1/rpc. It returns void and
-- the caller cannot choose the value written, so the reach was small — but it
-- was a cross-firm write available to the anon key, and nothing needs it:
-- no `.rpc('recalc_client_status'` anywhere in app/, lib/ or scripts/, no
-- pg_cron job, and its one caller is matters_recalc_client_status_trg, which
-- is SECURITY DEFINER and runs as the owner.
--
-- Three of the trigger functions also had no pinned search_path
-- (function_search_path_mutable). Their bodies qualify vault.* and net.*, and
-- the unqualified names they use (matter_summaries, call_app_api_post) are in
-- public, so `public, pg_temp` resolves exactly what they resolved before.
--
-- Idempotent: REVOKE and ALTER FUNCTION ... SET re-run cleanly.

REVOKE EXECUTE ON FUNCTION public.matters_recalc_client_status_trg()     FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.notify_new_deliverable()               FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.queue_matter_summary_refresh()         FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.sync_matter_chat_members()             FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.touch_matter_activity()                FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.touch_matter_activity_via_channel()    FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.webhook_analysis_completed()           FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.webhook_deliverable_finalized()        FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.webhook_deliverable_status_finalized() FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.webhook_deliverable_version_uploaded() FROM PUBLIC, anon, authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.recalc_client_status(text) FROM PUBLIC, anon, authenticated, service_role;

ALTER FUNCTION public.webhook_analysis_completed()    SET search_path = public, pg_temp;
ALTER FUNCTION public.webhook_deliverable_finalized() SET search_path = public, pg_temp;
ALTER FUNCTION public.queue_matter_summary_refresh()  SET search_path = public, pg_temp;
