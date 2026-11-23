import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { RED_TEAM_SUBTYPES, isRedTeamable } from '@/lib/legal/pleading-subtypes';

// Litigation deliverables within a matter, for the Red Team picker.
export async function GET(req: Request) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const matterId = searchParams.get('matterId');
  if (!matterId) return NextResponse.json({ deliverables: [] });

  // RLS scopes to deliverables the caller can access. Tagged pleadings and
  // untagged legacy rows are fetched SEPARATELY: sharing one limit let a long
  // matter's recent untagged noise (letters, internal notes) push correctly
  // tagged pleadings out of the window before the name filter ever ran, so the
  // picker silently omitted the very document the lawyer came for.
  const supabase = await getSupabaseServerAuthClient();
  const base = () => supabase
    .from('deliverables')
    .select('notion_id, name, subtype, type, created_time')
    .eq('matter_id', matterId)
    .order('created_time', { ascending: false, nullsFirst: false });

  const [tagged, untagged] = await Promise.all([
    base().in('subtype', [...RED_TEAM_SUBTYPES]).limit(50),
    base().is('subtype', null).limit(100),
  ]);

  const rows = [...(tagged.data ?? []), ...(untagged.data ?? [])]
    .filter((d) => isRedTeamable(d.subtype, d.name, d.type));

  const seen = new Set<string>();
  const deliverables = rows
    .filter((d) => !seen.has(d.notion_id) && seen.add(d.notion_id))
    .sort((a, b) => String(b.created_time ?? '').localeCompare(String(a.created_time ?? '')))
    .slice(0, 50)
    .map((d) => ({ id: d.notion_id, name: d.name, subtype: d.subtype ?? null }));
  return NextResponse.json({ deliverables });
}
