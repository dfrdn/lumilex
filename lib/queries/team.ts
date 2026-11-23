import { getServiceDbForFirm } from '@/lib/tenancy/service-db';

export type UserRole =
  | 'super_user'
  | 'partner'
  | 'lawyer'
  | 'admin'
  | 'finance'
  | 'liaison_officer'
  | 'chief_liaison_officer';

export function isLiaisonRole(role: UserRole | string | null | undefined): boolean {
  return role === 'liaison_officer' || role === 'chief_liaison_officer';
}

export function canAssignLiaisonTasks(role: UserRole | string | null | undefined): boolean {
  return role === 'chief_liaison_officer' || role === 'super_user';
}

export function canViewLiaisonSchedule(role: UserRole | string | null | undefined): boolean {
  return (
    role === 'chief_liaison_officer' ||
    role === 'admin' ||
    role === 'partner' ||
    role === 'finance' ||
    role === 'super_user'
  );
}

/**
 * Look up a user's role from the team table in Supabase.
 */
export async function getUserRole(firmId: string, notionUserId: string): Promise<UserRole> {
  try {
    const supabase = getServiceDbForFirm(firmId);
    const { data, error } = await supabase
      .from('team')
      .select('role')
      .eq('person_id', notionUserId)
      .eq('active', true)
      .limit(1)
      .single();

    if (error || !data) return 'lawyer';
    return (data.role as UserRole) ?? 'lawyer';
  } catch {
    return 'lawyer';
  }
}
