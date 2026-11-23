-- Billing letters: one profile per client, and wording finance can edit.
--
-- client_billing_profiles — the letter and its recipient, VAT and the
--   early-payment discount, per client. A client's monthly invoice covers all
--   its matters, so these were read from whichever matter config sorted first;
--   fee terms stay on matter_billing_configs.
-- billing_letter_blocks — the letter's and the email's fixed lines (the
--   subject, the transmittal line, the closing lines, the phrases the bill is
--   built from). A row replaces the built-in default in
--   lib/billing/letter-blocks.ts; a firm with no rows uses the defaults.
--   History goes to content_revisions ('billing_letter_block').
--
-- Both are tenant tables: firm_id, and RLS with the firm conjunct.
--
-- Backfill: each client's profile takes, per setting, the first non-blank
-- value among its matter configs in matter_id order — the order invoices
-- already read them in. Only clients without a profile are filled, so this can
-- be re-run to pick up configs edited in between. Matter configs are read, not
-- changed.

CREATE TABLE IF NOT EXISTS public.client_billing_profiles (
  client_id text PRIMARY KEY REFERENCES public.clients(notion_id) ON DELETE CASCADE,
  firm_id uuid NOT NULL REFERENCES public.firms(id) ON DELETE CASCADE,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text
);
CREATE INDEX IF NOT EXISTS client_billing_profiles_firm_idx ON public.client_billing_profiles (firm_id);
ALTER TABLE public.client_billing_profiles ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.billing_letter_blocks (
  firm_id uuid NOT NULL REFERENCES public.firms(id) ON DELETE CASCADE,
  key text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('standard', 'optional')),
  label text,
  body text NOT NULL,
  position text CHECK (position IS NULL OR position IN ('after_bill', 'before_closing')),
  sort_order integer NOT NULL DEFAULT 0,
  archived boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text,
  PRIMARY KEY (firm_id, key)
);
ALTER TABLE public.billing_letter_blocks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS client_billing_profiles_finance_all ON public.client_billing_profiles;
CREATE POLICY client_billing_profiles_finance_all ON public.client_billing_profiles FOR ALL TO authenticated
  USING (firm_id = (SELECT public.current_firm_id()) AND (SELECT public."current_role"()) = ANY (ARRAY['finance', 'admin', 'super_user', 'partner']))
  WITH CHECK (firm_id = (SELECT public.current_firm_id()) AND (SELECT public."current_role"()) = ANY (ARRAY['finance', 'admin', 'super_user', 'partner']));

DROP POLICY IF EXISTS billing_letter_blocks_billing_select ON public.billing_letter_blocks;
CREATE POLICY billing_letter_blocks_billing_select ON public.billing_letter_blocks FOR SELECT TO authenticated
  USING (firm_id = (SELECT public.current_firm_id()) AND (SELECT public."current_role"()) = ANY (ARRAY['finance', 'admin', 'super_user', 'partner']));

DROP POLICY IF EXISTS billing_letter_blocks_finance_write ON public.billing_letter_blocks;
CREATE POLICY billing_letter_blocks_finance_write ON public.billing_letter_blocks FOR ALL TO authenticated
  USING (firm_id = (SELECT public.current_firm_id()) AND (SELECT public."current_role"()) = ANY (ARRAY['finance', 'admin', 'super_user']))
  WITH CHECK (firm_id = (SELECT public.current_firm_id()) AND (SELECT public."current_role"()) = ANY (ARRAY['finance', 'admin', 'super_user']));

REVOKE ALL ON public.client_billing_profiles FROM anon;
REVOKE ALL ON public.billing_letter_blocks FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_billing_profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.billing_letter_blocks TO authenticated;
GRANT ALL ON public.client_billing_profiles TO service_role;
GRANT ALL ON public.billing_letter_blocks TO service_role;

WITH keys(k) AS (
  VALUES ('letterAddressee'), ('clientAddress'), ('attnName'), ('attnTitle'), ('throughName'), ('salutation'),
         ('clientEmail'), ('ccEmails'), ('includeVAT'), ('includeLessenFeesNote'),
         ('earlyPaymentDiscountPercent'), ('earlyPaymentDays')
),
firsts AS (
  SELECT DISTINCT ON (m.client_id, keys.k) m.client_id, keys.k, trim(c.billing_settings->>keys.k) AS v
  FROM public.matter_billing_configs c
  JOIN public.matters m ON m.notion_id = c.matter_id
  CROSS JOIN keys
  WHERE m.client_id IS NOT NULL
    AND coalesce(trim(c.billing_settings->>keys.k), '') <> ''
  ORDER BY m.client_id, keys.k, c.matter_id
),
flat AS (
  SELECT client_id, jsonb_object_agg(k, v) AS s FROM firsts GROUP BY client_id
)
INSERT INTO public.client_billing_profiles (client_id, firm_id, settings)
SELECT f.client_id, cl.firm_id,
  jsonb_strip_nulls(jsonb_build_object(
    'letterAddressee', f.s->>'letterAddressee',
    'clientAddress', f.s->>'clientAddress',
    'attnName', f.s->>'attnName',
    'attnTitle', f.s->>'attnTitle',
    'throughName', f.s->>'throughName',
    'salutation', f.s->>'salutation',
    'clientEmail', f.s->>'clientEmail',
    'ccEmails', f.s->>'ccEmails',
    'includeVAT', CASE f.s->>'includeVAT' WHEN 'true' THEN true WHEN 'false' THEN false END,
    'includeLessenFeesNote', CASE f.s->>'includeLessenFeesNote' WHEN 'true' THEN true WHEN 'false' THEN false END,
    'earlyPaymentDiscountPercent', f.s->>'earlyPaymentDiscountPercent',
    'earlyPaymentDays', f.s->>'earlyPaymentDays'
  ))
FROM flat f
JOIN public.clients cl ON cl.notion_id = f.client_id
ON CONFLICT (client_id) DO NOTHING;
