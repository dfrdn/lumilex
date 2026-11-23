-- Multitenancy phase 5, wave 3: retire pg_cron scheduling. Every job moved to
-- vercel.json crons hitting the same routes (see vercel.json). This migration
-- exists for the origin-import cutover — the Lumilex dev project has no pg_cron
-- jobs (the extension may not even be installed), so it must no-op cleanly
-- when the cron schema/table is absent.
--
-- The call_app_api / call_app_api_post helpers are NOT dropped: the pg_net
-- webhook triggers (webhook_file_uploaded, webhook_analysis_completed,
-- webhook_deliverable_finalized) still call them.

do $$
begin
  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'cron' and c.relname = 'job' and c.relkind = 'r'
  ) then
    perform cron.unschedule(jobid) from cron.job;
  end if;
end $$;
