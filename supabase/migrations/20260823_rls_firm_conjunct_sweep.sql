-- Multitenancy RLS phase, part 2: firm conjunct sweep.
--
-- GENERATED from live pg_policies on the dev project (2026-08-23), not from
-- the repo baseline. Every policy on a table that has firm_id is dropped and
-- recreated with its original predicate strengthened by
-- "firm_id = public.current_firm_id()" (both USING and WITH CHECK,
-- independently). Portal policies additionally swap the inline
-- client_users.client_id subquery for public.current_client_id() (Rule E).
-- Names, commands, and permissiveness are preserved; the four legacy
-- public-role app policies are retargeted to authenticated (Rule F). Policies
-- on global tables, service_role-targeted policies, and the two legacy
-- "Service role full access ..." policies are untouched.

-- rule C: agent_proposals.agent_proposals_matter_select
drop policy if exists "agent_proposals_matter_select" on public.agent_proposals;
create policy "agent_proposals_matter_select" on public.agent_proposals
  for select to authenticated
  using ((firm_id = public.current_firm_id() AND (has_matter_access(matter_id))));

-- rule C: agent_proposals.agent_proposals_matter_write
drop policy if exists "agent_proposals_matter_write" on public.agent_proposals;
create policy "agent_proposals_matter_write" on public.agent_proposals
  for all to authenticated
  using ((firm_id = public.current_firm_id() AND (has_matter_access(matter_id))))
  with check ((firm_id = public.current_firm_id() AND (has_matter_access(matter_id))));

-- rule B: announcements.announcements_admin_write
drop policy if exists "announcements_admin_write" on public.announcements;
create policy "announcements_admin_write" on public.announcements
  for all to authenticated
  using ((firm_id = public.current_firm_id() AND (("current_role"() = ANY (ARRAY['admin'::text, 'super_user'::text])))))
  with check ((firm_id = public.current_firm_id() AND (("current_role"() = ANY (ARRAY['admin'::text, 'super_user'::text])))));

-- rule A: announcements.announcements_authenticated_select
drop policy if exists "announcements_authenticated_select" on public.announcements;
create policy "announcements_authenticated_select" on public.announcements
  for select to authenticated
  using ((firm_id = public.current_firm_id() AND public.current_person_id() IS NOT NULL));

-- rule D: attendance.attendance_own_modify
drop policy if exists "attendance_own_modify" on public.attendance;
create policy "attendance_own_modify" on public.attendance
  for all to authenticated
  using ((firm_id = public.current_firm_id() AND (((lawyer_id = ANY (current_person_identifiers())) OR ("current_role"() = ANY (ARRAY['admin'::text, 'super_user'::text]))))))
  with check ((firm_id = public.current_firm_id() AND (((lawyer_id = ANY (current_person_identifiers())) OR ("current_role"() = ANY (ARRAY['admin'::text, 'super_user'::text]))))));

-- rule D: attendance.attendance_own_select
drop policy if exists "attendance_own_select" on public.attendance;
create policy "attendance_own_select" on public.attendance
  for select to authenticated
  using ((firm_id = public.current_firm_id() AND (((lawyer_id = ANY (current_person_identifiers())) OR ("current_role"() = ANY (ARRAY['partner'::text, 'admin'::text, 'finance'::text, 'super_user'::text]))))));

-- rule B: billing_rates.billing_rates_finance_all
drop policy if exists "billing_rates_finance_all" on public.billing_rates;
create policy "billing_rates_finance_all" on public.billing_rates
  for all to authenticated
  using ((firm_id = public.current_firm_id() AND (("current_role"() = ANY (ARRAY['finance'::text, 'admin'::text, 'super_user'::text])))))
  with check ((firm_id = public.current_firm_id() AND (("current_role"() = ANY (ARRAY['finance'::text, 'admin'::text, 'super_user'::text])))));

-- rule G: chat_channels.chat_channels_member_select
drop policy if exists "chat_channels_member_select" on public.chat_channels;
create policy "chat_channels_member_select" on public.chat_channels
  for select to authenticated
  using ((firm_id = public.current_firm_id() AND ((EXISTS ( SELECT 1
   FROM team t
  WHERE ((t.auth_user_id = auth.uid()) AND t.active AND (t.person_id = ANY (chat_channels.member_ids))))))));

-- rule G: chat_messages.chat_messages_channel_member_select
drop policy if exists "chat_messages_channel_member_select" on public.chat_messages;
create policy "chat_messages_channel_member_select" on public.chat_messages
  for select to authenticated
  using ((firm_id = public.current_firm_id() AND ((EXISTS ( SELECT 1
   FROM (chat_channels c
     JOIN team t ON ((t.person_id = ANY (c.member_ids))))
  WHERE ((c.id = chat_messages.channel_id) AND (t.auth_user_id = auth.uid()) AND t.active))))));

-- rule G: chat_reactions.chat_reactions_channel_member_select
drop policy if exists "chat_reactions_channel_member_select" on public.chat_reactions;
create policy "chat_reactions_channel_member_select" on public.chat_reactions
  for select to authenticated
  using ((firm_id = public.current_firm_id() AND ((EXISTS ( SELECT 1
   FROM (chat_channels c
     JOIN team t ON ((t.person_id = ANY (c.member_ids))))
  WHERE ((c.id = chat_reactions.channel_id) AND (t.auth_user_id = auth.uid()) AND t.active))))));

-- rule G: chat_read_receipts.chat_read_receipts_channel_member_select
drop policy if exists "chat_read_receipts_channel_member_select" on public.chat_read_receipts;
create policy "chat_read_receipts_channel_member_select" on public.chat_read_receipts
  for select to authenticated
  using ((firm_id = public.current_firm_id() AND ((EXISTS ( SELECT 1
   FROM (chat_channels c
     JOIN team t ON ((t.person_id = ANY (c.member_ids))))
  WHERE ((c.id = chat_read_receipts.channel_id) AND (t.auth_user_id = auth.uid()) AND t.active))))));

-- rule B: client_deposits.client_deposits_finance_all
drop policy if exists "client_deposits_finance_all" on public.client_deposits;
create policy "client_deposits_finance_all" on public.client_deposits
  for all to authenticated
  using ((firm_id = public.current_firm_id() AND (("current_role"() = ANY (ARRAY['finance'::text, 'admin'::text, 'super_user'::text])))))
  with check ((firm_id = public.current_firm_id() AND (("current_role"() = ANY (ARRAY['finance'::text, 'admin'::text, 'super_user'::text])))));

-- rule E: client_deposits.client_deposits_portal_select
drop policy if exists "client_deposits_portal_select" on public.client_deposits;
create policy "client_deposits_portal_select" on public.client_deposits
  for select to authenticated
  using ((firm_id = public.current_firm_id() AND ((client_id = public.current_client_id()))));

-- rule D: client_intakes.client_intakes_assigned_or_admin_write
drop policy if exists "client_intakes_assigned_or_admin_write" on public.client_intakes;
create policy "client_intakes_assigned_or_admin_write" on public.client_intakes
  for all to authenticated
  using ((firm_id = public.current_firm_id() AND (((assigned_lawyer_id = current_person_id()) OR ("current_role"() = ANY (ARRAY['admin'::text, 'super_user'::text, 'partner'::text]))))))
  with check ((firm_id = public.current_firm_id() AND (((assigned_lawyer_id = current_person_id()) OR ("current_role"() = ANY (ARRAY['admin'::text, 'super_user'::text, 'partner'::text]))))));

-- rule A: client_intakes.client_intakes_team_select
drop policy if exists "client_intakes_team_select" on public.client_intakes;
create policy "client_intakes_team_select" on public.client_intakes
  for select to authenticated
  using ((firm_id = public.current_firm_id() AND public.current_person_id() IS NOT NULL));

-- rule B: client_partner_notes.client_partner_notes_delete
drop policy if exists "client_partner_notes_delete" on public.client_partner_notes;
create policy "client_partner_notes_delete" on public.client_partner_notes
  for delete to authenticated
  using ((firm_id = public.current_firm_id() AND (("current_role"() = ANY (ARRAY['partner'::text, 'super_user'::text])))));

-- rule D: client_partner_notes.client_partner_notes_insert
drop policy if exists "client_partner_notes_insert" on public.client_partner_notes;
create policy "client_partner_notes_insert" on public.client_partner_notes
  for insert to authenticated
  with check ((firm_id = public.current_firm_id() AND ((("current_role"() = ANY (ARRAY['partner'::text, 'super_user'::text])) AND (author_id = current_person_id())))));

-- rule B: client_partner_notes.client_partner_notes_modify
drop policy if exists "client_partner_notes_modify" on public.client_partner_notes;
create policy "client_partner_notes_modify" on public.client_partner_notes
  for update to authenticated
  using ((firm_id = public.current_firm_id() AND (("current_role"() = ANY (ARRAY['partner'::text, 'super_user'::text])))))
  with check ((firm_id = public.current_firm_id() AND (("current_role"() = ANY (ARRAY['partner'::text, 'super_user'::text])))));

-- rule B: client_partner_notes.client_partner_notes_select
drop policy if exists "client_partner_notes_select" on public.client_partner_notes;
create policy "client_partner_notes_select" on public.client_partner_notes
  for select to authenticated
  using ((firm_id = public.current_firm_id() AND (("current_role"() = ANY (ARRAY['partner'::text, 'super_user'::text])))));

-- rule G: client_users.client_users_select_own
drop policy if exists "client_users_select_own" on public.client_users;
create policy "client_users_select_own" on public.client_users
  for select to authenticated
  using ((firm_id = public.current_firm_id() AND ((auth_user_id = auth.uid()))));

-- rule E: clients.clients_portal_select
drop policy if exists "clients_portal_select" on public.clients;
create policy "clients_portal_select" on public.clients
  for select to authenticated
  using ((firm_id = public.current_firm_id() AND ((notion_id = public.current_client_id()))));

-- rule A: clients.clients_team_select
drop policy if exists "clients_team_select" on public.clients;
create policy "clients_team_select" on public.clients
  for select to authenticated
  using ((firm_id = public.current_firm_id() AND public.current_person_id() IS NOT NULL));

