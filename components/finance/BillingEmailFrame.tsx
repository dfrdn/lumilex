'use client';

import { useEffect, useRef, useState } from 'react';

/** The email exactly as the client gets it, in a frame so its styles stay its own. */
export default function BillingEmailFrame({ html, subject, from }: { html: string; subject: string; from?: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(560);
  const fit = () => {
    const h = frame.current?.contentDocument?.body?.scrollHeight;
    if (h) setHeight(h);
  };
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div className="rounded-lg border border-[var(--border-color)] overflow-hidden">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 px-3 py-2.5 text-xs border-b border-[var(--border-color)] bg-stone-50/70 dark:bg-white/[0.03]">
        {from && (
          <>
            <dt className="text-[var(--text-secondary)]">From</dt>
            <dd className="text-foreground">{from}</dd>
          </>
        )}
        <dt className="text-[var(--text-secondary)]">Subject</dt>
        <dd className="text-foreground font-medium">{subject}</dd>
        <dt className="text-[var(--text-secondary)]">Attached</dt>
        <dd className="text-foreground">Billing Letter.pdf, Breakdown.pdf</dd>
      </dl>
      <iframe ref={frame} title="Email preview" srcDoc={html} sandbox="allow-same-origin" onLoad={fit} style={{ height }} className="block w-full border-0 bg-[#f1f5f9]" />
    </div>
  );
}

