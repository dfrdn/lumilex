-- Our clients' marks extended abroad under the Madrid Protocol.
--
-- An international registration (IR) rests on a Philippine mark, its "basic
-- mark", with IPOPHL as the office of origin. Each country it designates is
-- a trademarks row of origin 'madrid_out' pointing at the IR: it has its own
-- status, refusals, local agent and papers, and shares the IR's number and
-- date, which a trigger keeps in step. The IR itself carries what belongs to
-- the whole registration: its renewal with WIPO, and whether it has ceased
-- because the basic mark fell within five years (Protocol arts. 6, 7, 9quinquies).
--
-- Country-specific filings (a use declaration, a local renewal) have no rule
-- here and are kept as deadlines entered by hand.
--
-- Both tables are tenant tables: firm_id, and RLS with the firm conjunct.

CREATE TABLE IF NOT EXISTS public.international_registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  base_trademark_id text NOT NULL REFERENCES public.trademarks(id) ON DELETE CASCADE,
  firm_id uuid NOT NULL REFERENCES public.firms(id) ON DELETE CASCADE,
  ir_no text,
  ir_date date,
  -- The international application filed with IPOPHL as office of origin.
  application_filed_date date,
  renewal_filing_date date,
  -- The IR ceased to have effect because the basic mark fell within its first five years.
  ceased_date date,
  notes text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS international_registrations_base_idx ON public.international_registrations (base_trademark_id);
CREATE INDEX IF NOT EXISTS international_registrations_firm_idx ON public.international_registrations (firm_id);

ALTER TABLE public.trademarks ADD COLUMN IF NOT EXISTS ir_id uuid REFERENCES public.international_registrations(id) ON DELETE RESTRICT;
ALTER TABLE public.trademarks ADD COLUMN IF NOT EXISTS local_agent text;
ALTER TABLE public.trademarks ADD COLUMN IF NOT EXISTS refusal_period_months smallint;
CREATE INDEX IF NOT EXISTS trademarks_ir_idx ON public.trademarks (ir_id) WHERE ir_id IS NOT NULL;

ALTER TABLE public.trademarks DROP CONSTRAINT IF EXISTS trademarks_origin_check;
ALTER TABLE public.trademarks
  ADD CONSTRAINT trademarks_origin_check CHECK (origin IN ('national', 'madrid_in', 'madrid_out'));

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trademarks_refusal_period_check') THEN
    ALTER TABLE public.trademarks
      ADD CONSTRAINT trademarks_refusal_period_check CHECK (refusal_period_months IS NULL OR refusal_period_months IN (12, 18));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trademarks_madrid_out_ir_check') THEN
    ALTER TABLE public.trademarks
      ADD CONSTRAINT trademarks_madrid_out_ir_check CHECK ((origin = 'madrid_out') = (ir_id IS NOT NULL));
  END IF;
END $$;

-- Deadlines entered by hand: a designated country's own filings.
CREATE TABLE IF NOT EXISTS public.trademark_local_deadlines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trademark_id text NOT NULL REFERENCES public.trademarks(id) ON DELETE CASCADE,
  firm_id uuid NOT NULL REFERENCES public.firms(id) ON DELETE CASCADE,
  label text NOT NULL CHECK (length(trim(label)) > 0),
  due_date date NOT NULL,
  filed_date date,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS trademark_local_deadlines_mark_idx ON public.trademark_local_deadlines (trademark_id);
CREATE INDEX IF NOT EXISTS trademark_local_deadlines_firm_idx ON public.trademark_local_deadlines (firm_id);

-- A designation shows the IR's number and date; keep them in step from whichever path edits the IR.
-- It runs as the caller (not SECURITY DEFINER), so the update is held to the
-- caller's own RLS on trademarks, and to the IR's own firm.
CREATE OR REPLACE FUNCTION public.mirror_international_registration()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  UPDATE public.trademarks
     SET reg_ir_no = NEW.ir_no, ir_date = NEW.ir_date, updated_at = now()
   WHERE ir_id = NEW.id
     AND firm_id = NEW.firm_id
     AND (reg_ir_no, ir_date) IS DISTINCT FROM (NEW.ir_no, NEW.ir_date);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_international_registrations_mirror ON public.international_registrations;
CREATE TRIGGER trg_international_registrations_mirror
  AFTER UPDATE OF ir_no, ir_date ON public.international_registrations
  FOR EACH ROW EXECUTE FUNCTION public.mirror_international_registration();

-- The basic mark's stored status reads its IRs (renewal, ceasing); each mark's reads its local deadlines.
DROP TRIGGER IF EXISTS trg_international_registrations_stale ON public.international_registrations;
CREATE TRIGGER trg_international_registrations_stale
  AFTER INSERT OR DELETE OR UPDATE ON public.international_registrations
  FOR EACH ROW EXECUTE FUNCTION public.stale_by_column('base_trademark_id');

DROP TRIGGER IF EXISTS trg_trademark_local_deadlines_stale ON public.trademark_local_deadlines;
CREATE TRIGGER trg_trademark_local_deadlines_stale
  AFTER INSERT OR DELETE OR UPDATE ON public.trademark_local_deadlines
  FOR EACH ROW EXECUTE FUNCTION public.stale_by_column('trademark_id');

ALTER TABLE public.international_registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trademark_local_deadlines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS international_registrations_team_select ON public.international_registrations;
CREATE POLICY international_registrations_team_select ON public.international_registrations
  FOR SELECT TO authenticated
  USING (firm_id = (SELECT public.current_firm_id()) AND (SELECT public.current_person_id()) IS NOT NULL);
DROP POLICY IF EXISTS international_registrations_team_write ON public.international_registrations;
CREATE POLICY international_registrations_team_write ON public.international_registrations
  FOR ALL TO authenticated
  USING (firm_id = (SELECT public.current_firm_id()) AND (SELECT public."current_role"()) = ANY (ARRAY['admin', 'super_user', 'partner', 'lawyer']))
  WITH CHECK (firm_id = (SELECT public.current_firm_id()) AND (SELECT public."current_role"()) = ANY (ARRAY['admin', 'super_user', 'partner', 'lawyer']));

DROP POLICY IF EXISTS trademark_local_deadlines_team ON public.trademark_local_deadlines;
CREATE POLICY trademark_local_deadlines_team ON public.trademark_local_deadlines
  FOR ALL TO authenticated
  USING (firm_id = (SELECT public.current_firm_id()) AND (SELECT public.current_person_id()) IS NOT NULL)
  WITH CHECK (firm_id = (SELECT public.current_firm_id()) AND (SELECT public.current_person_id()) IS NOT NULL);

REVOKE ALL ON public.international_registrations FROM anon;
REVOKE ALL ON public.trademark_local_deadlines FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.international_registrations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trademark_local_deadlines TO authenticated;
GRANT ALL ON public.international_registrations TO service_role;
GRANT ALL ON public.trademark_local_deadlines TO service_role;
