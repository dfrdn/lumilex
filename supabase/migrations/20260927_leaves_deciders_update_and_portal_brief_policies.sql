-- Two RLS holes a signed-in user could reach straight through PostgREST.
--
-- 1. leaves: self-approval.
--    leaves_own_update let the applicant UPDATE every column of their own row,
--    so anyone could PATCH /rest/v1/leaves with status = 'Approved',
--    approved = true under their own session. Nothing in the app updates a leave
--    as its applicant — the only writer is the approval route
--    (app/api/partner/leaves PATCH), which runs as a partner or super_user.
--    Updates are now limited to the roles that decide leave. If applicants ever
--    get to cancel or revise their own leave, that goes through a route that
--    fixes which columns change, not a wider policy.
--
-- 2. matter_summaries / matter_exec_summaries: portal read of internal briefs.
--    Both tables are written for the firm's lawyers — the brief from tasks,
--    pending drafts and document analyses, the executive summary for onboarding
--    and partner recall — and both carried a *_portal_select policy letting a
--    client read their matters' rows directly. The portal no longer shows or
--    feeds either one to its chat, so the client read is removed at the source.
--    Staff access is unchanged: matter_exec_summaries_team_select stays, and
--    matter_summaries has never had a staff policy (staff read it through the
--    firm-scoped service client).

drop policy if exists "leaves_own_update" on public.leaves;
drop policy if exists "leaves_decider_update" on public.leaves;
create policy "leaves_decider_update" on public.leaves
  for update to authenticated
  using (
    firm_id = public.current_firm_id()
    and public."current_role"() = any (array['partner', 'admin', 'super_user'])
  )
  with check (
    firm_id = public.current_firm_id()
    and public."current_role"() = any (array['partner', 'admin', 'super_user'])
  );

drop policy if exists "matter_summaries_portal_select" on public.matter_summaries;
drop policy if exists "matter_exec_summaries_portal_select" on public.matter_exec_summaries;
