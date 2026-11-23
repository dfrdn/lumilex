import { describe, it, expect, vi } from 'vitest';
import { parseJson } from './kb-extractor';

describe('kb-extractor parseJson', () => {
  // Four of six replies in one Library backfill took this shape and were
  // logged as unparseable: a fenced, valid, empty answer, then a rationale.
  it('reads a fenced empty answer followed by a rationale, without reporting an error', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const raw =
      '```json\n{\n  "doctrineTags": [],\n  "signals": []\n}\n```\n\n' +
      '**Rationale:** This matter is a completed advisory engagement on estate planning.';
    expect(parseJson(raw)).toEqual({ doctrineTags: [], signals: [] });
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it('keeps the signals in the same shape', () => {
    const raw =
      '```json\n{"doctrineTags":["prescription"],"signals":[{"kind":"doctrine","key":"prescription",' +
      '"title":"Prescription runs from demand","observation":"The court counted the period from the written demand."}]}\n```\n' +
      '**Reasoning:** One holding worth keeping.';
    expect(parseJson(raw)).toEqual({
      doctrineTags: ['prescription'],
      signals: [
        {
          kind: 'doctrine',
          key: 'prescription',
          title: 'Prescription runs from demand',
          observation: 'The court counted the period from the written demand.',
        },
      ],
    });
  });

  it('reports and returns null when there is no JSON at all', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(parseJson('I could not find anything worth recording.')).toBeNull();
    expect(error).toHaveBeenCalledOnce();
    error.mockRestore();
  });
});
