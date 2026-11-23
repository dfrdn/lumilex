import type { ExtensionDecision, Trademark } from '@/types/notion';
import type { Health } from '@/lib/corporations/status';
import { DUE_SOON_DAYS, shortDate } from '@/lib/corporations/status';
import { addDays } from '@/lib/dates';
import {
  dau3Owed,
  dau5Window,
  designationStart,
  isAbroad,
  isDesignation,
  issuanceFeeDeadline,
  noiDeadline,
  oaResponseOwed,
  oppositionPeriod,
  owesFirstPublicationFee,
  refusalPeriodEnds,
  renewalDau5Window,
  renewalDauWindow,
  renewalWindow,
  revivalDeadline,
  upcomingDeadlines,
  type DeadlineEntry,
  type DeadlineWindow,
} from '@/lib/trademark-deadlines';
import { ISSUANCE_PAID, actionForDeadline, extensionDecisionSpecs, type ActionSpec } from '@/lib/trademarks/actions';
import { officeActionName, openOfficeActions } from '@/lib/trademarks/office-actions';
import { countryName } from '@/lib/trademarks/countries';

/** Where a filed extension stands, said on the next step. */
export function extensionNote(decision: ExtensionDecision | null, decidedOn: string | null): string {
  if (decision === 'granted') return `IPOPHL granted the extension${decidedOn ? ` (order dated ${shortDate(decidedOn)})` : ''}.`;
  if (decision === 'denied') return `IPOPHL denied the extension${decidedOn ? ` (order dated ${shortDate(decidedOn)})` : ''}, so the original period applies.`;
  return 'An extension (MOTEX) has been filed; IPOPHL’s decision is awaited.';
}

/**
 * A mark's journey in the shape a company's page shows it: where it is
 * (phases), how each track of work stands (cards), and the one thing to do
 * next. Pure — the page renders it, the tests pin it.
 */

export type JourneyTarget = 'progress' | 'upkeep';

export interface JourneyStep {
  key: 'filing' | 'examination' | 'registration' | 'upkeep';
  label: string;
  sub: string;
  state: 'done' | 'current' | 'upcoming';
  warn: boolean;
  target: JourneyTarget;
}

export interface JourneyTrack {
  key: JourneyTarget;
  label: string;
  health: Health;
  done: number;
  total: number;
  summary: string;
  next: string;
  stateLabel?: string;
}

export interface NextStep {
  title: string;
  body: string | null;
  due: DeadlineWindow | null;
  actions: ActionSpec[];
  /** The registration date the COR prompt starts from, when it can be worked out (Rule 703). */
  expectedRegDate?: string | null;
  /** A date the page records directly (no workflow action behind it). */
  recordDate?: { field: 'regDate' | ManualDueField; label: string; dateLabel: string };
  /** Anything else owed within the month, after the step above. */
  alsoOwed: DeadlineEntry[];
  tone: 'overdue' | 'soon' | 'clear' | 'default' | 'inactive';
}

const isRegistered = (tm: Trademark) => tm.status === 'Registered' || !!tm.regDate;

/** What a deadline is called on the page: a hand-entered filing by its own name. */
export const entryName = (d: Pick<DeadlineEntry, 'label' | 'title'>) => d.title ?? d.label;

/** The next thing IPOPHL sends: an Office Action (or final rejection), recorded with its mailing and received dates. */
const NEW_OA: ActionSpec = { action: 'oa_received', label: 'New Office Action', dateMode: 'notice' };
/** What IPOPHL sends about a designation: a refusal, provisional or final, with its response date stated on it. */
const NEW_REFUSAL: ActionSpec = {
  action: 'oa_received', label: 'Provisional refusal received', dateMode: 'notice',
  roundKinds: ['provisional_refusal', 'final_rejection'], respondByRequired: true,
};
/** IPOPHL's statement of grant of protection — a designation's registration in the Philippines. */
const PROTECTION_GRANTED: ActionSpec = { action: 'protection_granted', label: 'Protection granted', dateMode: 'notice' };
const ABANDONMENT_NOTICE: ActionSpec = { action: 'abandonment_notice', label: 'Notice of abandonment', dateMode: 'notice' };
const ALLOWANCE: ActionSpec = { action: 'noi_received', label: 'Notice of Allowance received', dateMode: 'notice' };
const ISSUANCE_NOTICE: ActionSpec = { action: 'issuance_received', label: 'Notice of Issuance received', dateMode: 'notice' };
/** Paying the issuance and 2nd publication fees before the Notice of Issuance, to have the COR sooner. */
const PAID_IN_ADVANCE: ActionSpec = { ...ISSUANCE_PAID, label: 'Issuance fees paid in advance', primary: false };

