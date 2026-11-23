-- Self-service updates to public.team may change only the profile fields a
-- person owns.
--
-- team_self_update admits a person to their own row with no limit on columns,
-- so any signed-in staff member could PATCH /rest/v1/team and set their own
-- role to super_user or admin, mark themselves active again, or rewrite their
-- own salary or email. RLS is row-level: a policy cannot name the columns an
-- UPDATE may touch, so the limit is a trigger.
--
-- Admin and super_user keep full edit rights through their own JWT (the same
-- rows team_self_update already admits them to). The service role and postgres
-- are unaffected: every admin flow, avatar / headshot / signature upload,
-- finance and salary edit writes through getServiceDbForFirm.
--
-- `notion_last_edited_at` and `synced_at` are bookkeeping that
-- team_set_last_edited_trg and old writers move; they are not a person's edit.

CREATE OR REPLACE FUNCTION public.team_guard_self_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  self_editable CONSTANT text[] := ARRAY[
    'nickname', 'notion_last_edited_at', 'synced_at'
  ];
BEGIN
  IF current_user <> 'authenticated' THEN
    RETURN NEW;
  END IF;
  IF public."current_role"() IN ('admin', 'super_user') THEN
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - self_editable) IS DISTINCT FROM (to_jsonb(OLD) - self_editable) THEN
    RAISE EXCEPTION 'Only your nickname can be changed here'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

-- Named to sort before team_set_last_edited_trg, so it sees the row before the
-- bookkeeping timestamp moves.
CREATE OR REPLACE TRIGGER team_guard_self_update
  BEFORE UPDATE ON public.team
  FOR EACH ROW EXECUTE FUNCTION public.team_guard_self_update();
