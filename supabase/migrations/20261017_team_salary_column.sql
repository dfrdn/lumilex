-- Withhold team.monthly_salary from API roles.
--
-- team_authenticated_select lets every staff member read every team row in
-- their firm, and nothing withheld monthly_salary, so any login could read
-- every colleague's salary. Postgres cannot revoke one column out of a
-- table-level grant, so the table grant is replaced by a grant on every other
-- column. Salary is read through getServiceDbForFirm after a finance / partner
-- / super_user check (finance employees, firm summary, partner lawyer detail,
-- computeProfitability), and written the same way.
--
-- A column added to team later is NOT readable through a JWT until it is
-- granted. Re-running this file grants it; scripts/rls-probe.ts fails until
-- someone does.

DO $$
DECLARE cols text;
BEGIN
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
    INTO cols
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'team' AND column_name <> 'monthly_salary';
  EXECUTE 'REVOKE SELECT ON public.team FROM anon, authenticated';
  EXECUTE format('GRANT SELECT (%s) ON public.team TO anon, authenticated', cols);
END $$;
