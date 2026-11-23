-- A person's sidebar, per area: pages pinned to the top and links hidden, as
-- { "<area>": { "pins": [href...], "hides": [href...] } }. Shape and merge live
-- in lib/nav/custom-sidebar.ts; null means the role's default. Covered by the
-- existing user_preferences_own policy (FOR ALL, own email).
ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS sidebar_layout jsonb;
