/**
 * The roles RLS lets read every matter of their firm: the role branch of
 * has_matter_access() (20260823_rls_firm_helpers.sql). Everyone else reads a
 * matter only from its team. Change both together.
 *
 * A list built on the service client asks this before it shows a matter the
 * viewer isn't staffed on, so it never lists one they couldn't open.
 */
export const MATTER_WIDE_ROLES: readonly string[] = [
  'partner',
  'admin',
  'super_user',
  'finance',
  'chief_liaison_officer',
  'liaison_officer',
];

export function readsEveryMatter(role: string | null | undefined): boolean {
  return !!role && MATTER_WIDE_ROLES.includes(role);
}
