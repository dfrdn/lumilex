import { notFound } from 'next/navigation';
import { Megaphone } from 'lucide-react';
import { getAnnouncementById } from '@/lib/queries/detail';
import DetailShell from './DetailShell';
import DetailField from './DetailField';

export default async function AnnouncementDetail({ id, firmId }: { id: string; firmId: string }) {
  const item = await getAnnouncementById(id, firmId);
  if (!item) notFound();

  return (
    <DetailShell title={item.name} icon={<Megaphone className="w-5 h-5" />} entityType="Announcement">
      <div className="bg-white rounded-xl border border-gray-200/80 dark:border-white/10 shadow-[var(--shadow-card)] p-6 sm:p-8 dark:bg-stone-900">
        <dl>
          <DetailField label="Posted">
            {new Date(item.createdTime).toLocaleDateString('en-PH', {
              weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
              timeZone: 'Asia/Manila',
            })}
          </DetailField>
          <DetailField label="Content">
            <div className="whitespace-pre-wrap leading-relaxed">{item.content || '(No content)'}</div>
          </DetailField>
        </dl>
      </div>
    </DetailShell>
  );
}
