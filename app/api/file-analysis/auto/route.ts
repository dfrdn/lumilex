import { NextResponse, after } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabase } from '@/lib/supabase';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { runAutoAnalysis } from '@/lib/ai/auto-analyze';

/**
 * GET /api/file-analysis/auto?fileId=xxx&firmId=yyy
 * Called by the Supabase database webhook when file_urls changes.
 *
 * POST /api/file-analysis/auto
 * Called by app code. Accepts { fileId: string, firmId?: string }.
 *
 * Two callers, two credentials:
 *
 *   - the DB webhook, which reaches this through `call_app_api` and already
 *     sends `Authorization: Bearer <cron_secret>` from the vault. It always
 *     did; this route simply never looked. Since `api/file-analysis` is
 *     excluded from proxy.ts's matcher, that made the endpoint fully open —
 *     anyone who could guess a `notion_id` could trigger AI analysis on
 *     another firm's document, spending platform credit and shipping that
 *     firm's file to Anthropic without its consent.
 *   - a signed-in user, whose own firm scopes the lookup. A caller-supplied
 *     `firmId` is ignored for them: trusting it would let a lawyer in firm A
 *     name firm B and have the unscoped branch resolve B's file.
 *
 * firmId scopes the lookup; a firmId that doesn't match the file's real firm
 * finds nothing and 404s (fail-safe). Only a webhook may omit it, and then the
 * firm is resolved from the file row itself.
 */
function isWebhookCaller(req: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  return req.headers.get('authorization') === `Bearer ${cronSecret}`;
}

/**
 * Resolve who is calling and which firm they may act on.
 *
 * Returns the firm scope to use, or a response to send instead. `null` scope
 * means "webhook with no firmId" — the one case allowed to resolve the firm
 * from the row.
 */
async function resolveCaller(
  req: Request,
  requestedFirmId: string | null,
): Promise<{ firmId: string | null } | { response: NextResponse }> {
  if (isWebhookCaller(req)) return { firmId: requestedFirmId };

  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  // A session pins the scope to its own firm, whatever the payload claims.
  return { firmId: session.firmId };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const caller = await resolveCaller(req, searchParams.get('firmId'));
  if ('response' in caller) return caller.response;
  return _handleAutoAnalysis(searchParams.get('fileId'), caller.firmId);
}

export async function POST(req: Request) {
  try {
    const { fileId, firmId } = await req.json();
    const caller = await resolveCaller(req, typeof firmId === 'string' ? firmId : null);
    if ('response' in caller) return caller.response;
    return _handleAutoAnalysis(fileId, caller.firmId);
  } catch (err) {
    console.error('[file-analysis/auto] Error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

async function _handleAutoAnalysis(fileId: string | null, firmId: string | null) {
  try {

    if (!fileId) {
      return NextResponse.json({ error: 'Missing fileId' }, { status: 400 });
    }

    // firm-resolution lookup: scoped client follows. A legacy webhook payload
    // carries no firmId, so the file row's own firm scopes the analysis that
    // follows. Only reachable for a webhook caller — a session is always
    // scoped by resolveCaller above.
    const supabase = firmId ? getServiceDbForFirm(firmId) : getSupabase();
    const { data: file, error } = await supabase
      .from('files')
      .select('name, matter_name, file_urls, firm_id')
      .eq('notion_id', fileId)
      .single();

    if (error || !file?.firm_id) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }
    const ownerFirmId = file.firm_id as string;

    const fileUrls: { name: string; url: string; path?: string }[] =
      typeof file.file_urls === 'string' ? JSON.parse(file.file_urls) : (file.file_urls ?? []);

    if (fileUrls.length > 0) {
      // Use after() to keep the serverless function alive until processing completes
      after(async () => {
        try {
          await runAutoAnalysis(fileId, fileUrls, file.matter_name ?? file.name ?? '', ownerFirmId);
        } catch (err) {
          console.error(`[auto-analyze] Error for file ${fileId}:`, err);
        }
      });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[file-analysis/auto] Error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
