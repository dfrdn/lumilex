-- A lawyer can read the DTR entries they are listed "with", not only the ones
-- they wrote: their hours and My DTR count those entries, and the dashboard
-- now reads them through the lawyer's own JWT. Reading only — dtr_own_modify
-- keeps the entry the author's to change.
--
-- The author is also matched on lawyer_person_id, which survives a rename
-- (20261029_dtr_lawyer_person_id.sql); lawyer_name stays for entries the
-- backfill couldn't resolve.
--
-- Ported from the origin app #351 with Lumilex's firm conjunct kept in front:
-- nothing here reaches across firms. Helper calls are wrapped in scalar
-- subqueries, as 20261029_rls_policies_initplan.sql left every policy.
--
-- ALTER POLICY replaces the expression outright, so re-running is a no-op.

ALTER POLICY dtr_own_select ON public.dtr
  USING ((firm_id = (SELECT public.current_firm_id()))
     AND ((lawyer_name = (SELECT public.current_person_name()))
       OR (lawyer_person_id = (SELECT public.current_person_id()))
       OR ((SELECT public.current_person_id()) = ANY (with_ids))
       OR ((SELECT public."current_role"()) = ANY (ARRAY['partner'::text, 'admin'::text, 'finance'::text, 'super_user'::text]))));
