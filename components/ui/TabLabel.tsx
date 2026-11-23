'use client';

import { useLinkStatus } from 'next/link';
import { Loader2 } from 'lucide-react';

/** A segment link's text, with a spinner while the view it opens loads. Render inside the `Link`. */
export default function TabLabel({ label }: { label: string }) {
  const { pending } = useLinkStatus();
  return (
    <span className="inline-flex items-center gap-1.5" aria-busy={pending || undefined}>
      {label}
      {pending && <Loader2 className="w-3 h-3 animate-spin text-stone-400 dark:text-stone-500" aria-hidden />}
    </span>
  );
}
