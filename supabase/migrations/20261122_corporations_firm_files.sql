-- Which of a company's reportorial requirements the firm files, one switch
-- each. Housekeeping or a retainer no longer implies them: the AFS and ITR are
-- usually the company's auditor's or accountant's, and the GIS is filed only
-- for some of the companies the firm carries. Read by the status engine, the
-- nightly roll-forward and the year-1 spawn (lib/corporations/obligations.ts).

ALTER TABLE public.corporations
  ADD COLUMN IF NOT EXISTS firm_files text[] NOT NULL DEFAULT '{}';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'corporations_firm_files_known') THEN
    ALTER TABLE public.corporations
      ADD CONSTRAINT corporations_firm_files_known
      CHECK (firm_files <@ ARRAY['gis', 'afs', 'itr', 'permit']::text[]);
  END IF;
END $$;

-- Seed once, while the column is still empty everywhere. The permit renewal
-- was raised for every company a firm carried; keep that until someone
-- unticks it. The GIS, AFS and ITR are left off: which of them a firm files
-- for a company is the firm's to say, company by company.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.corporations WHERE firm_files <> '{}') THEN
    UPDATE public.corporations c
       SET firm_files = ARRAY['permit']
     WHERE c.handles_housekeeping
        OR EXISTS (
          SELECT 1 FROM public.matter_subjects ms
           WHERE ms.subject_id = c.id AND ms.scope = 'retainer' AND ms.firm_id = c.firm_id
        );
  END IF;
END $$;
