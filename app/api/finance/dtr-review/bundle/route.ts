import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { isManagingPartner } from '@/lib/auth/isManagingPartner';
import { getRelationshipPartner } from '@/lib/auth/relationship-partner';
import { getDTRBundleEntries } from '@/lib/queries/effective-dtr';
import { computeBundleFees, type MatterBillingConfig } from '@/lib/billing/compute-bundle-fees';
import { fetchBillingData } from '@/lib/billing/fetch-billing-data';
import { resolveLawyerPositions } from '@/lib/billing/lawyer-positions';
import { parseAdHocFeeLines } from '@/lib/billing/derive-fee-lines';
import { normalizeLetterDate } from '@/lib/billing/letter-format';
import { loadClientProfile, type ClientBillingProfile } from '@/lib/billing/client-profile';
import { loadClientChoices } from '@/lib/billing/wording-store';

interface ReviewRow {
  id: number;
  status: 'pending' | 'approved' | 'rejected';
  clearance_status: 'cleared' | 'declined' | null;
  clearance_notes: string;
  cleared_by: string | null;
  cleared_at: string | null;
  clearance_override_by: string | null;
  clearance_override_at: string | null;
  clearance_override_reason: string | null;
  notes: string;
  submitted_by: string | null;
  submitted_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  invoice_settings_override: Record<string, unknown> | null;
  invoice_gen_invoice_id: number | null;
  invoice_gen_invoice_number: string | null;
}

/** The client profile as the override panel's string defaults ('true' / 'false' for switches). */
function profileDefaults(p: ClientBillingProfile): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(p)) {
    out[k] = typeof v === 'boolean' ? String(v) : v;
  }
  return out;
}

interface CommentRow {
  id: number;
  revision_id: number;
  author_id: string;
  author_role: string;
  body: string;
  created_at: string;
  resolved: boolean;
  resolved_at: string | null;
  resolved_by: string | null;
}

