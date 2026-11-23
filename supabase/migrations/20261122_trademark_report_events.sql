-- A client report is about a deadline (a reminder) or about a step the firm
-- took (the filing, a DAU): `event` names the step, as lib/trademarks/client-report.ts
-- does, and `event_date` the day it was recorded for.
ALTER TABLE public.trademark_client_reports ADD COLUMN IF NOT EXISTS event text;
ALTER TABLE public.trademark_client_reports ADD COLUMN IF NOT EXISTS event_date date;
ALTER TABLE public.trademark_client_reports ALTER COLUMN deadline_kind DROP NOT NULL;
ALTER TABLE public.trademark_client_reports ALTER COLUMN deadline_due DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trademark_client_reports_about') THEN
    ALTER TABLE public.trademark_client_reports
      ADD CONSTRAINT trademark_client_reports_about CHECK (
        (deadline_kind IS NOT NULL AND deadline_due IS NOT NULL)
        OR (event IS NOT NULL AND event_date IS NOT NULL)
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS trademark_client_reports_event_idx
  ON public.trademark_client_reports (trademark_id, event, event_date) WHERE event IS NOT NULL;
