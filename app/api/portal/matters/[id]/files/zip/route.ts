import { NextRequest } from 'next/server';
import { Readable } from 'node:stream';
// archiver v8 is ESM-native and exposes ZipArchive directly; @types/archiver
// still describes the v7 CJS API. Type-cast until the types catch up.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import * as ArchiverModule from 'archiver';

interface ZipArchiveLike extends Readable {
  append(source: Buffer | Readable, data: { name: string }): void;
  finalize(): Promise<void>;
}
const ZipArchive = (ArchiverModule as unknown as {
  ZipArchive: new (options?: { zlib?: { level?: number } }) => ZipArchiveLike;
}).ZipArchive;
import { requirePortalSession } from '@/lib/portal/guards';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { attachmentDisposition } from '@/lib/download-headers';
import { loadPortalVisibleFileRows } from '@/lib/portal/data';

export const runtime = 'nodejs';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requirePortalSession();
  if (!guard.ok) return guard.response;
  const { session } = guard;

  const { id: matterId } = await params;

  // 1) Confirm the matter belongs to the session's client. A client's JWT
  // reads no firm table, so the explicit client_id filter is the gate.
  const service = getServiceDbForFirm(session.firmId);
  const { data: matter } = await service
    .from('matters')
    .select('notion_id, matter_code, name, case_title')
    .eq('notion_id', matterId)
    .eq('client_id', session.user.clientId)
    .maybeSingle();
  if (!matter) {
    return new Response('Not found', { status: 404 });
  }

  // 2) Exactly the rows the Files tab lists — no working copy of a
  // deliverable the client can't see.
  const { rows: files } = await loadPortalVisibleFileRows(service, session.user.clientId, matterId);

  // Flatten file_urls (each row may have multiple attached files).
  const entries: { name: string; path: string }[] = [];
  for (const row of files) {
    for (const u of row.file_urls ?? []) {
      if (u?.path) {
        entries.push({ name: u.name || row.name || 'file', path: u.path });
      }
    }
  }

  if (entries.length === 0) {
    return new Response('No files', { status: 404 });
  }

  // 3) Build the zip filename from the matter context.
  const baseLabel = [matter.matter_code, matter.case_title || matter.name]
    .filter(Boolean)
    .join(' ')
    .replace(/[^a-zA-Z0-9\-_ .]/g, '_')
    .slice(0, 80) || 'matter-files';
  const filename = `${baseLabel}.zip`;

  // 4) Stream the archive.
  const archive = new ZipArchive({ zlib: { level: 6 } });

  // Dedupe filenames within the zip — duplicates cause clients to overwrite
  // silently or produce confusing zip entries.
  const usedNames = new Set<string>();
  function uniqueName(name: string): string {
    if (!usedNames.has(name)) {
      usedNames.add(name);
      return name;
    }
    const dot = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    for (let i = 2; ; i++) {
      const candidate = `${stem} (${i})${ext}`;
      if (!usedNames.has(candidate)) {
        usedNames.add(candidate);
        return candidate;
      }
    }
  }

  (async () => {
    try {
      for (const entry of entries) {
        const { data: blob, error } = await service.storage
          .from('files')
          .download(entry.path);
        if (error || !blob) {
          console.warn(`[portal/files/zip] skipped ${entry.path}: ${error?.message}`);
          continue;
        }
        const buf = Buffer.from(await blob.arrayBuffer());
        archive.append(buf, { name: uniqueName(entry.name) });
      }
      await archive.finalize();
    } catch (err) {
      console.error('[portal/files/zip] error:', err);
      archive.destroy(err as Error);
    }
  })();

  return new Response(Readable.toWeb(archive) as ReadableStream<Uint8Array>, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': attachmentDisposition(filename),
      'Cache-Control': 'no-store',
    },
  });
}
