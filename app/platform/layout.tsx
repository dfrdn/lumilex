import { redirect } from 'next/navigation';
import { getOperatorSession } from '@/lib/platform/auth';
import PlatformHeader from '@/components/platform/PlatformHeader';

/**
 * The operator surface's own shell.
 *
 * `proxy.ts` already redirects a non-operator away, and this is the second
 * gate. Both exist for the reason the portal's do: the proxy is a routing
 * decision on the edge and a mistake in its matcher must not be the only thing
 * between a signed-in staff member and every tenant's configuration. Unlike
 * every other surface, there is no RLS gate underneath — the reads here are
 * service-role by necessity — so these two are the entire boundary.
 *
 * `redirect`, not `notFound()` or a 403: the same reasoning as the proxy's, so
 * the two agree on what a non-operator sees.
 */
export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const operator = await getOperatorSession();
  if (!operator) redirect('/dashboard');

  return (
    <div className="min-h-screen bg-background">
      <PlatformHeader operatorLabel={operator.name ?? operator.email} />
      <main className="max-w-6xl mx-auto px-6 py-8">{children}</main>
    </div>
  );
}
