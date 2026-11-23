import { describe, it, expect } from 'vitest';
import { boldRuns, labelText, peso, withCurrencyPrefix } from './letterhead';
import { FONT_SETS } from './fonts';

/** The bundled Garamond default — its faces carry ₱. */
const STANDARD = FONT_SETS.standard;
/** The standard-PDF-font set — WinAnsi core faces, no ₱. */
const CORE = FONT_SETS.core;

describe('labelText', () => {
  it('punctuates a bare lead-in', () => {
    expect(labelText('Priority access')).toBe('Priority access.');
  });

  it('does not double a full stop the author already typed', () => {
    // A sent proposal printed "General legal support.." this way.
    expect(labelText('General legal support.')).toBe('General legal support.');
  });

  it('leaves other terminal punctuation alone', () => {
    expect(labelText('Conforme:')).toBe('Conforme:');
  });

  it('drops trailing space before punctuating', () => {
    expect(labelText('Trademark filing ')).toBe('Trademark filing.');
  });
});

describe('boldRuns', () => {
  it('leaves plain text as a single run', () => {
    expect(boldRuns('Nothing emphasised here.')).toEqual([
      { text: 'Nothing emphasised here.', bold: false },
    ]);
  });

  it('moves the space after a bold run onto the bold run itself', () => {
    // pdfkit drops leading whitespace when a justified continued run resumes,
    // so the separator has to ride on the end of the preceding fragment or the
    // words weld together ("Initial Feefor Retainer Services").
    expect(boldRuns('The **Initial Fee** for Retainer Services')).toEqual([
      { text: 'The ', bold: false },
      { text: 'Initial Fee ', bold: true },
      { text: 'for Retainer Services', bold: false },
    ]);
  });

  it('never leaves a fragment starting with whitespace', () => {
    const runs = boldRuns('a **b** c **d** e');
    expect(runs.every((r) => !/^\s/.test(r.text))).toBe(true);
  });

  it('handles a paragraph opening with a bold run', () => {
    expect(boldRuns('**Engagement and term.** The engagement will commence…')).toEqual([
      { text: 'Engagement and term. ', bold: true },
      { text: 'The engagement will commence…', bold: false },
    ]);
  });

  it('handles adjacent bold runs with no space between them', () => {
    expect(boldRuns('**a****b**')).toEqual([
      { text: 'a', bold: true },
      { text: 'b', bold: true },
    ]);
  });

  it('drops the empty fragments that splitting produces', () => {
    expect(boldRuns('**whole thing bold**')).toEqual([{ text: 'whole thing bold', bold: true }]);
  });

  it('treats an unclosed marker as literal text', () => {
    expect(boldRuns('P15,000.00 ** not a marker')).toEqual([
      { text: 'P15,000.00 ** not a marker', bold: false },
    ]);
  });

  it('keeps a trailing space that already sits on the bold run', () => {
    expect(boldRuns('The **Initial Fee ** for')).toEqual([
      { text: 'The ', bold: false },
      { text: 'Initial Fee  ', bold: true },
      { text: 'for', bold: false },
    ]);
  });
});

describe('peso', () => {
  it('writes currency with two decimals', () => {
    expect(peso(15000, CORE)).toBe('P15,000.00');
  });

  it('groups thousands', () => {
    expect(peso(1234567.5, CORE)).toBe('P1,234,567.50');
  });

  it('rounds to centavos', () => {
    expect(peso(3612.499, CORE)).toBe('P3,612.50');
  });

  it('handles zero', () => {
    expect(peso(0, CORE)).toBe('P0.00');
  });

  it('falls back to "P" when the resolved faces have no ₱ glyph', () => {
    // The core PDF fonts are WinAnsi-encoded; printing ₱ would emit a notdef box.
    expect(CORE.hasPesoGlyph).toBe(false);
    expect(peso(100, CORE)).not.toContain('₱');
  });

  it('prints ₱ when the set declares the glyph', () => {
    // The bundled Garamond faces carry U+20B1; the default set says so.
    expect(STANDARD.hasPesoGlyph).toBe(true);
    expect(peso(100, STANDARD)).toBe('₱100.00');
  });
});

describe('withCurrencyPrefix', () => {
  it('re-prefixes an amount authored under the other symbol', () => {
    // A proposal drafted while the firm was on a core-font set, rendered now
    // that it is on the bundled default — the fee schedule bound behind the
    // letter sets ₱, so the letter's own table has to as well.
    expect(withCurrencyPrefix('P50,000.00', '₱')).toBe('₱50,000.00');
    expect(withCurrencyPrefix('₱50,000.00', 'P')).toBe('P50,000.00');
  });

  it('leaves an amount already in the right symbol alone', () => {
    expect(withCurrencyPrefix('₱1,200.00', '₱')).toBe('₱1,200.00');
    expect(withCurrencyPrefix('P1,200.00', 'P')).toBe('P1,200.00');
  });

  it('rewrites every amount in a sentence, and only the prefix', () => {
    expect(withCurrencyPrefix(
      'The Initial Fee of P90,000.00 is six times the monthly P15,000.00.', '₱',
    )).toBe('The Initial Fee of ₱90,000.00 is six times the monthly ₱15,000.00.');
  });

  it('accepts a space between the symbol and the figure', () => {
    expect(withCurrencyPrefix('P 15,000.00', '₱')).toBe('₱ 15,000.00');
  });

  it('leaves the statute citations an engagement letter is full of alone', () => {
    // The prefix has to be followed by a digit, so an initial is never money.
    expect(withCurrencyPrefix('P.D. No. 1096 and R.A. 11232', '₱')).toBe('P.D. No. 1096 and R.A. 11232');
    expect(withCurrencyPrefix('quoted in PHP 50,000', '₱')).toBe('quoted in PHP 50,000');
    expect(withCurrencyPrefix('bound as Annex "P"', '₱')).toBe('bound as Annex "P"');
  });

  it('does not touch a P inside a word', () => {
    // A client, not an amount — which is why the client name is never walked.
    expect(withCurrencyPrefix('SAP2000 licence fees', '₱')).toBe('SAP2000 licence fees');
    expect(withCurrencyPrefix('Php50,000', '₱')).toBe('Php50,000');
  });

  it('is idempotent', () => {
    const once = withCurrencyPrefix('P50,000.00 and P1.00', '₱');
    expect(withCurrencyPrefix(once, '₱')).toBe(once);
  });
});
