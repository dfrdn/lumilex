/**
 * Branded PDF rendering of the firm profile — the export side of the
 * admin firm-profile CMS (app/admin/firm-profile).
 *
 * Aesthetic: refined art-deco / luxury editorial. The firm's own two brand
 * colours carry the panels and keylines, its monogram is the recurring motif,
 * and its curated typeface set supplies the display and body faces — deco corner
 * brackets, monogram-flanked section headers, and a wordmark + page-number
 * footer are the same for every tenant.
 *
 *   1. Cover            5+. Our Team
 *   2. About Us         N.  The Firm at a Glance
 *   3. Practice Areas   N+1 Contact Us
 *
 * The palette, geometry, typefaces, monogram, and deco primitives all come from
 * lib/pdf/brand.ts via the `Brand` this renders in — this document was the first
 * to use them and they were extracted there so the engagement proposal and its
 * annexes (this profile is bound in as Annex "B") can't drift from each other.
 */

import type { FirmProfileContent, TeamGroup, TeamMember } from '@/lib/firm-profile/types';
import { HEADSHOT_AR } from '@/lib/firm-profile/photo';
import {
  PAGE, M, CONTENT_W, CONTENT_TOP, CONTENT_BOTTOM,
  FONT, brandedDocument, drawMark, drawDecoBars,
  sectionHeader, footer, paintSurfacePage,
  drawCoverLockup, keylineOnPrimary,
  type Brand, type BrandedDoc,
} from './brand';

// ── Image prefetch (SSRF-guarded) ───────────────────────────────────
function isAllowedPhotoUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:') return false;
  let supabaseHost: string | null = null;
  try {
    supabaseHost = process.env.SUPABASE_URL ? new URL(process.env.SUPABASE_URL).host : null;
  } catch {
    supabaseHost = null;
  }
  return supabaseHost ? u.host === supabaseHost : u.host.endsWith('.supabase.co');
}

/**
 * Headshots are re-fetched on every render, and a proposal package renders the
 * profile each time it is exported or previewed. The upload route mints each
 * path as `firm-profile/<name>-<Date.now()>.<ext>`, so a URL's bytes never
 * change — a replaced photo arrives under a new URL. That makes the response
 * cacheable for the life of the instance with no staleness window; the bound
 * keeps a long-lived lambda from holding every headshot the firm has ever had.
 */
const PHOTO_CACHE = new Map<string, Buffer>();
const PHOTO_CACHE_MAX = 64;

async function prefetchImages(content: FirmProfileContent): Promise<Map<string, Buffer>> {
  const urls = new Set<string>();
  for (const g of content.team.groups) {
    for (const mem of g.members) {
      if (mem.photoUrl && isAllowedPhotoUrl(mem.photoUrl)) urls.add(mem.photoUrl);
    }
  }
  const map = new Map<string, Buffer>();
  await Promise.all(
    [...urls].map(async (url) => {
      const hit = PHOTO_CACHE.get(url);
      if (hit) {
        map.set(url, hit);
        return;
      }
      try {
        const res = await fetch(url);
        if (!res.ok) return;
        const buf = Buffer.from(await res.arrayBuffer());
        map.set(url, buf);
        if (PHOTO_CACHE.size >= PHOTO_CACHE_MAX) {
          // Map iterates in insertion order, so the first key is the oldest.
          const oldest = PHOTO_CACHE.keys().next().value;
          if (oldest !== undefined) PHOTO_CACHE.delete(oldest);
        }
        PHOTO_CACHE.set(url, buf);
      } catch {
        // skip — falls back to an initials placeholder
      }
    }),
  );
  return map;
}