/** A designation's upkeep due dates, entered by hand until a Philippine rule for them is confirmed. */
export type ManualDueField = 'dau5DueDate' | 'renewalDueDate' | 'renewalDauDueDate' | 'renewalDau5DueDate';

/**
 * The upkeep obligations a mark carries now, with whether each is filed. A
 * designation's later ones carry `dueField`: their due date is entered by
 * hand, and the row asks for it while it is missing.
 */
export function upkeepRows(tm: Trademark) {
  // A country designated abroad keeps none of the Philippine upkeep; its own filings are local deadlines.
  if (isAbroad(tm)) return [];
  const madrid = isDesignation(tm);
  const manual = (field: ManualDueField) => (madrid ? field : null);
  const byHand = madrid ? 'Due date entered by hand' : null;
  const registered = !!tm.regDate;
  const renewed = registered && !!tm.renewalFilingDate;
  return [
    {
      key: '3dau', label: '3-year DAU',
      note: !madrid ? 'Counted from filing' : tm.designationDate ? 'Counted from the designation' : 'Counted from the international registration',
      window: dau3Owed(tm), filed: tm.dau3FilingDate, field: 'dau3FilingDate', dueField: null, motex: tm.dau3Motex, decision: tm.dau3MotexDecision, decidedOn: tm.dau3MotexDecidedOn,
      show: madrid ? !!designationStart(tm) : !!tm.filingDate,
    },
    { key: '5dau', label: '5-year DAU', note: byHand ?? 'Counted from registration', window: dau5Window(tm), filed: tm.dau5FilingDate, field: 'dau5FilingDate', dueField: manual('dau5DueDate'), motex: false, decision: null, decidedOn: null, show: registered },
    { key: 'renewal', label: madrid ? 'Renewal (through WIPO)' : 'Renewal (10 years)', note: byHand, window: renewalWindow(tm), filed: tm.renewalFilingDate, field: 'renewalFilingDate', dueField: manual('renewalDueDate'), motex: false, decision: null, decidedOn: null, show: registered },
    { key: 'rdau', label: 'Renewal DAU', note: byHand, window: renewalDauWindow(tm), filed: tm.renewalDauFiledDate, field: 'renewalDauFiledDate', dueField: manual('renewalDauDueDate'), motex: false, decision: null, decidedOn: null, show: renewed },
    { key: 'r5dau', label: 'Renewal 5-year DAU', note: byHand, window: renewalDau5Window(tm), filed: tm.renewalDau5FiledDate, field: 'renewalDau5FiledDate', dueField: manual('renewalDau5DueDate'), motex: false, decision: null, decidedOn: null, show: renewed },
  ].filter((r) => r.show);
}

/** The first upkeep row of a designation still waiting for its due date to be entered. */
function missingDueDate(tm: Trademark) {
  return upkeepRows(tm).find((r) => r.dueField && !r.window && !r.filed) ?? null;
}

/** The prosecution milestones that apply to this mark, done or not: each Office Action counts its receipt and its answer. */
function prosecutionMilestones(tm: Trademark): boolean[] {
  if (isAbroad(tm)) {
    return [true, ...tm.officeActions.flatMap((oa) => [true, !!oa.responseFiledDate]), isRegistered(tm)];
  }
  if (isDesignation(tm)) {
    return [
      true,
      ...tm.officeActions.flatMap((oa) => [true, !!oa.responseFiledDate]),
      !!tm.publishedDate || isRegistered(tm),
      isRegistered(tm),
    ];
  }
  return [
    tm.status !== 'Prelim',
    !!tm.filingDate || !['Prelim', 'For Filing'].includes(tm.status),
    ...tm.officeActions.flatMap((oa) => [true, !!oa.responseFiledDate]),
    !!tm.noiDate || isRegistered(tm),
    ...(owesFirstPublicationFee(tm.filingDate) ? [!!tm.noiPaymentDate || isRegistered(tm)] : []),
    !!tm.publishedDate || isRegistered(tm),
    !!tm.issuanceFeePaidDate || isRegistered(tm),
    isRegistered(tm),
  ];
}

const PROSECUTION_KINDS = new Set(['1st Publication Fee', 'Issuance Fee', 'OA Response', 'Revival']);

