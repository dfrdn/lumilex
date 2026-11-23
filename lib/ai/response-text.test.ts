import { describe, it, expect } from 'vitest';
import { responseText } from './response-text';

const thinking = { type: 'thinking', thinking: '', signature: 'sig' };
const text = (t: string) => ({ type: 'text', text: t });
const response = (content: { type: string }[], stop_reason = 'end_turn') => ({ content, stop_reason });

describe('responseText', () => {
  it('returns the text of a text-only response', () => {
    expect(responseText(response([text('{"a":1}')]))).toBe('{"a":1}');
  });

  it('skips a leading thinking block with omitted display', () => {
    expect(responseText(response([thinking, text('{"salutation":"Dear Ms. Cruz:"}')]))).toBe('{"salutation":"Dear Ms. Cruz:"}');
  });

  it('joins several text blocks in order', () => {
    expect(responseText(response([text('first'), thinking, text('second')]))).toBe('first\nsecond');
  });

  it('throws on a thinking-only response, naming the stop reason and blocks', () => {
    expect(() => responseText(response([thinking], 'max_tokens'))).toThrow('stop_reason=max_tokens, blocks=thinking');
  });

  it('throws on an empty refusal', () => {
    expect(() => responseText(response([], 'refusal'))).toThrow('stop_reason=refusal, blocks=none');
  });

  it('throws when the only text is whitespace', () => {
    expect(() => responseText(response([text('  \n')]))).toThrow(/No text/);
  });
});
