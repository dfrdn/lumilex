'use client';

import { useState } from 'react';
import { useBrand } from '@/components/BrandProvider';

/**
 * The firm's mark wherever the chrome shows one.
 *
 * A firm with no logo configured is a normal, supported state — not every tenant
 * arrives with a PNG — so this falls back to the firm's name set as a text
 * wordmark. It never falls back to a packaged image: a header is the most-seen
 * surface in the app, and a stand-in mark there would put one firm's identity in
 * front of another firm's staff all day.
 *
 * It also falls back when the image *fails to load* (a deleted object, a storage
 * hiccup), because a broken-image glyph in the masthead reads as a broken app.
 */

/** Bar lockups sit on the dark app header; card lockups on a light surface. */
type Ground = 'dark' | 'light';

export function BrandWordmark({
  ground = 'dark',
  className = 'h-7 w-auto',
}: {
  ground?: Ground;
  className?: string;
}) {
  const brand = useBrand();
  const [failed, setFailed] = useState(false);
  const src = ground === 'dark' ? brand.logoLightUrl : brand.logoUrl;
  const label = brand.fullName || brand.shortName;

  if (src && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={src} alt={label} className={className} onError={() => setFailed(true)} />
    );
  }

  return (
    <span
      className={`font-serif text-base font-semibold tracking-tight whitespace-nowrap ${
        ground === 'dark' ? 'text-white' : 'text-foreground'
      }`}
    >
      {brand.shortName}
    </span>
  );
}

/**
 * The square mark used on sign-in cards and the portal header. Falls back to the
 * firm's initials on a neutral tile — a shape, not somebody else's shape.
 */
export function BrandMonogram({ className = 'w-14 h-14 rounded-xl' }: { className?: string }) {
  const brand = useBrand();
  const [failed, setFailed] = useState(false);
  const label = brand.fullName || brand.shortName;

  if (brand.monogramUrl && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={brand.monogramUrl}
        alt={label}
        className={`${className} object-cover`}
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <div
      className={`${className} bg-navy-900 dark:bg-[#1C1C1E] dark:border dark:border-[rgba(255,255,255,0.06)] flex items-center justify-center`}
      aria-hidden="true"
    >
      <span className="font-serif text-2xl font-bold tracking-tight text-gold-300">
        {initials(brand.shortName)}
      </span>
    </div>
  );
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  // A short name is already a monogram — "DEV" reads better than "DE".
  if (words.length === 1) return words[0].slice(0, words[0].length <= 4 ? 4 : 2).toUpperCase();
  return words
    .slice(0, 3)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}
