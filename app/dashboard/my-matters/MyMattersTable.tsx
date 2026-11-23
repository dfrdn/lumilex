'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import {
  Search,
  X,
  SlidersHorizontal,
  ChevronDown,
  ChevronRight,
  Pencil,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Gavel,
  Users2,
  FileText,
  CheckSquare,
} from 'lucide-react';
import { toast } from 'sonner';
import { useDetailPane } from '@/components/DetailPaneContext';
import Avatar from '@/components/Avatar';
import CellDropdown from '@/components/admin/CellDropdown';
import { usePersistedState } from '@/hooks/use-persisted-state';
import type { PartnerMatterView, EntityItem, TeamAvatar } from '@/lib/queries/partner-matters';
import { MATTER_STATUSES } from '@/lib/matter-status';
import {
  HEARING_WINDOW_DAYS,
  IDLE_DAYS,
  summarizeClients,
  type ClientSummary,
} from '@/lib/my-matters/client-summary';

/* ── Urgency colours ─────────────────────────────────────────── */

const URGENCY_ORDER: PartnerMatterView['urgency'][] = ['High', 'Medium', 'Low', 'None'];

const urgencyBadge: Record<string, string> = {
  High: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-800',
  Medium:
    'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800',
  Low: 'bg-stone-100 text-stone-600 border-stone-200 dark:bg-stone-800 dark:text-stone-300 dark:border-stone-700',
  None: 'bg-stone-50 text-stone-400 border-stone-100 dark:bg-stone-900 dark:text-stone-500 dark:border-stone-700',
};

const urgencyHeader: Record<string, string> = {
  High: 'border-l-red-500 bg-red-50/60 dark:bg-red-950/40',
  Medium: 'border-l-amber-500 bg-amber-50/60 dark:bg-amber-950/40',
  Low: 'border-l-stone-400 bg-stone-50/60 dark:bg-stone-800/40',
  None: 'border-l-stone-300 bg-stone-50/40 dark:border-l-stone-600 dark:bg-stone-900/40',
};

/* ── Avatar colours (same as MattersTable) ───────────────────── */

const avatarColors = [
  'bg-navy-100 text-navy-700 dark:bg-navy-500/20 dark:text-navy-200',
  'bg-gold-100 text-gold-700 dark:bg-gold-500/15 dark:text-gold-300',
  'bg-stone-200 text-stone-700 dark:bg-stone-700 dark:text-stone-200',
  'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
  'bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-300',
  'bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300',
];

/* ── Column definition ───────────────────────────────────────── */

interface ColDef {
  key: string;
  label: string;
  defaultVisible: boolean;
  sortable: boolean;
}

const COLUMNS: ColDef[] = [
  { key: 'name', label: 'Matter', defaultVisible: true, sortable: true },
  { key: 'client', label: 'Client', defaultVisible: false, sortable: true },
  { key: 'team', label: 'Team', defaultVisible: true, sortable: false },
  { key: 'health', label: 'Risk', defaultVisible: true, sortable: true },
  { key: 'lastIncident', label: 'Last Incident', defaultVisible: true, sortable: false },
  { key: 'pendingDeliverables', label: 'Pending Deliverables', defaultVisible: true, sortable: true },
  { key: 'upcomingMeetings', label: 'Upcoming Meetings', defaultVisible: true, sortable: true },
  { key: 'upcomingHearings', label: 'Upcoming Hearings', defaultVisible: true, sortable: true },
  { key: 'pendingTasks', label: 'Pending Tasks', defaultVisible: true, sortable: true },
  { key: 'notes', label: 'Notes', defaultVisible: true, sortable: false },
  { key: 'urgency', label: 'Urgency', defaultVisible: true, sortable: true },
];

const HEALTH_TIER_ORDER: Record<string, number> = { red: 0, yellow: 1, green: 2 };

const healthPillStyle: Record<string, string> = {
  red: 'bg-red-100 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-800',
  yellow: 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800',
  green: 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800',
};

/* ── Helpers ──────────────────────────────────────────────────── */

function formatDate(d: string | null): string {
  if (!d) return '—';
  const date = new Date(d + 'T00:00:00');
  return date.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatShortDate(d: string | null): string {
  if (!d) return '';
  const date = new Date(d + 'T00:00:00');
  return date.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
}

function getSortValue(m: PartnerMatterView, key: string): string | number {
  switch (key) {
    case 'name': return m.name.toLowerCase();
    case 'client': return m.clientName.toLowerCase();
    case 'pendingDeliverables': return m.pendingDeliverables.length;
    case 'upcomingMeetings': return m.upcomingMeetings.length;
    case 'upcomingHearings': return m.upcomingHearings.length;
    case 'pendingTasks': return m.pendingTasks.length;
    case 'urgency': return URGENCY_ORDER.indexOf(m.urgency);
    case 'health': return m.health ? HEALTH_TIER_ORDER[m.health.tier] : 99;
    default: return '';
  }
}

function matchesSearch(m: PartnerMatterView, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  const haystack = `${m.name} ${m.matterCode} ${m.clientName} ${m.notes}`.toLowerCase();
  return tokens.every((t) => haystack.includes(t));
}

const STATUS_OPTIONS = MATTER_STATUSES;

/* Whose matters: staffed on, or of clients the viewer is relationship partner for */
type Scope = 'all' | 'team' | 'clients';
const SCOPES: { key: Scope; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'team', label: 'On team' },
  { key: 'clients', label: 'My clients' },
];

