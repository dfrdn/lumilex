-- What a client sees in the portal changes only through the app's gate.
--
-- corporations_team_write and trademarks_team_write let staff write these
-- tables with their own JWT, so without this anyone signed in could set
-- portal_visible straight through PostgREST and skip the check in
-- lib/portal/switch-access.ts (who may switch, whether the client has a
-- portal user, whether the preview was seen, and the audit row). The app
-- writes the column with the service role, which this leaves alone.

CREATE OR REPLACE FUNCTION public.guard_portal_visible()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW; -- service role, postgres
  END IF;
  IF TG_OP = 'INSERT' AND NOT NEW.portal_visible THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.portal_visible IS NOT DISTINCT FROM OLD.portal_visible THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'The client portal switch is changed from the company or mark page'
    USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS trg_corporations_guard_portal_visible ON public.corporations;
CREATE TRIGGER trg_corporations_guard_portal_visible
  BEFORE INSERT OR UPDATE OF portal_visible ON public.corporations
  FOR EACH ROW EXECUTE FUNCTION public.guard_portal_visible();

DROP TRIGGER IF EXISTS trg_trademarks_guard_portal_visible ON public.trademarks;
CREATE TRIGGER trg_trademarks_guard_portal_visible
  BEFORE INSERT OR UPDATE OF portal_visible ON public.trademarks
  FOR EACH ROW EXECUTE FUNCTION public.guard_portal_visible();
