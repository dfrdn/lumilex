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
