'use client';

import { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, Building2, ChevronDown, Crown, Download, Eye, Paperclip, Pencil, PieChart, Plus, Trash2, Upload, UserPlus, Users, X,
} from 'lucide-react';
import { useFileViewer } from '@/hooks/use-file-viewer';
import CellDropdown from '@/components/admin/CellDropdown';
import DatePickerInput from '@/components/DatePickerInput';
import { parseAmount } from '@/lib/parse-amount';
import type {
  Corporation,
  CorporationPerson,
  CorporationFile,
  CorporationFileCategory,
  CorporationPersonRole,
} from '@/types/corporations';
import { applySavedPerson, dedupePeople, groupPeople, type PersonGroup } from '@/lib/corporation-identity';
import { isFilipino } from '@/lib/corporations/capital-structure';
import { manilaToday } from '@/lib/corporations/status';
import { uploadCorporationFile } from '@/lib/corporations/upload-file';
import { confirmAction } from '@/components/ui/confirm';

interface Props {
  corporation: Corporation;
  people: CorporationPerson[];
  files?: CorporationFile[];
  onPeopleChange: React.Dispatch<React.SetStateAction<CorporationPerson[]>>;
  onFilesChange: React.Dispatch<React.SetStateAction<CorporationFile[]>>;
}

const PERSON_CATEGORIES: CorporationFileCategory[] = ['ID Copy', 'Other'];

/** Display order of a person's roles, and of people (by their first role). */
const ROLE_ORDER: CorporationPersonRole[] = [
  'President', 'Chairman', 'Director', 'Treasurer', 'Corporate Secretary', 'Compliance Officer', 'Officer',
  'Nominee', 'Alternate Nominee', 'Incorporator', 'Stockholder',
];
const SHARE_ROLES = new Set<CorporationPersonRole>(['Incorporator', 'Stockholder']);
const TITLED_ROLES = new Set<CorporationPersonRole>(['Officer']);
/** Roles whose details need a form (shares, a position title); the rest add in one click. */
const FORM_ROLES = new Set<CorporationPersonRole>(['Incorporator', 'Stockholder', 'Officer']);

const ROLE_TONE: Record<CorporationPersonRole, string> = {
  President: 'bg-navy-50 text-navy-800 ring-navy-200 dark:bg-navy-500/15 dark:text-navy-200 dark:ring-navy-400/30',
  Chairman: 'bg-navy-50 text-navy-800 ring-navy-200 dark:bg-navy-500/15 dark:text-navy-200 dark:ring-navy-400/30',
  Director: 'bg-sky-50 text-sky-800 ring-sky-200 dark:bg-sky-500/10 dark:text-sky-200 dark:ring-sky-400/25',
  Treasurer: 'bg-violet-50 text-violet-800 ring-violet-200 dark:bg-violet-500/10 dark:text-violet-200 dark:ring-violet-400/25',
  'Corporate Secretary': 'bg-violet-50 text-violet-800 ring-violet-200 dark:bg-violet-500/10 dark:text-violet-200 dark:ring-violet-400/25',
  'Compliance Officer': 'bg-violet-50 text-violet-800 ring-violet-200 dark:bg-violet-500/10 dark:text-violet-200 dark:ring-violet-400/25',
  Officer: 'bg-violet-50 text-violet-800 ring-violet-200 dark:bg-violet-500/10 dark:text-violet-200 dark:ring-violet-400/25',
  Incorporator: 'bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-200 dark:ring-amber-400/25',
  Stockholder: 'bg-emerald-50 text-emerald-800 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-200 dark:ring-emerald-400/25',
  Nominee: 'bg-stone-100 text-stone-700 ring-stone-200 dark:bg-white/10 dark:text-stone-200 dark:ring-white/15',
  'Alternate Nominee': 'bg-stone-100 text-stone-700 ring-stone-200 dark:bg-white/10 dark:text-stone-200 dark:ring-white/15',
};

const rank = (r: CorporationPersonRole) => ROLE_ORDER.indexOf(r);
const byRole = (a: CorporationPerson, b: CorporationPerson) => rank(a.role) - rank(b.role);

function nameOf(p: CorporationPerson): string {
  return p.isJuridical
    ? (p.entityName || '(unnamed entity)')
    : ([p.firstName, p.lastName].filter(Boolean).join(' ') || '(unnamed)');
}

function roleLabel(p: CorporationPerson): string {
  return p.role === 'Officer' && p.positionTitle ? p.positionTitle : p.role;
}

const peso = (n: number | null | undefined) =>
  n == null ? '—' : `₱${n.toLocaleString('en-PH', { maximumFractionDigits: 2 })}`;
const count = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('en-PH'));

/** The person's shareholding: their largest current shareholder role. */
function holdingOf(g: PersonGroup): CorporationPerson | null {
  const rows = g.roles.filter((r) => r.isCurrent && SHARE_ROLES.has(r.role));
  if (!rows.length) return null;
  return rows.reduce((a, b) => ((b.sharesSubscribedAmount ?? 0) > (a.sharesSubscribedAmount ?? 0) ? b : a));
}

/** Rules of the Revised Corporation Code a list of officers can be checked against. */
function boardChecks(current: CorporationPerson[], isOpc: boolean): string[] {
  const holders = (role: CorporationPersonRole) => current.filter((p) => p.role === role);
  const pid = (p: CorporationPerson) => p.personRecordId ?? `row:${p.id}`;
  const directorIds = new Set(holders('Director').map(pid));
  const out: string[] = [];
  for (const pres of holders('President')) {
    if (!isOpc && !directorIds.has(pid(pres))) out.push(`${nameOf(pres)} is President but not on the board — the President must be a director.`);
    for (const role of ['Corporate Secretary', 'Treasurer'] as const) {
      if (holders(role).some((p) => pid(p) === pid(pres))) {
        out.push(`${nameOf(pres)} is both President and ${role} — the Code bars holding the two at once.`);
      }
    }
  }
  for (const sec of holders('Corporate Secretary')) {
    if (sec.nationality && !isFilipino(sec.nationality)) {
      out.push(`${nameOf(sec)} is Corporate Secretary but recorded as ${sec.nationality} — the Secretary must be a Filipino citizen and resident.`);
    }
    if (isOpc && current.some((p) => SHARE_ROLES.has(p.role) && pid(p) === pid(sec))) {
      out.push(`${nameOf(sec)} is the single stockholder and Corporate Secretary — in an OPC the stockholder may not be the Secretary.`);
    }
  }
  return out;
}

/**
 * A place on the board or among the officers. A required office is keyed by
 * its role; a custom one (Chairman, Vice President, Asst. Corporate Secretary…)
 * by role and title. `replaces` is the sitting holder, kept as a former one.
 */
interface Seat {
  role: CorporationPersonRole;
  title: string | null;
  label: string;
  replaces: CorporationPerson | null;
}

const seatKey = (s: Seat) => `${s.role}|${(s.title ?? '').toLowerCase()}|${s.replaces?.id ?? ''}`;

/** The seat a typed position name means: Chairman and Compliance Officer are roles of their own. */
function seatForTitle(title: string): Seat {
  const t = title.trim();
  if (/^chair(man|person|woman)?( of the board)?$/i.test(t)) return { role: 'Chairman', title: null, label: 'Chairman', replaces: null };
  if (/^compliance officer$/i.test(t)) return { role: 'Compliance Officer', title: null, label: 'Compliance Officer', replaces: null };
  return { role: 'Officer', title: t, label: t, replaces: null };
}

