import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { checkConflicts } from '@/lib/conflicts/check';
import type { ConflictCheckInput } from '@/types/conflicts';

export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body: ConflictCheckInput = await req.json();

  if (!body.names?.length && !body.tin) {
    return NextResponse.json({ error: 'At least one name or TIN is required' }, { status: 400 });
  }

  const result = await checkConflicts(body, session.firmId);
  return NextResponse.json(result);
}
