import { requireRouteAccess } from '@/lib/nav/guard';

// Portal preview is an internal partner/admin tool, gated by the route map
// like the proxy (defense in depth). The proxy also closes it when the firm
// has no portal.
export function requirePreviewAccess() {
  return requireRouteAccess('/client-portal-preview');
}
