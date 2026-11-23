-- ═══════════════════════════════════════════════════════════════════
--  Lumilex schema baseline
--  Generated 2026-08-22 from the live catalog of the origin app's
--  production project via introspection — the historical
--  migration journal (removed; in git history) had drifted and
--  cannot bootstrap a database. Scrubs applied at the end of this file:
--    * queue_matter_summary_refresh(): hardcoded URL + cron secret
--      replaced with Vault lookups (secrets: app_base_url, cron_secret)
--    * user_passwords (frozen pre-auth-migration backup) dropped
--    * sync_log (Notion-sync era) dropped
--  pg_cron jobs are deliberately NOT recreated here — see
--  baseline-work/12_cron_review.md; scheduling is consolidated in
--  vercel.json (plan Phase 5).
-- ═══════════════════════════════════════════════════════════════════
set check_function_bodies = off;



-- ───────────────── 00_extensions ─────────────────
-- Extensions present in live origin database, extracted 2026-08-22.
-- plpgsql omitted (default). Schemas are exact as in live pg_extension/pg_namespace.

create extension if not exists "btree_gist" with schema public;
create extension if not exists "citext" with schema public;
create extension if not exists "hypopg" with schema extensions;
create extension if not exists "index_advisor" with schema extensions;
create extension if not exists "pg_cron" with schema pg_catalog;
create extension if not exists "pg_net" with schema extensions;
create extension if not exists "pg_stat_statements" with schema extensions;
create extension if not exists "pg_trgm" with schema public;
create extension if not exists "pgcrypto" with schema extensions;
create extension if not exists "supabase_vault" with schema vault;
create extension if not exists "uuid-ossp" with schema extensions;
create extension if not exists "vector" with schema extensions;

-- ───────────────── 01_sequences (create) ─────────────────
-- baseline: sequences in schema public (non-identity only; identity-column sequences are created by their tables)
create sequence if not exists public.affidavit_review_comments_id_seq;
create sequence if not exists public.affidavit_reviews_id_seq;
create sequence if not exists public.assistant_messages_id_seq;
create sequence if not exists public.audit_log_id_seq;
create sequence if not exists public.billing_rates_id_seq as integer;
create sequence if not exists public.calendar_sync_events_id_seq;
create sequence if not exists public.client_deposits_id_seq as integer;
create sequence if not exists public.client_intakes_id_seq;
create sequence if not exists public.client_partner_notes_id_seq;
create sequence if not exists public.corporation_files_id_seq as integer;
create sequence if not exists public.corporation_persons_id_seq as integer;
create sequence if not exists public.deadline_chain_items_id_seq;
create sequence if not exists public.deadline_chains_id_seq;
create sequence if not exists public.deliverable_actions_id_seq;
create sequence if not exists public.deliverable_comment_reactions_id_seq as integer;
create sequence if not exists public.deliverable_comments_id_seq as integer;
create sequence if not exists public.deliverable_files_id_seq;
create sequence if not exists public.deliverable_version_reactions_id_seq as integer;
create sequence if not exists public.document_templates_id_seq as integer;
create sequence if not exists public.dtr_revision_comments_id_seq;
create sequence if not exists public.dtr_revision_reviews_id_seq;
create sequence if not exists public.dtr_revisions_id_seq;
create sequence if not exists public.email_attachments_id_seq;
create sequence if not exists public.email_mailboxes_id_seq;
create sequence if not exists public.email_matter_links_id_seq;
create sequence if not exists public.email_templates_id_seq;
create sequence if not exists public.emails_id_seq;
create sequence if not exists public.entity_comment_reactions_id_seq as integer;
create sequence if not exists public.entity_comments_id_seq as integer;
create sequence if not exists public.enum_options_id_seq as integer;
create sequence if not exists public.file_analyses_id_seq;
create sequence if not exists public.firm_expense_templates_id_seq;
create sequence if not exists public.firm_expenses_id_seq;
create sequence if not exists public.generated_documents_id_seq as integer;
create sequence if not exists public.intake_stage_history_id_seq;
create sequence if not exists public.invoice_payments_id_seq;
create sequence if not exists public.invoices_id_seq as integer;
create sequence if not exists public.issuance_scrape_runs_id_seq as integer;
create sequence if not exists public.issuances_id_seq as integer;
create sequence if not exists public.liaison_tasks_id_seq as integer;
create sequence if not exists public.matter_action_entries_id_seq as integer;
create sequence if not exists public.matter_billing_actions_id_seq as integer;
create sequence if not exists public.matter_billing_configs_id_seq;
create sequence if not exists public.matter_billing_milestones_id_seq as integer;
create sequence if not exists public.matter_expenses_id_seq;
create sequence if not exists public.matter_sol_id_seq;
create sequence if not exists public.parties_id_seq;
create sequence if not exists public.partner_matter_annotations_id_seq;
create sequence if not exists public.ph_holidays_id_seq;
create sequence if not exists public.pleading_red_team_comments_id_seq;
create sequence if not exists public.pleading_red_teams_id_seq;
create sequence if not exists public.push_subscriptions_id_seq;
create sequence if not exists public.resources_id_seq as integer;
create sequence if not exists public.sync_log_id_seq as integer;
create sequence if not exists public.telegram_messages_id_seq;
create sequence if not exists public.trademark_client_reports_id_seq as integer;
create sequence if not exists public.trademark_files_id_seq as integer;
create sequence if not exists public.transportation_zones_id_seq as integer;
create sequence if not exists public.user_passwords_id_seq;


-- ───────────────── 02_tables ─────────────────
-- baseline: create table statements for all ordinary tables in schema public (columns only; constraints in 03_constraints.sql)

-- table: affidavit_review_comments
create table public.affidavit_review_comments (
  id bigint default nextval('affidavit_review_comments_id_seq'::regclass) not null,
  review_id bigint not null,
  author_id text not null,
  body text not null,
  created_at timestamp with time zone default now() not null,
  q_no integer,
  question text
);

-- table: affidavit_reviews
create table public.affidavit_reviews (
  id bigint default nextval('affidavit_reviews_id_seq'::regclass) not null,
  matter_id text,
  deliverable_id text,
  deliverable_file_id bigint,
  source text default 'upload'::text not null,
  mode text default 'self'::text not null,
  file_name text default ''::text not null,
  storage_path text,
  status text default 'pending'::text not null,
  affiant_name text,
  summary text,
  question_count integer,
  objectionable_count integer,
  severity_breakdown jsonb,
  findings jsonb,
  extracted_text text,
  claude_file_id text,
  token_count_input integer,
  token_count_output integer,
  model_used text,
  error_message text,
  reviewed_by text not null,
  created_at timestamp with time zone default now() not null,
  completed_at timestamp with time zone,
  citations jsonb
);

-- table: agent_proposals
create table public.agent_proposals (
  id bigint generated always as identity not null,
  kind text not null,
  matter_id text not null,
  email_id bigint,
  email_attachment_id bigint,
  file_analysis_id bigint,
  rule_set_id text,
  rule_set_name text default ''::text not null,
  trigger_date date,
  trigger_label text default ''::text not null,
  proposed_items jsonb default '[]'::jsonb not null,
  chain_id bigint,
  created_file_id text,
  confidence numeric default 0 not null,
  reasoning text default ''::text not null,
  document_name text default ''::text not null,
  document_summary text default ''::text not null,
  status text default 'pending'::text not null,
  decided_by text,
  decided_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  agent_id text,
  agent_run_id bigint,
  source text default 'court_mail'::text not null,
  dismiss_reason text
);

-- table: agent_runs
create table public.agent_runs (
  id bigint generated always as identity not null,
  agent_id text not null,
  trigger text not null,
  triggered_by text,
  status text default 'running'::text not null,
  input jsonb default '{}'::jsonb not null,
  summary text default ''::text not null,
  error text,
  model text,
  input_tokens integer default 0 not null,
  output_tokens integer default 0 not null,
  cache_read_tokens integer default 0 not null,
  cache_write_tokens integer default 0 not null,
  tool_calls integer default 0 not null,
  proposals_created integer default 0 not null,
  started_at timestamp with time zone default now() not null,
  finished_at timestamp with time zone
);

-- table: agents
create table public.agents (
  id text not null,
  name text not null,
  description text default ''::text not null,
  autonomy text default 'propose'::text not null,
  supervisor_person_id text,
  created_at timestamp with time zone default now() not null
);

-- table: announcements
create table public.announcements (
  notion_id text not null,
  notion_url text default ''::text not null,
  name text default ''::text not null,
  content text default ''::text not null,
  created_time timestamp with time zone,
  notion_last_edited_at timestamp with time zone,
  synced_at timestamp with time zone default now() not null,
  announcement_date date,
  type text default ''::text not null
);

-- table: assistant_announcements
create table public.assistant_announcements (
  person_id text not null,
  announcement_key text not null,
  sent_at timestamp with time zone default now() not null
);

-- table: assistant_digest_log
create table public.assistant_digest_log (
  person_id text not null,
  digest_date date not null,
  sent_at timestamp with time zone default now() not null
);

-- table: assistant_digest_settings
create table public.assistant_digest_settings (
  person_id text not null,
  enabled boolean default true not null,
  send_time text default '07:00'::text not null,
  updated_at timestamp with time zone default now() not null
);

-- table: assistant_messages
create table public.assistant_messages (
  id bigint default nextval('assistant_messages_id_seq'::regclass) not null,
  person_id text not null,
  role text not null,
  content text not null,
  created_at timestamp with time zone default now() not null
);

-- table: assistant_preferences
create table public.assistant_preferences (
  id bigint generated by default as identity not null,
  person_id text not null,
  note text not null,
  created_at timestamp with time zone default now() not null
);

-- table: assistant_reminders
create table public.assistant_reminders (
  id bigint generated by default as identity not null,
  person_id text not null,
  chat_id text default ''::text not null,
  message text not null,
  due_at timestamp with time zone not null,
  sent_at timestamp with time zone,
  created_at timestamp with time zone default now() not null
);
-- table: attendance
create table public.attendance (
  notion_id text not null,
  notion_url text default ''::text not null,
  date_label text default ''::text not null,
  lawyer_id text,
  lawyer_name text default ''::text not null,
  time_in timestamp with time zone,
  time_out timestamp with time zone,
  created_by_name text default ''::text not null,
  notion_last_edited_at timestamp with time zone,
  synced_at timestamp with time zone default now() not null,
  notion_page_id text,
  created_time timestamp with time zone
);

-- table: audit_log
create table public.audit_log (
  id bigint default nextval('audit_log_id_seq'::regclass) not null,
  entity_type text not null,
  entity_id text,
  entity_name text,
  action text not null,
  field_changed text,
  old_value text,
  new_value text,
  performed_by text,
  performed_by_name text,
  ip_address text,
  created_at timestamp with time zone default now() not null,
  actor_type text default 'human'::text not null,
  agent_id text,
  agent_run_id bigint
);

-- table: backfill_state
create table public.backfill_state (
  name text not null,
  offset_val integer default 0 not null,
  done boolean default false not null,
  last_run timestamp with time zone default now()
);

-- table: billing_rates
create table public.billing_rates (
  id integer default nextval('billing_rates_id_seq'::regclass) not null,
  "position" text not null,
  hourly_rate numeric(12,2) not null,
  currency text default 'PHP'::text not null,
  effective_from date default CURRENT_DATE not null,
  updated_at timestamp with time zone default now() not null
);

-- table: calendar_sync_events
create table public.calendar_sync_events (
  id bigint default nextval('calendar_sync_events_id_seq'::regclass) not null,
  entity_type text not null,
  entity_id text not null,
  team_person_id text not null,
  outlook_event_id text not null,
  last_synced_at timestamp with time zone default now() not null,
  sync_status text default 'synced'::text not null,
  created_at timestamp with time zone default now() not null
);