// ════════════════════════════════════════════════════════════════════
// PAGE 1 — COVER
// ════════════════════════════════════════════════════════════════════
function renderCover(doc: BrandedDoc, content: FirmProfileContent) {
  const C = doc.brand.palette;
  const { cover } = content;
  doc.rect(0, 0, PAGE.w, PAGE.h).fill(C.primary);

  keylineOnPrimary(doc);

  // Monogram + wordmark lockup, with the tagline in small caps beneath — the
  // same opening the engagement proposal cover uses.
  drawCoverLockup(doc);

  // Deco bars — uniform width + spacing, staggered tops AND bottoms, contained
  // inside the gold keyline (rightmost ≤ 550) and above the practice-tags rule.
  drawDecoBars(doc, 448, 18, 28, [
    { top: 372, bottom: 700, color: C.accent },
    { top: 312, bottom: 656, color: C.accentSoft },
    { top: 420, bottom: 722, color: C.accent },
    { top: 344, bottom: 612, color: C.primaryBar },
  ]);

  // "2026" + subtitle with a gold rule, lower-left.
  const yearY = 600;
  doc.save().lineWidth(1).strokeColor(C.accent).moveTo(M.left, yearY - 8).lineTo(M.left + 70, yearY - 8).stroke().restore();
  doc.font(FONT.disp).fontSize(82).fillColor(C.white).text(cover.year, M.left, yearY);
  doc.font(FONT.dispSb).fontSize(18).fillColor(C.accentSoft).text(cover.subtitle.toUpperCase(), M.left, doc.y + 6, { characterSpacing: 6 });

  // Practice tags on a double gold hairline footer.
  const ruleY = 744;
  doc.save().lineWidth(0.8).strokeColor(C.accent)
    .moveTo(M.left, ruleY).lineTo(PAGE.w - M.right, ruleY).stroke()
    .moveTo(M.left, ruleY + 3).lineTo(PAGE.w - M.right, ruleY + 3).stroke().restore();
  doc.font(FONT.body).fontSize(10.5).fillColor(C.surface)
    .text(cover.practiceTags.join('     ·     '), M.left, ruleY + 16, { width: CONTENT_W, align: 'center', characterSpacing: 0.5 });
}

// ════════════════════════════════════════════════════════════════════
// PAGE 2 — ABOUT
// ════════════════════════════════════════════════════════════════════
function renderAbout(doc: BrandedDoc, content: FirmProfileContent) {
  const C = doc.brand.palette;
  const { about } = content;
  doc.addPage();
  paintSurfacePage(doc);
  let y = sectionHeader(doc, about.heading, 116);

  if (about.tagline) {
    doc.font(FONT.bodyIt).fontSize(13.5).fillColor(C.accent).text(about.tagline, M.left, y, { width: CONTENT_W, align: 'center' });
    y = doc.y + 18;
  }

  doc.font(FONT.body).fontSize(11).fillColor(C.inkSoft);
  about.paragraphs.forEach((p) => {
    const h = doc.heightOfString(p, { width: CONTENT_W, align: 'justify', lineGap: 2.5 });
    if (y + h > CONTENT_BOTTOM) {
      doc.addPage();
      paintSurfacePage(doc);
      y = CONTENT_TOP;
      doc.font(FONT.body).fontSize(11).fillColor(C.inkSoft);
    }
    doc.text(p, M.left, y, { width: CONTENT_W, align: 'justify', lineGap: 2.5 });
    y = doc.y + 12;
  });
}

// ════════════════════════════════════════════════════════════════════
// PAGE 3 — PRACTICE AREAS
// ════════════════════════════════════════════════════════════════════
function renderPracticeAreas(doc: BrandedDoc, content: FirmProfileContent) {
  const C = doc.brand.palette;
  const { practiceAreas } = content;
  doc.addPage();
  paintSurfacePage(doc);
  let y = sectionHeader(doc, practiceAreas.heading, 104);

  // Spacing tightens automatically when there are many practice areas so the
  // section stays on one page where it reasonably can.
  const dense = practiceAreas.items.length > 6;
  const gap = dense ? 11 : 18;
  const lineGap = dense ? 1.4 : 2;
  for (const item of practiceAreas.items) {
    doc.font(FONT.bodyB).fontSize(12.5);
    const titleH = doc.heightOfString(item.title, { width: CONTENT_W - 14 });
    doc.font(FONT.body).fontSize(10.5);
    const descH = doc.heightOfString(item.description, { width: CONTENT_W - 14, align: 'justify', lineGap });
    const blockH = titleH + 3 + descH + gap;
    if (y + blockH > CONTENT_BOTTOM) {
      doc.addPage();
      paintSurfacePage(doc);
      y = CONTENT_TOP;
    }
    // Gold tick + title.
    doc.save().rect(M.left, y + 2, 3, 12).fill(C.accent).restore();
    doc.font(FONT.bodyB).fontSize(12.5).fillColor(C.primary).text(item.title, M.left + 14, y, { width: CONTENT_W - 14 });
    y = doc.y + 3;
    doc.font(FONT.body).fontSize(10.5).fillColor(C.inkSoft).text(item.description, M.left + 14, y, { width: CONTENT_W - 14, align: 'justify', lineGap });
    y = doc.y + gap;
  }
}

