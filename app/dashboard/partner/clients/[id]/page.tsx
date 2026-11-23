import { notFound } from 'next/navigation';
import { requireRouteAccess } from '@/lib/nav/guard';
import Link from 'next/link';
import { Building2 } from 'lucide-react';
import DetailShell from '@/components/detail/DetailShell';
import { getClientById, getClientMattersWithCounts } from '@/lib/queries/detail';
import { getClientFinancialDetail } from '@/lib/queries/client-management';
import { getClientNotes } from '@/lib/queries/client-notes';
import { getPartnerPickerData } from '@/lib/queries/people';
import { fmt, signed } from '@/lib/finance/format';
import { deriveClientLifecycle, isActiveMatterStatus, LIFECYCLE_BADGE } from '@/lib/clients/lifecycle';
import DetailPriorityToggle from './DetailPriorityToggle';
import RelationshipPartnerField from './RelationshipPartnerField';
import ClientNotesPanel from './ClientNotesPanel';
import { entityTitle } from '@/lib/page-metadata';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return { title: await entityTitle({ table: 'clients', idColumn: 'notion_id', id, nameColumn: 'name', fallback: 'Client' }) };
}

function StatCard({ label, value, hint, tone = 'default' }: { label: string; value: string; hint?: string; tone?: 'default' | 'positive' | 'negative' | 'warn' }) {
  const valueTone =
    tone === 'positive' ? 'text-emerald-600 dark:text-emerald-400'
      : tone === 'negative' ? 'text-red-600 dark:text-red-400'
        : tone === 'warn' ? 'text-amber-600 dark:text-amber-400'
          : 'text-[var(--text-primary)]';
  return (
    <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-[var(--shadow-card)] px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">{label}</p>
      <p className={`mt-1 text-lg font-bold tabular-nums ${valueTone}`}>{value}</p>
      {hint && <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{hint}</p>}
    </div>
  );
}

export default async function PartnerClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireRouteAccess(`/dashboard/partner/clients/${id}`);
  const client = await getClientById(id, session.firmId);
  if (!client) notFound();

  const [financial, matters, notes, partnerData] = await Promise.all([
    getClientFinancialDetail(session.firmId, client.id, client.receivables),
    getClientMattersWithCounts(id, session.firmId),
    getClientNotes(session.firmId, id),
    getPartnerPickerData(session.firmId),
  ]);

  const receivables = financial.outstandingReceivables ?? 0;
  const lifecycle = deriveClientLifecycle(
    matters.length,
    matters.filter((m) => isActiveMatterStatus(m.status)).length,
  );

  return (
    <DetailShell
      title={client.clientCode ? `${client.name} (${client.clientCode})` : client.name}
      icon={<Building2 className="w-5 h-5" />}
      entityType="Client"
      breadcrumbs={[{ label: 'Client Management', href: '/dashboard/partner/clients' }]}
    >
      <div className="flex flex-wrap items-center gap-2.5 mb-6">
        <span className={`inline-flex items-center px-3 py-1.5 text-xs font-semibold rounded-full ring-1 ring-inset ${LIFECYCLE_BADGE[lifecycle]}`}>
          {lifecycle}
        </span>
        <DetailPriorityToggle clientId={client.id} initialPriority={client.priority} />
        <RelationshipPartnerField clientId={client.id} initialRelationshipPartnerId={client.relationshipPartnerId} options={partnerData.options} nameById={partnerData.nameById} />
        <Link
          href={`/dashboard/clients/${client.id}`}
          className="sm:ml-auto text-xs font-medium text-[var(--text-secondary)] hover:text-gold-600 dark:hover:text-gold-400 border border-[var(--border-color)] rounded-lg px-3 py-1.5 transition-colors"
        >
          Full client profile →
        </Link>
      </div>

      {/* ── Financial summary ─────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <StatCard label="Collected (12mo)" value={fmt(financial.collected12mo)} hint={`${fmt(financial.collectedLifetime)} all-time`} />
        {financial.hasProfitData ? (
          <>
            <StatCard label="Profit" value={signed(financial.profit)} tone={financial.profit >= 0 ? 'positive' : 'negative'} hint={`${financial.margin.toFixed(0)}% margin`} />
            <StatCard label="Billed" value={fmt(financial.billed)} hint={financial.collectionRate != null ? `${financial.collectionRate.toFixed(0)}% collected` : undefined} />
          </>
        ) : (
          <>
            <StatCard label="Profit" value="—" hint="Not yet billed" />
            <StatCard label="Billed" value={fmt(financial.billed)} />
          </>
        )}
        <StatCard
          label={receivables < 0 ? 'Credit on hand' : 'Outstanding A/R'}
          value={fmt(receivables)}
          tone={financial.overdueAmount > 0 ? 'warn' : 'default'}
          hint={financial.overdueAmount > 0 ? `${fmt(financial.overdueAmount)} overdue` : undefined}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        <div className="lg:col-span-2 space-y-6">
          {/* ── Per-matter profitability ─────────────────── */}
          {financial.matters.length > 0 && (
            <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-[var(--shadow-card)] overflow-hidden">
              <div className="px-5 pt-4 pb-2">
                <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">Profitability by matter</h2>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] border-b border-[var(--border-color)]">
                    <th className="text-left font-semibold px-5 py-2">Matter</th>
                    <th className="text-right font-semibold px-3 py-2">Revenue</th>
                    <th className="text-right font-semibold px-3 py-2">Cost</th>
                    <th className="text-right font-semibold px-5 py-2">Profit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-color)]">
                  {financial.matters.map((m) => (
                    <tr key={m.matterId}>
                      <td className="px-5 py-2 text-[var(--text-primary)]">{m.matterName}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-[var(--text-secondary)]">{fmt(m.revenue)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-[var(--text-secondary)]">{fmt(m.totalCost)}</td>
                      <td className={`px-5 py-2 text-right tabular-nums font-semibold ${m.profit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>{signed(m.profit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Matters ──────────────────────────────────── */}
          <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-[var(--shadow-card)] p-5">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)] mb-3">
              Matters ({matters.length})
            </h2>
            {matters.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">No matters.</p>
            ) : (
              <ul className="divide-y divide-[var(--border-color)]">
                {matters.map((m) => (
                  <li key={m.id}>
                    <Link href={`/dashboard/matters/${m.id}`} className="flex items-center justify-between py-2.5 group">
                      <span className="text-sm text-[var(--text-primary)] group-hover:text-gold-700 dark:group-hover:text-gold-400 transition-colors">
                        {m.name}
                        {m.matterCode && <span className="ml-1.5 text-xs text-[var(--text-muted)] font-mono">{m.matterCode}</span>}
                      </span>
                      <span className="flex items-center gap-2 shrink-0">
                        {m.type && <span className="text-[11px] text-[var(--text-muted)]">{m.type}</span>}
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-stone-100 text-stone-600 dark:bg-stone-500/10 dark:text-stone-300">{m.status || '—'}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* ── Notes ──────────────────────────────────────── */}
        <div className="space-y-6">
          <ClientNotesPanel clientId={client.id} initialNotes={notes} />
        </div>
      </div>
    </DetailShell>
  );
}
