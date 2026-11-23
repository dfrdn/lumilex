-- A stored reading of every subject's status, for lists that span the book.
--
-- buildCorporationStatus (lib/corporations/status.ts) is computed live on a
-- company's own page. Computing it for every company on every list load reads
-- every file, person, meeting and filing in the book — fine at fifteen
-- companies, not at thousands. So the result is stored here, one row per
-- subject plus one row per open dated item, and refreshed per firm by
-- /api/cron/subject-status: triggers below mark a subject stale whenever
-- anything its status reads changes, and a row computed for an earlier day is
-- stale too (overdue is a function of the date). Marks are read the same way
-- (buildTrademarkStatus, lib/trademarks/status-refresh.ts).

CREATE TABLE IF NOT EXISTS public.subject_status (
  subject_id text PRIMARY KEY REFERENCES public.subjects(id) ON DELETE CASCADE,
  firm_id uuid NOT NULL REFERENCES public.firms(id) ON DELETE CASCADE,
  type text NOT NULL,
  -- Snapshot for listing without joins: name, lifecycle status, identifiers,
  -- client and team as of the last refresh.
  name text NOT NULL DEFAULT '',
  lifecycle_status text,
  company_type text,
  identifier text,
  client_id text,
  client_name text,
  team jsonb NOT NULL DEFAULT '[]',
  -- Who works on the subject, as person ids, so lists can open on "mine":
  -- the subjects where the viewer is on the team of a matter that covers them.
  team_person_ids text[] NOT NULL DEFAULT '{}',
  -- The reading.
  phase text,
  health text,
  overdue integer NOT NULL DEFAULT 0,
  due_soon integer NOT NULL DEFAULT 0,
  waiting_on_client boolean NOT NULL DEFAULT false,
  focus jsonb NOT NULL DEFAULT '[]',
  next_label text,
  next_due date,
  next_track text,
  next_state text,
  -- Freshness.
  stale boolean NOT NULL DEFAULT true,
  computed_for date,
  computed_at timestamptz
);
CREATE INDEX IF NOT EXISTS subject_status_firm_idx ON public.subject_status (firm_id);
CREATE INDEX IF NOT EXISTS subject_status_stale_idx ON public.subject_status (subject_id) WHERE stale;
CREATE INDEX IF NOT EXISTS subject_status_computed_for_idx ON public.subject_status (computed_for);
CREATE INDEX IF NOT EXISTS subject_status_health_idx ON public.subject_status (type, health, overdue DESC);
CREATE INDEX IF NOT EXISTS subject_status_name_idx ON public.subject_status (type, lower(name));
CREATE INDEX IF NOT EXISTS subject_status_client_idx ON public.subject_status (client_id);
CREATE INDEX IF NOT EXISTS subject_status_team_idx ON public.subject_status USING gin (team_person_ids);

CREATE TABLE IF NOT EXISTS public.subject_status_items (
  subject_id text NOT NULL REFERENCES public.subjects(id) ON DELETE CASCADE,
  firm_id uuid NOT NULL REFERENCES public.firms(id) ON DELETE CASCADE,
  item_key text NOT NULL,
  track text NOT NULL,
  label text NOT NULL,
  detail text,
  state text NOT NULL,
  due_date date,
  provisional boolean NOT NULL DEFAULT false,
  deliverable_id text,
  team_person_ids text[] NOT NULL DEFAULT '{}',
  -- A mark's deadline is a window (opens, bar date, extension); `meta` keeps
  -- the parts the list's one-click actions need.
  meta jsonb,
  PRIMARY KEY (subject_id, item_key)
);
CREATE INDEX IF NOT EXISTS subject_status_items_firm_idx ON public.subject_status_items (firm_id);
CREATE INDEX IF NOT EXISTS subject_status_items_due_idx ON public.subject_status_items (due_date) WHERE due_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS subject_status_items_state_idx ON public.subject_status_items (state, due_date);
CREATE INDEX IF NOT EXISTS subject_status_items_team_idx ON public.subject_status_items USING gin (team_person_ids);