function healthOf(entries: DeadlineEntry[], today: string): Health {
  if (entries.some((d) => d.due < today)) return 'red';
  if (entries.some((d) => d.due <= addDays(today, DUE_SOON_DAYS))) return 'amber';
  return 'green';
}

export function trademarkNextStep(tm: Trademark, today: string): NextStep {
  const owed = upcomingDeadlines(tm);
  const soon = addDays(today, 30);
  const alsoOwed = (main: DeadlineEntry | null) =>
    owed.filter((d) => d !== main && d.due <= soon && !(main && d.label === main.label && d.officeAction?.id === main.officeAction?.id));
  const toneOf = (due: string | null): NextStep['tone'] =>
    !due ? 'default' : due < today ? 'overdue' : due <= soon ? 'soon' : 'default';

  switch (tm.status) {
    case 'Prelim':
      return {
        title: 'Waiting on the client’s instructions',
        body: 'Record them once the client confirms the filing.',
        due: null,
        actions: [{ action: 'instructions_received', label: 'Instructions received', dateMode: 'none', primary: true }],
        alsoOwed: [],
        tone: 'default',
      };
    case 'For Filing':
      return {
        title: 'Ready to file with IPOPHL',
        body: 'Record the filing once the application is in.',
        due: null,
        actions: [{ action: 'mark_as_filed', label: 'Mark as filed', dateMode: 'one', dateLabel: 'Filed on', primary: true }],
        alsoOwed: [],
        tone: 'default',
      };
    case 'Pending':
    case 'Pending - OA': {
      if (isDesignation(tm)) return designationNextStep(tm, today, owed, alsoOwed, toneOf);
      if (isAbroad(tm)) return abroadNextStep(tm, today, owed, alsoOwed, toneOf);
      const actions: ActionSpec[] = [];
      let title: string;
      let body: string | null = null;
      let due: DeadlineWindow | null = null;
      let corPrimary = false;
      let expectedRegDate: string | null = null;
      // Keyed off the rounds rather than the status alone: an OA can be on
      // record while the status still says Pending, and the reverse.
      const open = openOfficeActions(tm.officeActions);
      const oa = open[0] ?? null;
      const pubFeeDue = owesFirstPublicationFee(tm.filingDate) && tm.noiDate && !tm.noiPaymentDate ? noiDeadline(tm.noiDate) : null;
      const issuanceDue = tm.issuanceNoticeDate && !tm.issuanceFeePaidDate ? issuanceFeeDeadline(tm.issuanceNoticeDate) : null;
      const opposition = oppositionPeriod(tm.publishedDate);
      const feesPaid = tm.issuanceFeePaidDate ? `The issuance fees were paid ${shortDate(tm.issuanceFeePaidDate)}.` : null;
      if (oa) {
        const name = officeActionName(tm.officeActions, oa);
        const final = oa.kind === 'final_rejection';
        title = final ? 'Appeal or comply with the final rejection' : `Respond to the ${name}`;
        due = oaResponseOwed(oa);
        body = [
          oa.title ? `${oa.title.replace(/\.$/, '')}.` : null,
          `Dated ${shortDate(oa.mailingDate)}${oa.receivedDate ? `, received ${shortDate(oa.receivedDate)}` : ''}.`,
          oa.motex ? extensionNote(oa.motexDecision, oa.motexDecidedOn) : null,
          oa.respondBy ? 'The examiner set this period, so no routine extension applies.' : null,
          open.length > 1 ? `${open.length - 1} more open after this one.` : null,
        ].filter(Boolean).join(' ');
        actions.push({
          action: 'oa_response_filed',
          label: final ? 'Appeal or compliance filed' : 'Response filed',
          dateMode: 'one',
          dateLabel: 'Filed on',
          primary: true,
          officeActionId: oa.id,
        });
        if (!oa.motex && !oa.respondBy) {
          actions.push({ action: 'oa_response_motex', label: 'Extension (MOTEX) filed', dateMode: 'none', officeActionId: oa.id });
        }
        if (oa.motex && !oa.motexDecision) actions.push(...extensionDecisionSpecs('oa', oa.id));
        if (due.due < today) actions.push(ABANDONMENT_NOTICE);
      } else if (tm.status === 'Pending - OA') {
        const last = tm.officeActions[tm.officeActions.length - 1];
        title = 'Waiting on IPOPHL after the OA response';
        body = last?.responseFiledDate ? `Response filed ${shortDate(last.responseFiledDate)}.` : null;
      } else if (pubFeeDue) {
        title = 'Pay the 1st publication fee';
        body = 'Filed before 14 Feb 2023, so the 1st publication fee is due on the Notice of Allowance.';
        due = pubFeeDue;
        actions.push({ action: 'noi_paid', label: '1st publication fee paid', dateMode: 'one', dateLabel: 'Paid on', primary: true });
        if (pubFeeDue.due < today) actions.push(ABANDONMENT_NOTICE);
      } else if (issuanceDue) {
        title = 'Pay the issuance and 2nd publication fees';
        body = `The Notice of Issuance is dated ${shortDate(tm.issuanceNoticeDate!)}. The COR issues once they are paid.`;
        due = issuanceDue;
        actions.push(ISSUANCE_PAID);
        if (issuanceDue.due < today) actions.push(ABANDONMENT_NOTICE);
      } else if (tm.oppositionFiledDate) {
        title = 'Opposed — waiting on the decision';
        body = `An opposition was filed ${shortDate(tm.oppositionFiledDate)}. The mark is registered once the decision allowing it becomes final.`;
        corPrimary = true;
      } else if (opposition && today <= opposition.ends) {
        title = 'Published for opposition';
        body = [
          `The opposition period ends ${shortDate(opposition.ends)}.`,
          feesPaid ?? 'With no opposition, IPOPHL sends the Notice of Issuance for the issuance and 2nd publication fees.',
        ].join(' ');
        actions.push({ action: 'opposition_filed', label: 'Opposition filed', dateMode: 'one', dateLabel: 'Filed on' });
        if (!tm.issuanceFeePaidDate) actions.push(PAID_IN_ADVANCE);
        expectedRegDate = opposition.deemedRegistered;
      } else if (tm.issuanceFeePaidDate && (opposition || tm.issuanceNoticeDate)) {
        title = 'Waiting for the certificate of registration';
        body = [
          opposition ? `No opposition was recorded by ${shortDate(opposition.ends)}.` : null,
          feesPaid,
          'Record the COR when it arrives.',
        ].filter(Boolean).join(' ');
        corPrimary = true;
        expectedRegDate = opposition?.deemedRegistered ?? null;
      } else if (opposition) {
        title = 'Waiting for the Notice of Issuance';
        body = `No opposition was recorded by ${shortDate(opposition.ends)}. IPOPHL sends the Notice of Issuance next, for the issuance and 2nd publication fees.`;
        actions.push({ ...ISSUANCE_NOTICE, primary: true });
        expectedRegDate = opposition.deemedRegistered;
      } else if (tm.noiDate) {
        title = 'Allowed — waiting for publication';
        body = [
          `The Notice of Allowance is dated ${shortDate(tm.noiDate)}.`,
          feesPaid ?? 'Nothing is due on it; the issuance and 2nd publication fees may be paid now to have the COR sooner.',
          'Record the eGazette publication — the 30-day opposition period runs from it.',
        ].join(' ');
        actions.push({ action: 'published', label: 'Published', dateMode: 'one', dateLabel: 'Published on', primary: true });
        if (!tm.issuanceFeePaidDate) actions.push(PAID_IN_ADVANCE);
      } else {
        title = 'Under examination';
        body = 'Record whatever IPOPHL sends next.';
        actions.push({ ...ALLOWANCE, primary: true });
      }
      if (!actions.some((a) => a.action === 'oa_received')) actions.push(NEW_OA);
      if (!tm.publishedDate && !actions.some((a) => a.action === 'published')) {
        actions.push({ action: 'published', label: 'Published', dateMode: 'one', dateLabel: 'Published on' });
      }
      if (tm.publishedDate && !tm.issuanceNoticeDate && !actions.some((a) => a.action === 'issuance_received')) actions.push(ISSUANCE_NOTICE);
      actions.push({ action: 'cor_received', label: 'COR received', dateMode: 'cor', primary: corPrimary });
      const main = due ? owed.find((d) => d.due === due!.due && (!oa || d.officeAction?.id === oa.id)) ?? null : null;
      return { title, body, due, actions, expectedRegDate, alsoOwed: alsoOwed(main), tone: toneOf(due?.due ?? null) };
    }
    case 'Registered': {
      const next = owed[0] ?? null;
      // An overdue filing comes first; otherwise the missing registration
      // date, without which the 5-year DAU and renewal can't be counted.
      if (isDesignation(tm) && !tm.regDate && !(next && next.due < today)) {
        return {
          title: 'Record the date of the grant of protection',
          body: 'It’s the date on IPOPHL’s statement of grant of protection.',
          due: null,
          actions: [],
          recordDate: { field: 'regDate', label: 'Protection granted', dateLabel: 'Granted on' },
          alsoOwed: alsoOwed(null),
          tone: 'soon',
        };
      }
      const unset = isDesignation(tm) ? missingDueDate(tm) : null;
      if (unset?.dueField && !(next && next.due < today)) {
        return {
          title: `Enter when the ${unset.label.charAt(0).toLowerCase()}${unset.label.slice(1)} is due`,
          body: 'The Philippine rule for counting it on a designation isn’t confirmed yet, so its due date is entered by hand and isn’t tracked until it is.',
          due: null,
          actions: [],
          recordDate: { field: unset.dueField, label: `${unset.label} due date`, dateLabel: 'Due on' },
          alsoOwed: alsoOwed(null),
          tone: 'soon',
        };
      }
      if (!tm.regDate && !(next && next.due < today)) {
        return {
          title: 'Record the registration date',
          body: 'It’s printed on the COR. The 5-year DAU and the renewal count from it, so until it’s in they aren’t tracked.',
          due: null,
          actions: [],
          recordDate: { field: 'regDate', label: 'Registration date', dateLabel: 'Registered on' },
          alsoOwed: alsoOwed(null),
          tone: 'soon',
        };
      }
      if (!next) {
        return {
          title: 'Nothing outstanding',
          body: 'Every declaration and renewal on record is filed.',
          due: null,
          actions: [],
          alsoOwed: [],
          tone: 'clear',
        };
      }
      const actions: ActionSpec[] = [];
      let body: string | null = null;
      const spec = actionForDeadline(next.label);
      if (next.opens && next.opens > today) body = `The filing window opens ${shortDate(next.opens)}.`;
      else if (spec) actions.push(spec);
      if (next.label === '3-DAU' && !tm.dau3Motex) {
        actions.push({ action: 'dau_3_motex_filed', label: 'Extension (MOTEX) filed', dateMode: 'none' });
      }
      if (next.label === '3-DAU' && tm.dau3Motex) {
        body = [body, extensionNote(tm.dau3MotexDecision, tm.dau3MotexDecidedOn)].filter(Boolean).join(' ');
        if (!tm.dau3MotexDecision) actions.push(...extensionDecisionSpecs('dau_3'));
      }
      return { title: `Next: ${entryName(next)}`, body, due: next, actions, alsoOwed: alsoOwed(next), tone: toneOf(next.due) };
    }
    default: {
      const revival = tm.revivalFiledDate || tm.revivalDeclined ? null : revivalDeadline(tm.abandonmentMailingDate);
      if (revival) {
        return {
          title: 'Revive the application',
          body: [
            `IPOPHL’s notice of abandonment is dated ${shortDate(tm.abandonmentMailingDate!)}.`,
            'A revival needs the reason for the delay — fraud, accident, mistake or excusable negligence — and the proposed response.',
            tm.revivalCount > 0 ? 'It was revived once before; a second revival on the same issue isn’t allowed.' : null,
          ].filter(Boolean).join(' '),
          due: revival,
          actions: [
            { action: 'revival_filed', label: 'Revival filed', dateMode: 'one', dateLabel: 'Filed on', primary: true },
            { action: 'revival_declined', label: 'Not reviving', dateMode: 'none' },
          ],
          alsoOwed: [],
          tone: toneOf(revival.due),
        };
      }
      return {
        title: 'Abandoned',
        body: tm.revivalDeclined
          ? 'The firm decided not to revive it, so no deadlines are tracked.'
          : 'This mark is no longer being prosecuted, so no deadlines are tracked.',
        due: null,
        actions: [],
        alsoOwed: [],
        tone: 'inactive',
      };
    }
  }
}

