-- Seed neutral placeholder branding for the dev firm.
--
-- The document renderers (lib/pdf/brand.ts, lib/docx/brand.ts) are fail-loud:
-- an unset palette, nameLines or documentName throws rather than resolving to
-- another firm's identity. The dev firm therefore needs its own values or every
-- PDF/DOCX export in development 500s.
--
-- Deliberately generic: slate + brass, "Lumilex Dev Firm", and no logo or
-- monogram configured at all, so the dev renders exercise the no-mark path that
-- a freshly onboarded tenant sees. Idempotent — only fills keys that are absent,
-- so a developer's own experiments are never overwritten.

UPDATE public.firms
SET branding = jsonb_build_object(
      'nameLines',         to_jsonb(ARRAY['Lumilex', 'Dev Firm']),
      'documentName',      'Lumilex Dev Firm',
      'tagline',           'Development Tenant',
      'logoPath',          '',
      'monogramPath',      '',
      'monogramLightPath', '',
      'palette',           jsonb_build_object('primary', '#26333f', 'accent', '#8a7c53'),
      'fontSet',           'standard'
    ) || COALESCE(branding, '{}'::jsonb)
WHERE slug = 'dev'
  AND COALESCE(branding, '{}'::jsonb) -> 'palette' IS NULL;
