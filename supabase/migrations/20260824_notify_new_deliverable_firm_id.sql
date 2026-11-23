-- notify_new_deliverable inserted into `notifications` — a tenant table —
-- without stamping firm_id. That was harmless while the transitional column
-- default existed and became a hard breakage when it was dropped: the insert
-- raises 23502, and because this runs in an AFTER INSERT trigger the whole
-- deliverable insert rolls back. A deliverable created with no drafters still
-- saved, which is what hid it.
--
-- A sweep of every function inserting into a firm_id-bearing table found this
-- to be the only one still unstamped.
CREATE OR REPLACE FUNCTION public.notify_new_deliverable()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- Only create notifications if there are drafters assigned
  IF NEW.drafter_ids IS NOT NULL AND array_length(NEW.drafter_ids, 1) > 0 THEN
    INSERT INTO notifications (person_id, type, title, body, href, entity_id, firm_id)
    SELECT
      unnest(NEW.drafter_ids),
      'assignment',
      'New deliverable: ' || COALESCE(NEW.name, 'Untitled'),
      COALESCE(NEW.matter_name, '') || CASE WHEN NEW.external_due_date IS NOT NULL THEN ' — Due ' || NEW.external_due_date::text ELSE '' END,
      '/dashboard/deliverables/' || NEW.notion_id,
      NEW.notion_id,
      NEW.firm_id;
  END IF;
  RETURN NEW;
END;
$function$;