const CUSTOM_OFFICER_ROLES = new Set<CorporationPersonRole>(['Chairman', 'Compliance Officer', 'Officer']);
const POSITION_SUGGESTIONS = ['Chairman', 'Vice President', 'Assistant Corporate Secretary', 'Compliance Officer', 'Chief Executive Officer', 'Chief Financial Officer', 'General Manager'];

type PeopleFilter = 'all' | 'board' | 'officers' | 'stockholders';
const FILTER_ROLES: Record<Exclude<PeopleFilter, 'all'>, Set<CorporationPersonRole>> = {
  board: new Set(['Director']),
  officers: new Set(['President', 'Treasurer', 'Corporate Secretary', 'Chairman', 'Compliance Officer', 'Officer', 'Nominee', 'Alternate Nominee']),
  stockholders: SHARE_ROLES,
};
const FILTER_LABEL: Record<PeopleFilter, string> = { all: 'All', board: 'Board', officers: 'Officers', stockholders: 'Stockholders' };

type Editing =
  | { kind: 'assign'; seat: Seat }
  | { kind: 'new-position' }
  | { kind: 'new'; role: CorporationPersonRole; seat?: Seat }
  | { kind: 'details'; key: string }
  | { kind: 'role'; roleId: number }
  | { kind: 'add-role'; key: string; role: CorporationPersonRole | null }
  | null;

