import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { isFeatureAvailable } from '@/lib/firm/features';
import AssistantPanel from '@/components/assistant/AssistantPanel';

export const metadata: Metadata = { title: 'Assistant' };

export default async function AssistantPage() {
  const session = await getSession();
  if (!session?.user?.notionUserId) redirect('/login');
  if (!(await isFeatureAvailable(session.firmId, 'ai_assistant'))) redirect('/dashboard');

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-xl font-semibold text-foreground font-serif mb-4">
        Assistant
      </h1>
      <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] overflow-hidden">
        <AssistantPanel variant="page" />
      </div>
    </div>
  );
}