-- table: chat_channels
create table public.chat_channels (
  id uuid default gen_random_uuid() not null,
  type text not null,
  matter_id text,
  name text,
  member_ids text[] default '{}'::text[] not null,
  created_by text not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

-- table: chat_messages
create table public.chat_messages (
  id uuid default gen_random_uuid() not null,
  channel_id uuid not null,
  sender_id text not null,
  content text default ''::text not null,
  entity_refs jsonb default '[]'::jsonb not null,
  attachments jsonb default '[]'::jsonb not null,
  edited_at timestamp with time zone,
  deleted_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  mentions text[] default '{}'::text[] not null,
  reply_to_id uuid
);

-- table: chat_mutes
create table public.chat_mutes (
  channel_id uuid not null,
  person_id text not null,
  muted_until timestamp with time zone,
  created_at timestamp with time zone default now() not null
);

-- table: chat_push_tokens
create table public.chat_push_tokens (
  id uuid default gen_random_uuid() not null,
  person_id text not null,
  expo_push_token text not null,
  platform text not null,
  app_version text,
  last_seen_at timestamp with time zone default now() not null,
  created_at timestamp with time zone default now() not null
);

-- table: chat_reactions
create table public.chat_reactions (
  message_id uuid not null,
  channel_id uuid not null,
  person_id text not null,
  emoji text not null,
  created_at timestamp with time zone default now() not null
);

-- table: chat_read_receipts
create table public.chat_read_receipts (
  channel_id uuid not null,
  person_id text not null,
  last_read_at timestamp with time zone default now() not null,
  last_read_msg_id uuid
);

-- table: client_code_counters
create table public.client_code_counters (
  scope text not null,
  last_code integer default 0 not null
);
-- table: client_deposits
create table public.client_deposits (
  id integer default nextval('client_deposits_id_seq'::regclass) not null,
  client_id text,
  client_name text not null,
  type text not null,
  amount numeric(12,2) not null,
  transaction_date date default ((now() AT TIME ZONE 'Asia/Manila'::text))::date not null,
  payment_method text default ''::text not null,
  reference_number text default ''::text not null,
  notes text default ''::text not null,
  invoice_id integer,
  recorded_by text not null,
  created_at timestamp with time zone default now() not null
);

-- table: client_intakes
create table public.client_intakes (
  id bigint default nextval('client_intakes_id_seq'::regclass) not null,
  client_id text not null,
  stage text default 'Lead'::text not null,
  assigned_lawyer_id text,
  source text default 'referral'::text not null,
  referral_source text default ''::text not null,
  consultation_date timestamp with time zone,
  consultation_notes text default ''::text not null,
  proposed_services text[] default '{}'::text[] not null,
  proposed_fee numeric(12,2),
  engagement_letter_url text default ''::text not null,
  declined_reason text default ''::text not null,
  conflict_check_result jsonb,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  created_by text
);

-- table: client_partner_notes
create table public.client_partner_notes (
  id bigint default nextval('client_partner_notes_id_seq'::regclass) not null,
  client_id text not null,
  author_id text not null,
  body text not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

-- table: client_users
create table public.client_users (
  id uuid default gen_random_uuid() not null,
  auth_user_id uuid,
  client_id text not null,
  email citext not null,
  name text,
  active boolean default true not null,
  created_at timestamp with time zone default now() not null,
  last_login_at timestamp with time zone
);

-- table: clients
create table public.clients (
  notion_id text not null,
  notion_url text default ''::text not null,
  name text default ''::text not null,
  notion_last_edited_at timestamp with time zone,
  synced_at timestamp with time zone default now() not null,
  client_code integer default 0 not null,
  status text default ''::text not null,
  full_company_name text default ''::text not null,
  tin text default ''::text not null,
  contact_email text default ''::text not null,
  phone_number text default ''::text not null,
  point_persons text default ''::text not null,
  discount numeric(5,2),
  receivables numeric(12,2),
  priority boolean default false not null,
  created_time timestamp with time zone,
  receivables_note text,
  receivables_updated_at timestamp with time zone,
  receivables_updated_by text,
  receivables_as_of date,
  deposit_balance numeric(12,2) default 0 not null,
  collection_risk boolean default false not null,
  relationship_partner_id text
);

-- table: corporation_affiliations
create table public.corporation_affiliations (
  id bigint generated always as identity not null,
  corporation_id text not null,
  relation text not null,
  name text not null,
  sec_registration_no text,
  address text,
  sort_order integer default 0 not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

-- table: corporation_files
create table public.corporation_files (
  id integer default nextval('corporation_files_id_seq'::regclass) not null,
  corporation_id text not null,
  category text not null,
  name text not null,
  storage_path text not null,
  mime_type text,
  size_bytes bigint,
  uploaded_by text,
  uploaded_at timestamp with time zone default now() not null,
  person_id integer,
  filing_year integer
);
-- table: corporation_meetings
create table public.corporation_meetings (
  id text default (gen_random_uuid())::text not null,
  corporation_id text not null,
  meeting_type text not null,
  meeting_date date not null,
  meeting_time time without time zone,
  meeting_mode text,
  venue text,
  notice_sent_date date,
  quorum_achieved boolean default false not null,
  shares_represented numeric(18,2),
  total_shares_outstanding numeric(18,2),
  agenda jsonb default '[]'::jsonb not null,
  attendees jsonb default '[]'::jsonb not null,
  minutes_status text default 'Draft'::text not null,
  minutes_file_path text,
  attendance_sheet_path text,
  recording_path text,
  notes text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  created_by text,
  notice_file_path text,
  waiver_of_notice_file_path text,
  proxy_file_paths text[] default '{}'::text[] not null
);

-- table: corporation_persons
create table public.corporation_persons (
  id integer default nextval('corporation_persons_id_seq'::regclass) not null,
  corporation_id text not null,
  role text not null,
  first_name text default ''::text not null,
  last_name text default ''::text not null,
  nationality text,
  gender text,
  residential_address text,
  tin text,
  passport_number text,
  esap_no text,
  shares_subscribed_amount numeric(18,2),
  shares_paid_amount numeric(18,2),
  position_title text,
  term_start date,
  term_end date,
  is_current boolean default true not null,
  sort_order integer default 0 not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  is_juridical boolean default false not null,
  entity_name text,
  entity_type text,
  entity_registration_no text,
  representative_name text,
  representative_title text,
  share_class text,
  shares_subscribed_count numeric
);

-- table: corporation_share_classes
create table public.corporation_share_classes (
  id bigint generated always as identity not null,
  corporation_id text not null,
  class_name text not null,
  par_value numeric,
  authorized_shares numeric,
  sort_order integer default 0 not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

-- table: corporations
create table public.corporations (
  id text default (gen_random_uuid())::text not null,
  client_id text,
  engaging_client_id text,
  incorporation_matter_id text,
  post_incorporation_matter_id text,
  housekeeping_matter_id text,
  retainer_matter_id text,
  handles_incorporation boolean default true not null,
  handles_post_incorporation boolean default false not null,
  handles_housekeeping boolean default false not null,
  is_under_retainer boolean default false not null,
  proposed_names text[] default '{}'::text[] not null,
  approved_name text,
  company_type text,
  industry_classification text,
  primary_purpose text,
  secondary_purposes text[] default '{}'::text[] not null,
  authorized_capital_stock numeric(18,2),
  subscribed_capital numeric(18,2),
  paid_up_capital numeric(18,2),
  par_value numeric(18,4),
  number_of_shares bigint,
  principal_office_address text,
  official_email text,
  alternate_email text,
  official_mobile text,
  alternate_mobile text,
  website text,
  contact_first_name text,
  contact_last_name text,
  contact_nationality text,
  contact_gender text,
  contact_tin text,
  contact_passport_number text,
  fiscal_year_end_month integer default 12 not null,
  esparc_application_no text,
  esparc_status text,
  esparc_submitted_date date,
  sec_registration_no text,
  sec_registration_date date,
  date_of_incorporation date,
  bir_tin text,
  bir_rdo_code text,
  bir_cor_date date,
  bir_books_registration_date date,
  bir_or_authority_date date,
  business_permit_no text,
  business_permit_lgu text,
  business_permit_issued_date date,
  business_permit_expiry_date date,
  sss_employer_no text,
  sss_registration_date date,
  philhealth_employer_no text,
  philhealth_registration_date date,
  pagibig_employer_no text,
  pagibig_registration_date date,
  status text default 'Pre-Incorporation'::text not null,
  notes text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  created_by text,
  bir_orus_username text,
  bir_orus_enrolled_date date,
  sec_efast_username text,
  sec_efast_enrolled_date date,
  sec_habor_username text,
  sec_habor_enrolled_date date,
  business_trade_name text,
  annual_meeting_bylaws text,
  geographical_code text,
  external_auditor_name text,
  external_auditor_accreditation_no text,
  telephone_number text,
  fax_number text,
  total_assets numeric,
  total_assets_as_of date,
  annual_meeting_month integer,
  annual_meeting_day integer
);
-- table: deadline_chain_items
create table public.deadline_chain_items (
  id bigint default nextval('deadline_chain_items_id_seq'::regclass) not null,
  chain_id bigint not null,
  rule_deadline_id text not null,
  entity_type text not null,
  entity_id text not null,
  label text not null,
  legal_basis text default ''::text,
  due_date date not null,
  is_reglementary boolean default false,
  notes text default ''::text,
  created_at timestamp with time zone default now() not null
);

-- table: deadline_chains
create table public.deadline_chains (
  id bigint default nextval('deadline_chains_id_seq'::regclass) not null,
  matter_id text not null,
  rule_set_id text not null,
  trigger_date date not null,
  created_by text not null,
  created_at timestamp with time zone default now() not null
);

-- table: deliverable_actions
create table public.deliverable_actions (
  id bigint default nextval('deliverable_actions_id_seq'::regclass) not null,
  deliverable_id text not null,
  action text not null,
  old_status text not null,
  new_status text not null,
  performed_by text not null,
  comment text,
  file_url text,
  file_name text,
  created_at timestamp with time zone default now() not null,
  mentions text[] default '{}'::text[]
);

-- table: deliverable_comment_reactions
create table public.deliverable_comment_reactions (
  id integer default nextval('deliverable_comment_reactions_id_seq'::regclass) not null,
  comment_id integer not null,
  person_id text not null,
  emoji text not null,
  created_at timestamp with time zone default now()
);

-- table: deliverable_comments
create table public.deliverable_comments (
  id integer default nextval('deliverable_comments_id_seq'::regclass) not null,
  deliverable_id text not null,
  parent_type text,
  parent_id integer,
  comment text not null,
  mentions text[] default '{}'::text[],
  person_id text not null,
  created_at timestamp with time zone default now() not null
);

-- table: deliverable_files
create table public.deliverable_files (
  id bigint default nextval('deliverable_files_id_seq'::regclass) not null,
  deliverable_id text not null,
  version integer default 1 not null,
  file_name text not null,
  file_url text not null,
  file_size integer,
  uploaded_by text not null,
  action text,
  created_at timestamp with time zone default now() not null,
  sharepoint_item_id text,
  sharepoint_web_url text,
  needs_reupload boolean default false not null
);

-- table: deliverable_version_reactions
create table public.deliverable_version_reactions (
  id integer default nextval('deliverable_version_reactions_id_seq'::regclass) not null,
  deliverable_id text not null,
  version integer not null,
  person_id text not null,
  emoji text not null,
  created_at timestamp with time zone default now()
);

-- table: deliverables
create table public.deliverables (
  notion_id text not null,
  notion_url text default ''::text not null,
  name text default ''::text not null,
  matter_id text,
  matter_name text default ''::text not null,
  client_name text default ''::text not null,
  status text default ''::text not null,
  drafter_ids text[] default '{}'::text[] not null,
  currently_with_ids text[] default '{}'::text[] not null,
  external_due_date date,
  priority text default ''::text not null,
  notion_last_edited_at timestamp with time zone,
  synced_at timestamp with time zone default now() not null,
  date_done date,
  revision_count integer default 0 not null,
  parent_deliverable_id text,
  related_hearing_id text,
  created_time timestamp with time zone,
  type text default ''::text not null,
  reviewer_ids text[] default '{}'::text[] not null,
  review_dates date[] default '{}'::date[] not null,
  source_deliverable_id text,
  source_file_id text,
  subtype text
);

-- table: directory
create table public.directory (
  notion_id text not null,
  notion_url text default ''::text not null,
  name text default ''::text not null,
  contact_number text default ''::text not null,
  email_address text default ''::text not null,
  notion_last_edited_at timestamp with time zone,
  synced_at timestamp with time zone default now() not null,
  created_time timestamp with time zone
);

-- table: document_templates
create table public.document_templates (
  id integer default nextval('document_templates_id_seq'::regclass) not null,
  name text not null,
  category text not null,
  subcategory text,
  description text,
  generation_mode text default 'ai'::text not null,
  template_storage_path text,
  ai_prompt text,
  placeholders jsonb default '[]'::jsonb,
  is_active boolean default true,
  created_by text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  deadline_kind text
);

-- table: drafting_idempotency
create table public.drafting_idempotency (
  key text not null,
  created_by text,
  created_at timestamp with time zone default now() not null
);

-- table: drafting_style_profiles
create table public.drafting_style_profiles (
  id bigint generated always as identity not null,
  doc_type_key text not null,
  document_type text not null,
  format text default 'pleading'::text not null,
  profile_md text not null,
  sample_count integer default 0 not null,
  source_deliverable_ids text[] default '{}'::text[] not null,
  model_used text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);
-- table: dtr
create table public.dtr (
  notion_id text not null,
  notion_url text default ''::text not null,
  remarks text default ''::text not null,
  task text default ''::text not null,
  hours integer default 0 not null,
  minutes integer default 0 not null,
  date date,
  lawyer_name text default ''::text not null,
  notion_last_edited_at timestamp with time zone,
  synced_at timestamp with time zone default now() not null,
  with_ids text[] default '{}'::text[] not null,
  with_names text[] default '{}'::text[] not null,
  client_name text default ''::text not null,
  matter_id text,
  billed boolean default false not null,
  created_time timestamp with time zone,
  non_billable boolean default false not null,
  updated_at timestamp with time zone default now() not null
);

-- table: dtr_revision_comments
create table public.dtr_revision_comments (
  id bigint default nextval('dtr_revision_comments_id_seq'::regclass) not null,
  revision_id bigint not null,
  author_id text not null,
  author_role text not null,
  body text not null,
  created_at timestamp with time zone default now() not null,
  resolved boolean default false not null,
  resolved_at timestamp with time zone,
  resolved_by text
);

-- table: dtr_revision_reviews
create table public.dtr_revision_reviews (
  id bigint default nextval('dtr_revision_reviews_id_seq'::regclass) not null,
  billing_month text not null,
  client_name text not null,
  status text not null,
  notes text default ''::text not null,
  submitted_by text,
  submitted_at timestamp with time zone default now(),
  reviewed_by text,
  reviewed_at timestamp with time zone,
  invoice_settings_override jsonb,
  invoice_gen_status text,
  invoice_gen_error text,
  invoice_gen_invoice_id bigint,
  invoice_gen_invoice_number text,
  invoice_gen_at timestamp with time zone,
  clearance_status text,
  cleared_by text,
  cleared_at timestamp with time zone,
  clearance_notes text default ''::text not null,
  clearance_override_by text,
  clearance_override_at timestamp with time zone,
  clearance_override_reason text
);

-- table: dtr_revisions
create table public.dtr_revisions (
  id bigint default nextval('dtr_revisions_id_seq'::regclass) not null,
  billing_month text not null,
  client_name text not null,
  original_dtr_id text,
  created_entry_key text,
  action text not null,
  hours integer,
  minutes integer,
  date date,
  lawyer_name text,
  with_ids text[],
  with_names text[],
  task text,
  remarks text,
  matter_id text,
  billed boolean,
  non_billable boolean,
  edited_by text not null,
  edited_at timestamp with time zone default now() not null,
  waived_with text[]
);

-- table: email_attachments
create table public.email_attachments (
  id bigint default nextval('email_attachments_id_seq'::regclass) not null,
  email_id bigint not null,
  graph_attachment_id text not null,
  file_name text default ''::text not null,
  content_type text default ''::text not null,
  size_bytes integer default 0 not null,
  is_inline boolean default false not null,
  storage_path text,
  sharepoint_item_id text,
  sharepoint_web_url text,
  linked_file_id text,
  created_at timestamp with time zone default now() not null
);

-- table: email_mailbox_copies
create table public.email_mailbox_copies (
  id bigint generated by default as identity not null,
  email_id bigint not null,
  mailbox_id bigint not null,
  graph_message_id text not null,
  folder_name text default ''::text not null,
  created_at timestamp with time zone default now() not null
);

-- table: email_mailboxes
create table public.email_mailboxes (
  id bigint default nextval('email_mailboxes_id_seq'::regclass) not null,
  email_address text not null,
  display_name text default ''::text not null,
  microsoft_user_id text,
  mailbox_type text default 'shared'::text not null,
  sync_enabled boolean default true not null,
  delta_token text,
  last_synced_at timestamp with time zone,
  folders_filter text[] default '{Inbox,"Sent Items"}'::text[] not null,
  initial_sync_days integer default 30 not null,
  created_at timestamp with time zone default now() not null,
  ms_entity_type text default 'user'::text not null,
  owner_person_id text,
  send_as_principal_id text
);

-- table: email_matter_links
create table public.email_matter_links (
  id bigint default nextval('email_matter_links_id_seq'::regclass) not null,
  email_id bigint not null,
  matter_id text not null,
  link_method text default 'manual'::text not null,
  confidence numeric(3,2) default 1.00 not null,
  linked_by text,
  created_at timestamp with time zone default now() not null
);

-- table: email_signatures
create table public.email_signatures (
  id bigint generated by default as identity not null,
  name text not null,
  body_html text default ''::text not null,
  is_default boolean default false not null,
  created_by text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

-- table: email_templates
create table public.email_templates (
  id bigint default nextval('email_templates_id_seq'::regclass) not null,
  name text not null,
  subject text default ''::text not null,
  body_html text default ''::text not null,
  category text default 'general'::text not null,
  variables text[] default '{}'::text[] not null,
  created_by text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  is_category_default boolean default false not null
);

-- table: emails
create table public.emails (
  id bigint default nextval('emails_id_seq'::regclass) not null,
  graph_message_id text,
  mailbox_id bigint,
  conversation_id text,
  internet_message_id text,
  subject text default ''::text not null,
  from_address text default ''::text not null,
  from_name text default ''::text not null,
  to_addresses jsonb default '[]'::jsonb not null,
  cc_addresses jsonb default '[]'::jsonb not null,
  bcc_addresses jsonb default '[]'::jsonb not null,
  body_preview text default ''::text not null,
  body_html text default ''::text not null,
  has_attachments boolean default false not null,
  importance text default 'normal'::text not null,
  received_at timestamp with time zone not null,
  is_read boolean default false not null,
  is_draft boolean default false not null,
  direction text default 'inbound'::text not null,
  categories text[] default '{}'::text[] not null,
  web_link text default ''::text not null,
  created_at timestamp with time zone default now() not null,
  graph_thread_id text
);

-- table: embeddings
create table public.embeddings (
  id bigint generated always as identity not null,
  source_type text not null,
  source_id text not null,
  matter_id text,
  chunk_index integer default 0 not null,
  chunk_text text not null,
  embedding vector(1024) not null,
  metadata jsonb default '{}'::jsonb,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);
-- table: engagement_proposals
create table public.engagement_proposals (
  id uuid default gen_random_uuid() not null,
  intake_id bigint,
  client_id text not null,
  version integer default 1 not null,
  status text default 'draft'::text not null,
  content jsonb not null,
  storage_path text,
  file_name text,
  created_by text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  thread_id uuid default gen_random_uuid() not null
);

-- table: engagement_signatures
create table public.engagement_signatures (
  id bigint generated always as identity not null,
  matter_id text not null,
  client_user_id uuid,
  document_path text not null,
  document_name text default ''::text not null,
  typed_name text not null,
  signer_email text default ''::text not null,
  signed_at timestamp with time zone default now() not null,
  ip text,
  user_agent text
);

-- table: entity_comment_reactions
create table public.entity_comment_reactions (
  id integer default nextval('entity_comment_reactions_id_seq'::regclass) not null,
  comment_id integer not null,
  person_id text not null,
  emoji text not null,
  created_at timestamp with time zone default now()
);

-- table: entity_comments
create table public.entity_comments (
  id integer default nextval('entity_comments_id_seq'::regclass) not null,
  entity_type text not null,
  entity_id text not null,
  reply_to_id integer,
  body_html text not null,
  mentions text[] default '{}'::text[] not null,
  person_id text not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone
);

-- table: enum_options
create table public.enum_options (
  id integer default nextval('enum_options_id_seq'::regclass) not null,
  entity text not null,
  field text not null,
  value text not null,
  sort_order integer default 0 not null,
  is_active boolean default true not null,
  metadata jsonb,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

-- table: evaluation_period_discretionary_bonuses
create table public.evaluation_period_discretionary_bonuses (
  period_id uuid not null,
  partner_person_id text not null,
  associate_person_id text not null,
  amount_php numeric(14,2) default 0 not null,
  updated_at timestamp with time zone default now() not null
);

-- table: evaluation_period_other_bonuses
create table public.evaluation_period_other_bonuses (
  period_id uuid not null,
  person_id text not null,
  multiplier numeric(6,3) default 1.0 not null,
  updated_at timestamp with time zone default now() not null
);

-- table: evaluation_periods
create table public.evaluation_periods (
  id uuid default gen_random_uuid() not null,
  name text not null,
  start_date date not null,
  end_date date not null,
  created_by text not null,
  created_at timestamp with time zone default now() not null,
  deliberation_unlocked_at timestamp with time zone,
  bonus_pool_php numeric(14,2)
);

-- table: evaluation_scores
create table public.evaluation_scores (
  evaluation_id uuid not null,
  criterion_key text not null,
  rating smallint,
  remarks text,
  not_applicable boolean default false not null
);

-- table: evaluations
create table public.evaluations (
  id uuid default gen_random_uuid() not null,
  period_id uuid not null,
  evaluator_person_id text not null,
  evaluatee_person_id text not null,
  rubric_variant text not null,
  status text default 'draft'::text not null,
  weighted_total numeric(4,3),
  submitted_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

-- table: exhibits
create table public.exhibits (
  id uuid default gen_random_uuid() not null,
  matter_id text not null,
  label text not null,
  offered_by text not null,
  party_label text default ''::text not null,
  parent_exhibit_id uuid,
  title text default ''::text not null,
  description text default ''::text not null,
  document_date date,
  purpose text default ''::text not null,
  file_id text,
  status text default 'marked'::text not null,
  marked_at date,
  offered_at date,
  ruling_date date,
  ruling_note text default ''::text not null,
  sort_order integer default 0 not null,
  notes text default ''::text not null,
  created_by text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

-- table: expense_revisions
create table public.expense_revisions (
  id bigint generated always as identity not null,
  billing_month text not null,
  client_name text not null,
  expense_key text not null,
  action text not null,
  amount numeric,
  description text,
  category text,
  expense_date date,
  edited_by text not null,
  edited_at timestamp with time zone default now() not null
);
-- table: fee_schedules
create table public.fee_schedules (
  id uuid default gen_random_uuid() not null,
  slug text not null,
  name text not null,
  content jsonb not null,
  is_active boolean default true not null,
  sort_order integer default 0 not null,
  created_by text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

-- table: feedbacks
create table public.feedbacks (
  notion_id text not null,
  notion_url text default ''::text not null,
  subject text default ''::text not null,
  type text default ''::text not null,
  feedback_date timestamp with time zone,
  message text default ''::text not null,
  response text default ''::text not null,
  notion_last_edited_at timestamp with time zone,
  synced_at timestamp with time zone default now() not null,
  submitted_by text,
  created_time timestamp with time zone
);

-- table: file_analyses
create table public.file_analyses (
  id bigint default nextval('file_analyses_id_seq'::regclass) not null,
  file_id text,
  attachment_name text default ''::text not null,
  attachment_url text default ''::text not null,
  status text default 'pending'::text not null,
  summary text,
  entities jsonb,
  token_count_input integer,
  token_count_output integer,
  model_used text,
  error_message text,
  analyzed_by text not null,
  created_at timestamp with time zone default now() not null,
  completed_at timestamp with time zone,
  short_summary text,
  extracted_text text,
  claude_file_id text,
  deliverable_file_id bigint,
  email_attachment_id bigint
);

-- table: file_requests
create table public.file_requests (
  id uuid default gen_random_uuid() not null,
  matter_id text not null,
  requested_by text not null,
  description text not null,
  due_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  fulfilled_at timestamp with time zone,
  fulfilled_by_client_user_id uuid,
  canceled_at timestamp with time zone
);

-- table: files
create table public.files (
  notion_id text not null,
  notion_url text default ''::text not null,
  name text default ''::text not null,
  matter_id text,
  matter_name text default ''::text not null,
  created_time timestamp with time zone,
  notion_last_edited_at timestamp with time zone,
  synced_at timestamp with time zone default now() not null,
  origin text default ''::text not null,
  action_taken text default ''::text not null,
  date_received date,
  date_sent_filed date,
  document_date date,
  deliverable_id text,
  deliverable_name text default ''::text not null,
  file_urls jsonb default '[]'::jsonb not null,
  acted_upon_by_ids text[] default '{}'::text[] not null,
  persons_read_ids text[] default '{}'::text[] not null,
  sharepoint_urls jsonb default '[]'::jsonb not null,
  is_court_record boolean default false not null,
  uploaded_by_client_user_id uuid,
  file_request_id uuid
);

-- table: firm_expense_templates
create table public.firm_expense_templates (
  id bigint default nextval('firm_expense_templates_id_seq'::regclass) not null,
  category text not null,
  amount numeric not null,
  vendor text default ''::text not null,
  description text default ''::text not null,
  payment_method text default ''::text not null,
  cadence text default 'monthly'::text not null,
  day_of_month integer default 1 not null,
  start_date date not null,
  end_date date,
  active boolean default true not null,
  last_generated_month text,
  recorded_by text,
  created_at timestamp with time zone default now() not null
);

-- table: firm_expenses
create table public.firm_expenses (
  id bigint default nextval('firm_expenses_id_seq'::regclass) not null,
  expense_date date not null,
  category text not null,
  amount numeric not null,
  vendor text default ''::text not null,
  description text default ''::text not null,
  payment_method text default ''::text not null,
  notes text default ''::text not null,
  recurring_template_id bigint,
  recorded_by text not null,
  created_at timestamp with time zone default now() not null,
  materialized_month text
);

-- table: firm_invoice_settings
create table public.firm_invoice_settings (
  id smallint default 1 not null,
  firm_address text default ''::text not null,
  firm_address2 text default ''::text not null,
  firm_tin text default ''::text not null,
  bank_name text default ''::text not null,
  bank_account_no text default ''::text not null,
  bank_account_name text default ''::text not null,
  signer_name text default ''::text not null,
  updated_by text,
  updated_at timestamp with time zone default now() not null
);

-- table: firm_profiles
create table public.firm_profiles (
  id uuid default gen_random_uuid() not null,
  name text default 'Firm Profile'::text not null,
  content jsonb not null,
  is_default boolean default false not null,
  created_by text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

-- table: generated_documents
create table public.generated_documents (
  id integer default nextval('generated_documents_id_seq'::regclass) not null,
  template_id integer,
  template_name text not null,
  matter_id text,
  matter_name text,
  client_name text,
  file_name text not null,
  storage_path text not null,
  generated_by text not null,
  generated_by_name text,
  created_at timestamp with time zone default now()
);

-- table: hearings
create table public.hearings (
  notion_id text not null,
  notion_url text default ''::text not null,
  name text default ''::text not null,
  date timestamp with time zone,
  matter_id text,
  matter_name text default ''::text not null,
  type text default ''::text not null,
  status text default ''::text not null,
  notion_last_edited_at timestamp with time zone,
  synced_at timestamp with time zone default now() not null,
  attendee_ids text[] default '{}'::text[] not null,
  related_deliverable_id text,
  is_attended boolean default false not null,
  is_filed boolean default false not null,
  created_time timestamp with time zone
);

-- table: intake_stage_history
create table public.intake_stage_history (
  id bigint default nextval('intake_stage_history_id_seq'::regclass) not null,
  intake_id bigint not null,
  old_stage text not null,
  new_stage text not null,
  changed_by text not null,
  notes text,
  created_at timestamp with time zone default now() not null
);
-- table: intake_submissions
create table public.intake_submissions (
  id bigint generated always as identity not null,
  kind text not null,
  full_name text not null,
  email text not null,
  phone text default ''::text not null,
  company text default ''::text not null,
  message text default ''::text not null,
  details jsonb default '{}'::jsonb not null,
  source_ip text,
  user_agent text,
  status text default 'new'::text not null,
  reviewed_by text,
  reviewed_at timestamp with time zone,
  converted_client_id text,
  created_at timestamp with time zone default now() not null
);

-- table: invoice_number_counters
create table public.invoice_number_counters (
  billing_month text not null,
  last_seq integer default 0 not null
);

-- table: invoice_payments
create table public.invoice_payments (
  id bigint default nextval('invoice_payments_id_seq'::regclass) not null,
  invoice_id integer not null,
  amount numeric(12,2) not null,
  payment_date date not null,
  payment_method text default 'bank_transfer'::text not null,
  reference_number text default ''::text not null,
  notes text default ''::text not null,
  recorded_by text not null,
  created_at timestamp with time zone default now() not null
);

-- table: invoices
create table public.invoices (
  id integer default nextval('invoices_id_seq'::regclass) not null,
  invoice_number text not null,
  client_id text,
  client_name text not null,
  matter_id text,
  matter_name text,
  billing_month text not null,
  total_hours numeric(10,2) default 0 not null,
  total_amount numeric(12,2) default 0 not null,
  total_expenses numeric(12,2) default 0 not null,
  currency text default 'PHP'::text not null,
  status text default 'draft'::text not null,
  docx_storage_path text,
  xlsx_storage_path text,
  pdf_storage_path text,
  generated_by text,
  line_items jsonb default '[]'::jsonb not null,
  expense_items jsonb default '[]'::jsonb not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  sent_date date,
  due_date date,
  paid_date date,
  paid_amount numeric(12,2) default 0 not null,
  notes text default ''::text not null,
  signed_pdf_path text,
  signed_breakdown_pdf_path text,
  onedrive_url text,
  billing_settings jsonb default '{}'::jsonb not null,
  revision_count integer default 0 not null,
  previously_sent_at date,
  fee_lines jsonb default '[]'::jsonb not null,
  breakdown_pdf_storage_path text
);

-- table: issuance_scrape_runs
create table public.issuance_scrape_runs (
  id integer default nextval('issuance_scrape_runs_id_seq'::regclass) not null,
  source text not null,
  started_at timestamp with time zone default now(),
  finished_at timestamp with time zone,
  status text,
  items_found integer default 0,
  items_new integer default 0,
  items_low_conf integer default 0,
  errors integer default 0,
  error_log text
);

-- table: issuances
create table public.issuances (
  id integer default nextval('issuances_id_seq'::regclass) not null,
  source text not null,
  type text not null,
  number text,
  title text not null,
  subject text,
  date_issued date,
  date_effective date,
  summary text,
  full_text text,
  source_url text not null,
  pdf_path text,
  metadata jsonb default '{}'::jsonb,
  practice_areas text[] default ARRAY[]::text[],
  tags text[] default ARRAY[]::text[],
  status text default 'published'::text,
  pinned boolean default false,
  ai_confidence text,
  ai_flags text[] default ARRAY[]::text[],
  added_by text,
  reviewed_by text,
  reviewed_at timestamp with time zone,
  visible_to_roles text[],
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- table: kb_jobs
create table public.kb_jobs (
  id bigint generated always as identity not null,
  kind text not null,
  status text default 'running'::text not null,
  scope jsonb default '{}'::jsonb not null,
  stats jsonb default '{}'::jsonb not null,
  error text,
  started_by text,
  started_at timestamp with time zone default now() not null,
  completed_at timestamp with time zone
);

-- table: kb_page_citations
create table public.kb_page_citations (
  id bigint generated always as identity not null,
  kb_page_id bigint not null,
  source_type text not null,
  source_id text not null,
  matter_id text,
  excerpt text default ''::text not null,
  span_hint text default ''::text not null,
  confidence numeric default 0 not null,
  created_at timestamp with time zone default now() not null
);

-- table: kb_page_matters
create table public.kb_page_matters (
  kb_page_id bigint not null,
  matter_id text not null,
  relevance numeric default 0 not null,
  created_at timestamp with time zone default now() not null
);

-- table: kb_pages
create table public.kb_pages (
  id bigint generated always as identity not null,
  slug text not null,
  kind text not null,
  title text not null,
  content_md text default ''::text not null,
  summary text default ''::text not null,
  jurisdiction text default ''::text not null,
  status text default 'draft'::text not null,
  generated_by text default 'llm'::text not null,
  model_used text,
  author_id text,
  pinned boolean default false not null,
  version integer default 1 not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  last_generated_at timestamp with time zone
);

-- table: knowledge_searches
create table public.knowledge_searches (
  id bigint generated always as identity not null,
  query text not null,
  person_id text not null,
  filter_matter_id text,
  filter_category text,
  result_count integer default 0 not null,
  top_similarity numeric(4,3),
  clicked_source_type text,
  clicked_source_id text,
  created_at timestamp with time zone default now() not null
);

-- table: leaves
create table public.leaves (
  notion_id text not null,
  notion_url text default ''::text not null,
  reason text default ''::text not null,
  person_id text,
  name text default ''::text not null,
  leave_type text default ''::text not null,
  period_start date,
  period_end date,
  status text default ''::text not null,
  approved boolean default false not null,
  acting_partner_ids text[] default '{}'::text[] not null,
  created_by_name text default ''::text not null,
  notion_last_edited_at timestamp with time zone,
  synced_at timestamp with time zone default now() not null,
  created_time timestamp with time zone,
  decided_by text,
  decided_at timestamp with time zone
);
-- table: liaison_tasks
create table public.liaison_tasks (
  id integer default nextval('liaison_tasks_id_seq'::regclass) not null,
  title text not null,
  purpose text default ''::text not null,
  description text default ''::text not null,
  status text default 'pending'::text not null,
  priority text default 'normal'::text not null,
  zone_id integer,
  scheduled_for date,
  due_date date,
  completed_at timestamp with time zone,
  assigned_to text not null,
  assigned_to_name text default ''::text not null,
  assigned_by text not null,
  assigned_by_name text default ''::text not null,
  matter_id text,
  matter_name text default ''::text not null,
  completion_note text default ''::text not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  client_id text,
  client_name text default ''::text not null,
  deliverable_id text,
  deliverable_name text default ''::text not null,
  bill_at_internal boolean default false not null
);

-- table: matter_action_entries
create table public.matter_action_entries (
  id integer default nextval('matter_action_entries_id_seq'::regclass) not null,
  action_id integer not null,
  matter_id text not null,
  entry_date date default ((now() AT TIME ZONE 'Asia/Manila'::text))::date not null,
  quantity integer default 1 not null,
  description text default ''::text not null,
  invoiced boolean default false not null,
  invoice_id integer,
  created_by text default ''::text not null,
  created_at timestamp with time zone default now() not null
);

-- table: matter_billing_actions
create table public.matter_billing_actions (
  id integer default nextval('matter_billing_actions_id_seq'::regclass) not null,
  matter_id text not null,
  name text not null,
  rate numeric(12,2) not null,
  cap integer,
  unit_label text default ''::text not null,
  order_index integer default 0 not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

-- table: matter_billing_configs
create table public.matter_billing_configs (
  id bigint default nextval('matter_billing_configs_id_seq'::regclass) not null,
  matter_id text not null,
  billing_type text not null,
  acceptance_fee numeric(12,2),
  acceptance_fee_paid boolean default false not null,
  monthly_retainer numeric(12,2),
  retainer_hours_cap integer,
  hourly_rate_override numeric(12,2),
  fixed_fee_amount numeric(12,2),
  success_fee_percent numeric(5,2),
  success_fee_amount numeric(12,2),
  engagement_date date,
  engagement_file_path text,
  engagement_file_name text,
  billing_settings jsonb default '{}'::jsonb not null,
  notes text default ''::text not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

-- table: matter_billing_milestones
create table public.matter_billing_milestones (
  id integer default nextval('matter_billing_milestones_id_seq'::regclass) not null,
  matter_id text not null,
  name text not null,
  description text default ''::text not null,
  fee numeric(12,2) not null,
  target_date date,
  reached_at timestamp with time zone,
  reached_by text,
  invoiced boolean default false not null,
  invoice_id integer,
  order_index integer default 0 not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

-- table: matter_exec_summaries
create table public.matter_exec_summaries (
  matter_id text not null,
  overview text,
  current_posture text,
  parties jsonb,
  timeline jsonb,
  key_rulings jsonb,
  open_items jsonb,
  reading_list jsonb,
  model_used text,
  token_count_input integer,
  token_count_output integer,
  generated_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

-- table: matter_expenses
create table public.matter_expenses (
  id bigint default nextval('matter_expenses_id_seq'::regclass) not null,
  matter_id text not null,
  description text not null,
  amount numeric(12,2) not null,
  category text not null,
  expense_date date not null,
  receipt_urls jsonb default '[]'::jsonb not null,
  billed boolean default false not null,
  invoice_id integer,
  created_by text not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  liaison_task_id integer
);

-- table: matter_group_summaries
create table public.matter_group_summaries (
  root_matter_id text not null,
  member_matter_ids text[] default '{}'::text[] not null,
  summary text default ''::text not null,
  posture text,
  parties jsonb,
  key_dates jsonb,
  key_rulings jsonb,
  open_issues jsonb,
  progression_notes text,
  model_used text,
  token_count_input integer,
  token_count_output integer,
  generated_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

-- table: matter_health
create table public.matter_health (
  matter_id text not null,
  score integer,
  tier text,
  signals jsonb,
  narrative text,
  model_used text,
  token_count_input integer,
  token_count_output integer,
  generated_at timestamp with time zone,
  needs_refresh boolean default true not null,
  refresh_requested_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now() not null
);

-- table: matter_sol
create table public.matter_sol (
  id bigint default nextval('matter_sol_id_seq'::regclass) not null,
  matter_id text not null,
  period_id text not null,
  cause_of_action text not null,
  legal_basis text default ''::text,
  accrual_date date not null,
  expiry_date date not null,
  tolling_days integer default 0,
  tolling_notes text default ''::text,
  status text default 'active'::text not null,
  created_by text not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

-- table: matter_summaries
create table public.matter_summaries (
  matter_id text not null,
  summary text not null,
  latest_incident text,
  latest_incident_date text,
  model_used text,
  token_count_input integer,
  token_count_output integer,
  generated_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  brief_version integer default 1 not null,
  key_dates jsonb,
  open_issues jsonb,
  posture text,
  parties jsonb,
  claims_and_defenses jsonb,
  court_and_venue text,
  key_rulings jsonb,
  needs_refresh boolean default false not null,
  refresh_requested_at timestamp with time zone,
  doctrine_tags text[] default '{}'::text[] not null,
  relevant_authorities jsonb
);

-- table: matters
create table public.matters (
  notion_id text not null,
  notion_url text default ''::text not null,
  name text default ''::text not null,
  client_id text,
  client_name text default ''::text not null,
  related_matter_ids text[] default '{}'::text[] not null,
  notion_last_edited_at timestamp with time zone,
  synced_at timestamp with time zone default now() not null,
  matter_code text default ''::text not null,
  team_person_ids text[] default '{}'::text[] not null,
  type text default ''::text not null,
  status text default 'Ongoing'::text not null,
  date date,
  case_title text default ''::text not null,
  case_number text default ''::text not null,
  court text default ''::text not null,
  case_description text default ''::text not null,
  remarks text default ''::text not null,
  outcome text default ''::text not null,
  created_time timestamp with time zone,
  is_case boolean generated always as (((NULLIF(TRIM(BOTH FROM case_title), ''::text) IS NOT NULL) OR (NULLIF(TRIM(BOTH FROM case_number), ''::text) IS NOT NULL))) stored,
  parent_matter_id text,
  parent_matter_name text default ''::text not null,
  last_activity_at timestamp with time zone default now()
);
-- table: meetings
create table public.meetings (
  notion_id text not null,
  notion_url text default ''::text not null,
  name text default ''::text not null,
  date_start timestamp with time zone,
  date_end timestamp with time zone,
  matter_id text,
  matter_name text default ''::text not null,
  type text default ''::text not null,
  attendee_ids text[] default '{}'::text[] not null,
  is_attended boolean default false not null,
  notion_last_edited_at timestamp with time zone,
  synced_at timestamp with time zone default now() not null,
  location text default ''::text not null,
  duration numeric(5,1),
  created_time timestamp with time zone
);

-- table: notification_mutes
create table public.notification_mutes (
  id uuid default gen_random_uuid() not null,
  person_id text not null,
  entity_id text not null,
  label text,
  created_at timestamp with time zone default now() not null
);

-- table: notifications
create table public.notifications (
  id uuid default gen_random_uuid() not null,
  person_id text not null,
  type text not null,
  title text not null,
  body text,
  href text,
  entity_id text,
  read boolean default false not null,
  created_at timestamp with time zone default now() not null,
  priority text default 'action'::text not null
);

-- table: parties
create table public.parties (
  id bigint default nextval('parties_id_seq'::regclass) not null,
  matter_id text not null,
  party_name text default ''::text not null,
  party_role text default 'client'::text not null,
  entity_type text default 'individual'::text not null,
  aliases text[] default '{}'::text[] not null,
  tin text default ''::text not null,
  contact_info text default ''::text not null,
  notes text default ''::text not null,
  source text default 'manual'::text not null,
  source_ref text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

-- table: partner_matter_annotations
create table public.partner_matter_annotations (
  id bigint default nextval('partner_matter_annotations_id_seq'::regclass) not null,
  matter_id text not null,
  partner_id text not null,
  urgency text default 'None'::text not null,
  notes text default ''::text not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

-- table: ph_holidays
create table public.ph_holidays (
  id bigint default nextval('ph_holidays_id_seq'::regclass) not null,
  date date not null,
  name text not null,
  type text default 'special_non_working'::text not null,
  created_at timestamp with time zone default now() not null
);

-- table: pleading_red_team_comments
create table public.pleading_red_team_comments (
  id bigint default nextval('pleading_red_team_comments_id_seq'::regclass) not null,
  red_team_id bigint not null,
  finding_index integer,
  finding_heading text,
  author_id text not null,
  body text not null,
  verdict text,
  created_at timestamp with time zone default now() not null
);

-- table: pleading_red_teams
create table public.pleading_red_teams (
  id bigint default nextval('pleading_red_teams_id_seq'::regclass) not null,
  matter_id text,
  deliverable_id text,
  deliverable_file_id bigint,
  source text default 'upload'::text not null,
  mode text default 'self'::text not null,
  file_name text default ''::text not null,
  storage_path text,
  status text default 'pending'::text not null,
  document_type text,
  overall_risk text,
  weakest_link text,
  opposing_theory text,
  findings jsonb,
  severity_breakdown jsonb,
  finding_count integer,
  adverse_authorities jsonb,
  citation_checks jsonb,
  concessions jsonb,
  claude_file_id text,
  token_count_input integer,
  token_count_output integer,
  model_used text,
  error_message text,
  reviewed_by text not null,
  created_at timestamp with time zone default now() not null,
  completed_at timestamp with time zone,
  adverse_search_available boolean,
  cite_check_available boolean,
  target_source text,
  target_deliverable_id text,
  target_deliverable_file_id bigint,
  target_file_name text,
  target_storage_path text,
  target_document_type text,
  target_digest jsonb,
  response_coverage jsonb
);

-- table: portal_chat_messages
create table public.portal_chat_messages (
  id bigint generated always as identity not null,
  client_user_id uuid not null,
  matter_id text not null,
  role text not null,
  content text not null,
  model_used text,
  created_at timestamp with time zone default now() not null
);

-- table: push_subscriptions
create table public.push_subscriptions (
  id bigint default nextval('push_subscriptions_id_seq'::regclass) not null,
  email text not null,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamp with time zone default now() not null,
  last_used_at timestamp with time zone default now() not null
);

-- table: reimbursements
create table public.reimbursements (
  notion_id text not null,
  notion_url text default ''::text not null,
  expense text default ''::text not null,
  amount numeric(12,2) default 0 not null,
  expense_category text default ''::text not null,
  expense_date date,
  lawyer_ids text[] default '{}'::text[] not null,
  lawyer_name text default ''::text not null,
  matter_id text,
  matter_name text default ''::text not null,
  client_id text,
  client_name text default ''::text not null,
  reimbursed boolean default false not null,
  created_by_name text default ''::text not null,
  notion_last_edited_at timestamp with time zone,
  synced_at timestamp with time zone default now() not null,
  receipt_urls jsonb default '[]'::jsonb not null,
  created_time timestamp with time zone,
  liaison_task_id integer,
  tariff_amount numeric(12,2),
  tariff_override_note text default ''::text not null,
  billed boolean default false not null,
  invoice_id integer
);

-- table: resolution_templates
create table public.resolution_templates (
  id text not null,
  name text not null,
  kind text not null,
  category text not null,
  description text,
  body_template text not null,
  variable_schema jsonb default '[]'::jsonb not null,
  is_active boolean default true not null,
  sort_order integer default 0 not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);
-- table: resolutions
create table public.resolutions (
  id text default (gen_random_uuid())::text not null,
  corporation_id text not null,
  meeting_id text,
  kind text not null,
  title text not null,
  date_of_resolution date not null,
  template_id text,
  variables jsonb default '{}'::jsonb not null,
  free_form_body text,
  generated_file_path text,
  signed_file_path text,
  status text default 'Draft'::text not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  created_by text,
  bundled_resolution_ids text[] default '{}'::text[] not null
);

-- table: resources
create table public.resources (
  id integer default nextval('resources_id_seq'::regclass) not null,
  title text not null,
  slug text not null,
  content text default ''::text not null,
  excerpt text default ''::text not null,
  category text default 'general'::text not null,
  cover_image_path text,
  is_published boolean default false not null,
  pinned boolean default false not null,
  author_id text not null,
  author_name text not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  visible_to_roles text[],
  external_url text
);

-- table: rule_deadlines
create table public.rule_deadlines (
  rule_set_id text not null,
  id text not null,
  label text not null,
  legal_basis text default ''::text not null,
  days_from_trigger integer not null,
  calendar_type text not null,
  depends_on text,
  entity_type text not null,
  hearing_type text,
  is_reglementary boolean default false not null,
  notes text default ''::text not null,
  sort_order integer default 0 not null
);

-- table: rule_sets
create table public.rule_sets (
  id text not null,
  name text not null,
  trigger_event_label text not null,
  applicable_matter_types text[] default '{}'::text[] not null,
  is_system_default boolean default false not null,
  created_by text,
  updated_at timestamp with time zone default now() not null
);

-- table: saved_reports
create table public.saved_reports (
  id uuid default gen_random_uuid() not null,
  name text not null,
  entity text not null,
  filters jsonb default '[]'::jsonb not null,
  columns text[] not null,
  group_by text,
  shared_scope text default 'private'::text not null,
  owner_id text not null,
  sort_order integer default 0 not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

-- table: scope_templates
create table public.scope_templates (
  id uuid default gen_random_uuid() not null,
  slug text not null,
  name text not null,
  content jsonb not null,
  is_active boolean default true not null,
  sort_order integer default 0 not null,
  created_by text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

-- table: sla_breaches
create table public.sla_breaches (
  id uuid default gen_random_uuid() not null,
  deliverable_id text not null,
  rule_id uuid not null,
  breach_type text not null,
  severity text default 'normal'::text not null,
  detected_at timestamp with time zone default now() not null,
  resolved_at timestamp with time zone,
  action_taken jsonb
);

-- table: sla_rules
create table public.sla_rules (
  id uuid default gen_random_uuid() not null,
  name text not null,
  description text,
  applies_to_matter_type text,
  applies_to_deliverable_type text,
  condition jsonb default '{}'::jsonb not null,
  action jsonb default '{}'::jsonb not null,
  is_active boolean default true not null,
  sort_order integer default 0 not null,
  created_at timestamp with time zone default now() not null,
  created_by text,
  updated_at timestamp with time zone default now() not null
);

-- table: sync_log
create table public.sync_log (
  id integer default nextval('sync_log_id_seq'::regclass) not null,
  table_name text not null,
  started_at timestamp with time zone default now() not null,
  finished_at timestamp with time zone,
  status text default 'running'::text not null,
  pages_synced integer default 0,
  error_message text,
  last_edited_cursor timestamp with time zone
);

-- table: tasks
create table public.tasks (
  notion_id text not null,
  notion_url text default ''::text not null,
  name text default ''::text not null,
  matter_id text,
  matter_name text default ''::text not null,
  due_date date,
  status text default ''::text not null,
  priority text default ''::text not null,
  done boolean default false not null,
  assignee_ids text[] default '{}'::text[] not null,
  notion_last_edited_at timestamp with time zone,
  synced_at timestamp with time zone default now() not null,
  notes text default ''::text not null,
  created_time timestamp with time zone
);

-- table: team
create table public.team (
  notion_id text not null,
  person_id text,
  initials text default ''::text not null,
  "position" text default ''::text not null,
  active boolean default false not null,
  ongoing_matters text default '0'::text not null,
  notion_last_edited_at timestamp with time zone,
  synced_at timestamp with time zone default now() not null,
  name text default ''::text not null,
  email text default ''::text not null,
  mobile_number text default ''::text not null,
  start_date date,
  role text default 'lawyer'::text not null,
  created_time timestamp with time zone,
  signature_url text default ''::text not null,
  microsoft_user_id text,
  calendar_sync_enabled boolean default false not null,
  monthly_salary numeric(12,2),
  bonus_profile text default 'standard'::text not null,
  is_external boolean default false not null,
  end_date date,
  nickname text default ''::text not null,
  avatar_url text default ''::text not null,
  auth_user_id uuid,
  telegram_user_id text,
  headshot_url text
);

-- table: telegram_link_codes
create table public.telegram_link_codes (
  code text not null,
  person_id text not null,
  created_at timestamp with time zone default now() not null,
  expires_at timestamp with time zone not null,
  consumed_at timestamp with time zone
);

-- table: telegram_messages
create table public.telegram_messages (
  id bigint default nextval('telegram_messages_id_seq'::regclass) not null,
  chat_id text not null,
  person_id text,
  role text not null,
  content text not null,
  created_at timestamp with time zone default now() not null
);
-- table: trademark_client_reports
create table public.trademark_client_reports (
  id integer default nextval('trademark_client_reports_id_seq'::regclass) not null,
  trademark_id text not null,
  deadline_kind text not null,
  deadline_due date not null,
  sent_at timestamp with time zone default now() not null,
  sent_by text not null,
  recipient_email text not null,
  cc_emails text[] default '{}'::text[] not null,
  subject text not null,
  body_html text not null,
  graph_message_id text,
  notes text,
  attachment_paths text[] default '{}'::text[] not null
);

-- table: trademark_files
create table public.trademark_files (
  id integer default nextval('trademark_files_id_seq'::regclass) not null,
  trademark_id text not null,
  name text not null,
  storage_path text not null,
  mime_type text,
  size_bytes bigint,
  uploaded_by text,
  uploaded_at timestamp with time zone default now() not null
);

-- table: trademarks
create table public.trademarks (
  id text default (gen_random_uuid())::text not null,
  matter_id text,
  client_id text,
  client_name text default ''::text not null,
  matter_name text default ''::text not null,
  mark text not null,
  type text,
  classes integer[] default '{}'::integer[] not null,
  country text default 'PH'::text not null,
  owner text,
  contact_email text,
  reg_ir_no text,
  client_code integer,
  client_index integer default 0 not null,
  mark_image_path text,
  gpoa_status text default 'To Follow'::text not null,
  gpoa_filed_date date,
  gpoa_file_path text,
  status text default 'Prelim'::text not null,
  filing_date date,
  new_app_reported boolean default false not null,
  noi_date date,
  noi_payment_date date,
  noa_reported boolean default false not null,
  reg_date date,
  cor_reported_date date,
  oa_receipt_date date,
  oa_reported boolean default false not null,
  oa_response_filed_date date,
  oa_motex boolean default false not null,
  dau_3_filing_date date,
  dau_3_motex boolean default false not null,
  dau_5_filing_date date,
  renewal_filing_date date,
  renewal_dau_filed_date date,
  nudge_1 boolean default false not null,
  nudge_2 boolean default false not null,
  nudge_3 boolean default false not null,
  notes text,
  billing_instructions text,
  last_incident text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  created_by text,
  renewal_dau_5_filed_date date
);

-- table: transportation_zones
create table public.transportation_zones (
  id integer default nextval('transportation_zones_id_seq'::regclass) not null,
  name text not null,
  round_trip_rate numeric(12,2) default 0 not null,
  notes text default ''::text not null,
  active boolean default true not null,
  updated_by text,
  updated_by_name text default ''::text not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  external_rate numeric(12,2) default 0 not null
);

-- table: user_passwords
create table public.user_passwords (
  id bigint default nextval('user_passwords_id_seq'::regclass) not null,
  email text not null,
  password_hash text not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

-- table: user_preferences
create table public.user_preferences (
  email text not null,
  notify_deadlines boolean default true not null,
  notify_hearings boolean default true not null,
  notify_new_deliverables boolean default true not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  notify_email_briefer boolean default true not null,
  notify_meetings boolean default true not null,
  notify_emails boolean default true not null,
  notify_deliverable_transfer_email boolean default true not null,
  notify_status_changes_watching boolean default false not null,
  notify_push_enabled boolean default false not null,
  notify_chat boolean default true not null,
  notify_meeting_attendee_email boolean default true not null,
  notify_hearing_attendee_email boolean default true not null,
  notify_sla_breach boolean default true not null
);

-- ───────────────── 01_sequences (ownership) ─────────────────
-- ownership (run after tables are created)
alter sequence public.affidavit_review_comments_id_seq owned by public.affidavit_review_comments.id;
alter sequence public.affidavit_reviews_id_seq owned by public.affidavit_reviews.id;
alter sequence public.assistant_messages_id_seq owned by public.assistant_messages.id;
alter sequence public.audit_log_id_seq owned by public.audit_log.id;
alter sequence public.billing_rates_id_seq owned by public.billing_rates.id;
alter sequence public.calendar_sync_events_id_seq owned by public.calendar_sync_events.id;
alter sequence public.client_deposits_id_seq owned by public.client_deposits.id;
alter sequence public.client_intakes_id_seq owned by public.client_intakes.id;
alter sequence public.client_partner_notes_id_seq owned by public.client_partner_notes.id;
alter sequence public.corporation_files_id_seq owned by public.corporation_files.id;
alter sequence public.corporation_persons_id_seq owned by public.corporation_persons.id;
alter sequence public.deadline_chain_items_id_seq owned by public.deadline_chain_items.id;
alter sequence public.deadline_chains_id_seq owned by public.deadline_chains.id;
alter sequence public.deliverable_actions_id_seq owned by public.deliverable_actions.id;
alter sequence public.deliverable_comment_reactions_id_seq owned by public.deliverable_comment_reactions.id;
alter sequence public.deliverable_comments_id_seq owned by public.deliverable_comments.id;
alter sequence public.deliverable_files_id_seq owned by public.deliverable_files.id;
alter sequence public.deliverable_version_reactions_id_seq owned by public.deliverable_version_reactions.id;
alter sequence public.document_templates_id_seq owned by public.document_templates.id;
alter sequence public.dtr_revision_comments_id_seq owned by public.dtr_revision_comments.id;
alter sequence public.dtr_revision_reviews_id_seq owned by public.dtr_revision_reviews.id;
alter sequence public.dtr_revisions_id_seq owned by public.dtr_revisions.id;
alter sequence public.email_attachments_id_seq owned by public.email_attachments.id;
alter sequence public.email_mailboxes_id_seq owned by public.email_mailboxes.id;
alter sequence public.email_matter_links_id_seq owned by public.email_matter_links.id;
alter sequence public.email_templates_id_seq owned by public.email_templates.id;
alter sequence public.emails_id_seq owned by public.emails.id;
alter sequence public.entity_comment_reactions_id_seq owned by public.entity_comment_reactions.id;
alter sequence public.entity_comments_id_seq owned by public.entity_comments.id;
alter sequence public.enum_options_id_seq owned by public.enum_options.id;
alter sequence public.file_analyses_id_seq owned by public.file_analyses.id;
alter sequence public.firm_expense_templates_id_seq owned by public.firm_expense_templates.id;
alter sequence public.firm_expenses_id_seq owned by public.firm_expenses.id;
alter sequence public.generated_documents_id_seq owned by public.generated_documents.id;
alter sequence public.intake_stage_history_id_seq owned by public.intake_stage_history.id;
alter sequence public.invoice_payments_id_seq owned by public.invoice_payments.id;
alter sequence public.invoices_id_seq owned by public.invoices.id;
alter sequence public.issuance_scrape_runs_id_seq owned by public.issuance_scrape_runs.id;
alter sequence public.issuances_id_seq owned by public.issuances.id;
alter sequence public.liaison_tasks_id_seq owned by public.liaison_tasks.id;
alter sequence public.matter_action_entries_id_seq owned by public.matter_action_entries.id;
alter sequence public.matter_billing_actions_id_seq owned by public.matter_billing_actions.id;
alter sequence public.matter_billing_configs_id_seq owned by public.matter_billing_configs.id;
alter sequence public.matter_billing_milestones_id_seq owned by public.matter_billing_milestones.id;
alter sequence public.matter_expenses_id_seq owned by public.matter_expenses.id;
alter sequence public.matter_sol_id_seq owned by public.matter_sol.id;
alter sequence public.parties_id_seq owned by public.parties.id;
alter sequence public.partner_matter_annotations_id_seq owned by public.partner_matter_annotations.id;
alter sequence public.ph_holidays_id_seq owned by public.ph_holidays.id;
alter sequence public.pleading_red_team_comments_id_seq owned by public.pleading_red_team_comments.id;
alter sequence public.pleading_red_teams_id_seq owned by public.pleading_red_teams.id;
alter sequence public.push_subscriptions_id_seq owned by public.push_subscriptions.id;
alter sequence public.resources_id_seq owned by public.resources.id;
alter sequence public.sync_log_id_seq owned by public.sync_log.id;
alter sequence public.telegram_messages_id_seq owned by public.telegram_messages.id;
alter sequence public.trademark_client_reports_id_seq owned by public.trademark_client_reports.id;
alter sequence public.trademark_files_id_seq owned by public.trademark_files.id;
alter sequence public.transportation_zones_id_seq owned by public.transportation_zones.id;
alter sequence public.user_passwords_id_seq owned by public.user_passwords.id;

-- ───────────────── 05_functions ─────────────────
set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.allocate_client_code()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_code integer;
  v_max integer;
begin
  if public."current_role"() is null and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'allocate_client_code: caller is not authorized'
      using errcode = '42501';
  end if;

  select coalesce(max(client_code), 0) into v_max from public.clients;

  insert into public.client_code_counters as c (scope, last_code)
  values ('global', v_max + 1)
  on conflict (scope)
    do update set last_code = greatest(c.last_code, v_max) + 1
  returning c.last_code into v_code;

  return v_code;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.allocate_invoice_number(p_month text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_seq integer;
  v_max integer;
begin
  if public."current_role"() is null and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'allocate_invoice_number: caller is not authorized'
      using errcode = '42501';
  end if;

  select coalesce(max((regexp_replace(invoice_number, '^INV-\d{4}-\d{2}-', ''))::int), 0)
    into v_max
  from public.invoices
  where billing_month = p_month
    and invoice_number ~ '^INV-\d{4}-\d{2}-\d+$';

  insert into public.invoice_number_counters as c (billing_month, last_seq)
  values (p_month, v_max + 1)
  on conflict (billing_month)
    do update set last_seq = greatest(c.last_seq, v_max) + 1
  returning c.last_seq into v_seq;

  return 'INV-' || p_month || '-' || lpad(v_seq::text, 3, '0');
end;
$function$
;

CREATE OR REPLACE FUNCTION public.break_status_report_links_on_archive()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.status = 'Archived' AND (OLD.status IS DISTINCT FROM 'Archived') THEN
    IF NEW.type = 'Status Report' THEN
      UPDATE deliverables
      SET related_hearing_id = NULL,
          source_deliverable_id = NULL,
          source_file_id = NULL
      WHERE notion_id = NEW.notion_id;
    END IF;

    UPDATE deliverables
    SET source_deliverable_id = NULL
    WHERE source_deliverable_id = NEW.notion_id
      AND type = 'Status Report';
  END IF;

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.call_app_api(path text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  base_url text;
  secret text;
BEGIN
  SELECT decrypted_secret INTO base_url FROM vault.decrypted_secrets WHERE name = 'app_base_url' LIMIT 1;
  SELECT decrypted_secret INTO secret FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1;
  RETURN net.http_get(
    url := base_url || path,
    headers := jsonb_build_object('Authorization', 'Bearer ' || secret)
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.call_app_api_post(path text, body jsonb DEFAULT '{}'::jsonb)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  base_url text;
  secret text;
BEGIN
  SELECT decrypted_secret INTO base_url FROM vault.decrypted_secrets WHERE name = 'app_base_url' LIMIT 1;
  SELECT decrypted_secret INTO secret FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1;
  RETURN net.http_post(
    url := base_url || path,
    headers := jsonb_build_object('Authorization', 'Bearer ' || secret, 'Content-Type', 'application/json'),
    body := body
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.can_access_email(p_email_id bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT
    public.current_person_id() IS NOT NULL
    AND (
      EXISTS (
        SELECT 1
        FROM public.emails e
        JOIN public.email_mailboxes mb ON mb.id = e.mailbox_id
        WHERE e.id = p_email_id
          AND (
            mb.mailbox_type = 'shared'
            OR mb.owner_person_id = public.current_person_id()
          )
      )
      OR EXISTS (
        SELECT 1 FROM public.email_matter_links l
        WHERE l.email_id = p_email_id
          AND public.has_matter_access(l.matter_id)
      )
    );
$function$
;

CREATE OR REPLACE FUNCTION public.chat_unread_counts(person_ids text[])
 RETURNS TABLE(person_id text, unread bigint)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT
    p.pid AS person_id,
    COUNT(m.id) AS unread
  FROM unnest(person_ids) AS p(pid)
  JOIN chat_channels c ON c.member_ids @> ARRAY[p.pid]
  JOIN chat_messages m
    ON m.channel_id = c.id
    AND m.sender_id <> p.pid
    AND m.deleted_at IS NULL
  LEFT JOIN chat_read_receipts r
    ON r.person_id = p.pid
    AND r.channel_id = c.id
  WHERE m.created_at > COALESCE(r.last_read_at, 'epoch'::timestamptz)
  GROUP BY p.pid;
$function$
;

CREATE OR REPLACE FUNCTION public.check_client_name_conflicts(check_names text[], similarity_threshold double precision DEFAULT 0.3)
 RETURNS TABLE(client_id text, client_name text, full_company_name text, input_name text, similarity_score double precision, match_type text)
 LANGUAGE plpgsql
 STABLE
AS $function$
BEGIN
  RETURN QUERY
  SELECT c.notion_id, c.name, c.full_company_name,
         cn.name AS input_name,
         GREATEST(
           similarity(lower(c.name), lower(cn.name)),
           CASE WHEN c.full_company_name != '' THEN similarity(lower(c.full_company_name), lower(cn.name)) ELSE 0 END
         )::FLOAT AS similarity_score,
         CASE
           WHEN lower(trim(c.name)) = lower(trim(cn.name)) THEN 'exact'
           WHEN c.full_company_name != '' AND lower(trim(c.full_company_name)) = lower(trim(cn.name)) THEN 'exact'
           ELSE 'fuzzy'
         END::TEXT AS match_type
  FROM clients c
  CROSS JOIN unnest(check_names) AS cn(name)
  WHERE c.name % cn.name
     OR (c.full_company_name != '' AND c.full_company_name % cn.name)
  ORDER BY similarity_score DESC;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.check_name_conflicts(check_names text[], similarity_threshold double precision DEFAULT 0.3, max_results integer DEFAULT 50)
 RETURNS TABLE(matched_party_id bigint, matched_party_name text, matched_party_role text, matched_matter_id text, matched_matter_name text, matched_client_name text, input_name text, similarity_score double precision, match_type text)
 LANGUAGE plpgsql
 STABLE
AS $function$
BEGIN
  RETURN QUERY
  -- Exact name matches
  SELECT p.id, p.party_name, p.party_role, p.matter_id,
         m.name, m.client_name,
         cn.name AS input_name,
         1.0::FLOAT AS similarity_score,
         'exact'::TEXT AS match_type
  FROM parties p
  JOIN matters m ON m.notion_id = p.matter_id
  CROSS JOIN unnest(check_names) AS cn(name)
  WHERE lower(trim(p.party_name)) = lower(trim(cn.name))

  UNION ALL

  -- Fuzzy name matches (trigram similarity)
  SELECT p.id, p.party_name, p.party_role, p.matter_id,
         m.name, m.client_name,
         cn.name AS input_name,
         similarity(lower(p.party_name), lower(cn.name))::FLOAT AS similarity_score,
         'fuzzy'::TEXT AS match_type
  FROM parties p
  JOIN matters m ON m.notion_id = p.matter_id
  CROSS JOIN unnest(check_names) AS cn(name)
  WHERE p.party_name % cn.name
    AND lower(trim(p.party_name)) != lower(trim(cn.name))
    AND similarity(lower(p.party_name), lower(cn.name)) >= similarity_threshold

  UNION ALL

  -- Alias matches
  SELECT p.id, p.party_name, p.party_role, p.matter_id,
         m.name, m.client_name,
         cn.name AS input_name,
         similarity(lower(alias), lower(cn.name))::FLOAT AS similarity_score,
         'alias'::TEXT AS match_type
  FROM parties p
  JOIN matters m ON m.notion_id = p.matter_id
  CROSS JOIN unnest(check_names) AS cn(name),
       unnest(p.aliases) AS alias
  WHERE alias % cn.name
    AND similarity(lower(alias), lower(cn.name)) >= similarity_threshold

  ORDER BY similarity_score DESC
  LIMIT max_results;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.clear_status_report_source_file_on_delete()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  UPDATE deliverables
  SET source_file_id = NULL
  WHERE source_file_id = OLD.notion_id
    AND type = 'Status Report';
  RETURN OLD;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.client_last_activity()
 RETURNS TABLE(client_id text, last_activity timestamp with time zone)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH activity(cid, ts) AS (
    SELECT client_id, created_time FROM matters
    UNION ALL
    SELECT client_id, sent_date::timestamptz FROM invoices
      WHERE status IN ('sent','partial','paid')
    UNION ALL
    SELECT i.client_id, p.payment_date::timestamptz
      FROM invoice_payments p JOIN invoices i ON i.id = p.invoice_id
    UNION ALL
    SELECT m.client_id, d.date::timestamptz
      FROM dtr d JOIN matters m ON m.notion_id = d.matter_id
    UNION ALL
    SELECT m.client_id, d.notion_last_edited_at
      FROM dtr d JOIN matters m ON m.notion_id = d.matter_id
    UNION ALL
    SELECT m.client_id, del.notion_last_edited_at
      FROM deliverables del JOIN matters m ON m.notion_id = del.matter_id
    UNION ALL
    SELECT m.client_id, h.date
      FROM hearings h JOIN matters m ON m.notion_id = h.matter_id
    UNION ALL
    SELECT m.client_id, h.notion_last_edited_at
      FROM hearings h JOIN matters m ON m.notion_id = h.matter_id
    UNION ALL
    SELECT m.client_id, mt.date_start
      FROM meetings mt JOIN matters m ON m.notion_id = mt.matter_id
    UNION ALL
    SELECT m.client_id, mt.notion_last_edited_at
      FROM meetings mt JOIN matters m ON m.notion_id = mt.matter_id
    UNION ALL
    SELECT m.client_id, t.notion_last_edited_at
      FROM tasks t JOIN matters m ON m.notion_id = t.matter_id
    UNION ALL
    SELECT m.client_id, f.date::timestamptz
      FROM filings f JOIN matters m ON m.notion_id = f.matter_id
  )
  SELECT cid AS client_id, MAX(ts) AS last_activity
  FROM activity
  WHERE cid IS NOT NULL
    AND ts IS NOT NULL
    AND ts <= now()
  GROUP BY cid;
$function$
;

CREATE OR REPLACE FUNCTION public.clients_normalize_name()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN IF NEW.name IS NOT NULL THEN NEW.name := public.normalize_client_name(NEW.name); END IF; RETURN NEW; END; $function$
;

CREATE OR REPLACE FUNCTION public.corporations_derive_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if new.status = 'Dissolved' then
    return new;
  end if;

  if new.sec_registration_date is not null then
    if new.bir_cor_date is not null
       and (nullif(btrim(coalesce(new.business_permit_no, '')), '') is not null
            or new.business_permit_issued_date is not null)
    then
      new.status := 'Active';
    else
      new.status := 'Registered';
    end if;
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.current_email()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$ SELECT email FROM public.team WHERE auth_user_id = auth.uid() AND active LIMIT 1 $function$
;

CREATE OR REPLACE FUNCTION public.current_person_id()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$ SELECT person_id FROM public.team WHERE auth_user_id = auth.uid() AND active LIMIT 1 $function$
;

CREATE OR REPLACE FUNCTION public.current_person_identifiers()
 RETURNS text[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$ SELECT ARRAY[person_id, notion_id] FROM public.team WHERE auth_user_id = auth.uid() AND active LIMIT 1 $function$
;

CREATE OR REPLACE FUNCTION public.current_person_name()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$ SELECT name FROM public.team WHERE auth_user_id = auth.uid() AND active LIMIT 1 $function$
;

CREATE OR REPLACE FUNCTION public."current_role"()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$ SELECT role FROM public.team WHERE auth_user_id = auth.uid() AND active LIMIT 1 $function$
;

CREATE OR REPLACE FUNCTION public.deliverables_set_last_edited()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.notion_last_edited_at IS NOT DISTINCT FROM OLD.notion_last_edited_at THEN
    NEW.notion_last_edited_at := now();
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.dtr_set_non_billable()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.non_billable := COALESCE(NEW.remarks, '') ILIKE 'Status Report%';
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.dtr_set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.enum_options_touch_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.exhibits_set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.get_unbilled_client_names()
 RETURNS TABLE(client_name text)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT DISTINCT client_name
  FROM dtr
  WHERE billed = false
    AND client_name IS NOT NULL
    AND client_name != ''
  ORDER BY client_name;
$function$
;

CREATE OR REPLACE FUNCTION public.global_search(search_term text, max_per_type integer DEFAULT 5)
 RETURNS TABLE(entity_type text, id text, name text, subtitle text, route text)
 LANGUAGE sql
 STABLE
AS $function$
  WITH ranked AS (
    -- Matters
    SELECT
      'matters'::text AS entity_type,
      notion_id AS id,
      m.name,
      concat_ws(' · ', m.matter_code, m.client_name) AS subtitle,
      '/dashboard/matters/' || notion_id AS route,
      CASE WHEN m.name ILIKE '%' || search_term || '%'
           OR m.matter_code ILIKE '%' || search_term || '%'
           OR m.client_name ILIKE '%' || search_term || '%'
        THEN 1 ELSE 0 END AS is_exact,
      GREATEST(
        similarity(COALESCE(m.name, ''), search_term),
        similarity(COALESCE(m.matter_code, ''), search_term),
        similarity(COALESCE(m.client_name, ''), search_term)
      ) AS sim
    FROM matters m
    WHERE m.name ILIKE '%' || search_term || '%'
       OR m.matter_code ILIKE '%' || search_term || '%'
       OR m.client_name ILIKE '%' || search_term || '%'
       OR similarity(COALESCE(m.name, ''), search_term) > 0.25
       OR similarity(COALESCE(m.matter_code, ''), search_term) > 0.25
       OR similarity(COALESCE(m.client_name, ''), search_term) > 0.25

    UNION ALL

    SELECT
      'clients'::text,
      notion_id,
      c.name,
      COALESCE(c.client_code::text, ''),
      '/dashboard/clients/' || notion_id,
      CASE WHEN c.name ILIKE '%' || search_term || '%'
           OR c.client_code::text ILIKE '%' || search_term || '%'
        THEN 1 ELSE 0 END,
      GREATEST(
        similarity(COALESCE(c.name, ''), search_term),
        similarity(COALESCE(c.client_code::text, ''), search_term)
      )
    FROM clients c
    WHERE c.name ILIKE '%' || search_term || '%'
       OR c.client_code::text ILIKE '%' || search_term || '%'
       OR similarity(COALESCE(c.name, ''), search_term) > 0.25
       OR similarity(COALESCE(c.client_code::text, ''), search_term) > 0.25

    UNION ALL

    -- Deliverables (exclude archived)
    SELECT
      'deliverables'::text,
      notion_id,
      d.name,
      concat_ws(' · ', d.matter_name, d.client_name),
      '/dashboard/deliverables/' || notion_id,
      CASE WHEN d.name ILIKE '%' || search_term || '%'
           OR d.matter_name ILIKE '%' || search_term || '%'
           OR d.client_name ILIKE '%' || search_term || '%'
        THEN 1 ELSE 0 END,
      GREATEST(
        similarity(COALESCE(d.name, ''), search_term),
        similarity(COALESCE(d.matter_name, ''), search_term),
        similarity(COALESCE(d.client_name, ''), search_term)
      )
    FROM deliverables d
    WHERE d.status <> 'Archived'
      AND (
          d.name ILIKE '%' || search_term || '%'
       OR d.matter_name ILIKE '%' || search_term || '%'
       OR d.client_name ILIKE '%' || search_term || '%'
       OR similarity(COALESCE(d.name, ''), search_term) > 0.25
       OR similarity(COALESCE(d.matter_name, ''), search_term) > 0.25
       OR similarity(COALESCE(d.client_name, ''), search_term) > 0.25
      )

    UNION ALL

    SELECT
      'tasks'::text,
      notion_id,
      t.name,
      COALESCE(t.matter_name, ''),
      '/dashboard/tasks/' || notion_id,
      CASE WHEN t.name ILIKE '%' || search_term || '%'
           OR t.matter_name ILIKE '%' || search_term || '%'
        THEN 1 ELSE 0 END,
      GREATEST(
        similarity(COALESCE(t.name, ''), search_term),
        similarity(COALESCE(t.matter_name, ''), search_term)
      )
    FROM tasks t
    WHERE t.name ILIKE '%' || search_term || '%'
       OR t.matter_name ILIKE '%' || search_term || '%'
       OR similarity(COALESCE(t.name, ''), search_term) > 0.25
       OR similarity(COALESCE(t.matter_name, ''), search_term) > 0.25

    UNION ALL

    SELECT
      'meetings'::text,
      notion_id,
      mt.name,
      concat_ws(' · ', mt.type, mt.matter_name),
      '/dashboard/meetings/' || notion_id,
      CASE WHEN mt.name ILIKE '%' || search_term || '%'
           OR mt.matter_name ILIKE '%' || search_term || '%'
        THEN 1 ELSE 0 END,
      GREATEST(
        similarity(COALESCE(mt.name, ''), search_term),
        similarity(COALESCE(mt.matter_name, ''), search_term)
      )
    FROM meetings mt
    WHERE mt.name ILIKE '%' || search_term || '%'
       OR mt.matter_name ILIKE '%' || search_term || '%'
       OR similarity(COALESCE(mt.name, ''), search_term) > 0.25
       OR similarity(COALESCE(mt.matter_name, ''), search_term) > 0.25

    UNION ALL

    SELECT
      'hearings'::text,
      notion_id,
      h.name,
      COALESCE(h.matter_name, ''),
      '/dashboard/hearings/' || notion_id,
      CASE WHEN h.name ILIKE '%' || search_term || '%'
           OR h.matter_name ILIKE '%' || search_term || '%'
        THEN 1 ELSE 0 END,
      GREATEST(
        similarity(COALESCE(h.name, ''), search_term),
        similarity(COALESCE(h.matter_name, ''), search_term)
      )
    FROM hearings h
    WHERE h.name ILIKE '%' || search_term || '%'
       OR h.matter_name ILIKE '%' || search_term || '%'
       OR similarity(COALESCE(h.name, ''), search_term) > 0.25
       OR similarity(COALESCE(h.matter_name, ''), search_term) > 0.25

    UNION ALL

    -- Filings (view on deliverables — exclude archived)
    SELECT
      'filings'::text,
      notion_id,
      f.name,
      COALESCE(f.matter_name, ''),
      '/dashboard/filings/' || notion_id,
      CASE WHEN f.name ILIKE '%' || search_term || '%'
           OR f.matter_name ILIKE '%' || search_term || '%'
        THEN 1 ELSE 0 END,
      GREATEST(
        similarity(COALESCE(f.name, ''), search_term),
        similarity(COALESCE(f.matter_name, ''), search_term)
      )
    FROM filings f
    WHERE f.status <> 'Archived'
      AND (
          f.name ILIKE '%' || search_term || '%'
       OR f.matter_name ILIKE '%' || search_term || '%'
       OR similarity(COALESCE(f.name, ''), search_term) > 0.25
       OR similarity(COALESCE(f.matter_name, ''), search_term) > 0.25
      )

    UNION ALL

    SELECT
      'files'::text,
      notion_id,
      fl.name,
      COALESCE(fl.matter_name, ''),
      '/dashboard/files/' || notion_id,
      CASE WHEN fl.name ILIKE '%' || search_term || '%'
           OR fl.matter_name ILIKE '%' || search_term || '%'
        THEN 1 ELSE 0 END,
      GREATEST(
        similarity(COALESCE(fl.name, ''), search_term),
        similarity(COALESCE(fl.matter_name, ''), search_term)
      )
    FROM files fl
    WHERE fl.name ILIKE '%' || search_term || '%'
       OR fl.matter_name ILIKE '%' || search_term || '%'
       OR similarity(COALESCE(fl.name, ''), search_term) > 0.25
       OR similarity(COALESCE(fl.matter_name, ''), search_term) > 0.25
  ),
  numbered AS (
    SELECT *,
      ROW_NUMBER() OVER (
        PARTITION BY entity_type
        ORDER BY is_exact DESC, sim DESC
      ) AS rn
    FROM ranked
  )
  SELECT entity_type, id, name, subtitle, route
  FROM numbered
  WHERE rn <= max_per_type
  ORDER BY entity_type, is_exact DESC, sim DESC;
$function$
;

CREATE OR REPLACE FUNCTION public.has_matter_access(p_matter_id text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT
    EXISTS (
      SELECT 1 FROM public.matters m
      WHERE m.notion_id = p_matter_id
        AND public.current_person_id() = ANY(m.team_person_ids)
    )
    OR public.current_role() IN ('partner','admin','super_user','finance','chief_liaison_officer','liaison_officer');
$function$
;

CREATE OR REPLACE FUNCTION public.match_embeddings(query_embedding vector, match_count integer DEFAULT 10, match_threshold double precision DEFAULT 0.3, filter_matter_id text DEFAULT NULL::text)
 RETURNS TABLE(id bigint, source_type text, source_id text, matter_id text, chunk_index integer, chunk_text text, metadata jsonb, similarity double precision)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT
    e.id,
    e.source_type,
    e.source_id,
    e.matter_id,
    e.chunk_index,
    e.chunk_text,
    e.metadata,
    1 - (e.embedding <=> query_embedding) AS similarity
  FROM public.embeddings e
  WHERE
    (filter_matter_id IS NULL OR e.matter_id = filter_matter_id)
    AND 1 - (e.embedding <=> query_embedding) > match_threshold
  ORDER BY e.embedding <=> query_embedding
  LIMIT match_count;
$function$
;

CREATE OR REPLACE FUNCTION public.match_embeddings_by_type(query_embedding vector, p_source_types text[], match_count integer DEFAULT 10, match_threshold double precision DEFAULT 0.25, filter_matter_id text DEFAULT NULL::text, p_meta_kinds text[] DEFAULT NULL::text[])
 RETURNS TABLE(id bigint, source_type text, source_id text, matter_id text, chunk_index integer, chunk_text text, metadata jsonb, similarity double precision)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT
    e.id, e.source_type, e.source_id, e.matter_id,
    e.chunk_index, e.chunk_text, e.metadata,
    1 - (e.embedding <=> query_embedding) AS similarity
  FROM public.embeddings e
  WHERE
    e.source_type = ANY(p_source_types)
    AND (filter_matter_id IS NULL OR e.matter_id = filter_matter_id)
    AND (p_meta_kinds IS NULL OR e.metadata->>'kind' = ANY(p_meta_kinds))
    AND 1 - (e.embedding <=> query_embedding) > match_threshold
  ORDER BY e.embedding <=> query_embedding
  LIMIT match_count;
$function$
;

CREATE OR REPLACE FUNCTION public.matter_group_members(seed_id text)
 RETURNS SETOF text
 LANGUAGE sql
 STABLE
AS $function$
  WITH RECURSIVE walk(id) AS (
    SELECT notion_id FROM matters WHERE notion_id = seed_id
    UNION
    SELECT neighbor.id
    FROM walk w
    CROSS JOIN LATERAL (
      SELECT unnest(m.related_matter_ids) AS id
      FROM matters m
      WHERE m.notion_id = w.id
      UNION
      SELECT m.notion_id AS id
      FROM matters m
      WHERE w.id = ANY(m.related_matter_ids)
    ) AS neighbor
  )
  SELECT DISTINCT id FROM walk;
$function$
;

CREATE OR REPLACE FUNCTION public.matters_recalc_client_status_trg()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.recalc_client_status(OLD.client_id);
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.client_id IS DISTINCT FROM NEW.client_id THEN
    PERFORM public.recalc_client_status(OLD.client_id);
  END IF;
  PERFORM public.recalc_client_status(NEW.client_id);
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.normalize_client_name(p_name text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
  SELECT pg_catalog.btrim(p_name,
    chr(9)||chr(10)||chr(11)||chr(12)||chr(13)||chr(32)||chr(160)||chr(5760)
    ||chr(8192)||chr(8193)||chr(8194)||chr(8195)||chr(8196)||chr(8197)||chr(8198)
    ||chr(8199)||chr(8200)||chr(8201)||chr(8202)||chr(8232)||chr(8233)||chr(8239)
    ||chr(8287)||chr(12288)||chr(65279))
$function$
;

CREATE OR REPLACE FUNCTION public.notification_priority(p_type text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select case p_type
    when 'status_change'    then 'fyi'
    when 'leave_request'    then 'fyi'
    when 'feedback'         then 'fyi'
    when 'intake'           then 'fyi'
    when 'engagement_signed' then 'fyi'
    when 'client_upload'    then 'fyi'
    when 'email'            then 'fyi'
    else 'action'
  end
$function$
;

CREATE OR REPLACE FUNCTION public.notify_new_deliverable()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- Only create notifications if there are drafters assigned
  IF NEW.drafter_ids IS NOT NULL AND array_length(NEW.drafter_ids, 1) > 0 THEN
    INSERT INTO notifications (person_id, type, title, body, href, entity_id)
    SELECT
      unnest(NEW.drafter_ids),
      'assignment',
      'New deliverable: ' || COALESCE(NEW.name, 'Untitled'),
      COALESCE(NEW.matter_name, '') || CASE WHEN NEW.external_due_date IS NOT NULL THEN ' — Due ' || NEW.external_due_date::text ELSE '' END,
      '/dashboard/deliverables/' || NEW.notion_id,
      NEW.notion_id;
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.queue_matter_summary_refresh()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  _matter_id TEXT;
  _last_updated TIMESTAMPTZ;
BEGIN
  _matter_id := NEW.matter_id;

  IF _matter_id IS NULL OR _matter_id = '' THEN
    RETURN NEW;
  END IF;

  -- Debounce: skip if summary was refreshed in the last 5 minutes
  SELECT updated_at INTO _last_updated
  FROM matter_summaries
  WHERE matter_id = _matter_id;

  IF _last_updated IS NOT NULL AND _last_updated > now() - interval '5 minutes' THEN
    RETURN NEW;
  END IF;

  -- Queue async HTTP request via pg_net
  PERFORM net.http_post(
    url := 'https://app.example.invalid/api/matter-summary',
    body := jsonb_build_object('matterId', _matter_id),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', '<redacted: CRON_SECRET>'
    ),
    timeout_milliseconds := 30000
  );

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.recalc_client_status(p_client_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_total   int;
  v_ongoing int;
  v_status  text;
BEGIN
  IF p_client_id IS NULL OR p_client_id = '' THEN RETURN; END IF;

  SELECT count(*), count(*) FILTER (WHERE lower(status) = 'ongoing')
    INTO v_total, v_ongoing
    FROM public.matters
   WHERE client_id = p_client_id;

  v_status := CASE
                WHEN v_total = 0   THEN 'Prospective'
                WHEN v_ongoing > 0 THEN 'Active'
                ELSE 'Inactive'
              END;

  UPDATE public.clients
     SET status = v_status
   WHERE notion_id = p_client_id
     AND status IS DISTINCT FROM v_status;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.set_evaluations_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.set_notification_priority()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if new.priority is null or new.priority = 'action' then
    new.priority := public.notification_priority(new.type);
  end if;
  return new;
end
$function$
;

CREATE OR REPLACE FUNCTION public.set_notion_last_edited()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.notion_last_edited_at IS NOT DISTINCT FROM OLD.notion_last_edited_at THEN
    NEW.notion_last_edited_at := now();
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_matter_chat_members()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  -- The origin deployment listed four of its own staff here as standing
  -- members; 20260822_matter_chat_trigger_firm_scoped.sql replaces this
  -- function with one that derives them per firm.
  v_standing_members TEXT[] := ARRAY[]::TEXT[];
  v_merged_members TEXT[];
BEGIN
  -- Merge team members with standing admin/finance members (deduplicated)
  SELECT array_agg(DISTINCT elem ORDER BY elem)
  INTO v_merged_members
  FROM unnest(COALESCE(NEW.team_person_ids, '{}') || v_standing_members) AS elem;

  IF TG_OP = 'INSERT' THEN
    -- Create channel for new matter if one doesn't exist
    INSERT INTO chat_channels (type, matter_id, name, member_ids, created_by)
    VALUES (
      'matter',
      NEW.notion_id,
      NEW.name,
      v_merged_members,
      COALESCE(NEW.team_person_ids[1], v_standing_members[1])
    )
    ON CONFLICT (matter_id) DO NOTHING;

  ELSIF TG_OP = 'UPDATE' THEN
    -- Update existing channel membership and name
    IF NEW.team_person_ids IS DISTINCT FROM OLD.team_person_ids
       OR NEW.name IS DISTINCT FROM OLD.name THEN
      UPDATE chat_channels
      SET member_ids = v_merged_members,
          name       = NEW.name,
          updated_at = now()
      WHERE matter_id = NEW.notion_id AND type = 'matter';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.touch_matter_activity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  ev_ts timestamptz;
BEGIN
  IF NEW.matter_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    UPDATE public.matters
       SET last_activity_at = now()
     WHERE notion_id = NEW.matter_id
       AND status <> 'Archived';
    RETURN NEW;
  END IF;

  ev_ts := COALESCE((to_jsonb(NEW) ->> TG_ARGV[0])::timestamptz, now());
  IF ev_ts < now() - interval '60 days' THEN
    RETURN NEW;
  END IF;

  UPDATE public.matters
     SET last_activity_at = GREATEST(COALESCE(last_activity_at, 'epoch'::timestamptz), ev_ts)
   WHERE notion_id = NEW.matter_id;

  UPDATE public.matters
     SET status = 'Ongoing'
   WHERE notion_id = NEW.matter_id
     AND status = 'Archived';

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.touch_matter_activity_via_channel()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  m_id text;
BEGIN
  SELECT matter_id INTO m_id FROM public.chat_channels WHERE id = NEW.channel_id;
  IF m_id IS NULL THEN
    RETURN NEW;
  END IF;

  UPDATE public.matters
     SET last_activity_at = GREATEST(COALESCE(last_activity_at, 'epoch'::timestamptz), now())
   WHERE notion_id = m_id;

  UPDATE public.matters
     SET status = 'Ongoing'
   WHERE notion_id = m_id
     AND status = 'Archived';

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.touch_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.trg_client_deposits_apply()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.type = 'payment' THEN
      UPDATE clients
         SET receivables = COALESCE(receivables, 0) - NEW.amount,
             receivables_updated_at = now(),
             receivables_updated_by = NEW.recorded_by
       WHERE notion_id = NEW.client_id
          OR (NEW.client_id IS NULL AND name = NEW.client_name);
    ELSE
      UPDATE clients
         SET deposit_balance = COALESCE(deposit_balance, 0) + NEW.amount
       WHERE notion_id = NEW.client_id
          OR (NEW.client_id IS NULL AND name = NEW.client_name);
    END IF;
    RETURN NEW;

  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.type = 'payment' THEN
      UPDATE clients
         SET receivables = COALESCE(receivables, 0) + OLD.amount,
             receivables_updated_at = now()
       WHERE notion_id = OLD.client_id
          OR (OLD.client_id IS NULL AND name = OLD.client_name);
    ELSE
      UPDATE clients
         SET deposit_balance = COALESCE(deposit_balance, 0) - OLD.amount
       WHERE notion_id = OLD.client_id
          OR (OLD.client_id IS NULL AND name = OLD.client_name);
    END IF;
    RETURN OLD;

  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.amount    IS NOT DISTINCT FROM OLD.amount
       AND NEW.type      IS NOT DISTINCT FROM OLD.type
       AND NEW.client_id IS NOT DISTINCT FROM OLD.client_id THEN
      RETURN NEW;
    END IF;

    IF OLD.type = 'payment' THEN
      UPDATE clients
         SET receivables = COALESCE(receivables, 0) + OLD.amount,
             receivables_updated_at = now()
       WHERE notion_id = OLD.client_id
          OR (OLD.client_id IS NULL AND name = OLD.client_name);
    ELSE
      UPDATE clients
         SET deposit_balance = COALESCE(deposit_balance, 0) - OLD.amount
       WHERE notion_id = OLD.client_id
          OR (OLD.client_id IS NULL AND name = OLD.client_name);
    END IF;

    IF NEW.type = 'payment' THEN
      UPDATE clients
         SET receivables = COALESCE(receivables, 0) - NEW.amount,
             receivables_updated_at = now(),
             receivables_updated_by = NEW.recorded_by
       WHERE notion_id = NEW.client_id
          OR (NEW.client_id IS NULL AND name = NEW.client_name);
    ELSE
      UPDATE clients
         SET deposit_balance = COALESCE(deposit_balance, 0) + NEW.amount
       WHERE notion_id = NEW.client_id
          OR (NEW.client_id IS NULL AND name = NEW.client_name);
    END IF;
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.webhook_analysis_completed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  IF NEW.status = 'completed' AND (OLD.status IS NULL OR OLD.status != 'completed') THEN
    PERFORM call_app_api_post('/api/embeddings/generate', jsonb_build_object('analysisId', NEW.id));
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.webhook_deliverable_finalized()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_version int;
BEGIN
  IF NEW.status = 'Outbox' AND OLD.status = 'Pre-finalized' THEN
    SELECT MAX(version) INTO v_version
    FROM public.deliverable_files
    WHERE deliverable_id = NEW.notion_id
      AND action = 'finalized';

    IF v_version IS NOT NULL THEN
      PERFORM call_app_api_post(
        '/api/admin/sharepoint-sync',
        jsonb_build_object('deliverableId', NEW.notion_id, 'version', v_version)
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.webhook_file_uploaded()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.file_urls IS DISTINCT FROM OLD.file_urls AND NEW.file_urls != '[]'::jsonb THEN
    -- Trigger auto-analysis for newly uploaded files
    PERFORM call_app_api('/api/file-analysis/auto?fileId=' || NEW.notion_id);
    -- Trigger SharePoint sync for newly uploaded files
    PERFORM call_app_api_post(
      '/api/admin/sharepoint-sync',
      jsonb_build_object('fileNotionId', NEW.notion_id)
    );
  END IF;
  RETURN NEW;
END;
$function$
;

-- ───────────────── 03_constraints ─────────────────
-- baseline: constraints for schema public (order: pk/unique/exclude, check, foreign key)
-- section 1: primary key, unique, and exclusion constraints
alter table public.affidavit_review_comments add constraint affidavit_review_comments_pkey PRIMARY KEY (id);
alter table public.affidavit_reviews add constraint affidavit_reviews_pkey PRIMARY KEY (id);
alter table public.agent_proposals add constraint email_proposals_pkey PRIMARY KEY (id);
alter table public.agent_runs add constraint agent_runs_pkey PRIMARY KEY (id);
alter table public.agents add constraint agents_pkey PRIMARY KEY (id);
alter table public.announcements add constraint announcements_pkey PRIMARY KEY (notion_id);
alter table public.assistant_announcements add constraint assistant_announcements_pkey PRIMARY KEY (person_id, announcement_key);
alter table public.assistant_digest_log add constraint assistant_digest_log_pkey PRIMARY KEY (person_id, digest_date);
alter table public.assistant_digest_settings add constraint assistant_digest_settings_pkey PRIMARY KEY (person_id);
alter table public.assistant_messages add constraint assistant_messages_pkey PRIMARY KEY (id);
alter table public.assistant_preferences add constraint assistant_preferences_pkey PRIMARY KEY (id);
alter table public.assistant_reminders add constraint assistant_reminders_pkey PRIMARY KEY (id);
alter table public.attendance add constraint attendance_pkey PRIMARY KEY (notion_id);
alter table public.audit_log add constraint audit_log_pkey PRIMARY KEY (id);
alter table public.backfill_state add constraint backfill_state_pkey PRIMARY KEY (name);
alter table public.billing_rates add constraint billing_rates_pkey PRIMARY KEY (id);
alter table public.calendar_sync_events add constraint calendar_sync_events_pkey PRIMARY KEY (id);
alter table public.chat_channels add constraint chat_channels_pkey PRIMARY KEY (id);
alter table public.chat_messages add constraint chat_messages_pkey PRIMARY KEY (id);
alter table public.chat_mutes add constraint chat_mutes_pkey PRIMARY KEY (channel_id, person_id);
alter table public.chat_push_tokens add constraint chat_push_tokens_pkey PRIMARY KEY (id);
alter table public.chat_reactions add constraint chat_reactions_pkey PRIMARY KEY (message_id, person_id, emoji);
alter table public.chat_read_receipts add constraint chat_read_receipts_pkey PRIMARY KEY (channel_id, person_id);
alter table public.client_code_counters add constraint client_code_counters_pkey PRIMARY KEY (scope);
alter table public.client_deposits add constraint client_deposits_pkey PRIMARY KEY (id);
alter table public.client_intakes add constraint client_intakes_pkey PRIMARY KEY (id);
alter table public.client_partner_notes add constraint client_partner_notes_pkey PRIMARY KEY (id);
alter table public.client_users add constraint client_users_pkey PRIMARY KEY (id);
alter table public.clients add constraint clients_pkey PRIMARY KEY (notion_id);
alter table public.corporation_affiliations add constraint corporation_affiliations_pkey PRIMARY KEY (id);
alter table public.corporation_files add constraint corporation_files_pkey PRIMARY KEY (id);
alter table public.corporation_meetings add constraint corporation_meetings_pkey PRIMARY KEY (id);
alter table public.corporation_persons add constraint corporation_persons_pkey PRIMARY KEY (id);
alter table public.corporation_share_classes add constraint corporation_share_classes_pkey PRIMARY KEY (id);
alter table public.corporations add constraint corporations_pkey PRIMARY KEY (id);
alter table public.deadline_chain_items add constraint deadline_chain_items_pkey PRIMARY KEY (id);
alter table public.deadline_chains add constraint deadline_chains_pkey PRIMARY KEY (id);
alter table public.deliverable_actions add constraint deliverable_actions_pkey PRIMARY KEY (id);
alter table public.deliverable_comment_reactions add constraint deliverable_comment_reactions_pkey PRIMARY KEY (id);
alter table public.deliverable_comments add constraint deliverable_comments_pkey PRIMARY KEY (id);
alter table public.deliverable_files add constraint deliverable_files_pkey PRIMARY KEY (id);
alter table public.deliverable_version_reactions add constraint deliverable_version_reactions_pkey PRIMARY KEY (id);
alter table public.deliverables add constraint deliverables_pkey PRIMARY KEY (notion_id);
alter table public.directory add constraint directory_pkey PRIMARY KEY (notion_id);
alter table public.document_templates add constraint document_templates_pkey PRIMARY KEY (id);
alter table public.drafting_idempotency add constraint drafting_idempotency_pkey PRIMARY KEY (key);
alter table public.drafting_style_profiles add constraint drafting_style_profiles_pkey PRIMARY KEY (id);
alter table public.dtr add constraint dtr_pkey PRIMARY KEY (notion_id);
alter table public.dtr_revision_comments add constraint dtr_revision_comments_pkey PRIMARY KEY (id);
alter table public.dtr_revision_reviews add constraint dtr_revision_reviews_pkey PRIMARY KEY (id);
alter table public.dtr_revisions add constraint dtr_revisions_pkey PRIMARY KEY (id);
alter table public.email_attachments add constraint email_attachments_pkey PRIMARY KEY (id);
alter table public.email_mailbox_copies add constraint email_mailbox_copies_pkey PRIMARY KEY (id);
alter table public.email_mailboxes add constraint email_mailboxes_pkey PRIMARY KEY (id);
alter table public.email_matter_links add constraint email_matter_links_pkey PRIMARY KEY (id);
alter table public.email_signatures add constraint email_signatures_pkey PRIMARY KEY (id);
alter table public.email_templates add constraint email_templates_pkey PRIMARY KEY (id);
alter table public.emails add constraint emails_pkey PRIMARY KEY (id);
alter table public.embeddings add constraint embeddings_pkey PRIMARY KEY (id);
alter table public.engagement_proposals add constraint engagement_proposals_pkey PRIMARY KEY (id);
alter table public.engagement_signatures add constraint engagement_signatures_pkey PRIMARY KEY (id);
alter table public.entity_comment_reactions add constraint entity_comment_reactions_pkey PRIMARY KEY (id);
alter table public.entity_comments add constraint entity_comments_pkey PRIMARY KEY (id);
alter table public.enum_options add constraint enum_options_pkey PRIMARY KEY (id);
alter table public.evaluation_period_discretionary_bonuses add constraint evaluation_period_discretionary_bonuses_pkey PRIMARY KEY (period_id, partner_person_id, associate_person_id);
alter table public.evaluation_period_other_bonuses add constraint evaluation_period_other_bonuses_pkey PRIMARY KEY (period_id, person_id);
alter table public.evaluation_periods add constraint evaluation_periods_pkey PRIMARY KEY (id);
alter table public.evaluation_scores add constraint evaluation_scores_pkey PRIMARY KEY (evaluation_id, criterion_key);
alter table public.evaluations add constraint evaluations_pkey PRIMARY KEY (id);
alter table public.exhibits add constraint exhibits_pkey PRIMARY KEY (id);
alter table public.expense_revisions add constraint expense_revisions_pkey PRIMARY KEY (id);
alter table public.fee_schedules add constraint fee_schedules_pkey PRIMARY KEY (id);
alter table public.feedbacks add constraint feedbacks_pkey PRIMARY KEY (notion_id);
alter table public.file_analyses add constraint file_analyses_pkey PRIMARY KEY (id);
alter table public.file_requests add constraint file_requests_pkey PRIMARY KEY (id);
alter table public.files add constraint files_pkey PRIMARY KEY (notion_id);
alter table public.firm_expense_templates add constraint firm_expense_templates_pkey PRIMARY KEY (id);
alter table public.firm_expenses add constraint firm_expenses_pkey PRIMARY KEY (id);
alter table public.firm_invoice_settings add constraint firm_invoice_settings_pkey PRIMARY KEY (id);
alter table public.firm_profiles add constraint firm_profiles_pkey PRIMARY KEY (id);
alter table public.generated_documents add constraint generated_documents_pkey PRIMARY KEY (id);
alter table public.hearings add constraint hearings_pkey PRIMARY KEY (notion_id);
alter table public.intake_stage_history add constraint intake_stage_history_pkey PRIMARY KEY (id);
alter table public.intake_submissions add constraint intake_submissions_pkey PRIMARY KEY (id);
alter table public.invoice_number_counters add constraint invoice_number_counters_pkey PRIMARY KEY (billing_month);
alter table public.invoice_payments add constraint invoice_payments_pkey PRIMARY KEY (id);
alter table public.invoices add constraint invoices_pkey PRIMARY KEY (id);
alter table public.issuance_scrape_runs add constraint issuance_scrape_runs_pkey PRIMARY KEY (id);
alter table public.issuances add constraint issuances_pkey PRIMARY KEY (id);
alter table public.kb_jobs add constraint kb_jobs_pkey PRIMARY KEY (id);
alter table public.kb_page_citations add constraint kb_page_citations_pkey PRIMARY KEY (id);
alter table public.kb_page_matters add constraint kb_page_matters_pkey PRIMARY KEY (kb_page_id, matter_id);
alter table public.kb_pages add constraint kb_pages_pkey PRIMARY KEY (id);
alter table public.knowledge_searches add constraint knowledge_searches_pkey PRIMARY KEY (id);
alter table public.leaves add constraint leaves_pkey PRIMARY KEY (notion_id);
alter table public.liaison_tasks add constraint liaison_tasks_pkey PRIMARY KEY (id);
alter table public.matter_action_entries add constraint matter_action_entries_pkey PRIMARY KEY (id);
alter table public.matter_billing_actions add constraint matter_billing_actions_pkey PRIMARY KEY (id);
alter table public.matter_billing_configs add constraint matter_billing_configs_pkey PRIMARY KEY (id);
alter table public.matter_billing_milestones add constraint matter_billing_milestones_pkey PRIMARY KEY (id);
alter table public.matter_exec_summaries add constraint matter_exec_summaries_pkey PRIMARY KEY (matter_id);
alter table public.matter_expenses add constraint matter_expenses_pkey PRIMARY KEY (id);
alter table public.matter_group_summaries add constraint matter_group_summaries_pkey PRIMARY KEY (root_matter_id);
alter table public.matter_health add constraint matter_health_pkey PRIMARY KEY (matter_id);
alter table public.matter_sol add constraint matter_sol_pkey PRIMARY KEY (id);
alter table public.matter_summaries add constraint matter_summaries_pkey PRIMARY KEY (matter_id);
alter table public.matters add constraint matters_pkey PRIMARY KEY (notion_id);
alter table public.meetings add constraint meetings_pkey PRIMARY KEY (notion_id);
alter table public.notification_mutes add constraint notification_mutes_pkey PRIMARY KEY (id);
alter table public.notifications add constraint notifications_pkey PRIMARY KEY (id);
alter table public.parties add constraint parties_pkey PRIMARY KEY (id);
alter table public.partner_matter_annotations add constraint partner_matter_annotations_pkey PRIMARY KEY (id);
alter table public.ph_holidays add constraint ph_holidays_pkey PRIMARY KEY (id);
alter table public.pleading_red_team_comments add constraint pleading_red_team_comments_pkey PRIMARY KEY (id);
alter table public.pleading_red_teams add constraint pleading_red_teams_pkey PRIMARY KEY (id);
alter table public.portal_chat_messages add constraint portal_chat_messages_pkey PRIMARY KEY (id);
alter table public.push_subscriptions add constraint push_subscriptions_pkey PRIMARY KEY (id);
alter table public.reimbursements add constraint reimbursements_pkey PRIMARY KEY (notion_id);
alter table public.resolution_templates add constraint resolution_templates_pkey PRIMARY KEY (id);
alter table public.resolutions add constraint resolutions_pkey PRIMARY KEY (id);
alter table public.resources add constraint resources_pkey PRIMARY KEY (id);
alter table public.rule_deadlines add constraint rule_deadlines_pkey PRIMARY KEY (rule_set_id, id);
alter table public.rule_sets add constraint rule_sets_pkey PRIMARY KEY (id);
alter table public.saved_reports add constraint saved_reports_pkey PRIMARY KEY (id);
alter table public.scope_templates add constraint scope_templates_pkey PRIMARY KEY (id);
alter table public.sla_breaches add constraint sla_breaches_pkey PRIMARY KEY (id);
alter table public.sla_rules add constraint sla_rules_pkey PRIMARY KEY (id);
alter table public.sync_log add constraint sync_log_pkey PRIMARY KEY (id);
alter table public.tasks add constraint tasks_pkey PRIMARY KEY (notion_id);
alter table public.team add constraint team_lawyers_pkey PRIMARY KEY (notion_id);
alter table public.telegram_link_codes add constraint telegram_link_codes_pkey PRIMARY KEY (code);
alter table public.telegram_messages add constraint telegram_messages_pkey PRIMARY KEY (id);
alter table public.trademark_client_reports add constraint trademark_client_reports_pkey PRIMARY KEY (id);
alter table public.trademark_files add constraint trademark_files_pkey PRIMARY KEY (id);
alter table public.trademarks add constraint trademarks_pkey PRIMARY KEY (id);
alter table public.transportation_zones add constraint transportation_zones_pkey PRIMARY KEY (id);
alter table public.user_passwords add constraint user_passwords_pkey PRIMARY KEY (id);
alter table public.user_preferences add constraint user_preferences_pkey PRIMARY KEY (email);
alter table public.billing_rates add constraint billing_rates_position_key UNIQUE ("position");
alter table public.chat_channels add constraint chat_channels_matter_id_key UNIQUE (matter_id);
alter table public.chat_push_tokens add constraint chat_push_tokens_expo_push_token_key UNIQUE (expo_push_token);
alter table public.client_users add constraint client_users_auth_user_id_key UNIQUE (auth_user_id);
alter table public.client_users add constraint client_users_email_key UNIQUE (email);
alter table public.deliverable_comment_reactions add constraint deliverable_comment_reactions_comment_id_person_id_emoji_key UNIQUE (comment_id, person_id, emoji);
alter table public.deliverable_version_reactions add constraint deliverable_version_reactions_deliverable_id_version_person_key UNIQUE (deliverable_id, version, person_id, emoji);
alter table public.drafting_style_profiles add constraint drafting_style_profiles_doc_type_key_key UNIQUE (doc_type_key);
alter table public.dtr_revision_reviews add constraint dtr_revision_reviews_billing_month_client_name_key UNIQUE (billing_month, client_name);
alter table public.email_attachments add constraint email_attachments_email_id_graph_attachment_id_key UNIQUE (email_id, graph_attachment_id);
alter table public.email_mailbox_copies add constraint email_mailbox_copies_mailbox_id_graph_message_id_key UNIQUE (mailbox_id, graph_message_id);
alter table public.email_mailboxes add constraint email_mailboxes_email_address_key UNIQUE (email_address);
alter table public.email_matter_links add constraint email_matter_links_email_id_matter_id_key UNIQUE (email_id, matter_id);
alter table public.embeddings add constraint embeddings_source_chunk_unique UNIQUE (source_type, source_id, chunk_index);
alter table public.engagement_signatures add constraint engagement_signatures_matter_id_document_path_key UNIQUE (matter_id, document_path);
alter table public.entity_comment_reactions add constraint entity_comment_reactions_comment_id_person_id_emoji_key UNIQUE (comment_id, person_id, emoji);
alter table public.evaluation_periods add constraint evaluation_periods_name_key UNIQUE (name);
alter table public.evaluations add constraint evaluations_period_id_evaluator_person_id_evaluatee_person__key UNIQUE (period_id, evaluator_person_id, evaluatee_person_id);
alter table public.exhibits add constraint exhibits_label_unique UNIQUE (matter_id, offered_by, label);
alter table public.invoices add constraint invoices_invoice_number_key UNIQUE (invoice_number);
alter table public.issuances add constraint issuances_source_type_number_key UNIQUE (source, type, number);
alter table public.kb_pages add constraint kb_pages_slug_key UNIQUE (slug);
alter table public.matter_billing_configs add constraint matter_billing_configs_matter_id_key UNIQUE (matter_id);
alter table public.matter_expenses add constraint matter_expenses_liaison_task_id_key UNIQUE (liaison_task_id);
alter table public.matter_sol add constraint matter_sol_matter_id_key UNIQUE (matter_id);
alter table public.notification_mutes add constraint notification_mutes_person_id_entity_id_key UNIQUE (person_id, entity_id);
alter table public.partner_matter_annotations add constraint partner_matter_annotations_matter_id_partner_id_key UNIQUE (matter_id, partner_id);
alter table public.ph_holidays add constraint ph_holidays_date_key UNIQUE (date);
alter table public.push_subscriptions add constraint push_subscriptions_endpoint_key UNIQUE (endpoint);
alter table public.resources add constraint resources_slug_key UNIQUE (slug);
alter table public.transportation_zones add constraint transportation_zones_name_key UNIQUE (name);
alter table public.user_passwords add constraint user_passwords_email_key UNIQUE (email);
alter table public.evaluation_periods add constraint evaluation_periods_daterange_excl EXCLUDE USING gist (daterange(start_date, end_date, '[]'::text) WITH &&);
-- section 2: check constraints
alter table public.agent_proposals add constraint agent_proposals_dismiss_reason_check CHECK (((dismiss_reason IS NULL) OR (dismiss_reason = ANY (ARRAY['already_handled'::text, 'not_applicable'::text, 'incorrect'::text]))));
alter table public.agent_proposals add constraint agent_proposals_dismiss_reason_status_check CHECK (((dismiss_reason IS NULL) OR (status = 'dismissed'::text)));
alter table public.agent_proposals add constraint email_proposals_deadline_payload CHECK (((kind <> 'deadline_chain'::text) OR ((rule_set_id IS NOT NULL) AND (trigger_date IS NOT NULL))));
alter table public.agent_proposals add constraint email_proposals_file_payload CHECK (((kind <> 'file_entry'::text) OR (email_attachment_id IS NOT NULL)));
alter table public.agent_proposals add constraint email_proposals_kind_check CHECK ((kind = ANY (ARRAY['deadline_chain'::text, 'file_entry'::text])));
alter table public.agent_proposals add constraint email_proposals_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'confirmed'::text, 'dismissed'::text])));
alter table public.agent_runs add constraint agent_runs_status_check CHECK ((status = ANY (ARRAY['running'::text, 'succeeded'::text, 'failed'::text])));
alter table public.agent_runs add constraint agent_runs_trigger_check CHECK ((trigger = ANY (ARRAY['cron'::text, 'chat'::text, 'manual'::text, 'webhook'::text])));
alter table public.agents add constraint agents_autonomy_check CHECK ((autonomy = ANY (ARRAY['read_only'::text, 'propose'::text, 'disabled'::text])));
alter table public.assistant_messages add constraint assistant_messages_role_check CHECK ((role = ANY (ARRAY['user'::text, 'assistant'::text])));
alter table public.audit_log add constraint audit_log_actor_type_check CHECK ((actor_type = ANY (ARRAY['human'::text, 'agent'::text])));
alter table public.audit_log add constraint audit_log_human_has_actor CHECK (((actor_type = 'agent'::text) OR (performed_by IS NOT NULL)));
alter table public.chat_channels add constraint chat_channels_type_check CHECK ((type = ANY (ARRAY['matter'::text, 'dm'::text, 'group'::text])));
alter table public.chat_push_tokens add constraint chat_push_tokens_platform_check CHECK ((platform = ANY (ARRAY['ios'::text, 'android'::text])));
alter table public.client_deposits add constraint client_deposits_type_check CHECK ((type = ANY (ARRAY['deposit'::text, 'application'::text, 'refund'::text, 'adjustment'::text, 'payment'::text])));
alter table public.client_intakes add constraint client_intakes_source_check CHECK ((source = ANY (ARRAY['referral'::text, 'website'::text, 'walk-in'::text, 'event'::text, 'other'::text])));
alter table public.client_intakes add constraint client_intakes_stage_check CHECK ((stage = ANY (ARRAY['Lead'::text, 'Contacted'::text, 'Consultation Scheduled'::text, 'Consultation Done'::text, 'Proposal Sent'::text, 'Engaged'::text, 'Declined'::text])));
alter table public.clients add constraint clients_name_nonempty CHECK (((name IS NOT NULL) AND (normalize_client_name(name) <> ''::text)));
alter table public.corporation_affiliations add constraint corporation_affiliations_relation_check CHECK ((relation = ANY (ARRAY['Parent'::text, 'Subsidiary'::text, 'Affiliate'::text])));
alter table public.corporation_files add constraint corporation_files_category_check CHECK ((category = ANY (ARRAY['AOI'::text, 'By-Laws'::text, 'Treasurer Affidavit'::text, 'Name Verification Slip'::text, 'Inward Remittance Cert'::text, 'SEC Filing Receipt'::text, 'SEC COR'::text, 'BIR COR'::text, 'BIR Books'::text, 'Authority to Print'::text, 'Business Permit'::text, 'Barangay Clearance'::text, 'Sanitary Permit'::text, 'Fire Safety Inspection'::text, 'SSS R-1'::text, 'PhilHealth ER1'::text, 'Pag-IBIG EFR'::text, 'Stock Certificate'::text, 'Deed of Assignment'::text, 'GIS'::text, 'AFS'::text, 'Beneficial Ownership Declaration'::text, 'ID Copy'::text, 'Other'::text])));
alter table public.corporation_meetings add constraint corporation_meetings_meeting_mode_check CHECK ((meeting_mode = ANY (ARRAY['In-Person'::text, 'Virtual'::text, 'Hybrid'::text])));
alter table public.corporation_meetings add constraint corporation_meetings_meeting_type_check CHECK ((meeting_type = ANY (ARRAY['Organizational'::text, 'Regular Board'::text, 'Special Board'::text, 'Annual Stockholders'::text, 'Special Stockholders'::text])));
alter table public.corporation_meetings add constraint corporation_meetings_minutes_status_check CHECK ((minutes_status = ANY (ARRAY['Draft'::text, 'For Signing'::text, 'Signed'::text])));
alter table public.corporation_persons add constraint corporation_persons_role_check CHECK ((role = ANY (ARRAY['Incorporator'::text, 'Director'::text, 'Officer'::text, 'Stockholder'::text, 'Treasurer'::text, 'Corporate Secretary'::text, 'President'::text, 'Chairman'::text, 'Compliance Officer'::text, 'Nominee'::text, 'Alternate Nominee'::text])));
alter table public.corporations add constraint corporations_annual_meeting_day_check CHECK (((annual_meeting_day IS NULL) OR ((annual_meeting_day >= 1) AND (annual_meeting_day <= 31))));
alter table public.corporations add constraint corporations_annual_meeting_month_check CHECK (((annual_meeting_month IS NULL) OR ((annual_meeting_month >= 1) AND (annual_meeting_month <= 12))));
alter table public.corporations add constraint corporations_company_type_check CHECK ((company_type = ANY (ARRAY['Stock'::text, 'Non-Stock'::text, 'OPC'::text, 'Partnership'::text])));
alter table public.corporations add constraint corporations_esparc_status_check CHECK ((esparc_status = ANY (ARRAY['Not Started'::text, 'Name Verification'::text, 'Drafting'::text, 'For Payment'::text, 'For SEC Approval'::text, 'Approved'::text, 'Rejected'::text])));
alter table public.corporations add constraint corporations_fiscal_year_end_month_check CHECK (((fiscal_year_end_month >= 1) AND (fiscal_year_end_month <= 12)));
alter table public.corporations add constraint corporations_status_check CHECK ((status = ANY (ARRAY['Pre-Incorporation'::text, 'In SEC'::text, 'Registered'::text, 'Active'::text, 'Dissolved'::text])));
alter table public.deadline_chain_items add constraint deadline_chain_items_entity_type_check CHECK ((entity_type = ANY (ARRAY['deliverable'::text, 'hearing'::text])));
alter table public.deliverable_comments add constraint deliverable_comments_parent_type_check CHECK ((parent_type = ANY (ARRAY['action'::text, 'version'::text])));
alter table public.document_templates add constraint document_templates_deadline_kind_check CHECK (((deadline_kind IS NULL) OR (deadline_kind = ANY (ARRAY['NOI Payment'::text, 'OA Response'::text, '3-DAU'::text, '5-DAU'::text, 'Renewal'::text]))));
alter table public.drafting_style_profiles add constraint drafting_style_profiles_format_check CHECK ((format = ANY (ARRAY['pleading'::text, 'letter'::text, 'status_report'::text])));
alter table public.dtr_revision_reviews add constraint dtr_revision_reviews_clearance_status_check CHECK (((clearance_status IS NULL) OR (clearance_status = ANY (ARRAY['cleared'::text, 'declined'::text]))));
alter table public.dtr_revision_reviews add constraint dtr_revision_reviews_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])));
alter table public.dtr_revisions add constraint dtr_revisions_action_check CHECK ((action = ANY (ARRAY['set'::text, 'exclude'::text, 'waive'::text])));
alter table public.dtr_revisions add constraint dtr_revisions_target CHECK ((((original_dtr_id IS NOT NULL) AND (created_entry_key IS NULL)) OR ((original_dtr_id IS NULL) AND (created_entry_key IS NOT NULL))));
alter table public.email_mailboxes add constraint email_mailboxes_mailbox_type_check CHECK ((mailbox_type = ANY (ARRAY['shared'::text, 'individual'::text, 'personal'::text, 'group'::text])));
alter table public.email_matter_links add constraint email_matter_links_link_method_check CHECK ((link_method = ANY (ARRAY['manual'::text, 'auto_reply_chain'::text, 'auto_sender'::text, 'auto_subject'::text, 'auto_case_number'::text])));
alter table public.email_templates add constraint email_templates_category_check CHECK ((category = ANY (ARRAY['general'::text, 'court_filing'::text, 'client_update'::text, 'demand_letter'::text, 'follow_up'::text, 'engagement'::text, 'billing'::text, 'reminder'::text, 'overdue'::text, 'final'::text])));
alter table public.emails add constraint emails_direction_check CHECK ((direction = ANY (ARRAY['inbound'::text, 'outbound'::text])));
alter table public.engagement_proposals add constraint engagement_proposals_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'sent'::text, 'accepted'::text, 'declined'::text, 'superseded'::text])));
alter table public.entity_comments add constraint entity_comments_entity_type_check CHECK ((entity_type = ANY (ARRAY['hearing'::text, 'meeting'::text, 'task'::text, 'file'::text])));
alter table public.evaluation_period_discretionary_bonuses add constraint evaluation_period_discretionary_bonuses_amount_php_check CHECK ((amount_php >= (0)::numeric));
alter table public.evaluation_period_discretionary_bonuses add constraint evaluation_period_discretionary_bonuses_check CHECK ((partner_person_id <> associate_person_id));
alter table public.evaluation_period_other_bonuses add constraint evaluation_period_other_bonuses_multiplier_check CHECK ((multiplier >= (0)::numeric));
alter table public.evaluation_periods add constraint evaluation_periods_check CHECK ((end_date > start_date));
alter table public.evaluation_scores add constraint evaluation_scores_na_null_rating CHECK (((NOT not_applicable) OR (rating IS NULL)));
alter table public.evaluation_scores add constraint evaluation_scores_rating_check CHECK (((rating >= 1) AND (rating <= 5)));
alter table public.evaluations add constraint evaluations_check CHECK ((evaluator_person_id <> evaluatee_person_id));
alter table public.evaluations add constraint evaluations_rubric_variant_check CHECK ((rubric_variant = ANY (ARRAY['JA'::text, 'MLA'::text, 'SA'::text])));
alter table public.evaluations add constraint evaluations_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'submitted'::text])));
alter table public.exhibits add constraint exhibits_offered_by_chk CHECK ((offered_by = ANY (ARRAY['plaintiff'::text, 'defendant'::text, 'prosecution'::text, 'accused'::text, 'petitioner'::text, 'respondent'::text, 'complainant'::text, 'other'::text])));
alter table public.exhibits add constraint exhibits_status_chk CHECK ((status = ANY (ARRAY['marked'::text, 'offered'::text, 'admitted'::text, 'denied'::text, 'withdrawn'::text])));
alter table public.expense_revisions add constraint expense_revisions_action_check CHECK ((action = ANY (ARRAY['set'::text, 'exclude'::text, 'waive'::text])));
alter table public.file_analyses add constraint file_analyses_source_xor CHECK ((((((file_id IS NOT NULL))::integer + ((deliverable_file_id IS NOT NULL))::integer) + ((email_attachment_id IS NOT NULL))::integer) = 1));
alter table public.file_analyses add constraint file_analyses_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'completed'::text, 'failed'::text])));
alter table public.firm_invoice_settings add constraint firm_invoice_settings_singleton CHECK ((id = 1));
alter table public.intake_submissions add constraint intake_submissions_kind_check CHECK ((kind = ANY (ARRAY['general'::text, 'trademark'::text, 'incorporation'::text])));
alter table public.intake_submissions add constraint intake_submissions_status_check CHECK ((status = ANY (ARRAY['new'::text, 'in_review'::text, 'converted'::text, 'dismissed'::text])));
alter table public.issuances add constraint issuances_ai_confidence_check CHECK (((ai_confidence = ANY (ARRAY['high'::text, 'medium'::text, 'low'::text])) OR (ai_confidence IS NULL)));
alter table public.issuances add constraint issuances_status_check CHECK ((status = ANY (ARRAY['published'::text, 'archived'::text, 'rejected'::text])));
alter table public.kb_jobs add constraint kb_jobs_kind_check CHECK ((kind = ANY (ARRAY['backfill'::text, 'incremental'::text, 'lint'::text, 'reembed'::text])));
alter table public.kb_jobs add constraint kb_jobs_status_check CHECK ((status = ANY (ARRAY['running'::text, 'completed'::text, 'failed'::text])));
alter table public.kb_page_citations add constraint kb_page_citations_source_type_check CHECK ((source_type = ANY (ARRAY['matter_summary'::text, 'file_analysis'::text, 'deliverable_version'::text, 'filing'::text, 'manual'::text])));
alter table public.kb_pages add constraint kb_pages_generated_by_check CHECK ((generated_by = ANY (ARRAY['manual'::text, 'llm'::text, 'lint'::text])));
alter table public.kb_pages add constraint kb_pages_kind_check CHECK ((kind = ANY (ARRAY['doctrine'::text, 'template_clause'::text, 'judge'::text, 'court'::text, 'opposing_counsel'::text, 'opposing_party'::text, 'playbook'::text, 'general'::text, 'evidence_rule'::text])));
alter table public.kb_pages add constraint kb_pages_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'review'::text, 'published'::text, 'stale'::text, 'archived'::text])));
alter table public.liaison_tasks add constraint liaison_tasks_priority_check CHECK ((priority = ANY (ARRAY['low'::text, 'normal'::text, 'high'::text])));
alter table public.liaison_tasks add constraint liaison_tasks_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'in_progress'::text, 'completed'::text, 'cancelled'::text])));
alter table public.matter_billing_configs add constraint matter_billing_configs_billing_type_check CHECK ((billing_type = ANY (ARRAY['litigation'::text, 'retainer'::text, 'fixed_fee'::text, 'fixed_retainer'::text, 'acceptance_per_action'::text, 'acceptance_per_milestone'::text])));
alter table public.matter_health add constraint matter_health_tier_check CHECK ((tier = ANY (ARRAY['green'::text, 'yellow'::text, 'red'::text])));
alter table public.matter_sol add constraint matter_sol_status_check CHECK ((status = ANY (ARRAY['active'::text, 'tolled'::text, 'expired'::text, 'filed'::text])));
alter table public.matters add constraint matters_status_check CHECK ((status = ANY (ARRAY['Ongoing'::text, 'Done'::text, 'Archived'::text])));
alter table public.parties add constraint parties_entity_type_check CHECK ((entity_type = ANY (ARRAY['individual'::text, 'organization'::text])));
alter table public.parties add constraint parties_party_role_check CHECK ((party_role = ANY (ARRAY['client'::text, 'opposing_party'::text, 'co-counsel'::text, 'witness'::text, 'interested_party'::text])));
alter table public.parties add constraint parties_source_check CHECK ((source = ANY (ARRAY['manual'::text, 'client_auto'::text, 'file_analysis'::text, 'intake'::text, 'deliverable_version'::text])));
alter table public.partner_matter_annotations add constraint partner_matter_annotations_urgency_check CHECK ((urgency = ANY (ARRAY['High'::text, 'Medium'::text, 'Low'::text, 'None'::text])));
alter table public.ph_holidays add constraint ph_holidays_type_check CHECK ((type = ANY (ARRAY['regular'::text, 'special_non_working'::text, 'special_working'::text])));
alter table public.portal_chat_messages add constraint portal_chat_messages_role_check CHECK ((role = ANY (ARRAY['user'::text, 'assistant'::text])));
alter table public.resolution_templates add constraint resolution_templates_category_check CHECK ((category = ANY (ARRAY['Banking'::text, 'Real Estate'::text, 'Corporate Governance'::text, 'Capital & Shares'::text, 'HR'::text, 'Tax'::text, 'Litigation'::text, 'Government'::text, 'Loans & Credit'::text])));
alter table public.resolution_templates add constraint resolution_templates_kind_check CHECK ((kind = ANY (ARRAY['Board Resolution'::text, 'Stockholders Resolution'::text, 'Secretarys Certificate'::text])));
alter table public.resolutions add constraint resolutions_kind_check CHECK ((kind = ANY (ARRAY['Board Resolution'::text, 'Stockholders Resolution'::text, 'Secretarys Certificate'::text])));
alter table public.resolutions add constraint resolutions_status_check CHECK ((status = ANY (ARRAY['Draft'::text, 'For Signing'::text, 'Signed'::text])));
alter table public.resources add constraint resources_category_check CHECK ((category = ANY (ARRAY['guide'::text, 'policy'::text, 'reference'::text, 'announcement'::text, 'general'::text])));
alter table public.rule_deadlines add constraint rule_deadlines_calendar_type_check CHECK ((calendar_type = ANY (ARRAY['calendar'::text, 'business'::text])));
alter table public.rule_deadlines add constraint rule_deadlines_entity_type_check CHECK ((entity_type = ANY (ARRAY['deliverable'::text, 'hearing'::text])));
alter table public.saved_reports add constraint saved_reports_entity_check CHECK ((entity = ANY (ARRAY['matters'::text, 'deliverables'::text, 'dtr'::text, 'invoices'::text])));
alter table public.saved_reports add constraint saved_reports_shared_scope_check CHECK ((shared_scope = ANY (ARRAY['private'::text, 'firm'::text])));
alter table public.team add constraint team_bonus_profile_check CHECK ((bonus_profile = ANY (ARRAY['standard'::text, 'qzx'::text])));
alter table public.telegram_messages add constraint telegram_messages_role_check CHECK ((role = ANY (ARRAY['user'::text, 'assistant'::text])));
alter table public.trademarks add constraint trademarks_gpoa_status_check CHECK ((gpoa_status = ANY (ARRAY['To Follow'::text, 'Filed'::text])));
alter table public.trademarks add constraint trademarks_status_check CHECK ((status = ANY (ARRAY['Prelim'::text, 'For Filing'::text, 'Pending'::text, 'Pending - OA'::text, 'Registered'::text, 'Abandoned'::text])));
alter table public.trademarks add constraint trademarks_type_check CHECK ((type = ANY (ARRAY['Wordmark'::text, 'Combined'::text, 'Device'::text])));
-- section 3: foreign key constraints
alter table public.affidavit_review_comments add constraint affidavit_review_comments_review_id_fkey FOREIGN KEY (review_id) REFERENCES affidavit_reviews(id) ON DELETE CASCADE;
alter table public.agent_proposals add constraint agent_proposals_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE SET NULL;
alter table public.agent_proposals add constraint agent_proposals_agent_run_id_fkey FOREIGN KEY (agent_run_id) REFERENCES agent_runs(id) ON DELETE SET NULL;
alter table public.agent_proposals add constraint email_proposals_chain_id_fkey FOREIGN KEY (chain_id) REFERENCES deadline_chains(id) ON DELETE SET NULL;
alter table public.agent_proposals add constraint email_proposals_email_attachment_id_fkey FOREIGN KEY (email_attachment_id) REFERENCES email_attachments(id) ON DELETE SET NULL;
alter table public.agent_proposals add constraint email_proposals_email_id_fkey FOREIGN KEY (email_id) REFERENCES emails(id) ON DELETE SET NULL;
alter table public.agent_proposals add constraint email_proposals_file_analysis_id_fkey FOREIGN KEY (file_analysis_id) REFERENCES file_analyses(id) ON DELETE SET NULL;
alter table public.agent_runs add constraint agent_runs_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE;
alter table public.audit_log add constraint audit_log_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE SET NULL;
alter table public.audit_log add constraint audit_log_agent_run_id_fkey FOREIGN KEY (agent_run_id) REFERENCES agent_runs(id) ON DELETE SET NULL;
alter table public.chat_channels add constraint chat_channels_matter_id_fkey FOREIGN KEY (matter_id) REFERENCES matters(notion_id) ON DELETE SET NULL;
alter table public.chat_messages add constraint chat_messages_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES chat_channels(id) ON DELETE CASCADE;
alter table public.chat_messages add constraint chat_messages_reply_to_id_fkey FOREIGN KEY (reply_to_id) REFERENCES chat_messages(id) ON DELETE SET NULL;
alter table public.chat_mutes add constraint chat_mutes_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES chat_channels(id) ON DELETE CASCADE;
alter table public.chat_reactions add constraint chat_reactions_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES chat_channels(id) ON DELETE CASCADE;
alter table public.chat_reactions add constraint chat_reactions_message_id_fkey FOREIGN KEY (message_id) REFERENCES chat_messages(id) ON DELETE CASCADE;
alter table public.chat_read_receipts add constraint chat_read_receipts_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES chat_channels(id) ON DELETE CASCADE;
alter table public.client_deposits add constraint client_deposits_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(notion_id) ON DELETE SET NULL;
alter table public.client_deposits add constraint client_deposits_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE SET NULL;
alter table public.client_intakes add constraint client_intakes_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(notion_id) ON DELETE CASCADE;
alter table public.client_partner_notes add constraint client_partner_notes_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(notion_id) ON DELETE CASCADE;
alter table public.client_users add constraint client_users_auth_user_id_fkey FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.client_users add constraint client_users_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(notion_id) ON DELETE CASCADE;
alter table public.corporation_affiliations add constraint corporation_affiliations_corporation_id_fkey FOREIGN KEY (corporation_id) REFERENCES corporations(id) ON DELETE CASCADE;
alter table public.corporation_files add constraint corporation_files_corporation_id_fkey FOREIGN KEY (corporation_id) REFERENCES corporations(id) ON DELETE CASCADE;
alter table public.corporation_files add constraint corporation_files_person_id_fkey FOREIGN KEY (person_id) REFERENCES corporation_persons(id) ON DELETE SET NULL;
alter table public.corporation_meetings add constraint corporation_meetings_corporation_id_fkey FOREIGN KEY (corporation_id) REFERENCES corporations(id) ON DELETE CASCADE;
alter table public.corporation_persons add constraint corporation_persons_corporation_id_fkey FOREIGN KEY (corporation_id) REFERENCES corporations(id) ON DELETE CASCADE;
alter table public.corporation_share_classes add constraint corporation_share_classes_corporation_id_fkey FOREIGN KEY (corporation_id) REFERENCES corporations(id) ON DELETE CASCADE;
alter table public.corporations add constraint corporations_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(notion_id) ON DELETE SET NULL;
alter table public.corporations add constraint corporations_engaging_client_id_fkey FOREIGN KEY (engaging_client_id) REFERENCES clients(notion_id) ON DELETE SET NULL;
alter table public.corporations add constraint corporations_housekeeping_matter_id_fkey FOREIGN KEY (housekeeping_matter_id) REFERENCES matters(notion_id) ON DELETE SET NULL;
alter table public.corporations add constraint corporations_incorporation_matter_id_fkey FOREIGN KEY (incorporation_matter_id) REFERENCES matters(notion_id) ON DELETE SET NULL;
alter table public.corporations add constraint corporations_post_incorporation_matter_id_fkey FOREIGN KEY (post_incorporation_matter_id) REFERENCES matters(notion_id) ON DELETE SET NULL;
alter table public.corporations add constraint corporations_retainer_matter_id_fkey FOREIGN KEY (retainer_matter_id) REFERENCES matters(notion_id) ON DELETE SET NULL;
alter table public.deadline_chain_items add constraint deadline_chain_items_chain_id_fkey FOREIGN KEY (chain_id) REFERENCES deadline_chains(id) ON DELETE CASCADE;
alter table public.deliverable_comment_reactions add constraint deliverable_comment_reactions_comment_id_fkey FOREIGN KEY (comment_id) REFERENCES deliverable_comments(id) ON DELETE CASCADE;
alter table public.dtr add constraint dtr_matter_id_fkey FOREIGN KEY (matter_id) REFERENCES matters(notion_id) ON DELETE SET NULL;
alter table public.dtr_revision_comments add constraint dtr_revision_comments_revision_id_fkey FOREIGN KEY (revision_id) REFERENCES dtr_revisions(id) ON DELETE CASCADE;
alter table public.dtr_revisions add constraint dtr_revisions_original_dtr_id_fkey FOREIGN KEY (original_dtr_id) REFERENCES dtr(notion_id) ON DELETE CASCADE;
alter table public.email_attachments add constraint email_attachments_email_id_fkey FOREIGN KEY (email_id) REFERENCES emails(id) ON DELETE CASCADE;
alter table public.email_mailbox_copies add constraint email_mailbox_copies_email_id_fkey FOREIGN KEY (email_id) REFERENCES emails(id) ON DELETE CASCADE;
alter table public.email_mailbox_copies add constraint email_mailbox_copies_mailbox_id_fkey FOREIGN KEY (mailbox_id) REFERENCES email_mailboxes(id) ON DELETE CASCADE;
alter table public.email_matter_links add constraint email_matter_links_email_id_fkey FOREIGN KEY (email_id) REFERENCES emails(id) ON DELETE CASCADE;
alter table public.emails add constraint emails_mailbox_id_fkey FOREIGN KEY (mailbox_id) REFERENCES email_mailboxes(id) ON DELETE CASCADE;
alter table public.engagement_proposals add constraint engagement_proposals_intake_id_fkey FOREIGN KEY (intake_id) REFERENCES client_intakes(id) ON DELETE CASCADE;
alter table public.engagement_signatures add constraint engagement_signatures_client_user_id_fkey FOREIGN KEY (client_user_id) REFERENCES client_users(id) ON DELETE SET NULL;
alter table public.entity_comment_reactions add constraint entity_comment_reactions_comment_id_fkey FOREIGN KEY (comment_id) REFERENCES entity_comments(id) ON DELETE CASCADE;
alter table public.entity_comments add constraint entity_comments_reply_to_id_fkey FOREIGN KEY (reply_to_id) REFERENCES entity_comments(id) ON DELETE CASCADE;
alter table public.evaluation_period_discretionary_bonuses add constraint evaluation_period_discretionary_bonuses_period_id_fkey FOREIGN KEY (period_id) REFERENCES evaluation_periods(id) ON DELETE CASCADE;
alter table public.evaluation_period_other_bonuses add constraint evaluation_period_other_bonuses_period_id_fkey FOREIGN KEY (period_id) REFERENCES evaluation_periods(id) ON DELETE CASCADE;
alter table public.evaluation_scores add constraint evaluation_scores_evaluation_id_fkey FOREIGN KEY (evaluation_id) REFERENCES evaluations(id) ON DELETE CASCADE;
alter table public.evaluations add constraint evaluations_period_id_fkey FOREIGN KEY (period_id) REFERENCES evaluation_periods(id) ON DELETE CASCADE;
alter table public.exhibits add constraint exhibits_file_id_fkey FOREIGN KEY (file_id) REFERENCES files(notion_id) ON DELETE SET NULL;
alter table public.exhibits add constraint exhibits_matter_id_fkey FOREIGN KEY (matter_id) REFERENCES matters(notion_id) ON DELETE CASCADE;
alter table public.exhibits add constraint exhibits_parent_exhibit_id_fkey FOREIGN KEY (parent_exhibit_id) REFERENCES exhibits(id) ON DELETE CASCADE;
alter table public.file_analyses add constraint file_analyses_deliverable_file_id_fkey FOREIGN KEY (deliverable_file_id) REFERENCES deliverable_files(id) ON DELETE CASCADE;
alter table public.file_analyses add constraint file_analyses_email_attachment_id_fkey FOREIGN KEY (email_attachment_id) REFERENCES email_attachments(id) ON DELETE CASCADE;
alter table public.file_analyses add constraint file_analyses_file_id_fkey FOREIGN KEY (file_id) REFERENCES files(notion_id) ON DELETE CASCADE;
alter table public.file_requests add constraint file_requests_fulfilled_by_client_user_id_fkey FOREIGN KEY (fulfilled_by_client_user_id) REFERENCES client_users(id);
alter table public.file_requests add constraint file_requests_matter_id_fkey FOREIGN KEY (matter_id) REFERENCES matters(notion_id) ON DELETE CASCADE;
alter table public.files add constraint files_file_request_id_fkey FOREIGN KEY (file_request_id) REFERENCES file_requests(id) ON DELETE SET NULL;
alter table public.files add constraint files_uploaded_by_client_user_id_fkey FOREIGN KEY (uploaded_by_client_user_id) REFERENCES client_users(id);
alter table public.firm_expenses add constraint firm_expenses_recurring_template_id_fkey FOREIGN KEY (recurring_template_id) REFERENCES firm_expense_templates(id) ON DELETE SET NULL;
alter table public.generated_documents add constraint generated_documents_template_id_fkey FOREIGN KEY (template_id) REFERENCES document_templates(id);
alter table public.intake_stage_history add constraint intake_stage_history_intake_id_fkey FOREIGN KEY (intake_id) REFERENCES client_intakes(id) ON DELETE CASCADE;
alter table public.invoice_payments add constraint invoice_payments_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE;
alter table public.kb_page_citations add constraint kb_page_citations_kb_page_id_fkey FOREIGN KEY (kb_page_id) REFERENCES kb_pages(id) ON DELETE CASCADE;
alter table public.kb_page_matters add constraint kb_page_matters_kb_page_id_fkey FOREIGN KEY (kb_page_id) REFERENCES kb_pages(id) ON DELETE CASCADE;
alter table public.liaison_tasks add constraint liaison_tasks_deliverable_id_fkey FOREIGN KEY (deliverable_id) REFERENCES deliverables(notion_id) ON DELETE SET NULL;
alter table public.liaison_tasks add constraint liaison_tasks_zone_id_fkey FOREIGN KEY (zone_id) REFERENCES transportation_zones(id) ON DELETE SET NULL;
alter table public.matter_action_entries add constraint matter_action_entries_action_id_fkey FOREIGN KEY (action_id) REFERENCES matter_billing_actions(id) ON DELETE CASCADE;
alter table public.matter_action_entries add constraint matter_action_entries_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE SET NULL;
alter table public.matter_action_entries add constraint matter_action_entries_matter_id_fkey FOREIGN KEY (matter_id) REFERENCES matters(notion_id) ON DELETE CASCADE;
alter table public.matter_billing_actions add constraint matter_billing_actions_matter_id_fkey FOREIGN KEY (matter_id) REFERENCES matters(notion_id) ON DELETE CASCADE;
alter table public.matter_billing_configs add constraint matter_billing_configs_matter_id_fkey FOREIGN KEY (matter_id) REFERENCES matters(notion_id);
alter table public.matter_billing_milestones add constraint matter_billing_milestones_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE SET NULL;
alter table public.matter_billing_milestones add constraint matter_billing_milestones_matter_id_fkey FOREIGN KEY (matter_id) REFERENCES matters(notion_id) ON DELETE CASCADE;
alter table public.matter_exec_summaries add constraint matter_exec_summaries_matter_id_fkey FOREIGN KEY (matter_id) REFERENCES matters(notion_id) ON DELETE CASCADE;
alter table public.matter_expenses add constraint matter_expenses_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES invoices(id);
alter table public.matter_expenses add constraint matter_expenses_liaison_task_id_fkey FOREIGN KEY (liaison_task_id) REFERENCES liaison_tasks(id) ON DELETE SET NULL;
alter table public.matter_expenses add constraint matter_expenses_matter_id_fkey FOREIGN KEY (matter_id) REFERENCES matters(notion_id);
alter table public.matter_group_summaries add constraint matter_group_summaries_root_matter_id_fkey FOREIGN KEY (root_matter_id) REFERENCES matters(notion_id) ON DELETE CASCADE;
alter table public.matter_health add constraint matter_health_matter_id_fkey FOREIGN KEY (matter_id) REFERENCES matters(notion_id) ON DELETE CASCADE;
alter table public.matter_summaries add constraint matter_summaries_matter_id_fkey FOREIGN KEY (matter_id) REFERENCES matters(notion_id) ON DELETE CASCADE;
alter table public.matters add constraint matters_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(notion_id);
alter table public.matters add constraint matters_parent_matter_id_fkey FOREIGN KEY (parent_matter_id) REFERENCES matters(notion_id) ON DELETE SET NULL;
alter table public.parties add constraint parties_matter_id_fkey FOREIGN KEY (matter_id) REFERENCES matters(notion_id) ON DELETE CASCADE;
alter table public.partner_matter_annotations add constraint partner_matter_annotations_matter_id_fkey FOREIGN KEY (matter_id) REFERENCES matters(notion_id) ON DELETE CASCADE;
alter table public.pleading_red_team_comments add constraint pleading_red_team_comments_red_team_id_fkey FOREIGN KEY (red_team_id) REFERENCES pleading_red_teams(id) ON DELETE CASCADE;
alter table public.portal_chat_messages add constraint portal_chat_messages_client_user_id_fkey FOREIGN KEY (client_user_id) REFERENCES client_users(id) ON DELETE CASCADE;
alter table public.reimbursements add constraint reimbursements_liaison_task_id_fkey FOREIGN KEY (liaison_task_id) REFERENCES liaison_tasks(id) ON DELETE SET NULL;
alter table public.resolutions add constraint resolutions_corporation_id_fkey FOREIGN KEY (corporation_id) REFERENCES corporations(id) ON DELETE CASCADE;
alter table public.resolutions add constraint resolutions_meeting_id_fkey FOREIGN KEY (meeting_id) REFERENCES corporation_meetings(id) ON DELETE SET NULL;
alter table public.resolutions add constraint resolutions_template_id_fkey FOREIGN KEY (template_id) REFERENCES resolution_templates(id) ON DELETE SET NULL;
alter table public.rule_deadlines add constraint rule_deadlines_rule_set_id_fkey FOREIGN KEY (rule_set_id) REFERENCES rule_sets(id) ON DELETE CASCADE;
alter table public.sla_breaches add constraint sla_breaches_deliverable_id_fkey FOREIGN KEY (deliverable_id) REFERENCES deliverables(notion_id) ON DELETE CASCADE;
alter table public.sla_breaches add constraint sla_breaches_rule_id_fkey FOREIGN KEY (rule_id) REFERENCES sla_rules(id) ON DELETE CASCADE;
alter table public.team add constraint team_auth_user_id_fkey FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.trademark_client_reports add constraint trademark_client_reports_trademark_id_fkey FOREIGN KEY (trademark_id) REFERENCES trademarks(id) ON DELETE CASCADE;
alter table public.trademark_files add constraint trademark_files_trademark_id_fkey FOREIGN KEY (trademark_id) REFERENCES trademarks(id) ON DELETE CASCADE;
alter table public.trademarks add constraint trademarks_matter_id_fkey FOREIGN KEY (matter_id) REFERENCES matters(notion_id) ON DELETE SET NULL;

-- ───────────────── 04_indexes ─────────────────
-- baseline: indexes in schema public that do not back constraints
-- table: affidavit_review_comments
CREATE INDEX affidavit_review_comments_review_idx ON public.affidavit_review_comments USING btree (review_id, created_at);
-- table: affidavit_reviews
CREATE INDEX affidavit_reviews_deliverable_idx ON public.affidavit_reviews USING btree (deliverable_id);
CREATE INDEX affidavit_reviews_matter_idx ON public.affidavit_reviews USING btree (matter_id);
CREATE INDEX affidavit_reviews_reviewer_idx ON public.affidavit_reviews USING btree (reviewed_by, created_at DESC);
-- table: agent_proposals
CREATE INDEX agent_proposals_agent_idx ON public.agent_proposals USING btree (agent_id, status, created_at DESC);
CREATE INDEX agent_proposals_dismiss_reason_idx ON public.agent_proposals USING btree (dismiss_reason, created_at DESC) WHERE (status = 'dismissed'::text);
CREATE INDEX agent_proposals_matter_idx ON public.agent_proposals USING btree (matter_id);
CREATE UNIQUE INDEX agent_proposals_pending_deadline_uniq ON public.agent_proposals USING btree (matter_id, rule_set_id, trigger_date) WHERE ((kind = 'deadline_chain'::text) AND (status = 'pending'::text));
CREATE UNIQUE INDEX agent_proposals_pending_file_uniq ON public.agent_proposals USING btree (email_attachment_id) WHERE ((kind = 'file_entry'::text) AND (status = 'pending'::text));
CREATE INDEX agent_proposals_status_idx ON public.agent_proposals USING btree (status, created_at DESC);
-- table: agent_runs
CREATE INDEX agent_runs_agent_idx ON public.agent_runs USING btree (agent_id, started_at DESC);
CREATE INDEX agent_runs_status_idx ON public.agent_runs USING btree (status, started_at DESC);
-- table: announcements
CREATE INDEX idx_announce_created ON public.announcements USING btree (created_time DESC);
CREATE INDEX idx_announcements_last_edited ON public.announcements USING btree (notion_last_edited_at DESC);
-- table: assistant_messages
CREATE INDEX assistant_messages_person_idx ON public.assistant_messages USING btree (person_id, created_at);
-- table: assistant_preferences
CREATE INDEX idx_assistant_prefs_person ON public.assistant_preferences USING btree (person_id);
-- table: assistant_reminders
CREATE INDEX idx_assistant_reminders_due ON public.assistant_reminders USING btree (due_at) WHERE (sent_at IS NULL);
-- table: attendance
CREATE INDEX idx_attendance_created ON public.attendance USING btree (created_time DESC);
CREATE INDEX idx_attendance_last_edited ON public.attendance USING btree (notion_last_edited_at DESC);
CREATE INDEX idx_attendance_lawyer ON public.attendance USING btree (lawyer_id);
CREATE INDEX idx_attendance_time_in ON public.attendance USING btree (time_in);
-- table: audit_log
CREATE INDEX audit_log_agent_idx ON public.audit_log USING btree (agent_id, created_at DESC) WHERE (actor_type = 'agent'::text);
CREATE INDEX idx_audit_action ON public.audit_log USING btree (action);
CREATE INDEX idx_audit_created ON public.audit_log USING btree (created_at DESC);
CREATE INDEX idx_audit_entity ON public.audit_log USING btree (entity_type, entity_id);
CREATE INDEX idx_audit_user ON public.audit_log USING btree (performed_by);
-- table: calendar_sync_events
CREATE INDEX idx_cal_sync_entity ON public.calendar_sync_events USING btree (entity_type, entity_id);
CREATE INDEX idx_cal_sync_outlook ON public.calendar_sync_events USING btree (outlook_event_id);
CREATE INDEX idx_cal_sync_person ON public.calendar_sync_events USING btree (team_person_id);
CREATE UNIQUE INDEX idx_cal_sync_unique ON public.calendar_sync_events USING btree (entity_type, entity_id, team_person_id) WHERE (sync_status <> 'deleted'::text);
-- table: chat_channels
CREATE UNIQUE INDEX idx_chat_channels_dm_pair ON public.chat_channels USING btree (LEAST(member_ids[1], member_ids[2]), GREATEST(member_ids[1], member_ids[2])) WHERE ((type = 'dm'::text) AND (array_length(member_ids, 1) = 2));
CREATE INDEX idx_chat_channels_members ON public.chat_channels USING gin (member_ids);
CREATE INDEX idx_chat_channels_type ON public.chat_channels USING btree (type);
-- table: chat_messages
CREATE INDEX idx_chat_messages_channel ON public.chat_messages USING btree (channel_id, created_at DESC);
CREATE INDEX idx_chat_messages_mentions ON public.chat_messages USING gin (mentions);
CREATE INDEX idx_chat_messages_reply_to_id ON public.chat_messages USING btree (reply_to_id);
CREATE INDEX idx_chat_messages_search ON public.chat_messages USING gin (to_tsvector('english'::regconfig, content));
CREATE INDEX idx_chat_messages_sender ON public.chat_messages USING btree (sender_id);
-- table: chat_mutes
CREATE INDEX idx_chat_mutes_person ON public.chat_mutes USING btree (person_id);
-- table: chat_push_tokens
CREATE INDEX idx_chat_push_tokens_person ON public.chat_push_tokens USING btree (person_id);
-- table: chat_reactions
CREATE INDEX idx_chat_reactions_channel ON public.chat_reactions USING btree (channel_id);
-- table: client_deposits
CREATE INDEX idx_client_deposits_client_name ON public.client_deposits USING btree (client_name);
CREATE INDEX idx_client_deposits_date ON public.client_deposits USING btree (transaction_date DESC);
CREATE INDEX idx_client_deposits_invoice ON public.client_deposits USING btree (invoice_id);
-- table: client_intakes
CREATE INDEX idx_intakes_client ON public.client_intakes USING btree (client_id);
CREATE INDEX idx_intakes_created ON public.client_intakes USING btree (created_at DESC);
CREATE INDEX idx_intakes_lawyer ON public.client_intakes USING btree (assigned_lawyer_id);
CREATE INDEX idx_intakes_stage ON public.client_intakes USING btree (stage);
-- table: client_partner_notes
CREATE INDEX idx_client_partner_notes_client ON public.client_partner_notes USING btree (client_id, created_at DESC);
-- table: client_users
CREATE INDEX client_users_auth_user_id_idx ON public.client_users USING btree (auth_user_id) WHERE (auth_user_id IS NOT NULL);
CREATE INDEX client_users_client_id_idx ON public.client_users USING btree (client_id);
-- table: clients
CREATE UNIQUE INDEX clients_client_code_unique ON public.clients USING btree (client_code);
CREATE UNIQUE INDEX clients_name_unique_ci ON public.clients USING btree (lower(normalize_client_name(name)));
CREATE INDEX idx_clients_created ON public.clients USING btree (created_time DESC);
CREATE INDEX idx_clients_last_edited ON public.clients USING btree (notion_last_edited_at DESC);
CREATE INDEX idx_clients_name ON public.clients USING btree (name);
CREATE INDEX idx_clients_name_trgm ON public.clients USING gin (name gin_trgm_ops);
-- table: corporation_affiliations
CREATE INDEX corporation_affiliations_corp_idx ON public.corporation_affiliations USING btree (corporation_id, relation, sort_order);
-- table: corporation_files
CREATE INDEX corporation_files_filing_year_idx ON public.corporation_files USING btree (corporation_id, category, filing_year);
CREATE INDEX idx_corp_files_category ON public.corporation_files USING btree (corporation_id, category);
CREATE INDEX idx_corp_files_corp ON public.corporation_files USING btree (corporation_id);
CREATE INDEX idx_corp_files_person ON public.corporation_files USING btree (person_id) WHERE (person_id IS NOT NULL);
-- table: corporation_meetings
CREATE INDEX idx_corp_meetings_corp ON public.corporation_meetings USING btree (corporation_id);
CREATE INDEX idx_corp_meetings_date ON public.corporation_meetings USING btree (corporation_id, meeting_date DESC);
-- table: corporation_persons
CREATE INDEX idx_corp_persons_corp ON public.corporation_persons USING btree (corporation_id);
CREATE INDEX idx_corp_persons_role ON public.corporation_persons USING btree (corporation_id, role);
-- table: corporation_share_classes
CREATE INDEX corporation_share_classes_corp_idx ON public.corporation_share_classes USING btree (corporation_id, sort_order);
CREATE UNIQUE INDEX corporation_share_classes_unique_name ON public.corporation_share_classes USING btree (corporation_id, lower(class_name));
-- table: corporations
CREATE INDEX idx_corporations_engaging ON public.corporations USING btree (engaging_client_id);
CREATE INDEX idx_corporations_sec_date ON public.corporations USING btree (sec_registration_date DESC);
CREATE INDEX idx_corporations_status ON public.corporations USING btree (status);
CREATE UNIQUE INDEX uq_corporations_client ON public.corporations USING btree (client_id) WHERE (client_id IS NOT NULL);
-- table: deadline_chain_items
CREATE INDEX idx_deadline_chain_items_chain ON public.deadline_chain_items USING btree (chain_id);
CREATE INDEX idx_deadline_chain_items_entity ON public.deadline_chain_items USING btree (entity_type, entity_id);
-- table: deadline_chains
CREATE INDEX idx_deadline_chains_matter ON public.deadline_chains USING btree (matter_id);
-- table: deliverable_actions
CREATE INDEX idx_da_created ON public.deliverable_actions USING btree (created_at);
CREATE INDEX idx_da_deliverable ON public.deliverable_actions USING btree (deliverable_id);
-- table: deliverable_comment_reactions
CREATE INDEX idx_comment_reactions_comment ON public.deliverable_comment_reactions USING btree (comment_id);
-- table: deliverable_comments
CREATE INDEX idx_deliverable_comments_deliverable ON public.deliverable_comments USING btree (deliverable_id);
-- table: deliverable_files
CREATE UNIQUE INDEX deliverable_files_dedup_uidx ON public.deliverable_files USING btree (deliverable_id, version, file_url);
CREATE INDEX idx_df_deliverable ON public.deliverable_files USING btree (deliverable_id);
-- table: deliverable_version_reactions
CREATE INDEX idx_version_reactions_lookup ON public.deliverable_version_reactions USING btree (deliverable_id, version);
-- table: deliverables
CREATE INDEX deliverables_subtype_idx ON public.deliverables USING btree (subtype);
CREATE INDEX idx_deliv_created ON public.deliverables USING btree (created_time DESC);
CREATE INDEX idx_deliv_currently ON public.deliverables USING gin (currently_with_ids);
CREATE INDEX idx_deliv_drafter ON public.deliverables USING gin (drafter_ids);
CREATE INDEX idx_deliv_ext_due ON public.deliverables USING btree (external_due_date);
CREATE INDEX idx_deliv_related_hearing ON public.deliverables USING btree (related_hearing_id) WHERE (related_hearing_id IS NOT NULL);
CREATE INDEX idx_deliv_reviewers ON public.deliverables USING gin (reviewer_ids);
CREATE INDEX idx_deliv_source_deliv ON public.deliverables USING btree (source_deliverable_id) WHERE (source_deliverable_id IS NOT NULL);
CREATE INDEX idx_deliv_source_file ON public.deliverables USING btree (source_file_id) WHERE (source_file_id IS NOT NULL);
CREATE INDEX idx_deliv_status ON public.deliverables USING btree (status);
CREATE INDEX idx_deliverables_client_name_trgm ON public.deliverables USING gin (client_name gin_trgm_ops);
CREATE INDEX idx_deliverables_last_edited ON public.deliverables USING btree (notion_last_edited_at DESC);
CREATE INDEX idx_deliverables_matter_due ON public.deliverables USING btree (matter_id) WHERE (external_due_date IS NOT NULL);
CREATE INDEX idx_deliverables_matter_name_trgm ON public.deliverables USING gin (matter_name gin_trgm_ops);
CREATE INDEX idx_deliverables_name_trgm ON public.deliverables USING gin (name gin_trgm_ops);
CREATE INDEX idx_deliverables_status_report ON public.deliverables USING btree (lower(name)) WHERE (lower(name) ~~ '%status report%'::text);
-- table: directory
CREATE INDEX idx_directory_last_edited ON public.directory USING btree (notion_last_edited_at DESC);
CREATE INDEX idx_directory_name ON public.directory USING btree (name);
-- table: document_templates
CREATE INDEX idx_doc_templates_active ON public.document_templates USING btree (is_active);
CREATE INDEX idx_doc_templates_category ON public.document_templates USING btree (category);
CREATE INDEX idx_doc_templates_deadline_kind ON public.document_templates USING btree (deadline_kind) WHERE (deadline_kind IS NOT NULL);
-- table: dtr
CREATE INDEX dtr_non_billable_idx ON public.dtr USING btree (non_billable) WHERE (non_billable = false);
CREATE INDEX idx_dtr_client_billed_date ON public.dtr USING btree (client_name, billed, date);
CREATE INDEX idx_dtr_client_name ON public.dtr USING btree (client_name);
CREATE INDEX idx_dtr_created ON public.dtr USING btree (created_time DESC);
CREATE INDEX idx_dtr_date ON public.dtr USING btree (date);
CREATE INDEX idx_dtr_last_edited ON public.dtr USING btree (notion_last_edited_at DESC);
CREATE INDEX idx_dtr_lawyer ON public.dtr USING btree (lawyer_name);
CREATE INDEX idx_dtr_lawyer_date ON public.dtr USING btree (lawyer_name, date);
CREATE INDEX idx_dtr_matter_id ON public.dtr USING btree (matter_id);
CREATE INDEX idx_dtr_updated_at ON public.dtr USING btree (updated_at DESC);
CREATE INDEX idx_dtr_with_ids ON public.dtr USING gin (with_ids);
-- table: dtr_revision_comments
CREATE INDEX idx_dtr_rev_comment_revision ON public.dtr_revision_comments USING btree (revision_id);
CREATE INDEX idx_dtr_rev_comment_unresolved ON public.dtr_revision_comments USING btree (revision_id) WHERE (resolved = false);
-- table: dtr_revision_reviews
CREATE INDEX idx_dtr_review_month ON public.dtr_revision_reviews USING btree (billing_month);
CREATE INDEX idx_dtr_review_status ON public.dtr_revision_reviews USING btree (status);
CREATE INDEX idx_dtr_revision_reviews_clearance ON public.dtr_revision_reviews USING btree (billing_month, status, clearance_status);
-- table: dtr_revisions
CREATE INDEX idx_dtr_rev_bundle ON public.dtr_revisions USING btree (billing_month, client_name);
CREATE INDEX idx_dtr_rev_bundle_created ON public.dtr_revisions USING btree (billing_month, client_name, created_entry_key, edited_at DESC);
CREATE INDEX idx_dtr_rev_bundle_orig ON public.dtr_revisions USING btree (billing_month, client_name, original_dtr_id, edited_at DESC);
CREATE INDEX idx_dtr_rev_edited_at ON public.dtr_revisions USING btree (edited_at DESC);
-- table: email_attachments
CREATE INDEX idx_email_att_email ON public.email_attachments USING btree (email_id);
-- table: email_mailbox_copies
CREATE INDEX idx_email_copies_email ON public.email_mailbox_copies USING btree (email_id);
CREATE INDEX idx_email_copies_graph_msg ON public.email_mailbox_copies USING btree (graph_message_id);
CREATE INDEX idx_email_copies_mailbox ON public.email_mailbox_copies USING btree (mailbox_id);
-- table: email_matter_links
CREATE INDEX idx_eml_email ON public.email_matter_links USING btree (email_id);
CREATE INDEX idx_eml_matter ON public.email_matter_links USING btree (matter_id);
CREATE INDEX idx_eml_unlinked ON public.email_matter_links USING btree (confidence) WHERE (confidence < 0.80);
-- table: email_signatures
CREATE UNIQUE INDEX idx_email_signatures_default ON public.email_signatures USING btree (is_default) WHERE (is_default = true);
-- table: emails
CREATE INDEX idx_emails_conversation ON public.emails USING btree (conversation_id);
CREATE INDEX idx_emails_direction ON public.emails USING btree (direction);
CREATE INDEX idx_emails_from ON public.emails USING btree (from_address);
CREATE UNIQUE INDEX idx_emails_internet_message_id ON public.emails USING btree (internet_message_id) WHERE (internet_message_id IS NOT NULL);
CREATE INDEX idx_emails_received ON public.emails USING btree (received_at DESC);
CREATE INDEX idx_emails_subject_trgm ON public.emails USING gin (subject gin_trgm_ops);
-- table: embeddings
CREATE INDEX embeddings_hnsw_idx ON public.embeddings USING hnsw (embedding vector_cosine_ops) WITH (m='16', ef_construction='64');
CREATE INDEX embeddings_matter_id_idx ON public.embeddings USING btree (matter_id);
CREATE INDEX embeddings_source_idx ON public.embeddings USING btree (source_type, source_id);
-- table: engagement_proposals
CREATE INDEX engagement_proposals_client_idx ON public.engagement_proposals USING btree (client_id);
CREATE INDEX engagement_proposals_intake_idx ON public.engagement_proposals USING btree (intake_id);
CREATE UNIQUE INDEX engagement_proposals_thread_version ON public.engagement_proposals USING btree (thread_id, version);
-- table: engagement_signatures
CREATE INDEX engagement_signatures_matter_idx ON public.engagement_signatures USING btree (matter_id);
-- table: entity_comment_reactions
CREATE INDEX idx_entity_comment_reactions_comment ON public.entity_comment_reactions USING btree (comment_id);
-- table: entity_comments
CREATE INDEX idx_entity_comments_entity ON public.entity_comments USING btree (entity_type, entity_id);
CREATE INDEX idx_entity_comments_reply ON public.entity_comments USING btree (reply_to_id);
-- table: enum_options
CREATE INDEX enum_options_entity_field_idx ON public.enum_options USING btree (entity, field, sort_order) WHERE is_active;
CREATE UNIQUE INDEX enum_options_entity_field_value_idx ON public.enum_options USING btree (entity, field, value);
-- table: evaluation_period_discretionary_bonuses
CREATE INDEX idx_discretionary_bonuses_period_associate ON public.evaluation_period_discretionary_bonuses USING btree (period_id, associate_person_id);
-- table: evaluations
CREATE INDEX idx_evaluations_period_evaluatee ON public.evaluations USING btree (period_id, evaluatee_person_id);
CREATE INDEX idx_evaluations_period_evaluator ON public.evaluations USING btree (period_id, evaluator_person_id);
-- table: exhibits
CREATE INDEX idx_exhibits_file ON public.exhibits USING btree (file_id) WHERE (file_id IS NOT NULL);
CREATE INDEX idx_exhibits_matter ON public.exhibits USING btree (matter_id);
CREATE INDEX idx_exhibits_parent ON public.exhibits USING btree (parent_exhibit_id) WHERE (parent_exhibit_id IS NOT NULL);
-- table: expense_revisions
CREATE INDEX expense_revisions_bundle_idx ON public.expense_revisions USING btree (billing_month, client_name);
-- table: fee_schedules
CREATE UNIQUE INDEX fee_schedules_slug_key ON public.fee_schedules USING btree (slug);
-- table: feedbacks
CREATE INDEX idx_feedbacks_created ON public.feedbacks USING btree (created_time DESC);
CREATE INDEX idx_feedbacks_date ON public.feedbacks USING btree (feedback_date DESC);
CREATE INDEX idx_feedbacks_last_edited ON public.feedbacks USING btree (notion_last_edited_at DESC);
CREATE INDEX idx_feedbacks_submitted_by ON public.feedbacks USING btree (submitted_by);
-- table: file_analyses
CREATE UNIQUE INDEX file_analyses_email_attachment_active_uniq ON public.file_analyses USING btree (email_attachment_id) WHERE ((email_attachment_id IS NOT NULL) AND (status = ANY (ARRAY['completed'::text, 'processing'::text])));
CREATE INDEX file_analyses_email_attachment_idx ON public.file_analyses USING btree (email_attachment_id) WHERE (email_attachment_id IS NOT NULL);
CREATE INDEX idx_fa_deliverable_file ON public.file_analyses USING btree (deliverable_file_id) WHERE (deliverable_file_id IS NOT NULL);
CREATE UNIQUE INDEX idx_fa_deliverable_file_unique ON public.file_analyses USING btree (deliverable_file_id) WHERE ((deliverable_file_id IS NOT NULL) AND (status = ANY (ARRAY['completed'::text, 'processing'::text])));
CREATE INDEX idx_fa_file ON public.file_analyses USING btree (file_id);
CREATE UNIQUE INDEX idx_fa_file_attachment ON public.file_analyses USING btree (file_id, attachment_name) WHERE (status = ANY (ARRAY['completed'::text, 'processing'::text]));
-- table: file_requests
CREATE INDEX idx_file_requests_matter ON public.file_requests USING btree (matter_id);
CREATE INDEX idx_file_requests_open ON public.file_requests USING btree (matter_id) WHERE ((fulfilled_at IS NULL) AND (canceled_at IS NULL));
-- table: files
CREATE INDEX idx_files_created ON public.files USING btree (created_time DESC);
CREATE INDEX idx_files_file_request ON public.files USING btree (file_request_id) WHERE (file_request_id IS NOT NULL);
CREATE INDEX idx_files_last_edited ON public.files USING btree (notion_last_edited_at DESC);
CREATE INDEX idx_files_matter ON public.files USING btree (matter_id);
CREATE INDEX idx_files_matter_name_trgm ON public.files USING gin (matter_name gin_trgm_ops);
CREATE INDEX idx_files_name_trgm ON public.files USING gin (name gin_trgm_ops);
CREATE INDEX idx_files_uploaded_by_client_user ON public.files USING btree (uploaded_by_client_user_id) WHERE (uploaded_by_client_user_id IS NOT NULL);
-- table: firm_expenses
CREATE INDEX firm_expenses_category_idx ON public.firm_expenses USING btree (category);
CREATE INDEX firm_expenses_expense_date_idx ON public.firm_expenses USING btree (expense_date);
CREATE UNIQUE INDEX firm_expenses_template_month_uniq ON public.firm_expenses USING btree (recurring_template_id, materialized_month);
-- table: firm_profiles
CREATE UNIQUE INDEX firm_profiles_one_default ON public.firm_profiles USING btree (is_default) WHERE is_default;
-- table: generated_documents
CREATE INDEX idx_gen_docs_created ON public.generated_documents USING btree (created_at DESC);
CREATE INDEX idx_gen_docs_user ON public.generated_documents USING btree (generated_by);
-- table: hearings
CREATE INDEX idx_hearings_attendees ON public.hearings USING gin (attendee_ids);
CREATE INDEX idx_hearings_created ON public.hearings USING btree (created_time DESC);
CREATE INDEX idx_hearings_date ON public.hearings USING btree (date);
CREATE INDEX idx_hearings_last_edited ON public.hearings USING btree (notion_last_edited_at DESC);
CREATE INDEX idx_hearings_matter ON public.hearings USING btree (matter_id);
CREATE INDEX idx_hearings_matter_name_trgm ON public.hearings USING gin (matter_name gin_trgm_ops);
CREATE INDEX idx_hearings_name_trgm ON public.hearings USING gin (name gin_trgm_ops);
-- table: intake_stage_history
CREATE INDEX idx_ish_intake ON public.intake_stage_history USING btree (intake_id);
-- table: intake_submissions
CREATE INDEX intake_submissions_status_idx ON public.intake_submissions USING btree (status, created_at DESC);
-- table: invoice_payments
CREATE INDEX idx_invoice_payments_invoice ON public.invoice_payments USING btree (invoice_id);
-- table: invoices
CREATE INDEX idx_invoices_client ON public.invoices USING btree (client_name);
CREATE INDEX idx_invoices_month ON public.invoices USING btree (billing_month);
CREATE INDEX idx_invoices_month_status ON public.invoices USING btree (billing_month DESC, status);
CREATE INDEX idx_invoices_status ON public.invoices USING btree (status);
-- table: issuance_scrape_runs
CREATE INDEX idx_scrape_runs_source ON public.issuance_scrape_runs USING btree (source, started_at DESC);
CREATE INDEX idx_scrape_runs_started ON public.issuance_scrape_runs USING btree (started_at DESC);
-- table: issuances
CREATE INDEX idx_issuances_date_desc ON public.issuances USING btree (date_issued DESC NULLS LAST);
CREATE INDEX idx_issuances_low_conf ON public.issuances USING btree (ai_confidence) WHERE (ai_confidence = 'low'::text);
CREATE INDEX idx_issuances_src_type ON public.issuances USING btree (source, type);
CREATE INDEX idx_issuances_status ON public.issuances USING btree (status);
-- table: kb_jobs
CREATE INDEX kb_jobs_status_idx ON public.kb_jobs USING btree (status, started_at DESC);
-- table: kb_page_citations
CREATE INDEX kb_page_citations_matter_idx ON public.kb_page_citations USING btree (matter_id);
CREATE INDEX kb_page_citations_page_idx ON public.kb_page_citations USING btree (kb_page_id);
-- table: kb_page_matters
CREATE INDEX kb_page_matters_matter_idx ON public.kb_page_matters USING btree (matter_id);
-- table: kb_pages
CREATE INDEX kb_pages_fts_idx ON public.kb_pages USING gin (to_tsvector('english'::regconfig, ((title || ' '::text) || content_md)));
CREATE INDEX kb_pages_kind_status_idx ON public.kb_pages USING btree (kind, status);
CREATE INDEX kb_pages_status_idx ON public.kb_pages USING btree (status);
-- table: knowledge_searches
CREATE INDEX knowledge_searches_created_at ON public.knowledge_searches USING btree (created_at DESC);
CREATE INDEX knowledge_searches_query_trgm ON public.knowledge_searches USING gin (query gin_trgm_ops);
-- table: leaves
CREATE INDEX idx_leaves_created ON public.leaves USING btree (created_time DESC);
CREATE INDEX idx_leaves_last_edited ON public.leaves USING btree (notion_last_edited_at DESC);
CREATE INDEX idx_leaves_period ON public.leaves USING btree (period_start);
CREATE INDEX idx_leaves_person ON public.leaves USING btree (person_id);
CREATE INDEX idx_leaves_status ON public.leaves USING btree (status);
-- table: liaison_tasks
CREATE INDEX idx_liaison_tasks_assignee ON public.liaison_tasks USING btree (assigned_to);
CREATE INDEX idx_liaison_tasks_client ON public.liaison_tasks USING btree (client_id);
CREATE INDEX idx_liaison_tasks_deliverable ON public.liaison_tasks USING btree (deliverable_id);
CREATE INDEX idx_liaison_tasks_scheduled ON public.liaison_tasks USING btree (scheduled_for);
CREATE INDEX idx_liaison_tasks_status ON public.liaison_tasks USING btree (status);
-- table: matter_action_entries
CREATE INDEX idx_matter_action_entries_action ON public.matter_action_entries USING btree (action_id);
CREATE INDEX idx_matter_action_entries_matter ON public.matter_action_entries USING btree (matter_id);
CREATE INDEX idx_matter_action_entries_unbilled ON public.matter_action_entries USING btree (matter_id, invoiced, entry_date);
-- table: matter_billing_actions
CREATE INDEX idx_matter_billing_actions_matter ON public.matter_billing_actions USING btree (matter_id);
-- table: matter_billing_configs
CREATE INDEX idx_matter_billing_configs_matter ON public.matter_billing_configs USING btree (matter_id);
-- table: matter_billing_milestones
CREATE INDEX idx_matter_billing_milestones_matter ON public.matter_billing_milestones USING btree (matter_id);
CREATE INDEX idx_matter_billing_milestones_reached ON public.matter_billing_milestones USING btree (matter_id, reached_at, invoiced);
-- table: matter_exec_summaries
CREATE INDEX idx_matter_exec_summaries_updated_at ON public.matter_exec_summaries USING btree (updated_at DESC);
-- table: matter_expenses
CREATE INDEX idx_matter_expenses_billed ON public.matter_expenses USING btree (billed);
CREATE INDEX idx_matter_expenses_date ON public.matter_expenses USING btree (expense_date);
CREATE INDEX idx_matter_expenses_liaison_task ON public.matter_expenses USING btree (liaison_task_id);
CREATE INDEX idx_matter_expenses_matter ON public.matter_expenses USING btree (matter_id);
-- table: matter_health
CREATE INDEX idx_matter_health_needs_refresh ON public.matter_health USING btree (needs_refresh) WHERE (needs_refresh = true);
CREATE INDEX idx_matter_health_tier ON public.matter_health USING btree (tier);
-- table: matter_sol
CREATE INDEX idx_matter_sol_expiry ON public.matter_sol USING btree (expiry_date) WHERE (status = 'active'::text);
CREATE INDEX idx_matter_sol_matter ON public.matter_sol USING btree (matter_id);
-- table: matter_summaries
CREATE INDEX idx_matter_summaries_needs_refresh ON public.matter_summaries USING btree (needs_refresh) WHERE (needs_refresh = true);
CREATE INDEX idx_matter_summaries_updated_at ON public.matter_summaries USING btree (updated_at DESC);
-- table: matters
CREATE INDEX idx_matters_client ON public.matters USING btree (client_id);
CREATE INDEX idx_matters_client_name_trgm ON public.matters USING gin (client_name gin_trgm_ops);
CREATE INDEX idx_matters_client_status ON public.matters USING btree (client_name, status);
CREATE INDEX idx_matters_created ON public.matters USING btree (created_time DESC);
CREATE INDEX idx_matters_is_case ON public.matters USING btree (is_case);
CREATE INDEX idx_matters_last_activity ON public.matters USING btree (last_activity_at);
CREATE INDEX idx_matters_last_edited ON public.matters USING btree (notion_last_edited_at DESC);
CREATE INDEX idx_matters_matter_code_trgm ON public.matters USING gin (matter_code gin_trgm_ops);
CREATE INDEX idx_matters_name ON public.matters USING btree (name);
CREATE INDEX idx_matters_name_trgm ON public.matters USING gin (name gin_trgm_ops);
CREATE INDEX idx_matters_parent ON public.matters USING btree (parent_matter_id);
CREATE INDEX idx_matters_related ON public.matters USING gin (related_matter_ids);
CREATE INDEX idx_matters_team ON public.matters USING gin (team_person_ids);
-- table: meetings
CREATE INDEX idx_meetings_attendees ON public.meetings USING gin (attendee_ids);
CREATE INDEX idx_meetings_created ON public.meetings USING btree (created_time DESC);
CREATE INDEX idx_meetings_date ON public.meetings USING btree (date_start);
CREATE INDEX idx_meetings_last_edited ON public.meetings USING btree (notion_last_edited_at DESC);
CREATE INDEX idx_meetings_matter ON public.meetings USING btree (matter_id);
CREATE INDEX idx_meetings_matter_name_trgm ON public.meetings USING gin (matter_name gin_trgm_ops);
CREATE INDEX idx_meetings_name_trgm ON public.meetings USING gin (name gin_trgm_ops);
-- table: notification_mutes
CREATE INDEX idx_notification_mutes_person ON public.notification_mutes USING btree (person_id, created_at DESC);
-- table: notifications
CREATE INDEX idx_notifications_entity ON public.notifications USING btree (entity_id, type);
CREATE INDEX idx_notifications_person_priority_unread ON public.notifications USING btree (person_id, priority, read, created_at DESC);
CREATE INDEX idx_notifications_person_unread ON public.notifications USING btree (person_id, read, created_at DESC);
-- table: parties
CREATE INDEX idx_parties_aliases ON public.parties USING gin (aliases);
CREATE INDEX idx_parties_matter ON public.parties USING btree (matter_id);
CREATE INDEX idx_parties_name_trgm ON public.parties USING gin (party_name gin_trgm_ops);
CREATE INDEX idx_parties_role ON public.parties USING btree (party_role);
CREATE INDEX idx_parties_tin ON public.parties USING btree (tin) WHERE (tin <> ''::text);
-- table: partner_matter_annotations
CREATE INDEX idx_pma_partner ON public.partner_matter_annotations USING btree (partner_id);
-- table: ph_holidays
CREATE INDEX idx_ph_holidays_date ON public.ph_holidays USING btree (date);
-- table: pleading_red_team_comments
CREATE INDEX pleading_red_team_comments_run_idx ON public.pleading_red_team_comments USING btree (red_team_id, created_at);
-- table: pleading_red_teams
CREATE INDEX pleading_red_teams_deliverable_idx ON public.pleading_red_teams USING btree (deliverable_id);
CREATE INDEX pleading_red_teams_matter_idx ON public.pleading_red_teams USING btree (matter_id);
CREATE INDEX pleading_red_teams_reviewer_idx ON public.pleading_red_teams USING btree (reviewed_by, created_at DESC);
-- table: portal_chat_messages
CREATE INDEX portal_chat_messages_user_matter_idx ON public.portal_chat_messages USING btree (client_user_id, matter_id, created_at);
-- table: push_subscriptions
CREATE INDEX idx_push_sub_email ON public.push_subscriptions USING btree (email);
-- table: reimbursements
CREATE INDEX idx_reimb_created ON public.reimbursements USING btree (created_time DESC);
CREATE INDEX idx_reimb_date ON public.reimbursements USING btree (expense_date);
CREATE INDEX idx_reimb_lawyer ON public.reimbursements USING gin (lawyer_ids);
CREATE INDEX idx_reimb_liaison ON public.reimbursements USING btree (liaison_task_id);
CREATE INDEX idx_reimb_reimbursed ON public.reimbursements USING btree (reimbursed);
CREATE INDEX idx_reimbursements_client_reimbursed_date ON public.reimbursements USING btree (client_name, reimbursed, expense_date);
CREATE INDEX idx_reimbursements_last_edited ON public.reimbursements USING btree (notion_last_edited_at DESC);
-- table: resolution_templates
CREATE INDEX idx_resolution_templates_active ON public.resolution_templates USING btree (is_active);
CREATE INDEX idx_resolution_templates_category ON public.resolution_templates USING btree (category);
-- table: resolutions
CREATE INDEX idx_resolutions_corp ON public.resolutions USING btree (corporation_id);
CREATE INDEX idx_resolutions_date ON public.resolutions USING btree (corporation_id, date_of_resolution DESC);
CREATE INDEX idx_resolutions_meeting ON public.resolutions USING btree (meeting_id);
-- table: resources
CREATE INDEX idx_resources_category ON public.resources USING btree (category);
CREATE INDEX idx_resources_pinned ON public.resources USING btree (pinned, created_at DESC);
CREATE INDEX idx_resources_published ON public.resources USING btree (is_published);
CREATE INDEX idx_resources_slug ON public.resources USING btree (slug);
-- table: rule_sets
CREATE INDEX idx_rule_sets_matter_types ON public.rule_sets USING gin (applicable_matter_types);
-- table: saved_reports
CREATE INDEX idx_saved_reports_owner ON public.saved_reports USING btree (owner_id);
CREATE INDEX idx_saved_reports_shared ON public.saved_reports USING btree (shared_scope) WHERE (shared_scope = 'firm'::text);
-- table: scope_templates
CREATE UNIQUE INDEX scope_templates_slug_key ON public.scope_templates USING btree (slug);
-- table: sla_breaches
CREATE INDEX idx_sla_breaches_unresolved ON public.sla_breaches USING btree (deliverable_id) WHERE (resolved_at IS NULL);
CREATE UNIQUE INDEX sla_breaches_open_unique ON public.sla_breaches USING btree (deliverable_id, rule_id) WHERE (resolved_at IS NULL);
-- table: sla_rules
CREATE INDEX idx_sla_rules_active ON public.sla_rules USING btree (is_active) WHERE (is_active = true);
-- table: sync_log
CREATE INDEX idx_sync_log_table ON public.sync_log USING btree (table_name, started_at DESC);
-- table: tasks
CREATE INDEX idx_tasks_assignee ON public.tasks USING gin (assignee_ids);
CREATE INDEX idx_tasks_done ON public.tasks USING btree (done);
CREATE INDEX idx_tasks_due_date ON public.tasks USING btree (due_date);
CREATE INDEX idx_tasks_last_edited ON public.tasks USING btree (notion_last_edited_at DESC);
CREATE INDEX idx_tasks_matter ON public.tasks USING btree (matter_id);
CREATE INDEX idx_tasks_matter_name_trgm ON public.tasks USING gin (matter_name gin_trgm_ops);
CREATE INDEX idx_tasks_name_trgm ON public.tasks USING gin (name gin_trgm_ops);
-- table: team
CREATE INDEX idx_team_active ON public.team USING btree (active);
CREATE INDEX idx_team_last_edited ON public.team USING btree (notion_last_edited_at DESC);
CREATE INDEX idx_team_person ON public.team USING btree (person_id);
CREATE UNIQUE INDEX team_auth_user_id_key ON public.team USING btree (auth_user_id) WHERE (auth_user_id IS NOT NULL);
CREATE UNIQUE INDEX team_telegram_user_id_key ON public.team USING btree (telegram_user_id) WHERE (telegram_user_id IS NOT NULL);
-- table: telegram_link_codes
CREATE INDEX telegram_link_codes_person_idx ON public.telegram_link_codes USING btree (person_id);
-- table: telegram_messages
CREATE INDEX telegram_messages_chat_idx ON public.telegram_messages USING btree (chat_id, created_at);
-- table: trademark_client_reports
CREATE INDEX idx_tm_reports_deadline ON public.trademark_client_reports USING btree (trademark_id, deadline_kind, deadline_due);
CREATE INDEX idx_tm_reports_trademark ON public.trademark_client_reports USING btree (trademark_id);
-- table: trademark_files
CREATE INDEX idx_trademark_files_trademark ON public.trademark_files USING btree (trademark_id);
-- table: trademarks
CREATE INDEX idx_trademarks_client ON public.trademarks USING btree (client_id);
CREATE INDEX idx_trademarks_filing_date ON public.trademarks USING btree (filing_date DESC);
CREATE INDEX idx_trademarks_matter ON public.trademarks USING btree (matter_id);
CREATE INDEX idx_trademarks_status ON public.trademarks USING btree (status);
CREATE UNIQUE INDEX uq_trademarks_client_index ON public.trademarks USING btree (client_id, client_index) WHERE ((client_id IS NOT NULL) AND (client_index > 0));
-- table: transportation_zones
CREATE INDEX idx_zones_active ON public.transportation_zones USING btree (active);

-- ───────────────── 06_views ─────────────────
create or replace view public.filings as
 SELECT notion_id,
    notion_url,
    name,
    external_due_date AS date,
    matter_id,
    matter_name,
    status,
    currently_with_ids AS attendee_ids,
    NULL::text AS related_deliverable_id
   FROM deliverables
  WHERE type = 'External'::text AND external_due_date IS NOT NULL;

create or replace view public.v_deliverable_version_lookup as
 SELECT df.id AS deliverable_file_id,
    df.deliverable_id,
    df.version,
    df.file_name,
    d.name AS deliverable_name,
    d.matter_id,
    d.matter_name,
    d.type AS deliverable_type
   FROM deliverable_files df
     JOIN deliverables d ON d.notion_id = df.deliverable_id;

-- ───────────────── 07_triggers ─────────────────
-- All non-internal triggers on public tables (48 in live DB), ordered by table then trigger name.

CREATE TRIGGER announcements_set_last_edited_trg BEFORE UPDATE ON public.announcements FOR EACH ROW EXECUTE FUNCTION set_notion_last_edited();

CREATE TRIGGER attendance_set_last_edited_trg BEFORE UPDATE ON public.attendance FOR EACH ROW EXECUTE FUNCTION set_notion_last_edited();

CREATE TRIGGER touch_matter_activity_chat_messages AFTER INSERT ON public.chat_messages FOR EACH ROW EXECUTE FUNCTION touch_matter_activity_via_channel();

CREATE TRIGGER client_deposits_apply AFTER INSERT OR DELETE OR UPDATE ON public.client_deposits FOR EACH ROW EXECUTE FUNCTION trg_client_deposits_apply();

CREATE TRIGGER clients_normalize_name_trg BEFORE INSERT OR UPDATE OF name ON public.clients FOR EACH ROW EXECUTE FUNCTION clients_normalize_name();

CREATE TRIGGER clients_set_last_edited_trg BEFORE UPDATE ON public.clients FOR EACH ROW EXECUTE FUNCTION set_notion_last_edited();

CREATE TRIGGER trg_corporations_derive_status BEFORE INSERT OR UPDATE ON public.corporations FOR EACH ROW EXECUTE FUNCTION corporations_derive_status();

CREATE TRIGGER deliverables_set_last_edited_trg BEFORE UPDATE ON public.deliverables FOR EACH ROW EXECUTE FUNCTION deliverables_set_last_edited();

CREATE TRIGGER on_deliverable_finalized_sync AFTER UPDATE OF status ON public.deliverables FOR EACH ROW EXECUTE FUNCTION webhook_deliverable_finalized();

CREATE TRIGGER touch_matter_activity_deliverables AFTER INSERT OR UPDATE ON public.deliverables FOR EACH ROW EXECUTE FUNCTION touch_matter_activity('created_time');

CREATE TRIGGER trg_break_status_report_links_on_archive AFTER UPDATE OF status ON public.deliverables FOR EACH ROW EXECUTE FUNCTION break_status_report_links_on_archive();

CREATE TRIGGER trg_notify_new_deliverable AFTER INSERT ON public.deliverables FOR EACH ROW EXECUTE FUNCTION notify_new_deliverable();

CREATE TRIGGER trg_refresh_summary_on_deliverable AFTER INSERT ON public.deliverables FOR EACH ROW EXECUTE FUNCTION queue_matter_summary_refresh();

CREATE TRIGGER directory_set_last_edited_trg BEFORE UPDATE ON public.directory FOR EACH ROW EXECUTE FUNCTION set_notion_last_edited();

CREATE TRIGGER dtr_set_last_edited_trg BEFORE UPDATE ON public.dtr FOR EACH ROW EXECUTE FUNCTION set_notion_last_edited();

CREATE TRIGGER dtr_set_non_billable_trg BEFORE INSERT OR UPDATE OF remarks ON public.dtr FOR EACH ROW EXECUTE FUNCTION dtr_set_non_billable();

CREATE TRIGGER dtr_set_updated_at_trg BEFORE UPDATE ON public.dtr FOR EACH ROW EXECUTE FUNCTION dtr_set_updated_at();

CREATE TRIGGER touch_matter_activity_dtr AFTER INSERT OR UPDATE ON public.dtr FOR EACH ROW EXECUTE FUNCTION touch_matter_activity('created_time');

CREATE TRIGGER touch_matter_activity_email_links AFTER INSERT OR UPDATE ON public.email_matter_links FOR EACH ROW EXECUTE FUNCTION touch_matter_activity('created_at');

CREATE TRIGGER enum_options_touch_updated_at BEFORE UPDATE ON public.enum_options FOR EACH ROW EXECUTE FUNCTION enum_options_touch_updated_at();

CREATE TRIGGER evaluations_set_updated_at BEFORE UPDATE ON public.evaluations FOR EACH ROW EXECUTE FUNCTION set_evaluations_updated_at();

CREATE TRIGGER trg_exhibits_updated_at BEFORE UPDATE ON public.exhibits FOR EACH ROW EXECUTE FUNCTION exhibits_set_updated_at();

CREATE TRIGGER feedbacks_set_last_edited_trg BEFORE UPDATE ON public.feedbacks FOR EACH ROW EXECUTE FUNCTION set_notion_last_edited();

CREATE TRIGGER on_analysis_completed AFTER UPDATE OF status ON public.file_analyses FOR EACH ROW EXECUTE FUNCTION webhook_analysis_completed();

CREATE TRIGGER files_set_last_edited_trg BEFORE UPDATE ON public.files FOR EACH ROW EXECUTE FUNCTION set_notion_last_edited();

CREATE TRIGGER on_file_urls_changed AFTER UPDATE OF file_urls ON public.files FOR EACH ROW EXECUTE FUNCTION webhook_file_uploaded();

CREATE TRIGGER touch_matter_activity_files AFTER INSERT OR UPDATE ON public.files FOR EACH ROW EXECUTE FUNCTION touch_matter_activity('created_time');

CREATE TRIGGER trg_clear_status_report_source_file BEFORE DELETE ON public.files FOR EACH ROW EXECUTE FUNCTION clear_status_report_source_file_on_delete();

CREATE TRIGGER trg_refresh_summary_on_file AFTER INSERT ON public.files FOR EACH ROW EXECUTE FUNCTION queue_matter_summary_refresh();

CREATE TRIGGER hearings_set_last_edited_trg BEFORE UPDATE ON public.hearings FOR EACH ROW EXECUTE FUNCTION set_notion_last_edited();

CREATE TRIGGER touch_matter_activity_hearings AFTER INSERT OR UPDATE ON public.hearings FOR EACH ROW EXECUTE FUNCTION touch_matter_activity('created_time');

CREATE TRIGGER trg_refresh_summary_on_hearing AFTER INSERT ON public.hearings FOR EACH ROW EXECUTE FUNCTION queue_matter_summary_refresh();

CREATE TRIGGER leaves_set_last_edited_trg BEFORE UPDATE ON public.leaves FOR EACH ROW EXECUTE FUNCTION set_notion_last_edited();

CREATE TRIGGER touch_matter_activity_action_entries AFTER INSERT OR UPDATE ON public.matter_action_entries FOR EACH ROW EXECUTE FUNCTION touch_matter_activity('created_at');

CREATE TRIGGER matter_billing_actions_touch BEFORE UPDATE ON public.matter_billing_actions FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TRIGGER touch_matter_activity_billing_actions AFTER INSERT OR UPDATE ON public.matter_billing_actions FOR EACH ROW EXECUTE FUNCTION touch_matter_activity('created_at');

CREATE TRIGGER matter_billing_milestones_touch BEFORE UPDATE ON public.matter_billing_milestones FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TRIGGER touch_matter_activity_billing_milestones AFTER INSERT OR UPDATE ON public.matter_billing_milestones FOR EACH ROW EXECUTE FUNCTION touch_matter_activity('created_at');

CREATE TRIGGER touch_matter_activity_expenses AFTER INSERT OR UPDATE ON public.matter_expenses FOR EACH ROW EXECUTE FUNCTION touch_matter_activity('created_at');

CREATE TRIGGER matters_recalc_client_status AFTER INSERT OR DELETE OR UPDATE OF status, client_id ON public.matters FOR EACH ROW EXECUTE FUNCTION matters_recalc_client_status_trg();

CREATE TRIGGER matters_set_last_edited_trg BEFORE UPDATE ON public.matters FOR EACH ROW EXECUTE FUNCTION set_notion_last_edited();

CREATE TRIGGER trg_sync_matter_chat_members AFTER INSERT OR UPDATE OF team_person_ids, name ON public.matters FOR EACH ROW EXECUTE FUNCTION sync_matter_chat_members();

CREATE TRIGGER meetings_set_last_edited_trg BEFORE UPDATE ON public.meetings FOR EACH ROW EXECUTE FUNCTION set_notion_last_edited();

CREATE TRIGGER touch_matter_activity_meetings AFTER INSERT OR UPDATE ON public.meetings FOR EACH ROW EXECUTE FUNCTION touch_matter_activity('created_time');

CREATE TRIGGER notifications_set_priority BEFORE INSERT ON public.notifications FOR EACH ROW EXECUTE FUNCTION set_notification_priority();

CREATE TRIGGER reimbursements_set_last_edited_trg BEFORE UPDATE ON public.reimbursements FOR EACH ROW EXECUTE FUNCTION set_notion_last_edited();

CREATE TRIGGER tasks_set_last_edited_trg BEFORE UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION set_notion_last_edited();

CREATE TRIGGER touch_matter_activity_tasks AFTER INSERT OR UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION touch_matter_activity('created_time');

CREATE TRIGGER team_set_last_edited_trg BEFORE UPDATE ON public.team FOR EACH ROW EXECUTE FUNCTION set_notion_last_edited();

-- ───────────────── 08_rls_policies ─────────────────
-- Section 1: RLS enablement (137 tables in live DB; none have FORCE row level security).
-- The only public table WITHOUT row level security in the live DB is: drafting_idempotency.

alter table public.affidavit_review_comments enable row level security;
alter table public.affidavit_reviews enable row level security;
alter table public.agent_proposals enable row level security;
alter table public.agent_runs enable row level security;
alter table public.agents enable row level security;
alter table public.announcements enable row level security;
alter table public.assistant_announcements enable row level security;
alter table public.assistant_digest_log enable row level security;
alter table public.assistant_digest_settings enable row level security;
alter table public.assistant_messages enable row level security;
alter table public.assistant_preferences enable row level security;
alter table public.assistant_reminders enable row level security;
alter table public.attendance enable row level security;
alter table public.audit_log enable row level security;
alter table public.backfill_state enable row level security;
alter table public.billing_rates enable row level security;
alter table public.calendar_sync_events enable row level security;
alter table public.chat_channels enable row level security;
alter table public.chat_messages enable row level security;
alter table public.chat_mutes enable row level security;
alter table public.chat_push_tokens enable row level security;
alter table public.chat_reactions enable row level security;
alter table public.chat_read_receipts enable row level security;
alter table public.client_code_counters enable row level security;
alter table public.client_deposits enable row level security;
alter table public.client_intakes enable row level security;
alter table public.client_partner_notes enable row level security;
alter table public.client_users enable row level security;
alter table public.clients enable row level security;
alter table public.corporation_affiliations enable row level security;
alter table public.corporation_files enable row level security;
alter table public.corporation_meetings enable row level security;
alter table public.corporation_persons enable row level security;
alter table public.corporation_share_classes enable row level security;
alter table public.corporations enable row level security;
alter table public.deadline_chain_items enable row level security;
alter table public.deadline_chains enable row level security;
alter table public.deliverable_actions enable row level security;
alter table public.deliverable_comment_reactions enable row level security;
alter table public.deliverable_comments enable row level security;
alter table public.deliverable_files enable row level security;
alter table public.deliverable_version_reactions enable row level security;
alter table public.deliverables enable row level security;
alter table public.directory enable row level security;
alter table public.document_templates enable row level security;
alter table public.drafting_style_profiles enable row level security;
alter table public.dtr enable row level security;
alter table public.dtr_revision_comments enable row level security;
alter table public.dtr_revision_reviews enable row level security;
alter table public.dtr_revisions enable row level security;
alter table public.email_attachments enable row level security;
alter table public.email_mailbox_copies enable row level security;
alter table public.email_mailboxes enable row level security;
alter table public.email_matter_links enable row level security;
alter table public.email_signatures enable row level security;
alter table public.email_templates enable row level security;
alter table public.emails enable row level security;
alter table public.embeddings enable row level security;
alter table public.engagement_proposals enable row level security;
alter table public.engagement_signatures enable row level security;
alter table public.entity_comment_reactions enable row level security;
alter table public.entity_comments enable row level security;
alter table public.enum_options enable row level security;
alter table public.evaluation_period_discretionary_bonuses enable row level security;
alter table public.evaluation_period_other_bonuses enable row level security;
alter table public.evaluation_periods enable row level security;
alter table public.evaluation_scores enable row level security;
alter table public.evaluations enable row level security;
alter table public.exhibits enable row level security;
alter table public.expense_revisions enable row level security;
alter table public.fee_schedules enable row level security;
alter table public.feedbacks enable row level security;
alter table public.file_analyses enable row level security;
alter table public.file_requests enable row level security;
alter table public.files enable row level security;
alter table public.firm_expense_templates enable row level security;
alter table public.firm_expenses enable row level security;
alter table public.firm_invoice_settings enable row level security;
alter table public.firm_profiles enable row level security;
alter table public.generated_documents enable row level security;
alter table public.hearings enable row level security;
alter table public.intake_stage_history enable row level security;
alter table public.intake_submissions enable row level security;
alter table public.invoice_number_counters enable row level security;
alter table public.invoice_payments enable row level security;
alter table public.invoices enable row level security;
alter table public.issuance_scrape_runs enable row level security;
alter table public.issuances enable row level security;
alter table public.kb_jobs enable row level security;
alter table public.kb_page_citations enable row level security;
alter table public.kb_page_matters enable row level security;
alter table public.kb_pages enable row level security;
alter table public.knowledge_searches enable row level security;
alter table public.leaves enable row level security;
alter table public.liaison_tasks enable row level security;
alter table public.matter_action_entries enable row level security;
alter table public.matter_billing_actions enable row level security;
alter table public.matter_billing_configs enable row level security;
alter table public.matter_billing_milestones enable row level security;
alter table public.matter_exec_summaries enable row level security;
alter table public.matter_expenses enable row level security;
alter table public.matter_group_summaries enable row level security;
alter table public.matter_health enable row level security;
alter table public.matter_sol enable row level security;
alter table public.matter_summaries enable row level security;
alter table public.matters enable row level security;
alter table public.meetings enable row level security;
alter table public.notification_mutes enable row level security;
alter table public.notifications enable row level security;
alter table public.parties enable row level security;
alter table public.partner_matter_annotations enable row level security;
alter table public.ph_holidays enable row level security;
alter table public.pleading_red_team_comments enable row level security;
alter table public.pleading_red_teams enable row level security;
alter table public.portal_chat_messages enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.reimbursements enable row level security;
alter table public.resolution_templates enable row level security;
alter table public.resolutions enable row level security;
alter table public.resources enable row level security;
alter table public.rule_deadlines enable row level security;
alter table public.rule_sets enable row level security;
alter table public.saved_reports enable row level security;
alter table public.scope_templates enable row level security;
alter table public.sla_breaches enable row level security;
alter table public.sla_rules enable row level security;
alter table public.sync_log enable row level security;
alter table public.tasks enable row level security;
alter table public.team enable row level security;
alter table public.telegram_link_codes enable row level security;
alter table public.telegram_messages enable row level security;
alter table public.trademark_client_reports enable row level security;
alter table public.trademark_files enable row level security;
alter table public.trademarks enable row level security;
alter table public.transportation_zones enable row level security;
alter table public.user_passwords enable row level security;
alter table public.user_preferences enable row level security;

-- Section 2: policies (196 in live DB), ordered by table then policy name.

create policy "agent_proposals_matter_select" on public.agent_proposals as permissive for select to authenticated using (has_matter_access(matter_id));

create policy "agent_proposals_matter_write" on public.agent_proposals as permissive for all to authenticated using (has_matter_access(matter_id)) with check (has_matter_access(matter_id));

create policy "agents_team_select" on public.agents as permissive for select to authenticated using ((current_person_id() IS NOT NULL));

create policy "announcements_admin_write" on public.announcements as permissive for all to authenticated using (("current_role"() = ANY (ARRAY['admin'::text, 'super_user'::text]))) with check (("current_role"() = ANY (ARRAY['admin'::text, 'super_user'::text])));

create policy "announcements_authenticated_select" on public.announcements as permissive for select to authenticated using ((current_person_id() IS NOT NULL));

create policy "attendance_own_modify" on public.attendance as permissive for all to authenticated using (((lawyer_id = ANY (current_person_identifiers())) OR ("current_role"() = ANY (ARRAY['admin'::text, 'super_user'::text])))) with check (((lawyer_id = ANY (current_person_identifiers())) OR ("current_role"() = ANY (ARRAY['admin'::text, 'super_user'::text]))));

create policy "attendance_own_select" on public.attendance as permissive for select to authenticated using (((lawyer_id = ANY (current_person_identifiers())) OR ("current_role"() = ANY (ARRAY['partner'::text, 'admin'::text, 'finance'::text, 'super_user'::text]))));

create policy "billing_rates_finance_all" on public.billing_rates as permissive for all to authenticated using (("current_role"() = ANY (ARRAY['finance'::text, 'admin'::text, 'super_user'::text]))) with check (("current_role"() = ANY (ARRAY['finance'::text, 'admin'::text, 'super_user'::text])));

create policy "chat_channels_member_select" on public.chat_channels as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM team t
  WHERE ((t.auth_user_id = auth.uid()) AND t.active AND (t.person_id = ANY (chat_channels.member_ids))))));

create policy "chat_messages_channel_member_select" on public.chat_messages as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM (chat_channels c
     JOIN team t ON ((t.person_id = ANY (c.member_ids))))
  WHERE ((c.id = chat_messages.channel_id) AND (t.auth_user_id = auth.uid()) AND t.active))));