export default function CorporationPeopleTab({
  corporation,
  people,
  files = [],
  onPeopleChange: setPeople,
  onFilesChange: setFiles,
}: Props) {
  const fileViewer = useFileViewer();
  const [editing, setEditing] = useState<Editing>(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<PeopleFilter>('all');
  const isOpc = corporation.companyType === 'OPC';
  const base = `/api/corporation/${corporation.id}/people`;

  const groups = useMemo(() => {
    const gs = groupPeople(people).map((g) => ({ ...g, roles: [...g.roles].sort(byRole) }));
    const lead = (g: PersonGroup) => {
      const cur = g.roles.filter((r) => r.isCurrent);
      return cur.length ? rank(cur[0].role) : 100;
    };
    return gs.sort((a, b) => lead(a) - lead(b) || nameOf(a.person).localeCompare(nameOf(b.person)));
  }, [people]);
  const current = useMemo(() => people.filter((p) => p.isCurrent), [people]);
  const directors = current.filter((p) => p.role === 'Director');
  const checks = useMemo(() => boardChecks(current, isOpc), [current, isOpc]);
  const holderOf = (role: CorporationPersonRole) => current.find((p) => p.role === role) ?? null;

  const filesByKey = useMemo(() => {
    const m = new Map<string, CorporationFile[]>();
    for (const g of groups) {
      const ids = new Set(g.roles.map((r) => r.id));
      const mine = files.filter((f) => f.personId != null && ids.has(f.personId));
      if (mine.length) m.set(g.key, mine);
    }
    return m;
  }, [groups, files]);

  async function call(url: string, method: string, body?: object): Promise<Record<string, unknown> | null> {
    setError('');
    const res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError((data as { error?: string }).error ?? res.statusText);
      return null;
    }
    return data as Record<string, unknown>;
  }

  async function addRole(role: CorporationPersonRole, personRecordId: string, extra: object = {}) {
    const d = await call(base, 'POST', { role, personRecordId, ...extra });
    const saved = d?.person as CorporationPerson | undefined;
    if (saved) setPeople((prev) => applySavedPerson(prev, saved));
    return !!saved;
  }

  async function addPerson(draft: EditablePerson, seat?: Seat) {
    const sitting = seat?.replaces ?? null;
    if (sitting && !(await retire(sitting))) return;
    const d = await call(base, 'POST', { ...identityPayload(draft), ...rolePayload(draft) });
    const saved = d?.person as CorporationPerson | undefined;
    if (!saved) return;
    setPeople((prev) => applySavedPerson(prev, saved));
    setEditing(null);
  }

  async function saveRole(row: CorporationPerson, patch: object) {
    const d = await call(`${base}/${row.id}`, 'PATCH', patch);
    const saved = d?.person as CorporationPerson | undefined;
    if (saved) setPeople((prev) => applySavedPerson(prev, saved));
    return !!saved;
  }

  async function removeRole(row: CorporationPerson, group: PersonGroup) {
    const last = group.roles.length === 1;
    const ok = await confirmAction(
      last
        ? { title: `Remove ${nameOf(row)} from this company?`, confirmLabel: 'Remove', danger: true }
        : { title: `Remove ${nameOf(row)} as ${roleLabel(row)}?`, message: 'Their other roles stay.', confirmLabel: 'Remove', danger: true },
    );
    if (!ok) return;
    if (await call(`${base}/${row.id}`, 'DELETE')) {
      setPeople((prev) => prev.filter((p) => p.id !== row.id));
      setEditing(null);
    }
  }

  async function saveDetails(group: PersonGroup, draft: EditablePerson) {
    if (!group.person.personRecordId) return;
    const d = await call(`${base}/by-person/${group.person.personRecordId}`, 'PATCH', identityPayload(draft));
    const rows = (d?.people as CorporationPerson[] | undefined) ?? [];
    if (!d) return;
    setPeople((prev) => rows.reduce(applySavedPerson, prev));
    setEditing(null);
  }

  const retire = (row: CorporationPerson) => saveRole(row, { isCurrent: false, termEnd: row.termEnd ?? manilaToday() });

  /** Seat someone; whoever held the seat is kept as its former holder. */
  async function assign(seat: Seat, personRecordId: string) {
    if (seat.replaces?.personRecordId === personRecordId) return setEditing(null);
    if (seat.replaces && !(await retire(seat.replaces))) return;
    if (await addRole(seat.role, personRecordId, seat.title ? { positionTitle: seat.title } : {})) setEditing(null);
  }

  async function deleteFile(fileId: number) {
    if (!(await confirmAction({ title: 'Delete this file?', confirmLabel: 'Delete', danger: true }))) return;
    if (await call(`/api/corporation/${corporation.id}/files/${fileId}`, 'DELETE')) {
      setFiles((prev) => prev.filter((f) => f.id !== fileId));
    }
  }

  const requiredSeats: Seat[] = (['President', 'Treasurer', 'Corporate Secretary', ...(isOpc ? (['Nominee', 'Alternate Nominee'] as const) : [])] as CorporationPersonRole[])
    .map((role) => ({ role, title: null, label: role, replaces: holderOf(role) }));
  const customSeats: Seat[] = current
    .filter((p) => CUSTOM_OFFICER_ROLES.has(p.role))
    .sort(byRole)
    .map((p) => ({ role: p.role, title: p.positionTitle, label: roleLabel(p), replaces: p }));
  const boardSeat: Seat = { role: 'Director', title: null, label: 'Board', replaces: null };
  const seat = editing?.kind === 'assign' ? editing.seat : null;
  const sameSeat = (p: CorporationPerson, s: Seat) =>
    p.role === s.role && (p.positionTitle ?? '').toLowerCase() === (s.title ?? '').toLowerCase();
  const candidates = seat
    ? dedupePeople(people).filter(
        (p) => (SHARE_ROLES.has(seat.role) || !p.isJuridical)
          && !current.some((c) => sameSeat(c, seat) && c.personRecordId === p.personRecordId),
      )
    : [];
  const toggleSeat = (s: Seat) =>
    setEditing(seat && seatKey(seat) === seatKey(s) ? null : { kind: 'assign', seat: s });

  const filterCounts = Object.fromEntries(
    (['board', 'officers', 'stockholders'] as const).map((f) => [
      f,
      groups.filter((g) => g.roles.some((r) => r.isCurrent && FILTER_ROLES[f].has(r.role))).length,
    ]),
  ) as Record<Exclude<PeopleFilter, 'all'>, number>;
  const shown = filter === 'all' ? groups : groups.filter((g) => g.roles.some((r) => r.isCurrent && FILTER_ROLES[filter].has(r.role)));

  return (
    <div className="space-y-4">
      {error && (
        <div className="px-3 py-2 text-xs rounded-lg bg-rose-50 dark:bg-rose-500/10 ring-1 ring-inset ring-rose-200 dark:ring-rose-500/30 text-rose-700 dark:text-rose-300">
          {error}
        </div>
      )}

      {/* Board & officers */}
      <Card title="Board & officers" icon={<Crown className="w-4 h-4" />}>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          {!isOpc && (
            <Tile
              label="Board"
              active={seat?.role === 'Director'}
              onClick={() => toggleSeat(boardSeat)}
              actionLabel="Add director"
            >
              {directors.length ? (
                <>
                  <span className="text-[15px] font-semibold text-stone-900 dark:text-stone-50 tabular-nums">{directors.length}</span>
                  <span className="ml-1 text-[12px] text-stone-500 dark:text-stone-400">director{directors.length === 1 ? '' : 's'}</span>
                </>
              ) : (
                <span className="text-[13px] text-stone-400 dark:text-stone-500">None yet</span>
              )}
            </Tile>
          )}
          {[...requiredSeats, ...customSeats].map((s) => {
            const h = s.replaces;
            return (
              <Tile
                key={seatKey(s)}
                label={s.label}
                vacant={!h}
                active={!!seat && seatKey(seat) === seatKey(s)}
                onClick={() => toggleSeat(s)}
                actionLabel={h ? 'Change' : 'Assign'}
              >
                {h ? (
                  <span className="text-[13px] font-medium text-stone-900 dark:text-stone-50 truncate">{nameOf(h)}</span>
                ) : (
                  <span className="text-[13px] text-stone-400 dark:text-stone-500">Vacant</span>
                )}
              </Tile>
            );
          })}
          <button
            type="button"
            onClick={() => setEditing(editing?.kind === 'new-position' ? null : { kind: 'new-position' })}
            className={`press rounded-xl px-3 py-2.5 text-left border border-dashed transition-colors ${
              editing?.kind === 'new-position'
                ? 'border-navy-300 dark:border-navy-400/40 bg-navy-50/60 dark:bg-navy-500/10'
                : 'border-stone-300 dark:border-white/15 hover:border-navy-300 dark:hover:border-navy-400/40'
            }`}
          >
            <span className="text-[10.5px] font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400">Other officer</span>
            <span className="mt-1 flex items-center gap-1 text-[13px] text-navy-700 dark:text-navy-300">
              <Plus className="w-3.5 h-3.5" /> Add position
            </span>
          </button>
        </div>

        {editing?.kind === 'new-position' && (
          <NewPosition
            onCancel={() => setEditing(null)}
            onNext={(title) => setEditing({ kind: 'assign', seat: seatForTitle(title) })}
          />
        )}

        {seat && (
          <div key={seatKey(seat)} className="reveal mt-3 rounded-xl bg-stone-50 dark:bg-white/[0.04] ring-1 ring-inset ring-stone-200 dark:ring-white/10 p-3">
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="text-[12px] font-medium text-stone-700 dark:text-stone-200">
                {seat.role === 'Director' ? 'Add to the board' : `Who is ${seat.label}?`}
                {seat.replaces && (
                  <span className="font-normal text-stone-500 dark:text-stone-400"> — {nameOf(seat.replaces)} will be kept as a former holder</span>
                )}
              </span>
              <button type="button" onClick={() => setEditing(null)} className="p-1 rounded hover:bg-stone-200/60 dark:hover:bg-white/10 text-stone-400">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {candidates.map((p) => (
                <button
                  key={p.personRecordId ?? p.id}
                  type="button"
                  onClick={() => p.personRecordId && assign(seat, p.personRecordId)}
                  className="press inline-flex items-center gap-1.5 pl-1 pr-2.5 py-1 rounded-full bg-white dark:bg-card ring-1 ring-inset ring-stone-200 dark:ring-white/10 text-[12px] text-stone-700 dark:text-stone-200 hover:ring-navy-300 dark:hover:ring-navy-400/40 hover:text-navy-800 dark:hover:text-navy-200 transition-colors"
                >
                  <Avatar person={p} size="sm" />
                  {nameOf(p)}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setEditing({ kind: 'new', role: seat.role, seat })}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full border border-dashed border-stone-300 dark:border-white/20 text-[12px] text-stone-600 dark:text-stone-300 hover:border-navy-400 hover:text-navy-700 dark:hover:text-navy-200"
              >
                <UserPlus className="w-3 h-3" /> Someone new
              </button>
            </div>
          </div>
        )}

        {checks.length > 0 && (
          <ul className="mt-3 space-y-1.5">
            {checks.map((c) => (
              <li key={c} className="reveal flex items-start gap-2 text-[12px] text-amber-800 dark:text-amber-200">
                <AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0 text-amber-500" />
                {c}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* People */}
      <Card
        title="People"
        count={groups.length}
        icon={<Users className="w-4 h-4" />}
        action={
          <button
            type="button"
            onClick={() => setEditing({ kind: 'new', role: 'Stockholder' })}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-[12px] font-medium rounded-lg border border-stone-200 dark:border-white/10 text-stone-700 dark:text-stone-200 hover:bg-stone-50 dark:hover:bg-white/5"
          >
            <Plus className="w-3.5 h-3.5" /> Add person
          </button>
        }
      >
        {editing?.kind === 'new' && (
          <div className="reveal mb-3">
            <PersonEditor
              title={editing.seat ? `New person — ${editing.seat.label}` : 'New person'}
              initial={{ ...emptyEditable(editing.role), positionTitle: editing.seat?.title ?? '' }}
              roleOptions={editing.seat ? [editing.role] : ROLE_ORDER}
              onCancel={() => setEditing(null)}
              onSave={(d) => addPerson(d, editing.seat)}
            />
          </div>
        )}
        {groups.length > 0 && (
          <div className="mb-3 inline-flex p-0.5 rounded-lg bg-stone-100 dark:bg-white/[0.06] text-[12px]">
            {(['all', 'board', 'officers', 'stockholders'] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={`press inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-all ${
                  filter === f
                    ? 'bg-white dark:bg-card shadow-sm text-stone-900 dark:text-stone-50 font-medium'
                    : 'text-stone-500 dark:text-stone-400 hover:text-stone-800 dark:hover:text-stone-100'
                }`}
              >
                {FILTER_LABEL[f]}
                <span className="tabular-nums text-[10.5px] text-stone-400 dark:text-stone-500">{f === 'all' ? groups.length : filterCounts[f]}</span>
              </button>
            ))}
          </div>
        )}
        {groups.length === 0 && editing?.kind !== 'new' ? (
          <div className="rounded-xl border border-dashed border-stone-200 dark:border-white/10 px-6 py-10 text-center">
            <Users className="w-6 h-6 mx-auto text-stone-300 dark:text-stone-600" />
            <p className="mt-2 text-sm text-stone-600 dark:text-stone-300">No one recorded yet.</p>
            <p className="text-[12px] text-stone-400 dark:text-stone-500">Add the incorporators, directors and officers.</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {shown.length === 0 && (
              <li className="px-1 py-4 text-[13px] text-stone-400 dark:text-stone-500">No one in this group.</li>
            )}
            {shown.map((g, i) => (
              <li key={g.key} id={`person-${g.key}`} className="rise-in" style={{ '--i': i } as React.CSSProperties}>
                <PersonCard
                  group={g}
                  corporationId={corporation.id}
                  files={filesByKey.get(g.key) ?? []}
                  editing={editing}
                  setEditing={setEditing}
                  onSaveDetails={(d) => saveDetails(g, d)}
                  onSaveRole={async (row, d) => { if (await saveRole(row, rolePayload(d))) setEditing(null); }}
                  onRemoveRole={(row) => removeRole(row, g)}
                  onAddRole={async (role, d) => {
                    if (!g.person.personRecordId) return;
                    if (await addRole(role, g.person.personRecordId, d ? rolePayload(d) : {})) setEditing(null);
                  }}
                  onUploaded={(f) => setFiles((prev) => [...prev, f])}
                  onPreview={(f) => fileViewer.preview(f.name, f.storagePath)}
                  onDownload={(f) => fileViewer.download(f.name, f.storagePath)}
                  onDeleteFile={deleteFile}
                />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Shareholdings
        groups={groups}
        onOpen={(row) => {
          setEditing({ kind: 'role', roleId: row.id });
          const g = groups.find((x) => x.roles.some((r) => r.id === row.id));
          if (g) document.getElementById(`person-${g.key}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }}
      />

      {fileViewer.viewer}
    </div>
  );
}

// ---- Layout pieces ----

function Card({ title, icon, count, action, children }: {
  title: string;
  icon: React.ReactNode;
  count?: number;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-stone-200 dark:border-white/10 bg-white dark:bg-card">
      <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-3">
        <h3 className="inline-flex items-center gap-2 text-[13px] font-semibold text-stone-800 dark:text-stone-100">
          <span className="text-stone-400 dark:text-stone-500">{icon}</span>
          {title}
          {count !== undefined && (
            <span className="px-1.5 py-px rounded-full text-[10px] font-medium tabular-nums bg-stone-100 text-stone-500 dark:bg-white/10 dark:text-stone-400">{count}</span>
          )}
        </h3>
        {action}
      </div>
      <div className="px-5 pb-5">{children}</div>
    </section>
  );
}

function Tile({ label, vacant, active, onClick, actionLabel, children }: {
  label: string;
  vacant?: boolean;
  active?: boolean;
  onClick: () => void;
  actionLabel: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`press group text-left rounded-xl px-3 py-2.5 transition-all ${
        active
          ? 'ring-1 ring-inset ring-navy-300 dark:ring-navy-400/40 bg-navy-50/60 dark:bg-navy-500/10'
          : vacant
            ? 'border border-dashed border-stone-300 dark:border-white/15 hover:border-navy-300 dark:hover:border-navy-400/40'
            : 'ring-1 ring-inset ring-stone-200 dark:ring-white/10 hover:ring-stone-300 dark:hover:ring-white/20'
      }`}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="text-[10.5px] font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400">{label}</span>
        <span className={`text-[11px] text-navy-700 dark:text-navy-300 transition-opacity ${active || vacant ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
          {actionLabel}
        </span>
      </span>
      <span className="mt-1 flex items-baseline min-w-0">{children}</span>
    </button>
  );
}

const AVATAR_TONES = [
  'bg-navy-100 text-navy-800 dark:bg-navy-500/20 dark:text-navy-100',
  'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-100',
  'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-100',
  'bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-100',
  'bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-100',
  'bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-100',
];

function Avatar({ person, size = 'md' }: { person: CorporationPerson; size?: 'sm' | 'md' }) {
  const key = person.personRecordId ?? String(person.id);
  const tone = AVATAR_TONES[[...key].reduce((n, ch) => n + ch.charCodeAt(0), 0) % AVATAR_TONES.length];
  const dims = size === 'sm' ? 'w-5 h-5 text-[9px]' : 'w-9 h-9 text-[12px]';
  if (person.isJuridical) {
    return (
      <span className={`${dims} shrink-0 rounded-full inline-flex items-center justify-center ${tone}`}>
        <Building2 className={size === 'sm' ? 'w-3 h-3' : 'w-4 h-4'} />
      </span>
    );
  }
  const initials = [person.firstName, person.lastName].map((s) => s.trim()[0] ?? '').join('').toUpperCase() || '?';
  return <span className={`${dims} shrink-0 rounded-full inline-flex items-center justify-center font-semibold ${tone}`}>{initials}</span>;
}

// ---- One person ----

function PersonCard({
  group, corporationId, files, editing, setEditing,
  onSaveDetails, onSaveRole, onRemoveRole, onAddRole, onUploaded, onPreview, onDownload, onDeleteFile,
}: {
  group: PersonGroup;
  corporationId: string;
  files: CorporationFile[];
  editing: Editing;
  setEditing: (e: Editing) => void;
  onSaveDetails: (d: EditablePerson) => Promise<void>;
  onSaveRole: (row: CorporationPerson, d: EditablePerson) => Promise<void>;
  onRemoveRole: (row: CorporationPerson) => void;
  onAddRole: (role: CorporationPersonRole, d?: EditablePerson) => Promise<void>;
  onUploaded: (f: CorporationFile) => void;
  onPreview: (f: CorporationFile) => void;
  onDownload: (f: CorporationFile) => void;
  onDeleteFile: (id: number) => void;
}) {
  const p = group.person;
  const currentRoles = group.roles.filter((r) => r.isCurrent);
  const formerRoles = group.roles.filter((r) => !r.isCurrent);
  const holding = holdingOf(group);
  const editingDetails = editing?.kind === 'details' && editing.key === group.key;
  const editingRole = editing?.kind === 'role' ? group.roles.find((r) => r.id === editing.roleId) ?? null : null;
  const addingRole = editing?.kind === 'add-role' && editing.key === group.key ? editing : null;
  const held = new Set(currentRoles.filter((r) => r.role !== 'Officer').map((r) => r.role));
  const addable = ROLE_ORDER.filter((r) => !held.has(r) && (SHARE_ROLES.has(r) || !p.isJuridical));
  const [showFiles, setShowFiles] = useState(false);

  const meta = p.isJuridical
    ? [p.entityType, p.entityRegistrationNo && `Reg ${p.entityRegistrationNo}`, p.nationality, p.tin && `TIN ${p.tin}`]
    : [p.nationality, p.tin && `TIN ${p.tin}`, p.passportNumber && `Passport ${p.passportNumber}`, p.esapNo && `ESAP ${p.esapNo}`];

  return (
    <div className={`rounded-xl ring-1 ring-inset transition-colors ${
      editingDetails || editingRole || addingRole
        ? 'ring-navy-200 dark:ring-navy-400/30 bg-navy-50/30 dark:bg-navy-500/[0.04]'
        : 'ring-stone-200 dark:ring-white/10'
    } ${currentRoles.length ? '' : 'opacity-70'}`}>
      <div className="flex items-start gap-3 p-3.5">
        <Avatar person={p} />
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm font-semibold text-stone-900 dark:text-stone-50">{nameOf(p)}</span>
            {p.isJuridical && (
              <span className="text-[10px] uppercase tracking-wider text-stone-400 dark:text-stone-500">Juridical</span>
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap gap-x-2.5 text-[11.5px] text-stone-500 dark:text-stone-400">
            {meta.filter(Boolean).map((m) => <span key={m as string}>{m}</span>)}
            {!meta.some(Boolean) && <span className="text-stone-400 dark:text-stone-500">No details yet</span>}
          </div>
          {p.isJuridical && p.representativeName && (
            <div className="mt-0.5 text-[11.5px] text-stone-500 dark:text-stone-400">
              Represented by <span className="text-stone-700 dark:text-stone-200">{p.representativeName}</span>
              {p.representativeTitle ? `, ${p.representativeTitle}` : ''}
            </div>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {currentRoles.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setEditing(editingRole?.id === r.id ? null : { kind: 'role', roleId: r.id })}
                className={`press px-2 py-0.5 rounded-md ring-1 ring-inset text-[11px] font-medium transition-shadow ${ROLE_TONE[r.role]} ${
                  editingRole?.id === r.id ? 'shadow-[0_0_0_2px_rgba(185, 143, 69,0.35)]' : 'hover:shadow-sm'
                }`}
                title="Edit this role"
              >
                {roleLabel(r)}
              </button>
            ))}
            {formerRoles.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setEditing(editingRole?.id === r.id ? null : { kind: 'role', roleId: r.id })}
                className="px-2 py-0.5 rounded-md text-[11px] text-stone-400 dark:text-stone-500 line-through decoration-stone-300 dark:decoration-stone-600 hover:text-stone-600 dark:hover:text-stone-300"
                title="Former role"
              >
                {roleLabel(r)}{formatTermRange(r.termStart, r.termEnd) ? ` · ${formatTermRange(r.termStart, r.termEnd)}` : ''}
              </button>
            ))}
            <RoleMenu
              roles={addable}
              onPick={(role) => (FORM_ROLES.has(role) ? setEditing({ kind: 'add-role', key: group.key, role }) : onAddRole(role))}
            />
          </div>

          {holding && (holding.sharesSubscribedAmount != null || holding.sharesSubscribedCount != null) && (
            <div className="mt-2 text-[12px] text-stone-600 dark:text-stone-300 tabular-nums">
              {holding.sharesSubscribedCount != null && <>{count(holding.sharesSubscribedCount)} {holding.shareClass || 'shares'} · </>}
              {peso(holding.sharesSubscribedAmount)} subscribed · {peso(holding.sharesPaidAmount)} paid
            </div>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => setShowFiles((s) => !s)}
            className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11.5px] ${
              files.length ? 'text-stone-600 dark:text-stone-300' : 'text-stone-400 dark:text-stone-500'
            } hover:bg-stone-100 dark:hover:bg-white/5`}
            title="ID copies and other files"
          >
            <Paperclip className="w-3.5 h-3.5" />
            {files.length || ''}
          </button>
          <button
            type="button"
            onClick={() => setEditing(editingDetails ? null : { kind: 'details', key: group.key })}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11.5px] text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-white/5"
          >
            <Pencil className="w-3.5 h-3.5" /> Details
          </button>
        </div>
      </div>

      {editingDetails && (
        <div className="reveal px-3.5 pb-3.5">
          <PersonEditor
            title={currentRoles.length > 1 || group.roles.length > 1 ? 'Details — shared by all their roles' : 'Details'}
            initial={toEditable(p)}
            detailsOnly
            onCancel={() => setEditing(null)}
            onSave={onSaveDetails}
          />
        </div>
      )}
      {editingRole && (
        <div className="reveal px-3.5 pb-3.5">
          <RoleEditor
            row={editingRole}
            onCancel={() => setEditing(null)}
            onSave={(d) => onSaveRole(editingRole, d)}
            onRemove={() => onRemoveRole(editingRole)}
          />
        </div>
      )}
      {addingRole?.role && (
        <div className="reveal px-3.5 pb-3.5">
          <RoleEditor
            row={null}
            role={addingRole.role}
            onCancel={() => setEditing(null)}
            onSave={(d) => onAddRole(addingRole.role!, d)}
          />
        </div>
      )}
      {(showFiles || files.length > 0) && (showFiles || editingDetails) && (
        <div className="reveal px-3.5 pb-3.5">
          <div className="rounded-lg bg-stone-50 dark:bg-white/[0.04] p-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-stone-500 dark:text-stone-400">
                {files.length ? `${files.length} file${files.length === 1 ? '' : 's'}` : 'No ID copy yet'}
              </span>
              <PersonAttachButton corporationId={corporationId} personId={group.roles[0].id} onUploaded={(f) => f && onUploaded(f)} />
            </div>
            {files.length > 0 && (
              <ul className="mt-2 space-y-1">
                {files.map((f) => (
                  <li key={f.id} className="flex items-center gap-2 px-2 py-1 text-xs rounded-md bg-white dark:bg-card ring-1 ring-inset ring-stone-200 dark:ring-white/10">
                    <Paperclip className="w-3 h-3 text-stone-400 dark:text-stone-500 shrink-0" />
                    <span className="flex-1 truncate text-stone-700 dark:text-stone-200" title={f.name}>{f.name}</span>
                    <span className="text-[10px] text-stone-400 dark:text-stone-500">{f.category}</span>
                    <button onClick={() => onPreview(f)} className="p-1 text-stone-400 dark:text-stone-500 hover:text-navy-700 dark:hover:text-navy-300" title="Preview">
                      <Eye className="w-3 h-3" />
                    </button>
                    <button onClick={() => onDownload(f)} className="p-1 text-stone-400 dark:text-stone-500 hover:text-navy-700 dark:hover:text-navy-300" title="Download">
                      <Download className="w-3 h-3" />
                    </button>
                    <button onClick={() => onDeleteFile(f.id)} className="p-1 text-stone-400 dark:text-stone-500 hover:text-rose-600 dark:hover:text-rose-400" title="Delete">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function RoleMenu({ roles, onPick }: { roles: CorporationPersonRole[]; onPick: (r: CorporationPersonRole) => void }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  if (!roles.length) return null;
  return (
    <>
      <button
        type="button"
        ref={anchorRef}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[11px] text-stone-500 dark:text-stone-400 border border-dashed border-stone-300 dark:border-white/15 hover:text-navy-700 dark:hover:text-navy-200 hover:border-navy-300 dark:hover:border-navy-400/60"
      >
        <Plus className="w-3 h-3" /> Role
      </button>
      {open && (
        <CellDropdown
          mode="single"
          value={null}
          options={roles.map((r) => ({ id: r, label: r }))}
          onSelect={(id) => { setOpen(false); if (id) onPick(id as CorporationPersonRole); }}
          onClose={() => setOpen(false)}
          anchorRef={anchorRef}
        />
      )}
    </>
  );
}

function NewPosition({ onCancel, onNext }: { onCancel: () => void; onNext: (title: string) => void }) {
  const [title, setTitle] = useState('');
  const go = () => title.trim() && onNext(title);
  return (
    <div className="reveal mt-3 rounded-xl bg-stone-50 dark:bg-white/[0.04] ring-1 ring-inset ring-stone-200 dark:ring-white/10 p-3">
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-[12px] font-medium text-stone-700 dark:text-stone-200">What is the position?</span>
        <button type="button" onClick={onCancel} className="p-1 rounded hover:bg-stone-200/60 dark:hover:bg-white/10 text-stone-400">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="flex items-center gap-2">
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') go(); if (e.key === 'Escape') onCancel(); }}
          placeholder="e.g. Vice President for Operations"
          className="flex-1 px-3 py-1.5 text-sm border border-stone-300 dark:border-white/15 rounded-lg bg-white dark:bg-card text-stone-900 dark:text-stone-100 outline-none focus:border-navy-600 dark:focus:border-navy-400"
        />
        <button
          type="button"
          onClick={go}
          disabled={!title.trim()}
          className="px-3 py-1.5 text-xs font-medium rounded-lg bg-navy-800 text-white hover:bg-navy-700 dark:bg-navy-600 dark:hover:bg-navy-500 disabled:opacity-50"
        >
          Choose who
        </button>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {POSITION_SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onNext(s)}
            className="px-2 py-0.5 rounded-full text-[11.5px] bg-white dark:bg-card ring-1 ring-inset ring-stone-200 dark:ring-white/10 text-stone-600 dark:text-stone-300 hover:ring-navy-300 hover:text-navy-800 dark:hover:text-navy-200"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---- Shareholdings ----

function Shareholdings({ groups, onOpen }: { groups: PersonGroup[]; onOpen: (row: CorporationPerson) => void }) {
  const rows = groups
    .map((g) => ({ g, h: holdingOf(g) }))
    .filter((x): x is { g: PersonGroup; h: CorporationPerson } => !!x.h)
    .sort((a, b) => (b.h.sharesSubscribedAmount ?? 0) - (a.h.sharesSubscribedAmount ?? 0));
  if (!rows.length) return null;
  const total = rows.reduce((n, x) => n + (x.h.sharesSubscribedAmount ?? 0), 0);
  const paid = rows.reduce((n, x) => n + (x.h.sharesPaidAmount ?? 0), 0);
  const shares = rows.some((x) => x.h.sharesSubscribedCount != null)
    ? rows.reduce((n, x) => n + (x.h.sharesSubscribedCount ?? 0), 0)
    : null;

  return (
    <Card title="Shareholdings" count={rows.length} icon={<PieChart className="w-4 h-4" />}>
      <div className="overflow-x-auto -mx-1">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="text-[10.5px] uppercase tracking-wider text-stone-400 dark:text-stone-500">
              <th className="text-left font-semibold px-1 pb-2">Holder</th>
              <th className="text-left font-semibold px-1 pb-2">Class</th>
              <th className="text-right font-semibold px-1 pb-2">Shares</th>
              <th className="text-right font-semibold px-1 pb-2">Subscribed</th>
              <th className="text-right font-semibold px-1 pb-2">Paid up</th>
              <th className="text-right font-semibold px-1 pb-2 w-32">Ownership</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ g, h }) => {
              const pct = total > 0 ? ((h.sharesSubscribedAmount ?? 0) / total) * 100 : 0;
              return (
                <tr
                  key={g.key}
                  onClick={() => onOpen(h)}
                  className="cursor-pointer border-t border-stone-100 dark:border-white/[0.06] hover:bg-stone-50 dark:hover:bg-white/[0.03]"
                >
                  <td className="px-1 py-2">
                    <span className="inline-flex items-center gap-2 min-w-0">
                      <Avatar person={g.person} size="sm" />
                      <span className="truncate text-stone-800 dark:text-stone-100">{nameOf(g.person)}</span>
                    </span>
                  </td>
                  <td className="px-1 py-2 text-stone-500 dark:text-stone-400">{h.shareClass || '—'}</td>
                  <td className="px-1 py-2 text-right tabular-nums text-stone-700 dark:text-stone-200">{count(h.sharesSubscribedCount)}</td>
                  <td className="px-1 py-2 text-right tabular-nums text-stone-700 dark:text-stone-200">{peso(h.sharesSubscribedAmount)}</td>
                  <td className="px-1 py-2 text-right tabular-nums text-stone-700 dark:text-stone-200">{peso(h.sharesPaidAmount)}</td>
                  <td className="px-1 py-2">
                    <span className="flex items-center justify-end gap-2">
                      <span className="w-16 h-1.5 rounded-full bg-stone-100 dark:bg-white/10 overflow-hidden">
                        <span className="grow-x block h-full rounded-full bg-navy-500 dark:bg-navy-300" style={{ width: `${pct}%` }} />
                      </span>
                      <span className="w-12 text-right tabular-nums text-stone-700 dark:text-stone-200">{pct.toFixed(pct < 10 && pct > 0 ? 1 : 0)}%</span>
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-stone-200 dark:border-white/10 font-semibold text-stone-800 dark:text-stone-100">
              <td className="px-1 pt-2" colSpan={2}>Total</td>
              <td className="px-1 pt-2 text-right tabular-nums">{count(shares)}</td>
              <td className="px-1 pt-2 text-right tabular-nums">{peso(total)}</td>
              <td className="px-1 pt-2 text-right tabular-nums">{peso(paid)}</td>
              <td className="px-1 pt-2 text-right tabular-nums text-stone-500 dark:text-stone-400 font-normal">
                {total > 0 ? `${((paid / total) * 100).toFixed(0)}% paid` : ''}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </Card>
  );
}

// ---- Editors ----

interface EditablePerson {
  role: CorporationPersonRole;
  isJuridical: boolean;
  firstName: string;
  lastName: string;
  nationality: string;
  gender: string;
  residentialAddress: string;
  tin: string;
  passportNumber: string;
  esapNo: string;
  entityName: string;
  entityType: string;
  entityRegistrationNo: string;
  representativeName: string;
  representativeTitle: string;
  positionTitle: string;
  shareClass: string;
  sharesSubscribedCount: string;
  sharesSubscribedAmount: string;
  sharesPaidAmount: string;
  termStart: string;
  termEnd: string;
  isCurrent: boolean;
}

function emptyEditable(role: CorporationPersonRole): EditablePerson {
  return {
    role,
    isJuridical: false,
    firstName: '', lastName: '', nationality: '', gender: '',
    residentialAddress: '', tin: '', passportNumber: '', esapNo: '',
    entityName: '', entityType: '', entityRegistrationNo: '',
    representativeName: '', representativeTitle: '',
    positionTitle: '',
    shareClass: '', sharesSubscribedCount: '',
    sharesSubscribedAmount: '', sharesPaidAmount: '',
    termStart: '', termEnd: '', isCurrent: true,
  };
}

function formatTermRange(start: string | null, end: string | null): string | null {
  const s = start ? start.slice(0, 4) : null;
  const e = end ? end.slice(0, 4) : null;
  if (s && e) return s === e ? s : `${s}–${e}`;
  if (s) return `since ${s}`;
  if (e) return `until ${e}`;
  return null;
}

function toEditable(p: CorporationPerson): EditablePerson {
  return {
    role: p.role,
    isJuridical: p.isJuridical,
    firstName: p.firstName,
    lastName: p.lastName,
    nationality: p.nationality ?? '',
    gender: p.gender ?? '',
    residentialAddress: p.residentialAddress ?? '',
    tin: p.tin ?? '',
    passportNumber: p.passportNumber ?? '',
    esapNo: p.esapNo ?? '',
    entityName: p.entityName ?? '',
    entityType: p.entityType ?? '',
    entityRegistrationNo: p.entityRegistrationNo ?? '',
    representativeName: p.representativeName ?? '',
    representativeTitle: p.representativeTitle ?? '',
    positionTitle: p.positionTitle ?? '',
    shareClass: p.shareClass ?? '',
    sharesSubscribedCount: p.sharesSubscribedCount?.toString() ?? '',
    sharesSubscribedAmount: p.sharesSubscribedAmount?.toString() ?? '',
    sharesPaidAmount: p.sharesPaidAmount?.toString() ?? '',
    termStart: p.termStart ?? '',
    termEnd: p.termEnd ?? '',
    isCurrent: p.isCurrent,
  };
}

/** The person's own details — cleared to null on the side (natural / juridical) that doesn't apply. */
function identityPayload(d: EditablePerson) {
  return {
    isJuridical: d.isJuridical,
    firstName: d.isJuridical ? '' : d.firstName.trim(),
    lastName: d.isJuridical ? '' : d.lastName.trim(),
    gender: d.isJuridical ? null : (d.gender || null),
    passportNumber: d.isJuridical ? null : (d.passportNumber || null),
    esapNo: d.isJuridical ? null : (d.esapNo || null),
    nationality: d.nationality || null,
    residentialAddress: d.residentialAddress || null,
    tin: d.tin || null,
    entityName: d.isJuridical ? (d.entityName.trim() || null) : null,
    entityType: d.isJuridical ? (d.entityType || null) : null,
    entityRegistrationNo: d.isJuridical ? (d.entityRegistrationNo || null) : null,
    representativeName: d.isJuridical ? (d.representativeName || null) : null,
    representativeTitle: d.isJuridical ? (d.representativeTitle || null) : null,
  };
}

/** What a role carries: its title, term, and — for a shareholder — the holding. */
function rolePayload(d: EditablePerson) {
  const shares = SHARE_ROLES.has(d.role);
  return {
    role: d.role,
    positionTitle: TITLED_ROLES.has(d.role) ? (d.positionTitle.trim() || null) : null,
    shareClass: shares ? (d.shareClass.trim() || null) : null,
    sharesSubscribedCount: shares ? parseAmount(d.sharesSubscribedCount) : null,
    sharesSubscribedAmount: shares ? parseAmount(d.sharesSubscribedAmount) : null,
    sharesPaidAmount: shares ? parseAmount(d.sharesPaidAmount) : null,
    termStart: d.termStart || null,
    termEnd: d.termEnd || null,
    isCurrent: d.isCurrent,
  };
}

function EditorShell({ title, onCancel, busy, children, footer }: {
  title: React.ReactNode;
  onCancel: () => void;
  busy: boolean;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <div className="rounded-xl bg-white dark:bg-card ring-1 ring-inset ring-stone-200 dark:ring-white/10 p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[12px] font-semibold text-stone-700 dark:text-stone-200">{title}</div>
        <button type="button" onClick={onCancel} disabled={busy} className="p-1 rounded hover:bg-stone-100 dark:hover:bg-white/10 text-stone-400 dark:text-stone-500">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      {children}
      <div className="flex items-center justify-end gap-2 pt-1">{footer}</div>
    </div>
  );
}

function SaveButtons({ busy, disabled, onCancel, onSave }: { busy: boolean; disabled?: boolean; onCancel: () => void; onSave: () => void }) {
  return (
    <>
      <button
        type="button"
        onClick={onCancel}
        disabled={busy}
        className="px-3 py-1.5 text-xs font-medium text-stone-700 dark:text-stone-200 hover:bg-stone-100 dark:hover:bg-white/10 rounded-lg"
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={onSave}
        disabled={busy || disabled}
        className="px-3 py-1.5 text-xs font-medium rounded-lg bg-navy-800 text-white hover:bg-navy-700 dark:bg-navy-600 dark:hover:bg-navy-500 disabled:opacity-50"
      >
        {busy ? 'Saving…' : 'Save'}
      </button>
    </>
  );
}

/** A new person (identity and first role), or — with `detailsOnly` — a person's details. */
function PersonEditor({ title, initial, roleOptions = [], detailsOnly, onCancel, onSave }: {
  title: string;
  initial: EditablePerson;
  roleOptions?: CorporationPersonRole[];
  detailsOnly?: boolean;
  onCancel: () => void;
  onSave: (draft: EditablePerson) => Promise<void>;
}) {
  const [draft, setDraft] = useState<EditablePerson>(initial);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof EditablePerson>(k: K, v: EditablePerson[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const allowJuridical = detailsOnly ? initial.isJuridical || SHARE_ROLES.has(initial.role) : SHARE_ROLES.has(draft.role);
  const hasName = draft.isJuridical ? !!draft.entityName.trim() : !!(draft.firstName.trim() || draft.lastName.trim());

  async function submit() {
    setBusy(true);
    await onSave(draft);
    setBusy(false);
  }

  return (
    <EditorShell
      title={title}
      onCancel={onCancel}
      busy={busy}
      footer={<SaveButtons busy={busy} disabled={!hasName} onCancel={onCancel} onSave={submit} />}
    >
      {!detailsOnly && roleOptions.length > 1 && (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-stone-500 dark:text-stone-400">As</span>
          <SelectDropdown
            value={draft.role}
            options={roleOptions}
            onSelect={(v) => {
              if (!v) return;
              const role = v as CorporationPersonRole;
              setDraft((d) => ({ ...d, role, isJuridical: SHARE_ROLES.has(role) ? d.isJuridical : false }));
            }}
            disabled={busy}
            className="inline-flex items-center gap-1 px-2 py-1 text-xs border border-stone-300 dark:border-white/15 rounded-lg bg-white dark:bg-card"
          />
        </div>
      )}
      {allowJuridical && (
        <div className="inline-flex p-0.5 rounded-lg bg-stone-100 dark:bg-white/[0.06] text-[12px]">
          {[false, true].map((j) => (
            <button
              key={String(j)}
              type="button"
              onClick={() => set('isJuridical', j)}
              className={`px-2.5 py-1 rounded-md transition-all ${draft.isJuridical === j ? 'bg-white dark:bg-card shadow-sm text-stone-900 dark:text-stone-50 font-medium' : 'text-stone-500 dark:text-stone-400'}`}
            >
              {j ? 'Juridical entity' : 'Natural person'}
            </button>
          ))}
        </div>
      )}
      <IdentityFields draft={draft} set={set} busy={busy} />
      {!detailsOnly && <RoleFields draft={draft} set={set} />}
    </EditorShell>
  );
}

function RoleEditor({ row, role, onCancel, onSave, onRemove }: {
  row: CorporationPerson | null;
  role?: CorporationPersonRole;
  onCancel: () => void;
  onSave: (d: EditablePerson) => Promise<void>;
  onRemove?: () => void;
}) {
  const [draft, setDraft] = useState<EditablePerson>(row ? toEditable(row) : emptyEditable(role ?? 'Director'));
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof EditablePerson>(k: K, v: EditablePerson[K]) => setDraft((d) => ({ ...d, [k]: v }));
  async function submit() {
    setBusy(true);
    await onSave(draft);
    setBusy(false);
  }
  const roleOptions: CorporationPersonRole[] | null = SHARE_ROLES.has(draft.role) ? ['Incorporator', 'Stockholder'] : null;

  return (
    <EditorShell
      title={
        <span className="inline-flex items-center gap-2">
          {row ? 'Role' : 'New role'}
          {roleOptions ? (
            <SelectDropdown
              value={draft.role}
              options={roleOptions}
              onSelect={(v) => v && set('role', v as CorporationPersonRole)}
              disabled={busy}
              className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-normal border border-stone-300 dark:border-white/15 rounded-lg bg-white dark:bg-card"
            />
          ) : (
            <span className={`px-2 py-0.5 rounded-md ring-1 ring-inset text-[11px] font-medium ${ROLE_TONE[draft.role]}`}>{draft.role}</span>
          )}
        </span>
      }
      onCancel={onCancel}
      busy={busy}
      footer={
        <>
          {onRemove && (
            <button
              type="button"
              onClick={onRemove}
              disabled={busy}
              className="mr-auto inline-flex items-center gap-1 px-2 py-1.5 text-xs text-stone-500 dark:text-stone-400 hover:text-rose-600 dark:hover:text-rose-400"
            >
              <Trash2 className="w-3.5 h-3.5" /> Remove role
            </button>
          )}
          <SaveButtons busy={busy} disabled={TITLED_ROLES.has(draft.role) && !draft.positionTitle.trim()} onCancel={onCancel} onSave={submit} />
        </>
      }
    >
      <RoleFields draft={draft} set={set} />
    </EditorShell>
  );
}

type Setter = <K extends keyof EditablePerson>(k: K, v: EditablePerson[K]) => void;

function IdentityFields({ draft, set, busy }: { draft: EditablePerson; set: Setter; busy: boolean }) {
  if (draft.isJuridical) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="md:col-span-2">
          <EditField label="Entity name" value={draft.entityName} onChange={(v) => set('entityName', v)} />
        </div>
        <div>
          <span className="block text-xs font-medium text-stone-600 dark:text-stone-300 mb-1">Entity type</span>
          <SelectDropdown
            value={draft.entityType}
            options={['Corporation', 'Partnership', 'Association', 'Cooperative', 'Other']}
            onSelect={(v) => set('entityType', v ?? '')}
            disabled={busy}
            placeholder="— Select —"
            className="w-full px-3 py-2 text-sm border border-stone-300 dark:border-white/15 rounded-lg bg-white dark:bg-card text-left flex items-center justify-between gap-2"
          />
        </div>
        <EditField label="SEC / DTI registration no." value={draft.entityRegistrationNo} onChange={(v) => set('entityRegistrationNo', v)} mono />
        <EditField label="Nationality (country of incorporation)" value={draft.nationality} onChange={(v) => set('nationality', v)} />
        <EditField label="TIN" value={draft.tin} onChange={(v) => set('tin', v)} mono />
        <div className="md:col-span-2">
          <EditField label="Principal office address" value={draft.residentialAddress} onChange={(v) => set('residentialAddress', v)} textarea />
        </div>
        <EditField label="Authorized representative" value={draft.representativeName} onChange={(v) => set('representativeName', v)} />
        <EditField label="Representative's title" value={draft.representativeTitle} onChange={(v) => set('representativeTitle', v)} />
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      <EditField label="First name" value={draft.firstName} onChange={(v) => set('firstName', v)} />
      <EditField label="Last name" value={draft.lastName} onChange={(v) => set('lastName', v)} />
      <EditField label="Nationality" value={draft.nationality} onChange={(v) => set('nationality', v)} />
      <EditField label="Gender" value={draft.gender} onChange={(v) => set('gender', v)} />
      <EditField label="TIN" value={draft.tin} onChange={(v) => set('tin', v)} mono />
      <EditField label="Passport no." value={draft.passportNumber} onChange={(v) => set('passportNumber', v)} mono />
      <EditField label="ESAP no." value={draft.esapNo} onChange={(v) => set('esapNo', v)} mono />
      <div className="md:col-span-2">
        <EditField label="Residential address" value={draft.residentialAddress} onChange={(v) => set('residentialAddress', v)} textarea />
      </div>
    </div>
  );
}

function RoleFields({ draft, set }: { draft: EditablePerson; set: Setter }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {TITLED_ROLES.has(draft.role) && (
        <div className="md:col-span-2">
          <EditField label="Position title (e.g. Vice President, Asst. Corporate Secretary)" value={draft.positionTitle} onChange={(v) => set('positionTitle', v)} />
        </div>
      )}
      {SHARE_ROLES.has(draft.role) && (
        <>
          <EditField label="Share class" value={draft.shareClass} onChange={(v) => set('shareClass', v)} />
          <EditField label="No. of shares subscribed" value={draft.sharesSubscribedCount} onChange={(v) => set('sharesSubscribedCount', v)} mono />
          <EditField label="Subscribed (PHP)" value={draft.sharesSubscribedAmount} onChange={(v) => set('sharesSubscribedAmount', v)} mono />
          <EditField label="Paid up (PHP)" value={draft.sharesPaidAmount} onChange={(v) => set('sharesPaidAmount', v)} mono />
        </>
      )}
      <div>
        <span className="block text-xs font-medium text-stone-600 dark:text-stone-300 mb-1">Term start</span>
        <DatePickerInput value={draft.termStart || null} onChange={(v) => set('termStart', v ?? '')} />
      </div>
      <div>
        <span className="block text-xs font-medium text-stone-600 dark:text-stone-300 mb-1">Term end</span>
        <DatePickerInput value={draft.termEnd || null} onChange={(v) => set('termEnd', v ?? '')} />
      </div>
      <label className="md:col-span-2 inline-flex items-center gap-1.5 text-xs cursor-pointer">
        <input type="checkbox" checked={draft.isCurrent} onChange={(e) => set('isCurrent', e.target.checked)} />
        <span className="text-stone-700 dark:text-stone-200">Current — uncheck to keep this as a past term</span>
      </label>
    </div>
  );
}

function SelectDropdown({
  value, options, onSelect, disabled, placeholder, className,
}: {
  value: string;
  options: readonly string[];
  onSelect: (v: string | null) => void;
  disabled?: boolean;
  placeholder?: string;
  className: string;
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        type="button"
        ref={anchorRef}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={`${className} disabled:opacity-50`}
      >
        <span className={`truncate ${value ? '' : 'text-stone-400 dark:text-stone-500'}`}>{value || placeholder || '— Select —'}</span>
        <ChevronDown className="w-3 h-3 text-stone-400 dark:text-stone-500 shrink-0" />
      </button>
      {open && (
        <CellDropdown
          mode="single"
          value={value || null}
          options={options.map((o) => ({ id: o, label: o }))}
          onSelect={(id) => { onSelect(id); setOpen(false); }}
          onClose={() => setOpen(false)}
          anchorRef={anchorRef}
        />
      )}
    </>
  );
}

function EditField({
  label, value, onChange, textarea, mono,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  textarea?: boolean;
  mono?: boolean;
}) {
  const cls = `w-full px-3 py-2 text-sm border border-stone-300 dark:border-white/15 rounded-lg bg-white dark:bg-card text-stone-900 dark:text-stone-100 outline-none focus:border-navy-600 dark:focus:border-navy-400 ${mono ? 'font-mono' : ''}`;
  return (
    <label className="block">
      <span className="block text-xs font-medium text-stone-600 dark:text-stone-300 mb-1">{label}</span>
      {textarea ? (
        <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={2} className={cls} />
      ) : (
        <input type="text" value={value} onChange={(e) => onChange(e.target.value)} className={cls} />
      )}
    </label>
  );
}

function PersonAttachButton({ corporationId, personId, onUploaded }: {
  corporationId: string;
  personId: number;
  onUploaded: (uploaded: CorporationFile | null) => void;
}) {
  const ref = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [category, setCategory] = useState<CorporationFileCategory>('ID Copy');

  async function upload(file: File) {
    setError('');
    setBusy(true);
    try {
      const data = await uploadCorporationFile(corporationId, category, file, personId);
      onUploaded(data.file ?? null);
    } catch (e) {
      setError(`Upload failed: ${e instanceof Error ? e.message : 'unknown error'}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-1">
      {error && <span className="text-[10px] text-rose-600 dark:text-rose-400">{error}</span>}
      <SelectDropdown
        value={category}
        options={PERSON_CATEGORIES}
        onSelect={(v) => { if (v) setCategory(v as CorporationFileCategory); }}
        disabled={busy}
        className="inline-flex items-center gap-1 px-1.5 py-1 text-xs border border-stone-300 dark:border-white/15 rounded-lg bg-white dark:bg-card"
      />
      <button
        onClick={() => ref.current?.click()}
        disabled={busy}
        className="inline-flex items-center gap-1 px-2 py-1 text-xs border border-stone-300 dark:border-white/15 rounded-lg bg-white dark:bg-card hover:bg-stone-50 dark:hover:bg-white/5 disabled:opacity-50"
      >
        <Upload className="w-3 h-3" />
        {busy ? '…' : 'Attach'}
      </button>
      <input
        ref={ref}
        type="file"
        className="hidden"
        accept="image/*,application/pdf"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) upload(f);
          e.target.value = '';
        }}
      />
    </div>
  );
}
