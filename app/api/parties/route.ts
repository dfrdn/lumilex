import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';

async function assertAuth() {
  const session = await getSession();
  if (!session?.user) return null;
  return session;
}

async function assertAdmin() {
  const session = await getSession();
  const role = session?.user?.role;
  if (!role || (role !== 'admin' && role !== 'super_user' && role !== 'finance')) return null;
  return session;
}

/**
 * GET /api/parties?matterId=xxx
 * Returns all parties for a given matter.
 */
export async function GET(req: NextRequest) {
  const session = await assertAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const matterId = req.nextUrl.searchParams.get('matterId');
  if (!matterId) {
    return NextResponse.json({ error: 'matterId is required' }, { status: 400 });
  }

  const supabase = await getSupabaseServerAuthClient();
  const { data, error } = await supabase
    .from('parties')
    .select('*')
    .eq('matter_id', matterId)
    .order('party_role', { ascending: true })
    .order('party_name', { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ parties: data ?? [] });
}

/**
 * POST /api/parties
 * Create a new party record.
 */
export async function POST(req: Request) {
  const session = await assertAdmin();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { matterId, partyName, partyRole, entityType, aliases, tin, contactInfo, notes, source, sourceRef } = body;

  if (!matterId || !partyName) {
    return NextResponse.json({ error: 'matterId and partyName are required' }, { status: 400 });
  }

  const supabase = await getSupabaseServerAuthClient();
  const { data, error } = await supabase
    .from('parties')
    .insert({
      firm_id: session.firmId,
      matter_id: matterId,
      party_name: partyName,
      party_role: partyRole || 'client',
      entity_type: entityType || 'individual',
      aliases: aliases || [],
      tin: tin || '',
      contact_info: contactInfo || '',
      notes: notes || '',
      source: source || 'manual',
      source_ref: sourceRef || null,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ party: data });
}

/**
 * PATCH /api/parties
 * Update a party record. Body: { id, field, value }
 */
export async function PATCH(req: Request) {
  const session = await assertAdmin();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id, field, value } = await req.json();
  if (!id || !field) {
    return NextResponse.json({ error: 'id and field are required' }, { status: 400 });
  }

  const allowedFields = ['party_name', 'party_role', 'entity_type', 'aliases', 'tin', 'contact_info', 'notes'];
  if (!allowedFields.includes(field)) {
    return NextResponse.json({ error: `Cannot update field: ${field}` }, { status: 400 });
  }

  const supabase = await getSupabaseServerAuthClient();
  const { error } = await supabase
    .from('parties')
    .update({ [field]: value, updated_at: new Date().toISOString() })
    .eq('id', id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

/**
 * DELETE /api/parties
 * Delete a party record. Body: { id }
 */
export async function DELETE(req: Request) {
  const session = await assertAdmin();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await req.json();
  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }

  const supabase = await getSupabaseServerAuthClient();
  const { error } = await supabase.from('parties').delete().eq('id', id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
