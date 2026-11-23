-- A partner can dismiss a feedback without responding: it leaves the pending
-- queue (and the sidebar count) and the submitter is not notified.
ALTER TABLE public.feedbacks ADD COLUMN IF NOT EXISTS dismissed_at timestamptz;
ALTER TABLE public.feedbacks ADD COLUMN IF NOT EXISTS dismissed_by text;