// ════════════════════════════════════════════════════════════════════
// PAGES 5+ — OUR TEAM
// ════════════════════════════════════════════════════════════════════
// `cover` scales the image to fill the frame but PDFKit does no clipping of its
// own, so whichever axis overflows spills across the gold keyline and into the
// neighbouring cell. Clip to the frame before drawing.
function drawPhoto(doc: BrandedDoc, buf: Buffer | undefined, name: string, x: number, y: number, w: number, h: number) {
  const C = doc.brand.palette;
  if (buf) {
    let drawn = false;
    doc.save();
    try {
      doc.rect(x, y, w, h).clip();
      doc.image(buf, x, y, { cover: [w, h], align: 'center', valign: 'center' });
      drawn = true;
    } catch {
      // unreadable image — fall through to the initials placeholder
    }
    doc.restore();
    if (drawn) {
      doc.save().lineWidth(0.8).strokeColor(C.accent).rect(x, y, w, h).stroke().restore();
      return;
    }
  }
  doc.rect(x, y, w, h).fill(C.primary);
  doc.save().lineWidth(0.8).strokeColor(C.accent).rect(x, y, w, h).stroke().restore();
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase() ?? '').join('');
  doc.font(FONT.disp).fontSize(h * 0.32).fillColor(C.accentSoft).text(initials, x, y + h / 2 - h * 0.21, { width: w, align: 'center' });
}

function renderTeam(doc: BrandedDoc, content: FirmProfileContent, images: Map<string, Buffer>) {
  const C = doc.brand.palette;
  const { team } = content;
  doc.addPage();
  paintSurfacePage(doc);
  let y = sectionHeader(doc, team.heading, 104, { caps: false, size: 36 });

  const newPage = () => {
    doc.addPage();
    paintSurfacePage(doc);
    y = CONTENT_TOP;
  };
  const ensure = (h: number) => {
    if (y + h > CONTENT_BOTTOM) {
      newPage();
      return true;
    }
    return false;
  };

  // `firstBlockH` keeps a label from being stranded at the foot of a page with
  // its first member on the next one.
  const groupLabel = (label: string, firstBlockH = 0) => {
    ensure(28 + firstBlockH);
    doc.font(FONT.bodyB).fontSize(11.5).fillColor(C.accent).text(label.toUpperCase(), M.left, y, { characterSpacing: 2.5 });
    const ly = doc.y + 4;
    doc.save().lineWidth(0.6).strokeColor(C.hairline).moveTo(M.left, ly).lineTo(PAGE.w - M.right, ly).stroke().restore();
    y = ly + 12;
  };

  const renderListGroup = (g: TeamGroup) => {
    const photoW = 84;
    const photoH = Math.round(photoW / HEADSHOT_AR);
    const textX = M.left + photoW + 20;
    const textW = CONTENT_W - photoW - 20;
    const blockHeight = (mem: TeamMember) => {
      doc.font(FONT.bodyB).fontSize(11.5);
      const nameH = doc.heightOfString(mem.name.toUpperCase(), { width: textW, characterSpacing: 0.5 });
      doc.font(FONT.bodyIt).fontSize(10.5);
      const titleH = doc.heightOfString(mem.title, { width: textW });
      doc.font(FONT.body).fontSize(10);
      const bioH = mem.bio ? doc.heightOfString(mem.bio, { width: textW, align: 'justify', lineGap: 1.5 }) : 0;
      return Math.max(photoH, nameH + 2 + titleH + 6 + bioH) + 20;
    };

    groupLabel(g.label, g.members[0] ? blockHeight(g.members[0]) : 0);
    for (const mem of g.members) {
      // A group that spills onto the next page repeats its label, so a member
      // is never stranded under a heading that stayed behind.
      if (ensure(blockHeight(mem))) groupLabel(`${g.label} (cont’d)`);

      const top = y;
      drawPhoto(doc, mem.photoUrl ? images.get(mem.photoUrl) : undefined, mem.name, M.left, top, photoW, photoH);
      doc.font(FONT.bodyB).fontSize(11.5).fillColor(C.ink).text(mem.name.toUpperCase(), textX, top, { width: textW, characterSpacing: 0.5 });
      doc.font(FONT.bodyIt).fontSize(10.5).fillColor(C.accent).text(mem.title, textX, doc.y + 1, { width: textW });
      if (mem.bio) doc.font(FONT.body).fontSize(10).fillColor(C.inkSoft).text(mem.bio, textX, doc.y + 5, { width: textW, align: 'justify', lineGap: 1.5 });
      y = Math.max(top + photoH, doc.y) + 18;
    }
  };

  const renderGridGroup = (g: TeamGroup) => {
    const perRow = 4;
    const cellW = CONTENT_W / perRow;
    const photoW = 78;
    const photoH = Math.round(photoW / HEADSHOT_AR);
    const capW = cellW - 8;
    // A two-line name or title has to push the whole row down, not overlap the
    // next one — so the row is as tall as its tallest caption.
    const captionH = (mem: TeamMember) => {
      doc.font(FONT.bodyB).fontSize(9.5);
      const nameH = doc.heightOfString(mem.name.toUpperCase(), { width: capW, align: 'center', characterSpacing: 0.3 });
      doc.font(FONT.bodyIt).fontSize(9);
      const titleH = doc.heightOfString(mem.title, { width: capW, align: 'center' });
      return nameH + 1 + titleH;
    };
    const rowHeight = (row: TeamMember[]) => photoH + 6 + Math.max(...row.map(captionH)) + 16;

    groupLabel(g.label, g.members.length ? rowHeight(g.members.slice(0, perRow)) : 0);
    for (let i = 0; i < g.members.length; i += perRow) {
      const row = g.members.slice(i, i + perRow);
      const rowH = rowHeight(row);
      if (ensure(rowH)) groupLabel(`${g.label} (cont’d)`);
      const rowTop = y;
      row.forEach((mem, j) => {
        const cellX = M.left + cellW * j;
        const px = cellX + (cellW - photoW) / 2;
        drawPhoto(doc, mem.photoUrl ? images.get(mem.photoUrl) : undefined, mem.name, px, rowTop, photoW, photoH);
        doc.font(FONT.bodyB).fontSize(9.5).fillColor(C.ink).text(mem.name.toUpperCase(), cellX + 4, rowTop + photoH + 6, { width: capW, align: 'center', characterSpacing: 0.3 });
        doc.font(FONT.bodyIt).fontSize(9).fillColor(C.accent).text(mem.title, cellX + 4, doc.y + 1, { width: capW, align: 'center' });
      });
      y = rowTop + rowH;
    }
  };

  for (const g of team.groups) {
    if (g.layout === 'grid') renderGridGroup(g);
    else renderListGroup(g);
  }

  if (team.support.length) {
    ensure(40 + team.support.length * 18);
    groupLabel(team.supportLabel);
    const nameW = 210;
    for (const s of team.support) {
      ensure(18);
      doc.font(FONT.bodyB).fontSize(10.5).fillColor(C.ink).text(s.name, M.left, y, { width: nameW });
      doc.font(FONT.body).fontSize(10.5).fillColor(C.inkMuted).text(`—  ${s.role}`, M.left + nameW + 8, y);
      y = doc.y + 4;
    }
  }
}