-- rule B: clients.clients_team_write
drop policy if exists "clients_team_write" on public.clients;
create policy "clients_team_write" on public.clients
  for all to authenticated
  using ((firm_id = public.current_firm_id() AND (("current_role"() = ANY (ARRAY['partner'::text, 'admin'::text, 'super_user'::text, 'finance'::text])))))
  with check ((firm_id = public.current_firm_id() AND (("current_role"() = ANY (ARRAY['partner'::text, 'admin'::text, 'super_user'::text, 'finance'::text])))));

-- rule A: corporation_affiliations.corporation_affiliations_team
drop policy if exists "corporation_affiliations_team" on public.corporation_affiliations;
create policy "corporation_affiliations_team" on public.corporation_affiliations
  for all to authenticated
  using ((firm_id = public.current_firm_id() AND public.current_person_id() IS NOT NULL))
  with check ((firm_id = public.current_firm_id() AND public.current_person_id() IS NOT NULL));

-- rule A: corporation_files.corporation_files_team
drop policy if exists "corporation_files_team" on public.corporation_files;
create policy "corporation_files_team" on public.corporation_files
  for all to authenticated
  using ((firm_id = public.current_firm_id() AND public.current_person_id() IS NOT NULL))
  with check ((firm_id = public.current_firm_id() AND public.current_person_id() IS NOT NULL));

-- rule A: corporation_meetings.corporation_meetings_team
drop policy if exists "corporation_meetings_team" on public.corporation_meetings;
create policy "corporation_meetings_team" on public.corporation_meetings
  for all to authenticated
  using ((firm_id = public.current_firm_id() AND public.current_person_id() IS NOT NULL))
  with check ((firm_id = public.current_firm_id() AND public.current_person_id() IS NOT NULL));

-- rule A: corporation_persons.corporation_persons_team
drop policy if exists "corporation_persons_team" on public.corporation_persons;
create policy "corporation_persons_team" on public.corporation_persons
  for all to authenticated
  using ((firm_id = public.current_firm_id() AND public.current_person_id() IS NOT NULL))
  with check ((firm_id = public.current_firm_id() AND public.current_person_id() IS NOT NULL));

-- rule A: corporation_share_classes.corporation_share_classes_team
drop policy if exists "corporation_share_classes_team" on public.corporation_share_classes;
create policy "corporation_share_classes_team" on public.corporation_share_classes
  for all to authenticated
  using ((firm_id = public.current_firm_id() AND public.current_person_id() IS NOT NULL))
  with check ((firm_id = public.current_firm_id() AND public.current_person_id() IS NOT NULL));

-- rule A: corporations.corporations_team_select
drop policy if exists "corporations_team_select" on public.corporations;
create policy "corporations_team_select" on public.corporations
  for select to authenticated
  using ((firm_id = public.current_firm_id() AND public.current_person_id() IS NOT NULL));

-- rule A: corporations.corporations_team_write
drop policy if exists "corporations_team_write" on public.corporations;
create policy "corporations_team_write" on public.corporations
  for all to authenticated
  using ((firm_id = public.current_firm_id() AND public.current_person_id() IS NOT NULL))
  with check ((firm_id = public.current_firm_id() AND public.current_person_id() IS NOT NULL));

-- rule C: deadline_chain_items.deadline_chain_items_matter_access
drop policy if exists "deadline_chain_items_matter_access" on public.deadline_chain_items;
create policy "deadline_chain_items_matter_access" on public.deadline_chain_items
  for all to authenticated
  using ((firm_id = public.current_firm_id() AND ((EXISTS ( SELECT 1
   FROM deadline_chains c
  WHERE ((c.id = deadline_chain_items.chain_id) AND has_matter_access(c.matter_id)))))))
  with check ((firm_id = public.current_firm_id() AND ((EXISTS ( SELECT 1
   FROM deadline_chains c
  WHERE ((c.id = deadline_chain_items.chain_id) AND has_matter_access(c.matter_id)))))));

-- rule C: deadline_chains.deadline_chains_matter_select
drop policy if exists "deadline_chains_matter_select" on public.deadline_chains;
create policy "deadline_chains_matter_select" on public.deadline_chains
  for select to authenticated
  using ((firm_id = public.current_firm_id() AND (has_matter_access(matter_id))));

-- rule C: deadline_chains.deadline_chains_matter_write
drop policy if exists "deadline_chains_matter_write" on public.deadline_chains;
create policy "deadline_chains_matter_write" on public.deadline_chains
  for all to authenticated
  using ((firm_id = public.current_firm_id() AND (has_matter_access(matter_id))))
  with check ((firm_id = public.current_firm_id() AND (has_matter_access(matter_id))));

-- rule C: deliverable_actions.deliverable_actions_matter_access
drop policy if exists "deliverable_actions_matter_access" on public.deliverable_actions;
create policy "deliverable_actions_matter_access" on public.deliverable_actions
  for all to authenticated
  using ((firm_id = public.current_firm_id() AND ((EXISTS ( SELECT 1
   FROM deliverables d
  WHERE ((d.notion_id = deliverable_actions.deliverable_id) AND has_matter_access(d.matter_id)))))))
  with check ((firm_id = public.current_firm_id() AND ((EXISTS ( SELECT 1
   FROM deliverables d
  WHERE ((d.notion_id = deliverable_actions.deliverable_id) AND has_matter_access(d.matter_id)))))));

-- rule C: deliverable_comment_reactions.deliverable_comment_reactions_matter_access
drop policy if exists "deliverable_comment_reactions_matter_access" on public.deliverable_comment_reactions;
create policy "deliverable_comment_reactions_matter_access" on public.deliverable_comment_reactions
  for all to authenticated
  using ((firm_id = public.current_firm_id() AND ((EXISTS ( SELECT 1
   FROM (deliverable_comments c
     JOIN deliverables d ON ((d.notion_id = c.deliverable_id)))
  WHERE ((c.id = deliverable_comment_reactions.comment_id) AND has_matter_access(d.matter_id)))))))
  with check ((firm_id = public.current_firm_id() AND ((EXISTS ( SELECT 1
   FROM (deliverable_comments c
     JOIN deliverables d ON ((d.notion_id = c.deliverable_id)))
  WHERE ((c.id = deliverable_comment_reactions.comment_id) AND has_matter_access(d.matter_id)))))));

-- rule C: deliverable_comments.deliverable_comments_matter_access
drop policy if exists "deliverable_comments_matter_access" on public.deliverable_comments;
create policy "deliverable_comments_matter_access" on public.deliverable_comments
  for all to authenticated
  using ((firm_id = public.current_firm_id() AND ((EXISTS ( SELECT 1
   FROM deliverables d
  WHERE ((d.notion_id = deliverable_comments.deliverable_id) AND has_matter_access(d.matter_id)))))))
  with check ((firm_id = public.current_firm_id() AND ((EXISTS ( SELECT 1
   FROM deliverables d
  WHERE ((d.notion_id = deliverable_comments.deliverable_id) AND has_matter_access(d.matter_id)))))));

-- rule C: deliverable_files.deliverable_files_matter_access
drop policy if exists "deliverable_files_matter_access" on public.deliverable_files;
create policy "deliverable_files_matter_access" on public.deliverable_files
  for all to authenticated
  using ((firm_id = public.current_firm_id() AND ((EXISTS ( SELECT 1
   FROM deliverables d
  WHERE ((d.notion_id = deliverable_files.deliverable_id) AND has_matter_access(d.matter_id)))))))
  with check ((firm_id = public.current_firm_id() AND ((EXISTS ( SELECT 1
   FROM deliverables d
  WHERE ((d.notion_id = deliverable_files.deliverable_id) AND has_matter_access(d.matter_id)))))));

-- rule C: deliverable_version_reactions.deliverable_version_reactions_matter_access
drop policy if exists "deliverable_version_reactions_matter_access" on public.deliverable_version_reactions;
create policy "deliverable_version_reactions_matter_access" on public.deliverable_version_reactions
  for all to authenticated
  using ((firm_id = public.current_firm_id() AND ((EXISTS ( SELECT 1
   FROM deliverables d
  WHERE ((d.notion_id = deliverable_version_reactions.deliverable_id) AND has_matter_access(d.matter_id)))))))
  with check ((firm_id = public.current_firm_id() AND ((EXISTS ( SELECT 1
   FROM deliverables d
  WHERE ((d.notion_id = deliverable_version_reactions.deliverable_id) AND has_matter_access(d.matter_id)))))));

-- rule C: deliverables.deliverables_matter_select
drop policy if exists "deliverables_matter_select" on public.deliverables;
create policy "deliverables_matter_select" on public.deliverables
  for select to authenticated
  using ((firm_id = public.current_firm_id() AND (has_matter_access(matter_id))));

-- rule C: deliverables.deliverables_matter_write
drop policy if exists "deliverables_matter_write" on public.deliverables;
create policy "deliverables_matter_write" on public.deliverables
  for all to authenticated
  using ((firm_id = public.current_firm_id() AND (has_matter_access(matter_id))))
  with check ((firm_id = public.current_firm_id() AND (has_matter_access(matter_id))));

-- rule E: deliverables.deliverables_portal_select
drop policy if exists "deliverables_portal_select" on public.deliverables;
create policy "deliverables_portal_select" on public.deliverables
  for select to authenticated
  using ((firm_id = public.current_firm_id() AND ((matter_id IN ( SELECT matters.notion_id
   FROM matters
  WHERE (matters.client_id = public.current_client_id()))))));

-- rule B: directory.directory_admin_write
drop policy if exists "directory_admin_write" on public.directory;
create policy "directory_admin_write" on public.directory
  for all to authenticated
  using ((firm_id = public.current_firm_id() AND (("current_role"() = ANY (ARRAY['admin'::text, 'super_user'::text])))))
  with check ((firm_id = public.current_firm_id() AND (("current_role"() = ANY (ARRAY['admin'::text, 'super_user'::text])))));

