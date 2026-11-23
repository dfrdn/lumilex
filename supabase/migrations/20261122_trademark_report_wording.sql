-- The firm's standard wording for trademark client reports, where it differs
-- from the defaults in lib/trademarks/report-wording.ts. One row per block:
-- `key` is "<report>.body", "<report>.message" or "shared.<block>". A firm that
-- has saved nothing reads the defaults; nothing is seeded.
CREATE TABLE IF NOT EXISTS public.trademark_report_wording (
  firm_id uuid NOT NULL REFERENCES public.firms(id) ON DELETE CASCADE,
  key text NOT NULL,
  body text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text,
  PRIMARY KEY (firm_id, key)
);

ALTER TABLE public.trademark_report_wording ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS trademark_report_wording_team_select ON public.trademark_report_wording;
CREATE POLICY trademark_report_wording_team_select ON public.trademark_report_wording
  FOR SELECT TO authenticated
  USING (firm_id = (SELECT public.current_firm_id()) AND (SELECT public.current_person_id()) IS NOT NULL);

DROP POLICY IF EXISTS trademark_report_wording_partner_write ON public.trademark_report_wording;
CREATE POLICY trademark_report_wording_partner_write ON public.trademark_report_wording
  FOR ALL TO authenticated
  USING (firm_id = (SELECT public.current_firm_id()) AND (SELECT public."current_role"()) = ANY (ARRAY['partner', 'admin', 'super_user']))
  WITH CHECK (firm_id = (SELECT public.current_firm_id()) AND (SELECT public."current_role"()) = ANY (ARRAY['partner', 'admin', 'super_user']));

REVOKE ALL ON public.trademark_report_wording FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trademark_report_wording TO authenticated;
GRANT ALL ON public.trademark_report_wording TO service_role;

-- Its revisions go in content_revisions with the firm's other hand-written content.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'content_revisions_entity_type_check'
      AND pg_get_constraintdef(oid) LIKE '%trademark_report_wording%'
  ) THEN
    EXECUTE 'ALTER TABLE public.content_revisions DROP CONSTRAINT IF EXISTS content_revisions_entity_type_check';
    EXECUTE 'ALTER TABLE public.content_revisions ADD CONSTRAINT content_revisions_entity_type_check CHECK (entity_type = ANY (ARRAY[''kb_page''::text, ''fee_schedule''::text, ''billing_letter_block''::text, ''billing_paragraph''::text, ''trademark_report_wording''::text]))';
  END IF;
END $$;
