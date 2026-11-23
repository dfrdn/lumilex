import { describe, expect, it } from 'vitest';
import { buildCasePlan, classifyForum, docketKey, looksMultiDocket, respondentWords, type SourceMatter } from './backfill-plan';

let n = 0;
function matter(over: Partial<SourceMatter>): SourceMatter {
  n += 1;
  return {
    id: `m${n}`,
    code: `1-20-${n}`,
    name: `Matter ${n}`,
    type: 'Litigation',
    status: 'Ongoing',
    clientId: 'c1',
    clientName: 'Client',
    caseNumber: '',
    court: '',
    caseTitle: '',
    relatedMatterIds: [],
    ...over,
  };
}

describe('docketKey', () => {
  it('drops the docket prefix and punctuation', () => {
    expect(docketKey('NPS Docket No. XV-03-INV-26A-01234')).toBe('XV03INV26A01234');
    expect(docketKey('NPS Docket No. XV-03-INV-26A01234')).toBe('XV03INV26A01234');
    expect(docketKey('Crim. Case No. Br. 20-01111-01114')).toBe(docketKey('Criminal Case Nos. Br. 20-01111-01114'));
    expect(docketKey('G.R. No. 200002')).toBe('200002');
  });
});

describe('looksMultiDocket', () => {
  it('spots a field holding two numbers', () => {
    expect(looksMultiDocket('D.C. 2025-05/26-765, WLO 2025-765')).toBe(true);
    expect(looksMultiDocket('NPS Docket No. XV-03-INV-22J-08137')).toBe(false);
  });
});

describe('classifyForum', () => {
  it.each([
    ['OCP, Quezon City', 'prosecutor', null],
    ['NPS - Office of the City Prosecutor, Makati City', 'prosecutor', null],
    ['OPP - San Fernando, Pampanga', 'prosecutor', null],
    ['Department of Justice, Manila', 'doj', null],
    ['DOJ, San Fernando, Pampanga', 'doj', null],
    ['RTC Br. 20, Cauayan, Isabela', 'court', 'rtc'],
    ['FC - Branch 18, Cainta, Rizal', 'court', 'rtc'],
    ['MeTC - Branch 124, Las Piñas City', 'court', 'mtc'],
    ['10th MCTC - Roxas-Quirino, Isabela', 'court', 'mtc'],
    ['CA- Manila', 'court', 'ca'],
    ['Court of Appeals, Cagayan de Oro', 'court', 'ca'],
    ['SC - 2nd Division, Manila', 'court', 'sc'],
    ['DOLE - NLRC, Quezon City', 'labor', null],
    ['RCMB - NCR, Intramuros, Manila', 'labor', null],
    ['NBI, Pasay City', 'law_enforcement', null],
    ['Office of the Ombusdman, Quezon City', 'ombudsman', null],
    ['Securities and Exchange Commission', 'agency', null],
    ['SEC', 'agency', null],
    ['COA, ORD, San Fernando, Pampanga', 'agency', null],
    ['', 'unknown', null],
  ])('%s', (office, type, level) => {
    expect(classifyForum(office)).toEqual({ type, level });
  });
});

