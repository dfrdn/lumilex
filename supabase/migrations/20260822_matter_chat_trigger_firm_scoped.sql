-- sync_matter_chat_members carried two single-firm artifacts the firm_id
-- wave exposed: an ON CONFLICT target on the retired (matter_id) unique,
-- and four hardcoded origin-firm person UUIDs as the channel's standing members.
-- Standing membership now resolves per firm (active admin/finance staff),
-- and the channel row is firm-bound end to end.
CREATE OR REPLACE FUNCTION public.sync_matter_chat_members()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_standing_members TEXT[];
  v_merged_members TEXT[];
BEGIN
  -- Standing members: the firm's active admin + finance staff.
  SELECT COALESCE(array_agg(person_id), '{}')
  INTO v_standing_members
  FROM public.team
  WHERE firm_id = NEW.firm_id
    AND active
    AND role IN ('admin', 'finance');

  SELECT array_agg(DISTINCT elem ORDER BY elem)
  INTO v_merged_members
  FROM unnest(COALESCE(NEW.team_person_ids, '{}') || v_standing_members) AS elem;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO chat_channels (type, matter_id, name, member_ids, created_by, firm_id)
    VALUES (
      'matter',
      NEW.notion_id,
      NEW.name,
      v_merged_members,
      COALESCE(NEW.team_person_ids[1], v_standing_members[1]),
      NEW.firm_id
    )
    ON CONFLICT (firm_id, matter_id) DO NOTHING;

  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.team_person_ids IS DISTINCT FROM OLD.team_person_ids
       OR NEW.name IS DISTINCT FROM OLD.name THEN
      UPDATE chat_channels
      SET member_ids = v_merged_members,
          name       = NEW.name,
          updated_at = now()
      WHERE matter_id = NEW.notion_id
        AND type = 'matter'
        AND firm_id = NEW.firm_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;
