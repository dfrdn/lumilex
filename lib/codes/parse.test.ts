import { describe, expect, it } from 'vitest';
import { mendPages, numberingGaps, parseSectionedCode, splitSectionOpening } from './parse';

const SAMPLE = [
  'Republic of the Philippines',
  'Be it enacted by the Senate and House of Representatives of the Philippines in Congress assembled:',
  'TITLE I',
  'GENERAL PROVISIONS',
  'DEFINITIONS AND CLASSIFICATIONS',
  'SECTION 1. Title of the Code. – This Code shall be known as the “Revised Corporation Code of the Philippines”.',
  'SEC. 2. Corporation Defined. – A corporation is an artificial being.',
  '=== PAGE 2 ===',
  'SEC. 3. Corporations Created by Special Laws or Charters. – Corporations created by special laws shall be governed',
  '=== PAGE 3 ===',
  'primarily by the special law.',
  'Holders of nonvoting shares shall nevertheless be entitled to vote on the following matters:',
  '(a) Amendment of the articles of incorporation;',
  'TITLE XI',
  'NONSTOCK CORPORATION',
  'CHAPTER I',
  'MEMBERS',
  'SEC. 4. Right to Vote. – Each member shall be entitled to one vote.',
  'Approved,',
  'GLORIA MACAPAGAL-ARROYO',
].join('\n');

describe('parseSectionedCode', () => {
  const parsed = parseSectionedCode(SAMPLE);

  it('reads each section from the first division to the signatures', () => {
    expect(parsed.map((p) => p.number)).toEqual(['1', '2', '3', '4']);
    expect(parsed.at(-1)?.text).toBe('Each member shall be entitled to one vote.');
  });

  it('splits the heading from the text at the dash', () => {
    expect(parsed[0].heading).toBe('Title of the Code');
    expect(parsed[0].text).toBe('This Code shall be known as the “Revised Corporation Code of the Philippines”.');
  });

  it('rejoins a paragraph the page cut, and keeps enumerated items as their own lines', () => {
    expect(parsed[2].text).toBe([
      'Corporations created by special laws shall be governed primarily by the special law.',
      'Holders of nonvoting shares shall nevertheless be entitled to vote on the following matters:',
      '(a) Amendment of the articles of incorporation;',
    ].join('\n'));
  });

  it('records the divisions above each section, a title closing the chapters of the last', () => {
    expect(parsed[0].path).toEqual(['Title I — General Provisions', 'Definitions and Classifications']);
    expect(parsed[3].path).toEqual(['Title XI — Nonstock Corporation', 'Chapter I — Members']);
  });
});

describe('mendPages', () => {
  it('keeps a paragraph that ended at the break apart from the next', () => {
    expect(mendPages('First paragraph ends here.\n=== PAGE 4 ===\nSecond begins.')).toEqual(['First paragraph ends here.', 'Second begins.']);
  });
  it('joins a word hyphenated across the break', () => {
    expect(mendPages('the corpo-\n=== PAGE 9 ===\nration shall')).toEqual(['the corporation shall']);
  });
});

describe('splitSectionOpening', () => {
  it('keeps periods inside the heading', () => {
    expect(splitSectionOpening('Corporations Created by Special Laws or Charters. – Corporations created…')).toEqual({
      heading: 'Corporations Created by Special Laws or Charters',
      text: 'Corporations created…',
    });
  });
});

describe('numberingGaps', () => {
  it('finds a section the parse missed', () => {
    expect(numberingGaps([{ number: '1' }, { number: '2' }, { number: '4' }])).toEqual([3]);
  });
});
