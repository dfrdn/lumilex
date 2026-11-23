import { describe, it, expect } from 'vitest';
import { DELIVERABLE_VIEWS, deliverablesHref, parseDeliverableView } from './views';

describe('deliverable views', () => {
  it('default to the person’s own', () => {
    expect(parseDeliverableView(undefined)).toBe('mine');
    expect(parseDeliverableView('')).toBe('mine');
    expect(parseDeliverableView('nonsense')).toBe('mine');
    expect(deliverablesHref('mine')).toBe('/dashboard/deliverables');
  });

  it('name the firm-wide list in the URL', () => {
    expect(parseDeliverableView('all')).toBe('all');
    expect(deliverablesHref('all')).toBe('/dashboard/deliverables?view=all');
    expect(deliverablesHref('all', { card: 'overdue' })).toBe('/dashboard/deliverables?view=all&card=overdue');
  });

  it('list Mine first, then All', () => {
    expect(DELIVERABLE_VIEWS.slice(0, 2).map((v) => v.label)).toEqual(['Mine', 'All']);
  });

  it('open Mine when the only query is an extra', () => {
    const href = deliverablesHref('mine', { with: 'me' });
    expect(href).toBe('/dashboard/deliverables?with=me');
    const url = new URL(href, 'https://x');
    expect(parseDeliverableView(url.searchParams.get('view') ?? undefined)).toBe('mine');
    expect(url.searchParams.get('with')).toBe('me');
  });

  it('round-trip through the URL', () => {
    for (const { key } of DELIVERABLE_VIEWS) {
      const view = new URL(deliverablesHref(key), 'https://x').searchParams.get('view') ?? undefined;
      expect(parseDeliverableView(view)).toBe(key);
    }
  });

  it('carry the by-status view’s status', () => {
    expect(deliverablesHref('by-status', { status: 'Under Review' })).toBe('/dashboard/deliverables?view=by-status&status=Under+Review');
  });
});
