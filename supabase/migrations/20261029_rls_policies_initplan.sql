-- Evaluate the RLS helper calls once per statement, not once per row.
--
-- Ported from the origin app #352 / #354, but not copied: the origin app's migration
-- lists its own pg_policy text, and replaying it here would replace every
-- policy with an expression that has no firm_id conjunct.
--
-- current_firm_id(), current_person_id(), "current_role"(),
-- current_client_id(), current_person_name(), current_person_identifiers(),
-- current_email() and auth.uid()/role()/jwt() were called bare. The helpers
-- are SECURITY DEFINER with a pinned search_path, so the planner can't inline
-- them, and RLS quals run before any non-leakproof filter in the query: every
-- firm_id = current_firm_id() conjunct re-ran its team / client_users lookup
-- for each row of the table. Wrapped in a scalar subquery, the call becomes an
-- InitPlan evaluated once per statement. Only the calls change: every
-- expression is otherwise the one pg_policy held, and WITH CHECK appears
-- exactly where it already did. Who can read or write what is unchanged.
--
-- current_person_identifiers() returns an array, so it is cast,
-- ANY ((SELECT ...)::text[]): a bare (SELECT ...) inside ANY reads as an
-- ANY-subquery and compares each element against the whole array.
--
-- has_matter_access(matter_id) still runs per row. It takes the row's matter,
-- and here it is a real per-matter check (team membership or role), not the
-- "any staff member" shortcut origin app #334 relied on, so it can't be hoisted.
--
-- The rewrite runs over pg_policies rather than listing ~190 ALTER POLICY
-- statements, so it does the same thing on every instance. A call already
-- inside a scalar subquery deparses as ( SELECT f() AS f) and the AS
-- lookahead skips it, so re-running changes nothing. files_team_write is left
-- to 20261029_files_team_write_split.sql, which replaces it.

SET LOCAL lock_timeout = '3s';

DO $$
DECLARE
  r record;
  q text;
  w text;
  stmt text;
BEGIN
  FOR r IN
    SELECT tablename, policyname, qual, with_check
      FROM pg_policies
     WHERE schemaname = 'public'
       AND policyname <> 'files_team_write'
  LOOP
    q := r.qual;
    w := r.with_check;
    IF q IS NOT NULL THEN
      q := regexp_replace(q, '(?<![\w."])(public\.)?(current_person_id|"current_role"|current_firm_id|current_client_id|current_person_name|current_email)\(\)(?! AS )', '(SELECT public.\2())', 'g');
      q := regexp_replace(q, '(?<![\w."])(public\.)?current_person_identifiers\(\)(?! AS )', '((SELECT public.current_person_identifiers())::text[])', 'g');
      q := regexp_replace(q, '(?<![\w."])auth\.(uid|role|jwt)\(\)(?! AS )', '(SELECT auth.\1())', 'g');
    END IF;
    IF w IS NOT NULL THEN
      w := regexp_replace(w, '(?<![\w."])(public\.)?(current_person_id|"current_role"|current_firm_id|current_client_id|current_person_name|current_email)\(\)(?! AS )', '(SELECT public.\2())', 'g');
      w := regexp_replace(w, '(?<![\w."])(public\.)?current_person_identifiers\(\)(?! AS )', '((SELECT public.current_person_identifiers())::text[])', 'g');
      w := regexp_replace(w, '(?<![\w."])auth\.(uid|role|jwt)\(\)(?! AS )', '(SELECT auth.\1())', 'g');
    END IF;
    IF q IS DISTINCT FROM r.qual OR w IS DISTINCT FROM r.with_check THEN
      stmt := format('ALTER POLICY %I ON public.%I', r.policyname, r.tablename);
      IF q IS NOT NULL THEN stmt := stmt || format(' USING (%s)', q); END IF;
      IF w IS NOT NULL THEN stmt := stmt || format(' WITH CHECK (%s)', w); END IF;
      EXECUTE stmt;
    END IF;
  END LOOP;
END
$$;