create policy "chat_reactions_channel_member_select" on public.chat_reactions as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM (chat_channels c
     JOIN team t ON ((t.person_id = ANY (c.member_ids))))
  WHERE ((c.id = chat_reactions.channel_id) AND (t.auth_user_id = auth.uid()) AND t.active))));

create policy "chat_read_receipts_channel_member_select" on public.chat_read_receipts as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM (chat_channels c
     JOIN team t ON ((t.person_id = ANY (c.member_ids))))
  WHERE ((c.id = chat_read_receipts.channel_id) AND (t.auth_user_id = auth.uid()) AND t.active))));

create policy "client_deposits_finance_all" on public.client_deposits as permissive for all to authenticated using (("current_role"() = ANY (ARRAY['finance'::text, 'admin'::text, 'super_user'::text]))) with check (("current_role"() = ANY (ARRAY['finance'::text, 'admin'::text, 'super_user'::text])));

create policy "client_deposits_portal_select" on public.client_deposits as permissive for select to authenticated using ((client_id IN ( SELECT client_users.client_id
   FROM client_users
  WHERE ((client_users.auth_user_id = auth.uid()) AND (client_users.active = true)))));

create policy "client_intakes_assigned_or_admin_write" on public.client_intakes as permissive for all to authenticated using (((assigned_lawyer_id = current_person_id()) OR ("current_role"() = ANY (ARRAY['admin'::text, 'super_user'::text, 'partner'::text])))) with check (((assigned_lawyer_id = current_person_id()) OR ("current_role"() = ANY (ARRAY['admin'::text, 'super_user'::text, 'partner'::text]))));

