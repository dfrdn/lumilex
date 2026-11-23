'use client';

import { useState, useRef, useCallback } from 'react';
import {
  User, Users, Calendar, Pencil, Check, Loader2, X,
  Briefcase, ListChecks, Plus, Minus,
} from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';
import PersonBadge from './PersonBadge';
import CellDropdown, { type DropdownOption } from '@/components/admin/CellDropdown';
import CellDatePicker from '@/components/admin/CellDatePicker';
import type { PersonInfo } from '@/lib/queries/people';
import { DueChip, StatusPill, SubjectCard } from '@/components/ui/primitives';
import { useDeliverable } from './DeliverableShellProvider';
import { DELIVERABLE_STATUS, isClosed, pickableStatusesForType } from '@/lib/deliverable-status';
import { daysBetween, manilaToday } from '@/lib/dates';
import { FORMER_MEMBER } from '@/lib/former-member';

// ── Editable field wrapper (defined outside component for stable identity) ──

function EditableField({
  field,
  editable,
  saving,
  savedField,
  errorField,
  onEdit,
  fieldRef,
  children,
  className,
}: {
  field: string;
  editable: boolean;
  saving: string | null;
  savedField: string | null;
  errorField: string | null;
  onEdit: (field: string, el: HTMLDivElement) => void;
  fieldRef: (el: HTMLDivElement | null) => void;
  children: React.ReactNode;
  className?: string;
}) {
  const isSaving = saving === field;
  const isSaved = savedField === field;
  const isError = errorField === field;

  return (
    <div
      ref={fieldRef}
      onClick={(e) => {
        if (!editable || isSaving) return;
        onEdit(field, e.currentTarget);
      }}
      className={`relative group/field rounded-lg transition-all duration-200 ${
        editable ? 'cursor-pointer hover:bg-stone-50 dark:hover:bg-white/[0.04] hover:ring-1 hover:ring-stone-200 dark:hover:ring-white/10' : ''
      } ${isSaved ? 'animate-field-save' : ''} ${isError ? 'animate-field-error' : ''} ${className ?? ''}`}
    >
      {children}
      {editable && !isSaving && (
        <span className="absolute top-1.5 right-1.5 opacity-0 group-hover/field:opacity-100 transition-opacity">
          <Pencil className="w-3 h-3 text-stone-400 dark:text-stone-500" />
        </span>
      )}
      {isSaving && (
        <span className="absolute top-1.5 right-1.5">
          <Loader2 className="w-3 h-3 text-navy-600 dark:text-navy-300 animate-spin" />
        </span>
      )}
      {isSaved && (
        <span className="absolute top-1.5 right-1.5">
          <Check className="w-3 h-3 text-emerald-500 dark:text-emerald-400" />
        </span>
      )}
      {isError && (
        <span className="absolute top-1.5 right-1.5">
          <X className="w-3 h-3 text-rose-500 dark:text-rose-400" />
        </span>
      )}
    </div>
  );
}

// ── Types ────────────────────────────────────────────────────

interface Props {
  people: Record<string, PersonInfo>;
  teamMembers: { personId: string; name: string; initials: string; position: string; avatarUrl?: string | null }[];
  userRole: string;
}

// ── Status options ────────────────────────────────────────────

function statusOptions(type: string | null | undefined): DropdownOption[] {
  return pickableStatusesForType(type).map((s) => ({ id: s, label: s }));
}

// ── Helpers ───────────────────────────────────────────────────

function formatDate(d: string | null): string {
  if (!d) return '—';
  return new Date(d + 'T00:00:00').toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
}

function getReviewerLabel(index: number, total: number): string {
  if (total === 1) return 'Reviewer';
  if (index === 0) return 'Initial Reviewer';
  if (index === total - 1) return 'Final Reviewer';
  return ['Second', 'Third', 'Fourth'][index - 1] + ' Reviewer';
}

type StepState = 'done' | 'current' | 'upcoming';

