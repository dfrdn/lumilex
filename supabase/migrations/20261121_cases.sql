-- Cases: the disputes the firm handles, as subjects.
--
-- A case is the dispute, not a docket. It exists from the day the firm starts
-- studying it (evaluation), before anything is filed, and outlives any one
-- engagement or forum. Each forum's handling of it is a proceeding — the OCP's
-- preliminary investigation, the DOJ's review of it, the RTC case filed on the
-- Information, a Rule 65 petition to the CA — and proceedings form a tree:
-- an appeal or review follows its parent, a certiorari runs beside it.
--
-- There is no fixed title during preliminary investigation, so the case is
-- titled after its proceedings: each keeps its own caption, and the case takes
-- the caption of the furthest proceeding on its main line (a Rule 65 branch
-- never renames it), or its working title before any filing. A lawyer can
-- pin a title instead.
--
-- This only adds, except matter_subjects' key: a case is covered by several
-- matters at once (the OCP matter and the DOJ matter; two clients in one
-- case), which one-matter-per-scope can't hold. Other scopes keep that rule
-- through a partial unique index.

-- ── subjects and matter_subjects accept cases ──────────────────────────────
ALTER TABLE public.subjects DROP CONSTRAINT IF EXISTS subjects_type_check;
ALTER TABLE public.subjects ADD CONSTRAINT subjects_type_check
  CHECK (type IN ('corporation', 'trademark', 'person', 'case'));

ALTER TABLE public.matter_subjects DROP CONSTRAINT IF EXISTS matter_subjects_scope_check;
ALTER TABLE public.matter_subjects ADD CONSTRAINT matter_subjects_scope_check
  CHECK (scope IN ('incorporation', 'post_incorporation', 'housekeeping', 'retainer', 'trademark',
                   'trademark_maintenance', 'opposition', 'case'));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'matter_subjects_pkey'
             AND pg_get_constraintdef(oid) = 'PRIMARY KEY (subject_id, scope)') THEN
    ALTER TABLE public.matter_subjects DROP CONSTRAINT matter_subjects_pkey;
    ALTER TABLE public.matter_subjects ADD CONSTRAINT matter_subjects_pkey PRIMARY KEY (subject_id, scope, matter_id);
  END IF;
END $$;
-- Every scope but 'case' is still one matter per subject.
CREATE UNIQUE INDEX IF NOT EXISTS matter_subjects_one_per_scope
  ON public.matter_subjects (subject_id, scope) WHERE scope <> 'case';

-- The two mirror triggers name the partial index's predicate so ON CONFLICT
-- can still find it.
CREATE OR REPLACE FUNCTION public.mirror_corporation_matter_columns() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  pair record;
BEGIN
  FOR pair IN
    SELECT * FROM (VALUES
      (NEW.incorporation_matter_id, 'incorporation'),
      (NEW.post_incorporation_matter_id, 'post_incorporation'),
      (NEW.housekeeping_matter_id, 'housekeeping'),
      (NEW.retainer_matter_id, 'retainer')
    ) AS v(matter_id, scope)
  LOOP
    IF pair.matter_id IS NULL THEN
      DELETE FROM public.matter_subjects WHERE subject_id = NEW.id AND scope = pair.scope;
    ELSE
      INSERT INTO public.matter_subjects (firm_id, matter_id, subject_id, scope)
      VALUES (NEW.firm_id, pair.matter_id, NEW.id, pair.scope)
      ON CONFLICT (subject_id, scope) WHERE scope <> 'case' DO UPDATE SET matter_id = EXCLUDED.matter_id
        WHERE public.matter_subjects.matter_id IS DISTINCT FROM EXCLUDED.matter_id;
    END IF;
  END LOOP;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.mirror_trademark_matter_column() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF coalesce(current_setting('lumilex.mark_mirror', true), 'off') = 'on' THEN RETURN NEW; END IF;
  IF NEW.matter_id IS NULL THEN
    DELETE FROM public.matter_subjects WHERE subject_id = NEW.id AND scope = 'trademark';
  ELSE
    INSERT INTO public.matter_subjects (firm_id, matter_id, subject_id, scope)
    VALUES (NEW.firm_id, NEW.matter_id, NEW.id, 'trademark')
    ON CONFLICT (subject_id, scope) WHERE scope <> 'case' DO UPDATE SET matter_id = EXCLUDED.matter_id
      WHERE public.matter_subjects.matter_id IS DISTINCT FROM EXCLUDED.matter_id;
  END IF;
  RETURN NEW;
