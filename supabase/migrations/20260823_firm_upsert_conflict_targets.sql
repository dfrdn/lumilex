-- Multitenancy phase 5, wave 3: composite (firm_id, …) unique indexes for the
-- upsert conflict targets used by firm-scoped service clients.
--
-- getServiceDbForFirm rewrites an upsert's onConflict to `firm_id,<cols>`, and
-- Postgres only infers a conflict target from a unique index on exactly that
-- column set. Wave 2 (20260822_firm_rekey_uniques) re-keyed several uniques;
-- these are the remaining ones hit by wave-3 upserts. The original global
-- uniques are kept ALONGSIDE (not dropped): raw-client upserts in helpers not
-- yet converted (lib/ai/embeddings et al.) still infer against them, and
-- single-firm data satisfies both. Dropping the global ones where cross-firm
-- duplicates must become legal (e.g. emails.internet_message_id) is a decision
-- for the onboarding cutover, not this wave.

create unique index if not exists firm_expenses_firm_template_month_uniq
  on public.firm_expenses (firm_id, recurring_template_id, materialized_month);

create unique index if not exists email_mailbox_copies_firm_mailbox_message_key
  on public.email_mailbox_copies (firm_id, mailbox_id, graph_message_id);

create unique index if not exists email_attachments_firm_email_attachment_key
  on public.email_attachments (firm_id, email_id, graph_attachment_id);

create unique index if not exists embeddings_firm_source_chunk_unique
  on public.embeddings (firm_id, source_type, source_id, chunk_index);

create unique index if not exists matter_summaries_firm_matter_key
  on public.matter_summaries (firm_id, matter_id);

create unique index if not exists matter_health_firm_matter_key
  on public.matter_health (firm_id, matter_id);

create unique index if not exists deliverable_files_firm_dedup_uidx
  on public.deliverable_files (firm_id, deliverable_id, version, file_url);
