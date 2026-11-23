import Link from 'next/link';
import { Building2, ChevronRight, Stamp } from 'lucide-react';
import SectionCard from '@/components/ui/SectionCard';
import { TrademarkStatusPill } from '@/components/trademarks/ui';
import { DueChip } from '@/components/ui/primitives';
import { HEALTH_STYLE } from '@/components/ui/tone';
import type { Health } from '@/lib/corporations/status';

export interface ClientSubjectRow {
  id: string;
  type: 'corporation' | 'trademark';
  name: string;
  status: string | null;
  kind: string | null;
  identifier: string | null;
  health: Health | null;
  overdue: number;
  next: { label: string; due: string | null } | null;
}

/** The companies and marks a client has, from the stored status — each row links to its page. */
export default function ClientSubjects({ rows }: { rows: ClientSubjectRow[] }) {
  const companies = rows.filter((r) => r.type === 'corporation');
  const marks = rows.filter((r) => r.type === 'trademark');
  return (
    <>
      {companies.length > 0 && (
        <SectionCard title="Companies" icon={<Building2 className="w-5 h-5" />} count={companies.length} collapsible>
          <ul className="divide-y divide-[var(--border-color)] -mx-5 -my-4">
            {companies.map((r) => (
              <SubjectRow
                key={r.id}
                row={r}
                href={`/dashboard/corporations/${r.id}`}
                meta={[r.kind, r.identifier ? `SEC ${r.identifier}` : null]}
                pill={r.status ? <CompanyStatusPill status={r.status} health={r.health} /> : null}
              />
            ))}
          </ul>
        </SectionCard>
      )}
      {marks.length > 0 && (
        <SectionCard title="Trademarks" icon={<Stamp className="w-5 h-5" />} count={marks.length} collapsible>
          <ul className="divide-y divide-[var(--border-color)] -mx-5 -my-4">
            {marks.map((r) => (
              <SubjectRow
                key={r.id}
                row={r}
                href={`/dashboard/trademarks/${r.id}`}
                meta={[r.kind, r.identifier ? `No. ${r.identifier}` : null]}
                pill={<TrademarkStatusPill status={r.status ?? 'Prelim'} />}
                quiet={r.status === 'Abandoned'}
              />
            ))}
          </ul>
        </SectionCard>
      )}
    </>
  );
}

function CompanyStatusPill({ status, health }: { status: string; health: Health | null }) {
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 text-[11px] font-medium rounded-full border whitespace-nowrap bg-[var(--subtle-bg)] text-[var(--text-secondary)] border-[var(--border-color)]">
      {health && health !== 'grey' && (
        <span title={HEALTH_STYLE[health].label} className={`w-1.5 h-1.5 rounded-full ${HEALTH_STYLE[health].dot}`} />
      )}
      {status}
    </span>
  );
}

function SubjectRow({
  row: r,
  href,
  meta,
  pill,
  quiet = false,
}: {
  row: ClientSubjectRow;
  href: string;
  meta: (string | null)[];
  pill: React.ReactNode;
  quiet?: boolean;
}) {
  const sub = meta.filter(Boolean).join(' · ');
  return (
    <li>
      <Link
        href={href}
        className="group flex items-center gap-4 px-5 py-3.5 hover:bg-stone-50/70 dark:hover:bg-white/[0.03] transition-colors"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-[var(--text-primary)] group-hover:text-navy-700 dark:group-hover:text-navy-300 truncate transition-colors duration-150">
              {r.name || '(unnamed)'}
            </p>
            {pill}
          </div>
          {sub && <p className="text-xs text-[var(--text-secondary)] truncate mt-0.5">{sub}</p>}
        </div>
        <div className="shrink-0 text-right min-w-0 max-w-[45%]">
          {quiet || !r.next ? (
            <span className="text-xs text-[var(--text-muted)]">{quiet ? '—' : 'All current'}</span>
          ) : (
            <>
              <p className="text-xs font-medium text-[var(--text-primary)] truncate">{r.next.label}</p>
              {r.next.due && <DueChip due={r.next.due} />}
              {r.overdue > 1 && <p className="text-[10px] text-rose-600 dark:text-rose-400">+ {r.overdue - 1} more overdue</p>}
            </>
          )}
        </div>
        <ChevronRight className="w-4 h-4 shrink-0 text-[var(--text-muted)] opacity-0 group-hover:opacity-100 transition-opacity duration-150" />
      </Link>
    </li>
  );
}
