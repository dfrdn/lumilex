import { getServiceDbForFirm } from '@/lib/tenancy/service-db';

/** A merged bundle expense as produced by fetch-billing-data (reimbursements +
 *  matter_expenses). `id` is the stable expense key revisions reference. */
export interface BundleExpense {
  id: string;
  date: string | null;
  category: string | null;
  expense: string | null;
  amount: number;
  matterName: string | null;
  source: 'reimbursement' | 'finance';
  /** Shown on the invoice but billed at ₱0 (goodwill) when the latest revision waives it. */
  waived?: boolean;
}

export interface ExpenseRevision {
  id: number;
  expenseKey: string;
  action: 'set' | 'exclude' | 'waive';
  amount: number | null;
  description: string | null;
  category: string | null;
  expenseDate: string | null;
  editedBy: string;
  editedAt: string;
}

/** Editable fields of an expense, shared by raw/effective views. */
export interface ExpenseView {
  date: string | null;
  category: string | null;
  expense: string | null;
  amount: number;
  matterName: string | null;
  /** True when the effective view comes from a 'waive' revision. */
  waived?: boolean;
}

/** One expense in a bundle with raw + latest revision + effective views, so the
 *  Review UI can render edits/exclusions and offer restore. */
export interface ExpenseEntry {
  key: string;
  source: 'reimbursement' | 'finance';
  raw: ExpenseView;
  revision: ExpenseRevision | null;
  effective: ExpenseView | null;
}

interface ExpenseRevisionRow {
  id: number;
  expense_key: string;
  action: 'set' | 'exclude' | 'waive';
  amount: number | null;
  description: string | null;
  category: string | null;
  expense_date: string | null;
  edited_by: string;
  edited_at: string;
}

/**
 * Latest revision per expense_key for a (billing_month, client_name) bundle.
 * Service-role read (mirrors effective-dtr) so generation paths with no JWT
 * still resolve edits.
 */
export async function getExpenseRevisions(firmId: string, 
  billingMonth: string,
  clientName: string,
): Promise<Map<string, ExpenseRevision>> {
  const supabase = getServiceDbForFirm(firmId);
  const { data, error } = await supabase
    .from('expense_revisions')
    .select('id, expense_key, action, amount, description, category, expense_date, edited_by, edited_at')
    .eq('billing_month', billingMonth)
    .eq('client_name', clientName);
  if (error) throw error;

  const latest = new Map<string, ExpenseRevision>();
  for (const r of (data ?? []) as ExpenseRevisionRow[]) {
    const prev = latest.get(r.expense_key);
    if (!prev || r.edited_at > prev.editedAt) {
      latest.set(r.expense_key, {
        id: r.id,
        expenseKey: r.expense_key,
        action: r.action,
        amount: r.amount == null ? null : Number(r.amount),
        description: r.description,
        category: r.category,
        expenseDate: r.expense_date,
        editedBy: r.edited_by,
        editedAt: r.edited_at,
      });
    }
  }
  return latest;
}

/**
 * Layer the latest revisions over the raw merged expenses. Returns the effective
 * list (excluded dropped, 'set' fields patched over raw) for billing/preview,
 * plus per-expense entries (raw + revision + effective) for the Review UI.
 */
export function applyExpenseRevisions(
  raw: BundleExpense[],
  revisions: Map<string, ExpenseRevision>,
): { effective: BundleExpense[]; entries: ExpenseEntry[] } {
  const entries: ExpenseEntry[] = [];
  const effective: BundleExpense[] = [];

  for (const e of raw) {
    const rev = revisions.get(e.id) ?? null;
    const rawView: ExpenseView = {
      date: e.date,
      category: e.category,
      expense: e.expense,
      amount: e.amount,
      matterName: e.matterName,
    };

    let eff: ExpenseView | null = rawView;
    if (rev) {
      eff = rev.action === 'exclude'
        ? null
        : {
            date: rev.expenseDate ?? e.date,
            category: rev.category ?? e.category,
            expense: rev.description ?? e.expense,
            amount: rev.amount ?? e.amount,
            matterName: e.matterName,
            waived: rev.action === 'waive',
          };
    }

    entries.push({ key: e.id, source: e.source, raw: rawView, revision: rev, effective: eff });
    if (eff) effective.push({ id: e.id, source: e.source, ...eff });
  }

  return { effective, entries };
}
