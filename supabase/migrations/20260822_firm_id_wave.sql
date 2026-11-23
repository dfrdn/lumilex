-- Multitenancy phase 2, wave 1: add firm_id to every tenant-scoped table.
--
-- TRANSITIONAL: the per-column defaults pin new rows to the dev firm; they are
-- dropped in the service-role discipline phase when the app injects firm_id
-- explicitly. A multi-firm database must never run with these defaults in place.
--
-- Global tables (NO firm_id): firms, firm_domains, ph_holidays, rule_sets,
-- rule_deadlines, agents, drafting_idempotency.
-- Already re-keyed earlier: firm_invoice_settings.
-- Re-keyed in 20260822_firm_rekey_uniques.sql: invoice_number_counters,
-- client_code_counters.
-- Table list generated 2026-08-22 by introspecting pg_class on the Lumilex dev
-- project (ordinary public tables minus the exclusions above).

do $$
declare
  t text;
  dev_firm constant uuid := '00000000-0000-4000-8000-000000000001';
  -- Hot tables get a targeted composite index below instead of the plain (firm_id) index.
  hot constant text[] := array[
    'matters','invoices','tasks','deliverables','dtr','emails','notifications',
    'chat_messages','files','audit_log'
  ];
  tenant_tables constant text[] := array[
    'affidavit_review_comments','affidavit_reviews','agent_proposals','agent_runs',
    'announcements','assistant_announcements','assistant_digest_log','assistant_digest_settings',
    'assistant_messages','assistant_preferences','assistant_reminders','attendance',
    'audit_log','backfill_state','billing_rates','calendar_sync_events',
    'chat_channels','chat_messages','chat_mutes','chat_push_tokens',
    'chat_reactions','chat_read_receipts','client_deposits','client_intakes',
    'client_partner_notes','client_users','clients','corporation_affiliations',
    'corporation_files','corporation_meetings','corporation_persons','corporation_share_classes',
    'corporations','deadline_chain_items','deadline_chains','deliverable_actions',
    'deliverable_comment_reactions','deliverable_comments','deliverable_files','deliverable_version_reactions',
    'deliverables','directory','document_templates','drafting_style_profiles',
    'dtr','dtr_revision_comments','dtr_revision_reviews','dtr_revisions',
    'email_attachments','email_mailbox_copies','email_mailboxes','email_matter_links',
    'email_signatures','email_templates','emails','embeddings',
    'engagement_proposals','engagement_signatures','entity_comment_reactions','entity_comments',
    'enum_options','evaluation_period_discretionary_bonuses','evaluation_period_other_bonuses','evaluation_periods',
    'evaluation_scores','evaluations','exhibits','expense_revisions',
    'fee_schedules','feedbacks','file_analyses','file_requests',
    'files','firm_expense_templates','firm_expenses','firm_profiles',
    'generated_documents','hearings','intake_stage_history','intake_submissions',
    'invoice_payments','invoices','issuance_scrape_runs','issuances',
    'kb_jobs','kb_page_citations','kb_page_matters','kb_pages',
    'knowledge_searches','leaves','liaison_tasks','matter_action_entries',
    'matter_billing_actions','matter_billing_configs','matter_billing_milestones','matter_exec_summaries',
    'matter_expenses','matter_group_summaries','matter_health','matter_sol',
    'matter_summaries','matters','meetings','notification_mutes',
    'notifications','parties','partner_matter_annotations','pleading_red_team_comments',
    'pleading_red_teams','portal_chat_messages','push_subscriptions','reimbursements',
    'resolution_templates','resolutions','resources','saved_reports',
    'scope_templates','sla_breaches','sla_rules','tasks',
    'team','telegram_link_codes','telegram_messages','trademark_client_reports',
    'trademark_files','trademarks','transportation_zones','user_preferences'
  ];
begin
  foreach t in array tenant_tables loop
    execute format('alter table public.%I add column if not exists firm_id uuid', t);
    execute format('update public.%I set firm_id = %L where firm_id is null', t, dev_firm);
    execute format('alter table public.%I alter column firm_id set not null', t);
    -- TRANSITIONAL default (see header comment).
    execute format('alter table public.%I alter column firm_id set default %L', t, dev_firm);
    if not exists (
      select 1 from pg_constraint
      where conname = t || '_firm_id_fkey'
        and conrelid = format('public.%I', t)::regclass
    ) then
      execute format(
        'alter table public.%I add constraint %I foreign key (firm_id) references public.firms(id)',
        t, t || '_firm_id_fkey'
      );
    end if;
    if not (t = any (hot)) then
      execute format('create index if not exists %I on public.%I (firm_id)', t || '_firm_id_idx', t);
    end if;
  end loop;
end $$;

-- Targeted composite indexes for hot tables (columns verified against
-- information_schema on the dev project 2026-08-22):
--   dtr has no billing_month; its month/day column is "date".
--   files has no created_at; its creation timestamp is created_time.
create index if not exists matters_firm_id_status_idx on public.matters (firm_id, status);
create index if not exists invoices_firm_id_billing_month_idx on public.invoices (firm_id, billing_month);
create index if not exists tasks_firm_id_status_idx on public.tasks (firm_id, status);
create index if not exists deliverables_firm_id_status_idx on public.deliverables (firm_id, status);
create index if not exists dtr_firm_id_date_idx on public.dtr (firm_id, date);
create index if not exists emails_firm_id_received_at_idx on public.emails (firm_id, received_at);
create index if not exists notifications_firm_id_created_at_idx on public.notifications (firm_id, created_at);
create index if not exists chat_messages_firm_id_channel_id_idx on public.chat_messages (firm_id, channel_id);
create index if not exists files_firm_id_created_time_idx on public.files (firm_id, created_time);
create index if not exists audit_log_firm_id_created_at_idx on public.audit_log (firm_id, created_at);

-- team.person_id becomes globally unique (identity bridge for current_firm_id()).
do $$
declare
  dupes text;
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'team_person_id_key' and conrelid = 'public.team'::regclass
  ) then
    select string_agg(person_id, ', ') into dupes
    from (
      select person_id
      from public.team
      where person_id is not null
      group by person_id
      having count(*) > 1
    ) d;
    if dupes is not null then
      raise exception 'cannot add team_person_id_key: duplicate person_id values: %', dupes;
    end if;
    alter table public.team add constraint team_person_id_key unique (person_id);
  end if;
end $$;
