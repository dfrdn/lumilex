import type { Metadata } from 'next';
import { getOperatorSession, listOperators } from '@/lib/platform/auth';
import OperatorsClient from '@/components/platform/OperatorsClient';

export const metadata: Metadata = { title: 'Operators' };

/**
 * The operator roster.
 *
 * No firm is involved, which is why there is no per-firm audit read here — the
 * mutations audit into every firm's log instead (see the route's note), and a
 * roster listing is not a look into any tenant.
 */
export default async function PlatformOperatorsPage() {
  const operator = await getOperatorSession();
  if (!operator) return null;

  const operators = await listOperators();

  return (
    <>
      <div className="mb-6">
        <h1 className="font-serif text-2xl text-foreground tracking-tight">Operators</h1>
        <p className="text-sm text-[var(--text-secondary)] mt-1 max-w-3xl leading-relaxed">
          Everyone who can reach this surface. A platform operator is a third identity kind — not a
          firm&apos;s staff member with extra rights — and belongs to no firm. Adding one grants
          read and write access to every tenant&apos;s configuration, so each change is written
          into every firm&apos;s own audit log.
        </p>
      </div>

      <OperatorsClient initial={operators} selfAuthUserId={operator.authUserId} />
    </>
  );
}
