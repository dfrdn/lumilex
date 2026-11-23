'use client';

import { useState, useRef, useCallback } from 'react';
import Link from 'next/link';
import { AlertTriangle, Calendar, Scale, Users } from 'lucide-react';
import { Fact, StatusPill, SubjectCard } from '@/components/ui/primitives';
import { CARD } from '@/components/ui/tone';
import EditableField from './EditableField';
import PersonBadge from './PersonBadge';
import CellDropdown, { type DropdownOption } from '@/components/admin/CellDropdown';
import CellDatePicker from '@/components/admin/CellDatePicker';
import type { PersonInfo, TeamMemberOption } from '@/lib/queries/people';
import { FORMER_MEMBER } from '@/lib/former-member';
import { hearingDay, hearingOutcome } from './hearing-day';

// ── Types ────────────────────────────────────────────────────

interface HearingItem {
  id: string;
  name: string;
  matter: string;
  matterId: string | null;
  type: string;
  status: string;
  date: string | null;
  isAttended: boolean;
  isFiled: boolean;
  attendeeIds: string[];
}

interface Props {
  item: HearingItem;
  people: Map<string, PersonInfo>;
  teamMembers: TeamMemberOption[];
  canEdit: boolean;
  /** Rendered at the bottom of the left column so the section stacks
   *  directly under Case & Details instead of waiting on the sidebar. */
  footer?: React.ReactNode;
}

const MUTED = 'text-stone-500 dark:text-stone-400';

// ── Component ────────────────────────────────────────────────

