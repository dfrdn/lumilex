import { describe, it, expect } from 'vitest';
import type { Trademark } from '@/types/notion';
import { WORDING_BLOCKS, fillWording, wordingFrom, wordingProblem, wordingToParagraphs } from './report-wording';
import { buildClientReport } from './client-report';

describe('wordingProblem', () => {
  it('accepts every default', () => {
    for (const b of WORDING_BLOCKS) expect(wordingProblem(b.body), b.key).toBeNull();
  });

  it('refuses unknown fields, unbalanced brackets, and a block field inside a sentence', () => {
    expect(wordingProblem('Due {{dueDate}}')).toBe('Unknown field: {{dueDate}}.');
    expect(wordingProblem('[[ by {{dau3Due}}')).toBe('Every [[ needs a matching ]].');
    expect(wordingProblem('See {{proofOfUse}} below.')).toBe('{{proofOfUse}} must be a paragraph on its own.');
    expect(wordingProblem('  ')).toBe('The paragraph is empty.');
  });
});

describe('fillWording', () => {
  it('drops a [[ … ]] whose field is blank, and strips markup from values', () => {
    expect(fillWording('Filed[[, No. {{applicationNo}}]].', { applicationNo: '' })).toBe('Filed.');
    expect(fillWording('Filed[[, No. {{applicationNo}}]].', { applicationNo: '4-*2025*' })).toBe('Filed, No. 4-2025.');
  });
});

describe('wordingToParagraphs', () => {
  it('splits paragraphs, turns "- " lines into items, and brings in block fields', () => {
    const out = wordingToParagraphs('One {{mark}}.\n\nIntro:\n- a\n- b\n\n{{proofOfUse}}', { mark: '“X”' }, (k) =>
      k === 'proofOfUse' ? [{ text: 'PROOF' }] : []);
    expect(out.map((p) => [p.type ?? 'text', p.text])).toEqual([
      ['text', 'One “X”.'], ['text', 'Intro:'], ['item', 'a'], ['item', 'b'], ['text', 'PROOF'],
    ]);
  });
});

describe('saved wording', () => {
  it('replaces a default block by block, and an empty saved block falls back', () => {
    const w = wordingFrom([{ key: 'shared.closing', body: 'Thank you.' }, { key: 'filing.message', body: ' ' }, { key: 'nope', body: 'x' }]);
    expect(w['shared.closing']).toBe('Thank you.');
    expect(w['filing.message']).toContain('Please find attached');
    expect(w.nope).toBeUndefined();
  });

  it('reaches the letter', () => {
    const t = {
      id: 't', mark: 'TIFFIN TALE', classes: [21], goodsServices: { 21: 'Food containers' }, country: 'PH', owner: 'Tiffin Tale Foods Inc.',
      clientName: 'Tiffin Tale Foods Inc.', clientCode: 155, clientIndex: 1, regIrNo: '4-2025-1', filingDate: '2025-02-13', regDate: null,
      localDeadlines: [], internationalRegistrations: [], officeActions: [], dau3Motex: false, dau3FilingDate: null,
    } as unknown as Trademark;
    const r = buildClientReport(t, 'filing', {
      today: '2026-10-19', signatory: { name: 'A' }, annexes: [],
      wording: wordingFrom([{ key: 'filing.body', body: 'We filed **{{mark}}** on {{eventDate}}.\n\n{{goodsByClass}}' }]),
    });
    const text = r.paragraphs.filter((p) => p.type !== 'fields').map((p) => p.text);
    expect(text).toContain('We filed **“TIFFIN TALE”** on 13 February 2025.');
    expect(text).toContain('**Class 21** — Food containers');
    expect(text.join('\n')).not.toContain('Declaration of Actual Use');
  });
});

describe('every report on the sample mark', () => {
  it('fills every field, with no stray markup', async () => {
    const { REPORT_EVENT_KEYS } = await import('./client-report');
    const { sampleMarkFor } = await import('./report-sample');
    for (const event of REPORT_EVENT_KEYS) {
      for (const finalRejection of event === 'oa_received' ? [false, true] : [false]) {
        const r = buildClientReport(sampleMarkFor(event, { finalRejection }), event, {
          today: '2026-10-19', signatory: { name: 'A' }, annexes: ['the document'],
        });
        const all = [...r.paragraphs.map((p) => p.text), r.message].join('\n');
        expect(all, event).not.toMatch(/\{\{|\[\[|\]\]|\[[A-Z][^\]]*\]/);
        expect(r.problems, event).toEqual([]);
      }
    }
  });
});

describe('the shared letter editor', () => {
  it('round-trips every default unchanged', async () => {
    const { htmlToMarkup, markupToHtml } = await import('@/lib/letter-markup');
    for (const b of WORDING_BLOCKS) expect(htmlToMarkup(markupToHtml(b.body)), b.key).toBe(b.body);
  });
});
