'use client';

import { useState, useRef, useCallback } from 'react';
import Link from 'next/link';
import { AlertTriangle, Calendar, Handshake, Users } from 'lucide-react';
import { Fact, StatusPill, SubjectCard } from '@/components/ui/primitives';
import { CARD, type PillTone } from '@/components/ui/tone';
import EditableField from './EditableField';
import PersonBadge from './PersonBadge';
import CellDropdown, { type DropdownOption } from '@/components/admin/CellDropdown';
import CellDatePicker from '@/components/admin/CellDatePicker';
import type { PersonInfo, TeamMemberOption } from '@/lib/queries/people';
import { FORMER_MEMBER } from '@/lib/former-member';

// ── Types ────────────────────────────────────────────────────

interface MeetingItem {
  id: string;
  name: string;
  matter: string;
  matterId: string | null;
  type: string;
  date: string | null;
  endDate: string | null;
  isAttended: boolean;
  attendeeIds: string[];
}

interface Props {
  item: MeetingItem;
  outcome: { label: string; tone: PillTone };
  people: Map<string, PersonInfo>;
  teamMembers: TeamMemberOption[];
  canEdit: boolean;
  /** Under the attendees: the meeting notes. */
  notes?: React.ReactNode;
  /** Under both columns: the comments. */
  footer?: React.ReactNode;
}

const MUTED = 'text-stone-500 dark:text-stone-400';

// ── Helpers ──────────────────────────────────────────────────

function formatTime(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleTimeString('en-PH', {
    hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Manila',
  });
}

/** The meeting's Manila day, how it sits against Manila today, and "In 3 days"-style distance. */
function dayInfo(iso: string | null) {
  if (!iso) return { day: null, status: 'none' as const, label: '' };
  const day = new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
  const diff = Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  const status = diff < 0 ? ('past' as const) : diff === 0 ? ('today' as const) : ('upcoming' as const);
  const label =
    diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : diff === -1 ? 'Yesterday' : diff > 0 ? `In ${diff} days` : `${-diff} days ago`;
  return { day, status, label };
}

// ── Component ────────────────────────────────────────────────

export default function MeetingDetailBody({
  item: initialItem,
  outcome,
  people,
  teamMembers,
  canEdit,
  notes,
  footer,
}: Props) {
  const [item, setItem] = useState(initialItem);

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

  /**
   * Partial PATCH — caller passes any combination of editable fields.
   * `savingKey` is used only for the inline-edit glyph (spinner / check).
   */
  const savePatch = useCallback(
    async (
      savingKey: string,
      patch: { date?: string | null; endDate?: string | null; attendeeIds?: string[] },
    ) => {
      setSaving(savingKey);
      setEditingField(null);
      const previous = { date: item.date, endDate: item.endDate, attendeeIds: item.attendeeIds };
      setItem((prev) => ({
        ...prev,
        ...(patch.date !== undefined ? { date: patch.date } : {}),
        ...(patch.endDate !== undefined ? { endDate: patch.endDate } : {}),
        ...(patch.attendeeIds !== undefined ? { attendeeIds: patch.attendeeIds } : {}),
      }));
      try {
        const res = await fetch('/api/meeting', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: item.id, ...patch }),
        });
        if (!res.ok) throw new Error('Failed');

        setSavedField(savingKey);
        setTimeout(() => setSavedField(null), 1500);
      } catch {
        setItem((prev) => ({ ...prev, ...previous }));
        setErrorField(savingKey);
        setTimeout(() => setErrorField(null), 1500);
      } finally {
        setSaving(null);
      }
    },
    [item.id, item.date, item.endDate, item.attendeeIds],
  );

  const handleEdit = useCallback((field: string, el: HTMLDivElement) => {
    editAnchorRef.current = el;
    setEditingField(field);
  }, []);

  const { day, status: dateStatus, label: daysLabel } = dayInfo(item.date);
  const startTime = formatTime(item.date);
  const endTime = formatTime(item.endDate);
  const late = dateStatus === 'past' && !item.isAttended;

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

          {notes}
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
              {day ? (
                <div className="mt-2">
                  <p className="font-serif text-xl text-stone-900 dark:text-stone-50">
                    {new Date(`${day}T00:00:00Z`).toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })}
                  </p>
                  <p className={`mt-0.5 text-[13px] ${MUTED}`}>
                    {new Date(`${day}T00:00:00Z`).getUTCFullYear()}
                    {startTime && ` · ${startTime}`}
                    {endTime && ` – ${endTime}`}
                  </p>
                  <p
                    className={`mt-2 inline-flex items-center gap-1.5 text-[12px] font-medium ${
                      dateStatus === 'today' ? 'text-amber-700 dark:text-amber-300' : late ? 'text-rose-700 dark:text-rose-300' : MUTED
                    }`}
                  >
                    {late && <AlertTriangle className="w-3.5 h-3.5" />}
                    {daysLabel}
                  </p>
                </div>
              ) : (
                <p className={`mt-2 text-[13px] ${MUTED}`}>No date set.</p>
              )}
            </section>
          </EditableField>

          <SubjectCard title="At a glance" icon={<Handshake className="w-4 h-4" />}>
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
              <Fact label="Status" value={<StatusPill label={outcome.label} tone={outcome.tone} size="sm" />} />
              <Fact label="Attended" value={item.isAttended ? 'Yes' : 'No'} />
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
          onSelect={(ids) => savePatch('attendeeIds', { attendeeIds: ids })}
          onClose={() => setEditingField(null)}
          anchorRef={editAnchorRef}
        />
      )}

      {editingField === 'date' && editAnchorRef.current && (
        <CellDatePicker
          value={item.date}
          showTime
          showEndTime
          endValue={item.endDate}
          onSelect={(v) => savePatch('date', { date: v })}
          onSelectRange={({ start, end }) =>
            savePatch('date', { date: start, endDate: end })
          }
          onClose={() => setEditingField(null)}
          anchorRef={editAnchorRef}
        />
      )}
    </>
  );
}