export default function HearingDetailBody({
  item: initialItem,
  people,
  teamMembers,
  canEdit,
  footer,
}: Props) {
  // Keep a local copy so optimistic UI reflects saves immediately.
  const [item, setItem] = useState(initialItem);

  // Inline-edit state, mirroring DeliverableDetailClient
  const [editingField, setEditingField] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [savedField, setSavedField] = useState<string | null>(null);
  const [errorField, setErrorField] = useState<string | null>(null);

  const editAnchorRef = useRef<HTMLElement | null>(null);

  const teamById = new Map(teamMembers.map((m) => [m.personId, m]));
  const peopleOptions: DropdownOption[] = teamMembers.map((m) => ({
    id: m.personId,
    label: m.name,
    initials: m.initials,
    sublabel: m.position,
  }));

  const saveField = useCallback(
    async (field: 'date' | 'attendeeIds', value: unknown) => {
      setSaving(field);
      setEditingField(null);
      const previous = field === 'date' ? item.date : item.attendeeIds;
      const apply = (v: unknown) =>
        setItem((prev) =>
          field === 'date' ? { ...prev, date: v as string | null } : { ...prev, attendeeIds: v as string[] },
        );
      apply(value);
      try {
        const res = await fetch('/api/hearing', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: item.id, [field]: value }),
        });
        if (!res.ok) throw new Error('Failed');

        setSavedField(field);
        setTimeout(() => setSavedField(null), 1500);
      } catch {
        apply(previous);
        setErrorField(field);
        setTimeout(() => setErrorField(null), 1500);
      } finally {
        setSaving(null);
      }
    },
    [item.id, item.date, item.attendeeIds],
  );

  const handleEdit = useCallback((field: string, el: HTMLDivElement) => {
    editAnchorRef.current = el;
    setEditingField(field);
  }, []);

  const { dateStr, status: dateStatus, daysLabel, timeStr } = hearingDay(item.date);
  const outcome = hearingOutcome(item.status, item.isAttended, dateStatus);
  const late = dateStatus === 'past' && outcome.tone === 'rose';

  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        <div className="lg:col-span-2 space-y-4 min-w-0">
          <SubjectCard title="Attendees" icon={<Users className="w-4 h-4" />} action={canEdit && <span className={`text-[11px] ${MUTED}`}>Click to change</span>}>
            <EditableField field="attendeeIds" editable={canEdit} saving={saving} savedField={savedField} errorField={errorField} onEdit={handleEdit} className="p-2 -m-2">
              {item.attendeeIds.length === 0 ? (
                <p className={`text-[13px] ${MUTED}`}>No one assigned yet.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {item.attendeeIds.map((pid) => {
                    // Someone just added isn't in the page's resolved people yet.
                    const p = people.get(pid) ?? teamById.get(pid);
                    return <PersonBadge key={pid} initials={p?.initials ?? FORMER_MEMBER} position={p?.position} avatarUrl={p?.avatarUrl} />;
                  })}
                </div>
              )}
            </EditableField>
          </SubjectCard>

        </div>

        <div className="space-y-4 min-w-0">
          <EditableField field="date" editable={canEdit} saving={saving} savedField={savedField} errorField={errorField} onEdit={handleEdit} className="rounded-2xl">
            <section
              className={`${CARD} px-5 py-4 ${
                dateStatus === 'today' ? 'border-amber-200 dark:border-amber-500/25' : late ? 'border-rose-200 dark:border-rose-500/25' : ''
              }`}
            >
              <h3 className="inline-flex items-center gap-2 text-[13px] font-semibold text-stone-800 dark:text-stone-100">
                <Calendar className="w-4 h-4 text-stone-400 dark:text-stone-500" /> When
              </h3>
              {dateStr ? (
                <div className="mt-2">
                  <p className="font-serif text-xl text-stone-900 dark:text-stone-50">
                    {new Date(`${dateStr}T00:00:00Z`).toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })}
                  </p>
                  <p className={`mt-0.5 text-[13px] ${MUTED}`}>
                    {new Date(`${dateStr}T00:00:00Z`).getUTCFullYear()}
                    {timeStr && ` · ${timeStr}`}
                  </p>
                  <p
                    className={`mt-2 inline-flex items-center gap-1.5 text-[12px] font-medium ${
                      dateStatus === 'today' ? 'text-amber-700 dark:text-amber-300' : late ? 'text-rose-700 dark:text-rose-300' : MUTED
                    }`}
                  >
                    {late && <AlertTriangle className="w-3.5 h-3.5" />}
                    {daysLabel}
                    {late && ' — record what happened'}
                  </p>
                </div>
              ) : (
                <p className={`mt-2 text-[13px] ${MUTED}`}>No date set.</p>
              )}
            </section>
          </EditableField>

          <SubjectCard title="At a glance" icon={<Scale className="w-4 h-4" />}>
            <dl>
              <Fact
                label="Matter"
                value={
                  item.matterId ? (
                    <Link href={`/dashboard/matters/${item.matterId}`} className="text-navy-700 dark:text-navy-300 hover:underline">
                      {item.matter}
                    </Link>
                  ) : (
                    item.matter || null
                  )
                }
              />
              <Fact label="Type" value={item.type || null} />
              <Fact label="Outcome" value={<StatusPill label={outcome.label} tone={outcome.tone} size="sm" />} />
              <Fact label="Filed" value={item.isFiled ? 'Yes' : null} />
              <Fact label="Attendees" value={item.attendeeIds.length || null} />
            </dl>
          </SubjectCard>
        </div>
      </div>

      {/* Comments close the page, under both columns at any width. */}
      {footer && <div className="mt-4">{footer}</div>}

      {/* ── Portaled editors ─────────────────────────────────────── */}

      {editingField === 'attendeeIds' && editAnchorRef.current && (
        <CellDropdown
          mode="multi"
          options={peopleOptions}
          value={item.attendeeIds}
          onSelect={(ids) => saveField('attendeeIds', ids)}
          onClose={() => setEditingField(null)}
          anchorRef={editAnchorRef}
        />
      )}

      {editingField === 'date' && editAnchorRef.current && (
        <CellDatePicker
          value={item.date}
          showTime
          onSelect={(v) => saveField('date', v)}
          onClose={() => setEditingField(null)}
          anchorRef={editAnchorRef}
        />
      )}
    </>
  );
}