create policy "client_intakes_team_select" on public.client_intakes as permissive for select to authenticated using ((current_person_id() IS NOT NULL));

create policy "client_partner_notes_delete" on public.client_partner_notes as permissive for delete to authenticated using (("current_role"() = ANY (ARRAY['partner'::text, 'super_user'::text])));

create policy "client_partner_notes_insert" on public.client_partner_notes as permissive for insert to authenticated with check ((("current_role"() = ANY (ARRAY['partner'::text, 'super_user'::text])) AND (author_id = current_person_id())));

create policy "client_partner_notes_modify" on public.client_partner_notes as permissive for update to authenticated using (("current_role"() = ANY (ARRAY['partner'::text, 'super_user'::text]))) with check (("current_role"() = ANY (ARRAY['partner'::text, 'super_user'::text])));

create policy "client_partner_notes_select" on public.client_partner_notes as permissive for select to authenticated using (("current_role"() = ANY (ARRAY['partner'::text, 'super_user'::text])));

create policy "client_users_select_own" on public.client_users as permissive for select to authenticated using ((auth_user_id = auth.uid()));

create policy "clients_portal_select" on public.clients as permissive for select to authenticated using ((notion_id IN ( SELECT client_users.client_id
   FROM client_users
  WHERE ((client_users.auth_user_id = auth.uid()) AND (client_users.active = true)))));

