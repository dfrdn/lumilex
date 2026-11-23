// Single source of truth for the matter auto-archive thresholds.
// Shared by the cron (app/api/matters/auto-archive) and the partner Matters UI
// so the "auto-archives in Nd" countdown can never drift from the cron's cutoff.
// The same 60-day window is also referenced in the DB activity triggers
// (supabase/migrations/20260602_matter_activity_triggers_v2.sql) as the
// historical-backfill guard — keep them in sync if you change it.

/** Ongoing matters idle this many days get auto-archived. */
export const IDLE_ARCHIVE_DAYS = 60;

/** UI starts flagging an Ongoing matter as approaching auto-archive at this idle age. */
export const IDLE_WARN_DAYS = 45;
