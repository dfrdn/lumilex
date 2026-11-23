import { NextResponse, after } from 'next/server';
import { getSession } from '@/lib/session';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { logAudit, getClientIP } from '@/lib/audit';
import { generateEmbeddingsForEntity } from '@/lib/ai/embeddings';
import { canAccessRun } from '@/lib/legal/red-team-access';

// Per-finding reviewer notes. A note is guidance for the AI: notes on a
// pleading are fed back into succeeding runs of that same pleading, and a
// verdict of 'wrong' suppresses the finding outright. Every note is also
// embedded so it can inform similar findings on OTHER pleadings.

const VERDICTS = new Set(['agree', 'wrong', 'context']);

function initialsOf(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '??';
}

// ── GET: notes for a run ────────────────────────────────────────────
export async function GET(req: Request) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const redTeamId = searchParams.get('redTeamId');
  if (!redTeamId) return NextResponse.json({ comments: [] });

  // Notes are a lawyer's case analysis; gate them on the run, not just on login.
  const access = await canAccessRun(session.firmId, redTeamId, session.user.notionUserId, session.user.role ?? 'lawyer');
  if (!access.exists) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!access.allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const supabase = getServiceDbForFirm(session.firmId);
  const { data: rows } = await supabase
    .from('pleading_red_team_comments')
    .select('id, author_id, body, finding_index, finding_heading, verdict, created_at')
    .eq('red_team_id', redTeamId)
    .order('created_at', { ascending: true });

  const list = rows ?? [];
  const names = new Map<string, string>();
  const ids = [...new Set(list.map((r) => r.author_id))];
  if (ids.length) {
    const { data: team } = await supabase.from('team').select('person_id, name').in('person_id', ids);
    for (const t of team ?? []) names.set(t.person_id, t.name ?? t.person_id);
  }

  const comments = list.map((r) => {
    const authorName = names.get(r.author_id) ?? 'Unknown';
    return {
      id: r.id,
      findingIndex: r.finding_index ?? null,
      findingHeading: r.finding_heading ?? null,
      verdict: r.verdict ?? null,
      body: r.body,
      createdAt: r.created_at,
      authorId: r.author_id,
      authorName,
      authorInitials: initialsOf(authorName),
    };
  });
  return NextResponse.json({ comments });
}

// ── POST: add a per-finding note ────────────────────────────────────
export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const personId = session.user.notionUserId;

  const { redTeamId, body, findingIndex, findingHeading, verdict } = await req.json();
  if (!redTeamId || typeof body !== 'string' || !body.trim()) {
    return NextResponse.json({ error: 'redTeamId and a non-empty note are required' }, { status: 400 });
  }

  // A 'wrong' note suppresses that finding on every later run of the pleading,
  // so writing one is a privileged act — an unauthorized caller could otherwise
  // silence a real finding on someone else's draft.
  const access = await canAccessRun(session.firmId, redTeamId, personId, session.user.role ?? 'lawyer');
  if (!access.exists) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!access.allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const firmId = session.firmId;
  const supabase = getServiceDbForFirm(firmId);
  const { data, error } = await supabase
    .from('pleading_red_team_comments')
    .insert({
      red_team_id: redTeamId,
      author_id: personId,
      body: body.trim(),
      finding_index: typeof findingIndex === 'number' ? findingIndex : null,
      finding_heading: typeof findingHeading === 'string' ? findingHeading.slice(0, 500) : null,
      verdict: typeof verdict === 'string' && VERDICTS.has(verdict) ? verdict : null,
    })
    .select('id, author_id, body, finding_index, finding_heading, verdict, created_at')
    .single();
  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? 'Could not save the note' }, { status: 500 });
  }

  logAudit({
    firmId: session.firmId,
    entityType: 'PleadingRedTeam',
    entityId: String(redTeamId),
    action: 'commented',
    performedBy: personId,
    ipAddress: getClientIP(req),
  });

  // Embed the note so it can enrich semantically-relevant future runs on ANY
  // pleading, not just this one.
  after(async () => {
    try {
      const { data: run } = await supabase
        .from('pleading_red_teams').select('deliverable_id, matter_id, document_type').eq('id', redTeamId).maybeSingle();
      const heading = typeof findingHeading === 'string' ? findingHeading.trim() : '';
      const verdictLabel = data.verdict === 'wrong'
        ? 'A lawyer rejected this finding'
        : data.verdict === 'agree'
          ? 'A lawyer confirmed this finding'
          : 'Reviewer context';
      const embedText = heading
        ? `On a ${run?.document_type || 'pleading'}, finding: ${heading}\n\n${verdictLabel}: ${data.body}`
        : `${verdictLabel}: ${data.body}`;
      await generateEmbeddingsForEntity('red_team_note', String(data.id), run?.matter_id ?? null, embedText, {
        finding_index: data.finding_index ?? null,
        verdict: data.verdict ?? null,
        red_team_id: redTeamId,
        deliverable_id: run?.deliverable_id ?? null,
      }, firmId);
    } catch (e) {
      console.error('[red-team/comments] note embedding failed:', e instanceof Error ? e.message : e);
    }
  });

  const { data: me } = await supabase.from('team').select('name').eq('person_id', personId).maybeSingle();
  const authorName = me?.name ?? 'You';
  return NextResponse.json({
    comment: {
      id: data.id,
      findingIndex: data.finding_index ?? null,
      findingHeading: data.finding_heading ?? null,
      verdict: data.verdict ?? null,
      body: data.body,
      createdAt: data.created_at,
      authorId: personId,
      authorName,
      authorInitials: initialsOf(authorName),
    },
  });
}
