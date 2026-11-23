// Allowlist for the custom report builder.
//
// This is the security boundary for /api/reports/run. Default-deny — any
// column or operator not listed here is rejected. RLS on the underlying
// tables is the secondary line of defense.
//
// Audit before adding sensitive columns:
//   ✗ team.monthly_salary, team.auth_user_id
//   ✗ user_passwords (frozen)

export type Entity = 'matters' | 'deliverables' | 'dtr' | 'invoices';

export type FilterOp = 'eq' | 'in' | 'gte' | 'lte';
// NOTE: 'ilike' deliberately omitted for MVP — unindexed wildcards can
// table-scan multi-million-row tables. Add later with anchoring + length cap.

export interface EntitySpec {
  /** Columns that can appear in `columns` (SELECT). */
  selectableColumns: Set<string>;
  /** Columns that can be filtered, with the operators each supports. */
  filterableColumns: Record<string, FilterOp[]>;
  /** Columns that are safe to GROUP BY. */
  groupByColumns: Set<string>;
  /** Human-readable column labels for the UI. */
  labels: Record<string, string>;
}

export const ALLOWLIST: Record<Entity, EntitySpec> = {
  matters: {
    selectableColumns: new Set([
      'notion_id',
      'name',
      'matter_code',
      'client_name',
      'type',
      'status',
      'outcome',
      'court',
      'case_number',
      'is_case',
      'date',
      'created_time',
    ]),
    filterableColumns: {
      type: ['eq', 'in'],
      status: ['eq', 'in'],
      outcome: ['eq', 'in'],
      client_name: ['eq', 'in'],
      court: ['eq'],
      is_case: ['eq'],
      date: ['gte', 'lte'],
      created_time: ['gte', 'lte'],
    },
    groupByColumns: new Set(['type', 'status', 'outcome', 'client_name', 'court']),
    labels: {
      notion_id: 'Matter ID',
      name: 'Matter',
      matter_code: 'Code',
      client_name: 'Client',
      type: 'Type',
      status: 'Status',
      outcome: 'Outcome',
      court: 'Court',
      case_number: 'Case No.',
      is_case: 'Is Case',
      date: 'Date',
      created_time: 'Created',
    },
  },
  deliverables: {
    selectableColumns: new Set([
      'notion_id',
      'name',
      'matter_id',
      'matter_name',
      'client_name',
      'type',
      'status',
      'priority',
      'external_due_date',
      'date_done',
      'revision_count',
      'created_time',
      'notion_last_edited_at',
    ]),
    filterableColumns: {
      type: ['eq', 'in'],
      status: ['eq', 'in'],
      priority: ['eq', 'in'],
      matter_id: ['eq', 'in'],
      client_name: ['eq', 'in'],
      external_due_date: ['gte', 'lte'],
      date_done: ['gte', 'lte'],
      created_time: ['gte', 'lte'],
    },
    groupByColumns: new Set(['type', 'status', 'priority', 'client_name', 'matter_id']),
    labels: {
      notion_id: 'Deliverable ID',
      name: 'Deliverable',
      matter_id: 'Matter ID',
      matter_name: 'Matter',
      client_name: 'Client',
      type: 'Type',
      status: 'Status',
      priority: 'Priority',
      external_due_date: 'Due',
      date_done: 'Done',
      revision_count: 'Revisions',
      created_time: 'Created',
      notion_last_edited_at: 'Last edited',
    },
  },
  dtr: {
    selectableColumns: new Set([
      'notion_id',
      'lawyer_name',
      'client_name',
      'matter_id',
      'date',
      'hours',
      'minutes',
      'task',
      'remarks',
      'billed',
      'non_billable',
      'created_time',
    ]),
    filterableColumns: {
      lawyer_name: ['eq', 'in'],
      client_name: ['eq', 'in'],
      matter_id: ['eq', 'in'],
      date: ['gte', 'lte'],
      billed: ['eq'],
      non_billable: ['eq'],
    },
    groupByColumns: new Set(['lawyer_name', 'client_name', 'matter_id', 'billed']),
    labels: {
      notion_id: 'DTR ID',
      lawyer_name: 'Lawyer',
      client_name: 'Client',
      matter_id: 'Matter ID',
      date: 'Date',
      hours: 'Hours',
      minutes: 'Minutes',
      task: 'Task',
      remarks: 'Remarks',
      billed: 'Billed',
      non_billable: 'Non-billable',
      created_time: 'Created',
    },
  },
  invoices: {
    selectableColumns: new Set([
      'id',
      'client_name',
      'matter_id',
      'matter_name',
      'billing_month',
      'total_hours',
      'total_amount',
      'total_expenses',
      'status',
      'created_at',
    ]),
    filterableColumns: {
      client_name: ['eq', 'in'],
      matter_id: ['eq', 'in'],
      billing_month: ['eq', 'gte', 'lte'],
      status: ['eq', 'in'],
      created_at: ['gte', 'lte'],
    },
    groupByColumns: new Set(['client_name', 'status', 'billing_month']),
    labels: {
      id: 'Invoice ID',
      client_name: 'Client',
      matter_id: 'Matter ID',
      matter_name: 'Matter',
      billing_month: 'Month',
      total_hours: 'Hours',
      total_amount: 'Amount',
      total_expenses: 'Expenses',
      status: 'Status',
      created_at: 'Created',
    },
  },
};

export const ENTITY_LABELS: Record<Entity, string> = {
  matters: 'Matters',
  deliverables: 'Deliverables',
  dtr: 'Time Entries (DTR)',
  invoices: 'Invoices',
};

export function isEntity(s: unknown): s is Entity {
  return typeof s === 'string' && s in ALLOWLIST;
}
