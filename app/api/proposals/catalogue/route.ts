import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { loadProposalCatalogue, loadRecipientOptions } from '@/lib/engagement-proposal/catalogue';

const PIPELINE_ROLES = new Set(['partner', 'admin', 'super_user']);

/** What the new-proposal form offers: who it can be addressed to, and what the firm publishes. */
export async function GET() {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!PIPELINE_ROLES.has(session.user.role ?? '')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // The catalogue is assembled from firm-wide published content — the rate
  // card, the scope library, the firm profile's contact block. Each of those
  // refuses to substitute another firm's when this one has published none, so
  // the builder reports what is missing rather than opening on borrowed
  // figures.
  let catalogue, recipients;
  try {
    [catalogue, recipients] = await Promise.all([
      loadProposalCatalogue(session.firmId),
      loadRecipientOptions(session.firmId),
    ]);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 409 });
  }

  return NextResponse.json({ ...catalogue, recipients });
}