create policy "clients_team_select" on public.clients as permissive for select to authenticated using ((current_person_id() IS NOT NULL));

create policy "clients_team_write" on public.clients as permissive for all to authenticated using (("current_role"() = ANY (ARRAY['partner'::text, 'admin'::text, 'super_user'::text, 'finance'::text]))) with check (("current_role"() = ANY (ARRAY['partner'::text, 'admin'::text, 'super_user'::text, 'finance'::text])));

create policy "corporation_affiliations_team" on public.corporation_affiliations as permissive for all to authenticated using ((current_person_id() IS NOT NULL)) with check ((current_person_id() IS NOT NULL));

create policy "corporation_files_team" on public.corporation_files as permissive for all to authenticated using ((current_person_id() IS NOT NULL)) with check ((current_person_id() IS NOT NULL));

create policy "corporation_meetings_team" on public.corporation_meetings as permissive for all to authenticated using ((current_person_id() IS NOT NULL)) with check ((current_person_id() IS NOT NULL));

create policy "corporation_persons_team" on public.corporation_persons as permissive for all to authenticated using ((current_person_id() IS NOT NULL)) with check ((current_person_id() IS NOT NULL));

create policy "corporation_share_classes_team" on public.corporation_share_classes as permissive for all to authenticated using ((current_person_id() IS NOT NULL)) with check ((current_person_id() IS NOT NULL));