END $$;

-- Point a subject's scope at one matter, replacing whatever it pointed at
-- (setMatterLink). PostgREST's upsert can't name a partial index. Two
-- statements, one call, so it's still all or nothing — as one statement the
-- insert is checked against the unique index before the delete beside it
-- takes effect. SECURITY INVOKER: the caller's matter_subjects policy applies.
-- The link takes the subject's firm, and the caller's firm must be it.
DROP FUNCTION IF EXISTS public.set_matter_link(text, text, text);
CREATE OR REPLACE FUNCTION public.set_matter_link(p_firm_id uuid, p_subject_id text, p_scope text, p_matter_id text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_firm uuid;
BEGIN
  SELECT s.firm_id INTO v_firm FROM public.subjects s WHERE s.id = p_subject_id;
  IF v_firm IS NULL OR v_firm IS DISTINCT FROM p_firm_id THEN
    RAISE EXCEPTION 'subject not found' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.matter_subjects
  WHERE subject_id = p_subject_id AND scope = p_scope AND matter_id IS DISTINCT FROM p_matter_id;
  IF p_matter_id IS NOT NULL THEN
    INSERT INTO public.matter_subjects (firm_id, subject_id, scope, matter_id)
    VALUES (v_firm, p_subject_id, p_scope, p_matter_id)
    ON CONFLICT (subject_id, scope, matter_id) DO NOTHING;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.set_matter_link(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_matter_link(uuid, text, text, text) TO authenticated, service_role;

-- ── cases ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cases (
  id text PRIMARY KEY REFERENCES public.subjects(id) ON DELETE CASCADE,
  firm_id uuid NOT NULL REFERENCES public.firms(id) ON DELETE CASCADE,
  -- Kept by trg_cases_title from the proceedings unless title_pinned.
  title text NOT NULL DEFAULT '',
  title_pinned boolean NOT NULL DEFAULT false,
  -- What a lawyer calls it before anything is filed.
  working_title text NOT NULL DEFAULT '',
  -- What it is about: "Estafa", "Unlawful Detainer".
  nature text,
  -- The client's side, when it is one side throughout.
  client_role text CHECK (client_role IN ('complainant', 'respondent', 'plaintiff', 'defendant', 'petitioner', 'intervenor', 'other')),
  status text NOT NULL DEFAULT 'evaluation' CHECK (status IN ('evaluation', 'active', 'closed')),
  -- How it ended: filed proceedings resolve on their own; these close it.
  outcome text CHECK (outcome IN ('won', 'lost', 'settled', 'dismissed', 'withdrawn', 'not_pursued', 'other')),
  closed_on date,
  -- Evaluation: the demand letter and the reply it asks for.
  demand_sent_on date,
  demand_due_on date,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cases_status_idx ON public.cases (status);
CREATE INDEX IF NOT EXISTS cases_firm_idx ON public.cases (firm_id);

CREATE TABLE IF NOT EXISTS public.case_proceedings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id uuid NOT NULL REFERENCES public.firms(id) ON DELETE CASCADE,
  case_id text NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  -- NO ACTION, not RESTRICT: checked at the end of the statement, so deleting
  -- a case takes its whole tree, while deleting a proceeding with children fails.
  parent_id uuid REFERENCES public.case_proceedings(id) ON DELETE NO ACTION,
  -- How it came from its parent. rule_65 runs beside the parent; the rest
  -- follow it. information: the case filed in court on the prosecutor's
  -- resolution. referral: the NBI or PNP sending a complaint on.
  relation text NOT NULL DEFAULT 'original'
    CHECK (relation IN ('original', 'referral', 'review', 'information', 'appeal', 'rule_45', 'rule_65', 'other')),
  forum_type text NOT NULL
    CHECK (forum_type IN ('court', 'prosecutor', 'doj', 'ombudsman', 'labor', 'law_enforcement', 'agency', 'unknown')),
  court_level text CHECK (court_level IN ('sc', 'ca', 'sandiganbayan', 'cta', 'rtc', 'mtc')),
  -- The court or office and branch, as the firm writes it.
  office text NOT NULL DEFAULT '',
  docket_no text,
  -- The caption in this forum. "Northwind Power v. Valdez" at the OCP, "People v. Valdez" in court.
  caption text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'resolved')),
  stage text,
  resolution text,
  filed_on date,
  resolved_on date,
  -- Tried together with another proceeding; each keeps its docket.
  consolidated_with uuid REFERENCES public.case_proceedings(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT case_proceedings_parent_check CHECK ((relation = 'original') = (parent_id IS NULL)),
  CONSTRAINT case_proceedings_level_check CHECK ((forum_type = 'court') = (court_level IS NOT NULL))
);
-- Which kind of proceeding it is, and so which stages it goes through
-- (lib/cases/stages.ts): a criminal trial's arraignment, pre-trial and
-- evidence; summary procedure's position papers with no trial. `stage` is the
-- key of the stage it has reached on that track.
ALTER TABLE public.case_proceedings ADD COLUMN IF NOT EXISTS track text;
ALTER TABLE public.case_proceedings DROP CONSTRAINT IF EXISTS case_proceedings_track_check;
ALTER TABLE public.case_proceedings ADD CONSTRAINT case_proceedings_track_check
  CHECK (track IN ('preliminary_investigation', 'petition_for_review', 'criminal_trial', 'civil_trial', 'summary_procedure',
                   'special_proceeding', 'appellate', 'labor', 'administrative'));

-- The decision and the MR window after it. The period differs with the
-- nature of the case, so it isn't computed: a lawyer enters the due date
-- when they want it tracked.
ALTER TABLE public.case_proceedings ADD COLUMN IF NOT EXISTS decision_received_on date;
ALTER TABLE public.case_proceedings ADD COLUMN IF NOT EXISTS mr_due_on date;

ALTER TABLE public.case_proceedings DROP CONSTRAINT IF EXISTS case_proceedings_relation_check;
ALTER TABLE public.case_proceedings ADD CONSTRAINT case_proceedings_relation_check
  CHECK (relation IN ('original', 'referral', 'review', 'information', 'appeal', 'rule_45', 'rule_65', 'other'));
CREATE INDEX IF NOT EXISTS case_proceedings_case_idx ON public.case_proceedings (case_id);
CREATE INDEX IF NOT EXISTS case_proceedings_firm_idx ON public.case_proceedings (firm_id);
CREATE INDEX IF NOT EXISTS case_proceedings_parent_idx ON public.case_proceedings (parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS case_proceedings_docket_idx ON public.case_proceedings (lower(docket_no)) WHERE docket_no IS NOT NULL;

-- Which matters handle which proceeding. A matter linked to the case with no
-- proceeding covers its evaluation.
CREATE TABLE IF NOT EXISTS public.case_proceeding_matters (
  firm_id uuid NOT NULL REFERENCES public.firms(id) ON DELETE CASCADE,
  proceeding_id uuid NOT NULL REFERENCES public.case_proceedings(id) ON DELETE CASCADE,
  matter_id text NOT NULL REFERENCES public.matters(notion_id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (proceeding_id, matter_id)
);
CREATE INDEX IF NOT EXISTS case_proceeding_matters_matter_idx ON public.case_proceeding_matters (matter_id);
CREATE INDEX IF NOT EXISTS case_proceeding_matters_firm_idx ON public.case_proceeding_matters (firm_id);

-- Cases linked but not merged: the same facts, a counter-charge, a separate civil action.
CREATE TABLE IF NOT EXISTS public.case_links (
  firm_id uuid NOT NULL REFERENCES public.firms(id) ON DELETE CASCADE,
  case_id text NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  other_case_id text NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'related' CHECK (kind IN ('related', 'counter_charge', 'civil_action')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (case_id, other_case_id),
  CONSTRAINT case_links_order CHECK (case_id < other_case_id)
);
CREATE INDEX IF NOT EXISTS case_links_firm_idx ON public.case_links (firm_id);

ALTER TABLE public.hearings ADD COLUMN IF NOT EXISTS proceeding_id uuid REFERENCES public.case_proceedings(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS hearings_proceeding_idx ON public.hearings (proceeding_id) WHERE proceeding_id IS NOT NULL;

-- Filing a hearing under a proceeding, or unlinking it when a case is
-- deleted (ON DELETE SET NULL), is bookkeeping, not work on the matter: it
-- mustn't restart the 60-day archive clock. touch_matter_activity ignores
-- proceeding_id as it does the sync columns.
CREATE OR REPLACE FUNCTION public.touch_matter_activity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  ev_ts timestamptz;
BEGIN
  IF NEW.matter_id IS NULL OR current_setting('lumilex.skip_activity', true) = 'on' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF to_jsonb(NEW) - 'notion_last_edited_at' - 'updated_at' - 'synced_at' - 'sharepoint_urls' - 'proceeding_id'
     = to_jsonb(OLD) - 'notion_last_edited_at' - 'updated_at' - 'synced_at' - 'sharepoint_urls' - 'proceeding_id' THEN
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
$function$;

-- ── the title follows the proceedings ──────────────────────────────────────
-- The furthest proceeding on the main line — never under a Rule 65 branch.
-- "Furthest" is the forum first (a court over the DOJ over the prosecutor;
-- the DOJ's review and the court case on the Information both follow the
-- OCP, and the court's caption is the one the dispute ends up with), then
-- depth, then the latest filed. Returns its caption and docket.
CREATE OR REPLACE FUNCTION public.case_title_source(p_case_id text)
RETURNS TABLE (caption text, docket_no text)
LANGUAGE sql STABLE SET search_path = '' AS $$
  WITH RECURSIVE line AS (
    SELECT p.id, p.caption, p.docket_no, p.forum_type, p.court_level, p.filed_on, p.created_at, 0 AS depth
    FROM public.case_proceedings p
    WHERE p.case_id = p_case_id AND p.parent_id IS NULL
    UNION ALL
    SELECT c.id, c.caption, c.docket_no, c.forum_type, c.court_level, c.filed_on, c.created_at, line.depth + 1
    FROM public.case_proceedings c JOIN line ON c.parent_id = line.id
    WHERE c.relation <> 'rule_65'
  )
  SELECT nullif(caption, ''), docket_no FROM line
  ORDER BY
    CASE forum_type
      WHEN 'court' THEN CASE court_level WHEN 'sc' THEN 7 WHEN 'ca' THEN 6 WHEN 'sandiganbayan' THEN 5 WHEN 'cta' THEN 5 WHEN 'rtc' THEN 4 ELSE 3 END
      WHEN 'doj' THEN 2
      WHEN 'law_enforcement' THEN 0
      ELSE 1
    END DESC,
    depth DESC, filed_on DESC NULLS LAST, created_at DESC
  LIMIT 1;
$$;

-- Before a case is written: its title (unless pinned), then its subject row.
-- SECURITY DEFINER for the subject write: staff write cases under RLS, and
-- subjects has no write policy of its own.
CREATE OR REPLACE FUNCTION public.sync_case_subject() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  src record;
BEGIN
  IF NEW.firm_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO src FROM public.case_title_source(NEW.id);
  IF NOT NEW.title_pinned THEN
    NEW.title := coalesce(src.caption, nullif(NEW.working_title, ''), NEW.title);
  END IF;
  INSERT INTO public.subjects (id, firm_id, type, name, status, identifier)
  VALUES (NEW.id, NEW.firm_id, 'case', NEW.title, NEW.status, src.docket_no)
  ON CONFLICT (id) DO UPDATE
    SET name = EXCLUDED.name, status = EXCLUDED.status, identifier = EXCLUDED.identifier, updated_at = now()
    WHERE (public.subjects.name, public.subjects.status, public.subjects.identifier)
      IS DISTINCT FROM (EXCLUDED.name, EXCLUDED.status, EXCLUDED.identifier);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_cases_sync_subject ON public.cases;
CREATE TRIGGER trg_cases_sync_subject
  BEFORE INSERT OR UPDATE ON public.cases
  FOR EACH ROW EXECUTE FUNCTION public.sync_case_subject();

DROP TRIGGER IF EXISTS trg_cases_delete_subject ON public.cases;
CREATE TRIGGER trg_cases_delete_subject
  AFTER DELETE ON public.cases
  FOR EACH ROW EXECUTE FUNCTION public.delete_detail_subject();

-- A proceeding's caption, docket or place in the tree changed: retitle its case.
CREATE OR REPLACE FUNCTION public.retitle_case() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE public.cases SET updated_at = now()
  WHERE id IN (SELECT DISTINCT unnest(ARRAY[
    CASE WHEN TG_OP <> 'DELETE' THEN NEW.case_id END,
    CASE WHEN TG_OP <> 'INSERT' THEN OLD.case_id END]));
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_case_proceedings_retitle ON public.case_proceedings;
CREATE TRIGGER trg_case_proceedings_retitle
  AFTER INSERT OR DELETE OR UPDATE OF caption, docket_no, parent_id, relation, filed_on, case_id ON public.case_proceedings
  FOR EACH ROW EXECUTE FUNCTION public.retitle_case();

-- A proceeding can only hang off one in the same case.
CREATE OR REPLACE FUNCTION public.check_proceeding_parent() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.parent_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.case_proceedings p WHERE p.id = NEW.parent_id AND p.case_id = NEW.case_id
  ) THEN
    RAISE EXCEPTION 'A proceeding''s parent must belong to the same case' USING errcode = '23514';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_case_proceedings_parent ON public.case_proceedings;
CREATE TRIGGER trg_case_proceedings_parent
  BEFORE INSERT OR UPDATE OF parent_id, case_id ON public.case_proceedings
  FOR EACH ROW EXECUTE FUNCTION public.check_proceeding_parent();

-- touch_updated_at() already exists (it sets NEW.updated_at = now()).
DROP TRIGGER IF EXISTS trg_case_proceedings_updated_at ON public.case_proceedings;
CREATE TRIGGER trg_case_proceedings_updated_at
  BEFORE UPDATE ON public.case_proceedings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Explicit, not left to default privileges (newer projects no longer grant
-- the API roles on new tables). anon gets nothing; RLS gates the rest.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cases, public.case_proceedings, public.case_proceeding_matters, public.case_links
  TO authenticated, service_role;
REVOKE ALL ON public.cases, public.case_proceedings, public.case_proceeding_matters, public.case_links FROM anon;
REVOKE ALL ON FUNCTION public.case_title_source(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.case_title_source(text) TO authenticated, service_role;

-- A hearing set on a matter goes under that matter's proceeding when there
-- is no doubt which: the one open proceeding the matter handles (else, the
-- one proceeding it handles at all). Otherwise it waits for a lawyer.
CREATE OR REPLACE FUNCTION public.place_hearing_in_proceeding() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  open_ids uuid[];
  all_ids uuid[];
BEGIN
  IF NEW.proceeding_id IS NOT NULL OR NEW.matter_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT array_agg(p.id) FILTER (WHERE p.status = 'active'), array_agg(p.id)
    INTO open_ids, all_ids
  FROM public.case_proceeding_matters pm JOIN public.case_proceedings p ON p.id = pm.proceeding_id
  WHERE pm.matter_id = NEW.matter_id AND p.firm_id = NEW.firm_id;
  IF array_length(open_ids, 1) = 1 THEN
    NEW.proceeding_id := open_ids[1];
  ELSIF open_ids IS NULL AND array_length(all_ids, 1) = 1 THEN
    NEW.proceeding_id := all_ids[1];
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_hearings_place_proceeding ON public.hearings;
CREATE TRIGGER trg_hearings_place_proceeding
  BEFORE INSERT ON public.hearings
  FOR EACH ROW EXECUTE FUNCTION public.place_hearing_in_proceeding();

-- ── RLS: the team reads; lawyers, partners and admins write (as trademarks) ─
ALTER TABLE public.cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.case_proceedings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.case_proceeding_matters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.case_links ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cases', 'case_proceedings', 'case_proceeding_matters', 'case_links'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t AND policyname = t || '_team_select') THEN
      EXECUTE format($p$CREATE POLICY %I ON public.%I FOR SELECT TO authenticated
        USING (firm_id = (SELECT public.current_firm_id()) AND (SELECT public.current_person_id()) IS NOT NULL)$p$, t || '_team_select', t);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t AND policyname = t || '_team_write') THEN
      EXECUTE format($p$CREATE POLICY %I ON public.%I FOR ALL TO authenticated
        USING (firm_id = (SELECT public.current_firm_id())
               AND (SELECT public."current_role"()) = ANY (ARRAY['admin', 'super_user', 'partner', 'lawyer']))
        WITH CHECK (firm_id = (SELECT public.current_firm_id())
                    AND (SELECT public."current_role"()) = ANY (ARRAY['admin', 'super_user', 'partner', 'lawyer']))$p$, t || '_team_write', t);
    END IF;
  END LOOP;
END $$;

-- Trigger functions: EXECUTE is checked at CREATE TRIGGER, never when they
-- fire, so no API role needs it.
REVOKE EXECUTE ON FUNCTION public.mirror_corporation_matter_columns() FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.mirror_trademark_matter_column() FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.sync_case_subject() FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.retitle_case() FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.place_hearing_in_proceeding() FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.check_proceeding_parent() FROM PUBLIC, anon, authenticated, service_role;
