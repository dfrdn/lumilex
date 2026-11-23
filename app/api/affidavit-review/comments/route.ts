import { NextResponse, after } from 'next/server';
import { getSession } from '@/lib/session';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { logAudit, getClientIP } from '@/lib/audit';
import { generateEmbeddingsForEntity } from '@/lib/ai/embeddings';

// Per-question reviewer notes. These are guidance for the AI — prior notes on
// an affidavit are fed back into succeeding reviews of that same affidavit.

function initialsOf(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '??';
}

// ── GET: notes for a review ─────────────────────────────────────────
export async function GET(req: Request) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const reviewId = searchParams.get('reviewId');
  if (!reviewId) return NextResponse.json({ comments: [] });

  const supabase = getServiceDbForFirm(session.firmId);
  const { data: rows } = await supabase
    .from('affidavit_review_comments')
    .select('id, author_id, body, q_no, created_at')
    .eq('review_id', reviewId)
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
      qNo: r.q_no ?? null,
      body: r.body,
      createdAt: r.created_at,
      authorId: r.author_id,
      authorName,
      authorInitials: initialsOf(authorName),
    };
  });
  return NextResponse.json({ comments });
}

// ── POST: add a per-question note ───────────────────────────────────
export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const personId = session.user.notionUserId;

  const { reviewId, body, qNo, question } = await req.json();
  if (!reviewId || typeof body !== 'string' || !body.trim()) {
    return NextResponse.json({ error: 'reviewId and a non-empty note are required' }, { status: 400 });
  }

  const firmId = session.firmId;
  const supabase = getServiceDbForFirm(firmId);
  const { data, error } = await supabase
    .from('affidavit_review_comments')
    .insert({
      review_id: reviewId,
      author_id: personId,
      body: body.trim(),
      q_no: typeof qNo === 'number' ? qNo : null,
      question: typeof question === 'string' ? question.slice(0, 500) : null,
    })
    .select('id, author_id, body, q_no, created_at')
    .single();
  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? 'Could not save note' }, { status: 500 });
  }

  logAudit({
    firmId: session.firmId,
    entityType: 'AffidavitReview',
    entityId: String(reviewId),
    action: 'commented',
    performedBy: personId,
    ipAddress: getClientIP(req),
  });

  // Embed the note so it can enrich semantically-relevant future reviews of
  // ANY affidavit (cross-affidavit learning), not just this one.
  after(async () => {
    try {
      const { data: rev } = await supabase
        .from('affidavit_reviews').select('deliverable_id, matter_id').eq('id', reviewId).maybeSingle();
      const qtext = typeof question === 'string' ? question.trim() : '';
      const embedText = qtext
        ? `Question: ${qtext}\n\nReviewer guidance: ${data.body}`
        : `Reviewer guidance: ${data.body}`;
      await generateEmbeddingsForEntity('affidavit_note', String(data.id), rev?.matter_id ?? null, embedText, {
        q_no: data.q_no ?? null,
        review_id: reviewId,
        deliverable_id: rev?.deliverable_id ?? null,
      }, firmId);
    } catch (e) {
      console.error('[affidavit-review/comments] note embedding failed:', e instanceof Error ? e.message : e);
    }
  });

  const { data: me } = await supabase.from('team').select('name').eq('person_id', personId).maybeSingle();
  const authorName = me?.name ?? 'You';
  return NextResponse.json({
    comment: {
      id: data.id,
      qNo: data.q_no ?? null,
      body: data.body,
      createdAt: data.created_at,
      authorId: personId,
      authorName,
      authorInitials: initialsOf(authorName),
    },
  });
}
