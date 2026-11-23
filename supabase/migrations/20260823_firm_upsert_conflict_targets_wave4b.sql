-- Multitenancy phase 5, wave 4b: composite (firm_id, …) unique indexes for the
-- upsert conflict targets reached by newly firm-scoped service clients.
--
-- getServiceDbForFirm rewrites an upsert's `onConflict` to `firm_id,<cols>`,
-- and Postgres infers a conflict target only from a unique index on exactly
-- that column set. Without these, each upsert below fails at runtime with
-- "there is no unique or exclusion constraint matching the ON CONFLICT
-- specification" — the wave-3 counterpart is 20260823_firm_upsert_conflict_targets.
--
-- Same rule as that migration: the original global uniques are kept ALONGSIDE
-- rather than dropped. Single-firm data satisfies both, and deciding where a
-- cross-firm duplicate must become legal belongs to the onboarding cutover.

-- app/api/chat/mute (chat_mutes) — onConflict 'channel_id,person_id'
create unique index if not exists chat_mutes_firm_channel_person_key
  on public.chat_mutes (firm_id, channel_id, person_id);

-- app/api/chat/channels/[channelId]/read + .../messages (chat_read_receipts)
create unique index if not exists chat_read_receipts_firm_channel_person_key
  on public.chat_read_receipts (firm_id, channel_id, person_id);

-- app/api/push/register (chat_push_tokens) — onConflict 'expo_push_token'
create unique index if not exists chat_push_tokens_firm_expo_token_key
  on public.chat_push_tokens (firm_id, expo_push_token);

-- app/api/liaison-tasks/[id]/complete (reimbursements) — onConflict 'notion_id'
create unique index if not exists reimbursements_firm_notion_id_key
  on public.reimbursements (firm_id, notion_id);

-- app/api/liaison-tasks/[id]/complete (matter_expenses) — onConflict 'liaison_task_id'
create unique index if not exists matter_expenses_firm_liaison_task_key
  on public.matter_expenses (firm_id, liaison_task_id);

-- lib/queries/attendance (attendance) — onConflict 'notion_id'
create unique index if not exists attendance_firm_notion_id_key
  on public.attendance (firm_id, notion_id);