-- rule A: directory.directory_authenticated_select
drop policy if exists "directory_authenticated_select" on public.directory;
create policy "directory_authenticated_select" on public.directory
  for select to authenticated
  using ((firm_id = public.current_firm_id() AND public.current_person_id() IS NOT NULL));

-- rule A: document_templates.document_templates_authenticated_select
drop policy if exists "document_templates_authenticated_select" on public.document_templates;
create policy "document_templates_authenticated_select" on public.document_templates
  for select to authenticated
  using ((firm_id = public.current_firm_id() AND public.current_person_id() IS NOT NULL));

-- rule D: document_templates.document_templates_creator_write
drop policy if exists "document_templates_creator_write" on public.document_templates;
create policy "document_templates_creator_write" on public.document_templates
  for all to authenticated
  using ((firm_id = public.current_firm_id() AND (((created_by = current_person_id()) OR ("current_role"() = ANY (ARRAY['admin'::text, 'super_user'::text]))))))
  with check ((firm_id = public.current_firm_id() AND (((created_by = current_person_id()) OR ("current_role"() = ANY (ARRAY['admin'::text, 'super_user'::text]))))));

-- rule B: drafting_style_profiles.drafting_style_profiles_admin_write
drop policy if exists "drafting_style_profiles_admin_write" on public.drafting_style_profiles;
create policy "drafting_style_profiles_admin_write" on public.drafting_style_profiles
  for all to authenticated
  using ((firm_id = public.current_firm_id() AND (("current_role"() = ANY (ARRAY['partner'::text, 'admin'::text, 'super_user'::text])))))
  with check ((firm_id = public.current_firm_id() AND (("current_role"() = ANY (ARRAY['partner'::text, 'admin'::text, 'super_user'::text])))));

-- rule A: drafting_style_profiles.drafting_style_profiles_staff_select
drop policy if exists "drafting_style_profiles_staff_select" on public.drafting_style_profiles;
create policy "drafting_style_profiles_staff_select" on public.drafting_style_profiles
  for select to authenticated
  using ((firm_id = public.current_firm_id() AND public.current_person_id() IS NOT NULL));

-- rule D: dtr.dtr_own_modify
drop policy if exists "dtr_own_modify" on public.dtr;
create policy "dtr_own_modify" on public.dtr
  for all to authenticated
  using ((firm_id = public.current_firm_id() AND (((lawyer_name = current_person_name()) OR ("current_role"() = ANY (ARRAY['admin'::text, 'super_user'::text, 'finance'::text]))))))
  with check ((firm_id = public.current_firm_id() AND (((lawyer_name = current_person_name()) OR ("current_role"() = ANY (ARRAY['admin'::text, 'super_user'::text, 'finance'::text]))))));

-- rule D: dtr.dtr_own_select
drop policy if exists "dtr_own_select" on public.dtr;
create policy "dtr_own_select" on public.dtr
  for select to authenticated
  using ((firm_id = public.current_firm_id() AND (((lawyer_name = current_person_name()) OR ("current_role"() = ANY (ARRAY['partner'::text, 'admin'::text, 'finance'::text, 'super_user'::text]))))));

-- rule B: dtr_revision_comments.dtr_revision_comments_finance
drop policy if exists "dtr_revision_comments_finance" on public.dtr_revision_comments;
create policy "dtr_revision_comments_finance" on public.dtr_revision_comments
  for all to authenticated
  using ((firm_id = public.current_firm_id() AND (("current_role"() = ANY (ARRAY['finance'::text, 'admin'::text, 'super_user'::text, 'partner'::text])))))
  with check ((firm_id = public.current_firm_id() AND (("current_role"() = ANY (ARRAY['finance'::text, 'admin'::text, 'super_user'::text, 'partner'::text])))));

-- rule B: dtr_revision_reviews.dtr_revision_reviews_finance
drop policy if exists "dtr_revision_reviews_finance" on public.dtr_revision_reviews;
create policy "dtr_revision_reviews_finance" on public.dtr_revision_reviews
  for all to authenticated
  using ((firm_id = public.current_firm_id() AND (("current_role"() = ANY (ARRAY['finance'::text, 'admin'::text, 'super_user'::text, 'partner'::text])))))
  with check ((firm_id = public.current_firm_id() AND (("current_role"() = ANY (ARRAY['finance'::text, 'admin'::text, 'super_user'::text, 'partner'::text])))));

-- rule C: dtr_revisions.dtr_revisions_matter_select
drop policy if exists "dtr_revisions_matter_select" on public.dtr_revisions;
create policy "dtr_revisions_matter_select" on public.dtr_revisions
  for select to authenticated
  using ((firm_id = public.current_firm_id() AND (has_matter_access(matter_id))));

-- rule C: dtr_revisions.dtr_revisions_matter_write
drop policy if exists "dtr_revisions_matter_write" on public.dtr_revisions;
create policy "dtr_revisions_matter_write" on public.dtr_revisions
  for all to authenticated
  using ((firm_id = public.current_firm_id() AND (has_matter_access(matter_id))))
  with check ((firm_id = public.current_firm_id() AND (has_matter_access(matter_id))));

-- rule C: email_attachments.email_attachments_owner_matter_select
drop policy if exists "email_attachments_owner_matter_select" on public.email_attachments;
create policy "email_attachments_owner_matter_select" on public.email_attachments
  for select to authenticated
  using ((firm_id = public.current_firm_id() AND (can_access_email(email_id))));

-- rule C: email_mailbox_copies.email_mailbox_copies_owner_matter_select
drop policy if exists "email_mailbox_copies_owner_matter_select" on public.email_mailbox_copies;
create policy "email_mailbox_copies_owner_matter_select" on public.email_mailbox_copies
  for select to authenticated
  using ((firm_id = public.current_firm_id() AND (can_access_email(email_id))));

-- rule D: email_mailboxes.email_mailboxes_scoped_select
drop policy if exists "email_mailboxes_scoped_select" on public.email_mailboxes;
create policy "email_mailboxes_scoped_select" on public.email_mailboxes
  for select to authenticated
  using ((firm_id = public.current_firm_id() AND (((current_person_id() IS NOT NULL) AND ((mailbox_type = 'shared'::text) OR (owner_person_id = current_person_id()) OR ("current_role"() = ANY (ARRAY['admin'::text, 'super_user'::text])))))));

-- rule C: email_matter_links.email_matter_links_matter_select
drop policy if exists "email_matter_links_matter_select" on public.email_matter_links;
create policy "email_matter_links_matter_select" on public.email_matter_links
  for select to authenticated
  using ((firm_id = public.current_firm_id() AND (has_matter_access(matter_id))));

-- rule C: email_matter_links.email_matter_links_matter_write
drop policy if exists "email_matter_links_matter_write" on public.email_matter_links;
create policy "email_matter_links_matter_write" on public.email_matter_links
  for all to authenticated
  using ((firm_id = public.current_firm_id() AND (has_matter_access(matter_id))))
  with check ((firm_id = public.current_firm_id() AND (has_matter_access(matter_id))));

-- rule C: emails.emails_owner_matter_select
drop policy if exists "emails_owner_matter_select" on public.emails;
create policy "emails_owner_matter_select" on public.emails
  for select to authenticated
  using ((firm_id = public.current_firm_id() AND (can_access_email(id))));

-- rule D: engagement_proposals.engagement_proposals_assigned_or_admin_write
drop policy if exists "engagement_proposals_assigned_or_admin_write" on public.engagement_proposals;
create policy "engagement_proposals_assigned_or_admin_write" on public.engagement_proposals
  for all to authenticated
  using ((firm_id = public.current_firm_id() AND ((("current_role"() = ANY (ARRAY['admin'::text, 'super_user'::text, 'partner'::text])) OR ((intake_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM client_intakes i
  WHERE ((i.id = engagement_proposals.intake_id) AND (i.assigned_lawyer_id = current_person_id())))))))))
  with check ((firm_id = public.current_firm_id() AND ((("current_role"() = ANY (ARRAY['admin'::text, 'super_user'::text, 'partner'::text])) OR ((intake_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM client_intakes i
  WHERE ((i.id = engagement_proposals.intake_id) AND (i.assigned_lawyer_id = current_person_id())))))))));

-- rule A: engagement_proposals.engagement_proposals_team_select
drop policy if exists "engagement_proposals_team_select" on public.engagement_proposals;
create policy "engagement_proposals_team_select" on public.engagement_proposals
  for select to authenticated
  using ((firm_id = public.current_firm_id() AND public.current_person_id() IS NOT NULL));

-- rule E: engagement_signatures.engagement_signatures_portal_select
drop policy if exists "engagement_signatures_portal_select" on public.engagement_signatures;
create policy "engagement_signatures_portal_select" on public.engagement_signatures
  for select to authenticated
  using ((firm_id = public.current_firm_id() AND ((matter_id IN ( SELECT matters.notion_id
   FROM matters
  WHERE (matters.client_id = public.current_client_id()))))));

-- rule C: engagement_signatures.engagement_signatures_team_select
drop policy if exists "engagement_signatures_team_select" on public.engagement_signatures;
create policy "engagement_signatures_team_select" on public.engagement_signatures
  for select to authenticated
  using ((firm_id = public.current_firm_id() AND (has_matter_access(matter_id))));

-- rule D: entity_comment_reactions.entity_comment_reactions_author_write
drop policy if exists "entity_comment_reactions_author_write" on public.entity_comment_reactions;
create policy "entity_comment_reactions_author_write" on public.entity_comment_reactions
  for all to authenticated
  using ((firm_id = public.current_firm_id() AND ((person_id = current_person_id()))))
  with check ((firm_id = public.current_firm_id() AND ((person_id = current_person_id()))));

-- rule A: entity_comment_reactions.entity_comment_reactions_team_select
drop policy if exists "entity_comment_reactions_team_select" on public.entity_comment_reactions;
create policy "entity_comment_reactions_team_select" on public.entity_comment_reactions
  for select to authenticated
  using ((firm_id = public.current_firm_id() AND public.current_person_id() IS NOT NULL));

