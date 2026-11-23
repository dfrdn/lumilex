import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import JSZip from 'jszip';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { getFirmConfig, getFirmInvoiceConfig } from '@/lib/firm/config';
import { uploadToClaudeFiles } from '@/lib/ai/claude';
import type Anthropic from '@anthropic-ai/sdk';
import { anthropicFor } from '@/lib/ai/gate';
import { loadFirmBrand } from '@/lib/pdf/firm-brand';
import type { Brand } from '@/lib/pdf/brand';
import { imageSize } from '@/lib/docx/brand';
import { pickLetterheadDesign, type LetterheadDesign } from '@/lib/firm/letterhead-design';
import {
  applyMargins,
  applyStyleFont,
  ensureImageContentType,
  headerNamespaces,
  imageRelationships,
  type LetterheadContent,
  type LetterheadMarks,
  letterheadParts,
  rosterGroups,
  rosterOverflows,
  type RosterMember,
  signOff,
} from '@/lib/docx/letterhead';

const TEMPLATE_PATH = path.join(process.cwd(), 'lib', 'docx', 'template.docx');

/**
 * Bump when the letterhead's own layout changes, not just its contents: it is
 * part of the cache key, so a rebuilt letterhead reaches the next document
 * instead of waiting for someone to join or leave the firm.
 */
const LETTERHEAD_VERSION = 2;

/**
 * Per firm: the Claude Files copy and the built templates. Built templates are
 * keyed on the hash of everything printed, so a warm server cannot go on
 * printing someone who has left — a changed roster is simply a different key —
 * and one firm's letterhead is never served to another.
 */
interface TemplateCacheEntry {
  hash: string | null;
  fileId: string | null;
  built: { hash: string; buffer: Buffer } | null;
}
const _cache = new Map<string, TemplateCacheEntry>();

function cacheFor(firmId: string): TemplateCacheEntry {
  let entry = _cache.get(firmId);
  if (!entry) {
    entry = { hash: null, fileId: null, built: null };
    _cache.set(firmId, entry);
  }
  return entry;
}

/**
 * Who is on the letterhead. The order is imposed by `rosterGroups`, not here,
 * so it cannot depend on what Postgres happens to return.
 */
async function getActiveTeam(firmId: string): Promise<RosterMember[]> {
  const { data, error } = await getServiceDbForFirm(firmId)
    .from('team')
    .select('name, position, start_date')
    .eq('active', true);

  // Fail rather than build a letterhead with nobody on it: a draft that errors
  // is retried, a letter with an empty roster column goes out.
  if (error) throw new Error(`Could not read the roster for the letterhead: ${error.message}`);
  return (data ?? []) as RosterMember[];
}

interface Mark {
  data: Buffer;
  type: 'png' | 'jpg';
  aspect: number;
}

/** A mark from the firm's own storage, or null when it has none configured. */
function readMark(localPath: string | null): Mark | null {
  if (!localPath) return null;
  const data = fs.readFileSync(localPath);
  const size = imageSize(data);
  if (!size || !size.width || !size.height) {
    throw new Error(`Firm brand mark at ${path.basename(localPath)} is not a PNG or JPEG Word can place.`);
  }
  return { data, type: size.type, aspect: size.width / size.height };
}

type MarkSlot = 'wordmark' | 'monogram' | 'monogramLight';

interface Letterhead {
  design: LetterheadDesign;
  content: LetterheadContent;
  marks: Record<MarkSlot, Mark | null>;
}

/**
 * Everything the letterhead prints, from the firm's own configuration. The
 * address comes from its invoice settings and the contact line from its mail
 * identity — there is no in-code default, so a firm that has not configured
 * them gets a letterhead with no address rather than another firm's.
 */
