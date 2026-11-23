-- files_team_write was FOR ALL, so it also gated SELECT. Permissive policies
-- are OR'd and the planner could put has_matter_access(matter_id) — a SECURITY
-- DEFINER call per row — ahead of files_team_select's one-shot check, which is
-- what took the origin app's admin Files list past the statement timeout
-- (origin app #334). Reads are covered by files_team_select, so the write policy is
-- split into INSERT / UPDATE / DELETE.
--
-- The expressions keep the firm conjunct and the per-matter check. One thing
-- tightens (origin app #435): a row with no matter used to admit any signed-in user
-- of the firm, portal clients included. It now needs a staff member.

DROP POLICY IF EXISTS files_team_write ON public.files;

DROP POLICY IF EXISTS files_team_insert ON public.files;
CREATE POLICY files_team_insert ON public.files
  FOR INSERT TO authenticated
  WITH CHECK (
    firm_id = (SELECT public.current_firm_id())
    AND ((matter_id IS NULL AND (SELECT public.current_person_id()) IS NOT NULL)
         OR public.has_matter_access(matter_id))
  );

DROP POLICY IF EXISTS files_team_update ON public.files;
CREATE POLICY files_team_update ON public.files
  FOR UPDATE TO authenticated
  USING (
    firm_id = (SELECT public.current_firm_id())
    AND ((matter_id IS NULL AND (SELECT public.current_person_id()) IS NOT NULL)
         OR public.has_matter_access(matter_id))
  )
  WITH CHECK (
    firm_id = (SELECT public.current_firm_id())
    AND ((matter_id IS NULL AND (SELECT public.current_person_id()) IS NOT NULL)
         OR public.has_matter_access(matter_id))
  );

DROP POLICY IF EXISTS files_team_delete ON public.files;
CREATE POLICY files_team_delete ON public.files
  FOR DELETE TO authenticated
  USING (
    firm_id = (SELECT public.current_firm_id())
    AND ((matter_id IS NULL AND (SELECT public.current_person_id()) IS NOT NULL)
         OR public.has_matter_access(matter_id))
  );
