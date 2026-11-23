import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { validateBody, clientBillingProfileSchema } from '@/lib/validation';
import { logAudit, getClientIP } from '@/lib/audit';
import { readClientProfile } from '@/lib/billing/client-profile';

const BILLING_ROLES = ['finance', 'admin', 'super_user', 'partner'];

/**
 * GET /api/finance/clients/[id]/billing-profile — the client's letter and
 * recipient settings (lib/billing/client-profile.ts). `id` is the client's
 * notion_id. Empty settings when none are saved yet.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user?.notionUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!BILLING_ROLES.includes(session.user.role ?? '')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await params;
  const supabase = await getSupabaseServerAuthClient();
  const { data: client } = await supabase.from('clients').select('notion_id, name, contact_email').eq('notion_id', id).maybeSingle();
  if (!client) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const { data } = await supabase.from('client_billing_profiles').select('settings, updated_at').eq('client_id', id).maybeSingle();
  return NextResponse.json({
    clientId: client.notion_id,
    clientName: client.name,
    defaultClientEmail: client.contact_email ?? '',
    profile: readClientProfile(data?.settings),
    updatedAt: data?.updated_at ?? null,
  });
}

/** PUT — replace the client's profile with the one given. */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user?.notionUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!BILLING_ROLES.includes(session.user.role ?? '')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const validation = await validateBody(req, clientBillingProfileSchema);
  if (!validation.success) return validation.response;

  const { id } = await params;
  const supabase = await getSupabaseServerAuthClient();
  const { data: client } = await supabase.from('clients').select('notion_id').eq('notion_id', id).maybeSingle();
  if (!client) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const profile = readClientProfile(validation.data);
  const { error } = await supabase.from('client_billing_profiles').upsert({
    firm_id: session.firmId,
    client_id: id,
    settings: profile,
    updated_at: new Date().toISOString(),
    updated_by: session.user.notionUserId,
  });
  if (error) {
    console.error('[billing-profile] save failed:', error.message);
    return NextResponse.json({ error: 'Failed to save the billing profile' }, { status: 500 });
  }

  logAudit({
    firmId: session.firmId,
    entityType: 'ClientBillingProfile',
    entityId: id,
    action: 'updated',
    performedBy: session.user.notionUserId,
    ipAddress: getClientIP(req),
  });
  return NextResponse.json({ profile });
}
