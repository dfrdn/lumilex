import { describe, it, expect, vi, afterEach } from 'vitest';
import { trackKnowledgeClick } from './knowledge-click';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('trackKnowledgeClick', () => {
  it('posts the click to the attribution endpoint with keepalive', () => {
    const fetchMock = vi.fn((_url: string, _init: RequestInit) =>
      Promise.resolve(new Response(null, { status: 204 })),
    );
    vi.stubGlobal('fetch', fetchMock);

    trackKnowledgeClick(42, 'deliverable', 'abc-123');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/knowledge/search/click');
    expect(init.method).toBe('POST');
    expect(init.keepalive).toBe(true);
    expect(JSON.parse(init.body as string)).toEqual({
      searchId: 42,
      sourceType: 'deliverable',
      sourceId: 'abc-123',
    });
  });

  it('is a no-op when there is no search id', () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response()));
    vi.stubGlobal('fetch', fetchMock);

    trackKnowledgeClick(null, 'deliverable', 'abc-123');
    trackKnowledgeClick(undefined, 'deliverable', 'abc-123');
    trackKnowledgeClick(0, 'deliverable', 'abc-123');

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never throws even if fetch itself throws synchronously', () => {
    vi.stubGlobal('fetch', () => {
      throw new Error('network down');
    });
    expect(() => trackKnowledgeClick(7, 'matter', 'm-1')).not.toThrow();
  });
});
