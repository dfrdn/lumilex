import type { ClientSeed, MatterSeed, WorkSeed } from './dataset';
import { DTYPE, FIRM } from './dataset';
import type { DocumentSection, DocumentSpec } from './documents';

/**
 * Invented prose for the demo's generated documents.
 *
 * Every word here is written from scratch. Nothing is copied from a real
 * filing — the demo is publicly reachable, so real client content must never
 * reach it. Names, docket numbers and facts are fictional; any resemblance to
 * an actual case is unintended.
 */

const rot = <T,>(arr: readonly T[], n: number): T[] => {
  const k = ((n % arr.length) + arr.length) % arr.length;
  return arr.slice(k).concat(arr.slice(0, k));
};

// ── Pleading banks ──────────────────────────────────────────────────

const ALLEGATIONS = [
  'Plaintiff is a domestic corporation duly organized and existing under the laws of the Republic of the Philippines, with principal office at the address indicated in its verification, where it may be served with orders and processes of this Honorable Court.',
  'Defendant is likewise a domestic entity with capacity to sue and be sued, and may be served with summons at its stated principal office.',
  'On the dates material to this case, the parties entered into a written agreement under which plaintiff undertook to render the services and deliveries described therein and defendant undertook to pay the corresponding invoices within thirty (30) days of receipt.',
  'Plaintiff faithfully performed its obligations under the agreement. Its services and deliveries were accepted by defendant without protest, and the corresponding receipts were signed by defendant’s authorized representative.',
  'Notwithstanding repeated demands, the last of which was received by defendant as shown by the registry return card attached as an annex, defendant failed and continues to fail to settle its outstanding obligation.',
  'Plaintiff was constrained to engage the services of undersigned counsel to protect its interests, for which it agreed to pay reasonable attorney’s fees.',
];

const POSSESSION_FACTS = [
  'Plaintiff is the registered owner and prior possessor of the parcel of land described in the transfer certificate of title attached as an annex, on which it has operated a seedling nursery for more than six (6) years.',
  'Sometime in March, defendants, through stealth and without plaintiff’s knowledge or consent, cut through the perimeter fence and put up makeshift structures on the northern portion of the property.',
  'Plaintiff’s caretaker immediately reported the entry to the barangay, and the matter was referred to conciliation, which failed, as shown by the certificate to file action attached as an annex.',
  'Defendants’ continued occupation deprives plaintiff of the use of the nursery and has caused the loss of seedlings intended for the planting season.',
];

const REPLY = [
  'Plaintiff specifically denies the new matters alleged in the Answer, the truth being as stated in the Complaint and in the documents attached to it.',
  'The so-called affirmative defenses are, on their face, a restatement of the denials already made in the Answer and deserve no separate consideration.',
  'Defendant’s claim of payment is contradicted by its own letter acknowledging the outstanding balance, a copy of which is attached as an annex and made an integral part hereof.',
  'The defense of laches finds no application where, as here, the action was filed well within the prescriptive period and demands were made regularly.',
];

const DEFENSES = [
  'The motion is premised on the claim that the Complaint states no cause of action. The rule is that the sufficiency of a cause of action is determined from the allegations of the complaint alone, hypothetically admitted.',
  'Read in this light, the Complaint alleges the contract, plaintiff’s performance, defendant’s breach, and the resulting damage. Nothing more is required at this stage.',
  'The documents defendant attaches to its motion raise matters of defense that call for the presentation of evidence, which cannot be resolved in a motion to dismiss.',
  'The motion is, at bottom, a request that the Court decide the merits of the case on the pleadings. It should be denied, and defendant directed to file its Answer.',
];

const ARGUMENTS = [
  'It is settled that the party who alleges a fact has the burden of proving it. Bare allegations, unsubstantiated by evidence, are not equivalent to proof.',
  'The evidence on record, taken as a whole, preponderates in favor of the position advanced herein. The documentary exhibits are consistent with the testimonial evidence and remain uncontroverted.',
  'The opposing party’s reliance on the cited authority is misplaced. The doctrine there announced was applied to a factual setting materially different from the case at bar.',
  'Procedural rules are tools designed to facilitate the adjudication of cases. Their strict application in this instance would frustrate rather than promote substantial justice.',
];

