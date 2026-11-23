-- The filing calendar: the deadline the SEC or BIR actually set for a given
-- year's filings, for December year-end companies.
--
-- These move. SEC MC No. 9-2026 dropped the AFS stagger by registration-number
-- digit for a single 29 May date, and the Commission then extended it to
-- 15 June after the BIR moved the 2025 annual ITR to 15 May. A rule in code
-- can't follow that, so the dates live here and the firm enters each year's
-- when the circular comes out. A year with no row is projected from the latest
-- one and shown as provisional (lib/corporations/obligations.ts).
--
-- Per firm: the dates are public, but the calendar is something each firm
-- keeps, and one firm's lawyer editing it must not move another firm's
-- deadlines.

CREATE TABLE IF NOT EXISTS public.compliance_calendar (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  firm_id uuid NOT NULL REFERENCES public.firms(id) ON DELETE CASCADE,
  obligation text NOT NULL CHECK (obligation IN ('afs', 'itr')),
  -- The calendar year the filing is due in (FY 2025's AFS → 2026).
  filing_year integer NOT NULL CHECK (filing_year BETWEEN 2000 AND 2100),
  -- One date for everyone …
  due_date date,
  -- … or a schedule by the last digit of the SEC registration number:
  -- {"0": "06-30", "1": "04-30", …} (month-day within filing_year).
  digit_schedule jsonb,
  -- The date a circular first set, when an extension has since moved it.
  -- Extensions are one-offs: next year's provisional AFS date is projected
  -- from the date as first set, not from the extension, so the board errs
  -- early. The ITR never projects from a row — the statutory 15 April stands
  -- until an extension for that year is entered.
  original_due_date date,
  source text,
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (firm_id, obligation, filing_year),
  CHECK ((due_date IS NULL) <> (digit_schedule IS NULL))
);
CREATE INDEX IF NOT EXISTS compliance_calendar_firm_idx ON public.compliance_calendar (firm_id);

ALTER TABLE public.compliance_calendar ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'compliance_calendar_team_select') THEN
    CREATE POLICY compliance_calendar_team_select ON public.compliance_calendar
      FOR SELECT TO authenticated
      USING (firm_id = (SELECT public.current_firm_id()) AND (SELECT public.current_person_id()) IS NOT NULL);
  END IF;
  -- Lawyers, partners and admins keep it current; finance and liaison read.
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'compliance_calendar_editor_write') THEN
    CREATE POLICY compliance_calendar_editor_write ON public.compliance_calendar
      FOR ALL TO authenticated
      USING (firm_id = (SELECT public.current_firm_id())
             AND (SELECT public."current_role"()) IN ('lawyer', 'admin', 'partner', 'super_user'))
      WITH CHECK (firm_id = (SELECT public.current_firm_id())
                  AND (SELECT public."current_role"()) IN ('lawyer', 'admin', 'partner', 'super_user'));
  END IF;
END $$;

-- The 2026 dates, for every firm already on the instance. A firm provisioned
-- later enters its own; until it does, the board projects provisionally.
INSERT INTO public.compliance_calendar (firm_id, obligation, filing_year, due_date, original_due_date, source)
SELECT f.id, v.obligation, v.filing_year, v.due_date::date, v.original_due_date::date, v.source
FROM public.firms f
CROSS JOIN (VALUES
  ('afs', 2026, '2026-06-15', '2026-05-29',
   'SEC MC No. 9-2026 set 29 May 2026; extended to 15 June by the Commission en banc on 14 April 2026.'),
  ('itr', 2026, '2026-05-15', '2026-04-15',
   'BIR extension of the CY 2025 annual income tax return deadline (from 15 April).')
) AS v(obligation, filing_year, due_date, original_due_date, source)
WHERE NOT EXISTS (
  SELECT 1 FROM public.compliance_calendar c
  WHERE c.firm_id = f.id AND c.obligation = v.obligation AND c.filing_year = v.filing_year
);
