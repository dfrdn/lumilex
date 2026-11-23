-- Partners can read the firm's billing data.
--
-- /api/finance/{dtr-review, matter-billing, matter-expenses, billing-configs,
-- clients/deposits, ledger, receivables, firm-summary} all admit partners and
-- read through the signed-in client, but every policy on the tables behind
-- them is finance / admin / super_user only. On a partner's JWT each read
-- returned 0 rows without erroring, so a partner's Billing Review showed zero
-- fees, no retainer cap, and a previous balance missing every invoice.
--
-- Partners get SELECT on the invoice and collection tables, and full access on
-- the matter-billing tables their routes already let them edit
-- (matter-billing POST/DELETE, actions PUT, milestones PUT/PATCH,
-- matter-expenses POST/PATCH/DELETE). Invoices, payments, deposits, the rate
-- card and staff reimbursements stay finance-written.
--
-- Every policy carries the firm conjunct: a role alone is firm-blind, and the
-- The origin app's version this ports (20260910_partner_billing_rls) had none.
-- Idempotent: each policy is dropped before it is created.

drop policy if exists invoices_partner_select on public.invoices;
create policy invoices_partner_select on public.invoices
  for select to authenticated
  using (firm_id = public.current_firm_id() and public."current_role"() = 'partner');

drop policy if exists invoice_payments_partner_select on public.invoice_payments;
create policy invoice_payments_partner_select on public.invoice_payments
  for select to authenticated
  using (firm_id = public.current_firm_id() and public."current_role"() = 'partner');

drop policy if exists client_deposits_partner_select on public.client_deposits;
create policy client_deposits_partner_select on public.client_deposits
  for select to authenticated
  using (firm_id = public.current_firm_id() and public."current_role"() = 'partner');

drop policy if exists billing_rates_partner_select on public.billing_rates;
create policy billing_rates_partner_select on public.billing_rates
  for select to authenticated
  using (firm_id = public.current_firm_id() and public."current_role"() = 'partner');

drop policy if exists reimbursements_partner_select on public.reimbursements;
create policy reimbursements_partner_select on public.reimbursements
  for select to authenticated
  using (firm_id = public.current_firm_id() and public."current_role"() = 'partner');

drop policy if exists matter_billing_configs_partner_all on public.matter_billing_configs;
create policy matter_billing_configs_partner_all on public.matter_billing_configs
  for all to authenticated
  using (firm_id = public.current_firm_id() and public."current_role"() = 'partner')
  with check (firm_id = public.current_firm_id() and public."current_role"() = 'partner');

drop policy if exists matter_billing_actions_partner_all on public.matter_billing_actions;
create policy matter_billing_actions_partner_all on public.matter_billing_actions
  for all to authenticated
  using (firm_id = public.current_firm_id() and public."current_role"() = 'partner')
  with check (firm_id = public.current_firm_id() and public."current_role"() = 'partner');

drop policy if exists matter_billing_milestones_partner_all on public.matter_billing_milestones;
create policy matter_billing_milestones_partner_all on public.matter_billing_milestones
  for all to authenticated
  using (firm_id = public.current_firm_id() and public."current_role"() = 'partner')
  with check (firm_id = public.current_firm_id() and public."current_role"() = 'partner');

drop policy if exists matter_expenses_partner_all on public.matter_expenses;
create policy matter_expenses_partner_all on public.matter_expenses
  for all to authenticated
  using (firm_id = public.current_firm_id() and public."current_role"() = 'partner')
  with check (firm_id = public.current_firm_id() and public."current_role"() = 'partner');