describe('buildCasePlan', () => {
  it('makes an OCP complaint and its DOJ review one case with two proceedings', () => {
    const ocp = matter({ name: 'Castillo v. Navarro (OCP)', status: 'Done', caseNumber: 'NPS Docket No. XV-03-INV-26A01234', court: 'OCP, Quezon City' });
    const doj = matter({ name: 'Castillo v. Navarro (DOJ)', caseNumber: 'NPS Docket No. XV-03-INV-26A-01234', court: 'DOJ, Manila' });
    const plan = buildCasePlan([doj, ocp], new Map([[doj.id, 2]]));
    expect(plan.cases).toHaveLength(1);
    const [c] = plan.cases;
    expect(c.title).toBe('Castillo v. Navarro');
    expect(c.status).toBe('active');
    expect(c.proceedings.map((p) => [p.forum.type, p.relation, p.resolved])).toEqual([
      ['prosecutor', 'original', true],
      ['doj', 'review', false],
    ]);
    expect(c.proceedings[1].parentKey).toBe(c.proceedings[0].key);
    expect(c.proceedings[1].hearingCount).toBe(2);
    expect(c.flags).toEqual([]);
  });

  it('reads the forum from the matter name when no court is recorded', () => {
    const ocp = matter({ name: 'A v. B (OCP)', caseNumber: 'NPS Docket No. XV-07-INV-26B-04321', court: 'OCP, Manila' });
    const doj = matter({ name: 'A v. B (DOJ)', caseNumber: 'NPS Docket No. XV-07-INV-26B-04321', court: '' });
    const [c] = buildCasePlan([ocp, doj], new Map()).cases;
    expect(c.proceedings.map((p) => [p.forum.type, p.relation])).toEqual([
      ['prosecutor', 'original'],
      ['doj', 'review'],
    ]);
    expect(c.flags).toEqual([]);
  });

  it('puts several clients in one forum on one proceeding', () => {
    const a = matter({ clientId: 'c1', caseNumber: 'SPA No. 26-001 (DC)', court: 'Commission on Elections, Intramuros, Manila' });
    const b = matter({ clientId: 'c2', caseNumber: 'SPA No. 26-001 (DC)', court: 'Commission on Elections, Intramuros, Manila' });
    const [c] = buildCasePlan([a, b], new Map()).cases;
    expect(c.proceedings).toHaveLength(1);
    expect(c.flags).not.toContain(expect.stringMatching(/office names/));
    expect(c.proceedings[0].matterIds).toEqual([a.id, b.id]);
    expect(c.clientIds).toEqual(['c1', 'c2']);
    expect(c.flags).toContain('2 clients');
  });

  it('lets a matter cover the evaluation phase rather than a proceeding', () => {
    const study = matter({ code: '87-20-0', name: 'Collection of Refund', status: 'Archived', caseNumber: 'NBI CCN: C-26-00011, NCR-26-0001', court: 'NBI Manila' });
    const complaint = matter({ code: '87-20-1', name: 'Sps. Reyes v. Domingo', status: 'Archived', caseNumber: 'NBI CCN C-26-00011, NCR-26-0001', court: 'National Bureau of Investigation' });
    const [c] = buildCasePlan([study, complaint], new Map(), { evaluation: ['87-20-0'] }).cases;
    expect(c.evaluationMatterIds).toEqual([study.id]);
    expect(c.proceedings).toHaveLength(1);
    expect(c.proceedings[0].matterIds).toEqual([complaint.id]);
    expect(c.status).toBe('closed');
  });

  it('leaves out what isn’t a case and lists litigation with no case data', () => {
    const permit = matter({ code: '244-20-1', caseNumber: 'Exploration Permit No. 000001-X', court: 'Mines and Geosciences Bureau' });
    const bare = matter({});
    const retainer = matter({ type: 'Retainer' });
    const plan = buildCasePlan([permit, bare, retainer], new Map(), { exclude: { '244-20-1': 'a permit' } });
    expect(plan.cases).toEqual([]);
    expect(plan.excluded.map((e) => e.reason)).toEqual(['a permit']);
    expect(plan.withoutCase).toEqual([bare]);
  });

  it('flags what can’t be read from the record', () => {
    const rtc = matter({ status: 'Done', caseNumber: 'Civil Case No. 123', court: 'RTC Branch 93, Quezon City' });
    const ca = matter({ caseNumber: 'Civil Case No. 123', court: 'Court of Appeals, Manila' });
    const titleOnly = matter({ caseTitle: 'X v. Y' });
    const plan = buildCasePlan([rtc, ca, titleOnly], new Map());
    const appeal = plan.cases.find((c) => c.proceedings.length === 2)!;
    expect(appeal.proceedings[1].relation).toBe('appeal');
    expect(appeal.flags.some((f) => f.startsWith('check how'))).toBe(true);
    const bare = plan.cases.find((c) => c.title === 'X v. Y')!;
    expect(bare.status).toBe('evaluation');
    expect(bare.flags).toContain('title only — no court or docket recorded');
  });

  it('takes the caption from the matter names when case_title holds the nature', () => {
    const a = matter({ name: 'Bautista v. Pascual', caseTitle: 'Cyber Libel', caseNumber: 'R-1', court: 'RTC Branch 93, Quezon City' });
    const b = matter({ name: 'People v. Pascual (GRT)', caseTitle: 'Cyber Libel', caseNumber: 'R-1', court: 'RTC - Branch 93, Quezon City' });
    const [c] = buildCasePlan([a, b], new Map()).cases;
    expect(c.title).toBe('People v. Pascual');
    expect(c.nature).toBe('Cyber Libel');
  });

  it('keeps a case_title that reads like a caption', () => {
    const a = matter({ name: 'BI Case', caseTitle: 'In re: Deportation of X', caseNumber: 'D.C. 1', court: 'Bureau of Immigration' });
    const [c] = buildCasePlan([a], new Map()).cases;
    expect(c.title).toBe('In re: Deportation of X');
    expect(c.nature).toBeNull();
  });

  it('merges a chain into one tree: DOJ review and the Information both hang off the OCP', () => {
    const ocp = matter({ code: '103-20-4', name: 'Northwind Power v. Valdez, et al. (OCP)', status: 'Done', caseNumber: 'NPS Docket Nos. 26C-00777', court: 'OCP, Pasig City' });
    const doj = matter({ code: '103-20-9', name: 'Northwind Power v. Valdez, et al. (DOJ)', caseNumber: 'NPS Docket Nos. 26C-00777 and Criminal Case Nos. R-PSG-26-00555-CR', court: 'DOJ, Manila' });
    const rtc = matter({ code: '103-20-8', name: 'People v. Valdez, et al.', caseNumber: 'Criminal Case Nos. R-PSG-26-00555-CR', court: 'RTC, Branch 164, Pasig City' });
    const plan = buildCasePlan([ocp, doj, rtc], new Map(), { merge: [['103-20-4', '103-20-9', '103-20-8']] });
    expect(plan.cases).toHaveLength(1);
    const [c] = plan.cases;
    const byForum = Object.fromEntries(c.proceedings.map((p) => [p.forum.level ?? p.forum.type, p]));
    expect(byForum.doj.relation).toBe('review');
    expect(byForum.doj.parentKey).toBe(byForum.prosecutor.key);
    expect(byForum.rtc.relation).toBe('information');
    expect(byForum.rtc.parentKey).toBe(byForum.prosecutor.key);
    expect(byForum.prosecutor.caption).toBe('Northwind Power v. Valdez, et al.');
    expect(c.title).toBe('People v. Valdez, et al.');
    expect(c.flags.filter((f) => f.startsWith('check how'))).toEqual([]);
  });

  it('reads Rule 65 and Rule 45 from the nature, and a Rule 65 branch never titles the case', () => {
    const rtc = matter({ code: '34-20-1', name: 'Herrera v. Sy (RTC)', caseTitle: 'Annulment of Title', caseNumber: 'R-QZN-26-00888-CV', court: 'RTC - Branch 84, Quezon City' });
    const ca = matter({ code: '34-20-0', name: 'Herrera v. Sy (CA)', caseTitle: 'Certiorari under Rule 65 of the Rules of Court', caseNumber: 'CA-G.R. SP No. 100001', court: 'CA Manila - 2nd Division' });
    const sc = matter({ code: '34-20-2', name: 'Sy v. Herrera (SC)', caseTitle: 'Certiorari under Rule 45 of the Rules of Court', caseNumber: 'G.R. No. 200002', court: 'SC, Manila' });
    const [c] = buildCasePlan([rtc, ca, sc], new Map(), { merge: [['34-20-0', '34-20-1', '34-20-2']] }).cases;
    const byLevel = Object.fromEntries(c.proceedings.map((p) => [p.forum.level, p]));
    expect(byLevel.ca.relation).toBe('rule_65');
    expect(byLevel.ca.parentKey).toBe(byLevel.rtc.key);
    expect(byLevel.sc.relation).toBe('rule_45');
    expect(byLevel.sc.parentKey).toBe(byLevel.ca.key);
    expect(c.title).toBe('Herrera v. Sy');
    expect(c.flags.filter((f) => f.startsWith('check how'))).toEqual([]);
  });

  it('takes the nature from the first filing, not a later petition', () => {
    const rtc = matter({ code: '34-20-1', name: 'Herrera v. Sy (RTC)', caseTitle: 'Annulment of Title', caseNumber: 'R-1', court: 'RTC Branch 84' });
    const ca = matter({ code: '34-20-0', name: 'Herrera v. Sy (CA)', caseTitle: 'Certiorari under Rule 65', caseNumber: 'CA-1', court: 'CA Manila' });
    const [c] = buildCasePlan([ca, rtc], new Map(), { merge: [['34-20-0', '34-20-1']] }).cases;
    expect(c.nature).toBe('Annulment of Title');
  });

  it('treats a proceeding with a review filed on it as resolved', () => {
    const ocp = matter({ code: '108-20-1', name: 'Uy v. Go (OCP)', caseNumber: 'XV-03-INV-26D-00999', court: 'OCP, Quezon City' });
    const doj = matter({ code: '108-20-3', name: 'Uy v. Go (DOJ)', caseNumber: 'NPS Docket No. XV-03-INV-26D-00999', court: 'DOJ, Manila' });
    const [c] = buildCasePlan([ocp, doj], new Map()).cases;
    const [first, review] = c.proceedings;
    expect(first.resolved).toBe(true);
    expect(first.stage).toBe('resolved');
    expect(review.resolved).toBe(false);
    expect(c.status).toBe('active');
  });

  it('keeps a case open while a hearing is still to come', () => {
    const m = matter({ status: 'Done', caseNumber: 'R-2', court: 'RTC Branch 84' });
    const plan = buildCasePlan([m], new Map(), { upcomingHearings: new Set([m.id]) });
    expect(plan.cases[0].status).toBe('active');
    expect(plan.cases[0].proceedings[0].resolved).toBe(false);
  });

  it('treats an NBI complaint sent to the prosecutor as a referral', () => {
    const nbi = matter({ code: '102-20-1', name: 'Patel v. Mendez (NBI)', court: 'NBI', caseNumber: 'NBI-1' });
    const ocp = matter({ code: '102-20-2', name: 'Patel v. Mendez (OCP)', caseNumber: 'NPS VII-09', court: 'OCP, Cebu City' });
    const [c] = buildCasePlan([nbi, ocp], new Map(), { merge: [['102-20-1', '102-20-2']] }).cases;
    expect(c.proceedings.map((p) => [p.forum.type, p.relation])).toEqual([
      ['law_enforcement', 'original'],
      ['prosecutor', 'referral'],
    ]);
  });

  it('picks out related cases that look like one dispute under a new docket', () => {
    const complaint = matter({ name: 'Northwind Power v. Valdez, et al.', caseNumber: 'NPS XV-1', court: 'OCP, Pasig City' });
    const crim = matter({ name: 'People v. Valdez, et al.', caseNumber: 'Crim. Case No. 99', court: 'RTC Br. 268, Pasig City', relatedMatterIds: [complaint.id] });
    const other = matter({ name: 'Harbor Asia v. Lopez', caseNumber: 'Civil 1', court: 'MeTC Branch 13, Manila', relatedMatterIds: [complaint.id] });
    const plan = buildCasePlan([complaint, crim, other], new Map());
    expect(plan.related).toHaveLength(2);
    expect(plan.likelySameDispute).toHaveLength(1);
    const titles = plan.likelySameDispute[0].map((k) => plan.cases.find((c) => c.key === k)!.title).sort();
    expect(titles).toEqual(['Northwind Power v. Valdez, et al.', 'People v. Valdez, et al.']);
  });

  it('flags an unlinked pair with the same caption and nature at different levels', () => {
    const rtc = matter({ name: 'Navarro v. Castillo', caseTitle: 'Cancellation of Birth Record', caseNumber: 'Special Proceedings No R-0001', court: 'RTC - Branch 6, Dipolog City' });
    const ca = matter({ name: 'Navarro v. Castillo', caseTitle: 'Cancellation of Birth Record', caseNumber: 'C.A.-G.R. CV No. 00001-MIN', court: 'CA-Mindanao, Cagayan de Oro City' });
    const sameLevel = matter({ name: 'Navarro v. Castillo', caseTitle: 'Cancellation of Birth Record', caseNumber: 'Other 1', court: 'RTC Branch 9, Dipolog' });
    const plan = buildCasePlan([rtc, ca, sameLevel], new Map());
    expect(plan.related).toEqual([]);
    expect(plan.likelySameDispute).toHaveLength(2);
  });

  it('reads respondents from a caption', () => {
    expect([...respondentWords('People v. Valdez, et al.')]).toEqual(['valdez']);
    expect([...respondentWords('Execution Cases')]).toEqual([]);
  });

  it('links cases whose matters are related', () => {
    const a = matter({ caseNumber: 'R-QZN-26-00123-24-CR', court: 'RTC Branch 93, Quezon City' });
    const b = matter({ caseNumber: 'Br. 20-01111-01114', court: 'RTC Br. 20, Cauayan', relatedMatterIds: [a.id] });
    const plan = buildCasePlan([a, b], new Map());
    expect(plan.cases).toHaveLength(2);
    expect(plan.related).toHaveLength(1);
  });
});
