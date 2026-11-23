-- Whether the billing letter writes "Atty." before the signatory's printed
-- name. Firm-wide, beside the fallback signer; the Managing Partner signs.
ALTER TABLE public.firm_invoice_settings
  ADD COLUMN IF NOT EXISTS signer_atty boolean NOT NULL DEFAULT false;
