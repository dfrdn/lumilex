import type { Metadata } from 'next';
import Link from 'next/link';
import IntakeFormClient from './IntakeFormClient';
import { BrandMonogram } from '@/components/BrandMark';
import { brandDisplayName, resolveRequestBrand } from '@/lib/firm/web-brand';

export async function generateMetadata(): Promise<Metadata> {
  const firmName = brandDisplayName(await resolveRequestBrand());
  return {
    title: 'Engage Us',
    description: firmName
      ? `Tell ${firmName} about your legal concern — general engagements, trademark registrations, and incorporations.`
      : 'Tell us about your legal concern — general engagements, trademark registrations, and incorporations.',
  };
}

// Public page — excluded from auth middleware in proxy.ts. The firm comes from
// the request Host; an unmapped host renders neutral chrome and names no firm.
export default async function PublicIntakePage() {
  const brand = await resolveRequestBrand();
  const firmName = brandDisplayName(brand);
  return (
    <>
      <header className="sticky top-0 z-10 border-b border-gold-200/40 dark:border-gold-400/15 bg-background/85 backdrop-blur">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <BrandMonogram className="w-10 h-10 rounded-lg ring-1 ring-gold-200/40 dark:ring-gold-400/20" />
            <div className="leading-tight">
              <p className="font-serif text-base text-foreground tracking-tight">
                {firmName || brand.shortName}
              </p>
              {brand.tagline && (
                <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-gold-700 dark:text-gold-400 mt-0.5">
                  {brand.tagline}
                </p>
              )}
            </div>
          </div>
          <Link
            href="/portal/login"
            className="text-xs text-[var(--text-secondary)] hover:text-foreground transition-colors px-3 py-2 rounded-lg hover:bg-subtle"
          >
            Existing client? Sign in
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-12">
        <section className="mb-10 pb-8 border-b border-gold-200/40 dark:border-gold-400/15">
          <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-gold-700 dark:text-gold-400">
            New engagement inquiry
          </p>
          <h1 className="font-serif text-3xl md:text-4xl text-foreground tracking-tight mt-3">
            How can we help?
          </h1>
          <p className="text-sm text-[var(--text-secondary)] mt-2 max-w-xl">
            Tell us about your concern and our team will get back to you. Submitting this form does
            not create an attorney-client relationship — please do not include confidential details
            at this stage.
          </p>
        </section>

        <IntakeFormClient />
      </main>

      <footer className="border-t border-gold-200/40 dark:border-gold-400/15 py-8">
        <p className="text-center text-[11px] text-[var(--text-muted)]">
          {[firmName, brand.tagline].filter(Boolean).join(' · ')}
        </p>
      </footer>
    </>
  );
}
