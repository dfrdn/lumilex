-- Subjects: the things the firm looks after, as distinct from matters (the
-- engagements that bill for the work). A company or a mark outlives any one
-- engagement, one retainer can cover several of them (a family of companies
-- often shares one), and later practices — visas, permits, patents, mining
-- tenements — have the same shape.
--
-- This migration only adds. Code still reads corporations' four
-- *_matter_id columns and trademarks.matter_id, so those columns stay and
-- triggers mirror them into matter_subjects; a follow-up migration drops them
-- (and the mirrors) once nothing reads them.

-- ── subjects ───────────────────────────────────────────────────────────────
-- Thin on purpose: what every practice shares. Each type keeps its own detail
-- table keyed by the same id (corporations.id, trademarks.id).
CREATE TABLE IF NOT EXISTS public.subjects (
  id text PRIMARY KEY,
  firm_id uuid NOT NULL REFERENCES public.firms(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('corporation', 'trademark')),
  name text NOT NULL DEFAULT '',
  status text,
  -- The registry number the outside world knows it by (SEC no., TM reg no.).
  identifier text,
  -- A subject held by another: a permit held by a company, a visa by a
  -- company's employee.
  holder_subject_id text REFERENCES public.subjects(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS subjects_firm_idx ON public.subjects (firm_id);
CREATE INDEX IF NOT EXISTS subjects_type_idx ON public.subjects (type);
CREATE INDEX IF NOT EXISTS subjects_holder_idx ON public.subjects (holder_subject_id) WHERE holder_subject_id IS NOT NULL;

INSERT INTO public.subjects (id, firm_id, type, name, status, identifier, created_at)
SELECT c.id, c.firm_id, 'corporation', coalesce(c.approved_name, c.proposed_names[1], ''), c.status, c.sec_registration_no, c.created_at
FROM public.corporations c
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.subjects (id, firm_id, type, name, status, identifier, created_at)
SELECT t.id, t.firm_id, 'trademark', coalesce(t.mark, ''), t.status, t.reg_ir_no, t.created_at
FROM public.trademarks t
ON CONFLICT (id) DO NOTHING;

-- The detail row is the subject: deleting the subject deletes it.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'corporations_subject_fkey') THEN
    ALTER TABLE public.corporations
      ADD CONSTRAINT corporations_subject_fkey FOREIGN KEY (id) REFERENCES public.subjects(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trademarks_subject_fkey') THEN
    ALTER TABLE public.trademarks
      ADD CONSTRAINT trademarks_subject_fkey FOREIGN KEY (id) REFERENCES public.subjects(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Keep the shared columns current from the detail tables. SECURITY DEFINER:
-- staff write corporations and trademarks under RLS, and subjects has no write
-- policy of its own — only these triggers write it. The subject takes the
-- detail row's firm. A row with no firm is left for its own NOT NULL to
-- refuse, so the refusal names the table the caller wrote.
CREATE OR REPLACE FUNCTION public.sync_corporation_subject() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.firm_id IS NULL THEN RETURN NEW; END IF;
  INSERT INTO public.subjects (id, firm_id, type, name, status, identifier)
  VALUES (NEW.id, NEW.firm_id, 'corporation', coalesce(NEW.approved_name, NEW.proposed_names[1], ''), NEW.status, NEW.sec_registration_no)
  ON CONFLICT (id) DO UPDATE
    SET name = EXCLUDED.name, status = EXCLUDED.status, identifier = EXCLUDED.identifier, updated_at = now()
    WHERE (public.subjects.name, public.subjects.status, public.subjects.identifier)
      IS DISTINCT FROM (EXCLUDED.name, EXCLUDED.status, EXCLUDED.identifier);
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.sync_trademark_subject() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.firm_id IS NULL THEN RETURN NEW; END IF;
  INSERT INTO public.subjects (id, firm_id, type, name, status, identifier)
  VALUES (NEW.id, NEW.firm_id, 'trademark', coalesce(NEW.mark, ''), NEW.status, NEW.reg_ir_no)
  ON CONFLICT (id) DO UPDATE
    SET name = EXCLUDED.name, status = EXCLUDED.status, identifier = EXCLUDED.identifier, updated_at = now()
    WHERE (public.subjects.name, public.subjects.status, public.subjects.identifier)
      IS DISTINCT FROM (EXCLUDED.name, EXCLUDED.status, EXCLUDED.identifier);
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.delete_detail_subject() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  DELETE FROM public.subjects WHERE id = OLD.id;
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS trg_corporations_sync_subject ON public.corporations;
-- On any update, not just of these columns: trg_corporations_derive_status
-- sets status from the registration record, and runs first (name order).
CREATE TRIGGER trg_corporations_sync_subject
  BEFORE INSERT OR UPDATE ON public.corporations
  FOR EACH ROW EXECUTE FUNCTION public.sync_corporation_subject();

DROP TRIGGER IF EXISTS trg_trademarks_sync_subject ON public.trademarks;
CREATE TRIGGER trg_trademarks_sync_subject
  BEFORE INSERT OR UPDATE ON public.trademarks
  FOR EACH ROW EXECUTE FUNCTION public.sync_trademark_subject();

DROP TRIGGER IF EXISTS trg_corporations_delete_subject ON public.corporations;
CREATE TRIGGER trg_corporations_delete_subject
  AFTER DELETE ON public.corporations
  FOR EACH ROW EXECUTE FUNCTION public.delete_detail_subject();

DROP TRIGGER IF EXISTS trg_trademarks_delete_subject ON public.trademarks;
CREATE TRIGGER trg_trademarks_delete_subject
  AFTER DELETE ON public.trademarks
  FOR EACH ROW EXECUTE FUNCTION public.delete_detail_subject();

-- ── matter_subjects ────────────────────────────────────────────────────────
-- Which engagement covers a subject, and in what role. One matter per scope
-- per subject for now (the company's incorporation matter, its retainer); a
-- practice that needs several (yearly visa renewals) relaxes that. A mark's
-- roles: `trademark` (the filing), `trademark_maintenance` (DAUs and
-- renewal), `opposition` (an opposition or cancellation), `retainer`.
CREATE TABLE IF NOT EXISTS public.matter_subjects (
  firm_id uuid NOT NULL REFERENCES public.firms(id) ON DELETE CASCADE,
  matter_id text NOT NULL REFERENCES public.matters(notion_id) ON DELETE CASCADE,
  subject_id text NOT NULL REFERENCES public.subjects(id) ON DELETE CASCADE,
  scope text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (subject_id, scope)
);
ALTER TABLE public.matter_subjects DROP CONSTRAINT IF EXISTS matter_subjects_scope_check;
ALTER TABLE public.matter_subjects ADD CONSTRAINT matter_subjects_scope_check CHECK (scope IN (
  'incorporation', 'post_incorporation', 'housekeeping', 'retainer',
  'trademark', 'trademark_maintenance', 'opposition'));
CREATE INDEX IF NOT EXISTS matter_subjects_matter_idx ON public.matter_subjects (matter_id);
CREATE INDEX IF NOT EXISTS matter_subjects_firm_idx ON public.matter_subjects (firm_id);

-- Only links within one firm: a matter and a subject of the same firm.
INSERT INTO public.matter_subjects (firm_id, matter_id, subject_id, scope)
SELECT c.firm_id, x.matter_id, c.id, x.scope
FROM public.corporations c
CROSS JOIN LATERAL (VALUES
  (c.incorporation_matter_id, 'incorporation'),
  (c.post_incorporation_matter_id, 'post_incorporation'),
  (c.housekeeping_matter_id, 'housekeeping'),
  (c.retainer_matter_id, 'retainer')
) AS x(matter_id, scope)
JOIN public.matters m ON m.notion_id = x.matter_id AND m.firm_id = c.firm_id
ON CONFLICT DO NOTHING;

INSERT INTO public.matter_subjects (firm_id, matter_id, subject_id, scope)
SELECT t.firm_id, t.matter_id, t.id, 'trademark'
FROM public.trademarks t
JOIN public.matters m ON m.notion_id = t.matter_id AND m.firm_id = t.firm_id
ON CONFLICT DO NOTHING;

-- Transitional mirror: until the follow-up drops the old columns, code that
-- writes them carries each write into matter_subjects.
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

DROP TRIGGER IF EXISTS trg_corporations_mirror_matters ON public.corporations;
CREATE TRIGGER trg_corporations_mirror_matters
  AFTER INSERT OR UPDATE OF incorporation_matter_id, post_incorporation_matter_id, housekeeping_matter_id, retainer_matter_id
  ON public.corporations
  FOR EACH ROW EXECUTE FUNCTION public.mirror_corporation_matter_columns();

-- trademarks.matter_id -> the filing link. It ignores the writes made by the
-- reverse mirror (lumilex.mark_mirror, 20261121_trademark_links.sql).
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

DROP TRIGGER IF EXISTS trg_trademarks_mirror_matter ON public.trademarks;
CREATE TRIGGER trg_trademarks_mirror_matter
  AFTER INSERT OR UPDATE OF matter_id ON public.trademarks
  FOR EACH ROW EXECUTE FUNCTION public.mirror_trademark_matter_column();

-- ── Work items name their subject ──────────────────────────────────────────
-- Until now a corporation's filings were "the deliverables on its matters",
-- and a family of companies often shares one retainer matter, so each
-- sibling's compliance tab listed every sibling's GIS, AFS and ITR as its
-- own. The obligation now names its company; a deliverable with no subject_id
-- keeps the old matter-wide reading. Only compliance deliverables carry it.
ALTER TABLE public.deliverables
  ADD COLUMN IF NOT EXISTS subject_id text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'deliverables_subject_id_fkey') THEN
    ALTER TABLE public.deliverables
      ADD CONSTRAINT deliverables_subject_id_fkey FOREIGN KEY (subject_id) REFERENCES public.subjects(id) ON DELETE SET NULL;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS deliverables_subject_id_idx
  ON public.deliverables (subject_id)
  WHERE subject_id IS NOT NULL;

-- Backfill without side effects: these rows were not worked on, so neither
-- restart their matters' auto-archive clock nor stamp them as just edited.
SET LOCAL lumilex.skip_activity = 'on';
ALTER TABLE public.deliverables DISABLE TRIGGER deliverables_set_last_edited_trg;

-- Every generated name carries the company ("SEC GIS — <company> (2023)").
-- Match it against the names of the companies linked to the deliverable's
-- matter, longest name first, and take it only when exactly one company
-- matches at that length. Otherwise, a matter linked to a single company
-- gives the answer outright. Never across firms.
WITH links AS (
  SELECT c.id AS corp_id, c.firm_id, m.mid, lower(btrim(n)) AS nm
  FROM public.corporations c
  CROSS JOIN LATERAL unnest(ARRAY[c.incorporation_matter_id, c.post_incorporation_matter_id,
                                  c.housekeeping_matter_id, c.retainer_matter_id]) AS m(mid)
  CROSS JOIN LATERAL unnest(array_prepend(c.approved_name, coalesce(c.proposed_names, '{}'))) AS n
  WHERE m.mid IS NOT NULL AND n IS NOT NULL AND btrim(n) <> ''
),
d AS (
  SELECT notion_id, firm_id, name, matter_id
  FROM public.deliverables
  WHERE subject_id IS NULL
    AND type IN ('SEC GIS', 'SEC AFS', 'BIR Filing', 'Other Compliance')
),
cand AS (
  SELECT d.notion_id, l.corp_id, max(length(l.nm)) AS len
  FROM d JOIN links l ON l.mid = d.matter_id AND l.firm_id = d.firm_id AND position(l.nm IN lower(d.name)) > 0
  GROUP BY 1, 2
),
best AS (
  SELECT notion_id, corp_id FROM (
    SELECT cand.*,
           rank() OVER (PARTITION BY notion_id ORDER BY len DESC) AS r,
           count(*) OVER (PARTITION BY notion_id, len) AS n_at_len
    FROM cand
  ) x
  WHERE r = 1 AND n_at_len = 1
),
single AS (
  SELECT mid, firm_id, min(corp_id) AS corp_id
  FROM (SELECT DISTINCT mid, firm_id, corp_id FROM links) z
  GROUP BY mid, firm_id
  HAVING count(*) = 1
),
resolved AS (
  SELECT d.notion_id, coalesce(b.corp_id, s.corp_id) AS corp_id
  FROM d
  LEFT JOIN best b USING (notion_id)
  LEFT JOIN single s ON s.mid = d.matter_id AND s.firm_id = d.firm_id
)
UPDATE public.deliverables t
SET subject_id = r.corp_id
FROM resolved r
WHERE t.notion_id = r.notion_id
  AND r.corp_id IS NOT NULL;

ALTER TABLE public.deliverables ENABLE TRIGGER deliverables_set_last_edited_trg;

-- Time stays on the matter; a retainer entry may also say which subject it
-- was for, so retainer hours can be read per company without splitting the
-- retainer into matters.
ALTER TABLE public.dtr
  ADD COLUMN IF NOT EXISTS subject_id text REFERENCES public.subjects(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS dtr_subject_id_idx ON public.dtr (subject_id) WHERE subject_id IS NOT NULL;

-- ── RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE public.subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matter_subjects ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'subjects_team_select') THEN
    CREATE POLICY subjects_team_select ON public.subjects
      FOR SELECT TO authenticated
      USING (firm_id = (SELECT public.current_firm_id()) AND (SELECT public.current_person_id()) IS NOT NULL);
  END IF;
  -- Same rule as corporations_team_write: any staff member of the firm.
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'matter_subjects_team') THEN
    CREATE POLICY matter_subjects_team ON public.matter_subjects
      FOR ALL TO authenticated
      USING (firm_id = (SELECT public.current_firm_id()) AND (SELECT public.current_person_id()) IS NOT NULL)
      WITH CHECK (firm_id = (SELECT public.current_firm_id()) AND (SELECT public.current_person_id()) IS NOT NULL);
  END IF;
END $$;

-- Trigger functions: EXECUTE is checked at CREATE TRIGGER, never when they
-- fire, so no API role needs it.
REVOKE EXECUTE ON FUNCTION public.sync_corporation_subject() FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.sync_trademark_subject() FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.delete_detail_subject() FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.mirror_corporation_matter_columns() FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.mirror_trademark_matter_column() FROM PUBLIC, anon, authenticated, service_role;
