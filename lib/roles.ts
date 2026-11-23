/**
 * Every role a team member can hold — the set Admin › Users may assign.
 * `team.role` has no CHECK constraint, so this list is what keeps a typo out
 * of it. Client-safe. See CLAUDE.md → RBAC for what each role may do.
 */
export const USER_ROLES = [
  'super_user',
  'partner',
  'lawyer',
  'admin',
  'finance',
  'chief_liaison_officer',
  'liaison_officer',
] as const;

export type UserRole = (typeof USER_ROLES)[number];

export function isUserRole(value: unknown): value is UserRole {
  return typeof value === 'string' && (USER_ROLES as readonly string[]).includes(value);
}
