-- A person's dashboard layout: which widgets they show, in what order, and
-- whether the calendar shows their week or the firm's. Shape and defaults
-- live in lib/dashboard-widgets.ts; null means the role's default. Covered by
-- the existing user_preferences_own policy (FOR ALL, own email).
ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS dashboard_layout jsonb;
