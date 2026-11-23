/**
 * The scope lines the firm ships with, transcribed from the proposals it has
 * actually sent.
 *
 * These are defaults, not fixtures: the CMS at /admin/scope-library saves over
 * them by slug, and a fresh database still drafts a correct letter. The wording
 * is the firm's own — the carve-out clause below appeared verbatim in three of
 * the first four proposals, reconstructed from memory each time and placed
 * somewhere different in each letter. Pinning it here is the point of the file.
 *
 * Two departures from what those letters said, both deliberate:
 *   - the hour cap is a token, so it can never again disagree with the tier;
 *   - every line that offers separately-billed work names the schedule that
 *     prices it, which the house style has always required.
 */

import type { ScopeTemplateContent } from './types';

/** The carve-outs, as the firm writes them under a retainer. */
const RETAINER_CARVE_OUTS =
  'The following shall be outside the scope of general legal support: (i) handling of ' +
  'litigation, administrative cases, and other adversarial or dispute resolution proceedings; ' +
  '(ii) collective bargaining and labor disputes; (iii) directorship and nominee services; ' +
  '(iv) corporate secretarial services; (v) intensive liaison and follow-up efforts aimed at ' +
  'achieving a desired result with government agencies or any third parties other than those ' +
  'specifically covered by this engagement; (vi) corporate matters outside of the Client’s ' +
  'regular business dealings such as mergers, acquisitions, or those requiring extensive study ' +
  'and research; and (vii) such other services analogous to the foregoing.';

const COMMENCE_ON_CONFIRMATION =
  'Should any work or service be requested which falls outside the scope described above, the ' +
  'Firm will commence work upon written confirmation of its engagement for such other services, ' +
  'on such terms as may be mutually agreed in writing.';

