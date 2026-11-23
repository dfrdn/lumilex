import { describe, expect, it } from 'vitest';
import {
  cleanText, healLigatures, joinDropCaps, numberingGaps, parseEvidenceFromComparative, parseRules, parseRulesText, skeletonSimilarity, splitTitle,
} from './parse-rules-of-court';

const CIVIL = `
COVER PAGE
RULE 1
GENERAL PROVISIONS
Section 1. Title of the Rules. – These Rules shall be known and cited as the Rules of Court. (1)
Section 2. In what courts applicable. – These Rules shall apply in all the courts, except as otherwise
provided by the Supreme Court. (n)
Rule 1
12
2019 Amendments to the 1997 Rules of Civil Procedure
CIVIL ACTIONS
ORDINARY CIVIL ACTIONS
RULE 2
CAUSE OF ACTION
S
ection 1. Ordinary civil actions, basis of. – Every ordinary civil action must be based on a cause of
action. (n)
Section 2. Conveyance of real property; certificate thereof given to purchaser and filed with registry
of deeds. – Upon a sale of real property, the officer must give to the purchaser a certificate of sale
containing:
(a) A particular description of the real property sold;
(b) The price paid; and
Rules 2-3
(c) A statement that the right of redemption expires one (1) year from the date of registration. (25a)
RULE 16
MOTION TO DISMISS
X X X X X X
RULE 144
EFFECTIVENESS
These [R]ules shall take effect on January 1, 1964.
RULE 6
KINDS OF PLEADINGS
1997 RULES OF CIVIL PROCEDURE2019 AMENDMENTS
Section 1. Pleadings defined. ± Old text that must not be imported.
`;

describe('cleanText', () => {
  it('drops amendment brackets, replacement characters, and tidies spacing', () => {
    expect(cleanText('these [R]ules , as [a]mended')).toBe('these Rules, as amended');
    expect(cleanText('BURDEN OF PROOF,\uFFFDBURDEN OF EVIDENCE')).toBe('BURDEN OF PROOF, BURDEN OF EVIDENCE');
  });
});

describe('splitTitle', () => {
  it('splits on en dash, em dash, hyphen and the PDF ± glyph', () => {
    expect(splitTitle('Caption. – The caption sets forth')).toEqual({ title: 'Caption', text: 'The caption sets forth' });
    expect(splitTitle('Complaint defined.—A complaint is')).toEqual({ title: 'Complaint defined', text: 'A complaint is' });
    expect(splitTitle('Scope. - The rules')).toEqual({ title: 'Scope', text: 'The rules' });
    expect(splitTitle('Pleadings defined. ± Pleadings are')).toEqual({ title: 'Pleadings defined', text: 'Pleadings are' });
  });
  it('falls back to the first short sentence when there is no dash', () => {
    expect(splitTitle('Original of document. (a) An original of a document')).toEqual({ title: 'Original of document', text: '(a) An original of a document' });
    expect(splitTitle('Of two constructions, which preferred . When the terms')).toEqual({ title: 'Of two constructions, which preferred', text: 'When the terms' });
  });
  it('does not mistake a hyphenated word for the title dash', () => {
    expect(splitTitle('Pre-trial brief. – The parties shall file').title).toBe('Pre-trial brief');
  });
});

describe('joinDropCaps', () => {
  it('rejoins the drop-cap S the PDF sets on its own line', () => {
    expect(joinDropCaps(['S', 'ection 2. The body. – Text', 'S', 'not a section'])).toEqual(['Section 2. The body. – Text', 'S', 'not a section']);
  });
});

describe('parseRules (civil)', () => {
  const { rules, sections } = parseRules('civil', CIVIL);

  it('stops before the comparative table and skips running headers and page numbers', () => {
    expect(sections.map((s) => `${s.rule}:${s.section}`)).toEqual(['1:1', '1:2', '2:1', '2:2']);
    expect(sections.every((s) => !/Rules 2-3|^12$/.test(s.text))).toBe(true);
  });

  it('records rule headers, including a deleted rule with no sections', () => {
    expect(rules.map((r) => [r.rule, r.title, r.sectionCount])).toEqual([
      [1, 'GENERAL PROVISIONS', 2],
      [2, 'CAUSE OF ACTION', 2],
      [16, 'MOTION TO DISMISS', 0],
      [144, 'EFFECTIVENESS', 0],
    ]);
  });

  it('carries the part heading that precedes a rule', () => {
    expect(sections.find((s) => s.rule === 2)?.part).toBe('CIVIL ACTIONS — ORDINARY CIVIL ACTIONS');
    expect(sections.find((s) => s.rule === 1)?.part).toBeNull();
  });

  it('joins wrapped lines, keeps list items on their own lines, and reads a wrapped title', () => {
    const s = sections.find((x) => x.rule === 2 && x.section === 2)!;
    expect(s.title).toBe('Conveyance of real property; certificate thereof given to purchaser and filed with registry of deeds');
    expect(s.text.split('\n')).toEqual([
      'Upon a sale of real property, the officer must give to the purchaser a certificate of sale containing:',
      '(a) A particular description of the real property sold;',
      '(b) The price paid; and',
      '(c) A statement that the right of redemption expires one (1) year from the date of registration. (25a)',
    ]);
    expect(sections.find((x) => x.rule === 1 && x.section === 2)?.text).toBe('These Rules shall apply in all the courts, except as otherwise provided by the Supreme Court. (n)');
  });

  it('reports no numbering gaps', () => {
    expect(numberingGaps(sections)).toEqual([]);
  });
});