/**
 * GET /api/finance/dtr-review/bundle?month=YYYY-MM&client=NAME
 * Returns the full bundle: per-row diff (raw, latest revision, effective),
 * the bundle's review status, and any line-level comments grouped by revision.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const role = session.user.role;
  const isMP = await isManagingPartner(session.user.notionUserId, session.firmId);
  if (role !== 'finance' && role !== 'super_user' && role !== 'partner' && !isMP) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const month = req.nextUrl.searchParams.get('month');
  const clientName = req.nextUrl.searchParams.get('client');
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: 'month must be YYYY-MM' }, { status: 400 });
  }
  if (!clientName) {
    return NextResponse.json({ error: 'client is required' }, { status: 400 });
  }

  const supabase = await getSupabaseServerAuthClient();

  // Pull bundle entries + review row + comments in parallel.
  const [entries, reviewRes, commentsRes] = await Promise.all([
    getDTRBundleEntries(session.firmId, { billingMonth: month, clientNames: [clientName] }),
    supabase
      .from('dtr_revision_reviews')
      .select('id, status, clearance_status, clearance_notes, cleared_by, cleared_at, clearance_override_by, clearance_override_at, clearance_override_reason, notes, submitted_by, submitted_at, reviewed_by, reviewed_at, invoice_settings_override, invoice_gen_invoice_id, invoice_gen_invoice_number')
      .eq('billing_month', month)
      .eq('client_name', clientName)
      .maybeSingle(),
    supabase
      .from('dtr_revision_comments')
      .select('id, revision_id, author_id, author_role, body, created_at, resolved, resolved_at, resolved_by')
      .order('created_at', { ascending: true }),
  ]);

  if (reviewRes.error) {
    return NextResponse.json({ error: reviewRes.error.message }, { status: 500 });
  }
  if (commentsRes.error) {
    return NextResponse.json({ error: commentsRes.error.message }, { status: 500 });
  }

  // Filter comments to only those on revisions in this bundle.
  const revisionIdsInBundle = new Set(
    entries.map((e) => e.revision?.id).filter((id): id is number => id != null),
  );
  const comments = ((commentsRes.data ?? []) as CommentRow[])
    .filter((c) => revisionIdsInBundle.has(c.revision_id))
    .map((c) => ({
      id: c.id,
      revisionId: c.revision_id,
      authorId: c.author_id,
      authorRole: c.author_role,
      body: c.body,
      createdAt: c.created_at,
      resolved: c.resolved,
      resolvedAt: c.resolved_at,
      resolvedBy: c.resolved_by,
    }));

  const review = (reviewRes.data ?? null) as ReviewRow | null;

  // Relationship partner (service-role: this is an authorization fact, and
  // `team`/`clients` RLS is scoped per-viewer). `active: false` means the
  // assignment is stale — billing is blocked until the client is reassigned.
  const relationshipPartner = await getRelationshipPartner(clientName, session.firmId);

  // ── Compute total legal fees (effective + raw, for review-side comparison) ──
  const effectiveSnapshots = entries.map((e) => e.effective).filter((s): s is NonNullable<typeof s> => !!s);
  const rawSnapshots = entries.map((e) => e.raw).filter((s): s is NonNullable<typeof s> => !!s);

  // Include the client's matters that have a non-DTR billing arrangement
  // (fixed_retainer, fixed_fee, etc.) — otherwise a Meralco-style bundle with
  // zero DTR entries shows TOTAL LEGAL FEES = ₱0.00 because configsByMatter
  // ends up empty and resolveBundleRetainerParams can't see the retainer.
  const { data: clientMatterRows } = await supabase
    .from('matters')
    .select('notion_id')
    .eq('client_name', clientName);
  const clientMatterIds = (clientMatterRows ?? []).map((m: { notion_id: string }) => m.notion_id);

  const matterIds = [
    ...new Set([
      ...[...effectiveSnapshots, ...rawSnapshots]
        .map((s) => s.matterId)
        .filter((id): id is string => !!id),
      ...clientMatterIds,
    ]),
  ];
  // Include with_names meeting attendees: computeBundleFees fans out to every
  // attendee and bills each at their own position rate, so their positions must
  // be in the lookup — otherwise they fall back to the Junior Associate rate and
  // the review under-counts vs the actual generated invoice.
  // resolveLawyerPositions also prices a renamed author off their stable
  // person id — the same resolver the invoice path uses.
  const [ratesRes, configsRes, lawyers] = await Promise.all([
    supabase.from('billing_rates').select('position, hourly_rate'),
    matterIds.length > 0
      ? supabase
          .from('matter_billing_configs')
          .select('matter_id, billing_type, retainer_hours_cap, hourly_rate_override, monthly_retainer, engagement_date, billing_settings')
          .in('matter_id', matterIds)
          .order('matter_id', { ascending: true })
      : Promise.resolve({ data: [] as (MatterBillingConfig & { billing_settings?: Record<string, unknown> })[], error: null }),
    resolveLawyerPositions(supabase, session.firmId, [...effectiveSnapshots, ...rawSnapshots]),
  ]);

  const ratesByPosition: Record<string, number> = {};
  for (const r of (ratesRes.data ?? []) as { position: string; hourly_rate: number | string }[]) {
    const v = Number(r.hourly_rate);
    ratesByPosition[r.position] = isNaN(v) ? 0 : v;
  }

  const configsByMatter = new Map<string, MatterBillingConfig & { billing_settings?: Record<string, unknown> }>();
  for (const c of (configsRes.data ?? []) as (MatterBillingConfig & { billing_settings?: Record<string, unknown> })[]) {
    configsByMatter.set(c.matter_id, c);
  }

  const { positionByLawyerName } = lawyers;

  const fees = computeBundleFees({
    snapshots: effectiveSnapshots,
    configsByMatter,
    ratesByPosition,
    positionByLawyerName,
  });
  const rawFees = computeBundleFees({
    snapshots: rawSnapshots,
    configsByMatter,
    ratesByPosition,
    positionByLawyerName,
  });

  // Pull the same data persistInvoice will see when it generates this client's
  // invoice. Surfaces acceptance fees, fixed fees, action aggregates,
  // milestones, expenses, and outstanding balance / advance deposit credits —
  // so the review page shows a true preview of the upcoming invoice, not just
  // the DTR breakdown. Also includes the per-matter action + milestone
  // contexts so finance can log actions / mark milestones inline from the
  // bundle page. Errors are logged but don't fail the bundle GET.
  let invoicePreview = null;
  let actionContexts: unknown[] = [];
  let milestoneContexts: unknown[] = [];
  try {
    const data = await fetchBillingData(supabase, session.firmId, clientName, month);

    // Ad-hoc items staged on this bundle's override flow into the preview so the
    // reviewer sees them in the total before generating (generateBundleInvoice
    // applies the same items at persist time).
    const adHocFeeLines = parseAdHocFeeLines(review?.invoice_settings_override);
    const adHocTotal = Math.round(adHocFeeLines.reduce((s, f) => s + f.amount, 0) * 100) / 100;

    // Effective "settle from advance deposit" — ON by default; the matter config
    // opts out with 'false', and the per-bundle override wins over both. Mirrors
    // resolveBundleSettings so the preview matches what generation will do.
    const baseSettings = ((configsByMatter.values().next()?.value as
      | { billing_settings?: Record<string, unknown> }
      | undefined)?.billing_settings ?? {}) as Record<string, unknown>;
    const override = (review?.invoice_settings_override ?? {}) as Record<string, unknown>;
    const effectiveSettle = override.settleFromDeposit != null
      ? override.settleFromDeposit === 'true' || override.settleFromDeposit === true
      : baseSettings.settleFromDeposit == null
        ? true
        : baseSettings.settleFromDeposit === 'true' || baseSettings.settleFromDeposit === true;

    invoicePreview = {
      feeLines: [...data.feeLines, ...adHocFeeLines],
      expenses: data.expenses,
      expenseEntries: data.expenseEntries,
      totalHours: data.totalHours,
      totalFees: Math.round((data.totalFees + adHocTotal) * 100) / 100,
      totalExpenses: data.totalExpenses,
      grandTotal: Math.round((data.grandTotal + adHocTotal) * 100) / 100,
      clientReceivables: data.clientReceivables,
      clientReceivablesUpdatedAt: data.clientReceivablesUpdatedAt,
      clientDepositOnHand: data.clientDepositOnHand,
      settleFromDeposit: effectiveSettle,
    };
    actionContexts = data.actionContexts;
    milestoneContexts = data.milestoneContexts;
  } catch (err) {
    console.warn('[bundle] invoicePreview fetch failed:', err instanceof Error ? err.message : err);
  }

  // The letter's baseline comes from the client's billing profile; the override
  // panel shows it as each field's default and lists finance's paragraphs.
  const [{ profile: clientProfile }, choices] = await Promise.all([
    loadClientProfile(supabase, clientName),
    loadClientChoices(supabase),
  ]);

  return NextResponse.json({
    billingMonth: month,
    clientName,
    entries,
    // Who must clear this bundle before an invoice is generated. `null` means
    // the client has no relationship partner yet — billing is blocked until one
    // is assigned in Client Management.
    relationshipPartner,
    review: review
      ? {
          id: review.id,
          status: review.status,
          clearanceStatus: review.clearance_status ?? null,
          clearanceNotes: review.clearance_notes ?? '',
          clearedBy: review.cleared_by ?? null,
          clearedAt: review.cleared_at ?? null,
          // Set only when the managing partner cleared in place of the
          // relationship partner — the UI must say so rather than crediting the
          // sign-off to someone who never gave it.
          clearanceOverrideBy: review.clearance_override_by ?? null,
          clearanceOverrideAt: review.clearance_override_at ?? null,
          clearanceOverrideReason: review.clearance_override_reason ?? null,
          notes: review.notes,
          submittedBy: review.submitted_by,
          submittedAt: review.submitted_at,
          reviewedBy: review.reviewed_by,
          reviewedAt: review.reviewed_at,
          invoiceSettingsOverride: review.invoice_settings_override ?? null,
          invoiceGenInvoiceId: review.invoice_gen_invoice_id ?? null,
          invoiceGenInvoiceNumber: review.invoice_gen_invoice_number ?? null,
        }
      : null,
    // Matter-level settings the auto-generated invoice will use as the
    // baseline. Surfaced read-only so reviewers can see what'll be plugged
    // into the billing letter (signer, attn, bank, discount, etc.).
    matterDefaults: (() => {
      const baseConfig = (configsByMatter.values().next()?.value ?? null) as
        | (MatterBillingConfig & { billing_settings?: Record<string, unknown> })
        | null;
      if (!baseConfig) return null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bc = baseConfig as any;
      const savedSettings = (baseConfig.billing_settings ?? {}) as Record<string, unknown>;
      return {
        billingType: baseConfig.billing_type ?? null,
        monthlyRetainer: baseConfig.monthly_retainer ?? null,
        retainerHoursCap: baseConfig.retainer_hours_cap ?? null,
        hourlyRateOverride: baseConfig.hourly_rate_override ?? null,
        // Merge the matter-config columns into `settings` so the per-invoice
        // override panel can surface every field's default (engagement date +
        // retainer figures live in columns, not billing_settings).
        settings: {
          ...savedSettings,
          ...profileDefaults(clientProfile),
          engagementDate: normalizeLetterDate(bc.engagement_date ?? savedSettings.engagementDate ?? ''),
          retainerCap: baseConfig.monthly_retainer != null ? String(baseConfig.monthly_retainer) : (savedSettings.retainerCap ?? ''),
          retainerHoursCap: baseConfig.retainer_hours_cap != null ? String(baseConfig.retainer_hours_cap) : (savedSettings.retainerHoursCap ?? ''),
          monthlyRetainer: baseConfig.monthly_retainer != null ? String(baseConfig.monthly_retainer) : (savedSettings.monthlyRetainer ?? ''),
        },
      };
    })(),
    letterParagraphs: choices.map((c) => ({ ...c, archived: false })),
    comments,
    fees,
    rawFees,
    invoicePreview,
    actionContexts,
    milestoneContexts,
  });
}