create policy "corporations_team_select" on public.corporations as permissive for select to authenticated using ((current_person_id() IS NOT NULL));

create policy "corporations_team_write" on public.corporations as permissive for all to public using ((current_person_id() IS NOT NULL)) with check ((current_person_id() IS NOT NULL));

create policy "deadline_chain_items_matter_access" on public.deadline_chain_items as permissive for all to authenticated using ((EXISTS ( SELECT 1
   FROM deadline_chains c
  WHERE ((c.id = deadline_chain_items.chain_id) AND has_matter_access(c.matter_id))))) with check ((EXISTS ( SELECT 1
   FROM deadline_chains c
  WHERE ((c.id = deadline_chain_items.chain_id) AND has_matter_access(c.matter_id)))));

create policy "deadline_chains_matter_select" on public.deadline_chains as permissive for select to authenticated using (has_matter_access(matter_id));

create policy "deadline_chains_matter_write" on public.deadline_chains as permissive for all to authenticated using (has_matter_access(matter_id)) with check (has_matter_access(matter_id));

create policy "deliverable_actions_matter_access" on public.deliverable_actions as permissive for all to authenticated using ((EXISTS ( SELECT 1
   FROM deliverables d
  WHERE ((d.notion_id = deliverable_actions.deliverable_id) AND has_matter_access(d.matter_id))))) with check ((EXISTS ( SELECT 1
   FROM deliverables d
  WHERE ((d.notion_id = deliverable_actions.deliverable_id) AND has_matter_access(d.matter_id)))));