-- rule D: entity_comments.entity_comments_author_write
drop policy if exists "entity_comments_author_write" on public.entity_comments;
create policy "entity_comments_author_write" on public.entity_comments
  for all to authenticated
  using ((firm_id = public.current_firm_id() AND (((person_id = current_person_id()) OR ("current_role"() = ANY (ARRAY['admin'::text, 'super_user'::text, 'partner'::text]))))))
  with check ((firm_id = public.current_firm_id() AND (((person_id = current_person_id()) OR ("current_role"() = ANY (ARRAY['admin'::text, 'super_user'::text, 'partner'::text]))))));

-- rule A: entity_comments.entity_comments_team_select
drop policy if exists "entity_comments_team_select" on public.entity_comments;
create policy "entity_comments_team_select" on public.entity_comments
  for select to authenticated
  using ((firm_id = public.current_firm_id() AND public.current_person_id() IS NOT NULL));

-- rule D: evaluation_period_discretionary_bonuses.discretionary_bonuses_visibility
drop policy if exists "discretionary_bonuses_visibility" on public.evaluation_period_discretionary_bonuses;
create policy "discretionary_bonuses_visibility" on public.evaluation_period_discretionary_bonuses
  for select to authenticated
  using ((firm_id = public.current_firm_id() AND (((partner_person_id = current_person_id()) OR (associate_person_id = current_person_id()) OR ("current_role"() = ANY (ARRAY['partner'::text, 'admin'::text, 'super_user'::text]))))));

-- rule B: evaluation_period_discretionary_bonuses.discretionary_bonuses_write
drop policy if exists "discretionary_bonuses_write" on public.evaluation_period_discretionary_bonuses;
create policy "discretionary_bonuses_write" on public.evaluation_period_discretionary_bonuses
  for all to authenticated
  using ((firm_id = public.current_firm_id() AND (("current_role"() = ANY (ARRAY['partner'::text, 'admin'::text, 'super_user'::text])))))
  with check ((firm_id = public.current_firm_id() AND (("current_role"() = ANY (ARRAY['partner'::text, 'admin'::text, 'super_user'::text])))));

-- rule D: evaluation_period_other_bonuses.other_bonuses_visibility
drop policy if exists "other_bonuses_visibility" on public.evaluation_period_other_bonuses;
create policy "other_bonuses_visibility" on public.evaluation_period_other_bonuses
  for select to authenticated
  using ((firm_id = public.current_firm_id() AND (((person_id = current_person_id()) OR ("current_role"() = ANY (ARRAY['partner'::text, 'admin'::text, 'super_user'::text]))))));

-- rule B: evaluation_period_other_bonuses.other_bonuses_write
drop policy if exists "other_bonuses_write" on public.evaluation_period_other_bonuses;
create policy "other_bonuses_write" on public.evaluation_period_other_bonuses
  for all to authenticated
  using ((firm_id = public.current_firm_id() AND (("current_role"() = ANY (ARRAY['partner'::text, 'admin'::text, 'super_user'::text])))))
  with check ((firm_id = public.current_firm_id() AND (("current_role"() = ANY (ARRAY['partner'::text, 'admin'::text, 'super_user'::text])))));

-- rule A: evaluation_periods.evaluation_periods_authenticated_select
drop policy if exists "evaluation_periods_authenticated_select" on public.evaluation_periods;
create policy "evaluation_periods_authenticated_select" on public.evaluation_periods
  for select to authenticated
  using ((firm_id = public.current_firm_id() AND public.current_person_id() IS NOT NULL));

-- rule B: evaluation_periods.evaluation_periods_partner_write
drop policy if exists "evaluation_periods_partner_write" on public.evaluation_periods;
create policy "evaluation_periods_partner_write" on public.evaluation_periods
  for all to authenticated
  using ((firm_id = public.current_firm_id() AND (("current_role"() = ANY (ARRAY['admin'::text, 'super_user'::text, 'partner'::text])))))
  with check ((firm_id = public.current_firm_id() AND (("current_role"() = ANY (ARRAY['admin'::text, 'super_user'::text, 'partner'::text])))));

-- rule D: evaluation_scores.evaluation_scores_visibility
drop policy if exists "evaluation_scores_visibility" on public.evaluation_scores;
create policy "evaluation_scores_visibility" on public.evaluation_scores
  for select to authenticated
  using ((firm_id = public.current_firm_id() AND ((EXISTS ( SELECT 1
   FROM evaluations e
  WHERE ((e.id = evaluation_scores.evaluation_id) AND ((e.evaluator_person_id = current_person_id()) OR (e.evaluatee_person_id = current_person_id()) OR ("current_role"() = ANY (ARRAY['partner'::text, 'admin'::text, 'super_user'::text])))))))));

-- rule B: evaluation_scores.evaluation_scores_write
drop policy if exists "evaluation_scores_write" on public.evaluation_scores;
create policy "evaluation_scores_write" on public.evaluation_scores
  for all to authenticated
  using ((firm_id = public.current_firm_id() AND (("current_role"() = ANY (ARRAY['partner'::text, 'admin'::text, 'super_user'::text])))))
  with check ((firm_id = public.current_firm_id() AND (("current_role"() = ANY (ARRAY['partner'::text, 'admin'::text, 'super_user'::text])))));

-- rule D: evaluations.evaluations_visibility
drop policy if exists "evaluations_visibility" on public.evaluations;
create policy "evaluations_visibility" on public.evaluations
  for select to authenticated
  using ((firm_id = public.current_firm_id() AND (((evaluator_person_id = current_person_id()) OR (evaluatee_person_id = current_person_id()) OR ("current_role"() = ANY (ARRAY['partner'::text, 'admin'::text, 'super_user'::text]))))));

-- rule B: evaluations.evaluations_write
drop policy if exists "evaluations_write" on public.evaluations;
create policy "evaluations_write" on public.evaluations
  for all to authenticated
  using ((firm_id = public.current_firm_id() AND (("current_role"() = ANY (ARRAY['partner'::text, 'admin'::text, 'super_user'::text])))))
  with check ((firm_id = public.current_firm_id() AND (("current_role"() = ANY (ARRAY['partner'::text, 'admin'::text, 'super_user'::text])))));

-- rule E: exhibits.exhibits_portal_select
drop policy if exists "exhibits_portal_select" on public.exhibits;
create policy "exhibits_portal_select" on public.exhibits
  for select to authenticated
  using ((firm_id = public.current_firm_id() AND ((matter_id IN ( SELECT matters.notion_id
   FROM matters
  WHERE (matters.client_id = public.current_client_id()))))));

-- rule C: exhibits.exhibits_team_select
drop policy if exists "exhibits_team_select" on public.exhibits;
create policy "exhibits_team_select" on public.exhibits
  for select to authenticated
  using ((firm_id = public.current_firm_id() AND (has_matter_access(matter_id))));

-- rule C: exhibits.exhibits_team_write
drop policy if exists "exhibits_team_write" on public.exhibits;
create policy "exhibits_team_write" on public.exhibits
  for all to authenticated
  using ((firm_id = public.current_firm_id() AND ((("current_role"() = ANY (ARRAY['lawyer'::text, 'partner'::text, 'admin'::text, 'super_user'::text])) AND has_matter_access(matter_id)))))
  with check ((firm_id = public.current_firm_id() AND ((("current_role"() = ANY (ARRAY['lawyer'::text, 'partner'::text, 'admin'::text, 'super_user'::text])) AND has_matter_access(matter_id)))));

-- rule B: expense_revisions.expense_revisions_finance
drop policy if exists "expense_revisions_finance" on public.expense_revisions;
create policy "expense_revisions_finance" on public.expense_revisions
  for all to authenticated
  using ((firm_id = public.current_firm_id() AND (("current_role"() = ANY (ARRAY['finance'::text, 'admin'::text, 'super_user'::text, 'partner'::text])))))
  with check ((firm_id = public.current_firm_id() AND (("current_role"() = ANY (ARRAY['finance'::text, 'admin'::text, 'super_user'::text, 'partner'::text])))));

-- rule B: fee_schedules.fee_schedules_admin_write
drop policy if exists "fee_schedules_admin_write" on public.fee_schedules;
create policy "fee_schedules_admin_write" on public.fee_schedules
  for all to authenticated
  using ((firm_id = public.current_firm_id() AND (("current_role"() = ANY (ARRAY['admin'::text, 'super_user'::text, 'finance'::text])))))
  with check ((firm_id = public.current_firm_id() AND (("current_role"() = ANY (ARRAY['admin'::text, 'super_user'::text, 'finance'::text])))));

-- rule A: fee_schedules.fee_schedules_read
drop policy if exists "fee_schedules_read" on public.fee_schedules;
create policy "fee_schedules_read" on public.fee_schedules
  for select to authenticated
  using ((firm_id = public.current_firm_id() AND public.current_person_id() IS NOT NULL));

-- rule D: feedbacks.feedbacks_delete
drop policy if exists "feedbacks_delete" on public.feedbacks;
create policy "feedbacks_delete" on public.feedbacks
  for delete to authenticated
  using ((firm_id = public.current_firm_id() AND (((submitted_by = current_person_id()) OR ("current_role"() = ANY (ARRAY['admin'::text, 'super_user'::text]))))));

-- rule A: feedbacks.feedbacks_insert
drop policy if exists "feedbacks_insert" on public.feedbacks;
create policy "feedbacks_insert" on public.feedbacks
  for insert to authenticated
  with check ((firm_id = public.current_firm_id() AND public.current_person_id() IS NOT NULL));

-- rule D: feedbacks.feedbacks_select
drop policy if exists "feedbacks_select" on public.feedbacks;
create policy "feedbacks_select" on public.feedbacks
  for select to authenticated
  using ((firm_id = public.current_firm_id() AND (((submitted_by = current_person_id()) OR ("current_role"() = ANY (ARRAY['admin'::text, 'partner'::text, 'super_user'::text]))))));

