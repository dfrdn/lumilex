-- Matter activity: let bulk jobs opt out, and ignore updates that change nothing.
--
-- touch_matter_activity() treats an UPDATE to any work row as activity and sets
-- matters.last_activity_at = now(), which restarts the 60-day auto-archive
-- clock. Two kinds of write abused that:
--
-- 1. Bulk jobs. A migration or script that rewrites work rows in bulk stamps
--    every live matter it touches as freshly worked on. Such a job now runs
--        SET LOCAL lumilex.skip_activity = 'on';
--    inside its transaction and the trigger does nothing for it.
--
-- 2. No-op updates. A job that re-writes the same value (the SharePoint mirror
--    re-writing `sharepoint_urls` on a file it cannot sync, say) is not work.
--    The comparison leaves out bookkeeping timestamps, which BEFORE UPDATE
--    triggers stamp on every write, and the SharePoint mirror column, which
--    records a copy rather than a change to the work.

CREATE OR REPLACE FUNCTION public.touch_matter_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  ev_ts timestamptz;
BEGIN
  IF NEW.matter_id IS NULL OR current_setting('lumilex.skip_activity', true) = 'on' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF to_jsonb(NEW) - 'notion_last_edited_at' - 'updated_at' - 'synced_at' - 'sharepoint_urls'
     = to_jsonb(OLD) - 'notion_last_edited_at' - 'updated_at' - 'synced_at' - 'sharepoint_urls' THEN
      RETURN NEW;
    END IF;
    -- An edit to existing work = activity now. Refresh the idle clock for a
    -- live matter, but never resurrect an Archived one.
    UPDATE public.matters
       SET last_activity_at = now()
     WHERE notion_id = NEW.matter_id
       AND status <> 'Archived';
    RETURN NEW;
  END IF;

  -- INSERT: use the row's own timestamp so a historical backfill does not
  -- register as fresh activity (and cannot reactivate an archived matter).
  ev_ts := COALESCE((to_jsonb(NEW) ->> TG_ARGV[0])::timestamptz, now());
  IF ev_ts < now() - interval '60 days' THEN
    RETURN NEW;
  END IF;

  UPDATE public.matters
     SET last_activity_at = GREATEST(COALESCE(last_activity_at, 'epoch'::timestamptz), ev_ts)
   WHERE notion_id = NEW.matter_id;

  UPDATE public.matters
     SET status = 'Ongoing'
   WHERE notion_id = NEW.matter_id
     AND status = 'Archived';

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.touch_matter_activity() FROM PUBLIC, anon, authenticated, service_role;
