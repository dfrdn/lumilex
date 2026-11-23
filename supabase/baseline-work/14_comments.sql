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