-- Staff read their own firm's. Writes: the refresher, on the firm-scoped
-- service client. The client portal reads none of it with the client's JWT —
-- lib/portal/ reads it on the service client, scoped to the client.
ALTER TABLE public.subject_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subject_status_items ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'subject_status_team_select') THEN
    CREATE POLICY subject_status_team_select ON public.subject_status
      FOR SELECT TO authenticated
      USING (firm_id = (SELECT public.current_firm_id()) AND (SELECT public.current_person_id()) IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'subject_status_items_team_select') THEN
    CREATE POLICY subject_status_items_team_select ON public.subject_status_items
      FOR SELECT TO authenticated
      USING (firm_id = (SELECT public.current_firm_id()) AND (SELECT public.current_person_id()) IS NOT NULL);
  END IF;
END $$;

-- ── Staleness ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.mark_subjects_stale(p_ids text[]) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO public.subject_status (subject_id, firm_id, type, stale)
  SELECT s.id, s.firm_id, s.type, true FROM public.subjects s WHERE s.id = ANY (p_ids)
  ON CONFLICT (subject_id) DO UPDATE SET stale = true WHERE NOT public.subject_status.stale;
$$;

-- Row triggers on tables keyed by corporation_id / subject_id.
CREATE OR REPLACE FUNCTION public.stale_by_column() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  col text := TG_ARGV[0];
  ids text[] := ARRAY[]::text[];
BEGIN
  IF TG_OP <> 'DELETE' THEN ids := ids || (to_jsonb(NEW) ->> col); END IF;
  IF TG_OP <> 'INSERT' THEN ids := ids || (to_jsonb(OLD) ->> col); END IF;
  ids := array_remove(ids, NULL);
  IF array_length(ids, 1) > 0 THEN PERFORM public.mark_subjects_stale(ids); END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_corporations_stale ON public.corporations;
CREATE TRIGGER trg_corporations_stale AFTER INSERT OR UPDATE ON public.corporations
  FOR EACH ROW EXECUTE FUNCTION public.stale_by_column('id');
DROP TRIGGER IF EXISTS trg_trademarks_stale ON public.trademarks;
CREATE TRIGGER trg_trademarks_stale AFTER INSERT OR UPDATE OR DELETE ON public.trademarks
  FOR EACH ROW EXECUTE FUNCTION public.stale_by_column('id');
DROP TRIGGER IF EXISTS trg_corporation_files_stale ON public.corporation_files;
CREATE TRIGGER trg_corporation_files_stale AFTER INSERT OR UPDATE OR DELETE ON public.corporation_files
  FOR EACH ROW EXECUTE FUNCTION public.stale_by_column('corporation_id');
DROP TRIGGER IF EXISTS trg_corporation_roles_stale ON public.corporation_roles;
CREATE TRIGGER trg_corporation_roles_stale AFTER INSERT OR UPDATE OR DELETE ON public.corporation_roles
  FOR EACH ROW EXECUTE FUNCTION public.stale_by_column('corporation_id');
DROP TRIGGER IF EXISTS trg_corporation_meetings_stale ON public.corporation_meetings;
CREATE TRIGGER trg_corporation_meetings_stale AFTER INSERT OR UPDATE OR DELETE ON public.corporation_meetings
  FOR EACH ROW EXECUTE FUNCTION public.stale_by_column('corporation_id');
DROP TRIGGER IF EXISTS trg_matter_subjects_stale ON public.matter_subjects;
CREATE TRIGGER trg_matter_subjects_stale AFTER INSERT OR UPDATE OR DELETE ON public.matter_subjects
  FOR EACH ROW EXECUTE FUNCTION public.stale_by_column('subject_id');
-- Deliverables churn constantly; only those naming a subject matter here.
DROP TRIGGER IF EXISTS trg_deliverables_stale_ins ON public.deliverables;
CREATE TRIGGER trg_deliverables_stale_ins AFTER INSERT ON public.deliverables
  FOR EACH ROW WHEN (NEW.subject_id IS NOT NULL)
  EXECUTE FUNCTION public.stale_by_column('subject_id');
