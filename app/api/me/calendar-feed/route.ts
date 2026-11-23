import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/session';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { validateBody } from '@/lib/validation';
import { ensureFeedToken, rotateFeedToken } from '@/lib/calendar/feed';
import { firmBaseUrl } from '@/lib/firm/config';
import { logAudit, getClientIP } from '@/lib/audit';

/**
 * The signed-in user's own calendar feed URL.
 *
 * GET does not mint. A feed URL is a bearer credential that works forever once
 * it exists, so one is created when the person asks for it and not merely
 * because they opened Settings — otherwise every account in the firm carries a
 * live, unused key to its own calendar.
 *
 * The token itself is read and written through the service-role client:
 * calendar_feed_tokens is deny-by-default under RLS, and every query here is
 * pinned to the caller's own person_id.
 */

const actionSchema = z.object({ action: z.enum(['create', 'rotate']) });

interface TokenRow {
  token: string;
  created_at: string;
  rotated_at: string | null;
  last_accessed_at: string | null;
}

async function feedUrl(firmId: string, token: string): Promise<string> {
  return `${await firmBaseUrl(firmId)}/api/calendar/${token}.ics`;
}

export async function GET() {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data } = await getServiceDbForFirm(session.firmId)
    .from('calendar_feed_tokens')
    .select('token, created_at, rotated_at, last_accessed_at')
    .eq('person_id', session.user.notionUserId)
    .maybeSingle();

  const row = data as TokenRow | null;

  return NextResponse.json({
    url: row ? await feedUrl(session.firmId, row.token) : null,
    createdAt: row?.created_at ?? null,
    rotatedAt: row?.rotated_at ?? null,
    lastAccessedAt: row?.last_accessed_at ?? null,
  });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const validation = await validateBody(req, actionSchema);
  if (!validation.success) return validation.response;

  const personId = session.user.notionUserId;
  const firmId = session.firmId;
  const { action } = validation.data;

  const token =
    action === 'rotate'
      ? await rotateFeedToken(firmId, personId)
      : await ensureFeedToken(firmId, personId);

  logAudit({
    firmId,
    entityType: 'TeamMember',
    entityId: personId,
    action: action === 'rotate' ? 'calendar_feed_rotated' : 'calendar_feed_created',
    performedBy: personId,
    ipAddress: getClientIP(req),
  });

  return NextResponse.json({ url: await feedUrl(firmId, token) });
}

export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const personId = session.user.notionUserId;

  const { error } = await getServiceDbForFirm(session.firmId)
    .from('calendar_feed_tokens')
    .delete()
    .eq('person_id', personId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  logAudit({
    firmId: session.firmId,
    entityType: 'TeamMember',
    entityId: personId,
    action: 'calendar_feed_revoked',
    performedBy: personId,
    ipAddress: getClientIP(req),
  });

  return NextResponse.json({ ok: true });
}
