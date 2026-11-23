import { describe, it, expect } from 'vitest';
import { INSIGHTS_TABS, insightsHref, parseInsightsTab } from './insights-tabs';

describe('insights tabs', () => {
  it('opens on Leakage, what the page always showed, unless the URL names another tab', () => {
    expect(parseInsightsTab(undefined)).toBe('leakage');
    expect(parseInsightsTab('nope')).toBe('leakage');
    expect(parseInsightsTab('cash-flow')).toBe('cash-flow');
  });

  it('round-trips every tab through its URL', () => {
    expect(insightsHref('leakage')).toBe('/finance/insights');
    for (const t of INSIGHTS_TABS) {
      const tab = new URL(insightsHref(t.key), 'http://h').searchParams.get('tab') ?? undefined;
      expect(parseInsightsTab(tab)).toBe(t.key);
    }
  });
});
