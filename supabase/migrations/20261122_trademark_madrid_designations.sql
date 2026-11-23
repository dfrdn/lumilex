-- International registrations designating the Philippines (Madrid Protocol).
--
-- A mark is either a national application filed with IPOPHL or a designation
-- of the Philippines in someone's international registration. A designation
-- keeps its IR number in reg_ir_no and the date of IPOPHL's statement of
-- grant of protection in reg_date, so lists, Ref. Nos. and "Registered" read
-- the same for both. Its 3-year DAU counts from the subsequent designation,
-- or else the international registration (WIPO Information Notice 18/2013,
-- IPOPHL MC 17-011).
--
-- The later upkeep of a designation (5-year DAU, renewal through WIPO, the
-- DAUs after renewal) has no confirmed Philippine rule here yet, so its due
-- dates are entered by hand in the *_due_date columns until it does.

ALTER TABLE public.trademarks ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'national';
ALTER TABLE public.trademarks ADD COLUMN IF NOT EXISTS ir_date date;
ALTER TABLE public.trademarks ADD COLUMN IF NOT EXISTS designation_date date;
ALTER TABLE public.trademarks ADD COLUMN IF NOT EXISTS dau_5_due_date date;
ALTER TABLE public.trademarks ADD COLUMN IF NOT EXISTS renewal_due_date date;
ALTER TABLE public.trademarks ADD COLUMN IF NOT EXISTS renewal_dau_due_date date;
ALTER TABLE public.trademarks ADD COLUMN IF NOT EXISTS renewal_dau_5_due_date date;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trademarks_origin_check') THEN
    ALTER TABLE public.trademarks
      ADD CONSTRAINT trademarks_origin_check CHECK (origin IN ('national', 'madrid_in'));
  END IF;
END $$;

-- IPOPHL's provisional refusal of a designation, answered like an Office Action.
ALTER TABLE public.trademark_office_actions DROP CONSTRAINT IF EXISTS trademark_office_actions_kind_check;
ALTER TABLE public.trademark_office_actions
  ADD CONSTRAINT trademark_office_actions_kind_check
  CHECK (kind IN ('office_action', 'final_rejection', 'provisional_refusal'));
