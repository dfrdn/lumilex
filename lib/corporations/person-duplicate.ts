/**
 * The message for a refused twin — `corporation_persons_current_role_unique`
 * allows one current row per (company, role, position, person).
 */
export function duplicatePersonMessage(body: Record<string, unknown>): string {
  const str = (k: string) => (typeof body[k] === 'string' ? (body[k] as string).trim() : '');
  const name = (body.isJuridical ? str('entityName') : [str('firstName'), str('lastName')].filter(Boolean).join(' ')) || 'This person';
  const role = str('positionTitle') || str('role') || 'that role';
  return `${name} is already listed as ${role} for this company.`;
}
