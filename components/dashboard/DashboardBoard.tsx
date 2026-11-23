'use client';

import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowDown, ArrowUp, Check, GripVertical, Lock, RotateCcw, SlidersHorizontal } from 'lucide-react';
import {
  PINNED,
  WIDGET_TITLES,
  moveWidget,
  placeWidget,
  resolveLayout,
  storedLayout,
  visibleWidgets,
  zoneOf,
  type CalendarMode,
  type Layout,
  type WidgetId,
} from '@/lib/dashboard-widgets';

interface LayoutContext {
  calendar: CalendarMode;
  saveCalendarMode: (mode: CalendarMode) => void;
}

const DashboardLayoutContext = createContext<LayoutContext>({ calendar: 'mine', saveCalendarMode: () => {} });

export function useDashboardLayout(): LayoutContext {
  return useContext(DashboardLayoutContext);
}

interface Props {
  role: string;
  initialLayout: Layout;
  /** The greeting and quick actions; the Customize button sits beside them. */
  header: React.ReactNode;
  /** A line above the widgets for the single most pressing thing (Up next). */
  banner?: React.ReactNode;
  /** Controls beside Customize, such as the Requests menu. */
  toolbar?: React.ReactNode;
  /** Rendered on the server for the widgets that were visible when the page loaded. */
  widgets: Partial<Record<WidgetId, React.ReactNode>>;
}

