-- Client portal: companies and marks.
--
-- A client sees a company or a mark when a matter of theirs covers it
-- (matter_subjects) and the team has switched it on for the portal
-- (`portal_visible`, off by default — a record still being cleaned up would
-- otherwise show the client "past due" filings that are only gaps in the
-- firm's data). What they see is the stored status (subject_status, _items:
-- no TINs, IDs or addresses) and the company files the team marks
-- client-visible.
--
-- No policy here admits a client user to any of these tables: the portal
-- reads them on the firm-scoped service client, scoped to the session's
-- client, and `portalScope` in lib/portal/companies.ts is the visibility rule.

ALTER TABLE public.corporations ADD COLUMN IF NOT EXISTS portal_visible boolean NOT NULL DEFAULT false;
ALTER TABLE public.trademarks ADD COLUMN IF NOT EXISTS portal_visible boolean NOT NULL DEFAULT false;

-- Official company papers start shared; ID copies and anything filed against a
-- person never are. Runs once, when the column is created, so a later un-share
-- isn't undone by a re-run. Nothing reaches a client until the company itself
-- is switched on.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'corporation_files' AND column_name = 'client_visible') THEN
    ALTER TABLE public.corporation_files ADD COLUMN client_visible boolean NOT NULL DEFAULT false;
    UPDATE public.corporation_files SET client_visible = true
    WHERE person_id IS NULL
      AND category IN ('AOI', 'By-Laws', 'SEC Filing Receipt', 'SEC COR', 'BIR COR', 'Authority to Print', 'Business Permit',
                       'Barangay Clearance', 'Sanitary Permit', 'Fire Safety Inspection', 'SSS R-1', 'PhilHealth ER1',
                       'Pag-IBIG EFR', 'Stock Certificate', 'GIS', 'AFS', 'Beneficial Ownership Declaration');
  END IF;
END $$;
