import type { Metadata } from 'next';
import { getSession } from '@/lib/session';
import { redirect, notFound } from 'next/navigation';

import LibraryPageDetail from '@/components/library/LibraryPageDetail';
import { loadLibraryPage, loadStatutePage } from '@/lib/library/load';
import { isOutOfScope } from '@/lib/library/scope';
import { entityTitle } from '@/lib/page-metadata';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: await entityTitle({ table: 'kb_pages', idColumn: 'id', id, nameColumn: 'title', fallback: 'Library page' }) };
}

export const dynamic = 'force-dynamic';

export default async function LibraryPageRoute({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user?.notionUserId) redirect('/login');

  const { id } = await params;
  const pageId = Number(id);
  if (!Number.isInteger(pageId)) notFound();

  const loaded = await loadLibraryPage(pageId);
  if (!loaded || (await isOutOfScope(session.firmId, loaded.page.kind))) notFound();
  const statute = await loadStatutePage(loaded.page);

  const role = session.user.role ?? 'lawyer';
  return (
    <LibraryPageDetail
      page={loaded.page}
      citations={loaded.citations}
      contributors={loaded.contributors}
      statute={statute}
      role={role}
      currentUserId={session.user.notionUserId}
    />
  );
}