async function putLayout(role: string, layout: Layout): Promise<boolean> {
  try {
    const res = await fetch('/api/dashboard/layout', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ layout: storedLayout(role, layout) }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * The dashboard's widgets in the person's order, and Customize mode: show or
 * hide each widget and move it up or down (or drag it). The pinned widget
 * stays first. Changes apply at once and are saved when the person is done.
 */
export default function DashboardBoard({ role, initialLayout, header, banner, toolbar, widgets }: Props) {
  const router = useRouter();
  const [layout, setLayout] = useState(initialLayout);
  const [editing, setEditing] = useState(false);
  const [dragging, setDragging] = useState<WidgetId | null>(null);
  // What the server holds, to roll back to when a save is refused.
  const saved = useRef(initialLayout);

  const saveCalendarMode = useCallback(
    async (calendar: CalendarMode) => {
      setLayout((prev) => ({ ...prev, calendar }));
      // Saved against the stored layout, not the one being customized: unsaved
      // widget edits wait for Done, and a refusal undoes only the calendar.
      const next = { ...saved.current, calendar };
      if (await putLayout(role, next)) {
        saved.current = next;
        return;
      }
      toast.error("Couldn't save your calendar choice. Try again.");
      setLayout((prev) => ({ ...prev, calendar: saved.current.calendar }));
    },
    [role],
  );

  const finish = async () => {
    setEditing(false);
    setDragging(null);
    if (JSON.stringify(layout) === JSON.stringify(saved.current)) return;
    const ok = await putLayout(role, layout);
    if (ok) {
      saved.current = layout;
    } else {
      toast.error("Couldn't save your dashboard layout. Try again.");
      setLayout(saved.current);
    }
    // A widget switched on here was hidden when the page loaded, so the server
    // never read its data. Re-running the server component is the only way to
    // get it; nothing else on the page is lost by it.
    if (ok && visibleWidgets(layout).some((id) => !(id in widgets))) router.refresh();
  };

  const reset = () => setLayout((prev) => ({ ...resolveLayout(role, null), calendar: prev.calendar }));

  const setZone = (id: WidgetId, zone: 'main' | 'side') =>
    setLayout((prev) => ({
      ...prev,
      side: zone === 'side' ? [...prev.side.filter((w) => w !== id), id] : prev.side.filter((w) => w !== id),
    }));

  const toggle = (id: WidgetId) =>
    setLayout((prev) => ({
      ...prev,
      hidden: prev.hidden.includes(id) ? prev.hidden.filter((h) => h !== id) : [...prev.hidden, id],
    }));

  const shown = visibleWidgets(layout);

  return (
    <DashboardLayoutContext.Provider value={{ calendar: layout.calendar, saveCalendarMode }}>
      <div className="mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 animate-fade-up">
        <div className="min-w-0">{header}</div>
        <div className="flex items-center gap-2 max-sm:flex-wrap self-start sm:self-auto shrink-0">
        {toolbar}
        <button
          type="button"
          onClick={editing ? finish : () => setEditing(true)}
          aria-expanded={editing}
          aria-controls="dashboard-customize"
          className="press self-start shrink-0 inline-flex items-center gap-1.5 px-3.5 py-1.5 max-sm:px-2.5 max-sm:min-h-9 whitespace-nowrap text-xs font-semibold rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-stone-300 dark:hover:border-white/20 cursor-pointer"
        >
          {editing ? <Check className="w-3.5 h-3.5" /> : <SlidersHorizontal className="w-3.5 h-3.5" />}
          {editing ? 'Done' : 'Customize'}
        </button>
        </div>
      </div>

      {editing && (
        <section
          id="dashboard-customize"
          aria-label="Customize your dashboard"
          className="mb-4 rounded-2xl border border-dashed border-stone-300 dark:border-white/15 bg-stone-50/70 dark:bg-white/[0.03] px-4 py-3 animate-fade-up"
        >
          <div className="flex items-center justify-between gap-3 max-sm:flex-wrap mb-2">
            <div>
              <h2 className="text-[14px] font-semibold text-stone-800 dark:text-stone-100">Your widgets</h2>
              <p className="text-xs text-[var(--text-secondary)]">
                Show or hide each one, drag or use the arrows to reorder, and choose Main or Side for wide screens. On a phone they stack in this order.
              </p>
            </div>
            <button
              type="button"
              onClick={reset}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 max-sm:min-h-9 text-xs font-medium rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-stone-100 dark:hover:bg-white/[0.06] cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset to default
            </button>
          </div>
          <ul className="divide-y divide-stone-200/70 dark:divide-white/[0.06]">
            {layout.order.map((id, i) => {
              const pinned = id === PINNED;
              const hidden = layout.hidden.includes(id);
              return (
                <li
                  key={id}
                  draggable={!pinned}
                  onDragStart={(e) => {
                    setDragging(id);
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  onDragEnd={() => setDragging(null)}
                  onDragOver={(e) => {
                    if (dragging && !pinned) e.preventDefault();
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragging) setLayout((prev) => ({ ...prev, order: placeWidget(prev.order, dragging, id) }));
                    setDragging(null);
                  }}
                  className={`flex items-center gap-3 max-sm:flex-wrap max-sm:gap-y-1 py-2 ${dragging === id ? 'opacity-50' : ''} ${pinned ? '' : 'cursor-grab active:cursor-grabbing'}`}
                >
                  <span className="text-stone-400 dark:text-stone-500" aria-hidden="true">
                    {pinned ? <Lock className="w-4 h-4" /> : <GripVertical className="w-4 h-4" />}
                  </span>
                  <span className={`flex-1 text-sm max-sm:basis-[calc(100%-1.75rem)] ${hidden ? 'text-[var(--text-muted)] line-through decoration-stone-300' : 'text-[var(--text-primary)]'}`}>
                    {WIDGET_TITLES[id]}
                  </span>
                  <div role="radiogroup" aria-label={`Where ${WIDGET_TITLES[id]} goes on a wide screen`} className="max-sm:ml-7 max-sm:mr-auto inline-flex rounded-md border border-stone-200 dark:border-white/10 p-0.5 text-[11px]">
                    {(['main', 'side'] as const).map((zone) => (
                      <button
                        key={zone}
                        type="button"
                        role="radio"
                        aria-checked={zoneOf(layout, id) === zone}
                        onClick={() => setZone(id, zone)}
                        className={`px-2 py-0.5 max-sm:min-h-9 max-sm:px-3 rounded font-medium cursor-pointer ${
                          zoneOf(layout, id) === zone
                            ? 'bg-stone-200/70 text-stone-900 dark:bg-white/10 dark:text-stone-50'
                            : 'text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200'
                        }`}
                      >
                        {zone === 'main' ? 'Main' : 'Side'}
                      </button>
                    ))}
                  </div>
                  {pinned ? (
                    <span className="text-xs text-[var(--text-muted)]">Always first</span>
                  ) : (
                    <>
                      <button
                        type="button"
                        aria-label={`Move ${WIDGET_TITLES[id]} up`}
                        disabled={i <= 1}
                        onClick={() => setLayout((prev) => ({ ...prev, order: moveWidget(prev.order, id, -1) }))}
                        className="p-1 max-sm:p-2.5 rounded-md text-stone-500 hover:bg-stone-200/60 dark:hover:bg-white/[0.08] disabled:opacity-30 cursor-pointer disabled:cursor-default"
                      >
                        <ArrowUp className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Move ${WIDGET_TITLES[id]} down`}
                        disabled={i === layout.order.length - 1}
                        onClick={() => setLayout((prev) => ({ ...prev, order: moveWidget(prev.order, id, 1) }))}
                        className="p-1 max-sm:p-2.5 rounded-md text-stone-500 hover:bg-stone-200/60 dark:hover:bg-white/[0.08] disabled:opacity-30 cursor-pointer disabled:cursor-default"
                      >
                        <ArrowDown className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={!hidden}
                        aria-label={`Show ${WIDGET_TITLES[id]}`}
                        onClick={() => toggle(id)}
                        className={`relative ml-1 h-5 w-9 shrink-0 rounded-full transition-colors cursor-pointer max-sm:before:absolute max-sm:before:-inset-2 ${hidden ? 'bg-stone-300 dark:bg-white/15' : 'bg-navy-500 dark:bg-navy-400'}`}
                      >
                        <span className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${hidden ? '' : 'translate-x-4'}`} />
                      </button>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {banner}

      {/* A wide content area (a container query, so the sidebar counts) splits into a main
          column and a side rail that each stack on their own, so a short widget never leaves
          a gap beside a long one. Narrower, the column wrappers dissolve (display: contents)
          and every widget falls into one column in the person's order, via CSS order. */}
      {/* The bottom padding clears the two floating buttons, so the last rows can scroll out from under them. */}
      <div className="@container max-sm:pb-32">
        <div className="flex flex-col gap-3 @4xl:grid @4xl:grid-cols-[minmax(0,1.85fr)_minmax(0,1fr)] @4xl:items-start">
          {(['main', 'side'] as const).map((zone) => (
            <div key={zone} className="contents @4xl:flex @4xl:flex-col @4xl:gap-3 @4xl:min-w-0">
              {shown
                .filter((id) => zoneOf(layout, id) === zone)
                .map((id) => (
                  <div key={id} data-widget={id} data-zone={zone} className="min-w-0" style={{ order: shown.indexOf(id) }}>
                    {id in widgets ? (
                      widgets[id]
                    ) : (
                      <div className="rounded-2xl border border-dashed border-stone-300 dark:border-white/15 px-5 py-4 text-sm text-[var(--text-secondary)]">
                        {WIDGET_TITLES[id]} loads when you press Done.
                      </div>
                    )}
                  </div>
                ))}
            </div>
          ))}
        </div>
      </div>
    </DashboardLayoutContext.Provider>
  );
}
