import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import MatterDetailTabs from './MatterDetailTabs';
import MatterPortalHero from './MatterPortalHero';
import EngagementSignatureCard from './EngagementSignatureCard';
import type { PortalMatterDetailData } from '@/lib/portal/data';

interface Props {
  data: PortalMatterDetailData;
  /** Link prefix — `/portal` live, the preview root in preview. */
  basePath: string;
  /** Pre-fills the engagement signature field; the client's name live, a placeholder in preview. */
  signerName: string;
  preview?: boolean;
}

function formatDate(s: string | null | undefined): string {
  if (!s) return '';
  return new Date(s).toLocaleDateString('en-PH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'Asia/Manila',
  });
}

export default function PortalMatterDetailView({ data, basePath, signerName, preview = false }: Props) {
  const { matter, engagement } = data;
  const title = matter.case_title || matter.name;
  const subline = [matter.case_number, matter.court, matter.type].filter(Boolean).join(' · ');

  return (
    <main className="max-w-5xl mx-auto px-6 py-8">
      <Link
        href={basePath}
        className="inline-flex items-center gap-1 text-xs text-[var(--text-secondary)] hover:text-foreground transition-colors mb-4"
      >
        <ChevronLeft className="w-3.5 h-3.5" />
        Back to matters
      </Link>

      <div className="flex items-start gap-2 flex-wrap mb-3">
        {matter.matter_code && (
          <span className="text-[10px] font-mono font-semibold uppercase tracking-wider text-[var(--text-muted)] bg-subtle px-2 py-0.5 rounded">
            {matter.matter_code}
          </span>
        )}
        {matter.status && (
          <span className="text-[10px] font-medium uppercase tracking-wider text-navy-700 dark:text-gold-400 bg-navy-50 dark:bg-gold-400/10 px-2 py-0.5 rounded">
            {matter.status}
          </span>
        )}
      </div>

      <h1 className="font-serif text-3xl md:text-4xl text-foreground tracking-tight">{title}</h1>
      {subline && <p className="text-sm text-[var(--text-secondary)] mt-2">{subline}</p>}
      {matter.date && (
        <p className="text-xs text-[var(--text-muted)] mt-1">{formatDate(matter.date)}</p>
      )}

      <MatterPortalHero team={data.teamMembers} next={data.nextEvent} />


      {engagement?.filePath && (
        <div className="mt-8">
          <EngagementSignatureCard
            matterId={matter.notion_id}
            documentName={engagement.fileName ?? 'Engagement letter'}
            documentUrl={engagement.url}
            signerName={signerName}
            initialSignature={engagement.signature}
            preview={preview}
          />
        </div>
      )}

      <div className="mt-8 mb-12">
        <MatterDetailTabs
          matterId={matter.notion_id}
          files={data.files}
          schedule={data.schedule}
          deliverables={data.filedDeliverables}
          fileRequests={data.fileRequests}
          exhibits={data.exhibits}
          statusReports={data.statusReports}
          timelineEvents={data.timelineEvents}
          chatInitialMessages={data.chatMessages}
          preview={preview}
        />
      </div>
    </main>
  );
}
