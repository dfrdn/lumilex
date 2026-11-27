import { notFound, redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { CODES, provisionAnchor } from '@/lib/codes/model';

/**
 * /dashboard/library/codes/labor/237 → the Labor Code's Library page at
 * article 237; /dashboard/library/codes/labor → the page itself.
 */
export default async function CodeRedirect({ params }: { params: Promise<{ code: string; number?: string[] }> }) {
  const session = await getSession();
  if (!session?.user?.notionUserId) redirect('/login');

  const { code, number } = await params;
  const meta = CODES[code];
  const num = number?.[0] ? decodeURIComponent(number[0]) : null;
  if (!meta || (num !== null && !/^\d{1,4}(-?[A-Za-z]{1,2})?$/.test(num))) notFound();

  const supabase = await getSupabaseServerAuthClient();
  const { data: row } = await supabase.from('legal_codes').select('kb_page_id').eq('id', code).maybeSingle();
  if (!row?.kb_page_id) notFound();

  redirect(`/dashboard/library/${row.kb_page_id}${num ? `#${provisionAnchor(meta.unit, num.toUpperCase())}` : ''}`);
}