-- rule D: feedbacks.feedbacks_update
drop policy if exists "feedbacks_update" on public.feedbacks;
create policy "feedbacks_update" on public.feedbacks
  for update to authenticated
  using ((firm_id = public.current_firm_id() AND (((submitted_by = current_person_id()) OR ("current_role"() = ANY (ARRAY['admin'::text, 'super_user'::text]))))))
  with check ((firm_id = public.current_firm_id() AND (((submitted_by = current_person_id()) OR ("current_role"() = ANY (ARRAY['admin'::text, 'super_user'::text]))))));

-- rule E: file_requests.file_requests_portal_select
drop policy if exists "file_requests_portal_select" on public.file_requests;
create policy "file_requests_portal_select" on public.file_requests
  for select to authenticated
  using ((firm_id = public.current_firm_id() AND ((matter_id IN ( SELECT matters.notion_id
   FROM matters
  WHERE (matters.client_id = public.current_client_id()))))));

-- rule A: file_requests.file_requests_team_select
drop policy if exists "file_requests_team_select" on public.file_requests;
create policy "file_requests_team_select" on public.file_requests
  for select to authenticated
  using ((firm_id = public.current_firm_id() AND public.current_person_id() IS NOT NULL));

-- rule C: file_requests.file_requests_team_write
drop policy if exists "file_requests_team_write" on public.file_requests;
create policy "file_requests_team_write" on public.file_requests
  for all to authenticated
  using ((firm_id = public.current_firm_id() AND (has_matter_access(matter_id))))
  with check ((firm_id = public.current_firm_id() AND (has_matter_access(matter_id))));

-- rule E: files.files_portal_insert
drop policy if exists "files_portal_insert" on public.files;
create policy "files_portal_insert" on public.files
  for insert to authenticated
  with check ((firm_id = public.current_firm_id() AND (((matter_id IN ( SELECT matters.notion_id
   FROM matters
  WHERE (matters.client_id = public.current_client_id()))) AND (uploaded_by_client_user_id IN ( SELECT client_users.id
   FROM client_users
  WHERE (client_users.auth_user_id = auth.uid())))))));

-- rule E: files.files_portal_select
drop policy if exists "files_portal_select" on public.files;
create policy "files_portal_select" on public.files
  for select to authenticated
  using ((firm_id = public.current_firm_id() AND ((matter_id IN ( SELECT matters.notion_id
   FROM matters
  WHERE (matters.client_id = public.current_client_id()))))));

-- rule A: files.files_team_select
drop policy if exists "files_team_select" on public.files;
create policy "files_team_select" on public.files
  for select to authenticated
  using ((firm_id = public.current_firm_id() AND public.current_person_id() IS NOT NULL));

-- rule C: files.files_team_write
drop policy if exists "files_team_write" on public.files;
create policy "files_team_write" on public.files
  for all to authenticated
  using ((firm_id = public.current_firm_id() AND (((matter_id IS NULL) OR has_matter_access(matter_id)))))
  with check ((firm_id = public.current_firm_id() AND (((matter_id IS NULL) OR has_matter_access(matter_id)))));

-- rule B: firm_expense_templates.firm_expense_templates_finance_all
drop policy if exists "firm_expense_templates_finance_all" on public.firm_expense_templates;
create policy "firm_expense_templates_finance_all" on public.firm_expense_templates
  for all to authenticated
  using ((firm_id = public.current_firm_id() AND (("current_role"() = ANY (ARRAY['finance'::text, 'admin'::text, 'super_user'::text])))))
  with check ((firm_id = public.current_firm_id() AND (("current_role"() = ANY (ARRAY['finance'::text, 'admin'::text, 'super_user'::text])))));

-- rule B: firm_expenses.firm_expenses_finance_all
drop policy if exists "firm_expenses_finance_all" on public.firm_expenses;
create policy "firm_expenses_finance_all" on public.firm_expenses
  for all to authenticated
  using ((firm_id = public.current_firm_id() AND (("current_role"() = ANY (ARRAY['finance'::text, 'admin'::text, 'super_user'::text])))))
  with check ((firm_id = public.current_firm_id() AND (("current_role"() = ANY (ARRAY['finance'::text, 'admin'::text, 'super_user'::text])))));

-- rule B: firm_invoice_settings.firm_invoice_settings_manage
drop policy if exists "firm_invoice_settings_manage" on public.firm_invoice_settings;
create policy "firm_invoice_settings_manage" on public.firm_invoice_settings
  for all to authenticated
  using ((firm_id = public.current_firm_id() AND (("current_role"() = ANY (ARRAY['admin'::text, 'super_user'::text, 'finance'::text])))))
  with check ((firm_id = public.current_firm_id() AND (("current_role"() = ANY (ARRAY['admin'::text, 'super_user'::text, 'finance'::text])))));

-- rule B: firm_profiles.firm_profiles_admin_all
drop policy if exists "firm_profiles_admin_all" on public.firm_profiles;
create policy "firm_profiles_admin_all" on public.firm_profiles
  for all to authenticated
  using ((firm_id = public.current_firm_id() AND (("current_role"() = ANY (ARRAY['admin'::text, 'super_user'::text, 'finance'::text])))))
  with check ((firm_id = public.current_firm_id() AND (("current_role"() = ANY (ARRAY['admin'::text, 'super_user'::text, 'finance'::text])))));

-- rule C: hearings.hearings_matter_select
drop policy if exists "hearings_matter_select" on public.hearings;
create policy "hearings_matter_select" on public.hearings
  for select to authenticated
  using ((firm_id = public.current_firm_id() AND (has_matter_access(matter_id))));

-- rule C: hearings.hearings_matter_write
drop policy if exists "hearings_matter_write" on public.hearings;
create policy "hearings_matter_write" on public.hearings
  for all to authenticated
  using ((firm_id = public.current_firm_id() AND (has_matter_access(matter_id))))
  with check ((firm_id = public.current_firm_id() AND (has_matter_access(matter_id))));

-- rule E: hearings.hearings_portal_select
drop policy if exists "hearings_portal_select" on public.hearings;
create policy "hearings_portal_select" on public.hearings
  for select to authenticated
  using ((firm_id = public.current_firm_id() AND ((matter_id IN ( SELECT matters.notion_id
   FROM matters
  WHERE (matters.client_id = public.current_client_id()))))));

-- rule A: intake_stage_history.intake_stage_history_team
drop policy if exists "intake_stage_history_team" on public.intake_stage_history;
create policy "intake_stage_history_team" on public.intake_stage_history
  for all to authenticated
  using ((firm_id = public.current_firm_id() AND public.current_person_id() IS NOT NULL))
  with check ((firm_id = public.current_firm_id() AND public.current_person_id() IS NOT NULL));

-- rule B: intake_submissions.intake_submissions_partner_all
drop policy if exists "intake_submissions_partner_all" on public.intake_submissions;
create policy "intake_submissions_partner_all" on public.intake_submissions
  for all to authenticated
  using ((firm_id = public.current_firm_id() AND (("current_role"() = ANY (ARRAY['partner'::text, 'admin'::text, 'super_user'::text])))))
  with check ((firm_id = public.current_firm_id() AND (("current_role"() = ANY (ARRAY['partner'::text, 'admin'::text, 'super_user'::text])))));

-- rule B: invoice_payments.invoice_payments_finance_all
drop policy if exists "invoice_payments_finance_all" on public.invoice_payments;
create policy "invoice_payments_finance_all" on public.invoice_payments
  for all to authenticated
  using ((firm_id = public.current_firm_id() AND (("current_role"() = ANY (ARRAY['finance'::text, 'admin'::text, 'super_user'::text])))))
  with check ((firm_id = public.current_firm_id() AND (("current_role"() = ANY (ARRAY['finance'::text, 'admin'::text, 'super_user'::text])))));

-- rule E: invoice_payments.invoice_payments_portal_select
drop policy if exists "invoice_payments_portal_select" on public.invoice_payments;
create policy "invoice_payments_portal_select" on public.invoice_payments
  for select to authenticated
  using ((firm_id = public.current_firm_id() AND ((invoice_id IN ( SELECT i.id
   FROM invoices i
  WHERE ((i.status = ANY (ARRAY['sent'::text, 'partial'::text, 'paid'::text])) AND (i.client_id = public.current_client_id())))))));

-- rule B: invoices.invoices_finance_all
drop policy if exists "invoices_finance_all" on public.invoices;
create policy "invoices_finance_all" on public.invoices
  for all to authenticated
  using ((firm_id = public.current_firm_id() AND (("current_role"() = ANY (ARRAY['finance'::text, 'admin'::text, 'super_user'::text])))))
  with check ((firm_id = public.current_firm_id() AND (("current_role"() = ANY (ARRAY['finance'::text, 'admin'::text, 'super_user'::text])))));

-- rule E: invoices.invoices_portal_select
drop policy if exists "invoices_portal_select" on public.invoices;
create policy "invoices_portal_select" on public.invoices
  for select to authenticated
  using ((firm_id = public.current_firm_id() AND (((status = ANY (ARRAY['sent'::text, 'partial'::text, 'paid'::text])) AND (client_id = public.current_client_id())))));

-- rule B: issuance_scrape_runs.scrape_runs_admin_select
drop policy if exists "scrape_runs_admin_select" on public.issuance_scrape_runs;
create policy "scrape_runs_admin_select" on public.issuance_scrape_runs
  for select to authenticated
  using ((firm_id = public.current_firm_id() AND (("current_role"() = ANY (ARRAY['admin'::text, 'super_user'::text, 'partner'::text])))));

-- rule B: issuances.issuances_curator_delete
drop policy if exists "issuances_curator_delete" on public.issuances;
create policy "issuances_curator_delete" on public.issuances
  for delete to authenticated
  using ((firm_id = public.current_firm_id() AND (("current_role"() = ANY (ARRAY['partner'::text, 'admin'::text, 'super_user'::text])))));

-- rule B: issuances.issuances_curator_insert
drop policy if exists "issuances_curator_insert" on public.issuances;
create policy "issuances_curator_insert" on public.issuances
  for insert to authenticated
  with check ((firm_id = public.current_firm_id() AND (("current_role"() = ANY (ARRAY['partner'::text, 'admin'::text, 'super_user'::text])))));

