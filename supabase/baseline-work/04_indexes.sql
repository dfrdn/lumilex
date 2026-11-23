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