create policy "deliverable_comment_reactions_matter_access" on public.deliverable_comment_reactions as permissive for all to authenticated using ((EXISTS ( SELECT 1
   FROM (deliverable_comments c
     JOIN deliverables d ON ((d.notion_id = c.deliverable_id)))
  WHERE ((c.id = deliverable_comment_reactions.comment_id) AND has_matter_access(d.matter_id))))) with check ((EXISTS ( SELECT 1
   FROM (deliverable_comments c
     JOIN deliverables d ON ((d.notion_id = c.deliverable_id)))
  WHERE ((c.id = deliverable_comment_reactions.comment_id) AND has_matter_access(d.matter_id)))));

create policy "deliverable_comments_matter_access" on public.deliverable_comments as permissive for all to authenticated using ((EXISTS ( SELECT 1
   FROM deliverables d
  WHERE ((d.notion_id = deliverable_comments.deliverable_id) AND has_matter_access(d.matter_id))))) with check ((EXISTS ( SELECT 1
   FROM deliverables d
  WHERE ((d.notion_id = deliverable_comments.deliverable_id) AND has_matter_access(d.matter_id)))));

create policy "deliverable_files_matter_access" on public.deliverable_files as permissive for all to authenticated using ((EXISTS ( SELECT 1
   FROM deliverables d
  WHERE ((d.notion_id = deliverable_files.deliverable_id) AND has_matter_access(d.matter_id))))) with check ((EXISTS ( SELECT 1
   FROM deliverables d
  WHERE ((d.notion_id = deliverable_files.deliverable_id) AND has_matter_access(d.matter_id)))));

create policy "deliverable_version_reactions_matter_access" on public.deliverable_version_reactions as permissive for all to authenticated using ((EXISTS ( SELECT 1
   FROM deliverables d
  WHERE ((d.notion_id = deliverable_version_reactions.deliverable_id) AND has_matter_access(d.matter_id))))) with check ((EXISTS ( SELECT 1
   FROM deliverables d
  WHERE ((d.notion_id = deliverable_version_reactions.deliverable_id) AND has_matter_access(d.matter_id)))));

create policy "deliverables_matter_select" on public.deliverables as permissive for select to authenticated using (has_matter_access(matter_id));

create policy "deliverables_matter_write" on public.deliverables as permissive for all to authenticated using (has_matter_access(matter_id)) with check (has_matter_access(matter_id));

create policy "deliverables_portal_select" on public.deliverables as permissive for select to authenticated using ((matter_id IN ( SELECT matters.notion_id
   FROM matters
  WHERE (matters.client_id IN ( SELECT client_users.client_id
           FROM client_users
          WHERE ((client_users.auth_user_id = auth.uid()) AND (client_users.active = true)))))));

create policy "directory_admin_write" on public.directory as permissive for all to authenticated using (("current_role"() = ANY (ARRAY['admin'::text, 'super_user'::text]))) with check (("current_role"() = ANY (ARRAY['admin'::text, 'super_user'::text])));

create policy "directory_authenticated_select" on public.directory as permissive for select to authenticated using ((current_person_id() IS NOT NULL));

create policy "document_templates_authenticated_select" on public.document_templates as permissive for select to authenticated using ((current_person_id() IS NOT NULL));

create policy "document_templates_creator_write" on public.document_templates as permissive for all to authenticated using (((created_by = current_person_id()) OR ("current_role"() = ANY (ARRAY['admin'::text, 'super_user'::text])))) with check (((created_by = current_person_id()) OR ("current_role"() = ANY (ARRAY['admin'::text, 'super_user'::text]))));

create policy "drafting_style_profiles_admin_write" on public.drafting_style_profiles as permissive for all to authenticated using (("current_role"() = ANY (ARRAY['partner'::text, 'admin'::text, 'super_user'::text]))) with check (("current_role"() = ANY (ARRAY['partner'::text, 'admin'::text, 'super_user'::text])));

create policy "drafting_style_profiles_staff_select" on public.drafting_style_profiles as permissive for select to authenticated using ((current_person_id() IS NOT NULL));

create policy "dtr_own_modify" on public.dtr as permissive for all to authenticated using (((lawyer_name = current_person_name()) OR ("current_role"() = ANY (ARRAY['admin'::text, 'super_user'::text, 'finance'::text])))) with check (((lawyer_name = current_person_name()) OR ("current_role"() = ANY (ARRAY['admin'::text, 'super_user'::text, 'finance'::text]))));

create policy "dtr_own_select" on public.dtr as permissive for select to authenticated using (((lawyer_name = current_person_name()) OR ("current_role"() = ANY (ARRAY['partner'::text, 'admin'::text, 'finance'::text, 'super_user'::text]))));

create policy "dtr_revision_comments_finance" on public.dtr_revision_comments as permissive for all to authenticated using (("current_role"() = ANY (ARRAY['finance'::text, 'admin'::text, 'super_user'::text, 'partner'::text]))) with check (("current_role"() = ANY (ARRAY['finance'::text, 'admin'::text, 'super_user'::text, 'partner'::text])));

create policy "dtr_revision_reviews_finance" on public.dtr_revision_reviews as permissive for all to authenticated using (("current_role"() = ANY (ARRAY['finance'::text, 'admin'::text, 'super_user'::text, 'partner'::text]))) with check (("current_role"() = ANY (ARRAY['finance'::text, 'admin'::text, 'super_user'::text, 'partner'::text])));

create policy "dtr_revisions_matter_select" on public.dtr_revisions as permissive for select to authenticated using (has_matter_access(matter_id));

create policy "dtr_revisions_matter_write" on public.dtr_revisions as permissive for all to authenticated using (has_matter_access(matter_id)) with check (has_matter_access(matter_id));

create policy "email_attachments_owner_matter_select" on public.email_attachments as permissive for select to authenticated using (can_access_email(email_id));

create policy "service_role_email_attachments" on public.email_attachments as permissive for all to service_role using (true) with check (true);

create policy "Service role full access on email_mailbox_copies" on public.email_mailbox_copies as permissive for all to public using ((auth.role() = 'service_role'::text)) with check ((auth.role() = 'service_role'::text));

create policy "email_mailbox_copies_owner_matter_select" on public.email_mailbox_copies as permissive for select to authenticated using (can_access_email(email_id));

create policy "email_mailboxes_scoped_select" on public.email_mailboxes as permissive for select to authenticated using (((current_person_id() IS NOT NULL) AND ((mailbox_type = 'shared'::text) OR (owner_person_id = current_person_id()) OR ("current_role"() = ANY (ARRAY['admin'::text, 'super_user'::text])))));

create policy "service_role_email_mailboxes" on public.email_mailboxes as permissive for all to service_role using (true) with check (true);

create policy "email_matter_links_matter_select" on public.email_matter_links as permissive for select to authenticated using (has_matter_access(matter_id));

create policy "email_matter_links_matter_write" on public.email_matter_links as permissive for all to authenticated using (has_matter_access(matter_id)) with check (has_matter_access(matter_id));

create policy "service_role_email_matter_links" on public.email_matter_links as permissive for all to service_role using (true) with check (true);

create policy "Service role full access on email_signatures" on public.email_signatures as permissive for all to public using ((auth.role() = 'service_role'::text)) with check ((auth.role() = 'service_role'::text));

create policy "service_role_email_templates" on public.email_templates as permissive for all to service_role using (true) with check (true);

create policy "emails_owner_matter_select" on public.emails as permissive for select to authenticated using (can_access_email(id));

create policy "service_role_emails" on public.emails as permissive for all to service_role using (true) with check (true);

create policy "engagement_proposals_assigned_or_admin_write" on public.engagement_proposals as permissive for all to authenticated using ((("current_role"() = ANY (ARRAY['admin'::text, 'super_user'::text, 'partner'::text])) OR ((intake_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM client_intakes i
  WHERE ((i.id = engagement_proposals.intake_id) AND (i.assigned_lawyer_id = current_person_id()))))))) with check ((("current_role"() = ANY (ARRAY['admin'::text, 'super_user'::text, 'partner'::text])) OR ((intake_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM client_intakes i
  WHERE ((i.id = engagement_proposals.intake_id) AND (i.assigned_lawyer_id = current_person_id())))))));

create policy "engagement_proposals_team_select" on public.engagement_proposals as permissive for select to authenticated using ((current_person_id() IS NOT NULL));

create policy "engagement_signatures_portal_select" on public.engagement_signatures as permissive for select to authenticated using ((matter_id IN ( SELECT matters.notion_id
   FROM matters
  WHERE (matters.client_id IN ( SELECT client_users.client_id
           FROM client_users
          WHERE ((client_users.auth_user_id = auth.uid()) AND (client_users.active = true)))))));

create policy "engagement_signatures_team_select" on public.engagement_signatures as permissive for select to authenticated using (has_matter_access(matter_id));

create policy "entity_comment_reactions_author_write" on public.entity_comment_reactions as permissive for all to authenticated using ((person_id = current_person_id())) with check ((person_id = current_person_id()));

create policy "entity_comment_reactions_team_select" on public.entity_comment_reactions as permissive for select to authenticated using ((current_person_id() IS NOT NULL));

create policy "entity_comments_author_write" on public.entity_comments as permissive for all to authenticated using (((person_id = current_person_id()) OR ("current_role"() = ANY (ARRAY['admin'::text, 'super_user'::text, 'partner'::text])))) with check (((person_id = current_person_id()) OR ("current_role"() = ANY (ARRAY['admin'::text, 'super_user'::text, 'partner'::text]))));

create policy "entity_comments_team_select" on public.entity_comments as permissive for select to authenticated using ((current_person_id() IS NOT NULL));

create policy "enum_options_authenticated_select" on public.enum_options as permissive for select to authenticated using (true);

create policy "discretionary_bonuses_visibility" on public.evaluation_period_discretionary_bonuses as permissive for select to authenticated using (((partner_person_id = current_person_id()) OR (associate_person_id = current_person_id()) OR ("current_role"() = ANY (ARRAY['partner'::text, 'admin'::text, 'super_user'::text]))));

create policy "discretionary_bonuses_write" on public.evaluation_period_discretionary_bonuses as permissive for all to authenticated using (("current_role"() = ANY (ARRAY['partner'::text, 'admin'::text, 'super_user'::text]))) with check (("current_role"() = ANY (ARRAY['partner'::text, 'admin'::text, 'super_user'::text])));

create policy "other_bonuses_visibility" on public.evaluation_period_other_bonuses as permissive for select to authenticated using (((person_id = current_person_id()) OR ("current_role"() = ANY (ARRAY['partner'::text, 'admin'::text, 'super_user'::text]))));

create policy "other_bonuses_write" on public.evaluation_period_other_bonuses as permissive for all to authenticated using (("current_role"() = ANY (ARRAY['partner'::text, 'admin'::text, 'super_user'::text]))) with check (("current_role"() = ANY (ARRAY['partner'::text, 'admin'::text, 'super_user'::text])));

create policy "evaluation_periods_authenticated_select" on public.evaluation_periods as permissive for select to authenticated using ((current_person_id() IS NOT NULL));

create policy "evaluation_periods_partner_write" on public.evaluation_periods as permissive for all to authenticated using (("current_role"() = ANY (ARRAY['admin'::text, 'super_user'::text, 'partner'::text]))) with check (("current_role"() = ANY (ARRAY['admin'::text, 'super_user'::text, 'partner'::text])));

create policy "evaluation_scores_visibility" on public.evaluation_scores as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM evaluations e
  WHERE ((e.id = evaluation_scores.evaluation_id) AND ((e.evaluator_person_id = current_person_id()) OR (e.evaluatee_person_id = current_person_id()) OR ("current_role"() = ANY (ARRAY['partner'::text, 'admin'::text, 'super_user'::text])))))));

create policy "evaluation_scores_write" on public.evaluation_scores as permissive for all to authenticated using (("current_role"() = ANY (ARRAY['partner'::text, 'admin'::text, 'super_user'::text]))) with check (("current_role"() = ANY (ARRAY['partner'::text, 'admin'::text, 'super_user'::text])));

create policy "evaluations_visibility" on public.evaluations as permissive for select to authenticated using (((evaluator_person_id = current_person_id()) OR (evaluatee_person_id = current_person_id()) OR ("current_role"() = ANY (ARRAY['partner'::text, 'admin'::text, 'super_user'::text]))));

create policy "evaluations_write" on public.evaluations as permissive for all to authenticated using (("current_role"() = ANY (ARRAY['partner'::text, 'admin'::text, 'super_user'::text]))) with check (("current_role"() = ANY (ARRAY['partner'::text, 'admin'::text, 'super_user'::text])));

create policy "exhibits_portal_select" on public.exhibits as permissive for select to authenticated using ((matter_id IN ( SELECT matters.notion_id
   FROM matters
  WHERE (matters.client_id IN ( SELECT client_users.client_id
           FROM client_users
          WHERE ((client_users.auth_user_id = auth.uid()) AND (client_users.active = true)))))));

create policy "exhibits_team_select" on public.exhibits as permissive for select to authenticated using (has_matter_access(matter_id));

create policy "exhibits_team_write" on public.exhibits as permissive for all to authenticated using ((("current_role"() = ANY (ARRAY['lawyer'::text, 'partner'::text, 'admin'::text, 'super_user'::text])) AND has_matter_access(matter_id))) with check ((("current_role"() = ANY (ARRAY['lawyer'::text, 'partner'::text, 'admin'::text, 'super_user'::text])) AND has_matter_access(matter_id)));

create policy "expense_revisions_finance" on public.expense_revisions as permissive for all to authenticated using (("current_role"() = ANY (ARRAY['finance'::text, 'admin'::text, 'super_user'::text, 'partner'::text]))) with check (("current_role"() = ANY (ARRAY['finance'::text, 'admin'::text, 'super_user'::text, 'partner'::text])));

create policy "fee_schedules_admin_write" on public.fee_schedules as permissive for all to authenticated using (("current_role"() = ANY (ARRAY['admin'::text, 'super_user'::text, 'finance'::text]))) with check (("current_role"() = ANY (ARRAY['admin'::text, 'super_user'::text, 'finance'::text])));

create policy "fee_schedules_read" on public.fee_schedules as permissive for select to authenticated using ((current_person_id() IS NOT NULL));

create policy "feedbacks_delete" on public.feedbacks as permissive for delete to authenticated using (((submitted_by = current_person_id()) OR ("current_role"() = ANY (ARRAY['admin'::text, 'super_user'::text]))));

create policy "feedbacks_insert" on public.feedbacks as permissive for insert to authenticated with check ((current_person_id() IS NOT NULL));

create policy "feedbacks_select" on public.feedbacks as permissive for select to authenticated using (((submitted_by = current_person_id()) OR ("current_role"() = ANY (ARRAY['admin'::text, 'partner'::text, 'super_user'::text]))));

create policy "feedbacks_update" on public.feedbacks as permissive for update to authenticated using (((submitted_by = current_person_id()) OR ("current_role"() = ANY (ARRAY['admin'::text, 'super_user'::text])))) with check (((submitted_by = current_person_id()) OR ("current_role"() = ANY (ARRAY['admin'::text, 'super_user'::text]))));

create policy "file_requests_portal_select" on public.file_requests as permissive for select to authenticated using ((matter_id IN ( SELECT matters.notion_id
   FROM matters
  WHERE (matters.client_id IN ( SELECT client_users.client_id
           FROM client_users
          WHERE ((client_users.auth_user_id = auth.uid()) AND (client_users.active = true)))))));

create policy "file_requests_team_select" on public.file_requests as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM team t
  WHERE ((t.auth_user_id = auth.uid()) AND t.active))));

create policy "file_requests_team_write" on public.file_requests as permissive for all to authenticated using (has_matter_access(matter_id)) with check (has_matter_access(matter_id));

create policy "files_portal_insert" on public.files as permissive for insert to authenticated with check (((matter_id IN ( SELECT matters.notion_id
   FROM matters
  WHERE (matters.client_id IN ( SELECT client_users.client_id
           FROM client_users
          WHERE ((client_users.auth_user_id = auth.uid()) AND (client_users.active = true)))))) AND (uploaded_by_client_user_id IN ( SELECT client_users.id
   FROM client_users
  WHERE (client_users.auth_user_id = auth.uid())))));

create policy "files_portal_select" on public.files as permissive for select to authenticated using ((matter_id IN ( SELECT matters.notion_id
   FROM matters
  WHERE (matters.client_id IN ( SELECT client_users.client_id
           FROM client_users
          WHERE ((client_users.auth_user_id = auth.uid()) AND (client_users.active = true)))))));

create policy "files_team_select" on public.files as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM team t
  WHERE ((t.auth_user_id = auth.uid()) AND t.active))));

create policy "files_team_write" on public.files as permissive for all to authenticated using (((matter_id IS NULL) OR has_matter_access(matter_id))) with check (((matter_id IS NULL) OR has_matter_access(matter_id)));

create policy "firm_expense_templates_finance_all" on public.firm_expense_templates as permissive for all to public using (("current_role"() = ANY (ARRAY['finance'::text, 'admin'::text, 'super_user'::text]))) with check (("current_role"() = ANY (ARRAY['finance'::text, 'admin'::text, 'super_user'::text])));

create policy "firm_expenses_finance_all" on public.firm_expenses as permissive for all to public using (("current_role"() = ANY (ARRAY['finance'::text, 'admin'::text, 'super_user'::text]))) with check (("current_role"() = ANY (ARRAY['finance'::text, 'admin'::text, 'super_user'::text])));

create policy "firm_invoice_settings_manage" on public.firm_invoice_settings as permissive for all to authenticated using (("current_role"() = ANY (ARRAY['admin'::text, 'super_user'::text, 'finance'::text]))) with check (("current_role"() = ANY (ARRAY['admin'::text, 'super_user'::text, 'finance'::text])));

create policy "firm_profiles_admin_all" on public.firm_profiles as permissive for all to authenticated using (("current_role"() = ANY (ARRAY['admin'::text, 'super_user'::text, 'finance'::text]))) with check (("current_role"() = ANY (ARRAY['admin'::text, 'super_user'::text, 'finance'::text])));

create policy "hearings_matter_select" on public.hearings as permissive for select to authenticated using (has_matter_access(matter_id));

create policy "hearings_matter_write" on public.hearings as permissive for all to authenticated using (has_matter_access(matter_id)) with check (has_matter_access(matter_id));

create policy "hearings_portal_select" on public.hearings as permissive for select to authenticated using ((matter_id IN ( SELECT matters.notion_id
   FROM matters
  WHERE (matters.client_id IN ( SELECT client_users.client_id
           FROM client_users
          WHERE ((client_users.auth_user_id = auth.uid()) AND (client_users.active = true)))))));

create policy "intake_stage_history_team" on public.intake_stage_history as permissive for all to authenticated using ((current_person_id() IS NOT NULL)) with check ((current_person_id() IS NOT NULL));

create policy "intake_submissions_partner_all" on public.intake_submissions as permissive for all to authenticated using (("current_role"() = ANY (ARRAY['partner'::text, 'admin'::text, 'super_user'::text]))) with check (("current_role"() = ANY (ARRAY['partner'::text, 'admin'::text, 'super_user'::text])));

create policy "invoice_payments_finance_all" on public.invoice_payments as permissive for all to authenticated using (("current_role"() = ANY (ARRAY['finance'::text, 'admin'::text, 'super_user'::text]))) with check (("current_role"() = ANY (ARRAY['finance'::text, 'admin'::text, 'super_user'::text])));

create policy "invoice_payments_portal_select" on public.invoice_payments as permissive for select to authenticated using ((invoice_id IN ( SELECT i.id
   FROM invoices i
  WHERE ((i.status = ANY (ARRAY['sent'::text, 'partial'::text, 'paid'::text])) AND (i.client_id IN ( SELECT client_users.client_id
           FROM client_users
          WHERE ((client_users.auth_user_id = auth.uid()) AND (client_users.active = true))))))));

create policy "invoices_finance_all" on public.invoices as permissive for all to authenticated using (("current_role"() = ANY (ARRAY['finance'::text, 'admin'::text, 'super_user'::text]))) with check (("current_role"() = ANY (ARRAY['finance'::text, 'admin'::text, 'super_user'::text])));

create policy "invoices_portal_select" on public.invoices as permissive for select to authenticated using (((status = ANY (ARRAY['sent'::text, 'partial'::text, 'paid'::text])) AND (client_id IN ( SELECT client_users.client_id
   FROM client_users
  WHERE ((client_users.auth_user_id = auth.uid()) AND (client_users.active = true))))));

create policy "scrape_runs_admin_select" on public.issuance_scrape_runs as permissive for select to authenticated using (("current_role"() = ANY (ARRAY['admin'::text, 'super_user'::text, 'partner'::text])));

create policy "issuances_curator_delete" on public.issuances as permissive for delete to authenticated using (("current_role"() = ANY (ARRAY['partner'::text, 'admin'::text, 'super_user'::text])));

create policy "issuances_curator_insert" on public.issuances as permissive for insert to authenticated with check (("current_role"() = ANY (ARRAY['partner'::text, 'admin'::text, 'super_user'::text])));

create policy "issuances_curator_select" on public.issuances as permissive for select to authenticated using (("current_role"() = ANY (ARRAY['partner'::text, 'admin'::text, 'super_user'::text])));

create policy "issuances_curator_update" on public.issuances as permissive for update to authenticated using (("current_role"() = ANY (ARRAY['partner'::text, 'admin'::text, 'super_user'::text]))) with check (("current_role"() = ANY (ARRAY['partner'::text, 'admin'::text, 'super_user'::text])));

create policy "issuances_team_select" on public.issuances as permissive for select to authenticated using (((current_person_id() IS NOT NULL) AND (status <> 'rejected'::text) AND ((visible_to_roles IS NULL) OR (array_length(visible_to_roles, 1) IS NULL) OR ("current_role"() = ANY (visible_to_roles)) OR ("current_role"() = ANY (ARRAY['admin'::text, 'super_user'::text])))));

create policy "kb_jobs_admin_all" on public.kb_jobs as permissive for all to authenticated using (("current_role"() = ANY (ARRAY['partner'::text, 'admin'::text, 'super_user'::text]))) with check (("current_role"() = ANY (ARRAY['partner'::text, 'admin'::text, 'super_user'::text])));

create policy "kb_page_citations_admin_write" on public.kb_page_citations as permissive for all to authenticated using (("current_role"() = ANY (ARRAY['partner'::text, 'admin'::text, 'super_user'::text]))) with check (("current_role"() = ANY (ARRAY['partner'::text, 'admin'::text, 'super_user'::text])));

create policy "kb_page_citations_staff_select" on public.kb_page_citations as permissive for select to authenticated using ((current_person_id() IS NOT NULL));

create policy "kb_page_matters_admin_write" on public.kb_page_matters as permissive for all to authenticated using (("current_role"() = ANY (ARRAY['partner'::text, 'admin'::text, 'super_user'::text]))) with check (("current_role"() = ANY (ARRAY['partner'::text, 'admin'::text, 'super_user'::text])));

create policy "kb_page_matters_staff_select" on public.kb_page_matters as permissive for select to authenticated using ((current_person_id() IS NOT NULL));

create policy "kb_pages_admin_write" on public.kb_pages as permissive for all to authenticated using (("current_role"() = ANY (ARRAY['partner'::text, 'admin'::text, 'super_user'::text]))) with check (("current_role"() = ANY (ARRAY['partner'::text, 'admin'::text, 'super_user'::text])));

create policy "kb_pages_staff_select" on public.kb_pages as permissive for select to authenticated using ((current_person_id() IS NOT NULL));

create policy "leaves_own_delete" on public.leaves as permissive for delete to authenticated using (((person_id = ANY (current_person_identifiers())) OR ("current_role"() = ANY (ARRAY['admin'::text, 'super_user'::text]))));

create policy "leaves_own_insert" on public.leaves as permissive for insert to authenticated with check ((person_id = ANY (current_person_identifiers())));

create policy "leaves_own_select" on public.leaves as permissive for select to authenticated using (((person_id = ANY (current_person_identifiers())) OR ("current_role"() = ANY (ARRAY['partner'::text, 'admin'::text, 'super_user'::text]))));

create policy "leaves_own_update" on public.leaves as permissive for update to authenticated using (((person_id = ANY (current_person_identifiers())) OR ("current_role"() = ANY (ARRAY['partner'::text, 'admin'::text, 'super_user'::text])))) with check (((person_id = ANY (current_person_identifiers())) OR ("current_role"() = ANY (ARRAY['partner'::text, 'admin'::text, 'super_user'::text]))));

create policy "liaison_tasks_visibility" on public.liaison_tasks as permissive for select to authenticated using (((assigned_to = current_person_id()) OR (assigned_by = current_person_id()) OR ("current_role"() = ANY (ARRAY['chief_liaison_officer'::text, 'liaison_officer'::text, 'admin'::text, 'super_user'::text, 'partner'::text])) OR ((matter_id IS NOT NULL) AND has_matter_access(matter_id))));

create policy "liaison_tasks_write" on public.liaison_tasks as permissive for all to authenticated using (((assigned_to = current_person_id()) OR (assigned_by = current_person_id()) OR ("current_role"() = ANY (ARRAY['chief_liaison_officer'::text, 'liaison_officer'::text, 'admin'::text, 'super_user'::text])))) with check (((assigned_to = current_person_id()) OR (assigned_by = current_person_id()) OR ("current_role"() = ANY (ARRAY['chief_liaison_officer'::text, 'liaison_officer'::text, 'admin'::text, 'super_user'::text]))));

create policy "matter_action_entries_matter_select" on public.matter_action_entries as permissive for select to authenticated using (has_matter_access(matter_id));

create policy "matter_action_entries_matter_write" on public.matter_action_entries as permissive for all to authenticated using (has_matter_access(matter_id)) with check (has_matter_access(matter_id));

create policy "matter_billing_actions_finance_all" on public.matter_billing_actions as permissive for all to authenticated using (("current_role"() = ANY (ARRAY['finance'::text, 'admin'::text, 'super_user'::text]))) with check (("current_role"() = ANY (ARRAY['finance'::text, 'admin'::text, 'super_user'::text])));

create policy "matter_billing_configs_finance_all" on public.matter_billing_configs as permissive for all to authenticated using (("current_role"() = ANY (ARRAY['finance'::text, 'admin'::text, 'super_user'::text]))) with check (("current_role"() = ANY (ARRAY['finance'::text, 'admin'::text, 'super_user'::text])));

create policy "matter_billing_milestones_finance_all" on public.matter_billing_milestones as permissive for all to authenticated using (("current_role"() = ANY (ARRAY['finance'::text, 'admin'::text, 'super_user'::text]))) with check (("current_role"() = ANY (ARRAY['finance'::text, 'admin'::text, 'super_user'::text])));

create policy "matter_exec_summaries_portal_select" on public.matter_exec_summaries as permissive for select to authenticated using ((matter_id IN ( SELECT matters.notion_id
   FROM matters
  WHERE (matters.client_id IN ( SELECT client_users.client_id
           FROM client_users
          WHERE ((client_users.auth_user_id = auth.uid()) AND (client_users.active = true)))))));

create policy "matter_exec_summaries_team_select" on public.matter_exec_summaries as permissive for select to authenticated using ((current_person_id() IS NOT NULL));

create policy "matter_expenses_finance_all" on public.matter_expenses as permissive for all to authenticated using (("current_role"() = ANY (ARRAY['finance'::text, 'admin'::text, 'super_user'::text]))) with check (("current_role"() = ANY (ARRAY['finance'::text, 'admin'::text, 'super_user'::text])));

create policy "matter_health_team_select" on public.matter_health as permissive for select to authenticated using ((current_person_id() IS NOT NULL));

create policy "matter_sol_matter_select" on public.matter_sol as permissive for select to authenticated using (has_matter_access(matter_id));

create policy "matter_sol_matter_write" on public.matter_sol as permissive for all to authenticated using (has_matter_access(matter_id)) with check (has_matter_access(matter_id));

create policy "matter_summaries_portal_select" on public.matter_summaries as permissive for select to authenticated using ((matter_id IN ( SELECT matters.notion_id
   FROM matters
  WHERE (matters.client_id IN ( SELECT client_users.client_id
           FROM client_users
          WHERE ((client_users.auth_user_id = auth.uid()) AND (client_users.active = true)))))));

create policy "matters_portal_select" on public.matters as permissive for select to authenticated using ((client_id IN ( SELECT client_users.client_id
   FROM client_users
  WHERE ((client_users.auth_user_id = auth.uid()) AND (client_users.active = true)))));

create policy "matters_team_select" on public.matters as permissive for select to authenticated using (((current_person_id() = ANY (team_person_ids)) OR ("current_role"() = ANY (ARRAY['partner'::text, 'admin'::text, 'super_user'::text, 'finance'::text, 'chief_liaison_officer'::text, 'liaison_officer'::text]))));

create policy "matters_team_write" on public.matters as permissive for all to authenticated using (((current_person_id() = ANY (team_person_ids)) OR ("current_role"() = ANY (ARRAY['partner'::text, 'admin'::text, 'super_user'::text, 'finance'::text])))) with check (((current_person_id() = ANY (team_person_ids)) OR ("current_role"() = ANY (ARRAY['partner'::text, 'admin'::text, 'super_user'::text, 'finance'::text]))));

create policy "meetings_matter_select" on public.meetings as permissive for select to authenticated using (has_matter_access(matter_id));

create policy "meetings_matter_write" on public.meetings as permissive for all to authenticated using (has_matter_access(matter_id)) with check (has_matter_access(matter_id));

