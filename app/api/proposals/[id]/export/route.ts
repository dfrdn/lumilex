import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { getSupabase } from '@/lib/supabase';
import { validateBody } from '@/lib/validation';
import { logAudit, getClientIP } from '@/lib/audit';
import { engagementProposalContentSchema } from '@/lib/engagement-proposal/schema';
import { buildProposalPackage } from '@/lib/pdf/proposal-package';
import type { EngagementProposalRow } from '@/lib/engagement-proposal/types';

// The full package renders the letter, up to four fee schedules, and the
// firm profile, then merges them.
export const maxDuration = 120;

const PIPELINE_ROLES = new Set(['partner', 'admin', 'super_user']);

const exportSchema = z.object({
  /** Render unsaved editor content instead of the stored version. */
  content: engagementProposalContentSchema.optional(),
  /** Skip the annexes — the preview a drafter looks at while editing. */
  letterOnly: z.boolean().optional(),
  /** Persist the rendered package to storage and record its path. */
  persist: z.boolean().optional(),
});

/**
 * JSON for an HTTP header. Header values are ByteStrings, so the curly quotes
 * in `Annex “A”` throw on their way out; escaping non-ASCII to \uXXXX keeps the
 * payload valid JSON that `JSON.parse` restores unchanged on the client.
 */
function headerJson(value: unknown): string {
  return JSON.stringify(value).replace(
    /[^\x00-\x7F]/g,
    (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}

function safeFileName(clientName: string, version: number): string {
  // Collapse anything non-alphanumeric so a stray quote can't break out of the
  // quoted Content-Disposition filename.
  const base = `${clientName} Engagement Proposal with Annexes v${version}`;
  return base.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '') + '.pdf';
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!PIPELINE_ROLES.has(session.user.role ?? '')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const proposalId = (await params).id;

  const validation = await validateBody(req, exportSchema);
  if (!validation.success) return validation.response;
  const { content: bodyContent, letterOnly, persist } = validation.data;

  // RLS is the gate: the authed read returns nothing if this user can't see the
  // proposal, so an unauthorised caller can't render someone else's.
  const supabase = await getSupabaseServerAuthClient();
  const { data: row } = await supabase
    .from('engagement_proposals')
    .select('*')
    .eq('id', proposalId)
    .maybeSingle<EngagementProposalRow>();
  if (!row) return NextResponse.json({ error: 'Proposal not found' }, { status: 404 });

  // The editor renders what is on screen, which is ahead of what is stored.
  const content = bodyContent ?? row.content;

  let pkg;
  try {
    pkg = await buildProposalPackage(session.firmId, content, { letterOnly });
  } catch (e) {
    return NextResponse.json({ error: `Could not build the proposal: ${(e as Error).message}` }, { status: 500 });
  }

  const fileName = safeFileName(content.client.name, row.version);

  if (persist) {
    // Service-role: storage is a privileged write, and the authorization
    // decision was already made by the RLS-scoped read above.
    const service = getSupabase();
    const storagePath = `engagement-proposals/${row.thread_id}/v${row.version}-${Date.now()}.pdf`;
    const { error: uploadErr } = await service.storage
      .from('files')
      .upload(storagePath, pkg.buffer, { contentType: 'application/pdf', upsert: true });
    if (uploadErr) {
      return NextResponse.json({ error: `Storage upload failed: ${uploadErr.message}` }, { status: 500 });
    }
    await supabase
      .from('engagement_proposals')
      .update({ storage_path: storagePath, file_name: fileName, updated_at: new Date().toISOString() })
      .eq('id', row.id);
  }

  logAudit({
    firmId: session.firmId,
    entityType: 'EngagementProposal',
    entityId: row.id,
    action: letterOnly ? 'previewed' : 'exported',
    performedBy: session.user.notionUserId,
    ipAddress: getClientIP(req),
  });

  return new NextResponse(new Uint8Array(pkg.buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Content-Length': String(pkg.buffer.length),
      // Surfaced in the builder so a drafter can see what got bound behind the letter.
      'X-Annex-Labels': headerJson(pkg.annexLabels),
      'X-Missing-Schedules': headerJson(pkg.missingSlugs),
      'Cache-Control': 'no-store',
    },
  });
}