-- rule B: issuances.issuances_curator_select
drop policy if exists "issuances_curator_select" on public.issuances;
create policy "issuances_curator_select" on public.issuances
  for select to authenticated
  using ((firm_id = public.current_firm_id() AND (("current_role"() = ANY (ARRAY['partner'::text, 'admin'::text, 'super_user'::text])))));

-- rule B: issuances.issuances_curator_update
drop policy if exists "issuances_curator_update" on public.issuances;
create policy "issuances_curator_update" on public.issuances
  for update to authenticated
  using ((firm_id = public.current_firm_id() AND (("current_role"() = ANY (ARRAY['partner'::text, 'admin'::text, 'super_user'::text])))))
  with check ((firm_id = public.current_firm_id() AND (("current_role"() = ANY (ARRAY['partner'::text, 'admin'::text, 'super_user'::text])))));

-- rule D: issuances.issuances_team_select
drop policy if exists "issuances_team_select" on public.issuances;
create policy "issuances_team_select" on public.issuances
  for select to authenticated
  using ((firm_id = public.current_firm_id() AND (((current_person_id() IS NOT NULL) AND (status <> 'rejected'::text) AND ((visible_to_roles IS NULL) OR (array_length(visible_to_roles, 1) IS NULL) OR ("current_role"() = ANY (visible_to_roles)) OR ("current_role"() = ANY (ARRAY['admin'::text, 'super_user'::text])))))));

-- rule B: kb_jobs.kb_jobs_admin_all
drop policy if exists "kb_jobs_admin_all" on public.kb_jobs;
create policy "kb_jobs_admin_all" on public.kb_jobs
  for all to authenticated
  using ((firm_id = public.current_firm_id() AND (("current_role"() = ANY (ARRAY['partner'::text, 'admin'::text, 'super_user'::text])))))
  with check ((firm_id = public.current_firm_id() AND (("current_role"() = ANY (ARRAY['partner'::text, 'admin'::text, 'super_user'::text])))));

-- rule B: kb_page_citations.kb_page_citations_admin_write
drop policy if exists "kb_page_citations_admin_write" on public.kb_page_citations;
create policy "kb_page_citations_admin_write" on public.kb_page_citations
  for all to authenticated
  using ((firm_id = public.current_firm_id() AND (("current_role"() = ANY (ARRAY['partner'::text, 'admin'::text, 'super_user'::text])))))
  with check ((firm_id = public.current_firm_id() AND (("current_role"() = ANY (ARRAY['partner'::text, 'admin'::text, 'super_user'::text])))));

-- rule A: kb_page_citations.kb_page_citations_staff_select
drop policy if exists "kb_page_citations_staff_select" on public.kb_page_citations;
create policy "kb_page_citations_staff_select" on public.kb_page_citations
  for select to authenticated
  using ((firm_id = public.current_firm_id() AND public.current_person_id() IS NOT NULL));

-- rule B: kb_page_matters.kb_page_matters_admin_write
drop policy if exists "kb_page_matters_admin_write" on public.kb_page_matters;
create policy "kb_page_matters_admin_write" on public.kb_page_matters
  for all to authenticated
  using ((firm_id = public.current_firm_id() AND (("current_role"() = ANY (ARRAY['partner'::text, 'admin'::text, 'super_user'::text])))))
  with check ((firm_id = public.current_firm_id() AND (("current_role"() = ANY (ARRAY['partner'::text, 'admin'::text, 'super_user'::text])))));

-- rule A: kb_page_matters.kb_page_matters_staff_select
drop policy if exists "kb_page_matters_staff_select" on public.kb_page_matters;
create policy "kb_page_matters_staff_select" on public.kb_page_matters
  for select to authenticated
  using ((firm_id = public.current_firm_id() AND public.current_person_id() IS NOT NULL));

-- rule B: kb_pages.kb_pages_admin_write
drop policy if exists "kb_pages_admin_write" on public.kb_pages;
create policy "kb_pages_admin_write" on public.kb_pages
  for all to authenticated
  using ((firm_id = public.current_firm_id() AND (("current_role"() = ANY (ARRAY['partner'::text, 'admin'::text, 'super_user'::text])))))
  with check ((firm_id = public.current_firm_id() AND (("current_role"() = ANY (ARRAY['partner'::text, 'admin'::text, 'super_user'::text])))));

-- rule A: kb_pages.kb_pages_staff_select
drop policy if exists "kb_pages_staff_select" on public.kb_pages;
create policy "kb_pages_staff_select" on public.kb_pages
  for select to authenticated
  using ((firm_id = public.current_firm_id() AND public.current_person_id() IS NOT NULL));

-- rule D: leaves.leaves_own_delete
drop policy if exists "leaves_own_delete" on public.leaves;
create policy "leaves_own_delete" on public.leaves
  for delete to authenticated
  using ((firm_id = public.current_firm_id() AND (((person_id = ANY (current_person_identifiers())) OR ("current_role"() = ANY (ARRAY['admin'::text, 'super_user'::text]))))));

-- rule D: leaves.leaves_own_insert
drop policy if exists "leaves_own_insert" on public.leaves;
create policy "leaves_own_insert" on public.leaves
  for insert to authenticated
  with check ((firm_id = public.current_firm_id() AND ((person_id = ANY (current_person_identifiers())))));

-- rule D: leaves.leaves_own_select
drop policy if exists "leaves_own_select" on public.leaves;
create policy "leaves_own_select" on public.leaves
  for select to authenticated
  using ((firm_id = public.current_firm_id() AND (((person_id = ANY (current_person_identifiers())) OR ("current_role"() = ANY (ARRAY['partner'::text, 'admin'::text, 'super_user'::text]))))));

-- rule D: leaves.leaves_own_update
drop policy if exists "leaves_own_update" on public.leaves;
create policy "leaves_own_update" on public.leaves
  for update to authenticated
  using ((firm_id = public.current_firm_id() AND (((person_id = ANY (current_person_identifiers())) OR ("current_role"() = ANY (ARRAY['partner'::text, 'admin'::text, 'super_user'::text]))))))
  with check ((firm_id = public.current_firm_id() AND (((person_id = ANY (current_person_identifiers())) OR ("current_role"() = ANY (ARRAY['partner'::text, 'admin'::text, 'super_user'::text]))))));

-- rule C: liaison_tasks.liaison_tasks_visibility
drop policy if exists "liaison_tasks_visibility" on public.liaison_tasks;
create policy "liaison_tasks_visibility" on public.liaison_tasks
  for select to authenticated
  using ((firm_id = public.current_firm_id() AND (((assigned_to = current_person_id()) OR (assigned_by = current_person_id()) OR ("current_role"() = ANY (ARRAY['chief_liaison_officer'::text, 'liaison_officer'::text, 'admin'::text, 'super_user'::text, 'partner'::text])) OR ((matter_id IS NOT NULL) AND has_matter_access(matter_id))))));

-- rule D: liaison_tasks.liaison_tasks_write
drop policy if exists "liaison_tasks_write" on public.liaison_tasks;
create policy "liaison_tasks_write" on public.liaison_tasks
  for all to authenticated
  using ((firm_id = public.current_firm_id() AND (((assigned_to = current_person_id()) OR (assigned_by = current_person_id()) OR ("current_role"() = ANY (ARRAY['chief_liaison_officer'::text, 'liaison_officer'::text, 'admin'::text, 'super_user'::text]))))))
  with check ((firm_id = public.current_firm_id() AND (((assigned_to = current_person_id()) OR (assigned_by = current_person_id()) OR ("current_role"() = ANY (ARRAY['chief_liaison_officer'::text, 'liaison_officer'::text, 'admin'::text, 'super_user'::text]))))));

-- rule C: matter_action_entries.matter_action_entries_matter_select
drop policy if exists "matter_action_entries_matter_select" on public.matter_action_entries;
create policy "matter_action_entries_matter_select" on public.matter_action_entries
  for select to authenticated
  using ((firm_id = public.current_firm_id() AND (has_matter_access(matter_id))));

-- rule C: matter_action_entries.matter_action_entries_matter_write
drop policy if exists "matter_action_entries_matter_write" on public.matter_action_entries;
create policy "matter_action_entries_matter_write" on public.matter_action_entries
  for all to authenticated
  using ((firm_id = public.current_firm_id() AND (has_matter_access(matter_id))))
  with check ((firm_id = public.current_firm_id() AND (has_matter_access(matter_id))));

-- rule B: matter_billing_actions.matter_billing_actions_finance_all
drop policy if exists "matter_billing_actions_finance_all" on public.matter_billing_actions;
create policy "matter_billing_actions_finance_all" on public.matter_billing_actions
  for all to authenticated
  using ((firm_id = public.current_firm_id() AND (("current_role"() = ANY (ARRAY['finance'::text, 'admin'::text, 'super_user'::text])))))
  with check ((firm_id = public.current_firm_id() AND (("current_role"() = ANY (ARRAY['finance'::text, 'admin'::text, 'super_user'::text])))));

-- rule B: matter_billing_configs.matter_billing_configs_finance_all
drop policy if exists "matter_billing_configs_finance_all" on public.matter_billing_configs;
create policy "matter_billing_configs_finance_all" on public.matter_billing_configs
  for all to authenticated
  using ((firm_id = public.current_firm_id() AND (("current_role"() = ANY (ARRAY['finance'::text, 'admin'::text, 'super_user'::text])))))
  with check ((firm_id = public.current_firm_id() AND (("current_role"() = ANY (ARRAY['finance'::text, 'admin'::text, 'super_user'::text])))));

-- rule B: matter_billing_milestones.matter_billing_milestones_finance_all
drop policy if exists "matter_billing_milestones_finance_all" on public.matter_billing_milestones;
create policy "matter_billing_milestones_finance_all" on public.matter_billing_milestones
  for all to authenticated
  using ((firm_id = public.current_firm_id() AND (("current_role"() = ANY (ARRAY['finance'::text, 'admin'::text, 'super_user'::text])))))
  with check ((firm_id = public.current_firm_id() AND (("current_role"() = ANY (ARRAY['finance'::text, 'admin'::text, 'super_user'::text])))));

