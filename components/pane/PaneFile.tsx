'use client';

import { Calendar, Paperclip, FileText, ExternalLink, Users, Briefcase } from 'lucide-react';
import PersonBadge from '@/components/detail/PersonBadge';
import PaneCard from '@/components/pane/PaneCard';
import PaneLink from '@/components/pane/PaneLink';
import { FORMER_MEMBER } from '@/lib/former-member';

interface Person { id: string; name: string; initials: string; position: string; avatarUrl?: string | null; }

interface Props {
  data: any;
  people: Person[];
}

function formatDate(d: string | null): string {
  if (!d) return '\u2014';
  return new Date(d.split('T')[0] + 'T00:00:00Z').toLocaleDateString('en-PH', {
    year: 'numeric', month: 'short', day: 'numeric', timeZone: 'Asia/Manila',
  });
}

export default function PaneFile({ data, people }: Props) {
  return (
    <div className="space-y-4">
      {/* Origin + Action */}
      <div className="flex items-center gap-2 flex-wrap">
        {data.origin && (
          <span className="text-xs rounded-full px-2.5 py-1 font-medium ring-1 ring-inset bg-blue-50 text-blue-700 ring-blue-200/60 dark:bg-blue-500/10 dark:text-blue-400 dark:ring-blue-500/20">
            {data.origin}
          </span>
        )}
        {data.actionTaken && (
          <span className="text-xs rounded-full px-2.5 py-1 font-medium ring-1 ring-inset bg-gray-50 text-gray-600 ring-gray-200/60 dark:bg-gray-500/10 dark:text-gray-400 dark:ring-gray-500/20">
            {data.actionTaken}
          </span>
        )}
      </div>

      {/* Details */}
      <PaneCard title="Details" icon={<Briefcase className="w-3.5 h-3.5" />}>
        <div className="space-y-3">
          {data.matter && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-0.5">Matter</p>
              <PaneLink
                href={data.matterId ? `/dashboard/matters/${data.matterId}` : null}
                label={data.matter}
              />
            </div>
          )}
          {data.client && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-0.5">Client</p>
              <PaneLink
                href={data.clientId ? `/dashboard/clients/${encodeURIComponent(data.clientId)}` : null}
                label={data.client}
              />
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-0.5">Date Received</p>
              <p className="text-sm text-foreground inline-flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                {formatDate(data.dateReceived)}
              </p>
            </div>
            {data.dateSentFiled && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-0.5">Date Sent/Filed</p>
                <p className="text-sm text-foreground">{formatDate(data.dateSentFiled)}</p>
              </div>
            )}
          </div>
          {data.deliverableName && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-0.5">Related Deliverable</p>
              <PaneLink
                href={data.deliverableId ? `/dashboard/deliverables/${data.deliverableId}` : null}
                label={data.deliverableName}
                icon={<FileText className="w-3.5 h-3.5 text-[var(--text-muted)]" />}
              />
            </div>
          )}
        </div>
      </PaneCard>

      {/* Read by */}
      {data.personsReadIds && data.personsReadIds.length > 0 && (
        <PaneCard title="Read By" icon={<Users className="w-3.5 h-3.5" />} count={data.personsReadIds.length}>
          <div className="flex flex-wrap gap-1.5">
            {data.personsReadIds.map((id: string) => {
              const person = people.find(p => p.id === id);
              return <PersonBadge key={id} initials={person?.initials ?? FORMER_MEMBER} position={person?.position} avatarUrl={person?.avatarUrl} name={person?.name} />;
            })}
          </div>
        </PaneCard>
      )}

      {/* File attachments */}
      {data.fileUrls && data.fileUrls.length > 0 && (
        <PaneCard title="Attachments" icon={<Paperclip className="w-3.5 h-3.5" />} count={data.fileUrls.length}>
          <div className="space-y-1.5">
            {data.fileUrls.map((f: any, i: number) => (
              <a
                key={i}
                href={f.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-xs text-gold-600 dark:text-gold-400 hover:underline py-1 px-2 rounded-md hover:bg-[var(--subtle-bg)] transition-colors"
              >
                <ExternalLink className="w-3 h-3 shrink-0" />
                <span className="truncate">{f.name || 'Attachment'}</span>
              </a>
            ))}
          </div>
        </PaneCard>
      )}
    </div>
  );
}