// ════════════════════════════════════════════════════════════════════
// PAGE N — THE FIRM AT A GLANCE
// ════════════════════════════════════════════════════════════════════
function renderGlance(doc: BrandedDoc, content: FirmProfileContent) {
  const C = doc.brand.palette;
  const { glance } = content;
  doc.addPage();
  paintSurfacePage(doc);
  let y = sectionHeader(doc, glance.heading, 116);

  const colGap = 36;
  const colW = (CONTENT_W - colGap) / 2;
  const rowH = 116;
  y += 8;
  glance.stats.forEach((stat, i) => {
    const col = i % 2;
    const cellX = M.left + col * (colW + colGap);
    if (col === 0 && i > 0) y += rowH;
    const cellY = y;
    doc.font(FONT.disp).fontSize(52).fillColor(C.accent).text(stat.value, cellX, cellY);
    const labelY = cellY + 60;
    doc.font(FONT.body).fontSize(11).fillColor(C.primary).text(stat.label.toUpperCase(), cellX, labelY, { width: colW, characterSpacing: 1.5 });
    doc.save().lineWidth(0.8).strokeColor(C.hairline).moveTo(cellX, labelY + 22).lineTo(cellX + colW, labelY + 22).stroke().restore();
  });
  y += rowH + 28;

  if (glance.affiliations.length) {
    if (y + 40 + glance.affiliations.length * 18 > CONTENT_BOTTOM) {
      doc.addPage();
      paintSurfacePage(doc);
      y = CONTENT_TOP;
    }
    doc.font(FONT.bodyB).fontSize(12).fillColor(C.accent).text(glance.affiliationsLabel.toUpperCase(), M.left, y, { characterSpacing: 2 });
    const ly = doc.y + 4;
    doc.save().lineWidth(0.6).strokeColor(C.hairline).moveTo(M.left, ly).lineTo(PAGE.w - M.right, ly).stroke().restore();
    y = ly + 12;
    doc.font(FONT.body).fontSize(10.5).fillColor(C.inkSoft);
    for (const aff of glance.affiliations) {
      doc.save().circle(M.left + 2, y + 6, 1.4).fill(C.accent).restore();
      doc.font(FONT.body).fontSize(10.5).fillColor(C.inkSoft).text(aff, M.left + 12, y, { width: CONTENT_W - 12 });
      y = doc.y + 6;
    }
  }
}

