import { CARD } from './tone';

/**
 * Placeholders in the shape of the page that is loading, so a slow load shows
 * that page rather than some other one. A route with no shape of its own gets
 * `PageSkeleton`, which promises nothing but a header and content.
 */

const bar = 'rounded skeleton-shimmer';

/** Where `PageHeader` will be: icon, title, subtitle. */
export function PageHeaderSkeleton() {
  return (
    <div className="mb-6">
      <div className="flex items-center gap-2">
        <div className={`h-5 w-5 ${bar}`} />
        <div className={`h-8 w-44 ${bar} rounded-lg`} />
      </div>
      <div className={`h-4 w-48 ${bar} mt-1.5`} />
    </div>
  );
}

/**
 * A header and one plain panel: the fallback for any route without its own.
 * `tabs` adds the tab row, for a route whose tabs have different bodies.
 */
export function PageSkeleton({ tabs = false }: { tabs?: boolean }) {
  return (
    <div className="animate-fade-up" aria-busy aria-label="Loading">
      <PageHeaderSkeleton />
      {tabs && <div className="h-7 w-56 max-w-full rounded-lg skeleton-shimmer mb-4" />}
      <div className={`${CARD} px-5 py-4 space-y-4`}>
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className={`h-3.5 ${i % 2 ? 'w-2/3' : 'w-5/6'} ${bar}`} />
        ))}
      </div>
    </div>
  );
}