export const DEFAULT_SCOPE_TEMPLATES: ScopeTemplateContent[] = [
  {
    slug: 'retainer-general',
    name: 'Retainer — General Legal Support',
    subheading: 'Retainer Services',
    role: 'service',
    arrangements: ['retainer'],
    autoSelect: true,
    feeScheduleSlugs: ['professional'],
    aliases: ['retainer', 'monthly retainer', 'general retainer', 'retainer services'],
    blocks: [
      {
        kind: 'labelled',
        label: 'General legal support',
        text:
          'The Firm will render up to {{retainerHours}} hours of legal services per month, covering ' +
          'the day-to-day legal questions and matters that arise in the ordinary course of the ' +
          'Client’s affairs. This includes the preparation and review of contracts, letters, and ' +
          'other documents, and the rendering of legal opinions and advice on matters referred to ' +
          'the Firm from time to time, whether by telephone, electronic mail, or in-person ' +
          'consultation.',
      },
      {
        kind: 'labelled',
        label: 'Priority access',
        text:
          'The Client will have priority access to the Firm’s partners and associates for ' +
          'day-to-day legal queries and advice falling within the monthly hour allocation.',
      },
    ],
  },
  {
    slug: 'corporate-advisory',
    name: 'Corporate and Commercial Advisory',
    subheading: 'Corporate and Commercial Advisory',
    role: 'service',
    arrangements: [],
    autoSelect: false,
    feeScheduleSlugs: ['professional'],
    aliases: ['corporate', 'commercial', 'corporate advisory', 'general corporate'],
    blocks: [
      {
        kind: 'labelled',
        label: 'Corporate and commercial advice',
        text:
          'The Firm will advise on the Client’s corporate and commercial matters, including the ' +
          'review and preparation of contracts, corporate correspondence, and internal policies.',
      },
      {
        kind: 'labelled',
        label: 'Regulatory and compliance queries',
        text:
          'The Firm will respond to the Client’s queries on regulatory and compliance matters as ' +
          'they arise in the ordinary course of business.',
      },
    ],
  },
  {
    slug: 'trademark-prosecution',
    name: 'Trademark Registration and Maintenance',
    subheading: 'Trademark Registration and Maintenance',
    role: 'service',
    arrangements: [],
    autoSelect: false,
    feeScheduleSlugs: ['trademark'],
    aliases: ['trademark', 'trademark registration', 'tm filing', 'trademark prosecution'],
    blocks: [
      {
        kind: 'labelled',
        label: 'Trademark filing',
        text:
          'The Firm will prepare and file trademark applications with the Intellectual Property ' +
          'Office of the Philippines on behalf of the Client for the marks the Client wishes to ' +
          'protect.',
      },
      {
        kind: 'labelled',
        label: 'Prosecution and maintenance',
        text:
          'The Firm will handle the prosecution of those applications, including responses to ' +
          'office actions, and will attend to the declarations of actual use, renewals, and other ' +
          'maintenance filings that keep the Client’s registrations in good standing.',
      },
      {
        kind: 'labelled',
        label: 'Fees for trademark work',
        text:
          'Professional fees for trademark filing, prosecution, and maintenance are billed ' +
          'separately in accordance with the Trademark Fee Schedule attached as Annex “A”, and ' +
          'are not covered by the fees quoted in this proposal.',
      },
    ],
  },
  {
    slug: 'ip-filings-referral',
    name: 'Intellectual Property Filings (cross-reference only)',
    subheading: 'Intellectual Property Filings',
    role: 'service',
    arrangements: ['retainer'],
    autoSelect: false,
    feeScheduleSlugs: ['trademark', 'patent', 'copyright'],
    aliases: ['ip', 'intellectual property', 'patent', 'copyright'],
    blocks: [
      {
        kind: 'labelled',
        label: 'Intellectual property filings',
        text:
          'Should the Client require assistance with trademark, patent, or copyright applications ' +
          'and their prosecution, the Firm offers these services at the rates set out in the ' +
          'Trademark, Patent, and Copyright Fee Schedules attached as Annex “A”. They are billed ' +
          'separately and are not covered by the fees quoted in this proposal.',
      },
    ],
  },
  {
    slug: 'dispute-resolution',
    name: 'Dispute Resolution and Litigation (separately engaged)',
    subheading: 'Dispute Resolution',
    role: 'service',
    arrangements: ['retainer', 'hourly', 'acceptance_completion', 'fixed', 'custom'],
    autoSelect: false,
    feeScheduleSlugs: ['professional'],
    aliases: [
      'litigation', 'dispute', 'dispute resolution', 'court', 'case', 'civil case',
      'criminal case', 'labor case', 'collection', 'ejectment', 'injunction',
    ],
    blocks: [
      {
        kind: 'para',
        text:
          'Should a dispute arise, the Firm is prepared to represent the Client in its resolution — ' +
          'whether by demand and negotiation, by alternative dispute resolution, or by contested ' +
          'proceedings — subject to a separate written engagement and to the Firm’s conflict-check ' +
          'clearance at the time the dispute is referred.',
      },
      {
        kind: 'labelled',
        label: 'Forums',
        text:
          'Representation may be before the regular courts at first instance, before quasi-judicial ' +
          'and administrative bodies with jurisdiction over the subject matter (among others, the ' +
          'National Labor Relations Commission, the Department of Labor and Employment, the ' +
          'Securities and Exchange Commission, the Intellectual Property Office, the Department of ' +
          'Human Settlements and Urban Development, and the Bureau of Internal Revenue), before ' +
          'arbitral tribunals, and before the barangay where prior conciliation is a condition to ' +
          'filing under the Katarungang Pambarangay Law.',
      },
      {
        kind: 'labelled',
        label: 'Work covered',
        text: 'For a dispute the Firm is engaged to handle, the engagement covers:',
      },
      {
        kind: 'list',
        ordered: true,
        items: [
          'studying the facts, reviewing the documentary record, and conferring with the Client’s witnesses;',
          'researching the applicable laws, rules, and jurisprudence, and advising on the merits and the realistic range of outcomes;',
          'preparing demand letters and conducting settlement negotiations, including court-annexed mediation and judicial dispute resolution;',
          'preparing and filing the initiatory pleading, or the responsive pleading where the Client is the party sued or charged;',
          'appearing as counsel of record in the case the Firm files or that is filed against the Client;',
          'preparing the pleadings, motions, position papers, judicial affidavits, and formal offers of evidence needed to secure the remedies prayed for;',
          'applying for and opposing provisional remedies — temporary restraining orders, preliminary injunction, attachment, replevin, and garnishment — where the case warrants;',
          'attending hearings, pre-trial and preliminary conferences, depositions, and Client consultations; and',
          'moving for execution and assisting in the enforcement or satisfaction of a favorable judgment or award.',
        ],
      },
      {
        kind: 'labelled',
        label: 'Appeals and related proceedings',
        text:
          'An appeal, a petition for certiorari, prohibition or mandamus, and any separate case or ' +
          'proceeding arising from the same facts are each a distinct engagement carrying its own ' +
          'acceptance fee, and are not covered by the engagement for the case at first instance.',
      },
      {
        kind: 'labelled',
        label: 'Costs and expenses',
        text:
          'Filing and docket fees, sheriff’s and process server’s fees, mediation and arbitration ' +
          'fees, premiums on bonds, transcripts of stenographic notes, expert and commissioner’s ' +
          'fees, notarial and authentication charges, courier, and travel and accommodation for ' +
          'hearings outside Metro Manila are for the Client’s account. These are billed at cost, ' +
          'and substantial outlays are advanced by the Client rather than by the Firm.',
      },
      {
        kind: 'labelled',
        label: 'The Client’s cooperation',
        text:
          'The Firm relies on the Client for complete and accurate instructions, for the timely ' +
          'production of documents, and for the availability of its officers and witnesses on the ' +
          'dates set by the tribunal. Periods in adversarial proceedings are jurisdictional and ' +
          'largely non-extendible, so instructions sought on a deadline must be given promptly.',
      },
      {
        kind: 'labelled',
        label: 'No assurance of outcome',
        text:
          'The Firm undertakes to handle the dispute with the professional skill and diligence the ' +
          'Code of Professional Responsibility and Accountability requires. It does not warrant a ' +
          'particular result, and no assessment of the merits given before or during the ' +
          'proceedings is to be read as a guarantee of one.',
      },
      {
        kind: 'labelled',
        label: 'Fees for dispute resolution',
        text:
          'Dispute resolution is not covered by the fees quoted in this proposal. It is billed on ' +
          'the acceptance-fee basis set out in the Professional Fee Schedule attached as Annex “A”, ' +
          'together with the appearance and drafting fees stated there, and work commences only ' +
          'upon written confirmation of a separate engagement.',
      },
    ],
  },
  {
    slug: 'dispute-resolution-engagement',
    name: 'Dispute Resolution — the engagement itself',
    subheading: 'Conduct of the Case',
    role: 'service',
    arrangements: ['litigation'],
    autoSelect: true,
    feeScheduleSlugs: ['professional'],
    aliases: [
      'litigation engagement', 'handle the case', 'represent us in court',
      'file a case', 'defend', 'counsel of record',
    ],
    blocks: [
      {
        kind: 'para',
        text:
          'The Firm is engaged to act as the Client’s counsel in the matter described above, and to ' +
          'carry it from the assessment of the Client’s position through to the resolution of the ' +
          'case at first instance. The fees for this work are those stated in this proposal; the ' +
          'Schedule of Fees attached as Annex “A” governs anything billed by reference to it.',
      },
      {
        kind: 'labelled',
        label: 'What the Firm will do',
        text: 'The engagement covers:',
      },
      {
        kind: 'list',
        ordered: true,
        items: [
          'assessing the Client’s position on the facts and the documents, and advising on the merits, the forum, and the realistic range of outcomes before anything is filed;',
          'attempting resolution short of a contested proceeding where that serves the Client — demand, negotiation, and any conciliation or mediation the rules require;',
          'preparing and filing the initiatory or responsive pleading, and appearing as counsel of record throughout;',
          'preparing every pleading, motion, position paper, judicial affidavit, and formal offer of evidence the case calls for;',
          'applying for and opposing provisional remedies where the case warrants;',
          'appearing at all hearings, pre-trial and preliminary conferences, and depositions, and keeping the Client advised as the case moves; and',
          'moving for execution and assisting in enforcing or satisfying a favorable judgment or award.',
        ],
      },
      {
        kind: 'labelled',
        label: 'Where this engagement ends',
        text:
          'This engagement covers the case at first instance. An appeal, a petition for certiorari, ' +
          'prohibition or mandamus, and any separate case or proceeding arising from the same facts ' +
          'are each a distinct engagement carrying their own acceptance fee, which the Firm is glad ' +
          'to discuss if and when the need arises.',
      },
      {
        kind: 'labelled',
        label: 'Costs and expenses',
        text:
          'Filing and docket fees, sheriff’s and process server’s fees, premiums on bonds, ' +
          'transcripts of stenographic notes, expert and commissioner’s fees, notarial and ' +
          'authentication charges, courier, and travel and accommodation for hearings outside Metro ' +
          'Manila are for the Client’s account and are separate from the fees quoted here. They are ' +
          'billed at cost, and substantial outlays are advanced by the Client rather than by the Firm.',
      },
      {
        kind: 'labelled',
        label: 'The Client’s cooperation',
        text:
          'The Firm relies on the Client for complete and accurate instructions, for the timely ' +
          'production of documents, and for the availability of its officers and witnesses on the ' +
          'dates set by the tribunal. Periods in adversarial proceedings are jurisdictional and ' +
          'largely non-extendible, so instructions sought on a deadline must be given promptly.',
      },
      {
        kind: 'labelled',
        label: 'No assurance of outcome',
        text:
          'The Firm undertakes to handle the case with the professional skill and diligence the ' +
          'Code of Professional Responsibility and Accountability requires. It does not warrant a ' +
          'particular result, and no assessment of the merits given before or during the ' +
          'proceedings is to be read as a guarantee of one.',
      },
    ],
  },
  {
    slug: 'dispute-resolution-adr',
    name: 'Arbitration and Alternative Dispute Resolution (separately engaged)',
    subheading: 'Arbitration and Alternative Dispute Resolution',
    role: 'service',
    arrangements: ['retainer', 'hourly', 'acceptance_completion', 'fixed', 'custom'],
    autoSelect: false,
    feeScheduleSlugs: ['professional'],
    aliases: ['arbitration', 'adr', 'mediation', 'ciac', 'construction arbitration', 'alternative dispute resolution'],
    blocks: [
      {
        kind: 'para',
        text:
          'Where the contract carries an arbitration or mediation clause, or where the parties ' +
          'prefer to resolve the matter outside the courts, the Firm acts for the Client in the ' +
          'alternative dispute resolution proceeding and in the court proceedings ancillary to it.',
      },
      {
        kind: 'list',
        ordered: true,
        items: [
          'advising on the validity, reach, and practical effect of the dispute resolution clause, and on the seat, governing law, and institutional rules it selects;',
          'serving or answering the request or notice of arbitration, and participating in the constitution of the tribunal, including the nomination and any challenge of arbitrators;',
          'representing the Client in mediation and in institutional or ad hoc arbitration, including proceedings before the Construction Industry Arbitration Commission and the Philippine Dispute Resolution Center, Inc.;',
          'preparing the terms of reference, submissions, witness statements, and expert evidence, and appearing at the hearings; and',
          'applying to the courts for interim measures of protection, and for the confirmation, recognition, enforcement, correction, or vacatur of an award under the Alternative Dispute Resolution Act and the Special Rules of Court on Alternative Dispute Resolution.',
        ],
      },
      {
        kind: 'labelled',
        label: 'Tribunal and institutional costs',
        text:
          'Arbitrator’s fees, administrative and filing fees of the arbitral institution, hearing ' +
          'facilities, transcription, and the fees of any expert or tribunal-appointed assessor are ' +
          'separate from the Firm’s professional fees and are for the Client’s account, in the ' +
          'shares fixed by the tribunal or the applicable rules.',
      },
      {
        kind: 'labelled',
        label: 'Fees for alternative dispute resolution',
        text:
          'This work is not covered by the fees quoted in this proposal. It is billed on the ' +
          'acceptance-fee basis set out in the Professional Fee Schedule attached as Annex “A”, and ' +
          'commences only upon written confirmation of a separate engagement.',
      },
    ],
  },
  {
    slug: 'exclusions-retainer',
    name: 'Out of Scope — Retainer',
    subheading: 'Out of Scope',
    role: 'exclusions',
    arrangements: ['retainer'],
    autoSelect: true,
    feeScheduleSlugs: [],
    aliases: [],
    blocks: [
      { kind: 'para', text: RETAINER_CARVE_OUTS },
      { kind: 'para', text: COMMENCE_ON_CONFIRMATION },
    ],
  },
  {
    slug: 'exclusions-general',
    name: 'Out of Scope — Single Matter',
    subheading: 'Out of Scope',
    role: 'exclusions',
    arrangements: ['hourly', 'acceptance_completion', 'litigation', 'fixed', 'custom'],
    autoSelect: true,
    feeScheduleSlugs: [],
    aliases: [],
    blocks: [
      {
        kind: 'para',
        text:
          'This engagement is limited to the services described above. It does not extend to ' +
          'appellate proceedings, to separate cases or proceedings arising from the same facts, or ' +
          'to corporate, tax, or regulatory matters unrelated to the services described.',
      },
      { kind: 'para', text: COMMENCE_ON_CONFIRMATION },
    ],
  },
];
