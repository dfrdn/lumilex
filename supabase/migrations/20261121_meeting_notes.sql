-- Meeting notes: what was discussed and agreed, written on the meeting's page.
-- A table of their own, not columns on meetings: the notes are the team's,
-- and nothing the portal reads should carry them.
CREATE TABLE IF NOT EXISTS public.meeting_notes (
  meeting_id text PRIMARY KEY REFERENCES public.meetings(notion_id) ON DELETE CASCADE,
  firm_id uuid NOT NULL REFERENCES public.firms(id) ON DELETE CASCADE,
  body text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text,
  -- Each save names the version it was written over; a stale one is refused
  -- and merged on the page instead of overwriting someone else's edit.
  version integer NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS meeting_notes_firm_idx ON public.meeting_notes (firm_id);

ALTER TABLE public.meeting_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS meeting_notes_team_select ON public.meeting_notes;
CREATE POLICY meeting_notes_team_select ON public.meeting_notes
  FOR SELECT TO authenticated
  USING (firm_id = (SELECT public.current_firm_id()) AND (SELECT public.current_person_id()) IS NOT NULL);

DROP POLICY IF EXISTS meeting_notes_team_write ON public.meeting_notes;
CREATE POLICY meeting_notes_team_write ON public.meeting_notes
  FOR ALL TO authenticated
  USING (firm_id = (SELECT public.current_firm_id()) AND (SELECT public.current_person_id()) IS NOT NULL)
  WITH CHECK (firm_id = (SELECT public.current_firm_id()) AND (SELECT public.current_person_id()) IS NOT NULL);

REVOKE ALL ON public.meeting_notes FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meeting_notes TO authenticated;
GRANT ALL ON public.meeting_notes TO service_role;

-- Attendees see each other's saves as they land. Realtime delivers a change
-- only to a subscriber whose RLS admits the row, so a firm sees its own.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'meeting_notes'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.meeting_notes;
  END IF;
END $$;
