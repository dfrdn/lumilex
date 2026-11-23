import { getServiceDbForFirm } from '@/lib/tenancy/service-db';

export type LiaisonTaskStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';
export type LiaisonTaskPriority = 'low' | 'normal' | 'high';

export interface LiaisonTask {
  id: number;
  title: string;
  purpose: string;
  description: string;
  status: LiaisonTaskStatus;
  priority: LiaisonTaskPriority;
  zone_id: number | null;
  zone_name: string | null;
  /** Internal tariff — actual cost reimbursed to the liaison. */
  zone_round_trip_rate: number | null;
  /** External tariff — client-facing, markup-inclusive rate billed to the client. */
  zone_external_rate: number | null;
  scheduled_for: string | null;
  /**
   * The errand's effective deadline. Resolved from the linked deliverable's
   * external_due_date when a deliverable is linked. Null otherwise — there is
   * no manual "due date" input separate from the schedule.
   */
  due_date: string | null;
  completed_at: string | null;
  assigned_to: string;
  assigned_to_name: string;
  assigned_by: string;
  assigned_by_name: string;
  client_id: string | null;
  client_name: string;
  matter_id: string | null;
  matter_name: string;
  deliverable_id: string | null;
  deliverable_name: string;
  completion_note: string;
  /** Bill the client at the internal rate (no markup) for this errand. */
  bill_at_internal: boolean;
  created_at: string;
  updated_at: string;
}

interface RawRow {
  id: number;
  title: string;
  purpose: string;
  description: string;
  status: LiaisonTaskStatus;
  priority: LiaisonTaskPriority;
  zone_id: number | null;
  scheduled_for: string | null;
  due_date: string | null; // legacy column, no longer populated
  completed_at: string | null;
  assigned_to: string;
  assigned_to_name: string;
  assigned_by: string;
  assigned_by_name: string;
  client_id: string | null;
  client_name: string;
  matter_id: string | null;
  matter_name: string;
  deliverable_id: string | null;
  deliverable_name: string;
  completion_note: string;
  bill_at_internal: boolean;
  created_at: string;
  updated_at: string;
  transportation_zones: { id: number; name: string; round_trip_rate: number; external_rate: number } | null;
  deliverables: { external_due_date: string | null } | null;
}

function mapRow(row: RawRow): LiaisonTask {
  // The errand inherits its deadline from a linked deliverable's
  // external_due_date. Falls back to the legacy due_date column for rows
  // created before the rule changed.
  const effectiveDueDate = row.deliverables?.external_due_date ?? row.due_date ?? null;
  return {
    id: row.id,
    title: row.title,
    purpose: row.purpose ?? '',
    description: row.description ?? '',
    status: row.status,
    priority: row.priority,
    zone_id: row.zone_id,
    zone_name: row.transportation_zones?.name ?? null,
    zone_round_trip_rate: row.transportation_zones?.round_trip_rate ?? null,
    zone_external_rate: row.transportation_zones?.external_rate ?? null,
    scheduled_for: row.scheduled_for,
    due_date: effectiveDueDate,
    completed_at: row.completed_at,
    assigned_to: row.assigned_to,
    assigned_to_name: row.assigned_to_name ?? '',
    assigned_by: row.assigned_by,
    assigned_by_name: row.assigned_by_name ?? '',
    client_id: row.client_id ?? null,
    client_name: row.client_name ?? '',
    matter_id: row.matter_id,
    matter_name: row.matter_name ?? '',
    deliverable_id: row.deliverable_id ?? null,
    deliverable_name: row.deliverable_name ?? '',
    completion_note: row.completion_note ?? '',
    bill_at_internal: !!row.bill_at_internal,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

const SELECT_WITH_ZONE = `
  id, title, purpose, description, status, priority,
  zone_id, scheduled_for, due_date, completed_at,
  assigned_to, assigned_to_name, assigned_by, assigned_by_name,
  client_id, client_name, matter_id, matter_name,
  deliverable_id, deliverable_name,
  completion_note, bill_at_internal, created_at, updated_at,
  transportation_zones ( id, name, round_trip_rate, external_rate ),
  deliverables!liaison_tasks_deliverable_id_fkey ( external_due_date )
`;

export async function getAllLiaisonTasks(firmId: string): Promise<LiaisonTask[]> {
  const supabase = getServiceDbForFirm(firmId);
  const { data } = await supabase
    .from('liaison_tasks')
    .select(SELECT_WITH_ZONE)
    .order('scheduled_for', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false });
  return (data ?? []).map((r) => mapRow(r as unknown as RawRow));
}

export async function getLiaisonTasksForPerson(firmId: string, personId: string): Promise<LiaisonTask[]> {
  const supabase = getServiceDbForFirm(firmId);
  const { data } = await supabase
    .from('liaison_tasks')
    .select(SELECT_WITH_ZONE)
    .eq('assigned_to', personId)
    .order('scheduled_for', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false });
  return (data ?? []).map((r) => mapRow(r as unknown as RawRow));
}

/** The roles a liaison errand can be assigned to. */
export const LIAISON_ROLES = ['liaison_officer', 'chief_liaison_officer'] as const;

export async function getLiaisonOfficers(firmId: string): Promise<
  { person_id: string; name: string; role: string }[]
> {
  const supabase = getServiceDbForFirm(firmId);
  const { data } = await supabase
    .from('team')
    .select('person_id, name, role')
    .in('role', [...LIAISON_ROLES])
    .eq('active', true)
    .order('name');
  return (data ?? []) as { person_id: string; name: string; role: string }[];
}
