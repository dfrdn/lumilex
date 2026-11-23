-- Client reports for companies.
--
-- corporation_client_reports logs each report sent to a client about one of
-- its companies (lib/corporations/client-report.ts): a registration on the
-- company's own record, or an item on it — a compliance filing (a
-- deliverable), a meeting, a resolution — named by `item_id`. Written only by
-- the send route on the firm-scoped service client; the firm's staff read it.

CREATE TABLE IF NOT EXISTS public.corporation_client_reports (
  id bigserial PRIMARY KEY,
  firm_id uuid NOT NULL REFERENCES public.firms(id) ON DELETE CASCADE,
  corporation_id text NOT NULL REFERENCES public.corporations(id) ON DELETE CASCADE,
  event text NOT NULL CHECK (event IN (
    'sec_registration', 'bir_registration', 'bir_books', 'bir_atp', 'business_permit',
    'sss', 'philhealth', 'pagibig', 'compliance', 'meeting', 'resolution'
  )),
  item_id text,
  event_date date NOT NULL,
  sent_by text,
  sent_at timestamptz NOT NULL DEFAULT now(),
  recipient_email text NOT NULL,
  cc_emails text[] NOT NULL DEFAULT '{}',
  subject text NOT NULL,
  body_html text NOT NULL,
  attachment_paths text[] NOT NULL DEFAULT '{}',
  CHECK ((event IN ('compliance', 'meeting', 'resolution')) = (item_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS corporation_client_reports_corp_idx
  ON public.corporation_client_reports (corporation_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS corporation_client_reports_firm_idx
  ON public.corporation_client_reports (firm_id);

ALTER TABLE public.corporation_client_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS corporation_client_reports_staff_select ON public.corporation_client_reports;
CREATE POLICY corporation_client_reports_staff_select ON public.corporation_client_reports
  FOR SELECT TO authenticated
  USING (firm_id = (SELECT public.current_firm_id()) AND (SELECT public.current_person_id()) IS NOT NULL);

REVOKE ALL ON public.corporation_client_reports FROM anon, authenticated;
GRANT SELECT ON public.corporation_client_reports TO authenticated;
GRANT ALL ON public.corporation_client_reports TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.corporation_client_reports_id_seq TO service_role;