-- rule E: matter_exec_summaries.matter_exec_summaries_portal_select
drop policy if exists "matter_exec_summaries_portal_select" on public.matter_exec_summaries;
create policy "matter_exec_summaries_portal_select" on public.matter_exec_summaries
  for select to authenticated
  using ((firm_id = public.current_firm_id() AND ((matter_id IN ( SELECT matters.notion_id
   FROM matters
  WHERE (matters.client_id = public.current_client_id()))))));

-- rule A: matter_exec_summaries.matter_exec_summaries_team_select
drop policy if exists "matter_exec_summaries_team_select" on public.matter_exec_summaries;
create policy "matter_exec_summaries_team_select" on public.matter_exec_summaries
  for select to authenticated
  using ((firm_id = public.current_firm_id() AND public.current_person_id() IS NOT NULL));

-- rule B: matter_expenses.matter_expenses_finance_all
drop policy if exists "matter_expenses_finance_all" on public.matter_expenses;
create policy "matter_expenses_finance_all" on public.matter_expenses
  for all to authenticated
  using ((firm_id = public.current_firm_id() AND (("current_role"() = ANY (ARRAY['finance'::text, 'admin'::text, 'super_user'::text])))))
  with check ((firm_id = public.current_firm_id() AND (("current_role"() = ANY (ARRAY['finance'::text, 'admin'::text, 'super_user'::text])))));

-- rule A: matter_health.matter_health_team_select
drop policy if exists "matter_health_team_select" on public.matter_health;
create policy "matter_health_team_select" on public.matter_health
  for select to authenticated
  using ((firm_id = public.current_firm_id() AND public.current_person_id() IS NOT NULL));

-- rule C: matter_sol.matter_sol_matter_select
drop policy if exists "matter_sol_matter_select" on public.matter_sol;
create policy "matter_sol_matter_select" on public.matter_sol
  for select to authenticated
  using ((firm_id = public.current_firm_id() AND (has_matter_access(matter_id))));

-- rule C: matter_sol.matter_sol_matter_write
drop policy if exists "matter_sol_matter_write" on public.matter_sol;
create policy "matter_sol_matter_write" on public.matter_sol
  for all to authenticated
  using ((firm_id = public.current_firm_id() AND (has_matter_access(matter_id))))
  with check ((firm_id = public.current_firm_id() AND (has_matter_access(matter_id))));

-- rule E: matter_summaries.matter_summaries_portal_select
drop policy if exists "matter_summaries_portal_select" on public.matter_summaries;
create policy "matter_summaries_portal_select" on public.matter_summaries
  for select to authenticated
  using ((firm_id = public.current_firm_id() AND ((matter_id IN ( SELECT matters.notion_id
   FROM matters
  WHERE (matters.client_id = public.current_client_id()))))));

-- rule E: matters.matters_portal_select
drop policy if exists "matters_portal_select" on public.matters;
create policy "matters_portal_select" on public.matters
  for select to authenticated
  using ((firm_id = public.current_firm_id() AND ((client_id = public.current_client_id()))));

-- rule D: matters.matters_team_select
drop policy if exists "matters_team_select" on public.matters;
create policy "matters_team_select" on public.matters
  for select to authenticated
  using ((firm_id = public.current_firm_id() AND (((current_person_id() = ANY (team_person_ids)) OR ("current_role"() = ANY (ARRAY['partner'::text, 'admin'::text, 'super_user'::text, 'finance'::text, 'chief_liaison_officer'::text, 'liaison_officer'::text]))))));

-- rule D: matters.matters_team_write
drop policy if exists "matters_team_write" on public.matters;
create policy "matters_team_write" on public.matters
  for all to authenticated
  using ((firm_id = public.current_firm_id() AND (((current_person_id() = ANY (team_person_ids)) OR ("current_role"() = ANY (ARRAY['partner'::text, 'admin'::text, 'super_user'::text, 'finance'::text]))))))
  with check ((firm_id = public.current_firm_id() AND (((current_person_id() = ANY (team_person_ids)) OR ("current_role"() = ANY (ARRAY['partner'::text, 'admin'::text, 'super_user'::text, 'finance'::text]))))));

-- rule C: meetings.meetings_matter_select
drop policy if exists "meetings_matter_select" on public.meetings;
create policy "meetings_matter_select" on public.meetings
  for select to authenticated
  using ((firm_id = public.current_firm_id() AND (has_matter_access(matter_id))));

-- rule C: meetings.meetings_matter_write
drop policy if exists "meetings_matter_write" on public.meetings;
create policy "meetings_matter_write" on public.meetings
  for all to authenticated
  using ((firm_id = public.current_firm_id() AND (has_matter_access(matter_id))))
  with check ((firm_id = public.current_firm_id() AND (has_matter_access(matter_id))));

-- rule E: meetings.meetings_portal_select
drop policy if exists "meetings_portal_select" on public.meetings;
create policy "meetings_portal_select" on public.meetings
  for select to authenticated
  using ((firm_id = public.current_firm_id() AND ((matter_id IN ( SELECT matters.notion_id
   FROM matters
  WHERE (matters.client_id = public.current_client_id()))))));

-- rule D: notification_mutes.notification_mutes_own
drop policy if exists "notification_mutes_own" on public.notification_mutes;
create policy "notification_mutes_own" on public.notification_mutes
  for all to authenticated
  using ((firm_id = public.current_firm_id() AND ((person_id = current_person_id()))))
  with check ((firm_id = public.current_firm_id() AND ((person_id = current_person_id()))));

-- rule D: notifications.notifications_own_delete
drop policy if exists "notifications_own_delete" on public.notifications;
create policy "notifications_own_delete" on public.notifications
  for delete to authenticated
  using ((firm_id = public.current_firm_id() AND ((person_id = current_person_id()))));

-- rule D: notifications.notifications_own_select
drop policy if exists "notifications_own_select" on public.notifications;
create policy "notifications_own_select" on public.notifications
  for select to authenticated
  using ((firm_id = public.current_firm_id() AND ((person_id = current_person_id()))));

-- rule D: notifications.notifications_own_update
drop policy if exists "notifications_own_update" on public.notifications;
create policy "notifications_own_update" on public.notifications
  for update to authenticated
  using ((firm_id = public.current_firm_id() AND ((person_id = current_person_id()))))
  with check ((firm_id = public.current_firm_id() AND ((person_id = current_person_id()))));

-- rule C: parties.parties_matter_select
drop policy if exists "parties_matter_select" on public.parties;
create policy "parties_matter_select" on public.parties
  for select to authenticated
  using ((firm_id = public.current_firm_id() AND (has_matter_access(matter_id))));

-- rule C: parties.parties_matter_write
drop policy if exists "parties_matter_write" on public.parties;
create policy "parties_matter_write" on public.parties
  for all to authenticated
  using ((firm_id = public.current_firm_id() AND (has_matter_access(matter_id))))
  with check ((firm_id = public.current_firm_id() AND (has_matter_access(matter_id))));

-- rule C: partner_matter_annotations.partner_matter_annotations_matter_select
drop policy if exists "partner_matter_annotations_matter_select" on public.partner_matter_annotations;
create policy "partner_matter_annotations_matter_select" on public.partner_matter_annotations
  for select to authenticated
  using ((firm_id = public.current_firm_id() AND (has_matter_access(matter_id))));

-- rule C: partner_matter_annotations.partner_matter_annotations_matter_write
drop policy if exists "partner_matter_annotations_matter_write" on public.partner_matter_annotations;
create policy "partner_matter_annotations_matter_write" on public.partner_matter_annotations
  for all to authenticated
  using ((firm_id = public.current_firm_id() AND (has_matter_access(matter_id))))
  with check ((firm_id = public.current_firm_id() AND (has_matter_access(matter_id))));

-- rule G: portal_chat_messages.portal_chat_messages_own_select
drop policy if exists "portal_chat_messages_own_select" on public.portal_chat_messages;
create policy "portal_chat_messages_own_select" on public.portal_chat_messages
  for select to authenticated
  using ((firm_id = public.current_firm_id() AND ((client_user_id IN ( SELECT client_users.id
   FROM client_users
  WHERE ((client_users.auth_user_id = auth.uid()) AND (client_users.active = true)))))));

-- rule D: push_subscriptions.push_subscriptions_own
drop policy if exists "push_subscriptions_own" on public.push_subscriptions;
create policy "push_subscriptions_own" on public.push_subscriptions
  for all to authenticated
  using ((firm_id = public.current_firm_id() AND ((email = current_email()))))
  with check ((firm_id = public.current_firm_id() AND ((email = current_email()))));

-- rule D: reimbursements.reimbursements_delete
drop policy if exists "reimbursements_delete" on public.reimbursements;
create policy "reimbursements_delete" on public.reimbursements
  for delete to authenticated
  using ((firm_id = public.current_firm_id() AND (((lawyer_ids && current_person_identifiers()) OR ("current_role"() = ANY (ARRAY['finance'::text, 'admin'::text, 'super_user'::text]))))));

-- rule D: reimbursements.reimbursements_insert
drop policy if exists "reimbursements_insert" on public.reimbursements;
create policy "reimbursements_insert" on public.reimbursements
  for insert to authenticated
  with check ((firm_id = public.current_firm_id() AND ((lawyer_ids && current_person_identifiers()))));

-- rule D: reimbursements.reimbursements_select
drop policy if exists "reimbursements_select" on public.reimbursements;
create policy "reimbursements_select" on public.reimbursements
  for select to authenticated
  using ((firm_id = public.current_firm_id() AND (((lawyer_ids && current_person_identifiers()) OR ("current_role"() = ANY (ARRAY['finance'::text, 'admin'::text, 'super_user'::text]))))));

