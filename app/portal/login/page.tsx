import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getPortalSession } from '@/lib/session';
import PortalLoginForm from './PortalLoginForm';
import { BrandMonogram } from '@/components/BrandMark';
import { brandDisplayName, resolveRequestBrand } from '@/lib/firm/web-brand';
import SourceLink from '@/components/SourceLink';

export const metadata: Metadata = { title: 'Client Portal Sign In' };

export default async function PortalLoginPage() {
  const session = await getPortalSession();
  if (session) redirect('/portal');

  // Pre-auth: resolved from the request Host; an unmapped host names no firm.
  const brand = await resolveRequestBrand();
  const firmName = brandDisplayName(brand);

  return (
    <main className="min-h-screen flex items-center justify-center bg-background relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-gold-400/5 rounded-full blur-3xl" />
        <div className="absolute bottom-0 right-1/4 w-80 h-80 bg-navy-500/5 rounded-full blur-3xl" />
      </div>

      <div className="relative z-10 bg-card rounded-2xl shadow-[var(--shadow-elevated)] border border-[var(--border-color)] p-10 sm:p-12 flex flex-col items-center gap-6 w-full max-w-sm animate-fade-up">
        <div className="flex flex-col items-center gap-3">
          <BrandMonogram />
          <div className="flex flex-col items-center gap-1">
            <span className="font-serif text-3xl font-bold tracking-tight text-foreground">{brand.shortName}</span>
            <span className="text-sm text-[var(--text-secondary)] text-center leading-tight">
              Client Portal
            </span>
          </div>
        </div>

        <div className="w-16 h-px bg-gradient-to-r from-transparent via-[var(--border-color)] to-transparent" />

        <div className="text-center">
          <h1 className="text-lg font-semibold text-foreground">Sign in</h1>
          <p className="text-sm text-[var(--text-secondary)] mt-1">We&apos;ll email you a link.</p>
        </div>

        <PortalLoginForm />

        <p className="text-xs text-[var(--text-muted)] text-center">
          {firmName
            ? `Access is restricted to invited clients of ${firmName}.`
            : 'Access is restricted to invited clients.'}
        </p>
        <SourceLink className="text-[11px] text-[var(--text-muted)] hover:text-foreground transition-colors" />
      </div>
    </main>
  );
}
