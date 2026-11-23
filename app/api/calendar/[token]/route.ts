import { NextRequest, NextResponse } from 'next/server';
import { buildIcs } from '@/lib/calendar/ics';
import { gatherFeedEvents, resolveFeedToken, touchFeedToken } from '@/lib/calendar/feed';
import { getFirmConfig } from '@/lib/firm/config';

/**
 * GET /api/calendar/<token>.ics — a subscribable iCalendar feed.
 *
 * Unauthenticated by construction: Outlook, Google and Apple fetch this from
 * their own servers with no cookie and no way to prompt for one. The token in
 * the path is the whole credential, which is why it is 256 bits of randomness,
 * lives in a deny-by-default table, and is revoked by rotation.
 *
 * Excluded from the proxy matcher for the same reason as the other
 * session-less endpoints — a redirect to /login is not something a calendar
 * client can follow.
 */

// The feed is per-person and changes whenever firm data does; a cached render
// would serve one subscriber another's calendar.
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token: raw } = await params;

  // Calendar clients are happier with a .ics suffix, and some append one when
  // the user pastes a bare URL. Accept both spellings of the same token.
  const token = raw.endsWith('.ics') ? raw.slice(0, -4) : raw;

  const owner = await resolveFeedToken(token);
  if (!owner) {
    // Deliberately bare: an unknown token and a revoked one are the same
    // answer, and the body says nothing about whether the firm exists.
    return new NextResponse('Not found', { status: 404 });
  }

  const [firm, events] = await Promise.all([
    getFirmConfig(owner.firmId),
    gatherFeedEvents(owner.firmId, owner.personId),
  ]);

  // Fire-and-forget, like logAudit: a failed stamp must not cost the subscriber
  // their calendar.
  void touchFeedToken(owner.firmId, owner.personId).catch(() => {});

  const body = buildIcs({ name: `${firm.shortName} · Lumilex`, events });

  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="lumilex.ics"',
      // Client data on a URL that needs no credential to replay: nothing in
      // between should hold a copy.
      'Cache-Control': 'private, no-store, max-age=0',
      // The URL is the secret, so keep it out of the next hop's Referer.
      'Referrer-Policy': 'no-referrer',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}