/** Done emerald, the reviewer it is with now navy, those still to come stone. */
const STEP_TONE: Record<StepState, { card: string; num: string; text: string }> = {
  done: {
    card: 'border-emerald-200 bg-emerald-50/50 dark:border-emerald-500/20 dark:bg-emerald-500/[0.06]',
    num: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
    text: 'text-emerald-700 dark:text-emerald-300',
  },
  current: {
    card: 'border-navy-200 bg-navy-50/60 dark:border-navy-400/30 dark:bg-navy-500/10',
    num: 'bg-navy-800 text-white dark:bg-navy-500',
    text: 'text-navy-700 dark:text-navy-200',
  },
  upcoming: {
    card: 'border-stone-200 bg-white dark:border-white/10 dark:bg-transparent',
    num: 'bg-stone-100 text-stone-500 dark:bg-white/10 dark:text-stone-400',
    text: 'text-stone-600 dark:text-stone-300',
  },
};

/** Statuses at which every review is behind it. */
const PAST_REVIEW: readonly string[] = [
  DELIVERABLE_STATUS.FINALIZING, DELIVERABLE_STATUS.PRE_FINALIZED, DELIVERABLE_STATUS.OUTBOX, DELIVERABLE_STATUS.AWAITING_CLIENT,
  DELIVERABLE_STATUS.FILED_OR_SENT_OUT, DELIVERABLE_STATUS.SUBMITTED, DELIVERABLE_STATUS.ACKNOWLEDGED,
];

const LABEL = 'text-[12px] text-stone-500 dark:text-stone-400 mb-1.5';
const MUTED = 'text-stone-400 dark:text-stone-500';
const ICON_BTN =
  'p-1 rounded-md text-stone-400 hover:text-stone-700 hover:bg-stone-100 dark:text-stone-500 dark:hover:text-stone-200 dark:hover:bg-white/[0.06] transition-colors';

// ── Component ─────────────────────────────────────────────────

