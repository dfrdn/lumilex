import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getLiaisonOfficers } from '@/lib/queries/liaison';

/**
 * The firm's active liaison officers, for client-side pickers
 * — used by the CreateErrandModal when launched from outside the
 * Liaison Command Center (e.g., admin's /admin/liaison_tasks page).
 */
export async function GET() {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const officers = await getLiaisonOfficers(session.firmId);
  return NextResponse.json({ officers });
}