async function loadLetterhead(firmId: string): Promise<Letterhead> {
  const [brand, invoice, config, team] = await Promise.all([
    loadFirmBrand(firmId),
    getFirmInvoiceConfig(firmId),
    getFirmConfig(firmId),
    getActiveTeam(firmId),
  ]);
  const lines = (...blocks: string[]) =>
    blocks.flatMap((b) => b.split('\n')).map((l) => l.trim()).filter(Boolean);

  return {
    design: pickLetterheadDesign(config.branding.letterhead, brand.documentName),
    content: {
      roster: rosterGroups(team),
      address: lines(invoice.firmAddress, invoice.firmAddress2),
      contact: lines(config.email.fromAddress),
      firmName: brand.documentName,
      fontFamily: brand.fonts.docxFamily,
      inks: inksFor(brand),
    },
    marks: {
      wordmark: readMark(brand.assets.logo),
      monogram: readMark(brand.assets.monogram),
      monogramLight: readMark(brand.assets.monogramLight),
    },
  };
}

function inksFor(brand: Brand): LetterheadContent['inks'] {
  const p = brand.palette;
  return {
    primary: p.primary,
    accent: p.accent,
    accentSoft: p.accentSoft,
    hairline: p.hairline,
    ink: p.ink,
    inkSoft: p.inkSoft,
    white: p.white,
  };
}

/** Hash everything the letterhead prints, so any change rebuilds it. */
function hashLetterhead(letterhead: Letterhead): string {
  const markHash = (m: Mark | null) => (m ? crypto.createHash('sha256').update(m.data).digest('hex') : 'none');
  const payload = JSON.stringify({
    v: LETTERHEAD_VERSION,
    design: letterhead.design,
    content: letterhead.content,
    marks: Object.fromEntries(Object.entries(letterhead.marks).map(([slot, m]) => [slot, markHash(m)])),
  });
  return crypto.createHash('sha256').update(payload).digest('hex').substring(0, 16);
}

/**
 * Build the template with the firm's letterhead: both header parts, their
 * images, the page margins they assume, and the sign-off.
 */
async function buildLetterhead(letterhead: Letterhead): Promise<Buffer> {
  const zip = await JSZip.loadAsync(fs.readFileSync(TEMPLATE_PATH));
  const { design, content } = letterhead;

  if (rosterOverflows(content)) {
    // Word would clip the last names without saying so, and nobody proofreads a
    // letterhead they have seen a thousand times.
    console.warn(
      `[letterhead] the roster (${content.roster.reduce((n, g) => n + g.names.length, 0)} names) ` +
      'takes more than a third of page one — set it smaller or move it to a second page.',
    );
  }

  const namespaces = headerNamespaces(await zip.files['word/header1.xml'].async('string'));

  // Every configured mark is registered on both header parts under the same
  // ids, so a design can place any of them on either page.
  const media = (Object.entries(letterhead.marks) as [MarkSlot, Mark | null][])
    .filter((entry): entry is [MarkSlot, Mark] => entry[1] !== null)
    .map(([slot, mark]) => ({ slot, mark, target: `media/firm-${slot}.${mark.type}` }));
  for (const { mark, target } of media) zip.file(`word/${target}`, mark.data);

  const marks: LetterheadMarks = { wordmark: null, monogram: null, monogramLight: null };
  media.forEach(({ slot, mark }, i) => {
    marks[slot] = { relationshipId: `rId${i + 1}`, aspect: mark.aspect };
  });

  const parts = letterheadParts(design, content, { namespaces, marks });
  zip.file('word/header2.xml', parts.firstPageHeaderXml);
  zip.file('word/header1.xml', parts.continuationHeaderXml);
  const rels = imageRelationships(media.map((m) => m.target));
  zip.file('word/_rels/header2.xml.rels', rels);
  zip.file('word/_rels/header1.xml.rels', rels);

  zip.file('word/styles.xml', applyStyleFont(await zip.files['word/styles.xml'].async('string'), content.fontFamily));

  let types = await zip.files['[Content_Types].xml'].async('string');
  for (const { mark } of media) types = ensureImageContentType(types, mark.type);
  zip.file('[Content_Types].xml', types);

  // The body's frame comes from the design, so the section has to carry it.
  let documentXml = await zip.files['word/document.xml'].async('string');
  const sectPr = documentXml.match(/<w:sectPr[\s\S]*?<\/w:sectPr>/)?.[0];
  if (sectPr) documentXml = documentXml.replace(sectPr, applyMargins(sectPr, parts.margins));
  zip.file('word/document.xml', signOff(documentXml, content.firmName));

  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  return Buffer.from(buffer);
}

