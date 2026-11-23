import { z } from 'zod';

/**
 * The dashboard is a column of widgets. Each person may hide and reorder them;
 * what they choose is stored in `user_preferences.dashboard_layout` and read
 * back through `resolveLayout`, which also decides what their role may see.
 * Someone who never customized gets their role's default: a short board, with
 * the rest switched on from Customize.
 */

export const WIDGET_IDS = [
  'attention',
  'mydeliverables',
  'twoweeks',
  'today',
  'firm',
  'calendar',
  'deadlines',
  'inbox',
  'tasks',
  'time',
  'deliverables',
] as const;

export type WidgetId = (typeof WIDGET_IDS)[number];

export type CalendarMode = 'mine' | 'firm';

export const WIDGET_TITLES: Record<WidgetId, string> = {
  attention: 'Needs attention',
  mydeliverables: 'My deliverables',
  twoweeks: 'Next two weeks',
  today: "Today's schedule",
  firm: 'Firm at a glance',
  calendar: 'This week',
  deadlines: 'Deadlines',
  inbox: 'Recent files',
  tasks: 'My tasks',
  time: 'My time',
  deliverables: 'All deliverables',
};

export type Zone = 'main' | 'side';

/**
 * On a wide screen the page is a main column for the work lists and a side
 * rail for what you glance at; each stacks on its own, so a short widget
 * never leaves a gap beside a long one. On a narrow screen there is one
 * column, in the person's order. These are where each widget starts.
 */
const DEFAULT_SIDE: WidgetId[] = ['attention', 'today', 'tasks', 'twoweeks', 'firm', 'deadlines', 'time'];

/** Always shown, always first: its job is to keep overdue work from being buried. */
export const PINNED: WidgetId = 'attention';

const LAWYER_ORDER: WidgetId[] = [
  'attention', 'today', 'mydeliverables', 'tasks', 'twoweeks', 'deadlines', 'calendar', 'time', 'inbox', 'deliverables',
];

const PARTNER_ORDER: WidgetId[] = [
  'attention', 'today', 'mydeliverables', 'tasks', 'firm', 'twoweeks', 'deadlines', 'calendar', 'time', 'inbox', 'deliverables',
];

/** What a board shows until the person customizes it. `firm` only reaches the roles that may have it. */
const DEFAULT_SHOWN: WidgetId[] = ['attention', 'today', 'mydeliverables', 'tasks', 'firm'];

/** The widgets a role may have, in its default order. */
export function defaultOrder(role: string): WidgetId[] {
  return role === 'partner' || role === 'super_user' ? PARTNER_ORDER : LAWYER_ORDER;
}

/**
 * Ids are plain strings here, not the enum: a widget that is later retired
 * must not make every layout that mentions it unreadable. `resolveLayout`
 * drops the ids it doesn't know.
 */
export const savedLayoutSchema = z.object({
  order: z.array(z.string().max(40)).max(40).optional(),
  hidden: z.array(z.string().max(40)).max(40).optional(),
  /** The widgets in the side rail; the rest are in the main column. */
  side: z.array(z.string().max(40)).max(40).optional(),
  calendar: z.enum(['mine', 'firm']).optional(),
});

export type SavedLayout = z.infer<typeof savedLayoutSchema>;

export interface Layout {
  /** Every widget the role may have, pinned first, in the person's order. */
  order: WidgetId[];
  hidden: WidgetId[];
  side: WidgetId[];
  calendar: CalendarMode;
}

/**
 * The person's layout, made safe for their role: unknown or forbidden ids are
 * dropped, widgets they have never placed (new ones, or a role change) join at
 * the end, and the pinned widget stays first and visible. Anything unreadable
 * falls back to the role default. A saved calendar choice alone is not a
 * customized board: `storedLayout` writes it without the widgets.
 */
export function resolveLayout(role: string, saved: unknown): Layout {
  const allowed = defaultOrder(role);
  const parsed = savedLayoutSchema.safeParse(saved ?? {});
  const s: SavedLayout = parsed.success ? parsed.data : {};

  const known = (ids: string[] | undefined) => (ids ?? []).filter((id): id is WidgetId => (allowed as string[]).includes(id));
  const placed = known(s.order).filter((id, i, all) => id !== PINNED && all.indexOf(id) === i);
  const rest = allowed.filter((id) => id !== PINNED && !placed.includes(id));
  const customized = known(s.order).length > 0 || s.hidden !== undefined;
  const hidden = allowed.filter((id) =>
    id !== PINNED && (customized ? known(s.hidden).includes(id) : !DEFAULT_SHOWN.includes(id)),
  );
  // A widget the person never placed starts where its default puts it.
  const side = allowed.filter((id) => (s.side && placed.includes(id) ? known(s.side).includes(id) : DEFAULT_SIDE.includes(id)));

  return {
    order: [PINNED, ...placed, ...rest],
    hidden,
    side,
    calendar: s.calendar ?? 'mine',
  };
}

/**
 * What to store for a layout: null when it is the role's default, the
 * calendar choice alone when only that differs, else the whole layout. A
 * stored order is frozen (later default changes don't reach it), so flipping
 * the calendar between Mine and Firm must not store one.
 */
export function storedLayout(role: string, layout: Layout): SavedLayout | null {
  const def = resolveLayout(role, null);
  const sameSet = (a: WidgetId[], b: WidgetId[]) => a.length === b.length && a.every((id) => b.includes(id));
  const widgetsDefault =
    layout.order.join() === def.order.join() && sameSet(layout.hidden, def.hidden) && sameSet(layout.side, def.side);
  if (!widgetsDefault) {
    return { order: layout.order, hidden: layout.hidden, side: layout.side, calendar: layout.calendar };
  }
  return layout.calendar === def.calendar ? null : { calendar: layout.calendar };
}

export function zoneOf(layout: Pick<Layout, 'side'>, id: WidgetId): Zone {
  return layout.side.includes(id) ? 'side' : 'main';
}

export function visibleWidgets(layout: Layout): WidgetId[] {
  return layout.order.filter((id) => !layout.hidden.includes(id));
}

/** Move a widget one place up or down; the pinned widget and the edges stay put. */
export function moveWidget(order: WidgetId[], id: WidgetId, by: -1 | 1): WidgetId[] {
  const i = order.indexOf(id);
  const j = i + by;
  if (i < 0 || id === PINNED || j < 0 || j >= order.length || order[j] === PINNED) return order;
  const next = [...order];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

/** Put `id` where `target` is, shifting the rest — what a drag-and-drop ends in. */
export function placeWidget(order: WidgetId[], id: WidgetId, target: WidgetId): WidgetId[] {
  if (id === target || id === PINNED || target === PINNED) return order;
  const without = order.filter((w) => w !== id);
  const at = without.indexOf(target);
  if (at < 0) return order;
  const from = order.indexOf(id);
  const to = order.indexOf(target);
  without.splice(from < to ? at + 1 : at, 0, id);
  return without;
}
