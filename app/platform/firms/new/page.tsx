import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { FONT_SETS, DEFAULT_FONT_SET } from '@/lib/pdf/fonts';
import { FEATURE_KEYS } from '@/lib/firm/feature-shape';
import NewFirmForm from '@/components/platform/NewFirmForm';

export const metadata: Metadata = { title: 'New firm' };

/**
 * The provisioning form.
 *
 * The font set list is resolved here rather than in the client component:
 * `lib/pdf/fonts.ts` reads font files off disk and pulls in pdfkit, so it is
 * server-only. The browser needs the names and the labels, nothing else.
 */
export default function NewFirmPage() {
  const fontSets = Object.values(FONT_SETS).map((set) => ({ name: set.name, label: set.label }));

  return (
    <>
      <Link
        href="/platform"
        className="inline-flex items-center gap-1.5 text-xs text-[var(--text-secondary)] hover:text-foreground mb-4"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Firms
      </Link>

      <div className="mb-6">
        <h1 className="font-serif text-2xl text-foreground tracking-tight">Provision a firm</h1>
        <p className="text-sm text-[var(--text-secondary)] mt-1 max-w-3xl leading-relaxed">
          This runs the same path as{' '}
          <code className="font-mono text-xs">scripts/provision-firm.ts</code>: the slug and
          invoice prefix are checked against the database&apos;s own constraints, a hostname
          another firm has claimed is refused, and the firm is created with a deliberately
          incomplete invoice row, every integration disabled, and the neutral seed pack. Re-running
          with the same slug fills what is absent and overwrites nothing.
        </p>
      </div>

      <NewFirmForm fontSets={fontSets} featureKeys={[...FEATURE_KEYS]} defaultFontSet={DEFAULT_FONT_SET} />
    </>
  );
}
