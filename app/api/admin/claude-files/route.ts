import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { listClaudeFiles, cleanupDuplicateClaudeFiles } from '@/lib/ai/claude';

/**
 * GET  — List all files in Claude Files API
 * POST — Clean up duplicate files (keep newest per filename, delete rest)
 *
 * The Files API store is keyed by `ANTHROPIC_API_KEY` and is therefore
 * platform-wide, not per firm — which is exactly why this is restricted to a
 * platform operator rather than to any signed-in staff member. `/api/admin` is
 * excluded from the proxy matcher, so a route under it that does not check a
 * session is not gated by anything at all; this one had no check.
 */
async function requireOperatorSession(): Promise<NextResponse | null> {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (session.user.role !== 'super_user') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return null;
}

export async function GET() {
  const denied = await requireOperatorSession();
  if (denied) return denied;

  try {
    const files = await listClaudeFiles();
    return NextResponse.json({ total: files.length, files });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST() {
  const denied = await requireOperatorSession();
  if (denied) return denied;

  try {
    const result = await cleanupDuplicateClaudeFiles();
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