describe('parseRulesText (criminal)', () => {
  it('starts at Rule 110, reads SECTION/Sec. forms and em-dash titles', () => {
    const text = `AI Summary\nSome editorial text.\nRULE 110\nPROSECUTION OF OFFENSES\nSECTION 1. Institution of criminal actions.—Criminal actions shall be instituted as follows: (1a)\nSec. 2. The complaint or information.—The complaint shall be in writing. (2a)\n`;
    const secs = parseRulesText('criminal', text);
    expect(secs.map((s) => [s.section, s.title])).toEqual([[1, 'Institution of criminal actions'], [2, 'The complaint or information']]);
    expect(secs[0].text).toBe('Criminal actions shall be instituted as follows: (1a)');
  });
});

describe('sub-headings inside a rule', () => {
  it('keeps "A. OBJECT (REAL) EVIDENCE" as a heading of the sections under it, not a part', () => {
    const text = `RULE 130\nRULES OF ADMISSIBILITY\nA. OBJECT (REAL) EVIDENCE\nSection 1. Object as evidence. - Objects as evidence are those addressed to the senses of the court. (1)\nB. DOCUMENTARY EVIDENCE\nSection 2. Documentary evidence. - Documents as evidence consist of writings. (2a)\n1. Original Document Rule\nSection 3. Original document must be produced; exceptions. - When the subject of inquiry is the contents of a document. (3a)\n`;
    const secs = parseRulesText('evidence', text);
    expect(secs.map((s) => [s.section, s.heading])).toEqual([[1, 'A. OBJECT (REAL) EVIDENCE'], [2, 'B. DOCUMENTARY EVIDENCE'], [3, '1. Original Document Rule']]);
    expect(secs[0].part).toBeNull();
  });
});

describe('healLigatures', () => {
  it('joins a ligature split only when the joined word is known', () => {
    expect(healLigatures('the staff of the court off ered it and specifi ed', new Set(['offered', 'specified']))).toBe('the staff of the court offered it and specified');
  });
});

describe('parseEvidenceFromComparative', () => {
  const lawphil = `RULE 128\nGENERAL PROVISIONS\nSection 1. Evidence defined. - Evidence is the means, sanctioned by these rules, of ascertaining in a judicial proceeding the truth respecting a matter of fact. (1)\nSection 2. Scope. - The rules of evidence shall be the same in all courts and in all trials and hearings, except as otherwise provided bylaw or these rules. (2)\n`;
  const pdf = `RULE 128\nTABLE OF CONTENTS\nRULE 128\nGENERAL PROVISIONS\nREVISED RULES ON EVIDENCE2019 AMENDMENTS\nSection 1. Evidence defi ned. – Evidence\nis the means, sanctioned by these rules, of\nascertaining in a judicial proceeding the truth\nrespecting a matter of fact. (1)\nSection 1. Evidence defi ned. – Evidence is\nthe means, sanctioned by these [R]ules, of\nascertaining in a judicial proceeding the truth\nrespecting a matter of fact. (1)\nSection 2. Scope. – The rules of evidence\nshall be the same in all courts and in all trials\nand hearings, except as otherwise provided\nby law or these rules. (2a)\nSection 2. Scope. – The rules of evidence\nshall be the same in all courts and in all trials\nand hearings, except as otherwise provided\nby law or these [R]ules. (2)\n29\nCĔĒĕĆėĆęĎěĊ TĆćđĊ Ĕċ ęčĊ 1989\n`;

  it('picks the 2019 block for each lawphil section and keeps the PDF spacing', () => {
    const secs = parseEvidenceFromComparative(pdf, lawphil);
    expect(secs).toHaveLength(2);
    expect(secs[0].title).toBe('Evidence defined');
    expect(secs[0].text).toBe('Evidence is the means, sanctioned by these Rules, of ascertaining in a judicial proceeding the truth respecting a matter of fact. (1)');
    expect(secs[1].text).toBe('The rules of evidence shall be the same in all courts and in all trials and hearings, except as otherwise provided by law or these Rules. (2)');
  });

  it('keeps the lawphil text when no PDF block matches', () => {
    const secs = parseEvidenceFromComparative('RULE 128\nGENERAL PROVISIONS\n', lawphil);
    expect(secs[1].text).toContain('bylaw');
  });

  it('scores identical skeletons as 1', () => {
    expect(skeletonSimilarity('Off ered evidence', 'offered evidence')).toBe(1);
  });
});
