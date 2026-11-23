'use client';

import { useEffect } from 'react';

/**
 * Intercepts clicks on links inside admin detail iframes.
 * When a link points to /dashboard/[entity]/[id], it posts a message
 * to the parent window so the admin tab system can open it.
 */

const ENTITY_PATTERN = /^\/dashboard\/(clients|matters|deliverables|tasks|meetings|hearings|filings|files)\/([a-f0-9-]+)$/;

export default function IframeLinkInterceptor() {
  useEffect(() => {
    // Only active when rendered inside an iframe
    if (window === window.parent) return;

    function handleClick(e: MouseEvent) {
      const anchor = (e.target as HTMLElement).closest('a');
      if (!anchor) return;

      const href = anchor.getAttribute('href');
      if (!href) return;

      const match = href.match(ENTITY_PATTERN);
      if (!match) return;

      e.preventDefault();
      e.stopPropagation();

      const [, entity, id] = match;
      const label = anchor.textContent?.trim() || id.slice(0, 8);

      window.parent.postMessage(
        { type: 'admin-open-detail', entity, id, label },
        window.location.origin,
      );
    }

    document.addEventListener('click', handleClick, true);
    return () => document.removeEventListener('click', handleClick, true);
  }, []);

  return null;
}
