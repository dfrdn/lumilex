import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { validateBody } from '@/lib/validation';
import { logAudit, getClientIP } from '@/lib/audit';
import { firmProfileSaveSchema } from '@/lib/firm-profile/schema';
import { DEFAULT_FIRM_PROFILE } from '@/lib/firm-profile/default';
import type { FirmProfileRow } from '@/lib/firm-profile/types';

const ADMIN_ROLES = new Set(['admin', 'super_user', 'finance']);

function guard(session: Awaited<ReturnType<typeof getSession>>) {
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!ADMIN_ROLES.has(session.user.role ?? '')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return null;
}

// Returns the saved default profile, or the in-code template if none exists yet.
export async function GET() {
  const session = await getSession();
  const denied = guard(session);
  if (denied) return denied;

  const supabase = getServiceDbForFirm(session!.firmId);
  const { data, error } = await supabase
    .from('firm_profiles')
    .select('*')
    .order('is_default', { ascending: false })
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle<FirmProfileRow>();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (!data) {
    return NextResponse.json({
      profile: {
        id: null,
        name: 'Firm Profile',
        content: DEFAULT_FIRM_PROFILE,
        is_default: true,
      },
      isTemplate: true,
    });
  }

  return NextResponse.json({ profile: data, isTemplate: false });
}

// Upserts the single default profile (insert on first save, update thereafter).
export async function PUT(req: NextRequest) {
  const session = await getSession();
  const denied = guard(session);
  if (denied) return denied;

  const validation = await validateBody(req, firmProfileSaveSchema);
  if (!validation.success) return validation.response;
  const { name, content } = validation.data;

  const supabase = getServiceDbForFirm(session!.firmId);
  const { data: existing } = await supabase
    .from('firm_profiles')
    .select('id')
    .eq('is_default', true)
    .maybeSingle<{ id: string }>();

  let row: FirmProfileRow | null = null;
  if (existing) {
    const { data, error } = await supabase
      .from('firm_profiles')
      .update({ content, ...(name ? { name } : {}), updated_at: new Date().toISOString() })
      .eq('id', existing.id)
      .select('*')
      .single<FirmProfileRow>();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    row = data;
  } else {
    const { data, error } = await supabase
      .from('firm_profiles')
      .insert({
        name: name ?? 'Firm Profile',
        content,
        is_default: true,
        created_by: session!.user!.notionUserId,
      })
      .select('*')
      .single<FirmProfileRow>();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    row = data;
  }

  logAudit({
    firmId: session!.firmId,
    entityType: 'FirmProfile',
    entityId: row.id,
    action: existing ? 'updated' : 'created',
    performedBy: session!.user!.notionUserId,
    ipAddress: getClientIP(req),
  });

  return NextResponse.json({ profile: row });
}
