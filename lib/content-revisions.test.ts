import { describe, it, expect } from 'vitest';
import { changedFields } from './content-revisions';

describe('changedFields', () => {
  it('reports nothing when the edit changes nothing tracked', () => {
    const before = { title: 'Indemnity', content_md: 'body', status: 'draft' };
    expect(changedFields('kb_page', before, { title: 'Indemnity' })).toEqual([]);
  });

  it('reports only the fields present in the patch', () => {
    const before = { title: 'Indemnity', content_md: 'old', status: 'draft', pinned: false };
    // A status-only transition must not claim the content changed — otherwise
    // every publish writes a revision that looks like a rewrite.
    expect(changedFields('kb_page', before, { status: 'published' })).toEqual(['status']);
  });

  it('detects a content rewrite', () => {
    const before = { title: 'Indemnity', content_md: 'old position' };
    expect(changedFields('kb_page', before, { content_md: 'new position' })).toEqual(['content_md']);
  });

  it('detects several fields at once, in tracked order', () => {
    const before = { title: 'Old', summary: 'a', content_md: 'x', status: 'draft' };
    const after = { title: 'New', content_md: 'y', status: 'published' };
    expect(changedFields('kb_page', before, after)).toEqual(['title', 'content_md', 'status']);
  });

  it('ignores untracked fields', () => {
    const before = { title: 'Indemnity', updated_at: '2026-01-01', author_id: 'a' };
    expect(changedFields('kb_page', before, { updated_at: '2026-02-02', author_id: 'b' })).toEqual([]);
  });

  it('compares jsonb content structurally, not by reference', () => {
    // fee_schedules.content is jsonb — an identical object re-saved must not
    // register as a change, or every open-and-save writes a phantom revision.
    const before = { content: { tiers: [{ label: 'A', amount: 1000 }] }, name: 'Corporate' };
    const same = { content: { tiers: [{ label: 'A', amount: 1000 }] } };
    const different = { content: { tiers: [{ label: 'A', amount: 2000 }] } };
    expect(changedFields('fee_schedule', before, same)).toEqual([]);
    expect(changedFields('fee_schedule', before, different)).toEqual(['content']);
  });

  it('treats a missing before-value and an explicit null as the same', () => {
    const before = { title: 'X' };
    expect(changedFields('kb_page', before, { summary: null })).toEqual([]);
    expect(changedFields('kb_page', before, { summary: 'now set' })).toEqual(['summary']);
  });

  it('tracks a different field set per entity type', () => {
    const before = { content: 'html', content_md: 'markdown' };
    // `content` belongs to fee schedules, `content_md` to library pages.
    expect(changedFields('fee_schedule', before, { content: 'new html' })).toEqual(['content']);
    expect(changedFields('fee_schedule', before, { content_md: 'new md' })).toEqual([]);
    expect(changedFields('kb_page', before, { content_md: 'new md' })).toEqual(['content_md']);
  });

  it('detects a boolean flip', () => {
    expect(changedFields('kb_page', { pinned: true }, { pinned: false }))
      .toEqual(['pinned']);
    expect(changedFields('kb_page', { pinned: true }, { pinned: true }))
      .toEqual([]);
  });
});