const SEGMENT = 'px-2.5 py-1 rounded-md transition-all cursor-pointer';
const SEGMENT_ON = 'bg-white dark:bg-stone-700 shadow-sm text-stone-900 dark:text-stone-50 font-medium';
const SEGMENT_OFF = 'text-stone-500 dark:text-stone-400 hover:text-stone-800 dark:hover:text-stone-100';

type GroupBy = 'risk' | 'client' | 'urgency';
const GROUP_BYS: { key: GroupBy; label: string }[] = [
  { key: 'risk', label: 'Risk' },
  { key: 'client', label: 'Client' },
  { key: 'urgency', label: 'Urgency' },
];

const RISK_GROUPS: { key: string; label: string; badge: string; header: string }[] = [
  {
    key: 'red',
    label: 'At risk',
    badge: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-800',
    header: 'border-l-red-500 bg-red-50/60 dark:bg-red-950/40',
  },
  {
    key: 'yellow',
    label: 'Watch',
    badge: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800',
    header: 'border-l-amber-500 bg-amber-50/60 dark:bg-amber-950/40',
  },
  {
    key: 'green',
    label: 'On track',
    badge: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800',
    header: 'border-l-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/30',
  },
  {
    key: 'none',
    label: 'Not yet scored',
    badge: urgencyBadge.None,
    header: urgencyHeader.None,
  },
];

/* The matter name stays in view while the wide table scrolls sideways */
const STICKY_COL = 'sticky left-0 z-[1] shadow-[inset_-1px_0_0_rgb(0_0_0/0.06)] dark:shadow-[inset_-1px_0_0_rgb(255_255_255/0.06)]';

const CLIENT_HEADER = 'border-l-navy-400 bg-stone-50/60 dark:bg-stone-800/40';

interface Group {
  key: string;
  label: string;
  /** Pill styling; a client group shows its name as plain text instead. */
  badge: string | null;
  header: string;
  items: PartnerMatterView[];
}


/* ── Entity cell (collapsible: count ↔ detail) ───────────────── */

function EntityCell({
  items,
  icon,
  emptyText,
  expanded,
  onToggle,
  paneEntity,
  openPane,
}: {
  items: EntityItem[];
  icon: React.ReactNode;
  emptyText?: string;
  expanded: boolean;
  onToggle: () => void;
  paneEntity: string;
  openPane: (entity: string, id: string) => void;
}) {
  if (items.length === 0) {
    return <span className="text-stone-400 text-xs dark:text-stone-500">{emptyText ?? '—'}</span>;
  }

  // Collapsed: just count
  if (!expanded) {
    return (
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center gap-1.5 text-xs text-stone-600 dark:text-stone-300 hover:text-stone-800 dark:hover:text-stone-100 cursor-pointer"
      >
        {icon}
        <span className="font-semibold tabular-nums">{items.length}</span>
        <ChevronRight className="w-3 h-3 text-stone-400 dark:text-stone-500" />
      </button>
    );
  }

  // Expanded: full detail list
  return (
    <div className="space-y-1.5 min-w-[200px]">
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center gap-1.5 text-xs text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 cursor-pointer mb-1"
      >
        {icon}
        <span className="font-semibold tabular-nums">{items.length}</span>
        <ChevronDown className="w-3 h-3" />
      </button>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => openPane(paneEntity, item.id)}
          className="block text-left text-xs leading-snug w-full hover:bg-stone-50 dark:hover:bg-stone-800 rounded px-1 py-0.5 -mx-1 cursor-pointer transition-colors"
        >
          <div className="text-stone-700 dark:text-stone-200 font-medium hover:underline">
            {item.name || '(Untitled)'}
          </div>
          <div className="flex items-center gap-1.5 text-stone-500 dark:text-stone-400">
            {item.date && (
              <span className={`tabular-nums ${item.overdue ? 'text-red-600 dark:text-red-400 font-semibold' : ''}`}>
                {item.overdue && 'OVERDUE · '}
                {formatShortDate(item.date)}
              </span>
            )}
            {item.currentlyWith.length > 0 && (
              <span className="text-stone-400 dark:text-stone-500">
                · {item.currentlyWith.join(', ')}
              </span>
            )}
          </div>
        </button>
      ))}
    </div>
  );
}

/* ── Last Incident cell (stacked) ────────────────────────────── */

function LastIncidentCell({ m, openPane }: { m: PartnerMatterView; openPane: (entity: string, id: string) => void }) {
  const entries: { type: string; id: string; date: string; name: string; color: string; paneEntity: string }[] = [];
  if (m.lastHearing) entries.push({ type: 'Hearing', ...m.lastHearing, color: 'text-blue-600 dark:text-blue-400', paneEntity: 'hearings' });
  if (m.lastMeeting) entries.push({ type: 'Meeting', ...m.lastMeeting, color: 'text-purple-600 dark:text-purple-400', paneEntity: 'meetings' });
  if (m.lastFiling) entries.push({ type: 'Filing', ...m.lastFiling, color: 'text-orange-600 dark:text-orange-400', paneEntity: 'deliverables' });
  if (m.lastReceivedFile) entries.push({ type: 'File Received', ...m.lastReceivedFile, color: 'text-emerald-600 dark:text-emerald-400', paneEntity: 'files' });

  if (entries.length === 0) return <span className="text-stone-400 text-xs dark:text-stone-500">—</span>;

  // Sort by date desc
  entries.sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div className="space-y-1.5 min-w-[170px]">
      {entries.map((e) => (
        <button
          key={e.id}
          type="button"
          onClick={() => openPane(e.paneEntity, e.id)}
          className="block text-left text-xs leading-snug w-full hover:bg-stone-50 dark:hover:bg-stone-800 rounded px-1 py-0.5 -mx-1 cursor-pointer transition-colors"
        >
          <span className={`font-medium ${e.color}`}>{e.type}</span>
          <span className="text-stone-400 mx-1 dark:text-stone-500">·</span>
          <span className="text-stone-500 dark:text-stone-400 tabular-nums">{formatShortDate(e.date)}</span>
          <div className="text-stone-500 dark:text-stone-400 hover:underline">{e.name}</div>
        </button>
      ))}
    </div>
  );
}

