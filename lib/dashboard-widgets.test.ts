import { describe, expect, it } from 'vitest';
import { defaultOrder, moveWidget, placeWidget, resolveLayout, storedLayout, visibleWidgets, zoneOf } from './dashboard-widgets';

describe('resolveLayout', () => {
  it('gives the role default to someone who never customized', () => {
    expect(resolveLayout('lawyer', null)).toMatchObject({ order: defaultOrder('lawyer'), calendar: 'mine' });
    expect(resolveLayout('partner', undefined).order.slice(2, 5)).toEqual(['mydeliverables', 'tasks', 'firm']);
  });

  it('keeps the pinned widget first and visible whatever was saved', () => {
    const layout = resolveLayout('lawyer', { order: ['tasks', 'attention', 'today'], hidden: ['attention', 'today'] });
    expect(layout.order[0]).toBe('attention');
    expect(layout.order.slice(1, 3)).toEqual(['tasks', 'today']);
    expect(layout.hidden).toEqual(['today']);
  });

  it('drops widgets the role may not have', () => {
    const layout = resolveLayout('lawyer', { order: ['firm', 'tasks'], hidden: ['firm'] });
    expect(layout.order).not.toContain('firm');
    expect(layout.hidden).toEqual([]);
  });

  it('adds widgets the person never placed at the end', () => {
    const layout = resolveLayout('lawyer', { order: ['tasks', 'today'] });
    expect(layout.order.slice(0, 3)).toEqual(['attention', 'tasks', 'today']);
    expect([...layout.order].sort()).toEqual([...defaultOrder('lawyer')].sort());
  });

  it('drops retired widget ids without losing the rest of the layout', () => {
    const layout = resolveLayout('lawyer', { order: ['backlogs', 'tasks'], hidden: ['backlogs', 'time'] });
    expect(layout.order.slice(0, 2)).toEqual(['attention', 'tasks']);
    expect(layout.hidden).toEqual(['time']);
  });

  it('ignores duplicates and falls back to the default on garbage', () => {
    expect(resolveLayout('lawyer', { order: ['tasks', 'tasks'] }).order.filter((id) => id === 'tasks')).toHaveLength(1);
    expect(resolveLayout('lawyer', { order: ['nope'] })).toEqual(resolveLayout('lawyer', null));
    expect(resolveLayout('lawyer', 'nonsense')).toEqual(resolveLayout('lawyer', null));
  });

  it('keeps the calendar choice', () => {
    expect(resolveLayout('lawyer', { calendar: 'firm' }).calendar).toBe('firm');
  });
});

describe('default board', () => {
  it('shows the short list to someone who never customized', () => {
    expect(visibleWidgets(resolveLayout('lawyer', null))).toEqual(['attention', 'today', 'mydeliverables', 'tasks']);
  });

  it('adds Firm at a glance for the roles that may have it', () => {
    const board = ['attention', 'today', 'mydeliverables', 'tasks', 'firm'];
    expect(visibleWidgets(resolveLayout('partner', null))).toEqual(board);
    expect(visibleWidgets(resolveLayout('super_user', null))).toEqual(board);
  });

  it('keeps the other widgets available from Customize', () => {
    const layout = resolveLayout('lawyer', null);
    expect(layout.hidden).toEqual(['twoweeks', 'deadlines', 'calendar', 'time', 'inbox', 'deliverables']);
    expect(layout.order).toEqual(defaultOrder('lawyer'));
  });

  it('still reaches someone whose only saved choice is the calendar', () => {
    const layout = resolveLayout('partner', { calendar: 'firm' });
    expect(layout.calendar).toBe('firm');
    expect(layout.hidden).toEqual(resolveLayout('partner', null).hidden);
  });

  it('leaves a customized layout as the person set it', () => {
    const everything = resolveLayout('lawyer', { order: defaultOrder('lawyer'), hidden: [] });
    expect(everything.hidden).toEqual([]);
    const some = resolveLayout('partner', { order: defaultOrder('partner'), hidden: ['today', 'tasks'] });
    expect(some.hidden).toEqual(['today', 'tasks']);
    expect(visibleWidgets(some)).toContain('deadlines');
  });

  it('counts an order with no hidden list as customized', () => {
    expect(resolveLayout('lawyer', { order: ['tasks', 'today'] }).hidden).toEqual([]);
  });

  it('round-trips a board with everything switched on, which is not the default', () => {
    const all = { ...resolveLayout('lawyer', null), hidden: [] };
    expect(resolveLayout('lawyer', storedLayout('lawyer', all))).toEqual(all);
  });
});

