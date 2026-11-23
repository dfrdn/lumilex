import { NextRequest, NextResponse } from 'next/server';
import { forEachActiveFirm } from '@/lib/tenancy/fan-out';
import { monthIndex } from '@/lib/finance/format';

/**
 * Cron: materialize due recurring firm-expense templates into firm_expenses rows.
 * Safe to run daily. Service-role per CLAUDE.md's cron rule (no JWT → current_role()
 * is NULL → the authed client would see no rows).
 *
 * A template fires in a given month when: it's active, today is within
 * [start_date, end_date], today's day-of-month has reached `day_of_month`, and
 * the month is on the template's cadence schedule **anchored to start_date**
 * (monthly=1, quarterly=3, annual=12 months after the start month). Anchoring to
 * start_date (rather than the last fire) keeps quarterly/annual schedules on
 * fixed calendar months even if a run is missed.
 *
 * Idempotency is enforced two ways: `last_generated_month` skips same-month
 * re-runs, and a unique index on (recurring_template_id, materialized_month) with
 * an ignore-duplicates upsert guarantees a crash between the insert and the stamp
 * can never produce a duplicate expense.
 */
const CADENCE_MONTHS: Record<string, number> = { monthly: 1, quarterly: 3, annual: 12 };

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }); // YYYY-MM-DD
  const currentMonth = today.slice(0, 7); // YYYY-MM
  const todayDay = parseInt(today.slice(8, 10), 10);

  const results = await forEachActiveFirm(async ({ db }) => {
    const { data: templates, error } = await db
      .from('firm_expense_templates')
      .select('*')
      .eq('active', true);
    if (error) throw new Error(error.message);

    let generated = 0;
    const created: number[] = [];

    for (const t of templates ?? []) {
      if (t.start_date && t.start_date > today) continue;
      if (t.end_date && t.end_date < today) continue;
      if (todayDay < (t.day_of_month ?? 1)) continue;
      if (t.last_generated_month === currentMonth) continue; // already done this month

      // On-schedule check anchored to the start month.
      const interval = CADENCE_MONTHS[t.cadence as string] ?? 1;
      const monthsSinceStart = monthIndex(currentMonth) - monthIndex(t.start_date as string);
      if (monthsSinceStart < 0 || monthsSinceStart % interval !== 0) continue;

      const day = String(Math.min(t.day_of_month ?? 1, 28)).padStart(2, '0');
      const expenseDate = `${currentMonth}-${day}`;

      // Idempotent insert: the unique (firm_id, recurring_template_id,
      // materialized_month) index + ignoreDuplicates makes a re-run after a
      // crash a no-op.
      const { data: rows, error: insErr } = await db
        .from('firm_expenses')
        .upsert(
          {
            expense_date: expenseDate,
            category: t.category,
            amount: t.amount,
            vendor: t.vendor ?? '',
            description: t.description ?? '',
            payment_method: t.payment_method ?? '',
            notes: 'Auto-generated from recurring template',
            recurring_template_id: t.id,
            materialized_month: currentMonth,
            recorded_by: t.recorded_by ?? 'system',
          },
          { onConflict: 'recurring_template_id,materialized_month', ignoreDuplicates: true },
        )
        .select('id');

      if (insErr) {
        console.error('[firm-expense-recurring] insert failed for template', t.id, insErr.message);
        continue;
      }

      await db
        .from('firm_expense_templates')
        .update({ last_generated_month: currentMonth })
        .eq('id', t.id);

      if (rows && rows.length > 0) {
        generated += 1;
        created.push(rows[0].id);
      }
    }

    return { generated, created };
  });

  return NextResponse.json({ ok: true, month: currentMonth, firms: results });
}
