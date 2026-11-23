-- Marks read their matters from matter_subjects, as companies do. A mark can
-- be covered by several engagements, each in a role (20261121_subjects.sql):
--   trademark               the filing (prosecution) matter
--   trademark_maintenance   DAUs and renewal
--   opposition              an opposition or cancellation
--   retainer                a general retainer
-- and its client is its own field, no longer copied from "the" matter.
--
-- Transition (expand-only):
--   * links -> trademarks.matter_id/matter_name: the mark's main matter (its
--     filing link, else its retainer, else any) is mirrored back for the
--     readers that still show one matter (detail page, deadline dashboard,
--     report DOCX).
--   * trademarks.matter_id -> the filing link (trg_trademarks_mirror_matter)
--     keeps the admin table and the create paths working; it ignores writes
--     made by the reverse mirror (lumilex.mark_mirror).
-- A contract migration drops matter_id/matter_name and both mirrors.

-- ── links -> matter_id ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mirror_trademark_matter_from_links() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  sid text := CASE WHEN TG_OP = 'DELETE' THEN OLD.subject_id ELSE NEW.subject_id END;
  main text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.trademarks WHERE id = sid) THEN RETURN NULL; END IF;
  SELECT ms.matter_id INTO main
  FROM public.matter_subjects ms
  WHERE ms.subject_id = sid
  ORDER BY CASE ms.scope WHEN 'trademark' THEN 0 WHEN 'retainer' THEN 1 WHEN 'trademark_maintenance' THEN 2 ELSE 3 END, ms.matter_id
  LIMIT 1;
  PERFORM set_config('lumilex.mark_mirror', 'on', true);
  UPDATE public.trademarks t
  SET matter_id = main,
      matter_name = coalesce((SELECT m.name FROM public.matters m WHERE m.notion_id = main AND m.firm_id = t.firm_id), '')
  WHERE t.id = sid AND t.matter_id IS DISTINCT FROM main;
  PERFORM set_config('lumilex.mark_mirror', 'off', true);
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_matter_subjects_mirror_trademark ON public.matter_subjects;
CREATE TRIGGER trg_matter_subjects_mirror_trademark AFTER INSERT OR UPDATE OR DELETE ON public.matter_subjects
  FOR EACH ROW EXECUTE FUNCTION public.mirror_trademark_matter_from_links();

-- ── the mark's own client ──────────────────────────────────────────────────
-- Whenever a mark's client is set or changes — by any path: the mark page,
-- the admin table, a matter's client being corrected, a client merge — its
-- name and code follow the client, and it takes the next number in that
-- client's sequence (the "01" of the Ref. No.), so it can't collide with a
-- mark already numbered there. Only a client of the mark's own firm counts.
CREATE OR REPLACE FUNCTION public.trademark_client_fields() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  c record;
BEGIN
  IF NEW.client_id IS NULL THEN
    IF TG_OP = 'UPDATE' AND OLD.client_id IS NOT NULL THEN
      NEW.client_index := 0;
      NEW.client_code := NULL;
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.client_id IS NOT DISTINCT FROM OLD.client_id THEN RETURN NEW; END IF;

  SELECT name, client_code INTO c FROM public.clients WHERE notion_id = NEW.client_id AND firm_id = NEW.firm_id;
  IF FOUND THEN
    NEW.client_name := coalesce(c.name, NEW.client_name);
    NEW.client_code := c.client_code;
  END IF;
  IF TG_OP = 'UPDATE' OR coalesce(NEW.client_index, 0) = 0 THEN
    NEW.client_index := coalesce(
      (SELECT max(t.client_index) FROM public.trademarks t
       WHERE t.client_id = NEW.client_id AND t.firm_id = NEW.firm_id AND t.id <> NEW.id), 0) + 1;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_trademarks_client_fields ON public.trademarks;
CREATE TRIGGER trg_trademarks_client_fields BEFORE INSERT OR UPDATE OF client_id ON public.trademarks
  FOR EACH ROW EXECUTE FUNCTION public.trademark_client_fields();

REVOKE EXECUTE ON FUNCTION public.mirror_trademark_matter_from_links() FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.trademark_client_fields() FROM PUBLIC, anon, authenticated, service_role;