-- rule D: reimbursements.reimbursements_update
drop policy if exists "reimbursements_update" on public.reimbursements;
create policy "reimbursements_update" on public.reimbursements
  for update to authenticated
  using ((firm_id = public.current_firm_id() AND (((lawyer_ids && current_person_identifiers()) OR ("current_role"() = ANY (ARRAY['finance'::text, 'admin'::text, 'super_user'::text]))))))
  with check ((firm_id = public.current_firm_id() AND (((lawyer_ids && current_person_identifiers()) OR ("current_role"() = ANY (ARRAY['finance'::text, 'admin'::text, 'super_user'::text]))))));

-- rule B: resolution_templates.resolution_templates_admin_write
drop policy if exists "resolution_templates_admin_write" on public.resolution_templates;
create policy "resolution_templates_admin_write" on public.resolution_templates
  for all to authenticated
  using ((firm_id = public.current_firm_id() AND (("current_role"() = ANY (ARRAY['admin'::text, 'super_user'::text, 'partner'::text])))))
  with check ((firm_id = public.current_firm_id() AND (("current_role"() = ANY (ARRAY['admin'::text, 'super_user'::text, 'partner'::text])))));

-- rule A: resolution_templates.resolution_templates_team_select
drop policy if exists "resolution_templates_team_select" on public.resolution_templates;
create policy "resolution_templates_team_select" on public.resolution_templates
  for select to authenticated
  using ((firm_id = public.current_firm_id() AND public.current_person_id() IS NOT NULL));

-- rule A/D: resolutions.resolutions_team
drop policy if exists "resolutions_team" on public.resolutions;
create policy "resolutions_team" on public.resolutions
  for all to authenticated
  using ((firm_id = public.current_firm_id() AND public.current_person_id() IS NOT NULL))
  with check ((firm_id = public.current_firm_id() AND (((created_by = current_person_id()) OR ("current_role"() = ANY (ARRAY['admin'::text, 'super_user'::text, 'partner'::text]))))));

-- rule D: resources.resources_author_write
drop policy if exists "resources_author_write" on public.resources;
create policy "resources_author_write" on public.resources
  for all to authenticated
  using ((firm_id = public.current_firm_id() AND (((author_id = current_person_id()) OR ("current_role"() = ANY (ARRAY['admin'::text, 'super_user'::text]))))))
  with check ((firm_id = public.current_firm_id() AND (((author_id = current_person_id()) OR ("current_role"() = ANY (ARRAY['admin'::text, 'super_user'::text]))))));

-- rule D: resources.resources_role_select
drop policy if exists "resources_role_select" on public.resources;
create policy "resources_role_select" on public.resources
  for select to authenticated
  using ((firm_id = public.current_firm_id() AND (((current_person_id() IS NOT NULL) AND ((visible_to_roles IS NULL) OR (array_length(visible_to_roles, 1) IS NULL) OR ("current_role"() = ANY (visible_to_roles)) OR ("current_role"() = ANY (ARRAY['admin'::text, 'super_user'::text])))))));

-- rule D: saved_reports.saved_reports_owner_write
drop policy if exists "saved_reports_owner_write" on public.saved_reports;
create policy "saved_reports_owner_write" on public.saved_reports
  for all to authenticated
  using ((firm_id = public.current_firm_id() AND ((owner_id = current_person_id()))))
  with check ((firm_id = public.current_firm_id() AND ((owner_id = current_person_id()))));

-- rule D: saved_reports.saved_reports_select
drop policy if exists "saved_reports_select" on public.saved_reports;
create policy "saved_reports_select" on public.saved_reports
  for select to authenticated
  using ((firm_id = public.current_firm_id() AND (((owner_id = current_person_id()) OR (shared_scope = 'firm'::text)))));

-- rule B: scope_templates.scope_templates_pipeline_write
drop policy if exists "scope_templates_pipeline_write" on public.scope_templates;
create policy "scope_templates_pipeline_write" on public.scope_templates
  for all to authenticated
  using ((firm_id = public.current_firm_id() AND (("current_role"() = ANY (ARRAY['partner'::text, 'admin'::text, 'super_user'::text])))))
  with check ((firm_id = public.current_firm_id() AND (("current_role"() = ANY (ARRAY['partner'::text, 'admin'::text, 'super_user'::text])))));

-- rule A: scope_templates.scope_templates_read
drop policy if exists "scope_templates_read" on public.scope_templates;
create policy "scope_templates_read" on public.scope_templates
  for select to authenticated
  using ((firm_id = public.current_firm_id() AND public.current_person_id() IS NOT NULL));

-- rule C: sla_breaches.sla_breaches_team_select
drop policy if exists "sla_breaches_team_select" on public.sla_breaches;
create policy "sla_breaches_team_select" on public.sla_breaches
  for select to authenticated
  using ((firm_id = public.current_firm_id() AND ((EXISTS ( SELECT 1
   FROM deliverables d
  WHERE ((d.notion_id = sla_breaches.deliverable_id) AND has_matter_access(d.matter_id)))))));

-- rule B: sla_rules.sla_rules_admin_select
drop policy if exists "sla_rules_admin_select" on public.sla_rules;
create policy "sla_rules_admin_select" on public.sla_rules
  for select to authenticated
  using ((firm_id = public.current_firm_id() AND (("current_role"() = ANY (ARRAY['partner'::text, 'admin'::text, 'super_user'::text])))));

-- rule B: sla_rules.sla_rules_admin_write
drop policy if exists "sla_rules_admin_write" on public.sla_rules;
create policy "sla_rules_admin_write" on public.sla_rules
  for all to authenticated
  using ((firm_id = public.current_firm_id() AND (("current_role"() = ANY (ARRAY['admin'::text, 'super_user'::text])))))
  with check ((firm_id = public.current_firm_id() AND (("current_role"() = ANY (ARRAY['admin'::text, 'super_user'::text])))));

-- rule C: tasks.tasks_matter_select
drop policy if exists "tasks_matter_select" on public.tasks;
create policy "tasks_matter_select" on public.tasks
  for select to authenticated
  using ((firm_id = public.current_firm_id() AND (has_matter_access(matter_id))));

-- rule C: tasks.tasks_matter_write
drop policy if exists "tasks_matter_write" on public.tasks;
create policy "tasks_matter_write" on public.tasks
  for all to authenticated
  using ((firm_id = public.current_firm_id() AND (has_matter_access(matter_id))))
  with check ((firm_id = public.current_firm_id() AND (has_matter_access(matter_id))));

-- rule A: team.team_authenticated_select
drop policy if exists "team_authenticated_select" on public.team;
create policy "team_authenticated_select" on public.team
  for select to authenticated
  using ((firm_id = public.current_firm_id() AND public.current_person_id() IS NOT NULL));

-- rule B: team.team_self_update
drop policy if exists "team_self_update" on public.team;
create policy "team_self_update" on public.team
  for update to authenticated
  using ((firm_id = public.current_firm_id() AND (((auth_user_id = auth.uid()) OR ("current_role"() = ANY (ARRAY['admin'::text, 'super_user'::text]))))))
  with check ((firm_id = public.current_firm_id() AND (((auth_user_id = auth.uid()) OR ("current_role"() = ANY (ARRAY['admin'::text, 'super_user'::text]))))));

-- rule A: trademark_client_reports.trademark_client_reports_team
drop policy if exists "trademark_client_reports_team" on public.trademark_client_reports;
create policy "trademark_client_reports_team" on public.trademark_client_reports
  for all to authenticated
  using ((firm_id = public.current_firm_id() AND public.current_person_id() IS NOT NULL))
  with check ((firm_id = public.current_firm_id() AND public.current_person_id() IS NOT NULL));

-- rule A: trademark_files.trademark_files_team
drop policy if exists "trademark_files_team" on public.trademark_files;
create policy "trademark_files_team" on public.trademark_files
  for all to authenticated
  using ((firm_id = public.current_firm_id() AND public.current_person_id() IS NOT NULL))
  with check ((firm_id = public.current_firm_id() AND public.current_person_id() IS NOT NULL));

-- rule A: trademarks.trademarks_team_select
drop policy if exists "trademarks_team_select" on public.trademarks;
create policy "trademarks_team_select" on public.trademarks
  for select to authenticated
  using ((firm_id = public.current_firm_id() AND public.current_person_id() IS NOT NULL));

-- rule B: trademarks.trademarks_team_write
drop policy if exists "trademarks_team_write" on public.trademarks;
create policy "trademarks_team_write" on public.trademarks
  for all to authenticated
  using ((firm_id = public.current_firm_id() AND (("current_role"() = ANY (ARRAY['admin'::text, 'super_user'::text, 'partner'::text, 'lawyer'::text])))))
  with check ((firm_id = public.current_firm_id() AND (("current_role"() = ANY (ARRAY['admin'::text, 'super_user'::text, 'partner'::text, 'lawyer'::text])))));

-- rule B: transportation_zones.transportation_zones_admin_write
drop policy if exists "transportation_zones_admin_write" on public.transportation_zones;
create policy "transportation_zones_admin_write" on public.transportation_zones
  for all to authenticated
  using ((firm_id = public.current_firm_id() AND (("current_role"() = ANY (ARRAY['admin'::text, 'super_user'::text, 'finance'::text])))))
  with check ((firm_id = public.current_firm_id() AND (("current_role"() = ANY (ARRAY['admin'::text, 'super_user'::text, 'finance'::text])))));

-- rule A: transportation_zones.transportation_zones_authenticated_select
drop policy if exists "transportation_zones_authenticated_select" on public.transportation_zones;
create policy "transportation_zones_authenticated_select" on public.transportation_zones
  for select to authenticated
  using ((firm_id = public.current_firm_id() AND public.current_person_id() IS NOT NULL));

-- rule D: user_preferences.user_preferences_own
drop policy if exists "user_preferences_own" on public.user_preferences;
create policy "user_preferences_own" on public.user_preferences
  for all to authenticated
  using ((firm_id = public.current_firm_id() AND ((email = current_email()))))
  with check ((firm_id = public.current_firm_id() AND ((email = current_email()))));