/* ── Urgency cell ────────────────────────────────────────────── */

function UrgencyCell({
  value,
  onChange,
}: {
  value: PartnerMatterView['urgency'];
  onChange: (next: PartnerMatterView['urgency']) => void;
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border cursor-pointer focus:outline-none focus:ring-1 focus:ring-gold-300 dark:focus:ring-gold-500/40 ${urgencyBadge[value]}`}
      >
        {value}
        <ChevronDown className="w-3 h-3 opacity-60" />
      </button>
      {open && (
        <CellDropdown
          mode="single"
          value={value}
          options={URGENCY_ORDER.map((u) => ({ id: u, label: u }))}
          allowClear={false}
          minWidth={160}
          onSelect={(id) => {
            if (id && id !== value) onChange(id as PartnerMatterView['urgency']);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
          anchorRef={anchorRef}
        />
      )}
    </>
  );
}

/* ── Client overview (relationship partners) ─────────────────── */

const OVERVIEW_LIMIT = 8;

function ClientOverview({
  clients,
  selected,
  onSelect,
}: {
  clients: ClientSummary[];
  selected: string | null;
  onSelect: (clientId: string | null) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  if (clients.length === 0) return null;
  const shown = showAll ? clients : clients.slice(0, OVERVIEW_LIMIT);

  return (
    <div className="mb-4">
      <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        {shown.map((c) => {
          const active = selected === c.clientId;
          return (
            <button
              key={c.clientId}
              type="button"
              onClick={() => onSelect(active ? null : c.clientId)}
              aria-pressed={active}
              className={`text-left rounded-lg border px-3 py-2.5 transition-colors cursor-pointer ${
                active
                  ? 'border-gold-300 bg-gold-50 dark:border-gold-700 dark:bg-gold-900/30'
                  : 'border-stone-200 bg-white hover:border-stone-300 dark:border-stone-700 dark:bg-stone-900 dark:hover:border-stone-600'
              }`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-medium text-stone-800 dark:text-stone-100 truncate" title={c.clientName}>
                  {c.clientName || '(No client)'}
                </span>
                <span className="text-[11px] text-stone-400 dark:text-stone-500 tabular-nums shrink-0">
                  {c.matters} matter{c.matters !== 1 ? 's' : ''}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] tabular-nums">
                <span className={c.overdue ? 'text-red-600 dark:text-red-400 font-semibold' : 'text-stone-400 dark:text-stone-500'}>
                  {c.overdue} overdue
                </span>
                <span className={c.hearingsSoon ? 'text-blue-600 dark:text-blue-400' : 'text-stone-400 dark:text-stone-500'}>
                  {c.hearingsSoon} hearing{c.hearingsSoon !== 1 ? 's' : ''} in {HEARING_WINDOW_DAYS}d
                </span>
                <span className={c.idle ? 'text-amber-600 dark:text-amber-400' : 'text-stone-400 dark:text-stone-500'}>
                  {c.idle} idle {IDLE_DAYS}d+
                </span>
              </div>
            </button>
          );
        })}
      </div>
      {clients.length > OVERVIEW_LIMIT && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="mt-2 px-2 py-1 -ml-2 rounded-md text-[11px] text-stone-500 dark:text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800 hover:underline cursor-pointer"
        >
          {showAll ? 'Show fewer clients' : `Show all ${clients.length} clients`}
        </button>
      )}
    </div>
  );
}

/* ── Main Component ──────────────────────────────────────────── */

interface Props {
  data: PartnerMatterView[];
  currentUserId: string;
  /** Manila day from the server, so server and browser count the same windows. */
  today: string;
}

export default function MyMattersTable({ data: initialData, currentUserId, today }: Props) {
  const { openPane } = useDetailPane();
  const [items, setItems] = useState(initialData);
  const isRelationshipPartner = useMemo(
    () => initialData.some((m) => m.isRelationshipPartner),
    [initialData],
  );
  const [storedScope, setScope] = usePersistedState<Scope>('myMatters.scope', 'all', { afterMount: true });
  const scope: Scope = isRelationshipPartner ? storedScope : 'all';
  const [groupBy, setGroupBy] = usePersistedState<GroupBy>('myMatters.groupBy', 'risk', { afterMount: true });
  const [clientFilter, setClientFilter] = useState<string | null>(null);

  /* Toolbar state */
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = usePersistedState('myMatters.status', 'Ongoing', { afterMount: true });
  const [collaboratorIds, setCollaboratorIds] = useState<string[]>([]);
  const [collabMenuOpen, setCollabMenuOpen] = useState(false);
  const [collabQuery, setCollabQuery] = useState('');
  const [sortKey, setSortKey] = useState('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [colMenuOpen, setColMenuOpen] = useState(false);
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const [groupMenuOpen, setGroupMenuOpen] = useState(false);
  const [visibleCols, setVisibleCols] = useState<Record<string, boolean>>(() => {
    const map: Record<string, boolean> = {};
    for (const col of COLUMNS) map[col.key] = col.defaultVisible;
    // A relationship partner's list spans several clients; name them
    if (isRelationshipPartner) map.client = true;
    return map;
  });
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  /* Entity column expansion: matterId-colKey → expanded */
  const [expandedEntities, setExpandedEntities] = useState<Record<string, boolean>>({});
  const toggleEntity = useCallback((matterId: string, colKey: string) => {
    const key = `${matterId}-${colKey}`;
    setExpandedEntities((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  /* Inline edit state */
  const [editingNotes, setEditingNotes] = useState<string | null>(null);
  const [editNoteValue, setEditNoteValue] = useState('');

  /* Refs for click-outside */
  const colMenuRef = useRef<HTMLDivElement>(null);
  const statusMenuRef = useRef<HTMLDivElement>(null);
  const groupMenuRef = useRef<HTMLDivElement>(null);
  const collabMenuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!colMenuOpen && !statusMenuOpen && !groupMenuOpen && !collabMenuOpen) return;
    function handleClick(e: MouseEvent) {
      if (colMenuOpen && colMenuRef.current && !colMenuRef.current.contains(e.target as Node)) {
        setColMenuOpen(false);
      }
      if (statusMenuOpen && statusMenuRef.current && !statusMenuRef.current.contains(e.target as Node)) {
        setStatusMenuOpen(false);
      }
      if (groupMenuOpen && groupMenuRef.current && !groupMenuRef.current.contains(e.target as Node)) {
        setGroupMenuOpen(false);
      }
      if (collabMenuOpen && collabMenuRef.current && !collabMenuRef.current.contains(e.target as Node)) {
        setCollabMenuOpen(false);
        setCollabQuery('');
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [colMenuOpen, statusMenuOpen, groupMenuOpen, collabMenuOpen]);

  /* ── Save helpers ──────────────────────────────────────────── */

  /** Optimistic: show the edit now, put the old value back if the save fails. */
  const updateAnnotation = useCallback(
    async <F extends 'urgency' | 'notes'>(m: PartnerMatterView, field: F, value: PartnerMatterView[F]) => {
      const previous = m[field];
      if (value === previous) return;
      const patch = (from: PartnerMatterView[F], to: PartnerMatterView[F]) =>
        setItems((prev) =>
          prev.map((row) => (row.id === m.id && row[field] === from ? { ...row, [field]: to } : row)),
        );
      patch(previous, value);
      try {
        const res = await fetch('/api/partner/matters', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ matterId: m.id, field, value }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } catch {
        // Only undo our own edit; a later edit to the same field stands
        patch(value, previous);
        toast.error(`Couldn't save ${field === 'urgency' ? 'urgency' : 'notes'} for ${m.name || 'this matter'}`);
      }
    },
    [],
  );

  /* ── Filter / sort / group ─────────────────────────────────── */

  const searchTokens = useMemo(
    () =>
      searchQuery
        .toLowerCase()
        .split(/\s+/)
        .filter((t) => t.length > 0),
    [searchQuery],
  );

  const statusScoped = useMemo(() => {
    let result = items;
    if (scope === 'team') result = result.filter((m) => m.onTeam);
    else if (scope === 'clients') result = result.filter((m) => m.isRelationshipPartner);
    return statusFilter ? result.filter((m) => m.status === statusFilter) : result;
  }, [items, scope, statusFilter]);

  /* Active lawyers I share a matter with, most-shared first */
  const collaborators = useMemo(() => {
    const map = new Map<string, TeamAvatar & { matterCount: number }>();
    for (const m of statusScoped) {
      // A relationship-only matter isn't shared: the viewer isn't on its team
      if (!m.onTeam) continue;
      for (const member of m.teamMembers) {
        if (member.personId === currentUserId || !member.isActiveLawyer) continue;
        const existing = map.get(member.personId);
        if (existing) existing.matterCount += 1;
        else map.set(member.personId, { ...member, matterCount: 1 });
      }
    }
    return [...map.values()].sort(
      (a, b) =>
        b.matterCount - a.matterCount ||
        (a.name || a.initials).localeCompare(b.name || b.initials),
    );
  }, [statusScoped, currentUserId]);

  /* Label lookup spans every status so a selection survives a status change */
  const teamById = useMemo(() => {
    const map = new Map<string, TeamAvatar>();
    for (const m of items) for (const member of m.teamMembers) map.set(member.personId, member);
    return map;
  }, [items]);

  const selectedCollaborators = useMemo(
    () => collaboratorIds.map((id) => teamById.get(id)).filter((c): c is TeamAvatar => !!c),
    [collaboratorIds, teamById],
  );

  const visibleCollaborators = useMemo(() => {
    const q = collabQuery.trim().toLowerCase();
    if (!q) return collaborators;
    return collaborators.filter((c) =>
      `${c.name} ${c.initials}`.toLowerCase().includes(q),
    );
  }, [collaborators, collabQuery]);

  const toggleCollaborator = useCallback((personId: string) => {
    setCollaboratorIds((prev) =>
      prev.includes(personId) ? prev.filter((id) => id !== personId) : [...prev, personId],
    );
  }, []);

  const clientSummaries = useMemo(
    () => (scope === 'clients' ? summarizeClients(statusScoped, today) : []),
    [scope, statusScoped, today],
  );
  // A picked client drops out of view with the scope or status that showed it
  const activeClientFilter =
    clientFilter && clientSummaries.some((c) => c.clientId === clientFilter) ? clientFilter : null;
  const activeClientName = clientSummaries.find((c) => c.clientId === activeClientFilter)?.clientName;

  const filtered = useMemo(() => {
    let result = statusScoped;
    if (activeClientFilter) result = result.filter((m) => m.clientId === activeClientFilter);
    if (collaboratorIds.length) {
      result = result.filter((m) =>
        collaboratorIds.every((id) => m.teamPersonIds.includes(id)),
      );
    }
    if (searchTokens.length) result = result.filter((m) => matchesSearch(m, searchTokens));
    return result;
  }, [statusScoped, activeClientFilter, collaboratorIds, searchTokens]);

  const sorted = useMemo(() => {
    const col = COLUMNS.find((c) => c.key === sortKey);
    if (!col || !col.sortable) return filtered;
    return [...filtered].sort((a, b) => {
      const va = getSortValue(a, sortKey);
      const vb = getSortValue(b, sortKey);
      if (va < vb) return sortDir === 'asc' ? -1 : 1;
      if (va > vb) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
  }, [filtered, sortKey, sortDir]);

  const grouped = useMemo((): Group[] => {
    if (groupBy === 'client') {
      const map = new Map<string, Group>();
      for (const m of sorted) {
        let g = map.get(m.clientId);
        if (!g) {
          g = { key: m.clientId, label: m.clientName || '(No client)', badge: null, header: CLIENT_HEADER, items: [] };
          map.set(m.clientId, g);
        }
        g.items.push(m);
      }
      return [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
    }
    if (groupBy === 'risk') {
      return RISK_GROUPS.map((r) => ({
        key: r.key,
        label: r.label,
        badge: r.badge,
        header: r.header,
        items: sorted.filter((m) => (m.health?.tier ?? 'none') === r.key),
      })).filter((g) => g.items.length > 0);
    }
    return URGENCY_ORDER.map((u) => ({
      key: u,
      label: u,
      badge: urgencyBadge[u],
      header: urgencyHeader[u],
      items: sorted.filter((m) => m.urgency === u),
    })).filter((g) => g.items.length > 0);
  }, [sorted, groupBy]);

  const activeCols = COLUMNS.filter((c) => visibleCols[c.key]);

  const handleSort = (key: string) => {
    const col = COLUMNS.find((c) => c.key === key);
    if (!col?.sortable) return;
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  /* ── Render cell ───────────────────────────────────────────── */

  const renderCell = (m: PartnerMatterView, colKey: string) => {
    switch (colKey) {
      case 'name':
        return (
          <Link
            href={`/dashboard/matters/${m.id}`}
            className="hover:underline text-stone-800 dark:text-stone-200 font-medium"
          >
            {m.name || '(Untitled)'}
            {m.matterCode && (
              <span className="ml-2 text-[11px] text-stone-400 font-mono dark:text-stone-500">{m.matterCode}</span>
            )}
            {!m.onTeam && (
              <span
                title="You are relationship partner for this client but not on the matter team"
                className="ml-2 inline-block align-middle px-1.5 py-px rounded text-[10px] font-medium border border-navy-200 bg-navy-50 text-navy-700 dark:border-navy-500/40 dark:bg-navy-500/15 dark:text-navy-200"
              >
                Relationship
              </span>
            )}
          </Link>
        );
      case 'client':
        return <span className="text-stone-600 dark:text-stone-300">{m.clientName || '—'}</span>;
      case 'team': {
        if (m.teamMembers.length === 0) return <span className="text-stone-400 dark:text-stone-500">—</span>;
        // Selected colleagues lead the stack so the match stays visible past the 4-avatar cap
        const ordered = collaboratorIds.length
          ? [
              ...m.teamMembers.filter((mem) => collaboratorIds.includes(mem.personId)),
              ...m.teamMembers.filter((mem) => !collaboratorIds.includes(mem.personId)),
            ]
          : m.teamMembers;
        return (
          <div className="flex items-center -space-x-1">
            {ordered.slice(0, 4).map((member, i) => (
              <Avatar
                key={member.personId}
                avatarUrl={member.avatarUrl}
                initials={member.initials}
                name={member.name}
                title={member.name || member.initials}
                size={24}
                className={
                  collaboratorIds.includes(member.personId)
                    ? 'ring-2 ring-gold-400 dark:ring-gold-500'
                    : 'ring-2 ring-white dark:ring-stone-900'
                }
                fallbackClassName={`text-[10px] font-bold ${avatarColors[i % avatarColors.length]}`}
              />
            ))}
            {m.teamMembers.length > 4 && (
              <span className="w-6 h-6 rounded-full text-[10px] font-medium flex items-center justify-center ring-2 ring-white dark:ring-stone-900 bg-stone-100 text-stone-500 dark:bg-stone-700 dark:text-stone-400">
                +{m.teamMembers.length - 4}
              </span>
            )}
          </div>
        );
      }
      case 'lastIncident':
        return <LastIncidentCell m={m} openPane={openPane} />;
      case 'pendingDeliverables':
        return (
          <EntityCell
            items={m.pendingDeliverables}
            icon={<FileText className="w-3.5 h-3.5 text-stone-400 dark:text-stone-500" />}
            expanded={expandedEntities[`${m.id}-pendingDeliverables`] ?? false}
            onToggle={() => toggleEntity(m.id, 'pendingDeliverables')}
            paneEntity="deliverables"
            openPane={openPane}
          />
        );
      case 'upcomingMeetings':
        return (
          <EntityCell
            items={m.upcomingMeetings}
            icon={<Users2 className="w-3.5 h-3.5 text-stone-400 dark:text-stone-500" />}
            expanded={expandedEntities[`${m.id}-upcomingMeetings`] ?? false}
            onToggle={() => toggleEntity(m.id, 'upcomingMeetings')}
            paneEntity="meetings"
            openPane={openPane}
          />
        );
      case 'upcomingHearings':
        return (
          <EntityCell
            items={m.upcomingHearings}
            icon={<Gavel className="w-3.5 h-3.5 text-stone-400 dark:text-stone-500" />}
            expanded={expandedEntities[`${m.id}-upcomingHearings`] ?? false}
            onToggle={() => toggleEntity(m.id, 'upcomingHearings')}
            paneEntity="hearings"
            openPane={openPane}
          />
        );
      case 'pendingTasks':
        return (
          <EntityCell
            items={m.pendingTasks}
            icon={<CheckSquare className="w-3.5 h-3.5 text-stone-400 dark:text-stone-500" />}
            expanded={expandedEntities[`${m.id}-pendingTasks`] ?? false}
            onToggle={() => toggleEntity(m.id, 'pendingTasks')}
            paneEntity="tasks"
            openPane={openPane}
          />
        );
      case 'notes':
        if (editingNotes === m.id) {
          return (
            <textarea
              autoFocus
              rows={2}
              value={editNoteValue}
              onChange={(e) => setEditNoteValue(e.target.value)}
              onBlur={() => {
                setEditingNotes(null);
                updateAnnotation(m, 'notes', editNoteValue);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setEditingNotes(null);
              }}
              className="w-full text-xs border border-stone-200 dark:border-stone-600 rounded-md px-2 py-1 bg-white dark:bg-stone-800 text-stone-700 dark:text-stone-200 focus:outline-none focus:ring-1 focus:ring-gold-300 dark:focus:ring-gold-500/40 resize-none min-w-[160px]"
            />
          );
        }
        return (
          <button
            type="button"
            onClick={() => {
              setEditingNotes(m.id);
              setEditNoteValue(m.notes);
            }}
            className="group flex items-center gap-1 text-left text-xs text-stone-600 dark:text-stone-300 hover:text-stone-800 dark:hover:text-stone-100 cursor-pointer w-full min-w-[120px]"
          >
            <span className="truncate max-w-[180px]">{m.notes || '—'}</span>
            <Pencil className="w-3 h-3 text-stone-300 group-hover:text-stone-500 shrink-0 dark:text-stone-600" />
          </button>
        );
      case 'health': {
        if (!m.health) {
          return <span className="text-[11px] text-stone-300 dark:text-stone-600">—</span>;
        }
        // The pill carries the score's tier; the signal is a separate fact and
        // keeps its own colour, so a green score can still say "2 overdue"
        const signal = m.health.topSignal;
        const signalTone = signal?.startsWith('idle')
          ? 'text-amber-600 dark:text-amber-400'
          : 'text-red-600 dark:text-red-400';
        return (
          <div className="flex flex-col items-start gap-0.5" title={`Score ${m.health.score}/100`}>
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border tabular-nums ${healthPillStyle[m.health.tier]}`}
            >
              {m.health.score}
            </span>
            {signal && <span className={`text-[11px] whitespace-nowrap ${signalTone}`}>{signal}</span>}
          </div>
        );
      }
      case 'urgency':
        return <UrgencyCell value={m.urgency} onChange={(u) => updateAnnotation(m, 'urgency', u)} />;
      default:
        return null;
    }
  };

  /* ── Render ────────────────────────────────────────────────── */

  return (
    <div>
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-stone-400 pointer-events-none dark:text-stone-500" />
            <input
              ref={searchRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search matters..."
              className="pl-8 pr-7 py-1.5 text-xs rounded-lg border border-stone-200 dark:border-stone-600 bg-white dark:bg-stone-800 text-stone-700 dark:text-stone-200 placeholder:text-stone-400 focus:outline-none focus:border-gold-300 focus:ring-1 focus:ring-gold-200 dark:focus:border-gold-500/50 dark:focus:ring-gold-500/30 w-48 sm:w-56 transition-all duration-150 dark:placeholder:text-stone-500"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  searchRef.current?.focus();
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600 cursor-pointer dark:text-stone-500 dark:hover:text-stone-300"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <p className="text-sm text-stone-500 dark:text-stone-400">
            <span className="font-semibold text-stone-700 dark:text-stone-200 tabular-nums">
              {sorted.length}
            </span>{' '}
            Matter{sorted.length !== 1 ? 's' : ''}
          </p>

          {activeClientName !== undefined && (
            <button
              type="button"
              onClick={() => setClientFilter(null)}
              className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-full border border-gold-300 bg-gold-50 text-gold-700 dark:border-gold-700 dark:bg-gold-900/30 dark:text-gold-300 cursor-pointer"
              title="Show every client"
            >
              {activeClientName || '(No client)'}
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          {isRelationshipPartner && (
            <div
              className="inline-flex p-0.5 rounded-lg bg-stone-100 dark:bg-white/[0.06] text-xs"
              role="group"
              aria-label="Whose matters"
            >
              {SCOPES.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setScope(s.key)}
                  aria-pressed={scope === s.key}
                  className={`${SEGMENT} ${scope === s.key ? SEGMENT_ON : SEGMENT_OFF}`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}

          {/* Working-with filter */}
          <div className="relative" ref={collabMenuRef}>
            <button
              type="button"
              onClick={() => setCollabMenuOpen((o) => !o)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-all duration-150 cursor-pointer ${
                collaboratorIds.length
                  ? 'border-gold-300 bg-gold-50 text-gold-700 dark:border-gold-700 dark:bg-gold-900/30 dark:text-gold-300'
                  : 'border-stone-200 dark:border-stone-600 bg-white dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:border-stone-300 hover:text-stone-700 dark:hover:border-stone-500 dark:hover:text-stone-200'
              }`}
            >
              <Users2 className="w-3.5 h-3.5" />
              {selectedCollaborators.length === 0
                ? 'Working with'
                : selectedCollaborators.length === 1
                  ? `With ${selectedCollaborators[0].initials}`
                  : `With ${selectedCollaborators.map((c) => c.initials).join(', ')}`}
              <ChevronDown className="w-3 h-3" />
            </button>
            {collabMenuOpen && (
              <div className="absolute right-0 top-full mt-1.5 bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-600 rounded-xl shadow-lg py-2 px-1 w-[260px] z-20">
                {collaborators.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-stone-400 dark:text-stone-500">
                    No shared matters in this view
                  </p>
                ) : (
                  <>
                    {collaborators.length > 8 && (
                      <div className="px-2 pb-2">
                        <input
                          autoFocus
                          type="text"
                          value={collabQuery}
                          onChange={(e) => setCollabQuery(e.target.value)}
                          placeholder="Find a colleague..."
                          className="w-full px-2 py-1.5 text-xs rounded-lg border border-stone-200 dark:border-stone-600 bg-white dark:bg-stone-900 text-stone-700 dark:text-stone-200 placeholder:text-stone-400 dark:placeholder:text-stone-500 focus:outline-none focus:border-gold-300 focus:ring-1 focus:ring-gold-200 dark:focus:border-gold-500/50 dark:focus:ring-gold-500/30"
                        />
                      </div>
                    )}
                    <div className="max-h-64 overflow-y-auto">
                      {visibleCollaborators.length === 0 ? (
                        <p className="px-3 py-2 text-xs text-stone-400 dark:text-stone-500">
                          No match
                        </p>
                      ) : (
                        visibleCollaborators.map((c) => {
                          const checked = collaboratorIds.includes(c.personId);
                          return (
                            <button
                              key={c.personId}
                              type="button"
                              onClick={() => toggleCollaborator(c.personId)}
                              className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-left transition-colors duration-100 cursor-pointer ${
                                checked
                                  ? 'bg-gold-50 dark:bg-gold-900/30'
                                  : 'hover:bg-stone-50 dark:hover:bg-stone-700'
                              }`}
                            >
                              <Avatar
                                avatarUrl={c.avatarUrl}
                                initials={c.initials}
                                name={c.name}
                                size={22}
                                fallbackClassName="text-[10px] font-bold bg-stone-200 text-stone-700 dark:bg-stone-700 dark:text-stone-200"
                              />
                              <span
                                className={`flex-1 truncate text-xs ${
                                  checked
                                    ? 'text-gold-700 font-medium dark:text-gold-300'
                                    : 'text-stone-700 dark:text-stone-300'
                                }`}
                              >
                                {c.name || c.initials}
                              </span>
                              <span className="text-[11px] tabular-nums text-stone-400 dark:text-stone-500">
                                {c.matterCount}
                              </span>
                            </button>
                          );
                        })
                      )}
                    </div>
                  </>
                )}
                {/* Outside the branch above: a selection must stay clearable even
                    when the colleague list itself comes back empty. */}
                {collaboratorIds.length > 0 && (
                  <div className="border-t border-stone-100 dark:border-stone-700 mt-1.5 pt-1.5">
                    {collaboratorIds.length > 1 && (
                      <p className="px-3 pb-1 text-[11px] text-stone-400 dark:text-stone-500">
                        Showing matters where everyone selected is on the team
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={() => setCollaboratorIds([])}
                      className="w-full text-left px-3 py-1.5 rounded-lg text-xs text-stone-600 dark:text-stone-300 hover:bg-stone-50 dark:hover:bg-stone-700 transition-colors duration-100 cursor-pointer"
                    >
                      Clear
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Grouping */}
          <div className="relative" ref={groupMenuRef}>
            <button
              type="button"
              onClick={() => setGroupMenuOpen((o) => !o)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-stone-200 dark:border-stone-600 bg-white dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:border-stone-300 hover:text-stone-700 transition-all duration-150 cursor-pointer dark:hover:text-stone-200 dark:hover:border-stone-600"
            >
              Group: {GROUP_BYS.find((g) => g.key === groupBy)?.label}
              <ChevronDown className="w-3 h-3" />
            </button>
            {groupMenuOpen && (
              <div className="absolute right-0 top-full mt-1.5 bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-600 rounded-xl shadow-lg py-2 px-1 min-w-[140px] z-20">
                {GROUP_BYS.map((g) => (
                  <button
                    key={g.key}
                    type="button"
                    onClick={() => {
                      setGroupBy(g.key);
                      setGroupMenuOpen(false);
                    }}
                    className={`w-full text-left px-3 py-1.5 rounded-lg text-xs transition-colors duration-100 cursor-pointer ${
                      groupBy === g.key
                        ? 'bg-gold-50 text-gold-700 font-medium dark:bg-gold-900/30 dark:text-gold-300'
                        : 'text-stone-600 dark:text-stone-300 hover:bg-stone-50 dark:hover:bg-stone-700'
                    }`}
                  >
                    {g.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Status filter */}
          <div className="relative" ref={statusMenuRef}>
            <button
              type="button"
              onClick={() => setStatusMenuOpen((o) => !o)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-stone-200 dark:border-stone-600 bg-white dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:border-stone-300 hover:text-stone-700 transition-all duration-150 cursor-pointer dark:hover:text-stone-200 dark:hover:border-stone-600"
            >
              {statusFilter || 'All Statuses'}
              <ChevronDown className="w-3 h-3" />
            </button>
            {statusMenuOpen && (
              <div className="absolute right-0 top-full mt-1.5 bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-600 rounded-xl shadow-lg py-2 px-1 min-w-[140px] z-20">
                <button
                  type="button"
                  onClick={() => {
                    setStatusFilter('');
                    setStatusMenuOpen(false);
                  }}
                  className={`w-full text-left px-3 py-1.5 rounded-lg text-xs transition-colors duration-100 cursor-pointer ${
                    !statusFilter
                      ? 'bg-gold-50 text-gold-700 font-medium dark:bg-gold-900/30 dark:text-gold-300'
                      : 'text-stone-600 dark:text-stone-300 hover:bg-stone-50 dark:hover:bg-stone-700'
                  }`}
                >
                  All Statuses
                </button>
                {STATUS_OPTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => {
                      setStatusFilter(s);
                      setStatusMenuOpen(false);
                    }}
                    className={`w-full text-left px-3 py-1.5 rounded-lg text-xs transition-colors duration-100 cursor-pointer ${
                      statusFilter === s
                        ? 'bg-gold-50 text-gold-700 font-medium dark:bg-gold-900/30 dark:text-gold-300'
                        : 'text-stone-600 dark:text-stone-300 hover:bg-stone-50 dark:hover:bg-stone-700'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Column visibility */}
          <div className="relative" ref={colMenuRef}>
            <button
              type="button"
              onClick={() => setColMenuOpen((o) => !o)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-stone-200 dark:border-stone-600 bg-white dark:bg-stone-800 text-stone-500 dark:text-stone-300 hover:border-stone-300 hover:text-stone-700 transition-all duration-150 cursor-pointer dark:hover:text-stone-200 dark:hover:border-stone-600"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              Columns
            </button>
            {colMenuOpen && (
              <div className="absolute right-0 top-full mt-1.5 bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-600 rounded-xl shadow-lg py-2 px-1 min-w-[200px] z-20">
                {COLUMNS.map((col) => (
                  <label
                    key={col.key}
                    className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg hover:bg-stone-50 dark:hover:bg-stone-700 cursor-pointer transition-colors duration-100"
                  >
                    <input
                      type="checkbox"
                      checked={visibleCols[col.key]}
                      onChange={() =>
                        setVisibleCols((prev) => ({ ...prev, [col.key]: !prev[col.key] }))
                      }
                      className="rounded border-stone-300 text-gold-600 focus:ring-gold-300 dark:border-stone-600 dark:text-gold-400 dark:focus:ring-gold-500/40"
                    />
                    <span className="text-xs text-stone-700 dark:text-stone-300">{col.label}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {scope === 'clients' && (
        <ClientOverview
          clients={clientSummaries}
          selected={activeClientFilter}
          onSelect={setClientFilter}
        />
      )}

      {/* Grouped table */}
      {grouped.length === 0 ? (
        <div className="text-center py-16 text-stone-400 text-sm dark:text-stone-500">No matters found</div>
      ) : (
        <div className="space-y-4">
          {grouped.map((group) => {
            const collapseKey = `${groupBy}:${group.key}`;
            const isCollapsed = collapsed[collapseKey] ?? false;
            return (
              <div
                key={collapseKey}
                className="rounded-xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 shadow-[var(--shadow-card)] overflow-hidden"
              >
                {/* Group header */}
                <button
                  type="button"
                  onClick={() =>
                    setCollapsed((prev) => ({ ...prev, [collapseKey]: !isCollapsed }))
                  }
                  className={`w-full flex items-center gap-2.5 px-4 py-2.5 border-l-4 cursor-pointer ${group.header}`}
                >
                  {isCollapsed ? (
                    <ChevronRight className="w-4 h-4 text-stone-400 dark:text-stone-500" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-stone-400 dark:text-stone-500" />
                  )}
                  {group.badge ? (
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${group.badge}`}>
                      {group.label}
                    </span>
                  ) : (
                    <span className="text-sm font-semibold text-stone-700 dark:text-stone-200">{group.label}</span>
                  )}
                  <span className="text-xs text-stone-500 dark:text-stone-400">
                    {group.items.length} matter{group.items.length !== 1 ? 's' : ''}
                  </span>
                </button>

                {/* Table rows */}
                {!isCollapsed && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-stone-100 dark:border-stone-700 bg-stone-50/60 dark:bg-stone-800">
                          {activeCols.map((col) => {
                            const isSorted = sortKey === col.key;
                            const canSort = col.sortable;
                            return (
                              <th
                                key={col.key}
                                className={`px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500 ${
                                  canSort ? 'cursor-pointer select-none hover:text-stone-600 dark:hover:text-stone-300' : ''
                                } ${col.key === 'name' ? `${STICKY_COL} bg-stone-50 dark:bg-stone-800` : ''}`}
                                onClick={() => canSort && handleSort(col.key)}
                              >
                                <span className="flex items-center gap-1">
                                  {col.label}
                                  {canSort &&
                                    (isSorted ? (
                                      sortDir === 'asc' ? (
                                        <ArrowUp className="w-3 h-3" />
                                      ) : (
                                        <ArrowDown className="w-3 h-3" />
                                      )
                                    ) : (
                                      <ArrowUpDown className="w-3 h-3 opacity-30" />
                                    ))}
                                </span>
                              </th>
                            );
                          })}
                        </tr>
                      </thead>
                      <tbody>
                        {group.items.map((m) => (
                          <tr
                            key={m.id}
                            className="group/row border-b border-stone-50 dark:border-stone-800 last:border-b-0 hover:bg-stone-50/50 dark:hover:bg-stone-800/50 transition-colors duration-100 align-top"
                          >
                            {activeCols.map((col) => (
                              <td
                                key={col.key}
                                className={`px-4 py-3 text-sm ${
                                  col.key === 'name'
                                    ? `${STICKY_COL} min-w-[200px] bg-white dark:bg-stone-900 group-hover/row:bg-stone-50 dark:group-hover/row:bg-stone-800 transition-colors duration-100`
                                    : ''
                                }`}
                              >
                                {renderCell(m, col.key)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
