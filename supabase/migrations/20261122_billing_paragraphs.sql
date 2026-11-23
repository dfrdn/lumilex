-- The billing letter and the billing email as ordered lists of paragraphs that
-- finance adds, renames, rewords, reorders and deletes (lib/billing/paragraphs.ts).
-- Each paragraph carries a rule for when it shows, over facts about the
-- invoice, and optionally a client choice it waits for.
--
-- Nothing is seeded. A firm's letter and email are the defaults in code until
-- finance first changes one, when the app writes that document's defaults out
-- as the firm's own rows (ensureParagraphs in lib/billing/wording-store.ts).

-- Revisions of billing wording go in content_revisions with the firm's other
-- hand-written content; its entity_type check is widened to admit them.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'content_revisions_entity_type_check'
      AND pg_get_constraintdef(oid) LIKE '%billing_paragraph%'
  ) THEN
    EXECUTE 'ALTER TABLE public.content_revisions DROP CONSTRAINT IF EXISTS content_revisions_entity_type_check';
    EXECUTE 'ALTER TABLE public.content_revisions ADD CONSTRAINT content_revisions_entity_type_check CHECK (entity_type = ANY (ARRAY[''kb_page''::text, ''fee_schedule''::text, ''billing_letter_block''::text, ''billing_paragraph''::text]))';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.billing_paragraphs (
  firm_id uuid NOT NULL REFERENCES public.firms(id) ON DELETE CASCADE,
  document text NOT NULL CHECK (document IN ('letter', 'email')),
  key text NOT NULL,
  label text NOT NULL,
  body text NOT NULL DEFAULT '',
  rule jsonb NOT NULL DEFAULT '[]'::jsonb,
  choice text,
  system text CHECK (system IS NULL OR system IN ('deposit')),
  sort_order integer NOT NULL DEFAULT 0,
  archived boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text,
  PRIMARY KEY (firm_id, document, key)
);
ALTER TABLE public.billing_paragraphs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS billing_paragraphs_billing_select ON public.billing_paragraphs;
CREATE POLICY billing_paragraphs_billing_select ON public.billing_paragraphs FOR SELECT TO authenticated
  USING (firm_id = (SELECT public.current_firm_id()) AND (SELECT public."current_role"()) = ANY (ARRAY['finance', 'admin', 'super_user', 'partner']));

DROP POLICY IF EXISTS billing_paragraphs_finance_write ON public.billing_paragraphs;
CREATE POLICY billing_paragraphs_finance_write ON public.billing_paragraphs FOR ALL TO authenticated
  USING (firm_id = (SELECT public.current_firm_id()) AND (SELECT public."current_role"()) = ANY (ARRAY['finance', 'admin', 'super_user']))
  WITH CHECK (firm_id = (SELECT public.current_firm_id()) AND (SELECT public."current_role"()) = ANY (ARRAY['finance', 'admin', 'super_user']));

REVOKE ALL ON public.billing_paragraphs FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.billing_paragraphs TO authenticated;
GRANT ALL ON public.billing_paragraphs TO service_role;
