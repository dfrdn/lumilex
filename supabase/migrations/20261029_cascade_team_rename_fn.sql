-- Propagate a team member's rename to every column that keeps a copy of the
-- name, in one transaction, within one firm.
--
-- Names are denormalized as text into the DTR and finance tables at write time.
-- Renaming a `team` row left every copy behind, and billing resolved an entry's
-- position (and so its hourly rate) by joining `team` on that string — a miss
-- fell through to the junior rate. lib/team/cascade-rename.ts calls this from
-- the admin rename path, on the service-role client.
--
-- Why an RPC rather than PostgREST updates:
--   * array_replace over the text[] columns can't be expressed through PostgREST;
--   * a rename rewrites a person's whole DTR history, which touch_matter_activity
--     would otherwise count as fresh work on every matter they ever logged time
--     on — the flag below has to be set in the same transaction;
--   * one transaction means a rename never half-cascades.
--
-- `.rpc()` passes through getServiceDbForFirm untouched, so the firm_id filter
-- on every statement is the only thing keeping one firm's rename out of another
-- firm's rows. audit_log.performed_by_name is deliberately not rewritten: it
-- records who acted under the name they had at the time.
--
-- Known side effect: dtr_set_updated_at bumps dtr.updated_at on the renamed
-- rows, so Billing Review may flag a revised entry of that person as "changed
-- since revision" until finance re-saves it.
--
-- SECURITY INVOKER and executable by service_role only.

CREATE OR REPLACE FUNCTION public.cascade_team_rename(
  p_firm_id uuid,
  p_person_id text,
  p_old_name text,
  p_new_name text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  n integer;
  counts jsonb := '{}'::jsonb;
BEGIN
  IF p_firm_id IS NULL THEN
    RAISE EXCEPTION 'cascade_team_rename: p_firm_id is required';
  END IF;
  IF p_old_name IS NULL OR p_new_name IS NULL OR p_old_name = '' OR p_new_name = ''
     OR p_old_name = p_new_name THEN
    RETURN counts;
  END IF;

  PERFORM set_config('lumilex.skip_activity', 'on', true);

  -- Rows written before dtr carried an author key: claim them for this person
  -- before the name moves, so the stable key survives the rename.
  IF p_person_id IS NOT NULL THEN
    UPDATE public.dtr SET lawyer_person_id = p_person_id
     WHERE firm_id = p_firm_id AND lawyer_name = p_old_name AND lawyer_person_id IS NULL;
    GET DIAGNOSTICS n = row_count; IF n > 0 THEN counts := counts || jsonb_build_object('dtr.lawyer_person_id', n); END IF;
  END IF;

  UPDATE public.dtr SET lawyer_name = p_new_name
   WHERE firm_id = p_firm_id AND lawyer_name = p_old_name;
  GET DIAGNOSTICS n = row_count; IF n > 0 THEN counts := counts || jsonb_build_object('dtr.lawyer_name', n); END IF;

  UPDATE public.dtr SET with_names = array_replace(with_names, p_old_name, p_new_name)
   WHERE firm_id = p_firm_id AND p_old_name = ANY(with_names);
  GET DIAGNOSTICS n = row_count; IF n > 0 THEN counts := counts || jsonb_build_object('dtr.with_names', n); END IF;

  UPDATE public.dtr_revisions SET lawyer_name = p_new_name
   WHERE firm_id = p_firm_id AND lawyer_name = p_old_name;
  GET DIAGNOSTICS n = row_count; IF n > 0 THEN counts := counts || jsonb_build_object('dtr_revisions.lawyer_name', n); END IF;

  UPDATE public.dtr_revisions SET with_names = array_replace(with_names, p_old_name, p_new_name)
   WHERE firm_id = p_firm_id AND p_old_name = ANY(with_names);
  GET DIAGNOSTICS n = row_count; IF n > 0 THEN counts := counts || jsonb_build_object('dtr_revisions.with_names', n); END IF;

  UPDATE public.dtr_revisions SET waived_with = array_replace(waived_with, p_old_name, p_new_name)
   WHERE firm_id = p_firm_id AND p_old_name = ANY(waived_with);
  GET DIAGNOSTICS n = row_count; IF n > 0 THEN counts := counts || jsonb_build_object('dtr_revisions.waived_with', n); END IF;

  UPDATE public.reimbursements SET lawyer_name = p_new_name
   WHERE firm_id = p_firm_id AND lawyer_name = p_old_name;
  GET DIAGNOSTICS n = row_count; IF n > 0 THEN counts := counts || jsonb_build_object('reimbursements.lawyer_name', n); END IF;

  UPDATE public.reimbursements SET created_by_name = p_new_name
   WHERE firm_id = p_firm_id AND created_by_name = p_old_name;
  GET DIAGNOSTICS n = row_count; IF n > 0 THEN counts := counts || jsonb_build_object('reimbursements.created_by_name', n); END IF;

  UPDATE public.leaves SET created_by_name = p_new_name
   WHERE firm_id = p_firm_id AND created_by_name = p_old_name;
  GET DIAGNOSTICS n = row_count; IF n > 0 THEN counts := counts || jsonb_build_object('leaves.created_by_name', n); END IF;

  UPDATE public.liaison_tasks SET assigned_by_name = p_new_name
   WHERE firm_id = p_firm_id AND assigned_by_name = p_old_name;
  GET DIAGNOSTICS n = row_count; IF n > 0 THEN counts := counts || jsonb_build_object('liaison_tasks.assigned_by_name', n); END IF;

  UPDATE public.liaison_tasks SET assigned_to_name = p_new_name
   WHERE firm_id = p_firm_id AND assigned_to_name = p_old_name;
  GET DIAGNOSTICS n = row_count; IF n > 0 THEN counts := counts || jsonb_build_object('liaison_tasks.assigned_to_name', n); END IF;

  UPDATE public.kb_pages SET author_name = p_new_name
   WHERE firm_id = p_firm_id AND author_name = p_old_name;
  GET DIAGNOSTICS n = row_count; IF n > 0 THEN counts := counts || jsonb_build_object('kb_pages.author_name', n); END IF;

  RETURN counts;
END;
$$;

REVOKE ALL ON FUNCTION public.cascade_team_rename(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cascade_team_rename(uuid, text, text, text) TO service_role;
