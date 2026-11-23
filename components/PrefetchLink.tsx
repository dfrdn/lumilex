'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ComponentProps } from 'react';

/**
 * A Link that prefetches on hover, focus or touch rather than on entering the
 * viewport. Use it for links repeated down a list: a 200-row table would
 * otherwise fire 200 prefetches, each a function invocation and an auth check.
 */
export default function PrefetchLink({ href, onMouseEnter, onFocus, onTouchStart, ...rest }: ComponentProps<typeof Link>) {
  const router = useRouter();
  const prefetch = () => {
    if (typeof href === 'string') router.prefetch(href);
  };
  return (
    <Link
      {...rest}
      href={href}
      prefetch={false}
      onMouseEnter={(e) => { prefetch(); onMouseEnter?.(e); }}
      onFocus={(e) => { prefetch(); onFocus?.(e); }}
      onTouchStart={(e) => { prefetch(); onTouchStart?.(e); }}
    />
  );
}
