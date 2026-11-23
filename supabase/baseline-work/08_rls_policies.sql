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