/**
 * A designation under examination by IPOPHL: it answers a provisional refusal
 * by the date on the notice, is published for opposition, and is granted
 * protection by IPOPHL's statement. There is no allowance and no fee notice —
 * its fees were paid to WIPO.
 */
function designationNextStep(
  tm: Trademark,
  today: string,
  owed: DeadlineEntry[],
  alsoOwed: (main: DeadlineEntry | null) => DeadlineEntry[],
  toneOf: (due: string | null) => NextStep['tone'],
): NextStep {
  const actions: ActionSpec[] = [];
  let title: string;
  let body: string | null = null;
  let due: DeadlineWindow | null = null;
  let grantPrimary = false;
  const open = openOfficeActions(tm.officeActions);
  const oa = open[0] ?? null;
  const opposition = oppositionPeriod(tm.publishedDate);
  if (oa) {
    const final = oa.kind === 'final_rejection';
    title = final ? 'Appeal or comply with the final refusal' : `Respond to the ${officeActionName(tm.officeActions, oa).toLowerCase()}`;
    due = oaResponseOwed(oa);
    body = [
      oa.title ? `${oa.title.replace(/\.$/, '')}.` : null,
      `Dated ${shortDate(oa.mailingDate)}${oa.receivedDate ? `, received ${shortDate(oa.receivedDate)}` : ''}.`,
      oa.respondBy ? 'The response date is the one stated on the notice.' : 'No response date is on record — enter the one stated on the notice.',
      open.length > 1 ? `${open.length - 1} more open after this one.` : null,
    ].filter(Boolean).join(' ');
    actions.push({
      action: 'oa_response_filed',
      label: final ? 'Appeal or compliance filed' : 'Response filed',
      dateMode: 'one',
      dateLabel: 'Filed on',
      primary: true,
      officeActionId: oa.id,
    });
    if (due.due < today) actions.push(ABANDONMENT_NOTICE);
  } else if (tm.status === 'Pending - OA') {
    const last = tm.officeActions[tm.officeActions.length - 1];
    title = 'Waiting on IPOPHL after the response';
    body = last?.responseFiledDate ? `Response filed ${shortDate(last.responseFiledDate)}.` : null;
  } else if (tm.oppositionFiledDate) {
    title = 'Opposed — waiting on the decision';
    body = `An opposition was filed ${shortDate(tm.oppositionFiledDate)}. IPOPHL grants protection once the decision allowing the mark becomes final.`;
    grantPrimary = true;
  } else if (opposition && today <= opposition.ends) {
    title = 'Published for opposition';
    body = `The opposition period ends ${shortDate(opposition.ends)}. With no opposition, IPOPHL issues the statement of grant of protection.`;
    actions.push({ action: 'opposition_filed', label: 'Opposition filed', dateMode: 'one', dateLabel: 'Filed on' });
  } else if (opposition) {
    title = 'Waiting for the statement of grant of protection';
    body = `No opposition was recorded by ${shortDate(opposition.ends)}. Record IPOPHL’s statement when it arrives.`;
    grantPrimary = true;
  } else {
    title = 'Under examination';
    body = 'IPOPHL is examining the designation. Record a provisional refusal, or the publication, when it comes.';
    actions.push({ ...NEW_REFUSAL, primary: true });
  }
  if (!actions.some((a) => a.action === 'oa_received')) actions.push(NEW_REFUSAL);
  if (!tm.publishedDate) actions.push({ action: 'published', label: 'Published', dateMode: 'one', dateLabel: 'Published on' });
  actions.push({ ...PROTECTION_GRANTED, primary: grantPrimary });
  const main = due ? owed.find((d) => d.due === due!.due && (!oa || d.officeAction?.id === oa.id)) ?? null : null;
  return { title, body, due, actions, alsoOwed: alsoOwed(main), tone: toneOf(due?.due ?? null) };
}