const LABOR_ABANDONMENT = [
  'Complainant was hired by respondent company as a team lead and was regularized after six months, as shown by the appointment papers attached as annexes.',
  'Beginning on the date stated in the attendance records, complainant failed to report for work for eleven (11) consecutive working days without filing any leave application or offering any explanation.',
  'Respondent company served a Notice to Explain at complainant’s last known address, which was returned unclaimed, and a second notice by registered mail, which likewise went unanswered.',
  'Complainant was never dismissed. His prolonged absence, coupled with his failure to respond to two return-to-work notices, shows a clear intention to sever the employment relationship.',
];

const LABOR_TRANSFER = [
  'Complainant was transferred from the first plant to the second plant in the same city, with the same rank, salary and benefits, to supervise a newly opened quality-control line.',
  'The transfer was made in good faith under the company’s standing policy of rotating supervisors, and was communicated to complainant in writing two weeks before it took effect.',
  'Complainant suffered no diminution in pay or benefits and continued to receive the same supervisory allowance throughout.',
  'A transfer that is not unreasonable, inconvenient or prejudicial to the employee, and that involves neither a demotion in rank nor a diminution of salary, is a valid exercise of management prerogative and not a constructive dismissal.',
];

const IP_GROUNDS = [
  'Opposer is the registered owner of the mark subject of this opposition, which it has used continuously in commerce in the Philippines for the goods and services covered by its registration.',
  'The mark applied for by respondent-applicant is confusingly similar to opposer’s mark in sound, appearance and commercial impression, and covers goods that are closely related to opposer’s.',
  'The registration of respondent-applicant’s mark is likely to cause confusion or mistake, or to deceive the purchasing public as to the origin of the goods, to the damage and prejudice of opposer.',
  'Opposer’s mark has acquired goodwill and a reputation among consumers through years of use and substantial investment in advertising and promotion.',
];

const PRETRIAL: DocumentSection[] = [
  { heading: 'I. POSSIBILITY OF AMICABLE SETTLEMENT', paras: ['Plaintiff is willing to explore an amicable settlement, including through court-annexed mediation and judicial dispute resolution, on terms that recognize the full amount of its claim.'] },
  { heading: 'II. PROPOSED STIPULATIONS', paras: ['Plaintiff proposes that the parties stipulate on the due execution and genuineness of the written agreement, the receipts, and the letters of demand attached to the Complaint.'] },
  { heading: 'III. ISSUES', paras: ['Whether defendant is liable for the unpaid balance claimed; and whether plaintiff is entitled to interest, attorney’s fees and costs of suit.'] },
  { heading: 'IV. DOCUMENTS AND EXHIBITS', paras: ['Plaintiff intends to present the documents marked as Exhibits "A" to "K", inclusive of their sub-markings, and reserves the right to mark additional exhibits during trial.'] },
  { heading: 'V. WITNESSES', paras: ['Plaintiff will present two (2) witnesses, whose judicial affidavits are submitted with this Brief, each estimated to take one (1) hearing.'] },
];

const AFFIDAVIT_QA: { q: string; a: string }[] = [
  { q: 'Please state your name, age, civil status, and address.', a: 'I am the affiant named above, of legal age, and a resident of Metro Manila, Philippines.' },
  { q: 'Do you know the parties in this case?', a: 'Yes. I have dealt with both parties in the course of my employment.' },
  { q: 'What is your present position?', a: 'I hold the position stated in the caption of this affidavit and have occupied it for several years.' },
  { q: 'Why are you executing this affidavit?', a: 'To attest to matters of my own personal knowledge relevant to the issues before this Honorable Court.' },
  { q: 'What are your duties in that position?', a: 'Among others, I supervise the recording of deliveries and the reconciliation of accounts with counterparties.' },
  { q: 'Are you familiar with the transaction subject of this case?', a: 'Yes. The records concerned passed through my desk in the ordinary course of business.' },
  { q: 'What documents did you personally prepare or verify?', a: 'The statement of account and the supporting receipts marked as exhibits in this case.' },
  { q: 'Were those documents prepared in the regular course of business?', a: 'Yes, contemporaneously with the transactions they record, as is our standard practice.' },
  { q: 'What does the statement of account show?', a: 'It shows the invoices issued, the payments received, and the balance remaining unpaid as of the cut-off date.' },
  { q: 'Did the other party ever dispute the statement?', a: 'Not in writing, and not at any time before this case was commenced.' },
  { q: 'Do you affirm the truth of the foregoing?', a: 'Yes, I affirm that the foregoing answers are true and correct of my own personal knowledge.' },
];

