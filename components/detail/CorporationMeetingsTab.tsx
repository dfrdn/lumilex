'use client';

import { toast } from 'sonner';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, FileText, Download, Eye, Trash2, Upload, X, Pencil, ChevronRight, ChevronDown } from 'lucide-react';
import { createPortal } from 'react-dom';
import type {
  Corporation,
  CorporationMeeting,
  CorporationPerson,
  MeetingType,
  MeetingMode,
  MeetingAttendee,
  MeetingAgendaItem,
  MinutesStatus,
  Resolution,
  ResolutionTemplate,
} from '@/types/corporations';
import { useFileViewer } from '@/hooks/use-file-viewer';
import { meetingFileName, meetingFilePath, type MeetingFileSlot } from '@/lib/corporations/file-names';
import DatePickerInput from '@/components/DatePickerInput';
import CellDropdown from '@/components/admin/CellDropdown';
import { quorumError } from '@/lib/meeting-quorum';
import { parseCount } from '@/lib/parse-amount';
import ResolutionEditor from './ResolutionEditor';
import { uploadMeetingFile } from '@/lib/corporations/upload-file';
import { confirmAction } from '@/components/ui/confirm';

const MINUTES_STATUSES: MinutesStatus[] = ['Draft', 'For Signing', 'Signed'];

/** Merge the separate date + time columns into one value the date/time picker understands. */
function combineDateTime(date: string, time: string): string {
  if (!date) return '';
  return time ? `${date}T${time}` : date;
}

/** Split the picker's value back into the `meeting_date` (YYYY-MM-DD) + `meeting_time` (HH:MM:SS) columns. */
function splitDateTime(v: string | null): { date: string; time: string } {
  if (!v) return { date: '', time: '' };
  const m = v.match(/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}))?/);
  if (!m) return { date: '', time: '' };
  return { date: m[1], time: m[2] ? `${m[2]}:00` : '' };
}

const URL_RE = /^https?:\/\/\S+$/i;

interface Props {
  corporation: Corporation;
  meetings: CorporationMeeting[];
  onMeetingsChange: React.Dispatch<React.SetStateAction<CorporationMeeting[]>>;
  resolutions: Resolution[];
  templates: ResolutionTemplate[];
}

const MEETING_TYPES: MeetingType[] = [
  'Organizational', 'Regular Board', 'Special Board', 'Annual Stockholders', 'Special Stockholders',
];

const MEETING_MODES: MeetingMode[] = ['In-Person', 'Virtual', 'Hybrid'];

