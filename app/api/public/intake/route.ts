import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { findFirmIdByHost } from '@/lib/firm/config';
import { createNotificationsBatch } from '@/lib/notifications';
import { getClientIP } from '@/lib/audit';

// ── Public intake endpoint ───────────────────────────────────────────
// Unauthenticated by design (excluded in proxy.ts). Defenses:
//   - strict zod validation per form kind
//   - honeypot field (bots fill it → pretend success, store nothing)
//   - per-IP in-memory throttle (best-effort on serverless) and a
//     per-email daily cap in the database
// Submissions land in intake_submissions (quarantine) — never directly
// in clients/client_intakes.

const trademarkDetails = z.object({
  markNames: z.array(z.string().trim().min(1).max(120)).min(1).max(5),
  goodsServices: z.string().trim().max(1000).default(''),
  inUse: z.enum(['yes', 'no']).default('no'),
  inUseSince: z.string().trim().max(40).optional(),
  ownerType: z.enum(['individual', 'corporation']).default('individual'),
});

const incorporationDetails = z.object({
  proposedNames: z.array(z.string().trim().min(1).max(160)).min(1).max(3),
  businessPurpose: z.string().trim().max(1000).default(''),
  authorizedCapital: z.string().trim().max(60).default(''),
  incorporators: z.string().trim().max(120).default(''),
  timeline: z.string().trim().max(120).default(''),
});

const baseSchema = z.object({
  kind: z.enum(['general', 'trademark', 'incorporation']),
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(160),
  phone: z.string().trim().max(40).default(''),
  company: z.string().trim().max(160).default(''),
  message: z.string().trim().max(4000).default(''),
  details: z.unknown().optional(),
  // Honeypot — humans never see it, bots fill it.
  website: z.string().max(0).optional().or(z.literal('')),
});

// Best-effort per-IP throttle. Serverless instances reset this, which is
// fine — the per-email DB cap below is the durable layer.
const ipHits = new Map<string, number[]>();
const IP_WINDOW_MS = 60 * 60 * 1000;
const IP_MAX_PER_WINDOW = 5;

function ipThrottled(ip: string): boolean {
  const now = Date.now();
  const hits = (ipHits.get(ip) ?? []).filter((t) => now - t < IP_WINDOW_MS);
  if (hits.length >= IP_MAX_PER_WINDOW) return true;
  hits.push(now);
  ipHits.set(ip, hits);
  return false;
}

export async function POST(req: NextRequest) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const parsed = baseSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Please check the highlighted fields and try again.' }, { status: 400 });
  }
  const body = parsed.data;

  // Honeypot tripped — acknowledge and discard.
  if (typeof (raw as Record<string, unknown>).website === 'string' && (raw as Record<string, unknown>).website !== '') {
    return NextResponse.json({ ok: true, reference: null });
  }

  // Kind-specific details validation.
  let details: Record<string, unknown> = {};
  if (body.kind === 'trademark') {
    const d = trademarkDetails.safeParse(body.details ?? {});
    if (!d.success) return NextResponse.json({ error: 'Please complete the trademark details.' }, { status: 400 });
    details = d.data;
  } else if (body.kind === 'incorporation') {
    const d = incorporationDetails.safeParse(body.details ?? {});
    if (!d.success) return NextResponse.json({ error: 'Please complete the incorporation details.' }, { status: 400 });
    details = d.data;
  }
  if (body.kind === 'general' && body.message.length < 10) {
    return NextResponse.json({ error: 'Please tell us a bit more about your concern.' }, { status: 400 });
  }

  const ip = getClientIP(req);
  if (ipThrottled(ip)) {
    return NextResponse.json(
      { error: 'Too many submissions from this connection. Please try again later.' },
      { status: 429 },
    );
  }

  // Unauthenticated endpoint: the request Host is the only tenancy signal, so
  // an unknown host is refused rather than defaulted into some firm's pipeline.
  const firmId = await findFirmIdByHost(req.headers.get('host') ?? '');
  if (!firmId) {
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 400 });
  }
  const supabase = getServiceDbForFirm(firmId);

  // Durable cap: 3 submissions per email per day.
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count } = await supabase
    .from('intake_submissions')
    .select('id', { count: 'exact', head: true })
    .eq('email', body.email.toLowerCase())
    .gte('created_at', dayAgo);
  if ((count ?? 0) >= 3) {
    return NextResponse.json(
      { error: 'We already have your recent inquiries on file — our team will be in touch.' },
      { status: 429 },
    );
  }

  const { data: row, error } = await supabase
    .from('intake_submissions')
    .insert({
      kind: body.kind,
      full_name: body.fullName,
      email: body.email.toLowerCase(),
      phone: body.phone,
      company: body.company,
      message: body.message,
      details,
      source_ip: ip,
      user_agent: req.headers.get('user-agent')?.slice(0, 300) ?? null,
    })
    .select('id')
    .single();

  if (error || !row) {
    console.error('[public-intake] Insert failed:', error?.message);
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
  }

  // Notify the prospect pipeline owners.
  notifyPartners(firmId, row.id, body.kind, body.fullName, body.company).catch((err) =>
    console.error('[public-intake] Notification failed:', err?.message ?? err),
  );

  return NextResponse.json({ ok: true, reference: row.id });
}

async function notifyPartners(
  firmId: string,
  submissionId: number,
  kind: string,
  fullName: string,
  company: string,
): Promise<void> {
  const supabase = getServiceDbForFirm(firmId);
  const { data: partners } = await supabase
    .from('team')
    .select('person_id')
    .in('role', ['partner', 'admin', 'super_user'])
    .eq('active', true);

  const kindLabel = kind === 'trademark' ? 'Trademark' : kind === 'incorporation' ? 'Incorporation' : 'General';

  await createNotificationsBatch(
    (partners ?? [])
      .filter((p) => p.person_id)
      .map((p) => ({
        person_id: p.person_id,
        type: 'intake' as const,
        title: `New ${kindLabel.toLowerCase()} inquiry`,
        body: `${fullName}${company ? ` (${company})` : ''} submitted the public intake form.`,
        href: '/dashboard/prospects/submissions',
        entity_id: String(submissionId),
      })),
    firmId,
  );
}