const PRAYERS = {
  claim: [
    'judgment be rendered in favor of the party represented by undersigned counsel;',
    'the adverse party be ordered to pay the sums due, plus legal interest reckoned from the date of extrajudicial demand;',
    'the adverse party be ordered to pay attorney’s fees and the costs of suit.',
  ],
  motion: [
    'this pleading be GRANTED and the relief sought herein be given due course; and',
    'movant be granted such further relief as may be just and equitable under the premises.',
  ],
  opposition: [
    'the motion be DENIED for lack of merit; and',
    'defendant be directed to file its Answer within the period provided by the Rules.',
  ],
  labor: [
    'the complaint be DISMISSED for lack of merit;',
    'respondents be absolved from any liability for the money claims asserted; and',
    'complainant’s claims for damages and attorney’s fees be denied.',
  ],
  possession: [
    'defendants and all persons claiming rights under them be ordered to vacate the property and remove their structures;',
    'defendants be ordered to pay reasonable compensation for the use of the property from the date of entry until they vacate; and',
    'defendants be ordered to pay attorney’s fees and the costs of suit.',
  ],
  ip: [
    'the opposition be SUSTAINED;',
    'the application subject of this opposition be REJECTED; and',
    'opposer be granted such further relief as may be just and equitable.',
  ],
};

// ── Letters, memoranda, agreements ──────────────────────────────────

const MEMO_DISCUSSION = [
  'We reviewed the documents the client provided, the applicable statutes and implementing rules, and the most recent issuances of the regulator concerned.',
  'The prevailing view is that the obligation arises only once the conditions in the governing contract are met; before then, the client’s exposure is limited to the good-faith performance of its own undertakings.',
  'There is some risk that a different reading will be taken by the counterparty or the agency. That risk is manageable if the client documents each step and keeps its correspondence consistent with the position recommended below.',
  'We found no provision that would prevent the client from adopting the approach recommended, provided the notices described below are given and the relevant board approvals are obtained beforehand.',
];

const AGREEMENT_ARTICLES: DocumentSection[] = [
  { heading: 'ARTICLE 1. DEFINITIONS', paras: ['Capitalized terms used in this Agreement have the meanings given to them in this Article, unless the context requires otherwise.'] },
  { heading: 'ARTICLE 2. SCOPE', paras: ['The parties agree on the scope of the undertaking as set out in Schedule 1, which may be amended only in writing signed by both parties.'] },
  { heading: 'ARTICLE 3. TERM', paras: ['This Agreement takes effect on the date of its execution and remains in force for three (3) years, renewable by mutual written agreement at least sixty (60) days before expiry.'] },
  { heading: 'ARTICLE 4. CONSIDERATION AND PAYMENT', paras: ['The consideration and the schedule of payment are set out in Schedule 2. Amounts not paid when due earn interest at the legal rate from the date of demand.'] },
  { heading: 'ARTICLE 5. CONFIDENTIALITY', paras: ['Each party shall keep confidential all non-public information received from the other in connection with this Agreement, and use it only for the purposes of this Agreement.'] },
  { heading: 'ARTICLE 6. TERMINATION', paras: ['Either party may terminate this Agreement upon written notice if the other commits a material breach and fails to cure it within thirty (30) days of receipt of notice.'] },
  { heading: 'ARTICLE 7. GOVERNING LAW AND VENUE', paras: ['This Agreement is governed by the laws of the Philippines. Venue for any action arising from it shall be exclusively in the proper courts of Makati City.'] },
];