/**
 * A country designated in one of our international registrations, under
 * examination by its own office: it refuses provisionally within 12 or 18
 * months, or protection follows. Its filings after that are local deadlines.
 */
function abroadNextStep(
  tm: Trademark,
  today: string,
  owed: DeadlineEntry[],
  alsoOwed: (main: DeadlineEntry | null) => DeadlineEntry[],
  toneOf: (due: string | null) => NextStep['tone'],
): NextStep {
  const country = countryName(tm.country);
  const actions: ActionSpec[] = [];
  let title: string;
  let body: string | null = null;
  let due: DeadlineWindow | null = null;
  let grantPrimary = false;
  const open = openOfficeActions(tm.officeActions);
  const oa = open[0] ?? null;
  const ends = refusalPeriodEnds(tm);
  if (oa) {
    const final = oa.kind === 'final_rejection';
    title = final ? `Answer the final refusal in ${country}` : `Respond to the provisional refusal in ${country}`;
    due = oaResponseOwed(oa);
    body = [
      oa.title ? `${oa.title.replace(/\.$/, '')}.` : null,
      `Dated ${shortDate(oa.mailingDate)}${oa.receivedDate ? `, received ${shortDate(oa.receivedDate)}` : ''}.`,
      'The response date is the one stated on the notice.',
      tm.localAgent ? `Local agent: ${tm.localAgent}.` : 'No local agent on record — the response goes in through one.',
      open.length > 1 ? `${open.length - 1} more open after this one.` : null,
    ].filter(Boolean).join(' ');
    actions.push({
      action: 'oa_response_filed',
      label: final ? 'Appeal or compliance filed' : 'Response filed',
      dateMode: 'one',
      dateLabel: 'Filed on',
      primary: true,
      officeActionId: oa.id,
    });
  } else if (tm.officeActions.length) {
    // Answered refusals put the mark back to Pending; the office decides on the response, not on its own time to refuse.
    const last = tm.officeActions[tm.officeActions.length - 1];
    title = `Waiting on the office in ${country} after the response`;
    body = last?.responseFiledDate ? `Response filed ${shortDate(last.responseFiledDate)}.` : null;
  } else if (ends && ends < today) {
    title = `No refusal recorded from ${country}`;
    body = `Its office had until about ${shortDate(ends)} to refuse. Record the statement of grant of protection, or the day protection took effect.`;
    grantPrimary = true;
  } else {
    title = `Under examination in ${country}`;
    body = ends
      ? `Its office has until about ${shortDate(ends)} (${tm.refusalPeriodMonths ?? 12} months) to refuse; without a refusal, protection follows.`
      : 'Record the international registration date to count the office’s time to refuse.';
  }
  if (!actions.some((a) => a.action === 'oa_received')) actions.push({ ...NEW_REFUSAL, primary: !oa && !grantPrimary && !tm.officeActions.length });
  actions.push({ ...PROTECTION_GRANTED, primary: grantPrimary });
  const main = due ? owed.find((d) => d.due === due!.due && (!oa || d.officeAction?.id === oa.id)) ?? null : null;
  return { title, body, due, actions, alsoOwed: alsoOwed(main), tone: toneOf(due?.due ?? null) };
}