// ════════════════════════════════════════════════════════════════════
// PAGE N+1 — CONTACT
// ════════════════════════════════════════════════════════════════════
function renderContact(doc: BrandedDoc, content: FirmProfileContent) {
  const C = doc.brand.palette;
  const { contact } = content;
  doc.addPage();
  doc.rect(0, 0, PAGE.w, PAGE.h).fill(C.surface);

  // Navy banner with a grid of gold monograms.
  const bannerH = 500;
  doc.rect(0, 0, PAGE.w, bannerH).fill(C.primary);
  const cols = 8;
  const gap = PAGE.w / cols;
  const markH = 46;
  for (let gy = 40; gy + markH < bannerH - 16; gy += 94) {
    for (let i = 0; i < cols; i++) {
      drawMark(doc, gap * i + gap / 2, gy, markH, 0.6, 'light');
    }
  }
  // Thin gold rule capping the banner.
  doc.save().lineWidth(1).strokeColor(C.accent).moveTo(M.left, bannerH - 0.5).lineTo(PAGE.w - M.right, bannerH - 0.5).stroke().restore();

  let y = bannerH + 44;
  doc.font(FONT.disp).fontSize(33).fillColor(C.primary).text(contact.heading.toUpperCase(), M.left, y, { characterSpacing: 2 });
  y = doc.y + 6;
  doc.save().lineWidth(0.9).strokeColor(C.accentLine).moveTo(M.left, y).lineTo(M.left + 70, y).stroke().restore();
  y += 18;

  const label = (t: string) => {
    doc.font(FONT.bodyB).fontSize(10.5).fillColor(C.accent).text(t.toUpperCase(), M.left, y, { characterSpacing: 1 });
    y = doc.y + 3;
  };
  const lines = (arr: string[]) => {
    doc.font(FONT.body).fontSize(11).fillColor(C.ink);
    for (const l of arr) {
      doc.text(l, M.left, y);
      y = doc.y + 1;
    }
  };

  label(contact.officeLabel);
  lines(contact.addressLines);
  y += 10;
  label('Phone');
  lines([contact.phone]);
  y += 8;
  label('Email');
  lines([contact.email]);
  y += 8;
  label('Website');
  lines([contact.website]);

  // Deco bars echoing the cover — uniform width + spacing, staggered tops and
  // bottoms — anchored to the bottom-right.
  drawDecoBars(doc, 450, 18, 30, [
    { top: 548, bottom: 812, color: C.accent },
    { top: 588, bottom: 770, color: C.accentSoft },
    { top: 508, bottom: 824, color: C.accent },
    { top: 572, bottom: 740, color: C.primaryBar },
  ]);
}

// ── Entry point ─────────────────────────────────────────────────────
export async function generateFirmProfilePdf(brand: Brand, content: FirmProfileContent): Promise<Buffer> {
  const images = await prefetchImages(content);

  return new Promise<Buffer>((resolve, reject) => {
    const doc = brandedDocument(brand, {
      bufferPages: true,
      info: {
        Title: `${brand.documentName} — Firm Profile ${content.cover.year}`.trim(),
        Author: brand.documentName,
        Subject: 'Firm Profile',
      },
    });

    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c as Buffer));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    try {
      renderCover(doc, content);
      renderAbout(doc, content);
      renderPracticeAreas(doc, content);
      renderTeam(doc, content, images);
      renderGlance(doc, content);
      renderContact(doc, content);

      // Stamp wordmark + page-number footers on the interior content pages
      // (skip the cover at index 0 and the contact page at the end).
      const range = doc.bufferedPageRange();
      const last = range.start + range.count - 1;
      for (let i = range.start + 1; i < last; i++) {
        doc.switchToPage(i);
        footer(doc, brand.documentName, i + 1);
      }

      doc.end();
    } catch (err) {
      reject(err as Error);
    }
  });
}
