-- A matter code is issued once per firm. The sequence used to be a count of
-- the client's matters, so a deletion or a move to another client let the next
-- matter reuse a taken number; deriveMatterCode now goes one past the highest
-- sequence, and this index refuses a duplicate that slips through anyway.
-- Blank codes are exempt.
CREATE UNIQUE INDEX IF NOT EXISTS matters_firm_matter_code_unique
  ON public.matters (firm_id, matter_code)
  WHERE matter_code IS NOT NULL AND matter_code <> '';
