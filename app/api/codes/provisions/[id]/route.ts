import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import type { ProvisionChange, ProvisionVersion } from '@/lib/codes/model';

export interface ProvisionReview {
  id: number;
  versionSeq: number;
  reviewedBy: string;
  reviewerName: string;
  reviewedAt: string;
  note: string | null;
}

export interface ProvisionDetail {
  id: number;
  codeId: string;
  number: string;
  citation: string;
  status: string;
  versions: ProvisionVersion[];
  reviews: ProvisionReview[];
}

/** GET /api/codes/provisions/[id] — a provision's history and reviews, for the panel a click opens. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user?.notionUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const supabase = await getSupabaseServerAuthClient();
  const [{ data: provision }, { data: versions }, { data: reviews }] = await Promise.all([
    supabase.from('code_provisions').select('id, code_id, number, citation, status').eq('id', id).maybeSingle(),
    supabase.from('code_provision_versions')
      .select('seq, change, number, heading, text, effective_on, instrument, instrument_section, approved_on, instrument_url, note')
      .eq('provision_id', id).order('seq'),
    supabase.from('code_provision_reviews').select('id, version_seq, reviewed_by, reviewed_at, note').eq('provision_id', id).order('reviewed_at', { ascending: false }),
  ]);
  if (!provision) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const reviewerIds = [...new Set((reviews ?? []).map((r) => r.reviewed_by))];
  const names = new Map<string, string>();
  if (reviewerIds.length) {
    const { data: team } = await supabase.from('team').select('person_id, name').in('person_id', reviewerIds);
    for (const t of team ?? []) names.set(t.person_id, t.name);
  }

  const detail: ProvisionDetail = {
    id: provision.id,
    codeId: provision.code_id,
    number: provision.number,
    citation: provision.citation,
    status: provision.status,
    versions: (versions ?? []).map((v) => ({
      seq: v.seq,
      change: v.change as ProvisionChange,
      number: v.number,
      heading: v.heading,
      text: v.text,
      effectiveOn: v.effective_on,
      instrument: v.instrument,
      instrumentSection: v.instrument_section,
      approvedOn: v.approved_on,
      instrumentUrl: v.instrument_url,
      note: v.note,
    })),
    reviews: (reviews ?? []).map((r) => ({
      id: r.id,
      versionSeq: r.version_seq,
      reviewedBy: r.reviewed_by,
      reviewerName: names.get(r.reviewed_by) ?? 'A reviewer',
      reviewedAt: r.reviewed_at,
      note: r.note,
    })),
  };
  return NextResponse.json(detail);
}
