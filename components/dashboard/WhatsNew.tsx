'use client';

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ChevronDown, ChevronUp, Sparkles, X } from 'lucide-react';
import Button from '@/components/ui/Button';
import { usePageVisits } from '@/hooks/use-page-visits';
import type { UserRole } from '@/lib/queries/team';
import { whatsNewFor, type WhatsNewItem } from '@/lib/whats-new';
import { useFeatures } from '@/components/FeatureProvider';

/** Cards drawn in the deck: the one in front and two peeking out beneath it. */
const DECK = 3;
/** How far each card behind sits below the one in front of it, in px. */
const STEP = 7;
/** How long a card takes to rise to the front or sink under the deck (one is the other in reverse), or lift away, in ms. */
const MOVE_MS = 560;
const AWAY_MS = 280;
const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';
/** Below the deck: where a card passes on its way to the bottom, or comes up from. */
const UNDER = `translateY(${STEP * DECK + 26}px) scale(0.9)`;

/** The front card sinking under the deck, the bottom card rising to the front, or the front card lifting away. */
type Motion = { key: string; kind: 'down' | 'up' | 'away' };

const reducedMotionQuery = '(prefers-reduced-motion: reduce)';
function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(reducedMotionQuery);
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    },
    () => window.matchMedia(reducedMotionQuery).matches,
    () => true,
  );
}

/**
 * "New for you" on the dashboard: the set-up to-dos that apply to the person
 * and the new tools they haven't opened (lib/whats-new.ts), as a deck of
 * cards. The next card waits at the bottom: Next brings it up from under the
 * deck to the front, and Previous sinks the front card back under to the
 * bottom as the one behind rises. The × lifts the front card away for good.
 * The deck goes when it's empty. Motion is skipped for anyone who asks their
 * system for less.
 */
export default function WhatsNew({ role }: { role: UserRole }) {
  const visits = usePageVisits();
  const flags = useFeatures();
  const reduce = useReducedMotion();
  const [at, setAt] = useState(0);
  const [motion, setMotion] = useState<Motion | null>(null);
  const cards = useRef(new Map<string, HTMLDivElement>());
  const drawn = useRef(new Set<string>());
  const dealt = useRef(false);

  const items = visits.loaded ? whatsNewFor(role, flags, visits) : [];
  const n = items.length;
  const i = n ? Math.min(at, n - 1) : 0;

  // Deal the deck in once, the first time there's something to show.
  useEffect(() => {
    if (dealt.current || n === 0) return;
    dealt.current = true;
    if (reduce) return;
    items.map((item, idx) => ({ item, depth: depthOf(idx, i, n) })).filter(({ depth }) => depth < DECK).forEach(({ item, depth }) => {
      cards.current.get(item.key)?.animate(
        [{ opacity: 0, transform: `translateY(${-14 - depth * 6}px) scale(0.96)` }, { opacity: 1, transform: pose(depth) }],
        { duration: 520, delay: (DECK - depth) * 70, easing: EASE, fill: 'backwards' },
      );
    });
  });

  // The deck moves at once: the cards behind shift by transition while the
  // moving card, kept on top, rises from under the deck to the front or —
  // the same path in reverse — sinks from the front to under it.
  useLayoutEffect(() => {
    if (!motion || motion.kind === 'away' || reduce) return;
    const el = cards.current.get(motion.key);
    if (!el) return;
    const front = { transform: pose(0), opacity: 1 };
    const under = { transform: UNDER, opacity: 0 };
    el.animate(motion.kind === 'up' ? [under, front] : [front, under], { duration: MOVE_MS, easing: EASE, fill: 'forwards' });
  }, [motion, reduce]);

  // A card that joins the bottom of the deck after it was dealt rises into place from under it.
  useLayoutEffect(() => {
    const now = new Set(cards.current.keys());
    if (dealt.current && !reduce) {
      for (const key of now) {
        if (drawn.current.has(key) || key === motion?.key) continue;
        const el = cards.current.get(key)!;
        el.animate([{ transform: UNDER, opacity: 0 }, { transform: el.style.transform, opacity: el.style.opacity }], { duration: MOVE_MS, easing: EASE });
      }
    }
    drawn.current = now;
  });

  if (n === 0) return null;

  const busy = motion !== null;
  const behind = Math.min(n - 1, DECK - 1);

  function next() {
    if (busy) return;
    const to = (i + 1) % n;
    setAt(to);
    if (reduce) return;
    setMotion({ key: items[to].key, kind: 'up' });
    setTimeout(() => {
      setMotion(null);
      cards.current.get(items[to].key)?.getAnimations().forEach((a) => a.cancel());
    }, MOVE_MS);
  }
  function prev() {
    if (busy) return;
    setAt((i - 1 + n) % n);
    if (reduce) return;
    const key = items[i].key;
    setMotion({ key, kind: 'down' });
    setTimeout(() => {
      setMotion(null);
      // Sunk under the deck, it comes up into its place at the bottom (or leaves, past it).
      const el = cards.current.get(key);
      if (!el) return;
      el.getAnimations().forEach((a) => a.cancel());
      el.animate([{ transform: UNDER, opacity: 0 }, { transform: el.style.transform, opacity: el.style.opacity }], { duration: 420, easing: EASE });
    }, MOVE_MS);
  }
  function dismiss() {
    if (busy) return;
    const key = items[i].key;
    if (reduce) return visits.dismissHint(key);
    setMotion({ key, kind: 'away' });
    setTimeout(() => { visits.dismissHint(key); setMotion(null); }, AWAY_MS);
  }

  // Each card's distance from the front; a moving card stays drawn until it lands. The
  // cards stay in list order and stack by z-index: moving one in the DOM would cancel its transition.
  const shown = items
    .map((item, idx) => ({ item, depth: depthOf(idx, i, n) }))
    .filter(({ item, depth }) => depth < DECK || item.key === motion?.key);

  return (
    <section aria-label="New for you" aria-roledescription="carousel" className="grid mb-4" style={{ paddingBottom: behind * STEP }}>
      {shown.map(({ item, depth }) => {
        const moving = item.key === motion?.key ? motion.kind : null;
        const away = moving === 'away';
        // Past the bottom of the deck: drawn only to finish the trip down, then gone.
        const past = depth >= DECK;
        return (
          <div
            key={item.key}
            ref={(el) => { if (el) cards.current.set(item.key, el); else cards.current.delete(item.key); }}
            aria-hidden={depth > 0 || undefined}
            className="[grid-area:1/1] rounded-xl border border-gold-200/80 bg-[var(--card-bg)] shadow-sm dark:border-gold-400/25 overflow-hidden"
            style={{
              transform: away ? 'translateY(-22px) scale(0.97)' : pose(past ? DECK - 1 : depth),
              opacity: away || past ? 0 : 1 - depth * 0.2,
              // Moving cards stay on top until they're done: a card sinking behind the deck at once would just vanish.
              zIndex: moving ? DECK + 1 : DECK - Math.min(depth, DECK),
              transformOrigin: 'bottom center',
              // A card on a keyframed path ignores the transition; a transition would win over its keyframes.
              transition: reduce || (moving && !away) ? 'none' : `transform ${away ? AWAY_MS : 420}ms ${EASE}, opacity ${away ? AWAY_MS : 300}ms ease`,
            }}
          >
            <CardBody
              item={item}
              front={(depth === 0 && !away) || moving === 'down'}
              position={{ index: i, total: n }}
              onPrev={prev}
              onNext={next}
              onDismiss={dismiss}
            />
          </div>
        );
      })}
    </section>
  );
}