export default function DeliverableDetailClient({ people, teamMembers, userRole }: Props) {
  const { item, updateField, saving, savedField, errorField } = useDeliverable();
  const isPartner = userRole === 'partner' || userRole === 'super_user';
  // Once the work is closed the deadline is history: it is shown plainly, never as overdue.
  const closed = isClosed(item.status);
  // Once it has gone out, say when it went and whether that met the deadline.
  const filed = item.status === DELIVERABLE_STATUS.FILED_OR_SENT_OUT;
  const lateBy = filed && item.dateDone && item.externalDueDate ? daysBetween(item.externalDueDate, item.dateDone) : null;

  // While it is under review, the reviewer it is with is the current step and
  // those before are done; once it is past review, every step is.
  const currentStep =
    item.status === DELIVERABLE_STATUS.UNDER_REVIEW ? item.reviewerIds.findIndex((pid) => item.currentlyWith.includes(pid)) : -1;
  const stepState = (idx: number): StepState => {
    if (PAST_REVIEW.includes(item.status)) return 'done';
    if (currentStep < 0) return 'upcoming';
    return idx < currentStep ? 'done' : idx === currentStep ? 'current' : 'upcoming';
  };

  // ── Edit state ──────────────────────────────────────────────
  const [editingField, setEditingField] = useState<string | null>(null);

  // Ref for dropdown anchoring — single stable ref, set when editing starts
  const editAnchorRef = useRef<HTMLElement | null>(null);
  const fieldRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const canEdit = useCallback((field: string) => {
    if (isPartner) return true;
    return field === 'status' || field === 'currently_with_ids' || field === 'date_done';
  }, [isPartner]);

  // Build people dropdown options
  const peopleOptions: DropdownOption[] = teamMembers.map((m) => ({
    id: m.personId,
    label: m.name,
    initials: m.initials,
    sublabel: m.position,
    avatarUrl: m.avatarUrl ?? null,
  }));

  const handleEdit = useCallback((field: string, el: HTMLDivElement) => {
    editAnchorRef.current = el;
    setEditingField(field);
  }, []);

  // ── Render helpers ──────────────────────────────────────────

  const renderPeople = (ids: string[]) =>
    ids.length === 0 ? <span className={`text-[13px] ${MUTED}`}>{'—'}</span> : (
      <div className="flex flex-wrap gap-1.5">
        {ids.map((pid) => {
          const p = people[pid];
          return <PersonBadge key={pid} initials={p?.initials ?? FORMER_MEMBER} position={p?.position} avatarUrl={p?.avatarUrl} />;
        })}
      </div>
    );

  return (
    <>
      <SubjectCard title="Case & assignment" icon={<Briefcase className="w-4 h-4" />}>
        <div className="space-y-4">
          <div className="min-w-0">
            <p className={LABEL}>Matter</p>
            {item.matterId ? (
              <Link href={`/dashboard/matters/${item.matterId}`} className="text-[13px] font-medium text-navy-700 dark:text-navy-300 hover:underline">
                {item.matter}
              </Link>
            ) : (
              <p className="text-[13px] text-stone-800 dark:text-stone-100">{item.matter || '—'}</p>
            )}
            {item.client && <p className={`text-[12px] ${MUTED} mt-0.5`}>{item.client}</p>}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 border-t border-stone-100 dark:border-white/[0.06]">
            <EditableField field="drafter_ids" editable={canEdit('drafter_ids')} saving={saving} savedField={savedField} errorField={errorField} onEdit={handleEdit} fieldRef={(el) => { fieldRefs.current['drafter_ids'] = el; }} className="p-2 -m-2">
              <p className={`${LABEL} inline-flex items-center gap-1.5`}>
                <User className="w-3.5 h-3.5" />
                {item.drafter.length > 1 ? 'Drafters' : 'Drafter'}
              </p>
              {renderPeople(item.drafter)}
            </EditableField>

            <EditableField field="currently_with_ids" editable={canEdit('currently_with_ids')} saving={saving} savedField={savedField} errorField={errorField} onEdit={handleEdit} fieldRef={(el) => { fieldRefs.current['currently_with_ids'] = el; }} className="p-2 -m-2">
              <p className={`${LABEL} inline-flex items-center gap-1.5`}>
                <Users className="w-3.5 h-3.5" />
                Currently with
              </p>
              {renderPeople(item.currentlyWith)}
            </EditableField>
          </div>
        </div>
      </SubjectCard>

      <SubjectCard
        title="Review pipeline"
        icon={<ListChecks className="w-4 h-4" />}
        action={
          isPartner && (
            <div className="flex items-center gap-1">
              {item.reviewerIds.length > 1 && (
                <button
                  type="button"
                  onClick={() => {
                    const newIds = item.reviewerIds.slice(0, -1);
                    const newDates = item.reviewDates.slice(0, -1);
                    void updateField('reviewer_ids', newIds);
                    void updateField('review_dates', newDates);
                  }}
                  className={ICON_BTN}
                  title="Remove last reviewer"
                >
                  <Minus className="w-3.5 h-3.5" />
                </button>
              )}
              {item.reviewerIds.length < 5 && (
                <button
                  type="button"
                  onClick={() => {
                    editAnchorRef.current = fieldRefs.current['add_reviewer'] ?? null;
                    setEditingField('add_reviewer');
                  }}
                  ref={(el) => { fieldRefs.current['add_reviewer'] = el as unknown as HTMLDivElement; }}
                  className={ICON_BTN}
                  title="Add reviewer"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )
        }
      >
        {item.reviewerIds.length === 0 ? (
          <p className={`text-[13px] ${MUTED} py-2`}>No reviewers assigned.</p>
        ) : (
          <ol className="space-y-2">
            {item.reviewerIds.map((pid, idx) => {
              const p = people[pid];
              const total = item.reviewerIds.length;
              const label = getReviewerLabel(idx, total);
              const reviewDate = item.reviewDates[idx] ?? null;
              const state = stepState(idx);
              const tone = STEP_TONE[state];
              const isLast = idx === total - 1;

              return (
                <li key={`${pid}-${idx}`} className="flex gap-3">
                  <div className="flex flex-col items-center pt-2.5">
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-semibold shrink-0 ${tone.num}`}>
                      {state === 'done' ? <Check className="w-3.5 h-3.5" /> : idx + 1}
                    </div>
                    {!isLast && <div className={`w-px flex-1 mt-1.5 -mb-2 ${state === 'done' ? 'bg-emerald-200 dark:bg-emerald-500/30' : 'bg-stone-200 dark:bg-white/10'}`} />}
                  </div>

                  <div className={`flex-1 min-w-0 rounded-xl border px-3 py-2 ${tone.card}`}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <EditableField
                          field={`reviewer_${idx}`}
                          editable={canEdit('reviewer_ids')}
                          saving={saving}
                          savedField={savedField}
                          errorField={errorField}
                          onEdit={(_, el) => {
                            editAnchorRef.current = el;
                            setEditingField(`reviewer_${idx}`);
                          }}
                          fieldRef={(el) => { fieldRefs.current[`reviewer_${idx}`] = el; }}
                          className="p-1 -m-1"
                        >
                          <PersonBadge initials={p?.initials ?? FORMER_MEMBER} position={p?.position} avatarUrl={p?.avatarUrl} />
                        </EditableField>
                        <p className={`text-[12px] font-medium ${tone.text}`}>{label}</p>
                        {state === 'current' && <StatusPill label="With them now" tone="navy" size="sm" />}
                      </div>
                      <EditableField
                        field={`review_date_${idx}`}
                        editable={canEdit('review_dates')}
                        saving={saving}
                        savedField={savedField}
                        errorField={errorField}
                        onEdit={(_, el) => {
                          editAnchorRef.current = el;
                          setEditingField(`review_date_${idx}`);
                        }}
                        fieldRef={(el) => { fieldRefs.current[`review_date_${idx}`] = el; }}
                        className="p-1 -m-1 pr-5"
                      >
                        <span className="inline-flex items-center gap-1.5">
                          <Calendar className={`w-3 h-3 ${MUTED}`} />
                          <span className={`text-[12px] ${reviewDate ? 'text-stone-800 dark:text-stone-100' : MUTED}`}>
                            {formatDate(reviewDate)}
                          </span>
                        </span>
                      </EditableField>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        )}

        <div className="mt-4 pt-3 border-t border-stone-100 dark:border-white/[0.06]">
          <EditableField field="external_due_date" editable={canEdit('external_due_date')} saving={saving} savedField={savedField} errorField={errorField} onEdit={handleEdit} fieldRef={(el) => { fieldRefs.current['external_due_date'] = el; }} className="px-2 py-1.5 -mx-2">
            <div className="flex items-center justify-between gap-3 pr-5">
              <span className="inline-flex items-center gap-1.5 text-[12px] text-stone-500 dark:text-stone-400">
                <Calendar className="w-3.5 h-3.5" />
                Deadline
              </span>
              {item.externalDueDate ? (
                closed ? (
                  <span className="text-[13px] text-stone-700 dark:text-stone-200">{formatDate(item.externalDueDate)}</span>
                ) : (
                  <DueChip due={item.externalDueDate} />
                )
              ) : (
                <span className={`text-[13px] ${MUTED}`}>—</span>
              )}
            </div>
          </EditableField>
          {filed && (
            <EditableField field="date_done" editable={canEdit('date_done')} saving={saving} savedField={savedField} errorField={errorField} onEdit={handleEdit} fieldRef={(el) => { fieldRefs.current['date_done'] = el; }} className="px-2 py-1.5 -mx-2">
              <div className="flex items-center justify-between gap-3 pr-5">
                <span className="text-[12px] text-stone-500 dark:text-stone-400">Filed or sent</span>
                {item.dateDone ? (
                  <span className="inline-flex flex-wrap items-center gap-2 text-[13px] text-stone-700 dark:text-stone-200">
                    {formatDate(item.dateDone)}
                    {lateBy !== null && (
                      <StatusPill label={lateBy > 0 ? `${lateBy} ${lateBy === 1 ? 'day' : 'days'} late` : 'On time'} tone={lateBy > 0 ? 'rose' : 'emerald'} size="sm" />
                    )}
                  </span>
                ) : (
                  <span className={`text-[13px] ${MUTED}`}>Not recorded</span>
                )}
              </div>
            </EditableField>
          )}
        </div>
      </SubjectCard>

      {/* ── Dropdowns (portaled) ─────────────────────────────── */}

      {/* Status dropdown */}
      {editingField === 'status' && editAnchorRef.current && (
        <CellDropdown
          mode="single"
          options={statusOptions(item.type)}
          value={item.status}
          onSelect={(id) => {
            if (id && id !== item.status) void updateField('status', id);
            setEditingField(null);
          }}
          onClose={() => setEditingField(null)}
          anchorRef={editAnchorRef}
        />
      )}

      {/* Drafter multi-select */}
      {editingField === 'drafter_ids' && editAnchorRef.current && (
        <CellDropdown
          mode="multi"
          options={peopleOptions}
          value={item.drafter}
          onSelect={(ids) => {
            void updateField('drafter_ids', ids);
          }}
          onClose={() => setEditingField(null)}
          anchorRef={editAnchorRef}
        />
      )}

      {/* Currently With multi-select */}
      {editingField === 'currently_with_ids' && editAnchorRef.current && (
        <CellDropdown
          mode="multi"
          options={peopleOptions}
          value={item.currentlyWith}
          onSelect={(ids) => {
            void updateField('currently_with_ids', ids);
          }}
          onClose={() => setEditingField(null)}
          anchorRef={editAnchorRef}
        />
      )}

      {/* Add reviewer dropdown */}
      {editingField === 'add_reviewer' && editAnchorRef.current && (
        <CellDropdown
          mode="single"
          options={peopleOptions.filter((o) => !item.reviewerIds.includes(o.id))}
          value={null}
          onSelect={(id) => {
            if (id) {
              const newIds = [...item.reviewerIds, id];
              const newDates = [...item.reviewDates, null];
              void updateField('reviewer_ids', newIds);
              void updateField('review_dates', newDates);
            }
            setEditingField(null);
          }}
          onClose={() => setEditingField(null)}
          anchorRef={editAnchorRef}
        />
      )}

      {/* Per-reviewer person swap dropdowns */}
      {editingField?.startsWith('reviewer_') && !editingField.startsWith('review_date_') && editAnchorRef.current && (() => {
        const idx = parseInt(editingField.split('_')[1]);
        if (isNaN(idx)) return null;
        return (
          <CellDropdown
            mode="single"
            options={peopleOptions}
            value={item.reviewerIds[idx]}
            onSelect={(id) => {
              if (id) {
                const newIds = [...item.reviewerIds];
                newIds[idx] = id;
                void updateField('reviewer_ids', newIds);
              }
              setEditingField(null);
            }}
            onClose={() => setEditingField(null)}
            anchorRef={editAnchorRef}
          />
        );
      })()}

      {/* Per-reviewer date pickers */}
      {editingField?.startsWith('review_date_') && editAnchorRef.current && (() => {
        const idx = parseInt(editingField.split('_')[2]);
        if (isNaN(idx)) return null;
        return (
          <CellDatePicker
            value={item.reviewDates[idx] ?? null}
            onSelect={(v) => {
              const newDates = [...item.reviewDates];
              while (newDates.length < item.reviewerIds.length) newDates.push(null);
              newDates[idx] = v;
              void updateField('review_dates', newDates);
            }}
            onClose={() => setEditingField(null)}
            anchorRef={editAnchorRef}
          />
        );
      })()}

      {editingField === 'date_done' && editAnchorRef.current && (
        <CellDatePicker
          value={item.dateDone}
          onSelect={(v) => {
            if (!v) return;
            if (v > manilaToday()) toast.error('Pick today or an earlier date');
            else void updateField('date_done', v);
          }}
          onClose={() => setEditingField(null)}
          anchorRef={editAnchorRef}
        />
      )}

      {editingField === 'external_due_date' && editAnchorRef.current && (
        <CellDatePicker
          value={item.externalDueDate}
          onSelect={(v) => void updateField('external_due_date', v)}
          onClose={() => setEditingField(null)}
          anchorRef={editAnchorRef}
        />
      )}
    </>
  );
}
