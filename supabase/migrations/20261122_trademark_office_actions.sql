-- Office Actions become rounds, and the rest of the IPOPHL lifecycle the
-- 2023 Trademark Regulations (MC 2023-001) provide for gets somewhere to live.
--
-- * trademark_office_actions — one row per examiner action. An applicant may
--   respond again after a refusal that isn't final (Rule 608); a final one is
--   met by appeal or compliance (Rule 609). Periods run from the mailing date,
--   the date on the document; the day the firm received it is kept too.
--   `respond_by` holds a shorter period the examiner set (Rules 612, 1006).
-- * trademark_files.step / office_action_id — which step a paper belongs to.
-- * trademarks: NOI received date, eGazette publication and opposition
--   (Rules 700, 703), notice of abandonment and revival (Rules 610, 611).
--
-- The single-slot columns (oa_receipt_date, oa_response_filed_date, oa_motex,
-- oa_reported, noa_reported, new_app_reported) are no longer read or written;
-- a contract migration drops them once this has deployed.

CREATE TABLE IF NOT EXISTS public.trademark_office_actions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trademark_id        text NOT NULL REFERENCES public.trademarks(id) ON DELETE CASCADE,
  firm_id             uuid NOT NULL REFERENCES public.firms(id) ON DELETE CASCADE,
  kind                text NOT NULL DEFAULT 'office_action'
                        CHECK (kind IN ('office_action', 'final_rejection')),
  title               text,
  mailing_date        date NOT NULL,
  received_date       date,
  respond_by          date,
  motex               boolean NOT NULL DEFAULT false,
  response_filed_date date,
  created_by          text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS trademark_office_actions_trademark_idx
  ON public.trademark_office_actions (trademark_id, mailing_date);
CREATE INDEX IF NOT EXISTS trademark_office_actions_firm_idx
  ON public.trademark_office_actions (firm_id);

ALTER TABLE public.trademark_office_actions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS trademark_office_actions_team ON public.trademark_office_actions;
CREATE POLICY trademark_office_actions_team ON public.trademark_office_actions FOR ALL TO authenticated
  USING (firm_id = (SELECT public.current_firm_id()) AND (SELECT public.current_person_id()) IS NOT NULL)
  WITH CHECK (firm_id = (SELECT public.current_firm_id()) AND (SELECT public.current_person_id()) IS NOT NULL);

REVOKE ALL ON public.trademark_office_actions FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trademark_office_actions TO authenticated;
GRANT ALL ON public.trademark_office_actions TO service_role;

-- The stored status reads the rounds, so a change to one marks the mark stale.
DROP TRIGGER IF EXISTS trg_trademark_office_actions_stale ON public.trademark_office_actions;
CREATE TRIGGER trg_trademark_office_actions_stale
  AFTER INSERT OR UPDATE OR DELETE ON public.trademark_office_actions
  FOR EACH ROW EXECUTE FUNCTION public.stale_by_column('trademark_id');

-- One round per mark that had an Office Action on the old columns. Its
-- deadline was counted from oa_receipt_date, so that becomes the mailing date.
INSERT INTO public.trademark_office_actions (trademark_id, firm_id, mailing_date, response_filed_date, motex)
SELECT t.id, t.firm_id, t.oa_receipt_date, t.oa_response_filed_date, t.oa_motex
FROM public.trademarks t
WHERE t.oa_receipt_date IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.trademark_office_actions o WHERE o.trademark_id = t.id);

ALTER TABLE public.trademarks
  ADD COLUMN IF NOT EXISTS noi_received_date date,
  ADD COLUMN IF NOT EXISTS published_date date,
  ADD COLUMN IF NOT EXISTS opposition_filed_date date,
  ADD COLUMN IF NOT EXISTS abandonment_mailing_date date,
  ADD COLUMN IF NOT EXISTS abandonment_received_date date,
  ADD COLUMN IF NOT EXISTS revival_filed_date date,
  ADD COLUMN IF NOT EXISTS revival_declined boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS revival_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS status_before_abandonment text;

ALTER TABLE public.trademark_files
  ADD COLUMN IF NOT EXISTS step text,
  ADD COLUMN IF NOT EXISTS office_action_id uuid REFERENCES public.trademark_office_actions(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trademark_files_step_check') THEN
    ALTER TABLE public.trademark_files ADD CONSTRAINT trademark_files_step_check CHECK (
      step IS NULL OR step IN (
        'filing', 'office_action', 'oa_response', 'oa_motex', 'noi', 'noi_payment',
        'publication', 'opposition', 'cor', 'abandonment', 'revival',
        'dau_3', 'dau_3_motex', 'dau_5', 'renewal', 'renewal_dau', 'renewal_dau_5'
      )
    );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS trademark_files_step_idx ON public.trademark_files (trademark_id, step);
