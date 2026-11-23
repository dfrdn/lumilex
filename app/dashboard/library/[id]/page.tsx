import type { Metadata } from 'next';
import { getSession } from '@/lib/session';
import { redirect, notFound } from 'next/navigation';

import LibraryPageDetail from '@/components/library/LibraryPageDetail';
import { loadLibraryPage } from '@/lib/library/load';
import { isOutOfScope } from '@/lib/library/scope';
import { entityTitle } from '@/lib/page-metadata';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: await entityTitle({ table: 'kb_pages', idColumn: 'id', id, nameColumn: 'title', fallback: 'Library page' }) };
}

export const dynamic = 'force-dynamic';

export default async function LibraryPageRoute({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ section?: string }>;
}) {
  const session = await getSession();
  if (!session?.user?.notionUserId) redirect('/login');

  const { id } = await params;
  const { section } = await searchParams;
  const initialSection = section && /^\d{1,3}$/.test(section) ? Number(section) : null;
  const pageId = Number(id);
  if (!Number.isInteger(pageId)) notFound();

  const loaded = await loadLibraryPage(pageId);
  if (!loaded || (await isOutOfScope(session.firmId, loaded.page.kind))) notFound();

  const role = session.user.role ?? 'lawyer';
  return (
    <LibraryPageDetail
      page={loaded.page}
      citations={loaded.citations}
      contributors={loaded.contributors}
      rules={loaded.rules}
      initialSection={initialSection}
      role={role}
      currentUserId={session.user.notionUserId}
    />
  );
}
