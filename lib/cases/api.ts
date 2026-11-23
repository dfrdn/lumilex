import { NextResponse } from 'next/server';
import type { getSession } from '@/lib/session';
import { getCaseById } from '@/lib/queries/cases';

/** Who may change a case — the same roles cases' RLS write policies admit. */
export const CASE_EDITORS = ['admin', 'super_user', 'partner', 'lawyer'];

type Session = Awaited<ReturnType<typeof getSession>>;

/** The 401 / 403 a case write answers with, or null to go ahead. */
export function refuseCaseWrite(session: Session): NextResponse | null {
  if (!session?.user?.notionUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!CASE_EDITORS.includes(session.user.role ?? '')) return NextResponse.json({ error: 'Only lawyers, partners and admins change cases' }, { status: 403 });
  return null;
}

/** The case as the page shows it, after a change — the page swaps it in without a refresh. */
export async function caseResponse(firmId: string, id: string, status = 200): Promise<NextResponse> {
  const data = await getCaseById(firmId, id);
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ case: data }, { status });
}