/** The built template for this firm's current letterhead, reused while nothing printed changes. */
async function buildTemplate(firmId: string): Promise<{ hash: string; buffer: Buffer }> {
  const cache = cacheFor(firmId);
  const letterhead = await loadLetterhead(firmId);
  const hash = hashLetterhead(letterhead);
  if (cache.built?.hash === hash) return cache.built;
  cache.built = { hash, buffer: await buildLetterhead(letterhead) };
  return cache.built;
}

/**
 * Get a Claude Files API file_id for the template with the current letterhead.
 * Only re-uploads the template when what it prints changes (hash-based caching).
 */
export async function getUpdatedTemplateFileId(firmId: string): Promise<string> {
  const cache = cacheFor(firmId);
  const { hash, buffer } = await buildTemplate(firmId);

  // Check existing files in Claude Files API (also validates cached file_id)
  const claude = await anthropicFor({ firmId, feature: 'ai_analysis' });
  const existing = await claude.beta.files.list({ betas: ['files-api-2025-04-14'] });

  if (cache.hash === hash && cache.fileId) {
    const stillExists = existing.data.some((f: { id: string }) => f.id === cache.fileId);
    if (stillExists) return cache.fileId;
    cache.fileId = null;
    cache.hash = null;
  }

  // Look for template files named with our hash pattern
  const hashFilename = `billing-template-${firmId}-${hash}.docx`;
  const existingTemplate = existing.data.find(
    (f: { filename: string }) => f.filename === hashFilename,
  );

  if (existingTemplate) {
    cache.fileId = existingTemplate.id;
    cache.hash = hash;
    console.log(`[template-updater] Found existing template for letterhead ${hash}: ${cache.fileId}`);
    cleanupOldTemplates(claude, existing.data, firmId, hashFilename);
    return cache.fileId;
  }

  console.log(`[template-updater] Letterhead changed (${cache.hash} -> ${hash}), uploading template...`);
  const fileId = await uploadToClaudeFiles({ firmId, feature: 'ai_analysis' }, buffer, hashFilename);
  cache.fileId = fileId;
  cache.hash = hash;
  console.log(`[template-updater] Uploaded updated template: ${fileId}`);

  cleanupOldTemplates(claude, existing.data, firmId, hashFilename);
  return fileId;
}

/**
 * The template with the current letterhead. Reads the roster on every call —
 * one small query, against a draft that has just spent seconds in a model — so
 * the letterhead is never older than the team table.
 */
export async function getUpdatedTemplateBuffer(firmId: string): Promise<Buffer> {
  return (await buildTemplate(firmId)).buffer;
}

/**
 * Delete this firm's superseded templates from the Claude Files API
 * (fire-and-forget). The store is keyed by the platform API key, so it holds
 * every firm's copies; only this firm's are candidates.
 */
function cleanupOldTemplates(
  claude: Anthropic,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  files: any[],
  firmId: string,
  keepFilename: string,
) {
  const prefix = `billing-template-${firmId}-`;
  const oldTemplates = files.filter(
    (f: { filename: string }) => f.filename.startsWith(prefix) && f.filename !== keepFilename,
  );

  for (const old of oldTemplates) {
    claude.beta.files
      .delete(old.id, { betas: ['files-api-2025-04-14'] })
      .then(() => console.log(`[template-updater] Deleted old template: ${old.filename}`))
      .catch(() => { /* ignore */ });
  }
}
