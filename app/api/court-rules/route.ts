import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { fetchAllRuleSets, fetchRuleSetsForMatterType } from '@/lib/legal/court-rules';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { resolveProvisions } from '@/lib/rules/provisions';

// GET /api/court-rules?matterType=Litigation — read-only merged rule sets,
// each deadline carrying the Rules of Court provisions its legal basis names.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const matterType = req.nextUrl.searchParams.get('matterType');

  const ruleSets = matterType
    ? await fetchRuleSetsForMatterType(matterType)
    : await fetchAllRuleSets();

  const supabase = await getSupabaseServerAuthClient();
  const provisions = await resolveProvisions(supabase, ruleSets.flatMap((rs) => rs.deadlines.map((d) => d.legalBasis)));
  const data = ruleSets.map((rs) => ({
    ...rs,
    deadlines: rs.deadlines.map((d) => ({ ...d, provisions: provisions.get(d.legalBasis) ?? [] })),
  }));

  return NextResponse.json({ data });
}
