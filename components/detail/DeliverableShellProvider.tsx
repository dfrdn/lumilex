'use client';

import {
  createContext, useContext, useState, useCallback, useOptimistic, startTransition,
} from 'react';

// Mutable fields shared by all sibling components on the deliverable detail
// page. Sibling components read these via useDeliverable() so an edit in one
// (e.g. EditableStatusPill changing status) reflects everywhere immediately —
// no router.refresh() round-trip.
export type MutableDeliverable = {
  id: string;
  name: string;
  matter: string;
  matterId: string | null;
  client: string;
  type: string;
  subtype: string;
  priority: string;
  status: string;
  drafter: string[];
  reviewerIds: string[];
  currentlyWith: string[];
  externalDueDate: string | null;
  /** The day it was filed or sent out (YYYY-MM-DD). */
  dateDone: string | null;
  reviewDates: (string | null)[];
};

// API field name → client-state key. The /api/deliverable-update endpoint
// expects snake_case field names; the client state uses camelCase.
const FIELD_TO_STATE: Record<string, keyof MutableDeliverable> = {
  status: 'status',
  currently_with_ids: 'currentlyWith',
  drafter_ids: 'drafter',
  reviewer_ids: 'reviewerIds',
  review_dates: 'reviewDates',
  external_due_date: 'externalDueDate',
  date_done: 'dateDone',
  subtype: 'subtype',
};

type ApplyActionPatch = Partial<Pick<MutableDeliverable, 'status' | 'currentlyWith' | 'dateDone'>>;

type Ctx = {
  item: MutableDeliverable;
  // Inline-edit path. `field` is the API field name (snake_case).
  updateField: (field: string, value: unknown) => Promise<boolean>;
  // Workflow-action path. The action endpoint changes status (+ optionally
  // currentlyWith) server-side; the caller already knows the target values.
  applyAction: (patch: ApplyActionPatch) => void;
  saving: string | null;
  savedField: string | null;
  errorField: string | null;
};

const DeliverableCtx = createContext<Ctx | null>(null);

export function useDeliverable(): Ctx {
  const ctx = useContext(DeliverableCtx);
  if (!ctx) throw new Error('useDeliverable must be used inside <DeliverableShellProvider>');
  return ctx;
}

export default function DeliverableShellProvider({
  initial,
  children,
}: {
  initial: MutableDeliverable;
  children: React.ReactNode;
}) {
  const [confirmed, setConfirmed] = useState<MutableDeliverable>(initial);
  const [item, applyOptimistic] = useOptimistic<MutableDeliverable, Partial<MutableDeliverable>>(
    confirmed,
    (state, patch) => ({ ...state, ...patch }),
  );

  const [saving, setSaving] = useState<string | null>(null);
  const [savedField, setSavedField] = useState<string | null>(null);
  const [errorField, setErrorField] = useState<string | null>(null);

  const updateField = useCallback(async (field: string, value: unknown): Promise<boolean> => {
    const stateKey = FIELD_TO_STATE[field];
    if (!stateKey) {
      console.warn(`[DeliverableShellProvider] Unknown field "${field}"`);
      return false;
    }
    const patch = { [stateKey]: value } as Partial<MutableDeliverable>;
    setSaving(field);
    let ok = false;
    await new Promise<void>((resolve) => {
      startTransition(async () => {
        applyOptimistic(patch);
        try {
          const res = await fetch('/api/deliverable-update', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ deliverableId: confirmed.id, field, value }),
          });
          if (!res.ok) throw new Error('Failed');
          // A move to Filed or Sent out stamps the day server-side; take it.
          const body = (await res.json().catch(() => ({}))) as { dateDone?: string };
          const settled: Partial<MutableDeliverable> = body.dateDone ? { dateDone: body.dateDone } : {};
          setConfirmed((prev) => ({ ...prev, ...patch, ...settled }));
          setSavedField(field);
          setTimeout(() => setSavedField(null), 1500);
          ok = true;
        } catch {
          setErrorField(field);
          setTimeout(() => setErrorField(null), 1500);
        } finally {
          setSaving(null);
          resolve();
        }
      });
    });
    return ok;
  }, [confirmed.id, applyOptimistic]);

  const applyAction = useCallback((patch: ApplyActionPatch) => {
    setConfirmed((prev) => ({ ...prev, ...patch }));
  }, []);

  return (
    <DeliverableCtx.Provider value={{ item, updateField, applyAction, saving, savedField, errorField }}>
      {children}
    </DeliverableCtx.Provider>
  );
}
