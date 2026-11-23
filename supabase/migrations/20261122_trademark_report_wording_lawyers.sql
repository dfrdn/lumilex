-- Lawyers send the trademark client reports, so they may edit the standard
-- wording too (every change is kept in content_revisions). The policy keeps
-- its original name and its firm conjunct; ALTER is idempotent.
ALTER POLICY trademark_report_wording_partner_write ON public.trademark_report_wording
  USING (firm_id = (SELECT public.current_firm_id()) AND (SELECT public."current_role"()) = ANY (ARRAY['lawyer', 'partner', 'admin', 'super_user']))
  WITH CHECK (firm_id = (SELECT public.current_firm_id()) AND (SELECT public."current_role"()) = ANY (ARRAY['lawyer', 'partner', 'admin', 'super_user']));
