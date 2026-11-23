-- A stable author key for DTR entries. `lawyer_name` is a text snapshot taken
-- from the team row at insert time, so renaming a team member orphaned every
-- historical entry from its author — and from the position that prices it:
-- billing joined `team` on the name and a miss fell through to the junior
-- rate. `with_ids` already gave attendees a stable key; the author had none.
--
-- Nothing is dropped: lawyer_name stays as the display string and the fallback
-- for rows whose author can't be resolved.
--
-- Backfill by name, within the row's own firm, and only where exactly one team
-- row in that firm carries the name — an ambiguous name is left NULL rather
-- than guessed. Idempotent: only rows still NULL are touched.

SET LOCAL lumilex.skip_activity = 'on';

ALTER TABLE public.dtr ADD COLUMN IF NOT EXISTS lawyer_person_id text;

CREATE INDEX IF NOT EXISTS dtr_lawyer_person_id_idx ON public.dtr (lawyer_person_id);

-- The backfill is bookkeeping, not an edit: keep dtr.updated_at and
-- notion_last_edited_at where they are. Billing Review compares updated_at with
-- a revision's edited_at to warn that the raw entry changed after finance
-- revised it, and a bumped updated_at would raise that warning on every
-- revised entry.
ALTER TABLE public.dtr DISABLE TRIGGER dtr_set_updated_at_trg;
ALTER TABLE public.dtr DISABLE TRIGGER dtr_set_last_edited_trg;

WITH unique_names AS (
  SELECT firm_id, name, min(person_id) AS person_id
  FROM public.team
  GROUP BY firm_id, name
  HAVING count(*) = 1
)
UPDATE public.dtr d
SET lawyer_person_id = u.person_id
FROM unique_names u
WHERE d.lawyer_person_id IS NULL
  AND d.firm_id = u.firm_id
  AND d.lawyer_name = u.name;

ALTER TABLE public.dtr ENABLE TRIGGER dtr_set_updated_at_trg;
ALTER TABLE public.dtr ENABLE TRIGGER dtr_set_last_edited_trg;

COMMENT ON COLUMN public.dtr.lawyer_person_id IS
  'team.person_id of the entry author. Stable across renames — prefer this over lawyer_name when resolving position, initials or rate.';