// ── Composition ─────────────────────────────────────────────────────

export interface Signatory {
  name: string;
  position: string;
}

export interface DocContext {
  work: WorkSeed;
  matter: MatterSeed;
  client: ClientSeed;
  /** Who drafted it (memoranda FROM line). */
  drafter: Signatory;
  /** Who signs it — the matter's partner. */
  signer: Signatory;
  /** Partner the internal memo is addressed to. */
  reviewer: Signatory;
  date: string;
  index: number;
  /** For status reports: the next event worth reporting. */
  nextEvent?: string;
}

function caption(matter: MatterSeed, client: ClientSeed): { left: string[]; right: string[] } {
  const c = matter.case!;
  const clientParty = client.full.toUpperCase();
  const adverseParty = c.adverse.toUpperCase();
  const [first, firstRole, second, secondRole] = c.clientFiled
    ? [clientParty, c.clientRole, adverseParty, c.adverseRole]
    : [adverseParty, c.adverseRole, clientParty, c.clientRole];
  return {
    left: [`${first},`, `          ${firstRole},`, '', '     - versus -', '', `${second},`, `          ${secondRole}.`],
    right: [c.docket, c.nature],
  };
}

function pleading(ctx: DocContext): DocumentSpec {
  const { work, matter, client, signer, date, index } = ctx;
  const c = matter.case!;
  const cap = caption(matter, client);
  const base = {
    layout: 'pleading' as const,
    title: work.title,
    date,
    court: c.court,
    captionLeft: cap.left,
    captionRight: cap.right,
    intro: [] as string[],
    closing: [] as string[],
    numbered: true,
    signer,
    counselFor: `Counsel for ${c.clientRole}`,
  };
  const party = c.clientRole.toLowerCase();
  const openingLine = `${c.clientRole.toUpperCase()}, by counsel, respectfully ${/s$/.test(c.clientRole) ? 'state' : 'states'}:`;

  switch (work.subtype) {
    case 'Judicial Affidavit':
      return {
        ...base,
        numbered: false,
        intro: [
          `I, ${(work.witness ?? 'the affiant').toUpperCase()}, of legal age, Filipino, and with office address at the principal office of ${client.full}, after having been duly sworn in accordance with law, depose and state that the following questions were asked of me by ${ctx.drafter.name} of ${FIRM.name} at the firm’s offices, and that the answers given are my own:`,
        ],
        qa: [
          AFFIDAVIT_QA[0],
          ...rot(AFFIDAVIT_QA.slice(1, -1), index).slice(0, 7),
          AFFIDAVIT_QA[AFFIDAVIT_QA.length - 1],
        ],
        sections: [],
        closing: [
          'IN WITNESS WHEREOF, I have signed this Judicial Affidavit this ____ day of ______________ at Makati City.',
        ],
      };
    case 'Pre-Trial Brief':
      return { ...base, intro: [openingLine], sections: PRETRIAL, numbered: false, prayer: PRAYERS.motion };
    case 'Reply':
      return { ...base, intro: [openingLine], sections: [{ heading: 'REPLY', paras: rot(REPLY, index).slice(0, 3) }], prayer: PRAYERS.claim };
    case 'Comment/Opposition':
      return { ...base, intro: [openingLine], sections: [{ heading: 'DISCUSSION', paras: rot(DEFENSES, index).slice(0, 4) }], prayer: PRAYERS.opposition };
    case 'Motion':
    case 'Manifestation':
      return { ...base, intro: [openingLine], sections: [{ paras: rot(ARGUMENTS, index).slice(0, 3) }], prayer: PRAYERS.motion };
    case 'Petition':
      return {
        ...base,
        intro: [`${client.full.toUpperCase()}, ${party}, by counsel, respectfully opposes the application subject of this case on the following grounds:`],
        sections: [{ heading: 'GROUNDS', paras: IP_GROUNDS }],
        prayer: PRAYERS.ip,
      };
    case 'Position Paper': {
      const facts = c.forum === 'labor'
        ? (matter.key === 'delapaz' ? LABOR_TRANSFER : LABOR_ABANDONMENT)
        : c.forum === 'ipophl' ? IP_GROUNDS : POSSESSION_FACTS;
      const prayer = c.forum === 'labor' ? PRAYERS.labor : c.forum === 'ipophl' ? PRAYERS.ip : PRAYERS.possession;
      return {
        ...base,
        intro: [openingLine],
        sections: [
          { heading: 'STATEMENT OF FACTS', paras: facts.slice(0, 3) },
          { heading: 'ISSUE', paras: [`Whether the ${c.forum === 'labor' ? 'complaint' : 'relief prayed for'} is supported by the facts established on record.`] },
          { heading: 'DISCUSSION', paras: [facts[3], ...rot(ARGUMENTS, index).slice(0, 2)] },
        ],
        prayer,
      };
    }
    default: {
      const possession = /forcible|detainer/i.test(c.nature);
      return {
        ...base,
        intro: [openingLine],
        sections: [
          { heading: 'THE PARTIES AND THE FACTS', paras: possession ? POSSESSION_FACTS : rot(ALLEGATIONS, index).slice(0, 5) },
          { heading: 'CAUSE OF ACTION', paras: rot(ARGUMENTS, index).slice(0, 2) },
        ],
        prayer: possession ? PRAYERS.possession : PRAYERS.claim,
      };
    }
  }
}