/** Filing → examination → registration → upkeep, with where the mark is now. Null once abandoned. */
export function trademarkSteps(tm: Trademark, today: string): JourneyStep[] | null {
  if (tm.status === 'Abandoned') return null;
  const registered = isRegistered(tm);
  const abroad = isAbroad(tm);
  const madrid = isDesignation(tm) || abroad;
  const filed = madrid || !!tm.filingDate || !['Prelim', 'For Filing'].includes(tm.status);
  // Examination ends with the Notice of Allowance (and, for a filing before 14 Feb 2023, its fee);
  // a designation's, with publication.
  const examined = registered || (madrid
    ? !abroad && !!tm.publishedDate && openOfficeActions(tm.officeActions).length === 0
    : !!tm.noiDate && (!owesFirstPublicationFee(tm.filingDate) || !!tm.noiPaymentDate));
  const start = designationStart(tm);
  const owed = upcomingDeadlines(tm);
  const upkeepOwed = owed.filter((d) => !PROSECUTION_KINDS.has(d.label));
  const upkeepOverdue = upkeepOwed.filter((d) => d.due < today).length;
  const firstOpen = openOfficeActions(tm.officeActions)[0];
  const oaDue = firstOpen ? oaResponseOwed(firstOpen) : null;

  return [
    {
      key: 'filing',
      label: madrid ? 'Designation' : 'Filing',
      sub: madrid
        ? start ? `Designated ${shortDate(start)}` : 'Designated'
        : filed
        ? tm.filingDate ? `Filed ${shortDate(tm.filingDate)}` : 'Filed'
        : tm.status === 'Prelim' ? 'Waiting on instructions' : 'Ready to file',
      state: filed ? 'done' : 'current',
      warn: false,
      target: 'progress',
    },
    {
      key: 'examination',
      label: 'Examination',
      sub: examined
        ? tm.noiDate ? `Allowed ${shortDate(tm.noiDate)}` : 'Done'
        : !filed ? 'Office Actions, allowance'
        : oaDue ? (oaDue.due < today ? `${madrid ? 'Refusal' : 'Office Action'} response overdue` : madrid ? 'Refusal open' : 'Office Action open')
        : madrid ? 'Under examination'
        : tm.noiDate ? '1st publication fee due'
        : 'Under examination',
      state: examined ? 'done' : filed ? 'current' : 'upcoming',
      warn: !examined && !!oaDue && oaDue.due < today,
      target: 'progress',
    },
    {
      key: 'registration',
      label: madrid ? 'Protection' : 'Registration',
      sub: registered
        ? tm.regDate ? `${madrid ? 'Granted' : 'Registered'} ${shortDate(tm.regDate)}` : 'Date not recorded'
        : abroad
        ? refusalPeriodEnds(tm) ? `Refusal period ends about ${shortDate(refusalPeriodEnds(tm)!)}` : 'Grant of protection'
        : madrid
        ? tm.oppositionFiledDate ? 'Opposed' : tm.publishedDate ? `Published ${shortDate(tm.publishedDate)}` : 'Publication, grant'
        : tm.oppositionFiledDate ? 'Opposed'
        : tm.issuanceNoticeDate && !tm.issuanceFeePaidDate ? 'Issuance fees due'
        : tm.issuanceFeePaidDate && tm.publishedDate ? 'Waiting for the COR'
        : tm.publishedDate ? `Published ${shortDate(tm.publishedDate)}`
        : examined ? 'Waiting for publication' : 'Publication, issuance, COR',
      state: registered ? 'done' : examined ? 'current' : 'upcoming',
      warn: (registered && !tm.regDate) || (!!tm.issuanceNoticeDate && !tm.issuanceFeePaidDate && (issuanceFeeDeadline(tm.issuanceNoticeDate)?.due ?? today) < today),
      target: 'progress',
    },
    {
      key: 'upkeep',
      label: 'Upkeep',
      sub: !registered
        ? abroad ? 'Local filings' : 'DAUs and renewal'
        : upkeepOverdue ? `${upkeepOverdue} overdue`
        : upkeepOwed[0] ? `${entryName(upkeepOwed[0])} · ${shortDate(upkeepOwed[0].due)}`
        : !tm.regDate ? 'Needs the registration date'
        : 'All filed',
      state: registered ? 'current' : 'upcoming',
      warn: registered && (upkeepOverdue > 0 || !tm.regDate),
      target: 'upkeep',
    },
  ];
}