DROP TRIGGER IF EXISTS trg_deliverables_stale_upd ON public.deliverables;
CREATE TRIGGER trg_deliverables_stale_upd AFTER UPDATE ON public.deliverables
  FOR EACH ROW WHEN (COALESCE(NEW.subject_id, OLD.subject_id) IS NOT NULL)
  EXECUTE FUNCTION public.stale_by_column('subject_id');
DROP TRIGGER IF EXISTS trg_deliverables_stale_del ON public.deliverables;
CREATE TRIGGER trg_deliverables_stale_del AFTER DELETE ON public.deliverables
  FOR EACH ROW WHEN (OLD.subject_id IS NOT NULL)
  EXECUTE FUNCTION public.stale_by_column('subject_id');

-- A file request opened or closed on a matter changes "waiting on client" for
-- every subject the matter covers; a matter's team or name feeds the snapshot.
CREATE OR REPLACE FUNCTION public.stale_by_matter() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  col text := TG_ARGV[0];
  mid text := COALESCE(to_jsonb(NEW) ->> col, to_jsonb(OLD) ->> col);
BEGIN
  PERFORM public.mark_subjects_stale(ARRAY(SELECT subject_id FROM public.matter_subjects WHERE matter_id = mid));
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_file_requests_stale ON public.file_requests;
CREATE TRIGGER trg_file_requests_stale AFTER INSERT OR UPDATE OR DELETE ON public.file_requests
  FOR EACH ROW EXECUTE FUNCTION public.stale_by_matter('matter_id');
DROP TRIGGER IF EXISTS trg_matters_stale ON public.matters;
CREATE TRIGGER trg_matters_stale AFTER UPDATE OF team_person_ids, name ON public.matters
  FOR EACH ROW EXECUTE FUNCTION public.stale_by_matter('notion_id');

-- A client's rename reaches the snapshot of the companies done for it.
CREATE OR REPLACE FUNCTION public.stale_by_client() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM public.mark_subjects_stale(ARRAY(
    SELECT id FROM public.corporations
    WHERE firm_id = NEW.firm_id AND (engaging_client_id = NEW.notion_id OR client_id = NEW.notion_id)));
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_clients_stale ON public.clients;
CREATE TRIGGER trg_clients_stale AFTER UPDATE OF name ON public.clients
  FOR EACH ROW WHEN (OLD.name IS DISTINCT FROM NEW.name)
  EXECUTE FUNCTION public.stale_by_client();

-- A filing-calendar change can move every company's AFS or ITR date — every
-- company of that firm.
CREATE OR REPLACE FUNCTION public.stale_firm_corporations() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE public.subject_status SET stale = true
  WHERE type = 'corporation' AND NOT stale
    AND firm_id IN (CASE WHEN TG_OP <> 'DELETE' THEN NEW.firm_id END, CASE WHEN TG_OP <> 'INSERT' THEN OLD.firm_id END);
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_compliance_calendar_stale ON public.compliance_calendar;
CREATE TRIGGER trg_compliance_calendar_stale AFTER INSERT OR UPDATE OR DELETE ON public.compliance_calendar
  FOR EACH ROW EXECUTE FUNCTION public.stale_firm_corporations();

-- Nothing outside these triggers and the refresher calls them.
REVOKE EXECUTE ON FUNCTION public.mark_subjects_stale(text[]) FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.stale_by_column() FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.stale_by_matter() FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.stale_by_client() FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.stale_firm_corporations() FROM PUBLIC, anon, authenticated, service_role;

-- Every company and mark starts stale; the first refresher runs fill them in.
INSERT INTO public.subject_status (subject_id, firm_id, type, name, stale)
SELECT id, firm_id, type, name, true FROM public.subjects WHERE type IN ('corporation', 'trademark')
ON CONFLICT (subject_id) DO NOTHING;