/**
 * How far a card sits from the front. The deck runs backwards from the front
 * card, so the next one waits at the bottom, ready to come up.
 */
function depthOf(index: number, front: number, total: number): number {
  return (front - index + total) % total;
}

/** Where a card sits in the deck: each one behind is lower and a little narrower. */
function pose(depth: number): string {
  return `translateY(${depth * STEP}px) scale(${1 - depth * 0.035})`;
}

function CardBody({ item, front, position, onPrev, onNext, onDismiss }: {
  item: WhatsNewItem;
  front: boolean;
  position: { index: number; total: number };
  onPrev: () => void;
  onNext: () => void;
  onDismiss: () => void;
}) {
  const actions = (
    <>
      <Button size="sm" className="max-sm:min-h-9" href={item.action.href}>{item.action.label}</Button>
      {item.secondary && (
        <Button size="sm" variant="outline" className="max-sm:min-h-9" href={item.secondary.href}>{item.secondary.label}</Button>
      )}
    </>
  );
  return (
    <div
      className="relative flex items-start gap-3 px-4 py-3 bg-gradient-to-r from-gold-50/70 to-transparent dark:from-gold-400/[0.07]"
      style={{ opacity: front ? 1 : 0, transition: 'opacity 250ms ease' }}
      inert={!front || undefined}
    >
      <span className="mt-0.5 flex items-center justify-center w-8 h-8 shrink-0 rounded-lg bg-white/80 text-gold-700 ring-1 ring-inset ring-gold-200/80 dark:bg-white/[0.06] dark:text-gold-300 dark:ring-white/10">
        <item.icon className="w-4 h-4" />
      </span>
      {/* The explanation takes the middle; the buttons sit at the right under the deck's controls. On a phone
          the controls take the top-right corner and the text runs below them, with the buttons under it. */}
      <div className="flex-1 min-w-0 pt-8 max-sm:pt-9 md:pt-0">
        <p className="flex items-center gap-1 text-[10.5px] font-semibold uppercase tracking-wider text-gold-700 dark:text-gold-300">
          <Sparkles className="w-3 h-3" /> {item.todo ? 'To do' : 'New for you'}
        </p>
        <p className="text-sm font-medium text-[var(--text-primary)]">{item.title}</p>
        <p className="text-[13px] text-[var(--text-secondary)]">{item.body}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2 md:hidden">{actions}</div>
      </div>
      <div className="absolute top-2.5 right-2.5 md:static md:flex md:flex-col md:items-end md:gap-2 shrink-0 md:-mr-1.5 md:-mt-0.5">
        <div className="flex items-center gap-0.5">
          {position.total > 1 && (
            <>
              <IconButton label="Previous" title="Send this card back under" onClick={onPrev}><ChevronDown className="w-4 h-4" /></IconButton>
              <span className="text-[11px] tabular-nums text-[var(--text-muted)] min-w-[2.5rem] text-center" aria-live="polite">
                {position.index + 1} of {position.total}
              </span>
              <IconButton label="Next" title="Bring the next card up" onClick={onNext}><ChevronUp className="w-4 h-4" /></IconButton>
            </>
          )}
          <IconButton label={`Hide ${item.title}`} title="Not now" onClick={onDismiss}><X className="w-4 h-4" /></IconButton>
        </div>
        <div className="hidden md:flex items-center justify-end gap-2 pr-1.5">{actions}</div>
      </div>
    </div>
  );
}

function IconButton({ label, title, onClick, children }: { label: string; title?: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={title ?? label}
      className="p-1.5 max-sm:p-2.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--subtle-bg)] active:scale-90 transition"
    >
      {children}
    </button>
  );
}
