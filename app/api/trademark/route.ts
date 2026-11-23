import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { TRADEMARK_SELECT, rowToTrademark } from '@/lib/trademark-row';
import { designationStartingPoint, insertTrademark, startingPoint } from '@/lib/trademarks/create';
import { validateBody, trademarkCreateSchema } from '@/lib/validation';
import { manilaToday } from '@/lib/dates';

export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const validation = await validateBody(req, trademarkCreateSchema);
  if (!validation.success) return validation.response;
  const { mark, type, classes, matterId, owner, contactEmail, country, start, origin, designation } = validation.data;
  const begin = origin === 'madrid_in'
    ? designationStartingPoint(designation!, manilaToday())
    : startingPoint(start, manilaToday());
  if ('error' in begin) return NextResponse.json({ error: begin.error }, { status: 400 });

  const supabase = await getSupabaseServerAuthClient();

  // Resolve matter → client denorms
  let clientId: string | null = null;
  let clientName = '';
  let clientCode: number | null = null;
  let matterName = '';
  if (matterId) {
    const { data: matter } = await supabase
      .from('matters')
      .select('name, client_id, client_name')
      .eq('notion_id', matterId)
      .single();
    if (!matter) {
      return NextResponse.json({ error: 'Matter not found' }, { status: 400 });
    }
    matterName = matter.name ?? '';
    clientId = matter.client_id ?? null;
    clientName = matter.client_name ?? '';
    if (clientId) {
      const { data: client } = await supabase
        .from('clients')
        .select('client_code')
        .eq('notion_id', clientId)
        .single();
      clientCode = client?.client_code ?? null;
    }
  }

  const insertBase = {
    matter_id: matterId ?? null,
    matter_name: matterName,
    client_id: clientId,
    client_name: clientName,
    client_code: clientCode,
    mark,
    type: type || null,
    classes,
    country,
    owner: owner || null,
    contact_email: contactEmail || null,
    ...begin.row,
    created_by: session.user.notionUserId,
  };

  const { data: inserted, error } = await insertTrademark(supabase, session.firmId, insertBase);
  if (!inserted) {
    return NextResponse.json({ error: error?.message ?? 'Insert failed' }, { status: 500 });
  }

  let trademark = rowToTrademark(inserted);
  if (begin.officeAction) {
    const { error: oaErr } = await supabase
      .from('trademark_office_actions')
      .insert({ firm_id: session.firmId, trademark_id: trademark.id, ...begin.officeAction, created_by: session.user.notionUserId });
    if (oaErr) {
      // Take the mark back off, so saving the form again doesn't make a second one.
      await supabase.from('trademarks').delete().eq('id', trademark.id);
      return NextResponse.json({ error: `The ${origin === 'madrid_in' ? 'refusal' : 'Office Action'} could not be recorded, so the mark was not added: ${oaErr.message}` }, { status: 500 });
    }
    const { data: withOa } = await supabase.from('trademarks').select(TRADEMARK_SELECT).eq('id', trademark.id).single();
    if (withOa) trademark = rowToTrademark(withOa);
  }

  return NextResponse.json({ ok: true, trademark });
}
