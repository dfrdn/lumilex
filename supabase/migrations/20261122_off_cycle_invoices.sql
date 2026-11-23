-- Off-cycle invoices: a fee-only bill (acceptance fee, a reached milestone,
-- ad-hoc items) issued between monthly runs. It sits beside the client's
-- monthly invoice for the same billing_month, takes its number from the same
-- per-month sequence, and needs only the managing partner's approval — there
-- is no time to review, so no relationship-partner clearance.
--
-- Partners read requests; finance files and cancels them. The managing
-- partner's decision is written by the decision route on the firm-scoped
-- service client after its identity check, so a partner's JWT can't approve,
-- file or cancel a request through PostgREST.

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS invoice_kind text NOT NULL DEFAULT 'monthly';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoices_invoice_kind_check') THEN
    ALTER TABLE public.invoices
      ADD CONSTRAINT invoices_invoice_kind_check CHECK (invoice_kind IN ('monthly', 'off_cycle'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_invoices_client_kind ON public.invoices (firm_id, client_name, invoice_kind);

CREATE TABLE IF NOT EXISTS public.off_cycle_invoice_requests (
  id bigserial PRIMARY KEY,
  firm_id uuid NOT NULL REFERENCES public.firms(id) ON DELETE CASCADE,
  client_name text NOT NULL,
  billing_month text NOT NULL CHECK (billing_month ~ '^\d{4}-\d{2}$'),
  -- What the letter says the bill is for ("our billing statement for …").
  period_label text NOT NULL,
  -- The exact fee lines the managing partner approves (FeeLinePayload[]).
  fee_lines jsonb NOT NULL,
  notes text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  requested_by text NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_by text,
  decided_at timestamptz,
  decision_notes text NOT NULL DEFAULT '',
  invoice_gen_status text CHECK (invoice_gen_status IN ('pending', 'success', 'failed')),
  invoice_gen_error text,
  invoice_id integer REFERENCES public.invoices(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_off_cycle_requests_status ON public.off_cycle_invoice_requests (firm_id, status, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_off_cycle_requests_client ON public.off_cycle_invoice_requests (firm_id, client_name);

ALTER TABLE public.off_cycle_invoice_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS off_cycle_invoice_requests_select ON public.off_cycle_invoice_requests;
CREATE POLICY off_cycle_invoice_requests_select ON public.off_cycle_invoice_requests
  FOR SELECT TO authenticated
  USING (
    firm_id = (SELECT public.current_firm_id())
    AND (SELECT public."current_role"()) = ANY (ARRAY['finance', 'admin', 'super_user', 'partner'])
  );

DROP POLICY IF EXISTS off_cycle_invoice_requests_finance_write ON public.off_cycle_invoice_requests;
CREATE POLICY off_cycle_invoice_requests_finance_write ON public.off_cycle_invoice_requests
  FOR ALL TO authenticated
  USING (
    firm_id = (SELECT public.current_firm_id())
    AND (SELECT public."current_role"()) = ANY (ARRAY['finance', 'admin', 'super_user'])
  )
  WITH CHECK (
    firm_id = (SELECT public.current_firm_id())
    AND (SELECT public."current_role"()) = ANY (ARRAY['finance', 'admin', 'super_user'])
  );

REVOKE ALL ON public.off_cycle_invoice_requests FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.off_cycle_invoice_requests TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.off_cycle_invoice_requests_id_seq TO authenticated;
GRANT ALL ON public.off_cycle_invoice_requests TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.off_cycle_invoice_requests_id_seq TO service_role;
