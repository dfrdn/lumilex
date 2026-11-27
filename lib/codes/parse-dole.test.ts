import { describe, expect, it } from 'vitest';
import { changesInFootnote, laborVersions, mergeChanges, parseDoleLaborCode, type PdfRun } from './parse-dole';

// A run at (x, y) of a given type size; width is rough, as the PDF's would be.
const r = (str: string, x: number, y: number, height: number): PdfRun => ({ str, x, y, height, width: str.length * height * 0.45 });

// Page one: front matter. Page two: a Book, a Title, two articles (one renumbered and footnoted), a footnote.
// Page three, at the other margin: the second article's paragraph runs on, then a new paragraph.
const PAGES: PdfRun[][] = [
  [r('THE LABOR CODE OF THE PHILIPPINES', 100, 700, 20)],
  [
    r('Book Five', 90, 540, 16), r('–', 160, 540, 16), r('LABOR RELATIONS', 172, 540, 16),
    r('Title VI', 110, 500, 14), r('–', 150, 500, 14), r('UNFAIR LABOR', 160, 500, 14),
    r('PRACTICES', 200, 483, 14),
    r('ART. 1.', 54, 450, 9.5), r('Name of Decree.', 88, 450, 9.5), r('–', 160, 450, 9.5), r('This decree shall be known as the “Labor Code of the', 170, 450, 9.5),
    r('Philippines.”', 36, 438, 9.5),
    r('ART. 237.', 54, 417, 9.5), r('[231]', 95, 417, 9.5), r('Registry of Unions.', 120, 417, 9.5), r('1', 205, 420, 6), r('–', 210, 417, 9.5), r('The Bureau shall keep a', 220, 417, 9.5),
    r('registry of legitimate labor', 36, 405, 9.5),
    r('2', 210, 38, 8),
    r('1', 45, 60, 3.5), r('As amended by Sec. 15 of', 48, 58, 5.5), r('R.A. No. 6715', 120, 58, 5.5), r('(1989).', 160, 58, 5.5),
  ],
  [
    r('organizations.', 72, 520, 9.5),
    r('The Bureau shall also maintain a file of all agreements.', 90, 499, 9.5),
    r('3', 300, 38, 8),
  ],
];

describe('parseDoleLaborCode', () => {
  const arts = parseDoleLaborCode(PAGES);

  it('reads the articles from ART. 1 on, with their divisions', () => {
    expect(arts.map((a) => a.number)).toEqual(['1', '237']);
    expect(arts[1].path).toEqual(['Book Five — Labor Relations', 'Title VI — Unfair Labor Practices']);
  });

  it('takes the heading, the former number, and the footnote marked on the heading', () => {
    expect(arts[1].heading).toBe('Registry of Unions');
    expect(arts[1].formerNumber).toBe('231');
    expect(arts[1].footnotes).toEqual(['As amended by Sec. 15 of R.A. No. 6715 (1989).']);
  });

  it('rejoins wrapped lines across a page break and the other page’s margin, and keeps paragraphs apart', () => {
    expect(arts[0].text).toBe('This decree shall be known as the “Labor Code of the Philippines.”');
    expect(arts[1].text).toBe('The Bureau shall keep a registry of legitimate labor organizations.\nThe Bureau shall also maintain a file of all agreements.');
  });
});

describe('changesInFootnote', () => {
  it('reads the law, section and year of an amendment', () => {
    expect(changesInFootnote('As amended by Sec. 15 of R.A. No. 6715 (1989).')).toMatchObject([
      { change: 'amended', instrument: 'Republic Act No. 6715', section: 'sec. 15', year: 1989 },
    ]);
  });
  it('reads each law of a footnote that names several, in the style the edition varies between', () => {
    const changes = changesInFootnote('As amended by Sec. 1, E.O. No. 111 (1986) and Sec. 7 of P.D. 1368 (1978).');
    expect(changes.map((c) => [c.instrument, c.section, c.year])).toEqual([
      ['Executive Order No. 111', 'sec. 1', 1986],
      ['Presidential Decree No. 1368', 'sec. 7', 1978],
    ]);
  });
  it('reads an insertion, and a paragraph’s repeal as the article amended', () => {
    expect(changesInFootnote('Inserted as a new provision pursuant to Sec. 2 of R.A. No. 9481 (2007).')[0].change).toBe('inserted');
    expect(changesInFootnote('First paragraph of this Article was repealed by Sec. 5 of R.A. No. 7796 (1994).')[0]).toMatchObject({ change: 'amended', instrument: 'Republic Act No. 7796' });
  });
  it('records nothing for a footnote about other laws, or the Code named in an amending law’s title', () => {
    expect(changesInFootnote('See also Sec. 23 of R.A. No. 8042, as amended by Sec. 14 of R.A. 10022.')).toEqual([]);
    expect(changesInFootnote('Amended by R.A. No. 11360 (2019), An Act … Amending for the Purpose Presidential Decree No. 442, as Amended.').map((c) => c.instrument))
      .toEqual(['Republic Act No. 11360']);
  });
  it('stops at the editorial sentence after the statement', () => {
    expect(changesInFootnote('As amended by P.D. No. 891 (1976). First paragraph of (z) is deemed superseded by Section 8 (n) of R.A. No. 8282.').map((c) => c.instrument))
      .toEqual(['Presidential Decree No. 891']);
  });
  it('merges a law named twice into one change with the fullest details', () => {
    const merged = mergeChanges([...changesInFootnote('As amended by P.D. No. 891 (1976).'), ...changesInFootnote('Par. (a), as amended by Sec. 1 of P.D. No. 891.')]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ section: 'sec. 1', year: 1976 });
  });
});

describe('laborVersions', () => {
  const base = { number: '237', formerNumber: '231', heading: 'Registry of Unions', text: 'The Bureau shall keep a registry.', path: [] };

  it('runs original → amendments → renumbering, with text only from the last change to the words', () => {
    const v = laborVersions({ ...base, footnotes: ['As amended by Sec. 15 of R.A. No. 6715 (1989).'] }, '1974-05-01', 'https://dole.gov.ph');
    expect(v.map((x) => [x.seq, x.change, x.number])).toEqual([[0, 'original', '231'], [1, 'amended', '231'], [2, 'renumbered', '237']]);
    expect(v.map((x) => x.text !== null)).toEqual([false, true, true]);
    expect(v[1].instrument).toBe('Republic Act No. 6715 (1989)');
  });

  it('puts an amendment after 2015 after the renumbering, under the new number', () => {
    const v = laborVersions({ ...base, footnotes: ['As amended by R.A. No. 7641 (1992).', 'As amended by R.A. No. 10789 (2016).'] }, '1974-05-01', '');
    expect(v.map((x) => [x.change, x.number])).toEqual([['original', '231'], ['amended', '231'], ['renumbered', '237'], ['amended', '237']]);
  });

  it('opens with the insertion for an article the Code did not have, and keeps the original text when nothing changed', () => {
    expect(laborVersions({ ...base, formerNumber: null, footnotes: ['Inserted as a new provision pursuant to Sec. 2 of R.A. No. 9481 (2007).'] }, '1974-05-01', '')[0].change).toBe('inserted');
    const plain = laborVersions({ ...base, formerNumber: null, footnotes: ['See the policy declarations in Sec. 3, Article XIII of the 1987 Constitution.'] }, '1974-05-01', '');
    expect(plain).toHaveLength(1);
    expect(plain[0].text).toBe(base.text);
    expect(plain[0].note).toContain('1987 Constitution');
  });
});