create policy "meetings_portal_select" on public.meetings as permissive for select to authenticated using ((matter_id IN ( SELECT matters.notion_id
   FROM matters
  WHERE (matters.client_id IN ( SELECT client_users.client_id
           FROM client_users
          WHERE ((client_users.auth_user_id = auth.uid()) AND (client_users.active = true)))))));

create policy "notification_mutes_own" on public.notification_mutes as permissive for all to public using ((person_id = current_person_id())) with check ((person_id = current_person_id()));

create policy "notifications_own_delete" on public.notifications as permissive for delete to authenticated using ((person_id = current_person_id()));

create policy "notifications_own_select" on public.notifications as permissive for select to authenticated using ((person_id = current_person_id()));

create policy "notifications_own_update" on public.notifications as permissive for update to authenticated using ((person_id = current_person_id())) with check ((person_id = current_person_id()));

create policy "parties_matter_select" on public.parties as permissive for select to authenticated using (has_matter_access(matter_id));

create policy "parties_matter_write" on public.parties as permissive for all to authenticated using (has_matter_access(matter_id)) with check (has_matter_access(matter_id));

create policy "partner_matter_annotations_matter_select" on public.partner_matter_annotations as permissive for select to authenticated using (has_matter_access(matter_id));

create policy "partner_matter_annotations_matter_write" on public.partner_matter_annotations as permissive for all to authenticated using (has_matter_access(matter_id)) with check (has_matter_access(matter_id));

create policy "ph_holidays_admin_write" on public.ph_holidays as permissive for all to authenticated using (("current_role"() = ANY (ARRAY['admin'::text, 'super_user'::text]))) with check (("current_role"() = ANY (ARRAY['admin'::text, 'super_user'::text])));

create policy "ph_holidays_authenticated_select" on public.ph_holidays as permissive for select to authenticated using ((current_person_id() IS NOT NULL));

create policy "portal_chat_messages_own_select" on public.portal_chat_messages as permissive for select to authenticated using ((client_user_id IN ( SELECT client_users.id
   FROM client_users
  WHERE ((client_users.auth_user_id = auth.uid()) AND (client_users.active = true)))));

create policy "push_subscriptions_own" on public.push_subscriptions as permissive for all to authenticated using ((email = current_email())) with check ((email = current_email()));

create policy "reimbursements_delete" on public.reimbursements as permissive for delete to authenticated using (((lawyer_ids && current_person_identifiers()) OR ("current_role"() = ANY (ARRAY['finance'::text, 'admin'::text, 'super_user'::text]))));

create policy "reimbursements_insert" on public.reimbursements as permissive for insert to authenticated with check ((lawyer_ids && current_person_identifiers()));

create policy "reimbursements_select" on public.reimbursements as permissive for select to authenticated using (((lawyer_ids && current_person_identifiers()) OR ("current_role"() = ANY (ARRAY['finance'::text, 'admin'::text, 'super_user'::text]))));

create policy "reimbursements_update" on public.reimbursements as permissive for update to authenticated using (((lawyer_ids && current_person_identifiers()) OR ("current_role"() = ANY (ARRAY['finance'::text, 'admin'::text, 'super_user'::text])))) with check (((lawyer_ids && current_person_identifiers()) OR ("current_role"() = ANY (ARRAY['finance'::text, 'admin'::text, 'super_user'::text]))));

create policy "resolution_templates_admin_write" on public.resolution_templates as permissive for all to authenticated using (("current_role"() = ANY (ARRAY['admin'::text, 'super_user'::text, 'partner'::text]))) with check (("current_role"() = ANY (ARRAY['admin'::text, 'super_user'::text, 'partner'::text])));

create policy "resolution_templates_team_select" on public.resolution_templates as permissive for select to authenticated using ((current_person_id() IS NOT NULL));

create policy "resolutions_team" on public.resolutions as permissive for all to authenticated using ((current_person_id() IS NOT NULL)) with check (((created_by = current_person_id()) OR ("current_role"() = ANY (ARRAY['admin'::text, 'super_user'::text, 'partner'::text]))));

create policy "resources_author_write" on public.resources as permissive for all to authenticated using (((author_id = current_person_id()) OR ("current_role"() = ANY (ARRAY['admin'::text, 'super_user'::text])))) with check (((author_id = current_person_id()) OR ("current_role"() = ANY (ARRAY['admin'::text, 'super_user'::text]))));

create policy "resources_role_select" on public.resources as permissive for select to authenticated using (((current_person_id() IS NOT NULL) AND ((visible_to_roles IS NULL) OR (array_length(visible_to_roles, 1) IS NULL) OR ("current_role"() = ANY (visible_to_roles)) OR ("current_role"() = ANY (ARRAY['admin'::text, 'super_user'::text])))));

create policy "rule_deadlines_admin_write" on public.rule_deadlines as permissive for all to authenticated using (("current_role"() = ANY (ARRAY['admin'::text, 'super_user'::text, 'partner'::text]))) with check (("current_role"() = ANY (ARRAY['admin'::text, 'super_user'::text, 'partner'::text])));

create policy "rule_deadlines_authenticated_select" on public.rule_deadlines as permissive for select to authenticated using ((current_person_id() IS NOT NULL));

create policy "rule_sets_admin_write" on public.rule_sets as permissive for all to authenticated using (("current_role"() = ANY (ARRAY['admin'::text, 'super_user'::text, 'partner'::text]))) with check (("current_role"() = ANY (ARRAY['admin'::text, 'super_user'::text, 'partner'::text])));

create policy "rule_sets_authenticated_select" on public.rule_sets as permissive for select to authenticated using ((current_person_id() IS NOT NULL));

create policy "saved_reports_owner_write" on public.saved_reports as permissive for all to authenticated using ((owner_id = current_person_id())) with check ((owner_id = current_person_id()));

create policy "saved_reports_select" on public.saved_reports as permissive for select to authenticated using (((owner_id = current_person_id()) OR (shared_scope = 'firm'::text)));

create policy "scope_templates_pipeline_write" on public.scope_templates as permissive for all to authenticated using (("current_role"() = ANY (ARRAY['partner'::text, 'admin'::text, 'super_user'::text]))) with check (("current_role"() = ANY (ARRAY['partner'::text, 'admin'::text, 'super_user'::text])));

create policy "scope_templates_read" on public.scope_templates as permissive for select to authenticated using ((current_person_id() IS NOT NULL));

create policy "sla_breaches_team_select" on public.sla_breaches as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM deliverables d
  WHERE ((d.notion_id = sla_breaches.deliverable_id) AND has_matter_access(d.matter_id)))));

create policy "sla_rules_admin_select" on public.sla_rules as permissive for select to authenticated using (("current_role"() = ANY (ARRAY['partner'::text, 'admin'::text, 'super_user'::text])));

create policy "sla_rules_admin_write" on public.sla_rules as permissive for all to authenticated using (("current_role"() = ANY (ARRAY['admin'::text, 'super_user'::text]))) with check (("current_role"() = ANY (ARRAY['admin'::text, 'super_user'::text])));

create policy "tasks_matter_select" on public.tasks as permissive for select to authenticated using (has_matter_access(matter_id));

create policy "tasks_matter_write" on public.tasks as permissive for all to authenticated using (has_matter_access(matter_id)) with check (has_matter_access(matter_id));

create policy "team_authenticated_select" on public.team as permissive for select to authenticated using ((current_person_id() IS NOT NULL));

create policy "team_self_update" on public.team as permissive for update to authenticated using (((auth_user_id = auth.uid()) OR ("current_role"() = ANY (ARRAY['admin'::text, 'super_user'::text])))) with check (((auth_user_id = auth.uid()) OR ("current_role"() = ANY (ARRAY['admin'::text, 'super_user'::text]))));

create policy "trademark_client_reports_team" on public.trademark_client_reports as permissive for all to authenticated using ((current_person_id() IS NOT NULL)) with check ((current_person_id() IS NOT NULL));

create policy "trademark_files_team" on public.trademark_files as permissive for all to authenticated using ((current_person_id() IS NOT NULL)) with check ((current_person_id() IS NOT NULL));

create policy "trademarks_team_select" on public.trademarks as permissive for select to authenticated using ((current_person_id() IS NOT NULL));

create policy "trademarks_team_write" on public.trademarks as permissive for all to authenticated using (("current_role"() = ANY (ARRAY['admin'::text, 'super_user'::text, 'partner'::text, 'lawyer'::text]))) with check (("current_role"() = ANY (ARRAY['admin'::text, 'super_user'::text, 'partner'::text, 'lawyer'::text])));

create policy "transportation_zones_admin_write" on public.transportation_zones as permissive for all to authenticated using (("current_role"() = ANY (ARRAY['admin'::text, 'super_user'::text, 'finance'::text]))) with check (("current_role"() = ANY (ARRAY['admin'::text, 'super_user'::text, 'finance'::text])));

create policy "transportation_zones_authenticated_select" on public.transportation_zones as permissive for select to authenticated using ((current_person_id() IS NOT NULL));

create policy "user_preferences_own" on public.user_preferences as permissive for all to authenticated using ((email = current_email())) with check ((email = current_email()));

-- ───────────────── grants ─────────────────
revoke execute on function public.allocate_client_code() from public, anon;
revoke execute on function public.allocate_invoice_number(text) from public, anon;

-- ───────────────── 10_storage ─────────────────
-- Storage: buckets (6) and storage.objects policies (9), exact values from live DB.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/png','image/jpeg','image/webp','image/gif'])
on conflict (id) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documents', 'documents', false, 52428800, array['application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','image/jpeg','image/png'])
on conflict (id) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('files', 'files', false, null, null)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('issuances', 'issuances', true, null, null)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 20971520, array['image/jpeg','image/png','image/gif','image/webp','image/heic','application/pdf'])
on conflict (id) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('templates', 'templates', false, null, array['application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/msword'])
on conflict (id) do nothing;

-- Policies on storage.objects

create policy "Service role full access" on storage.objects as permissive for all to service_role using (true) with check (true);

create policy "auth_delete_documents" on storage.objects as permissive for delete to authenticated using ((bucket_id = 'documents'::text));

create policy "auth_delete_receipts" on storage.objects as permissive for delete to authenticated using ((bucket_id = 'receipts'::text));

create policy "auth_read_documents" on storage.objects as permissive for select to authenticated using ((bucket_id = 'documents'::text));

create policy "auth_read_receipts" on storage.objects as permissive for select to authenticated using ((bucket_id = 'receipts'::text));

create policy "auth_update_documents" on storage.objects as permissive for update to authenticated using ((bucket_id = 'documents'::text));

create policy "auth_update_receipts" on storage.objects as permissive for update to authenticated using ((bucket_id = 'receipts'::text));

create policy "auth_upload_documents" on storage.objects as permissive for insert to authenticated with check ((bucket_id = 'documents'::text));

create policy "auth_upload_receipts" on storage.objects as permissive for insert to authenticated with check ((bucket_id = 'receipts'::text));

-- ───────────────── 11_realtime ─────────────────
-- Tables in the supabase_realtime publication (9 in live DB).

alter publication supabase_realtime add table public.chat_channels;
alter publication supabase_realtime add table public.chat_messages;
alter publication supabase_realtime add table public.chat_reactions;
alter publication supabase_realtime add table public.chat_read_receipts;
alter publication supabase_realtime add table public.client_intakes;
alter publication supabase_realtime add table public.file_analyses;
alter publication supabase_realtime add table public.files;
alter publication supabase_realtime add table public.notifications;
alter publication supabase_realtime add table public.parties;

-- ───────────────── 13_seeds ─────────────────
-- Seed data extracted verbatim from live DB (2026-08-22): ph_holidays (84), rule_sets (11), rule_deadlines (16).
-- Exact ids preserved (rule_deadlines.rule_set_id references rule_sets.id).

-- ph_holidays -----------------------------------------------------------------

insert into public.ph_holidays (id, date, name, type, created_at) values
(1, '2024-01-01', 'New Year''s Day', 'regular', '2026-04-03 11:45:59.125905+00'),
(2, '2024-02-10', 'Chinese New Year', 'special_non_working', '2026-04-03 11:45:59.125905+00'),
(3, '2024-02-25', 'EDSA People Power Revolution Anniversary', 'special_non_working', '2026-04-03 11:45:59.125905+00'),
(4, '2024-03-28', 'Maundy Thursday', 'regular', '2026-04-03 11:45:59.125905+00'),
(5, '2024-03-29', 'Good Friday', 'regular', '2026-04-03 11:45:59.125905+00'),
(6, '2024-03-30', 'Black Saturday', 'special_non_working', '2026-04-03 11:45:59.125905+00'),
(7, '2024-04-09', 'Araw ng Kagitingan', 'regular', '2026-04-03 11:45:59.125905+00'),
(8, '2024-04-10', 'Eid''l Fitr', 'regular', '2026-04-03 11:45:59.125905+00'),
(9, '2024-05-01', 'Labor Day', 'regular', '2026-04-03 11:45:59.125905+00'),
(10, '2024-06-12', 'Independence Day', 'regular', '2026-04-03 11:45:59.125905+00'),
(11, '2024-06-17', 'Eid''l Adha', 'regular', '2026-04-03 11:45:59.125905+00'),
(12, '2024-08-21', 'Ninoy Aquino Day', 'special_non_working', '2026-04-03 11:45:59.125905+00'),
(13, '2024-08-26', 'National Heroes Day', 'regular', '2026-04-03 11:45:59.125905+00'),
(14, '2024-11-01', 'All Saints'' Day', 'special_non_working', '2026-04-03 11:45:59.125905+00'),
(15, '2024-11-02', 'All Souls Day', 'special_non_working', '2026-04-03 11:45:59.125905+00'),
(16, '2024-11-30', 'Bonifacio Day', 'regular', '2026-04-03 11:45:59.125905+00'),
(17, '2024-12-08', 'Feast of the Immaculate Conception', 'special_non_working', '2026-04-03 11:45:59.125905+00'),
(18, '2024-12-24', 'Christmas Eve', 'special_non_working', '2026-04-03 11:45:59.125905+00'),
(19, '2024-12-25', 'Christmas Day', 'regular', '2026-04-03 11:45:59.125905+00'),
(20, '2024-12-30', 'Rizal Day', 'regular', '2026-04-03 11:45:59.125905+00'),
(21, '2024-12-31', 'New Year''s Eve', 'special_non_working', '2026-04-03 11:45:59.125905+00'),
(22, '2025-01-01', 'New Year''s Day', 'regular', '2026-04-03 11:45:59.125905+00'),
(23, '2025-01-29', 'Chinese New Year', 'special_non_working', '2026-04-03 11:45:59.125905+00'),
(24, '2025-02-25', 'EDSA People Power Revolution Anniversary', 'special_non_working', '2026-04-03 11:45:59.125905+00'),
(25, '2025-03-31', 'Eid''l Fitr', 'regular', '2026-04-03 11:45:59.125905+00'),
(26, '2025-04-09', 'Araw ng Kagitingan', 'regular', '2026-04-03 11:45:59.125905+00'),
(27, '2025-04-17', 'Maundy Thursday', 'regular', '2026-04-03 11:45:59.125905+00'),
(28, '2025-04-18', 'Good Friday', 'regular', '2026-04-03 11:45:59.125905+00'),
(29, '2025-04-19', 'Black Saturday', 'special_non_working', '2026-04-03 11:45:59.125905+00'),
(30, '2025-05-01', 'Labor Day', 'regular', '2026-04-03 11:45:59.125905+00'),
(31, '2025-06-06', 'Eid''l Adha', 'regular', '2026-04-03 11:45:59.125905+00'),
(32, '2025-06-12', 'Independence Day', 'regular', '2026-04-03 11:45:59.125905+00'),
(33, '2025-08-21', 'Ninoy Aquino Day', 'special_non_working', '2026-04-03 11:45:59.125905+00'),
(34, '2025-08-25', 'National Heroes Day', 'regular', '2026-04-03 11:45:59.125905+00'),
(35, '2025-11-01', 'All Saints'' Day', 'special_non_working', '2026-04-03 11:45:59.125905+00'),
(36, '2025-11-02', 'All Souls Day', 'special_non_working', '2026-04-03 11:45:59.125905+00'),
(37, '2025-11-30', 'Bonifacio Day', 'regular', '2026-04-03 11:45:59.125905+00'),
(38, '2025-12-08', 'Feast of the Immaculate Conception', 'special_non_working', '2026-04-03 11:45:59.125905+00'),
(39, '2025-12-24', 'Christmas Eve', 'special_non_working', '2026-04-03 11:45:59.125905+00'),
(40, '2025-12-25', 'Christmas Day', 'regular', '2026-04-03 11:45:59.125905+00'),
(41, '2025-12-30', 'Rizal Day', 'regular', '2026-04-03 11:45:59.125905+00'),
(42, '2025-12-31', 'New Year''s Eve', 'special_non_working', '2026-04-03 11:45:59.125905+00'),
(43, '2026-01-01', 'New Year''s Day', 'regular', '2026-04-03 11:45:59.125905+00'),
(44, '2026-02-17', 'Chinese New Year', 'special_non_working', '2026-04-03 11:45:59.125905+00'),
(45, '2026-02-25', 'EDSA People Power Revolution Anniversary', 'special_non_working', '2026-04-03 11:45:59.125905+00'),
(46, '2026-03-20', 'Eid''l Fitr', 'regular', '2026-04-03 11:45:59.125905+00'),
(47, '2026-04-02', 'Maundy Thursday', 'regular', '2026-04-03 11:45:59.125905+00'),
(48, '2026-04-03', 'Good Friday', 'regular', '2026-04-03 11:45:59.125905+00'),
(49, '2026-04-04', 'Black Saturday', 'special_non_working', '2026-04-03 11:45:59.125905+00'),
(50, '2026-04-09', 'Araw ng Kagitingan', 'regular', '2026-04-03 11:45:59.125905+00'),
(51, '2026-05-01', 'Labor Day', 'regular', '2026-04-03 11:45:59.125905+00'),
(52, '2026-05-27', 'Eid''l Adha', 'regular', '2026-04-03 11:45:59.125905+00'),
(53, '2026-06-12', 'Independence Day', 'regular', '2026-04-03 11:45:59.125905+00'),
(54, '2026-08-21', 'Ninoy Aquino Day', 'special_non_working', '2026-04-03 11:45:59.125905+00'),
(55, '2026-08-31', 'National Heroes Day', 'regular', '2026-04-03 11:45:59.125905+00'),
(56, '2026-11-01', 'All Saints'' Day', 'special_non_working', '2026-04-03 11:45:59.125905+00'),
(57, '2026-11-02', 'All Souls Day', 'special_non_working', '2026-04-03 11:45:59.125905+00'),
(58, '2026-11-30', 'Bonifacio Day', 'regular', '2026-04-03 11:45:59.125905+00'),
(59, '2026-12-08', 'Feast of the Immaculate Conception', 'special_non_working', '2026-04-03 11:45:59.125905+00'),
(60, '2026-12-24', 'Christmas Eve', 'special_non_working', '2026-04-03 11:45:59.125905+00'),
(61, '2026-12-25', 'Christmas Day', 'regular', '2026-04-03 11:45:59.125905+00'),
(62, '2026-12-30', 'Rizal Day', 'regular', '2026-04-03 11:45:59.125905+00'),
(63, '2026-12-31', 'New Year''s Eve', 'special_non_working', '2026-04-03 11:45:59.125905+00'),
(64, '2027-01-01', 'New Year''s Day', 'regular', '2026-04-03 11:45:59.125905+00'),
(65, '2027-02-06', 'Chinese New Year', 'special_non_working', '2026-04-03 11:45:59.125905+00'),
(66, '2027-02-25', 'EDSA People Power Revolution Anniversary', 'special_non_working', '2026-04-03 11:45:59.125905+00'),
(67, '2027-03-10', 'Eid''l Fitr', 'regular', '2026-04-03 11:45:59.125905+00'),
(68, '2027-03-25', 'Maundy Thursday', 'regular', '2026-04-03 11:45:59.125905+00'),
(69, '2027-03-26', 'Good Friday', 'regular', '2026-04-03 11:45:59.125905+00'),
(70, '2027-03-27', 'Black Saturday', 'special_non_working', '2026-04-03 11:45:59.125905+00'),
(71, '2027-04-09', 'Araw ng Kagitingan', 'regular', '2026-04-03 11:45:59.125905+00'),
(72, '2027-05-01', 'Labor Day', 'regular', '2026-04-03 11:45:59.125905+00'),
(73, '2027-05-17', 'Eid''l Adha', 'regular', '2026-04-03 11:45:59.125905+00'),
(74, '2027-06-12', 'Independence Day', 'regular', '2026-04-03 11:45:59.125905+00'),
(75, '2027-08-21', 'Ninoy Aquino Day', 'special_non_working', '2026-04-03 11:45:59.125905+00'),
(76, '2027-08-30', 'National Heroes Day', 'regular', '2026-04-03 11:45:59.125905+00'),
(77, '2027-11-01', 'All Saints'' Day', 'special_non_working', '2026-04-03 11:45:59.125905+00'),
(78, '2027-11-02', 'All Souls Day', 'special_non_working', '2026-04-03 11:45:59.125905+00'),
(79, '2027-11-30', 'Bonifacio Day', 'regular', '2026-04-03 11:45:59.125905+00'),
(80, '2027-12-08', 'Feast of the Immaculate Conception', 'special_non_working', '2026-04-03 11:45:59.125905+00'),
(81, '2027-12-24', 'Christmas Eve', 'special_non_working', '2026-04-03 11:45:59.125905+00'),
(82, '2027-12-25', 'Christmas Day', 'regular', '2026-04-03 11:45:59.125905+00'),
(83, '2027-12-30', 'Rizal Day', 'regular', '2026-04-03 11:45:59.125905+00'),
(84, '2027-12-31', 'New Year''s Eve', 'special_non_working', '2026-04-03 11:45:59.125905+00');

select setval(pg_get_serial_sequence('public.ph_holidays', 'id'), (select max(id) from public.ph_holidays), true);

-- rule_sets -------------------------------------------------------------------

insert into public.rule_sets (id, name, trigger_event_label, applicable_matter_types, is_system_default, created_by, updated_at) values
('labor_decision', 'Receipt of LA Decision (NLRC)', 'Date of receipt of Labor Arbiter decision', array['Labor'], true, NULL, '2026-04-01 13:27:09.111349+00'),
('labor_nlrc_resolution', 'Receipt of NLRC Resolution', 'Date of receipt of NLRC resolution', array['Labor'], true, NULL, '2026-04-01 13:27:09.111349+00'),
('labor_summons', 'Receipt of Summons (NLRC)', 'Date of receipt of summons/notice of hearing', array['Labor'], true, NULL, '2026-04-01 13:27:09.111349+00'),
('litigation_adverse_judgment', 'Receipt of Adverse Judgment', 'Date of receipt of judgment or final order', array['Litigation'], true, NULL, '2026-04-01 13:27:09.111349+00'),
('litigation_certiorari', 'Petition for Certiorari (Rule 65)', 'Date of receipt of assailed order/resolution', array['Litigation'], true, NULL, '2026-04-01 13:27:09.111349+00'),
('litigation_mr', 'Receipt of Resolution/Order', 'Date of receipt of resolution or order', array['Litigation'], true, NULL, '2026-04-01 13:27:09.111349+00'),
('litigation_service_regular', 'Service of Summons (Regular Procedure)', 'Date of service of summons on defendant', array['Litigation'], true, NULL, '2026-04-01 13:27:09.111349+00'),
('litigation_service_summary', 'Service of Summons (Summary Procedure)', 'Date of service of summons on defendant', array['Litigation'], true, NULL, '2026-04-01 13:27:09.111349+00'),
('tax_adverse_decision', 'Receipt of Adverse CIR Decision', 'Date of receipt of adverse decision or inaction by CIR', array['Tax'], true, NULL, '2026-04-01 13:27:09.111349+00'),
('tax_assessment', 'Receipt of Final Assessment Notice', 'Date of receipt of Final Assessment Notice (FAN)', array['Tax'], true, NULL, '2026-04-01 13:27:09.111349+00'),
('tax_cta_petition', 'Filing of CTA Petition', 'Date of filing of Petition for Review with CTA', array['Tax'], true, NULL, '2026-04-01 13:27:09.111349+00');

-- rule_deadlines --------------------------------------------------------------

insert into public.rule_deadlines (rule_set_id, id, label, legal_basis, days_from_trigger, calendar_type, depends_on, entity_type, hearing_type, is_reglementary, notes, sort_order) values
('labor_decision', 'labor_appeal_memo', 'File Appeal Memorandum to NLRC', 'NLRC Rules, Rule VI, Sec. 1; Labor Code Art. 229', 10, 'calendar', NULL, 'deliverable', NULL, true, '10 calendar days from receipt of decision. Jurisdictional.', 0),
('labor_nlrc_resolution', 'labor_certiorari_ca', 'File Petition for Certiorari (CA)', 'Rule 65, Sec. 4; St. Martin Funeral Homes doctrine', 60, 'calendar', NULL, 'deliverable', NULL, true, '60 calendar days from receipt of NLRC resolution denying MR.', 1),
('labor_nlrc_resolution', 'labor_mr', 'File Motion for Reconsideration (NLRC)', 'NLRC Rules, Rule VII, Sec. 15', 10, 'calendar', NULL, 'deliverable', NULL, true, '10 calendar days. Only one MR allowed.', 0),
('labor_summons', 'labor_mandatory_conference', 'Mandatory Conciliation/Mediation Conference', 'NLRC Rules, Rule V, Sec. 7', 10, 'calendar', NULL, 'hearing', 'Initial Hearing', false, 'Typically scheduled within 10 days of receipt of complaint.', 1),
('labor_summons', 'position_paper', 'File Position Paper', 'NLRC Rules, Rule V, Sec. 11', 10, 'calendar', NULL, 'deliverable', NULL, true, '10 calendar days from receipt. Non-extendable under 2011 NLRC Rules.', 0),
('litigation_adverse_judgment', 'appellants_brief', 'File Appellant''s Brief', 'Rule 44, Sec. 7', 45, 'calendar', NULL, 'deliverable', NULL, false, '45 days from receipt of notice from clerk of court. Extendable for good cause.', 2),
('litigation_adverse_judgment', 'notice_of_appeal', 'File Notice of Appeal', 'Rule 41, Sec. 3, 2019 Amended Rules', 15, 'calendar', NULL, 'deliverable', NULL, true, '15 calendar days from notice of judgment. Jurisdictional — non-extendable.', 0),
('litigation_adverse_judgment', 'record_on_appeal', 'File Record on Appeal', 'Rule 41, Sec. 3, 2019 Amended Rules', 30, 'calendar', NULL, 'deliverable', NULL, true, 'Required only in special proceedings and multiple/separate appeals.', 1),
('litigation_certiorari', 'petition_certiorari', 'File Petition for Certiorari', 'Rule 65, Sec. 4, 2019 Amended Rules', 60, 'calendar', NULL, 'deliverable', NULL, true, '60 calendar days from notice. Non-extendable.', 0),
('litigation_mr', 'motion_for_reconsideration', 'File Motion for Reconsideration', 'Rule 37, Sec. 1; Rule 52, Sec. 1', 15, 'calendar', NULL, 'deliverable', NULL, true, '15 calendar days from notice. Filing tolls the period to appeal.', 0),
('litigation_service_regular', 'file_answer', 'File Answer', 'Rule 11, Sec. 1, 2019 Amended Rules', 30, 'calendar', NULL, 'deliverable', NULL, true, '30 calendar days from service of summons. Non-extendable for ordinary civil actions.', 0),
('litigation_service_regular', 'pretrial_brief', 'Pre-Trial Brief', 'Rule 18, Sec. 6, 2019 Amended Rules', 3, 'calendar', 'file_answer', 'deliverable', NULL, false, 'Filed at least 3 days before the pre-trial conference.', 1),
('litigation_service_summary', 'file_answer_summary', 'File Answer (Summary)', 'Rule on Summary Procedure, Sec. 5', 10, 'calendar', NULL, 'deliverable', NULL, true, '10 calendar days. No motion to dismiss or motion for extension allowed.', 0),
('tax_adverse_decision', 'tax_petition_review', 'File Petition for Review (CTA)', 'RA 1125, Sec. 11; CTA Rules, Rule 4, Sec. 3', 30, 'calendar', NULL, 'deliverable', NULL, true, '30 days from receipt of decision or expiry of 180-day period of inaction.', 0),
('tax_assessment', 'tax_protest', 'File Administrative Protest', 'NIRC Sec. 228; RR No. 12-99', 30, 'calendar', NULL, 'deliverable', NULL, true, '30 days from receipt of FAN. Failure renders assessment final and executory.', 0),
('tax_cta_petition', 'tax_cta_answer', 'File CIR''s Answer', 'CTA Rules, Rule 6, Sec. 3', 30, 'calendar', NULL, 'deliverable', NULL, false, '30 days from service of petition. CIR''s deadline — track for monitoring.', 0);

-- ───────────────── 14_comments ─────────────────
-- Object comments in live DB (pg_description, schema public): 30 column comments, 3 function comments.
-- No table-level or view-level comments exist.

comment on column public.corporation_files.filing_year is 'Calendar/fiscal year a reportorial document covers (GIS, AFS). Null for everything else.';

comment on column public.corporation_persons.entity_name is 'Full registered corporate name for juridical incorporators/stockholders.';

comment on column public.corporation_persons.entity_registration_no is 'SEC or DTI registration number of the juridical entity.';

comment on column public.corporation_persons.entity_type is 'Corporation | Partnership | Association | Cooperative | Other.';

comment on column public.corporation_persons.is_juridical is 'TRUE when this row represents a juridical entity (corporation, partnership, association) acting as Incorporator or Stockholder. Directors and Officers must be natural persons under RCC.';

comment on column public.corporation_persons.representative_name is 'Natural person authorized to sign on behalf of the juridical entity.';

comment on column public.corporation_persons.representative_title is 'Title of the authorized representative (e.g. President, Managing Partner).';

comment on column public.corporation_persons.share_class is 'Matches corporation_share_classes.class_name. Text rather than a foreign key so renaming a class cannot orphan a holding.';

comment on column public.corporations.annual_meeting_bylaws is 'Annual meeting date as stated in the by-laws — usually a rule ("third Monday of June"), not a date.';

comment on column public.corporations.annual_meeting_day is 'Day of month of the by-laws annual meeting date. Clamped to the month length when the month is shorter.';

comment on column public.corporations.annual_meeting_month is 'Month (1-12) of the by-laws annual meeting date. Anchors the GIS deadline; null falls back to the fiscal-year-end heuristic.';

comment on column public.corporations.bir_orus_username is 'BIR ORUS account identifier (email/username). Never store the password here.';

comment on column public.corporations.geographical_code is 'SEC geographical code for the principal office.';

comment on column public.corporations.sec_efast_username is 'SEC eFAST account identifier — required to file GIS and AFS. Never store the password here.';

comment on column public.corporations.sec_habor_username is 'SEC HABOR account identifier. Never store the password here.';

comment on column public.corporations.total_assets is 'Total assets per the latest audited financial statements, for the GIS.';

comment on column public.deliverables.related_hearing_id is 'For Status Report deliverables auto-created after a hearing is attended — points to the hearing notion_id.';

comment on column public.deliverables.source_deliverable_id is 'For Status Report deliverables auto-created when a source deliverable is marked Filed or Sent out — points to that source deliverable notion_id.';

comment on column public.deliverables.source_file_id is 'For Status Report deliverables manually linked to an uploaded file — points to a files.notion_id.';

comment on column public.dtr_revision_reviews.clearance_override_by is 'team.person_id of the managing partner who cleared this bundle in place of the relationship partner. NULL for ordinary clearance.';

comment on column public.dtr_revision_reviews.clearance_override_reason is 'Required justification for a managing-partner clearance override; sent to the relationship partner in their notification.';

comment on column public.dtr_revision_reviews.invoice_settings_override is 'Optional partial InvoiceSettingsSnapshot applied on top of matter billing_settings when the bundle is approved + auto-generated.';

comment on column public.dtr_revision_reviews.submitted_at is 'Timestamp the bundle was submitted for managing-partner review. NULL while the row exists only to hold an invoice_settings_override that finance staged before submission.';

comment on column public.dtr_revisions.waived_with is 'For action=''waive'': the attendee lawyer-names whose fanned line is waived (billed ₱0, still shown). Co-attendees not listed still bill. NULL = whole entry (all attendees).';

comment on column public.email_mailboxes.ms_entity_type is 'Microsoft Graph entity type: user or group';

comment on column public.email_mailboxes.owner_person_id is 'team.person_id of the owner for personal mailboxes; NULL for shared mailboxes.';

comment on column public.email_mailboxes.send_as_principal_id is 'Real user-mailbox Graph id used as the sendMail principal when this address is a Group/shared inbox that cannot itself be a send principal. When set, mail is sent AS email_address via Exchange Send-As delegation held by this principal.';

comment on column public.invoices.breakdown_pdf_storage_path is 'Path in the files bucket to a branded PDF rendering of the billing breakdown. Companion to xlsx_storage_path which holds the same data as a spreadsheet.';

comment on column public.resolutions.bundled_resolution_ids is 'For kind=Secretarys Certificate only: ordered list of resolution IDs whose bodies are quoted in this certificate. Each may reference a different meeting.';

comment on column public.trademarks.renewal_dau_5_filed_date is 'Date the DAU due within one year of the fifth anniversary of renewal was filed (IPOPHL MC 17-010 rule 204).';

comment on function public.break_status_report_links_on_archive() is 'Breaks Status Report parent/child linkage when a deliverable is archived. See lib/status-report-auto.ts for creation-side logic.';

comment on function public.clear_status_report_source_file_on_delete() is 'Clears deliverables.source_file_id on any Status Report whose source file is being deleted.';

comment on function public.webhook_deliverable_finalized() is 'Fires one SharePoint sync per finalize (Pre-finalized -> Outbox), after all finalized rows incl. annexes are committed. Replaces the per-row deliverable_files insert trigger to avoid O(N^2) re-uploads.';

-- ───────────────── scrubs ─────────────────
-- Replace the hardcoded-URL/secret variant captured from live: same
-- debounce + queue behavior, config now read from Vault like the
-- call_app_api* helpers. The /api/matter-summary route authenticates
-- DB-trigger calls via the x-cron-secret header.
CREATE OR REPLACE FUNCTION public.queue_matter_summary_refresh()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  _matter_id TEXT;
  _last_updated TIMESTAMPTZ;
  _base_url TEXT;
  _secret TEXT;
BEGIN
  _matter_id := NEW.matter_id;

  IF _matter_id IS NULL OR _matter_id = '' THEN
    RETURN NEW;
  END IF;

  -- Debounce: skip if summary was refreshed in the last 5 minutes
  SELECT updated_at INTO _last_updated
  FROM matter_summaries
  WHERE matter_id = _matter_id;

  IF _last_updated IS NOT NULL AND _last_updated > now() - interval '5 minutes' THEN
    RETURN NEW;
  END IF;

  SELECT decrypted_secret INTO _base_url FROM vault.decrypted_secrets WHERE name = 'app_base_url' LIMIT 1;
  SELECT decrypted_secret INTO _secret FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1;
  IF _base_url IS NULL OR _secret IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url := _base_url || '/api/matter-summary',
    body := jsonb_build_object('matterId', _matter_id),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', _secret
    ),
    timeout_milliseconds := 30000
  );

  RETURN NEW;
END;
$function$
;

drop table if exists public.user_passwords;
drop table if exists public.sync_log;