/** Header, summary cards, a panel, the toolbar and rows — a registry list. */
export function SubjectListSkeleton({ cards = 4 }: { cards?: number }) {
  return (
    <div className="animate-fade-up space-y-5" aria-busy aria-label="Loading">
      <div>
        <div className="flex items-center gap-2">
          <div className={`h-5 w-5 ${bar}`} />
          <div className={`h-7 w-44 ${bar} rounded-lg`} />
        </div>
        <div className={`h-4 w-72 ${bar} mt-1.5`} />
      </div>
      <div className={`grid gap-3 grid-cols-2 ${cards === 5 ? 'lg:grid-cols-5' : 'lg:grid-cols-4'}`}>
        {Array.from({ length: cards }, (_, i) => (
          <div key={i} className={`${CARD} px-4 py-3.5`}>
            <div className="flex items-center justify-between">
              <div className={`h-3 w-20 ${bar}`} />
              <div className={`h-7 w-7 ${bar} rounded-lg`} />
            </div>
            <div className={`h-8 w-10 ${bar} mt-2`} />
            <div className={`h-3 w-28 ${bar} mt-1.5`} />
          </div>
        ))}
      </div>
      <div className={`${CARD} px-5 py-3`}>
        <div className={`h-4 w-32 ${bar}`} />
      </div>
      <div className="flex gap-3">
        <div className={`h-10 flex-1 ${bar} rounded-xl`} />
        <div className={`h-10 w-36 ${bar} rounded-xl`} />
      </div>
      <div className={`${CARD} divide-y divide-stone-100 dark:divide-white/[0.06]`}>
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className="px-4 py-3 flex items-center gap-3">
            <div className={`h-8 w-8 ${bar} rounded-lg`} />
            <div className="flex-1 space-y-1.5">
              <div className={`h-3.5 w-48 ${bar}`} />
              <div className={`h-3 w-32 ${bar}`} />
            </div>
            <div className={`hidden md:block h-5 w-20 ${bar} rounded-full`} />
            <div className={`hidden md:block h-3.5 w-40 ${bar}`} />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Crumbs, header, stepper, track cards and a two-column body — a subject's page. */
export function SubjectDetailSkeleton({ tracks = 2 }: { tracks?: number }) {
  return (
    <div className="animate-fade-up space-y-4" aria-busy aria-label="Loading">
      <div className={`h-3.5 w-64 ${bar}`} />
      <div className={`${CARD} px-5 pt-5 pb-4 flex gap-4`}>
        <div className={`h-12 w-12 ${bar} rounded-xl`} />
        <div className="flex-1 space-y-2">
          <div className={`h-7 w-56 ${bar} rounded-lg`} />
          <div className="flex gap-1.5">
            <div className={`h-5 w-20 ${bar} rounded-md`} />
            <div className={`h-5 w-28 ${bar} rounded-md`} />
            <div className={`h-5 w-24 ${bar} rounded-md`} />
          </div>
        </div>
      </div>
      <div className={`${CARD} px-4 py-3 flex gap-6`}>
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="flex-1 flex items-center gap-2.5">
            <div className={`h-6 w-6 ${bar} rounded-full`} />
            <div className="space-y-1">
              <div className={`h-3 w-20 ${bar}`} />
              <div className={`h-2.5 w-24 ${bar}`} />
            </div>
          </div>
        ))}
      </div>
      <div className={`grid gap-3 ${tracks === 1 ? 'grid-cols-1' : tracks === 2 ? 'grid-cols-2' : 'grid-cols-2 lg:grid-cols-3'}`}>
        {Array.from({ length: tracks }, (_, i) => (
          <div key={i} className={`${CARD} px-4 py-3.5 space-y-3`}>
            <div className={`h-4 w-28 ${bar}`} />
            <div className={`h-4 w-48 ${bar}`} />
            <div className={`h-1.5 w-full ${bar} rounded-full`} />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          {[3, 5].map((rows, i) => (
            <div key={i} className={`${CARD} px-5 py-4 space-y-3`}>
              <div className={`h-4 w-32 ${bar}`} />
              {Array.from({ length: rows }, (_, j) => (
                <div key={j} className={`h-3.5 ${j % 2 ? 'w-2/3' : 'w-5/6'} ${bar}`} />
              ))}
            </div>
          ))}
        </div>
        <div className={`${CARD} px-5 py-4 space-y-3 self-start`}>
          <div className={`h-4 w-24 ${bar}`} />
          {Array.from({ length: 6 }, (_, j) => (
            <div key={j} className="flex justify-between">
              <div className={`h-3 w-20 ${bar}`} />
              <div className={`h-3 w-24 ${bar}`} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function CardSkeleton({ rows, facts = false }: { rows: number; facts?: boolean }) {
  return (
    <div className={`${CARD} px-5 py-4 space-y-3`}>
      <div className={`h-4 w-28 ${bar}`} />
      {Array.from({ length: rows }, (_, j) =>
        facts ? (
          <div key={j} className="flex justify-between">
            <div className={`h-3 w-20 ${bar}`} />
            <div className={`h-3 w-24 ${bar}`} />
          </div>
        ) : (
          <div key={j} className={`h-3.5 ${j % 2 ? 'w-2/3' : 'w-5/6'} ${bar}`} />
        ),
      )}
    </div>
  );
}

/**
 * Crumbs, the subject header, an optional action row, a two-column body and
 * the comments under it — a hearing's, meeting's, deliverable's or client's
 * page loading. `left` and `right` give each card's line count.
 */
export function PageDetailSkeleton({
  badge = 'monogram',
  actions = false,
  left = [2, 6],
  right = [3, 5],
  comments = true,
}: {
  /** A calendar leaf (hearings, meetings) or a monogram tile. */
  badge?: 'date' | 'monogram';
  actions?: boolean;
  left?: number[];
  right?: number[];
  comments?: boolean;
}) {
  return (
    <div className="animate-fade-up space-y-4" aria-busy aria-label="Loading">
      <div className="flex items-center gap-2">
        <div className={`h-3.5 w-20 ${bar}`} />
        <div className={`h-3.5 w-28 ${bar}`} />
        <div className={`h-3.5 w-40 ${bar}`} />
      </div>
      <div className={`${CARD} px-5 pt-5 pb-4 flex gap-4`}>
        {badge === 'date' ? (
          <div className="w-12 shrink-0 overflow-hidden rounded-xl border border-stone-200 dark:border-white/10">
            <div className={`h-3.5 ${bar} rounded-none`} />
            <div className="h-9 flex items-center justify-center">
              <div className={`h-5 w-5 ${bar}`} />
            </div>
          </div>
        ) : (
          <div className={`h-12 w-12 shrink-0 ${bar} rounded-xl`} />
        )}
        <div className="flex-1 space-y-2">
          <div className="flex items-center gap-3">
            <div className={`h-7 w-64 ${bar} rounded-lg`} />
            <div className={`h-5 w-20 ${bar} rounded-full`} />
          </div>
          <div className="flex gap-1.5">
            <div className={`h-5 w-24 ${bar} rounded-md`} />
            <div className={`h-5 w-32 ${bar} rounded-md`} />
            <div className={`h-5 w-20 ${bar} rounded-md`} />
          </div>
        </div>
        <div className="hidden sm:flex items-center gap-2 self-start">
          <div className={`h-3 w-8 ${bar}`} />
          <div className="flex -space-x-2">
            <div className={`h-7 w-7 ${bar} rounded-full ring-2 ring-white dark:ring-[var(--card-bg)]`} />
            <div className={`h-7 w-7 ${bar} rounded-full ring-2 ring-white dark:ring-[var(--card-bg)]`} />
          </div>
        </div>
      </div>
      {actions && (
        <div className="flex gap-2">
          <div className={`h-9 w-32 ${bar} rounded-xl`} />
          <div className={`h-9 w-28 ${bar} rounded-xl`} />
        </div>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        <div className="lg:col-span-2 space-y-4">
          {left.map((rows, i) => (
            <CardSkeleton key={i} rows={rows} />
          ))}
        </div>
        <div className="space-y-4">
          {right.map((rows, i) => (
            <CardSkeleton key={i} rows={rows} facts={i === right.length - 1} />
          ))}
        </div>
      </div>
      {comments && (
        <div className={`${CARD} px-5 py-4 space-y-3`}>
          <div className={`h-4 w-24 ${bar}`} />
          <div className="flex gap-3 pt-2">
            <div className={`h-8 w-8 shrink-0 ${bar} rounded-full`} />
            <div className={`h-16 flex-1 ${bar} rounded-xl`} />
          </div>
        </div>
      )}
    </div>
  );
}
