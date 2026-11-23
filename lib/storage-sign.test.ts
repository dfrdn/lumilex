import { describe, expect, it, vi } from 'vitest';
import { signStoragePaths } from './storage-sign';

type Item = { error: string | null; path: string | null; signedUrl: string | null };

function fakeClient(result: { data: Item[] | null; error: unknown }) {
  const createSignedUrls = vi.fn().mockResolvedValue(result);
  const from = vi.fn().mockReturnValue({ createSignedUrls });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { client: { storage: { from } } as any, from, createSignedUrls };
}

describe('signStoragePaths', () => {
  it('signs every path in one request, deduped and without blanks', async () => {
    const { client, from, createSignedUrls } = fakeClient({
      data: [
        { error: null, path: 'a/1.pdf', signedUrl: 'https://s/a1' },
        { error: null, path: 'b/2.pdf', signedUrl: 'https://s/b2' },
      ],
      error: null,
    });

    const urls = await signStoragePaths(client, 'files', ['a/1.pdf', null, 'b/2.pdf', '', 'a/1.pdf', undefined], 3600);

    expect(from).toHaveBeenCalledWith('files');
    expect(createSignedUrls).toHaveBeenCalledTimes(1);
    expect(createSignedUrls).toHaveBeenCalledWith(['a/1.pdf', 'b/2.pdf'], 3600, undefined);
    expect(Object.fromEntries(urls)).toEqual({ 'a/1.pdf': 'https://s/a1', 'b/2.pdf': 'https://s/b2' });
  });

  it('passes the download option through', async () => {
    const { client, createSignedUrls } = fakeClient({ data: [], error: null });
    await signStoragePaths(client, 'files', ['x.docx'], 60, { download: 'Report.docx' });
    expect(createSignedUrls).toHaveBeenCalledWith(['x.docx'], 60, { download: 'Report.docx' });
  });

  it('leaves out paths Storage could not sign', async () => {
    const { client } = fakeClient({
      data: [
        { error: null, path: 'ok.pdf', signedUrl: 'https://s/ok' },
        { error: 'Either the object does not exist or you do not have access to it', path: 'gone.pdf', signedUrl: null },
      ],
      error: null,
    });
    const urls = await signStoragePaths(client, 'files', ['ok.pdf', 'gone.pdf'], 60);
    expect(urls.get('ok.pdf')).toBe('https://s/ok');
    expect(urls.has('gone.pdf')).toBe(false);
  });

  it('returns an empty map when the request fails', async () => {
    const { client } = fakeClient({ data: null, error: new Error('storage down') });
    const urls = await signStoragePaths(client, 'files', ['a.pdf'], 60);
    expect(urls.size).toBe(0);
  });

  it('makes no request when there is nothing to sign', async () => {
    const { client, createSignedUrls } = fakeClient({ data: [], error: null });
    const urls = await signStoragePaths(client, 'files', [null, ''], 60);
    expect(urls.size).toBe(0);
    expect(createSignedUrls).not.toHaveBeenCalled();
  });
});
