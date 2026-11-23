import type { TrademarkOfficeAction, TrademarkStatus } from '@/types/notion';

/**
 * Office Action rounds. An applicant may respond again after any refusal the
 * examiner hasn't called final (Rule 608), so a mark carries as many rounds
 * as the examination takes; one is open until its response — or, for a final
 * rejection, the appeal or compliance — is filed.
 */

export const isOaOpen = (oa: Pick<TrademarkOfficeAction, 'responseFiledDate'>) => !oa.responseFiledDate;

/** The rounds still waiting on a response, oldest first. */
export function openOfficeActions<T extends Pick<TrademarkOfficeAction, 'responseFiledDate'>>(oas: T[]): T[] {
  return oas.filter(isOaOpen);
}

/**
 * The status a filed, unregistered mark sits in. One rule, applied wherever
 * a round opens or closes, so the stored status — which the Registry's Office
 * Actions count, the subjects mirror and the portal read — never disagrees
 * with the deadlines.
 */
export function prosecutionStatusFor(oas: Pick<TrademarkOfficeAction, 'responseFiledDate'>[]): TrademarkStatus {
  return openOfficeActions(oas).length > 0 ? 'Pending - OA' : 'Pending';
}

/**
 * What a round is called on the page: "Office Action", numbered once there
 * is more than one ("Office Action 2"), or "Final rejection". The title IPOPHL
 * gave it, when recorded, goes beside the name rather than replacing it.
 */
export function officeActionName(oas: TrademarkOfficeAction[], oa: TrademarkOfficeAction): string {
  if (oa.kind === 'final_rejection') return 'Final rejection';
  const name = oa.kind === 'provisional_refusal' ? 'Provisional refusal' : 'Office Action';
  const same = oas.filter((o) => o.kind === oa.kind);
  if (same.length <= 1) return name;
  return `${name} ${same.findIndex((o) => o.id === oa.id) + 1}`;
}

/** What answering the round is called: a response, or an appeal or compliance for a final rejection (Rule 609). */
export function responseName(oa: Pick<TrademarkOfficeAction, 'kind'>): string {
  return oa.kind === 'final_rejection' ? 'Appeal or compliance' : 'Response';
}
