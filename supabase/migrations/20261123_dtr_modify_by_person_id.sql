-- dtr_own_select admits an author by lawyer_person_id
-- (20261123_dtr_select_with_entries.sql); dtr_own_modify matched only on
-- lawyer_name. An entry whose name snapshot no longer matches its author
-- showed on their My DTR but could not be edited or deleted by them. The
-- author may now change it by either key; "with" entries stay read-only, and
-- the roles are unchanged. What an author may write is narrower than what
-- they may reach: see the WITH CHECK below. lawyer_person_id is not an editable field in
-- /api/dtr, so no one can claim an entry through it.
--
-- Ported from the origin app #351 with the firm conjunct kept in front.
-- ALTER POLICY replaces the expression outright, so re-running is a no-op.

ALTER POLICY dtr_own_modify ON public.dtr
  USING ((firm_id = (SELECT public.current_firm_id()))
     AND ((lawyer_name = (SELECT public.current_person_name()))
       OR (lawyer_person_id = (SELECT public.current_person_id()))
       OR ((SELECT public."current_role"()) = ANY (ARRAY['admin'::text, 'super_user'::text, 'finance'::text]))))
  -- The row written must still be the author's own. By name, it may not
  -- carry someone else's person id; by person id, its name may not be a
  -- colleague's, so nobody can file time under another person's name.
  WITH CHECK ((firm_id = (SELECT public.current_firm_id()))
     AND (((lawyer_name = (SELECT public.current_person_name()))
           AND (lawyer_person_id IS NULL OR lawyer_person_id = (SELECT public.current_person_id())))
       OR ((lawyer_person_id = (SELECT public.current_person_id()))
           AND NOT EXISTS (
             SELECT 1 FROM public.team t
             WHERE t.firm_id = dtr.firm_id
               AND t.name = dtr.lawyer_name
               AND t.person_id IS DISTINCT FROM (SELECT public.current_person_id())))
       OR ((SELECT public."current_role"()) = ANY (ARRAY['admin'::text, 'super_user'::text, 'finance'::text]))));
