'use client';

import { useBrand } from '@/components/BrandProvider';
import SourceLink from '@/components/SourceLink';

export default function PortalFooter() {
  const brand = useBrand();
  const firmName = brand.fullName || (brand.firmId ? brand.shortName : '');
  return (
    <footer className="border-t border-gold-200/30 dark:border-gold-400/10 mt-16">
      <div className="max-w-5xl mx-auto px-6 py-10 text-center">
        <div className="flex items-center justify-center gap-3 text-gold-700 dark:text-gold-400 mb-3">
          <span className="h-px w-12 bg-gold-300/60 dark:bg-gold-400/30" />
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="currentColor"
            className="w-3 h-3 opacity-60"
            aria-hidden="true"
          >
            <path d="M12 2L9 9l-7 1 5 5-1 7 6-3 6 3-1-7 5-5-7-1-3-7z" />
          </svg>
          <span className="h-px w-12 bg-gold-300/60 dark:bg-gold-400/30" />
        </div>
        {firmName && (
          <p className="font-serif text-base text-foreground tracking-tight">{firmName}</p>
        )}
        {brand.tagline && (
          <p className="text-[10px] uppercase tracking-[0.22em] text-[var(--text-muted)] mt-2">
            {brand.tagline}
          </p>
        )}
        <SourceLink className="mt-4 inline-block text-[11px] text-[var(--text-muted)] hover:text-foreground transition-colors" />
      </div>
    </footer>
  );
}
