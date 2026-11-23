import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft, ListChecks } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import ScopeLibraryEditor from '@/components/prospects/ScopeLibraryEditor';
import { requireRouteAccess } from '@/lib/nav/guard';

export const metadata: Metadata = { title: 'Scope Library' };

const PIPELINE_ROLES = ['partner', 'admin', 'super_user'];

export default async function ScopeLibraryPage() {
  const session = await requireRouteAccess('/dashboard/prospects/scope-library');
  const role = session.user.role ?? 'lawyer';

  return (
    <>
      <PageHeader
        icon={<ListChecks className="w-5 h-5" />}
        title="Scope Library"
        subtitle="Reusable scope-of-services text for engagement proposals"
      />
      <div className="mb-4">
        <Link
          href="/dashboard/prospects/proposals"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-stone-200 dark:border-[rgba(255,255,255,0.1)] hover:bg-stone-50 dark:hover:bg-white/5 transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Engagement proposals
        </Link>
      </div>
      <p className="text-xs text-[var(--text-muted)] mb-4 max-w-3xl">
        A proposal assembles its scope section from the lines selected here rather than rewriting them, so the
        same service reads the same way in every letter and the carve-outs always land last. Editing a line
        changes the next proposal drafted; letters already sent are untouched.
      </p>
      <div className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] overflow-hidden h-[calc(100vh-19rem)] min-h-[32rem]">
        <ScopeLibraryEditor canEdit={PIPELINE_ROLES.includes(role)} />
      </div>
    </>
  );
}
