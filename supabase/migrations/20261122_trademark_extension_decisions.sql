-- IPOPHL's decision on a request for extension: granted or denied, and the
-- date on its order. A filed request counts as extended until a denial is
-- recorded; a denial puts the deadline back to the original period. The
-- stale triggers on both tables already fire on any update, so the stored
-- status picks the decision up.

ALTER TABLE public.trademark_office_actions
  ADD COLUMN IF NOT EXISTS motex_decision text,
  ADD COLUMN IF NOT EXISTS motex_decided_on date;

ALTER TABLE public.trademarks
  ADD COLUMN IF NOT EXISTS dau_3_motex_decision text,
  ADD COLUMN IF NOT EXISTS dau_3_motex_decided_on date;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trademark_office_actions_motex_decision_check') THEN
    ALTER TABLE public.trademark_office_actions
      ADD CONSTRAINT trademark_office_actions_motex_decision_check CHECK (
        (motex_decision IS NULL AND motex_decided_on IS NULL)
        OR (motex_decision IN ('granted', 'denied') AND motex_decided_on IS NOT NULL AND motex)
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trademarks_dau_3_motex_decision_check') THEN
    ALTER TABLE public.trademarks
      ADD CONSTRAINT trademarks_dau_3_motex_decision_check CHECK (
        (dau_3_motex_decision IS NULL AND dau_3_motex_decided_on IS NULL)
        OR (dau_3_motex_decision IN ('granted', 'denied') AND dau_3_motex_decided_on IS NOT NULL AND dau_3_motex)
      );
  END IF;
END $$;
