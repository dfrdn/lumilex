import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { validateBody } from '@/lib/validation';
import { logAudit, getClientIP } from '@/lib/audit';
import { sendFileRequestEmail } from '@/lib/email';
import { firmBaseUrl } from '@/lib/firm/config';

const TEAM_ROLES_ALLOWED = new Set([
  'lawyer',
  'partner',
  'admin',
  'super_user',
  'chief_liaison_officer',
  'liaison_officer',
]);

const CreateSchema = z.object({
  description: z.string().trim().min(1, 'Description is required').max(1000),
  dueAt: z
    .string()
    .datetime({ offset: true })
    .optional()
    .nullable()
    .transform((v) => v || null),
});

/**
 * GET /api/matters/[id]/file-requests
 * Returns all non-canceled requests for the matter (open + fulfilled).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id: matterId } = await params;
  const supabase = await getSupabaseServerAuthClient();
  const { data, error } = await supabase
    .from('file_requests')
    .select(
      'id, matter_id, requested_by, description, due_at, created_at, fulfilled_at, fulfilled_by_client_user_id, canceled_at',
    )
    .eq('matter_id', matterId)
    .is('canceled_at', null)
    .order('created_at', { ascending: false });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ requests: data ?? [] });
}

/**
 * POST /api/matters/[id]/file-requests
 * Create a new file request. Fires a Resend email to every active
 * client_user on the matter's client. Audit + email are fire-and-forget.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!TEAM_ROLES_ALLOWED.has(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id: matterId } = await params;

  const validation = await validateBody(req, CreateSchema);
  if (!validation.success) return validation.response;
  const { description, dueAt } = validation.data;

  const supabase = await getSupabaseServerAuthClient();

  const { data: matter } = await supabase
    .from('matters')
    .select('notion_id, name, case_title, matter_code, client_id')
    .eq('notion_id', matterId)
    .maybeSingle();
  if (!matter) {
    return NextResponse.json({ error: 'Matter not found' }, { status: 404 });
  }

  const { data: inserted, error: insertError } = await supabase
    .from('file_requests')
    .insert({
      firm_id: session.firmId,
      matter_id: matterId,
      requested_by: session.user.notionUserId,
      description,
      due_at: dueAt,
    })
    .select('id, description, due_at, created_at')
    .single();
  if (insertError || !inserted) {
    console.error('[file-requests] insert failed:', insertError);
    return NextResponse.json(
      { error: 'Failed to create request' },
      { status: 500 },
    );
  }

  logAudit({
    firmId: session.firmId,
    entityType: 'file_request',
    entityId: inserted.id,
    entityName: description.slice(0, 80),
    action: 'created',
    performedBy: session.user.notionUserId,
    ipAddress: getClientIP(req),
  });

  // Fire-and-forget email fan-out to client_users on this matter's client.
  if (matter.client_id) {
    const matterName = matter.case_title || matter.name;
    void notifyClientUsersOfFileRequest({
      clientId: matter.client_id,
      matterId,
      matterName,
      matterCode: matter.matter_code,
      requesterName: session.user.name || 'Your legal team',
      description: inserted.description,
      dueAt: inserted.due_at,
      firmId: session.firmId,
    });
  }

  return NextResponse.json({ ok: true, request: inserted });
}

async function notifyClientUsersOfFileRequest({
  clientId,
  matterId,
  matterName,
  matterCode,
  requesterName,
  description,
  dueAt,
  firmId,
}: {
  clientId: string;
  matterId: string;
  matterName: string;
  matterCode: string | null;
  requesterName: string;
  description: string;
  dueAt: string | null;
  firmId: string;
}) {
  try {
    const supabase = await getSupabaseServerAuthClient();
    const { data: clientUsers } = await supabase
      .from('client_users')
      .select('email, name')
      .eq('client_id', clientId)
      .eq('active', true);
    if (!clientUsers || clientUsers.length === 0) return;

    const portalLink = `${await firmBaseUrl(firmId)}/portal/matters/${encodeURIComponent(matterId)}`;

    await Promise.allSettled(
      clientUsers
        .filter((u) => !!u.email)
        .map((u) =>
          sendFileRequestEmail({
            to: u.email,
            clientName: u.name || '',
            matterName,
            matterCode,
            requesterName,
            description,
            dueAt,
            portalLink,
            firmId,
          }),
        ),
    );
  } catch (err) {
    console.error('[file-requests] notify client_users failed:', err);
  }
}
