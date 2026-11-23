/**
 * The DOCX side of the firm brand kit.
 *
 * The Word renderers name a font by string and embed the letterhead logo as
 * bytes, so they need a different shape from the PDF `Brand` — but the same
 * source: `firms.branding`, resolved through the same curated font sets and the
 * same per-firm storage prefix.
 *
 * Fail-loud, same contract as the PDF kit: an unconfigured firm throws rather
 * than rendering under someone else's name, and "no logo" is a legitimate
 * configuration that renders as a document with no header image.
 */

import fs from 'fs';
import { AlignmentType, ImageRun, Paragraph } from 'docx';
import { getFirmConfig } from '@/lib/firm/config';
import { resolveFontSet } from '@/lib/pdf/fonts';
import { resolveBrandAssets } from '@/lib/pdf/brand-assets';

/** Header logo, sized for a Word header at a fixed height. */
export interface DocxLogo {
  data: Buffer;
  type: 'png' | 'jpg';
  /** Points, aspect-corrected from the file's own dimensions. */
  width: number;
  height: number;
}

export interface DocxBrand {
  /** Set into signature blocks and letterhead. */
  firmName: string;
  /** Word family name for the firm's curated typeface set. */
  fontFamily: string;
  logo: DocxLogo | null;
}

/** Header logo height in points — matches the letterhead the renderers draw. */
const LOGO_H = 40;
/** Widest a header logo may run before it crowds the page. */
const LOGO_MAX_W = 260;

/**
 * Intrinsic pixel size of a PNG or JPEG, read from the header. `docx` needs an
 * explicit width and height, and scaling every mark to a fixed 120×40 (as the
 * single-firm renderers did) squashes any logo that is not that firm's ratio.
 */
export function imageSize(buf: Buffer): { type: 'png' | 'jpg'; width: number; height: number } | null {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) {
    return { type: 'png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i += 1; continue; }
      const marker = buf[i + 1];
      // SOF0..SOF15, excluding the non-frame markers DHT (c4), JPGA (c8), DAC (cc).
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { type: 'jpg', height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      }
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  return null;
}

function readLogo(localPath: string | null): DocxLogo | null {
  if (!localPath) return null;
  let data: Buffer;
  try {
    data = fs.readFileSync(localPath);
  } catch {
    return null;
  }
  const size = imageSize(data);
  if (!size) return null;
  const width = Math.min(LOGO_MAX_W, Math.round((LOGO_H * size.width) / size.height));
  return { data, type: size.type, width, height: LOGO_H };
}

/**
 * The letterhead header for a Word section: the firm's logo, centred. A firm
 * with no logo configured gets an empty array — the caller then omits the header
 * entirely, leaving clean space rather than another firm's mark.
 */
export function logoHeader(brand: DocxBrand): Paragraph[] {
  if (!brand.logo) return [];
  return [
    new Paragraph({
      children: [
        new ImageRun({
          data: brand.logo.data,
          transformation: { width: brand.logo.width, height: brand.logo.height },
          type: brand.logo.type,
        }),
      ],
      alignment: AlignmentType.CENTER,
    }),
  ];
}

export async function loadDocxBrand(firmId: string): Promise<DocxBrand> {
  const config = await getFirmConfig(firmId);
  const firmName = config.branding.documentName.trim();
  if (!firmName) {
    throw new Error('Firm branding is incomplete: set branding.documentName before generating documents.');
  }
  const assets = await resolveBrandAssets(firmId, config.branding);
  return {
    firmName,
    fontFamily: resolveFontSet(config.branding.fontSet).docxFamily,
    logo: readLogo(assets.logo),
  };
}