describe('visibleWidgets', () => {
  it('leaves out hidden widgets, in order', () => {
    const layout = resolveLayout('lawyer', { order: ['tasks', 'today'], hidden: ['today'] });
    expect(visibleWidgets(layout).slice(0, 3)).toEqual(['attention', 'tasks', 'mydeliverables']);
  });
});

describe('zones', () => {
  it('starts glanceable widgets in the side rail and work lists in the main column', () => {
    const layout = resolveLayout('lawyer', null);
    expect(layout.side).toEqual(['attention', 'today', 'tasks', 'twoweeks', 'deadlines', 'time']);
    expect(zoneOf(layout, 'mydeliverables')).toBe('main');
    expect(zoneOf(layout, 'deadlines')).toBe('side');
    expect(resolveLayout('partner', null).side).toContain('firm');
  });

  it('keeps where the person put a widget, and defaults the ones they never placed', () => {
    const layout = resolveLayout('lawyer', { order: ['deadlines', 'calendar'], side: ['calendar'] });
    expect(zoneOf(layout, 'calendar')).toBe('side');
    expect(zoneOf(layout, 'deadlines')).toBe('main');
    expect(zoneOf(layout, 'today')).toBe('side');
  });

  it('ignores a saved side list on a role that lacks the widget', () => {
    expect(resolveLayout('lawyer', { order: ['firm'], side: ['firm'] }).side).not.toContain('firm');
  });
});

describe('moveWidget', () => {
  const order = defaultOrder('lawyer');

  it('swaps with the neighbour', () => {
    expect(moveWidget(order, 'mydeliverables', -1).slice(0, 3)).toEqual(['attention', 'mydeliverables', 'today']);
  });

  it('never moves above or moves the pinned widget, or past the end', () => {
    expect(moveWidget(order, 'today', -1)).toBe(order);
    expect(moveWidget(order, 'attention', 1)).toBe(order);
    expect(moveWidget(order, order[order.length - 1], 1)).toBe(order);
  });
});

describe('placeWidget', () => {
  const order = ['attention', 'today', 'calendar', 'tasks'] as const;

  it('drops a widget into the target slot, in either direction', () => {
    expect(placeWidget([...order], 'tasks', 'today')).toEqual(['attention', 'tasks', 'today', 'calendar']);
    expect(placeWidget([...order], 'today', 'tasks')).toEqual(['attention', 'calendar', 'tasks', 'today']);
  });

  it('never displaces the pinned widget', () => {
    const o = [...order];
    expect(placeWidget(o, 'tasks', 'attention')).toBe(o);
  });
});

describe('storedLayout', () => {
  it('stores nothing for the role default', () => {
    expect(storedLayout('lawyer', resolveLayout('lawyer', null))).toBeNull();
  });

  it('stores only the calendar when that is all that changed, so the default order still reaches the person', () => {
    const firm = { ...resolveLayout('lawyer', null), calendar: 'firm' as const };
    expect(storedLayout('lawyer', firm)).toEqual({ calendar: 'firm' });
    expect(resolveLayout('lawyer', storedLayout('lawyer', firm))).toEqual(firm);
  });

  it('treats a side rail in another order as the same rail', () => {
    const def = resolveLayout('lawyer', null);
    expect(storedLayout('lawyer', { ...def, side: [...def.side].reverse() })).toBeNull();
  });

  it('stores the whole layout once the widgets differ', () => {
    const def = resolveLayout('lawyer', null);
    const hidden = { ...def, hidden: ['time' as const] };
    expect(storedLayout('lawyer', hidden)).toEqual({ order: def.order, hidden: ['time'], side: def.side, calendar: 'mine' });
  });
});
