'use client';

import type { ReactNode } from 'react';
import { useBrand } from '@/components/BrandProvider';
import type { LetterParagraph } from '@/lib/docx/letter-body';

/**
 * A letter's paragraphs as they read on the firm letterhead — the preview on
 * every page that edits firm wording (the billing letter, the trademark
 * reports). The paragraphs are what lib/docx/letter-body builds the DOCX from.
 */

/** **bold**, *italic*, __underline__ as React runs — the same markup the letter uses. */
export function runs(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|__(.+?)__|(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[2]) out.push(<strong key={i++}><em>{m[2]}</em></strong>);
    else if (m[3]) out.push(<strong key={i++}>{m[3]}</strong>);
    else if (m[4]) out.push(<u key={i++}>{m[4]}</u>);
    else if (m[5]) out.push(<em key={i++}>{m[5]}</em>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function PreviewParagraph({ p }: { p: LetterParagraph }) {
  if (p.type === 'fields') {
    return (
      <table className={`w-full border-collapse ${p.ruleBelow ? 'border-b border-stone-800' : ''}`} style={{ marginBottom: 0 }}>
        <tbody>
          {(p.fields ?? []).map((r, i, rows) => (
            <tr key={i} className="align-top">
              <td className="p-0 pr-1.5 text-right whitespace-nowrap" style={{ width: `${(p.labelWidth ?? 1150) / 240}em`, paddingBottom: i === rows.length - 1 ? 8 : 6 }}>{runs(r.label)}</td>
              <td className="w-[1em] p-0" style={{ paddingBottom: i === rows.length - 1 ? 8 : 6 }}>{r.label ? ':' : ''}</td>
              <td className="p-0" style={{ paddingBottom: i === rows.length - 1 ? 8 : 6 }}>
                {r.lines.map((l, j) => <div key={j}>{runs(l)}</div>)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  const style: React.CSSProperties = {
    textAlign: p.alignment === 'right' ? 'right' : p.alignment === 'center' ? 'center' : p.style === 'BodyText' ? 'justify' : 'left',
    fontWeight: p.bold ? 600 : undefined,
    fontStyle: p.italic ? 'italic' : undefined,
    fontVariant: p.smallCaps ? 'small-caps' : undefined,
    marginBottom: p.style === 'BodyText' ? 10 : Math.round((p.spacing_after ?? 0) / 20),
    marginTop: p.spacing_before ? Math.round(p.spacing_before / 20) : undefined,
  };
  return <p style={style}>{runs(p.text)}</p>;
}

/**
 * The letter's words with sample figures. The head is a stand-in carrying the
 * firm's name: the real letter goes out on the firm's own letterhead
 * (lib/docx/letterhead.ts), in whichever design the firm has.
 */
export function LetterPreview({ paragraphs }: { paragraphs: LetterParagraph[] }) {
  const firmName = useBrand().fullName;
  return (
    <div className="rounded-lg border border-stone-200 dark:border-[rgba(255,255,255,0.1)] bg-white overflow-hidden flex">
      <div className="flex-1 min-w-0 px-7 py-6 text-[13px] leading-relaxed font-serif text-stone-800 max-h-[720px] overflow-y-auto">
        <div className="mb-5 text-center">
          <p className="tracking-[0.2em] uppercase text-stone-700 text-[13px]">{firmName || 'The firm letterhead'}</p>
          <div className="mx-auto mt-1 h-px w-40 bg-stone-300" />
        </div>
        {paragraphs.map((p, i) => <PreviewParagraph key={i} p={p} />)}
      </div>
    </div>
  );
}