export default function CorporationMeetingsTab({ corporation, meetings, onMeetingsChange, resolutions: resolutionsProp, templates }: Props) {
  const [resolutions, setResolutions] = useState(resolutionsProp);
  useEffect(() => { setResolutions(resolutionsProp); }, [resolutionsProp]);

  const [editing, setEditing] = useState<CorporationMeeting | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [listError, setListError] = useState('');
  const fileViewer = useFileViewer();
  const [editingResolution, setEditingResolution] = useState<Resolution | null>(null);

  function previewMeetingFile(meeting: CorporationMeeting, slot: MeetingFileSlot) {
    const path = meetingFilePath(meeting, slot);
    void fileViewer.preview(meetingFileName(meeting, slot, path), path);
  }

  function downloadMinutes(meeting: CorporationMeeting) {
    const path = meeting.minutesFilePath;
    fileViewer.download(meetingFileName(meeting, 'minutes', path), path);
  }

  async function generateMinutes(meeting: CorporationMeeting) {
    setBusy(`min-${meeting.id}`);
    try {
      const res = await fetch(`/api/corporation/${corporation.id}/meetings/${meeting.id}/generate-minutes`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        toast.error(`Generate failed: ${data.error}`);
        return;
      }
      if (data.docxPath && data.meeting) fileViewer.download(meetingFileName(data.meeting, 'minutes', data.docxPath), data.docxPath);
      if (data.meeting) {
        onMeetingsChange((prev) => prev.map((m) => m.id === meeting.id ? data.meeting : m));
      }
    } finally {
      setBusy(null);
    }
  }

  async function uploadMinutes(meeting: CorporationMeeting, file: File) {
    setBusy(`upl-${meeting.id}`);
    try {
      const data = await uploadMeetingFile<{ meeting?: CorporationMeeting }>(
        corporation.id, meeting.id, 'minutes', file,
      );
      if (data.meeting) {
        onMeetingsChange((prev) => prev.map((m) => m.id === meeting.id ? data.meeting! : m));
      }
    } catch (e) {
      toast.error(`Upload failed: ${e instanceof Error ? e.message : 'unknown error'}`);
    } finally {
      setBusy(null);
    }
  }

  async function setMinutesStatus(meeting: CorporationMeeting, status: MinutesStatus) {
    const prev = meeting.minutesStatus;
    if (prev === status) return;
    onMeetingsChange((ms) => ms.map((m) => (m.id === meeting.id ? { ...m, minutesStatus: status } : m)));
    try {
      const res = await fetch(`/api/corporation/${corporation.id}/meetings/${meeting.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ minutesStatus: status }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      if (data.meeting) {
        onMeetingsChange((ms) => ms.map((m) => (m.id === meeting.id ? data.meeting : m)));
      }
    } catch {
      onMeetingsChange((ms) => ms.map((m) => (m.id === meeting.id ? { ...m, minutesStatus: prev } : m)));
      toast.error('Failed to update minutes status.');
    }
  }

  async function deleteMeeting(meetingId: string) {
    if (!(await confirmAction({ title: 'Delete this meeting?', message: 'Linked resolutions stay but lose their meeting link.', confirmLabel: 'Delete', danger: true }))) return;
    setListError('');
    const index = meetings.findIndex((m) => m.id === meetingId);
    const removed = meetings[index];
    const unlinked = new Set(resolutions.filter((r) => r.meetingId === meetingId).map((r) => r.id));
    onMeetingsChange((prev) => prev.filter((m) => m.id !== meetingId));
    setResolutions((prev) => prev.map((r) => r.meetingId === meetingId ? { ...r, meetingId: null } : r));
    const res = await fetch(`/api/corporation/${corporation.id}/meetings/${meetingId}`, { method: 'DELETE' }).catch(() => null);
    if (!res?.ok) {
      if (removed) onMeetingsChange((prev) => [...prev.slice(0, index), removed, ...prev.slice(index)]);
      setResolutions((prev) => prev.map((r) => unlinked.has(r.id) ? { ...r, meetingId } : r));
      const data = await res?.json().catch(() => null);
      setListError(data?.error ?? 'Failed to delete meeting.');
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          onClick={() => { setCreating(true); setEditing(null); }}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-navy-800 text-white hover:bg-navy-700"
        >
          <Plus className="w-3.5 h-3.5" /> New Meeting
        </button>
      </div>

      {listError && (
        <div className="px-3 py-2 text-xs rounded bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 text-rose-700 dark:text-rose-300">{listError}</div>
      )}

      {meetings.length === 0 ? (
        <div className="bg-white dark:bg-card border border-stone-200 dark:border-white/10 rounded-xl p-8 text-center text-sm text-stone-500 dark:text-stone-400">
          No meetings recorded yet.
        </div>
      ) : (
        <ul className="space-y-2">
          {meetings.map((m) => {
            const linked = resolutions.filter((r) => r.meetingId === m.id);
            return (
              <li key={m.id} className="bg-white dark:bg-card border border-stone-200 dark:border-white/10 rounded-xl p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-stone-800 dark:text-stone-100">{m.meetingType}</span>
                  <span className="text-xs text-stone-500 dark:text-stone-400">{m.meetingDate}{m.meetingTime ? ` · ${m.meetingTime}` : ''}</span>
                  {m.meetingMode && <span className="text-xs px-1.5 py-0.5 rounded bg-stone-100 dark:bg-white/10 text-stone-600 dark:text-stone-300">{m.meetingMode}</span>}
                  <span className={`text-xs px-1.5 py-0.5 rounded ${m.quorumAchieved ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-300'}`}>
                    {m.quorumAchieved ? 'Quorum' : 'No quorum'}
                  </span>
                  {m.minutesFilePath && (
                    <MinutesStatusBadge status={m.minutesStatus} onChange={(s) => setMinutesStatus(m, s)} />
                  )}
                </div>
                {m.venue && <div className="text-xs text-stone-500 dark:text-stone-400 mt-1">{m.venue}</div>}
                {m.attendees.length > 0 && (
                  <div className="text-xs text-stone-500 dark:text-stone-400 mt-1">
                    {m.attendees.filter((a) => a.attended).length} of {m.attendees.length} attended
                    {m.attendees.some((a) => a.proxyFor) && (
                      <span className="ml-1">({m.attendees.filter((a) => a.proxyFor).length} via proxy)</span>
                    )}
                  </div>
                )}
                {linked.length > 0 && (
                  <div className="mt-3 border-t border-stone-100 dark:border-white/10 pt-3">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">
                        Resolutions adopted ({linked.length})
                      </span>
                    </div>
                    <ul className="space-y-1">
                      {linked.map((r) => (
                        <li key={r.id}>
                          <button
                            onClick={() => setEditingResolution(r)}
                            className="w-full group flex items-center gap-2 px-2.5 py-1.5 text-left text-xs rounded-lg border border-stone-200 dark:border-white/10 hover:border-navy-300 dark:hover:border-navy-500/30 hover:bg-navy-50/40 dark:hover:bg-navy-500/10"
                          >
                            <Pencil className="w-3 h-3 text-stone-400 dark:text-stone-500 group-hover:text-navy-600 dark:group-hover:text-navy-400 shrink-0" />
                            <span className="flex-1 min-w-0 truncate font-medium text-stone-800 dark:text-stone-100">{r.title}</span>
                            <span className="text-[10px] text-stone-500 dark:text-stone-400 hidden sm:inline">{r.kind}</span>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded ${r.status === 'Signed' ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : r.status === 'For Signing' ? 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300' : 'bg-stone-100 dark:bg-white/10 text-stone-600 dark:text-stone-300'}`}>
                              {r.status}
                            </span>
                            <ChevronRight className="w-3 h-3 text-stone-300 dark:text-stone-600 group-hover:text-navy-600 dark:group-hover:text-navy-400 shrink-0" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* File chips */}
                <div className="flex flex-wrap gap-1.5 mt-2">
                  <FileChip label="Notice" present={!!m.noticeFilePath} onClick={() => previewMeetingFile(m, 'notice')} />
                  <FileChip label="Waiver" present={!!m.waiverOfNoticeFilePath} onClick={() => previewMeetingFile(m, 'waiver')} />
                  <FileChip label="Attendance" present={!!m.attendanceSheetPath} onClick={() => previewMeetingFile(m, 'attendance')} />
                  <FileChip label={`Proxies (${m.proxyFilePaths.length})`} present={m.proxyFilePaths.length > 0} onClick={() => { setEditing(m); setCreating(false); }} />
                  {m.recordingPath && (
                    <FileChip label="Recording" present onClick={() => previewMeetingFile(m, 'recording')} />
                  )}
                  <FileChip label="Minutes" present={!!m.minutesFilePath} onClick={() => previewMeetingFile(m, 'minutes')} />
                </div>

                {/* Action row */}
                <div className="flex items-center justify-end gap-1 mt-3 pt-3 border-t border-stone-100 dark:border-white/10">
                  {m.minutesFilePath && (
                    <>
                      <button
                        onClick={() => previewMeetingFile(m, 'minutes')}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs border border-stone-300 dark:border-white/15 rounded hover:bg-stone-50 dark:hover:bg-white/5"
                        title="Preview minutes in-app"
                      >
                        <Eye className="w-3.5 h-3.5" /> Preview
                      </button>
                      <button
                        onClick={() => downloadMinutes(m)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs border border-stone-300 dark:border-white/15 rounded hover:bg-stone-50 dark:hover:bg-white/5"
                        title="Download existing minutes"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => generateMinutes(m)}
                    disabled={busy === `min-${m.id}`}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs border border-stone-300 dark:border-white/15 rounded hover:bg-stone-50 dark:hover:bg-white/5 disabled:opacity-50"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    {busy === `min-${m.id}` ? 'Generating…' : (m.minutesFilePath ? 'Regenerate' : 'Generate Minutes')}
                  </button>
                  <label
                    className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs border border-stone-300 dark:border-white/15 rounded cursor-pointer hover:bg-stone-50 dark:hover:bg-white/5 ${busy === `upl-${m.id}` ? 'opacity-50 pointer-events-none' : ''}`}
                    title="Upload your own minutes file (DOCX or PDF)"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    {busy === `upl-${m.id}` ? 'Uploading…' : (m.minutesFilePath ? 'Replace' : 'Upload Minutes')}
                    <input
                      type="file"
                      accept=".docx,.doc,.pdf"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) uploadMinutes(m, f);
                        e.target.value = '';
                      }}
                    />
                  </label>
                  <span className="flex-1" />
                  <button
                    onClick={() => { setEditing(m); setCreating(false); }}
                    className="px-2.5 py-1 text-xs border border-stone-300 dark:border-white/15 rounded hover:bg-stone-50 dark:hover:bg-white/5"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => deleteMeeting(m.id)}
                    className="px-2 py-1 text-xs text-stone-400 dark:text-stone-500 hover:text-rose-600 dark:hover:text-rose-400 rounded"
                    title="Delete meeting"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {(creating || editing) && (
        <MeetingEditor
          corporation={corporation}
          existing={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={(saved) => {
            setCreating(false);
            setEditing(null);
            if (saved) {
              onMeetingsChange((prev) => {
                const idx = prev.findIndex((m) => m.id === saved.id);
                if (idx >= 0) {
                  const next = prev.slice();
                  next[idx] = saved;
                  return next;
                }
                const at = prev.findIndex((m) => m.meetingDate < saved.meetingDate);
                const next = prev.slice();
                next.splice(at < 0 ? next.length : at, 0, saved);
                return next;
              });
            }
          }}
          onMeetingUpdated={(updated) => {
            onMeetingsChange((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
          }}
        />
      )}

      {fileViewer.viewer}

      {editingResolution && (
        <ResolutionEditor
          corporationId={corporation.id}
          resolution={editingResolution}
          templates={templates}
          meetings={meetings}
          onClose={() => setEditingResolution(null)}
          onSaved={(saved) => {
            setEditingResolution(null);
            if (saved) setResolutions((prev) => prev.map((r) => r.id === saved.id ? saved : r));
          }}
        />
      )}
    </div>
  );
}

function MinutesStatusBadge({ status, onChange }: { status: MinutesStatus; onChange: (s: MinutesStatus) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const color =
    status === 'Signed' ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
    : status === 'For Signing' ? 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300'
    : 'bg-stone-100 dark:bg-white/10 text-stone-600 dark:text-stone-300';
  return (
    <>
      <button
        ref={ref}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded ${color} hover:ring-1 hover:ring-stone-300 dark:hover:ring-white/20`}
        title="Change minutes status"
      >
        Minutes: {status}
        <ChevronDown className="w-3 h-3 opacity-60" />
      </button>
      {open && (
        <CellDropdown
          mode="single"
          options={MINUTES_STATUSES.map((s) => ({ id: s, label: s }))}
          value={status}
          anchorRef={ref}
          placeholder="Set status…"
          onSelect={(id) => { if (id) onChange(id as MinutesStatus); }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function FileChip({ label, present, onClick }: { label: string; present: boolean; onClick?: () => void }) {
  if (!present) {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded-full border border-dashed border-stone-300 dark:border-white/15 text-stone-400 dark:text-stone-500">
        {label}: —
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded-full border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-500/10"
    >
      <Eye className="w-2.5 h-2.5" />
      {label}
    </button>
  );
}

// ---- Meeting editor (drawer) ----

function MeetingEditor({
  corporation,
  existing,
  onClose,
  onSaved,
  onMeetingUpdated,
}: {
  corporation: Corporation;
  existing: CorporationMeeting | null;
  onClose: () => void;
  onSaved: (saved: CorporationMeeting | null) => void;
  onMeetingUpdated: (updated: CorporationMeeting) => void;
}) {
  const isEdit = !!existing;

  const [people, setPeople] = useState<CorporationPerson[]>([]);
  const [peopleLoaded, setPeopleLoaded] = useState(false);
  const [meetingType, setMeetingType] = useState<MeetingType>(existing?.meetingType ?? 'Regular Board');
  const [meetingDate, setMeetingDate] = useState(existing?.meetingDate ?? '');
  const [meetingTime, setMeetingTime] = useState(existing?.meetingTime ?? '');
  const [meetingMode, setMeetingMode] = useState<MeetingMode>(existing?.meetingMode ?? 'In-Person');
  const [venue, setVenue] = useState(existing?.venue ?? '');
  const [noticeSentDate, setNoticeSentDate] = useState(existing?.noticeSentDate ?? '');
  const [quorum, setQuorum] = useState(existing?.quorumAchieved ?? true);
  const [sharesRepresented, setSharesRepresented] = useState(existing?.sharesRepresented?.toString() ?? '');
  const [totalShares, setTotalShares] = useState(existing?.totalSharesOutstanding?.toString() ?? '');
  const [agenda, setAgenda] = useState<MeetingAgendaItem[]>(existing?.agenda ?? []);
  const [attendees, setAttendees] = useState<MeetingAttendee[]>(existing?.attendees ?? []);
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [filePaths, setFilePaths] = useState({
    noticeFilePath: existing?.noticeFilePath ?? null,
    waiverOfNoticeFilePath: existing?.waiverOfNoticeFilePath ?? null,
    attendanceSheetPath: existing?.attendanceSheetPath ?? null,
    recordingPath: existing?.recordingPath ?? null,
    proxyFilePaths: existing?.proxyFilePaths ?? [],
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const isSh = meetingType.includes('Stockholders');
  const clearErr = (field: string) => setFieldErrors((e) => (e[field] ? { ...e, [field]: '' } : e));

  function validate(): Record<string, string> {
    const errs: Record<string, string> = {};
    if (!meetingDate) {
      errs.meetingDate = 'Meeting date is required';
    }

    const v = venue.trim();
    if (!v) {
      errs.venue = 'Venue is required';
    } else if (meetingMode === 'Virtual' && !URL_RE.test(v)) {
      errs.venue = 'Enter a valid meeting link (https://…) for virtual meetings';
    }

    if (noticeSentDate && meetingDate && noticeSentDate > meetingDate) {
      errs.noticeSentDate = 'Notice cannot be sent after the meeting date';
    }

    const rep = parseCount(sharesRepresented);
    const tot = parseCount(totalShares);
    if (isSh) {
      if (sharesRepresented.trim() !== '' && (rep === null || rep < 0)) errs.sharesRepresented = 'Enter a valid number';
      if (totalShares.trim() !== '' && (tot === null || tot < 0)) errs.totalShares = 'Enter a valid number';
      if (!errs.sharesRepresented && !errs.totalShares && rep !== null && tot !== null && rep > tot) {
        errs.sharesRepresented = 'Cannot exceed total shares outstanding';
      }
    }

    if (quorum && !errs.sharesRepresented && !errs.totalShares) {
      // Board quorum needs the director list; don't pass the check while it's still loading.
      if (!isSh && !peopleLoaded) {
        errs.quorum = 'Loading directors… try again in a moment';
      } else {
        const totalDirectors = people.filter((p) => p.isCurrent && p.role === 'Director').length;
        const qErr = quorumError(
          {
            meetingType,
            quorumAchieved: quorum,
            attendees,
            sharesRepresented: rep,
            totalSharesOutstanding: tot,
          },
          { totalDirectors, corporationShares: corporation.numberOfShares ?? null },
        );
        if (qErr) errs.quorum = qErr;
      }
    }
    return errs;
  }

  useEffect(() => {
    fetch(`/api/corporation/${corporation.id}/people`)
      .then((r) => r.json())
      .then((d) => { setPeople(d.people ?? []); setPeopleLoaded(true); })
      .catch(() => setPeopleLoaded(true));
  }, [corporation.id]);

  const eligiblePeople = useMemo(() => {
    const seen = new Set<string>();
    return people
      .filter((p) => {
        const key = `${p.firstName}|${p.lastName}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .filter((p) => p.firstName.trim() || p.lastName.trim());
  }, [people]);

  function addAgendaItem() {
    setAgenda((a) => [...a, { order: a.length + 1, title: '', notes: '' }]);
  }
  function updateAgenda(i: number, patch: Partial<MeetingAgendaItem>) {
    setAgenda((a) => a.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  }
  function removeAgenda(i: number) {
    setAgenda((a) => a.filter((_, j) => j !== i).map((x, j) => ({ ...x, order: j + 1 })));
  }

  function addAttendee(personName?: string, role?: string) {
    setAttendees((xs) => [...xs, { name: personName ?? '', role: role ?? '', attended: true, proxyFor: '', shares: null }]);
    clearErr('quorum');
  }
  function updateAttendee(i: number, patch: Partial<MeetingAttendee>) {
    setAttendees((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)));
    clearErr('quorum');
  }
  function removeAttendee(i: number) {
    setAttendees((xs) => xs.filter((_, j) => j !== i));
  }

  async function save() {
    setError('');
    const errs = validate();
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) {
      setError('Please fix the highlighted fields.');
      return;
    }
    setBusy(true);

    const payload = {
      meetingType,
      meetingDate,
      meetingTime: meetingTime || null,
      meetingMode,
      venue: venue || null,
      noticeSentDate: noticeSentDate || null,
      quorumAchieved: quorum,
      sharesRepresented: isSh ? parseCount(sharesRepresented) : null,
      totalSharesOutstanding: isSh ? parseCount(totalShares) : null,
      agenda: agenda.filter((a) => a.title.trim()).map((a, i) => ({ ...a, order: i + 1 })),
      attendees: attendees.filter((a) => a.name.trim()),
      notes: notes || null,
    };

    const endpoint = isEdit
      ? `/api/corporation/${corporation.id}/meetings/${existing!.id}`
      : `/api/corporation/${corporation.id}/meetings`;
    const method = isEdit ? 'PATCH' : 'POST';
    const res = await fetch(endpoint, {
      method, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? 'Save failed');
      return;
    }
    onSaved(data.meeting ?? null);
  }

  async function uploadFile(slot: 'notice' | 'waiver' | 'proxy' | 'attendance' | 'recording', file: File) {
    if (!existing) {
      toast.error('Save the meeting first to attach files.');
      return;
    }
    let data: { meeting?: CorporationMeeting };
    try {
      data = await uploadMeetingFile<{ meeting?: CorporationMeeting }>(
        corporation.id, existing.id, slot, file,
      );
    } catch (e) {
      toast.error(`Upload failed: ${e instanceof Error ? e.message : 'unknown error'}`);
      return;
    }
    const updated: CorporationMeeting | null = data.meeting ?? null;
    if (updated) {
      setFilePaths({
        noticeFilePath: updated.noticeFilePath,
        waiverOfNoticeFilePath: updated.waiverOfNoticeFilePath,
        attendanceSheetPath: updated.attendanceSheetPath,
        recordingPath: updated.recordingPath,
        proxyFilePaths: updated.proxyFilePaths,
      });
      onMeetingUpdated(updated);
    }
  }

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-50 bg-black/40 flex items-stretch justify-end" onClick={() => !busy && onClose()}>
      <div className="bg-white dark:bg-card w-full max-w-2xl h-full overflow-y-auto shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-white dark:bg-card border-b border-stone-200 dark:border-white/10 px-5 py-3 flex items-center justify-between z-10">
          <h2 className="text-sm font-semibold text-stone-800 dark:text-stone-100">{isEdit ? 'Edit Meeting' : 'New Meeting'}</h2>
          <button onClick={() => !busy && onClose()} className="p-1 rounded hover:bg-stone-100 dark:hover:bg-white/10">
            <X className="w-4 h-4 text-stone-500 dark:text-stone-400" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-5">
          {/* Basic info */}
          <section className="grid grid-cols-2 gap-3">
            <FieldSelect label="Type" value={meetingType} onChange={(v) => { setMeetingType(v as MeetingType); clearErr('quorum'); }} options={MEETING_TYPES} />
            <FieldSelect label="Mode" value={meetingMode} onChange={(v) => { setMeetingMode(v as MeetingMode); clearErr('venue'); }} options={MEETING_MODES} />
            <FieldDate
              label="Date & Time"
              showTime
              value={combineDateTime(meetingDate, meetingTime)}
              onChange={(v) => {
                const { date, time } = splitDateTime(v);
                setMeetingDate(date);
                setMeetingTime(time);
                clearErr('meetingDate');
              }}
              error={fieldErrors.meetingDate}
              placeholder="Select date & time"
            />
            <FieldDate
              label="Notice Sent Date"
              value={noticeSentDate}
              onChange={(v) => { setNoticeSentDate(splitDateTime(v).date); clearErr('noticeSentDate'); }}
              error={fieldErrors.noticeSentDate}
            />
            <div className="col-span-2">
              <FieldInput
                label={meetingMode === 'Virtual' ? 'Venue (meeting link)' : 'Venue'}
                value={venue}
                onChange={(v) => { setVenue(v); clearErr('venue'); }}
                placeholder={meetingMode === 'Virtual' ? 'https://meet.google.com/…' : 'Physical address'}
                error={fieldErrors.venue}
              />
            </div>
            <div className="pb-2">
              <label className="flex items-end gap-2">
                <input type="checkbox" checked={quorum} onChange={(e) => { setQuorum(e.target.checked); clearErr('quorum'); }} />
                <span className="text-xs text-stone-700 dark:text-stone-200">Quorum achieved</span>
              </label>
              {fieldErrors.quorum && <span className="block mt-1 text-xs text-rose-600 dark:text-rose-400">{fieldErrors.quorum}</span>}
            </div>
            {isSh && (
              <>
                <FieldInput label="Shares Represented" value={sharesRepresented} onChange={(v) => { setSharesRepresented(v); clearErr('sharesRepresented'); clearErr('quorum'); }} error={fieldErrors.sharesRepresented} />
                <FieldInput label="Total Shares Outstanding" value={totalShares} onChange={(v) => { setTotalShares(v); clearErr('totalShares'); clearErr('quorum'); }} error={fieldErrors.totalShares} />
              </>
            )}
          </section>

          {/* Agenda */}
          <section>
            <h3 className="text-xs font-semibold text-stone-700 dark:text-stone-200 mb-2">Agenda</h3>
            <ul className="space-y-2">
              {agenda.map((item, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="text-xs text-stone-400 dark:text-stone-500 mt-2 w-5">{i + 1}.</span>
                  <div className="flex-1 space-y-1">
                    <input
                      type="text"
                      value={item.title}
                      onChange={(e) => updateAgenda(i, { title: e.target.value })}
                      placeholder="Agenda item"
                      className="w-full px-2 py-1.5 text-sm border border-stone-300 dark:border-white/15 rounded outline-none"
                    />
                    <input
                      type="text"
                      value={item.notes ?? ''}
                      onChange={(e) => updateAgenda(i, { notes: e.target.value })}
                      placeholder="Notes (optional)"
                      className="w-full px-2 py-1.5 text-xs border border-stone-200 dark:border-white/10 rounded outline-none text-stone-600 dark:text-stone-300"
                    />
                  </div>
                  <button onClick={() => removeAgenda(i)} className="text-stone-400 dark:text-stone-500 hover:text-rose-600 dark:hover:text-rose-400 mt-2">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </li>
              ))}
            </ul>
            <button
              onClick={addAgendaItem}
              className="mt-2 inline-flex items-center gap-1 px-2.5 py-1 text-xs text-stone-600 dark:text-stone-300 hover:bg-stone-50 dark:hover:bg-white/5 rounded"
            >
              <Plus className="w-3 h-3" /> Add agenda item
            </button>
          </section>

          {/* Attendees */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold text-stone-700 dark:text-stone-200">Attendees</h3>
              {eligiblePeople.length > 0 && attendees.length === 0 && (
                <button
                  onClick={() => {
                    eligiblePeople.forEach((p) => addAttendee(`${p.firstName} ${p.lastName}`.trim(), p.role));
                  }}
                  className="text-xs text-navy-700 dark:text-navy-300 hover:underline"
                >
                  Add all current people
                </button>
              )}
            </div>
            <ul className="space-y-2">
              {attendees.map((a, i) => (
                <li key={i} className="border border-stone-200 dark:border-white/10 rounded p-2 grid grid-cols-12 gap-2 items-center">
                  <input
                    type="text"
                    value={a.name}
                    onChange={(e) => updateAttendee(i, { name: e.target.value })}
                    placeholder="Name"
                    className="col-span-4 px-2 py-1.5 text-sm border border-stone-300 dark:border-white/15 rounded outline-none"
                  />
                  <input
                    type="text"
                    value={a.role ?? ''}
                    onChange={(e) => updateAttendee(i, { role: e.target.value })}
                    placeholder="Role"
                    className="col-span-3 px-2 py-1.5 text-sm border border-stone-300 dark:border-white/15 rounded outline-none"
                  />
                  <input
                    type="text"
                    value={a.proxyFor ?? ''}
                    onChange={(e) => updateAttendee(i, { proxyFor: e.target.value })}
                    placeholder="Proxy for…"
                    className="col-span-3 px-2 py-1.5 text-xs border border-stone-200 dark:border-white/10 rounded outline-none text-stone-600 dark:text-stone-300"
                    title="If holding proxy: principal's name"
                  />
                  <label className="col-span-1 flex items-center gap-1 text-xs text-stone-600 dark:text-stone-300">
                    <input
                      type="checkbox"
                      checked={a.attended}
                      onChange={(e) => updateAttendee(i, { attended: e.target.checked })}
                    />
                    P
                  </label>
                  <button onClick={() => removeAttendee(i)} className="col-span-1 text-stone-400 dark:text-stone-500 hover:text-rose-600 dark:hover:text-rose-400 justify-self-end">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex gap-2 mt-2">
              <button
                onClick={() => addAttendee()}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs text-stone-600 dark:text-stone-300 hover:bg-stone-50 dark:hover:bg-white/5 rounded"
              >
                <Plus className="w-3 h-3" /> Add attendee
              </button>
              {eligiblePeople.length > 0 && (
                <PeoplePicker people={eligiblePeople} onPick={(p) => addAttendee(`${p.firstName} ${p.lastName}`.trim(), p.role)} />
              )}
            </div>
            <p className="text-[10px] text-stone-400 dark:text-stone-500 mt-1">P = Present. Use the &ldquo;Proxy for&rdquo; field when an attendee is representing an absent stockholder/director.</p>
          </section>

          {/* Notice / Waiver / Proxies / Attendance / Recording uploads */}
          <section>
            <h3 className="text-xs font-semibold text-stone-700 dark:text-stone-200 mb-2">Documents</h3>
            {!existing ? (
              <p className="text-xs text-stone-400 dark:text-stone-500 italic">Save the meeting first to attach notice, waiver, proxies, attendance sheet, or recording.</p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <UploadSlot label="Notice of Meeting" path={filePaths.noticeFilePath} onUpload={(f) => uploadFile('notice', f)} />
                <UploadSlot label="Waiver of Notice" path={filePaths.waiverOfNoticeFilePath} onUpload={(f) => uploadFile('waiver', f)} />
                <UploadSlot label="Attendance Sheet" path={filePaths.attendanceSheetPath} onUpload={(f) => uploadFile('attendance', f)} />
                <UploadSlot label="Recording (virtual/hybrid)" path={filePaths.recordingPath} onUpload={(f) => uploadFile('recording', f)} />
                <div className="col-span-2">
                  <ProxyUploads
                    paths={filePaths.proxyFilePaths}
                    onUpload={(f) => uploadFile('proxy', f)}
                  />
                </div>
              </div>
            )}
          </section>

          {/* Notes */}
          <section>
            <label className="block text-xs font-semibold text-stone-700 dark:text-stone-200 mb-1">Internal notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="w-full px-2 py-1.5 text-sm border border-stone-300 dark:border-white/15 rounded outline-none"
            />
          </section>

          {error && <div className="px-3 py-2 text-xs rounded bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 text-rose-700 dark:text-rose-300">{error}</div>}
        </div>

        <div className="sticky bottom-0 bg-white dark:bg-card border-t border-stone-200 dark:border-white/10 px-5 py-3 flex justify-end gap-2">
          <button onClick={() => !busy && onClose()} className="px-3 py-1.5 text-xs text-stone-600 dark:text-stone-300 hover:bg-stone-50 dark:hover:bg-white/5 rounded">
            Cancel
          </button>
          <button
            onClick={save}
            disabled={busy || !meetingDate || !venue.trim()}
            className="px-3 py-1.5 text-xs font-medium rounded bg-navy-800 text-white hover:bg-navy-700 disabled:opacity-50"
          >
            {busy ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Meeting'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function FieldInput({ label, value, onChange, type = 'text', placeholder, error }: { label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string; error?: string }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-stone-600 dark:text-stone-300 mb-1">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full px-2 py-1.5 text-sm border rounded outline-none ${error ? 'border-rose-400 bg-rose-50/30 dark:bg-rose-500/10' : 'border-stone-300 dark:border-white/15'}`}
      />
      {error && <span className="block mt-1 text-xs text-rose-600 dark:text-rose-400">{error}</span>}
    </label>
  );
}

function FieldDate({ label, value, onChange, showTime, placeholder, error }: { label: string; value: string; onChange: (v: string | null) => void; showTime?: boolean; placeholder?: string; error?: string }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-stone-600 dark:text-stone-300 mb-1">{label}</span>
      <DatePickerInput value={value || null} onChange={onChange} showTime={showTime} placeholder={placeholder} hasError={!!error} />
      {error && <span className="block mt-1 text-xs text-rose-600 dark:text-rose-400">{error}</span>}
    </label>
  );
}

function FieldSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  return (
    <div className="block">
      <span className="block text-xs font-medium text-stone-600 dark:text-stone-300 mb-1">{label}</span>
      <button
        ref={anchorRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 px-2 py-1.5 text-sm border border-stone-300 dark:border-white/15 rounded outline-none text-left"
      >
        <span className="truncate">{value}</span>
        <ChevronDown className="w-3.5 h-3.5 text-stone-400 dark:text-stone-500 shrink-0" />
      </button>
      {open && (
        <CellDropdown
          mode="single"
          value={value}
          options={options.map((o) => ({ id: o, label: o }))}
          onSelect={(id) => { if (id) onChange(id); setOpen(false); }}
          onClose={() => setOpen(false)}
          anchorRef={anchorRef}
        />
      )}
    </div>
  );
}

function PeoplePicker({ people, onPick }: { people: CorporationPerson[]; onPick: (p: CorporationPerson) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs text-navy-700 dark:text-navy-300 hover:bg-stone-50 dark:hover:bg-white/5 rounded"
      >
        <Plus className="w-3 h-3" /> Pick from corporation people
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-64 bg-white dark:bg-card border border-stone-200 dark:border-white/10 rounded shadow-lg max-h-60 overflow-y-auto">
          {people.map((p) => (
            <button
              key={p.id}
              onClick={() => { onPick(p); setOpen(false); }}
              className="w-full text-left px-3 py-1.5 text-sm hover:bg-stone-50 dark:hover:bg-white/5"
            >
              {p.firstName} {p.lastName} <span className="text-xs text-stone-400 dark:text-stone-500">— {p.role}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function UploadSlot({ label, path, onUpload }: { label: string; path: string | null; onUpload: (f: File) => void }) {
  return (
    <div className="border border-stone-200 dark:border-white/10 rounded p-2">
      <div className="text-xs font-medium text-stone-700 dark:text-stone-200">{label}</div>
      {path ? (
        <div className="text-xs text-emerald-700 dark:text-emerald-300 mt-1 truncate" title={path}>📎 {path.split('/').pop()}</div>
      ) : (
        <div className="text-xs text-stone-400 dark:text-stone-500 mt-1">No file</div>
      )}
      <label className="mt-2 inline-flex items-center gap-1 text-xs text-navy-700 dark:text-navy-300 hover:underline cursor-pointer">
        <Upload className="w-3 h-3" />
        {path ? 'Replace' : 'Upload'}
        <input
          type="file"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onUpload(f);
            e.target.value = '';
          }}
        />
      </label>
    </div>
  );
}

function ProxyUploads({ paths, onUpload }: { paths: string[]; onUpload: (f: File) => void }) {
  return (
    <div className="border border-stone-200 dark:border-white/10 rounded p-2">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium text-stone-700 dark:text-stone-200">Proxies ({paths.length})</div>
        <label className="inline-flex items-center gap-1 text-xs text-navy-700 dark:text-navy-300 hover:underline cursor-pointer">
          <Upload className="w-3 h-3" /> Add proxy
          <input
            type="file"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onUpload(f);
              e.target.value = '';
            }}
          />
        </label>
      </div>
      {paths.length === 0 ? (
        <div className="text-xs text-stone-400 dark:text-stone-500 mt-1">No proxies uploaded</div>
      ) : (
        <ul className="text-xs text-emerald-700 dark:text-emerald-300 mt-1 space-y-1">
          {paths.map((p, i) => (
            <li key={i} className="truncate" title={p}>📎 {p.split('/').pop()}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
