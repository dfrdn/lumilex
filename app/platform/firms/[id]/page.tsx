import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { getOperatorSession } from '@/lib/platform/auth';
import { findFirmForOperator, listFirmDomains } from '@/lib/platform/firms';
import { readInvoiceSettings, readFeatureRows } from '@/lib/platform/firm-detail';
import { FONT_SETS } from '@/lib/pdf/fonts';
import { logOperatorAudit } from '@/lib/audit';
import FirmDetailClient from '@/components/platform/FirmDetailClient';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const firm = await findFirmForOperator(id);
  return { title: firm?.name ?? 'Firm' };
}

/**
 * One tenant's configuration, as the operator edits it.
 *
 * Every read below is either a global table (`firms`, `firm_domains`, through
 * lib/platform/firms.ts) or firm-scoped through `getServiceDbForFirm` — the
 * page names the tenant it is looking at, exactly like the list does.
 */
export default async function PlatformFirmPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const operator = await getOperatorSession();
  if (!operator) return null;

  const { id } = await params;
  const firm = await findFirmForOperator(id);
  if (!firm) notFound();

  const [domains, invoice, features] = await Promise.all([
    listFirmDomains(firm.id),
    readInvoiceSettings(firm.id),
    readFeatureRows(firm.id, firm.features),
  ]);

  // Same rule as the list: an operator reading into a tenant is the thing that
  // tenant would want to see in its own audit log.
  logOperatorAudit({
    firmId: firm.id,
    entityType: 'Firm',
    entityId: firm.id,
    entityName: firm.name,
    action: 'viewed',
    operator,
  });

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

      <FirmDetailClient
        firm={firm}
        domains={domains}
        invoice={invoice}
        features={features}
        fontSets={fontSets}
      />
    </>
  );
}
