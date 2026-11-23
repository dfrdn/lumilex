-- Client reports the team sends or has sent on its own paper.
--
-- sent_outside: the report went out by other means (Outlook, a courier) and
-- is only recorded here, with the files that went. Such a row has no email
-- body and was not sent from the firm's trademark mailbox.
-- title: what a report is about when it isn't one of a mark's steps (event is
-- null then), e.g. "Status of opposition".

ALTER TABLE public.trademark_client_reports
  ADD COLUMN IF NOT EXISTS sent_outside boolean NOT NULL DEFAULT false;

ALTER TABLE public.trademark_client_reports
  ADD COLUMN IF NOT EXISTS title text;

-- A report under a title of its own is about neither a deadline nor a step,
-- so the check that a report names what it is about admits a title too.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'trademark_client_reports_about'
      AND pg_get_constraintdef(oid) LIKE '%title%'
  ) THEN
    ALTER TABLE public.trademark_client_reports DROP CONSTRAINT IF EXISTS trademark_client_reports_about;
    ALTER TABLE public.trademark_client_reports
      ADD CONSTRAINT trademark_client_reports_about CHECK (
        (deadline_kind IS NOT NULL AND deadline_due IS NOT NULL)
        OR (event IS NOT NULL AND event_date IS NOT NULL)
        OR (title IS NOT NULL AND btrim(title) <> '')
      );
  END IF;
END $$;