/**
 * The tracks in focus: prosecution until registered, upkeep once registered —
 * and upkeep earlier when it already needs a look (the 3-year DAU runs from
 * filing, so it can fall due mid-prosecution).
 */
export function trademarkTracks(tm: Trademark, today: string): JourneyTrack[] {
  if (tm.status === 'Abandoned') return [];
  const registered = isRegistered(tm);
  const owed = upcomingDeadlines(tm);
  const tracks: JourneyTrack[] = [];

  if (!registered) {
    const milestones = prosecutionMilestones(tm);
    const step = trademarkNextStep(tm, today);
    const prosecutionOwed = owed.filter((d) => PROSECUTION_KINDS.has(d.label));
    tracks.push({
      key: 'progress',
      label: 'Prosecution',
      health: healthOf(prosecutionOwed, today),
      done: milestones.filter(Boolean).length,
      total: milestones.length,
      summary: step.title,
      next: step.due ? `Due ${shortDate(step.due.due)}` : (step.body ?? ''),
    });
  }

  const rows: { filed: string | null }[] = isAbroad(tm) ? tm.localDeadlines.map((d) => ({ filed: d.filedDate })) : upkeepRows(tm);
  const upkeepOwed = owed.filter((d) => !PROSECUTION_KINDS.has(d.label));
  const upkeepHealth = healthOf(upkeepOwed, today);
  if (registered || (rows.length && upkeepHealth !== 'green')) {
    const overdue = upkeepOwed.filter((d) => d.due < today).length;
    const first = upkeepOwed[0];
    const missingRegDate = registered && !tm.regDate;
    tracks.push({
      key: 'upkeep',
      label: 'Upkeep',
      health: missingRegDate && upkeepHealth === 'green' ? 'amber' : upkeepHealth,
      done: rows.filter((r) => r.filed).length,
      total: rows.length,
      summary: overdue
        ? `${overdue} overdue`
        : first ? `${entryName(first)} due ${shortDate(first.due)}`
        : missingRegDate ? 'Registration date missing'
        : 'All filed',
      next: missingRegDate ? 'Record it to track the 5-year DAU and renewal' : first?.opens && first.opens > today ? `Window opens ${shortDate(first.opens)}` : '',
      stateLabel: missingRegDate && upkeepHealth === 'green' ? 'Needs a date' : undefined,
    });
  }
  return tracks;
}
