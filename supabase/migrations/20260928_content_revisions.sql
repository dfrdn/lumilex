-- Version history for editable firm content.
--
-- Library pages and fee schedules are edited in the app, and neither kept
-- history: a save overwrote, and nothing recorded what was there before. That
-- is tolerable for a page distilled from matter data, which can be regenerated.
-- It is not tolerable for the handbook, the clause positions and the rate
-- cards, which are firm policy written by hand — an overwrite loses a firm
-- decision with no way back.
--
-- One table rather than a revisions table per entity (dtr_revisions,
-- expense_revisions) because those model domain overrides that other queries
-- read; this only ever answers "what did this look like before".
--
-- The snapshot is the row as it was BEFORE the edit, so the first edit of a
-- seeded page preserves the seeded text. Restoring writes a snapshot back,
-- which itself records a revision — history is append-only.
--
-- A tenant table: firm_id NOT NULL with no default, stamped by
-- getServiceDbForFirm. RLS on with no policies — written and read through the
-- firm-scoped service client only, behind the handlers' own checks.

create table if not exists public.content_revisions (
  id             bigserial primary key,
  firm_id        uuid not null references public.firms(id),
  entity_type    text not null,
  entity_id      text not null,
  snapshot       jsonb not null,
  changed_fields text[] not null default '{}',
  edited_by      text,
  created_at     timestamptz not null default now(),

  constraint content_revisions_entity_type_check
    check (entity_type in ('kb_page', 'fee_schedule'))
);

-- The history panel: newest first for one entity.
create index if not exists content_revisions_entity_idx
  on public.content_revisions (firm_id, entity_type, entity_id, created_at desc);

alter table public.content_revisions enable row level security;