function clientAddressee(client: ClientSeed): string[] {
  return client.individual
    ? [client.full.toUpperCase(), 'Makati City']
    : [client.contact.toUpperCase(), client.contactTitle, client.full, 'Metro Manila'];
}

function salutationFor(to: string[]): string {
  const first = to[0] ?? '';
  if (/^\[/.test(first)) return 'Dear Mr./Ms. [Surname]:';
  if (/^The /.test(first) || /Commission|Office|Bureau|Department/.test(first)) return 'Sir/Madam:';
  return 'Dear Sir/Madam:';
}

function letter(ctx: DocContext): DocumentSpec {
  const { work, matter, client, signer, date } = ctx;
  const base = {
    layout: 'letter' as const,
    title: work.title,
    date,
    numbered: false,
    signer,
    sections: [] as DocumentSection[],
    closing: [] as string[],
  };

  if (work.type === DTYPE.STATUS_REPORT) {
    const to = clientAddressee(client);
    const c = matter.case;
    return {
      ...base,
      addressee: to,
      subject: `Re: ${matter.name}${c ? ` (${c.docket})` : ''}`,
      salutation: `Dear ${client.contact}:`,
      intro: ['We write to update you on the status of the above matter as of the date of this letter.'],
      sections: [
        {
          heading: 'Developments',
          paras: c
            ? [
                `The case remains pending before the ${c.court}. Our last pleading was filed on time and served on the ${c.adverseRole.toLowerCase()}’s counsel, and we are monitoring the docket for the court’s action.`,
                'We have completed the preparation of our documentary evidence and are finalizing the judicial affidavits of our witnesses.',
              ]
            : [
                'Work on this matter is proceeding on schedule. The drafts we circulated last month have been revised to reflect your comments.',
                'We are coordinating with the relevant agency on the requirements that remain outstanding.',
              ],
        },
        {
          heading: 'Next steps',
          paras: [ctx.nextEvent ?? 'We will send you the next report at the end of the month, or sooner if anything requires your decision.'],
        },
      ],
      closing: ['Please let us know if you have any questions. We would be glad to discuss this report with you at your convenience.'],
    };
  }

  const to = work.to ?? clientAddressee(client);
  const subject = `Re: ${work.title}`;
  const salutation = salutationFor(to);

  switch (work.subtype) {
    case 'Demand Letter':
      return {
        ...base,
        addressee: to,
        subject,
        salutation,
        intro: [
          `We write on behalf of our client, ${client.full}, in connection with the matter described below.`,
          'Our client’s records show an obligation that has remained outstanding well beyond the agreed period, despite several follow-ups made directly with your office.',
          'Demand is hereby made upon you to settle the obligation in full, or to comply with the undertaking described above, within fifteen (15) days from your receipt of this letter.',
          'Should we not hear from you within that period, we shall be constrained to pursue the remedies available to our client without further notice.',
        ],
        closing: ['We trust that this matter can be resolved without recourse to litigation.'],
      };
    case 'Notice':
      return {
        ...base,
        addressee: to,
        subject: 'Re: Notice to Explain',
        salutation,
        intro: [
          'This notice concerns the incident described in the attached report, which, if established, may constitute a violation of the company’s Code of Conduct.',
          'You are directed to submit a written explanation within five (5) calendar days from receipt of this notice, stating why no disciplinary action should be taken against you. You may be assisted by a representative of your choice.',
          'An administrative conference will be scheduled after your explanation is received. Your failure to submit an explanation will be taken as a waiver of your right to be heard, and the matter will be decided on the basis of the available records.',
        ],
        closing: ['Please acknowledge receipt of this notice by signing the duplicate copy.'],
      };
    case 'Reply':
    case 'Petition':
      return {
        ...base,
        addressee: to,
        subject,
        salutation,
        intro: [
          `On behalf of our client, ${client.full}, we respectfully submit this ${work.subtype === 'Reply' ? 'reply' : 'request'} within the period allowed by the applicable rules.`,
        ],
        sections: [
          {
            heading: 'Grounds',
            paras: [
              'The findings rest on figures that do not reconcile with the client’s books of account and supporting documents, copies of which are enclosed and indexed for easy reference.',
              'The client has complied with every requirement it was notified of, and the remaining items are addressed in the schedule attached to this letter.',
              'We respectfully request that the matter be evaluated on the basis of the complete records now submitted, and that we be given the opportunity to clarify any item before a decision is made.',
            ],
          },
        ],
        closing: ['We would be grateful for an acknowledgment of receipt.'],
      };
    default:
      return {
        ...base,
        addressee: to,
        subject,
        salutation,
        intro: [
          `On behalf of our client, ${client.full}, we respectfully submit the documents listed in the enclosed schedule in compliance with the applicable requirements.`,
          'The documents have been reviewed for completeness against the agency’s published checklist and are signed by the client’s authorized officers.',
          'Kindly acknowledge receipt by stamping the duplicate copy of this letter. Our liaison officer will be available to settle any fees assessed.',
        ],
        closing: ['Thank you for your assistance.'],
      };
  }
}

/** What a memorandum is about, from its title: "Legal Opinion — X" or "Memorandum on X". */
function memoTopic(title: string): string {
  const dash = title.split(' — ')[1];
  if (dash) return dash.toLowerCase();
  const on = /^(?:Memorandum|Issues List) on (.+)$/i.exec(title);
  return on ? on[1].toLowerCase() : 'the issues raised in this matter';
}

function memorandum(ctx: DocContext): DocumentSpec {
  const { work, matter, client, drafter, reviewer, date, index } = ctx;
  const internal = work.type === DTYPE.INTERNAL;
  const to = internal ? `${reviewer.name}, ${reviewer.position}` : `${client.contact}, ${client.contactTitle}, ${client.full}`;
  return {
    layout: 'memorandum',
    title: work.title,
    date,
    addressee: [`TO:     ${to}`, `FROM:   ${drafter.name}, ${drafter.position}`, `DATE:   ${date}`, `RE:     ${work.title} — ${matter.name}`],
    intro: [],
    sections: [
      { heading: 'Question presented', paras: [`What is ${client.name}’s position on ${memoTopic(work.title)}, and what are the risks of each available course of action?`] },
      { heading: 'Short answer', paras: ['The client is on firm ground if it follows the course recommended below, which keeps its exposure within the range discussed with the responsible partner.'] },
      { heading: 'Discussion', paras: rot(MEMO_DISCUSSION, index).slice(0, 3) },
      { heading: 'Recommendation', paras: ['Adopt the recommended approach, document each step, and schedule a short call with the client’s team to walk through the attached checklist before the next deadline.'] },
    ],
    numbered: false,
    closing: [],
    signer: drafter,
  };
}

function agreement(ctx: DocContext): DocumentSpec {
  const { work, client, date } = ctx;
  return {
    layout: 'agreement',
    title: work.title,
    date,
    intro: [
      `This ${work.title.replace(/ —.*$/, '')} is entered into by and between ${client.full}, a party duly organized or residing in the Philippines, and the counterparty identified in the signature page, each a “Party” and together the “Parties”.`,
      'The Parties, intending to be legally bound, agree as follows:',
    ],
    sections: AGREEMENT_ARTICLES,
    numbered: false,
    closing: ['IN WITNESS WHEREOF, the Parties have signed this instrument on the date and at the place first written above.'],
    signer: { name: client.individual ? client.full : client.contact, position: client.individual ? 'Party' : client.contactTitle },
    signerOrg: client.individual ? '' : client.full,
  };
}

/** The resolution a corporate certificate or minutes carries, by what the title says it is. */
function resolutionText(title: string): string {
  if (/signator/i.test(title)) {
    return '“RESOLVED, that the corporation’s authorized signatories for its accounts with its depository banks shall be the President and the Treasurer, signing jointly, effective immediately, and that all prior authorities inconsistent with this resolution are revoked.”';
  }
  if (/treasurer/i.test(title)) {
    return '“RESOLVED, that the subscriptions to the capital stock listed in the attached schedule are acknowledged as received, and that the Treasurer-in-trust is authorized to hold the paid-up capital until the corporation is registered.”';
  }
  return '“RESOLVED, that the stockholders approve the audited financial statements for the preceding year, ratify all acts of the board and officers during that year, and elect the directors named in the attached list to serve until their successors are elected and qualified.”';
}

function certificate(ctx: DocContext): DocumentSpec {
  const { work, client, date } = ctx;
  return {
    layout: 'certificate',
    title: work.title,
    date,
    intro: [
      `I, the undersigned officer of ${client.full}, a corporation duly organized and existing under Philippine law, certify that at the meeting of its board of directors or stockholders duly called and held, at which a quorum was present and acting throughout, the following was taken up and approved:`,
    ],
    sections: [
      {
        paras: [
          resolutionText(work.title),
          'The foregoing resolution has not been amended or revoked and remains in full force and effect.',
        ],
      },
    ],
    numbered: false,
    closing: [`Prepared by ${FIRM.name} for signature by the corporation’s authorized officer.`],
    signer: { name: '______________________________', position: /treasurer/i.test(work.title) ? 'Treasurer-in-Trust' : 'Corporate Secretary' },
    signerOrg: client.full,
  };
}

/** The full text of one deliverable, laid out for rendering. */
export function composeDocument(ctx: DocContext): DocumentSpec {
  switch (ctx.work.layout) {
    case 'pleading':
      return pleading(ctx);
    case 'letter':
      return letter(ctx);
    case 'memorandum':
      return memorandum(ctx);
    case 'agreement':
      return agreement(ctx);
    default:
      return certificate(ctx);
  }
}

/** Body lines for an incoming court record or correspondence. */
export function incomingBody(kind: string, fromCourt: boolean, nextDate: string | null): string[] {
  if (kind === 'Notice of Hearing') {
    return [
      `Please take notice that the above-entitled case is set for hearing on ${nextDate ?? 'the date indicated by the Branch Clerk'}, at the session hall of this Court.`,
      'Counsel and parties are directed to appear, and to bring the originals of the documents marked as exhibits.',
    ];
  }
  if (kind === 'Order' || kind === 'Resolution') {
    return [
      'Acting on the submission of the parties, and finding the same to be in order, the Court resolves to note the same and to give the parties a period of ten (10) days from notice within which to file their respective comments.',
      nextDate ? `The hearing is reset to ${nextDate}. The parties are warned that no further postponement will be allowed.` : 'Let the records be forwarded for appropriate action.',
      'SO ORDERED.',
    ];
  }
  return fromCourt
    ? ['The Court notes the foregoing and directs the parties to govern themselves accordingly.', 'SO ORDERED.']
    : [
        'Please be advised of the foregoing, and kindly govern yourselves accordingly.',
        'Copies of the supporting annexes are transmitted together with this communication.',
      ];
}
