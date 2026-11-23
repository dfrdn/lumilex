-- A client report on the team's own paper can be the status report a
-- deliverable tracked: deliverable_id names it, so each links to the other.
-- Sending or recording the report marks that status report sent out.

ALTER TABLE public.trademark_client_reports
  ADD COLUMN IF NOT EXISTS deliverable_id text REFERENCES public.deliverables(notion_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS trademark_client_reports_deliverable_idx
  ON public.trademark_client_reports (deliverable_id) WHERE deliverable_id IS NOT NULL;
