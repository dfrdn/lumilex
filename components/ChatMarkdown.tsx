import React from 'react';

// Minimal markdown renderer for AI chat messages — covers the subset Claude
// actually emits in chat (bold, italics, links, bullet/numbered lists, light
// headers) without adding a markdown dependency. Builds React nodes
// directly, so untrusted content can't inject HTML.

// `[label](url)` or a bare http(s) URL. Links are split out before bold and
// italics so an underscore or asterisk inside a URL can't break it.
const LINK_RE = /\[([^\]\n]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s<>()]+)/g;

function safeHref(url: string): string | null {
  if (url.startsWith('/') && !url.startsWith('//')) return url;
  return /^https?:\/\//i.test(url) ? url : null;
}

function renderInline(text: string, keyBase: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const m of text.matchAll(LINK_RE)) {
    const start = m.index ?? 0;
    let raw = m[0];
    let label: string;
    let url: string;
    if (m[3]) {
      // Trailing sentence punctuation belongs to the prose, not the URL.
      url = m[3].replace(/[.,;:!?'"]+$/, '');
      raw = url;
      label = url;
    } else {
      label = m[1];
      url = m[2];
    }
    const href = safeHref(url);
    if (!href) continue;
    if (start > last) nodes.push(...renderEmphasis(text.slice(last, start), `${keyBase}-t${n}`));
    const external = /^https?:\/\//i.test(href);
    nodes.push(
      <a
        key={`${keyBase}-a${n}`}
        href={href}
        className="underline underline-offset-2 break-all hover:opacity-80"
        {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      >
        {m[3] ? label : renderEmphasis(label, `${keyBase}-l${n}`)}
      </a>,
    );
    last = start + raw.length;
    n++;
  }
  if (last < text.length) nodes.push(...renderEmphasis(text.slice(last), `${keyBase}-t${n}`));
  return nodes;
}

function renderEmphasis(text: string, keyBase: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  // Bold first (** **), then italics (* * or _ _) inside the remainder.
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  parts.forEach((part, i) => {
    if (/^\*\*[^*]+\*\*$/.test(part)) {
      nodes.push(<strong key={`${keyBase}-b${i}`}>{part.slice(2, -2)}</strong>);
      return;
    }
    if (!part) return;
    const italicParts = part.split(/(\*[^*\n]+\*|_[^_\n]+_)/g);
    italicParts.forEach((seg, j) => {
      if (/^\*[^*\n]+\*$/.test(seg) || /^_[^_\n]+_$/.test(seg)) {
        nodes.push(<em key={`${keyBase}-i${i}-${j}`}>{seg.slice(1, -1)}</em>);
      } else if (seg) {
        nodes.push(seg);
      }
    });
  });
  return nodes;
}

type Block =
  | { kind: 'paragraph'; lines: string[] }
  | { kind: 'ul'; items: string[] }
  | { kind: 'ol'; items: string[] }
  | { kind: 'heading'; text: string };

function parseBlocks(content: string): Block[] {
  const blocks: Block[] = [];
  const lines = content.replace(/\r\n/g, '\n').split('\n');

  for (const raw of lines) {
    const line = raw.trimEnd();
    const trimmed = line.trim();

    if (trimmed === '') {
      // Blank line terminates the current block.
      if (blocks[blocks.length - 1]?.kind === 'paragraph' && (blocks[blocks.length - 1] as { lines: string[] }).lines.length === 0) continue;
      blocks.push({ kind: 'paragraph', lines: [] });
      continue;
    }

    const bullet = trimmed.match(/^[-*•]\s+(.*)$/);
    const numbered = trimmed.match(/^\d+[.)]\s+(.*)$/);
    const heading = trimmed.match(/^#{1,4}\s+(.*)$/);

    if (heading) {
      blocks.push({ kind: 'heading', text: heading[1] });
      continue;
    }
    if (bullet) {
      const last = blocks[blocks.length - 1];
      if (last?.kind === 'ul') last.items.push(bullet[1]);
      else blocks.push({ kind: 'ul', items: [bullet[1]] });
      continue;
    }
    if (numbered) {
      const last = blocks[blocks.length - 1];
      if (last?.kind === 'ol') last.items.push(numbered[1]);
      else blocks.push({ kind: 'ol', items: [numbered[1]] });
      continue;
    }

    const last = blocks[blocks.length - 1];
    if (last?.kind === 'paragraph') last.lines.push(trimmed);
    else blocks.push({ kind: 'paragraph', lines: [trimmed] });
  }

  return blocks.filter((b) => b.kind !== 'paragraph' || b.lines.length > 0);
}

export default function ChatMarkdown({ content }: { content: string }) {
  const blocks = parseBlocks(content);

  return (
    <div className="space-y-2 break-words">
      {blocks.map((block, i) => {
        switch (block.kind) {
          case 'heading':
            return (
              <p key={i} className="font-semibold">
                {renderInline(block.text, `h${i}`)}
              </p>
            );
          case 'ul':
            return (
              <ul key={i} className="list-disc pl-5 space-y-1">
                {block.items.map((item, j) => (
                  <li key={j}>{renderInline(item, `u${i}-${j}`)}</li>
                ))}
              </ul>
            );
          case 'ol':
            return (
              <ol key={i} className="list-decimal pl-5 space-y-1">
                {block.items.map((item, j) => (
                  <li key={j}>{renderInline(item, `o${i}-${j}`)}</li>
                ))}
              </ol>
            );
          case 'paragraph':
            return (
              <p key={i}>
                {block.lines.map((line, j) => (
                  <React.Fragment key={j}>
                    {j > 0 && <br />}
                    {renderInline(line, `p${i}-${j}`)}
                  </React.Fragment>
                ))}
              </p>
            );
        }
      })}
    </div>
  );
}
